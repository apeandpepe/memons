// =====================================================================
//  MEMONS — /r/[code]   (referral short link)
//
//      https://apepe.io/r/7Kd9Xp
//
//  Drops a `memons_ref` cookie (readable by the app) and sends the visitor
//  to the home page. When they connect a wallet and link X, the referral is
//  attributed to the code owner (server-side).
//
//  SAVE THIS FILE AS:  api/r/[code].js
//  Vercel maps it to /r/:code via the rewrite added to vercel.json.
// =====================================================================
export default function handler(req, res) {
  const proto = (req.headers["x-forwarded-proto"] || "https").split(",")[0];
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const origin = `${proto}://${host}`;

  // code is safe by construction: letters + digits only, max 12
  const code = String(req.query.code || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 12);

  if (code) {
    // 30 days, readable by client JS (no HttpOnly), same-site lax
    res.setHeader("Set-Cookie", `memons_ref=${code}; Path=/; Max-Age=2592000; SameSite=Lax`);
  }

  res.statusCode = 302;
  res.setHeader("Location", `${origin}/?ref=${encodeURIComponent(code)}`);
  res.end();
}
