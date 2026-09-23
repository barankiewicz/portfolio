/* The cloud clip: the sky video in its own hole at the top right,
 * playing forwards and backwards, and now and then glitching into its
 * ASCII take, the same clip redrawn in the field's glyphs and coloured
 * from the video under each cell. The one thing on the site in colour.
 *
 * The model below is pure (no DOM) so node can test it; the renderer at
 * the bottom only runs in a browser, after field.js. Times are in ms
 * unless a name says otherwise; the params that are durations say s.
 */
(function(){
  'use strict';

  var TONES = 6;
  /* Every tunable value, read live, so the tuning page
   * (.claude/review-07/tune.html) can change them while the clip runs.
   * Placement is CSS (--cloud-* on :root) and the hole's pad, rag and
   * fill are attributes on the canvas; everything else is here. */
  var DEFAULTS = {
    mode: 'glitch',                            // 'glitch': video, glitching into the take; 'blend': seen through the field
    gapMin: 2, gapMax: 4,                       // s between glitches
    lenMin: 0.5, lenMax: 2.9,                   // s a glitch lasts
    lenSkew: 3.7,                              // above 1 most glitches are short
    stutter: 0,                                // chance a glitch comes as 2-3 quick ones
    swap: 'bands',                             // 'bands', or 'cut': the whole clip in one frame
    bandRows: 1,                               // cell rows per band
    swapWindow: 48,                            // ms the bands take to flip, each way
    ramp: 'field',                             // 'field' (the section under each cell), 0, 1, 2 (a section's ramp) or 'own'
    ownRamp: ['·', '-', '~', '≈', '▒', '▓'],
    toneLow: 0.39, toneHigh: 0.76,               // the brightness span the ramp is spread over
    boost: 1.35,                               // saturation and brightness lift, since glyphs on black read darker
    routes: 'all',                             // 'home': the clip leaves with the hero; 'all': it stays on every route
    dim: false,                                // with routes 'all', dim it while a page is open
    /* Field blend: where the field over the clip is lit above the
     * threshold tone its glyphs take the video's colour, at or below
     * it the video shows. */
    blendThreshold: 1,                         // this tone and under shows video
    backdrop: 'dim',                           // behind a lit glyph: 'dim' (video dimmed by tone) or 'fade' (crossfade to black)
    dimCurve: 1,                               // above 1 the video darkens sooner as tones rise
    fadeTime: 0.3,                             // s a cell takes to crossfade, with backdrop 'fade'
    tint: 'cell',                              // 'cell': one flat colour per cell; 'pixel': the video through the glyph
    edgeReach: 0,                              // cells past the box the colour reaches, 0 a hard edge
    edgeFalloff: 1,                            // above 1 the colour drops off sooner
    blendIn: 0.6                               // s the blend takes to come in
  };
  var PARAMS = JSON.parse(JSON.stringify(DEFAULTS));

  /* === GLITCH SCHEDULE === */
  function between(rnd, a, b){ return a + (b - a) * rnd(); }
  function glitchGap(rnd, P){ return 1000 * between(rnd, P.gapMin, P.gapMax); }
  /* Skewed toward the short end: u^skew bunches near 0 for skew > 1. */
  function glitchLength(rnd, P){ return 1000 * (P.lenMin + (P.lenMax - P.lenMin) * Math.pow(rnd(), P.lenSkew)); }
  /* One episode: a glitch, or with the stutter chance two or three
   * quick ones, each from lenMin to twice that, a beat apart after the
   * one before has swapped back. at is from the episode's start. */
  function planEpisode(rnd, P){
    if (!(rnd() < P.stutter)) return [{ at: 0, len: glitchLength(rnd, P) }];
    var out = [], at = 0, n = 2 + (rnd() < 0.5 ? 1 : 0);
    for (var k = 0; k < n; k++){
      var len = 1000 * P.lenMin * (1 + rnd());
      out.push({ at: at, len: len });
      at += len + P.swapWindow + between(rnd, 80, 240);
    }
    return out;
  }

  /* === SWAP ===
   * A glitch's bands: rows r0..r1 of cells, each showing the take from
   * on to off (ms from the glitch's start). In bands mode each band
   * gets its own slot of the window, in random order, going in and
   * again coming out; a hard cut is one band of every row, in at 0 and
   * out at len. */
  function shuffled(rnd, n){
    var a = [];
    for (var i = 0; i < n; i++) a.push(i);
    for (var j = n - 1; j > 0; j--){ var k = Math.floor(rnd() * (j + 1)), t = a[j]; a[j] = a[k]; a[k] = t; }
    return a;
  }
  function planSwap(rnd, rows, P, len){
    if (P.swap === 'cut') return [{ r0: 0, r1: rows, on: 0, off: len }];
    var h = Math.max(1, Math.round(P.bandRows)), n = Math.ceil(rows / h);
    var ins = shuffled(rnd, n), outs = shuffled(rnd, n), out = [];
    for (var b = 0; b < n; b++)
      out.push({ r0: b * h, r1: Math.min(rows, (b + 1) * h), on: P.swapWindow * ins[b] / n, off: len + P.swapWindow * outs[b] / n });
    return out;
  }
  /* One display frame of a swap: of the bands whose state is not yet
   * what the time says, flip the one that has waited longest, and only
   * that one, so no frame changes more than one band however slow the
   * frames are. shown holds 1 where a band is on the take. Returns the
   * band flipped, or -1. */
  function stepSwap(bands, shown, t){
    var pick = -1, since = Infinity;
    for (var b = 0; b < bands.length; b++){
      var want = t >= bands[b].on && t < bands[b].off ? 1 : 0;
      if (want === shown[b]) continue;
      var due = want ? bands[b].on : bands[b].off;
      if (due < since){ since = due; pick = b; }
    }
    if (pick >= 0) shown[pick] ^= 1;
    return pick;
  }

  /* === SAMPLING ===
   * The take reads its colours from a small copy of the clip, sw x sh
   * samples per frame, each the mean of the video pixels it stands for
   * (cloud-cells.bin, made by ffmpeg's area scaler), so no pixels are
   * ever read back from a canvas: privacy browsers blank those reads.
   *
   * coverRects maps each of cols x rows cells of a box w x h px onto the
   * samples the way object-fit: cover draws the video into the box. */
  function coverRects(cols, rows, w, h, sw, sh){
    var s = Math.max(w / sw, h / sh), vw = w / s, vh = h / s, ox = (sw - vw) / 2, oy = (sh - vh) / 2, out = [];
    for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++)
      out.push([ox + vw * c / cols, oy + vh * r / rows, ox + vw * (c + 1) / cols, oy + vh * (r + 1) / rows]);
    return out;
  }
  /* The mean colour over a rect of samples, each weighted by how much
   * of it the rect covers. */
  function cellMean(src, sw, sh, frame, x0, y0, x1, y1){
    var base = frame * sw * sh * 3, r = 0, g = 0, b = 0, area = 0;
    for (var y = Math.max(0, Math.floor(y0)); y < Math.min(sh, Math.ceil(y1)); y++){
      var wy = Math.min(y + 1, y1) - Math.max(y, y0);
      for (var x = Math.max(0, Math.floor(x0)); x < Math.min(sw, Math.ceil(x1)); x++){
        var w = wy * (Math.min(x + 1, x1) - Math.max(x, x0)), o = base + (y * sw + x) * 3;
        r += src[o] * w; g += src[o + 1] * w; b += src[o + 2] * w; area += w;
      }
    }
    return area ? [r / area, g / area, b / area] : [0, 0, 0];
  }
  /* A colour's ramp step, 0 (empty) to 6, from its luminance spread
   * over toneLow..toneHigh. Monotone, so brighter never means sparser. */
  function toneOf(c, P){
    var l = (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
    var u = (l - P.toneLow) / (P.toneHigh - P.toneLow);
    return u <= 0 ? 0 : Math.min(TONES, Math.ceil(u * TONES));
  }
  /* Saturation and brightness both scaled by 1 + k, hue kept. */
  function boost(c, k){
    var mx = Math.max(c[0], c[1], c[2]), mn = Math.min(c[0], c[1], c[2]);
    if (mx <= 0) return [0, 0, 0];
    var v = Math.min(255, mx * (1 + k)), s = Math.min(1, (mx - mn) / mx * (1 + k));
    return c.map(function(ch){ var u = mx > mn ? (mx - ch) / (mx - mn) : 0; return v * (1 - s * u); });
  }

  /* === FIELD BLEND ===
   * Per cell of the clip's box, from the field's tone there. A cell
   * above the threshold shows its field glyph in the video's colour; at
   * or below it shows the video. */
  function blendShows(tone, P){ return tone > P.blendThreshold; }
  /* Dim by tone: how much video stays behind a cell, 1 at or below the
   * threshold, one step less for each tone above it, near black at 6.
   * The field moves a cell one tone per tick, so this moves one step
   * per tick. */
  function blendBackdrop(tone, P){
    if (!blendShows(tone, P)) return 1;
    return Math.pow(1 - (tone - P.blendThreshold) / (TONES - P.blendThreshold + 1), P.dimCurve);
  }
  /* Crossfade: how far a cell is from video (0) to glyph on black (1),
   * moving toward where its tone says over fadeTime. */
  function blendFade(u, ascii, dtMs, P){
    var d = dtMs / (1000 * P.fadeTime);
    return ascii ? Math.min(1, u + d) : Math.max(0, u - d);
  }
  /* How many cells (c, r) lies outside a box of cols x rows cells, from
   * the nearest cell of the box; 0 inside. */
  function edgeDistance(c, r, cols, rows){
    var dx = c < 0 ? -c : c >= cols ? c - cols + 1 : 0, dy = r < 0 ? -r : r >= rows ? r - rows + 1 : 0;
    return Math.sqrt(dx * dx + dy * dy);
  }
  /* How much of the nearest edge cell's colour a glyph that far out
   * takes: all of it inside, none at edgeReach and beyond. */
  function edgeWeight(d, P){
    if (d <= 0) return 1;
    if (d >= P.edgeReach) return 0;
    return Math.pow(1 - d / P.edgeReach, P.edgeFalloff);
  }

  var api = { DEFAULTS: DEFAULTS, PARAMS: PARAMS, glitchGap: glitchGap, glitchLength: glitchLength, planEpisode: planEpisode, planSwap: planSwap, stepSwap: stepSwap, coverRects: coverRects, cellMean: cellMean, toneOf: toneOf, boost: boost, blendShows: blendShows, blendBackdrop: blendBackdrop, blendFade: blendFade, edgeDistance: edgeDistance, edgeWeight: edgeWeight };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }

  /* === RENDERER ===
   * The clip is a canvas whose box style.css snaps to whole field
   * cells. Its frames are decoded once from the video into bitmaps and
   * stepped here at the clip's own 8fps, forwards then backwards, so the
   * turnaround never waits on a seek or a second file. The take is drawn
   * into a small buffer at glyph-pixel resolution on each field tick and
   * scaled up with smoothing off, so its pixels are the field's. */
  var canvas = document.querySelector('.cloud'), field = window.asciiField;
  if (!canvas || !canvas.getContext || !field || !window.createImageBitmap) return;
  var ctx = canvas.getContext('2d');
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var FPS = 8, SW = 64, SH = 36, GW = 6, GH = 8;
  var hero = document.querySelector('.hero'), home = canvas.parentNode, away = document.body;
  var intro = document.querySelector('.hero-intro'), introCells = '';
  var frames = [], cells = null, count = 0, ready = false;
  /* set a frame after the clip takes data-sweep: .open any sooner and it
   * would land fully open, with nothing for its sweep to start from */
  var swept = false;

  /* The whole file is fetched first and seeked in memory: a server
   * without range requests leaves a streamed video unseekable, and every
   * seek would land back on frame 0. */
  function decodeFrames(){
    var v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto';
    function once(ev){ return new Promise(function(ok, fail){ v.addEventListener(ev, ok, { once: true }); v.addEventListener('error', fail, { once: true }); }); }
    return fetch(canvas.getAttribute('data-src')).then(function(r){ return r.blob(); }).then(function(blob){
      var loaded = once('loadeddata');
      v.src = URL.createObjectURL(blob);
      return loaded;
    }).then(function(){
      var n = reduce ? 1 : Math.round(v.duration * FPS), w = Math.min(v.videoWidth, Math.ceil(canvas.getBoundingClientRect().width * dpr() * 1.5) || v.videoWidth);
      var opts = { resizeWidth: w, resizeHeight: Math.round(w * v.videoHeight / v.videoWidth), resizeQuality: 'high' };
      /* One seek at a time, to the middle of each frame. */
      function grab(i){
        if (i >= n) return frames;
        var seeked = once('seeked');
        v.currentTime = (i + 0.5) / FPS;
        return seeked.then(function(){ return createImageBitmap(v, opts); }).then(function(b){ frames.push(b); return grab(i + 1); });
      }
      return grab(0).then(function(f){ URL.revokeObjectURL(v.src); v.removeAttribute('src'); v.load(); return f; });
    });
  }
  /* cloud-cells.bin is gzipped; a server may already have unzipped it. */
  function loadCells(){
    return fetch(canvas.getAttribute('data-cells')).then(function(r){ return r.arrayBuffer(); }).then(function(buf){
      var b = new Uint8Array(buf);
      if (b[0] !== 0x1f || b[1] !== 0x8b) return b;
      return new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer().then(function(u){ return new Uint8Array(u); });
    });
  }

  function dpr(){ return Math.min(window.devicePixelRatio || 1, 2); }
  /* The box in cells, where it sits on the field's grid, and the cover
   * rects that map its cells onto the samples. */
  var box = null;
  function fit(){
    var r = canvas.getBoundingClientRect(), holes = field.holes(), d = dpr();
    if (!(r.width > 0)) return false;
    var key = [r.left, r.top, r.width, r.height, d, holes.cw, holes.ch].join();
    if (box && box.key === key) return true;
    var cols = Math.round(r.width / holes.cw), rows = Math.round(r.height / holes.ch);
    box = { key: key, cols: cols, rows: rows, gx: Math.round(r.left / holes.cw), gy: Math.round(r.top / holes.ch), w: r.width, h: r.height,
      rects: coverRects(cols, rows, r.width, r.height, SW, SH), tone: new Uint8Array(cols * rows), fresh: true };
    canvas.width = Math.round(r.width * d); canvas.height = Math.round(r.height * d);
    /* where PORTFOLIO is placed from (style.css) */
    var rs = document.documentElement.style;
    rs.setProperty('--clip-x', r.left + 'px'); rs.setProperty('--clip-y', r.top + 'px');
    rs.setProperty('--clip-w', r.width + 'px'); rs.setProperty('--clip-h', r.height + 'px');
    take = document.createElement('canvas');
    take.width = cols * GW; take.height = rows * GH;
    takeCtx = take.getContext('2d');
    takeImg = takeCtx.createImageData(take.width, take.height);
    /* a glitch's bands were cut for the old box */
    if (glitch){ glitch = null; episode = []; schedule(clock); }
    dirty = true;
    return true;
  }

  /* === THE ASCII TAKE === */
  var take = null, takeCtx = null, takeImg = null;
  function rampFor(sec){
    var P = PARAMS, ramps = field.params.ramps;
    if (P.ramp === 'own') return P.ownRamp;
    return ramps[P.ramp === 'field' ? sec : +P.ramp] || ramps[0];
  }
  /* Resample the frame on screen: each cell's mean colour picks its
   * step, moving at most one step per tick as the field's cells do,
   * except on a glitch's first tick, which starts where the frame is. */
  function drawTake(frame){
    var P = PARAMS, holes = field.holes(), glyphs = field.bitmaps, data = takeImg.data;
    data.fill(0);
    for (var r = 0; r < box.rows; r++) for (var c = 0; c < box.cols; c++){
      var i = r * box.cols + c, q = box.rects[i];
      var col = cellMean(cells, SW, SH, frame, q[0], q[1], q[2], q[3]), want = toneOf(col, P), t = box.tone[i];
      t = box.fresh ? want : want > t ? t + 1 : want < t ? t - 1 : t;
      box.tone[i] = t;
      if (!t) continue;
      var gx = box.gx + c, gy = box.gy + r;
      var sec = gx < holes.cols && gy < holes.rows ? holes.section[gy * holes.cols + gx] : 0;
      var bm = glyphs[rampFor(sec)[t - 1]];
      if (!bm) continue;
      var rgb = boost(col, P.boost);
      for (var py = 0; py < bm.length; py++) for (var px = 0; px < bm[py].length; px++){
        if (bm[py].charAt(px) !== '#') continue;
        var o = ((r * GH + py) * take.width + c * GW + px) * 4;
        data[o] = rgb[0]; data[o + 1] = rgb[1]; data[o + 2] = rgb[2]; data[o + 3] = 255;
      }
    }
    box.fresh = false;
    takeCtx.putImageData(takeImg, 0, 0);
  }

  /* === PLAYBACK AND GLITCHES === */
  var clock = 0, shownFrame = -1, dirty = true, raf = 0, last = 0;
  var nextAt = 0, episode = [], glitch = null, shown = null, ticked = false;
  function frameAt(ms){
    var n = frames.length, k = Math.floor(ms * FPS / 1000) % Math.max(1, 2 * (n - 1));
    return k < n ? k : 2 * (n - 1) - k;
  }
  /* The wait is re-rolled if the gap params change while it runs, so
   * the tuning page's gap sliders take effect at once. */
  var gapFrom = 0, gapKey = '';
  function schedule(from){ gapFrom = from; gapKey = PARAMS.gapMin + ',' + PARAMS.gapMax; nextAt = from + glitchGap(Math.random, PARAMS); }
  function startEpisode(at){
    episode = planEpisode(Math.random, PARAMS).map(function(g){ return { at: at + g.at, len: g.len }; });
    glitch = null;
  }
  function stepGlitches(){
    if (!glitch && episode.length && clock >= episode[0].at){
      var g = episode.shift();
      glitch = { at: g.at, bands: planSwap(Math.random, box.rows, PARAMS, g.len) };
      shown = new Uint8Array(glitch.bands.length);
      box.fresh = true;
      drawTake(frameAt(clock));
    }
    if (!glitch){
      if (PARAMS.gapMin + ',' + PARAMS.gapMax !== gapKey) schedule(gapFrom);
      if (!episode.length && clock >= nextAt) startEpisode(clock);
      return;
    }
    var t = clock - glitch.at;
    if (stepSwap(glitch.bands, shown, t) >= 0) dirty = true;
    var end = 0;
    for (var b = 0; b < glitch.bands.length; b++) end = Math.max(end, glitch.bands[b].off);
    if (t >= end && shown.every(function(v){ return !v; })){
      glitch = null;
      if (!episode.length) schedule(clock);
    }
  }

  function cover(img){
    var s = Math.max(canvas.width / img.width, canvas.height / img.height), w = img.width * s, h = img.height * s;
    ctx.drawImage(img, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
  }
  function draw(){
    var k = frameAt(clock);
    ctx.imageSmoothingEnabled = true;
    cover(frames[k]);
    shownFrame = k;
    if (glitch){
      var sy = canvas.height / box.rows;
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = '#000';
      for (var b = 0; b < glitch.bands.length; b++){
        if (!shown[b]) continue;
        var g = glitch.bands[b], y0 = Math.round(g.r0 * sy), y1 = Math.round(g.r1 * sy);
        ctx.fillRect(0, y0, canvas.width, y1 - y0);
        ctx.drawImage(take, 0, g.r0 * GH, take.width, (g.r1 - g.r0) * GH, 0, y0, canvas.width, y1 - y0);
      }
    }
    cutIntro();
    dirty = false;
  }

  /* PORTFOLIO's hole, cut into the video: the very cells its hole in the
   * field covers (field.cutsOf), so it has the field's pad, rag and
   * scanline bands, in its own fill grey. Drawn over the take too. */
  function introHole(){ return intro && intro.hasAttribute('data-cutout') ? field.cutsOf(intro) : []; }
  function cutIntro(){
    var cells = introHole(), holes = field.holes(), sx = canvas.width / box.cols, sy = canvas.height / box.rows;
    var g = intro && intro.getAttribute('data-cutout-fill');
    g = g != null && g !== '' ? +g : field.params.cutFill;
    ctx.fillStyle = 'rgb(' + g + ',' + g + ',' + g + ')';
    for (var i = 0; i < cells.length; i++){
      var c = cells[i] % holes.cols - box.gx, r = Math.floor(cells[i] / holes.cols) - box.gy;
      if (c < 0 || r < 0 || c >= box.cols || r >= box.rows) continue;
      var x0 = Math.round(c * sx), y0 = Math.round(r * sy);
      ctx.fillRect(x0, y0, Math.round((c + 1) * sx) - x0, Math.round((r + 1) * sy) - y0);
    }
    introCells = cells.join();
  }

  /* home: the clip lives in the hero, so it opens and closes with the
   * hero's lines on a route change. all: it lives outside every route
   * and stays open, dimmed while a page is open if dim is on. */
  function place(){
    var P = PARAMS, parent = P.routes === 'all' ? away : home;
    if (canvas.parentNode !== parent) parent.insertBefore(canvas, parent === away ? away.firstChild : null);
    canvas.classList.toggle('everywhere', P.routes === 'all');
    canvas.classList.toggle('dim', !!P.dim);
    if (P.routes === 'all' && swept) canvas.classList.add('open');
  }

  function frame(now){
    raf = requestAnimationFrame(frame);
    var dt = last ? Math.min(now - last, 100) : 0;
    last = now;
    place();
    if (!fit()) return;
    clock += dt;
    stepGlitches();
    if (glitch && ticked){ drawTake(frameAt(clock)); dirty = true; }
    ticked = false;
    if (dirty || frameAt(clock) !== shownFrame || introHole().join() !== introCells) draw();
  }
  function play(){
    if (raf || document.hidden) return;
    last = 0;
    raf = requestAnimationFrame(frame);
  }
  function pause(){ cancelAnimationFrame(raf); raf = 0; }

  /* The clip only takes its hole and starts its sweep once its first
   * frame can be drawn, so nothing is ever painted while it loads. On
   * home it opens with the hero; elsewhere the hero's own open picks it
   * up when the route comes back. */
  function show(){
    ready = true;
    fit();
    draw();
    canvas.setAttribute('data-cutout', 'box');
    canvas.setAttribute('data-sweep', '');
    if (intro){ intro.setAttribute('data-cutout', 'text'); intro.setAttribute('data-sweep', ''); }
    place();
    field.sync();
    draw();
    requestAnimationFrame(function(){
      swept = true;
      canvas.classList.add('ready');
      var home = !document.body.classList.contains('page-open');
      if (PARAMS.routes === 'all' || home) canvas.classList.add('open');
      if (intro && home) intro.classList.add('open');
    });
  }

  window.cloudClip = {
    params: PARAMS,
    defaults: DEFAULTS,
    /* for the tuning page: a glitch now, not in a few seconds */
    glitch: function(){ if (ready && !reduce && !glitch){ startEpisode(clock); } },
    state: function(){ return { ready: ready, clock: clock, frame: shownFrame, frames: frames.length, glitch: glitch && { at: glitch.at, bands: glitch.bands, shown: Array.from(shown) }, nextAt: nextAt, box: box && { cols: box.cols, rows: box.rows, gx: box.gx, gy: box.gy } }; }
  };

  Promise.all([decodeFrames(), loadCells()]).then(function(res){
    cells = res[1];
    count = Math.min(frames.length, Math.floor(cells.length / (SW * SH * 3)));
    frames.length = count;
    show();
    if (reduce) return;
    schedule(0);
    field.ticks.push(function(){ ticked = true; });
    document.addEventListener('visibilitychange', function(){ if (document.hidden) pause(); else play(); });
    play();
  }).catch(function(){ canvas.remove(); });
})();
