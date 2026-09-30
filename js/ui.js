// ── UI: modals, sheets, patterns, theme ────────────────────

import { st, tp, admin, thermoHistory, cancelMapClickPos, missColor } from './state.js';
import { t } from './i18n.js';
import { map } from './map.js';
import {
  renderZonePanel, renderEliminatedArea, setMissColorFull,
  updatePatternColors, setElimPattern, getElimPattern,
  undoZone, delZone,
} from './zones.js';
import { tpRenderConstraints } from './thermo.js';
import { radarClearCenter } from './radar.js';
import { mqReset } from './measure.js';
import { bridge } from './bridge.js';

// ── Sheet management ───────────────────────────────────────

const SHEET_IDS = ['mq-sheet', 'radar-sheet', 'thermo-panel', 'zone-panel', 'admin-sheet'];

export function closeAllSheets() {
  cancelMapClickPos();
  radarClearCenter();
  mqReset();
  SHEET_IDS.forEach(id => document.getElementById(id).classList.remove('open'));
  document.querySelectorAll('[data-mode]').forEach(b => b.classList.remove('active'));
  document.getElementById('btn-mq').classList.remove('active');
  document.getElementById('btn-thermo').classList.remove('active');
  document.getElementById('btn-admin').classList.remove('active');
  if (admin.previewLayer) { map.removeLayer(admin.previewLayer); admin.previewLayer = null; }
  admin.pendingData = null;
  document.getElementById('admin-level-select').style.display = 'block';
  document.getElementById('admin-confirm').style.display = 'none';
  document.getElementById('admin-loading').style.display = 'none';
  document.querySelectorAll('[data-admin-zoom]').forEach(b => b.classList.remove('sel'));
  tp.open = false;
  st.mode = 'none';
}

// ── Zone panel open/close ──────────────────────────────────

export function openZonePanel() {
  closeAllSheets();
  renderZonePanel();
  document.getElementById('zone-panel').classList.add('open');
}

export function closeZonePanel() {
  document.getElementById('zone-panel').classList.remove('open');
}

// ── Confirm modal ──────────────────────────────────────────

let confirmCb = null;

export function showConfirm(msg, onOk) {
  document.getElementById('confirm-msg').textContent = msg;
  document.getElementById('confirm-modal').style.display = 'flex';
  confirmCb = onOk;
}

// ── Label modal ────────────────────────────────────────────

export function askLabel(def = '') {
  return new Promise(r => {
    document.getElementById('label-input').value = def;
    document.getElementById('label-modal').classList.add('show');
    setTimeout(() => document.getElementById('label-input').focus(), 50);
    st.labelCb = r;
  });
}

// ── Init UI event bindings ─────────────────────────────────

export function initUI() {
  // Confirm modal
  document.getElementById('btn-confirm-ok').onclick = () => {
    document.getElementById('confirm-modal').style.display = 'none';
    if (confirmCb) { confirmCb(); }
    confirmCb = null;
  };
  document.getElementById('btn-confirm-cancel').onclick = () => {
    document.getElementById('confirm-modal').style.display = 'none';
    confirmCb = null;
  };

  // Label modal
  document.getElementById('btn-lbl-ok').onclick = () => {
    const v = document.getElementById('label-input').value.trim() || 'Zone';
    document.getElementById('label-modal').classList.remove('show');
    if (st.labelCb) st.labelCb(v);
  };
  document.getElementById('btn-lbl-cancel').onclick = () => {
    document.getElementById('label-modal').classList.remove('show');
    if (st.labelCb) st.labelCb(null);
  };
  document.getElementById('label-input').onkeydown = e => {
    if (e.key === 'Enter') document.getElementById('btn-lbl-ok').click();
    if (e.key === 'Escape') document.getElementById('btn-lbl-cancel').click();
  };

  // Thermo close
  document.getElementById('btn-thermo-close').addEventListener('click', () => {
    cancelMapClickPos();
    document.getElementById('thermo-panel').classList.remove('open');
    document.getElementById('btn-thermo').classList.remove('active');
    tp.open = false;
  });
  document.getElementById('thermo-panel').addEventListener('click', function (e) {
    if (e.target !== this) return;
    cancelMapClickPos();
    this.classList.remove('open');
    document.getElementById('btn-thermo').classList.remove('active');
    tp.open = false;
  });

  // Radar close
  document.getElementById('btn-radar-close').addEventListener('click', () => {
    cancelMapClickPos();
    radarClearCenter();
    document.getElementById('radar-sheet').classList.remove('open');
    document.querySelectorAll('[data-mode]').forEach(x => x.classList.remove('active'));
    st.mode = 'none';
  });

  // Zone panel
  document.getElementById('btn-zones').addEventListener('click', () => {
    document.getElementById('zone-panel').classList.contains('open') ? closeZonePanel() : openZonePanel();
  });
  document.getElementById('zone-panel-close').addEventListener('click', closeZonePanel);
  document.getElementById('zone-panel').addEventListener('click', function (e) {
    if (e.target === this) closeZonePanel();
  });

  // Zone panel list actions
  document.getElementById('zone-panel-list').addEventListener('click', e => {
    const btn = e.target.closest('button[data-id]');
    if (!btn) return;
    const id = btn.dataset.id;
    if (btn.classList.contains('zp-tp-undo')) {
      const c = thermoHistory[id];
      if (!c) return;
      delete thermoHistory[id];
      tp.constraints.push(c);
      tpRenderConstraints();
      bridge.fbWriteThermo(c);
      renderZonePanel();
    } else if (btn.classList.contains('zp-tp-del')) {
      const c = tp.constraints.find(x => x.id === id);
      if (!c) return;
      tp.constraints.splice(tp.constraints.indexOf(c), 1);
      thermoHistory[id] = c;
      tpRenderConstraints();
      bridge.fbDeleteThermo(id);
      renderZonePanel();
    } else if (btn.classList.contains('zp-undo')) {
      undoZone(id);
    } else if (btn.classList.contains('zp-del')) {
      delZone(id);
    }
  });

  // Miss color picker
  document.getElementById('miss-color-picker').addEventListener('input', e => setMissColorFull(e.target.value));
  document.getElementById('miss-color-picker').value = missColor;
  updatePatternColors(missColor);

  // Pattern settings
  let _patternSize = parseFloat(localStorage.getItem('patternSize') || '5');
  let _patternSpeed = parseFloat(localStorage.getItem('patternSpeed') || '4');

  function _applyPatternSize(v) {
    ['_pd1', '_pd2', '_pd3', '_pz1', '_pz2', '_pz3'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.setAttribute('stroke-width', v);
    });
  }

  function _applyPatternSpeed(v) {
    const dur = (3.3 / v).toFixed(2) + 's';
    document.querySelectorAll('#_elim_dots animateTransform, #_elim_zz animateTransform')
      .forEach(el => el.setAttribute('dur', dur));
  }

  function _setElimPatternUI(p) {
    setElimPattern(p);
    localStorage.setItem('elimPattern', p);
    document.getElementById('btn-pattern-off').classList.toggle('active', p === 'off');
    document.getElementById('btn-pattern-stripes').classList.toggle('active', p === 'stripes');
    document.getElementById('btn-pattern-zigzag').classList.toggle('active', p === 'zigzag');
    document.getElementById('pattern-settings').style.display = p === 'off' ? 'none' : 'flex';
    renderEliminatedArea();
  }

  const _szSlider = document.getElementById('pattern-size');
  const _spSlider = document.getElementById('pattern-speed');
  _szSlider.value = _patternSize;
  _spSlider.value = _patternSpeed;
  document.getElementById('pattern-size-lbl').textContent = _patternSize;
  document.getElementById('pattern-speed-lbl').textContent = _patternSpeed;

  _szSlider.addEventListener('input', e => {
    _patternSize = parseFloat(e.target.value);
    localStorage.setItem('patternSize', _patternSize);
    document.getElementById('pattern-size-lbl').textContent = _patternSize;
    _applyPatternSize(_patternSize);
  });
  _spSlider.addEventListener('input', e => {
    _patternSpeed = parseFloat(e.target.value);
    localStorage.setItem('patternSpeed', _patternSpeed);
    document.getElementById('pattern-speed-lbl').textContent = _patternSpeed;
    _applyPatternSpeed(_patternSpeed);
  });

  document.getElementById('btn-pattern-off').addEventListener('click', () => _setElimPatternUI('off'));
  document.getElementById('btn-pattern-stripes').addEventListener('click', () => _setElimPatternUI('stripes'));
  document.getElementById('btn-pattern-zigzag').addEventListener('click', () => _setElimPatternUI('zigzag'));
  _setElimPatternUI(getElimPattern());
  _applyPatternSize(_patternSize);
  _applyPatternSpeed(_patternSpeed);

  // Theme toggle
  const themeBtn = document.getElementById('btn-theme');
  const applyTheme = light => {
    document.documentElement.classList.toggle('light', light);
    themeBtn.querySelector('.tb-icon').textContent = light ? '🌙' : '☀';
    themeBtn.querySelector('.tb-lbl').textContent = light ? t('tb.theme.dark') : t('tb.theme.light');
    localStorage.setItem('theme', light ? 'light' : 'dark');
  };
  applyTheme(localStorage.getItem('theme') === 'light');
  themeBtn.addEventListener('click', () => applyTheme(!document.documentElement.classList.contains('light')));

  // Toolbar height
  function _updateToolbarH() {
    const h = document.getElementById('toolbar').offsetHeight;
    document.documentElement.style.setProperty('--toolbar-h', h + 'px');
  }
  _updateToolbarH();
  window.addEventListener('resize', _updateToolbarH);
}

