/* The ASCII field: weather made of characters behind the whole site.
 *
 * The model below is pure (no DOM) so node can test it; the renderer at
 * the bottom only runs in a browser. Cells are terminal-shaped, taller than
 * wide, and glyphs are drawn as small pixel bitmaps. Distances are in cell
 * widths (rows scaled by the aspect) and times in seconds unless a name
 * says otherwise.
 */
(function(){
  'use strict';

  /* Three sections side by side, each with its own pattern and its own
   * glyphs, sparse to dense. A cell's tone (1-6) picks the glyph from its
   * section's ramp; tone 0 is an empty cell. The faint end is each
   * section's own characters, the dense end shade blocks the sections
   * share, which is what lets them run into one another. */
  var SECTIONS = [
    { name: 'cells', pattern: 'cells', scale: 0.09, ramp: ['·', '∘', '○', '░', '▒', '▓'] },
    { name: 'waves', pattern: 'waves', scale: 0.1,  ramp: ['.', ':', '+', '░', '▒', '▓'] },
    { name: 'binary', pattern: 'cells', scale: 0.17, ramp: ['.', ',', ';', '1', '0', '▒'] }
  ];
  var TONES = 6;

  /* Pixel bitmaps, at most 6x8. Shade glyphs fill the whole cell so they
   * join up with their neighbours; the rest sit in 5x7 and keep a
   * one-pixel gap. */
  var GLYPHS = {
    '.': ['.....', '.....', '.....', '.....', '.....', '.....', '..#..'],
    ':': ['.....', '.....', '..#..', '.....', '.....', '..#..', '.....'],
    '+': ['.....', '..#..', '..#..', '#####', '..#..', '..#..', '.....'],
    '·': ['.....', '.....', '.....', '..#..', '.....', '.....', '.....'],
    '∘': ['.....', '.....', '.###.', '.#.#.', '.###.', '.....', '.....'],
    '○': ['.....', '.###.', '#...#', '#...#', '#...#', '.###.', '.....'],
    ',': ['.....', '.....', '.....', '.....', '.....', '..#..', '.#...'],
    ';': ['.....', '.....', '..#..', '.....', '.....', '..#..', '.#...'],
    '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
    '0': ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
    '░': ['#.#.#.', '......', '#.#.#.', '......', '#.#.#.', '......', '#.#.#.', '......'],
    '▒': ['#.#.#.', '.#.#.#', '#.#.#.', '.#.#.#', '#.#.#.', '.#.#.#', '#.#.#.', '.#.#.#'],
    '▓': ['.#.#.#', '######', '.#.#.#', '######', '.#.#.#', '######', '.#.#.#', '######']
  };

  /* Every glyph the field can draw; index 0 is the empty cell. */
  var CHARS = [' '];
  SECTIONS.forEach(function(sec){
    sec.glyphs = sec.ramp.map(function(ch){
      if (CHARS.indexOf(ch) < 0) CHARS.push(ch);
      return CHARS.indexOf(ch);
    });
  });
  /* Three greys, dim to white: tones 1-3, 4-5 and 6. White is kept for
   * the densest tone so shade blocks only glare at the very peaks. */
  var GREYS = [96, 170, 255];

  var THRESHOLD = 0.05;                        // below this a cell is empty
  var TONE_STEP = (1 - THRESHOLD) / TONES;
  /* The field steps at 12fps, not at the display's rate. */
  var TICK = 1 / 12;
  /* Brightness slews at most this fast, so a cell can only move one tone
   * per tick (RISE * TICK < TONE_STEP). That is the no-yank guarantee:
   * every appearance starts at its section's faintest glyph. */
  var RISE = 1.8;                              // per second, 0 to 1 in 560ms
  var FALL = 1.6;                              // per second, 1 to 0 in 630ms
  var MAX_DT = TICK;
  var PACE = 0.8;                              // pattern seconds per real second
  var INTRO = 1.6;                             // whole field fades up on load
  var TILE = 6;                                // a tile is 6x6 base cells
  var SIZES = [1, 1.5, 2];                     // glyph sizes, in cells; each divides TILE
  var SIZE_FADE = 1.4;                         // size crossfade, seconds
  /* A 1x glyph changing reads as texture, but a larger glyph swapping
   * form in one tick is a pop, so large cells crossfade each change. */
  var GLYPH_FADE = 0.3;                        // about four ticks at 12fps

  function toneOf(v){
    if (v < THRESHOLD) return 0;
    return Math.min(TONES, 1 + Math.floor((v - THRESHOLD) / TONE_STEP));
  }
  function greyOf(tone){
    return tone < 4 ? 0 : tone < 6 ? 1 : 2;
  }

  function easeInOutSine(u){ return 0.5 - 0.5 * Math.cos(Math.PI * u); }
  function smoothstep(a, b, x){
    var u = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return u * u * (3 - 2 * u);
  }

  function mulberry32(a){
    return function(){
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function hash3(seed, x, y, z){
    var h = seed ^ Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483647);
    h = Math.imul(h ^ h >>> 13, 1274126177);
    return ((h ^ h >>> 16) >>> 0) / 4294967296;
  }
  /* Smooth value noise in [0,1). */
  function noise3(seed, x, y, z){
    var ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    var fx = x - ix, fy = y - iy, fz = z - iz;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
    function lerp(a, b, t){ return a + (b - a) * t; }
    function c(dx, dy, dz){ return hash3(seed, ix + dx, iy + dy, iz + dz); }
    return lerp(
      lerp(lerp(c(0,0,0), c(1,0,0), fx), lerp(c(0,1,0), c(1,1,0), fx), fy),
      lerp(lerp(c(0,0,1), c(1,0,1), fx), lerp(c(0,1,1), c(1,1,1), fx), fy),
      fz);
  }

  /* === PATTERNS ===
   * Continuous fields in [0,1], so neighbouring cells move together and
   * the motion reads as one surface rather than as noise. */

  /* Waves: three plane waves and one ring wave from a wandering centre,
   * summed, with their crests sharpened. Directions, wavelengths and
   * speeds are drawn per field. */
  function makeWaves(rnd, scale){
    var planes = [];
    for (var k = 0; k < 3; k++){
      var a = rnd() * Math.PI * 2, n = scale * (0.6 + rnd() * 0.8);
      planes.push({ kx: Math.cos(a) * n, ky: Math.sin(a) * n, w: 0.6 + rnd() * 0.9 });
    }
    return { planes: planes, ring: scale * (0.7 + rnd() * 0.5), cx: rnd(), cy: rnd(), phase: rnd() * 100 };
  }
  function wavesAt(p, x, y, t, cols, rows){
    var v = 0;
    for (var k = 0; k < 3; k++){
      var w = p.planes[k];
      v += 0.5 + 0.5 * Math.sin(w.kx * x + w.ky * y - w.w * t);
    }
    var cx = cols * (p.cx + 0.3 * Math.sin(t * 0.07 + p.phase));
    var cy = rows * (p.cy + 0.3 * Math.cos(t * 0.05 + p.phase));
    var dx = x - cx, dy = y - cy;
    v += 0.5 + 0.5 * Math.sin(Math.sqrt(dx * dx + dy * dy) * p.ring - t * 1.1);
    return smoothstep(0.35, 0.95, v / 4);
  }

  /* Cells: distance to the nearest of a jittered grid of points, each
   * point circling its own slot, so dark blobs breathe inside a bright
   * mesh. */
  function cellsAt(salt, scale, x, y, t){
    var X = x * scale, Y = y * scale, ix = Math.floor(X), iy = Math.floor(Y), best = 9;
    for (var j = -1; j <= 1; j++){
      for (var i = -1; i <= 1; i++){
        var gx = ix + i, gy = iy + j;
        var a = hash3(salt, gx, gy, 0) * 6.2832, b = hash3(salt, gx, gy, 1) * 6.2832;
        var s = 0.4 + 0.5 * hash3(salt, gx, gy, 2);
        var px = gx + 0.5 + 0.38 * Math.sin(t * s + a), py = gy + 0.5 + 0.38 * Math.cos(t * s * 0.8 + b);
        var d = (X - px) * (X - px) + (Y - py) * (Y - py);
        if (d < best) best = d;
      }
    }
    return smoothstep(0.15, 0.95, Math.sqrt(best));
  }

  /* === FIELD === */
  function createField(seed, cols, rows, aspect){
    var rnd = mulberry32(seed);
    var f = {
      seed: seed | 0, cols: 0, rows: 0, aspect: aspect || 1,
      real: 0, time: 0,
      level: null, tone: null, grey: null, glyph: null, section: null,
      tiles: [], waves: [],
      step: step, resize: resize
    };
    SECTIONS.forEach(function(sec){ f.waves.push(makeWaves(rnd, sec.scale)); });

    /* Tile size wanders with slow noise; hysteresis keeps a tile from
     * flickering between sizes at a threshold. */
    function sizeTarget(tile){
      var n = noise3(f.seed ^ 0x5bd1e995, tile.x * 0.3, tile.y * 0.3 * f.aspect, f.time * 0.035);
      var margin = 0.03;                       // harder to enter a size than to stay in it
      if (n > (tile.to === 2 ? 0.66 - margin : 0.66 + margin)) return 2;
      if (n > (tile.to === 1 ? 0.54 + margin : 0.54 - margin)) return 1.5;
      return 1;
    }
    function buildTiles(old){
      var tc = Math.ceil(f.cols / TILE), tr = Math.ceil(f.rows / TILE), keep = {};
      for (var i = 0; old && i < old.length; i++) keep[old[i].x + ',' + old[i].y] = old[i];
      f.tiles = [];
      for (var y = 0; y < tr; y++) for (var x = 0; x < tc; x++){
        var t = keep[x + ',' + y];
        if (!t){
          t = { x: x, y: y, from: 1, to: 1, mix: 1, t0: 0, cells: {} };
          t.to = t.from = sizeTarget(t);
          for (var si = 1; si < SIZES.length; si++){
            var cells = t.cells[SIZES[si]] = [], count = Math.pow(TILE / SIZES[si], 2);
            for (var k = 0; k < count; k++) cells.push({ glyph: 0, grey: 0, fromGlyph: 0, fromGrey: 0, u: 1 });
          }
        }
        f.tiles.push(t);
      }
    }

    /* Where each section ends wanders per row and over time, and cells
     * near a border are dithered between its two sides, so the sections
     * flow into one another instead of meeting at a line. */
    function assignSections(){
      var band = 6 / f.cols, t = f.time;
      for (var y = 0; y < f.rows; y++){
        var ya = y * f.aspect;
        var b1 = 0.34 + 0.2 * (noise3(f.seed ^ 0x27d4eb2d, ya * 0.05, t * 0.04, 0) - 0.5)
                      + 0.08 * (noise3(f.seed ^ 0x27d4eb2d, ya * 0.3, t * 0.15, 1) - 0.5);
        var b2 = 0.66 + 0.2 * (noise3(f.seed ^ 0x165667b1, ya * 0.05, t * 0.04, 0) - 0.5)
                      + 0.08 * (noise3(f.seed ^ 0x165667b1, ya * 0.3, t * 0.15, 1) - 0.5);
        for (var x = 0; x < f.cols; x++){
          var u = x / f.cols, h = hash3(f.seed, x, y, 7);
          f.section[y * f.cols + x] = h < smoothstep(-band, band, u - b2) ? 2 : h < smoothstep(-band, band, u - b1) ? 1 : 0;
        }
      }
    }

    /* The brightness a cell is heading for: its section's pattern, under a
     * slow mask that lets whole regions swell up and die away, so a large
     * part of the field is always resting. */
    function patternAt(sec, x, y){
      var s = SECTIONS[sec], ya = y * f.aspect, t = f.time;
      var v = s.pattern === 'waves'
        ? wavesAt(f.waves[sec], x, ya, t, f.cols, f.rows * f.aspect)
        : cellsAt(f.seed ^ (sec * 0x9e3779b1), s.scale, x, ya, t);
      var mask = smoothstep(0.35, 0.68, noise3(f.seed ^ 0x3c6ef372, x * 0.03, ya * 0.03, t * 0.04));
      return v * mask;
    }

    function resize(c, r){
      var n = c * r;
      var level = new Float32Array(n), tone = new Uint8Array(n), grey = new Uint8Array(n), glyph = new Uint8Array(n);
      for (var y = 0; y < Math.min(r, f.rows); y++){
        for (var x = 0; x < Math.min(c, f.cols); x++){
          var a = y * f.cols + x, b = y * c + x;
          level[b] = f.level[a]; tone[b] = f.tone[a]; grey[b] = f.grey[a]; glyph[b] = f.glyph[a];
        }
      }
      f.cols = c; f.rows = r;
      f.section = new Uint8Array(n);
      f.level = level; f.tone = tone; f.grey = grey; f.glyph = glyph;
      buildTiles(f.tiles);
    }

    function step(dtMs){
      var dt = Math.min(dtMs / 1000, MAX_DT);
      f.real += dt;
      f.time += dt * PACE;
      assignSections();

      var gain = f.real < INTRO ? easeInOutSine(f.real / INTRO) : 1;
      var rise = RISE * dt, fall = FALL * dt;
      for (var y = 0; y < f.rows; y++){
        for (var x = 0; x < f.cols; x++){
          var i = y * f.cols + x, sec = f.section[i];
          var target = patternAt(sec, x, y) * gain, v = f.level[i];
          if (target > v) v = Math.min(target, v + rise);
          else v = Math.max(target, v - fall);
          var tone = toneOf(v);
          f.level[i] = v;
          f.tone[i] = tone;
          f.grey[i] = greyOf(tone);
          f.glyph[i] = tone ? SECTIONS[sec].glyphs[tone - 1] : 0;
        }
      }

      for (var ti = 0; ti < f.tiles.length; ti++){
        var t = f.tiles[ti];
        stepLargeCells(t, dt);
        if (t.from !== t.to){
          t.mix = easeInOutSine(Math.min(1, (f.time - t.t0) / SIZE_FADE));
          if (f.time - t.t0 >= SIZE_FADE){ t.from = t.to; t.mix = 1; }
          continue;
        }
        var want = sizeTarget(t);
        if (want !== t.to){ t.from = t.to; t.to = want; t.t0 = f.time; t.mix = 0; }
      }
    }

    /* A large cell shows the brightest thing under it, and only takes a
     * new glyph once its previous crossfade has finished. */
    function stepLargeCells(t, dt){
      for (var si = 1; si < SIZES.length; si++){
        var s = SIZES[si], n = TILE / s;
        for (var k = 0; k < n * n; k++){
          var c = t.cells[s][k];
          var x0 = t.x * TILE + (k % n) * s, y0 = t.y * TILE + Math.floor(k / n) * s, v = 0;
          /* A 1.5x glyph straddles cells, so take every cell it overlaps. */
          for (var y = Math.floor(y0); y < y0 + s && y < f.rows; y++)
            for (var x = Math.floor(x0); x < x0 + s && x < f.cols; x++) v = Math.max(v, f.level[y * f.cols + x]);
          c.u = Math.min(1, c.u + dt / GLYPH_FADE);
          var tone = toneOf(v), gr = greyOf(tone);
          var g = tone ? SECTIONS[f.section[Math.floor(y0) * f.cols + Math.floor(x0)]].glyphs[tone - 1] : 0;
          if (c.u >= 1 && (g !== c.glyph || gr !== c.grey)){
            c.fromGlyph = c.glyph; c.fromGrey = c.grey;
            c.glyph = g; c.grey = gr; c.u = 0;
          }
        }
      }
    }

    resize(cols, rows);
    /* Start the clock at a random point so two loads show different
     * phases of the same patterns, not just different seeds. */
    f.time = rnd() * 1000;
    return f;
  }

  var api = { createField: createField, SECTIONS: SECTIONS, GLYPHS: GLYPHS, CHARS: CHARS, TONES: TONES, GREYS: GREYS, TICK: TICK };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }

  /* === RENDERER === */
  var canvas = document.getElementById('field');
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d');
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  /* A cell pixel is 2 CSS px; larger sizes are the same bitmap with
   * chunkier pixels (3px at 1.5x, 4px at 2x). */
  var GW = 6, GH = 8, PX = 2;
  var CW = GW * PX, CH = GH * PX;
  var TICK_MS = TICK * 1000;
  var atlas = null, dpr = 1, field = null, raf = 0, last = 0, owed = 0;

  /* One row of glyphs per grey, drawn pixel by pixel: hard edges, no
   * antialiasing, and only the three greys ever reach the canvas. */
  function buildAtlas(){
    atlas = document.createElement('canvas');
    atlas.width = CHARS.length * GW; atlas.height = GREYS.length * GH;
    var g = atlas.getContext('2d'), img = g.createImageData(atlas.width, atlas.height);
    for (var ri = 1; ri < CHARS.length; ri++){
      var rows = GLYPHS[CHARS[ri]];
      for (var py = 0; py < rows.length; py++) for (var px = 0; px < rows[py].length; px++){
        if (rows[py].charAt(px) !== '#') continue;
        for (var gi = 0; gi < GREYS.length; gi++){
          var o = ((gi * GH + py) * atlas.width + ri * GW + px) * 4;
          img.data[o] = img.data[o + 1] = img.data[o + 2] = GREYS[gi]; img.data[o + 3] = 255;
        }
      }
    }
    g.putImageData(img, 0, 0);
  }

  function fit(){
    var w = window.innerWidth, h = window.innerHeight;
    var d = Math.min(window.devicePixelRatio || 1, 2);
    dpr = d;
    if (!atlas) buildAtlas();
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    var cols = Math.ceil(w / CW), rows = Math.ceil(h / CH);
    if (!field) field = createField(crypto.getRandomValues(new Uint32Array(1))[0], cols, rows, CH / CW);
    else field.resize(cols, rows);
  }

  function blit(s, glyph, grey, x, y, alpha){
    if (!glyph || alpha <= 0) return;
    if (alpha !== ctx.globalAlpha) ctx.globalAlpha = alpha;
    ctx.drawImage(atlas, glyph * GW, grey * GH, GW, GH,
      Math.round(x * CW * dpr), Math.round(y * CH * dpr), Math.round(s * CW * dpr), Math.round(s * CH * dpr));
  }

  function drawLayer(t, s, alpha){
    var x0 = t.x * TILE, y0 = t.y * TILE, cols = field.cols, rows = field.rows;
    if (s === 1){
      for (var y = y0; y < y0 + TILE && y < rows; y++)
        for (var x = x0; x < x0 + TILE && x < cols; x++){
          var i = y * cols + x;
          blit(1, field.glyph[i], field.grey[i], x, y, alpha);
        }
      return;
    }
    var n = TILE / s;
    for (var k = 0; k < n * n; k++){
      var c = t.cells[s][k], e = easeInOutSine(c.u);
      var cx = x0 + (k % n) * s, cy = y0 + Math.floor(k / n) * s;
      if (e < 1) blit(s, c.fromGlyph, c.fromGrey, cx, cy, alpha * (1 - e));
      blit(s, c.glyph, c.grey, cx, cy, alpha * e);
    }
  }

  function draw(){
    ctx.globalAlpha = 1;
    ctx.imageSmoothingEnabled = false;         // resizing the canvas resets it
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (var i = 0; i < field.tiles.length; i++){
      var t = field.tiles[i];
      if (t.from === t.to) drawLayer(t, t.to, 1);
      else { drawLayer(t, t.from, 1 - t.mix); drawLayer(t, t.to, t.mix); }
    }
  }

  /* The display runs at its own rate; the field only steps and redraws
   * once a tick is owed, so it moves on its own 12fps clock. */
  function frame(now){
    owed += last ? now - last : TICK_MS;
    last = now;
    if (owed >= TICK_MS){
      owed = Math.min(owed - TICK_MS, TICK_MS);
      field.step(TICK_MS);
      draw();
    }
    raf = requestAnimationFrame(frame);
  }
  function play(){
    if (raf || document.hidden) return;
    last = 0; owed = 0;
    raf = requestAnimationFrame(frame);
  }
  function pause(){
    cancelAnimationFrame(raf);
    raf = 0;
  }

  /* Reduced motion shows one settled frame and never starts the loop, so
   * cells uncovered by a resize have to be settled here or stay empty. */
  function settle(){
    for (var k = 0; k < 150; k++) field.step(TICK_MS);
  }

  function begin(){
    fit();
    /* Resizing a canvas clears it, so redraw in the same task: no frame
     * is ever painted empty. */
    window.addEventListener('resize', function(){
      fit();
      if (reduce) settle();
      draw();
    });
    if (reduce){
      settle();
      draw();
      return;
    }
    document.addEventListener('visibilitychange', function(){ if (document.hidden) pause(); else play(); });
    play();
  }

  begin();
})();
