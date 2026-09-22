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

  /* Three sections side by side, each with its own glyphs ordered sparse
   * to dense by ink. A cell's tone (1-6) picks the glyph from its
   * section's ramp; tone 0 is an empty cell. */
  var SECTIONS = [
    { name: 'lattice', ramp: ['.', ':', ':', '+', '*', '#'] },
    { name: 'signal',  ramp: ['-', '=', '+', '*', '%', '#'] },
    { name: 'dash',    ramp: ['.', '-', '-', '=', '=', '#'] }
  ];
  var TONES = 6;
  /* Every glyph the field can draw; index 0 is the empty cell. */
  var CHARS = [' '];
  SECTIONS.forEach(function(sec){
    sec.glyphs = sec.ramp.map(function(ch){
      if (CHARS.indexOf(ch) < 0) CHARS.push(ch);
      return CHARS.indexOf(ch);
    });
  });
  /* Three greys, dim to white: tones 1-2, 3-4 and 5-6. */
  var GREYS = [96, 170, 255];

  var THRESHOLD = 0.05;                        // below this a cell is empty
  var TONE_STEP = (1 - THRESHOLD) / TONES;
  /* The field steps at film rate, like the reference, not at the
   * display's rate. */
  var TICK = 1 / 24;
  /* Brightness slews at most this fast, so a cell can only move one tone
   * per tick (RISE * TICK < TONE_STEP). That is the no-yank guarantee:
   * every appearance starts at its section's faintest glyph. */
  var RISE = 3.4;                              // per second, 0 to 1 in 290ms
  var FALL = 2;                                // per second, 1 to 0 in 500ms
  var MAX_DT = TICK;
  var FLICKER = 0.5;                           // lit cells jitter +-25% on each re-roll
  var FLICKER_RATE = 24;                       // re-rolls per second of field time
  /* The field's clock runs slow most of the time and now and then bursts
   * ahead for a fraction of a second. Motion, borders and flicker follow
   * the clock; the slew stays on real time, so a burst still moves each
   * cell at most one tone per tick. */
  var TEMPO = 0.45;
  var BURST_GAP = [3, 7], BURST_LENGTH = [0.4, 0.8], BURST_PEAK = [2.5, 3.5];
  var INTRO = 1.6;                             // whole field fades up on load
  var TILE = 6;                                // a tile is 6x6 base cells
  var SIZES = [1, 1.5, 2];                     // glyph sizes, in cells; each divides TILE
  var SIZE_FADE = 1.4;                         // size crossfade, seconds
  /* A 1x glyph changing reads as flicker, but a larger glyph swapping
   * form in one tick is a pop, so large cells crossfade each change. */
  var GLYPH_FADE = 0.18;

  function toneOf(v){
    if (v < THRESHOLD) return 0;
    return Math.min(TONES, 1 + Math.floor((v - THRESHOLD) / TONE_STEP));
  }
  function greyOf(tone){
    return tone ? Math.min(GREYS.length - 1, Math.floor((tone - 1) / 2)) : 0;
  }

  function easeInOutSine(u){ return 0.5 - 0.5 * Math.cos(Math.PI * u); }
  function easeOutCubic(u){ var i = 1 - u; return 1 - i * i * i; }
  function smoothstep(a, b, x){
    var u = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return u * u * (3 - 2 * u);
  }
  /* Build up, hold, die down. The share of life spent rising and falling
   * is what makes a region swell rather than switch on. */
  function envelope(u){
    if (u <= 0 || u >= 1) return 0;
    if (u < 0.3) return easeInOutSine(u / 0.3);
    if (u < 0.6) return 1;
    return easeInOutSine((1 - u) / 0.4);
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

  /* === MOTIFS ===
   * Each motif lives in a bounded region with its own envelope, so most of
   * the field is quiet at any moment and motion arrives, builds, and dies. */

  /* Swell: crests rolling through an elliptical region. */
  function makeWave(rnd, cols, rows){
    var a = rnd() * Math.PI * 2;
    return {
      kind: 'wave',
      cx: rnd() * cols, cy: rnd() * rows,
      r: 18 + rnd() * 26,
      dx: Math.cos(a), dy: Math.sin(a),
      k: Math.PI * 2 / (10 + rnd() * 16),
      speed: 8 + rnd() * 10,
      amp: 0.45 + rnd() * 0.3,
      life: 7 + rnd() * 6, age: 0
    };
  }
  function applyWave(m, f){
    var e = envelope(m.age / m.life) * m.amp;
    if (e <= 0) return;
    var r2 = m.r * m.r, shift = m.k * m.speed * m.age;
    eachInRadius(m, f, function(i, dx, dy){
      var mask = regionMask((dx * dx + dy * dy) / r2);
      var crest = 0.5 + 0.5 * Math.cos(m.k * (dx * m.dx + dy * m.dy) - shift);
      crest *= crest; crest *= crest;
      f.acc[i] *= 1 - e * mask * crest;
    });
  }

  /* Drift: wisps of noise sliding slowly across a large region. */
  function makeDrift(rnd, cols, rows){
    var a = rnd() * Math.PI * 2, v = 0.8 + rnd() * 1.4;
    return {
      kind: 'drift',
      cx: rnd() * cols, cy: rnd() * rows,
      r: 24 + rnd() * 32,
      vx: Math.cos(a) * v, vy: Math.sin(a) * v,
      scale: 0.06 + rnd() * 0.05,
      amp: 0.3 + rnd() * 0.25,
      life: 12 + rnd() * 10, age: 0
    };
  }
  function applyDrift(m, f){
    var e = envelope(m.age / m.life) * m.amp;
    if (e <= 0) return;
    var r2 = m.r * m.r, a = f.aspect, ox = m.vx * m.age, oy = m.vy * m.age, z = m.age * 0.12;
    eachInRadius(m, f, function(i, dx, dy, x, y){
      var mask = regionMask((dx * dx + dy * dy) / r2);
      var n = noise3(f.seed, (x - ox) * m.scale, (y * a - oy) * m.scale, z);
      f.acc[i] *= 1 - e * mask * smoothstep(0.52, 0.85, n);
    });
  }

  /* Star: one cell flares quickly and fades slowly. */
  function makeStar(rnd, cols, rows){
    return {
      kind: 'star',
      x: Math.floor(rnd() * cols), y: Math.floor(rnd() * rows),
      amp: 0.4 + rnd() * 0.4,
      life: 1.2 + rnd() * 1.4, age: 0
    };
  }
  function applyStar(m, f){
    if (m.x >= f.cols || m.y >= f.rows) return;
    var attack = 0.18, v;
    if (m.age < attack) v = easeOutCubic(m.age / attack);
    else { var u = (m.age - attack) / (m.life - attack); v = (1 - u) * (1 - u); }
    var i = m.y * f.cols + m.x;
    f.acc[i] *= 1 - m.amp * v;
  }

  /* Streak: a horizontal run that flashes on and burns out, mostly in the
   * middle section. One or two rows tall, with gaps and ragged ends. */
  function makeStreak(rnd, cols, rows){
    return {
      kind: 'streak',
      cx: cols * (0.5 + (rnd() - 0.5) * 0.5), y: Math.floor(rnd() * rows),
      h: rnd() < 0.3 ? 2 : 1, len: 8 + rnd() * 52,
      amp: 0.55 + rnd() * 0.45,
      life: 0.5 + rnd() * 1.3, age: 0,
      id: Math.floor(rnd() * 1e9)
    };
  }
  function applyStreak(m, f){
    var u = m.age / m.life;
    var e = m.amp * (u < 0.1 ? easeOutCubic(u / 0.1) : Math.pow(1 - (u - 0.1) / 0.9, 2));
    var left = m.cx - m.len / 2, right = m.cx + m.len / 2;
    var x0 = Math.max(0, Math.floor(left)), x1 = Math.min(f.cols - 1, Math.ceil(right));
    for (var y = m.y; y < m.y + m.h && y < f.rows; y++){
      for (var x = x0; x <= x1; x++){
        var edge = Math.min(x - left, right - x) / 4;
        if (hash3(m.id, x, y, 0) > Math.min(1, edge) * 0.85) continue;
        f.acc[y * f.cols + x] *= 1 - e * (0.6 + 0.4 * hash3(m.id, x, y, 1));
      }
    }
  }

  /* Flat across most of the region, easing to nothing at its rim. */
  function regionMask(d2){
    return 1 - smoothstep(0.45, 1, Math.sqrt(d2));
  }

  function eachInRadius(m, f, fn){
    var a = f.aspect, ry = m.r / a;
    var x0 = Math.max(0, Math.floor(m.cx - m.r)), x1 = Math.min(f.cols - 1, Math.ceil(m.cx + m.r));
    var y0 = Math.max(0, Math.floor(m.cy - ry)), y1 = Math.min(f.rows - 1, Math.ceil(m.cy + ry));
    var r2 = m.r * m.r;
    for (var y = y0; y <= y1; y++){
      var dy = (y + 0.5 - m.cy) * a;
      for (var x = x0; x <= x1; x++){
        var dx = x + 0.5 - m.cx;
        if (dx * dx + dy * dy >= r2) continue;
        fn(y * f.cols + x, dx, dy, x, y);
      }
    }
  }

  var MOTIFS = {
    /* mean seconds between spawns per 8000 cells, cap per 8000 cells */
    wave:   { make: makeWave,   apply: applyWave,   every: 4,    cap: 1.2 },
    drift:  { make: makeDrift,  apply: applyDrift,  every: 4.5,  cap: 2   },
    star:   { make: makeStar,   apply: applyStar,   every: 0.06, cap: 90  },
    streak: { make: makeStreak, apply: applyStreak, every: 0.04, cap: 30  }
  };

  /* === FIELD === */
  function createField(seed, cols, rows, aspect){
    var rnd = mulberry32(seed);
    var f = {
      seed: seed | 0, cols: 0, rows: 0, aspect: aspect || 1,
      real: 0, time: 0, tempo: TEMPO, burst: null, nextBurst: 0, flicker: 0,
      acc: null, level: null, tone: null, grey: null, glyph: null, section: null,
      tiles: [], motifs: [], next: {},
      step: step, resize: resize
    };

    function area(){ return f.cols * f.rows / 8000; }
    function countOf(kind){
      var n = 0;
      for (var i = 0; i < f.motifs.length; i++) if (f.motifs[i].kind === kind) n++;
      return n;
    }
    function scheduleNext(kind){
      var mean = MOTIFS[kind].every / Math.max(area(), 0.05);
      f.next[kind] = f.time - Math.log(1 - rnd()) * mean;
    }

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

    /* Each section's resting texture: patches of a dim dot lattice on
     * the left that grow and shrink, sparse dashes blinking on the right,
     * nothing in the middle but what the motifs bring. */
    function applyGround(){
      var t = f.time, blink = Math.floor(t * 0.7);
      for (var y = 0; y < f.rows; y++){
        for (var x = 0; x < f.cols; x++){
          var i = y * f.cols + x, sec = f.section[i];
          if (sec === 0){
            var n = noise3(f.seed ^ 0x3c6ef372, x * 0.05, y * f.aspect * 0.05, t * 0.05);
            f.acc[i] *= 1 - 0.3 * smoothstep(0.5, 0.62, n);
          } else if (sec === 2 && hash3(f.seed, x, y, blink) < 0.04){
            f.acc[i] *= 1 - 0.25;
          }
        }
      }
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
      f.acc = new Float32Array(n); f.section = new Uint8Array(n);
      f.level = level; f.tone = tone; f.grey = grey; f.glyph = glyph;
      buildTiles(f.tiles);
    }

    function between(r){ return r[0] + rnd() * (r[1] - r[0]); }

    /* Tempo eases up to the burst's peak over its first 30% and back down
     * over the rest. */
    function stepTempo(){
      if (!f.burst && f.real >= f.nextBurst) f.burst = { t0: f.real, length: between(BURST_LENGTH), peak: between(BURST_PEAK) };
      if (!f.burst){ f.tempo = TEMPO; return; }
      var u = (f.real - f.burst.t0) / f.burst.length;
      if (u >= 1){ f.burst = null; f.tempo = TEMPO; f.nextBurst = f.real + between(BURST_GAP); return; }
      var shape = u < 0.3 ? easeInOutSine(u / 0.3) : easeInOutSine((1 - u) / 0.7);
      f.tempo = TEMPO + (f.burst.peak - TEMPO) * shape;
    }

    function step(dtMs){
      var dt = Math.min(dtMs / 1000, MAX_DT);
      f.real += dt;
      stepTempo();
      var ft = dt * f.tempo;
      f.time += ft;
      f.flicker += ft * FLICKER_RATE;

      for (var kind in MOTIFS){
        while (f.time >= f.next[kind]){
          if (countOf(kind) < Math.ceil(MOTIFS[kind].cap * area())) f.motifs.push(MOTIFS[kind].make(rnd, f.cols, f.rows));
          scheduleNext(kind);
        }
      }

      var acc = f.acc, n = acc.length, i;
      for (i = 0; i < n; i++) acc[i] = 1;
      var live = [];
      for (i = 0; i < f.motifs.length; i++){
        var m = f.motifs[i];
        m.age += ft;
        if (m.age >= m.life) continue;
        MOTIFS[m.kind].apply(m, f);
        live.push(m);
      }
      f.motifs = live;
      assignSections();
      applyGround();

      var gain = f.real < INTRO ? easeInOutSine(f.real / INTRO) : 1;
      var roll = Math.floor(f.flicker);
      var rise = RISE * dt, fall = FALL * dt;
      for (i = 0; i < n; i++){
        var target = (1 - acc[i]) * gain, v = f.level[i];
        /* Lit cells jitter every tick; the slew keeps it to one tone. */
        if (target > THRESHOLD) target *= 1 - FLICKER / 2 + FLICKER * hash3(f.seed, i, roll, 3);
        if (target > v) v = Math.min(target, v + rise);
        else v = Math.max(target, v - fall);
        var tone = toneOf(v);
        f.level[i] = v;
        f.tone[i] = tone;
        f.grey[i] = greyOf(tone);
        f.glyph[i] = tone ? SECTIONS[f.section[i]].glyphs[tone - 1] : 0;
      }

      for (i = 0; i < f.tiles.length; i++){
        var t = f.tiles[i];
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
    /* Start with motifs already mid-life so the field arrives populated,
     * while the intro gain and the slew still bring every cell up from
     * empty. */
    for (var kind in MOTIFS){
      var count = Math.round(MOTIFS[kind].cap * area() * 0.6);
      for (var k = 0; k < count; k++){
        var m = MOTIFS[kind].make(rnd, f.cols, f.rows);
        m.age = rnd() * m.life * 0.7;
        f.motifs.push(m);
      }
      scheduleNext(kind);
    }
    f.nextBurst = between(BURST_GAP);
    return f;
  }

  var api = { createField: createField, envelope: envelope, SECTIONS: SECTIONS, CHARS: CHARS, TONES: TONES, GREYS: GREYS, TICK: TICK };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }

  /* === RENDERER === */
  var canvas = document.getElementById('field');
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d');
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  /* Glyphs are hand-drawn 5x7 pixel bitmaps in a 6x8 cell, so there is
   * always a one-pixel gap between neighbours. A cell pixel is 2 CSS px;
   * larger sizes are the same bitmap with chunkier pixels (3px at 1.5x,
   * 4px at 2x). */
  var GLYPHS = {
    '.': ['.....', '.....', '.....', '.....', '.....', '.....', '..#..'],
    ':': ['.....', '.....', '..#..', '.....', '.....', '..#..', '.....'],
    '-': ['.....', '.....', '.....', '#####', '.....', '.....', '.....'],
    '+': ['.....', '..#..', '..#..', '#####', '..#..', '..#..', '.....'],
    '=': ['.....', '.....', '#####', '.....', '#####', '.....', '.....'],
    '*': ['.....', '..#..', '#.#.#', '.###.', '#.#.#', '..#..', '.....'],
    '%': ['##...', '##..#', '...#.', '..#..', '.#...', '#..##', '...##'],
    '#': ['.#.#.', '.#.#.', '#####', '.#.#.', '#####', '.#.#.', '.#.#.']
  };
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
      for (var py = 0; py < rows.length; py++) for (var px = 0; px < 5; px++){
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
   * once a tick is owed, so it moves on its 24fps clock. */
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
