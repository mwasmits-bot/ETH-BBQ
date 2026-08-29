// Gedeelde webpush-verzendlogica. Gebruikt door:
//  - push.js            → admin verstuurt direct, of maakt een gepland/periodiek bericht aan
//  - pushplanner.js      → verstuurt geplande/periodieke berichten op tijd
//  - opstellingherinnering.js blijft zijn eigen (oudere) kopie gebruiken — bewust niet aangeraakt
import webpush from "web-push";

export function vapidKlaarzetten() {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return false;
  const subject = process.env.VAPID_SUBJECT || "mailto:info@ethscoritobbq.com";
  webpush.setVapidDetails(subject, publicKey, privateKey);
  return true;
}

// Stuurt naar alle abonnees uit "push-abonnees" en ruimt verlopen abonnementen
// (404/410 van de browser) meteen op. Geeft het aantal geslaagde meldingen terug.
export async function verstuurNaarAlleAbonnees(store, { titel, tekst, url }) {
  const abonnees = (await store.get("push-abonnees", { type: "json" })) || {};
  const payload = JSON.stringify({ titel, tekst, url: url || "https://ethscoritobbq.com" });

  let aantal = 0;
  const verlopen = [];
  for (const [naam, lijst] of Object.entries(abonnees)) {
    for (const abo of lijst) {
      try {
        await webpush.sendNotification({ endpoint: abo.endpoint, keys: abo.keys }, payload);
        aantal++;
      } catch (e) {
        if (e && (e.statusCode === 404 || e.statusCode === 410)) {
          verlopen.push({ naam, endpoint: abo.endpoint });
        } else {
          console.error("Pushmelding mislukt voor", naam, (e && e.message) || e);
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

  return aantal;
}

// Bewaart de laatste 200 verzendingen zodat de admin een geschiedenis kan zien.
export async function voegGeschiedenisToe(store, entry) {
  const geschiedenis = (await store.get("push-geschiedenis", { type: "json" })) || [];
  geschiedenis.push(entry);
  while (geschiedenis.length > 200) geschiedenis.shift();
  await store.setJSON("push-geschiedenis", geschiedenis);
}
