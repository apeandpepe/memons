// =====================================================================
//  MEMONS pull client (frontend)
//  connect wallet -> sign-in -> pull / query state. All results are decided server-side.
//  Usage: include <script src="gacha-client.js"></script>, then use window.MEMONS.
// =====================================================================
(function () {
  // API base (Supabase Edge Functions)
  const API = "https://neixdrtamznrooougcda.supabase.co/functions/v1";

  let token = null;
  let address = null;

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
    return address;
  }

  // 2) current state: remaining pulls + owned cards
  async function state() {
    return await get("/game", true); // { pulls_remaining, owned:[...] }
  }

  // 3) single pull. throws on failure (e.g. 'NO_PULLS_LEFT')
  async function pull() {
    return await post("/game", null, true); // { card:{card_id,name,rarity,category,image_url,pulls_left}, pulls_remaining }
  }

  window.MEMONS = {
    connect, state, pull,
    get address() { return address; },
    get connected() { return !!token; },
  };
})();
