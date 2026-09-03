// =====================================================================
//  MEMONS — /api/og
//  The image X actually shows in a tweet.
//
//  X renders summary_large_image at 1.91:1 and crops anything taller, so
//  handing it the raw portrait card slices the top and bottom off. Instead
//  we compose the canvas ourselves and drop the whole card in the middle —
//  same look as the single-pull reveal, never cropped.
//
//  Drawn at twice the size X asks for. The card is portrait inside a
//  landscape frame, so it only ever gets about a third of the width; at
//  1200x630 that left it 322px across and soft on any modern screen. At
//  2400x1256 the same layout gives it 840px and X downsamples rather than
//  stretches.
//
//  The ratio is held at 1.91:1 on purpose. X accepts taller images and then
//  crops them back to this, so anything squarer would just lose its edges.
//
//  Usage:  /api/og?id=<card_id>
// =====================================================================

import { ImageResponse } from "@vercel/og";

export const config = { runtime: "edge" };

/* ---------------------------------------------------------------------
   The typeface.

   Left unstated, this renderer falls back to its own default and the
   figures come out in a face the site never uses -- next to USDT and
   MARKET PRICE, which are drawn here in the same call, the mismatch is
   the first thing anyone sees.

   Loaded once per instance rather than per request: the file is small
   and constant, and fetching it again for every share image would put a
   round trip in front of a picture that is otherwise cached.
--------------------------------------------------------------------- */
let FONT = null;
let FONT_ERR = null;

/* Why the fetch failed, kept so it can be asked for.

   A missing font is not fatal here -- the renderer falls back to its own
   face and still returns a picture -- which is exactly what made this hard
   to place: the image arrives looking almost right and nothing anywhere
   says the file was never read. */
async function chakraBold(origin) {
  if (FONT) return FONT;
  try {
    const url = `${origin}/fonts/ChakraPetch-Bold.ttf`;
    const r = await fetch(url);
    if (!r.ok) { FONT_ERR = `HTTP ${r.status} @ ${url}`; return null; }
    const buf = await r.arrayBuffer();
    if (!buf || buf.byteLength < 1000) {
      FONT_ERR = `too small: ${buf ? buf.byteLength : 0} bytes`;
      return null;
    }
    FONT = buf;
    return FONT;
  } catch (e) {
    FONT_ERR = String(e && e.message ? e.message : e).slice(0, 200);
    return null;
  }
}

const STORAGE_BASE =
  "https://neixdrtamznrooougcda.supabase.co/storage/v1/object/public/cards";

// Kept as components rather than hex strings: the wash needs the same
// colour at low opacity, and building "#E9B84A26" by hand asks the renderer
// to accept eight-digit hex inside a gradient, which is where the last
// version stopped producing an image at all.
const RARITY_COLOR = {
  common:    [207, 204, 196],
  rare:      [91, 155, 213],
  epic:      [196, 104, 216],
  legendary: [233, 184, 74],
  mythic:    [224, 85, 106],
  special:   [233, 184, 74],
};

const rgb  = (c)        => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
const rgba = (c, alpha) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${alpha})`;

/* Painted backdrops, one per rarity.
   A rarity listed here gets its artwork behind the card and nothing else
   drawn -- no gradient, no rarity wording -- because the artwork already
   carries both. A rarity left out falls back to the drawn version, so the
   files can arrive one at a time without the others breaking.

   Files live at /images/og/<name> and must be exactly 1800x942. Anything
   else is stretched to fit, which on a 1.91:1 frame is very visible. */
const BG = {
  common:    "og-common.jpg",
  rare:      "og-rare.jpg",
  epic:      "og-epic.jpg",
  legendary: "og-legendary.jpg",
  mythic:    "og-mythic.jpg",
  // special: "og-special.jpg",
};

const el = (type, props) => ({ type, props });

/* The whole plate as one drawing. The image renderer has no clip-path,
   so the frame is laid over as SVG.

   Two pieces, and the seam between them is a slant: the left piece's right
   edge and the right piece's left edge lean at the same angle so they
   interlock. Two plain rectangles lose that and read as boxes set down
   side by side.

   sk is how far the slant leans across; gap is the space between. */
const plateSvg = (w, h, c, sk, gap, split, stroke, fill, innerFill) => {
  // Outer frame: an octagon, all four corners cut
  const outer =
    `M ${c} 1 L ${w - c} 1 L ${w - 1} ${c} L ${w - 1} ${h - c} L ${w - c} ${h - 1} ` +
    `L ${c} ${h - 1} L 1 ${h - c} L 1 ${c} Z`;

  const p = 8;              // inset from the frame
  const ic = c - 4;         // corner cut on the inner pieces
  const lx = split - gap;   // where the left piece ends, at the bottom
  const rx = split;         // where the right piece starts, at the bottom
  const t = p, b = h - p;

  // Left piece: its right edge leans further right towards the top
  const left =
    `M ${p + ic} ${t} L ${lx + sk} ${t} L ${lx} ${b - ic} L ${lx - ic} ${b} ` +
    `L ${p + ic} ${b} L ${p} ${b - ic} L ${p} ${t + ic} Z`;

  // Right piece: its left edge leans at the same angle and interlocks
  const right =
    `M ${rx + sk} ${t} L ${w - p - ic} ${t} L ${w - p} ${t + ic} L ${w - p} ${b - ic} ` +
    `L ${w - p - ic} ${b} L ${rx - ic} ${b} L ${rx} ${b - ic} Z`;

  return "data:image/svg+xml;utf8," + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<path d="${outer}" fill="${fill}" stroke="${stroke}" stroke-width="2"/>` +
    `<path d="${left}"  fill="${innerFill}" stroke="${stroke}" stroke-width="1.5"/>` +
    `<path d="${right}" fill="${innerFill}" stroke="${stroke}" stroke-width="1.5"/>` +
    `</svg>`);
};

/* The market plate is a single piece. */
const bevelSvg = (w, h, c, stroke, fill) =>
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<path d="M ${c} 1 L ${w - c} 1 L ${w - 1} ${c} L ${w - 1} ${h - c} L ${w - c} ${h - 1} ` +
    `L ${c} ${h - 1} L 1 ${h - c} L 1 ${c} Z" fill="${fill}" stroke="${stroke}" stroke-width="2"/></svg>`,
  );

// The bolt. A text glyph renders monochrome here, so it is drawn.
const boltSvg = (color) =>
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">` +
    `<path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z" fill="${color}"/></svg>`,
  );

// ---------------------------------------------------------------------
// What the card is worth: the buyback price where one applies, otherwise
// the market floor.
//
// Read on the server rather than taken from the query. A share image
// lives on in timelines, and drawing whatever number the client sent
// would let anyone mint a MEMONS image carrying a price of their choosing.
//
// If the lookup fails the plate is left off. A card with no figure beats
// no image at all.
// ---------------------------------------------------------------------
const SB_URL  = "https://neixdrtamznrooougcda.supabase.co";
const SB_ANON = "sb_publishable_xXzlHTJ4cX8kJoEGXw_csw_q5qFK1nO";

async function priceOf(rarity, capsule, id) {
  const H = { apikey: SB_ANON, Authorization: "Bearer " + SB_ANON,
              "content-type": "application/json" };
  const rpc = (fn, body) =>
    fetch(`${SB_URL}/rest/v1/rpc/${fn}`,
          { method: "POST", headers: H, body: body || "{}" })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);

  /* Common and rare are the buyback rarities; epic and up are the market
     ones. Neither figure applies to both, so which one to ask for is
     decided by rarity rather than by whichever happens to be available.

     Buyback used to be read for every rarity whenever it was open, which
     put an epic's market price behind a buyback price it never has. */
  const BUYBACK = { common: 1, rare: 1 };

  try {
    const [open, one] = await Promise.all([
      BUYBACK[rarity] ? rpc("buyback_open") : null,
      (BUYBACK[rarity] || !id)
        ? null
        : rpc("card_price", JSON.stringify({ p_card_id: id })),
    ]);

    /* The only figure common and rare have. Neither trades on the market,
       so their history is empty and nothing else would fill the plate. */
    if (open === true) {
      const r = await fetch(
        `${SB_URL}/rest/v1/buyback_prices?select=price&enabled=is.true&price=gt.0` +
        `&capsule_id=eq.${encodeURIComponent(capsule)}&rarity=eq.${encodeURIComponent(rarity)}`,
        { headers: H },
      ).then((x) => (x.ok ? x.json() : null)).catch(() => null);
      const p = Array.isArray(r) && r[0] && Number(r[0].price);
      if (p > 0) return { label: "INSTANT BUYBACK", price: p };
    }

    /* What this one card last sold for.

       It used to be the rarity floor, which is why thirty epics all
       carried the same number. A floor is a fact about a rarity; the
       image is about a card.

       The listed price is deliberately not used. It is whatever the
       seller is asking, it changes when they change their mind, and an
       image made from it goes on claiming that figure long after the
       listing is gone. A completed trade happened, and stays happened.

       Never traded gives back nothing, and the plate draws a dash. */
    const c = Array.isArray(one) && one[0];
    const cp = c && Number(c.price);
    if (cp > 0) return { label: "MARKET PRICE", price: cp };
  } catch (_) { /* draw without a figure */ }
  return null;
}

export default async function handler(req) {
  const url = new URL(req.url);

  // id is safe by construction: letters, digits and underscore only
  const id = (url.searchParams.get("id") || "")
    .replace(/[^a-zA-Z0-9_]/g, "")
    .slice(0, 64);

  // card ids look like "legendary_mrh1jqh8pqo" — the rarity is the prefix
  const rarity =
    Object.keys(RARITY_COLOR).find((r) => id.startsWith(r + "_")) || "common";
  const rgbc = RARITY_COLOR[rarity];
  const RARITY = rarity.toUpperCase();

  const card = id
    ? `${STORAGE_BASE}/${rarity}/${id}.png`
    : `${url.origin}/images/reveal/sample-card.png`;

  // 1800 rather than 2400. The card is 960px wide in storage and lands at
  // 838px here, so nothing is being stretched -- and every pixel past that
  // is work the edge renderer does for no visible gain, on a canvas whose
  // area it has to hold in memory all at once.
  const W = 1800;
  const H = 942;
  const CARD_H = Math.round(H * 0.89);

  /* Where the card sits on a painted backdrop. Every rarity image follows
     the same template, so one rectangle serves them all -- and anyone
     drawing the next one has a number to draw the plinth against.

     The card floats a little above the plinth rather than resting on it.
     Card artwork is saved on black, and a black bottom edge meeting a lit
     rim draws a hard line across the picture -- 86 levels of difference at
     its worst. Held 45px clear, its base sits in black instead: the
     difference falls to 5, and a card hanging in the light reads as
     deliberate where a card cutting into the plinth reads as a mistake. */
  /* Layout numbers, overridable from the query string.

     They are set by eye against the artwork, and the only honest place to
     do that is the rendered image itself -- a preview drawn in a browser
     is a different renderer at a different size. og-tuner.html points at
     this endpoint and passes the values it is trying, so what is being
     judged is the picture that will ship.

     Absent, every one of them falls back to the tuned figure below, so a
     normal request is untouched by any of this. */
  const q = (k, d) => {
    const v = Number(url.searchParams.get(k));
    return Number.isFinite(v) && url.searchParams.has(k) ? v : d;
  };

  /* Height drives the card; width follows from the artwork's own shape.

     Both were adjustable before, and adjusting the width did nothing
     visible: the card is fitted with `contain`, and at 525x700 the box was
     already the same proportion as the picture, so a wider box only added
     empty space either side. Two controls, one of which appeared broken.

     `cw` still overrides, for the case where the box should not match. */
  const CARD_H2 = q("ch", 625);
  const CARD_W = q("cw", Math.round(CARD_H2 * 958 / 1280));
  const CARD_BOTTOM = q("cb", 700);
  /* Buyback prices differ per capsule. Absent, assume the paid one: a
     share image is where the paid capsule gets shown off. */
  const capsule = (url.searchParams.get("cap") || "paid")
    .replace(/[^a-z]/g, "").slice(0, 16) || "paid";
  let priced = await priceOf(rarity, capsule, id);

  /* A figure to lay out against, for the tuner.

     The plate has to be positioned for the widest number it will ever
     hold, and the market rarely obliges by listing one at the time you are
     looking. Ignored unless asked for. */
  const pOverride = url.searchParams.get("p");
  if (pOverride !== null) {
    const pv = Number(pOverride);
    priced = {
      label: priced ? priced.label : "MARKET PRICE",
      price: Number.isFinite(pv) ? pv : null,
    };
  }

  /* Traded rarities keep the plate even with nothing to put in it.

     The reveal screen already does this, for the reason written there: on
     a quiet day nobody has listed one, and a card whose plate is missing
     reads as a card worth nothing. A dash says the figure comes from the
     market, which is true. The two screens describing the same card
     differently is the thing worth avoiding.

     Rarities with no market at all stay bare, as they do on the screen. */
  const TRADED = { epic: 1, legendary: 1, mythic: 1 };
  if (!priced && TRADED[rarity]) {
    priced = { label: "MARKET PRICE", price: null };
  }

  /* Plate size and position, set with share-tuner.html. The podium in the
     backdrop runs x 620-1172, y 784-860; the plate sits inside its front
     face, narrower than the podium. Wider or higher and it reads as a
     label stuck on top; lower and the canvas cuts it off. */
  const PLATE_W = q("pw", 525);
  const PLATE_H = q("ph", 114);
  const PLATE_TOP = q("pt", 750);
  const PLATE_R = q("pr", 18);
  const FS_LABEL = q("fl", 22);
  const FS_VALUE = q("fv", 33);
  const FS_UNIT  = q("fu", 22);

  const rc = rgb(rgbc);
  /* MYTHIC is a rainbow on the card and on the bar. One colour cannot
     stand in for it, so the border and the figure take a gradient. */
  /* Violet, blue, cyan, gold -- the palette the mythic bar on the reveal
     screen was redrawn in. A full spectrum here and that palette there
     read as two different rarities wearing the same name. */
  const RAINBOW = "linear-gradient(90deg,#a04bff,#5b6bff,#2f8fe0,#00b6e2,#00cfc0,#e8c07a,#b06ee3)";
  const isRainbow = rarity === "mythic";

  /* Rarities whose backdrop already carries the plate. Drawing another
     would double it, so only the figure goes on, right-aligned to the
     left of the USDT already printed there. */
  const BAKED = {
    common: { right: 1052, cy: 820, fsNum: 24 },
    rare:   { right: 1026, cy: 824, fsNum: 22 },
  };
  const baked = BAKED[rarity];

  /* One plate. There were meant to be two shapes and the buyback one was
     left empty, so an epic drew a plate with nothing in it whenever
     buyback was open. Buyback is now read only for common and rare, which
     paint their number onto the backdrop and never reach here -- so the
     empty branch had nothing left to do. */
  const plateBody = !priced ? [] : baked ? [] : [
    /* Market plate. Corners rounded a little: square fights the card's
       rounded frame, and any rounder reads as a pill. Two rings of border
       so the edge survives the light behind it. */
    el("div", {
      style: {
        position: "absolute", left: "0px", top: "0px",
        width: `${PLATE_W}px`, height: `${PLATE_H}px`,
        borderRadius: `${PLATE_R}px`,
        ...(isRainbow
          ? { backgroundImage: RAINBOW }
          : { backgroundColor: rgb(rgbc) }),
        display: "flex",
      },
    }),
    el("div", {
      style: {
        position: "absolute", left: "3px", top: "3px",
        width: `${PLATE_W - 6}px`, height: `${PLATE_H - 6}px`,
        borderRadius: `${PLATE_R - 3}px`,
        backgroundColor: "rgba(2,2,4,0.97)",
        display: "flex",
      },
    }),
    el("div", {
      style: {
        position: "absolute", left: "9px", top: "9px",
        width: `${PLATE_W - 18}px`, height: `${PLATE_H - 18}px`,
        borderRadius: `${PLATE_R - 8}px`,
        border: `1px solid ${isRainbow ? "rgba(255,255,255,0.34)" : rgba(rgbc, 0.42)}`,
        display: "flex",
      },
    }),
    el("div", {
      style: {
        position: "absolute", left: "0px", top: "0px",
        width: `${PLATE_W}px`, height: `${PLATE_H}px`,
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
      },
      children: [
        el("div", {
          style: {
            fontSize: `${FS_LABEL}px`, letterSpacing: "6px", fontWeight: 700,
            color: "rgba(255,255,255,0.7)",
          },
          children: `${priced.label} (USDT)`,
        }),
        el("div", {
          style: {
            display: "flex", alignItems: "baseline", gap: "12px", marginTop: "10px",
            fontSize: `${FS_VALUE}px`, fontWeight: 800, lineHeight: 1,
            /* Solid white for mythic rather than the rainbow.

               The figure used to be painted by clipping a gradient to the
               glyphs -- backgroundClip:"text" with a transparent colour.
               The renderer here does not support that clip, so the glyphs
               kept their transparent colour and the plate came out empty
               while every other rarity drew fine.

               The rainbow still runs around the border below, which is
               where it reads as mythic anyway. */
            color: isRainbow ? "#ffffff" : rgb(rgbc),
          },
          children: [
            el("div", {
              children: priced.price == null ? "\u2014" : priced.price.toFixed(2),
            }),
            el("div", {
              style: { fontSize: `${FS_UNIT}px`, letterSpacing: "3px", color: "rgba(255,255,255,0.7)" },
              children: "USDT",
            }),
          ],
        }),
      ],
    }),
  ];

  const plateStyle = (top) => ({
    position: "absolute",
    left: `${Math.round((W - PLATE_W) / 2)}px`,
    top: `${top}px`,
    width: `${PLATE_W}px`, height: `${PLATE_H}px`,
    display: "flex",
  });

  /* Coordinates are in the 1800x942 space the canvas is drawn in, so the
     backdrop needs no conversion.

     The figure is placed by its right edge alone. Giving the box a width
     made the browser and this renderer measure differently, and the
     position drifted from what the tuner showed; a generous box pinned to
     the right edge lands the same in both. */
  const bakedNum = (priced && baked)
    ? el("div", {
        style: {
          position: "absolute",
          left: `${baked.right - 600}px`,
          top: `${Math.round(baked.cy - baked.fsNum)}px`,
          width: "600px",
          height: `${baked.fsNum * 2}px`,
          display: "flex", alignItems: "center", justifyContent: "flex-end",
          fontSize: `${baked.fsNum}px`, fontWeight: 800,
          color: "#fff", lineHeight: 1,
        },
        /* Common and rare take this path and always carry a buyback
           figure, so the dash should never show here -- but the value is
           nullable now and a crash would lose the whole picture. */
        children: priced.price == null ? "\u2014" : priced.price.toFixed(2),
      })
    : null;

  const plate = priced && !baked
    ? el("div", { style: plateStyle(PLATE_TOP), children: plateBody })
    : bakedNum;

  /* The backdrop, overridable per request.

     Choosing between candidate artwork otherwise means a deploy for each
     one. `bg` takes a filename under images/og, or a full https address
     for something not committed yet.

     Constrained to a filename or an https URL: this address is put
     straight into the image, and an unchecked value would let any request
     draw anything into a picture served from our domain. */
  const bgParam = (url.searchParams.get("bg") || "").trim();
  let bgFile = BG[rarity];
  let bgUrl = bgFile ? `${url.origin}/images/og/${bgFile}` : null;

  if (bgParam) {
    if (/^https:\/\/[\w.-]+\/[\w./-]*$/.test(bgParam)) {
      bgUrl = bgParam;
    } else if (/^[\w.-]+\.(jpg|jpeg|png|webp)$/i.test(bgParam)) {
      bgUrl = `${url.origin}/images/og/${bgParam}`;
    }
  }
  // Whatever the card does not use, split evenly either side. Floored, so
  // rounding cannot push the three columns a pixel past the canvas and set
  // the layout shrinking something to compensate.
  const SIDE = Math.floor((W - CARD_H * 0.75) / 2);

  /* Painted: the artwork fills the frame and the card sits on top of it,
     positioned absolutely so it lands where the podium was drawn for it
     rather than wherever a flex row happens to put it. */
  const painted = el("div", {
    style: {
      width: `${W}px`, height: `${H}px`, display: "flex",
      alignItems: "center", justifyContent: "center", position: "relative",
      backgroundColor: "#050505",
      fontFamily: "Chakra Petch",
      /* The backdrop belongs to the frame, not to a child of it.

         It used to be an <img> stacked underneath the card. Two absolutely
         positioned siblings in the same box, and moving one could stop the
         other being drawn -- lowering the card to 750 was enough to lose
         the backdrop entirely. As a background there is nothing to
         displace: the card is drawn over it whatever its position. */
      backgroundImage: `url(${bgUrl})`,
      backgroundSize: `${W}px ${H}px`,
      backgroundRepeat: "no-repeat",
      backgroundPosition: "0 0",
    },
    children: [
      el("img", {
        src: card,
        style: {
          position: "absolute",
          /* Sized to the podium in the artwork, not to the frame.
             The first pass put the card's bottom edge at 906, which is
             144px below where the platform actually is -- the card sank
             through it. It now ends at 780, just inside the lit rim, so it
             reads as standing on the plinth rather than hovering over it. */
          left: `${Math.round((W - CARD_W) / 2)}px`,
          top: `${CARD_BOTTOM - CARD_H2}px`,
          width: `${CARD_W}px`,
          height: `${CARD_H2}px`,
          objectFit: "contain",
        },
      }),
      plate,
    ],
  });

  /* Drawn: no artwork for this rarity, so the frame is composed here --
     a wash of the rarity colour, the name beside the card, the card in the
     middle. */
  const drawn = el("div", {
    style: {
      width: `${W}px`,
      height: `${H}px`,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      position: "relative",
      // Flat black left two thirds of the frame reading as empty. A wash
      // of the card's own rarity colour, dark enough to stay a backdrop,
      // makes the space look composed instead of unused -- and tells a
      // legendary from a common at a glance in the timeline.
      backgroundColor: "#050505",
      fontFamily: "Chakra Petch",
      backgroundImage:
        `radial-gradient(circle at 50% 50%, ${rgba(rgbc, 0.16)} 0%, rgba(5,5,5,0) 62%)`,
    },
    children: [
      el("div", {
        style: {
          width: `${SIDE}px`, flexShrink: 0, display: "flex",
          flexDirection: "column", alignItems: "flex-end",
          justifyContent: "center", paddingRight: "56px",
        },
        children: [
          el("div", {
            style: {
              fontSize: "70px", fontWeight: 800, letterSpacing: "6px",
              whiteSpace: "nowrap", color: rgb(rgbc), lineHeight: 1,
            },
            children: RARITY,
          }),
          el("div", {
            style: {
              fontSize: "24px", letterSpacing: "12px",
              color: "rgba(255,255,255,0.42)", marginTop: "22px",
            },
            children: "MEMONS CARD",
          }),
        ],
      }),
      el("img", {
        src: card,
        style: {
          height: `${CARD_H}px`, flexShrink: 0, objectFit: "contain",
          borderRadius: "24px",
          boxShadow: `0 0 120px -10px ${rgb(rgbc)}, 0 0 220px -20px ${rgba(rgbc, 0.7)}`,
        },
      }),
      el("div", { style: { width: `${SIDE}px`, flexShrink: 0, display: "flex" } }),
      // Rarities without backdrop art still need the figure. The card is
      // centred vertically here, so the plate floats below it.
      priced ? el("div", { style: plateStyle(PLATE_TOP), children: plateBody }) : null,
    ],
  });

  /* Fetched with a ceiling rather than waited on. A crawler gives up
     quickly, and making it queue behind a font request that only matters
     on a cold instance is the difference between a card and no card. */
  const font = await Promise.race([
    chakraBold(url.origin),
    new Promise((r) => setTimeout(() => { FONT_ERR = FONT_ERR || "timeout 2500ms"; r(null); }, 2500)),
  ]);

  /* ?fontcheck answers in text instead of drawing. Only way to see what
     went wrong without a log line for a failure that is, by design, not an
     error. Costs nothing when unused. */
  if (url.searchParams.has("fontcheck")) {
    return new Response(
      JSON.stringify({
        loaded: !!font,
        bytes: font ? font.byteLength : 0,
        error: FONT_ERR,
        tried: `${url.origin}/fonts/ChakraPetch-Bold.ttf`,
      }, null, 2),
      { headers: { "content-type": "application/json" } },
    );
  }

  return new ImageResponse(
    bgUrl ? painted : drawn,
    {
      width: W,
      height: H,
      /* The same file registered at every weight the layout asks for.

         Registered only at 700, the renderer had nothing to answer a
         request for 800 -- which is what the figure and the rarity name
         use -- and quietly substituted its own face. The label came out
         in Chakra Petch and the number beside it did not, which reads as
         the font having failed entirely rather than as one weight being
         missing.

         Satori matches on exact weight rather than falling back to the
         nearest, so the list has to name each one. There is only one file
         behind them; it is the same bold face at every entry. */
      fonts: font
        ? [400, 500, 600, 700, 800, 900].map((w) => ({
            name: "Chakra Petch", data: font, weight: w, style: "normal",
          }))
        : undefined,
      headers: {
        /* The artwork never changes but the figure does. Pinned immutable,
           a price edited in the admin would leave the old one circulating.
           An hour is quick enough for a timeline. */
        "cache-control": "public, max-age=3600, s-maxage=3600",
      },
    }
  );
}
