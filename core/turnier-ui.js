/* ============================================================================
   turnier-ui.js – gemeinsame DOM-Bausteine der Turnierbögen

   Erzeugt genau das Markup, das in spielplan.css dokumentiert ist. Die
   Turnierbögen liefern nur noch Daten (Spiele, Namen, Ergebnisse) und rufen
   diese Builder auf – die Darstellung liegt an EINER Stelle.

   Score-Eingaben werden über data-Attribute identifiziert:
       data-mid="<matchId>" data-set="1|2|3" data-side="a|b"
   Damit ist die Eingabe unabhängig von Runde/Teamnummer und ein Moduswechsel
   ändert nur die Anzahl sichtbarer Satzspalten, nie die gespeicherten Daten.
   ========================================================================== */
(function (root, factory) {
  const api = factory(root.TC || (typeof require === 'function' ? require('./turnier-core.js') : null));
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TUI = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (TC) {
  'use strict';

  /* ------------------------------------------------------------ Hilfsmittel */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function fmtTime(min) { return TC.fromMin(min); }
  function fmtDiff(n) {
    if (n == null || Number.isNaN(n)) return '';
    return (n > 0 ? '+' : '') + n;
  }

  function teamNameHtml(team, teamNames, absent) {
    const n = team == null ? '' : String(team).trim();
    if (!n) return absent ? '<span class="abt">ausgefallen</span>' : '';
    const nm = ((teamNames && teamNames[n]) || '').trim();
    const label = '<span class="t-line">Team ' + esc(n) + '</span>'
      + (nm ? '<span class="tnm t-nm">(' + esc(nm) + ')</span>' : '');
    return absent ? label + ' <span class="abt">ausgefallen</span>' : label;
  }

  /* ================================================================ 1. NAMEN
     teamLabel() ist die einzige Stelle, die entscheidet, wie ein Team heißt.
     Ohne eingetragenen Namen bleibt die Nummer stehen – so bleibt der Bogen
     auch blanko ausdruckbar.                                                 */
  function makeLabeler(teamNames) {
    return function (n) {
      if (n == null) return '';
      const nm = teamNames && teamNames[n];
      return nm ? String(nm) : ('Team ' + n);
    };
  }

  /* Beschriftung einer Seite: entweder das aufgelöste Team oder – solange es
     noch nicht feststeht – der Klartext der Referenz ("Sieger HF1", "A-1").
     Der ausgedruckte Plan ist dadurch ohne Gerät verständlich.               */
  function sideLabel(ref, resolved, ctx) {
    if (resolved != null) return ctx.teamLabel(resolved);
    return TC.refLabel(ref, ctx) || '–';
  }

  /* Beschriftung IN der Spielkarte: immer "Team N" und darunter der
     eingetragene Name – so bleibt die Nummer auch mit Namen sichtbar
     (Vorbild: Bogen "Alle gegen Alle"). Steht das Team noch nicht fest,
     erscheint stattdessen die Herkunft ("Sieger HF1", "A-1").               */
  function cardNameHtml(ref, resolved, ctx) {
    if (resolved != null && ctx.teamNameHtml) return ctx.teamNameHtml(resolved);
    return '<span class="t-line">' + esc(sideLabel(ref, resolved, ctx)) + '</span>';
  }

  /* ========================================================= 2. SPIEL-KARTE */
  function setColumnHtml(matchId, setNo, label, placeholder, names) {
    const ph = placeholder ? ' placeholder="' + esc(placeholder) + '"' : '';
    /* aria-label mit dem Teamnamen – sonst liest der Screenreader nur "Feld". */
    const inp = side => {
      const nm = names && names[side];
      return '<input class="score" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="3"' +
        ' data-mid="' + esc(matchId) + '" data-set="' + setNo + '" data-side="' + side + '"' +
        ' autocomplete="off"' + (nm ? ' aria-label="' + esc(nm) + '"' : '') + ph + '>';
    };
    return '<span class="sset" data-set="' + setNo + '">'
      + '<span class="slbl">' + esc(label) + '</span>'
      + '<span class="sbox">' + inp('a') + '<span class="vs">:</span>' + inp('b') + '</span>'
      + '</span>';
  }

  /* m: {id, a, b, round?, label?, places?}  a/b sind TeamRef oder Teamnummer */
  function matchCellHtml(m, ctx) {
    const setCnt = TC.modeDef(ctx.setMode).sets;
    const deciding = TC.hasDecidingSet(ctx.setMode);
    const ta = ctx.resolve(m.a), tb = ctx.resolve(m.b);
    const isBye = (m.a && m.a.k === 'bye') || (m.b && m.b.k === 'bye');

    const inputNames = { a: sideLabel(m.a, ta, ctx), b: sideLabel(m.b, tb, ctx) };
    let sets = setColumnHtml(m.id, 1, setCnt <= 1 ? 'Punkte' : 'Satz 1', null, inputNames);
    if (setCnt >= 2) sets += setColumnHtml(m.id, 2, 'Satz 2', null, inputNames);
    if (deciding) sets += setColumnHtml(m.id, 3, 'Entsch.', 'TB', inputNames);

    /* t-a/t-b richten die Namen nach aussen aus, .t-line haelt "Team 12"
       einzeilig – beides wie im Bogen "Alle gegen Alle".                     */
    const side = (cls, ref, team) =>
      '<span class="pside ' + cls + '">'
      + '<span class="t ' + (cls === 'pside-a' ? 't-a' : 't-b') + '" '
      + (team != null ? 'data-team="' + team + '"' : '') + '>'
      + cardNameHtml(ref, team, ctx) + '</span></span>';

    const extra = m.label ? '<span class="mnote-slot">' + esc(m.label) + '</span>' : '';
    /* Nur EINE Beschriftung: ein sprechender Titel ("Spiel um Platz 3") ersetzt
       die technische Platzangabe, sonst stünde beides doppelt auf dem Bogen. */
    const places = (m.places && !m.label)
      ? '<span class="mnote-slot">um Platz ' + m.places.join('/') + '</span>' : '';

    return '<td class="match' + (isBye ? ' is-bye' : '') + '"'
      + ' data-mid="' + esc(m.id) + '"'
      + (m.round != null ? ' data-round="' + m.round + '"' : '')
      + ' data-col="' + (m.field != null ? m.field : 0) + '"'
      + (m.slot != null ? ' data-slot="' + m.slot + '"' : '')
      + ' data-field-label="' + esc(ctx.fieldLabel(m.field != null ? m.field : 0)) + '"'
      + (m.group ? ' data-group="' + esc(m.group) + '"' : '')
      + '>'
      + '<span class="pair">'
      + extra + places
      + '<span class="pnames">'
      + side('pside-a', m.a, ta)
      + side('pside-b', m.b, tb)
      + '</span>'
      + (isBye
        ? '<span class="bye-tag">Freilos</span>'
        : '<span class="psets">' + sets + '</span>'
        + '<span class="presult">'
        + '<span class="mres mres-a"><span class="mscore" data-score="a"></span><span class="tdiff" data-diff="a"></span></span>'
        + '<span class="mres mres-b"><span class="tdiff" data-diff="b"></span><span class="mscore" data-score="b"></span></span>'
        + '</span>'
        /* Hinweis (z. B. "Unentschieden") bewusst AUSSERHALB von .presult:
           als drittes Flex-Kind wuerde er die space-between-Verteilung stoeren
           und das rechte Team aus der rechten Kante in die Mitte schieben. */
        + '<span class="mnote-slot" data-note></span>')
      + '</span>'
      /* Platzhalter fuer die Freilos-Ansicht – wird erst bei einem Ausfall
         gefuellt (siehe paintByeCard).                                       */
      + '<span class="bye" hidden></span></td>';
  }

  /* Freilos-/Ausfall-Ansicht einer Spielkarte – Darstellung wie im Bogen
     "Alle gegen Alle": das kampflos weiterkommende Team wird als Sieger
     hervorgehoben, unter der Karte stehen "Freilos" und der Teamname.
     info: { dead:bool, winner:Teamnummer|null }                              */
  function paintByeCard(td, info, ctx) {
    if (!td) return;
    const pair = td.querySelector('.pair');
    const byeEl = td.querySelector('.bye');
    const note = td.querySelector('[data-note]');
    const dead = !!(info && info.dead);
    const winner = info ? info.winner : null;
    const active = dead || winner != null;

    td.classList.toggle('is-bye', active);
    if (!active) {
      if (pair) pair.hidden = false;
      if (byeEl) { byeEl.hidden = true; byeEl.innerHTML = ''; }
      return;
    }
    if (pair) pair.hidden = true;
    if (note) note.innerHTML = dead ? '' : '<span class="mwin-note">(kampflos)</span>';

    let html;
    if (dead) {
      html = '<span class="bye-tag">beide Teams ausgefallen</span>';
    } else {
      const nameHtml = ctx.teamNameHtml ? ctx.teamNameHtml(winner) : esc(ctx.teamLabel(winner));
      const onLeft = !!td.querySelector('.pside-a [data-team="' + winner + '"]');
      const name = '<span class="t">' + nameHtml + '</span>';
      const tag = '<span class="bye-tag">Freilos</span>';
      html = onLeft ? name + tag : tag + name;
      const sideEl = td.querySelector(onLeft ? '.pside-a' : '.pside-b');
      if (sideEl) sideEl.classList.add('is-winner');
    }
    if (byeEl) { byeEl.hidden = false; byeEl.innerHTML = html; }
  }

  /* ====================================================== 3. SPIELPLAN-BODY
     slots: Ergebnis aus TC.assignSlots()/TC.computeSchedule()
     ctx:   {setMode, teamLabel, fieldLabel, resolve, fields, sectionTitle?}   */
  function scheduleBodyHtml(slots, ctx) {
    const nf = ctx.fields;
    let html = '';
    slots.forEach(s => {
      const parts = s.of > 1 ? ' · Teil ' + s.part + '/' + s.of : '';
      const title = (s.title || ('Runde ' + s.round)) + parts;
      const nextBtn = '<button type="button" class="nbtn rnext noprint"'
        + ' data-round-next-from="' + s.round + '"'
        + ' data-round-step="1"'
        + ' aria-label="Zur nächsten Runde springen"><span class="chev chev-right" aria-hidden="true"></span> Runde</button>';
      const confirmBtn = '<button type="button" class="nbtn rconfirm noprint"'
        + ' data-round-confirm="' + s.round + '"'
        + ' data-round-confirm-slot="' + s.slot + '"'
        + ' aria-label="Aktuelles Feld validieren und zum nächsten Feld springen"'
        + ' title="Aktuelles Feld validieren und weiter">✓</button>';
      const meta = '<span class="rhead-meta">'
        + '<span class="rlabel">' + esc(title) + '</span>'
        + '<span class="rtime tt" data-slot="' + s.slot + '">'
        + (s.startMin != null ? esc(fmtTime(s.startMin) + '–' + fmtTime(s.endMin)) : '')
        + '</span>'
        + '<span class="rmode">' + esc(ctx.modeLabel || '') + '</span>'
        + nextBtn;
      let head = '<td class="rhead-cell" colspan="' + nf + '">'
        + '<span class="rhead-content">'
        + meta
        + '</span>'
        + '<span class="rhead-actions">' + confirmBtn + '</span>';
      const byes = (s.byes && s.byes.length) ? s.byes : (s.bye != null ? [s.bye] : []);
      if (byes.length) {
        head += '<span class="rbye">spielfrei: '
          + byes.map(t => '<span data-team="' + t + '">' + esc(ctx.teamLabel(t)) + '</span>').join(', ')
          + '</span>';
      }
      head += '</span></td>';
      html += '<tr class="rhead" data-round="' + s.round + '" data-slot="' + s.slot + '">' + head + '</tr>';

      let fhead = '<tr class="fhead" data-round="' + s.round + '" data-slot="' + s.slot + '">';
      for (let f = 0; f < nf; f++) {
        const fl = esc(ctx.fieldLabel(f));
        fhead += '<th scope="col" data-field="' + f + '"><span class="fhead-label">' + fl + '</span></th>';
      }
      html += fhead + '</tr>';

      html += '<tr data-round="' + s.round + '" data-slot="' + s.slot + '">';
      for (let f = 0; f < nf; f++) {
        const m = s.matches[f];
        if (m) html += matchCellHtml(Object.assign({}, m, { field: f, round: s.round, slot: s.slot }), ctx);
        else html += '<td class="empty" data-col="' + f + '" data-field-label="'
          + esc(ctx.fieldLabel(f)) + '"></td>';
      }
      html += '</tr>';
    });
    return html;
  }

  /* ================================================== 4. ERGEBNIS-ANZEIGE
     Aktualisiert eine bereits gebaute Karte, ohne sie neu zu erzeugen
     (rebuild()-Pattern, AGENTS.md §9: Fokus und Scroll bleiben erhalten).    */
  function paintMatch(td, res, ctx) {
    if (!td) return;
    const a = td.querySelector('[data-score="a"]');
    const b = td.querySelector('[data-score="b"]');
    const da = td.querySelector('[data-diff="a"]');
    const db = td.querySelector('[data-diff="b"]');
    const note = td.querySelector('[data-note]');
    const sa = td.querySelector('.pside-a');
    const sb = td.querySelector('.pside-b');
    if (sa) sa.classList.remove('is-winner');
    if (sb) sb.classList.remove('is-winner');
    if (!a || !b) return;

    if (!res) {
      a.textContent = ''; b.textContent = '';
      if (da) { da.textContent = ''; da.className = 'tdiff'; }
      if (db) { db.textContent = ''; db.className = 'tdiff'; }
      if (note) note.textContent = '';
      return;
    }
    const multi = TC.isMulti(ctx.setMode);
    a.textContent = multi ? String(res.aSets) : String(res.aBalls);
    b.textContent = multi ? String(res.bSets) : String(res.bBalls);
    const diff = res.aBalls - res.bBalls;
    if (da) { da.textContent = fmtDiff(diff); da.className = 'tdiff ' + (diff > 0 ? 'pos' : diff < 0 ? 'neg' : ''); }
    if (db) { db.textContent = fmtDiff(-diff); db.className = 'tdiff ' + (diff < 0 ? 'pos' : diff > 0 ? 'neg' : ''); }
    if (res.winner === 'a' && sa) sa.classList.add('is-winner');
    if (res.winner === 'b' && sb) sb.classList.add('is-winner');
    if (note) note.textContent = res.draw ? 'Unentschieden – je 1 Punkt' : '';
  }

  /* Markiert die Eingabekaestchen einer Spielkarte: gruen beim Satzgewinner,
     rot bei einem unmoeglichen Satzergebnis (Ziel nicht erreicht oder kein
     Zwei-Punkte-Vorsprung). Gleiches Verhalten wie im Bogen "Alle gegen
     Alle" – dort steckt es in markScores().                                  */
  function markScoreInputs(td, setMode) {
    if (!td) return;
    const boxes = {};
    td.querySelectorAll('input.score').forEach(inp => {
      inp.classList.remove('win', 'invalid');
      const set = inp.getAttribute('data-set') || '1';
      (boxes[set] = boxes[set] || {})[inp.getAttribute('data-side')] = inp;
    });
    Object.keys(boxes).forEach(set => {
      const a = boxes[set].a, b = boxes[set].b;
      if (!a || !b || a.disabled || b.disabled) return;
      const ra = String(a.value || '').trim(), rb = String(b.value || '').trim();
      if (ra === '' || rb === '') return;
      const va = parseInt(ra, 10), vb = parseInt(rb, 10);
      if (isNaN(va) || isNaN(vb)) return;
      if (!TC.setValid(va, vb, TC.targetForSet(setMode, +set))) {
        a.classList.add('invalid'); b.classList.add('invalid');
      } else if (va > vb) a.classList.add('win');
      else if (vb > va) b.classList.add('win');
    });
  }

  /* ============================================================ 5. TABELLE
     ranked: Ergebnis aus TC.rank(). "shared" wird als "=" markiert, damit auf
     dem Papier sichtbar ist, dass hier das Los entscheiden muss.             */
  function standingsTableHtml(ranked, ctx, opts) {
    const o = opts || {};
    const per = !!o.perGame;
    let html = '<thead><tr>'
      + '<th class="pl">Pl.</th><th class="nm">Team</th>'
      + '<th>Sp.</th><th>S</th>' + (o.showDraw ? '<th>U</th>' : '') + '<th>N</th>'
      + '<th>Pkt' + (per ? '/Sp' : '') + '</th>'
      + '<th>Bälle</th><th>Diff' + (per ? '/Sp' : '') + '</th>'
      + '</tr></thead><tbody>';
    ranked.forEach(r => {
      const s = r.stat;
      const pts = per ? (Math.round(s.ptsPer * 100) / 100) : s.pts;
      const bd = per ? (Math.round(s.bdPer * 100) / 100) : s.bd;
      const placeBadge = '<span class="screen-place' + (r.shared ? ' pz-tie' : '') + '"'
        + ' title="Aktueller Platz: ' + r.place + (r.shared ? ' (geteilt)' : '') + '">'
        + r.place + '.' + (r.shared ? '=' : '') + '</span>';
      const teamHtml = ctx.teamNameHtml ? ctx.teamNameHtml(r.team) : esc(ctx.teamLabel(r.team));
      html += '<tr' + (r.shared ? ' class="is-tie"' : '') + ' data-team="' + r.team + '">'
        + '<td class="pl' + (r.shared ? ' pz-tie' : '') + '">' + r.place + '.' + (r.shared ? '=' : '') + '</td>'
        + '<td class="nm">' + teamHtml + placeBadge + '</td>'
        + '<td>' + s.games + '</td><td>' + s.won + '</td>'
        + (o.showDraw ? '<td>' + s.drawn + '</td>' : '')
        + '<td>' + s.lost + '</td>'
        + '<td><b>' + pts + '</b></td>'
        + '<td>' + s.ballsFor + ':' + s.ballsAgainst + '</td>'
        + '<td class="' + (s.bd > 0 ? 'pos' : s.bd < 0 ? 'neg' : '') + '">' + fmtDiff(bd) + '</td>'
        + '</tr>';
    });
    return html + '</tbody>';
  }

  /* ====================================================== 5b. ANLEITUNGEN
     Ausfuellanleitungen stehen IMMER oberhalb der Tabelle/des Spielplans,
     damit sie beim Ausfuellen sichtbar sind (Markup: <p class="input-hint
     hint-top">).

     Bildschirm- und Druck-Fassung sind LOGISCH GETRENNT: online rechnet der
     Bogen mit (Tippen, Sprung ins naechste Kaestchen, Hervorhebung,
     automatische Tabelle), auf Papier passiert alles mit dem Stift. Jede
     Fassung ist fuer sich vollstaendig – es gibt keinen gemeinsamen
     Satzanfang, der in nur einem Medium Sinn ergibt.                       */
  function hintHtml(screenText, printText) {
    return '<span class="only-screen">' + screenText + '</span>'
      + '<span class="only-print">' + printText + '</span>';
  }

  /* Anleitung fuer die Ergebnis-Kaestchen im Spielplan.
     o.sets      – Beschreibung der Kaestchenpaare (optional, z. B. "je Satz
                   ein Kästchenpaar")
     o.screenAdd – Zusatz nur fuer die Bildschirm-Fassung
     o.printAdd  – Zusatz nur fuer die Druck-Fassung                        */
  function scoreHintHtml(opts) {
    const o = opts || {};
    const sets = o.sets ? o.sets + ' – ' : '';
    const add = t => (t ? ' ' + t : '');
    const screen = 'So trägst du ein: ' + sets
      + 'linkes Kästchen = linkes Team, rechtes Kästchen = rechtes Team. '
      + 'Nur Zahlen; mit „:“ oder Enter springst du ins nächste Kästchen. '
      + 'Der Sieger wird hervorgehoben.'
      + add(o.screenAdd);
    const print = 'So ausfüllen: ' + sets
      + 'linkes Kästchen = linkes Team, rechtes Kästchen = rechtes Team. '
      + 'Satzergebnis direkt nach dem Spiel mit dem Stift eintragen und den Namen des Siegers einkreisen.'
      + add(o.printAdd);
    return hintHtml(screen, print);
  }

  /* Erklärt über der Tabelle, wonach gewertet wurde – auch im Ausdruck. */
  function criteriaHint(criteria) {
    const names = { pts: 'Punkte', ptsPer: 'Punkte je Spiel', bd: 'Ball-Differenz',
      bdPer: 'Ball-Differenz je Spiel', h2h: 'direkter Vergleich',
      ballsFor: 'erzielte Bälle', ballsForPer: 'erzielte Bälle je Spiel' };
    return 'Reihenfolge bei Gleichstand: '
      + criteria.map(c => names[c] || c).join(' → ')
      + ' → Losentscheid. Ein „=“ hinter dem Platz bedeutet: hier entscheidet das Los.';
  }

  /* ================================================== 6. LAUFENDE TABELLE
     Kumulierte Punkte/Differenz je Runde – die Spalte, die vor Ort mit dem
     Stift fortgeschrieben wird. Die blaue Musterzeile bleibt erhalten.       */
  function trackTableHtml(teams, roundCount, ctx, opts) {
    const o = opts || {};
    const ptsLabel = o.ptsLabel || 'Punkte';
    const winPts = o.winPts || 1; // Punkte je Sieg (für Musterzeile)
    let html = '<thead><tr><th class="tname teamcol">Team / Name</th><th class="lbl">kumuliert</th>';
    for (let r = 1; r <= roundCount; r++) html += '<th>R' + r + '</th>';
    html += '<th class="pos">Platz</th></tr></thead><tbody>';
    /* Beispielzeile – zeigt wie man die Tabelle ausfüllt */
    let pEx = 0, bdEx = 0;
    const ptsEx = [], bdExArr = [];
    for (let i = 0; i < roundCount; i++) {
      if (i % 3 !== 1 || i === 0) pEx += winPts; ptsEx.push(pEx);
      bdEx += (i % 4 === 1 ? -3 : 4); bdExArr.push(bdEx);
    }
    html += '<tr class="grp ex ex-start"><td class="tname teamcol" rowspan="2">'
      + '<span class="ex-badge">Beispiel</span>'
      + '<span class="t-line">Team X</span><span class="tnm t-nm">(Teamname)</span>'
      + '</td><td class="lbl">' + ptsLabel + '</td>';
    ptsEx.forEach(v => html += '<td>' + v + '</td>');
    html += '<td class="pos" rowspan="2">3.</td></tr>';
    html += '<tr class="ex ex-end"><td class="lbl">Ball-Differenz</td>';
    bdExArr.forEach(v => html += '<td>' + (v > 0 ? '+' : '') + v + '</td>');
    html += '</tr>';
    /* Team-Zeilen */
    teams.forEach(t => {
      html += '<tr class="grp" data-team="' + t + '" data-line="pts">'
        + '<td class="tname teamcol" rowspan="2" data-team-name="' + t + '"><span class="t-line">Team ' + esc(t) + '</span></td>'
        + '<td class="lbl">' + ptsLabel + '</td>';
      for (let r = 1; r <= roundCount; r++) html += '<td class="rcell" data-round="' + r + '"></td>';
      html += '<td class="pos" rowspan="2" data-pos></td></tr>';
      html += '<tr data-team="' + t + '" data-line="bd"><td class="lbl">Ball-Differenz</td>';
      for (let r = 1; r <= roundCount; r++) html += '<td class="rcell" data-round="' + r + '"></td>';
      html += '</tr>';
    });
    return html + '</tbody>';
  }

  /* Hilfsfunktion: Track-Zelle befüllen (identisch zu setCell() der Vorlagen).
     val=null → leer; cls='auto' → grüner Hintergrund (fertige Runde).      */
  function setTrackCell(td, val, cls) {
    if (!td) return;
    td.classList.remove('auto', 'byeauto');
    if (val == null) { td.textContent = ''; return; }
    td.textContent = val;
    td.classList.add(cls || 'auto');
  }

  /* Sortiert die Zeilenpaare im tbody nach einer vorgegebenen Teamreihenfolge
     (= aktueller Platz). Die Muster-Zeile bleibt immer oben. */
  function sortTrackRows(tbody, orderedTeams) {
    if (!tbody) return;
    orderedTeams.forEach(t => {
      const cell = tbody.querySelector('td.tname[data-team-name="' + t + '"]');
      const row1 = cell && cell.closest('tr');
      const row2 = row1 && row1.nextElementSibling;
      if (row1 && !row1.classList.contains('ex')) tbody.appendChild(row1);
      if (row2 && !row2.classList.contains('ex')) tbody.appendChild(row2);
    });
  }

  /* ============================================================== 7. PANELS */
  function namePanelHtml(teams, teamNames) {
    return teams.map(t =>
      '<label class="nrow"><span class="nnum">' + t + '</span>'
      + '<input type="text" data-name-input="' + t + '" value="' + esc(teamNames[t] || '')
      + '" placeholder="Team ' + t + '" autocomplete="off" spellcheck="false"></label>'
    ).join('');
  }
  function fieldPanelHtml(count, fieldNames) {
    let html = '';
    for (let f = 0; f < count; f++) {
      html += '<label class="nrow"><span class="nnum">' + (f + 1) + '</span>'
        + '<input type="text" data-field-input="' + f + '" value="' + esc(fieldNames[f] || '')
        + '" placeholder="Feld ' + (f + 1) + '" autocomplete="off" spellcheck="false"></label>';
    }
    return html;
  }
  function absentPanelHtml(teams, absent, ctx) {
    const set = new Set(absent || []);
    return teams.map(t =>
      '<label class="chk"><input type="checkbox" data-absent-input="' + t + '"'
      + (set.has(t) ? ' checked' : '') + '> ' + esc(ctx.teamLabel(t)) + '</label>'
    ).join('');
  }

  /* ==================================================== 8. RUNDEN-NAVIGATOR
     Bei 16+ Teams ist der Plan sonst auf dem Handy unbedienbar.
     Das Markup entspricht exakt der in spielplan.css dokumentierten Struktur
     (div.schedule-roundbar > label>select, .nbtn-round, .state), damit alle
     Bögen dieselbe sticky Glass-Pill-Leiste zeigen.                          */
  function roundBarHtml(slots, active) {
    const rounds = [];
    slots.forEach(s => { if (rounds.indexOf(s.round) < 0) rounds.push(s.round); });
    const cur = String(active == null ? 'all' : active);
    const idx = rounds.indexOf(parseInt(cur, 10));
    const atFirst = cur === 'all' || idx <= 0;
    const atLast = cur === 'all' || idx < 0 || idx >= rounds.length - 1;

    let opts = '<option value="all"' + (cur === 'all' ? ' selected' : '') + '>Alle Runden</option>';
    rounds.forEach(r => {
      opts += '<option value="' + r + '"' + (cur === String(r) ? ' selected' : '')
        + '>Runde ' + r + '</option>';
    });

    const state = cur === 'all'
      ? 'Alle ' + rounds.length + (rounds.length === 1 ? ' Runde' : ' Runden') + ' sichtbar'
      : 'Runde ' + cur + ' von ' + rounds.length;

    const allActive = cur === 'all';
    const ICON_LAYERS = '<svg class="nico" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2l9 5-9 5-9-5 9-5z"/><path d="M3 12l9 5 9-5"/><path d="M3 17l9 5 9-5"/></svg>';
    return '<label>Runde<select data-round-select>' + opts + '</select></label>'
      + '<button type="button" class="nbtn nbtn-round nbtn-round-prev" data-round-step="-1"'
      + (atFirst ? ' disabled' : '') + ' aria-label="Vorherige Runde">'
      + '<span class="chev chev-left" aria-hidden="true"></span> Zurück</button>'
      + '<button type="button" class="nbtn nbtn-round nbtn-round-next" data-round-step="1"'
      + (atLast ? ' disabled' : '') + ' aria-label="Nächste Runde">'
      + 'Weiter <span class="chev chev-right" aria-hidden="true"></span></button>'
      + '<button type="button" class="nbtn nbtn-round nbtn-round-all'
        + (allActive ? ' roundall-active' : '') + '" data-round-all'
        + ' aria-pressed="' + allActive + '"'
        + ' title="Alle Runden gleichzeitig anzeigen">'
        + ICON_LAYERS + (allActive ? ' Einzelne Runde' : ' Alle Runden') + '</button>'
      + '<span class="state" aria-live="polite">' + esc(state) + '</span>';
  }

  /* Liefert den Filterwert, der sich aus einem Klick/Wechsel im Navigator
     ergibt – oder null, wenn das Ereignis den Navigator nicht betrifft.      */
  function roundBarValue(ev, slots, active) {
    const el = ev.target;
    if (!el || !el.getAttribute) return null;
    if (el.hasAttribute('data-round-select')) {
      /* click = Nutzer öffnet Dropdown → nicht eingreifen; nur change auswerten */
      if (ev.type === 'click') return null;
      return el.value;
    }
    const allBtn = el.closest ? el.closest('[data-round-all]') : null;
    if (allBtn && (allBtn.hasAttribute ? allBtn.hasAttribute('data-round-all') : false))
      return String(active) === 'all' ? '1' : 'all';
    const fromBtn = el.closest ? el.closest('[data-round-next-from]') : null;
    if (fromBtn && (fromBtn.hasAttribute ? fromBtn.hasAttribute('data-round-next-from') : false)) {
      const roundsFrom = [];
      slots.forEach(s => { if (roundsFrom.indexOf(s.round) < 0) roundsFrom.push(s.round); });
      const from = parseInt(fromBtn.getAttribute('data-round-next-from'), 10);
      const iFrom = roundsFrom.indexOf(from);
      if (iFrom < 0 || iFrom >= roundsFrom.length - 1) return null;
      return String(roundsFrom[iFrom + 1]);
    }
    const btn = el.closest ? el.closest('[data-round-step]') : null;
    if (!btn || btn.disabled) return null;
    const rounds = [];
    slots.forEach(s => { if (rounds.indexOf(s.round) < 0) rounds.push(s.round); });
    if (!rounds.length) return null;
    const step = parseInt(btn.getAttribute('data-round-step'), 10);
    if (String(active) === 'all') return String(step > 0 ? rounds[0] : rounds[rounds.length - 1]);
    const i = rounds.indexOf(parseInt(active, 10)) + step;
    if (i < 0 || i >= rounds.length) return null;
    return String(rounds[i]);
  }

  function applyRoundFilter(tbody, filter) {
    if (!tbody) return;
    tbody.querySelectorAll('tr[data-round]').forEach(tr => {
      const r = tr.getAttribute('data-round');
      tr.hidden = !(filter === 'all' || String(r) === String(filter));
    });
  }

  /* ============================================ 8b. WERTUNG UND TIE-BREAKER
     Beide Tabellen werden aus der Engine abgeleitet, damit der gedruckte
     Bogen nie eine andere Wertung behauptet als die, nach der gerechnet wird
     (AGENTS.md §4). Unentschieden erscheint nur, wenn es der Satzmodus
     ueberhaupt zulaesst.                                                     */
  function scoringTablesHtml(setMode, criteria) {
    const drawPossible = TC.isMulti(setMode) && !TC.hasDecidingSet(setMode);
    let w = '<table><caption>Wertung pro Spiel</caption>'
      + '<tr><th>Ergebnis</th><th>Wertung</th></tr>'
      + '<tr><td>Sieg</td><td>' + TC.WIN_PTS + ' Punkte</td></tr>';
    if (drawPossible) w += '<tr><td>Unentschieden</td><td>' + TC.DRAW_PTS + ' Punkt</td></tr>';
    w += '<tr><td>Niederlage</td><td>' + TC.LOSS_PTS + ' Punkte</td></tr>'
      + '<tr><td>Freilos / spielfrei</td><td>' + TC.WIN_PTS + ' Punkte, ohne Ball-Differenz</td></tr>'
      + '</table>';

    const names = { pts: 'Punkte', ptsPer: 'Punkte je Spiel', bd: 'Ball-Differenz',
      bdPer: 'Ball-Differenz je Spiel', h2h: 'direkter Vergleich',
      ballsFor: 'erzielte Ballpunkte', ballsForPer: 'erzielte Ballpunkte je Spiel' };
    const chain = (criteria || ['pts', 'bd', 'ballsFor', 'h2h']).slice();
    let t = '<table><caption>Reihenfolge bei Gleichstand</caption>'
      + '<tr><th>Rang</th><th>Kriterium</th></tr>';
    chain.forEach((c, i) => {
      t += '<tr><td>' + (i + 1) + '</td><td>' + esc(names[c] || c) + '</td></tr>';
    });
    t += '<tr><td>' + (chain.length + 1) + '</td><td>Losentscheid («=» in der Tabelle)</td></tr></table>';

    return '<div style="flex:0 0 46%">' + w + '</div><div class="grow">' + t + '</div>';
  }

  /* =========================================== 8c. MOBILE SPRUNGLEISTE
     Auf dem Handy ist der Bogen laenger als der Bildschirm; ohne die Leiste
     scrollt man waehrend des Turniers minutenlang.                           */
  function jumpBarHtml(targets) {
    const t = targets || {};
    const btn = (id, label) => id
      ? '<button type="button" class="nbtn" data-jump="' + esc(id) + '">' + esc(label) + '</button>'
      : '';
    return btn(t.setup || 'configSection', '⚙️ Setup')
      + btn(t.guide || 'guideContainer', '📖 Anleitung')
      + btn(t.schedule || 'scheduleSection', '📋 Spielplan')
      + btn(t.standings || 'standingsSection', '🏁 Tabelle')
      + '<button type="button" class="nbtn" data-jump-print>🖨️ Drucken</button>';
  }

  /* Ein delegierter Listener genuegt fuer die ganze Leiste. */
  function wireJumpBar(bar) {
    if (!bar) return;
    bar.addEventListener('click', e => {
      const el = e.target.closest ? e.target.closest('[data-jump],[data-jump-print]') : null;
      if (!el) return;
      if (el.hasAttribute('data-jump-print')) { window.print(); return; }
      const target = document.getElementById(el.getAttribute('data-jump'));
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  /* =============================================== 9. EINGABE-VERDRAHTUNG
     Ein einziger delegierter Listener für alle Score-Felder. „:“ und Enter
     springen ins nächste Kästchen; bei Fokus wird der Inhalt markiert.       */
  function wireScoreInputs(rootEl, onChange) {
    if (!rootEl) return;
    let lastFocusedMatch = null;
    const fields = () => Array.prototype.slice.call(rootEl.querySelectorAll('input.score'))
      .filter(i => i.offsetParent !== null || i.closest('td') === null);
    const cards = () => Array.prototype.slice.call(rootEl.querySelectorAll('td.match'))
      .filter(td => td.offsetParent !== null && !td.hidden);
    const firstEnabledScore = td => {
      if (!td) return null;
      const ins = td.querySelectorAll('input.score');
      for (let i = 0; i < ins.length; i++) {
        if (!ins[i].disabled) return ins[i];
      }
      return null;
    };
    const validateCard = (td, setMode) => {
      if (!td) return false;
      const ins = td.querySelectorAll('input.score');
      if (!ins.length) return false;
      const mode = setMode || (onChange.setMode ? onChange.setMode() : null);
      for (let i = 0; i < ins.length; i++) {
        const inp = ins[i];
        if (inp.disabled) continue;
        const raw = String(inp.value || '').trim();
        if (!/^[0-9]+$/.test(raw)) return false;
        const setNo = +inp.getAttribute('data-set');
        const side = inp.getAttribute('data-side');
        const other = td.querySelector('input.score[data-set="' + setNo + '"][data-side="' + (side === 'a' ? 'b' : 'a') + '"]');
        if (!other || other.disabled) return false;
        const rawOther = String(other.value || '').trim();
        if (!/^[0-9]+$/.test(rawOther)) return false;
        const va = parseInt(raw, 10), vb = parseInt(rawOther, 10);
        if (!mode) return false;
        if (!TC.setValid(va, vb, TC.targetForSet(mode, setNo))) return false;
      }
      return true;
    };
    const focusNextCard = fromTd => {
      const list = cards();
      const i = list.indexOf(fromTd);
      if (i < 0) return false;
      for (let j = i + 1; j < list.length; j++) {
        const next = firstEnabledScore(list[j]);
        if (!next) continue;
        next.focus();
        next.select();
        try { next.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) {}
        return true;
      }
      return false;
    };
    const focusNextFieldCard = fromTd => {
      if (!fromTd || !fromTd.getAttribute) return false;
      const round = fromTd.getAttribute('data-round');
      if (!round) return focusNextCard(fromTd);
      const list = cards().filter(td => String(td.getAttribute('data-round')) === String(round));
      const currentCol = fromTd.getAttribute('data-col');
      const next = list
        .filter(td => currentCol != null && Number(td.getAttribute('data-col')) > Number(currentCol))
        .sort((a, b) => Number(a.getAttribute('data-col')) - Number(b.getAttribute('data-col')))[0];
      if (next) {
        const target = firstEnabledScore(next);
        if (target) {
          target.focus();
          target.select();
          try { target.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) {}
          return true;
        }
      }
      return false;
    };

    rootEl.addEventListener('focusin', e => {
      const score = e.target && e.target.classList && e.target.classList.contains('score') ? e.target : null;
      if (score) {
        score.select();
        const card = score.closest ? score.closest('td.match') : null;
        if (card) lastFocusedMatch = card;
      }
    });
    rootEl.addEventListener('input', e => {
      const el = e.target;
      if (!el.classList || !el.classList.contains('score')) return;
      const raw = el.value;
      const jump = /[:\s]/.test(raw);
      el.value = raw.replace(/[^0-9]/g, '').slice(0, 3);
      onChange(el.getAttribute('data-mid'), +el.getAttribute('data-set'),
        el.getAttribute('data-side'), el.value);
      if (jump) focusNext(el, fields());
    });
    rootEl.addEventListener('keydown', e => {
      const el = e.target;
      if (!el.classList || !el.classList.contains('score')) return;
      if (e.key === 'Enter') { e.preventDefault(); focusNext(el, fields()); }
      if (e.key === 'Tab') {
        const list = fields();
        const moved = e.shiftKey ? focusPrev(el, list) : focusNext(el, list);
        if (moved) e.preventDefault();
      }
    });
    /* Komfort: Wird nur der Verlierer-Wert eingetragen, füllt sich die
       Gegenseite mit dem Satzziel. Nie überschreibend – ein bereits
       eingetragener Wert bleibt stehen. Ersetzt die ID-basierte Logik aus
       form-flow.js, die mit data-Attributen nicht greift.                    */
    rootEl.addEventListener('change', e => {
      const el = e.target;
      if (!el.classList || !el.classList.contains('score') || el.disabled) return;
      if (!onChange.setMode) return;
      const setNo = +el.getAttribute('data-set');
      const target = TC.targetForSet(onChange.setMode(), setNo);
      const raw = String(el.value || '').trim();
      if (!/^\d+$/.test(raw)) return;
      const v = parseInt(raw, 10);
      if (v < 0 || v > target - 2) return;
      const other = el.getAttribute('data-side') === 'a' ? 'b' : 'a';
      const p = rootEl.querySelector('input.score[data-mid="' + el.getAttribute('data-mid')
        + '"][data-set="' + setNo + '"][data-side="' + other + '"]');
      if (!p || p.disabled || String(p.value || '').trim() !== '') return;
      p.value = String(target);
      onChange(p.getAttribute('data-mid'), setNo, other, p.value);
    });
    rootEl.addEventListener('click', e => {
      const roundBtn = e.target && e.target.closest
        ? e.target.closest('[data-round-confirm]')
        : null;
      if (roundBtn) {
        const round = roundBtn.getAttribute('data-round-confirm');
        const activeCard = document.activeElement && document.activeElement.closest
          ? document.activeElement.closest('td.match')
          : null;
        const current = (lastFocusedMatch && String(lastFocusedMatch.getAttribute('data-round')) === String(round))
          ? lastFocusedMatch
          : (activeCard && String(activeCard.getAttribute('data-round')) === String(round) ? activeCard : null);
        const td = current || rootEl.querySelector('td.match[data-round="' + round + '"]');
        if (!td) return;
        if (!validateCard(td, onChange.setMode ? onChange.setMode() : null)) return;
        e.preventDefault();
        const moved = focusNextFieldCard(td);
        if (!moved && current) {
          const roundList = cards();
          const roundIdx = roundList.findIndex(cell => cell === current);
          if (roundIdx >= 0) {
            const next = roundList[roundIdx + 1];
            if (next) {
              const target = firstEnabledScore(next);
              if (target) {
                target.focus();
                target.select();
              }
            }
          }
        }
        return;
      }
      const btn = e.target && e.target.closest
        ? e.target.closest('[data-score-confirm],[data-score-confirm-col]')
        : null;
      if (!btn) return;
      e.preventDefault();
      if (btn.hasAttribute && btn.hasAttribute('data-score-confirm-col')) {
        const col = btn.getAttribute('data-score-confirm-col');
        const round = btn.getAttribute('data-score-confirm-round');
        const slot = btn.getAttribute('data-score-confirm-slot');
        let sel = 'td.match[data-col="' + col + '"]';
        if (round != null) sel += '[data-round="' + round + '"]';
        if (slot != null) sel += '[data-slot="' + slot + '"]';
        const tdFromHead = rootEl.querySelector(sel);
        if (!tdFromHead) return;
        focusNextCard(tdFromHead);
        return;
      }
      const td = btn.closest ? btn.closest('td.match') : null;
      if (!td) return;
      focusNextCard(td);
    });
  }
  function focusNext(el, list) {
    const i = list.indexOf(el);
    if (i >= 0 && i + 1 < list.length) {
      list[i + 1].focus();
      list[i + 1].select();
      return true;
    }
    return false;
  }
  function focusPrev(el, list) {
    const i = list.indexOf(el);
    if (i > 0) {
      list[i - 1].focus();
      list[i - 1].select();
      return true;
    }
    return false;
  }

  /* ======================================================= FELDER & ZEITPLAN
     Mehr Felder als gleichzeitig moegliche Spiele bringen nichts – deshalb
     richtet sich die Auswahl nach der Teamzahl (wie im Flexibel-Bogen).      */
  function maxParallelFields(teams) {
    return Math.max(1, Math.min(10, Math.floor((teams || 0) / 2)));
  }
  function defaultFields(teams) {
    return Math.min(4, maxParallelFields(teams));
  }
  function fillFieldSelect(sel, teams, current) {
    if (!sel) return current;
    const max = maxParallelFields(teams);
    const val = Math.max(1, Math.min(+current || 1, max));
    sel.innerHTML = '';
    for (let n = 1; n <= max; n++) sel.add(new Option(n + (n === 1 ? ' Feld' : ' Felder'), n));
    sel.value = String(val);
    return val;
  }

  /* Kompakte Zeitplan-Uebersicht (zweispaltig): auf dem Ausdruck sieht die
     Turnierleitung auf einen Blick, wann welche Runde startet.              */
  function timeTableHtml(slots, endLabel) {
    const rows = (slots || []).map(s => {
      const parts = s.of > 1 ? ' · Teil ' + s.part + '/' + s.of : '';
      return { t: fmtTime(s.startMin), n: (s.title || ('Runde ' + s.round)) + parts };
    });
    if (endLabel) rows.push({ t: endLabel.time, n: endLabel.text });
    const half = Math.ceil(rows.length / 2);
    let html = '<table class="timeplan"><caption>Zeitplan</caption><thead><tr>'
      + '<th>Zeit</th><th>Runde</th><th>Zeit</th><th>Runde</th></tr></thead><tbody>';
    for (let i = 0; i < half; i++) {
      const a = rows[i], b = rows[i + half];
      html += '<tr><td>' + (a ? esc(a.t) : '') + '</td><td>' + (a ? esc(a.n) : '') + '</td>'
        + '<td>' + (b ? esc(b.t) : '') + '</td><td>' + (b ? esc(b.n) : '') + '</td></tr>';
    }
    return html + '</tbody></table>';
  }

  /* ===================================================== KENNZAHLEN-KACHELN
     Die Planungswerte, die der Bogen "Alle gegen Alle" schon lange zeigt:
     Wie viel Zeit steht je Spiel zur Verfuegung, wie viel wird mindestens
     gebraucht, wann waere man fruehestens fertig. Fuellt nur die Kacheln,
     die im jeweiligen Bogen vorhanden sind.
       o = { slots, startMin, needEndMin, windowStartMin, windowEndMin,
             setMode, games, modeLabel, teams }                              */
  function fillTimeKpis(o) {
    const set = (id, txt, warn) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.textContent = txt;
      const item = el.closest ? el.closest('.cfgres-item') : null;
      if (item) item.classList.toggle('is-warn', !!warn);
    };
    const fmtDur = m => {
      const v = Math.max(0, Math.round(m));
      return Math.floor(v / 60) + ':' + String(v % 60).padStart(2, '0') + ' h';
    };
    const slots = o.slots || [];
    const winMin = Math.max(0, o.windowEndMin - o.windowStartMin);
    const needMin = Math.max(0, o.needEndMin - o.startMin);
    const minPerGame = TC.MODE_MIN[String(o.setMode)] || 25;
    const availPerGame = slots.length ? Math.floor(winMin / slots.length) : 0;
    const def = TC.modeDef(o.setMode) || {};
    const setsMin = TC.isMulti(o.setMode) ? 2 : 1;
    const setsMax = TC.isMulti(o.setMode) && TC.hasDecidingSet(o.setMode) ? 3 : setsMin;
    const games = o.games || 0;
    const setsLo = games * setsMin, setsHi = games * setsMax;
    const perSet = Math.round(minPerGame / setsMax);

    if (o.modeLabel != null) set('rv-mode', o.modeLabel);
    if (o.teams != null) set('rv-teams', o.teams);
    set('rv-fitEnd', fmtTime(o.needEndMin), o.needEndMin > o.windowEndMin);
    set('rv-subsets', (setsLo === setsHi ? setsLo : setsLo + '–' + setsHi)
      + ' · ≈' + perSet + ' Min/Satz');
    set('rv-perGame', availPerGame + ' / ' + minPerGame + ' Min', availPerGame < minPerGame);
    set('rv-duration', fmtDur(winMin) + ' / ' + fmtDur(needMin), needMin > winMin);
    set('rv-buffer', (winMin - needMin >= 0 ? '+' : '−') + fmtDur(Math.abs(winMin - needMin)),
      winMin < needMin);
  }

  return {
    esc, fmtTime, fmtDiff, teamNameHtml, makeLabeler, sideLabel, cardNameHtml,
    setColumnHtml, matchCellHtml, scheduleBodyHtml, paintMatch, markScoreInputs, paintByeCard,
    standingsTableHtml, criteriaHint, hintHtml, scoreHintHtml, trackTableHtml, setTrackCell, sortTrackRows,
    namePanelHtml, fieldPanelHtml, absentPanelHtml,
    roundBarHtml, roundBarValue, applyRoundFilter,
    scoringTablesHtml, jumpBarHtml, wireJumpBar,
    maxParallelFields, defaultFields, fillFieldSelect, timeTableHtml, fillTimeKpis,
    wireScoreInputs
  };
});
