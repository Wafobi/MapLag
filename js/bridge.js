// ── Cross-module function registry ─────────────────────────
// Centralizes late-bound references that break circular imports
// between zones ↔ firebase and zones ↔ thermo.
// Modules write their functions here at init time; other modules
// read them at call time. Init order no longer matters.

export const bridge = {
  // Set by firebase.js, consumed by zones.js, thermo.js, and ui.js
  fbWriteZone: () => {},
  fbDeleteZone: () => {},
  fbWriteThermo: () => {},
  fbDeleteThermo: () => {},

  // Set by thermo.js, consumed by zones.js renderEliminatedArea
  tpEliminatedPolygon: () => null,
};
