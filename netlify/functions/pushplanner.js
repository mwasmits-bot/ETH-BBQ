// Verstuurt de door de admin aangemaakte geplande/periodieke pushberichten
// (zie push.js voor het aanmaken/beheren ervan, via het tabblad "📲 Pushmeldingen").
// Draait elke 5 minuten; "eenmalig" wordt na versturen verwijderd, "periodiek"
// (dagelijks/wekelijks) krijgt meteen het volgende tijdstip.
import { getStore } from "@netlify/blobs";
import { vapidKlaarzetten, verstuurNaarAlleAbonnees, voegGeschiedenisToe } from "./_push.js";

const DAG_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAG_MS;

export default async () => {
  const store = getStore("eth-scorito-bbq");

  if (!vapidKlaarzetten()) {
    console.error("VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY ontbreken in Netlify — pushplanner overgeslagen.");
    return new Response("VAPID-sleutels ontbreken", { status: 200 });
  }

  const berichten = (await store.get("push-berichten", { type: "json" })) || {};
  const nu = Date.now();
  let verstuurd = 0;

  for (const b of Object.values(berichten)) {
    if (!b.actief || b.volgende > nu) continue;

    const aantal = await verstuurNaarAlleAbonnees(store, { titel: b.titel, tekst: b.tekst, url: b.url });
    await voegGeschiedenisToe(store, {
      titel: b.titel,
      tekst: b.tekst,
      url: b.url,
      verstuurdOp: new Date().toISOString(),
      aantal,
      type: b.type === "periodiek" ? "periodiek" : "gepland"
    });
    verstuurd++;

    if (b.type === "periodiek") {
      const stap = b.interval === "wekelijks" ? WEEK_MS : DAG_MS;
      b.laatstVerstuurd = nu;
      b.aantalKeerVerstuurd = (b.aantalKeerVerstuurd || 0) + 1;
      while (b.volgende <= nu) b.volgende += stap; // ook na een lange onderbreking maar 1x versturen
    } else {
      delete berichten[b.id]; // eenmalig: klaar
    }
  }

  if (verstuurd) await store.setJSON("push-berichten", berichten);

  return new Response(`pushplanner: ${verstuurd} bericht(en) verstuurd`, { status: 200 });
};

export const config = { schedule: "*/5 * * * *" };
