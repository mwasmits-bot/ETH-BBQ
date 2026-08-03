// Het Eredivisie Orakel — voorspellingen indienen (met wachtwoordcontrole) en ophalen.
// - Iedereen mag indienen ZONDER admin-sleutel, maar allén voor de deadline
//   (serverside gecontroleerd).
// - Als een deelnemer een wachtwoord heeft, moet dat kloppen voordat de voorspelling
//   wordt aanvaard (voorkomt dat iemand als een ander inlogt).
// - Voorspellingen van anderen zijn pas zichtbaar als de admin publiceert.
// - De admin (met x-wachtwoord) ziet altijd alles.
import { getStore } from "@netlify/blobs";

export default async (req) => {
  const store = getStore("eth-scorito-bbq");
  const hoofd = await store.get("poule", { type: "json" });
  const instellingen = (hoofd && hoofd.orakel) || {};
  const teams = hoofd && hoofd.teams ? hoofd.teams : {};
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

    // Eigen voorspelling ophalen (ook vóór publicatie), na wachtwoordcontrole.
    if (body && body.actie === "mijn") {
      const naam = String(body.deelnemer || "").trim();
      const team = teams[naam];
      if (!team) return Response.json({ fout: "Deelnemer niet gevonden." }, { status: 400 });
      if (team.wachtwoord && String(body.wachtwoord || "") !== team.wachtwoord) {
        return Response.json({ fout: "Onjuist wachtwoord voor deze deelnemer." }, { status: 401 });
      }
      return Response.json({
        ok: true,
        voorspelling: voorspellingen[naam] || null,
        deadlineEpoch: instellingen.deadlineEpoch || null
      }, { headers: { "cache-control": "no-store" } });
    }

    const { deelnemer, wachtwoord, volgorde, topscorers } = body || {};
    
    if (!deelnemer || !String(deelnemer).trim() || !Array.isArray(volgorde) || !Array.isArray(topscorers)) {
      return Response.json({ fout: "Onvolledige voorspelling." }, { status: 400 });
    }
    
    // Wachtwoordcontrole
    const team = teams[String(deelnemer).trim()];
    if (!team) {
      return Response.json({ fout: "Deelnemer niet gevonden." }, { status: 400 });
    }
    if (team.wachtwoord && String(wachtwoord || "") !== team.wachtwoord) {
      return Response.json({ fout: "Onjuist wachtwoord voor deze deelnemer." }, { status: 401 });
    }
    
    // Deadline controleren
    if (!instellingen.deadlineEpoch) {
      return Response.json({ fout: "De beheerder heeft nog geen deadline ingesteld." }, { status: 400 });
    }
    if (Date.now() > instellingen.deadlineEpoch) {
      return Response.json({ fout: "De deadline is verstreken — het seizoen is begonnen!" }, { status: 403 });
    }
    
    // Teams controleren
    const teamsLijst = (instellingen.teams || []).map(t => t.naam);
    if (teamsLijst.length && volgorde.length !== teamsLijst.length) {
      return Response.json({ fout: "De volgorde bevat niet alle teams." }, { status: 400 });
    }
    
    // Topscorers controleren
    const schoon = topscorers.slice(0, 3).map(s => String(s).trim()).filter(Boolean);
    if (schoon.length < 3) {
      return Response.json({ fout: "Vul alle drie de topscorers in." }, { status: 400 });
    }
    
    // Opslaan
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
