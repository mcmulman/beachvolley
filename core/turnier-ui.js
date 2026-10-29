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
  const api = factory(root,
    root.TC || (typeof require === 'function' ? require('./turnier-core.js') : null),
    root.TStore || (typeof require === 'function' ? require('./turnier-store.js') : null),
    root.TSport || (typeof require === 'function' ? require('./turnier-sport.js') : null)
  );
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.TUI = api;
    api.wireFormatInfo(root.document);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root, TC, TStore, TSport) {
  'use strict';

  /* ------------------------------------------------------------ Hilfsmittel */
  let activeSport = TSport ? TSport.BEACH : null;
  function configureProfile(id, options) {
    const profile = TSport && TSport.get(id, 1);
    if (!profile) throw new Error('Unsupported sport profile: ' + id);
    const opts = options || {};
    activeSport = profile;
    if (root.document && root.document.body) {
      root.document.body.setAttribute('data-sport', id);
      const heading = root.document.querySelector('h1');
      if (heading) {
        let label = root.document.querySelector('.sport-profile-label');
        if (!label) {
          label = root.document.createElement('p');
          label.className = 'sport-profile-label';
          heading.parentNode.insertBefore(label, heading.nextSibling);
        }
        label.textContent = tx(profile.nameKey, id);
        const glossary = root.document.getElementById('sport-profile-glossary');
        if (glossary) glossary.remove();
      }
      const section = root.document.getElementById('configSection');
      if (section && (id === 'volleyball.indoor'
          || (id.indexOf('table-tennis.') === 0
            && (opts.mode === 'rr' || opts.mode === 'swiss' || opts.mode === 'groups')))) {
        let controls = root.document.getElementById('sport-profile-controls');
        if (!controls) {
          controls = root.document.createElement('div');
          controls.id = 'sport-profile-controls';
          controls.className = 'sport-profile-controls';
          const field = root.document.createElement('label');
          field.className = 'cfgfield';
          const caption = root.document.createElement('span');
          caption.textContent = tx('sport.ranking.label', 'Gruppenwertung');
          const select = root.document.createElement('select');
          select.id = 'ranking-profile-select';
          profile.rankingProfiles.forEach(function (rankingId) {
            if (rankingId === 'tt-dttb-swiss-ranking-2026' && opts.mode !== 'swiss') return;
            if (rankingId === 'tt-dttb-individual-round-robin-2026' && opts.mode === 'swiss') return;
            if (rankingId === 'tt-ittf-individual-groups-2026' && opts.mode === 'swiss') return;
            const option = root.document.createElement('option');
            option.value = rankingId;
            option.textContent = tx(profile.rankingProfileLabels[rankingId], rankingId);
            select.appendChild(option);
          });
          field.appendChild(caption);
          field.appendChild(select);
          const note = root.document.createElement('p');
          note.className = 'sport-profile-note';
          note.textContent = tx('sport.ranking.note', 'Wertungsvorgabe des Turniers; keine allgemeine Verbandsakkreditierung.');
          const limitation = root.document.createElement('p');
          limitation.id = 'ranking-profile-limitation';
          limitation.className = 'sport-profile-note';
          limitation.textContent = tx('sport.ranking.indoorFivbNote',
            'Nur für gleichmäßig gespielte Pools mit normalen Ergebnissen. Erkannte Freilose blockieren die Rangfolge; Aufgabe, Disqualifikation und Weltranglisten-Fallback sind nicht implementiert.');
          limitation.hidden = true;
          controls.appendChild(field);
          controls.appendChild(note);
          controls.appendChild(limitation);
          const setup = section.querySelector('[data-cfg-options]')
            || section.querySelector('.cfg-action-groups')
            || section.querySelector('.cfg-setup-content') || section;
          setup.appendChild(controls);
          controls._rankingLimitation = limitation;
        }
        const select = controls.querySelector('#ranking-profile-select');
        const limitation = controls._rankingLimitation;
        const record = opts.getTournament ? opts.getTournament() : null;
        if (select) {
          select.value = record && record.config && record.config.rankingProfile
            ? record.config.rankingProfile : profile.rankingProfiles[0];
          showRankingLimit(limitation, select.value);
          const uiState = root.TStore && root.TStore.initialUiState();
          select.disabled = !!(uiState && uiState.readOnly) || !opts.getTournament || !opts.repaint;
          if (select.getAttribute('data-bound') !== '1') {
            select.setAttribute('data-bound', '1');
            select.addEventListener('change', function () {
              showRankingLimit(limitation, select.value);
              const state = opts.getTournament && opts.getTournament();
              if (!state || !state.config || profile.rankingProfiles.indexOf(select.value) < 0) return;
              const previous = state.config.rankingProfile || profile.rankingProfiles[0];
              if (select.hasAttribute('data-qualification-disabled')) {
                select.value = previous;
                showRankingLimit(limitation, previous);
                root.alert(tx('qualification.started', 'Die Finalrunde hat bereits Eingaben. Bitte zuerst die Finalrunde zurücksetzen, bevor du die Qualifikation änderst.'));
                return;
              }
              const previousOrder = state.config.qualificationOrder;
              delete state.config.qualificationOrder;
              state.config.rankingProfile = select.value;
              try { TC.configureProfile(id, state.config.customSetTarget, select.value, state.config.modeMinutes); }
              catch (e) {
                state.config.rankingProfile = previous;
                if (previousOrder !== undefined) state.config.qualificationOrder = previousOrder;
                select.value = previous;
                throw e;
              }
              Promise.resolve(opts.save ? opts.save(state) : TStore.save(state)).then(function (saved) {
                if (!saved) {
                  state.config.rankingProfile = previous;
                  if (previousOrder !== undefined) state.config.qualificationOrder = previousOrder;
                  TC.configureProfile(id, state.config.customSetTarget, previous, state.config.modeMinutes);
                  select.value = previous;
                  return;
                }
                opts.repaint();
              }).catch(function (error) {
                state.config.rankingProfile = previous;
                if (previousOrder !== undefined) state.config.qualificationOrder = previousOrder;
                TC.configureProfile(id, state.config.customSetTarget, previous, state.config.modeMinutes);
                select.value = previous;
                root.console.error('Ranking profile could not be saved', error);
              });
            });
          }
        }
      }
      if (section && opts.outcomes) mountOutcomeControls(section, profile, opts);
      if (section && id !== 'volleyball.beach') mountModeEstimateControls(section, profile, opts);
    }
    return true;
  }
  function showRankingLimit(el, value) {
    if (!el) return;
    el.hidden = value !== 'indoor-fivb-2026' && value !== 'indoor-dvv-bso-2026'
      && value !== 'tt-dttb-individual-round-robin-2026' && value !== 'tt-dttb-swiss-ranking-2026'
      && value !== 'tt-ittf-individual-groups-2026';
    el.textContent = value === 'tt-dttb-swiss-ranking-2026'
      ? tx('sport.ranking.tableTennisSwissNote', 'DTTB WO D7.6: Siege → Buchholz → direkter Vergleich (nur zwei Gleichstehende) → offizieller Losentscheid. Freilos = ein Sieg ohne Spiel-/Punktgutschrift; Buchholz zählt die Siege aller bisherigen Gegner, für ein Freilos die Siege des Tabellenletzten. Zwischenstände: nur Siege/Buchholz. Kein Feinbuchholz. Mehrfachgleichstände bleiben offen zur offiziellen Entscheidung. Eine endgültige D7.9-Entscheidung wegen Nichtantretens nach Zeit-/Aufrufprüfung oder vorzeitiger Aufgabe erhält alle bisherigen Siege und beendet die weitere Teilnahme; für jede tatsächlich fortgesetzte spätere Runde wird eine kampflose Niederlage gewertet. Vorübergehende Abwesenheit oder Verletzung allein ist keine solche Entscheidung; die allgemeine Abwesenheitsmarkierung und andere Sonderausgänge blockieren die D7.6-Wertung. Ohne bereits feststehende Paarung werden weder Gegner noch Buchholzbeitrag oder Spielstand erfunden. Ein feststehendes künftiges Spiel bleibt unverändert und wird als D7.10-Walkover aufgezeichnet. Paarungen sind App-Vorschläge, keine zertifizierte DTTB-Auslosung: Turnierleitung muss Setzung, Sieggruppen und Absteiger prüfen. Keine Prüfung der Doppel-Aufschlag-/Schlagreihenfolge. Manuelle Tabellenkorrekturen sind hier deaktiviert.')
      : value === 'tt-ittf-individual-groups-2026'
      ? tx('sport.ranking.tableTennisIttfGroupsNote',
        'ITTF Statutes 2026 §§3.7.4.4/3.7.5: nur Gruppen-/Qualifikationsphasen im Einzel-/Doppelwettbewerb; der Hauptevent ist KO. 2 Matchpunkte für Sieg, 1 für Niederlage im gespielten Match. Bei Gleichstand Mini-Tabelle nur unter den Gleichstehenden: Matchpunkte → Spielquotient → Punktquotient; nach jeder Teilauflösung wird mit den verbleibenden Gleichstehenden neu gerechnet. Freilose, Abwesenheit und Sonderausgänge sperren die Wertung; eine unvollständige Gruppe qualifiziert nicht weiter. Der offizielle Losentscheid bleibt manuell. Das Schluss-Spielpaar nach §3.7.5.5 bzw. eine Jury-Ausnahme werden nicht geplant oder geprüft; bitte den Spielplan fachlich prüfen. Nicht für Swiss, Modified Pool Play oder den KO-Hauptevent.')
      : value === 'tt-dttb-individual-round-robin-2026'
      ? tx('sport.ranking.tableTennisDttbNote',
        'DTTB WO D7.5 für Einzel/Doppel-RR. Auf Runden-/Flex-RR ist ein ausdrücklich bestätigter D7.9-Stufenrückzug mit D7.10-Aufzeichnung unterstützt. Freilose, sonstige Abwesenheit/Sonderergebnisse und ungleiche Spielpläne blockieren. D7.9/D7.10 für D7.6-Swiss ist separat auf den Runden-/Flex-Swiss-Bögen umgesetzt: frühere Siege bleiben, spätere Walkover-Niederlagen werden erfasst, ohne eine Round-Robin-Annullierung anzuwenden. Disqualifikation, Mehrfachrückzüge, automatische Folgestufen und Doppel-Reihenfolgen sind nicht umgesetzt. Restgleichstände benötigen den offiziellen Losentscheid; die App lost nicht. Nicht für Swiss-Wertung.')
      : value === 'indoor-dvv-bso-2026'
      ? tx('sport.ranking.indoorDvvNote',
        'Nur für gleichmäßig gespielte Pools im Modus Best-of-3 oder Best-of-5 ohne Freilose. Bleibt nach direktem Vergleich ein Gleichstand, wird er markiert; das Entscheidungsspiel wird nicht berechnet. DVV BSO §5.3 (Nichtantritt/Spielabbruch) ist nicht umgesetzt; Default/Spielabbruch nach FIVB-Regel 6.4 sind hier nicht als DVV-Wertung freigegeben.')
      : value === 'indoor-fivb-2026' ? tx('sport.ranking.indoorFivbNote',
        'Nur für gleichmäßig gespielte Pools mit normalen Ergebnissen. Erkannte Freilose blockieren die Rangfolge; Aufgabe, Disqualifikation und Weltranglisten-Fallback sind nicht implementiert.')
        : '';
  }
  function paintStageMatch(td, match) {
    if (!match.annulled && !match.withdrawalMatch) return;
    const note = td.querySelector('.mnote-slot');
    if (note) note.textContent = match.annulled
      ? tx('stage.annulled', 'D7.9: nicht in der Stufenwertung')
        + (match.recordedResult ? ' · D7.10: ' + match.recordedResult.awardedSets.map(s => s.join(':')).join(', ') : '')
      : tx(match.walkover ? 'stage.swiss.walkover' : 'stage.swiss.trigger',
        match.walkover ? 'D7.6: kampflose Niederlage · D7.10: ' : 'D7.9/D7.10: Wertung gemäß Schweizer System · ')
        + (match.recordedResult ? match.recordedResult.awardedSets.map(s => s.join(':')).join(', ') : '');
    if (match.withdrawalMatch) td.querySelectorAll('input.score').forEach(el => {
      el.disabled = true;
      el.setAttribute('aria-disabled', 'true');
    });
  }
  function paintStage(state, opts) {
    const Stage = root.TStage;
    if (!Stage || !root.document) return;
    const doc = root.document;
    const isSwissProfile = state.config.mode === 'swiss' && state.config.rankingProfile === Stage.SWISS_RANKING;
    const applicable = state.sport.id.indexOf('table-tennis.') === 0
      && (state.config.mode === 'rr' && state.config.rankingProfile === Stage.RANKING || isSwissProfile);
    let button = doc.getElementById('stage-decision-button');
    if (!button) {
      button = doc.createElement('button');
      button.id = 'stage-decision-button';
      button.type = 'button';
      button.className = 'nbtn noprint';
      doc.getElementById('configSection').appendChild(button);
    }
    const decision = Stage.active(state);
    button.hidden = !applicable;
    button.textContent = decision ? tx('stage.undo', 'Stufenentscheidung widerrufen …')
      : tx(isSwissProfile ? 'stage.swiss.add' : 'stage.add',
        isSwissProfile ? 'DTTB-Swiss-Rückzug …' : 'DTTB Stufenrückzug …');
    const readOnly = root.TStore.initialUiState().readOnly;
    const swissPlan = isSwissProfile && !decision ? opts.build(state) : null;
    const hasSwissTrigger = !!decision || !isSwissProfile || !!(swissPlan && swissPlan.rounds.some(rd =>
      rd.matches.some(m => !m.result && !m.dead && m.bye == null)));
    button.disabled = !!readOnly || !hasSwissTrigger;
    button.onclick = () => stageDialog(state, opts, decision);
    const locked = (state.stageDecisions || []).length > 0;
    ['ranking-profile-select', 'teamCount', 'btnToggleAbsent', 'btnClearAbsent', 'btnShuffle',
      'btnExportFinal', 'modeSelect', 'mode'].forEach(id => {
      const el = doc.getElementById(id);
      if (!el) return;
      if (locked) {
        if (!el.hasAttribute('data-stage-locked')) el.setAttribute('data-stage-locked', String(el.disabled));
        el.disabled = true;
      } else if (el.hasAttribute('data-stage-locked')) {
        el.disabled = el.getAttribute('data-stage-locked') === 'true';
        el.removeAttribute('data-stage-locked');
      }
    });
    if (locked) doc.querySelectorAll('[data-remove-team], [data-absent-input], [data-team-status]').forEach(el => { el.disabled = true; });
    const absenceButton = doc.getElementById('btnToggleAbsent');
    if (absenceButton && isSwissProfile && !locked) {
      if (!absenceButton.hasAttribute('data-stage-absence-disabled')) {
        absenceButton.setAttribute('data-stage-absence-disabled', String(absenceButton.disabled));
      }
      absenceButton.disabled = true;
      absenceButton.title = tx('stage.swiss.absenceUnavailable',
        'Vorübergehende Abwesenheit ist keine D7.9-Rückzugsentscheidung und wird in diesem D7.6-Profil nicht automatisch gewertet.');
    } else if (absenceButton && absenceButton.hasAttribute('data-stage-absence-disabled')) {
      absenceButton.disabled = absenceButton.getAttribute('data-stage-absence-disabled') === 'true';
      absenceButton.removeAttribute('data-stage-absence-disabled');
      absenceButton.title = '';
    }
    if (isSwissProfile && !locked) {
      doc.querySelectorAll('[data-absent-input], [data-team-status]').forEach(el => {
        if (!el.hasAttribute('data-stage-absence-disabled')) {
          el.setAttribute('data-stage-absence-disabled', String(el.disabled));
        }
        el.disabled = true;
      });
    } else {
      doc.querySelectorAll('[data-absent-input][data-stage-absence-disabled], [data-team-status][data-stage-absence-disabled]').forEach(el => {
        el.disabled = el.getAttribute('data-stage-absence-disabled') === 'true';
        el.removeAttribute('data-stage-absence-disabled');
      });
    }
    let summary = doc.getElementById('stage-decision-summary');
    if (!summary) {
      summary = doc.createElement('p');
      summary.id = 'stage-decision-summary';
      const notice = doc.getElementById('noticeBox');
      notice.parentNode.insertBefore(summary, notice.nextSibling);
    }
    summary.hidden = !locked;
    if (decision && decision.stage === 'swiss') {
      const plan = opts.build(state);
      const losses = plan.rounds.filter(rd => (rd.withdrawalLoss && rd.withdrawalLoss.roundStarted)
        || rd.matches.some(m => m.walkover))
        .map(rd => tx('stage.roundLabel', 'Runde {round}', { round: rd.round }));
      summary.textContent = tx('stage.swiss.summary',
        'DTTB WO D7.6/D7.9: {participant} behält {wins} Siege. Keine weitere Teilnahme; spätere begonnene Runden als kampflose Niederlage: {rounds}. Ohne feststehende Paarung werden weder Gegner noch Buchholzbeitrag oder Spielstand erfunden. Auslösendes Ergebnis bleibt gespeichert; D7.10-Aufzeichnung getrennt.',
        { participant: participantWord() + ' ' + decision.participant,
          wins: plan.table.stat[decision.participant].won,
          rounds: losses.length ? losses.join(', ') : '–' })
        + ' ' + tx('outcome.authority.' + decision.authority, decision.authority)
        + ': ' + decision.reference + ' · ' + decision.decidedAt;
    } else {
      summary.textContent = decision
        ? tx('stage.summary', 'DTTB WO D7.9: {participant} – alle Ergebnisse dieser Round-Robin-Stufe annulliert; letzter Platz {place}. Keine weitere Teilnahme. Originaleingaben bleiben erhalten.',
          { participant: participantWord() + ' ' + decision.participant, place: state.config.teams })
          + ' ' + tx('outcome.authority.' + decision.authority, decision.authority)
          + ': ' + decision.reference + ' · ' + decision.decidedAt
      : tx('stage.revoked', 'Stufenentscheidung widerrufen; Originalergebnisse wieder in der Wertung. Entscheidungsverlauf bleibt gespeichert.');
    }
  }
  function stageDialog(state, opts, existing) {
    const Stage = root.TStage, doc = root.document;
    if (doc.getElementById('stage-dialog-overlay')) return;
    const plan = opts.build(state);
    const overlay = doc.createElement('div');
    overlay.id = 'stage-dialog-overlay';
    overlay.className = 'outcome-overlay noprint';
    const swiss = state.config.mode === 'swiss' && state.config.rankingProfile === Stage.SWISS_RANKING;
    let triggerRounds = plan.rounds;
    if (swiss) {
      const current = plan.rounds.find(rd => rd.matches.some(m => !m.result && !m.dead && m.bye == null));
      triggerRounds = current ? [current] : [];
    }
    const options = triggerRounds.map(rd => rd.matches.filter(m => !m.result && !m.dead && m.bye == null)
      .map(m => '<option value="' + esc(m.id) + '">' + esc(rd.round + ': ' + m.a + ' – ' + m.b) + '</option>').join('')).join('');
    const field = (name, label, contents) => '<label class="outcome-field"><span>' + esc(label) + '</span>' + contents + '</label>';
    overlay.innerHTML = '<div class="outcome-dialog" role="dialog" aria-modal="true" aria-labelledby="stage-title" tabindex="-1">'
      + '<h2 id="stage-title">' + esc(tx(swiss ? 'stage.swiss.add' : 'stage.add',
        swiss ? 'DTTB-Swiss-Rückzug …' : 'DTTB Stufenrückzug …')) + '</h2>'
      + '<p>' + esc(tx(swiss ? 'stage.swiss.boundary' : 'stage.boundary',
        swiss
          ? 'Nur eine endgültige D7.9-Entscheidung wegen Nichtantretens nach Zeit-/Aufrufprüfung oder vorzeitiger Aufgabe. Im D7.6-Schweizer System bleiben alle bisherigen Siege erhalten; ab dann keine weitere Teilnahme, je begonnener späterer Runde eine kampflose Niederlage. Bereits feststehende Paarungen bleiben unverändert; ohne Paarung werden weder Gegner noch Buchholzbeitrag oder Ergebnis erfunden. Vorübergehende Abwesenheit oder Verletzung allein ist kein Rückzug. D7.10 erfasst das auslösende Spiel.'
          : 'Nur DTTB WO D7.9 Nichtantreten oder vorzeitige Aufgabe in einer einzelnen RR-Stufe. Nicht für vorübergehende Abwesenheit, Verletzung allein, Disqualifikation oder Swiss. Swiss D7.6 behält frühere Siege; spätere kampflose Niederlagen sind hier noch nicht umgesetzt. Mehrere Rückzüge und automatische Folgestufen sind nicht unterstützt.')) + '</p>'
      + (existing ? '<p>' + esc(tx('stage.undo', 'Stufenentscheidung widerrufen …')) + '</p>'
        : field('match', tx('stage.match', 'Auslösendes Spiel'), '<select data-stage="match">' + options + '</select>')
          + field('participant', tx('stage.participant', 'Ausgeschlossener Teilnehmer'), '<select data-stage="participant"></select>')
          + field('reason', tx('stage.reason', 'Bestätigter Tatbestand'), '<select data-stage="reason"><option value="not-appeared">'
            + esc(tx('stage.noShow', 'Nichtantreten nach D7.9 (Zeit/Aufrufe geprüft)')) + '</option><option value="retired">'
            + esc(tx('stage.retired', 'Vorzeitige Aufgabe')) + '</option></select>'))
      + field('authority', tx('stage.authority', 'Entschieden durch'), '<select data-stage="authority"><option value="referee">'
        + esc(tx('outcome.authority.referee', 'Schiedsgericht')) + '</option><option value="organizer">'
        + esc(tx('outcome.authority.organizer', 'Turnierleitung')) + '</option></select>')
      + field('reference', tx('stage.reference', 'Entscheidungsreferenz / Name (Pflicht)'), '<input data-stage="reference" maxlength="200">')
      + '<label class="outcome-radio"><input type="checkbox" data-stage="confirmed"> '
        + esc(existing
          ? tx(swiss ? 'stage.swiss.revokeConfirm' : 'stage.confirm',
            'Ich bestätige den protokollierten Widerruf und die Wiederherstellung.')
          : tx(swiss ? 'stage.swiss.confirm' : 'stage.confirm',
            swiss
              ? 'Ich bestätige die endgültige D7.9-Rückzugsentscheidung, den D7.6-Umfang und dass dies keine vorübergehende Abwesenheit ist. Frühere Siege bleiben; weitere Runden werden als Niederlagen gewertet.'
              : 'Ich bestätige die endgültige Entscheidung und den Umfang: gesamte aktuelle RR-Stufe und keine weitere Teilnahme in dieser Konkurrenz.')) + '</label>'
      + '<p data-stage-error role="alert"></p><div class="outcome-actions"><button type="button" data-stage-save class="primary">'
        + esc(tx('outcome.act.save', 'Speichern')) + '</button><button type="button" data-stage-cancel>'
        + esc(tx('outcome.act.cancel', 'Abbrechen')) + '</button></div></div>';
    doc.body.appendChild(overlay);
    const f = n => overlay.querySelector('[data-stage="' + n + '"]');
    if (!existing) {
      const sync = () => {
        const m = plan.matchById[f('match').value];
        f('participant').innerHTML = [m.a, m.b].map(t =>
          '<option value="' + t + '">' + esc(participantWord() + ' ' + t + (displayName(state, t) ? ': ' + displayName(state, t) : '')) + '</option>').join('');
      };
      f('match').onchange = sync; sync();
    }
    const close = () => { overlay.remove(); const b = doc.getElementById('stage-decision-button'); if (b) b.focus(); };
    overlay.querySelector('[data-stage-cancel]').onclick = close;
    overlay.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
    overlay.querySelector('[data-stage-save]').onclick = async () => {
      const error = overlay.querySelector('[data-stage-error]');
      if (!f('confirmed').checked || !f('reference').value.trim()) {
        error.textContent = tx('stage.required', 'Referenz und ausdrückliche Bestätigung erforderlich.'); return;
      }
      const entry = {
        v: 1, id: 'decision-' + Date.now() + '-' + (state.stageDecisions || []).length,
        kind: existing ? 'revoke' : 'withdrawal', policy: Stage.POLICY,
        scope: swiss ? 'swiss-event-withdrawal' : 'stage-and-following',
        stage: swiss ? 'swiss' : 'round-robin',
        participant: existing ? existing.participant : +f('participant').value,
        matchId: existing ? existing.matchId : f('match').value,
        reason: existing ? existing.reason : f('reason').value,
        authority: f('authority').value, reference: f('reference').value.trim(), decidedAt: new Date().toISOString()
      };
      if (existing) entry.reverses = existing.id;
      const check = Stage.change(state, entry, opts.build);
      if (!check.ok) {
        error.textContent = tx('stage.error.' + check.code,
          tx('stage.error', 'Entscheidung blockiert ({code}). Eingaben/Umfang prüfen; keine Daten wurden geändert.',
            { code: check.code })); return;
      }
      const saved = await root.TStore.save(check.state);
      if (!saved) { error.textContent = tx('stage.saveFailed', 'Speichern fehlgeschlagen; keine Entscheidung angewendet.'); return; }
      Object.assign(state, check.state);
      close(); opts.repaint();
    };
    overlay.querySelector('.outcome-dialog').focus();
  }
  function mountModeEstimateControls(section, profile, opts) {
    refreshSetModeOptionLabels(section);
    let box = root.document.getElementById('sport-mode-estimate-controls');
    if (!box) {
      box = root.document.createElement('div');
      box.id = 'sport-mode-estimate-controls';
      box.className = 'sport-profile-controls';
      const modeLabel = root.document.createElement('label');
      modeLabel.className = 'cfgfield';
      const modeCaption = root.document.createElement('span');
      modeCaption.textContent = tx('sport.estimates.label', 'Modus für Zeitschätzung');
      const mode = root.document.createElement('select');
      mode.id = 'sport-estimate-mode';
      profile.modeIds.forEach(function (modeId) {
        const option = root.document.createElement('option');
        option.value = modeId;
        option.textContent = tx('setMode.option.' + TC.modeDef(modeId).id, modeId);
        mode.appendChild(option);
      });
      modeLabel.appendChild(modeCaption);
      modeLabel.appendChild(mode);

      const minutesLabel = root.document.createElement('label');
      minutesLabel.className = 'cfgfield';
      const minutesCaption = root.document.createElement('span');
      minutesCaption.textContent = tx('sport.estimates.minutes', 'Minuten');
      const minutes = root.document.createElement('input');
      minutes.id = 'sport-estimate-minutes';
      minutes.type = 'number';
      minutes.min = '1';
      minutes.max = '360';
      minutes.step = '1';
      minutes.inputMode = 'numeric';
      minutesLabel.appendChild(minutesCaption);
      minutesLabel.appendChild(minutes);

      const customLabel = root.document.createElement('label');
      customLabel.className = 'cfgfield';
      const customCaption = root.document.createElement('span');
      customCaption.textContent = tx('sport.customTarget.label', 'Freies Satzziel (11–50)');
      const custom = root.document.createElement('input');
      custom.id = 'sport-custom-set-target';
      custom.type = 'number';
      custom.min = '11';
      custom.max = '50';
      custom.step = '1';
      custom.inputMode = 'numeric';
      customLabel.appendChild(customCaption);
      customLabel.appendChild(custom);

      const note = root.document.createElement('p');
      note.className = 'sport-profile-note';
      note.textContent = tx('sport.estimates.note', 'Bearbeitbare Planungs-Schätzung; tatsächliche Spieldauer variiert, dies ist keine offizielle Zeitvorgabe.');
      box.appendChild(modeLabel);
      box.appendChild(minutesLabel);
      box.appendChild(customLabel);
      box.appendChild(note);
      const setup = section.querySelector('[data-cfg-options]')
        || section.querySelector('.cfg-action-groups')
        || section.querySelector('.cfg-setup-content') || section;
      setup.appendChild(box);

      function refresh(record) {
        const id = mode.value;
        const estimates = record.config.modeMinutes || {};
        minutes.value = String(Object.prototype.hasOwnProperty.call(estimates, id)
          ? estimates[id] : TC.modeMinutes(id));
        customLabel.hidden = profile.id !== 'volleyball.indoor' || id !== 'indoor-custom';
        custom.value = String(record.config.customSetTarget || 25);
      }
      function saveChange(property, value, previous, input) {
        const record = opts.getTournament && opts.getTournament();
        if (!record || !record.config) return;
        record.config[property] = value;
        try {
          TC.configureProfile(record.sport.id, record.config.customSetTarget,
            record.config.rankingProfile, record.config.modeMinutes);
        } catch (error) {
          record.config[property] = previous;
          input.value = String(previous);
          throw error;
        }
        Promise.resolve(opts.save ? opts.save(record) : TStore.save(record)).then(function (saved) {
          if (!saved) {
            record.config[property] = previous;
            TC.configureProfile(record.sport.id, record.config.customSetTarget,
              record.config.rankingProfile, record.config.modeMinutes);
            input.value = String(previous);
            return;
          }
          opts.repaint();
        }).catch(function (error) {
          record.config[property] = previous;
          TC.configureProfile(record.sport.id, record.config.customSetTarget,
            record.config.rankingProfile, record.config.modeMinutes);
          input.value = String(previous);
          root.console.error('Sport settings could not be saved', error);
        });
      }
      mode.addEventListener('change', function () {
        const record = opts.getTournament && opts.getTournament();
        if (record) refresh(record);
      });
      minutes.addEventListener('change', function () {
        const value = Number(minutes.value);
        if (!Number.isInteger(value) || value < 1 || value > 360) {
          minutes.setAttribute('aria-invalid', 'true');
          const record = opts.getTournament && opts.getTournament();
          if (record) refresh(record);
          return;
        }
        minutes.removeAttribute('aria-invalid');
        const record = opts.getTournament && opts.getTournament();
        if (!record) return;
        const previous = record.config.modeMinutes && record.config.modeMinutes[mode.value];
        const next = Object.assign({}, record.config.modeMinutes || {});
        next[mode.value] = value;
        saveChange('modeMinutes', next, record.config.modeMinutes || {}, minutes);
        if (previous === value) refresh(record);
      });
      custom.addEventListener('change', function () {
        const value = Number(custom.value);
        if (!Number.isInteger(value) || value < 11 || value > 50) {
          custom.setAttribute('aria-invalid', 'true');
          const record = opts.getTournament && opts.getTournament();
          if (record) refresh(record);
          return;
        }
        custom.removeAttribute('aria-invalid');
        const record = opts.getTournament && opts.getTournament();
        if (record) saveChange('customSetTarget', value, record.config.customSetTarget || 25, custom);
      });
    }
    const record = opts.getTournament && opts.getTournament();
    const uiState = root.TStore && root.TStore.initialUiState();
    const mode = box.querySelector('#sport-estimate-mode');
    const minutes = box.querySelector('#sport-estimate-minutes');
    const custom = box.querySelector('#sport-custom-set-target');
    if (!record || !record.config || !mode || !minutes || !custom) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    mode.value = record.config.setMode || profile.modeIds[0];
    minutes.value = String(record.config.modeMinutes && record.config.modeMinutes[mode.value]
      || TC.modeMinutes(mode.value));
    custom.value = String(record.config.customSetTarget || 25);
    box.querySelector('#sport-custom-set-target').parentNode.hidden =
      profile.id !== 'volleyball.indoor' || mode.value !== 'indoor-custom';
    [mode, minutes, custom].forEach(function (input) {
      input.disabled = !!(uiState && uiState.readOnly) || !opts.getTournament || !opts.repaint;
    });
  }
  function profileTerm(key, fallback) {
    const value = activeSport && activeSport[key];
    return value ? tx(value, fallback) : fallback;
  }
  function participantWord() {
    const key = activeSport && activeSport.participantKey;
    return key ? tx(key, 'Team') : 'Team';
  }
  function modeOptionLabel(modeId) {
    const label = tx('setMode.option.' + TC.modeDef(modeId).id, modeId);
    return label + tx('setMode.option.estimate', ' · ca. {minutes} Min.', { minutes: TC.modeMinutes(modeId) });
  }
  function refreshSetModeOptionLabels(section) {
    const scope = section || root.document;
    if (!scope) return;
    scope.querySelectorAll('select#setMode, select#finalSetMode').forEach(select => {
      Array.from(select.options).forEach(option => {
        if (option.value) option.textContent = modeOptionLabel(option.value);
      });
    });
  }
  function surfaceWord() {
    const key = activeSport && activeSport.surfaceKey;
    return key ? tx(key, 'Feld') : 'Feld';
  }
  function surfaceLabel(index) {
    return surfaceWord() + ' ' + String(index);
  }
  function unitWord() {
    const key = activeSport && activeSport.matchUnitKey;
    return key ? tx(key, 'Satz') : 'Satz';
  }
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
    const text = I ? I.t(key, params) : key;
    // A missing key (e.g. an older cached dictionary) must never surface raw.
    if (text !== key) return text;
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
    const nm = displayName(teamNames, n);
    const members = teamNames && teamNames.teamNames && TSport ? TSport.pairMembers(teamNames, n) : ['', ''];
    const metadata = teamNames && teamNames.teamNames && TSport && TSport.supportsPairMembers(teamNames)
      ? ' data-player-one="' + esc(members[0]) + '" data-player-two="' + esc(members[1]) + '"' : '';
    const label = '<span class="t-line"' + metadata + '>' + esc(participantWord()) + ' ' + esc(n) + '</span>'
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
      const nm = displayName(teamNames, n);
      return nm ? String(nm) : (participantWord() + ' ' + n);
    };
  }
  function displayName(value, team) {
    return value && value.teamNames && TSport ? TSport.teamLabel(value, team)
      : String(value && value[team] || '').trim();
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
    const maxLength = activeSport && activeSport.id.indexOf('table-tennis.') === 0 ? '' : ' maxlength="3"';
    /* aria-label mit Teamname und Satz („Team A, Satz 2“) – sonst liest der
       Screenreader nur "Feld" bzw. bei mehreren Saetzen identische Namen. */
    const inp = side => {
      const nm = names && names[side];
      const al = nm ? (label ? nm + ', ' + label : nm) : '';
      return '<input class="score" type="text" inputmode="numeric" pattern="[0-9]*"' + maxLength +
        ' data-mid="' + esc(matchId) + '" data-set="' + setNo + '" data-side="' + side + '"' +
        ' autocomplete="off"' + (al ? ' aria-label="' + esc(al) + '"' : '') + ph + '>';
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
      + '<span class="sbox">' + inp('a') + '<span class="vs" aria-hidden="true">:</span>' + inp('b') + okBtn + '</span>'
      + '</span>';
  }

  /* m: {id, a, b, round?, label?, places?}  a/b sind TeamRef oder Teamnummer */
  function matchCellHtml(m, ctx) {
    const setMode = m.setMode || ctx.setMode;
    const def = TC.modeDef(setMode);
    const setCnt = def.sets;
    const ta = ctx.resolve(m.a), tb = ctx.resolve(m.b);
    const isBye = m.bye != null || (m.a && m.a.k === 'bye') || (m.b && m.b.k === 'bye');

    const inputNames = { a: sideLabel(m.a, ta, ctx), b: sideLabel(m.b, tb, ctx) };
    const tgt = n => TC.targetForSet(setMode, n);
    let sets = '';
    for (let n = 1; n <= setCnt; n++) {
      const finalTarget = n === setCnt && (def.finalTarget != null || def.decidingSet);
      const label = def.unit === 'game'
        ? tx('ui.score.gameN', 'Spiel {n}', { n: n })
        : finalTarget ? tx('ui.score.decider', 'Entsch.')
          : setCnt === 1 ? tx('ui.score.points', 'Punkte')
            : tx('ui.score.setN', 'Satz {n}', { n: n });
      sets += setColumnHtml(m.id, n, label, finalTarget ? 'TB' : null, inputNames, tgt(n));
    }

    /* t-a/t-b richten die Namen nach aussen aus, .t-line haelt "Team 12"
       einzeilig – beides wie im Bogen "Alle gegen Alle".                     */
    const side = (cls, ref, team) =>
      '<span class="pside ' + cls + '">'
      + '<span class="t ' + (cls === 'pside-a' ? 't-a' : 't-b') + '" '
      + (team != null ? 'data-team="' + esc(team) + '"' : '') + '>'
      + cardNameHtml(ref, team, ctx) + '</span></span>';

    const extra = m.label ? '<span class="mnote-slot">' + esc(term(m.label)) + '</span>' : '';
    const referees = ctx.showReferees
      ? '<span class="m-referees" data-referees>' + esc(tx('ui.match.referees', 'Schiedsgericht: noch nicht festgelegt')) + '</span>'
      : '';
    /* Nur EINE Beschriftung: ein sprechender Titel ("Spiel um Platz 3") ersetzt
       die technische Platzangabe, sonst stünde beides doppelt auf dem Bogen. */
    const places = (m.places && !m.label)
      ? '<span class="mnote-slot">' + esc(tx('ui.match.places', 'um Platz {places}', { places: m.places.join('/') }))
        + '</span>' : '';

    return '<td class="match' + (isBye ? ' is-bye' : '') + (m.displayOnly ? ' is-display-only' : '') + '"'
      + (m.displayOnly ? ' colspan="' + ctx.fields + '"' : '')
      + ' data-mid="' + esc(m.id) + '"'
      + (setMode != null ? ' data-set-mode="' + esc(setMode) + '"' : '')
      + (m.round != null ? ' data-round="' + m.round + '"' : '')
      + ' data-col="' + (m.field != null ? m.field : 0) + '"'
      + (m.slot != null ? ' data-slot="' + m.slot + '"' : '')
      + ' data-field-label="' + esc(m.displayOnly ? tx('ui.round.displayOnlyField', 'Kampfloses Ergebnis')
        : ctx.fieldLabel(m.field != null ? m.field : 0)) + '"'
      + (m.group ? ' data-group="' + esc(m.group) + '"' : '')
      + '>'
      + '<span class="pair">'
      + extra + places + referees
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
        + '<span class="mnote-slot" data-note></span>'
        + '<button type="button" class="outcome-btn noprint" data-outcome-btn hidden></button>')
      + '</span>'
      /* Platzhalter fuer die Freilos-Ansicht – wird erst bei einem Ausfall
         gefuellt (siehe paintByeCard).                                       */
      + '<span class="bye" hidden><button type="button" class="outcome-btn noprint" data-outcome-btn hidden></button></span></td>';
  }

  /* Freilos-/Ausfall-Ansicht einer Spielkarte – Darstellung wie im Bogen
     "Alle gegen Alle": das kampflos weiterkommende Team wird als Sieger
     hervorgehoben, unter der Karte stehen "Freilos" und der Teamname.
     info: { dead:bool, winner:Teamnummer|null }                              */
  function paintByeCard(td, info, ctx) {
    if (!td) return;
    const pair = td.querySelector('.pair');
    const byeEl = td.querySelector('.bye');
    const outcomeBtn = byeEl && byeEl.querySelector('[data-outcome-btn]');
    const note = td.querySelector('[data-note]');
    const dead = !!(info && info.dead);
    const winner = info ? info.winner : null;
    const active = dead || winner != null;

    td.classList.toggle('is-bye', active);
    if (!active) {
      if (pair) pair.hidden = false;
      if (byeEl) { byeEl.hidden = true; byeEl.innerHTML = ''; }
      if (byeEl && outcomeBtn) byeEl.appendChild(outcomeBtn);
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
    if (byeEl) {
      byeEl.hidden = false; byeEl.innerHTML = html;
      if (outcomeBtn) byeEl.appendChild(outcomeBtn);
    }
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
        + (s.displayOnly ? esc(tx('ui.round.displayOnly', 'Wertung · keine Spielzeit'))
          : s.startMin != null ? esc(fmtTime(s.startMin) + '–' + fmtTime(s.endMin)) : '')
        + '</span>'
        + '<span class="rmode">' + esc(tx('setMode.' + (s.setMode || ctx.setMode), ctx.modeLabel || '')) + '</span>';
      if (byes.length) {
        meta += '<span class="rbye">' + esc(tx('ui.round.sittingOut', 'spielfrei:')) + ' '
          + byes.map(t => '<span data-team="' + esc(t) + '">' + esc(ctx.teamLabel(t)) + '</span>').join(', ')
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
        + (s.displayOnly ? '' : confirmBtn)
        + '</span>'
        + '</span></td>';
      html += '<tr class="rgap" data-round="' + s.round + '" data-slot="' + s.slot + '" aria-hidden="true">'
        + '<td class="rgap-cell" colspan="' + nf + '"></td></tr>';
      html += '<tr class="rhead" data-round="' + s.round + '" data-slot="' + s.slot + '">' + head + '</tr>';

      if (s.displayOnly) {
        const m = (s.matches || []).filter(Boolean)[0];
        html += '<tr class="fhead" data-round="' + s.round + '" data-slot="' + s.slot + '">'
          + '<th scope="col" colspan="' + nf + '">' + esc(tx('ui.round.displayOnlyField', 'Kampfloses Ergebnis')) + '</th></tr>'
          + '<tr class="rmatches" data-round="' + s.round + '" data-slot="' + s.slot + '">'
          + (m ? matchCellHtml(Object.assign({}, m, { field: 0, round: s.round, slot: s.slot, displayOnly: true }), ctx)
            : '<td class="empty" colspan="' + nf + '"></td>')
          + '</tr>';
        return;
      }
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
    const requireComplete = td.hasAttribute('data-score-required');
    let invalid = false;
    td.querySelectorAll('input.score').forEach(inp => {
      if (inp.getAttribute('data-match-closed') === '1') {
        inp.disabled = false;
        inp.removeAttribute('data-match-closed');
      }
      inp.classList.remove('win', 'invalid');
      inp.removeAttribute('aria-invalid');
      const set = inp.getAttribute('data-set') || '1';
      (boxes[set] = boxes[set] || {})[inp.getAttribute('data-side')] = inp;
    });
    Object.keys(boxes).forEach(set => {
      const a = boxes[set].a, b = boxes[set].b;
      if (!a || !b || a.disabled || b.disabled) return;
      const ra = String(a.value || '').trim(), rb = String(b.value || '').trim();
      if (!requireComplete && ra === '' && rb === '') return;
      const column = a.closest('.sset');
      const target = (column && +column.getAttribute('data-target')) || TC.targetForSet(setMode, +set);
      const complete = /^[0-9]+$/.test(ra) && /^[0-9]+$/.test(rb);
      const va = Number(ra), vb = Number(rb);
      if ((!complete && (requireComplete || (ra !== '' && !/^[0-9]+$/.test(ra)) || (rb !== '' && !/^[0-9]+$/.test(rb))))
          || (complete && !TC.setValid(va, vb, target))) {
        invalid = true;
        [a, b].forEach(inp => {
          inp.classList.add('invalid');
          inp.setAttribute('aria-invalid', 'true');
        });
      } else if (!complete) {
        return;
      } else if (va > vb) a.classList.add('win');
      else if (vb > va) b.classList.add('win');
    });
    const def = TC.modeDef(setMode);
    if (def.matchWins) {
      let aWins = 0, bWins = 0, decided = false;
      Object.keys(boxes).sort((a, b) => Number(a) - Number(b)).forEach(set => {
        const a = boxes[set].a, b = boxes[set].b;
        if (!a || !b || decided || a.value === '' || b.value === '') return;
        const target = (a.closest('.sset') && +a.closest('.sset').getAttribute('data-target'))
          || TC.targetForSet(setMode, +set);
        const av = Number(a.value), bv = Number(b.value);
        if (!TC.setValid(av, bv, target)) return;
        if (av > bv) aWins++; else bWins++;
        if (aWins >= def.matchWins || bWins >= def.matchWins) decided = true;
        if (decided) {
          Object.keys(boxes).forEach(later => {
            if (+later <= +set) return;
            const nextA = boxes[later].a, nextB = boxes[later].b;
            const unused = !String(nextA.value || '').trim() && !String(nextB.value || '').trim();
            if (unused) {
              nextA.disabled = nextB.disabled = true;
              nextA.setAttribute('data-match-closed', '1');
              nextB.setAttribute('data-match-closed', '1');
            }
          });
        }
      });
    }
    if (requireComplete && !invalid) td.removeAttribute('data-score-required');
  }

  /* ============================================================ 5. TABELLE
     ranked: Ergebnis aus TC.rank() oder TC.rankWithCorrections().
     Bereits korrigierte Engine-Ränge bleiben maßgeblich; insbesondere dürfen
     verworfene manuelle Plätze nicht von der Darstellung reaktiviert werden.
     "shared" wird als "=" markiert, damit auf
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
    const correctionOptions = {};
    if (o.perGame != null) correctionOptions.perGame = per;
    if (o.rankingProfile != null) correctionOptions.rankingProfile = o.rankingProfile;
    if (o.complete != null) correctionOptions.complete = o.complete === true;
    const corrected = ranked.every(row => row.correctionsApplied)
      ? ranked : TC.rankWithCorrections(ranked, manual, correctionOptions);
    let rows = corrected.map((r, i) => ({
      orig: r,
      i: ranked.findIndex(source => source.team === r.team),
      team: r.team,
      dPts: r.dPts,
      dBd: r.dBd,
      hasPlace: r.hasPlace,
      place: r.place,
      shared: r.shared,
      effPts: r.effPts,
      effBd: r.effBd
    }));
    if (editable) {
      rows.sort((a, b) => (a.i - b.i));
    }

    const perSfx = per ? tx('ui.stand.perGame', '/Sp') : '';
    const deltaTitle = esc(tx('ui.manual.deltaTitle', 'Korrektur Δ – wird dauerhaft auf den berechneten Wert addiert'));
    const isTableTennis = activeSport && activeSport.id.indexOf('table-tennis.') === 0;
    const isNonBeach = activeSport && activeSport.id !== 'volleyball.beach';
    const pointLabel = !isNonBeach ? tx('ui.stand.balls', 'Bälle')
      : tx('ui.criteria.points', 'Punkte');
    const diffLabel = !isNonBeach ? tx('ui.stand.diff', 'Diff')
      : isTableTennis ? tx('ui.criteria.pointsDiff', 'Punktedifferenz')
        : tx('ui.criteria.bd', 'Ball-Differenz');
    let html = '<thead><tr>'
      + '<th class="pl">' + tx('ui.stand.place', 'Pl.') + '</th><th class="nm">' + participantWord() + '</th>'
      + '<th>' + tx('ui.stand.games', 'Sp.') + '</th><th>' + tx('ui.stand.won', 'S') + '</th>'
      + (o.showDraw ? '<th>' + tx('ui.stand.drawn', 'U') + '</th>' : '') + '<th>' + tx('ui.stand.lost', 'N') + '</th>'
      + '<th>' + tx('ui.stand.pts', 'Pkt') + perSfx + '</th>'
      + (isNonBeach ? '<th>' + unitWord() + '</th>' : '')
      + '<th>' + pointLabel + '</th>'
      + '<th>' + diffLabel + perSfx + '</th>'
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

      html += '<tr' + (row.shared ? ' class="is-tie"' : '') + ' data-team="' + esc(r.team) + '">';

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

      if (isNonBeach) html += '<td>' + s.setsFor + ':' + s.setsAgainst + '</td>';
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
          ? '<button type="button" class="mstd-reset-row" data-team="' + esc(r.team) + '" title="'
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
    const medal = !o.shared && RANK_MEDALS[p] ? RANK_MEDALS[p] + ' ' : '';
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
      const hasPlace = ov.place != null && Number.isInteger(Number(ov.place)) && Number(ov.place) >= 1;
      const place = hasPlace ? Number(ov.place) : p.place;
      const hasSource = ov.source != null && ov.source !== '';
      const source = hasSource ? ov.source : term(p.source || '');
      return {
        p, i, place, hasPlace, hasSource, source,
        unresolved: !!p.unresolved && !hasPlace,
        shared: !hasPlace && !!(p.shared || p.unresolved || p.placeTo != null || p.rangeLabel)
      };
    });
    /* Im Bearbeiten-Modus bleibt die Zeilenreihenfolge stehen (nur der Platz-
       Wert im Feld aktualisiert sich schon) – erst nach "Fertig" wird nach
       dem (ggf. korrigierten) Platz neu sortiert, damit Zeilen nicht schon
       waehrend der Eingabe springen. */
    if (!editable) rows.sort((a, b) => (a.place - b.place) || (a.i - b.i));
    rows.forEach(row => {
      if (rows.filter(other => other.place === row.place).length > 1) row.shared = true;
    });

    let html = '';
    rows.forEach(row => {
      const p = row.p;
      const placeLabel = row.hasPlace ? (row.place + '.') : (p.rangeLabel ? term(p.rangeLabel)
        : p.placeTo != null ? (p.place + '–' + p.placeTo + '.')
          : (p.place + '.' + (row.shared ? '=' : '')));
      const teamHtml = p.team != null
        ? (ctx && ctx.teamNameHtml ? ctx.teamNameHtml(p.team) : esc(ctx ? ctx.teamLabel(p.team) : String(p.team)))
        : '&nbsp;';
      html += '<tr' + (p.team != null ? ' data-team="' + esc(p.team) + '"' : '') + '>';
      if (editable) {
        html += '<td class="pl mstd-cell' + (row.hasPlace ? ' is-manual' : '') + '">'
          + '<input type="number" min="1" class="mstd-in" data-field="place" value="' + row.place + '"></td>'
          + '<td class="nm">' + teamHtml + '</td>'
          + '<td class="src mstd-cell' + (row.hasSource ? ' is-manual' : '') + '">'
          + '<input type="text" class="mstd-in mstd-text" data-field="source" value="' + esc(row.source) + '">'
          + (p.team != null && (row.hasPlace || row.hasSource)
              ? ' <button type="button" class="mstd-reset-row" data-team="' + esc(p.team) + '" title="'
                + esc(tx('ui.manual.resetRow', 'Zurücksetzen')) + '"><svg class="bl-ic" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg></button>'
              : '')
          + '</td>';
      } else {
        const plHtml = o.rankBadge !== false && p.team != null && !p.rangeLabel && p.placeTo == null && !row.shared
          ? rankBadgeHtml(row.place, { final: o.isFinal, manual: row.hasPlace })
          : esc(placeLabel);
        html += '<td class="pl' + (row.hasPlace ? ' is-manual' : '') + (row.shared ? ' pz-tie' : '') + '">' + plHtml + '</td>'
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

  function finalsStarted(plan, state) {
    return plan.finalRounds.some(round => round.matches.some(match => {
      const score = state.results[match.id];
      return !!(state.outcomes && state.outcomes[match.id])
        || !!(score && score.some(set => set.some(value => value != null && value !== '')));
    }));
  }

  function mountFinalQualification(container, options) {
    let signature = '';
    function paint() {
      const plan = options.plan();
      const state = options.get();
      const started = finalsStarted(plan, state);
      const uiState = TStore.initialUiState();
      const readOnly = !!(uiState && uiState.readOnly);
      container.ownerDocument.querySelectorAll('#teamCount, #groupCount, #finalMode, #setMode, #finalSetMode, '
        + '#ranking-profile-select, #outcome-profile-select, #btnToggleRankImport, #btnRankImportApply, '
        + '#btnClearAbsent, #absentGrid input, #absentGrid select, #absentGrid button, #nameGrid [data-remove-team], '
        + '#schedGrpBody [data-outcome-btn], #groupTables .mstd-toggle, #groupTables .mstd-in')
        .forEach(control => {
          if (started) {
            if (!control.hasAttribute('data-qualification-disabled')) {
              control.setAttribute('data-qualification-disabled', control.disabled ? '1' : '0');
            }
            control.disabled = true;
          } else if (control.hasAttribute('data-qualification-disabled')) {
            control.disabled = control.getAttribute('data-qualification-disabled') === '1';
            control.removeAttribute('data-qualification-disabled');
          }
        });
      const resolution = plan.placementResolution;
      const ties = resolution && resolution.ties ? resolution.ties : [];
      const next = JSON.stringify([ties, started, ties.map(teams => teams.map(options.label))]);
      container.hidden = readOnly || (!ties.length && !started);
      if (next === signature) return;
      signature = next;
      container.innerHTML = started
        ? '<p>' + esc(tx('qualification.started', 'Die Finalrunde hat bereits Eingaben. Bitte zuerst die Finalrunde zurücksetzen, bevor du die Qualifikation änderst.'))
          + '</p><button type="button" class="nbtn" data-qualification-reset>'
          + esc(tx('qualification.reset', 'Finalrunde zurücksetzen')) + '</button>'
        : ties.length
        ? '<h2>' + esc(tx('qualification.title', 'Losentscheid für die Finalsetzung')) + '</h2>'
          + '<p>' + esc(tx('qualification.hint', 'Nur gleichplatzierte Teams mit gleicher Vergleichswertung werden hier geordnet. Den Losentscheid außerhalb der App durchführen und die gezogene Reihenfolge vollständig eintragen.')) + '</p>'
          + ties.map((teams, index) => '<fieldset data-qualification-tie="' + index + '"><legend>'
            + esc(teams.map(options.label).join(' / ')) + '</legend>'
            + teams.map((team, position) => '<label class="cfgfield"><span>'
              + esc(tx('qualification.position', 'Losplatz {n}', { n: position + 1 }))
              + '</span><select data-qualification-position="' + position + '">'
              + '<option value="">' + esc(tx('qualification.choose', 'Team wählen')) + '</option>'
              + teams.map(t => '<option value="' + t + '">' + esc(options.label(t)) + '</option>').join('')
              + '</select></label>').join('') + '</fieldset>').join('')
          + '<button type="button" class="nbtn" data-qualification-confirm>'
          + esc(tx('qualification.confirm', 'Losentscheid übernehmen')) + '</button>'
        : '';
    }
    container.addEventListener('click', async event => {
      const uiState = TStore.initialUiState();
      if (uiState && uiState.readOnly) return;
      const reset = event.target.closest('[data-qualification-reset]');
      if (reset) {
        if (!root.confirm(tx('qualification.resetConfirm', 'Alle Ergebnisse und Sonderwertungen der Finalrunde sowie den Losentscheid löschen? Die Vorrundenergebnisse bleiben erhalten.'))) return;
        const state = options.get();
        const previous = {
          results: state.results, outcomes: state.outcomes, config: state.config,
          manualPlacements: state.manualPlacements, manualStandings: state.manualStandings
        };
        const finalIds = new Set(options.plan().finalRounds.flatMap(round => round.matches.map(match => match.id)));
        state.results = Object.assign({}, state.results);
        state.outcomes = Object.assign({}, state.outcomes);
        finalIds.forEach(id => { delete state.results[id]; delete state.outcomes[id]; });
        state.config = Object.assign({}, state.config);
        delete state.config.qualificationOrder;
        if (state.config.planning && state.config.planning.locked) {
          const locked = Object.assign({}, state.config.planning.locked);
          finalIds.forEach(id => { delete locked[id]; });
          state.config.planning = Object.assign({}, state.config.planning, { locked });
        }
        state.manualPlacements = {};
        state.manualStandings = Object.assign({}, state.manualStandings);
        Object.keys(state.manualStandings).filter(key => key.indexOf('main-') === 0)
          .forEach(key => { delete state.manualStandings[key]; });
        reset.disabled = true;
        if (await options.save() === false) {
          Object.assign(state, previous);
          reset.disabled = false;
          return;
        }
        options.rebuild();
        return;
      }
      const button = event.target.closest('[data-qualification-confirm]');
      if (!button) return;
      if (finalsStarted(options.plan(), options.get())) {
        root.alert(tx('qualification.started', 'Die Finalrunde hat bereits Eingaben. Bitte zuerst die Finalrunde zurücksetzen, bevor du die Qualifikation änderst.'));
        return;
      }
      const order = [];
      for (const fieldset of container.querySelectorAll('[data-qualification-tie]')) {
        const values = Array.from(fieldset.querySelectorAll('select')).map(select => Number(select.value));
        if (values.some(value => !Number.isInteger(value) || value < 1)
            || new Set(values).size !== values.length) {
          root.alert(tx('qualification.invalid', 'Bitte jedes Team des Gleichstands genau einmal auswählen.'));
          return;
        }
        order.push.apply(order, values);
      }
      const state = options.get();
      const previous = state.config.qualificationOrder;
      state.config.qualificationOrder = order;
      button.disabled = true;
      if (await options.save() === false) {
        if (previous === undefined) delete state.config.qualificationOrder;
        else state.config.qualificationOrder = previous;
        button.disabled = false;
        return;
      }
      options.rebuild();
    });
    return { paint };
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
    const isTableTennis = activeSport && activeSport.id.indexOf('table-tennis.') === 0;
    const isNonBeach = activeSport && activeSport.id !== 'volleyball.beach';
    const names = { pts: tx('ui.criteria.pts', 'Punkte'), ptsPer: tx('ui.criteria.ptsPer', 'Punkte je Spiel'),
      bd: tx(isNonBeach ? 'ui.criteria.pointsDiff' : 'ui.criteria.bd', isNonBeach ? 'Punktedifferenz' : 'Ball-Differenz'),
      bdPer: tx(isNonBeach ? 'ui.criteria.pointsDiffPer' : 'ui.criteria.bdPer', isNonBeach ? 'Punktedifferenz je Match' : 'Ball-Differenz je Spiel'),
      won: tx('ui.criteria.won', 'Siege'), lost: tx('ui.criteria.lost', 'Niederlagen'),
      matchDiff: tx('ui.criteria.matchDiff', 'Matchpunktedifferenz'),
      h2h: tx('ui.criteria.h2h', 'direkter Vergleich'),
      setRatio: tx('ui.criteria.setRatio', 'Satzquotient'), pointRatio: tx('ui.criteria.pointRatio', 'Ballpunktquotient'),
      ballsFor: tx(isNonBeach ? 'ui.criteria.points' : 'ui.criteria.ballsFor', isNonBeach ? 'Punkte' : 'erzielte Bälle'),
      ballsForPer: tx('ui.criteria.ballsForPer', 'erzielte Bälle je Spiel'),
      sd: tx(isTableTennis ? 'ui.criteria.gamesDiff' : 'ui.criteria.sd',
        isTableTennis ? 'Spieldifferenz' : 'Satzdifferenz'),
      sdPer: tx(isTableTennis ? 'ui.criteria.gamesDiffPer' : 'ui.criteria.sdPer',
        isTableTennis ? 'Spieldifferenz je Match' : 'Satzdifferenz je Spiel') };
    if (TC.activeRanking() === 'tt-dttb-swiss-ranking-2026') {
      return tx('sport.ranking.tableTennisSwissNote', 'DTTB WO D7.6: Siege → Buchholz → direkter Vergleich (nur zwei Gleichstehende) → offizieller Losentscheid. Freilos = ein Sieg ohne Spiel-/Punktgutschrift; Buchholz zählt die Siege aller bisherigen Gegner, für ein Freilos die Siege des Tabellenletzten. Zwischenstände: nur Siege/Buchholz. Kein Feinbuchholz. Mehrfachgleichstände bleiben offen zur offiziellen Entscheidung. Eine endgültige D7.9-Entscheidung wegen Nichtantretens nach Zeit-/Aufrufprüfung oder vorzeitiger Aufgabe erhält alle bisherigen Siege und beendet die weitere Teilnahme; für jede tatsächlich fortgesetzte spätere Runde wird eine kampflose Niederlage gewertet. Vorübergehende Abwesenheit oder Verletzung allein ist keine solche Entscheidung; die allgemeine Abwesenheitsmarkierung und andere Sonderausgänge blockieren die D7.6-Wertung. Ohne bereits feststehende Paarung werden weder Gegner noch Buchholzbeitrag oder Spielstand erfunden. Ein feststehendes künftiges Spiel bleibt unverändert und wird als D7.10-Walkover aufgezeichnet. Paarungen sind App-Vorschläge, keine zertifizierte DTTB-Auslosung: Turnierleitung muss Setzung, Sieggruppen und Absteiger prüfen. Keine Prüfung der Doppel-Aufschlag-/Schlagreihenfolge. Manuelle Tabellenkorrekturen sind hier deaktiviert.');
    }
    if (TC.activeRanking() === 'tt-ittf-individual-groups-2026') {
      return tx('sport.ranking.tableTennisIttfGroupsNote',
        'ITTF Statutes 2026 §§3.7.4.4/3.7.5: nur Gruppen-/Qualifikationsphasen im Einzel-/Doppelwettbewerb; der Hauptevent ist KO. 2 Matchpunkte für Sieg, 1 für Niederlage im gespielten Match. Bei Gleichstand Mini-Tabelle nur unter den Gleichstehenden: Matchpunkte → Spielquotient → Punktquotient; nach jeder Teilauflösung wird mit den verbleibenden Gleichstehenden neu gerechnet. Freilose, Abwesenheit und Sonderausgänge sperren die Wertung; eine unvollständige Gruppe qualifiziert nicht weiter. Der offizielle Losentscheid bleibt manuell. Das Schluss-Spielpaar nach §3.7.5.5 bzw. eine Jury-Ausnahme werden nicht geplant oder geprüft; bitte den Spielplan fachlich prüfen. Nicht für Swiss, Modified Pool Play oder den KO-Hauptevent.');
    }
    if (TC.activeRanking() === 'tt-dttb-individual-round-robin-2026') {
      return tx('ui.criteria.hintDttb',
        'DTTB WO D7.5: Siege → weniger Niederlagen → globale Spieldifferenz → globale Punktedifferenz → direkter Vergleich (Matchpunkt-, Spiel- und Punktedifferenz). Ein verbleibender Gleichstand bleibt geteilt; offizieller Losentscheid erforderlich.',
        { list: criteria.map(c => names[c] || c).join(' → ') });
    }
    return tx('ui.criteria.hint', 'Reihenfolge bei Gleichstand: {list} → Losentscheid. Ein „=“ hinter dem Platz bedeutet: hier entscheidet das Los.',
      { list: criteria.map(c => names[c] || c).join(' → ') });
  }

  function dttbSwissTableHtml(plan, ctx) {
    const label = key => esc(tx(key, key));
    let html = '<thead><tr><th>' + esc(participantWord()) + '</th><th>'
      + label('ui.rank.place') + '</th><th>' + label('ui.criteria.won')
      + '</th><th>Buchholz</th>';
    plan.rounds.forEach(rd => { html += '<th>R' + rd.round + '<br>'
      + label('sport.ranking.swissRound') + '</th>'; });
    html += '</tr></thead><tbody>';
    const started = plan.table.played.length > 0;
    plan.table.ranked.forEach(e => {
      const place = !started || e.unsupported ? '–' : String(e.place) + (e.shared ? '=' : '.');
      html += '<tr data-team="' + e.team + '"><td>' + cardNameHtml(e.team, e.team, ctx)
        + '</td><td>' + place + '</td><td>' + e.stat.won + '</td><td>' + e.stat.buchholz + '</td>';
      plan.rounds.forEach(rd => {
        const table = plan.tableUpto(rd.round);
        const m = rd.matches.find(match => match.a === e.team || match.b === e.team);
        const bye = table.played.some(match => match.bye === e.team);
        let value = '';
        if (rd.bye === e.team && bye) value = label('rs.swiss.byeWin');
        else if (m && m.result) {
          const won = (m.result.winner === 'a' ? m.a : m.b) === e.team;
          value = label(won ? 'rs.swiss.win' : 'rs.swiss.loss');
          value += ' ' + (m.a === e.team ? m.result.aSets : m.result.bSets)
            + ':' + (m.a === e.team ? m.result.bSets : m.result.aSets);
        }
        if (value) value += '<br>Σ ' + table.stat[e.team].won + ' / ' + table.stat[e.team].buchholz;
        html += '<td>' + value + '</td>';
      });
      html += '</tr>';
    });
    return html + '</tbody>';
  }

  /* ================================================== 6. LAUFENDE TABELLE
     Kumulierte Punkte/Differenz je Runde – die Spalte, die vor Ort mit dem
     Stift fortgeschrieben wird. Die blaue Musterzeile bleibt erhalten.       */
  function trackTableHtml(teams, roundCount, ctx, opts) {
    const o = opts || {};
    const ptsLabel = o.ptsLabel || tx('ui.track.pts', 'Punkte');
    const bdLabel = activeSport && activeSport.id !== 'volleyball.beach'
      ? tx('ui.criteria.pointsDiff', 'Punktedifferenz') : tx('ui.track.bd', 'Ball-Differenz');
    const winPts = o.winPts || 1; // Punkte je Sieg (für Musterzeile)
    const participantHeader = activeSport && activeSport.id !== 'volleyball.beach'
      ? participantWord() + ' / ' + tx('ui.track.name', 'Name') : tx('ui.track.team', 'Team / Name');
    let html = '<thead><tr><th class="tname teamcol">' + participantHeader + '</th><th class="lbl">'
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
      + '<span class="t-line">' + participantWord() + ' X</span><span class="tnm t-nm">' + tx('ui.track.teamName', '(Teamname)') + '</span>'
      + '</td><td class="lbl">' + ptsLabel + '</td>';
    ptsEx.forEach(v => html += '<td>' + v + '</td>');
    html += '<td class="mstd-actcol noprint"></td><td class="pos" rowspan="2">3.</td>'
      + '<td class="mstd-actcol mstd-rowact noprint" rowspan="2"></td></tr>';
    html += '<tr class="ex ex-end"><td class="lbl">' + bdLabel + '</td>';
    bdExArr.forEach(v => html += '<td>' + (v > 0 ? '+' : '') + v + '</td>');
    html += '<td class="mstd-actcol noprint"></td></tr>';
    /* Team-Zeilen */
    teams.forEach(t => {
      html += '<tr class="grp" data-team="' + esc(t) + '" data-line="pts">'
        + '<td class="tname teamcol" rowspan="2" data-team-name="' + esc(t) + '"><span class="t-line">Team ' + esc(t) + '</span></td>'
        + '<td class="lbl">' + ptsLabel + '</td>';
      for (let r = 1; r <= roundCount; r++) html += '<td class="rcell" data-round="' + r + '"></td>';
      html += '<td class="mstd-cell noprint" data-corr="dPts"></td>'
        + '<td class="pos" rowspan="2" data-pos></td>'
        + '<td class="mstd-actcol mstd-rowact noprint" rowspan="2" data-actcol></td></tr>';
      html += '<tr data-team="' + esc(t) + '" data-line="bd"><td class="lbl">' + bdLabel + '</td>';
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
    return '<button type="button" class="team-del" data-remove-team="' + esc(t) + '"'
      + (canRemove ? '' : ' disabled')
      + ' title="' + esc(canRemove ? tx('ui.team.deleteTitle', 'Team endgültig löschen')
        : tx('ui.team.deleteMin', 'Mindestanzahl an Teams erreicht'))
      + '" aria-label="' + esc(tx('ui.team.deleteAria', '{label} endgültig entfernen', { label: label })) + '">'
      + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>'
      + '</button>';
  }
  function namePanelHtml(teams, teamNames, opts) {
    const o = opts || {};
    const record = teamNames && teamNames.teamNames ? teamNames : null;
    if (record) teamNames = record.teamNames;
    const canRemove = o.removable && (o.minTeams == null || teams.length > o.minTeams);
    return teams.map(t => {
      const row = '<label class="nrow"><span class="nnum">' + t + '</span>'
        + '<input type="text" data-name-input="' + esc(t) + '" value="' + esc(teamNames[t] || '')
        + '" aria-label="' + esc(participantWord() + ' ' + t) + '" placeholder="' + esc(participantWord()) + ' ' + t + '" autocomplete="off" spellcheck="false"></label>'
        + pairPanelHtml(record, t);
      if (!o.removable) return row;
      return '<div class="nrow-del">' + row
        + teamDelBtnHtml(t, displayName(record || teamNames, t) || (participantWord() + ' ' + t), canRemove) + '</div>';
    }).join('');
  }
  function pairPanelHtml(record, team) {
    if (!TSport || !TSport.supportsPairMembers(record) || !record) return '';
    const members = TSport.pairMembers(record, team);
    const hasMembers = members.some(Boolean);
    return '<div class="pair-editor">' + [0, 1].map(index =>
      '<label><span>' + esc(tx('ui.pair.player', 'Spieler:in {n}', { n: index + 1 })) + '</span>'
      + '<input type="text" maxlength="100" data-pair-team="' + esc(team)
      + '" data-pair-index="' + index + '" value="' + esc(members[index])
      + '" placeholder="' + esc(tx('ui.pair.optional', 'Name (optional)'))
      + '" autocomplete="off" spellcheck="false"></label>').join('')
      + '<output data-pair-label="' + esc(team) + '"' + (hasMembers ? '' : ' hidden') + '>'
      + esc(TSport.teamLabel(record, team, participantWord() + ' ' + team))
      + '</output></div>';
  }
  function editParticipantName(record, input) {
    const before = JSON.stringify([record.teamNames, record.pairMembers]);
    const team = input.getAttribute && input.getAttribute('data-pair-team');
    if (team && TSport.supportsPairMembers(record)) {
      record.pairMembers = record.pairMembers || {};
      const members = TSport.pairMembers(record, team);
      members[+input.getAttribute('data-pair-index')] = input.value.trim().slice(0, 100);
      if (members.some(Boolean)) record.pairMembers[team] = members;
      else delete record.pairMembers[team];
    } else {
      const key = input.getAttribute && input.getAttribute('data-name-input');
      if (!key) return false;
      if (input.value.trim()) record.teamNames[key] = input.value.trim();
      else delete record.teamNames[key];
    }
    if (root.document) {
      root.document.querySelectorAll('[data-pair-label]').forEach(output => {
        const id = output.getAttribute('data-pair-label');
        output.hidden = !TSport.pairMembers(record, id).some(Boolean);
        output.textContent = TSport.teamLabel(record, id, participantWord() + ' ' + id);
      });
    }
    return before !== JSON.stringify([record.teamNames, record.pairMembers]);
  }
  function wireParticipantNames(container, getRecord, changed) {
    ['input', 'change'].forEach(event => container.addEventListener(event, e => {
      if (editParticipantName(getRecord(), e.target)) changed();
    }));
  }
  function shuffleParticipantNames(record, teams) {
    if (participantOrderLocked(record)) return;
    const entries = teams.map(team => ({ name: record.teamNames[team], members: (record.pairMembers || {})[team] }));
    for (let i = entries.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [entries[i], entries[j]] = [entries[j], entries[i]];
    }
    record.teamNames = {}; record.pairMembers = {};
    entries.forEach((entry, index) => {
      if (entry.name) record.teamNames[teams[index]] = entry.name;
      if (entry.members) record.pairMembers[teams[index]] = entry.members;
    });
  }
  function participantOrderLocked(record) {
    return TStore.anyResults(record) || ['frozen', 'frozenModes', 'manualStandings', 'manualPlacements']
      .some(key => Object.keys(record[key] || {}).length > 0);
  }
  function fieldPanelHtml(count, fieldNames) {
    let html = '';
    for (let f = 0; f < count; f++) {
      html += '<label class="nrow"><span class="nnum">' + (f + 1) + '</span>'
        + '<input type="text" data-field-input="' + f + '" value="' + esc(fieldNames[f] || '')
        + '" placeholder="' + esc(surfaceLabel(f + 1)) + '" autocomplete="off" spellcheck="false"></label>';
    }
    return html;
  }
  function absentPanelHtml(teams, absent, ctx, opts) {
    const set = new Set(absent || []);
    const o = opts || {};
    const delays = o.teamDelays || {};
    const canRemove = o.removable && (o.minTeams == null || teams.length > o.minTeams);
    return teams.map(t => {
      const label = ctx.teamLabel(t);
      const delay = delays[t] && delays[t].time ? String(delays[t].time) : '';
      const isAbsent = set.has(t);
      const status = isAbsent ? 'absent' : delay ? 'late' : 'available';
      const allowDelay = o.teamDelay !== false;
      const arrivalActions = allowDelay && status === 'late'
        ? '<div class="team-arrival-actions" data-team-arrival-actions>'
          + '<div class="team-arrival-buttons">'
          + '<button type="button" class="nbtn" data-team-arrival-confirm>' + esc(tx('ui.team.arrival.confirm', 'Ankunft bestätigen')) + '</button>'
          + '</div><p>' + esc(tx('ui.team.arrival.hint',
            'Setzt das Team auf „Dabei“ und plant offene Spiele ab jetzt neu.')) + '</p></div>'
        : '';
      const card = '<div class="absent-row team-status-card" data-team-status-card="' + esc(t) + '">'
        + '<strong class="team-status-name">' + esc(label) + '</strong>'
        + '<label class="team-status-select cfgfield"><select data-team-status="' + esc(t) + '" aria-label="'
        + esc(tx('ui.team.status.label', 'Teamstatus für {label}', { label: label })) + '"' + (allowDelay ? '' : ' data-no-delay')
        + '><option value="available"' + (status === 'available' ? ' selected' : '') + '>'
        + esc(tx('ui.team.status.available', 'Dabei')) + '</option>'
        + (allowDelay ? '<option value="late"' + (status === 'late' ? ' selected' : '') + '>'
          + esc(tx('ui.team.status.lateOption', 'Verspätet')) + '</option>' : '')
        + '<option value="absent"' + (status === 'absent' ? ' selected' : '') + '>'
        + esc(tx('ui.team.status.absent', 'Ausgefallen')) + '</option></select></label>'
        + '<span class="team-status-badge is-' + status + '" data-team-status-badge>'
        + esc(tx('ui.team.status.' + status, status === 'late' ? 'Verspätet · {time}' : status === 'absent' ? 'Ausgefallen' : 'Dabei',
          status === 'late' ? { time: delay } : undefined)) + '</span>'
        + (o.removable ? teamDelBtnHtml(t, label, canRemove) : '')
        + arrivalActions
        + (allowDelay ? teamDelayEditorHtml(delay, status === 'late') : '')
        + '</div>';
      return card;
    }).join('');
  }
  function clearTeamAbsences(state) {
    if (!state || typeof state !== 'object') return;
    state.absent = [];
    const planning = state.config && state.config.planning;
    if (!planning || typeof planning !== 'object') return;
    delete planning.teamDelays;
    if (!Object.keys(planning).length) delete state.config.planning;
  }
  function teamDelayEditorHtml(time, open) {
    return '<div class="team-delay-editor" data-team-delay-editor' + (open ? '' : ' hidden') + '>'
      + '<label class="cfgfield"><span class="cfg-lbl">' + esc(tx('ui.team.delay.readyAt', 'Spielbereit ab')) + '</span>'
      + '<input type="time" step="300" data-team-delay-time value="' + esc(time || '') + '" required></label>'
      + '<button type="button" class="nbtn" data-team-delay-save>' + esc(tx('planning.apply', 'Übernehmen')) + '</button>'
      + '<button type="button" class="nbtn" data-team-delay-cancel>' + esc(tx('planning.cancel', 'Abbrechen')) + '</button>'
      + '<p class="planning-error" role="alert" data-team-delay-error></p></div>';
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
    tbody.classList.toggle('show-all-rounds', filter === 'all');
    const page = typeof location === 'undefined' ? '' : location.pathname + location.search;
    if (tbody.getAttribute('data-round-state-page') !== page) {
      tbody.setAttribute('data-round-state-page', page);
      tbody.removeAttribute('data-opened-round');
      if (tbody.__checkedMatches) tbody.__checkedMatches.clear();
      if (tbody.__confirmedMatches) tbody.__confirmedMatches.clear();
    }
    if (filter !== 'all') {
      tbody.setAttribute('data-opened-round', String(Math.max(+tbody.getAttribute('data-opened-round') || 0, +filter || 0)));
    }
    tbody.querySelectorAll('tr[data-round]').forEach(tr => {
      const r = tr.getAttribute('data-round');
      tr.hidden = !(filter === 'all' || String(r) === String(filter));
    });
    markRoundStatus(tbody);
  }

  function markRoundStatus(tbody) {
    if (!tbody) return;
    const opened = +tbody.getAttribute('data-opened-round') || 0;
    const rounds = {};
    const begun = {};
    tbody.querySelectorAll('td.match[data-round]').forEach(td => {
      if (Array.prototype.some.call(td.querySelectorAll('input.score'), inp =>
        !inp.disabled && String(inp.value || '').trim() !== '')) begun[td.getAttribute('data-round')] = true;
    });
    tbody.querySelectorAll('td.match[data-round]').forEach(td => {
      const round = td.getAttribute('data-round');
      const active = Array.prototype.slice.call(td.querySelectorAll('input.score')).filter(inp => !inp.disabled);
      const needed = active.length > 0 || (!td.classList.contains('is-bye') && !!td.querySelector('input.score'));
      const confirmed = tbody.__confirmedMatches && tbody.__confirmedMatches.has(td.getAttribute('data-mid'));
      const checked = confirmed || (begun[round] && tbody.__checkedMatches
        && tbody.__checkedMatches.has(td.getAttribute('data-mid')));
      const required = checked || +round < opened;
      if (required) td.setAttribute('data-score-required', '');
      else td.removeAttribute('data-score-required');
      markScoreInputs(td, td.getAttribute('data-set-mode'));
      const invalid = active.some(inp => inp.classList.contains('invalid'))
        || (needed && !active.length && required);
      const complete = !needed || (active.length > 0 && active.every(inp => String(inp.value || '').trim() !== '') && !invalid);
      td.classList.toggle('bl-match-invalid', invalid);
      td.classList.toggle('bl-match-valid', active.length > 0 && complete);
      const summary = rounds[round] || (rounds[round] = { open: 0, invalid: 0, checked: false });
      summary.checked = summary.checked || invalid || +round < opened;
      if (!complete) {
        if (!active.length || active.some(inp => String(inp.value || '').trim() === '')) summary.open++;
        else summary.invalid++;
      }
    });
    tbody.querySelectorAll('tr[data-round]:not(.rgap)').forEach(tr => {
      const round = tr.getAttribute('data-round');
      const summary = rounds[round];
      const checked = !!(summary && summary.checked);
      const incomplete = summary && (summary.open > 0 || summary.invalid > 0);
      tr.classList.toggle('bl-round-invalid', checked && incomplete);
      tr.classList.toggle('bl-round-valid', checked && !incomplete);
      const head = tr.querySelector('.rhead-meta');
      if (!head) return;
      let status = head.querySelector('.bl-round-status');
      if (checked && !status) {
        status = document.createElement('button');
        status.type = 'button';
        status.className = 'bl-round-status noprint';
        head.appendChild(status);
      }
      if (status) {
        const text = !checked ? '' : incomplete ? roundProblemsText(summary) : tx('ui.round.complete', 'Ergebnisse vollständig');
        status.hidden = !checked;
        status.disabled = !incomplete;
        status.setAttribute('data-round-errors', round);
        const title = incomplete ? tx('ui.round.errorsJump', 'Zum ersten fehlenden oder ungültigen Ergebnis springen') : '';
        if (status.title !== title) status.title = title;
        const label = title ? text + '. ' + title : text;
        if (status.getAttribute('aria-label') !== label) status.setAttribute('aria-label', label);
        if (status.textContent !== text) status.textContent = text;
      }
    });
    updateRoundWarnings(tbody, rounds);
  }

  function roundProblemsText(summary) {
    const parts = [];
    if (summary.open) parts.push(tx('ui.round.openCount',
      { one: '{count} Spiel offen', other: '{count} Spiele offen' }, { count: summary.open }));
    if (summary.invalid) parts.push(tx('ui.round.invalidCount',
      { one: '{count} Ergebnis ungültig', other: '{count} Ergebnisse ungültig' }, { count: summary.invalid }));
    return parts.join(' · ');
  }

  function focusRoundProblem(tbody, round) {
    const problem = Array.prototype.find.call(tbody.querySelectorAll('td.match[data-round]'),
      td => td.getAttribute('data-round') === round && td.classList.contains('bl-match-invalid'));
    if (!problem) return;
    const active = Array.prototype.filter.call(problem.querySelectorAll('input.score'), inp => !inp.disabled);
    const target = active.find(inp => String(inp.value || '').trim() === '')
      || active.find(inp => inp.classList.contains('invalid'));
    if (target) {
      target.focus();
      target.select();
      target.scrollIntoView({ block: 'center', inline: 'nearest' });
    } else {
      problem.setAttribute('tabindex', '-1');
      problem.focus();
      problem.scrollIntoView({ block: 'center', inline: 'nearest' });
    }
  }

  function updateRoundWarnings(tbody, rounds) {
    const wrapper = tbody.closest('.table-scroll');
    const bar = wrapper && wrapper.previousElementSibling;
    if (!bar || !bar.classList.contains('schedule-roundbar')) return;
    const select = bar.querySelector('[data-round-select]');
    if (!select) return;
    Array.prototype.forEach.call(select.options, option => {
      if (option.value === 'all') return;
      const summary = rounds[option.value];
      const complete = summary && !summary.open && !summary.invalid;
      const problem = summary && summary.checked && !complete;
      const label = tx('ui.round.n', 'Runde {n}', { n: option.value })
        + (complete ? ' – ' + tx('ui.round.complete', 'Ergebnisse vollständig')
          : problem ? ' – ' + roundProblemsText(summary) : '');
      if (option.textContent !== label) option.textContent = label;
    });
    let warnings = wrapper.nextElementSibling;
    if (!warnings || !warnings.classList.contains('bl-round-warnings')) warnings = null;
    const problems = Object.keys(rounds).filter(round => rounds[round].checked
      && (rounds[round].open || rounds[round].invalid));
    if (!warnings && problems.length) {
      warnings = document.createElement('div');
      warnings.className = 'bl-round-warnings noprint';
      wrapper.parentNode.insertBefore(warnings, wrapper.nextSibling);
    }
    if (warnings) {
      const html = problems.map(round => '<button type="button" data-round-warning="' + esc(round)
        + '" aria-label="' + esc(tx('ui.round.n', 'Runde {n}', { n: round }) + ': '
          + roundProblemsText(rounds[round]) + '. '
          + tx('ui.round.errorsJump', 'Zum ersten fehlenden oder ungültigen Ergebnis springen'))
        + '"><span aria-hidden="true">!</span> '
        + esc(tx('ui.round.n', 'Runde {n}', { n: round }) + ': ' + roundProblemsText(rounds[round]))
        + '</button>').join('');
      warnings.hidden = !problems.length;
      if (warnings.innerHTML !== html) warnings.innerHTML = html;
    }
    if (warnings && !warnings.__roundWarningWired) {
      warnings.__roundWarningWired = true;
      warnings.addEventListener('click', event => {
        const button = event.target.closest ? event.target.closest('[data-round-warning]') : null;
        if (!button) return;
        event.preventDefault();
        const round = button.getAttribute('data-round-warning');
        const currentSelect = bar.querySelector('[data-round-select]');
        currentSelect.value = round;
        currentSelect.dispatchEvent(new Event('change', { bubbles: true }));
        focusRoundProblem(tbody, round);
      });
    }
  }

  function wireSectionToggle(content, trigger, closeContainer, options) {
    if (!content || !trigger || !closeContainer || content.__sectionToggleWired) return null;
    options = options || {};
    content.__sectionToggleWired = true;
    const related = options.relatedContent || [];
    const controls = [content.id].concat(related.map(function (panel) { return panel.id; })).join(' ');

    const close = content.ownerDocument.createElement('button');
    close.type = 'button';
    close.className = 'mt-clock-close section-toggle-close noprint';
    close.setAttribute('data-i18n-attr', 'aria-label:' + options.hideKey);
    close.setAttribute('aria-label', tx(options.hideKey, options.hideText || 'Hide section'));
    close.setAttribute('aria-controls', controls);
    close.innerHTML = '<svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9"/><path d="m9 9 6 6m0-6-6 6"/></svg>';
    if (options.closeFirst && closeContainer === content && content.parentNode) {
      close.classList.add('section-toggle-close--external');
      content.parentNode.insertBefore(close, content);
    } else if (options.closeFirst) closeContainer.insertBefore(close, closeContainer.firstChild);
    else closeContainer.appendChild(close);

    const label = content.ownerDocument.createElement('span');
    label.setAttribute('data-i18n', options.showKey);
    label.textContent = tx(options.showKey, options.showText || 'Show section');
    trigger.removeAttribute('data-i18n');
    trigger.classList.add('section-toggle-open');
    trigger.innerHTML = '<svg class="nico section-toggle-eye" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg>';
    trigger.appendChild(label);
    trigger.setAttribute('data-i18n-attr', 'aria-label:' + options.showKey);
    trigger.setAttribute('aria-label', tx(options.showKey, options.showText || 'Show section'));
    trigger.setAttribute('aria-controls', controls);
    const I = i18n();
    if (I) I.apply(trigger);

    const prefKey = 'BEACHL.uiSection.v1:'
      + (root.location ? root.location.pathname : '') + ':' + (options.preferenceId || content.id);
    let initial = options.defaultExpanded !== false;
    try {
      const saved = root.localStorage && root.localStorage.getItem(prefKey);
      if (saved === '0') initial = false;
      else if (saved === '1') initial = true;
    } catch (e) {}

    function setExpanded(expanded, save, focus) {
      content.hidden = !expanded;
      trigger.hidden = expanded;
      close.hidden = !expanded;
      if (options.collapsedContent) options.collapsedContent.hidden = expanded;
      related.forEach(function (panel) {
        panel.classList.toggle('section-content-collapsed', !expanded);
      });
      trigger.setAttribute('aria-expanded', String(expanded));
      close.setAttribute('aria-expanded', String(expanded));
      if (save) {
        try {
          if (root.localStorage) root.localStorage.setItem(prefKey, expanded ? '1' : '0');
        } catch (e) {}
      }
      if (focus) {
        if (!expanded) trigger.focus();
        else {
          const target = options.focusTarget || (options.focusSelector ? content.querySelector(options.focusSelector) : close);
          (target || close).focus();
        }
      }
    }

    trigger.addEventListener('click', function () { setExpanded(true, true, true); });
    close.addEventListener('click', function () { setExpanded(false, true, true); });
    setExpanded(initial, false, false);
    return { trigger, close, setExpanded };
  }

  function wireFormatInfo(doc) {
    if (!doc) return;
    const buttons = doc.querySelectorAll('[data-format-info-toggle]');
    for (let i = 0; i < buttons.length; i++) {
      const button = buttons[i];
      const content = doc.getElementById(button.getAttribute('aria-controls'));
      if (!content) continue;
      wireSectionToggle(content, button, content, {
        closeFirst: true,
        defaultExpanded: button.getAttribute('aria-expanded') === 'true',
        preferenceId: 'details-' + content.id,
        showKey: 'ui.section.detailsShow',
        hideKey: 'ui.section.detailsHide',
        showText: 'Wertung & Details anzeigen',
        hideText: 'Wertung & Details ausblenden'
      });
    }
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
    const def = TC.modeDef(setMode);
    const drawPossible = TC.isMulti(setMode) && !def.matchWins && !TC.hasDecidingSet(setMode);
    const profile = TC.activeProfile();
    const ranking = TC.activeRanking();
    const strict = ranking === 'indoor-fivb-2026' || ranking === 'indoor-dvv-bso-2026';
    const officialBo5 = strict && def.matchWins === 3;
    const indoorPoints = ranking === 'indoor-3-2-1-0' || (ranking === 'indoor-fivb-2026' && !officialBo5);
    const winPoints = indoorPoints ? 3 : TC.WIN_PTS;
    const lossPoints = indoorPoints ? 0 : TC.LOSS_PTS;
    const setLabel = profile.indexOf('table-tennis.') === 0 ? 'Spiel' : 'Satz';
    let w = '<table><caption>' + tx('ui.scoring.caption', 'Wertung pro Spiel') + '</caption>'
      + '<tr><th>' + tx('ui.scoring.result', 'Ergebnis') + '</th><th>' + tx('ui.scoring.value', 'Wertung') + '</th></tr>'
      + '<tr><td>' + tx(indoorPoints ? 'ui.scoring.clearWin' : 'ui.scoring.win', indoorPoints ? 'Sieg ohne Satzverlust' : 'Sieg') + '</td><td>' + tx('ui.scoring.pts', { one: '{count} Punkt', other: '{count} Punkte' }, { count: winPoints }) + '</td></tr>';
    if (officialBo5) {
      w = '<table><caption>' + tx('ui.scoring.caption', 'Wertung pro Spiel') + '</caption>'
        + '<tr><th>' + tx('ui.scoring.result', 'Ergebnis') + '</th><th>' + tx('ui.scoring.value', 'Wertung') + '</th></tr>'
        + '<tr><td>' + tx('ui.scoring.win30', 'Sieg 3:0 oder 3:1') + '</td><td>' + tx('ui.scoring.pts', { one: '{count} Punkt', other: '{count} Punkte' }, { count: 3 }) + '</td></tr>'
        + '<tr><td>' + tx('ui.scoring.win32', 'Sieg 3:2') + '</td><td>' + tx('ui.scoring.pts', { one: '{count} Punkt', other: '{count} Punkte' }, { count: 2 }) + '</td></tr>'
        + '<tr><td>' + tx('ui.scoring.loss23', 'Niederlage 2:3') + '</td><td>' + tx('ui.scoring.pts', { one: '{count} Punkt', other: '{count} Punkte' }, { count: 1 }) + '</td></tr>'
        + '<tr><td>' + tx('ui.scoring.loss03', 'Niederlage 0:3 oder 1:3') + '</td><td>' + tx('ui.scoring.pts', { one: '{count} Punkt', other: '{count} Punkte' }, { count: 0 }) + '</td></tr></table>';
    }
    if (indoorPoints) {
      w += '<tr><td>' + tx('ui.scoring.closeWin', 'Sieg mit Satzverlust') + '</td><td>' + tx('ui.scoring.pts', { one: '{count} Punkt', other: '{count} Punkte' }, { count: 2 }) + '</td></tr>'
       + '<tr><td>' + tx('ui.scoring.closeLoss', 'Niederlage mit Satzgewinn') + '</td><td>' + tx('ui.scoring.pts', { one: '{count} Punkt', other: '{count} Punkte' }, { count: 1 }) + '</td></tr>';
    }
    if (drawPossible) w += '<tr><td>' + tx('ui.scoring.draw', 'Unentschieden') + '</td><td>' + tx('ui.scoring.pts', { one: '{count} Punkt', other: '{count} Punkte' }, { count: TC.DRAW_PTS }) + '</td></tr>';
    w += '<tr><td>' + tx(indoorPoints ? 'ui.scoring.clearLoss' : 'ui.scoring.loss', indoorPoints ? 'Niederlage ohne Satzgewinn' : 'Niederlage') + '</td><td>' + tx('ui.scoring.pts', { one: '{count} Punkt', other: '{count} Punkte' }, { count: lossPoints }) + '</td></tr>'
      + '<tr><td>' + tx('ui.scoring.bye', 'Freilos / spielfrei') + '</td><td>' + tx(profile.indexOf('table-tennis.') === 0 ? 'ui.scoring.byePtsGeneric' : 'ui.scoring.byePts', profile.indexOf('table-tennis.') === 0 ? '{count} Punkte, ohne Punktedifferenz' : '{count} Punkte, ohne Ball-Differenz', { count: winPoints }) + '</td></tr>'
      + '</table>';

    const tableTennis = profile.indexOf('table-tennis.') === 0;
    const names = { pts: tx('ui.criteria.pts', 'Punkte'), ptsPer: tx('ui.criteria.ptsPer', 'Punkte je Spiel'),
      bd: tableTennis ? tx('ui.criteria.pointsDiff', 'Punktedifferenz') : tx('ui.criteria.bd', 'Ball-Differenz'),
      bdPer: tableTennis ? tx('ui.criteria.pointsDiffPer', 'Punktedifferenz je Match') : tx('ui.criteria.bdPer', 'Ball-Differenz je Spiel'),
      sd: tableTennis ? tx('ui.criteria.gamesDiff', 'Spieldifferenz') : tx('ui.criteria.sd', 'Satzdifferenz'),
      sdPer: tableTennis ? tx('ui.criteria.gamesDiffPer', 'Spieldifferenz je Match') : tx('ui.criteria.sdPer', 'Satzdifferenz je Spiel'),
      won: tx('ui.criteria.won', 'Siege'), wonPer: tx('ui.criteria.wonPer', 'Siege je Spiel'),
      h2h: tx('ui.criteria.h2h', 'direkter Vergleich'),
      ballsFor: tx('ui.scoring.ballsFor', 'erzielte Ballpunkte'), ballsForPer: tx('ui.scoring.ballsForPer', 'erzielte Ballpunkte je Spiel') };
    const chain = (criteria || ['pts', 'bd', 'ballsFor', 'h2h']).slice();
    let t = '<table><caption>' + tx('ui.scoring.tieCaption', 'Reihenfolge bei Gleichstand') + '</caption>'
      + '<tr><th>' + tx('ui.scoring.rank', 'Rang') + '</th><th>' + tx('ui.scoring.criterion', 'Kriterium') + '</th></tr>';
    chain.forEach((c, i) => {
      t += '<tr><td>' + (i + 1) + '</td><td>' + esc(names[c] || c) + '</td></tr>';
    });
    t += '<tr><td>' + (chain.length + 1) + '</td><td>' + (strict
      ? tx('ui.scoring.officialDecision', 'Offene Entscheidung nach Regelwerk («=» in der Tabelle, kein Losentscheid)')
      : tx('ui.scoring.lots', 'Losentscheid («=» in der Tabelle)')) + '</td></tr></table>';

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
    function editing() {
      const el = document.activeElement;
      const active = el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)
        && !el.disabled && !el.readOnly && !/^(checkbox|radio|button)$/.test(el.type);
      bar.classList.toggle('is-editing', !!active);
    }
    document.addEventListener('focusin', editing);
    document.addEventListener('focusout', function () { setTimeout(editing, 0); });
    bar.addEventListener('click', e => {
      const el = e.target.closest ? e.target.closest('[data-jump],[data-jump-print]') : null;
      if (!el) return;
      if (el.hasAttribute('data-jump-print')) { window.print(); return; }
      const target = document.getElementById(el.getAttribute('data-jump'));
      if (target) {
        const header = document.querySelector('.app-bar');
        const sticky = header && /sticky|fixed/.test(getComputedStyle(header).position);
        const offset = sticky ? header.getBoundingClientRect().height + 12 : 12;
        window.scrollTo({ top: Math.max(0, target.getBoundingClientRect().top + window.pageYOffset - offset), behavior: 'smooth' });
      }
    });
  }

  /* ============================================ 8b. SPIELENTSCHEIDUNGEN
     Default/Spielabbruch nach FIVB-Regel 6.4 (siehe core/turnier-outcome.js).
     Die gespielten Sätze (S.results) bleiben unverändert; die Entscheidung
     ist ein getrennter, versionierter Datensatz (S.outcomes). Er wirkt erst,
     wenn er „endgültig“ bestätigt ist.                                        */
  function outcomeApi() {
    return root.TOutcome || (typeof require === 'function' ? require('./turnier-outcome.js') : null);
  }
  const OUTCOME_ERRORS = {
    'unsupported-mode': ['Für diesen Spielmodus ist die gewählte Regel nicht umgesetzt.', 'outcome.err.unsupportedMode'],
    'scores-not-allowed': ['Bei einem Default dürfen keine Satzergebnisse eingetragen sein. Zuerst die Eingaben leeren.', 'outcome.err.scoresNotAllowed'],
    'match-already-decided': ['Das Spiel ist bereits durch gespielte Sätze entschieden; eine Entscheidung ist nicht nötig.', 'outcome.err.alreadyDecided'],
    'partial-set-complete': ['Der letzte Satz ist bereits regulär beendet; bitte ihn als gespielten Satz belassen und das Spiel nur dann abbrechen, wenn weitere Sätze fehlen.', 'outcome.err.partialComplete'],
    'invalid-partial-set': ['Der unterbrochene Satz hat einen ungültigen Zwischenstand (Punkte fehlen oder erreichen das Satzziel).', 'outcome.err.invalidPartial'],
    'invalid-completed-set': ['Ein abgeschlossener Satz ist kein gültiges Satzergebnis.', 'outcome.err.invalidCompleted'],
    'missing-set': ['Zwischen den eingetragenen Sätzen fehlt ein Satz.', 'outcome.err.missingSet'],
    'too-many-sets': ['Es sind mehr Sätze eingetragen, als der Modus zulässt.', 'outcome.err.tooManySets'],
    'unsupported-kind': ['Diese Art der Entscheidung (z. B. Aufgabe, Disqualifikation) ist nicht umgesetzt.', 'outcome.err.unsupportedKind']
  };
  function outcomeError(code) {
    const e = OUTCOME_ERRORS[code];
    return e ? tx(e[1], e[0]) : tx('outcome.err.invalid', 'Die Entscheidung ist ungültig ({code}).', { code: String(code) });
  }
  function setsText(sets) {
    return sets.map(function (s) { return s[0] + ':' + s[1]; }).join(', ');
  }
  function paintOutcome(td, state, id, modeId) {
    const O = outcomeApi();
    if (!td || !O) return;
    const btn = td.classList.contains('is-bye')
      ? td.querySelector('.bye [data-outcome-btn]') : td.querySelector('.pair [data-outcome-btn]');
    if (!btn) return;
    const policy = state && state.config && state.config.outcomeProfile;
    const st = O.statusFor(state, id, modeId);
    const policySupportsMode = !!(policy && O.supportsMode(policy, modeId));
    const inputs = Array.prototype.slice.call(td.querySelectorAll('input.score'));
    const open = inputs.some(function (i) { return !i.disabled; });
    td.removeAttribute('data-outcome');
    btn.hidden = !(st.state !== 'none' || (policySupportsMode && (open || td.classList.contains('is-bye'))));
    if (btn.hidden) return;
    btn.textContent = st.state === 'none'
      ? tx('outcome.btn.add', 'Entscheidung …') : tx('outcome.btn.edit', 'Entscheidung ändern');
    if (st.state === 'none') return;
    td.setAttribute('data-outcome', st.state);
    const note = td.querySelector('[data-note]');
    let text;
    if (st.state === 'invalid') {
      text = outcomeError(st.code);
    } else {
      const o = st.outcome;
      const bits = [tx('outcome.kind.' + o.kind, o.kind === 'default' ? 'Default' : 'Spielabbruch'),
        tx('outcome.reason.' + o.reason, o.reason)];
      const r = st.result;
      bits.push(tx('outcome.badge.awarded', 'Wertung {score}', { score: r.aSets + ':' + r.bSets }));
      bits.push(st.state === 'applied' ? tx('outcome.status.final', 'endgültig')
        : tx('outcome.status.provisionalShort', 'vorläufig – zählt noch nicht'));
      text = bits.join(' · ');
      if (o.kind === 'default') {
        inputs.forEach(function (i) { i.disabled = true; });
      }
    }
    if (note) { note.textContent = text; note.className = 'mnote-slot outcome-note'; }
  }

  function closeOutcomeDialog() {
    const doc = root.document;
    const old = doc && doc.getElementById('outcome-dialog-overlay');
    if (old) {
      const back = old._returnFocus;
      old.parentNode.removeChild(old);
      if (back && back.focus) back.focus();
    }
  }
  function openOutcomeDialog(ctx) {
    const O = outcomeApi();
    const doc = root.document;
    const state = ctx.state;
    const id = ctx.id;
    const modeId = ctx.modeId;
    const policyId = (state.config && state.config.outcomeProfile)
      || (state.outcomes && state.outcomes[id] && state.outcomes[id].policy);
    if (!O || !policyId) return;
    closeOutcomeDialog();
    const existing = state.outcomes && state.outcomes[id] ? state.outcomes[id] : null;
    const kindNow = existing ? existing.kind : 'default';
    const overlay = doc.createElement('div');
    overlay.id = 'outcome-dialog-overlay';
    overlay.className = 'outcome-overlay noprint';
    overlay._returnFocus = doc.activeElement;
    const sideOpt = function (side) {
      const name = side === 'a' ? ctx.nameA : ctx.nameB;
      return '<option value="' + side + '"' + (existing && existing.loser === side ? ' selected' : '') + '>'
        + esc(name) + '</option>';
    };
    const radio = function (name, value, label, checked) {
      return '<label class="outcome-radio"><input type="radio" name="' + name + '" value="' + value + '"'
        + (checked ? ' checked' : '') + '> <span>' + esc(label) + '</span></label>';
    };
    overlay.innerHTML = '<div class="outcome-dialog" role="dialog" aria-modal="true" aria-labelledby="outcome-title" tabindex="-1">'
      + '<h2 id="outcome-title">' + esc(tx('outcome.dialog.title', 'Spielentscheidung')) + '</h2>'
      + '<p class="outcome-match">' + esc(ctx.nameA) + ' – ' + esc(ctx.nameB) + '</p>'
      + '<p class="outcome-policy">' + esc(tx('outcome.policy.' + policyId, policyId)) + '</p>'
      + '<fieldset><legend>' + esc(tx('outcome.field.kind', 'Art')) + '</legend>'
      + radio('outcome-kind', 'default', tx('outcome.kind.default', 'Default'), kindNow === 'default')
      + radio('outcome-kind', 'incomplete', tx('outcome.kind.incomplete', 'Spielabbruch'), kindNow === 'incomplete')
      + '</fieldset>'
      + '<p class="outcome-hint" data-hint></p>'
      + '<label class="outcome-field"><span>' + esc(tx('outcome.field.loser', 'Verursachendes Team (Verlierer)')) + '</span>'
      + '<select data-f="loser">' + sideOpt('a') + sideOpt('b') + '</select></label>'
      + '<label class="outcome-field"><span>' + esc(tx('outcome.field.reason', 'Grund')) + '</span><select data-f="reason"></select></label>'
      + '<label class="outcome-field"><span>' + esc(tx('outcome.field.authority', 'Entschieden durch')) + '</span><select data-f="authority">'
      + O.AUTHORITIES.map(function (a) {
        return '<option value="' + a + '"' + (existing && existing.authority === a ? ' selected' : '') + '>'
          + esc(tx('outcome.authority.' + a, a)) + '</option>';
      }).join('') + '</select></label>'
      + '<fieldset><legend>' + esc(tx('outcome.field.status', 'Status')) + '</legend>'
      + radio('outcome-status', 'provisional', tx('outcome.status.provisional', 'Vorläufig – zählt noch nicht für Tabelle und Weiterkommen'), !existing || existing.status !== 'final')
      + radio('outcome-status', 'final', tx('outcome.status.final2', 'Endgültig bestätigt – wird gewertet'), !!existing && existing.status === 'final')
      + '</fieldset>'
      + '<label class="outcome-field"><span>' + esc(tx('outcome.field.note', 'Notiz (optional)')) + '</span>'
      + '<input type="text" data-f="note" maxlength="' + O.MAX_NOTE + '" value="' + esc(existing ? existing.note : '') + '"></label>'
      + '<p class="outcome-preview" data-preview aria-live="polite"></p>'
      + '<p class="outcome-error" data-error role="alert"></p>'
      + '<p class="outcome-hint">' + esc(tx('outcome.hint.scope', 'Disqualifikation und Aufgabe werden nicht automatisch gewertet; ihr Umfang entscheidet die Schiedsrichter- bzw. Turnierleitung.')) + '</p>'
      + '<div class="outcome-actions">'
      + '<button type="button" data-act="save" class="primary">' + esc(tx('outcome.act.save', 'Speichern')) + '</button>'
      + '<button type="button" data-act="cancel">' + esc(tx('outcome.act.cancel', 'Abbrechen')) + '</button>'
      + (existing ? '<button type="button" data-act="remove">' + esc(tx('outcome.act.remove', 'Entscheidung entfernen')) + '</button>' : '')
      + '</div></div>';
    doc.body.appendChild(overlay);
    const dlg = overlay.querySelector('.outcome-dialog');
    const field = function (n) { return overlay.querySelector('[data-f="' + n + '"]'); };
    const checked = function (n) { const el = overlay.querySelector('input[name="' + n + '"]:checked'); return el ? el.value : ''; };
    const fillReasons = function () {
      const kind = checked('outcome-kind');
      const sel = field('reason');
      const keep = existing && existing.kind === kind ? existing.reason : sel.value;
      sel.innerHTML = O.REASONS[kind].map(function (r) {
        return '<option value="' + r + '"' + (r === keep ? ' selected' : '') + '>' + esc(tx('outcome.reason.' + r, r)) + '</option>';
      }).join('');
      overlay.querySelector('[data-hint]').textContent = kind === 'default'
        ? tx('outcome.hint.default', 'Default: Sieger erhält alle benötigten Sätze mit 0:Satzziel (Indoor 3×25:0, Beach 2×21:0). Es dürfen keine Satzergebnisse eingetragen sein.')
        : tx('outcome.hint.incomplete', 'Spielabbruch: gespielte Sätze und den Zwischenstand des unterbrochenen Satzes in die Satzfelder eintragen; die erzielten Punkte bleiben erhalten, fehlende Sätze erhält der Gegner mit 0:Satzziel.');
    };
    const candidate = function () {
      return O.create({
        kind: checked('outcome-kind'), loser: field('loser').value, reason: field('reason').value,
        authority: field('authority').value, status: checked('outcome-status'),
        note: field('note').value.trim(), decidedAt: new Date().toISOString()
      }, policyId);
    };
    const preview = function () {
      const c = candidate();
      const ev = O.evaluate(c, state.results && state.results[id], modeId);
      overlay.querySelector('[data-preview]').textContent = ev.ok
        ? tx('outcome.preview', 'Wertung: {score} (Sätze {sets})', { score: ev.result.aSets + ':' + ev.result.bSets, sets: setsText(ev.result.awardedSets) })
        : '';
      overlay.querySelector('[data-error]').textContent = ev.ok ? '' : outcomeError(ev.code);
      return ev;
    };
    fillReasons();
    preview();
    overlay.addEventListener('change', function (e) {
      if (e.target && e.target.name === 'outcome-kind') fillReasons();
      preview();
    });
    overlay.addEventListener('input', preview);
    const close = closeOutcomeDialog;
    const canChange = function (next) {
      const check = O.validateChange(state, id, next, ctx.buildPlan);
      if (!check.ok) {
        overlay.querySelector('[data-error]').textContent = tx('outcome.err.downstreamInputs',
          'Diese Entscheidung würde die Teams in Spielen mit Eingaben ändern. Zuerst die betroffenen nachfolgenden Ergebnisse und Entscheidungen leeren: {matches}.',
          { matches: check.affected.join(', ') });
      }
      return check.ok;
    };
    overlay.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.preventDefault(); close(); } });
    overlay.addEventListener('click', function (e) {
      const act = e.target && e.target.getAttribute && e.target.getAttribute('data-act');
      if (e.target === overlay || act === 'cancel') { close(); return; }
      if (act === 'remove') {
        if (!canChange(null)) return;
        delete state.outcomes[id];
        close();
        ctx.changed();
        return;
      }
      if (act === 'save') {
        const ev = preview();
        if (!ev.ok) return;
        const next = candidate();
        if (!canChange(next)) return;
        state.outcomes = state.outcomes || {};
        state.outcomes[id] = next;
        close();
        ctx.changed();
      }
    });
    dlg.focus();
  }
  /* Delegierter Klick auf die Entscheidungs-Schaltflächen einer Spielkarte. */
  function wireOutcomes(rootEl, opts) {
    if (!rootEl || rootEl.getAttribute('data-outcome-wired') === '1') return;
    rootEl.setAttribute('data-outcome-wired', '1');
    rootEl.addEventListener('click', function (e) {
      const btn = e.target && e.target.closest ? e.target.closest('[data-outcome-btn]') : null;
      if (!btn || btn.disabled) return;
      const td = btn.closest('td.match');
      if (!td) return;
      const a = td.querySelector('.pside-a .t'), b = td.querySelector('.pside-b .t');
      openOutcomeDialog({
        state: opts.state(), id: td.getAttribute('data-mid'), modeId: td.getAttribute('data-set-mode'),
        nameA: a ? a.textContent.replace(/\s+/g, ' ').trim() : 'A', nameB: b ? b.textContent.replace(/\s+/g, ' ').trim() : 'B',
        buildPlan: opts.buildPlan,
        changed: function () {
          const sel = root.document.getElementById('outcome-profile-select');
          const st = opts.state();
          if (sel && st) sel.disabled = Object.keys(st.outcomes || {}).length > 0;
          opts.changed();
        }
      });
    });
  }

  /* Auswahl des Regelwerks für Default/Spielabbruch (nur Volleyball). */
  function mountOutcomeControls(section, profile, opts) {
    const O = outcomeApi();
    if (!O || !profile.outcomeProfiles || !profile.outcomeProfiles.length) return;
    let box = root.document.getElementById('outcome-profile-controls');
    if (!box) {
      box = root.document.createElement('div');
      box.id = 'outcome-profile-controls';
      box.className = 'sport-profile-controls';
      box.innerHTML = '<label class="cfgfield"><span data-cap></span><select id="outcome-profile-select"></select></label>'
        + '<p class="sport-profile-note" data-note1></p>';
      const setup = section.querySelector('[data-cfg-options]')
        || section.querySelector('.cfg-action-groups')
        || section.querySelector('.cfg-setup-content') || section;
      setup.appendChild(box);
    }
    const select = box.querySelector('select');
    box.querySelector('[data-cap]').textContent = tx('outcome.select.label', 'Nichtantreten und Spielabbruch');
    select.innerHTML = '<option value="">' + esc(tx('outcome.select.none', 'Ohne Sonderwertung')) + '</option>'
      + profile.outcomeProfiles.map(function (pid) {
        return '<option value="' + esc(pid) + '">' + esc(tx('outcome.policy.' + pid, pid)) + '</option>';
      }).join('');
    box.querySelector('[data-note1]').textContent = tx('outcome.select.note',
      'Optional für FIVB-Hallen-Best-of-5 und Beach-Best-of-3 (2×21, Entscheidungssatz bis 15). Nur endgültig bestätigte Entscheidungen zählen.');
    const record = opts.getTournament ? opts.getTournament() : null;
    select.value = record && record.config && record.config.outcomeProfile ? record.config.outcomeProfile : '';
    const uiState = root.TStore && root.TStore.initialUiState();
    const locked = record && record.outcomes && Object.keys(record.outcomes).length > 0;
    select.disabled = !!(uiState && uiState.readOnly) || !opts.getTournament || !opts.repaint || !!locked;
    select.title = locked ? tx('outcome.select.locked', 'Erst alle Entscheidungen entfernen, dann kann die Regel geändert werden.') : '';
    if (select.getAttribute('data-bound') === '1') return;
    select.setAttribute('data-bound', '1');
    select.addEventListener('change', function () {
      const state = opts.getTournament && opts.getTournament();
      if (!state || !state.config) return;
      const previous = state.config.outcomeProfile || null;
      if (select.hasAttribute('data-qualification-disabled')) {
        select.value = previous || '';
        root.alert(tx('qualification.started', 'Die Finalrunde hat bereits Eingaben. Bitte zuerst die Finalrunde zurücksetzen, bevor du die Qualifikation änderst.'));
        return;
      }
      state.config.outcomeProfile = select.value || null;
      Promise.resolve(opts.save ? opts.save(state) : TStore.save(state)).then(function (saved) {
        if (!saved) { state.config.outcomeProfile = previous; select.value = previous || ''; return; }
        opts.repaint();
      }).catch(function (error) {
        state.config.outcomeProfile = previous;
        select.value = previous || '';
        root.console.error('Outcome profile could not be saved', error);
      });
    });
  }

  /* =============================================== 9. EINGABE-VERDRAHTUNG
     Ein einziger delegierter Listener für alle Score-Felder. „:“ und Enter
     springen ins nächste Kästchen; bei Fokus wird der Inhalt markiert.       */
  function wireScoreInputs(rootEl, onChange) {
    if (!rootEl) return;
    let lastFocusedMatch = null;
    rootEl.__checkedMatches = new Set();
    rootEl.__confirmedMatches = new Set();
    let focusedPage = typeof location === 'undefined' ? '' : location.pathname + location.search;
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
      const ins = Array.prototype.slice.call(td.querySelectorAll('input.score')).filter(inp => !inp.disabled);
      if (!ins.length) return false;
      const matchId = td.getAttribute('data-mid');
      const mode = setMode || (onChange.setMode ? onChange.setMode(matchId) : null);
      rootEl.__checkedMatches.add(matchId);
      rootEl.__confirmedMatches.add(matchId);
      td.setAttribute('data-score-required', '');
      markScoreInputs(td, mode);
      const bad = ins.filter(inp => inp.classList.contains('invalid'));
      if (bad.length) {
        const first = bad.find(inp => String(inp.value || '').trim() === '') || bad[0];
        first.focus();
        first.select();
        return false;
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
        const page = typeof location === 'undefined' ? '' : location.pathname + location.search;
        if (page !== focusedPage) {
          focusedPage = page;
          lastFocusedMatch = null;
          rootEl.__checkedMatches.clear();
          rootEl.__confirmedMatches.clear();
        }
        score.select();
        const card = score.closest ? score.closest('td.match') : null;
        if (card) {
          const round = +card.getAttribute('data-round') || 0;
          const opened = +rootEl.getAttribute('data-opened-round') || 0;
          const moved = lastFocusedMatch && lastFocusedMatch.getAttribute('data-mid') !== card.getAttribute('data-mid');
          if (round > opened) rootEl.setAttribute('data-opened-round', String(round));
          if (moved) {
            rootEl.__checkedMatches.add(lastFocusedMatch.getAttribute('data-mid'));
          }
          if (moved || round > opened) markRoundStatus(rootEl);
          lastFocusedMatch = card;
        }
      }
    });
    rootEl.addEventListener('input', e => {
      const el = e.target;
      if (!el.classList || !el.classList.contains('score')) return;
      const card = el.closest ? el.closest('td.match[data-round]') : null;
      const round = card ? +card.getAttribute('data-round') || 0 : 0;
      if (round > (+rootEl.getAttribute('data-opened-round') || 0)) {
        rootEl.setAttribute('data-opened-round', String(round));
      }
      const raw = el.value;
      const jump = /[:\s]/.test(raw);
      const digits = raw.replace(/[^0-9]/g, '');
      el.value = TC.activeProfile().indexOf('table-tennis.') === 0 ? digits : digits.slice(0, 3);
      onChange(el.getAttribute('data-mid'), +el.getAttribute('data-set'),
        el.getAttribute('data-side'), el.value);
      markRoundStatus(rootEl);
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
      const target = TC.targetForSet(onChange.setMode(el.getAttribute('data-mid')), setNo);
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
    rootEl.addEventListener('mousedown', e => {
      if (e.target && e.target.closest && e.target.closest('[data-round-confirm]')) e.preventDefault();
    });
    rootEl.addEventListener('click', e => {
      const status = e.target && e.target.closest ? e.target.closest('[data-round-errors]') : null;
      if (status && !status.disabled) {
        e.preventDefault();
        const round = status.getAttribute('data-round-errors');
        focusRoundProblem(rootEl, round);
        return;
      }
      const roundBtn = e.target && e.target.closest
        ? e.target.closest('[data-round-confirm]')
        : null;
      if (roundBtn) {
        e.preventDefault();
        const round = roundBtn.getAttribute('data-round-confirm');
        const slot = roundBtn.getAttribute('data-round-confirm-slot');
        const activeCard = document.activeElement && document.activeElement.closest
          ? document.activeElement.closest('td.match')
          : null;
        const inSlot = td => td && String(td.getAttribute('data-round')) === String(round)
          && (slot == null || String(td.getAttribute('data-slot')) === String(slot));
        const lastCard = lastFocusedMatch && rootEl.querySelector('td.match[data-mid="' + lastFocusedMatch.getAttribute('data-mid') + '"]');
        const current = inSlot(lastCard)
          ? lastCard
          : (inSlot(activeCard) ? activeCard : null);
        let td = current || rootEl.querySelector('td.match[data-round="' + round + '"]'
          + (slot == null ? '' : '[data-slot="' + slot + '"]'));
        if (!td) return;
        const mid = td.getAttribute('data-mid');
        const focused = document.activeElement;
        if (focused && focused.classList.contains('score')) {
          focused.dispatchEvent(new Event('change', { bubbles: true }));
          td = rootEl.querySelector('td.match[data-mid="' + mid + '"]');
        }
        if (!td) return;
        if (!validateCard(td, onChange.setMode ? onChange.setMode(td.getAttribute('data-mid')) : null)) return;
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
    const targetSig = scoreSig(list[j]);
    el.blur();
    const now = fresh();
    const anchor = el.isConnected ? el : document.querySelector(sig);
    const k = anchor ? now.indexOf(anchor) : -1;
    const replacement = targetSig ? document.querySelector(targetSig) : null;
    const target = k >= 0 ? now[k + dir] : replacement && now.indexOf(replacement) >= 0 ? replacement : null;
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

  function visibleScoreFields() {
    return Array.prototype.slice.call(document.querySelectorAll('input.score'))
      .filter(inp => !inp.disabled && !inp.readOnly && inp.getClientRects().length);
  }
  function stepScoreFocus(el, dir) {
    return focusStep(el, visibleScoreFields(), dir, visibleScoreFields);
  }
  function focusScoreTarget(from, to) {
    const sig = scoreSig(to);
    if (!sig) return false;
    if (from && from.blur) from.blur();
    const target = document.querySelector(sig);
    if (!target || target.disabled || target.readOnly || !target.getClientRects().length) return false;
    target.focus();
    target.select();
    return true;
  }

  /* Only a focus/viewport change may reveal an edited score. Ordinary scrolling
     must neither steal focus nor pull the user back to the current game. */
  function wireScoreViewport() {
    if (document.body.__scoreViewport) return document.body.__scoreViewport;
    let queued = false;
    function reveal() {
      queued = false;
      const active = document.activeElement;
      const editing = active && active.matches && active.matches('input.score:not(:disabled)')
        && !active.readOnly;
      const mobile = window.matchMedia('(max-width: 960px)').matches;
      const viewport = window.visualViewport;
      const height = viewport ? viewport.height : window.innerHeight;
      const offset = viewport ? viewport.offsetTop : 0;
      document.body.classList.toggle('score-editing', !!editing && mobile);
      document.body.classList.toggle('score-short-viewport', !!editing && mobile && height < 420);
      document.body.style.setProperty('--score-keyboard-bottom',
        Math.max(0, window.innerHeight - offset - height) + 'px');
      document.body.style.setProperty('--score-viewport-top', offset + 'px');
      if (!editing || !mobile || window.matchMedia('print').matches) return;
      let top = offset + 8, bottom = offset + height - 8;
      document.querySelectorAll('.app-bar,.schedule-roundbar').forEach(bar => {
        const r = bar.getBoundingClientRect();
        if (/sticky|fixed/.test(getComputedStyle(bar).position) && r.bottom > top && r.top < bottom) {
          top = Math.max(top, r.bottom + 8);
        }
      });
      const toast = document.getElementById('bl-toast');
      if (toast && toast.getClientRects().length && toast.classList.contains('show')) {
        const r = toast.getBoundingClientRect();
        /* The feedback slides upward by 16px while appearing. Reserve its
           final footprint, even on the first frame with opacity still zero. */
        if (r.top > top && r.top < bottom) bottom = r.top - 24;
      }
      const r = active.getBoundingClientRect();
      const card = active.closest('td.match,.kqmatch');
      const names = card && card.querySelector('.pnames');
      if (names && /sticky/.test(getComputedStyle(names).position)) {
        top = Math.max(top, names.getBoundingClientRect().bottom + 8);
      }
      const context = names ? names.getBoundingClientRect().top : card ? card.getBoundingClientRect().top : r.top;
      const start = names && /sticky/.test(getComputedStyle(names).position) ? r.top
        : r.bottom - context <= bottom - top ? context : r.top;
      const delta = r.bottom > bottom ? r.bottom - bottom : start < top ? start - top : 0;
      if (delta) window.scrollBy(0, delta);
    }
    function scheduleReveal() {
      if (queued) return;
      queued = true;
      window.requestAnimationFrame(reveal);
    }
    document.addEventListener('focusin', scheduleReveal);
    document.addEventListener('focusout', scheduleReveal);
    window.addEventListener('resize', scheduleReveal);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', scheduleReveal);
    document.body.__scoreViewport = scheduleReveal;
    return scheduleReveal;
  }

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
  function timeTableHtml(slots, endLabel, pauses) {
    const rows = (slots || []).filter(s => !s.displayOnly)
      .map(s => ({ min: s.startMin, t: fmtTime(s.startMin), n: slotTitle(s) }));
    (pauses || []).forEach(p => rows.push({ min: p.startMin, pause: true,
      t: fmtTime(p.startMin) + '–' + fmtTime(p.endMin),
      n: tx('planning.pauseRow', 'Pause') }));
    rows.sort((a, b) => a.min - b.min);
    if (endLabel) rows.push({ t: endLabel.time, n: endLabel.text });
    const half = Math.ceil(rows.length / 2);
    const thTime = esc(tx('ui.timeplan.time', 'Zeit'));
    const thRound = esc(tx('ui.round.word', 'Runde'));
    let html = '<table class="timeplan"><caption>' + esc(tx('ui.timeplan.caption', 'Zeitplan')) + '</caption><thead><tr>'
      + '<th>' + thTime + '</th><th>' + thRound + '</th><th>' + thTime + '</th><th>' + thRound + '</th></tr></thead><tbody>';
    for (let i = 0; i < half; i++) {
      const a = rows[i], b = rows[i + half];
      const cells = r => '<td' + (r && r.pause ? ' class="planning-pause"' : '') + '>' + (r ? esc(r.t) : '') + '</td><td'
        + (r && r.pause ? ' class="planning-pause"' : '') + '>' + (r ? esc(r.n) : '') + '</td>';
      html += '<tr>' + cells(a) + cells(b) + '</tr>';
    }
    return html + '</tbody></table>';
  }

  function fillKpiNote(id, text) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    el.hidden = !text;
  }

  function setKpi(id, text, warn) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    const item = el.closest('.cfgres-item');
    if (item) item.classList.toggle('is-warn', !!warn);
  }

  function buttonFeedback(button, message) {
    // Keep the SVG and responsive label wrapper intact during transient feedback.
    const label = button.querySelector('.lbl,[data-i18n]');
    if (!label) return;
    if (!button._feedbackOriginal) button._feedbackOriginal = {
      label: label.textContent, aria: button.getAttribute('aria-label')
    };
    clearTimeout(button._feedbackTimer);
    label.textContent = message;
    button.setAttribute('aria-label', message);
    button._feedbackTimer = setTimeout(() => {
      const original = button._feedbackOriginal;
      label.textContent = original.label;
      if (original.aria == null) button.removeAttribute('aria-label');
      else button.setAttribute('aria-label', original.aria);
      button._feedbackOriginal = null;
    }, 1500);
  }

  function planningRounds(plan, setMode) {
    const phases = plan.groupRounds
      ? [{ rounds: plan.groupRounds, mode: setMode, group: true },
        { rounds: plan.finalRounds, mode: plan.finalSetMode, group: false }]
      : [{ rounds: plan.finalRounds || plan.rounds || [], mode: plan.finalSetMode || setMode, group: false }];
    const rounds = [];
    phases.forEach(phase => (phase.rounds || []).forEach(sourceRound => {
      const round = Object.assign({}, sourceRound, {
        matches: (sourceRound.matches || []).filter(match => {
          if (!match || match.bye != null) return false;
          if (phase.group) return !match.dead;
          if (match.dead) return false;
          const fullyDeadMpp = match.mppLoserAware
            && match.a && match.a.k === 'bye' && match.b && match.b.k === 'bye';
          return !fullyDeadMpp;
        })
      });
      if (!round.matches.length) return;
      const mode = round.setMode || phase.mode;
      rounds.push({ round, mode, minutes: TC.modeMinutes(mode) });
    }));
    return rounds;
  }

  /* Match the format scheduler's phase-specific fixture filters: resolved
     byes are omitted, while only fully dead MPP final matches are skipped. */
  function neededFieldsForPlan(plan, windowMin, setMode, maxFields) {
    if (plan.planning && typeof TPlanning !== 'undefined') return TPlanning.neededFields(plan, windowMin, maxFields);
    const rounds = planningRounds(plan, setMode);
    const minutes = rounds.map(entry => entry.minutes);
    if (!plan.groupRounds && (!minutes.length || minutes.every(value => value === minutes[0]))) {
      return TC.neededFields(rounds.map(entry => entry.round), windowMin,
        minutes[0] || TC.modeMinutes(setMode), maxFields || 10);
    }
    for (let fields = 1; fields <= (maxFields || 10); fields++) {
      const need = rounds.reduce((total, entry) => total
        + TC.assignSlots([entry.round], fields, { teamOf: plan.resolve }).length * entry.minutes, 0);
      if (need <= windowMin) return fields;
    }
    return null;
  }

  function fillFieldKpi(selected, needed) {
    const warn = needed != null && selected < needed;
    setKpi('rv-fields', selected, warn);
    const note = needed == null
      ? ''
      : selected < needed
        ? tx('ui.kpi.fieldsNeeded', 'mind. {n} nötig', { n: needed })
        : selected > needed
          ? tx('ui.kpi.fieldsEnough', '{n} reichen', { n: needed }) : '';
    fillKpiNote('rv-fitFields', note);
  }

  /* Preserve the labels and their DOM reading order, including after a language change. */
  function layoutKpis() {
    const box = document.querySelector('.cfgresult');
    if (!box || box.classList.contains('kpi2')) return;
    const main = document.createElement('div'); main.className = 'kpi-main';
    const more = document.createElement('div'); more.className = 'kpi-more';
    const primary = ['rv-teams', 'rv-participants', 'rv-groups', 'rv-fields', 'rv-courts',
      'rv-perTeam', 'rv-perPerson', 'rv-duration', 'rv-fitEnd', 'rv-end'];
    primary.forEach(id => {
      const el = document.getElementById(id);
      if (el && el.closest('.cfgres-item')) main.appendChild(el.closest('.cfgres-item'));
    });
    Array.prototype.slice.call(box.children).forEach(item => {
      if (item.classList.contains('cfgres-item')) more.appendChild(item);
    });
    box.appendChild(main);
    if (more.children.length) box.appendChild(more);
    box.classList.add('kpi2');
  }

  function fillTimeKpis(o) {
    const fmtDur = m => {
      const v = Math.max(0, Math.round(m));
      return Math.floor(v / 60) + ':' + String(v % 60).padStart(2, '0') + ' h';
    };
    const slots = o.slots || [];
    const winMin = Math.max(0, o.windowEndMin - o.windowStartMin);
    const needMin = Math.max(0, o.needEndMin - o.startMin);
    const rounds = o.plan ? planningRounds(o.plan, o.setMode) : [];
    const durations = slots.map(slot => slot.minutes || TC.modeMinutes(o.setMode));
    const minPerGame = durations.length ? Math.min.apply(null, durations) : 0;
    const maxPerGame = durations.length ? Math.max.apply(null, durations) : 0;
    const retimeMin = o.plan && o.plan.planning ? o.plan.planning.retimeMin : null;
    const lockedSlots = retimeMin == null ? [] : slots.filter(s => s.lockedCount);
    const playableSlots = retimeMin == null ? slots.length : slots.filter(s => s.matches.some(m => m) && !s.lockedCount).length;
    const availableStart = retimeMin == null ? o.windowStartMin
      : Math.max(o.windowStartMin, retimeMin,
          lockedSlots.reduce((end, s) => Math.max(end, s.endMin), o.windowStartMin));
    let pauseMin = 0, pauseEnd = availableStart;
    (o.plan && o.plan.planningPauses || []).forEach(p => {
      const start = Math.max(availableStart, pauseEnd, p.startMin);
      const end = Math.min(o.windowEndMin, p.endMin);
      if (end > start) pauseMin += end - start;
      pauseEnd = Math.max(pauseEnd, end);
    });
    const availableMin = o.windowEndMin - availableStart - pauseMin;
    const availPerGame = playableSlots ? Math.max(0, Math.floor(availableMin / playableSlots)) : 0;
    const setCounts = (mode, games) => {
      const def = TC.modeDef(mode);
      const min = def.matchWins || (def.decidingSet ? def.sets - 1 : def.sets);
      const max = def.sets;
      return [games * min, games * max];
    };
    const sets = rounds.length ? rounds.reduce((total, entry) => {
      const count = setCounts(entry.mode, entry.round.matches.length);
      return [total[0] + count[0], total[1] + count[1]];
    }, [0, 0]) : setCounts(o.setMode, o.games || 0);
    const setsLo = sets[0], setsHi = sets[1];
    const over = needMin > winMin;
    const modes = Array.from(new Set(rounds.map(entry => entry.mode)));
    if (o.modeLabel != null) {
      const label = modes.length ? modes.map(mode => tx('setMode.' + mode, TC.modeDef(mode).label)).join(' / ') : o.modeLabel;
      setKpi('rv-mode', label);
      fillKpiNote('rv-modeNote', modes.some(mode => mode !== o.setMode)
        ? tx('ui.kpi.frozenModes', 'Gestartete Runden behalten ihren Satzmodus') : '');
    }
    if (o.teams != null) setKpi('rv-teams', o.teams);
    setKpi('rv-fitEnd', fmtTime(o.needEndMin), o.needEndMin > o.windowEndMin);
    fillKpiNote('rv-fitEndNote', o.needEndMin > o.windowEndMin
      ? tx('ui.kpi.endLate', 'nach Ende {time}', { time: fmtTime(o.windowEndMin) }) : '');
    setKpi('rv-subsets', setsLo === setsHi ? setsLo : setsLo + '–' + setsHi);
    setKpi('rv-perGame', tx('ui.kpi.minutes', '{n} Min.',
      { n: minPerGame === maxPerGame ? minPerGame : minPerGame + '–' + maxPerGame }), over);
    const mixed = minPerGame !== maxPerGame;
    fillKpiNote('rv-perGameNote', !mixed && availPerGame === minPerGame ? '' : mixed
      ? (over ? tx('ui.kpi.gameAverageShort', 'nur {n} Min. im Schnitt verfügbar', { n: availPerGame })
        : tx('ui.kpi.gameAverage', '{n} Min. im Schnitt verfügbar', { n: availPerGame }))
      : (over ? tx('ui.kpi.gameShort', 'nur {n} Min. verfügbar', { n: availPerGame })
        : tx('ui.kpi.gameAvailable', '{n} Min. verfügbar', { n: availPerGame })));
    setKpi('rv-duration', fmtDur(needMin), over);
    fillKpiNote('rv-durationNote', tx('ui.kpi.window', 'Zeitfenster {time}', { time: fmtDur(winMin) })
      + ' · ' + (over
        ? tx('ui.kpi.overrun', '{time} zu lang', { time: fmtDur(needMin - winMin) })
        : tx('ui.kpi.reserve', '{time} Reserve', { time: fmtDur(winMin - needMin) })));
  }

  /* Planungsmeldung unter den KPI: die bogenspezifische Endzeit-Meldung (o.message)
     als normale .notebox zwischen Infoleiste und Aktionen, darunter nur Optionen, die
     ein Engine-Neuaufbau (o.build) als passend bestätigt. Angewendet wird über den
     normalen change-Pfad der Konfig-Felder, also mit save() und Rückgängig-Toast. */
  let fixCache = { key: null, result: null };
  let fixObserver = null;

  function planFits(plan, cfg, setMode) {
    const start = TC.toMin(cfg.startTime), end = TC.toMin(cfg.endTime);
    if (start == null || end == null) return true;
    if (plan.endMin > end) return false;
    const need = neededFieldsForPlan(plan, end - start, setMode, 10);
    return need == null || +cfg.fields >= need;
  }

  function fixControl(id) {
    const el = document.getElementById(id);
    if (!el || el.disabled) return null;
    const field = el.closest('.cfgfield');
    return field && field.hidden ? null : el;
  }

  function fixOptions(el) {
    return Array.prototype.map.call(el.options, option => option.value).filter(value => value !== '');
  }

  /* Vorschläge in fester Priorität: mildester noch passender Satzmodus, dann weniger
     Runden, dann mehr (nutzbare) Felder, notfalls eine Kombination. Eine spätere Endzeit
     ist nachrangig, weil die Turnierlaufzeit meist feststeht. */
  function planFixes(o) {
    const cfg = o.config;
    if (planFits(o.plan, cfg, o.setMode)) return null;
    const probe = patch => {
      const next = Object.assign({}, cfg, patch);
      try { return { plan: o.build(next), cfg: next }; } catch (e) { return null; }
    };
    const fits = patch => {
      const p = probe(patch);
      return !!p && planFits(p.plan, p.cfg, p.cfg.setMode);
    };
    const modeLabel = mode => tx('setMode.' + mode, TC.modeDef(mode).label);
    const fixes = [];
    let modes = null;
    [['setMode', cfg.setMode, 'ui.kpi.fixMode', 'Kürzer: {mode}'],
      ['finalSetMode', o.plan.finalSetMode || cfg.finalSetMode, 'ui.kpi.fixFinalMode', 'Finalrunde kürzer: {mode}']]
      .some(entry => {
        const el = entry[0] in cfg ? fixControl(entry[0]) : null;
        const current = TC.modeMinutes(entry[1]);
        if (!el || !current) return false;
        const shorter = fixOptions(el).filter(mode => TC.modeMinutes(mode) < current)
          .sort((a, b) => TC.modeMinutes(b) - TC.modeMinutes(a));
        if (!modes) modes = { id: entry[0], list: shorter };
        const value = shorter.find(mode => fits({ [entry[0]]: mode }));
        if (value) fixes.push({ set: [[entry[0], value]], label: tx(entry[2], entry[3], { mode: modeLabel(value) }) });
        return !!value;
      });
    const roundsEl = fixControl('roundCount');
    let roundValues = [];
    if (roundsEl && o.plan.rounds) {
      // Not below played rounds and at most halved, so the format remains meaningful.
      const played = o.plan.rounds.reduce((max, round) => round.frozen ? Math.max(max, round.round) : max,
        Math.ceil(o.plan.rounds.length / 2));
      roundValues = fixOptions(roundsEl).map(Number)
        .filter(n => n >= played && n < o.plan.rounds.length).sort((a, b) => b - a);
      const value = roundValues.find(n => fits({ rounds: n }));
      if (value) fixes.push({ set: [['roundCount', String(value)]], label: tx('ui.kpi.fixRounds', { one: 'Auf {count} Runde reduzieren', other: 'Auf {count} Runden reduzieren' }, { count: value }) });
    }
    // Only selectable court counts: the select is capped at the games playable in parallel.
    const fieldsEl = fixControl('fieldCount');
    const fieldValues = fieldsEl ? fixOptions(fieldsEl).map(Number).filter(n => n > +cfg.fields).sort((a, b) => a - b) : [];
    const fieldValue = fieldValues.find(n => fits({ fields: n }));
    if (fieldValue) fixes.push({ set: [['fieldCount', String(fieldValue)]], label: tx('ui.kpi.fixFields', { one: 'Auf {count} Feld erhöhen', other: 'Auf {count} Felder erhöhen' }, { count: fieldValue }) });
    if (!fixes.length && modes) {
      const control = modes.id === 'setMode' ? 'setMode' : 'finalSetMode';
      const key = modes.id;
      const combo = [].concat.apply([], modes.list.map(mode => roundValues.map(n => ({ mode, rounds: n }))
        .concat(fieldValues.map(n => ({ mode, fields: n })))))
        .find(c => fits(c.rounds ? { [key]: c.mode, rounds: c.rounds } : { [key]: c.mode, fields: c.fields }));
      if (combo) fixes.push(combo.rounds
        ? { set: [[control, combo.mode], ['roundCount', String(combo.rounds)]],
          label: tx('ui.kpi.fixModeRounds', { one: '{mode}, {count} Runde', other: '{mode}, {count} Runden' }, { mode: modeLabel(combo.mode), count: combo.rounds }) }
        : { set: [[control, combo.mode], ['fieldCount', String(combo.fields)]],
          label: tx('ui.kpi.fixModeFields', { one: '{mode}, {count} Feld', other: '{mode}, {count} Felder' }, { mode: modeLabel(combo.mode), count: combo.fields }) });
    }
    let hint = '';
    if (!fixes.length && modes && modes.list.length) {
      const shortest = modes.list[modes.list.length - 1];
      const p = probe({ [modes.id]: shortest });
      const over = p ? p.plan.endMin - TC.toMin(cfg.endTime) : 0;
      if (over > 0) hint = tx('ui.kpi.fixShortest', 'Auch mit „{mode}“ noch {time} zu lang.',
        { mode: modeLabel(shortest), time: Math.floor(over / 60) + ':' + String(over % 60).padStart(2, '0') + ' h' });
    }
    const primary = fixes.slice(0, 3);
    const endMin = Math.ceil(o.plan.endMin / 5) * 5;
    if (fixControl('endTime') && endMin < 24 * 60 && endMin > TC.toMin(cfg.endTime)
      && fits({ endTime: TC.fromMin(endMin) })) {
      primary.push({ set: [['endTime', TC.fromMin(endMin)]], secondary: true, label: tx('ui.kpi.fixEnd', 'Ende auf {time} verlängern', { time: TC.fromMin(endMin) }) });
    }
    return { fixes: primary, hint };
  }

  let lastFix = null;
  function currentFixes(o) {
    const key = JSON.stringify([o.config, o.plan.endMin, planningRounds(o.plan, o.setMode)
      .map(entry => entry.round.matches.length + entry.mode + (entry.round.frozen ? 'f' : ''))]);
    if (fixCache.key !== key) fixCache = { key, result: planFixes(o) || { fixes: [], hint: '' } };
    return fixCache.result;
  }

  // All values first, one change event last: one save, one undo step.
  function applyFix(set) {
    const els = set.map(entry => document.getElementById(entry[0]));
    if (els.some(el => !el || el.disabled)) return;
    els.forEach((el, i) => { el.value = set[i][1]; });
    els[els.length - 1].dispatchEvent(new Event('change', { bubbles: true }));
  }

  function adjustPlanManually() {
    if (window.TSheetEditors && window.TSheetEditors.openTimeEditor()) return;
    const content = document.querySelector('.cfg-setup-content');
    const toggle = document.querySelector('.cfg-setup-toggle');
    if (content && content.hidden && toggle) toggle.click();
    const input = document.getElementById('endTime');
    if (input && !input.disabled) input.focus();
  }

  /* „Zeit optimieren“: passt der Plan, auf die kleinste ausreichende Feldzahl senken;
     sonst den ersten Vorschlag der Planungsmeldung anwenden (gleiche Priorität). */
  function timefit() {
    const o = lastFix;
    if (!o) return;
    const start = TC.toMin(o.config.startTime), end = TC.toMin(o.config.endTime);
    if (planFits(o.plan, o.config, o.setMode)) {
      const el = fixControl('fieldCount');
      if (!el || start == null || end == null) return;
      const max = Math.max.apply(null, fixOptions(el).map(Number));
      const need = neededFieldsForPlan(o.plan, end - start, o.setMode, max);
      if (need && need < +o.config.fields) applyFix([['fieldCount', String(need)]]);
      return;
    }
    const first = currentFixes(o).fixes.find(fix => !fix.secondary);
    if (first) applyFix(first.set);
    else window.alert(tx('ui.kpi.timefitNone', 'Weder ein kürzerer Satzmodus noch weniger Runden oder mehr Felder reichen. Ende verlängern oder selbst anpassen.'));
  }

  function fillPlanFixes(o) {
    const box = document.querySelector('.cfgresult');
    if (!box) return;
    lastFix = o;
    let bar = document.getElementById('kpiFix');
    const problem = !!o.message || !planFits(o.plan, o.config, o.setMode);
    if (!problem) {
      if (bar) bar.hidden = true;
      return;
    }
    const editable = !!fixControl('endTime');
    const result = editable ? currentFixes(o) : { fixes: [], hint: '' };
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'kpiFix';
      bar.className = 'notebox is-warn kpi-fix noprint';
      bar.addEventListener('click', event => {
        const button = event.target.closest('button');
        if (!button || button.disabled) return;
        if (button.classList.contains('kpi-fix__self')) { adjustPlanManually(); return; }
        const fix = (bar._fixes || [])[+button.getAttribute('data-fix-index')];
        if (fix) applyFix(fix.set);
      });
      const target = document.getElementById('endTime');
      if (!fixObserver && target && window.MutationObserver) {
        fixObserver = new MutationObserver(() => {
          const opts = document.querySelector('#kpiFix .kpi-fix__opts');
          if (opts && target.disabled) opts.hidden = true;
        });
        fixObserver.observe(target, { attributes: true, attributeFilter: ['disabled'] });
      }
    }
    // Directly after the info strip (badges plus optional game info), before the actions.
    let anchor = box;
    while (anchor.nextElementSibling && anchor.nextElementSibling.matches('.input-hint')) anchor = anchor.nextElementSibling;
    if (anchor.nextSibling !== bar) anchor.parentNode.insertBefore(bar, anchor.nextSibling);
    bar._fixes = result.fixes;
    const lines = [o.message, result.hint].filter(Boolean);
    bar.innerHTML = (lines.length ? '<ul>' + lines.map(line => '<li>' + esc(line) + '</li>').join('') + '</ul>' : '')
      + (editable ? '<div class="kpi-fix__opts">'
        + result.fixes.map((fix, i) => '<button type="button" class="' + (fix.secondary ? 'kpi-fix__link kpi-fix__alt' : 'nbtn kpi-fix__btn')
          + '" data-fix-index="' + i + '" data-fix-control="' + esc(fix.set.map(e => e[0]).join(' '))
          + '" data-fix-value="' + esc(fix.set.map(e => e[1]).join(' ')) + '">' + esc(fix.label) + '</button>').join('')
        + '<button type="button" class="kpi-fix__link kpi-fix__self">' + esc(tx('ui.kpi.fixSelf', 'Selbst anpassen')) + '</button></div>' : '');
    bar.hidden = false;
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
          + '<div class="kqvs" aria-hidden="true">:</div>'
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
        const pts = tx('ui.score.points', 'Punkte');
        [[aEl, m.a], [bEl, m.b]].forEach(function (p) {
          if (!p[0]) return;
          const nm = ctx.teamLabel(p[1]);
          p[0].querySelector('.n').textContent = nm;
          /* Kaestchen ohne sichtbares <label>: Name fuer Screenreader. */
          const box = p[0].querySelector('input.kqscore');
          if (box) box.setAttribute('aria-label', nm ? nm + ', ' + pts : pts);
        });
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
    configureProfile,
    paintStage, paintStageMatch,
    participantWord,
    modeOptionLabel, refreshSetModeOptionLabels,
    surfaceWord,
    surfaceLabel,
    unitWord,
    esc, fmtTime, fmtDiff, slotTitle, teamNameHtml, makeLabeler, sideLabel, cardNameHtml,
    bracketColumnsHtml, paintBracketColumns,
    setColumnHtml, matchCellHtml, scheduleBodyHtml, paintMatch, markScoreInputs, paintByeCard, paintOutcome, wireOutcomes,
    standingsTableHtml, placeListHtml, rankBadgeHtml, initManualEditing, finalsStarted, mountFinalQualification, manualDeltaBadge, criteriaHint, dttbSwissTableHtml, hintHtml, scoreHintHtml, trackTableHtml, setTrackCell, sortTrackRows,
    namePanelHtml, pairPanelHtml, editParticipantName, wireParticipantNames, shuffleParticipantNames, participantOrderLocked, fieldPanelHtml, absentPanelHtml, clearTeamAbsences, teamDelBtnHtml, confirmRemoveTeam,
    roundBarHtml, roundBarValue, lastFilledRound, applyRoundFilter, markRoundStatus,
    scoringTablesHtml, jumpBarHtml, wireJumpBar, wireSectionToggle, wireFormatInfo, syncModeSummary,
    maxParallelFields, defaultFields, fillFieldSelect, timeTableHtml, fillTimeKpis, fillFieldKpi, fillKpiNote, layoutKpis, buttonFeedback, neededFieldsForPlan, fillPlanFixes, timefit,
    wireScoreInputs, visibleScoreFields, stepScoreFocus, focusScoreTarget, wireScoreViewport, courtLadderHtml, paintCourtLadder
  };
});
