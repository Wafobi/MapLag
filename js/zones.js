// ── Zone management, geometry, and rendering ───────────────

import {
  st, missColor, setMissColor, mergedMissLayer, setMergedMissLayer,
  zoneHistory, thermoHistory, _zoneOrder, zoneOrderAdd, tp, genId,
  haversine, toDisplay, colorLighten, colorDarken, esc,
} from './state.js';
import { t } from './i18n.js';
import { map } from './map.js';
import { bridge } from './bridge.js';

let _elimPattern = localStorage.getItem('elimPattern') || 'stripes';
export function getElimPattern() { return _elimPattern; }
export function setElimPattern(p) { _elimPattern = p; }

// ── Color / pattern helpers ────────────────────────────────

export function updatePatternColors(hex) {
  const light = colorLighten(hex, 0.5);
  const dark = colorDarken(hex, 0.2);
  [['_pd1', light], ['_pd2', hex], ['_pd3', dark],
   ['_pz1', light], ['_pz2', hex], ['_pz3', dark]].forEach(([id, col]) => {
    const el = document.getElementById(id);
    if (el) el.setAttribute('stroke', col);
  });
  ['_pb_dots', '_pb_zz'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.setAttribute('fill', hex);
  });
}

export function setMissColorFull(c) {
  setMissColor(c);
  const picker = document.getElementById('miss-color-picker');
  if (picker) picker.value = c;
  updatePatternColors(c);
  if (mergedMissLayer) mergedMissLayer.setStyle({ color: c });
  st.zones.forEach(z => {
    if (z.layer && (z.layer._isMiss || z.layer._isInverted)) {
      z.layer.setStyle({ color: c, fillColor: c });
    }
  });
}

// ── Shared Turf constants ─────────────────────────────────

const WORLD_POLY = turf.polygon([[[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]]]);

// ── Geometry helpers ───────────────────────────────────────

export function layerToTurf(layer) {
  try {
    if (layer instanceof L.Circle) {
      const c = layer.getLatLng();
      return turf.circle([c.lng, c.lat], layer.getRadius() / 1000, { steps: 64, units: 'kilometers' });
    }
    const lls = layer.getLatLngs();
    const flat = (Array.isArray(lls[0]) ? lls[0] : lls).map(p => [p.lng, p.lat]);
    if (flat[0][0] !== flat[flat.length - 1][0] || flat[0][1] !== flat[flat.length - 1][1]) flat.push(flat[0]);
    return turf.polygon([flat]);
  } catch (e) { return null; }
}

function getMissTurfFeature(layer) {
  if (!layer._isMiss || layer._isInverted) return null;
  try {
    if (layer._adminGeo) return turf.feature(layer._adminGeo);
    return layerToTurf(layer);
  } catch (e) { return null; }
}

function getHitAreaFeature(layer) {
  if (!layer._isInverted) return null;
  try {
    if (layer._adminGeo) return turf.feature(layer._adminGeo);
    if (layer._origRadius !== undefined)
      return turf.circle([layer._origLng, layer._origLat], layer._origRadius / 1000, { steps: 64, units: 'kilometers' });
    if (layer._origLatLngs) {
      const coords = layer._origLatLngs.map(p => [p[1], p[0]]);
      if (coords[0][0] !== coords[coords.length - 1][0] || coords[0][1] !== coords[coords.length - 1][1]) coords.push(coords[0]);
      return turf.polygon([coords]);
    }
  } catch (e) {}
  return null;
}

export function invertedPolyLayer(pts, style) {
  try {
    const coords = pts.map(p => [p.lng, p.lat]);
    if (coords[0][0] !== coords[coords.length - 1][0] || coords[0][1] !== coords[coords.length - 1][1])
      coords.push(coords[0]);
    const inner = turf.polygon([coords]);
    const inverted = turf.difference(WORLD_POLY, inner);
    if (!inverted) return null;
    const rings = inverted.geometry.coordinates.map(ring => ring.map(c => L.latLng(c[1], c[0])));
    const layer = L.polygon(rings, style);
    layer._isInverted = true;
    layer._origLatLngs = pts.map(p => [p.lat, p.lng]);
    return layer;
  } catch (e) { return null; }
}

export function invertedCircleLayer(lat, lng, radiusM, style) {
  const steps = 64;
  const radiusKm = radiusM / 1000;
  const innerCircle = turf.circle([lng, lat], radiusKm, { steps, units: 'kilometers' });
  const inverted = turf.difference(WORLD_POLY, innerCircle);
  if (!inverted) {
    const fb = L.circle([lat, lng], { radius: radiusM, ...style });
    fb._isInverted = true; fb._origLat = lat; fb._origLng = lng; fb._origRadius = radiusM;
    return fb;
  }
  const rings = inverted.geometry.coordinates.map(ring => ring.map(c => L.latLng(c[1], c[0])));
  const layer = L.polygon(rings, style);
  layer._isInverted = true;
  layer._origLat = lat; layer._origLng = lng; layer._origRadius = radiusM;
  return layer;
}

// ── Eliminated area rendering ──────────────────────────────

export function renderEliminatedArea() {
  if (mergedMissLayer) { map.removeLayer(mergedMissLayer); setMergedMissLayer(null); }

  const missZones = st.zones.filter(z => z.layer && z.layer._isMiss && !z.layer._isInverted);
  const invertedZones = st.zones.filter(z => z.layer && z.layer._isInverted);

  [...missZones, ...invertedZones].forEach(z => { if (map.hasLayer(z.layer)) map.removeLayer(z.layer); });

  const { tpConstraintToElimCoords, _mercClipT, _fromMercY } = bridge;

  const activeThermo = tp.constraints.filter(c => c.startPos && c.stopPos);
  if (!missZones.length && !invertedZones.length && !activeThermo.length) return;

  try {
    let hitUnion = null;
    for (const z of invertedZones) {
      const hit = getHitAreaFeature(z.layer);
      if (!hit) continue;
      if (!hitUnion) hitUnion = hit;
      else hitUnion = turf.intersect(hitUnion, hit) || hitUnion;
    }

    let missUnion = null;
    for (const z of missZones) {
      const miss = getMissTurfFeature(z.layer);
      if (!miss) continue;
      missUnion = missUnion ? turf.union(missUnion, miss) : miss;
    }

    for (const c of activeThermo) {
      try {
        const { mMidX, mMidY, mDirX, mDirY, eDirX, eDirY } = tpConstraintToElimCoords(c);
        const depth = 200, steps = 64;
        const [tMin, tMax] = _mercClipT(mMidX, mMidY, mDirX, mDirY);
        const bisEdge = [];
        for (let i = 0; i <= steps; i++) {
          const t = tMin + (i / steps) * (tMax - tMin);
          bisEdge.push([mMidX + mDirX * t, mMidY + mDirY * t]);
        }
        const farEdge = bisEdge.map(([mx, my]) => [mx + eDirX * depth, my + eDirY * depth]).reverse();
        const ring = [...bisEdge, ...farEdge].map(([mx, my]) => [mx, _fromMercY(my)]);
        ring.push(ring[0]);
        const feat = turf.polygon([ring]);
        missUnion = missUnion ? turf.union(missUnion, feat) : feat;
      } catch (e) {}
    }

    let eliminated;
    if (hitUnion) {
      let remaining = missUnion ? (turf.difference(hitUnion, missUnion) || null) : hitUnion;
      eliminated = remaining ? (turf.difference(WORLD_POLY, remaining) || null) : world;
    } else {
      eliminated = missUnion;
    }
    if (!eliminated) return;

    const mc = missColor;
    const newLayer = L.geoJSON(eliminated, {
      style: _elimPattern === 'off'
        ? { color: mc, weight: 2, opacity: 0.85, fill: true, fillColor: mc, fillOpacity: 0.3 }
        : { color: mc, weight: 2, opacity: 0.85, fill: true, fillColor: _elimPattern === 'zigzag' ? 'url(#_elim_zz)' : 'url(#_elim_dots)', fillOpacity: 1 },
      interactive: false
    }).addTo(map);
    setMergedMissLayer(newLayer);
  } catch (e) { console.error('renderEliminatedArea:', e); }
}

// ── Zone CRUD ──────────────────────────────────────────────

export function bindLayerEvents(layer) {
  layer.on('click', e => { L.DomEvent.stopPropagation(e); });
  layer.on('mousedown mouseup mousemove touchstart touchmove touchend', e => {
    L.DomEvent.stopPropagation(e);
  });
}

export async function addZone(mkLayer, def, flags = {}, askName = false) {
  const { askLabel } = await import('./ui.js');
  let lbl;
  if (askName) {
    lbl = await askLabel(def);
    if (!lbl) return;
  } else {
    lbl = def || 'Zone';
  }

  const id = genId();
  const { isMiss = false, isInverted = false, isHit = false } = flags;
  const mc = missColor;
  let layer;
  if (isHit) {
    layer = mkLayer({ color: '#3fbf6e', weight: 2, opacity: 0.8, fillColor: '#3fbf6e', fillOpacity: 0.3 });
    layer._isHit = true;
  } else if (isInverted || isMiss) {
    layer = mkLayer({ color: mc, weight: 2, opacity: 0.8, fillColor: mc, fillOpacity: 0.3 });
    if (isInverted) layer._isInverted = true;
    if (isMiss) layer._isMiss = true;
  } else {
    layer = mkLayer({ color: mc, weight: 2, opacity: 0.8, fillColor: mc, fillOpacity: 0.3 });
    layer._isMiss = true;
  }
  if (layer._isHit && !layer._isInverted) layer.addTo(map);
  bindLayerEvents(layer);
  st.zones.push({ id, lbl, layer });
  zoneOrderAdd(id);
  bridge.fbWriteZone(id, serializeZone({ lbl, layer }));
  renderList();
}

export function selZone(id) { st.selId = id; renderList(); }

export function delZone(id) {
  const i = st.zones.findIndex(z => z.id === id);
  if (i < 0) return;
  const zone = st.zones[i];
  const fbData = serializeZone({ lbl: zone.lbl, layer: zone.layer });
  map.removeLayer(zone.layer);
  st.zones.splice(i, 1);
  if (st.selId === id) st.selId = null;
  zoneHistory[id] = { id, lbl: zone.lbl, fbData };
  bridge.fbDeleteZone(id);
  renderList();
}

export function undoZone(id) {
  const entry = zoneHistory[id];
  if (!entry) return;
  delete zoneHistory[id];
  const cleanData = { ...entry.fbData };
  delete cleanData.deleted;
  deserializeZone(id, cleanData);
  bridge.fbWriteZone(id, cleanData);
  renderList();
}

// ── Serialization ──────────────────────────────────────────

export function serializeZone(z) {
  const l = z.layer;
  let geo;
  if (l._adminGeo) {
    geo = { type: l._isInverted ? 'admin-inv' : 'admin', geometry: l._adminGeo };
  } else if (l._isInverted && l._origLatLngs) {
    geo = { type: 'poly-inv', latlngs: l._origLatLngs };
  } else if (l._isInverted) {
    geo = { type: 'circle', center: { lat: l._origLat, lng: l._origLng }, radius: l._origRadius };
  } else if (l instanceof L.Circle) {
    const ll = l.getLatLng();
    geo = { type: 'circle', center: { lat: ll.lat, lng: ll.lng }, radius: l.getRadius() };
  } else {
    geo = { type: 'poly', latlngs: l.getLatLngs()[0].map(p => [p.lat, p.lng]) };
  }
  return { lbl: z.lbl, isMiss: !!l._isMiss, isInverted: !!l._isInverted, isHit: !!l._isHit, geo };
}

export function deserializeZone(id, data) {
  const mc = missColor;
  const style = { color: mc, weight: 2, opacity: 0.8, fillColor: mc, fillOpacity: 0.3 };
  let layer;
  if (data.geo.type === 'admin-inv') {
    // Empty polygon — geometry lives in _adminGeo and is consumed
    // by renderEliminatedArea via getHitAreaFeature, not rendered directly.
    layer = L.polygon([], style);
    layer._isInverted = true;
    layer._adminGeo = data.geo.geometry;
    if (data.isHit) layer._isHit = true;
  } else if (data.geo.type === 'admin') {
    // Empty polygon — same pattern; _adminGeo feeds renderEliminatedArea.
    const s = data.isHit ? { ...style, color: '#3fbf6e', fillColor: '#3fbf6e' } : style;
    layer = L.polygon([], s);
    layer._adminGeo = data.geo.geometry;
    if (data.isMiss) layer._isMiss = true;
    if (data.isHit) layer._isHit = true;
  } else if (data.isInverted && data.geo.type === 'poly-inv') {
    const pts = data.geo.latlngs.map(p => L.latLng(p[0], p[1]));
    layer = invertedPolyLayer(pts, style) || L.polygon(pts, style);
  } else if (data.isInverted) {
    const c = data.geo.center;
    layer = invertedCircleLayer(c.lat, c.lng, data.geo.radius, style);
  } else if (data.isHit) {
    const hs = { ...style, color: '#3fbf6e', fillColor: '#3fbf6e' };
    layer = L.polygon(data.geo.latlngs, hs);
    layer._isHit = true;
  } else if (data.geo.type === 'circle') {
    layer = L.circle([data.geo.center.lat, data.geo.center.lng], { radius: data.geo.radius, ...style });
    layer._isMiss = true;
  } else {
    layer = L.polygon(data.geo.latlngs, style);
    layer._isMiss = true;
  }
  if (data.isHit && !data.isInverted) layer.addTo(map);
  bindLayerEvents(layer);
  st.zones.push({ id, lbl: data.lbl, layer });
}

// ── Render ─────────────────────────────────────────────────

let _renderTimer = null;
export function renderList() {
  renderZonePanel();
  clearTimeout(_renderTimer);
  _renderTimer = setTimeout(renderEliminatedArea, 120);
}

export function renderZonePanel() {
  const items = [];
  st.zones.forEach(z => items.push({ id: z.id, type: 'zone', deleted: false, data: z }));
  Object.values(zoneHistory).forEach(z => items.push({ id: z.id, type: 'zone', deleted: true, data: z }));
  tp.constraints.forEach(c => items.push({ id: c.id, type: 'thermo', deleted: false, data: c }));
  Object.values(thermoHistory).forEach(c => items.push({ id: c.id, type: 'thermo', deleted: true, data: c }));

  items.sort((a, b) => {
    const ia = _zoneOrder.get(a.id) ?? -1;
    const ib = _zoneOrder.get(b.id) ?? -1;
    if (ia === -1 && ib === -1) return 0;
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });

  const total = items.length;
  document.getElementById('zp-count').textContent = total;
  const c2 = document.getElementById('zp-count2'); if (c2) c2.textContent = total;
  const list = document.getElementById('zone-panel-list');

  if (!items.length) {
    list.innerHTML = `<div class="zp-empty">${t('zone.empty')}</div>`;
    return;
  }

  list.innerHTML = items.map(item => {
    if (item.type === 'zone') {
      const z = item.data;
      if (item.deleted) {
        const isHit = z.fbData && z.fbData.isHit;
        return `<div class="zp-item" style="opacity:0.45">
          <div class="zp-dot" style="background:${isHit ? 'var(--green)' : 'var(--red)'}"></div>
          <div class="zp-name" style="text-decoration:line-through">${esc(z.lbl)}</div>
          <button class="zp-undo" data-id="${esc(z.id)}">${t('zone.undo')}</button>
        </div>`;
      } else {
        const isMiss = z.layer && !z.layer._isHit && (z.layer._isMiss || z.layer._isInverted);
        return `<div class="zp-item">
          <div class="zp-dot" style="background:${isMiss ? 'var(--red)' : 'var(--green)'}"></div>
          <div class="zp-name">${esc(z.lbl)}</div>
          <button class="zp-del" data-id="${esc(z.id)}">${t('zone.del')}</button>
        </div>`;
      }
    } else {
      const c = item.data;
      const dist = Math.round(haversine(c.startPos.lat, c.startPos.lng, c.stopPos.lat, c.stopPos.lng));
      const distStr = toDisplay(dist);
      const label = c.warmer ? t('tp.warmerLabel', distStr) : t('tp.coolerLabel', distStr);
      if (item.deleted) {
        return `<div class="zp-item" style="opacity:0.45">
          <div class="zp-dot" style="background:var(--gold)"></div>
          <div class="zp-name" style="text-decoration:line-through">🌡 ${esc(label)}</div>
          <button class="zp-undo zp-tp-undo" data-id="${esc(c.id)}">${t('zone.undo')}</button>
        </div>`;
      } else {
        return `<div class="zp-item">
          <div class="zp-dot" style="background:var(--gold)"></div>
          <div class="zp-name">🌡 ${esc(label)}</div>
          <button class="zp-del zp-tp-del" data-id="${esc(c.id)}">${t('zone.del')}</button>
        </div>`;
      }
    }
  }).join('');
}
