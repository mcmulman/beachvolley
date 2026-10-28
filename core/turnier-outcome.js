/* ============================================================================
   turnier-outcome.js – versionierte Sonderergebnisse (DOM-frei, Node + Browser)

   Ein Sonderergebnis (Default/Nichtantreten, unvollständiges Team) ist KEIN
   normaler Spielstand. Es wird getrennt von den eingetragenen Satzergebnissen
   gespeichert:

     tournament.outcomes[matchId] = {
       v: 1, kind: 'default' | 'incomplete', scope: 'match',
       loser: 'a' | 'b', reason, authority, status: 'provisional' | 'final',
       policy, note, decidedAt
     }

   - Ein vorläufiges Sonderergebnis wird NICHT gewertet und lässt niemanden
     nachrücken. Erst status 'final' (bestätigte Entscheidung) wirkt.
   - tournament.results[matchId] bleibt der tatsächlich gespielte Stand. Daraus
     und aus der Regel (policy) wird die ZUGESPROCHENE Wertung abgeleitet
     (result.awardedSets); beides bleibt im Ergebnisobjekt erhalten.
   - Die eigenständigen Spielentscheidungen unterstützen das FIVB-Grundregelwerk 2025–2028
     (Regel 6.4) für das jeweilige offizielle Satzformat. Aufgabe/Turnier-
     rückzug, Disqualifikation mit Wirkungsbereich und Event-Sonderwertungen
     werden NICHT abgeleitet; solche Datensätze werden abgelehnt. Die begrenzte
     DTTB-Stufenentscheidung in turnier-stage.js nutzt zusätzlich die reine
     D7.10-Aufzeichnungsberechnung; sie ist kein Volleyball-Sonderergebnis.

   Einbindung im Browser: window.TOutcome   ·   Node: require(...)
   ========================================================================== */
(function (root, factory) {
  const api = factory(root.TC || (typeof require === 'function' ? require('./turnier-core.js') : null));
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TOutcome = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (TC) {
  'use strict';

  const VERSION = 1;
  const KINDS = Object.freeze(['default', 'incomplete']);
  const KNOWN_UNSUPPORTED_KINDS = Object.freeze(['withdrawal', 'disqualified', 'retired', 'abandoned', 'annulled', 'bye']);
  const REASONS = Object.freeze({
    'default': Object.freeze(['refusal', 'not-on-court']),
    incomplete: Object.freeze(['injury', 'illness', 'player-disqualified', 'insufficient-players', 'other'])
  });
  const AUTHORITIES = Object.freeze(['referee', 'organizer']);
  const STATUSES = Object.freeze(['provisional', 'final']);
  const SIDES = Object.freeze(['a', 'b']);
  const MAX_NOTE = 200;
  const MAX_ENTRIES = 512;
  const KEYS = ['v', 'kind', 'scope', 'loser', 'reason', 'authority', 'status', 'policy', 'note', 'decidedAt'];

  /* Spielgeometrie je Regelwerk. ballSets: nur diese Sätze (Index < ballSets)
     zählen für die Ballpunkte – wie TC.computeResult() im Beach-Modus. */
  const POLICIES = Object.freeze({
    'dttb-individual-2026': Object.freeze({
      id: 'dttb-individual-2026', modeIds: ['tt-best-of-3', 'tt-best-of-5', 'tt-best-of-7'],
      edition: 'DTTB WO effective 1 July 2026, D7.10'
    }),
    'fivb-volleyball-2025-2028': Object.freeze({
      id: 'fivb-volleyball-2025-2028', sport: 'volleyball.indoor', modeId: 'indoor-bo5',
      targets: Object.freeze([25, 25, 25, 25, 15]), matchWins: 3, ballSets: 5,
      edition: 'FIVB Official Volleyball Rules 2025–2028, Rule 6.4'
    }),
    'fivb-beach-2025-2028': Object.freeze({
      id: 'fivb-beach-2025-2028', sport: 'volleyball.beach', modeId: '2x21tb',
      targets: Object.freeze([21, 21, 15]), matchWins: 2, ballSets: 2,
      edition: 'FIVB Official Beach Volleyball Rules 2025–2028, Rule 6.4'
    })
  });
  const POLICY_BY_SPORT = Object.freeze({
    'volleyball.indoor': 'fivb-volleyball-2025-2028',
    'volleyball.beach': 'fivb-beach-2025-2028'
  });

  const has = Object.prototype.hasOwnProperty;
  const isObject = v => !!v && typeof v === 'object' && !Array.isArray(v);
  const filled = v => v != null && v !== '';

  function policyForSport(sportId) { return POLICY_BY_SPORT[sportId] || null; }
  function policy(id) { return has.call(POLICIES, id) ? POLICIES[id] : null; }
  function supportsMode(policyId, modeId) {
    const p = policy(policyId);
    return !!p && (p.modeId === modeId || !!p.modeIds && p.modeIds.indexOf(modeId) >= 0);
  }

  /* ---------------------------------------------------------- Validierung */
  function validateOutcome(o, expectedPolicy) {
    if (!isObject(o)) return { ok: false, code: 'invalid-outcome' };
    if (typeof o.kind === 'string' && KNOWN_UNSUPPORTED_KINDS.indexOf(o.kind) >= 0) {
      return { ok: false, code: 'unsupported-kind' };
    }
    if (o.v !== VERSION) return { ok: false, code: 'unsupported-version' };
    if (KINDS.indexOf(o.kind) < 0) return { ok: false, code: 'unsupported-kind' };
    if (Object.keys(o).some(k => KEYS.indexOf(k) < 0)) return { ok: false, code: 'invalid-outcome' };
    if (o.scope !== 'match') return { ok: false, code: 'unsupported-scope' };
    if (SIDES.indexOf(o.loser) < 0) return { ok: false, code: 'invalid-loser' };
    if (REASONS[o.kind].indexOf(o.reason) < 0) return { ok: false, code: 'invalid-reason' };
    if (AUTHORITIES.indexOf(o.authority) < 0) return { ok: false, code: 'invalid-authority' };
    if (STATUSES.indexOf(o.status) < 0) return { ok: false, code: 'invalid-status' };
    if (!policy(o.policy) || (expectedPolicy && o.policy !== expectedPolicy)) {
      return { ok: false, code: 'unsupported-policy' };
    }
    if (o.note != null && (typeof o.note !== 'string' || o.note.length > MAX_NOTE)) {
      return { ok: false, code: 'invalid-note' };
    }
    if (o.decidedAt != null && (typeof o.decidedAt !== 'string' || o.decidedAt.length > 40)) {
      return { ok: false, code: 'invalid-decision-time' };
    }
    return { ok: true };
  }

  /* ctx: { outcomeProfile } – Konfiguration des Turniers. Ohne gewähltes
     Regelwerk darf es keine Sonderergebnisse geben. */
  function validateMap(map, ctx) {
    if (map == null) return { ok: true };
    if (!isObject(map)) return { ok: false, code: 'invalid-outcome' };
    const ids = Object.keys(map);
    if (!ids.length) return { ok: true };
    if (ids.length > MAX_ENTRIES) return { ok: false, code: 'invalid-outcome' };
    const expected = ctx && ctx.outcomeProfile;
    if (!expected || !policy(expected)) return { ok: false, code: 'unsupported-policy' };
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      if (id.length > 200 || !/^[A-Za-z0-9_.-]+$/.test(id)) return { ok: false, code: 'invalid-outcome', id: id };
      const check = validateOutcome(map[id], expected);
      if (!check.ok) return { ok: false, code: check.code, id: id };
    }
    return { ok: true };
  }

  function create(fields, policyId) {
    const o = Object.assign({
      v: VERSION, scope: 'match', status: 'provisional', authority: 'referee', note: '',
      decidedAt: null, policy: policyId
    }, fields || {});
    return o;
  }

  /* ----------------------------------------------------------- Berechnung */
  function numeric(v) {
    if (typeof v === 'number') return v;
    return /^[0-9]+$/.test(String(v).trim()) ? Number(v) : NaN;
  }

  /* Ordnet die Reihenfolge Verlierer/Gewinner einer Zeile [a,b] zu. */
  function row(loser, loserPoints, winnerPoints) {
    return loser === 'a' ? [loserPoints, winnerPoints] : [winnerPoints, loserPoints];
  }

  /* Wertung einer Entscheidung auf Grundlage der tatsächlich eingetragenen
     Sätze. Rückgabe { ok:true, result } oder { ok:false, code }. */
  function evaluate(outcome, sets, modeId) {
    const check = validateOutcome(outcome);
    if (!check.ok) return check;
    let p = policy(outcome.policy);
    if (p.modeIds && p.modeIds.indexOf(modeId) >= 0) {
      const wins = { 'tt-best-of-3': 2, 'tt-best-of-5': 3, 'tt-best-of-7': 4 }[modeId];
      p = { modeId, targets: Array(wins * 2 - 1).fill(11), matchWins: wins, ballSets: wins * 2 - 1 };
    }
    if (p.modeId !== modeId) return { ok: false, code: 'unsupported-mode' };
    const loser = outcome.loser;
    const winner = loser === 'a' ? 'b' : 'a';
    const entered = (sets || []).map(s => Array.isArray(s) ? s : [null, null]);
    let last = -1;
    entered.forEach((s, i) => { if (filled(s[0]) || filled(s[1])) last = i; });
    if (last >= p.targets.length) return { ok: false, code: 'too-many-sets' };

    const awarded = [];
    const wins = { a: 0, b: 0 };
    let interrupted = false;
    if (outcome.kind === 'default') {
      if (last >= 0) return { ok: false, code: 'scores-not-allowed' };
    } else {
      for (let i = 0; i <= last; i++) {
        const s = entered[i];
        const hasA = filled(s[0]), hasB = filled(s[1]);
        if (!hasA && !hasB) return { ok: false, code: 'missing-set' };
        if (hasA !== hasB) return { ok: false, code: 'invalid-partial-set' };
        const a = numeric(s[0]), b = numeric(s[1]);
        if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || a < 0 || b < 0) {
          return { ok: false, code: 'invalid-partial-set' };
        }
        if (wins.a >= p.matchWins || wins.b >= p.matchWins) return { ok: false, code: 'match-already-decided' };
        if (TC.setValid(a, b, p.targets[i])) {
          awarded.push([a, b]);
          if (a > b) wins.a++; else wins.b++;
        } else if (i === last) {
          // A reachable interrupted set cannot have passed a normal winning score.
          if (Math.max(a, b) >= p.targets[i] && Math.abs(a - b) >= 2) {
            return { ok: false, code: 'invalid-completed-set' };
          }
          const own = loser === 'a' ? a : b;
          const other = loser === 'a' ? b : a;
          const needed = Math.max(p.targets[i], own + 2);
          if (other >= needed) return { ok: false, code: 'partial-set-complete' };
          awarded.push(row(loser, own, needed));
          interrupted = true;
          wins[winner]++;
        } else {
          return { ok: false, code: 'invalid-completed-set' };
        }
      }
      if (!interrupted && wins[winner] >= p.matchWins) return { ok: false, code: 'match-already-decided' };
    }
    if (wins[loser] >= p.matchWins) return { ok: false, code: 'match-already-decided' };
    while (wins[winner] < p.matchWins) {
      const index = awarded.length;
      if (index >= p.targets.length) return { ok: false, code: 'too-many-sets' };
      awarded.push(row(loser, 0, p.targets[index]));
      wins[winner]++;
    }

    let aSets = 0, bSets = 0, aBalls = 0, bBalls = 0;
    awarded.forEach((s, i) => {
      if (s[0] > s[1]) aSets++; else bSets++;
      if (i < p.ballSets) { aBalls += s[0]; bBalls += s[1]; }
    });
    return {
      ok: true,
      result: {
        aBalls: aBalls, bBalls: bBalls, aSets: aSets, bSets: bSets, aGames: aSets, bGames: bSets,
        winner: winner, draw: false, administrative: true,
        outcome: {
          kind: outcome.kind, loser: loser, reason: outcome.reason, authority: outcome.authority,
          status: outcome.status, policy: outcome.policy
        },
        actualSets: entered.slice(0, last + 1).map(s => [s[0], s[1]]),
        awardedSets: awarded
      }
    };
  }

  /* Wirksames Ergebnis für die Auswertung: bestätigtes Sonderergebnis →
     zugesprochene Wertung; vorläufig/fehlerhaft → null (nichts rückt nach);
     ohne Sonderergebnis → normales Spielergebnis. */
  function resultFor(cfg, matchId, modeId) {
    const o = cfg && cfg.outcomes && has.call(cfg.outcomes, matchId) ? cfg.outcomes[matchId] : null;
    if (!o) return TC.computeResult(cfg.results[matchId], modeId);
    if (!isObject(o) || o.status !== 'final') return null;
    const evaluated = evaluate(o, cfg.results[matchId], modeId);
    return evaluated.ok ? evaluated.result : null;
  }

  /* Anzeigezustand einer Karte. */
  function statusFor(state, matchId, modeId) {
    const o = state && state.outcomes && has.call(state.outcomes, matchId) ? state.outcomes[matchId] : null;
    if (!o) return { state: 'none' };
    const evaluated = evaluate(o, state.results && state.results[matchId], modeId);
    if (!evaluated.ok) return { state: 'invalid', code: evaluated.code, outcome: o };
    return {
      state: o.status === 'final' ? 'applied' : 'pending',
      outcome: o, result: evaluated.result
    };
  }

  function hasOutcome(state, matchId) {
    return !!(state && state.outcomes && has.call(state.outcomes, matchId));
  }

  /* Ergebnis-Map für Planung/Sperren: eine Entscheidung zählt dort als
     Eingabe, auch wenn keine Satzzahlen existieren. */
  function withInputs(state) {
    const out = Object.assign({}, state && state.results);
    Object.keys((state && state.outcomes) || {}).forEach(id => {
      const current = out[id];
      const entered = Array.isArray(current) && current.some(s => Array.isArray(s) && (filled(s[0]) || filled(s[1])));
      if (!entered) out[id] = [[0, 0]];
    });
    return out;
  }

  function swapSide(o) {
    if (!isObject(o)) return o;
    return Object.assign({}, o, { loser: o.loser === 'a' ? 'b' : 'a' });
  }

  /* Build both plans on copies: no entered downstream score or decision may
     move to different (or unresolved) participants. Partial scores count too.
     Comparing resolved plans also covers group ranking, loser paths and byes.
     The candidate callback receives matchId so it can invalidate derived
     decisions before rebuilding, while the original plan retains its bindings. */
  function validateChange(state, matchId, outcome, buildPlan) {
    const before = JSON.parse(JSON.stringify(state));
    const after = JSON.parse(JSON.stringify(state));
    after.outcomes = after.outcomes || {};
    if (outcome == null) delete after.outcomes[matchId];
    else after.outcomes[matchId] = outcome;
    const oldPlan = buildPlan(before), newPlan = buildPlan(after, matchId);
    const inputs = withInputs(state);
    const affected = Object.keys(inputs).filter(id => {
      if (id === matchId) return false;
      const scores = inputs[id];
      if (!Array.isArray(scores) || !scores.some(s => Array.isArray(s) && (filled(s[0]) || filled(s[1])))) return false;
      const oldMatch = oldPlan.matchById[id], newMatch = newPlan.matchById[id];
      if (!oldMatch || !newMatch) return true;
      return oldMatch.ta !== newMatch.ta || oldMatch.tb !== newMatch.tb;
    });
    return affected.length ? { ok: false, code: 'downstream-inputs', affected } : { ok: true };
  }

  return {
    VERSION, KINDS, REASONS, AUTHORITIES, STATUSES, POLICIES, MAX_NOTE,
    policy, policyForSport, supportsMode, create,
    validateOutcome, validateMap, evaluate, resultFor, statusFor, hasOutcome, withInputs, swapSide, validateChange
  };
});
