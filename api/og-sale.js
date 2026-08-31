// =====================================================================
//  MEMONS — /api/og-sale
//  The image X shows when a seller shares a completed sale.
//
//  Usage:  /api/og-sale?t=<trade_id>
//
//  The trade id is the only input. Price, name and rarity are read from
//  the database here — a share image outlives the moment it was made,
//  and a version that drew whatever number arrived in the query string
//  would let anyone publish a MEMONS-branded picture of a sale that
//  never happened.
//
//  Nothing is composed here. Six backdrops carry the whole design —
//  wording, plates, logo, the % sign, the arrow — and this endpoint puts
//  four values on top: the card, the price, the percentage, the name.
//  Which backdrop depends on the rarity and on whether the sale was up
//  or down on the capsule price.
//
//  Coordinates come from share-tuner.html and are percentages of the
//  1800x942 canvas, so they can be re-tuned by eye without arithmetic.
// =====================================================================

import { ImageResponse } from "@vercel/og";

export const config = { runtime: "edge" };

const W = 1800;
const H = 942;

const STORAGE_BASE =
  "https://neixdrtamznrooougcda.supabase.co/storage/v1/object/public/cards";

const SB_URL  = "https://neixdrtamznrooougcda.supabase.co";
const SB_ANON = "sb_publishable_xXzlHTJ4cX8kJoEGXw_csw_q5qFK1nO";

// Only these three trade, so only these three have backdrops. Anything
// else gets no image rather than a broken one.
const RARITIES = ["epic", "legendary", "mythic"];

/* ---------------------------------------------------------------------
   The typeface.

   Left unstated, this renderer falls back to its own default, and the
   figures come out in a face the artwork never uses -- next to USDT and
   SOLD FOR, which are Chakra Petch printed into the backdrop, the
   mismatch is the first thing anyone sees.

   Loaded once per instance rather than per request: the file is small
   and constant, and fetching it again for every share image would put a
   round trip in front of a picture that is otherwise cached forever.
--------------------------------------------------------------------- */
let FONT = null;
async function chakraBold(origin) {
  if (FONT) return FONT;
  const r = await fetch(`${origin}/fonts/ChakraPetch-Bold.ttf`);
  if (!r.ok) return null;
  FONT = await r.arrayBuffer();
  return FONT;
}

/* ---------------------------------------------------------------------
   Layout, from share-tuner.html.

   Keyed by rarity then direction. legendary and mythic place their
   values identically in both directions, so the same object is named
   twice rather than copied — a copy is a second place to forget.

   card.x is slightly negative on every rarity: the slot begins a little
   outside the left edge. The artwork is fitted inside that slot with
   contain, so what hangs over the edge is empty space, not card.
--------------------------------------------------------------------- */
const EPIC_UP = {
  card:  { x: -1.96, y: 2.48, w: 60, h: 90 },
  price: { x: 79.49, y: 47.23, size: 5.55, align: "right", color: "#ffffff", weight: 800 },
  pct:   { x: 73.96, y: 66.92, size: 4.85, align: "right", color: "#ffffff", weight: 800 },
  name:  { x: 55.11, y: 81.81, size: 2.11, align: "left",  color: "#ffffff", weight: 700 },
};

// Only the price sits differently; the other three match EPIC_UP.
const EPIC_DOWN = {
  card:  { x: -1.96, y: 2.48, w: 60, h: 90 },
  price: { x: 79.49, y: 46.36, size: 5.55, align: "right", color: "#ffffff", weight: 800 },
  pct:   { x: 73.96, y: 66.92, size: 4.85, align: "right", color: "#ffffff", weight: 800 },
  name:  { x: 55.11, y: 81.81, size: 2.11, align: "left",  color: "#ffffff", weight: 700 },
};

const LEGENDARY = {
  card:  { x: -1.96, y: 2.48, w: 60, h: 90 },
  price: { x: 79.76, y: 45.15, size: 5.55, align: "right", color: "#ffffff", weight: 800 },
  pct:   { x: 71.59, y: 65.87, size: 4.85, align: "right", color: "#ffffff", weight: 800 },
  name:  { x: 56.11, y: 82.33, size: 2.11, align: "left",  color: "#ffffff", weight: 700 },
};

const MYTHIC = {
  card:  { x: -1.96, y: 2.48, w: 60, h: 90 },
  price: { x: 79.85, y: 47.75, size: 5.55, align: "right", color: "#ffffff", weight: 800 },
  pct:   { x: 72.41, y: 69.00, size: 4.85, align: "right", color: "#ffffff", weight: 800 },
  name:  { x: 56.38, y: 85.98, size: 2.11, align: "left",  color: "#ffffff", weight: 700 },
};

const LAYOUT = {
  epic:      { up: EPIC_UP,   down: EPIC_DOWN },
  legendary: { up: LEGENDARY, down: LEGENDARY },
  mythic:    { up: MYTHIC,    down: MYTHIC },
};

/* ---------------------------------------------------------------------
   The sale itself. One call, one row: a trade id that matches nothing
   gets no image rather than an empty frame. An empty frame posted to a
   timeline reads as a broken site; a missing image reads as a link that
   expired.
--------------------------------------------------------------------- */
async function saleOf(id) {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/rpc/trade_share`, {
      method: "POST",
      headers: {
        apikey: SB_ANON,
        Authorization: "Bearer " + SB_ANON,
        "content-type": "application/json",
      },
      body: JSON.stringify({ p_id: Number(id) }),
    });
    if (!r.ok) return null;
    const rows = await r.json();
    const row = Array.isArray(rows) ? rows[0] : rows;
    return row && row.card_id ? row : null;
  } catch {
    return null;
  }
}

// cards.name holds only the number within its rarity, the same as on the
// marketplace. A name that is not a bare number is shown as it is.
function displayName(name, cardId) {
  const n = String(name == null ? "" : name).trim();
  if (/^\d+$/.test(n)) return "APEPE #" + n;
  return n || cardId || "";
}

const el = (type, props) => ({ type, props });

/* A value, placed by one edge rather than centred in a box.

   Giving the box a width made the browser and this renderer measure
   differently and the position drifted from what the tuner showed. A
   generous box pinned to one edge lands the same in both — which is why
   price and pct are anchored right: USDT and % are printed on the
   backdrop, so those figures have to end in a fixed place and grow
   leftwards as they get longer. */
function value(s, text) {
  const fs = (s.size / 100) * W;
  const x  = (s.x / 100) * W;
  const y  = (s.y / 100) * H;
  const box = 900;

  const common = {
    position: "absolute",
    top: `${Math.round(y - fs)}px`,
    height: `${Math.round(fs * 2)}px`,
    width: `${box}px`,
    display: "flex",
    alignItems: "center",
    fontSize: `${Math.round(fs)}px`,
    fontFamily: "Chakra Petch",
    fontWeight: s.weight,
    color: s.color,
    lineHeight: 1,
  };

  const placed =
    s.align === "right"
      ? { left: `${Math.round(x - box)}px`, justifyContent: "flex-end" }
      : s.align === "center"
      ? { left: `${Math.round(x - box / 2)}px`, justifyContent: "center" }
      : { left: `${Math.round(x)}px`, justifyContent: "flex-start" };

  return el("div", { style: { ...common, ...placed }, children: text });
}

export default async function handler(req) {
  const url = new URL(req.url);

  // Trade ids are bigints. Stripped to digits rather than parsed: the
  // value is put straight into a JSON body, and a string of digits
  // cannot carry anything else into it.
  const t = (url.searchParams.get("t") || "")
    .replace(/[^0-9]/g, "")
    .slice(0, 19);

  const sale = t ? await saleOf(t) : null;
  if (!sale || !LAYOUT[sale.rarity]) {
    return new Response("not found", {
      status: 404,
      headers: { "cache-control": "public, max-age=60" },
    });
  }

  const rarity = sale.rarity;
  const price  = Number(sale.price) || 0;
  const base   = Number(sale.capsule_price) || 0;

  /* Measured against the capsule price, always — including for a card
     bought on the market rather than pulled. The backdrop says so in its
     own label, so the figure is what it claims to be: what this card has
     done since it left a capsule, not what this seller made.

     With no capsule price to measure against there is no direction and
     no backdrop to choose, so the request is refused rather than
     answered with a picture that quietly says zero. */
  if (!(base > 0)) {
    return new Response("no capsule price", {
      status: 404,
      headers: { "cache-control": "public, max-age=60" },
    });
  }

  const pct = ((price - base) / base) * 100;
  const dir = pct >= 0 ? "up" : "down";
  const L   = LAYOUT[rarity][dir];

  /* The sign is drawn, never printed on the backdrop. A "+" baked into
     the artwork would read "+-15%" the moment a card sold below capsule,
     and the down backdrops exist precisely because that happens. The %
     itself is on the backdrop, so only the number and its sign go here. */
  const pctText =
    (pct >= 0 ? "+" : "\u2212") +
    Math.abs(Math.round(pct)).toLocaleString("en-US");

  /* The font is fetched with the rest, not before it. A crawler waits a
     short time and then gives up; making it queue behind a font request
     that only matters on a cold instance is the difference between a
     card and no card. */
  const font = await Promise.race([
    chakraBold(url.origin),
    new Promise((r) => setTimeout(() => r(null), 2500)),
  ]);

  const bg = `${url.origin}/images/og/sale-${rarity}-${dir}.png`;

  /* Card art through Supabase's rendering endpoint rather than straight
     from storage.

     The cards are webp. This renderer reads png and jpeg and leaves a
     webp out silently -- the frame draws, the card does not, and nothing
     says why. Asking storage to render it gives back a format that can
     be decoded, and the file on disk stays as it is.

     contain, not the default: cover crops to the box it is given, and a
     card cropped square loses its own frame. The box is deliberately
     taller than any card so contain has nothing to trim. */
  const src = sale.image_url ||
    `${STORAGE_BASE}/${rarity}/${sale.card_id}.webp`;
  const card = src.replace(
    "/storage/v1/object/public/",
    "/storage/v1/render/image/public/",
  ) + "?width=1000&height=1600&resize=contain";

  return new ImageResponse(
    el("div", {
      style: {
        width: `${W}px`, height: `${H}px`,
        display: "flex", position: "relative", backgroundColor: "#000000",
      },
      children: [
        el("img", {
          src: bg,
          width: W, height: H,
          style: { position: "absolute", left: 0, top: 0,
                   width: `${W}px`, height: `${H}px` },
        }),
        el("img", {
          src: card,
          style: {
            position: "absolute",
            left:   `${Math.round((L.card.x / 100) * W)}px`,
            top:    `${Math.round((L.card.y / 100) * H)}px`,
            width:  `${Math.round((L.card.w / 100) * W)}px`,
            height: `${Math.round((L.card.h / 100) * H)}px`,
            objectFit: "contain",
          },
        }),
        value(L.price, price.toFixed(2)),
        value(L.pct,   pctText),
        value(L.name,  displayName(sale.card_name, sale.card_id)),
      ],
    }),
    {
      width: W,
      height: H,
      /* One weight is enough: every value drawn here is bold. A missing
         file is not fatal -- the renderer falls back to its own face,
         which is worse looking but still a picture. */
      fonts: font
        ? [{ name: "Chakra Petch", data: font, weight: 700, style: "normal" }]
        : undefined,
      headers: {
        /* A trade never changes. Unlike /api/og — which draws a price the
           admin can edit and so expires in an hour — every figure here is
           fixed the moment the sale settles, so the picture can be held
           for as long as anything cares to hold it. */
        "cache-control": "public, max-age=31536000, s-maxage=31536000, immutable",
      },
    },
  );
}
