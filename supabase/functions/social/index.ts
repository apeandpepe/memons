// =====================================================================
//  Edge Function: social   (Google / Apple login, and linking a wallet)
//
//  POST /social/google  {idToken, utm?}            → session JWT
//  POST /social/apple   {idToken, utm?}            → session JWT
//  POST /social/link    {address, signature}       → links a wallet to the
//                                                    member in the token
//  GET  /social/me                                 → who the token is
//
//  Deploy:  supabase functions deploy social --no-verify-jwt
//
//  Needs STEP 60 (app_users, user_identities, user_wallets, social_login,
//  link_wallet, uid_of).
//
//  The token this issues is the same shape as the one the wallet login
//  issues -- same secret, same six hours -- so everything that already
//  reads a MEMONS token keeps working. The only difference is what sits
//  in `sub`: a UID here, a wallet address there. uid_of() in the database
//  takes either, which is what lets the rest of the code move across one
//  place at a time.
//
//  Environment:
//    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (auto-injected)
//    APP_JWT_SECRET                            (same secret as auth)
//    GOOGLE_CLIENT_ID                          (comma-separated if several)
//    APPLE_CLIENT_ID                           (comma-separated if several)
// =====================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyMessage } from "https://esm.sh/ethers@6.13.4";
import { create, getNumericDate, verify } from "https://deno.land/x/djwt@v3.0.2/mod.ts";
import { jwtVerify, createRemoteJWKSet } from "https://esm.sh/jose@5.9.6";

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
  new Response(JSON.stringify(o), {
    status: s,
    headers: { ...cors, "content-type": "application/json" },
  });

async function hmacKey() {
  return await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(JWT_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

/* The identity providers publish the keys their tokens are signed with.
   Fetched once and cached by jose, which also refetches when a key it
   has not seen turns up -- both providers rotate. */
const GOOGLE_JWKS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs"),
);
const APPLE_JWKS = createRemoteJWKSet(
  new URL("https://appleid.apple.com/auth/keys"),
);

const audiences = (name: string) =>
  (Deno.env.get(name) || "").split(",").map((s) => s.trim()).filter(Boolean);

/* Checks the token the browser got from Google or Apple.

   Signature, issuer, expiry and audience are all checked here. The
   audience matters most: without it any token signed by Google would be
   accepted, including one issued to a completely different app. */
async function verifyIdToken(provider: "google" | "apple", idToken: string) {
  const jwks = provider === "google" ? GOOGLE_JWKS : APPLE_JWKS;
  const issuer = provider === "google"
    ? ["https://accounts.google.com", "accounts.google.com"]
    : "https://appleid.apple.com";
  const aud = audiences(
    provider === "google" ? "GOOGLE_CLIENT_ID" : "APPLE_CLIENT_ID",
  );
  if (!aud.length) throw new Error(`${provider} client id is not configured`);

  const { payload } = await jwtVerify(idToken, jwks, { issuer, audience: aud });

  const subject = String(payload.sub || "");
  if (!subject) throw new Error("token has no subject");

  /* Only a verified email is kept. An unverified one is a string the
     person typed, and support would read it as proof of who they are. */
  const email = payload.email_verified === true || payload.email_verified === "true"
    ? String(payload.email || "") || null
    : null;

  return { subject, email };
}

function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  const ip = (xff ? xff.split(",")[0] : "") || req.headers.get("x-real-ip") || "";
  return ip.trim().replace(/[^a-zA-Z0-9.:]/g, "_").slice(0, 50);
}

/* The subject of the caller's own MEMONS token, or null. Used by the
   routes that act on the member who is already signed in. */
async function callerSub(req: Request): Promise<string | null> {
  const h = req.headers.get("authorization") || "";
  const t = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!t) return null;
  try {
    const payload = await verify(t, await hmacKey());
    return String((payload as Record<string, unknown>).sub || "") || null;
  } catch {
    return null;
  }
}

const issueToken = async (uid: string) =>
  await create(
    { alg: "HS256", typ: "JWT" },
    { sub: uid, exp: getNumericDate(60 * 60 * 6) }, // 6 hours, same as wallet login
    await hmacKey(),
  );

/* The message a wallet signs to be linked.

   Deliberately different from the sign-in message: a signature collected
   for one purpose should not be replayable for the other. */
const linkMessage = (nonce: string) =>
  `MEMONS Link Wallet\n\nThis signature links this wallet to your MEMONS account.\nNo gas, no transaction.\nnonce: ${nonce}`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = new URL(req.url);

  try {
    // --- who am I -------------------------------------------------
    if (url.pathname.endsWith("/me")) {
      const sub = await callerSub(req);
      if (!sub) return json({ error: "not signed in" }, 401);

      const { data: uid } = await supabase.rpc("uid_of", { p_sub: sub });
      if (!uid) return json({ error: "unknown member" }, 401);

      const { data: wallets } = await supabase.rpc("wallets_of", { p_uid: uid });

      /* The email is what the header shows, so the member can see which
         account they are in. It is a label and nothing more -- no request
         is ever trusted because of it. */
      const { data: ident } = await supabase
        .from("user_identities")
        .select("provider, email")
        .eq("uid", uid)
        .limit(1)
        .maybeSingle();

      return json({
        uid,
        wallets: wallets ?? [],
        email: ident?.email ?? null,
        provider: ident?.provider ?? null,
      });
    }

    // --- sign in with Google or Apple -----------------------------
    const social = url.pathname.endsWith("/google")
      ? "google"
      : url.pathname.endsWith("/apple")
      ? "apple"
      : null;

    if (social) {
      const { idToken } = await req.json();
      if (!idToken || typeof idToken !== "string") {
        return json({ error: "idToken required" }, 400);
      }

      let who;
      try {
        who = await verifyIdToken(social as "google" | "apple", idToken);
      } catch (e) {
        return json({ error: `bad ${social} token: ${e}` }, 401);
      }

      const { data: uid, error } = await supabase.rpc("social_login", {
        p_provider: social,
        p_subject: who.subject,
        p_email: who.email,
      });
      if (error || !uid) return json({ error: error?.message || "login failed" }, 500);

      /* Logged after the account is settled and before the token goes
         out. The result is ignored on purpose: signing in must not fail
         because a log row did. */
      try {
        await supabase.from("social_login_log").insert({
          uid,
          provider: social,
          ip: clientIp(req) || null,
          ua: req.headers.get("user-agent"),
        });
      } catch (_) { /* the log is not the point */ }

      return json({ token: await issueToken(uid), uid });
    }

    // --- ask for the message a wallet should sign -----------------
    if (url.pathname.endsWith("/link-nonce")) {
      const sub = await callerSub(req);
      if (!sub) return json({ error: "not signed in" }, 401);

      const address = (url.searchParams.get("address") || "").toLowerCase();
      if (!/^0x[0-9a-f]{40}$/.test(address)) return json({ error: "bad address" }, 400);

      const nonce = crypto.randomUUID();
      const { error } = await supabase.from("auth_nonces").upsert({ address, nonce });
      if (error) return json({ error: error.message }, 500);

      return json({ message: linkMessage(nonce) });
    }

    // --- link the wallet ------------------------------------------
    if (url.pathname.endsWith("/link")) {
      const sub = await callerSub(req);
      if (!sub) return json({ error: "not signed in" }, 401);

      const { data: uid } = await supabase.rpc("uid_of", { p_sub: sub });
      if (!uid) return json({ error: "unknown member" }, 401);

      const { address, signature } = await req.json();
      const addr = String(address || "").toLowerCase();
      if (!/^0x[0-9a-f]{40}$/.test(addr)) return json({ error: "bad address" }, 400);

      const { data: row } = await supabase
        .from("auth_nonces").select("nonce").eq("address", addr).maybeSingle();
      if (!row) return json({ error: "no nonce, request /social/link-nonce first" }, 400);

      const message = linkMessage(row.nonce);
      let recovered = "";
      try { recovered = verifyMessage(message, signature).toLowerCase(); }
      catch { return json({ error: "bad signature" }, 401); }
      if (recovered !== addr) return json({ error: "signature mismatch" }, 401);

      await supabase.from("auth_nonces").delete().eq("address", addr);

      const { data: result, error } = await supabase.rpc("link_wallet", {
        p_uid: uid,
        p_address: addr,
      });
      if (error) {
        /* The one failure worth naming. Anything else is ours, not
           theirs, and a raw database message would say nothing useful. */
        const taken = /another member/.test(error.message);
        return json(
          { error: taken ? "wallet_taken" : "link failed" },
          taken ? 409 : 500,
        );
      }

      return json({ status: result, address: addr, uid });
    }

    return json({ error: "not found" }, 404);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
