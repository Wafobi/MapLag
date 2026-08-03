// ── Main entry point ────────────────────────────────────────
// Imports all modules and wires up the remaining event bindings.

import { st, tp, T, cancelMapClickPos, mq, consumeMapClickCallback, tip, _devId } from './state.js';
import { t, uiLang, applyLang, setUiLang } from './i18n.js';
import { map, locationMarker, startLocation, locationWatch } from './map.js';
import { initUI, closeAllSheets } from './ui.js';
import { initRadar } from './radar.js';
import { initThermo } from './thermo.js';
import { initMeasure, mqSelectRef, mqStopPolling } from './measure.js';
import { initSearch } from './search.js';
import { initAdmin, adminFetchBoundary } from './admin.js';
import { initFirebase, fbRemoveLocation } from './firebase.js';

// ── Start location tracking ───────────────────────────────
startLocation();

// ── Init all modules ──────────────────────────────────────
initUI();
initRadar();
initThermo();
initMeasure();
initSearch();
initAdmin();
initFirebase();

// ── Mode switching (toolbar data-mode buttons) ────────────
document.querySelectorAll('[data-mode]').forEach(b => {
  b.addEventListener('click', () => {
    const clicked = b.dataset.mode;
    if (st.mode === clicked) {
      st.mode = 'none';
      document.querySelectorAll('[data-mode]').forEach(x => x.classList.remove('active'));
      map.dragging.enable();
      document.getElementById('radar-sheet').classList.remove('open');
      return;
    }
    closeAllSheets();
    st.mode = clicked;
    b.classList.add('active');
    if (st.mode === 'circ') {
      document.getElementById('radar-sheet').classList.add('open');
      setTimeout(() => document.getElementById('radius-km').focus(), 100);
      return;
    }
  });
});

// ── Map click handler ─────────────────────────────────────
map.on('click', async (e) => {
  const cb = consumeMapClickCallback();
  if (cb) {
    cb({ lat: e.latlng.lat, lng: e.latlng.lng });
    return;
  }
  if (document.getElementById('mq-sheet').classList.contains('open') && mq.myLat !== null) {
    mqSelectRef(e.latlng.lat, e.latlng.lng, `${e.latlng.lat.toFixed(4)}, ${e.latlng.lng.toFixed(4)}`);
    return;
  }
  if (st.mode === 'admin') {
    await adminFetchBoundary(e.latlng.lat, e.latlng.lng);
    return;
  }
  if (st.mode !== 'circ') return;
});

// ── Thermo toggle ─────────────────────────────────────────
function toggleThermo() {
  const wasOpen = tp.open;
  closeAllSheets();
  if (!wasOpen) {
    tp.open = true;
    document.getElementById('thermo-panel').classList.add('open');
    document.getElementById('btn-thermo').classList.add('active');
  }
}
document.getElementById('btn-thermo').addEventListener('click', toggleThermo);

// ── Locate button ─────────────────────────────────────────
document.getElementById('btn-locate').addEventListener('click', () => {
  if (locationMarker) {
    map.setView(locationMarker.getLatLng(), 14);
  } else {
    tip(t('tip.nogps'));
  }
});

// ── Language toggle ───────────────────────────────────────
document.getElementById('btn-lang-ui').addEventListener('click', () => {
  setUiLang(uiLang === 'de' ? 'en' : 'de');
  applyLang();
});
applyLang();

// ── User ID label ────────────────────────────────────────
const uidEl = document.getElementById('uid-label');
uidEl.textContent = _devId.slice(0, 8);
uidEl.title = `ID: ${_devId}`;
uidEl.addEventListener('click', () => {
  navigator.clipboard.writeText(_devId).then(() => tip('ID copied'));
});

// ── Map resize observer ───────────────────────────────────
new ResizeObserver(() => map.invalidateSize()).observe(document.getElementById('map'));
tip(T.start, 4000);

// ── Cleanup ───────────────────────────────────────────────
window.addEventListener('beforeunload', () => {
  if (locationWatch) navigator.geolocation.clearWatch(locationWatch);
  mqStopPolling();
  fbRemoveLocation();
});
