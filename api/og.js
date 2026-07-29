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

const el = (type, props) => ({ type, props });

export default function handler(req) {
  const url = new URL(req.url);

  // id is safe by construction: letters, digits and underscore only
  const id = (url.searchParams.get("id") || "")
    .replace(/[^a-zA-Z0-9_]/g, "")
    .slice(0, 64);

  // card ids look like "legendary_mrh1jqh8pqo" — the rarity is the prefix
  const rarity =
    Object.keys(RARITY_COLOR).find((r) => id.startsWith(r + "_")) || "common";
  const rgbc = RARITY_COLOR[rarity];

  const card = id
    ? `${STORAGE_BASE}/${rarity}/${id}.png`
    : `${url.origin}/images/reveal/sample-card.png`;

  // 1800 rather than 2400. The card is 960px wide in storage and lands at
  // 838px here, so nothing is being stretched -- and every pixel past that
  // is work the edge renderer does for no visible gain, on a canvas whose
  // area it has to hold in memory all at once.
  const W = 1800;
  const H = 942;

  return new ImageResponse(
    el("div", {
      style: {
        width: `${W}px`,
        height: `${H}px`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        // Flat black left two thirds of the frame reading as empty. A wash
        // of the card's own rarity colour, dark enough to stay a backdrop,
        // makes the space look composed instead of unused -- and tells a
        // legendary from a common at a glance in the timeline.
        backgroundColor: "#050505",
        backgroundImage:
          `radial-gradient(circle at 50% 50%, ${rgba(rgbc, 0.16)} 0%, rgba(5,5,5,0) 62%)`,
      },
      children: el("img", {
        src: card,
        style: {
          // 89% of the height: as large as it goes with the corners still
          // clear of the edge.
          height: `${Math.round(H * 0.89)}px`,
          objectFit: "contain",
          borderRadius: "24px",
          // identical to the reveal screen's card glow, scaled to match
          boxShadow: `0 0 120px -10px ${rgb(rgbc)}, 0 0 220px -20px ${rgba(rgbc, 0.7)}`,
        },
      }),
    }),
    {
      width: W,
      height: H,
      headers: {
        // the artwork for a given id never changes — let X cache it hard
        "cache-control": "public, max-age=86400, s-maxage=604800, immutable",
      },
    }
  );
}
