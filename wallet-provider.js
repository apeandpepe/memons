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

  // Pinned version. An unpinned major can ship a breaking change overnight.
  // Two independent CDNs: jsDelivr has been blocked by Korean ISPs before.
  var CDNS = [
    "https://esm.sh/@walletconnect/ethereum-provider@2.17.0",
    "https://cdn.skypack.dev/@walletconnect/ethereum-provider@2.17.0"
  ];

  var initPromise = null;
  var injectedAtLoad = !!window.ethereum;

  async function loadLib() {
    var lastErr = null;
    for (var i = 0; i < CDNS.length; i++) {
      try {
        var mod = await import(CDNS[i]);
        var EP = mod.EthereumProvider || (mod.default && mod.default.EthereumProvider) || mod.default;
        if (EP && typeof EP.init === "function") return EP;
        lastErr = new Error("WC_BAD_MODULE");
      } catch (e) { lastErr = e; }
    }
    var err = new Error("WC_LOAD_FAILED");
    err.cause = lastErr;
    throw err;
  }

  async function init() {
    var EthereumProvider = await loadLib();

    return EthereumProvider.init({
      projectId: PROJECT_ID,

      // No required namespace. Wallets that cannot commit to a specific chain
      // up front reject the session proposal outright, which is the single
      // biggest cause of failed mobile connections.
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
        redirect: { native: "", universal: location.origin }
      }
    });
  }

  function adopt(p) {
    try { p.__memonsWC = true; } catch (e) {}
    api.provider = p;
    if (!injectedAtLoad) {
      try { window.ethereum = p; } catch (e) {}
    }
    return p;
  }

  var api = {
    provider: null,
    available: true,

    // true when a browser wallet injected itself before we ran
    hasInjected: function () {
      return injectedAtLoad;
    },

    // the provider the app should actually talk to
    active: function () {
      return api.provider || window.ethereum || null;
    },

    // opens the WalletConnect modal (QR on desktop, app list on mobile)
    connect: async function () {
      if (!initPromise) initPromise = init();
      var p;
      try {
        p = await initPromise;
      } catch (e) {
        initPromise = null;          // let the next attempt retry the CDNs
        throw e;
      }
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
      if (injectedAtLoad) return null;
      try {
        if (!initPromise) initPromise = init();
        var p = await initPromise;
        if (p.session && p.accounts && p.accounts.length) return adopt(p);
      } catch (e) {
        initPromise = null;
      }
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
  api.ready = (async function () {
    if (injectedAtLoad) return null;
    try { return await api.restore(); } catch (e) { return null; }
  })();
})();
