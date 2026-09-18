// Web Push-abonnementen voor de opstelling-herinnering (1 uur voor de eerste
// wedstrijd van de speelronde — zie opstellingherinnering.js voor het versturen).
//
// GET  -> publieke VAPID-sleutel (nodig door de browser om te abonneren; geen auth)
// POST -> { actie: 'abonneren' | 'afmelden', deelnemer, wachtwoord, ... }
//
// Wachtwoordcontrole zelfde patroon als sidebets.js: eigen wachtwoord uit de poule,
// of admin. Bewaard per deelnemer als lijst (meerdere toestellen/browsers kunnen).
//
// Daarnaast beheert dit bestand ook de handmatige pushberichten van de admin
// (tabblad "📲 Pushmeldingen"): direct versturen, of aanmaken/verwijderen/pauzeren
// van een gepland of periodiek bericht — het echte versturen daarvan gebeurt in
// pushplanner.js (een geplande functie die elke 5 minuten checkt wat er klaarstaat).
import { getStore } from "@netlify/blobs";
import { vapidKlaarzetten, verstuurNaarAlleAbonnees, voegGeschiedenisToe } from "./_push.js";

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

  const pushBeheerActies = ["aanmaken", "lijst", "verwijderen", "pauzeren", "hervatten"];
  if (pushBeheerActies.includes(body.actie)) {
    if (!isAdmin) return Response.json({ fout: "Geen toegang — log in als admin." }, { status: 401 });

    if (body.actie === "lijst") {
      const berichten = (await store.get("push-berichten", { type: "json" })) || {};
      const geschiedenis = (await store.get("push-geschiedenis", { type: "json" })) || [];
      return Response.json({
        berichten: Object.values(berichten).sort((a, b) => a.volgende - b.volgende),
        geschiedenis: geschiedenis.slice(-50).reverse()
      });
    }

    if (body.actie === "aanmaken") {
      const titel = String(body.titel || "").trim();
      const tekst = String(body.tekst || "").trim();
      const url = String(body.url || "").trim() || "https://ethscoritobbq.com";
      const wanneer = body.wanneer;
      if (!titel || !tekst) return Response.json({ fout: "Titel en tekst zijn verplicht." }, { status: 400 });

      if (wanneer === "nu") {
        if (!vapidKlaarzetten()) {
          return Response.json({ fout: "VAPID-sleutels ontbreken in Netlify — pushmeldingen zijn nog niet ingesteld." }, { status: 500 });
        }
        const aantal = await verstuurNaarAlleAbonnees(store, { titel, tekst, url });
        await voegGeschiedenisToe(store, { titel, tekst, url, verstuurdOp: new Date().toISOString(), aantal, type: "direct" });
        return Response.json({ ok: true, aantal });
      }

      if (wanneer !== "gepland" && wanneer !== "periodiek") {
        return Response.json({ fout: "Onbekende 'wanneer'-waarde." }, { status: 400 });
      }
      const tijdstip = Number(body.tijdstip);
      if (!Number.isFinite(tijdstip)) return Response.json({ fout: "Ongeldig tijdstip." }, { status: 400 });

      const berichten = (await store.get("push-berichten", { type: "json" })) || {};
      const id = "p_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      berichten[id] = {
        id, titel, tekst, url,
        type: wanneer === "periodiek" ? "periodiek" : "eenmalig",
        interval: wanneer === "periodiek" ? (body.interval === "wekelijks" ? "wekelijks" : "dagelijks") : null,
        volgende: tijdstip,
        actief: true,
        laatstVerstuurd: null,
        aantalKeerVerstuurd: 0,
        aangemaaktOp: Date.now()
      };
      await store.setJSON("push-berichten", berichten);
      return Response.json({ ok: true, bericht: berichten[id] });
    }

    if (body.actie === "verwijderen") {
      const berichten = (await store.get("push-berichten", { type: "json" })) || {};
      if (berichten[body.id]) {
        delete berichten[body.id];
        await store.setJSON("push-berichten", berichten);
      }
      return Response.json({ ok: true });
    }

    if (body.actie === "pauzeren" || body.actie === "hervatten") {
      const berichten = (await store.get("push-berichten", { type: "json" })) || {};
      const bericht = berichten[body.id];
      if (!bericht) return Response.json({ fout: "Bericht niet gevonden." }, { status: 404 });
      bericht.actief = body.actie === "hervatten";
      await store.setJSON("push-berichten", berichten);
      return Response.json({ ok: true, bericht });
    }
  }

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

  // "doel" kiest de opslagplek: "herinnering" (standaard, opstelling-herinnering) of
  // "bets" (nieuwe Side Bet-meldingen) — bewust gescheiden lijsten, zodat je voor het
  // ene kunt aanmelden zonder automatisch ook het andere te krijgen.
  const sleutel = body.doel === "bets" ? "push-bet-abonnees" : "push-abonnees";
  const abonnees = (await store.get(sleutel, { type: "json" })) || {};

  if (body.actie === "abonneren") {
    const sub = body.subscription;
    if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) {
      return Response.json({ fout: "Ongeldig push-abonnement." }, { status: 400 });
    }
    const lijst = (abonnees[naam] || []).filter(a => a.endpoint !== sub.endpoint);
    lijst.push({ endpoint: sub.endpoint, keys: sub.keys, toegevoegdOp: new Date().toISOString() });
    abonnees[naam] = lijst;
    await store.setJSON(sleutel, abonnees);
    return Response.json({ ok: true });
  }

  if (body.actie === "afmelden") {
    if (abonnees[naam]) {
      abonnees[naam] = body.endpoint
        ? abonnees[naam].filter(a => a.endpoint !== body.endpoint)
        : [];
      if (!abonnees[naam].length) delete abonnees[naam];
      await store.setJSON(sleutel, abonnees);
    }
    return Response.json({ ok: true });
  }

  return Response.json({ fout: "Onbekende actie." }, { status: 400 });
};
