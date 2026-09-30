// ── Internationalization ────────────────────────────────────

import { T, MODE_LABELS } from './state.js';
import { map, mapThemeStates, getMapThemeIdx, loadTiles, setMapLang } from './map.js';
import { renderZonePanel } from './zones.js';

export let uiLang = localStorage.getItem('uiLang') || 'de';

export function setUiLang(v) { uiLang = v; }

const _tr = (de, en) => ({ de, en });

export const TR_DATA = {
  'tb.mq':_tr('Messfrage','Measure'),'tb.area':_tr('Gebiet','Area'),'tb.locate':_tr('Orten','Locate'),
  'tb.theme.light':_tr('Hell','Light'),'tb.theme.dark':_tr('Dunkel','Dark'),
  'mq.title':_tr('Messfrage','Measuring'),
  'mq.hint':_tr('Ort suchen oder Karte antippen um Vergleichspunkt zu setzen. Ohne GPS: zuerst eigene Position antippen.','Search or tap map to set reference point. No GPS: tap your position first.'),
  'mq.closer':_tr('✓ Näher','✓ Closer'),'mq.further':_tr('✗ Weiter','✗ Further'),
  'mq.distfrom':{de:v=>`${v} von deinem Standort`,en:v=>`${v} from your location`},
  'radar.hint':_tr('Radius eingeben, dann Hit oder Miss drücken. Mittelpunkt ist dein GPS-Standort – Karte antippen, um einen anderen zu wählen.','Enter radius, then press Hit or Miss. Center is your GPS position — tap the map to pick another.'),
  'tip.radarcenter':_tr('Radar-Mittelpunkt gesetzt','Radar center set'),
  'tp.hint':_tr('<b style="color:var(--text1)">Start</b> am ersten Standort drücken, dann zum zweiten Punkt gehen und <b style="color:var(--text1)">Stop</b> drücken. Ohne GPS auf die Karte tippen.','Press <b style="color:var(--text1)">Start</b> at the first location, then move to the next point and press <b style="color:var(--text1)">Stop</b>. No GPS: tap the map.'),
  'tp.start':_tr('📍 Start','📍 Start'),'tp.stop':_tr('🛑 Stop','🛑 Stop'),
  'tp.startMarker':_tr('Start','Start'),'tp.stopMarker':_tr('Stopp','Stop'),
  'tp.question':_tr('Ist der Hider <b style="color:var(--red)">wärmer</b> (näher) oder <b style="color:#5ba3e0">kälter</b> (weiter) geworden?','Did the hider get <b style="color:var(--red)">warmer</b> (closer) or <b style="color:#5ba3e0">cooler</b> (further)?'),
  'tp.warmer':_tr('🔥 Wärmer','🔥 Warmer'),'tp.cooler':_tr('❄️ Kälter','❄️ Cooler'),'tp.reset':_tr('↺ Zurücksetzen','↺ Reset'),
  'tp.zoneinfo':_tr('Karte aktualisiert','Map updated'),
  'tp.warmerLabel':{de:d=>`Wärmer (${d})`,en:d=>`Warmer (${d})`},
  'tp.coolerLabel':{de:d=>`Kälter (${d})`,en:d=>`Cooler (${d})`},
  'tp.startfirst':_tr('Zuerst Start drücken','Press Start first'),
  'dist.label':{de:d=>`Distanz: ${d}`,en:d=>`Distance: ${d}`},
  'tp.resetconfirm':_tr('Alle Thermometer-Messungen löschen? (Über 📋 wiederherstellbar)','Delete all thermometer readings? (Restorable via 📋)'),
  'zone.empty':_tr('Noch keine Zonen gezeichnet.','No zones drawn yet.'),
  'zone.undo':_tr('↩ Rückgängig','↩ Undo'),'zone.del':_tr('× Löschen','× Delete'),
  'zone.misscolor':_tr('Miss-Farbe:','Miss color:'),
  'label.title':_tr('Zone benennen','Name Zone'),'label.ph':_tr('z. B. Verbotene Zone Nord','e.g. Forbidden Zone North'),
  'label.cancel':_tr('Abbrechen','Cancel'),
  'confirm.cancel':_tr('Abbrechen','Cancel'),'confirm.ok':_tr('Löschen','Delete'),
  'admin.hint':_tr('Admin-Ebene wählen, dann Karte antippen','Select admin level, then tap the map'),
  'admin.country':_tr('Land','Country'),'admin.state':_tr('Bundesland','State'),
  'admin.district':_tr('Landkreis','District'),'admin.city':_tr('Stadt','City'),
  'admin.loading':_tr('Grenze wird geladen …','Loading boundary …'),
  'admin.hit':_tr('✓ Hit — Hier','✓ Hit — Here'),'admin.miss':_tr('✗ Miss — Nicht hier','✗ Miss — Not here'),
  'admin.reselect':_tr('↩ Neu wählen','↩ Reselect'),
  'search.ph':_tr('Ort suchen …','Search location …'),
  'search.busy':_tr('Wird gesucht …','Searching …'),
  'search.empty':_tr('Keine Ergebnisse','No results'),
  'search.error':_tr('Suchfehler','Search error'),
  'mode.pan':_tr('Verschieben','Pan'),'mode.admin':_tr('Gebiet','Area'),
  'T.circ':_tr('Karte antippen → Radar um GPS-Standort','Tap map → radar around GPS'),
  'T.start':_tr('Karte bewegen oder Modus wählen','Pan map or select mode'),
  'tip.locfound':{de:a=>`Standort gefunden · ±${a}m`,en:a=>`Location found · ±${a}m`},
  'tip.gpsdeny':_tr('GPS-Zugriff verweigert','GPS access denied'),
  'tip.gpsnavail':_tr('GPS nicht verfügbar','GPS unavailable'),
  'tip.gpstimeout':_tr('GPS-Zeitüberschreitung','GPS timeout'),
  'tip.gpserror':_tr('GPS-Fehler','GPS error'),
  'tip.gpstap':_tr(' – Karte antippen',' — tap map'),
  'tip.gettinggps':_tr('GPS wird abgerufen …','Getting GPS …'),
  'tip.tapmap':_tr('Auf die Karte tippen, um den Standort zu setzen','Tap map to set location'),
  'tip.tapgoal':_tr('Jetzt Ziel auf der Karte antippen','Now tap map to set target'),
  'tip.notapgoal':_tr('Bitte zuerst Ziel auf der Karte antippen','Please tap map to set target first'),
  'tip.startset':_tr('Start gesetzt! Zum nächsten Punkt gehen und Stopp drücken.','Start set! Move to the next point and press Stop.'),
  'tip.stopset':{de:d=>`Stopp gesetzt (${d}). Wärmer oder kälter?`,en:d=>`Stop set (${d}). Warmer or cooler?`},
  'tip.threset':_tr('Thermometer zurückgesetzt','Thermometer reset'),
  'tip.logcleared':_tr('Protokoll gelöscht — Zonen über 📋 Zonen entfernen','Log cleared — delete zones via 📋 Zones'),
  'tip.taparea':_tr('Karte antippen um Gebiet zu wählen','Tap map to select area'),
  'tip.nogps':_tr('Kein GPS-Signal vorhanden','No GPS signal'),
  'tip.units':{de:imp=>`Einheiten: ${imp?'Imperial (Meilen)':'Metrisch (km)'}`,en:imp=>`Units: ${imp?'Imperial (miles)':'Metric (km)'}`},
  'tip.opnv.on':_tr('ÖPNV-Ebene aktiv','Transit layer active'),
  'tip.opnv.off':_tr('ÖPNV-Ebene ausgeblendet','Transit layer hidden'),
  'tip.noboundary':_tr('Keine Grenze gefunden','No boundary found'),
  'tip.boundaryerr':_tr('Grenze nicht darstellbar','Boundary cannot be displayed'),
  'tip.loaderr':_tr('Fehler beim Laden der Grenze','Error loading boundary'),
  'pw.hint':_tr('Gruppenpasswort eingeben um beizutreten','Enter group password to join'),
  'pw.passwordph':_tr('Passwort…','Password…'),
  'pw.error':_tr('Falsches Passwort','Wrong password'),'pw.submit':_tr('Beitreten','Join'),
  'pw.solo':_tr('📴 Offline spielen (ohne Sync)','📴 Play offline (no sync)'),
  'net.solo':_tr('📴 Solo','📴 Solo'),
  'net.offline':{de:n=>n?`⚠ Offline · ${n} ausstehend`:'⚠ Offline',en:n=>n?`⚠ Offline · ${n} pending`:'⚠ Offline'},
  'net.syncing':{de:n=>`↻ ${n} ausstehend`,en:n=>`↻ ${n} pending`},
  'tip.storagefull':_tr('Gerätespeicher voll – Offline-Kopie unvollständig','Device storage full — offline copy incomplete'),
  'pattern.label':_tr('Muster:','Pattern:'),'pattern.off':_tr('✕ Aus','✕ Off'),
  'pattern.stripes':_tr('≡ Striche','≡ Stripes'),'pattern.zigzag':_tr('⌇ Zickzack','⌇ Zigzag'),
  'pattern.size':_tr('Größe','Size'),'pattern.speed':_tr('Geschw.','Speed'),
  'title.locate':_tr('Auf meinen Standort zentrieren','Center on my location'),
  'title.units':_tr('Einheiten umschalten','Toggle units'),
  'map.default':_tr('Karte','Map'),'map.light':_tr('Helle Karte','Light map'),
  'map.dark':_tr('Dunkle Karte','Dark map'),'map.satellite':_tr('Satellit','Satellite'),
  'map.hybrid':_tr('Hybrid','Hybrid'),
  'role.title':_tr('Rolle wählen','Choose role'),
  'role.hider':_tr('🙈 Hider','🙈 Hider'),
  'role.seeker':_tr('🔍 Seeker','🔍 Seeker'),
  'role.hider.desc':_tr('Versteckt sich — sieht Positionen der Seeker','Hides — sees seeker positions'),
  'role.seeker.desc':_tr('Sucht — nutzt Radar, Thermo, Messfrage, Gebiet','Searches — uses Radar, Thermo, Measure, Area'),
};

export function t(key, ...args) {
  const e = TR_DATA[key];
  if (!e) return key;
  const v = e[uiLang] ?? e.de ?? key;
  return typeof v === 'function' ? v(...args) : v;
}

// Sanitize HTML translation strings: only <b> with style allowed
function sanitizeHtml(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  tmp.querySelectorAll('*:not(b)').forEach(n => n.replaceWith(...n.childNodes));
  tmp.querySelectorAll('b').forEach(n => {
    [...n.attributes].forEach(a => { if (a.name !== 'style') n.removeAttribute(a.name); });
  });
  return tmp.innerHTML;
}

export function applyLang() {
  document.querySelectorAll('[data-t]').forEach(el =>
    el.textContent = (el.dataset.tPre || '') + t(el.dataset.t)
  );
  document.querySelectorAll('[data-th]').forEach(el => el.innerHTML = sanitizeHtml(t(el.dataset.th)));
  document.querySelectorAll('[data-tp]').forEach(el => el.placeholder = t(el.dataset.tp));
  document.querySelectorAll('[data-tt]').forEach(el => el.title = t(el.dataset.tt));

  const langLbl = document.querySelector('#btn-lang-ui .tb-lbl');
  if (langLbl) langLbl.textContent = uiLang === 'de' ? 'DE' : 'EN';

  const isLight = document.documentElement.classList.contains('light');
  const themeLbl = document.querySelector('#btn-theme .tb-lbl');
  if (themeLbl) themeLbl.textContent = isLight ? t('tb.theme.dark') : t('tb.theme.light');

  T.circ = t('T.circ');
  T.start = t('T.start');
  MODE_LABELS.move = t('mode.pan');
  MODE_LABELS.admin = t('mode.admin');

  const states = mapThemeStates;
  states[0].lbl = t('map.default');
  states[1].lbl = t('map.light');
  states[2].lbl = t('map.dark');
  states[3].lbl = t('map.satellite');
  states[4].lbl = t('map.hybrid');

  const mBtn = document.getElementById('btn-map-theme');
  if (mBtn) mBtn.title = states[getMapThemeIdx()].lbl;

  const uBtn = document.getElementById('btn-units');
  if (uBtn) uBtn.title = t('title.units');

  setMapLang(uiLang);
  loadTiles(0);
  renderZonePanel();
  localStorage.setItem('uiLang', uiLang);
}
