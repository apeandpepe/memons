// =====================================================================
//  MEMONS pull client (frontend)
//  connect wallet -> sign-in -> pull / query state. All results are decided server-side.
//  Usage: include <script src="gacha-client.js"></script>, then use window.MEMONS.
// =====================================================================
(function () {
  // API base (Supabase Edge Functions)
  const API = "https://neixdrtamznrooougcda.supabase.co/functions/v1";

  const SS_TOKEN = "memons_jwt_v1", SS_ADDR = "memons_addr_v1";
  let token = null;
  let address = null;
  // restore an existing session (survives page navigation within the tab)
  try {
    token = sessionStorage.getItem(SS_TOKEN) || null;
    address = sessionStorage.getItem(SS_ADDR) || null;
  } catch (e) {}
  function persist() {
    try {
      if (token) { sessionStorage.setItem(SS_TOKEN, token); sessionStorage.setItem(SS_ADDR, address || ""); }
      else { sessionStorage.removeItem(SS_TOKEN); sessionStorage.removeItem(SS_ADDR); }
    } catch (e) {}
  }

  async function post(path, body, auth) {
    const headers = { "content-type": "application/json" };
    if (auth && token) headers["Authorization"] = "Bearer " + token;
    const r = await fetch(API + path, { method: "POST", headers, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || ("HTTP " + r.status));
    return j;
  }
  async function get(path, auth) {
    const headers = {};
    if (auth && token) headers["Authorization"] = "Bearer " + token;
    const r = await fetch(API + path, { headers });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || ("HTTP " + r.status));
    return j;
  }

  // 1) connect wallet + sign-in -> obtain session token
  // Ask the wallet to show its account picker, so the user can pick/switch the
  // account they actually want. eth_requestAccounts alone silently reuses the
  // previously approved account and never shows a chooser.
  async function connect() {
    if (!window.ethereum) throw new Error("A wallet (e.g. MetaMask) is required.");
    const accs = await window.ethereum.request({ method: "eth_requestAccounts" });
    address = (accs[0] || "").toLowerCase();

    const { message } = await get("/auth/nonce?address=" + address);        // message to sign
    const signature = await window.ethereum.request({                        // sign (no gas)
      method: "personal_sign", params: [message, address],
    });
    const res = await post("/auth/verify", { address, signature }, false);   // verify -> JWT
    token = res.token;
    persist();
    return address;
  }

  // 2) current state: remaining pulls + owned cards
  async function state() {
    await ensureSameAccount();
    return await get("/game", true); // { pulls_remaining, owned:[...] }
  }

  // 3) single pull. throws on failure (e.g. 'NO_PULLS_LEFT')
  async function pull() {
    await ensureSameAccount();
    return await post("/game", null, true); // { card:{card_id,name,rarity,category,image_url,pulls_left}, pulls_remaining }
  }

  // --- added for My Page: authenticated call reusing the session token ---
  async function authFetch(path, body) {
    const headers = { "content-type": "application/json" };
    if (token) headers["Authorization"] = "Bearer " + token;
    const r = await fetch(API + path, { method: body === undefined ? "GET" : "POST", headers, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || ("HTTP " + r.status));
    return j;
  }

  // --- guard: if MetaMask's current account differs from our session, drop it ---
  async function ensureSameAccount(){
    try{
      if(!window.ethereum || !address) return;
      const accs = await window.ethereum.request({ method: "eth_accounts" });
      const cur = (accs && accs[0] ? accs[0] : "").toLowerCase();
      if (cur && cur !== address) { token = null; address = null; persist(); }
    }catch(e){}
  }

  // --- wallet account/chain changes: drop the stale session so the app re-auths ---
  function resetSession(){ token = null; address = null; persist(); }

  // Clear our session. (We don't call wallet_revokePermissions: some wallets
  // error on it. To use a different account, switch it in the wallet itself.)
  async function disconnect(){ resetSession(); }
  if (window.ethereum && window.ethereum.on) {
    window.ethereum.on("accountsChanged", (accs) => {
      const next = (accs && accs[0] ? accs[0] : "").toLowerCase();
      if (!next) { resetSession(); location.reload(); return; }   // disconnected
      if (address && next !== address) {                          // switched account
        resetSession();
        location.reload();                                        // reconnect as the new wallet
      }
    });
    window.ethereum.on("chainChanged", () => { resetSession(); location.reload(); });
  }

  // merge into any existing MEMONS (e.g. memons-pay.js may have loaded first)
  const M = (window.MEMONS = window.MEMONS || {});
  M.connect = connect;
  M.state = state;
  M.pull = pull;
  M.authFetch = authFetch;
  M.resetSession = resetSession;
  M.disconnect = disconnect;
  Object.defineProperty(M, "token",     { get(){ return token; },    configurable: true });
  Object.defineProperty(M, "address",   { get(){ return address; },  configurable: true });
  Object.defineProperty(M, "connected", { get(){ return !!token; },  configurable: true });
})();
