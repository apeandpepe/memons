/* =====================================================================
   season-tabs.js — the season 0 / season 1 switch

   Season 1 starts clean, but open beta holdings have to stay visible
   until those rewards are handed out. Four screens need the same split
   -- dashboard, collection, inventory, referral -- so the rule lives
   here once rather than four times.

   Whether season 0 appears at all is the admin's `show_season0` flag.
   Turn it off there and the tab disappears from every screen at once,
   after which the season 0 rows can be deleted without breaking a page.

   Usage:
     SeasonTabs.mount({
       el: document.getElementById('seasonTabs'),
       owned: ownedArray,            // optional, picks a sensible default tab
       onChange: function(season){ ... }
     });
     SeasonTabs.current();           // 's1' | 's0'
     SeasonTabs.seasonOf(ownedRow);  // 's1' | 's0'
     SeasonTabs.filter(ownedArray);  // rows belonging to the open tab

   The flag is read once per page load. It changes about twice in the
   life of the site, so polling it would be twenty requests an hour for
   an answer that does not move.
   ================================================================== */
(function (w) {
  'use strict';

  var SB_URL  = "https://neixdrtamznrooougcda.supabase.co";
  var SB_ANON = "sb_publishable_xXzlHTJ4cX8kJoEGXw_csw_q5qFK1nO";

  var CURRENT = 's1';        // the season the site is playing now
  var PAST    = 's0';        // the one kept on screen for the rewards

  var state = {
    season:   CURRENT,
    showPast: false,         // stays false until the flag says otherwise
    mounted:  [],
  };

  /* Which season a row belongs to.

     cards.season_key is the card's own season and is set on every row,
     so it decides. owned.season is the season the pull happened in and
     only became reliable once pull_capsule started recording it, which
     is why it is a fallback rather than the answer. Anything still
     unlabelled is from the beta, because that is all there was. */
  function seasonOf(row) {
    if (!row) return PAST;
    var k = (row.cards && row.cards.season_key) || row.season || '';
    k = String(k).toLowerCase();
    return k === CURRENT ? CURRENT : PAST;
  }

  function filter(list) {
    if (!list || !list.length) return [];
    /* With the past season hidden, its rows are gone from every screen
       -- not merely untabbed. A hidden tab that still counted towards
       the totals would be worse than showing it. */
    if (!state.showPast) {
      return list.filter(function (r) { return seasonOf(r) === CURRENT; });
    }
    return list.filter(function (r) { return seasonOf(r) === state.season; });
  }

  function css() {
    if (document.getElementById('season-tabs-css')) return;
    var s = document.createElement('style');
    s.id = 'season-tabs-css';
    s.textContent =
      '.stabs{display:flex;gap:8px;margin:18px 0 2px;flex-wrap:wrap}' +
      '.stabs button{font-family:var(--font-head,inherit);font-size:12px;letter-spacing:1.5px;' +
        'color:var(--muted,#8d8a82);background:transparent;cursor:pointer;' +
        'border:1px solid var(--line,rgba(255,255,255,.08));border-radius:999px;' +
        'padding:8px 16px;transition:color .15s,border-color .15s,background .15s}' +
      '.stabs button:hover{color:var(--text,#e8e6e0)}' +
      '.stabs button.on{color:var(--gold,#E9B84A);border-color:var(--gold,#E9B84A);' +
        'background:rgba(233,184,74,.08)}' +
      '.stabs .snote{font-size:11.5px;color:var(--dim,#55524b);align-self:center;margin-left:4px}' +
      '@media(max-width:560px){.stabs{gap:6px}.stabs button{padding:7px 13px;font-size:11px}' +
        '.stabs .snote{width:100%;margin:2px 0 0}}';
    document.head.appendChild(s);
  }

  function paint(m) {
    if (!m.el) return;
    /* One season to show means nothing to choose between, so the row is
       left empty rather than drawn as a single dead tab. */
    if (!state.showPast) { m.el.innerHTML = ''; return; }
    var on = state.season;
    m.el.className = 'stabs';
    m.el.innerHTML =
      '<button type="button" data-s="' + CURRENT + '"' +
        (on === CURRENT ? ' class="on"' : '') + '>SEASON 1</button>' +
      '<button type="button" data-s="' + PAST + '"' +
        (on === PAST ? ' class="on"' : '') + '>OPEN BETA</button>' +
      (on === PAST ? '<span class="snote">Open Beta records, kept for reward payout.</span>' : '');
    Array.prototype.forEach.call(m.el.querySelectorAll('button'), function (b) {
      b.onclick = function () {
        var next = b.getAttribute('data-s');
        if (next === state.season) return;
        state.season = next;
        state.mounted.forEach(paint);
        state.mounted.forEach(function (x) { if (x.onChange) x.onChange(next); });
      };
    });
  }

  /* Pick the tab that has something in it.

     Season 1 is the right default in principle, but on opening day
     nobody has pulled a season 1 card yet -- landing everyone on an
     empty inventory and letting them think their cards were taken. So
     if there is nothing in the current season and something in the
     past one, that is where the page opens. */
  function pickDefault(owned) {
    if (!state.showPast || !owned || !owned.length) return;
    var hasNow = false, hasPast = false;
    for (var i = 0; i < owned.length; i++) {
      if (seasonOf(owned[i]) === CURRENT) hasNow = true; else hasPast = true;
      if (hasNow) break;
    }
    if (!hasNow && hasPast) state.season = PAST;
  }

  function mount(opts) {
    css();
    var m = {
      el:       opts && opts.el,
      onChange: opts && opts.onChange,
    };
    state.mounted.push(m);
    if (opts && opts.owned) pickDefault(opts.owned);
    paint(m);
    return m;
  }

  /* Read the flag, then tell every screen that mounted before the
     answer arrived. Failing closed on purpose: if the request does not
     come back, the site shows season 1 only, which is the state it will
     spend most of its life in. */
  function load() {
    return fetch(SB_URL + '/rest/v1/event_public?id=eq.1&select=show_season0',
                 { headers: { apikey: SB_ANON, Authorization: 'Bearer ' + SB_ANON },
                   cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (rows) {
        state.showPast = !!(rows && rows[0] && rows[0].show_season0 === true);
      })
      .catch(function () { state.showPast = false; });
  }

  var ready = load();

  w.SeasonTabs = {
    /* Screens wait on this before their first draw, so the tabs and the
       list they describe appear together instead of the list flashing
       up unfiltered and then changing under the reader. */
    ready:     function (cb) { return cb ? ready.then(cb) : ready; },
    mount:     mount,
    current:   function () { return state.showPast ? state.season : CURRENT; },
    showsPast: function () { return state.showPast; },
    seasonOf:  seasonOf,
    filter:    filter,
    refresh:   function (owned) {
      pickDefault(owned);
      state.mounted.forEach(paint);
    },
  };
})(window);
