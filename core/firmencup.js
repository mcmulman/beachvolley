(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Firmencup = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const SCHEMA = 1;
  const LEGACY_FORMAT = 1, FLEXIBLE_FORMAT = 2, CURRENT_FORMAT = 3;
  const MIN_TEAMS = 2, MAX_TEAMS = 128, MAX_ORGANIZATIONS = 128;
  function check(ok, message) { if (!ok) throw new Error(message); }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function integer(n, min, max) { return Number.isInteger(n) && n >= min && n <= max; }
  function text(s, max) { return typeof s === 'string' && s.trim().length > 0 && s.length <= max; }
  function identifier(s) { return typeof s === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(s) && ['__proto__', 'constructor', 'prototype'].indexOf(s) < 0; }
  function unique(items) { return new Set(items).size === items.length; }
  function formatVersion(e) { return e.formatVersion == null ? LEGACY_FORMAT : e.formatVersion; }
  function teamLimits(e) {
    const version = e ? formatVersion(e) : CURRENT_FORMAT;
    return version === LEGACY_FORMAT ? { min: 40, max: 64 } :
      version === FLEXIBLE_FORMAT ? { min: 16, max: 80 } : { min: MIN_TEAMS, max: MAX_TEAMS };
  }
  function cupSize(e) {
    if (formatVersion(e) < CURRENT_FORMAT) return 8;
    return e.teams.length <= 8 ? 0 : e.teams.length === 9 ? 4 : 8;
  }
  function time(s) {
    check(typeof s === 'string' && /^\d{2}:\d{2}$/.test(s) && +s.slice(0, 2) < 24 && +s.slice(3) < 60, 'Invalid start time / Startzeit');
    return +s.slice(0, 2) * 60 + +s.slice(3);
  }
  function clock(min) {
    const day = Math.floor(min / 1440);
    return String(Math.floor(min % 1440 / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0') + (day ? ' (+' + day + 'd)' : '');
  }
  function validateSetup(e) {
    check(e && e.schema === SCHEMA && identifier(e.id) && text(e.title, 120), 'Invalid event / Veranstaltung');
    const version = formatVersion(e);
    check([LEGACY_FORMAT, FLEXIBLE_FORMAT, CURRENT_FORMAT].indexOf(version) >= 0, 'Invalid format version / Ungültige Formatversion');
    const c = e.config;
    check(c && integer(c.minutes, 1, 60) && integer(c.change, 1, 30) && integer(c.fields, 1, 16) &&
      integer(c.rest, 1, 5) && integer(c.referees, 1, 16) && integer(c.window, 30, 1440), 'Invalid capacity or timing / Kapazität oder Zeit');
    time(c.start);
    check(c.mixed === 'optional' || c.mixed === 'one-woman', 'Invalid mixed policy / Ungültige Mixed-Regel');
    const draft = e.status === 'draft';
    const limits = teamLimits(e), range = limits.min + '–' + limits.max;
    check(Array.isArray(e.teams) && integer(e.teams.length, draft ? 0 : limits.min, limits.max),
      range + ' teams required for scheduling / Für den Spielplan sind ' + range + ' Teams erforderlich' +
      (version === CURRENT_FORMAT ? ' (technical capacity limit, not a sports rule / technische Kapazitätsgrenze, keine Sportregel)' : ''));
    check(Array.isArray(e.organizations) && (version < CURRENT_FORMAT || e.organizations.length <= MAX_ORGANIZATIONS) &&
      ((draft && !e.teams.length) || e.organizations.length > 0),
    version === CURRENT_FORMAT ?
      '1–128 companies/organizations/groups required (empty drafts allowed) / 1–128 Firmen/Organisationen/Gruppen erforderlich (leere Entwürfe erlaubt)' :
      'Company/Organization/Group required / Firma/Organisation/Gruppe erforderlich');
    check(unique(e.teams.map(t => t.id)) && unique(e.organizations.map(o => o.id)), 'Duplicate ID / Doppelte ID');
    e.organizations.forEach(o => {
      check(identifier(o.id) && text(o.name, 100), 'Invalid Company/Organization/Group / Ungültige Firma/Organisation/Gruppe');
      check(((draft || !e.teams.some(t => t.orgId === o.id)) && o.nominee === null) ||
        e.teams.some(t => t.id === o.nominee && t.orgId === o.id), 'Nominate one scoring team per Company/Organization/Group / Ein Wertungsteam je Firma/Organisation/Gruppe nominieren');
    });
    e.teams.forEach(t => {
      check(identifier(t.id) && text(t.name, 100) && e.organizations.some(o => o.id === t.orgId), 'Invalid team assignment / Teamzuordnung');
      check(Array.isArray(t.roster) && t.roster.length <= 100 && t.roster.every(n => text(n, 100)), 'Invalid player names / Ungültige Spieler:innen-Namen');
    });
    if (e.checkIns !== undefined) {
      check(e.checkIns && typeof e.checkIns === 'object' && !Array.isArray(e.checkIns), 'Invalid check-in data / Ungültige Check-in-Daten');
      Object.keys(e.checkIns).forEach(id => {
        check(e.teams.some(t => t.id === id) &&
          ['checked-in', 'late', 'absent'].indexOf(e.checkIns[id]) >= 0,
        'Invalid team check-in / Ungültiger Team-Check-in');
      });
    }
    return e;
  }
  function create(id, title, config, teams, organizations, formatVersion) {
    return validateSetup({ schema: SCHEMA, formatVersion: formatVersion == null ? CURRENT_FORMAT : formatVersion,
      id: id, title: title, config: clone(config), teams: clone(teams),
      organizations: clone(organizations), status: 'draft', revision: 0, results: {}, pools: [], matches: [],
      finalPools: [], drawOrder: [], startedAt: null, checkIns: {}, outcomes: {},
      withdrawals: {}, replans: [], fieldLimit: Math.min(config.fields, config.referees) });
  }
  function transferTeam(e, teamId, targetOrgId, choices, now) {
    validate(e);
    const team = e.teams.find(t => t.id === teamId);
    const target = e.organizations.find(o => o.id === targetOrgId);
    check(team && target && team.orgId !== targetOrgId, 'Choose a different company / Andere Firma wählen');
    check(choices && choices.confirmed === true, 'Transfer confirmation required / Wechselbestätigung erforderlich');
    const source = e.organizations.find(o => o.id === team.orgId);
    const next = clone(e), moved = next.teams.find(t => t.id === teamId);
    moved.orgId = targetOrgId;
    function nominee(org, selected) {
      const candidates = next.teams.filter(t => t.orgId === org.id);
      if (!candidates.length) {
        check(selected == null, 'Empty company cannot nominate a team / Leere Firma hat kein Wertungsteam');
        return null;
      }
      if (selected === undefined && candidates.length === 1) return candidates[0].id;
      check(candidates.some(t => t.id === selected),
        'Explicit company trophy team choice required / Team für den Firmenpokal ausdrücklich wählen');
      return selected;
    }
    const sourceNominee = nominee(source, choices.sourceNominee);
    const targetNominee = nominee(target, choices.targetNominee);
    next.organizations.find(o => o.id === source.id).nominee = sourceNominee;
    next.organizations.find(o => o.id === target.id).nominee = targetNominee;
    const at = now || new Date().toISOString();
    check(typeof at === 'string' && Number.isFinite(Date.parse(at)), 'Invalid transfer timestamp / Ungültiger Wechselzeitpunkt');
    check(choices.note === undefined || (typeof choices.note === 'string' && choices.note.length <= 300),
      'Invalid transfer note / Ungültige Wechselnotiz');
    next.transfers = (next.transfers || []).concat([{
      teamId: teamId, sourceOrgId: source.id, targetOrgId: target.id,
      sourceNomineeBefore: source.nominee, targetNomineeBefore: target.nominee,
      sourceNominee: sourceNominee, targetNominee: targetNominee,
      at: at, actor: 'organizer', confirmed: true, duringPlay: !!e.startedAt
    }]);
    if (choices.note !== undefined) next.transfers[next.transfers.length - 1].note = choices.note.trim();
    return validate(next);
  }
  function validateTransition(old, next) {
    const previous = old.transfers || [], transfers = next.transfers || [];
    check(transfers.length >= previous.length &&
      JSON.stringify(transfers.slice(0, previous.length)) === JSON.stringify(previous),
    'Transfer audit frozen / Wechselprotokoll eingefroren');
    if (transfers.length > previous.length) {
      let replay = clone(old);
      transfers.slice(previous.length).forEach(entry => {
        check(entry.duringPlay === !!old.startedAt, 'Invalid transfer freeze audit / Ungültiger Wechsel-Sperrnachweis');
        replay = transferTeam(replay, entry.teamId, entry.targetOrgId, {
          sourceNominee: entry.sourceNominee, targetNominee: entry.targetNominee,
          confirmed: entry.confirmed, note: entry.note
        }, entry.at);
      });
      const expected = clone(replay), actual = clone(next);
      delete expected.revision; delete actual.revision;
      check(JSON.stringify(expected) === JSON.stringify(actual),
        'Transfer must preserve all other event data / Wechsel muss alle anderen Veranstaltungsdaten erhalten');
    } else if (old.startedAt) {
      check(JSON.stringify(old.organizations) === JSON.stringify(next.organizations),
        'Company nominations frozen / Nominierungen eingefroren');
      check(JSON.stringify(old.teams) === JSON.stringify(next.teams) &&
        JSON.stringify(old.config) === JSON.stringify(next.config) && old.startedAt === next.startedAt &&
        old.title === next.title && formatVersion(old) === formatVersion(next),
      'Started event setup frozen / Gestartete Veranstaltung eingefroren');
    }
    return next;
  }
  function balanced(items, count) {
    const groups = Array.from({ length: count }, () => []);
    items.forEach((t, i) => groups[i % count].push(t));
    return groups;
  }
  function rr(ids, prefix, phase) {
    const matches = [];
    for (let a = 0; a < ids.length; a++) for (let b = a + 1; b < ids.length; b++) {
      matches.push({ id: prefix + '-' + (a + 1) + '-' + (b + 1), a: ids[a], b: ids[b], phase: phase, pool: prefix });
    }
    const ordered = [], remaining = matches.slice();
    while (remaining.length) {
      const previous = ordered[ordered.length - 1];
      function disjoint(a, b) { return a.a !== b.a && a.a !== b.b && a.b !== b.a && a.b !== b.b; }
      const candidates = previous ? remaining.filter(m => disjoint(m, previous)) : remaining.slice();
      candidates.sort((a, b) => remaining.filter(m => m !== a && disjoint(m, a)).length -
        remaining.filter(m => m !== b && disjoint(m, b)).length);
      const chosen = candidates[0] || remaining[0];
      ordered.push(chosen); remaining.splice(remaining.indexOf(chosen), 1);
    }
    return ordered;
  }
  function interleave(lists) {
    const out = [], length = Math.max.apply(null, lists.map(list => list.length));
    for (let i = 0; i < length; i++) lists.forEach(list => { if (list[i]) out.push(list[i]); });
    return out;
  }
  function possible(ref, matches) {
    if (typeof ref === 'string') return [ref];
    const m = matches.find(m => m.id === ref.match);
    check(m, 'Missing bracket dependency / Fehlende Abhängigkeit');
    return Array.from(new Set(possible(m.a, matches).concat(possible(m.b, matches))));
  }
  // Potential bracket participants reserve rest even before winners are known.
  function schedule(e, matches, startWave) {
    const remaining = matches.slice(), done = {}, last = {}, plan = [];
    e.matches.forEach(m => {
      done[m.id] = m.wave;
      possible(m.a, e.matches).concat(possible(m.b, e.matches)).forEach(id => { last[id] = Math.max(last[id] == null ? -100 : last[id], m.wave); });
    });
    const all = e.matches.concat(matches);
    let wave = startWave;
    const courts = Math.min(e.fieldLimit || e.config.fields, e.config.referees);
    while (remaining.length) {
      const used = new Set();
      let field = 0;
      for (let i = 0; i < remaining.length && field < courts;) {
        const m = remaining[i];
        const refs = [m.a, m.b].filter(r => typeof r !== 'string');
        const ids = Array.from(new Set(possible(m.a, all).concat(possible(m.b, all))));
        const ready = refs.every(r => done[r.match] != null && done[r.match] < wave) &&
          ids.every(id => !used.has(id) && (last[id] == null || wave - last[id] > e.config.rest));
        if (!ready) { i++; continue; }
        const item = Object.assign({}, m, { wave: wave, field: ++field,
          startMin: time(e.config.start) + wave * (e.config.minutes + e.config.change) +
            (e.replans || []).reduce((sum, replan) => sum + (wave >= replan.fromWave ? replan.delayMinutes : 0), 0) });
        plan.push(item); remaining.splice(i, 1); done[m.id] = wave;
        ids.forEach(id => { last[id] = wave; used.add(id); });
      }
      wave++;
      check(wave < 10000, 'Schedule impossible / Spielplan nicht möglich');
    }
    return plan;
  }
  function build(e, options) {
    validateSetup(e); check(e.status === 'draft', 'Setup frozen / Anmeldung eingefroren');
    validateSetup(Object.assign({}, e, { status: 'groups' }));
    if (formatVersion(e) < CURRENT_FORMAT && !(options && options.allowMissingRoster)) {
      check(e.teams.every(t => t.roster.length >= 2),
        'At least two named players required per team / Mindestens zwei Spieler:innen-Namen je Team erforderlich');
    }
    const next = clone(e);
    const poolCount = formatVersion(next) === LEGACY_FORMAT ? 8 : Math.ceil(next.teams.length / 8);
    next.pools = balanced(next.teams.map(t => t.id), poolCount);
    next.matches = [];
    next.matches = schedule(next, interleave(next.pools.map((p, i) => rr(p, 'G' + (i + 1), 'group'))), 0);
    next.status = 'groups';
    return next;
  }
  function decideOutcome(e, matchId, type, absentTeam, winnerTeam, note, now) {
    const m = e.matches.find(item => item.id === matchId);
    check(m && ['nonappearance', 'withdrawal'].indexOf(type) >= 0, 'Invalid match decision / Ungültige Spielentscheidung');
    check(!(e.status === 'finals' && m.phase === 'group'), 'Group decisions frozen by final draw / Gruppenentscheidungen nach Auslosung eingefroren');
    const a = resolve(e, m.a), b = resolve(e, m.b);
    check(a && b && (absentTeam === a || absentTeam === b), 'Both teams must be resolved and the absent team must be selected / Beide Teams müssen feststehen und das abwesende Team gewählt sein');
    check(!e.results[matchId] && !e.outcomes[matchId], 'A played result or decision already exists / Spielergebnis oder Entscheidung bereits erfasst');
    check(!hasPlayedDescendant(e, matchId), 'Played downstream match: decision frozen / Gespielte Folgerunde: Entscheidung eingefroren');
    check(winnerTeam === null || winnerTeam === (absentTeam === a ? b : a), 'Only the opposing team may receive the organizer-declared win / Nur das gegnerische Team darf den ausdrücklich zugesprochenen Sieg erhalten');
    check(typeof note === 'string' && note.length <= 300, 'Decision note too long / Entscheidungsnotiz zu lang');
    now = now || new Date().toISOString();
    check(typeof now === 'string' && Number.isFinite(Date.parse(now)), 'Invalid decision timestamp / Ungültiger Entscheidungszeitpunkt');
    const next = clone(e);
    next.outcomes[matchId] = { type: type, absentTeam: absentTeam, winnerTeam: winnerTeam,
      note: note.trim(), at: now, confirmed: true };
    if (type === 'withdrawal') next.withdrawals[absentTeam] = { note: note.trim(), at: now };
    if (!next.startedAt) next.startedAt = now;
    return next;
  }
  function resolve(e, ref) {
    if (typeof ref === 'string') return ref;
    const m = e.matches.find(m => m.id === ref.match), r = e.results[ref.match];
    const decision = e.outcomes && e.outcomes[ref.match];
    if (!m || (!r && !decision)) return null;
    const a = resolve(e, m.a), b = resolve(e, m.b);
    const winner = decision ? decision.winnerTeam : (r.a === r.b ? r.drawWinner : r.a > r.b ? a : b);
    if (!winner) return null;
    return ref.outcome === 'winner' ? winner : winner === a ? b : a;
  }
  function hasPlayedDescendant(e, matchId) {
    function depends(ref) {
      if (typeof ref === 'string') return false;
      const parent = e.matches.find(x => x.id === ref.match);
      return ref.match === matchId || depends(parent.a) || depends(parent.b);
    }
    return e.matches.some(x => x.id !== matchId && (e.results[x.id] || (e.outcomes && e.outcomes[x.id])) && (depends(x.a) || depends(x.b)));
  }
  function compare(a, b) {
    return b.points * a.played - a.points * b.played || b.diff * a.played - a.diff * b.played || b.for * a.played - a.for * b.played;
  }
  function table(e, ids, pool) {
    const rows = ids.map(id => ({ id: id, played: 0, points: 0, diff: 0, for: 0 }));
    e.matches.filter(m => m.pool === pool).forEach(m => {
      const r = e.results[m.id], decision = e.outcomes && e.outcomes[m.id];
      if (!r && !decision) return;
      const a = rows.find(t => t.id === m.a), b = rows.find(t => t.id === m.b);
      a.played++; b.played++;
      if (r) {
        a.for += r.a; b.for += r.b; a.diff += r.a - r.b; b.diff += r.b - r.a;
        a.points += r.a > r.b ? 2 : r.a === r.b ? 1 : 0;
        b.points += r.b > r.a ? 2 : r.a === r.b ? 1 : 0;
      } else if (decision.winnerTeam) {
        (decision.winnerTeam === m.a ? a : b).points += 2;
      }
    });
    rows.sort(compare);
    rows.forEach((r, i) => { r.rank = i && compare(rows[i - 1], r) === 0 ? rows[i - 1].rank : i + 1; });
    return rows;
  }
  function finals(e, drawOrder) {
    check(e.status === 'groups' && e.matches.every(m => e.results[m.id] || e.outcomes[m.id]),
      'Complete all group results or decisions first / Erst Gruppenergebnisse oder ausdrückliche Entscheidungen erfassen');
    check(Array.isArray(drawOrder) && drawOrder.length === e.teams.length && unique(drawOrder) &&
      drawOrder.every(id => e.teams.some(t => t.id === id)), 'Record complete tie draw / Vollständiges Losprotokoll erforderlich');
    const next = clone(e);
    next.drawOrder = drawOrder.slice();
    const seeds = [];
    next.pools.forEach((p, i) => {
      const rows = table(next, p, 'G' + (i + 1)).sort((a, b) => compare(a, b) || drawOrder.indexOf(a.id) - drawOrder.indexOf(b.id));
      rows.forEach((r, j) => seeds.push(Object.assign({}, r, { poolRank: j + 1 })));
    });
    seeds.sort((a, b) => a.poolRank - b.poolRank || compare(a, b) || drawOrder.indexOf(a.id) - drawOrder.indexOf(b.id));
    const size = cupSize(next), top = seeds.slice(0, size).map(r => r.id), matches = [];
    const pairs = size === 8 ? [[0, 7], [3, 4], [1, 6], [2, 5]] : size === 4 ? [[0, 3], [1, 2]] : [];
    pairs.forEach((pair, i) => matches.push({ id: 'Q' + i, a: top[pair[0]], b: top[pair[1]], phase: 'cup' }));
    function ref(match, outcome) { return { match: match, outcome: outcome }; }
    if (size === 8) ['winner', 'loser'].forEach((outcome, section) => {
      for (let i = 0; i < 2; i++) matches.push({ id: 'S' + section + i, a: ref('Q' + (i * 2), outcome),
        b: ref('Q' + (i * 2 + 1), outcome), phase: 'cup' });
      ['winner', 'loser'].forEach((result, j) => matches.push({ id: 'F' + section + j,
        a: ref('S' + section + '0', result), b: ref('S' + section + '1', result),
        phase: 'cup', placement: 1 + section * 4 + j * 2 }));
    });
    if (size === 4) ['winner', 'loser'].forEach((outcome, i) => {
      matches.push({ id: 'F0' + i, a: ref('Q0', outcome), b: ref('Q1', outcome),
        phase: 'cup', placement: 1 + i * 2 });
    });
    // Small events replay one complete pool; larger events use contiguous seed bands without byes.
    const rest = seeds.slice(size).map(r => r.id);
    const count = !size ? 1 : formatVersion(next) === LEGACY_FORMAT ? Math.round(rest.length / 4) : Math.ceil(rest.length / 5);
    next.finalPools = [];
    let offset = 0;
    const placementLists = [];
    for (let i = 0; i < count; i++) {
      const size = Math.floor(rest.length / count) + (i < rest.length % count ? 1 : 0);
      const ids = rest.slice(offset, offset + size), name = 'P' + (i + 1);
      next.finalPools.push({ id: name, teams: ids, firstRank: top.length + 1 + offset });
      placementLists.push(rr(ids, name, 'placement'));
      offset += size;
    }
    matches.push.apply(matches, interleave(placementLists));
    const first = Math.max.apply(null, next.matches.map(m => m.wave)) + next.config.rest + 1;
    next.matches.push.apply(next.matches, schedule(next, matches, first));
    next.status = 'finals';
    return next;
  }
  function score(e, matchId, a, b, drawWinner, validating) {
    const m = e.matches.find(m => m.id === matchId);
    check(m && integer(a, 0, 999) && integer(b, 0, 999), 'Invalid timed score / Ungültiger Zeitspielstand');
    check(!(e.status === 'finals' && m.phase === 'group'), 'Group results frozen by final draw / Gruppenergebnisse nach Auslosung eingefroren');
    const teamA = resolve(e, m.a), teamB = resolve(e, m.b);
    check(teamA && teamB, 'Previous match incomplete / Vorgängerspiel fehlt');
    check(!e.outcomes[matchId] && (validating || (!e.withdrawals[teamA] && !e.withdrawals[teamB] &&
      checkInStatus(e, teamA) !== 'absent' && checkInStatus(e, teamB) !== 'absent')),
    'Record an explicit nonappearance/withdrawal decision instead of a played score / Nichtantreten oder Rückzug ausdrücklich statt als Spielergebnis erfassen');
    if (m.phase === 'cup' && a === b) check(drawWinner === teamA || drawWinner === teamB, 'Record knockout tie draw winner / K.-o.-Losgewinner erforderlich');
    // Changing a predecessor must never silently rewrite a played descendant.
    check(!hasPlayedDescendant(e, matchId), 'Played downstream match: result frozen / Gespielte Folgerunde: Ergebnis eingefroren');
    const next = validating ? e : clone(e);
    next.results[matchId] = { a: a, b: b, drawWinner: m.phase === 'cup' && a === b ? drawWinner : null };
    if (!next.startedAt) next.startedAt = new Date().toISOString();
    return next;
  }
  function decideOutcome(e, matchId, type, absentTeam, winnerTeam, note, now) {
    const m = e.matches.find(item => item.id === matchId);
    check(m && ['nonappearance', 'withdrawal'].indexOf(type) >= 0, 'Invalid match decision / Ungültige Spielentscheidung');
    const a = resolve(e, m.a), b = resolve(e, m.b);
    check(a && b && (absentTeam === a || absentTeam === b), 'Both teams must be resolved and the absent team selected / Beide Teams müssen feststehen und das abwesende Team gewählt sein');
    check(!e.results[matchId] && !e.outcomes[matchId], 'A played result or decision already exists / Spielergebnis oder Entscheidung bereits erfasst');
    check(!hasPlayedDescendant(e, matchId), 'Played downstream match: decision frozen / Gespielte Folgerunde: Entscheidung eingefroren');
    check(winnerTeam === null || winnerTeam === (absentTeam === a ? b : a), 'Only the opposing team may receive the organizer-declared win / Nur das gegnerische Team darf den ausdrücklich zugesprochenen Sieg erhalten');
    check(typeof note === 'string' && note.length <= 300, 'Decision note too long / Entscheidungsnotiz zu lang');
    now = now || new Date().toISOString();
    check(typeof now === 'string' && Number.isFinite(Date.parse(now)), 'Invalid decision timestamp / Ungültiger Entscheidungszeitpunkt');
    const next = clone(e);
    next.outcomes[matchId] = { type: type, absentTeam: absentTeam, winnerTeam: winnerTeam,
      note: note.trim(), at: now, confirmed: true };
    if (type === 'withdrawal') next.withdrawals[absentTeam] = { note: note.trim(), at: now };
    if (!next.startedAt) next.startedAt = now;
    return next;
  }
  function replan(e, fromWave, delayMinutes, fields, reason, now) {
    const lastStarted = e.liveWave ? e.liveWave.wave : -1;
    check(integer(fromWave, lastStarted + 1, 9999), 'Only not-yet-started waves can be replanned / Nur noch nicht gestartete Wellen können umgeplant werden');
    check(integer(delayMinutes, 0, 1440) && integer(fields, 1, Math.min(e.config.fields, e.config.referees)),
      'Invalid delay or available court count / Ungültige Verzögerung oder Feldzahl');
    check(fields !== e.fieldLimit || delayMinutes > 0, 'Choose a delay or a changed court count / Verzögerung oder geänderte Feldzahl wählen');
    check(typeof reason === 'string' && reason.trim().length > 0 && reason.length <= 200, 'Enter a reason for the schedule change / Grund für die Spielplanänderung eintragen');
    const future = e.matches.filter(m => m.wave >= fromWave && !e.results[m.id] && !e.outcomes[m.id]);
    check(future.length > 0, 'No unstarted fixtures in this range / In diesem Bereich gibt es keine ungestarteten Spiele');
    check(!e.matches.some(m => m.wave >= fromWave && (e.results[m.id] || e.outcomes[m.id])),
      'Resolve or preserve recorded outcomes before replanning this range / Erfasste Ergebnisse oder Entscheidungen vor dieser Umplanung prüfen');
    now = now || new Date().toISOString();
    check(typeof now === 'string' && Number.isFinite(Date.parse(now)), 'Invalid change timestamp / Ungültiger Änderungszeitpunkt');
    const next = clone(e), previousWaves = {};
    future.forEach(m => { previousWaves[m.id] = m.wave; });
    next.replans.push({ fromWave: fromWave, delayMinutes: delayMinutes, fields: fields,
      reason: reason.trim(), at: now, actor: 'organizer' });
    next.fieldLimit = fields;
    if (fields === e.fieldLimit) {
      next.matches.forEach(m => {
        if (m.wave >= fromWave && Object.prototype.hasOwnProperty.call(previousWaves, m.id)) {
          m.startMin = time(next.config.start) + m.wave * (next.config.minutes + next.config.change) +
            next.replans.reduce((sum, item) => sum + (m.wave >= item.fromWave ? item.delayMinutes : 0), 0);
        }
      });
    } else {
      const fixed = next.matches.filter(m => m.wave < fromWave), all = next.matches;
      const done = {}, last = {}, remaining = future.map(m => all.find(item => item.id === m.id));
      fixed.forEach(m => {
        done[m.id] = m.wave;
        possible(m.a, all).concat(possible(m.b, all)).forEach(id => {
          last[id] = Math.max(last[id] == null ? -100 : last[id], m.wave);
        });
      });
      const limit = Math.min(fields, next.config.referees);
      let wave = fromWave, guard = 0;
      while (remaining.length) {
        const used = new Set(), assigned = [];
        let field = 0;
        for (let i = 0; i < remaining.length && field < limit;) {
          const m = remaining[i], ids = Array.from(new Set(possible(m.a, all).concat(possible(m.b, all))));
          const parents = [m.a, m.b].filter(ref => typeof ref !== 'string');
          const ready = previousWaves[m.id] <= wave && parents.every(ref => done[ref.match] != null && done[ref.match] < wave) &&
            ids.every(id => !used.has(id) && (last[id] == null || wave - last[id] > next.config.rest));
          if (!ready) { i++; continue; }
          m.wave = wave;
          m.field = ++field;
          m.startMin = time(next.config.start) + wave * (next.config.minutes + next.config.change) +
            next.replans.reduce((sum, item) => sum + (wave >= item.fromWave ? item.delayMinutes : 0), 0);
          assigned.push(ids);
          remaining.splice(i, 1);
          done[m.id] = wave;
          ids.forEach(id => used.add(id));
        }
        assigned.forEach(ids => ids.forEach(id => { last[id] = wave; }));
        wave++;
        check(++guard < 10000, 'Remaining matches cannot be safely replanned / Restspiele können nicht konfliktfrei umgeplant werden');
      }
    }
    return next;
  }
  function beginWave(e, wave, now) {
    const matches = e.matches.filter(m => m.wave === wave);
    check(matches.length > 0, 'Unknown wave / Unbekannte Welle');
    check(typeof now === 'string' && Number.isFinite(Date.parse(now)), 'Invalid start timestamp / Startzeitpunkt');
    const pending = matches.filter(m => !e.results[m.id] && !e.outcomes[m.id]);
    check(pending.length > 0 && pending.every(m => resolve(e, m.a) && resolve(e, m.b)), 'Wave already played or unresolved / Welle gespielt oder noch nicht zugeordnet');
    // Attendance is exception-based: teams without an entry count as present; only explicit absences block.
    const blocked = waveReadiness(e, wave).blocked[0];
    if (blocked) {
      const team = e.teams.find(t => t.id === blocked.team);
      check(false, 'Absent team ' + team.name + ' in match ' + blocked.match +
        ': mark it present again or decide a nonappearance before starting / Abwesendes Team ' + team.name +
        ' in Spiel ' + blocked.match + ': wieder als anwesend melden oder Nichtantreten vor Spielstart ausdrücklich entscheiden');
    }
    check(e.matches.filter(m => m.wave < wave).every(m => e.results[m.id] || e.outcomes[m.id]), 'Earlier wave results or decisions missing / Ergebnisse oder Entscheidungen früherer Wellen fehlen');
    if (e.liveWave) {
      check(wave > e.liveWave.wave && Date.parse(now) >= Date.parse(e.liveWave.startedAt) +
        (wave - e.liveWave.wave) * (e.config.minutes + e.config.change) * 60000,
      'Wait for match, changeover and rest intervals / Spiel-, Wechsel- und Ruheintervalle abwarten');
    }
    const next = clone(e);
    if (!next.startedAt) next.startedAt = now;
    next.liveWave = { wave: wave, startedAt: now };
    return next;
  }
  function checkIn(e, teamId, status) {
    check(e.teams.some(t => t.id === teamId), 'Unknown team / Unbekanntes Team');
    check(['unconfirmed', 'checked-in', 'late', 'absent'].indexOf(status) >= 0, 'Invalid check-in status / Ungültiger Check-in-Status');
    const next = clone(e);
    next.checkIns = next.checkIns || {};
    if (status === 'unconfirmed') delete next.checkIns[teamId];
    else next.checkIns[teamId] = status;
    return next;
  }
  function checkInStatus(e, teamId) {
    return e.checkIns && e.checkIns[teamId] || 'unconfirmed';
  }
  function waveReadiness(e, wave) {
    const matches = e.matches.filter(m => m.wave === wave);
    const participants = [];
    matches.forEach(m => [resolve(e, m.a), resolve(e, m.b)].forEach(id => {
      if (id && participants.indexOf(id) < 0) participants.push(id);
    }));
    const pending = matches.filter(m => !e.results[m.id] && !e.outcomes[m.id]);
    // Only explicit absences/withdrawals in still-open matches block; a missing entry means present.
    const blocked = [];
    pending.forEach(m => [resolve(e, m.a), resolve(e, m.b)].forEach(id => {
      if (id && (checkInStatus(e, id) === 'absent' || (e.withdrawals && e.withdrawals[id]))) {
        blocked.push({ team: id, match: m.id, withdrawn: !!(e.withdrawals && e.withdrawals[id]) });
      }
    }));
    const absent = [];
    blocked.forEach(item => { if (absent.indexOf(item.team) < 0) absent.push(item.team); });
    const unconfirmed = participants.filter(id => ['checked-in', 'late', 'absent'].indexOf(checkInStatus(e, id)) < 0);
    const late = participants.filter(id => checkInStatus(e, id) === 'late');
    const missingResults = pending.map(m => m.id);
    const unresolved = pending.filter(m => !resolve(e, m.a) || !resolve(e, m.b)).map(m => m.id);
    return { wave: wave, matches: matches.map(m => m.id), participants: participants,
      unconfirmed: unconfirmed, absent: absent, blocked: blocked, late: late, missingResults: missingResults,
      unresolved: unresolved,
      ready: pending.length > 0 && unresolved.length === 0 && blocked.length === 0 };
  }
  function standings(e) {
    if (e.status !== 'finals') return [];
    const rows = [];
    e.matches.filter(m => m.placement).forEach(m => {
      if (!e.results[m.id] && !e.outcomes[m.id]) return;
      const winner = resolve(e, { match: m.id, outcome: 'winner' });
      const loser = resolve(e, { match: m.id, outcome: 'loser' });
      if (winner) rows.push({ id: winner, rank: m.placement });
      if (loser) rows.push({ id: loser, rank: m.placement + 1 });
    });
    e.finalPools.forEach(p => {
      if (e.matches.filter(m => m.pool === p.id).every(m => e.results[m.id] || e.outcomes[m.id])) {
        table(e, p.teams, p.id).forEach(r => rows.push({ id: r.id, rank: p.firstRank + r.rank - 1 }));
      }
    });
    return rows.sort((a, b) => a.rank - b.rank);
  }
  // Read-only view of every final placement band (decided or still open); never changes standings().
  function placementSlots(e) {
    if (e.status !== 'finals') return [];
    function done(m) { return !!(e.results[m.id] || (e.outcomes && e.outcomes[m.id])); }
    const slots = e.matches.filter(m => m.placement).map(m => ({
      kind: 'match', id: m.id, from: m.placement, to: m.placement + 1, decided: done(m),
      teams: [resolve(e, m.a), resolve(e, m.b)]
    }));
    e.finalPools.forEach(p => {
      const matches = e.matches.filter(m => m.pool === p.id);
      slots.push({ kind: 'pool', id: p.id, from: p.firstRank, to: p.firstRank + p.teams.length - 1,
        decided: matches.every(done), teams: p.teams.slice(),
        played: matches.filter(done).length, total: matches.length });
    });
    return slots.sort((a, b) => a.from - b.from);
  }
  function organizationStandings(e) {
    const teams = standings(e);
    const complete = teams.length === e.teams.length;
    const rows = e.organizations.map(o => {
      const t = teams.find(t => t.id === o.nominee);
      return { id: o.id, nominee: o.nominee, teamRank: t ? t.rank : null, rank: null };
    });
    rows.sort((a, b) => (a.teamRank == null ? Infinity : a.teamRank) - (b.teamRank == null ? Infinity : b.teamRank));
    if (complete) rows.forEach((r, i) => {
      if (r.teamRank !== null) r.rank = i && r.teamRank === rows[i - 1].teamRank ? rows[i - 1].rank : i + 1;
    });
    return rows;
  }
  function estimate(e) {
    const slot = e.config.minutes + e.config.change;
    const waves = e.matches.length ? Math.max.apply(null, e.matches.map(m => m.wave)) + 1 : 0;
    const groupGames = e.pools.length ? Math.min.apply(null, e.pools.map(p => p.length - 1)) : 0;
    function duration(plan) {
      return plan.matches.length ? Math.max.apply(null, plan.matches.map(m => m.startMin - time(plan.config.start) + slot)) : 0;
    }
    function finalMinimum(plan) {
      const games = plan.finalPools.map(p => p.teams.length - 1);
      if (cupSize(plan)) games.push(Math.log(cupSize(plan)) / Math.log(2));
      return games.length ? Math.min.apply(null, games) : 0;
    }
    const minutes = duration(e);
    const warnings = [];
    if (e.config.referees < e.config.fields) warnings.push('referees');
    let projectedMinutes = minutes;
    if (e.status === 'groups') {
      const projection = clone(e);
      projection.matches.forEach(m => { projection.results[m.id] = { a: 0, b: 0, drawWinner: null }; });
      const projected = finals(projection, e.teams.map(t => t.id));
      projectedMinutes = duration(projected);
      const finalGames = finalMinimum(projected);
      warnings.push('finals-pending');
      if (projectedMinutes > e.config.window) warnings.push('window');
      return { waves: waves, minutes: minutes, endMin: time(e.config.start) + minutes,
        projectedMinutes: projectedMinutes, projectedEndMin: time(e.config.start) + projectedMinutes,
        minimumGames: groupGames + finalGames, warnings: warnings,
        courts: Math.min(e.fieldLimit || e.config.fields, e.config.referees) };
    }
    if (projectedMinutes > e.config.window) warnings.push('window');
    const finalGames = e.status === 'finals' ? finalMinimum(e) : 0;
    return { waves: waves, minutes: minutes, endMin: time(e.config.start) + minutes,
      projectedMinutes: projectedMinutes, projectedEndMin: time(e.config.start) + projectedMinutes,
      minimumGames: groupGames + finalGames, warnings: warnings,
      courts: Math.min(e.fieldLimit || e.config.fields, e.config.referees) };
  }
  function validate(e, options) {
    const publicSnapshot = !!(options && options.publicSnapshot);
    if (e && e.config) {
      e.outcomes = e.outcomes || {};
      e.withdrawals = e.withdrawals || {};
      e.replans = e.replans || [];
      e.fieldLimit = e.fieldLimit == null ? Math.min(e.config.fields, e.config.referees) : e.fieldLimit;
    }
    validateSetup(e);
    check(['draft', 'groups', 'finals'].indexOf(e.status) >= 0 && integer(e.revision, 0, Number.MAX_SAFE_INTEGER), 'Invalid state / Status');
    if (!publicSnapshot && e.status !== 'draft' && formatVersion(e) < CURRENT_FORMAT) {
      check(e.teams.every(t => t.roster.length >= 2),
        'At least two named players required per team / Mindestens zwei Spieler:innen-Namen je Team erforderlich');
    }
    check(e.results && typeof e.results === 'object' && !Array.isArray(e.results), 'Invalid results / Ergebnisse');
    check(Array.isArray(e.matches) && Array.isArray(e.pools) && Array.isArray(e.finalPools) && Array.isArray(e.drawOrder), 'Invalid schedule / Spielplan');
    check(e.outcomes && typeof e.outcomes === 'object' && !Array.isArray(e.outcomes) &&
      e.withdrawals && typeof e.withdrawals === 'object' && !Array.isArray(e.withdrawals) &&
      Array.isArray(e.replans) && integer(e.fieldLimit, 1, Math.min(e.config.fields, e.config.referees)),
    'Invalid operational state / Ungültiger Veranstaltungsstatus');
    const baseline = create(e.id, e.title, e.config, e.teams, e.organizations,
      formatVersion(e));
    let expected = baseline;
    if (e.status !== 'draft') expected = build(baseline, { allowMissingRoster: true });
    const groupIds = expected.matches.map(m => m.id);
    groupIds.forEach(id => {
      if (e.outcomes[id]) {
        const d = e.outcomes[id]; expected = decideOutcome(expected, id, d.type, d.absentTeam, d.winnerTeam, d.note, d.at);
      } else if (e.results[id]) {
        const r = e.results[id]; expected = score(expected, id, r.a, r.b, r.drawWinner, true);
      }
    });
    if (e.status === 'finals') expected = finals(expected, e.drawOrder);
    const sameFixtures = e.matches.length === expected.matches.length && e.matches.every((m, i) => {
      const x = expected.matches[i];
      return x && m.id === x.id && JSON.stringify(m.a) === JSON.stringify(x.a) && JSON.stringify(m.b) === JSON.stringify(x.b) &&
        m.phase === x.phase && m.pool === x.pool && m.placement === x.placement;
    });
    check(sameFixtures && JSON.stringify(e.pools) === JSON.stringify(expected.pools) &&
      JSON.stringify(e.finalPools) === JSON.stringify(expected.finalPools), 'Schedule mismatch / Spielplan verändert');
    expected.matches.filter(m => m.phase !== 'group').forEach(m => {
      if (e.outcomes[m.id]) {
        const d = e.outcomes[m.id]; expected = decideOutcome(expected, m.id, d.type, d.absentTeam, d.winnerTeam, d.note, d.at);
      } else if (e.results[m.id]) {
        const r = e.results[m.id]; expected = score(expected, m.id, r.a, r.b, r.drawWinner, true);
      }
    });
    check(Object.keys(e.results).every(id => {
      if (!Object.prototype.hasOwnProperty.call(expected.results, id)) return false;
      const actual = e.results[id], normal = expected.results[id];
      return actual && actual.a === normal.a && actual.b === normal.b && actual.drawWinner === normal.drawWinner &&
        Object.keys(actual).sort().join(',') === 'a,b,drawWinner';
    }), 'Unknown or invalid result / Unbekanntes oder ungültiges Ergebnis');
    check(Object.keys(e.outcomes).every(id => {
      const d = e.outcomes[id], m = e.matches.find(item => item.id === id);
      if (!m || e.results[id] || !d || d.confirmed !== true ||
          ['nonappearance', 'withdrawal'].indexOf(d.type) < 0 || typeof d.note !== 'string' ||
          d.note.length > 300 || typeof d.at !== 'string' || !Number.isFinite(Date.parse(d.at))) return false;
      const a = resolve(e, m.a), b = resolve(e, m.b);
      return (d.absentTeam === a || d.absentTeam === b) &&
        (d.winnerTeam === null || d.winnerTeam === (d.absentTeam === a ? b : a));
    }), 'Unknown or invalid match decision / Ungültige Spielentscheidung');
    check(JSON.stringify(e.outcomes) === JSON.stringify(expected.outcomes), 'Match decision replay mismatch / Spielentscheidungen stimmen nicht');
    check(Object.keys(e.withdrawals).every(id => {
      const w = e.withdrawals[id];
      return e.teams.some(t => t.id === id) && w && typeof w.note === 'string' && w.note.length <= 300 &&
        typeof w.at === 'string' && Number.isFinite(Date.parse(w.at)) &&
        Object.keys(e.outcomes).some(matchId => e.outcomes[matchId].type === 'withdrawal' && e.outcomes[matchId].absentTeam === id);
    }) && JSON.stringify(e.withdrawals) === JSON.stringify(expected.withdrawals),
    'Invalid withdrawal record / Ungültiger Rückzugsnachweis');
    check(e.replans.every((r, i) => r && integer(r.fromWave, 0, 9999) && integer(r.delayMinutes, 0, 1440) &&
      integer(r.fields, 1, Math.min(e.config.fields, e.config.referees)) && text(r.reason, 200) &&
      typeof r.at === 'string' && Number.isFinite(Date.parse(r.at)) && r.actor === 'organizer' &&
      (!i || r.fromWave >= e.replans[i - 1].fromWave)),
    'Invalid replan audit entry / Ungültiger Umplanungsnachweis');
    check(e.transfers === undefined || (Array.isArray(e.transfers) && e.transfers.every(r =>
      r && Object.keys(r).filter(key => key !== 'note').sort().join(',') === 'actor,at,confirmed,duringPlay,sourceNominee,sourceNomineeBefore,sourceOrgId,targetNominee,targetNomineeBefore,targetOrgId,teamId' &&
      (r.note === undefined || (typeof r.note === 'string' && r.note.length <= 300)) &&
      identifier(r.teamId) && r.sourceOrgId !== r.targetOrgId &&
      [r.sourceOrgId, r.targetOrgId].every(id => identifier(id)) &&
      [r.sourceNominee, r.targetNominee, r.sourceNomineeBefore, r.targetNomineeBefore].every(id => id === null || identifier(id)) &&
      typeof r.at === 'string' && Number.isFinite(Date.parse(r.at)) && r.actor === 'organizer' &&
      r.confirmed === true && typeof r.duringPlay === 'boolean')),
    'Invalid transfer audit entry / Ungültiger Wechselnachweis');
    if (e.transfers && e.transfers.length) {
      const history = clone(e);
      function validNominee(orgId, nominee, duringPlay) {
        const candidates = history.teams.filter(t => t.orgId === orgId);
        return candidates.some(t => t.id === nominee) || ((!duringPlay || !candidates.length) && nominee === null);
      }
      e.transfers.slice().reverse().forEach(entry => {
        if (!entry.duringPlay) return;
        const team = history.teams.find(t => t.id === entry.teamId);
        const source = history.organizations.find(o => o.id === entry.sourceOrgId);
        const target = history.organizations.find(o => o.id === entry.targetOrgId);
        check(team && source && target && team.orgId === target.id &&
          source.nominee === entry.sourceNominee && target.nominee === entry.targetNominee &&
          validNominee(source.id, source.nominee, entry.duringPlay) &&
          validNominee(target.id, target.nominee, entry.duringPlay) &&
          (!entry.duringPlay || !!e.startedAt),
        'Transfer audit state mismatch / Wechselprotokoll stimmt nicht mit Zuordnung überein');
        team.orgId = source.id;
        source.nominee = entry.sourceNomineeBefore;
        target.nominee = entry.targetNomineeBefore;
        check(validNominee(source.id, source.nominee, entry.duringPlay) &&
          validNominee(target.id, target.nominee, entry.duringPlay),
        'Invalid previous transfer nominees / Ungültige vorherige Wertungsteams');
      });
    }
    check(e.fieldLimit === (e.replans.length ? e.replans[e.replans.length - 1].fields : Math.min(e.config.fields, e.config.referees)),
      'Current field count does not match replan history / Aktuelle Feldzahl stimmt nicht mit Umplanungshistorie überein');
    const lastUse = {}, bookedCourts = {};
    e.matches.slice().sort((a, b) => a.wave - b.wave || a.field - b.field).forEach(m => {
      check(integer(m.wave, 0, 9999) && integer(m.field, 1, e.config.fields) &&
        m.startMin === time(e.config.start) + m.wave * (e.config.minutes + e.config.change) +
          e.replans.reduce((sum, r) => sum + (m.wave >= r.fromWave ? r.delayMinutes : 0), 0),
      'Schedule mismatch: invalid scheduled time or court / Spielplan verändert: ungültige Spielzeit oder Feldzuordnung');
      const key = m.wave + ':' + m.field;
      check(!bookedCourts[key], 'Duplicate court booking / Doppelte Feldbelegung');
      bookedCourts[key] = true;
      const fieldCapacity = e.replans.reduce((limit, r) => m.wave >= r.fromWave ? r.fields : limit, Math.min(e.config.fields, e.config.referees));
      check(m.field <= fieldCapacity && m.field <= e.config.referees, 'Court exceeds event capacity / Feldzahl überschreitet Veranstaltungskapazität');
      Array.from(new Set(possible(m.a, e.matches).concat(possible(m.b, e.matches)))).forEach(id => {
        check(lastUse[id] == null || m.wave - lastUse[id] > e.config.rest, 'Team rest conflict / Team-Ruhezeitkonflikt');
        lastUse[id] = m.wave;
      });
      [m.a, m.b].filter(ref => typeof ref !== 'string').forEach(ref => {
        const parent = e.matches.find(item => item.id === ref.match);
        check(parent && parent.wave < m.wave, 'Bracket dependency must precede its match / Vorgängerspiel muss vorher liegen');
      });
    });
    check(!Object.keys(e.results).length || !!e.startedAt, 'Invalid nomination lock / Nominierungssperre');
    check(e.status !== 'draft' || !e.startedAt, 'Draft cannot have started / Anmeldung kann nicht gestartet sein');
    check(e.startedAt == null || (typeof e.startedAt === 'string' && Number.isFinite(Date.parse(e.startedAt))), 'Invalid start timestamp / Startzeitpunkt');
    if (e.liveWave) {
      check(e.startedAt && e.matches.some(m => m.wave === e.liveWave.wave) &&
        typeof e.liveWave.startedAt === 'string' && Number.isFinite(Date.parse(e.liveWave.startedAt)), 'Invalid live wave / Ungültige Live-Welle');
    }
    return e;
  }
  function publicSnapshot(e) {
    validate(e);
    const copy = clone(e);
    copy.teams.forEach(t => { t.roster = []; });
    delete copy.checkIns;
    Object.keys(copy.outcomes || {}).forEach(id => { copy.outcomes[id].note = ''; });
    Object.keys(copy.withdrawals || {}).forEach(id => { copy.withdrawals[id].note = ''; });
    (copy.transfers || []).forEach(entry => { if (entry.note !== undefined) entry.note = ''; });
    return { kind: 'firmencup-public', version: SCHEMA, capturedAt: new Date().toISOString(), event: copy };
  }
  return { SCHEMA: SCHEMA, FORMAT_VERSION: CURRENT_FORMAT, MIN_TEAMS: MIN_TEAMS, MAX_TEAMS: MAX_TEAMS,
    MAX_ORGANIZATIONS: MAX_ORGANIZATIONS, teamLimits: teamLimits,
    create: create, build: build, finals: finals, score: score, resolve: resolve,
    table: table, standings: standings, placementSlots: placementSlots, organizationStandings: organizationStandings, estimate: estimate,
    validate: validate, publicSnapshot: publicSnapshot, beginWave: beginWave, checkIn: checkIn,
    decideOutcome: decideOutcome, replan: replan, transferTeam: transferTeam, validateTransition: validateTransition,
    checkInStatus: checkInStatus, waveReadiness: waveReadiness, hasPlayedDescendant: hasPlayedDescendant,
    clock: clock, clone: clone };
});
