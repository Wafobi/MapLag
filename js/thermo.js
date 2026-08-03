// ── Thermometer feature + bisector math ────────────────────

import { tp, zoneOrderAdd, thermoHistory, genId, haversine, tip, requestMapClickPos } from './state.js';
import { t } from './i18n.js';
import { map } from './map.js';
import { renderList } from './zones.js';
import { bridge } from './bridge.js';

// ── GPS helper ─────────────────────────────────────────────

export function tpGetGPS(onSuccess) {
  if (!navigator.geolocation) {
    requestMapClickPos(onSuccess);
    tip(t('tip.tapmap'), 10000);
    return;
  }
  tip(t('tip.gettinggps'), 2000);
  navigator.geolocation.getCurrentPosition(
    pos => onSuccess({ lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy }),
    err => {
      const msgs = { 1: t('tip.gpsdeny'), 2: t('tip.gpsnavail'), 3: t('tip.gpstimeout') };
      tip((msgs[err.code] || t('tip.gpserror')) + t('tip.gpstap'), 6000);
      requestMapClickPos(onSuccess);
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
  );
}

// ── Marker helper ──────────────────────────────────────────

export function tpAddMarker(lat, lng, color, label) {
  const m = L.circleMarker([lat, lng], {
    radius: 10, color: '#fff', fillColor: color, fillOpacity: 1, weight: 2.5
  }).bindTooltip(label, { permanent: true, direction: 'top', className: 'tp-tooltip' }).addTo(map);
  tp.markers.push(m);
  return m;
}

// ── Bisector math ──────────────────────────────────────────

const _toMercY = lat => Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
export const _fromMercY = y => (2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180 / Math.PI;

export function tpConstraintToElimCoords(c) {
  const { startPos, stopPos, warmer } = c;
  const midLat = (startPos.lat + stopPos.lat) / 2;
  const midLng = (startPos.lng + stopPos.lng) / 2;
  const cosLat = Math.cos(midLat * Math.PI / 180);
  const dLatToMerc = Math.PI / (180 * cosLat);

  const dLat = stopPos.lat - startPos.lat;
  const dLng = (stopPos.lng - startPos.lng) * cosLat;
  const len = Math.sqrt(dLat * dLat + dLng * dLng);

  const pX = dLat / len / cosLat;
  const pY = (-dLng / len) * dLatToMerc;
  const pLen = Math.sqrt(pX * pX + pY * pY);
  const mDirX = pX / pLen, mDirY = pY / pLen;

  const elimPos = warmer ? startPos : stopPos;
  const eX = elimPos.lng - midLng;
  const eY = (elimPos.lat - midLat) * dLatToMerc;
  const eLen = Math.sqrt(eX * eX + eY * eY);
  const eDirX = eX / eLen, eDirY = eY / eLen;

  return { mMidX: midLng, mMidY: _toMercY(midLat), mDirX, mDirY, eDirX, eDirY };
}

export function _mercClipT(mMidX, mMidY, mDirX, mDirY) {
  const minX = -180, maxX = 180;
  const minY = _toMercY(-85.051129), maxY = _toMercY(85.051129);
  let tMin = -Infinity, tMax = Infinity;
  if (Math.abs(mDirX) > 1e-10) {
    const t1 = (minX - mMidX) / mDirX, t2 = (maxX - mMidX) / mDirX;
    tMin = Math.max(tMin, Math.min(t1, t2));
    tMax = Math.min(tMax, Math.max(t1, t2));
  }
  if (Math.abs(mDirY) > 1e-10) {
    const t1 = (minY - mMidY) / mDirY, t2 = (maxY - mMidY) / mDirY;
    tMin = Math.max(tMin, Math.min(t1, t2));
    tMax = Math.min(tMax, Math.max(t1, t2));
  }
  return [tMin, tMax];
}

export function tpDrawBisector(c) {
  const { mMidX, mMidY, mDirX, mDirY } = tpConstraintToElimCoords(c);
  const [tMin, tMax] = _mercClipT(mMidX, mMidY, mDirX, mDirY);
  const steps = 64;
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = tMin + (i / steps) * (tMax - tMin);
    pts.push([_fromMercY(mMidY + mDirY * t), mMidX + mDirX * t]);
  }
  const bisector = L.polyline(pts, {
    color: '#e8b84b', weight: 2.5, opacity: 0.9, dashArray: '8 5'
  }).addTo(map);
  tp.layers.push(bisector);
}

// ── Constraints rendering ──────────────────────────────────

export function tpRenderConstraints() {
  tp.layers.forEach(l => map.removeLayer(l));
  tp.layers = [];

  if (tp.startPos && tp.stopPos) {
    const connLine = L.polyline(
      [[tp.startPos.lat, tp.startPos.lng], [tp.stopPos.lat, tp.stopPos.lng]],
      { color: '#f0c040', weight: 2, opacity: 0.5, dashArray: '4 4' }
    ).addTo(map);
    tp.layers.push(connLine);
  }

  tp.constraints.forEach(c => {
    if (c.startPos && c.stopPos) tpDrawBisector(c);
  });
  renderList();
}

// ── Answer logic ───────────────────────────────────────────

function tpAnswer(warmer) {
  if (!tp.startPos || !tp.stopPos) return;
  const newC = { id: genId(), startPos: { ...tp.startPos }, stopPos: { ...tp.stopPos }, warmer };
  tp.constraints.push(newC);
  zoneOrderAdd(newC.id);
  tpRenderConstraints();
  bridge.fbWriteThermo(newC);
  tp.startPos = null; tp.stopPos = null;
  document.getElementById('tp-start-info').style.display = 'none';
  document.getElementById('tp-step-stop').style.display = 'none';
  document.getElementById('tp-step-answer').style.display = 'none';
  document.getElementById('tp-step-start').querySelector('button').style.display = 'block';
}

// ── Init (event bindings) ──────────────────────────────────

export function initThermo() {
  // Publish thermo math functions to the shared bridge
  bridge.tpConstraintToElimCoords = tpConstraintToElimCoords;
  bridge._mercClipT = _mercClipT;
  bridge._fromMercY = _fromMercY;

  document.getElementById('btn-tp-start').addEventListener('click', () => {
    tpGetGPS(pos => {
      tp.startPos = pos;
      tpAddMarker(pos.lat, pos.lng, '#3fb950', t('tp.startMarker'));
      map.setView([pos.lat, pos.lng], 13);
      document.getElementById('tp-start-info').style.display = 'block';
      document.getElementById('tp-start-coords').textContent = `${pos.lat.toFixed(4)}, ${pos.lng.toFixed(4)}`;
      document.getElementById('tp-step-stop').style.display = 'block';
      document.getElementById('tp-step-start').querySelector('button').style.display = 'none';
      document.getElementById('tp-start-coords2').textContent = `${pos.lat.toFixed(4)}, ${pos.lng.toFixed(4)}`;
      tip(t('tip.startset'));
    });
  });

  document.getElementById('btn-tp-stop').addEventListener('click', () => {
    if (!tp.startPos) { tip(t('tp.startfirst')); return; }
    tpGetGPS(pos => {
      tp.stopPos = pos;
      tpAddMarker(pos.lat, pos.lng, '#f0c040', t('tp.stopMarker'));
      const dist = haversine(tp.startPos.lat, tp.startPos.lng, pos.lat, pos.lng);
      const distKm = (dist / 1000).toFixed(1);
      document.getElementById('tp-stop-info').style.display = 'block';
      document.getElementById('tp-stop-coords').textContent = `${pos.lat.toFixed(4)}, ${pos.lng.toFixed(4)}`;
      document.getElementById('tp-dist-info').textContent = t('dist.label', distKm);
      map.fitBounds([[tp.startPos.lat, tp.startPos.lng], [tp.stopPos.lat, tp.stopPos.lng]], { padding: [60, 60] });
      document.getElementById('tp-step-answer').style.display = 'block';
      tpRenderConstraints();
      tip(t('tip.stopset', distKm));
    });
  });

  document.getElementById('btn-tp-warmer').addEventListener('click', () => tpAnswer(true));
  document.getElementById('btn-tp-cooler').addEventListener('click', () => tpAnswer(false));

  document.getElementById('btn-tp-reset').addEventListener('click', () => {
    tp.layers.forEach(l => map.removeLayer(l)); tp.layers = [];
    tp.markers.forEach(m => map.removeLayer(m)); tp.markers = [];
    tp.startPos = null; tp.stopPos = null;
    tp.constraints = [];
    Object.keys(thermoHistory).forEach(k => delete thermoHistory[k]);
    bridge.fbClearThermos();
    renderList();
    document.getElementById('tp-step-start').querySelector('button').style.display = 'block';
    document.getElementById('tp-start-info').style.display = 'none';
    document.getElementById('tp-step-stop').style.display = 'none';
    document.getElementById('tp-step-answer').style.display = 'none';
    document.getElementById('tp-zone-info').style.display = 'none';
    document.getElementById('tp-log').style.display = 'none';
    document.getElementById('tp-log').innerHTML = '';
    tip(t('tip.threset'));
  });
}
