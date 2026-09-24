// Run from the repo root with: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { TONES, createField } = require('../field.js');
const { DEFAULTS, coverRects, cellMean, boost, blendShows, blendBackdrop, blendFade, edgeDistance, edgeWeight } = require('../cloud.js');

const P = (over) => ({ ...DEFAULTS, ...over });

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
