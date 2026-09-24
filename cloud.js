/* The cloud clip: the sky video at the top right, playing forwards and
 * backwards under the field, seen through it. Where the field over the
 * clip is lit its glyphs take the video's colour; where it is empty the
 * video shows. The one thing on the site in colour.
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
   * Placement is CSS (--cloud-* on :root); everything else is here. */
  var DEFAULTS = {
    boost: 1.5,                                // saturation and brightness lift, since glyphs on black read darker
    routes: 'all',                             // desktop route mode
    phoneRoutes: 'home',                       // phone route mode; landscape phones use the short viewport rule
    blendThreshold: 0,                         // this field tone and under shows video, above it the glyph
    backdrop: 'dim',                           // behind a lit glyph: 'dim' (video dimmed by tone) or 'fade' (crossfade to black)
    dimCurve: 1,                               // above 1 the video darkens sooner as tones rise
    fadeTime: 0.2,                             // s a cell takes to crossfade, with backdrop 'fade'
    tint: 'cell',                              // 'cell': one flat colour per cell; 'pixel': the video through the glyph
    edgeReach: 6,                              // cells past the box where the colour is gone, 0 or 1 a hard edge
    edgeFalloff: 0.7,                          // above 1 the colour drops off sooner
    blendIn: 0.25                              // s the blend takes to come in
  };
  var PARAMS = JSON.parse(JSON.stringify(DEFAULTS));

  /* === SAMPLING ===
   * The blend reads its colours from a small copy of the clip, sw x sh
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

  var api = { DEFAULTS: DEFAULTS, PARAMS: PARAMS, coverRects: coverRects, cellMean: cellMean, boost: boost, blendShows: blendShows, blendBackdrop: blendBackdrop, blendFade: blendFade, edgeDistance: edgeDistance, edgeWeight: edgeWeight };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }

  /* === RENDERER ===
   * The clip is a canvas whose box style.css snaps to whole field
   * cells. Its frames are decoded once from the video into bitmaps and
   * stepped here at the clip's own 8fps, forwards then backwards, so the
   * turnaround never waits on a seek or a second file. */
  var canvas = document.querySelector('.cloud'), field = window.asciiField;
  if (!canvas || !canvas.getContext || !field || !window.createImageBitmap) return;
  var ctx = canvas.getContext('2d');
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var FPS = 8, SW = 64, SH = 36;
  var intro = document.querySelector('.hero-intro'), introCells = '';
  var frames = [], cells = null, count = 0, ready = false;

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
      rects: coverRects(cols, rows, r.width, r.height, SW, SH),
      level: new Float32Array(cols * rows).fill(1), u: new Float32Array(cols * rows), rgb: new Float32Array(cols * rows * 3), rgbFrame: -1 };
    canvas.width = Math.round(r.width * d); canvas.height = Math.round(r.height * d);
    /* where PORTFOLIO is placed from (style.css) */
    var rs = document.documentElement.style;
    rs.setProperty('--clip-x', r.left + 'px'); rs.setProperty('--clip-y', r.top + 'px');
    rs.setProperty('--clip-w', r.width + 'px'); rs.setProperty('--clip-h', r.height + 'px');
    tinted = null;
    dirty = true;
    return true;
  }

  /* === FIELD BLEND ===
   * The clip sits under the field, with no hole of its own, and the
   * field runs across it unbroken. Per cell of the box, the field's tone picks
   * whether its glyph shows (in the video's colour) and how much video
   * stays behind it; this canvas draws the video and the backdrop, the
   * field draws the glyphs through its tint (field.js). Glyphs within
   * edgeReach cells of the box take the nearest edge cell's colour. */
  var tinted = null, appear = 0;
  function tintKey(){ return Math.max(0, Math.ceil(PARAMS.edgeReach)) + ',' + PARAMS.tint; }
  function tintFor(){
    var reach = Math.max(0, Math.ceil(PARAMS.edgeReach)), key = tintKey();
    if (tinted && tinted.key === key) return tinted;
    var cols = box.cols + 2 * reach, rows = box.rows + 2 * reach;
    function small(){ var c = document.createElement('canvas'); c.width = cols; c.height = rows; return c; }
    tinted = { key: key, reach: reach, x: box.gx - reach, y: box.gy - reach, cols: cols, rows: rows,
      box: { x: box.gx, y: box.gy, cols: box.cols, rows: box.rows }, show: small(), colour: small(),
      paint: PARAMS.tint === 'pixel' ? paintPixels : null };
    tinted.showImg = tinted.show.getContext('2d').createImageData(cols, rows);
    tinted.colourImg = tinted.colour.getContext('2d').createImageData(cols, rows);
    return tinted;
  }
  /* Each box cell's glyph and backdrop from the field's tone under it,
   * on each field tick; dtMs null settles the crossfade where it is
   * heading. */
  function stepBlend(dtMs){
    var P = PARAMS, holes = field.holes();
    for (var r = 0; r < box.rows; r++) for (var c = 0; c < box.cols; c++){
      var i = r * box.cols + c, gx = box.gx + c, gy = box.gy + r;
      var tone = gx >= 0 && gy >= 0 && gx < holes.cols && gy < holes.rows ? holes.tone[gy * holes.cols + gx] : 0, ascii = blendShows(tone, P);
      if (P.backdrop === 'fade'){ box.u[i] = dtMs == null ? +ascii : blendFade(box.u[i], ascii, dtMs, P); box.level[i] = 1 - box.u[i]; }
      else { box.u[i] = +ascii; box.level[i] = blendBackdrop(tone, P); }
    }
    dirty = true;
  }
  /* The tint's two canvases: how much of each glyph shows, and its
   * colour, the boosted mean of the video under the cell (or, past the
   * box, under the nearest edge cell) as far as edgeWeight and the
   * blend's own fade-in say. */
  function paintTint(){
    var P = PARAMS, t = tintFor(), k = frameAt(clock);
    if (box.rgbFrame !== k){
      for (var i = 0; i < box.rects.length; i++){
        var q = box.rects[i], rgb = boost(cellMean(cells, SW, SH, k, q[0], q[1], q[2], q[3]), P.boost);
        box.rgb[3 * i] = rgb[0]; box.rgb[3 * i + 1] = rgb[1]; box.rgb[3 * i + 2] = rgb[2];
      }
      box.rgbFrame = k;
    }
    var show = t.showImg.data, colour = t.colourImg.data;
    for (var rr = 0; rr < t.rows; rr++) for (var rc = 0; rc < t.cols; rc++){
      var c = rc - t.reach, r = rr - t.reach, o = 4 * (rr * t.cols + rc);
      var inside = c >= 0 && r >= 0 && c < box.cols && r < box.rows;
      var n = Math.min(box.rows - 1, Math.max(0, r)) * box.cols + Math.min(box.cols - 1, Math.max(0, c));
      show[o + 3] = inside ? Math.round(255 * box.u[n]) : 255;
      colour[o] = box.rgb[3 * n]; colour[o + 1] = box.rgb[3 * n + 1]; colour[o + 2] = box.rgb[3 * n + 2];
      colour[o + 3] = Math.round(255 * appear * edgeWeight(edgeDistance(c, r, box.cols, box.rows), P));
    }
    t.show.getContext('2d').putImageData(t.showImg, 0, 0);
    t.colour.getContext('2d').putImageData(t.colourImg, 0, 0);
    field.tint(t);
  }
  /* tint 'pixel': the video itself through the glyphs over the box */
  function paintPixels(g, x, y, w, h){
    var img = frames[frameAt(clock)], s = Math.max(w / img.width, h / img.height), k = 1 + PARAMS.boost;
    g.save();
    g.beginPath(); g.rect(x, y, w, h); g.clip();
    g.globalAlpha = appear;
    g.imageSmoothingEnabled = true;
    if ('filter' in g) g.filter = 'saturate(' + k + ') brightness(' + k + ')';
    g.drawImage(img, x + (w - img.width * s) / 2, y + (h - img.height * s) / 2, img.width * s, img.height * s);
    g.restore();
  }
  function drawBlend(){
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = appear;
    ctx.imageSmoothingEnabled = true;
    cover(frames[frameAt(clock)]);
    var sx = canvas.width / box.cols, sy = canvas.height / box.rows;
    ctx.fillStyle = '#000';
    for (var i = 0; i < box.level.length; i++){
      if (box.level[i] >= 1) continue;
      var c = i % box.cols, r = (i - c) / box.cols, x0 = Math.round(c * sx), y0 = Math.round(r * sy);
      ctx.globalAlpha = appear * (1 - box.level[i]);
      ctx.fillRect(x0, y0, Math.round((c + 1) * sx) - x0, Math.round((r + 1) * sy) - y0);
    }
    ctx.globalAlpha = 1;
  }
  /* The field ticks: every box cell has a new tone, so the tint follows
   * before the field draws, in the same frame. Under reduced motion this
   * is a settle (a resize, a font, a new hole), and with no loop here the
   * clip redraws at once. */
  function onTick(){
    if (!ready || !box) return;
    stepBlend(reduce ? null : 1000 / field.params.fps);
    paintTint();
    if (reduce) draw();
  }

  /* === PLAYBACK === */
  var clock = 0, shownFrame = -1, dirty = true, raf = 0, last = 0;
  function frameAt(ms){
    var n = frames.length, k = Math.floor(ms * FPS / 1000) % Math.max(1, 2 * (n - 1));
    return k < n ? k : 2 * (n - 1) - k;
  }
  function cover(img){
    var s = Math.max(canvas.width / img.width, canvas.height / img.height), w = img.width * s, h = img.height * s;
    ctx.drawImage(img, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
  }
  function draw(){
    var k = frameAt(clock);
    shownFrame = k;
    drawBlend();
    cutIntro();
    dirty = false;
  }

  /* PORTFOLIO's hole, cut into the video: the very cells its hole in the
   * field covers (field.cutsOf), so it has the field's pad, rag and
   * scanline bands, in its own fill grey. */
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

  function routeTarget(){
    var phone = matchMedia('(max-width: 720px), (max-width: 900px) and (max-height: 480px)').matches;
    var routes = phone ? PARAMS.phoneRoutes : PARAMS.routes;
    return routes === 'all' || !document.body.classList.contains('page-open') ? 1 : 0;
  }

  function frame(now){
    raf = requestAnimationFrame(frame);
    var dt = last ? Math.min(now - last, 100) : 0;
    last = now;
    if (!fit()) return;
    clock += dt;
    /* on 'home' the clip fades out while a page is open */
    var to = routeTarget(), was = appear;
    appear = to > appear ? Math.min(to, appear + dt / (1000 * PARAMS.blendIn)) : Math.max(to, appear - dt / (1000 * PARAMS.blendIn));
    /* the tint's colours follow the video frame and the fade-in */
    if (!tinted || appear !== was || box.rgbFrame !== frameAt(clock) || tinted.key !== tintKey()){
      paintTint(); field.redraw(); dirty = true;
    }
    if (dirty || frameAt(clock) !== shownFrame || introHole().join() !== introCells) draw();
  }
  function play(){
    if (raf || document.hidden) return;
    last = 0;
    raf = requestAnimationFrame(frame);
  }
  function pause(){ cancelAnimationFrame(raf); raf = 0; }

  /* The clip fades in with its colour once its first frame can be
   * drawn, so nothing is ever painted while it loads; PORTFOLIO takes
   * its hole and sweeps open then. */
  function show(){
    ready = true;
    fit();
    /* reduced motion: one settled blend frame, there is no loop */
    if (reduce) appear = routeTarget();
    if (intro){ intro.setAttribute('data-cutout', 'text'); intro.setAttribute('data-sweep', ''); }
    field.sync();
    if (reduce){ stepBlend(null); paintTint(); field.redraw(); }
    draw();
    requestAnimationFrame(function(){
      if (intro && !document.body.classList.contains('page-open')) intro.classList.add('open');
    });
  }

  window.cloudClip = {
    params: PARAMS,
    defaults: DEFAULTS,
    state: function(){ return { ready: ready, clock: clock, frame: shownFrame, frames: frames.length, box: box && { cols: box.cols, rows: box.rows, gx: box.gx, gy: box.gy },
      blend: box ? { appear: appear, show: Array.from(box.u), level: Array.from(box.level) } : null }; }
  };

  Promise.all([decodeFrames(), loadCells()]).then(function(res){
    cells = res[1];
    count = Math.min(frames.length, Math.floor(cells.length / (SW * SH * 3)));
    frames.length = count;
    show();
    field.ticks.push(onTick);
    if (reduce){
      function syncReduced(){
        if (!ready || !fit()) return;
        appear = routeTarget();
        stepBlend(null);
        paintTint();
        draw();
        field.redraw();
      }
      window.addEventListener('hashchange', syncReduced);
      window.addEventListener('resize', syncReduced);
      return;
    }
    document.addEventListener('visibilitychange', function(){ if (document.hidden) pause(); else play(); });
    play();
  }).catch(function(){ canvas.remove(); });
})();
