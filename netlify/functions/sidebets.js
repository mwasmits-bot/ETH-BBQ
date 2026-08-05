// Side Bets — onderlinge weddenschappen tussen deelnemers.
// Plaatsen als: netlify/functions/sidebets.js
//
// GET  -> alle weddenschappen + instellingen
// POST -> { actie: 'plaats' | 'haak' | 'intrek' | 'instellingen' | 'betaald' | 'afgerekend', ... }
//
// Deelnemers schrijven met hun eigen wachtwoord (uit data.teams), admin met ADMIN_WACHTWOORD.
// Alle controles gebeuren serverside: een aangepaste frontend kan de regels niet omzeilen.
import { getStore } from "@netlify/blobs";
import { meldAdmin } from "./_notify.js";

const MAX_INZET = 100;
const KEUZES = ["thuis", "gelijk", "uit"];

const leegSchema = () => ({ actief: false, bunqNaam: "", uitbetaal: {}, weddenschappen: [], seizoen: { actief: false, inleg: 20, aangemeld: {}, betaald: {}, winnaar: null }, eindstand: { actief: false, inleg: 10, kandidaten: [], voorspellingen: {}, betaald: {}, kampioen: null, laatste: null } });

function nieuwId() {
  return "b" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export default async (req) => {
  const store = getStore("eth-scorito-bbq");
  const isAdmin = !!process.env.ADMIN_WACHTWOORD &&
    (req.headers.get("x-wachtwoord") || "") === process.env.ADMIN_WACHTWOORD;

  // Eindstand-picks pas tonen als de uitslag vaststaat (of aan de admin) — voorkomt afkijken.
  const eindstandPubliek = (e) => {
    if (!e) return e;
    const voorspeldDoor = Object.keys(e.voorspellingen || {});
    const locked = !!(e.kampioen && e.laatste);
    if (isAdmin || locked) return { ...e, voorspeldDoor };
    return { ...e, voorspellingen: {}, voorspeldDoor };
  };

  const laad = async () => {
    const s = await store.get("sidebets", { type: "json" });
    const basis = leegSchema();
    const sb = { ...basis, ...(s || {}) };
    sb.seizoen = { ...basis.seizoen, ...(sb.seizoen || {}) };
    sb.eindstand = { ...basis.eindstand, ...(sb.eindstand || {}) };
    return sb;
  };

  if (req.method === "GET") {
    const sb = await laad();
    // Uitbetaalgegevens (IBAN's!) nooit publiek meesturen — alleen de namen
    // van wie iets ingevuld heeft, zodat de app kan tonen wie nog moet.
    const { uitbetaal, ...publiek } = sb;
    publiek.heeftUitbetaal = Object.keys(uitbetaal || {});
    publiek.eindstand = eindstandPubliek(publiek.eindstand);
    return Response.json(publiek, { headers: { "cache-control": "no-store" } });
  }

  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  let body;
  try { body = await req.json(); } catch { body = null; }
  if (!body || !body.actie) return Response.json({ fout: "Geen actie opgegeven." }, { status: 400 });

  const sb = await laad();

  // --- deelnemer identificeren (voor niet-admin acties) ---
  const poule = await store.get("poule", { type: "json" });
  const teams = (poule && poule.teams) || {};
  const orakelVs = (await store.get("orakel", { type: "json" })) || {};
  const orakelNamenLc = new Set(Object.keys(orakelVs).map(k => String(k).trim().toLowerCase()));
  const deedOrakel = (naam) => orakelNamenLc.has(String(naam || "").trim().toLowerCase());

  function controleerDeelnemer(naam, wachtwoord) {
    if (isAdmin) return null;                       // admin mag namens iedereen
    if (!naam || !teams[naam]) return "Deze deelnemer bestaat niet in de poule.";
    const ingesteld = teams[naam].wachtwoord || "";
    if (ingesteld && String(wachtwoord || "") !== ingesteld) return "Wachtwoord klopt niet.";
    return null;
  }

  const bewaar = async () => { await store.set("sidebets", JSON.stringify(sb)); };
  const schoonAntwoord = (o) => { const { uitbetaal, ...p } = o; p.heeftUitbetaal = Object.keys(uitbetaal || {}); p.eindstand = eindstandPubliek(p.eindstand); return p; };

  try {
    // ================= ADMIN-ACTIES =================
    if (["instellingen", "betaald", "afgerekend", "verwijder"].includes(body.actie)) {
      if (!isAdmin) return Response.json({ fout: "Alleen de beheerder kan dit." }, { status: 401 });

      if (body.actie === "instellingen") {
        if (typeof body.actief === "boolean") sb.actief = body.actief;
        if (typeof body.bunqNaam === "string") sb.bunqNaam = body.bunqNaam.trim();
      }

      if (body.actie === "betaald") {
        const w = sb.weddenschappen.find(x => x.id === body.id);
        if (!w) return Response.json({ fout: "Weddenschap niet gevonden." }, { status: 404 });
        if (body.wie === "uitdager") w.betaaldUitdager = !!body.waarde;
        if (body.wie === "tegenstander") w.betaaldTegenstander = !!body.waarde;
      }

      if (body.actie === "afgerekend") {
        const w = sb.weddenschappen.find(x => x.id === body.id);
        if (!w) return Response.json({ fout: "Weddenschap niet gevonden." }, { status: 404 });
        w.afgerekend = !!body.waarde;
      }

      if (body.actie === "verwijder") {
        sb.weddenschappen = sb.weddenschappen.filter(x => x.id !== body.id);
      }

      await bewaar();
      return Response.json({ ok: true, sidebets: schoonAntwoord(sb) });
    }

    // ============= SEIZOEN — ADMIN =============
    if (["seizoen-instellingen", "seizoen-betaald", "seizoen-winnaar"].includes(body.actie)) {
      if (!isAdmin) return Response.json({ fout: "Alleen de beheerder kan dit." }, { status: 401 });

      if (body.actie === "seizoen-instellingen") {
        if (typeof body.actief === "boolean") sb.seizoen.actief = body.actief;
        if (body.inleg !== undefined) {
          const n = parseInt(body.inleg, 10);
          if (Number.isInteger(n) && n >= 1 && n <= 1000) sb.seizoen.inleg = n;
        }
      }

      if (body.actie === "seizoen-betaald") {
        const naam = String(body.naam || "").trim();
        if (!naam) return Response.json({ fout: "Geen naam opgegeven." }, { status: 400 });
        if (body.waarde) { sb.seizoen.betaald[naam] = true; sb.seizoen.aangemeld[naam] = true; }
        else { delete sb.seizoen.betaald[naam]; }
      }

      if (body.actie === "seizoen-winnaar") {
        const naam = body.naam ? String(body.naam).trim() : null;
        if (naam && !sb.seizoen.betaald[naam]) {
          return Response.json({ fout: "Alleen een deelnemer die de inleg heeft betaald kan winnen." }, { status: 400 });
        }
        sb.seizoen.winnaar = naam;
      }

      await bewaar();
      return Response.json({ ok: true, sidebets: schoonAntwoord(sb) });
    }

    // ============= SEIZOEN — DEELNEMER =============
    if (body.actie === "seizoen-doemee") {
      const { deelnemer, wachtwoord } = body;
      const fout = controleerDeelnemer(deelnemer, wachtwoord);
      if (fout) return Response.json({ fout }, { status: 401 });
      if (!sb.seizoen.actief && !isAdmin) {
        return Response.json({ fout: "De seizoens-sidebet staat nog niet open." }, { status: 403 });
      }
      if (!deedOrakel(deelnemer)) {
        return Response.json({ fout: "Je kunt pas meedoen als je een Eredivisie Orakel-voorspelling hebt ingediend." }, { status: 403 });
      }
      sb.seizoen.aangemeld[String(deelnemer).trim()] = true;
      await bewaar();
      return Response.json({ ok: true, sidebets: schoonAntwoord(sb) });
    }

    if (body.actie === "seizoen-afmelden") {
      const { deelnemer, wachtwoord } = body;
      const fout = controleerDeelnemer(deelnemer, wachtwoord);
      if (fout) return Response.json({ fout }, { status: 401 });
      const naam = String(deelnemer || "").trim();
      if (sb.seizoen.betaald[naam] && !isAdmin) {
        return Response.json({ fout: "Je inleg is al bevestigd — vraag de beheerder om je af te melden." }, { status: 400 });
      }
      delete sb.seizoen.aangemeld[naam];
      await bewaar();
      return Response.json({ ok: true, sidebets: schoonAntwoord(sb) });
    }

    // ============= EINDSTAND (kampioen + bbq-loser) — ADMIN =============
    if (["eindstand-instellingen", "eindstand-betaald", "eindstand-uitslag"].includes(body.actie)) {
      if (!isAdmin) return Response.json({ fout: "Alleen de beheerder kan dit." }, { status: 401 });

      if (body.actie === "eindstand-instellingen") {
        if (typeof body.actief === "boolean") sb.eindstand.actief = body.actief;
        if (body.inleg !== undefined) {
          const n = parseInt(body.inleg, 10);
          if (Number.isInteger(n) && n >= 1 && n <= 1000) sb.eindstand.inleg = n;
        }
        if (Array.isArray(body.kandidaten)) {
          sb.eindstand.kandidaten = body.kandidaten.map(x => String(x).trim()).filter(Boolean).slice(0, 64);
        }
      }

      if (body.actie === "eindstand-betaald") {
        const naam = String(body.naam || "").trim();
        if (!naam) return Response.json({ fout: "Geen naam opgegeven." }, { status: 400 });
        if (body.waarde) sb.eindstand.betaald[naam] = true;
        else delete sb.eindstand.betaald[naam];
      }

      if (body.actie === "eindstand-uitslag") {
        const kand = sb.eindstand.kandidaten || [];
        const k = body.kampioen ? String(body.kampioen).trim() : null;
        const l = body.laatste ? String(body.laatste).trim() : null;
        if (k && !kand.includes(k)) return Response.json({ fout: "Kampioen staat niet in de kandidatenlijst." }, { status: 400 });
        if (l && !kand.includes(l)) return Response.json({ fout: "Laatste staat niet in de kandidatenlijst." }, { status: 400 });
        sb.eindstand.kampioen = k;
        sb.eindstand.laatste = l;
      }

      await bewaar();
      return Response.json({ ok: true, sidebets: schoonAntwoord(sb) });
    }

    // ============= EINDSTAND — DEELNEMER =============
    if (body.actie === "eindstand-voorspel") {
      const { deelnemer, wachtwoord, kampioen, laatste } = body;
      const fout = controleerDeelnemer(deelnemer, wachtwoord);
      if (fout) return Response.json({ fout }, { status: 401 });
      if (!sb.eindstand.actief && !isAdmin) {
        return Response.json({ fout: "De eindstand-bet staat nog niet open." }, { status: 403 });
      }
      if ((sb.eindstand.kampioen || sb.eindstand.laatste) && !isAdmin) {
        return Response.json({ fout: "De uitslag is al bekend — voorspellen kan niet meer." }, { status: 400 });
      }
      const kand = sb.eindstand.kandidaten || [];
      const k = String(kampioen || "").trim();
      const l = String(laatste || "").trim();
      if (!kand.includes(k) || !kand.includes(l)) {
        return Response.json({ fout: "Kies een geldige kampioen én laatste uit de lijst." }, { status: 400 });
      }
      if (k === l) {
        return Response.json({ fout: "Kampioen en laatste moeten verschillende deelnemers zijn." }, { status: 400 });
      }
      sb.eindstand.voorspellingen[String(deelnemer).trim()] = { kampioen: k, laatste: l };
      await bewaar();
      return Response.json({ ok: true, sidebets: schoonAntwoord(sb) });
    }
    // Vrij veld: bunq.me-naam, een betaalverzoek-link (Tikkie/ING/Rabo) of IBAN.
    if (body.actie === "betaalnaam") {
      const { deelnemer, wachtwoord } = body;
      const fout = controleerDeelnemer(deelnemer, wachtwoord);
      if (fout) return Response.json({ fout }, { status: 401 });
      if (!deelnemer) return Response.json({ fout: "Geen deelnemer opgegeven." }, { status: 400 });
      if (!sb.uitbetaal) sb.uitbetaal = {};
      const schoon = String(body.gegevens ?? body.bunqNaam ?? "").trim().slice(0, 120);
      if (schoon) sb.uitbetaal[deelnemer] = schoon;
      else delete sb.uitbetaal[deelnemer];
      await bewaar();
      const { uitbetaal, ...publiek } = sb;
      publiek.heeftUitbetaal = Object.keys(uitbetaal || {});
      return Response.json({ ok: true, sidebets: publiek, eigen: schoon });
    }

    // Uitbetaalgegevens opvragen: admin krijgt alles, een speler alleen zichzelf.
    if (body.actie === "haalbetaalgegevens") {
      const { deelnemer, wachtwoord } = body;
      if (isAdmin) return Response.json({ ok: true, uitbetaal: sb.uitbetaal || {} });
      const fout = controleerDeelnemer(deelnemer, wachtwoord);
      if (fout) return Response.json({ fout }, { status: 401 });
      const eigen = (sb.uitbetaal || {})[deelnemer] || "";
      return Response.json({ ok: true, uitbetaal: eigen ? { [deelnemer]: eigen } : {} });
    }

    // ================= UITDAGING PLAATSEN =================
    if (body.actie === "plaats") {
      const { deelnemer, wachtwoord, wedstrijd, keuze, inzet } = body;

      const fout = controleerDeelnemer(deelnemer, wachtwoord);
      if (fout) return Response.json({ fout }, { status: 401 });

      if (!sb.actief && !isAdmin) {
        return Response.json({ fout: "Side Bets staat nog niet open." }, { status: 403 });
      }
      if (!KEUZES.includes(keuze)) {
        return Response.json({ fout: "Ongeldige keuze." }, { status: 400 });
      }
      const bedrag = Number(inzet);
      if (!Number.isInteger(bedrag) || bedrag < 1 || bedrag > MAX_INZET) {
        return Response.json({ fout: `Inzet moet een heel bedrag zijn tussen €1 en €${MAX_INZET}.` }, { status: 400 });
      }
      if (!wedstrijd || !wedstrijd.id || !wedstrijd.aftrap) {
        return Response.json({ fout: "Wedstrijdgegevens ontbreken." }, { status: 400 });
      }
      if (new Date(wedstrijd.aftrap).getTime() <= Date.now()) {
        return Response.json({ fout: "Deze wedstrijd is al begonnen — inzetten is gesloten." }, { status: 400 });
      }

      // Niet twee open uitdagingen van dezelfde persoon op dezelfde wedstrijd
      const alOpen = sb.weddenschappen.some(w =>
        w.matchId === wedstrijd.id && w.uitdager === deelnemer && !w.tegenstander
      );
      if (alOpen) {
        return Response.json({ fout: "Je hebt al een openstaande uitdaging op deze wedstrijd." }, { status: 400 });
      }

      sb.weddenschappen.push({
        id: nieuwId(),
        matchId: wedstrijd.id,
        speelronde: wedstrijd.speelronde || null,
        thuis: wedstrijd.thuis,
        uit: wedstrijd.uit,
        aftrap: wedstrijd.aftrap,
        uitdager: deelnemer,
        keuzeUitdager: keuze,
        inzet: bedrag,
        tegenstander: null,
        keuzeTegenstander: null,
        gemaakt: new Date().toISOString(),
        gematchtOp: null,
        betaaldUitdager: false,
        betaaldTegenstander: false,
        afgerekend: false
      });

      await bewaar();
      await meldAdmin(
        `Side bet: nieuwe uitdaging van ${deelnemer}`,
        `${deelnemer} heeft €${bedrag} ingezet op "${keuze}" bij ${wedstrijd.thuis} - ${wedstrijd.uit}.`
      );
      return Response.json({ ok: true, sidebets: schoonAntwoord(sb) });
    }

    // ================= AANHAKEN =================
    if (body.actie === "haak") {
      const { deelnemer, wachtwoord, id, keuze } = body;

      const fout = controleerDeelnemer(deelnemer, wachtwoord);
      if (fout) return Response.json({ fout }, { status: 401 });

      if (!sb.actief && !isAdmin) {
        return Response.json({ fout: "Side Bets staat nog niet open." }, { status: 403 });
      }

      const w = sb.weddenschappen.find(x => x.id === id);
      if (!w) return Response.json({ fout: "Deze uitdaging bestaat niet meer." }, { status: 404 });
      if (w.tegenstander) return Response.json({ fout: "Iemand anders was je net voor — deze uitdaging is al vergeven." }, { status: 409 });
      if (!w.betaaldUitdager) return Response.json({ fout: "Deze uitdaging staat nog niet vast — de inzet is nog niet bevestigd." }, { status: 403 });
      if (w.uitdager === deelnemer) return Response.json({ fout: "Je kunt niet tegen jezelf wedden." }, { status: 400 });
      if (!KEUZES.includes(keuze)) return Response.json({ fout: "Ongeldige keuze." }, { status: 400 });
      if (keuze === w.keuzeUitdager) return Response.json({ fout: "Je moet een andere uitkomst kiezen dan je tegenstander." }, { status: 400 });
      if (new Date(w.aftrap).getTime() <= Date.now()) {
        return Response.json({ fout: "Deze wedstrijd is al begonnen — inzetten is gesloten." }, { status: 400 });
      }

      w.tegenstander = deelnemer;
      w.keuzeTegenstander = keuze;
      w.gematchtOp = new Date().toISOString();

      await bewaar();
      await meldAdmin(
        `Side bet: ${deelnemer} haakt aan bij ${w.uitdager}`,
        `${deelnemer} heeft de uitdaging van ${w.uitdager} (€${w.inzet}, ${w.thuis} - ${w.uit}) aangenomen met keuze "${keuze}".`
      );
      return Response.json({ ok: true, sidebets: schoonAntwoord(sb) });
    }

    // ================= EIGEN UITDAGING INTREKKEN =================
    if (body.actie === "intrek") {
      const { deelnemer, wachtwoord, id } = body;

      const fout = controleerDeelnemer(deelnemer, wachtwoord);
      if (fout) return Response.json({ fout }, { status: 401 });

      const w = sb.weddenschappen.find(x => x.id === id);
      if (!w) return Response.json({ fout: "Uitdaging niet gevonden." }, { status: 404 });
      if (!isAdmin && w.uitdager !== deelnemer) {
        return Response.json({ fout: "Je kunt alleen je eigen uitdaging intrekken." }, { status: 403 });
      }
      if (w.tegenstander) {
        return Response.json({ fout: "Er is al iemand aangehaakt — intrekken kan niet meer. Vraag de beheerder." }, { status: 400 });
      }

      sb.weddenschappen = sb.weddenschappen.filter(x => x.id !== id);
      await bewaar();
      return Response.json({ ok: true, sidebets: schoonAntwoord(sb) });
    }

    return Response.json({ fout: "Onbekende actie." }, { status: 400 });

  } catch (e) {
    console.error("Sidebets-fout:", e);
    return Response.json({ fout: String(e && e.message || e) }, { status: 500 });
  }
};
