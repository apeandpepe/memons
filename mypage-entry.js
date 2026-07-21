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

  /* A timeout that only counts while the page is on screen.
     Connecting means leaving for the wallet app, approving, and coming back,
     which is easily more than a plain 15 seconds. A wall-clock timer gave up
     mid-approval and greeted the returning user with a failure sheet for a
     connection the wallet had in fact accepted. Time spent in the wallet is
     not the site hanging, so it is not counted. */
  function activeTimeout(ms, label) {
    return new Promise(function (_, reject) {
      var left = ms, timer = null, mark = Date.now();

      function stop() {
        if (timer) { clearTimeout(timer); timer = null; }
        document.removeEventListener('visibilitychange', onVis);
      }
      function tick() {
        left -= (Date.now() - mark);
        mark = Date.now();
        if (left <= 0) { stop(); reject(new Error(label)); return; }
        timer = setTimeout(tick, Math.min(left, 1000));
      }
      function onVis() {
        if (document.hidden) {
          if (timer) { left -= (Date.now() - mark); clearTimeout(timer); timer = null; }
        } else if (!timer) {
          mark = Date.now();
          timer = setTimeout(tick, Math.min(left, 1000));
        }
      }
      document.addEventListener('visibilitychange', onVis);
      timer = setTimeout(tick, Math.min(left, 1000));
    });
  }

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
    /* Returning to the tab without a reload does not re-run init, so the
       resume check has to hang off visibility as well. */
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) resumeIfPending();
    });

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

    /* ---- wallet picker -------------------------------------------------
       With more than one extension installed there is no way to tell which
       one the user means: they all compete for window.ethereum and some
       report isMetaMask even when they are not. Ask instead of guessing. */
    function showWalletPicker(list) {
      if (document.getElementById('wPick')) return;

      var wrap = document.createElement('div');
      wrap.id = 'wPick';
      wrap.style.cssText = 'position:fixed;inset:0;z-index:2100;display:flex;align-items:center;'
        + 'justify-content:center;background:rgba(0,0,0,.66);padding:20px';

      var rows = list.map(function (w, i) {
        var name = (w.info && w.info.name) || 'Wallet ' + (i + 1);
        var icon = (w.info && w.info.icon) || '';
        return '<button class="wp-row" data-i="' + i + '" style="display:flex;align-items:center;gap:12px;'
          + 'width:100%;text-align:left;font-family:inherit;font-size:14px;font-weight:600;color:#e8e6e0;'
          + 'background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.12);border-radius:12px;'
          + 'padding:13px 14px;margin-bottom:9px;cursor:pointer">'
          + (icon ? '<img src="' + icon + '" alt="" style="width:26px;height:26px;border-radius:7px;flex:0 0 26px">'
                  : '<span style="width:26px;height:26px;border-radius:7px;background:rgba(233,184,74,.18);flex:0 0 26px"></span>')
          + '<span>' + name + '</span></button>';
      }).join('');

      wrap.innerHTML =
        '<div style="width:100%;max-width:360px;background:linear-gradient(180deg,#131317,#0a0a0c);'
        + 'border:1px solid rgba(233,184,74,.28);border-radius:18px;padding:22px 20px 18px;'
        + 'box-shadow:0 24px 70px rgba(0,0,0,.7)">'
        + '<div style="font-family:var(--font-head,inherit);font-weight:800;font-size:15px;letter-spacing:1px;'
        + 'color:#E9B84A;text-align:center;margin-bottom:4px">SELECT WALLET</div>'
        + '<div style="color:#8d8a82;font-size:12px;text-align:center;margin-bottom:16px">'
        + list.length + ' wallets found in this browser</div>'
        + rows
        + '<button id="wpWc" style="width:100%;font-family:inherit;font-size:12.5px;font-weight:600;color:#a99d85;'
        + 'background:transparent;border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:12px;'
        + 'margin-top:4px;cursor:pointer">Use WalletConnect</button>'
        + '<button id="wpX" style="width:100%;font-size:12.5px;color:#6b6862;background:transparent;border:0;'
        + 'padding:11px;margin-top:2px;cursor:pointer">Cancel</button>'
        + '</div>';

      document.body.appendChild(wrap);
      function close() { wrap.remove(); }
      wrap.addEventListener('click', function (e) { if (e.target === wrap) close(); });
      wrap.querySelector('#wpX').onclick = close;
      wrap.querySelector('#wpWc').onclick = function () { close(); connectViaWalletConnect(); };

      Array.prototype.forEach.call(wrap.querySelectorAll('.wp-row'), function (b) {
        b.onclick = function () {
          var picked = list[parseInt(b.getAttribute('data-i'), 10)];
          close();
          if (!picked) return;
          window.MEMONS_WC.choose(picked.provider);
          connectInjected();
        };
      });
    }

    async function connectInjected() {
      if (busy) return;
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
    }

    /* Only fall back to window.ethereum when the accessor is missing entirely.
       Reading it as an "or else" defeats the picker: with several extensions
       installed window.ethereum is whichever loaded first, so a null answer
       from MEMONS_ETH (meaning "the user has not chosen yet") was being
       overruled by an arbitrary wallet. */
    function activeProvider() {
      if (window.MEMONS_ETH) return window.MEMONS_ETH();
      return window.ethereum || null;
    }

    /* Came back from the wallet with the approval done but this page having
       already given up, or simply mid-login. The session is live on the relay
       either way, so pick the sign-in back up instead of leaving the user
       staring at a failure for something their wallet accepted. */
    async function resumeIfPending() {
      if (busy) return false;
      if (!isPending()) return false;
      if (window.MEMONS && window.MEMONS.connected) { clearPending(); return false; }
      if (!window.MEMONS_WC) return false;

      var wc = window.MEMONS_WC;
      var live = wc.provider && wc.provider.accounts && wc.provider.accounts.length;
      if (!live) {
        // The provider object is gone but the session may still be on the
        // relay, which is exactly the case after this page gave up early.
        try { await wc.restore(); } catch (e) {}
        live = wc.provider && wc.provider.accounts && wc.provider.accounts.length;
      }
      if (!live) return false;

      clearPending();               // one attempt only, never a loop
      hideSheet();
      showHint('Finishing sign-in - approve the signature in your wallet.');
      connectViaWalletConnect();
      return true;
    }

    function hideSheet() {
      var s1 = document.getElementById('mmSheet'); if (s1) s1.remove();
      var s2 = document.getElementById('wPick');   if (s2) s2.remove();
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
          // The wallet app takes over the screen from here. Say so, or the
          // page looks frozen behind whatever the wallet is showing.
          if (isMobileDevice()) {
            showHint('Approve the connection in your wallet app, then return here.');
          }
          // 45s of the user actually looking at this page. The wallet modal
          // and the trip to the wallet app do not eat into it.
          await Promise.race([
            window.MEMONS_WC.connect(),
            activeTimeout(45000, 'WC_TIMEOUT')
          ]);
          hideHint();
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

      // Extensions announce a frame or two after load, so wait before deciding.
      if (window.MEMONS_WC && window.MEMONS_WC.detect && !activeProvider()) {
        renderBusy('Connecting\u2026');
        try { await window.MEMONS_WC.detect(); } catch (e) {}
        renderDisconnected();
      }

      // Already settled on a wallet, or connected through one.
      if (activeProvider()) { connectInjected(); return; }

      var found = (window.MEMONS_WC && window.MEMONS_WC.list) ? window.MEMONS_WC.list() : [];

      // More than one extension: the user has to say which. Picking for them
      // is a coin toss, since window.ethereum goes to whichever loaded first.
      if (found.length > 1) { showWalletPicker(found); return; }

      if (found.length === 1) {
        window.MEMONS_WC.choose(found[0].provider);
        connectInjected();
        return;
      }

      // Nothing installed. WalletConnect covers desktop QR and mobile wallets,
      // and keeps per-wallet deep links current across hundreds of wallets.
      // The sheet below stays only as a fallback when it cannot be reached.
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
        //
        // ready comes first on purpose. Waiting on detect first cost 2.5s on a
        // phone, where there is no extension to find and the poll runs to its
        // timeout, and the header sat showing "not connected" for all of it.
        if (window.MEMONS_WC) {
          if (window.MEMONS_WC.ready) { try { await window.MEMONS_WC.ready; } catch (e) {} }
          // Only worth waiting for detection when no session was restored,
          // since that is the only case where an extension still matters here.
          if (!activeProvider() && window.MEMONS_WC.detect) {
            try { await window.MEMONS_WC.detect(); } catch (e) {}
          }
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

        if (await resumeIfPending()) return;
        clearPending();
      } catch (e) { renderDisconnected(); }
    })();
  }

  if (document.readyState !== 'loading') ready();
  else document.addEventListener('DOMContentLoaded', ready);
})();
