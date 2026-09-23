(function(){
  'use strict';

  var nav = document.getElementById('nav');

  /* === SCROLLED NAV === */
  function updateNavScrolled(s){
    if (nav) nav.classList.toggle('scrolled', s > 60);
  }
  function bindActiveScroll(){
    var ap = document.querySelector('.page.active');
    if (ap){
      ap.addEventListener('scroll', function(){ updateNavScrolled(ap.scrollTop); });
    }
  }
  window.addEventListener('scroll', function(){ updateNavScrolled(window.scrollY); });
  var pageObs = new MutationObserver(function(){
    bindActiveScroll();
  });
  pageObs.observe(document.body, {attributes:true,subtree:true,attributeFilter:['class']});
  bindActiveScroll();

  /* === ROUTER === */
  function route(){
    var id = location.hash.slice(1) || 'home';
    document.body.classList.toggle('page-open', id !== 'home');
    var pages = document.querySelectorAll('.page');
    for (var i = 0; i < pages.length; i++) pages[i].classList.remove('active');
    if (id !== 'home'){
      var page = document.getElementById(id);
      if (page) { page.classList.add('active'); observeReveal(); }
    }
    var links = document.querySelectorAll('.nav-links a');
    for (var j = 0; j < links.length; j++){
      var href = links[j].getAttribute('href');
      var match = (id === 'home' && href === '#') || href === '#' + id;
      links[j].classList.toggle('active', match);
    }
  }
  window.addEventListener('hashchange', route);
  window.addEventListener('popstate', route);

  /* === SCROLL REVEAL === */
  var revealObserver = new IntersectionObserver(function(entries){
    entries.forEach(function(e){
      if (e.isIntersecting) { e.target.classList.add('revealed'); revealObserver.unobserve(e.target); }
    });
  }, {threshold:0.05});
  var revealTimer = 0;
  function observeReveal(){
    requestAnimationFrame(function(){
      var items = document.querySelectorAll('.tl-item:not(.revealed),.proj-card:not(.revealed),.skills-cat:not(.revealed)');
      for (var k = 0; k < items.length; k++) revealObserver.observe(items[k]);
      clearTimeout(revealTimer);
      revealTimer = setTimeout(function(){
        var stuck = document.querySelectorAll('.tl-item:not(.revealed),.proj-card:not(.revealed),.skills-cat:not(.revealed)');
        for (var s = 0; s < stuck.length; s++) stuck[s].classList.add('revealed');
      }, 1500);
    });
  }

  /* === INIT === */
  route();

  /* Text fades in once its faces have arrived, so the fallback font is
   * never seen swapping. Reading layout first makes the browser start
   * the font requests, which fonts.ready then waits for. */
  void document.body.offsetWidth;
  document.fonts.ready.then(function(){ document.documentElement.classList.add('fonts-ready'); });
})();
