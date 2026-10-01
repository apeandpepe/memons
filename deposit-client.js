/* ============================================================
   MEMONS - deposit addresses

   A member has one deposit address. It is theirs, it does not change,
   and the same address works on every network we accept.

   That is a different arrangement from the one this replaced, where
   everybody sent to the same company address and a deposit was matched to
   a person by its amount -- which is why the old screens asked for an
   exact figure, started a countdown, and failed the deposit if either
   slipped. None of that is needed when the address itself says who sent
   it, so the screens that use this ask for nothing at all: they show the
   address.

   Include after gacha-client.js:
     <script src="deposit-client.js"></script>

   Exposes:
     MEMONS_DEPOSIT.address()   -> Promise<{address, chains:[...]}>
     MEMONS_DEPOSIT.render(el)  -> fills an element with the panel
     MEMONS_DEPOSIT.clear()     -> forget the cached answer, on sign-out
   ============================================================ */
(function () {
  "use strict";

  var API = "https://neixdrtamznrooougcda.supabase.co/functions/v1";

  /* Held for the life of the page. The address is settled the first time
     it is asked for and cannot change afterwards, so asking again on every
     modal open would be a round trip for an answer we already have. */
  var cached = null;
  var inflight = null;

  function token() {
    try {
      return (window.MEMONS && window.MEMONS.token) ||
             localStorage.getItem("memons_jwt_v1") || "";
    } catch (e) { return ""; }
  }

  function address() {
    if (cached) return Promise.resolve(cached);
    if (inflight) return inflight;

    var t = token();
    if (!t) return Promise.reject(new Error("NOT_SIGNED_IN"));

    inflight = fetch(API + "/deposit/me", { headers: { Authorization: "Bearer " + t } })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (!r.ok) throw new Error(j.error || ("HTTP " + r.status));
          return j;
        });
      })
      .then(function (j) { cached = j; inflight = null; return j; })
      .catch(function (e) { inflight = null; throw e; });

    return inflight;
  }

  function clear() { cached = null; inflight = null; }

  // --- the QR --------------------------------------------------------

  /* Two sources, because one CDN being unreachable should leave a missing
     convenience rather than an empty square. qrcode-generator rather than
     qrcode: the latter keeps its browser bundle in a build folder that is
     not published, so every CDN path to it returns 404. */
  var qrReady = null;
  function qrlib() {
    if (typeof qrcode !== "undefined") return Promise.resolve();
    if (qrReady) return qrReady;
    var SRC = ["https://unpkg.com/qrcode-generator@1.4.4/qrcode.js",
               "https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js"];
    qrReady = new Promise(function (res, rej) {
      (function next(i) {
        if (i >= SRC.length) return rej(new Error("no library"));
        var t = document.createElement("script");
        t.src = SRC[i];
        t.onload = function () { typeof qrcode !== "undefined" ? res() : next(i + 1); };
        t.onerror = function () { next(i + 1); };
        document.head.appendChild(t);
      })(0);
    });
    return qrReady;
  }

  function drawQr(el, text) {
    return qrlib().then(function () {
      var qr = qrcode(0, "M");
      qr.addData(text);
      qr.make();
      el.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
      var svg = el.querySelector("svg");
      if (svg) { svg.style.width = "100%"; svg.style.height = "100%"; }
    }).catch(function () {
      /* The address is the thing that matters; the picture of it is not. */
      el.style.display = "none";
    });
  }

  // --- the panel ------------------------------------------------------

  var CSS_ID = "memons-deposit-css";
  var CSS = [
    ".mdep{font-family:inherit}",
    ".mdep-wrap{display:flex;gap:18px;align-items:flex-start;flex-wrap:wrap}",
    ".mdep-qr{width:148px;height:148px;background:#fff;border-radius:11px;padding:7px;",
      "flex:0 0 auto;display:flex;align-items:center;justify-content:center;overflow:hidden}",
    ".mdep-right{flex:1 1 240px;min-width:0}",
    ".mdep-addr{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;",
      "line-height:1.6;word-break:break-all;color:#E9B84A;background:rgba(233,184,74,.07);",
      "border:1px solid rgba(233,184,74,.25);border-radius:9px;padding:12px 13px;user-select:all}",
    ".mdep-copy{margin-top:9px;display:inline-flex;align-items:center;gap:6px;font-family:inherit;",
      "font-weight:700;font-size:12px;letter-spacing:.5px;padding:10px 15px;border-radius:9px;",
      "cursor:pointer;color:#1c1500;border:none;background:linear-gradient(150deg,#f4d27a,#E9B84A 60%)}",
    ".mdep-chains{margin-top:12px;display:flex;gap:6px;flex-wrap:wrap}",
    ".mdep-chain{font-size:11px;letter-spacing:.4px;padding:5px 10px;border-radius:999px;",
      "border:1px solid rgba(255,255,255,.16);color:#a99d85}",
    ".mdep-warn{margin-top:15px;display:flex;gap:9px;align-items:flex-start;font-size:12px;",
      "line-height:1.6;color:#d8b06a;background:rgba(233,184,74,.06);",
      "border:1px solid rgba(233,184,74,.22);border-radius:10px;padding:11px 13px}",
    ".mdep-warn b{color:#E9B84A}",
    ".mdep-msg{color:#8d8a82;font-size:13px;padding:14px 0;text-align:center}",
    ".mdep-err{color:#e0556a;font-size:13px;padding:14px 0;text-align:center}",
    "@media(max-width:480px){.mdep-qr{width:128px;height:128px;margin:0 auto}",
      ".mdep-right{flex-basis:100%}}",
  ].join("");

  function styles() {
    if (document.getElementById(CSS_ID)) return;
    var s = document.createElement("style");
    s.id = CSS_ID;
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  /* Fills `el` with the whole panel: address, QR, networks and the one
     warning worth making. Returns a promise so a caller can tell whether
     there is anything to show before opening a modal around it. */
  function render(el) {
    if (!el) return Promise.reject(new Error("no element"));
    styles();
    el.classList.add("mdep");
    el.innerHTML = '<div class="mdep-msg">Loading your deposit address…</div>';

    return address().then(function (data) {
      var chains = (data.chains || []).map(function (c) {
        return '<span class="mdep-chain">' + esc(c.name) + "</span>";
      }).join("");

      el.innerHTML =
        '<div class="mdep-wrap">' +
          '<div class="mdep-qr"></div>' +
          '<div class="mdep-right">' +
            '<div class="mdep-addr"></div>' +
            '<button type="button" class="mdep-copy">COPY ADDRESS</button>' +
            '<div class="mdep-chains">' + chains + "</div>" +
          "</div>" +
        "</div>" +
        '<div class="mdep-warn"><div><b>Send USDT only.</b> ' +
          "Anything else sent here cannot be credited or returned. " +
          "Use one of the networks above.</div></div>";

      /* textContent rather than innerHTML for the address itself: it is
         the one string on the page that must arrive exactly as the server
         sent it. */
      var addrEl = el.querySelector(".mdep-addr");
      addrEl.textContent = data.address;
      addrEl.title = data.address;

      drawQr(el.querySelector(".mdep-qr"), data.address);

      el.querySelector(".mdep-copy").onclick = function () {
        var btn = this;
        function done() {
          btn.textContent = "COPIED";
          setTimeout(function () { btn.textContent = "COPY ADDRESS"; }, 1700);
        }
        function selectInstead() {
          /* Clipboard access is refused on an insecure origin and inside
             some wallet browsers. Selecting the text lets the member copy
             it by hand rather than being told it failed. */
          try {
            var r = document.createRange();
            r.selectNodeContents(addrEl);
            var s = window.getSelection();
            s.removeAllRanges();
            s.addRange(r);
          } catch (e) {}
        }
        try {
          var p = navigator.clipboard && navigator.clipboard.writeText(data.address);
          if (p && p.then) p.then(done, selectInstead); else selectInstead();
        } catch (e) { selectInstead(); }
      };

      return data;
    }).catch(function (e) {
      var m = String(e.message || e);
      el.innerHTML = '<div class="mdep-err"></div>';
      el.querySelector(".mdep-err").textContent =
        (m === "NOT_SIGNED_IN" || m === "not signed in")
          ? "Sign in to see your deposit address."
          : m;
      throw e;
    });
  }

  document.addEventListener("memons:disconnected", clear);
  document.addEventListener("memons:social-signed-out", clear);
  document.addEventListener("memons:expired", clear);

  window.MEMONS_DEPOSIT = { address: address, render: render, clear: clear };
})();
