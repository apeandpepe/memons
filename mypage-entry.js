/* ============================================================
   MEMONS - wallet header (drop-in, ALL pages)
   Include on every page that has the site header:
     <script src="wallet-provider.js"></script>
     <script src="gacha-client.js"></script>
     <script src="mypage-entry.js"></script>
   ============================================================ */
(function () {
  function shortAddr(a) { return a ? (a.slice(0, 6) + '\u2026' + a.slice(-4)) : ''; }

  function isMobileDevice() {
    return /Android|iPhone|iPad|iPod|Opera Mini|IEMobile|Mobile/i.test(navigator.userAgent || '');
  }
  function isAndroid() { return /Android/i.test(navigator.userAgent || ''); }

  /* Deep link target. Deliberately origin + path only.
     A query string here is ambiguous: metamask.app.link cannot tell where its
     own parameters end and the destination's begin, and it answers with "this
     page does not exist". The cost is one extra tap on connect once the wallet
     browser has opened, which is worth paying for a link that actually opens. */
  function targetUrl() {
    try {
      var u = new URL(location.href);
      return u.origin + u.pathname;
    } catch (e) { return location.origin + location.pathname; }
  }

  /* Android shows an app chooser for plain https links, because the browser and
     the wallet can both handle them. An intent:// URL names the package
     outright, so the wallet opens directly with no chooser in between. */
  function walletLink(pkg, httpsUrl) {
    if (!isAndroid()) return httpsUrl;
    return 'intent://' + httpsUrl.replace(/^https?:\/\//, '') +
           '#Intent;scheme=https;package=' + pkg +
           ';S.browser_fallback_url=' + encodeURIComponent(httpsUrl) + ';end';
  }

  function metamaskLink() {
    return walletLink('io.metamask',
      'https://metamask.app.link/dapp/' + targetUrl().replace(/^https?:\/\//, ''));
  }
  function trustLink() {
    return walletLink('com.wallet.crypto.trustapp',
      'https://link.trustwallet.com/open_url?coin_id=60&url=' + encodeURIComponent(targetUrl()));
  }

  function ready() {
    var hr = document.querySelector('header .hr') || document.querySelector('.hr')
      || document.querySelector('header') || document.body;
    var wbtn = document.querySelector('.wbtn') || document.getElementById('headWallet');
    if (!wbtn) return;
    var origHtml = wbtn.innerHTML;
    var host = wbtn.parentElement || hr;
    var busy = false;

    /* Signing in costs two trips to the wallet app: approve the session, then
       approve the signature. After the first trip the wallet sends the browser
       back through the universal link, which reloads the page and drops the
       half-finished login. Leaving a marker lets the reloaded page pick the
       signature step up on its own instead of asking the user to tap again. */
    var PENDING = 'memons_connecting_v1', PENDING_TTL = 5 * 60 * 1000;
    function markPending() {
      try { localStorage.setItem(PENDING, String(Date.now())); } catch (e) {}
    }
    function clearPending() {
      try { localStorage.removeItem(PENDING); } catch (e) {}
    }
    function isPending() {
      try {
        var t = parseInt(localStorage.getItem(PENDING) || '0', 10);
        return !!t && (Date.now() - t) < PENDING_TTL;
      } catch (e) { return false; }
    }

    function makeBtn(cls, text) {
      var b = document.createElement('button');
      b.className = cls; b.type = 'button'; b.textContent = text;
      return b;
    }
    var SUB = 'display:none;margin-left:8px;font-family:inherit;font-size:11px;letter-spacing:.6px;'
      + 'color:#8d8a82;background:transparent;border:1px solid rgba(255,255,255,.18);border-radius:7px;'
      + 'padding:9px 12px;cursor:pointer;transition:.15s;';

    var discBtn = document.querySelector('.wallet-disc');
    if (!discBtn) {
      discBtn = makeBtn('wallet-disc', 'Disconnect');
      discBtn.style.cssText = SUB;
      discBtn.onmouseenter = function () { discBtn.style.color = '#e0556a'; discBtn.style.borderColor = 'rgba(224,85,106,.5)'; };
      discBtn.onmouseleave = function () { discBtn.style.color = '#8d8a82'; discBtn.style.borderColor = 'rgba(255,255,255,.18)'; };
      host.appendChild(discBtn);
    }
    var switchBtn = document.querySelector('.wallet-switch');
    if (!switchBtn) {
      switchBtn = makeBtn('wallet-switch', 'Switch');
      switchBtn.title = 'Connect a different wallet account';
      switchBtn.style.cssText = SUB;
      switchBtn.onmouseenter = function () { switchBtn.style.color = '#E9B84A'; switchBtn.style.borderColor = 'rgba(233,184,74,.5)'; };
      switchBtn.onmouseleave = function () { switchBtn.style.color = '#8d8a82'; switchBtn.style.borderColor = 'rgba(255,255,255,.18)'; };
      host.appendChild(switchBtn);
    }

    var myBtn = document.querySelector('.mypage-entry');
    if (!myBtn) {
      myBtn = document.createElement('a');
      myBtn.className = 'mypage-entry'; myBtn.href = 'mypage-collection.html'; myBtn.textContent = 'My Page';
      myBtn.style.cssText = 'display:none;align-items:center;gap:8px;font-family:inherit;font-size:12px;'
        + 'letter-spacing:1px;color:#1c1500;background:linear-gradient(150deg,#f4d27a,#E9B84A 60%);'
        + 'border:none;border-radius:7px;padding:10px 16px;cursor:pointer;text-decoration:none;margin-left:8px;';
      host.appendChild(myBtn);
    }

    function renderConnected(addr) {
      wbtn.textContent = shortAddr(addr);
      wbtn.title = addr;
      wbtn.classList.add('connected');
      discBtn.style.display = 'inline-block';
      switchBtn.style.display = 'inline-block';
      myBtn.style.display = 'inline-flex';
      document.body.classList.add('wallet-connected');
    }
    function renderDisconnected() {
      wbtn.innerHTML = origHtml;
      wbtn.title = '';
      wbtn.classList.remove('connected');
      discBtn.style.display = 'none';
      switchBtn.style.display = 'none';
      myBtn.style.display = 'none';
      document.body.classList.remove('wallet-connected');
    }
    function renderBusy(label) {
      wbtn.textContent = label;
      wbtn.title = '';
    }

    /* ---- "check your wallet" hint -------------------------------------
       On mobile the wallet app takes over the screen. When the user comes
       back the page must not look idle, or they tap connect again and the
       second request cancels the first. */
    var hint = null;
    function showHint(text) {
      if (hint) { hint.firstChild.textContent = text; return; }
      hint = document.createElement('div');
      hint.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:24px;z-index:2200;'
        + 'max-width:340px;padding:13px 18px;border-radius:12px;background:rgba(17,17,20,.96);'
        + 'border:1px solid rgba(233,184,74,.35);color:#E9B84A;font-size:13px;line-height:1.5;text-align:center;'
        + 'box-shadow:0 10px 40px rgba(0,0,0,.6)';
      hint.appendChild(document.createTextNode(text));
      document.body.appendChild(hint);
    }
    function hideHint() { if (hint) { hint.remove(); hint = null; } }
    document.addEventListener('memons:signing', function () {
      showHint('Approve the signature request in your wallet app, then return here.');
    });
    document.addEventListener('memons:signed', hideHint);

    /* The session lapsed. Say so plainly and reassure the user that nothing
       was lost, otherwise an empty collection page reads as stolen cards. */
    document.addEventListener('memons:expired', function () {
      renderDisconnected();
      showHint('Session expired. Connect again to continue - your cards are safe.');
      setTimeout(hideHint, 7000);
    });

    /* ---- mobile wallet chooser ----------------------------------------
       Opening the site inside the wallet app's own browser injects
       window.ethereum and needs no relay, no WebSocket and no QR. That path is
       far more reliable on Android, where the WalletConnect relay connection
       often stalls before the modal can appear, so it is offered up front
       rather than only after a timeout. */
    function showWalletSheet(opts) {
      opts = opts || {};
      if (document.getElementById('mmSheet')) return;
      var full = targetUrl();

      var wrap = document.createElement('div');
      wrap.id = 'mmSheet';
      wrap.style.cssText = 'position:fixed;inset:0;z-index:2000;display:flex;align-items:flex-end;justify-content:center;background:rgba(0,0,0,.6)';

      var note = opts.note || 'Open this page in your wallet app to connect.';
      var wcRow = opts.showWalletConnect === false ? '' :
        '<button id="mmWc" style="width:100%;text-align:center;font-weight:700;font-size:13px;padding:14px;border-radius:12px;border:1px solid rgba(255,255,255,.14);background:transparent;color:#a99d85;cursor:pointer;margin-bottom:10px">Use WalletConnect instead</button>';

      wrap.innerHTML =
        '<div style="width:100%;max-width:460px;background:linear-gradient(180deg,#111114,#0a0a0c);border:1px solid rgba(233,184,74,.3);border-radius:20px 20px 0 0;padding:24px 20px 28px;box-shadow:0 -20px 60px rgba(0,0,0,.7)">' +
          '<div style="font-family:var(--font-head,inherit);font-weight:800;font-size:17px;letter-spacing:1px;color:#E9B84A;text-align:center">CONNECT WALLET</div>' +
          '<div style="color:#a99d85;font-size:13px;line-height:1.6;text-align:center;margin:10px 0 20px">' + note + '</div>' +
          '<a id="mmGo" href="' + metamaskLink() + '" style="display:block;text-align:center;text-decoration:none;font-weight:800;font-size:14px;padding:15px;border-radius:13px;background:linear-gradient(135deg,#f4d27a,#E9B84A 55%,#b8862e);color:#1c1500;margin-bottom:10px">Open in MetaMask</a>' +
          '<a id="twGo" href="' + trustLink() + '" style="display:block;text-align:center;text-decoration:none;font-weight:700;font-size:14px;padding:15px;border-radius:13px;border:1px solid rgba(233,184,74,.4);color:#E9B84A;margin-bottom:10px">Open in Trust Wallet</a>' +
          wcRow +
          '<button id="mmCopy" style="width:100%;text-align:center;font-weight:600;font-size:13px;padding:13px;border-radius:12px;border:1px solid rgba(255,255,255,.12);background:transparent;color:#8d8a82;cursor:pointer;margin-bottom:10px">Copy link</button>' +
          '<button id="mmClose" style="width:100%;text-align:center;font-size:13px;padding:11px;border:0;background:transparent;color:#6b6862;cursor:pointer">Cancel</button>' +
        '</div>';
      document.body.appendChild(wrap);

      function close() { wrap.remove(); }
      wrap.addEventListener('click', function (e) { if (e.target === wrap) close(); });
      wrap.querySelector('#mmClose').onclick = close;

      var wc = wrap.querySelector('#mmWc');
      if (wc) wc.onclick = function () { close(); connectViaWalletConnect(); };

      wrap.querySelector('#mmCopy').onclick = function () {
        var btn = this;
        try {
          navigator.clipboard.writeText(full);
          btn.textContent = 'Link copied';
          setTimeout(function () { btn.textContent = 'Copy link'; }, 1600);
        } catch (err) { btn.textContent = full; }
      };
    }

    function activeProvider() {
      return (window.MEMONS_ETH && window.MEMONS_ETH()) || window.ethereum || null;
    }

    /* Runs the WalletConnect handshake and then signs in. Split out so the
       chooser can call it directly. */
    async function connectViaWalletConnect() {
      if (busy) return;
      busy = true;
      renderBusy('Connecting\u2026');
      try {
        if (!activeProvider()) {
          if (!window.MEMONS_WC) throw new Error('WC_LOAD_FAILED');
          // Hard ceiling on the handshake. The relay connection can stall
          // before the modal ever appears, which looks like a frozen button.
          markPending();
          await Promise.race([
            window.MEMONS_WC.connect(),
            new Promise(function (_, rj) {
              setTimeout(function () { rj(new Error('WC_TIMEOUT')); }, 15000);
            })
          ]);
        }
        if (window.MEMONS.bindWalletEvents) window.MEMONS.bindWalletEvents();
        var addr = await window.MEMONS.connect();
        renderConnected(addr);
        document.dispatchEvent(new CustomEvent('memons:connected', { detail: { address: addr } }));
      } catch (e) {
        var msg = (e && e.message) || '';
        if (msg === 'WC_LOAD_FAILED' || msg === 'WC_TIMEOUT') {
          if (isMobileDevice()) {
            showWalletSheet({
              showWalletConnect: false,
              note: 'WalletConnect could not be reached. Open this page in your wallet app instead.'
            });
          } else {
            alert('Could not reach the WalletConnect service. Check your network and try again.');
          }
        } else if (!(e && e.code === 4001) && msg) {
          alert(msg);
        }
      } finally {
        busy = false;
        clearPending();
        hideHint();
        if (!(window.MEMONS && window.MEMONS.connected)) renderDisconnected();
      }
    }

    async function doConnect() {
      if (busy) return;
      if (!window.MEMONS) { alert('Wallet client not loaded'); return; }

      // Wallet browsers inject late. Deciding before detection finishes made
      // the site offer to open the very wallet app it was already running in.
      if (window.MEMONS_WC && window.MEMONS_WC.detect && !activeProvider()) {
        renderBusy('Connecting\u2026');
        try { await window.MEMONS_WC.detect(); } catch (e) {}
      }

      // A wallet is already injected (extension, or the wallet app's own
      // browser). Nothing to choose.
      if (activeProvider()) {
        busy = true;
        renderBusy('Connecting\u2026');
        try {
          if (window.MEMONS.bindWalletEvents) window.MEMONS.bindWalletEvents();
          var addr = await window.MEMONS.connect();
          renderConnected(addr);
          document.dispatchEvent(new CustomEvent('memons:connected', { detail: { address: addr } }));
        } catch (e) {
          if (!(e && e.code === 4001)) alert((e && e.message) || 'Wallet connection failed');
        } finally {
          busy = false;
          hideHint();
          if (!(window.MEMONS && window.MEMONS.connected)) renderDisconnected();
        }
        return;
      }

      // No injected wallet. WalletConnect handles both cases: a QR on desktop,
      // and its own wallet list with per-wallet deep links on mobile. It keeps
      // those link formats up to date across hundreds of wallets, which is far
      // more reliable than the hand-written links in the sheet below.
      //
      // The sheet is kept only as a fallback, and connectViaWalletConnect falls
      // back to it when the library or the relay cannot be reached. Sending
      // people to a wallet's in-app browser first turned out to be a dead end:
      // the measured behaviour is that it no longer injects a provider.
      if (window.MEMONS_WC) { connectViaWalletConnect(); return; }
      if (isMobileDevice()) { showWalletSheet(); return; }
      alert('No wallet detected. Please install MetaMask and reload this page.');
    }

    async function doDisconnect(reload) {
      try {
        if (window.MEMONS && window.MEMONS.disconnect) await window.MEMONS.disconnect();
        else if (window.MEMONS && window.MEMONS.resetSession) window.MEMONS.resetSession();
      } catch (e) {}
      try { if (window.MEMONS_WC) await window.MEMONS_WC.disconnect(); } catch (e) {}
      try { if (window.MEMONS_REWARDS && window.MEMONS_REWARDS.clearServerOwned) window.MEMONS_REWARDS.clearServerOwned(); } catch (e) {}
      renderDisconnected();
      document.dispatchEvent(new CustomEvent('memons:disconnected'));
      if (reload) location.reload();
    }

    wbtn.addEventListener('click', function (ev) {
      ev.preventDefault();
      if (window.MEMONS && window.MEMONS.connected) return;
      doConnect();
    });
    discBtn.addEventListener('click', function (ev) { ev.preventDefault(); doDisconnect(true); });
    switchBtn.addEventListener('click', async function (ev) {
      ev.preventDefault();
      if (!window.MEMONS || !window.MEMONS.switchAccount) return;
      switchBtn.disabled = true; switchBtn.textContent = '\u2026';
      try {
        await window.MEMONS.switchAccount();
        location.reload();
      } catch (e) {
        alert((e && e.message) || 'Could not switch account');
        switchBtn.disabled = false; switchBtn.textContent = 'Switch';
      }
    });

    /* ---- reflect the real state on load ------------------------------- */
    (async function init() {
      renderDisconnected();
      try {
        // Rebuild the WalletConnect provider before anything reads it.
        // Every navigation on this site is a full reload, so without this the
        // session exists on the relay but the page cannot use it.
        if (window.MEMONS_WC) {
          if (window.MEMONS_WC.detect) { try { await window.MEMONS_WC.detect(); } catch (e) {} }
          if (window.MEMONS_WC.ready)  { try { await window.MEMONS_WC.ready;  } catch (e) {} }
        }
        if (window.MEMONS && window.MEMONS.bindWalletEvents) window.MEMONS.bindWalletEvents();

        if (window.MEMONS && window.MEMONS.connected && window.MEMONS.address) {
          var p = activeProvider();
          if (p) {
            var accs = await p.request({ method: 'eth_accounts' });
            var cur = (accs && accs[0] ? accs[0] : '').toLowerCase();
            // Only a genuinely different account invalidates the session.
            // An empty list means the provider is still waking up.
            if (cur && cur !== String(window.MEMONS.address).toLowerCase()) { doDisconnect(false); return; }
          }
          renderConnected(window.MEMONS.address);
          document.dispatchEvent(new CustomEvent('memons:connected', { detail: { address: window.MEMONS.address } }));
          return;
        }

        /* Came back from the wallet mid-login: the session is live but the
           signature step never ran. Finish it rather than making the user
           work out that they have to tap connect a second time. */
        var wc = window.MEMONS_WC;
        var live = wc && wc.provider && wc.provider.accounts && wc.provider.accounts.length;
        if (isPending() && live && !(window.MEMONS && window.MEMONS.connected)) {
          clearPending();          // one attempt only, never a loop
          showHint('Finishing sign-in - approve the signature in your wallet.');
          connectViaWalletConnect();
          return;
        }
        clearPending();
      } catch (e) { renderDisconnected(); }
    })();
  }

  if (document.readyState !== 'loading') ready();
  else document.addEventListener('DOMContentLoaded', ready);
})();
