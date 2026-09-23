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
    clearTimeout(scope.closingTimer);
    scope.classList.remove('closing');
    var isHero = scope === hero;
    document.body.classList.toggle('page-open', !isHero);
    var pages = document.querySelectorAll('.page');
    for (var i = 0; i < pages.length; i++) pages[i].classList.toggle('active', pages[i] === scope);
    scope.scrollTop = 0;
    var els = strata(scope);
    for (var k = 0; k < els.length; k++) reveal.observe(els[k]);
  }

  /* The old route's open blocks on screen close, last first, and the
   * new route starts opening while they do: as soon as the last old
   * block starts closing. New text trails its holes by --lag, longer
   * than old text takes to wipe out (--shut), so the two never share the
   * screen. The old route stays
   * on screen as .closing, not clickable, until its holes are gone. A
   * route change during a close cuts it short. */
  var opening = 0;
  function closeAndShow(from, to){
    clearTimeout(opening);
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
    /* the slowest block sets how long the old route stays on screen */
    var shut = 140, tail = (vis.length - 1) * 30;
    for (var s = 0; s < vis.length; s++) shut = Math.max(shut, parseFloat(getComputedStyle(vis[s]).getPropertyValue('--shut')) * 1000 || 0);
    if (!vis.length){ show(to); return; }
    from.classList.add('closing');
    clearTimeout(from.closingTimer);
    from.closingTimer = setTimeout(function(){ from.classList.remove('closing'); }, shut * 1.2 + tail + 50);
    opening = setTimeout(function(){ show(to); }, tail);
  }

  /* === SCREENSHOT DITHER ===
   * Each project screenshot gets a copy of itself on top, drawn through
   * the #field-dither SVG filter in index.html: the field's own greys
   * plus black, ordered-dithered at 1px dots, so the plate is made of the
   * same stuff as the field. The plain greyscale image stays underneath
   * (it carries the alt text); hovering or focusing the link fades the
   * copy off it. An SVG filter rather than a canvas, because privacy
   * browsers (LibreWolf) blank canvas pixel reads. */
  var shots = document.querySelectorAll('.proj-shot img');
  for (var si = 0; si < shots.length; si++){
    var copy = shots[si].cloneNode();
    copy.className = 'proj-dither';
    copy.alt = '';
    copy.setAttribute('aria-hidden', 'true');
    copy.removeAttribute('onerror');
    shots[si].after(copy);
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
    if (!from || reduce){ clearTimeout(opening); show(to); return; }
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
