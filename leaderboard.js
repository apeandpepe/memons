// =====================================================================
//  MEMONS - leaderboard data (latest daily snapshot)
//  Exposes window.MEMONS_LEADERBOARD = [{ rank, address, referrals }]
//  Pages may define window.MEMONS_LB_ONLOAD(rows) to re-render on load.
// =====================================================================
(function () {
  var SB_URL = "https://neixdrtamznrooougcda.supabase.co";
  var SB_ANON = "sb_publishable_xXzlHTJ4cX8kJoEGXw_csw_q5qFK1nO";

  window.MEMONS_LEADERBOARD = [];
  window.MEMONS_LB_TAKEN_AT = null;
  window.MEMONS_LB_READY = false;

  function emit() {
    window.MEMONS_LB_READY = true;
    if (typeof window.MEMONS_LB_ONLOAD === "function") {
      try { window.MEMONS_LB_ONLOAD(window.MEMONS_LEADERBOARD); } catch (e) {}
    }
  }

  /* Which request is the current one.

     The script fires a request for every season as soon as it loads,
     and a page with a season tab immediately asks again for the season
     it is showing. Two requests are then in flight, and nothing says
     the first one comes back first -- when it came back second it
     overwrote the season the reader had chosen with the all-season
     list. Only the newest request is allowed to write. */
  var seq = 0;

  async function load(season) {
    var mine = ++seq;
    try {
      var body = { p_limit: 200 };
      /* Absent means every season, which is what the public pages want.
         The my-page screens pass the tab they are showing. */
      if (season) body.p_season = season;
      var res = await fetch(SB_URL + "/rest/v1/rpc/leaderboard_latest", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SB_ANON,
          Authorization: "Bearer " + SB_ANON
        },
        body: JSON.stringify(body)
      });
      var rows = await res.json();
      if (mine !== seq) return;          // a newer request has taken over
      if (Array.isArray(rows)) {
        window.MEMONS_LEADERBOARD = rows.map(function (r) {
          return { rank: r.rank, address: r.address, referrals: r.referrals };
        });
        window.MEMONS_LB_TAKEN_AT = rows.length ? rows[0].taken_at : null;
      } else {
        /* A season with nobody in it answers with an empty array, but a
           failed call can answer with an object. Clearing the list here
           stops the previous season's rows staying on screen under the
           new tab. */
        window.MEMONS_LEADERBOARD = [];
      }
    } catch (e) {
      // leave the list empty; pages show their own empty state
      if (mine !== seq) return;
    }
    emit();
  }

  /* Reloading for a different season. The pages that have a season tab
     call this when it changes; everything else keeps the single load
     below and never knows the parameter exists. */
  window.MEMONS_LB_LOAD = load;

  load();
})();
