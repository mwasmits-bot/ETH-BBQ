// Reglement opslag (platte tekst) via Netlify Blobs.
// GET  = publiek (iedereen ziet het reglement)
// POST = alleen met het juiste x-wachtwoord (ADMIN_WACHTWOORD)
import { getStore } from "@netlify/blobs";

export default async (req) => {
  const store = getStore("eth-scorito-bbq");

  if (req.method === "GET") {
    const reglement = await store.get("reglement", { type: "json" });
    return Response.json(reglement || { tekst: "" }, { headers: { "cache-control": "no-store" } });
  }

  if (req.method === "POST") {
    const juist = process.env.ADMIN_WACHTWOORD;
    if (!juist) return Response.json({ fout: "ADMIN_WACHTWOORD is niet ingesteld in Netlify." }, { status: 500 });
    if ((req.headers.get("x-wachtwoord") || "") !== juist) {
      return Response.json({ fout: "Onjuist wachtwoord." }, { status: 401 });
    }

    let body;
    try { body = await req.json(); } catch (e) {
      return Response.json({ fout: "Verzoek kon niet worden gelezen." }, { status: 400 });
    }

    const { tekst } = body || {};
    if (typeof tekst !== "string") {
      return Response.json({ fout: "Geen geldige tekst ontvangen." }, { status: 400 });
    }

    try {
      await store.setJSON("reglement", { tekst });
      return Response.json({ ok: true });
    } catch (e) {
      console.error("Reglement opslaan fout:", e.message);
      return Response.json({ fout: "Opslaan mislukt: " + e.message }, { status: 500 });
    }
  }

  return new Response("Method not allowed", { status: 405 });
};
