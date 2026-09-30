// ── Radar feature ──────────────────────────────────────────

import { toMeters, unitLabel, requestMapClickPos, tip } from './state.js';
import { t } from './i18n.js';
import { map, locationMarker } from './map.js';
import { addZone, invertedCircleLayer } from './zones.js';

// Center picked by tapping the map in radar mode; overrides GPS when set
let _center = null;
let _centerMarker = null;

export function radarSetCenter(lat, lng) {
  _center = L.latLng(lat, lng);
  if (_centerMarker) _centerMarker.setLatLng(_center);
  else _centerMarker = L.circleMarker(_center, {
    radius: 8, color: '#fff', fillColor: '#e8b84b', fillOpacity: 1, weight: 2.5
  }).addTo(map);
  tip(t('tip.radarcenter'));
}

export function radarClearCenter() {
  _center = null;
  if (_centerMarker) { map.removeLayer(_centerMarker); _centerMarker = null; }
}

function _execDrawRadar(hit, ll) {
  const km = parseFloat(document.getElementById('radius-km').value);
  if (!Number.isFinite(km) || km <= 0) return;
  const radiusM = toMeters(km);
  const label = `${hit ? '✓ Hit' : '✗ Miss'} Radar ${km} ${unitLabel()}`;
  if (hit) {
    addZone(s => invertedCircleLayer(ll.lat, ll.lng, radiusM, s), label, { isInverted: true, isHit: true });
  } else {
    addZone(s => L.circle([ll.lat, ll.lng], { radius: radiusM, ...s }), label, { isMiss: true });
  }
  radarClearCenter();
  map.setView(ll, 12);
}

export function drawRadar(hit) {
  if (_center) {
    _execDrawRadar(hit, _center);
  } else if (locationMarker) {
    _execDrawRadar(hit, locationMarker.getLatLng());
  } else {
    requestMapClickPos(pos => _execDrawRadar(hit, L.latLng(pos.lat, pos.lng)));
    tip(t('tip.tapmap'), 10000);
  }
}

export function initRadar() {
  document.getElementById('btn-ok-hit').addEventListener('click', () => drawRadar(true));
  document.getElementById('btn-ok-miss').addEventListener('click', () => drawRadar(false));
}
