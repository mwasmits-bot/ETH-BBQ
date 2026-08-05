// Gedeelde football-data.org helpers voor wedstrijden.js en sidebets.js (Super Side Bet).
// Environment variable: FOOTBALL_DATA_KEY

const FOOTBALL_API = "https://api.football-data.org/v4";
const EREDIVISIE_ID = "DED";
const KEY = process.env.FOOTBALL_DATA_KEY || "";

async function fetchFootball(url) {
  const r = await fetch(url, { headers: { "X-Auth-Token": KEY } });
  if (!r.ok) throw new Error(`Football API: ${r.status}`);
  return r.json();
}

// Cache met variabele levensduur: kort zolang er nog gespeeld wordt,
// lang zodra alle wedstrijden van die ronde afgelopen zijn.
async function cachedGet(store, key, fetchFn, ttlFn) {
  const cached = await store.get(key, { type: "json" });
  const now = Date.now();
  if (cached && cached.ts && now - cached.ts < cached.ttl) return cached.data;
  const data = await fetchFn();
  const ttl = ttlFn(data);
  await store.set(key, JSON.stringify({ ts: now, ttl, data }));
  return data;
}

function uitkomstVan(m) {
  if (m.status !== "FINISHED") return null;
  const ft = (m.score && m.score.fullTime) || {};
  if (ft.home == null || ft.away == null) return null;
  if (ft.home > ft.away) return "thuis";
  if (ft.home < ft.away) return "uit";
  return "gelijk";
}

function naarWedstrijd(m) {
  const ft = (m.score && m.score.fullTime) || {};
  const ht = (m.score && m.score.halfTime) || {};
  return {
    id: m.id,
    thuis: (m.homeTeam && (m.homeTeam.shortName || m.homeTeam.name)) || "?",
    uit: (m.awayTeam && (m.awayTeam.shortName || m.awayTeam.name)) || "?",
    thuisLogo: (m.homeTeam && m.homeTeam.crest) || "",
    uitLogo: (m.awayTeam && m.awayTeam.crest) || "",
    aftrap: m.utcDate,
    status: m.status,
    thuisDoelpunten: ft.home ?? null,
    uitDoelpunten: ft.away ?? null,
    rustThuisDoelpunten: ht.home ?? null,
    rustUitDoelpunten: ht.away ?? null,
    uitkomst: uitkomstVan(m)
  };
}

// Speelronde ophalen (huidige, of een specifiek rondenummer).
export async function haalSpeelronde(store, gevraagdRonde) {
  const comp = await cachedGet(
    store,
    "fd-competitie",
    () => fetchFootball(`${FOOTBALL_API}/competitions/${EREDIVISIE_ID}`),
    () => 6 * 60 * 60 * 1000
  );
  const huidigeRonde = (comp.currentSeason && comp.currentSeason.currentMatchday) || 1;
  const ronde = Number.isFinite(gevraagdRonde) && gevraagdRonde > 0 ? gevraagdRonde : huidigeRonde;

  const ruw = await cachedGet(
    store,
    `fd-wedstrijden-${ronde}`,
    () => fetchFootball(`${FOOTBALL_API}/competitions/${EREDIVISIE_ID}/matches?matchday=${ronde}`),
    (d) => {
      const lijst = d.matches || [];
      const allesKlaar = lijst.length > 0 && lijst.every(m => ["FINISHED", "AWARDED", "CANCELLED", "POSTPONED"].includes(m.status));
      return allesKlaar ? 12 * 60 * 60 * 1000 : 2 * 60 * 1000; // 12 uur vs 2 minuten
    }
  );

  const wedstrijden = (ruw.matches || []).map(naarWedstrijd)
    .sort((a, b) => new Date(a.aftrap) - new Date(b.aftrap));

  return { speelronde: ronde, huidigeRonde, wedstrijden };
}

// Eén specifieke wedstrijd ophalen (voor de Super Side Bet-uitslag).
export async function haalWedstrijd(store, ronde, matchId) {
  const data = await haalSpeelronde(store, ronde);
  return data.wedstrijden.find(w => String(w.id) === String(matchId)) || null;
}
