// ── Measuring question feature ─────────────────────────────

import { mq, haversine, toDisplay, tip, requestMapClickPos, cancelMapClickPos } from './state.js';
import { t } from './i18n.js';
import { map, locationMarker } from './map.js';
import { addZone, invertedCircleLayer } from './zones.js';
import { closeAllSheets } from './ui.js';

let _mqInterval = null;

function _mqStartPolling() {
  if (_mqInterval) return;
  _mqInterval = setInterval(() => {
    if (locationMarker && document.getElementById('mq-sheet').classList.contains('open')) mqUpdateMyPos();
    else _mqStopPolling();
  }, 3000);
}

function _mqStopPolling() {
  if (_mqInterval) { clearInterval(_mqInterval); _mqInterval = null; }
}

export function mqStopPolling() { _mqStopPolling(); }

export function mqOpen() {
  closeAllSheets();
  document.getElementById('mq-sheet').classList.add('open');
  document.getElementById('btn-mq').classList.add('active');
  mqUpdateMyPos();
  _mqStartPolling();
}

function mqUpdateMyPos() {
  if (!locationMarker) {
    mq.myLat = null; mq.myLng = null;
    requestMapClickPos(pos => {
      mq.myLat = pos.lat;
      mq.myLng = pos.lng;
      tip(t('tip.tapgoal'), 6000);
    });
    tip(t('tip.tapmap'), 10000);
    return;
  }
  const ll = locationMarker.getLatLng();
  mq.myLat = ll.lat;
  mq.myLng = ll.lng;
  mqRecalc();
}

export function mqSelectRef(lat, lng, name) {
  mq.refLat = lat;
  mq.refLng = lng;
  mq.refName = name;
  document.getElementById('mq-selected-name').textContent = name;
  document.getElementById('mq-selected').style.display = 'block';
  if (mq.refMarker) map.removeLayer(mq.refMarker);
  mq.refMarker = L.circleMarker([lat, lng], {
    radius: 10, color: '#fff', fillColor: '#f0c040', fillOpacity: 1, weight: 2.5
  }).addTo(map);
  mqRecalc();
}

function mqRecalc() {
  if (mq.myLat && mq.refLat) {
    mq.radius = haversine(mq.myLat, mq.myLng, mq.refLat, mq.refLng);
    document.getElementById('mq-selected-dist').textContent = t('mq.distfrom', toDisplay(mq.radius));
    document.getElementById('btn-mq-closer').style.opacity = '1';
    document.getElementById('btn-mq-further').style.opacity = '1';
  }
}

async function mqDraw(closer) {
  if (!mq.refLat || !mq.radius) { tip(t('tip.notapgoal')); return; }
  const label = (closer ? '✓ Closer' : '✗ Further') + ' — ' + mq.refName + ' (' + toDisplay(mq.radius) + ')';
  const refLat = mq.refLat, refLng = mq.refLng, radius = mq.radius;

  document.getElementById('mq-selected').style.display = 'none';
  document.getElementById('btn-mq-closer').style.opacity = '0.4';
  document.getElementById('btn-mq-further').style.opacity = '0.4';
  mq.refLat = null; mq.refLng = null; mq.refName = null; mq.radius = null;
  if (mq.refMarker) { map.removeLayer(mq.refMarker); mq.refMarker = null; }
  mqUpdateMyPos();

  if (closer) {
    await addZone(s => invertedCircleLayer(refLat, refLng, radius, s), label, { isInverted: true });
  } else {
    await addZone(s => L.circle([refLat, refLng], { radius, ...s }), label, { isMiss: true });
  }
}

export function initMeasure() {
  document.getElementById('btn-mq').addEventListener('click', () => {
    const isOpen = document.getElementById('mq-sheet').classList.contains('open');
    if (!isOpen) { mqOpen(); } else {
      document.getElementById('mq-sheet').classList.remove('open');
      document.getElementById('btn-mq').classList.remove('active');
    }
  });
  document.getElementById('btn-mq-close').addEventListener('click', () => {
    cancelMapClickPos();
    document.getElementById('mq-sheet').classList.remove('open');
    document.getElementById('btn-mq').classList.remove('active');
  });
  document.getElementById('btn-mq-closer').addEventListener('click', () => mqDraw(true));
  document.getElementById('btn-mq-further').addEventListener('click', () => mqDraw(false));
}
