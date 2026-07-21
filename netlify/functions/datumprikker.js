// De BBQ-datumprikker — stemmen (Ja/Nee/Misschien) per deelnemer opslaan en ophalen.
// Zelfde opzet als orakel.js:
// - Iedereen mag zijn eigen stem indienen; als de deelnemer een wachtwoord heeft,
//   wordt dat serverside gecontroleerd (voorkomt stemmen namens een ander).
// - De admin (met x-wachtwoord) mag namens iedereen aanpassen.
// - Alle stemmen zijn voor iedereen zichtbaar (geen publicatie-drempel).
import { getStore } from "@netlify/blobs";

export default async (req) => {
  const store = getStore("eth-scorito-bbq");
  const hoofd = await store.get("poule", { type: "json" });
  const teams = hoofd && hoofd.teams ? hoofd.teams : {};
  const stemmen = (await store.get("datumprikker", { type: "json" })) || {};
  const isAdminReq = !!process.env.ADMIN_WACHTWOORD &&
    (req.headers.get("x-wachtwoord") || "") === process.env.ADMIN_WACHTWOORD;

  if (req.method === "GET") {
    return Response.json({ stemmen }, { headers: { "cache-control": "no-store" } });
  }

  if (req.method === "POST") {
    let body;
    try { body = await req.json(); } catch { body = null; }
    const { deelnemer, wachtwoord, stemmen: nieuw } = body || {};

    if (!deelnemer || !String(deelnemer).trim() || typeof nieuw !== "object" || nieuw === null) {
      return Response.json({ fout: "Onvolledige stem." }, { status: 400 });
    }

    const naam = String(deelnemer).trim();

    // Wachtwoordcontrole (admin mag dit overslaan en namens iedereen aanpassen)
    if (!isAdminReq) {
      const team = teams[naam];
      if (!team) {
        return Response.json({ fout: "Deelnemer niet gevonden." }, { status: 400 });
      }
      if (team.wachtwoord && String(wachtwoord || "") !== team.wachtwoord) {
        return Response.json({ fout: "Onjuist wachtwoord voor deze deelnemer." }, { status: 401 });
      }
    }

    // Alleen geldige keuzes bewaren
    const geldig = { ja: 1, nee: 1, misschien: 1 };
    const schoon = {};
    for (const [id, val] of Object.entries(nieuw)) {
      if (geldig[val]) schoon[id] = val;
    }

    stemmen[naam] = schoon; // vervangt de stemmen van deze deelnemer
    await store.setJSON("datumprikker", stemmen);
    return Response.json({ ok: true });
  }

  return new Response("Method not allowed", { status: 405 });
};
