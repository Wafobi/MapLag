// ── Admin boundary feature ─────────────────────────────────

import { st, admin, tip } from './state.js';
import { t } from './i18n.js';
import { map, getMapLang } from './map.js';
import { addZone } from './zones.js';
import { closeAllSheets } from './ui.js';

const WORLD_POLY = turf.polygon([[[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]]]);

export function adminInvertedLayer(geometry, style) {
  try {
    const feature = { type: 'Feature', geometry };
    const inverted = turf.difference(WORLD_POLY, feature);
    if (!inverted) return null;
    const rings = inverted.geometry.coordinates.map(ring => ring.map(c => L.latLng(c[1], c[0])));
    const layer = L.polygon(rings, style);
    layer._isInverted = true;
    layer._adminGeo = geometry;
    return layer;
  } catch (e) { return null; }
}

function adminPolyLayer(geometry, style) {
  let rings;
  if (geometry.type === 'Polygon') {
    rings = [geometry.coordinates[0].map(c => L.latLng(c[1], c[0]))];
  } else {
    rings = geometry.coordinates.map(poly => poly[0].map(c => L.latLng(c[1], c[0])));
  }
  const layer = L.polygon(rings, style);
  layer._adminGeo = geometry;
  return layer;
}

export async function adminFetchBoundary(lat, lng) {
  document.getElementById('admin-level-select').style.display = 'block';
  document.getElementById('admin-confirm').style.display = 'none';
  document.getElementById('admin-loading').style.display = 'block';
  document.getElementById('admin-sheet').classList.add('open');

  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&polygon_geojson=1&zoom=${admin.zoom}`;
    const lang = getMapLang();
    const res = await fetch(url, { headers: { 'Accept-Language': lang === 'local' ? '' : lang } });
    if (!res.ok) { tip(t('tip.loaderr')); document.getElementById('admin-loading').style.display = 'none'; return; }
    const data = await res.json();

    if (!data.geojson) { tip(t('tip.noboundary')); document.getElementById('admin-loading').style.display = 'none'; return; }
    let geo = data.geojson;
    try {
      const simplified = turf.simplify(turf.feature(geo), { tolerance: 0.005, highQuality: false });
      if (simplified && simplified.geometry) geo = simplified.geometry;
    } catch (e) {}
    if (!geo.coordinates || !geo.coordinates.length) { tip(t('tip.boundaryerr')); document.getElementById('admin-loading').style.display = 'none'; return; }

    if (admin.previewLayer) { map.removeLayer(admin.previewLayer); }
    admin.previewLayer = L.geoJSON({ type: 'Feature', geometry: geo }, {
      style: { color: '#e8b84b', weight: 2.5, opacity: 0.9, fillColor: '#e8b84b', fillOpacity: 0.15, dashArray: '6 4' }
    }).addTo(map);

    const shortName = data.address
      ? ({ 4: data.address.country, 5: data.address.state, 8: data.address.county, 10: data.address.city || data.address.town || data.address.village }[admin.zoom] || data.name || data.display_name.split(',')[0])
      : data.display_name.split(',')[0];
    admin.pendingData = { name: shortName, geometry: geo };

    document.getElementById('admin-name').textContent = shortName;
    document.getElementById('admin-loading').style.display = 'none';
    document.getElementById('admin-level-select').style.display = 'none';
    document.getElementById('admin-confirm').style.display = 'block';
    map.fitBounds(admin.previewLayer.getBounds(), { padding: [40, 40] });
  } catch (err) {
    tip(t('tip.loaderr'));
    document.getElementById('admin-loading').style.display = 'none';
  }
}

async function adminConfirm(hit) {
  if (!admin.pendingData) return;
  const { name, geometry } = admin.pendingData;
  if (admin.previewLayer) { map.removeLayer(admin.previewLayer); admin.previewLayer = null; }
  admin.pendingData = null;
  closeAllSheets();

  const label = (hit ? '✓ Hit' : '✗ Miss') + ' — ' + name;
  if (hit) {
    await addZone(s => {
      const inv = adminInvertedLayer(geometry, s);
      if (inv) return inv;
      return adminPolyLayer(geometry, { ...s, color: '#3fbf6e', fillColor: '#3fbf6e' });
    }, label, { isInverted: true, isHit: true });
  } else {
    await addZone(s => adminPolyLayer(geometry, s), label, { isMiss: true });
  }
}

export function initAdmin() {
  document.getElementById('btn-admin').addEventListener('click', () => {
    const isOpen = document.getElementById('admin-sheet').classList.contains('open');
    if (isOpen || st.mode === 'admin') {
      closeAllSheets();
    } else {
      closeAllSheets();
      document.getElementById('admin-sheet').classList.add('open');
      document.getElementById('btn-admin').classList.add('active');
    }
  });

  document.getElementById('btn-admin-close').addEventListener('click', closeAllSheets);
  document.getElementById('admin-sheet').addEventListener('click', function (e) {
    if (e.target === this) closeAllSheets();
  });

  document.querySelectorAll('[data-admin-zoom]').forEach(btn => {
    btn.addEventListener('click', () => {
      admin.zoom = parseInt(btn.dataset.adminZoom);
      document.querySelectorAll('[data-admin-zoom]').forEach(b => b.classList.remove('sel'));
      btn.classList.add('sel');
      document.getElementById('admin-sheet').classList.remove('open');
      st.mode = 'admin';
      document.getElementById('btn-admin').classList.add('active');
      tip(t('tip.taparea'), 5000);
    });
  });

  document.getElementById('btn-admin-hit').addEventListener('click', () => adminConfirm(true));
  document.getElementById('btn-admin-miss').addEventListener('click', () => adminConfirm(false));
  document.getElementById('btn-admin-reselect').addEventListener('click', () => {
    if (admin.previewLayer) { map.removeLayer(admin.previewLayer); admin.previewLayer = null; }
    admin.pendingData = null;
    document.getElementById('admin-confirm').style.display = 'none';
    document.getElementById('admin-level-select').style.display = 'block';
    document.getElementById('admin-sheet').classList.remove('open');
    st.mode = 'admin';
    tip(t('tip.taparea'), 5000);
  });
}
