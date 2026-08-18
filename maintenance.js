/* MEMONS — maintenance gate
 *
 * Drop it into any public page. It asks the server whether the site is
 * closed and, if it is, covers the page.
 *
 * The state comes from the server, not from this device: event_public
 * computes it against the database clock, so a phone set an hour fast
 * cannot let itself in early or lock itself out late.
 *
 * Polled rather than checked once. Turning maintenance on while people are
 * mid-session is the whole point of a switch, and someone sitting on the
 * capsule page would otherwise never hear about it.
 */
(function () {
  'use strict';

  var SB_URL  = "https://neixdrtamznrooougcda.supabase.co";
  var SB_ANON = "sb_publishable_xXzlHTJ4cX8kJoEGXw_csw_q5qFK1nO";
  var POLL_MS = 20000;

  /* The admin page has to stay reachable while the site is closed, or the
     switch can only ever be flipped one way. */
  if (/admin/i.test(location.pathname)) return;

  var el = null;

  function fill(row) {
    var t = el.querySelector('.mtn-title');
    var m = el.querySelector('.mtn-msg');
    var i = el.querySelector('.mtn-img');
    /* Both optional. The artwork usually carries the wordmark and the
       headline already, and repeating them underneath reads as a mistake --
       so an empty field removes the element rather than falling back. */
    var title = (row.maintenance_title || '').trim();
    if (t) { t.textContent = title; t.style.display = title ? '' : 'none'; }
    var brand = el.querySelector('.mtn-brand');
    var hasImg = !!(row.maintenance_img || '').trim();
    if (brand) brand.style.display = (hasImg || !title) ? 'none' : '';
    if (m) m.textContent = row.maintenance_msg ||
      'Scheduled maintenance.\nThis page will reopen on its own when the work is finished.';
    if (i) {
      /* Two pieces of artwork, one landscape and one portrait. Chosen by the
         shape of the window rather than by device: a phone held sideways and
         a narrow desktop window want the same one. Falls back to whichever
         is filled in when only one is. */
      var wide = (row.maintenance_img_wide || '').trim();
      var tall = (row.maintenance_img || '').trim();
      var landscape = window.innerWidth >= window.innerHeight && window.innerWidth >= 720;
      var src = (landscape ? (wide || tall) : (tall || wide));
      i.style.maxWidth  = landscape ? 'min(1100px,92vw)' : 'min(520px,88vw)';
      i.style.maxHeight = landscape ? '58vh' : '60vh';
      if (src) {
        /* Only swap when it actually changes, or every poll restarts the
           download and the picture flashes every twenty seconds. */
        if (i.getAttribute('src') !== src) i.src = src;
        i.style.display = '';
      } else {
        i.style.display = 'none';
      }
    }
  }

  function show(row) {
    if (el) { fill(row); return; }
    el = document.createElement('div');
    el.id = 'memonsMaintenance';
    el.setAttribute('role', 'alertdialog');
    el.style.cssText =
      'position:fixed;inset:0;z-index:2147483600;background:#08080a;' +
      'display:flex;flex-direction:column;align-items:center;justify-content:center;' +
      'gap:20px;padding:28px 22px;text-align:center;overflow-y:auto;' +
      "font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#e8e6e0";

    el.innerHTML =
      '<img class="mtn-img" alt="" style="max-width:min(520px,88vw);max-height:60vh;' +
        'object-fit:contain;display:none;border-radius:12px" ' +
        'onerror="this.style.display=\'none\'">' +
      '<div class="mtn-brand" style="font-size:12px;letter-spacing:4px;color:#E9B84A;' +
        'font-weight:700;display:none">MEMONS</div>' +
      '<div class="mtn-title" style="font-size:clamp(20px,6vw,30px);letter-spacing:2px;' +
        'font-weight:800;color:#E9B84A;display:none"></div>' +
      /* white-space:pre-line so the line breaks typed in admin survive.
         The closing line used to be fixed in here; it is part of the message
         now, which is the only place it can be edited or translated. */
      '<div class="mtn-msg" style="font-size:clamp(15px,4.3vw,19px);line-height:1.95;' +
        'color:#c9c5bc;max-width:44rem;white-space:pre-line;letter-spacing:.2px;' +
        'text-wrap:balance"></div>';

    (document.body || document.documentElement).appendChild(el);
    document.documentElement.style.overflow = 'hidden';
    fill(row);
  }

  function hide() {
    if (!el) return;
    el.remove(); el = null;
    document.documentElement.style.overflow = '';
  }

  /* Two requests, deliberately.

     The artwork is held in the row itself, so asking for the whole row is
     asking for a few hundred kilobytes -- every twenty seconds, from every
     open tab, for as long as the site is up. The poll therefore reads one
     boolean, and the row with the pictures in it is fetched once, at the
     moment the site actually closes. */
  var content = null;

  function check() {
    fetch(SB_URL + '/rest/v1/event_public?id=eq.1&select=maintenance',
          { headers: { apikey: SB_ANON, Authorization: 'Bearer ' + SB_ANON },
            cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (rows) {
        if (!rows || !rows.length) return;
        /* Only an explicit true closes the site. A request that fails, or a
           column that is not there yet, leaves the page as it was -- a
           network blip should not lock people out. */
        if (rows[0].maintenance !== true) { content = null; hide(); return; }
        if (content) { show(content); return; }
        fetch(SB_URL + '/rest/v1/event_public?id=eq.1&select=' +
              'maintenance_msg,maintenance_title,maintenance_img,maintenance_img_wide',
              { headers: { apikey: SB_ANON, Authorization: 'Bearer ' + SB_ANON },
                cache: 'no-store' })
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (rs) {
            content = (rs && rs[0]) ? rs[0] : {};
            show(content);
          })
          .catch(function () { show({}); });
      })
      .catch(function () {});
  }

  check();
  setInterval(check, POLL_MS);
  /* Coming back to a tab that has been in the background for an hour should
     not take another twenty seconds to notice. */
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) check();
  });
  /* Rotating the phone changes which piece of artwork belongs on screen. */
  window.addEventListener('resize', function () { if (el) check(); });
})();
