/* ============================================================================
   turnier-format.js – setzt aus den Generatoren des Cores ein VOLLSTÄNDIGES
   Turnier zusammen: Gruppenphase + Finalrunde, inklusive Auflösung aller
   Team-Referenzen, Tabellen, Zeitplan und Endstand.

   Bewusst DOM-frei, damit der komplette Turnierablauf in Node testbar ist.
   Der HTML-Bogen ruft nur noch build() auf und rendert das Ergebnis.
   ========================================================================== */
(function (root, factory) {
  const api = factory(root.TC || (typeof require === 'function' ? require('./turnier-core.js') : null));
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TFormat = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (TC) {
  'use strict';

  const GROUP_NAMES = 'ABCDEFGH'.split('');

  /* Wie viele Gruppen sind bei N Teams sinnvoll?
     Ziel (AGENTS.md §5): Gruppen von 4–6 Teams. Darunter spielt jeder zu
     selten, darüber wird die Vorrunde zu lang.                               */
  function autoGroupCount(n) {
    if (n <= 5) return 1;
    if (n <= 9) return 2;
    if (n <= 15) return 3;
    if (n <= 20) return 4;
    return 5;
  }

  const FINAL_MODES = [
    { id: 'placement', label: 'Über-Kreuz-Platzierungsrunde (jedes Team spielt weiter)' },
    { id: 'ko', label: 'KO-Runde mit Spiel um Platz 3' },
    { id: 'main', label: 'Hauptrunde (zweite Gruppenphase über Kreuz)' },
    { id: 'none', label: 'Keine Finalrunde – nur Gruppenphase' }
  ];

  /* ==========================================================================
     Aufbau
     cfg = { teams, groups:'auto'|n|0, fields, setMode, finalSetMode, finalMode,
             startTime, absent:[], results:{matchId:[[a,b],…]} }

     groups: 0 → KEINE Gruppenphase. Alle Teams starten direkt im KO-Baum
     (Setzliste = Teamnummer), fehlende Plätze zur Zweierpotenz werden als
     Freilos an die bestgesetzten Teams vergeben.
     ======================================================================== */
  function build(cfg) {
    const c = Object.assign({
      teams: 8, groups: 'auto', fields: 2, setMode: '21',
      finalSetMode: null, finalMode: 'placement', thirdPlace: true,
      startTime: '10:00', absent: [], results: {}
    }, cfg || {});

    const warnings = [];
    const absent = new Set((c.absent || []).map(Number));
    const all = TC.normalizeTeamList(c.teams);
    const koOnly = (c.groups === 0);
    if (koOnly) c.finalMode = 'ko';
    if (koOnly && all.length < 4) {
      warnings.push('Ein reines KO-Turnier braucht mindestens 4 Teams – '
        + 'sonst stünde schon im Halbfinale ein Freilos.');
    }
    const gCount = koOnly ? 0 : Math.min(
      GROUP_NAMES.length,
      Math.max(1, c.groups === 'auto' ? autoGroupCount(all.length) : (c.groups | 0))
    );

    /* --- Gruppen ---------------------------------------------------------
       Die Einteilung erfolgt über ALLE Teams, auch über ausgefallene: der
       einmal gedruckte Spielplan darf sich durch einen Ausfall nicht ändern.
       Ausfälle wirken erst in der Wertung (Gegner erhält ein Freilos).       */
    const names = GROUP_NAMES.slice(0, gCount);
    const groups = koOnly ? {} : TC.genGroups(all, gCount, { distribution: 'sequential', names });
    const groupSizes = {};
    names.forEach(n => groupSizes[n] = groups[n].length);
    names.forEach(n => {
      if (groups[n].length < 2) warnings.push('Gruppe ' + n + ' hat weniger als 2 Teams.');
    });

    const grpRounds = koOnly ? [] : TC.genGroupPhase(groups, { idPrefix: 'g' });

    /* --- Ergebnisse ------------------------------------------------------- */
    const resCache = new Map();
    function resultOf(matchId, modeId) {
      const key = matchId + '|' + modeId;
      if (resCache.has(key)) return resCache.get(key);
      const r = TC.computeResult(c.results[matchId], modeId);
      resCache.set(key, r);
      return r;
    }

    /* --- Gruppentabellen -------------------------------------------------- */
    const groupMatches = {};
    names.forEach(n => groupMatches[n] = []);
    grpRounds.forEach(rd => rd.matches.forEach(m => groupMatches[m.group].push(m)));

    function playedFrom(matches, modeId) {
      const out = [];
      matches.forEach(m => {
        const a = m.ta != null ? m.ta : m.a, b = m.tb != null ? m.tb : m.b;
        if (a == null || b == null) return;
        const aAbs = absent.has(a), bAbs = absent.has(b);
        if (aAbs && bAbs) return;
        if (aAbs) { out.push({ bye: b }); return; }
        if (bAbs) { out.push({ bye: a }); return; }
        const r = resultOf(m.id, modeId);
        if (r) out.push({ a, b, result: r });
      });
      return out;
    }

    function tableFor(teamList, matches, modeId) {
      const active = teamList.filter(t => !absent.has(t));
      const played = playedFrom(matches, modeId);
      const st = TC.standings(active, played, { perGame: true });
      const unequal = !TC.equalGames(active, st);
      const criteria = TC.criteriaFor(modeId, { unequalGames: unequal });
      const ranked = TC.rank(active, st, { criteria, matches: played });
      const total = matches.filter(m => {
        const a = m.ta != null ? m.ta : m.a, b = m.tb != null ? m.tb : m.b;
        return a != null && b != null && !absent.has(a) && !absent.has(b);
      }).length;
      return {
        teams: active, ranked, stat: st, criteria, perGame: unequal,
        complete: total > 0 && played.filter(p => p.result).length === total,
        matchCount: total
      };
    }

    const groupTables = {};
    names.forEach(n => groupTables[n] = tableFor(groups[n], groupMatches[n], c.setMode));

    /* --- Auflösung von Referenzen ----------------------------------------
       Ein Gruppenplatz steht erst fest, wenn ALLE Spiele der Gruppe gewertet
       sind. Vorher bleibt die Finalpaarung bewusst offen und zeigt "A-1" –
       so wie auf dem gedruckten Bogen.                                       */
    const finalMode = c.finalMode;
    const notes = [];
    /* In einer KO- oder Platzierungspartie MUSS ein Sieger feststehen –
       ein Unentschieden ließe den Turnierbaum stehen. Modi ohne Entscheidungs-
       satz werden deshalb für solche Runden auf die Entscheidungssatz-Variante
       angehoben. Sichtbar als Hinweis, nicht still.                          */
    const wantedFinMode = c.finalSetMode || c.setMode;
    const needsWinner = (finalMode === 'placement' || finalMode === 'ko');
    let finMode = wantedFinMode;
    if (needsWinner) {
      const up = { '2x15': '2x15tb', '2x21': '2x21tb' }[wantedFinMode];
      if (up) {
        finMode = up;
        notes.push('Finalrunde: „' + TC.modeDef(wantedFinMode).label + '“ kann unentschieden enden. '
          + 'Für die Platzierung ist ein Sieger nötig – gespielt wird daher „'
          + TC.modeDef(up).label + '“.');
      }
    }
    const winnerOf = {};    // matchId → teamNo
    const loserOf = {};

    function rankResolver(phase, group, place) {
      if (phase === 'main') {
        const t = mainTables && mainTables[group];
        if (!t || !t.complete) return null;
        const e = t.ranked[place - 1];
        return (e && !e.shared) ? e.team : null;
      }
      const t = groupTables[group];
      if (!t || !t.complete) return null;
      const e = t.ranked[place - 1];
      return (e && !e.shared) ? e.team : null;
    }
    const resolvers = {
      rank: rankResolver,
      winner: id => (id in winnerOf) ? winnerOf[id] : null,
      loser: id => (id in loserOf) ? loserOf[id] : null
    };
    function resolve(ref) { return TC.resolveRef(ref, resolvers); }

    /* Löst die Seiten eines Spiels auf und trägt Sieger/Verlierer nach, damit
       Folgespiele (KO-Baum, Über-Kreuz) direkt weiterverdrahtet werden. */
    function resolveMatch(m, modeId) {
      const ta = resolve(m.a), tb = resolve(m.b);
      m.ta = ta; m.tb = tb;
      // Freilos: ein Platzhalter oder ein ausgefallener Gegner
      const aBye = (m.a && m.a.k === 'bye') || (ta != null && absent.has(ta));
      const bBye = (m.b && m.b.k === 'bye') || (tb != null && absent.has(tb));
      if (aBye && !bBye && tb != null) { m.bye = tb; winnerOf[m.id] = tb; loserOf[m.id] = null; return m; }
      if (bBye && !aBye && ta != null) { m.bye = ta; winnerOf[m.id] = ta; loserOf[m.id] = null; return m; }
      if (ta == null || tb == null) return m;
      const r = resultOf(m.id, modeId);
      m.result = r;
      if (r && r.winner === 'a') { winnerOf[m.id] = ta; loserOf[m.id] = tb; }
      else if (r && r.winner === 'b') { winnerOf[m.id] = tb; loserOf[m.id] = ta; }
      else if (r && r.draw) {
        /* Ein Remis kann keinen Sieger für die nächste Runde liefern.
           In KO-artigen Runden ist das ein Bedienfehler, kein stiller
           Zufallsentscheid – deshalb sichtbare Warnung. */
        m.needsDecision = true;
      }
      return m;
    }

    /* Gruppenspiele auflösen (a/b sind dort bereits Teamnummern). */
    grpRounds.forEach(rd => rd.matches.forEach(m => resolveMatch(m, c.setMode)));

    /* --- Finalrunde ------------------------------------------------------- */
    let finalRounds = [];
    let finalTitle = '';
    let placementBlocks = null;
    let bracket = null;
    let mainTables = null;
    let mainGroups = null;

    /* Rangliste der Qualifikationsplätze in Setz-Reihenfolge: A1,B1,A2,B2,…
       Ohne Gruppenphase ist die Setzliste einfach die Teamnummer. */
    function seedSlots() {
      if (koOnly) return all.map(n => ({ k: 'team', n }));
      const slots = [];
      const maxPlace = Math.max.apply(null, names.map(n => groupSizes[n]));
      for (let p = 1; p <= maxPlace; p++) {
        names.forEach(n => {
          if (groupSizes[n] >= p) slots.push({ k: 'rank', phase: 'grp', group: n, place: p });
        });
      }
      return slots;
    }

    if (finalMode === 'placement') {
      finalTitle = 'Platzierungsrunde (über Kreuz)';
      const pl = TC.genPlacement(names, groupSizes, { idPrefix: 'pl', phase: 'grp' });
      placementBlocks = pl.blocks;
      finalRounds = pl.rounds || blocksToRounds(pl.blocks);
    } else if (finalMode === 'ko') {
      finalTitle = koOnly ? 'KO-Runde' : 'KO-Runde';
      const slots = seedSlots();
      /* Mit Gruppenphase qualifizieren sich nur so viele Teams, wie der Baum
         ohne Freilose fasst. Ohne Gruppenphase startet jedes gemeldete Team –
         der Baum wird mit Freilosen für die bestgesetzten Teams aufgefüllt. */
      const koTeams = koOnly ? slots.length : Math.min(slots.length, pow2Floor(slots.length));
      if (koTeams < slots.length) {
        warnings.push('KO-Runde mit ' + koTeams + ' von ' + slots.length
          + ' Teams – die übrigen sind nach der Gruppenphase platziert.');
      }
      bracket = TC.genBracket(slots.slice(0, koTeams), {
        idPrefix: 'ko', thirdPlace: c.thirdPlace !== false
      });
      if (koOnly && bracket.byes > 0) {
        warnings.push(bracket.byes + ' Freilos' + (bracket.byes === 1 ? '' : 'e')
          + ' in Runde 1 – ' + bracket.byes + ' Team'
          + (bracket.byes === 1 ? ' zieht' : 's ziehen') + ' kampflos weiter.');
      }
      finalRounds = bracket.rounds.map(r => ({
        round: r.round, title: r.label, matches: r.matches, byes: []
      }));
    } else if (finalMode === 'main') {
      finalTitle = 'Hauptrunde';
      const slots = seedSlots();
      const half = Math.ceil(slots.length / 2);
      mainGroups = { 'Gold': slots.slice(0, half), 'Silber': slots.slice(half) };
      const mainNames = Object.keys(mainGroups).filter(n => mainGroups[n].length >= 2);
      const perGroup = {};
      let maxR = 0;
      mainNames.forEach(n => {
        const rr = TC.genRoundRobin(mainGroups[n].length, { idPrefix: 'h' + n });
        // Positionen 1..k auf die Setz-Slots der Hauptrundengruppe abbilden
        perGroup[n] = rr.map(rd => ({
          round: rd.round,
          bye: rd.bye != null ? mainGroups[n][rd.bye - 1] : null,
          matches: rd.matches.map(m => ({
            id: m.id, round: m.round, group: n,
            a: mainGroups[n][m.a - 1], b: mainGroups[n][m.b - 1]
          }))
        }));
        if (perGroup[n].length > maxR) maxR = perGroup[n].length;
      });
      for (let r = 0; r < maxR; r++) {
        const matches = [];
        mainNames.forEach(n => { if (perGroup[n][r]) perGroup[n][r].matches.forEach(m => matches.push(m)); });
        finalRounds.push({ round: r + 1, title: 'Hauptrunde – Runde ' + (r + 1), matches, byes: [] });
      }
    }

    finalRounds.forEach(rd => rd.matches.forEach(m => resolveMatch(m, finMode)));

    /* Sprechende Spielnamen. Auf dem gedruckten Bogen darf nie eine interne ID
       stehen – „Sieger HF1“ bzw. „Sieger A-1 : B-2“ ist ohne Erklärung lesbar. */
    const allById = {};
    grpRounds.forEach(rd => rd.matches.forEach(m => allById[m.id] = m));
    finalRounds.forEach(rd => rd.matches.forEach(m => allById[m.id] = m));

    grpRounds.forEach(rd => rd.matches.forEach((m, i) => {
      m.name = 'Gruppe ' + m.group + ' – R' + m.round;
    }));
    if (finalMode === 'ko' && bracket) {
      const abbr = { 'Finale': 'F', 'Halbfinale': 'HF', 'Viertelfinale': 'VF', 'Achtelfinale': 'AF' };
      bracket.rounds.forEach(r => {
        const a = abbr[r.label] || ('R' + r.round);
        let i = 0;
        r.matches.forEach(m => {
          m.name = m.places ? 'Spiel um Platz 3' : (a === 'F' ? 'Finale' : a + (++i));
        });
      });
    } else {
      finalRounds.forEach(rd => rd.matches.forEach(m => {
        m.name = TC.refLabel(m.a) + ' : ' + TC.refLabel(m.b);
      }));
    }
    function matchLabel(id) {
      const m = allById[id];
      return (m && m.name) ? m.name : id;
    }

    /* Hauptrunden-Tabellen erst NACH der Auflösung berechnen. */
    if (finalMode === 'main' && mainGroups) {
      mainTables = {};
      Object.keys(mainGroups).forEach(n => {
        const ms = [];
        finalRounds.forEach(rd => rd.matches.forEach(m => { if (m.group === n) ms.push(m); }));
        const teamList = ms.reduce((acc, m) => {
          if (m.ta != null && acc.indexOf(m.ta) < 0) acc.push(m.ta);
          if (m.tb != null && acc.indexOf(m.tb) < 0) acc.push(m.tb);
          return acc;
        }, []);
        mainTables[n] = tableFor(teamList, ms, finMode);
      });
    }

    /* --- Zeitplan --------------------------------------------------------- */
    const startMin = TC.toMin(c.startTime) != null ? TC.toMin(c.startTime) : TC.toMin('10:00');
    const teamOf = ref => resolve(ref);
    const grpSlots = TC.computeSchedule(
      TC.assignSlots(grpRounds, c.fields, { teamOf }), startMin, c.setMode);
    const grpEnd = grpSlots.length ? grpSlots[grpSlots.length - 1].endMin : startMin;
    const finSlotsRaw = TC.assignSlots(finalRounds, c.fields, { teamOf });
    const finSlots = TC.computeSchedule(finSlotsRaw, grpEnd, finMode)
      .map(s => Object.assign(s, { title: titleOfRound(finalRounds, s.round) }));
    const endMin = finSlots.length ? finSlots[finSlots.length - 1].endMin : grpEnd;

    function titleOfRound(rounds, r) {
      const rd = rounds.find(x => x.round === r);
      return rd && rd.title ? rd.title : ('Runde ' + r);
    }

    /* --- Endstand --------------------------------------------------------- */
    const placements = computePlacements();

    function computePlacements() {
      const out = [];
      if (finalMode === 'placement' && placementBlocks) {
        placementBlocks.forEach(bl => {
          if (bl.direct) {
            out.push({ place: bl.places[0], team: resolve(bl.direct),
              source: 'ohne Finalspiel (' + TC.refLabel(bl.direct) + ')' });
            return;
          }
          if (bl.roundRobin) {
            const ms = bl.matches;
            const teamList = ms.reduce((acc, m) => {
              [m.ta, m.tb].forEach(t => { if (t != null && acc.indexOf(t) < 0) acc.push(t); });
              return acc;
            }, []);
            const tb = tableFor(teamList, ms, finMode);
            for (let i = 0; i < bl.places[1] - bl.places[0] + 1; i++) {
              const e = tb.ranked[i];
              out.push({ place: bl.places[0] + i, team: e ? e.team : null,
                source: '3er-Runde um Platz ' + bl.places[0] + '–' + bl.places[1] });
            }
            return;
          }
          bl.matches.forEach(m => {
            if (!m.places) return;
            const src = 'Spiel um Platz ' + m.places.join('/');
            out.push({ place: m.places[0], team: winnerOf[m.id] != null ? winnerOf[m.id] : null, source: src });
            out.push({ place: m.places[1], team: loserOf[m.id] != null ? loserOf[m.id] : null, source: src });
          });
        });
      } else if (finalMode === 'ko' && bracket) {
        const rc = bracket.rounds.length;
        const last = bracket.rounds[rc - 1];
        const fin = last.matches.find(m => !m.places);
        if (fin) {
          out.push({ place: 1, team: winnerOf[fin.id] != null ? winnerOf[fin.id] : null, source: 'Finale' });
          out.push({ place: 2, team: loserOf[fin.id] != null ? loserOf[fin.id] : null, source: 'Finale' });
        }
        const p3 = last.matches.find(m => m.places);
        if (p3) {
          out.push({ place: 3, team: winnerOf[p3.id] != null ? winnerOf[p3.id] : null, source: 'Spiel um Platz 3' });
          out.push({ place: 4, team: loserOf[p3.id] != null ? loserOf[p3.id] : null, source: 'Spiel um Platz 3' });
        }
        const placed = new Set(out.map(o => o.team).filter(t => t != null));
        if (koOnly) {
          /* Ohne Gruppenphase gibt es für die ausgeschiedenen Teams keine
             Rangliste. Im KO-System teilen sich alle Verlierer derselben
             Runde denselben Platzbereich (5.–8., 9.–16. …). Wer eine feste
             Reihenfolge braucht, spielt Platzierungsspiele. */
          for (let ri = rc - 2; ri >= 0; ri--) {
            const rd = bracket.rounds[ri];
            const from = Math.pow(2, rc - 1 - ri) + 1;
            const to = Math.pow(2, rc - ri);
            const range = (from === to) ? String(from) + '.' : from + '.–' + to + '.';
            const src = (ri === rc - 2 && p3) ? null : rd.label;
            if (src === null) continue;     // Halbfinale ist über Platz 3 geregelt
            rd.matches.forEach(m => {
              const t = loserOf[m.id];
              if (t == null || placed.has(t)) return;
              placed.add(t);
              out.push({ place: from, placeTo: to, rangeLabel: range, team: t,
                shared: from !== to, source: 'ausgeschieden im ' + rd.label });
            });
          }
        } else {
          // Restliche Plätze aus der Gruppenphase, in Setz-Reihenfolge
          let p = out.length + 1;
          seedSlots().forEach(s => {
            const t = resolve(s);
            if (t == null || placed.has(t)) return;
            placed.add(t);
            out.push({ place: p++, team: t, source: 'Gruppenphase' });
          });
        }
      } else if (finalMode === 'main' && mainTables) {
        let p = 1;
        Object.keys(mainTables).forEach(n => {
          mainTables[n].ranked.forEach(e => out.push({ place: p++, team: e.team, source: 'Hauptrunde ' + n }));
        });
      } else {
        // Nur Gruppenphase: A1,B1,A2,B2 … als Gesamtreihung
        let p = 1;
        seedSlots().forEach(s => out.push({ place: p++, team: resolve(s), source: 'Gruppenphase' }));
      }
      return out.sort((x, y) => x.place - y.place);
    }

    /* --- Warnungen -------------------------------------------------------- */
    const allMatches = [];
    grpRounds.forEach(rd => rd.matches.forEach(m => allMatches.push(m)));
    finalRounds.forEach(rd => rd.matches.forEach(m => allMatches.push(m)));
    if (allMatches.some(m => m.needsDecision)) {
      warnings.push('Ein Spiel der Finalrunde endete unentschieden – hier muss ein '
        + 'Entscheidungssatz gespielt oder der Satzmodus mit Entscheidungssatz gewählt werden.');
    }
    if (finalMode !== 'none' && names.some(n => !groupTables[n].complete)) {
      warnings.push('Die Finalpaarungen stehen erst fest, wenn alle Gruppenspiele eingetragen sind.');
    }
    names.forEach(n => {
      const t = groupTables[n];
      if (t.complete && t.ranked.some(e => e.shared)) {
        warnings.push('Gruppe ' + n + ': Gleichstand nach allen Kriterien – hier entscheidet das Los.');
      }
    });

    return {
      config: c, groups, groupNames: names, groupSizes,
      groupRounds: grpRounds, groupTables, groupMatches,
      finalMode, finalTitle, finalRounds, finalSetMode: finMode,
      placementBlocks, bracket, mainGroups, mainTables,
      grpSlots, finSlots, startMin, grpEndMin: grpEnd, endMin,
      placements, warnings, notes, absent: Array.from(absent),
      resolve, resultOf, winnerOf, loserOf, allMatches, matchLabel,
      matchById: allMatches.reduce((a, m) => (a[m.id] = m, a), {})
    };
  }

  function blocksToRounds(blocks) {
    /* Über-Kreuz: zuerst laufen ALLE Kreuz-Spiele parallel, danach alle
       Platzierungsspiele. So sind die Felder gleichmäßig belegt.             */
    const cross = [], finals = [], rr = [];
    blocks.forEach(bl => bl.matches.forEach(m => {
      if (m.stage === 'cross') cross.push(m);
      else if (m.stage === 'rr') rr.push(m);
      else finals.push(m);
    }));
    const rounds = [];
    if (cross.length) rounds.push({ round: 1, title: 'Platzierung – Über-Kreuz', matches: cross, byes: [] });
    if (finals.length) rounds.push({ round: rounds.length + 1, title: 'Platzierung – Entscheidung', matches: finals, byes: [] });
    if (rr.length) rounds.push({ round: rounds.length + 1, title: 'Platzierung – 3er-Runde', matches: rr, byes: [] });
    return rounds;
  }

  function pow2Floor(n) { let p = 1; while (p * 2 <= n) p *= 2; return p; }

  /* ==========================================================================
     RUNDENBASIERTE TURNIERE (kein Gruppen-, kein KO-Baum)

     Deckt die beiden Formate ab, die ohne Vorrunde/Finalrunde auskommen:
       mode:'rr'    – Jeder gegen Jeden (Spielplan steht komplett vorher fest)
       mode:'swiss' – Schweizer System (Runde N wird aus dem Stand nach N-1
                      gebildet: rangnah, ohne Wiederholung, faires Freilos)

     cfg = { mode, teams, fields, rounds, setMode, roundModes:{r:modeId},
             startTime, absent:[], results:{}, fixedPairs:{r:[[a,b],…]},
             round1:[[a,b],…] }

     fixedPairs friert bereits ausgeloste Runden ein. Das ist im Schweizer
     System zwingend: sobald in einer Runde ein Ergebnis steht, darf sich die
     Paarung nicht mehr ändern, sonst wandern eingetragene Zahlen auf andere
     Teams. Der Bogen persistiert dazu `pairs` jeder angefangenen Runde.
     ======================================================================== */
  const ROUND_MODES = [
    { id: 'rr',    label: 'Jeder gegen Jeden' },
    { id: 'swiss', label: 'Schweizer System' }
  ];

  /* Empfohlene Rundenzahl im Schweizer System: so viele, dass die Rangfolge
     aussagekräftig wird, aber jede Paarung wiederholungsfrei bleibt. */
  function defaultSwissRounds(n) {
    if (n <= 5) return 3;
    if (n <= 8) return 4;
    if (n <= 16) return 5;
    return 6;
  }
  function maxSwissRounds(n) { return Math.max(1, n - (n % 2 === 0 ? 1 : 0)); }

  function buildRounds(cfg) {
    const c = Object.assign({
      mode: 'rr', teams: 8, fields: 2, rounds: null, setMode: '21',
      roundModes: {}, startTime: '10:00', absent: [], results: {},
      fixedPairs: {}, round1: null
    }, cfg || {});

    const warnings = [], notes = [];
    const absent = new Set((c.absent || []).map(Number));
    const all = TC.normalizeTeamList(c.teams);
    const active = all.filter(t => !absent.has(t));

    /* Satzmodus je Runde: einmal angefangen, bleibt er stehen. Sonst würden
       bereits eingetragene Ergebnisse nachträglich ungültig. */
    function modeOfRound(r) {
      const f = c.roundModes && c.roundModes[r];
      return f || c.setMode;
    }
    const resCache = new Map();
    function resultOf(matchId, modeId) {
      const k = matchId + '|' + modeId;
      if (resCache.has(k)) return resCache.get(k);
      const r = TC.computeResult(c.results[matchId], modeId);
      resCache.set(k, r);
      return r;
    }
    const idOf = (r, i) => (c.mode === 'swiss' ? 'sw_' : 'rr_') + r + '_' + i;
    function roundHasInput(r, count) {
      for (let i = 0; i < count + 4; i++) {
        const v = c.results[idOf(r, i)];
        if (v && v.some(p => p && p.some(x => x != null && x !== ''))) return true;
      }
      return false;
    }

    /* --- Runden erzeugen --------------------------------------------------
       Im Schweizer System braucht Runde N den Tabellenstand nach N-1. Die
       Ergebnisse werden deshalb SOFORT nach dem Erzeugen einer Runde
       eingetragen, nicht erst am Ende.                                      */
    const rounds = [];
    const pairsOut = {};
    const tableCache = new Map();

    function attachResults(rd) {
      const mode = modeOfRound(rd.round);
      rd.setMode = mode;
      rd.matches.forEach(m => {
        m.ta = m.a; m.tb = m.b;
        const aAbs = absent.has(m.a), bAbs = absent.has(m.b);
        if (aAbs && bAbs) { m.dead = true; return; }
        if (aAbs) { m.bye = m.b; return; }
        if (bAbs) { m.bye = m.a; return; }
        m.result = resultOf(m.id, mode);
      });
      rd.frozen = roundHasInput(rd.round, rd.matches.length);
      tableCache.clear();
    }

    function roundStarted(rd) {
      return rd.matches.some(m => m.result || m.bye != null);
    }

    /* Kumuliert über alle bisher erzeugten Runden bis einschliesslich `upto`.
       Ein Freilos zaehlt als Sieg ohne Ballpunkte (AGENTS.md §4).            */
    function playedUpto(upto) {
      const out = [];
      rounds.forEach(rd => {
        if (rd.round > upto) return;
        rd.matches.forEach(m => {
          if (m.dead) return;
          if (m.bye != null) { out.push({ bye: m.bye }); return; }
          if (m.result) out.push({ a: m.ta, b: m.tb, result: m.result });
        });
        if (rd.bye != null && !absent.has(rd.bye) && roundStarted(rd)) out.push({ bye: rd.bye });
      });
      return out;
    }

    function tableUpto(upto) {
      if (tableCache.has(upto)) return tableCache.get(upto);
      const played = playedUpto(upto);
      const st = TC.standings(active, played, { perGame: true });
      const unequal = !TC.equalGames(active, st);
      const criteria = TC.criteriaFor(c.setMode, { unequalGames: unequal });
      const ranked = TC.rank(active, st, { criteria, matches: played });
      const t = { ranked, stat: st, criteria, perGame: unequal, played };
      tableCache.set(upto, t);
      return t;
    }
    function rankUpto(upto) { return tableUpto(upto).ranked.map(e => e.team); }

    if (c.mode === 'rr') {
      /* Der Plan steht vollständig vorher fest und darf sich durch einen
         Ausfall NICHT ändern – er ist ausgedruckt. */
      TC.genRoundRobin(all, { idPrefix: 'rr' }).forEach(rd => {
        const row = {
          round: rd.round, title: 'Runde ' + rd.round,
          matches: rd.matches.map((m, i) => ({ id: idOf(rd.round, i), round: rd.round, a: m.a, b: m.b })),
          bye: rd.bye
        };
        rounds.push(row);
        attachResults(row);
      });
    } else {
      const want = Math.max(1, Math.min(
        maxSwissRounds(all.length),
        c.rounds ? (c.rounds | 0) : defaultSwissRounds(all.length)));
      if (c.rounds && c.rounds > maxSwissRounds(all.length)) {
        warnings.push('Bei ' + all.length + ' Teams sind höchstens '
          + maxSwissRounds(all.length) + ' wiederholungsfreie Runden möglich.');
      }
      const played = new Set();
      const byeHist = { counts: {}, lastRound: {} };

      for (let r = 1; r <= want; r++) {
        const fixed = c.fixedPairs && c.fixedPairs[r];
        let pairs, bye = null;

        if (fixed && fixed.length) {
          pairs = fixed.map(p => [p[0], p[1]]);
          const used = new Set();
          pairs.forEach(p => { used.add(p[0]); used.add(p[1]); });
          const left = all.filter(t => !used.has(t));
          bye = left.length === 1 ? left[0] : null;
        } else if (r === 1 && c.round1 && c.round1.length) {
          pairs = c.round1.map(p => [p[0], p[1]]);
          const used = new Set();
          pairs.forEach(p => { used.add(p[0]); used.add(p[1]); });
          const left = active.filter(t => !used.has(t));
          bye = left.length === 1 ? left[0] : null;
        } else if (r === 1) {
          /* Startrunde ohne Auslosung: 1-2, 3-4, … – auf dem Papier sofort
             nachvollziehbar und beliebig per „Auslosen" ersetzbar. */
          pairs = [];
          const list = active.slice();
          if (list.length % 2 === 1) bye = list.pop();
          for (let i = 0; i + 1 < list.length; i += 2) pairs.push([list[i], list[i + 1]]);
        } else {
          const order = rankUpto(r - 1).filter(t => !absent.has(t));
          const sw = TC.genSwissRound(order, played, byeHist, want - r);
          pairs = sw.pairs || [];
          bye = sw.bye;
          if (!sw.exhaustive) {
            notes.push('Runde ' + r + ': Es war keine vollständig wiederholungsfreie '
              + 'Paarung mehr möglich – eine Begegnung wiederholt sich.');
          }
        }

        pairs.forEach(p => played.add(TC.pairKey(p[0], p[1])));
        if (bye != null) {
          byeHist.counts[bye] = (byeHist.counts[bye] || 0) + 1;
          byeHist.lastRound[bye] = r;
        }
        pairsOut[r] = pairs.map(p => [p[0], p[1]]);
        const row = {
          round: r, title: 'Runde ' + r,
          matches: pairs.map((p, i) => ({ id: idOf(r, i), round: r, a: p[0], b: p[1] })),
          bye: bye
        };
        rounds.push(row);
        attachResults(row);
      }
    }

    const table = tableUpto(rounds.length);

    /* --- Zeitplan ---------------------------------------------------------
       Jede Runde wird mit IHREM Satzmodus getaktet, sonst stimmt die Uhrzeit
       nicht, wenn mitten im Turnier der Modus wechselt.                     */
    const startMin = TC.toMin(c.startTime) != null ? TC.toMin(c.startTime) : TC.toMin('10:00');
    const slots = [];
    let cursor = startMin;
    rounds.forEach(rd => {
      const per = TC.MODE_MIN[String(rd.setMode)] || 25;
      TC.assignSlots([rd], c.fields).forEach(s => {
        slots.push(Object.assign({}, s, {
          slot: slots.length + 1, title: rd.title,
          startMin: cursor, endMin: cursor + per, minutes: per
        }));
        cursor += per;
      });
    });
    const endMin = cursor;

    /* --- Endstand & Hinweise ---------------------------------------------- */
    const placements = table.ranked.map(e => ({
      place: e.place, team: e.team, shared: e.shared,
      source: c.mode === 'swiss' ? 'Schweizer Tabelle' : 'Gesamttabelle'
    }));

    const totalMatches = rounds.reduce((a, rd) => a + rd.matches.length, 0);
    const openMatches = rounds.reduce((a, rd) =>
      a + rd.matches.filter(m => !m.result && m.bye == null && !m.dead).length, 0);
    if (openMatches === 0 && totalMatches > 0 && table.ranked.some(e => e.shared)) {
      warnings.push('Gleichstand nach allen Kriterien – hier entscheidet das Los.');
    }
    if (absent.size) {
      notes.push(c.mode === 'swiss'
        ? 'Ausgefallene Teams werden in noch nicht begonnenen Runden nicht mehr eingeplant. '
          + 'In bereits begonnenen Runden erhält der Gegner ein Freilos.'
        : 'Der Spielplan bleibt unverändert – die Gegner ausgefallener Teams erhalten ein Freilos.');
    }
    if (c.mode === 'swiss') {
      notes.push('Die Paarungen einer Runde stehen erst fest, wenn die vorherige Runde '
        + 'vollständig eingetragen ist. Bis dahin sind sie ein Vorschlag.');
    }

    rounds.forEach(rd => rd.matches.forEach(m => {
      m.name = rd.title + (m.bye != null ? ' – Freilos' : '');
    }));
    const matchById = {};
    rounds.forEach(rd => rd.matches.forEach(m => matchById[m.id] = m));

    return {
      config: c, mode: c.mode, rounds, slots, startMin, endMin,
      table, tableUpto, rankUpto, placements, pairs: pairsOut,
      warnings, notes, absent: Array.from(absent), activeTeams: active,
      matchById, resultOf, modeOfRound,
      matchLabel: id => (matchById[id] && matchById[id].name) ? matchById[id].name : id,
      resolve: ref => (typeof ref === 'number' ? ref : TC.resolveRef(ref, {}))
    };
  }

  return { build, buildRounds, autoGroupCount, defaultSwissRounds, maxSwissRounds,
           FINAL_MODES, ROUND_MODES, GROUP_NAMES, blocksToRounds };
});
