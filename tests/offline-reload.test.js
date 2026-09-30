// Reload after playing offline: the device's last known state is shown
// immediately and unconfirmed writes from before the reload are re-sent.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, settle, fnvHash, deriveKey, encrypt, decrypt } from './harness.js';

const PW = 'reload';
const ROOT = `${fnvHash(PW)}/main`;
const circle = (lat, lbl) => ({ lbl, isMiss: true, isInverted: false, isHit: false, geo: { type: 'circle', center: { lat, lng: 10 }, radius: 1000 } });

let app, state, key;

before(async () => {
  key = await deriveKey(PW, 'main');
  const cached = await encrypt(key, circle(48, 'cached'));   // known from an earlier session
  const unsent = await encrypt(key, circle(49, 'unsent'));   // drawn offline, never confirmed
  app = await boot({
    local: {
      [`mlCache:${ROOT}`]: JSON.stringify({ zones: { cached, unsent } }),
      [`mlOutbox:${ROOT}`]: JSON.stringify({ 'zones/unsent': { v: unsent, t: 'x' } }),
    },
  });
  state = await app.mod('state');
  const onServer = await encrypt(key, circle(50, 'server'));
  app.db.seed(`${ROOT}/zones/server`, onServer);
  app.db.seed(`${ROOT}/zones/cached`, cached);
  await app.login(PW, 'seeker');
  await settle();
});
after(() => app.close());

describe('reload', () => {
  it('shows cached, unsent and server zones', () => {
    const labels = state.st.zones.map(z => z.lbl).sort();
    assert.deepEqual(labels, ['cached', 'server', 'unsent']);
  });

  it('re-sends the unconfirmed write and clears the outbox', async () => {
    assert.equal((await decrypt(key, app.db.get(`${ROOT}/zones/unsent`))).lbl, 'unsent');
    assert.equal(app.window.localStorage.getItem(`mlOutbox:${ROOT}`), '{}');
  });
});
