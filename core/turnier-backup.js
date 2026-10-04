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

  /* Alle Turnierdaten liegen in IndexedDB (TStore). localStorage wird nur
     noch gelesen: als Rückfall, wenn IndexedDB nicht verfügbar ist, und für
     Altbogen-Schlüssel, die (noch) nicht übernommen wurden. */
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
  /* Altbogen-Schlüssel (nicht "beachl.*"): werden nie gelöscht, dürfen also
     aus localStorage ergänzt werden, ohne Gelöschtes wiederzubeleben. */
  function isLegacySheetKey(key) {
    return isKnownKey(key) && key.indexOf('beachl.') !== 0 && key !== TStore.SESSIONS_KEY;
  }

  function parseJSON(value, label) {
    try { return JSON.parse(value); }
    catch (e) { throw new Error(label + ' enthält ungültiges JSON.'); }
  }

  function validateEntry(key, value) {
    if (typeof key !== 'string' || !isKnownKey(key) || typeof value !== 'string') {
      throw new Error('Die Sicherungsdatei enthält einen unzulässigen Eintrag.');
    }
    if (key.indexOf(TStore.PREFIX) === 0 || key.indexOf(TStore.BACKUP_PREFIX) === 0) {
      const tournament = parseJSON(value, key);
      const sheetId = key.slice(key.indexOf(TStore.PREFIX) === 0
        ? TStore.PREFIX.length : TStore.BACKUP_PREFIX.length);
      if (!tournament || tournament.schema !== TStore.SCHEMA || tournament.sheet !== sheetId) {
        throw new Error('Turnierdaten in der Sicherungsdatei sind nicht kompatibel.');
      }
    } else if (key.indexOf(TStore.REVISION_PREFIX) === 0) {
      const revision = Number(value);
      if (!Number.isFinite(revision) || revision < 0 || Math.floor(revision) !== revision) {
        throw new Error('Die gespeicherte Löschrevision ist ungültig.');
      }
    } else if (key.indexOf('beachl.arch.') === 0) {
      const archive = parseJSON(value, key);
      if (!archive || !archive.sheet || !archive.data || typeof archive.data !== 'object') {
        throw new Error('Ein Archiv-Eintrag in der Sicherungsdatei ist ungültig.');
      }
      Object.keys(archive.data).forEach(function (archiveKey) {
        if (!isKnownKey(archiveKey) || archiveKey.indexOf('beachl.arch.') === 0
            || typeof archive.data[archiveKey] !== 'string') {
          throw new Error('Verschachtelte Archive sind in der Sicherungsdatei unzulässig.');
        }
      });
    } else if (key === 'beachl.index') {
      const index = parseJSON(value, key);
      if (!index || typeof index !== 'object' || Array.isArray(index)) {
        throw new Error('Der Turnierindex in der Sicherungsdatei ist ungültig.');
      }
      if (Object.keys(index).some(function (name) {
        return name === '__proto__' || name === 'constructor' || name === 'prototype';
      })) {
        throw new Error('Der Turnierindex enthält einen unzulässigen Eintrag.');
      }
    } else if (key === 'beachl_sessions') {
      if (!Array.isArray(parseJSON(value, key))) {
        throw new Error('Die Liste alter Turniere in der Sicherungsdatei ist ungültig.');
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

  function buildBackup(rawEntries, legacy) {
    const entries = [];
    const taken = Object.create(null);
    const stamp = Date.now();
    let bytes = 0;
    function add(key, value) {
      if (!isKnownKey(key) || typeof value !== 'string' || taken[key]) return;
      const entry = exportEntry(key, value, stamp, taken);
      taken[entry.key] = true;
      bytes += entry.key.length + entry.value.length;
      if (bytes > MAX_BYTES) throw new Error('Die Sicherung ist größer als 25 MB.');
      entries.push(entry);
    }
    rawEntries.forEach(function (e) { add(e.key, e.value); });
    legacy.forEach(function (e) { if (isLegacySheetKey(e.key)) add(e.key, e.value); });
    return { format: FORMAT, version: VERSION, exportedAt: new Date().toISOString(), entries: entries };
  }

  /* → Promise<Sicherung>. Quelle ist IndexedDB (inkl. der beim ersten Öffnen
     übernommenen Altdaten); ist IndexedDB nicht verfügbar, wird der lesbare
     localStorage-Altbestand exportiert. */
  function exportAll() {
    return TStore.readEntries().then(function (entries) {
      return Object.assign(buildBackup(entries, legacyEntries()), { storage: 'indexedDB' });
    }, function (err) {
      const code = err && err.code;
      if (code !== 'unavailable' && code !== 'blocked') throw err;
      const legacy = legacyEntries();
      if (!legacyStorage()) throw new Error('Der lokale Speicher ist nicht verfügbar.');
      return Object.assign(buildBackup(legacy, []), { storage: 'localStorage-readonly' });
    });
  }

  function mergeIndex(current, incoming, addedEntries) {
    const merged = Object.assign(Object.create(null), incoming, current);
    ['__archives', '__migrations'].forEach(function (key) {
      if (current[key] || incoming[key]) {
        merged[key] = Object.assign(Object.create(null), incoming[key] || {}, current[key] || {});
      }
    });
    addedEntries.forEach(function (entry) {
      if (entry.key.indexOf(TStore.PREFIX) !== 0) return;
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

  function validateBackup(backup) {
    if (!backup || backup.format !== FORMAT || backup.version !== VERSION
        || !Array.isArray(backup.entries)) {
      throw new Error('Dateiformat nicht erkannt oder Version nicht unterstützt.');
    }
    let bytes = 0;
    const seen = Object.create(null);
    backup.entries.forEach(function (entry) {
      if (!entry || typeof entry.key !== 'string' || seen[entry.key]) {
        throw new Error('Die Sicherungsdatei enthält doppelte Einträge.');
      }
      seen[entry.key] = true;
      validateEntry(entry.key, entry.value);
      if (entry.originalKey != null && (typeof entry.originalKey !== 'string'
          || (entry.originalKey.indexOf(TStore.PREFIX) !== 0
            && entry.originalKey.indexOf(TStore.BACKUP_PREFIX) !== 0)
          || entry.key.indexOf(TStore.QUARANTINE_PREFIX) !== 0)) {
        throw new Error('Der Quarantäne-Eintrag enthält einen unzulässigen Ursprung.');
      }
      if (entry.originalKey) {
        const prefix = entry.originalKey.indexOf(TStore.PREFIX) === 0 ? TStore.PREFIX : TStore.BACKUP_PREFIX;
        const sheet = entry.originalKey.slice(prefix.length);
        if (entry.key.indexOf(TStore.QUARANTINE_PREFIX + sheet + '.') !== 0
            || TStore.parseRecord(entry.value, sheet).ok) {
          throw new Error('Der Quarantäne-Eintrag passt nicht zu seinem Ursprung.');
        }
      }
      bytes += entry.key.length + entry.value.length;
      if (bytes > MAX_BYTES) throw new Error('Die Sicherung ist größer als 25 MB.');
    });
  }

  /* Synchron, innerhalb einer TStore.transaction(): vorhandene Schlüssel
     werden NIE überschrieben, der Index wird zusammengeführt. */
  function importInView(view, backup) {
    let incomingIndex = {};
    const indexEntry = backup.entries.filter(function (entry) { return entry.key === TStore.INDEX_KEY; })[0];
    if (indexEntry) incomingIndex = JSON.parse(indexEntry.value);
    const added = [];
    let skipped = 0;
    backup.entries.forEach(function (entry) {
      if (entry.key === TStore.INDEX_KEY) return;
      if (view.getItem(entry.key) != null) { skipped++; return; }
      if (entry.key.indexOf(TStore.PREFIX) === 0) {
        const sheet = entry.key.slice(TStore.PREFIX.length);
        const t = JSON.parse(entry.value);
        t._revision = Math.max(TStore.revisionInView(view, sheet), Number(t._revision) || 0) + 1;
        added.push(Object.assign({}, entry, { value: JSON.stringify(t) }));
      } else {
        added.push(entry);
      }
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
    view.setItem(TStore.INDEX_KEY, JSON.stringify(merged));
    let undoKey = null;
    const undoEntries = added.filter(function (entry) {
      return entry.key.indexOf(TStore.REVISION_PREFIX) !== 0;
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
    return { added: added.length, skipped: skipped, undoKey: undoKey };
  }

  /* → Promise<{ added, skipped }>. Alles-oder-nichts: eine einzige
     IndexedDB-Transaktion; ungültige Dateien werden vorher abgewiesen. */
  function importAll(backup) {
    try { validateBackup(backup); }
    catch (e) { return Promise.reject(e); }
    return TStore.transaction(function (view) {
      return importInView(view, backup);
    }).then(null, function (err) {
      const e = new Error('Import fehlgeschlagen; es wurde nichts geändert (zurückgerollt).');
      e.cause = err;
      e.code = err && err.code;
      throw e;
    });
  }

  function undoImport(undoKey) {
    if (typeof undoKey !== 'string'
        || undoKey.indexOf(TStore.QUARANTINE_PREFIX + 'undo-import.') !== 0) {
      return Promise.reject(new Error('Ungültiger Import-Rückgängig-Schlüssel.'));
    }
    return TStore.transaction(function (view) {
      let undo;
      try { undo = JSON.parse(view.getItem(undoKey) || 'null'); }
      catch (e) { throw new Error('Import-Rückgängig-Daten sind beschädigt.'); }
      if (!undo || undo.type !== 'import' || !Array.isArray(undo.entries)) {
        throw new Error('Import-Rückgängig-Daten sind nicht verfügbar.');
      }
      const index = TStore.readIndexInView(view);
      undo.entries.forEach(function (entry) {
        if (view.getItem(entry.key) !== entry.value) {
          throw new Error('Importierte Daten wurden inzwischen geändert; Rückgängig wurde abgebrochen.');
        }
      });
      undo.entries.forEach(function (entry) {
        const key = entry.key;
        if (key.indexOf(TStore.PREFIX) === 0) {
          const sheet = key.slice(TStore.PREFIX.length);
          const record = JSON.parse(entry.value);
          const revision = Math.max(TStore.revisionInView(view, sheet), Number(record._revision) || 0);
          view.setItem(TStore.REVISION_PREFIX + sheet, String(revision));
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

  return {
    FORMAT: FORMAT, VERSION: VERSION, MAX_BYTES: MAX_BYTES,
    exportAll: exportAll, importAll: importAll, undoImport: undoImport,
    validateBackup: validateBackup, importInView: importInView
  };
});
