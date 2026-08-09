// Geplande controle: signaleert wedstrijden waar weddenschappen op lopen terwijl
// football-data.org ruim na de aftrap nog steeds geen uitslag geeft.
//
// De uitslag zelf wordt NOOIT geraden — er wordt alleen gemaild dat je hem handmatig
// moet zetten (Side Bets -> wedstrijd -> "uitslag handmatig"). Zodra de API alsnog
// bijwerkt, pikt de app dat vanzelf op en is er niets te doen.
//
// Draait elk uur; Netlify roept dit aan via de schedule-export onderaan.
import { getStore } from "@netlify/blobs";
import { haalSpeelronde } from "./_football.js";
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
    for (const [matchId, bets] of relevant) {
      const m = wedstrijden.get(matchId);
      if (!m) continue;
      const begonnen = new Date(m.aftrap).getTime();
      if (nu - begonnen < MARGE_MS) continue;           // nog te vroeg om raar te zijn
      if (m.status === "FINISHED" && m.uitkomst) continue;
      vast.push({ m, aantal: bets.length, inzet: bets.reduce((n, w) => n + (w.inzet || 0), 0) });
    }
    if (!vast.length) return new Response("alles bijgewerkt", { status: 200 });

    // Niet elk uur opnieuw mailen over dezelfde wedstrijd.
    const gemeld = (await store.get("wedstrijdcheck-gemeld", { type: "json" })) || {};
    const nieuw = vast.filter(v => !gemeld[v.m.id]);
    if (!nieuw.length) return new Response("al gemeld", { status: 200 });

    const regels = nieuw.map(v =>
      `• ${v.m.thuis} - ${v.m.uit} (aftrap ${new Date(v.m.aftrap).toLocaleString("nl-NL")}) — status ${v.m.status}, ${v.aantal} weddenschap(pen), €${v.inzet} inzet`
    );
    await meldAdmin(
      `Side Bets: ${nieuw.length} wedstrijd(en) zonder uitslag`,
      `Deze wedstrijden zijn ruim afgelopen, maar football-data.org geeft nog geen uitslag:\n\n${regels.join("\n")}\n\n` +
      `Blijft dit hangen, zet de uitslag dan handmatig in de app: Side Bets -> de wedstrijd -> kies de uitkomst. ` +
      `Komt de API alsnog bij, dan hoef je niets te doen.`
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
