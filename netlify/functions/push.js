// Web Push-abonnementen voor de opstelling-herinnering (1 uur voor de eerste
// wedstrijd van de speelronde — zie opstellingherinnering.js voor het versturen).
//
// GET  -> publieke VAPID-sleutel (nodig door de browser om te abonneren; geen auth)
// POST -> { actie: 'abonneren' | 'afmelden', deelnemer, wachtwoord, ... }
//
// Wachtwoordcontrole zelfde patroon als sidebets.js: eigen wachtwoord uit de poule,
// of admin. Bewaard per deelnemer als lijst (meerdere toestellen/browsers kunnen).
import { getStore } from "@netlify/blobs";

export default async (req) => {
  const store = getStore("eth-scorito-bbq");

  if (req.method === "GET") {
    return Response.json(
      { publicKey: process.env.VAPID_PUBLIC_KEY || null },
      { headers: { "cache-control": "no-store" } }
    );
  }

  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const isAdmin = !!process.env.ADMIN_WACHTWOORD &&
    (req.headers.get("x-wachtwoord") || "") === process.env.ADMIN_WACHTWOORD;

  let body;
  try { body = await req.json(); } catch { body = null; }
  if (!body || !body.actie) return Response.json({ fout: "Geen actie opgegeven." }, { status: 400 });

  const poule = await store.get("poule", { type: "json" });
  const teams = (poule && poule.teams) || {};
  const naam = String(body.deelnemer || "").trim();

  if (!isAdmin) {
    if (!naam || !teams[naam]) return Response.json({ fout: "Deze deelnemer bestaat niet in de poule." }, { status: 400 });
    const ingesteld = teams[naam].wachtwoord || "";
    if (ingesteld && String(body.wachtwoord || "") !== ingesteld) {
      return Response.json({ fout: "Wachtwoord klopt niet." }, { status: 401 });
    }
  } else if (!naam) {
    return Response.json({ fout: "Geen deelnemer opgegeven." }, { status: 400 });
  }

  const abonnees = (await store.get("push-abonnees", { type: "json" })) || {};

  if (body.actie === "abonneren") {
    const sub = body.subscription;
    if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) {
      return Response.json({ fout: "Ongeldig push-abonnement." }, { status: 400 });
    }
    const lijst = (abonnees[naam] || []).filter(a => a.endpoint !== sub.endpoint);
    lijst.push({ endpoint: sub.endpoint, keys: sub.keys, toegevoegdOp: new Date().toISOString() });
    abonnees[naam] = lijst;
    await store.setJSON("push-abonnees", abonnees);
    return Response.json({ ok: true });
  }

  if (body.actie === "afmelden") {
    if (abonnees[naam]) {
      abonnees[naam] = body.endpoint
        ? abonnees[naam].filter(a => a.endpoint !== body.endpoint)
        : [];
      if (!abonnees[naam].length) delete abonnees[naam];
      await store.setJSON("push-abonnees", abonnees);
    }
    return Response.json({ ok: true });
  }

  return Response.json({ fout: "Onbekende actie." }, { status: 400 });
};
