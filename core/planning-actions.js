/* Shared inline editors; all changes use the sheet's normal save/Undo path. */
(function (root) {
  'use strict';
  const tx = (key, params) => root.TI18n.t('planning.' + key, params);
  const esc = value => root.TUI.esc(value);
  const icons = {
    retime: '<path d="M3 11a9 9 0 1 1 3 7M3 4v7h7M12 7v5l3 2"/>',
    court: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="m8 8 8 8m0-8-8 8"/>',
    pause: '<circle cx="12" cy="12" r="9"/><path d="M9 8v8M15 8v8"/>'
  };
  function icon(kind) {
    return '<svg class="nico" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + icons[kind] + '</svg>';
  }
  function now() {
    const d = new Date();
    return root.TC.fromMin(Math.ceil((d.getHours() * 60 + d.getMinutes()) / 5) * 5);
  }
  function errorText(error) {
    if (error.code === 'no-field') return tx('oneCourt');
    if (error.code === 'pause-locked' || error.code === 'block-locked' || error.code === 'locked-overlap') return tx('startedConflict');
    if (error.code === 'locked-field' || error.code === 'invalid-block') return tx('courtConflict');
    if (error.code === 'invalid-rescheduled-time') return tx('postponeInvalid');
    if (error.code === 'invalid-team-delay') return tx('teamDelayInvalid');
    if (error.code === 'unsupported-forward-fill' || error.code === 'unresolved-forward-fill') return tx('forwardFillUnavailable');
    if (error.code === 'infeasible') return tx('postponeInfeasible');
    return tx('invalid');
  }
  function mount(o) {
    const anchor = document.getElementById('btnTimefit');
    const configBox = document.getElementById('configSection');
    const count = document.getElementById('fieldCount');
    const controls = document.createElement('div');
    controls.className = 'planning-controls noprint';
    let after = anchor;
    const buttons = [['btnRetime', 'retime'], ['btnCourtOut', 'court'], ['btnPlanBreak', 'pause']].map(entry => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'nbtn'; b.id = entry[0];
      b.innerHTML = icon(entry[1]) + ' <span>' + esc(tx(entry[1])) + '</span>';
      b.setAttribute('aria-controls', 'planningPanel'); b.setAttribute('aria-expanded', 'false');
      anchor.parentNode.insertBefore(b, after.nextSibling); after = b;
      b.addEventListener('click', () => open(entry[1]));
      return b;
    });
    const courtButton = buttons.find(button => button.id === 'btnCourtOut');
    const teamFieldButton = document.getElementById('btnToggleFields')
      || document.getElementById('btnToggleAbsent')
      || document.getElementById('btnToggleNames');
    if (courtButton && teamFieldButton) {
      teamFieldButton.parentNode.insertBefore(courtButton, teamFieldButton.nextSibling);
    }
    controls.innerHTML = '<div class="namepanel planning-panel" id="planningPanel" hidden></div>';
    configBox.parentNode.insertBefore(controls, configBox.nextSibling);
    const panel = controls.firstChild;
    const statusButton = document.getElementById('btnToggleAbsent');
    const namesButton = document.getElementById('btnToggleNames');
    const namesPanel = document.getElementById('namepanel');
    if (namesButton && statusButton && namesButton.parentNode === statusButton.parentNode) {
      namesButton.parentNode.insertBefore(statusButton, namesButton.nextSibling);
    }
    if (namesPanel && statusButton) {
      const actions = namesPanel.querySelector('.nactions') || namesPanel;
      const jumpButton = document.createElement('button');
      jumpButton.type = 'button';
      jumpButton.className = 'nbtn';
      jumpButton.setAttribute('data-team-status-jump', '');
      jumpButton.setAttribute('aria-controls', 'absentpanel');
      jumpButton.textContent = tx('teamStatusJump');
      actions.appendChild(jumpButton);
      const syncJumpAvailability = () => {
        jumpButton.hidden = statusButton.disabled || statusButton.hidden;
      };
      syncJumpAvailability();
      new MutationObserver(syncJumpAvailability).observe(statusButton, {
        attributes: true, attributeFilter: ['disabled', 'hidden']
      });
      jumpButton.addEventListener('click', () => {
        if (statusButton.disabled) return;
        statusButton.click();
        const statusPanel = document.getElementById('absentpanel');
        if (statusPanel) {
          scrollToPanel(statusPanel);
          const firstStatus = statusPanel.querySelector('[data-team-status], [data-absent-input]');
          if (firstStatus) firstStatus.focus();
        }
      });
    }
    const fieldsPanel = document.getElementById('fieldpanel');
    const fieldsButton = document.getElementById('btnToggleFields');
    if (fieldsPanel && fieldsButton && courtButton) {
      const actions = fieldsPanel.querySelector('.nactions') || fieldsPanel;
      const jumpButton = document.createElement('button');
      jumpButton.type = 'button';
      jumpButton.className = 'nbtn';
      jumpButton.setAttribute('data-court-outage-jump', '');
      jumpButton.setAttribute('aria-controls', 'planningPanel');
      jumpButton.textContent = tx('fieldOutageJump');
      actions.appendChild(jumpButton);
      const syncJumpAvailability = () => {
        jumpButton.hidden = courtButton.disabled || courtButton.hidden;
      };
      syncJumpAvailability();
      new MutationObserver(syncJumpAvailability).observe(courtButton, {
        attributes: true, attributeFilter: ['disabled', 'hidden']
      });
      jumpButton.addEventListener('click', () => {
        if (courtButton.disabled) return;
        courtButton.click();
        const courtPanel = document.getElementById('planningPanel');
        if (courtPanel) {
          scrollToPanel(courtPanel);
          const firstStatus = courtPanel.querySelector('[data-planning-court-status]');
          if (firstStatus) firstStatus.focus();
        }
      });
    }
    const summary = document.createElement('div');
    summary.className = 'planning-summary noprint'; summary.id = 'planningSummary';
    summary.setAttribute('role', 'status');
    controls.parentNode.insertBefore(summary, controls.nextSibling);
    const absentHost = document.getElementById('absentpanel') || document.getElementById('rosterActions');
    let fillForwardInput = null;
    if (absentHost && o.get().config.mode === 'rr') {
      const option = document.createElement('section');
      option.className = 'planning-forward-fill';
      option.innerHTML = '<label><input type="checkbox" data-fill-forward> '
        + esc(tx('forwardFill')) + '</label><p class="nhint">' + esc(tx('forwardFillHint'))
        + '</p><p class="planning-error" role="alert" data-fill-forward-error></p>';
      absentHost.appendChild(option);
      fillForwardInput = option.querySelector('[data-fill-forward]');
      fillForwardInput.addEventListener('change', () => {
        const error = option.querySelector('[data-fill-forward-error]');
        error.textContent = '';
        change(p => {
          if (fillForwardInput.checked) p.fillForward = true;
          else delete p.fillForward;
        }, error, () => { fillForwardInput.checked = !!(o.get().config.planning || {}).fillForward; });
      });
    }
    let postponeBox = null, postponeButton = null, postponePanel = null, postponeList = null, postponeHint = null;
    if (absentHost) {
      const postpone = document.createElement('section');
      postpone.className = 'planning-reschedule noprint';
      postpone.setAttribute('aria-labelledby', 'planningRescheduleTitle');
      postpone.innerHTML = '<h3 class="planning-reschedule-title" id="planningRescheduleTitle">' + esc(tx('postponeSection')) + '</h3>'
        + '<p class="nhint" data-postpone-hint>' + esc(tx('postponeHint')) + '</p>'
        + '<button type="button" class="nbtn" data-postpone-open aria-controls="planningPostponePanel" aria-expanded="false">'
        + esc(tx('postponeButton')) + '</button>'
        + '<div class="planning-reschedule-list" aria-live="polite"></div>'
        + '<div class="namepanel planning-panel" id="planningPostponePanel" data-postpone-panel hidden></div>';
      absentHost.appendChild(postpone);
      postponeBox = postpone;
      postponeHint = postpone.querySelector('[data-postpone-hint]');
      postponeButton = postpone.querySelector('[data-postpone-open]');
      postponePanel = postpone.querySelector('[data-postpone-panel]');
      postponeList = postpone.querySelector('.planning-reschedule-list');
    }
    let editing = null, busy = false;
    const exclusiveSections = [
      ['btnToggleNames', 'namepanel'],
      ['btnToggleFields', 'fieldpanel'],
      ['btnToggleAbsent', document.getElementById('rosterSection') ? 'rosterSection' : 'absentpanel'],
      ['btnCourtOut', 'planningPanel']
    ].map(([buttonId, panelId]) => ({
      button: document.getElementById(buttonId),
      panel: document.getElementById(panelId)
    })).filter(section => section.button && section.panel);
    exclusiveSections.forEach(section => {
      section.button.setAttribute('aria-controls', section.panel.id);
      if (!section.button.hasAttribute('aria-expanded')) section.button.setAttribute('aria-expanded', 'false');
    });
    function syncExclusive(activeButton) {
      const active = exclusiveSections.find(section => section.button === activeButton
        && !section.panel.hidden);
      exclusiveSections.forEach(section => {
        const selected = !!active && section.button === active.button;
        section.button.classList.toggle('active', selected);
        section.button.setAttribute('aria-expanded', selected ? 'true' : 'false');
      });
    }
    document.addEventListener('click', event => {
      const button = event.target.closest && event.target.closest(
        '#btnToggleNames, #btnToggleFields, #btnToggleAbsent, #btnRetime, #btnCourtOut, #btnPlanBreak'
      );
      if (!button) {
        if (event.target.closest && event.target.closest('.app-close')) syncExclusive(null);
        return;
      }
      if (button.id === 'btnRetime' || button.id === 'btnPlanBreak') {
        exclusiveSections.forEach(section => {
          if (section.panel === panel || section.panel.hidden) return;
          section.panel.hidden = true;
          if (section.panel.id === 'absentpanel' || section.panel.id === 'rosterSection') {
            if (postponePanel) {
              postponePanel.hidden = true;
              if (postponeButton) postponeButton.setAttribute('aria-expanded', 'false');
            }
          }
        });
        syncExclusive(null);
        return;
      }
      const selected = exclusiveSections.find(section => section.button === button);
      if (!selected) return;
      exclusiveSections.forEach(section => {
        if (section.panel === selected.panel || section.panel.hidden) return;
        if (section.panel === panel) close();
        else section.panel.hidden = true;
        if (section.panel.id === 'absentpanel' || section.panel.id === 'rosterSection') {
          if (postponePanel) {
            postponePanel.hidden = true;
            if (postponeButton) postponeButton.setAttribute('aria-expanded', 'false');
          }
        }
      });
      syncExclusive(button);
    });
    function readonly() {
      const uiState = root.TStore && root.TStore.initialUiState();
      return !!(uiState && uiState.readOnly);
    }
    function fieldName(f) { return o.get().fieldNames[f] || root.TI18n.t('ui.field.n', { n: f + 1 }); }
    function rounds() {
      const plan = o.plan();
      const list = [];
      let previous = null;
      root.TPlanning.slots(plan).forEach(s => {
        // Final and group rounds may both be numbered from one.
        const source = plan.grpSlots && plan.grpSlots.indexOf(s) >= 0 ? 'grp' : 'fin';
        const key = source + ':' + s.round;
        if (key !== previous) {
          list.push({ ordinal: list.length + 1, label: root.TUI.slotTitle(s) });
          previous = key;
        }
      });
      return list;
    }
    function message(text) {
      const el = panel.querySelector('[role="alert"]');
      if (el) el.textContent = text;
      else root.alert(text);
    }
    function postponeMessage(text) {
      const el = postponePanel && postponePanel.querySelector('[role="alert"]');
      if (el) el.textContent = text;
    }
    function scrollToPanel(element) {
      const editors = root.TSheetEditors;
      if (editors && typeof editors.scrollToPanel === 'function') editors.scrollToPanel(element);
      else if (element) window.requestAnimationFrame(() => {
        if (!element.hidden) element.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
    function mountPanelClose(target, dismiss) {
      target.classList.add('section-panel-labelled');
      root.TNative.mountClose(target, root.TI18n.t('share.close'), dismiss, null, true);
    }
    function close() {
      const kind = editing && editing.kind;
      const restoreFocus = panel.contains(document.activeElement);
      panel.hidden = true; editing = null;
      buttons.forEach(b => b.setAttribute('aria-expanded', 'false'));
      syncExclusive(null);
      if (restoreFocus && !readonly()) {
        const button = buttons[['retime', 'court', 'pause'].indexOf(kind)];
        if (button) button.focus();
      }
    }
    function matchLabel(matchId) {
      const nodes = document.querySelectorAll('[data-mid]');
      for (let i = 0; i < nodes.length; i++) {
        if (nodes[i].getAttribute('data-mid') !== String(matchId)) continue;
        const names = nodes[i].querySelector('.pnames');
        if (names) return names.textContent.replace(/\s+/g, ' ').trim();
      }
      return String(matchId);
    }
    function currentMatches() {
      const state = o.get(), plan = o.plan(), p = state.config.planning || {};
      const matches = [];
      root.TPlanning.slots(plan).forEach(slot => (slot.matches || []).forEach((match, field) => {
        if (!match || slot.displayOnly || root.TPlanning.hasInput(state.results, match.id)
          || (match.result && match.result.administrative && match.result.outcome
            && match.result.outcome.kind === 'default')
          || (p.locked && Object.prototype.hasOwnProperty.call(p.locked, match.id))
          || (p.rescheduled && Object.prototype.hasOwnProperty.call(p.rescheduled, match.id))) return;
        const cell = document.querySelectorAll('[data-mid]');
        for (let i = 0; i < cell.length; i++) {
          if (cell[i].getAttribute('data-mid') === String(match.id) && cell[i].classList.contains('is-bye')) return;
        }
        matches.push({
          id: match.id, slot: slot, field: field,
          label: tx('postponeMatchLabel', {
            round: root.TUI.slotTitle(slot), time: root.TUI.fmtTime(slot.startMin),
            field: fieldName(field), match: matchLabel(match.id)
          })
        });
      }));
      return matches;
    }
    function openPostpone() {
      if (!postponePanel || readonly() || busy) return;
      const matches = currentMatches();
      if (!matches.length) return;
      const options = matches.map(match => '<option value="' + esc(match.id) + '">'
        + esc(match.label) + '</option>').join('');
      postponePanel.innerHTML = '<form class="planning-form">'
        + '<h2 class="section-panel-heading">' + esc(tx('postponeTitle')) + '</h2>'
        + '<div class="planning-fields">'
        + '<label class="planning-field cfgfield"><span class="cfg-lbl">' + esc(tx('postponeGame')) + '</span>'
        + '<select data-postpone-match required>' + options + '</select></label>'
        + '<label class="planning-field cfgfield"><span class="cfg-lbl">' + esc(tx('postponeTime')) + '</span>'
        + '<input data-postpone-time type="time" required></label></div>'
        + '<div class="planning-panel-actions"><button type="submit" class="nbtn">'
        + esc(tx('apply')) + '</button> <button type="button" class="nbtn" data-postpone-close>'
        + esc(tx('cancel')) + '</button></div><p class="planning-error" role="alert"></p></form>';
      mountPanelClose(postponePanel, closePostpone);
      const select = postponePanel.querySelector('[data-postpone-match]');
      const setSuggestedTime = () => {
        const selected = matches.find(match => String(match.id) === select.value);
        if (selected) postponePanel.querySelector('[data-postpone-time]').value = root.TC.fromMin(selected.slot.endMin);
      };
      select.addEventListener('change', setSuggestedTime);
      setSuggestedTime();
      postponePanel.hidden = false;
      postponeButton.setAttribute('aria-expanded', 'true');
      select.focus();
      scrollToPanel(postponePanel);
    }
    function closePostpone() {
      if (!postponePanel) return;
      postponePanel.hidden = true;
      postponeButton.setAttribute('aria-expanded', 'false');
      if (!readonly()) postponeButton.focus();
    }
    const initiallyOpen = exclusiveSections.find(section => !section.panel.hidden);
    if (initiallyOpen) {
      exclusiveSections.forEach(section => {
        if (section.panel === initiallyOpen.panel || section.panel.hidden) return;
        if (section.panel === panel) close();
        else section.panel.hidden = true;
      });
      syncExclusive(initiallyOpen.button);
    }
    function open(kind, id) {
      if (readonly() || busy) return;
      if (editing && editing.kind === kind && editing.id === id) { close(); return; }
      const p = o.get().config.planning || {};
      const selected = kind === 'pause' && id != null ? (p.breaks || []).find(b => b.id === id) : null;
      const selectedBlock = kind === 'court' && id != null
        ? (p.blocked || []).find(b => b.field === +id) : null;
      editing = { kind: kind, id: id };
      let fields = '';
      const label = (text, input) => '<label class="planning-field cfgfield"><span class="cfg-lbl">'
        + esc(text) + '</span>' + input + '</label>';
      if (kind === 'retime') fields = label(tx('from'), '<input id="planningTime" type="time" required value="' + esc(p.retime ? p.retime.time : now()) + '">');
      if (kind === 'court') {
        let options = '';
        for (let f = 0; f < o.get().config.fields; f++) {
          const currentBlock = (p.blocked || []).find(b => b.field === f);
          const selectedScope = currentBlock
            ? currentBlock.fromRound != null ? String(currentBlock.fromRound) : 'time'
            : 'now';
          const scopes = '<option value="now"' + (selectedScope === 'now' ? ' selected' : '') + '>'
            + esc(tx('now')) + '</option><option value="time"' + (selectedScope === 'time' ? ' selected' : '') + '>'
            + esc(tx('atTime')) + '</option>'
            + rounds().map(r => '<option value="' + r.ordinal + '"' + (selectedScope === String(r.ordinal) ? ' selected' : '')
              + '>' + esc(tx('fromRound', { round: r.label })) + '</option>').join('');
          options += '<div class="planning-court-row" data-planning-court-row="' + f + '">'
            + '<label class="planning-field cfgfield planning-court-status"><span class="cfg-lbl">'
            + esc(fieldName(f)) + '</span><select data-planning-court-status="' + f + '">'
            + '<option value="available"' + (currentBlock ? '' : ' selected') + '>' + esc(tx('available'))
            + '</option><option value="closed"' + (currentBlock ? ' selected' : '') + '>' + esc(tx('unavailable'))
            + '</option></select></label>'
            + '<div class="planning-court-details" data-planning-court-details="' + f + '"' + (currentBlock ? '' : ' hidden') + '>'
            + '<label class="planning-field cfgfield"><span class="cfg-lbl">' + esc(tx('from'))
            + '</span><select data-planning-court-scope="' + f + '">' + scopes + '</select></label>'
            + '<label class="planning-field cfgfield planning-court-time" data-planning-court-time-field="' + f + '"'
            + (selectedScope === 'time' ? '' : ' hidden') + '><span class="cfg-lbl">' + esc(tx('at'))
            + '</span><input data-planning-court-time="' + f + '" type="time" value="'
            + esc(currentBlock ? currentBlock.time || (currentBlock.min != null ? root.TC.fromMin(currentBlock.min) : now()) : now())
            + (selectedScope === 'time' ? '" required>' : '">') + '</label></div></div>';
        }
        fields = '<fieldset class="planning-court-fieldset"><legend class="cfg-lbl">' + esc(tx('fields'))
          + '</legend><div class="planning-court-options">' + options + '</div></fieldset>';
      }
      if (kind === 'pause') fields = label(tx('at'), '<input id="planningTime" type="time" required value="' + esc(selected ? selected.time : now()) + '">')
        + label(tx('minutes'), '<input id="planningMinutes" type="number" min="1" max="1440" step="1" required value="' + (selected ? selected.minutes : 30) + '">');
      panel.innerHTML = '<form class="planning-form"><h2 class="section-panel-heading">'
        + esc(tx(kind)) + '</h2><div class="planning-fields">' + fields + '</div>'
        + '<div class="planning-panel-actions"><button type="submit" class="nbtn">' + esc(tx('apply')) + '</button>'
        + (kind === 'court' ? ' <button type="button" class="nbtn" data-planning-courts-reset'
          + ((p.blocked || []).length ? '' : ' disabled') + '>' + esc(tx('clearCourtOutages')) + '</button>' : '')
        + ' <button type="button" class="nbtn" data-planning-close>' + esc(tx('cancel')) + '</button></div>'
        + '<p class="planning-error" role="alert"></p></form>';
      mountPanelClose(panel, close);
      if (kind === 'court') {
        const syncCourtRow = field => {
          const status = panel.querySelector('[data-planning-court-status="' + field + '"]');
          const details = panel.querySelector('[data-planning-court-details="' + field + '"]');
          const scope = panel.querySelector('[data-planning-court-scope="' + field + '"]');
          const timeField = panel.querySelector('[data-planning-court-time-field="' + field + '"]');
          const timeInput = panel.querySelector('[data-planning-court-time="' + field + '"]');
          const closed = status.value === 'closed';
          details.hidden = !closed;
          timeField.hidden = !closed || scope.value !== 'time';
          timeInput.required = closed && scope.value === 'time';
        };
        panel.querySelectorAll('[data-planning-court-status]').forEach(status => {
          status.addEventListener('change', () => syncCourtRow(status.getAttribute('data-planning-court-status')));
        });
        panel.querySelectorAll('[data-planning-court-scope]').forEach(scope => {
          scope.addEventListener('change', () => syncCourtRow(scope.getAttribute('data-planning-court-scope')));
        });
        panel.querySelectorAll('[data-planning-court-row]').forEach(row =>
          syncCourtRow(row.getAttribute('data-planning-court-row')));
        if (selectedBlock) {
          const row = panel.querySelector('[data-planning-court-row="' + selectedBlock.field + '"]');
          if (row) row.scrollIntoView({ block: 'center' });
        }
      }
      panel.hidden = false;
      buttons.forEach(b => b.setAttribute('aria-expanded', b.id === ({ retime: 'btnRetime', court: 'btnCourtOut', pause: 'btnPlanBreak' })[kind] ? 'true' : 'false'));
      panel.querySelector('input, select').focus();
      scrollToPanel(panel);
    }
    async function change(edit, errorTarget, afterSave, keepEditorOpen) {
      if (readonly() || busy) return;
      const s = o.get(), old = s.config.planning;
      const next = old ? JSON.parse(JSON.stringify(old)) : { blocked: [], breaks: [], rescheduled: {}, locked: {} };
      next.locked = root.TPlanning.capture(o.plan(), s.results, next.locked);
      edit(next);
      const config = Object.assign({}, s.config, { planning: next });
      try { o.build(config); }
      catch (e) {
        if (!e.code) throw e;
        if (errorTarget) errorTarget.textContent = errorText(e); else message(errorText(e));
        return;
      }
      busy = true;
      s.config.planning = next;
      let ok;
      try { ok = await o.save(); }
      finally { busy = false; }
      if (!ok) {
        if (old) s.config.planning = old; else delete s.config.planning;
        return; // TStore reports storage failures centrally.
      }
      if (afterSave) afterSave();
      const reopenKind = keepEditorOpen && editing ? editing.kind : null;
      close(); o.rebuild(); refresh();
      if (reopenKind && !readonly()) open(reopenKind);
    }
    async function saveTeamStatus(team, status, time, errorTarget, fillForwardChoice, replanFromNow) {
      if (readonly() || busy) return;
      if (!Number.isInteger(team) || team < 1 || ['available', 'late', 'absent'].indexOf(status) < 0) return;
      const s = o.get();
      const oldPlanning = s.config.planning;
      const oldAbsent = (s.absent || []).slice();
      const next = oldPlanning ? JSON.parse(JSON.stringify(oldPlanning))
        : { blocked: [], breaks: [], rescheduled: {}, locked: {} };
      next.teamDelays = next.teamDelays || {};
      const absent = oldAbsent.filter(id => id !== team);
      if (status === 'absent') absent.push(team);
      if (status === 'late') {
        const min = root.TPlanning.clockToMin(time, o.plan().startMin);
        if (min == null) {
          if (errorTarget) errorTarget.textContent = tx('teamDelayInvalid');
          return;
        }
        next.teamDelays[team] = { time: time };
      } else {
        delete next.teamDelays[team];
      }
      if (s.config.mode === 'rr' && typeof fillForwardChoice === 'boolean') {
        if (fillForwardChoice) next.fillForward = true;
        else delete next.fillForward;
      }
      if (replanFromNow) next.retime = { time: now() };
      if (!Object.keys(next.teamDelays).length) delete next.teamDelays;
      next.locked = root.TPlanning.capture(o.plan(), s.results, next.locked);
      if (!Object.keys(next.locked).length) delete next.locked;
      const config = Object.assign({}, s.config, { planning: next });
      try { o.build(config, Object.assign({}, s, { absent: absent, config: config })); }
      catch (e) {
        if (!e.code) throw e;
        if (errorTarget) errorTarget.textContent = errorText(e); else message(errorText(e));
        return;
      }
      busy = true;
      s.absent = absent;
      s.config.planning = next;
      let ok;
      try { ok = await o.save(); }
      finally { busy = false; }
      if (!ok) {
        s.absent = oldAbsent;
        if (oldPlanning) s.config.planning = oldPlanning;
        else delete s.config.planning;
        return;
      }
      o.rebuild(); refresh();
    }
    function saveTeamDelay(team, time, errorTarget) {
      const state = o.get(), planning = state.config.planning || {};
      if (state.config.mode === 'rr' && planning.fillForward !== true
          && root.TShare && typeof root.TShare.openInfoDialog === 'function') {
        root.TShare.openInfoDialog({
          title: tx('forwardFillPromptTitle'),
          bodyHtml: '<p>' + esc(tx('forwardFillPromptBody')) + '</p>',
          confirmLabel: tx('forwardFillPromptYes'),
          cancelLabel: tx('forwardFillPromptNo'),
          onConfirm: () => saveTeamStatus(team, 'late', time, errorTarget, true),
          onCancel: () => saveTeamStatus(team, 'late', time, errorTarget, false)
        });
        return;
      }
      saveTeamStatus(team, 'late', time, errorTarget);
    }
    if (absentHost) {
      document.addEventListener('change', event => {
        const select = event.target.closest('[data-team-status]');
        if (!select || readonly()) return;
        const team = Number(select.getAttribute('data-team-status'));
        const card = select.closest('[data-team-status-card]');
        const editor = card && card.querySelector('[data-team-delay-editor]');
        const error = editor && editor.querySelector('[data-team-delay-error]');
        if (select.value === 'late') {
          if (select.hasAttribute('data-no-delay')) return;
          const delay = o.get().config.planning && o.get().config.planning.teamDelays || {};
          const input = editor && editor.querySelector('[data-team-delay-time]');
          if (input) input.value = delay[team] ? delay[team].time : now();
          if (error) error.textContent = '';
          if (editor) editor.hidden = false;
          if (input) input.focus();
          return;
        }
        saveTeamStatus(team, select.value, '', error);
      });
      document.addEventListener('click', event => {
        const button = event.target.closest('[data-team-arrival-confirm]');
        if (!button || readonly()) return;
        const card = button.closest('[data-team-status-card]');
        const select = card && card.querySelector('[data-team-status]');
        if (!select) return;
        const team = Number(select.getAttribute('data-team-status'));
        saveTeamStatus(team, 'available', '', null, undefined, true);
      });
      document.addEventListener('click', event => {
        const button = event.target.closest('[data-team-delay-save], [data-team-delay-cancel]');
        if (!button || readonly()) return;
        const card = button.closest('[data-team-status-card]');
        if (!card) return;
        const select = card.querySelector('[data-team-status]');
        const editor = card.querySelector('[data-team-delay-editor]');
        const input = editor.querySelector('[data-team-delay-time]');
        const error = editor.querySelector('[data-team-delay-error]');
        const team = Number(select.getAttribute('data-team-status'));
        if (button.hasAttribute('data-team-delay-cancel')) {
          const state = o.get(), delays = state.config.planning && state.config.planning.teamDelays || {};
          select.value = (state.absent || []).indexOf(team) >= 0 ? 'absent'
            : delays[team] ? 'late' : 'available';
          editor.hidden = true;
          if (error) error.textContent = '';
        } else if (!input.value || !input.validity.valid) {
          if (error) error.textContent = tx('teamDelayInvalid');
          input.focus();
        } else {
          saveTeamDelay(team, input.value, error);
        }
      });
      document.addEventListener('keydown', event => {
        if (event.key !== 'Escape') return;
        const editor = event.target.closest('[data-team-delay-editor]');
        if (!editor) return;
        const card = editor.closest('[data-team-status-card]');
        const select = card && card.querySelector('[data-team-status]');
        if (!select) return;
        const state = o.get(), delays = state.config.planning && state.config.planning.teamDelays || {};
        const team = Number(select.getAttribute('data-team-status'));
        select.value = (state.absent || []).indexOf(team) >= 0 ? 'absent' : delays[team] ? 'late' : 'available';
        editor.hidden = true;
      });
    }
    if (postponeButton) {
      postponeButton.addEventListener('click', openPostpone);
      postponePanel.addEventListener('submit', event => {
        event.preventDefault();
        const select = postponePanel.querySelector('[data-postpone-match]');
        const time = postponePanel.querySelector('[data-postpone-time]');
        const selected = currentMatches().find(match => String(match.id) === select.value);
        if (!selected) {
          postponeMessage(tx('postponeUnavailable'));
          return;
        }
        const requested = root.TPlanning.clockToMin(time.value, o.plan().startMin);
        if (requested == null || requested <= selected.slot.startMin) {
          postponeMessage(tx('postponeInvalid'));
          return;
        }
        change(p => {
          p.rescheduled = p.rescheduled || {};
          p.rescheduled[select.value] = { time: time.value };
        }, postponePanel.querySelector('[role="alert"]'), closePostpone);
      });
      postponePanel.addEventListener('click', event => {
        if (event.target.closest('[data-postpone-close]')) closePostpone();
      });
      postponePanel.addEventListener('keydown', event => {
        if (event.key === 'Escape') closePostpone();
      });
      postponeList.addEventListener('click', event => {
        const button = event.target.closest('[data-postpone-remove]');
        if (!button || readonly()) return;
        const id = button.getAttribute('data-postpone-remove');
        change(p => { if (p.rescheduled) delete p.rescheduled[id]; });
      });
    }
    panel.addEventListener('submit', event => {
      event.preventDefault();
      if (!editing) return;
      const kind = editing.kind, id = editing.id;
      const time = panel.querySelector('#planningTime');
      let fieldBlocks = [];
      let hasNowBlock = false;
      if (kind === 'court') {
        fieldBlocks = Array.prototype.map.call(panel.querySelectorAll('[data-planning-court-row]'), row => {
          const field = +row.getAttribute('data-planning-court-row');
          const status = row.querySelector('[data-planning-court-status]').value;
          if (status !== 'closed') return null;
          const scope = row.querySelector('[data-planning-court-scope]').value;
          if (scope === 'now') {
            hasNowBlock = true;
            return { field: field, time: now() };
          }
          if (scope === 'time') return { field: field, time: row.querySelector('[data-planning-court-time]').value };
          return { field: field, fromRound: +scope };
        }).filter(Boolean);
      }
      change(p => {
        if (kind === 'retime') p.retime = { time: time.value };
        if (kind === 'court') {
          p.blocked = fieldBlocks;
          const start = now();
          if (hasNowBlock && (!p.retime || root.TPlanning.clockToMin(p.retime.time, o.plan().startMin)
            < root.TPlanning.clockToMin(start, o.plan().startMin))) p.retime = { time: start };
        }
        if (kind === 'pause') {
          p.breaks = (p.breaks || []).filter(b => b.id !== id);
          p.breaks.push({ id: id || 'pause-' + Date.now(), time: time.value, minutes: +panel.querySelector('#planningMinutes').value });
        }
      }, null, null, kind === 'court');
    });
    panel.addEventListener('click', event => {
      if (!event.target.closest('[data-planning-courts-reset]') || readonly() || busy) return;
      change(p => { p.blocked = []; }, panel.querySelector('[role="alert"]'), null, true);
    });
    panel.addEventListener('click', event => { if (event.target.closest('[data-planning-close]')) close(); });
    panel.addEventListener('keydown', event => { if (event.key === 'Escape') { close(); anchor.focus(); } });
    summary.addEventListener('click', event => {
      const b = event.target.closest('[data-planning-remove], [data-planning-edit]');
      if (!b || readonly()) return;
      const kind = b.getAttribute('data-planning-kind'), id = b.getAttribute('data-planning-id');
      if (b.hasAttribute('data-planning-edit')) { open(kind, kind === 'court' ? +id : id); return; }
      change(p => {
        if (kind === 'retime') delete p.retime;
        if (kind === 'court') p.blocked = (p.blocked || []).filter(item => item.field !== +id);
        if (kind === 'pause') p.breaks = (p.breaks || []).filter(item => item.id !== id);
      });
    });
    // Reject configuration changes that would discard an unavailable/locked court.
    document.addEventListener('change', event => {
      const input = event.target, s = o.get();
      if (!s.config.planning || !['fieldCount', 'teamCount', 'menCount', 'womenCount'].includes(input.id)) return;
      const config = Object.assign({}, s.config);
      const key = { fieldCount: 'fields', teamCount: 'teams', menCount: 'men', womenCount: 'women' }[input.id];
      config[key] = +input.value;
      if (input.id !== 'fieldCount') {
        const teams = config.men != null ? Math.floor((config.men + config.women) / 2) : config.teams;
        config.fields = Math.min(config.fields, root.TUI.maxParallelFields(teams));
      }
      try { o.build(config); }
      catch (e) {
        if (!e.code) throw e;
        event.stopImmediatePropagation(); input.value = s.config[key];
        root.alert(errorText(e));
      }
    }, true);
    function refresh() {
      const read = readonly(), plan = o.plan(), p = o.get().config.planning || {};
      if (fillForwardInput) {
        fillForwardInput.checked = p.fillForward === true;
        fillForwardInput.disabled = read || busy;
      }
      buttons.forEach(b => {
        b.hidden = read;
        if (b !== courtButton && b.parentNode !== anchor.parentNode) anchor.parentNode.appendChild(b);
      });
      if (courtButton && teamFieldButton) teamFieldButton.parentNode.insertBefore(courtButton, teamFieldButton.nextSibling);
      const setupActions = configBox.querySelector('.cfg-action-content');
      if (setupActions && controls.parentNode !== setupActions) setupActions.appendChild(controls);
      controls.hidden = read;
      if (read) close();
      if (postponeButton) {
        const matches = currentMatches();
        const rescheduled = p.rescheduled || {};
        const scheduled = [];
        root.TPlanning.slots(plan).forEach(slot => (slot.matches || []).forEach((match, field) => {
          if (!match || !Object.prototype.hasOwnProperty.call(rescheduled, match.id)) return;
          const canRemove = !root.TPlanning.hasInput(o.get().results, match.id)
            && !(p.locked && Object.prototype.hasOwnProperty.call(p.locked, match.id));
          scheduled.push('<div class="planning-setting"><span>' + esc(tx('postponeScheduled', {
            match: matchLabel(match.id), time: root.TUI.fmtTime(slot.startMin), field: fieldName(field)
          })) + '</span>' + (canRemove && !read
            ? '<button type="button" class="nbtn" data-postpone-remove="' + esc(match.id) + '">'
              + esc(tx('postponeUndo')) + '</button>' : '') + '</div>');
        }));
        postponeButton.hidden = read || matches.length === 0;
        postponePanel.hidden = postponePanel.hidden || read;
        if (read) postponeButton.setAttribute('aria-expanded', 'false');
        postponeList.innerHTML = scheduled.join('');
        postponeHint.hidden = read || matches.length === 0;
        postponeBox.hidden = read ? !scheduled.length : !matches.length && !scheduled.length;
      }
      const rows = [];
      if (p.retime) rows.push({ kind: 'retime', id: '', label: tx('retimed', { time: p.retime.time }) });
      (p.blocked || []).forEach(b => {
        const field = fieldName(b.field);
        const round = b.fromRound != null ? (rounds()[b.fromRound - 1] || { label: b.fromRound }).label : null;
        const time = b.time || (b.min != null ? root.TC.fromMin(b.min) : null);
        const label = round != null ? tx('blockedFromRound', { field: field, round: round })
          : time ? tx('blockedFromTime', { field: field, time: time }) : tx('blocked', { field: field });
        rows.push({ kind: 'court', id: b.field, label: label });
      });
      (plan.planningPauses || []).forEach(b => rows.push({
        kind: 'pause', id: b.id,
        label: tx('breakRange', { from: root.TUI.fmtTime(b.startMin), to: root.TUI.fmtTime(b.endMin) })
      }));
      const actionLabel = row => row.kind === 'retime' ? tx('resetStartTime')
        : row.kind === 'court' ? tx('releaseCourt') : tx('removePause');
      const editLabel = row => row.kind === 'court' ? tx('editCourt') : tx('editPause');
      summary.innerHTML = rows.length
        ? '<div class="planning-summary-heading"><h3>' + esc(tx('activeChangesTitle')) + '</h3><p>'
          + esc(tx('activeChangesHint')) + '</p></div><div class="planning-summary-list">'
          + rows.map(row => '<div class="planning-setting planning-setting-' + row.kind + '"><span class="planning-setting-label">'
            + esc(row.label) + '</span>' + (read ? '' : '<div class="planning-setting-actions">'
              + (row.kind === 'pause' || row.kind === 'court'
                ? '<button type="button" class="nbtn" data-planning-edit data-planning-kind="' + row.kind
                  + '" data-planning-id="' + esc(row.id) + '">' + esc(editLabel(row)) + '</button>' : '')
              + '<button type="button" class="nbtn" data-planning-remove data-planning-kind="' + row.kind
              + '" data-planning-id="' + esc(row.id) + '">' + esc(actionLabel(row)) + '</button></div>')
            + '</div>').join('') + '</div>'
        : '';
      summary.hidden = !rows.length;
      // K&Q has cards rather than a schedule table. Show the same court/time data.
      const cards = document.getElementById('roundsContainer');
      if (cards) {
        let box = document.getElementById('planningTimeplan');
        if (!box) { box = document.createElement('div'); box.id = 'planningTimeplan'; cards.parentNode.insertBefore(box, cards); }
        box.innerHTML = root.TUI.timeTableHtml(root.TPlanning.slots(plan), { time: root.TUI.fmtTime(plan.endMin), text: tx('end') }, plan.planningPauses);
        root.TPlanning.slots(plan).forEach(slot => slot.matches.forEach((m, f) => {
          if (!m) return;
          const cell = cards.querySelector('[data-mid="' + m.id + '"]');
          if (!cell) return;
          let meta = cell.querySelector('.planning-match-meta');
          if (!meta) { meta = document.createElement('span'); meta.className = 'planning-match-meta'; cell.insertBefore(meta, cell.firstChild); }
          meta.textContent = fieldName(f) + ' · ' + root.TUI.fmtTime(slot.startMin) + '–' + root.TUI.fmtTime(slot.endMin);
        }));
      }
    }
    let wasReadonly = count.disabled;
    new MutationObserver(() => {
      if (wasReadonly === count.disabled) return;
      wasReadonly = count.disabled; refresh();
    }).observe(count, { attributes: true, attributeFilter: ['disabled'] });
    return { refresh: refresh };
  }
  root.TPlanningActions = { mount: mount };
})(typeof window !== 'undefined' ? window : this);
