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
    controls.innerHTML = '<div class="namepanel planning-panel" id="planningPanel" hidden></div>';
    configBox.parentNode.insertBefore(controls, configBox.nextSibling);
    const panel = controls.firstChild;
    const summary = document.createElement('div');
    summary.className = 'planning-summary noprint'; summary.id = 'planningSummary';
    summary.setAttribute('role', 'status');
    controls.parentNode.insertBefore(summary, controls.nextSibling);
    let editing = null, busy = false;
    function readonly() { return count.disabled; }
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
    function close() {
      const kind = editing && editing.kind;
      const restoreFocus = panel.contains(document.activeElement);
      panel.hidden = true; editing = null;
      buttons.forEach(b => b.setAttribute('aria-expanded', 'false'));
      if (restoreFocus && !readonly()) {
        const button = buttons[['retime', 'court', 'pause'].indexOf(kind)];
        if (button) button.focus();
      }
    }
    function open(kind, id) {
      if (readonly() || busy) return;
      if (editing && editing.kind === kind && editing.id === id) { close(); return; }
      const p = o.get().config.planning || {};
      const selected = kind === 'pause' && id != null ? (p.breaks || []).find(b => b.id === id) : null;
      editing = { kind: kind, id: id };
      let fields = '';
      const label = (text, input) => '<label class="planning-field"><span>' + esc(text) + '</span>' + input + '</label>';
      if (kind === 'retime') fields = label(tx('from'), '<input id="planningTime" type="time" required value="' + esc(p.retime ? p.retime.time : now()) + '">');
      if (kind === 'court') {
        let options = '';
        for (let f = 0; f < o.get().config.fields; f++) {
          options += '<option value="' + f + '">' + esc(fieldName(f)) + '</option>';
        }
        const scopes = '<option value="now">' + esc(tx('now')) + '</option>' + rounds().map(r => '<option value="' + r.ordinal + '">' + esc(tx('fromRound', { round: r.label })) + '</option>').join('');
        fields = label(tx('field'), '<select id="planningCourt">' + options + '</select>') + label(tx('from'), '<select id="planningScope">' + scopes + '</select>');
      }
      if (kind === 'pause') fields = label(tx('at'), '<input id="planningTime" type="time" required value="' + esc(selected ? selected.time : now()) + '">')
        + label(tx('minutes'), '<input id="planningMinutes" type="number" min="1" max="1440" step="1" required value="' + (selected ? selected.minutes : 30) + '">');
      panel.innerHTML = '<form class="planning-form"><strong>' + esc(tx(kind)) + '</strong><div class="planning-fields">' + fields + '</div>'
        + '<div class="planning-panel-actions"><button type="submit" class="nbtn">' + esc(tx('apply')) + '</button> <button type="button" class="nbtn" data-planning-close>' + esc(tx('cancel')) + '</button></div>'
        + '<p class="planning-error" role="alert"></p></form>';
      panel.hidden = false;
      buttons.forEach(b => b.setAttribute('aria-expanded', b.id === ({ retime: 'btnRetime', court: 'btnCourtOut', pause: 'btnPlanBreak' })[kind] ? 'true' : 'false'));
      panel.querySelector('input, select').focus();
    }
    async function change(edit) {
      if (readonly() || busy) return;
      const s = o.get(), old = s.config.planning;
      const next = old ? JSON.parse(JSON.stringify(old)) : { blocked: [], breaks: [], locked: {} };
      next.locked = root.TPlanning.capture(o.plan(), s.results, next.locked);
      edit(next);
      const config = Object.assign({}, s.config, { planning: next });
      try { o.build(config); }
      catch (e) { if (!e.code) throw e; message(errorText(e)); return; }
      busy = true;
      s.config.planning = next;
      let ok;
      try { ok = await o.save(); }
      finally { busy = false; }
      if (!ok) {
        if (old) s.config.planning = old; else delete s.config.planning;
        return; // TStore reports storage failures centrally.
      }
      close(); o.rebuild(); refresh();
    }
    panel.addEventListener('submit', event => {
      event.preventDefault();
      if (!editing) return;
      const kind = editing.kind, id = editing.id;
      const time = panel.querySelector('#planningTime');
      change(p => {
        if (kind === 'retime') p.retime = { time: time.value };
        if (kind === 'court') {
          const f = +panel.querySelector('#planningCourt').value;
          const scope = panel.querySelector('#planningScope').value;
          p.blocked = (p.blocked || []).filter(b => b.field !== f);
          const start = now();
          p.blocked.push(scope === 'now' ? { field: f, time: start } : { field: f, fromRound: +scope });
          if (scope === 'now' && (!p.retime || root.TPlanning.clockToMin(p.retime.time, o.plan().startMin)
            < root.TPlanning.clockToMin(start, o.plan().startMin))) p.retime = { time: start };
        }
        if (kind === 'pause') {
          p.breaks = (p.breaks || []).filter(b => b.id !== id);
          p.breaks.push({ id: id || 'pause-' + Date.now(), time: time.value, minutes: +panel.querySelector('#planningMinutes').value });
        }
      });
    });
    panel.addEventListener('click', event => { if (event.target.closest('[data-planning-close]')) close(); });
    panel.addEventListener('keydown', event => { if (event.key === 'Escape') { close(); anchor.focus(); } });
    summary.addEventListener('click', event => {
      const b = event.target.closest('[data-planning-remove], [data-planning-edit]');
      if (!b || readonly()) return;
      const kind = b.getAttribute('data-planning-kind'), id = b.getAttribute('data-planning-id');
      if (b.hasAttribute('data-planning-edit')) { open('pause', id); return; }
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
      buttons.forEach(b => {
        b.hidden = read;
        if (b.parentNode !== anchor.parentNode) anchor.parentNode.appendChild(b);
      });
      const setupActions = configBox.querySelector('.cfg-action-content');
      if (setupActions && controls.parentNode !== setupActions) setupActions.appendChild(controls);
      controls.hidden = read;
      if (read) close();
      const rows = [];
      if (p.retime) rows.push({ kind: 'retime', id: '', label: tx('retimed', { time: p.retime.time }) });
      (p.blocked || []).forEach(b => rows.push({ kind: 'court', id: b.field, label: tx('blocked', { field: fieldName(b.field) }) + ' · '
        + (b.fromRound != null ? tx('fromRound', { round: (rounds()[b.fromRound - 1] || { label: b.fromRound }).label }) : b.time) }));
      (plan.planningPauses || []).forEach(b => rows.push({ kind: 'pause', id: b.id, label: tx('breakRange', { from: root.TUI.fmtTime(b.startMin), to: root.TUI.fmtTime(b.endMin) }) }));
      summary.innerHTML = rows.map(row => '<div class="planning-setting"><span>' + esc(row.label) + '</span>' + (read ? '' : (row.kind === 'pause'
        ? '<button type="button" class="nbtn" data-planning-edit data-planning-kind="pause" data-planning-id="' + esc(row.id) + '">' + esc(tx('edit')) + '</button>' : '')
        + '<button type="button" class="nbtn" data-planning-remove data-planning-kind="' + row.kind + '" data-planning-id="' + esc(row.id) + '">' + esc(tx(row.kind === 'court' ? 'release' : 'remove')) + '</button>') + '</div>').join('');
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
