// =====================================================================
//  MEMONS - wallet provider layer
//  Desktop with an extension  -> the injected window.ethereum is used.
//  Anything else (mobile, no extension) -> WalletConnect.
//  The WalletConnect provider is EIP-1193 compatible, so once connected it
//  is placed on window.ethereum and the rest of the app needs no changes.
//
//  Always read the active provider through MEMONS_ETH(). Some wallets define
//  window.ethereum as a non-writable property, so the assignment below is a
//  convenience, not a guarantee.
// =====================================================================
(function () {
  var PROJECT_ID = "21c80dea3961259c6e5473c2531a5a39";
  var VERSION = "2.17.0";

  // A plain script tag from unpkg, not a dynamic ESM import.
  // The ESM route pulls a dependency graph across the network and, when a CDN
  // is unreachable, the import can stall instead of rejecting. That left the
  // connect button waiting forever with no modal and no error. unpkg is the
  // CDN already proven to work on this audience's networks.
  var UMD = "https://unpkg.com/@walletconnect/ethereum-provider@" + VERSION + "/dist/index.umd.js";
  var ESM = "https://esm.sh/@walletconnect/ethereum-provider@" + VERSION;
  var UMD_GLOBAL = "@walletconnect/ethereum-provider";

  var LOAD_TIMEOUT = 10000;

  var initPromise = null;
  var injectedAtLoad = !!window.ethereum;

  function timeout(ms, label) {
    return new Promise(function (_, reject) {
      setTimeout(function () { reject(new Error(label)); }, ms);
    });
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.onload = function () { resolve(); };
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
    var existing = fromGlobal();
    if (existing) return existing;

    try {
      await Promise.race([loadScript(UMD), timeout(LOAD_TIMEOUT, "UMD_TIMEOUT")]);
      var EP = fromGlobal();
      if (EP) return EP;
    } catch (e) {}

    // Last resort. Also raced, so a stalled request cannot hang the caller.
    try {
      var mod = await Promise.race([import(ESM), timeout(LOAD_TIMEOUT, "ESM_TIMEOUT")]);
      var EP2 = mod.EthereumProvider || (mod.default && mod.default.EthereumProvider) || mod.default;
      if (EP2 && typeof EP2.init === "function") return EP2;
    } catch (e) {}

    throw new Error("WC_LOAD_FAILED");
  }

  async function init() {
    var EthereumProvider = await loadLib();

    return EthereumProvider.init({
      projectId: PROJECT_ID,

      // No required namespace. Wallets that cannot commit to a specific chain
      // up front reject the session proposal outright, which is a common cause
      // of failed mobile connections.
      optionalChains: [1, 137, 56],

      optionalMethods: [
        "personal_sign",
        "eth_sendTransaction",
        "eth_signTypedData_v4",
        "wallet_switchEthereumChain",
        "wallet_addEthereumChain"
      ],

      showQrModal: true,
      qrModalOptions: { themeMode: "dark" },

      metadata: {
        name: "MEMONS",
        description: "The archive of internet culture",
        url: location.origin,
        icons: [location.origin + "/images/logo.png"],

        // Without this the wallet app has no way to hand control back to the
        // browser after the user approves. On mobile the user approves, then
        // sits on the wallet screen wondering why nothing happened.
        // `native` is deliberately omitted: an empty string is treated as a
        // real scheme by some Android wallets and breaks the return trip.
        redirect: { universal: location.origin }
      }
    });
  }

  // Never let one failure poison every later attempt. A rejected or stalled
  // init used to stay cached, so the second tap awaited the same dead promise.
  function ensureInit() {
    if (!initPromise) {
      initPromise = init().catch(function (e) {
        initPromise = null;
        throw e;
      });
    }
    return initPromise;
  }

  function adopt(p) {
    try { p.__memonsWC = true; } catch (e) {}
    api.provider = p;
    if (!injectedAtLoad) {
      try { window.ethereum = p; } catch (e) {}
    }
    return p;
  }

  // WalletConnect keeps its session under wc@2:* keys. Checking first means a
  // visitor who has never connected does not pay to download the library.
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
    provider: null,
    available: true,

    // true when a browser wallet injected itself before we ran
    hasInjected: function () { return injectedAtLoad; },

    // the provider the app should actually talk to
    active: function () { return api.provider || window.ethereum || null; },

    // opens the WalletConnect modal (QR on desktop, app list on mobile)
    connect: async function () {
      var p = await ensureInit();
      await p.enable();
      return adopt(p);
    },

    disconnect: async function () {
      try { if (api.provider && api.provider.disconnect) await api.provider.disconnect(); } catch (e) {}
      if (!injectedAtLoad && window.ethereum && window.ethereum.__memonsWC) {
        try { delete window.ethereum; } catch (e) { window.ethereum = undefined; }
      }
      api.provider = null;
      initPromise = null;
    },

    // Restore a session that is still alive from a previous page.
    // This site is multi-page, so every navigation is a full reload and the
    // provider object is lost. Without this the WalletConnect session survives
    // in the relay but the page has no handle on it, and every signature or
    // payment after the first navigation fails.
    restore: async function () {
      if (injectedAtLoad || !hasStoredSession()) return null;
      try {
        var p = await ensureInit();
        if (p.session && p.accounts && p.accounts.length) return adopt(p);
      } catch (e) {}
      return null;
    }
  };

  window.MEMONS_WC = api;

  // Single accessor used by gacha-client.js and memons-pay.js.
  window.MEMONS_ETH = function () { return api.active(); };

  // Auto-restore on every page load.
  // This lives here rather than in the header script because capsule-reveal.html
  // takes payments but has no header, so it never loads mypage-entry.js. Pages
  // that need to wait can await MEMONS_WC.ready.
  api.ready = api.restore();
})();
