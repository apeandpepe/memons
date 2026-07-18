// =====================================================================
//  MEMONS - wallet provider layer
//  Desktop with an extension  -> the injected window.ethereum is used.
//  Anything else (mobile, no extension) -> WalletConnect.
//  The WalletConnect provider is EIP-1193 compatible, so once connected it
//  is placed on window.ethereum and the rest of the app needs no changes.
// =====================================================================
(function () {
  var PROJECT_ID = "21c80dea3961259c6e5473c2531a5a39";
  var CDN = "https://esm.sh/@walletconnect/ethereum-provider@2";

  var initPromise = null;

  async function init() {
    var mod = await import(CDN);
    var EthereumProvider = mod.EthereumProvider || (mod.default && mod.default.EthereumProvider);
    if (!EthereumProvider) throw new Error("WalletConnect failed to load");

    return EthereumProvider.init({
      projectId: PROJECT_ID,
      chains: [1],                 // Ethereum mainnet (signing only)
      optionalChains: [137, 56],   // Polygon / BNB for payments
      showQrModal: true,
      metadata: {
        name: "MEMONS",
        description: "The archive of internet culture",
        url: location.origin,
        icons: [location.origin + "/images/logo.png"]
      }
    });
  }

  var api = {
    provider: null,
    available: true,

    // true when a browser wallet already injected itself
    hasInjected: function () {
      return !!(window.ethereum && !window.ethereum.__memonsWC);
    },

    // opens the WalletConnect modal (QR on desktop, app list on mobile)
    connect: async function () {
      if (!initPromise) initPromise = init();
      var p = await initPromise;
      await p.enable();
      try { p.__memonsWC = true; } catch (e) {}
      api.provider = p;
      if (!api.hasInjected()) {
        try { window.ethereum = p; } catch (e) {}
      }
      return p;
    },

    disconnect: async function () {
      try { if (api.provider && api.provider.disconnect) await api.provider.disconnect(); } catch (e) {}
      if (window.ethereum && window.ethereum.__memonsWC) {
        try { delete window.ethereum; } catch (e) { window.ethereum = undefined; }
      }
      api.provider = null;
      initPromise = null;
    },

    // restore a session that is still alive from a previous visit
    restore: async function () {
      if (api.hasInjected()) return null;
      try {
        if (!initPromise) initPromise = init();
        var p = await initPromise;
        if (p.session && p.accounts && p.accounts.length) {
          try { p.__memonsWC = true; } catch (e) {}
          api.provider = p;
          try { window.ethereum = p; } catch (e) {}
          return p;
        }
      } catch (e) {}
      return null;
    }
  };

  window.MEMONS_WC = api;
})();
