// =====================================================================
//  MEMONS — /api/og
//  The image X actually shows in a tweet.
//
//  X renders summary_large_image at 1.91:1 and crops anything taller, so
//  handing it the raw portrait card slices the top and bottom off. Instead
//  we compose the 1200x630 canvas ourselves and drop the whole card in the
//  middle — same look as the single-pull reveal, never cropped.
//
//  Usage:  /api/og?id=<card_id>
// =====================================================================

import { ImageResponse } from "@vercel/og";

export const config = { runtime: "edge" };

const STORAGE_BASE =
  "https://neixdrtamznrooougcda.supabase.co/storage/v1/object/public/cards";

const RARITY_COLOR = {
  common: "#cfccc4",
  rare: "#5b9bd5",
  epic: "#c468d8",
  legendary: "#E9B84A",
  mythic: "#e0556a",
  special: "#E9B84A",
};

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
  const color = RARITY_COLOR[rarity];

  const card = id
    ? `${STORAGE_BASE}/${rarity}/${id}.png`
    : `${url.origin}/images/reveal/sample-card.png`;

  return new ImageResponse(
    el("div", {
      style: {
        width: "1200px",
        height: "630px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#000000",
      },
      children: el("img", {
        src: card,
        style: {
          // 630 - 80px of breathing room top and bottom
          height: "430px",
          objectFit: "contain",
          borderRadius: "16px",
          // identical to the reveal screen's card glow
          boxShadow: `0 0 80px -6px ${color}, 0 0 150px -12px ${color}`,
        },
      }),
    }),
    {
      width: 1200,
      height: 630,
      headers: {
        // the artwork for a given id never changes — let X cache it hard
        "cache-control": "public, max-age=86400, s-maxage=604800, immutable",
      },
    }
  );
}
