// ── Map initialization, tiles, themes, controls, location ──

import { tip, setUseImperial, useImperial, unitLabel, role } from './state.js';
// NOTE: i18n.js also imports from map.js (circular dep).
// This is safe because t/uiLang are only used inside callbacks,
// never during top-level module evaluation.
import { t } from './i18n.js';

// ── Lang state (owned here to avoid circular dep) ─────────
// i18n.js calls setMapLang() when language changes.
let _mapLang = localStorage.getItem('uiLang') || 'de';
export function getMapLang() { return _mapLang; }
export function setMapLang(v) { _mapLang = v; }

// ── Map instance ───────────────────────────────────────────

export const map = L.map('map', {
  center: [51.1, 10.4], zoom: 6, zoomControl: false, tap: true, tapTolerance: 15
});
L.control.zoom({ position: 'topleft' }).addTo(map);

// ── Tile providers ─────────────────────────────────────────

const _ca = '&copy; CARTO &copy; OpenStreetMap';
// crossOrigin: tiles load via CORS so the service worker can keep them for offline use
const _co = { subdomains: 'abcd', maxZoom: 20, crossOrigin: true };
const _tp = (url, opts) => [{ url, opts }];

const tileProvidersDark = _tp('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { ..._co, attribution: _ca, className: 'tiles-dark' });
const tileProvidersLight = _tp('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { ..._co, attribution: _ca });
const tileProvidersDefault = _tp('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap', subdomains: 'abc', maxZoom: 19, crossOrigin: true });
const tileProvidersSatellite = _tp('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: '&copy; Esri &copy; USGS &copy; USDA', maxZoom: 19, crossOrigin: true });
const tileProvidersLang = {
  de: _tp('https://tile.openstreetmap.de/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap DE', maxZoom: 19, crossOrigin: true }),
  en: _tp('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', { ..._co, attribution: _ca }),
};

// ── Map themes ─────────────────────────────────────────────

export const mapThemeStates = [
  { key: 'default',   providers: tileProvidersDefault,   icon: '🗺', lbl: 'Karte' },
  { key: 'light',     providers: tileProvidersLight,     icon: '🌕', lbl: 'Helle Karte' },
  { key: 'dark',      providers: tileProvidersDark,      icon: '🌑', lbl: 'Dunkle Karte' },
  { key: 'satellite', providers: tileProvidersSatellite, icon: '🛰', lbl: 'Satellit', noLang: true },
  { key: 'hybrid',    providers: tileProvidersSatellite, icon: '🌍', lbl: 'Hybrid', noLang: true,
    labelUrl: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}{r}.png',
    labelOpts: { attribution: '', subdomains: 'abcd', maxZoom: 20, opacity: 0.9, crossOrigin: true }
  },
];

let _mapThemeIdx = (() => {
  const i = mapThemeStates.findIndex(s => s.key === (localStorage.getItem('mapTheme') || 'default'));
  return i < 0 ? 0 : i;
})();
export function getMapThemeIdx() { return _mapThemeIdx; }

let tileProviders = mapThemeStates[_mapThemeIdx].providers;
let currentTile = null;
let labelTile = null;

function getActiveTileProviders() {
  const s = mapThemeStates[_mapThemeIdx];
  const langTiles = (!s.noLang && s.key === 'default') ? (tileProvidersLang[_mapLang] || []) : [];
  return [...langTiles, ...tileProviders];
}

export function loadTiles(idx) {
  const providers = getActiveTileProviders();
  if (idx >= providers.length) return;
  if (currentTile) map.removeLayer(currentTile);
  const p = providers[idx];
  currentTile = L.tileLayer(p.url, p.opts).addTo(map);
  // Fall back to the next provider only if this one never delivered a tile.
  // Once it worked, errors mean we are offline: switching would only lose
  // the tiles cached for this provider.
  let errorCount = 0, worked = false;
  currentTile.on('tileload', () => { worked = true; });
  currentTile.on('tileerror', function () {
    if (worked) return;
    errorCount++;
    if (errorCount >= 3) { errorCount = 0; loadTiles(idx + 1); }
  });
}

export function applyMapTheme(i) {
  _mapThemeIdx = i;
  const s = mapThemeStates[_mapThemeIdx];
  tileProviders = s.providers;
  if (labelTile) { map.removeLayer(labelTile); labelTile = null; }
  loadTiles(0);
  if (s.labelUrl) {
    labelTile = L.tileLayer(s.labelUrl, s.labelOpts).addTo(map);
  }
  const btn = document.getElementById('btn-map-theme');
  if (btn) { btn.textContent = s.icon; btn.title = s.lbl; }
  localStorage.setItem('mapTheme', s.key);
}

// Initial tile load
loadTiles(0);
if (mapThemeStates[_mapThemeIdx].labelUrl) {
  labelTile = L.tileLayer(mapThemeStates[_mapThemeIdx].labelUrl, mapThemeStates[_mapThemeIdx].labelOpts).addTo(map);
}

// ── ÖPNV layer ─────────────────────────────────────────────

let opnvLayer = null;
let opnvVisible = false;

function toggleOpnv() {
  opnvVisible = !opnvVisible;
  const btn = document.querySelector('#btn-opnv');
  if (opnvVisible) {
    if (!opnvLayer) {
      opnvLayer = L.tileLayer('https://tile.memomaps.de/tilegen/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://opnvkarte.de">ÖPNVKarte</a> &copy; OpenStreetMap',
        maxZoom: 18, opacity: 0.9,
      });
    }
    opnvLayer.addTo(map);
    btn.classList.add('active');
    tip(t('tip.opnv.on'));
  } else {
    if (opnvLayer) map.removeLayer(opnvLayer);
    btn.classList.remove('active');
    tip(t('tip.opnv.off'));
  }
}

// ── Map controls ───────────────────────────────────────────

const UnitsControl = L.Control.extend({
  options: { position: 'topleft' },
  onAdd: function () {
    const btn = L.DomUtil.create('button', 'leaflet-bar leaflet-control units-ctrl');
    btn.id = 'btn-units';
    btn.textContent = 'km';
    btn.title = 'Einheiten umschalten';
    L.DomEvent.disableClickPropagation(btn);
    L.DomEvent.on(btn, 'click', function () {
      setUseImperial(!useImperial);
      btn.textContent = useImperial ? 'mi' : 'km';
      const rul = document.getElementById('radius-unit-label');
      if (rul) rul.textContent = unitLabel();
      tip(t('tip.units', useImperial));
    });
    return btn;
  }
});
new UnitsControl().addTo(map);

const TransitControl = L.Control.extend({
  options: { position: 'topleft' },
  onAdd: function () {
    const btn = L.DomUtil.create('button', 'leaflet-bar leaflet-control units-ctrl');
    btn.id = 'btn-opnv';
    btn.textContent = '🚌';
    btn.title = 'Toggle ÖPNV layer';
    L.DomEvent.disableClickPropagation(btn);
    L.DomEvent.on(btn, 'click', toggleOpnv);
    return btn;
  }
});
new TransitControl().addTo(map);

const MapThemeControl = L.Control.extend({
  options: { position: 'topleft' },
  onAdd: function () {
    const btn = L.DomUtil.create('button', 'leaflet-bar leaflet-control units-ctrl');
    btn.id = 'btn-map-theme';
    btn.textContent = mapThemeStates[_mapThemeIdx].icon;
    btn.title = mapThemeStates[_mapThemeIdx].lbl;
    L.DomEvent.disableClickPropagation(btn);
    btn.onclick = e => { e.stopPropagation(); applyMapTheme((_mapThemeIdx + 1) % mapThemeStates.length); };
    return btn;
  }
});
new MapThemeControl().addTo(map);

// ── Location tracking ──────────────────────────────────────

export let locationMarker = null;
export let locationCircle = null;
export let locationWatch = null;

export function startLocation() {
  if (!navigator.geolocation) return;
  locationWatch = navigator.geolocation.watchPosition(
    (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      const acc = pos.coords.accuracy;
      if (!locationMarker) {
        locationCircle = L.circle([lat, lng], {
          radius: acc, color: '#58a6ff', fillColor: '#58a6ff',
          fillOpacity: 0.1, weight: 1, dashArray: '4 4',
        }).addTo(map);
        locationMarker = L.circleMarker([lat, lng], {
          radius: 10, color: '#fff', fillColor: '#58a6ff', fillOpacity: 1, weight: 3,
        }).addTo(map);
        map.setView([lat, lng], 14);
        tip(t('tip.locfound', Math.round(acc)));
      } else {
        locationMarker.setLatLng([lat, lng]);
        locationCircle.setLatLng([lat, lng]);
        locationCircle.setRadius(acc);
      }
      // Broadcast seeker position to hiders
      if (role === 'seeker') {
        import('./firebase.js').then(fb => fb.fbWriteLocation(lat, lng));
      }
    },
    (err) => {
      tip({ 1: t('tip.gpsdeny'), 2: t('tip.gpsnavail'), 3: t('tip.gpstimeout') }[err.code] || t('tip.gpserror'));
    },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
  );
}
