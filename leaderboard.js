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

  async function load() {
    try {
      var res = await fetch(SB_URL + "/rest/v1/rpc/leaderboard_latest", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SB_ANON,
          Authorization: "Bearer " + SB_ANON
        },
        body: JSON.stringify({ p_limit: 200 })
      });
      var rows = await res.json();
      if (Array.isArray(rows)) {
        window.MEMONS_LEADERBOARD = rows.map(function (r) {
          return { rank: r.rank, address: r.address, referrals: r.referrals };
        });
        window.MEMONS_LB_TAKEN_AT = rows.length ? rows[0].taken_at : null;
      }
    } catch (e) {
      // leave the list empty; pages show their own empty state
    }
    emit();
  }

  load();
})();
