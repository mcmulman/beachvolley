/* ============================================================================
   turnier-store.js – Persistenz und Schema-Migration

   Ein einziges, versioniertes localStorage-Schema für ALLE Turnierbögen.
   Ersetzt die bisher pro Bogen eigenen Schlüsselsätze (turnier6g_*, turnier8_*,
   sw_univ_*, turnierflexrr_* …) und migriert sie verlustfrei.

   Kein DOM-Zugriff außer localStorage.
   ========================================================================== */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TStore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SCHEMA = 2;
  const PREFIX = 'beachl.t.';          // + sheetId
  const INDEX_KEY = 'beachl.index';    // Übersicht für die Startseite

  /* ------------------------------------------------------------------ I/O */
  function ls() {
    try { return (typeof localStorage !== 'undefined') ? localStorage : null; }
    catch (e) { return null; }
  }
  function readJSON(key, fallback) {
    const s = ls(); if (!s) return fallback;
    try { const v = s.getItem(key); return v == null ? fallback : JSON.parse(v); }
    catch (e) { return fallback; }
  }
  function writeJSON(key, val) {
    const s = ls(); if (!s) return false;
    try { s.setItem(key, JSON.stringify(val)); return true; }
    catch (e) { return false; }         // z.B. Quota überschritten / Privatmodus
  }
  function removeKey(key) {
    const s = ls(); if (!s) return;
    try { s.removeItem(key); } catch (e) { }
  }

  /* -------------------------------------------------------------- Schema */
  /* Ein Turnier ist EIN Objekt. Ergebnisse liegen immer als drei Satzpaare
     vor – unabhängig vom aktuell gewählten Satzmodus. Dadurch löscht ein
     Moduswechsel niemals Eingaben (siehe AGENTS.md §8.1).                   */
  function emptyTournament(sheetId, cfg) {
    return {
      schema: SCHEMA,
      sheet: sheetId,
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

  function load(sheetId, cfgDefaults) {
    const raw = readJSON(keyFor(sheetId), null);
    if (raw && raw.schema === SCHEMA) return normalize(raw, sheetId, cfgDefaults);
    const migrated = migrate(sheetId, cfgDefaults);
    if (migrated) return migrated;
    return emptyTournament(sheetId, cfgDefaults);
  }

  function normalize(t, sheetId, cfgDefaults) {
    const base = emptyTournament(sheetId, cfgDefaults);
    const out = Object.assign(base, t);
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

  function save(t) {
    t.schema = SCHEMA;
    t.updated = new Date().toISOString();
    const ok = writeJSON(keyFor(t.sheet), t);
    if (ok) updateIndex(t);
    return ok;
  }

  function reset(sheetId) {
    removeKey(keyFor(sheetId));
    const idx = readJSON(INDEX_KEY, {}) || {};
    delete idx[sheetId];
    writeJSON(INDEX_KEY, idx);
  }

  function updateIndex(t) {
    const idx = readJSON(INDEX_KEY, {}) || {};
    idx[t.sheet] = {
      title: t.title || '',
      teams: t.config.teams,
      updated: t.updated,
      filled: Object.keys(t.results || {}).length
    };
    writeJSON(INDEX_KEY, idx);
  }
  function index() { return readJSON(INDEX_KEY, {}) || {}; }

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

  /* ------------------------------------------------------------ Migration
     Liest die alten, bogenspezifischen Schlüssel und überführt sie in das
     neue Schema. Die alten Schlüssel bleiben unangetastet, damit ein
     zurückgerollter Bogen weiterhin funktioniert.
     ------------------------------------------------------------------- */
  const LEGACY = {
    'flex-rr': {
      prefix: 'turnierflexrr',
      cfg: 'turnierflexrr_config', names: 'turnierflexrr_teamnames',
      scores: 'turnierflexrr_scores', absent: 'turnierflexrr_absent',
      fields: 'turnierflexrr_fields', start: 'turnierflexrr_start', end: 'turnierflexrr_end',
      title: 'turnierflexrr', scoreKind: 'flexrr'
    },
    'swiss': {
      prefix: 'sw_univ',
      cfg: 'sw_univ_cfg', names: 'sw_univ_names', scores: 'sw_univ_scores',
      absent: 'sw_univ_dropout', fields: 'sw_univ_fields',
      start: 'sw_univ_start', end: 'sw_univ_end',
      frozen: 'sw_univ_matches', frozenModes: 'sw_univ_roundmode', round1: 'sw_univ_round1',
      title: 'sw_univ', scoreKind: 'swiss'
    },
    'gruppen-6':   { prefix: 'turnier6g',   names: 'turnier6g_names',      scores: 'turnier6g_scores',   absent: 'turnier6g_absent',   fields: 'turnier6g_fields',   start: 'turnier6g_start',   end: 'turnier6g_end',   title: 'turnier6g',   teams: 6,  scoreKind: 'group' },
    'gruppen-8':   { prefix: 'turnier8',    names: 'turnier8_teamnames',   scores: 'turnier8_scores',    absent: 'turnier8_absent',    fields: 'turnier8_fields',    start: 'turnier8_start',    end: 'turnier8_end',    title: 'turnier8',    teams: 8,  scoreKind: 'group' },
    'gruppen-10':  { prefix: 'turnier10g',  names: 'turnier10g_names',     scores: 'turnier10g_scores',  absent: 'turnier10g_missing', fields: 'turnier10g_fields',  start: 'turnier10g_start',  end: 'turnier10g_end',  title: 'turnier10g',  teams: 10, scoreKind: 'group' },
    'gruppen-12':  { prefix: 'turnier12',   names: 'turnier12_teamnames',  scores: 'turnier12_scores',   absent: 'turnier12_absent',   fields: 'turnier12_fields',   start: 'turnier12_start',   end: 'turnier12_end',   title: 'turnier12',   teams: 12, scoreKind: 'group' },
    'gruppen-16':  { prefix: 'turnier16g',  names: 'turnier16g_names',     scores: 'turnier16g_scores',  absent: 'turnier16g_absent',  fields: 'turnier16g_fields',  start: 'turnier16g_start',  end: 'turnier16g_end',  title: 'title_16g',   teams: 16, scoreKind: 'group' },
    'gruppen-ko-8':{ prefix: 'turnier8gko', names: 'turnier8gko_names',    scores: 'turnier8gko_scores', absent: 'turnier8gko_absent', fields: 'turnier8gko_fields', start: 'turnier8gko_start', end: 'turnier8gko_end', title: 'turnier8gko', teams: 8,  scoreKind: 'group' },
    'ko-8':        { prefix: 'turnier8ko',  names: 'turnier8ko_names',     scores: 'turnier8ko_scores',  absent: 'turnier8ko_absent',  fields: 'turnier8ko_fields',  start: 'turnier8ko_start',  end: 'turnier8ko_end',  title: 'turnier8ko',  teams: 8,  scoreKind: 'ko' }
  };

  /* Alte Score-IDs → neue matchId + Satz + Seite.
     flexrr : g<runde>_<team>      Satz1 | g2<runde>_<team> Satz2 | g3… Satz3
     swiss  : s<A|B>_<runde>_<idx> Satz1 | s2A_… Satz2 | s3A_… Satz3          */
  function parseLegacyScoreId(id, kind) {
    let m;
    if (kind === 'flexrr') {
      m = /^g([23]?)(\d+)_(\d+)$/.exec(id);
      if (!m) return null;
      const setNo = m[1] === '' ? 1 : parseInt(m[1], 10);
      return { matchId: 'rr_' + m[2], setNo, team: parseInt(m[3], 10), byTeam: true };
    }
    if (kind === 'swiss') {
      m = /^s([23]?)([AB])_(\d+)_(\d+)$/.exec(id);
      if (!m) return null;
      const setNo = m[1] === '' ? 1 : parseInt(m[1], 10);
      return { matchId: 'sw_' + m[3] + '_' + m[4], setNo, side: m[2] === 'A' ? 'a' : 'b' };
    }
    // Gruppen-/KO-Bögen: g<runde>_<team> bzw. <matchkey>_<h|a>
    m = /^g([23]?)(\d+)_(\d+)$/.exec(id);
    if (m) {
      const setNo = m[1] === '' ? 1 : parseInt(m[1], 10);
      return { matchId: 'grp_' + m[2], setNo, team: parseInt(m[3], 10), byTeam: true };
    }
    m = /^([a-z0-9]+)_([A-Z0-9]+)_(h|a)$/.exec(id);
    if (m) return { matchId: m[1] + '_' + m[2], setNo: 1, side: m[3] === 'h' ? 'a' : 'b' };
    return null;
  }

  function migrate(sheetId, cfgDefaults) {
    const L = LEGACY[sheetId];
    if (!L) return null;
    const s = ls(); if (!s) return null;

    const cfgRaw = L.cfg ? readJSON(L.cfg, null) : null;
    const names = L.names ? (readJSON(L.names, null) || {}) : {};
    const scores = L.scores ? (readJSON(L.scores, null) || {}) : {};
    const absentRaw = L.absent ? readJSON(L.absent, null) : null;
    const fields = L.fields ? (readJSON(L.fields, null) || {}) : {};
    let start = null, end = null, title = '';
    try { start = s.getItem(L.start); } catch (e) { }
    try { end = s.getItem(L.end); } catch (e) { }
    try { title = s.getItem(L.title) || ''; } catch (e) { }

    const nothing = !cfgRaw && !Object.keys(names).length && !Object.keys(scores).length
      && !absentRaw && !Object.keys(fields).length && !start && !end && !title;
    if (nothing) return null;

    const t = emptyTournament(sheetId, cfgDefaults);
    if (cfgRaw) {
      if (cfgRaw.teams != null) t.config.teams = +cfgRaw.teams;
      if (cfgRaw.t != null) t.config.teams = +cfgRaw.t;
      if (cfgRaw.fields != null) t.config.fields = +cfgRaw.fields;
      if (cfgRaw.r != null) t.config.rounds = +cfgRaw.r;
      if (cfgRaw.points != null) t.config.setMode = String(cfgRaw.points);
      if (cfgRaw.p != null) t.config.setMode = String(cfgRaw.p);
    }
    if (L.teams) t.config.teams = L.teams;
    if (start) t.config.startTime = start;
    if (end) t.config.endTime = end;
    if (title && title.length < 200) t.title = title;

    Object.keys(names).forEach(k => { if (names[k]) t.teamNames[k] = String(names[k]); });
    Object.keys(fields).forEach(k => {
      if (k === 'count') return;                 // Altlast: fehlgeleiteter Feldzähler
      if (fields[k]) t.fieldNames[k] = String(fields[k]);
    });

    if (Array.isArray(absentRaw)) t.absent = absentRaw.map(Number).filter(Boolean);
    else if (absentRaw && typeof absentRaw === 'object') {
      t.absent = Object.keys(absentRaw).filter(k => absentRaw[k]).map(Number).filter(Boolean);
    }

    /* Ergebnisse: bei "byTeam"-IDs (g<runde>_<team>) ist die Seite nicht direkt
       codiert. Wir sammeln sie je Match und ordnen sie nach Teamnummer –
       welche Seite das ist, entscheidet der Bogen beim Laden über die
       Paarung. Deshalb wird zusätzlich ein Rohbestand mitgeführt.            */
    const raw = {};
    Object.keys(scores).forEach(id => {
      const p = parseLegacyScoreId(id, L.scoreKind);
      if (!p) return;
      const val = scores[id];
      if (val === '' || val == null) return;
      if (p.byTeam) {
        raw[p.matchId] = raw[p.matchId] || {};
        raw[p.matchId][p.setNo] = raw[p.matchId][p.setNo] || {};
        raw[p.matchId][p.setNo][p.team] = parseInt(val, 10);
      } else {
        setScore(t, p.matchId, p.setNo, p.side, val);
      }
    });
    if (Object.keys(raw).length) t.legacyByTeam = raw;

    if (L.frozen) {
      const fr = readJSON(L.frozen, null);
      if (fr && typeof fr === 'object') t.frozen = fr;
    }
    if (L.frozenModes) {
      const fm = readJSON(L.frozenModes, null);
      if (fm && typeof fm === 'object') t.frozenModes = fm;
    }
    if (L.round1) {
      const r1 = readJSON(L.round1, null);
      if (Array.isArray(r1)) t.round1 = r1;
    }

    t.migratedFrom = L.prefix;
    save(t);
    return t;
  }

  /* Prüft, ob für einen Bogen noch migrierbare Altdaten vorliegen. */
  function hasLegacy(sheetId) {
    const L = LEGACY[sheetId]; if (!L) return false;
    const s = ls(); if (!s) return false;
    return [L.cfg, L.names, L.scores, L.absent, L.fields, L.title]
      .filter(Boolean)
      .some(k => { try { return s.getItem(k) != null; } catch (e) { return false; } });
  }

  /* Voreinstellung über die URL (?teams=8&fields=4&…).
     Die abgelösten Altbögen leiten als Stub hierher weiter und geben dabei ihre
     frühere feste Konfiguration mit. Das darf einen laufenden Bogen niemals
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

  return {
    SCHEMA, PREFIX, INDEX_KEY, LEGACY,
    emptyTournament, load, save, reset, normalize,
    setScore, getSets, clearScores,
    setManualStanding, getManualStandings, resetManualStandingRow, resetManualStandings,
    setManualPlacement, getManualPlacements, resetManualPlacementRow, resetManualPlacements,
    applyUrlConfig, urlInt, urlOneOf, urlBool,
    index, updateIndex, hasLegacy, migrate, parseLegacyScoreId,
    _readJSON: readJSON, _writeJSON: writeJSON
  };
});
