/* =====================================================================
 *  email-auth.js — signing in with an address and a password
 *
 *  For the members Google leaves out. Supabase Auth holds the password,
 *  sends the confirmation and the reset mail, and checks the login; this
 *  file carries the answers back and forth and swaps the session it gets
 *  for a MEMONS token through /social/email.
 *
 *  Load before mypage-entry.js, beside social-login.js:
 *
 *      <script src="email-auth.js"></script>
 *
 *  Exposes MEMONS_EMAIL with signUp, signIn, reset and link. Each one
 *  resolves with what happened and rejects with a message fit to show
 *  somebody -- never a raw error from the server.
 * ===================================================================== */
(function () {
  "use strict";

  var SB_URL  = "https://neixdrtamznrooougcda.supabase.co";
  var SB_ANON = "sb_publishable_xXzlHTJ4cX8kJoEGXw_csw_q5qFK1nO";
  var API     = SB_URL + "/functions/v1";

  /* The same two keys everything else reads, so a member signed in this
     way is signed in everywhere without another page learning about it. */
  var SS_TOKEN = "memons_jwt_v1";
  var SS_ADDR  = "memons_addr_v1";

  function store() {
    try {
      var k = "__memons_probe";
      localStorage.setItem(k, "1");
      localStorage.removeItem(k);
      return localStorage;
    } catch (e) {
      try { return sessionStorage; } catch (e2) { return null; }
    }
  }

  function save(token, address) {
    var s = store();
    if (!s) return;
    try {
      s.setItem(SS_TOKEN, token);
      if (address !== undefined) s.setItem(SS_ADDR, address || "");
    } catch (e) {}
  }

  function held() {
    var s = store();
    return (window.MEMONS && window.MEMONS.token) || (s && s.getItem(SS_TOKEN)) || "";
  }

  function emit(name, detail) {
    try { document.dispatchEvent(new CustomEvent(name, { detail: detail || {} })); }
    catch (e) {}
  }

  // --- Supabase Auth -------------------------------------------------

  function auth(path, body) {
    return fetch(SB_URL + "/auth/v1" + path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: SB_ANON,
        Authorization: "Bearer " + SB_ANON,
      },
      body: JSON.stringify(body),
    }).then(function (r) {
      return r.json().catch(function () { return {}; })
        .then(function (j) { return { ok: r.ok, status: r.status, body: j }; });
    });
  }

  /* Supabase says what went wrong in its own words. These are the ones a
     member can actually do something about; everything else becomes one
     sentence rather than a stack trace with a member's address in it. */
  function readable(r) {
    var m = String((r.body && (r.body.error_description || r.body.msg || r.body.message)) || "");
    if (/already registered|already been registered/i.test(m)) {
      return "That email already has an account. Sign in instead, or reset the password.";
    }
    if (/invalid login credentials/i.test(m)) {
      return "That email and password don't match.";
    }
    if (/email not confirmed/i.test(m)) {
      return "Check your email and open the confirmation link first.";
    }
    if (/password should be at least|weak/i.test(m)) {
      return "Use a password of at least 8 characters.";
    }
    if (/rate limit|too many/i.test(m)) {
      return "Too many attempts. Wait a minute and try again.";
    }
    return "Something went wrong. Please try again.";
  }

  function valid(email, password) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(email || ""))) {
      return "Enter a valid email address.";
    }
    if (String(password || "").length < 8) {
      return "Use a password of at least 8 characters.";
    }
    return null;
  }

  // --- swapping a Supabase session for a MEMONS one ------------------

  function exchange(accessToken, link) {
    var h = { "content-type": "application/json" };
    if (link) {
      var t = held();
      if (t) h.Authorization = "Bearer " + t;
    }
    return fetch(API + "/social/email", {
      method: "POST",
      headers: h,
      body: JSON.stringify({ access_token: accessToken, link: !!link }),
    }).then(function (r) {
      return r.json().catch(function () { return {}; })
        .then(function (j) {
          if (r.status === 409 || j.status === "taken") {
            throw new Error("That email is already connected to a different MEMONS account.");
          }
          if (r.status === 403 && j.error === "email_not_confirmed") {
            throw new Error("Check your email and open the confirmation link first.");
          }
          if (!r.ok || !j.token) throw new Error("Could not finish signing in. Please try again.");
          return j;
        });
    }).then(function (j) {
      save(j.token);
      /* The rest of the site reads an address, not a UID. */
      return fetch(API + "/social/me", {
        headers: { Authorization: "Bearer " + j.token },
      }).then(function (r) { return r.json(); })
        .then(function (me) {
          var first = (me.wallets && me.wallets[0] && me.wallets[0].address) || "";
          save(j.token, first);
          return { uid: j.uid, email: j.email || null, address: first };
        })
        .catch(function () { return { uid: j.uid, email: j.email || null, address: "" }; });
    });
  }

  // --- what pages call -----------------------------------------------

  /* Making an account. Supabase is normally set to send a confirmation
     mail, in which case there is no session yet and the member has to open
     it; when confirmation is off, one comes straight back and they are in.
     Both are normal, and the caller is told which happened. */
  function signUp(email, password) {
    var bad = valid(email, password);
    if (bad) return Promise.reject(new Error(bad));

    emit("memons:email-start", { what: "signup" });
    return auth("/signup", { email: email, password: password }).then(function (r) {
      if (!r.ok) throw new Error(readable(r));

      var at = r.body && r.body.access_token;
      if (!at) return { status: "confirm_sent", email: email };

      return exchange(at, false).then(function (me) {
        emit("memons:email-signed-in", me);
        return { status: "signed_in", uid: me.uid, email: me.email, address: me.address };
      });
    }).catch(function (e) {
      emit("memons:email-error", { message: String(e.message || e) });
      throw e;
    });
  }

  function signIn(email, password) {
    var bad = valid(email, password);
    if (bad) return Promise.reject(new Error(bad));

    emit("memons:email-start", { what: "signin" });
    return auth("/token?grant_type=password", { email: email, password: password })
      .then(function (r) {
        if (!r.ok || !r.body.access_token) throw new Error(readable(r));
        return exchange(r.body.access_token, false);
      })
      .then(function (me) {
        emit("memons:email-signed-in", me);
        return me;
      })
      .catch(function (e) {
        emit("memons:email-error", { message: String(e.message || e) });
        throw e;
      });
  }

  /* Attaching an address to the account the member is already in -- the
     transfer, for somebody who will not use Google. The password is made
     here and the account is moved in the same step. */
  function link(email, password) {
    var bad = valid(email, password);
    if (bad) return Promise.reject(new Error(bad));

    emit("memons:email-start", { what: "link" });
    return auth("/signup", { email: email, password: password }).then(function (r) {
      /* An address that already has a login: sign in with it instead, and
         attach that. It still has to be an account nobody else holds,
         which the server decides. */
      if (!r.ok) {
        var m = String((r.body && (r.body.msg || r.body.message)) || "");
        if (!/already registered|already been registered/i.test(m)) {
          throw new Error(readable(r));
        }
        return auth("/token?grant_type=password", { email: email, password: password })
          .then(function (r2) {
            if (!r2.ok || !r2.body.access_token) throw new Error(readable(r2));
            return r2.body.access_token;
          });
      }
      return (r.body && r.body.access_token) || null;
    }).then(function (at) {
      if (!at) return { status: "confirm_sent", email: email };
      return exchange(at, true).then(function (me) {
        emit("memons:email-linked", me);
        return { status: "linked", uid: me.uid, email: me.email, address: me.address };
      });
    }).catch(function (e) {
      emit("memons:email-error", { message: String(e.message || e) });
      throw e;
    });
  }

  /* Always answers the same whether or not the address has an account:
     a reset form that says which addresses are registered is a way of
     asking which addresses are registered. */
  function reset(email) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(email || ""))) {
      return Promise.reject(new Error("Enter a valid email address."));
    }
    return auth("/recover", { email: email }).then(function () {
      return { status: "sent" };
    }).catch(function () {
      return { status: "sent" };
    });
  }

  window.MEMONS_EMAIL = {
    signUp: signUp,
    signIn: signIn,
    link:   link,
    reset:  reset,
  };
})();
