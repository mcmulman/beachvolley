/* ============================================================================
   planning-engine.js – Spielplanung während des Turniers (DOM-frei, rein)

   Passt einen fertig gebauten Zeitplan (TFormat.build / buildRounds /
   buildKingQueen) an: neu takten ab Uhrzeit, Felder sperren (ab Uhrzeit oder
   ab Runde), Pausen einschieben. Gespielte/begonnene Spiele sind über
   config.planning.locked fixiert und bewegen sich nie.

   Vertrag:
     TPlanning.apply(basePlan, config, results) → angepasster Plan
       config.planning = {
         retime:  { time: 'HH:MM' } | { min: <Minuten> },
         rescheduled: { [matchId]: { time: 'HH:MM' } },
         teamDelays: { [teamId]: { time: 'HH:MM' } },
         blocked: [{ field, time } | { field, min } | { field, fromRound }],
         breaks:  [{ id, time | min, minutes }],
         locked:  { [matchId]: { startMin, endMin, field } }
       }
     - Ohne wirksame Planung wird basePlan selbst (identisch) zurückgegeben.
     - Sonst: flache Kopie von basePlan mit neuen Slots (grpSlots/finSlots bzw.
       slots), slot.matches = Array der Länge „Felder“, freie Felder = null.
     - Ungültige/unmögliche Planung → RangeError mit err.code (kein stilles
       Ignorieren). King/Queen of the Court wird nicht unterstützt (TypeError).
     - fromRound zählt die Runden in Spielplan-Reihenfolge (1-basiert, über
       Gruppen- und Finalphase hinweg).

   Safari 12: kein ?. / ?? / flatMap / Object.fromEntries.
   ========================================================================== */
(function (root, factory) {
  const api = factory(root.TC || (typeof require === 'function' ? require('./turnier-core.js') : null));
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TPlanning = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (TC) {
  'use strict';

  const DAY = 1440;

  function fail(Ctor, code, message) {
    const err = new Ctor('TPlanning: ' + message);
    err.code = code;
    return err;
  }

  function hidden(obj, name, value) {
    Object.defineProperty(obj, name, { value: value, enumerable: false, configurable: true, writable: true });
  }

  /* ------------------------------------------------------------ Plan-Zugriff */
  function isFormatPlan(plan) {
    return !!plan && (Array.isArray(plan.grpSlots) || Array.isArray(plan.finSlots));
  }
  function isKingOfCourt(plan) {
    return !!plan && plan.courtCount != null && plan.perRound != null;
  }

  function slots(plan) {
    if (!plan) return [];
    if (isFormatPlan(plan)) return (plan.grpSlots || []).concat(plan.finSlots || []);
    return Array.isArray(plan.slots) ? plan.slots.slice() : [];
  }

  function slotMinutes(s) {
    return Number.isFinite(s.minutes) && s.minutes > 0 ? s.minutes : (s.endMin - s.startMin);
  }

  function fieldCountOf(plan, config) {
    const candidates = [plan && plan.fields, plan && plan.config && plan.config.fields, config && config.fields];
    for (let i = 0; i < candidates.length; i++) {
      const n = Number(candidates[i]) | 0;
      if (n > 0) return n;
    }
    return 1;
  }

  function hasInput(results, id) {
    if (!results || id == null || !Object.prototype.hasOwnProperty.call(results, id)) return false;
    return hasValue(results[id]);
  }
  function hasValue(v) {
    if (v == null) return false;
    if (typeof v === 'number') return Number.isFinite(v);
    if (typeof v === 'string') return v.trim() !== '';
    if (typeof v === 'boolean') return v;
    if (Array.isArray(v)) return v.some(hasValue);
    if (typeof v === 'object') return Object.keys(v).some(k => hasValue(v[k]));
    return false;
  }

  /* Baseline in Runden zerlegen: [{ key, source, round, ordinal, slots, items }] */
  function baselineRounds(plan) {
    const sources = isFormatPlan(plan)
      ? [{ source: 'grp', list: plan.grpSlots || [] }, { source: 'fin', list: plan.finSlots || [] }]
      : [{ source: 'slots', list: plan.slots || [] }];
    const rounds = [];
    const byKey = {};
    sources.forEach(src => src.list.forEach(s => {
      const key = src.source + ':' + s.round;
      let rd = byKey[key];
      if (!rd) {
        rd = byKey[key] = { key: key, source: src.source, round: s.round, ordinal: rounds.length + 1, slots: [], items: [] };
        rounds.push(rd);
      }
      rd.slots.push(s);
      if (s.displayOnly) return;
      (s.matches || []).forEach((m, idx) => {
        if (!m) return;
        rd.items.push({ m: m, id: m.id, field: idx, baseSlot: s, start: s.startMin, minutes: slotMinutes(s), rd: rd });
      });
    }));
    return rounds;
  }

  function teamKeysFn(plan) {
    const resolve = typeof plan.resolve === 'function' ? plan.resolve : null;
    function one(ref, out) {
      if (ref == null) return;
      let t = typeof ref === 'number' ? ref : null;
      if (t == null && resolve) t = resolve(ref);
      if (t != null && t !== 0) out.push('t' + t);
    }
    return function (m) {
      const out = [];
      if (Array.isArray(m.teamA) || Array.isArray(m.teamB)) {
        (m.teamA || []).concat(m.teamB || []).forEach(p => { if (p != null) out.push('p' + p); });
        return out;
      }
      one(m.a, out); one(m.b, out);
      return out;
    };
  }

  /* --------------------------------------------------- Normalisierung/Prüfung */
  function clockToMin(value, refMin) {
    let m = null;
    if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value) : null;
    const rx = /^(\d{1,2}):(\d{2})$/.exec(String(value == null ? '' : value).trim());
    if (rx && +rx[1] < 24 && +rx[2] < 60) m = (+rx[1]) * 60 + (+rx[2]);
    if (m == null) return null;
    /* Uhrzeit auf den Turniertag beziehen: bis 6 h vor bis 18 h nach Start
       (Turniere über Mitternacht behalten fortlaufende Minuten > 1440). */
    const lo = refMin - 360;
    while (m < lo) m += DAY;
    while (m >= lo + DAY) m -= DAY;
    return m;
  }
  function pointOf(entry, refMin, code, what) {
    const raw = entry.min != null ? entry.min : entry.time;
    const v = clockToMin(raw, refMin);
    if (v == null) throw fail(RangeError, code, 'invalid ' + what + ' time ' + JSON.stringify(raw));
    return v;
  }

  function isEmptyPlanning(p) {
    if (!p || typeof p !== 'object') return true;
    return !p.retime && !(p.rescheduled && Object.keys(p.rescheduled).length)
      && !(p.teamDelays && Object.keys(p.teamDelays).length)
      && p.fillForward !== true
      && !(p.blocked && p.blocked.length) && !(p.breaks && p.breaks.length)
      && !(p.locked && Object.keys(p.locked).length);
  }

  function normalize(planning, base, F, rounds) {
    const p = planning || {};
    const ref = base.startMin;
    const teamsOf = teamKeysFn(base);
    const out = { retimeMin: null, rescheduled: {}, teamDelays: {}, fillForward: p.fillForward === true, blocks: [], pauses: [], locked: {} };
    if (p.retime) out.retimeMin = pointOf(p.retime, ref, 'invalid-time', 'retime');

    (p.blocked || []).forEach((b, i) => {
      if (!b || typeof b !== 'object') throw fail(RangeError, 'invalid-block', 'block #' + i + ' is not an object');
      const field = b.field;
      if (!Number.isInteger(field) || field < 0 || field >= F) {
        throw fail(RangeError, 'invalid-block', 'block field ' + field + ' outside 0..' + (F - 1));
      }
      const hasTime = b.time != null || b.min != null;
      const hasRound = b.fromRound != null;
      if (hasTime === hasRound) throw fail(RangeError, 'invalid-block', 'block needs exactly one of time/min or fromRound');
      if (hasRound) {
        if (!Number.isInteger(b.fromRound) || b.fromRound < 1) {
          throw fail(RangeError, 'invalid-block', 'fromRound must be an integer >= 1');
        }
        out.blocks.push({ field: field, fromMin: null, fromRound: b.fromRound });
      } else {
        out.blocks.push({ field: field, fromMin: pointOf(b, ref, 'invalid-block', 'block'), fromRound: null });
      }
    });

    const ids = {};
    (p.breaks || []).forEach((b, i) => {
      if (!b || typeof b !== 'object') throw fail(RangeError, 'invalid-break', 'break #' + i + ' is not an object');
      const minutes = Number(b.minutes);
      if (!Number.isInteger(minutes) || minutes <= 0 || minutes > DAY) {
        throw fail(RangeError, 'invalid-break', 'break minutes must be an integer 1..1440');
      }
      const start = pointOf(b, ref, 'invalid-break', 'break');
      let id = b.id != null && String(b.id) !== '' ? String(b.id) : 'break-' + (i + 1);
      if (ids[id]) throw fail(RangeError, 'invalid-break', 'duplicate break id ' + id);
      ids[id] = true;
      out.pauses.push({ id: id, startMin: start, endMin: start + minutes, minutes: minutes });
    });
    out.pauses.sort((x, y) => x.startMin - y.startMin || x.endMin - y.endMin);

    const known = {};
    rounds.forEach(rd => rd.items.forEach(it => { known[it.id] = it; }));
    Object.keys(p.rescheduled || {}).forEach(id => {
      if (!known[id]) return;
      const entry = p.rescheduled[id];
      if (!entry || typeof entry !== 'object') {
        throw fail(RangeError, 'invalid-rescheduled-time', 'reschedule for ' + id + ' is not an object');
      }
      const min = pointOf(entry, ref, 'invalid-rescheduled-time', 'reschedule');
      if (min <= known[id].start) {
        throw fail(RangeError, 'invalid-rescheduled-time', 'reschedule for ' + id + ' must be later than its original start');
      }
      out.rescheduled[id] = min;
    });
    Object.keys(p.teamDelays || {}).forEach(id => {
      if (!/^[1-9]\d*$/.test(id)) {
        throw fail(RangeError, 'invalid-team-delay', 'team delay id must be a positive integer');
      }
      const entry = p.teamDelays[id];
      if (!entry || typeof entry !== 'object') {
        throw fail(RangeError, 'invalid-team-delay', 'delay for team ' + id + ' is not an object');
      }
      const min = pointOf(entry, ref, 'invalid-team-delay', 'team delay');
      out.teamDelays['t' + id] = min;
      out.teamDelays['p' + id] = min;
    });
    if (out.fillForward) {
      if (base.mode !== 'rr') {
        throw fail(RangeError, 'unsupported-forward-fill', 'forward scheduling is available only for fixed round-robin pairings');
      }
      rounds.forEach(rd => rd.items.forEach(it => {
        if (teamsOf(it.m).length !== 2) {
          throw fail(RangeError, 'unresolved-forward-fill', 'forward scheduling requires known teams in every match');
        }
      }));
    }
    const locked = p.locked || {};
    Object.keys(locked).forEach(id => {
      if (!known[id]) return;               // Spiel existiert in diesem Plan nicht (mehr)
      const l = locked[id];
      const s = l && Number(l.startMin), e = l && Number(l.endMin), f = l && l.field;
      if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) {
        throw fail(RangeError, 'invalid-lock', 'lock for ' + id + ' needs startMin < endMin');
      }
      if (!Number.isInteger(f) || f < 0 || f >= F) {
        throw fail(RangeError, 'locked-field', 'locked match ' + id + ' uses field ' + f + ' outside 0..' + (F - 1));
      }
      out.locked[id] = { startMin: s, endMin: e, field: f };
    });

    /* Mindestens ein Feld muss in jeder künftigen Runde/Zeit frei bleiben. */
    const timeBlocked = {};
    out.blocks.forEach(b => { if (b.fromMin != null) timeBlocked[b.field] = true; });
    const lastOrdinal = Math.max(rounds.length, 1);
    for (let r = 1; r <= lastOrdinal; r++) {
      const set = Object.assign({}, timeBlocked);
      out.blocks.forEach(b => { if (b.fromRound != null && r >= b.fromRound) set[b.field] = true; });
      if (Object.keys(set).length >= F) {
        throw fail(RangeError, 'no-field', 'at least one field must remain available (round ' + r + ')');
      }
    }
    return out;
  }

  function overlaps(s1, e1, s2, e2) { return s1 < e2 && e1 > s2; }

  function fieldBlocked(blocks, field, ordinal, start, end) {
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      if (b.field !== field) continue;
      if (b.fromRound != null && ordinal >= b.fromRound) return true;
      if (b.fromMin != null && end > b.fromMin) return true;
    }
    return false;
  }

  /* ------------------------------------------------------------- Kernplanung */
  function schedule(base, F, norm) {
    const rounds = baselineRounds(base);
    const teamsOf = teamKeysFn(base);
    const fixed = [];
    rounds.forEach(rd => rd.items.forEach(it => {
      const l = norm.locked[it.id];
      if (!l) return;
      fixed.push({ it: it, startMin: l.startMin, endMin: l.endMin, field: l.field, teams: teamsOf(it.m), ordinal: rd.ordinal });
    }));

    fixed.forEach((a, i) => {
      for (let j = i + 1; j < fixed.length; j++) {
        const b = fixed[j];
        if (!overlaps(a.startMin, a.endMin, b.startMin, b.endMin)) continue;
        if (a.field === b.field) throw fail(RangeError, 'locked-overlap', 'locked matches ' + a.it.id + ' and ' + b.it.id + ' share field ' + a.field);
        if (a.teams.some(t => b.teams.indexOf(t) >= 0)) throw fail(RangeError, 'locked-overlap', 'locked matches ' + a.it.id + ' and ' + b.it.id + ' share a team');
      }
      norm.pauses.forEach(p => {
        if (overlaps(a.startMin, a.endMin, p.startMin, p.endMin)) {
          throw fail(RangeError, 'pause-locked', 'break ' + p.id + ' overlaps started/finished match ' + a.it.id);
        }
      });
      if (fieldBlocked(norm.blocks, a.field, a.ordinal, a.startMin, a.endMin)) {
        throw fail(RangeError, 'block-locked', 'blocked field ' + a.field + ' is used by started/finished match ' + a.it.id);
      }
    });

    function afterPauses(t, d) {
      let moved = true;
      while (moved) {
        moved = false;
        for (let i = 0; i < norm.pauses.length; i++) {
          const p = norm.pauses[i];
          if (overlaps(t, t + d, p.startMin, p.endMin)) { t = p.endMin; moved = true; }
        }
      }
      return t;
    }
    function nextEvent(t) {
      let n = Infinity;
      fixed.forEach(x => { if (x.endMin > t && x.endMin < n) n = x.endMin; });
      norm.pauses.forEach(p => { if (p.endMin > t && p.endMin < n) n = p.endMin; });
      return n;
    }

    const placed = {};                       // roundKey → [{ it, startMin, endMin, field, locked }]
    rounds.forEach(rd => { placed[rd.key] = []; });
    fixed.forEach(x => placed[x.it.rd.key].push({ it: x.it, startMin: x.startMin, endMin: x.endMin, field: x.field, locked: true }));

    if (norm.fillForward) {
      const allPlaced = fixed.slice();
      const floor = rounds.reduce((min, rd) => rd.items.reduce((roundMin, it) =>
        Math.min(roundMin, it.start), min), Infinity);
      const pending = [];
      rounds.forEach(rd => rd.items.forEach(it => {
        if (norm.locked[it.id]) return;
        const teams = teamsOf(it.m);
        const teamDelay = teams.reduce((latest, team) =>
          norm.teamDelays[team] == null ? latest : Math.max(latest, norm.teamDelays[team]), -Infinity);
        pending.push({
          it: it, teams: teams,
          earliest: Math.max(floor, norm.retimeMin != null ? norm.retimeMin : -Infinity,
            norm.rescheduled[it.id] != null ? norm.rescheduled[it.id] : -Infinity, teamDelay)
        });
      }));
      pending.sort((a, b) => a.earliest - b.earliest || a.it.rd.ordinal - b.it.rd.ordinal
        || a.it.field - b.it.field);
      let t = pending.length ? pending[0].earliest : floor;
      let guard = 0;
      while (pending.length) {
        if (++guard > 100000) throw fail(Error, 'infeasible', 'no feasible forward schedule');
        const selected = [];
        for (let i = 0; i < pending.length; i++) {
          const p = pending[i], d = p.it.minutes;
          if (p.earliest > t || afterPauses(t, d) !== t) continue;
          const field = [];
          for (let f = 0; f < F; f++) {
            if (fieldBlocked(norm.blocks, f, p.it.rd.ordinal, t, t + d)) continue;
            if (allPlaced.some(x => x.field === f && overlaps(t, t + d, x.startMin, x.endMin))) continue;
            if (selected.some(x => x.field === f && overlaps(t, t + d, t, t + x.it.minutes))) continue;
            field.push(f);
          }
          if (!field.length) continue;
          const teamConflict = x => overlaps(t, t + d, x.startMin, x.endMin)
            && p.teams.some(team => x.teams.indexOf(team) >= 0);
          if (allPlaced.some(teamConflict) || selected.some(x => p.teams.some(team => x.teams.indexOf(team) >= 0))) continue;
          const chosen = { it: p.it, startMin: t, endMin: t + d, field: field[0], teams: p.teams, locked: false };
          selected.push(chosen);
          pending.splice(i, 1);
          i--;
        }
        selected.forEach(x => {
          placed[x.it.rd.key].push(x);
          allPlaced.push(x);
        });
        if (!pending.length) break;
        if (selected.length) continue;

        let next = Infinity;
        pending.forEach(p => { if (p.earliest > t && p.earliest < next) next = p.earliest; });
        allPlaced.forEach(x => { if (x.endMin > t && x.endMin < next) next = x.endMin; });
        norm.pauses.forEach(p => {
          if (p.startMin > t && p.startMin < next) next = p.startMin;
          if (p.endMin > t && p.endMin < next) next = p.endMin;
        });
        norm.blocks.forEach(b => {
          if (b.fromMin != null && b.fromMin > t && b.fromMin < next) next = b.fromMin;
        });
        if (next === Infinity) throw fail(Error, 'infeasible', 'no field/team window for forward schedule');
        t = next;
      }
      return { rounds: rounds, placed: placed };
    }

    let cursor = -Infinity;
    let prevEnd = -Infinity;
    rounds.forEach(rd => {
      const pending = rd.items.filter(it => !norm.locked[it.id]).map(it => {
        const teams = teamsOf(it.m);
        const teamDelay = teams.reduce((latest, team) =>
          norm.teamDelays[team] == null ? latest : Math.max(latest, norm.teamDelays[team]), -Infinity);
        return {
          it: it, teams: teams,
          earliest: Math.max(norm.retimeMin != null ? norm.retimeMin : it.start,
            norm.rescheduled[it.id] != null ? norm.rescheduled[it.id] : -Infinity, teamDelay)
        };
      });
      let guard = 0;
      while (pending.length) {
        let next = pending[0];
        for (let i = 1; i < pending.length; i++) {
          if (pending[i].earliest < next.earliest) next = pending[i];
        }
        const d = next.it.minutes;
        let t = Math.max(cursor, prevEnd, next.earliest);
        let chosen = null;
        let freeNow = [];
        while (!chosen) {
          if (++guard > 100000) throw fail(Error, 'infeasible', 'no feasible schedule');
          t = afterPauses(t, d);
          const free = [];
          for (let f = 0; f < F; f++) {
            if (fieldBlocked(norm.blocks, f, rd.ordinal, t, t + d)) continue;
            if (fixed.some(x => x.field === f && overlaps(t, t + d, x.startMin, x.endMin))) continue;
            free.push(f);
          }
          const busy = {};
          fixed.forEach(x => { if (overlaps(t, t + d, x.startMin, x.endMin)) x.teams.forEach(k => { busy[k] = true; }); });
          const pick = [];
          for (let i = 0; i < pending.length && pick.length < free.length; i++) {
            const p = pending[i];
            if (p.it.minutes !== d || p.earliest > t) continue;
            if (p.teams.some(k => busy[k])) continue;
            p.teams.forEach(k => { busy[k] = true; });
            pick.push(p);
          }
          if (pick.length) { chosen = pick; freeNow = free; break; }
          const n = nextEvent(t);
          if (n === Infinity) throw fail(Error, 'infeasible', 'no field/team window for round ' + rd.round);
          t = n;
        }
        const taken = {};
        const needField = [];
        chosen.forEach(p => {
          if (freeNow.indexOf(p.it.field) >= 0 && !taken[p.it.field]) { taken[p.it.field] = p; p.field = p.it.field; }
          else needField.push(p);
        });
        needField.forEach(p => {
          for (let i = 0; i < freeNow.length; i++) {
            if (!taken[freeNow[i]]) { taken[freeNow[i]] = p; p.field = freeNow[i]; break; }
          }
        });
        chosen.forEach(p => {
          placed[rd.key].push({ it: p.it, startMin: t, endMin: t + d, field: p.field, locked: false });
          pending.splice(pending.indexOf(p), 1);
        });
        cursor = t + d;
      }
      placed[rd.key].forEach(x => { if (x.endMin > prevEnd) prevEnd = x.endMin; });
    });
    return { rounds: rounds, placed: placed };
  }

  function buildOutput(base, config, results, F, norm, sched, planningRaw) {
    const out = Object.assign({}, base);
    const lists = { grp: [], fin: [], slots: [] };
    let slotNo = 0;
    let moved = 0, splitRounds = 0;
    sched.rounds.forEach(rd => {
      const items = sched.placed[rd.key].slice().sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin || a.field - b.field);
      const groups = [];
      items.forEach(x => {
        const last = groups[groups.length - 1];
        if (last && last.startMin === x.startMin && last.endMin === x.endMin) last.items.push(x);
        else groups.push({ startMin: x.startMin, endMin: x.endMin, items: [x] });
      });
      if (groups.length > rd.slots.length) splitRounds++;
      const firstBase = rd.slots[0];
      groups.forEach((g, gi) => {
        const ref = g.items.slice().sort((a, b) => rd.items.indexOf(a.it) - rd.items.indexOf(b.it))[0].it.baseSlot;
        const matches = [];
        for (let f = 0; f < F; f++) matches.push(null);
        g.items.forEach(x => {
          matches[x.field] = Object.assign({}, x.it.m, { field: x.field });
          if (!x.locked && (x.startMin !== x.it.start || x.field !== x.it.field)) moved++;
        });
        slotNo++;
        const s = Object.assign({}, ref, {
          slot: slotNo, part: gi + 1, of: groups.length,
          startMin: g.startMin, endMin: g.endMin, minutes: g.endMin - g.startMin,
          bye: gi === 0 ? (firstBase.bye != null ? firstBase.bye : null) : null,
          byes: gi === 0 ? (firstBase.byes || []).slice() : [],
          matches: matches,
          baseSlot: ref.slot,
          lockedCount: g.items.filter(x => x.locked).length
        });
        lists[rd.source].push(s);
      });
      rd.slots.filter(s => s.displayOnly).forEach(s => {
        slotNo++;
        lists[rd.source].push(Object.assign({}, s, {
          slot: slotNo,
          matches: (s.matches || []).map(m => m ? Object.assign({}, m) : null)
        }));
      });
    });
    const all = lists.grp.concat(lists.fin, lists.slots);
    if (norm.fillForward && lists.slots.length) {
      lists.slots.sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin || a.round - b.round);
      lists.slots.forEach((s, i) => { s.slot = i + 1; });
    }
    const maxEnd = list => list.reduce((a, s) => Math.max(a, s.endMin), -Infinity);
    if (isFormatPlan(base)) {
      out.grpSlots = lists.grp;
      out.finSlots = lists.fin;
      out.grpEndMin = lists.grp.length ? maxEnd(lists.grp) : base.grpEndMin;
    } else {
      out.slots = lists.slots;
    }
    out.endMin = all.length ? maxEnd(all) : base.endMin;
    out.planningPauses = norm.pauses.map(p => ({ id: p.id, startMin: p.startMin, endMin: p.endMin, minutes: p.minutes }));
    hidden(out, 'planning', {
      active: true,
      fields: F,
      retimeMin: norm.retimeMin,
      blocked: norm.blocks.map(b => Object.assign({}, b)),
      pauses: out.planningPauses.map(p => Object.assign({}, p)),
      pauseMinutes: norm.pauses.reduce((a, p) => a + p.minutes, 0),
      fillForward: norm.fillForward,
      lockedIds: Object.keys(norm.locked),
      lockedCount: Object.keys(norm.locked).length,
      movedCount: moved,
      splitRounds: splitRounds,
      baseEndMin: base.endMin,
      endMin: out.endMin,
      delayMin: out.endMin - base.endMin,
      slotCount: all.length,
      baseSlotCount: slots(base).length
    });
    hidden(out, '_planningBase', base);
    hidden(out, '_planningConfig', config);
    hidden(out, '_planningResults', results);
    hidden(out, '_planningInput', planningRaw);
    return out;
  }

  function locksMatchBaseline(rounds, locked) {
    return rounds.every(rd => rd.items.every(it => {
      const l = locked[it.id];
      return !l || (l.startMin === it.start && l.endMin === it.start + it.minutes && l.field === it.field);
    }));
  }

  function planWith(base, config, results, planning, F) {
    if (isKingOfCourt(base)) throw fail(TypeError, 'unsupported', 'King/Queen of the Court is not supported');
    const rounds = baselineRounds(base);
    const norm = normalize(planning, base, F, rounds);
    const trivial = norm.retimeMin == null && !Object.keys(norm.rescheduled).length
      && !Object.keys(norm.teamDelays).length
      && !norm.fillForward
      && !norm.blocks.length && !norm.pauses.length
      && locksMatchBaseline(rounds, norm.locked);
    if (trivial) return null;
    return buildOutput(base, config, results, F, norm, schedule(base, F, norm), planning);
  }

  /* ----------------------------------------------------------- Öffentliche API */
  function apply(basePlan, config, results) {
    const planning = config && config.planning;
    if (!basePlan || isEmptyPlanning(planning)) return basePlan;
    const F = fieldCountOf(basePlan, config);
    const out = planWith(basePlan, config, results, planning, F);
    return out || basePlan;
  }

  /* Locks für alle Spiele mit Eingabe aus dem AKTUELL angezeigten Plan. */
  function capture(plan, results, existingLocked) {
    const prev = existingLocked || {};
    const out = {};
    slots(plan).forEach(s => (s.matches || []).forEach((m, f) => {
      if (!m || !hasInput(results, m.id)) return;
      const l = prev[m.id];
      out[m.id] = l
        ? { startMin: l.startMin, endMin: l.endMin, field: l.field }
        : { startMin: s.startMin, endMin: s.endMin, field: f };
    }));
    return out;
  }

  function signature(plan) {
    const out = {};
    slots(plan).forEach(s => (s.matches || []).forEach((m, f) => {
      if (m) out[m.id] = s.round + '|' + s.startMin + '-' + s.endMin + '@' + f;
    }));
    return out;
  }

  /* Baseline für eine andere Feldanzahl nachbilden – identisch zur Aufteilung
     der Builder (TC.assignSlots je Runde, Takt aus der Slot-Dauer). */
  function repartition(base, F) {
    if (!TC || typeof TC.assignSlots !== 'function') throw fail(Error, 'no-core', 'TC (turnier-core.js) required');
    const rounds = baselineRounds(base);
    const opts = isFormatPlan(base) && typeof base.resolve === 'function' ? { teamOf: base.resolve } : {};
    const lists = { grp: [], fin: [], slots: [] };
    let cursor = base.startMin;
    let grpEnd = base.startMin;
    rounds.forEach(rd => {
      const first = rd.slots[0];
      const minutes = slotMinutes(first);
      const matches = rd.items.map(it => it.m);
      TC.assignSlots([{ round: rd.round, matches: matches, bye: first.bye, byes: first.byes }], F, opts).forEach(s => {
        const meta = Object.assign({}, first);
        lists[rd.source].push(Object.assign(meta, s, {
          slot: lists.grp.length + lists.fin.length + lists.slots.length + 1,
          startMin: cursor, endMin: cursor + minutes, minutes: minutes
        }));
        cursor += minutes;
      });
      if (rd.source === 'grp') grpEnd = cursor;
    });
    const out = Object.assign({}, base);
    if (isFormatPlan(base)) { out.grpSlots = lists.grp; out.finSlots = lists.fin; out.grpEndMin = grpEnd; }
    else out.slots = lists.slots;
    if (base.fields != null) out.fields = F;
    out.config = Object.assign({}, base.config, { fields: F });
    out.endMin = cursor;
    return out;
  }

  function neededFields(plan, windowMin, maxFields) {
    const base = plan && plan._planningBase ? plan._planningBase : plan;
    const config = plan && plan._planningConfig ? plan._planningConfig : (base && base.config) || {};
    const results = plan && plan._planningResults ? plan._planningResults : {};
    if (!base) return null;
    if (isKingOfCourt(base)) throw fail(TypeError, 'unsupported', 'King/Queen of the Court is not supported');
    const planning = config.planning || {};
    const cap = maxFields || 10;
    let minF = 1;
    (planning.blocked || []).forEach(b => { minF = Math.max(minF, b.field + 1); });
    const locked = planning.locked || {};
    const known = signature(base);
    Object.keys(locked).forEach(id => {
      if (known[id] != null && Number.isInteger(locked[id].field)) minF = Math.max(minF, locked[id].field + 1);
    });
    for (let f = minF; f <= cap; f++) {
      const candidate = Object.assign({}, planning, {
        blocked: (planning.blocked || []).filter(b => b && b.field < f)
      });
      const vbase = repartition(base, f);
      let adjusted;
      try {
        adjusted = isEmptyPlanning(candidate) ? vbase : (planWith(vbase, config, results, candidate, f) || vbase);
      } catch (e) {
        if (e instanceof RangeError) continue;
        throw e;
      }
      if (adjusted.endMin - base.startMin <= windowMin) return f;
    }
    return null;
  }

  return {
    apply: apply, slots: slots, hasInput: hasInput, capture: capture,
    signature: signature, neededFields: neededFields,
    clockToMin: clockToMin, repartition: repartition
  };
});
