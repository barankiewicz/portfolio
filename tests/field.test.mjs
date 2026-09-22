// Run from the repo root with: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { createField, envelope, SECTIONS, CHARS, TONES, GREYS, TICK } = createRequire(import.meta.url)('../field.js');

const STEP = TICK * 1000; // the renderer steps the field at 24fps
const ASPECT = 16 / 12;

function run(field, ticks, dt = STEP, onTick) {
  for (let f = 0; f < ticks; f++) {
    field.step(dt);
    if (onTick) onTick(f);
  }
}

function snapshot(field) {
  return { tone: Uint8Array.from(field.tone), grey: Uint8Array.from(field.grey), glyph: Uint8Array.from(field.glyph) };
}

test('same seed and same tick sequence give the same field', () => {
  const a = createField(42, 80, 45, ASPECT);
  const b = createField(42, 80, 45, ASPECT);
  run(a, 120);
  run(b, 120);
  assert.deepEqual(snapshot(a), snapshot(b));
});

test('two seeds place the motifs differently', () => {
  const a = createField(1, 160, 68, ASPECT);
  const b = createField(2, 160, 68, ASPECT);
  run(a, 120);
  run(b, 120);
  const where = (f) => f.motifs.map((m) => `${m.kind}:${(m.cx ?? m.x).toFixed(2)},${(m.cy ?? m.y).toFixed(2)}`);
  assert.ok(where(a).length > 10, 'too few motifs to compare');
  const shared = where(a).filter((p) => where(b).includes(p));
  assert.ok(shared.length < where(a).length * 0.1, `${shared.length} of ${where(a).length} motifs in the same place`);
  let differ = 0;
  for (let i = 0; i < a.glyph.length; i++) if (a.glyph[i] !== b.glyph[i]) differ++;
  assert.ok(differ / a.glyph.length > 0.1, `only ${differ} cells differ`);
});

test('tone and grey never move more than one step in a tick, at 24, 30 or 60fps, bursts included', () => {
  for (const dt of [STEP, 1000 / 30, 1000 / 60]) {
    const field = createField(7, 80, 45, ASPECT);
    let prev = snapshot(field);
    let burst = false;
    run(field, 24 * 20, dt, () => {
      if (field.tempo > 2) burst = true;
      for (let i = 0; i < field.tone.length; i++) {
        assert.ok(Math.abs(field.tone[i] - prev.tone[i]) <= 1, `tone jump at cell ${i}`);
        assert.ok(Math.abs(field.grey[i] - prev.grey[i]) <= 1, `grey jump at cell ${i}`);
      }
      prev = snapshot(field);
    });
    assert.ok(burst, 'no burst happened');
  }
});

test('a long frame (tab stall) is clamped so it cannot jump either', () => {
  const field = createField(7, 80, 45, ASPECT);
  run(field, 60);
  const prev = snapshot(field);
  field.step(2000);
  for (let i = 0; i < field.tone.length; i++) {
    assert.ok(Math.abs(field.tone[i] - prev.tone[i]) <= 1);
  }
});

test('the field starts empty and builds up, nothing is painted on the first tick', () => {
  const field = createField(3, 80, 45, ASPECT);
  field.step(STEP);
  assert.ok(field.tone.every((t) => t <= 1));
});

test('the clock runs slow most of the time and bursts ahead briefly', () => {
  const field = createField(5, 40, 30, ASPECT);
  const ticks = 24 * 60;
  let slow = 0;
  let fast = 0;
  let bursts = 0;
  let inBurst = false;
  let prevTempo = field.tempo;
  run(field, ticks, STEP, () => {
    if (field.tempo <= 0.5) slow++;
    if (field.tempo > 1.5) fast++;
    if (field.tempo > 1.5 && !inBurst) bursts++;
    inBurst = field.tempo > 1.5;
    assert.ok(Math.abs(field.tempo - prevTempo) < 1.5, `tempo stepped ${field.tempo - prevTempo} in one tick`);
    prevTempo = field.tempo;
  });
  assert.ok(slow / ticks > 0.8, `slow only ${(slow / ticks).toFixed(2)} of the time`);
  assert.ok(bursts >= 6 && bursts <= 20, `${bursts} bursts in a minute`);
  assert.ok(fast / ticks < 0.1, `fast ${(fast / ticks).toFixed(2)} of the time`);
});

test('each third of the screen draws mostly from its own section, and the borders mix', () => {
  const field = createField(9, 160, 68, ASPECT);
  run(field, 24 * 5);
  const cols = field.cols;
  const share = (x0, x1, sec) => {
    let n = 0;
    let hit = 0;
    for (let y = 0; y < field.rows; y++) for (let x = x0; x < x1; x++) { n++; if (field.section[y * cols + x] === sec) hit++; }
    return hit / n;
  };
  assert.ok(share(0, 32, 0) > 0.85, 'left edge is not the lattice');
  assert.ok(share(64, 96, 1) > 0.85, 'middle is not the signal');
  assert.ok(share(128, 160, 2) > 0.85, 'right edge is not the dashes');
  // Across the first border a row flips between the two sections many
  // times: the cells are dithered, not cut along one line.
  let switches = 0;
  for (let y = 0; y < field.rows; y++) {
    for (let x = 21; x < 88; x++) if (field.section[y * cols + x] !== field.section[y * cols + x - 1]) switches++;
  }
  assert.ok(switches / field.rows > 3, `${(switches / field.rows).toFixed(1)} section switches per row at the border`);
  // Drawn glyphs come from the cell's own section.
  for (let i = 0; i < field.tone.length; i++) {
    if (field.tone[i]) assert.equal(field.glyph[i], SECTIONS[field.section[i]].glyphs[field.tone[i] - 1]);
  }
});

test('the borders wander over time', () => {
  const field = createField(9, 160, 68, ASPECT);
  run(field, 24);
  const before = Uint8Array.from(field.section);
  run(field, 24 * 30);
  let changed = 0;
  for (let i = 0; i < before.length; i++) if (before[i] !== field.section[i]) changed++;
  assert.ok(changed / before.length > 0.02, `only ${changed} cells changed section in 30s`);
});

test('size changes crossfade over many ticks instead of swapping', () => {
  const field = createField(11, 120, 68, ASPECT);
  const seen = new Map();
  let changes = 0;
  run(field, 24 * 60, STEP, () => {
    for (let t = 0; t < field.tiles.length; t++) {
      const tile = field.tiles[t];
      if (tile.from !== tile.to) {
        seen.set(t, (seen.get(t) || 0) + 1);
        assert.ok(tile.mix >= 0 && tile.mix <= 1);
      } else if (seen.has(t)) {
        assert.ok(seen.get(t) >= 10, `tile ${t} changed size in ${seen.get(t)} ticks`);
        seen.delete(t);
        changes++;
      }
    }
  });
  assert.ok(changes > 0, 'no tile changed size in 60s');
});

test('a large glyph crossfades into its next glyph instead of swapping in one tick', () => {
  const field = createField(13, 160, 68, ASPECT);
  const prev = new Map();
  let changes = 0;
  run(field, 24 * 12, STEP, () => {
    field.tiles.forEach((tile, t) => {
      for (const s of [1.5, 2]) {
        tile.cells[s].forEach((c, k) => {
          const key = `${t}:${s}:${k}`;
          const p = prev.get(key);
          if (p && (c.glyph !== p.glyph || c.grey !== p.grey)) {
            changes++;
            assert.ok(p.u > 0.7, `${key} changed glyph mid-fade at u=${p.u}`);
            assert.equal(c.fromGlyph, p.glyph);
            assert.equal(c.fromGrey, p.grey);
            assert.equal(c.u, 0);
          }
          if (p && c.u < 1 && p.u < 1) assert.ok(c.u - p.u <= 0.25 + 1e-9, `${key} fade stepped ${c.u - p.u}`);
          prev.set(key, { glyph: c.glyph, grey: c.grey, u: c.u });
        });
      }
    });
  });
  assert.ok(changes > 50, `only ${changes} large-glyph changes in 12s`);
});

test('at least three glyph sizes are on screen at once', () => {
  const field = createField(5, 120, 68, ASPECT);
  run(field, 24 * 5);
  const sizes = new Set(field.tiles.map((t) => t.to));
  assert.deepEqual([...sizes].sort(), [1, 1.5, 2]);
});

test('a large part of the field is quiet: most cells hold each tick, many hold for 10s', () => {
  for (const seed of [9, 21, 77]) {
    const field = createField(seed, 160, 68, ASPECT); // 1920x1080 in 12x16 cells
    run(field, 72);
    const start = snapshot(field);
    const moved = new Uint8Array(field.tone.length);
    let prev = start;
    let quiet = 0;
    let lit = 0;
    let total = 0;
    run(field, 240, STEP, () => {
      for (let i = 0; i < field.tone.length; i++) {
        if (field.tone[i]) lit++;
        if (field.tone[i] === prev.tone[i] && field.glyph[i] === prev.glyph[i]) quiet++;
        if (field.glyph[i] !== start.glyph[i]) moved[i] = 1;
        total++;
      }
      prev = snapshot(field);
    });
    const still = 1 - moved.reduce((a, b) => a + b, 0) / moved.length;
    assert.ok(lit / total < 0.43, `seed ${seed} lit share ${(lit / total).toFixed(3)}`);
    assert.ok(quiet / total > 0.9, `seed ${seed} quiet share ${(quiet / total).toFixed(3)}`);
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
  const field = createField(4, 80, 45, ASPECT);
  run(field, 150);
  const before = snapshot(field);
  field.resize(60, 50);
  for (let y = 0; y < 45; y++) {
    for (let x = 0; x < 60; x++) {
      assert.equal(field.glyph[y * 60 + x], before.glyph[y * 80 + x]);
    }
  }
});

test('each section ramp has one glyph per tone, in a few greys up to white', () => {
  assert.equal(CHARS[0], ' ');
  for (const s of SECTIONS) assert.equal(s.ramp.length, TONES);
  assert.ok(GREYS.length <= 3);
  assert.equal(GREYS[GREYS.length - 1], 255);
  for (let i = 1; i < GREYS.length; i++) assert.ok(GREYS[i] > GREYS[i - 1]);
});
