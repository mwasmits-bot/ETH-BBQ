// Eredivisie-squads via football-data.org. Voedt de topscorer-keuzelijst in het Orakel
// (eerst team kiezen, dan speler) en de admin-testknop die laat zien hoe vers de data is.
//
// Iedereen mag lezen — anders kan een deelnemer geen speler kiezen. De rate limit
// (10 requests/minuut op de gratis tier) blijft veilig doordat het resultaat 24 uur
// gecachet wordt; alleen de admin mag met ?vernieuw=1 die cache omzeilen.
//
// Vereist environment variable FOOTBALL_DATA_KEY (dezelfde als stand.js / wedstrijden.js).
import { getStore } from "@netlify/blobs";

const UUR = 3600 * 1000;
const FD = "https://api.football-data.org/v4/competitions/DED";

export default async (req) => {
  const url = new URL(req.url);
  const store = getStore("eth-scorito-bbq");
  const key = process.env.FOOTBALL_DATA_KEY;

  const isAdminReq = !!process.env.ADMIN_WACHTWOORD &&
    (req.headers.get("x-wachtwoord") || "") === process.env.ADMIN_WACHTWOORD;

  const vernieuw = url.searchParams.get("vernieuw") === "1" && isAdminReq;
  const cache = await store.get("fd-spelers", { type: "json" });
  if (cache && Date.now() - cache.tijd < 24 * UUR && !vernieuw) {
    return Response.json({ ...cache, uitCache: true }, { headers: { "cache-control": "no-store" } });
  }

  if (!key) {
    return Response.json({ fout: "FOOTBALL_DATA_KEY is niet ingesteld in Netlify." }, { status: 500 });
  }

  // Eén call: alle teams van de competitie. In v4 levert dit per team ook de squad —
  // maar dat is precies wat we hier willen controleren, dus we tonen ook lege squads.
  const r = await fetch(FD + "/teams", { headers: { "X-Auth-Token": key } });
  if (!r.ok) {
    const melding = r.status === 429
      ? "Rate limit van football-data.org bereikt (10 verzoeken per minuut op de gratis tier). Wacht even en probeer opnieuw."
      : "football-data.org gaf een fout (" + r.status + ").";
    return Response.json({ fout: melding }, { status: 502 });
  }

  const j = await r.json();
  const teams = (j.teams || []).map(t => {
    const squad = Array.isArray(t.squad) ? t.squad : [];
    return {
      naam: t.shortName || t.name,
      logo: t.crest || "",
      bijgewerkt: t.lastUpdated || null,
      spelers: squad
        .map(s => ({ naam: s.name, positie: s.position || "", geboren: s.dateOfBirth || null }))
        .sort((a, b) => a.naam.localeCompare(b.naam, "nl"))
    };
  }).sort((a, b) => a.naam.localeCompare(b.naam, "nl"));

  const uit = {
    tijd: Date.now(),
    opgehaald: new Date().toISOString(),
    aantalTeams: teams.length,
    aantalSpelers: teams.reduce((n, t) => n + t.spelers.length, 0),
    teamsZonderSpelers: teams.filter(t => !t.spelers.length).map(t => t.naam),
    teams
  };

  await store.setJSON("fd-spelers", uit);
  return Response.json(uit, { headers: { "cache-control": "no-store" } });
};
