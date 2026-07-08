// Reglement opslag en ophalen via Netlify Blobs.
// GET  = publiek (iedereen ziet het PDF-reglement)
// POST = alleen met het juiste x-wachtwoord (ADMIN_WACHTWOORD)
import { getStore } from "@netlify/blobs";

export default async (req) => {
  const store = getStore("eth-scorito-bbq");

  if (req.method === "GET") {
    const reglement = await store.get("reglement", { type: "json" });
    return Response.json(reglement || { pdf: null }, { headers: { "cache-control": "no-store" } });
  }

  if (req.method === "POST") {
    const juist = process.env.ADMIN_WACHTWOORD;
    if (!juist) return Response.json({ fout: "ADMIN_WACHTWOORD is niet ingesteld in Netlify." }, { status: 500 });
    if ((req.headers.get("x-wachtwoord") || "") !== juist) {
      return Response.json({ fout: "Onjuist wachtwoord." }, { status: 401 });
    }

    let body;
    try { body = await req.json(); } catch { body = null; }
    const { pdf } = body || {};
    if (!pdf || typeof pdf !== "string") {
      return Response.json({ fout: "Geen geldige PDF ontvangen." }, { status: 400 });
    }

    await store.setJSON("reglement", { pdf });
    return Response.json({ ok: true });
  }

  return new Response("Method not allowed", { status: 405 });
};
