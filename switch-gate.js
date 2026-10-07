/* =====================================================================
 *  switch-gate.js — the wallet is a key now, not an account
 *
 *  A member who signed in with their wallet and has not yet moved to a
 *  MEMONS number sees this before anything else: the site asks them to
 *  attach a Google account or an email, and nothing behind it is reachable
 *  until they do. Everyone else never knows it exists.
 *
 *  Drop it in after gacha-client.js on any page that needs the gate:
 *
 *      <script src="switch-gate.js"></script>
 *
 *  It asks the server, not the page, whether this member still has to
 *  move -- so a member who moved in another tab, or whom the automation
 *  moved overnight, is simply let through.
 *
 *  Needs STEP 65-69 and the social function with /switch and /link-social.
 * ===================================================================== */
(function () {
  "use strict";

  var API = "https://neixdrtamznrooougcda.supabase.co/functions/v1";
  var GOOGLE_CLIENT_ID =
    "252520400834-l8jfpk5ts0n6kfvb1lcdv0753k9c2tjo.apps.googleusercontent.com";
  var SUPPORT = "admin@apepe.lol";

  /* The two keys the rest of the site already reads. */
  var SS_TOKEN = "memons_jwt_v1";
  var SS_ADDR  = "memons_addr_v1";

  /* The three embedded panes on the home page run this file too. One
     gate over the whole window is the point; four stacked inside each
     other is not. */
  if (window.top !== window.self) return;

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

  function token() {
    var s = store();
    return (window.MEMONS && window.MEMONS.token) || (s && s.getItem(SS_TOKEN)) || "";
  }

  function save(t, addr) {
    var s = store();
    if (!s) return;
    try {
      s.setItem(SS_TOKEN, t);
      if (addr !== undefined) s.setItem(SS_ADDR, addr || "");
    } catch (e) {}
  }

  function call(path, body) {
    return fetch(API + path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: "Bearer " + token(),
      },
      body: JSON.stringify(body || {}),
    }).then(function (r) {
      return r.json().catch(function () { return {}; })
        .then(function (j) { return { ok: r.ok, status: r.status, body: j }; });
    });
  }

  // --- does this member still have to move? --------------------------

  /* A preview, which moves nothing. Three answers mean yes: a member with
     no account yet, one whose account has no number of its own, and one
     the preview is willing to quote figures for. Anything else -- already
     moved, a signed-in Google member, a server that did not answer --
     means no, and the page is left alone.

     Failing open is deliberate. A gate that locks the site when the API
     hiccups is worse than one that misses a member for a minute. */
  function needsSwitch() {
    if (!token()) return Promise.resolve(null);

    return call("/social/switch", { dry: true }).then(function (r) {
      var b = r.body || {};
      if (r.status === 401) {
        /* Not a member the server knows yet: a wallet that has never been
           anything but an address. That is exactly who this is for. */
        return /unknown member/i.test(String(b.error || "")) ? {} : null;
      }
      if (!r.ok) return null;
      if (b.status === "preview")    return b;
      if (b.status === "no_account") return {};
      return null;
    }).catch(function () { return null; });
  }

  // --- the screen ----------------------------------------------------

  var CSS = [
    '#msg-gate{position:fixed;inset:0;z-index:2147483000;background:#09090A;',
      'color:#ECEAE4;font-family:Barlow,system-ui,-apple-system,sans-serif;',
      'overflow-y:auto;display:flex;flex-direction:column;align-items:center;',
      'padding:0 20px env(safe-area-inset-bottom,0px)}',
    '#msg-gate *{box-sizing:border-box}',
    '#msg-gate .in{width:100%;max-width:420px;display:flex;flex-direction:column;',
      'gap:28px;padding:48px 0 56px;margin:auto 0}',
    '#msg-gate .mark{font-weight:800;font-size:15px;letter-spacing:.22em;color:#E9B84A;text-align:center}',
    '#msg-gate h1{margin:0;font-size:30px;line-height:1.15;letter-spacing:-.02em;font-weight:800}',
    '#msg-gate p{margin:0;font-size:15.5px;line-height:1.7;color:#9A978E}',
    '#msg-gate .cards{display:flex;align-items:center;justify-content:center;gap:12px;height:112px}',
    '#msg-gate .c{width:66px;height:94px;border-radius:9px;box-shadow:0 10px 26px rgba(0,0,0,.6)}',
    '#msg-gate .c1{border:1.5px solid #8B46A8;background:linear-gradient(160deg,#1E1026,#120A17);transform:rotate(-13deg)}',
    '#msg-gate .c2{width:72px;height:102px;border:1.5px solid #E9B84A;',
      'background:linear-gradient(160deg,#241B0C,#13100A);display:flex;align-items:center;',
      'justify-content:center;font-weight:800;font-size:26px;color:#E9B84A;',
      'box-shadow:0 12px 32px rgba(0,0,0,.7),0 0 28px rgba(233,184,74,.22)}',
    '#msg-gate .c3{border:1.5px solid #2E6FA8;background:linear-gradient(160deg,#0E1A26,#0A1017);transform:rotate(13deg)}',
    '#msg-gate .box{border:1px solid rgba(255,255,255,.09);border-radius:12px;background:#0F0F10;',
      'padding:16px 18px;display:flex;flex-direction:column;gap:11px}',
    '#msg-gate .row{display:flex;align-items:center;gap:10px;font-size:14.5px}',
    '#msg-gate .row b{margin-left:auto;font-weight:600;font-variant-numeric:tabular-nums}',
    '#msg-gate .lab{color:#86837B;font-size:11px;letter-spacing:.16em;font-weight:700}',
    '#msg-gate .addr{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;',
      'font-size:13px;color:#C6C3BA;word-break:break-all}',
    '#msg-gate .gbtn{min-height:48px;display:flex;justify-content:center}',
    '#msg-gate .or{display:flex;align-items:center;gap:10px}',
    '#msg-gate .or i{flex:1;height:1px;background:rgba(255,255,255,.12)}',
    '#msg-gate .or span{color:#6E6B64;font-size:11px;letter-spacing:.1em;font-style:normal}',
    '#msg-gate .fld{width:100%;font-family:inherit;font-size:14.5px;padding:13px 14px;',
      'border-radius:10px;border:1px solid rgba(255,255,255,.14);background:#0D0D0F;',
      'color:#ECEAE4;outline:none}',
    '#msg-gate .fld:focus{border-color:rgba(233,184,74,.5)}',
    '#msg-gate .go{width:100%;font-family:inherit;font-weight:700;font-size:13.5px;',
      'padding:14px;border-radius:10px;border:1px solid rgba(233,184,74,.4);',
      'background:transparent;color:#E9B84A;cursor:pointer}',
    '#msg-gate .go[disabled]{opacity:.55;cursor:default}',
    '#msg-gate .ok{border-left:2px solid #5FBE86;background:rgba(95,190,134,.08);',
      'padding:14px 16px;font-size:14px;line-height:1.7;color:#AEDCC2}',
    '#msg-gate .help{text-align:center;font-size:13.5px;color:#6E6B64;line-height:1.7}',
    '#msg-gate .help a{color:#9A978E}',
    '#msg-gate .err{border-left:2px solid #C4584F;background:rgba(196,88,79,.08);',
      'padding:14px 16px;font-size:14px;line-height:1.7;color:#E0B5B1}',
    '#msg-gate .busy{text-align:center;font-size:14.5px;color:#9A978E}',
    '@media (max-width:420px){#msg-gate h1{font-size:26px}}',
  ].join("");

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function brings(b) {
    var t = (b && b.brings) || {};
    var rows = [
      ["Cards",   t.cards],
      ["Listed",  t.listed],
      ["Offers",  t.offers],
      ["Missions", t.missions],
    ].filter(function (r) { return Number(r[1]) > 0; });

    if (!rows.length) return "";
    return '<div class="box">' + rows.map(function (r) {
      return '<div class="row"><span>' + r[0] + '</span><b>' +
             Number(r[1]).toLocaleString() + "</b></div>";
    }).join("") + "</div>";
  }

  function show(info) {
    if (document.getElementById("msg-gate")) return;

    var st = document.createElement("style");
    st.textContent = CSS;
    document.head.appendChild(st);

    var from = (info && info.from) || (store() && store().getItem(SS_ADDR)) || "";

    var el = document.createElement("div");
    el.id = "msg-gate";
    el.innerHTML =
      '<div class="in">' +
        '<div class="mark">MEMONS</div>' +
        '<div class="cards">' +
          '<div class="c c1"></div>' +
          '<div class="c c2">M</div>' +
          '<div class="c c3"></div>' +
        "</div>" +
        "<div>" +
          "<h1>Sign in without<br>your wallet</h1>" +
          '<p style="margin-top:12px">MEMONS now uses an account of your own — Google or email. ' +
            'Set one up once and ' +
            "everything you own moves with you — you won't need the wallet again.</p>" +
        "</div>" +
        brings(info) +
        (from
          ? '<div><div class="lab">YOUR WALLET</div>' +
            '<div class="addr" style="margin-top:6px">' + esc(from) + "</div></div>"
          : "") +
        '<div id="msg-gate-err"></div>' +
        '<div class="gbtn" id="msg-gate-g"></div>' +
        '<div class="or"><i></i><span>OR</span><i></i></div>' +
        '<div style="display:flex;flex-direction:column;gap:9px">' +
          '<input id="msg-gate-em" class="fld" type="email" autocomplete="email" placeholder="Email">' +
          '<input id="msg-gate-pw" class="fld" type="password" autocomplete="new-password" ' +
            'placeholder="Choose a password (8+ characters)">' +
          '<button id="msg-gate-go" class="go" type="button">CONTINUE WITH EMAIL</button>' +
        "</div>" +
        '<div class="help">Having trouble? ' +
          '<a href="mailto:' + SUPPORT + '?subject=Account%20transfer">' + SUPPORT + "</a>" +
        "</div>" +
      "</div>";

    document.body.appendChild(el);
    document.documentElement.style.overflow = "hidden";

    mountGoogle();
    wireEmail();
  }

  function fail(msg) {
    var box = document.getElementById("msg-gate-err");
    if (box) box.innerHTML = '<div class="err">' + esc(msg) + "</div>";
    var g = document.getElementById("msg-gate-g");
    if (g) g.innerHTML = "";
    mountGoogle();
  }

  function busy(msg) {
    var g = document.getElementById("msg-gate-g");
    if (g) g.innerHTML = '<div class="busy">' + esc(msg) + "</div>";
  }

  function note(msg, good) {
    var box = document.getElementById("msg-gate-err");
    if (box) box.innerHTML = '<div class="' + (good ? "ok" : "err") + '">' + esc(msg) + "</div>";
  }

  // --- the same move, by email ---------------------------------------

  /* For the members Google leaves out. They make a password here and the
     account moves in the same step, exactly as it does for Google. */
  function wireEmail() {
    var em = document.getElementById("msg-gate-em");
    var pw = document.getElementById("msg-gate-pw");
    var go = document.getElementById("msg-gate-go");
    if (!em || !pw || !go) return;

    if (!window.MEMONS_EMAIL) {
      em.parentNode.style.display = "none";
      var or = document.querySelector("#msg-gate .or");
      if (or) or.style.display = "none";
      return;
    }

    function run() {
      go.disabled = true;
      go.textContent = "Moving your collection\u2026";
      note("");

      window.MEMONS_EMAIL.link(em.value.trim(), pw.value)
        .then(function (r) {
          /* Confirmation is usually on, so the honest thing to show is
             the mail rather than a page they have not reached yet. */
          if (r && r.status === "confirm_sent") {
            go.disabled = false;
            go.textContent = "CONTINUE WITH EMAIL";
            note("Check " + em.value.trim() + " and open the link to finish.", true);
            return;
          }
          window.location.reload();
        })
        .catch(function (e) {
          go.disabled = false;
          go.textContent = "CONTINUE WITH EMAIL";
          note(String(e.message || e));
        });
    }

    go.addEventListener("click", run);
    pw.addEventListener("keydown", function (e) { if (e.key === "Enter") run(); });
    em.addEventListener("keydown", function (e) { if (e.key === "Enter") pw.focus(); });
  }

  // --- Google, then the move -----------------------------------------

  var gis = null;
  function loadGis() {
    if (gis) return gis;
    gis = new Promise(function (resolve, reject) {
      if (window.google && window.google.accounts) return resolve();
      var s = document.createElement("script");
      s.src = "https://accounts.google.com/gsi/client";
      s.async = true; s.defer = true;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error("could not load Google sign-in")); };
      (document.head || document.documentElement).appendChild(s);
    });
    return gis;
  }

  function mountGoogle() {
    var host = document.getElementById("msg-gate-g");
    if (!host) return;
    loadGis().then(function () {
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: onCredential,
        auto_select: false,
        cancel_on_tap_outside: true,
      });
      window.google.accounts.id.renderButton(host, {
        theme: "filled_black", size: "large", shape: "pill",
        text: "continue_with", width: 320,
      });
    }).catch(function () {
      host.innerHTML = '<div class="busy">Google sign-in could not be loaded. ' +
                       "Please refresh the page.</div>";
    });
  }

  function onCredential(resp) {
    if (!resp || !resp.credential) return;
    busy("Moving your collection…");

    call("/social/link-social", { idToken: resp.credential, provider: "google" })
      .then(function (r) {
        var b = r.body || {};

        /* That Google account already opens somebody else's account.
           Nothing here can decide which of the two wins. */
        if (r.status === 409 || b.status === "taken") {
          throw new Error(
            "That Google account is already connected to a different MEMONS account. " +
            "Use another one, or email " + SUPPORT + " and we'll sort it out.");
        }
        if (!r.ok || !b.token) {
          throw new Error(b.error || "Something went wrong. Please try again.");
        }

        save(b.token);
        /* The rest of the site reads an address, not a UID, so fetch the
           one this member now answers to before letting the page back. */
        return fetch(API + "/social/me", {
          headers: { Authorization: "Bearer " + b.token },
        }).then(function (r2) { return r2.json(); })
          .then(function (me) {
            var first = (me.wallets && me.wallets[0] && me.wallets[0].address) || "";
            save(b.token, first);
          })
          .catch(function () { /* the address can wait; the token is what matters */ })
          .then(function () { window.location.reload(); });
      })
      .catch(function (e) { fail(String(e.message || e)); });
  }

  // --- go ------------------------------------------------------------

  function start() {
    needsSwitch().then(function (info) {
      if (info) show(info);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
