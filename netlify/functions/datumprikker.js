// netlify/functions/datumprikker.js
// Opslag voor de BBQ-datumprikker. Elke deelnemer slaat zijn eigen stemmen op;
// iedereen kan alle stemmen ophalen (net als bij het Orakel is dit een
// vriendenpoule — de wachtwoordcheck gebeurt in de app zelf).
import { getStore } from '@netlify/blobs';

export default async (req) => {
  const store = getStore('datumprikker');

  if (req.method === 'GET') {
    const stemmen = (await store.get('stemmen', { type: 'json' })) || {};
    return Response.json({ stemmen });
  }

  if (req.method === 'POST') {
    let body = {};
    try { body = await req.json(); } catch (e) {}
    const { deelnemer, stemmen } = body;
    if (!deelnemer || typeof stemmen !== 'object' || stemmen === null) {
      return new Response(JSON.stringify({ fout: 'Ongeldige gegevens' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    const alle = (await store.get('stemmen', { type: 'json' })) || {};
    alle[deelnemer] = stemmen; // vervangt de stemmen van deze deelnemer
    await store.setJSON('stemmen', alle);
    return Response.json({ ok: true });
  }

  return new Response('Method not allowed', { status: 405 });
};
