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
  // Capsule purchases, from the same row as deposits. Was a constant here
  // and another on the server, with the same ordering trap.
  let PURCHASES_ENABLED = false;

  /* Prices come from the same row as the switches. They were constants
     here and in verify-payment, and the two had to agree exactly -- the
     client decides what to send, the server decides what an amount bought,
     and a mismatch produces a transfer nobody can identify.

     Defaults hold until the first lookup answers, so a slow network shows
     the usual figures rather than zero. */
  let SINGLE_USDT = 2;       // 1 pull
  let BUNDLE10_USDT = 18;    // 10 pulls (10% off)
  /* Deposits are governed by the database, not by this file.

     It used to be a constant here and another in verify-payment, and both
     had to be flipped in the right order or the pay button was live
     against a server that would refuse the transfer. One value, read by
     both, cannot disagree with itself.

     Closed until told otherwise: a failed lookup leaves the button shut
     rather than open. */
  let DEPOSITS_ENABLED = false;

  const SB_URL  = "https://neixdrtamznrooougcda.supabase.co";
  const SB_ANON = "sb_publishable_xXzlHTJ4cX8kJoEGXw_csw_q5qFK1nO";

  async function refreshFlags() {
    try {
      const r = await fetch(SB_URL + "/rest/v1/rpc/site_flags", {
        method: "POST",
        headers: { apikey: SB_ANON, Authorization: "Bearer " + SB_ANON,
                   "content-type": "application/json" },
        body: "{}",
      });
      if (!r.ok) return DEPOSITS_ENABLED;
      const j = await r.json();
      DEPOSITS_ENABLED  = !!(j && j.deposits);
      PURCHASES_ENABLED = !!(j && j.purchases);
      if (j && j.prices) {
        if (j.prices.single   > 0) SINGLE_USDT   = Number(j.prices.single);
        if (j.prices.bundle10 > 0) BUNDLE10_USDT = Number(j.prices.bundle10);
      }
    } catch (e) {}
    return DEPOSITS_ENABLED;
  }
  refreshFlags();

  const TESTNET = false; // <-- MAINNET (real USDT). Set to true for Amoy testnet.

  const API = "https://neixdrtamznrooougcda.supabase.co/functions/v1";
  const RECEIVER = "0xcCe26E367aC0c04e0a9ADD40e1141d6eaBF93b8c";
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

  /* Attached after M exists, not beside refreshFlags where they were
     first written -- M is declared with const further down this file, and
     touching it earlier threw before anything else in here could run. The
     whole module died on load, so payTo was missing and the deposit
     button reported NO_PAY. */
  M.depositsEnabled  = function () { return DEPOSITS_ENABLED; };
  M.purchasesEnabled = function () { return PURCHASES_ENABLED; };
  M.refreshFlags     = refreshFlags;

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
      const swReq = eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: cfg.params.chainId }] });
      try { if (window.MEMONS_WC && window.MEMONS_WC.openWallet) window.MEMONS_WC.openWallet(); } catch (e) {}
      await swReq;
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
  M.pay = async function pay(numPulls, opts = {}) {
    // Re-read at the moment of paying: a tab left open across a launch
    // would otherwise hold whatever was true when it loaded.
    await refreshFlags();
    if (!PURCHASES_ENABLED) {
      throw new Error("Capsule purchases are temporarily closed. Please try again later.");
    }
    const pulls = parseInt(numPulls, 10);
    if (!Number.isInteger(pulls) || pulls < 1) throw new Error("Invalid pull count.");
    const eth = await activeWallet();
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

    const txReq = eth.request({
      method: "eth_sendTransaction",
      params: [txParams],
    });
    // Over WalletConnect the prompt appears in an app that is not on screen.
    // Bring it forward, or the page waits on a confirmation the user cannot see.
    try { if (window.MEMONS_WC && window.MEMONS_WC.openWallet) window.MEMONS_WC.openWallet(); } catch (e) {}
    const txHash = await txReq;
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

  /* The active wallet, waking the session up if it has gone quiet.

     A signed-in visitor on a phone is signed in because the token is in
     localStorage. The WalletConnect session that produced it is not
     restored by that -- every navigation is a fresh page, and the pairing
     only comes back when something asks for it. Nothing did, so the first
     payment of a visit found no provider and told someone looking at
     their own address in the header that no wallet was connected.

     restore() reopens a session that already exists and returns null if
     there is none, so it costs a moment and never prompts. connect() is
     the fallback and does prompt -- right at that point, because by then
     there really is nothing to send with. */
  async function activeWallet() {
    let eth = window.MEMONS_ETH ? window.MEMONS_ETH() : window.ethereum;
    if (eth) return eth;

    const wc = window.MEMONS_WC;
    if (wc) {
      if (wc.restore) { try { await wc.restore(); } catch (e) {} }
      eth = window.MEMONS_ETH ? window.MEMONS_ETH() : window.ethereum;
      if (eth) return eth;

      if (wc.connect) { try { await wc.connect(); } catch (e) {} }
      eth = window.MEMONS_ETH ? window.MEMONS_ETH() : window.ethereum;
      if (eth) return eth;
    }
    return null;
  }

  /* Send an arbitrary USDT amount to a given address.
     pay() prices capsules and knows where they go; a marketplace balance
     top-up is neither, so the amount and the destination both come from the
     order the user created. Verification is the same endpoint: the server
     works out what the transfer was for from the address it landed on. */
  M.payTo = async function payTo(to, amountUsdt, opts = {}) {
    /* Checked again at the moment of paying, not only at page load. A tab
       left open through a launch would otherwise still believe deposits
       were shut -- or, worse, still believe they were open after they
       closed.

       The refusal is soft: the page cannot tell whether this wallet is on
       the market's tester list, so a closed switch is not proof that this
       particular transfer will be rejected. verify-payment makes that
       call, with the address in front of it, and the caller passes
       allowClosed when it has already been told the order is valid --
       which only happens if the market function created one. */
    if (!(await refreshFlags()) && !opts.allowClosed) {
      throw new Error("Balance top-ups are not open yet.");
    }
    if (!/^0x[0-9a-fA-F]{40}$/.test(String(to || ""))) throw new Error("Invalid destination address.");
    const amt = Number(amountUsdt);
    if (!(amt > 0)) throw new Error("Invalid amount.");

    const eth = await activeWallet();
    if (!eth) throw new Error("No wallet found. Connect your wallet first.");
    const token = getToken();
    if (!token) throw new Error("Please connect your wallet first.");

    const cfg = CHAINS[CHAIN];
    await ensureNetwork(eth, cfg);
    const [from] = await eth.request({ method: "eth_requestAccounts" });

    // Whole units scaled by the token's decimals, via BigInt so a large
    // amount cannot lose precision on the way.
    const raw = BigInt(Math.round(amt * 1e6)) * (10n ** BigInt(cfg.decimals)) / 1000000n;
    const data = encodeTransfer(to.toLowerCase(), raw);

    const onStatus = opts.onStatus || (() => {});
    onStatus("sending");

    const txParams = { from, to: cfg.token, data, value: "0x0" };
    if (cfg.gas) Object.assign(txParams, cfg.gas);

    const txReq = eth.request({ method: "eth_sendTransaction", params: [txParams] });
    try { if (window.MEMONS_WC && window.MEMONS_WC.openWallet) window.MEMONS_WC.openWallet(); } catch (e) {}
    const txHash = await txReq;
    addPending(txHash, 0, from, CHAIN);

    onStatus("confirming");
    const deadline = Date.now() + 5 * 60 * 1000;
    while (Date.now() < deadline) {
      const { res, j } = await verifyTx(txHash, token, CHAIN);
      if (res.ok && j.ok) {
        removePending(txHash);
        onStatus("credited");
        return { ok: true, credited: j.credited, balance: j.balance, txHash };
      }
      if (res.status === 202 || j.error === "TX_NOT_FOUND" || j.error === "PENDING_CONFIRMATIONS") {
        onStatus("confirming", j.confirmations, j.need); await sleep(5000); continue;
      }
      removePending(txHash);
      throw new Error(j.error || "Deposit verification failed.");
    }
    onStatus("pending", txHash);
    return { ok: false, pending: true, txHash,
             message: "Transfer sent but not confirmed yet. It will be credited automatically." };
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
