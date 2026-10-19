// Mail versturen vanuit de app via Resend (REST-API), met je eigen domein als afzender.
// HTML-opmaak + logo, en platte tekst als fallback. Elke ontvanger krijgt een eigen mail
// (zie _resend.js) — geen BCC meer, dat oogde voor Gmail als bulk.
//
// Vereiste environment variables in Netlify:
//   ADMIN_WACHTWOORD   — die heb je al
//   RESEND_API_KEY     — API-key uit je Resend-account (begint met re_)
//   AFZENDER_ADRES     — info@ethscoritobbq.com
//   AFZENDER_NAAM      — optioneel, standaard "ETH Scorito BBQ"
//   ANTWOORD_ADRES     — jouw eigen gmail; hier komen antwoorden binnen
//   LOGO_URL           — optioneel; standaard https://ethscoritobbq.com/eth.png
import { getStore } from "@netlify/blobs";
import { stuurIndividueel } from "./_resend.js";

// --- Uiterlijk: pas deze drie kleuren aan als je een andere huisstijl wilt ---
const KLEUR_BALK = "#1a2e05";   // donkere kopbalk
const KLEUR_ACCENT = "#84cc16"; // accentlijn onder de kop
const KLEUR_TEKST = "#1f2937";  // broodtekst

const escapeHtml = (s) => String(s)
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");

// Losse http(s)-adressen klikbaar maken. Draait ná escapeHtml, dus op tekst waarin
// < > & " al onschadelijk zijn; de URL zelf kan daardoor geen HTML injecteren.
// Sluitende leestekens laten we buiten de link (anders plakt een punt eraan vast).
function linkjes(veiligeTekst) {
  return veiligeTekst.replace(/https?:\/\/[^\s<]+[^\s<.,;:!?)\]]/g, (url) =>
    `<a href="${url}" style="color:#4d7c0f;text-decoration:underline;">${url}</a>`);
}

// Platte tekst uit de app omzetten naar nette HTML-alinea's.
function tekstNaarHtml(tekst) {
  return String(tekst)
    .split(/\n{2,}/)
    .map(blok => `<p style="margin:0 0 16px 0;">${linkjes(escapeHtml(blok)).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

export function bouwHtml({ tekst, logoUrl, afzenderNaam }) {
  return `<!DOCTYPE html>
<html lang="nl">
<body style="margin:0;padding:0;background:#f3f4f6;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">

        <tr>
          <td align="center" style="background:${KLEUR_BALK};padding:24px;">
            <img src="${logoUrl}" alt="${escapeHtml(afzenderNaam)}" width="120"
                 style="display:block;border:0;max-width:120px;height:auto;">
          </td>
        </tr>
        <tr><td style="height:4px;background:${KLEUR_ACCENT};font-size:0;line-height:0;">&nbsp;</td></tr>

        <tr>
          <td style="padding:28px 32px;color:${KLEUR_TEKST};font-size:16px;line-height:1.6;">
            ${tekstNaarHtml(tekst)}
          </td>
        </tr>

        <tr>
          <td style="padding:18px 32px;border-top:1px solid #e5e7eb;color:#6b7280;font-size:12px;line-height:1.5;">
            Verstuurd vanuit ${escapeHtml(afzenderNaam)} &middot;
            <a href="https://ethscoritobbq.com" style="color:#4d7c0f;text-decoration:none;">ethscoritobbq.com</a>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

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
  const logoUrl = process.env.LOGO_URL || "https://ethscoritobbq.com/eth.png";

  if (!apiKey || !afzenderAdres) {
    return Response.json({
      fout: "Mail is nog niet ingesteld. Zet RESEND_API_KEY en AFZENDER_ADRES in Netlify → Site configuration → Environment variables."
    }, { status: 500 });
  }

  const afzender = `${afzenderNaam} <${afzenderAdres}>`;

  let body;
  try { body = await req.json(); } catch { body = null; }
  // "modus" (bcc/aan) uit oudere frontends wordt bewust genegeerd.
  const { ontvangers, onderwerp, tekst, naarAdmin } = body || {};

  if (!onderwerp || !tekst) {
    return Response.json({ fout: "Onvolledige mail (onderwerp of tekst ontbreekt)." }, { status: 400 });
  }

  let geldig;
  if (naarAdmin) {
    // Afrekening/overzicht naar de beheerder zelf — geen deelnemerscontrole nodig.
    geldig = [antwoordAdres || afzenderAdres];
  } else {
    if (!Array.isArray(ontvangers) || !ontvangers.length) {
      return Response.json({ fout: "Geen ontvangers opgegeven." }, { status: 400 });
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
    geldig = ontvangers
      .map(e => String(e).trim())
      .filter(e => bekend.has(e.toLowerCase()));

    if (!geldig.length) {
      return Response.json({ fout: "Geen van de ontvangers staat als deelnemer in de poule." }, { status: 400 });
    }
  }

  // --- versturen: één eigen mail per ontvanger ---
  try {
    const res = await stuurIndividueel({
      apiKey,
      van: afzender,
      afzenderAdres,
      antwoordAdres,
      onderwerp,
      tekst,                                             // fallback voor tekst-only clients
      html: bouwHtml({ tekst, logoUrl, afzenderNaam }),  // opgemaakte versie
      ontvangers: geldig
    });

    console.log("Mail verstuurd:", { via: res.via, gelukt: res.gelukt.length, mislukt: res.mislukt });

    if (!res.gelukt.length) {
      return Response.json({ fout: res.eersteFout || "Versturen mislukt.", mislukt: res.mislukt }, { status: 500 });
    }

    const waarschuwing = res.mislukt.length
      ? `Niet verstuurd naar ${res.mislukt.length} van ${geldig.length} adres(sen): ${res.mislukt.map(m => m.adres).join(", ")} (${res.eersteFout})`
      : undefined;

    return Response.json({
      ok: true,
      aantal: res.gelukt.length,
      afzender: naarAdmin ? geldig[0] : afzenderAdres,
      mislukt: res.mislukt,
      waarschuwing
    });
  } catch (e) {
    return Response.json({ fout: String((e && e.message) || e) }, { status: 500 });
  }
};
