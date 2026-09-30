// In-memory stand-in for the Firebase Realtime Database compat API.
// Implements only what js/firebase.js uses: ref().set/remove/on/onDisconnect.
// Events are delivered asynchronously (microtask), like the real SDK's
// listeners firing after the call that caused them.

const clone = v => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
const split = path => path.split('/').filter(Boolean);

export class FakeDatabase {
  constructor() {
    this.root = {};
    this.listeners = [];     // { path, event, cb }
    this.onDisconnectOps = []; // paths to remove when the client disconnects
  }

  get(path) {
    let node = this.root;
    for (const p of split(path)) {
      if (node == null || typeof node !== 'object') return null;
      node = node[p];
    }
    return clone(node);
  }

  // Seed data as if another client wrote it (fires listeners too)
  seed(path, value) { this._write(path, value); }

  // Simulate the connection dropping: run registered onDisconnect ops
  disconnect() {
    this.onDisconnectOps.splice(0).forEach(p => this._write(p, null));
  }

  ref(path) {
    const db = this;
    return {
      set: v => { db._write(path, v); return Promise.resolve(); },
      remove: () => { db._write(path, null); return Promise.resolve(); },
      on: (event, cb) => db._on(path, event, cb),
      onDisconnect: () => ({ remove: () => { db.onDisconnectOps.push(path); return Promise.resolve(); } }),
    };
  }

  _children(path) {
    const v = this.get(path);
    return v && typeof v === 'object' ? v : {};
  }

  _on(path, event, cb) {
    this.listeners.push({ path, event, cb });
    if (event === 'child_added') {
      const kids = this._children(path);
      Object.keys(kids).forEach(k => queueMicrotask(() => cb(snap(k, kids[k]))));
    }
  }

  _write(path, value) {
    const before = new Map(this.listeners.map(l => [l, this._children(l.path)]));

    const parts = split(path);
    const last = parts.pop();
    let node = this.root;
    const trail = [];
    for (const p of parts) {
      if (node[p] == null || typeof node[p] !== 'object') node[p] = {};
      trail.push([node, p]);
      node = node[p];
    }
    if (value === null || value === undefined) delete node[last];
    else node[last] = clone(value);
    // Prune empty parents, like the real database does
    for (let i = trail.length - 1; i >= 0; i--) {
      const [parent, key] = trail[i];
      if (Object.keys(parent[key]).length === 0) delete parent[key];
    }

    for (const l of this.listeners) {
      const a = before.get(l), b = this._children(l.path);
      const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
      for (const k of keys) {
        let ev = null;
        if (!(k in a)) ev = 'child_added';
        else if (!(k in b)) ev = 'child_removed';
        else if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) ev = 'child_changed';
        if (ev === l.event) {
          const val = ev === 'child_removed' ? a[k] : b[k];
          queueMicrotask(() => l.cb(snap(k, val)));
        }
      }
    }
  }
}

function snap(key, val) {
  const v = clone(val);
  return { key, val: () => clone(v) };
}

export function createFakeFirebase() {
  const db = new FakeDatabase();
  return {
    db,
    apps: [],
    initializeApp(cfg) { this.apps.push(cfg); },
    database() { return db; },
  };
}
