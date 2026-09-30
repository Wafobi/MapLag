// App opened from the offline cache while the Firebase SDK could not load:
// the game still works on local data and queues writes for later.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, settle, fnvHash, deriveKey, encrypt } from './harness.js';

const PW = 'nosdk';
const ROOT = `${fnvHash(PW)}/main`;
let app, state;

before(async () => {
  const key = await deriveKey(PW, 'main');
  const cached = await encrypt(key, { lbl: 'cached', isMiss: true, isInverted: false, isHit: false, geo: { type: 'circle', center: { lat: 48, lng: 10 }, radius: 1000 } });
  app = await boot({ firebase: false, local: { [`mlCache:${ROOT}`]: JSON.stringify({ zones: { cached } }) } });
  state = await app.mod('state');
  await app.login(PW, 'seeker');
  await settle();
});
after(() => app.close());

describe('without Firebase SDK', () => {
  it('shows the cached zones and the offline badge', () => {
    assert.deepEqual(state.st.zones.map(z => z.lbl), ['cached']);
    assert.equal(app.$('#net-status').textContent, '⚠ Offline');
  });

  it('queues new zones in the outbox', async () => {
    app.click('[data-mode="circ"]');
    app.tapMap(52, 13);
    app.click('#btn-ok-hit');
    await settle();
    const outbox = JSON.parse(app.window.localStorage.getItem(`mlOutbox:${ROOT}`));
    assert.equal(Object.keys(outbox).length, 1);
    assert.equal(app.$('#net-status').textContent, '⚠ Offline · 1 ausstehend');
  });
});
