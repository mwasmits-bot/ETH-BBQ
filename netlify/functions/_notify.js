// Korte notificatiemail naar de admin zelf, via dezelfde Resend-instellingen als mail.js.
// Faalt stil (console.error) — een mislukte notificatie mag een inzending nooit blokkeren.
import nodemailer from "nodemailer";

export async function meldAdmin(onderwerp, tekst) {
  const apiKey = process.env.RESEND_API_KEY;
  const afzenderAdres = process.env.AFZENDER_ADRES;
  const afzenderNaam = process.env.AFZENDER_NAAM || "ETH Scorito BBQ";
  const antwoordAdres = process.env.ANTWOORD_ADRES || afzenderAdres;

  if (!apiKey || !afzenderAdres || !antwoordAdres) return;

  try {
    const transport = nodemailer.createTransport({
      host: "smtp.resend.com",
      port: 465,
      secure: true,
      auth: { user: "resend", pass: apiKey }
    });
    await transport.sendMail({
      from: `${afzenderNaam} <${afzenderAdres}>`,
      to: antwoordAdres,
      subject: onderwerp,
      text: tekst
    });
  } catch (e) {
    console.error("Notificatiemail mislukt:", e && e.message || e);
  }
}
