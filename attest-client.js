// =====================================================================
//  MEMONS — attest-client.js
//
//  Queues each opened card for on-chain anchoring. That is all it does.
//
//  An earlier version also asked the player to sign a delegation the
//  first time they connected. The signature proved the player had agreed,
//  which mattered while the aim was to be counted as a distinct wallet by
//  external indexers. That aim was dropped, so the prompt went with it --
//  opening a capsule now asks the player for nothing at all.
//
//  Cards are not written to the chain one by one. The server collects
//  them, presses a batch into a single value and anchors that, which is
//  what keeps the cost off the card count. Which cards are in which batch
//  is held in our database; publishing that list lets anyone rebuild the
//  value and compare it against the chain.
//
//  Loaded automatically by gacha-client.js.
// =====================================================================

(function () {
  "use strict";

  var SB_URL  = "https://neixdrtamznrooougcda.supabase.co";
  var SB_ANON = "sb_publishable_xXzlHTJ4cX8kJoEGXw_csw_q5qFK1nO";

  function lower(a) { return String(a || "").toLowerCase(); }

  /* One call to one queueing function.

     Two of them run side by side. attest_enqueue feeds the batch path,
     where the server presses many cards into a single value and anchors
     that from the company wallet -- cheap, but the chain shows one sender
     behind every card. aa_enqueue feeds the per-player path, where the
     card goes up under an account of the player's own, which is what an
     indexer counts as a distinct user.

     They do not know about each other. A card sits in both queues and is
     written twice, in two different places, and either one can be turned
     off without disturbing the other. */
  function call(fn, cardId) {
    return fetch(SB_URL + "/rest/v1/rpc/" + fn, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: SB_ANON,
        /* The anon key, not the MEMONS session token. The session token is
           ours, not Supabase's, and PostgREST cannot decode it -- passing
           it back gives "None of the keys was able to decode the JWT" and
           the card is never queued.

           Safe to send unauthenticated: attest_enqueue takes an address
           and a card id and refuses any pair the owned table does not
           already show, so nothing can be recorded that did not happen. */
        Authorization: "Bearer " + SB_ANON,
      },
      body: JSON.stringify({
        p_address: lower(MEMONS.address),
        p_card_id: cardId,
      }),
    }).then(function (r) { return r.ok; })
      .catch(function () { return false; });
  }

  /* One card into both queues.

     Failures pass in silence: the reveal screen has no reason to report a
     queueing problem, and there is nothing the player could do about it
     if it did. The card is already theirs either way.

     Both are fired; neither is waited on by the other. If the per-player
     queue is switched off, aa_enqueue returns false and nothing happens
     -- the batch path carries on as though this were never added. */
  function enqueue(cardId) {
    if (!window.MEMONS || !MEMONS.connected || !cardId) {
      return Promise.resolve(false);
    }
    var batch = call("attest_enqueue", cardId);
    call("aa_enqueue", cardId).catch(function () {});
    return batch;
  }

  /* Several at once, as a ten-pull arrives. One failure does not stop the
     rest. */
  function enqueueMany(cardIds) {
    var list = (cardIds || []).filter(Boolean);
    if (!list.length) return Promise.resolve(0);
    return Promise.all(list.map(enqueue)).then(function (rs) {
      return rs.filter(Boolean).length;
    });
  }

  /* Kept on the window under the same name the reveal screen already
     calls. Only the two queue functions remain; authorize and
     isAuthorized went with the signature. */
  window.MEMONS_ATTEST = {
    enqueue: enqueue,
    enqueueMany: enqueueMany,
  };
})();
