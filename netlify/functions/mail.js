// Mail versturen vanuit de app via Resend (SMTP), met je eigen domein als afzender.
// Beveiliging:
// - Alleen met het admin-wachtwoord (zelfde controle als de andere functies).
// - Er wordt alleen gemaild naar adressen die als deelnemer in de poule staan,
//   zodat deze functie nooit als open doorgeefluik gebruikt kan worden.
// Vereiste environment variables in Netlify:
//   ADMIN_WACHTWOORD   — die heb je al
//   RESEND_API_KEY     — API-key uit je Resend-account (begint met re_)
//   AFZENDER_ADRES     — bv. info@ethscoritobbq.com (moet een geverifieerd domein zijn in Resend)
//   AFZENDER_NAAM      — optioneel, bv. ETH Scorito BBQ
//   ANTWOORD_ADRES     — jouw eigen gmail; hier komen antwoorden binnen
import { getStore } from "@netlify/blobs";
import nodemailer from "nodemailer";

export default async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // --- admin-controle ---
  const isAdmin = !!process.env.ADMIN_WACHTWOORD &&
    (req.headers.get("x-wachtwoord") || "") === process.env.ADMIN_WACHTWOORD;
  if (!isAdmin) {
    return Response.json({ fout: "Geen toegang — log in als admin." }, { status: 401 });
  }

  // --- instellingen controleren ---
  const apiKey = process.env.RESEND_API_KEY;
  const afzenderAdres = process.env.AFZENDER_ADRES;
  const afzenderNaam = process.env.AFZENDER_NAAM || "ETH Scorito BBQ";
  const antwoordAdres = process.env.ANTWOORD_ADRES || afzenderAdres;

  if (!apiKey || !afzenderAdres) {
    return Response.json({
      fout: "Mail is nog niet ingesteld. Zet RESEND_API_KEY en AFZENDER_ADRES in Netlify → Site configuration → Environment variables."
    }, { status: 500 });
  }

  const afzender = `${afzenderNaam} <${afzenderAdres}>`;

  let body;
  try { body = await req.json(); } catch { body = null; }
  const { ontvangers, onderwerp, tekst, modus } = body || {};

  if (!Array.isArray(ontvangers) || !ontvangers.length || !onderwerp || !tekst) {
    return Response.json({ fout: "Onvolledige mail (ontvangers, onderwerp of tekst ontbreekt)." }, { status: 400 });
  }

  // --- alleen naar bekende deelnemers mailen ---
  const store = getStore("eth-scorito-bbq");
  const hoofd = await store.get("poule", { type: "json" });
  const teams = (hoofd && hoofd.teams) || {};
  const bekend = new Set(
    Object.values(teams)
      .map(t => (t && t.email ? String(t.email).trim().toLowerCase() : ""))
      .filter(Boolean)
  );
  const geldig = ontvangers
    .map(e => String(e).trim())
    .filter(e => bekend.has(e.toLowerCase()));

  if (!geldig.length) {
    return Response.json({ fout: "Geen van de ontvangers staat als deelnemer in de poule." }, { status: 400 });
  }

  // --- versturen ---
  try {
    const transport = nodemailer.createTransport({
      host: "smtp.resend.com",
      port: 465,
      secure: true,
      auth: { user: "resend", pass: apiKey }
    });

    const naarBcc = modus !== "to" && geldig.length > 1;
    await transport.sendMail({
      from: afzender,
      // Bij bcc gaat de zichtbare ontvanger naar jouw eigen adres, zodat je zelf
      // een kopie krijgt. Let op: dit moet een adres zijn dat post kán ontvangen,
      // dus je gmail — niet info@ethscoritobbq.com (daar staat geen mailbox achter).
      to: naarBcc ? antwoordAdres : geldig.join(", "),
      bcc: naarBcc ? geldig.join(", ") : undefined,
      replyTo: antwoordAdres,
      subject: onderwerp,
      text: tekst
    });

    return Response.json({ ok: true, aantal: geldig.length, afzender: afzenderAdres });
  } catch (e) {
    const melding = String(e && e.message || e);
    let vriendelijk = melding;

    if (/invalid login|username and password|535|authentication/i.test(melding)) {
      vriendelijk = "Resend weigert de login. Controleer of RESEND_API_KEY klopt (begint met re_) en of de key nog actief is.";
    } else if (/domain|not verified|403/i.test(melding)) {
      vriendelijk = `Het domein van ${afzenderAdres} is nog niet geverifieerd in Resend. Controleer of de MX/SPF/DKIM-records in Netlify DNS staan en of Resend het domein als "Verified" toont.`;
    } else if (/rate|quota|429/i.test(melding)) {
      vriendelijk = "Daglimiet van Resend bereikt (100 mails/dag op de gratis tier). Probeer het morgen opnieuw.";
    }

    return Response.json({ fout: vriendelijk }, { status: 500 });
  }
};
