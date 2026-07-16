// Football-data.org proxy via Netlify Functions.
// GET /api/stand = eindstand (6h cache)
// GET /api/stand?actie=teams = 18 Eredivisie-teams (24h cache)
// GET /api/stand?actie=squad&team=Ajax = spelers van Ajax (24h cache)
import { getStore } from "@netlify/blobs";

const FOOTBALL_API = "https://api.football-data.org/v4";
const EREDIVISIE_ID = "DED";
const KEY = process.env.FOOTBALL_DATA_KEY || "";

async function fetchFootball(url) {
  const r = await fetch(url, { headers: { "X-Auth-Token": KEY } });
  if (!r.ok) throw new Error(`Football API: ${r.status}`);
  return r.json();
}

async function cachedGet(store, key, fetchFn, ttlMinutes) {
  const cached = await store.get(key, { type: "json" });
  const now = Date.now();
  if (cached && cached.ts && now - cached.ts < ttlMinutes * 60 * 1000) {
    return cached.data;
  }
  const data = await fetchFn();
  await store.set(key, JSON.stringify({ ts: now, data }));
  return data;
}

export default async (req) => {
  const store = getStore("eth-scorito-bbq");
  const isAdminReq = !!process.env.ADMIN_WACHTWOORD &&
    (req.headers.get("x-wachtwoord") || "") === process.env.ADMIN_WACHTWOORD;

  const url = new URL(req.url);
  const actie = url.searchParams.get("actie");
  const vernieuw = url.searchParams.get("vernieuw") === "1" && isAdminReq;
  const teamNaam = url.searchParams.get("team");

  try {
    if (actie === "teams") {
      const cacheKey = "fd-teams";
      if (vernieuw) await store.delete(cacheKey);
      const data = await cachedGet(
        store,
        cacheKey,
        () => fetchFootball(`${FOOTBALL_API}/competitions/${EREDIVISIE_ID}/teams`),
        24 * 60
      );
      const teams = (data.teams || []).map(t => ({ naam: t.name, logo: t.crest }));
      return Response.json({ teams }, { headers: { "cache-control": "public, max-age=86400" } });
    }

    if (actie === "squad" && teamNaam) {
      const cacheKey = `fd-squad-${teamNaam}`;
      if (vernieuw) await store.delete(cacheKey);
      const data = await cachedGet(
        store,
        cacheKey,
        async () => {
          // Eerst alle teams ophalen
          const teamsData = await fetchFootball(`${FOOTBALL_API}/competitions/${EREDIVISIE_ID}/teams`);
          const team = (teamsData.teams || []).find(t => t.name === teamNaam);
          if (!team) throw new Error(`Team ${teamNaam} niet gevonden`);
          return team;
        },
        24 * 60
      );
      const spelers = (data.squad || []).map(p => ({ naam: p.name, nummer: p.shirtNumber }));
      return Response.json({ team: teamNaam, spelers }, { headers: { "cache-control": "public, max-age=86400" } });
    }

    // Default: eindstand
    const cacheKey = "fd-stand";
    if (vernieuw) await store.delete(cacheKey);
    const data = await cachedGet(
      store,
      cacheKey,
      () => fetchFootball(`${FOOTBALL_API}/competitions/${EREDIVISIE_ID}/standings`),
      6 * 60
    );
    return Response.json(data, { headers: { "cache-control": "public, max-age=21600" } });
  } catch (e) {
    console.error("Football API error:", e.message);
    return Response.json(
      { fout: e.message },
      { status: 500, headers: { "cache-control": "no-store" } }
    );
  }
};
