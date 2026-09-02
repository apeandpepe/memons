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
//  Nothing is composed here. Three backdrops carry the whole design —
//  wording, SOLD, logo, USDT — and this endpoint puts two things on top:
//  the card and the price. One backdrop per rarity.
//
//  There used to be six, split by whether the sale was up or down on the
//  capsule price, because the artwork carried a percentage. The artwork
//  no longer does, so the direction no longer picks anything and the
//  capsule price is not needed to draw the image.
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
   Layout.

   Every backdrop is the same drawing in a different colour, so one set
   of numbers serves all three. Kept as a single object rather than one
   per rarity: three copies of identical figures is three places to
   forget when one of them moves.

   card.x is slightly negative: the slot begins a little outside the left
   edge. The artwork is fitted inside with contain, so what hangs over
   the edge is empty space, not card.

   price.x is the right edge, not the left. USDT is printed on the
   backdrop, so the figure has to end in a fixed place and grow leftwards
   as it gets longer.

   Every one of these can be overridden from the query string -- see the
   handler -- so they can be re-tuned against the rendered image rather
   than a browser's guess at it.
--------------------------------------------------------------------- */
const LAYOUT = {
  card:  { x: -1.96, y: 2.48, w: 60, h: 90 },
  price: { x: 81.0, y: 71.0, size: 10.0, align: "right", color: "#ffffff", weight: 800 },
};

// Only these three trade, so only these three have backdrops.
const HAS_BG = { epic: 1, legendary: 1, mythic: 1 };

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
  if (!sale || !HAS_BG[sale.rarity]) {
    return new Response("not found", {
      status: 404,
      headers: { "cache-control": "public, max-age=60" },
    });
  }

  const rarity = sale.rarity;
  const price  = Number(sale.price) || 0;

  /* Layout numbers, overridable from the query string, the same way
     /api/og takes them. A position set by eye has to be judged on the
     image that will actually ship, not on a browser's rendering of a
     copy of it, and the only way to see that image is to ask for it.

     Absent, every one falls back to the figure in LAYOUT above, so a
     normal request is untouched by any of this. */
  const q = (k, d) => {
    const v = Number(url.searchParams.get(k));
    return Number.isFinite(v) && url.searchParams.has(k) ? v : d;
  };

  const L = {
    card: {
      x: q("cx", LAYOUT.card.x), y: q("cy", LAYOUT.card.y),
      w: q("cw", LAYOUT.card.w), h: q("ch", LAYOUT.card.h),
    },
    price: {
      ...LAYOUT.price,
      x: q("px", LAYOUT.price.x),
      y: q("py", LAYOUT.price.y),
      size: q("ps", LAYOUT.price.size),
    },
  };

  /* A figure to lay out against. The plate has to hold the widest number
     it will ever be given, and a real sale rarely obliges. Ignored unless
     asked for. */
  const shown = url.searchParams.has("p")
    ? Number(url.searchParams.get("p"))
    : price;

  /* The font is fetched with the rest, not before it. A crawler waits a
     short time and then gives up; making it queue behind a font request
     that only matters on a cold instance is the difference between a
     card and no card. */
  const font = await Promise.race([
    chakraBold(url.origin),
    new Promise((r) => setTimeout(() => r(null), 2500)),
  ]);

  /* One backdrop per rarity, named for it. `bg` swaps it for another
     file under images/og, so a candidate can be compared against the
     one in use without moving files around. */
  const bgFile = (url.searchParams.get("bg") || "").trim()
    .replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 64);
  const bg = `${url.origin}/images/og/${bgFile || rarity + "-sale.png"}`;

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
        value(L.price, shown.toFixed(2)),
      ],
    }),
    {
      width: W,
      height: H,
      /* One weight is enough: every value drawn here is bold. A missing
         file is not fatal -- the renderer falls back to its own face,
         which is worse looking but still a picture. */
      /* Every weight, one file. Satori matches on exact weight rather than
         the nearest, so a request for 800 against a font registered only
         at 700 is answered with the renderer's own face -- and the picture
         comes back with some lines in Chakra Petch and some not. */
      fonts: font
        ? [400, 500, 600, 700, 800, 900].map((w) => ({
            name: "Chakra Petch", data: font, weight: w, style: "normal",
          }))
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
