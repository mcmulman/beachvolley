(function (root, factory) {
  const api = factory(root.TC || (typeof require === 'function' ? require('./turnier-core.js') : null),
    root.TOutcome || (typeof require === 'function' ? require('./turnier-outcome.js') : null));
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TStage = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (TC, O) {
  'use strict';
  const POLICY = 'tt-dttb-stage-2026';
  const RANKING = 'tt-dttb-individual-round-robin-2026';
  const SWISS_RANKING = 'tt-dttb-swiss-ranking-2026';
  const keys = ['v', 'id', 'kind', 'policy', 'scope', 'stage', 'participant', 'matchId',
    'reason', 'authority', 'reference', 'decidedAt', 'reverses'];
  function validate(state) {
    const entries = state.stageDecisions;
    if (entries == null) return { ok: true };
    if (!Array.isArray(entries) || entries.length > 64) return { ok: false, code: 'invalid-stage-decision' };
    if (!entries.length) return { ok: true };
    if (!state.config || !state.sport || !/^table-tennis\.(singles|doubles)$/.test(state.sport.id)) {
      return { ok: false, code: 'unsupported-stage-policy' };
    }
    if (!TC) return { ok: false, code: 'unsupported-stage-policy' };
    const teams = TC.normalizeTeamList(state.config.teams);
    const rr = state.config.rankingProfile === RANKING && state.config.mode === 'rr'
      && (!state.sheet || /^(runden|flex)_rr(?:[.:_-]|$)/.test(state.sheet));
    const swiss = state.config.rankingProfile === SWISS_RANKING && state.config.mode === 'swiss'
      && (!state.sheet || /^(runden|flex)_swiss(?:[.:_-]|$)/.test(state.sheet));
    if ((!rr && !swiss) || teams.length < 4 || (rr && teams.length % 2)) {
      return { ok: false, code: 'unsupported-stage-policy' };
    }
    const rrMatches = {};
    TC.genRoundRobin(teams, { idPrefix: 'rr' }).forEach(rd =>
      rd.matches.forEach((m, i) => { rrMatches['rr_' + rd.round + '_' + i] = Object.assign({ round: rd.round }, m); }));
    const swissMatches = {};
    Object.keys(state.frozen || {}).forEach(round => (state.frozen[round] || []).forEach((p, i) => {
      if (Array.isArray(p) && p.length === 2) {
        swissMatches['sw_' + round + '_' + i] = { round: +round, a: p[0], b: p[1] };
      }
    }));
    const seen = {};
    let active = null;
    let withdrawals = 0;
    for (const e of entries) {
      if (!e || typeof e !== 'object' || Array.isArray(e) || Object.keys(e).some(k => keys.indexOf(k) < 0)
          || e.v !== 1 || e.policy !== POLICY
          || typeof e.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(e.id)
          || seen[e.id] || ['organizer', 'referee'].indexOf(e.authority) < 0
          || typeof e.reference !== 'string' || !e.reference.trim() || e.reference.length > 200
          || typeof e.decidedAt !== 'string' || !/^\d{4}-\d\d-\d\dT/.test(e.decidedAt)
          || !Number.isFinite(Date.parse(e.decidedAt))) return { ok: false, code: 'invalid-stage-decision' };
      if (e.kind === 'withdrawal') {
        const isSwiss = e.stage === 'swiss';
        const correctScope = isSwiss ? e.scope === 'swiss-event-withdrawal'
          : e.stage === 'round-robin' && e.scope === 'stage-and-following';
        const m = (isSwiss ? swissMatches : rrMatches)[e.matchId];
        withdrawals++;
        if (active || withdrawals > 1 || !correctScope || teams.indexOf(e.participant) < 0 || !m
            || (m.a !== e.participant && m.b !== e.participant)
            || isSwiss !== swiss
            || ['not-appeared', 'retired'].indexOf(e.reason) < 0 || e.reverses != null) {
          return { ok: false, code: 'unsupported-stage-decision' };
        }
        active = e;
      } else if (e.kind === 'revoke') {
        if (!active || e.reverses !== active.id || e.participant !== active.participant
            || e.matchId !== active.matchId || e.reason !== active.reason
            || e.scope !== active.scope || e.stage !== active.stage) {
          return { ok: false, code: 'invalid-stage-reversal' };
        }
        active = null;
      } else return { ok: false, code: 'unsupported-stage-decision' };
      seen[e.id] = true;
    }
    if (active) {
      if ((state.absent || []).length || Object.keys(state.outcomes || {}).length) {
        return { ok: false, code: 'unsupported-absence-or-outcome' };
      }
      const isSwiss = active.stage === 'swiss';
      const matches = isSwiss ? swissMatches : rrMatches;
      const m = matches[active.matchId];
      const mode = state.frozenModes && state.frozenModes[m.round] || state.config.setMode;
      const recording = recordedResult(state, active, mode, m);
      if (!recording.ok) return recording;
      const later = Object.keys(state.results || {}).some(id => {
        const laterMatch = matches[id], score = state.results[id];
        return id !== active.matchId && laterMatch && laterMatch.round > (isSwiss ? m.round : m.round - 1)
          && (laterMatch.a === active.participant || laterMatch.b === active.participant)
          && Array.isArray(score) && score.some(p => Array.isArray(p) && p.some(x => x != null && x !== ''));
      });
      if (later) return { ok: false, code: 'later-participation' };
      if (isSwiss && !(state.frozen && state.frozen[m.round]
          && state.frozen[m.round].some(p => Array.isArray(p)
            && ((p[0] === m.a && p[1] === m.b) || (p[0] === m.b && p[1] === m.a))))) {
        return { ok: false, code: 'unfrozen-trigger-pairing' };
      }
      if (isSwiss && !swissRoundsCompleteBefore(state, m.round)) {
        return { ok: false, code: 'previous-round-incomplete' };
      }
      return { ok: true, active: Object.assign({}, active, { round: m.round }) };
    }
    return { ok: true, active };
  }
  function active(state) {
    const v = validate(state);
    return v.ok ? v.active || null : null;
  }
  function recordedResult(state, entry, mode, match) {
    const loser = match.a === entry.participant ? 'a' : 'b';
    const score = (state.results || {})[entry.matchId];
    if (score != null && (!Array.isArray(score) || score.some(p => !Array.isArray(p) || p.length !== 2))) {
      return { ok: false, code: 'invalid-score' };
    }
    return O.evaluate(O.create({
      kind: entry.reason === 'not-appeared' ? 'default' : 'incomplete',
      loser, reason: entry.reason === 'not-appeared' ? 'not-on-court' : 'other',
      status: 'final', authority: entry.authority
    }, 'dttb-individual-2026'), score, mode);
  }
  function swissRoundsCompleteBefore(state, round) {
    for (let r = 1; r < round; r++) {
      const pairs = state.frozen && state.frozen[r];
      if (!Array.isArray(pairs) || !pairs.length) return false;
      const mode = state.frozenModes && state.frozenModes[r] || state.config.setMode;
      for (let i = 0; i < pairs.length; i++) {
        if (!completeTableTennisResult((state.results || {})['sw_' + r + '_' + i], mode,
          state.sport.id)) return false;
      }
    }
    return true;
  }
  function completeTableTennisResult(score, mode, profile) {
    if (!Array.isArray(score)) return false;
    let def;
    try { def = TC.modeDef(mode, profile); } catch (e) { return false; }
    if (!def || !def.matchWins || !Number.isInteger(def.sets)) return false;
    let aWins = 0, bWins = 0, winner = false;
    for (let i = 0; i < def.sets; i++) {
      const row = score[i];
      if (winner) {
        if (row && row.some(value => value != null && value !== '')) return false;
        continue;
      }
      if (!Array.isArray(row) || row.length !== 2 || row[0] == null || row[1] == null
          || row[0] === '' || row[1] === '') return false;
      const a = Number(row[0]), b = Number(row[1]);
      if (!TC.setValid(a, b, def.target)) return false;
      if (a > b) aWins++; else bWins++;
      winner = aWins >= def.matchWins || bWins >= def.matchWins;
    }
    for (let i = def.sets; i < score.length; i++) {
      const row = score[i];
      if (row && row.some(value => value != null && value !== '')) return false;
    }
    return winner;
  }
  function change(state, entry, build) {
    const after = JSON.parse(JSON.stringify(state));
    after.stageDecisions = (after.stageDecisions || []).concat([entry]);
    if (entry.kind === 'withdrawal' && entry.stage === 'swiss') {
      const plan = build(state);
      const round = plan.rounds.find(rd => rd.matches.some(m => m.id === entry.matchId));
      if (!round) return { ok: false, code: 'invalid-trigger-match' };
      after.frozen = after.frozen || {};
      if (!after.frozen[round.round]) {
        after.frozen[round.round] = round.matches.map(m => [m.a, m.b]);
      }
    }
    const check = validate(after);
    if (!check.ok) return check;
    if ((state.absent || []).length || Object.keys(state.outcomes || {}).length) {
      return { ok: false, code: 'unsupported-absence-or-outcome' };
    }
    const beforePlan = build(state), afterPlan = build(after);
    if (entry.kind === 'withdrawal') {
      const m = beforePlan.matchById[entry.matchId];
      const rd = beforePlan.rounds.find(r => r.matches.some(x => x.id === entry.matchId));
      if (!m || !rd) return { ok: false, code: 'invalid-trigger-match' };
      const recorded = recordedResult(state, entry, rd.setMode, m);
      if (!recorded.ok) return recorded;
      const laterInput = Object.keys(O.withInputs(state)).some(id => {
        const match = beforePlan.matchById[id];
        const input = O.withInputs(state)[id];
        return match && match.round >= m.round && id !== m.id
          && (match.a === entry.participant || match.b === entry.participant)
          && input.some(p => p && p.some(x => x != null && x !== ''));
      });
      if (laterInput) return { ok: false, code: 'later-participation' };
    }
    const oldDecision = active(state);
    if (entry.kind === 'revoke' && oldDecision && oldDecision.stage === 'swiss') {
      const laterFrozen = Object.keys(state.frozen || {}).some(round => +round > oldDecision.round
        && !(state.frozen[round] || []).some(p => Array.isArray(p)
          && (p[0] === oldDecision.participant || p[1] === oldDecision.participant)));
      if (laterFrozen) return { ok: false, code: 'downstream-pairings' };
    }
    const frozenPairs = state.frozen || {};
    const movedFrozen = Object.keys(frozenPairs).some(round => (frozenPairs[round] || []).some((p, i) => {
      const old = beforePlan.matchById['sw_' + round + '_' + i];
      const next = afterPlan.matchById['sw_' + round + '_' + i];
      return !old || !next || old.a !== next.a || old.b !== next.b;
    }));
    if (movedFrozen) return { ok: false, code: 'frozen-pairings' };
    const affected = Object.keys(O.withInputs(state)).filter(id => {
      const input = O.withInputs(state)[id];
      if (!input.some(p => p && p.some(x => x != null && x !== ''))) return false;
      const a = beforePlan.matchById[id], b = afterPlan.matchById[id];
      return !a || !b || a.ta !== b.ta || a.tb !== b.tb;
    });
    return affected.length ? { ok: false, code: 'downstream-inputs' } : { ok: true, state: after };
  }
  function walkoverResult(state, entry, mode, match) {
    return recordedResult(state, Object.assign({}, entry, {
      reason: 'not-appeared', matchId: entry.matchId
    }), mode, match);
  }
  return {
    POLICY, RANKING, SWISS_RANKING, validate, active, recordedResult, walkoverResult,
    swissRoundsCompleteBefore, change
  };
});
