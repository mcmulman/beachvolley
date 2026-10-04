/* ============================================================================
   turnier-archive.js – "Neues Turnier" ohne Datenverlust

   Ein Turnierbogen hält immer genau EIN laufendes Turnier im localStorage.
   Damit "Neues Turnier" nichts vernichtet, wird der bisherige Stand vorher in
   ein Archiv kopiert und in der Turnierliste der Startseite verlinkt.
   Über `?restore=<Archivschlüssel>` holt der Bogen ein archiviertes Turnier
   zurück in den laufenden Zustand.

   Bewusst ohne Abhängigkeiten (auch die Altbögen ohne core/-Engine nutzen es).
   ========================================================================== */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TArchive = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const ARCHIVE_PREFIX = 'beachl.arch.';
  const INDEX_KEY = 'beachl.index';
  const ARCHIVES_KEY = '__archives';

  function ls() {
    try { return (typeof localStorage !== 'undefined') ? localStorage : null; }
    catch (e) { return null; }
  }
  function readRaw(key) { const s = ls(); if (!s) return null; try { return s.getItem(key); } catch (e) { return null; } }
  function writeRaw(key, val) { const s = ls(); if (!s) return false; try { s.setItem(key, val); return true; } catch (e) { return false; } }
  function removeRaw(key) { const s = ls(); if (!s) return; try { s.removeItem(key); } catch (e) { } }
  function readIndex() {
    try {
      const v = JSON.parse(readRaw(INDEX_KEY) || '{}');
      return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    } catch (e) { return {}; }
  }
  function writeIndex(index) { writeRaw(INDEX_KEY, JSON.stringify(index)); }

  /* Titelvorschlag für ein neues Turnier: Typ und Datum, z. B.
     "Schweizer System – 19.08.2026". */
  function newTitle(type, date) {
    const d = date instanceof Date ? date : new Date();
    const p = n => String(n).padStart(2, '0');
    const stamp = p(d.getDate()) + '.' + p(d.getMonth() + 1) + '.' + d.getFullYear();
    return (type ? type + ' – ' : '') + stamp;
  }

  /* Fenster-/Drucktitel eines Bogens. Automatische Titel enthalten den
     Turniertyp bereits ("Schweizer System – 19.08.2026"); er wird dann nicht
     ein zweites Mal angehängt. Zentral, damit alle Bögen gleich heißen. */
  const AUTO_TITLE_RE = /^(.+) – (\d{2}\.\d{2}\.\d{4})$/;
  function isAutoTitle(title, type) {
    const m = AUTO_TITLE_RE.exec(String(title || '').trim());
    return !!(m && type && m[1] === type);
  }
  function docTitle(title, type, info) {
    const t = String(title || '').trim();
    const add = String(info || '').trim();
    const tail = add ? ' (' + add + ')' : '';
    if (!t) return 'Turnierbogen' + (type ? ' – ' + type : '') + tail;
    if (isAutoTitle(t, type)) return t + ' – Turnierbogen' + tail;
    return t + ' – Turnierbogen' + (type ? ' – ' + type : '') + tail;
  }
  /* Ueberschrift im Bogen (unten): der eigene Turniertitel, sonst Turniertyp
     und Datum ("KO-System – 19.08.2026"). Der Turniertyp allein steht oben in
     der App-Leiste, deshalb hier immer eine vollstaendige Turnier-Bezeichnung. */
  function headTitle(title, type) {
    return String(title || '').trim() || newTitle(type);
  }
  /* Ueberschrift als HTML: bei eigenem Turniertitel wird der Turniertyp klein
     dahinter gesetzt - am Bildschirm steht er in der App-Leiste, im Druck
     (dort fehlt die Leiste) macht ihn CSS sichtbar. */
  function headTitleHtml(title, type) {
    const esc = s => String(s).replace(/[&<>"]/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const t = String(title || '').trim();
    const ty = String(type || '').trim();
    if (!t || !ty || t === ty || isAutoTitle(t, ty)) return esc(headTitle(t, ty));
    return esc(t) + ' <span class="h1-type">' + esc(ty) + '</span>';
  }
  /* Titel der App-Leiste (oben): Turniertyp mit Team- und Feldzahl. */
  function barTitle(type, teams, fields) {
    const info = sizeInfo(teams, fields);
    return String(type || 'Turnierbogen') + (info ? ' · ' + info : '');
  }
  /* Einheitliche Kurzangabe fuer die Ueberschrift: "12 Teams · 6 Felder". */
  function sizeInfo(teams, fields) {
    const parts = [];
    if (+teams > 0) parts.push(teams + ' Teams');
    if (+fields > 0) parts.push(fields + (+fields === 1 ? ' Feld' : ' Felder'));
    return parts.join(' · ');
  }

  /* Sammelt die vorhandenen Werte der übergebenen localStorage-Schlüssel. */
  function snapshot(keys) {
    const out = {};
    (keys || []).forEach(k => {
      const v = readRaw(k);
      if (v != null) out[k] = v;
    });
    return out;
  }

  /* Link zum Wiederherstellen eines Archiveintrags. Die Daten liegen unter
     den Speicher-Schlüsseln des Turniers ("base" bzw. "base.<id>") – die
     Zielseite muss daher mit DERSELBEN ?id= geöffnet werden, sonst passt
     "sheet" nicht und der Restore wird verworfen. file kann schon Parameter
     tragen (z. B. "…?mode=swiss"), daher Trenner korrekt wählen. */
  function restoreUrl(file, sheet, key) {
    let f = String(file || '');
    const s = String(sheet || '');
    const dot = s.indexOf('.');
    if (!/[?&]id=/.test(f)) {
      f += (f.indexOf('?') >= 0 ? '&' : '?') + 'id=' + encodeURIComponent(dot >= 0 ? s.slice(dot + 1) : '_base_');
    }
    return f + '&restore=' + encodeURIComponent(key);
  }

  /* Archiviert den aktuellen Stand eines Bogens.
     opts: { sheet, file, type, keys, title, teams }
     Rückgabe: Archivschlüssel oder null, wenn nichts zu sichern war. */
  function save(opts) {
    const o = opts || {};
    if (o.empty) return null;           // leeres Turnier muss nicht gesichert werden
    const data = snapshot(o.keys);
    if (!Object.keys(data).length) return null;

    const savedAt = Date.now();
    const key = ARCHIVE_PREFIX + (o.sheet || 'turnier') + '.' + savedAt;
    const title = (o.title && String(o.title).trim())
      ? String(o.title).trim()
      : newTitle(o.type, new Date(savedAt));

    const stored = {
      sheet: o.sheet || '',
      file: o.file || '',
      type: o.type || '',
      title: title,
      teams: Array.isArray(o.teams) ? o.teams : [],
      savedAt: savedAt,
      data: data
    };
    if (!writeRaw(key, JSON.stringify(stored))) return null;

    const index = readIndex();
    const archives = index[ARCHIVES_KEY] && typeof index[ARCHIVES_KEY] === 'object'
      ? index[ARCHIVES_KEY] : {};
    archives[key] = {
      key: key,
      file: o.file || '',
      sheet: stored.sheet,
      type: stored.type,
      title: title,
      teams: stored.teams,
      savedAt: savedAt,
      archived: true
    };
    index[ARCHIVES_KEY] = archives;
    if (o.sheet) delete index[o.sheet];
    writeIndex(index);
    return key;
  }

  /* Schreibt einen rohen Schlüssel/Wert-Schnappschuss (siehe snapshot()) direkt
     in den localStorage zurück. Wird von TShare beim Import eines geteilten
     Turnier-Links genutzt – dieselbe Datenform wie beim Archivieren/Restore. */
  function writeSnapshot(data) {
    Object.keys(data || {}).forEach(k => writeRaw(k, data[k]));
    updateLiveIndex(data);
  }

  function updateLiveIndex(data, savedAt) {
    const index = readIndex();
    let changed = false;
    Object.keys(data || {}).forEach(key => {
      if (key.indexOf('beachl.t.') !== 0) return;
      const sheet = key.slice('beachl.t.'.length);
      try {
        const tournament = JSON.parse(data[key]);
        if (!sheet || !tournament || tournament.schema !== 2) return;
        index[sheet] = {
          title: tournament.title || '',
          teams: tournament.config && tournament.config.teams,
          updated: tournament.updated || new Date(savedAt || Date.now()).toISOString(),
          filled: Object.keys(tournament.results || {}).length
        };
        changed = true;
      } catch (e) { }
    });
    if (changed) writeIndex(index);
  }

  function meta(key) {
    if (!key) return null;
    try {
      const v = JSON.parse(readRaw(key) || 'null');
      return (v && v.data) ? v : null;
    } catch (e) { return null; }
  }

  /* Holt ein archiviertes Turnier zurück in den laufenden Zustand.
     Der Archiveintrag wird dabei aufgelöst, weil das Turnier wieder "live" ist. */
  function restore(key) {
    const m = meta(key);
    if (!m) return null;
    Object.keys(m.data).forEach(k => writeRaw(k, m.data[k]));
    remove(key);
    updateLiveIndex(m.data, m.savedAt);
    return m;
  }

  function remove(key) {
    if (!key) return;
    removeRaw(key);
    const index = readIndex();
    if (index[ARCHIVES_KEY]) {
      delete index[ARCHIVES_KEY][key];
      if (!Object.keys(index[ARCHIVES_KEY]).length) delete index[ARCHIVES_KEY];
      writeIndex(index);
    }
  }

  /* Löscht die laufenden Daten eines Bogens (nach dem Archivieren). */
  function clearLive(keys, sheet) {
    (keys || []).forEach(removeRaw);
    if (sheet) {
      const index = readIndex();
      delete index[sheet];
      writeIndex(index);
    }
  }

  /* ?restore=… aus der Adresszeile lesen. */
  function pendingRestore(search) {
    try {
      const q = new URLSearchParams(search != null ? search : location.search);
      const k = q.get('restore');
      return (k && k.indexOf(ARCHIVE_PREFIX) === 0) ? k : null;
    } catch (e) { return null; }
  }

  /* Entfernt den restore-Parameter, damit ein Reload nicht erneut zurückholt. */
  function clearPendingParam() {
    try {
      const url = new URL(location.href);
      if (!url.searchParams.has('restore')) return;
      url.searchParams.delete('restore');
      history.replaceState(null, '', url.pathname + (url.search || '') + url.hash);
    } catch (e) { }
  }

  /* Kompletter Ablauf beim Öffnen eines Bogens: liegt ein Restore an, wird der
     aktuelle Stand zuerst archiviert und danach das gewählte Turnier geladen. */
  function applyPendingRestore(opts) {
    const key = pendingRestore();
    if (!key) return null;
    const m = meta(key);
    if (!m || (opts && opts.sheet && m.sheet && m.sheet !== opts.sheet)) { clearPendingParam(); return null; }
    save(opts);                       // laufendes Turnier sichern (falls vorhanden)
    if (opts && opts.keys) clearLive(opts.keys, opts.sheet);
    const restored = restore(key);
    clearPendingParam();
    return restored;
  }

  /* "Neues Turnier": bisheriges sichern, laufende Daten leeren.
     Rückgabe: { archived: <key|null>, title: <Titel für das neue Turnier> } */
  function startNew(opts) {
    const o = opts || {};
    const liveKeys = snapshot(o.keys);
    const livePrefix = 'beachl.t.';
    const hasInvalidLiveData = Object.keys(liveKeys).some(function (key) {
      if (key.indexOf(livePrefix) !== 0) return false;
      try {
        const data = JSON.parse(liveKeys[key]);
        return !data || data.schema !== 2 || data.sheet !== key.slice(livePrefix.length);
      } catch (e) {
        return true;
      }
    });
    const mustArchive = !o.empty || hasInvalidLiveData;
    const saveOptions = Object.assign({}, o, { empty: !mustArchive });
    const archived = save(saveOptions);
    if (mustArchive && !archived) {
      return { archived: null, title: newTitle(o.type), blocked: true };
    }
    clearLive(o.keys, o.sheet);
    return { archived: archived, title: newTitle(o.type), blocked: false };
  }

  return {
    ARCHIVE_PREFIX, INDEX_KEY, ARCHIVES_KEY,
    newTitle, isAutoTitle, docTitle, headTitle, headTitleHtml, barTitle, sizeInfo, snapshot, writeSnapshot, save, meta, restore, remove, clearLive,
    pendingRestore, clearPendingParam, applyPendingRestore, startNew, restoreUrl
  };
});
