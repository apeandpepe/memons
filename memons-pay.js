// =====================================================================
//  MEMONS - USDT payment (frontend add-on for gacha-client)
//  Package A pricing: 1 pull = 2 USDT, 10-pack = 18 USDT (10% off).
//    price(N) = floor(N/10)*18 + (N%10)*2   (USDT)
//  Flow: pay -> on-chain transfer -> verify-payment -> pulls credited.
//  Requires window.ethereum + MEMONS.connect() (session JWT via MEMONS.token).
//  Exposes: MEMONS.priceUsdt(N), MEMONS.pay(N, {onStatus}).
//
//  NETWORK SWITCH (single line):
//    TESTNET = true  -> Polygon Amoy testnet, test USDC  (free, use faucet)
//    TESTNET = false -> Polygon mainnet, real USDT       (production)
//  The deployed verify-payment function must be in the SAME mode.
// =====================================================================
(function () {
  // Capsule purchases are closed until the pricing/reward model is confirmed.
  // Set to true to open them (the server has the same switch and must match).
  const PURCHASES_ENABLED = false;

  const TESTNET = false; // <-- MAINNET (real USDT). Set to true for Amoy testnet.

  const API = "https://neixdrtamznrooougcda.supabase.co/functions/v1";
  const RECEIVER = "0xcCe26E367aC0c04e0a9ADD40e1141d6eaBF93b8c";
  const SINGLE_USDT = 2;       // 1 pull
  const BUNDLE10_USDT = 18;    // 10 pulls (10% off)
  const TRANSFER_SELECTOR = "0xa9059cbb"; // transfer(address,uint256)

  // --- supported chains ------------------------------------------------
  // USDT only, same price everywhere. NOTE: BSC-USDT has 18 decimals while
  // Polygon/Ethereum USDT have 6 — the amount is computed per chain.
  const CHAINS = {
    polygon: {
      key: "polygon",
      label: "Polygon",
      token: TESTNET
        ? "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582"   // Amoy test USDC
        : "0xc2132d05d31c914a87c6611c10748aeb04b58e8f",  // Polygon USDT
      decimals: 6,
      // Polygon enforces a ~25 gwei priority fee floor; wallets often default below it
      gas: { maxPriorityFeePerGas: "0x6FC23AC00", maxFeePerGas: "0x174876E800" },
      params: TESTNET ? {
        chainId: "0x13882",
        chainName: "Polygon Amoy Testnet",
        nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 },
        rpcUrls: ["https://rpc-amoy.polygon.technology"],
        blockExplorerUrls: ["https://amoy.polygonscan.com"],
      } : {
        chainId: "0x89",
        chainName: "Polygon Mainnet",
        nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 },
        rpcUrls: ["https://polygon-rpc.com"],
        blockExplorerUrls: ["https://polygonscan.com"],
      },
    },
    ethereum: {
      key: "ethereum",
      label: "Ethereum",
      token: "0xdAC17F958D2ee523a2206206994597C13D831ec7",  // Ethereum USDT
      decimals: 6,
      gas: null,                                             // let the wallet decide
      params: {
        chainId: "0x1",
        chainName: "Ethereum Mainnet",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: ["https://eth.llamarpc.com"],
        blockExplorerUrls: ["https://etherscan.io"],
      },
    },
    bsc: {
      key: "bsc",
      label: "BNB Chain",
      token: "0x55d398326f99059fF775485246999027B3197955",  // BSC USDT (18 decimals)
      decimals: 18,
      gas: null,
      params: {
        chainId: "0x38",
        chainName: "BNB Smart Chain",
        nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
        rpcUrls: ["https://bsc-dataseed.binance.org"],
        blockExplorerUrls: ["https://bscscan.com"],
      },
    },
  };
  // Ethereum/BSC are mainnet-only; on testnet only Polygon (Amoy) is offered.
  const AVAILABLE = TESTNET ? ["polygon"] : ["polygon", "ethereum", "bsc"];
  let CHAIN = "polygon";                       // current selection

  const M = (window.MEMONS = window.MEMONS || {});

  M.chains = function () { return AVAILABLE.map((k) => ({ key: k, label: CHAINS[k].label })); };
  M.getChain = function () { return CHAIN; };
  M.setChain = function (key) {
    if (!CHAINS[key] || AVAILABLE.indexOf(key) < 0) throw new Error("Unsupported chain: " + key);
    CHAIN = key;
    return CHAIN;
  };



  // --- pricing (must mirror the server) --------------------------------
  function priceUsdt(pulls) {
    const n = parseInt(pulls, 10) || 0;
    return Math.floor(n / 10) * BUNDLE10_USDT + (n % 10) * SINGLE_USDT;
  }
  function priceRaw(pulls, decimals) {
    const dec = 10n ** BigInt(decimals);
    const n = BigInt(parseInt(pulls, 10) || 0);
    return (n / 10n) * BigInt(BUNDLE10_USDT) * dec + (n % 10n) * BigInt(SINGLE_USDT) * dec;
  }
  M.priceUsdt = priceUsdt;

  // --- helpers ---------------------------------------------------------
  function pad32(h) { return h.padStart(64, "0"); }
  function encodeTransfer(to, amount) {
    return TRANSFER_SELECTOR + pad32(to.toLowerCase().replace(/^0x/, "")) + pad32(amount.toString(16));
  }
  function getToken() {
    return (M.token || M._session || localStorage.getItem("memons_jwt") || "").trim();
  }
  async function ensureNetwork(eth, cfg) {
    const cid = await eth.request({ method: "eth_chainId" });
    if (cid === cfg.params.chainId) return;
    try {
      await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: cfg.params.chainId }] });
    } catch (e) {
      const code = e && (e.code || (e.data && e.data.originalError && e.data.originalError.code));
      if (code === 4902) {
        // chain not added to the wallet yet -> add it (this also switches to it)
        await eth.request({ method: "wallet_addEthereumChain", params: [cfg.params] });
      } else {
        throw new Error("Please switch your wallet to " + cfg.params.chainName + ".");
      }
    }
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // --- pending payments: survive refresh / closed tab -------------------
  // A sent tx is money already spent. We store it locally the moment it is
  // sent, and retry verification until the server credits it. Nothing is lost
  // if the user closes the browser mid-confirmation.
  const PENDING_KEY = "memons_pending_payments_v1";
  function loadPending() {
    try { return JSON.parse(localStorage.getItem(PENDING_KEY) || "[]"); } catch (e) { return []; }
  }
  function savePending(list) {
    try { localStorage.setItem(PENDING_KEY, JSON.stringify(list)); } catch (e) {}
  }
  function addPending(txHash, pulls, from, chain) {
    const list = loadPending();
    if (!list.some((p) => p.tx === txHash)) {
      list.push({ tx: txHash, pulls, from, chain: chain || CHAIN, at: Date.now() });
      savePending(list);
    }
  }
  function removePending(txHash) {
    savePending(loadPending().filter((p) => p.tx !== txHash));
  }
  M.pendingPayments = loadPending;

  // verify one tx (used both by pay() and by the auto-recovery below)
  async function verifyTx(txHash, token, chain) {
    const res = await fetch(`${API}/verify-payment`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ tx_hash: txHash, chain: chain || CHAIN }),
    });
    const j = await res.json().catch(() => ({}));
    return { res, j };
  }

  // Retry every unfinished payment. Safe to call any time: the server is
  // idempotent (already-credited txs just return duplicate:true).
  M.recoverPayments = async function recoverPayments(opts = {}) {
    const onStatus = opts.onStatus || (() => {});
    const token = getToken();
    if (!token) return { recovered: 0, pending: loadPending().length };
    let recovered = 0;
    for (const p of loadPending()) {
      try {
        const { res, j } = await verifyTx(p.tx, token, p.chain);
        if (res.ok && j.ok) { removePending(p.tx); recovered += j.granted || 0; onStatus("credited", p.tx, j.granted); continue; }
        // still confirming -> keep it for next time
        if (res.status === 202 || j.error === "TX_NOT_FOUND" || j.error === "PENDING_CONFIRMATIONS") { onStatus("pending", p.tx); continue; }
        // permanently rejected (failed tx / wrong amount) -> stop retrying
        if (j.error === "TX_FAILED" || j.error === "AMOUNT_NO_MATCHING_PACKAGE" ||
            j.error === "NO_TOKEN_TRANSFER_TO_RECEIVER" || j.error === "SENDER_MISMATCH") {
          removePending(p.tx); onStatus("rejected", p.tx, j.error); continue;
        }
        onStatus("pending", p.tx);   // unknown/transient error -> retry later
      } catch (e) { /* network hiccup: keep it and retry later */ }
    }
    return { recovered, pending: loadPending().length };
  };

  // --- main: pay for N pulls -------------------------------------------
  M.purchasesEnabled = function () { return PURCHASES_ENABLED; };

  M.pay = async function pay(numPulls, opts = {}) {
    if (!PURCHASES_ENABLED) {
      throw new Error("Capsule purchases are temporarily closed. Please try again later.");
    }
    const pulls = parseInt(numPulls, 10);
    if (!Number.isInteger(pulls) || pulls < 1) throw new Error("Invalid pull count.");
    // Read the active provider through the shared accessor. On mobile this is
    // the WalletConnect provider, which cannot always be placed on
    // window.ethereum, so reading the global directly fails after a page load.
    const eth = (window.MEMONS_ETH && window.MEMONS_ETH()) || window.ethereum;
    if (!eth) throw new Error("No wallet found. Connect your wallet first.");
    const token = getToken();
    if (!token) throw new Error("Please connect your wallet first.");

    const cfg = CHAINS[CHAIN];
    await ensureNetwork(eth, cfg);
    const [from] = await eth.request({ method: "eth_requestAccounts" });
    const amount = priceRaw(pulls, cfg.decimals);
    const data = encodeTransfer(RECEIVER, amount);

    const onStatus = opts.onStatus || (() => {});
    onStatus("sending");
    // Polygon (both mainnet and Amoy) enforces a minimum priority fee of
    // ~25 gwei; wallets often default below this and the RPC rejects the tx.
    // We set an explicit floor. With EIP-1559 you are only charged
    // baseFee + priorityFee (never the max), so a generous ceiling is safe.
    const txParams = {
      from,
      to: cfg.token,
      data,
      value: "0x0",
    };
    // some chains (Polygon) need an explicit fee floor; others are left to the wallet
    if (cfg.gas) Object.assign(txParams, cfg.gas);

    const txHash = await eth.request({
      method: "eth_sendTransaction",
      params: [txParams],
    });
    // money has left the wallet -> record it immediately so a refresh/close
    // can never lose the receipt
    addPending(txHash, pulls, from, CHAIN);

    onStatus("confirming");
    const deadline = Date.now() + 5 * 60 * 1000;
    while (Date.now() < deadline) {
      const { res, j } = await verifyTx(txHash, token, CHAIN);
      if (res.ok && j.ok) {
        removePending(txHash);
        onStatus("credited");
        return { ok: true, granted: j.granted, txHash, duplicate: !!j.duplicate };
      }
      if (res.status === 202 || j.error === "TX_NOT_FOUND" || j.error === "PENDING_CONFIRMATIONS") {
        onStatus("confirming", j.confirmations, j.need); await sleep(5000); continue;
      }
      // definitive rejection -> stop retrying this tx
      removePending(txHash);
      throw new Error(j.error || "Payment verification failed.");
    }
    // Not confirmed within the window. The tx is SAVED and will be retried
    // automatically on the next page load — the payment is not lost.
    onStatus("pending", txHash);
    return { ok: false, pending: true, txHash,
             message: "Payment sent but not confirmed yet. It will be credited automatically — you can safely leave this page." };
  };

  // --- auto-recovery on page load --------------------------------------
  // If the user paid but the tab was closed before confirmation, credit it now.
  function autoRecover() {
    if (!loadPending().length) return;
    // wait until a wallet session exists, then retry quietly
    let tries = 0;
    const t = setInterval(async () => {
      tries++;
      if (getToken()) {
        clearInterval(t);
        try {
          const r = await M.recoverPayments();
          if (r.recovered > 0 && window.console) console.info("[MEMONS] recovered pending payment(s): +" + r.recovered + " pulls");
          if (r.recovered > 0) document.dispatchEvent(new CustomEvent("memons:payment-recovered", { detail: r }));
        } catch (e) {}
      } else if (tries > 20) { clearInterval(t); }   // ~20s: user never connected
    }, 1000);
  }
  if (document.readyState !== "loading") autoRecover();
  else document.addEventListener("DOMContentLoaded", autoRecover);
})();
