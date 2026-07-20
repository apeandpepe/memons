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

  var initPromise = null;
  var injected = null;

  function timeout(ms, label) {
    return new Promise(function (_, rj) { setTimeout(function () { rj(new Error(label)); }, ms); });
  }

  // --- injected wallet discovery -------------------------------------------
  var detectPromise = new Promise(function (resolve) {
    var done = false;
    function finish(p) {
      if (done) return;
      done = true;
      injected = p || window.ethereum || null;
      resolve(injected);
    }

    if (window.ethereum) return finish(window.ethereum);

    // EIP-6963: wallets answer a request event with their provider.
    function onAnnounce(e) {
      var p = e && e.detail && e.detail.provider;
      if (p) finish(p);
    }
    try {
      window.addEventListener("eip6963:announceProvider", onAnnounce);
      window.dispatchEvent(new Event("eip6963:requestProvider"));
    } catch (err) {}

    // Legacy signal used by wallets that inject late.
    try {
      window.addEventListener("ethereum#initialized", function () { finish(); }, { once: true });
    } catch (err) {}

    // Wallet browsers that do neither still get picked up by polling.
    var started = Date.now();
    var iv = setInterval(function () {
      if (window.ethereum) { clearInterval(iv); finish(window.ethereum); return; }
      if (Date.now() - started > DETECT_TIMEOUT) { clearInterval(iv); finish(null); }
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
      qrModalOptions: { themeMode: "dark" },
      metadata: {
        name: "MEMONS",
        description: "The archive of internet culture",
        url: location.origin,
        icons: [location.origin + "/images/logo.png"],
        redirect: { universal: location.origin }
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
    if (!injected) { try { window.ethereum = p; } catch (e) {} }
    return p;
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
    build: 4,
    provider: null,
    available: true,

    // Resolves once the injected wallet has had a fair chance to appear.
    detect: function () { return detectPromise; },

    hasInjected: function () { return !!injected; },

    active: function () { return api.provider || injected || window.ethereum || null; },

    connect: async function () {
      var p = await ensureInit();
      await p.enable();
      return adopt(p);
    },

    disconnect: async function () {
      try { if (api.provider && api.provider.disconnect) await api.provider.disconnect(); } catch (e) {}
      if (!injected && window.ethereum && window.ethereum.__memonsWC) {
        try { delete window.ethereum; } catch (e) { window.ethereum = undefined; }
      }
      api.provider = null;
      initPromise = null;
    },

    // Every navigation is a full page load, so a live WalletConnect session
    // has to be re-attached or signing and payments break after the first hop.
    restore: async function () {
      await detectPromise;
      if (injected || !hasStoredSession()) return null;
      try {
        var p = await ensureInit();
        if (p.session && p.accounts && p.accounts.length) return adopt(p);
      } catch (e) {}
      return null;
    }
  };

  window.MEMONS_WC = api;
  window.MEMONS_ETH = function () { return api.active(); };

  // capsule-reveal.html takes payments but has no header, so it never loads
  // mypage-entry.js. Restoring here covers every page that includes this file.
  api.ready = api.restore();
})();
