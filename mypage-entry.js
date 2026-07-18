/* ============================================================
   MEMONS — wallet header (drop-in, ALL pages)
   Include on every page that has the site header:
     <script src="gacha-client.js"></script>
     <script src="mypage-entry.js"></script>

   What it does
   - Wires the header wallet button (.wbtn / #headWallet) to connect.
   - When connected: shows the short address + a "Disconnect" button,
     and a gold "My Page" link.
   - Reads the LIVE wallet state (never a stale cache), and reacts to
     MetaMask account/network changes.
   ============================================================ */
(function(){
  function shortAddr(a){ return a ? (a.slice(0,6)+'…'+a.slice(-4)) : ''; }

  function ready(){
    var hr = document.querySelector('header .hr') || document.querySelector('.hr')
           || document.querySelector('header') || document.body;
    var wbtn = document.querySelector('.wbtn') || document.getElementById('headWallet');
    if(!wbtn) return;                       // page has no wallet button
    var origHtml = wbtn.innerHTML;
    var host = wbtn.parentElement || hr;

    /* --- injected controls --- */
    function makeBtn(cls, text){
      var b=document.createElement('button');
      b.className=cls; b.type='button'; b.textContent=text;
      return b;
    }
    var discBtn = document.querySelector('.wallet-disc');
    if(!discBtn){
      discBtn = makeBtn('wallet-disc','Disconnect');
      discBtn.style.cssText='display:none;margin-left:8px;font-family:inherit;font-size:11px;letter-spacing:.6px;'
        +'color:#8d8a82;background:transparent;border:1px solid rgba(255,255,255,.18);border-radius:7px;'
        +'padding:9px 12px;cursor:pointer;transition:.15s;';
      discBtn.onmouseenter=function(){ discBtn.style.color='#e0556a'; discBtn.style.borderColor='rgba(224,85,106,.5)'; };
      discBtn.onmouseleave=function(){ discBtn.style.color='#8d8a82'; discBtn.style.borderColor='rgba(255,255,255,.18)'; };
      host.appendChild(discBtn);
    }
    var switchBtn = document.querySelector('.wallet-switch');
    if(!switchBtn){
      switchBtn = makeBtn('wallet-switch','Switch');
      switchBtn.title = 'Connect a different wallet account';
      switchBtn.style.cssText='display:none;margin-left:8px;font-family:inherit;font-size:11px;letter-spacing:.6px;'
        +'color:#8d8a82;background:transparent;border:1px solid rgba(255,255,255,.18);border-radius:7px;'
        +'padding:9px 12px;cursor:pointer;transition:.15s;';
      switchBtn.onmouseenter=function(){ switchBtn.style.color='#E9B84A'; switchBtn.style.borderColor='rgba(233,184,74,.5)'; };
      switchBtn.onmouseleave=function(){ switchBtn.style.color='#8d8a82'; switchBtn.style.borderColor='rgba(255,255,255,.18)'; };
      host.appendChild(switchBtn);
    }

    var myBtn = document.querySelector('.mypage-entry');
    if(!myBtn){
      myBtn=document.createElement('a');
      myBtn.className='mypage-entry'; myBtn.href='mypage-collection.html'; myBtn.textContent='My Page';
      myBtn.style.cssText='display:none;align-items:center;gap:8px;font-family:inherit;font-size:12px;'
        +'letter-spacing:1px;color:#1c1500;background:linear-gradient(150deg,#f4d27a,#E9B84A 60%);'
        +'border:none;border-radius:7px;padding:10px 16px;cursor:pointer;text-decoration:none;margin-left:8px;';
      host.appendChild(myBtn);
    }

    function renderConnected(addr){
      wbtn.textContent = shortAddr(addr);
      wbtn.title = addr;
      wbtn.classList.add('connected');
      discBtn.style.display = 'inline-block';
      switchBtn.style.display = 'inline-block';
      myBtn.style.display = 'inline-flex';
      document.body.classList.add('wallet-connected');
    }
    function renderDisconnected(){
      wbtn.innerHTML = origHtml;
      wbtn.title = '';
      wbtn.classList.remove('connected');
      discBtn.style.display = 'none';
      switchBtn.style.display = 'none';
      myBtn.style.display = 'none';
      document.body.classList.remove('wallet-connected');
    }

    function isMobileDevice(){
      return /Android|iPhone|iPad|iPod|Opera Mini|IEMobile|Mobile/i.test(navigator.userAgent||'');
    }

    /* Mobile browsers have no wallet extension, so window.ethereum is missing.
       Offer to reopen this page inside a wallet app's built-in browser. */
    function showWalletSheet(){
      if(document.getElementById('mmSheet')) return;
      var here = location.host + location.pathname + location.search;
      var full = location.href;
      var wrap = document.createElement('div');
      wrap.id = 'mmSheet';
      wrap.style.cssText='position:fixed;inset:0;z-index:2000;display:flex;align-items:flex-end;justify-content:center;background:rgba(0,0,0,.6)';
      wrap.innerHTML =
        '<div style="width:100%;max-width:460px;background:linear-gradient(180deg,#111114,#0a0a0c);border:1px solid rgba(233,184,74,.3);border-radius:20px 20px 0 0;padding:24px 20px 28px;box-shadow:0 -20px 60px rgba(0,0,0,.7)">'+
          '<div style="font-family:var(--font-head,inherit);font-weight:800;font-size:17px;letter-spacing:1px;color:#E9B84A;text-align:center">CONNECT WALLET</div>'+
          '<div style="color:#a99d85;font-size:13px;line-height:1.6;text-align:center;margin:10px 0 20px">Mobile browsers cannot reach your wallet directly.<br>Open this page inside your wallet app.</div>'+
          '<a id="mmGo" href="https://metamask.app.link/dapp/'+here+'" style="display:block;text-align:center;text-decoration:none;font-weight:800;font-size:14px;padding:15px;border-radius:13px;background:linear-gradient(135deg,#f4d27a,#E9B84A 55%,#b8862e);color:#1c1500;margin-bottom:10px">Open in MetaMask</a>'+
          '<a id="twGo" href="https://link.trustwallet.com/open_url?coin_id=60&url='+encodeURIComponent(full)+'" style="display:block;text-align:center;text-decoration:none;font-weight:700;font-size:14px;padding:15px;border-radius:13px;border:1px solid rgba(233,184,74,.4);color:#E9B84A;margin-bottom:10px">Open in Trust Wallet</a>'+
          '<button id="mmCopy" style="width:100%;text-align:center;font-weight:600;font-size:13px;padding:13px;border-radius:12px;border:1px solid rgba(255,255,255,.12);background:transparent;color:#8d8a82;cursor:pointer;margin-bottom:10px">Copy link</button>'+
          '<button id="mmClose" style="width:100%;text-align:center;font-size:13px;padding:11px;border:0;background:transparent;color:#6b6862;cursor:pointer">Cancel</button>'+
        '</div>';
      document.body.appendChild(wrap);
      function close(){ wrap.remove(); }
      wrap.addEventListener('click', function(e){ if(e.target===wrap) close(); });
      wrap.querySelector('#mmClose').onclick = close;
      wrap.querySelector('#mmCopy').onclick = function(){
        var btn = this;
        try{
          navigator.clipboard.writeText(full);
          btn.textContent = 'Link copied';
          setTimeout(function(){ btn.textContent = 'Copy link'; }, 1600);
        }catch(err){ btn.textContent = full; }
      };
    }

    async function doConnect(){
      if(!window.MEMONS){ alert('Wallet client not loaded'); return; }
      if(!window.ethereum){
        if(isMobileDevice()){ showWalletSheet(); return; }
        alert('No wallet detected. Please install MetaMask and reload this page.');
        return;
      }
      try{
        var addr = await MEMONS.connect();
        renderConnected(addr);
        document.dispatchEvent(new CustomEvent('memons:connected',{detail:{address:addr}}));
      }catch(e){ alert((e && e.message) || 'Wallet connection failed'); }
    }
    async function doDisconnect(reload){
      try{
        if(window.MEMONS && MEMONS.disconnect) await MEMONS.disconnect();
        else if(window.MEMONS && MEMONS.resetSession) MEMONS.resetSession();
      }catch(e){}
      try{ if(window.MEMONS_REWARDS && MEMONS_REWARDS.clearServerOwned) MEMONS_REWARDS.clearServerOwned(); }catch(e){}
      renderDisconnected();
      document.dispatchEvent(new CustomEvent('memons:disconnected'));
      if(reload) location.reload();   // only on user-initiated disconnect; auto paths must NOT reload (loop)
    }

    wbtn.addEventListener('click', function(ev){
      ev.preventDefault();
      if(window.MEMONS && MEMONS.connected) return;    // already connected: use Disconnect
      doConnect();
    });
    discBtn.addEventListener('click', function(ev){ ev.preventDefault(); doDisconnect(true); });
    switchBtn.addEventListener('click', async function(ev){
      ev.preventDefault();
      if(!window.MEMONS || !MEMONS.switchAccount) return;
      switchBtn.disabled = true; switchBtn.textContent = '…';
      try{
        var addr = await MEMONS.switchAccount();
        renderConnected(addr);
        location.reload();                       // reload so all data reflects the new wallet
      }catch(e){
        alert((e && e.message) || 'Could not switch account');
        switchBtn.disabled = false; switchBtn.textContent = 'Switch';
      }
    });

    /* --- reflect the real state on load --- */
    (async function init(){
      try{
        if(window.MEMONS && MEMONS.connected && MEMONS.address){
          // make sure the wallet still has that account selected
          if(window.ethereum){
            var accs = await window.ethereum.request({ method:'eth_accounts' });
            var cur = (accs && accs[0] ? accs[0] : '').toLowerCase();
            if(cur && cur !== String(MEMONS.address).toLowerCase()){ doDisconnect(false); return; }
          }
          renderConnected(MEMONS.address);
        }else{
          renderDisconnected();
        }
      }catch(e){ renderDisconnected(); }
    })();

    /* --- wallet changes --- */
    if(window.ethereum && window.ethereum.on){
      window.ethereum.on('accountsChanged', function(){ doDisconnect(false); });
      window.ethereum.on('chainChanged', function(){ doDisconnect(false); });
    }
  }

  if(document.readyState!=='loading') ready();
  else document.addEventListener('DOMContentLoaded', ready);
})();
