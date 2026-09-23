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
    gapMin: 3, gapMax: 12,                     // s between glitches
    lenMin: 0.15, lenMax: 3,                   // s a glitch lasts
    lenSkew: 2.5,                              // above 1 most glitches are short
    stutter: 0,                                // chance a glitch comes as 2-3 quick ones
    swap: 'bands',                             // 'bands', or 'cut': the whole clip in one frame
    bandRows: 2,                               // cell rows per band
    swapWindow: 100,                           // ms the bands take to flip, each way
    ramp: 'field',                             // 'field' (the section under each cell), 0, 1, 2 (a section's ramp) or 'own'
    ownRamp: ['·', '-', '~', '≈', '▒', '▓'],
    toneLow: 0.3, toneHigh: 0.9,               // the brightness span the ramp is spread over
    boost: 0.35,                               // saturation and brightness lift, since glyphs on black read darker
    routes: 'home',                            // 'home': the clip leaves with the hero; 'all': it stays on every route
    dim: false                                 // with routes 'all', dim it while a page is open
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

  var api = { DEFAULTS: DEFAULTS, PARAMS: PARAMS, glitchGap: glitchGap, glitchLength: glitchLength, planEpisode: planEpisode, planSwap: planSwap, stepSwap: stepSwap, coverRects: coverRects, cellMean: cellMean, toneOf: toneOf, boost: boost };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }
})();
