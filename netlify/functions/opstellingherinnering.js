// Stuurt automatisch een pushmelding, 1 uur vóór de eerste wedstrijd van de
// eerstvolgende speelronde, naar iedereen die zich daarvoor heeft aangemeld
// (via de knop "Herinner me 1 uur voor de eerste wedstrijd" in de app).
//
// Draait elke 15 minuten; het venster (aftrap - 60 min, tot aftrap) is dus met
// ruim marge te vangen. "Eerste wedstrijd van het weekend" is dezelfde speelronde
// die Side Bets standaard toont (haalSpeelronde() springt zelf door naar de
// eerstvolgende ronde zodra de huidige helemaal afgelopen is).
import { getStore } from "@netlify/blobs";
import webpush from "web-push";
import { haalSpeelronde } from "./_football.js";

const VOOR_AFTRAP_MS = 60 * 60 * 1000; // 1 uur

export default async () => {
  const store = getStore("eth-scorito-bbq");
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:info@ethscoritobbq.com";

  if (!publicKey || !privateKey) {
    console.error("VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY ontbreken in Netlify — opstelling-herinnering overgeslagen.");
    return new Response("VAPID-sleutels ontbreken", { status: 200 });
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);

  try {
    const { speelronde, wedstrijden } = await haalSpeelronde(store, undefined);
    if (!wedstrijden.length) return new Response("geen wedstrijden gevonden", { status: 200 });

    const eerste = wedstrijden[0]; // haalSpeelronde sorteert al op aftrap
    const aftrap = new Date(eerste.aftrap).getTime();
    const nu = Date.now();
    const herinnerVanaf = aftrap - VOOR_AFTRAP_MS;

    if (nu < herinnerVanaf || nu >= aftrap) {
      return new Response("buiten het herinneringsvenster voor speelronde " + speelronde, { status: 200 });
    }

    const verstuurd = (await store.get("opstelling-herinnerd", { type: "json" })) || {};
    const sleutel = String(speelronde);
    if (verstuurd[sleutel]) return new Response("al verstuurd voor speelronde " + speelronde, { status: 200 });

    const abonnees = (await store.get("push-abonnees", { type: "json" })) || {};
    const heeftAbonnees = Object.values(abonnees).some(lijst => lijst.length);

    if (heeftAbonnees) {
      const payload = JSON.stringify({
        titel: "⏰ Zet je opstelling!",
        tekst: `Over minder dan een uur begint ${eerste.thuis} - ${eerste.uit} — de eerste wedstrijd van speelronde ${speelronde}. Vergeet je Scorito-opstelling niet.`,
        url: "https://ethscoritobbq.com"
      });

      let aantal = 0;
      const verlopen = [];
      for (const [naam, lijst] of Object.entries(abonnees)) {
        for (const abo of lijst) {
          try {
            await webpush.sendNotification({ endpoint: abo.endpoint, keys: abo.keys }, payload);
            aantal++;
          } catch (e) {
            if (e && (e.statusCode === 404 || e.statusCode === 410)) {
              verlopen.push({ naam, endpoint: abo.endpoint }); // abonnement bestaat niet meer bij de browser
            } else {
              console.error("Pushmelding mislukt voor", naam, e && e.message || e);
            }
          }
        }
      }

      if (verlopen.length) {
        verlopen.forEach(({ naam, endpoint }) => {
          abonnees[naam] = (abonnees[naam] || []).filter(a => a.endpoint !== endpoint);
          if (!abonnees[naam].length) delete abonnees[naam];
        });
        await store.setJSON("push-abonnees", abonnees);
      }

      verstuurd[sleutel] = { tijd: new Date().toISOString(), aantal };
    } else {
      verstuurd[sleutel] = { tijd: new Date().toISOString(), aantal: 0 };
    }

    // Oude records opruimen (> 60 dagen) zodat dit niet eindeloos groeit.
    const grens = nu - 60 * 24 * 60 * 60 * 1000;
    Object.keys(verstuurd).forEach(k => {
      const t = Date.parse(verstuurd[k] && verstuurd[k].tijd);
      if (Number.isFinite(t) && t < grens) delete verstuurd[k];
    });
    await store.setJSON("opstelling-herinnerd", verstuurd);

    return new Response(`speelronde ${speelronde}: verstuurd naar ${verstuurd[sleutel].aantal} abonnee(s)`, { status: 200 });
  } catch (e) {
    console.error("Opstelling-herinnering fout:", e && e.message || e);
    return new Response("fout: " + (e && e.message || e), { status: 500 });
  }
};

export const config = { schedule: "*/15 * * * *" };
