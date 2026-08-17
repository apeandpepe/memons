// =====================================================================
//  Edge Function: market
//  배포:  supabase functions deploy market --no-verify-jwt
//
//  Every button on the marketplace page posts here. The page has been
//  live and returning 503 on all of them because this function did not
//  exist; the database side has been complete for weeks.
//
//  Routes (single function, path suffix decides action):
//    POST /market/me             wallet's own state
//    POST /market/list           put a card up
//    POST /market/unlist         take it down
//    POST /market/buy            take an ask
//    POST /market/offer          place a bid
//    POST /market/cancel-offer   withdraw a bid
//    POST /market/accept         fill someone's bid
//    POST /market/topup          deposit config, or create an order
//    POST /market/topup-cancel   cancel the open order
//    POST /market/withdraw       request a withdrawal
//    POST /market/view           note that a card was looked at
//
//  Secrets: APP_JWT_SECRET, and optionally RECEIVER_BALANCE / RECEIVER_PULLS
//
//
//  WHAT THIS ADDS THAT THE DATABASE CANNOT
//
//  The address. Every market_* function takes p_address as an argument
//  and trusts it, which is correct for a function called by a trusted
//  caller and catastrophic for one callable from a browser -- anyone
//  could sell anyone else's cards. Here the address comes from the signed
//  session token and the body's opinion of who it is never reaches the
//  database.
//
//  This is also why those functions must stay revoked from anon. STEP 45
//  closed them; they are reachable only through this file, with the
//  service role key, after the token has been checked.
//
//
//  DEPOSITS AND WITHDRAWALS BEFORE THE MARKET OPENS
//
//  market_config.enabled gates trading, and the database enforces it --
//  listing, buying and bidding all raise MARKET_CLOSED on their own. Money
//  in and out does not go through that check: create_topup_order and
//  market_request_withdrawal never look at it. So the gate is applied here
//  as well, and deploying this before September leaves the page working
//  and every path closed.
// =====================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verify } from "https://deno.land/x/djwt@v3.0.2/mod.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);
const APP_JWT_SECRET = Deno.env.get("APP_JWT_SECRET")!;

// Where deposits are sent. Held as secrets rather than in the code so the
// address can be rotated without a deploy.
const RECEIVER_BALANCE = Deno.env.get("RECEIVER_BALANCE") || "";
const RECEIVER_PULLS   = Deno.env.get("RECEIVER_PULLS")   || RECEIVER_BALANCE;

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

/* Errors are raised as bare codes -- MARKET_CLOSED, NOT_YOUR_CARD,
   BELOW_FLOOR:5.00 -- and the page already knows how to display them.
   Passed through unchanged; wrapping them in prose would break that and
   tell the user less. */
function rpcError(e: { message?: string } | null): string {
  const m = (e?.message || "").trim();
  const code = m.match(/[A-Z_]{4,}(?::[\d.]+)?/);
  return code ? code[0] : (m || "REQUEST_FAILED");
}

async function rpc(fn: string, args: Record<string, unknown>) {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(rpcError(error));
  return data;
}

async function marketOpen(): Promise<boolean> {
  const { data } = await supabase.from("market_config").select("enabled").eq("id", 1).maybeSingle();
  return !!data?.enabled;
}

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const path = new URL(req.url).pathname.replace(/^.*\/market\//, "");
  const addr = await walletFromJWT(req);
  if (!addr) return json({ error: "unauthorized" }, 401);

  let body: Record<string, unknown> = {};
  try { body = (await req.json()) ?? {}; } catch { /* no body is fine */ }

  try {
    switch (path) {

      // ---------------------------------------------------------------
      // Everything the wallet's own screens need, in one call.
      // ---------------------------------------------------------------
      case "me": {
        const [bal, sellable, listings, offers, pending, trades, ledger, topups, withdrawals] =
          await Promise.all([
            supabase.from("balances").select("available,locked").eq("address", addr).maybeSingle(),
            supabase.from("owned")
              .select("id,card_id,cards(name,rarity,image_url)")
              .eq("address", addr).eq("status", "held").eq("origin", "normal"),
            supabase.from("listings")
              .select("id,card_id,price,created_at")
              .eq("seller", addr).eq("status", "open").order("created_at", { ascending: false }),
            supabase.from("offers")
              .select("id,card_id,price,created_at,expires_at")
              .eq("buyer", addr).eq("status", "open").order("created_at", { ascending: false }),
            supabase.from("withdrawals")
              .select("id,amount,chain,requested_at")
              .eq("address", addr).eq("status", "pending")
              .order("requested_at", { ascending: false }).limit(1),
            supabase.from("trades")
              .select("id,card_id,price,fee,seller,buyer,taker,created_at")
              .or(`seller.eq.${addr},buyer.eq.${addr}`)
              .order("created_at", { ascending: false }).limit(50),
            supabase.from("balance_ledger")
              .select("id,delta,reason,created_at")
              .eq("address", addr).order("created_at", { ascending: false }).limit(50),
            supabase.from("topup_orders")
              .select("id,kind,amount_usdt,quantity,status,chain,tx_hash,created_at,paid_at")
              .eq("address", addr).order("created_at", { ascending: false }).limit(50),
            supabase.from("withdrawals")
              .select("id,amount,status,chain,tx_hash,requested_at,processed_at")
              .eq("address", addr).order("requested_at", { ascending: false }).limit(50),
          ]);

        /* Cards a reward has already consumed cannot be listed, and the
           check lives in market_list_card. Filtered here too so the page
           never offers a card the database would refuse. */
        const ids = (sellable.data || []).map((o: { card_id: string }) => o.card_id);
        let used = new Set<string>();
        if (ids.length) {
          const { data: u } = await supabase.from("reward_used_cards")
            .select("card_id").in("card_id", ids);
          used = new Set((u || []).map((r: { card_id: string }) => r.card_id));
        }

        return json({
          balance:     Number(bal.data?.available || 0),
          locked:      Number(bal.data?.locked || 0),
          sellable:    (sellable.data || [])
                         .filter((o: { card_id: string }) => !used.has(o.card_id))
                         .map((o: any) => ({
                           id: o.id, card_id: o.card_id,
                           name: o.cards?.name, rarity: o.cards?.rarity,
                           image_url: o.cards?.image_url,
                         })),
          listings:    listings.data || [],
          offers:      offers.data || [],
          withdrawal:  pending.data?.[0] || null,
          trades:      trades.data || [],
          ledger:      ledger.data || [],
          topups:      topups.data || [],
          withdrawals: withdrawals.data || [],
        });
      }

      // ---------------------------------------------------------------
      // Trading. The database refuses all of these while the market is
      // closed; the check here is so the page hears one clear answer
      // rather than four different ones.
      // ---------------------------------------------------------------
      case "list": {
        if (!(await marketOpen())) return json({ error: "MARKET_CLOSED" }, 403);
        const owned_id = num(body.owned_id), price = num(body.price);
        if (!Number.isInteger(owned_id) || !(price > 0)) return json({ error: "BAD_INPUT" }, 400);
        return json(await rpc("market_list_card",
          { p_address: addr, p_owned_id: owned_id, p_price: price }));
      }

      case "unlist": {
        const listing_id = num(body.listing_id);
        if (!Number.isInteger(listing_id)) return json({ error: "BAD_INPUT" }, 400);
        // Not gated: closing the market should not trap a card in a listing.
        return json(await rpc("market_cancel_listing",
          { p_address: addr, p_listing_id: listing_id }));
      }

      case "buy": {
        if (!(await marketOpen())) return json({ error: "MARKET_CLOSED" }, 403);
        const listing_id = num(body.listing_id);
        if (!Number.isInteger(listing_id)) return json({ error: "BAD_INPUT" }, 400);
        return json(await rpc("market_buy",
          { p_address: addr, p_listing_id: listing_id }));
      }

      case "offer": {
        if (!(await marketOpen())) return json({ error: "MARKET_CLOSED" }, 403);
        const card_id = String(body.card_id || ""), price = num(body.price);
        if (!/^[a-z]+_[a-z0-9]+$/i.test(card_id) || !(price > 0)) return json({ error: "BAD_INPUT" }, 400);
        return json(await rpc("market_make_offer",
          { p_address: addr, p_card_id: card_id, p_price: price }));
      }

      case "cancel-offer": {
        const offer_id = num(body.offer_id);
        if (!Number.isInteger(offer_id)) return json({ error: "BAD_INPUT" }, 400);
        // Not gated: the money is locked until this runs.
        return json(await rpc("market_cancel_offer",
          { p_address: addr, p_offer_id: offer_id }));
      }

      case "accept": {
        if (!(await marketOpen())) return json({ error: "MARKET_CLOSED" }, 403);
        const offer_id = num(body.offer_id), owned_id = num(body.owned_id);
        if (!Number.isInteger(offer_id) || !Number.isInteger(owned_id)) return json({ error: "BAD_INPUT" }, 400);
        return json(await rpc("market_accept_offer",
          { p_address: addr, p_offer_id: offer_id, p_owned_id: owned_id }));
      }

      // ---------------------------------------------------------------
      // Money. create_topup_order and market_request_withdrawal do not
      // check market_config, so the gate has to be here or deposits open
      // months before the market does.
      // ---------------------------------------------------------------
      case "topup": {
        // No kind means the screen is opening: hand back the config and
        // whatever order is already running.
        if (body.kind === undefined) {
          const [cfg, order] = await Promise.all([
            supabase.from("topup_config").select("*").eq("id", 1).maybeSingle(),
            supabase.from("topup_orders").select("*")
              .eq("address", addr).eq("status", "pending")
              .order("created_at", { ascending: false }).limit(1),
          ]);
          return json({
            config: cfg.data || {},
            receivers: { balance: RECEIVER_BALANCE, pulls: RECEIVER_PULLS },
            order: order.data?.[0] || null,
            enabled: await marketOpen(),
          });
        }

        if (!(await marketOpen())) return json({ error: "MARKET_CLOSED" }, 403);
        const kind = String(body.kind), value = num(body.value);
        if (kind !== "balance" && kind !== "pulls") return json({ error: "BAD_KIND" }, 400);
        if (!(value > 0)) return json({ error: "BAD_INPUT" }, 400);
        if (!RECEIVER_BALANCE) return json({ error: "RECEIVER_NOT_SET" }, 503);

        const order = await rpc("create_topup_order",
          { p_address: addr, p_kind: kind, p_value: value });
        return json({
          order,
          receiver: kind === "pulls" ? RECEIVER_PULLS : RECEIVER_BALANCE,
        });
      }

      // ---------------------------------------------------------------
      // Interest. Not gated on the market being open -- browsing before
      // it opens is worth knowing about, and arguably the most
      // interesting week of it.
      //
      // Signed-in wallets only, and the database collapses repeats to one
      // row per wallet per card per hour. Anonymous visitors browse
      // normally; they are simply not counted, because a number anyone
      // can run up with a script is worse than no number.
      // ---------------------------------------------------------------
      case "view": {
        const card_id = String(body.card_id || "");
        if (!/^[a-z]+_[a-z0-9]+$/i.test(card_id)) return json({ error: "BAD_INPUT" }, 400);
        // Failure here is not the caller's problem; the page asked to see
        // a card, not to be logged.
        try { await rpc("record_card_view", { p_address: addr, p_card_id: card_id }); }
        catch (e) { console.error("record_card_view", e); }
        return json({ ok: true });
      }

      case "topup-cancel":
        return json({ cancelled: await rpc("cancel_topup_order", { p_address: addr }) });

      case "withdraw": {
        if (!(await marketOpen())) return json({ error: "MARKET_CLOSED" }, 403);
        const amount = num(body.amount);
        const chain = String(body.chain || "polygon").toLowerCase();
        if (!(amount > 0)) return json({ error: "BAD_AMOUNT" }, 400);
        if (!["polygon", "ethereum", "bsc"].includes(chain)) return json({ error: "BAD_CHAIN" }, 400);
        /* p_to is the caller's own address and is not taken from the body.
           market_request_withdrawal will send anywhere it is told, so a
           destination arriving from the browser would let a stolen session
           empty a balance to an attacker's wallet. Paying out only to the
           address that signed in makes that worth nothing. */
        return json(await rpc("market_request_withdrawal",
          { p_address: addr, p_amount: amount, p_to: addr, p_chain: chain }));
      }

      default:
        return json({ error: "not_found" }, 404);
    }
  } catch (e) {
    const msg = (e as Error).message || "REQUEST_FAILED";
    // A refusal is not a fault. The page shows these to the user.
    const expected = /^[A-Z_]{4,}(:|$)/.test(msg);
    if (!expected) console.error("market/" + path, e);
    return json({ error: msg }, expected ? 400 : 500);
  }
});
