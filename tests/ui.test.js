// End-to-end UI flows through the real DOM: radar, measuring question,
// thermometer and admin areas (Nominatim is stubbed).

import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, settle } from './harness.js';

// Nominatim stub: the test decides which geometry comes back
let nominatimGeo = null;
async function fakeFetch(url) {
  if (!String(url).startsWith('https://nominatim.openstreetmap.org/')) throw new Error(`unexpected fetch ${url}`);
  return { ok: true, json: async () => ({ geojson: nominatimGeo, name: 'Testland', display_name: 'Testland, Earth', address: { country: 'Testland' } }) };
}

let app, state;
before(async () => {
  app = await boot({ fetch: fakeFetch });
  state = await app.mod('state');
});
after(() => app.close());
beforeEach(async () => { await app.reset(); });

const lastZone = () => state.st.zones.at(-1);
const tipText = () => app.$('#tip').textContent;

describe('radar', () => {
  it('tapping the map picks the center, overriding GPS', async () => {
    app.gps.emit(48.0, 11.0);
    app.click('[data-mode="circ"]');
    app.$('#radius-km').value = '3';
    app.tapMap(52.0, 13.0);
    app.click('#btn-ok-hit');
    await settle();
    const z = lastZone();
    assert.equal(z.layer._origLat, 52.0);
    assert.equal(z.layer._origLng, 13.0);
    assert.equal(z.layer._origRadius, 3000);
    assert.equal(z.layer._isHit, true);
  });

  it('without a tap the GPS position is used', async () => {
    app.gps.emit(48.0, 11.0);
    app.click('[data-mode="circ"]');
    app.click('#btn-ok-miss');
    await settle();
    const c = lastZone().layer.getLatLng();
    assert.deepEqual([c.lat, c.lng], [48.0, 11.0]);
  });

  it('closing the sheet discards a tapped center', async () => {
    app.gps.emit(48.0, 11.0);
    app.click('[data-mode="circ"]');
    app.tapMap(52.0, 13.0);
    app.click('#btn-radar-close');
    app.click('[data-mode="circ"]');
    app.click('#btn-ok-miss');
    await settle();
    assert.equal(lastZone().layer.getLatLng().lat, 48.0);
  });

  it('Enter in the radius field does not create a zone', async () => {
    app.click('[data-mode="circ"]');
    app.$('#radius-km').dispatchEvent(new app.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await settle();
    assert.equal(state.st.zones.length, 0);
  });
});

describe('measuring question', () => {
  it('works at latitude 0 and labels zones in the UI language', async () => {
    app.gps.emit(0, 10.0);
    app.click('#btn-mq');
    app.tapMap(0, 10.5);
    assert.equal(app.$('#btn-mq-closer').style.opacity, '1');
    app.click('#btn-mq-closer');
    await settle();
    const z = lastZone();
    assert.match(z.lbl, /^✓ Näher — /);
    assert.equal(z.layer._isHit, true);
    assert.equal(z.layer._origLat, 0);
  });

  it('closing the sheet removes the reference marker', async () => {
    app.gps.emit(50.0, 10.0);
    app.click('#btn-mq');
    app.tapMap(50.0, 10.5);
    const marker = state.mq.refMarker;
    assert.ok(app.map.hasLayer(marker));
    app.click('#btn-mq-close');
    assert.equal(app.map.hasLayer(marker), false);
    assert.equal(state.mq.refLat, null);
  });
});

describe('thermometer', () => {
  async function measure(start, stop) {
    app.gps.position = { lat: start[0], lng: start[1] };
    app.click('#btn-tp-start');
    await settle(20);
    app.gps.position = { lat: stop[0], lng: stop[1] };
    app.click('#btn-tp-stop');
    await settle(20);
  }

  it('shows the distance in the selected unit', async () => {
    app.click('#btn-thermo');
    app.click('#btn-units');  // → miles
    try {
      await measure([50.0, 10.0], [50.0, 10.1]);
      assert.match(app.$('#tp-dist-info').textContent, / mi$/);
    } finally {
      app.click('#btn-units');
    }
  });

  it('answering clears the start/stop markers', async () => {
    const { tp } = state;
    app.click('#btn-thermo');
    await measure([50.0, 10.0], [50.0, 10.1]);
    app.gps.position = { lat: 50.0, lng: 10.12 };
    app.click('#btn-tp-stop');  // re-measure stop: replaces, not adds, the marker
    await settle(20);
    assert.equal(tp.markers.length, 2);
    app.click('#btn-tp-warmer');
    assert.equal(tp.markers.length, 0);
    assert.equal(tp.constraints.length, 1);
    assert.equal(tp.constraints[0].stopPos.lng, 10.12);
  });

  it('reset asks first and is undoable', async () => {
    const { tp, thermoHistory } = state;
    app.click('#btn-thermo');
    await measure([50.0, 10.0], [50.0, 10.1]);
    app.click('#btn-tp-cooler');
    const id = tp.constraints[0].id;

    app.click('#btn-tp-reset');
    assert.equal(app.$('#confirm-modal').style.display, 'flex');
    app.click('#btn-confirm-cancel');
    assert.equal(tp.constraints.length, 1, 'cancel keeps readings');

    app.click('#btn-tp-reset');
    app.click('#btn-confirm-ok');
    assert.equal(tp.constraints.length, 0);
    assert.ok(thermoHistory[id]);

    const zones = await app.mod('zones');
    zones.renderZonePanel();
    app.click(`#zone-panel-list .zp-tp-undo[data-id="${id}"]`);
    assert.equal(tp.constraints.length, 1);
  });
});

describe('admin areas', () => {
  const SQUARE = { type: 'Polygon', coordinates: [[[10, 50], [11, 50], [11, 51], [10, 51], [10, 50]]] };

  async function pickArea(geo) {
    nominatimGeo = geo;
    app.click('#btn-admin');
    app.click('[data-admin-zoom="4"]');
    app.tapMap(50.5, 10.5);
    await settle(50);
  }

  it('rejects point results instead of crashing', async () => {
    await pickArea({ type: 'Point', coordinates: [10.5, 50.5] });
    assert.equal(tipText(), 'Keine Grenze gefunden');
    assert.equal(app.$('#admin-confirm').style.display, 'none');
  });

  it('hit on a polygon eliminates everything outside it', async () => {
    await pickArea(SQUARE);
    assert.equal(app.$('#admin-name').textContent, 'Testland');
    app.click('#btn-admin-hit');
    await settle();
    const z = lastZone();
    assert.equal(z.layer._isHit, true);
    assert.equal(z.layer._isInverted, true);
    assert.equal(await app.isEliminated(50.5, 10.5), false);
    assert.equal(await app.isEliminated(52, 13), true);
  });

  it('miss on a multipolygon eliminates both parts', async () => {
    await pickArea({ type: 'MultiPolygon', coordinates: [SQUARE.coordinates, [[[20, 40], [21, 40], [21, 41], [20, 41], [20, 40]]]] });
    app.click('#btn-admin-miss');
    await settle();
    assert.equal(await app.isEliminated(50.5, 10.5), true);
    assert.equal(await app.isEliminated(40.5, 20.5), true);
    assert.equal(await app.isEliminated(45, 15), false);
  });
});
