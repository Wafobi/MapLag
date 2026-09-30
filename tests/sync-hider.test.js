// Firebase sync as a hider in a named room: sees seeker positions only,
// ignores stale ones, never receives zones.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, settle, fnvHash, deriveKey, encrypt } from './harness.js';

const PW = 'versteck';
const ROOM = 'party';
const ROOT = `${fnvHash(PW)}/${ROOM}`;

let app, state, fb, key;
const seekerMarkers = () => app.document.querySelectorAll('.seeker-tooltip').length;

before(async () => {
  app = await boot({ url: `http://localhost/index.html?room=${ROOM}` });
  state = await app.mod('state');
  fb = await app.mod('firebase');
  key = await deriveKey(PW, ROOM);
  app.db.seed(`${ROOT}/locations/fresh`, await encrypt(key, { lat: 52, lng: 13, ts: Date.now() }));
  app.db.seed(`${ROOT}/locations/stale`, await encrypt(key, { lat: 48, lng: 11, ts: Date.now() - 2 * fb.LOCATION_TTL }));
  app.db.seed(`${ROOT}/zones/z1`, await encrypt(key, { lbl: 'x', isMiss: true, isInverted: false, isHit: false, geo: { type: 'circle', center: { lat: 1, lng: 1 }, radius: 1 } }));
  await app.login(PW, 'hider');
  await settle();
});
after(() => app.close());

describe('hider', () => {
  it('uses the ?room= parameter', () => {
    assert.equal(fb.FB_ROOM, ROOM);
  });

  it('hides seeker tools', () => {
    for (const sel of ['[data-mode="circ"]', '#btn-thermo', '#btn-mq', '#btn-admin', '#btn-zones']) {
      assert.equal(app.$(sel).style.display, 'none', sel);
    }
  });

  it('does not receive zones', () => {
    assert.equal(state.st.zones.length, 0);
  });

  it('shows fresh seekers, not stale ones', () => {
    assert.equal(seekerMarkers(), 1);
  });

  it('does not broadcast its own position', async () => {
    app.gps.emit(50, 10);
    await settle(50);
    assert.equal(app.db.get(`${ROOT}/locations/${state._devId}`), null);
  });

  it('drops seekers that stop updating', () => {
    const realNow = Date.now;
    Date.now = () => realNow() + 2 * fb.LOCATION_TTL;
    try { fb._sweepStaleSeekers(); } finally { Date.now = realNow; }
    assert.equal(seekerMarkers(), 0);
  });

  it('removes a seeker when its entry is deleted', async () => {
    app.db.seed(`${ROOT}/locations/s2`, await encrypt(key, { lat: 51, lng: 12, ts: Date.now() }));
    await settle(50);
    assert.equal(seekerMarkers(), 1);
    app.db.seed(`${ROOT}/locations/s2`, null);
    await settle(50);
    assert.equal(seekerMarkers(), 0);
  });
});
