// ── Shared application state ────────────────────────────────

export const st = { mode:'none', zones:[], selId:null, labelCb:null };

// Player role — 'hider' or 'seeker', set during login
export let role = sessionStorage.getItem('_role') || null;
export function setRole(r) { role = r; sessionStorage.setItem('_role', r); }

export const T = { circ:'', start:'' };
export const MODE_LABELS = { move:'Verschieben', circ:'Radar', admin:'Gebiet' };

export const zoneHistory  = {};
export const thermoHistory = {};

// Tracks insertion order for zone-panel sorting. Map<id, insertionIndex> gives O(1) lookup.
export const _zoneOrder = new Map();
let _zoneSeq = 0;
export function zoneOrderAdd(id) { if (!_zoneOrder.has(id)) _zoneOrder.set(id, _zoneSeq++); }

export const tp = {
  open: false,
  startPos: null,
  stopPos: null,
  layers: [],
  markers: [],
  constraints: [],
  log: [],
};

export const mq = {
  myLat: null, myLng: null,
  refLat: null, refLng: null, refName: null,
  radius: null,
  refMarker: null,
};

export const admin = { previewLayer: null, pendingData: null, zoom: 4 };

// Prevent accidental property additions (typos silently creating new keys)
Object.seal(st);
Object.seal(tp);
Object.seal(mq);
Object.seal(admin);

// ── Mutable config (use setters from other modules) ────────

export let missColor = localStorage.getItem('missColor') || '#f85149';
export function setMissColor(c) { missColor = c; localStorage.setItem('missColor', c); }

export let useImperial = false;
export function setUseImperial(v) { useImperial = v; }

export let mergedMissLayer = null;
export function setMergedMissLayer(v) { mergedMissLayer = v; }

// ── Map click callback ─────────────────────────────────────

let _mapClickCallback = null;
export function requestMapClickPos(onSuccess) { _mapClickCallback = onSuccess; }
export function cancelMapClickPos() { _mapClickCallback = null; }
export function consumeMapClickCallback() { const cb = _mapClickCallback; _mapClickCallback = null; return cb; }
export function hasMapClickCallback() { return !!_mapClickCallback; }

// ── Device ID ──────────────────────────────────────────────

export const _devId = (() => {
  let id = localStorage.getItem('_devId');
  if (!id) { id = genId(); localStorage.setItem('_devId', id); }
  return id;
})();

// ── Pure utilities ─────────────────────────────────────────

export function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

const DEG2RAD = Math.PI / 180;

export function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const f1 = lat1 * DEG2RAD, f2 = lat2 * DEG2RAD;
  const df = (lat2 - lat1) * DEG2RAD, dl = (lng2 - lng1) * DEG2RAD;
  const a = Math.sin(df / 2) ** 2 + Math.cos(f1) * Math.cos(f2) * Math.sin(dl / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function toDisplay(meters) {
  return useImperial ? (meters / 1609.344).toFixed(1) + ' mi' : (meters / 1000).toFixed(1) + ' km';
}
export function unitLabel() { return useImperial ? 'mi' : 'km'; }
export function toMeters(val) { return useImperial ? val * 1609.344 : val * 1000; }

export function tip(msg, ms = 3500) {
  const el = document.getElementById('tip');
  el.textContent = msg;
  el.style.display = 'block';
  clearTimeout(el._t);
  el._t = setTimeout(() => el.style.display = 'none', ms);
}

// ── Color helpers ──────────────────────────────────────────

function _hexRgb(hex) {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}
function _rgbHex(r, g, b) {
  const c = v => Math.round(v).toString(16).padStart(2, '0');
  return '#' + c(r) + c(g) + c(b);
}

export function colorLighten(hex, t) {
  const [r, g, b] = _hexRgb(hex);
  return _rgbHex(r + (255 - r) * t, g + (255 - g) * t, b + (255 - b) * t);
}

export function colorDarken(hex, t) {
  const [r, g, b] = _hexRgb(hex);
  return _rgbHex(r * (1 - t), g * (1 - t), b * (1 - t));
}

// ── HTML escaping ─────────────────────────────────────────

const _escMap = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function esc(s) { return String(s).replace(/[&<>"']/g, c => _escMap[c]); }
