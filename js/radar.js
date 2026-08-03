// ── Radar feature ──────────────────────────────────────────

import { toMeters, unitLabel, requestMapClickPos, tip } from './state.js';
import { t } from './i18n.js';
import { map, locationMarker } from './map.js';
import { addZone, invertedCircleLayer } from './zones.js';

function _execDrawRadar(hit, ll) {
  const km = parseFloat(document.getElementById('radius-km').value);
  if (!Number.isFinite(km) || km <= 0) return;
  const radiusM = toMeters(km);
  const label = `${hit ? '✓ Hit' : '✗ Miss'} Radar ${km} ${unitLabel()}`;
  if (hit) {
    addZone(s => invertedCircleLayer(ll.lat, ll.lng, radiusM, s), label, { isInverted: true });
  } else {
    addZone(s => L.circle([ll.lat, ll.lng], { radius: radiusM, ...s }), label, { isMiss: true });
  }
  map.setView(ll, 12);
}

export function drawRadar(hit) {
  if (locationMarker) {
    _execDrawRadar(hit, locationMarker.getLatLng());
  } else {
    requestMapClickPos(pos => _execDrawRadar(hit, L.latLng(pos.lat, pos.lng)));
    tip(t('tip.tapmap'), 10000);
  }
}

export function initRadar() {
  document.getElementById('btn-ok-hit').addEventListener('click', () => drawRadar(true));
  document.getElementById('btn-ok-miss').addEventListener('click', () => drawRadar(false));
  document.getElementById('radius-km').onkeydown = e => { if (e.key === 'Enter') drawRadar(true); };
}
