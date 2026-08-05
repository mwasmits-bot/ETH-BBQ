// Eredivisie-wedstrijden per speelronde via football-data.org.
// Plaatsen als: netlify/functions/wedstrijden.js
//
// GET /.netlify/functions/wedstrijden          -> huidige speelronde
// GET /.netlify/functions/wedstrijden?ronde=5  -> speelronde 5
//
// Gebruikt dezelfde environment variable als stand.js: FOOTBALL_DATA_KEY
import { getStore } from "@netlify/blobs";
import { haalSpeelronde } from "./_football.js";

export default async (req) => {
  const store = getStore("eth-scorito-bbq");

  try {
    const url = new URL(req.url);
    const gevraagd = parseInt(url.searchParams.get("ronde") || "", 10);

    const { speelronde, huidigeRonde, wedstrijden } = await haalSpeelronde(store, gevraagd);

    return Response.json(
      { speelronde, huidigeRonde, wedstrijden, bijgewerkt: new Date().toISOString() },
      { headers: { "cache-control": "no-store" } }
    );
  } catch (e) {
    console.error("Wedstrijden-fout:", e.message);
    return Response.json({ fout: e.message }, { status: 500, headers: { "cache-control": "no-store" } });
  }
};
