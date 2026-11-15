//  MEMONS — x-auth.js
//
//  Signing in with X (Twitter), and attaching X to an account that
//  already exists.
//
//  Google hands the browser a signed token we can check on the spot. X
//  does not: it sends the browser away to x.com and brings it back with
//  a short code that only our server can trade in, because trading it
//  needs a secret the browser must never hold. So this file's job is to
//  send the member out correctly and to hand what comes back to
//  /social/x — nothing is decided here.
//
//  The session it writes is the same one gacha-client.js reads, so every
//  page keeps working without knowing X exists.
//
//  Usage:
//    <script src="gacha-client.js"></script>
//    <script src="x-auth.js"></script>
//
//    MEMONS_X.signIn();                 // sign in / sign up with X
//    MEMONS_X.link();                   // attach X to the account I am in
//    MEMONS_X.complete();               // on the callback page only
//
(function () {
  "use strict";

  var API = "https://neixdrtamznrooougcda.supabase.co/functions/v1";

  /* Where X sends the member back to.

     The extension follows whatever the page itself was opened as. Some
     static servers -- npx serve among them -- answer a request for
     /page.html with a redirect to /page, and a redirect throws away the
     query string. X puts the authorization code in that query string, so
     losing it loses the sign-in. Matching the page's own form means the
     server has no reason to redirect at all.

     X compares the string exactly, so every form of every origin has to
     be listed in the developer console under Callback URI:

         https://www.apepe.io/x-callback
         https://www.apepe.io/x-callback.html
         http://localhost:3000/x-callback
         http://localhost:3000/x-callback.html

     X accepts http only for localhost; everything else must be https. */
  var REDIRECT_URI = location.origin + "/x-callback" +
                     (/\.html?$/i.test(location.pathname) ? ".html" : "");

  var CLIENT_ID = "TVEtdmxJRVZsVDBFX3U2bjhsZmM6MTpjaQ";

  /* ★ users.email is deliberately NOT here yet.

     With it, the server could match a returning member by email the way
     Google already does, and nobody would land on a new empty account.
     But X refuses the whole sign-in -- "Something went wrong" before the
     member ever sees a prompt -- if the App does not itself have email
     permission, and that permission needs the terms and privacy URLs
     filled in first.

     So: get those two pages up, switch "Request email from users" on in
     the developer console, THEN add users.email back to this line. Until
     then /merge-x covers the returning member, at the cost of one extra
     screen.

     tweet.read is here because X wants at least one read scope alongside
     users.read. We never read anyone's posts. */
  var SCOPES = "users.read tweet.read";

  /* Same two keys gacha-client.js writes. */
  var SS_TOKEN = "memons_jwt_v1";
  var SS_ADDR  = "memons_addr_v1";

  /* What we need to remember across the trip to x.com. localStorage
     rather than sessionStorage for the reason social-login.js gives: a
     mobile browser can discard the tab while the member is away, and
     sessionStorage goes with it. */
  var K_VERIFIER = "memons_x_verifier";
  var K_STATE    = "memons_x_state";
  var K_MODE     = "memons_x_mode";
  var K_RETURN   = "memons_x_return";
  var K_XTOKEN   = "memons_x_token";   // kept only until a merge finishes
  /* 연결을 시작할 때의 토큰을 떠 둡니다.

     X 를 다녀오는 사이 세션이 사라질 수 있습니다 -- 앱 안의
     브라우저가 돌아올 때 저장소를 새로 주거나, 6시간짜리 토큰이
     그 사이에 끝나거나. 그러면 돌아와서야 "로그인이 안 되어
     있습니다" 를 보게 되는데, 누를 때는 분명히 되어 있었습니다.
     그래서 그 순간의 토큰을 같이 들고 갑니다. */
  var K_LINKTOK  = "memons_x_linktok";

  function store() {
    try {
      localStorage.setItem("__memons_probe", "1");
      localStorage.removeItem("__memons_probe");
      return localStorage;
    } catch (e) {
      try { return sessionStorage; } catch (e2) { return null; }
    }
  }
  function put(k, v) { var s = store(); if (s) { try { s.setItem(k, v); } catch (e) {} } }
  function get(k)    { var s = store(); try { return s && s.getItem(k); } catch (e) { return null; } }
  function drop(k)   { var s = store(); if (s) { try { s.removeItem(k); } catch (e) {} } }

  function token() {
    return (window.MEMONS && window.MEMONS.token) || get(SS_TOKEN) || "";
  }

  function emit(name, detail) {
    try { document.dispatchEvent(new CustomEvent(name, { detail: detail || {} })); }
    catch (e) {}
  }

  function post(path, body, auth, useToken) {
    var h = { "content-type": "application/json" };
    if (auth) { var t = useToken || token(); if (t) h.Authorization = "Bearer " + t; }
    return fetch(API + path, {
      method: "POST", headers: h, body: JSON.stringify(body || {}),
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) {
          var e = new Error(j.detail || j.error || ("HTTP " + r.status));
          e.code = j.error || "";
          throw e;
        }
        return j;
      });
    });
  }

  // --- PKCE ----------------------------------------------------------

  /* The verifier is a secret this browser keeps; the challenge is its
     hash, which is what travels to X. When the code comes back, sending
     the verifier proves the same browser started the flow -- so a code
     stolen in transit is of no use to anyone else. */

  function b64url(bytes) {
    var s = "";
    var a = new Uint8Array(bytes);
    for (var i = 0; i < a.length; i++) s += String.fromCharCode(a[i]);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function randomString(n) {
    var a = new Uint8Array(n);
    crypto.getRandomValues(a);
    return b64url(a);
  }

  function challengeFor(verifier) {
    return crypto.subtle
      .digest("SHA-256", new TextEncoder().encode(verifier))
      .then(b64url);
  }

  // --- going out -----------------------------------------------------

  /* mode decides which door we come back through:
       "signin" -> /social/x        a session, new account or old
       "link"   -> /social/link-x   hang X off the account I am in now  */
  function go(mode, opts) {
    opts = opts || {};

    /* PKCE needs crypto.subtle, which the browser only exposes on a
       secure origin -- https, or localhost. Opened over a LAN address
       like http://192.168.0.15:3000 it is simply not there, and the
       failure is a TypeError halfway through rather than anything that
       names the cause. Saying so here saves the hunt. */
    if (!window.crypto || !window.crypto.subtle) {
      return Promise.reject(new Error(
        location.protocol === "https:" || /^(localhost|127\.0\.0\.1)$/.test(location.hostname)
          ? "this browser cannot do the cryptography X sign-in needs"
          : "X sign-in needs https or localhost. Open the site at " +
            "http://localhost:3000 rather than " + location.host + "."
      ));
    }

    var verifier = randomString(48);
    var state    = randomString(16);

    put(K_VERIFIER, verifier);
    put(K_STATE, state);
    put(K_MODE, mode);
    put(K_RETURN, opts.returnTo || location.href);
    if (mode === "link") put(K_LINKTOK, token() || "");

    return challengeFor(verifier).catch(function (e) {
      throw new Error("could not prepare the sign-in: " + (e && e.message || e));
    }).then(function (challenge) {
      var q =
        "response_type=code" +
        "&client_id=" + encodeURIComponent(CLIENT_ID) +
        "&redirect_uri=" + encodeURIComponent(REDIRECT_URI) +
        "&scope=" + encodeURIComponent(SCOPES) +
        "&state=" + encodeURIComponent(state) +
        "&code_challenge=" + encodeURIComponent(challenge) +
        "&code_challenge_method=S256";
      location.href = "https://x.com/i/oauth2/authorize?" + q;
    });
  }

  function signIn(opts) { return go("signin", opts); }
  function link(opts)   { return go("link", opts); }

  // --- coming back ---------------------------------------------------

  /* Called by the callback page. Reads the code X put in the URL, hands
     it to our server, and writes the session.

     Resolves with what the page needs to decide what to show next --
     above all `fresh`, which says this account was made by this very
     sign-in and so may belong to someone who already has one. */
  function complete() {
    var p = new URLSearchParams(location.search);
    var code  = p.get("code");
    var state = p.get("state");
    var err   = p.get("error");

    var mode     = get(K_MODE) || "signin";
    var verifier = get(K_VERIFIER);
    var returnTo = get(K_RETURN) || "/";

    function cleanup() {
      drop(K_VERIFIER); drop(K_STATE); drop(K_MODE); drop(K_LINKTOK);
    }

    if (err) {
      cleanup();
      /* access_denied is the member pressing Cancel on X. Not an error
         worth a red screen -- they changed their mind. */
      return Promise.reject(Object.assign(
        new Error(err === "access_denied" ? "cancelled" : err),
        { code: err, returnTo: returnTo }
      ));
    }
    if (!code) {
      cleanup();
      return Promise.reject(Object.assign(new Error("no code"), { returnTo: returnTo }));
    }
    /* A mismatched state means the request did not start here. */
    if (!state || state !== get(K_STATE)) {
      cleanup();
      return Promise.reject(Object.assign(new Error("bad state"), { returnTo: returnTo }));
    }
    if (!verifier) {
      cleanup();
      return Promise.reject(Object.assign(
        new Error("this browser lost the sign-in it started"), { returnTo: returnTo }));
    }

    var payload = { code: code, code_verifier: verifier, redirect_uri: REDIRECT_URI };

    /* 로그인(=가입)으로 들어가는 길. 연결이 세션을 잃었을 때도
       여기로 떨어집니다. */
    function asSignIn() {
      return post("/social/x", payload, false).then(function (j) {
        cleanup();
        put(SS_TOKEN, j.token);
        put(K_XTOKEN, j.token);
        return fetch(API + "/social/me", {
          headers: { Authorization: "Bearer " + j.token },
        }).then(function (r) { return r.json(); }).then(function (me) {
          var first = (me.wallets && me.wallets[0] && me.wallets[0].address) || "";
          put(SS_ADDR, first);
          var out = {
            mode: "signin", returnTo: returnTo, token: j.token, uid: j.uid,
            handle: j.handle, email: j.email,
            fresh: j.fresh === true, address: first,
          };
          emit("memons:x-signed-in", out);
          return out;
        });
      });
    }

    if (mode === "link") {
      /* 나갈 때 떠 둔 토큰을 먼저 씁니다. 없으면 지금 것. */
      var linkTok = get(K_LINKTOK) || "";
      return post("/social/link-x", payload, true, linkTok).then(function (j) {
        cleanup();
        if (j.token) put(SS_TOKEN, j.token);
        emit("memons:x-linked", j);
        return { mode: "link", returnTo: returnTo, result: j };
      }).catch(function (e) {
        /* 세션이 끝내 없었던 경우. 서버는 토큰을 먼저 보고 거절하므로
           X 가 준 코드는 아직 쓰이지 않았습니다 -- 그대로 로그인으로
           들어가면 됩니다. 돌아와서 "로그인이 안 되어 있습니다" 를
           보여 주고 끝내는 것보다, 들어가게 해 주고 계정이 갈렸으면
           합치기를 띄우는 편이 낫습니다. */
        var why = String((e && (e.code || e.message)) || "");
        if (why.indexOf("not signed in") >= 0 || why.indexOf("unknown member") >= 0) {
          return asSignIn().catch(function (e2) {
            cleanup(); e2.returnTo = returnTo; throw e2;
          });
        }
        cleanup(); e.returnTo = returnTo; throw e;
      });
    }

    return asSignIn().then(function (out) { return out; }).catch(function (e) {
      cleanup(); e.returnTo = returnTo; throw e;
    });

  }

  // --- merging -------------------------------------------------------

  /* The member signed in with X, found an empty account, and has now
     signed in again the old way. Both tokens are ours, so the server can
     see that both accounts belong to whoever is sitting here.

     Call this straight after the second sign-in, while the session
     belongs to the real account. */
  function mergeAfterLogin() {
    var x = get(K_XTOKEN);
    if (!x) return Promise.reject(new Error("nothing to merge"));
    return post("/social/merge-x", { x_token: x }, true).then(function (j) {
      drop(K_XTOKEN);
      if (j.token) put(SS_TOKEN, j.token);
      emit("memons:x-merged", j);
      return j;
    });
  }

  function pendingMerge() { return !!get(K_XTOKEN); }
  function forgetMerge()  { drop(K_XTOKEN); }

  window.MEMONS_X = {
    signIn: signIn,
    link: link,
    complete: complete,
    mergeAfterLogin: mergeAfterLogin,
    pendingMerge: pendingMerge,
    forgetMerge: forgetMerge,
    clientId: CLIENT_ID,
    redirectUri: REDIRECT_URI,
  };
})();
