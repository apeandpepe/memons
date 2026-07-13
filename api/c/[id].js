// =====================================================================
//  MEMONS — /c/[id]
//  A short share link. The card id alone is enough:
//
//      https://apepe.io/c/common_mrh1jqh8pqo
//
//  The card's artwork lives in Supabase Storage under a predictable path,
//  so the id is all we need to build the image URL — no long query string in
//  the tweet. X reads the Open Graph tags below and renders the card art as a
//  large image; a human who clicks the link lands on the capsule page.
//
//  Vercel maps this file to /c/:id via the rewrite in vercel.json.
// =====================================================================

const SITE = "MEMONS";
const CAPSULE_PATH = "/open-capsule.html";

// Card artwork: <bucket>/<rarity>/<card_id>.png
// Card ids look like "common_mrh1jqh8pqo", so the rarity is the prefix.
const STORAGE_BASE =
  "https://neixdrtamznrooougcda.supabase.co/storage/v1/object/public/cards";

const RARITIES = ["common", "rare", "epic", "legendary", "mythic", "special"];

function esc(s = "") {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export default function handler(req, res) {
  const proto = (req.headers["x-forwarded-proto"] || "https").split(",")[0];
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const origin = `${proto}://${host}`;

  // id is safe by construction: letters, digits and underscore only
  const id = String(req.query.id || "").replace(/[^a-zA-Z0-9_]/g, "").slice(0, 64);
  const rarity = RARITIES.find((r) => id.startsWith(r + "_")) || "";

  const image = rarity
    ? `${STORAGE_BASE}/${rarity}/${id}.png`
    : `${origin}/images/detail/common.png`;

  const RARITY = rarity ? rarity.toUpperCase() : "MEMONS";
  const title = rarity ? `${RARITY} card — ${SITE}` : `${SITE} Capsule`;
  const desc = rarity
    ? `Pulled a ${RARITY} card from MEMONS. Open yours.`
    : "Open a MEMONS capsule and collect the cards.";

  const target = `${origin}${CAPSULE_PATH}`;

  res.setHeader("content-type", "text/html; charset=utf-8");
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
<meta property="og:image:alt" content="${esc(RARITY)} MEMONS card">
<meta property="og:url" content="${esc(origin)}/c/${esc(id)}">

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
