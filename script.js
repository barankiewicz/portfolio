(function(){
  'use strict';

  var html = document.documentElement;
  var toggle = document.getElementById('themeToggle');
  var themeIcon = toggle ? toggle.querySelector('.theme-icon') : null;
  var nav = document.getElementById('nav');

  /* === THEME === */
  var stored = localStorage.getItem('theme');
  if (!stored) {
    var sysPrefers = window.matchMedia('(prefers-color-scheme: dark)');
    html.setAttribute('data-theme', sysPrefers.matches ? 'dark' : 'light');
    sysPrefers.addEventListener('change', function(e){
      if (!localStorage.getItem('theme')) {
        html.setAttribute('data-theme', e.matches ? 'dark' : 'light');
        updateThemeUI();
        if (typeof onThemeChangeForBg === 'function') onThemeChangeForBg();
      }
    });
  }
  function updateThemeUI(){
    var isDark = html.getAttribute('data-theme') === 'dark';
    if (toggle) toggle.setAttribute('aria-pressed', String(isDark));
    if (themeIcon) themeIcon.innerHTML = isDark ? '&#9790;' : '&#9788;';
  }
  updateThemeUI();
  toggle.addEventListener('click', function(){
    var next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    updateThemeUI();
    if (!themeLocked){
      html.style.setProperty('--hero-accent', next === 'dark' ? heroAccentDark : heroAccentLight);
    }
    if (typeof onThemeChangeForBg === 'function') onThemeChangeForBg();
  });

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

  /* === HERO ACCENT COLOR === */
  var heroColorsAttr = null;
  var portTrack = document.querySelector('.portfolio-track');
  if (portTrack){
    heroColorsAttr = portTrack.getAttribute('data-hero-colors');
  }
  if (!heroColorsAttr){
    heroColorsAttr = '#1565C0,#E65100,#2E7D32,#D32F2F,#6A1B9A,#00838F,#C2185B';
  }
  var heroColors = heroColorsAttr.split(',');
  var heroAccentDark = '#C62828';
  var heroAccentLight = '#00838F';
  var isDark = html.getAttribute('data-theme') === 'dark';
  html.style.setProperty('--hero-accent', isDark ? heroAccentDark : heroAccentLight);
  var hueAccent;{
    var tmp = html.style.getPropertyValue('--hero-accent').trim();
    if (tmp && tmp.charAt(0) === '#' && tmp.length === 7){
      var r = parseInt(tmp.slice(1,3),16);
      var g = parseInt(tmp.slice(3,5),16);
      var b = parseInt(tmp.slice(5,7),16);
      r /= 255; g /= 255; b /= 255;
      var max = Math.max(r,g,b), min = Math.min(r,g,b), d = max - min;
      if (d !== 0){
        var h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) :
                max === g ? ((b - r) / d + 2) :
                ((r - g) / d + 4);
        hueAccent = h * 60;
      } else { hueAccent = 0; }
    } else { hueAccent = Math.random() * 360; }
  }

  /* === ANIMATION === */
  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', function(e){
    reducedMotion = e.matches;
    if (reducedMotion) {
      if (animId) { cancelAnimationFrame(animId); animId = 0; }
    } else {
      lastTime = performance.now();
      animId = requestAnimationFrame(animationLoop);
    }
  });
  var animId = 0;
  var portTrack, portCopy, marqueeTrack, marqueeCopy;
  var portCopyW = 0, marqueeCopyW = 0;
  var portOffset = 0, marqueeOffset = 0;
  var portOx = 0, nameOx = 0, subOx = 0;
  var portOy = 0;
  var skewPaused = false;
  var lastTime = 0;
  var PORT_SPEED = 15;
  var MARQUEE_SPEED = 9;
  var grainFrame = 0;
  var currentGrainSize = 384;
  var currentCoarseSize = 512;

  function initAnimRefs(){
    portTrack = document.querySelector('.portfolio-track');
    if (portTrack){
      portCopy = portTrack.querySelector('span');
      if (portCopy) portCopyW = portCopy.offsetWidth;
    }
    marqueeTrack = document.querySelector('.marquee-track');
    if (marqueeTrack){
      marqueeCopy = marqueeTrack.querySelector('.hero-name');
      if (marqueeCopy) marqueeCopyW = marqueeCopy.offsetWidth;
    }
    if (reducedMotion) return;
    if (portCopyW) portOffset = -(portCopyW * 0.4);
    if (marqueeCopyW) marqueeOffset = -(marqueeCopyW * 0.4);
    lastTime = performance.now();
    animId = requestAnimationFrame(animationLoop);
  }

  function remeasure(){
    if (portTrack && portCopy) portCopyW = portCopy.offsetWidth;
    if (marqueeTrack && marqueeCopy) marqueeCopyW = marqueeCopy.offsetWidth;
  }
  window.addEventListener('resize', remeasure);

  function animationLoop(now){
    var dt = lastTime ? (now - lastTime) / 1000 : 0;
    lastTime = now;

    var hidden = document.hidden || reducedMotion;
    var pageOpen = document.body.classList.contains('page-open');

    if (!hidden){
      if (!skewPaused){
      portOffset += PORT_SPEED * dt;
      if (portCopyW && portOffset > portCopyW) portOffset -= portCopyW;
      }
      if (portTrack) portTrack.style.transform = 'translateX(' + (portOffset + portOx) + 'px) translateY(' + portOy + 'px)';

      if (!skewPaused){
      marqueeOffset -= MARQUEE_SPEED * dt;
      if (marqueeCopyW && marqueeOffset < -marqueeCopyW) marqueeOffset += marqueeCopyW;
      }
      if (marqueeTrack) marqueeTrack.style.transform = 'translateX(' + (marqueeOffset + nameOx) + 'px)';

      hueAccent += 8 * dt;
      if (hueAccent > 360) hueAccent -= 360;
      if (!pageOpen && !themeLocked){
        var cur = html.getAttribute('data-theme') === 'dark' ? heroAccentDark : heroAccentLight;
        html.style.setProperty('--hero-accent', cur);
      }

      grainFrame++;
    }

    animId = requestAnimationFrame(animationLoop);
  }

  /* === VIDEO PING-PONG === */
  (function(){
    var vf = document.querySelector('.hero-video:not(.hero-video--rev)');
    var vr = document.querySelector('.hero-video--rev');
    if (!vf || !vr) return;
    vf.muted = vr.muted = true;
    vf.defaultMuted = vr.defaultMuted = true;
    vf.setAttribute('muted','');
    vr.setAttribute('muted','');
    vf.loop = vr.loop = false;

    function play(v){ v.play().catch(function(){}); }

    vr.load();
    vr.addEventListener('canplay', function(){
      vr.ready = true;
    }, {once:true});

    vf.addEventListener('ended', function(){
      vf.style.opacity = '0';
      vf.style.pointerEvents = 'none';
      vr.style.opacity = '1';
      vr.style.pointerEvents = 'auto';
      vr.currentTime = 0;
      play(vr);
    });
    vr.addEventListener('ended', function(){
      vr.style.opacity = '0';
      vr.style.pointerEvents = 'none';
      vf.style.opacity = '1';
      vf.style.pointerEvents = 'auto';
      vf.currentTime = 0;
      play(vf);
    });

    function autoplay(v){
      play(v);
      v.addEventListener('canplay', function(){ play(v); }, {once:true});
    }
    autoplay(vf);
    setTimeout(function(){ play(vf); }, 100);
    setTimeout(function(){ play(vf); }, 500);
    var events = ['click','touchstart','scroll','keydown'];
    events.forEach(function(e){
      document.addEventListener(e, function(){ play(vf); }, {once:true});
    });
  })();

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

  /* === SKEW PANEL === */
  var panel = document.getElementById('skewPanel');
  var toggleBtn = document.getElementById('skewToggle');
  var defaults = {p:1590, y:-10.5, rx:3.5, rz:-4, z:-82, axis:'0,100', tx:90, ty:90, pox:1500, poy:161, nox:-91, sox:0};
  var sliderDefs = [
    {id:'skewP',  valId:'skewPVal',  prop:'--skew-p',  unit:'px',   fmt:'px',   key:'p'},
    {id:'skewY',  valId:'skewYVal',  prop:'--skew-y',  unit:'deg',  fmt:'&deg;', key:'y'},
    {id:'skewRX', valId:'skewRXVal', prop:'--skew-rx', unit:'deg',  fmt:'&deg;', key:'rx'},
    {id:'skewRZ', valId:'skewRZVal', prop:'--skew-rz', unit:'deg',  fmt:'&deg;', key:'rz'},
    {id:'skewZ',  valId:'skewZVal',  prop:'--skew-z',  unit:'px',   fmt:'px',   key:'z'},
    {id:'skewTX', valId:'skewTXVal', prop:'--skew-tx', unit:'px',   fmt:'px',   key:'tx'},
    {id:'skewTY', valId:'skewTYVal', prop:'--skew-ty', unit:'px',   fmt:'px',   key:'ty'},
  ];
  var textSliders = [
    {id:'skewPO',  valId:'skewPOVal',  fmt:'px', key:'pox',  set:function(v){portOx=v;}},
    {id:'skewPOY', valId:'skewPOYVal', fmt:'px', key:'poy',  set:function(v){portOy=v;}},
    {id:'skewNO',  valId:'skewNOVal',  fmt:'px', key:'nox',  set:function(v){nameOx=v;}},
    {id:'skewSO',  valId:'skewSOVal',  fmt:'px', key:'sox',  set:function(v){subOx=v;}},
  ];

  function readSkew(){
    try { return JSON.parse(localStorage.getItem('skew') || '{}'); } catch(e){ return {}; }
  }
  function saveSkew(o){ localStorage.setItem('skew', JSON.stringify(o)); }

  function applySkew(o){
    for (var i = 0; i < sliderDefs.length; i++){
      var sd = sliderDefs[i];
      html.style.setProperty(sd.prop, o[sd.key] + sd.unit);
      var el = document.getElementById(sd.id);
      var vel = document.getElementById(sd.valId);
      if (el) el.value = o[sd.key];
      if (vel) vel.innerHTML = o[sd.key] + sd.fmt;
      updateSliderLabel(sd.id, o[sd.key]);
    }
    if (o.axis){
      var parts = o.axis.split(',');
      html.style.setProperty('--skew-ox', parts[0] + '%');
      html.style.setProperty('--skew-oy', parts[1] + '%');
      var axisEl = document.getElementById('skewAxis');
      if (axisEl) axisEl.value = o.axis;
    }
    for (var j = 0; j < textSliders.length; j++){
      var ts = textSliders[j];
      ts.set(o[ts.key]);
      var tel = document.getElementById(ts.id);
      var tvel = document.getElementById(ts.valId);
      if (tel) tel.value = o[ts.key];
      if (tvel) tvel.textContent = o[ts.key] + ts.fmt;
      updateSliderLabel(ts.id, o[ts.key]);
    }
  }

  function skewFromStorage(){
    var s = readSkew();
    var o = {};
    var allKeys = sliderDefs.concat(textSliders);
    for (var i = 0; i < allKeys.length; i++){
      var k = allKeys[i].key;
      o[k] = s[k] != null ? s[k] : defaults[k];
    }
    o.axis = s.axis || defaults.axis;
    applySkew(o);
  }
  skewFromStorage();

  function bindSlider(sd, onSet){
    var el = document.getElementById(sd.id);
    if (!el) return;
    el.addEventListener('input', function(){
      var v = this.valueAsNumber;
      sd.set ? sd.set(v) : html.style.setProperty(sd.prop, v + sd.unit);
      var vel = document.getElementById(sd.valId);
      if (vel) vel.innerHTML = v + sd.fmt;
      updateSliderLabel(sd.id, v);
      var s = readSkew(); s[sd.key] = v; saveSkew(s);
    });
  }

  for (var i = 0; i < sliderDefs.length; i++) bindSlider(sliderDefs[i]);
  for (var j = 0; j < textSliders.length; j++) bindSlider(textSliders[j]);

  if (toggleBtn && panel){
    toggleBtn.addEventListener('click', function(){
      var open = panel.classList.toggle('open');
      toggleBtn.classList.toggle('hidden', open);
    });
    panel.addEventListener('keydown', function(e){
      if (e.key === 'Escape'){
        panel.classList.remove('open');
        toggleBtn.classList.remove('hidden');
      }
    });
    (function(){
      var buffer = '';
      window.addEventListener('keydown', function(e){
        var t = e.target.tagName;
        if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT') return;
        buffer += e.key.toLowerCase();
        if (buffer.length > 4) buffer = buffer.slice(-4);
        if (buffer === 'data') {
          toggleBtn.style.display = 'flex';
          toggleBtn.click();
          buffer = '';
        }
      });
    })();
  }
  var resetBtn = document.getElementById('skewReset');
  if (resetBtn) resetBtn.addEventListener('click', function(){
    var o = {};
    for (var k in defaults) o[k] = defaults[k];
    for (var vk in vdefs) o[vk] = vdefs[vk];
    applySkew(o);
    applyVid(o);
    setPreset('off');
    applyColorTheme('crimson');
    applyNavFont('swiss');
    setBgPreset('sage');
    document.getElementById('vigLt').value = 0.35;
    document.getElementById('vigDk').value = 0.45;
    applyVignette();
    updateSliderLabel('vigLt', 0.35);
    updateSliderLabel('vigDk', 0.45);
    localStorage.removeItem('skew');
    localStorage.removeItem('grain');
    localStorage.removeItem('grainPreset');
    localStorage.removeItem('vig');
    localStorage.removeItem('bgPresetLight');
    localStorage.removeItem('bgPresetDark');
    localStorage.removeItem('bgCustomColorLight');
    localStorage.removeItem('bgCustomColorDark');
    setBgPreset('sage', false);
  });
  var axisSel = document.getElementById('skewAxis');
  if (axisSel){
    axisSel.addEventListener('change', function(){
      var v = this.value;
      var parts = v.split(',');
      html.style.setProperty('--skew-ox', parts[0] + '%');
      html.style.setProperty('--skew-oy', parts[1] + '%');
      var s = readSkew(); s.axis = v; saveSkew(s);
    });
  }

  /* === VIDEO CONTROLS === */
  var vdefs = {vx:0, vy:611, vs:1.1};
  var vidSliders = [
    {id:'vidX', valId:'vidXVal', prop:'--vid-x', unit:'px', fmt:'px', key:'vx'},
    {id:'vidY', valId:'vidYVal', prop:'--vid-y', unit:'px', fmt:'px', key:'vy'},
    {id:'vidS', valId:'vidSVal', prop:'--vid-s', unit:'',   fmt:'',   key:'vs'},
  ];
  function applyVid(o){
    for (var i = 0; i < vidSliders.length; i++){
      var vs = vidSliders[i];
      html.style.setProperty(vs.prop, o[vs.key] + vs.unit);
      var el = document.getElementById(vs.id);
      var vel = document.getElementById(vs.valId);
      if (el) el.value = o[vs.key];
      if (vel) vel.textContent = vs.fmt ? o[vs.key] + vs.fmt : Number(o[vs.key]).toFixed(2);
      updateSliderLabel(vs.id, o[vs.key]);
    }
  }
  function vidFromStorage(){
    var s = readSkew();
    var o = {};
    for (var i = 0; i < vidSliders.length; i++){
      var k = vidSliders[i].key;
      o[k] = s[k] != null ? s[k] : vdefs[k];
    }
    applyVid(o);
  }
  vidFromStorage();
  for (var m = 0; m < vidSliders.length; m++){
    (function(vs){
      var el = document.getElementById(vs.id);
      if (!el) return;
      el.addEventListener('input', function(){
        var v = this.valueAsNumber;
        html.style.setProperty(vs.prop, v + vs.unit);
        var vel = document.getElementById(vs.valId);
        if (vel) vel.textContent = vs.fmt ? v + vs.fmt : v.toFixed(2);
        updateSliderLabel(vs.id, v);
        var s = readSkew(); s[vs.key] = v; saveSkew(s);
      });
    })(vidSliders[m]);
  }

  /* === GRAIN PRESETS === */
  var grainPresets = {
    off:    {opacity:0,    size:256, coarseOpacity:0,     coarseSize:256, washOpacity:0,    washTint:0},
    dust:   {opacity:0.04, size:256, coarseOpacity:0.015, coarseSize:256, washOpacity:0.01, washTint:0.03},
    grain:  {opacity:0.08, size:384, coarseOpacity:0.04,  coarseSize:512, washOpacity:0.02, washTint:0.05},
    heavy:  {opacity:0.12, size:256, coarseOpacity:0.07,  coarseSize:512, washOpacity:0.03, washTint:0.07},
    cinema: {opacity:0.10, size:384, coarseOpacity:0.06,  coarseSize:640, washOpacity:0.03, washTint:0.06},
    noir:   {opacity:0.08, size:384, coarseOpacity:0.09,  coarseSize:768, washOpacity:0.05, washTint:0.10},
    warm:   {opacity:0.06, size:384, coarseOpacity:0.03,  coarseSize:512, washOpacity:0.06, washTint:0.12},
    frost:  {opacity:0.05, size:512, coarseOpacity:0.02,  coarseSize:384, washOpacity:0.02, washTint:0.04},
    rough:  {opacity:0.04, size:256, coarseOpacity:0.11,  coarseSize:1024,washOpacity:0.01, washTint:0.03},
    atmos:  {opacity:0.03, size:512, coarseOpacity:0.02,  coarseSize:512, washOpacity:0.09, washTint:0.16},
  };
  var activePreset = localStorage.getItem('grainPreset') || 'off';
  var grainCanvas = document.querySelector('.film-grain');
  var grainCtx = grainCanvas ? grainCanvas.getContext('2d') : null;
  var grainCoarse = document.querySelector('.film-grain-coarse');
  var grainCoarseCtx = grainCoarse ? grainCoarse.getContext('2d') : null;
  var grainWash = document.querySelector('.film-grain-wash');
  var grainWashCtx = grainWash ? grainWash.getContext('2d') : null;
  var grainTint = 0.05;
  var grainDefaults = grainPresets[activePreset] || grainPresets.off;

  function fillNoise(ctx, w, h){
    var img = ctx.createImageData(w, h);
    for (var i = 0; i < img.data.length; i += 4){
      var v = Math.floor(Math.random() * 256);
      img.data[i] = v;
      img.data[i+1] = v;
      img.data[i+2] = v;
      img.data[i+3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }

  function drawGrain(size){
    if (!grainCtx || size <= 0) return;
    currentGrainSize = size;
    grainCanvas.width = size;
    grainCanvas.height = size;
    fillNoise(grainCtx, size, size);
  }

  function drawGrainCoarse(size){
    if (!grainCoarseCtx || size <= 0) return;
    currentCoarseSize = size;
    grainCoarse.width = size;
    grainCoarse.height = size;
    fillNoise(grainCoarseCtx, size, size);
  }

  var washCounter = -1;
  function drawWash(tint, force){
    if (!grainWashCtx || tint <= 0) return;
    if (!force){
      washCounter++;
      if (washCounter < 120) return;
    }
    washCounter = 0;
    var s = 32;
    grainWash.width = s;
    grainWash.height = s;
    var c = html.style.getPropertyValue('--hero-accent').trim();
    if (!c || c.charAt(0)!=='#') c = '#D32F2F';
    grainWashCtx.fillStyle = c;
    grainWashCtx.globalAlpha = tint;
    grainWashCtx.fillRect(0, 0, s, s);
    grainWashCtx.globalAlpha = 1;
  }

  function applyGrain(o){
    html.style.setProperty('--grain-opacity', o.opacity);
    html.style.setProperty('--grain-coarse-opacity', o.coarseOpacity);
    html.style.setProperty('--grain-wash-opacity', o.washOpacity);
    grainTint = o.washTint;
    grainDefaults = o;
    drawGrain(o.size);
    drawGrainCoarse(o.coarseSize);
    drawWash(grainTint, true);
  }

  function applyGrainLive(){
    var o = {
      opacity: +document.getElementById('grainOp').value,
      size: +document.getElementById('grainSz').value,
      coarseOpacity: +document.getElementById('coarseOp').value,
      coarseSize: +document.getElementById('coarseSz').value,
      washOpacity: +document.getElementById('washOp').value,
      washTint: +document.getElementById('washTint').value,
    };
    applyGrain(o);
  }

  function syncPanelUI(o){
    var el;
    if ((el = document.getElementById('grainOp'))) el.value = o.opacity;
    if ((el = document.getElementById('grainSz'))) el.value = o.size;
    if ((el = document.getElementById('coarseOp'))) el.value = o.coarseOpacity;
    if ((el = document.getElementById('coarseSz'))) el.value = o.coarseSize;
    if ((el = document.getElementById('washOp'))) el.value = o.washOpacity;
    if ((el = document.getElementById('washTint'))) el.value = o.washTint;
    updateGrainLabels(o);
  }

  function updateGrainLabels(o){
    var s;
    if ((s = document.getElementById('fvGrainOp'))) s.textContent = Number(o.opacity).toFixed(3);
    if ((s = document.getElementById('fvGrainSz'))) s.textContent = o.size;
    if ((s = document.getElementById('fvCoarseOp'))) s.textContent = Number(o.coarseOpacity).toFixed(3);
    if ((s = document.getElementById('fvCoarseSz'))) s.textContent = o.coarseSize;
    if ((s = document.getElementById('fvWashOp'))) s.textContent = Number(o.washOpacity).toFixed(3);
    if ((s = document.getElementById('fvWashTint'))) s.textContent = Number(o.washTint).toFixed(2);
  }

  function updateSliderLabel(id, v){
    var map = {
      grainOp:'fvGrainOp',grainSz:'fvGrainSz',coarseOp:'fvCoarseOp',coarseSz:'fvCoarseSz',
      washOp:'fvWashOp',washTint:'fvWashTint',vigLt:'fvVigLt',vigDk:'fvVigDk',
      skewP:'fvSkewP',skewY:'fvSkewY',skewRX:'fvSkewRX',skewRZ:'fvSkewRZ',skewZ:'fvSkewZ',
      skewTX:'fvSkewTX',skewTY:'fvSkewTY',skewPO:'fvSkewPO',skewPOY:'fvSkewPOY',skewNO:'fvSkewNO',
      vidX:'fvVidX',vidY:'fvVidY',vidS:'fvVidS'
    };
    var sid = map[id]; if (!sid) return;
    var span = document.getElementById(sid); if (!span) return;
    if (id === 'vidS' || id === 'washTint') span.textContent = Number(v).toFixed(2);
    else if (id.indexOf('Op') > -1 || id === 'vigLt' || id === 'vigDk') span.textContent = Number(v).toFixed(3);
    else span.textContent = v;
  }

  applyGrain(grainDefaults);
  syncPanelUI(grainDefaults);

  ['grainOp','grainSz','coarseOp','coarseSz','washOp','washTint'].forEach(function(id){
    var el = document.getElementById(id); if (!el) return;
    el.addEventListener('input', function(){
      updateSliderLabel(id, this.value);
      applyGrainLive();
    });
  });

  function applyVignette(){
    var vl = +document.getElementById('vigLt').value;
    var vd = +document.getElementById('vigDk').value;
    var cur = html.getAttribute('data-theme') === 'dark' ? vd : vl;
    html.style.setProperty('--vignette-alpha', cur);
  }
  ['vigLt','vigDk'].forEach(function(id){
    var el = document.getElementById(id); if (!el) return;
    el.addEventListener('input', function(){
      updateSliderLabel(id, this.value);
      applyVignette();
    });
  });

  var themeObserver = new MutationObserver(function(){ applyVignette(); });
  themeObserver.observe(html, {attributes:true, attributeFilter:['data-theme']});

  function setPreset(name){
    activePreset = name;
    localStorage.setItem('grainPreset', name);
    var p = grainPresets[name];
    if (!p) return;
    applyGrain(p);
    syncPanelUI(p);
    var btns = document.querySelectorAll('[data-preset]');
    for (var b = 0; b < btns.length; b++){
      btns[b].classList.toggle('active', btns[b].getAttribute('data-preset') === name);
    }
  }

  document.querySelector('.skew-panel').addEventListener('click', function(e){
    var btn = e.target.closest('[data-preset]');
    if (btn) { setPreset(btn.getAttribute('data-preset')); return; }
    btn = e.target.closest('[data-navfont]');
    if (btn) { applyNavFont(btn.getAttribute('data-navfont')); return; }
    btn = e.target.closest('[data-theme]');
    if (btn) { applyColorTheme(btn.getAttribute('data-theme')); return; }
  });
  window.addEventListener('resize', function(){
    drawGrain(grainDefaults.size);
    drawGrainCoarse(grainDefaults.coarseSize);
    drawWash(grainTint, true);
  });

  /* === EXPORT CONFIG === */
  var exportBtn = document.getElementById('skewExport');
  if (exportBtn) exportBtn.addEventListener('click', function(){
    var out = {
      grain: {
        opacity: +document.getElementById('grainOp').value,
        size: +document.getElementById('grainSz').value,
        coarseOpacity: +document.getElementById('coarseOp').value,
        coarseSize: +document.getElementById('coarseSz').value,
        washOpacity: +document.getElementById('washOp').value,
        washTint: +document.getElementById('washTint').value,
      },
      vignette: {light:+document.getElementById('vigLt').value, dark:+document.getElementById('vigDk').value},
      skew: readSkew(),
      grainPreset: activePreset,
      navFont: activeNavFont,
      colorTheme: activeTheme,
    };
    var json = JSON.stringify(out, null, 2);
    if (navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(json).then(function(){
        var btn = document.getElementById('skewExport');
        if (btn){ btn.textContent = 'Copied!'; btn.classList.add('copied');
          setTimeout(function(){ btn.textContent = 'Export'; btn.classList.remove('copied'); }, 1500);
        }
      });
    }
  });

  /* === HERO FONT === */
  var heroFonts = [
    {name:'Oswald',          family:'Oswald',          weight:'700'},
    {name:'Anton',           family:'Anton',           weight:'400'},
    {name:'Bebas Neue',      family:'Bebas Neue',      weight:'400'},
    {name:'Archivo Black',   family:'Archivo Black',   weight:'400'},
    {name:'Abril Fatface',   family:'Abril Fatface',   weight:'400'},
    {name:'Righteous',       family:'Righteous',       weight:'400'},
    {name:'Monoton',         family:'Monoton',         weight:'400'},
    {name:'Rubik Mono One',  family:'Rubik Mono One',  weight:'400'},
    {name:'Space Grotesk',   family:'Space Grotesk',   weight:'700'},
    {name:'Syne',            family:'Syne',            weight:'800'},
    {name:'Antonio',         family:'Antonio',         weight:'700'},
    {name:'Teko',            family:'Teko',            weight:'700'},
    {name:'Russo One',       family:'Russo One',       weight:'400'},
    {name:'Orbitron',        family:'Orbitron',        weight:'900'},
    {name:'Poppins',         family:'Poppins',         weight:'900'},
    {name:'DM Serif Display',family:'DM Serif Display',weight:'400'},
    {name:'Chakra Petch',    family:'Chakra Petch',    weight:'700'},
    {name:'Black Ops One',   family:'Black Ops One',   weight:'400'},
    {name:'Playfair Display',family:'Playfair Display',weight:'900'},
    {name:'Cormorant Garamond',family:'Cormorant Garamond',weight:'700'},
  ];
  var fontSel = document.getElementById('heroFont');
  if (fontSel){
    for (var fi = 0; fi < heroFonts.length; fi++){
      var f = heroFonts[fi];
      var opt = document.createElement('option');
      opt.value = f.family;
      opt.textContent = f.name;
      fontSel.appendChild(opt);
    }
    fontSel.addEventListener('change', function(){
      var f = heroFonts[this.selectedIndex];
      loadFont(f);
      html.style.setProperty('--hero-font', '"' + f.family + '"');
      localStorage.setItem('heroFont', JSON.stringify({family:f.family,weight:f.weight}));
    });
    var savedFont;
    try { savedFont = JSON.parse(localStorage.getItem('heroFont')); } catch(e){}
    if (savedFont && savedFont.family){
      html.style.setProperty('--hero-font', '"' + savedFont.family + '"');
      fontSel.value = savedFont.family;
      for (var fj = 0; fj < heroFonts.length; fj++){
        if (heroFonts[fj].family === savedFont.family){ loadFont(heroFonts[fj]); break; }
      }
    }
  }
  function loadFont(f){
    var id = 'gf-' + f.family.replace(/\s+/g,'-');
    if (document.getElementById(id)) return;
    var link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=' + encodeURIComponent(f.family) + ':wght@' + f.weight + '&display=swap';
    document.head.appendChild(link);
  }

  /* === COLOR THEME === */
  var colorThemes = {
    crimson:  '#D32F2F',
    cobalt:   '#1565C0',
    ochre:    '#E65100',
    emerald:  '#2E7D32',
    amethyst: '#6A1B9A',
    teal:     '#00838F',
    magenta:  '#C2185B',
  };
  var activeTheme = localStorage.getItem('colorTheme') || 'crimson';
  var themeLocked = activeTheme !== 'auto';

  function applyColorTheme(name, save){
    activeTheme = name;
    themeLocked = name !== 'auto';
    if (themeLocked && colorThemes[name]){
      var c = colorThemes[name];
      html.style.setProperty('--hero-accent', c);
      html.style.setProperty('--accent', c);
    }
    if (!themeLocked && typeof hueAccent !== 'undefined'){
      var isDark = html.getAttribute('data-theme') === 'dark';
      html.style.setProperty('--hero-accent', isDark ? heroAccentDark : heroAccentLight);
      html.style.setProperty('--accent', null);
    }
    if (save !== false) localStorage.setItem('colorTheme', name);
    var swatches = document.querySelectorAll('.theme-swatch');
    for (var si = 0; si < swatches.length; si++){
      var match = swatches[si].getAttribute('data-theme') === name;
      swatches[si].classList.toggle('active', match);
      swatches[si].setAttribute('aria-checked', String(match));
    }
  }

  if (themeLocked) applyColorTheme(activeTheme, false);

  /* === BACKGROUND COLOR === */
  var bgPresets = {
    sage:     {bg:'#C8D5CD', surface:'#D4DFD7', surface2:'#C0CDC5', cvSurface:'#BCC9C1', border:'#A8B5AD'},
    cream:    {bg:'#F5F0E8', surface:'#FBF8F3', surface2:'#EDE6D9', cvSurface:'#E8E0D2', border:'#D5CCC0'},
    white:    {bg:'#F8F8F8', surface:'#FEFEFE', surface2:'#F0F0F0', cvSurface:'#ECECEC', border:'#DDDDDD'},
    gray:     {bg:'#D5D8DC', surface:'#DFE2E5', surface2:'#CACDD2', cvSurface:'#C4C8CD', border:'#B0B5BB'},
    charcoal: {bg:'#0C0A08', surface:'#13110E', surface2:'#1A1714', cvSurface:'#1E1B17', border:'#2A2520'},
    navy:     {bg:'#0D1117', surface:'#161B22', surface2:'#1C2128', cvSurface:'#21262D', border:'#30363D'},
  };

  function hexToHsl(hex){
    var r = parseInt(hex.slice(1,3),16)/255;
    var g = parseInt(hex.slice(3,5),16)/255;
    var b = parseInt(hex.slice(5,7),16)/255;
    var max = Math.max(r,g,b), min = Math.min(r,g,b), d = max - min;
    var h = 0, s = 0, l = (max + min) / 2;
    if (d !== 0){
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) :
          max === g ? ((b - r) / d + 2) :
          ((r - g) / d + 4);
      h *= 60;
    }
    return {h:h, s:s*100, l:l*100};
  }

  function hslToHex(h, s, l){
    s /= 100; l /= 100;
    var a = s * Math.min(l, 1 - l);
    var f = function(n){
      var k = (n + h / 30) % 12;
      return l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    };
    var toHex = function(x){ return Math.round(x*255).toString(16).padStart(2,'0'); };
    return '#' + toHex(f(0)) + toHex(f(8)) + toHex(f(4));
  }

  function deriveSurfaces(hex){
    var hsl = hexToHsl(hex);
    var lighten = Math.min(hsl.l + 4, 95);
    var darken1 = Math.max(hsl.l - 3, 3);
    var darken2 = Math.max(hsl.l - 5, 2);
    var borderDarken = Math.max(hsl.l - 12, 1);
    return {
      bg: hex,
      surface: hslToHex(hsl.h, hsl.s, lighten),
      surface2: hslToHex(hsl.h, hsl.s, darken1),
      cvSurface: hslToHex(hsl.h, hsl.s, darken2),
      border: hslToHex(hsl.h, hsl.s, borderDarken),
    };
  }

  function bgStorageKey(){ return html.getAttribute('data-theme') === 'dark' ? 'bgPresetDark' : 'bgPresetLight'; }
  function bgCustomKey(){ return html.getAttribute('data-theme') === 'dark' ? 'bgCustomColorDark' : 'bgCustomColorLight'; }
  function bgDefaultPreset(){ return html.getAttribute('data-theme') === 'dark' ? 'charcoal' : 'sage'; }

  function applyBg(colors){
    html.style.setProperty('--bg', colors.bg);
    html.style.setProperty('--surface', colors.surface);
    html.style.setProperty('--surface-2', colors.surface2);
    html.style.setProperty('--cv-surface', colors.cvSurface);
    html.style.setProperty('--border', colors.border);
  }

  function setBgPreset(name, save){
    if (save !== false) localStorage.setItem(bgStorageKey(), name);
    var colors;
    if (name === 'custom'){
      var customHex = localStorage.getItem(bgCustomKey()) || '#C8D5CD';
      colors = deriveSurfaces(customHex);
      document.getElementById('bgCustomColor').value = customHex;
      document.getElementById('bgCustomColor').style.display = 'block';
    } else {
      document.getElementById('bgCustomColor').style.display = 'none';
      colors = bgPresets[name] || bgPresets[bgDefaultPreset()];
    }
    applyBg(colors);
    var btns = document.querySelectorAll('[data-bg]');
    for (var bi = 0; bi < btns.length; bi++){
      btns[bi].classList.toggle('active', btns[bi].getAttribute('data-bg') === name);
    }
    var label = document.getElementById('bgLabel');
    if (label) label.textContent = 'Background (' + (html.getAttribute('data-theme')==='dark'?'Dark':'Light') + ')';
  }

  function refreshBgUI(){
    var name = localStorage.getItem(bgStorageKey()) || bgDefaultPreset();
    setBgPreset(name, false);
  }

  refreshBgUI();

  function onThemeChangeForBg(){
    refreshBgUI();
  }

  var bgCustomInput = document.getElementById('bgCustomColor');
  if (bgCustomInput){
    bgCustomInput.addEventListener('input', function(){
      var hex = this.value;
      localStorage.setItem(bgCustomKey(), hex);
      applyBg(deriveSurfaces(hex));
    });
  }

  var panelEl = document.querySelector('.skew-panel');
  panelEl.addEventListener('click', function(e){
    var btn = e.target.closest('[data-bg]');
    if (btn) { setBgPreset(btn.getAttribute('data-bg')); }
  });

  var swatchGroup = document.querySelector('.theme-swatches');
  if (swatchGroup){
    swatchGroup.addEventListener('click', function(e){
      var btn = e.target.closest('.theme-swatch');
      if (!btn) return;
      applyColorTheme(btn.getAttribute('data-theme'));
    });
    swatchGroup.addEventListener('keydown', function(e){
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown'){
        e.preventDefault();
        var btns = Array.from(swatchGroup.querySelectorAll('.theme-swatch'));
        var idx = btns.indexOf(document.activeElement);
        if (idx < btns.length - 1) btns[idx + 1].focus();
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp'){
        e.preventDefault();
        var btns = Array.from(swatchGroup.querySelectorAll('.theme-swatch'));
        var idx = btns.indexOf(document.activeElement);
        if (idx > 0) btns[idx - 1].focus();
      }
    });
  }

  /* === NAV FONT PAIR === */
  var navFontPairs = {
    editorial:  {nav:'Playfair Display', sub:'JetBrains Mono'},
    swiss:      {nav:'Inter',            sub:'JetBrains Mono'},
    brutal:     {nav:'JetBrains Mono',   sub:'JetBrains Mono'},
    display:    {nav:'Oswald',           sub:'JetBrains Mono'},
    literary:   {nav:'Playfair Display', sub:'Inter'},
    typewriter: {nav:'JetBrains Mono',   sub:'Playfair Display'},
    gallery:    {nav:'Oswald',           sub:'Inter'},
    minimal:    {nav:'Inter',            sub:'Playfair Display'},
    heritage:   {nav:'Playfair Display', sub:'Playfair Display'},
    mono:       {nav:'JetBrains Mono',   sub:'Inter'},
  };
  var activeNavFont = localStorage.getItem('navFont') || 'swiss';
  function applyNavFont(name){
    var p = navFontPairs[name];
    if (!p) return;
    activeNavFont = name;
    localStorage.setItem('navFont', name);
    html.style.setProperty('--nav-font', '"' + p.nav + '", serif');
    html.style.setProperty('--nav-sub-font', '"' + p.sub + '", monospace');
    var btns = document.querySelectorAll('[data-navfont]');
    for (var b = 0; b < btns.length; b++){
      btns[b].classList.toggle('active', btns[b].getAttribute('data-navfont') === name);
    }
  }
  applyNavFont(activeNavFont);
  var navGroup = document.querySelector('.skew-panel .grain-presets');
  if (navGroup){
    navGroup.addEventListener('click', function(e){
      var btn = e.target.closest('[data-navfont]');
      if (!btn) return;
      applyNavFont(btn.getAttribute('data-navfont'));
    });
  }

  /* === INIT === */
  initAnimRefs();
  route();

  /* === LIVE PANEL SYNC === */
  var _syncVersion = 0;
  function syncAll(){
    var v = localStorage.getItem('_panelVersion');
    if (v == _syncVersion) return;
    _syncVersion = v;
    skewFromStorage();
    vidFromStorage();
    var vig;
    try { vig = JSON.parse(localStorage.getItem('vig') || 'null'); } catch(e){ vig = null; }
    if (vig) html.style.setProperty('--vignette-alpha', vig.light != null ? vig.light : 0.35);
    var nf = localStorage.getItem('navFont') || 'swiss';
    if (nf !== activeNavFont) applyNavFont(nf);
    var ct = localStorage.getItem('colorTheme') || 'crimson';
    if (ct !== activeTheme) applyColorTheme(ct, false);
    refreshBgUI();
  }
  setInterval(syncAll, 400);
})();
