// Het Eredivisie Orakel — voorspellingen indienen en ophalen.
// - Iedereen mag indienen ZONDER wachtwoord, maar alléén vóór de deadline
//   (die serverside wordt gecontroleerd, dus ook slimmeriken komen er niet langs).
// - Voorspellingen van anderen zijn pas zichtbaar als de admin publiceert;
//   tot die tijd is alleen de lijst met namen zichtbaar. De admin (met x-wachtwoord)
//   ziet altijd alles.
// - Voorspellingen staan in een eigen blob-sleutel, zodat inzendingen van vrienden
//   nooit botsen met admin-opslagacties.
import { getStore } from "@netlify/blobs";

export default async (req) => {
  const store = getStore("eth-scorito-bbq");
  const hoofd = await store.get("poule", { type: "json" });
  const instellingen = (hoofd && hoofd.orakel) || {};
  const voorspellingen = (await store.get("orakel", { type: "json" })) || {};
  const isAdminReq = !!process.env.ADMIN_WACHTWOORD &&
    (req.headers.get("x-wachtwoord") || "") === process.env.ADMIN_WACHTWOORD;

  if (req.method === "GET") {
    const uit = {
      deadline: instellingen.deadline || null,
      deadlineEpoch: instellingen.deadlineEpoch || null,
      gepubliceerd: !!instellingen.gepubliceerd,
      teams: instellingen.teams || [],
      namen: Object.keys(voorspellingen).sort()
    };
    if (uit.gepubliceerd || isAdminReq) uit.voorspellingen = voorspellingen;
    return Response.json(uit, { headers: { "cache-control": "no-store" } });
  }

  if (req.method === "POST") {
    let body;
    try { body = await req.json(); } catch { body = null; }
    const { deelnemer, volgorde, topscorers } = body || {};
    if (!deelnemer || !String(deelnemer).trim() || !Array.isArray(volgorde) || !Array.isArray(topscorers)) {
      return Response.json({ fout: "Onvolledige voorspelling." }, { status: 400 });
    }
    if (!instellingen.deadlineEpoch) {
      return Response.json({ fout: "De beheerder heeft nog geen deadline ingesteld." }, { status: 400 });
    }
    if (Date.now() > instellingen.deadlineEpoch) {
      return Response.json({ fout: "De deadline is verstreken — het seizoen is begonnen!" }, { status: 403 });
    }
    const teams = (instellingen.teams || []).map(t => t.naam);
    if (teams.length && volgorde.length !== teams.length) {
      return Response.json({ fout: "De volgorde bevat niet alle teams." }, { status: 400 });
    }
    const schoon = topscorers.slice(0, 3).map(s => String(s).trim()).filter(Boolean);
    if (schoon.length < 3) {
      return Response.json({ fout: "Vul alle drie de topscorers in." }, { status: 400 });
    }
    voorspellingen[String(deelnemer).trim()] = {
      volgorde: volgorde.map(String),
      topscorers: schoon,
      ingediend: new Date().toISOString()
    };
    await store.setJSON("orakel", voorspellingen);
    return Response.json({ ok: true });
  }

  return new Response("Method not allowed", { status: 405 });
};
