//  MEMONS — social-login.js
//
//  Google sign-in, and linking a wallet to the account it creates.
//
//  Nothing here replaces the wallet login. The session it writes is the
//  same session gacha-client.js already reads -- same storage key, same
//  kind of token -- so every page that works today keeps working, and a
//  member can arrive by either door.
//
//  Usage:
//    <script src="gacha-client.js"></script>
//    <script src="social-login.js"></script>
//    MEMONS_SOCIAL.mountButton(document.getElementById("gbtn"));
(function () {
  "use strict";

  var API = "https://neixdrtamznrooougcda.supabase.co/functions/v1";
  var GOOGLE_CLIENT_ID =
    "252520400834-l8jfpk5ts0n6kfvb1lcdv0753k9c2tjo.apps.googleusercontent.com";

  /* The same two keys gacha-client.js writes. Writing them here rather
     than inventing our own is the whole trick: the session restores on
     the next page load through code that already exists, so no page has
     to learn about social login to keep a member signed in. */
  var SS_TOKEN = "memons_jwt_v1";
  var SS_ADDR = "memons_addr_v1";

  /* localStorage for the same reason gacha-client uses it: a mobile
     browser discards the tab while the user is away in another app, and
     sessionStorage goes with it. */
  function store() {
    try {
      var k = "__memons_probe";
      localStorage.setItem(k, "1");
      localStorage.removeItem(k);
      return localStorage;
    } catch (e) {
      try { return sessionStorage; } catch (e2) { return null; }
    }
  }

  function save(token, address) {
    var s = store();
    if (!s) return;
    try {
      s.setItem(SS_TOKEN, token);
      s.setItem(SS_ADDR, address || "");
    } catch (e) {}
  }

  function authHeader() {
    var t = (window.MEMONS && window.MEMONS.token) ||
            (store() && store().getItem(SS_TOKEN));
    return t ? { Authorization: "Bearer " + t } : {};
  }

  function post(path, body, auth) {
    var h = { "content-type": "application/json" };
    if (auth) Object.assign(h, authHeader());
    return fetch(API + path, {
      method: "POST",
      headers: h,
      body: JSON.stringify(body || {}),
    }).then(readOrThrow);
  }

  function get(path) {
    return fetch(API + path, { headers: authHeader() }).then(readOrThrow);
  }

  /* The server says what went wrong in `error`. Surfacing that rather
     than "request failed" is the difference between a member who can act
     on the message and one who writes to support. */
  function readOrThrow(r) {
    return r.json().catch(function () { return {}; }).then(function (j) {
      if (!r.ok) throw new Error(j.error || ("HTTP " + r.status));
      return j;
    });
  }

  function emit(name, detail) {
    try {
      document.dispatchEvent(new CustomEvent(name, { detail: detail || {} }));
    } catch (e) {}
  }

  // --- which wallets are installed -----------------------------------

  /* Every extension used to fight over window.ethereum and the last one
     to load won, which is how a member with MetaMask and Bybit installed
     ends up signing with whichever happened to win the race.

     EIP-6963 is the way out: each extension announces itself with its own
     name and its own provider object, so the member picks and we use the
     one they picked. Extensions that do not announce are still reachable
     through window.ethereum, which is kept as a last resort. */
  var found = [];

  function collect(e) {
    var d = e && e.detail;
    if (!d || !d.info || !d.provider) return;
    var seen = found.some(function (x) { return x.info.uuid === d.info.uuid; });
    if (!seen) {
      found.push(d);
      emit("memons:wallets-changed", { count: found.length });
    }
  }

  try {
    window.addEventListener("eip6963:announceProvider", collect);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
  } catch (e) {}

  /* Asked again on demand: an extension that was still waking up when the
     page loaded answers the second call. */
  function wallets() {
    try { window.dispatchEvent(new Event("eip6963:requestProvider")); } catch (e) {}
    return found.map(function (d) {
      return { uuid: d.info.uuid, name: d.info.name, icon: d.info.icon, rdns: d.info.rdns };
    });
  }

  function providerFor(uuid) {
    if (uuid) {
      var hit = found.filter(function (d) { return d.info.uuid === uuid; })[0];
      if (hit) return hit.provider;
    }
    /* Nothing chosen, or a browser with no announcing extension. */
    if (found.length === 1) return found[0].provider;
    if (window.MEMONS && window.MEMONS.eth && window.MEMONS.eth()) {
      return window.MEMONS.eth();
    }
    return window.ethereum || null;
  }

  // --- Google -------------------------------------------------------

  var gisReady = null;

  function loadGis() {
    if (gisReady) return gisReady;
    gisReady = new Promise(function (resolve, reject) {
      if (window.google && window.google.accounts) return resolve();
      var s = document.createElement("script");
      s.src = "https://accounts.google.com/gsi/client";
      s.async = true;
      s.defer = true;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error("could not load Google sign-in")); };
      (document.head || document.documentElement).appendChild(s);
    });
    return gisReady;
  }

  /* What Google hands back is a token about the person, not a session
     with us. It goes to our own function, which checks the signature and
     answers with a MEMONS token. The Google token is never stored. */
  function onCredential(resp) {
    if (!resp || !resp.credential) return;
    emit("memons:social-start", {});

    post("/social/google", { idToken: resp.credential })
      .then(function (j) {
        save(j.token, "");
        /* Ask which wallets this member has before announcing anything.
           A member who linked a wallet earlier should come back with it,
           and the rest of the site reads the address, not the UID. */
        return get("/social/me").then(function (me) {
          var first = (me.wallets && me.wallets[0] && me.wallets[0].address) || "";
          save(j.token, first);
          emit("memons:social-signed-in", { uid: j.uid, address: first });
          return { uid: j.uid, address: first };
        });
      })
      .catch(function (e) {
        emit("memons:social-error", { message: String(e.message || e) });
      });
  }

  /* Draws Google's own button. Theirs rather than ours on purpose: the
     wording, the logo and the disabled states are all things Google
     requires, and a hand-made button is the usual reason sign-in is
     refused later. */
  function mountButton(el, opts) {
    if (!el) return Promise.reject(new Error("no element to mount into"));
    return loadGis().then(function () {
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: onCredential,
        auto_select: false,
        cancel_on_tap_outside: true,
      });
      window.google.accounts.id.renderButton(el, {
        theme: (opts && opts.theme) || "filled_black",
        size: (opts && opts.size) || "large",
        shape: (opts && opts.shape) || "pill",
        text: (opts && opts.text) || "signin_with",
        width: (opts && opts.width) || undefined,
      });
    });
  }

  // --- linking a wallet ---------------------------------------------

  /* Signing proves the wallet is theirs. It costs nothing and moves
     nothing -- the same arrangement the wallet login already uses, with a
     different message so one signature cannot stand in for the other.

     Takes the uuid of the wallet the member picked. Without one it falls
     back to whatever the browser offers, which is only safe when there is
     exactly one. */
  function linkWallet(uuid) {
    var eth = providerFor(uuid);
    if (!eth) return Promise.reject(new Error("no wallet found in this browser"));

    var addr;
    return eth.request({ method: "eth_requestAccounts" })
      .then(function (accts) {
        addr = String(accts[0] || "").toLowerCase();
        if (!addr) throw new Error("no account");
        return get("/social/link-nonce?address=" + addr);
      })
      .then(function (j) {
        return eth.request({ method: "personal_sign", params: [j.message, addr] });
      })
      .then(function (signature) {
        return post("/social/link", { address: addr, signature: signature }, true);
      })
      .then(function (j) {
        /* The address goes into the session so the rest of the site sees
           a connected wallet, exactly as it would after a wallet login. */
        var s = store();
        if (s) { try { s.setItem(SS_ADDR, addr); } catch (e) {} }
        emit("memons:wallet-linked", { address: addr, status: j.status });
        return j;
      })
      .catch(function (e) {
        var m = String(e.message || e);
        if (m === "wallet_taken") {
          m = "This wallet is already linked to another MEMONS account.";
        }
        emit("memons:social-error", { message: m });
        throw new Error(m);
      });
  }

  function me() { return get("/social/me"); }

  // --- reading our own session --------------------------------------

  /* The claims inside the token this browser is holding, without asking
     the server. The header has to decide what to draw before any network
     call comes back, and a page that guesses wrong flickers. */
  function claims() {
    var t = (window.MEMONS && window.MEMONS.token) ||
            (store() && store().getItem(SS_TOKEN));
    if (!t) return null;
    try {
      var p = t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
      var c = JSON.parse(decodeURIComponent(escape(atob(p))));
      if (c && c.exp && c.exp * 1000 < Date.now()) return null;
      return c;
    } catch (e) { return null; }
  }

  /* Which door the member came in by.

     Both logins issue the same token; only the subject differs. A UID
     means Google or Apple, an address means a wallet. Everything that has
     to behave differently reads this rather than keeping its own flag,
     which would go stale the moment a session is restored from storage. */
  function isSocial() {
    var c = claims();
    return !!(c && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      .test(String(c.sub || "")));
  }

  function signOut() {
    var s = store();
    if (s) {
      try { s.removeItem(SS_TOKEN); s.removeItem(SS_ADDR); } catch (e) {}
    }
    try {
      if (window.google && window.google.accounts && window.google.accounts.id) {
        window.google.accounts.id.disableAutoSelect();
      }
    } catch (e) {}
    emit("memons:social-signed-out", {});
  }

  window.MEMONS_SOCIAL = {
    mountButton: mountButton,
    wallets: wallets,
    linkWallet: linkWallet,
    me: me,
    claims: claims,
    isSocial: isSocial,
    signOut: signOut,
    clientId: GOOGLE_CLIENT_ID,
  };
})();
