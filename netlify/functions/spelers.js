// TEST: haalt de Eredivisie-squads op via football-data.org, zodat de beheerder met eigen
// ogen kan zien of de spelerslijsten kloppen en hoe vers ze zijn — vóórdat we besluiten er
// een dropdown van te maken in het Orakel (topscorers).
//
// Puur informatief: verandert niets aan het Orakel of de bestaande werking.
// Alleen bereikbaar voor de admin (x-wachtwoord), zodat we de gratis rate limit
// (10 requests/minuut) niet opbranden aan gewone bezoekers.
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
  if (!isAdminReq) {
    return Response.json({ fout: "Alleen de beheerder kan de spelerslijst ophalen." }, { status: 401 });
  }

  const vernieuw = url.searchParams.get("vernieuw") === "1";
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
