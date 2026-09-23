(function(){
  'use strict';

  var root = document.documentElement;
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var hero = document.querySelector('.hero');
  var navLeft = document.querySelector('.nav-left');
  var firstLink = document.querySelector('.nav-links a');

  /* === PAGE BOX ===
   * A page's content starts under the nav (everything above --page-top
   * is masked out of it) and its text starts where the nav's does,
   * wherever the nav wrapped or was nudged to. */
  function placePages(){
    root.style.setProperty('--page-top', Math.ceil(navLeft.getBoundingClientRect().bottom + 8) + 'px');
    root.style.setProperty('--rail-x', Math.round(firstLink.getBoundingClientRect().left) + 'px');
  }
  if (window.ResizeObserver) new ResizeObserver(placePages).observe(navLeft);
  window.addEventListener('resize', placePages);
  placePages();

  /* Nothing locks scrolling: the page box covers the whole screen, and a
   * wheel over the nav, which sits above it, is handed on to the page. */
  document.getElementById('nav').addEventListener('wheel', function(e){
    var page = document.querySelector('.page.active');
    if (page) page.scrollBy(0, e.deltaY * (e.deltaMode === 2 ? page.clientHeight : e.deltaMode === 1 ? 16 : 1));
  }, { passive: true });

  /* === STRATA ===
   * Every [data-sweep] element opens with the sweep in style.css when it
   * gets .open. A route's blocks open as they come into view, so the
   * first screen opens as the route arrives and the rest reveal on
   * scroll with the same motion. --i staggers blocks that open together. */
  function strata(scope){ return scope.querySelectorAll('[data-sweep]'); }
  var shown = null, batch = 0, batchTimer = 0;
  function open(el){
    el.style.setProperty('--i', batch++);
    clearTimeout(batchTimer);
    batchTimer = setTimeout(function(){ batch = 0; }, 120);
    el.classList.add('open');
  }
  var reveal = new IntersectionObserver(function(entries){
    entries.forEach(function(e){
      if (!e.isIntersecting || !shown || !shown.contains(e.target)) return;
      reveal.unobserve(e.target);
      open(e.target);
    });
  }, { threshold: 0.12 });

  function show(scope){
    shown = scope;
    var isHero = scope === hero;
    document.body.classList.toggle('page-open', !isHero);
    var pages = document.querySelectorAll('.page');
    for (var i = 0; i < pages.length; i++) pages[i].classList.toggle('active', pages[i] === scope);
    scope.scrollTop = 0;
    var els = strata(scope);
    for (var k = 0; k < els.length; k++) reveal.observe(els[k]);
  }

  /* Closing waits for the open blocks on screen, last first, then the
   * route swaps. A route change during a close cuts it short. */
  var closing = 0;
  function closeAndShow(from, to){
    clearTimeout(closing);
    var els = strata(from), vis = [], h = window.innerHeight;
    for (var i = 0; i < els.length; i++){
      reveal.unobserve(els[i]);
      if (!els[i].classList.contains('open')) continue;
      var r = els[i].getBoundingClientRect();
      if (r.bottom > 0 && r.top < h && r.height > 0) vis.push(els[i]);
      else els[i].classList.remove('open');
    }
    for (var j = 0; j < vis.length; j++){
      vis[j].style.setProperty('--i', vis.length - 1 - j);
      vis[j].classList.remove('open');
    }
    shown = null;
    var shut = parseFloat(getComputedStyle(root).getPropertyValue('--shut')) * 1000 || 320;
    closing = setTimeout(function(){ show(to); }, vis.length ? shut * 1.8 + (vis.length - 1) * 30 : 0);
  }

  /* === SCREENSHOT DITHER ===
   * Each project screenshot is redrawn at 1px dots in the
   * field's own greys plus black, ordered-dithered with a 4x4 Bayer
   * matrix after stretching its levels, so the plate is made of the same
   * stuff as the field. The plain greyscale image stays underneath (and
   * carries the alt text); hovering or focusing the link fades the dither
   * off it. Redrawn whenever the plate changes size. */
  var BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  var DOT = 1;                 // CSS px per dither pixel: half the field's, so the shots stay legible
  function dither(img){
    var box = img.parentNode, w = Math.round(box.clientWidth / DOT), h = Math.round(box.clientHeight / DOT);
    if (!w || !h || !img.naturalWidth) return;
    var c = box.querySelector('.proj-dither');
    if (c && c.width === w && c.height === h) return;
    if (!c){ c = document.createElement('canvas'); c.className = 'proj-dither'; c.setAttribute('aria-hidden', 'true'); box.appendChild(c); }
    c.width = w; c.height = h;
    var g = c.getContext('2d'), iw = img.naturalWidth, ih = img.naturalHeight;
    var k = Math.max(w / iw, h / ih), sw = w / k, sh = h / k;
    g.drawImage(img, (iw - sw) / 2, 0, sw, sh, 0, 0, w, h);
    var d = g.getImageData(0, 0, w, h), px = d.data, n = w * h, lum = new Float32Array(n), hist = new Uint32Array(256);
    for (var i = 0; i < n; i++){
      var l = 0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2];
      lum[i] = l; hist[l | 0]++;
    }
    /* stretch the 2nd..99th percentile over the whole range, then bend it
     * so the dark UIs' page colour stays near black instead of a screen */
    var lo = 0, hi = 255, acc = 0;
    for (var b = 0; b < 256; b++){ acc += hist[b]; if (acc < n * 0.02) lo = b; if (acc < n * 0.99) hi = b; }
    var greys = [0].concat((window.asciiField && window.asciiField.params.greys) || [123, 199, 255]), steps = greys.length - 1;
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++){
      var j = y * w + x, v = Math.pow(Math.max(0, Math.min(1, (lum[j] - lo) / Math.max(1, hi - lo))), 1.6) * steps;
      var base = Math.floor(v), lv = Math.min(steps, base + (v - base > (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16 ? 1 : 0));
      px[j * 4] = px[j * 4 + 1] = px[j * 4 + 2] = greys[lv]; px[j * 4 + 3] = 255;
    }
    g.putImageData(d, 0, 0);
    requestAnimationFrame(function(){ c.classList.add('ready'); });
  }
  var shots = document.querySelectorAll('.proj-shot img');
  var shotWatch = window.ResizeObserver ? new ResizeObserver(function(es){ es.forEach(function(e){ dither(e.target.querySelector('img')); }); }) : null;
  for (var si = 0; si < shots.length; si++){
    (function(img){
      img.addEventListener('load', function(){ dither(img); });
      if (shotWatch) shotWatch.observe(img.parentNode);
      if (img.complete) dither(img);
    })(shots[si]);
  }

  /* === ROUTER === */
  function scopeFor(id){
    return (id !== 'home' && document.getElementById(id)) || hero;
  }
  var current = null;
  function route(){
    var id = location.hash.slice(1) || 'home';
    var links = document.querySelectorAll('.nav-links a');
    for (var j = 0; j < links.length; j++){
      var href = links[j].getAttribute('href');
      links[j].classList.toggle('active', (id === 'home' && href === '#') || href === '#' + id);
    }
    var to = scopeFor(id);
    if (to === current) return;
    var from = current;
    current = to;
    if (!from || reduce){ clearTimeout(closing); show(to); return; }
    closeAndShow(from, to);
  }
  window.addEventListener('hashchange', route);

  /* === INIT ===
   * Text fades in once its faces have arrived, so the fallback font is
   * never seen swapping. Reading layout first makes the browser start
   * the font requests, which fonts.ready then waits for. The hero on
   * first load keeps 04's fade with the field rather than sweeping. */
  root.classList.add('no-sweep');
  if (scopeFor(location.hash.slice(1) || 'home') === hero){
    var lines = strata(hero);
    for (var s = 0; s < lines.length; s++) lines[s].classList.add('open');
  }
  void document.body.offsetWidth;
  requestAnimationFrame(function(){ requestAnimationFrame(function(){ root.classList.remove('no-sweep'); }); });
  document.fonts.ready.then(function(){
    root.classList.add('fonts-ready');
    route();
  });
})();
