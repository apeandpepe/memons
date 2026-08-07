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

  let IS_TESTER = false;

  /* Asks the same function the market functions ask, so there is one
     answer to "may this wallet act while things are closed" rather than a
     second list to keep in step. */
  async function checkTester() {
    try {
      const a = window.MEMONS && window.MEMONS.address;
      if (!a) return false;
      const r = await fetch(SB_URL + "/rest/v1/rpc/market_open_for", {
        method: "POST",
        headers: { apikey: SB_ANON, Authorization: "Bearer " + SB_ANON,
                   "content-type": "application/json" },
        body: JSON.stringify({ p_address: a }),
      });
      if (!r.ok) return false;
      return !!(await r.json());
    } catch (e) { return false; }
  }

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
      /* A wallet on the market's tester list passes the server's check
         even with the switch off, so the button has to know -- otherwise
         it stays covered by COMING SOON for the people meant to be
         testing it. Refreshed with the flags, since it depends on which
         wallet is connected. */
      IS_TESTER = await checkTester();
      if (j && j.prices) {
        if (j.prices.single   > 0) SINGLE_USDT   = Number(j.prices.single);
        if (j.prices.bundle10 > 0) BUNDLE10_USDT = Number(j.prices.bundle10);
      }
    } catch (e) {}
    return DEPOSITS_ENABLED;
  }
  refreshFlags();
  /* Re-asked once a wallet appears. The first call runs at page load, when
     nobody is connected yet and the tester answer is necessarily no --
     leaving the charge button covered for the very people meant to press
     it. */
  document.addEventListener("memons:connected", function () { refreshFlags(); });

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
  M.depositsEnabled  = function () { return DEPOSITS_ENABLED || IS_TESTER; };
  M.purchasesEnabled = function () { return PURCHASES_ENABLED || IS_TESTER; };
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
  /* A hash that never reaches the chain never stops being retried, and
     "speed up" or "cancel" in MetaMask produces exactly that: the original
     is replaced and the one written down here is orphaned. Two of those
     accumulated during testing and sat in the queue ahead of the real
     transfer, which is why a deposit that confirms in fifteen seconds took
     three minutes to appear.

     Ten minutes. Polygon settles in seconds and Ethereum in a couple of
     minutes, so anything still missing after ten was replaced or dropped
     and is not coming. */
  const PENDING_TTL = 10 * 60 * 1000;

  M.recoverPayments = async function recoverPayments(opts = {}) {
    const onStatus = opts.onStatus || (() => {});
    const token = getToken();
    if (!token) return { recovered: 0, pending: loadPending().length };

    const now = Date.now();
    const live = [];
    for (const p of loadPending()) {
      if (now - (p.at || 0) > PENDING_TTL) { onStatus("expired", p.tx); continue; }
      live.push(p);
    }
    if (live.length !== loadPending().length) savePending(live);

    /* Asked all at once rather than one after another. Serially, a hash
       the node cannot find holds up every entry behind it for the length
       of its own round trip. */
    const out = await Promise.all(live.map(async (p) => {
      try {
        const { res, j } = await verifyTx(p.tx, token, p.chain);
        if (res.ok && j.ok) return { tx: p.tx, drop: true, granted: j.granted || 0, st: "credited" };
        // still confirming -> keep it for next time
        if (res.status === 202 || j.error === "TX_NOT_FOUND" || j.error === "PENDING_CONFIRMATIONS") {
          return { tx: p.tx, drop: false, st: "pending" };
        }
        // permanently rejected (failed tx / wrong amount) -> stop retrying
        if (j.error === "TX_FAILED" || j.error === "AMOUNT_NO_MATCHING_PACKAGE" ||
            j.error === "NO_TOKEN_TRANSFER_TO_RECEIVER" || j.error === "SENDER_MISMATCH") {
          return { tx: p.tx, drop: true, granted: 0, st: "rejected", err: j.error };
        }
        return { tx: p.tx, drop: false, st: "pending" };
      } catch (e) {
        return { tx: p.tx, drop: false, st: "pending" };  // network hiccup
      }
    }));

    let recovered = 0;
    const keep = [];
    for (const r of out) {
      if (r.drop) { recovered += r.granted || 0; onStatus(r.st, r.tx, r.granted || r.err); }
      else { keep.push(live.find((p) => p.tx === r.tx)); onStatus("pending", r.tx); }
    }
    savePending(keep);
    return { recovered, pending: keep.length };
  };

  // --- main: pay for N pulls -------------------------------------------
  M.pay = async function pay(numPulls, opts = {}) {
    // Re-read at the moment of paying: a tab left open across a launch
    // would otherwise hold whatever was true when it loaded.
    await refreshFlags();
    if (!PURCHASES_ENABLED && !IS_TESTER) {
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
    if (!(await refreshFlags()) && !IS_TESTER && !opts.allowClosed) {
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
  /* Paid, then the tab was closed or reloaded before the confirmation came
     back. The transfer is on chain and the record is not, so it is retried
     from the list in localStorage.

     Retried on a schedule rather than once at load. A transfer needs five
     Polygon blocks and a page opened straight after paying will find it
     unconfirmed on the first attempt -- and then wait until the next visit
     to look again, which for someone who paid and left is a balance that
     shows up days later. Every fifteen seconds while the tab is in front,
     stopping as soon as the list is empty.

     Also on return to the tab: on a phone the wallet app takes the
     foreground during payment, and coming back is exactly when the
     transfer has just been confirmed. */
  function autoRecover() {
    let tries = 0;
    let busy = false;

    async function attempt() {
      if (busy) return;
      if (!loadPending().length) { stop(); return; }
      if (!getToken()) {
        // ~40s of waiting for a wallet, then give up until the next load.
        if (++tries > 40) stop();
        return;
      }
      busy = true;
      try {
        const r = await M.recoverPayments();
        if (r.recovered > 0) {
          if (window.console) console.info("[MEMONS] recovered pending payment(s): +" + r.recovered + " pulls");
          document.dispatchEvent(new CustomEvent("memons:payment-recovered", { detail: r }));
        }
        if (!r.pending) stop();
      } catch (e) {} finally { busy = false; }
    }

    let waitTok = null, poll = null;
    let since = Date.now();

    function stop() {
      if (waitTok) { clearInterval(waitTok); waitTok = null; }
      if (poll) { clearTimeout(poll); poll = null; }
    }

    /* Close together at first, further apart later.

       Polygon needs five blocks, which is ten to fifteen seconds, so the
       answer usually arrives within the first minute -- and a flat fifteen
       second gap meant a transfer confirming just after a check waited
       most of another one for nothing. Three seconds covers that window.

       Past a minute the delay is no longer the chain, and asking four
       times as often will not change it. */
    function schedule() {
      if (poll) clearTimeout(poll);
      const elapsed = Date.now() - since;
      const gap = elapsed < 60000 ? 3000 : 15000;
      poll = setTimeout(function () {
        if (!document.hidden) attempt();
        schedule();
      }, gap);
    }

    waitTok = setInterval(function () { if (!getToken()) attempt(); }, 1000);
    schedule();
    attempt();

    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) attempt();
    });
  }
  if (document.readyState !== "loading") autoRecover();
  else document.addEventListener("DOMContentLoaded", autoRecover);
})();
