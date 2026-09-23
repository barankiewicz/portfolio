// Run from the repo root with: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { mulberry32, TONES } = require('../field.js');
const { DEFAULTS, glitchGap, glitchLength, planEpisode, planSwap, stepSwap, coverRects, cellMean, toneOf, boost } = require('../cloud.js');

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
