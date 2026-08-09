// Geplande sanity check op wedstrijden waar weddenschappen op lopen.
//
// Ruim na de aftrap (3 uur) en nog geen uitslag? Dan wordt die wedstrijd apart
// hercontroleerd via /matches/{id} — een eigen endpoint, zonder onze cache. Zegt de
// bron daar wél "afgelopen", dan gooien we de speelronde-cache weg zodat de app de
// echte uitslag meteen laat zien; het probleem lost zichzelf dus op.
//
// Blijft ook de directe call hangen, dan volgt een mail. De uitslag wordt NOOIT
// geraden — dan zet de beheerder hem handmatig (Side Bets -> wedstrijd -> uitkomst).
//
// Draait elk uur; Netlify roept dit aan via de schedule-export onderaan.
import { getStore } from "@netlify/blobs";
import { haalSpeelronde, hercontroleerWedstrijd, vergeetSpeelrondeCache } from "./_football.js";
import { meldAdmin } from "./_notify.js";

const MARGE_MS = 3 * 60 * 60 * 1000;   // ~3 uur na aftrap zou een duel klaar moeten zijn

export default async () => {
  const store = getStore("eth-scorito-bbq");

  try {
    const sb = (await store.get("sidebets", { type: "json" })) || {};
    const weddenschappen = sb.weddenschappen || [];
    const handmatig = sb.uitslagen || {};

    // Alleen wedstrijden waar echt geld op staat: gematchte, nog niet afgerekende bets.
    const relevant = new Map();
    weddenschappen.forEach(w => {
      if (!w.tegenstander || w.afgerekend) return;
      if (handmatig[String(w.matchId)]) return;         // beheerder heeft al ingegrepen
      const lijst = relevant.get(w.matchId) || [];
      lijst.push(w);
      relevant.set(w.matchId, lijst);
    });
    if (!relevant.size) return new Response("niets te controleren", { status: 200 });

    // Speelrondes ophalen waar die wedstrijden in zitten (meestal maar één).
    const rondes = [...new Set([...relevant.values()].flat().map(w => w.speelronde).filter(Boolean))];
    const wedstrijden = new Map();
    for (const ronde of (rondes.length ? rondes : [null])) {
      const data = await haalSpeelronde(store, ronde);
      (data.wedstrijden || []).forEach(m => wedstrijden.set(m.id, m));
    }

    const nu = Date.now();
    const vast = [];
    const hersteld = [];
    for (const [matchId, bets] of relevant) {
      const m = wedstrijden.get(matchId);
      if (!m) continue;
      const begonnen = new Date(m.aftrap).getTime();
      if (nu - begonnen < MARGE_MS) continue;           // nog te vroeg om raar te zijn
      if (m.status === "FINISHED" && m.uitkomst) continue;

      // Sanity check: dezelfde wedstrijd rechtstreeks opvragen, zonder cache.
      let direct = null;
      try {
        direct = await hercontroleerWedstrijd(matchId);
      } catch (e) {
        console.error("Hercontrole mislukt voor", matchId, e && e.message || e);
      }

      if (direct && direct.status === "FINISHED" && direct.uitkomst) {
        // De bron weet het wél — onze kopie was verouderd. Cache weggooien is genoeg:
        // de app haalt dan zelf de volledige uitslag op, inclusief doelpunten.
        await vergeetSpeelrondeCache(store, bets[0] && bets[0].speelronde);
        hersteld.push({ m: direct, aantal: bets.length });
        continue;
      }

      const status = direct ? direct.status : m.status;
      vast.push({ m, status, aantal: bets.length, inzet: bets.reduce((n, w) => n + (w.inzet || 0), 0) });
    }

    if (hersteld.length) {
      const regels = hersteld.map(v => `• ${v.m.thuis} ${v.m.thuisDoelpunten}-${v.m.uitDoelpunten} ${v.m.uit} (${v.aantal} weddenschap(pen))`);
      await meldAdmin(
        `Side Bets: ${hersteld.length} uitslag(en) alsnog opgehaald`,
        `Deze wedstrijden stonden nog op "nog te spelen" terwijl ze al gespeeld waren. Bij een directe hercontrole gaf football-data.org wél een uitslag, en die staat nu in de app:\n\n${regels.join("\n")}\n\nJe hoeft niets te doen.`
      );
    }

    if (!vast.length) return new Response(`alles bijgewerkt (hersteld: ${hersteld.length})`, { status: 200 });

    // Niet elk uur opnieuw mailen over dezelfde wedstrijd.
    const gemeld = (await store.get("wedstrijdcheck-gemeld", { type: "json" })) || {};
    const nieuw = vast.filter(v => !gemeld[v.m.id]);
    if (!nieuw.length) return new Response("al gemeld", { status: 200 });

    const regels = nieuw.map(v =>
      `• ${v.m.thuis} - ${v.m.uit} (aftrap ${new Date(v.m.aftrap).toLocaleString("nl-NL")}) — status ${v.status}, ${v.aantal} weddenschap(pen), €${v.inzet} inzet`
    );
    await meldAdmin(
      `Side Bets: ${nieuw.length} wedstrijd(en) zonder uitslag`,
      `Deze wedstrijden zijn ruim afgelopen, maar football-data.org geeft ook bij een directe hercontrole nog geen uitslag:\n\n${regels.join("\n")}\n\n` +
      `Blijft dit hangen, zet de uitslag dan handmatig in de app: Side Bets -> de wedstrijd -> kies de uitkomst. ` +
      `Komt de API alsnog bij, dan hoef je niets te doen — deze controle draait elk uur.`
    );

    nieuw.forEach(v => { gemeld[v.m.id] = new Date().toISOString(); });
    // Oude meldingen (> 30 dagen) opruimen zodat dit niet eindeloos groeit.
    const grens = nu - 30 * 24 * 60 * 60 * 1000;
    Object.keys(gemeld).forEach(k => { if (new Date(gemeld[k]).getTime() < grens) delete gemeld[k]; });
    await store.setJSON("wedstrijdcheck-gemeld", gemeld);

    return new Response(`gemeld: ${nieuw.length}`, { status: 200 });
  } catch (e) {
    console.error("Wedstrijdcheck-fout:", e && e.message || e);
    return new Response("fout: " + (e && e.message || e), { status: 500 });
  }
};

export const config = { schedule: "@hourly" };
