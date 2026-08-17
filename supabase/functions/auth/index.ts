// =====================================================================
//  Edge Function: auth   (지갑 서명 로그인)
//  GET  /auth/nonce?address=0x..   → 서명할 메시지 발급
//  POST /auth/verify {address,signature,utm?} → 서명 검증 → 세션 JWT 발급
//  배포:  supabase functions deploy auth --no-verify-jwt
//
//  Changed 2026-08-04 — verify now keeps what it learns.
//
//  It had everything worth recording and kept none of it: the signature
//  proving the wallet is real, the fact that anyone signed in at all, and
//  whatever brought them here. All three were discarded a line later and
//  none of them can be recovered afterwards.
//
//  Requires STEP 46 (wallet_proofs, login_log, wallets.utm_*, record_login).
//
//  Based on the version live on 2026-08-04. The sign-in message is the
//  English one that was already deployed -- an earlier copy of this file
//  had a Korean version, and restoring it would silently undo that change
//  and invalidate every nonce issued in the meantime.
// =====================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyMessage } from "https://esm.sh/ethers@6.13.4";
import { create, getNumericDate } from "https://deno.land/x/djwt@v3.0.2/mod.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);
const JWT_SECRET = Deno.env.get("APP_JWT_SECRET")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (o: unknown, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { ...cors, "content-type": "application/json" } });

async function hmacKey() {
  return await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(JWT_SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"],
  );
}
// 유저가 서명할 메시지 (지갑 소유 증명용, 가스 없음)
const loginMessage = (nonce: string) =>
  `MEMONS Login\n\nThis signature verifies wallet ownership only. No gas, no transaction.\nnonce: ${nonce}`;

function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  const ip = (xff ? xff.split(",")[0] : "") || req.headers.get("x-real-ip") || "";
  return ip.trim().replace(/[^a-zA-Z0-9.:]/g, "_").slice(0, 50);
}

/* Whatever the page says about where the visitor came from. Trimmed and
   capped rather than trusted: it arrives from the browser and anyone can
   put anything in it. Nothing depends on it being true -- it is a
   marketing hint, not a permission. */
function cleanUtm(u: unknown): Record<string, string> | null {
  if (!u || typeof u !== "object") return null;
  const src = u as Record<string, unknown>;
  const take = (k: string, max: number) => {
    const v = src[k];
    return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined;
  };
  const out: Record<string, string> = {};
  const source = take("source", 60);    if (source) out.source   = source;
  const medium = take("medium", 60);    if (medium) out.medium   = medium;
  const camp   = take("campaign", 120); if (camp)   out.campaign = camp;
  const ref    = take("referrer", 300); if (ref)    out.referrer = ref;
  return Object.keys(out).length ? out : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = new URL(req.url);
  try {
    // --- nonce 발급 ---
    if (url.pathname.endsWith("/nonce")) {
      const address = (url.searchParams.get("address") || "").toLowerCase();
      if (!/^0x[0-9a-f]{40}$/.test(address)) return json({ error: "bad address" }, 400);
      const nonce = crypto.randomUUID();
      const { error } = await supabase.from("auth_nonces").upsert({ address, nonce });
      if (error) return json({ error: error.message }, 500);
      return json({ message: loginMessage(nonce) });
    }
    // --- 서명 검증 → JWT ---
    if (url.pathname.endsWith("/verify")) {
      const body = await req.json();
      const { address, signature, utm } = body;
      const addr = (address || "").toLowerCase();
      const { data: row } = await supabase.from("auth_nonces").select("nonce").eq("address", addr).maybeSingle();
      if (!row) return json({ error: "no nonce, request /auth/nonce first" }, 400);

      const message = loginMessage(row.nonce);
      let recovered = "";
      try { recovered = verifyMessage(message, signature).toLowerCase(); }
      catch { return json({ error: "bad signature" }, 401); }
      if (recovered !== addr) return json({ error: "signature mismatch" }, 401);

      await supabase.from("auth_nonces").delete().eq("address", addr); // 재사용 방지

      /* Recorded after the signature is checked and before the token is
         issued. Awaited so a slow write does not race the redirect, but
         its result is ignored: signing in must not fail because a log
         entry did.

         The message is stored beside the signature. The nonce inside it is
         deleted a line above, so without it nobody -- including us -- can
         verify the signature later. */
      try {
        const { error } = await supabase.rpc("record_login", {
          p_address:   addr,
          p_message:   message,
          p_signature: signature,
          p_ip:        clientIp(req) || null,
          p_ua:        req.headers.get("user-agent"),
          p_utm:       cleanUtm(utm),
        });
        if (error) console.error("record_login:", error.message);
      } catch (e) {
        console.error("record_login threw:", e);
      }

      const token = await create(
        { alg: "HS256", typ: "JWT" },
        { sub: addr, exp: getNumericDate(60 * 60 * 6) }, // 6시간
        await hmacKey(),
      );
      return json({ token, address: addr });
    }
    return json({ error: "not found" }, 404);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
