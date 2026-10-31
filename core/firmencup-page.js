(function () {
  'use strict';
  const F = window.Firmencup, Store = window.FirmencupStore, Server = window.FirmencupServer;
  const params = new URLSearchParams(location.search);
  const en = window.TI18n ? window.TI18n.lang() === 'en' : params.get('lang') === 'en';
  const app = document.getElementById('fc-app'), message = document.getElementById('fc-message');
  const statusBar = document.getElementById('fc-status-bar');
  const missing = [
    ['Firmencup', F], ['FirmencupStore', Store],
    ['FirmencupServer', Server], ['TI18n', window.TI18n]
  ].filter(entry => !entry[1]).map(entry => entry[0]);
  if (Server) ['capabilityFromHash', 'rememberAccess'].forEach(function (name) {
    if (typeof Server[name] !== 'function') missing.push('FirmencupServer.' + name);
  });
  if (missing.length) {
    const error = new Error((en
      ? 'Company cup could not start. Reload the page. Missing module: '
      : 'Firmencup konnte nicht gestartet werden. Bitte Seite neu laden. Fehlendes Modul: ') + missing.join(', '));
    console.error('Firmencup:', error);
    message.textContent = error.message;
    message.setAttribute('role', 'alert');
    message.setAttribute('aria-live', 'assertive');
    statusBar.className = 'fc-error';
    statusBar.hidden = false;
    app.setAttribute('aria-busy', 'false');
    return;
  }
  function poolDirectory(context) {
    const lock = F.groupEditLock(event), positionLock = F.groupPositionLock(event);
    const editing = !readOnly && context !== 'overview';
    return '<div class="fc-group-directory"><div class="fc-pool-grid fc-team-directory">' + event.pools.map((pool, index) =>
      '<div class="fc-pool">' + poolHeading('G' + (index + 1), 'fc-directory-' + context + '-G' + (index + 1), event.status === 'finals') + '<ul>' + pool.map(id =>
        '<li><a href="#fc-team-overview-title" data-overview-team="' + esc(id) + '"' + (id === overviewTeam ? ' aria-current="true"' : '') + '>' +
        esc(teamIdentity(id)) + '</a>' + (!readOnly ? '<span class="fc-team-status noprint">' +
          (event.withdrawals && event.withdrawals[id] ? tr('Zurückgezogen', 'Withdrawn') :
            isAbsent(id) ? tr('Abwesend', 'Absent') : '') + '</span>' : '') +
        (editing && !positionLock ? '<div class="fc-group-assignment noprint">' + (!lock ? groupSelection(id, index, context) : '') +
          groupPosition(id, index, context) + '</div>' : '') + '</li>').join('') + '</ul></div>').join('') + '</div>' +
      (editing && positionLock ? '<p class="fc-note noprint">' + esc(en ? positionLock.split(' / ')[0] : positionLock.split(' / ')[1]) + '</p>' : '') + '</div>';
  }
  function groupSelection(id, source, context) {
    return '<select class="fc-group-select noprint" data-group-select="' + esc(id) +
      '" id="fc-group-select-' + context + '-' + esc(id) + '" aria-label="' +
      esc(tr('Gruppe ändern: ', 'Change group: ') + teamIdentity(id)) + '">' +
      '<option value="current">' + esc(poolLabel('G' + (source + 1), false)) + '</option>' +
      event.pools.map((pool, target) => target === source ? '' :
        '<optgroup label="' + esc(poolLabel('G' + (target + 1), false)) + '">' +
        (event.pools[source].length === pool.length + 1 && event.pools[source].length > 2 ?
          '<option value="' + target + ':move">' + esc(poolLabel('G' + (target + 1), false) + ' · ' +
            tr('Verschieben (ohne Tausch)', 'Move (without swap)')) + '</option>' : '') +
        pool.map(team => '<option value="' + target + ':team:' + esc(team) + '">' +
          esc(poolLabel('G' + (target + 1), false) + ' · ' + tr('Tausch mit ', 'Swap with ') + teamIdentity(team)) +
          '</option>').join('') + '</optgroup>').join('') + '</select>';
  }
  function groupPosition(id, source, context) {
    const current = event.pools[source].indexOf(id);
    return '<select class="fc-group-position noprint" data-group-position="' + esc(id) +
      '" id="fc-group-position-' + context + '-' + esc(id) + '" aria-label="' +
      esc(tr('Gruppen-Startposition ändern: ', 'Change pool start position: ') + teamIdentity(id) + ' · ' +
        poolLabel('G' + (source + 1), false)) + '" title="' +
      esc(tr('Startposition im Gruppenplan, nicht Tabellenrang', 'Start position in the pool schedule, not standings rank')) + '">' +
      event.pools[source].map((team, i) => '<option value="' + i + '"' + (i === current ? ' selected' : '') + '>' +
        tr('Pos. ', 'Pos. ') + (i + 1) + '</option>').join('') + '</select>';
  }
  function groupBreakdown(context) {
    if (!event.pools.length) return '';
    const titleId = 'fc-group-breakdown-' + context + '-title';
    return '<section class="fc-group-breakdown" id="fc-group-breakdown-' + context + '" aria-labelledby="' + titleId + '"><h2 id="' + titleId + '">' +
      tr('Gruppen & Teams', 'Pools & teams') + '</h2>' + poolDirectory(context) + '</section>';
  }
  function bindGroupEditors() {
    async function apply(select, next, description) {
      if (!confirm(description + '\n\n' + tr(
        'Gruppenzuordnung übernehmen und Spielplan mit Paarungen, Startzeiten, Feldern und Schiridiensten neu erstellen? Firmen, Kader, Anwesenheit, Regeln, Verzögerungen und Feldlimits bleiben erhalten. Neue Pläne anschließend verteilen/drucken.',
        'Apply group assignments and rebuild fixtures, start times, courts and referee duties? Companies, rosters, attendance, rules, delays and court limits are retained. Distribute/print the new schedule afterwards.'))) return;
      await save(next, tr('Gruppenzuordnung gespeichert. Spielplan neu erstellt – bitte neu verteilen/drucken.', 'Group assignments saved. Schedule rebuilt – distribute/print it again.'));
      const updated = document.getElementById(select.id);
      if (updated) updated.focus();
    }
    app.querySelectorAll('[data-group-select]').forEach(select => {
      select.onchange = function () {
        if (select.value === 'current') return;
        const choice = select.value.split(':'), targetPool = Number(choice[0]);
        const swapId = choice[1] === 'move' ? null : choice[2], teamId = select.dataset.groupSelect;
        select.value = 'current';
        action(async function () {
          if (hasUnsavedSetup()) throw new Error(tr('Zuerst ungespeicherte Firmen-/Teameingaben speichern.', 'Save unsaved company/team inputs first.'));
          const source = event.pools.findIndex(pool => pool.indexOf(teamId) >= 0);
          const fromLabel = poolLabel('G' + (source + 1), false), toLabel = poolLabel('G' + (targetPool + 1), false);
          const next = F.reassignGroup(event, teamId, targetPool, swapId, true);
          await apply(select, next, teamIdentity(teamId) + ': ' + fromLabel + ' → ' + toLabel +
            (swapId ? '\n' + teamIdentity(swapId) + ': ' + toLabel + ' → ' + fromLabel : ''));
        });
      };
    });
    app.querySelectorAll('[data-group-position]').forEach(select => {
      select.onchange = function () {
        const id = select.dataset.groupPosition, pool = event.pools.findIndex(p => p.indexOf(id) >= 0);
        const from = event.pools[pool].indexOf(id), to = Number(select.value);
        select.value = String(from);
        action(async function () {
          if (hasUnsavedSetup()) throw new Error(tr('Zuerst ungespeicherte Firmen-/Teameingaben speichern.', 'Save unsaved company/team inputs first.'));
          await apply(select, F.reorderGroup(event, id, to, true), teamIdentity(id) + ' · ' + poolLabel('G' + (pool + 1), false) +
            '\n' + tr('Gruppen-Startposition ', 'Pool start position ') + (from + 1) + ' → ' + (to + 1) +
            '\n' + tr('Keine Änderung des sportlichen Tabellenrangs.', 'This does not override the standings rank.'));
        });
      };
    });
  }
  const capability = Server.capabilityFromHash(location.hash);
  const linkAccess = Server.accessFromHash(location.hash);
  let participant = !!(linkAccess && linkAccess.role === 'participant');
  let readOnly = participant || (params.has('eventId') && !capability);
  const statusNext = document.getElementById('fc-status-next');
  const statusNextLabel = document.getElementById('fc-status-next-label'), statusActionLink = document.getElementById('fc-status-action');
  let event = null, busy = false, setupStep = 1, setupSettingsDraft = null, phase = null, routedHash = null, toolsReturn = null, lastScored = null;
  let binding = null, livePublic = false, liveRevision = null, liveEtag = null, pollingPublic = false;
  let currentStatusAction = null, orgOpen = false;
  let saving = false;
  let editorBaseline = '{}';
  let previewCache = null;
  let groupFilter = '', searchQuery = '';
  let resultsQuery = '', resultsGroupFilter = '';
  function editorFields() {
    const fields = {};
    app.querySelectorAll('#fc-edit input, #fc-edit select, #fc-edit textarea, #fc-teams-edit input, #fc-teams-edit select, #fc-teams-edit textarea').forEach(input => {
      if (input.name === 'org-count' || input.id === 'fc-new-team-org' || input.hasAttribute('data-group-select') || input.hasAttribute('data-team-position')) return;
      const attribute = ['data-org-name', 'data-team-name', 'data-team-org', 'data-member', 'data-nominee'].find(name => input.hasAttribute(name));
      const key = attribute ? '[' + attribute + '="' + input.getAttribute(attribute) + '"]' +
        (attribute === 'data-member' ? '[data-index="' + input.dataset.index + '"]' : '') : '#fc-edit [name="' + input.name + '"]';
      fields[key] = input.value;
    });
    return fields;
  }
  function hasUnsavedSetup() {
    return !readOnly && !!event && (!!setupSettingsDraft || !!app.querySelector('[data-draft-commit]') || JSON.stringify(editorFields()) !== editorBaseline);
  }
  function updateSaveButtons() {
    const previous = JSON.parse(editorBaseline), current = editorFields();
    const invalidSettings = invalidSetupSettings();
    const dirty = !!app.querySelector('[data-draft-commit]') || Object.keys(current).some(key => {
      if (invalidSettings && key.indexOf('#fc-edit ') === 0) return false;
      return String(current[key] || '').trim() !== String(previous[key] || '').trim();
    });
    app.querySelectorAll('[data-action="save-setup"]').forEach(button => {
      button.disabled = busy || saving || !dirty;
    });
  }
  window.addEventListener('beforeunload', function (ev) {
    if (!hasUnsavedSetup() && !saving) return;
    ev.preventDefault();
    ev.returnValue = '';
    return '';
  });
  function editorFocus() {
    const input = document.activeElement;
    if (!input || !input.closest('#fc-edit, #fc-teams-edit')) return null;
    if (!input.getClientRects().length) return null;
    const key = Object.keys(editorFields()).find(selector => app.querySelector(selector) === input);
    return key ? { key: key, start: input.selectionStart, end: input.selectionEnd } : null;
  }
  function restoreEditor(fields, focus) {
    Object.keys(fields).forEach(selector => {
      const input = app.querySelector(selector);
      if (input) input.value = fields[selector];
    });
    if (focus) {
      const input = app.querySelector(focus.key);
      if (input) {
        revealTarget(input);
        input.focus();
        if (typeof focus.start === 'number') input.setSelectionRange(focus.start, focus.end);
      }
    }
    updateSetupPreview();
    updateSaveButtons();
  }
  const waveOpenOverride = new Map();
  function tr(de, english) { return en ? english : de; }
  statusBar.setAttribute('aria-label', tr('Status und nächste Aktion', 'Status and next action'));
  function entityDefaultName(index) { return tr('Firma ', 'Company ') + index; }
  function identity(title) {
    const heading = title || tr('Firmencup', 'Company cup');
    document.getElementById('fc-heading').textContent = heading;
    document.title = heading + ' · CompetitionPilot';
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function uid() {
    const bytes = new Uint32Array(4); crypto.getRandomValues(bytes);
    return Array.from(bytes).map(n => n.toString(36)).join('-');
  }
  function reserveStatusSpace() {
    statusBar.hidden = !message.textContent && statusNext.hidden;
    const reserved = statusBar.hidden ? '' : statusBar.offsetHeight + 12 + 'px';
    document.body.style.paddingBottom = reserved;
    document.documentElement.style.scrollPaddingBottom = reserved;
    const appBar = document.querySelector('.app-bar');
    const top = appBar && /sticky|fixed/.test(getComputedStyle(appBar).position) ? Math.ceil(appBar.getBoundingClientRect().height) + 8 : 0;
    document.documentElement.style.scrollPaddingTop = top ? top + 'px' : '';
    if (top) document.documentElement.style.setProperty('--fc-appbar-clearance', top + 'px');
    else document.documentElement.style.removeProperty('--fc-appbar-clearance');
    if (reserved) document.documentElement.style.setProperty('--fc-status-clearance', reserved);
    else document.documentElement.style.removeProperty('--fc-status-clearance');
  }
  window.addEventListener('resize', reserveStatusSpace);
  function notify(text, error, success) {
    message.textContent = text;
    statusBar.className = error ? 'fc-error' : success ? 'fc-success' : '';
    message.setAttribute('role', error ? 'alert' : 'status');
    message.setAttribute('aria-live', error ? 'assertive' : 'polite');
    reserveStatusSpace();
  }
  function clearSuccessNotice() {
    if (!statusBar.classList.contains('fc-success')) return;
    message.textContent = '';
    statusBar.className = '';
    reserveStatusSpace();
  }
  document.addEventListener('invalid', function (ev) {
    const field = ev.target, form = field && field.form;
    const firstInvalid = form && form.querySelector(':invalid');
    if (field && field.validationMessage && (!firstInvalid || field === firstInvalid)) {
      notify(field.validationMessage, true);
    }
  }, true);
  function statusAction() {
    if (!event) return {
      label: tr('Titel eingeben und Planung starten', 'Enter a title and start planning'),
      href: '#fc-create',
      phase: null,
      step: null,
      target: function () { return document.querySelector('#fc-create input'); }
    };
    if (readOnly) return null;
    if (!event.matches.length) {
      if (!event.organizations.length) return {
        label: tr('Firma hinzufügen', 'Add a company'),
        href: '#fc-editor',
        phase: 'teams',
        step: 1,
        target: function () { return app.querySelector('[data-action="add-org"]'); }
      };
      const emptyOrganization = event.organizations.find(o => !event.teams.some(t => t.orgId === o.id));
      if (emptyOrganization || event.teams.length < F.teamLimits(event).min) {
        const organization = emptyOrganization || event.organizations[0];
        return {
          label: tr('Team hinzufügen', 'Add a team'),
          href: '#fc-editor',
          phase: 'teams',
          step: 1,
          target: function () {
            return app.querySelector('[data-team-name="' + draftTeamId(organization.id) + '"]') || Array.from(app.querySelectorAll('[data-action="add-team"]'))
              .find(node => node.dataset.company === organization.id) || app.querySelector('[data-action="add-team"]');
          }
        };
      }
      const missingNominee = F.rankingMode(event) === 'nominee' && event.organizations.find(o =>
        !event.teams.some(t => t.id === o.nominee && t.orgId === o.id));
      if (missingNominee) return {
        label: tr('Team für den Firmenpokal wählen', 'Choose the company trophy team'),
        href: '#fc-editor',
        phase: 'teams',
        step: 1,
        target: function () {
          return Array.from(app.querySelectorAll('[data-nominee]'))
            .find(node => node.dataset.nominee === missingNominee.id);
        }
      };
      return {
        label: tr('Spielplan erstellen & weiter', 'Create schedule & continue'),
        href: '#fc-setup',
        phase: 'configuration',
        step: 3,
        target: function () { return app.querySelector('[data-action="build"]'); }
      };
    }
    const scoredFixture = lastScored && Array.from(app.querySelectorAll('.fc-fixture'))
      .find(node => node.dataset.match === lastScored);
    const scoredAction = scoredFixture && scoredFixture.querySelector('.fc-score-next a');
    const cockpitAction = app.querySelector('#fc-cockpit .fc-next a');
    const resultsAction = app.querySelector('#fc-cockpit-results');
    const anchor = scoredAction || cockpitAction || resultsAction;
    if (!anchor) return null;
    const targetId = anchor.dataset.focusTarget || anchor.getAttribute('href').slice(1);
    return {
      label: anchor.textContent.trim(),
      href: anchor.getAttribute('href'),
      phase: 'play',
      step: null,
      target: function () { return navigationTarget(targetId); }
    };
  }
  function updateStatusAction() {
    currentStatusAction = statusAction();
    statusNext.hidden = !currentStatusAction;
    statusBar.setAttribute('aria-label', tr('Status und nächste Aktion', 'Status and next action'));
    if (currentStatusAction) {
      statusNextLabel.textContent = tr('Nächster Schritt: ', 'Next step: ');
      statusActionLink.textContent = currentStatusAction.label;
      statusActionLink.href = currentStatusAction.href;
    }
    reserveStatusSpace();
  }
  function focusStatusTarget(target) {
    if (!target) throw new Error(tr('Die nächste Aktion ist gerade nicht verfügbar. Ansicht aktualisieren.', 'The next action is not currently available. Refresh the view.'));
    revealTarget(target);
    target.scrollIntoView({ block: target.matches('section') ? 'start' : 'center' });
    if (target.matches('article')) {
      const input = target.querySelector('input, select, button');
      (input || target).focus();
    } else {
      if (!target.hasAttribute('tabindex') && !/^(A|BUTTON|INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) target.setAttribute('tabindex', '-1');
      target.focus();
    }
  }
  statusActionLink.onclick = function (ev) {
    ev.preventDefault();
    const next = currentStatusAction;
    if (!next) return;
    action(async function () {
      if (!event) {
        focusStatusTarget(next.target());
        return;
      }
      if (next.phase && next.phase !== phase && !(await switchPhase(next.phase, false))) return;
      focusStatusTarget(next.target());
    });
  };
  function button(action, label, describedBy) { return '<button type="' + (action === 'save-setup' ? 'submit' : 'button') + '" data-action="' + action + '"' +
    (describedBy ? ' aria-describedby="' + describedBy + '"' : '') + '>' + label + '</button>'; }
  function shareUrlField(id, label, url) {
    return '<div class="fc-share-url-row"><label for="' + id + '">' + label +
      '<input id="' + id + '" class="fc-share-url" type="text" aria-label="' + label + '" value="' + esc(url) + '" readonly></label>' +
      '<button type="button" data-action="copy-share-link" data-copy-target="' + id + '">' +
      tr('Link kopieren', 'Copy link') + '</button></div>';
  }
  function label(name, title, value, type, min, max) {
    return '<label>' + title + '<input name="' + name + '" type="' + (type || 'text') + '" value="' + esc(value) + '" required' +
      (min == null ? '' : ' min="' + min + '" max="' + max + '"') + '></label>';
  }
  function teamLimit(target) {
    return F.teamLimits(target).max;
  }
  function teamRange(target) {
    const limits = F.teamLimits(target);
    return limits.min + '–' + limits.max;
  }
  function rosterGuidance() {
    return tr('Spieler:innen-Namen sind optional.', 'Player names are optional.');
  }
  function statusLabel(status) {
    if (status === 'draft') return tr('Noch kein Spielplan', 'No schedule yet');
    if (status === 'groups') return tr('Gruppenphase', 'Group stage');
    if (status === 'finals') return tr('Endrunde', 'Finals');
    return tr('Status unbekannt', 'Unknown status');
  }
  function teamName(id) {
    const t = event.teams.find(t => t.id === id);
    return t ? t.name : tr('Noch offen', 'Pending');
  }
  function orgName(id) { const o = event.organizations.find(o => o.id === id); return o ? o.name : ''; }
  function teamIdentity(id) {
    const team = event.teams.find(t => t.id === id);
    const name = teamName(id), company = team ? orgName(team.orgId) : '';
    return company && company !== name ? company + ' · ' + name : name;
  }
  function teamPool(id) {
    const index = event.pools.findIndex(pool => pool.indexOf(id) >= 0);
    return index < 0 ? '' : 'G' + (index + 1);
  }
  function poolLabel(pool, origin) {
    if (event.groupNames && event.groupNames[pool]) {
      return (origin ? tr('Vorrunde · ', 'Group stage · ') : '') + event.groupNames[pool];
    }
    return (origin ? tr('Vorrundengruppe ', 'Group-stage pool ') : tr('Gruppe ', 'Pool ')) + pool.slice(1);
  }
  function poolHeading(pool, id, origin) {
    const label = poolLabel(pool, origin);
    return '<h3 class="fc-group-name" id="' + id + '"><span>' + esc(label) + '</span>' +
      (readOnly ? '' : '<button type="button" class="fc-group-rename noprint" data-group-rename="' + pool +
        '" aria-label="' + esc(tr('Gruppe umbenennen: ', 'Rename pool: ') + label) + '" title="' +
        esc(tr('Gruppenname bearbeiten', 'Edit pool name')) + '"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m16 3 5 5-13 13H3v-5Z"/><path d="m14 5 5 5"/></svg></button>') + '</h3>';
  }
  function bindGroupNames() {
    let active = null;
    app.querySelectorAll('[data-group-rename]').forEach(button => {
      button.onclick = function () {
        if (active) { active.focus(); return; }
        if (hasUnsavedSetup()) {
          notify(tr('Zuerst ungespeicherte Firmen-/Teameingaben speichern.', 'Save unsaved company/team inputs first.'), true);
          return;
        }
        const heading = button.parentElement, pool = button.dataset.groupRename;
        const input = document.createElement('input');
        input.type = 'text'; input.maxLength = 60; input.required = true;
        input.value = event.groupNames && event.groupNames[pool] || poolLabel(pool, false);
        input.setAttribute('aria-label', tr('Gruppenname: ', 'Pool name: ') + poolLabel(pool, false));
        input.setAttribute('data-group-name', pool);
        heading.classList.add('fc-group-name-editing');
        heading.appendChild(input); active = input;
        function cancel(focus) {
          active = null; input.onblur = null; input.remove();
          heading.classList.remove('fc-group-name-editing');
          if (focus) button.focus();
        }
        function commit(focus) {
          if (!active || busy) return;
          let next;
          try { next = F.renameGroup(event, pool, input.value); }
          catch (error) {
            input.setCustomValidity(tr('Bitte einen Gruppennamen mit 1–60 Zeichen eingeben.', 'Enter a pool name with 1–60 characters.'));
            input.reportValidity();
            notify(input.validationMessage, true);
            return;
          }
          if (next.groupNames[pool] === (event.groupNames && event.groupNames[pool] || poolLabel(pool, false))) {
            cancel(focus); return;
          }
          const target = !focus && document.activeElement, targetId = target && target.id;
          active = null; input.onblur = null;
          action(async function () {
            try {
              await save(next, tr('Gruppenname gespeichert. Spielplan und Ergebnisse bleiben unverändert.', 'Pool name saved. Schedule and results are unchanged.'));
            } catch (error) {
              if (input.isConnected) {
                active = input; input.onblur = () => commit(false); input.focus();
              }
              throw error;
            }
            const restored = document.getElementById(focus ? heading.id : targetId);
            if (restored) (focus ? restored.querySelector('[data-group-rename]') : restored).focus();
          });
        }
        input.oninput = () => input.setCustomValidity('');
        input.onkeydown = function (ev) {
          if (ev.isComposing) return;
          if (ev.key === 'Enter') { ev.preventDefault(); commit(true); }
          if (ev.key === 'Escape' || ev.key === 'Esc') { ev.preventDefault(); cancel(true); }
        };
        input.onblur = () => commit(false);
        input.focus(); input.select();
      };
    });
  }
  function groupBadge(pool, origin, linked) {
    if (!pool) return '';
    const text = esc(poolLabel(pool, origin));
    return linked ? '<a class="fc-group-badge" href="#fc-pool-' + pool + '" data-focus-target="fc-pool-' + pool + '">' + text + '</a>' :
      '<span class="fc-group-badge">' + text + '</span>';
  }
  function teamBadge(id, origin, linked) {
    return groupBadge(teamPool(id), origin, linked);
  }
  function teamLink(id) {
    return '<a href="#fc-team-overview-title" data-overview-team="' + esc(id) + '">' + esc(teamName(id)) + '</a>';
  }
  function matchContext(m, linked) {
    return '<span class="fc-match-context">' + (m.phase === 'group' ? groupBadge(m.pool, false, linked) :
      '<span class="fc-bracket-badge">' + tr('Baumphase', 'Bracket stage') + '</span>') + '</span>';
  }
  function options(items, current) {
    return items.map(t => {
      const pool = t.orgId ? teamPool(t.id) : '';
      return '<option value="' + esc(t.id) + '"' + (t.id === current ? ' selected' : '') + '>' +
        esc(t.name + (pool ? ' · ' + poolLabel(pool, event.status === 'finals') : '')) + '</option>';
    }).join('');
  }
  function captureSetupSettings() {
    const form = document.getElementById('fc-edit');
    if (!form) return null;
    const names = ['title', 'start', 'end', 'minutes', 'treeMinutes', 'timingMode', 'groupCount', 'placementThrough', 'change', 'rest', 'fields', 'referees', 'refereeMode', 'rankingMode', 'tiePolicy'];
    return names.reduce((draft, name) => {
      const field = form.elements.namedItem(name);
      if (field) draft[name] = field.value;
      return draft;
    }, {});
  }
  function endTime(start, window) {
    const startMinute = Number(start.slice(0, 2)) * 60 + Number(start.slice(3, 5));
    const endMinute = (startMinute + window) % 1440;
    return String(Math.floor(endMinute / 60)).padStart(2, '0') + ':' +
      String(endMinute % 60).padStart(2, '0');
  }
  function timeMinutes(time) {
    return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
  }
  function timeWindow(start, end) {
    if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) return null;
    const startMinute = timeMinutes(start);
    let endMinute = timeMinutes(end);
    if (startMinute >= 1440 || endMinute >= 1440) return null;
    if (endMinute <= startMinute) endMinute += 1440;
    return endMinute - startMinute;
  }
  function updateTimeWindowValidity(form) {
    const start = form.elements.namedItem('start');
    const end = form.elements.namedItem('end');
    if (!start || !end) return;
    const minutes = timeWindow(start.value, end.value);
    const message = minutes === null ? '' : minutes < 30 ?
      tr('Zeitfenster muss mindestens 30 Minuten betragen.', 'Available time must be at least 30 minutes.') :
      minutes > 1440 ? tr('Zeitfenster darf höchstens 24 Stunden betragen.', 'Available time cannot exceed 24 hours.') : '';
    end.setCustomValidity(message);
  }
  function invalidSetupSettings() {
    const form = document.getElementById('fc-edit');
    if (!form) return false;
    updateTimeWindowValidity(form);
    return Array.from(form.querySelectorAll('[name="title"], [name="start"], [name="end"], [name="minutes"], [name="treeMinutes"], [name="timingMode"], [name="groupCount"], [name="placementThrough"], [name="change"], [name="rest"], [name="fields"], [name="referees"], [name="refereeMode"], [name="rankingMode"], [name="tiePolicy"]'))
      .some(field => !field.validity.valid);
  }
  function settings(c) {
    const draft = setupSettingsDraft || {};
    const value = name => Object.prototype.hasOwnProperty.call(draft, name) ? draft[name] : c[name];
    const start = value('start');
    const end = Object.prototype.hasOwnProperty.call(draft, 'end') ? draft.end : endTime(c.start, c.window);
    return '<div class="fc-settings"><fieldset><legend>' + tr('Veranstaltung', 'Event') + '</legend>' +
      label('title', tr('Titel', 'Title'), value('title') == null ? (event ? event.title : tr('Mein Turnier', 'My tournament')) : value('title')) +
      '</fieldset><fieldset id="fc-time-settings"><legend>' + tr('Zeitrahmen, Spielzeit & Pausen', 'Timing, match length & breaks') + '</legend>' +
      '<div class="fc-time-range">' +
      label('start', tr('Anfangszeit', 'Start time'), start, 'time') +
      label('end', tr('Verfügbar bis', 'Available until'), end, 'time') +
      '</div>' +
      '<p class="fc-note fc-time-window-note">' + tr('Verfügbares Zeitfenster, nicht das berechnete Turnierende. Ende vor Anfang bedeutet Folgetag; gleiche Uhrzeiten 24 Stunden. Dauer: 30 Minuten bis 24 Stunden.', 'Available time window, not the calculated tournament finish. An earlier end means the next day; equal times mean 24 hours. Duration: 30 minutes to 24 hours.') + '</p>' +
      '<div class="fc-grid">' +
      '<label>' + tr('Spielzeit je Phase', 'Playing time by phase') + '<select name="timingMode">' +
      [['uniform', tr('Einheitlich', 'Uniform')], ['separate', tr('Vorrunde und Baumphase getrennt', 'Separate group and bracket stages')]].map(row =>
        '<option value="' + row[0] + '"' + (row[0] === value('timingMode') ? ' selected' : '') + '>' + row[1] + '</option>').join('') + '</select></label>' +
      label('minutes', tr('Spielzeit je Spielrunde (Min.)', 'Playing time per slot (min)'), value('minutes'), 'number', 1, 60) +
      label('treeMinutes', tr('Spielzeit Baumphase (Min.)', 'Bracket stage playing time (min)'), value('treeMinutes'), 'number', 1, 60) +
      label('change', tr('Wechselzeit nach der Spielrunde (Min.)', 'Changeover after each slot (min)'), value('change'), 'number', 1, 30) +
      label('rest', tr('Mindestzahl spielfreier Runden zwischen eigenen Spielen (1–5)', 'Minimum non-playing slots between own matches (1–5)'), value('rest'), 'number', 1, 5) +
      '<p class="fc-note fc-rest-help" id="fc-rest-help">' + tr('Spielruhe ist nicht dienstfrei: Team-Schiris dürfen in spielfreien Runden pfeifen.', 'Match rest is not duty-free: team referees may officiate during non-playing slots.') + '</p>' +
      '<label>' + tr('Bei Gleichstand am Zeitende', 'When tied at the time limit') + '<select name="tiePolicy">' +
      [['lead', tr('Weiterspielen bis zur ersten Führung', 'Continue until the first lead')],
        ['draw', tr('Remis zulassen · im K.-o. Losentscheid', 'Allow draws · knockout uses a lottery')]].map(row =>
        '<option value="' + row[0] + '"' + (row[0] === value('tiePolicy') ? ' selected' : '') + '>' + row[1] + '</option>').join('') + '</select></label>' +
      '</div></fieldset><fieldset><legend>' + tr('Felder & Spielregeln', 'Courts & playing rules') + '</legend><div class="fc-grid">' +
      '<label>' + tr('Gruppenanzahl', 'Number of pools') + '<select name="groupCount" required>' +
      groupCountOptions(Number(value('groupCount'))) + '</select></label>' +
      '<p class="fc-note">' + tr('Automatisch: möglichst Vierergruppen. Manuell sind 1 bis zur halben Teamzahl möglich; alle Gruppen bleiben ausgeglichen und haben mindestens zwei Teams. Größere Gruppen erzeugen entsprechend mehr Spiele – die Vorschau zeigt den tatsächlichen Plan und Zeitwarnungen.',
        'Automatic: aim for pools of four. Manually choose 1 through half the team count; pools stay balanced and contain at least two teams. Larger pools generate more matches—the preview shows the actual plan and timing warnings.') + '</p>' +
      '<label>' + tr('Platzierungen', 'Placements') + '<select name="placementThrough" required data-bands="' +
      esc(JSON.stringify(setupBands(Number(value('groupCount'))))) + '">' +
      placementOptions(String(value('placementThrough')), Number(value('groupCount'))) + '</select></label>' +
      '<p class="fc-note">' + tr('Der Titelblock wird immer vollständig ausgespielt. Hintere Blöcke können je Block einen gemeinsamen Rang teilen; dadurch sinkt die Zahl der Spiele. Firmenmittelwerte verwenden den ersten Rang des geteilten Blocks.',
        'The title band is always fully played. Lower bands can share a rank within each band, reducing match counts. Company means use the first rank of each shared band.') + '</p>' +
      label('fields', tr('Verfügbare Felder', 'Available courts'), value('fields'), 'number', 1, 16) +
      '<label>' + tr('Schiri-Modus', 'Referee mode') + '<select name="refereeMode">' +
      [['teams', tr('Team-Schiris · ein anderes Team je Spiel', 'Team referees · another team per match')],
        ['external', tr('Externe, dedizierte Schiris', 'Dedicated external referees')],
        ['none', tr('Ohne Schiris · selbst geleitete Spiele', 'No referees · self-officiated matches')]].map(row =>
        '<option value="' + row[0] + '"' + (row[0] === value('refereeMode') ? ' selected' : '') + '>' + row[1] + '</option>').join('') + '</select></label>' +
      label('referees', tr('Externe Schiedsrichter:innen gleichzeitig', 'Dedicated external referees'), value('referees'), 'number', 1, 16) +
      '<p class="fc-note" id="fc-referee-help"></p>' +
      '<label>' + tr('Endwertung: Teams / Firmenpokal', 'Final standings: teams / company trophy') + '<select name="rankingMode">' +
      [['teams', tr('Teamwertung · kein Firmenpokal', 'Team standings · no company trophy')],
        ['mean', tr('Zusätzlich Firmenwertung · mittlerer Team-Endrang', 'Also company standings · mean team final rank')],
        ['nominee', tr('Optional: ausgewähltes Team je Firma', 'Optional: selected team per company')]].map(row =>
        '<option value="' + row[0] + '"' + (row[0] === value('rankingMode') ? ' selected' : '') + '>' + row[1] + '</option>').join('') + '</select></label>' +
      '<details class="fc-config-rule-help"><summary>' + tr('Zeitgleichstand & Seitenwechsel erklärt', 'Time ties & side changes explained') + '</summary><p>' +
      timingExplanation(value('tiePolicy')) + '</p></details></div></fieldset></div>';
  }
  function groupCountOptions(current) {
    const count = event.teams.length, max = count >= 2 ? Math.floor(count / 2) : 0;
    const choices = [{ value: 0, text: tr('Automatisch · auf Vierergruppen zielen', 'Automatic · aim for groups of four') }];
    for (let n = 1; n <= max; n++) choices.push({ value: n, text: n + ' ' + tr('Gruppen', 'pools') });
    const valid = choices.some(choice => choice.value === current);
    if (!valid) choices.unshift({ value: '',
      text: tr('Aktuelle Gruppenzahl ungültig – neu wählen', 'Current pool count invalid – choose again') });
    return choices.map(choice => '<option value="' + choice.value + '"' +
      (choice.value === current || !valid && choice.value === '' ? ' selected' : '') +
      (choice.value === '' ? ' disabled' : '') + '>' +
      esc(choice.text) + '</option>').join('');
  }
  function setupBands(groupCount) {
    return F.classificationBands(event.teams.length, F.effectivePoolCount(event.teams.length, { groupCount: groupCount }));
  }
  function placementOptions(current, groupCount) {
    const bands = setupBands(groupCount), cuts = bands.slice(0, -1);
    const choices = [{ value: 0, text: tr('Alle Plätze ausspielen', 'Play all places') }].concat(cuts.map(band => ({
      value: band.to, text: tr('Individuell bis ', 'Individual places through ') + band.to + ' · ' +
        bands.filter(lower => lower.from > band.to).map(lower => placeRange(lower.from, lower.to) + tr(' geteilt', ' shared')).join(' / ')
    })));
    const valid = choices.some(choice => String(choice.value) === current);
    if (!valid) choices.unshift({ value: '',
      text: tr('Gruppen geändert – Platzierungsblöcke neu wählen', 'Pools changed – choose placement bands again') });
    return choices.map(choice => '<option value="' + choice.value + '"' +
      (String(choice.value) === current || !valid && choice.value === '' ? ' selected' : '') +
      (choice.value === '' ? ' disabled' : '') + '>' + esc(choice.text) + '</option>').join('');
  }
  function setupPreview(saved) {
    return '<section id="fc-setup-preview" class="fc-setup-preview" aria-labelledby="fc-setup-preview-title">' +
      '<h3 id="fc-setup-preview-title">' + tr('Planung auf einen Blick', 'Schedule at a glance') + '</h3>' +
      '<p class="fc-preview-source">' + tr('Geschätzt · inklusive Endrunde', 'Estimated · including finals') + '</p>' +
      '<div class="fc-setup-preview-grid">' +
      [
        ['teams', tr('Teams', 'Teams')],
        ['groups', tr('Gruppen', 'Pools')],
        ['minimum-games', tr('Spiele/<wbr>Team', 'Matches/<wbr>team')],
        ['courts', tr('Felder genutzt', 'Courts used')],
        ['group-end', tr('Vorrunde', 'Group stage')],
        ['event-end', tr('Ende', 'Finish')]
      ].map(([key, caption]) => '<div class="fc-setup-kpi" data-preview="' + key + '">' +
        '<span class="fc-setup-kpi-label">' + caption + '</span><strong data-preview-value="' + key + '">–</strong>' +
        (key === 'groups' ? '<small><span data-preview-value="group-games">–</span> ' + tr('Spiele', 'matches') + '</small>' : '') +
        '</div>').join('') +
      '</div>' + capacity(!saved) + (event.matches.length ? '<p class="noprint"><a href="#fc-pools" data-focus-target="fc-pools">' +
        tr('Gespeicherte Gruppeneinteilung ansehen', 'View saved pool assignments') + '</a></p>' : '') + '</section>';
  }
  function setupFeedback() {
    return (
      '<p id="fc-setup-preview-status" class="fc-setup-preview-status" role="status" aria-live="polite"></p>' +
      '<ul id="fc-setup-advice" class="fc-setup-advice" aria-label="' + tr('Planungshinweise', 'Planning advice') + '" aria-live="polite" hidden></ul>' +
      '<p id="fc-setup-prereq" class="fc-setup-prereq noprint" hidden><button type="button" data-phase="teams">' +
      tr('Zu Firmen & Teams', 'Go to companies & teams') + '</button></p>');
  }
  function updatePreviewBadges(host, plan, estimate, saved) {
    const set = (key, value) => {
      host.querySelector('[data-preview-value="' + key + '"]').textContent = value;
    };
    set('teams', String(plan.teams.length));
    const group = estimate.phases.find(p => p.phase === 'group');
    set('groups', String(plan.pools.length));
    set('group-games', String(group.matches));
    set('minimum-games', gameRange(estimate.games.final));
    set('courts', String(estimate.courts));
    set('group-end', F.clock(group.startMin) + '–' + F.clock(group.endMin));
    set('event-end', F.clock(estimate.projectedEndMin));
    host.querySelector('.fc-preview-source').textContent = plan.status === 'finals' && saved ?
      tr('Gespeicherter Spielplan', 'Saved schedule') :
      saved ? tr('Endrunde geschätzt · Vorrunde gespeichert', 'Finals estimated · group stage saved') :
        tr('Geschätzt · inklusive Endrunde', 'Estimated · including finals');
  }
  function updateSetupPreview() {
    const host = document.getElementById('fc-setup-preview');
    const form = document.getElementById('fc-edit');
    if (!host) return;
    if (!form) {
      updatePreviewBadges(host, event, F.estimate(event), true);
      return;
    }
    const groupCount = form.elements.namedItem('groupCount');
    const placementThrough = form.elements.namedItem('placementThrough');
    if (groupCount && placementThrough) {
      const bands = JSON.stringify(setupBands(Number(groupCount.value)));
      const selectedCut = placementThrough.dataset.bands !== bands && placementThrough.value !== '0' ? '' : placementThrough.value;
      placementThrough.dataset.bands = bands;
      placementThrough.innerHTML = placementOptions(selectedCut, Number(groupCount.value));
    }
    const values = key => host.querySelector('[data-preview-value="' + key + '"]');
    const setValue = (key, value) => { values(key).textContent = value; };
    const refereeCount = form.elements.namedItem('referees');
    const separate = form.elements.namedItem('timingMode').value === 'separate';
    const treeTime = form.elements.namedItem('treeMinutes');
    treeTime.closest('label').hidden = !separate && treeTime.validity.valid;
    form.elements.namedItem('minutes').closest('label').firstChild.textContent = separate ?
      tr('Spielzeit Vorrunde (Min.)', 'Group stage playing time (min)') :
      tr('Spielzeit je Spielrunde (Min.)', 'Playing time per slot (min)');
    form.elements.namedItem('rest').setAttribute('aria-describedby', 'fc-rest-help');
    form.elements.namedItem('end').setAttribute('aria-describedby', 'fc-time-window-help');
    form.querySelector('.fc-time-window-note').id = 'fc-time-window-help';
    const selectedRefereeMode = form.elements.namedItem('refereeMode').value;
    const external = selectedRefereeMode === 'external';
    refereeCount.closest('label').hidden = !external && refereeCount.validity.valid;
    refereeCount.setAttribute('aria-describedby', 'fc-referee-help');
    form.querySelector('.fc-config-rule-help p').textContent = timingExplanation(form.elements.namedItem('tiePolicy').value);
    document.getElementById('fc-referee-help').textContent = external ?
      tr('Ein dedizierter externer Schiri je gleichzeitig genutztem Feld.', 'One dedicated external referee per court used at the same time.') :
      selectedRefereeMode === 'teams' ?
        tr('Ein anderes Team pfeift je Spiel; keine gleichzeitige Spiel-/Doppelbelegung. Externe Anzahl wird nicht verwendet und bleibt gespeichert.',
          'Another team referees each match; no simultaneous playing/double duty. External count is unused and retained.') :
        tr('Teams leiten ihre Spiele selbst. Externe Anzahl wird nicht verwendet und bleibt gespeichert.',
          'Teams officiate their own matches. External count is unused and retained.');
    const status = document.getElementById('fc-setup-preview-status');
    const overview = host.querySelector('[data-capacity-overview]');
    const detail = host.querySelector('[data-capacity-details]');
    const advice = document.getElementById('fc-setup-advice');
    const detailAdvice = document.getElementById('fc-detail-advice');
    advice.textContent = ''; advice.hidden = true;
    detailAdvice.textContent = ''; detailAdvice.hidden = true;
    const advise = function (code, text, field, actionLabel) {
      const item = document.createElement('li'); item.dataset.advice = code;
      const content = document.createElement('span'); content.textContent = text + ' ';
      item.appendChild(content);
      if (field) {
        const control = document.createElement('button'); control.type = 'button';
        control.dataset.configField = field;
        control.textContent = actionLabel;
        control.onclick = () => {
          const input = form.elements.namedItem(field);
          if (input) { revealTarget(input); input.focus(); input.scrollIntoView({ block: 'center' }); }
        };
        item.appendChild(control);
      }
      const target = ['invalid', 'team-referees-impossible', 'time-window'].indexOf(code) >= 0 ? advice : detailAdvice;
      target.appendChild(item); target.hidden = false;
    };
    let previewDraft;
    try { previewDraft = copyDraftFromForm(); }
    catch (error) {
      host.dataset.validation = 'blocked';
      status.hidden = false;
      status.textContent = tr('Vorschau nicht möglich: ', 'Preview unavailable: ') + error.message;
      return;
    }
    const count = previewDraft.teams.length;
    const prereq = document.getElementById('fc-setup-prereq');
    if (prereq) prereq.hidden = true;
    setValue('teams', String(count));
    ['groups', 'group-games', 'courts', 'group-end'].forEach(key => setValue(key, '–'));
    setValue('minimum-games', '–');
    setValue('event-end', '–');
    host.querySelector('.fc-preview-source').textContent = tr('Geschätzt · inklusive Endrunde', 'Estimated · including finals');
    overview.textContent = '';
    detail.textContent = '';
    host.querySelector('.fc-capacity-details').hidden = true;
    status.hidden = false;
    status.className = 'fc-setup-preview-status';

    updateTimeWindowValidity(form);
    const invalid = Array.from(form.querySelectorAll('input, select')).find(input => !input.validity.valid);
    if (invalid) {
      host.dataset.validation = 'blocked';
      const labelText = invalid.closest('label') && invalid.closest('label').textContent.trim();
      status.textContent = tr('Vorschau pausiert: Eingabe prüfen', 'Preview paused: check the input') +
        (labelText ? ' · ' + labelText : '') +
        (invalid.validationMessage ? ': ' + invalid.validationMessage : '');
      status.classList.add('is-warning');
      advise('invalid', tr('Planung blockiert: ungültige Eingabe korrigieren.', 'Planning blocked: correct the invalid input.'),
        invalid.name, tr('Eingabe prüfen', 'Review input'));
      return;
    }
    if (count < F.teamLimits(event).min || count > teamLimit(event)) {
      host.dataset.validation = 'blocked';
      status.textContent = (count > teamLimit(event) ?
        tr('Technische Grenze überschritten: höchstens ', 'Technical limit exceeded: at most ') + teamLimit(event) :
        tr('Für eine Zeit- und Spielplanvorschau sind mindestens ', 'A schedule and timing preview needs at least ') + F.teamLimits(event).min) +
        tr(' Teams erforderlich. Aktuell: ', ' teams required. Currently: ') + count + tr(' unter „Firmen & Teams“.', ' under “Companies & teams”.');
      status.classList.add('is-warning');
      if (prereq) prereq.hidden = false;
      return;
    }
    const empty = previewDraft.organizations.find(o => !previewDraft.teams.some(t => t.orgId === o.id));
    if (empty) {
      host.dataset.validation = 'blocked';
      status.textContent = tr('Vorschau nicht möglich: Team zuordnen oder Firma entfernen – ', 'Preview unavailable: assign a team or remove the company – ') + empty.name;
      status.classList.add('is-warning');
      if (prereq) prereq.hidden = false;
      return;
    }
    try {
      const draft = previewDraft;
      const savedPlan = event.status !== 'draft' &&
        Object.keys(draft.config).length === Object.keys(event.config).length &&
        Object.keys(draft.config).every(key => draft.config[key] === event.config[key]) &&
        JSON.stringify([draft.teams, draft.organizations]) === JSON.stringify([event.teams, event.organizations]);
      const refereeMode = F.refereeMode(draft);
      const teamCapacity = Math.floor(count / (refereeMode === 'teams' ? 3 : 2));
      const resourceCapacity = Math.min(F.courtCapacity(draft), teamCapacity);
      if (refereeMode === 'teams' && count <= 4) {
        host.dataset.validation = 'blocked';
        status.textContent =
          tr('Planung blockiert: Bei 2–4 Teams bleibt für den Baum kein vorab sicher spielfreies Schiri-Team.',
            'Planning blocked: with 2–4 teams, no referee team can be safely preassigned outside all possible bracket participants.');
        status.classList.add('is-warning');
        advise('team-referees-impossible', tr('Bewusst „ohne Schiris“ oder „extern“ mit mindestens einem dedizierten Schiri wählen.',
          'Explicitly choose “no referees” or “external” with at least one dedicated referee.'), 'refereeMode',
        tr('Schiri-Modus wählen', 'Choose referee mode'));
        return;
      }
      draft.status = 'draft';
      draft.matches = []; draft.pools = []; draft.drawOrder = [];
      draft.results = {}; draft.outcomes = {}; draft.startedAt = null;
      delete draft.liveWave;
      draft.fieldLimit = F.courtCapacity(draft);
      draft.organizations.forEach(org => {
        if (!draft.teams.some(team => team.id === org.nominee && team.orgId === org.id)) {
          org.nominee = draft.teams.find(team => team.orgId === org.id).id;
        }
      });
      const signature = JSON.stringify([draft.formatVersion, draft.config, draft.teams, draft.organizations, savedPlan ? event.revision : null]);
      if (!previewCache || previewCache.signature !== signature) {
        const plan = savedPlan ? event : F.build(draft);
        previewCache = { signature: signature, plan: plan, estimate: F.estimate(plan) };
      }
      const plan = previewCache.plan, estimate = previewCache.estimate;
      updatePreviewBadges(host, plan, estimate, savedPlan);
      const over = estimate.projectedMinutes - plan.config.window;
      host.dataset.validation = 'ready';
      if (resourceCapacity < draft.config.fields) advise('court-capacity',
        tr('Mit ' + count + ' Teams und diesem Schiri-Modus sind höchstens ' + resourceCapacity + ' der ' + draft.config.fields +
          ' Felder gleichzeitig nutzbar; Paarungen und Pausen können die Belegung weiter senken. Feldzahl auf ' + resourceCapacity + ' begrenzen, wenn du nur nutzbare Felder vorhalten möchtest.',
        'With ' + count + ' teams and this referee mode, at most ' + resourceCapacity + ' of ' + draft.config.fields +
          ' courts can be used at once; pairings and rest may reduce usage further. Limit courts to ' + resourceCapacity + ' if you only want to provide usable courts.'),
        'fields', tr('Feldzahl prüfen', 'Review courts'));
      if (refereeMode === 'external' && draft.config.referees < Math.min(draft.config.fields, Math.floor(count / 2))) advise('external-referees',
        tr('Externe Schiris begrenzen die Belegung auf ' + draft.config.referees + '. Für mehr parallele Spiele zusätzliche dedizierte Schiris bereitstellen oder weniger Felder einplanen.',
          'External referees limit usage to ' + draft.config.referees + '. For more simultaneous matches provide additional dedicated referees or plan fewer courts.'),
        'referees', tr('Schiri-Anzahl prüfen', 'Review referee count'));
      if (estimate.courts < resourceCapacity) advise('schedule-capacity',
        tr('Der konkrete Plan nutzt höchstens ' + estimate.courts + ' Felder trotz Ressourcen für ' + resourceCapacity + '; Gruppenpaarungen und ' + draft.config.rest +
          ' freie Spielrunde(n) begrenzen die Belegung. Pausen nur bewusst anpassen; weniger Pause ist keine garantierte Optimierung.',
          'The actual schedule uses at most ' + estimate.courts + ' courts despite resources for ' + resourceCapacity + '; pool pairings and ' + draft.config.rest +
          ' rest slot(s) limit usage. Adjust rest deliberately; less rest is not a guaranteed optimization.'),
        'rest', tr('Spielruhe prüfen', 'Review rest'));
      if (over > 0) advise('time-window',
        tr('Etwa ' + over + ' Min. über der verfügbaren Zeit. Endzeit oder Spielzeit anpassen.',
          'About ' + over + ' min beyond available time. Adjust the end time or match length.'),
        'end', tr('Endzeit prüfen', 'Review end time'));
      if (advice.children.length || detailAdvice.children.length) host.dataset.validation = 'warning';
      status.textContent = '';
      status.hidden = true;
      status.classList.add(over > 0 ? 'is-warning' : 'is-ok');
      overview.innerHTML = capacityOverview(plan, estimate, !savedPlan);
      detail.innerHTML = capacityDetails(plan, estimate);
      host.querySelector('.fc-capacity-details').hidden = false;
    } catch (error) {
      host.dataset.validation = 'blocked';
      status.hidden = false;
      status.textContent = tr('Vorschau nicht möglich: ', 'Preview unavailable: ') + error.message;
      status.classList.add('is-warning');
    }
  }
  function config(form) {
    const data = new FormData(form), c = {};
    ['minutes', 'treeMinutes', 'change', 'fields', 'referees', 'rest', 'groupCount', 'placementThrough'].forEach(k => { c[k] = Number(data.get(k)); });
    c.timingMode = String(data.get('timingMode'));
    c.placementMode = c.placementThrough === 0 ? 'all' : 'shared';
    c.start = String(data.get('start') || '');
    const duration = timeWindow(c.start, String(data.get('end') || ''));
    c.window = duration == null ? 0 : duration;
    c.refereeMode = data.get('refereeMode') || F.refereeMode(event);
    c.rankingMode = data.get('rankingMode') || F.rankingMode(event);
    c.tiePolicy = data.get('tiePolicy') || F.tiePolicy(event);
    return { title: String(data.get('title')).trim(), config: c };
  }
  async function save(next, text) {
    if (readOnly) throw new Error('Read-only / Nur Lesen');
    const submitted = editorFields();
    saving = true;
    try { event = await Store.save(next); }
    finally { saving = false; }
    binding = await Server.load(event.id);
    let synchronized = true;
    if (binding) {
      try {
        binding = await Server.sync(event);
        notify(tr('Lokal gespeichert und mit dem Server synchronisiert.', 'Saved locally and synchronized with the server.'), false, true);
      } catch (error) {
        synchronized = false;
        console.error('Firmencup server sync:', error);
        binding = await Server.load(event.id);
        notify(error.message + (error.status === 412 ? '' :
          tr(' Änderungen bleiben auf diesem Gerät erhalten und werden später erneut übertragen.', ' Changes remain on this device and will be retried later.')), true);
      }
    } else notify(text || tr('Auf diesem Gerät gespeichert.', 'Saved on this device.'), false, true);
    const current = editorFields(), focus = editorFocus(), changed = {};
    Object.keys(current).forEach(key => {
      if (current[key] !== submitted[key]) changed[key] = current[key];
    });
    next.teams.filter(team => submitted['[data-team-name="' + team.id + '"]'] === undefined).forEach(team => {
      const draftId = draftTeamId(team.orgId);
      if (submitted['[data-team-name="' + draftId + '"]'] === undefined) return;
      Object.keys(changed).forEach(key => {
        if (key.indexOf('="' + draftId + '"') < 0) return;
        changed[key.replace('="' + draftId + '"', '="' + team.id + '"')] = changed[key];
        delete changed[key];
      });
      if (focus) focus.key = focus.key.replace('="' + draftId + '"', '="' + team.id + '"');
    });
    render(false);
    restoreEditor(changed, focus);
    if (Object.keys(changed).length) notify(tr('Übermittelten Stand gespeichert. Neuere Eingaben sind noch nicht gespeichert.', 'Submitted version saved. Newer edits are not saved yet.'), true);
    return synchronized && !Object.keys(changed).length;
  }
  const pendingCompanyTeams = new Set(), generatedTeamNames = new Map();
  let printing = false;
  function addOpenedCompanyTeam() {
    if (busy || saving || !event || readOnly || event.startedAt || event.liveWave ||
        Object.keys(event.results).length || Object.keys(event.outcomes).length) return;
    const companyId = pendingCompanyTeams.values().next().value;
    if (!companyId) return;
    pendingCompanyTeams.delete(companyId);
    const card = Array.from(app.querySelectorAll('[data-team-draft]')).find(node => node.dataset.teamDraft === companyId);
    if (!card || !card.closest('.fc-company-teams').open || event.teams.some(team => team.orgId === companyId)) {
      addOpenedCompanyTeam();
      return;
    }
    action(() => runAction('add-team', companyId));
  }
  async function action(fn) {
    if (busy) return;
    busy = true; app.setAttribute('aria-busy', 'true');
    updateSaveButtons();
    try { await fn(); } catch (error) {
      console.error('Firmencup:', error);
      notify(error.code === 'unsupported-format' ?
        tr('Format nicht unterstützt. Dieser Bogen verwendet Gruppen und Klassifikationsbäume. Originaldaten und Sicherungen bleiben unverändert.',
          'Unsupported format. This sheet uses pools and classification brackets. Original data and backups remain unchanged.') : error.message, true);
    }
    finally { busy = false; app.setAttribute('aria-busy', 'false'); updateSaveButtons(); addOpenedCompanyTeam(); }
  }
  const defaults = { start: '13:00', minutes: 14, treeMinutes: 14, timingMode: 'uniform', groupCount: 0, placementMode: 'all', placementThrough: 0, change: 3, fields: 8, referees: 8, rest: 1, window: 360, refereeMode: 'teams', rankingMode: 'teams', tiePolicy: 'lead' };
  async function landing(expandMore) {
    const rows = await Store.list({ removal: true });
    const landingTitle = tr('Firmencup erstellen/konfigurieren', 'Create / configure company cup');
    document.getElementById('fc-heading').textContent = landingTitle;
    document.title = landingTitle + ' · CompetitionPilot';
    function deleteButton(row, index) {
      return row.removal ? '<button type="button" data-delete-local="' + index +
        '" class="fc-local-delete" title="' + esc(tr('Lokal löschen', 'Delete locally')) +
        '" aria-label="' + esc(tr('Lokal löschen: ', 'Delete locally: ') + (row.title || row.id)) + '">' +
        '<svg aria-hidden="true" focusable="false" viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2m3 0-1 14H6L5 6m4 4v6m6-6v6"/></svg></button>' : '';
    }
    function backupButton(row, index) {
      const name = row.title || row.id;
      return '<button type="button" data-backup-local="' + index + '" class="fc-local-backup" title="' +
        esc(tr('Sichern (JSON mit Spieler:innen-Namen – privat aufbewahren): ', 'Back up (JSON with player names – keep private): ') + name) +
        '" aria-label="' + esc(tr('Sichern: ', 'Back up: ') + name) + '">' +
        '<svg aria-hidden="true" focusable="false" viewBox="0 0 24 24"><path d="M12 4v11m-5-5 5 5 5-5M5 19h14"/></svg></button>';
    }
    function localEntry(row, index) {
      return row.error ? '<div class="fc-local-entry fc-local-entry-error"><p>' + esc(row.id) + ': ' +
        esc(row.status === 'unsupported' ? tr('Format nicht unterstützt · Originaldaten unverändert', 'Unsupported format · original data unchanged') : row.error) + '</p>' +
        '<div class="fc-local-actions">' +
        (row.status !== 'unsupported' && row.removal ? '<button type="button" data-recover="' + esc(row.id) + '">' + tr('Vorherigen Stand als Kopie retten', 'Recover previous snapshot as copy') + '</button>' : '') +
        deleteButton(row, index) + '</div></div>' :
        '<div class="fc-local-entry"><div class="fc-local-info"><a href="?local=' + encodeURIComponent(row.id) + '&lang=' + (en ? 'en' : 'de') + '">' + esc(row.title) + '</a>' +
        '<span class="fc-local-status">' + esc(statusLabel(row.status)) + '</span>' +
        (row.savedAt ? '<time class="fc-local-date" datetime="' + esc(row.savedAt) + '">' +
          tr('Gespeichert: ', 'Saved: ') + esc(new Date(row.savedAt).toLocaleString(en ? 'en-GB' : 'de-DE',
            { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })) + '</time>' :
          '<span class="fc-local-date">' + tr('Speicherdatum unbekannt (älterer Eintrag)', 'Save date unknown (older entry)') + '</span>') + '</div>' +
        '<div class="fc-local-actions">' + backupButton(row, index) + deleteButton(row, index) + '</div></div>';
    }
    const visibleRows = rows.slice(0, 3).map(localEntry).join('');
    const hiddenRows = rows.slice(3).map((row, index) => localEntry(row, index + 3)).join('');
    app.innerHTML = '<section><h2>' + tr('Neu', 'New') + '</h2><form id="fc-create">' +
      label('title', tr('Titel', 'Title'), tr('Mein Firmencup', 'My company cup')) +
      '<button type="submit">' + tr('Turnierplanung starten', 'Start tournament planning') + '</button></form></section>' +
      '<section><h2>' + tr('Gespeicherte Turniere (nur auf diesem Gerät)', 'Saved tournaments (on this device only)') + '</h2>' +
      '<p class="fc-note">' + tr('Löschen kann nicht rückgängig gemacht werden. Sicherungen enthalten Spieler:innen-Namen – privat aufbewahren.', 'Deletion cannot be undone. Backups include player names – keep them private.') + '</p>' +
      (!rows.length ? '<p class="fc-empty">' + tr('Noch kein Firmencup auf diesem Gerät. Beginne oben mit dem Titel.', 'No company cup on this device yet. Start with the title above.') + '</p>' : '') +
      visibleRows +
      (hiddenRows ? '<details class="fc-local-more"' + (expandMore ? ' open' : '') + '><summary>' + tr('Weitere Turniere anzeigen (' + (rows.length - 3) + ')', 'Show more tournaments (' + (rows.length - 3) + ')') +
        '</summary>' + hiddenRows + '</details>' : '') + '</section>' +
      '<section><h2>' + tr('Firmencup-Sicherung wiederherstellen', 'Restore Firmencup backup') + '</h2><label>' + tr('JSON-Datei (eigener lokaler Datensatz)', 'JSON file (own local record)') +
      '<input id="fc-restore" type="file" accept=".json,application/json"></label></section>';
    updateStatusAction();
    document.getElementById('fc-create').onsubmit = function (ev) {
      ev.preventDefault();
      action(async function () {
        const form = ev.target, data = new FormData(form), teams = [], orgs = [];
        for (let i = 1; i <= 3; i++) {
          orgs.push({ id: 'o' + i, name: entityDefaultName(i), nominee: null });
        }
        event = await Store.save(F.create(uid(), String(data.get('title')).trim(), defaults, teams, orgs));
        setupStep = 1; phase = 'teams';
        history.replaceState(null, '', '?local=' + event.id + '&lang=' + (en ? 'en' : 'de'));
        render(); notify(tr('Firmen anlegen.', 'Set up companies.'));
      });
    };
    document.getElementById('fc-restore').onchange = ev => action(() => restoreFile(ev.target.files[0]));
    app.querySelectorAll('[data-delete-local]').forEach(node => {
      node.onclick = () => action(async function () {
        const row = rows[Number(node.dataset.deleteLocal)];
        const expandMore = !!app.querySelector('.fc-local-more[open]');
        const warning = row.removal[2] !== null ?
          tr('Nur auf diesem Gerät löschen; der veröffentlichte Serverstand bleibt. Lokale Bearbeitungsberechtigung und noch nicht übertragene Änderungen werden entfernt.', 'Delete only on this device; the published server event remains. Local editor credentials and unsynchronized changes will be removed.') :
          tr('Nur auf diesem Gerät löschen.', 'Delete only on this device.');
        if (!confirm(tr('„', '“') + (row.title || row.id) + tr('“ löschen? ', '” — delete? ') + warning + ' ' +
            tr('Auch der vorherige lokale Stand wird gelöscht. Nicht rückgängig zu machen.', 'The previous local snapshot will also be deleted. This cannot be undone.'))) return;
        try { await Store.remove(row.id, row.removal); }
        catch (error) { await landing(expandMore); throw error; }
        await landing(expandMore);
        notify(tr('Lokal gelöscht: ', 'Deleted locally: ') + (row.title || row.id));
        const next = app.querySelector('[data-delete-local]') || document.querySelector('#fc-create input');
        if (next) next.focus();
      });
    });
    app.querySelectorAll('[data-backup-local]').forEach(node => {
      node.onclick = () => action(async function () {
        const row = rows[Number(node.dataset.backupLocal)];
        let saved = null;
        try { saved = await Store.load(row.id); } catch (error) { saved = null; }
        if (!saved || saved.id !== row.id) {
          const expandMore = !!app.querySelector('.fc-local-more[open]');
          await landing(expandMore);
          throw new Error(tr('Sicherung nicht möglich: „' + (row.title || row.id) + '“ ist nicht mehr lesbar oder wurde entfernt. Liste aktualisiert.',
            'Backup not possible: “' + (row.title || row.id) + '” can no longer be read or was removed. List refreshed.'));
        }
        download({ kind: 'firmencup-backup', version: 1, event: saved }, saved.id + '.json');
        notify(tr('Sicherung heruntergeladen: ', 'Backup downloaded: ') + saved.title);
      });
    });
    app.querySelectorAll('[data-recover]').forEach(node => {
      node.onclick = () => action(async function () {
        if (confirm(tr('Vorherigen Stand als neue Veranstaltung kopieren? Beschädigtes Original bleibt erhalten.', 'Copy previous snapshot as a new event? Corrupt original is preserved.'))) {
          await restore(await Store.previous(node.dataset.recover));
        }
      });
    });
  }
  function organizationOrdering(id, index, length, name) {
    return '<div class="fc-order">' + [-1, 1].map(direction =>
      '<button type="button" data-order="organizations" data-id="' + esc(id) + '" data-direction="' + direction +
      '" aria-label="' + esc(name + ' · ' + (direction < 0 ? tr('Nach oben', 'Move up') : tr('Nach unten', 'Move down'))) + '"' +
      ' title="' + esc(name + ' · ' + (direction < 0 ? tr('Nach oben', 'Move up') : tr('Nach unten', 'Move down'))) + '"' +
      ((direction < 0 ? index === 0 : index === length - 1) ? ' disabled' : '') + '>' +
      '<span aria-hidden="true">' + (direction < 0 ? '↑' : '↓') + '</span></button>').join('') + '</div>';
  }
  function trophyChoice(o) {
    if (F.rankingMode(event) === 'teams') return '';
    if (F.rankingMode(event) === 'mean') return '<p class="fc-note">' +
      tr('Alle Teams zählen mit gleichem Gewicht für den mittleren Firmen-Endrang.', 'All teams carry equal weight in the company’s mean final rank.') + '</p>';
    const teams = event.teams.filter(t => t.orgId === o.id);
    const helpId = 'fc-trophy-help-' + o.id;
    const explanation = '<p id="' + esc(helpId) + '" class="fc-note">' +
      tr('Nach der vorläufigen Wertungslogik bestimmt dieses Team den Rang der Firma; die Ergebnisse werden nicht addiert.',
        'Under the provisional ranking rule, this team determines the company’s rank; results are not added.') + '</p>';
    if (!teams.length) return '';
    if (teams.length === 1) return '<div class="fc-trophy-choice" data-trophy-team="' + esc(o.id) + '"><p>' +
      tr('Für den Firmenpokal zählt automatisch: ', 'Automatically counts for the company trophy: ') +
      '<strong>' + esc(teams[0].name) + '</strong></p>' + explanation + '</div>';
    return '<div class="fc-trophy-choice"><label>' +
      tr('Team für die Firmenwertung', 'Team for the organization ranking') +
      '<select data-nominee="' + esc(o.id) + '" aria-describedby="' + esc(helpId) + '">' +
      (o.nominee === null ? '<option value="">' + tr('Bitte ein Team wählen', 'Please choose a team') + '</option>' : '') +
      options(teams, o.nominee) + '</select></label>' + explanation + '</div>';
  }
  function draftTeamId(orgId) { return 'draft-team-' + orgId; }
  function nextTeamName(used) {
    let number = event.teams.length + 1;
    while (used.indexOf('Team ' + number) >= 0) number++;
    return 'Team ' + number;
  }
  function teamEditor(t, index, draft) {
    const companyTeams = event.teams.filter(team => team.orgId === t.orgId);
    const roster = '<details class="fc-roster-details" data-roster-team="' + esc(t.id) + '"><summary>' +
      tr('Namen ergänzen', 'Add names') + '</summary><div class="fc-roster">' +
      Array.from({ length: Math.max(2, t.roster.length) }, (_, member) => '<label>' + tr('Spieler:in ', 'Player ') + (member + 1) +
        '<input data-member="' + esc(t.id) + '" data-index="' + member + '" maxlength="100" value="' + esc(t.roster[member] || '') + '"></label>').join('') +
      '<p class="fc-note">' + tr('Optional · nicht öffentlich angezeigt', 'Optional · not shown publicly') + '</p>' +
      '<button type="button" data-add-member="' + esc(t.id) + '">' + tr('+ Spieler:in', '+ Player') + '</button></div></details>';
    const pool = event.pools.findIndex(p => p.indexOf(t.id) >= 0);
    const groupEditable = pool >= 0 && !F.groupEditLock(event);
    const actions = '<div class="fc-company-actions fc-team-actions">' +
      (draft ? '<button type="button" data-cancel-first-team>' + tr('Abbrechen', 'Cancel') + '</button>' :
        (groupEditable ? '' : editorPoolLink(t.id)) +
        '<button type="button" class="fc-delete-company" data-action="remove-team" data-team="' + esc(t.id) + '" aria-label="' + esc(tr('Team entfernen: ', 'Remove team: ') + t.name) + '" title="' + esc(tr('Team entfernen: ', 'Remove team: ') + t.name) + '"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/></svg></button>') + '</div>';
    // Compact row: the visually hidden legend still names the fieldset; the visible team name is the input.
    return '<fieldset class="fc-team-card' + (event.matches.length ? ' fc-team-has-attendance' : '') + '"' +
      (draft ? ' data-team-draft="' + esc(t.orgId) + '"' : '') + ' id="fc-team-card-' + esc(t.id) + '"><legend class="fc-sr-only">' +
      esc(draft ? tr('Erstes Team', 'First team') : t.name) +
      '</legend><div class="fc-row fc-team-fields-' + (draft ? 2 : groupEditable ? 4 : 3) + '"><label class="fc-team-name">' + tr('Teamname', 'Team name') +
      '<input data-team-name="' + esc(t.id) + '" value="' + esc(t.name) + '" maxlength="100"' + (draft ? '' : ' required') + '></label>' +
      '<label class="fc-team-org">' + tr('Firma', 'Company') + '<select data-team-org="' + esc(t.id) + '">' + options(event.organizations, t.orgId) + '</select></label>' +
      (groupEditable ? '<label class="fc-team-group">' + tr('Gruppe', 'Pool') + groupSelection(t.id, pool, 'editor') + '</label>' : '') +
      (draft ? '' : '<label class="fc-team-position">' + tr('Position', 'Position') +
        '<select data-team-position="' + esc(t.id) + '" aria-label="' + esc(tr('Position in der Firma: ', 'Position within company: ') + teamIdentity(t.id)) + '">' +
        companyTeams.map((team, position) => '<option value="' + position + '"' + (team.id === t.id ? ' selected' : '') + '>' +
          (position + 1) + '</option>').join('') + '</select></label>') +
      actions + '<div class="fc-team-tools">' + roster + (draft ? '' : teamAttendance(t.id)) + '</div></div></fieldset>';
  }
  function editor() {
    if (event.startedAt) return '<section id="fc-registration"><h2>' +
      tr('Firmen & Teams', 'Companies & teams') + '</h2>' + checkin() + '<p class="fc-note">' +
      tr('Spielplan und Ergebnisse bleiben beim Firmenwechsel erhalten. Namen und Regeln sind seit Spielbeginn gesperrt.',
        'Changing a company preserves fixtures and results. Names and rules are locked after play starts.') + '</p>' +
      event.organizations.map(o => '<fieldset class="fc-entity-card"><legend>' + esc(o.name) + '</legend><details class="fc-company-teams"><summary>' +
        tr('Teams', 'Teams') + ' (' + event.teams.filter(t => t.orgId === o.id).length + ')</summary>' +
        event.teams.filter(t => t.orgId === o.id).map(t => '<div class="fc-team-card" id="fc-team-card-' + esc(t.id) + '"><div class="fc-team-topline"><div class="fc-team-heading"><h3>' + esc(t.name) + '</h3>' + editorPoolLink(t.id) + '</div>' +
          teamAttendance(t.id) + '</div>' +
          (t.roster.length ? '<details class="fc-roster-details"><summary>' + tr('Spieler:innen (privat)', 'Players (private)') +
            '</summary><p class="fc-note">' + t.roster.map(esc).join(', ') + '</p></details>' : '') +
          transferControls(t) + '</div>').join('') + '</details></fieldset>').join('') + '</section>' +
      '<section id="fc-locked-planning" aria-labelledby="fc-setup-preview-title">' + setupPreview(true) + '</section>';
    return '<section id="fc-editor" class="noprint">' + checkin() +
      '<p class="fc-note">' + tr('Bis zum Spielbeginn kannst du alle Angaben ändern.', 'You can edit all details until play starts.') + '</p>' +
      (!event.matches.length ? '<p class="fc-note">' + tr('Die Gruppenzuordnung steht erst nach dem Erstellen des Spielplans fest.', 'Pools are not assigned until the schedule is built.') + '</p>' : '') +
      '<form id="fc-teams-edit" novalidate><fieldset data-panel="1"><legend>' + tr('Firma/Organisation/Gruppe anlegen', 'Create Company/Organization/Group') + '</legend>' +
      '<p class="fc-guide">' + tr('1. Firmen und Teams zuerst: Ihre Anzahl und Zuordnung bestimmen Gruppen, Spiele und die anschließende Zeit-/Feldvorschau. Öffne „Teams“ bei einer Firma. ', '1. Companies and teams first: their count and assignments determine pools, matches and the timing/court preview that follows. Open “Teams” inside a company. ') + rosterGuidance() + '</p>' +
      (!event.organizations.length ? '<p class="fc-empty">' + tr('Noch keine Firma angelegt. Füge zuerst eine Firma hinzu.', 'No companies yet. Add a company first.') + '</p>' : '') +
      event.organizations.map((o, index) => '<fieldset class="fc-entity-card" data-company="' + esc(o.id) + '"><legend>' + esc(o.name) + '</legend><div class="fc-row"><label>' + tr('Name', 'Name') +
        '<input data-org-name="' + esc(o.id) + '" value="' + esc(o.name) + '" maxlength="100" required></label>' +
        trophyChoice(o) +
        '<div class="fc-company-actions">' + organizationOrdering(o.id, index, event.organizations.length, o.name) +
        '<button type="button" class="fc-delete-company" data-remove-org="' + esc(o.id) + '" aria-label="' + esc(tr('Firma entfernen: ', 'Remove company: ') + o.name) + '" title="' + esc(tr('Firma entfernen: ', 'Remove company: ') + o.name) + '"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/></svg></button></div></div></fieldset>').join('') +
      '<p class="fc-note" id="fc-company-progress">' + event.organizations.length +
        tr(' Firmen angelegt.', ' companies added.') + '</p>' +
      label('org-count', tr('Wie viele Firmen hinzufügen?', 'How many companies to add?'), 1, 'number', 1, Math.max(1, F.MAX_ORGANIZATIONS - event.organizations.length)) +
      '<button type="button" data-action="add-org"' + (event.organizations.length >= F.MAX_ORGANIZATIONS ? ' disabled' : '') + '>' + tr('+ Firma hinzufügen', '+ Add company') + '</button>' +
      '<p class="fc-note">' + tr('Eingaben werden nicht automatisch gespeichert.', 'Changes are not saved automatically.') + '</p>' +
      '<div class="fc-step-actions">' + button('save-setup', tr('Speichern', 'Save')) +
      '<button type="button" data-next="3" aria-label="' + esc(tr('Weiter zur Konfiguration', 'Continue to configuration')) + '">' +
      tr('Weiter', 'Continue') + '</button></div></fieldset>' +
      '<fieldset data-panel="2"><legend>2. ' + tr('Teams & Spieler:innen anlegen', 'Create teams & players') + '</legend>' +
      '<p class="fc-guide">' + tr('Füge Teams zu den Firmen hinzu. Teamnamen genügen für die Planung; Spieler:innen-Namen sind optional.', 'Add teams to companies. Team names are enough for planning; player names are optional.') + '</p>' +
      '<label>' + tr('Firma für neues Team', 'Company for new team') +
        '<select id="fc-new-team-org">' + options(event.organizations, event.organizations[0] && event.organizations[0].id) + '</select></label>' +
        '<p class="fc-note" id="fc-team-progress">' + event.teams.length + tr(' Teams angelegt · für den Spielplan mindestens ', ' teams added · schedule needs at least ') + F.teamLimits(event).min + ' ' + tr('Teams.', 'teams.') + '</p>' +
        (!event.teams.length ? '<p class="fc-empty">' + tr('Noch keine Teams. Wähle oben eine Firma und klicke auf „+ Team“.', 'No teams yet. Choose a company above, then select “+ Team”.') + '</p>' : '') +
        event.teams.map((t, index) => teamEditor(t, index, false)).join('') +
      '<button type="button" data-action="add-team"' + (!event.organizations.length || event.teams.length >= teamLimit(event) ? ' disabled' : '') + '>+ Team</button>' +
      (event.teams.length ? button('remove-team', tr('Letztes Team entfernen', 'Remove last team')) : '') +
      (F.rankingMode(event) === 'nominee' && event.organizations.some(o => event.teams.filter(t => t.orgId === o.id).length > 1 && o.nominee === null) ?
        '<p class="fc-note">' + tr('Noch offen: Wähle unter „Firmen“ je Firma ein Team für die vorläufige Firmenwertung.', 'Still to do: under “Companies”, choose a team for each company’s provisional ranking.') + '</p>' : '') +
      '<div class="fc-step-actions"><button type="button" data-step="1">' + tr('Zurück zu Firmen', 'Back to companies') + '</button>' +
      button('save-setup', tr('Speichern', 'Save')) +
      '<button type="button" data-next="3" aria-describedby="fc-team-progress" aria-label="' + esc(tr('Weiter zur Konfiguration', 'Continue to configuration')) + '">' +
      tr('Weiter', 'Continue') + '</button></div></fieldset></form></section>' +
      '<section id="fc-setup" class="' + (event.matches.length ? 'fc-setup-print-summary' : 'noprint') + '"><form id="fc-edit" novalidate>' +
      '<fieldset data-panel="3"><legend class="fc-sr-only">' + tr('Konfiguration', 'Configuration') + '</legend>' +
      setupPreview() +
      settings(event.config) +
      '<p class="fc-note">' + tr('Kein Autospeichern. „Weiter“ speichert und öffnet den Ablauf – noch kein Spielstart.',
        'No autosave. “Continue” saves and opens play – no matches start yet.') + '</p>' +
      '<div class="fc-step-actions fc-config-footer"><button type="button" data-step="1">' + tr('Zurück', 'Back') + '</button>' +
      button('save-setup', tr('Speichern', 'Save')) +
      button('build', event.matches.length ? tr('Weiter zum Turnierablauf', 'Continue to tournament play') :
        tr('Spielplan erstellen & weiter', 'Create schedule & continue')) + '</div>' +
      '</fieldset></form></section>';
  }
  function editorPoolLink(id) {
    const pool = teamPool(id);
    return pool ? ' <a class="fc-team-pool-link" href="#fc-pool-' + esc(pool) + '" data-focus-target="fc-pool-' + esc(pool) + '">' +
      teamBadge(id, event.status === 'finals', false) + '</a>' : '';
  }
  function transferControls(team) {
    return '<details class="fc-transfer"><summary>' + tr('Firma wechseln', 'Change company') +
      '</summary><form data-transfer-team="' + esc(team.id) + '"><label>' + tr('Neue Firma', 'New company') +
      '<select name="target"><option value="">' + tr('Bitte wählen', 'Please choose') + '</option>' +
      options(event.organizations.filter(o => o.id !== team.orgId), '') + '</select></label>' +
      '<div data-transfer-choices></div><button type="submit">' + tr('Wechsel prüfen', 'Review transfer') + '</button></form></details>';
  }
  function rules() {
    return '<details id="fc-rules"><summary>' + tr('Regeln der Turnierleitung & Grenzen', 'Organizer rules & limits') + '</summary><p>' +
      tr('Freizeitformat mit eigenen Regeln der Turnierleitung, kein offizielles BeachL-/FIVB-Regelwerk. ', 'Recreational format with organizer-defined rules, not official BeachL/FIVB rules. ') +
      rosterGuidance() + '</p><p>' +
      tr('Gemeinsamer Start und reguläres Zeitende je Spielrunde (gleichzeitige Spiele), ', 'Shared start and regular time limit per slot (simultaneous matches), ') + playingTimeSummary() + ' + ' + event.config.change +
      tr(' Minuten Wechselintervall. ', ' changeover minutes. ') + timingExplanation() + ' ' + scoringExplanation() + '</p><p>' +
        tr('Gruppenphase + Klassifikationsbäume: automatische Gruppen zielen auf Vierergruppen; manuell sind 1 bis halb so viele Gruppen wie Teams wählbar. Gruppen werden möglichst gleich groß verteilt, jede hat mindestens zwei Teams und spielt Jeder-gegen-jeden; Gruppengrößen sind nicht künstlich begrenzt. Sieger- und Verliererwege spielen standardmäßig alle Plätze aus; vollständige hintere Setzblöcke können je Block denselben Rang teilen. Der Titelblock umfasst alle Gruppensieger und mindestens vier Setzplätze (bei zwei/drei Teams höchstens die Teamzahl; Ausnahme fünf Teams: zwei Titelplätze); die übrigen vollständigen Blöcke erhalten eigene Klassifikationsbäume. Bei sieben Teams und automatischer Einteilung: Gruppen 4+3, Titelblock 4 und Block 5–7. Bei 40 Teams automatisch: zehn Vierergruppen, Titelblock 16, dann 17–32 und 33–40. Zwei Teams spielen nach der Gruppenbegegnung ein Finale; bei drei Teams spielt Setzplatz 1 dank Freilos im Finale, der Halbfinalverlierer erhält Platz 3. Freilose sind keine gespielten Matches. Wiederholte Paarungen sind möglich, insbesondere bei wenigen manuell gewählten Gruppen. Für 2–4 Teams ohne vorab sicher verfügbare Team-Schiris ausdrücklich externe oder keine Schiris wählen. Setzung nach Gruppenplatz, Siegen, Balldifferenz, erzielten Ballpunkten und nur bei Restgleichstand protokolliertem Los; ungleiche Gruppen können unterschiedliche Siegchancen bieten. Eigene Hausregel, keine Verbandsfreigabe.',
          'Group stage + classification brackets: automatic grouping aims for pools of four; manually choose 1 through half the number of teams. Pools are balanced, contain at least two teams, and play round robin; pool size has no artificial cap. Winner and loser paths play all places by default; complete lower seed bands can each share a rank. The title band includes every pool winner and at least four seeds (capped at the team count for two/three teams; five-team exception: two title places); remaining complete bands receive separate classification brackets. Seven teams, automatic: pools of 4+3, title band of 4 and band 5–7. Forty teams, automatic: ten pools of four, title band 16, then 17–32 and 33–40. Two teams play a final after their group match; with three teams, seed 1 receives a bye into the final and the semifinal loser finishes third. Byes are not played matches. Rematches are possible, especially with few manually selected pools. For 2–4 teams without safely available preassigned team referees, explicitly choose external or no referees. Seeding uses pool place, wins, ball difference, scored ball points and a recorded draw only for remaining ties; unequal pools can offer unequal winning opportunities. Organizer-defined format, no federation approval.') +
      tr(' In der ersten Baumrunde werden die Gegner der unteren Setzhälfte möglichst gruppenfremd zugeordnet; Freilose und die Zugehörigkeit zum Titel-/Platzierungsblock bleiben erhalten.',
        ' In each bracket’s opening round, lower-half opponents are matched across pools where possible; byes and title/placement-band membership remain unchanged.') + '</p><p>' +
      (event.config.placementMode === 'all' ? tr('Gewählt: Alle Plätze ausspielen.', 'Selected: play all places.') :
        tr('Gewählt: Individuell bis Platz ', 'Selected: individual places through ') + event.config.placementThrough + ' · ' +
        F.classificationBands(event.teams.length, F.effectivePoolCount(event.teams.length, event.config))
          .filter(band => band.from > event.config.placementThrough)
          .map(band => placeRange(band.from, band.to) + tr(' geteilt', ' shared')).join(' / ') +
        tr('. Geteilte Blöcke spielen nicht; alle Teams darin erhalten den ersten Rang des Blocks, auch für den Firmenmittelwert. Spielzahlen sinken entsprechend.',
          '. Shared bands do not play; all their teams receive the band’s first rank, including for company means. Match counts decrease accordingly.')) + '</p><p>' +
      rankingExplanation() +
      '</p><p class="fc-note">' + decisionExplanation() + '</p></details>';
  }
  function scoringExplanation() {
    return tr('Hausregel: absolute Siege → gesamte Balldifferenz (erzielte minus erhaltene Ballpunkte) → gesamte erzielte Ballpunkte. Niederlage, zugelassenes Remis und aufgehobenes Spiel zählen nicht als Sieg. Restgleichstand = geteilter Rang; nur die Finalsetzung wird dann per protokolliertem Los aufgelöst. Keine Quotienten und kein direkter Vergleich, auch bei ungleicher Spielzahl. Unterschiedliche Gruppengrößen bieten unterschiedliche Siegchancen.',
      'House rule: total wins → total ball-point difference (scored minus conceded) → total scored ball points. A loss, permitted draw or void match is not a win. Remaining ties share rank; only final seeding then uses a recorded draw. No ratios or head-to-head comparison, even with unequal match counts. Unequal pools offer unequal win opportunities.');
  }
  function timingExplanation(tiePolicy) {
    return ((tiePolicy || F.tiePolicy(event)) === 'lead' ?
      tr('Bei Zeitende zählt der abgeschlossene Ballpunktestand; ein laufender Ballwechsel zählt nicht. Bei Gleichstand wird bis zur ersten Führung weitergespielt: ein weiterer gewonnener Ballpunkt reicht, kein Zwei-Punkte-Vorsprung. Erst den tatsächlichen ungleichen Endstand speichern; Remis und ein per Los bestimmtes Team sind kein Ersatz. Das gilt auch im K.-o. Verlängerungen können den zentralen Zeitplan verzögern: erst nach Spielende wechseln/starten, nötigenfalls verbleibende Wellen umplanen.',
        'At the time limit use completed ball points; an unfinished rally does not count. If tied, continue until the first lead: one further won ball point suffices, no two-point margin. Save only the actual unequal final score; a draw or lottery winner is no substitute. This also applies to knockouts. Overtime can delay central starts: change/start only after matches finish and replan remaining waves if needed.') :
      tr('Beim Abpfiff zählen nur abgeschlossene Ballpunkte, kein laufender Ballwechsel. Gruppenremis ist erlaubt; im Baum wird das per Los bestimmte Team ausdrücklich erfasst, ohne Verlängerung.',
        'At the whistle only completed ball points count, not an unfinished rally. Pool draws are allowed; bracket ties need an explicitly recorded lottery winner, without overtime.')) +
      ' ' + tr('Hausregel: Seitenwechsel nach jeweils 7 gespielten Ballpunkten insgesamt (Summe beider Teams: 7, 14, 21, …), manuell durch Teams/Schiris; kein automatischer Live-Zähler.',
        'House rule: switch sides every 7 total played ball points (sum of both teams: 7, 14, 21, …), managed manually by teams/referees; no automatic live counter.');
  }
  function playingTimeSummary(phase) {
    return !phase && event.config.timingMode === 'separate' ?
      tr('Vorrunde ', 'Groups ') + event.config.minutes + tr(' Min. / Baumphase ', ' min / brackets ') + event.config.treeMinutes + ' min' :
      F.matchMinutes(event, phase) + tr(' Min. Zeitspiel', ' min timed play');
  }
  function matchModeSummary(phase) {
    return playingTimeSummary(phase) + ' · ' +
      tr('Siege → Balldifferenz → erzielte Ballpunkte', 'Wins → ball difference → scored ball points');
  }
  // One compact, round-wide mode line; per-court cards show only what differs (teams, referee team).
  function roundModeSummary(phase) {
    return matchModeSummary(phase) + ' · ' +
      tr('Seitenwechsel alle 7 Ballpunkte (gesamt)', 'Switch sides every 7 ball points (total)');
  }
  function scoreEntryExplanation(matches) {
    return tr('Ballpunkte beider Teams eingeben. ', 'Enter ball points for both teams. ') +
      (F.tiePolicy(event) === 'lead' ?
        tr('Bei Gleichstand bis zur ersten Führung weiterspielen.', 'If tied, play until the first lead.') :
        matches.some(m => m.phase === 'cup') ?
          tr('Remis erlaubt; im K.-o. bei Remis das per Los bestimmte Team wählen.', 'Draws allowed; for knockout ties, choose the lottery winner.') :
          tr('Remis erlaubt.', 'Draws allowed.'));
  }
  function feedsLaterMatch(m) {
    return event.matches.some(item => [item.a, item.b].some(ref => ref && typeof ref !== 'string' && ref.match === m.id));
  }
  function decisionExplanation() {
    return tr('Hausregel Nichtantreten/Rückzug: ein ausdrücklich zugesprochener Sieg ohne Ballpunkte; aufgehoben = kein Sieg. Kein fingierter Spielstand, keine automatische Neu-Paarung/Kaskade. Jede weitere Begegnung separat entscheiden; gespielte Resultate bleiben erhalten.',
      'House rule for nonappearance/withdrawal: one explicitly declared win without ball points; void = no win. No invented score or automatic re-pairing/cascade. Decide each other fixture separately; played results remain.');
  }
  function rankingExplanation() {
    if (F.rankingMode(event) === 'teams') return tr('Primär zählt jedes Team einzeln. Kein Firmenpokal aktiviert. Die Turnierleitung verantwortet die gewählten Hausregeln.', 'Each team is ranked individually. No company trophy enabled. The organizer is responsible for the chosen house rules.');
    if (F.rankingMode(event) === 'mean') return tr('Zusätzliche Firmenwertung: Mittelwert aller Team-Endränge einer Firma, kleiner ist besser; Teamanzahl und Mittelwert werden ausgewiesen. Keine Siegessumme: mehr Teams bringen keinen automatischen Mengenvorteil. Keine Korrektur unterschiedlicher Spielstärke, Paarungen oder Teilnahmeauswahl; kleine Firmen schwanken stärker. Erst bei vollständigen Endrängen werden Firmenränge vergeben, Gleichstände bleiben geteilt. Hausregel, keine Verbandsregel. Firmenwechsel ordnen auch bereits erspielte Teamränge der neuen Firma zu.',
      'Additional company ranking: mean of all final team ranks within each company, lower is better; team count and mean are shown. Not a sum of wins: more teams give no automatic volume advantage. This does not correct unequal strength, pairings or selection; smaller companies vary more. Company ranks are awarded only once all final team ranks exist; ties stay shared. Organizer house rule, not a federation rule. Transfers attribute even previously earned team ranks to the new company.');
    return tr('Optionale Firmenwertung mit ausgewähltem Team: Nur dieses Team bestimmt den Firmenrang, keine Siegessumme. Auswahl ab dem ersten Start/Ergebnis gesperrt. Alle Teams zählen unabhängig für die Teamwertung. Vorläufige, sportfachlich nicht bestätigte Firmenregel.', 'Optional selected-team company ranking: only this team determines the company rank, not a sum of wins. Selection locks at first start/result. All teams independently compete in team standings. Provisional company rule, not sport-approved.');
  }
  function decided(m) { return !!(event.results[m.id] || (event.outcomes && event.outcomes[m.id])); }
  function resultsState() {
    const played = event.matches.filter(decided).length;
    const rows = event.status === 'finals' ? F.standings(event) : [];
    const teamsPlaced = new Set(rows.map(row => row.id));
    const slots = event.status === 'finals' ? F.placementSlots(event) : [];
    const unawardedPlaces = [];
    slots.filter(slot => slot.kind === 'match' && slot.decided).forEach(slot => {
      [slot.from, slot.to].forEach(rank => {
        if (!rows.some(row => row.rank === rank)) unawardedPlaces.push(rank);
      });
    });
    const matchesComplete = played === event.matches.length;
    const placementsComplete = event.status === 'finals' && rows.length === event.teams.length &&
      event.teams.every(team => teamsPlaced.has(team.id));
    return { played: played, total: event.matches.length, matchesComplete: matchesComplete,
      placementsComplete: placementsComplete, final: matchesComplete && placementsComplete,
      rows: rows, slots: slots, unawardedPlaces: unawardedPlaces };
  }
  function badge(done) {
    return '<span class="fc-badge ' + (done ? 'fc-badge-done' : 'fc-badge-live') + '">' +
      (done ? tr('abgeschlossen', 'complete') : tr('vorläufig', 'provisional')) + '</span>';
  }
  function placeRange(from, to) { return from === to ? String(from) : from + '–' + to; }
  function placedRank(row) {
    return row.sharedTo ? placeRange(row.rank, row.sharedTo) + tr(' geteilt', ' shared') : row.rank;
  }
  function sharedRank(rank, rows) {
    if (!rank) return '—';
    return rows.filter(row => row.rank === rank).length > 1 ?
      '<span class="fc-shared-rank" aria-label="' + tr('Rang ' + rank + ' geteilt', 'Rank ' + rank + ' shared') + '">' + rank + ' =</span>' : rank;
  }
  function printInstructions() {
    const scoring = tr('Gruppentabelle: Siege zählen; bei Gleichstand gesamte Balldifferenz (erzielte minus erhaltene Ballpunkte), danach gesamte erzielte Ballpunkte vergleichen. Restgleichstand = geteilter Rang.',
      'Pool table: count wins; if tied compare total ball-point difference (scored minus conceded), then total scored ball points. Remaining ties share a place.');
    const unequalPools = tr('Auch bei ungleicher Spielzahl absolute Summen verwenden, keine Quotienten und keinen direkten Vergleich.',
      'Even with unequal match counts use absolute totals, no ratios or head-to-head comparison.');
    const timeRule = F.tiePolicy(event) === 'lead' ?
      tr('Bei Zeitende den laufenden Ballwechsel beenden; bei Gleichstand bis zur ersten Führung weiterspielen.',
        'At the time limit, finish the current rally; if tied, continue until one team leads.') :
      tr('Gruppenremis ist erlaubt; ein K.-o.-Remis entscheidet ausschließlich die Turnierleitung per Los.',
        'Pool draws are allowed; only the organizer resolves a knockout draw by lottery.');
    const duration = event.config.timingMode === 'separate' ?
      tr('Vorrunde ', 'Groups ') + event.config.minutes + tr(' Min. · Baumphase ', ' min · brackets ') +
        event.config.treeMinutes + tr(' Min. · Wechsel ', ' min · changeover ') + event.config.change + tr(' Min.', ' min.') :
      tr('Alle Phasen ', 'All phases ') + event.config.minutes + tr(' Min. · Wechsel ', ' min · changeover ') +
        event.config.change + tr(' Min.', ' min.');
    const status = event.status === 'draft' ?
      tr('ENTWURF · Noch kein Spielplan erstellt – dieses Blatt enthält keine angesetzten Spiele.',
        'DRAFT · No schedule has been built; this sheet contains no scheduled matches.') :
      event.status === 'finals' ? tr('ENDRUNDE · Gruppenergebnisse sind eingefroren.', 'FINALS · Group results are frozen.') :
        tr('GRUPPENPHASE · Endrunde erst nach vollständigen Gruppenergebnissen und protokollierter Auslosung.',
          'GROUP STAGE · Finals follow only after all pool results and a recorded draw.');
    return '<section id="fc-paper-intro" class="fc-paper-only" aria-label="' + tr('Druckhinweise', 'Print instructions') + '">' +
      '<p class="fc-paper-status"><strong>' + status + '</strong><span>' + esc(duration) + '</span></p>' +
      '<p><strong>' + tr('Teams: ', 'Teams: ') + '</strong>' +
      tr('Je Kästchen die tatsächlichen Ballpunkte des genannten Teams eintragen – keine Tabellenpunkte. Ergebnis gemeinsam prüfen und der Turnierleitung melden.',
        'Write each named team’s actual ball points in its box—not standings points. Check the result together and report it to the organizer.') +
      ' ' + esc(timeRule) + ' ' +
      tr('Seitenwechsel bei 7, 14, 21 … gespielten Ballpunkten insgesamt.', 'Switch sides after 7, 14, 21 … total ball points.') + '</p>' +
      '<p><strong>' + tr('Gruppenwertung: ', 'Pool ranking: ') + esc(scoring) + ' ' +
      esc(unequalPools) + ' ' +
      tr('Setzung: Gruppenplatz → Siege → Balldifferenz → erzielte Ballpunkte → nur bei Restgleichstand Los der Turnierleitung. Keine Reihenfolge durch die Zeilen auf diesem Blatt erfinden.',
        'Seeding: pool place → wins → ball difference → scored ball points → organizer lottery only for a remaining tie. Do not infer an order from worksheet rows.') + '</strong></p>' +
      '<p class="fc-paper-warning"><strong>' + tr('Nichtantreten/Rückzug: ', 'Nonappearance/withdrawal: ') +
      tr('Nicht als 0:0 eintragen. Kästchen frei lassen; die Turnierleitung entscheidet ausdrücklich ohne erfundenen Spielstand.',
        'Do not enter 0:0. Leave the boxes empty; the organizer records an explicit decision without inventing a score.') + '</strong></p></section>';
  }
  function paperTallySheet() {
    if (!event.matches.length || event.status !== 'groups') return '';
    const header = '<thead><tr><th>' + tr('Team', 'Team') + '</th><th>' + tr('Spiele', 'Played') + '</th><th>' +
      tr('Siege', 'Wins') + '</th><th>' + tr('Diff.', 'Diff.') + '</th><th>' + tr('Bälle erzielt', 'Balls scored') + '</th>' +
      '<th>' + tr('Papier-Rang', 'Paper place') + '</th></tr></thead>';
    return '<section id="fc-paper-tally" class="fc-paper-only"><h2>' +
      tr('Handschriftliche Gruppentabelle', 'Handwritten pool standings') + '</h2><p>' +
      tr('Pro Team eine Zeile ausfüllen. Für Papierauswertung auch vorhandene Ergebnisse aus dem Spielplan übernehmen; der Papier-Rang folgt erst aus den Gruppenregeln oben.',
        'Use one row per team. For paper scoring, also copy any recorded fixture scores above; determine the paper place using the pool rules above.') +
      '</p><div class="fc-paper-pool-grid">' + event.pools.map((pool, index) => {
        const label = 'G' + (index + 1);
        return '<div class="fc-paper-pool"><h3>' + esc(poolLabel(label, false)) + '</h3><table class="fc-table fc-paper-table">' +
          header + '<tbody>' + pool.map(id => '<tr><td>' + esc(teamIdentity(id)) + '</td><td></td><td></td>' +
            '<td></td><td></td><td></td></tr>').join('') + '</tbody></table></div>';
      }).join('') + '</div></section>';
  }
  function paperSeedingSheet() {
    if (!event.matches.length || event.status !== 'groups') return '';
    const bands = F.classificationBands(event.teams.length, F.effectivePoolCount(event.teams.length, event.config));
    const rows = bands.map(band => {
      const shared = event.config.placementMode === 'shared' && band.from > event.config.placementThrough;
      const block = shared ?
        tr(' geteilter Rang · keine Spiele', ' shared place · no matches') :
        (band.from <= 4 && band.from === 1 ? tr('Titelbaum', 'title bracket') : tr('Platzierungsbaum', 'placement bracket'));
      return Array.from({ length: band.to - band.from + 1 }, (_, offset) => {
        const place = band.from + offset;
        const label = shared ? placeRange(band.from, band.to) + ' =' : String(place);
        return '<tr class="' + (shared ? 'fc-paper-shared' : '') + '"><td>' + label + '</td><td>' +
          placeRange(band.from, band.to) + ' · ' + block + '</td><td></td><td></td></tr>';
      }).join('');
    }).join('');
    return '<section id="fc-paper-seeding" class="fc-paper-only"><h2>' +
      tr('Setz- und Platzierungsblatt · nach der Gruppenphase', 'Seeding & placement worksheet · after pools') +
      '</h2><p>' +
      tr('Erst alle Gruppen abschließen. Dann Gruppenplätze nach den Regeln oben vergeben, Restgleichstände durch die Turnierleitung losen und die Teams in der Setzreihenfolge eintragen. Die echten Gegner und Baumspiele stehen erst nach dieser Auslosung fest.',
        'Finish every pool first. Assign pool places using the rules above, have the organizer draw any remaining ties, then enter teams in seed order. Actual opponents and bracket matches are not known until that draw.') +
      '</p><table class="fc-table fc-paper-seed-table"><thead><tr><th>' + tr('Setzplatz', 'Seed') + '</th><th>' +
      tr('Kanonischer Zielblock', 'Canonical destination band') + '</th><th>' + tr('Gruppenrang / Los', 'Pool place / draw') +
      '</th><th>' + tr('Team', 'Team') + '</th></tr></thead><tbody>' + rows +
      '</tbody></table></section>';
  }
  function resultsRules(text) {
    return '<details class="fc-results-rules"><summary>' + tr('So wird gewertet', 'How ranking works') +
      '</summary><p class="fc-note">' + text + '</p></details>';
  }
  function resultsFilterPanel() {
    if (readOnly) {
      return '<section id="fc-results-filter-card" class="fc-toolbar fc-results-filter-card noprint" aria-label="' +
        tr('Teamfilter für Spielplan und Ergebnisse', 'Team filter for fixtures and results') + '">' +
        '<label class="fc-search-label"><span>' + tr('Team suchen', 'Find team') +
        '</span><input id="fc-team-search" type="search" autocomplete="off" value="' + esc(teamSearch) +
        '" placeholder="' + tr('Team oder Firma', 'Team or company') + '" aria-controls="fc-results-team-filter"></label>' +
        '<label class="fc-group-filter"><span>' + tr('Mein Team auswählen', 'Choose my team') +
        '</span><select id="fc-results-team-filter" aria-controls="fc-team-agenda fc-pools fc-standings fc-schedule">' +
        '<option value="">' + tr('Alle Teams', 'All teams') + '</option>' +
        event.teams.map(team => '<option value="' + esc(team.id) + '"' +
          (overviewTeam === team.id ? ' selected' : '') + '>' + esc(teamIdentity(team.id)) + '</option>').join('') +
        '</select></label><button type="button" id="fc-team-reset"' + (!overviewTeam && !teamSearch ? ' hidden' : '') + '>' +
        tr('Alle Teams', 'All teams') + '</button><p id="fc-team-search-status" role="status" aria-live="polite" hidden></p>' +
        '<p id="fc-results-filter-status" role="status" aria-live="polite" aria-atomic="true">' +
        esc(resultsFilterMessage()) + '</p></section>';
    }
    return '<section id="fc-results-filter-card" class="fc-toolbar fc-results-filter-card noprint" aria-label="' +
      tr('Ergebnisse durchsuchen und filtern', 'Search and filter results') + '">' +
      '<label class="fc-search-label"><span>' + tr('Team / Firma suchen', 'Find team / company') +
      '</span><input id="fc-results-filter" type="search" autocomplete="off" value="' + esc(resultsQuery) +
      '" placeholder="' + tr('Name eingeben', 'Enter name') + '" aria-controls="fc-pools fc-standings" aria-describedby="fc-results-filter-help"></label>' +
      '<label class="fc-group-filter"><span>' + tr('Vorrundengruppe anzeigen', 'Show group-stage pool') +
      '</span><select id="fc-results-group-filter" aria-controls="fc-pools">' +
      '<option value="">' + tr('Alle Gruppen', 'All pools') + '</option>' +
      event.pools.map((pool, index) => {
        const id = 'G' + (index + 1);
        return '<option value="' + id + '"' + (resultsGroupFilter === id ? ' selected' : '') + '>' +
          esc(poolLabel(id, false)) + '</option>';
      }).join('') + '</select></label>' +
      '<button type="button" id="fc-results-filter-reset"' +
      (!resultsGroupFilter && !resultsQuery.trim() ? ' hidden' : '') + '>' +
      tr('Filter zurücksetzen', 'Reset filters') + '</button>' +
      '<p id="fc-results-filter-help" class="fc-note">' +
      tr('Die Suche hebt passende Teams in vollständigen Gruppentabellen hervor und filtert Endplatzierungen und Firmen. Der Gruppenfilter zeigt ganze Vorrundengruppen. Firmenränge bleiben immer aus allen Teams berechnet und werden durch den Gruppenfilter nicht beschnitten.',
        'Search highlights matching teams in complete pool tables and filters final places and companies. The pool filter shows whole group-stage pools. Company ranks always use all teams and are never narrowed by the pool filter.') +
      '</p><p id="fc-results-filter-status" role="status" aria-live="polite" aria-atomic="true">' +
      esc(resultsFilterMessage()) + '</p></section>';
  }
  function resultsStatus() {
    const state = resultsState();
    if (readOnly) return '<section id="fc-results-status" class="fc-results-status" tabindex="-1"><h2>' +
      (state.final ? tr('Endergebnis', 'Final results') : tr('Zwischenstand', 'Current standings')) + ' ' + badge(state.final) +
      '</h2><p>' + state.played + '/' + state.total + tr(' Spiele gewertet', ' matches recorded') + '</p></section>';
    if (!event.matches.length) return '<section id="fc-results-status" class="fc-results-status noprint" tabindex="-1"><h2>' +
      tr('Noch keine Ergebnisse', 'No results yet') + '</h2><p class="fc-empty">' + (readOnly ?
        tr('Die Turnierleitung hat noch keinen Spielplan veröffentlicht.', 'The organizer has not published a schedule yet.') :
        tr('Erstelle zuerst einen Spielplan unter „Konfiguration“.', 'First create a schedule under “Configuration”.')) + '</p></section>';
    const back = '<p class="fc-results-links noprint"><a class="fc-link fc-link-secondary" href="#fc-schedule" data-focus-target="fc-schedule">' +
      (readOnly ? tr('Zum Spielplan', 'Go to fixtures') : tr('Ergebnisse eintragen', 'Enter results')) + '</a></p>';
    if (!state.played) return '<section id="fc-results-status" class="fc-results-status noprint" tabindex="-1"><h2>' +
      tr('Noch keine Ergebnisse', 'No results yet') + '</h2><p class="fc-empty">' +
      tr('Sobald das erste Ergebnis eingetragen ist, erscheint hier der Zwischenstand.',
        'The current standings appear here as soon as the first result is entered.') + '</p>' + back + '</section>';
    return '<section id="fc-results-status" class="fc-results-status' + (state.final ? ' fc-results-final' : '') + '" tabindex="-1"><h2>' +
      (state.final ? tr('Endergebnis', 'Final results') : tr('Zwischenstand', 'Current standings')) + ' ' + badge(state.final) + '</h2>' +
      '<p><strong>' + state.played + tr(' von ', ' of ') + state.total + tr(' Spielen gewertet', ' matches recorded') + '</strong> · ' +
      (state.final ? tr('Alle Platzierungen entschieden.', 'All places decided.') : event.status === 'finals' && state.matchesComplete ?
        (state.unawardedPlaces.length ?
          tr('Alle Spiele erfasst · Plätze ' + state.unawardedPlaces.join(', ') + ' nicht vergeben.', 'All matches recorded · places ' + state.unawardedPlaces.join(', ') + ' not awarded.') :
          tr('Alle Spiele erfasst, aber die Endplatzierungen sind unvollständig.', 'All matches recorded, but final places are incomplete.')) :
        event.status === 'finals' ?
          tr('Endrunde läuft – offene Platzierungen sind gekennzeichnet.', 'Finals in progress – open places are marked.') :
        (state.played === state.total ?
          tr('Vorrunde vollständig – die Endphase kann jetzt ausgelost werden.', 'Group stage complete – the finals can now be drawn.') :
          tr('Gruppenphase läuft – Tabellen aktualisieren sich mit jedem Ergebnis.', 'Group stage in progress – tables update with every result.'))) + '</p>' +
      '<progress class="fc-results-progress" value="' + state.played + '" max="' + state.total + '" aria-label="' +
      tr('Gewertete Spiele', 'Matches recorded') + '">' + state.played + '/' + state.total + '</progress>' + back + '</section>';
  }
  function slotLabel(slot) {
    if (slot.from === slot.to) {
      const source = event.matches.find(match => match.id === slot.id);
      const winner = source && source.winnerPlacement === slot.from;
      const origin = source ? '<a href="#fc-match-' + esc(source.id) +
        '" data-focus-target="fc-match-' + esc(source.id) + '">' +
        (winner ? tr('Siegreiches Team aus ', 'Winner of ') : tr('Unterlegenes Team aus ', 'Loser of ')) +
        esc(source.id) + '</a>' : tr('Team noch offen', 'Team pending');
      return '<div class="fc-open-placement"><strong class="fc-open-placement-title">' +
        tr('Platz ', 'Place ') + slot.from + tr(' noch offen', ' pending') +
        '</strong><div class="fc-open-placement-sides"><span class="fc-open-side">' +
        origin + '</span></div></div>';
    }
    const name = slot.from === 1 ? tr('Finale offen', 'Final pending') : slot.from === 3 ?
      tr('Spiel um Platz 3 offen', '3rd-place match pending') : tr('Spiel um Platz ', 'Match for place ') + slot.from + tr(' offen', ' pending');
    const sides = slot.teams.slice(0, 2);
    if (sides.length < 2) sides.push(null);
    return '<div class="fc-open-placement"><strong class="fc-open-placement-title">' + name +
      '</strong><div class="fc-open-placement-sides">' + sides.map((id, index) =>
        (index ? '<span class="fc-open-versus">' + tr('gegen', 'vs') + '</span>' : '') +
        '<span class="fc-open-side">' + (id ?
          '<a class="fc-place-team-link" href="#fc-team-overview-title" data-overview-team="' + esc(id) + '">' +
            esc(teamName(id)) + '</a>' + placementContext(id) :
          '<span class="fc-open-pending">' + (index ? tr('Gegner noch offen', 'Opponent pending') :
            tr('Team noch offen', 'Team pending')) + '</span>') + '</span>').join('') +
      '</div></div>';
  }
  function placementContext(id) {
    const pool = teamPool(id);
    if (!pool) return '';
    return '<a class="fc-placement-context-link" href="#fc-pool-' + esc(pool) +
      '" data-focus-target="fc-pool-' + esc(pool) + '"><span class="fc-group-badge">' +
      esc(poolLabel(pool, true)) + '</span></a>';
  }
  function standingsHtml() {
    if (!event.matches.length || !resultsState().played) return '';
    const state = resultsState(), rows = state.rows, orgs = F.organizationStandings(event), finals = event.status === 'finals';
    const complete = state.final;
    const champions = rows.filter(r => r.rank === 1), orgWinners = orgs.filter(r => r.rank === 1);
    const placementRow = (row, slot) => '<tr data-team="' + esc(row.id) + '" data-result-slot="' + esc(slot.id) +
      '" data-result-teams="' + esc(slot.teams.filter(Boolean).join(' ')) + '"><td>' + placedRank(row) +
      '</td><td><div class="fc-place-entry"><div class="fc-place-teamline"><a class="fc-place-team-link" href="#fc-team-overview-title" data-overview-team="' +
      esc(row.id) + '">' + esc(teamName(row.id)) + '</a><span class="fc-place-company">' +
      esc(orgName(event.teams.find(t => t.id === row.id).orgId)) + '</span></div>' + placementContext(row.id) + '</div></td></tr>';
    const placements = state.slots.map(slot => {
      const slotAttrs = ' data-result-slot="' + esc(slot.id) + '" data-result-teams="' +
        esc(slot.teams.filter(Boolean).join(' ')) + '"';
      if (slot.kind === 'shared') return rows.filter(row => slot.teams.includes(row.id)).map(row => placementRow(row, slot)).join('');
      if (!slot.decided) return '<tr class="fc-open-row"' + slotAttrs + '><th scope="row">' + placeRange(slot.from, slot.to) +
        '</th><td>' + slotLabel(slot) + '</td></tr>';
      const outcome = event.outcomes[slot.id];
      const missingLabel = outcome && !outcome.winnerTeam ?
        tr('Nicht vergeben · Begegnung aufgehoben', 'Not awarded · match void') :
        tr('Platzierung nicht vergeben', 'Place not awarded');
      return (slot.from === slot.to ? [slot.from] : [slot.from, slot.to]).map(rank => {
        const row = rows.find(item => item.rank === rank);
        return row ? placementRow(row, slot) : '<tr class="fc-unawarded-row"' + slotAttrs + '><th scope="row">' + rank +
          '</th><td><strong>' + missingLabel + '</strong></td></tr>';
      }).join('');
    }).join('');
    const missingPlacement = !state.placementsComplete && state.matchesComplete;
    const company = F.rankingMode(event) !== 'teams';
    return '<section id="fc-standings"><h2>' + (finals ? tr('Titel & Endplatzierungen', 'Titles & final places') : company ? tr('Firmenwertung', 'Company ranking') : tr('Teamwertung', 'Team standings')) + ' ' + badge(complete) + '</h2>' +
      (finals ? '<div class="fc-standings-titles"><p><strong>' + tr('Siegerteam', 'Champion team') + '</strong><span>' +
        (champions.length ? champions.map(r => teamLink(r.id)).join(' / ') : tr('noch offen', 'pending')) + '</span></p>' +
        (company ? '<p><strong>' + tr('Firmenwertung', 'Company ranking') + '</strong><span>' +
          (orgWinners.length ? orgWinners.map(r => esc(orgName(r.id))).join(' / ') : tr('noch offen', 'pending')) + '</span></p>' : '') +
        '</div><p class="fc-note fc-standings-note">' + (complete ?
          tr('Alle Spiele und Platzierungen entschieden; geteilte Ränge bleiben geteilt.', 'All matches and places decided; shared ranks stay shared.') :
          tr('Offene Platzierungen behalten ihren Originalrang sowie den bekannten Gegner- oder Begegnungskontext.', 'Open placements retain their original rank and known opponent or source-match context.')) + '</p>' +
        '<h3>' + tr('Endplatzierungen aller Teams', 'Final places of all teams') + '</h3><table class="fc-table fc-place-table"><thead><tr><th scope="col">' + tr('Platz', 'Place') +
        '</th><th scope="col">' + tr('Team / offene Platzierung', 'Team / pending placement') +
        '</th></tr></thead><tbody>' + placements + '</tbody></table>' :
        '<p class="fc-note">' + (readOnly ? tr('Endplatzierungen folgen nach der Endrunde.', 'Final places follow after the finals.') :
          tr('Endplatzierungen und Firmenwertung stehen erst nach der Endrunde fest. Bis dahin zählt der Zwischenstand der Gruppentabellen oben.',
          'Final places and the company ranking are decided only after the finals. Until then, the pool tables above show the current standings.')) + '</p>') +
      (!company ? '</section>' :
      F.rankingMode(event) === 'mean' ? '<h3>' + tr('Zusätzliche Firmenwertung · Mittelwert', 'Additional company ranking · mean') + '</h3><p class="fc-note">' +
        (readOnly ? tr('Ø Endrang · kleiner ist besser · = geteilt', 'Mean final rank · lower is better · = shared') :
          tr('Mittlerer Team-Endrang: kleiner ist besser. Firmenränge erst, wenn alle Teams platziert sind. = bedeutet geteilter Rang.',
          'Mean team final rank: lower is better. Company ranks appear once all teams are placed. = means a shared rank.')) +
        '</p>' + resultsRules(rankingExplanation()) + '<table class="fc-table"><thead><tr><th>' + tr('Rang', 'Rank') + '</th><th>' + tr('Firma', 'Company') + '</th><th>' +
        tr('Teams platziert', 'Teams placed') + '</th><th>Ø ' + tr('Endrang', 'final rank') +
        '</th></tr></thead><tbody>' + orgs.map(r => '<tr data-company-row="' + esc(r.id) + '" data-company-teams="' +
          esc(event.teams.filter(team => team.orgId === r.id).map(team => team.id).join(' ')) + '"><td>' +
          sharedRank(r.rank, orgs) + '</td><td>' + esc(orgName(r.id)) + '</td><td>' + r.placed + '/' + r.count +
          '</td><td>' + (r.meanRank == null ? '—' : r.meanRank.toFixed(2)) + '</td></tr>').join('') + '</tbody></table></section>' :
      (finals ? '<h3>' + (complete ? tr('Firmenwertung · Endstand', 'Company ranking · final standings') :
        tr('Firmenwertung · aktueller vorläufiger Stand', 'Company ranking · current provisional rule')) + '</h3>' : '') + '<p class="fc-note">' +
      (readOnly ? tr('Firmenpokal: ausgewähltes Team · = geteilt · Regel vorläufig, nicht sportfachlich bestätigt.',
        'Company trophy: selected team · = shared · provisional rule, not sport-approved.') :
      tr('Die Endplatzierung des ausgewählten Teams entscheidet über den Firmenpokal. Alle Teams zählen unabhängig davon für den Teampokal.', 'The selected team’s final placing determines the company trophy ranking. All teams independently compete for the team trophy.') +
      ' ' + tr('= bedeutet geteilter Firmenrang. Diese Firmenregel ist vorläufig, nicht sportfachlich bestätigt.',
        '= means a shared company rank. This company rule is provisional, not sport-approved.')) +
      '</p>' + resultsRules(rankingExplanation()) + '<table class="fc-table' + (finals ? '' : ' fc-plain-table') + '"><thead><tr>' + (finals ? '<th>' + tr('Platz', 'Place') + '</th>' : '') + '<th>' + tr('Firma', 'Company') +
      '</th><th>' + (finals ? tr('Team für den Firmenpokal / Endplatzierung', 'Company trophy team / final placing') : tr('Team für den Firmenpokal', 'Company trophy team')) + '</th></tr></thead><tbody>' +
      orgs.map(r => '<tr data-company-row="' + esc(r.id) + '" data-company-teams="' +
        esc(event.teams.filter(team => team.orgId === r.id).map(team => team.id).join(' ')) + '">' +
        (finals ? '<td>' + (r.rank ? sharedRank(r.rank, orgs) : (missingPlacement ? tr('nicht vergeben', 'not awarded') : tr('offen', 'open'))) + '</td>' : '') +
        '<td>' + esc(orgName(r.id)) + '</td><td>' + teamLink(r.nominee) + ' ' + teamBadge(r.nominee, finals, true) +
        (finals ? ' / ' + (r.teamRank ? placedRank(rows.find(row => row.id === r.nominee)) :
          (missingPlacement ? tr('nicht vergeben', 'not awarded') : tr('offen', 'open'))) : '') +
        '</td></tr>').join('') + '</tbody></table></section>');
  }
  function poolTable(rows, pool) {
    return '<table class="fc-table fc-pool-table" aria-labelledby="fc-pool-title-' + pool +
      '"><thead><tr><th scope="col">' + tr('Platz', 'Place') + '</th><th scope="col">Team</th>' +
      '<th scope="col">' + tr('Spiele', 'Played') + '</th>' +
      '<th scope="col">' + tr('Siege', 'Wins') + '</th>' +
      '<th scope="col"><abbr title="' + tr('Balldifferenz', 'Ball-point difference') + '" aria-label="' +
        tr('Balldifferenz', 'Ball-point difference') + '">' + tr('Diff.', 'Diff') + '</abbr></th>' +
      '<th scope="col"><abbr title="' + tr('Erzielte Ballpunkte', 'Scored ball points') + '" aria-label="' +
        tr('Erzielte Ballpunkte', 'Scored ball points') + '">' + tr('Bälle', 'Balls') + '</abbr></th></tr></thead><tbody>' +
      rows.map(r => '<tr data-team="' + esc(r.id) + '"><td>' + sharedRank(r.rank, rows) + '</td><td><a class="fc-results-team" href="#fc-team-overview-title" data-overview-team="' +
        esc(r.id) + '"><span>' + esc(teamName(r.id)) + '</span><small>' +
        esc(orgName(event.teams.find(t => t.id === r.id).orgId)) + '</small></a></td><td>' + r.played + '</td><td><strong>' + r.points + '</strong></td>' +
        '<td>' + (r.diff > 0 ? '+' : '') + r.diff + '</td><td>' + r.for + '</td></tr>').join('') + '</tbody></table>';
  }
  function poolsHtml() {
    if (!event.matches.length) return '';
    const frozen = event.status === 'finals';
    const noResults = resultsState().played === 0;
    return '<section id="fc-pools" class="' + (noResults ? 'fc-pools-unplayed' : '') + '" tabindex="-1"><h2>' + tr('Gruppentabellen · Vorrunde', 'Pool tables · group stage') + ' ' + badge(frozen) + '</h2><p class="fc-note fc-pools-summary">' +
      tr('Siege → Balldifferenz → erzielte Ballpunkte. ', 'Wins → ball difference → scored ball points. ') +
      tr('= bedeutet geteilter Platz, keine Reihenfolge unter Gleichstehenden.', '= means a shared place, with no ordering of tied teams.') + '</p>' +
      resultsRules(scoringExplanation() + ' ' + (frozen ? tr('Abgeschlossen: Mit der Finalauslosung eingefroren. Geteilte Tabellenränge bleiben; nur die Setzung wurde laut Losprotokoll aufgelöst.',
        'Complete: frozen by the final draw. Shared table ranks remain; only seeding ties were resolved by the draw record.') :
        tr('Vorläufig: aktualisiert sich mit jedem Ergebnis. Restgleichstände entscheidet erst die Finalauslosung per Los.',
          'Provisional: updates with every result. Remaining ties are only resolved by lottery at the final draw.'))) +
      (event.pools.length > 3 ? '<nav class="fc-group-nav noprint" aria-label="' + tr('Direkt zur Gruppentabelle', 'Jump to pool table') + '">' +
      event.pools.map((p, i) => groupBadge('G' + (i + 1), false, true)).join('') + '</nav>' : '') + '<div class="fc-pool-grid fc-results-grid">' +
      event.pools.map((p, i) => {
        const pool = 'G' + (i + 1), matches = event.matches.filter(m => m.pool === pool);
        return '<div class="fc-pool fc-results-pool" id="fc-pool-' + pool + '" data-results-pool="' + pool + '" tabindex="-1"><div class="fc-pool-heading">' +
          poolHeading(pool, 'fc-pool-title-' + pool, false) + '<p>' +
          matches.filter(decided).length + '/' + matches.length + tr(' gewertet', ' recorded') + '</p></div>' +
          '<a class="fc-pool-matches noprint" href="#fc-schedule" data-pool-matches="' + pool + '">' +
          (readOnly ? tr('Spiele ansehen', 'View matches') : tr('Spiele & Punkteeingabe', 'Matches & score entry')) + '</a>' + poolTable(F.table(event, p, pool), pool) + '</div>';
      }).join('') + '</div>' + paperTallySheet() + paperSeedingSheet() + '</section>';
  }
  let overviewTeam = params.get('team') || '';
  let teamSearch = '';
  let overviewHidden = false;
  function teamOverviewBody(id) {
    if (!id) return '<p class="fc-note">' + (readOnly ?
      tr('Alle Teams', 'All teams') :
      tr('Team im Gruppenverzeichnis wählen: Spiele, Schiridienste und Ergebnisse. Die Auswahl ändert keine Spielplanfilter.', 'Choose a team in the pool directory for matches, referee duties and results. Selection does not change fixture filters.')) + '</p>';
    const view = F.teamOverview(event, id);
    const order = (x, y) => x.wave - y.wave || x.field - y.field;
    function item(m, duty) {
      const a = F.resolve(event, m.a), b = F.resolve(event, m.b);
      const opponent = a === id ? b : a, cup = m.phase === 'cup';
      const context = cup || m.pool !== view.pool ? matchContext(m, false) + ' ' : '';
      const what = '<span class="fc-agenda-heading"><strong class="fc-agenda-role">' +
        (duty ? tr('Schiridienst:', 'Referee duty:') : tr('Spiel gegen', 'Match against')) + '</strong> ' +
        (context ? '<span class="fc-agenda-context">' + context + '</span>' : '') + '</span> ' +
        '<span class="fc-agenda-opponents">' + (duty ? matchLabel(m, cup ? null : m.pool, tr(' gegen ', ' vs ')) :
          esc(opponent ? teamIdentity(opponent) : tr('Gegner noch offen', 'Opponent pending')) +
          (opponent && cup ? ' ' + teamBadge(opponent, true, false) : '')) + '</span>';
      const description = 'fc-agenda-what-' + m.id;
      const done = decided(m), result = event.results[m.id];
      const explained = done && (!result || result.drawWinner);
      return '<li class="fc-agenda-item' + (duty ? ' fc-agenda-duty' : '') + (done ? ' fc-agenda-done' : '') +
        (explained ? ' fc-agenda-explained' : '') + '"><a href="#fc-match-' + esc(m.id) + '" data-focus-target="fc-match-' + esc(m.id) + '" aria-describedby="' + esc(description) + '"><strong>' +
        F.clock(m.startMin) + '</strong><span>' + tr('Runde ', 'Slot ') + (m.wave + 1) + ' · ' + tr('Feld ', 'Court ') + m.field + '</span></a>' +
        '<span class="fc-agenda-what" id="' + esc(description) + '">' + what + '</span>' +
        (done ? '<span class="fc-agenda-result"><small>' + tr('Ergebnis', 'Result') + '</small> ' + resultText(m) + '</span>' : '') + '</li>';
    }
    function list(games, duties, empty, note) {
      const entries = games.map(m => ({ m: m, duty: false })).concat(duties.map(d => ({ m: d.match, duty: true })))
        .sort((x, y) => order(x.m, y.m));
      return (entries.length ? '<ol class="fc-agenda-list">' + entries.map(entry => item(entry.m, entry.duty)).join('') + '</ol>' : '<p class="fc-note">' + empty + '</p>') + note;
    }
    const teamDuties = F.refereeMode(event) === 'teams';
    const upcoming = view.upcoming.length + view.duties.filter(d => !d.completed).length;
    const completed = readOnly ? view.completed.length : view.completed.length + view.duties.filter(d => d.completed).length;
    if (readOnly) {
      const nextGame = view.upcoming[0] || null;
      const nextDuty = view.duties.find(duty => !duty.completed) || null;
      const nextSection = (title, match, duty, empty) => '<section class="fc-participant-next fc-agenda-upcoming"><h5>' + title + '</h5>' +
        (match ? list(duty ? [] : [match], duty ? [match] : [], '', '') : '<p class="fc-note">' + empty + '</p>') + '</section>';
      return '<h4 id="fc-team-overview-title" class="fc-team-title" tabindex="-1"><span>' + esc(teamIdentity(id)) + '</span>' +
        (view.pool ? ' <span class="fc-team-pool-link">' + teamBadge(id, event.status === 'finals', false) + '</span>' : '') + '</h4>' +
        '<div class="fc-team-agenda fc-participant-agenda">' +
        nextSection(tr('Nächstes Spiel', 'Next match'), nextGame, false,
          tr('Kein weiteres Spiel zugeordnet.', 'No further match assigned.')) +
        (teamDuties ? nextSection(tr('Nächster Schiri-Einsatz', 'Next referee duty'), nextDuty, true,
          tr('Kein weiterer Schiri-Einsatz geplant.', 'No further referee duty is scheduled.')) : '') +
        (completed ? '<div class="fc-agenda-completed"><h5>' + tr('Ergebnisse', 'Results') + ' <span>(' + view.completed.length + ')</span></h5>' +
          list(view.completed, [], '', '') + '</div>' : '<p class="fc-note fc-agenda-empty">' +
          tr('Für dieses Team gibt es noch keine Ergebnisse.', 'No results have been recorded for this team yet.') + '</p>') +
        '</div>';
    }
    return '<h4 id="fc-team-overview-title" class="fc-team-title" tabindex="-1"><span>' + esc(teamIdentity(id)) + '</span>' +
      ' <a class="fc-team-pool-link" href="#fc-pool-' + view.pool + '" data-focus-target="fc-pool-' + view.pool + '">' +
      teamBadge(id, event.status === 'finals', false) + '</a></h4>' +
      '<div class="fc-team-agenda"><div class="fc-agenda-upcoming"><h5>' + tr('Als Nächstes', 'Up next') + ' <span>(' + upcoming + ')</span></h5>' +
      list(view.upcoming, view.duties.filter(d => !d.completed), tr('Keine feststehenden offenen Spiele oder Dienste.', 'No confirmed pending matches or duties.'),
        (view.finalsPending || view.conditional) ? '<p class="fc-note fc-agenda-guidance">' +
          (view.finalsPending ? tr('Baumspiele folgen nach Abschluss und Auslosung der Gruppenphase.', 'Bracket matches follow after the group stage is complete and drawn.') :
            tr('Weitere Baumspiele hängen von den vorherigen Ergebnissen ab; sie sind noch nicht als feste Termine zugeordnet.', 'Further bracket matches depend on earlier results and are not yet assigned as confirmed fixtures.')) + '</p>' : '') +
      '</div>' + (completed ? '<div class="fc-agenda-completed"><h5>' + tr('Abgeschlossen', 'Completed') + ' <span>(' + completed + ')</span></h5>' +
      list(view.completed, view.duties.filter(d => d.completed), '', '') + '</div>' :
        '<p class="fc-note fc-agenda-empty">' + tr('Noch keine Spiele gewertet.', 'No matches recorded yet.') + '</p>') + '</div>' +
      (teamDuties && !view.duties.length ? '<p class="fc-note">' +
        tr('Derzeit kein Schiridienst zugeteilt.', 'No referee duty currently assigned.') + '</p>' : '');
  }
  function teamOverview() {
    if (!event.matches.length) return '';
    return (!readOnly ? '<button type="button" id="fc-team-overview-open" class="noprint" aria-controls="fc-team-overview" aria-expanded="' + !overviewHidden + '"' +
      (overviewHidden ? '' : ' hidden') + '>' + tr('Teams & Gruppen einblenden', 'Show teams & pools') + '</button>' : '') +
      '<section id="fc-team-overview" aria-labelledby="fc-team-overview-heading"' + (!readOnly && overviewHidden ? ' hidden' : '') +
      '><div class="fc-team-overview-head"><h2 id="fc-team-overview-heading" tabindex="-1">' +
      tr(readOnly ? 'Dein Teamablauf' : 'Teams & Gruppen', readOnly ? 'Your team schedule' : 'Teams & pools') + '</h2></div>' +
      (!readOnly ? poolDirectory('overview') + '<p id="fc-directory-empty" class="fc-note noprint" hidden>' +
      tr('Kein Team zur Suche gefunden. Suche unten ändern oder Filter zurücksetzen.', 'No team matches the search. Change the search below or reset filters.') + '</p>' : '') +
      '<div id="fc-team-agenda" data-team="' + esc(overviewTeam) + '" aria-live="polite">' + teamOverviewBody(overviewTeam) + '</div></section>';
  }
  function setTeamOverviewVisible(visible, focus) {
    overviewHidden = !visible;
    const overview = document.getElementById('fc-team-overview');
    const opener = document.getElementById('fc-team-overview-open');
    if (!overview || !opener) return;
    overview.hidden = !visible;
    opener.hidden = visible;
    opener.setAttribute('aria-expanded', String(visible));
    if (focus) (visible ? overview.querySelector('.app-close') : opener).focus();
  }
  function chooseTeam(id) {
    if (id && !event.teams.some(team => team.id === id)) return;
    if (!readOnly) setTeamOverviewVisible(true, false);
    overviewTeam = id;
    if (readOnly) {
      const url = new URL(location.href);
      if (id) url.searchParams.set('team', id);
      else url.searchParams.delete('team');
      history.replaceState(null, '', url.href);
    }
    const teamFilter = document.getElementById('fc-results-team-filter');
    if (teamFilter) { updateTeamSearch(); teamFilter.value = id; }
    const agenda = document.getElementById('fc-team-agenda');
    if (!agenda) return;
    agenda.dataset.team = id;
    agenda.innerHTML = teamOverviewBody(id);
    app.querySelectorAll('.fc-team-directory [data-overview-team]').forEach(link => {
      if (link.dataset.overviewTeam === id) link.setAttribute('aria-current', 'true');
      else link.removeAttribute('aria-current');
    });
    if (readOnly) resultsFilter();
  }
  function updateTeamSearch() {
    const select = document.getElementById('fc-results-team-filter');
    if (!select) return;
    const q = teamSearch.trim().toLocaleLowerCase();
    const matches = event.teams.filter(team =>
      teamIdentity(team.id).toLocaleLowerCase().indexOf(q) >= 0);
    // Keep the selected ID available even while searching for another team.
    select.innerHTML = '<option value="">' + tr('Alle Teams', 'All teams') + '</option>' +
      event.teams.filter(team => team.id === overviewTeam || matches.some(hit => hit.id === team.id))
        .map(team => '<option value="' + esc(team.id) + '">' + esc(teamIdentity(team.id)) + '</option>').join('');
    select.value = overviewTeam;
    const status = document.getElementById('fc-team-search-status');
    status.hidden = !q;
    status.textContent = matches.length ?
      matches.length + tr(' Teams gefunden', ' teams found') : tr('Kein Team gefunden', 'No team found');
    document.getElementById('fc-team-reset').hidden = !overviewTeam && !teamSearch;
  }
  function navigationTarget(id) {
    return document.getElementById(id);
  }
  function capacityOverview(plan, c, draft) {
    const labels = {
      group: tr('Vorrunde', 'Group stage'),
      cup: plan.config.placementMode === 'all' ? tr('Klassifikationsbäume · alle Plätze', 'Classification brackets · all places') :
        tr('Klassifikationsbäume · individuell bis ', 'Classification brackets · individual places through ') + plan.config.placementThrough
    };
    return '<dl class="fc-phase-times">' + c.phases.map(p => {
      const estimated = draft || p.estimated;
      return '<div data-capacity-phase="' + p.phase + '" data-time-source="' + (estimated ? 'estimate' : 'schedule') + '">' +
        '<dt>' + labels[p.phase] + '</dt><dd><strong>' + (estimated ? tr('ca. ', 'approx. ') : '') +
        F.clock(p.startMin) + '–' + F.clock(p.endMin) + '</strong><span>' +
        (p.estimated ? tr('Beispielschätzung · Finalauslosung offen', 'Illustrative estimate · final draw pending') :
          draft ? tr('Entwurfsschätzung · noch kein gespeicherter Plan', 'Draft estimate · no saved schedule yet') :
            tr('Geplanter Zeitraum', 'Scheduled span')) + ' · ' + p.matches + tr(' Spiele', ' matches') + '</span></dd></div>';
    }).join('') + '</dl>' +
      '<p class="fc-capacity-total"><strong>' + (plan.status === 'finals' && !draft ?
        tr('Gesamter Spielplan: ', 'Whole schedule: ') : tr('Gesamtes Turnier geschätzt: ', 'Whole event estimated: ')) +
      plan.config.start + '–' + F.clock(c.projectedEndMin) + '</strong> · ' + c.projectedMinutes + tr(' Min.', ' min.') +
      '<br>' + tr('Verfügbares Zeitfenster: ', 'Available time window: ') + plan.config.start + '–' +
      F.clock(timeMinutes(plan.config.start) + plan.config.window) + ' · ' + plan.config.window + tr(' Min.', ' min.') + '</p>' +
      '<p class="fc-note">' +
      tr('Zeitspannen einschließlich Wechselzeiten, ohne Verzögerungen oder Führungsverlängerung.', 'Spans include changeovers, not delays or first-lead overtime.') + '</p>' +
      gamesOverview(c.games);
  }
  function gameRange(range) {
    return range.min + '–' + range.max;
  }
  function gamesOverview(games) {
    if (!games.final) return '';
    return '<p class="fc-games-summary"><strong>' + tr('Spiele je Team · Min.–Max.: ', 'Matches per team · min–max: ') +
      gameRange(games.final) + '</strong> · ' +
      (games.final.exact ? tr('Endplan', 'Final schedule') : tr('äußere Grenzen vor Auslosung, nicht exakte Prognose', 'outer bounds before draw, not an exact forecast')) +
      '<br>' + tr('Aktuell angesetzt: ', 'Currently scheduled: ') + gameRange(games.scheduled) + ' · ' +
      tr('Tatsächlich gespielt: ', 'Actually played: ') + gameRange(games.played) +
      '<br><small>' + tr('Plan bei vollständiger Teilnahme; Nichtantreten, Rückzug und aufgehobene Begegnungen garantieren keine gespielten Matches.',
        'Schedule assumes full participation; nonappearance, withdrawal and void fixtures do not guarantee played matches.') + '</small></p>';
  }
  function capacityDetails(plan, c) {
    const group = c.phases.find(p => p.phase === 'group');
    return '<p>' + plan.pools.length + ' ' +
      (plan.pools.length === 1 ? tr('Gruppe', 'pool') : tr('Gruppen', 'pools')) + ' · ' +
      group.matches + tr(' Vorrundenspiele · ', ' group matches · ') +
      '<span data-preview-value="waves">' + (Math.max.apply(null, plan.matches.filter(m => m.phase === 'group').map(m => m.wave)) + 1) +
      '</span>' + tr(' Vorrunden-Spielrunden.</p><p>', ' group time slots.</p><p>') +
      c.courts + tr(' Felder Spitzenbelegung im Plan · ', ' courts at peak in the schedule · ') +
      c.waves + tr(' Spielrunden inkl. Pausen. ', ' time slots including rest. ') +
      plan.config.rest + tr(' volle Spielrunden spielfrei zwischen eigenen Spielen. ', ' full non-playing slots between own matches. ') +
      (F.refereeMode(plan) === 'teams' ? tr('Spielruhe erlaubt Schiridienst, keine garantierte Erholungspause. Schiri-Einsätze je Team im vorhandenen Plan, kleinste/größte Anzahl: ', 'Match rest allows referee duty, not guaranteed recovery time. Referee assignments per team in the current schedule, lowest/highest count: ') +
        F.refereeStats(plan).min + '/' + F.refereeStats(plan).max :
        F.refereeMode(plan) === 'none' ? tr('Ohne Schiris: selbst geleitete Spiele, keine externen oder Team-Dienste.', 'No referees: self-officiated matches, no external or team duties.') :
          tr('Dedizierte externe Schiris je genutztem Feld; keine Teamdienste.', 'Dedicated external referee per used court; no team duties.')) +
      '</p><p class="fc-note">' + tr('Rechnerischer Plan ohne Verzögerungsreserve; keine Zusage für Durchführung, tatsächliche Feldverfügbarkeit oder Einhaltung der Endzeit. Die Gruppe wird erst mit der Finalauslosung sportlich eingefroren.', 'Computed schedule without delay buffer; no guarantee of execution, actual court availability or finish time. Group scores become frozen when finals are drawn.') +
      (F.tiePolicy(plan) === 'lead' ? tr(' Verlängerung bis Führung: Zusatzzeit nicht enthalten und nicht nach oben begrenzt; gemeinsame Folgestarts erst nach Spielende, nötigenfalls Restplan ausdrücklich verschieben.',
        ' First-lead overtime: extra time is not included or bounded; subsequent central starts must wait for matches to finish, explicitly delaying remaining waves if needed.') : '') + '</p>';
  }
  function capacity(preview) {
    if (!preview && !readOnly && !event.startedAt) return '';
    if (!preview && event.status === 'draft') return '';
    const c = preview ? null : F.estimate(event);
    const warnings = {
      referees: tr('Zu wenige externe Schiedsrichter:innen: gleichzeitig werden nur ', 'Not enough external referees: only ') + (c ? c.courts : '') + tr(' Felder genutzt.', ' courts used concurrently.'),
      window: tr('Gesamtprojektion/Plan überschreitet das Zeitfenster. Vor Durchführung Ressourcen/Zeiten prüfen.', 'Whole-event projection/schedule exceeds the time window. Review resources/timing before running the event.')
    };
    return '<section id="fc-capacity" tabindex="-1" aria-label="' + tr('Zeitplan & Kapazität', 'Schedule & capacity') + '">' +
      (preview ? setupFeedback() : c.warnings.filter(w => w !== 'finals-pending').map(w => '<p class="fc-warning">' + warnings[w] + '</p>').join('')) +
      '<details class="fc-capacity-details"' + (preview ? ' hidden' : '') + '><summary>' +
      tr('Zeitplan & Details', 'Schedule & details') + '</summary>' +
      '<div data-capacity-overview>' + (preview ? '' : capacityOverview(event, c, false)) + '</div>' +
      (preview ? '<ul id="fc-detail-advice" class="fc-setup-advice" aria-label="' + tr('Felder & Schiris', 'Courts & referees') + '" hidden></ul>' : '') +
      '<div data-capacity-details>' +
      (preview ? '' : capacityDetails(event, c)) + '</div></details></section>';
  }
  function teamCount(n) { return n + ' ' + (n === 1 ? tr('Team', 'team') : tr('Teams', 'teams')); }
  function isAbsent(id) { return F.checkInStatus(event, id) === 'absent'; }
  function unstartedPlan() {
    return event.status === 'groups' && !event.startedAt && !event.liveWave &&
      !Object.keys(event.results).length && !Object.keys(event.outcomes).length;
  }
  // Only explicit absences block participation.
  function teamAttendance(id) {
    if (readOnly || !event.matches.length) return '';
    const withdrawn = event.withdrawals && event.withdrawals[id];
    return '<div class="fc-team-attendance noprint"><strong>' +
      (withdrawn ? tr('Zurückgezogen', 'Withdrawn') : isAbsent(id) ? tr('Abwesend', 'Absent') : tr('Anwesend', 'Present')) +
      '</strong> ' + (withdrawn ? '<span class="fc-note">' + tr('Rückzug und Spielentscheidungen im Spielplan verwalten.', 'Manage withdrawal and match decisions in the fixtures.') + '</span>' :
        '<button type="button" id="fc-attendance-team-' + esc(id) + '" data-attendance="' + esc(id) + '">' +
        (isAbsent(id) ? tr('Wieder da melden', 'Mark back') : tr('Abwesend melden', 'Mark absent')) + '</button>') + '</div>';
  }
  function checkin() {
    if (readOnly || !event.matches.length) return '';
    const withdrawn = event.teams.filter(t => event.withdrawals && event.withdrawals[t.id]);
    const absent = event.teams.filter(t => isAbsent(t.id) && !(event.withdrawals && event.withdrawals[t.id]));
    const available = event.teams.filter(t => !isAbsent(t.id) && !(event.withdrawals && event.withdrawals[t.id]));
    return '<div id="fc-checkin" class="noprint" tabindex="-1">' +
      '<p id="fc-attendance-count"><strong>' + tr(available.length + ' von ' + teamCount(event.teams.length) + ' anwesend',
        available.length + ' of ' + teamCount(event.teams.length) + ' present') + '</strong> · ' +
      tr(absent.length + ' abwesend', absent.length + ' absent') +
      (withdrawn.length ? ' · ' + tr(withdrawn.length + ' zurückgezogen', withdrawn.length + ' withdrawn') : '') + '</p>' +
      '<p class="fc-note">' + tr('Alle Teams gelten als anwesend. Abwesend- und Wieder-da-Meldungen werden direkt auf der jeweiligen Teamkarte verwaltet. Abwesenheit ändert keine Spiele oder Ergebnisse; Nichtantreten und Rückzug im Spielplan entscheiden. ',
        'All teams count as present. Marking a team absent or back is managed directly on its team card. Absence does not change fixtures or scores; decide nonappearance and withdrawal in the fixtures. ') +
      tr(binding && binding.id ? 'Wird mit dem Server synchronisiert, bleibt aber privat.' : 'Nur lokal auf diesem Gerät gespeichert; nie öffentlich.',
        binding && binding.id ? 'Synchronized with the server but kept private.' : 'Stored only on this device; never public.') + '</p>' +
      (unstartedPlan() && absent.length ? '<p class="fc-note">' + tr('Noch nichts gestartet: Fehlen Teams ganz, können sie aus der Anmeldung entfernt werden. Der Gruppenplan wird dann neu erstellt.',
        'Nothing has started yet: teams that will not come at all can be removed from registration. The pool schedule is then rebuilt.') + '</p>' +
        button('remove-absent', tr('Abwesende Teams aus Anmeldung entfernen und Plan neu erstellen', 'Remove absent teams from registration and rebuild schedule')) : '') +
      '</div>';
  }
  function nextPlannedWave(after) {
    const waves = Array.from(new Set(event.matches.map(m => m.wave))).sort((a, b) => a - b);
    const found = waves.find(w => (after == null || w > after) &&
      event.matches.some(m => m.wave === w && !event.results[m.id] && !event.outcomes[m.id]));
    return found === undefined ? null : found;
  }
  function nextWave() {
    if (event.liveWave && event.matches.some(m => m.wave === event.liveWave.wave && !event.results[m.id] && !event.outcomes[m.id])) return event.liveWave.wave;
    return nextPlannedWave(event.liveWave ? event.liveWave.wave : null);
  }
  function blockedResolution(item) {
    if (item.role === 'referee') return '<p class="fc-warning">' + tr('Schiri-Team fehlt: ', 'Referee team unavailable: ') +
      esc(teamName(item.team)) + ' · ' + esc(item.match) + '. ' +
      tr('Wieder anwesend melden oder ab dieser ungestarteten Welle umplanen (auch ohne Feldänderung/Verzögerung). Keine Spielverlustwertung gegen das Schiri-Team.',
        'Mark present again or replan from this unstarted time slot (even without a court change/delay). No playing forfeit against the referee team.') + '</p>';
    return '<p class="fc-warning fc-resolve">' + (item.withdrawn ? tr('Zurückgezogen: ', 'Withdrawn: ') : tr('Abwesend gemeldet: ', 'Reported absent: ')) +
      '<strong>' + esc(teamName(item.team)) + '</strong> · ' + tr('Spiel ', 'Match ') + esc(item.match) + '<br>' +
      (item.withdrawn ? '' : '<a class="fc-link" href="#fc-attendance-team-' + esc(item.team) + '" data-focus-target="fc-attendance-team-' + esc(item.team) + '">' +
        tr('Wieder da melden', 'Mark back') + '</a> ') +
      '<a class="fc-link" href="#fc-outcome-' + esc(item.match) + '" data-focus-target="fc-outcome-' + esc(item.match) + '">' +
      tr('Nichtantreten entscheiden', 'Decide nonappearance') + '</a></p>';
  }
  function actualClock(iso) {
    return new Date(iso).toLocaleTimeString(en ? 'en-GB' : 'de-DE', { hour: '2-digit', minute: '2-digit' });
  }
  // Wave that can be started from its schedule header: the next pending, not yet started time slot.
  function startableWave() {
    const wave = nextWave();
    return wave != null && !(event.liveWave && event.liveWave.wave === wave) ? wave : null;
  }
  function currentWaveSummary() {
    const wave = nextWave();
    if (wave == null) return '<p class="fc-note">' + tr('Alle Spielrunden erfasst.', 'All time slots recorded.') + '</p>';
    const running = event.liveWave && event.liveWave.wave === wave;
    const matches = event.matches.filter(m => m.wave === wave).sort((a, b) => a.field - b.field);
    return '<section id="fc-current-wave" aria-labelledby="fc-current-wave-title"><h3 id="fc-current-wave-title">' +
      (running ? tr('Aktuelle Spielrunde ', 'Current time slot ') : tr('Nächste Spielrunde ', 'Next time slot ')) + (wave + 1) + '</h3>' +
      '<div class="fc-current-matches">' + matches.map(m => '<article class="fc-public-match" data-current-match="' + esc(m.id) + '">' +
        publicMatchContent(m, true) + '</article>').join('') + '</div>' +
      '</section>';
  }
  function cockpit() {
    if (readOnly || !event.matches.length) return '';
    const missing = event.matches.filter(m => !event.results[m.id] && !event.outcomes[m.id]);
    const active = event.liveWave ? event.liveWave.wave : null;
    const actionWave = nextWave();
    const upcoming = active != null && actionWave === active ? nextPlannedWave(active) : actionWave;
    const incompleteWave = active != null && event.matches.some(m => m.wave === active && !event.results[m.id] && !event.outcomes[m.id]);
    let actionLink = '';
    if (actionWave != null) {
      const ready = F.waveReadiness(event, actionWave);
      if (ready.blocked.length) {
        const item = ready.blocked[0];
        actionLink = (item.role === 'referee' ? tr('Abwesendes Schiri-Team in Spielrunde ', 'Absent referee team in time slot ') :
          tr('Abwesendes Team in Spielrunde ', 'Absent team in time slot ')) + (actionWave + 1) + ': <strong>' + esc(teamName(item.team)) + '</strong> · ' +
          (item.withdrawn ? '' : '<a href="#fc-attendance-team-' + esc(item.team) + '" data-focus-target="fc-attendance-team-' + esc(item.team) + '">' +
            tr('Wieder da melden', 'Mark back') + '</a> ' + tr('oder ', 'or ')) +
          (item.role === 'referee' ? '<a href="#fc-replan" data-focus-target="fc-replan">' + tr('Schiridienst umplanen', 'Replan referee duty') + '</a>' :
            '<a href="#fc-outcome-' + esc(item.match) + '" data-focus-target="fc-outcome-' + esc(item.match) + '">' +
            tr('Nichtantreten für Spiel ', 'decide nonappearance for match ') + esc(item.match) + tr(' entscheiden', '') + '</a>');
      } else if (ready.unresolved.length) {
        const previous = event.matches.find(m => m.wave < actionWave && !event.results[m.id]);
        actionLink = previous ? '<a href="#fc-match-' + esc(previous.id) + '" data-focus-target="fc-match-' + esc(previous.id) + '">' +
          tr('Offenes Vorgängergebnis eintragen', 'Enter a missing predecessor result') + '</a>' :
          tr('Vorgängerergebnisse prüfen.', 'Review previous results.');
      } else if (actionWave === active) {
        const pending = event.matches.find(m => m.wave === actionWave && !event.results[m.id] && !event.outcomes[m.id]);
        actionLink = '<a href="#fc-match-' + esc(pending.id) + '" data-focus-target="fc-match-' + esc(pending.id) + '">' +
          tr('Offenes Ergebnis dieser Spielrunde eintragen', 'Enter a missing result for this time slot') + '</a>';
      } else if (ready.ready) {
        actionLink = '<a href="#fc-wave-start-' + actionWave + '" data-focus-target="fc-wave-start-' + actionWave + '">' +
          tr('Spielrunde ' + (actionWave + 1) + ' zentral starten', 'Start time slot ' + (actionWave + 1) + ' centrally') + '</a>';
      } else {
        const pending = event.matches.find(m => m.wave === actionWave && !event.results[m.id]);
        actionLink = pending ? '<a href="#fc-match-' + esc(pending.id) + '" data-focus-target="fc-match-' + esc(pending.id) + '">' +
          tr('Offenes Ergebnis dieser Spielrunde eintragen', 'Enter a missing result for this time slot') + '</a>' : '';
      }
    } else if (event.status === 'groups' && event.matches.filter(m => m.phase === 'group').every(m => event.results[m.id] || event.outcomes[m.id])) {
      actionLink = '<a href="#fc-finals" data-focus-target="fc-finals">' + tr('Endphase auslosen und planen', 'Draw and schedule finals') + '</a>';
    } else if (missing.length) {
      const first = missing[0];
      actionLink = '<a href="#fc-match-' + esc(first.id) + '" data-focus-target="fc-match-' + esc(first.id) + '">' +
        tr('Nächstes offenes Ergebnis eintragen', 'Enter the next pending result') + '</a>';
    }
    const warnings = Array.from(new Set([active, upcoming].filter(w => w != null))).map(w => {
      const readiness = F.waveReadiness(event, w);
      return readiness.blocked.map(blockedResolution).join('') +
        (w === upcoming && readiness.unresolved.length ? '<p class="fc-warning">' + tr('Vorgängerergebnisse offen; Gegner noch nicht festgelegt.', 'Previous results are missing; opponents are not yet determined.') + '</p>' : '');
    }).join('');
    return '<section id="fc-cockpit" class="fc-cockpit noprint" aria-labelledby="fc-cockpit-title"><p class="fc-cockpit-state"><strong id="fc-cockpit-title">' +
      tr('Turniertag', 'Event day') + ':</strong> <strong>' +
      missing.length + tr(' von ', ' of ') + event.matches.length + ' ' + tr('Ergebnissen offen', 'results pending') + '</strong> · ' +
      (active == null ? tr('noch keine Spielrunde gestartet', 'no time slot started yet') :
        tr('Spielrunde ', 'Time slot ') + (active + 1) + ' ' + tr('gestartet ', 'started ') + actualClock(event.liveWave.startedAt) + ' · ' +
        (incompleteWave ? tr('Ergebnisse ausstehend', 'results pending') : tr('vollständig erfasst', 'fully recorded'))) +
      ' <span id="fc-countdown" role="timer"></span></p>' +
      warnings + '<div class="fc-cockpit-actions">' +
      (actionLink ? '<p class="fc-next"><strong>' + tr('Nächste Aktion: ', 'Next action: ') + '</strong>' + actionLink + '</p>' : '') +
      '<p class="fc-cockpit-links">' +
      (missing.length < event.matches.length ? '<a class="fc-link fc-link-secondary" id="fc-cockpit-results" href="#fc-results-status" data-focus-target="fc-results-status">' +
        (resultsState().final ? tr('Endergebnis ansehen', 'View final results') : tr('Zwischenstand ansehen', 'View current standings')) + '</a>' : '') +
      '<a class="fc-link fc-link-secondary" id="fc-cockpit-teams" href="#fc-checkin" data-focus-target="fc-checkin">' +
      tr('Teams & Anwesenheit', 'Teams & attendance') + '</a> ' +
      '<a class="fc-link fc-link-secondary" id="fc-cockpit-org" href="#fc-org" data-focus-target="fc-org-summary">' +
      tr('Erweiterte Spielplansteuerung', 'Advanced schedule controls') + '</a></p></div></section>';
  }
  function organization() {
    if (readOnly || !event.matches.length) return '';
    return '<details id="fc-org" class="fc-org noprint"' + (orgOpen ? ' open' : '') + '><summary id="fc-org-summary">' +
      tr('Erweiterte Spielplansteuerung', 'Advanced schedule controls') + '</summary>' +
      live() + '</details>';
  }
  function matchLabel(m, poolContext, separator) {
    const a = F.resolve(event, m.a), b = F.resolve(event, m.b);
    const showOrigin = id => id && (poolContext == null || teamPool(id) !== poolContext);
    return esc(opponentLabel(m.a)) + (showOrigin(a) ? ' ' + teamBadge(a, true, false) : '') +
      (separator || ' — ') + esc(opponentLabel(m.b)) + (showOrigin(b) ? ' ' + teamBadge(b, true, false) : '');
  }
  function opponentLabel(ref) {
    const id = F.resolve(event, ref);
    return id ? teamIdentity(id) : typeof ref === 'string' ? teamIdentity(ref) :
      (ref.outcome === 'winner' ? tr('Siegreiches Team aus ', 'Winner ') : tr('Unterlegenes Team aus ', 'Loser ')) + ref.match;
  }
  function publicMatchContent(m, linked) {
    const opponents = '<span class="fc-public-team">' + esc(opponentLabel(m.a)) + '</span>' +
      '<span class="fc-public-team">' + esc(opponentLabel(m.b)) + '</span>';
    return '<div class="fc-public-card noprint"><p class="fc-fx-head"><strong>' + tr('Feld ', 'Court ') + m.field +
      '</strong><time class="fc-fx-meta">' + F.clock(m.startMin) + '</time></p>' +
      (linked ? '<p class="fc-public-context">' + (m.phase === 'group' ? esc(poolLabel(m.pool, false)) : tr('Baumphase', 'Bracket stage')) +
        (m.placement ? ' · ' + tr('Plätze ', 'Places ') + m.placement + '/' + (m.placement + 1) : '') + '</p>' :
        m.placement ? '<p class="fc-public-context">' + tr('Plätze ', 'Places ') + m.placement + '/' + (m.placement + 1) + '</p>' : '') +
      '<p class="fc-fx-teams">' + (linked ? '<a class="fc-public-match-link" href="#fc-match-' + esc(m.id) +
        '" data-focus-target="fc-match-' + esc(m.id) + '">' + opponents + '</a>' : opponents) + '</p>' +
      '<p class="fc-fx-result' + (!decided(m) ? ' fc-public-pending' : '') + '">' + resultText(m) + '</p>' +
      '<p class="fc-referee">' + refereeLabel(m, true) + '</p></div>';
  }
  function scoreNext(afterScore, compact) {
    const next = event.matches.filter(m => !decided(m)).sort((a, b) => a.wave - b.wave || a.field - b.field)[0];
    const start = afterScore && event.liveWave ? startableWave() : null;
    if (next && start != null && next.wave === start && F.waveReadiness(event, start).ready) {
      return '<a class="fc-link fc-link-secondary" href="#fc-wave-start-' + start + '" data-focus-target="fc-wave-start-' + start + '">' +
        tr('Spielrunde ' + (start + 1) + ' zentral starten', 'Start time slot ' + (start + 1) + ' centrally') + '</a>';
    }
    const target = next ? 'fc-match-' + next.id : event.status === 'groups' ? 'fc-finals' : 'fc-results-status';
    return '<a class="fc-link fc-link-secondary" href="#' + esc(target) + '" data-focus-target="' + esc(target) + '">' +
      (next ? tr('Nächstes offenes Spiel', 'Next pending match') + ' · ' +
        (next.phase === 'group' ? esc(poolLabel(next.pool, false)) : tr('Baumphase', 'Bracket stage')) +
        (compact ? '' : ' · ' + esc(next.id) + ' · ' + F.clock(next.startMin)) :
        event.status === 'groups' ? tr('Weiter: Endphase auslosen', 'Next: draw finals') :
          (resultsState().final ? tr('Endergebnis ansehen', 'View final results') : tr('Zwischenstand ansehen', 'View current standings'))) + '</a>';
  }
  function resultText(m) {
    const r = event.results[m.id], outcome = event.outcomes && event.outcomes[m.id];
    if (r) return '<strong>' + r.a + ':' + r.b + '</strong>' + (r.drawWinner ? ' · ' + tr('Per Los bestimmtes Team: ', 'Draw winner: ') + esc(teamName(r.drawWinner)) : '');
    if (outcome) return '<strong>' + tr(outcome.type === 'withdrawal' ? 'Rückzug' : 'Nichtantreten', outcome.type === 'withdrawal' ? 'Withdrawal' : 'Nonappearance') +
      '</strong> · ' + (outcome.winnerTeam ? tr('Ausdrücklich zugesprochener Sieg: ', 'Organizer-declared win: ') + esc(teamName(outcome.winnerTeam)) +
        ' · ' + tr('1 Sieg, keine Ballpunkte/kein fingierter Spielstand.', '1 win, no ball points or invented score.') :
        tr('Begegnung aufgehoben · keine Wertungspunkte und kein Spielstand.', 'Match void · no standings points and no score.'));
    return tr('Ergebnis offen', 'Result pending');
  }
  function fixture(m) {
    const r = event.results[m.id], a = F.resolve(event, m.a), b = F.resolve(event, m.b);
    const scoreTeam = id => esc(teamIdentity(id)) + ' ' + teamBadge(id, true, false);
    const outcome = event.outcomes && event.outcomes[m.id];
    const editable = !readOnly && !outcome && a && b && !(event.status === 'finals' && m.phase === 'group') && !F.hasPlayedDescendant(event, m.id);
    const absentHere = editable ? [a, b].find(id => isAbsent(id)) || null : null;
    const scoreLabel = (team, side) => esc(teamIdentity(team) + ' ' + poolLabel(teamPool(team), true)) + ' · ' + tr('Ballpunkte ', 'Ball points ') + side;
    return '<article class="fc-fixture' + (r || outcome ? ' fc-fixture-done' : '') + (editable ? ' fc-fixture-edit' : '') + '" id="fc-match-' + esc(m.id) +
      '" tabindex="-1" data-match="' + m.id + '">' + (readOnly ? publicMatchContent(m, false) : '') +
      '<p class="fc-fx-head' + (readOnly ? ' fc-print-only' : '') + '">' + (m.phase === 'group' ? '' : matchContext(m, false)) +
      '<strong>' + tr('Feld ', 'Court ') + m.field + '</strong><span class="fc-fx-meta"> · ' +
      F.clock(m.startMin) + '<span class="fc-fx-identifiers"> · <span class="fc-fx-wave">' + tr('Spielrunde ', 'Time slot ') + (m.wave + 1) + ' · </span>' + esc(m.id) +
      '</span>' + (m.placement ? ' · ' + tr('Plätze ', 'Places ') + m.placement + '/' + (m.placement + 1) : '') + '</span></p>' +
      '<p class="fc-referee' + (readOnly ? ' fc-print-only' : '') + '">' + refereeLabel(m) + '</p>' +
      '<p class="fc-fx-teams' + (editable || readOnly ? ' fc-print-only' : '') + '">' + matchLabel(m, null) + '</p>' +
      '<p class="fc-fx-result' + (readOnly ? ' fc-print-only' : '') + (!r && !outcome ? ' fc-print-pending-result' : editable && !(r && r.drawWinner) ? ' fc-print-only' : '') + '">' + resultText(m) + '</p>' +
      (!r && !outcome && a && b && !absentHere ? '<div class="fc-print-score" aria-label="' + tr('Leere Ballpunktfelder', 'Blank ball-point boxes') + '">' +
        '<div><span class="fc-print-score-name">' + scoreTeam(a) + '</span><span class="fc-print-score-label">' + tr('Ballpunkte', 'Ball points') +
        '</span><span class="fc-print-score-box" aria-hidden="true"></span></div><div><span class="fc-print-score-name">' + scoreTeam(b) +
        '</span><span class="fc-print-score-label">' + tr('Ballpunkte', 'Ball points') + '</span><span class="fc-print-score-box" aria-hidden="true"></span></div></div>' : '') +
      (!r && !outcome && absentHere ? '<p class="fc-print-only fc-paper-warning">' + tr('Turnierleitung entscheidet · keinen Spielstand eintragen.',
        'Organizer decision required · do not enter a score.') + '</p>' : '') +
      (editable ? '<form class="fc-result noprint" novalidate data-score="' + m.id + '" aria-describedby="fc-wave-score-guide-' + m.wave + '">' +
        '<label class="fc-score-row"><span class="fc-score-team">' + scoreTeam(a) + '</span><input name="a" type="number" inputmode="numeric" enterkeyhint="next" autocomplete="off" aria-describedby="fc-wave-score-guide-' + m.wave + ' fc-score-error-' + m.id + '" aria-label="' + scoreLabel(a, 'A') + '" min="0" max="999" step="1" required value="' + (r ? r.a : '') + '"></label>' +
        '<label class="fc-score-row"><span class="fc-score-team">' + scoreTeam(b) + '</span><input name="b" type="number" inputmode="numeric" enterkeyhint="done" autocomplete="off" aria-describedby="fc-wave-score-guide-' + m.wave + ' fc-score-error-' + m.id + '" aria-label="' + scoreLabel(b, 'B') + '" min="0" max="999" step="1" required value="' + (r ? r.b : '') + '"></label>' +
        (m.phase === 'cup' && F.tiePolicy(event) === 'draw' ? '<label class="fc-draw"' + (r && r.a === r.b ? '' : ' hidden') + '>' + tr('Remis im K.-o.: per Los bestimmtes Team wählen', 'Knockout tie: choose the lottery winner') + '<select name="drawWinner" aria-describedby="fc-wave-score-guide-' + m.wave + ' fc-score-error-' + m.id + '"><option value="">' + tr('Team wählen', 'Choose team') + '</option>' +
          options(event.teams.filter(t => t.id === a || t.id === b), r && r.drawWinner) + '</select></label>' : '') +
        '<p class="fc-score-error fc-error" id="fc-score-error-' + m.id + '" role="alert" hidden></p>' +
        '<button type="submit" class="fc-score-save">' + (r ? tr('Korrektur speichern', 'Save correction') : tr('Ergebnis speichern', 'Save score')) + '</button></form>' : '') +
      (!readOnly && m.phase === 'group' ? '<p class="noprint"><a class="fc-pool-matches" href="#fc-pool-' + m.pool + '" data-focus-target="fc-pool-' + m.pool + '">' +
        tr('Zur Gruppentabelle', 'View pool table') + '</a></p>' : '') +
      '<p class="fc-match-mode fc-print-only">' + matchModeSummary(m.phase) + '</p>' +
      (editable && !participant ? (!r && !outcome && absentHere ? '<p class="fc-warning">' + esc(teamName(absentHere)) +
          tr(' ist abwesend gemeldet. ', ' is reported absent. ') +
          '<a href="#fc-attendance-team-' + esc(absentHere) + '" data-focus-target="fc-attendance-team-' + esc(absentHere) + '">' +
          tr('Zur Teamkarte in Firmen & Teams', 'Go to its team card in Companies & teams') + '</a> · ' +
          tr('oder hier Nichtantreten entscheiden.', 'or decide a nonappearance here.') + '</p>' : '') +
        (!r && !outcome ? '<details class="fc-outcome noprint"><summary id="fc-outcome-' + esc(m.id) + '">' + tr('Nichtantreten oder Rückzug entscheiden', 'Record nonappearance or withdrawal') +
          '</summary><form data-outcome="' + esc(m.id) + '"><label>' + tr('Entscheidungsgrund', 'Decision reason') +
          '<select name="type"><option value="nonappearance">' + tr('Nichtantreten (nur diese Begegnung)', 'Nonappearance (this match only)') +
          '</option><option value="withdrawal">' + tr('Rückzug aus dem weiteren Wettbewerb', 'Withdrawal from remaining competition') + '</option></select></label>' +
          '<label>' + tr('Nicht angetretenes/zurückziehendes Team', 'Nonappearing/withdrawing team') +
          '<select name="absent" required><option value="">' + tr('Team wählen', 'Choose team') + '</option>' +
          options(event.teams.filter(t => t.id === a || t.id === b), absentHere) + '</select></label>' +
          '<label>' + tr('Ausdrückliche Wertung', 'Explicit decision') + (feedsLaterMatch(m) ?
            '<select name="winner" required data-feeds-later="1" aria-describedby="fc-outcome-feeds-' + esc(m.id) + '"><option value="">' +
            tr('Sieger wählen (Pflicht)', 'Choose winner (required)') + '</option>' :
            '<select name="winner"><option value="">' + tr('Begegnung aufheben · 0:0 Wertungspunkte', 'Void match · 0:0 standings points') + '</option>') +
          options(event.teams.filter(t => t.id === a || t.id === b), null) + '</select></label>' +
          (feedsLaterMatch(m) ? '<p class="fc-note" id="fc-outcome-feeds-' + esc(m.id) + '">' +
            tr('K.-o.-Spiel mit Folgespiel: Aufheben ohne Sieger ist nicht möglich; das gegnerische Team rückt weiter.', 'Knockout match with a follow-up fixture: voiding without a winner is not possible; the opposing team advances.') + '</p>' : '') +
          '<label>' + tr('Notiz für die Veranstaltungsleitung (optional)', 'Organizer note (optional)') +
          '<input name="note" maxlength="300"></label><button type="submit">' +
          tr('Entscheidung ohne erfundenen Spielstand speichern', 'Save decision without inventing a score') +
          '</button></form><p class="fc-note">' + decisionExplanation() + '</p></details>' : '') :
        (!readOnly && r ? '<p class="fc-note">' + tr('Ergebnis eingefroren (Finalauslosung / gespielte Folgerunde).', 'Result frozen (final draw / played downstream round).') + '</p>' : '')) +
      (!readOnly && r && lastScored === m.id ? '<p class="fc-score-next noprint">' + scoreNext(true) + '</p>' : '') + '</article>';
  }
  function waveGroup(wave) {
    const matches = event.matches.filter(m => m.wave === wave).sort((x, y) => x.field - y.field);
    const pending = matches.filter(m => !decided(m)).length;
    const live = event.liveWave && event.liveWave.wave === wave;
    const start = !readOnly && startableWave() === wave;
    const readiness = start ? F.waveReadiness(event, wave) : null;
    const state = live && pending ? tr('läuft seit ', 'running since ') + actualClock(event.liveWave.startedAt) :
      !pending ? tr('erfasst', 'recorded') :
        start && readiness.ready ? tr('startbereit', 'ready') :
          (matches.length - pending ? (matches.length - pending) + '/' + matches.length + ' ' + tr('erfasst', 'recorded') : tr('geplant', 'planned'));
    const stateClass = live && pending ? 'fc-wave-live' : !pending ? 'fc-wave-done' : start && readiness.ready ? 'fc-wave-ready' : 'fc-wave-planned';
    const defaultOpen = pending > 0 || matches.some(m => m.id === lastScored);
    const open = waveOpenOverride.has(wave) ? waveOpenOverride.get(wave) : defaultOpen;
    const pools = Array.from(new Set(matches.map(m => m.phase === 'group' ? m.pool : 'cup')));
    const grouped = pools.map(pool => {
      const items = matches.filter(m => (m.phase === 'group' ? m.pool : 'cup') === pool);
      const titleId = 'fc-wave-pool-' + wave + '-' + pool;
      return '<div class="fc-wave-pool" data-wave-pool="' + pool + '" role="group" aria-labelledby="' + titleId + '">' +
        '<h4 id="' + titleId + '">' + (pool === 'cup' ? tr('Baumphase', 'Bracket stage') : esc(poolLabel(pool, false))) +
        '</h4><div class="fc-pool-fixtures">' + items.map(fixture).join('') + '</div></div>';
    }).join('');
    return '<details class="fc-wave-group ' + stateClass + '" id="fc-wave-group-' + wave + '" data-wave="' + wave + '" data-default-open="' + (defaultOpen ? '1' : '0') + '"' + (open ? ' open' : '') + '>' +
      '<summary class="fc-wave-head"><span class="fc-wave-title">' + tr('Spielrunde ', 'Time slot ') + (wave + 1) + ' · ' + F.clock(matches[0].startMin) + '</span> ' +
      '<span class="fc-wave-state">' + state + '</span></summary>' +
      '<p class="fc-wave-context' + (readOnly ? ' fc-print-only' : '') + '">' +
      (start ? '<span class="fc-wave-actions noprint"><button type="button" id="fc-wave-start-' + wave + '" data-action="start-wave" data-wave="' + wave + '"' +
        (readiness.ready ? '' : ' disabled') + '>' + tr('Spielrunde ' + (wave + 1) + ' zentral starten', 'Start time slot ' + (wave + 1) + ' centrally') + '</button>' +
        (readiness.ready ? '' : '<span class="fc-note"> ' + tr('Noch nicht startbereit – siehe Turniertag oben.', 'Not ready yet – see event day above.') + '</span>') + '</span>' : '') +
      '<span class="fc-wave-mode">' + roundModeSummary(matches[0].phase) + '</span></p>' +
      '<div class="fc-wave-matches">' + grouped + '</div>' +
      '<p class="fc-wave-score-guide' + (readOnly ? ' fc-print-only' : '') + '" id="fc-wave-score-guide-' + wave + '">' + scoreEntryExplanation(matches) + '</p></details>';
  }
  function fixtures() {
    if (!event.matches.length) return '';
    const waves = Array.from(new Set(event.matches.map(m => m.wave))).sort((x, y) => x - y);
    return '<section id="fc-schedule" tabindex="-1"><div class="fc-schedule-head"><h2>' +
      (readOnly ? tr('Spiele & Schiridienste', 'Matches & referee duties') : tr('Spielplan & Ergebnisse', 'Fixtures & results')) + '</h2>' +
      '<details class="fc-score-help"><summary>' + tr('Regeln', 'Rules') + '</summary>' +
      '<p id="fc-score-guide" class="fc-note">' + tr('Tatsächliche Ballpunkte erfassen, keine Tabellenpunkte. ', 'Enter actual ball points, not standings points. ') +
      scoringExplanation() + ' ' + timingExplanation() + '</p></details></div>' +
      '<p id="fc-search-summary" class="noprint" role="status"></p>' +
      waves.map(waveGroup).join('') +
      '<p class="fc-print-row noprint">' + button('print', tr('Drucken (gesamter Plan)', 'Print (full schedule)')) + '</p></section>';
  }
  function searchPanel() {
    return '<section id="fc-search-panel" class="fc-toolbar noprint" aria-label="' + tr('Suche und nächstes offenes Spiel', 'Search and next pending match') + '">' +
      '<label class="fc-search-label"><span>' + tr('Team / Firma suchen', 'Find team / company') + '</span><input id="fc-search" type="search" autocomplete="off" placeholder="' +
      tr('Name eingeben', 'Enter name') + '" value="' + esc(searchQuery) + '" aria-controls="fc-team-overview fc-schedule" aria-describedby="fc-search-help"></label>' +
      '<label class="fc-group-filter"><span>' + tr('Spiele anzeigen', 'Show matches') + '</span><select id="fc-group-filter" aria-controls="fc-schedule">' +
      '<option value="">' + tr('Alle Gruppen & Baumphase', 'All pools & bracket stage') + '</option>' +
      event.pools.map((p, i) => {
        const pool = 'G' + (i + 1);
        return '<option value="' + pool + '"' + (groupFilter === pool ? ' selected' : '') + '>' + esc(poolLabel(pool, false)) + ' · ' + tr('Vorrunde', 'Group stage') + '</option>';
      }).join('') + '<option value="cup"' + (groupFilter === 'cup' ? ' selected' : '') + '>' + tr('Baumphase', 'Bracket stage') + '</option></select></label>' +
      '<button type="button" id="fc-filter-reset"' + (!groupFilter && !searchQuery.trim() ? ' hidden' : '') + '>' + tr('Filter zurücksetzen', 'Reset filters') + '</button>' +
      (!readOnly ? '<p class="fc-score-nav noprint">' + scoreNext(false, true) + '</p>' : '') +
      '<p id="fc-search-help" class="fc-note">' + tr('Suche: Gruppenverzeichnis und Spiele inkl. Schiridiensten. Gruppenfilter: nur Spielplan. Teamauswahl: nur Teamablauf.', 'Search: pool directory and fixtures including referee duties. Pool filter: fixtures only. Team selection: agenda only.') + '</p>' +
      '<div id="fc-next" role="status"></div></section>';
  }
  function refereeLabel(m, plain) {
    const mode = F.refereeMode(event);
    if (plain) return mode === 'teams' ? tr('Schiri-Team: ', 'Referee team: ') + esc(teamIdentity(m.refereeTeam)) :
      mode === 'none' ? tr('Ohne Schiri · selbst geleitet', 'No referee · self-officiated') : tr('Externer Schiri', 'External referee');
    return '<span class="fc-referee-duty fc-referee-duty-' + mode + '">' +
      '<span>' + (mode === 'teams' ? tr('Schiri-Team: ', 'Referee team: ') + '<strong>' + esc(teamIdentity(m.refereeTeam)) + '</strong>' :
        mode === 'none' ? tr('Ohne Schiri · selbst geleitet', 'No referee · self-officiated') : tr('Externer Schiri', 'External referee')) +
      '</span></span>';
  }
  function live() {
    if (!event.matches.length) return '';
    if (readOnly) return '<section id="fc-live" class="noprint"><h2>' + tr('Live', 'Live') +
      '</h2><p id="fc-countdown" role="timer"></p>' + currentWaveSummary() + '</section>';
    const waves = Array.from(new Set(event.matches.map(m => m.wave)));
    const selectedWave = nextWave();
    const completedWaves = event.matches.filter(m => event.results[m.id] || event.outcomes[m.id]).map(m => m.wave);
    const minimumReplan = Math.max(event.liveWave ? event.liveWave.wave + 1 :
      (completedWaves.length ? Math.max.apply(null, completedWaves) + 1 : 0),
      event.replans.length ? event.replans[event.replans.length - 1].fromWave : 0);
    const replanWaves = waves.filter(w => w >= minimumReplan &&
      event.matches.some(m => m.wave === w && !event.results[m.id] && !event.outcomes[m.id]));
    const canReplan = replanWaves.length > 0;
    return '<section id="fc-live" class="noprint"><h2>' + (readOnly ? tr('Aktuelle Spielrunde', 'Current time slot') : tr('Spielrunde manuell wählen & umplanen', 'Choose time slot manually & replan')) + '</h2>' +
      (!readOnly ? '<p class="fc-guide">' + tr('Die nächste Spielrunde direkt im Spielplan starten. Nur bei Bedarf hier eine Spielrunde gezielt wählen oder den Restplan umplanen.', 'Start the next time slot directly in the fixtures. Use these controls only to choose a specific time slot or replan the remaining schedule.') + '</p>' : '') +
      '<p class="fc-note">' + tr('Eine Spielrunde umfasst die gleichzeitigen Spiele auf allen Feldern. Gemeinsamer Start und reguläres Zeitende; erforderliche Führungsverlängerungen zuerst beenden, dann die nächste Runde starten. Ein optionaler Live-Link überträgt Start und Ergebnisse.', 'A time slot contains the simultaneous matches on all courts. Shared start and regular time limit; complete required first-lead overtime before starting the next slot. An optional live link synchronizes starts and results.') + '</p>' +
      (!readOnly ? '<label>' + tr('Spielrunde', 'Time slot') + '<select id="fc-wave">' + waves.map(w => '<option value="' + w + '"' + (w === selectedWave ? ' selected' : '') + '>' + (w + 1) + ' · ' + F.clock(event.matches.find(m => m.wave === w).startMin) + '</option>').join('') +
        '</select></label><button type="button" id="fc-start-wave" data-action="start-wave"' +
        (selectedWave == null || !F.waveReadiness(event, selectedWave).ready ? ' disabled' : '') + '>' +
        tr('Jetzt zentral starten', 'Start centrally now') + '</button>' +
        (canReplan ? '<details id="fc-replan"><summary>' + tr('Verzögerung oder Feldschließung: Restplan umplanen', 'Delay or court closure: replan remaining schedule') +
          '</summary><p>' + tr('Nur ungestartete Begegnungen werden neu eingeplant. Gespielte Resultate und tatsächlich gestartete Spielrunden bleiben erhalten; alle verfügbaren Felder, Begegnungen, Schiedsrichter:innen und Ruhezeiten werden auf Konflikte geprüft.', 'Only unstarted fixtures are rescheduled. Played results and started time slots remain unchanged; court bookings, team conflicts, referees and rest intervals are checked.') + '</p>' +
          '<label>' + tr('Ab Spielrunde', 'From time slot') + '<select id="fc-replan-wave">' + replanWaves.map(w =>
            '<option value="' + w + '">' + (w + 1) + ' · ' + F.clock(event.matches.find(m => m.wave === w).startMin) + '</option>').join('') + '</select></label>' +
          '<label>' + tr('Verzögerung (Minuten)', 'Delay (minutes)') + '<input id="fc-replan-delay" type="number" min="0" max="1440" value="0"></label>' +
          '<label>' + tr('Ab jetzt verfügbare Felder', 'Fields available from then on') + '<input id="fc-replan-fields" type="number" min="1" max="' + F.courtCapacity(event) + '" value="' + event.fieldLimit + '"></label>' +
          '<label>' + tr('Grund (wird protokolliert)', 'Reason (recorded in audit)') + '<input id="fc-replan-reason" maxlength="200" required value="' + tr('Verzögerung/Feldschließung', 'Delay/court closure') + '"></label>' +
          button('replan', tr('Umplanung prüfen & bestätigen', 'Review and confirm replan')) +
          (event.replans.length ? '<details><summary>' + tr('Bisherige Umplanungen (' + event.replans.length + ')', 'Previous replans (' + event.replans.length + ')') +
            '</summary>' + event.replans.map(r => '<p>' + tr('Ab Spielrunde ', 'From time slot ') + (r.fromWave + 1) + ' · +' + r.delayMinutes + ' ' +
              tr('Min. · ', 'min · ') + r.fields + ' ' + tr('Felder · ', 'fields · ') + esc(r.reason) + ' · ' +
              esc(new Date(r.at).toLocaleString(en ? 'en-GB' : 'de-DE')) + '</p>').join('') + '</details>' : '') +
          '</details>' : '') : '') +
      (readOnly ? currentWaveSummary() + '<p id="fc-countdown" role="timer"></p>' : '') + '</section>';
  }
  function configurationActions() {
    return '<section id="fc-config-actions" class="noprint" tabindex="-1" aria-labelledby="fc-config-actions-title">' +
      (event.startedAt ? '<div>' + button('restart-edit', tr('Gesperrte Regeln in neuer Kopie bearbeiten', 'Edit locked rules in a new copy')) + '</div>' : '') +
      '<details id="fc-reset-options"><summary id="fc-config-actions-title">' + tr('Zurücksetzen', 'Reset options') + '</summary>' +
      (!event.startedAt && event.matches.length ? '<div class="fc-reset-choice">' +
        button('reopen', tr('Spielplan entfernen · Teams behalten', 'Remove schedule · keep teams')) + '</div>' : '') +
      '<p class="fc-note">' + tr('Die folgenden beiden Aktionen erstellen eine neue lokale Kopie ohne Livefreigabe. Original, Live-Stand und bisherige Sicherungen bleiben unverändert. Firmen, Teams, Namen und Anwesenheit bleiben erhalten.',
        'The following two actions create a new local copy without live sharing. The original, live event and existing backups stay unchanged. Companies, teams, names and attendance are retained.') + '</p>' +
      '<div class="fc-reset-choice">' + button('reset-points', tr('Turnierstand zurücksetzen', 'Reset tournament progress'), 'fc-reset-progress-help') +
      '<p id="fc-reset-progress-help" class="fc-note">' + tr('Regeln behalten; Ergebnisse und Turnierfortschritt samt Protokollen entfernen. Vorhandene Vorrunde neu planen, sonst ohne Plan beginnen.',
        'Keep rules; clear results, tournament progress and audit logs. Rebuild an existing group schedule, otherwise start without a schedule.') + '</p></div>' +
      '<div class="fc-reset-choice">' + button('reset-config', tr('Regeln auf Standardwerte', 'Restore default rules'), 'fc-reset-rules-help') +
      '<p id="fc-reset-rules-help" class="fc-note">' + tr('Regeln auf Startwerte setzen; neuer Konfigurationsentwurf ohne Spielplan, Ergebnisse oder Ablaufprotokolle.',
        'Restore starting rules; new configuration draft without schedule, results or operational logs.') + '</p></div></details></section>';
  }
  async function restartConfiguration(kind) {
    if (readOnly || participant) throw new Error('Read-only / Nur Lesen');
    if (hasUnsavedSetup()) {
      notify(tr('Ungespeicherte Eingaben zuerst speichern oder korrigieren. Es wurde nichts zurückgesetzt.', 'Save or correct unsaved inputs first. Nothing was reset.'), true);
      return;
    }
    const resetConfig = kind === 'reset-config', pointsOnly = kind === 'reset-points';
    const origin = event;
    const text = resetConfig ?
      tr('Regeln auf Standardwerte setzen? 13:00–19:00, einheitlich 14 Minuten Spielzeit, alle Plätze ausspielen, 3 Minuten Wechsel, 8 Felder, Team-Schiris, mindestens 1 spielfreie Runde, Team-/Siegwertung, erste Führung.',
        'Restore default rules? 13:00–19:00, uniform 14 match minutes, play all places, 3 changeover minutes, 8 courts, team referees, minimum 1 non-playing slot, team/win standings, first lead.') :
      pointsOnly ? tr('Turnierstand einschließlich Ergebnissen, Entscheidungen und Ablaufprotokollen zurücksetzen; gewählte Regeln behalten?', 'Reset tournament progress including results, decisions and operational logs; keep selected rules?') :
        tr('Gesperrte Konfiguration in einer neuen lokalen Kopie bearbeiten?', 'Edit locked configuration in a new local copy?');
    if (!confirm(text + '\n' + tr('Neue lokale Kopie ohne Serverbindung. Original, bisherige Sicherungen und andere Turniere bleiben unverändert. Firmen, Teams, Namen, Titel und Anwesenheit bleiben erhalten. Ergebnisse, Entscheidungen, Rückzüge, Endrunde, Los-/Umplanungs-/Wechselprotokolle und Startzeiten werden in der Kopie entfernt. ',
      'New local copy without a server binding. Original, previous backups and other events remain unchanged. Companies, teams, names, title and attendance are retained. Results, decisions, withdrawals, finals, draw/replanning/transfer logs and start times are removed in the copy. ') +
      (pointsOnly && origin.matches.length ? tr('Die Vorrunde wird mit den bisherigen Regeln neu geplant.', 'The group stage is rebuilt using the existing rules.') :
        tr('Die Kopie startet ohne Spielplan.', 'The copy starts without a schedule.')))) return;
    let next = F.create(uid(), origin.title, resetConfig ? defaults : origin.config,
      origin.teams, origin.organizations);
    if (origin.groupNames) next.groupNames = F.clone(origin.groupNames);
    next.checkIns = F.clone(origin.checkIns || {});
    if (!resetConfig) next.groupAssignments = F.clone(origin.groupAssignments);
    if (pointsOnly && origin.matches.length) next = F.build(next);
    const saved = await Store.fork(origin, next);
    event = saved;
    binding = null; setupSettingsDraft = null;
    lastScored = null; toolsReturn = null; phase = pointsOnly && event.matches.length ? 'play' : 'configuration';
    waveOpenOverride.clear();
    history.replaceState(null, '', 'Firmencup.html?local=' + encodeURIComponent(event.id) + '&lang=' + (en ? 'en' : 'de'));
    render(false);
    const target = phase === 'configuration' ? app.querySelector('#fc-edit [name="title"]') :
      document.getElementById('fc-phase-' + phase + '-heading');
    if (target) target.focus();
    notify(tr('Neue lokale Kopie erstellt; Original unverändert. Nicht live freigegeben.', 'New local copy created; original unchanged. Not shared live.'), false, true);
  }
  function publicSharing(published) {
    const active = published && binding.access && binding.access.publicRead;
    return '<fieldset id="fc-public-sharing" class="fc-share-group"><legend>' +
      tr('Öffentlich · nur ansehen', 'Public · view only') + '</legend>' +
      '<p class="fc-note">' + tr('Jede Person mit dem Link oder QR-Code kann den Turnierstand ansehen: eigene Spiele und Ergebnisse sowie die Gesamtwertung. Nach der Freigabe werden gespeicherte Änderungen automatisch mit dem Server synchronisiert; bei Verbindungsfehlern bleiben sie lokal erhalten und werden erneut übertragen. Die Ansicht aktualisiert sich bei Verbindung automatisch; keine Bearbeitung.',
        'Anyone with the link or QR code can view the event: their matches and results plus overall standings. After sharing, saved changes automatically sync to the server; connection failures retain them locally for retry. The view refreshes automatically when connected; no editing.') + '</p>' +
      (!published ? '<p class="fc-note">' + tr('Der komplette Turnierstand wird auf dem Server gespeichert. Spieler:innen-Namen und Anwesenheit bleiben privat.',
        'The full event is saved on the server. Player names and attendance remain private.') + '</p>' +
        '<label class="fc-share-consent"><input id="fc-share-consent" type="checkbox"> ' +
        tr('Ich bestätige die Live-Speicherung auf dem Server.', 'I confirm live saving on the server.') + '</label>' : '') +
      (!active ? '<label class="fc-share-consent"><input id="fc-public-consent" type="checkbox"> ' +
        tr('Ich bestätige: Jede Person mit dem Link oder QR-Code darf Team-/Firmennamen, Spielplan und Ergebnisse ansehen. Spieler:innen-Namen und Anwesenheit bleiben privat.',
          'I confirm: anyone with the link or QR code may view team/company names, fixtures and results. Player names and attendance remain private.') + '</label>' : '') +
      (active ? '<div id="fc-share-output">' +
        shareUrlField('fc-share-url', tr('Öffentlicher Live-Link', 'Public live link'),
          Server.publicUrl(binding.id, location.href, en ? 'en' : 'de')) +
        (typeof navigator.share === 'function' ? button('send-public-link', tr('Link senden …', 'Send link …')) : '') +
        '<p class="fc-note">' + tr('Link kopieren und z. B. per WhatsApp, SMS oder E-Mail senden. „Link senden“ öffnet auf unterstützten Geräten die App-Auswahl. Alternativ den QR-Code scannen oder als Bild herunterladen.',
          'Copy the link and send it via WhatsApp, SMS or email, for example. “Send link” opens the app chooser on supported devices. Alternatively scan the QR code or download it as an image.') + '</p>' +
        '<div id="fc-qr"></div><p id="fc-qr-note" class="fc-note" role="status">' +
        tr('QR-Code zum öffentlichen Live-Link.', 'QR code for the public live link.') + '</p></div>' : '') +
      (published && binding && binding.access && binding.access.participantEnabled ? '<p class="fc-note">' +
        tr('Ein älterer Teilnehmer:innen-Link ist noch aktiv. Er bleibt nur lesbar und ist unabhängig von der öffentlichen Freigabe.',
          'An older participant link is still active. It remains read-only and independent from public access.') + '</p>' +
        button('revoke-participant', tr('Teilnehmer:innen-Link widerrufen', 'Revoke participant link')) : '') +
      button(published ? 'toggle-public' : 'share', active ?
        tr('Öffentliche Freigabe beenden', 'Stop public access') :
        tr('Öffentlichen Live-Link + QR erstellen', 'Create public live link + QR')) + '</fieldset>';
  }
  function tools() {
    const published = !!(binding && binding.id);
    const status = !binding ? tr('Nur auf diesem Gerät gespeichert.', 'Saved on this device only.') :
      binding.conflict ? tr('Konflikt: Serverrevision ' + (binding.remoteRevision || '?') + ' ist neuer. Der lokale Entwurf bleibt erhalten und wird nicht überschrieben.', 'Conflict: server revision ' + (binding.remoteRevision || '?') + ' is newer. The local draft is retained and will not be overwritten.') :
          binding.pending ? tr('Noch nicht mit dem Server synchronisiert. Wird bei Verbindung erneut versucht.', 'Not synced with the server yet. Will retry when connected.') :
            binding.pendingSharing ? tr('Link-Änderung noch nicht bestätigt. Erneut versuchen.', 'Link change not confirmed yet. Try again.') :
            tr('Live gespeichert. Änderungen werden synchronisiert; Bearbeitungsrecht bleibt auf diesem Gerät.', 'Live saved. Changes are synced; editing access stays on this device.');
    return '<section id="fc-tools" class="noprint">' +
        publicSharing(published) +
        '<h3>' + tr('Sicherung', 'Backup') + '</h3>' +
        button('backup', tr('Eigene JSON-Sicherung herunterladen', 'Download own JSON backup')) +
        (binding && binding.role === 'admin' ? button('admin-logout', tr('Adminzugriff sperren', 'Lock admin access')) : '') +
        '<p class="fc-note">' + tr('Firmencup-Daten gehören nicht zur allgemeinen Bogen-Sicherung. Eigene Datei enthält die Namen der Spieler:innen; privat aufbewahren. Vorheriger gespeicherter Stand liegt zusätzlich auf diesem Gerät vor.', 'Firmencup records are not included in general sheet backups. Your own file includes player names; keep it private. The previous saved revision is also held on this device.') + '</p>' +
        button('previous', tr('Vorherigen Stand als neue Veranstaltung kopieren', 'Copy previous snapshot as new event')) +
        '<h3>' + tr('Live-Speicherung', 'Live saving') + '</h3><p id="fc-server-status" class="fc-note" role="status">' + esc(status) + '</p>' +
        (published ? '<fieldset class="fc-share-group"><legend>' + tr('Live-Speicherung', 'Live saving') + '</legend>' +
        '<p class="fc-note">' + tr('Der komplette Turnierstand wird gespeichert. Namen und Anwesenheit sind nicht öffentlich sichtbar.', 'The full event is saved. Names and attendance are not visible publicly.') + '</p>' +
        '<label class="fc-share-consent"><input id="fc-share-consent" type="checkbox"> ' +
        tr('Ich bestätige die Live-Speicherung auf dem Server.', 'I confirm live saving on the server.') + '</label>' +
        button('share', tr('Live-Speicherung aktualisieren', 'Update live saving')) + '</fieldset>' : '') +
        (published ? '<h3>' + tr('Adminzugang', 'Admin access') + '</h3>' +
          '<fieldset class="fc-share-group"><legend>' + tr('Admins · Turnier bearbeiten', 'Admins · edit event') + '</legend>' +
          '<p class="fc-note">' + tr('Voller Zugriff: Link und Passwort separat teilen. Gilt 7 Tage; neue Zugangsdaten melden alle Admins ab.', 'Full access: share the link and password separately. Lasts 7 days; new credentials sign out all admins.') + '</p>' +
          (binding.access && binding.access.adminEnabled && binding.adminShareToken ?
            shareUrlField('fc-admin-url', tr('Adminlink', 'Admin link'),
              Server.adminUrl(binding.id, binding.adminShareToken, location.href, en ? 'en' : 'de')) :
            '<p class="fc-note">' + tr('Kein aktiver Adminlink.', 'No active admin link.') + '</p>') +
          '<form id="fc-admin-share-form"><label>' + tr('Neues Passwort (mindestens 10 Zeichen)', 'New password (at least 10 characters)') +
          '<input name="password" type="password" minlength="10" required autocomplete="new-password"></label><button type="submit">' +
          (binding.access && binding.access.adminEnabled ? tr('Adminzugang erneuern', 'Renew admin access') : tr('Adminzugang einrichten', 'Set up admin access')) +
          '</button></form>' +
          (binding.adminShareToken ? button('revoke-admin', tr('Adminzugang widerrufen', 'Revoke admin access')) : '') +
          '</fieldset>' : '') +
        (binding && binding.conflict ? '<p class="fc-warning">' + tr('Serverladen sichert den lokalen Entwurf zuerst als unabhängige Veranstaltung.', 'Loading the server first saves the local draft as an independent event.') + '</p>' +
        button('server-reload', tr('Serverstand laden (lokalen Entwurf kopieren)', 'Load server (fork local draft)')) : '') +
      '</section>';
  }
  function renderServerLinks() {
    if (!binding || !binding.id || !document.getElementById('fc-qr')) return;
    const url = Server.publicUrl(binding.id, location.href, en ? 'en' : 'de');
    const qrHost = document.getElementById('fc-qr'), note = document.getElementById('fc-qr-note');
    try {
      const qr = window.qrcode(0, 'L'); qr.addData(url); qr.make();
      const canvas = document.createElement('canvas'), modules = qr.getModuleCount(), cell = 4, margin = cell * 4;
      canvas.width = canvas.height = modules * cell + margin * 2;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('QR image unavailable / QR-Bild nicht verfügbar');
      context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = '#000';
      for (let row = 0; row < modules; row++) {
        for (let col = 0; col < modules; col++) {
          if (qr.isDark(row, col)) context.fillRect(margin + col * cell, margin + row * cell, cell, cell);
        }
      }
      const img = document.createElement('img'); img.src = canvas.toDataURL('image/png');
      img.alt = tr('QR zum Live-Nur-Lesen-Link', 'QR to the live read-only link');
      const enlarge = document.createElement('button');
      enlarge.type = 'button'; enlarge.id = 'fc-qr-enlarge';
      enlarge.setAttribute('aria-label', tr('QR-Code groß anzeigen', 'Enlarge QR code'));
      enlarge.setAttribute('aria-haspopup', 'dialog');
      enlarge.appendChild(img);
      enlarge.onclick = () => openQrPopup(img.src, enlarge);
      qrHost.appendChild(enlarge);
      const downloadQr = document.createElement('a');
      downloadQr.id = 'fc-qr-download'; downloadQr.href = img.src;
      downloadQr.download = 'firmencup-qr.png';
      downloadQr.textContent = tr('QR-Code herunterladen', 'Download QR code');
      qrHost.appendChild(downloadQr);
    } catch (error) {
      console.error('Firmencup QR:', error);
      note.textContent = tr('QR konnte nicht erzeugt werden; der Nur-Lesen-Link kann kopiert werden.', 'Could not create QR; copy the read-only link instead.');
    }
  }
  function openQrPopup(src, opener) {
    if (document.getElementById('fc-qr-popup')) return;
    const overlay = document.createElement('div');
    overlay.id = 'fc-qr-popup'; overlay.className = 'fc-qr-backdrop noprint';
    overlay.innerHTML = '<section class="fc-qr-dialog" role="dialog" aria-modal="true" aria-labelledby="fc-qr-title" tabindex="-1">' +
      '<h2 id="fc-qr-title">' + tr('Firmencup · Live-QR-Code', 'Company cup · live QR code') + '</h2>' +
      '<img alt="' + esc(tr('QR zum Live-Nur-Lesen-Link', 'QR to the live read-only link')) + '">' +
      '<p>' + tr('Scannen, um Spielplan und Ergebnisse live anzusehen.', 'Scan to view live fixtures and results.') + '</p></section>';
    const panel = overlay.firstElementChild;
    panel.querySelector('img').src = src;
    const hidden = Array.from(document.body.children).filter(node =>
      node.tagName !== 'SCRIPT' && node.tagName !== 'STYLE' && !node.hasAttribute('aria-hidden'));
    const overflow = document.body.style.overflow;
    hidden.forEach(node => node.setAttribute('aria-hidden', 'true'));
    document.body.style.overflow = 'hidden';
    function close() {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('focusin', onFocus);
      overlay.remove();
      hidden.forEach(node => node.removeAttribute('aria-hidden'));
      document.body.style.overflow = overflow;
      if (opener.isConnected) opener.focus();
      else {
        const current = document.getElementById('fc-qr-enlarge');
        if (current) current.focus();
      }
    }
    const closeButton = TNative.mountClose(panel, tr('Schließen', 'Close'), close);
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if (e.key === 'Tab') { e.preventDefault(); closeButton.focus(); }
    }
    function onFocus(e) {
      if (!overlay.contains(e.target)) closeButton.focus();
    }
    overlay.onclick = e => { if (e.target === overlay) close(); };
    document.body.appendChild(overlay);
    document.addEventListener('keydown', onKey);
    document.addEventListener('focusin', onFocus);
    panel.focus();
  }
  async function reloadServerConflict() {
    if (!binding || !binding.id) throw new Error(tr('Kein verbundener Serverstand.', 'No connected server event.'));
    if (!confirm(tr('Der ungesicherte lokale Stand wird zuerst als unabhängige Veranstaltung kopiert. Danach ersetzt der aktuelle Serverstand diese Ansicht.', 'The unsynchronized local draft will first be copied as an independent event. The current server version will then replace this view.'))) return;
    const draft = F.clone(event);
    draft.id = uid(); draft.revision = 0;
    draft.title = String(draft.title + tr(' · lokale Kopie', ' · local copy')).slice(0, 120);
    await Store.save(F.validate(draft));
    const remote = await Server.get(binding.id, binding.token);
    if (!remote.canEdit) throw new Error(tr('Bearbeitungsrecht fehlt.', 'Editor capability missing.'));
    const replacement = F.clone(remote.event);
    replacement.revision = 0;
    event = await Store.replace(F.validate(replacement));
    binding = await Server.adopt(event.id, binding.id, binding.token, remote.revision, event);
    history.replaceState(null, '', '?local=' + encodeURIComponent(event.id) + '&lang=' + (en ? 'en' : 'de'));
    render();
    notify(tr('Serverstand geladen. Der lokale Entwurf bleibt als unabhängige Kopie erhalten.', 'Server version loaded. The local draft remains as an independent copy.'));
  }
  async function pollPublic() {
    if (!livePublic || document.visibilityState === 'hidden' || busy || pollingPublic) return;
    pollingPublic = true;
    try {
      const remote = await Server.get(params.get('eventId'), null, liveEtag);
      if (remote.notModified) return;
      if (remote.canEdit || !remote.event || remote.event.id !== event.id) throw new Error('Invalid public event response / Ungültige öffentliche Veranstaltungsantwort');
      const incoming = F.validate(remote.event, { publicSnapshot: true });
      if (remote.revision === liveRevision) { liveEtag = remote.etag; return; }
      if (Number.isInteger(liveRevision) && remote.revision <= liveRevision) return;
      event = incoming;
      liveRevision = remote.revision;
      liveEtag = remote.etag;
      render();
      notify(tr('Live-Stand aktualisiert · Serverrevision ', 'Live event refreshed · server revision ') + liveRevision);
    } catch (error) {
      console.error('Firmencup public refresh:', error);
      notify(tr('Live-Ansicht zeigt den letzten geladenen Stand; Aktualisierung fehlgeschlagen: ', 'Live view shows the last loaded state; refresh failed: ') + error.message, true);
    } finally {
      pollingPublic = false;
    }
  }
  async function pollEditor() {
    if (!event || (readOnly && !participant) || document.visibilityState === 'hidden' || busy || hasUnsavedSetup()) return;
    const polledEvent = event;
    try {
      binding = await Server.load(event.id);
      if (participant && binding && binding.id) {
        if (binding.pending || binding.pendingSharing || Server.fingerprint(event) !== binding.syncedFingerprint) {
          throw new Error(tr('Alte lokale Änderungen können mit dem Nur-Lesen-Link nicht übertragen werden. Der lokale Stand bleibt erhalten.',
            'Earlier local changes cannot be sent with a read-only link. The local state is retained.'));
        }
        const remote = await Server.get(binding.id, binding.token);
        if (event !== polledEvent || busy) return;
        if (remote.role !== 'participant' || remote.canScore || remote.canEdit) {
          throw new Error(tr('Ungültige Teilnehmerberechtigung.', 'Invalid participant permission.'));
        }
        if (remote.revision <= binding.revision) return;
        const replacement = F.validate(remote.event, { publicSnapshot: true });
        replacement.revision = 0;
        event = await Store.replace(replacement, { publicSnapshot: true, expectedRevision: polledEvent.revision });
        binding = await Server.adopt(event.id, binding.id, binding.token, remote.revision, event, 'participant');
        render();
        notify(tr('Live-Stand aktualisiert · Revision ', 'Live state updated · revision ') + remote.revision);
        return;
      }
      if (!binding || !binding.id || binding.conflict) return;
      const retryingSharing = !!binding.pendingSharing;
      await resumeSharing();
      if (binding.role === 'admin' && !binding.token) {
        event = null;
        adminUnlock(binding.id, binding.adminShareToken, binding);
        notify(tr('Adminsitzung abgelaufen. Erneut entsperren.', 'Admin session expired. Unlock again.'), true);
        return;
      }
      if (retryingSharing && !binding.pendingSharing) render();
      const retrying = !!binding.pending;
      try {
        binding = await Server.sync(event);
        if (retrying) notify(tr('Mit dem Server synchronisiert.', 'Synchronized with the server.'), false, true);
      }
      catch (error) {
        binding = await Server.load(event.id);
        if (error.status === 412 || binding && binding.conflict) {
          render();
          notify(tr('Serverkonflikt: Der lokale Entwurf bleibt erhalten. Serverladen sichert ihn zuerst als Kopie.', 'Server conflict: the local draft is retained. Loading the server first saves it as a copy.'), true);
          return;
        }
        if (error.code === 'network') return;
        throw error;
      }
      if (binding.role === 'admin' && !binding.token) {
        event = null;
        adminUnlock(binding.id, binding.adminShareToken, binding);
        return;
      }
      const remote = await Server.get(binding.id, binding.token, '"' + binding.revision + '"');
      if (event !== polledEvent || busy || hasUnsavedSetup()) return;
      if (remote.notModified || remote.revision <= binding.revision) return;
      if (Server.fingerprint(event) === binding.syncedFingerprint) {
        const replacement = F.clone(remote.event);
        replacement.revision = 0;
        event = await Store.replace(F.validate(replacement), { expectedRevision: polledEvent.revision });
        binding = await Server.adopt(event.id, binding.id, binding.token, remote.revision, event);
        render();
        notify(tr('Änderungen eines anderen Geräts übernommen · Revision ', 'Changes from another device loaded · revision ') + remote.revision);
      } else {
        binding = await Server.markConflict(binding, remote.revision, 'revision_conflict');
        render();
        notify(tr('Serverstand geändert. Lokaler Entwurf bleibt erhalten; vor dem Fortfahren vergleichen.', 'Server changed. Local draft retained; compare before continuing.'), true);
      }
    } catch (error) {
      console.error('Firmencup editor refresh:', error);
      if (error.status === 403 && binding && binding.role === 'admin') {
        event = null;
        adminUnlock(binding.id, binding.adminShareToken, binding);
      }
      notify(error.message, true);
    }
  }
  async function resumeSharing() {
    if (!binding || !binding.pendingSharing) return;
    try { await Server.retrySharing(binding); }
    catch (error) {
      if (error.code !== 'network' && error.code !== 'invalid_password' && error.status !== 403) throw error;
    }
  }
  async function saveSharing(settings) {
    await Server.sharing(binding, settings);
    if (binding.role === 'admin' && !binding.token) {
      event = null;
      adminUnlock(binding.id, binding.adminShareToken, binding);
    } else render();
  }
  function adminUnlock(serverId, shareToken, localBinding) {
    app.innerHTML = '<form id="fc-admin-unlock"><h2>' + tr('Adminzugriff entsperren', 'Unlock admin access') +
      '</h2><label>' + tr('Passwort', 'Password') + '<input id="fc-admin-password" type="password" autocomplete="current-password" required></label>' +
      '<button type="submit">' + tr('Entsperren', 'Unlock') + '</button></form>';
    app.querySelector('form').onsubmit = ev => {
      ev.preventDefault();
      action(async function () {
        const password = document.getElementById('fc-admin-password');
        const session = await Server.unlock(serverId, shareToken, password.value);
        password.value = '';
        if (localBinding) {
          await Server.reauthorize(localBinding, session.sessionToken, session.expiresAt);
          if (localBinding.pending) await Server.sync(await Store.load(localBinding.localId));
        }
        await openAccess(serverId, session.sessionToken, 'admin', session.expiresAt, shareToken);
      });
    };
  }
  async function openAccess(serverId, token, role, expiresAt, shareToken) {
    const remote = await Server.get(serverId, token);
    if (role === 'participant' ?
        remote.role !== 'participant' || remote.canScore || remote.canEdit :
        !remote.canEdit) {
      throw new Error(tr('Berechtigung fehlt oder wurde widerrufen.', 'Permission missing or revoked.'));
    }
    const incoming = F.validate(remote.event, { publicSnapshot: role === 'participant' });
    const existing = await Store.load(incoming.id);
    if (existing && Server.fingerprint(existing) !== Server.fingerprint(incoming)) {
      const previous = await Server.load(incoming.id);
      if (previous && previous.pending) throw new Error(tr('Lokaler Entwurf wartet auf Synchronisation. Zuerst den lokalen Stand öffnen.', 'Local draft awaits synchronization. Open the local event first.'));
      if (!previous || previous.id !== serverId || previous.role !== role) {
        const copy = F.clone(existing); copy.id = uid(); copy.revision = 0;
        await Store.save(F.validate(copy));
      }
    }
    incoming.revision = 0;
    const options = { publicSnapshot: role === 'participant' };
    event = existing ? await Store.replace(incoming, options) : await Store.save(incoming, options);
    binding = await Server.adopt(event.id, serverId, token, remote.revision, event, role, expiresAt, shareToken);
    binding = await Server.rememberAccess(binding, remote.access);
    participant = role === 'participant'; readOnly = participant;
    const team = participant && event.teams.some(item => item.id === overviewTeam) ? overviewTeam : '';
    history.replaceState(null, '', '?local=' + encodeURIComponent(event.id) + '&lang=' + (en ? 'en' : 'de') +
      (team ? '&team=' + encodeURIComponent(team) : ''));
    render();
    notify(tr('Zugriff geladen.', 'Access loaded.'), false, true);
  }
  function render(preserveEdits) {
    const pending = preserveEdits !== false && hasUnsavedSetup() ? editorFields() : null;
    const focus = pending && editorFocus();
    const active = readOnly && document.activeElement && app.contains(document.activeElement) ? {
      id: document.activeElement.id,
      phase: document.activeElement.dataset.phase,
      start: document.activeElement.selectionStart,
      end: document.activeElement.selectionEnd
    } : null;
    const expandedCompanies = Array.from(app.querySelectorAll('.fc-company-teams[open]')).map(node => node.parentElement.dataset.company);
    const expandedRosters = Array.from(app.querySelectorAll('.fc-roster-details[open]')).map(node => node.dataset.rosterTeam);
    orgOpen = !!app.querySelector('#fc-org[open]');
    if (overviewTeam && !event.teams.some(team => team.id === overviewTeam)) overviewTeam = '';
    identity(event.title);
    document.body.classList.toggle('fc-read-only', readOnly);
    eventHeader();
    if (!phase) phase = (event.matches.length || readOnly) ? 'play' : 'teams';
    const accessState = participant ? tr('Teilnehmer:innen · nur lesen', 'Participants · read-only') : readOnly ? tr('Öffentliche Ansicht · nur lesen', 'Public view · read-only') :
      (binding && binding.id ? tr('Mehrgeräte-Turnierleitung · Serverrevision ' + binding.revision, 'Multi-device organizer · server revision ' + binding.revision) : '');
    app.innerHTML = (accessState ? '<p class="fc-access-state"><strong>' + accessState +
      (livePublic ? ' · ' + tr('Live · Serverrevision ' + liveRevision, 'Live · server revision ' + liveRevision) : '') + '</strong></p>' : '') +
      (readOnly ? '<p class="fc-privacy">' +
        tr('Nur lesen · Spieler:innen-Namen und Anwesenheit bleiben privat.', 'Read-only · player names and attendance stay private.') + '</p>' :
        editor()) +
      rules() + (readOnly ? capacity() : '') + cockpit() + (readOnly ? live() : organization()) +
      (readOnly ? resultsFilterPanel() + teamOverview() : teamOverview() + searchPanel() + resultsFilterPanel()) +
      printInstructions() + resultsStatus() + poolsHtml() + standingsHtml() + fixtures() +
      (!readOnly ? groupBreakdown('teams') + groupBreakdown('configuration') : '') +
      (!readOnly && event.status === 'groups' ? '<section id="fc-finals" class="noprint" tabindex="-1">' +
        '<p>' + tr('Alle Gruppenergebnisse fertig? Finale ausdrücklich auslosen: Restgleichstände werden mit einem kryptografisch zufälligen, gespeicherten Losprotokoll aufgelöst. Danach sind Gruppenergebnisse eingefroren.', 'All group results complete? Explicitly draw finals: unresolved ties use a cryptographically randomized, saved draw record. Group scores are then frozen.') + '</p>' +
        button('finals', tr('Endphase auslosen & planen', 'Draw & schedule finals')) + '</section>' : '') +
      (event.drawOrder.length ? '<details id="fc-draw-record"><summary>' + tr('Losprotokoll der Finalsetzung', 'Final seeding draw record') + '</summary><p>' +
        event.drawOrder.map(id => esc(teamName(id)) + ' (' + esc(id) + ') ' + teamBadge(id, true, true)).join(' → ') + '</p></details>' : '') +
      (!readOnly ? tools() + configurationActions() : '');
    groupTeamEditors(expandedCompanies, expandedRosters);
    arrangePhases();
    updateStatusAction();
    bind(); updateCountdown(); renderServerLinks();
    editorBaseline = JSON.stringify(editorFields());
    if (pending) restoreEditor(pending, focus);
    updateSaveButtons();
    followAnchor();
    if (active) {
      const node = active.id ? document.getElementById(active.id) :
        app.querySelector('.fc-phases [data-phase="' + active.phase + '"]');
      if (node && node.getClientRects().length) {
        node.focus({ preventScroll: true });
        if (typeof active.start === 'number') node.setSelectionRange(active.start, active.end);
      }
    }
  }
  function eventHeader() {
    const heading = document.getElementById('fc-heading');
    let hero = document.getElementById('fc-event-hero');
    if (!readOnly) {
      if (hero) { hero.parentElement.insertBefore(heading, hero); hero.remove(); }
      const info = document.getElementById('fc-participant-info');
      if (info) info.remove();
      return;
    }
    if (!hero) {
      hero = document.createElement('header');
      hero.id = 'fc-event-hero';
      hero.setAttribute('aria-labelledby', 'fc-heading');
      heading.parentElement.insertBefore(hero, heading);
      hero.innerHTML = '<p class="fc-event-eyebrow">' + tr('Dein Turniertag', 'Your tournament day') + '</p>';
      hero.appendChild(heading);
      hero.insertAdjacentHTML('beforeend', '<p id="fc-event-meta"></p>');
    }
    document.getElementById('fc-event-meta').textContent = event.teams.length + ' Teams · ' +
      F.courtCapacity(event) + tr(' Felder', ' courts') + ' · ' + event.config.start +
      (livePublic || participant ? ' · Live' : '');
    let info = document.getElementById('fc-participant-info');
    if (!info) {
      info = document.createElement('details');
      info.id = 'fc-participant-info'; info.className = 'noprint';
      info.innerHTML = '<summary>' + tr('Ablauf & Regeln', 'Format & rules') + '</summary><div></div>';
      hero.insertAdjacentElement('afterend', info);
    }
    info.querySelector('div').innerHTML = '<p>' +
      tr('Vorrunde: Jeder gegen jeden in der Gruppe. Danach Final- und Platzierungsspiele nach Spielplan.',
        'Groups: round robin within each pool. Finals and placement matches follow the schedule.') + '</p><p>' +
      playingTimeSummary() + ' · ' + event.config.change + tr(' Min. Wechselpause.', ' min changeover.') + ' ' +
      (F.tiePolicy(event) === 'lead' ? tr('Bei Gleichstand am Zeitende: bis zur ersten Führung weiterspielen.',
        'Tied at the time limit: play until the first lead.') :
        tr('Vorrunden-Remis erlaubt; bei Gleichstand im Baum entscheidet ein Los.',
          'Pool draws are allowed; bracket ties are decided by a draw.')) + '</p><p>' +
      tr('Wertung: Siege, dann Balldifferenz, dann erzielte Ballpunkte. Restgleichstand: geteilter Rang; für die Finalsetzung entscheidet ein Los.',
        'Ranking: wins, then ball-point difference, then scored ball points. Remaining ties share rank; final seeding uses a draw.') +
      '</p><p>' + tr('Seitenwechsel alle 7 Ballpunkte insgesamt. Es gelten die Hausregeln der Turnierleitung.',
        'Switch sides every 7 total ball points. Organizer house rules apply.') + '</p>';
  }
  function toolsReturnPhase() {
    if (toolsReturn && toolsReturn !== 'tools') return toolsReturn;
    return event.matches.length ? 'play' : 'teams';
  }
  function eventActions() {
    return readOnly ? '' : '<p class="fc-event-actions noprint"><a class="fc-local-list" href="Firmencup.html?lang=' + (en ? 'en' : 'de') + '">' +
      tr('Alle lokalen Firmencups / Wiederherstellung', 'All local company cups / restore') + '</a></p>';
  }
  // "Teilen & Sichern" is a secondary page action in the shared header (next to Print), not a fifth tab.
  function createToolsOpener() {
    const actions = document.querySelector('.app-bar .app-bar__actions');
    if (!actions) return;
    const label = tr('Teilen & Sichern', 'Sharing & backup');
    const opener = document.createElement('button');
    opener.type = 'button';
    opener.id = 'fc-tools-open';
    opener.className = 'app-bar__btn fc-tools-open';
    opener.setAttribute('aria-controls', 'fc-phase-tools');
    opener.setAttribute('aria-expanded', 'false');
    opener.setAttribute('aria-label', label);
    opener.title = label;
    opener.innerHTML = '<span class="ic"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
      '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/></svg></span><span class="lbl">' + esc(label) + '</span>';
    opener.onclick = () => action(() => switchPhase(phase === 'tools' ? toolsReturnPhase() : 'tools', true, false));
    actions.insertBefore(opener, actions.firstChild);
  }
  function syncToolsOpener() {
    // Public, participant and unlock views never get the button in the DOM.
    let opener = document.getElementById('fc-tools-open');
    if (readOnly || !event) { if (opener) opener.remove(); return; }
    if (!opener) { createToolsOpener(); opener = document.getElementById('fc-tools-open'); }
    if (opener) opener.setAttribute('aria-expanded', phase === 'tools' ? 'true' : 'false');
  }
  function phaseNavigation() {
    return '<div class="fc-phasebar noprint"><nav class="fc-phases noprint" aria-label="' + tr('Turnierphasen', 'Tournament phases') + '">' +
      (readOnly ? ['play', 'matches', 'results'] : PHASES).map((id, index) => {
        const names = { teams: tr('Firmen & Teams', 'Companies & teams'), configuration: tr('Konfiguration', 'Configuration'),
          play: readOnly ? tr('Zeitplan', 'Schedule') : tr('Turnierablauf', 'Tournament play'),
          matches: tr('Einzelergebnisse', 'Match results'),
          results: readOnly ? tr('Tabelle', 'Standings') : tr('Turnierergebnis', 'Tournament results') };
        return '<button type="button" data-phase="' + id + '" aria-controls="fc-phase-' + id + '"' +
          (id === phase ? ' aria-current="step"' : '') + (id === 'play' && !readOnly && !event.matches.length ? ' disabled title="' +
            esc(tr('Verfügbar, sobald unter „Konfiguration“ der Gruppenplan erstellt ist', 'Available once the group schedule is built under “Configuration”')) + '"' : '') +
          '>' + (!readOnly ? '<span class="fc-phase-number" aria-hidden="true">' + (index + 1) + '</span> ' : '') + names[id] + '</button>';
      }).join('') + '</nav></div>';
  }
  const PHASES = ['teams', 'configuration', 'play', 'results'], EDITOR_PHASES = ['teams', 'configuration'];
  function groupStageDecided() {
    return event.status === 'groups' && event.matches.filter(m => m.phase === 'group').every(decided);
  }
  function arrangePhases() {
    app.insertAdjacentHTML('afterbegin', eventActions() + phaseNavigation());
    syncToolsOpener();
    const groups = [
      ['teams', tr('Firmen & Teams', 'Companies & teams'), ['fc-editor', 'fc-registration', 'fc-group-breakdown-teams']],
      ['configuration', tr('Konfiguration', 'Configuration'), ['fc-setup', 'fc-locked-planning', 'fc-group-breakdown-configuration', 'fc-capacity', 'fc-config-actions', 'fc-rules']],
      ['play', readOnly ? tr('Zeitplan', 'Schedule') : tr('Turnierablauf', 'Tournament play'), readOnly ?
        ['fc-results-filter-card', 'fc-team-overview', 'fc-live', 'fc-schedule', 'fc-draw-record', 'fc-capacity', 'fc-rules'] :
        ['fc-search-panel', 'fc-cockpit', 'fc-team-overview-open', 'fc-team-overview'].concat(groupStageDecided() ? ['fc-finals'] : [])
          .concat(['fc-schedule', 'fc-finals', 'fc-org', 'fc-draw-record'])],
      ['matches', tr('Einzelergebnisse', 'Match results'), []],
      ['results', readOnly ? tr('Tabelle', 'Standings') : tr('Turnierergebnis', 'Tournament results'), readOnly ?
        (resultsState().final ? ['fc-results-status', 'fc-standings', 'fc-pools'] : ['fc-results-status', 'fc-pools', 'fc-standings']) : resultsState().final ?
        ['fc-results-filter-card', 'fc-results-status', 'fc-standings', 'fc-pools'] :
        ['fc-results-filter-card', 'fc-results-status', 'fc-pools', 'fc-standings']],
      ['tools', tr('Teilen & Sichern', 'Sharing & backup'), ['fc-tools']]
    ];
    groups.forEach(([id, name, ids]) => {
      if (!readOnly && id === 'matches') return;
      if (readOnly && (EDITOR_PHASES.indexOf(id) >= 0 || id === 'tools')) return;
      const panel = document.createElement('div');
      panel.id = 'fc-phase-' + id; panel.className = 'fc-phase'; panel.hidden = id !== phase;
      panel.setAttribute('role', 'region'); panel.setAttribute('aria-labelledby', panel.id + '-heading');
      panel.innerHTML = '<h2 id="' + panel.id + '-heading" tabindex="-1" class="fc-phase-heading noprint">' + name + '</h2>';
      if (id === 'tools') {
        panel.className = 'fc-phase fc-tools-phase noprint';
        panel.insertAdjacentHTML('afterbegin', '<button type="button" class="app-close fc-tools-close noprint" data-phase="' + toolsReturnPhase() +
          '" aria-label="' + tr('Schließen', 'Close') + '" title="' + tr('Schließen', 'Close') + '">' +
          '<svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9"/><path d="m9 9 6 6m0-6-6 6"/></svg></button>');
      }
      if (id === 'play' && !event.matches.length) panel.insertAdjacentHTML('beforeend',
        '<p class="fc-empty">' + (readOnly ?
          tr('Die Turnierleitung hat noch keinen Spielplan veröffentlicht.', 'The organizer has not published a schedule yet.') :
          tr('Noch kein Spielplan. Zuerst Firmen & Teams anlegen, dann unter Konfiguration den Gruppenplan erstellen.', 'No schedule yet. First add companies & teams, then build the group schedule under Configuration.')) + '</p>');
      ids.forEach(nodeId => {
        const node = document.getElementById(nodeId);
        if (nodeId === 'fc-capacity' && node && node.closest('#fc-setup-preview')) return;
        if (node) {
          node.querySelectorAll('h2, h3').forEach(heading => {
            const subordinate = document.createElement(heading.tagName === 'H2' ? 'h3' : 'h4');
            Array.from(heading.attributes).forEach(attribute => { subordinate.setAttribute(attribute.name, attribute.value); });
            subordinate.innerHTML = heading.innerHTML;
            heading.parentNode.replaceChild(subordinate, heading);
          });
          panel.appendChild(node);
        }
      });
      if ((id === 'configuration' || id === 'teams') && event.startedAt && event.matches.length) panel.insertAdjacentHTML('beforeend',
        '<div class="fc-step-actions noprint"><button type="button" data-phase="play">' +
        tr('Weiter zum Turnierablauf', 'Continue to tournament play') + '</button></div>');
      if (id === 'matches') panel.insertAdjacentHTML('beforeend', '<p id="fc-match-results-empty" class="fc-empty" hidden>' +
        tr('Noch keine Ergebnisse.', 'No results yet.') + '</p>');
      if (id === 'play' && !readOnly) panel.insertAdjacentHTML('beforeend',
        '<div class="fc-step-actions noprint"><button type="button" data-phase="results">' +
        tr('Turnierergebnis ansehen', 'View tournament results') + '</button></div>');
      if (id === 'results' && event.matches.length && !readOnly) panel.insertAdjacentHTML('beforeend',
        '<div class="fc-step-actions noprint"><button type="button" data-phase="play">' +
        tr('Zurück zum Turnierablauf', 'Back to tournament play') + '</button></div>');
      app.appendChild(panel);
    });
    if (readOnly) showPhase(phase, false);
  }
  function showPhase(id, focus) {
    if (id === 'tools' && phase !== 'tools') toolsReturn = phase;
    phase = id;
    if (id === 'teams') setupStep = 1;
    else if (id === 'configuration') setupStep = 3;
    const close = app.querySelector('.fc-tools-close');
    if (close) close.dataset.phase = toolsReturnPhase();
    const opener = document.getElementById('fc-tools-open');
    if (opener) opener.setAttribute('aria-expanded', id === 'tools' ? 'true' : 'false');
    app.querySelectorAll('.fc-phase').forEach(panel => { panel.hidden = panel.id !== 'fc-phase-' + id; });
    if (readOnly && (id === 'play' || id === 'matches' || id === 'results')) {
      const panel = document.getElementById('fc-phase-' + id);
      const heading = panel.querySelector('.fc-phase-heading');
      const filter = document.getElementById('fc-results-filter-card');
      const overview = document.getElementById('fc-team-overview');
      if (filter) heading.insertAdjacentElement('afterend', filter);
      if (filter && overview) filter.insertAdjacentElement('afterend', overview);
      if (id !== 'results') {
        const schedule = document.getElementById('fc-schedule');
        if (schedule) panel.appendChild(schedule);
      }
      resultsFilter();
    }
    app.querySelectorAll('.fc-phases [data-phase]').forEach(button => {
      if (button.dataset.phase === id) button.setAttribute('aria-current', 'step');
      else button.removeAttribute('aria-current');
    });
    if (focus) document.getElementById('fc-phase-' + id + '-heading').focus();
  }
  function revealTarget(target) {
    if (target.closest('#fc-team-overview')) setTeamOverviewVisible(true, false);
    const fixture = target.closest('.fc-fixture');
    const panel = target.closest('.fc-phase');
    if (panel) showPhase(readOnly && (target.closest('#fc-schedule') || target.closest('#fc-team-overview')) ?
      'play' : panel.id.slice('fc-phase-'.length), false);
    const group = target.closest('.fc-wave-group');
    if ((fixture && fixture.hidden) || (group && group.hidden)) {
      if (readOnly) {
        chooseTeam('');
        resultsFilter();
      } else {
        document.getElementById('fc-search').value = '';
        document.getElementById('fc-group-filter').value = '';
        search();
      }
    }
    const resultPool = target.closest('.fc-results-pool');
    if (resultPool) {
      const poolId = resultPool.dataset.resultsPool;
      const query = resultsQuery.trim().toLocaleLowerCase();
      const pool = event.pools[Number(poolId.slice(1)) - 1] || [];
      let changed = false;
      if (resultsGroupFilter && resultsGroupFilter !== poolId) {
        document.getElementById('fc-results-group-filter').value = '';
        changed = true;
      }
      if (query && !event.teams.some(team => pool.includes(team.id) &&
          (team.name + ' ' + orgName(team.orgId)).toLocaleLowerCase().indexOf(query) >= 0)) {
        document.getElementById('fc-results-filter').value = '';
        changed = true;
      }
      if (changed) resultsFilter();
    }
    let ancestor = target.parentElement;
    while (ancestor && ancestor !== app) {
      if (ancestor.tagName === 'DETAILS' && !ancestor.open) {
        ancestor.open = true;
        if (ancestor.classList.contains('fc-company-teams') && ancestor.ontoggle) ancestor.ontoggle();
      }
      ancestor = ancestor.parentElement;
    }
  }
  function followAnchor() {
    if (location.hash === routedHash || location.hash.indexOf('#fc-') !== 0) return;
    const target = navigationTarget(location.hash.slice(1));
    if (!target) return;
    routedHash = location.hash;
    revealTarget(target);
    target.setAttribute('tabindex', '-1'); target.focus();
    target.scrollIntoView({ block: 'start' });
  }
  function groupTeamEditors(expandedCompanies, expandedRosters) {
    const registration = app.querySelector('[data-panel="1"]');
    const teamPanel = app.querySelector('[data-panel="2"]');
    if (!registration || !teamPanel) return;
    const usedNames = event.teams.map(t => t.name);
    event.organizations.forEach(o => {
      const card = Array.from(registration.querySelectorAll('[data-company]')).find(node => node.dataset.company === o.id);
      const teams = event.teams.filter(t => t.orgId === o.id);
      const details = document.createElement('details');
      details.className = 'fc-company-teams';
      details.open = expandedCompanies.indexOf(o.id) !== -1;
      let wasOpen = details.open;
      details.ontoggle = function () {
        if (printing) return;
        if (details.open === wasOpen) return;
        wasOpen = details.open;
        if (!details.open) { pendingCompanyTeams.delete(o.id); return; }
        if (!event.teams.some(team => team.orgId === o.id)) {
          pendingCompanyTeams.add(o.id);
          addOpenedCompanyTeam();
        }
      };
      const summary = document.createElement('summary');
      summary.textContent = tr('Teams', 'Teams') + ' (' + teams.length + ')';
      summary.onclick = function (ev) {
        ev.preventDefault();
        details.open = !details.open;
        details.ontoggle();
      };
      details.appendChild(summary);
      if (!teams.length) {
        const name = nextTeamName(usedNames); usedNames.push(name);
        details.insertAdjacentHTML('beforeend', teamEditor({ id: draftTeamId(o.id), name: name, orgId: o.id, roster: [] }, 0, true));
      }
      teams.forEach(team => {
        const node = document.getElementById('fc-team-card-' + team.id);
        if (node) {
          const roster = node.querySelector('.fc-roster-details');
          if (roster) roster.open = expandedRosters.indexOf(team.id) !== -1;
          details.appendChild(node);
        }
      });
      const add = document.createElement('button');
      add.type = 'button'; add.dataset.action = 'add-team'; add.dataset.company = o.id;
      add.textContent = '+ Team'; add.disabled = event.teams.length >= teamLimit(event);
      details.appendChild(add); card.appendChild(details);
    });
    const progress = teamPanel.querySelector('#fc-team-progress');
    if (progress) registration.insertBefore(progress, registration.querySelector('.fc-step-actions'));
    teamPanel.remove();
  }
  function copyDraftFromForm() {
    const form = document.getElementById('fc-edit'), next = F.clone(event);
    if (!form) return next;
    const c = config(form); next.title = c.title; next.config = c.config;
    if (!next.replans.length) next.fieldLimit = F.courtCapacity(next);
    app.querySelectorAll('[data-team-draft]').forEach(card => {
      const name = card.querySelector('[data-team-name]'), company = card.querySelector('[data-team-org]');
      const roster = Array.from(card.querySelectorAll('[data-member]')).map(input => input.value.trim()).filter(Boolean);
      if (name.value !== name.defaultValue || card.hasAttribute('data-draft-commit') || roster.length || company.value !== card.dataset.teamDraft) {
        if (!name.value.trim()) {
          name.focus();
          throw new Error(tr('Bitte einen Teamnamen eingeben.', 'Please enter a team name.'));
        }
        const orgId = company.value;
        const id = 't-' + uid();
        next.teams.push({ id: id, name: name.value.trim(), orgId: orgId, roster: roster });
        const org = next.organizations.find(o => o.id === orgId);
        if (org && org.nominee === null) org.nominee = id;
      }
    });
    app.querySelectorAll('[data-team-name]').forEach(input => {
      const team = next.teams.find(t => t.id === input.dataset.teamName);
      if (team) team.name = input.value.trim();
    });
    app.querySelectorAll('[data-team-org]').forEach(input => {
      const team = next.teams.find(t => t.id === input.dataset.teamOrg);
      if (team) team.orgId = input.value;
    });
    next.teams.forEach(t => {
      if (!event.teams.some(team => team.id === t.id)) return;
      t.roster = Array.from(app.querySelectorAll('[data-member]')).filter(input => input.dataset.member === t.id)
        .map(input => input.value.trim()).filter(Boolean);
    });
    app.querySelectorAll('[data-org-name]').forEach(input => { next.organizations.find(o => o.id === input.dataset.orgName).name = input.value.trim(); });
    app.querySelectorAll('[data-nominee]').forEach(input => {
      const o = next.organizations.find(o => o.id === input.dataset.nominee);
      if (o) o.nominee = input.value || null;
    });
    next.organizations.forEach(o => {
      if (!next.teams.some(t => t.id === o.nominee && t.orgId === o.id)) {
        const candidates = next.teams.filter(t => t.orgId === o.id);
        const previousMembers = event.teams.filter(t => t.orgId === o.id).map(t => t.id).sort();
        const currentMembers = candidates.map(t => t.id).sort();
        if (candidates.length !== 1 && o.nominee === null && JSON.stringify(previousMembers) === JSON.stringify(currentMembers)) return;
        if (!candidates.length && !event.startedAt) { o.nominee = null; return; }
        if (candidates.length !== 1 && !event.startedAt) { o.nominee = null; return; }
        if (candidates.length !== 1) throw new Error(tr('Team für den Firmenpokal erneut wählen für: ', 'Choose the company trophy team again for: ') + o.name);
        o.nominee = candidates[0].id;
      }
    });
    return next;
  }
  function readyTeams(next) {
    const minimum = F.teamLimits(next).min;
    if (next.teams.length < minimum || next.teams.length > teamLimit(next)) {
      throw new Error(tr('Für diesen Spielplan sind ', 'This schedule requires ') +
        teamRange(next) + tr(' Teams erforderlich (technische Plangrenze, keine Sportregel).', ' teams (technical plan limit, not a sports rule).'));
    }
    const empty = next.organizations.find(o => !next.teams.some(t => t.orgId === o.id));
    if (empty) throw new Error(tr('Team zuordnen oder unbenutzte Firma entfernen: ', 'Assign a team or remove the unused company: ') + empty.name);
    const unassigned = F.rankingMode(next) === 'nominee' && next.organizations.find(o => !next.teams.some(t => t.id === o.nominee && t.orgId === o.id));
    if (unassigned) throw new Error(tr('Unter „Firmen & Teams“ das Team für den Firmenpokal wählen für: ', 'Under “Companies & teams”, choose the company trophy team for: ') + unassigned.name);
  }
  function confirmPlacementChange(next) {
    if (next.config.placementMode !== 'shared') return true;
    const bands = target => F.classificationBands(target.teams.length, F.effectivePoolCount(target.teams.length, target.config));
    const before = bands(event), after = bands(next);
    if (JSON.stringify(before) === JSON.stringify(after)) return true;
    if (!after.slice(0, -1).some(band => band.to === next.config.placementThrough)) {
      throw new Error(tr('Die Teamänderung macht die gewählten Platzierungsblöcke ungültig. Zuerst unter „Konfiguration“ alle Plätze wählen, dann Teams ändern und die neuen Blöcke ausdrücklich wählen.',
        'This team change invalidates the selected placement bands. First select all places in Configuration, then change teams and explicitly select the new bands.'));
    }
    return confirm(tr('Teamänderung: Neue geteilte Platzierungsblöcke ausdrücklich übernehmen? ', 'Team change: explicitly accept the new shared placement bands? ') +
      after.filter(band => band.from > next.config.placementThrough).map(band => placeRange(band.from, band.to)).join(' / '));
  }
  function reopenDraft(next) {
    if (event.startedAt || Object.keys(event.results).length) throw new Error('Started event frozen / Gestartete Veranstaltung eingefroren');
    if (event.status !== 'draft' && !confirm(tr('Noch nicht gestarteten Spielplan mit Gruppenzuordnung, Paarungen, Feldern und Startzeiten entfernen? Firmen, Teams, Spieler:innen und Teamauswahl für den Firmenpokal bleiben erhalten. Danach den Gruppenplan mit automatischer Zuordnung neu erstellen.',
      'Remove the unstarted schedule, including group assignments, pairings, courts and start times? Companies, teams, players and company trophy team choices are retained. Rebuild the group schedule with automatic assignments afterwards.'))) return null;
    next.status = 'draft'; next.matches = []; next.pools = []; next.drawOrder = []; next.groupAssignments = [];
    return next;
  }
  function editedProgress() {
    const next = copyDraftFromForm();
    if (event.status !== 'draft' && (Object.keys(event.config).some(key => next.config[key] !== event.config[key]) ||
        F.rankingMode(next) === 'nominee' && next.organizations.some(o => o.nominee === null))) return reopenDraft(next);
    return next;
  }
  function draftForPhaseChange() {
    // Leaving the editor saves the draft; invalid rule values stay in the form and do not block team edits.
    if (!invalidSetupSettings()) { setupSettingsDraft = null; return editedProgress(); }
    setupSettingsDraft = captureSetupSettings();
    const next = copyDraftFromForm();
    next.config = event.config;
    next.title = event.title;
    if (!next.replans.length) next.fieldLimit = F.courtCapacity(next);
    return next;
  }
  async function switchPhase(target, focus, saveDraft) {
    const leavingTools = phase === 'tools' && target !== 'tools';
    const editing = !readOnly && !event.startedAt && EDITOR_PHASES.indexOf(phase) >= 0;
    if (editing && (saveDraft || EDITOR_PHASES.indexOf(target) < 0)) {
      const invalid = invalidSetupSettings();
      const next = draftForPhaseChange();
      if (!next) return false;
      if (target === 'tools') toolsReturn = phase;
      phase = target;
      showPhase(target, false);
      await save(next);
      if (invalid) notify(tr('Firmen und Teams gespeichert. Ungültige Regeleingaben sind noch nicht gespeichert.', 'Companies and teams saved. Invalid rule settings are still unsaved.'), true);
    } else if (editing) {
      // Valid unsaved rules travel with the next draft save; only invalid ones need a render-proof copy.
      if (phase === 'configuration' && invalidSetupSettings()) setupSettingsDraft = captureSetupSettings();
      showPhase(target, false);
    } else showPhase(target, false);
    if (leavingTools) document.getElementById('fc-tools-open').focus();
    else if (focus) document.getElementById('fc-phase-' + target + '-heading').focus();
    return true;
  }
  async function goStep(step, forward) {
    await switchPhase(step === 3 ? 'configuration' : 'teams', true, forward);
  }
  function bind() {
    const overview = document.getElementById('fc-team-overview');
    if (overview) {
      if (!readOnly) {
        const close = TNative.mountClose(overview, tr('Teams & Gruppen ausblenden', 'Hide teams & pools'), () => setTeamOverviewVisible(false, true), null, true);
        close.removeAttribute('data-i18n-attr');
        close.setAttribute('aria-controls', 'fc-team-overview');
        document.getElementById('fc-team-overview-open').onclick = () => setTeamOverviewVisible(true, true);
      }
      document.getElementById('fc-team-agenda').onclick = ev => {
        const link = ev.target.closest('[data-focus-target]');
        if (!link) return;
        ev.preventDefault();
        focusStatusTarget(document.getElementById(link.dataset.focusTarget));
      };
      app.querySelectorAll('[data-overview-team]').forEach(node => {
        node.onclick = ev => {
          ev.preventDefault();
          chooseTeam(node.dataset.overviewTeam);
          focusStatusTarget(document.getElementById('fc-team-overview-title'));
        };
      });
    }
    app.querySelectorAll('[data-attendance]').forEach(attendance => {
      attendance.onclick = () => action(async function () {
        const id = attendance.dataset.attendance, absent = isAbsent(id);
        await save(F.checkIn(event, id, absent ? 'unconfirmed' : 'absent'),
          teamName(id) + (absent ? tr(' ist wieder da.', ' is back.') :
            tr(' als abwesend gemeldet. Spielplan und Ergebnisse unverändert.', ' reported absent. Fixtures and results unchanged.')));
        focusStatusTarget(navigationTarget('fc-attendance-team-' + id));
      });
    });
    const adminShare = document.getElementById('fc-admin-share-form');
    if (adminShare) adminShare.onsubmit = ev => {
      ev.preventDefault();
      action(async function () {
        await saveSharing({ adminShareToken: Server.token(), password: new FormData(adminShare).get('password') });
        notify(tr('Adminlink und Passwort gesetzt. Adminsitzungen wurden beendet.', 'Admin link and password set. Admin sessions were ended.'));
      });
    };
    app.querySelectorAll('[data-phase]').forEach(node => {
      node.onclick = () => action(() => switchPhase(node.dataset.phase, true, false));
    });
    const toolsPanel = document.getElementById('fc-phase-tools');
    if (toolsPanel) toolsPanel.onkeydown = function (keyEvent) {
      if (keyEvent.key === 'Escape' || keyEvent.key === 'Esc') { keyEvent.preventDefault(); toolsPanel.querySelector('.fc-tools-close').click(); }
    };
    app.querySelectorAll('[data-transfer-team]').forEach(form => {
      const team = event.teams.find(t => t.id === form.dataset.transferTeam);
      const target = form.elements.namedItem('target');
      target.onchange = function () {
        const company = event.organizations.find(o => o.id === target.value);
        const source = event.organizations.find(o => o.id === team.orgId);
        const choices = form.querySelector('[data-transfer-choices]');
        if (!company) { choices.innerHTML = ''; return; }
        choices.innerHTML = '<p class="fc-note">' +
          tr('Für die Firmenwertung zählt weiterhin je ein Team. Bestätige die Auswahl für beide Firmen nach dem Wechsel.',
            'One team still counts for each company ranking. Confirm both companies’ choices after the move.') + '</p>' +
          [source, company].map((org, index) => {
            const candidates = event.teams.filter(t => index === 0 ? t.orgId === source.id && t.id !== team.id :
              t.orgId === company.id || t.id === team.id);
            return '<label>' + esc(org.name) + ' · ' + tr('Team für die Firmenwertung', 'Company ranking team') +
              '<select name="' + (index === 0 ? 'sourceNominee' : 'targetNominee') + '">' +
              (!candidates.length ? '<option value="">' + tr('Kein Team', 'No team') + '</option>' :
                '<option value="">' + tr('Bitte wählen', 'Please choose') + '</option>' + options(candidates, null)) + '</select></label>';
          }).join('');
      };
      form.onsubmit = ev => {
        ev.preventDefault();
        action(async function () {
          const data = new FormData(form);
          const next = F.transferTeam(event, team.id, data.get('target'), {
            confirmed: true, sourceNominee: data.get('sourceNominee') || null,
            targetNominee: data.get('targetNominee') || null
          });
          if (!confirm(team.name + ': ' + orgName(team.orgId) + ' → ' + orgName(data.get('target')) + '\n' +
              tr('Spielplan und Ergebnisse bleiben gleich. Die Firmenwertung wird neu zugeordnet. Wechsel bestätigen?',
                'Fixtures and results stay unchanged. The company ranking is reassigned. Confirm transfer?'))) return;
          await save(next, tr('Team verschoben. Spielplan und Ergebnisse unverändert.', 'Team moved. Fixtures and results unchanged.'));
        });
      };
    });
    bindGroupEditors();
    bindGroupNames();
    app.querySelectorAll('[data-team-name]').forEach(name => {
      if (!generatedTeamNames.has(name.dataset.teamName)) return;
      const selectGenerated = () => {
        if (name.value === generatedTeamNames.get(name.dataset.teamName)) name.select();
      };
      name.onfocus = selectGenerated; name.onclick = selectGenerated;
      name.oninput = () => { generatedTeamNames.delete(name.dataset.teamName); };
    });
    app.querySelectorAll('[data-team-draft]').forEach(firstTeam => {
      const name = firstTeam.querySelector('[data-team-name]');
      const selectGenerated = () => { if (!name.dataset.customName && name.value === name.defaultValue) name.select(); };
      name.onfocus = selectGenerated; name.onclick = selectGenerated;
      name.oninput = () => { name.dataset.customName = 'true'; };
      const clear = function () {
        firstTeam.querySelectorAll('input').forEach(input => { input.value = input.defaultValue; });
        firstTeam.querySelector('select').value = firstTeam.dataset.teamDraft;
        firstTeam.removeAttribute('data-draft-commit');
        delete name.dataset.customName;
        name.focus(); selectGenerated();
        updateSaveButtons();
      };
      firstTeam.querySelector('[data-cancel-first-team]').onclick = clear;
      firstTeam.onkeydown = function (ev) {
        if (ev.isComposing || ev.target.tagName !== 'INPUT') return;
        if (ev.key === 'Escape' || ev.key === 'Esc') { ev.preventDefault(); clear(); }
        if (ev.key === 'Enter') {
          ev.preventDefault(); firstTeam.setAttribute('data-draft-commit', '');
          action(() => runAction('save-setup'));
        }
      };
    });
    const form = document.getElementById('fc-edit');
    [form, document.getElementById('fc-teams-edit')].forEach(node => {
      if (node) node.onsubmit = ev => {
        ev.preventDefault();
        updateSaveButtons();
        if (!node.querySelector('[data-action="save-setup"]:not(:disabled)')) return;
        action(() => runAction('save-setup'));
      };
      if (node) ['input', 'change'].forEach(type => node.addEventListener(type, updateSaveButtons));
    });
    if (form) {
      ['input', 'change'].forEach(type => form.addEventListener(type, updateSetupPreview));
    }
    updateSetupPreview();
    app.querySelectorAll('[data-step], [data-next]').forEach(node => {
      node.onclick = () => action(() => goStep(Number(node.dataset.step || node.dataset.next), !!node.dataset.next));
    });
    app.querySelectorAll('[data-order]').forEach(node => {
      node.onclick = () => action(async function () {
        const next = reopenDraft(copyDraftFromForm());
        if (!next) return;
        const list = next.organizations, index = list.findIndex(item => item.id === node.dataset.id);
        const target = index + Number(node.dataset.direction);
        if (index < 0 || target < 0 || target >= list.length) throw new Error('Invalid order / Ungültige Reihenfolge');
        const item = list.splice(index, 1)[0]; list.splice(target, 0, item);
        await save(next);
        const control = app.querySelector('[data-order="' + node.dataset.order + '"][data-id="' + node.dataset.id +
          '"][data-direction="' + node.dataset.direction + '"]');
        if (control && !control.disabled) control.focus();
        else {
          const input = app.querySelector('[data-org-name="' + node.dataset.id + '"]');
          if (input) input.focus();
        }
      });
    });
    app.querySelectorAll('[data-team-position]').forEach(select => {
      select.onchange = function () {
        const id = select.dataset.teamPosition, team = event.teams.find(team => team.id === id);
        const members = event.teams.filter(item => item.orgId === team.orgId), index = members.findIndex(item => item.id === id);
        const target = Number(select.value); select.value = String(index);
        action(async function () {
          if (!Number.isInteger(target) || target < 0 || target >= members.length || target === index) return;
          await save(F.reorderCompanyTeam(copyDraftFromForm(), id, target));
          const updated = app.querySelector('[data-team-position="' + id + '"]');
          if (updated) updated.focus();
        });
      };
    });
    app.querySelectorAll('[data-remove-org]').forEach(node => {
      node.onclick = () => action(async function () {
        const next = copyDraftFromForm(), id = node.dataset.removeOrg;
        if (next.teams.some(t => t.orgId === id)) throw new Error(tr('Zuerst Teams einer anderen Firma zuordnen.', 'Assign teams to another company first.'));
        const draft = reopenDraft(next);
        if (draft) { draft.organizations = draft.organizations.filter(o => o.id !== id); await save(draft); }
      });
    });
    app.querySelectorAll('[data-add-member]').forEach(node => {
      node.onclick = function () {
        const host = node.parentNode, count = host.querySelectorAll('[data-member]').length;
        if (count >= 100) { notify(tr('Maximal 100 Namenseinträge je Team.', 'Maximum 100 name entries per team.'), true); return; }
        const label = document.createElement('label'), input = document.createElement('input');
        label.textContent = tr('Spieler:in ', 'Player ') + (count + 1);
        input.dataset.member = node.dataset.addMember; input.dataset.index = count; input.maxLength = 100;
        label.appendChild(input); host.insertBefore(label, node); input.focus();
      };
    });
    app.querySelectorAll('[data-score]').forEach(form => {
      const a = form.elements.namedItem('a'), b = form.elements.namedItem('b'), draw = form.elements.namedItem('drawWinner');
      const error = form.querySelector('.fc-score-error');
      const showScoreError = function (field, text) {
        const match = event.matches.find(m => m.id === form.dataset.score);
        error.textContent = tr('Spielrunde ', 'Time slot ') + (match.wave + 1) + ' · ' + tr('Feld ', 'Court ') + match.field + ': ' + text;
        error.hidden = false;
        if (field) {
          revealTarget(field);
          field.setAttribute('aria-invalid', 'true');
          field.focus();
        }
        notify(error.textContent, true);
      };
      const updateDraw = function () {
        error.hidden = true; error.textContent = '';
        [a, b].forEach(input => {
          input.removeAttribute('aria-invalid');
          input.setCustomValidity('');
          input.setCustomValidity(input.validity.badInput ? tr('Ganze Ballpunkte von 0 bis 999 eingeben.', 'Enter whole ball points from 0 to 999.') :
            input.value === '' ? tr('Ballpunkte für beide Teams eingeben; 0 ist gültig.', 'Enter ball points for both teams; 0 is valid.') :
              !Number.isInteger(input.valueAsNumber) || input.valueAsNumber < 0 || input.valueAsNumber > 999 ?
                tr('Ganze Ballpunkte von 0 bis 999 eingeben.', 'Enter whole ball points from 0 to 999.') : '');
        });
        const equal = a.value !== '' && b.value !== '' && a.validity.valid && b.validity.valid && Number(a.value) === Number(b.value);
        if (equal && F.tiePolicy(event) === 'lead') b.setCustomValidity(
          tr('Bei Zeitgleichstand bis zur ersten Führung weiterspielen und den ungleichen Endstand erfassen.', 'When tied at time, continue until the first lead and enter the unequal final score.'));
        if (!draw) return;
        draw.removeAttribute('aria-invalid');
        const tied = a.value !== '' && b.value !== '' && a.validity.valid && b.validity.valid && Number(a.value) === Number(b.value);
        draw.parentElement.hidden = !tied;
        draw.required = tied;
        draw.setCustomValidity(tied && !draw.value ?
          tr('Bei K.-o.-Remis das per Los bestimmte Team wählen.', 'For a knockout tie, choose the lottery winner.') : '');
        if (!tied) draw.value = '';
      };
      [a, b].forEach(input => {
        input.oninput = updateDraw;
        input.onfocus = function () { input.select(); };
      });
      a.onkeydown = function (ev) {
        if (ev.key === 'Enter') { ev.preventDefault(); b.focus(); }
      };
      if (draw) draw.onchange = updateDraw;
      updateDraw();
      form.onsubmit = ev => {
        ev.preventDefault();
        action(async function () {
          updateDraw();
          if (!form.checkValidity()) {
            const invalid = form.querySelector(':invalid');
            if (invalid) showScoreError(invalid, invalid.validationMessage);
            return;
          }
          const data = new FormData(form), id = form.dataset.score;
          let next;
          try { next = F.score(event, id, a.valueAsNumber, b.valueAsNumber, data.get('drawWinner')); }
          catch (failure) { showScoreError(null, failure.message); return; }
          lastScored = id;
          await save(next);
          const item = app.querySelector('[data-match="' + id + '"]');
          if (item) { item.scrollIntoView({ block: 'center' }); item.setAttribute('tabindex', '-1'); item.focus(); }
        });
      };
    });
    app.querySelectorAll('[data-outcome]').forEach(form => {
      const forcedWinner = form.querySelector('select[name=winner][data-feeds-later]');
      if (forcedWinner) {
        const syncWinner = () => {
          const other = Array.from(form.elements.absent.options).find(o => o.value && o.value !== form.elements.absent.value);
          forcedWinner.value = form.elements.absent.value && other ? other.value : '';
        };
        form.elements.absent.addEventListener('change', syncWinner);
        syncWinner();
      }
      form.onsubmit = ev => {
        ev.preventDefault();
        action(async function () {
          const data = new FormData(form), type = String(data.get('type'));
          const absent = String(data.get('absent')), winner = String(data.get('winner')) || null;
          const typeText = type === 'withdrawal' ? tr('Rückzug aus dem Wettbewerb', 'withdrawal from the competition') :
            tr('Nichtantreten nur in dieser Begegnung', 'nonappearance in this match only');
          const rankingText = winner ?
            tr('Das gegnerische Team erhält einen Sieg; es wird kein Ball-Spielstand erfunden.', 'The opposing team gets one win; no ball score will be invented.') :
            tr('Die Begegnung wird ohne Wertungspunkte aufgehoben.', 'The match is voided with no standings points.');
          if (!confirm(typeText + '. ' + rankingText + ' ' +
              tr('Diese Entscheidung bleibt getrennt von gespielten Ergebnissen gespeichert.', 'This organizer decision is stored separately from played scores.'))) return;
          await save(F.decideOutcome(event, form.dataset.outcome, type, absent, winner, String(data.get('note') || '')),
            tr('Entscheidung protokolliert; keine normale Punktzahl wurde gespeichert.', 'Decision recorded; no normal score was stored.'));
        });
      };
    });
    app.querySelectorAll('[data-focus-target]').forEach(link => {
      link.onclick = function (ev) {
        ev.preventDefault();
        const target = navigationTarget(link.dataset.focusTarget);
        if (!target) return;
        revealTarget(target);
        target.scrollIntoView({ block: target.matches('section') ? 'start' : 'center' });
        if (target.matches('article')) {
          const input = target.querySelector('input, select, button');
          (input || target).focus();
        } else target.focus();
      };
    });
    app.querySelectorAll('[data-pool-matches]').forEach(link => {
      link.onclick = function (ev) {
        ev.preventDefault();
        const searchInput = document.getElementById('fc-search');
        const groupInput = document.getElementById('fc-group-filter');
        if (searchInput && groupInput) {
          searchInput.value = '';
          groupInput.value = link.dataset.poolMatches;
          search();
        }
        focusStatusTarget(document.getElementById('fc-schedule'));
      };
    });
    app.querySelectorAll('.fc-wave-head').forEach(summary => {
      summary.onclick = function () {
        const group = summary.parentElement;
        const searchInput = document.getElementById('fc-search');
        const groupInput = document.getElementById('fc-group-filter');
        if (readOnly || searchInput && groupInput && !searchInput.value.trim() && !groupInput.value) waveOpenOverride.set(Number(group.dataset.wave), !group.open);
      };
    });
    const waveSelect = document.getElementById('fc-wave');
    if (waveSelect) {
      const updateWaveReadiness = function () {
        const start = document.getElementById('fc-start-wave');
        if (start) start.disabled = !F.waveReadiness(event, Number(waveSelect.value)).ready;
      };
      waveSelect.onchange = updateWaveReadiness;
      updateWaveReadiness();
    }
    const searchInput = document.getElementById('fc-search');
    const groupInput = document.getElementById('fc-group-filter');
    const searchReset = document.getElementById('fc-filter-reset');
    if (searchInput && groupInput && searchReset) {
      searchInput.oninput = () => search();
      groupInput.onchange = () => search();
      searchReset.onclick = function () {
        searchInput.value = '';
        groupInput.value = '';
        search();
        searchInput.focus();
      };
      search(false);
    }
    const teamFilter = document.getElementById('fc-results-team-filter');
    if (teamFilter) {
      const teamInput = document.getElementById('fc-team-search');
      teamInput.oninput = function () { teamSearch = teamInput.value; updateTeamSearch(); };
      teamFilter.onchange = function () { chooseTeam(teamFilter.value); };
      document.getElementById('fc-team-reset').onclick = function () {
        teamSearch = ''; teamInput.value = ''; chooseTeam(''); teamInput.focus();
      };
      updateTeamSearch();
    }
    const resultsSearch = document.getElementById('fc-results-filter');
    const resultsGroup = document.getElementById('fc-results-group-filter');
    const resultsReset = document.getElementById('fc-results-filter-reset');
    if (teamFilter) {
      resultsFilter();
    } else if (resultsSearch && resultsGroup && resultsReset) {
      resultsSearch.oninput = () => resultsFilter();
      resultsGroup.onchange = () => resultsFilter();
      resultsReset.onclick = function () {
        resultsSearch.value = '';
        resultsGroup.value = '';
        resultsFilter();
        resultsSearch.focus();
      };
      resultsFilter();
    }
    app.querySelectorAll('[data-action]').forEach(node => {
      node.onclick = function () {
        if (node.dataset.action === 'save-setup') return;
        if (node.dataset.action === 'print') {
          app.querySelectorAll('.fc-fixture, .fc-wave-group, .fc-wave-pool').forEach(el => { el.hidden = false; });
          window.print();
          if (document.getElementById('fc-search')) search();
          resultsFilter();
          return;
        }
        if (node.dataset.action === 'start-wave' && node.dataset.wave != null) {
          const select = document.getElementById('fc-wave');
          if (select) select.value = node.dataset.wave;
        }
        if (!readOnly) action(() => runAction(node.dataset.action, node.dataset.company, node.dataset.team, node));
      };
    });
  }
  function search(clearNotice) {
    if (clearNotice !== false) clearSuccessNotice();
    searchQuery = document.getElementById('fc-search').value;
    groupFilter = document.getElementById('fc-group-filter').value;
    const q = searchQuery.trim().toLocaleLowerCase(), filtered = !!q || !!groupFilter;
    document.getElementById('fc-filter-reset').hidden = !filtered;
    const ids = event.teams.filter(t => (t.name + ' ' + orgName(t.orgId)).toLocaleLowerCase().indexOf(q) >= 0).map(t => t.id);
    const directory = document.querySelector('#fc-team-overview .fc-team-directory');
    if (directory) {
      directory.querySelectorAll('[data-overview-team]').forEach(link => { link.parentElement.hidden = !!q && ids.indexOf(link.dataset.overviewTeam) < 0; });
      directory.querySelectorAll('.fc-pool').forEach(pool => { pool.hidden = !pool.querySelector('li:not([hidden])'); });
      document.getElementById('fc-directory-empty').hidden = !q || ids.length > 0;
    }
    const matches = event.matches.filter(m => {
      const a = F.resolve(event, m.a), b = F.resolve(event, m.b);
      const inGroup = !groupFilter || (groupFilter === 'cup' ? m.phase === 'cup' : m.phase === 'group' && m.pool === groupFilter);
      return inGroup && (!q || ids.indexOf(a) >= 0 || ids.indexOf(b) >= 0 || ids.indexOf(m.refereeTeam) >= 0);
    });
    app.querySelectorAll('.fc-fixture').forEach(el => { el.hidden = !matches.some(m => m.id === el.dataset.match); });
    app.querySelectorAll('.fc-wave-pool').forEach(pool => {
      pool.hidden = !pool.querySelector('.fc-fixture:not([hidden])');
    });
    app.querySelectorAll('.fc-wave-group').forEach(group => {
      const wave = Number(group.dataset.wave);
      group.hidden = filtered && !group.querySelector('.fc-fixture:not([hidden])');
      group.open = filtered ? !group.hidden : (waveOpenOverride.has(wave) ? waveOpenOverride.get(wave) : group.dataset.defaultOpen === '1');
    });
    const next = matches.find(m => !event.results[m.id] && !event.outcomes[m.id] && F.resolve(event, m.a) && F.resolve(event, m.b));
    document.getElementById('fc-next').innerHTML = filtered ?
      '<p class="fc-next">' + (next ? tr('Nächstes offenes Spiel: ', 'Next pending match: ') + F.clock(next.startMin) + ' · ' + tr('Feld ', 'Court ') + next.field + ' · ' + matchLabel(next) + ' · ' + refereeLabel(next) :
        tr('Kein offenes, bereits zugeordnetes Spiel. Finalgegner können noch offen sein.', 'No pending, assigned match. Final opponents may still be unresolved.')) + '</p>' : '';
    const summary = document.getElementById('fc-search-summary');
    if (summary) summary.textContent = filtered ? matches.length + tr(' Spiele gefunden', ' matches found') +
      (groupFilter ? ' · ' + (groupFilter === 'cup' ? tr('Baumphase', 'Bracket stage') : poolLabel(groupFilter, false)) : '') +
      tr('; gedruckt wird immer der Gesamtplan.', '; print always includes the full schedule.') : '';
  }
  function resultsFilter() {
    const searchInput = document.getElementById('fc-results-filter');
    const groupInput = document.getElementById('fc-results-group-filter');
    if (!readOnly && (!searchInput || !groupInput)) return;
    resultsQuery = readOnly ? '' : searchInput.value;
    resultsGroupFilter = readOnly ? '' : groupInput.value;
    const q = resultsQuery.trim().toLocaleLowerCase();
    const active = readOnly ? !!overviewTeam : !!q || !!resultsGroupFilter;
    const matchingTeams = readOnly ?
      event.teams.filter(team => !overviewTeam || team.id === overviewTeam) :
      event.teams.filter(team => (team.name + ' ' + orgName(team.orgId)).toLocaleLowerCase().indexOf(q) >= 0);
    const matchingIds = new Set(matchingTeams.map(team => team.id));
    const printingResults = printing;
    const reset = document.getElementById('fc-results-filter-reset');
    if (reset) reset.hidden = !active;
    if (readOnly) {
      app.querySelectorAll('.fc-fixture').forEach(node => {
        const match = event.matches.find(item => item.id === node.dataset.match);
        const sides = match ? [F.resolve(event, match.a), F.resolve(event, match.b)] : [];
        node.hidden = !printingResults && ((phase === 'matches' && (!match || !decided(match))) ||
          !!overviewTeam && !sides.includes(overviewTeam) && (!match || match.refereeTeam !== overviewTeam));
      });
      app.querySelectorAll('.fc-wave-pool').forEach(pool => {
        pool.hidden = !pool.querySelector('.fc-fixture:not([hidden])');
      });
      app.querySelectorAll('.fc-wave-group').forEach(group => {
        const wave = Number(group.dataset.wave);
        group.hidden = !printingResults && !group.querySelector('.fc-fixture:not([hidden])');
        group.open = printingResults ? group.dataset.defaultOpen === '1' :
          overviewTeam || phase === 'matches' ? !group.hidden : (waveOpenOverride.has(wave) ? waveOpenOverride.get(wave) : group.dataset.defaultOpen === '1');
      });
      const empty = document.getElementById('fc-match-results-empty');
      if (empty) empty.hidden = printingResults || !!app.querySelector('.fc-fixture:not([hidden])');
      const overview = document.getElementById('fc-team-overview');
      if (overview) overview.classList.toggle('fc-no-team', !overviewTeam);
    }
    app.querySelectorAll('.fc-results-pool').forEach(pool => {
      pool.hidden = !printingResults && !!resultsGroupFilter && pool.dataset.resultsPool !== resultsGroupFilter;
      pool.querySelectorAll('.fc-pool-table tr[data-team]').forEach(row => {
        const matched = matchingIds.has(row.dataset.team);
        row.hidden = false;
        row.classList.toggle('fc-results-filter-match', !printingResults && (readOnly ? !!overviewTeam && matched : !!q && matched));
      });
    });
    const placementRows = Array.from(app.querySelectorAll('#fc-standings .fc-place-table tbody tr'));
    const slotMatches = Object.create(null);
    placementRows.forEach(row => {
      const slot = row.dataset.resultSlot;
      if (!slot) return;
      const ids = (row.dataset.resultTeams || '').split(' ').filter(Boolean);
      if (ids.some(id => matchingIds.has(id))) slotMatches[slot] = true;
    });
    placementRows.forEach(row => {
      const matched = !!row.dataset.team && matchingIds.has(row.dataset.team);
      const slot = row.dataset.resultSlot;
      const contextualMatch = slot && slotMatches[slot];
      row.hidden = !printingResults && !readOnly && !!q && !matched && !contextualMatch;
      row.classList.toggle('fc-results-filter-match', !printingResults && (readOnly ? !!overviewTeam && matched : !!q && matched));
    });
    app.querySelectorAll('#fc-standings [data-company-row]').forEach(row => {
      const org = event.organizations.find(item => item.id === row.dataset.companyRow);
      const companyMatch = !!org && org.name.toLocaleLowerCase().indexOf(q) >= 0;
      const teamMatch = (row.dataset.companyTeams || '').split(' ').some(id => matchingIds.has(id));
      row.hidden = !printingResults && !readOnly && !!q && !companyMatch && !teamMatch;
    });
    const status = document.getElementById('fc-results-filter-status');
    if (!status) return;
    const message = resultsFilterMessage();
    if (status.textContent !== message) status.textContent = message;
  }
  function resultsFilterMessage() {
    if (readOnly) {
      return overviewTeam ?
        (phase === 'results' ? tr('Gesamtwertung · Team hervorgehoben', 'Overall standings · team highlighted') :
          tr('Spiele & Schiridienste deines Teams', 'Your team’s matches & referee duties')) :
        tr('Alle Teams', 'All teams');
    }
    const q = resultsQuery.trim().toLocaleLowerCase();
    const active = !!q || !!resultsGroupFilter;
    const groupNumber = /^G([1-9]\d*)$/.exec(resultsGroupFilter);
    const selectedGroup = groupNumber ? event.pools[Number(groupNumber[1]) - 1] || [] : null;
    const eligibleTeams = event.teams.filter(team =>
      (!q || (team.name + ' ' + orgName(team.orgId)).toLocaleLowerCase().indexOf(q) >= 0) &&
      (!selectedGroup || selectedGroup.indexOf(team.id) >= 0));
    let message;
    if (q && !eligibleTeams.length) {
      message = resultsGroupFilter ?
        tr('Keine passenden Teams in ', 'No matching teams in ') + poolLabel(resultsGroupFilter, false) + '.' :
        tr('Keine passenden Teams oder Firmen gefunden.', 'No matching teams or companies found.');
    } else if (active) {
      message = eligibleTeams.length + (resultsGroupFilter ?
        tr(' passende Teams in ', ' matching teams in ') + poolLabel(resultsGroupFilter, false) +
          tr(' · die gewählte Gruppe bleibt vollständig sichtbar.', ' · the selected pool remains complete.') :
        tr(' passende Teams.', ' matching teams.'));
    } else {
      message = tr('Alle Teams und Gruppen werden angezeigt.', 'All teams and pools are shown.');
    }
    if (resultsGroupFilter) message += ' ' + tr('Der Gruppenfilter wirkt nur auf die Gruppentabellen.', 'The pool filter applies only to the pool tables.');
    message += ' ' + tr('Die Firmenwertung bleibt vollständig und wird aus allen Teams berechnet.', 'Company standings remain complete and are calculated from all teams.');
    if (!resultsState().played) message += ' ' + tr('Noch keine Ergebnisse erfasst.', 'No results have been recorded yet.');
    return message;
  }
  function shuffle(ids) {
    const out = ids.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const n = i + 1, limit = Math.floor(4294967296 / n) * n, buf = new Uint32Array(1);
      do { crypto.getRandomValues(buf); } while (buf[0] >= limit);
      const j = buf[0] % n, tmp = out[i]; out[i] = out[j]; out[j] = tmp;
    }
    return out;
  }
  // Before the first start only: drop absent teams from registration and rebuild the unstarted pool plan.
  async function removeAbsentTeams() {
    if (!unstartedPlan()) throw new Error(tr('Nur vor dem ersten Start möglich. Danach Nichtantreten oder Rückzug je Spiel entscheiden.', 'Only possible before the first start. Afterwards decide a nonappearance or withdrawal per match.'));
    const ids = event.teams.filter(t => isAbsent(t.id)).map(t => t.id);
    if (!ids.length) throw new Error(tr('Keine abwesenden Teams gemeldet.', 'No absent teams reported.'));
    const next = F.clone(event);
    next.status = 'draft'; next.matches = []; next.pools = []; next.drawOrder = [];
    next.groupAssignments = [];
    next.teams = next.teams.filter(t => ids.indexOf(t.id) < 0);
    ids.forEach(id => { delete next.checkIns[id]; });
    const emptied = next.organizations.filter(o => !next.teams.some(t => t.orgId === o.id));
    next.organizations = next.organizations.filter(o => emptied.indexOf(o) < 0);
    next.organizations.forEach(o => {
      if (ids.indexOf(o.nominee) < 0) return;
      const candidates = next.teams.filter(t => t.orgId === o.id);
      o.nominee = candidates.length === 1 ? candidates[0].id : null;
    });
    try { readyTeams(next); } catch (error) {
      throw new Error(error.message + ' ' + tr('Nichts wurde geändert; bitte zuerst unter „Firmen & Teams“ anpassen.', 'Nothing was changed; adjust under “Companies & teams” first.'));
    }
    if (!confirmPlacementChange(next)) return;
    const built = F.build(next);
    if (!confirm(tr('Abwesende Teams aus der Anmeldung entfernen und Gruppenplan neu erstellen?', 'Remove absent teams from registration and rebuild the pool schedule?') + '\n' +
        tr('Entfernt: ', 'Removed: ') + ids.map(teamName).join(', ') +
        (emptied.length ? '\n' + tr('Ohne verbleibendes Team ebenfalls entfernt: ', 'Also removed, no team left: ') + emptied.map(o => o.name).join(', ') : '') + '\n' +
        tr('Noch nichts ist gestartet. Der neue Plan ersetzt den bisherigen vorläufigen Plan.', 'Nothing has started yet. The new schedule replaces the previous preliminary one.'))) return;
    await save(built, tr('Teams entfernt und Gruppenplan neu erstellt: ', 'Teams removed and pool schedule rebuilt: ') + built.matches.length + tr(' Spiele.', ' matches.'));
  }
  async function runAction(name, companyId, teamId, actionNode) {
    if (['reset-points', 'reset-config', 'restart-edit'].indexOf(name) >= 0) {
      await restartConfiguration(name);
    } else if (name === 'save-setup') {
      const controls = app.querySelectorAll('[data-action="save-setup"]');
      if (!hasUnsavedSetup() && controls.length) return;
      let next;
      if (invalidSetupSettings()) {
        setupSettingsDraft = captureSetupSettings();
        next = copyDraftFromForm();
        next.config = event.config;
        next.title = event.title;
        if (!next.replans.length) next.fieldLimit = F.courtCapacity(next);
        await save(next, tr('Entwurf gespeichert. Ungültige Regeleingaben sind noch nicht gespeichert.', 'Draft saved. Invalid rule settings are still unsaved.'));
        notify(tr('Entwurf gespeichert. Ungültige Regeleingaben sind noch nicht gespeichert.', 'Draft saved. Invalid rule settings are still unsaved.'), true);
      } else {
        next = editedProgress();
        if (next) {
          setupSettingsDraft = null;
          await save(next, tr('Entwurf gespeichert.', 'Draft saved.'));
        }
      }
    } else if (name === 'send-public-link') {
      const field = document.getElementById('fc-share-url');
      if (!field) throw new Error(tr('Linkfeld nicht gefunden.', 'Link field not found.'));
      try {
        if (typeof navigator.share !== 'function') throw new Error('Web Share unavailable');
        await navigator.share({ title: event.title, url: field.value,
          text: tr('Firmencup: Live-Spielplan und Ergebnisse · nur ansehen', 'Company cup: live fixtures and results · view only') });
        notify(tr('Link an die App übergeben.', 'Link handed to the app.'));
      } catch (error) {
        if (error.name === 'AbortError') return;
        await runAction('copy-share-link', null, null, { dataset: { copyTarget: 'fc-share-url' } });
      }
    } else if (name === 'copy-share-link') {
      const field = document.getElementById(actionNode && actionNode.dataset.copyTarget);
      if (!field) throw new Error(tr('Linkfeld nicht gefunden.', 'Link field not found.'));
      let copied = false;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        try {
          await navigator.clipboard.writeText(field.value);
          copied = true;
        } catch (error) {
          copied = false;
        }
      }
      if (!copied) {
        field.focus();
        field.select();
        try {
          copied = !!document.execCommand('copy');
        } catch (error) {
          throw new Error(tr('Kopieren fehlgeschlagen. Bitte den markierten Link manuell kopieren.', 'Copy failed. Please copy the selected link manually.'));
        }
      }
      if (!copied) throw new Error(tr('Kopieren fehlgeschlagen. Bitte den markierten Link manuell kopieren.', 'Copy failed. Please copy the selected link manually.'));
      notify(tr('Link kopiert.', 'Link copied.'));
    } else if (name === 'build') {
      if (invalidSetupSettings()) {
        const form = document.getElementById('fc-edit');
        const invalidFields = form && Array.from(form.querySelectorAll(
          '[name="title"], [name="start"], [name="end"], [name="minutes"], [name="treeMinutes"], [name="timingMode"], [name="groupCount"], [name="placementThrough"], [name="change"], [name="rest"], [name="fields"], [name="referees"], [name="refereeMode"], [name="rankingMode"], [name="tiePolicy"]'
        )).filter(field => !field.validity.valid);
        const invalid = invalidFields && (invalidFields.find(field => field.validationMessage) || invalidFields[0]);
        if (invalid) {
          invalid.focus();
          notify(invalid.validationMessage || tr('Bitte prüfe die ungültigen Regeleingaben.', 'Please review the invalid rule settings.'), true);
        }
        return;
      }
      if (event.teams.length === 2 && config(document.getElementById('fc-edit')).config.refereeMode === 'teams') {
        updateSetupPreview();
        const control = document.getElementById('fc-setup-advice').querySelector('button');
        if (control) control.click();
        notify(document.getElementById('fc-setup-preview-status').textContent, true);
        return;
      }
      const next = copyDraftFromForm(); readyTeams(next);
      const samePlan = event.matches.length &&
        JSON.stringify(next.config) === JSON.stringify(event.config) &&
        JSON.stringify(next.teams) === JSON.stringify(event.teams) &&
        JSON.stringify(next.organizations) === JSON.stringify(event.organizations);
      const draft = samePlan ? next : reopenDraft(next);
      if (!draft) return;
      const plan = samePlan ? next : F.build(draft);
      setupSettingsDraft = null;
      if (await save(plan)) showPhase('play', true);
    } else if (name === 'reopen') {
      const next = reopenDraft(copyDraftFromForm());
      if (next) await save(next);
    } else if (name === 'add-org') {
      const countInput = document.querySelector('[name="org-count"]'), count = Number(countInput.value);
      const remaining = F.MAX_ORGANIZATIONS - event.organizations.length;
      if (!Number.isInteger(count) || count < 1 || count > remaining) {
        countInput.focus();
        throw new Error(tr('Noch mögliche Firmen: ', 'Remaining company capacity: ') + remaining +
          tr('. Eine positive ganze Anzahl innerhalb dieser technischen Grenze eingeben.', '. Enter a positive whole number within this technical limit.'));
      }
      const next = reopenDraft(copyDraftFromForm());
      if (!next) return;
      const firstId = 'o-' + uid(), start = next.organizations.length;
      for (let i = 0; i < count; i++) {
        next.organizations.push({ id: i === 0 ? firstId : 'o-' + uid(),
          name: entityDefaultName(start + i + 1), nominee: null });
      }
      await save(next);
      app.querySelector('[data-org-name="' + firstId + '"]').focus();
    } else if (name === 'add-team' || name === 'remove-team') {
      if (name === 'add-team' && event.teams.length >= teamLimit(event)) {
        throw new Error(tr('Maximal ', 'Maximum ') + teamLimit(event) + tr(' Teams in diesem Planformat.', ' teams in this plan format.'));
      }
      const draftCard = companyId && app.querySelector('[data-team-draft="' + companyId + '"]');
      if (name === 'add-team' && draftCard) draftCard.setAttribute('data-draft-commit', '');
      const next = reopenDraft(invalidSetupSettings() ? draftForPhaseChange() : copyDraftFromForm());
      if (!next) return;
      const added = next.teams.find(team => team.orgId === companyId && !event.teams.some(old => old.id === team.id));
      let addedTeamId = added ? added.id : null;
      if (name === 'add-team' && !added) {
        if (next.teams.length >= teamLimit(next)) throw new Error(tr('Maximal ', 'Maximum ') + teamLimit(next) + tr(' Teams in diesem Planformat.', ' teams in this plan format.'));
        if (!next.organizations.length) throw new Error(tr('Zuerst eine Firma anlegen.', 'Create a company first.'));
        const orgField = document.getElementById('fc-new-team-org');
        const orgId = companyId || (orgField && orgField.value);
        if (!next.organizations.some(o => o.id === orgId)) throw new Error(tr('Firma für das neue Team wählen.', 'Choose a company for the new team.'));
        const id = 't-' + uid();
        addedTeamId = id;
        next.teams.push({ id: id, name: nextTeamName(next.teams.map(t => t.name)), orgId: orgId, roster: [] });
        const organization = next.organizations.find(o => o.id === orgId);
        if (organization.nominee === null) organization.nominee = id;
      } else if (name === 'remove-team') {
        if (!next.teams.length) throw new Error(tr('Kein Team vorhanden.', 'No team to remove.'));
        const index = teamId ? next.teams.findIndex(t => t.id === teamId) : next.teams.length - 1;
        if (index < 0) throw new Error(tr('Team nicht gefunden.', 'Team not found.'));
        const removed = next.teams.splice(index, 1)[0];
        if (next.checkIns) delete next.checkIns[removed.id];
        next.organizations.forEach(o => {
          if (!next.teams.some(t => t.id === o.nominee && t.orgId === o.id)) {
            const candidates = next.teams.filter(t => t.orgId === o.id);
            if (!candidates.length) { o.nominee = null; return; }
            if (candidates.length !== 1) { o.nominee = null; return; }
            o.nominee = candidates[0].id;
          }
        });
      }
      if (!confirmPlacementChange(next)) return;
      if (addedTeamId) generatedTeamNames.set(addedTeamId, next.teams.find(team => team.id === addedTeamId).name);
      await save(next);
      if (addedTeamId) {
        const input = app.querySelector('[data-team-name="' + addedTeamId + '"]');
        const details = input.closest('.fc-company-teams');
        if (details) details.open = true;
        input.focus();
        input.select();
      }
    } else if (name === 'remove-absent') {
      await removeAbsentTeams();
    } else if (name === 'finals') {
      if (!confirm(tr('Restgleichstände auslosen, Gruppenergebnisse einfrieren und Endphase planen?', 'Draw unresolved ties, freeze group scores and schedule finals?'))) return;
      await save(F.finals(event, shuffle(event.teams.map(t => t.id))));
    } else if (name === 'start-wave') {
      const wave = Number(document.getElementById('fc-wave').value);
      const matches = event.matches.filter(m => m.wave === wave && !event.results[m.id] && !event.outcomes[m.id]);
      if (matches.some(m => !F.resolve(event, m.a) || !F.resolve(event, m.b))) throw new Error(tr('Spielrunde enthält noch nicht zugeordnete Spiele.', 'Time slot contains unassigned matches.'));
      F.beginWave(event, wave, new Date().toISOString());
      if (!confirm(tr('Spielrunde ' + (wave + 1) + ' jetzt zentral starten? Einstellungen und Teamauswahl für den Firmenpokal werden gesperrt. Timer ist nur eine lokale Uhrhilfe.', 'Start time slot ' + (wave + 1) + ' centrally now? Settings and the team choice for the company trophy will be locked. Timer is only a local clock aid.'))) return;
      const started = F.beginWave(event, wave, new Date().toISOString());
      // A new running slot supersedes the "just scored" focus, so completed slots fold back to one line.
      lastScored = null;
      await save(started);
      const firstInput = app.querySelector('#fc-wave-group-' + wave + ' .fc-result input');
      if (firstInput) { firstInput.scrollIntoView({ block: 'center' }); firstInput.focus(); }
    } else if (name === 'replan') {
      const fromWave = Number(document.getElementById('fc-replan-wave').value);
      const delay = Number(document.getElementById('fc-replan-delay').value);
      const fields = Number(document.getElementById('fc-replan-fields').value);
      const reason = document.getElementById('fc-replan-reason').value.trim();
      const before = event.matches.filter(m => m.wave >= fromWave && !event.results[m.id] && !event.outcomes[m.id]);
      const preview = F.replan(event, fromWave, delay, fields, reason);
      const after = preview.matches.filter(m => m.wave >= fromWave && !event.results[m.id] && !event.outcomes[m.id]);
      const end = list => Math.max.apply(null, list.map(m => m.startMin + F.matchMinutes(preview, m.phase)));
      const summary = tr('Umplanung ab Spielrunde ', 'Replan from time slot ') + (fromWave + 1) + ': ' + before.length +
        tr(' ungestartete Begegnungen. Bisheriges Planende ', ' unstarted fixtures. Previous scheduled end ') +
        F.clock(end(before)) + tr(', neues Planende ', ', new scheduled end ') + F.clock(end(after)) + '. ' +
        delay + tr(' Minuten Verzögerung, ', ' minutes delay, ') + fields + tr(' Felder. ', ' courts. ') +
        tr('Gestartete/gespielte Begegnungen bleiben unangetastet. Diese Umplanung wird mit Grund protokolliert und bei Live-Link übertragen.', 'Started/played fixtures remain untouched. The replan is recorded with its reason and synchronized when a live link is enabled.');
      if (!confirm(summary)) return;
      await save(preview, tr('Restspielplan umgeplant und protokolliert.', 'Remaining schedule replanned and recorded.'));
    } else if (name === 'backup') {
      download({ kind: 'firmencup-backup', version: 1, event: event }, event.id + '.json');
    } else if (name === 'previous') {
      if (!confirm(tr('Vorherigen Stand als neue Veranstaltung kopieren? Die aktuelle bleibt unverändert.', 'Copy previous revision as a new event? Current event remains unchanged.'))) return;
      await restore(await Store.previous(event.id));
    } else if (name === 'share') {
      if (!document.getElementById('fc-share-consent').checked) throw new Error(tr('Live-Speicherung auf dem Server zuerst bestätigen.', 'Confirm live saving on the server first.'));
      const published = !!(binding && binding.id);
      if (!published && !document.getElementById('fc-public-consent').checked) {
        throw new Error(tr('Öffentliche Ansicht zuerst ausdrücklich bestätigen.', 'Explicitly confirm public viewing first.'));
      }
      binding = await Server.publish(event, published ? undefined : { publicRead: true });
      render();
      notify(published ? tr('Live-Speicherung aktualisiert.', 'Live saving updated.') :
        tr('Öffentlicher Live-Link und QR-Code bereit. Jede Person mit dem Link kann den Turnierstand ansehen.', 'Public live link and QR code ready. Anyone with the link can view the event.'));
    } else if (name === 'revoke-participant' || name === 'revoke-admin') {
      await saveSharing(name === 'revoke-participant' ? { revokeParticipant: true } : { revokeAdmin: true });
      notify(tr('Zugriff widerrufen.', 'Access revoked.'));
    } else if (name === 'toggle-public') {
      const publicRead = !(binding.access && binding.access.publicRead);
      if (publicRead && !document.getElementById('fc-public-consent').checked) {
        throw new Error(tr('Öffentliche Ansicht zuerst ausdrücklich bestätigen.', 'Explicitly confirm public viewing first.'));
      }
      await saveSharing({ publicRead: publicRead });
      notify(tr('Öffentlicher Zugriff aktualisiert.', 'Public access updated.'));
    } else if (name === 'admin-logout') {
      await Server.logout(binding);
      event = null;
      adminUnlock(binding.id, binding.adminShareToken, binding);
      notify(tr('Adminzugriff gesperrt.', 'Admin access locked.'));
    } else if (name === 'server-reload') {
      await reloadServerConflict();
    }
  }
  function download(data, name) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = 'firmencup-' + name;
    document.body.appendChild(a); a.click(); a.parentNode.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function restoreFile(file) {
    if (!file) return;
    if (file.size > 2000000) throw new Error('Backup too large / Sicherung zu groß');
    const raw = await new Promise((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error); reader.readAsText(file);
    });
    const data = JSON.parse(raw);
    if (!data || data.kind !== 'firmencup-backup' || data.version !== 1) throw new Error('Own Firmencup backup required / Eigene Firmencup-Sicherung erforderlich');
    await restore(F.validate(data.event));
  }
  async function restore(source) {
    const copy = F.clone(source); copy.id = uid(); copy.revision = 0;
    event = await Store.save(F.validate(copy));
    binding = null; livePublic = false; liveRevision = null; liveEtag = null;
    participant = false; readOnly = false; setupSettingsDraft = null;
    lastScored = null; routedHash = null;
    history.replaceState(null, '', '?local=' + event.id + '&lang=' + (en ? 'en' : 'de'));
    render(); notify(tr('Als neue Veranstaltung auf diesem Gerät wiederhergestellt; keine bestehende Veranstaltung überschrieben.', 'Restored as a new event on this device; no existing event overwritten.'));
  }
  function updateCountdown() {
    const node = document.getElementById('fc-countdown');
    if (!node || !event) return;
    if (!event.liveWave) { node.textContent = readOnly ? tr('Noch kein tatsächlicher Start.', 'No actual start yet.') : ''; return; }
    const elapsed = Math.max(0, Math.floor((Date.now() - Date.parse(event.liveWave.startedAt)) / 1000));
    const match = event.matches.find(m => m.wave === event.liveWave.wave);
    const play = F.matchMinutes(event, match.phase) * 60, slot = play + event.config.change * 60;
    const remain = Math.max(0, (elapsed < play ? play : slot) - elapsed);
    node.textContent = tr('Spielrunde ', 'Time slot ') + (event.liveWave.wave + 1) + ' · ' +
      (elapsed < play ? tr('Spiel läuft ', 'Playing ') : elapsed < slot ? tr('Abpfiff / Wechsel ', 'Whistle / changeover ') : tr('Spielrunde beendet ', 'Time slot ended ')) +
      Math.floor(remain / 60) + ':' + String(remain % 60).padStart(2, '0');
  }
  document.documentElement.lang = en ? 'en' : 'de';
  identity();
  const header = window.TSheetHeader.create({
    title: tr('Firmencup', 'Company cup'),
    overviewHref: 'index.html?lang=' + (en ? 'en' : 'de')
  });
  document.body.insertBefore(header, document.body.firstChild);
  window.addEventListener('beforeprint', function () {
    printing = true;
    app.querySelectorAll('details').forEach(node => { node.dataset.printOpen = node.open ? '1' : '0'; node.open = true; });
    app.querySelectorAll('.fc-fixture, .fc-wave-group, .fc-wave-pool').forEach(node => { node.hidden = false; });
    resultsFilter();
  });
  window.addEventListener('hashchange', followAnchor);
  window.addEventListener('afterprint', function () {
    app.querySelectorAll('details[data-print-open]').forEach(node => { node.open = node.dataset.printOpen === '1'; });
    printing = false;
    if (document.getElementById('fc-search')) search();
    resultsFilter();
  });
  window.addEventListener('focus', function () {
    if (!readOnly && event && !busy) Store.load(event.id).then(function (disk) {
      if (disk && disk.revision !== event.revision) notify(tr('Anderer Tab hat diese Veranstaltung gespeichert. Neu laden; ungespeicherte Eingaben zuerst sichern.', 'Another tab saved this event. Reload; preserve unsaved entries first.'));
    }, function (error) { console.error('Firmencup:', error); notify(error.message, true); });
    if (livePublic) pollPublic();
    else if ((!readOnly || participant) && event) pollEditor();
  });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') {
      if (livePublic) pollPublic();
      else if ((!readOnly || participant) && event) pollEditor();
    }
  });
  setInterval(updateCountdown, 1000);
  setInterval(function () {
    if (livePublic) pollPublic();
    else if ((!readOnly || participant) && event) pollEditor();
  }, 15000);
  action(async function () {
    if (linkAccess && params.has('server')) {
      if (linkAccess.role === 'admin') adminUnlock(params.get('server'), linkAccess.token);
      else await openAccess(params.get('server'), linkAccess.token, 'participant');
    } else if (params.has('local') && !readOnly) {
      // Public routes must never open a private local record, even when ?local= is appended.
      binding = await Server.load(params.get('local'));
      await resumeSharing();
      if (binding && binding.role === 'admin' && !binding.token) {
        adminUnlock(binding.id, binding.adminShareToken, binding);
        return;
      }
      event = await Store.load(params.get('local'));
      if (!event) throw new Error('Local event not found / Lokale Veranstaltung nicht gefunden');
      participant = !!(binding && binding.role === 'participant'); readOnly = participant;
      render();
      if (participant) setTimeout(pollEditor, 0);
    } else if (readOnly) {
      const remote = await Server.get(params.get('eventId'));
      if (remote.canEdit) throw new Error('Public link unexpectedly has editor access / Öffentlicher Link besitzt unerwartet Bearbeitungsrechte');
      event = F.validate(remote.event, { publicSnapshot: true });
      livePublic = true; liveRevision = remote.revision; liveEtag = remote.etag;
      render();
    } else if (capability && params.has('server')) {
      const serverId = params.get('server');
      const remote = await Server.get(serverId, capability);
      if (!remote.canEdit) throw new Error(tr('Dieser Link besitzt keine Bearbeitungsberechtigung.', 'This link has no editor permission.'));
      const incoming = F.validate(remote.event);
      const existing = await Store.load(incoming.id);
      if (existing && Server.fingerprint(existing) !== Server.fingerprint(incoming)) {
        if (!confirm(tr('Auf diesem Gerät liegt bereits eine andere Veranstaltung mit derselben internen ID. Diese lokale Fassung zuerst als unabhängige Kopie sichern und dann den Serverstand laden?', 'This device already has a different event with the same internal ID. Save the local version as an independent copy before loading the server version?'))) {
          throw new Error(tr('Serverstand nicht geladen; lokale Daten bleiben unverändert.', 'Server event was not loaded; local data remains unchanged.'));
        }
        const draft = F.clone(existing); draft.id = uid(); draft.revision = 0;
        draft.title = String(draft.title + tr(' · lokale Kopie', ' · local copy')).slice(0, 120);
        await Store.save(F.validate(draft));
        incoming.revision = 0;
        event = await Store.replace(incoming);
      } else if (existing) event = existing;
      else { incoming.revision = 0; event = await Store.save(incoming); }
      binding = await Server.adopt(event.id, serverId, capability, remote.revision, event, 'owner');
      binding = await Server.rememberAccess(binding, remote.access);
      history.replaceState(null, '', '?local=' + encodeURIComponent(event.id) + '&lang=' + (en ? 'en' : 'de'));
      render();
      notify(tr('Bearbeitungsrecht geladen. Dieses Browsergerät kann nun synchronisieren.', 'Editor capability loaded. This browser can now synchronize.'));
    } else await landing();
  });
})();
