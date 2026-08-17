// =====================================================================
//  MEMONS - verify-payment  (Supabase Edge Function, Deno)
//  Self-verified USDT payment on Polygon / Ethereum / BSC -> grant pulls.
//
//  Flow: client submits { tx_hash, chain } + auth (wallet JWT).
//   1) chain is supported and enabled
//   2) tx exists & status = success (on-chain)
//   3) enough confirmations (per chain)
//   4) a USDT Transfer log to one of OUR wallets exists in that tx
//   5) token == that chain's USDT contract (anti-spoof)
//   6) which wallet received it decides what was bought
//   7) transfer.from == authenticated wallet
//  All checks pass -> credit_payment() or market_credit_deposit().
//
//  TWO RECEIVERS: capsule top-ups and trading-balance top-ups are separate
//  pages sending to separate addresses, so the receiving address says which
//  was meant. The transfer itself carries nothing else that could tell them
//  apart: 20 USDT is both a valid capsule amount and a plausible balance.
//
//  DECLARED FIRST: the user creates a top-up order before paying, and the
//  transfer is matched back to it on sender and amount. A transfer nobody
//  asked for is rejected rather than guessed at.
//
//  DECIMALS WARNING: BSC-USDT uses 18 decimals; Polygon/Ethereum use 6.
//  Prices are defined in whole USDT and converted per chain, so 2 USDT is
//  2 USDT everywhere.
//
//  PURCHASES KILL SWITCH: PAYMENTS_ENABLED (false = every new payment rejected).
//  TESTNET applies to Polygon only (Amoy). Ethereum/BSC are mainnet-only.
//
//  Secrets:
//    APP_JWT_SECRET               (required)
//    POLYGON_RPC_URL              (Polygon mainnet RPC)
//    POLYGON_RPC_URL_TESTNET      (when TESTNET = true -> Amoy RPC)
//    ETHEREUM_RPC_URL             (Ethereum mainnet RPC)   <-- ADD THIS
//    BSC_RPC_URL                  (BSC mainnet RPC)        <-- ADD THIS
//    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-injected)
// =====================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verify } from "https://deno.land/x/djwt@v3.0.2/mod.ts";

const PAYMENTS_ENABLED = false; // <-- set to true to open capsule purchases
const DEPOSITS_ENABLED = true; // <-- set to true when the marketplace opens
const TESTNET = false;          // <-- Polygon only: true = Amoy testnet

// ---- prices (whole USDT, identical on every chain) ----
const SINGLE_USDT = 2;      // 1 pull
const BUNDLE10_USDT = 18;   // 10 pulls (10% off)

// ---- balance top-up limits (whole USDT) ----
const DEPOSIT_MIN = 5;
const DEPOSIT_MAX = 5000;

// ---- receivers (same addresses on all chains) ----
// Keep these distinct. If they were ever set to the same address there would
// be no way to tell a capsule payment from a balance top-up.
const RECEIVER_PULLS   = "0xcce26e367ac0c04e0a9add40e1141d6eabf93b8c".toLowerCase();
const RECEIVER_BALANCE = "0xDDb438f8c9049f1924e6B6b31d9b0c97540c68C5".toLowerCase();

const RECEIVERS: Record<string, "pulls" | "balance"> = {
  [RECEIVER_PULLS]:   "pulls",
  [RECEIVER_BALANCE]: "balance",
};

// keccak256("Transfer(address,address,uint256)")
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

type ChainCfg = {
  key: string; name: string; chainId: number;
  token: string; decimals: number; rpcEnv: string;
  minConfirmations: number; enabled: boolean;
};

const CHAINS: Record<string, ChainCfg> = {
  polygon: {
    key: "polygon", name: "Polygon",
    chainId: TESTNET ? 80002 : 137,
    token: TESTNET
      ? "0x41e94eb019c0762f9bfcf9fb1e58725bfb0e7582"   // Amoy test USDC (6 dec)
      : "0xc2132d05d31c914a87c6611c10748aeb04b58e8f",  // Polygon USDT (6 dec)
    decimals: 6,
    rpcEnv: TESTNET ? "POLYGON_RPC_URL_TESTNET" : "POLYGON_RPC_URL",
    minConfirmations: 5,
    enabled: true,
  },
  ethereum: {
    key: "ethereum", name: "Ethereum",
    chainId: 1,
    token: "0xdac17f958d2ee523a2206206994597c13d831ec7",  // Ethereum USDT (6 dec)
    decimals: 6,
    rpcEnv: "ETHEREUM_RPC_URL",
    minConfirmations: 3,
    enabled: !TESTNET,
  },
  bsc: {
    key: "bsc", name: "BNB Smart Chain",
    chainId: 56,
    token: "0x55d398326f99059ff775485246999027b3197955",  // BSC USDT (18 decimals!)
    decimals: 18,
    rpcEnv: "BSC_RPC_URL",
    minConfirmations: 5,
    enabled: !TESTNET,
  },
};

const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);
const JWT_SECRET = Deno.env.get("APP_JWT_SECRET")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "content-type": "application/json" } });

async function rpc(cfg: ChainCfg, method: string, params: unknown[]) {
  const url = Deno.env.get(cfg.rpcEnv);
  if (!url) throw new Error(`Missing RPC secret: ${cfg.rpcEnv}`);
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: 1, jsonrpc: "2.0", method, params }),
  });
  const j = await r.json();
  if (j.error) throw new Error(`RPC ${method}: ${j.error.message}`);
  return j.result;
}
const hexToBig = (h: string) => BigInt(h);
const topicToAddr = (t: string) => ("0x" + t.slice(26)).toLowerCase();

// how many pulls does this exact amount buy? (0 = no matching package)
function pullsForAmount(amountRaw: bigint, decimals: number): number {
  const unit = 10n ** BigInt(decimals);
  const SINGLE = BigInt(SINGLE_USDT) * unit;
  const BUNDLE = BigInt(BUNDLE10_USDT) * unit;
  for (let q = Number(amountRaw / BUNDLE); q >= 0; q--) {
    const rem = amountRaw - BUNDLE * BigInt(q);
    if (rem < 0n) continue;
    if (rem % SINGLE === 0n) {
      const r = Number(rem / SINGLE);
      if (r >= 0 && r <= 9) return 10 * q + r;
    }
  }
  return 0;
}

async function getAuthedWallet(req: Request): Promise<string | null> {
  const h = req.headers.get("authorization") || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!token) return null;
  try {
    const key = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(JWT_SECRET),
      { name: "HMAC", hash: "SHA-256" }, false, ["verify"],
    );
    const payload = await verify(token, key);
    return ((payload as any).address || (payload as any).sub || "").toString().toLowerCase() || null;
  } catch { return null; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);

  try {
    const wallet = await getAuthedWallet(req);
    if (!wallet) return json({ ok: false, error: "AUTH_REQUIRED" }, 401);

    const body = await req.json().catch(() => ({} as any));
    const tx_hash = body?.tx_hash;
    const chainKey = String(body?.chain || "polygon").toLowerCase(); // default keeps old clients working

    if (!tx_hash || !/^0x[0-9a-fA-F]{64}$/.test(tx_hash))
      return json({ ok: false, error: "BAD_TX_HASH" }, 400);
    const tx = String(tx_hash).toLowerCase();

    const cfg = CHAINS[chainKey];
    if (!cfg || !cfg.enabled)
      return json({ ok: false, error: "CHAIN_NOT_SUPPORTED", chain: chainKey }, 400);

    // already credited? (checked before the kill switch so a payment made while
    // purchases were open is never lost)
    const { data: existing } = await sb
      .from("payments").select("tx_hash,status,pulls_granted").eq("tx_hash", tx).maybeSingle();
    if (existing?.status === "credited")
      return json({ ok: true, duplicate: true, granted: existing.pulls_granted });

    const receipt = await rpc(cfg, "eth_getTransactionReceipt", [tx]);
    if (!receipt) return json({ ok: false, error: "TX_NOT_FOUND" }, 404);
    if (hexToBig(receipt.status) !== 1n) {
      await sb.rpc("reject_payment", { p_tx_hash: tx, p_reason: "TX_FAILED" });
      return json({ ok: false, error: "TX_FAILED" }, 400);
    }

    const head = hexToBig(await rpc(cfg, "eth_blockNumber", []));
    const txBlock = hexToBig(receipt.blockNumber);
    const confirmations = head - txBlock + 1n;
    if (confirmations < BigInt(cfg.minConfirmations))
      return json({
        ok: false, error: "PENDING_CONFIRMATIONS",
        confirmations: Number(confirmations), need: cfg.minConfirmations,
      }, 202);

    const TOKEN = cfg.token.toLowerCase();
    const log = (receipt.logs || []).find((l: any) =>
      l.address?.toLowerCase() === TOKEN &&
      l.topics?.[0]?.toLowerCase() === TRANSFER_TOPIC &&
      l.topics?.length === 3 &&
      RECEIVERS[topicToAddr(l.topics[2])] !== undefined
    );
    if (!log) {
      await sb.rpc("reject_payment", {
        p_tx_hash: tx, p_reason: "NO_TOKEN_TRANSFER_TO_RECEIVER",
        p_to: RECEIVER_PULLS, p_token: TOKEN,
      });
      return json({ ok: false, error: "NO_TOKEN_TRANSFER_TO_RECEIVER" }, 400);
    }

    const toAddr = topicToAddr(log.topics[2]);
    const purpose = RECEIVERS[toAddr];            // "pulls" | "balance"
    const fromAddr = topicToAddr(log.topics[1]);
    const amountRaw = hexToBig(log.data);
    const amountUsdt = Number(amountRaw) / 10 ** cfg.decimals;

    if (fromAddr !== wallet) {
      await sb.rpc("reject_payment", {
        p_tx_hash: tx, p_reason: "SENDER_MISMATCH", p_from: fromAddr,
        p_to: toAddr, p_token: TOKEN,
        p_amount_raw: Number(amountRaw), p_amount_usdt: amountUsdt,
      });
      return json({ ok: false, error: "SENDER_MISMATCH" }, 403);
    }

    // ---- trading balance ------------------------------------------------
    if (purpose === "balance") {
      if (!DEPOSITS_ENABLED) {
        return json({
          ok: false, error: "DEPOSITS_CLOSED",
          message: "Balance top-ups are not open yet.",
        }, 503);
      }
      // The amount has to be one the user declared. Without that a stray
      // transfer to this wallet would silently become credit.
      const { error: oerr } = await sb.rpc("settle_topup_order", {
        p_address: fromAddr, p_kind: "balance",
        p_amount_usdt: amountUsdt, p_tx_hash: tx, p_chain: cfg.key,
      });
      if (oerr) {
        const m = oerr.message || "";
        if (m.includes("NO_MATCHING_ORDER")) {
          await sb.rpc("reject_payment", {
            p_tx_hash: tx, p_reason: "NO_MATCHING_ORDER", p_from: fromAddr,
            p_to: toAddr, p_token: TOKEN,
            p_amount_raw: Number(amountRaw), p_amount_usdt: amountUsdt,
          });
          return json({ ok: false, error: "NO_MATCHING_ORDER", got: amountUsdt }, 400);
        }
        throw oerr;
      }

      // Keyed on the transaction hash, so a replay credits nothing twice.
      const { data: bal, error: berr } = await sb.rpc("market_credit_deposit", {
        p_tx_hash: tx, p_address: fromAddr, p_amount: amountUsdt,
      });
      if (berr) throw berr;

      return json({
        ok: true, kind: "balance", credited: amountUsdt, balance: bal,
        address: fromAddr, chain: cfg.key,
      });
    }

    // ---- capsules ---------------------------------------------------------
    if (!PAYMENTS_ENABLED) {
      return json({
        ok: false, error: "PURCHASES_CLOSED",
        message: "Capsule purchases are temporarily closed. Please try again later.",
      }, 503);
    }

    const pulls = pullsForAmount(amountRaw, cfg.decimals);
    if (pulls < 1) {
      await sb.rpc("reject_payment", {
        p_tx_hash: tx, p_reason: "AMOUNT_NO_MATCHING_PACKAGE", p_from: fromAddr,
        p_to: toAddr, p_token: TOKEN,
        p_amount_raw: Number(amountRaw), p_amount_usdt: amountUsdt,
      });
      return json({ ok: false, error: "AMOUNT_NO_MATCHING_PACKAGE", got: amountUsdt }, 400);
    }

    // Same declaration check as the balance side. The amount already maps to
    // a whole number of capsules, but an order pins down that this is the
    // purchase the user set out to make.
    const { error: porder } = await sb.rpc("settle_topup_order", {
      p_address: fromAddr, p_kind: "pulls",
      p_amount_usdt: amountUsdt, p_tx_hash: tx, p_chain: cfg.key,
    });
    if (porder) {
      const m = porder.message || "";
      if (m.includes("NO_MATCHING_ORDER")) {
        await sb.rpc("reject_payment", {
          p_tx_hash: tx, p_reason: "NO_MATCHING_ORDER", p_from: fromAddr,
          p_to: toAddr, p_token: TOKEN,
          p_amount_raw: Number(amountRaw), p_amount_usdt: amountUsdt,
        });
        return json({ ok: false, error: "NO_MATCHING_ORDER", got: amountUsdt }, 400);
      }
      throw porder;
    }

    const { data, error } = await sb.rpc("credit_payment", {
      p_tx_hash: tx, p_from: fromAddr, p_to: toAddr, p_token: TOKEN,
      p_amount_raw: Number(amountRaw), p_amount_usdt: amountUsdt,
      p_pulls: pulls, p_block: Number(txBlock), p_chain: cfg.chainId,
    });
    if (error) throw error;

    return json({
      ok: true, kind: "pulls", granted: pulls, amount_usdt: amountUsdt,
      address: fromAddr, chain: cfg.key, duplicate: data?.duplicate ?? false,
    });
  } catch (e) {
    return json({ ok: false, error: "SERVER_ERROR", detail: String((e as any)?.message ?? e) }, 500);
  }
});
