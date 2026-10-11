/* ============================================================================
   turnier-backup.js - Export/import of BeachL tournament storage
   Quelle/Ziel ist IndexedDB über TStore (async, atomar).
   ========================================================================== */
(function (root, factory) {
  const store = root.TStore || (typeof require === 'function' ? require('./turnier-store.js') : null);
  const api = factory(root, store);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TBackup = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root, TStore) {
  'use strict';

  const FORMAT = 'beachl-tournament-backup';
  const VERSION = 1;
  const MAX_BYTES = 25 * 1024 * 1024;

  /* Meldungen über TI18n nur auf freigeschalteten Seiten (Startseite);
     sonst bzw. ohne TI18n exakt der eingebaute deutsche Text (== de.js). */
  function i18n() {
    return typeof TI18n !== 'undefined' && TI18n && TI18n.active() ? TI18n : null;
  }
  function tx(key, de, params) {
    const I = i18n();
    if (I) return I.t(key, params);
    return String(de).replace(/\{(\w+)\}/g, function (m, k) {
      return params && params[k] != null ? String(params[k]) : m;
    });
  }

  /* Alle Turnierdaten liegen in IndexedDB (TStore). localStorage wird nur
     noch gelesen: als Rettungs-Export, wenn IndexedDB nicht verfügbar ist. */
  function legacyStorage() {
    try { return typeof localStorage !== 'undefined' ? localStorage : null; }
    catch (e) { return null; }
  }
  function legacyEntries() {
    const s = legacyStorage();
    const out = [];
    if (!s) return out;
    let n = 0;
    try { n = s.length; } catch (e) { return out; }
    for (let i = 0; i < n; i++) {
      let key = null, value = null;
      try { key = s.key(i); value = key == null ? null : s.getItem(key); } catch (e) { continue; }
      if (key != null && value != null) out.push({ key: key, value: value });
    }
    return out;
  }

  function isKnownKey(key) {
    return typeof key === 'string' && TStore.isKnownKey(key);
  }

  function parseJSON(value, label) {
    try { return JSON.parse(value); }
    catch (e) { throw new Error(tx('backup.err.invalidJson', '{label} enthält ungültiges JSON.', { label: label })); }
  }

  function validateEntry(key, value) {
    if (typeof key !== 'string' || !isKnownKey(key) || typeof value !== 'string') {
      throw new Error(tx('backup.err.entry', 'Die Sicherungsdatei enthält einen unzulässigen Eintrag.'));
    }
    if (key.indexOf(TStore.PREFIX) === 0 || key.indexOf(TStore.BACKUP_PREFIX) === 0) {
      const sheetId = key.slice(key.indexOf(TStore.PREFIX) === 0
        ? TStore.PREFIX.length : TStore.BACKUP_PREFIX.length);
      if (!TStore.isCurrentSheet(sheetId)) return;
      const tournament = parseJSON(value, key);
      if (!tournament || tournament.schema !== TStore.SCHEMA || tournament.sheet !== sheetId) {
        throw new Error(tx('backup.err.incompatible', 'Turnierdaten in der Sicherungsdatei sind nicht kompatibel.'));
      }
    } else if (key.indexOf(TStore.REVISION_PREFIX) === 0) {
      const revision = Number(value);
      if (!Number.isFinite(revision) || revision < 0 || Math.floor(revision) !== revision) {
        throw new Error(tx('backup.err.revision', 'Die gespeicherte Löschrevision ist ungültig.'));
      }
    } else if (key.indexOf('beachl.arch.') === 0) {
      const archiveSheet = key.slice(TStore.ARCHIVE_PREFIX.length);
      if (!TStore.isCurrentSheet(archiveSheet)) return;
      const archive = parseJSON(value, key);
      if (!archive || !archive.sheet || !archive.data || typeof archive.data !== 'object') {
        throw new Error(tx('backup.err.archive', 'Ein Archiv-Eintrag in der Sicherungsdatei ist ungültig.'));
      }
      Object.keys(archive.data).forEach(function (archiveKey) {
        if (!isKnownKey(archiveKey) || archiveKey.indexOf('beachl.arch.') === 0
            || typeof archive.data[archiveKey] !== 'string') {
          throw new Error(tx('backup.err.nested', 'Verschachtelte Archive sind in der Sicherungsdatei unzulässig.'));
        }
      });
    } else if (key === 'beachl.index') {
      const index = parseJSON(value, key);
      if (!index || typeof index !== 'object' || Array.isArray(index)) {
        throw new Error(tx('backup.err.index', 'Der Turnierindex in der Sicherungsdatei ist ungültig.'));
      }
      if (Object.keys(index).some(function (name) {
        return name === '__proto__' || name === 'constructor' || name === 'prototype';
      })) {
        throw new Error(tx('backup.err.indexEntry', 'Der Turnierindex enthält einen unzulässigen Eintrag.'));
      }
    } else if (key === 'beachl_sessions') {
      if (!Array.isArray(parseJSON(value, key))) {
        throw new Error(tx('backup.err.sessions', 'Die Liste alter Turniere in der Sicherungsdatei ist ungültig.'));
      }
    }
  }

  /* Ungültige Turnierdatensätze verhindern den Export nicht: sie werden
     unverändert als Quarantäne-Eintrag (beachl.q.*) mitgenommen. */
  function exportEntry(key, value, stamp, taken) {
    try {
      validateEntry(key, value);
      return { key: key, value: value };
    } catch (e) {
      if (key.indexOf(TStore.PREFIX) !== 0 && key.indexOf(TStore.BACKUP_PREFIX) !== 0) throw e;
      const sheet = key.slice(key.indexOf(TStore.PREFIX) === 0 ? TStore.PREFIX.length : TStore.BACKUP_PREFIX.length);
      let qKey = TStore.QUARANTINE_PREFIX + sheet + '.export-' + stamp;
      let n = 1;
      while (taken[qKey]) qKey = TStore.QUARANTINE_PREFIX + sheet + '.export-' + stamp + '-' + (n++);
      return { key: qKey, value: value, originalKey: key };
    }
  }

  function buildBackup(rawEntries) {
    const entries = [];
    const taken = Object.create(null);
    const stamp = Date.now();
    let bytes = 0;
    function add(key, value) {
      if (!isKnownKey(key) || typeof value !== 'string' || taken[key]) return;
      const entry = exportEntry(key, value, stamp, taken);
      taken[entry.key] = true;
      bytes += entry.key.length + entry.value.length;
      if (bytes > MAX_BYTES) throw new Error(tx('backup.err.tooLarge', 'Die Sicherung ist größer als 25 MB.'));
      entries.push(entry);
    }
    rawEntries.forEach(function (e) { add(e.key, e.value); });
    return { format: FORMAT, version: VERSION, exportedAt: new Date().toISOString(), entries: entries };
  }

  /* → Promise<Sicherung>. Quelle ist IndexedDB (in der App SQLite); ist
     der Speicher nicht verfügbar, wird der lesbare localStorage-Bestand
     exportiert. */
  function exportAll() {
    return TStore.readEntries().then(function (entries) {
      const backend = typeof TStore.backend === 'function' ? TStore.backend() : 'indexedDB';
      return Object.assign(buildBackup(entries), { storage: backend });
    }, function (err) {
      const code = err && err.code;
      if (code !== 'unavailable' && code !== 'blocked') throw err;
      const legacy = legacyEntries();
      if (!legacyStorage()) throw new Error(tx('backup.err.noStorage', 'Der lokale Speicher ist nicht verfügbar.'));
      return Object.assign(buildBackup(legacy), { storage: 'localStorage-readonly' });
    });
  }

  function recordSheet(key) {
    if (typeof key !== 'string') return null;
    const prefixes = [TStore.PREFIX, TStore.BACKUP_PREFIX, TStore.REVISION_PREFIX, TStore.ARCHIVE_PREFIX];
    for (let i = 0; i < prefixes.length; i++) {
      if (key.indexOf(prefixes[i]) === 0) return key.slice(prefixes[i].length);
    }
    return null;
  }

  /* Known old-sheet records stay opaque and intact; only active sheets are
     interpreted. Unknown keys are retained as quarantine payloads on import. */
  function isSupportedEntry(entry) { return isKnownKey(entry.key); }

  function mergeIndex(current, incoming, addedEntries) {
    const merged = Object.assign(Object.create(null), incoming, current);
    ['__archives', '__migrations'].forEach(function (key) {
      if (current[key] || incoming[key]) {
        merged[key] = Object.assign(Object.create(null), incoming[key] || {}, current[key] || {});
      }
    });
    addedEntries.forEach(function (entry) {
      if (entry.key.indexOf(TStore.PREFIX) !== 0
          || !TStore.isCurrentSheet(entry.key.slice(TStore.PREFIX.length))) return;
      const tournament = JSON.parse(entry.value);
      merged[tournament.sheet] = {
        title: tournament.title || '',
        teams: tournament.config && tournament.config.teams,
        updated: tournament.updated || null,
        filled: Object.keys(tournament.results || {}).length
      };
    });
    return merged;
  }

  /* Prüft die Datei vollständig und trennt bekannte Speicher-Schlüssel von
     unbekannten Alt-Einträgen, die beim Import in exportierbarer Quarantäne
     erhalten bleiben. */
  function validateBackup(backup) {
    if (!backup || backup.format !== FORMAT || backup.version !== VERSION
        || !Array.isArray(backup.entries)) {
      throw new Error(tx('backup.err.format', 'Dateiformat nicht erkannt oder Version nicht unterstützt.'));
    }
    let bytes = 0;
    const seen = Object.create(null);
    const supported = [];
    const preservedEntries = [];
    const retiredKeys = [];
    backup.entries.forEach(function (entry) {
      if (!entry || typeof entry.key !== 'string' || seen[entry.key]) {
        throw new Error(tx('backup.err.duplicate', 'Die Sicherungsdatei enthält doppelte Einträge.'));
      }
      seen[entry.key] = true;
      if (typeof entry.value !== 'string') {
        throw new Error(tx('backup.err.entry', 'Die Sicherungsdatei enthält einen unzulässigen Eintrag.'));
      }
      bytes += entry.key.length + entry.value.length;
      if (bytes > MAX_BYTES) throw new Error(tx('backup.err.tooLarge', 'Die Sicherung ist größer als 25 MB.'));
      if (!isSupportedEntry(entry)) {
        preservedEntries.push(entry);
        return;
      }
      validateEntry(entry.key, entry.value);
      const sheet = recordSheet(entry.key);
      if (sheet && !TStore.isCurrentSheet(sheet)) retiredKeys.push(entry.key);
      if (entry.originalKey != null && (typeof entry.originalKey !== 'string'
          || (entry.originalKey.indexOf(TStore.PREFIX) !== 0
            && entry.originalKey.indexOf(TStore.BACKUP_PREFIX) !== 0)
          || entry.key.indexOf(TStore.QUARANTINE_PREFIX) !== 0)) {
        throw new Error(tx('backup.err.quarantineOrigin', 'Der Quarantäne-Eintrag enthält einen unzulässigen Ursprung.'));
      }
      if (entry.originalKey) {
        const prefix = entry.originalKey.indexOf(TStore.PREFIX) === 0 ? TStore.PREFIX : TStore.BACKUP_PREFIX;
        const sheet = entry.originalKey.slice(prefix.length);
        if (entry.key.indexOf(TStore.QUARANTINE_PREFIX + sheet + '.') !== 0
            || TStore.parseRecord(entry.value, sheet).ok) {
          throw new Error(tx('backup.err.quarantineMismatch', 'Der Quarantäne-Eintrag passt nicht zu seinem Ursprung.'));
        }
      }
      supported.push(entry);
    });
    if (!preservedEntries.length && !supported.some(function (entry) {
      return entry.key !== TStore.INDEX_KEY && entry.key !== TStore.SESSIONS_KEY
        && entry.key.indexOf(TStore.QUARANTINE_PREFIX + 'undo-') !== 0;
    })) {
      throw new Error(tx('backup.err.onlyUnsupported',
        'Die Sicherungsdatei enthält keine Turnier- oder Archivdaten. Es wurde nichts importiert.'));
    }
    return { entries: supported, preservedEntries: preservedEntries, retiredKeys: retiredKeys,
      preserved: preservedEntries.length, retired: retiredKeys.length };
  }

  /* Synchron, innerhalb einer TStore.transaction(): vorhandene Schlüssel
     werden NIE überschrieben, der Index wird zusammengeführt. Die Datei wird
     hier erneut geprüft; übernommen werden nur unterstützte Einträge. */
  function importInView(view, backup) {
    const plan = validateBackup(backup);
    let incomingIndex = {};
    const indexEntry = plan.entries.filter(function (entry) { return entry.key === TStore.INDEX_KEY; })[0];
    if (indexEntry) incomingIndex = JSON.parse(indexEntry.value);
    const added = [];
    let skipped = 0;
    plan.entries.forEach(function (entry) {
      if (entry.key === TStore.INDEX_KEY) return;
      if (view.getItem(entry.key) != null) { skipped++; return; }
      if (entry.key.indexOf(TStore.PREFIX) === 0 && TStore.isCurrentSheet(entry.key.slice(TStore.PREFIX.length))) {
        const sheet = entry.key.slice(TStore.PREFIX.length);
        const t = JSON.parse(entry.value);
        t._revision = Math.max(TStore.revisionInView(view, sheet), Number(t._revision) || 0) + 1;
        added.push(Object.assign({}, entry, { value: JSON.stringify(t) }));
      } else {
        added.push(entry);
      }
    });
    plan.preservedEntries.forEach(function (entry, i) {
      const stamp = Date.now();
      let key = TStore.QUARANTINE_PREFIX + 'backup-entry.' + stamp + '-' + i;
      let n = 1;
      while (view.getItem(key) != null) key = TStore.QUARANTINE_PREFIX + 'backup-entry.' + stamp + '-' + i + '-' + n++;
      added.push({ key: key, value: JSON.stringify({ type: 'preserved-backup-entry', key: entry.key, value: entry.value }) });
    });
    const currentIndexRaw = view.getItem(TStore.INDEX_KEY);
    let currentIndex = {};
    if (currentIndexRaw) {
      try { currentIndex = JSON.parse(currentIndexRaw) || {}; } catch (e) { currentIndex = {}; }
      if (typeof currentIndex !== 'object' || Array.isArray(currentIndex)) currentIndex = {};
    }
    added.forEach(function (entry) {
      view.setItem(entry.key, entry.value);
      if (entry.originalKey && view.getItem(entry.originalKey) == null) {
        view.setItem(entry.originalKey, entry.value);
      }
    });
    const merged = mergeIndex(currentIndex, incomingIndex, added);
    Object.keys(merged).forEach(function (sheet) {
      if (sheet.indexOf('__') !== 0 && view.getItem(TStore.PREFIX + sheet) == null) delete merged[sheet];
    });
    TStore.pruneUnsupportedIndex(merged, view);
    view.setItem(TStore.INDEX_KEY, JSON.stringify(merged));
    let undoKey = null;
    const undoEntries = added.filter(function (entry) {
      if (entry.key.indexOf(TStore.REVISION_PREFIX) !== 0) return true;
      return !TStore.isCurrentSheet(entry.key.slice(TStore.REVISION_PREFIX.length));
    });
    if (undoEntries.length) {
      const stamp = Date.now();
      undoKey = TStore.QUARANTINE_PREFIX + 'undo-import.' + stamp;
      let n = 1;
      while (view.getItem(undoKey) != null) {
        undoKey = TStore.QUARANTINE_PREFIX + 'undo-import.' + stamp + '-' + n++;
      }
      view.setItem(undoKey, JSON.stringify({
        type: 'import',
        createdAt: stamp,
        expiresAt: stamp + 15000,
        entries: undoEntries
      }));
    }
    return { added: added.length, skipped: skipped, preserved: plan.preserved,
      preservedKeys: plan.preservedEntries.map(function (entry) { return entry.key; }),
      retired: plan.retired, retiredKeys: plan.retiredKeys.slice(), undoKey: undoKey };
  }

  /* → Promise<{ added, skipped, retired, preserved, undoKey }>.
     Der gesamte Import ist atomar; retired records bleiben unverändert und
     unbekannte Schlüssel werden als exportierbare Quarantäne erhalten. */
  function importAll(backup) {
    try { validateBackup(backup); }
    catch (e) { return Promise.reject(e); }
    return TStore.transaction(function (view) {
      return importInView(view, backup);
    }).then(null, function (err) {
      const e = new Error(tx('backup.err.importFailed', 'Import fehlgeschlagen; es wurde nichts geändert (zurückgerollt).'));
      e.cause = err;
      e.code = err && err.code;
      throw e;
    });
  }

  function undoImport(undoKey) {
    if (typeof undoKey !== 'string'
        || undoKey.indexOf(TStore.QUARANTINE_PREFIX + 'undo-import.') !== 0) {
      return Promise.reject(new Error(tx('backup.err.undoKey', 'Ungültiger Import-Rückgängig-Schlüssel.')));
    }
    return TStore.transaction(function (view) {
      let undo;
      try { undo = JSON.parse(view.getItem(undoKey) || 'null'); }
      catch (e) { throw new Error(tx('backup.err.undoCorrupt', 'Import-Rückgängig-Daten sind beschädigt.')); }
      if (!undo || undo.type !== 'import' || !Array.isArray(undo.entries)) {
        throw new Error(tx('backup.err.undoMissing', 'Import-Rückgängig-Daten sind nicht verfügbar.'));
      }
      const index = TStore.readIndexInView(view);
      undo.entries.forEach(function (entry) {
        if (view.getItem(entry.key) !== entry.value) {
          throw new Error(tx('backup.err.undoChanged', 'Importierte Daten wurden inzwischen geändert; Rückgängig wurde abgebrochen.'));
        }
      });
      undo.entries.forEach(function (entry) {
        const key = entry.key;
        if (key.indexOf(TStore.PREFIX) === 0) {
          const sheet = key.slice(TStore.PREFIX.length);
          const record = JSON.parse(entry.value);
          if (TStore.isCurrentSheet(sheet)) {
            const revision = Math.max(TStore.revisionInView(view, sheet), Number(record._revision) || 0);
            view.setItem(TStore.REVISION_PREFIX + sheet, String(revision));
          }
          delete index[sheet];
        } else if (key.indexOf(TStore.ARCHIVE_PREFIX) === 0) {
          if (index.__archives) delete index.__archives[key];
        }
        view.removeItem(key);
      });
      if (index.__archives && !Object.keys(index.__archives).length) delete index.__archives;
      view.setItem(TStore.INDEX_KEY, JSON.stringify(index));
      view.removeItem(undoKey);
      return { removed: undo.entries.length };
    });
  }

  /* ------------------------------------------------ Native App: Dateien
     In der App (TStore-Backend SQLite) gibt es keinen Download-Link und
     kein verlässliches <input type=file>: Export über das System-Teilen-
     Menü, Import über die System-Dateiauswahl (TNativeFiles aus dem
     nativen Bundle). Geprüft und importiert wird unverändert über
     validateBackup()/importAll(). Im Browser wird nichts davon geladen. */
  /* Obergrenze der Sicherungsdatei: Inhalt ≤ MAX_BYTES, JSON-Maskierung und
     Einrückung machen die Datei größer. */
  const MAX_FILE_BYTES = 2 * MAX_BYTES;
  function usesNativeFiles() {
    return !!TStore && typeof TStore.backend === 'function' && TStore.backend() === 'sqlite';
  }
  function isNativeFiles(files) {
    return !!files && typeof files.shareBackup === 'function' && typeof files.pickBackup === 'function';
  }
  function nativeFilesUnavailable(cause) {
    const e = new Error(tx('backup.err.nativeFiles', 'Dateiexport/-import der App ist nicht verfügbar.'));
    e.code = 'files-unavailable';
    if (cause !== undefined) e.cause = cause;
    return e;
  }
  /* → Promise<TNativeFiles>; lädt bei Bedarf das native Bundle nach. */
  function nativeFiles() {
    if (!usesNativeFiles()) return Promise.reject(nativeFilesUnavailable());
    if (isNativeFiles(root.TNativeFiles)) return Promise.resolve(root.TNativeFiles);
    const load = typeof TStore.loadNativeBundle === 'function'
      ? TStore.loadNativeBundle() : Promise.reject(new Error('loadNativeBundle missing'));
    return load.then(function () {
      if (!isNativeFiles(root.TNativeFiles)) throw new Error('native bundle did not register TNativeFiles');
      return root.TNativeFiles;
    }).then(null, function (err) {
      throw err && err.code === 'files-unavailable' ? err : nativeFilesUnavailable(err);
    });
  }

  return {
    FORMAT: FORMAT, VERSION: VERSION, MAX_BYTES: MAX_BYTES, MAX_FILE_BYTES: MAX_FILE_BYTES,
    exportAll: exportAll, importAll: importAll, undoImport: undoImport,
    validateBackup: validateBackup, importInView: importInView,
    usesNativeFiles: usesNativeFiles, nativeFiles: nativeFiles
  };
});
