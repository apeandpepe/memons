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

  function post(path, body, auth) {
    var h = { "content-type": "application/json" };
    if (auth) {
      var t = (window.MEMONS && window.MEMONS.token) ||
              (store() && store().getItem(SS_TOKEN));
      if (t) h.Authorization = "Bearer " + t;
    }
    return fetch(API + path, {
      method: "POST",
      headers: h,
      body: JSON.stringify(body || {}),
    }).then(readOrThrow);
  }

  function get(path) {
    var h = {};
    var t = (window.MEMONS && window.MEMONS.token) ||
            (store() && store().getItem(SS_TOKEN));
    if (t) h.Authorization = "Bearer " + t;
    return fetch(API + path, { headers: h }).then(readOrThrow);
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

  function emit(name, detail) {
    try {
      document.dispatchEvent(new CustomEvent(name, { detail: detail || {} }));
    } catch (e) {}
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
     different message so one signature cannot stand in for the other. */
  function linkWallet() {
    var eth = (window.MEMONS && window.MEMONS.eth && window.MEMONS.eth()) ||
              window.ethereum;
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
    linkWallet: linkWallet,
    me: me,
    signOut: signOut,
    clientId: GOOGLE_CLIENT_ID,
  };
})();
