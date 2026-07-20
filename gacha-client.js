// =====================================================================
//  MEMONS pull client (frontend)
//  connect wallet -> sign-in -> pull / query state. All results are decided server-side.
//  Usage: include <script src="gacha-client.js"></script>, then use window.MEMONS.
//
//  The wallet address is the account. Everything a user owns lives in the
//  database keyed by that address and is never tied to the session, so an
//  expired session costs the user one signature, nothing else.
// =====================================================================
(function () {
  // API base (Supabase Edge Functions)
  const API = "https://neixdrtamznrooougcda.supabase.co/functions/v1";

  const SS_TOKEN = "memons_jwt_v1", SS_ADDR = "memons_addr_v1";
  const SKEW_MS = 60 * 1000;   // treat a token as dead a minute early

  let token = null;
  let address = null;

  // Never read window.ethereum directly. On mobile the active provider is the
  // WalletConnect one, and some wallets make window.ethereum non-writable, so
  // the provider layer cannot always place itself there.
  function eth() {
    // Same rule as the header: never let window.ethereum override a deliberate
    // null from the accessor, which means no wallet has been chosen yet.
    if (window.MEMONS_ETH) return window.MEMONS_ETH();
    return window.ethereum || null;
  }

  // localStorage, not sessionStorage. Mobile browsers discard the tab while the
  // user is away in the wallet app, which wipes sessionStorage and logs the user
  // out at the exact moment they finish approving.
  const store = (function () {
    try {
      const k = "__memons_probe";
      localStorage.setItem(k, "1"); localStorage.removeItem(k);
      return localStorage;
    } catch (e) {
      try { return sessionStorage; } catch (e2) { return null; }
    }
  })();

  // --- token expiry --------------------------------------------------------
  // The server issues a 6 hour JWT. Read its exp claim rather than tracking a
  // separate local lifetime, so the client and the server can never disagree
  // about whether a session is still good.
  function claimsOf(t) {
    try {
      const p = String(t).split(".")[1];
      if (!p) return null;
      const b64 = p.replace(/-/g, "+").replace(/_/g, "/");
      const c = JSON.parse(atob(b64 + "===".slice((b64.length + 3) % 4)));
      return c && typeof c === "object" ? c : null;
    } catch (e) { return null; }
  }
  function expiryOf(t) {
    const c = claimsOf(t);
    return c && typeof c.exp === "number" ? c.exp * 1000 : 0;
  }
  function alive(t) {
    if (!t) return false;
    const c = claimsOf(t);
    if (!c) return false;                        // unreadable -> not a session
    if (typeof c.exp !== "number") return true;  // no exp claim -> server decides
    return Date.now() < c.exp * 1000 - SKEW_MS;
  }

  function clearStore() {
    if (!store) return;
    try {
      store.removeItem(SS_TOKEN); store.removeItem(SS_ADDR);
      store.removeItem("memons_exp_v1");         // written by an earlier build
    } catch (e) {}
  }
  function persist() {
    if (!store) return;
    try {
      if (token) { store.setItem(SS_TOKEN, token); store.setItem(SS_ADDR, address || ""); }
      else clearStore();
    } catch (e) {}
  }
  (function load() {
    if (!store) return;
    try {
      const t = store.getItem(SS_TOKEN);
      if (!alive(t)) { clearStore(); return; }
      token = t;
      address = store.getItem(SS_ADDR) || null;
    } catch (e) {}
  })();

  // Session is over. The header must stop claiming the user is connected,
  // otherwise pages render as if the account had lost all its cards.
  function expire() {
    if (!token && !address) return;
    resetSession();
    try { document.dispatchEvent(new CustomEvent("memons:expired")); } catch (e) {}
  }

  // Fire the moment the current token lapses while the tab is open, and again
  // whenever the tab regains focus after being backgrounded.
  let expTimer = null;
  function armExpiryTimer() {
    if (expTimer) { clearTimeout(expTimer); expTimer = null; }
    if (!token) return;
    const exp = expiryOf(token);
    if (!exp) return;
    const ms = exp - SKEW_MS - Date.now();
    if (ms <= 0) { expire(); return; }
    if (ms < 24 * 60 * 60 * 1000) expTimer = setTimeout(expire, ms);
  }
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden && token && !alive(token)) expire();
  });

  // --- transport -----------------------------------------------------------
  async function call(path, opts) {
    opts = opts || {};
    const headers = {};
    const hasBody = opts.body !== undefined && opts.body !== null;
    const isPost = opts.body !== undefined;
    if (hasBody) headers["content-type"] = "application/json";
    if (opts.auth && token) headers["Authorization"] = "Bearer " + token;

    const r = await fetch(API + path, {
      method: isPost ? "POST" : "GET",
      headers,
      body: hasBody ? JSON.stringify(opts.body) : undefined
    });
    const j = await r.json().catch(() => ({}));

    // The server rejected our credentials. Nothing the caller does will fix
    // that, so drop the session here instead of surfacing a raw 401.
    if (r.status === 401 && opts.auth) {
      expire();
      throw new Error("SESSION_EXPIRED");
    }
    if (!r.ok) throw new Error(j.error || ("HTTP " + r.status));
    return j;
  }
  function post(path, body, auth) { return call(path, { body: body === undefined ? null : body, auth: auth }); }
  function get(path, auth) { return call(path, { auth: auth }); }

  // --- session -------------------------------------------------------------
  async function connect() {
    const p = eth();
    if (!p) throw new Error("A wallet is required.");

    const accs = await p.request({ method: "eth_requestAccounts" });
    address = (accs[0] || "").toLowerCase();
    if (!address) throw new Error("No account selected.");

    const nonceRes = await get("/auth/nonce?address=" + address);

    // The wallet app is now in the foreground on mobile. Tell the page so it can
    // show a hint instead of looking frozen.
    try { document.dispatchEvent(new CustomEvent("memons:signing")); } catch (e) {}

    let signature;
    try {
      signature = await p.request({ method: "personal_sign", params: [nonceRes.message, address] });
    } finally {
      try { document.dispatchEvent(new CustomEvent("memons:signed")); } catch (e) {}
    }

    const res = await post("/auth/verify", { address, signature }, false);
    token = res.token;
    persist();
    armExpiryTimer();
    bindWalletEvents();
    return address;
  }

  function requireSession() {
    if (!alive(token)) { expire(); throw new Error("SESSION_EXPIRED"); }
  }

  async function state() {
    requireSession();
    await ensureSameAccount();
    return await get("/game", true);
  }

  async function pull() {
    requireSession();
    await ensureSameAccount();
    return await post("/game", null, true);
  }

  async function authFetch(path, body) {
    requireSession();
    return await call(path, { body: body === undefined ? undefined : body, auth: true });
  }

  // guard: if the wallet's current account differs from our session, drop it.
  // An empty account list is not evidence of a change. A WalletConnect provider
  // that has not finished restoring reports zero accounts for a moment, and
  // treating that as a disconnect logs the user out on every page load.
  async function ensureSameAccount() {
    try {
      const p = eth();
      if (!p || !address) return;
      const accs = await p.request({ method: "eth_accounts" });
      const cur = (accs && accs[0] ? accs[0] : "").toLowerCase();
      if (cur && cur !== address) resetSession();
    } catch (e) {}
  }

  function resetSession() {
    token = null; address = null; persist();
    if (expTimer) { clearTimeout(expTimer); expTimer = null; }
  }

  async function disconnect() { resetSession(); }

  async function switchAccount() {
    const p = eth();
    if (!p) throw new Error("A wallet is required.");

    const before = address;
    try {
      await p.request({ method: "wallet_requestPermissions", params: [{ eth_accounts: {} }] });
    } catch (e) {
      if (e && e.code === 4001) throw new Error("Account switch cancelled.");
      throw new Error("This wallet doesn't support switching from the site. Change the account in your wallet, then reconnect.");
    }

    const accs = await p.request({ method: "eth_accounts" });
    const next = (accs && accs[0] ? accs[0] : "").toLowerCase();
    if (!next) throw new Error("No account selected.");
    if (next === before) return before;

    resetSession();
    return await connect();
  }

  // --- wallet events -------------------------------------------------------
  // Bound lazily and re-bound after connect, because on mobile there is no
  // provider at script-load time.
  let bound = null;
  function bindWalletEvents() {
    const p = eth();
    if (!p || !p.on || bound === p) return;
    bound = p;

    p.on("accountsChanged", function (accs) {
      const next = (accs && accs[0] ? accs[0] : "").toLowerCase();

      // Wallets fire this immediately after the user approves the very first
      // connection, with the account we just authenticated. Reloading here
      // destroys the session a fraction of a second after creating it.
      if (!address) return;
      if (next === address) return;

      resetSession();
      location.reload();
    });

    p.on("disconnect", function () { resetSession(); location.reload(); });

    // chainChanged is deliberately not handled. Sign-in uses personal_sign,
    // which is chain independent, and memons-pay.js switches chains on purpose
    // during checkout. Dropping the session here logged the user out mid-payment.
  }
  bindWalletEvents();
  armExpiryTimer();

  const M = (window.MEMONS = window.MEMONS || {});
  M.connect = connect;
  M.state = state;
  M.pull = pull;
  M.authFetch = authFetch;
  M.resetSession = resetSession;
  M.disconnect = disconnect;
  M.switchAccount = switchAccount;
  M.bindWalletEvents = bindWalletEvents;
  M.eth = eth;
  M.expiresAt = function () { return token ? expiryOf(token) : 0; };
  Object.defineProperty(M, "token", { get() { return token; }, configurable: true });
  Object.defineProperty(M, "address", { get() { return address; }, configurable: true });
  Object.defineProperty(M, "connected", { get() { return alive(token); }, configurable: true });
})();
