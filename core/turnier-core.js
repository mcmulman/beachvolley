/* ============================================================================
   turnier-core.js – Turnier-Engine (DOM-frei, in Node und im Browser nutzbar)

   Enthält die gesamte Fachlogik, die bisher in jedem Turnierbogen dupliziert
   war: Satzmodi, Ergebnis-Validierung, Spielplan-Generatoren, Slot-/Zeitplanung
   sowie Tabellenberechnung und Tie-Breaker.

   Bewusst KEINE DOM-Zugriffe, KEIN localStorage – damit die Logik in Node
   getestet werden kann (test/core/*.mjs).

   Einbindung im Browser:  <script src="core/turnier-core.js"></script>  → window.TC
   Einbindung in Node:     import TC from '../turniere/turniere/core/turnier-core.js'
   ========================================================================== */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TC = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* ==========================================================================
     1. SATZMODI
     Referenz: AGENTS.md §8.1. Einzige Definition im Projekt – die Bögen
     importieren sie von hier statt sie zu kopieren.
     ======================================================================== */
  const SET_MODES = [
    { id: '15',     target: 15, sets: 1, label: '1 Satz bis 15' },
    { id: '21',     target: 21, sets: 1, label: '1 Satz bis 21' },
    { id: '2x15',   target: 15, sets: 2, label: '2 Sätze bis 15' },
    { id: '2x21',   target: 21, sets: 2, label: '2 Sätze bis 21' },
    { id: '2x15tb', target: 15, sets: 3, decidingSet: true, decidingTarget: 15, label: '2 Sätze bis 15 + Entscheidungssatz' },
    { id: '2x21tb', target: 21, sets: 3, decidingSet: true, decidingTarget: 15, label: '2 Sätze bis 21 + Entscheidungssatz' }
  ];

  /* Empfohlene Mindestdauer je Spiel in Minuten (inkl. Wechselzeit). */
  const MODE_MIN = { '15': 17, '21': 25, '2x15': 30, '2x21': 36, '2x15tb': 40, '2x21tb': 45 };

  function modeDef(modeId) {
    return SET_MODES.find(m => m.id === String(modeId)) || SET_MODES[1];
  }
  function isMulti(modeId) { return modeDef(modeId).sets > 1; }
  function hasDecidingSet(modeId) { return !!modeDef(modeId).decidingSet; }
  function targetForSet(modeId, setNo) {
    const def = modeDef(modeId);
    if (setNo === 3 && def.decidingSet) return def.decidingTarget || def.target;
    return def.target;
  }

  /* ==========================================================================
     2. SATZ-VALIDIERUNG
     Beach-Regel: Satz geht bis "target", immer mit mindestens 2 Punkten
     Vorsprung, kein Hard Cap (AGENTS.md §3).
     Gültig sind also z.B. bei target 21:  21:0 … 21:19, 23:21, 24:22, …
     Ungültig: 21:20 (nur 1 Punkt Vorsprung), 20:18 (Ziel nicht erreicht).
     ======================================================================== */
  function setValid(a, b, target) {
    if (a == null || b == null) return false;
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0) return false;
    const hi = Math.max(a, b), lo = Math.min(a, b);
    if (hi < target || hi === lo) return false;
    if (hi === target) return lo <= target - 2;
    return (hi - lo) === 2 && lo >= target - 1;
  }

  /* ==========================================================================
     3. SPIELPLAN-GENERATOREN
     Alle Generatoren sind rein funktional und liefern dieselbe Struktur:
       Round  = { round, matches: Match[], bye: teamNo|null }
       Match  = { id, round, a, b, ... }
     "a"/"b" sind entweder Teamnummern (>=1) oder TeamRef-Objekte (siehe §4).
     ======================================================================== */

  /* --- 3.1 Round-Robin (Circle-Methode) -----------------------------------
     Portiert aus Turnierbogen_Flexibel_Alle_gegen_Alle.html (genSchedule).
     Verhalten bewusst identisch, damit bestehende Pläne unverändert bleiben.
     Bei ungerader Teamzahl rotiert genau ein Freilos durch alle Teams.        */
  function genRoundRobin(teams, opts) {
    const o = opts || {};
    const list = normalizeTeamList(teams);
    const arr = list.slice();
    if (arr.length % 2 === 1) arr.push(0);           // 0 = Freilos-Platzhalter
    const m = arr.length;
    const a = arr.slice();
    const rounds = [];
    const prefix = o.idPrefix || 'rr';
    for (let r = 0; r < m - 1; r++) {
      const matches = [];
      let bye = null;
      for (let i = 0; i < m / 2; i++) {
        const x = a[i], y = a[m - 1 - i];
        if (x === 0) { bye = y; continue; }
        if (y === 0) { bye = x; continue; }
        matches.push({ id: prefix + '_' + (r + 1) + '_' + matches.length, round: r + 1, a: x, b: y });
      }
      rounds.push({ round: r + 1, matches, bye });
      a.splice(1, 0, a.pop());                       // erstes Team fix, Rest rotiert
    }
    return rounds;
  }

  /* --- 3.2 Gruppeneinteilung ----------------------------------------------
     Verteilt Teams möglichst gleichmäßig auf g Gruppen. Standard ist
     "Schlangensetzung" (Snake): 1→A, 2→B, 3→B, 4→A … damit gesetzte Teams
     gleichmäßig verteilt sind. Bei 'sequential' werden Blöcke gebildet
     (1-4 = A, 5-8 = B) – das entspricht den bisherigen hardcodierten Bögen.   */
  function genGroups(teams, groupCount, opts) {
    const o = opts || {};
    const list = normalizeTeamList(teams);
    const g = Math.max(1, groupCount | 0);
    const names = o.names || 'ABCDEFGH'.slice(0, g).split('');
    const groups = {};
    names.forEach(n => groups[n] = []);
    if (o.distribution === 'sequential') {
      // Blockweise: Gruppengrößen möglichst gleich, Rest auf die vorderen Gruppen
      const base = Math.floor(list.length / g), rest = list.length % g;
      let idx = 0;
      names.forEach((n, i) => {
        const size = base + (i < rest ? 1 : 0);
        groups[n] = list.slice(idx, idx + size);
        idx += size;
      });
    } else {
      // Snake: gleichmäßige Stärkeverteilung bei gesetzter Startreihenfolge
      let dir = 1, col = 0;
      list.forEach(t => {
        groups[names[col]].push(t);
        col += dir;
        if (col === g) { col = g - 1; dir = -1; }
        else if (col < 0) { col = 0; dir = 1; }
      });
    }
    return groups;
  }

  /* Erzeugt die Round-Robin-Spiele innerhalb aller Gruppen und legt sie so
     zusammen, dass in jeder Runde möglichst viele Gruppen parallel spielen. */
  function genGroupPhase(groups, opts) {
    const o = opts || {};
    const names = Object.keys(groups);
    const perGroup = {};
    let maxRounds = 0;
    names.forEach(n => {
      const rr = genRoundRobin(groups[n], { idPrefix: (o.idPrefix || 'g') + n });
      perGroup[n] = rr;
      if (rr.length > maxRounds) maxRounds = rr.length;
    });
    const rounds = [];
    for (let r = 0; r < maxRounds; r++) {
      const matches = [];
      const byes = [];
      names.forEach(n => {
        const rd = perGroup[n][r];
        if (!rd) return;
        rd.matches.forEach(m => matches.push(Object.assign({}, m, { round: r + 1, group: n })));
        if (rd.bye != null) byes.push(rd.bye);
      });
      rounds.push({ round: r + 1, matches, byes, bye: byes.length === 1 ? byes[0] : null });
    }
    return rounds;
  }

  /* --- 3.3 Schweizer System ------------------------------------------------
     Portiert aus Turnierbogen_Schweizer_System.html (buildMatches).
     Paart rangnah, vermeidet Wiederholungen und stellt per Lookahead sicher,
     dass auch alle FOLGENDEN Runden noch wiederholungsfrei planbar bleiben.

     order        – Teams sortiert nach aktuellem Tabellenstand (bester zuerst)
     playedPairs  – Set mit Schlüsseln "min-max" bereits gespielter Paarungen
     byeHistory   – { counts:{team:n}, lastRound:{team:r} }
     roundsAfter  – Anzahl der Runden, die NACH dieser noch geplant werden
     Rückgabe: { pairs: [[a,b],…], bye: teamNo|null, exhaustive: bool }        */
  function pairKey(a, b) { return Math.min(a, b) + '-' + Math.max(a, b); }

  function genSwissRound(order, playedPairs, byeHistory, roundsAfter, opts) {
    const o = opts || {};
    const played = playedPairs instanceof Set ? playedPairs : new Set(playedPairs || []);
    const hist = byeHistory || { counts: {}, lastRound: {} };
    const active = order.slice();
    const rank = {};
    active.forEach((t, i) => rank[t] = i);

    const pairingList = active.slice();
    if (pairingList.length % 2 === 1) pairingList.push(0);

    /* Freilos-Fairness: 1) wer hatte am seltensten frei, 2) wessen Freilos ist
       am längsten her, 3) bei Gleichstand das schwächere Team. */
    function byeCompare(a, b) {
      const ca = hist.counts[a] || 0, cb = hist.counts[b] || 0;
      if (ca !== cb) return ca - cb;
      const la = hist.lastRound[a] || 0, lb = hist.lastRound[b] || 0;
      if (la !== lb) return la - lb;
      const ra = rank[a] === undefined ? 99 : rank[a];
      const rb = rank[b] === undefined ? 99 : rank[b];
      return rb - ra;
    }

    const feasCache = new Map();
    let budget = o.budget || 150000;

    function feasible(extraPlayed, roundsNeeded) {
      if (roundsNeeded === 0) return true;
      if (budget <= 0) return true;                 // Budget erschöpft → optimistisch
      const ck = roundsNeeded + '|' + Array.from(extraPlayed).sort().join(',');
      if (feasCache.has(ck)) return feasCache.get(ck);
      function tryOneRound(list, built) {
        if (budget-- <= 0) return true;
        if (list.length === 0) {
          const merged = new Set(extraPlayed);
          built.forEach(k => merged.add(k));
          return feasible(merged, roundsNeeded - 1);
        }
        const a = list[0];
        for (let j = 1; j < list.length; j++) {
          const b = list[j];
          const k = (a > 0 && b > 0) ? pairKey(a, b) : null;
          if (k && (played.has(k) || extraPlayed.has(k) || built.indexOf(k) >= 0)) continue;
          const rest = list.slice(1); rest.splice(j - 1, 1);
          if (tryOneRound(rest, k ? built.concat(k) : built)) return true;
        }
        return false;
      }
      const res = tryOneRound(pairingList.slice(), []);
      feasCache.set(ck, res);
      return res;
    }

    function pairBT(list, built) {
      if (list.length === 0) {
        if (roundsAfter === 0) return [];
        const merged = new Set(played);
        built.forEach(k => merged.add(k));
        return feasible(merged, roundsAfter) ? [] : null;
      }
      const a = list[0];
      for (let j = 1; j < list.length; j++) {
        const b = list[j];
        const k = (a > 0 && b > 0) ? pairKey(a, b) : null;
        if (k && (played.has(k) || built.indexOf(k) >= 0)) continue;
        const rest = list.slice(1); rest.splice(j - 1, 1);
        const sub = pairBT(rest, k ? built.concat(k) : built);
        if (sub) return [[a, b]].concat(sub);
      }
      return null;
    }

    function greedyPair(list) {
      const out = [], g = list.slice();
      while (g.length) {
        const a = g.shift();
        let j = 0;
        while (j < g.length && played.has(pairKey(a, g[j]))) j++;
        if (j >= g.length) j = 0;
        out.push([a, g.splice(j, 1)[0]]);
      }
      return out;
    }

    let bye = null, pairs = null, exhaustive = true;
    if (active.length % 2 === 1) {
      const candidates = active.slice().sort(byeCompare);
      const tryList = candidates.slice(0, Math.min(candidates.length, 6));
      for (const cand of tryList) {
        const attempt = pairBT(active.filter(t => t !== cand), []);
        if (attempt) { bye = cand; pairs = attempt; break; }
      }
      if (pairs == null) {
        bye = candidates[0];
        pairs = greedyPair(active.filter(t => t !== bye));
        exhaustive = false;
      }
    } else {
      pairs = pairBT(active, []);
      if (!pairs) { pairs = greedyPair(active); exhaustive = false; }
    }
    return { pairs, bye, exhaustive };
  }

  /* --- 3.4 KO-Baum ---------------------------------------------------------
     Erzeugt einen Single-Elimination-Baum für beliebige Teilnehmerzahl.
     Die Setzliste wird auf die nächste Zweierpotenz mit Freilosen aufgefüllt,
     Freilose gehen an die bestgesetzten Teams (Standard-Bracket-Seeding).
     Rückgabe: { rounds: [{round,label,matches:[{id,a,b}]}], size }
     a/b sind TeamRef-Objekte (§4).                                            */
  function bracketSeedOrder(size) {
    /* Liefert die Startreihenfolge der Setzplätze, so dass 1 und 2 erst im
       Finale aufeinandertreffen können: [1,16,8,9,4,13,5,12,2,15,7,10,3,14,6,11] */
    let order = [1, 2];
    while (order.length < size) {
      const n = order.length * 2;
      const next = [];
      order.forEach(s => { next.push(s); next.push(n + 1 - s); });
      order = next;
    }
    return order;
  }

  function genBracket(seeds, opts) {
    const o = opts || {};
    const n = seeds.length;
    let size = 1;
    while (size < n) size *= 2;
    const order = bracketSeedOrder(size);
    const prefix = o.idPrefix || 'ko';
    const roundCount = Math.log2(size);

    const rounds = [];
    // Erste Runde: Paarungen nach Setzreihenfolge, fehlende Plätze = Freilos
    let first = [];
    for (let i = 0; i < size; i += 2) {
      const sa = order[i], sb = order[i + 1];
      first.push({
        id: prefix + '_r1_' + (first.length + 1),
        round: 1,
        a: sa <= n ? seeds[sa - 1] : { k: 'bye' },
        b: sb <= n ? seeds[sb - 1] : { k: 'bye' },
        seedA: sa, seedB: sb
      });
    }
    rounds.push({ round: 1, label: roundLabel(roundCount, 1), matches: first });

    for (let r = 2; r <= roundCount; r++) {
      const prev = rounds[r - 2].matches;
      const matches = [];
      for (let i = 0; i < prev.length; i += 2) {
        matches.push({
          id: prefix + '_r' + r + '_' + (matches.length + 1),
          round: r,
          a: { k: 'win', match: prev[i].id },
          b: { k: 'win', match: prev[i + 1].id }
        });
      }
      rounds.push({ round: r, label: roundLabel(roundCount, r), matches });
    }

    // Spiel um Platz 3 aus den Halbfinal-Verlierern
    if (o.thirdPlace !== false && roundCount >= 2) {
      const semis = rounds[roundCount - 2].matches;
      if (semis.length === 2) {
        rounds[roundCount - 1].matches.push({
          id: prefix + '_p3',
          round: roundCount,
          label: 'Spiel um Platz 3',
          a: { k: 'lose', match: semis[0].id },
          b: { k: 'lose', match: semis[1].id },
          places: [3, 4]
        });
      }
    }
    return { rounds, size, byes: size - n };
  }

  function roundLabel(total, r) {
    const left = total - r;               // Runden nach dieser
    if (left === 0) return 'Finale';
    if (left === 1) return 'Halbfinale';
    if (left === 2) return 'Viertelfinale';
    if (left === 3) return 'Achtelfinale';
    return 'Runde ' + r;
  }

  /* --- 3.4b Doppel-K.-o.-Baum (Double Elimination) --------------------------
     Zusaetzlich zum reinen Single-Elimination-Baum (genBracket) eine
     Gewinner-Runde (WB) + Verlierer-Runde (LB) + Grand Final mit
     Bracket-Reset. Ein Team scheidet erst nach der ZWEITEN Niederlage aus:
       - Verliert ein Team in der Gewinner-Runde, faellt es in die
         Verlierer-Runde (statt auszuscheiden).
       - Verliert ein Team dort ein zweites Mal, scheidet es aus.
       - Im Grand Final trifft der Gewinner-Runden-Champion (0 Niederlagen)
         auf den Verlierer-Runden-Champion (1 Niederlage). Gewinnt der
         Gewinner-Runden-Champion, ist das Turnier entschieden. Gewinnt der
         Verlierer-Runden-Champion, hat nun auch der bisherige Sieger erst
         EINE Niederlage - ein zweites, entscheidendes Spiel (Reset) ist dann
         zwingend (Standard-DE-Regel, siehe docs/format-double-elimination.html).
     Freilose in Runde 1 der Gewinner-Runde haben keinen echten Verlierer -
     dafuer traegt die Verlierer-Runde denselben {k:'bye'}-Platzhalter wie der
     Gewinner-Baum (siehe genBracket), damit ein Freilos nie ein Phantom-Spiel
     in der Verlierer-Runde erzwingt.
     Rueckgabe: { size, byes, wbRounds, lbRounds, grandFinal:{m1,m2}, rounds }
     rounds ist die Spielreihenfolge (WB/LB verschraenkt) fuer Zeitplan/Druck. */
  function pairRefs(refs, idPrefix, round) {
    const matches = [];
    for (let i = 0; i < refs.length; i += 2) {
      matches.push({ id: idPrefix + '_' + (matches.length + 1), round, a: refs[i], b: refs[i + 1] });
    }
    return matches;
  }
  function zipRefs(a, b, idPrefix, round) {
    const matches = [];
    for (let i = 0; i < a.length; i++) {
      matches.push({ id: idPrefix + '_' + (matches.length + 1), round, a: a[i], b: b[i] });
    }
    return matches;
  }
  /* Haengt bei ungerader Laenge ein {k:'bye'} an, damit pairRefs() paarweise
     aufgeht (die Verlierer-Runde erlaubt ungerade Teilnehmerzahlen je Runde,
     anders als der reine Zweierpotenz-Gewinnerbaum). */
  function padEven(refs) {
    const list = refs.slice();
    if (list.length % 2 === 1) list.push({ k: 'bye' });
    return list;
  }
  /* Gleicht zwei Listen vor dem Zippen auf dieselbe Laenge aus (mit Freilos
     aufgefuellt). Noetig, weil Freilose in Gewinner-Runde 1 dazu fuehren
     koennen, dass die Verlierer-Runde nicht bei jedem Schritt exakt halb so
     viele Teilnehmer hat wie im freilosfreien Standardfall. */
  function padTo(refs, len) {
    const list = refs.slice();
    while (list.length < len) list.push({ k: 'bye' });
    return list;
  }

  function genDoubleBracket(seeds, opts) {
    const o = opts || {};
    const n = seeds.length;
    let size = 1;
    while (size < n) size *= 2;
    const order = bracketSeedOrder(size);
    const prefix = o.idPrefix || 'de';
    const roundCount = Math.log2(size);

    // --- Gewinner-Runde (WB): baugleich zu genBracket, ohne Spiel um Platz 3 */
    const wbRounds = [];
    let first = [];
    for (let i = 0; i < size; i += 2) {
      const sa = order[i], sb = order[i + 1];
      first.push({
        id: prefix + '_wb_r1_' + (first.length + 1),
        round: 1,
        a: sa <= n ? seeds[sa - 1] : { k: 'bye' },
        b: sb <= n ? seeds[sb - 1] : { k: 'bye' },
        seedA: sa, seedB: sb
      });
    }
    wbRounds.push({ round: 1, label: roundLabel(roundCount, 1), matches: first });
    for (let r = 2; r <= roundCount; r++) {
      const prev = wbRounds[r - 2].matches;
      const matches = [];
      for (let i = 0; i < prev.length; i += 2) {
        matches.push({
          id: prefix + '_wb_r' + r + '_' + (matches.length + 1),
          round: r,
          a: { k: 'win', match: prev[i].id },
          b: { k: 'win', match: prev[i + 1].id }
        });
      }
      wbRounds.push({ round: r, label: roundLabel(roundCount, r), matches });
    }

    if (roundCount < 2) {
      // Unter 4 Teams gibt es keine sinnvolle Verlierer-Runde (siehe build()).
      return { size, byes: size - n, wbRounds, lbRounds: [], grandFinal: null, rounds: wbRounds.slice() };
    }

    // --- Verlierer-Runde (LB) ------------------------------------------
    const lbRounds = [];
    let lbRoundNo = 0;
    let prevWinners = null; // TeamRef[] – Ueberlebende der Verlierer-Runde
    for (let i = 1; i <= roundCount - 1; i++) {
      const wbMatches = wbRounds[i - 1].matches;
      /* NUR echte Verlierer faellt in die Verlierer-Runde. Ein Freilos-Spiel
         (moeglich ausschliesslich in Gewinner-Runde 1) hat keinen Verlierer
         und erzeugt deshalb GAR KEINEN Eintrag – nicht einmal einen
         Freilos-Platzhalter, sonst koennten zwei Freilose direkt
         aufeinandertreffen (Phantom-Spiel ohne jedes Team). */
      const realLosers = wbMatches
        .filter(m => !((m.a && m.a.k === 'bye') || (m.b && m.b.k === 'bye')))
        .map(m => ({ k: 'lose', match: m.id }));

      if (prevWinners === null) {
        lbRoundNo++;
        const matches = pairRefs(padEven(realLosers), prefix + '_lb_r' + lbRoundNo, lbRoundNo);
        lbRounds.push({ round: lbRoundNo, label: 'Verlierer-Runde ' + lbRoundNo, matches });
        prevWinners = matches.map(m => ({ k: 'win', match: m.id }));
      } else {
        lbRoundNo++;
        /* Die neuen Verlierer werden umgekehrt gegen die bisherigen
           Verlierer-Runden-Sieger gesetzt - reduziert sofortige
           Rueckspiele derselben Gewinner-Runde (uebliche DE-Konvention,
           kein FIVB-Standard – siehe docs/format-double-elimination.html).
           Bei ungleicher Anzahl (durch Freilose in Runde 1 moeglich) wird
           die kuerzere Seite mit Freilosen aufgefuellt. */
        const mixLen = Math.max(prevWinners.length, realLosers.length);
        const aSide = padTo(prevWinners, mixLen);
        const bSide = padTo(realLosers.slice().reverse(), mixLen);
        const mixed = zipRefs(aSide, bSide, prefix + '_lb_r' + lbRoundNo, lbRoundNo);
        lbRounds.push({ round: lbRoundNo, label: 'Verlierer-Runde ' + lbRoundNo, matches: mixed });
        prevWinners = mixed.map(m => ({ k: 'win', match: m.id }));

        if (prevWinners.length > 1) {
          lbRoundNo++;
          const reduced = pairRefs(padEven(prevWinners), prefix + '_lb_r' + lbRoundNo, lbRoundNo);
          lbRounds.push({ round: lbRoundNo, label: 'Verlierer-Runde ' + lbRoundNo, matches: reduced });
          prevWinners = reduced.map(m => ({ k: 'win', match: m.id }));
        }
      }
    }
    /* Sicherheitsnetz fuer ungewoehnliche Freilos-Verteilungen: im
       freilosfreien Standardfall ist prevWinners hier bereits auf 1 Team
       reduziert. Bleiben durch Freilose mehrere Ueberlebende uebrig, werden
       sie vor dem Verlierer-Finale zusaetzlich zusammengefuehrt. */
    while (prevWinners.length > 1) {
      lbRoundNo++;
      const reduced = pairRefs(padEven(prevWinners), prefix + '_lb_r' + lbRoundNo, lbRoundNo);
      lbRounds.push({ round: lbRoundNo, label: 'Verlierer-Runde ' + lbRoundNo, matches: reduced });
      prevWinners = reduced.map(m => ({ k: 'win', match: m.id }));
    }

    // Verlierer-Finale: letzter Verlierer-Runden-Ueberlebende gegen den
    // Verlierer des Gewinner-Finales (das WB-Finale hat immer einen echten
    // Verlierer, da dort kein Freilos mehr moeglich ist).
    const wbFinal = wbRounds[roundCount - 1].matches[0];
    lbRoundNo++;
    const lbFinalMatch = {
      id: prefix + '_lb_r' + lbRoundNo, round: lbRoundNo,
      a: prevWinners[0], b: { k: 'lose', match: wbFinal.id }
    };
    lbRounds.push({ round: lbRoundNo, label: 'Verlierer-Finale', matches: [lbFinalMatch] });

    // --- Grand Final (inkl. Reset-Regel) --------------------------------
    const gf1 = {
      id: prefix + '_gf1', round: roundCount + 1, label: 'Grand Final',
      a: { k: 'win', match: wbFinal.id }, b: { k: 'win', match: lbFinalMatch.id }
    };
    const gf2 = {
      id: prefix + '_gf2', round: roundCount + 2, label: 'Grand Final – Entscheidungsspiel (Reset)',
      a: { k: 'win', match: wbFinal.id }, b: { k: 'win', match: lbFinalMatch.id },
      reset: true, resetOf: gf1.id
    };

    // Sequentielle Spielreihenfolge fuer Zeitplan/Druck: WB-Runde, dann die
    // dazugehoerige(n) LB-Runde(n) (Mix + ggf. Minor-Reduktion), am Ende
    // Grand Final (+ Reset).
    const rounds = [];
    let rn = 0;
    let lbCursor = 0;
    for (let i = 0; i < wbRounds.length; i++) {
      rn++;
      rounds.push({ round: rn, label: wbRounds[i].label, matches: wbRounds[i].matches, phase: 'wb' });
      if (i === 0) {
        // Nach WB-Runde 1: die erste LB-Runde (reine Verlierer-Paarung)
        if (lbRounds[lbCursor]) { rn++; rounds.push({ round: rn, label: lbRounds[lbCursor].label, matches: lbRounds[lbCursor].matches, phase: 'lb' }); lbCursor++; }
      } else if (i < wbRounds.length - 1) {
        // Mix-Runde + Minor-Reduktionsrunde (falls vorhanden)
        if (lbRounds[lbCursor]) { rn++; rounds.push({ round: rn, label: lbRounds[lbCursor].label, matches: lbRounds[lbCursor].matches, phase: 'lb' }); lbCursor++; }
        if (lbRounds[lbCursor] && lbRounds[lbCursor].label !== 'Verlierer-Finale') { rn++; rounds.push({ round: rn, label: lbRounds[lbCursor].label, matches: lbRounds[lbCursor].matches, phase: 'lb' }); lbCursor++; }
      }
    }
    // Verlierer-Finale (letzte verbleibende LB-Runde)
    while (lbCursor < lbRounds.length) {
      rn++; rounds.push({ round: rn, label: lbRounds[lbCursor].label, matches: lbRounds[lbCursor].matches, phase: 'lb' }); lbCursor++;
    }
    rn++; rounds.push({ round: rn, label: gf1.label, matches: [gf1], phase: 'gf' });
    rn++; rounds.push({ round: rn, label: gf2.label, matches: [gf2], phase: 'gf' });

    return {
      size, byes: size - n, wbRounds, lbRounds,
      grandFinal: { m1: gf1, m2: gf2 }, rounds
    };
  }

  /* --- 3.5 Über-Kreuz-Platzierungsrunde -----------------------------------
     Standard-No-KO-Modus des Repos (AGENTS.md §5):
     Block k = A(2k-1) / A(2k) / B(2k-1) / B(2k), darin Über-Kreuz:
       Spiel 1: A(2k-1) vs B(2k)     Spiel 2: B(2k-1) vs A(2k)
       danach Sieger/Sieger um den oberen Platz, Verlierer/Verlierer um den unteren
     Restteams: 2 → Einzelspiel, 3 → 3er-Runde (jeder gegen jeden), 1 → Direktplatz.
     Rückgabe: { blocks:[{places,matches}], rounds:[…] }                       */
  function genPlacement(groupNames, groupSizes, opts) {
    const o = opts || {};
    const prefix = o.idPrefix || 'pl';
    const blockSize = 4;
    // Rangliste der Qualifikations-Slots in Platzierungs-Reihenfolge:
    // A1,B1,A2,B2,A3,B3,… (bei 2 Gruppen). Bei ungleichen Größen laufen die
    // kürzeren Gruppen einfach aus.
    const slots = [];
    const maxPlace = Math.max.apply(null, groupNames.map(n => groupSizes[n]));
    for (let p = 1; p <= maxPlace; p++) {
      groupNames.forEach(n => {
        if (groupSizes[n] >= p) slots.push({ k: 'rank', phase: o.phase || 'grp', group: n, place: p });
      });
    }

    const blocks = [];
    let i = 0, placeNo = 1;
    while (i < slots.length) {
      const rest = slots.length - i;
      if (rest >= blockSize) {
        const s = slots.slice(i, i + blockSize);
        const bid = prefix + '_b' + (blocks.length + 1);
        const m1 = { id: bid + '_x1', a: s[0], b: s[3], stage: 'cross' };
        const m2 = { id: bid + '_x2', a: s[1], b: s[2], stage: 'cross' };
        const mw = { id: bid + '_w', a: { k: 'win', match: m1.id }, b: { k: 'win', match: m2.id }, stage: 'final', places: [placeNo, placeNo + 1] };
        const ml = { id: bid + '_l', a: { k: 'lose', match: m1.id }, b: { k: 'lose', match: m2.id }, stage: 'final', places: [placeNo + 2, placeNo + 3] };
        blocks.push({ places: [placeNo, placeNo + 3], matches: [m1, m2, mw, ml] });
        i += blockSize; placeNo += blockSize;
      } else if (rest === 3) {
        const s = slots.slice(i, i + 3);
        const bid = prefix + '_b' + (blocks.length + 1);
        blocks.push({
          places: [placeNo, placeNo + 2],
          roundRobin: true,
          matches: [
            { id: bid + '_1', a: s[0], b: s[1], stage: 'rr' },
            { id: bid + '_2', a: s[0], b: s[2], stage: 'rr' },
            { id: bid + '_3', a: s[1], b: s[2], stage: 'rr' }
          ]
        });
        i += 3; placeNo += 3;
      } else if (rest === 2) {
        const s = slots.slice(i, i + 2);
        const bid = prefix + '_b' + (blocks.length + 1);
        blocks.push({
          places: [placeNo, placeNo + 1],
          matches: [{ id: bid + '_1', a: s[0], b: s[1], stage: 'final', places: [placeNo, placeNo + 1] }]
        });
        i += 2; placeNo += 2;
      } else {
        // genau ein Team übrig → bekommt den Platz ohne weiteres Spiel
        blocks.push({ places: [placeNo, placeNo], direct: slots[i], matches: [] });
        i += 1; placeNo += 1;
      }
    }
    return { blocks };
  }

  /* --- 3.6 Modified Pool Play (MPP) ----------------------------------------
     AGENTS.md §1 „Modified Pool Play": Variante der Gruppenphase ohne volles
     Round-Robin. In einer 4er-Gruppe spielt Setzplatz 1 gegen 4 und 2 gegen 3;
     danach die Sieger gegeneinander um den Gruppensieg (Platz 1/2) und die
     Verlierer gegeneinander um den Verbleib (Platz 3/4) - 4 Spiele statt 6.
     Der Bracket ist strukturell dasselbe Muster wie der 4er-Block der
     Über-Kreuz-Platzierungsrunde (§3.5 genPlacement, dort m1/m2/mw/ml) - hier
     jedoch INNERHALB einer einzelnen Gruppe statt über Gruppen hinweg.

     3er-Gruppen ("Bei 3er-Gruppen hat der Erstgesetzte ein Freilos im 1.
     Spiel"): das volle Round-Robin für 3 Teams braucht ohnehin nur 3 Spiele
     (mehr lässt sich nicht einsparen) UND genRoundRobin() gibt dem zuerst in
     der Liste stehenden Team (= Setzplatz 1) bereits von selbst das Freilos
     der ersten Runde (Circle-Methode: das erste Element bleibt fix, das
     letzte trifft in Runde 1 auf Platzhalter 0). Für 3er-Gruppen wird deshalb
     bewusst KEIN eigener Bracket gebaut, sondern genRoundRobin() wiederver-
     wendet - identisch zur bestehenden Gruppenphase, nur mit dieser
     Bye-Reihenfolge als Nebeneffekt. Die Platzierung läuft dann über die
     normale Tabellen-/Tie-Breaker-Kette (§7/§8), nicht über Bracket-Position.

     Andere Gruppengrößen (weder 3 noch 4) sind für "echtes" MPP nicht
     vorgesehen (siehe docs/format-modified-pool-play.html) - damit ein
     Turnier trotzdem nie abstürzt, degradiert genModifiedPoolPlay() für sie
     ebenfalls auf volles Round-Robin (spart dann nichts, bleibt aber korrekt
     und zeigt lediglich keinen Effizienzgewinn).

     Rückgabe: { rounds, meta }
       rounds – wie genGroupPhase(): [{round, matches, byes, bye}]
       meta   – { [groupName]: { size, mode:'bracket'|'rr', matchIds? } }       */
  function genModifiedPoolPlay(groups, opts) {
    const o = opts || {};
    const names = Object.keys(groups);
    const perGroup = {};
    const meta = {};
    let maxRounds = 0;
    names.forEach(n => {
      const list = groups[n];
      const prefix = (o.idPrefix || 'mpp') + n;
      if (list.length === 4) {
        const m1 = { id: prefix + '_x1', round: 1, a: list[0], b: list[3], stage: 'cross', label: 'Setzplatz 1 vs. 4' };
        const m2 = { id: prefix + '_x2', round: 1, a: list[1], b: list[2], stage: 'cross', label: 'Setzplatz 2 vs. 3' };
        const mw = {
          id: prefix + '_w', round: 2, stage: 'final', label: 'Gewinnerspiel – Platz 1/2', places: [1, 2],
          a: { k: 'win', match: m1.id }, b: { k: 'win', match: m2.id }
        };
        const ml = {
          id: prefix + '_l', round: 2, stage: 'final', label: 'Verliererspiel – Platz 3/4', places: [3, 4],
          a: { k: 'lose', match: m1.id }, b: { k: 'lose', match: m2.id }, mppLoserAware: true
        };
        perGroup[n] = [
          { round: 1, matches: [m1, m2], bye: null },
          { round: 2, matches: [mw, ml], bye: null }
        ];
        meta[n] = { size: 4, mode: 'bracket', matchIds: { m1: m1.id, m2: m2.id, mw: mw.id, ml: ml.id } };
        if (2 > maxRounds) maxRounds = 2;
      } else {
        const rr = genRoundRobin(list, { idPrefix: prefix });
        perGroup[n] = rr.map(rd => ({ round: rd.round, bye: rd.bye, matches: rd.matches }));
        meta[n] = { size: list.length, mode: 'rr' };
        if (rr.length > maxRounds) maxRounds = rr.length;
      }
    });
    const rounds = [];
    for (let r = 0; r < maxRounds; r++) {
      const matches = [];
      const byes = [];
      names.forEach(n => {
        const rd = perGroup[n][r];
        if (!rd) return;
        rd.matches.forEach(m => matches.push(Object.assign({}, m, { round: r + 1, group: n })));
        if (rd.bye != null) byes.push(rd.bye);
      });
      rounds.push({ round: r + 1, matches, byes, bye: byes.length === 1 ? byes[0] : null });
    }
    return { rounds, meta };
  }

  /* --- 3.7 King/Queen of the Court -------------------------------------------
     AGENTS.md §1 „King/Queen of the Court": Sonderform mit zeitlimitierten
     Runden (meist 15 Min/Runde) statt Satz-Zielscore. Bewusst NICHT in
     SET_MODES/setValid (Abschnitte 1+2 oben) integriert und diese Funktionen
     bleiben unverändert - eine zeitlimitierte Runde kennt weder Zielpunktzahl
     noch 2-Punkte-Vorsprung-Pflicht und kann UNENTSCHIEDEN enden (die Zeit
     läuft einfach ab). Eigene, klar abgegrenzte Wertungsfunktionen:

       kqValidScore(a,b)         – zwei nicht-negative Ganzzahlen, sonst nichts.
       kqComputeRoundResult(a,b) – {aPts,bPts,winner:'a'|'b'|null,draw}
                                   (winner null ⇔ draw true ⇔ Punktegleichstand)

     FELD-/LEITER-MODELL (dokumentierte Design-Entscheidung, siehe auch
     docs/format-king-of-the-court.html):
     Jedes Feld (Feld 1 = Königs-/Königinnenfeld, Feld C = unterstes Feld) ist
     im Normalfall mit GENAU 4 Teams besetzt (2 Beach-Doppel-Teams je Spiel,
     2 Spiele je Feld) - Teamzahl also idealerweise 4 × Feldzahl (8/12/16/20
     Teams bei 2/3/4/5 Feldern). Paarung innerhalb eines Feldes wie bei
     Modified Pool Play (§3.6 genModifiedPoolPlay): Setzplatz 1 gegen 4,
     Setzplatz 2 gegen 3.

     Bewegregel nach jeder Runde - generalisiert die klassische Regel für
     EIN Team pro Sieg/Niederlage (aus der Aufgabenstellung: "Sieger bleibt
     oben, Verlierer steigt ab; unten Sieger steigt auf, Verlierer bleibt;
     dazwischen Sieger auf, Verlierer ab") auf JE 2 Sieger/2 Verlierer, weil
     hier 2 Spiele gleichzeitig auf einem Feld laufen:
       - Königsfeld (Feld 1): beide Sieger BLEIBEN, beide Verlierer steigen
         auf Feld 2 AB.
       - unterstes Feld: beide Sieger steigen AUF (Feld C-1), beide Verlierer
         BLEIBEN.
       - Felder dazwischen: beide Sieger steigen eine Stufe AUF, beide
         Verlierer steigen eine Stufe AB.
       - Sonderfall genau 1 Feld: keine Leiter möglich - alle Teams bleiben
         auf dem einen Feld, werden aber nach Rundenpunkten neu gesetzt
         (Sieger vor Verlierer), damit sich die Paarungen ändern.

     Nicht durch 4 teilbare Teamzahlen (z.B. weil die Gesamtzahl kein glattes
     Vielfaches von 4×Feldzahl ist) werden NICHT abgelehnt, sondern fallen
     auf ein "Feld-Freilos" zurück, damit nie ein Turnier abstürzt:
       - 3 Teams auf einem Feld: 2 spielen gegeneinander (Sieger/Verlierer
         nach obiger Regel), das dritte Team hat in dieser Runde Feld-Freilos
         und bleibt unverändert auf seinem Feld stehen (zählt weder als Sieg
         noch als Niederlage, keine Punkte).
       - 5 Teams auf einem Feld: 4 spielen im MPP-Muster, das fünfte Team hat
         analog Feld-Freilos.
       - jede andere Größe (praktisch nur bei sehr ungewöhnlicher Konfigura-
         tion/mehreren Ausfällen möglich): volles Rundenspiel aller Paare auf
         diesem Feld, Bewegregel nutzt dann die Feld-interne Tabelle (obere
         Hälfte = "Sieger", untere Hälfte = "Verlierer").
     ========================================================================== */
  function kqValidScore(a, b) {
    return Number.isInteger(a) && Number.isInteger(b) && a >= 0 && b >= 0;
  }
  function kqComputeRoundResult(a, b) {
    if (!kqValidScore(a, b)) return null;
    return { aPts: a, bPts: b, winner: a > b ? 'a' : (b > a ? 'b' : null), draw: a === b };
  }

  /* Baut die Spiele EINES Feldes für eine Runde aus der aktuellen Setzung
     (order = Teams auf diesem Feld, beste Setzung zuerst). Liefert
     { matches:[{id,a,b}], byeTeam } - byeTeam nur bei 3/5 (oder ungerader
     Restgröße) besetzt.                                                     */
  function kqCourtMatches(order, idPrefix) {
    const list = (order || []).slice();
    const matches = [];
    let byeTeam = null;
    if (list.length === 2) {
      matches.push({ id: idPrefix + '_m1', a: list[0], b: list[1] });
    } else if (list.length === 4) {
      matches.push({ id: idPrefix + '_m1', a: list[0], b: list[3] });
      matches.push({ id: idPrefix + '_m2', a: list[1], b: list[2] });
    } else if (list.length === 3) {
      byeTeam = list[2];
      matches.push({ id: idPrefix + '_m1', a: list[0], b: list[1] });
    } else if (list.length === 5) {
      byeTeam = list[4];
      matches.push({ id: idPrefix + '_m1', a: list[0], b: list[3] });
      matches.push({ id: idPrefix + '_m2', a: list[1], b: list[2] });
    } else if (list.length === 1) {
      byeTeam = list[0];
    } else if (list.length > 0) {
      /* Sonderfall (siehe Kommentar oben): volles Rundenspiel auf dem Feld. */
      for (let i = 0; i < list.length; i++)
        for (let j = i + 1; j < list.length; j++)
          matches.push({ id: idPrefix + '_m' + (matches.length + 1), a: list[i], b: list[j] });
    }
    return { matches, byeTeam };
  }

  /* Ermittelt aus Sieger/Verlierer/Freilos JEDES Feldes einer Runde die neue
     Feldbesetzung der Folgerunde (siehe Bewegregel oben).
       winnersOf(courtIdx) → Team[]   (Reihenfolge irrelevant)
       losersOf(courtIdx)  → Team[]
       byeOf(courtIdx)     → Team|null (bleibt auf demselben Feld stehen)
     Rückgabe: Team[][] mit courtCount Einträgen, Sieger/Freilos jeweils vor
     den (neu ankommenden) Verlierern einsortiert, damit die nächste Runde
     wieder im MPP-Muster (1v4/2v3) gepaart werden kann.                     */
  function kqNextCourts(winnersOf, losersOf, byeOf, courtCount) {
    const n = Math.max(1, courtCount | 0);
    const next = [];
    for (let k = 0; k < n; k++) next.push([]);
    for (let k = 0; k < n; k++) {
      const winners = winnersOf(k) || [];
      const losers = losersOf(k) || [];
      const bye = byeOf ? byeOf(k) : null;
      if (bye != null) next[k].push(bye);
      if (n === 1) {
        next[0] = next[0].concat(winners, losers);
      } else if (k === 0) {
        next[0] = next[0].concat(winners);
        next[1] = next[1].concat(losers);
      } else if (k === n - 1) {
        next[k - 1] = next[k - 1].concat(winners);
        next[k] = next[k].concat(losers);
      } else {
        next[k - 1] = next[k - 1].concat(winners);
        next[k + 1] = next[k + 1].concat(losers);
      }
    }
    return next;
  }

  /* Erst-Setzung: verteilt Teams (in Setzlisten-Reihenfolge, Nr. 1 = Feld 1)
     der Reihe nach auf die Felder (Feld 1 = beste Setzplätze = Königsfeld),
     Restteams (falls Teamzahl kein glattes Vielfaches der Feldzahl ist)
     wandern auf die UNTEREN Felder, damit das Königsfeld nie größer wird als
     geplant.                                                                */
  function kqInitialCourts(teams, courtCount) {
    const list = normalizeTeamList(teams);
    const n = Math.max(1, courtCount | 0);
    const base = Math.floor(list.length / n);
    const extra = list.length % n;
    const courts = [];
    let i = 0;
    for (let k = 0; k < n; k++) {
      const size = base + (k >= n - extra ? 1 : 0);
      courts.push(list.slice(i, i + size));
      i += size;
    }
    return courts;
  }

  /* ==========================================================================
     4. TEAM-REFERENZEN
     Vereinheitlicht die vier bisherigen Verdrahtungsarten (feste Nummer,
     Gruppenplatz, KO-Sieger, KO-Verlierer) zu EINEM Mechanismus.
     ======================================================================== */
  function refLabel(ref, ctx) {
    if (ref == null) return '';
    if (typeof ref === 'number') return (ctx && ctx.teamLabel) ? ctx.teamLabel(ref) : ('Team ' + ref);
    switch (ref.k) {
      case 'team': return (ctx && ctx.teamLabel) ? ctx.teamLabel(ref.n) : ('Team ' + ref.n);
      case 'rank': return ref.group ? (ref.group + '-' + ref.place) : ('Platz ' + ref.place);
      case 'win': return 'Sieger ' + ((ctx && ctx.matchLabel) ? ctx.matchLabel(ref.match) : ref.match);
      case 'lose': return 'Verlierer ' + ((ctx && ctx.matchLabel) ? ctx.matchLabel(ref.match) : ref.match);
      case 'bye': return 'Freilos';
      default: return '';
    }
  }

  /* Löst eine Referenz zu einer Teamnummer auf. resolvers:
       rank(phase, group, place) → teamNo|null
       winner(matchId) → teamNo|null
       loser(matchId)  → teamNo|null                                           */
  function resolveRef(ref, resolvers) {
    if (ref == null) return null;
    if (typeof ref === 'number') return ref || null;
    switch (ref.k) {
      case 'team': return ref.n || null;
      case 'rank': return resolvers.rank ? resolvers.rank(ref.phase, ref.group, ref.place) : null;
      case 'win': return resolvers.winner ? resolvers.winner(ref.match) : null;
      case 'lose': return resolvers.loser ? resolvers.loser(ref.match) : null;
      case 'bye': return null;
      default: return null;
    }
  }

  /* ==========================================================================
     5. SLOT- UND ZEITPLANUNG
     Verteilt die Spiele einer Runde auf die verfügbaren Felder. Eine Runde mit
     mehr Spielen als Feldern wird in mehrere Teilslots zerlegt.

     Harte Bedingung (bisher nirgends geprüft): Ein Team darf innerhalb eines
     Teilslots nur EINMAL vorkommen. Bei Gruppenphasen mit parallel laufenden
     Gruppen ist das sonst nicht garantiert.
     ======================================================================== */
  function assignSlots(rounds, fieldCount, opts) {
    const o = opts || {};
    const nf = Math.max(1, fieldCount | 0);
    const out = [];
    let slotNo = 0;
    rounds.forEach(rd => {
      const pending = rd.matches.slice();
      const parts = [];
      while (pending.length) {
        const slot = [];
        const busy = new Set();
        for (let i = 0; i < pending.length && slot.length < nf;) {
          const m = pending[i];
          const ta = o.teamOf ? o.teamOf(m.a) : m.a;
          const tb = o.teamOf ? o.teamOf(m.b) : m.b;
          const conflict = (ta != null && busy.has(ta)) || (tb != null && busy.has(tb));
          if (conflict) { i++; continue; }
          if (ta != null) busy.add(ta);
          if (tb != null) busy.add(tb);
          slot.push(pending.splice(i, 1)[0]);
        }
        if (!slot.length) {           // Sicherheitsnetz gegen Endlosschleife
          slot.push(pending.shift());
        }
        parts.push(slot);
      }
      parts.forEach((slot, idx) => {
        slotNo++;
        out.push({
          slot: slotNo,
          round: rd.round,
          part: idx + 1,
          of: parts.length,
          bye: idx === 0 ? (rd.bye != null ? rd.bye : null) : null,
          byes: idx === 0 ? (rd.byes || []) : [],
          matches: slot.map((m, f) => Object.assign({}, m, { field: f }))
        });
      });
    });
    return out;
  }

  /* Zeitraster über die Slots legen. */
  function computeSchedule(slots, startMin, modeId, opts) {
    const o = opts || {};
    const per = o.slotMinutes || MODE_MIN[String(modeId)] || 25;
    return slots.map((s, i) => Object.assign({}, s, {
      startMin: startMin + i * per,
      endMin: startMin + (i + 1) * per,
      minutes: per
    }));
  }

  /* Wie viele Felder werden gebraucht, damit alle Runden ins Zeitfenster passen? */
  function neededFields(rounds, windowMin, slotMinutes, maxFields) {
    const cap = maxFields || 10;
    for (let f = 1; f <= cap; f++) {
      const slots = assignSlots(rounds, f);
      if (slots.length * slotMinutes <= windowMin) return f;
    }
    return null;
  }

  /* ==========================================================================
     6. ERGEBNIS EINES SPIELS
     sets: [[a1,b1],[a2,b2],[a3,b3]] – fehlende Werte als null.
     Rückgabe null, solange das Spiel unvollständig ist.

     Der Entscheidungssatz (Satz 3) zählt bewusst NUR für Sieg/Niederlage und
     fließt NICHT in die Ballwertung ein: sonst würde ein knapper 2:1-Sieg die
     Ball-Differenz stärker aufblähen als ein souveräner 2:0-Sieg.
     ======================================================================== */
  function computeResult(sets, modeId) {
    const def = modeDef(modeId);
    const s = sets || [];
    const g = i => (s[i] && s[i].length === 2) ? s[i] : [null, null];
    const [a1, b1] = g(0);

    if (def.sets === 1) {
      if (!setValid(a1, b1, def.target)) return null;
      return {
        aBalls: a1, bBalls: b1,
        aSets: a1 > b1 ? 1 : 0, bSets: b1 > a1 ? 1 : 0,
        winner: a1 > b1 ? 'a' : 'b', draw: false
      };
    }

    const [a2, b2] = g(1);
    if (!setValid(a1, b1, def.target) || !setValid(a2, b2, def.target)) return null;

    let aSets = (a1 > b1 ? 1 : 0) + (a2 > b2 ? 1 : 0);
    let bSets = (b1 > a1 ? 1 : 0) + (b2 > a2 ? 1 : 0);
    const aBalls = a1 + a2, bBalls = b1 + b2;

    if (def.decidingSet && aSets === bSets) {
      const [a3, b3] = g(2);
      if (!setValid(a3, b3, targetForSet(def.id, 3))) return null;
      aSets += a3 > b3 ? 1 : 0;
      bSets += b3 > a3 ? 1 : 0;
    }

    let winner = null, draw = false;
    if (aSets > bSets) winner = 'a';
    else if (bSets > aSets) winner = 'b';
    else { draw = true; }                    // 1:1 in den Modi ohne Entscheidungssatz

    return { aBalls, bBalls, aSets, bSets, winner, draw };
  }

  /* ==========================================================================
     7. TABELLE / STANDINGS

     games        gespielte Spiele (Freilos zählt mit)
     won/lost/drawn
     pts          Tabellenpunkte (Sieg = 2, Remis = 1, Niederlage = 0)
     setsFor/setsAgainst, sd = Satzdifferenz
     ballsFor/ballsAgainst, bd = Balldifferenz

     Freilos (AGENTS.md §4): zählt als Sieg, OHNE Sätze und OHNE Ballpunkte.
     ======================================================================== */
  const WIN_PTS = 2, DRAW_PTS = 1, LOSS_PTS = 0;

  function emptyStat() {
    return {
      games: 0, won: 0, lost: 0, drawn: 0, byes: 0, pts: 0,
      setsFor: 0, setsAgainst: 0, sd: 0,
      ballsFor: 0, ballsAgainst: 0, bd: 0
    };
  }

  /* played: [{a, b, result|null, bye?:teamNo}] – a/b sind Teamnummern.
     Spiele ohne Ergebnis werden ignoriert.                                    */
  function standings(teams, played, opts) {
    const o = opts || {};
    const st = {};
    normalizeTeamList(teams).forEach(t => st[t] = emptyStat());

    (played || []).forEach(m => {
      if (m.bye != null) {
        const s = st[m.bye];
        if (s) { s.games++; s.byes++; s.won++; s.pts += WIN_PTS; }
        return;
      }
      const res = m.result;
      if (!res) return;
      const sa = st[m.a], sb = st[m.b];
      if (!sa || !sb) return;
      sa.games++; sb.games++;
      sa.setsFor += res.aSets; sa.setsAgainst += res.bSets;
      sb.setsFor += res.bSets; sb.setsAgainst += res.aSets;
      sa.ballsFor += res.aBalls; sa.ballsAgainst += res.bBalls;
      sb.ballsFor += res.bBalls; sb.ballsAgainst += res.aBalls;
      if (res.winner === 'a') { sa.won++; sb.lost++; sa.pts += WIN_PTS; sb.pts += LOSS_PTS; }
      else if (res.winner === 'b') { sb.won++; sa.lost++; sb.pts += WIN_PTS; sa.pts += LOSS_PTS; }
      else { sa.drawn++; sb.drawn++; sa.pts += DRAW_PTS; sb.pts += DRAW_PTS; }
    });

    Object.keys(st).forEach(t => {
      st[t].sd = st[t].setsFor - st[t].setsAgainst;
      st[t].bd = st[t].ballsFor - st[t].ballsAgainst;
    });
    if (o.perGame) normalizePerGame(st);
    return st;
  }

  /* Normierung auf "pro gespieltem Spiel". Wird gebraucht, sobald Teams
     unterschiedlich viele Spiele haben (Freilos, Ausfall, ungleiche Gruppen).
     Die absoluten Werte bleiben erhalten (für den Ausdruck), zusätzlich gibt
     es sdPer/bdPer/wonPer.                                                    */
  function normalizePerGame(st) {
    Object.keys(st).forEach(t => {
      const s = st[t];
      const g = Math.max(1, s.games);
      s.wonPer = s.won / g;
      s.ptsPer = s.pts / g;
      s.sdPer = s.sd / g;
      s.bdPer = s.bd / g;
      s.ballsForPer = s.ballsFor / g;
    });
    return st;
  }

  /* Haben alle gewerteten Teams gleich viele Spiele? */
  function equalGames(teams, st) {
    const list = normalizeTeamList(teams).filter(t => st[t]);
    if (!list.length) return true;
    const g = st[list[0]].games;
    return list.every(t => st[t].games === g);
  }

  /* ==========================================================================
     8. TIE-BREAKER

     GRUNDLAGE: offizielle FIVB-Beach-Pool-Wertung (siehe AGENTS.md §4).
     Beachvolleyball wertet - anders als HALLEN-Volleyball - OHNE Satzverhältnis:
     Matchpunkte → Ballwertung → direkter Vergleich.

     Zwei bewusste, dokumentierte Abweichungen für den Papier-Betrieb:
      a) FIVB nutzt den Ball-QUOTIENTEN (erzielte ÷ erhaltene). Wir nutzen die
         Ball-DIFFERENZ, weil sie auf dem gedruckten Bogen ohne Taschenrechner
         rechenbar ist und in der laufenden Tabelle ohnehin kumuliert mitläuft.
         Bei gleicher Spielzahl führen beide praktisch immer zur selben Reihung.
      b) FIVB vergibt 2 Punkte für den Sieg und 1 für die Niederlage. Wir nutzen
         2 / 1 / 0 (Sieg / Remis / Niederlage): bei gleicher Spielzahl ist die
         Reihenfolge identisch (FIVB = 2·S + N = S + Spiele, also ebenfalls
         monoton in den Siegen), das Remis der Modi ohne Entscheidungssatz wird
         aber sauber abbildbar und bei ungleicher Spielzahl entsteht kein
         Vorteil fürs bloße Mehr-Spielen.

     'h2h' (direkter Vergleich) wird als MINI-TABELLE über die noch gleich-
     stehenden Teams ausgewertet - so schreibt es die FIVB für 3+ punktgleiche
     Teams vor. Das behebt zugleich die Nicht-Transitivität des bisherigen
     paarweisen Vergleichs (Ringschluss A>B>C>A).
     ======================================================================== */
  const CRITERIA = {
    pts:         { label: 'Punkte',            get: s => s.pts,         dir: -1 },
    ptsPer:      { label: 'Punkte/Spiel',      get: s => s.ptsPer,      dir: -1 },
    won:         { label: 'Siege',             get: s => s.won,         dir: -1 },
    wonPer:      { label: 'Siege/Spiel',       get: s => s.wonPer,      dir: -1 },
    bd:          { label: 'Ball-Differenz',    get: s => s.bd,          dir: -1 },
    bdPer:       { label: 'Ball-Diff./Spiel',  get: s => s.bdPer,       dir: -1 },
    ballsFor:    { label: 'Ballpunkte',        get: s => s.ballsFor,    dir: -1 },
    ballsForPer: { label: 'Ballpunkte/Spiel',  get: s => s.ballsForPer, dir: -1 },
    /* Nur für Sonderfälle vorgehalten - im Beachvolleyball NICHT Teil der
       offiziellen Kette (das ist die Hallen-Regel). Nicht in criteriaFor(). */
    sd:          { label: 'Satz-Differenz',    get: s => s.sd,          dir: -1 },
    sdPer:       { label: 'Satz-Diff./Spiel',  get: s => s.sdPer,       dir: -1 }
  };

  /* Rangfolge berechnen.
     opts:
       criteria   – Array von CRITERIA-Schlüsseln und/oder 'h2h'
       matches    – [{a,b,result}] für den direkten Vergleich
       perGame    – true → /Spiel-Varianten verwenden, wenn Spielzahl ungleich
       tieBreakBy – Fallback-Vergleich (Standard: Teamnummer = Losentscheid)
     Rückgabe: [{team, place, shared, stat}]                                   */
  function rank(teams, st, opts) {
    const o = opts || {};
    const list = normalizeTeamList(teams).filter(t => st[t]);
    const chain = o.criteria || DEFAULT_CRITERIA;
    const matches = o.matches || [];

    /* Ein Kriterium auf eine Gruppe anwenden → Liste von Untergruppen. */
    function splitBy(group, crit) {
      if (crit === 'h2h') return splitByH2H(group);
      const c = CRITERIA[crit];
      if (!c) return [group];
      const buckets = new Map();
      group.forEach(t => {
        const v = c.get(st[t]);
        const k = (v == null || Number.isNaN(v)) ? '∅' : String(v);
        if (!buckets.has(k)) buckets.set(k, { v: v == null ? -Infinity : v, list: [] });
        buckets.get(k).list.push(t);
      });
      return Array.from(buckets.values())
        .sort((x, y) => c.dir * (x.v - y.v))
        .map(b => b.list);
    }

    /* Direkter Vergleich als Mini-Tabelle: nur die Spiele DER GRUPPE
       untereinander werden gewertet, mit derselben Kriterienkette (ohne h2h,
       sonst Endlosschleife). Bei Ringschluss bleibt die Gruppe geschlossen –
       dann greift der nächste Schritt bzw. der Losentscheid.                  */
    function splitByH2H(group) {
      if (group.length < 2) return [group];
      const set = new Set(group);
      const sub = (matches || []).filter(m =>
        m.bye == null && set.has(m.a) && set.has(m.b) && m.result);
      if (!sub.length) return [group];
      const mst = standings(group, sub, { perGame: true });
      const subChain = chain.filter(c => c !== 'h2h');
      let parts = [group];
      subChain.forEach(crit => {
        const next = [];
        parts.forEach(p => {
          if (p.length < 2) { next.push(p); return; }
          const c = CRITERIA[crit];
          if (!c) { next.push(p); return; }
          const buckets = new Map();
          p.forEach(t => {
            const v = c.get(mst[t]);
            const k = (v == null || Number.isNaN(v)) ? '∅' : String(v);
            if (!buckets.has(k)) buckets.set(k, { v: v == null ? -Infinity : v, list: [] });
            buckets.get(k).list.push(t);
          });
          Array.from(buckets.values())
            .sort((x, y) => c.dir * (x.v - y.v))
            .forEach(b => next.push(b.list));
        });
        parts = next;
      });
      return parts;
    }

    let groups = [list.slice()];
    chain.forEach(crit => {
      const next = [];
      groups.forEach(g => {
        if (g.length < 2) { next.push(g); return; }
        splitBy(g, crit).forEach(p => next.push(p));
      });
      groups = next;
    });

    const cmpFallback = o.tieBreakBy || ((a, b) => a - b);
    const out = [];
    let place = 1;
    groups.forEach(g => {
      const sorted = g.slice().sort(cmpFallback);
      const shared = g.length > 1;
      sorted.forEach(t => out.push({ team: t, place, shared, stat: st[t] }));
      place += g.length;
    });
    return out;
  }

  /* Erzeugt die Kriterienkette für eine Wertungsgruppe.

     Reihenfolge (AGENTS.md §4):
       1. Punkte              (Sieg 2 / Remis 1 / Niederlage 0)
       2. Ball-Differenz
       3. Direkter Vergleich  (Mini-Tabelle über die Gleichstehenden)
       4. Erzielte Ballpunkte
       5. Losentscheid        (Fallback in rank(): Teamnummer)

     Kein Satzverhältnis - das ist die Hallen-Regel, nicht die Beach-Regel.

     Die /Spiel-Varianten werden automatisch gewählt, wenn die Teams der
     Wertungsgruppe unterschiedlich viele Spiele haben (Freilos, ausgefallenes
     Team, ungleich große Gruppen). Bei gleicher Spielzahl - dem Normalfall -
     bleibt die Wertung exakt die, die auf dem Papierbogen steht.             */
  function criteriaFor(modeId, opts) {
    const o = opts || {};
    return o.unequalGames
      ? ['ptsPer', 'bdPer', 'ballsForPer', 'h2h']
      : ['pts', 'bd', 'ballsFor', 'h2h'];
  }

  /* Reihenfolge nach FIVB-Beach-Praxis: erst die Zahlen aus allen Spielen,
     der direkte Vergleich entscheidet zuletzt vor dem Los. */
  const DEFAULT_CRITERIA = ['pts', 'bd', 'ballsFor', 'h2h'];

  /* ==========================================================================
     9. HILFSFUNKTIONEN
     ======================================================================== */
  function normalizeTeamList(teams) {
    if (typeof teams === 'number') {
      const out = [];
      for (let i = 1; i <= teams; i++) out.push(i);
      return out;
    }
    return (teams || []).slice();
  }

  function toMin(hhmm) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
    if (!m) return null;
    return (+m[1]) * 60 + (+m[2]);
  }
  function fromMin(min) {
    const v = ((min % 1440) + 1440) % 1440;
    return String(Math.floor(v / 60)).padStart(2, '0') + ':' + String(v % 60).padStart(2, '0');
  }

  return {
    SET_MODES, MODE_MIN, WIN_PTS, DRAW_PTS, LOSS_PTS,
    modeDef, isMulti, hasDecidingSet, targetForSet,
    setValid, computeResult,
    genRoundRobin, genGroups, genGroupPhase, genSwissRound, genBracket, genDoubleBracket, genPlacement,
    genModifiedPoolPlay,
    kqValidScore, kqComputeRoundResult, kqCourtMatches, kqNextCourts, kqInitialCourts,
    bracketSeedOrder, pairKey, roundLabel,
    refLabel, resolveRef,
    assignSlots, computeSchedule, neededFields,
    standings, normalizePerGame, equalGames, rank, criteriaFor, CRITERIA, DEFAULT_CRITERIA,
    normalizeTeamList, toMin, fromMin
  };
});
