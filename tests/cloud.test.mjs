// Run from the repo root with: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { mulberry32, TONES, createField } = require('../field.js');
const { DEFAULTS, glitchGap, glitchLength, planEpisode, planSwap, stepSwap, coverRects, cellMean, toneOf, boost, blendShows, blendBackdrop, blendFade, edgeDistance, edgeWeight } = require('../cloud.js');

const P = (over) => ({ ...DEFAULTS, ...over });

test('gaps and lengths stay inside their min and max for any seed', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const rnd = mulberry32(seed), p = P({ gapMin: 2, gapMax: 9, lenMin: 0.2, lenMax: 2.5 });
    for (let k = 0; k < 50; k++) {
      const g = glitchGap(rnd, p), l = glitchLength(rnd, p);
      assert.ok(g >= 2000 && g <= 9000, `gap ${g}`);
      assert.ok(l >= 200 && l <= 2500, `length ${l}`);
    }
  }
});

test('under the default skew most glitches are short', () => {
  const rnd = mulberry32(5), p = P(), n = 5000;
  const third = p.lenMin + (p.lenMax - p.lenMin) / 3;
  let short = 0;
  for (let k = 0; k < n; k++) if (glitchLength(rnd, p) <= third * 1000) short++;
  assert.ok(short / n > 0.6, `only ${(100 * short / n).toFixed(0)}% in the short third`);
  let flat = 0;
  const q = P({ lenSkew: 1 });
  for (let k = 0; k < n; k++) if (glitchLength(rnd, q) <= third * 1000) flat++;
  assert.ok(Math.abs(flat / n - 1 / 3) < 0.05, 'a skew of 1 is not uniform');
});

test('an episode is one glitch without stutter, and two or three quick ones with it', () => {
  for (let seed = 1; seed <= 100; seed++) {
    const one = planEpisode(mulberry32(seed), P({ stutter: 0 }));
    assert.equal(one.length, 1);
    assert.equal(one[0].at, 0);
    const many = planEpisode(mulberry32(seed), P({ stutter: 1 }));
    assert.ok(many.length === 2 || many.length === 3, `${many.length} glitches`);
    for (let k = 1; k < many.length; k++) {
      assert.ok(many[k].at > many[k - 1].at + many[k - 1].len, 'stutter glitches overlap');
      assert.ok(many[k].len <= 2 * DEFAULTS.lenMin * 1000 + 1e-9, 'a stutter glitch is not quick');
    }
  }
});

/* Runs a swap on a display clock and reports every frame's flips. */
function runSwap(bands, dt, until) {
  const shown = new Uint8Array(bands.length), frames = [];
  for (let t = 0; t <= until; t += dt) {
    const before = Uint8Array.from(shown);
    stepSwap(bands, shown, t);
    const flipped = [];
    for (let b = 0; b < bands.length; b++) if (shown[b] !== before[b]) flipped.push(b);
    frames.push({ t, flipped, on: shown.reduce((a, v) => a + v, 0) });
  }
  return { shown, frames };
}

test('bands: no frame flips more than one band, and every row is back on video when the glitch ends', () => {
  for (const dt of [8, 16.7, 33, 100]) for (const bandRows of [1, 2, 3]) for (let seed = 1; seed <= 30; seed++) {
    const rows = 13, len = glitchLength(mulberry32(seed), P());
    const bands = planSwap(mulberry32(seed + 99), rows, P({ bandRows }), len);
    for (const b of bands) assert.ok(b.r1 - b.r0 <= bandRows && b.r1 > b.r0);
    const { shown, frames } = runSwap(bands, dt, len + 5000);
    for (const f of frames) assert.ok(f.flipped.length <= 1, `${f.flipped.length} bands flipped at ${f.t}ms`);
    assert.ok(shown.every((v) => v === 0), 'a band is still on the ASCII take');
    assert.ok(frames.some((f) => f.on > 0) || len < DEFAULTS.swapWindow, 'the take never showed');
  }
});

test('bands: rows are covered once each, and the flips land in random order', () => {
  const bands = planSwap(mulberry32(3), 13, P({ bandRows: 2 }), 1000);
  const rows = [];
  for (const b of bands) for (let r = b.r0; r < b.r1; r++) rows.push(r);
  assert.deepEqual(rows.sort((a, b) => a - b), [...Array(13).keys()]);
  const byOn = [...bands].sort((a, b) => a.on - b.on).map((b) => b.r0);
  assert.notDeepEqual(byOn, bands.map((b) => b.r0), 'bands flip top to bottom');
  for (const b of bands) assert.ok(b.on >= 0 && b.on <= DEFAULTS.swapWindow && b.off >= 1000 && b.off <= 1000 + DEFAULTS.swapWindow);
});

test('hard cut: the whole clip swaps in one frame, in and out', () => {
  const bands = planSwap(mulberry32(3), 13, P({ swap: 'cut' }), 800);
  assert.equal(bands.length, 1);
  assert.deepEqual([bands[0].r0, bands[0].r1, bands[0].on, bands[0].off], [0, 13, 0, 800]);
  const { shown } = runSwap(bands, 16.7, 900);
  assert.equal(shown[0], 0);
});

test("a cell's colour is the mean of the pixels under it", () => {
  // a 4x2 two-frame source; frame 1 is frame 0 inverted
  const sw = 4, sh = 2, px = [[10, 20, 30], [50, 60, 70], [90, 100, 110], [130, 140, 150], [0, 0, 0], [40, 40, 40], [80, 80, 80], [255, 255, 255]];
  const src = new Uint8Array(2 * sw * sh * 3);
  px.forEach((c, i) => { src.set(c, i * 3); src.set(c.map((v) => 255 - v), sw * sh * 3 + i * 3); });
  assert.deepEqual(cellMean(src, sw, sh, 0, 0, 0, 2, 2).map(Math.round), [25, 30, 35]);
  assert.deepEqual(cellMean(src, sw, sh, 0, 1, 0, 3, 1).map(Math.round), [70, 80, 90]);
  // half a pixel counts half
  assert.deepEqual(cellMean(src, sw, sh, 0, 0.5, 0, 2, 1).map((v) => +v.toFixed(3)), [36.667, 46.667, 56.667]);
  assert.deepEqual(cellMean(src, sw, sh, 0, 0, 0.5, 1, 2).map((v) => +v.toFixed(3)), [3.333, 6.667, 10]);
  assert.deepEqual(cellMean(src, sw, sh, 1, 0, 0, 1, 1).map(Math.round), [245, 235, 225]);
});

test('cells cover the source like object-fit: cover, centred', () => {
  // a 16:9 source in a square box: the sides are cropped equally
  const r = coverRects(2, 2, 100, 100, 64, 36);
  assert.equal(r.length, 4);
  assert.deepEqual(r[0].map((v) => +v.toFixed(3)), [14, 0, 32, 18]);
  assert.deepEqual(r[3].map((v) => +v.toFixed(3)), [32, 18, 50, 36]);
  // a wide box crops top and bottom
  const w = coverRects(4, 1, 400, 100, 64, 36);
  assert.deepEqual(w[0].map((v) => +v.toFixed(3)), [0, 10, 16, 26]);
});

test('a brighter cell never gets a lower ramp step than a dimmer one, and steps span 0 to 6', () => {
  const p = P(), seen = new Set();
  let prev = -1, prevL = -1;
  const rnd = mulberry32(8), cols = [];
  for (let k = 0; k < 4000; k++) cols.push([rnd() * 255, rnd() * 255, rnd() * 255]);
  const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  cols.sort((a, b) => lum(a) - lum(b));
  for (const c of cols) {
    const s = toneOf(c, p);
    seen.add(s);
    if (lum(c) > prevL) assert.ok(s >= prev, `${c} got ${s} after ${prev}`);
    prev = s; prevL = lum(c);
  }
  assert.equal(seen.size, TONES + 1);
  // the clip's own colours: blue sky sparse, cloud dense
  assert.ok(toneOf([54, 102, 153], p) <= 2, 'sky is not sparse');
  assert.ok(toneOf([235, 240, 245], p) >= 5, 'cloud is not dense');
});

test('the colour boost lifts saturation and brightness, keeps the hue, and stays in range', () => {
  const sky = [54, 102, 153], b = boost(sky, 0.4);
  assert.ok(b[2] > sky[2] && Math.max(...b) <= 255 && Math.min(...b) >= 0);
  const sat = (c) => (Math.max(...c) - Math.min(...c)) / Math.max(...c);
  assert.ok(sat(b) > sat(sky));
  assert.ok(b[2] > b[1] && b[1] > b[0], 'hue order changed');
  assert.deepEqual(boost(sky, 0).map(Math.round), sky);
  assert.deepEqual(boost([250, 250, 250], 1).map(Math.round), [255, 255, 255]);
});

test('field blend: a cell at or below the threshold shows video, above it ASCII, for every threshold', () => {
  for (let thr = 0; thr <= TONES; thr++)
    for (let tone = 0; tone <= TONES; tone++)
      assert.equal(blendShows(tone, P({ blendThreshold: thr })), tone > thr, `tone ${tone}, threshold ${thr}`);
});

test('field blend, dim by tone: full video at or below the threshold, darker with every tone above it', () => {
  for (let thr = 0; thr < TONES; thr++) for (const dimCurve of [0.5, 1, 2]) {
    const p = P({ blendThreshold: thr, dimCurve });
    for (let tone = 0; tone <= thr; tone++) assert.equal(blendBackdrop(tone, p), 1);
    for (let tone = thr + 1; tone <= TONES; tone++) {
      const b = blendBackdrop(tone, p);
      assert.ok(b < blendBackdrop(tone - 1, p), `tone ${tone} is not darker than ${tone - 1}`);
      assert.ok(b >= 0 && b <= 1);
    }
  }
  const p = P({ blendThreshold: 1, dimCurve: 1 });
  assert.ok(blendBackdrop(2, p) >= 0.8, 'the first ASCII tone is not near full');
  assert.ok(blendBackdrop(TONES, p) <= 0.2, 'tone 6 is not near black');
});

/* The field is what moves a cell one tone per tick; the backdrop only
 * has to follow, so on a real run it may only move to a neighbouring
 * tone's level. */
test('field blend: on a running field the backdrop moves at most one step per tick, in both backdrop modes', () => {
  const f = createField(7, 40, 20, 4 / 3), p = P({ blendThreshold: 1 }), tick = 100;
  const u = new Float32Array(f.tone.length);
  let prev = Array.from(f.tone), crossings = 0;
  for (let k = 0; k < 300; k++) {
    f.step(tick);
    for (let i = 0; i < f.tone.length; i++) {
      const a = prev[i], b = f.tone[i];
      assert.ok(Math.abs(a - b) <= 1, `cell ${i} jumped ${a} -> ${b}`);
      const levels = [a - 1, a, a + 1].filter((t) => t >= 0 && t <= TONES).map((t) => blendBackdrop(t, p));
      assert.ok(levels.includes(blendBackdrop(b, p)), `dim backdrop skipped a step at cell ${i}`);
      const was = u[i], ascii = blendShows(b, p);
      u[i] = blendFade(was, ascii, tick, p);
      assert.ok(Math.abs(u[i] - was) <= tick / (p.fadeTime * 1000) + 1e-6, 'crossfade moved more than one step');
      if (blendShows(a, p) !== ascii) crossings++;
    }
    prev = Array.from(f.tone);
  }
  assert.ok(crossings > 50, `only ${crossings} threshold crossings, the run proves nothing`);
});

test('field blend, crossfade: a cell reaches the glyph and comes back to video in about fadeTime', () => {
  const p = P({ fadeTime: 0.3 });
  let u = 0, n = 0;
  while (u < 1 && n < 100) { u = blendFade(u, true, 16, p); n++; }
  assert.ok(Math.abs(n * 16 - 300) <= 16, `took ${n * 16}ms`);
  assert.equal(blendFade(0.5, false, 150, p), 0);
  assert.equal(blendFade(0, false, 16, p), 0);
});

test('edge distance: 0 inside the box, cells counted outward from the nearest box cell', () => {
  assert.equal(edgeDistance(0, 0, 10, 5), 0);
  assert.equal(edgeDistance(9, 4, 10, 5), 0);
  assert.equal(edgeDistance(-1, 2, 10, 5), 1);
  assert.equal(edgeDistance(12, 2, 10, 5), 3);
  assert.equal(edgeDistance(3, -2, 10, 5), 2);
  assert.equal(edgeDistance(-3, -4, 10, 5), 5);
});

test('edge weight: 1 inside, 0 at and past the reach, never rising with distance; reach 0 is a hard edge', () => {
  for (const edgeReach of [0, 1, 2.5, 4, 10]) for (const edgeFalloff of [0.3, 1, 3]) {
    const p = P({ edgeReach, edgeFalloff });
    assert.equal(edgeWeight(0, p), 1);
    let was = 1;
    for (let d = 0; d <= 20; d += 0.25) {
      const w = edgeWeight(d, p);
      assert.ok(w <= was, `weight rose at ${d} (reach ${edgeReach})`);
      assert.ok(w >= 0 && w <= 1);
      if (d >= edgeReach && d > 0) assert.equal(w, 0, `weight ${w} at ${d}, reach ${edgeReach}`);
      was = w;
    }
    if (edgeReach > 1) assert.ok(edgeWeight(1, p) > 0, 'reach above 1 colours nothing outside');
  }
  assert.equal(edgeWeight(0.5, P({ edgeReach: 0 })), 0);
});
