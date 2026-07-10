// Het Eredivisie Orakel — voorspellingen indienen (met wachtwoordcontrole) en ophalen.
// - Iedereen mag indienen ZONDER admin-sleutel, maar allén voor de deadline
//   (serverside gecontroleerd).
// - Als een deelnemer een wachtwoord heeft, moet dat kloppen voordat de voorspelling
//   wordt aanvaard (voorkomt dat iemand als een ander inlogt).
// - Voorspellingen van anderen zijn pas zichtbaar als de admin publiceert.
// - De admin (met x-wachtwoord) kan voorspellingen verwijderen.
import { getStore } from "@netlify/blobs";

export default async (req) => {
  const store = getStore("eth-scorito-bbq");
  const hoofd = await store.get("poule", { type: "json" });
  const instellingen = (hoofd && hoofd.orakel) || {};
  const teams = hoofd && hoofd.teams ? hoofd.teams : {};
  let voorspellingen = (await store.get("orakel", { type: "json" })) || {};
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
    // Admin-only: voorspellingen verwijderen
    if (req.url.includes("verwijder=1")) {
      if (!isAdminReq) {
        return Response.json({ fout: "Alleen admin kan verwijderen." }, { status: 401 });
      }
      let body;
      try { body = await req.json(); } catch (e) {
        console.error("JSON parse:", e.message);
        return Response.json({ fout: "Verzoek kon niet worden gelezen." }, { status: 400 });
      }
      const { naam } = body || {};
      if (!naam || typeof naam !== "string") {
        return Response.json({ fout: "Geen deelnemer opgegeven." }, { status: 400 });
      }
      try {
        // Huidige voorspellingen ophalen
        const huidig = (await store.get("orakel", { type: "json" })) || {};
        // Verwijder de entry
        delete huidig[naam];
        // Sla terug op
        await store.setJSON("orakel", huidig);
        return Response.json({ ok: true });
      } catch (e) {
        console.error("Verwijderen:", e.message);
        return Response.json({ fout: "Verwijderen mislukt." }, { status: 500 });
      }
    }

    // Normale indiening door deelnemer
    let body;
    try { body = await req.json(); } catch { body = null; }
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
