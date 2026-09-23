// Run from the repo root with: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { createField, PARAMS, DEFAULTS, GLYPHS, CHARS, TONES } = createRequire(import.meta.url)('../field.js');

const STEP = 1000 / DEFAULTS.fps; // the renderer steps the field at its fps
const ASPECT = 16 / 12;
const SECOND = DEFAULTS.fps;
const glyphOf = (sec, tone) => CHARS.indexOf(PARAMS.ramps[sec][tone - 1]);

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

test('tone and grey never move more than one step in a tick, at 12, 30 or 60fps', () => {
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

test('no tuning can make a cell jump: the slew is capped at one tone per tick', () => {
  const saved = { rise: PARAMS.rise, fall: PARAMS.fall, fps: PARAMS.fps, contrast: PARAMS.contrast, curve: PARAMS.curve, dither: PARAMS.dither };
  Object.assign(PARAMS, { rise: 50, fall: 50, fps: 5, contrast: 4, curve: 0.2, dither: 3 });
  try {
    const field = createField(7, 80, 45, ASPECT);
    let prev = snapshot(field);
    run(field, 200, 200, () => {
      for (let i = 0; i < field.tone.length; i++) assert.ok(Math.abs(field.tone[i] - prev.tone[i]) <= 1, `tone jump at cell ${i}`);
      prev = snapshot(field);
    });
  } finally {
    Object.assign(PARAMS, saved);
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
    if (field.tone[i]) assert.equal(field.glyph[i], glyphOf(field.section[i], field.tone[i]));
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
  assert.ok(same / pairs > 0.58, `only ${(same / pairs).toFixed(2)} of lit neighbours are close in brightness`);
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
      for (const s of [1.5, 2, 3]) {
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

test('the size amounts decide how much of the field draws large', () => {
  const saved = { midAmount: PARAMS.midAmount, bigAmount: PARAMS.bigAmount, bigSize: PARAMS.bigSize };
  const share = (size) => { const f = createField(5, 120, 68, ASPECT); run(f, 5 * SECOND); return f.tiles.filter((t) => t.to === size).length / f.tiles.length; };
  try {
    Object.assign(PARAMS, { midAmount: 0, bigAmount: 0 });
    assert.equal(share(1), 1);
    Object.assign(PARAMS, { midAmount: 0, bigAmount: 1, bigSize: 3 });
    assert.equal(share(3), 1);
  } finally {
    Object.assign(PARAMS, saved);
  }
});

test('dither mixes neighbouring glyphs in smooth gradients', () => {
  // Measured on a soft setting: at high contrast neighbours already differ
  // almost everywhere, so there is no banding for dither to break up.
  const saved = { dither: PARAMS.dither, contrast: PARAMS.contrast, gain: PARAMS.gain };
  Object.assign(PARAMS, { contrast: 1, gain: 1 });
  const distinct = () => {
    const f = createField(21, 160, 68, ASPECT);
    run(f, 5 * SECOND);
    let differ = 0;
    let pairs = 0;
    for (let i = 1; i < f.glyph.length; i++) {
      if (!f.tone[i] || !f.tone[i - 1]) continue;
      pairs++;
      if (f.glyph[i] !== f.glyph[i - 1]) differ++;
    }
    return differ / pairs;
  };
  try {
    PARAMS.dither = 0;
    const plain = distinct();
    PARAMS.dither = 1;
    const mixed = distinct();
    assert.ok(mixed > plain * 1.15, `lit neighbours differing went from ${plain.toFixed(2)} to only ${mixed.toFixed(2)}`);
  } finally {
    Object.assign(PARAMS, saved);
  }
});

function withParams(values, fn) {
  const saved = {};
  for (const k of Object.keys(values)) saved[k] = PARAMS[k];
  Object.assign(PARAMS, values);
  try { return fn(); } finally { Object.assign(PARAMS, saved); }
}

test('small glyphs: the small amount draws 0.5x, but only at a glyph pixel of 2 or more', () => {
  const share = () => { const f = createField(5, 120, 68, ASPECT); run(f, 5 * SECOND); return f.tiles.filter((t) => t.to === 0.5).length / f.tiles.length; };
  withParams({ smallAmount: 0, midAmount: 0, bigAmount: 0 }, () => assert.equal(share(), 0));
  withParams({ smallAmount: 1, midAmount: 0, bigAmount: 0, pixel: 2 }, () => assert.equal(share(), 1));
  withParams({ smallAmount: 1, midAmount: 0, bigAmount: 0, pixel: 1 }, () => assert.equal(share(), 0));
});

test('small glyphs split each cell four ways, start from the cell, and never jump', () => {
  withParams({ smallAmount: 0.5, midAmount: 0, bigAmount: 0 }, () => {
    const field = createField(21, 160, 68, ASPECT);
    const prev = new Map();
    let started = 0;
    let differing = 0;
    let litCells = 0;
    run(field, 30 * SECOND, STEP, () => {
      field.tiles.forEach((t, ti) => {
        if (!t.fine) return;
        const p = prev.get(ti);
        if (p && p.to !== 0.5 && t.to === 0.5) {
          // The tile has just turned small: every quarter starts within one
          // slew step of the cell it came from.
          started++;
          for (let k = 0; k < 144; k++) {
            const x = t.x * 6 + Math.floor((k % 12) / 2), y = t.y * 6 + Math.floor(Math.floor(k / 12) / 2);
            if (x >= field.cols || y >= field.rows) continue;
            assert.ok(Math.abs(t.fine.level[k] - field.level[y * field.cols + x]) <= 0.3, `quarter ${k} of tile ${ti} started away from its cell`);
          }
        }
        const showing = t.from === 0.5 || t.to === 0.5;
        if (p && p.showing && showing) for (let k = 0; k < 144; k++) assert.ok(Math.abs(t.fine.tone[k] - p.tone[k]) <= 1, `small glyph ${k} of tile ${ti} jumped`);
        prev.set(ti, { to: t.to, showing, tone: Uint8Array.from(t.fine.tone) });
        if (t.to === 0.5 && t.from === 0.5) {
          for (let c = 0; c < 36; c++) {
            const sx = (c % 6) * 2, sy = Math.floor(c / 6) * 2, q = [sy * 12 + sx, sy * 12 + sx + 1, (sy + 1) * 12 + sx, (sy + 1) * 12 + sx + 1].map((k) => t.fine.tone[k]);
            if (q.every((v) => v === 0)) continue;
            litCells++;
            if (new Set(q).size > 1) differing++;
          }
        }
      });
      field.tiles.forEach((t, ti) => { if (!t.fine) prev.set(ti, { to: t.to }); });
    });
    assert.ok(started > 0, 'no tile turned small');
    assert.ok(differing / litCells > 0.1, `only ${differing} of ${litCells} lit small cells show more than one glyph`);
  });
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
    assert.ok(lit / total < 0.22, `seed ${seed} lit share ${(lit / total).toFixed(3)}`);
    assert.ok(quiet / total > 0.87, `seed ${seed} quiet share ${(quiet / total).toFixed(3)}`);
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

test('every glyph has a pixel bitmap of at most 6x8, and the default ramps use only those', () => {
  for (const ramp of DEFAULTS.ramps) for (const ch of ramp) assert.ok(GLYPHS[ch], `no bitmap for ${ch}`);
  for (const ch of CHARS.slice(1)) {
    const rows = GLYPHS[ch];
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
  const greys = DEFAULTS.greys;
  assert.equal(CHARS[0], ' ');
  for (const r of DEFAULTS.ramps) assert.equal(r.length, TONES);
  assert.ok(greys.length <= 3);
  assert.equal(greys[greys.length - 1], 255);
  for (let i = 1; i < greys.length; i++) assert.ok(greys[i] > greys[i - 1]);
});
