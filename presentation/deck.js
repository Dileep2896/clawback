// Clawback stage deck. Classic script so it runs from file:// with no server.
// The screen is always derived from {slide, step}: every [data-step] <= step on the current slide is shown, so Back,
// a jump or a reload give the same screen as stepping forwards.
(function () {
  "use strict";
  var NOTES = window.NOTES || {};
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (location.hash === "#presenter") return presenter();

  var stage = document.getElementById("stage");
  var slides = Array.prototype.slice.call(document.querySelectorAll(".slide"));
  var cur = { s: 0, st: 0 };
  var presenterWin = null;
  var digits = "";
  var stopLoop = null;

  function maxStep(s) {
    var m = 0;
    slides[s].querySelectorAll("[data-step]").forEach(function (el) { m = Math.max(m, +el.dataset.step); });
    return m;
  }

  // Scale the 1920×1080 stage to fit, letterboxed.
  function fit() { stage.style.setProperty("--scale", Math.min(innerWidth / 1920, innerHeight / 1080)); }
  addEventListener("resize", fit);
  fit();

  function fmt(el, v) {
    var d = +(el.dataset.decimals || 0);
    var n = v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
    el.textContent = (el.dataset.prefix || "") + n + (el.dataset.suffix || "");
  }
  function countUp(el) {
    var to = +el.dataset.count, from = +(el.dataset.from || 0);
    if (reduced) return fmt(el, to);
    var t0 = performance.now(), dur = 1400;
    fmt(el, from);
    (function tick(now) {
      if (!el.isConnected) return;
      var p = Math.min(1, (now - t0) / dur);
      fmt(el, from + (to - from) * (1 - Math.pow(1 - p, 3)));
      if (p < 1 && el._counting) requestAnimationFrame(tick);
    })(t0);
  }

  // Video: forward onto a step plays its stretch; any other arrival shows the stretch's last frame, paused.
  function segmentEnd(slide, v, st) {
    var pause = slide.dataset.pause;
    if (pause && st === 0) return +pause;
    return v.duration || 0;
  }
  function playTo(v, end) {
    if (stopLoop) stopLoop();
    var live = true;
    stopLoop = function () { live = false; };
    v.play().catch(function () {});
    (function watch() {
      if (!live) return;
      if (end != null && v.currentTime >= end) { v.pause(); v.currentTime = end; return; }
      requestAnimationFrame(watch);
    })();
  }
  function syncVideo(slide, st, forwardFrom) {
    var v = slide.querySelector("video");
    if (!v) return;
    if (!v.src) v.src = v.dataset.clip;
    var pause = slide.dataset.pause ? +slide.dataset.pause : null;
    var playing = forwardFrom === "enter" && st === 0 || forwardFrom === "step" && pause != null && st === 1;
    if (forwardFrom === "step" && !playing) return; // a later build on a demo slide leaves the clip alone
    if (playing) {
      if (st === 0) v.currentTime = 0;
      return playTo(v, st === 0 ? pause : null);
    }
    if (stopLoop) stopLoop();
    v.pause();
    var seek = function () { v.currentTime = segmentEnd(slide, v, st); };
    if (v.readyState >= 1) seek(); else v.addEventListener("loadedmetadata", seek, { once: true });
  }

  function go(s, st, how) {
    s = Math.max(0, Math.min(slides.length - 1, s));
    st = Math.max(0, Math.min(maxStep(s), st));
    var prev = cur;
    cur = { s: s, st: st };
    var slide = slides[s];
    var forwardStep = how === "next" && prev.s === s && st === prev.st + 1;
    var forwardEnter = how === "next" && prev.s !== s;

    slides.forEach(function (el, i) {
      el.classList.toggle("is-current", i === s);
      if (i !== s) el.querySelectorAll("video").forEach(function (v) { v.pause(); });
    });
    if (!(forwardStep || forwardEnter)) {
      stage.classList.add("is-instant");
      requestAnimationFrame(function () { requestAnimationFrame(function () { stage.classList.remove("is-instant"); }); });
    }
    slide.querySelectorAll("[data-step]").forEach(function (el) {
      var n = +el.dataset.step, show = n <= st;
      var fresh = show && (forwardEnter && n === 0 || forwardStep && n === st);
      el.classList.toggle("is-built", show);
      el.querySelectorAll("[data-count]").forEach(function (c) {
        c._counting = fresh;
        if (fresh) countUp(c); else fmt(c, +c.dataset.count);
      });
    });
    syncVideo(slide, st, forwardEnter ? "enter" : forwardStep ? "step" : null);

    history.replaceState(null, "", "#" + (s + 1) + "." + st);
    tellPresenter();
  }

  function next() {
    if (cur.st < maxStep(cur.s)) go(cur.s, cur.st + 1, "next");
    else if (cur.s < slides.length - 1) go(cur.s + 1, 0, "next");
  }
  function back() {
    if (cur.st > 0) go(cur.s, cur.st - 1, "back");
    else if (cur.s > 0) go(cur.s - 1, maxStep(cur.s - 1), "back");
  }

  function command(key) {
    if (/^[0-9]$/.test(key)) { digits += key; return; }
    if (key === "Enter" && digits) { var n = +digits; digits = ""; return go(n - 1, 0, "jump"); }
    digits = "";
    switch (key) {
      case "ArrowRight": case " ": case "PageDown": case "Enter": case "ArrowDown": return next();
      case "ArrowLeft": case "PageUp": case "ArrowUp": case "Backspace": return back();
      case "Home": return go(0, 0, "jump");
      case "End": return go(slides.length - 1, maxStep(slides.length - 1), "jump");
      case "b": case "B": case ".": return document.body.classList.toggle("is-black");
      case "f": case "F":
        return document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
      case "s": case "S":
        presenterWin = window.open(location.href.split("#")[0] + "#presenter", "clawback-presenter", "width=1100,height=760");
        return;
    }
  }
  addEventListener("keydown", function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    e.preventDefault();
    command(e.key);
  });

  // Presenter window: synced over postMessage on the window references (file:// pages share no channel).
  function state() {
    var s = cur.s, st = cur.st;
    var nx = st < maxStep(s) ? [s, st + 1] : s < slides.length - 1 ? [s + 1, 0] : null;
    return {
      type: "state",
      pos: (s + 1) + "." + st + "  ·  " + slides[s].dataset.title + "  ·  slide " + (s + 1) + " of " + slides.length,
      now: NOTES[(s + 1) + "." + st] || "",
      next: nx ? slides[nx[0]].dataset.title + ": " + (NOTES[(nx[0] + 1) + "." + nx[1]] || "") : "End of the deck.",
    };
  }
  function tellPresenter() { if (presenterWin && !presenterWin.closed) presenterWin.postMessage(state(), "*"); }
  addEventListener("message", function (e) {
    var d = e.data || {};
    if (d.type === "hello") { presenterWin = e.source; tellPresenter(); }
    if (d.type === "key") command(d.key);
  });

  var m = /^#(\d+)\.(\d+)$/.exec(location.hash);
  go(m ? +m[1] - 1 : 0, m ? +m[2] : 0, "jump");

  function presenter() {
    document.body.classList.add("is-presenter");
    document.title = "Clawback · presenter";
    document.getElementById("presenter").hidden = false;
    var main = window.opener;
    var t0 = Date.now();
    var timer = document.getElementById("p-timer");
    setInterval(function () {
      var sec = Math.floor((Date.now() - t0) / 1000);
      timer.textContent = Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0") + " / 4:00";
      timer.className = sec > 255 ? "over" : sec > 225 ? "warn" : "";
      if (main && !main.closed) main.postMessage({ type: "hello" }, "*"); // also re-links after the deck reloads
    }, 1000);
    addEventListener("message", function (e) {
      var d = e.data || {};
      if (d.type !== "state") return;
      document.getElementById("p-pos").textContent = d.pos;
      document.getElementById("p-now").textContent = d.now;
      document.getElementById("p-next").textContent = d.next;
    });
    addEventListener("keydown", function (e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      e.preventDefault();
      if (e.key === "r" || e.key === "R") { t0 = Date.now(); return; }
      if (main && !main.closed) main.postMessage({ type: "key", key: e.key }, "*");
    });
    if (main) main.postMessage({ type: "hello" }, "*");
  }
})();
