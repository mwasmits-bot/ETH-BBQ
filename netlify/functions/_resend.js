// Gedeelde mailverzending via de Resend REST-API. Elke ontvanger krijgt een EIGEN mail
// (alleen dat adres in "to") — één mail met iedereen in BCC wordt door Gmail als bulk
// gezien en afgeremd (421-4.7.28 "unusual rate of mail").
//
// Eerst alles in één request via de Batch API (snel genoeg voor de Netlify-timeout);
// valt dat om wat voor reden dan ook af, dan een lus met een korte pauze per mail
// (Resend laat standaard ~2 requests/seconde toe). Faalt een deel, dan mislukt niet het
// geheel: je krijgt terug wie gelukt is en welke adressen faalden.
const API = "https://api.resend.com";
const BATCH_MAX = 100;
const PAUZE_MS = 600;
const TIJDBUDGET_MS = 8500;                 // Netlify-functions stoppen standaard na ~10 s
const UNSUBSCRIBE = "<mailto:info@ethscoritobbq.com>";

const wacht = (ms) => new Promise((r) => setTimeout(r, ms));

function koppen(apiKey, extra = {}) {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "User-Agent": "eth-scorito-bbq/1.0",
    ...extra
  };
}

async function resendPost(pad, apiKey, body, extraKoppen) {
  try {
    const r = await fetch(API + pad, { method: "POST", headers: koppen(apiKey, extraKoppen), body: JSON.stringify(body) });
    const json = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, json };
  } catch (e) {
    return { ok: false, status: 0, json: { message: String((e && e.message) || e) } };
  }
}

export function vriendelijkeFout(res, afzenderAdres) {
  const naam = String((res.json && res.json.name) || "");
  const tekst = String((res.json && res.json.message) || "");
  const alles = `${naam} ${tekst}`;
  if (/invalid_api_key|missing_api_key|restricted_api_key/i.test(naam) || (res.status === 401)) {
    return "Resend weigert de login. Controleer of RESEND_API_KEY klopt (begint met re_) en of de key nog actief is.";
  }
  if (/domain|not verified/i.test(alles)) return `Het domein van ${afzenderAdres} is nog niet geverifieerd in Resend.`;
  if (/quota/i.test(naam)) return "Daglimiet van Resend bereikt (100 mails/dag op de gratis tier). Probeer het morgen opnieuw.";
  if (res.status === 429 || /rate/i.test(naam)) return "Resend remt het versturen af (te veel mails te snel). Probeer het over een minuut opnieuw.";
  return tekst || (res.status ? `Resend gaf een fout (${res.status}).` : "Resend is niet bereikbaar.");
}

// opties: { apiKey, van, antwoordAdres, onderwerp, tekst, html, ontvangers[], afzenderAdres,
//           tijdBudgetMs, pauzeMs }
// Geeft ALTIJD een resultaat (gooit nooit): { gelukt: [adres], mislukt: [{adres, fout}],
// eersteFout, via: "batch" | "losse mails" }
export async function stuurIndividueel(o) {
  const start = Date.now();
  const budget = o.tijdBudgetMs ?? TIJDBUDGET_MS;
  const pauze = o.pauzeMs ?? PAUZE_MS;
  const adressen = [...new Set((o.ontvangers || []).map((e) => String(e || "").trim()).filter(Boolean))];

  const maakMail = (adres) => ({
    from: o.van,
    to: [adres],
    subject: o.onderwerp,
    text: o.tekst,
    html: o.html,
    ...(o.antwoordAdres ? { reply_to: o.antwoordAdres } : {}),
    headers: { "List-Unsubscribe": UNSUBSCRIBE }
  });

  const gelukt = [];
  const mislukt = [];
  let eersteFout = "";
  const faal = (adres, res) => {
    const fout = vriendelijkeFout(res, o.afzenderAdres);
    if (!eersteFout) eersteFout = fout;
    mislukt.push({ adres, fout });
  };

  // Lus: één mail per request, met pauze. Houdt het tijdbudget in de gaten.
  const lus = async (lijst) => {
    for (let i = 0; i < lijst.length; i++) {
      const adres = lijst[i];
      if (Date.now() - start > budget) {
        for (const rest of lijst.slice(i)) {
          const fout = "niet verstuurd: tijdslimiet bereikt";
          if (!eersteFout) eersteFout = fout;
          mislukt.push({ adres: rest, fout });
        }
        return;
      }
      let res = await resendPost("/emails", o.apiKey, maakMail(adres));
      if (res.status === 429 && Date.now() - start < budget) {
        await wacht(pauze + 500);
        res = await resendPost("/emails", o.apiKey, maakMail(adres));
      }
      if (res.ok) gelukt.push(adres); else faal(adres, res);
      if (i < lijst.length - 1) await wacht(pauze);
    }
  };

  let via = "losse mails";
  if (adressen.length > 1) {
    via = "batch";
    for (let i = 0; i < adressen.length; i += BATCH_MAX) {
      const stuk = adressen.slice(i, i + BATCH_MAX);
      const res = await resendPost("/emails/batch", o.apiKey, stuk.map(maakMail), { "x-batch-validation": "permissive" });
      if (res.ok) {
        // permissive: weigert Resend losse mails, dan staan die (met index) in "errors".
        const fouten = Array.isArray(res.json && res.json.errors) ? res.json.errors : [];
        const geweigerd = new Set(fouten.map((f) => f.index));
        stuk.forEach((adres, idx) => { if (!geweigerd.has(idx)) gelukt.push(adres); });
        fouten.forEach((f) => {
          const fout = vriendelijkeFout({ status: 422, json: { message: f.message } }, o.afzenderAdres);
          if (!eersteFout) eersteFout = fout;
          if (stuk[f.index] !== undefined) mislukt.push({ adres: stuk[f.index], fout });
        });
      } else {
        // Batch afgewezen (bv. één ongeldig adres, rate limit): terugvallen op losse mails.
        via = "losse mails";
        await lus(stuk);
      }
    }
  } else {
    await lus(adressen);
  }

  return { gelukt, mislukt, eersteFout, via };
}
