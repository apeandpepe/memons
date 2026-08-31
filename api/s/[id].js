// =====================================================================
//  MEMONS — /s/[id]
//  The short link a seller posts:
//
//      https://apepe.io/s/1482
//
//  X cannot be handed a picture. It is handed an address, fetches it,
//  and renders whatever the Open Graph tags below name. So this page
//  exists only to name the image; a person who clicks the link is moved
//  on to the marketplace.
//
//  Vercel maps this file to /s/:id via the rewrite in vercel.json.
//
//  No cache version here, unlike /c/:id. That one needs a ?v= because a
//  card's picture can be redrawn while its address stays the same, so X
//  keeps serving the copy it already holds. A trade id names one sale
//  that has already settled: the address is new every time and what it
//  draws never changes again.
// =====================================================================

const SITE = "MEMONS";
const MARKET_PATH = "/marketplace.html";

function esc(s = "") {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/* The site answers on apepe.io and on www.apepe.io, and apepe.io
   redirects. A crawler that is handed the bare host reads og:url and
   canonical naming an address that then moves it somewhere else --
   which is a crawler being told, mid-read, that the real document is
   elsewhere. It follows, and what it finds there is this page again
   under a different name.

   So the canonical host is decided here rather than taken from whichever
   name the request happened to arrive under. */
const CANONICAL_HOST = "www.apepe.io";

export default function handler(req, res) {
  const proto = (req.headers["x-forwarded-proto"] || "https").split(",")[0];
  const raw = req.headers["x-forwarded-host"] || req.headers.host || "";

  // Preview deployments have their own hostnames and must keep them;
  // only the production names are folded onto the canonical one.
  const host = /(^|\.)apepe\.io$/i.test(raw) ? CANONICAL_HOST : raw;
  const origin = `${proto}://${host}`;

  // Digits only. The id goes straight into an address, so it is cut down
  // to the characters a trade id can contain before it goes anywhere.
  const id = String(req.query.id || "")
    .replace(/[^0-9]/g, "")
    .slice(0, 19);

  const image = `${origin}/api/og-sale?t=${encodeURIComponent(id)}`;

  // Must match what /api/og-sale actually draws.
  const OG_W = 1800;
  const OG_H = 942;

  const title = `Card sold — ${SITE} Marketplace`;
  const desc = "A card just sold on MEMONS Marketplace. See what yours is worth.";

  const target = `${origin}${MARKET_PATH}`;
  const self = `${origin}/s/${id}`;

  res.setHeader("content-type", "text/html; charset=utf-8");
  res.setHeader("cache-control", "public, max-age=60, s-maxage=60");

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
<meta property="og:image:secure_url" content="${esc(image)}">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="${OG_W}">
<meta property="og:image:height" content="${OG_H}">
<meta property="og:image:alt" content="A MEMONS card sale">
<meta property="og:url" content="${esc(self)}">

<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${esc(image)}">
<meta name="twitter:image:alt" content="A MEMONS card sale">

<!-- Canonical names this page, not the marketplace. Point it at the
     marketplace and a crawler is being told the real document is over
     there: it goes and reads that page's tags instead, and everything
     above is thrown away.

     The redirect is a script for the same reason. A meta refresh is
     markup and crawlers follow it; a script is not, so they stay here
     with the tags while a person is moved on. The link below is the
     fallback for anyone with scripting off. -->
<link rel="canonical" href="${esc(self)}">
</head>
<body style="margin:0;background:#050505;color:#e8e6e0;font-family:system-ui,sans-serif;
             display:flex;align-items:center;justify-content:center;height:100vh">
  <a href="${esc(target)}" style="color:#E9B84A;text-decoration:none">Open MEMONS Marketplace →</a>
  <script>location.replace(${JSON.stringify(target)});</script>
</body>
</html>`);
}
