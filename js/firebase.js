// ── Firebase sync + encryption ─────────────────────────────

import { st, tp, zoneOrderAdd, zoneHistory, thermoHistory, role, setRole, _devId } from './state.js';
import { map } from './map.js';
import { deserializeZone, renderList } from './zones.js';
import { tpDrawBisector } from './thermo.js';
import { bridge } from './bridge.js';

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

const _roomParam = new URLSearchParams(location.search).get('room');
export const FB_ROOM = _roomParam || Array.from(crypto.getRandomValues(new Uint8Array(9)), b => b.toString(36).padStart(2, '0')).join('').slice(0, 12);
if (!_roomParam) {
  const u = new URL(location.href);
  u.searchParams.set('room', FB_ROOM);
  history.replaceState({}, '', u);
}

export let fbDb = null;
let fbReceiving = 0;
let fbPwHash = null;
let _cryptoKey = null;

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

const _writeTimers = {};
const WRITE_DEBOUNCE = 150;

export async function fbWriteZone(id, zoneData) {
  if (!fbDb || fbReceiving) return;
  const encrypted = await fbEncrypt(zoneData);
  clearTimeout(_writeTimers['z_' + id]);
  _writeTimers['z_' + id] = setTimeout(() => {
    fbDb.ref(`${fbRoomPath()}/zones/${id}`).set(encrypted);
    delete _writeTimers['z_' + id];
  }, WRITE_DEBOUNCE);
}

export function fbDeleteZone(id) {
  if (!fbDb || fbReceiving) return;
  clearTimeout(_writeTimers['z_' + id]);
  delete _writeTimers['z_' + id];
  fbDb.ref(`${fbRoomPath()}/zones/${id}/deleted`).set(true);
}

export function fbClearZones() {
  if (!fbDb) return;
  fbDb.ref(`${fbRoomPath()}/zones`).remove();
}

export async function fbWriteThermo(c) {
  if (!fbDb || fbReceiving) return;
  const { id, startPos, stopPos, warmer } = c;
  const encrypted = await fbEncrypt({ id, startPos, stopPos, warmer });
  clearTimeout(_writeTimers['t_' + id]);
  _writeTimers['t_' + id] = setTimeout(() => {
    fbDb.ref(`${fbRoomPath()}/thermos/${id}`).set(encrypted);
    delete _writeTimers['t_' + id];
  }, WRITE_DEBOUNCE);
}

export function fbDeleteThermo(id) {
  if (!fbDb || fbReceiving) return;
  fbDb.ref(`${fbRoomPath()}/thermos/${id}/deleted`).set(true);
}

export function fbClearThermos() {
  if (!fbDb) return;
  fbDb.ref(`${fbRoomPath()}/thermos`).remove();
}

// ── Firebase listeners ─────────────────────────────────────

function _fbApplyZone(id, zd) {
  if (!zd) return;
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

export async function fbWriteLocation(lat, lng) {
  if (!fbDb || role !== 'seeker') return;
  fbDb.ref(`${fbRoomPath()}/locations/${_devId}`).set(await fbEncrypt({ lat, lng, ts: Date.now() }));
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
  ref.on('child_removed', snap => {
    const m = _seekerMarkers[snap.key];
    if (m) { map.removeLayer(m); delete _seekerMarkers[snap.key]; }
  });
}

function _upsertSeekerMarker(id, data) {
  if (!data || !data.lat || !data.lng) return;
  if (_seekerMarkers[id]) {
    _seekerMarkers[id].setLatLng([data.lat, data.lng]);
  } else {
    _seekerMarkers[id] = L.circleMarker([data.lat, data.lng], {
      radius: 9, color: '#fff', fillColor: '#58a6ff', fillOpacity: 1, weight: 2.5
    }).bindTooltip('Seeker', { permanent: true, direction: 'top', className: 'seeker-tooltip' }).addTo(map);
  }
}

function fbListen() {
  // Hiders don't receive zone/thermo data — only seeker locations
  if (role === 'hider') { _fbListenLocations(); return; }

  const zonesRef = fbDb.ref(`${fbRoomPath()}/zones`);
  const thermosRef = fbDb.ref(`${fbRoomPath()}/thermos`);

  zonesRef.on('child_added', async snap => {
    fbReceiving++;
    try { _fbApplyZone(snap.key, await fbDecrypt(snap.val())); _fbScheduleRender(); }
    finally { fbReceiving--; }
  });
  zonesRef.on('child_changed', async snap => {
    fbReceiving++;
    try { _fbApplyZone(snap.key, await fbDecrypt(snap.val())); _fbScheduleRender(); }
    finally { fbReceiving--; }
  });
  zonesRef.on('child_removed', snap => {
    fbReceiving++;
    try { _fbRemoveZone(snap.key); _fbScheduleRender(); }
    finally { fbReceiving--; }
  });

  thermosRef.on('child_added', async snap => {
    fbReceiving++;
    try { _fbApplyThermo(snap.key, await fbDecrypt(snap.val())); _fbScheduleRender(); }
    finally { fbReceiving--; }
  });
  thermosRef.on('child_changed', async snap => {
    fbReceiving++;
    try { _fbApplyThermo(snap.key, await fbDecrypt(snap.val())); _fbScheduleRender(); }
    finally { fbReceiving--; }
  });
  thermosRef.on('child_removed', snap => {
    fbReceiving++;
    try { _fbRemoveThermo(snap.key); _fbScheduleRender(); }
    finally { fbReceiving--; }
  });

  _fbListenLocations();
}

// ── Init ───────────────────────────────────────────────────

async function fbInit(pwHash, pw) {
  fbPwHash = pwHash;
  if (!FB_CONFIG.apiKey || FB_CONFIG.apiKey === 'PASTE_API_KEY') return;
  try {
    _cryptoKey = await fbDeriveKey(pw || pwHash, FB_ROOM);
    if (!firebase.apps.length) firebase.initializeApp(FB_CONFIG);
    fbDb = firebase.database();
    fbListen();
  } catch (e) { console.error('Firebase init:', e); }
}

export function initFirebase() {
  // Publish CRUD functions to the shared bridge
  bridge.fbWriteZone = fbWriteZone;
  bridge.fbDeleteZone = fbDeleteZone;
  bridge.fbWriteThermo = fbWriteThermo;
  bridge.fbDeleteThermo = fbDeleteThermo;
  bridge.fbClearThermos = fbClearThermos;

  // Password modal
  const modal = document.getElementById('pw-modal');
  const input = document.getElementById('pw-input');

  if (!FB_CONFIG.apiKey || FB_CONFIG.apiKey === 'PASTE_API_KEY') {
    modal.style.display = 'none';
    return;
  }

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
    fbInit(hash, pw);
  }

  document.getElementById('pw-submit').addEventListener('click', submit);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
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
