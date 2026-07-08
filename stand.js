// Live eredivisie-stand en topscorers via football-data.org (gratis tier, competitie DED).
// Vereist environment variable FOOTBALL_DATA_KEY (gratis key via football-data.org registratie).
// Resultaten worden 6 uur gecachet (teamlijst 24 uur) zodat je ruim binnen de
// gratis limiet van 10 requests/minuut blijft — hoeveel vrienden er ook kijken.
// ?actie=teams        → teamlijst met logo's (voor het Orakel-formulier)
// ?vernieuw=1 + admin → cache negeren en direct verversen
import { getStore } from "@netlify/blobs";

const UUR = 3600 * 1000;
const FD = "https://api.football-data.org/v4/competitions/DED";

export default async (req) => {
  const url = new URL(req.url);
  const store = getStore("eth-scorito-bbq");
  const key = process.env.FOOTBALL_DATA_KEY;
  const isAdminReq = !!process.env.ADMIN_WACHTWOORD &&
    (req.headers.get("x-wachtwoord") || "") === process.env.ADMIN_WACHTWOORD;

  // ---------- teamlijst met logo's ----------
  if (url.searchParams.get("actie") === "teams") {
    const cache = await store.get("fd-teams", { type: "json" });
    if (cache && Date.now() - cache.tijd < 24 * UUR && !isAdminReq) return Response.json(cache);
    if (!key) return cache ? Response.json(cache)
      : Response.json({ fout: "FOOTBALL_DATA_KEY is niet ingesteld in Netlify." }, { status: 500 });
    const r = await fetch(FD + "/teams", { headers: { "X-Auth-Token": key } });
    if (!r.ok) return cache ? Response.json(cache)
      : Response.json({ fout: "football-data.org gaf een fout (" + r.status + ")." }, { status: 502 });
    const j = await r.json();
    const uit = {
      tijd: Date.now(),
      teams: (j.teams || [])
        .map(t => ({ naam: t.shortName || t.name, logo: t.crest || "" }))
        .sort((a, b) => a.naam.localeCompare(b.naam, "nl"))
    };
    await store.setJSON("fd-teams", uit);
    return Response.json(uit);
  }

  // ---------- stand + topscorers ----------
  const cache = await store.get("fd-stand", { type: "json" });
  const vernieuw = url.searchParams.get("vernieuw") === "1" && isAdminReq;
  if (cache && Date.now() - cache.tijd < 6 * UUR && !vernieuw) return Response.json(cache);
  if (!key) return cache ? Response.json(cache)
    : Response.json({ fout: "FOOTBALL_DATA_KEY is niet ingesteld in Netlify." }, { status: 500 });

  const [rs, rt] = await Promise.all([
    fetch(FD + "/standings", { headers: { "X-Auth-Token": key } }),
    fetch(FD + "/scorers?limit=10", { headers: { "X-Auth-Token": key } })
  ]);
  if (!rs.ok || !rt.ok) return cache ? Response.json(cache)
    : Response.json({ fout: "football-data.org gaf een fout (" + rs.status + "/" + rt.status + ")." }, { status: 502 });

  const js = await rs.json();
  const jt = await rt.json();
  const tabel = ((js.standings || []).find(s => s.type === "TOTAL") || {}).table || [];
  const uit = {
    tijd: Date.now(),
    bijgewerkt: new Date().toISOString(),
    stand: tabel.map(r => ({
      positie: r.position,
      naam: r.team.shortName || r.team.name,
      logo: r.team.crest || "",
      punten: r.points
    })),
    scorers: (jt.scorers || []).map(s => ({ naam: s.player.name, goals: s.goals }))
  };
  await store.setJSON("fd-stand", uit);
  return Response.json(uit);
};
