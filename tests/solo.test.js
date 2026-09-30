// Solo play: no password, no Firebase, everything stored on the device.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, settle } from './harness.js';

const CACHE = 'mlCache:solo/main';
let app, state, fb;

before(async () => {
  const earlier = { lbl: 'earlier', isMiss: true, isInverted: false, isHit: false, geo: { type: 'circle', center: { lat: 48, lng: 10 }, radius: 1000 } };
  app = await boot({ local: { [CACHE]: JSON.stringify({ zones: { earlier } }) } });
  state = await app.mod('state');
  fb = await app.mod('firebase');
  app.click('#pw-solo');
  await fb.fbReady;
  await settle();
});
after(() => app.close());

const saved = () => JSON.parse(app.window.localStorage.getItem(CACHE));

describe('solo', () => {
  it('starts without password as seeker and shows the solo badge', () => {
    assert.equal(fb.playMode, 'solo');
    assert.equal(state.role, 'seeker');
    assert.equal(app.$('#pw-modal').style.display, 'none');
    assert.equal(app.$('#net-status').textContent, '📴 Solo');
  });

  it('restores zones from the last solo session', () => {
    assert.deepEqual(state.st.zones.map(z => z.lbl), ['earlier']);
  });

  it('saves new zones and thermometer readings on the device only', async () => {
    app.click('[data-mode="circ"]');
    app.tapMap(52, 13);
    app.click('#btn-ok-hit');
    const { tp } = state;
    app.click('#btn-thermo');
    app.gps.position = { lat: 50, lng: 10 };
    app.click('#btn-tp-start');
    await settle(20);
    app.gps.position = { lat: 50, lng: 10.1 };
    app.click('#btn-tp-stop');
    await settle(20);
    app.click('#btn-tp-warmer');
    await settle();

    const s = saved();
    assert.equal(Object.keys(s.zones).length, 2);
    const hit = Object.values(s.zones).find(z => z.lbl !== 'earlier');
    assert.equal(hit.isHit, true, 'stored unencrypted — no password in solo mode');
    assert.equal(Object.keys(s.thermos).length, 1);
    assert.equal(tp.constraints.length, 1);
    assert.equal(app.window.localStorage.getItem('mlOutbox:solo/main'), null, 'no outbox without a server');
    assert.equal(app.firebase.apps.length, 0, 'Firebase never initialised');
  });

  it('delete survives as a soft delete', async () => {
    const zones = await app.mod('zones');
    const id = Object.keys(saved().zones).find(k => saved().zones[k].lbl === 'earlier');
    zones.delZone(id);
    assert.equal(saved().zones[id].deleted, true);
  });
});
