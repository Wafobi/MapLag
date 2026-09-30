// Zone serialization round-trips, hit/miss flags, zone panel, translations.

import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { boot, settle } from './harness.js';

let app, zones, state;
before(async () => {
  app = await boot();
  zones = await app.mod('zones');
  state = await app.mod('state');
});
after(() => app.close());
beforeEach(async () => { await app.reset(); });

const SQUARE = { type: 'Polygon', coordinates: [[[10, 50], [11, 50], [11, 51], [10, 51], [10, 50]]] };

// Every kind of zone the app can store, in its serialized (Firebase) form
const SAMPLES = {
  'radar hit':  { lbl: 'r-hit',  isMiss: false, isInverted: true,  isHit: true,  geo: { type: 'circle', center: { lat: 52, lng: 13 }, radius: 5000 } },
  'radar miss': { lbl: 'r-miss', isMiss: true,  isInverted: false, isHit: false, geo: { type: 'circle', center: { lat: 52, lng: 13 }, radius: 5000 } },
  'poly hit':   { lbl: 'p-hit',  isMiss: false, isInverted: true,  isHit: true,  geo: { type: 'poly-inv', latlngs: [[50, 10], [50, 11], [51, 11]] } },
  'admin hit':  { lbl: 'a-hit',  isMiss: false, isInverted: true,  isHit: true,  geo: { type: 'admin-inv', geometry: SQUARE } },
  'admin miss': { lbl: 'a-miss', isMiss: true,  isInverted: false, isHit: false, geo: { type: 'admin', geometry: SQUARE } },
};

const dotColor = id => app.document.querySelector(`#zone-panel-list [data-id="${id}"]`)
  .closest('.zp-item').querySelector('.zp-dot').style.background;

describe('serialization', () => {
  for (const [name, data] of Object.entries(SAMPLES)) {
    it(`round-trips ${name}`, () => {
      zones.deserializeZone('z1', structuredClone(data));
      const z = state.st.zones.find(z => z.id === 'z1');
      const out = zones.serializeZone(z);
      assert.deepEqual(out, data);
    });
  }

  // Older clients stored radar/measure hits without isHit
  it('legacy inverted zone without isHit still counts as hit', async () => {
    zones.deserializeZone('legacy', { ...SAMPLES['radar hit'], isHit: false });
    zones.renderList();
    await settle();
    assert.equal(dotColor('legacy'), 'var(--green)');
    assert.equal(await app.isEliminated(52, 13), false);
    assert.equal(await app.isEliminated(48, 11), true);
  });

  // Fallback when inverting an admin area failed: stored as 'admin' + isHit
  it('legacy admin hit (non-inverted) takes part in elimination', async () => {
    zones.deserializeZone('ah', { ...SAMPLES['admin miss'], isMiss: false, isHit: true });
    zones.renderList();
    await settle();
    assert.equal(await app.isEliminated(50.5, 10.5), false);
    assert.equal(await app.isEliminated(40, 0), true);
  });
});

describe('zone panel', () => {
  it('shows hits green and misses red (incl. radar/measure hits)', async () => {
    for (const [name, data] of Object.entries(SAMPLES)) zones.deserializeZone(name, structuredClone(data));
    zones.renderList();
    for (const [name, data] of Object.entries(SAMPLES)) {
      assert.equal(dotColor(name), data.isHit ? 'var(--green)' : 'var(--red)', name);
    }
  });

  it('delete and undo restore the zone', async () => {
    zones.deserializeZone('d1', structuredClone(SAMPLES['radar miss']));
    zones.renderList();
    app.click('#zone-panel-list .zp-del[data-id="d1"]');
    assert.equal(state.st.zones.length, 0);
    assert.ok(app.$('#zone-panel-list .zp-undo[data-id="d1"]'));
    assert.equal(dotColor('d1'), 'var(--red)');
    app.click('#zone-panel-list .zp-undo[data-id="d1"]');
    assert.equal(state.st.zones.length, 1);
    await settle();
    assert.equal(await app.isEliminated(52, 13), true);
  });

  it('changing the miss color re-renders the eliminated area', async () => {
    const { setMissColorFull, setElimPattern } = zones;
    setElimPattern('off');
    zones.deserializeZone('c1', structuredClone(SAMPLES['radar miss']));
    zones.renderEliminatedArea();
    setMissColorFull('#123456');
    const layer = state.mergedMissLayer.getLayers()[0];
    assert.equal(layer.options.fillColor, '#123456');
    assert.equal(layer.options.color, '#123456');
    setElimPattern('stripes');
  });
});

describe('translations', () => {
  it('every key used in HTML and JS exists in German and English', async () => {
    const { TR_DATA } = await app.mod('i18n');
    const root = new URL('../', import.meta.url);
    const html = readFileSync(new URL('index.html', root), 'utf8');
    const keys = new Set([...html.matchAll(/data-t[hpt]?="([^"]+)"/g)].map(m => m[1]));
    for (const f of readdirSync(new URL('js/', root))) {
      const src = readFileSync(new URL(`js/${f}`, root), 'utf8');
      for (const m of src.matchAll(/\bt\('([^']+)'/g)) keys.add(m[1]);
    }
    const missing = [...keys].filter(k => !TR_DATA[k] || TR_DATA[k].de == null || TR_DATA[k].en == null);
    assert.deepEqual(missing, []);
  });
});
