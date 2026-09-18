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

// Pushmeldingen voor "nieuwe Side Bet" gebruiken bewust een EIGEN abonneelijst
// ("push-bet-abonnees", zie push.js actie abonneren/afmelden met doel:"bets") in
// plaats van "push-abonnees". Die laatste is de opt-in lijst die opstellingherinnering.js
// ongefilterd leegtrekt voor de opstelling-herinnering — hergebruik daarvan zou betekenen
// dat iemand die zich alleen voor Side Bet-pushmeldingen aanmeldt, ongevraagd ook
// opstelling-herinneringen zou gaan krijgen.
export async function verstuurNaarBetAbonnees(store, namen, { titel, tekst, url }) {
  if (!namen || !namen.length) return 0;
  const naamSet = new Set(namen);
  const abonnees = (await store.get("push-bet-abonnees", { type: "json" })) || {};
  const payload = JSON.stringify({ titel, tekst, url: url || "https://ethscoritobbq.com" });

  let aantal = 0;
  const verlopen = [];
  for (const [naam, lijst] of Object.entries(abonnees)) {
    if (!naamSet.has(naam)) continue;
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
    await store.setJSON("push-bet-abonnees", abonnees);
  }

  return aantal;
}

// Faalt altijd stil (net als meldAdmin/meldAbonnees uit _notify.js) — een mislukte
// pushmelding mag een inzending nooit blokkeren.
export async function meldNamenPush(store, namen, titel, tekst, url) {
  try {
    if (!vapidKlaarzetten()) return;
    await verstuurNaarBetAbonnees(store, namen, { titel, tekst, url });
  } catch (e) {
    console.error("Push naar abonnees mislukt:", (e && e.message) || e);
  }
}
