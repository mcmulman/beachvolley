/* ============================================================================
   turnier-archive.js – "Neues Turnier" ohne Datenverlust

   Ein Turnierbogen hält immer genau EIN laufendes Turnier (IndexedDB über
   TStore). Damit "Neues Turnier" nichts vernichtet, wird der bisherige Stand
   vorher – in derselben Transaktion – in ein Archiv kopiert und in der
   Turnierliste der Startseite verlinkt. Über `?restore=<Archivschlüssel>`
   holt der Bogen ein archiviertes Turnier zurück in den laufenden Zustand.

   Abhängigkeit: core/turnier-store.js (TStore) muss vorher geladen sein.
   Titel-/URL-Helfer bleiben synchron; alles Speicherbezogene liefert Promises.
   ========================================================================== */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TArchive = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const ARCHIVE_PREFIX = 'beachl.arch.';
  const INDEX_KEY = 'beachl.index';
  const ARCHIVES_KEY = '__archives';
  const LIVE_PREFIX = 'beachl.t.';
  const SCHEMA = 2;

  /* DE/EN-Prototyp (core/turnier-i18n.js): übersetzt nur Anzeigetexte auf
     freigeschalteten Seiten. Gespeicherte Titel und Typen bleiben deutsch. */
  function i18n() {
    return typeof TI18n !== 'undefined' && TI18n && TI18n.active() ? TI18n : null;
  }
  function tx(key, de, params) {
    const I = i18n();
    if (I) return I.t(key, params);
    const s = de && typeof de === 'object'
      ? (params && Number(params.count) === 1 ? de.one : de.other) : de;
    return String(s).replace(/\{(\w+)\}/g, (m, k) => (params && params[k] != null ? String(params[k]) : m));
  }
  function term(s) {
    const I = i18n();
    return I ? I.term(s) : s;
  }

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
  /* Anzeige eines automatischen Titels: nur der Typ-Anteil wird übersetzt
     ("KO-System – 19.08.2026" → "Knockout – 19.08.2026"); gespeichert
     bleibt der deutsche Titel. */
  function displayAutoTitle(title) {
    const m = AUTO_TITLE_RE.exec(String(title || '').trim());
    return m ? term(m[1]) + ' – ' + m[2] : String(title || '').trim();
  }
  function docTitle(title, type, info) {
    const t = String(title || '').trim();
    const add = String(info || '').trim();
    const tail = add ? ' (' + add + ')' : '';
    const sheet = tx('archive.sheet', 'Turnierbogen');
    const typeLabel = type ? term(type) : type;
    if (!t) return sheet + (type ? ' – ' + typeLabel : '') + tail;
    if (isAutoTitle(t, type)) return displayAutoTitle(t) + ' – ' + sheet + tail;
    return t + ' – ' + sheet + (type ? ' – ' + typeLabel : '') + tail;
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
    if (!t) return esc(newTitle(term(ty)));
    if (isAutoTitle(t, ty)) return esc(displayAutoTitle(t));
    if (!ty) return esc(t);
    if (t === ty) return esc(term(t));
    return esc(t) + ' <span class="h1-type">' + esc(term(ty)) + '</span>';
  }
  /* Titel der App-Leiste (oben): Turniertyp mit Team- und Feldzahl. */
  function barTitle(type, teams, fields) {
    const info = sizeInfo(teams, fields);
    return String(type ? term(type) : tx('archive.sheet', 'Turnierbogen')) + (info ? ' · ' + info : '');
  }
  /* Einheitliche Kurzangabe fuer die Ueberschrift: "12 Teams · 6 Felder". */
  function sizeInfo(teams, fields) {
    const parts = [];
    if (+teams > 0) parts.push(tx('archive.teams', '{count} Teams', { count: teams }));
    if (+fields > 0) parts.push(tx('archive.fields', { one: '{count} Feld', other: '{count} Felder' }, { count: +fields }));
    return parts.join(' · ');
  }

  /* ------------------------------------------------------- Persistenz
     Alles Turnier-/Archivbezogene liegt in IndexedDB (TStore). Jede
     Operation läuft in GENAU EINER TStore.transaction(): Archivieren, Leeren,
     Wiederherstellen und Index-Pflege sind dadurch atomar – schlägt ein Teil
     fehl, bleibt der vorherige Stand vollständig erhalten. Die *InView-
     Varianten sind synchron und für eigene Transaktionen der Aufrufer. */
  function store() {
    const s = root.TStore || (typeof require === 'function' ? require('./turnier-store.js') : null);
    if (!s || typeof s.transaction !== 'function') throw new Error('TArchive: TStore fehlt.');
    return s;
  }
  function idle() {
    const s = store();
    return (typeof s.whenIdle === 'function') ? s.whenIdle() : Promise.resolve(true);
  }
  function has(obj, key) { return Object.prototype.hasOwnProperty.call(obj, key); }
  function readIndexInView(view) {
    try {
      const v = JSON.parse(view.getItem(INDEX_KEY) || '{}');
      return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    } catch (e) { return {}; }
  }
  function writeIndexInView(view, index) { view.setItem(INDEX_KEY, JSON.stringify(index)); }
  function liveSheetOf(key) {
    return (typeof key === 'string' && key.indexOf(LIVE_PREFIX) === 0) ? key.slice(LIVE_PREFIX.length) : null;
  }
  /* Revision des laufenden Datensatzes (0, wenn nicht vorhanden/ungültig). */
  function liveRevisionInView(view, sheet) {
    return store().revisionInView(view, sheet);
  }
  /* Andere Tabs benachrichtigen (nur Signal, keine Daten – siehe TStore). */
  function notifyTabs(sheets) {
    let ls = null;
    try { ls = (typeof localStorage !== 'undefined') ? localStorage : null; } catch (e) { ls = null; }
    if (!ls) return;
    const key = (root.TStore && root.TStore.SYNC_KEY) || 'beachl.sync';
    (sheets || []).forEach(sheet => {
      if (!sheet) return;
      try { ls.setItem(key, JSON.stringify({ sheetId: sheet, at: Date.now() })); } catch (e) { }
    });
  }
  function isInvalidLive(key, raw) {
    const sheet = liveSheetOf(key);
    if (sheet == null) return false;
    try {
      const data = JSON.parse(raw);
      return !data || data.schema !== SCHEMA || data.sheet !== sheet;
    } catch (e) { return true; }
  }

  /* Sammelt die vorhandenen Werte der übergebenen Speicher-Schlüssel. */
  function snapshotInView(view, keys) {
    const out = {};
    (keys || []).forEach(k => {
      const v = view.getItem(k);
      if (v != null) out[k] = v;
    });
    return out;
  }
  /* → Promise<{ key: string }>; wartet auf laufende Speichervorgänge,
     damit der Schnappschuss die letzte Eingabe enthält. */
  function snapshot(keys) {
    return idle().then(() => store().transaction(view => snapshotInView(view, keys)));
  }

  /* Archiviert den aktuellen Stand eines Bogens in einer laufenden
     Transaktion. opts: { sheet, file, type, keys, title, teams, empty }
     Rückgabe: Archivschlüssel oder null, wenn nichts zu sichern war. */
  function saveInView(view, opts, now) {
    const o = opts || {};
    if (o.empty) return null;           // leeres Turnier muss nicht gesichert werden
    const data = snapshotInView(view, o.keys);
    if (!Object.keys(data).length) return null;

    const savedAt = now || Date.now();
    const base = ARCHIVE_PREFIX + (o.sheet || 'turnier') + '.' + savedAt;
    let key = base, n = 1;
    while (view.getItem(key) != null) key = base + '-' + (n++);
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
    view.setItem(key, JSON.stringify(stored));

    const index = readIndexInView(view);
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
    writeIndexInView(view, index);
    return key;
  }
  /* → Promise<Archivschlüssel|null>; verwirft bei Speicherfehlern (reject). */
  function save(opts) {
    return idle().then(() => store().transaction(view => saveInView(view, opts)));
  }

  /* Schreibt einen rohen Schlüssel/Wert-Schnappschuss (siehe snapshot()) in
     den laufenden Speicher. Turnierdatensätze (beachl.t.*) erhalten eine
     Revision OBERHALB der bisherigen, damit veraltete Tabs den neuen Stand
     nicht überschreiben (TStore.save meldet dann "conflict"). baseRevisions
     erlaubt, Revisionen zu berücksichtigen, die vorher in derselben
     Transaktion entfernt wurden. */
  function writeSnapshotInView(view, data, savedAt, baseRevisions) {
    const S = store();
    const index = readIndexInView(view);
    let indexChanged = false;
    const sheets = [];
    Object.keys(data || {}).forEach(key => {
      let value = data[key];
      const sheet = liveSheetOf(key);
      if (sheet) {
        const parsed = S.parseRecord(value, sheet);
        if (parsed.ok) {
          const t = parsed.data;
          const prior = Math.max(liveRevisionInView(view, sheet),
            (baseRevisions && Number(baseRevisions[sheet])) || 0);
          t._revision = Math.max(prior, Number(t._revision) || 0) + 1;
          if (!t.updated) t.updated = new Date(savedAt || Date.now()).toISOString();
          value = JSON.stringify(t);
          index[sheet] = S.indexEntry(t);
          indexChanged = true;
          sheets.push(sheet);
        }
      }
      view.setItem(key, value);
    });
    if (indexChanged) writeIndexInView(view, index);
    return sheets;
  }
  /* → Promise<true>; reject bei Speicherfehlern. */
  function writeSnapshot(data) {
    return store().transaction(view => writeSnapshotInView(view, data))
      .then(sheets => { notifyTabs(sheets); return true; });
  }

  function metaInView(view, key) {
    if (!key) return null;
    try {
      const v = JSON.parse(view.getItem(key) || 'null');
      return (v && v.data && typeof v.data === 'object') ? v : null;
    } catch (e) { return null; }
  }
  function meta(key) {
    if (!key) return Promise.resolve(null);
    return store().transaction(view => metaInView(view, key));
  }

  function removeInView(view, key) {
    if (!key) return false;
    const existed = view.getItem(key) != null;
    view.removeItem(key);
    const index = readIndexInView(view);
    if (index[ARCHIVES_KEY] && has(index[ARCHIVES_KEY], key)) {
      delete index[ARCHIVES_KEY][key];
      if (!Object.keys(index[ARCHIVES_KEY]).length) delete index[ARCHIVES_KEY];
      writeIndexInView(view, index);
    }
    return existed;
  }
  function remove(key) {
    if (!key) return Promise.resolve(false);
    return store().transaction(view => removeInView(view, key));
  }

  /* Holt ein archiviertes Turnier in den laufenden Zustand zurück (der
     Archiveintrag wird aufgelöst, weil das Turnier wieder "live" ist). */
  function restoreInView(view, key, baseRevisions) {
    const m = metaInView(view, key);
    if (!m) return null;
    writeSnapshotInView(view, m.data, m.savedAt, baseRevisions);
    removeInView(view, key);
    return m;
  }
  /* → Promise<Archiv-Metadaten|null> */
  function restore(key) {
    return idle().then(() => store().transaction(view => restoreInView(view, key)))
      .then(m => { if (m) notifyTabs([m.sheet]); return m; });
  }

  /* Löscht die laufenden Daten eines Bogens. Liefert die Revisionen der
     entfernten Turnierdatensätze (für monotones Weiterzählen). */
  function clearLiveInView(view, keys, sheet) {
    const revisions = {};
    (keys || []).forEach(k => {
      const s = liveSheetOf(k);
      if (s) {
        revisions[s] = liveRevisionInView(view, s);
        view.setItem(store().REVISION_PREFIX + s, String(revisions[s]));
      }
      view.removeItem(k);
    });
    if (sheet) {
      view.setItem(store().REVISION_PREFIX + sheet, String(liveRevisionInView(view, sheet)));
      const index = readIndexInView(view);
      if (has(index, sheet)) {
        delete index[sheet];
        writeIndexInView(view, index);
      }
    }
    return revisions;
  }
  function clearLive(keys, sheet) {
    return idle().then(() => store().transaction(view => { clearLiveInView(view, keys, sheet); return true; }));
  }

  /* Archiviert den laufenden Stand, wenn er nicht leer ist ODER ungültige
     Turnierdaten enthält (die sonst beim Leeren verloren gingen). */
  function nonEmpty(v) {
    if (Array.isArray(v)) return v.length > 0;
    return !!(v && typeof v === 'object' && Object.keys(v).length);
  }
  /* Enthält ein gültiger Turnierdatensatz Eingaben? (Maßgeblich ist der
     gespeicherte Stand – nicht die evtl. veraltete Sicht des Bogens.) */
  function liveHasContent(key, raw) {
    if (liveSheetOf(key) == null) return false;
    try {
      const t = JSON.parse(raw);
      return !!t && ['results', 'teamNames', 'fieldNames', 'frozen', 'absent',
        'manualStandings', 'manualPlacements', 'round1'].some(f => nonEmpty(t[f]));
    } catch (e) { return false; }
  }
  function archiveCurrentInView(view, opts) {
    const o = opts || {};
    const live = snapshotInView(view, o.keys);
    const mustKeep = Object.keys(live).some(k => isInvalidLive(k, live[k]) || liveHasContent(k, live[k]));
    return saveInView(view, Object.assign({}, o, { empty: !!o.empty && !mustKeep }));
  }

  /* Übernimmt einen fremden Schnappschuss (geteilter Link) atomar: bisherigen
     Stand archivieren, Schnappschuss schreiben, Index pflegen.
     → Promise<{ archived }>; reject bei ungültigen Daten/Speicherfehlern. */
  function importSnapshot(opts, data) {
    const S = store();
    const keys = Object.keys(data || {});
    const invalid = function () {
      const err = new Error(tx('archive.invalidSnapshot', 'Der Link enthält keine gültigen Turnierdaten.'));
      err.code = 'invalid-snapshot';
      return Promise.reject(err);
    };
    if (!data || typeof data !== 'object' || !keys.length) return invalid();
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i], v = data[k];
      const sheet = liveSheetOf(k);
      const allowed = typeof v === 'string' && (sheet
        ? ((!opts || !opts.sheet || opts.sheet === sheet) && S.parseRecord(v, sheet).ok)
        : (S.isKnownKey(k) && k.indexOf('beachl.') !== 0 && k !== S.SESSIONS_KEY));
      if (!allowed) return invalid();
    }
    return idle().then(() => S.transaction(view => {
      const archived = archiveCurrentInView(view, opts);
      const sheets = writeSnapshotInView(view, data);
      return { archived: archived, sheets: sheets };
    })).then(res => { notifyTabs(res.sheets); return res; });
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

  /* Kompletter Ablauf beim Öffnen eines Bogens: liegt ein Restore an, wird –
     in EINER Transaktion – der aktuelle Stand archiviert, die laufenden Daten
     geleert und das gewählte Turnier (mit weitergezählter Revision)
     zurückgeholt. → Promise<Archiv-Metadaten|null>. Bei Speicherfehlern wird
     verworfen (reject); der ?restore=-Parameter bleibt dann für einen
     erneuten Versuch stehen, am Speicher hat sich nichts geändert. */
  function applyPendingRestore(opts) {
    const key = pendingRestore();
    if (!key) return Promise.resolve(null);
    const o = opts || {};
    return idle().then(() => store().transaction(view => {
      const m = metaInView(view, key);
      if (!m || (o.sheet && m.sheet && m.sheet !== o.sheet)) return null;
      archiveCurrentInView(view, o);
      const revisions = clearLiveInView(view, o.keys, o.sheet);
      return restoreInView(view, key, revisions);
    })).then(restored => {
      clearPendingParam();
      if (restored) notifyTabs([o.sheet || restored.sheet]);
      return restored;
    });
  }

  /* "Neues Turnier": bisheriges sichern und laufende Daten leeren – atomar.
     Schlägt das Archivieren fehl, bleibt ALLES unverändert (blocked:true).
     opts.fresh (optional): function(title) → neues Turnierobjekt; wird in
     derselben Transaktion mit weitergezählter Revision gespeichert und als
     result.tournament geliefert (schützt vor veralteten Tabs).
     → Promise<{ archived, title, blocked, tournament?, error? }> (nie reject) */
  function startNew(opts) {
    const o = opts || {};
    const title = newTitle(o.type);
    const S = (function () { try { return store(); } catch (e) { return null; } })();
    if (!S) return Promise.resolve({ archived: null, title: title, blocked: true, error: new Error('TStore fehlt') });
    return idle().then(() => S.transaction(view => {
      const archived = archiveCurrentInView(view, o);
      const revisions = clearLiveInView(view, o.keys, o.sheet);
      let tournament = null;
      if (typeof o.fresh === 'function' && o.sheet) {
        tournament = o.fresh(title);
        if (tournament) {
          /* Revision zählt über die bisherige hinaus weiter: ein veralteter
             Tab mit dem alten Stand bekommt beim Speichern "conflict". */
          const candidate = Object.assign({}, tournament, {
            schema: SCHEMA,
            sheet: o.sheet,
            updated: new Date().toISOString(),
            _revision: Math.max(revisions[o.sheet] || 0, liveRevisionInView(view, o.sheet)) + 1
          });
          view.setItem(LIVE_PREFIX + o.sheet, JSON.stringify(candidate));
          S.updateIndexInView(view, candidate);
          tournament = candidate;
        }
      }
      return { archived: archived, title: title, blocked: false, tournament: tournament };
    })).then(res => {
      notifyTabs([o.sheet]);
      if (res.archived && root && typeof root.dispatchEvent === 'function' && typeof root.CustomEvent === 'function') {
        root.dispatchEvent(new root.CustomEvent('beachl:tournament-archived', {
          detail: { key: res.archived, file: o.file || '', sheet: o.sheet || '' }
        }));
      }
      return res;
    }, err => ({ archived: null, title: title, blocked: true, error: err }));
  }

  return {
    ARCHIVE_PREFIX, INDEX_KEY, ARCHIVES_KEY,
    newTitle, isAutoTitle, docTitle, headTitle, headTitleHtml, barTitle, sizeInfo, restoreUrl,
    pendingRestore, clearPendingParam,
    // async (Promise) – IndexedDB über TStore.transaction
    snapshot, save, writeSnapshot, meta, restore, remove, clearLive,
    applyPendingRestore, startNew, importSnapshot,
    // synchron, für eigene TStore.transaction()-Callbacks
    snapshotInView, saveInView, writeSnapshotInView, metaInView, removeInView,
    restoreInView, clearLiveInView, archiveCurrentInView
  };
});
