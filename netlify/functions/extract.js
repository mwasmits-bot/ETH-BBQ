// Veilige proxy naar de Claude API voor screenshot-extractie.
// De API-sleutel staat alleen in Netlify als environment variable (ANTHROPIC_API_KEY).
// Alleen aan te roepen met het juiste x-wachtwoord, zodat niemand anders op jouw tegoed kan draaien.
export default async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const juist = process.env.ADMIN_WACHTWOORD;
  if (!juist) return Response.json({ fout: "ADMIN_WACHTWOORD is niet ingesteld in Netlify." }, { status: 500 });
  if ((req.headers.get("x-wachtwoord") || "") !== juist) {
    return Response.json({ fout: "Onjuist wachtwoord." }, { status: 401 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return Response.json({ fout: "ANTHROPIC_API_KEY is niet ingesteld in Netlify." }, { status: 500 });

  let body;
  try { body = await req.json(); } catch { body = null; }
  const { image, mime, prompt } = body || {};
  if (!image || !mime || !prompt) {
    return Response.json({ fout: "Onvolledig verzoek (image, mime en prompt zijn verplicht)." }, { status: 400 });
  }

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1500,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mime, data: image } },
          { type: "text", text: prompt }
        ]
      }]
    })
  });

  if (!resp.ok) {
    const t = await resp.text();
    console.error("Claude API-fout:", resp.status, t);
    return Response.json({ fout: "Claude API gaf een fout (" + resp.status + ")." }, { status: 502 });
  }

  const json = await resp.json();
  const tekst = (json.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
  return Response.json({ tekst });
};
