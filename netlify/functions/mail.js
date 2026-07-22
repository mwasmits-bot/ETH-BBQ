// Mail versturen vanuit de app via je eigen Gmail (SMTP + app-wachtwoord).
// Beveiliging:
// - Alleen met het admin-wachtwoord (zelfde controle als de andere functies).
// - Er wordt alleen gemaild naar adressen die als deelnemer in de poule staan,
//   zodat deze functie nooit als open doorgeefluik gebruikt kan worden.
// Vereiste environment variables in Netlify:
//   ADMIN_WACHTWOORD        — die heb je al
//   GMAIL_ADRES             — jouw gmail-adres, bv. jij@gmail.com
//   GMAIL_APP_WACHTWOORD    — 16-tekens app-wachtwoord van Google (geen gewoon wachtwoord!)
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
  const afzender = process.env.GMAIL_ADRES;
  const appWachtwoord = process.env.GMAIL_APP_WACHTWOORD;
  if (!afzender || !appWachtwoord) {
    return Response.json({
      fout: "Gmail is nog niet ingesteld. Zet GMAIL_ADRES en GMAIL_APP_WACHTWOORD in Netlify → Site configuration → Environment variables."
    }, { status: 500 });
  }

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
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user: afzender, pass: appWachtwoord }
    });

    const naarBcc = modus !== "to" && geldig.length > 1;
    await transport.sendMail({
      from: afzender,
      to: naarBcc ? afzender : geldig.join(", "),   // bij bcc jezelf als zichtbare ontvanger
      bcc: naarBcc ? geldig.join(", ") : undefined,
      subject: onderwerp,
      text: tekst
    });

    return Response.json({ ok: true, aantal: geldig.length, afzender });
  } catch (e) {
    const melding = String(e && e.message || e);
    const vriendelijk = /invalid login|username and password/i.test(melding)
      ? "Gmail weigert de login. Controleer of GMAIL_APP_WACHTWOORD een app-wachtwoord is (16 tekens, zonder spaties) en of tweestapsverificatie aanstaat."
      : melding;
    return Response.json({ fout: vriendelijk }, { status: 500 });
  }
};
