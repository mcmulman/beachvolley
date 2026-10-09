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
  const api = factory(
    root.TC || (typeof require === 'function' ? require('./turnier-core.js') : null),
    root.TStore || (typeof require === 'function' ? require('./turnier-store.js') : null)
  );
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.TUI = api;
    api.wireFormatInfo(root.document);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (TC, TStore) {
  'use strict';

  /* ------------------------------------------------------------ Hilfsmittel */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  /* DE/EN-Prototyp (core/turnier-i18n.js): Nur Seiten mit <html data-i18n>
     übersetzen. Ohne TI18n bzw. auf nicht freigeschalteten Seiten gilt der
     deutsche Fallback – exakt der bisherige Text (Test: i18n.test.mjs). */
  function i18n() {
    return typeof TI18n !== 'undefined' && TI18n && TI18n.active() ? TI18n : null;
  }
  function tx(key, de, params) {
    const I = i18n();
    if (I) return I.t(key, params);
    const s = de && typeof de === 'object'
      ? (params && Number(params.count) === 1 ? de.one : de.other) : de;
    return String(s).replace(/\{(\w+)\}/g, (m, k) => (params && params[k] != null ? String(params[k]) : m));
  }
  function term(s) {
    const I = i18n();
    return I ? I.term(s) : s;
  }
  /* Titel eines Zeitslots ("Halbfinale", "Runde 3 · Teil 1/2") – gemeinsam
     für Spielplan-Kopf und Zeitplan-Tabelle. */
  function slotTitle(s) {
    const base = s.title ? term(s.title) : tx('ui.round.n', 'Runde {n}', { n: s.round });
    return base + (s.of > 1 ? tx('ui.round.part', ' · Teil {part}/{of}', { part: s.part, of: s.of }) : '');
  }

  function fmtTime(min) { return TC.fromMin(min); }
  function fmtDiff(n) {
    if (n == null || Number.isNaN(n)) return '';
    return (n > 0 ? '+' : '') + n;
  }

  function teamNameHtml(team, teamNames, absent) {
    const n = team == null ? '' : String(team).trim();
    const absentHtml = '<span class="abt">' + esc(tx('ui.absent', 'ausgefallen')) + '</span>';
    if (!n) return absent ? absentHtml : '';
    const nm = ((teamNames && teamNames[n]) || '').trim();
    const label = '<span class="t-line">Team ' + esc(n) + '</span>'
      + (nm ? '<span class="tnm t-nm">(' + esc(nm) + ')</span>' : '');
    return absent ? label + ' ' + absentHtml : label;
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
    const label = TC.refLabel(ref, ctx);
    if (!label) return '–';
    /* Herkunftstexte der Engine ("Sieger HF1") nur zur Anzeige übersetzen;
       Team-Referenzen tragen Nutzerdaten und bleiben unverändert. */
    return ref && typeof ref === 'object' && ref.k !== 'team' ? term(label) : label;
  }

  /* Turnierbaum-Spalten (Gewinner-/Verlierer-Runde, Grand Final …) als
     Spaltenraster – gemeinsames Markup fuer alle Bracket-Bögen (KO-System,
     Doppel-KO-System). rounds: [{title|label, matches:[{id,name,places,reset}]}] */
  function bracketColumnsHtml(rounds) {
    let html = '';
    (rounds || []).forEach(rd => {
      html += '<div class="brcol"><div class="brhead">' + esc(term(rd.title || rd.label || '')) + '</div>';
      (rd.matches || []).forEach(m => {
        const cls = 'brm' + (m.places ? ' is-p3' : '') + (m.reset ? ' is-reset' : '');
        html += '<div class="' + cls + '" data-br="' + esc(m.id) + '">'
          + '<div class="brname">' + esc(term(m.name || '')) + '</div>'
          + '<div class="brside" data-br-side="a"><span class="n"></span><span class="s"></span></div>'
          + '<div class="brside" data-br-side="b"><span class="n"></span><span class="s"></span></div>'
          + '</div>';
      });
      html += '</div>';
    });
    return html;
  }

  /* Traegt Teamnamen/Ergebnisse in ein per bracketColumnsHtml() erzeugtes
     Skelett ein. container: DOM-Element mit .brm-Kindern; matchById: {id:m}. */
  function paintBracketColumns(container, matchById, ctx) {
    if (!container) return;
    container.querySelectorAll('.brm').forEach(box => {
      const m = matchById[box.getAttribute('data-br')];
      if (!m) return;
      [['a', m.a, m.ta], ['b', m.b, m.tb]].forEach(pair => {
        const side = pair[0], ref = pair[1], team = pair[2];
        const el = box.querySelector('[data-br-side="' + side + '"]');
        if (!el) return;
        el.querySelector('.n').textContent = sideLabel(ref, team, ctx);
        const r = m.result;
        el.querySelector('.s').textContent = r ? String(side === 'a' ? r.aSets : r.bSets) : '';
        const won = m.bye != null ? (m.bye === team) : !!(r && r.winner === side);
        el.classList.toggle('is-win', won);
      });
    });
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
  function setColumnHtml(matchId, setNo, label, placeholder, names, target) {
    const ph = placeholder ? ' placeholder="' + esc(placeholder) + '"' : '';
    /* aria-label mit dem Teamnamen – sonst liest der Screenreader nur "Feld". */
    const inp = side => {
      const nm = names && names[side];
      return '<input class="score" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="3"' +
        ' data-mid="' + esc(matchId) + '" data-set="' + setNo + '" data-side="' + side + '"' +
        ' autocomplete="off"' + (nm ? ' aria-label="' + esc(nm) + '"' : '') + ph + '>';
    };
    /* OK-Knopf neben den beiden Kaestchen: nimmt auf Geraeten ohne Tab-Taste
       (iPad) den Fokus aus dem Feld und springt weiter - siehe
       spielplan-enh.js ([data-score-ok]-Handler, gilt fuer ALLE Turnierbogen).
       Nur am Bildschirm sichtbar (.noprint). */
    /* tabindex="-1": der Knopf soll NIE in der Tab-Reihenfolge auftauchen -
       Tab muss immer direkt vom linken ins rechte Kaestchen und von dort ins
       naechste Spiel springen, ohne hier "haengenzubleiben". */
    const okBtn = '<button type="button" class="score-ok noprint" data-score-ok tabindex="-1"'
      + ' aria-label="' + esc(tx('ui.score.okAria', 'Eingabe bestätigen und weiter')) + '"><svg class="bl-ic" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><polyline points="20 6 9 17 4 12"/></svg></button>';
    /* data-target: Satzziel für den Spiel-Timer (Satzgewinn-/Seitenwechsel). */
    return '<span class="sset" data-set="' + setNo + '"' + (target > 0 ? ' data-target="' + target + '"' : '') + '>'
      + '<span class="slbl">' + esc(label) + '</span>'
      + '<span class="sbox">' + inp('a') + '<span class="vs">:</span>' + inp('b') + okBtn + '</span>'
      + '</span>';
  }

  /* m: {id, a, b, round?, label?, places?}  a/b sind TeamRef oder Teamnummer */
  function matchCellHtml(m, ctx) {
    const setCnt = TC.modeDef(ctx.setMode).sets;
    const deciding = TC.hasDecidingSet(ctx.setMode);
    const ta = ctx.resolve(m.a), tb = ctx.resolve(m.b);
    const isBye = (m.a && m.a.k === 'bye') || (m.b && m.b.k === 'bye');

    const inputNames = { a: sideLabel(m.a, ta, ctx), b: sideLabel(m.b, tb, ctx) };
    const tgt = n => TC.targetForSet(ctx.setMode, n);
    let sets = setColumnHtml(m.id, 1, setCnt <= 1 ? tx('ui.score.points', 'Punkte')
      : tx('ui.score.setN', 'Satz {n}', { n: 1 }), null, inputNames, tgt(1));
    if (setCnt >= 2) sets += setColumnHtml(m.id, 2, tx('ui.score.setN', 'Satz {n}', { n: 2 }), null, inputNames, tgt(2));
    if (deciding) sets += setColumnHtml(m.id, 3, tx('ui.score.decider', 'Entsch.'), 'TB', inputNames, tgt(3));

    /* t-a/t-b richten die Namen nach aussen aus, .t-line haelt "Team 12"
       einzeilig – beides wie im Bogen "Alle gegen Alle".                     */
    const side = (cls, ref, team) =>
      '<span class="pside ' + cls + '">'
      + '<span class="t ' + (cls === 'pside-a' ? 't-a' : 't-b') + '" '
      + (team != null ? 'data-team="' + team + '"' : '') + '>'
      + cardNameHtml(ref, team, ctx) + '</span></span>';

    const extra = m.label ? '<span class="mnote-slot">' + esc(term(m.label)) + '</span>' : '';
    /* Nur EINE Beschriftung: ein sprechender Titel ("Spiel um Platz 3") ersetzt
       die technische Platzangabe, sonst stünde beides doppelt auf dem Bogen. */
    const places = (m.places && !m.label)
      ? '<span class="mnote-slot">' + esc(tx('ui.match.places', 'um Platz {places}', { places: m.places.join('/') }))
        + '</span>' : '';

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
        ? '<span class="bye-tag">' + esc(tx('ui.bye', 'Freilos')) + '</span>'
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
    if (note) note.innerHTML = dead ? '' : '<span class="mwin-note">' + esc(tx('ui.bye.walkover', '(kampflos)')) + '</span>';

    let html;
    if (dead) {
      html = '<span class="bye-tag">' + esc(tx('ui.bye.bothAbsent', 'beide Teams ausgefallen')) + '</span>';
    } else {
      const nameHtml = ctx.teamNameHtml ? ctx.teamNameHtml(winner) : esc(ctx.teamLabel(winner));
      const onLeft = !!td.querySelector('.pside-a [data-team="' + winner + '"]');
      const name = '<span class="t">' + nameHtml + '</span>';
      const tag = '<span class="bye-tag">' + esc(tx('ui.bye', 'Freilos')) + '</span>';
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
    /* ctx.allRounds: alle Runden, wenn der Plan slotweise gebaut wird (sonst aus slots).
       ctx.roundNav === false: keine Pfeile (Abschnitt ohne Runden-Filter). */
    const roundList = ctx.allRounds ? ctx.allRounds.slice() : [];
    if (!ctx.allRounds) slots.forEach(s => { if (roundList.indexOf(s.round) < 0) roundList.push(s.round); });
    const withNav = ctx.roundNav !== false;
    const chevron = pts => '<svg class="bl-ic" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><polyline points="' + pts + '"/></svg>';
    const navBtn = (dir, round, disabled) => {
      const label = dir === 'prev'
        ? tx('ui.round.prevAria', 'Zur vorherigen Runde springen')
        : tx('ui.round.nextAria', 'Zur nächsten Runde springen');
      return '<button type="button" class="nbtn rnav r' + dir + ' noprint"'
        + ' data-round-' + dir + '-from="' + round + '"'
        + (disabled ? ' disabled' : '')
        + ' aria-label="' + esc(label) + '" title="' + esc(label) + '">'
        + chevron(dir === 'prev' ? '15 18 9 12 15 6' : '9 18 15 12 9 6') + '</button>';
    };
    slots.forEach(s => {
      const title = slotTitle(s);
      const ri = roundList.indexOf(s.round);
      const confirmBtn = '<button type="button" class="nbtn rconfirm noprint"'
        + ' data-round-confirm="' + s.round + '"'
        + ' data-round-confirm-slot="' + s.slot + '"'
        + ' aria-label="' + esc(tx('ui.round.confirmAria', 'Aktuelles Feld validieren und zum nächsten Feld springen')) + '"'
        + ' title="' + esc(tx('ui.round.confirmTitle', 'Aktuelles Feld validieren und weiter')) + '"><svg class="bl-ic" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><polyline points="20 6 9 17 4 12"/></svg></button>';
      const byes = (s.byes && s.byes.length) ? s.byes : (s.bye != null ? [s.bye] : []);
      let meta = '<span class="rhead-meta">'
        + '<span class="rlabel">' + esc(title) + '</span>'
        + '<span class="rtime tt" data-slot="' + s.slot + '">'
        + (s.startMin != null ? esc(fmtTime(s.startMin) + '–' + fmtTime(s.endMin)) : '')
        + '</span>'
        + '<span class="rmode">' + esc(ctx.modeLabel || '') + '</span>';
      if (byes.length) {
        meta += '<span class="rbye">' + esc(tx('ui.round.sittingOut', 'spielfrei:')) + ' '
          + byes.map(t => '<span data-team="' + t + '">' + esc(ctx.teamLabel(t)) + '</span>').join(', ')
          + '</span>';
      }
      meta += '</span>';
      const head = '<td class="rhead-cell" colspan="' + nf + '">'
        + '<span class="rhead-content">'
        + meta
        + '<span class="rhead-actions">'
        + (withNav ? '<span class="rnav-group">' + navBtn('prev', s.round, ri <= 0)
          + '<span class="rnav-count">' + (ri + 1) + '/' + roundList.length + '</span>'
          + navBtn('next', s.round, ri >= roundList.length - 1) + '</span>' : '')
        + confirmBtn
        + '</span>'
        + '</span></td>';
      html += '<tr class="rgap" data-round="' + s.round + '" data-slot="' + s.slot + '" aria-hidden="true">'
        + '<td class="rgap-cell" colspan="' + nf + '"></td></tr>';
      html += '<tr class="rhead" data-round="' + s.round + '" data-slot="' + s.slot + '">' + head + '</tr>';

      let fhead = '<tr class="fhead" data-round="' + s.round + '" data-slot="' + s.slot + '">';
      for (let f = 0; f < nf; f++) {
        const fl = esc(ctx.fieldLabel(f));
        fhead += '<th scope="col" data-field="' + f + '"><span class="fhead-label">' + fl + '</span></th>';
      }
      html += fhead + '</tr>';

      html += '<tr class="rmatches" data-round="' + s.round + '" data-slot="' + s.slot + '">';
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
    if (note) note.textContent = res.draw ? tx('ui.match.drawNote', 'Unentschieden – je 1 Punkt') : '';
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
     dem Papier sichtbar ist, dass hier das Los entscheiden muss.

     Manuelle Korrektur ("Tabelle korrigieren"): opts.manual ist die Map
     { team: { place?, dPts?, dBd? } } aus TStore.getManualStandings(). Platz
     überschreibt den berechneten Wert direkt (Zeilen sortieren sich neu);
     dPts/dBd sind KORREKTUR-DELTAS, die auf den berechneten Wert addiert
     werden – sie bleiben also gültig, auch wenn sich Ergebnisse später noch
     ändern und neu gerechnet wird (siehe Rücksprache mit dem Nutzer).
     opts.editable schaltet die Eingabefelder frei; opts.tableKey nur nötig,
     wenn editable true ist (steht dann in data-mstd-key am <table>-Tag –
     das übernimmt der aufrufende Bogen selbst, hier nur die Zellen).        */
  function standingsTableHtml(ranked, ctx, opts) {
    const o = opts || {};
    const per = !!o.perGame;
    const editable = !!o.editable;
    const manual = o.manual || {};
    let rows = ranked.map((r, i) => {
      const ov = manual[r.team] || {};
      const dPts = Number(ov.dPts) || 0;
      const dBd = Number(ov.dBd) || 0;
      const hasPlace = ov.place != null && Number.isFinite(Number(ov.place));
      const overridePlace = hasPlace ? Number(ov.place) : null;
      const effPts = (per ? r.stat.ptsPer : r.stat.pts) + dPts;
      const effBd = (per ? r.stat.bdPer : r.stat.bd) + dBd;
      return { orig: r, i, team: r.team, dPts, dBd, hasPlace, overridePlace, effPts, effBd };
    });
    /* The displayed place shares ties on points and ball difference while
       preserving the ranking engine's order as the stable tie-breaker. */
    const recalculated = rows.slice().sort((a, b) =>
      (b.effPts - a.effPts) || (b.effBd - a.effBd) || (a.i - b.i));
    let place = 1;
    recalculated.forEach((row, i) => {
      if (i && (row.effPts !== recalculated[i - 1].effPts || row.effBd !== recalculated[i - 1].effBd)) {
        place = i + 1;
      }
      row.calcPlace = place;
    });
    rows.forEach(row => { row.place = row.hasPlace ? row.overridePlace : row.calcPlace; });
    const sortedRows = rows.slice().sort((a, b) => (a.place - b.place) || (a.i - b.i));
    sortedRows.forEach((row, i) => {
      const prev = sortedRows[i - 1], next = sortedRows[i + 1];
      row.shared = !!((prev && prev.place === row.place) || (next && next.place === row.place));
    });
    if (!editable) rows = sortedRows;

    const perSfx = per ? tx('ui.stand.perGame', '/Sp') : '';
    const deltaTitle = esc(tx('ui.manual.deltaTitle', 'Korrektur Δ – wird dauerhaft auf den berechneten Wert addiert'));
    let html = '<thead><tr>'
      + '<th class="pl">' + tx('ui.stand.place', 'Pl.') + '</th><th class="nm">' + tx('ui.stand.team', 'Team') + '</th>'
      + '<th>' + tx('ui.stand.games', 'Sp.') + '</th><th>' + tx('ui.stand.won', 'S') + '</th>'
      + (o.showDraw ? '<th>' + tx('ui.stand.drawn', 'U') + '</th>' : '') + '<th>' + tx('ui.stand.lost', 'N') + '</th>'
      + '<th>' + tx('ui.stand.pts', 'Pkt') + perSfx + '</th>'
      + '<th>' + tx('ui.stand.balls', 'Bälle') + '</th><th>' + tx('ui.stand.diff', 'Diff') + perSfx + '</th>'
      + (editable ? '<th class="mstd-actcol noprint"></th>' : '')
      + '</tr></thead><tbody>';

    rows.forEach(row => {
      const r = row.orig, s = r.stat;
      const basePts = per ? s.ptsPer : s.pts;
      const baseBd = per ? s.bdPer : s.bd;
      const effPts = basePts + row.dPts;
      const effBd = baseBd + row.dBd;
      const ptsDisp = per ? (Math.round(effPts * 100) / 100) : effPts;
      const bdDisp = per ? (Math.round(effBd * 100) / 100) : effBd;
      const teamHtml = ctx.teamNameHtml ? ctx.teamNameHtml(r.team) : esc(ctx.teamLabel(r.team));

      html += '<tr' + (row.shared ? ' class="is-tie"' : '') + ' data-team="' + r.team + '">';

      if (editable) {
        html += '<td class="pl mstd-cell' + (row.hasPlace ? ' is-manual' : '') + '">'
          + '<input type="number" min="1" class="mstd-in" data-field="place" value="' + row.place + '"></td>'
          + '<td class="nm">' + teamHtml + '</td>';
      } else {
        /* Einheitliches Rang-Badge (Top 3 mit Medaille); o.rankBadge:false
           schaltet auf die neutrale Platz-Pille zurück. o.isFinal steuert
           nur Tooltip/Klasse (Endplatzierung vs. laufend).
           o.placeOffset: Gesamtplatz = Tabellenplatz + Offset (z. B. bei
           Platzierungsblöcken: Block 2 spielt um Platz 4–6). */
        const placeBadge = o.rankBadge !== false
          ? rankBadgeHtml(row.place + (Number(o.placeOffset) || 0), { final: o.isFinal, shared: row.shared, manual: row.hasPlace,
              cls: 'screen-place' + (row.shared ? ' pz-tie' : '') })
          : '<span class="screen-place' + (row.shared ? ' pz-tie' : '') + '"'
            + ' title="' + esc(tx('ui.stand.placeTitle', 'Aktueller Platz: {place}', { place: row.place })
              + (row.shared ? tx('ui.rank.shared', ' (geteilt)') : '')
              + (row.hasPlace ? tx('ui.rank.manual', ' – manuell gesetzt') : '')) + '">'
            + row.place + '.' + (row.shared ? '=' : '') + '</span>';
        html += '<td class="pl' + (row.shared ? ' pz-tie' : '') + (row.hasPlace ? ' is-manual' : '') + '">'
          + row.place + '.' + (row.shared ? '=' : '') + '</td>'
          + '<td class="nm">' + teamHtml + placeBadge + '</td>';
      }

      html += '<td>' + s.games + '</td><td>' + s.won + '</td>'
        + (o.showDraw ? '<td>' + s.drawn + '</td>' : '')
        + '<td>' + s.lost + '</td>';

      if (editable) {
        html += '<td class="mstd-cell' + (row.dPts ? ' is-manual' : '') + '"><b>' + ptsDisp + '</b>'
          + '<input type="number" step="1" class="mstd-in mstd-delta" data-field="dPts" value="' + (row.dPts || '') + '" placeholder="±0" title="' + deltaTitle + '"></td>';
      } else {
        html += '<td><b>' + ptsDisp + '</b>' + manualDeltaBadge(tx('ui.manual.pts', 'Punkte'), row.dPts) + '</td>';
      }

      html += '<td>' + s.ballsFor + ':' + s.ballsAgainst + '</td>';

      if (editable) {
        html += '<td class="mstd-cell' + (row.dBd ? ' is-manual' : '') + '">' + fmtDiff(bdDisp)
          + '<input type="number" step="1" class="mstd-in mstd-delta" data-field="dBd" value="' + (row.dBd || '') + '" placeholder="±0" title="' + deltaTitle + '"></td>';
      } else {
        html += '<td class="' + (effBd > 0 ? 'pos' : effBd < 0 ? 'neg' : '') + '">' + fmtDiff(bdDisp) + manualDeltaBadge(tx('ui.manual.bd', 'Ball-Differenz'), row.dBd) + '</td>';
      }

      if (editable) {
        const hasAny = row.hasPlace || row.dPts || row.dBd;
        html += '<td class="mstd-actcol noprint">' + (hasAny
          ? '<button type="button" class="mstd-reset-row" data-team="' + r.team + '" title="'
            + esc(tx('ui.manual.resetRowTitle', 'Korrektur für dieses Team zurücksetzen')) + '"><svg class="bl-ic" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg></button>'
          : '') + '</td>';
      }
      html += '</tr>';
    });
    return html + '</tbody>';
  }

  /* Rang-Badge – einheitlich in allen Bögen (Klassen in spielplan.css):
     Platz als Pille, Platz 1–3 schon während des Turniers mit Medaille und
     Gold/Silber/Bronze hervorgehoben.
     o.final  – true: Endplatzierung, false: laufender Platz, undefined: neutral
     o.prefix – Text vor der Zahl (z. B. Gruppenbuchstabe „A“)
     o.shared – geteilter Platz („=“ dahinter)
     o.cls    – zusätzliche Klassen (z. B. screen-place)                    */
  const RANK_MEDALS = { 1: '\u{1F947}', 2: '\u{1F948}', 3: '\u{1F949}' };
  function rankBadgeHtml(place, o) {
    o = o || {};
    const extra = o.cls ? ' ' + o.cls : '';
    if (place == null || !Number.isFinite(Number(place))) {
      return '<span class="rank-badge rank-none' + extra + '">–</span>';
    }
    const p = Number(place);
    const fin = o.final === true;
    const topCls = p >= 1 && p <= 3 ? ' rank-top rank-' + p : '';
    const medal = RANK_MEDALS[p] ? RANK_MEDALS[p] + ' ' : '';
    const label = (o.prefix || '') + p + '.' + (o.shared ? '=' : '');
    const kind = o.title || (fin ? tx('ui.rank.final', 'Endplatzierung')
      : o.final === false ? tx('ui.rank.live', 'Aktueller Platz (laufend)') : tx('ui.rank.place', 'Platz'));
    const title = kind + ': ' + label
      + (o.shared ? tx('ui.rank.shared', ' (geteilt)') : '') + (o.manual ? tx('ui.rank.manual', ' – manuell gesetzt') : '');
    return '<span class="rank-badge ' + (fin ? 'rank-final' : 'rank-live') + topCls + extra
      + '" title="' + esc(title) + '">' + medal + esc(label) + '</span>';
  }

  /* Kleines "Δ"-Zeichen mit Tooltip neben Pkt/Diff, wenn dort eine manuelle
     Korrektur eingerechnet ist – auch im Ausdruck sichtbar (kein noprint),
     damit auf dem Papierbogen erkennbar bleibt, dass hier korrigiert wurde. */
  function manualDeltaBadge(label, delta) {
    if (!delta) return '';
    const sign = delta > 0 ? '+' : '';
    return ' <sup class="mstd-badge" title="'
      + tx('ui.manual.badge', 'Manuelle Korrektur {label}: {delta}', { label: label, delta: sign + delta }) + '">Δ</sup>';
  }

  /* ================================================ 5a. PLATZIERUNGSLISTE
     Für Endstände, die nicht über Punkte/Bälle sondern direkt aus dem
     Turnierverlauf abgeleitet werden (KO-System, Gesamt-Endstand Gruppen +
     Finalrunde): Spalten Pl. / Team / "entschieden durch". Manuelle
     Korrektur wie bei standingsTableHtml: place überschreibt (+Neusortierung
     der Zeilen), source überschreibt den Text in "entschieden durch".       */
  function placeListHtml(placements, ctx, opts) {
    const o = opts || {};
    const editable = !!o.editable;
    const manual = o.manual || {};
    let rows = (placements || []).map((p, i) => {
      const ov = (p.team != null && manual[p.team]) || {};
      const hasPlace = ov.place != null && Number.isFinite(Number(ov.place));
      const place = hasPlace ? Number(ov.place) : p.place;
      const hasSource = ov.source != null && ov.source !== '';
      const source = hasSource ? ov.source : term(p.source || '');
      return { p, i, place, hasPlace, hasSource, source };
    });
    /* Im Bearbeiten-Modus bleibt die Zeilenreihenfolge stehen (nur der Platz-
       Wert im Feld aktualisiert sich schon) – erst nach "Fertig" wird nach
       dem (ggf. korrigierten) Platz neu sortiert, damit Zeilen nicht schon
       waehrend der Eingabe springen. */
    if (!editable) rows.sort((a, b) => (a.place - b.place) || (a.i - b.i));

    let html = '';
    rows.forEach(row => {
      const p = row.p;
      const placeLabel = row.hasPlace ? (row.place + '.') : (p.rangeLabel ? term(p.rangeLabel) : (p.place + '.'));
      const teamHtml = p.team != null
        ? (ctx && ctx.teamNameHtml ? ctx.teamNameHtml(p.team) : esc(ctx ? ctx.teamLabel(p.team) : String(p.team)))
        : '&nbsp;';
      html += '<tr' + (p.team != null ? ' data-team="' + p.team + '"' : '') + '>';
      if (editable) {
        html += '<td class="pl mstd-cell' + (row.hasPlace ? ' is-manual' : '') + '">'
          + '<input type="number" min="1" class="mstd-in" data-field="place" value="' + row.place + '"></td>'
          + '<td class="nm">' + teamHtml + '</td>'
          + '<td class="src mstd-cell' + (row.hasSource ? ' is-manual' : '') + '">'
          + '<input type="text" class="mstd-in mstd-text" data-field="source" value="' + esc(row.source) + '">'
          + (p.team != null && (row.hasPlace || row.hasSource)
              ? ' <button type="button" class="mstd-reset-row" data-team="' + p.team + '" title="'
                + esc(tx('ui.manual.resetRow', 'Zurücksetzen')) + '"><svg class="bl-ic" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg></button>'
              : '')
          + '</td>';
      } else {
        const plHtml = o.rankBadge !== false && p.team != null && !p.rangeLabel
          ? rankBadgeHtml(row.place, { final: o.isFinal, manual: row.hasPlace })
          : esc(placeLabel);
        html += '<td class="pl' + (row.hasPlace ? ' is-manual' : '') + '">' + plHtml + '</td>'
          + '<td class="nm">' + teamHtml + '</td>'
          + '<td class="src' + (row.hasSource ? ' is-manual' : '') + '">' + esc(row.source) + '</td>';
      }
      html += '</tr>';
    });
    return html;
  }

  /* ===================================================== 5b. MANUELLE-
     KORREKTUR-STEUERUNG. Verdrahtet die "Tabelle korrigieren"-Buttons und
     Eingabefelder EINMAL pro Seite (Event-Delegation), unabhängig davon wie
     oft/welche Tabellen anschließend neu gezeichnet werden. Tabellen werden
     über das Attribut data-mstd-key="<tableKey>" am <table>-Element
     identifiziert (das setzt der aufrufende Bogen beim Rendern selbst).
     Der Bearbeiten-Status ist reine Laufzeit-UI (nicht persistiert) – nach
     einem Reload starten alle Tabellen wieder im Anzeige-Modus.
       store = { get(): Turnier, save(t): void, repaint(): void }           */
  function initManualEditing(root, store) {
    const editing = new Set();
    const isEditing = key => editing.has(key);
    const toolbarHtml = key => {
      const on = editing.has(key);
      return '<span class="mstd-toolbar noprint">'
        + '<button type="button" class="mstd-toggle" data-mstd-toggle="' + esc(key) + '">'
        + esc(on ? tx('ui.manual.done', 'Fertig') : tx('ui.manual.edit', 'Tabelle korrigieren')) + '</button>'
        + (on ? ' <button type="button" class="mstd-reset-all" data-mstd-reset="' + esc(key) + '">'
          + esc(tx('ui.manual.resetAll', 'Korrekturen zurücksetzen')) + '</button>' : '')
        + '</span>';
    };
    root.addEventListener('click', e => {
      const tog = e.target.closest('[data-mstd-toggle]');
      if (tog) {
        const key = tog.getAttribute('data-mstd-toggle');
        if (editing.has(key)) editing.delete(key); else editing.add(key);
        store.repaint();
        return;
      }
      const rst = e.target.closest('[data-mstd-reset]');
      if (rst) {
        const key = rst.getAttribute('data-mstd-reset');
        const t = store.get();
        TStore.resetManualStandings(t, key);
        TStore.resetManualPlacements(t, key);
        store.save(t);
        store.repaint();
        return;
      }
      const rstRow = e.target.closest('.mstd-reset-row');
      if (rstRow) {
        const tbl = rstRow.closest('table[data-mstd-key]');
        const key = tbl && tbl.getAttribute('data-mstd-key');
        const team = rstRow.getAttribute('data-team');
        if (key && team !== null && team !== '') {
          const t = store.get();
          TStore.resetManualStandingRow(t, key, +team);
          TStore.resetManualPlacementRow(t, key, +team);
          store.save(t);
          store.repaint();
        }
      }
    });
    root.addEventListener('change', e => {
      const inp = e.target.closest('.mstd-in');
      if (!inp) return;
      const tbl = inp.closest('table[data-mstd-key]');
      const key = tbl && tbl.getAttribute('data-mstd-key');
      const tr = inp.closest('tr[data-team]');
      const team = tr && tr.getAttribute('data-team');
      const field = inp.getAttribute('data-field');
      if (!key || team == null || team === '' || !field) return;
      const t = store.get();
      if (field === 'source') {
        TStore.setManualPlacement(t, key, +team, 'source', inp.value);
      } else if (field === 'place' && tbl.classList.contains('placelist')) {
        TStore.setManualPlacement(t, key, +team, 'place', inp.value);
      } else {
        TStore.setManualStanding(t, key, +team, field, inp.value);
      }
      store.save(t);
      store.repaint();
    });
    return { isEditing, toolbarHtml };
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
    const screen = tx('ui.hint.screen', 'So trägst du ein: {sets}'
      + 'linkes Kästchen = linkes Team, rechtes Kästchen = rechtes Team. '
      + 'Nur Zahlen; mit „:“ oder Enter springst du ins nächste Kästchen. '
      + 'Der Sieger wird hervorgehoben.', { sets: sets })
      + add(o.screenAdd);
    const print = tx('ui.hint.print', 'So ausfüllen: {sets}'
      + 'linkes Kästchen = linkes Team, rechtes Kästchen = rechtes Team. '
      + 'Satzergebnis direkt nach dem Spiel mit dem Stift eintragen und den Namen des Siegers einkreisen.', { sets: sets })
      + add(o.printAdd);
    return hintHtml(screen, print);
  }

  /* Erklärt über der Tabelle, wonach gewertet wurde – auch im Ausdruck. */
  function criteriaHint(criteria) {
    const names = { pts: tx('ui.criteria.pts', 'Punkte'), ptsPer: tx('ui.criteria.ptsPer', 'Punkte je Spiel'),
      bd: tx('ui.criteria.bd', 'Ball-Differenz'), bdPer: tx('ui.criteria.bdPer', 'Ball-Differenz je Spiel'),
      h2h: tx('ui.criteria.h2h', 'direkter Vergleich'),
      ballsFor: tx('ui.criteria.ballsFor', 'erzielte Bälle'), ballsForPer: tx('ui.criteria.ballsForPer', 'erzielte Bälle je Spiel') };
    return tx('ui.criteria.hint', 'Reihenfolge bei Gleichstand: {list} → Losentscheid. Ein „=“ hinter dem Platz bedeutet: hier entscheidet das Los.',
      { list: criteria.map(c => names[c] || c).join(' → ') });
  }

  /* ================================================== 6. LAUFENDE TABELLE
     Kumulierte Punkte/Differenz je Runde – die Spalte, die vor Ort mit dem
     Stift fortgeschrieben wird. Die blaue Musterzeile bleibt erhalten.       */
  function trackTableHtml(teams, roundCount, ctx, opts) {
    const o = opts || {};
    const ptsLabel = o.ptsLabel || tx('ui.track.pts', 'Punkte');
    const bdLabel = tx('ui.track.bd', 'Ball-Differenz');
    const winPts = o.winPts || 1; // Punkte je Sieg (für Musterzeile)
    let html = '<thead><tr><th class="tname teamcol">' + tx('ui.track.team', 'Team / Name') + '</th><th class="lbl">'
      + tx('ui.track.cumulative', 'kumuliert') + '</th>';
    for (let r = 1; r <= roundCount; r++) html += '<th>R' + r + '</th>';
    html += '<th class="mstd-actcol noprint">' + tx('ui.track.corr', 'Korr.') + '</th><th class="pos">' + tx('ui.track.place', 'Platz') + '</th>'
      + '<th class="mstd-actcol mstd-rowact noprint"></th></tr></thead><tbody>';
    /* Beispielzeile – zeigt wie man die Tabelle ausfüllt */
    let pEx = 0, bdEx = 0;
    const ptsEx = [], bdExArr = [];
    for (let i = 0; i < roundCount; i++) {
      if (i % 3 !== 1 || i === 0) pEx += winPts; ptsEx.push(pEx);
      bdEx += (i % 4 === 1 ? -3 : 4); bdExArr.push(bdEx);
    }
    html += '<tr class="grp ex ex-start"><td class="tname teamcol" rowspan="2">'
      + '<span class="ex-badge">' + tx('ui.track.example', 'Beispiel') + '</span>'
      + '<span class="t-line">Team X</span><span class="tnm t-nm">' + tx('ui.track.teamName', '(Teamname)') + '</span>'
      + '</td><td class="lbl">' + ptsLabel + '</td>';
    ptsEx.forEach(v => html += '<td>' + v + '</td>');
    html += '<td class="mstd-actcol noprint"></td><td class="pos" rowspan="2">3.</td>'
      + '<td class="mstd-actcol mstd-rowact noprint" rowspan="2"></td></tr>';
    html += '<tr class="ex ex-end"><td class="lbl">' + bdLabel + '</td>';
    bdExArr.forEach(v => html += '<td>' + (v > 0 ? '+' : '') + v + '</td>');
    html += '<td class="mstd-actcol noprint"></td></tr>';
    /* Team-Zeilen */
    teams.forEach(t => {
      html += '<tr class="grp" data-team="' + t + '" data-line="pts">'
        + '<td class="tname teamcol" rowspan="2" data-team-name="' + t + '"><span class="t-line">Team ' + esc(t) + '</span></td>'
        + '<td class="lbl">' + ptsLabel + '</td>';
      for (let r = 1; r <= roundCount; r++) html += '<td class="rcell" data-round="' + r + '"></td>';
      html += '<td class="mstd-cell noprint" data-corr="dPts"></td>'
        + '<td class="pos" rowspan="2" data-pos></td>'
        + '<td class="mstd-actcol mstd-rowact noprint" rowspan="2" data-actcol></td></tr>';
      html += '<tr data-team="' + t + '" data-line="bd"><td class="lbl">' + bdLabel + '</td>';
      for (let r = 1; r <= roundCount; r++) html += '<td class="rcell" data-round="' + r + '"></td>';
      html += '<td class="mstd-cell noprint" data-corr="dBd"></td></tr>';
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
  /* Papierkorb-Button „Team endgültig löschen“ – gleiche Funktion im
     Teamnamen- und im Ausfall-Panel (Bogen delegiert [data-remove-team]). */
  function teamDelBtnHtml(t, label, canRemove) {
    return '<button type="button" class="team-del" data-remove-team="' + t + '"'
      + (canRemove ? '' : ' disabled')
      + ' title="' + esc(canRemove ? tx('ui.team.deleteTitle', 'Team endgültig löschen')
        : tx('ui.team.deleteMin', 'Mindestanzahl an Teams erreicht'))
      + '" aria-label="' + esc(tx('ui.team.deleteAria', '{label} löschen', { label: label })) + '">'
      + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>'
      + '</button>';
  }
  function namePanelHtml(teams, teamNames, opts) {
    const o = opts || {};
    const canRemove = o.removable && (o.minTeams == null || teams.length > o.minTeams);
    return teams.map(t => {
      const row = '<label class="nrow"><span class="nnum">' + t + '</span>'
        + '<input type="text" data-name-input="' + t + '" value="' + esc(teamNames[t] || '')
        + '" placeholder="Team ' + t + '" autocomplete="off" spellcheck="false"></label>';
      if (!o.removable) return row;
      return '<div class="nrow-del">' + row
        + teamDelBtnHtml(t, teamNames[t] || ('Team ' + t), canRemove) + '</div>';
    }).join('');
  }
  function fieldPanelHtml(count, fieldNames) {
    let html = '';
    for (let f = 0; f < count; f++) {
      html += '<label class="nrow"><span class="nnum">' + (f + 1) + '</span>'
        + '<input type="text" data-field-input="' + f + '" value="' + esc(fieldNames[f] || '')
        + '" placeholder="' + esc(tx('ui.field.n', 'Feld {n}', { n: f + 1 })) + '" autocomplete="off" spellcheck="false"></label>';
    }
    return html;
  }
  function absentPanelHtml(teams, absent, ctx, opts) {
    const set = new Set(absent || []);
    const o = opts || {};
    const canRemove = o.removable && (o.minTeams == null || teams.length > o.minTeams);
    return teams.map(t => {
      const chk = '<label class="chk"><input type="checkbox" data-absent-input="' + t + '"'
        + (set.has(t) ? ' checked' : '') + '> ' + esc(ctx.teamLabel(t)) + '</label>';
      if (!o.removable) return chk;
      return '<div class="absent-row">' + chk
        + teamDelBtnHtml(t, ctx.teamLabel(t), canRemove) + '</div>';
    }).join('');
  }
  /* Rückfrage vor dem endgültigen Löschen eines Teams. */
  function confirmRemoveTeam(label, o) {
    o = o || {};
    let msg = tx('ui.team.confirmRemove', '„{label}“ endgültig aus dem Turnier löschen?\n\n'
      + 'Alle nachfolgenden Teams rücken eine Nummer nach vorn', { label: label });
    msg += o.hasResults
      ? tx('ui.team.confirmRemoveResults', ', der Spielplan wird neu erstellt. Ergebnisse von Begegnungen, die es weiterhin gibt, bleiben erhalten; Spiele mit diesem Team entfallen.')
      : tx('ui.team.confirmRemoveNoResults', ' und der Spielplan wird neu erstellt.');
    if (o.extra) msg += '\n\n' + o.extra;
    msg += '\n\n' + tx('ui.team.confirmRemoveTip', 'Tipp: Soll das Team nur pausieren, stattdessen „ausgefallen“ ankreuzen.');
    return (typeof confirm === 'function') ? confirm(msg) : true;
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

    let opts = '<option value="all"' + (cur === 'all' ? ' selected' : '') + '>'
      + esc(tx('ui.roundbar.allRounds', 'Alle Runden')) + '</option>';
    rounds.forEach(r => {
      opts += '<option value="' + r + '"' + (cur === String(r) ? ' selected' : '')
        + '>' + esc(tx('ui.round.n', 'Runde {n}', { n: r })) + '</option>';
    });

    const state = cur === 'all'
      ? tx('ui.roundbar.allVisible', { one: 'Alle {count} Runde sichtbar', other: 'Alle {count} Runden sichtbar' },
        { count: rounds.length })
      : tx('ui.roundbar.current', 'Runde {n} von {total}', { n: cur, total: rounds.length });

    const allActive = cur === 'all';
    const ICON_LAYERS = '<svg class="nico" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2l9 5-9 5-9-5 9-5z"/><path d="M3 12l9 5 9-5"/><path d="M3 17l9 5 9-5"/></svg>';
    return '<label>' + esc(tx('ui.round.word', 'Runde')) + '<select data-round-select>' + opts + '</select></label>'
      + '<button type="button" class="nbtn nbtn-round nbtn-round-prev" data-round-step="-1"'
      + (atFirst ? ' disabled' : '') + ' aria-label="' + esc(tx('ui.roundbar.prevAria', 'Vorherige Runde')) + '">'
      + '<span class="chev chev-left" aria-hidden="true"></span> <span class="nbtn-round-txt">' + esc(tx('ui.roundbar.prev', 'Zurück')) + '</span></button>'
      + '<button type="button" class="nbtn nbtn-round nbtn-round-next" data-round-step="1"'
      + (atLast ? ' disabled' : '') + ' aria-label="' + esc(tx('ui.roundbar.nextAria', 'Nächste Runde')) + '">'
      + '<span class="nbtn-round-txt">' + esc(tx('ui.roundbar.next', 'Weiter')) + '</span> <span class="chev chev-right" aria-hidden="true"></span></button>'
      + '<button type="button" class="nbtn nbtn-round nbtn-round-all'
        + (allActive ? ' roundall-active' : '') + '" data-round-all'
        + ' aria-pressed="' + allActive + '"'
        + ' title="' + esc(tx('ui.roundbar.allTitle', 'Alle Runden gleichzeitig anzeigen')) + '">'
        + ICON_LAYERS + ' ' + esc(allActive ? tx('ui.roundbar.single', 'Einzelne Runde') : tx('ui.roundbar.allRounds', 'Alle Runden'))
        + '</button>'
      + '<span class="state" aria-live="polite">' + esc(state) + '</span>';
  }

  /* Ermittelt die letzte Runde mit mindestens einem eingetragenen Ergebnis
     (Standard-Form: slots[].matches[].id + results[id] = Array von Saetzen
     [[a,b],...]). Wird beim Wechsel von "Alle Runden" in die Einzelansicht
     genutzt, damit dort fortgesetzt wird, wo zuletzt eingetragen wurde,
     statt immer bei Runde 1 zu beginnen. Liefert null, wenn nichts
     eingetragen ist (dann bleibt es beim bisherigen Sprung zu Runde 1).      */
  function lastFilledRound(slots, results) {
    if (!results) return null;
    let best = null;
    (slots || []).forEach(s => {
      const filled = (s.matches || []).some(m => {
        if (!m || m.id == null) return false;
        const sets = results[m.id];
        return !!(sets && sets.some(set => set && (set[0] != null || set[1] != null)));
      });
      if (filled && (best == null || s.round > best)) best = s.round;
    });
    return best;
  }

  /* Liefert den Filterwert, der sich aus einem Klick/Wechsel im Navigator
     ergibt – oder null, wenn das Ereignis den Navigator nicht betrifft.
     lastFilled (optional): Rundennummer, zu der beim Verlassen von "Alle
     Runden" gesprungen werden soll (siehe lastFilledRound()); ohne Angabe
     bzw. ohne Treffer bleibt es bei Runde 1.                                 */
  function roundBarValue(ev, slots, active, lastFilled) {
    const el = ev.target;
    if (!el || !el.getAttribute) return null;
    if (el.hasAttribute('data-round-select')) {
      /* click = Nutzer öffnet Dropdown → nicht eingreifen; nur change auswerten */
      if (ev.type === 'click') return null;
      return el.value;
    }
    const allBtn = el.closest ? el.closest('[data-round-all]') : null;
    if (allBtn && (allBtn.hasAttribute ? allBtn.hasAttribute('data-round-all') : false)) {
      if (String(active) !== 'all') return 'all';
      return String(lastFilled != null ? lastFilled : 1);
    }
    /* Pfeile im Rundenkopf: relativ zur Runde, in der sie stehen – auch in "Alle Runden". */
    const fromBtn = el.closest ? el.closest('[data-round-next-from],[data-round-prev-from]') : null;
    const isPrev = !!(fromBtn && fromBtn.hasAttribute && fromBtn.hasAttribute('data-round-prev-from'));
    const isNext = !!(fromBtn && fromBtn.hasAttribute && fromBtn.hasAttribute('data-round-next-from'));
    if (isPrev || isNext) {
      if (fromBtn.disabled) return null;
      const roundsFrom = [];
      slots.forEach(s => { if (roundsFrom.indexOf(s.round) < 0) roundsFrom.push(s.round); });
      const from = parseInt(fromBtn.getAttribute(isPrev ? 'data-round-prev-from' : 'data-round-next-from'), 10);
      const iTo = roundsFrom.indexOf(from) + (isPrev ? -1 : 1);
      if (roundsFrom.indexOf(from) < 0 || iTo < 0 || iTo >= roundsFrom.length) return null;
      return String(roundsFrom[iTo]);
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

  function wireFormatInfo(doc) {
    if (!doc || doc.__formatInfoWired) return;
    doc.__formatInfoWired = true;
    doc.addEventListener('click', event => {
      const button = event.target.closest ? event.target.closest('[data-format-info-toggle]') : null;
      if (!button) return;
      const content = doc.getElementById(button.getAttribute('aria-controls'));
      if (!content) return;
      const expanded = button.getAttribute('aria-expanded') === 'true';
      button.setAttribute('aria-expanded', String(!expanded));
      content.hidden = expanded;
      const label = button.querySelector('.format-info-toggle-label');
      if (label) label.textContent = tx(expanded ? 'ui.format.details' : 'ui.format.hide',
        expanded ? 'Wertung & Details anzeigen' : 'Wertung & Details ausblenden');
    });
  }

  function syncModeSummary(doc) {
    if (!doc) return;
    const legend = doc.getElementById('h-legend');
    const summary = doc.getElementById('modeSummary');
    if (legend && summary) summary.innerHTML = legend.innerHTML;
  }

  /* ============================================ 8b. WERTUNG UND TIE-BREAKER
     Beide Tabellen werden aus der Engine abgeleitet, damit der gedruckte
     Bogen nie eine andere Wertung behauptet als die, nach der gerechnet wird
     (AGENTS.md §4). Unentschieden erscheint nur, wenn es der Satzmodus
     ueberhaupt zulaesst.                                                     */
  function scoringTablesHtml(setMode, criteria) {
    const drawPossible = TC.isMulti(setMode) && !TC.hasDecidingSet(setMode);
    let w = '<table><caption>' + tx('ui.scoring.caption', 'Wertung pro Spiel') + '</caption>'
      + '<tr><th>' + tx('ui.scoring.result', 'Ergebnis') + '</th><th>' + tx('ui.scoring.value', 'Wertung') + '</th></tr>'
      + '<tr><td>' + tx('ui.scoring.win', 'Sieg') + '</td><td>' + tx('ui.scoring.pts', { one: '{count} Punkt', other: '{count} Punkte' }, { count: TC.WIN_PTS }) + '</td></tr>';
    if (drawPossible) w += '<tr><td>' + tx('ui.scoring.draw', 'Unentschieden') + '</td><td>' + tx('ui.scoring.pts', { one: '{count} Punkt', other: '{count} Punkte' }, { count: TC.DRAW_PTS }) + '</td></tr>';
    w += '<tr><td>' + tx('ui.scoring.loss', 'Niederlage') + '</td><td>' + tx('ui.scoring.pts', { one: '{count} Punkt', other: '{count} Punkte' }, { count: TC.LOSS_PTS }) + '</td></tr>'
      + '<tr><td>' + tx('ui.scoring.bye', 'Freilos / spielfrei') + '</td><td>' + tx('ui.scoring.byePts', '{count} Punkte, ohne Ball-Differenz', { count: TC.WIN_PTS }) + '</td></tr>'
      + '</table>';

    const names = { pts: tx('ui.criteria.pts', 'Punkte'), ptsPer: tx('ui.criteria.ptsPer', 'Punkte je Spiel'),
      bd: tx('ui.criteria.bd', 'Ball-Differenz'), bdPer: tx('ui.criteria.bdPer', 'Ball-Differenz je Spiel'),
      h2h: tx('ui.criteria.h2h', 'direkter Vergleich'),
      ballsFor: tx('ui.scoring.ballsFor', 'erzielte Ballpunkte'), ballsForPer: tx('ui.scoring.ballsForPer', 'erzielte Ballpunkte je Spiel') };
    const chain = (criteria || ['pts', 'bd', 'ballsFor', 'h2h']).slice();
    let t = '<table><caption>' + tx('ui.scoring.tieCaption', 'Reihenfolge bei Gleichstand') + '</caption>'
      + '<tr><th>' + tx('ui.scoring.rank', 'Rang') + '</th><th>' + tx('ui.scoring.criterion', 'Kriterium') + '</th></tr>';
    chain.forEach((c, i) => {
      t += '<tr><td>' + (i + 1) + '</td><td>' + esc(names[c] || c) + '</td></tr>';
    });
    t += '<tr><td>' + (chain.length + 1) + '</td><td>' + tx('ui.scoring.lots', 'Losentscheid («=» in der Tabelle)') + '</td></tr></table>';

    return '<div class="row"><div style="flex:0 0 46%">' + w + '</div><div class="grow">' + t + '</div></div>';
  }

  /* =========================================== 8c. MOBILE SPRUNGLEISTE
     Auf dem Handy ist der Bogen laenger als der Bildschirm; ohne die Leiste
     scrollt man waehrend des Turniers minutenlang.                           */
  function jumpBarHtml(targets) {
    const t = targets || {};
    const ico = body => '<svg class="bl-ic" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + body + '</svg>';
    const icons = {
      setup: '<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/><circle cx="12" cy="12" r="3"/>',
      guide: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
      schedule: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4M12 16h4M8 11h.01M8 16h.01"/>',
      standings: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2z"/>',
      print: '<polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>'
    };
    const btn = (id, key, label) => id
      ? '<button type="button" class="nbtn" data-jump="' + esc(id) + '">' + ico(icons[key]) + '<span>' + esc(label) + '</span></button>'
      : '';
    return btn(t.setup || 'configSection', 'setup', tx('ui.jump.setup', 'Setup'))
      + btn(t.guide || 'guideContainer', 'guide', tx('ui.jump.guide', 'Anleitung'))
      + btn(t.schedule || 'scheduleSection', 'schedule', tx('ui.jump.schedule', 'Spielplan'))
      + btn(t.standings || 'standingsSection', 'standings', tx('ui.jump.standings', 'Tabelle'))
      + '<button type="button" class="nbtn" data-jump-print>' + ico(icons.print) + '<span>' + esc(tx('ui.jump.print', 'Drucken')) + '</span></button>';
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
      .filter(i => !i.disabled && (i.offsetParent !== null || i.closest('td') === null));
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
      if (jump) focusNext(el, fields(), fields);
    });
    rootEl.addEventListener('keydown', e => {
      const el = e.target;
      if (!el.classList || !el.classList.contains('score')) return;
      if (e.key === 'Enter') { e.preventDefault(); focusNext(el, fields(), fields); }
      if (e.key === 'Tab') {
        const list = fields();
        const moved = e.shiftKey ? focusPrev(el, list, fields) : focusNext(el, list, fields);
        if (moved) e.preventDefault();
      }
    });
    /* Komfort: Wird nur der Verlierer-Wert eingetragen, füllt sich die
       Gegenseite mit dem Satzziel. Ein manuell eingetragener Wert bleibt
       stehen – erkennbar am fehlenden data-bl-auto-Attribut (wird bei jeder
       echten Nutzereingabe in spielplan-enh.js entfernt). Wird das
       Verlierer-Feld wieder geleert/ungültig, nehmen wir eine rein
       automatisch gesetzte Gegenseite auch wieder zurück – sonst bleibt ein
       "Geisterergebnis" stehen und blockiert die nächste
       Autovervollständigung dauerhaft. Ersetzt die ID-basierte Logik aus
       form-flow.js, die mit data-Attributen nicht greift.                    */
    rootEl.addEventListener('change', e => {
      const el = e.target;
      if (!el.classList || !el.classList.contains('score') || el.disabled) return;
      if (!onChange.setMode) return;
      const setNo = +el.getAttribute('data-set');
      const target = TC.targetForSet(onChange.setMode(), setNo);
      const other = el.getAttribute('data-side') === 'a' ? 'b' : 'a';
      const p = rootEl.querySelector('input.score[data-mid="' + el.getAttribute('data-mid')
        + '"][data-set="' + setNo + '"][data-side="' + other + '"]');
      if (!p || p.disabled) return;
      const raw = String(el.value || '').trim();
      const v = parseInt(raw, 10);
      const isLoserValue = /^\d+$/.test(raw) && v >= 0 && v <= target - 2;
      if (isLoserValue) {
        if (String(p.value || '').trim() !== '' && p.getAttribute('data-bl-auto') !== '1') return;
        if (p.value !== String(target)) {
          p.value = String(target);
          onChange(p.getAttribute('data-mid'), setNo, other, p.value);
        }
        p.setAttribute('data-bl-auto', '1');
      } else if (p.getAttribute('data-bl-auto') === '1' && String(p.value || '').trim() !== '') {
        p.value = '';
        p.removeAttribute('data-bl-auto');
        onChange(p.getAttribute('data-mid'), setNo, other, p.value);
      }
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
  /* Sprung zum Nachbar-Kaestchen (dir = +1/-1). Das aktuelle Feld wird ZUERST
     per blur() verlassen: Das loest das native "change" (Auto-Vervollstaendigung)
     aus, und das kann im Schweizer System einen kompletten Neuaufbau des
     Spielplans nach sich ziehen (neue Paarungs-Vorschau). Wuerde man direkt
     den alten Nachbarn fokussieren, liefe der Neuaufbau mitten im Fokuswechsel
     und der Fokus landete auf einem inzwischen entfernten Knoten -> Tab sprang
     an den Seitenanfang. Deshalb Anker ueber data-mid/-set/-side NEU aus dem
     (ggf. frisch gebauten) DOM holen - wie beim OK-Knopf in spielplan-enh.js. */
  function scoreSig(el) {
    const mid = el.getAttribute('data-mid');
    return mid == null ? null
      : 'input.score[data-mid="' + mid + '"][data-set="' + el.getAttribute('data-set')
        + '"][data-side="' + el.getAttribute('data-side') + '"]';
  }
  function focusStep(el, list, dir, fresh) {
    if (!el.isConnected && scoreSig(el)) el = document.querySelector(scoreSig(el)) || el;
    const i = list.indexOf(el);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return false;
    const sig = fresh ? scoreSig(el) : null;
    if (!sig) {
      list[j].focus();
      list[j].select();
      return true;
    }
    el.blur();
    const now = fresh();
    const anchor = el.isConnected ? el : document.querySelector(sig);
    const k = anchor ? now.indexOf(anchor) : -1;
    const target = k >= 0 ? now[k + dir] : list[j].isConnected ? list[j] : null;
    if (target) {
      target.focus();
      target.select();
    } else if (anchor) {
      anchor.focus();
    }
    return true;
  }
  function focusNext(el, list, fresh) { return focusStep(el, list, 1, fresh); }
  function focusPrev(el, list, fresh) { return focusStep(el, list, -1, fresh); }

  /* ======================================================= FELDER & ZEITPLAN
     Mehr Felder als gleichzeitig moegliche Spiele bringen nichts – deshalb
     richtet sich die Auswahl nach der Teamzahl (Teams ÷ 2, höchstens 10).   */
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
    for (let n = 1; n <= max; n++) sel.add(new Option(tx('ui.field.count', { one: '{count} Feld', other: '{count} Felder' }, { count: n }), n));
    sel.value = String(val);
    return val;
  }

  /* Kompakte Zeitplan-Uebersicht (zweispaltig): auf dem Ausdruck sieht die
     Turnierleitung auf einen Blick, wann welche Runde startet.              */
  function timeTableHtml(slots, endLabel) {
    const rows = (slots || []).map(s => ({ t: fmtTime(s.startMin), n: slotTitle(s) }));
    if (endLabel) rows.push({ t: endLabel.time, n: endLabel.text });
    const half = Math.ceil(rows.length / 2);
    const thTime = esc(tx('ui.timeplan.time', 'Zeit'));
    const thRound = esc(tx('ui.round.word', 'Runde'));
    let html = '<table class="timeplan"><caption>' + esc(tx('ui.timeplan.caption', 'Zeitplan')) + '</caption><thead><tr>'
      + '<th>' + thTime + '</th><th>' + thRound + '</th><th>' + thTime + '</th><th>' + thRound + '</th></tr></thead><tbody>';
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
      + tx('ui.kpi.perSet', ' · ≈{min} Min/Satz', { min: perSet }));
    set('rv-perGame', tx('ui.kpi.perGame', '{avail} / {min} Min', { avail: availPerGame, min: minPerGame }),
      availPerGame < minPerGame);
    set('rv-duration', fmtDur(winMin) + ' / ' + fmtDur(needMin), needMin > winMin);
    set('rv-buffer', (winMin - needMin >= 0 ? '+' : '−') + fmtDur(Math.abs(winMin - needMin)),
      winMin < needMin);
  }

  /* ============================================================ FELD-LEITER
     King/Queen of the Court (AGENTS.md §1, core/turnier-core.js §3.7,
     core/turnier-format.js buildKingOfCourt). Es gibt keinen Bracket und
     keine feste Tabelle, sondern eine Feld-für-Feld-Leiter, die sich Runde
     für Runde verschiebt - dafür ein eigenständiger Renderer statt
     bracketColumnsHtml/standingsTableHtml wiederzuverwenden.

     courtLadderHtml(courtsData, ctx): baut EIN Runden-Skelett (alle Felder
     einer Runde, jedes Feld mit seinen Spielen). ctx wie bei den anderen
     Renderern: { teamLabel, teamNameHtml }. Die Ergebnis-Kaestchen tragen
     bewusst die STANDARD-Attribute data-mid/data-set/data-side (data-set
     konstant "1", da King/Queen keine Saetze kennt), damit spielplan-enh.js
     das ":"-Splitten und die Pfeiltasten-Navigation ohne Zusatzcode uebernimmt
     (siehe spielplan-enh.js scorePartner()). Felder/Spiele selbst werden
     ueber die eigenen Attribute data-kq-court/data-kq-match/data-kq-side
     (am Kaestchen-Wrapper, nicht am <input>) adressiert.
     paintCourtLadder(container, roundData, ctx): trägt Namen/Ergebnisse ein
     und markiert Sieger sowie Auf-/Absteiger nach Abschluss der Runde.       */
  function courtLadderHtml(courtsData, roundNo) {
    let html = '';
    (courtsData || []).forEach(cd => {
      const crownCls = cd.level === 1 ? ' is-king' : '';
      html += '<div class="kqcourt' + crownCls + '" data-kq-court="' + cd.level + '">'
        + '<div class="kqcourt-head">' + (cd.level === 1 ? '<svg class="bl-ic" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M2 20h20"/><path d="M4 17 2 6l5.5 5L12 4l4.5 7L22 6l-2 11z"/></svg> ' : '') + esc(term(cd.label)) + '</div>'
        + '<div class="kqcourt-matches">';
      (cd.matches || []).forEach(m => {
        html += '<div class="kqmatch sbox" data-kq-match="' + esc(m.id) + '">'
          + '<div class="kqside" data-kq-side="a"><span class="n"></span>'
          + '<input class="score kqscore" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="3"'
          + ' data-mid="' + esc(m.id) + '" data-set="1" data-side="a" autocomplete="off"></div>'
          + '<div class="kqvs">:</div>'
          + '<div class="kqside" data-kq-side="b"><input class="score kqscore" type="text" inputmode="numeric"'
          + ' pattern="[0-9]*" maxlength="3" data-mid="' + esc(m.id) + '" data-set="1" data-side="b" autocomplete="off">'
          + '<span class="n"></span></div>'
          /* OK-Knopf (siehe setColumnHtml/spielplan-enh.js [data-score-ok]):
             die zusaetzliche Klasse "sbox" laesst den universellen Handler
             auch hier das Kaestchenpaar finden, ohne KQ-Sonderfall im JS.
             tabindex="-1": nicht Teil der Tab-Reihenfolge (siehe oben). */
          + '<button type="button" class="score-ok noprint" data-score-ok tabindex="-1"'
          + ' aria-label="' + esc(tx('ui.score.okAria', 'Eingabe bestätigen und weiter')) + '"><svg class="bl-ic" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><polyline points="20 6 9 17 4 12"/></svg></button>'
          + '</div>';
      });
      if (cd.bye != null) {
        html += '<div class="kqbye" data-kq-bye="1"><span class="n"></span> <em>' + tx('ui.kq.courtBye', 'Feld-Freilos') + '</em></div>';
      }
      html += '</div></div>';
    });
    return html;
  }

  /* Trägt Namen/Ergebnisse in ein per courtLadderHtml() erzeugtes Skelett ein.
     roundData = ein Eintrag aus TFormat.buildKingOfCourt(...).rounds.        */
  function paintCourtLadder(container, roundData, ctx) {
    if (!container) return;
    (roundData.courts || []).forEach(cd => {
      const box = container.querySelector('[data-kq-court="' + cd.level + '"]');
      if (!box) return;
      cd.matches.forEach(m => {
        const mbox = box.querySelector('[data-kq-match="' + m.id + '"]');
        if (!mbox) return;
        const aEl = mbox.querySelector('[data-kq-side="a"]'), bEl = mbox.querySelector('[data-kq-side="b"]');
        if (aEl) aEl.querySelector('.n').textContent = ctx.teamLabel(m.a);
        if (bEl) bEl.querySelector('.n').textContent = ctx.teamLabel(m.b);
        const r = m.result;
        aEl && aEl.classList.toggle('is-win', !!(r && r.winner === 'a'));
        bEl && bEl.classList.toggle('is-win', !!(r && r.winner === 'b'));
        mbox.classList.toggle('is-draw', !!(r && r.draw));
      });
      if (cd.bye != null) {
        const byeEl = box.querySelector('[data-kq-bye]');
        if (byeEl) byeEl.querySelector('.n').textContent = ctx.teamLabel(cd.bye);
      }
    });
  }

  return {
    esc, fmtTime, fmtDiff, teamNameHtml, makeLabeler, sideLabel, cardNameHtml,
    bracketColumnsHtml, paintBracketColumns,
    setColumnHtml, matchCellHtml, scheduleBodyHtml, paintMatch, markScoreInputs, paintByeCard,
    standingsTableHtml, placeListHtml, rankBadgeHtml, initManualEditing, manualDeltaBadge, criteriaHint, hintHtml, scoreHintHtml, trackTableHtml, setTrackCell, sortTrackRows,
    namePanelHtml, fieldPanelHtml, absentPanelHtml, teamDelBtnHtml, confirmRemoveTeam,
    roundBarHtml, roundBarValue, lastFilledRound, applyRoundFilter,
    scoringTablesHtml, jumpBarHtml, wireJumpBar, wireFormatInfo, syncModeSummary,
    maxParallelFields, defaultFields, fillFieldSelect, timeTableHtml, fillTimeKpis,
    wireScoreInputs, courtLadderHtml, paintCourtLadder
  };
});
