// ── Local mirror of a room: offline cache + outbox ─────────
// Everything written or received is mirrored in localStorage in the same
// (encrypted) form as in Firebase, so the map survives reloads without
// network. Local writes additionally sit in an outbox until Firebase
// confirms them; unconfirmed writes are re-sent on the next start.

function _load(key) {
  try { return JSON.parse(localStorage.getItem(key)) || {}; } catch (e) { return {}; }
}

function _setPath(obj, rel, value) {
  const parts = rel.split('/');
  const last = parts.pop();
  let node = obj;
  for (const p of parts) {
    if (node[p] == null || typeof node[p] !== 'object') node[p] = {};
    node = node[p];
  }
  if (value == null) delete node[last];
  else node[last] = value;
}

export class RoomMirror {
  // withOutbox=false for solo play, where there is no server to confirm writes
  constructor(roomPath, { withOutbox = true } = {}) {
    this.cacheKey = 'mlCache:' + roomPath;
    this.outboxKey = 'mlOutbox:' + roomPath;
    this.cache = _load(this.cacheKey);
    this.outbox = withOutbox ? _load(this.outboxKey) : null;
    this.onchange = null;  // called when the number of pending writes changes
    this.onerror = null;   // called when localStorage is full
  }

  // Children of 'zones' / 'thermos' as stored: { id: wrapper }
  children(kind) { return this.cache[kind] || {}; }

  // Mirror a value received from the server (rel: "zones/<id>", null removes)
  put(rel, value) {
    _setPath(this.cache, rel, value);
    this._save(this.cacheKey, this.cache);
  }

  // Local write: mirror it and queue it for the server.
  // Returns the ack to call once the server has confirmed this exact write.
  write(rel, value) {
    this.put(rel, value);
    if (!this.outbox) return () => {};
    // A newer write to a node supersedes queued writes to it or below it
    for (const p of Object.keys(this.outbox)) {
      if (p === rel || p.startsWith(rel + '/')) delete this.outbox[p];
    }
    const token = Math.random().toString(36).slice(2);
    this.outbox[rel] = { v: value, t: token };
    this._save(this.outboxKey, this.outbox);
    this.onchange?.();
    return () => this._ack(rel, token);
  }

  // Queued writes in the order they were made, each with its ack
  pending() {
    if (!this.outbox) return [];
    return Object.entries(this.outbox).map(([rel, e]) => ({ rel, value: e.v, ack: () => this._ack(rel, e.t) }));
  }

  pendingCount() { return this.outbox ? Object.keys(this.outbox).length : 0; }

  _ack(rel, token) {
    if (this.outbox?.[rel]?.t !== token) return;  // superseded by a newer write
    delete this.outbox[rel];
    this._save(this.outboxKey, this.outbox);
    this.onchange?.();
  }

  _save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); }
    catch (e) { console.warn('RoomMirror: could not save', key, e); this.onerror?.(e); }
  }
}
