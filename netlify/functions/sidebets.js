// Side Bets — onderlinge weddenschappen tussen deelnemers.
// Plaatsen als: netlify/functions/sidebets.js
//
// GET  -> alle weddenschappen + instellingen
// POST -> { actie: 'plaats' | 'haak' | 'intrek' | 'instellingen' | 'betaald' | 'afgerekend', ... }
//
// Deelnemers schrijven met hun eigen wachtwoord (uit data.teams), admin met ADMIN_WACHTWOORD.
// Alle controles gebeuren serverside: een aangepaste frontend kan de regels niet omzeilen.
import { getStore } from "@netlify/blobs";

const MAX_INZET = 100;
const KEUZES = ["thuis", "gelijk", "uit"];

const leegSchema = () => ({ actief: false, bunqNaam: "", uitbetaal: {}, weddenschappen: [] });

function nieuwId() {
  return "b" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export default async (req) => {
  const store = getStore("eth-scorito-bbq");
  const isAdmin = !!process.env.ADMIN_WACHTWOORD &&
    (req.headers.get("x-wachtwoord") || "") === process.env.ADMIN_WACHTWOORD;

  const laad = async () => {
    const s = await store.get("sidebets", { type: "json" });
    return { ...leegSchema(), ...(s || {}) };
  };

  if (req.method === "GET") {
    const sb = await laad();
    // Uitbetaalgegevens (IBAN's!) nooit publiek meesturen — alleen de namen
    // van wie iets ingevuld heeft, zodat de app kan tonen wie nog moet.
    const { uitbetaal, ...publiek } = sb;
    publiek.heeftUitbetaal = Object.keys(uitbetaal || {});
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

  function controleerDeelnemer(naam, wachtwoord) {
    if (isAdmin) return null;                       // admin mag namens iedereen
    if (!naam || !teams[naam]) return "Deze deelnemer bestaat niet in de poule.";
    const ingesteld = teams[naam].wachtwoord || "";
    if (ingesteld && String(wachtwoord || "") !== ingesteld) return "Wachtwoord klopt niet.";
    return null;
  }

  const bewaar = async () => { await store.set("sidebets", JSON.stringify(sb)); };
  const schoonAntwoord = (o) => { const { uitbetaal, ...p } = o; p.heeftUitbetaal = Object.keys(uitbetaal || {}); return p; };

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

    // ================= EIGEN UITBETAALGEGEVENS =================
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
