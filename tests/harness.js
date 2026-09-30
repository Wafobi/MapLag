// Boots the real app (index.html + js/main.js) inside jsdom with real
// Leaflet and Turf, a fake Firebase and a controllable geolocation.
// ES modules are singletons, so each test file boots exactly one app —
// node --test runs every file in its own process.

import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createFakeFirebase } from './fake-firebase.js';

const require = createRequire(import.meta.url);

const WINDOW_GLOBALS = [
  'window', 'document', 'navigator', 'localStorage', 'sessionStorage', 'location', 'history',
  'Node', 'Element', 'HTMLElement', 'SVGElement', 'Event', 'MouseEvent', 'KeyboardEvent', 'CustomEvent',
  'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'DOMException',
];

function fakeGeolocation() {
  return {
    watchers: [],
    position: null, // {lat, lng} returned by getCurrentPosition; null → error
    watchPosition(ok) { this.watchers.push(ok); return this.watchers.length; },
    clearWatch() {},
    getCurrentPosition(ok, err) {
      const p = this.position;
      setTimeout(() => p
        ? ok({ coords: { latitude: p.lat, longitude: p.lng, accuracy: 5 } })
        : err({ code: 2 }), 0);
    },
    // Push a watchPosition update (moves the blue GPS dot)
    emit(lat, lng, accuracy = 10) {
      this.position = { lat, lng };
      this.watchers.forEach(cb => cb({ coords: { latitude: lat, longitude: lng, accuracy } }));
    },
  };
}

export const settle = (ms = 350) => new Promise(r => setTimeout(r, ms));

// firebase: false simulates the SDK failing to load (app opened offline)
export async function boot({ url = 'http://localhost/index.html', local = {}, session = {}, fetch, firebase: withFirebase = true } = {}) {
  // Drop the CDN <script> tags; dependencies are provided from node_modules
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
    .replace(/<script\b[\s\S]*?<\/script>/g, '');
  const dom = new JSDOM(html, { url, pretendToBeVisual: true });
  const w = dom.window;
  Object.entries(local).forEach(([k, v]) => w.localStorage.setItem(k, v));
  Object.entries(session).forEach(([k, v]) => w.sessionStorage.setItem(k, v));

  const gps = fakeGeolocation();
  Object.defineProperty(w.navigator, 'geolocation', { value: gps, configurable: true });

  for (const k of WINDOW_GLOBALS) {
    const v = k === 'window' ? w : (typeof w[k] === 'function' && /^[a-z]/.test(k) ? w[k].bind(w) : w[k]);
    Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
  }
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  globalThis.fetch = fetch || (async url => { throw new Error(`network disabled in tests: ${url}`); });

  // App intervals (polling, stale-seeker sweep) must not keep the test process alive
  const realSetInterval = globalThis.setInterval;
  globalThis.setInterval = (...a) => { const h = realSetInterval(...a); h.unref?.(); return h; };

  globalThis.L = require('leaflet');
  globalThis.turf = require('@turf/turf');
  const firebase = createFakeFirebase();
  if (withFirebase) globalThis.firebase = firebase;
  else delete globalThis.firebase;

  await import('../js/main.js');
  const mod = name => import(`../js/${name}.js`);
  const { map } = await mod('map');
  const $ = sel => w.document.querySelector(sel);

  const app = {
    window: w, document: w.document, gps, firebase, db: firebase.db, map, mod, $,

    click(sel) {
      const el = typeof sel === 'string' ? $(sel) : sel;
      if (!el) throw new Error(`no element for ${sel}`);
      el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    },

    // Tap the map at a position (goes through main.js' map click handler)
    tapMap(lat, lng) { map.fire('click', { latlng: L.latLng(lat, lng) }); },

    async login(password, role = 'seeker') {
      $('#pw-input').value = password;
      app.click(`#pw-role-${role}`);
      app.click('#pw-submit');
      const fb = await mod('firebase');
      await fb.fbReady;
      await settle(50);
    },

    // Point-in-eliminated-area test against the rendered merged layer
    async isEliminated(lat, lng) {
      const { mergedMissLayer } = await mod('state');
      if (!mergedMissLayer) return false;
      const pt = turf.point([lng, lat]);
      return mergedMissLayer.toGeoJSON().features.some(f => turf.booleanPointInPolygon(pt, f));
    },

    // Remove every zone/thermo so tests within one file start clean
    async reset() {
      const { st, tp, zoneHistory, thermoHistory } = await mod('state');
      const { renderEliminatedArea } = await mod('zones');
      const { closeAllSheets } = await mod('ui');
      closeAllSheets();
      st.zones.splice(0).forEach(z => map.removeLayer(z.layer));
      tp.constraints.splice(0);
      app.click('#btn-tp-reset');  // no readings left → resets the running measurement without asking
      [zoneHistory, thermoHistory].forEach(h => Object.keys(h).forEach(k => delete h[k]));
      renderEliminatedArea();
    },

    close() { w.close(); },
  };
  return app;
}

// ── Independent re-implementation of the wire format ───────
// Deliberately not imported from js/firebase.js, so the tests pin the format.

export function fnvHash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = (h * 0x01000193) >>> 0; }
  return h.toString(36);
}

export async function deriveKey(password, room) {
  const enc = new TextEncoder();
  const km = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode('maplag_' + room), iterations: 100000, hash: 'SHA-256' },
    km, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function encrypt(key, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const d = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(obj)));
  return { _e: { iv: Buffer.from(iv).toString('base64'), d: Buffer.from(d).toString('base64') } };
}

export async function decrypt(key, wrapper) {
  const iv = Buffer.from(wrapper._e.iv, 'base64');
  const d = Buffer.from(wrapper._e.d, 'base64');
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, d);
  return JSON.parse(new TextDecoder().decode(plain));
}
