/* ConCafe Ministries — episode archive + sticky player.
   No dependencies. Episode data comes from data/episodes.json, which
   scripts/build_feed.py generates from the show's public RSS feed. */

(function () {
  "use strict";

  var PAGE = 24;                 // episodes revealed per "load more"
  var RATES = [1, 1.25, 1.5, 1.75, 2];

  var state = {
    all: [],                     // every episode, newest first
    view: [],                    // current search/filter result
    shown: 0,                    // how many of `view` are rendered
    current: null,               // episode currently loaded in the player
    rateIndex: 0,
    seeking: false
  };

  var $ = function (id) { return document.getElementById(id); };

  var el = {
    featured: $("featured"),
    list: $("episode-list"),
    count: $("result-count"),
    more: $("load-more"),
    q: $("q"),
    qClear: $("q-clear"),
    year: $("year"),
    sort: $("sort"),
    statCount: $("stat-count"),
    updated: $("updated"),
    audio: $("audio"),
    player: $("player"),
    pTitle: $("player-title"),
    pDate: $("player-date"),
    pPlay: $("p-play"),
    pBack: $("p-back"),
    pFwd: $("p-fwd"),
    pRange: $("p-range"),
    pCur: $("p-cur"),
    pDur: $("p-dur"),
    pRate: $("p-rate"),
    pClose: $("p-close")
  };

  /* ── theme ─────────────────────────────────────────────── */

  var THEME_KEY = "concafe-theme";

  function currentTheme() {
    var saved = null;
    try { saved = localStorage.getItem(THEME_KEY); } catch (e) { /* private mode */ }
    if (saved) return saved;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  (function initTheme() {
    var saved = null;
    try { saved = localStorage.getItem(THEME_KEY); } catch (e) { /* ignore */ }
    if (saved) document.documentElement.setAttribute("data-theme", saved);

    $("theme-toggle").addEventListener("click", function () {
      var next = currentTheme() === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* ignore */ }
    });
  })();

  /* ── formatting ────────────────────────────────────────── */

  function fmtDate(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return "";
    return d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  }

  function fmtLen(seconds) {
    if (!seconds) return "";
    var m = Math.round(seconds / 60);
    return m < 60 ? m + " min" : Math.floor(m / 60) + " hr " + (m % 60) + " min";
  }

  function clock(seconds) {
    if (!isFinite(seconds) || seconds < 0) seconds = 0;
    var total = Math.floor(seconds);
    var h = Math.floor(total / 3600);
    var m = Math.floor((total % 3600) / 60);
    var s = total % 60;
    var mm = h && m < 10 ? "0" + m : String(m);
    return (h ? h + ":" : "") + mm + ":" + (s < 10 ? "0" + s : s);
  }

  function esc(str) {
    return String(str)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  // Wrap search hits in <mark>. Operates on already-escaped text, so the
  // needle is escaped the same way before matching.
  function highlight(escaped, needle) {
    if (!needle) return escaped;
    var safe = esc(needle).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return escaped.replace(new RegExp(safe, "gi"), function (hit) {
      return "<mark>" + hit + "</mark>";
    });
  }

  function slugify(title) {
    return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
  }

  /* ── load ──────────────────────────────────────────────── */

  fetch("data/episodes.json")
    .then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    })
    .then(start)
    .catch(function (err) {
      el.featured.innerHTML =
        '<p class="loading">The episode list could not be loaded (' + esc(err.message) + '). ' +
        'You can still listen on <a href="https://podcasts.apple.com/us/podcast/concafe-con-eradio-valverde/id1470799817">Apple Podcasts</a> ' +
        'or <a href="https://open.spotify.com/show/7Jt3CLGUpJ7wyLUHaxNaCl">Spotify</a>.</p>';
      el.count.textContent = "";
    });

  function start(data) {
    // Rows are [title, date, seconds, blurb, audio, link] — see build_feed.py.
    state.all = data.episodes.map(function (row, i) {
      return {
        i: i,
        title: row[0],
        date: row[1],
        seconds: row[2],
        blurb: row[3],
        audio: row[4],
        link: row[5],
        year: row[1].slice(0, 4),
        hay: (row[0] + " " + row[3]).toLowerCase()
      };
    });

    el.statCount.textContent = state.all.length.toLocaleString();
    if (data.generated) {
      el.updated.textContent = "Episode list last refreshed " + fmtDate(data.generated) + ".";
    }

    renderFeatured(state.all[0]);
    fillYears();
    bind();
    applyFilters();
    openFromHash();
  }

  function fillYears() {
    var years = [];
    state.all.forEach(function (ep) {
      if (years.indexOf(ep.year) === -1) years.push(ep.year);
    });
    years.sort().reverse().forEach(function (y) {
      var opt = document.createElement("option");
      opt.value = y;
      opt.textContent = y;
      el.year.appendChild(opt);
    });
  }

  /* ── featured ──────────────────────────────────────────── */

  function renderFeatured(ep) {
    if (!ep) return;
    el.featured.innerHTML =
      '<p class="f-date">' + esc(fmtDate(ep.date)) + '</p>' +
      '<h3>' + esc(ep.title) + '</h3>' +
      (ep.blurb ? '<p class="f-blurb">' + esc(ep.blurb) + '</p>' : '') +
      '<div class="f-actions">' +
        '<button class="btn btn-primary" type="button" data-play="' + ep.i + '">' +
          '<svg viewBox="0 0 24 24" aria-hidden="true" width="16" height="16">' +
          '<path d="M8 5v14l11-7z" fill="currentColor" stroke="none"/></svg>Play episode</button>' +
        (ep.link ? '<a class="btn" href="' + esc(ep.link) + '" target="_blank" rel="noopener">Show notes</a>' : '') +
        '<span class="f-len">' + esc(fmtLen(ep.seconds)) + '</span>' +
      '</div>';
  }

  /* ── archive list ──────────────────────────────────────── */

  function applyFilters() {
    var q = el.q.value.trim().toLowerCase();
    var year = el.year.value;

    state.view = state.all.filter(function (ep) {
      if (year && ep.year !== year) return false;
      if (q && ep.hay.indexOf(q) === -1) return false;
      return true;
    });

    if (el.sort.value === "old") state.view = state.view.slice().reverse();

    el.qClear.hidden = !el.q.value;
    state.shown = 0;
    el.list.innerHTML = "";

    var n = state.view.length;
    if (!n) {
      el.count.textContent = "";
      el.list.innerHTML =
        '<li class="empty"><strong>No episodes matched</strong>' +
        'Try a different word, or clear the filters to see all ' +
        state.all.length.toLocaleString() + ' episodes.</li>';
      el.more.hidden = true;
      return;
    }

    el.count.textContent =
      (q || year)
        ? n.toLocaleString() + (n === 1 ? " episode" : " episodes") + " found"
        : "Showing all " + n.toLocaleString() + " episodes";

    renderMore();
  }

  function renderMore() {
    var q = el.q.value.trim();
    var slice = state.view.slice(state.shown, state.shown + PAGE);
    var frag = document.createDocumentFragment();

    slice.forEach(function (ep) {
      var li = document.createElement("li");
      li.className = "ep";
      li.dataset.index = ep.i;
      li.id = "ep-" + slugify(ep.title) + "-" + ep.i;

      var bodyId = "body-" + ep.i;
      li.innerHTML =
        '<button class="ep-head" type="button" aria-expanded="false" aria-controls="' + bodyId + '">' +
          '<span class="ep-play" aria-hidden="true">' +
            '<svg viewBox="0 0 24 24" width="16" height="16">' +
            '<path d="M8 5v14l11-7z" fill="currentColor" stroke="none"/></svg></span>' +
          '<span>' +
            '<span class="ep-title">' + highlight(esc(ep.title), q) + '</span>' +
            '<span class="ep-sub">' + esc(fmtDate(ep.date)) + '</span>' +
          '</span>' +
          '<span class="ep-len">' + esc(fmtLen(ep.seconds)) + '</span>' +
          '<svg class="ep-caret" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">' +
          '<path d="m6 9 6 6 6-6"/></svg>' +
        '</button>' +
        '<div class="ep-body" id="' + bodyId + '" hidden>' +
          (ep.blurb ? '<p>' + highlight(esc(ep.blurb), q) + '</p>' : '') +
          '<div class="ep-links">' +
            '<button class="mini" type="button" data-play="' + ep.i + '">Play episode</button>' +
            (ep.link ? '<a class="mini" href="' + esc(ep.link) + '" target="_blank" rel="noopener">Show notes</a>' : '') +
            '<a class="mini" href="' + esc(ep.audio) + '" target="_blank" rel="noopener">Open audio</a>' +
          '</div>' +
        '</div>';

      frag.appendChild(li);
    });

    el.list.appendChild(frag);
    state.shown += slice.length;
    el.more.hidden = state.shown >= state.view.length;
    if (!el.more.hidden) {
      el.more.textContent =
        "Load more episodes (" + (state.view.length - state.shown).toLocaleString() + " remaining)";
    }
    markPlaying();
  }

  /* ── player ────────────────────────────────────────────── */

  function play(index) {
    var ep = state.all[index];
    if (!ep) return;

    if (state.current && state.current.i === ep.i) {
      // Same episode: the button acts as play/pause.
      if (el.audio.paused) el.audio.play(); else el.audio.pause();
      return;
    }

    state.current = ep;
    el.audio.src = ep.audio;
    el.audio.playbackRate = RATES[state.rateIndex];
    el.player.hidden = false;
    document.body.classList.add("has-player");

    el.pTitle.textContent = ep.title;
    el.pDate.textContent = fmtDate(ep.date);
    el.pDur.textContent = ep.seconds ? clock(ep.seconds) : "0:00";
    el.pRange.value = 0;
    el.pCur.textContent = "0:00";

    history.replaceState(null, "", "#" + ("ep-" + slugify(ep.title) + "-" + ep.i));

    var attempt = el.audio.play();
    if (attempt && attempt.catch) {
      attempt.catch(function () { setPlayIcon(false); });
    }
    markPlaying();

    if ("mediaSession" in navigator) {
      navigator.mediaSession.metadata = new window.MediaMetadata({
        title: ep.title,
        artist: "Pastor Eradio Valverde",
        album: "ConCafe con Eradio Valverde",
        artwork: [{ src: "assets/cover.jpg", sizes: "512x512", type: "image/jpeg" }]
      });
    }
  }

  function setPlayIcon(playing) {
    el.pPlay.querySelector(".i-play").hidden = playing;
    el.pPlay.querySelector(".i-pause").hidden = !playing;
    el.pPlay.setAttribute("aria-label", playing ? "Pause" : "Play");
  }

  function markPlaying() {
    var id = state.current ? String(state.current.i) : null;
    Array.prototype.forEach.call(el.list.children, function (li) {
      li.classList.toggle("is-playing", li.dataset.index === id);
    });
  }

  el.audio.addEventListener("play", function () { setPlayIcon(true); });
  el.audio.addEventListener("pause", function () { setPlayIcon(false); });

  el.audio.addEventListener("loadedmetadata", function () {
    if (isFinite(el.audio.duration)) el.pDur.textContent = clock(el.audio.duration);
  });

  el.audio.addEventListener("timeupdate", function () {
    if (state.seeking) return;
    var dur = el.audio.duration;
    el.pCur.textContent = clock(el.audio.currentTime);
    if (isFinite(dur) && dur > 0) {
      el.pRange.value = Math.round((el.audio.currentTime / dur) * 1000);
    }
  });

  el.audio.addEventListener("ended", function () {
    // Roll into the next episode in the list the listener is looking at.
    var pos = state.view.findIndex(function (ep) { return ep.i === state.current.i; });
    if (pos > -1 && pos + 1 < state.view.length) play(state.view[pos + 1].i);
  });

  el.audio.addEventListener("error", function () {
    if (!el.audio.src) return;
    el.pDate.textContent = "This episode could not be loaded — try the show notes link.";
  });

  /* ── events ────────────────────────────────────────────── */

  function bind() {
    var timer;
    el.q.addEventListener("input", function () {
      clearTimeout(timer);
      timer = setTimeout(applyFilters, 140);
    });

    el.qClear.addEventListener("click", function () {
      el.q.value = "";
      applyFilters();
      el.q.focus();
    });

    el.year.addEventListener("change", applyFilters);
    el.sort.addEventListener("change", applyFilters);
    el.more.addEventListener("click", renderMore);

    // One delegated handler covers every play button and every row toggle,
    // including rows added later by "load more".
    document.addEventListener("click", function (e) {
      var playBtn = e.target.closest("[data-play]");
      if (playBtn) {
        e.preventDefault();
        play(parseInt(playBtn.dataset.play, 10));
        return;
      }

      var head = e.target.closest(".ep-head");
      if (head) {
        var li = head.closest(".ep");
        var body = li.querySelector(".ep-body");
        var open = head.getAttribute("aria-expanded") === "true";
        head.setAttribute("aria-expanded", open ? "false" : "true");
        li.classList.toggle("is-open", !open);
        body.hidden = open;
      }
    });

    el.pPlay.addEventListener("click", function () {
      if (!state.current) { play(0); return; }
      if (el.audio.paused) el.audio.play(); else el.audio.pause();
    });

    el.pBack.addEventListener("click", function () {
      el.audio.currentTime = Math.max(0, el.audio.currentTime - 15);
    });

    el.pFwd.addEventListener("click", function () {
      el.audio.currentTime = Math.min(el.audio.duration || Infinity, el.audio.currentTime + 30);
    });

    el.pRange.addEventListener("input", function () {
      state.seeking = true;
      var dur = el.audio.duration;
      if (isFinite(dur) && dur > 0) el.pCur.textContent = clock((el.pRange.value / 1000) * dur);
    });

    el.pRange.addEventListener("change", function () {
      var dur = el.audio.duration;
      if (isFinite(dur) && dur > 0) el.audio.currentTime = (el.pRange.value / 1000) * dur;
      state.seeking = false;
    });

    el.pRate.addEventListener("click", function () {
      state.rateIndex = (state.rateIndex + 1) % RATES.length;
      el.audio.playbackRate = RATES[state.rateIndex];
      el.pRate.textContent = RATES[state.rateIndex] + "×";
    });

    el.pClose.addEventListener("click", function () {
      el.audio.pause();
      el.audio.removeAttribute("src");
      el.audio.load();
      el.player.hidden = true;
      document.body.classList.remove("has-player");
      state.current = null;
      markPlaying();
    });

    // Space toggles playback unless the listener is typing or on a control.
    document.addEventListener("keydown", function (e) {
      if (e.code !== "Space" || !state.current) return;
      var t = e.target;
      if (t.matches("input, select, textarea, button, a, [contenteditable]")) return;
      e.preventDefault();
      if (el.audio.paused) el.audio.play(); else el.audio.pause();
    });

    // The video thumbnail is a click-to-load stand-in, so no YouTube request
    // is made — and no YouTube cookie is set — unless a visitor asks for it.
    var vb = $("video-embed");
    if (vb) {
      vb.addEventListener("click", function () {
        var frame = document.createElement("iframe");
        frame.src = "https://www.youtube-nocookie.com/embed/lGLykIDIrNI?autoplay=1&rel=0";
        frame.title = "Rev. Eradio Valverde — United Methodist Videos";
        frame.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";
        frame.allowFullscreen = true;
        frame.loading = "lazy";
        vb.replaceWith(frame);
      });
    }
  }

  // A shared link like #ep-god-sent-me-0 scrolls to that episode and opens it.
  function openFromHash() {
    var hash = location.hash.slice(1);
    if (!hash.startsWith("ep-")) return;
    var index = parseInt(hash.slice(hash.lastIndexOf("-") + 1), 10);
    if (isNaN(index) || !state.all[index]) return;

    // Reveal enough pages for the target row to exist before scrolling to it.
    var pos = state.view.findIndex(function (ep) { return ep.i === index; });
    while (pos > -1 && state.shown <= pos && !el.more.hidden) renderMore();

    var li = document.getElementById(hash);
    if (!li) return;

    // Suspend the stylesheet's smooth scrolling for this one jump. Deep in the
    // archive the target sits tens of thousands of pixels down, and animating
    // that turns landing on an episode into a long ride past every one before
    // it. Toggling the inline style is more dependable across browsers than
    // scrollIntoView's `behavior` option, which some ignore.
    var root = document.documentElement;
    var prior = root.style.scrollBehavior;
    root.style.scrollBehavior = "auto";
    window.scrollTo(0, window.scrollY + li.getBoundingClientRect().top
      - (window.innerHeight / 2) + (li.offsetHeight / 2));
    root.style.scrollBehavior = prior;

    if (li.querySelector(".ep-head").getAttribute("aria-expanded") === "false") {
      li.querySelector(".ep-head").click();
    }
  }

  // Also honour a hash that arrives after load — a pasted link into an open
  // tab, or the back button returning to a previously opened episode.
  window.addEventListener("hashchange", function () {
    if (state.all.length) openFromHash();
  });
})();
