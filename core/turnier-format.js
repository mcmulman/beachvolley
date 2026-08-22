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

  /* Gruppengrößen für Modified Pool Play (AGENTS.md §1/§5): MPP ist nur für
     3er- und 4er-Gruppen definiert (siehe docs/format-modified-pool-play.html)
     - das ist auch die reale Wettkampfpraxis, größere Gruppen bräuchten einen
     eigenen (nicht standardisierten) Bracket. Gesucht wird deshalb die
     Gruppenanzahl, die N Teams OHNE Rest in reine 3er-/4er-Gruppen zerlegt,
     mit MÖGLICHST WENIGEN 3er-Gruppen (4er-Gruppen sind der Normalfall, 3er
     nur die Ausnahme für den Rest) - klassische "Briefmarken"-Aufteilung:
       3x + 4y = n,  x minimal,  x,y ≥ 0
     x ergibt sich direkt aus n mod 4 (0→0, 1→3, 2→2, 3→1); y muss dann ≥0
     sein, sonst ist die Teamzahl für MPP nicht sauber aufteilbar (z.B. 5).
     Die tatsächliche Aufteilung überlässt build() weiterhin genGroups()
     (distribution:'sequential') - deren Blockaufteilung (base/base+1 Teams je
     Gruppe) erzeugt bei DIESER Gruppenanzahl immer exakt dieselbe Multimenge
     an 3er-/4er-Größen (geprüft für n=3…60 in test/core/modified-pool-play).*/
  function mppGroupCount(n) {
    n = n | 0;
    if (n < 3) return null;
    const r = n % 4;
    const x = r === 0 ? 0 : (r === 1 ? 3 : (r === 2 ? 2 : 1));
    const y = (n - 3 * x) / 4;
    if (y < 0 || (x + y) < 1) return null;
    return x + y;
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
             poolMode:'rr'|'mpp', startTime, absent:[], results:{matchId:[[a,b],…]} }

     groups: 0 → KEINE Gruppenphase. Alle Teams starten direkt im KO-Baum
     (Setzliste = Teamnummer), fehlende Plätze zur Zweierpotenz werden als
     Freilos an die bestgesetzten Teams vergeben.

     poolMode: 'mpp' (Modified Pool Play, AGENTS.md §1) ersetzt in der
     Gruppenphase das volle Round-Robin (genGroupPhase) durch den 4er-Bracket
     (genModifiedPoolPlay) - 4 statt 6 Spiele je 4er-Gruppe, 3er-Gruppen
     bleiben (mit Freilos für Setzplatz 1) beim normalen Round-Robin.
     Ab hier läuft ALLES Weitere (Finalrunde, Referenz-Auflösung, Tie-Breaker
     ohne Gleichstand nötig, weil Bracket-Position den Platz direkt festlegt)
     identisch zu 'rr' - siehe docs/format-modified-pool-play.html.          */
  function build(cfg) {
    const c = Object.assign({
      teams: 8, groups: 'auto', fields: 2, setMode: '21',
      finalSetMode: null, finalMode: 'placement', thirdPlace: true,
      bracketMode: 'single', poolMode: 'rr', startTime: '10:00', absent: [], results: {}
    }, cfg || {});

    const warnings = [];
    const absent = new Set((c.absent || []).map(Number));
    const all = TC.normalizeTeamList(c.teams);
    const koOnly = (c.groups === 0);
    const doubleElim = koOnly && c.bracketMode === 'double';
    if (koOnly) c.finalMode = doubleElim ? 'doubleko' : 'ko';
    if (koOnly && all.length < 4) {
      warnings.push('Ein reines KO-Turnier braucht mindestens 4 Teams – '
        + 'sonst stünde schon im Halbfinale ein Freilos.');
    }
    const mppMode = !koOnly && c.poolMode === 'mpp';
    let gCount;
    if (koOnly) {
      gCount = 0;
    } else if (mppMode) {
      const autoMpp = mppGroupCount(all.length);
      if (!autoMpp) {
        warnings.push('Bei ' + all.length + ' Teams ist keine reine 3er-/4er-Gruppenaufteilung für '
          + 'Modified Pool Play möglich – bitte Teamzahl anpassen (z. B. auf ' + (all.length - 1)
          + ' oder ' + (all.length + 1) + ' Teams) oder die Gruppenzahl manuell wählen.');
      }
      gCount = Math.min(GROUP_NAMES.length,
        Math.max(1, c.groups === 'auto' ? (autoMpp || autoGroupCount(all.length)) : (c.groups | 0)));
    } else {
      gCount = Math.min(GROUP_NAMES.length,
        Math.max(1, c.groups === 'auto' ? autoGroupCount(all.length) : (c.groups | 0)));
    }

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
      if (mppMode && groups[n].length !== 3 && groups[n].length !== 4) {
        warnings.push('Gruppe ' + n + ' hat ' + groups[n].length + ' Teams – Modified Pool Play ist nur für '
          + '3er-/4er-Gruppen definiert. Diese Gruppe spielt stattdessen komplettes Round-Robin.');
      }
    });

    let mppMeta = null;
    let grpRounds;
    if (koOnly) {
      grpRounds = [];
    } else if (mppMode) {
      const mpp = TC.genModifiedPoolPlay(groups, { idPrefix: 'g' });
      grpRounds = mpp.rounds;
      mppMeta = mpp.meta;
    } else {
      grpRounds = TC.genGroupPhase(groups, { idPrefix: 'g' });
    }

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
    names.forEach(n => {
      /* MPP-Bracket-Gruppen (4er) werden erst NACH der Sieger/Verlierer-
         Auflösung (weiter unten) befüllt - die Platzierung hängt hier direkt
         an der Bracket-Position (winnerOf/loserOf), nicht an einer Tabelle. */
      if (mppMeta && mppMeta[n] && mppMeta[n].mode === 'bracket') return;
      groupTables[n] = tableFor(groups[n], groupMatches[n], c.setMode);
    });

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
    let deResetNeeded = false;   // Doppel-K.-o.: Reset-Spiel im Grand Final noetig?

    function rankResolver(phase, group, place) {
      if (phase === 'main') {
        const t = mainTables && mainTables[group];
        if (!t || !t.complete) return null;
        const e = t.ranked.find(x => x.place === place);
        return (e && !e.shared) ? e.team : null;
      }
      const t = groupTables[group];
      if (!t || !t.complete) return null;
      const e = t.ranked.find(x => x.place === place);
      return (e && !e.shared) ? e.team : null;
    }
    const resolvers = {
      rank: rankResolver,
      winner: id => (id in winnerOf) ? winnerOf[id] : null,
      loser: id => (id in loserOf) ? loserOf[id] : null
    };
    function resolve(ref) { return TC.resolveRef(ref, resolvers); }

    /* MPP-Verliererspiel (Platz 3/4): fällt einer der beiden Zubringer-Matches
       (Setzplatz 1v4 / 2v3) durch ein Freilos/einen Ausfall OHNE echten
       Verlierer aus, bliebe die Referenz {k:'lose',match:…} für immer
       unauflösbar (loserOf bleibt null). Das erkennt man daran, dass der
       Quellmatch bereits einen Sieger hat (winnerOf gesetzt), aber NIE einen
       Verlierer bekommen wird (loserOf===null, nicht bloß "noch nicht"). In
       diesem Fall wird die betroffene Seite des Verliererspiels selbst zum
       Freilos erklärt - der verbleibende Teilnehmer zieht kampflos auf Platz 3,
       Platz 4 bleibt frei (das ausgefallene Team wird wie überall sonst aus
       der Wertung genommen, nicht auf einen Platz „verlegt"). Betreffen beide
       Seiten das gleiche Schicksal (zwei Ausfälle in Runde 1), bleibt das
       Verliererspiel komplett ohne Teilnehmer - Platz 3 UND 4 offen.        */
    const mppFullyDead = new Set();
    function isDeadLoserRef(ref) {
      return !!(ref && ref.k === 'lose' && (ref.match in winnerOf) && loserOf[ref.match] === null);
    }

    /* Löst die Seiten eines Spiels auf und trägt Sieger/Verlierer nach, damit
       Folgespiele (KO-Baum, Über-Kreuz) direkt weiterverdrahtet werden. */
    function resolveMatch(m, modeId) {
      if (m.mppLoserAware) {
        const deadA = isDeadLoserRef(m.a), deadB = isDeadLoserRef(m.b);
        if (deadA) m.a = { k: 'bye' };
        if (deadB) m.b = { k: 'bye' };
        if (deadA && deadB) mppFullyDead.add(m.id);
      }
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

    /* MPP-Bracket-Gruppen: der Platz ergibt sich direkt aus der Bracket-
       Position (Sieger/Verlierer des Gewinner-/Verliererspiels) statt aus
       einer Tabelle - deshalb erst HIER berechenbar, nachdem winnerOf/loserOf
       für die Gruppenspiele feststehen. Kein Tie-Breaker nötig: die
       Platzierung ist bereits durch den Bracket eindeutig (AGENTS.md §1).   */
    function mppBracketTable(n) {
      const ids = mppMeta[n].matchIds;
      const mwSettled = ids.mw in winnerOf;
      const mlSettled = mppFullyDead.has(ids.ml) || (ids.ml in winnerOf);
      const ranked = [];
      if (mwSettled) {
        ranked.push({ team: winnerOf[ids.mw], place: 1, shared: false });
        if (loserOf[ids.mw] != null) ranked.push({ team: loserOf[ids.mw], place: 2, shared: false });
      }
      if (mlSettled) {
        if (winnerOf[ids.ml] != null) ranked.push({ team: winnerOf[ids.ml], place: 3, shared: false });
        if (loserOf[ids.ml] != null) ranked.push({ team: loserOf[ids.ml], place: 4, shared: false });
      }
      const matches = groupMatches[n];
      const matchCount = matches.filter(m => m.ta != null && m.tb != null).length;
      const complete = mwSettled && mlSettled;
      if (complete && ranked.length < groups[n].filter(t => !absent.has(t)).length) {
        warnings.push('Gruppe ' + n + ': ein Ausfall lässt mindestens einen Platz im '
          + 'Gewinner-/Verliererspiel offen.');
      }
      return {
        teams: groups[n].filter(t => !absent.has(t)), ranked, stat: {}, criteria: [],
        perGame: false, complete, matchCount
      };
    }
    if (mppMeta) {
      names.forEach(n => {
        if (mppMeta[n] && mppMeta[n].mode === 'bracket') groupTables[n] = mppBracketTable(n);
      });
    }

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
    } else if (finalMode === 'doubleko') {
      /* Doppel-K.-o.-System (Double Elimination). Nur ohne Gruppenphase
         sinnvoll (koOnly) – siehe docs/format-double-elimination.html.
         Jedes Team scheidet erst nach der ZWEITEN Niederlage aus; die
         Setzliste (Teamnummer) speist Gewinner- UND Verlierer-Runde. */
      finalTitle = 'Doppel-K.-o.-System';
      const slots = seedSlots();
      bracket = TC.genDoubleBracket(slots, { idPrefix: 'de' });
      if (bracket.byes > 0) {
        warnings.push(bracket.byes + ' Freilos' + (bracket.byes === 1 ? '' : 'e')
          + ' in Runde 1 der Gewinner-Runde – ' + bracket.byes + ' Team'
          + (bracket.byes === 1 ? ' zieht' : 's ziehen') + ' kampflos weiter.');
      }
      finalRounds = bracket.rounds.map(r => ({
        round: r.round, title: r.label, matches: r.matches, byes: [], phase: r.phase
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
      // MPP-Bracket-Spiele tragen bereits einen sprechenden Titel (Setzplatz…/
      // Gewinnerspiel/Verliererspiel) - der wird übernommen statt "R1"/"R2".
      m.name = m.label ? ('Gruppe ' + m.group + ' – ' + m.label) : ('Gruppe ' + m.group + ' – R' + m.round);
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
    } else if (finalMode === 'doubleko' && bracket) {
      /* Grand Final/Reset tragen bereits einen sprechenden Titel (m.label).
         Gewinner-Runde nutzt dieselben Abkuerzungen wie das reine KO-System,
         die Verlierer-Runde ihre eigene, an AGENTS.md/Doku angelehnte
         Bezeichnung ("Verlierer-Runde N" / "Verlierer-Finale").             */
      bracket.rounds.forEach(r => {
        let i = 0;
        r.matches.forEach(m => {
          if (m.label) { m.name = m.label; return; }
          i++;
          if (r.phase === 'wb') {
            const lbl = r.label === 'Finale' ? 'Gewinner-Finale' : r.label;
            m.name = (r.matches.length > 1) ? lbl + ' ' + i : lbl;
          } else {
            m.name = (r.matches.length > 1) ? r.label + ' – Spiel ' + i : r.label;
          }
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
      } else if (finalMode === 'doubleko' && bracket && bracket.grandFinal) {
        /* Platz 1/2: Grand Final – ggf. erst nach dem Reset-Entscheidungsspiel
           entschieden (siehe genDoubleBracket-Kommentar/Doku). Platz 3 ist
           immer der Verlierer des Verlierer-Finales (letzte Verlierer-Runde),
           danach teilen sich alle Verlierer derselben Verlierer-Runde einen
           Platzbereich – analog zur KO-Regel, nur eine Runde "verzoegert",
           weil hier erst die ZWEITE Niederlage zaehlt. */
        const gf1 = bracket.grandFinal.m1, gf2 = bracket.grandFinal.m2;
        let resetNeeded = false;
        if (winnerOf[gf1.id] != null) {
          const bTeam = resolve(gf1.b);
          resetNeeded = (winnerOf[gf1.id] === bTeam);
          deResetNeeded = resetNeeded;
          const decisive = resetNeeded ? gf2 : gf1;
          if (winnerOf[decisive.id] != null) {
            out.push({ place: 1, team: winnerOf[decisive.id], source: decisive.label });
            out.push({ place: 2, team: loserOf[decisive.id], source: decisive.label });
          }
        }
        let nextPlace = 3;
        for (let ri = bracket.lbRounds.length - 1; ri >= 0; ri--) {
          const rd = bracket.lbRounds[ri];
          const losers = rd.matches.map(m => loserOf[m.id]).filter(t => t != null);
          if (!losers.length) continue;
          const from = nextPlace, to = nextPlace + losers.length - 1;
          const range = (from === to) ? String(from) + '.' : from + '.–' + to + '.';
          losers.forEach(t => out.push({ place: from, placeTo: to, rangeLabel: range, team: t,
            shared: from !== to, source: 'ausgeschieden im ' + rd.label }));
          nextPlace = to + 1;
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

    if (finalMode === 'doubleko' && bracket && bracket.grandFinal && deResetNeeded
        && winnerOf[bracket.grandFinal.m2.id] == null) {
      notes.push('Verlierer-Runden-Champion hat das Grand Final gewonnen – der Gewinner-Runden-Champion '
        + 'hat damit erst eine Niederlage. Das Entscheidungsspiel (Reset) ist zwingend zu spielen.');
    }

    return {
      config: c, groups, groupNames: names, groupSizes,
      groupRounds: grpRounds, groupTables, groupMatches, mppMeta, poolMode: mppMode ? 'mpp' : 'rr',
      finalMode, finalTitle, finalRounds, finalSetMode: finMode,
      placementBlocks, bracket, mainGroups, mainTables, deResetNeeded,
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

  /* ==========================================================================
     KING/QUEEN OF THE COURT (eigenständiger Einstiegspunkt, siehe
     AGENTS.md §1 „King/Queen of the Court" + core/turnier-core.js §3.7).

     Strukturell zu verschieden von build()/buildRounds() (keine feste
     Paarung, kein Satzmodus, dafür eine sich von Runde zu Runde verschiebende
     Feld-Leiter) - deshalb ein eigener Einstiegspunkt statt eines weiteren
     ROUND_MODES-Eintrags, analog zum Vorbild „Schweizer System": Runde N
     braucht die (Sieger/Verlierer-)Auflösung von Runde N-1, wird also erst
     erzeugt, wenn die vorherige Runde vorliegt, und einmal begonnene Runden
     werden per fixedCourts eingefroren (exakt dasselbe Prinzip wie
     `fixedPairs` im Schweizer System, AGENTS.md §7a).

     cfg = { teams, courts (1-5), rounds, roundMinutes, startTime, absent,
             results: { matchId:[aPts,bPts] }, fixedCourts: { round: Team[][] } }

     WICHTIGE ABWEICHUNG von der sonstigen Ergebnis-Konvention: results[id]
     ist hier NUR das Zahlenpaar [aPts,bPts] - NICHT die sonst übliche
     3-Satzpaar-Struktur (siehe AGENTS.md „Ergebnis-Speicherung"). Das ist
     bewusst so: diese Konvention gilt für SET_MODES-Bögen, King/Queen kennt
     keine Sätze, sondern genau EIN zeitlimitiertes Rundenergebnis pro Spiel.
     ========================================================================== */
  const KQ_ROUND_MIN_DEFAULT = 15; // Minuten je Runde, rein informativ (AGENTS.md §1)

  /* Empfohlene Rundenzahl: genug, damit sich die Leiter einmal quer durch
     alle Felder bewegen kann (Feldzahl Aufstiege nötig, um vom untersten aufs
     Königsfeld zu kommen), aber ein Papierbogen bleibt handhabbar (max. 8). */
  function defaultKqRounds(courtCount) {
    return Math.max(4, Math.min(8, (courtCount | 0) + 3));
  }

  function kqCourtLabel(levelIdx, courtCount) {
    if (levelIdx === 0) return 'Königs-/Königinnenfeld';
    if (levelIdx === courtCount - 1) return 'Feld ' + (levelIdx + 1) + ' (unterstes Feld)';
    return 'Feld ' + (levelIdx + 1);
  }

  function buildKingOfCourt(cfg) {
    const c = Object.assign({
      teams: 12, courts: 3, rounds: null, roundMinutes: KQ_ROUND_MIN_DEFAULT,
      startTime: '10:00', absent: [], results: {}, fixedCourts: {}
    }, cfg || {});

    const warnings = [], notes = [];
    const absent = new Set((c.absent || []).map(Number));
    const all = TC.normalizeTeamList(c.teams);
    const active = all.filter(t => !absent.has(t));
    const courtCount = Math.max(1, Math.min(5, c.courts | 0));

    if (active.length && active.length % (4 * courtCount) !== 0) {
      notes.push('Bei ' + active.length + ' Teams und ' + courtCount + ' Feld(ern) ist mind. ein '
        + 'Feld nicht mit genau 4 Teams besetzt - ein Team hat dort ein Feld-Freilos '
        + '(siehe Kurzanleitung, Feld-Freilos-Regel).');
    }
    if (active.length < 2 * courtCount) {
      warnings.push('Zu wenige Teams für ' + courtCount + ' Feld(er): mindestens '
        + (2 * courtCount) + ' Teams nötig, damit jedes Feld mit mind. 2 Teams besetzt ist.');
    }

    const want = Math.max(1, c.rounds ? (c.rounds | 0) : defaultKqRounds(courtCount));
    const cumPts = {}, roundsPlayed = {}, bestCourt = {};
    active.forEach(t => { cumPts[t] = 0; roundsPlayed[t] = 0; bestCourt[t] = courtCount; });

    const rounds = [];
    let courts = null; // Feldbesetzung zu Beginn der aktuellen Runde

    for (let r = 1; r <= want; r++) {
      let order;
      if (c.fixedCourts && c.fixedCourts[r] && c.fixedCourts[r].length) {
        order = c.fixedCourts[r].map(list => (list || []).filter(t => active.indexOf(t) >= 0));
      } else if (r === 1) {
        order = TC.kqInitialCourts(active, courtCount);
      } else {
        order = (courts || []).map(list => list.filter(t => active.indexOf(t) >= 0));
      }

      const courtsData = order.map((teamsOnCourt, idx) => {
        const idPrefix = 'koc_r' + r + '_c' + (idx + 1);
        const built = TC.kqCourtMatches(teamsOnCourt, idPrefix);
        const matches = built.matches.map(m => {
          const raw = c.results[m.id];
          const result = (raw && raw.length === 2) ? TC.kqComputeRoundResult(raw[0], raw[1]) : null;
          return Object.assign({}, m, { round: r, court: idx + 1, result });
        });
        return {
          level: idx + 1, label: kqCourtLabel(idx, order.length),
          teams: teamsOnCourt, matches, bye: built.byeTeam
        };
      });

      const hasInput = courtsData.some(cd => cd.matches.some(m => m.result));
      const complete = courtsData.every(cd => cd.matches.every(m => m.result));

      /* Punkte/Runden-Zähler nur für VOLLSTÄNDIG gewertete Felder fortschreiben,
         sonst würde ein halb eingetragenes Feld die Bewegregel der Folgerunde
         verfälschen (dieselbe „erst nach vollständigem Stand"-Regel wie beim
         Schweizer System, AGENTS.md §7a). */
      courtsData.forEach(cd => {
        cd.matches.forEach(m => {
          if (!m.result) return;
          cumPts[m.a] = (cumPts[m.a] || 0) + m.result.aPts;
          cumPts[m.b] = (cumPts[m.b] || 0) + m.result.bPts;
          roundsPlayed[m.a] = (roundsPlayed[m.a] || 0) + 1;
          roundsPlayed[m.b] = (roundsPlayed[m.b] || 0) + 1;
          if (cd.level < bestCourt[m.a]) bestCourt[m.a] = cd.level;
          if (cd.level < bestCourt[m.b]) bestCourt[m.b] = cd.level;
        });
      });

      rounds.push({
        round: r, title: 'Runde ' + r, courts: courtsData,
        frozen: hasInput, complete
      });

      /* Nächste Feldbesetzung: nur berechnen, wenn diese Runde vollständig
         gewertet ist - sonst ist Sieger/Verlierer unbekannt. Ist ein Feld
         schon (teil-)eingetragen, aber die Runde nicht komplett, bleibt die
         bisherige Besetzung als reiner Vorschlag stehen (analog Schweizer
         System: "Paarungen stehen erst fest, wenn die vorherige Runde
         vollständig eingetragen ist").                                       */
      if (complete && courtsData.length) {
        /* Feldbewegung braucht pro Spiel GENAU einen Aufsteiger und einen
           Absteiger, sonst driftet die Feldgröße über mehrere Runden
           auseinander (ein Feld bekäme mehr/weniger als 4 Teams). Ein echtes
           Unentschieden (Punktegleichstand bei Zeitablauf) lässt das offen -
           für die WERTUNG bleibt es ein Remis (beide Teams behalten ihre
           erzielten Punkte 1:1, siehe Endstand), aber für die FELDBEWEGUNG
           braucht es dennoch eine Entscheidung, wer das Feld wechselt.
           Deterministischer Tiebreak (niedrigere Setznummer = "Aufsteiger"),
           damit der Bogen ohne Los reproduzierbar bleibt.                    */
        function moveWinner(m) {
          if (m.result.winner === 'a') return m.a;
          if (m.result.winner === 'b') return m.b;
          return Math.min(m.a, m.b);
        }
        function moveLoser(m) {
          if (m.result.winner === 'a') return m.b;
          if (m.result.winner === 'b') return m.a;
          return Math.max(m.a, m.b);
        }
        courts = TC.kqNextCourts(
          k => courtsData[k].matches.map(moveWinner),
          k => courtsData[k].matches.map(moveLoser),
          k => courtsData[k].bye,
          courtCount
        );
      } else {
        courts = order;
      }
    }

    /* --- Endstand -----------------------------------------------------------
       Kumulierte Rundenpunkte sind die gebräuchlichste King-of-the-Court-
       Wertung (siehe docs/format-king-of-the-court.html) - primäres
       Kriterium. Da Feld-Freilose zu ungleicher Rundenzahl führen können
       (AGENTS.md §4.2-Prinzip "ungleiche Spielanzahl → pro Spiel werten"),
       wird bei ungleicher Rundenzahl auf Punkte PRO GESPIELTER RUNDE
       umgeschaltet - genau wie bei den satzbasierten Formaten. Zweites
       Kriterium: das höchste je erreichte Feld (kleinere Zahl = höheres
       Feld); danach Losentscheid (Teamnummer).                              */
    const unequalRounds = active.some(t => roundsPlayed[t] !== roundsPlayed[active[0]]);
    const ranked = active.slice().sort((a, b) => {
      const pa = unequalRounds ? (cumPts[a] / Math.max(1, roundsPlayed[a])) : cumPts[a];
      const pb = unequalRounds ? (cumPts[b] / Math.max(1, roundsPlayed[b])) : cumPts[b];
      if (pb !== pa) return pb - pa;
      if (bestCourt[a] !== bestCourt[b]) return bestCourt[a] - bestCourt[b];
      return a - b;
    });
    let place = 1;
    const placements = ranked.map((t, i) => {
      const shared = i > 0 && (unequalRounds
        ? (cumPts[t] / Math.max(1, roundsPlayed[t])) === (cumPts[ranked[i - 1]] / Math.max(1, roundsPlayed[ranked[i - 1]]))
        : cumPts[t] === cumPts[ranked[i - 1]]) && bestCourt[t] === bestCourt[ranked[i - 1]];
      if (!shared) place = i + 1;
      return {
        place, team: t, shared,
        points: cumPts[t], roundsPlayed: roundsPlayed[t], bestCourt: bestCourt[t],
        pointsPerRound: cumPts[t] / Math.max(1, roundsPlayed[t])
      };
    });

    if (unequalRounds) {
      notes.push('Nicht alle Teams haben gleich viele Runden gespielt (Feld-Freilos) - '
        + 'die Endwertung nutzt deshalb Punkte PRO gespielter Runde.');
    }
    if (absent.size) {
      notes.push('Ausgefallene Teams werden aus allen Feldern entfernt; die verbleibenden Teams '
        + 'auf einem Feld rücken nach der üblichen Feld-Freilos-Regel zusammen.');
    }

    /* --- Zeitplan (rein informativ, siehe AGENTS.md §1: "Rundensystem mit
       Zeitlimit, meist 15 Min/Runde" - keine Feld-/Slot-Zerlegung nötig, da
       ALLE Felder EINER Runde gleichzeitig laufen, unabhängig von einer
       Feldanzahl-Konfiguration wie bei den anderen Formaten).               */
    const startMin = TC.toMin(c.startTime) != null ? TC.toMin(c.startTime) : TC.toMin('10:00');
    const perRound = Math.max(5, c.roundMinutes | 0 || KQ_ROUND_MIN_DEFAULT);
    const slots = rounds.map((rd, i) => ({
      slot: i + 1, round: rd.round, title: rd.title,
      startMin: startMin + i * perRound, endMin: startMin + (i + 1) * perRound, minutes: perRound
    }));
    const endMin = startMin + rounds.length * perRound;

    return {
      config: c, courtCount, rounds, slots, startMin, endMin, perRound,
      placements, warnings, notes, absent: Array.from(absent), activeTeams: active
    };
  }

  /* Niveaustufen N2-N5 (AGENTS.md-Konvention analog zu Team-Art-Badges):
     rein als Ausgangs-/Tiebreak-Kriterium fuer die Ausgleichs-Team-Bildung
     gedacht, KEIN Einfluss auf die Wertung selbst. N3 ist der neutrale
     Default, falls fuer eine Person kein Niveau hinterlegt ist.            */
  const KQ_LEVELS = [2, 3, 4, 5];
  const KQ_LEVEL_DEFAULT = 3;

  function buildKingQueen(cfg) {
    const c = Object.assign({
      players: 12, men: null, women: null, fields: 2, rounds: 4,
      startTime: '10:00', setMode: '21',
      results: {}, genders: {}, levels: {}, absent: []
    }, cfg || {});

    const warnings = [], notes = [];

    /* "men"/"women" sind die primaeren Eingaben (unabhaengig waehlbar, MUSS
       NICHT gleich sein) - "players" (Gesamtzahl) wird daraus abgeleitet.
       c.players dient nur noch als Fallback, falls weder men noch women
       uebergeben wurden.                                                  */
    let menCount = c.men != null ? Math.max(0, c.men | 0) : null;
    let womenCount = c.women != null ? Math.max(0, c.women | 0) : null;
    let total;
    if (menCount == null && womenCount == null) {
      total = Math.max(4, c.players | 0 || 4);
      const half = Math.floor(total / 2);
      menCount = (total % 2 === 0) ? half : Math.ceil(total / 2);
      womenCount = total - menCount;
    } else {
      if (menCount == null) menCount = 0;
      if (womenCount == null) womenCount = 0;
      total = Math.max(4, menCount + womenCount);
      if (menCount + womenCount < total) {
        // Auffuellen auf die Mindestteilnehmerzahl (4), falls zu wenige Personen gemeldet sind.
        womenCount += total - (menCount + womenCount);
      }
    }

    const genders = {};
    for (let i = 1; i <= total; i++) {
      if (c.genders && Object.prototype.hasOwnProperty.call(c.genders, i)) {
        genders[i] = c.genders[i] === 'f' ? 'f' : 'm';
      }
    }

    const all = [];
    for (let i = 1; i <= total; i++) {
      if (Object.prototype.hasOwnProperty.call(genders, i)) {
        all.push(i);
      } else {
        genders[i] = i <= menCount ? 'm' : 'f';
        all.push(i);
      }
    }

    const men = all.filter(t => genders[t] === 'm');
    const women = all.filter(t => genders[t] === 'f');

    /* Niveaustufen (N2-N5): fehlende/ungueltige Werte fallen auf den
       neutralen Default N3 zurueck, damit die Paarung immer eine Reihenfolge
       hat, auch wenn (noch) nicht fuer alle Personen ein Niveau erfasst ist. */
    const levels = {};
    all.forEach(p => {
      const raw = c.levels && Object.prototype.hasOwnProperty.call(c.levels, p) ? Number(c.levels[p]) : null;
      levels[p] = KQ_LEVELS.includes(raw) ? raw : KQ_LEVEL_DEFAULT;
    });
    function levelOf(p) { return levels[p] || KQ_LEVEL_DEFAULT; }

    /* Ausgefallene Personen bleiben in Namenslisten/Ranglisten sichtbar,
       nehmen aber an keiner Team-/Match-Bildung mehr teil (analog zu
       buildKingOfCourt() - "absent" entfernt Teilnehmer:innen aus der
       Paarungslogik, nicht aus der Verwaltung).                          */
    const absentSet = new Set((c.absent || []).map(Number));
    const active = all.filter(t => !absentSet.has(t));
    if (active.length < 4) {
      warnings.push('Zu wenige aktive Teilnehmer:innen (mind. 4 nötig, damit ein 2-gegen-2-Match möglich ist).');
    }

    /* Ergebnis-Eingabe wie in den uebrigen Boegen: c.results[matchId] ist ein
       Array von Saetzen [[aBalls,bBalls], ...] gemaess c.setMode (TC.SET_MODES),
       nicht mehr ein simples [aPts,bPts]-Paar. TC.computeResult validiert und
       liefert die VOLLE Struktur {aBalls,bBalls,aSets,bSets,winner,draw} -
       unveraendert weitergereicht, damit TUI.paintMatch()/markScoreInputs()
       (die dieselbe Form erwarten wie bei allen anderen Boegen) direkt
       wiederverwendet werden koennen. Tabellenpunkte (Sieg=2/Remis=1/
       Niederlage=0) und Ball-Differenz folgen derselben Logik wie beim
       Universalbogen (AGENTS.md §4).                                      */
    function computeRoundResult(raw) {
      return TC.computeResult(raw, c.setMode);
    }

    const scores = {};
    const played = {};
    const rounds = [];
    const want = Math.max(1, Math.min(10, c.rounds ? (c.rounds | 0) : 4));

    /* Pro Person dieselben Kennzahlen wie beim Universalbogen (AGENTS.md §4):
       Tabellenpunkte (Sieg=2/Remis=1/Niederlage=0) + Ball-Differenz, damit
       TUI.standingsTableHtml (inkl. manueller Δ-Korrektur) unveraendert
       wiederverwendet werden kann - "team" ist hier die Spieler-Nummer.    */
    function ensureStat(p) {
      return scores[p] || (scores[p] = {
        games: 0, won: 0, drawn: 0, lost: 0, pts: 0, ptsPer: 0,
        ballsFor: 0, ballsAgainst: 0, bd: 0, bdPer: 0
      });
    }
    function tablePtsOf(p) { return ensureStat(p).pts; }
    function bdOf(p) { return ensureStat(p).bd; }

    /* Sortierkriterium fuer die Ausgleichs-Team-Bildung (staerkste+schwaechste
       Person je Team): Tabellenpunkte, dann Ball-Differenz, dann Niveau
       (hoeher = staerker), zuletzt die Spieler-Nummer als Losentscheid. Vor
       der ersten Runde sind Punkte/Differenz fuer alle 0 - dann entscheidet
       direkt das Niveau, wodurch Runde 1 bereits niveau-ausgeglichene Teams
       bekommt (z.B. bei je 2x N2/N3/N4/N5: N5+N2 und N4+N3, beide Ø3,5).   */
    function sortKey(a, b) {
      const pa = tablePtsOf(a), pb = tablePtsOf(b);
      if (pb !== pa) return pb - pa;
      const ba = bdOf(a), bb = bdOf(b);
      if (bb !== ba) return bb - ba;
      const la = levelOf(a), lb = levelOf(b);
      if (lb !== la) return lb - la;
      return a - b;
    }

    /* Ranking-basierte Sitzordnung. Geschlecht spielt bei der TEAM-Bildung
       keine Rolle - "King & Queen" ist als Mixed-Event gedacht: Teams duerfen
       aus Herren, Damen oder gemischt bestehen, nur die END-Rangliste wird
       getrennt nach Geschlecht gefuehrt (kein gemeinsames Mixed-Ranking). */
    let order = active.slice().sort(sortKey);

    /* Wiederholungsvermeidung (analog TC.genSwissRound()'s "played"-Set):
       partnerHistory merkt sich jedes 2er-Team, das schon einmal GEMEINSAM
       gespielt hat; opponentHistory merkt sich jede 4er-Personengruppe
       (2 Teams = 4 Spieler:innen), die schon einmal GEGENEINANDER angetreten
       ist - unabhaengig davon, wie die beiden Teams dabei zusammengesetzt
       waren. Beides wird nach jeder Runde aus den TATSAECHLICH gespielten
       Matches aktualisiert und bleibt fuer den gesamten Turnierverlauf
       bestehen, damit sich weder Partnerschaften noch Begegnungen unnoetig
       wiederholen, waehrend die Ausgleichs-Fairness (staerkste+schwaechste
       Person/Team) erhalten bleibt.                                        */
    const partnerHistory = new Set();
    const opponentHistory = new Set();
    function partnerKey(a, b) { return a < b ? a + '-' + b : b + '-' + a; }
    function opponentKey(teamA, teamB) {
      return teamA.concat(teamB).slice().sort((x, y) => x - y).join('-');
    }

    /* Team-Bildung: wie zuvor wird - beginnend bei der staerksten Person -
       eine Partnerschaft mit dem schwaechsten noch verfuegbaren Gegenstueck
       gesucht ("Ausgleichs-Prinzip"). NEU: dabei wird von der schwaechsten
       Person aus rueckwaerts nach der ERSTEN noch nicht gemeinsam gespielten
       Person gesucht, nicht mehr stur nach der allerschwaechsten. Nur wenn
       WIRKLICH alle verbleibenden Personen schon einmal Partner waren (sehr
       kleines Feld ueber viele Runden), wird eine Wiederholung akzeptiert -
       dann zaehlt wieder die reine Ausgleichs-Reihenfolge.                  */
    function formTeams(pool) {
      const remaining = pool.slice();
      const teams = [];
      let hadRepeat = false;
      while (remaining.length >= 2) {
        const a = remaining.shift();
        let idx = -1;
        for (let i = remaining.length - 1; i >= 0; i--) {
          if (!partnerHistory.has(partnerKey(a, remaining[i]))) { idx = i; break; }
        }
        if (idx === -1) { idx = remaining.length - 1; hadRepeat = true; }
        const b = remaining.splice(idx, 1)[0];
        teams.push([a, b]);
      }
      return { teams, hadRepeat };
    }

    /* Gegner-Zuordnung nach demselben Prinzip: Teams treten in der
       Reihenfolge ihrer Gesamtstaerke gegeneinander an (staerkstes Team
       gegen das naechstbeste usw.), aber ein 4er-Spieler-Set, das schon
       einmal gegeneinander gespielt hat, wird nach Moeglichkeit
       uebersprungen - gesucht wird dabei vom naechstbesten Team aus
       aufwaerts, damit die Staerke-Naehe moeglichst erhalten bleibt.        */
    function formMatches(teams) {
      const remaining = teams.slice();
      const pairs = [];
      let hadRepeat = false;
      while (remaining.length >= 2) {
        const a = remaining.shift();
        let idx = -1;
        for (let i = 0; i < remaining.length; i++) {
          if (!opponentHistory.has(opponentKey(a, remaining[i]))) { idx = i; break; }
        }
        if (idx === -1) { idx = 0; hadRepeat = true; }
        const b = remaining.splice(idx, 1)[0];
        pairs.push([a, b]);
      }
      return { pairs, hadRepeat };
    }

    for (let r = 1; r <= want; r++) {
      const pool = order.slice();
      let byePlayer = null;
      if (pool.length % 2 === 1) byePlayer = pool.pop();

      const { teams: rawTeams, hadRepeat: teamRepeat } = formTeams(pool);
      const teams = rawTeams;
      if (teamRepeat) {
        notes.push('Runde ' + r + ': Bei mindestens einem Team war keine komplett neue '
          + 'Partnerschaft mehr möglich – eine Partnerschaft wiederholt sich.');
      }

      let byeTeam = null;
      if (teams.length % 2 === 1) byeTeam = teams.pop();

      const { pairs: matchedTeamPairs, hadRepeat: oppRepeat } = formMatches(teams);
      if (oppRepeat) {
        notes.push('Runde ' + r + ': Bei mindestens einem Spiel war keine komplett neue '
          + 'Gegnerpaarung mehr möglich – eine Begegnung wiederholt sich.');
      }

      const matches = matchedTeamPairs.map((p, i) => ({
        id: 'kq_r' + r + '_m' + (i + 1),
        round: r, teamA: p[0], teamB: p[1], result: null
      }));

      matches.forEach(m => {
        partnerHistory.add(partnerKey(m.teamA[0], m.teamA[1]));
        partnerHistory.add(partnerKey(m.teamB[0], m.teamB[1]));
        opponentHistory.add(opponentKey(m.teamA, m.teamB));
      });

      matches.forEach(m => {
        const raw = c.results[m.id];
        m.result = computeRoundResult(raw);
        if (m.result) {
          const aTablePts = m.result.winner === 'a' ? 2 : (m.result.draw ? 1 : 0);
          const bTablePts = m.result.winner === 'b' ? 2 : (m.result.draw ? 1 : 0);
          const apply = (p, own, opp, wonSide) => {
            const s = ensureStat(p);
            s.games += 1;
            if (m.result.winner === wonSide) s.won += 1;
            else if (m.result.draw) s.drawn += 1;
            else s.lost += 1;
            s.pts += wonSide === 'a' ? aTablePts : bTablePts;
            s.ballsFor += own;
            s.ballsAgainst += opp;
            s.bd = s.ballsFor - s.ballsAgainst;
            s.ptsPer = s.pts / Math.max(1, s.games);
            s.bdPer = s.bd / Math.max(1, s.games);
            played[p] = (played[p] || 0) + 1;
          };
          m.teamA.forEach(p => apply(p, m.result.aBalls, m.result.bBalls, 'a'));
          m.teamB.forEach(p => apply(p, m.result.bBalls, m.result.aBalls, 'b'));
        }
      });

      const roundComplete = matches.every(m => !!m.result);
      const byeList = [];
      if (byePlayer != null) byeList.push(byePlayer);
      if (byeTeam) byeList.push(byeTeam[0], byeTeam[1]);
      if (byeList.length) notes.push('Runde ' + r + ': ' + byeList.map(p => 'Spieler ' + p).join(', ') + ' pausiert(en) (ungerade Teilnehmerzahl).');

      rounds.push({ round: r, title: 'Runde ' + r, matches, bye: byeList, complete: roundComplete });

      if (roundComplete) {
        order = active.slice().sort(sortKey);
      }
    }

    /* Getrennte Einzelwertung King (Herren) / Queen (Damen) - es gibt
       bewusst KEINE gemeinsame Mixed-Rangliste, da King & Queen zwei
       eigenstaendige Titel je Geschlecht vergibt. "stat" entspricht dem
       Format, das TUI.standingsTableHtml erwartet (siehe ensureStat oben). */
    function buildRanking(genderList) {
      const ranked = genderList.filter(p => !absentSet.has(p)).sort(sortKey);
      return ranked.map((player, index) => {
        const s = ensureStat(player);
        return {
          place: index + 1,
          player, team: player,
          gender: genders[player],
          level: levelOf(player),
          stat: s,
          points: s.pts,
          roundsPlayed: played[player] || 0,
          pointsPerRound: s.ptsPer
        };
      });
    }

    const menRanked = buildRanking(men);
    const womenRanked = buildRanking(women);

    /* --- Zeitplan -----------------------------------------------------------
       Wie bei buildRounds(): Min./Spiel ergibt sich aus dem Satzmodus
       (TC.MODE_MIN), nicht mehr aus einer frei waehlbaren "Min./Runde"-Angabe.
       Die Feldanzahl (c.fields) bestimmt, wie viele Spiele einer Runde
       gleichzeitig laufen - reicht ein Feld nicht fuer alle Spiele einer
       Runde, braucht die Runde entsprechend mehr Zeit-"Wellen"
       (TC.assignSlots uebernimmt exakt dieselbe Aufteilung wie bei den
       anderen Boegen; Konflikt-Erkennung greift hier nicht, da jede Person
       je Runde ohnehin nur in genau einem Match steckt).                    */
    const startMin = TC.toMin(c.startTime) != null ? TC.toMin(c.startTime) : TC.toMin('10:00');
    const fields = Math.max(1, c.fields | 0 || 2);
    const perGame = TC.MODE_MIN[String(c.setMode)] || 25;
    const slots = [];
    let cursor = startMin;
    rounds.forEach(rd => {
      TC.assignSlots([rd], fields).forEach(s => {
        slots.push(Object.assign({}, s, {
          slot: slots.length + 1, title: rd.title,
          startMin: cursor, endMin: cursor + perGame, minutes: perGame
        }));
        cursor += perGame;
      });
    });
    const endMin = cursor;

    return {
      config: c, rounds, slots, startMin, endMin, perGame, fields,
      men: menRanked, women: womenRanked,
      warnings, notes, playerCount: total, menCount, womenCount,
      genders, levels, allPlayers: all, activePlayers: active,
      matchesPerRound: rounds.length ? Math.max.apply(null, rounds.map(rd => rd.matches.length)) : 0,
      matchById: rounds.flatMap(r => r.matches).reduce((acc, m) => (acc[m.id] = m, acc), {}),
      resolve: id => id
    };
  }

  return { build, buildRounds, buildKingOfCourt, buildKingQueen, autoGroupCount, mppGroupCount,
           defaultSwissRounds, maxSwissRounds, defaultKqRounds, kqCourtLabel,
           FINAL_MODES, ROUND_MODES, GROUP_NAMES, blocksToRounds, KQ_LEVELS, KQ_LEVEL_DEFAULT };
});
