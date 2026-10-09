/* ============================================================================
   match-timer.js – Zustand des kostenlosen Einzelspiel-Timers (PRODUKTPLAN §6.5)

   Reine Logik ohne DOM: Stoppuhr (Start, Pause/Fortsetzen, Stopp,
   Zurücksetzen) und einfacher Spielstand für zwei frei benennbare Seiten.
   Sportartenneutral – keine Satz-/Punktregeln, keine Spielende-Erkennung.
   Optional: Countdown (countdownMs > 0, danach Nachspielzeit „+MM:SS“),
   Seitentausch, Rückgängig (Stapel früherer Spielstände) und ein von Hand
   ausgelöstes „Satz beenden“ (Satz geht an die Seite mit mehr Punkten).

   Zeitmodell: Gespeichert werden nur abgeschlossene Laufzeit
   (accumulatedMs) und der Wanduhr-Zeitpunkt, seit dem der Timer läuft
   (runningSince). Die Anzeige wird bei jedem Zeichnen daraus berechnet.
   Dadurch geht weder durch Hintergrund-Drosselung (gedrosselte Intervalle,
   App-Wechsel) noch durch einen Neustart der Seite/App Zeit verloren.
   Läuft die Geräteuhr rückwärts, zählt ein Abschnitt höchstens als 0 ms.

   Speicher: ein Eintrag in localStorage (BEACHL.matchTimer) – wie die
   Sprachwahl eine reine Geräte-/UI-Hilfe, KEINE Turnierdaten. Der Timer
   liest und schreibt nie TStore/IndexedDB/SQLite und verändert damit nie
   Turnierergebnisse; die offizielle Ergebniseingabe bleibt im Turnierbogen.

   Alle Übergänge liefern einen NEUEN Zustand; ein unzulässiger Übergang
   (z. B. Pause im Zustand „bereit“) liefert das unveränderte Objekt zurück.

   Safari 12: bewusst ES5 (kein ?. / ??, keine Arrow-Functions), AGENTS.md §7b.
   ========================================================================== */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TMatchTimer = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var VERSION = 1;
  var STORAGE_KEY = 'BEACHL.matchTimer';
  var MAX_SCORE = 999;
  var MAX_NAME = 40;
  var MAX_UNDO = 30;
  var MAX_SETS = 9;
  var MAX_COUNTDOWN_MS = 180 * 60000;
  var SIDES = ['a', 'b'];
  var STATUSES = ['idle', 'running', 'paused', 'stopped'];
  /* Rückweg aus dem Timer: nur Seiten dieser App, relativ, ohne #Hash
     (ein #share=-Hash würde beim Zurückkehren erneut importiert). */
  /* Beach-Regeln als Vorgabe: Sätze bis 21, Entscheidungssatz bis 15. Ein
     Turnierbogen kann eigene Satzziele mitgeben (?t=21,21,15). */
  var DEFAULT_TARGETS = [21, 21, 15];
  var SWITCH_AUTO = 0;
  var SWITCH_OFF = -1;
  var SWITCH_OPTIONS = [3, 4, 5, 6, 7, 8, 9, 10];
  var MAX_TARGETS = 5;
  var MAX_REF = 80;
  var RETURN_PAGE = /^(?:index\.html|Turnierbogen_[A-Za-z0-9_]+\.html)(?:\?[^#\s\\]*)?$/;

  function isSide(side) { return side === 'a' || side === 'b'; }
  function finiteNonNeg(n) { return typeof n === 'number' && isFinite(n) && n >= 0; }
  function clampScore(n) {
    n = Math.floor(Number(n));
    if (!isFinite(n) || n < 0) return 0;
    return n > MAX_SCORE ? MAX_SCORE : n;
  }
  function cleanName(raw) {
    return String(raw == null ? '' : raw).replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '').slice(0, MAX_NAME);
  }

  function create() {
    return {
      v: VERSION,
      status: 'idle',
      accumulatedMs: 0,
      runningSince: null,
      names: { a: '', b: '' },
      score: { a: 0, b: 0 },
      sets: { a: 0, b: 0 },
      setHistory: [],
      undo: [],
      countdownMs: 0,
      sound: false,
      keepAwake: false,
      compact: false,
      clockEnabled: true,
      switchPts: 0,
      match: null
    };
  }

  function copyPair(p) { return { a: p.a, b: p.b }; }
  /* Spielstands-Schnappschuss für „Rückgängig“. */
  function snapshot(s) {
    return { score: copyPair(s.score), sets: copyPair(s.sets), setHistory: s.setHistory.map(copyPair) };
  }

  function clone(s) {
    return {
      v: VERSION,
      status: s.status,
      accumulatedMs: s.accumulatedMs,
      runningSince: s.runningSince,
      names: { a: s.names.a, b: s.names.b },
      score: { a: s.score.a, b: s.score.b },
      sets: copyPair(s.sets),
      setHistory: s.setHistory.map(copyPair),
      undo: s.undo.map(function (u) {
        return { score: copyPair(u.score), sets: copyPair(u.sets), setHistory: u.setHistory.map(copyPair) };
      }),
      countdownMs: s.countdownMs,
      sound: !!s.sound,
      keepAwake: !!s.keepAwake,
      compact: !!s.compact,
      clockEnabled: s.clockEnabled !== false,
      switchPts: s.switchPts,
      match: s.match ? { ref: s.match.ref, targets: s.match.targets.slice(), swapped: !!s.match.swapped } : null
    };
  }

  function segmentMs(s, now) {
    if (s.status !== 'running' || s.runningSince == null) return 0;
    var d = Number(now) - s.runningSince;
    return isFinite(d) && d > 0 ? d : 0;
  }

  /* Verstrichene Spielzeit in ms zum Zeitpunkt now (Wanduhr, ms). */
  function elapsed(s, now) {
    return s.accumulatedMs + segmentMs(s, now);
  }

  function start(s, now) {
    if (s.status !== 'idle') return s;
    var n = clone(s);
    n.status = 'running';
    n.accumulatedMs = 0;
    n.runningSince = Number(now);
    return n;
  }

  function pause(s, now) {
    if (s.status !== 'running') return s;
    var n = clone(s);
    n.accumulatedMs = s.accumulatedMs + segmentMs(s, now);
    n.runningSince = null;
    n.status = 'paused';
    return n;
  }

  /* Auch nach „Stopp“ möglich, damit ein versehentliches Stoppen keine
     Spielzeit kostet. */
  function resume(s, now) {
    if (s.status !== 'paused' && s.status !== 'stopped') return s;
    var n = clone(s);
    n.status = 'running';
    n.runningSince = Number(now);
    return n;
  }

  function stop(s, now) {
    if (s.status !== 'running' && s.status !== 'paused') return s;
    var n = clone(s);
    n.accumulatedMs = s.accumulatedMs + segmentMs(s, now);
    n.runningSince = null;
    n.status = 'stopped';
    return n;
  }

  /* Zeit, Spielstand und Sätze auf 0; Seitennamen, Countdown-Dauer und
     Einstellungen bleiben. */
  function reset(s) {
    if (!hasProgress(s)) return s;
    var n = clone(s);
    n.status = 'idle';
    n.accumulatedMs = 0;
    n.runningSince = null;
    n.score = { a: 0, b: 0 };
    n.sets = { a: 0, b: 0 };
    n.setHistory = [];
    n.undo = [];
    return n;
  }

  /* Nur die Zeit auf Anfang (bzw. volle Countdown-Dauer); Spielstand,
     Sätze und Rückgängig bleiben. */
  function hasTime(s) {
    return s.status !== 'idle' || s.accumulatedMs > 0;
  }
  function resetTime(s) {
    if (!hasTime(s)) return s;
    var n = clone(s);
    n.status = 'idle';
    n.accumulatedMs = 0;
    n.runningSince = null;
    return n;
  }

  /* ------------------------------------------------------------ Countdown
     0 = Stoppuhr (aufwärts). Nur im Zustand „bereit“ änderbar, damit eine
     laufende Spielzeit nie umgedeutet wird. */
  function setCountdown(s, ms) {
    if (s.status !== 'idle') return s;
    var v = Math.round(Number(ms));
    if (!isFinite(v) || v < 0) v = 0;
    if (v > MAX_COUNTDOWN_MS) v = MAX_COUNTDOWN_MS;
    if (v === s.countdownMs) return s;
    var n = clone(s);
    n.countdownMs = v;
    return n;
  }
  /* Restzeit in ms (negativ = Nachspielzeit); null im Stoppuhr-Modus. */
  function remaining(s, now) {
    return s.countdownMs > 0 ? s.countdownMs - elapsed(s, now) : null;
  }
  function isExpired(s, now) {
    var r = remaining(s, now);
    return r != null && r <= 0;
  }
  /* Anzeige der Uhr: Stoppuhr „MM:SS“; Countdown aufgerundet (zeigt 00:00
     genau beim Ablauf), danach Nachspielzeit „+MM:SS“. */
  function formatClock(s, now) {
    var r = remaining(s, now);
    if (r == null) return formatElapsed(elapsed(s, now));
    if (r > 0) return formatElapsed(Math.ceil(r / 1000) * 1000);
    return r === 0 ? formatElapsed(0) : '+' + formatElapsed(-r);
  }

  /* Haupttaste: 'start' | 'pause' | 'resume' | 'clear'. Nach „Stopp“ ist die
     Endzeit eingefroren; die Haupttaste setzt dann nur die Uhr zurück
     (Spielstand bleibt), „Weiter“ hebt ein versehentliches Stoppen auf. */
  function primaryAction(s) {
    if (s.status === 'running') return 'pause';
    if (s.status === 'idle') return 'start';
    if (s.status === 'stopped') return 'clear';
    return 'resume';
  }
  function canStop(s) { return s.status === 'running' || s.status === 'paused'; }
  function hasProgress(s) {
    return s.status !== 'idle' || s.accumulatedMs > 0 || s.score.a > 0 || s.score.b > 0 ||
      s.sets.a > 0 || s.sets.b > 0 || s.setHistory.length > 0;
  }

  /* ---------------------------------------------------------- Spielstand
     Spielstandsänderungen verändern die Zeitfelder nie. Jede Änderung legt
     den vorherigen Stand auf den Rückgängig-Stapel. */
  function pushUndo(n, prev) {
    n.undo.push(snapshot(prev));
    if (n.undo.length > MAX_UNDO) n.undo.splice(0, n.undo.length - MAX_UNDO);
  }
  function setScoreValue(s, side, value) {
    if (!isSide(side)) return s;
    var v = clampScore(value);
    if (v === s.score[side]) return s;
    var n = clone(s);
    pushUndo(n, s);
    n.score[side] = v;
    return n;
  }
  function canUndo(s) { return s.undo.length > 0; }
  function undo(s) {
    if (!canUndo(s)) return s;
    var n = clone(s);
    var u = n.undo.pop();
    n.score = u.score;
    n.sets = u.sets;
    n.setHistory = u.setHistory;
    return n;
  }

  /* Satz beenden: geht an die Seite mit mehr Punkten (sportartenneutral,
     keine Regelprüfung); Punkte werden in der Satzliste vermerkt und auf 0
     gesetzt. Bei Gleichstand nicht möglich. */
  function canEndSet(s) {
    return s.score.a !== s.score.b && s.setHistory.length < MAX_SETS;
  }
  function endSet(s) {
    if (!canEndSet(s)) return s;
    var n = clone(s);
    pushUndo(n, s);
    n.sets[s.score.a > s.score.b ? 'a' : 'b'] += 1;
    n.setHistory.push(copyPair(s.score));
    n.score = { a: 0, b: 0 };
    return n;
  }

  /* Seitenwechsel: Namen, Punkte, Sätze (und der Rückgängig-Stapel)
     wechseln gemeinsam die Seite – die Zeit bleibt unberührt. */
  function flip(p) { return { a: p.b, b: p.a }; }
  function swapSides(s) {
    var n = clone(s);
    n.names = flip(s.names);
    n.score = flip(s.score);
    n.sets = flip(s.sets);
    n.setHistory = s.setHistory.map(flip);
    if (n.match) n.match.swapped = !n.match.swapped;
    n.undo = n.undo.map(function (u) {
      return { score: flip(u.score), sets: flip(u.sets), setHistory: u.setHistory.map(flip) };
    });
    return n;
  }
  function addPoint(s, side, delta) {
    if (!isSide(side)) return s;
    var d = delta == null ? 1 : Math.round(Number(delta));
    if (!isFinite(d) || d === 0) return s;
    return setScoreValue(s, side, s.score[side] + d);
  }
  /* Direkteingabe: nur ganze Zahlen 0…999 (Leerraum erlaubt), sonst null. */
  function parseScore(raw) {
    var m = /^\s*(\d{1,3})\s*$/.exec(String(raw == null ? '' : raw));
    return m ? parseInt(m[1], 10) : null;
  }
  function setScore(s, side, raw) {
    var v = parseScore(raw);
    return v == null ? s : setScoreValue(s, side, v);
  }

  function setName(s, side, raw) {
    if (!isSide(side)) return s;
    var v = cleanName(raw);
    if (v === s.names[side]) return s;
    var n = clone(s);
    n.names[side] = v;
    return n;
  }
  /* Beide Namen auf einmal (Übernahme aus dem Turnierbogen). */
  function setNames(s, a, b) {
    return setName(setName(s, 'a', a), 'b', b);
  }
  function setSound(s, on) {
    if (!!on === !!s.sound) return s;
    var n = clone(s);
    n.sound = !!on;
    return n;
  }
  function setKeepAwake(s, on) {
    if (!!on === !!s.keepAwake) return s;
    var n = clone(s);
    n.keepAwake = !!on;
    return n;
  }
  function setCompact(s, on) {
    if (!!on === !!s.compact) return s;
    var n = clone(s);
    n.compact = !!on;
    return n;
  }
  function setClockEnabled(s, on, now) {
    on = !!on;
    if (on === s.clockEnabled) return s;
    var n = clone(!on && s.status === 'running' ? pause(s, now) : s);
    n.clockEnabled = on;
    return n;
  }

  /* ------------------------------------------------- Regeln (nur Hinweise)
     Der Timer beendet nie selbst einen Satz; er weist nur auf Satzgewinn
     und Seitenwechsel hin (Beach: alle 7 Punkte, im Satz bis 15 alle 5). */
  function cleanTargets(list) {
    if (!Array.isArray(list)) return [];
    return list.slice(0, MAX_TARGETS).map(function (t) { return Math.floor(Number(t)); })
      .filter(function (t) { return isFinite(t) && t >= 1 && t <= 99; });
  }
  function targets(s) {
    return s.match && s.match.targets.length ? s.match.targets : DEFAULT_TARGETS;
  }
  function setTarget(s) {
    var t = targets(s);
    return t[Math.min(s.setHistory.length, t.length - 1)];
  }
  function switchEvery(target) { return Math.max(1, Math.round(target / 3)); }
  /* Seitenwechsel-Einstellung: SWITCH_AUTO (nach Satzziel), SWITCH_OFF oder
     feste Punktzahl. Bleibt beim Zurücksetzen erhalten (wie Ton). */
  function cleanSwitchPts(v) {
    v = Number(v);
    if (v === SWITCH_OFF) return SWITCH_OFF;
    return SWITCH_OPTIONS.indexOf(v) >= 0 ? v : SWITCH_AUTO;
  }
  function setSwitchPts(s, v) {
    v = cleanSwitchPts(v);
    if (v === s.switchPts) return s;
    var n = clone(s);
    n.switchPts = v;
    return n;
  }
  /* Punkte zwischen zwei Seitenwechseln im laufenden Satz; 0 = aus. */
  function switchInterval(s) {
    if (s.switchPts === SWITCH_OFF) return 0;
    return s.switchPts > 0 ? s.switchPts : switchEvery(setTarget(s));
  }
  /* Seite, die den laufenden Satz gewonnen hat (Ziel erreicht, 2 Punkte
     Vorsprung) – sonst null. */
  function setWinner(s) {
    var a = s.score.a, b = s.score.b;
    var hi = Math.max(a, b), lo = Math.min(a, b);
    return hi >= setTarget(s) && hi - lo >= 2 ? (a > b ? 'a' : 'b') : null;
  }
  function isSideSwitch(s) {
    var total = s.score.a + s.score.b;
    var every = switchInterval(s);
    return every > 0 && total > 0 && !setWinner(s) && total % every === 0;
  }

  /* ---------------------------------------------- Spiel aus dem Turnierbogen
     ref = Spiel-ID im Bogen; targets = Satzziele der Satzspalten. swapped
     merkt sich Seitentausche, damit das Ergebnis richtig herum zurückgeht. */
  function setMatch(s, ref, list) {
    var r = String(ref == null ? '' : ref).slice(0, MAX_REF);
    var t = cleanTargets(list);
    var n = clone(s);
    n.match = r && t.length ? { ref: r, targets: t, swapped: false } : null;
    return n;
  }
  function matchComplete(s) {
    if (!s.match || !s.setHistory.length) return false;
    var count = s.match.targets.length;
    var need = Math.floor(count / 2) + 1;
    return s.setHistory.length >= count || s.sets.a >= need || s.sets.b >= need;
  }
  /* Satzergebnisse in Bogen-Ausrichtung ([{a,b}…]) – nur bei fertigem Spiel. */
  function resultFor(s) {
    if (!matchComplete(s) || s.setHistory.length > s.match.targets.length) return null;
    var sw = s.match.swapped;
    return s.setHistory.map(function (p) { return sw ? flip(p) : copyPair(p); });
  }

  /* ------------------------------------------------------ Serialisierung */
  function serialize(s) { return JSON.stringify(clone(s)); }

  function parsePair(p) {
    p = p && typeof p === 'object' ? p : {};
    return {
      a: typeof p.a === 'number' ? clampScore(p.a) : 0,
      b: typeof p.b === 'number' ? clampScore(p.b) : 0
    };
  }
  function parsePairs(list, max) {
    return Array.isArray(list) ? list.slice(0, max).map(parsePair) : [];
  }

  /* Gespeicherten Text prüfen und bereinigen. → Zustand oder null
     (fehlt, kein JSON, andere Version). Beschädigte Einzelwerte werden auf
     sichere Werte gesetzt, statt den ganzen Stand zu verwerfen. */
  function parse(text) {
    if (text == null || text === '') return null;
    var raw;
    try { raw = JSON.parse(String(text)); } catch (e) { return null; }
    if (!raw || typeof raw !== 'object' || raw.v !== VERSION) return null;
    var s = create();
    if (STATUSES.indexOf(raw.status) >= 0) s.status = raw.status;
    s.accumulatedMs = finiteNonNeg(raw.accumulatedMs) ? raw.accumulatedMs : 0;
    if (s.status === 'running') {
      if (finiteNonNeg(raw.runningSince)) s.runningSince = raw.runningSince;
      else s.status = 'paused';
    }
    var names = raw.names && typeof raw.names === 'object' ? raw.names : {};
    SIDES.forEach(function (side) {
      s.names[side] = typeof names[side] === 'string' ? cleanName(names[side]) : '';
    });
    s.score = parsePair(raw.score);
    s.sets = parsePair(raw.sets);
    s.setHistory = parsePairs(raw.setHistory, MAX_SETS);
    if (Array.isArray(raw.undo)) {
      s.undo = raw.undo.slice(-MAX_UNDO).filter(function (u) {
        return u && typeof u === 'object';
      }).map(function (u) {
        return { score: parsePair(u.score), sets: parsePair(u.sets), setHistory: parsePairs(u.setHistory, MAX_SETS) };
      });
    }
    if (finiteNonNeg(raw.countdownMs) && raw.countdownMs <= MAX_COUNTDOWN_MS) s.countdownMs = Math.round(raw.countdownMs);
    s.sound = raw.sound === true;
    s.keepAwake = raw.keepAwake === true;
    s.compact = raw.compact === true;
    s.clockEnabled = raw.clockEnabled !== false;
    s.switchPts = cleanSwitchPts(raw.switchPts);
    var m = raw.match;
    if (m && typeof m === 'object' && typeof m.ref === 'string' && m.ref) {
      var t = cleanTargets(m.targets);
      if (t.length) s.match = { ref: m.ref.slice(0, MAX_REF), targets: t, swapped: m.swapped === true };
    }
    return s;
  }

  /* → { state, readable }. readable=false: Speicher nicht lesbar. */
  function load(storage) {
    var text = null;
    try {
      if (!storage) return { state: create(), readable: false };
      text = storage.getItem(STORAGE_KEY);
    } catch (e) {
      return { state: create(), readable: false };
    }
    return { state: parse(text) || create(), readable: true };
  }

  /* → true, wenn der Stand nachweislich gespeichert ist. */
  function save(storage, s) {
    if (!storage) return false;
    var text = serialize(s);
    try {
      storage.setItem(STORAGE_KEY, text);
      return storage.getItem(STORAGE_KEY) === text;
    } catch (e) {
      return false;
    }
  }

  /* -------------------------------------------------------------- Anzeige */
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  /* 'MM:SS', ab einer Stunde 'H:MM:SS'. */
  function formatElapsed(ms) {
    var total = Math.floor((finiteNonNeg(ms) ? ms : 0) / 1000);
    var h = Math.floor(total / 3600);
    var m = Math.floor((total % 3600) / 60);
    var sec = total % 60;
    return h > 0 ? h + ':' + pad2(m) + ':' + pad2(sec) : pad2(m) + ':' + pad2(sec);
  }

  /* Teamnamen aus dem Aufruf (?a=…&b=…) – bereinigt; null, wenn beide leer. */
  /* Wer liegt vorn? Für Punkte ({a,b}) und Sätze gleichermaßen. */
  function leader(pair) {
    var d = (pair && pair.a || 0) - (pair && pair.b || 0);
    return { side: d > 0 ? 'a' : (d < 0 ? 'b' : null), diff: Math.abs(d) };
  }

  /* Gesamtpunkte des Spiels: alle beendeten Sätze plus laufender Satz. */
  function totals(s) {
    var t = { a: s.score.a, b: s.score.b };
    s.setHistory.forEach(function (p) { t.a += p.a; t.b += p.b; });
    return t;
  }

  function prefillNames(a, b) {
    var na = cleanName(a), nb = cleanName(b);
    return na || nb ? { a: na, b: nb } : null;
  }

  /* Rückweg (?from=) prüfen: nur relative App-Seiten, sonst null. */
  function returnTarget(from) {
    var s = String(from == null ? '' : from);
    if (!s || s.length > 500 || s.indexOf('..') >= 0) return null;
    return RETURN_PAGE.test(s) ? s : null;
  }

  return {
    VERSION: VERSION,
    STORAGE_KEY: STORAGE_KEY,
    MAX_SCORE: MAX_SCORE,
    MAX_NAME: MAX_NAME,
    create: create,
    elapsed: elapsed,
    start: start,
    pause: pause,
    resume: resume,
    stop: stop,
    reset: reset,
    resetTime: resetTime,
    hasTime: hasTime,
    primaryAction: primaryAction,
    canStop: canStop,
    hasProgress: hasProgress,
    addPoint: addPoint,
    undo: undo,
    canUndo: canUndo,
    endSet: endSet,
    canEndSet: canEndSet,
    swapSides: swapSides,
    setCountdown: setCountdown,
    remaining: remaining,
    isExpired: isExpired,
    formatClock: formatClock,
    setNames: setNames,
    prefillNames: prefillNames,
    leader: leader,
    setTarget: setTarget,
    switchEvery: switchEvery,
    switchInterval: switchInterval,
    setSwitchPts: setSwitchPts,
    SWITCH_AUTO: SWITCH_AUTO,
    SWITCH_OFF: SWITCH_OFF,
    SWITCH_OPTIONS: SWITCH_OPTIONS,
    setWinner: setWinner,
    isSideSwitch: isSideSwitch,
    setMatch: setMatch,
    matchComplete: matchComplete,
    resultFor: resultFor,
    totals: totals,
    MAX_SETS: MAX_SETS,
    parseScore: parseScore,
    setScore: setScore,
    setName: setName,
    setSound: setSound,
    setKeepAwake: setKeepAwake,
    setCompact: setCompact,
    setClockEnabled: setClockEnabled,
    serialize: serialize,
    parse: parse,
    load: load,
    save: save,
    formatElapsed: formatElapsed,
    returnTarget: returnTarget
  };
});
