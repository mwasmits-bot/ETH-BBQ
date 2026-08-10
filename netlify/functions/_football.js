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

async function haalRondeRuw(store, ronde) {
  return cachedGet(
    store,
    `fd-wedstrijden-${ronde}`,
    () => fetchFootball(`${FOOTBALL_API}/competitions/${EREDIVISIE_ID}/matches?matchday=${ronde}`),
    (d) => {
      const lijst = d.matches || [];
      const allesKlaar = lijst.length > 0 && lijst.every(m => ["FINISHED", "AWARDED", "CANCELLED", "POSTPONED"].includes(m.status));
      return allesKlaar ? 12 * 60 * 60 * 1000 : 2 * 60 * 1000; // 12 uur vs 2 minuten
    }
  );
}

function rondeIsVoorbij(ruw) {
  const lijst = (ruw && ruw.matches) || [];
  return lijst.length > 0 && lijst.every(m => ["FINISHED", "AWARDED", "CANCELLED", "POSTPONED"].includes(m.status));
}

// Speelronde ophalen (huidige, of een specifiek rondenummer).
//
// football-data.org's currentMatchday blijft soms op de net afgelopen ronde staan
// totdat zij hun schema bijwerken (het bleef bijv. op 1 staan terwijl alle
// wedstrijden van ronde 1 allang FINISHED waren). Wordt er geen expliciete ronde
// gevraagd — dus bij het gewoon openen van de app — dan stappen we zelf door naar
// de eerstvolgende ronde die nog niet volledig afgelopen is, zodat je op maandag
// niet naar een weekend staat te kijken dat al voorbij is. Vraagt iemand (bijv. via
// ‹ vorige / volgende ›) expliciet een rondenummer, dan tonen we precies dat.
export async function haalSpeelronde(store, gevraagdRonde) {
  const comp = await cachedGet(
    store,
    "fd-competitie",
    () => fetchFootball(`${FOOTBALL_API}/competitions/${EREDIVISIE_ID}`),
    () => 6 * 60 * 60 * 1000
  );
  const huidigeRonde = (comp.currentSeason && comp.currentSeason.currentMatchday) || 1;

  let ronde, ruw;
  if (Number.isFinite(gevraagdRonde) && gevraagdRonde > 0) {
    ronde = gevraagdRonde;
    ruw = await haalRondeRuw(store, ronde);
  } else {
    ronde = huidigeRonde;
    ruw = await haalRondeRuw(store, ronde);
    for (let stap = 0; stap < 5 && rondeIsVoorbij(ruw); stap++) {
      const volgende = await haalRondeRuw(store, ronde + 1);
      if (!(volgende.matches || []).length) break;   // buiten het seizoen: hier stoppen
      ronde += 1;
      ruw = volgende;
    }
  }

  const wedstrijden = (ruw.matches || []).map(naarWedstrijd)
    .sort((a, b) => new Date(a.aftrap) - new Date(b.aftrap));

  return { speelronde: ronde, huidigeRonde, wedstrijden };
}

// Eén specifieke wedstrijd ophalen (voor de Super Side Bet-uitslag).
export async function haalWedstrijd(store, ronde, matchId) {
  const data = await haalSpeelronde(store, ronde);
  return data.wedstrijden.find(w => String(w.id) === String(matchId)) || null;
}

// Directe hercontrole van één wedstrijd: eigen endpoint (/matches/{id}) en géén cache.
// Bedoeld als sanity check als de speelronde-call blijft hangen op "nog te spelen" —
// dan vraag je het de bron opnieuw, langs onze eigen opgeslagen kopie heen.
export async function hercontroleerWedstrijd(matchId) {
  const ruw = await fetchFootball(`${FOOTBALL_API}/matches/${matchId}`);
  const m = ruw && (ruw.match || (Array.isArray(ruw.matches) ? ruw.matches[0] : null)) || ruw;
  if (!m || !m.id) return null;
  return naarWedstrijd(m);
}

// Cache van een speelronde weggooien, zodat de app bij de eerstvolgende weergave
// verse gegevens ophaalt (inclusief de doelpunten, niet alleen de uitkomst).
export async function vergeetSpeelrondeCache(store, ronde) {
  if (!ronde) return;
  try { await store.delete(`fd-wedstrijden-${ronde}`); } catch { /* cache weg is ook goed */ }
}
