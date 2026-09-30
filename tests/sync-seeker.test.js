// Firebase sync as a seeker: room path, encryption, write/delete races,
// remote data, location broadcasting.

import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, settle, fnvHash, deriveKey, encrypt, decrypt } from './harness.js';

const PW = 'geheim';
const ROOT = `${fnvHash(PW)}/main`;  // no ?room= → shared default room

let app, state, zones, key;

// Another client's zone, written straight into the fake database
async function seedZone(id, data) { app.db.seed(`${ROOT}/zones/${id}`, await encrypt(key, data)); }
const circle = (lat, lng, r, extra = {}) => ({ lbl: 'remote', isMiss: true, isInverted: false, isHit: false, geo: { type: 'circle', center: { lat, lng }, radius: r }, ...extra });

// Draw a miss via the UI and return the new zone's id. Remote zones may be
// appended concurrently, so identify ours by label among the new ids.
async function radarMiss(lat, lng, wait = 20) {
  const known = new Set(state.st.zones.map(z => z.id));
  if (!app.$('#radar-sheet').classList.contains('open')) app.click('[data-mode="circ"]');
  app.tapMap(lat, lng);
  app.click('#btn-ok-miss');
  for (let i = 0; i < 100; i++) {
    const z = state.st.zones.find(z => !known.has(z.id) && z.lbl.startsWith('✗ Miss Radar'));
    if (z) { await settle(wait); return z.id; }
    await new Promise(r => setImmediate(r));
  }
  throw new Error('zone was not created');
}

before(async () => {
  app = await boot();
  state = await app.mod('state');
  zones = await app.mod('zones');
  key = await deriveKey(PW, 'main');
  // 30 zones already in the room → 30 async decrypts right after login
  for (let i = 0; i < 30; i++) await seedZone(`seed${i}`, circle(40 + i * 0.1, 0, 1000));
  await app.login(PW, 'seeker');
  await settle();
});
after(() => app.close());

describe('room', () => {
  it('password alone joins the shared room; URL is left untouched', () => {
    assert.equal(app.window.location.search, '');
    assert.ok(app.db.get(ROOT), `data expected under ${ROOT}`);
  });

  it('loads and decrypts existing zones', () => {
    assert.equal(state.st.zones.filter(z => z.id.startsWith('seed')).length, 30);
  });
});

describe('writes', () => {
  beforeEach(async () => { await settle(); });

  // Regression: writes were dropped while remote data was being decrypted
  it('zone drawn while remote data is still arriving is written', async () => {
    for (let i = 0; i < 10; i++) await seedZone(`late${i}`, circle(30, i, 1000));
    const id = await radarMiss(52, 13);
    await settle();
    const stored = app.db.get(`${ROOT}/zones/${id}`);
    assert.ok(stored, 'zone must reach the database');
    const data = await decrypt(key, stored);
    assert.equal(data.isMiss, true);
    assert.deepEqual(data.geo.center, { lat: 52, lng: 13 });
  });

  // Regression: a delete during encryption was overwritten by the late write
  for (const [when, wait] of [['during encryption', 0], ['during write debounce', 20]]) it(`delete ${when} stays deleted and is undoable`, async () => {
    const id = await radarMiss(51, 12, wait);
    zones.delZone(id);
    await settle();
    assert.deepEqual(app.db.get(`${ROOT}/zones/${id}`), { deleted: true });
    assert.equal(state.st.zones.some(z => z.id === id), false);
    assert.ok(state.zoneHistory[id], 'local undo entry survives the echo of the bare delete');

    zones.undoZone(id);
    await settle();
    const stored = app.db.get(`${ROOT}/zones/${id}`);
    assert.equal(stored.deleted, undefined);
    assert.equal((await decrypt(key, stored)).geo.center.lat, 51);
    assert.equal(state.st.zones.some(z => z.id === id), true);
  });

  it('normal delete keeps the encrypted data (soft delete)', async () => {
    const id = await radarMiss(50, 11);
    await settle();
    zones.delZone(id);
    await settle();
    const stored = app.db.get(`${ROOT}/zones/${id}`);
    assert.equal(stored.deleted, true);
    assert.ok(stored._e);
  });
});

describe('remote data', () => {
  it('bare {deleted:true} from another client does not break the panel', async () => {
    app.db.seed(`${ROOT}/zones/ghost`, { deleted: true });
    app.db.seed(`${ROOT}/thermos/ghost`, { deleted: true });
    await settle();
    assert.equal(state.st.zones.some(z => z.id === 'ghost'), false);
    assert.equal(state.tp.constraints.some(c => c.id === 'ghost'), false);
    zones.renderZonePanel();  // must not throw
    assert.ok(app.$('#zone-panel-list .zp-item'));
  });

  it('remote delete moves the zone to the undo list', async () => {
    await seedZone('rd', circle(45, 5, 2000));
    await settle();
    assert.ok(state.st.zones.some(z => z.id === 'rd'));
    app.db.seed(`${ROOT}/zones/rd/deleted`, true);
    await settle();
    assert.equal(state.st.zones.some(z => z.id === 'rd'), false);
    assert.equal(state.zoneHistory.rd.lbl, 'remote');
  });

  it('data encrypted with another password is ignored', async () => {
    const other = await deriveKey('falsch', 'main');
    app.db.seed(`${ROOT}/zones/foreign`, await encrypt(other, circle(1, 1, 1)));
    await settle();
    assert.equal(state.st.zones.some(z => z.id === 'foreign'), false);
  });

  it('thermo reset soft-deletes readings for everyone', async () => {
    app.db.seed(`${ROOT}/thermos/t1`, await encrypt(key, { id: 't1', startPos: { lat: 50, lng: 10 }, stopPos: { lat: 50, lng: 10.1 }, warmer: true }));
    await settle();
    assert.equal(state.tp.constraints.length, 1);
    app.click('#btn-thermo');
    app.click('#btn-tp-reset');
    app.click('#btn-confirm-ok');
    await settle();
    const stored = app.db.get(`${ROOT}/thermos/t1`);
    assert.equal(stored.deleted, true);
    assert.ok(stored._e, 'data kept so it can be restored');
  });
});

describe('seeker location', () => {
  it('is broadcast encrypted and removed on disconnect', async () => {
    app.gps.emit(52.1, 13.2);
    await settle(50);
    const path = `${ROOT}/locations/${state._devId}`;
    const loc = await decrypt(key, app.db.get(path));
    assert.deepEqual([loc.lat, loc.lng], [52.1, 13.2]);
    assert.ok(Math.abs(Date.now() - loc.ts) < 5000);
    assert.ok(app.db.onDisconnectOps.includes(path));
    app.db.disconnect();
    assert.equal(app.db.get(path), null);
  });
});
