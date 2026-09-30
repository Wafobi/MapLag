// ── Thermometer feature + bisector math ────────────────────

import { tp, zoneOrderAdd, thermoHistory, genId, haversine, toDisplay, tip, requestMapClickPos } from './state.js';
import { t } from './i18n.js';
import { map } from './map.js';
import { renderList } from './zones.js';
import { bridge } from './bridge.js';
import { showConfirm } from './ui.js';

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
// Everything is computed in Web-Mercator space (x = lng in radians,
// y = Mercator y), where the bisector is a straight line.

const _toMercY = lat => Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
const _fromMercY = y => (2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180 / Math.PI;
const _merc = p => [p.lng * Math.PI / 180, _toMercY(p.lat)];
const _unmerc = ([x, y]) => [x * 180 / Math.PI, _fromMercY(y)];  // → [lng, lat]
const MERC_BOX = (() => {
  const X = Math.PI, Y = _toMercY(85);  // same extent as WORLD_POLY
  return [[-X, -Y], [X, -Y], [X, Y], [-X, Y]];
})();

// Perpendicular bisector of start/stop; side(p) > 0 on the eliminated half
function _bisectorFrame(c) {
  const [elim, keep] = c.warmer ? [c.startPos, c.stopPos] : [c.stopPos, c.startPos];
  const e = _merc(elim), k = _merc(keep);
  const mid = [(e[0] + k[0]) / 2, (e[1] + k[1]) / 2];
  const n = [e[0] - k[0], e[1] - k[1]];
  if (!n[0] && !n[1]) return null;  // start == stop: no information
  return { mid, n, side: p => (p[0] - mid[0]) * n[0] + (p[1] - mid[1]) * n[1] };
}

// Straight Mercator segment a→b as densified [lng, lat] points (b excluded)
function _densify(a, b, steps = 32) {
  const pts = [];
  for (let i = 0; i < steps; i++) {
    const t = i / steps;
    pts.push(_unmerc([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]));
  }
  return pts;
}

// Eliminated half of the world for one reading, as a turf polygon:
// the world box clipped to the half-plane (Sutherland–Hodgman, one edge).
export function tpEliminatedPolygon(c) {
  const f = _bisectorFrame(c);
  if (!f) return null;
  const poly = [];
  MERC_BOX.forEach((a, i) => {
    const b = MERC_BOX[(i + 1) % MERC_BOX.length];
    const sa = f.side(a), sb = f.side(b);
    if (sa >= 0) poly.push(a);
    if ((sa >= 0) !== (sb >= 0)) {
      const t = sa / (sa - sb);
      poly.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
    }
  });
  if (poly.length < 3) return null;
  const ring = poly.flatMap((a, i) => _densify(a, poly[(i + 1) % poly.length]));
  ring.push(ring[0]);
  return turf.polygon([ring]);
}

export function tpDrawBisector(c) {
  const f = _bisectorFrame(c);
  if (!f) return;
  // Clip the line mid + t·dir to the box
  const dir = [-f.n[1], f.n[0]];
  const [[x0, y0], , [x1, y1]] = MERC_BOX;
  let tMin = -Infinity, tMax = Infinity;
  [[dir[0], f.mid[0], x0, x1], [dir[1], f.mid[1], y0, y1]].forEach(([d, m, lo, hi]) => {
    if (Math.abs(d) < 1e-12) return;
    const t1 = (lo - m) / d, t2 = (hi - m) / d;
    tMin = Math.max(tMin, Math.min(t1, t2));
    tMax = Math.min(tMax, Math.max(t1, t2));
  });
  const a = [f.mid[0] + dir[0] * tMin, f.mid[1] + dir[1] * tMin];
  const b = [f.mid[0] + dir[0] * tMax, f.mid[1] + dir[1] * tMax];
  const pts = [..._densify(a, b, 64), _unmerc(b)].map(([lng, lat]) => [lat, lng]);
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

// Clear the in-progress start/stop measurement (markers + sheet steps)
function tpResetMeasurement() {
  tp.markers.forEach(m => map.removeLayer(m)); tp.markers = [];
  tp.startPos = null; tp.stopPos = null;
  document.getElementById('tp-step-start').querySelector('button').style.display = 'block';
  document.getElementById('tp-start-info').style.display = 'none';
  document.getElementById('tp-step-stop').style.display = 'none';
  document.getElementById('tp-stop-info').style.display = 'none';
  document.getElementById('tp-step-answer').style.display = 'none';
}

function tpAnswer(warmer) {
  if (!tp.startPos || !tp.stopPos) return;
  const newC = { id: genId(), startPos: { ...tp.startPos }, stopPos: { ...tp.stopPos }, warmer };
  tp.constraints.push(newC);
  zoneOrderAdd(newC.id);
  bridge.fbWriteThermo(newC);
  tpResetMeasurement();
  tpRenderConstraints();
}

// ── Init (event bindings) ──────────────────────────────────

export function initThermo() {
  // Publish thermo geometry to the shared bridge
  bridge.tpEliminatedPolygon = tpEliminatedPolygon;

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
      // Pressing Stop again replaces the previous stop marker
      if (tp.stopPos && tp.markers.length > 1) map.removeLayer(tp.markers.pop());
      tp.stopPos = pos;
      tpAddMarker(pos.lat, pos.lng, '#f0c040', t('tp.stopMarker'));
      const dist = haversine(tp.startPos.lat, tp.startPos.lng, pos.lat, pos.lng);
      const distStr = toDisplay(dist);
      document.getElementById('tp-stop-info').style.display = 'block';
      document.getElementById('tp-stop-coords').textContent = `${pos.lat.toFixed(4)}, ${pos.lng.toFixed(4)}`;
      document.getElementById('tp-dist-info').textContent = t('dist.label', distStr);
      map.fitBounds([[tp.startPos.lat, tp.startPos.lng], [tp.stopPos.lat, tp.stopPos.lng]], { padding: [60, 60] });
      document.getElementById('tp-step-answer').style.display = 'block';
      tpRenderConstraints();
      tip(t('tip.stopset', distStr));
    });
  });

  document.getElementById('btn-tp-warmer').addEventListener('click', () => tpAnswer(true));
  document.getElementById('btn-tp-cooler').addEventListener('click', () => tpAnswer(false));

  // Reset: discard the current measurement and soft-delete all readings
  // (shared with everyone, so confirm first; restorable from the zone panel)
  document.getElementById('btn-tp-reset').addEventListener('click', () => {
    const doReset = () => {
      tpResetMeasurement();
      tp.constraints.splice(0).forEach(c => {
        thermoHistory[c.id] = c;
        bridge.fbDeleteThermo(c.id);
      });
      tpRenderConstraints();
      document.getElementById('tp-zone-info').style.display = 'none';
      document.getElementById('tp-log').style.display = 'none';
      document.getElementById('tp-log').innerHTML = '';
      tip(t('tip.threset'));
    };
    if (tp.constraints.length) showConfirm(t('tp.resetconfirm'), doReset);
    else doReset();
  });
}
