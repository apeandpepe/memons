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
  const SS_UTM  = "memons_utm_v1";

  /* ------------------------------------------------------------------
     First touch.

     A visitor arrives on a campaign link, looks around, and connects a
     wallet three pages later -- by then the parameters are long gone from
     the address bar. So they are read once on arrival and held until
     there is a wallet to attach them to.

     Written only if nothing is stored yet. Someone who came through an
     ad in August and returns through a direct link in October is still an
     August arrival; the second visit did not find them.

     sessionStorage, so it lasts the visit and no longer. localStorage
     would keep attributing every future visit to the first campaign
     forever, and is not available in artifacts here regardless.
     ------------------------------------------------------------------ */
  function captureUtm() {
    try {
      if (sessionStorage.getItem(SS_UTM)) return;
      const q = new URLSearchParams(location.search);
      const ref = document.referrer || "";
      const sameSite = ref && ref.indexOf(location.origin) === 0;

      const utm = {};
      const src = q.get("utm_source")   || q.get("ref_src");
      const med = q.get("utm_medium");
      const cmp = q.get("utm_campaign") || q.get("ref_cmp");
      if (src) utm.source   = src;
      if (med) utm.medium   = med;
      if (cmp) utm.campaign = cmp;
      // Own pages are not a source. Only an outside referrer is worth keeping.
      if (!sameSite && ref) utm.referrer = ref;

      // Nothing to say is itself worth recording: it marks the visit as
      // direct rather than as unmeasured.
      sessionStorage.setItem(SS_UTM, JSON.stringify(utm));
    } catch (e) {}
  }
  function readUtm() {
    try {
      const raw = sessionStorage.getItem(SS_UTM);
      if (!raw) return null;
      const u = JSON.parse(raw);
      return u && Object.keys(u).length ? u : null;
    } catch (e) { return null; }
  }
  captureUtm();

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

      /* A session carried over from a previous visit is just as connected as
         one made a moment ago, and listeners care about the state rather than
         the event that produced it. Deferred to a task so a listener defined
         further down the same file, or in a script that loads after this one,
         is already there to hear it. */
      if (address) {
        setTimeout(function () {
          try {
            document.dispatchEvent(new CustomEvent("memons:connected", {
              detail: { address: address, restored: true },
            }));
          } catch (e) {}
        }, 0);
      }
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
  /* The provider, once the page has finished looking for one.

     wallet-provider starts restoring a stored WalletConnect session as
     soon as it loads and publishes the attempt as api.ready. Nothing
     waited on it. On a phone that restore takes a moment and the button
     is on screen immediately, so an early press found no provider and
     said a wallet was required -- to someone who had connected one
     minutes earlier. Pressing again a second later worked, which is how
     it came to feel like it takes a few tries.

     Waiting is bounded: a stored session that cannot be revived should
     fall through to the connect prompt rather than leave the button dead.
     Detection has its own 2.5s ceiling inside the provider, so 3s here is
     past anything it will do on its own. */
  async function waitForProvider() {
    let p = eth();
    if (p) return p;

    const wc = window.MEMONS_WC;
    if (wc && wc.ready) {
      try {
        await Promise.race([
          wc.ready,
          new Promise(function (r) { setTimeout(r, 3000); }),
        ]);
      } catch (e) {}
      p = eth();
      if (p) return p;
    }
    return null;
  }

  async function connect() {
    let p = await waitForProvider();

    /* No stored session and no extension: this is a first connection, and
       opening one is what the button is for. Previously this threw, so a
       phone with no wallet app in the browser got an error where it
       should have got a QR code. */
    if (!p && window.MEMONS_WC && window.MEMONS_WC.connect) {
      try { await window.MEMONS_WC.connect(); } catch (e) {}
      p = eth();
    }
    if (!p) throw new Error("A wallet is required.");

    const accReq = p.request({ method: "eth_requestAccounts" });
    try { if (window.MEMONS_WC && window.MEMONS_WC.openWallet) window.MEMONS_WC.openWallet(); } catch (e) {}
    const accs = await accReq;
    address = (accs[0] || "").toLowerCase();
    if (!address) throw new Error("No account selected.");

    const nonceRes = await get("/auth/nonce?address=" + address);

    try { document.dispatchEvent(new CustomEvent("memons:signing")); } catch (e) {}

    let signature;
    try {
      const req = p.request({ method: "personal_sign", params: [nonceRes.message, address] });
      // Over WalletConnect the request travels to a wallet that is not on
      // screen, so nothing happens until the user goes and finds it. Bring the
      // app forward instead. Sent after the request so it cannot arrive to an
      // empty queue, and a no-op for extensions, which draw their own prompt.
      try { if (window.MEMONS_WC && window.MEMONS_WC.openWallet) window.MEMONS_WC.openWallet(); } catch (e) {}
      signature = await req;
    } finally {
      try { document.dispatchEvent(new CustomEvent("memons:signed")); } catch (e) {}
    }

    const res = await post("/auth/verify", { address, signature, utm: readUtm() }, false);
    token = res.token;
    persist();
    armExpiryTimer();
    bindWalletEvents();

    /* Announced rather than called directly. Anything that needs to run the
       moment a wallet is live -- the attestation delegation, for one -- hangs
       off this instead of being wired into every page that has a connect
       button. Dispatched after the session is stored, so a listener that
       calls back in finds a usable token. */
    try {
      document.dispatchEvent(new CustomEvent("memons:connected", {
        detail: { address: address },
      }));
    } catch (e) {}

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

  /* ── verification popup ───────────────────────────────────────────
     Withdrawal and buyback both reach the point where a check is needed,
     and both are already inside a dialog of their own. Sending someone to
     a page from there loses whatever they had typed, and inside the embed
     there is no dependable way back.

     So it opens over everything, from wherever it was called, and closes
     back onto the screen it covered. It climbs to the outermost frame it
     can reach: opened inside the marketplace, which is itself inside the
     front page, a panel confined to the middle frame would sit in a box
     rather than over the site.

     One copy serves every caller. A second would drift from the first the
     first time either changed. */
  function verify(reason, onPass) {
    const top = (function () {
      try {
        let w = window;
        while (w.parent !== w && w.parent.document) w = w.parent;
        return w;
      } catch (e) { return window; }   // cross-origin: stay where we are
    })();

    if (top.__memonsVerify) { top.__memonsVerify(reason, onPass); return; }
    if (top !== window) {
      /* The outer frame has not loaded this script. Falling back to the
         current frame still works -- it just does not cover as much. */
      return openHere(window, reason, onPass);
    }
    return openHere(window, reason, onPass);
  }

  const WHY = {
    first_withdrawal: "The first withdrawal is checked once. It takes about a minute.",
    over_free_limit:  "This account has taken out more than it put in, so we check again.",
    over_deposit:     "This takes you past what you have put in, so we check again.",
    pending:          "Your last submission is with a reviewer.",
    buyback:          "Selling airdrop cards needs a one-off identity check.",
    /* Neither of these is fixed by trying again, so the panel says what it
       is rather than opening a camera that cannot pass. */
    locked:           "Verification is on hold for this account. Contact support to continue.",
    suspended:        "This account has been suspended. Contact support if you believe this is wrong.",
  };

  function openHere(w, reason, onPass) {
    const d = w.document;
    let wrap = d.getElementById("memonsVerify");
    if (wrap) wrap.remove();

    /* A dead end shows the reason and nothing else -- no frame, no camera. */
    const waiting = reason === "pending" || reason === "locked" || reason === "suspended";

    wrap = d.createElement("div");
    wrap.id = "memonsVerify";
    wrap.innerHTML =
      '<div class="mv-bg"></div>' +
      '<div class="mv-box" role="dialog" aria-modal="true">' +
        '<header class="mv-head">' +
          '<b>Identity check</b>' +
          '<button class="mv-x" aria-label="Close">&times;</button>' +
        '</header>' +
        '<p class="mv-why"></p>' +
        (waiting ? "" : '<iframe class="mv-frame" allow="camera; microphone"></iframe>') +
      "</div>";

    const style = d.createElement("style");
    style.textContent = `
      #memonsVerify{position:fixed;inset:0;z-index:99999;display:flex;align-items:center;
        justify-content:center;padding:20px;font-family:inherit}
      #memonsVerify .mv-bg{position:absolute;inset:0;background:rgba(0,0,0,.82);
        backdrop-filter:blur(3px)}
      #memonsVerify .mv-box{position:relative;width:100%;max-width:760px;
        max-height:calc(100vh - 40px);display:flex;flex-direction:column;
        background:linear-gradient(180deg,#0f0f12,#0a0a0c);
        border:1px solid rgba(233,184,74,.3);border-radius:16px;padding:18px 20px 20px}
      #memonsVerify .mv-head{display:flex;align-items:center;justify-content:space-between;
        margin-bottom:10px}
      #memonsVerify .mv-head b{font-size:15px;letter-spacing:.6px;color:#E9B84A}
      #memonsVerify .mv-x{background:none;border:0;color:#8d8a82;font-size:24px;
        line-height:1;cursor:pointer;padding:0 4px}
      #memonsVerify .mv-x:hover{color:#e8e6e0}
      #memonsVerify .mv-why{color:#8d8a82;font-size:12.5px;line-height:1.7;margin-bottom:14px}
      #memonsVerify .mv-frame{flex:1 1 auto;width:100%;min-height:min(560px,62vh);
        border:1px solid rgba(255,255,255,.08);border-radius:12px;background:#08080a;display:block}
      @media(max-width:620px){ #memonsVerify{padding:0}
        #memonsVerify .mv-box{max-width:none;height:100%;max-height:none;border-radius:0;border:0} }
    `;
    d.head.appendChild(style);
    d.body.appendChild(wrap);

    wrap.querySelector(".mv-why").textContent = WHY[reason] || WHY.first_withdrawal;
    const frame = wrap.querySelector(".mv-frame");
    if (frame) frame.src = "mypage-kyc.html#embed";

    let poll = null;
    function close(passed) {
      if (poll) { clearInterval(poll); poll = null; }
      wrap.remove(); style.remove();
      w.__memonsVerifyOpen = false;
      if (passed && typeof onPass === "function") onPass();
    }
    wrap.querySelector(".mv-x").onclick = () => close(false);
    wrap.querySelector(".mv-bg").onclick = () => close(false);

    /* The frame finishes on its own connection, so this side asks rather
       than waits to be told. Approval closes it; a submission still in
       review leaves the message and drops the camera. */
    if (!waiting) {
      poll = setInterval(async () => {
        try {
          const st = await authFetch("/identity/state");
          if (!st) return;
          if (st.state === "approved") close(true);
          else if (st.state === "pending") {
            clearInterval(poll); poll = null;
            frame.remove();
            wrap.querySelector(".mv-why").textContent = WHY.pending;
          }
        } catch (e) {}
      }, 4000);
    }

    w.__memonsVerifyOpen = true;
    return close;
  }

  /* Published on the window so an inner frame can reach it. */
  window.__memonsVerify = function (reason, onPass) { return openHere(window, reason, onPass); };

  const M = (window.MEMONS = window.MEMONS || {});
  M.verify = verify;
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

  /* Pull in the attestation module rather than asking twenty-two pages to
     each add a script tag. Wallets are connected from most of them, and a
     tag missing from one is a page where the delegation is never offered.

     Loaded once, guarded on the tag already being present so a page that
     does include it explicitly does not get two copies. */
  (function loadAttest() {
    try {
      if (document.querySelector('script[src*="attest-client"]')) return;
      const el = document.createElement("script");
      el.src = "attest-client.js";
      el.async = true;
      (document.head || document.documentElement).appendChild(el);
    } catch (e) { /* the wallet still works without it */ }
  })();
})();
