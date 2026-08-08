// Het Eredivisie Orakel — voorspellingen indienen (met wachtwoordcontrole) en ophalen.
// - Iedereen mag indienen ZONDER admin-sleutel, maar allén voor de deadline
//   (serverside gecontroleerd).
// - Als een deelnemer een wachtwoord heeft, moet dat kloppen voordat de voorspelling
//   wordt aanvaard (voorkomt dat iemand als een ander inlogt).
// - Voorspellingen van anderen zijn pas zichtbaar als de admin publiceert.
// - De admin (met x-wachtwoord) ziet altijd alles.
import { getStore } from "@netlify/blobs";
import { meldAdmin } from "./_notify.js";

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
      wisselDeadlineEpoch: instellingen.wisselDeadlineEpoch || null,
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
        deadlineEpoch: instellingen.deadlineEpoch || null,
        wisselDeadlineEpoch: instellingen.wisselDeadlineEpoch || null
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
    
    // Deadline & fase bepalen
    const nu = Date.now();
    const d1 = instellingen.deadlineEpoch;
    const d2 = instellingen.wisselDeadlineEpoch || null;
    if (!d1) {
      return Response.json({ fout: "De beheerder heeft nog geen deadline ingesteld." }, { status: 400 });
    }

    const naam = String(deelnemer).trim();
    const bestaand = voorspellingen[naam];

    // Vergelijken van topscorers gebeurt op een genormaliseerde sleutel, mét de
    // alias-koppeling van de beheerder. Zo telt het niet als gouden wissel wanneer
    // dezelfde speler alleen anders geschreven staat — bijvoorbeeld doordat een
    // vrij getypte naam ("Smik") vervangen is door de officiële naam uit de
    // spelerslijst ("Brian Brobbey").
    const aliassen = (hoofd && hoofd.aliassen) || {};
    const norm = (x) => String(x || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const lc = (x) => {
      const n = norm(x);
      return norm(aliassen[n] || x);
    };

    // Topscorers controleren (altijd 3)
    const schoon = topscorers.slice(0, 3).map(t => String(t).trim()).filter(Boolean);
    if (schoon.length < 3) {
      return Response.json({ fout: "Vul alle drie de topscorers in." }, { status: 400 });
    }

    let melding;
    if (nu <= d1) {
      // FASE 1 - volledige voorspelling (voor de eerste speelronde)
      const teamsLijst = (instellingen.teams || []).map(t => t.naam);
      if (teamsLijst.length && volgorde.length !== teamsLijst.length) {
        return Response.json({ fout: "De volgorde bevat niet alle teams." }, { status: 400 });
      }
      voorspellingen[naam] = {
        volgorde: volgorde.map(String),
        topscorers: schoon,
        topscorersBasis: schoon,          // referentie voor de gouden wissels
        ingediend: new Date().toISOString()
      };
      melding = { onderwerp: `Orakel: nieuwe voorspelling van ${naam}`, tekst: `${naam} heeft zijn/haar Eredivisie Orakel-voorspelling ingediend.\n\nVolgorde: ${volgorde.join(", ")}\nTopscorers: ${schoon.join(", ")}` };
    } else if (d2 && nu < d2) {
      // FASE 2 - gouden wissels (na de 1e speelronde, tot de transferdeadline): alleen topscorers
      if (!bestaand) {
        return Response.json({ fout: "Je hebt voor de eerste speelronde geen voorspelling ingediend - meedoen kan niet meer." }, { status: 403 });
      }
      const basis = (bestaand.topscorersBasis && bestaand.topscorersBasis.length ? bestaand.topscorersBasis : bestaand.topscorers) || [];
      const basisLc = new Set(basis.map(lc));
      const nieuwLc = schoon.map(lc);
      const behouden = [...basisLc].filter(b => nieuwLc.includes(b)).length;
      if (behouden < 1) {
        return Response.json({ fout: "Je mag maximaal 2 gouden wissels doen - minstens 1 van je oorspronkelijke 3 topscorers moet blijven staan." }, { status: 400 });
      }
      voorspellingen[naam] = {
        ...bestaand,
        topscorers: schoon,               // teamvolgorde blijft ongewijzigd
        topscorersBasis: basis,           // basis blijft vast
        gewisseldOp: new Date().toISOString()
      };
      melding = { onderwerp: `Orakel: gouden wissel van ${naam}`, tekst: `${naam} heeft een gouden wissel gedaan bij het Eredivisie Orakel.\n\nNieuwe topscorers: ${schoon.join(", ")}` };
    } else {
      return Response.json({ fout: "De deadline is verstreken - voorspellen en wisselen kan niet meer." }, { status: 403 });
    }

    await store.setJSON("orakel", voorspellingen);
    await meldAdmin(melding.onderwerp, melding.tekst);
    return Response.json({ ok: true });
  }

  return new Response("Method not allowed", { status: 405 });
};
