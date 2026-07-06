// Verifieert het admin-wachtwoord bij het inloggen.
export default async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const juist = process.env.ADMIN_WACHTWOORD;
  if (!juist) return Response.json({ fout: "ADMIN_WACHTWOORD is niet ingesteld in Netlify." }, { status: 500 });
  if ((req.headers.get("x-wachtwoord") || "") !== juist) {
    return Response.json({ fout: "Onjuist wachtwoord." }, { status: 401 });
  }
  return Response.json({ ok: true });
};
