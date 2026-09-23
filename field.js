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
  /* Glyphs come in 1x, a small 0.5x, and two larger sizes picked from
   * LARGE, laid out in tiles of 6x6 cells; every size divides the tile. */
  var TILE = 6;
  var LARGE = [1.5, 2, 3];
  var SMALL = 0.5, FINE = TILE / SMALL;         // a small tile is 12x12 quarter cells
  var INTRO = 1.6;                             // whole field fades up on load
  var SOFT_MS = 25, SOFT_FADE = 0.1;           // a soft hole's own clock, see softTick

  /* Every tunable value, read live on each tick so the tuning page can
   * change them while the field runs. Three sections sit side by side,
   * each with its own pattern, scale and 6-glyph ramp from sparse to
   * dense; the ramps end in shade blocks the sections share, which is
   * what lets them run into one another. */
  var DEFAULTS = {
    fps: 10,
    pace: 0.8,                                 // pattern seconds per real second
    rise: 1.8, fall: 1.6,                      // brightness slew per second, capped at one tone per tick
    threshold: 0.16,                           // below this a cell is empty
    gain: 1.8,                                 // overall brightness
    contrast: 2.45,                            // around mid grey; above 1 sharpens
    patterns: ['waves', 'waves', 'cells'],
    scales: [0.065, 0.26, 0.13],
    ramps: [['·', '∘', '○', '░', '▒', '▓'], ['.', 'x', 'y', '#', '▞', '▓'], ['.', ',', '+', '*', '0', '1']],
    /* waveHigh below waveLow inverts the waves: the troughs glow. */
    waveSpeed: 0.9, ringWeight: 3, ringSpeed: 2.25, waveLow: 0.42, waveHigh: 0.07,
    cellJitter: 0.5, cellSpeed: 1.55, cellLow: 0.21, cellHigh: 1,
    maskScale: 0.15, maskSpeed: 0.04, maskLow: 0.35, maskHigh: 0.68,
    border1: 0.31, border2: 0.74, borderWobble: 0.29, borderJag: 0.19, borderBand: 16, borderSpeed: 0.09,
    pixel: 2,                                  // CSS px per glyph pixel; a cell is 6x8 glyph pixels
    midSize: 1.5, bigSize: 2,                  // the two larger sizes, from LARGE
    midAmount: 0.11, bigAmount: 0.25,          // how much of the field draws at each
    smallAmount: 0.36,                         // how much draws at 0.5x; needs a glyph pixel of 2 or more
    sizeScale: 0.3, sizeSpeed: 0.035,          // size patches: frequency, and how fast they change
    sizeFade: 1.4, glyphFade: 0.3,
    curve: 1.3,                                // below 1 favours dense glyphs, above 1 sparse ones
    dither: 0.7,                               // each cell's brightness scaled by up to +-dither/2, fixed per cell
    greyMid: 4, greyBright: 6,                 // tone at which the mid grey and white start
    greys: [123, 199, 255],
    /* Cutouts: holes the field leaves around the page's text. Padding is
     * in cells on top of snapping outward, per side; rag lets each row
     * and column of that side's edge stick out by up to that many more
     * cells. The fill is the hole's grey (0 is the stage black) and fades
     * over cutFade seconds as a hole opens or closes. */
    cutPadL: 0.25, cutPadR: 8, cutPadT: 0, cutPadB: 0,
    cutRagL: 6, cutRagR: 0, cutRagT: 0, cutRagB: 0,
    cutFill: 9, cutFade: 0.05,
    /* How a hole sweeps open: in bands one cell row tall, each opening
     * over its own share of the timeline. Shuffle 0 is a top-down
     * cascade, 1 is scanline disorder; length is a band's share of the
     * timeline, jitter how much that varies from band to band. */
    bandShuffle: 0.7, bandLength: 0.35, bandJitter: 0.5
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
      level: null, tone: null, grey: null, glyph: null, section: null, cut: null, soft: null, fill: null,
      tiles: [], waves: [makeWaves(rnd), makeWaves(rnd), makeWaves(rnd)],
      step: step, resize: resize, setCutouts: setCutouts, softTick: softTick,
      fillOf: function(i){ var g = f.fillGrey[i]; return g < 0 ? PARAMS.cutFill | 0 : g; }
    };
    var rampGlyphs = [[], [], []], toneStep = 1, cutouts = [];

    function toneOf(v){
      if (v < PARAMS.threshold) return 0;
      return Math.min(TONES, 1 + Math.floor((v - PARAMS.threshold) / toneStep));
    }
    /* A soft cell drops exactly one tone per tick: to just under the
     * floor of the tone it shows. The capped slew would take a seventh
     * tick from full, and the sweep's --lag counts on six. */
    function softStep(v, tone){
      return tone ? PARAMS.threshold + (tone - 1) * toneStep - 1e-6 : Math.min(v, PARAMS.threshold - 1e-6);
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
      /* Below 2px a quarter-size glyph would need half-pixels and blur. */
      var smallAt = P.pixel >= 2 ? P.smallAmount : 0;
      if (n < (tile.to === SMALL ? smallAt + margin : smallAt - margin)) return SMALL;
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
    function shapeAt(sec, x, y){
      var P = PARAMS, ya = y * f.aspect, t = f.time;
      var v = P.patterns[sec] === 'waves'
        ? wavesAt(f.waves[sec], P.scales[sec], x, ya, t, f.cols, f.rows * f.aspect)
        : cellsAt(f.seed ^ (sec * 0x9e3779b1), P.scales[sec], x, ya, t);
      return Math.pow(Math.max(0, Math.min(1, (v - 0.5) * P.contrast + 0.5)), P.curve);
    }
    /* Everything that multiplies the shape for one cell: the resting mask,
     * the gain and the dither. It is smooth or fixed per cell, so a small
     * tile's four quarters share their cell's. Dither scales each cell's
     * brightness by a fixed amount, so neighbours at the same level show
     * different glyphs; being fixed it adds texture, not flicker, and it
     * acts before the slew, so it cannot make a cell jump. */
    function weightAt(x, y){
      var P = PARAMS, ya = y * f.aspect;
      var mask = smoothstep(P.maskLow, P.maskHigh, noise3(f.seed ^ 0x3c6ef372, x * P.maskScale, ya * P.maskScale, f.time * P.maskSpeed));
      var dither = 1 + (hash3(f.seed, x, y, 11) - 0.5) * P.dither;
      return mask * P.gain * dither;
    }

    function resize(c, r){
      var n = c * r;
      var level = new Float32Array(n), tone = new Uint8Array(n), grey = new Uint8Array(n), glyph = new Uint8Array(n), fill = new Float32Array(n);
      for (var y = 0; y < Math.min(r, f.rows); y++){
        for (var x = 0; x < Math.min(c, f.cols); x++){
          var a = y * f.cols + x, b = y * c + x;
          level[b] = f.level[a]; tone[b] = f.tone[a]; grey[b] = f.grey[a]; glyph[b] = f.glyph[a]; fill[b] = f.fill[a];
        }
      }
      f.cols = c; f.rows = r;
      f.section = new Uint8Array(n); f.shape = new Float32Array(n); f.weight = new Float32Array(n);
      f.level = level; f.tone = tone; f.grey = grey; f.glyph = glyph; f.fill = fill; f.soft = new Uint8Array(n);
      buildTiles(f.tiles);
      cutHoles();
    }

    /* === CUTOUTS ===
     * Boxes in cell units (fractions allowed) where the field draws
     * nothing. A box covers every cell it touches, so the hole's edge is
     * the cell grid and no glyph sits half inside it. Covering is instant:
     * everything under a hole is emptied on the call, not on the next
     * tick. Uncovering is not special: the cells start from empty and
     * rise under the usual one-tone-per-tick slew. Only the hole's fill
     * eases, in step, since a grey panel popping in would be a yank.
     * A box marked soft is a hole on its way: nothing is emptied on the
     * call, its cells fall to empty under the slew and its large glyphs
     * crossfade out, so an opening hole erodes the field instead of
     * punching it. A hard box wins where the two overlap. A box may
     * carry its own padR, which a hole sweeping open grows from zero.
     * A box may also carry its own pad and rag ([left, right, top,
     * bottom] in cells) and fill grey, for a hole that is not a text
     * hole (the cloud clip's); padR still wins on the right. */
    function setCutouts(list){
      cutouts = list || [];
      cutHoles();
    }
    function cutHoles(){
      var cols = f.cols, rows = f.rows, cut = f.cut = new Uint8Array(cols * rows);
      f.soft = new Uint8Array(cols * rows);
      /* a hole's own fill grey, or -1 for the global cutFill, read live */
      var grey = f.fillGrey = new Int16Array(cols * rows).fill(-1);
      for (var k = 0; k < cutouts.length; k++){
        var r = cutouts[k], mask = r.soft ? f.soft : cut, cells = boxCells(f.seed, r, PARAMS, cols, rows);
        for (var j = 0; j < cells.length; j++){ mask[cells[j]] = 1; if (r.fill != null) grey[cells[j]] = r.fill; }
      }
      for (var i = 0; i < cut.length; i++) if (cut[i]){ f.soft[i] = 0; f.level[i] = 0; f.tone[i] = 0; f.grey[i] = 0; f.glyph[i] = 0; }
      for (var ti = 0; ti < f.tiles.length; ti++){
        var t = f.tiles[ti];
        if (t.fine) for (var q = 0; q < FINE * FINE; q++){
          var qx = t.x * TILE + ((q % FINE) >> 1), qy = t.y * TILE + (Math.floor(q / FINE) >> 1);
          if (qx < cols && qy < rows && cut[qy * cols + qx]){ t.fine.level[q] = 0; t.fine.tone[q] = 0; t.fine.grey[q] = 0; t.fine.glyph[q] = 0; }
        }
        for (var si = 0; si < LARGE.length; si++){
          var s = LARGE[si], n = TILE / s;
          for (var c = 0; c < n * n; c++){
            var cell = t.cells[s][c];
            if (inCut(t.x * TILE + (c % n) * s, t.y * TILE + Math.floor(c / n) * s, s)){ cell.glyph = cell.fromGlyph = 0; cell.grey = cell.fromGrey = 0; cell.u = 1; }
          }
        }
      }
    }
    /* Between ticks, on the display's clock: a soft hole empties one
     * tone per SOFT_MS (at most one per call), and larger glyphs over it
     * crossfade out over SOFT_FADE seconds. Still one tone at a time, but
     * a full glyph is gone in ~150ms rather than the six ticks of the
     * field's own clock, so a sweep's text can follow its hole quickly.
     * Hole fills ease here as well as on the tick.
     * Returns whether anything changed, so the caller knows to redraw. */
    var softOwed = 0;
    function softTick(dtMs){
      var any = false, dt = dtMs / 1000;
      /* Hole fills ease per frame too, or a fast sweep's grey panel would
       * advance in the field's 100ms steps. */
      var gain = f.real < INTRO ? easeInOutSine(f.real / INTRO) : 1, fillStep = dt / PARAMS.cutFade;
      for (var fi = 0; fi < f.fill.length; fi++){
        var want = f.cut[fi] || f.soft[fi] ? gain : 0, was = f.fill[fi];
        if (want === was) continue;
        f.fill[fi] = want > was ? Math.min(want, was + fillStep) : Math.max(want, was - fillStep);
        any = true;
      }
      for (var ti = 0; ti < f.tiles.length; ti++){
        var t = f.tiles[ti];
        for (var si = 0; si < LARGE.length; si++){
          var sz = LARGE[si], n = TILE / sz;
          for (var c = 0; c < n * n; c++){
            var cell = t.cells[sz][c];
            if (!cell.glyph && cell.u >= 1) continue;
            if (!inMask(f.soft, t.x * TILE + (c % n) * sz, t.y * TILE + Math.floor(c / n) * sz, sz)) continue;
            if (cell.glyph){ cell.fromGlyph = cell.glyph; cell.fromGrey = cell.grey; cell.glyph = cell.grey = 0; cell.u = 0; }
            cell.u = Math.min(1, cell.u + dt / SOFT_FADE);
            any = true;
          }
        }
      }
      softOwed = Math.min(softOwed + dtMs, SOFT_MS);
      if (softOwed < SOFT_MS) return any;
      softOwed = 0;
      for (var i = 0; i < f.tone.length; i++){
        if (!f.soft[i] || !f.tone[i]) continue;
        f.level[i] = softStep(f.level[i], f.tone[i]);
        var tone = toneOf(f.level[i]);
        f.tone[i] = tone; f.grey[i] = greyOf(tone); f.glyph[i] = glyphFor(f.section[i], tone);
        any = true;
      }
      for (var tj = 0; tj < f.tiles.length; tj++){
        var q = f.tiles[tj].fine;
        if (!q) continue;
        var tx = f.tiles[tj].x * TILE, ty = f.tiles[tj].y * TILE;
        for (var k = 0; k < FINE * FINE; k++){
          var x = tx + ((k % FINE) >> 1), y = ty + (Math.floor(k / FINE) >> 1);
          if (x >= f.cols || y >= f.rows || !q.tone[k] || !f.soft[y * f.cols + x]) continue;
          q.level[k] = softStep(q.level[k], q.tone[k]);
          var qt = toneOf(q.level[k]);
          q.tone[k] = qt; q.grey[k] = greyOf(qt); q.glyph[k] = glyphFor(f.section[y * f.cols + x], qt);
          any = true;
        }
      }
      return any;
    }
    function inMask(mask, x0, y0, s){
      for (var y = Math.floor(y0); y < y0 + s && y < f.rows; y++)
        for (var x = Math.floor(x0); x < x0 + s && x < f.cols; x++) if (mask[y * f.cols + x]) return true;
      return false;
    }
    /* Whether a glyph of size s at (x0, y0) touches a cut cell. */
    function inCut(x0, y0, s){
      for (var y = Math.floor(y0); y < y0 + s && y < f.rows; y++)
        for (var x = Math.floor(x0); x < x0 + s && x < f.cols; x++) if (f.cut[y * f.cols + x]) return true;
      return false;
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
      var fillStep = dt / P.cutFade;
      for (var y = 0; y < f.rows; y++){
        for (var x = 0; x < f.cols; x++){
          var i = y * f.cols + x, sec = f.section[i];
          var want = f.cut[i] || f.soft[i] ? gain : 0;
          f.fill[i] = want > f.fill[i] ? Math.min(want, f.fill[i] + fillStep) : Math.max(want, f.fill[i] - fillStep);
          f.shape[i] = shapeAt(sec, x, y);
          f.weight[i] = weightAt(x, y) * gain;
          var target = Math.min(1, f.shape[i] * f.weight[i]), v = f.level[i];
          if (f.cut[i]) v = 0;
          else if (f.soft[i]) v = softStep(v, f.tone[i]);
          else if (target > v) v = Math.min(target, v + rise);
          else v = Math.max(target, v - fall);
          var tone = toneOf(v);
          f.level[i] = v;
          f.tone[i] = tone;
          f.grey[i] = greyOf(tone);
          f.glyph[i] = glyphFor(sec, tone);
        }
      }

      /* this tick was the soft cells' step for this frame */
      softOwed = 0;
      for (var ti = 0; ti < f.tiles.length; ti++){
        var t = f.tiles[ti];
        stepLargeCells(t, dt);
        if (t.from === SMALL || t.to === SMALL) stepFine(t, rise, fall);
        if (t.from !== t.to){
          t.mix = easeInOutSine(Math.min(1, (f.time - t.t0) / (P.sizeFade * P.pace)));
          if (f.time - t.t0 >= P.sizeFade * P.pace){ t.from = t.to; t.mix = 1; }
          continue;
        }
        var want = sizeTarget(t);
        if (want !== t.to){
          if (want === SMALL) seedFine(t);
          t.from = t.to; t.to = want; t.t0 = f.time; t.mix = 0;
        }
      }
    }

    /* A small tile splits every cell into four quarters, each with its
     * own brightness sampled from the pattern at its own corner, so the
     * four glyphs differ. The quarters start from their cell's brightness
     * so the switch does not pop, and slew under the same cap. */
    function seedFine(t){
      if (!t.fine) t.fine = { level: new Float32Array(FINE * FINE), tone: new Uint8Array(FINE * FINE), grey: new Uint8Array(FINE * FINE), glyph: new Uint8Array(FINE * FINE) };
      for (var k = 0; k < FINE * FINE; k++){
        var x = t.x * TILE + ((k % FINE) >> 1), y = t.y * TILE + (Math.floor(k / FINE) >> 1);
        if (x >= f.cols || y >= f.rows) continue;
        var i = y * f.cols + x;
        t.fine.level[k] = f.level[i]; t.fine.tone[k] = f.tone[i]; t.fine.grey[k] = f.grey[i]; t.fine.glyph[k] = f.glyph[i];
      }
    }
    function stepFine(t, rise, fall){
      if (!t.fine) seedFine(t);
      var q = t.fine;
      for (var k = 0; k < FINE * FINE; k++){
        var sx = k % FINE, sy = Math.floor(k / FINE);
        var x = t.x * TILE + (sx >> 1), y = t.y * TILE + (sy >> 1);
        if (x >= f.cols || y >= f.rows) continue;
        var i = y * f.cols + x, sec = f.section[i];
        /* The top-left quarter sits where the cell itself was sampled. */
        var shape = (sx & 1) || (sy & 1) ? shapeAt(sec, x + (sx & 1) * SMALL, y + (sy & 1) * SMALL) : f.shape[i];
        var target = Math.min(1, shape * f.weight[i]), v = q.level[k];
        if (f.cut[i]) v = 0;
        else if (f.soft[i]) v = softStep(v, q.tone[k]);
        else if (target > v) v = Math.min(target, v + rise);
        else v = Math.max(target, v - fall);
        var tone = toneOf(v);
        q.level[k] = v; q.tone[k] = tone; q.grey[k] = greyOf(tone); q.glyph[k] = glyphFor(sec, tone);
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
          var x0 = t.x * TILE + (k % n) * s, y0 = t.y * TILE + Math.floor(k / n) * s, v = 0, soft = false;
          /* A 1.5x glyph straddles cells, so take every cell it overlaps. */
          for (var y = Math.floor(y0); y < y0 + s && y < f.rows; y++)
            for (var x = Math.floor(x0); x < x0 + s && x < f.cols; x++){
              var j = y * f.cols + x;
              if (f.soft[j]) soft = true;
              v = Math.max(v, f.level[j]);
            }
          if (soft) v = 0;
          if (inCut(x0, y0, s)){ c.glyph = c.fromGlyph = c.grey = c.fromGrey = 0; c.u = 1; continue; }
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

  /* === HOLE CELLS ===
   * The cells one box's hole covers on a cols x rows grid, as indices:
   * the box snapped outward to whole cells, grown by its padding (its
   * own pad, padR on the right, or the params'), then each row and column
   * of each edge sticking out by up to its side's rag. Rag is hashed from
   * the seed and the edge's own position, so a box that has not moved
   * keeps the same outline. The field cuts its holes with this, and the
   * cloud clip cuts PORTFOLIO's hole in the video with it, so the two
   * holes are the same cells. */
  function boxCells(seed, r, P, cols, rows){
    var out = [];
    var pad = r.pad || [P.cutPadL, P.cutPadR, P.cutPadT, P.cutPadB], rag = r.rag || [P.cutRagL, P.cutRagR, P.cutRagT, P.cutRagB];
    var x0 = Math.floor(r.x0 - pad[0]), x1 = Math.ceil(r.x1 + (r.padR != null ? r.padR : pad[1]));
    var y0 = Math.floor(r.y0 - pad[2]), y1 = Math.ceil(r.y1 + pad[3]);
    if (x1 <= 0 || y1 <= 0 || x0 >= cols || y0 >= rows) return out;
    function ragAt(along, edge, side){ return Math.floor(hash3(seed, along, edge, 20 + side) * (Math.floor(rag[side]) + 1)); }
    function fill(a0, b0, a1, b1){
      a0 = Math.max(0, a0); b0 = Math.max(0, b0); a1 = Math.min(cols, a1); b1 = Math.min(rows, b1);
      for (var y = b0; y < b1; y++) for (var x = a0; x < a1; x++) out.push(y * cols + x);
    }
    fill(x0, y0, x1, y1);
    for (var y = y0; y < y1; y++){ fill(x0 - ragAt(y, x0, 0), y, x0, y + 1); fill(x1, y, x1 + ragAt(y, x1, 1), y + 1); }
    for (var x = x0; x < x1; x++){ fill(x, y0 - ragAt(x, y0, 2), x + 1, y0); fill(x, y1, x + 1, y1 + ragAt(x, y1, 3)); }
    return out;
  }

  /* === SWEEP BANDS ===
   * The windows [a, b] of a 0..1 timeline over which each of n bands
   * opens, fixed per seed. bandAt says how open a band is at a point of
   * the timeline, eased out so each band lands softly. The renderer
   * turns both into the hole and into the text mask, so the two always
   * agree. */
  function sweepBands(seed, n, P){
    var out = [];
    for (var i = 0; i < n; i++){
      var order = (1 - P.bandShuffle) * (n > 1 ? i / (n - 1) : 0) + P.bandShuffle * hash3(seed, i, 0, 30);
      var len = P.bandLength * (1 - P.bandJitter * hash3(seed, i, 1, 31));
      var a = order * (1 - len);
      out.push([a, a + len]);
    }
    return out;
  }
  function bandAt(w, c){
    var p = Math.max(0, Math.min(1, (c - w[0]) / (w[1] - w[0])));
    return p * (2 - p);
  }

  var api = { sweepBands: sweepBands, bandAt: bandAt, boxCells: boxCells, createField: createField, mulberry32: mulberry32, PARAMS: PARAMS, DEFAULTS: DEFAULTS, GLYPHS: GLYPHS, CHARS: CHARS, TONES: TONES, LARGE: LARGE, SMALL: SMALL };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }

  /* === RENDERER === */
  var canvas = document.getElementById('field');
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d');
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  /* A cell is GWxGH glyph pixels of PARAMS.pixel CSS px each; larger sizes
   * are the same bitmap with chunkier pixels. */
  var GW = 6, GH = 8, PX = 0, CW = 0, CH = 0;
  var ticks = [];                              // called after each field tick (the cloud clip's ASCII take)
  var atlas = null, atlasGreys = '', dpr = 1, field = null, raf = 0, last = 0, owed = 0, cutKey = '';

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
    cutKey = '';
    field.setCutouts(measure());
  }

  /* Holes follow the elements marked data-cutout: "text" cuts around
   * each line of the element's text, "block" one hole round all of it,
   * "box" round its border box and its children's (the nav strip, which
   * keeps covering the email when that is nudged out of line).
   * Measured in viewport px, handed to the model in cells.
   *
   * Inside an element marked data-cutout-clip (a scrolling page) holes
   * are cut to that element's box, less its --clip-top, so a block
   * scrolled under the nav takes only the visible part of its hole.
   *
   * An element also marked data-sweep opens and closes in bands one cell
   * row tall, driven by two timelines in its CSS, --cut and --txt, from
   * 0 to 1. Each band opens over its own window of the timeline
   * (sweepBands), from the element's left edge to its right edge plus the
   * hole's right padding. How far a band is open on --cut is soft hole,
   * the field eroding out of it; on --txt it is hard hole. The text mask
   * is written here from the same bands, one layer per band sized by the
   * same --txt expression, so text only ever shows where its band's hole
   * is hard. */
  /* syncBands deals an element its bands once per size and writes its
   * text mask from them; measure reuses the bands for the holes. */
  var sweeps = new WeakMap(), sweepSeq = 0;
  function num(v){ return +v.toFixed(4); }
  function syncBands(el, e){
    var P = PARAMS, st = sweeps.get(el);
    if (!st) sweeps.set(el, st = { seed: 0x2545f491 ^ (++sweepSeq * 0x9e3779b1), key: '' });
    var key = Math.round(e.width) + 'x' + Math.round(e.height) + ',' + CH + ',' + [P.bandShuffle, P.bandLength, P.bandJitter].join();
    if (st.key === key) return st;
    st.key = key;
    /* Bands start on the cell grid where the element sits now, so their
     * edges are the jagged teeth; scrolling carries them with it. */
    st.phase = ((e.top % CH) + CH) % CH;
    st.bands = sweepBands(st.seed, Math.ceil((e.height + st.phase) / CH), P);
    if (!reduce){
      var img = [], size = [], pos = [];
      for (var i = 0; i < st.bands.length; i++){
        var a = num(st.bands[i][0]), w = num(st.bands[i][1] - st.bands[i][0]);
        var q = 'clamp(0, (var(--txt) - ' + a + ') / ' + w + ', 1)';
        img.push('linear-gradient(#000,#000)');
        size.push('calc(' + q + ' * (2 - ' + q + ') * (100% + var(--cut-pad, 96px))) ' + CH + 'px');
        pos.push('0 ' + (i * CH - st.phase) + 'px');
      }
      var cs = el.style;
      cs.webkitMaskImage = cs.maskImage = img.join();
      cs.webkitMaskSize = cs.maskSize = size.join();
      cs.webkitMaskPosition = cs.maskPosition = pos.join();
      cs.webkitMaskRepeat = cs.maskRepeat = 'no-repeat';
    }
    return st;
  }
  var range = document.createRange(), watched = new WeakSet();
  var resizeWatch = window.ResizeObserver ? new ResizeObserver(function(){ sync(); }) : null;
  function boxOf(el){
    var r = el.getBoundingClientRect(), x0 = r.left, y0 = r.top, x1 = r.right, y1 = r.bottom, kids = el.querySelectorAll('*');
    for (var i = 0; i < kids.length; i++){
      var k = kids[i].getBoundingClientRect();
      if (k.width > 0 && k.height > 0){ x0 = Math.min(x0, k.left); y0 = Math.min(y0, k.top); x1 = Math.max(x1, k.right); y1 = Math.max(y1, k.bottom); }
    }
    return { left: x0, top: y0, right: x1, bottom: y1, width: x1 - x0, height: y1 - y0 };
  }
  var clips = new Map();
  function clipBox(el){
    var c = clips.get(el);
    if (!c){
      var r = el.getBoundingClientRect(), top = parseFloat(getComputedStyle(el).getPropertyValue('--clip-top')) || 0;
      clips.set(el, c = { left: r.left, top: r.top + top, right: r.right, bottom: r.bottom });
    }
    return c;
  }
  /* A hole's own pad, rag and fill, from data-cutout-pad / -rag ("left
   * right top bottom", in cells) and data-cutout-fill (a grey), for the
   * one hole that is not dressed like the text holes: the cloud clip. */
  function ownHole(el){
    var o = {}, pad = el.getAttribute('data-cutout-pad'), rag = el.getAttribute('data-cutout-rag'), fill = el.getAttribute('data-cutout-fill');
    if (pad) o.pad = pad.trim().split(/\s+/).map(Number);
    if (rag) o.rag = rag.trim().split(/\s+/).map(Number);
    if (fill) o.fill = +fill;
    return o;
  }
  var byEl = new Map();                        // each element's boxes from the last measure, for cutsOf
  function measure(){
    var els = document.querySelectorAll('[data-cutout]'), out = [], pad = PARAMS.cutPadR * CW;
    clips.clear();
    byEl = new Map();
    for (var i = 0; i < els.length; i++){
      var el = els[i], rects;
      if (resizeWatch && !watched.has(el)){ resizeWatch.observe(el); watched.add(el); }
      var mode = el.getAttribute('data-cutout');
      if (mode === 'box') rects = [boxOf(el)];
      else { range.selectNodeContents(el); rects = mode === 'block' ? [range.getBoundingClientRect()] : range.getClientRects(); }
      if (!rects.length || !(rects[0].width > 0)) continue;
      var own = ownHole(el), padPx = own.pad ? own.pad[1] * CW : pad, from = out.length;
      var clip = el.closest('[data-cutout-clip]'), c = clip && clipBox(clip);
      var sweep = null, e, cut = 1, txt = 1;
      if (el.hasAttribute('data-sweep')){
        var cs = getComputedStyle(el);
        cut = parseFloat(cs.getPropertyValue('--cut')); txt = parseFloat(cs.getPropertyValue('--txt'));
        if (isNaN(cut)) cut = 1;
        if (isNaN(txt)) txt = 1;
        e = mode === 'box' ? rects[0] : el.getBoundingClientRect();
        sweep = syncBands(el, e);
      }
      for (var k = 0; k < rects.length; k++){
        var r = rects[k], x0 = r.left, y0 = r.top, x1 = r.right, y1 = r.bottom;
        if (c){ x0 = Math.max(x0, c.left); y0 = Math.max(y0, c.top); x1 = Math.min(x1, c.right); y1 = Math.min(y1, c.bottom); }
        if (!(x1 > x0 && y1 > y0)) continue;
        if (!sweep){ out.push(Object.assign({ x0: x0 / CW, y0: y0 / CH, x1: x1 / CW, y1: y1 / CH }, own)); continue; }
        /* Each band's hole, padding included, stops at that band's front:
         * hard as far as --txt has opened it, soft on to --cut. */
        var top = e.top - sweep.phase, span = e.width + padPx;
        for (var b = 0; b < sweep.bands.length; b++){
          var by0 = Math.max(y0, top + b * CH), by1 = Math.min(y1, top + (b + 1) * CH);
          if (by1 <= by0) continue;
          var hard = bandAt(sweep.bands[b], txt), soft = bandAt(sweep.bands[b], cut);
          for (var f = 0; f < 2; f++){
            var o = f ? soft : hard;
            if (f && soft <= hard) break;
            var edge = Math.min(x1 + padPx, e.left + span * o);
            if (edge <= x0) continue;
            var right = Math.min(x1, edge);
            out.push(Object.assign({ x0: x0 / CW, y0: by0 / CH, x1: right / CW, y1: by1 / CH, padR: (edge - right) / CW, soft: !!f }, own));
          }
        }
      }
      byEl.set(el, out.slice(from));
    }
    return out;
  }
  /* Called every display frame and on anything that moves text, so a
   * hole is never a frame behind its text. Redraws at once when the
   * holes changed; the model has already emptied what they cover. */
  function sync(later){
    if (!field) return false;
    var boxes = measure(), P = PARAMS;
    var key = JSON.stringify(boxes) + [P.cutPadL, P.cutPadR, P.cutPadT, P.cutPadB, P.cutRagL, P.cutRagR, P.cutRagT, P.cutRagB].join();
    if (key === cutKey) return false;
    document.documentElement.style.setProperty('--cut-pad', P.cutPadR * CW + 'px');
    cutKey = key;
    field.setCutouts(boxes);
    if (reduce) settle();
    if (later === true) return true;
    draw();
    return true;
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
    if (s === SMALL){
      if (!t.fine) return;
      for (var q = 0; q < FINE * FINE; q++)
        blit(SMALL, t.fine.glyph[q], t.fine.grey[q], x0 + (q % FINE) * SMALL, y0 + Math.floor(q / FINE) * SMALL, alpha);
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

  var fillShown = -1;
  function draw(){
    if (PARAMS.greys.join() !== atlasGreys) buildAtlas();
    /* the regular holes' grey, for text that takes it (PORTFOLIO) */
    if ((PARAMS.cutFill | 0) !== fillShown){
      fillShown = PARAMS.cutFill | 0;
      document.documentElement.style.setProperty('--cut-fill', 'rgb(' + fillShown + ',' + fillShown + ',' + fillShown + ')');
    }
    if (PARAMS.pixel !== PX) fit();
    ctx.globalAlpha = 1;
    ctx.imageSmoothingEnabled = false;         // resizing the canvas resets it
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    /* Hole fills go under the glyphs, so a closing hole's glyphs fade in
     * over its fading fill. */
    var cols = field.cols, lastGrey = -1;
    for (var c = 0; c < field.fill.length; c++){
      var g = field.fillOf(c);
      if (field.fill[c] <= 0 || !g) continue;
      if (g !== lastGrey){ ctx.fillStyle = 'rgb(' + g + ',' + g + ',' + g + ')'; lastGrey = g; }
      var cx = c % cols, cy = (c - cx) / cols;
      var x0 = Math.round(cx * CW * dpr), y0 = Math.round(cy * CH * dpr);
      ctx.globalAlpha = field.fill[c];
      ctx.fillRect(x0, y0, Math.round((cx + 1) * CW * dpr) - x0, Math.round((cy + 1) * CH * dpr) - y0);
    }
    ctx.globalAlpha = 1;
    for (var i = 0; i < field.tiles.length; i++){
      var t = field.tiles[i];
      if (t.from === t.to) drawLayer(t, t.to, 1);
      else { drawLayer(t, t.from, 1 - t.mix); drawLayer(t, t.to, t.mix); }
    }
  }

  /* The display runs at its own rate; the field only steps and redraws
   * once a tick is owed, so it moves on its own clock (12fps by default). */
  function frame(now){
    var tickMs = 1000 / PARAMS.fps, dt = last ? now - last : tickMs, dirty = false;
    owed += dt;
    last = now;
    if (owed >= tickMs){
      owed = Math.min(owed - tickMs, tickMs);
      field.step(tickMs);
      dirty = true;
      for (var k = 0; k < ticks.length; k++) ticks[k]();
    }
    /* holes first, so a hole that just went soft starts fading this frame */
    if (sync(true)) dirty = true;
    if (field.softTick(Math.min(dt, tickMs))) dirty = true;
    if (dirty) draw();
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

  /* The tuning pages (.claude/review-02/tune.html for the field,
   * .claude/review-04/tune.html for the cutouts) reach the live values, a
   * reseed and the cut cells through this handle. */
  window.asciiField = {
    params: PARAMS,
    defaults: DEFAULTS,
    glyphs: Object.keys(GLYPHS),
    bitmaps: GLYPHS,
    large: LARGE,
    reseed: function(){ newField(field.cols, field.rows); cutKey = ''; sync(); },
    /* re-measure the holes now, for a cutout that appears on its own */
    sync: function(){ sync(); },
    /* The cells an element's hole covers right now, hard and soft, as
     * indices on the field's grid: the cloud clip cuts the same hole in
     * the video for PORTFOLIO, so it tears open with the same bands. */
    cutsOf: function(el){
      var boxes = byEl.get(el) || [], out = [];
      for (var i = 0; i < boxes.length; i++) out = out.concat(boxCells(field.seed, boxes[i], PARAMS, field.cols, field.rows));
      return out;
    },
    /* The cut cells, for the tuning page's hole overlay, and the soft
     * cells and tones, for the review probes. */
    holes: function(){ return { cols: field.cols, rows: field.rows, cw: CW, ch: CH, cut: field.cut, soft: field.soft, tone: field.tone, fill: field.fill, section: field.section }; },
    ticks: ticks,
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
    /* A web font arriving reflows the text; a focused skip link moves
     * on screen without changing size. */
    if (document.fonts) document.fonts.addEventListener('loadingdone', sync);
    document.addEventListener('focusin', sync);
    document.addEventListener('focusout', function(){ setTimeout(sync); });
    window.addEventListener('hashchange', sync);
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
