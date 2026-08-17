// =====================================================================
//  Edge Function: identity
//  deploy:  supabase functions deploy identity --no-verify-jwt
//
//  Routes (single function, path suffix decides action):
//    POST /identity/state      where this wallet stands
//    POST /identity/needed     does a withdrawal of N need a check
//    POST /identity/submit     record a check
//    POST /identity/handoff    mint a token to continue on a phone
//    POST /identity/claim      exchange that token for a session
//    POST /identity/pending    admin: checks waiting for a decision
//    POST /identity/decide     admin: approve or reject
//    POST /identity/photo      admin: signed link to a photograph
//
//  Secrets: APP_JWT_SECRET, ADMIN_ADDRESSES (comma separated)
//
//
//  WHY THE FACE NEVER ARRIVES AS A FACE
//
//  The browser turns each photograph into 128 numbers and sends those.
//  They carry enough to tell two faces apart and not enough to rebuild
//  one, so what travels and what sits in the table is not a face.
//
//  The photographs themselves go to a private bucket, because whoever
//  approves a withdrawal has to be able to look at them. Nothing reads
//  that bucket without a signed link minted here, and those expire in
//  minutes.
//
//
//  WHY THE SCORES DO NOT DECIDE ANYTHING
//
//  Two numbers come back: how well the selfie matches the face on the
//  document, and how close it sits to a face already on another wallet.
//  Neither refuses anything on its own. A document photograph is a
//  photograph of a photograph and scores low honestly; siblings sit close
//  together and score high honestly. They are recorded for a person to
//  weigh, which is the same person who releases the money.
// =====================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { create, verify } from "https://deno.land/x/djwt@v3.0.2/mod.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);
const APP_JWT_SECRET = Deno.env.get("APP_JWT_SECRET")!;

/* Who may see the photographs and decide. Kept as a secret rather than a
   table so that reading the database is not enough to add yourself. */
const ADMINS = new Set(
  (Deno.env.get("ADMIN_ADDRESSES") || "")
    .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { ...cors, "content-type": "application/json" } });

async function hmacKey() {
  return await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(APP_JWT_SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"],
  );
}

async function walletFromJWT(req: Request): Promise<string | null> {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  try {
    const payload = await verify(token, await hmacKey());
    const sub = String(payload.sub || "").toLowerCase();
    return /^0x[0-9a-f]{40}$/.test(sub) ? sub : null;
  } catch { return null; }
}

function rpcError(e: { message?: string } | null): string {
  const m = (e?.message || "").trim();
  const code = m.match(/[A-Z_]{4,}/);
  return code ? code[0] : (m || "REQUEST_FAILED");
}

async function rpc(fn: string, args: Record<string, unknown>) {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(rpcError(error));
  return data;
}

/* A descriptor is 128 floats between roughly -1 and 1. Anything else is
   either a mistake or someone poking at the endpoint, and either way it
   should not reach the column. */
function vec(v: unknown): string | null {
  if (!Array.isArray(v) || v.length !== 128) return null;
  const nums = v.map(Number);
  if (nums.some((n) => !Number.isFinite(n) || Math.abs(n) > 8)) return null;
  return "[" + nums.map((n) => n.toFixed(6)).join(",") + "]";
}

/* Photographs arrive base64 encoded. A cap keeps a a phone camera's full
   resolution frame from being rejected while still refusing anything that
   is plainly not a photograph. */
function bytes(b64: unknown): Uint8Array | null {
  if (typeof b64 !== "string" || b64.length < 100 || b64.length > 12_000_000) return null;
  try {
    const bin = atob(b64.replace(/^data:[^,]+,/, ""));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch { return null; }
}

async function put(path: string, data: Uint8Array) {
  const { error } = await supabase.storage.from("faces")
    .upload(path, data, { contentType: "image/jpeg", upsert: false });
  if (error) throw new Error("UPLOAD_FAILED");
  return path;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const action = new URL(req.url).pathname.split("/").filter(Boolean).pop() || "";
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;

  try {
    /* Claiming a handoff token is the one route without a session -- it is
       how the phone gets one. */
    if (action === "claim") {
      const t = String(body.token || "");
      if (!t) return json({ error: "BAD_INPUT" }, 400);
      try {
        const p = await verify(t, await hmacKey());
        if (p.use !== "handoff") return json({ error: "BAD_TOKEN" }, 401);
        const addr = String(p.sub || "").toLowerCase();
        if (!/^0x[0-9a-f]{40}$/.test(addr)) return json({ error: "BAD_TOKEN" }, 401);

        /* A full session, but only good for long enough to take two
           photographs. A handoff link that turned into an ordinary login
           would be a login sitting in a QR code on someone's screen. */
        const now = Math.floor(Date.now() / 1000);
        const session = await create(
          { alg: "HS256", typ: "JWT" },
          { sub: addr, iat: now, exp: now + 900 },
          await hmacKey(),
        );
        return json({ token: session, address: addr });
      } catch { return json({ error: "BAD_TOKEN" }, 401); }
    }

    const addr = await walletFromJWT(req);
    if (!addr) return json({ error: "unauthorized" }, 401);

    switch (action) {
      case "state": {
        const state = await rpc("identity_state", { p_address: addr });
        return json({ state });
      }

      case "needed": {
        const amount = Number(body.amount || 0);
        const reason = await rpc("identity_check_needed",
          { p_address: addr, p_amount: amount });
        return json({ reason });
      }

      /* Mints a short-lived token so the same wallet can finish on a
         phone. Desktops without a camera are the case this exists for --
         accepting an uploaded photograph instead would let anyone pass
         with a picture of someone else, which is the thing the camera
         check is for. */
      case "handoff": {
        const now = Math.floor(Date.now() / 1000);
        const token = await create(
          { alg: "HS256", typ: "JWT" },
          { sub: addr, use: "handoff", iat: now, exp: now + 300 },
          await hmacKey(),
        );
        return json({ token });
      }

      case "submit": {
        const sv = vec(body.selfie_vec);
        const iv = vec(body.id_vec);
        if (!sv || !iv) return json({ error: "BAD_VECTOR" }, 400);

        const sImg = bytes(body.selfie);
        const iImg = bytes(body.id);
        if (!sImg || !iImg) return json({ error: "BAD_IMAGE" }, 400);

        const stamp = Date.now();
        const sPath = await put(`selfie/${addr}/${stamp}.jpg`, sImg);
        const iPath = await put(`id/${addr}/${stamp}.jpg`, iImg);

        const reason = String(body.reason || "first_withdrawal");
        const rows = await rpc("identity_submit", {
          p_address: addr,
          p_selfie_vec: sv,
          p_id_vec: iv,
          p_selfie_path: sPath,
          p_id_path: iPath,
          p_reason: reason,
        });

        /* The scores go to the reviewer, not back to the browser. Telling
           someone their document scored 0.71 tells them how much closer
           they have to get, which is help nobody honest needs. */
        const row = Array.isArray(rows) ? rows[0] : rows;
        return json({ ok: true, id: row?.id ?? null });
      }

      case "pending": {
        if (!ADMINS.has(addr)) return json({ error: "forbidden" }, 403);
        const { data, error } = await supabase.from("identity_checks")
          .select("id,address,selfie_path,id_path,match_score,dup_address,dup_score,reason,created_at")
          .eq("state", "pending")
          .order("created_at", { ascending: true })
          .limit(100);
        if (error) return json({ error: "QUERY_FAILED" }, 500);
        return json({ checks: data || [] });
      }

      case "decide": {
        if (!ADMINS.has(addr)) return json({ error: "forbidden" }, 403);
        const id = Number(body.id);
        const state = String(body.state || "");
        if (!Number.isInteger(id) || !["approved", "rejected"].includes(state)) {
          return json({ error: "BAD_INPUT" }, 400);
        }
        await rpc("identity_decide", {
          p_id: id, p_state: state, p_by: addr,
          p_note: body.note ? String(body.note) : null,
        });
        return json({ ok: true });
      }

      /* Photographs are never public. A link is minted per request and
         expires, so a URL copied out of the admin page stops working
         before it can be passed on. */
      case "photo": {
        if (!ADMINS.has(addr)) return json({ error: "forbidden" }, 403);
        const path = String(body.path || "");
        if (!/^(selfie|id)\/0x[0-9a-f]{40}\/\d+\.jpg$/.test(path)) {
          return json({ error: "BAD_PATH" }, 400);
        }
        const { data, error } = await supabase.storage.from("faces")
          .createSignedUrl(path, 300);
        if (error) return json({ error: "SIGN_FAILED" }, 500);
        return json({ url: data.signedUrl });
      }

      default:
        return json({ error: "not_found" }, 404);
    }
  } catch (e) {
    return json({ error: (e as Error).message || "REQUEST_FAILED" }, 400);
  }
});
