// Eliminated-area rendering: hits AND together, misses OR together,
// thermometer readings cut the map along the perpendicular bisector.

import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, settle } from './harness.js';

const BERLIN = [52.52, 13.405];
const MUNICH = [48.137, 11.575];

let app;
before(async () => { app = await boot(); });
after(() => app.close());
beforeEach(async () => { await app.reset(); });

// Draw a radar zone through the real UI: open radar, tap center, press Hit/Miss
async function radar(hit, [lat, lng], km) {
  if (!app.$('#radar-sheet').classList.contains('open')) app.click('[data-mode="circ"]');
  app.$('#radius-km').value = String(km);
  app.tapMap(lat, lng);
  app.click(hit ? '#btn-ok-hit' : '#btn-ok-miss');
  await settle();
}

async function thermo(start, stop, warmer) {
  const { tp } = await app.mod('state');
  const { tpRenderConstraints } = await app.mod('thermo');
  tp.constraints.push({ id: 'th' + Math.random(), startPos: { lat: start[0], lng: start[1] }, stopPos: { lat: stop[0], lng: stop[1] }, warmer });
  tpRenderConstraints();
  await settle();
}


describe('radar zones', () => {
  it('miss eliminates only the circle', async () => {
    await radar(false, BERLIN, 10);
    assert.equal(await app.isEliminated(...BERLIN), true);
    assert.equal(await app.isEliminated(...MUNICH), false);
  });

  it('hit eliminates everything outside the circle', async () => {
    await radar(true, BERLIN, 10);
    assert.equal(await app.isEliminated(...BERLIN), false);
    assert.equal(await app.isEliminated(...MUNICH), true);
    assert.equal(await app.isEliminated(52.52 + 0.2, 13.405), true, '22 km north is outside a 10 km hit');
  });

  it('two overlapping hits leave only their intersection', async () => {
    await radar(true, [52.0, 13.0], 40);
    await radar(true, [52.0, 13.8], 40); // centers ~55 km apart
    assert.equal(await app.isEliminated(52.0, 13.4), false, 'overlap stays possible');
    assert.equal(await app.isEliminated(52.0, 12.7), true, 'only inside the first hit');
    assert.equal(await app.isEliminated(52.0, 14.1), true, 'only inside the second hit');
  });

  // Regression: `world` was undefined → ReferenceError → nothing rendered at all
  it('miss covering the whole hit eliminates everything', async () => {
    await radar(true, BERLIN, 5);
    await radar(false, BERLIN, 20);
    const { mergedMissLayer } = await app.mod('state');
    assert.ok(mergedMissLayer, 'eliminated layer must be rendered');
    assert.equal(await app.isEliminated(...BERLIN), true);
    assert.equal(await app.isEliminated(...MUNICH), true);
  });

  // Regression: a disjoint second hit was silently ignored
  it('contradicting (disjoint) hits eliminate everything', async () => {
    await radar(true, BERLIN, 10);
    await radar(true, MUNICH, 10);
    assert.equal(await app.isEliminated(...BERLIN), true);
    assert.equal(await app.isEliminated(...MUNICH), true);
  });

  it('huge radius near the pole does not throw', async () => {
    await radar(true, [80, 0], 2000);
    const { st } = await app.mod('state');
    assert.equal(st.zones.length, 1);
  });
});

describe('thermometer', () => {
  it('warmer eliminates the start side', async () => {
    await thermo([51.0, 10.0], [51.0, 10.1], true);
    assert.equal(await app.isEliminated(51.0, 9.9), true);
    assert.equal(await app.isEliminated(51.0, 10.2), false);
  });

  it('cooler eliminates the stop side', async () => {
    await thermo([51.0, 10.0], [51.0, 10.1], false);
    assert.equal(await app.isEliminated(51.0, 9.9), false);
    assert.equal(await app.isEliminated(51.0, 10.2), true);
  });

  it('identical start and stop eliminates nothing', async () => {
    await thermo([51.0, 10.0], [51.0, 10.0], true);
    assert.equal(await app.isEliminated(51.0, 10.0), false);
    assert.equal(await app.isEliminated(-30, -60), false);
  });

  // The bisector is built in Web-Mercator space. Compare against an
  // independent reference: which endpoint is nearer in Mercator coordinates.
  for (const [name, start, stop] of [
    ['north-south', [50.0, 8.0], [50.2, 8.0]],
    ['east-west', [50.0, 8.0], [50.0, 8.2]],
    ['diagonal', [50.0, 8.0], [50.1, 8.1]],
    ['steep diagonal', [48.0, 11.0], [48.3, 11.05]],
  ]) {
    it(`half-plane matches reference (${name})`, async () => {
      await app.reset();
      await thermo(start, stop, true);
      const merc = ([lat, lng]) => [lng * Math.PI / 180, Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360))];
      const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
      const [s, e] = [merc(start), merc(stop)];
      const wrong = [];
      for (let lat = -60; lat <= 70; lat += 10) {
        for (let lng = -170; lng <= 170; lng += 20) {
          const p = merc([lat, lng]);
          const ds = d2(p, s), de = d2(p, e);
          if (Math.abs(ds - de) / Math.max(ds, de) < 1e-3) continue; // too close to the line
          const expected = ds < de; // warmer → start side eliminated
          if ((await app.isEliminated(lat, lng)) !== expected) wrong.push([lat, lng]);
        }
      }
      assert.deepEqual(wrong, [], `misclassified points: ${JSON.stringify(wrong.slice(0, 8))}`);
    });
  }
});
