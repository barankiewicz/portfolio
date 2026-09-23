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

  var TONES = 6;
  /* Glyphs come in 1x and two larger sizes picked from LARGE, laid out in
   * tiles of 6x6 cells; every size divides the tile. */
  var TILE = 6;
  var LARGE = [1.5, 2, 3];
  var INTRO = 1.6;                             // whole field fades up on load

  /* Every tunable value, read live on each tick so the tuning page can
   * change them while the field runs. Three sections sit side by side,
   * each with its own pattern, scale and 6-glyph ramp from sparse to
   * dense; the ramps end in shade blocks the sections share, which is
   * what lets them run into one another. */
  var DEFAULTS = {
    fps: 10,
    pace: 0.8,                                 // pattern seconds per real second
    rise: 1.8, fall: 1.6,                      // brightness slew per second, capped at one tone per tick
    threshold: 0.12,                           // below this a cell is empty
    gain: 1.8,                                 // overall brightness
    contrast: 2.45,                            // around mid grey; above 1 sharpens
    patterns: ['waves', 'waves', 'cells'],
    scales: [0.065, 0.26, 0.11],
    ramps: [['·', '∘', '○', '░', '▒', '▓'], ['.', ':', '+', '░', '▒', '▓'], ['.', ',', ';', '1', '0', '▒']],
    /* waveHigh below waveLow inverts the waves: the troughs glow. */
    waveSpeed: 0.9, ringWeight: 3, ringSpeed: 2.25, waveLow: 0.42, waveHigh: 0.07,
    cellJitter: 0.33, cellSpeed: 1.55, cellLow: 0.21, cellHigh: 1,
    maskScale: 0.115, maskSpeed: 0.04, maskLow: 0.35, maskHigh: 0.68,
    border1: 0.31, border2: 0.74, borderWobble: 0.29, borderJag: 0.19, borderBand: 16, borderSpeed: 0.09,
    pixel: 2,                                  // CSS px per glyph pixel; a cell is 6x8 glyph pixels
    midSize: 1.5, bigSize: 2,                  // the two larger sizes, from LARGE
    midAmount: 0.12, bigAmount: 0.34,          // how much of the field draws at each
    sizeScale: 0.3, sizeSpeed: 0.035,          // size patches: frequency, and how fast they change
    sizeFade: 1.4, glyphFade: 0.3,
    curve: 1,                                  // below 1 favours dense glyphs, above 1 sparse ones
    dither: 0,                                 // each cell's brightness scaled by up to +-dither/2, fixed per cell
    greyMid: 4, greyBright: 6,                 // tone at which the mid grey and white start
    greys: [123, 199, 255]
  };
  var PARAMS = JSON.parse(JSON.stringify(DEFAULTS));

  /* Pixel bitmaps, at most 6x8. Shade glyphs fill the whole cell so they
   * join up with their neighbours; the rest sit in 5x7 and keep a
   * one-pixel gap. More than the default ramps use, so ramps can be
   * changed on the tuning page. */
  var GLYPHS = {
    '.': ['.....', '.....', '.....', '.....', '.....', '.....', '..#..'],
    ',': ['.....', '.....', '.....', '.....', '.....', '..#..', '.#...'],
    ':': ['.....', '.....', '..#..', '.....', '.....', '..#..', '.....'],
    ';': ['.....', '.....', '..#..', '.....', '.....', '..#..', '.#...'],
    "'": ['..#..', '..#..', '.....', '.....', '.....', '.....', '.....'],
    '!': ['..#..', '..#..', '..#..', '..#..', '..#..', '.....', '..#..'],
    '?': ['.###.', '#...#', '....#', '...#.', '..#..', '.....', '..#..'],
    '-': ['.....', '.....', '.....', '#####', '.....', '.....', '.....'],
    '=': ['.....', '.....', '#####', '.....', '#####', '.....', '.....'],
    '+': ['.....', '..#..', '..#..', '#####', '..#..', '..#..', '.....'],
    '~': ['.....', '.....', '.#...', '#.#.#', '...#.', '.....', '.....'],
    '/': ['....#', '....#', '...#.', '..#..', '.#...', '#....', '#....'],
    '\\': ['#....', '#....', '.#...', '..#..', '...#.', '....#', '....#'],
    '|': ['..#..', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
    '<': ['...#.', '..#..', '.#...', '#....', '.#...', '..#..', '...#.'],
    '>': ['.#...', '..#..', '...#.', '....#', '...#.', '..#..', '.#...'],
    '*': ['.....', '..#..', '#.#.#', '.###.', '#.#.#', '..#..', '.....'],
    '#': ['.#.#.', '.#.#.', '#####', '.#.#.', '#####', '.#.#.', '.#.#.'],
    '%': ['##...', '##..#', '...#.', '..#..', '.#...', '#..##', '...##'],
    '@': ['.###.', '#...#', '#.###', '#.#.#', '#.###', '#....', '.####'],
    '&': ['.##..', '#..#.', '#.#..', '.#...', '#.#.#', '#..#.', '.##.#'],
    '$': ['..#..', '.####', '#.#..', '.###.', '..#.#', '####.', '..#..'],
    '0': ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
    '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
    'x': ['.....', '.....', '#...#', '.#.#.', '..#..', '.#.#.', '#...#'],
    'o': ['.....', '.....', '.###.', '#...#', '#...#', '#...#', '.###.'],
    'a': ['.....', '.....', '.###.', '....#', '.####', '#...#', '.####'],
    'e': ['.....', '.....', '.###.', '#...#', '#####', '#....', '.###.'],
    'i': ['..#..', '.....', '.##..', '..#..', '..#..', '..#..', '.###.'],
    'k': ['#....', '#....', '#..#.', '#.#..', '##...', '#.#..', '#..#.'],
    'l': ['.##..', '..#..', '..#..', '..#..', '..#..', '..#..', '.###.'],
    'q': ['.....', '.....', '.####', '#...#', '.####', '....#', '....#'],
    'y': ['.....', '.....', '#...#', '#...#', '.####', '....#', '.###.'],
    'z': ['.....', '.....', '#####', '...#.', '..#..', '.#...', '#####'],
    'M': ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
    'Q': ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
    'W': ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'],
    '·': ['.....', '.....', '.....', '..#..', '.....', '.....', '.....'],
    '∘': ['.....', '.....', '.###.', '.#.#.', '.###.', '.....', '.....'],
    '○': ['.....', '.###.', '#...#', '#...#', '#...#', '.###.', '.....'],
    '●': ['.....', '.###.', '#####', '#####', '#####', '.###.', '.....'],
    '◇': ['..#..', '.#.#.', '#...#', '.#.#.', '..#..', '.....', '.....'],
    '◆': ['..#..', '.###.', '#####', '.###.', '..#..', '.....', '.....'],
    '≈': ['.....', '.#..#', '#.##.', '.....', '.#..#', '#.##.', '.....'],
    '∴': ['.....', '..#..', '.....', '.....', '#...#', '.....', '.....'],
    '─': ['......', '......', '......', '######', '......', '......', '......', '......'],
    '│': ['..#...', '..#...', '..#...', '..#...', '..#...', '..#...', '..#...', '..#...'],
    '┼': ['..#...', '..#...', '..#...', '######', '..#...', '..#...', '..#...', '..#...'],
    '╬': ['.#.#..', '.#.#..', '##.###', '......', '##.###', '.#.#..', '.#.#..', '.#.#..'],
    '▚': ['###...', '###...', '###...', '###...', '...###', '...###', '...###', '...###'],
    '▞': ['...###', '...###', '...###', '...###', '###...', '###...', '###...', '###...'],
    '░': ['#.#.#.', '......', '#.#.#.', '......', '#.#.#.', '......', '#.#.#.', '......'],
    '▒': ['#.#.#.', '.#.#.#', '#.#.#.', '.#.#.#', '#.#.#.', '.#.#.#', '#.#.#.', '.#.#.#'],
    '▓': ['.#.#.#', '######', '.#.#.#', '######', '.#.#.#', '######', '.#.#.#', '######'],
    '█': ['######', '######', '######', '######', '######', '######', '######', '######']
  };
  /* Every glyph the field can draw; index 0 is the empty cell. */
  var CHARS = [' '].concat(Object.keys(GLYPHS));

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
   * summed, with their crests sharpened. Directions, relative wavelengths
   * and speeds are drawn per field; the scale is applied live. */
  function makeWaves(rnd){
    var planes = [];
    for (var k = 0; k < 3; k++){
      var a = rnd() * Math.PI * 2, n = 0.6 + rnd() * 0.8;
      planes.push({ kx: Math.cos(a) * n, ky: Math.sin(a) * n, w: 0.6 + rnd() * 0.9 });
    }
    return { planes: planes, ring: 0.7 + rnd() * 0.5, cx: rnd(), cy: rnd(), phase: rnd() * 100 };
  }
  function wavesAt(p, scale, x, y, t, cols, rows){
    var P = PARAMS, v = 0, ts = t * P.waveSpeed;
    for (var k = 0; k < 3; k++){
      var w = p.planes[k];
      v += 0.5 + 0.5 * Math.sin((w.kx * x + w.ky * y) * scale - w.w * ts);
    }
    var cx = cols * (p.cx + 0.3 * Math.sin(ts * 0.07 + p.phase));
    var cy = rows * (p.cy + 0.3 * Math.cos(ts * 0.05 + p.phase));
    var dx = x - cx, dy = y - cy;
    v += P.ringWeight * (0.5 + 0.5 * Math.sin(Math.sqrt(dx * dx + dy * dy) * p.ring * scale - ts * P.ringSpeed));
    return smoothstep(P.waveLow, P.waveHigh, v / (3 + P.ringWeight));
  }

  /* Cells: distance to the nearest of a jittered grid of points, each
   * point circling its own slot, so dark blobs breathe inside a bright
   * mesh. */
  function cellsAt(salt, scale, x, y, t){
    var P = PARAMS, X = x * scale, Y = y * scale, ix = Math.floor(X), iy = Math.floor(Y), best = 9;
    var ts = t * P.cellSpeed, r = P.cellJitter;
    for (var j = -1; j <= 1; j++){
      for (var i = -1; i <= 1; i++){
        var gx = ix + i, gy = iy + j;
        var a = hash3(salt, gx, gy, 0) * 6.2832, b = hash3(salt, gx, gy, 1) * 6.2832;
        var s = 0.4 + 0.5 * hash3(salt, gx, gy, 2);
        var px = gx + 0.5 + r * Math.sin(ts * s + a), py = gy + 0.5 + r * Math.cos(ts * s * 0.8 + b);
        var d = (X - px) * (X - px) + (Y - py) * (Y - py);
        if (d < best) best = d;
      }
    }
    return smoothstep(P.cellLow, P.cellHigh, Math.sqrt(best));
  }

  /* === FIELD === */
  function createField(seed, cols, rows, aspect){
    var rnd = mulberry32(seed);
    var f = {
      seed: seed | 0, cols: 0, rows: 0, aspect: aspect || 1,
      real: 0, time: 0,
      level: null, tone: null, grey: null, glyph: null, section: null,
      tiles: [], waves: [makeWaves(rnd), makeWaves(rnd), makeWaves(rnd)],
      step: step, resize: resize
    };
    var rampGlyphs = [[], [], []], toneStep = 1;

    function toneOf(v){
      if (v < PARAMS.threshold) return 0;
      return Math.min(TONES, 1 + Math.floor((v - PARAMS.threshold) / toneStep));
    }
    function greyOf(tone){
      return tone < PARAMS.greyMid ? 0 : tone < PARAMS.greyBright ? 1 : 2;
    }

    function glyphFor(sec, tone){
      return tone ? rampGlyphs[sec][tone - 1] : 0;
    }

    /* Tile size wanders with slow noise; hysteresis keeps a tile from
     * flickering between sizes at a threshold. */
    function sizeTarget(tile){
      var P = PARAMS, s = P.sizeScale;
      var n = noise3(f.seed ^ 0x5bd1e995, tile.x * s, tile.y * s * f.aspect, f.time * P.sizeSpeed);
      var margin = 0.03;                       // harder to enter a size than to stay in it
      var bigAt = 1 - P.bigAmount, midAt = bigAt - P.midAmount;
      if (n > (tile.to === P.bigSize ? bigAt - margin : bigAt + margin)) return P.bigSize;
      if (n > (tile.to === 1 ? midAt + margin : midAt - margin)) return P.midSize;
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
          for (var si = 0; si < LARGE.length; si++){
            var cells = t.cells[LARGE[si]] = [], count = Math.pow(TILE / LARGE[si], 2);
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
      var P = PARAMS, band = P.borderBand / f.cols, t = f.time * P.borderSpeed;
      for (var y = 0; y < f.rows; y++){
        var ya = y * f.aspect;
        var b1 = P.border1 + P.borderWobble * (noise3(f.seed ^ 0x27d4eb2d, ya * 0.05, t, 0) - 0.5)
                           + P.borderJag * (noise3(f.seed ^ 0x27d4eb2d, ya * 0.3, t * 3.75, 1) - 0.5);
        var b2 = P.border2 + P.borderWobble * (noise3(f.seed ^ 0x165667b1, ya * 0.05, t, 0) - 0.5)
                           + P.borderJag * (noise3(f.seed ^ 0x165667b1, ya * 0.3, t * 3.75, 1) - 0.5);
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
      var P = PARAMS, ya = y * f.aspect, t = f.time;
      var v = P.patterns[sec] === 'waves'
        ? wavesAt(f.waves[sec], P.scales[sec], x, ya, t, f.cols, f.rows * f.aspect)
        : cellsAt(f.seed ^ (sec * 0x9e3779b1), P.scales[sec], x, ya, t);
      var mask = smoothstep(P.maskLow, P.maskHigh, noise3(f.seed ^ 0x3c6ef372, x * P.maskScale, ya * P.maskScale, t * P.maskSpeed));
      v = Math.pow(Math.max(0, Math.min(1, (v - 0.5) * P.contrast + 0.5)), P.curve);
      /* Dither scales each cell's brightness by a fixed amount, so
       * neighbours at the same level show different glyphs. It is fixed
       * per cell, so it adds texture, not flicker, and it acts before the
       * slew, so it cannot make a cell jump; empty stays empty. */
      var dither = 1 + (hash3(f.seed, x, y, 11) - 0.5) * P.dither;
      return Math.min(1, v * mask * P.gain * dither);
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
      var P = PARAMS, tick = 1 / P.fps;
      var dt = Math.min(dtMs / 1000, tick);
      f.real += dt;
      f.time += dt * P.pace;
      toneStep = (1 - P.threshold) / TONES;
      for (var s = 0; s < 3; s++) for (var k = 0; k < TONES; k++) rampGlyphs[s][k] = Math.max(1, CHARS.indexOf(P.ramps[s][k]));
      assignSections();

      /* Brightness slews at most one tone per tick whatever the tuning:
       * the no-yank guarantee, so every appearance starts at its
       * section's faintest glyph. */
      var cap = toneStep * 0.95;
      var gain = f.real < INTRO ? easeInOutSine(f.real / INTRO) : 1;
      var rise = Math.min(P.rise * dt, cap), fall = Math.min(P.fall * dt, cap);
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
          f.glyph[i] = glyphFor(sec, tone);
        }
      }

      for (var ti = 0; ti < f.tiles.length; ti++){
        var t = f.tiles[ti];
        stepLargeCells(t, dt);
        if (t.from !== t.to){
          t.mix = easeInOutSine(Math.min(1, (f.time - t.t0) / (P.sizeFade * P.pace)));
          if (f.time - t.t0 >= P.sizeFade * P.pace){ t.from = t.to; t.mix = 1; }
          continue;
        }
        var want = sizeTarget(t);
        if (want !== t.to){ t.from = t.to; t.to = want; t.t0 = f.time; t.mix = 0; }
      }
    }

    /* A large cell shows the brightest thing under it, and only takes a
     * new glyph once its previous crossfade has finished. A 1x glyph
     * changing reads as texture, but a larger glyph swapping form in one
     * tick is a pop. */
    function stepLargeCells(t, dt){
      for (var si = 0; si < LARGE.length; si++){
        var s = LARGE[si], n = TILE / s;
        for (var k = 0; k < n * n; k++){
          var c = t.cells[s][k];
          var x0 = t.x * TILE + (k % n) * s, y0 = t.y * TILE + Math.floor(k / n) * s, v = 0;
          /* A 1.5x glyph straddles cells, so take every cell it overlaps. */
          for (var y = Math.floor(y0); y < y0 + s && y < f.rows; y++)
            for (var x = Math.floor(x0); x < x0 + s && x < f.cols; x++) v = Math.max(v, f.level[y * f.cols + x]);
          c.u = Math.min(1, c.u + dt / PARAMS.glyphFade);
          var tone = toneOf(v), gr = greyOf(tone);
          var g = glyphFor(f.section[Math.floor(y0) * f.cols + Math.floor(x0)], tone);
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

  var api = { createField: createField, PARAMS: PARAMS, DEFAULTS: DEFAULTS, GLYPHS: GLYPHS, CHARS: CHARS, TONES: TONES, LARGE: LARGE };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }

  /* === RENDERER === */
  var canvas = document.getElementById('field');
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d');
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  /* A cell is GWxGH glyph pixels of PARAMS.pixel CSS px each; larger sizes
   * are the same bitmap with chunkier pixels. */
  var GW = 6, GH = 8, PX = 0, CW = 0, CH = 0;
  var atlas = null, atlasGreys = '', dpr = 1, field = null, raf = 0, last = 0, owed = 0;

  /* One row of glyphs per grey, drawn pixel by pixel: hard edges, no
   * antialiasing, and only the three greys ever reach the canvas. */
  function buildAtlas(){
    var greys = PARAMS.greys;
    atlasGreys = greys.join();
    atlas = document.createElement('canvas');
    atlas.width = CHARS.length * GW; atlas.height = greys.length * GH;
    var g = atlas.getContext('2d'), img = g.createImageData(atlas.width, atlas.height);
    for (var ri = 1; ri < CHARS.length; ri++){
      var rows = GLYPHS[CHARS[ri]];
      for (var py = 0; py < rows.length; py++) for (var px = 0; px < rows[py].length; px++){
        if (rows[py].charAt(px) !== '#') continue;
        for (var gi = 0; gi < greys.length; gi++){
          var o = ((gi * GH + py) * atlas.width + ri * GW + px) * 4;
          img.data[o] = img.data[o + 1] = img.data[o + 2] = greys[gi]; img.data[o + 3] = 255;
        }
      }
    }
    g.putImageData(img, 0, 0);
  }

  function newField(cols, rows){
    field = createField(crypto.getRandomValues(new Uint32Array(1))[0], cols, rows, CH / CW);
  }

  function fit(){
    var w = window.innerWidth, h = window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    PX = PARAMS.pixel; CW = GW * PX; CH = GH * PX;
    if (!atlas) buildAtlas();
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    var cols = Math.ceil(w / CW), rows = Math.ceil(h / CH);
    if (!field) newField(cols, rows);
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
    if (PARAMS.greys.join() !== atlasGreys) buildAtlas();
    if (PARAMS.pixel !== PX) fit();
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
   * once a tick is owed, so it moves on its own clock (12fps by default). */
  function frame(now){
    var tickMs = 1000 / PARAMS.fps;
    owed += last ? now - last : tickMs;
    last = now;
    if (owed >= tickMs){
      owed = Math.min(owed - tickMs, tickMs);
      field.step(tickMs);
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
    for (var k = 0; k < 150; k++) field.step(1000 / PARAMS.fps);
  }

  /* The tuning page (.claude/review-02/tune.html) reaches the live values
   * and a reseed through this handle. */
  window.asciiField = {
    params: PARAMS,
    defaults: DEFAULTS,
    glyphs: Object.keys(GLYPHS),
    large: LARGE,
    reseed: function(){ newField(field.cols, field.rows); if (reduce){ settle(); draw(); } },
    /* What is on screen now: for each section, how many cells show each
     * tone of its ramp, plus the share of tiles at each size. */
    stats: function(){
      var tones = [[0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0]], cells = [0, 0, 0], lit = 0, sizes = {};
      for (var i = 0; i < field.tone.length; i++){
        var sec = field.section[i];
        cells[sec]++;
        if (field.tone[i]){ tones[sec][field.tone[i] - 1]++; lit++; }
      }
      field.tiles.forEach(function(t){ sizes[t.to] = (sizes[t.to] || 0) + 1 / field.tiles.length; });
      return { tones: tones, cells: cells, lit: lit / field.tone.length, sizes: sizes };
    }
  };

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
