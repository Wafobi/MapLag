// Service worker (sw.js) in a simulated worker scope: fake Cache Storage,
// controllable network.

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import vm from 'node:vm';

const ORIGIN = 'https://wafobi.github.io';
const SW_URL = `${ORIGIN}/MapLag/sw.js`;
const root = new URL('../', import.meta.url);
const swSource = readFileSync(new URL('sw.js', root), 'utf8');

const res = (body, type = 'cors', ok = true) => ({ body, type, ok, clone() { return { ...this }; } });

function createWorker() {
  const net = { online: true, requests: [], opaque: false };
  const stores = new Map();
  const keyOf = r => new URL(typeof r === 'string' ? r : r.url, SW_URL).href;
  const noSearch = u => { const x = new URL(u); x.search = ''; return x.href; };

  class FakeCache {
    constructor() { this.map = new Map(); }
    async put(r, v) { const k = keyOf(r); this.map.delete(k); this.map.set(k, v); }
    async match(r, opts = {}) {
      const k = keyOf(r);
      if (this.map.has(k)) return this.map.get(k);
      if (opts.ignoreSearch) for (const [kk, v] of this.map) if (noSearch(kk) === noSearch(k)) return v;
      return undefined;
    }
    async keys() { return [...this.map.keys()].map(url => ({ url })); }
    async delete(r) { return this.map.delete(keyOf(r)); }
    async addAll(urls) { for (const u of urls) await this.put(u, await fetch(keyOf(u))); }
  }
  const caches = {
    async open(n) { if (!stores.has(n)) stores.set(n, new FakeCache()); return stores.get(n); },
    async keys() { return [...stores.keys()]; },
    async delete(n) { return stores.delete(n); },
  };
  async function fetch(r) {
    const url = typeof r === 'string' ? r : r.url;
    net.requests.push(url);
    if (!net.online) throw new TypeError('Failed to fetch');
    return res(`net:${url}`, net.opaque ? 'opaque' : 'cors');
  }

  const handlers = {};
  const self = {
    location: new URL(SW_URL),
    addEventListener: (t, h) => { handlers[t] = h; },
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
  };
  vm.runInNewContext(swSource, { self, caches, fetch, URL, console });

  const run = async (type, extra = {}) => {
    let p = null;
    handlers[type]({ ...extra, waitUntil: x => { p = x; } });
    await p;
  };
  // Returns the response, or 'passthrough' if the worker did not intercept
  const request = async (url, { mode = 'cors', method = 'GET' } = {}) => {
    let p = null;
    handlers.fetch({ request: { url, mode, method }, respondWith: x => { p = x; } });
    return p ? await p : 'passthrough';
  };
  return { net, stores, caches, run, request };
}

describe('install', () => {
  it('precaches every app module and every CDN file index.html loads', async () => {
    const shell = vm.runInNewContext(`${swSource}; SHELL`, { self: { location: new URL(SW_URL), addEventListener() {} }, URL });
    for (const f of readdirSync(new URL('js/', root))) assert.ok(shell.includes(`js/${f}`), `js/${f} missing in SHELL`);
    const html = readFileSync(new URL('index.html', root), 'utf8');
    for (const [, url] of html.matchAll(/(?:src|href)="(https:[^"]+)"/g)) assert.ok(shell.includes(url), `${url} missing in SHELL`);
    for (const f of ['index.html', 'styles.css']) assert.ok(shell.includes(f), f);
  });

  it('stores the shell and drops caches of older versions', async () => {
    const w = createWorker();
    await (await w.caches.open('maplag-tiles-v0')).put('https://x/old', res('old'));
    await w.run('install');
    await w.run('activate');
    const names = await w.caches.keys();
    assert.ok(!names.includes('maplag-tiles-v0'));
    const shell = await w.caches.open(names.find(n => n.startsWith('maplag-shell-')));
    assert.ok(await shell.match(`${ORIGIN}/MapLag/js/main.js`));
  });
});

describe('app files', () => {
  it('online: always fetched from the network', async () => {
    const w = createWorker();
    await w.run('install');
    w.net.requests.length = 0;
    const r = await w.request(`${ORIGIN}/MapLag/js/zones.js`);
    assert.equal(r.body, `net:${ORIGIN}/MapLag/js/zones.js`);
    assert.equal(w.net.requests.length, 1);
  });

  it('offline: a ?room= link still opens the cached page', async () => {
    const w = createWorker();
    await w.run('install');
    w.net.online = false;
    const r = await w.request(`${ORIGIN}/MapLag/index.html?room=party`, { mode: 'navigate' });
    assert.equal(r.body, `net:${ORIGIN}/MapLag/index.html`);
    const lib = await w.request('https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js', { mode: 'no-cors' });
    assert.ok(lib.body);
  });
});

describe('tiles', () => {
  const tile = s => `https://${s}.basemaps.cartocdn.com/dark_all/12/2200/1343.png`;

  it('are served from cache offline, regardless of subdomain', async () => {
    const w = createWorker();
    assert.equal((await w.request(tile('a'))).body, `net:${tile('a')}`);
    w.net.online = false;
    assert.equal((await w.request(tile('c'))).body, `net:${tile('a')}`);
  });

  it('never seen offline → network error, as before', async () => {
    const w = createWorker();
    w.net.online = false;
    await assert.rejects(w.request(tile('b')));
  });

  it('opaque responses are not cached', async () => {
    const w = createWorker();
    w.net.opaque = true;
    await w.request(tile('a'));
    w.net.online = false;
    await assert.rejects(w.request(tile('a')));
  });

  it('keeps at most MAX_TILES, dropping the oldest', async () => {
    const w = createWorker();
    const max = vm.runInNewContext(`${swSource}; MAX_TILES`, { self: { location: new URL(SW_URL), addEventListener() {} }, URL });
    const url = i => `https://tile.openstreetmap.org/16/${i}/0.png`;
    for (let i = 0; i < max + 100; i++) await w.request(url(i));
    const cache = await w.caches.open((await w.caches.keys()).find(n => n.startsWith('maplag-tiles-')));
    const keys = await cache.keys();
    assert.ok(keys.length <= max + 50, `${keys.length} tiles kept`);
    assert.equal(await cache.match(url(0)), undefined, 'oldest dropped');
    assert.ok(await cache.match(url(max + 99)), 'newest kept');
  });
});

describe('passthrough', () => {
  it('does not touch Firebase, search, boundaries or the transit layer', async () => {
    const w = createWorker();
    for (const u of [
      'https://maplag-a802e-default-rtdb.europe-west1.firebasedatabase.app/.lp?start=t',
      'https://photon.komoot.io/api/?q=berlin',
      'https://nominatim.openstreetmap.org/reverse?lat=1&lon=1',
      'https://tile.memomaps.de/tilegen/6/33/21.png',
    ]) assert.equal(await w.request(u), 'passthrough', u);
    assert.equal(await w.request(`${ORIGIN}/MapLag/index.html`, { method: 'POST' }), 'passthrough');
  });
});
