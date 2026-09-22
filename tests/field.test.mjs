// Run from the repo root with: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { createField, envelope, RAMP, GREYS } = createRequire(import.meta.url)('../field.js');

const FRAME = 1000 / 60;

function run(field, frames, dt = FRAME, onFrame) {
  for (let f = 0; f < frames; f++) {
    field.step(dt);
    if (onFrame) onFrame(f);
  }
}

function snapshot(field) {
  return { glyph: Uint8Array.from(field.glyph), grey: Uint8Array.from(field.grey) };
}

test('same seed and same frame sequence give the same field', () => {
  const a = createField(42, 80, 45);
  const b = createField(42, 80, 45);
  run(a, 240);
  run(b, 240);
  assert.deepEqual(snapshot(a), snapshot(b));
});

test('two seeds place the motifs differently', () => {
  const a = createField(1, 80, 45);
  const b = createField(2, 80, 45);
  run(a, 240);
  run(b, 240);
  const where = (f) => f.motifs.filter((m) => m.kind === 'wave').map((m) => `${m.cx.toFixed(2)},${m.cy.toFixed(2)}`);
  const shared = where(a).filter((p) => where(b).includes(p));
  assert.equal(shared.length, 0);
  let differ = 0;
  for (let i = 0; i < a.glyph.length; i++) if (a.glyph[i] !== b.glyph[i]) differ++;
  assert.ok(differ / a.glyph.length > 0.1, `only ${differ} cells differ`);
});

test('glyph and grey never move more than one step in a frame, at 60fps or 30fps', () => {
  for (const dt of [FRAME, 1000 / 30]) {
    const field = createField(7, 80, 45);
    let prev = snapshot(field);
    run(field, 600, dt, () => {
      for (let i = 0; i < field.glyph.length; i++) {
        assert.ok(Math.abs(field.glyph[i] - prev.glyph[i]) <= 1, `glyph jump at cell ${i}`);
        assert.ok(Math.abs(field.grey[i] - prev.grey[i]) <= 1, `grey jump at cell ${i}`);
      }
      prev = snapshot(field);
    });
  }
});

test('a long frame (tab stall) is clamped so it cannot jump either', () => {
  const field = createField(7, 80, 45);
  run(field, 120);
  const prev = snapshot(field);
  field.step(2000);
  for (let i = 0; i < field.glyph.length; i++) {
    assert.ok(Math.abs(field.glyph[i] - prev.glyph[i]) <= 1);
  }
});

test('the field starts empty and builds up, nothing is painted on the first frame', () => {
  const field = createField(3, 80, 45);
  field.step(FRAME);
  assert.ok(field.glyph.every((g) => g <= 1));
});

test('size changes crossfade over many frames instead of swapping', () => {
  const field = createField(11, 120, 68);
  const seen = new Map();
  let changes = 0;
  run(field, 60 * 40, FRAME, () => {
    for (let t = 0; t < field.tiles.length; t++) {
      const tile = field.tiles[t];
      if (tile.from !== tile.to) {
        const n = (seen.get(t) || 0) + 1;
        seen.set(t, n);
        assert.ok(tile.mix >= 0 && tile.mix <= 1);
      } else if (seen.has(t)) {
        assert.ok(seen.get(t) >= 20, `tile ${t} changed size in ${seen.get(t)} frames`);
        seen.delete(t);
        changes++;
      }
    }
  });
  assert.ok(changes > 0, 'no tile changed size in 40s');
});

test('a large glyph crossfades into its next glyph instead of swapping in one frame', () => {
  const field = createField(13, 192, 68, 1.6);
  const prev = new Map();
  let changes = 0;
  run(field, 60 * 12, FRAME, () => {
    field.tiles.forEach((tile, t) => {
      for (const s of [1.5, 2]) {
        tile.cells[s].forEach((c, k) => {
          const key = `${t}:${s}:${k}`;
          const p = prev.get(key);
          if (p && (c.glyph !== p.glyph || c.grey !== p.grey)) {
            changes++;
            assert.ok(p.u > 0.9, `${key} changed glyph mid-fade at u=${p.u}`);
            assert.equal(c.fromGlyph, p.glyph);
            assert.equal(c.fromGrey, p.grey);
            assert.ok(c.u < 0.2, `${key} started its fade at ${c.u}`);
          }
          if (p && c.u < 1 && p.u < 1) assert.ok(c.u - p.u <= 0.1 + 1e-9, `${key} fade stepped ${c.u - p.u}`);
          prev.set(key, { glyph: c.glyph, grey: c.grey, u: c.u });
        });
      }
    });
  });
  assert.ok(changes > 50, `only ${changes} large-glyph changes in 12s`);
});

test('at least three glyph sizes are on screen at once', () => {
  const field = createField(5, 120, 68);
  run(field, 60 * 5);
  const sizes = new Set(field.tiles.map((t) => t.to));
  assert.deepEqual([...sizes].sort(), [1, 1.5, 2]);
});

test('a large part of the field is quiet: most cells dark, most hold per frame, many hold for 10s', () => {
  for (const seed of [9, 21, 77]) {
    const field = createField(seed, 160, 68, 16 / 12); // 1920x1080 in 12x16 cells
    run(field, 180);
    const start = snapshot(field);
    const moved = new Uint8Array(field.glyph.length);
    let prev = start;
    let quiet = 0;
    let lit = 0;
    let total = 0;
    run(field, 600, FRAME, () => {
      for (let i = 0; i < field.glyph.length; i++) {
        if (field.glyph[i]) lit++;
        if (field.glyph[i] === prev.glyph[i] && field.grey[i] === prev.grey[i]) quiet++;
        if (field.glyph[i] !== start.glyph[i]) moved[i] = 1;
        total++;
      }
      prev = snapshot(field);
    });
    const still = 1 - moved.reduce((a, b) => a + b, 0) / moved.length;
    assert.ok(lit / total < 0.3, `seed ${seed} lit share ${(lit / total).toFixed(3)}`);
    assert.ok(quiet / total > 0.95, `seed ${seed} quiet share ${(quiet / total).toFixed(3)}`);
    assert.ok(still > 0.25, `seed ${seed} still for 10s ${still.toFixed(3)}`);
  }
});

test('a motif arrives from nothing and leaves to nothing, easing both ways', () => {
  assert.equal(envelope(0), 0);
  assert.equal(envelope(1), 0);
  let prev = 0;
  for (let u = 0.001; u < 1; u += 0.001) {
    const e = envelope(u);
    assert.ok(Math.abs(e - prev) < 0.01, `envelope steps ${Math.abs(e - prev)} at ${u}`);
    prev = e;
  }
});

test('resize keeps the cells that are still on screen', () => {
  const field = createField(4, 80, 45);
  run(field, 300);
  const before = snapshot(field);
  field.resize(60, 50);
  for (let y = 0; y < 45; y++) {
    for (let x = 0; x < 60; x++) {
      assert.equal(field.glyph[y * 60 + x], before.glyph[y * 80 + x]);
    }
  }
});

test('the ramps run sparse to dense and dim to white, in a few greys', () => {
  assert.equal(RAMP[0], ' ');
  assert.ok(GREYS.length <= 3);
  assert.equal(GREYS[GREYS.length - 1], 255);
  for (let i = 1; i < GREYS.length; i++) assert.ok(GREYS[i] > GREYS[i - 1]);
});
