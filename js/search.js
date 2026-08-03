// ── Search functionality ───────────────────────────────────

import { mq, consumeMapClickCallback, esc } from './state.js';
import { t } from './i18n.js';
import { map, getMapLang } from './map.js';
import { mqSelectRef } from './measure.js';

let searchMarker = null;
let searchTimer = null;
let _searchAC = null;

const searchInput = document.getElementById('search-input');
const searchResults = document.getElementById('search-results');

function positionSearchResults() {
  const r = searchInput.getBoundingClientRect();
  const isMobile = window.innerWidth <= 700;
  searchResults.style.width = r.width + 'px';
  searchResults.style.left = r.left + 'px';
  if (isMobile) {
    searchResults.style.bottom = (window.innerHeight - r.top + 4) + 'px';
    searchResults.style.top = 'auto';
  } else {
    searchResults.style.top = (r.bottom + 4) + 'px';
    searchResults.style.bottom = 'auto';
  }
}

async function doSearch(q) {
  searchResults.innerHTML = `<div class="sr-item"><div class="sr-main" style="color:#6e7681">${t('search.busy')}</div></div>`;
  positionSearchResults();
  searchResults.style.display = 'block';
  try {
    _searchAC?.abort();
    _searchAC = new AbortController();
    const lang = getMapLang();
    const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=5&lang=${lang === 'local' ? 'en' : lang}`;
    const res = await fetch(url, { signal: _searchAC.signal });
    const data = await res.json();
    const features = data.features || [];
    if (!features.length) {
      searchResults.innerHTML = `<div class="sr-item"><div class="sr-main" style="color:#6e7681">${t('search.empty')}</div></div>`;
      return;
    }
    searchResults.innerHTML = features.map((f) => {
      const p = f.properties;
      const main = p.name || p.city || p.country || '?';
      const parts = [p.street, p.city, p.state, p.country].filter(Boolean);
      const sub = parts.slice(0, 3).join(', ');
      const lon = f.geometry.coordinates[0];
      const lat = f.geometry.coordinates[1];
      return `<div class="sr-item" data-lat="${lat}" data-lon="${lon}">
        <div class="sr-main">${esc(main)}</div>
        <div class="sr-sub">${esc(sub)}</div>
      </div>`;
    }).join('');
    searchResults.querySelectorAll('.sr-item').forEach(el => {
      el.addEventListener('click', function () {
        const lat = parseFloat(this.dataset.lat);
        const lon = parseFloat(this.dataset.lon);
        const name = this.querySelector('.sr-main').textContent;
        searchResults.style.display = 'none';
        searchInput.value = name;
        map.setView([lat, lon], 13);

        const cb = consumeMapClickCallback();
        if (cb) { cb({ lat, lng: lon }); return; }

        if (document.getElementById('mq-sheet').classList.contains('open') && mq.myLat !== null) {
          mqSelectRef(lat, lon, name);
          return;
        }

        if (searchMarker) map.removeLayer(searchMarker);
        searchMarker = L.circleMarker([lat, lon], {
          radius: 8, color: '#f0c040', fillColor: '#f0c040', fillOpacity: 0.9, weight: 2
        }).addTo(map);
      });
    });
  } catch (e) {
    if (e.name === 'AbortError') return;
    searchResults.innerHTML = `<div class="sr-item"><div class="sr-main" style="color:var(--red)">${t('search.error')}</div></div>`;
  }
}

export function initSearch() {
  searchInput.addEventListener('input', function () {
    clearTimeout(searchTimer);
    const q = this.value.trim();
    if (q.length < 3) { searchResults.style.display = 'none'; return; }
    searchTimer = setTimeout(() => doSearch(q), 400);
  });

  searchInput.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { searchResults.style.display = 'none'; this.blur(); }
  });

  document.addEventListener('click', function (e) {
    const wrap = document.getElementById('search-wrap');
    if (!wrap.contains(e.target)) {
      searchResults.style.display = 'none';
      document.getElementById('search-bar').classList.remove('open');
    }
  });

  document.getElementById('search-toggle').addEventListener('click', e => {
    e.stopPropagation();
    document.getElementById('search-bar').classList.toggle('open');
    setTimeout(() => searchInput.focus(), 50);
  });
}
