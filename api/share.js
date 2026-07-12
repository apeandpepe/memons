// =====================================================================
//  MEMONS — /api/share
//  A tiny page whose only job is to carry Open Graph tags, so a card that
//  is shared on X shows its actual artwork instead of a bare link.
//
//  Usage (what the share button links to):
//    /api/share?img=<card image url>&r=<RARITY>
//
//  X (and every other crawler) reads the og:/twitter: tags below and renders
//  a large image card. A human who clicks the link is redirected straight to
//  the capsule page, so the URL still behaves like a normal share link.
//
//  Deployed automatically by Vercel: any file under /api is a function.
// =====================================================================

const SITE = "MEMONS";
const CAPSULE_PATH = "/open-capsule.html";

// Only allow images we actually host, so this can't be used to render
// arbitrary third-party images under our domain.
const ALLOWED_IMAGE_HOSTS = [
  "neixdrtamznrooougcda.supabase.co", // card artwork in Supabase Storage
];

function esc(s = "") {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function safeImage(raw, origin) {
  if (!raw) return null;
  try {
    const u = new URL(raw, origin);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    // same-origin images (e.g. /images/detail/epic.png) are fine
    if (u.origin === origin) return u.toString();
    if (ALLOWED_IMAGE_HOSTS.includes(u.hostname)) return u.toString();
    return null;
  } catch {
    return null;
  }
}

export default function handler(req, res) {
  const proto = (req.headers["x-forwarded-proto"] || "https").split(",")[0];
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const origin = `${proto}://${host}`;

  const rarity = String(req.query.r || "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 12);
  const image = safeImage(req.query.img, origin)
    || `${origin}/images/detail/${(rarity || "common").toLowerCase()}.png`;

  const title = rarity
    ? `${rarity} card — ${SITE}`
    : `${SITE} Capsule`;
  const desc = rarity
    ? `Pulled a ${rarity} card from a MEMONS capsule. Open yours.`
    : "Open a MEMONS capsule and collect the cards.";

  const target = `${origin}${CAPSULE_PATH}`;

  res.setHeader("content-type", "text/html; charset=utf-8");
  // let the crawler cache it, but not forever (artwork can change)
  res.setHeader("cache-control", "public, max-age=600, s-maxage=3600");

  res.status(200).send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">

<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(SITE)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(image)}">
<meta property="og:url" content="${esc(target)}">

<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${esc(image)}">

<!-- humans go straight to the capsule; crawlers stop at the tags above -->
<meta http-equiv="refresh" content="0; url=${esc(target)}">
<link rel="canonical" href="${esc(target)}">
</head>
<body style="margin:0;background:#050505;color:#e8e6e0;font-family:system-ui,sans-serif;
             display:flex;align-items:center;justify-content:center;height:100vh">
  <a href="${esc(target)}" style="color:#E9B84A;text-decoration:none">Open a MEMONS capsule →</a>
</body>
</html>`);
}
