# ETH Scorito BBQ 🏆🍖 — Netlify-versie

Eredivisie-poule dashboard met AI-screenshotextractie, seizoensrecords, positieverloop,
mail-tips en Hall of Fame. Deploy volledig via de browser — geen Terminal nodig.
Zelfde aanpak als de keuken-benchmark-app.

## Mapstructuur
```
eth-scorito-bbq/
├── index.html                      # de complete app
├── netlify.toml                    # config
├── package.json                    # nodig voor de opslag-library
└── netlify/functions/
    ├── data.js                     # pouledata lezen/schrijven (Netlify Blobs)
    ├── verify.js                   # admin-login controleren
    └── extract.js                  # veilige proxy naar de Claude API
```

## Environment variables (2 stuks, stel je in bij Netlify)
| Naam | Waarde |
|---|---|
| `ADMIN_WACHTWOORD` | het wachtwoord waarmee jij inlogt als admin (verzin je zelf) |
| `ANTHROPIC_API_KEY` | je API-sleutel van console.anthropic.com |

---

## Stap 1 — GitHub-repo vullen (via de website)

Maak op github.com een nieuwe lege repo aan, bijv. `eth-scorito-bbq`.

**De platte bestanden:** klik **Add file → Upload files** en sleep erin:
`index.html`, `netlify.toml`, `package.json` (en dit README als je wilt).
Onderaan **Commit changes**.

**De drie functiebestanden** (die zitten in een submap, dus die maak je zo aan):
1. **Add file → Create new file**
2. Typ in het naamveld exact, mét schuine strepen: `netlify/functions/data.js`
   (GitHub maakt de mappen vanzelf aan terwijl je de `/` typt)
3. Open het bestand `netlify/functions/data.js` uit deze map op je Mac (rechtsklik →
   Open met → TextEdit), kopieer alles, plak in het grote tekstvak, **Commit changes**
4. Herhaal voor `netlify/functions/verify.js` en `netlify/functions/extract.js`

## Stap 2 — Netlify koppelen

1. netlify.com → **Add new site → Import an existing project → GitHub** → kies de repo
2. **Build command:** leeg laten · **Publish directory:** `.` (een punt)
3. **Deploy**

## Stap 3 — De twee variabelen instellen

**Site configuration → Environment variables → Add a variable:**
- `ADMIN_WACHTWOORD` = jouw zelfgekozen wachtwoord
- `ANTHROPIC_API_KEY` = jouw sleutel

Daarna éénmalig: **Deploys → Trigger deploy → Deploy site** (nodig omdat de
variabelen ná de eerste deploy zijn toegevoegd).

Klaar! Je krijgt een URL als `https://eth-scorito-bbq.netlify.app` — die deel je
met je vrienden. Zelf log je in via de Admin-knop rechtsboven.

---

## Hoe het werkt
- Vrienden zien standen, weekoverzicht, positieverloop en Hall of Fame (alleen-lezen)
- De pouledata staat in **Netlify Blobs** (ingebouwde opslag, niets extra's nodig,
  blijft bewaard over deploys heen)
- Alle schrijfacties en de screenshot-extractie vereisen jouw wachtwoord,
  dat serverside wordt gecontroleerd
- Je API-sleutel staat alléén in Netlify — nooit in de code of de browser

## Wachtwoord wijzigen
Site configuration → Environment variables → `ADMIN_WACHTWOORD` aanpassen →
Deploys → Trigger deploy.

## Kosten
- Netlify: gratis tier is ruim voldoende
- Claude API: enkele centen per screenshot-extractie (±3 per speelronde)

## App aanpassen later
Nieuwe versie van `index.html`? Op GitHub het bestand openen → potloodje →
inhoud vervangen → Commit. Netlify deployt automatisch.
