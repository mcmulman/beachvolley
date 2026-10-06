/* ============================================================================
   turnier-store.js – Persistenz und Schema-Migration

   Ein einziges, versioniertes Schema für ALLE Turnierbögen.

   Speicher: IndexedDB ist maßgeblich (Datenbank DB_NAME, EIN generischer
   Key/Value-Objektspeicher KV_STORE; Schlüssel wie früher im localStorage,
   Werte als JSON-Strings). Beim Anlegen der Datenbank werden alle bekannten
   localStorage-Schlüssel (Turniere, Vorversionen, Quarantäne, Archive, Index
   inkl. Archiv-Metadaten) einmalig übernommen – die Originale bleiben
   unangetastet. Es gibt KEINEN stillen Schreib-Rückfall auf localStorage:
   Ist IndexedDB blockiert/nicht verfügbar, wird ein Fehler gemeldet,
   gespeicherte Stände bleiben lesbar, Speichern liefert aber false.

   Alle speicherbezogenen Funktionen sind asynchron (Promise). Die reinen
   Hilfsfunktionen (setScore, normalize …) bleiben synchron.
   Kein DOM-Zugriff außer Events/localStorage(lesen)/IndexedDB.
   ========================================================================== */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TStore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const SCHEMA = 2;
  const PREFIX = 'beachl.t.';          // + sheetId
  const BACKUP_PREFIX = 'beachl.b.';   // + sheetId, previous valid revision
  const REVISION_PREFIX = 'beachl.r.'; // revision high-water mark, also survives corrupt records
  const QUARANTINE_PREFIX = 'beachl.q.'; // + sheetId + '.' + Zeitstempel
  const ARCHIVE_PREFIX = 'beachl.arch.';
  const INDEX_KEY = 'beachl.index';    // Übersicht für die Startseite
  const SESSIONS_KEY = 'beachl_sessions';
  const SYNC_KEY = 'beachl.sync';      // nur Tab-Benachrichtigung, keine Daten
  const DB_NAME = 'beachl';
  const DB_VERSION = 1;
  const KV_STORE = 'kv';

  function storageEvent(name, detail) {
    if (name === 'beachl:storage-saved') {
      delete failedSheets[detail.sheetId];
      delete failedSheets[null];
    }
    if (!root || typeof root.dispatchEvent !== 'function') return;
    let event;
    try {
      event = new root.CustomEvent(name, { detail: detail });
    } catch (e) {
      if (!root.document || !root.document.createEvent) return;
      event = root.document.createEvent('Event');
      event.initEvent(name, false, false);
      event.detail = detail;
    }
    root.dispatchEvent(event);
  }
  function storageIssue(code, sheetId) {
    failedSheets[sheetId] = true;
    const detail = { code: code, sheetId: sheetId };
    if (root) {
      root.__BL_PENDING_STORAGE_ISSUES__ = root.__BL_PENDING_STORAGE_ISSUES__ || [];
      root.__BL_PENDING_STORAGE_ISSUES__.push(detail);
    }
    storageEvent('beachl:storage-error', detail);
  }
  if (root && typeof root.addEventListener === 'function') {
    root.addEventListener('storage', function (event) {
      if (!event.key) return;
      if (event.key === SYNC_KEY) {
        let info = null;
        try { info = JSON.parse(event.newValue || 'null'); } catch (e) { info = null; }
        if (info && typeof info.sheetId === 'string') {
          storageEvent('beachl:storage-external-change', { sheetId: info.sheetId });
        }
        return;
      }
      if (event.key.indexOf(PREFIX) !== 0) return;
      storageEvent('beachl:storage-external-change', {
        sheetId: event.key.slice(PREFIX.length)
      });
    });
    /* Ausstehende Speichervorgänge schützen: Seite nicht ohne Rückfrage verlassen. */
    root.addEventListener('beforeunload', function (event) {
      if (!pendingCount && !activityCount && !Object.keys(failedSheets).length) return;
      if (event.preventDefault) event.preventDefault();
      event.returnValue = '';
      return '';
    });
  }

  /* ------------------------------------------------------ Schlüssel/Views */
  function legacyStorage() {
    try { return (typeof localStorage !== 'undefined') ? localStorage : null; }
    catch (e) { return null; }
  }
  function readJSON(view, key, fallback) {
    if (!view) return fallback;
    try { const v = view.getItem(key); return v == null ? fallback : JSON.parse(v); }
    catch (e) { return fallback; }
  }
  /* Bekannte, nach IndexedDB zu übernehmende Schlüssel (rein, synchron). */
  function isKnownKey(key) {
    if (typeof key !== 'string') return false;
    if (key === INDEX_KEY || key === SESSIONS_KEY) return true;
    return /^beachl\.(t|b|r|q|arch)\./.test(key);
  }
  /* Basis-IDs der aktuellen Bögen (sheetIdFrom(base), deckungsgleich mit
     STORE_BASE_MAP in index.html). Datensätze anderer Bogen-IDs bleiben
     unverändert gespeichert, erscheinen aber weder im Index noch werden sie
     aus Sicherungen importiert. */
  const SHEET_BASES = ['de-flex', 'flex_rr', 'flex_swiss', 'gruppen-final', 'ko-flex',
    'kingqueen', 'koc', 'mpp', 'runden_rr', 'runden_swiss'];
  function sheetBaseOf(sheetId) {
    if (typeof sheetId !== 'string') return null;
    for (let i = 0; i < SHEET_BASES.length; i++) {
      const base = SHEET_BASES[i];
      if (sheetId === base || sheetId.indexOf(base + '.') === 0) return base;
    }
    return null;
  }
  function isCurrentSheet(sheetId) { return sheetBaseOf(sheetId) !== null; }
  /* Entfernt Indexzeilen nicht unterstützter Bogen-IDs (nur Übersichtsdaten;
     die gespeicherten Datensätze selbst bleiben unangetastet). Archivzeilen
     ohne eigene Bogen-ID werden über den gespeicherten Archiv-Eintrag geprüft
     und bleiben erhalten, wenn sich keine Bogen-ID ermitteln lässt. */
  function pruneUnsupportedIndex(idx, view) {
    if (!idx || typeof idx !== 'object') return idx;
    Object.keys(idx).forEach(function (name) {
      if (name.indexOf('__') !== 0 && !isCurrentSheet(name)) delete idx[name];
    });
    const archives = idx.__archives;
    if (archives && typeof archives === 'object' && !Array.isArray(archives)) {
      let removed = false;
      Object.keys(archives).forEach(function (key) {
        const row = archives[key];
        let sheet = row && typeof row.sheet === 'string' && row.sheet ? row.sheet : null;
        if (sheet == null && view) {
          const stored = readJSON(view, key, null);
          if (stored && typeof stored.sheet === 'string' && stored.sheet) sheet = stored.sheet;
        }
        if (sheet != null && !isCurrentSheet(sheet)) { delete archives[key]; removed = true; }
      });
      if (removed && !Object.keys(archives).length) delete idx.__archives;
    }
    return idx;
  }
  /* Synchrone, localStorage-ähnliche Sicht auf eine Momentaufnahme.
     data: { key: string }. Änderungen werden in changes protokolliert. */
  function makeView(data, readOnly) {
    const changes = {};
    let closed = false;
    let sorted = null;
    function keys() {
      if (!sorted) sorted = Object.keys(data).sort();
      return sorted;
    }
    function guard() {
      if (closed) throw new Error('TStore.transaction: Sicht ist nach Transaktionsende nicht mehr gültig.');
      if (readOnly) throw new Error('TStore: Speicher ist nur lesbar.');
    }
    const view = {
      getItem: function (key) {
        key = String(key);
        return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
      },
      setItem: function (key, value) {
        guard();
        key = String(key); value = String(value);
        if (!Object.prototype.hasOwnProperty.call(data, key)) sorted = null;
        data[key] = value;
        changes[key] = { value: value };
      },
      removeItem: function (key) {
        guard();
        key = String(key);
        if (!Object.prototype.hasOwnProperty.call(data, key)) return;
        delete data[key];
        sorted = null;
        changes[key] = { remove: true };
      },
      key: function (i) {
        const k = keys()[i];
        return k === undefined ? null : k;
      },
      keys: function () { return keys().slice(); }
    };
    Object.defineProperty(view, 'length', { get: function () { return keys().length; } });
    return {
      view: view,
      changes: changes,
      close: function () { closed = true; }
    };
  }
  /* Nur-Lese-Sicht auf localStorage (Altdaten, wenn IndexedDB ausfällt). */
  function localStorageView() {
    const s = legacyStorage();
    if (!s) return null;
    function readOnly() { throw new Error('TStore: Speicher ist nur lesbar.'); }
    const view = {
      getItem: function (k) { try { return s.getItem(String(k)); } catch (e) { return null; } },
      setItem: readOnly,
      removeItem: readOnly,
      key: function (i) { try { return typeof s.key === 'function' ? s.key(i) : null; } catch (e) { return null; } },
      keys: function () {
        const out = [];
        for (let i = 0; i < view.length; i++) { const k = view.key(i); if (k != null) out.push(k); }
        return out;
      }
    };
    Object.defineProperty(view, 'length', {
      get: function () { try { return typeof s.length === 'number' ? s.length : 0; } catch (e) { return 0; } }
    });
    return view;
  }

  /* ------------------------------------------------------------ IndexedDB */
  function storageError(code, cause) {
    const err = new Error('TStore storage ' + code + (cause && cause.message ? ': ' + cause.message : ''));
    err.code = code;
    err.cause = cause;
    return err;
  }
  function idbFactory() {
    try { return (root && root.indexedDB) ? root.indexedDB : null; }
    catch (e) { return null; }
  }
  function migrateLocalStorage(store) {
    const s = legacyStorage();
    if (!s) return;
    let n = 0;
    try { n = s.length; } catch (e) { return; }
    for (let i = 0; i < n; i++) {
      let key, value;
      try { key = s.key(i); value = key == null ? null : s.getItem(key); }
      catch (e) { continue; }
      if (key == null || value == null || !isKnownKey(key)) continue;
      store.put(String(value), key);
    }
  }
  let dbPromise = null;
  function openDb() {
    if (dbPromise) return dbPromise;
    const p = new Promise(function (resolve, reject) {
      const factory = idbFactory();
      if (!factory) { reject(storageError('unavailable')); return; }
      let req;
      try { req = factory.open(DB_NAME, DB_VERSION); }
      catch (e) { reject(storageError('unavailable', e)); return; }
      let settled = false;
      req.onupgradeneeded = function () {
        const db = req.result;
        const store = db.objectStoreNames.contains(KV_STORE)
          ? req.transaction.objectStore(KV_STORE)
          : db.createObjectStore(KV_STORE);
        migrateLocalStorage(store);
      };
      req.onblocked = function () {
        if (settled) return;
        settled = true;
        reject(storageError('blocked'));
      };
      req.onerror = function (event) {
        if (event && event.preventDefault) event.preventDefault();
        if (settled) return;
        settled = true;
        reject(storageError('unavailable', req.error));
      };
      req.onsuccess = function () {
        const db = req.result;
        if (settled) { try { db.close(); } catch (e) { } return; }
        settled = true;
        db.onversionchange = function () {
          try { db.close(); } catch (e) { }
          if (dbPromise === p) dbPromise = null;
        };
        db.onclose = function () { if (dbPromise === p) dbPromise = null; };
        resolve(db);
      };
    });
    dbPromise = p;
    p.then(null, function () { if (dbPromise === p) dbPromise = null; });
    return p;
  }

  /* Führt EINE IndexedDB-Transaktion aus: liest alle Datensätze, ruft
     callback(view) SYNCHRON auf und schreibt die Änderungen der Sicht im
     selben Vorgang. Promise erfüllt sich erst bei tx.oncomplete. */
  function runTx(db, mode, callback) {
    return new Promise(function (resolve, reject) {
      let tx;
      try { tx = db.transaction(KV_STORE, mode); }
      catch (e) { reject(e); return; }
      const store = tx.objectStore(KV_STORE);
      const data = {};
      let result, failure = null, wrapped = null;
      tx.oncomplete = function () {
        if (wrapped) wrapped.close();
        if (failure) reject(failure); else resolve(result);
      };
      tx.onabort = function () {
        if (wrapped) wrapped.close();
        reject(failure || storageError('write-failed', tx.error));
      };
      tx.onerror = function () { /* onabort folgt */ };
      let cursorReq;
      try { cursorReq = store.openCursor(); }
      catch (e) { failure = storageError('unavailable', e); try { tx.abort(); } catch (x) { } return; }
      cursorReq.onsuccess = function () {
        const cursor = cursorReq.result;
        if (cursor) {
          if (typeof cursor.value === 'string') data[String(cursor.key)] = cursor.value;
          cursor.continue();
          return;
        }
        wrapped = makeView(data, mode !== 'readwrite');
        try {
          result = callback(wrapped.view);
          if (result && typeof result.then === 'function') {
            throw new TypeError('TStore.transaction: callback muss synchron sein.');
          }
        } catch (e) {
          failure = e;
          wrapped.close();
          try { tx.abort(); } catch (x) { }
          return;
        }
        wrapped.close();
        if (mode !== 'readwrite') return;
        try {
          Object.keys(wrapped.changes).forEach(function (key) {
            const c = wrapped.changes[key];
            if (c.remove) store.delete(key); else store.put(c.value, key);
          });
        } catch (e) {
          failure = storageError('write-failed', e);
          try { tx.abort(); } catch (x) { }
        }
      };
    });
  }
  function withDb(mode, callback) {
    return openDb().then(function (db) {
      return runTx(db, mode, callback).then(null, function (err) {
        /* Verbindung zwischenzeitlich geschlossen → einmal neu öffnen */
        if (err && err.name === 'InvalidStateError') {
          if (dbPromise) dbPromise = null;
          return openDb().then(function (db2) { return runTx(db2, mode, callback); });
        }
        throw err;
      });
    });
  }
  /* Öffentliche, atomare Transaktion über ALLE Datensätze.
     callback(view) muss synchron sein; Rückgabewert = Promise-Ergebnis. */
  function transaction(callback, options) {
    if (typeof callback !== 'function') {
      return Promise.reject(new TypeError('TStore.transaction: callback fehlt.'));
    }
    const o = options || {};
    const tracked = o.tracked !== false;
    if (tracked) {
      activityCount++;
      storageEvent('beachl:storage-pending', { sheetId: o.sheetId || null, pending: pendingCount + activityCount });
    }
    let changed = false;
    const sheets = Object.create(null);
    return withDb('readwrite', function (view) {
      const before = Object.create(null);
      view.keys().forEach(function (key) { before[key] = view.getItem(key); });
      const result = callback(view);
      if (result && typeof result.then === 'function') return result;
      Object.keys(before).concat(view.keys()).forEach(function (key) {
        if (key.indexOf(PREFIX) !== 0) return;
        const sheet = key.slice(PREFIX.length);
        const parsed = before[key] == null ? { ok: false } : parseRecord(before[key], sheet);
        const revision = parsed.ok ? Number(parsed.data._revision) || 0 : 0;
        const highWater = Math.max(revision, revisionInView(view, sheet));
        if (highWater > 0 || (before[key] != null && view.getItem(key) == null)
            || view.getItem(REVISION_PREFIX + sheet) != null) {
          view.setItem(REVISION_PREFIX + sheet, String(highWater));
        }
      });
      Object.keys(before).concat(view.keys()).forEach(function (key) {
        if (before[key] === view.getItem(key) || (before[key] === undefined && view.getItem(key) == null)) return;
        changed = true;
        if (key.indexOf(PREFIX) === 0) sheets[key.slice(PREFIX.length)] = true;
        if (key.indexOf(REVISION_PREFIX) === 0) sheets[key.slice(REVISION_PREFIX.length)] = true;
        if (key.indexOf(ARCHIVE_PREFIX) === 0) {
          const archive = readJSON(view, key, null) || (function () {
            try { return JSON.parse(before[key]); } catch (e) { return null; }
          })();
          if (archive && typeof archive.sheet === 'string' && archive.sheet) sheets[archive.sheet] = true;
        }
      });
      return result;
    }).then(function (result) {
      if (tracked) {
        activityCount--;
        if (changed) {
          const ids = Object.keys(sheets);
          if (!ids.length) ids.push(o.sheetId || null);
          ids.forEach(function (sheet) {
            if (sheet != null) notifyTabs(sheet, null);
            storageEvent('beachl:storage-saved', { sheetId: sheet, revision: null });
          });
        }
        resolveIdle();
      }
      return result;
    }, function (err) {
      if (tracked) {
        activityCount--;
        if (o.report !== false) {
          const ids = Object.keys(sheets);
          if (!ids.length) ids.push(o.sheetId || null);
          ids.forEach(function (sheet) { storageIssue(errorCode(err, 'write-failed'), sheet); });
        }
        resolveIdle();
      }
      throw err;
    });
  }
  function readEntries() {
    return withDb('readonly', function (view) {
      return view.keys().map(function (key) { return { key: key, value: view.getItem(key) }; });
    });
  }
  function getItem(key) {
    return withDb('readonly', function (view) { return view.getItem(key); });
  }
  function setItem(key, value) {
    return transaction(function (view) { view.setItem(key, value); return true; });
  }
  function removeItem(key) {
    return transaction(function (view) { view.removeItem(key); return true; });
  }
  /* Öffnet die Datenbank (inkl. einmaliger localStorage-Übernahme). */
  function ready() {
    return openDb().then(function () { return true; });
  }
  function errorCode(err, fallback) {
    return (err && typeof err.code === 'string') ? err.code : fallback;
  }

  /* Erlaubt mehrere unabhängige Turniere DESSELBEN Bogens parallel in
     verschiedenen Tabs: ?id=xyz an die URL anhängen → eigener Speicher-
     Schlüssel "<base>.xyz" statt des geteilten "<base>". Ohne Parameter
     verhält sich der Bogen wie gewohnt (ein gemeinsames Turnier je Datei).
     Sonderfall id=BASE_ID: verweist bewusst auf den unverzweigten "<base>"-
     Schlüssel (siehe turnier-resume-picker.js), damit auch das klassische,
     nicht-mit-id-versehene Turnier über die Auswahl erreichbar bleibt. */
  const BASE_ID = '_base_';
  function sheetIdFrom(base) {
    try {
      const id = new URLSearchParams(location.search).get('id');
      if (!id) return base;
      if (id === BASE_ID) return base;
      return base + '.' + id.replace(/[^A-Za-z0-9_-]/g, '');
    } catch (e) { return base; }
  }

  /* -------------------------------------------------------------- Schema */
  /* Ein Turnier ist EIN Objekt. Ergebnisse liegen immer als drei Satzpaare
     vor – unabhängig vom aktuell gewählten Satzmodus. Dadurch löscht ein
     Moduswechsel niemals Eingaben (siehe AGENTS.md §8.1).                   */
  function emptyTournament(sheetId, cfg) {
    return {
      schema: SCHEMA,
      sheet: sheetId,
      _revision: 0,
      title: '',
      updated: null,
      config: Object.assign({
        teams: 8, fields: 4, groups: 2,
        setMode: '21',
        phaseModes: {},
        rounds: null,
        startTime: '10:00', endTime: '14:00',
        finalMode: 'placement'
      }, cfg || {}),
      teamNames: {},
      fieldNames: {},
      absent: [],
      /* results[matchId] = [[a1,b1],[a2,b2],[a3,b3]] – fehlende Werte null */
      results: {},
      /* eingefrorene, bereits generierte Paarungen (Schweizer System) */
      frozen: {},
      /* eingefrorener Satzmodus je Runde/Phase, sobald Ergebnisse vorliegen */
      frozenModes: {},
      /* Manuelle Korrekturen der Punkte-Tabellen ("Tabelle korrigieren"):
         manualStandings[tableKey][team] = { place?, dPts?, dBd? }
         - place: überschreibt den berechneten Platz direkt (Zeilen sortieren
           sich danach neu).
         - dPts/dBd: Korrektur-DELTA, wird dauerhaft auf den jeweils frisch
           berechneten Wert addiert – bleibt also auch erhalten, wenn sich
           später noch Ergebnisse ändern und neu gerechnet wird.            */
      manualStandings: {},
      /* Manuelle Korrekturen der Endstand-/Platzierungslisten (Pl./Team/
         "entschieden durch", z.B. KO-System oder Gesamt-Endstand):
         manualPlacements[tableKey][team] = { place?, source? }             */
      manualPlacements: {}
    };
  }

  function keyFor(sheetId) { return PREFIX + sheetId; }
  function backupKeyFor(sheetId) { return BACKUP_PREFIX + sheetId; }
  function revisionInView(view, sheetId) {
    let revision = Number(view.getItem(REVISION_PREFIX + sheetId)) || 0;
    [keyFor(sheetId), backupKeyFor(sheetId)].forEach(function (key) {
      const raw = view.getItem(key);
      const parsed = raw == null ? { ok: false } : parseRecord(raw, sheetId);
      if (parsed.ok) revision = Math.max(revision, Number(parsed.data._revision) || 0);
    });
    return revision;
  }

  /* Parst einen gespeicherten Turnier-Datensatz (rein, synchron).
     → { ok:true, data } | { ok:false, code:'corrupt'|'incompatible' } */
  function parseRecord(raw, sheetId) {
    let data;
    try { data = JSON.parse(raw); }
    catch (e) { return { ok: false, code: 'corrupt' }; }
    if (!data || data.schema !== SCHEMA || data.sheet !== sheetId) {
      return { ok: false, code: 'incompatible' };
    }
    return { ok: true, data: data };
  }

  /* --------------------------------------------- synchrone View-Operationen
     Laufen innerhalb EINER Transaktion (siehe transaction()).             */
  function loadInView(view, sheetId, cfgDefaults, writable) {
    let stored = null;
    if (view) {
      try { stored = view.getItem(keyFor(sheetId)); } catch (e) { stored = null; }
    }
    if (stored != null) {
      const parsed = parseRecord(stored, sheetId);
      if (!parsed.ok) return { t: emptyTournament(sheetId, cfgDefaults), issue: parsed.code };
      return { t: normalize(parsed.data, sheetId, cfgDefaults) };
    }
    return { t: emptyTournament(sheetId, cfgDefaults) };
  }

  /* Revisionsprüfung + Vorversion + Datensatz + Index – alles in derselben
     Transaktion. data = Momentaufnahme des Turniers. */
  function saveInView(view, data, sheetId, baseRevision, nowIso) {
    const key = keyFor(sheetId);
    const current = view.getItem(key);
    let currentRevision = 0;
    if (current != null) {
      const parsed = parseRecord(current, sheetId);
      if (!parsed.ok) return { ok: false, code: parsed.code };
      currentRevision = Number(parsed.data._revision) || 0;
      if (currentRevision !== baseRevision) return { ok: false, code: 'conflict' };
    } else if (baseRevision !== 0) {
      return { ok: false, code: 'conflict' };
    }
    const candidate = Object.assign({}, data, {
      schema: SCHEMA,
      sheet: sheetId,
      updated: nowIso,
      _revision: Math.max(currentRevision, revisionInView(view, sheetId)) + 1
    });
    let serialized;
    try { serialized = JSON.stringify(candidate); }
    catch (e) { return { ok: false, code: 'write-failed' }; }
    if (!parseRecord(serialized, sheetId).ok) return { ok: false, code: 'write-failed' };
    if (current != null) view.setItem(backupKeyFor(sheetId), current);
    view.setItem(key, serialized);
    updateIndexInView(view, candidate);
    return { ok: true, revision: candidate._revision, updated: candidate.updated };
  }

  function readIndexInView(view) {
    const idx = readJSON(view, INDEX_KEY, {});
    return (idx && typeof idx === 'object' && !Array.isArray(idx)) ? idx : {};
  }
  function indexEntry(t) {
    return {
      title: t.title || '',
      teams: t.config ? t.config.teams : undefined,
      updated: t.updated,
      filled: Object.keys(t.results || {}).length
    };
  }
  function refreshIndexInView(view) {
    const idx = pruneUnsupportedIndex(readIndexInView(view), view);
    view.keys().forEach(function (key) {
      if (key.indexOf(PREFIX) !== 0) return;
      const sheet = key.slice(PREFIX.length);
      if (!isCurrentSheet(sheet)) return;
      const parsed = parseRecord(view.getItem(key), sheet);
      if (parsed.ok) idx[sheet] = indexEntry(parsed.data);
      else if (!idx[sheet]) idx[sheet] = { title: 'Nicht lesbarer Turnierstand', filled: 0 };
    });
    const serialized = JSON.stringify(idx);
    if (serialized !== view.getItem(INDEX_KEY)) view.setItem(INDEX_KEY, serialized);
    return idx;
  }
  function updateIndexInView(view, t) {
    const idx = readIndexInView(view);
    idx[t.sheet] = indexEntry(t);
    view.setItem(INDEX_KEY, JSON.stringify(idx));
    return idx;
  }

  function notifyTabs(sheetId, revision) {
    const s = legacyStorage();
    if (!s) return;
    try {
      s.setItem(SYNC_KEY, JSON.stringify({ sheetId: sheetId, revision: revision, at: Date.now() }));
    } catch (e) { /* reine Benachrichtigung – Daten liegen in IndexedDB */ }
  }

  /* ------------------------------------------------------- async Persistenz */
  function load(sheetId, cfgDefaults) {
    return transaction(function (view) {
      return loadInView(view, sheetId, cfgDefaults, true);
    }, { tracked: false }).then(function (res) {
      if (res.issue) storageIssue(res.issue, sheetId);
      if (res.saved) notifyTabs(sheetId, res.saved);
      return res.t;
    }, function (err) {
      /* Kein Schreib-Rückfall: Altdaten nur lesen, Fehler melden. */
      storageIssue(errorCode(err, 'unavailable'), sheetId);
      const res = loadInView(localStorageView(), sheetId, cfgDefaults, false);
      if (res.issue) storageIssue(res.issue, sheetId);
      Object.defineProperty(res.t, '_storageBlocked', { value: errorCode(err, 'unavailable') });
      return res.t;
    });
  }

  function normalize(t, sheetId, cfgDefaults) {
    const base = emptyTournament(sheetId, cfgDefaults);
    const out = Object.assign(base, t);
    out._revision = Number.isFinite(Number(t._revision)) ? Number(t._revision) : 0;
    out.config = Object.assign(base.config, t.config || {});
    out.teamNames = t.teamNames || {};
    out.fieldNames = t.fieldNames || {};
    out.absent = Array.isArray(t.absent) ? t.absent : [];
    out.results = t.results || {};
    out.frozen = t.frozen || {};
    out.frozenModes = t.frozenModes || {};
    out.manualStandings = t.manualStandings || {};
    out.manualPlacements = t.manualPlacements || {};
    return out;
  }

  /* Speicher-Warteschlange je Turnierobjekt: Ein laufender Schreibvorgang
     wird nie überholt; weitere save()-Aufrufe währenddessen werden zu EINER
     Momentaufnahme (der neuesten) zusammengefasst. Eingaben, die während
     eines laufenden Schreibvorgangs erfolgen, bleiben im Objekt erhalten –
     nach Erfolg werden nur schema/_revision/updated übernommen. */
  const saveQueues = (typeof WeakMap === 'function') ? new WeakMap() : null;
  let pendingCount = 0;
  let activityCount = 0;
  const failedSheets = Object.create(null);
  const pendingBySheet = {};
  const idleWaiters = [];
  function pendingChanged(sheetId, delta) {
    pendingCount += delta;
    pendingBySheet[sheetId] = (pendingBySheet[sheetId] || 0) + delta;
    if (pendingBySheet[sheetId] <= 0) delete pendingBySheet[sheetId];
    if (delta > 0) {
      storageEvent('beachl:storage-pending', { sheetId: sheetId, pending: pendingCount });
    }
    resolveIdle();
  }
  function resolveIdle() {
    if (!pendingCount && !activityCount) {
      idleWaiters.splice(0).forEach(function (fn) { fn(true); });
    }
  }
  function isPending(sheetId) {
    return sheetId == null ? pendingCount + activityCount > 0 : !!pendingBySheet[sheetId] || activityCount > 0;
  }
  function whenIdle() {
    if (!pendingCount && !activityCount) return Promise.resolve(true);
    return new Promise(function (resolve) { idleWaiters.push(resolve); });
  }

  function snapshotOf(t) {
    return JSON.parse(JSON.stringify(t));
  }
  function executeSave(t, job) {
    const sheetId = job.sheetId;
    const baseRevision = Number(t._revision) || 0;
    const nowIso = new Date().toISOString();
    return transaction(function (view) {
      return saveInView(view, job.data, sheetId, baseRevision, nowIso);
    }, { tracked: false }).then(function (res) {
      pendingChanged(sheetId, -1);
      if (!res.ok) { storageIssue(res.code, sheetId); return false; }
      t.schema = SCHEMA;
      t._revision = res.revision;
      t.updated = res.updated;
      notifyTabs(sheetId, res.revision);
      storageEvent('beachl:storage-saved', { sheetId: sheetId, revision: res.revision });
      return true;
    }, function (err) {
      pendingChanged(sheetId, -1);
      storageIssue(errorCode(err, 'write-failed'), sheetId);
      return false;
    });
  }
  function save(t) {
    if (!t || typeof t !== 'object' || typeof t.sheet !== 'string') {
      return Promise.resolve(false);
    }
    const sheetId = t.sheet;
    if (t._storageBlocked) {
      storageIssue(t._storageBlocked, sheetId);
      return Promise.resolve(false);
    }
    let data;
    try { data = snapshotOf(t); }
    catch (e) {
      storageIssue('write-failed', sheetId);
      return Promise.resolve(false);
    }
    let q = saveQueues ? saveQueues.get(t) : null;
    if (!q) {
      q = { running: null, next: null };
      if (saveQueues) saveQueues.set(t, q);
    }
    if (q.next) {
      q.next.data = data;              // neueste Momentaufnahme gewinnt
      return q.next.promise;
    }
    const job = { sheetId: sheetId, data: data, promise: null };
    pendingChanged(sheetId, 1);
    const start = function () {
      if (q.next === job) q.next = null;
      return executeSave(t, job);
    };
    if (q.running) {
      q.next = job;
      job.promise = q.running.then(start, start);
    } else {
      job.promise = start();
    }
    const finished = job.promise.then(function (ok) {
      if (q.running === finished) q.running = null;
      return ok;
    });
    q.running = finished;
    job.promise = finished;
    return finished;
  }

  function reset(sheetId) {
    return transaction(function (view) {
      const current = view.getItem(keyFor(sheetId));
      if (current != null) {
        const parsed = parseRecord(current, sheetId);
        if (!parsed.ok) return { ok: false, code: parsed.code };
        if (view.getItem(backupKeyFor(sheetId)) == null) view.setItem(backupKeyFor(sheetId), current);
        view.removeItem(keyFor(sheetId));
      }
      view.setItem(REVISION_PREFIX + sheetId, String(Math.max(revisionInView(view, sheetId),
        current == null ? 0 : Number(parseRecord(current, sheetId).data._revision) || 0)));
      const idx = readIndexInView(view);
      if (Object.prototype.hasOwnProperty.call(idx, sheetId)) {
        delete idx[sheetId];
        view.setItem(INDEX_KEY, JSON.stringify(idx));
      }
      return { ok: true, changed: current != null };
    }, { sheetId: sheetId, report: false }).then(function (res) {
      if (!res.ok) { storageIssue(res.code, sheetId); return false; }
      if (res.changed) notifyTabs(sheetId, 0);
      return true;
    }, function (err) {
      storageIssue(errorCode(err, 'write-failed'), sheetId);
      return false;
    });
  }

  function hasBackupInView(view, sheetId) {
    const raw = view ? view.getItem(backupKeyFor(sheetId)) : null;
    return raw != null && parseRecord(raw, sheetId).ok;
  }
  function hasBackup(sheetId) {
    return withDb('readonly', function (view) {
      return hasBackupInView(view, sheetId);
    }).then(null, function () {
      return hasBackupInView(localStorageView(), sheetId);
    });
  }

  /* Stellt die Vorversion wieder her. Der aktuelle Stand wird vorher unter
     beachl.q.<sheet>.<zeit> aufbewahrt. Die Revision wird weitergezählt,
     damit veraltete Tabs den wiederhergestellten Stand nicht überschreiben. */
  function restorePrevious(sheetId) {
    const stamp = Date.now();
    return transaction(function (view) {
      const previous = view.getItem(backupKeyFor(sheetId));
      const current = view.getItem(keyFor(sheetId));
      const parsedPrev = previous == null ? { ok: false } : parseRecord(previous, sheetId);
      if (!parsedPrev.ok) return { ok: false, code: 'backup-corrupt' };
      let currentRevision = revisionInView(view, sheetId);
      if (current != null) {
        const parsedCur = parseRecord(current, sheetId);
        if (parsedCur.ok) currentRevision = Math.max(currentRevision, Number(parsedCur.data._revision) || 0);
        let qKey = QUARANTINE_PREFIX + sheetId + '.' + stamp;
        let n = 1;
        while (view.getItem(qKey) != null) qKey = QUARANTINE_PREFIX + sheetId + '.' + stamp + '-' + (n++);
        view.setItem(qKey, current);
      }
      const restored = parsedPrev.data;
      restored._revision = Math.max(currentRevision, Number(restored._revision) || 0) + 1;
      view.setItem(keyFor(sheetId), JSON.stringify(restored));
      updateIndexInView(view, restored);
      return { ok: true, revision: restored._revision };
    }, { sheetId: sheetId, report: false }).then(function (res) {
      if (!res.ok) { storageIssue(res.code, sheetId); return false; }
      notifyTabs(sheetId, res.revision);
      return true;
    }, function (err) {
      storageIssue(errorCode(err, 'write-failed'), sheetId);
      return false;
    });
  }

  function updateIndex(t) {
    if (!t || !t.sheet) return Promise.resolve(false);
    return transaction(function (view) {
      updateIndexInView(view, t);
      return true;
    }).then(null, function (err) {
      storageIssue(errorCode(err, 'index-failed'), t.sheet);
      return false;
    });
  }
  function index() {
    return transaction(refreshIndexInView, { tracked: false }).then(null, function (err) {
      storageIssue(errorCode(err, 'unavailable'), null);
      const view = localStorageView();
      return pruneUnsupportedIndex(readIndexInView(view), view);
    });
  }

  /* ---------------------------------------------------------- Ergebnisse */
  /* Setzt ein einzelnes Satzergebnis, ohne andere Sätze anzutasten. */
  function setScore(t, matchId, setNo, side, value) {
    const r = t.results[matchId] || [[null, null], [null, null], [null, null]];
    while (r.length < 3) r.push([null, null]);
    const v = (value === '' || value == null) ? null : parseInt(value, 10);
    r[setNo - 1][side === 'a' ? 0 : 1] = Number.isFinite(v) ? v : null;
    const any = r.some(p => p[0] != null || p[1] != null);
    if (any) t.results[matchId] = r; else delete t.results[matchId];
    return t;
  }
  function getSets(t, matchId) {
    return t.results[matchId] || [[null, null], [null, null], [null, null]];
  }
  /* Löscht NUR die Ergebnisse, nicht Namen/Konfiguration. */
  function clearScores(t) { t.results = {}; return t; }

  /* ----------------------------------------------- Manuelle Korrekturen
     Punkte-Tabellen (Gruppen-/Haupt-/Endtabelle). field ∈ {place,dPts,dBd}.
     value = null/'' löscht die Korrektur für genau dieses Feld wieder.       */
  function setManualStanding(t, tableKey, team, field, value) {
    t.manualStandings = t.manualStandings || {};
    const tbl = t.manualStandings[tableKey] = t.manualStandings[tableKey] || {};
    const row = tbl[team] = tbl[team] || {};
    const v = (value === '' || value == null) ? null : Number(value);
    if (v == null || !Number.isFinite(v) || (field !== 'place' && v === 0)) delete row[field];
    else row[field] = v;
    if (!Object.keys(row).length) delete tbl[team];
    if (!Object.keys(tbl).length) delete t.manualStandings[tableKey];
    return t;
  }
  function getManualStandings(t, tableKey) {
    return (t.manualStandings && t.manualStandings[tableKey]) || {};
  }
  function resetManualStandingRow(t, tableKey, team) {
    if (t.manualStandings && t.manualStandings[tableKey]) {
      delete t.manualStandings[tableKey][team];
      if (!Object.keys(t.manualStandings[tableKey]).length) delete t.manualStandings[tableKey];
    }
    return t;
  }
  function resetManualStandings(t, tableKey) {
    if (t.manualStandings) delete t.manualStandings[tableKey];
    return t;
  }

  /* ----------------------------------------------- Manuelle Korrekturen
     Platzierungslisten (Pl./Team/"entschieden durch"). field ∈ {place,source}. */
  function setManualPlacement(t, tableKey, team, field, value) {
    t.manualPlacements = t.manualPlacements || {};
    const tbl = t.manualPlacements[tableKey] = t.manualPlacements[tableKey] || {};
    const row = tbl[team] = tbl[team] || {};
    if (value === '' || value == null) delete row[field];
    else row[field] = (field === 'place') ? Number(value) : String(value);
    if (!Object.keys(row).length) delete tbl[team];
    if (!Object.keys(tbl).length) delete t.manualPlacements[tableKey];
    return t;
  }
  function getManualPlacements(t, tableKey) {
    return (t.manualPlacements && t.manualPlacements[tableKey]) || {};
  }
  function resetManualPlacementRow(t, tableKey, team) {
    if (t.manualPlacements && t.manualPlacements[tableKey]) {
      delete t.manualPlacements[tableKey][team];
      if (!Object.keys(t.manualPlacements[tableKey]).length) delete t.manualPlacements[tableKey];
    }
    return t;
  }
  function resetManualPlacements(t, tableKey) {
    if (t.manualPlacements) delete t.manualPlacements[tableKey];
    return t;
  }

  /* ------------------------------------------------------- Team löschen
     Ein Team (bzw. bei King/Queen ein Spieler) wird endgültig entfernt:
     alle Nummern dahinter rücken um 1 nach vorn. Ergebnisse werden nicht
     über Spiel-IDs (die verschieben sich), sondern über die Begegnung
     (Phase + Teampaar) gesichert und nach dem Neuaufbau wieder eingesetzt.
     ------------------------------------------------------------------- */
  function teamRemap(removed) {
    removed = +removed;
    return x => {
      x = +x;
      if (!Number.isFinite(x) || x === removed) return null;
      return x > removed ? x - 1 : x;
    };
  }
  function remapKeys(obj, map) {
    const out = {};
    Object.keys(obj || {}).forEach(k => {
      const n = map(+k);
      if (n != null) out[n] = obj[k];
    });
    return out;
  }
  function remapList(arr, map) {
    return (arr || []).map(x => map(+x)).filter(x => x != null);
  }
  /* teamNames, absent und manuelle Korrekturen; extraKeys = weitere
     Objekte, die per Teamnummer verschlüsselt sind (z. B. teamGender). */
  function remapCommon(t, map, extraKeys) {
    t.teamNames = remapKeys(t.teamNames, map);
    t.absent = remapList(t.absent, map);
    ['manualStandings', 'manualPlacements'].forEach(f => {
      const o = t[f] || {};
      Object.keys(o).forEach(k => {
        o[k] = remapKeys(o[k], map);
        if (!Object.keys(o[k]).length) delete o[k];
      });
      t[f] = o;
    });
    (extraKeys || []).forEach(k => { if (t[k]) t[k] = remapKeys(t[k], map); });
    return t;
  }
  /* Feste Paarungslisten (Schweizer Runden, Startrunde): Paare mit dem
     gelöschten Team entfallen; übrig gebliebene Teams (Partner + bisheriges
     Freilos) werden neu gepaart. Bei gerader Teamzahl bleibt so kein
     Freilos übrig, bei ungerader genau eins.                              */
  function repairPairs(pairs, map, allTeams) {
    const out = [];
    const used = new Set();
    (pairs || []).forEach(p => {
      const a = map(p[0]), b = map(p[1]);
      if (a == null || b == null) return;
      out.push([a, b]); used.add(a); used.add(b);
    });
    const left = (allTeams || []).filter(x => !used.has(x));
    for (let i = 0; i + 1 < left.length; i += 2) out.push([left[i], left[i + 1]]);
    return out;
  }
  /* Phase einer Spiel-ID: Begegnungen werden nur innerhalb derselben Phase
     wiedererkannt (ein Gruppenspiel A–B ist kein Finale A–B).            */
  function matchPhase(id) {
    id = String(id);
    let m;
    if ((m = /^g([A-Z]+)_/.exec(id))) return 'g';
    if ((m = /^(kq|koc)_r(\d+)/.exec(id))) return m[1] + m[2];
    if ((m = /^de_(wb|lb|gf)/.exec(id))) return 'de_' + m[1];
    if ((m = /^h([A-Za-z]+)_/.exec(id))) return 'h' + m[1];
    if ((m = /^([a-z]+)/i.exec(id))) return m[1];
    return id;
  }
  function sideKey(x) {
    return Array.isArray(x) ? x.map(Number).sort((a, b) => a - b).join('+') : String(x);
  }
  function mapSide(x, map) {
    if (x == null) return null;
    if (Array.isArray(x)) {
      const m = x.map(v => map(+v));
      return m.some(v => v == null) ? null : m;
    }
    return map(+x);
  }
  function hasInput(r) {
    if (!Array.isArray(r)) return false;
    return r.some(s => Array.isArray(s)
      ? s.some(x => x != null && x !== '')
      : (s != null && s !== ''));
  }
  function swapResult(r) {
    if (!Array.isArray(r)) return r;
    if (r.some(s => Array.isArray(s))) return r.map(s => Array.isArray(s) ? [s[1], s[0]] : s);
    return [r[1], r[0]];
  }
  /* matches: [{id, a, b}] in ALTER Nummerierung (a/b = Teamnummer oder
     Spieler-Array). Liefert die gesicherten Ergebnisse in NEUER Nummerierung. */
  function snapshotResults(t, matches, map, phaseOf) {
    const ph = phaseOf || matchPhase;
    const out = [];
    const seen = new Set();
    (matches || []).forEach(m => {
      if (!m || seen.has(m.id)) return;
      seen.add(m.id);
      const r = t.results && t.results[m.id];
      if (!hasInput(r)) return;
      const a = mapSide(m.a, map), b = mapSide(m.b, map);
      if (a == null || b == null) return;
      out.push({ phase: ph(m.id), a: sideKey(a), b: sideKey(b),
        r: JSON.parse(JSON.stringify(r)), used: false });
    });
    return out;
  }
  /* getMatches() baut den Bogen mit dem aktuellen t.results neu auf und
     liefert [{id, a, b}] in neuer Nummerierung. Mehrere Durchläufe, weil
     Final-/KO-Spiele erst feststehen, wenn die Vorrunde wieder eingetragen
     ist. Rückgabe: Anzahl wieder eingesetzter Ergebnisse.                */
  function restoreResults(t, snap, getMatches, phaseOf) {
    const ph = phaseOf || matchPhase;
    t.results = {};
    for (let pass = 0; pass < 30; pass++) {
      let added = 0;
      (getMatches() || []).forEach(m => {
        if (!m || m.a == null || m.b == null || t.results[m.id]) return;
        const p = ph(m.id), ka = sideKey(m.a), kb = sideKey(m.b);
        const e = snap.find(s => !s.used && s.phase === p
          && ((s.a === ka && s.b === kb) || (s.a === kb && s.b === ka)));
        if (!e) return;
        e.used = true;
        t.results[m.id] = e.a === ka ? e.r : swapResult(e.r);
        added++;
      });
      if (!added) break;
    }
    return snap.filter(s => s.used).length;
  }
  function anyResults(t) {
    return Object.keys(t.results || {}).some(id => hasInput(t.results[id]));
  }

  /* Voreinstellung über die URL (?teams=8&fields=4&…), z. B. aus Links der
     Startseite. Das darf einen laufenden Bogen niemals
     überschreiben – deshalb greift es nur, solange noch kein Ergebnis eingetragen
     ist. `spec` bildet Parametername auf einen Prüfer ab, der den fertigen Wert
     oder undefined liefert. */
  function applyUrlConfig(t, spec, search) {
    if (!t || !t.config || !spec) return false;
    if (t.results && Object.keys(t.results).length) return false;
    let q;
    try { q = new URLSearchParams(search != null ? search : location.search); }
    catch (e) { return false; }
    let changed = false;
    Object.keys(spec).forEach(k => {
      if (!q.has(k)) return;
      const v = spec[k](q.get(k));
      if (v === undefined || v === null) return;
      if (t.config[k] === v) return;
      t.config[k] = v; changed = true;
    });
    return changed;
  }

  /* Prüfer für applyUrlConfig */
  const urlInt = (min, max) => s => {
    const n = parseInt(s, 10);
    return (Number.isFinite(n) && n >= min && n <= max) ? n : undefined;
  };
  const urlOneOf = list => s => (list.indexOf(s) >= 0 ? s : undefined);
  const urlBool = s => (s === '1' || s === 'true' ? true
                      : s === '0' || s === 'false' ? false : undefined);

  const storage = {
    ready: ready,
    readEntries: readEntries,
    transaction: transaction,
    getItem: getItem,
    setItem: setItem,
    removeItem: removeItem,
    isKnownKey: isKnownKey,
    isPending: isPending,
    whenIdle: whenIdle,
    DB_NAME: DB_NAME,
    DB_VERSION: DB_VERSION,
    STORE_NAME: KV_STORE
  };

  return {
    SCHEMA, PREFIX, BACKUP_PREFIX, REVISION_PREFIX, QUARANTINE_PREFIX, ARCHIVE_PREFIX, INDEX_KEY, SESSIONS_KEY, SYNC_KEY,
    DB_NAME, DB_VERSION, STORE_NAME: KV_STORE,
    sheetIdFrom, BASE_ID, SHEET_BASES: SHEET_BASES.slice(), sheetBaseOf, isCurrentSheet, pruneUnsupportedIndex,
    emptyTournament, normalize, parseRecord,
    // async (Promise) – IndexedDB maßgeblich
    load, save, reset, hasBackup, restorePrevious, index, updateIndex,
    ready, readEntries, transaction, getItem, setItem, removeItem,
    isPending, whenIdle, storage,
    // synchron, rein (für transaction()-Callbacks und Tests)
    isKnownKey, indexEntry,
    loadInView, saveInView, updateIndexInView, readIndexInView, refreshIndexInView, revisionInView,
    setScore, getSets, clearScores,
    setManualStanding, getManualStandings, resetManualStandingRow, resetManualStandings,
    setManualPlacement, getManualPlacements, resetManualPlacementRow, resetManualPlacements,
    applyUrlConfig, urlInt, urlOneOf, urlBool,
    teamRemap, remapKeys, remapList, remapCommon, repairPairs, matchPhase,
    snapshotResults, restoreResults, anyResults, hasInput
  };
});
