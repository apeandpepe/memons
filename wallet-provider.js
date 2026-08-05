// =====================================================================
//  MEMONS - wallet provider layer
//
//  Finding the injected wallet is asynchronous. Reading window.ethereum once
//  at script load misses two very common cases:
//    - mobile wallet browsers that inject after our scripts have run
//    - wallets that announce themselves through EIP-6963 events instead of,
//      or as well as, writing to window.ethereum
//  Getting this wrong made the site believe there was no wallet while running
//  inside the wallet's own browser, which then offered to open the wallet app
//  that was already open.
//
//  Everything downstream reads the provider through MEMONS_ETH(). Some wallets
//  define window.ethereum as non-writable, so assigning to it is a convenience,
//  never a guarantee.
// =====================================================================
(function () {
  var PROJECT_ID = "21c80dea3961259c6e5473c2531a5a39";
  var VERSION = "2.17.0";

  // esm.sh first: measured working inside mobile wallet browsers where the
  // unpkg UMD bundle loads but never registers its global.
  var ESM = "https://esm.sh/@walletconnect/ethereum-provider@" + VERSION;
  var UMD = "https://unpkg.com/@walletconnect/ethereum-provider@" + VERSION + "/dist/index.umd.js";
  var UMD_GLOBAL = "@walletconnect/ethereum-provider";

  var LOAD_TIMEOUT = 10000;
  var DETECT_TIMEOUT = 2500;

  /* Above anything this site puts on screen, with room to spare. */
  var WC_Z = 2147483000;

  /* WalletConnect's registry ids. The modal filters its list by the chains
     asked for, and MetaMask was falling out of that filter -- not buried in
     the ordering but absent, searching for it found nothing. Naming it here
     pins it to the front of the list whatever the filter decides, which is
     the only way to be sure the wallet most people have is the one they see
     first. The others are the ones that actually get used on these chains. */
  var WALLET_IDS = {
    metamask: "c57ca95b47569778a828d19178114f4db188b89b763c899ba0be274e97267d96",
    trust:    "4622a2b2d6af1c9844944291e5e7351a6aa24cd7b23099efac1b2fd875da31a0",
    okx:      "971e689d0a5be527bac79629b4ee9b925e82208e5168b733496a09c0faed0709",
    bitget:   "38f5d18bd8522c244bdd70cb4a68e0e718865155811c043f052fb9f1c51de662",
    coinbase: "fd20dc426fb37566d803205b19bbc1d4096b248ac04548e3cfb6b3a38bd033aa",
  };

  /* The theme variable covers the modal's own layers. This covers the custom
     element that hosts them, which takes its stacking from the page and not
     from the variable -- and it names the tags used by both the version in
     use and the one that replaces it, so an upgrade does not quietly put the
     modal back underneath. */
  (function lift(){
    try {
      var css = document.createElement('style');
      css.textContent =
        ':root{--wcm-z-index:' + WC_Z + ';--w3m-z-index:' + WC_Z + '}' +
        'wcm-modal,w3m-modal,w3m-router,appkit-modal{position:relative;z-index:' + WC_Z + '}';
      (document.head || document.documentElement).appendChild(css);
    } catch (e) {}
  })();

  var initPromise = null;
  var injected = null;

  function timeout(ms, label) {
    return new Promise(function (_, rj) { setTimeout(function () { rj(new Error(label)); }, ms); });
  }

  // --- injected wallet discovery -------------------------------------------
  // Several extensions fight over window.ethereum and whichever loads first
  // wins, so reading that property alone silently picks a wallet for the user.
  // Worse, some wallets set isMetaMask on themselves, so the winner cannot even
  // be identified by name. EIP-6963 exists for this: every installed wallet
  // announces itself separately, which is what lets us offer a choice.
  var wallets = [];          // [{ info, provider }]
  var chosen  = null;        // the one the user picked, or the only one present

  function addWallet(info, provider) {
    if (!provider) return;
    for (var i = 0; i < wallets.length; i++) {
      if (wallets[i].provider === provider) return;
      if (info && wallets[i].info && wallets[i].info.uuid === info.uuid) return;
    }
    wallets.push({ info: info || null, provider: provider });
  }

  var detectPromise = new Promise(function (resolve) {
    var done = false;
    function finish() {
      if (done) return;
      done = true;
      // window.ethereum is only worth adding when nothing announced at all.
      // Otherwise it is one of the wallets already listed, reached through a
      // different object, and it would show up twice under a misleading name:
      // several wallets set isMetaMask on themselves even when they are not.
      if (!wallets.length && window.ethereum) {
        addWallet({ name: window.ethereum.isMetaMask ? "MetaMask" : "Browser wallet", uuid: "legacy" },
                  window.ethereum);
      }
      // Only settle automatically when there is nothing to choose between.
      // Falling back to the first entry would reintroduce the very problem
      // this is here to solve: silently picking a wallet for the user.
      if (wallets.length === 1) chosen = wallets[0].provider;
      injected = chosen;
      resolve(wallets);
    }

    try {
      window.addEventListener("eip6963:announceProvider", function (e) {
        var d = e && e.detail;
        if (d) addWallet(d.info, d.provider);
      });
      window.dispatchEvent(new Event("eip6963:requestProvider"));
    } catch (err) {}

    try {
      window.addEventListener("ethereum#initialized", function () {
        try { window.dispatchEvent(new Event("eip6963:requestProvider")); } catch (e) {}
      }, { once: true });
    } catch (err) {}

    // Announcements arrive within a frame or two. Wallet browsers that inject
    // late and never announce are covered by the poll.
    var started = Date.now();
    var iv = setInterval(function () {
      if (wallets.length || window.ethereum) {
        // Give any slower extension a moment to announce before settling.
        clearInterval(iv);
        setTimeout(finish, 250);
        return;
      }
      if (Date.now() - started > DETECT_TIMEOUT) { clearInterval(iv); finish(); }
    }, 120);
  });

  // --- WalletConnect library ------------------------------------------------
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = src; s.async = true;
      s.onload = resolve;
      s.onerror = function () { reject(new Error("SCRIPT_ERROR")); };
      (document.head || document.documentElement).appendChild(s);
    });
  }
  function fromGlobal() {
    var g = window[UMD_GLOBAL];
    var EP = g && (g.EthereumProvider || (g.default && g.default.EthereumProvider));
    return EP && typeof EP.init === "function" ? EP : null;
  }

  async function loadLib() {
    try {
      var mod = await Promise.race([import(ESM), timeout(LOAD_TIMEOUT, "ESM_TIMEOUT")]);
      var EP = mod.EthereumProvider || (mod.default && mod.default.EthereumProvider) || mod.default;
      if (EP && typeof EP.init === "function") return EP;
    } catch (e) {}

    try {
      await Promise.race([loadScript(UMD), timeout(LOAD_TIMEOUT, "UMD_TIMEOUT")]);
      var EP2 = fromGlobal();
      if (EP2) return EP2;
    } catch (e) {}

    throw new Error("WC_LOAD_FAILED");
  }

  async function init() {
    var EthereumProvider = await loadLib();
    return EthereumProvider.init({
      projectId: PROJECT_ID,
      optionalChains: [1, 137, 56],
      optionalMethods: [
        "personal_sign", "eth_sendTransaction", "eth_signTypedData_v4",
        "wallet_switchEthereumChain", "wallet_addEthereumChain"
      ],
      showQrModal: true,
      /* The QR modal ships with z-index 89. Every overlay on this site sits
         well above that -- the connect gate is at 1500, the event popup at
         1400 -- so the modal opened underneath them and the button looked
         dead to anyone without an extension installed, which on desktop is
         most people. Lifted above everything we draw. */
      qrModalOptions: {
        themeMode: "dark",
        themeVariables: { "--wcm-z-index": String(WC_Z) },
        // MetaMask first, then the wallets that turn up on Polygon and BSC.
        featuredWalletIds: [
          WALLET_IDS.metamask, WALLET_IDS.trust, WALLET_IDS.okx,
          WALLET_IDS.bitget,   WALLET_IDS.coinbase
        ],
        // Somewhere to go for anyone who has no wallet at all. Without it
        // the modal is a QR code for an app they have not installed.
        explorerRecommendedWalletIds: [
          WALLET_IDS.metamask, WALLET_IDS.trust, WALLET_IDS.okx
        ]
      },
      metadata: {
        name: "MEMONS",
        description: "The archive of internet culture",
        url: location.origin,
        icons: [location.origin + "/images/logo.png"],
        /* native as well as universal. universal is the iOS mechanism; on
           Android the wallet reads native to know where to send the user
           back, and with nothing there MetaMask sits on "Connecting" and
           never returns to the browser. A web dApp has no app scheme of
           its own, so the origin goes in both -- which is what
           WalletConnect expects from a site rather than an app.

           This is why iOS worked and Android did not. */
        redirect: { native: location.origin, universal: location.origin }
      }
    });
  }

  // A failed init must not be cached, or every later attempt awaits a dead
  // promise and the button sits on "Connecting" forever.
  function ensureInit() {
    if (!initPromise) {
      initPromise = init().catch(function (e) { initPromise = null; throw e; });
    }
    return initPromise;
  }

  function adopt(p) {
    try { p.__memonsWC = true; } catch (e) {}
    api.provider = p;
    // Only fill the legacy global when nothing else claims it. Detection may
    // still be running, so window.ethereum is checked directly rather than
    // relying on the wallet list being final.
    if (!wallets.length && !window.ethereum) { try { window.ethereum = p; } catch (e) {} }
    return p;
  }

  /* Where to send the user so the wallet comes to the front.
     WalletConnect carries this in the session the wallet itself published, so
     one path covers every wallet rather than a list of hard-coded schemes.
     The modal also records which entry was tapped, which is the fallback when
     a wallet publishes no redirect of its own. */
  function walletLink() {
    try {
      var meta = api.provider && api.provider.session &&
                 api.provider.session.peer && api.provider.session.peer.metadata;
      var r = meta && meta.redirect;
      if (r) {
        // native first: a scheme opens the app directly, while a universal
        // link can be intercepted by the browser and go nowhere useful.
        if (r.native && String(r.native).trim()) return String(r.native).trim();
        if (r.universal && String(r.universal).trim()) return String(r.universal).trim();
      }
    } catch (e) {}
    try {
      var choice = localStorage.getItem("WALLETCONNECT_DEEPLINK_CHOICE");
      if (choice) {
        var o = JSON.parse(choice);
        var href = o && (o.href || o.link);
        if (href && String(href).trim()) return String(href).trim();
      }
    } catch (e) {}
    return null;
  }

  /* Bring the wallet forward for a request the user has to answer.
     Without this the request is delivered silently and the page just sits
     there, leaving the user to find the wallet app themselves. */
  var lastOpen = 0;
  function openWallet() {
    if (!api.provider) return false;            // injected wallets need nothing
    var link = walletLink();
    if (!link) return false;

    var now = Date.now();
    if (now - lastOpen < 1200) return true;     // one request, one switch
    lastOpen = now;

    try {
      if (link.indexOf("http") === 0) {
        window.open(link, "_blank");
      } else {
        window.location.href = link;
      }
      return true;
    } catch (e) { return false; }
  }

  /* Everything WalletConnect keeps between visits. Removed only after a
     failed connect: a live session is what lets a refresh stay signed in,
     so this is not something to do on the way in. */
  function clearWcStorage() {
    try {
      var kill = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && (k.indexOf("wc@2:") === 0 || k === "WALLETCONNECT_DEEPLINK_CHOICE")) kill.push(k);
      }
      kill.forEach(function (k) { localStorage.removeItem(k); });
    } catch (e) {}
  }

  function hasStoredSession() {
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf("wc@2:") === 0) return true;
      }
    } catch (e) {}
    return false;
  }

  var api = {
    build: 11,
    provider: null,
    available: true,

    // Resolves once every installed wallet has had a fair chance to announce.
    detect: function () { return detectPromise; },

    // [{ info, provider }] for each wallet found. info.name and info.icon come
    // from the wallet itself, so no list of known wallets has to be maintained.
    list: function () { return wallets.slice(); },

    // The wallet the user settled on. Set automatically when only one exists.
    choose: function (provider) {
      chosen = provider || null;
      injected = chosen;
      return chosen;
    },

    hasInjected: function () { return wallets.length > 0; },

    active: function () { return api.provider || chosen || injected || null; },

    // Brings the connected wallet app to the front. No-op with an extension.
    openWallet: openWallet,
    walletLink: walletLink,

    connect: async function () {
      var p = await ensureInit();

      /* enable() waits on the wallet with no deadline of its own. When the
         pairing does not complete -- a stale topic from a previous visit,
         a relay that never answers -- the promise never settles and the
         button stays on "Connecting" until the page is reloaded.

         Ninety seconds is long enough to find the wallet app, approve, and
         come back, and short enough that a dead attempt ends in something
         the caller can report. */
      try {
        await Promise.race([
          p.enable(),
          new Promise(function (_, rej) {
            setTimeout(function () { rej(new Error("WC_CONNECT_TIMEOUT")); }, 90000);
          })
        ]);
      } catch (e) {
        /* A pairing that failed leaves its topic behind, and the next
           attempt reuses it and fails the same way. Clearing puts the
           following try back to a first connection. */
        try { if (p.disconnect) await p.disconnect(); } catch (e2) {}
        clearWcStorage();
        initPromise = null;
        api.provider = null;
        throw e;
      }
      return adopt(p);
    },

    disconnect: async function () {
      try { if (api.provider && api.provider.disconnect) await api.provider.disconnect(); } catch (e) {}
      if (!wallets.length && window.ethereum && window.ethereum.__memonsWC) {
        try { delete window.ethereum; } catch (e) { window.ethereum = undefined; }
      }
      api.provider = null;
      initPromise = null;
    },

    // Every navigation is a full page load, so a live WalletConnect session
    // has to be re-attached or signing and payments break after the first hop.
    restore: async function () {
      // Deliberately not waiting on detection first. On a phone there is no
      // extension to find, so detection runs its full 2.5s timeout, and a
      // stored WalletConnect session sat unrestored for that whole time. The
      // page had already decided it was disconnected by then, which is what
      // made a refresh look like a logout.
      if (!hasStoredSession()) { await detectPromise; return null; }

      var p = null;
      try { p = await ensureInit(); } catch (e) { return null; }
      if (!(p.session && p.accounts && p.accounts.length)) { await detectPromise; return null; }

      // Adopted straight away. A live session is what the user chose last
      // time, and active() reads api.provider before anything an extension
      // might announce, so a late arrival cannot displace it.
      return adopt(p);
    }
  };

  /* ---- warm the library up in the background ---------------------------
     The bundle is around 875KB and, until now, was only fetched once the
     user pressed connect. On a slow line that is several seconds of a
     button that appears to do nothing. Fetching it while the page is idle
     puts it in the browser cache, so the press finds it already there.

     Nothing is initialised and no network session is opened: this is a
     download and nothing more, so it cannot open a wallet or connect
     anything by itself. If it fails, connect falls back to fetching the
     library then, which is exactly what happened before.

     Skipped where the data would not be welcome: an injected wallet needs
     none of this, and a metered or slow connection should not spend 875KB
     on something the visitor may never use. */
  var warmed = false;
  function warm() {
    if (warmed || api.provider || injected) return;
    warmed = true;
    try {
      var c = navigator.connection;
      if (c) {
        if (c.saveData) return;
        if (/(^|-)2g$/.test(c.effectiveType || "")) return;
      }
      var l = document.createElement("link");
      l.rel = "modulepreload";
      l.href = ESM;
      l.crossOrigin = "anonymous";
      (document.head || document.documentElement).appendChild(l);
    } catch (e) {}
  }

  function scheduleWarm() {
    // After load, and only when the browser has nothing better to do, so it
    // never competes with the page's own images and scripts.
    var go = function () {
      if (window.requestIdleCallback) requestIdleCallback(warm, { timeout: 4000 });
      else setTimeout(warm, 2000);
    };
    if (document.readyState === "complete") go();
    else window.addEventListener("load", go, { once: true });
  }

  api.warm = warm;

  window.MEMONS_WC = api;
  window.MEMONS_ETH = function () { return api.active(); };

  // capsule-reveal.html takes payments but has no header, so it never loads
  // mypage-entry.js. Restoring here covers every page that includes this file.
  api.ready = api.restore();

  // Only worth doing when WalletConnect is the likely route: with an
  // extension present the library is never loaded at all.
  api.ready.then(function () {
    if (!injected && !api.provider) scheduleWarm();
  });
})();
