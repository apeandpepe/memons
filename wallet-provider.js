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
    if (!wallets.length) { try { window.ethereum = p; } catch (e) {} }
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
    build: 6,
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

    connect: async function () {
      var p = await ensureInit();
      await p.enable();
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
      await detectPromise;
      if (wallets.length || !hasStoredSession()) return null;
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
