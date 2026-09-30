// ── Firebase sync + encryption ─────────────────────────────

import { st, tp, zoneOrderAdd, zoneHistory, thermoHistory, role, setRole, _devId, tip } from './state.js';
import { map } from './map.js';
import { deserializeZone, renderList } from './zones.js';
import { tpDrawBisector } from './thermo.js';
import { bridge } from './bridge.js';
import { t } from './i18n.js';
import { RoomMirror } from './offline.js';

// ── Config ─────────────────────────────────────────────────

const FB_CONFIG = {
  apiKey: "AIzaSyDaK2Q6VYfWwK00xW7wQaCQDX32SkTODIs",
  authDomain: "maplag-a802e.firebaseapp.com",
  databaseURL: "https://maplag-a802e-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "maplag-a802e",
  storageBucket: "maplag-a802e.firebasestorage.app",
  messagingSenderId: "831638967959",
  appId: "1:831638967959:web:dcde04a325d008235cbbd2",
  measurementId: "G-HX6Z40HFNT"
};

export { FB_CONFIG };

// Without ?room= everyone with the same password shares one map.
// ?room=<name> gives a separate map under the same password.
export const FB_ROOM = new URLSearchParams(location.search).get('room') || 'main';

// Seeker positions older than this are treated as stale (tab closed without cleanup)
export const LOCATION_TTL = 10 * 60 * 1000;

export let fbDb = null;
export let fbReady = null;  // resolves once the key is derived and listeners are attached
let fbPwHash = null;
let _cryptoKey = null;

// Set once the player joined: 'online' (Firebase + local mirror) or 'solo' (local only)
export let playMode = null;
let _mirror = null;
let _connected = true;  // optimistic until Firebase reports otherwise

function _pwHash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(36);
}

export function fbRoomPath() { return `${fbPwHash}/${FB_ROOM}`; }

// ── Encryption ─────────────────────────────────────────────

async function fbDeriveKey(password, roomId) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode('maplag_' + roomId), iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function fbEncrypt(obj) {
  if (!_cryptoKey) return obj;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, _cryptoKey, enc.encode(JSON.stringify(obj)));
  return {
    _e: {
      iv: btoa(String.fromCharCode(...iv)),
      d: btoa(String.fromCharCode(...new Uint8Array(cipher)))
    }
  };
}

async function fbDecrypt(wrapper) {
  if (!wrapper || !wrapper._e || !_cryptoKey) return wrapper;
  try {
    const iv = Uint8Array.from(atob(wrapper._e.iv), c => c.charCodeAt(0));
    const buf = Uint8Array.from(atob(wrapper._e.d), c => c.charCodeAt(0));
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, _cryptoKey, buf);
    const obj = JSON.parse(new TextDecoder().decode(plain));
    if (wrapper.deleted) obj.deleted = true;
    return obj;
  } catch (e) {
    console.error('fbDecrypt failed:', e);
    return null;
  }
}

// ── CRUD ───────────────────────────────────────────────────
// Writes go to the local mirror first (cache + outbox), then to Firebase.
// The outbox entry is dropped once Firebase confirms the write; until then
// it survives reloads and is re-sent on the next start.

const _writeTimers = {};
const _writeTokens = {};
const WRITE_DEBOUNCE = 150;

function _commit(rel, value) {
  const ack = _mirror.write(rel, value);
  if (fbDb) fbDb.ref(`${fbRoomPath()}/${rel}`).set(value).then(ack, e => console.warn('Firebase write failed:', rel, e));
}

// Debounced encrypted write. The token is claimed before encrypting, so a
// delete (or newer write) issued while encryption is in flight wins.
async function _queueWrite(key, rel, data) {
  const token = Symbol(key);
  _writeTokens[key] = token;
  clearTimeout(_writeTimers[key]);
  const encrypted = await fbEncrypt(data);
  if (_writeTokens[key] !== token) return;
  _writeTimers[key] = setTimeout(() => {
    delete _writeTimers[key];
    delete _writeTokens[key];
    _commit(rel, encrypted);
  }, WRITE_DEBOUNCE);
}

function _cancelWrite(key) {
  delete _writeTokens[key];
  clearTimeout(_writeTimers[key]);
  delete _writeTimers[key];
}

export function fbWriteZone(id, zoneData) {
  if (!_mirror) return;
  return _queueWrite('z_' + id, `zones/${id}`, zoneData);
}

export function fbDeleteZone(id) {
  if (!_mirror) return;
  _cancelWrite('z_' + id);
  _commit(`zones/${id}/deleted`, true);
}

export function fbWriteThermo(c) {
  if (!_mirror) return;
  const { id, startPos, stopPos, warmer } = c;
  return _queueWrite('t_' + id, `thermos/${id}`, { id, startPos, stopPos, warmer });
}

export function fbDeleteThermo(id) {
  if (!_mirror) return;
  _cancelWrite('t_' + id);
  _commit(`thermos/${id}/deleted`, true);
}

// ── Firebase listeners ─────────────────────────────────────

function _fbApplyZone(id, zd) {
  if (!zd) return;
  // Bare {deleted:true}: deleted before its data was ever written. Drop the
  // zone but keep any local undo entry (the deleting client still has the data).
  if (!zd.geo) {
    const i = st.zones.findIndex(z => z.id === id);
    if (i >= 0) { map.removeLayer(st.zones[i].layer); st.zones.splice(i, 1); }
    return;
  }
  const idx = st.zones.findIndex(z => z.id === id);
  if (idx >= 0) { map.removeLayer(st.zones[idx].layer); st.zones.splice(idx, 1); }
  delete zoneHistory[id];
  zoneOrderAdd(id);

  if (zd.deleted) {
    const cleanData = { ...zd }; delete cleanData.deleted;
    zoneHistory[id] = { id, lbl: zd.lbl, fbData: cleanData };
  } else {
    try { deserializeZone(id, zd); } catch (e) { console.error('deserializeZone', id, e); }
  }
}

function _fbRemoveZone(id) {
  const idx = st.zones.findIndex(z => z.id === id);
  if (idx >= 0) { map.removeLayer(st.zones[idx].layer); st.zones.splice(idx, 1); }
  delete zoneHistory[id];
}

function _fbApplyThermo(id, c) {
  if (!c) return;
  const idx = tp.constraints.findIndex(x => x.id === id);
  if (idx >= 0) tp.constraints.splice(idx, 1);
  if (!c.startPos || !c.stopPos) return;  // bare {deleted:true}, see _fbApplyZone
  delete thermoHistory[id];
  zoneOrderAdd(id);

  const clean = { startPos: c.startPos, stopPos: c.stopPos, warmer: c.warmer, id };
  if (c.deleted) { thermoHistory[id] = clean; }
  else { tp.constraints.push(clean); }
}

function _fbRemoveThermo(id) {
  const idx = tp.constraints.findIndex(x => x.id === id);
  if (idx >= 0) tp.constraints.splice(idx, 1);
  delete thermoHistory[id];
}

let _fbRenderTimer = null;
function _fbScheduleRender() {
  clearTimeout(_fbRenderTimer);
  _fbRenderTimer = setTimeout(() => {
    if (role === 'hider') return;  // hiders don't see seeker zones
    tp.layers.forEach(l => map.removeLayer(l)); tp.layers = [];
    tp.constraints.forEach(c => { if (c.startPos && c.stopPos) tpDrawBisector(c); });
    renderList();
  }, 50);
}

// ── Seeker location broadcasting ──────────────────────────

const _seekerMarkers = {};
let _locDisconnectSet = false;

export async function fbWriteLocation(lat, lng) {
  if (!fbDb || role !== 'seeker') return;
  const ref = fbDb.ref(`${fbRoomPath()}/locations/${_devId}`);
  // beforeunload rarely fires on mobile — let the server remove our position
  if (!_locDisconnectSet) { ref.onDisconnect().remove(); _locDisconnectSet = true; }
  ref.set(await fbEncrypt({ lat, lng, ts: Date.now() }));
}

export function fbRemoveLocation() {
  if (!fbDb) return;
  fbDb.ref(`${fbRoomPath()}/locations/${_devId}`).remove();
}

function _fbListenLocations() {
  if (role !== 'hider') return;
  const ref = fbDb.ref(`${fbRoomPath()}/locations`);

  ref.on('child_added', async snap => _upsertSeekerMarker(snap.key, await fbDecrypt(snap.val())));
  ref.on('child_changed', async snap => _upsertSeekerMarker(snap.key, await fbDecrypt(snap.val())));
  ref.on('child_removed', snap => _removeSeekerMarker(snap.key));
  setInterval(_sweepStaleSeekers, 60 * 1000);
}

function _removeSeekerMarker(id) {
  const m = _seekerMarkers[id];
  if (m) { map.removeLayer(m); delete _seekerMarkers[id]; }
}

export function _sweepStaleSeekers() {
  const now = Date.now();
  Object.keys(_seekerMarkers).forEach(id => {
    if (now - _seekerMarkers[id]._ts > LOCATION_TTL) _removeSeekerMarker(id);
  });
}

function _upsertSeekerMarker(id, data) {
  if (!data || data.lat == null || data.lng == null) return;
  if (!data.ts || Date.now() - data.ts > LOCATION_TTL) { _removeSeekerMarker(id); return; }
  if (_seekerMarkers[id]) {
    _seekerMarkers[id].setLatLng([data.lat, data.lng]);
  } else {
    _seekerMarkers[id] = L.circleMarker([data.lat, data.lng], {
      radius: 9, color: '#fff', fillColor: '#58a6ff', fillOpacity: 1, weight: 2.5
    }).bindTooltip('Seeker', { permanent: true, direction: 'top', className: 'seeker-tooltip' }).addTo(map);
  }
  _seekerMarkers[id]._ts = data.ts;
}

function fbListen() {
  // Hiders don't receive zone/thermo data — only seeker locations
  if (role === 'hider') { _fbListenLocations(); return; }

  const listen = (kind, apply, remove) => {
    const ref = fbDb.ref(`${fbRoomPath()}/${kind}`);
    const upsert = async snap => {
      _mirror.put(`${kind}/${snap.key}`, snap.val());
      apply(snap.key, await fbDecrypt(snap.val()));
      _fbScheduleRender();
    };
    ref.on('child_added', upsert);
    ref.on('child_changed', upsert);
    ref.on('child_removed', snap => {
      _mirror.put(`${kind}/${snap.key}`, null);
      remove(snap.key);
      _fbScheduleRender();
    });
  };
  listen('zones', _fbApplyZone, _fbRemoveZone);
  listen('thermos', _fbApplyThermo, _fbRemoveThermo);

  _fbListenLocations();
}

// ── Offline status badge ───────────────────────────────────

function _updateNetStatus() {
  const el = document.getElementById('net-status');
  if (!el) return;
  const n = _mirror ? _mirror.pendingCount() : 0;
  let txt = '';
  if (playMode === 'solo') txt = t('net.solo');
  else if (playMode === 'online' && !_connected) txt = t('net.offline', n);
  else if (n) txt = t('net.syncing', n);
  el.textContent = txt;
  el.style.display = txt ? '' : 'none';
}

// Firebase reports "disconnected" briefly while connecting and on short
// hiccups, so only show offline after it persisted for a moment
let _offlineTimer = null;
function _watchConnection() {
  fbDb.ref('.info/connected').on('value', snap => {
    clearTimeout(_offlineTimer);
    if (snap.val() === true) { _connected = true; _updateNetStatus(); }
    else _offlineTimer = setTimeout(() => { _connected = false; _updateNetStatus(); }, 2000);
  });
}

// ── Init ───────────────────────────────────────────────────

function _openMirror(roomPath, opts) {
  _mirror = new RoomMirror(roomPath, opts);
  _mirror.onchange = _updateNetStatus;
  _mirror.onerror = () => tip(t('tip.storagefull'), 6000);
}

// Show what this device last knew about the room, before (or without) the server
async function _loadMirror() {
  for (const [kind, apply] of [['zones', _fbApplyZone], ['thermos', _fbApplyThermo]]) {
    for (const [id, w] of Object.entries(_mirror.children(kind))) apply(id, await fbDecrypt(w));
  }
  _fbScheduleRender();
}

async function fbInit(pwHash, pw) {
  fbPwHash = pwHash;
  try {
    _cryptoKey = await fbDeriveKey(pw || pwHash, FB_ROOM);
    playMode = 'online';
    _openMirror(fbRoomPath());
    if (role !== 'hider') await _loadMirror();
    if (typeof firebase === 'undefined') {
      // SDK not loaded (started offline): keep playing locally, sync next time
      _connected = false;
      return;
    }
    if (!firebase.apps.length) firebase.initializeApp(FB_CONFIG);
    fbDb = firebase.database();
    // Re-send writes that were never confirmed (e.g. made offline before a reload)
    _mirror.pending().forEach(p => fbDb.ref(`${fbRoomPath()}/${p.rel}`).set(p.value).then(p.ack, () => {}));
    _watchConnection();
    fbListen();
  } catch (e) { console.error('Firebase init:', e); }
  finally { _updateNetStatus(); }
}

// Solo: no password, no server — zones live only on this device
async function soloInit() {
  playMode = 'solo';
  _openMirror(`solo/${FB_ROOM}`, { withOutbox: false });
  await _loadMirror();
  _updateNetStatus();
}

export function initFirebase() {
  // Publish CRUD functions to the shared bridge
  bridge.fbWriteZone = fbWriteZone;
  bridge.fbDeleteZone = fbDeleteZone;
  bridge.fbWriteThermo = fbWriteThermo;
  bridge.fbDeleteThermo = fbDeleteThermo;

  // Password modal
  const modal = document.getElementById('pw-modal');
  const input = document.getElementById('pw-input');

  // Role selection buttons
  let selectedRole = sessionStorage.getItem('_role') || 'seeker';
  const hiderBtn = document.getElementById('pw-role-hider');
  const seekerBtn = document.getElementById('pw-role-seeker');

  function _selectRole(r) {
    selectedRole = r;
    hiderBtn.classList.toggle('sel', r === 'hider');
    seekerBtn.classList.toggle('sel', r === 'seeker');
  }
  _selectRole(selectedRole);
  hiderBtn.addEventListener('click', () => _selectRole('hider'));
  seekerBtn.addEventListener('click', () => _selectRole('seeker'));

  function submit() {
    const pw = input.value.trim();
    if (!pw) { input.focus(); return; }
    const hash = _pwHash(pw);
    setRole(selectedRole);
    modal.style.display = 'none';
    applyRole(selectedRole);
    fbReady = fbInit(hash, pw);
  }

  document.getElementById('pw-submit').addEventListener('click', submit);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
  document.getElementById('pw-solo').addEventListener('click', () => {
    setRole('seeker');  // solo is for searching; hiding needs other players
    modal.style.display = 'none';
    applyRole('seeker');
    fbReady = soloInit();
  });
  setTimeout(() => input.focus(), 100);
}

// ── Apply role restrictions to UI ─────────────────────────

function applyRole(r) {
  if (r === 'hider') {
    // Hide seeker-only tools
    document.querySelector('[data-mode="circ"]').style.display = 'none';
    document.getElementById('btn-thermo').style.display = 'none';
    document.getElementById('btn-mq').style.display = 'none';
    document.getElementById('btn-admin').style.display = 'none';
    document.getElementById('btn-zones').style.display = 'none';
  }
}
