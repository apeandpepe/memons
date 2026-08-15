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
  // mythic: "og-mythic.jpg",   // 배경 파일 준비되면 주석 해제
  // special: "og-special.jpg",
};

const el = (type, props) => ({ type, props });

/* 판 전체를 한 장의 도형으로 그린다. 이미지 렌더러가 clip-path 를
   지원하지 않아 테두리를 SVG 로 얹는다.

   조각이 둘이고 경계가 사선이다. 왼쪽은 오른쪽 변이, 오른쪽은 왼쪽
   변이 같은 각도로 기울어 서로 맞물린다. 직사각형 둘로 두면 맞물린
   느낌이 사라져 그냥 붙여 놓은 상자가 된다.

   sk 는 사선이 가로로 벌어지는 폭. 조각 사이 틈은 gap. */
const plateSvg = (w, h, c, sk, gap, split, stroke, fill, innerFill) => {
  // 바깥 틀 — 네 모서리가 깎인 팔각형
  const outer =
    `M ${c} 1 L ${w - c} 1 L ${w - 1} ${c} L ${w - 1} ${h - c} L ${w - c} ${h - 1} ` +
    `L ${c} ${h - 1} L 1 ${h - c} L 1 ${c} Z`;

  const p = 8;              // 틀 안쪽 여백
  const ic = c - 4;         // 안쪽 조각의 깎임
  const lx = split - gap;   // 왼쪽 조각이 끝나는 곳 (아래 기준)
  const rx = split;         // 오른쪽 조각이 시작하는 곳 (아래 기준)
  const t = p, b = h - p;

  // 왼쪽 조각 — 오른쪽 변이 위로 갈수록 오른쪽으로 벌어진다
  const left =
    `M ${p + ic} ${t} L ${lx + sk} ${t} L ${lx} ${b - ic} L ${lx - ic} ${b} ` +
    `L ${p + ic} ${b} L ${p} ${b - ic} L ${p} ${t + ic} Z`;

  // 오른쪽 조각 — 왼쪽 변이 같은 각도로 기울어 맞물린다
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

/* 시세 쪽은 조각이 하나다. */
const bevelSvg = (w, h, c, stroke, fill) =>
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<path d="M ${c} 1 L ${w - c} 1 L ${w - 1} ${c} L ${w - 1} ${h - c} L ${w - c} ${h - 1} ` +
    `L ${c} ${h - 1} L 1 ${h - c} L 1 ${c} Z" fill="${fill}" stroke="${stroke}" stroke-width="2"/></svg>`,
  );

// 번개. 문자 글리프는 색이 먹지 않아 도형으로 그린다.
const boltSvg = (color) =>
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">` +
    `<path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z" fill="${color}"/></svg>`,
  );

// ---------------------------------------------------------------------
// 카드 값. 환매가가 붙는 등급이면 그 값을, 아니면 마켓 시세를 쓴다.
//
// 값을 쿼리로 받지 않고 서버에서 읽는다. 공유 이미지는 타임라인에
// 남아 돌아다니는데, 클라이언트가 넘긴 숫자를 그대로 그리면 아무나
// 임의의 가격이 박힌 MEMONS 이미지를 만들 수 있다.
//
// 조회에 실패하면 값 없이 그린다. 이미지가 아예 안 나오는 것보다 낫다.
// ---------------------------------------------------------------------
const SB_URL  = "https://neixdrtamznrooougcda.supabase.co";
const SB_ANON = "sb_publishable_xXzlHTJ4cX8kJoEGXw_csw_q5qFK1nO";

async function priceOf(rarity, capsule) {
  const H = { apikey: SB_ANON, Authorization: "Bearer " + SB_ANON,
              "content-type": "application/json" };
  const rpc = (fn) =>
    fetch(`${SB_URL}/rest/v1/rpc/${fn}`, { method: "POST", headers: H, body: "{}" })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);

  try {
    const [open, src, floors] = await Promise.all([
      rpc("buyback_open"), rpc("market_floor_source"), rpc("market_floor_by_rarity"),
    ]);

    if (open === true) {
      const r = await fetch(
        `${SB_URL}/rest/v1/buyback_prices?select=price&enabled=is.true&price=gt.0` +
        `&capsule_id=eq.${encodeURIComponent(capsule)}&rarity=eq.${encodeURIComponent(rarity)}`,
        { headers: H },
      ).then((x) => (x.ok ? x.json() : null)).catch(() => null);
      const p = Array.isArray(r) && r[0] && Number(r[0].price);
      if (p > 0) return { label: "INSTANT BUYBACK", price: p };
    }

    const row = Array.isArray(floors) && floors.find((f) => f && f.rarity === rarity);
    const fp = row && Number(row.price);
    if (fp > 0) {
      return { label: src === "bid" ? "HIGHEST BID" : "MARKET PRICE", price: fp };
    }
  } catch (_) { /* 값 없이 그린다 */ }
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
  const CARD_W = 525;
  const CARD_H2 = 700;
  const CARD_BOTTOM = 745;
  /* 캡슐 종류에 따라 환매가가 다르다. 안 주면 결제 캡슐 기준으로 본다 —
     공유 이미지는 유료 캡슐을 알리는 자리이기 때문이다. */
  const capsule = (url.searchParams.get("cap") || "paid")
    .replace(/[^a-z]/g, "").slice(0, 16) || "paid";
  const priced = await priceOf(rarity, capsule);

  /* 값 판. 카드 아래 받침 위에 얹는다. 레퍼런스와 같이 라벨을 위,
     값을 아래에 두고 받침 폭에 맞춰 넓게 잡는다 — 좁은 알약으로 두면
     받침 한가운데 떠 있는 스티커처럼 보인다. */
  /* 받침 아래. 받침 위에 겹치면 조명 링을 덮어 판이 받침을 뚫고
     올라온 것처럼 보인다. 카드 아래 남은 공간에 그대로 앉힌다. */
  /* 값 판. 받침 위에 걸치게 앉힌다 — 받침 아래로 내리면 캔버스 바닥에
     닿아 잘리고, 카드와 따로 노는 꼬리표처럼 보인다.

     두 모양이 있다. 환매는 회사가 사주는 확정 금액이라 아이콘·라벨·값
     상자를 한 줄로 놓고, 시세는 변하는 값이라 라벨 아래 큰 숫자만 둔다.
     같은 모양이면 확정가와 변동가를 구분할 수 없다. */
  const isBuy = priced && priced.label === "INSTANT BUYBACK";
  /* 받침은 배경 아트에서 x 620~1172, y 784~860 에 있다. 판을 그 안에
     앉혀 받침의 일부처럼 보이게 한다. 위에 얹으면 받침을 가린 스티커가
     되고, 아래로 내리면 캔버스 바닥에 잘린다. */
  /* 받침은 배경 아트에서 x 620~1172, y 784~860 에 있다. 레퍼런스를 재보면
     판은 받침보다 좁고(약 90%) 받침 앞면 안쪽에 박혀 있다. 받침보다 넓게
     잡거나 위로 올리면 받침에 얹은 꼬리표로 보인다. */
  /* 판 크기·위치. share-tuner.html 로 맞춘 값. */
  const PLATE_W = 470;
  const PLATE_H = 112;
  const PLATE_TOP = 800;
  const PLATE_R = 18;

  const rc = rgb(rgbc);
  /* MYTHIC 은 카드도 바도 무지개다. 색 하나로는 표현할 수 없어
     테두리와 숫자에 그라디언트를 쓴다. */
  const RAINBOW = "linear-gradient(90deg,#ff3b3b,#ffb03b,#ffe83b,#4bd964,#3bd0ff,#7a5bff,#ff3bd0)";
  const isRainbow = rarity === "mythic";

  /* 배경 그림에 판이 이미 그려져 있는 등급. 판을 또 그리면 겹친다.
     값 칸의 USDT 왼쪽에 숫자만 오른쪽 정렬로 얹는다.
     좌표는 배경 그림에서 실측한 값이다 (배경 크기가 등급마다 달라
     비율이 아니라 그림별로 잡는다). */
  const BAKED = {
    common: { right: 1052, cy: 814, fsNum: 24 },
    rare:   { right: 1026, cy: 824, fsNum: 22 },
  };
  const baked = BAKED[rarity];

  const plateBody = !priced ? [] : baked ? [] : isBuy ? [
  ] : [
    /* 시세 판. 모서리를 살짝 둥글게 — 각지면 카드의 둥근 프레임과
       따로 놀고, 많이 둥글면 알약처럼 보인다.
       테두리를 두 겹 둘러 배경 빛에 묻히지 않게 한다. */
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
            fontSize: "22px", letterSpacing: "6px", fontWeight: 700,
            color: "rgba(255,255,255,0.7)",
          },
          children: `${priced.label} (USDT)`,
        }),
        el("div", {
          style: {
            display: "flex", alignItems: "baseline", gap: "12px", marginTop: "10px",
            fontSize: "33px", fontWeight: 800, lineHeight: 1,
            /* 무지개는 글자 자체에 그라디언트를 입힌다. */
            ...(isRainbow
              ? { backgroundImage: RAINBOW, backgroundClip: "text", color: "transparent" }
              : { color: rgb(rgbc) }),
          },
          children: [
            el("div", { children: priced.price.toFixed(2) }),
            el("div", {
              style: { fontSize: "22px", letterSpacing: "3px", color: "rgba(255,255,255,0.7)" },
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

  /* 배경에 판이 그려진 등급은 숫자만 얹는다. 배경 그림이 1800x942 로
     늘어나므로 실측 좌표도 같은 비율로 옮긴다. */
  /* 배경에 판이 그려진 등급은 숫자만 얹는다. 좌표는 1800x942 기준이라
     환산이 필요 없다 — 배경 그림이 그 크기로 늘어나 그려진다. */
  /* 배경에 판이 그려진 등급은 숫자만 얹는다. 좌표는 1800x942 기준이라
     환산이 필요 없다 — 배경 그림이 그 크기로 늘어나 그려진다.

     cellL 이 right 보다 크면 칸 폭이 음수가 된다. 조절판에서는 그 경우
     폭이 무시되고 글자가 cellL 에서 시작한다. 같은 결과가 나오도록
     폭을 넣지 않는다. */
  /* 배경에 판이 그려진 등급은 숫자만 얹는다. 좌표는 1800x942 기준이라
     환산이 필요 없다 — 배경 그림이 그 크기로 늘어나 그려진다.

     칸 폭 대신 오른쪽 끝 한 점으로 자리를 정한다. 폭을 두면 브라우저와
     이 렌더러의 계산이 달라져, 조절판에서 맞춘 위치와 어긋났다.
     넉넉한 칸을 오른쪽 끝에 맞춰 붙이면 두 곳이 같은 결과를 낸다. */
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
        children: priced.price.toFixed(2),
      })
    : null;

  const plate = priced && !baked
    ? el("div", { style: plateStyle(PLATE_TOP), children: plateBody })
    : bakedNum;

  const bgFile = BG[rarity];
  const bgUrl = bgFile ? `${url.origin}/images/og/${bgFile}` : null;
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
    },
    children: [
      el("img", {
        src: bgUrl,
        width: W, height: H,
        style: { position: "absolute", left: 0, top: 0, width: `${W}px`, height: `${H}px` },
      }),
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
      // 배경 아트가 없는 등급도 값은 보여야 한다. 이쪽은 카드가 세로
      // 가운데라 판을 아래에 띄운다.
      priced ? el("div", { style: plateStyle(PLATE_TOP), children: plateBody }) : null,
    ],
  });

  return new ImageResponse(
    bgUrl ? painted : drawn,
    {
      width: W,
      height: H,
      headers: {
        /* 카드 그림은 안 바뀌지만 값은 바뀐다. immutable 로 박아두면
           어드민에서 환매가를 고쳐도 옛 값이 박힌 이미지가 계속 돌아
           다닌다. 한 시간이면 타임라인에서는 충분히 빠르다. */
        "cache-control": "public, max-age=3600, s-maxage=3600",
      },
    }
  );
}
