// Online game with a dead zone: writes queue up locally, survive in the
// outbox and reach Firebase once the connection is back.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, settle, fnvHash, deriveKey, encrypt, decrypt } from './harness.js';

const PW = 'funkloch';
const ROOT = `${fnvHash(PW)}/main`;
let app, state, zones, key;

const outbox = () => JSON.parse(app.window.localStorage.getItem(`mlOutbox:${ROOT}`) || '{}');
const cache = () => JSON.parse(app.window.localStorage.getItem(`mlCache:${ROOT}`) || '{}');
const badge = () => { const el = app.$('#net-status'); return el.style.display === 'none' ? '' : el.textContent; };

async function radarMiss(lat, lng) {
  const known = new Set(state.st.zones.map(z => z.id));
  if (!app.$('#radar-sheet').classList.contains('open')) app.click('[data-mode="circ"]');
  app.tapMap(lat, lng);
  app.click('#btn-ok-miss');
  await settle();
  return state.st.zones.find(z => !known.has(z.id)).id;
}

before(async () => {
  app = await boot();
  state = await app.mod('state');
  zones = await app.mod('zones');
  key = await deriveKey(PW, 'main');
  await app.login(PW, 'seeker');
});
after(() => app.close());

describe('online', () => {
  it('shows no badge while connected and in sync', () => {
    assert.equal(badge(), '');
  });

  it('mirrors received zones into the local cache', async () => {
    app.db.seed(`${ROOT}/zones/remote1`, await encrypt(key, { lbl: 'r', isMiss: true, isInverted: false, isHit: false, geo: { type: 'circle', center: { lat: 50, lng: 8 }, radius: 500 } }));
    await settle();
    assert.ok(cache().zones.remote1._e, 'stored encrypted, as on the server');
  });
});

describe('dead zone', () => {
  let drawn, deleted;

  it('shows the offline badge after the connection drops', async () => {
    app.db.setOnline(false);
    await settle(50);
    assert.equal(badge(), '', 'short hiccups are not shown');
    await settle(2100);
    assert.equal(badge(), '⚠ Offline');
  });

  it('keeps drawing and deleting locally, queued in the outbox', async () => {
    drawn = await radarMiss(52, 13);
    deleted = await radarMiss(51, 12);
    zones.delZone(deleted);
    await settle(50);
    assert.equal(app.db.get(`${ROOT}/zones/${drawn}`), null, 'nothing reached the server');
    assert.deepEqual(Object.keys(outbox()), [`zones/${drawn}`, `zones/${deleted}`, `zones/${deleted}/deleted`]);
    assert.equal(badge(), '⚠ Offline · 3 ausstehend');
    assert.equal(await app.isEliminated(52, 13), true, 'map still works offline');
  });

  it('uploads everything in order once back online', async () => {
    app.db.setOnline(true);
    await settle();
    assert.equal((await decrypt(key, app.db.get(`${ROOT}/zones/${drawn}`))).geo.center.lat, 52);
    const del = app.db.get(`${ROOT}/zones/${deleted}`);
    assert.equal(del.deleted, true);
    assert.ok(del._e, 'data uploaded before the delete flag');
    assert.deepEqual(outbox(), {});
    assert.equal(badge(), '');
  });
});
