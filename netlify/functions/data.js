// Pouledata lezen en schrijven via Netlify Blobs.
// GET  = publiek (iedereen ziet de standen)
// POST = alleen met het juiste x-wachtwoord (ADMIN_WACHTWOORD environment variable)
import { getStore } from "@netlify/blobs";

export default async (req) => {
  const store = getStore("eth-scorito-bbq");

  if (req.method === "GET") {
    const value = await store.get("poule", { type: "json" });
    return Response.json({ data: value ?? null }, { headers: { "cache-control": "no-store" } });
  }

  if (req.method === "POST") {
    const juist = process.env.ADMIN_WACHTWOORD;
    if (!juist) return Response.json({ fout: "ADMIN_WACHTWOORD is niet ingesteld in Netlify." }, { status: 500 });
    if ((req.headers.get("x-wachtwoord") || "") !== juist) {
      return Response.json({ fout: "Onjuist wachtwoord." }, { status: 401 });
    }
    let body;
    try { body = await req.json(); } catch { body = null; }
    if (!body || typeof body.data !== "object" || body.data === null) {
      return Response.json({ fout: "Geen geldige data ontvangen." }, { status: 400 });
    }
    await store.setJSON("poule", body.data);
    return Response.json({ ok: true });
  }

  return new Response("Method not allowed", { status: 405 });
};
