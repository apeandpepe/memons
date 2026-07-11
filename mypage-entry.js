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
      myBtn.style.display = 'inline-flex';
      document.body.classList.add('wallet-connected');
    }
    function renderDisconnected(){
      wbtn.innerHTML = origHtml;
      wbtn.title = '';
      wbtn.classList.remove('connected');
      discBtn.style.display = 'none';
      myBtn.style.display = 'none';
      document.body.classList.remove('wallet-connected');
    }

    async function doConnect(){
      if(!window.MEMONS){ alert('Wallet client not loaded'); return; }
      try{
        var addr = await MEMONS.connect();
        renderConnected(addr);
        document.dispatchEvent(new CustomEvent('memons:connected',{detail:{address:addr}}));
      }catch(e){ alert((e && e.message) || 'Wallet connection failed'); }
    }
    async function doDisconnect(){
      try{
        if(window.MEMONS && MEMONS.disconnect) await MEMONS.disconnect();
        else if(window.MEMONS && MEMONS.resetSession) MEMONS.resetSession();
      }catch(e){}
      try{ if(window.MEMONS_REWARDS && MEMONS_REWARDS.clearServerOwned) MEMONS_REWARDS.clearServerOwned(); }catch(e){}
      renderDisconnected();
      document.dispatchEvent(new CustomEvent('memons:disconnected'));
      location.reload();
    }

    wbtn.addEventListener('click', function(ev){
      ev.preventDefault();
      if(window.MEMONS && MEMONS.connected) return;    // already connected: use Disconnect
      doConnect();
    });
    discBtn.addEventListener('click', function(ev){ ev.preventDefault(); doDisconnect(); });

    /* --- reflect the real state on load --- */
    (async function init(){
      try{
        if(window.MEMONS && MEMONS.connected && MEMONS.address){
          // make sure the wallet still has that account selected
          if(window.ethereum){
            var accs = await window.ethereum.request({ method:'eth_accounts' });
            var cur = (accs && accs[0] ? accs[0] : '').toLowerCase();
            if(cur && cur !== String(MEMONS.address).toLowerCase()){ doDisconnect(); return; }
          }
          renderConnected(MEMONS.address);
        }else{
          renderDisconnected();
        }
      }catch(e){ renderDisconnected(); }
    })();

    /* --- wallet changes --- */
    if(window.ethereum && window.ethereum.on){
      window.ethereum.on('accountsChanged', function(){ doDisconnect(); });
      window.ethereum.on('chainChanged', function(){ doDisconnect(); });
    }
  }

  if(document.readyState!=='loading') ready();
  else document.addEventListener('DOMContentLoaded', ready);
})();
