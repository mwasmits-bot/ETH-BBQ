// Notificatiemails via dezelfde Resend-instellingen als mail.js.
// Faalt stil (console.error) — een mislukte notificatie mag een inzending nooit blokkeren.
import nodemailer from "nodemailer";
import { bouwHtml } from "./mail.js";

function transport() {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  return nodemailer.createTransport({
    host: "smtp.resend.com",
    port: 465,
    secure: true,
    auth: { user: "resend", pass: apiKey }
  });
}

export async function meldAdmin(onderwerp, tekst) {
  const afzenderAdres = process.env.AFZENDER_ADRES;
  const afzenderNaam = process.env.AFZENDER_NAAM || "ETH Scorito BBQ";
  const antwoordAdres = process.env.ANTWOORD_ADRES || afzenderAdres;
  const t = transport();
  if (!t || !afzenderAdres || !antwoordAdres) return;

  try {
    await t.sendMail({
      from: `${afzenderNaam} <${afzenderAdres}>`,
      to: antwoordAdres,
      subject: onderwerp,
      text: tekst
    });
  } catch (e) {
    console.error("Notificatiemail mislukt:", e && e.message || e);
  }
}

// Stuurt een opgemaakte mail (net als een handmatige mail via mail.js) naar een lijst
// e-mailadressen via BCC, zodat ontvangers elkaars adres niet zien. Gebruikt voor
// automatische abonnee-mails (bijv. "iemand heeft een Side Bet geplaatst").
export async function meldAbonnees(ontvangers, onderwerp, tekst) {
  const geldig = [...new Set((ontvangers || []).map(e => String(e || "").trim()).filter(Boolean))];
  if (!geldig.length) return;

  const afzenderAdres = process.env.AFZENDER_ADRES;
  const afzenderNaam = process.env.AFZENDER_NAAM || "ETH Scorito BBQ";
  const antwoordAdres = process.env.ANTWOORD_ADRES || afzenderAdres;
  const logoUrl = process.env.LOGO_URL || "https://ethscoritobbq.com/eth.png";
  const t = transport();
  if (!t || !afzenderAdres) return;

  try {
    await t.sendMail({
      from: `${afzenderNaam} <${afzenderAdres}>`,
      to: antwoordAdres || afzenderAdres,   // "aan" moet iemand zijn; ontvangers zitten in bcc
      bcc: geldig.join(", "),
      replyTo: antwoordAdres,
      subject: onderwerp,
      text: tekst,
      html: bouwHtml({ tekst, logoUrl, afzenderNaam })
    });
  } catch (e) {
    console.error("Abonneemail mislukt:", e && e.message || e);
  }
}
