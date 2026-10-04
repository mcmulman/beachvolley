/* ============================================================================
   turnier-backup.js - Export/import of BeachL tournament storage
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

  function storage() {
    try { return typeof localStorage !== 'undefined' ? localStorage : null; }
    catch (e) { return null; }
  }

  function isKnownKey(key) {
    if (key === 'beachl.index' || key === 'beachl_sessions') return true;
    if (/^beachl\.(t|b|q|arch)\./.test(key)) return true;
    return Object.keys(TStore.LEGACY).some(function (sheet) {
      const spec = TStore.LEGACY[sheet];
      return Object.keys(spec).some(function (name) {
        if (name === 'scoreKind' || name === 'teams') return false;
        const value = spec[name];
        if (typeof value !== 'string') return false;
        return key === value || (name === 'prefix' && key.indexOf(value + '.') === 0);
      });
    });
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

  function exportAll() {
    const s = storage();
    if (!s) throw new Error('Der lokale Speicher ist nicht verfuegbar.');
    const entries = [];
    let bytes = 0;
    for (let i = 0; i < s.length; i++) {
      const key = s.key(i);
      if (!key || !isKnownKey(key)) continue;
      const value = s.getItem(key);
      if (value == null) continue;
      validateEntry(key, value);
      bytes += key.length + value.length;
      if (bytes > MAX_BYTES) throw new Error('Die Sicherung ist größer als 25 MB.');
      entries.push({ key: key, value: value });
    }
    return { format: FORMAT, version: VERSION, exportedAt: new Date().toISOString(), entries: entries };
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

  function importAll(backup) {
    if (!backup || backup.format !== FORMAT || backup.version !== VERSION
        || !Array.isArray(backup.entries)) {
      throw new Error('Dateiformat nicht erkannt oder Version nicht unterstuetzt.');
    }
    const s = storage();
    if (!s) throw new Error('Der lokale Speicher ist nicht verfuegbar.');

    let bytes = 0;
    const seen = Object.create(null);
    backup.entries.forEach(function (entry) {
      if (!entry || seen[entry.key]) throw new Error('Die Sicherungsdatei enthaelt doppelte Eintraege.');
      seen[entry.key] = true;
      validateEntry(entry.key, entry.value);
      bytes += entry.key.length + entry.value.length;
      if (bytes > MAX_BYTES) throw new Error('Die Sicherung ist größer als 25 MB.');
    });

    const added = [];
    const skipped = [];
    let incomingIndex = {};
    const indexEntry = backup.entries.filter(function (entry) { return entry.key === 'beachl.index'; })[0];
    if (indexEntry) incomingIndex = JSON.parse(indexEntry.value);
    backup.entries.forEach(function (entry) {
      if (entry.key === 'beachl.index') return;
      if (s.getItem(entry.key) != null) {
        skipped.push(entry.key);
        return;
      }
      added.push(entry);
    });

    const currentIndexRaw = s.getItem('beachl.index');
    const currentIndex = currentIndexRaw ? parseJSON(currentIndexRaw, 'beachl.index') : {};
    const mergedIndex = mergeIndex(currentIndex, incomingIndex, added);
    const writeEntries = added.concat([{
      key: 'beachl.index',
      value: JSON.stringify(mergedIndex)
    }]);
    const written = [];
    try {
      writeEntries.forEach(function (entry) {
        const oldValue = s.getItem(entry.key);
        s.setItem(entry.key, entry.value);
        written.push({ key: entry.key, oldValue: oldValue });
      });
    } catch (e) {
      written.reverse().forEach(function (entry) {
        try {
          if (entry.oldValue == null) s.removeItem(entry.key);
          else s.setItem(entry.key, entry.oldValue);
        } catch (rollbackError) { }
      });
      throw new Error('Import fehlgeschlagen; bereits geschriebene Einträge wurden zurückgerollt.');
    }
    return { added: added.length, skipped: skipped.length };
  }

  return { FORMAT: FORMAT, VERSION: VERSION, exportAll: exportAll, importAll: importAll };
});
