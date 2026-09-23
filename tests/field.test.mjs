// Run from the repo root with: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { createField, SECTIONS, GLYPHS, CHARS, TONES, GREYS, TICK } = createRequire(import.meta.url)('../field.js');

const STEP = TICK * 1000; // the renderer steps the field at 15fps
const ASPECT = 16 / 12;
const SECOND = Math.round(1 / TICK);

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
  run(a, 5 * SECOND);
  run(b, 5 * SECOND);
  assert.deepEqual(snapshot(a), snapshot(b));
});

test('two seeds give different patterns', () => {
  const a = createField(1, 160, 68, ASPECT);
  const b = createField(2, 160, 68, ASPECT);
  run(a, 5 * SECOND);
  run(b, 5 * SECOND);
  assert.notEqual(a.waves[1].planes[0].kx, b.waves[1].planes[0].kx);
  let differ = 0;
  for (let i = 0; i < a.glyph.length; i++) if (a.glyph[i] !== b.glyph[i]) differ++;
  assert.ok(differ / a.glyph.length > 0.1, `only ${differ} cells differ`);
});

test('tone and grey never move more than one step in a tick, at 15, 30 or 60fps', () => {
  for (const dt of [STEP, 1000 / 30, 1000 / 60]) {
    const field = createField(7, 80, 45, ASPECT);
    let prev = snapshot(field);
    run(field, 20 * SECOND, dt, () => {
      for (let i = 0; i < field.tone.length; i++) {
        assert.ok(Math.abs(field.tone[i] - prev.tone[i]) <= 1, `tone jump at cell ${i}`);
        assert.ok(Math.abs(field.grey[i] - prev.grey[i]) <= 1, `grey jump at cell ${i}`);
      }
      prev = snapshot(field);
    });
  }
});

test('a long frame (tab stall) is clamped so it cannot jump either', () => {
  const field = createField(7, 80, 45, ASPECT);
  run(field, 4 * SECOND);
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

test('each third of the screen draws mostly from its own section, and the borders mix', () => {
  const field = createField(9, 160, 68, ASPECT);
  run(field, 5 * SECOND);
  const cols = field.cols;
  const share = (x0, x1, sec) => {
    let n = 0;
    let hit = 0;
    for (let y = 0; y < field.rows; y++) for (let x = x0; x < x1; x++) { n++; if (field.section[y * cols + x] === sec) hit++; }
    return hit / n;
  };
  assert.ok(share(0, 32, 0) > 0.85, 'left edge is not the first section');
  assert.ok(share(64, 96, 1) > 0.85, 'middle is not the second section');
  assert.ok(share(128, 160, 2) > 0.85, 'right edge is not the third section');
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
  run(field, SECOND);
  const before = Uint8Array.from(field.section);
  run(field, 60 * SECOND);
  let changed = 0;
  for (let i = 0; i < before.length; i++) if (before[i] !== field.section[i]) changed++;
  assert.ok(changed / before.length > 0.02, `only ${changed} cells changed section in 60s`);
});

test('neighbouring cells move together: the pattern is a surface, not noise', () => {
  const field = createField(21, 160, 68, ASPECT);
  run(field, 10 * SECOND);
  let same = 0;
  let pairs = 0;
  for (let y = 0; y < field.rows; y++) {
    for (let x = 1; x < field.cols; x++) {
      const a = field.level[y * field.cols + x], b = field.level[y * field.cols + x - 1];
      if (a < 0.05 && b < 0.05) continue;
      pairs++;
      if (Math.abs(a - b) < 0.2) same++;
    }
  }
  assert.ok(same / pairs > 0.8, `only ${(same / pairs).toFixed(2)} of lit neighbours are close in brightness`);
});

test('size changes crossfade over many ticks instead of swapping', () => {
  const field = createField(11, 120, 68, ASPECT);
  const seen = new Map();
  let changes = 0;
  run(field, 120 * SECOND, STEP, () => {
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
  assert.ok(changes > 0, 'no tile changed size in 120s');
});

test('a large glyph crossfades into its next glyph instead of swapping in one tick', () => {
  const field = createField(13, 160, 68, ASPECT);
  const prev = new Map();
  let changes = 0;
  run(field, 20 * SECOND, STEP, () => {
    field.tiles.forEach((tile, t) => {
      for (const s of [1.5, 2]) {
        tile.cells[s].forEach((c, k) => {
          const key = `${t}:${s}:${k}`;
          const p = prev.get(key);
          if (p && (c.glyph !== p.glyph || c.grey !== p.grey)) {
            changes++;
            assert.ok(p.u > 0.6, `${key} changed glyph mid-fade at u=${p.u}`);
            assert.equal(c.fromGlyph, p.glyph);
            assert.equal(c.fromGrey, p.grey);
            assert.equal(c.u, 0);
          }
          if (p && c.u < 1 && p.u < 1) assert.ok(c.u - p.u <= 0.4 + 1e-9, `${key} fade stepped ${c.u - p.u}`);
          prev.set(key, { glyph: c.glyph, grey: c.grey, u: c.u });
        });
      }
    });
  });
  assert.ok(changes > 50, `only ${changes} large-glyph changes in 20s`);
});

test('at least three glyph sizes are on screen at once', () => {
  const field = createField(5, 120, 68, ASPECT);
  run(field, 5 * SECOND);
  const sizes = new Set(field.tiles.map((t) => t.to));
  assert.deepEqual([...sizes].sort(), [1, 1.5, 2]);
});

test('a large part of the field is quiet: most cells hold each tick, many hold for 10s', () => {
  for (const seed of [9, 21, 77]) {
    const field = createField(seed, 160, 68, ASPECT); // 1920x1080 in 12x16 cells
    run(field, 5 * SECOND);
    const start = snapshot(field);
    const moved = new Uint8Array(field.tone.length);
    let prev = start;
    let quiet = 0;
    let lit = 0;
    let total = 0;
    run(field, 10 * SECOND, STEP, () => {
      for (let i = 0; i < field.tone.length; i++) {
        if (field.tone[i]) lit++;
        if (field.tone[i] === prev.tone[i] && field.glyph[i] === prev.glyph[i]) quiet++;
        if (field.glyph[i] !== start.glyph[i]) moved[i] = 1;
        total++;
      }
      prev = snapshot(field);
    });
    const still = 1 - moved.reduce((a, b) => a + b, 0) / moved.length;
    assert.ok(lit / total < 0.6, `seed ${seed} lit share ${(lit / total).toFixed(3)}`);
    assert.ok(quiet / total > 0.9, `seed ${seed} quiet share ${(quiet / total).toFixed(3)}`);
    assert.ok(still > 0.15, `seed ${seed} still for 10s ${still.toFixed(3)}`);
  }
});

test('regions swell and die away: a quarter of the screen does not stay equally lit', () => {
  const field = createField(21, 160, 68, ASPECT);
  const shares = [];
  run(field, 90 * SECOND, STEP, (k) => {
    if (k % SECOND) return;
    let lit = 0;
    for (let y = 0; y < 34; y++) for (let x = 0; x < 80; x++) if (field.tone[y * 160 + x]) lit++;
    shares.push(lit / (34 * 80));
  });
  const range = Math.max(...shares) - Math.min(...shares);
  assert.ok(range > 0.15, `top-left quarter only ranged ${range.toFixed(2)} in lit share over 90s`);
});

test('every glyph in use has a pixel bitmap of at most 6x8', () => {
  for (const ch of CHARS.slice(1)) {
    const rows = GLYPHS[ch];
    assert.ok(rows, `no bitmap for ${ch}`);
    assert.ok(rows.length <= 8, `${ch} is ${rows.length} rows tall`);
    for (const r of rows) assert.ok(r.length <= 6 && /^[.#]+$/.test(r), `${ch} has a bad row ${r}`);
  }
});

test('resize keeps the cells that are still on screen', () => {
  const field = createField(4, 80, 45, ASPECT);
  run(field, 10 * SECOND);
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
