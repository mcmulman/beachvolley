(function () {
  'use strict';
  const F = window.Firmencup, Store = window.FirmencupStore, Share = window.FirmencupShare, Server = window.FirmencupServer;
  const params = new URLSearchParams(location.search), en = window.TI18n.lang() === 'en';
  const capability = Server.capabilityFromHash(location.hash);
  const legacySnapshot = location.hash.indexOf('#snapshot=') === 0;
  const readOnly = legacySnapshot || (params.has('eventId') && !capability);
  const app = document.getElementById('fc-app'), message = document.getElementById('fc-message');
  const statusBar = document.getElementById('fc-status-bar'), statusNext = document.getElementById('fc-status-next');
  const statusNextLabel = document.getElementById('fc-status-next-label'), statusActionLink = document.getElementById('fc-status-action');
  let event = null, capturedAt = null, busy = false, setupStep = 1, setupSettingsDraft = null, phase = null, routedHash = null, toolsReturn = null, lastScored = null;
  let binding = null, livePublic = false, liveRevision = null, liveEtag = null;
  let currentStatusAction = null;
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
        phase: 'configuration',
        step: 1,
        target: function () { return app.querySelector('[data-action="add-org"]'); }
      };
      const emptyOrganization = event.organizations.find(o => !event.teams.some(t => t.orgId === o.id));
      if (emptyOrganization || event.teams.length < F.teamLimits(event).min) {
        const organization = emptyOrganization || event.organizations[0];
        return {
          label: tr('Team hinzufügen', 'Add a team'),
          href: '#fc-editor',
          phase: 'configuration',
          step: 1,
          target: function () {
            return Array.from(app.querySelectorAll('[data-action="add-team"]'))
              .find(node => node.dataset.company === organization.id) || app.querySelector('[data-action="add-team"]');
          }
        };
      }
      const missingNominee = event.organizations.find(o =>
        !event.teams.some(t => t.id === o.nominee && t.orgId === o.id));
      if (missingNominee) return {
        label: tr('Team für den Firmenpokal wählen', 'Choose the company trophy team'),
        href: '#fc-editor',
        phase: 'configuration',
        step: 1,
        target: function () {
          return Array.from(app.querySelectorAll('[data-nominee]'))
            .find(node => node.dataset.nominee === missingNominee.id);
        }
      };
      const oldRosterTeam = event.formatVersion < 3 && event.teams.find(t => t.roster.length < 2);
      if (oldRosterTeam) return {
        label: tr('Spieler:innen-Namen ergänzen', 'Add player names'),
        href: '#fc-editor',
        phase: 'configuration',
        step: 1,
        target: function () {
          return Array.from(app.querySelectorAll('.fc-roster-details'))
            .find(node => node.dataset.rosterTeam === oldRosterTeam.id);
        }
      };
      return {
        label: tr('Regeln prüfen und Gruppenplan erstellen', 'Review rules and build the group schedule'),
        href: '#fc-editor',
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
      target: function () { return document.getElementById(targetId); }
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
      if (next.phase === 'configuration') {
        if (phase !== 'configuration') {
          phase = 'configuration';
          setupStep = next.step;
          render();
        } else if (next.step !== setupStep && !event.startedAt) {
          await goStep(next.step, false);
        } else if (next.step !== setupStep) {
          setupStep = next.step;
          render();
        }
      } else if (next.phase) {
        if (phase === 'configuration' && !event.startedAt) {
          const updated = editedProgress();
          if (!updated) return;
          await save(updated);
        }
        showPhase(next.phase, false);
      }
      focusStatusTarget(next.target());
    });
  };
  function button(action, label) { return '<button type="button" data-action="' + action + '">' + label + '</button>'; }
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
    return event.formatVersion >= 3 ?
      tr('Spieler:innen-Namen sind optional.', 'Player names are optional.') :
      tr('Dieses ältere Planformat benötigt mindestens zwei Spieler:innen-Namen je Team.', 'This older plan format requires at least two player names per team.');
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
  function options(items, current) {
    return items.map(t => '<option value="' + esc(t.id) + '"' + (t.id === current ? ' selected' : '') + '>' + esc(t.name) + '</option>').join('');
  }
  function captureSetupSettings() {
    const form = document.getElementById('fc-edit');
    if (!form) return null;
    const names = ['title', 'start', 'window', 'minutes', 'change', 'rest', 'fields', 'referees', 'mixed'];
    return names.reduce((draft, name) => {
      const field = form.elements.namedItem(name);
      if (field) draft[name] = field.value;
      return draft;
    }, {});
  }
  function invalidSetupSettings() {
    const form = document.getElementById('fc-edit');
    return form && Array.from(form.querySelectorAll('[name="title"], [name="start"], [name="window"], [name="minutes"], [name="change"], [name="rest"], [name="fields"], [name="referees"], [name="mixed"]'))
      .some(field => !field.validity.valid);
  }
  function settings(c) {
    const draft = setupSettingsDraft || {};
    const value = name => Object.prototype.hasOwnProperty.call(draft, name) ? draft[name] : c[name];
    return '<div class="fc-settings"><fieldset><legend>' + tr('Titel & Zeitrahmen', 'Title & timing') + '</legend><div class="fc-grid">' +
      label('title', tr('Titel', 'Title'), value('title') == null ? (event ? event.title : tr('Mein Turnier', 'My tournament')) : value('title')) +
      label('start', tr('Planstart', 'Scheduled start'), value('start'), 'time') +
      label('window', tr('Verfügbare Zeit (Min.)', 'Available event minutes'), value('window'), 'number', 30, 1440) +
      '</div></fieldset><fieldset><legend>' + tr('Spielzeit & Pausen', 'Match length & breaks') + '</legend><div class="fc-grid">' +
      label('minutes', tr('Spielzeit (Min.)', 'Match minutes'), value('minutes'), 'number', 1, 60) +
      label('change', tr('Wechselintervall (Min.)', 'Changeover minutes'), value('change'), 'number', 1, 30) +
      label('rest', tr('Freie Spielrunden zwischen Einsätzen', 'Rest time slots between matches'), value('rest'), 'number', 1, 5) +
      '</div></fieldset><fieldset><legend>' + tr('Felder & Spielregeln', 'Courts & playing rules') + '</legend><div class="fc-grid">' +
      label('fields', tr('Verfügbare Felder', 'Available courts'), value('fields'), 'number', 1, 16) +
      label('referees', tr('Externe Schiedsrichter:innen gleichzeitig', 'Dedicated external referees'), value('referees'), 'number', 1, 16) +
      '<label>' + tr('Mixed-Regel der Turnierleitung', 'Organizer mixed policy') + '<select name="mixed">' +
      '<option value="optional"' + (value('mixed') === 'optional' ? ' selected' : '') + '>' + tr('Vier Spieler:innen auf dem Feld, keine Mixed-Vorgabe', 'Four on court, no mixed requirement') + '</option>' +
      '<option value="one-woman"' + (value('mixed') === 'one-woman' ? ' selected' : '') + '>' + tr('Vier auf dem Feld, mindestens eine Frau', 'Four on court, at least one woman') + '</option></select></label></div></fieldset></div>';
  }
  function setupPreview() {
    return '<section id="fc-setup-preview" class="fc-setup-preview" aria-labelledby="fc-setup-preview-title">' +
      '<h3 id="fc-setup-preview-title">' + tr('Planung auf einen Blick', 'Schedule at a glance') + '</h3>' +
      '<p class="fc-note">' + tr('Die Vorrunde wird aus den aktuellen Teams und Einstellungen berechnet. Die Endrunde ist noch nicht ausgelost; Gesamtzeit und Mindestspiele sind eine Projektion.', 'The group stage is calculated from the current teams and settings. Finals have not been drawn; total time and minimum matches are projections.') + '</p>' +
      '<div class="fc-setup-preview-grid">' +
      [
        ['teams', tr('Teams', 'Teams')],
        ['groups', tr('Vorrundengruppen', 'Pools')],
        ['group-games', tr('Spiele Vorrunde', 'Group matches')],
        ['minimum-games', tr('Mind. Spiele je Team', 'Minimum matches per team')],
        ['courts', tr('Felder gleichzeitig', 'Concurrent courts')],
        ['waves', tr('Spielrunden Vorrunde', 'Group time slots')],
        ['group-end', tr('Planende Vorrunde', 'Group schedule end')],
        ['event-end', tr('Turnierende geschätzt', 'Estimated event end')]
      ].map(([key, caption]) => '<div class="fc-setup-kpi" data-preview="' + key + '">' +
        '<span class="fc-setup-kpi-label">' + caption + '</span><strong data-preview-value="' + key + '">–</strong>' +
        '<small data-preview-note="' + key + '" hidden></small></div>').join('') +
      '</div><p id="fc-setup-preview-mode" class="fc-setup-preview-mode" aria-live="polite"></p>' +
      '<p id="fc-setup-preview-status" class="fc-setup-preview-status" role="status" aria-live="polite"></p></section>';
  }
  function previewMode(teamCount) {
    if (event.formatVersion < 3) return tr('Bestandsformat: vorhandene Vorrunden- und Platzierungslogik bleibt erhalten.', 'Existing format: its current group and placement logic is retained.');
    if (teamCount <= 8) return tr('Vorrunde plus zweite Jeder-gegen-jeden-Runde um alle Plätze.', 'Group stage plus a second round robin for all places.');
    if (teamCount === 9) return tr('Vorrunde, Cup um Plätze 1–4 und Platzierungsgruppe um 5–9.', 'Group stage, cup for places 1–4 and placement pool for 5–9.');
    return tr('Vorrunde, Achter-Cup um Plätze 1–8 und Platzierungsgruppen für die übrigen Teams.', 'Group stage, eight-team cup for places 1–8 and placement pools for the remaining teams.');
  }
  function updateSetupPreview() {
    const host = document.getElementById('fc-setup-preview');
    const form = document.getElementById('fc-edit');
    if (!host || !form) return;
    const values = key => host.querySelector('[data-preview-value="' + key + '"]');
    const notes = key => host.querySelector('[data-preview-note="' + key + '"]');
    const setValue = (key, value, note) => {
      values(key).textContent = value;
      notes(key).textContent = note || '';
      notes(key).hidden = !note;
    };
    const status = document.getElementById('fc-setup-preview-status');
    const mode = document.getElementById('fc-setup-preview-mode');
    const count = event.teams.length;
    setValue('teams', count + ' / ' + teamRange(event));
    setValue('groups', '–');
    setValue('group-games', '–');
    setValue('minimum-games', '–');
    setValue('courts', '–');
    setValue('waves', '–');
    setValue('group-end', '–');
    setValue('event-end', '–');
    mode.textContent = count >= F.teamLimits(event).min ? previewMode(count) : '';
    status.className = 'fc-setup-preview-status';

    const invalid = Array.from(form.querySelectorAll('input, select')).find(input => !input.validity.valid);
    if (invalid) {
      const labelText = invalid.closest('label') && invalid.closest('label').textContent.trim();
      status.textContent = tr('Vorschau pausiert: Eingabe prüfen', 'Preview paused: check the input') +
        (labelText ? ' · ' + labelText : '');
      status.classList.add('is-warning');
      return;
    }
    if (count < F.teamLimits(event).min || count > teamLimit(event)) {
      status.textContent = tr('Für eine Zeit- und Spielplanvorschau sind mindestens ', 'A schedule and timing preview needs at least ') +
        teamRange(event) + tr(' Teams erforderlich.', ' teams.');
      status.classList.add('is-warning');
      return;
    }
    const empty = event.organizations.find(o => !event.teams.some(t => t.orgId === o.id));
    if (empty) {
      status.textContent = tr('Vorschau nicht möglich: Team zuordnen oder Firma entfernen – ', 'Preview unavailable: assign a team or remove the company – ') + empty.name;
      status.classList.add('is-warning');
      return;
    }
    try {
      const draft = copyDraftFromForm();
      draft.status = 'draft';
      draft.matches = []; draft.pools = []; draft.finalPools = []; draft.drawOrder = [];
      draft.results = {}; draft.outcomes = {}; draft.startedAt = null;
      delete draft.liveWave;
      draft.fieldLimit = Math.min(draft.config.fields, draft.config.referees);
      draft.organizations.forEach(org => {
        if (!draft.teams.some(team => team.id === org.nominee && team.orgId === org.id)) {
          org.nominee = draft.teams.find(team => team.orgId === org.id).id;
        }
      });
      const plan = F.build(draft);
      const estimate = F.estimate(plan);
      const fieldLimit = Math.min(plan.config.fields, plan.config.referees);
      setValue('groups', String(plan.pools.length));
      setValue('group-games', String(plan.matches.length));
      setValue('minimum-games', String(estimate.minimumGames), tr('Vorrunde + Endrunde', 'Group stage + finals'));
      setValue('courts', String(estimate.courts), estimate.courts < plan.config.fields ?
        tr('von ' + plan.config.fields + ' möglich · Schiri-Limit ' + plan.config.referees, 'of ' + plan.config.fields + ' available · referee limit ' + plan.config.referees) :
        tr('von ' + fieldLimit + ' verfügbaren Feldern', 'of ' + fieldLimit + ' available courts'));
      setValue('waves', String(estimate.waves));
      setValue('group-end', F.clock(estimate.endMin), tr('rechnerisch ab ' + plan.config.start, 'calculated from ' + plan.config.start));
      setValue('event-end', F.clock(estimate.projectedEndMin), tr('ca. ' + estimate.projectedMinutes + ' Min. ab ' + plan.config.start, 'approx. ' + estimate.projectedMinutes + ' min from ' + plan.config.start));
      const over = estimate.projectedMinutes - plan.config.window;
      status.textContent = over > 0 ?
        tr('Gesamtprojektion überschreitet das Zeitfenster um etwa ', 'Projected event time exceeds the available window by about ') + over + tr(' Min.', ' min.') :
        tr('Gesamtprojektion liegt innerhalb des Zeitfensters von ', 'Projected event time is within the ') + plan.config.window + tr(' Min. Zeitfensters.', ' min window.');
      status.classList.add(over > 0 ? 'is-warning' : 'is-ok');
      mode.textContent = previewMode(count);
    } catch (error) {
      const emptyRoster = !(event.formatVersion >= 3) && event.teams.find(team => team.roster.length < 2);
      status.textContent = emptyRoster ?
        tr('Vorschau nicht möglich: Für dieses ältere Planformat mindestens zwei Spieler:innen-Namen je Team ergänzen.', 'Preview unavailable: add at least two player names per team for this older format.') :
        tr('Vorschau nicht möglich: ', 'Preview unavailable: ') + error.message;
      status.classList.add('is-warning');
    }
  }
  function config(form) {
    const data = new FormData(form), c = {};
    ['minutes', 'change', 'fields', 'referees', 'rest', 'window'].forEach(k => { c[k] = Number(data.get(k)); });
    c.start = data.get('start'); c.mixed = data.get('mixed');
    return { title: String(data.get('title')).trim(), config: c };
  }
  async function save(next, text) {
    if (readOnly) throw new Error('Read-only / Nur Lesen');
    event = await Store.save(next);
    binding = await Server.load(event.id);
    if (binding) {
      try {
        binding = await Server.sync(event);
        notify(tr('Lokal gespeichert und mit dem Server synchronisiert.', 'Saved locally and synchronized with the server.'), false, true);
      } catch (error) {
        console.error('Firmencup server sync:', error);
        binding = await Server.load(event.id);
        notify(error.message + (error.status === 412 ? '' :
          tr(' Änderungen bleiben auf diesem Gerät erhalten und werden später erneut übertragen.', ' Changes remain on this device and will be retried later.')), true);
      }
    } else notify(text || tr('Auf diesem Gerät gespeichert.', 'Saved on this device.'), false, true);
    render();
  }
  async function action(fn) {
    if (busy) return;
    busy = true; app.setAttribute('aria-busy', 'true');
    try { await fn(); } catch (error) { console.error('Firmencup:', error); notify(error.message, true); }
    finally { busy = false; app.setAttribute('aria-busy', 'false'); }
  }
  const defaults = { start: '13:00', minutes: 14, change: 3, fields: 8, referees: 8, rest: 1, window: 360, mixed: 'optional' };
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
      return row.error ? '<div class="fc-local-entry fc-local-entry-error"><p>' + esc(row.id) + ': ' + esc(row.error) + '</p>' +
        '<div class="fc-local-actions">' +
        (row.removal ? '<button type="button" data-recover="' + esc(row.id) + '">' + tr('Vorherigen Stand als Kopie retten', 'Recover previous snapshot as copy') + '</button>' : '') +
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
        setupStep = 1; phase = 'configuration';
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
  function ordering(kind, id, index, length, name) {
    return '<div class="fc-order">' + [-1, 1].map(direction =>
      '<button type="button" data-order="' + kind + '" data-id="' + esc(id) + '" data-direction="' + direction +
      '" aria-label="' + esc(name + ' · ' + (direction < 0 ? tr('Nach oben', 'Move up') : tr('Nach unten', 'Move down'))) + '"' +
      ' title="' + esc(name + ' · ' + (direction < 0 ? tr('Nach oben', 'Move up') : tr('Nach unten', 'Move down'))) + '"' +
      ((direction < 0 ? index === 0 : index === length - 1) ? ' disabled' : '') + '>' +
      '<span aria-hidden="true">' + (direction < 0 ? '↑' : '↓') + '</span></button>').join('') + '</div>';
  }
  function setupNavigation() {
    return '<nav class="fc-steps fc-substeps noprint" aria-label="' + tr('Konfiguration', 'Configuration') + '">' +
      [tr('1 · Firmen & Teams', '1 · Companies & teams'), tr('2 · Regeln & Spielplan', '2 · Rules & schedule')].map((name, index) =>
        '<button type="button" data-step="' + (index === 0 ? 1 : 3) + '"' + (setupStep === (index === 0 ? 1 : 3) ? ' aria-current="step"' : '') +
        (event.startedAt ? ' disabled' : '') + '>' + name + '</button>').join('') + '</nav>';
  }
  function trophyChoice(o) {
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
  function editor() {
    if (event.startedAt) return '<section id="fc-registration"><h2>' +
      tr('Firmen & Teams', 'Companies & teams') + '</h2><p class="fc-note">' +
      tr('Spielplan und Ergebnisse bleiben beim Firmenwechsel erhalten. Namen und Regeln sind seit Spielbeginn gesperrt.',
        'Changing a company preserves fixtures and results. Names and rules are locked after play starts.') + '</p>' +
      event.organizations.map(o => '<fieldset class="fc-entity-card"><legend>' + esc(o.name) + '</legend><details><summary>' +
        tr('Teams', 'Teams') + ' (' + event.teams.filter(t => t.orgId === o.id).length + ')</summary>' +
        event.teams.filter(t => t.orgId === o.id).map(t => '<div class="fc-team-card"><h3>' + esc(t.name) + '</h3>' +
          transferControls(t) + '</div>').join('') + '</details></fieldset>').join('') + '</section>';
    return '<section id="fc-editor" class="noprint">' + setupNavigation() +
      '<p class="fc-note">' + tr('Bis zum Spielbeginn kannst du alle Angaben ändern.', 'You can edit all details until play starts.') + '</p>' +
      '<form id="fc-edit" novalidate><fieldset data-panel="1"' + (setupStep !== 1 ? ' hidden' : '') + '><legend>' + tr('Firma/Organisation/Gruppe anlegen', 'Create Company/Organization/Group') + '</legend>' +
      '<p class="fc-guide">' + tr('1. Firmen und Teams zuerst: Ihre Anzahl und Zuordnung bestimmen Gruppen, Spiele und die anschließende Zeit-/Feldvorschau. Öffne „Teams“ bei einer Firma. ', '1. Companies and teams first: their count and assignments determine pools, matches and the timing/court preview that follows. Open “Teams” inside a company. ') + rosterGuidance() + '</p>' +
      (!event.organizations.length ? '<p class="fc-empty">' + tr('Noch keine Firma angelegt. Füge zuerst eine Firma hinzu.', 'No companies yet. Add a company first.') + '</p>' : '') +
      event.organizations.map((o, index) => '<fieldset class="fc-entity-card" data-company="' + esc(o.id) + '"><legend>' + esc(o.name) + '</legend><div class="fc-row"><label>' + tr('Name', 'Name') +
        '<input data-org-name="' + esc(o.id) + '" value="' + esc(o.name) + '" maxlength="100" required></label>' +
        trophyChoice(o) +
        '<div class="fc-company-actions">' + ordering('organizations', o.id, index, event.organizations.length, o.name) +
        '<button type="button" class="fc-delete-company" data-remove-org="' + esc(o.id) + '" aria-label="' + esc(tr('Firma entfernen: ', 'Remove company: ') + o.name) + '" title="' + esc(tr('Firma entfernen: ', 'Remove company: ') + o.name) + '"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/></svg></button></div></div></fieldset>').join('') +
      '<p class="fc-note" id="fc-company-progress">' + event.organizations.length + ' / ' + F.MAX_ORGANIZATIONS +
        tr(' Firmen · technische Kapazitätsgrenze.', ' companies · technical capacity limit.') + '</p>' +
      label('org-count', tr('Wie viele Firmen hinzufügen?', 'How many companies to add?'), 1, 'number', 1, Math.max(1, F.MAX_ORGANIZATIONS - event.organizations.length)) +
      '<button type="button" data-action="add-org"' + (event.organizations.length >= F.MAX_ORGANIZATIONS ? ' disabled' : '') + '>' + tr('+ Firma hinzufügen', '+ Add company') + '</button>' +
      '<p class="fc-note">' + tr('Eingaben werden nicht automatisch gespeichert. „Speichern“ bleibt hier; „Weiter“ prüft die Angaben und sichert den Entwurf.', 'Changes are not saved automatically. “Save” stays here; “Continue” validates and saves the draft.') + '</p>' +
      '<div class="fc-step-actions">' + button('save-setup', tr('Speichern', 'Save')) +
      '<button type="button" data-next="3" aria-label="' + esc(tr('Weiter zu Regeln & Spielplan', 'Continue to rules & schedule')) + '"' +
      (!event.organizations.length ? ' disabled' : '') + '>' + tr('Weiter', 'Continue') + '</button></div></fieldset>' +
      '<fieldset data-panel="2"' + (setupStep !== 2 ? ' hidden' : '') + '><legend>2. ' + tr('Teams & Spieler:innen anlegen', 'Create teams & players') + '</legend>' +
      '<p class="fc-guide">' + tr('Füge Teams zu den Firmen hinzu. Teamnamen genügen für die Planung; Spieler:innen-Namen sind optional.', 'Add teams to companies. Team names are enough for planning; player names are optional.') + '</p>' +
      '<label>' + tr('Firma für neues Team', 'Company for new team') +
        '<select id="fc-new-team-org">' + options(event.organizations, event.organizations[0] && event.organizations[0].id) + '</select></label>' +
        '<p class="fc-note" id="fc-team-progress">' + event.teams.length + tr(' Teams angelegt · für den Spielplan: ', ' teams added · schedule needs ') + teamRange(event) + ' ' + tr('Teams.', 'teams.') + '</p>' +
        (!event.teams.length ? '<p class="fc-empty">' + tr('Noch keine Teams. Wähle oben eine Firma und klicke auf „+ Team“.', 'No teams yet. Choose a company above, then select “+ Team”.') + '</p>' : '') +
        event.teams.map((t, index) => '<fieldset class="fc-team-card" id="fc-team-card-' + esc(t.id) + '"><legend>' + esc(t.name) + ' · ' + esc(orgName(t.orgId)) + '</legend><div class="fc-row"><label>' + tr('Teamname', 'Team name') +
          '<input data-team-name="' + esc(t.id) + '" value="' + esc(t.name) + '" maxlength="100" required></label>' +
          '<label>' + tr('Firma', 'Company') + '<select data-team-org="' + esc(t.id) + '">' + options(event.organizations, t.orgId) + '</select></label>' +
          '<details class="fc-roster-details" data-roster-team="' + esc(t.id) + '"><summary>' +
          (event.formatVersion >= 3 ? tr('Namen ergänzen', 'Add names') : tr('Spieler:innen-Namen (mindestens zwei)', 'Player names (at least two)')) + '</summary><div class="fc-roster">' +
          Array.from({ length: Math.max(2, t.roster.length) }, (_, member) => '<label>' + tr('Spieler:in ', 'Player ') + (member + 1) +
            '<input data-member="' + esc(t.id) + '" data-index="' + member + '" maxlength="100" value="' + esc(t.roster[member] || '') + '"></label>').join('') +
          '<p class="fc-note">' + (event.formatVersion >= 3 ?
            tr('Optional · nicht öffentlich angezeigt', 'Optional · not shown publicly') :
            tr('Nicht öffentlich angezeigt', 'Not shown publicly')) + '</p>' +
          '<button type="button" data-add-member="' + esc(t.id) + '">' + tr('+ Spieler:in', '+ Player') + '</button></div></details>' +
          '<div class="fc-company-actions">' + ordering('teams', t.id, index, event.teams.length, t.name) +
          '<button type="button" class="fc-delete-company" data-action="remove-team" data-team="' + esc(t.id) + '" aria-label="' + esc(tr('Team entfernen: ', 'Remove team: ') + t.name) + '" title="' + esc(tr('Team entfernen: ', 'Remove team: ') + t.name) + '"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/></svg></button></div></div></fieldset>').join('') +
      '<button type="button" data-action="add-team"' + (!event.organizations.length || event.teams.length >= teamLimit(event) ? ' disabled' : '') + '>+ Team</button>' +
      (event.teams.length ? button('remove-team', tr('Letztes Team entfernen', 'Remove last team')) : '') +
      (event.organizations.some(o => event.teams.filter(t => t.orgId === o.id).length > 1 && o.nominee === null) ?
        '<p class="fc-note">' + tr('Noch offen: Wähle unter „Firmen“ je Firma ein Team für die vorläufige Firmenwertung.', 'Still to do: under “Companies”, choose a team for each company’s provisional ranking.') + '</p>' : '') +
      '<div class="fc-step-actions"><button type="button" data-step="1">' + tr('Zurück zu Firmen', 'Back to companies') + '</button>' +
      button('save-setup', tr('Speichern', 'Save')) +
      '<button type="button" data-next="3" aria-describedby="fc-team-progress" aria-label="' + esc(tr('Weiter zu Regeln & Spielplan', 'Continue to rules & schedule')) + '">' +
      tr('Weiter', 'Continue') + '</button></div></fieldset>' +
      '<fieldset data-panel="3"' + (setupStep !== 3 ? ' hidden' : '') + '><legend>' + tr('Regeln & Spielplan', 'Rules & schedule') + '</legend>' +
      '<p class="fc-guide">' + tr('Lege Spielzeit, Pausen und Felder fest. Erstelle dann den Spielplan. Dabei startet noch kein Spiel.', 'Set match length, breaks and courts. Then create the schedule. This does not start any matches.') + '</p>' +
      settings(event.config) +
      setupPreview() +
      '<p class="fc-note">' + tr('Eine Spielrunde umfasst alle gleichzeitig angesetzten Spiele mit gemeinsamem Start und Stopp – nicht eine komplette Jeder-gegen-jeden-Runde.', 'A time slot contains all matches scheduled at the same time, with a shared start and stop – not a full round-robin round.') + '</p>' +
      '<p class="fc-note">' + tr('Eingaben werden nicht automatisch gespeichert. „Speichern“ bleibt hier; „Gruppenplan erstellen“ prüft die Planung und speichert sie.', 'Changes are not saved automatically. “Save” stays here; “Build group schedule” validates and saves the schedule.') + '</p>' +
      '<div class="fc-step-actions"><button type="button" data-step="1">' + tr('Zurück zu Firmen & Teams', 'Back to companies & teams') + '</button>' +
      button('save-setup', tr('Speichern', 'Save')) +
      button('build', tr('Gruppenplan erstellen', 'Build group schedule')) +
      (event.status !== 'draft' ? button('reopen', tr('Vorläufigen Plan verwerfen', 'Discard preliminary schedule')) : '') + '</div>' +
      '</fieldset></form></section>';
  }
  function transferControls(team) {
    return '<details><summary>' + tr('In andere Firma verschieben', 'Move to another company') +
      '</summary><form data-transfer-team="' + esc(team.id) + '"><label>' + tr('Neue Firma', 'New company') +
      '<select name="target"><option value="">' + tr('Bitte wählen', 'Please choose') + '</option>' +
      options(event.organizations.filter(o => o.id !== team.orgId), '') + '</select></label>' +
      '<div data-transfer-choices></div><button type="submit">' + tr('Wechsel prüfen', 'Review transfer') + '</button></form></details>';
  }
  function rules() {
    return '<details id="fc-rules"><summary>' + tr('Regeln der Turnierleitung & Grenzen', 'Organizer rules & limits') + '</summary><p>' +
      tr('Freizeitformat mit eigenen Regeln der Turnierleitung, kein offizielles BeachL-/FIVB-Regelwerk. Vier Spieler:innen auf dem Feld. ', 'Recreational format with organizer-defined rules, not official BeachL/FIVB rules. Four players on court. ') +
      (event.config.mixed === 'one-woman' ? tr('Mindestens eine Frau auf dem Feld (Prüfung durch Veranstalter:innen). ', 'At least one woman on court (organizer checks). ') : tr('Keine Mixed-Vorgabe. ', 'No mixed requirement. ')) +
      rosterGuidance() + ' ' + tr('Eine maximale sportliche Teamgröße ist fachlich nicht festgelegt. Die App prüft weder Zusammensetzung noch Kontakte/Rotation.', 'No sporting team-size maximum is defined. The app does not check composition, contacts or rotation.') + '</p><p>' +
      tr('Gemeinsamer Start/Stopp je Spielrunde (gleichzeitige Spiele), ', 'Central start/stop per time slot (simultaneous matches), ') + event.config.minutes + tr(' Minuten Spielzeit + ', ' match minutes + ') + event.config.change +
      tr(' Minuten Wechselintervall. Beim Abpfiff zählt nur der aktuelle abgeschlossene Punktestand; laufender Ballwechsel zählt nicht. Gruppen/Platzierung: Remis erlaubt (2/1/0 Wertungspunkte); K.-o.-Remis: dokumentierter Losentscheid ohne Verlängerung.', ' changeover minutes. At the whistle only completed points count; an unfinished rally does not count. Pools/placement: draws allowed (2/1/0 standings points); knockout draw: recorded lottery, no overtime.') + '</p><p>' +
      tr('Neue Pläne: 2–128 Teams; 128 ist eine technische Kapazitätsgrenze, keine Sportregel. Vorrunde: ausgeglichene Gruppen mit höchstens acht Teams, Jeder-gegen-jeden. Bei 2–8 Teams folgt eine weitere Jeder-gegen-jeden-Runde um alle Plätze; nur deren Ergebnisse bestimmen die Endwertung. Bei neun Teams spielen die vier Bestgesetzten einen Cup um Plätze 1–4, die übrigen fünf um Plätze 5–9. Ab zehn Teams spielen die acht Bestgesetzten Plätze 1–8 aus, die übrigen in lückenlosen Platzierungsgruppen mit 2–5 Teams. Keine Freilose oder Ein-Team-Gruppen. Die Mindestspielzahl steht in der Kapazitätsrechnung; ab 16 Teams sind es mindestens sieben. Bei weniger als acht Vorrundengruppen kommen auch niedrigere Gruppenplätze in den Achter-Cup, bei mehr als acht nicht alle Gruppensieger. Version 2 behält 16–80 Teams und ihre bisherigen Runden; ältere/versionlose Pläne behalten 40–64 Teams und acht Gruppen. Vor Finale: Gruppenrang, Wertungspunkte/Spiel, Balldifferenz/Spiel, erzielte Punkte/Spiel; Restgleichstand per protokolliertem Los. Platzierungsgleichstände bleiben geteilt.', 'New plans: 2–128 teams; 128 is a technical capacity limit, not a sports rule. Group stage: balanced round-robin pools of at most eight teams. With 2–8 teams, a second round robin decides all places; only its results determine final standings. With nine teams, the top four seeds play a cup for places 1–4, and the other five play for places 5–9. From ten teams, the top eight seeds play for places 1–8; everyone else enters contiguous placement pools of 2–5 teams. No byes or single-team pools. The capacity projection shows the minimum games; from 16 teams, at least seven. With fewer than eight initial pools, lower pool placings also enter the eight-team cup; with more than eight, not all pool winners qualify. Version 2 retains 16–80 teams and its existing rounds; older/versionless plans retain 40–64 teams and eight pools. Final seeding: pool place, standings points/game, point difference/game, points scored/game; remaining ties use a recorded lottery. Final placement ties remain shared.') + '</p><p>' +
      tr('Vorläufige, noch nicht bestätigte Wertungslogik: Beim Firmenpokal zählt nur die Endplatzierung des ausgewählten Teams, keine Summe der Siege. Alle Teams zählen weiterhin für den Teampokal. Die Auswahl ist ab dem ersten Spielrundenstart oder Ergebnis gesperrt. Endrang und Pokal erst nach allen Spielen; geteilte Teamplätze ergeben geteilte Plätze. Auslosung ist Entscheidung der Turnierleitung, keine Verbandsfreigabe.', 'Provisional, not yet approved ranking: only the selected team’s final placing counts for the company trophy, not a sum of wins. All teams still compete for the team trophy. The choice is locked at the first time-slot start or result. Final standings and trophy only after all matches; shared team places remain shared. Draw procedure is an organizer decision, not federation approval.') +
      '</p><p class="fc-note">' + tr('Nichtantreten und Rückzug werden pro Begegnung ausdrücklich als Turnierleitungsentscheidung erfasst, niemals als normaler Spielstand. Hauswertung: gegnerischer Sieg = 2:0 Wertungspunkte ohne Ballpunkte; aufgehobene Begegnung = 0:0. Jede Begegnung wird separat entschieden; es gibt keine automatische Neu-Paarung oder Kaskade. Bereits gespielte Resultate bleiben erhalten. Diese feste Hausregel ist keine BeachL-/FIVB-Regel. Teamdienste als Schiedsrichter:innen und physischer Feldtest bleiben offen.', 'Nonappearance and withdrawal are explicit organizer decisions per fixture, never normal scores. Organizer rule: declared opposing win = 2:0 standings points with no ball points; void match = 0:0. Decide every fixture separately; there is no automatic re-pairing or cascade. Played results remain. This fixed house rule is not a BeachL/FIVB rule. Team referee duties and physical field testing remain open.') + '</p></details>';
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
  function resultsStatus() {
    const state = resultsState();
    if (!event.matches.length) return '<section id="fc-results-status" class="fc-results-status noprint" tabindex="-1"><h2>' +
      tr('Noch keine Ergebnisse', 'No results yet') + '</h2><p class="fc-empty">' + (readOnly ?
        tr('Die Turnierleitung hat noch keinen Spielplan veröffentlicht.', 'The organizer has not published a schedule yet.') :
        tr('Nach der Spielplanerstellung findest du hier Zwischenstand, Gruppentabellen und die Team- und Firmenwertung. Deinen Entwurf kannst du unten schon sichern.',
          'After creating the schedule, find interim standings, pool tables and the team and company rankings here. You can already back up your draft below.')) + '</p></section>';
    const back = '<p class="fc-results-links noprint"><a class="fc-link fc-link-secondary" href="#fc-schedule" data-focus-target="fc-schedule">' +
      (readOnly ? tr('Zum Spielplan', 'Go to fixtures') : tr('Ergebnisse eintragen', 'Enter results')) + '</a></p>';
    if (!state.played) return '<section id="fc-results-status" class="fc-results-status noprint" tabindex="-1"><h2>' +
      tr('Noch keine Ergebnisse', 'No results yet') + '</h2><p class="fc-empty">' +
      tr('Noch keine Ergebnisse – sobald das erste Ergebnis eingetragen ist, erscheint hier der Zwischenstand.',
        'No results yet – as soon as the first result is entered, the current standings appear here.') + '</p>' + back + '</section>';
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
      (!readOnly ? '<p class="fc-guide noprint">' + tr('3. Prüfe Gruppentabellen, Team- und Firmenwertung. Ergebnisse korrigierst du im Turnierablauf; nutze „Teilen & Sichern“ für eine Sicherung oder einen Link.',
        '3. Review pool tables, team and company standings. Correct scores in Tournament play; use “Sharing & backup” to save a backup or create a link.') + '</p>' : '') +
      back + '</section>';
  }
  function slotLabel(slot) {
    if (slot.kind === 'pool') return tr('Platzierungsrunde läuft', 'Placement round in progress') +
      ' (' + slot.played + '/' + slot.total + tr(' Spiele)', ' matches)');
    const name = slot.from === 1 ? tr('Finale offen', 'Final pending') : slot.from === 3 ?
      tr('Spiel um Platz 3 offen', '3rd-place match pending') : tr('Spiel um Platz ', 'Match for place ') + slot.from + tr(' offen', ' pending');
    return name + (slot.teams[0] && slot.teams[1] ? ': ' + esc(teamName(slot.teams[0])) + ' — ' + esc(teamName(slot.teams[1])) : '');
  }
  function standingsHtml() {
    if (!event.matches.length || !resultsState().played) return '';
    const state = resultsState(), rows = state.rows, orgs = F.organizationStandings(event), finals = event.status === 'finals';
    const complete = state.final;
    const champions = rows.filter(r => r.rank === 1), orgWinners = orgs.filter(r => r.rank === 1);
    const placementRow = row => '<tr><td>' + row.rank + '</td><td>' + esc(teamName(row.id)) +
      '</td><td>' + esc(orgName(event.teams.find(t => t.id === row.id).orgId)) + '</td></tr>';
    const placements = state.slots.map(slot => {
      if (!slot.decided) return '<tr class="fc-open-row"><td>' + placeRange(slot.from, slot.to) +
        '</td><td colspan="2"><strong>' + slotLabel(slot) + '</strong></td></tr>';
      const assigned = rows.filter(row => row.rank >= slot.from && row.rank <= slot.to);
      if (slot.kind === 'match') {
        const outcome = event.outcomes[slot.id];
        const missingLabel = outcome && !outcome.winnerTeam ?
          tr('Nicht vergeben · Begegnung aufgehoben', 'Not awarded · match void') :
          tr('Platzierung nicht vergeben', 'Place not awarded');
        return [slot.from, slot.to].map(rank => {
          const row = assigned.find(item => item.rank === rank);
          return row ? placementRow(row) : '<tr class="fc-unawarded-row"><td>' + rank +
            '</td><td colspan="2"><strong>' + missingLabel + '</strong></td></tr>';
        }).join('');
      }
      return assigned.map(placementRow).join('') || '<tr class="fc-unawarded-row"><td>' + placeRange(slot.from, slot.to) +
        '</td><td colspan="2"><strong>' + tr('Platzierung nicht vergeben', 'Places not awarded') + '</strong></td></tr>';
    }).join('');
    const missingPlacement = !state.placementsComplete && state.matchesComplete;
    return '<section id="fc-standings"><h2>' + (finals ? tr('Titel & Endplatzierungen', 'Titles & final places') : tr('Firmenwertung', 'Company ranking')) + ' ' + badge(complete) + '</h2>' +
      (finals ? '<p><strong>' + tr('Siegreiches Team: ', 'Team champion: ') + (champions.length ? champions.map(r => esc(teamName(r.id))).join(' / ') : tr('noch offen', 'pending')) + '</strong></p>' +
        '<p><strong>' + tr('Firmenwertung: ', 'Company ranking: ') + (orgWinners.length ? orgWinners.map(r => esc(orgName(r.id))).join(' / ') : tr('noch offen', 'pending')) + '</strong></p>' +
        '<p class="fc-note">' + (complete ? tr('Endstand · geteilte Ränge bleiben geteilt.', 'Final standings · tied ranks stay shared.') : tr('Vorläufig: noch nicht alle Platzierungen entschieden.', 'Provisional: not all places decided.')) + '</p>' +
        '<h3>' + tr('Endplatzierungen aller Teams', 'Final places of all teams') + '</h3><table class="fc-table fc-place-table"><thead><tr><th>' + tr('Platz', 'Place') + '</th><th>Team</th><th>' + tr('Firma', 'Company') +
        '</th></tr></thead><tbody>' + placements + '</tbody></table>' :
        '<p class="fc-note">' + tr('Endplatzierungen und Firmenwertung stehen erst nach der Endrunde fest. Bis dahin zählt der Zwischenstand der Gruppentabellen oben.',
          'Final places and the company ranking are decided only after the finals. Until then, the pool tables above show the current standings.') + '</p>') +
      (finals ? '<h3>' + (complete ? tr('Firmenwertung · Endstand', 'Company ranking · final standings') :
        tr('Firmenwertung · aktueller vorläufiger Stand', 'Company ranking · current provisional rule')) + '</h3>' : '') + '<p class="fc-note">' +
      tr('Die Endplatzierung des ausgewählten Teams entscheidet über den Firmenpokal. Alle Teams zählen unabhängig davon für den Teampokal.', 'The selected team’s final placing determines the company trophy ranking. All teams independently compete for the team trophy.') +
      '</p><table class="fc-table' + (finals ? '' : ' fc-plain-table') + '"><thead><tr>' + (finals ? '<th>' + tr('Platz', 'Place') + '</th>' : '') + '<th>' + tr('Firma', 'Company') +
      '</th><th>' + (finals ? tr('Team für den Firmenpokal / Endplatzierung', 'Company trophy team / final placing') : tr('Team für den Firmenpokal', 'Company trophy team')) + '</th></tr></thead><tbody>' +
      orgs.map(r => '<tr>' + (finals ? '<td>' + (r.rank || (missingPlacement ? tr('nicht vergeben', 'not awarded') : tr('offen', 'open'))) + '</td>' : '') +
        '<td>' + esc(orgName(r.id)) + '</td><td>' + esc(teamName(r.nominee)) +
        (finals ? ' / ' + (r.teamRank || (missingPlacement ? tr('nicht vergeben', 'not awarded') : tr('offen', 'open'))) : '') +
        '</td></tr>').join('') + '</tbody></table></section>';
  }
  function poolTable(rows, firstRank) {
    return '<table class="fc-table fc-pool-table"><thead><tr><th>' + tr('Platz', 'Place') + '</th><th>Team</th>' +
      '<th><abbr title="' + tr('Spiele', 'Played') + '">' + tr('Sp.', 'P') + '</abbr></th>' +
      '<th><abbr title="' + tr('Wertungspunkte', 'Standings points') + '">' + tr('Pkt.', 'Pts') + '</abbr></th>' +
      '<th><abbr title="' + tr('Balldifferenz', 'Point difference') + '">' + tr('Diff.', 'Diff') + '</abbr></th></tr></thead><tbody>' +
      rows.map(r => '<tr data-team="' + esc(r.id) + '"><td>' + (firstRank + r.rank - 1) + '</td><td>' + esc(teamName(r.id)) + '<br><small>' +
        esc(orgName(event.teams.find(t => t.id === r.id).orgId)) + '</small></td><td>' + r.played + '</td><td>' + r.points + '</td><td>' +
        (r.diff > 0 ? '+' : '') + r.diff + '</td></tr>').join('') + '</tbody></table>';
  }
  function poolsHtml() {
    if (!event.matches.length || !resultsState().played) return '';
    const frozen = event.status === 'finals';
    return '<section id="fc-pools"><h2>' + tr('Gruppentabellen · Vorrunde', 'Pool tables · group stage') + ' ' + badge(frozen) + '</h2><p class="fc-note">' +
      (frozen ? tr('Abgeschlossen: Mit der Finalauslosung eingefroren. Restgleichstände wurden laut Losprotokoll aufgelöst.',
        'Complete: frozen by the final draw. Remaining ties were resolved by the draw record.') :
        tr('Vorläufig: aktualisiert sich mit jedem Ergebnis. Restgleichstände entscheidet erst die Finalauslosung per Los.',
          'Provisional: updates with every result. Remaining ties are only resolved by lottery at the final draw.')) + '</p><div class="fc-pool-grid">' +
      event.pools.map((p, i) => {
        const pool = 'G' + (i + 1), matches = event.matches.filter(m => m.pool === pool);
        return '<div class="fc-pool" id="fc-pool-' + pool + '"><h3>' + tr('Gruppe ', 'Pool ') + (i + 1) + ' <small>' +
          matches.filter(decided).length + '/' + matches.length + tr(' Spiele', ' matches') + '</small></h3>' + poolTable(F.table(event, p, pool), 1) + '</div>';
      }).join('') + '</div></section>';
  }
  function finalPoolsHtml() {
    if (event.status !== 'finals' || !event.finalPools.length) return '';
    return '<section id="fc-final-pools"><h2>' + tr('Platzierungsrunde', 'Placement round') + '</h2><p class="fc-note">' +
      tr('Platz-Spalte = Endplatz, sobald alle Spiele der Gruppe gewertet sind.', 'Place column = final place once every match in the pool is recorded.') + '</p><div class="fc-pool-grid">' +
      event.finalPools.map(p => {
        const matches = event.matches.filter(m => m.pool === p.id), done = matches.every(decided);
        return '<div class="fc-pool" id="fc-pool-' + esc(p.id) + '"><h3>' + tr('Plätze ', 'Places ') + placeRange(p.firstRank, p.firstRank + p.teams.length - 1) +
          ' ' + badge(done) + ' <small>' + matches.filter(decided).length + '/' + matches.length + tr(' Spiele', ' matches') + '</small></h3>' +
          poolTable(F.table(event, p.teams, p.id), p.firstRank) + '</div>';
      }).join('') + '</div></section>';
  }
  function capacity() {
    if (event.status === 'draft') return '';
    const c = F.estimate(event);
    const warnings = {
      referees: tr('Zu wenige externe Schiedsrichter:innen: gleichzeitig werden nur ', 'Not enough external referees: only ') + c.courts + tr(' Felder genutzt.', ' courts used concurrently.'),
      window: tr('Gesamtprojektion/Plan überschreitet das Zeitfenster. Vor Durchführung Ressourcen/Zeiten prüfen.', 'Whole-event projection/schedule exceeds the time window. Review resources/timing before running the event.'),
      'finals-pending': tr('Nur Vorrunde exakt geplant. Endphase wird nach Gruppenergebnissen und Auslosung ergänzt; diese Endzeit ist NICHT das Turnierende.', 'Only the group stage is scheduled exactly. Finals follow group results and draw; this end time is NOT the event finish.')
    };
    return '<section id="fc-capacity"><h2>' + tr('Zeitplan & Kapazität', 'Schedule & capacity') + '</h2><p>' +
      event.matches.length + tr(' Spiele · ', ' matches · ') + c.waves + tr(' Spielrunden inkl. Pausen · ', ' time slots including rest · ') + c.minutes +
      tr(' Minuten · Planende ', ' minutes · scheduled end ') + F.clock(c.endMin) + ' · ' + c.courts + tr(' gleichzeitige Felder', ' concurrent courts') + '</p>' +
      (event.status === 'groups' ? '<p>' + tr('Gesamtprojektion mit Endphase: ca. ', 'Whole-event projection including finals: approx. ') + c.projectedMinutes +
        tr(' Minuten, Ende ca. ', ' minutes, estimated finish ') + F.clock(c.projectedEndMin) + tr(' (unverbindlich, Auslosung noch offen).', ' (estimate only, draw pending).') + '</p>' : '') +
      '<p>' + tr('Mindestens ', 'At least ') + c.minimumGames + tr(' geplante Spiele je Team nach Ergänzung der Endphase. ', ' scheduled games per team after adding finals. ') +
      event.config.rest + tr(' volle Spielrunden spielfrei zwischen Einsätzen. Externe Schiedsrichter:innen je genutztem Feld erforderlich; keine Teamdienste geplant.', ' full idle time slots between appearances. Dedicated external referees required per used court; no team duties scheduled.') +
      '</p>' + c.warnings.map(w => '<p class="fc-warning">' + warnings[w] + '</p>').join('') +
      '<p class="fc-note">' + tr('Rechnerischer Plan ohne Verzögerungsreserve; keine Zusage für Durchführung, tatsächliche Feldverfügbarkeit oder Einhaltung der Endzeit. Die Gruppe wird erst mit der Finalauslosung sportlich eingefroren.', 'Computed schedule without delay buffer; no guarantee of execution, actual court availability or finish time. Group scores become frozen when finals are drawn.') + '</p></section>';
  }
  function teamCount(n) { return n + ' ' + (n === 1 ? tr('Team', 'team') : tr('Teams', 'teams')); }
  function isAbsent(id) { return F.checkInStatus(event, id) === 'absent'; }
  function unstartedPlan() {
    return event.status === 'groups' && !event.startedAt && !event.liveWave &&
      !Object.keys(event.results).length && !Object.keys(event.outcomes).length;
  }
  // Exception-based attendance: no entry (or a legacy "checked-in"/"late") counts as present.
  function checkin() {
    if (readOnly || !event.matches.length) return '';
    const withdrawn = event.teams.filter(t => event.withdrawals && event.withdrawals[t.id]);
    const absent = event.teams.filter(t => isAbsent(t.id) && !(event.withdrawals && event.withdrawals[t.id]));
    const available = event.teams.filter(t => !isAbsent(t.id) && !(event.withdrawals && event.withdrawals[t.id]));
    const next = nextWave();
    const blocked = next == null ? [] : F.waveReadiness(event, next).blocked;
    const picker = event.organizations.map(o => {
      const teams = available.filter(t => t.orgId === o.id);
      return teams.length ? '<optgroup label="' + esc(o.name) + '">' + teams.map(t =>
        '<option value="' + esc(t.id) + '">' + esc(t.name) + '</option>').join('') + '</optgroup>' : '';
    }).join('');
    return '<section id="fc-checkin" class="noprint"><h2>' + tr('Anwesenheit', 'Attendance') + '</h2>' +
      '<p>' + tr('Alle Teams gelten als anwesend. Nur fehlende Teams melden.', 'All teams count as present. Only report missing teams.') + '</p>' +
      '<p id="fc-attendance-count"><strong>' + tr(available.length + ' von ' + teamCount(event.teams.length) + ' anwesend',
        available.length + ' of ' + teamCount(event.teams.length) + ' present') + '</strong></p>' +
      '<form id="fc-absent-form" class="fc-absent-form"><label for="fc-absent-select">' + tr('Fehlendes Team', 'Missing team') + '</label>' +
      '<select id="fc-absent-select" name="team"' + (available.length ? '' : ' disabled') + '><option value="">' + tr('Team wählen', 'Choose team') + '</option>' + picker + '</select>' +
      '<button type="submit" id="fc-absent-submit"' + (available.length ? '' : ' disabled') + '>' + tr('Als abwesend melden', 'Mark absent') + '</button></form>' +
      '<h3 id="fc-absent-heading">' + tr('Abwesend', 'Absent') + ' (' + absent.length + ')</h3>' +
      (absent.length ? '<ul class="fc-absent-list" aria-labelledby="fc-absent-heading">' + absent.map(t => {
        const item = blocked.find(b => b.team === t.id);
        return '<li id="fc-absent-row-' + esc(t.id) + '"><span><strong>' + esc(t.name) + '</strong> · ' + esc(orgName(t.orgId)) +
          (item ? '<br><a href="#fc-outcome-' + esc(item.match) + '" data-focus-target="fc-outcome-' + esc(item.match) + '">' +
            tr('Spielt in der nächsten Spielrunde (', 'Plays in the next time slot (') + esc(item.match) + tr(') · Nichtantreten entscheiden', ') · decide nonappearance') + '</a>' : '') +
          '</span><button type="button" class="fc-present" id="fc-absent-team-' + esc(t.id) + '" data-present="' + esc(t.id) + '" aria-label="' +
          esc(tr('Wieder da: ', 'Back: ') + t.name) + '">' + tr('Wieder da', 'Back') + '</button></li>';
      }).join('') + '</ul>' : '<p class="fc-empty">' + tr('Keine Abwesenheiten gemeldet.', 'No absences reported.') + '</p>') +
      (withdrawn.length ? '<p class="fc-note">' + tr('Zurückgezogen (Entscheidung im Spielplan): ', 'Withdrawn (decision in fixtures): ') +
        withdrawn.map(t => esc(t.name)).join(', ') + '</p>' : '') +
      '<p class="fc-note">' + tr('Abwesenheit ändert keine Begegnung, kein Ergebnis und keine Wertung. Ein Spiel mit abwesendem Team startet erst, wenn das Team wieder da ist oder im Spielplan ein Nichtantreten entschieden wurde. ',
        'Absence does not change fixtures, scores or rankings. A match with an absent team starts only once the team is back or a nonappearance is decided in the fixtures. ') +
      tr(binding && binding.id ? 'Wird mit dem Server synchronisiert, bleibt aber privat.' : 'Nur lokal auf diesem Gerät gespeichert; nie öffentlich.',
        binding && binding.id ? 'Synchronized with the server but kept private.' : 'Stored only on this device; never public.') + '</p>' +
      (unstartedPlan() && absent.length ? '<p class="fc-note">' + tr('Noch nichts gestartet: Fehlen Teams ganz, können sie aus der Anmeldung entfernt werden. Der Gruppenplan wird dann neu erstellt.',
        'Nothing has started yet: teams that will not come at all can be removed from registration. The pool schedule is then rebuilt.') + '</p>' +
        button('remove-absent', tr('Abwesende Teams aus Anmeldung entfernen und Plan neu erstellen', 'Remove absent teams from registration and rebuild schedule')) : '') +
      '</section>';
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
    return '<p class="fc-warning fc-resolve">' + (item.withdrawn ? tr('Zurückgezogen: ', 'Withdrawn: ') : tr('Abwesend gemeldet: ', 'Reported absent: ')) +
      '<strong>' + esc(teamName(item.team)) + '</strong> · ' + tr('Spiel ', 'Match ') + esc(item.match) + '<br>' +
      (item.withdrawn ? '' : '<a class="fc-link" href="#fc-absent-team-' + esc(item.team) + '" data-focus-target="fc-absent-team-' + esc(item.team) + '">' +
        tr('Wieder da melden', 'Mark back') + '</a> ') +
      '<a class="fc-link" href="#fc-outcome-' + esc(item.match) + '" data-focus-target="fc-outcome-' + esc(item.match) + '">' +
      tr('Nichtantreten entscheiden', 'Decide nonappearance') + '</a></p>';
  }
  function wavePanel(wave, actual) {
    if (wave == null) return '';
    const readiness = F.waveReadiness(event, wave);
    const matches = event.matches.filter(m => m.wave === wave).sort((a, b) => a.field - b.field);
    const title = actual ? (readiness.missingResults.length
      ? tr('Zuletzt tatsächlich gestartete Spielrunde', 'Last actually started time slot')
      : tr('Tatsächlich gestartete Spielrunde', 'Actually started time slot')) : tr('Nächste geplante Spielrunde', 'Next planned time slot');
    return '<section class="fc-wave-panel"><h3>' + title + ' ' + (wave + 1) + '</h3><p>' +
      (actual ? tr('Tatsächlicher Start: ', 'Actual start: ') + esc(new Date(event.liveWave.startedAt).toLocaleTimeString(en ? 'en-GB' : 'de-DE', { hour: '2-digit', minute: '2-digit' })) :
        tr('Planstart: ', 'Planned start: ') + F.clock(matches[0].startMin)) +
      ' · ' + readiness.matches.length + ' ' + tr('Spiele · ', 'matches · ') +
      (actual ? (readiness.missingResults.length ? tr('Ergebnisse ausstehend', 'results pending') : tr('vollständig erfasst', 'fully recorded')) :
        (readiness.ready ? tr('startbereit', 'ready to start') : tr('noch nicht startbereit', 'not ready to start'))) + '</p>' +
      matches.map(m => '<p class="fc-wave-match"><strong>' + tr('Feld ', 'Court ') + m.field + '</strong> · <a href="#fc-match-' + esc(m.id) +
        '" data-focus-target="fc-match-' + esc(m.id) + '">' + matchLabel(m) + '</a> · ' +
        (event.results[m.id] ? tr('Ergebnis ', 'Result ') + event.results[m.id].a + ':' + event.results[m.id].b :
          tr('Ergebnis offen', 'Result pending')) + '</p>').join('') +
      readiness.blocked.map(blockedResolution).join('') +
      (readiness.unresolved.length ? '<p class="fc-warning">' + tr('Vorgängerergebnisse offen; Gegner noch nicht festgelegt.', 'Previous results are missing; opponents are not yet determined.') + '</p>' : '') +
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
        actionLink = tr('Abwesendes Team in Spielrunde ', 'Absent team in time slot ') + (actionWave + 1) + ': <strong>' + esc(teamName(item.team)) + '</strong> · ' +
          (item.withdrawn ? '' : '<a href="#fc-absent-team-' + esc(item.team) + '" data-focus-target="fc-absent-team-' + esc(item.team) + '">' +
            tr('Wieder da melden', 'Mark back') + '</a> ' + tr('oder ', 'or ')) +
          '<a href="#fc-outcome-' + esc(item.match) + '" data-focus-target="fc-outcome-' + esc(item.match) + '">' +
          tr('Nichtantreten für Spiel ', 'decide nonappearance for match ') + esc(item.match) + tr(' entscheiden', '') + '</a>';
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
        actionLink = '<a href="#fc-live" data-focus-target="fc-wave">' + tr('Bereite Spielrunde zentral starten', 'Start the ready time slot centrally') + '</a>';
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
    return '<section id="fc-cockpit" class="noprint"><h2>' + tr('Turniertag-Cockpit', 'Event-day cockpit') + '</h2><p><strong>' +
      missing.length + tr(' von ', ' of ') + event.matches.length + ' ' + tr('Ergebnisse offen', 'results pending') + '</strong> · ' +
      (active == null ? tr('Noch keine Spielrunde tatsächlich gestartet.', 'No time slot actually started yet.') :
        tr('Letzter tatsächlicher Start: Spielrunde ', 'Last actual start: time slot ') + (active + 1) + ' · ' +
        (incompleteWave ? tr('Ergebnisse dieser Spielrunde ausstehend.', 'Results from this time slot are pending.') : tr('Diese Spielrunde ist vollständig erfasst.', 'This time slot is fully recorded.'))) +
      '</p>' + (actionLink ? '<p class="fc-next"><strong>' + tr('Nächste Aktion: ', 'Next action: ') + '</strong>' + actionLink + '</p>' : '') +
      (missing.length < event.matches.length ? '<p class="fc-results-links"><a class="fc-link fc-link-secondary" id="fc-cockpit-results" href="#fc-results-status" data-focus-target="fc-results-status">' +
        (resultsState().final ? tr('Endergebnis ansehen', 'View final results') : tr('Zwischenstand ansehen', 'View current standings')) + '</a></p>' : '') +
      (active == null ? '' : wavePanel(active, true)) +
      (upcoming === active ? '' : wavePanel(upcoming, false)) +
      '<p class="fc-note">' + tr('Geplante Zeiten und tatsächliche Starts werden getrennt angezeigt. Die lokale Anzeige synchronisiert keine anderen Geräte und plant bei Verzögerungen nicht automatisch um.', 'Planned times and actual starts are shown separately. This local view does not synchronize other devices or automatically reschedule delays.') + '</p></section>';
  }
  function matchLabel(m) {
    const a = F.resolve(event, m.a), b = F.resolve(event, m.b);
    function refName(ref) { return typeof ref === 'string' ? teamName(ref) : (ref.outcome === 'winner' ? tr('Siegreiches Team aus ', 'Winner ') : tr('Unterlegenes Team aus ', 'Loser ')) + ref.match; }
    return esc(a ? teamName(a) : refName(m.a)) + ' — ' + esc(b ? teamName(b) : refName(m.b));
  }
  function scoreNext() {
    const next = event.matches.filter(m => !decided(m)).sort((a, b) => a.wave - b.wave || a.field - b.field)[0];
    const target = next ? 'fc-match-' + next.id : event.status === 'groups' ? 'fc-finals' : 'fc-results-status';
    return '<a class="fc-link fc-link-secondary" href="#' + esc(target) + '" data-focus-target="' + esc(target) + '">' +
      (next ? tr('Nächstes offenes Spiel', 'Next pending match') + ' · ' + esc(next.id) + ' · ' + F.clock(next.startMin) :
        event.status === 'groups' ? tr('Weiter: Endphase auslosen', 'Next: draw finals') :
          (resultsState().final ? tr('Endergebnis ansehen', 'View final results') : tr('Zwischenstand ansehen', 'View current standings'))) + '</a>';
  }
  function fixture(m) {
    const r = event.results[m.id], a = F.resolve(event, m.a), b = F.resolve(event, m.b);
    const outcome = event.outcomes && event.outcomes[m.id];
    const editable = !readOnly && !outcome && a && b && !(event.status === 'finals' && m.phase === 'group') && !F.hasPlayedDescendant(event, m.id);
    const absentHere = editable ? [a, b].find(id => isAbsent(id)) || null : null;
    return '<article class="fc-fixture" id="fc-match-' + esc(m.id) + '" tabindex="-1" data-match="' + m.id + '"><p><strong>' + F.clock(m.startMin) + ' · ' + tr('Spielrunde ', 'Time slot ') + (m.wave + 1) +
      ' · ' + tr('Feld ', 'Court ') + m.field + '</strong> · ' + m.id + (m.placement ? ' · ' + tr('Plätze ', 'Places ') + m.placement + '/' + (m.placement + 1) : '') + '</p>' +
      '<p>' + matchLabel(m) + '</p><p>' + (r ? '<strong>' + r.a + ':' + r.b + '</strong>' + (r.drawWinner ? ' · ' + tr('Per Los bestimmtes Team: ', 'Draw winner: ') + esc(teamName(r.drawWinner)) : '') :
        (outcome ? '<strong>' + tr(outcome.type === 'withdrawal' ? 'Rückzug' : 'Nichtantreten', outcome.type === 'withdrawal' ? 'Withdrawal' : 'Nonappearance') +
          '</strong> · ' + (outcome.winnerTeam ? tr('Ausdrücklich zugesprochener Sieg: ', 'Organizer-declared win: ') + esc(teamName(outcome.winnerTeam)) +
            tr(' · 2:0 Wertungspunkte, keine Ballpunkte/kein fingierter Spielstand.', ' · 2:0 standings points, no ball points or invented score.') :
            tr('Begegnung aufgehoben · keine Wertungspunkte und kein Spielstand.', 'Match void · no standings points and no score.')) : tr('Ergebnis offen', 'Result pending'))) + '</p>' +
      (editable ? '<form class="fc-result noprint" data-score="' + m.id + '" aria-describedby="fc-score-guide"><label>' + tr('Punkte A', 'Points A') + '<input name="a" type="number" inputmode="numeric" enterkeyhint="next" autocomplete="off" aria-label="' + esc(teamName(a)) + ' · ' + tr('Punkte A', 'Points A') + '" min="0" max="999" required value="' + (r ? r.a : '') + '"></label>' +
        '<label>' + tr('Punkte B', 'Points B') + '<input name="b" type="number" inputmode="numeric" enterkeyhint="done" autocomplete="off" aria-label="' + esc(teamName(b)) + ' · ' + tr('Punkte B', 'Points B') + '" min="0" max="999" required value="' + (r ? r.b : '') + '"></label>' +
        (m.phase === 'cup' ? '<label class="fc-draw"' + (r && r.a === r.b ? '' : ' hidden') + '>' + tr('Remis im K.-o.: per Los bestimmtes Team wählen', 'Knockout tie: choose the lottery winner') + '<select name="drawWinner"><option value="">' + tr('Team wählen', 'Choose team') + '</option>' +
          options(event.teams.filter(t => t.id === a || t.id === b), r && r.drawWinner) + '</select></label>' : '') +
        '<button type="submit">' + tr('Gespieltes Ergebnis speichern', 'Save played score') + '</button></form>' +
        (!r && !outcome && absentHere ? '<p class="fc-warning">' + esc(teamName(absentHere)) +
          tr(' ist abwesend gemeldet: unter „Anwesenheit“ wieder da melden oder hier Nichtantreten entscheiden.', ' is reported absent: mark it back under “Attendance” or decide a nonappearance here.') + '</p>' : '') +
        (!r && !outcome ? '<details class="fc-outcome noprint"><summary id="fc-outcome-' + esc(m.id) + '">' + tr('Nichtantreten oder Rückzug entscheiden', 'Record nonappearance or withdrawal') +
          '</summary><form data-outcome="' + esc(m.id) + '"><label>' + tr('Entscheidungsgrund', 'Decision reason') +
          '<select name="type"><option value="nonappearance">' + tr('Nichtantreten (nur diese Begegnung)', 'Nonappearance (this match only)') +
          '</option><option value="withdrawal">' + tr('Rückzug aus dem weiteren Wettbewerb', 'Withdrawal from remaining competition') + '</option></select></label>' +
          '<label>' + tr('Nicht angetretenes/zurückziehendes Team', 'Nonappearing/withdrawing team') +
          '<select name="absent" required><option value="">' + tr('Team wählen', 'Choose team') + '</option>' +
          options(event.teams.filter(t => t.id === a || t.id === b), absentHere) + '</select></label>' +
          '<label>' + tr('Ausdrückliche Wertung', 'Explicit decision') + '<select name="winner"><option value="">' +
          tr('Begegnung aufheben · 0:0 Wertungspunkte', 'Void match · 0:0 standings points') + '</option>' +
          options(event.teams.filter(t => t.id === a || t.id === b), null) + '</select></label>' +
          '<label>' + tr('Notiz für die Veranstaltungsleitung (optional)', 'Organizer note (optional)') +
          '<input name="note" maxlength="300"></label><button type="submit">' +
          tr('Entscheidung ohne erfundenen Spielstand speichern', 'Save decision without inventing a score') +
          '</button></form><p class="fc-note">' + tr('Hausregel: Bei ausdrücklich zugesprochenem Sieg erhält das andere Team 2 Wertungspunkte, aber keine Ballpunkte; eine aufgehobene Begegnung gibt beiden 0. Bereits gespielte Resultate bleiben erhalten. Jede weitere Begegnung des zurückgezogenen Teams wird separat entschieden; keine automatische Neu-Paarung.', 'Organizer rule: a declared opposing win awards 2 standings points and no ball points; a void match gives both teams 0. Played results remain unchanged. Decide each other fixture separately; no automatic re-pairing.') + '</p></details>' : '') :
        (!readOnly && r ? '<p class="fc-note">' + tr('Ergebnis eingefroren (Finalauslosung / gespielte Folgerunde).', 'Result frozen (final draw / played downstream round).') + '</p>' : '')) +
      (!readOnly && r && lastScored === m.id ? '<p class="fc-score-next noprint">' + scoreNext() + '</p>' : '') + '</article>';
  }
  function fixtures() {
    if (!event.matches.length) return '';
    return '<section id="fc-schedule" tabindex="-1"><h2>' + tr('Spielplan · gemeinsame Spielrunden', 'Fixtures · shared time slots') + '</h2>' +
      '<p id="fc-score-guide" class="fc-note">' + tr('Zeitspiel: tatsächliche Ballpunkte eintragen, kein Zielstand und kein Zwei-Punkte-Vorsprung nötig. Remis zählt in Gruppen 1:1 Wertungspunkte; im K.-o. entscheidet ein Los.',
        'Timed play: enter the actual points, with no target score or two-point lead required. A pool tie awards 1:1 standings points; a knockout tie needs a lottery winner.') + '</p>' +
      (!readOnly ? '<div class="fc-score-nav noprint"><span>' + resultsState().played + '/' + event.matches.length + ' ' +
        tr('Spiele gewertet', 'matches recorded') + '</span> ' + scoreNext() + '</div>' : '') +
      '<p id="fc-search-summary" class="noprint" role="status"></p>' +
      event.matches.map(fixture).join('') + '</section>';
  }
  function live() {
    if (!event.matches.length) return '';
    const waves = Array.from(new Set(event.matches.map(m => m.wave)));
    const selectedWave = nextWave();
    const completedWaves = event.matches.filter(m => event.results[m.id] || event.outcomes[m.id]).map(m => m.wave);
    const minimumReplan = event.liveWave ? event.liveWave.wave + 1 :
      (completedWaves.length ? Math.max.apply(null, completedWaves) + 1 : 0);
    const replanWaves = waves.filter(w => w >= minimumReplan &&
      event.matches.some(m => m.wave === w && !event.results[m.id] && !event.outcomes[m.id]));
    const canReplan = replanWaves.length > 0;
    return '<section id="fc-live" class="noprint"><h2>' + tr('Spielrunde starten', 'Start a time slot') + '</h2>' +
      (!readOnly ? '<p class="fc-guide">' + tr('2. Alle Teams gelten als anwesend; nur fehlende Teams unter „Anwesenheit“ melden. Starte dann die gleichzeitigen Spiele gemeinsam und trage anschließend die Ergebnisse im Spielplan ein.', '2. All teams count as present; only report missing teams under “Attendance”. Then start their simultaneous matches together and record the results in the fixtures below.') + '</p>' : '') +
      '<p class="fc-note">' + tr('Eine Spielrunde umfasst die gleichzeitigen Spiele auf allen Feldern. Die Leitung pfeift gemeinsam an und ab. Ein optionaler Live-Link überträgt Start und Ergebnisse.', 'A time slot contains the simultaneous matches on all courts. The organizer signals the shared start and stop. An optional live link synchronizes starts and results.') + '</p>' +
      (!readOnly ? '<label>' + tr('Spielrunde', 'Time slot') + '<select id="fc-wave">' + waves.map(w => '<option value="' + w + '"' + (w === selectedWave ? ' selected' : '') + '>' + (w + 1) + ' · ' + F.clock(event.matches.find(m => m.wave === w).startMin) + '</option>').join('') +
        '</select></label><button type="button" id="fc-start-wave" data-action="start-wave"' +
        (selectedWave == null || !F.waveReadiness(event, selectedWave).ready ? ' disabled' : '') + '>' +
        tr('Jetzt zentral starten', 'Start centrally now') + '</button>' +
        (canReplan ? '<details id="fc-replan"><summary>' + tr('Verzögerung oder Feldschließung: Restplan umplanen', 'Delay or court closure: replan remaining schedule') +
          '</summary><p>' + tr('Nur ungestartete Begegnungen werden neu eingeplant. Gespielte Resultate und tatsächlich gestartete Spielrunden bleiben erhalten; alle verfügbaren Felder, Begegnungen, Schiedsrichter:innen und Ruhezeiten werden auf Konflikte geprüft.', 'Only unstarted fixtures are rescheduled. Played results and started time slots remain unchanged; court bookings, team conflicts, referees and rest intervals are checked.') + '</p>' +
          '<label>' + tr('Ab Spielrunde', 'From time slot') + '<select id="fc-replan-wave">' + replanWaves.map(w =>
            '<option value="' + w + '">' + (w + 1) + ' · ' + F.clock(event.matches.find(m => m.wave === w).startMin) + '</option>').join('') + '</select></label>' +
          '<label>' + tr('Verzögerung (Minuten)', 'Delay (minutes)') + '<input id="fc-replan-delay" type="number" min="0" max="1440" value="0"></label>' +
          '<label>' + tr('Ab jetzt verfügbare Felder', 'Fields available from then on') + '<input id="fc-replan-fields" type="number" min="1" max="' + Math.min(event.config.fields, event.config.referees) + '" value="' + Math.min(event.fieldLimit, event.config.referees) + '"></label>' +
          '<label>' + tr('Grund (wird protokolliert)', 'Reason (recorded in audit)') + '<input id="fc-replan-reason" maxlength="200" required value="' + tr('Verzögerung/Feldschließung', 'Delay/court closure') + '"></label>' +
          button('replan', tr('Umplanung prüfen & bestätigen', 'Review and confirm replan')) +
          (event.replans.length ? '<details><summary>' + tr('Bisherige Umplanungen (' + event.replans.length + ')', 'Previous replans (' + event.replans.length + ')') +
            '</summary>' + event.replans.map(r => '<p>' + tr('Ab Spielrunde ', 'From time slot ') + (r.fromWave + 1) + ' · +' + r.delayMinutes + ' ' +
              tr('Min. · ', 'min · ') + r.fields + ' ' + tr('Felder · ', 'fields · ') + esc(r.reason) + ' · ' +
              esc(new Date(r.at).toLocaleString(en ? 'en-GB' : 'de-DE')) + '</p>').join('') + '</details>' : '') +
          '</details>' : '') : '') +
      '<p id="fc-countdown" role="timer"></p></section>';
  }
  function tools() {
    const published = !!(binding && binding.id);
    const status = !binding ? tr('Noch kein Server-Link. Das Ereignis bleibt ausschließlich lokal.', 'No server link yet. This event remains local only.') :
      binding.conflict ? tr('Konflikt: Serverrevision ' + (binding.remoteRevision || '?') + ' ist neuer. Der lokale Entwurf bleibt erhalten und wird nicht überschrieben.', 'Conflict: server revision ' + (binding.remoteRevision || '?') + ' is newer. The local draft is retained and will not be overwritten.') :
        binding.pending ? tr('Übertragung ausstehend. Lokal gespeichert; derselbe Request wird bei Verbindung wiederholt.', 'Upload pending. Saved locally; the same request retries when connected.') :
          tr('Serverrevision ' + binding.revision + ' · Bearbeitungsrecht nur in diesem Browser gespeichert.', 'Server revision ' + binding.revision + ' · editor capability stored only in this browser.');
    const publicLink = published ? Server.publicUrl(binding.id, location.href, en ? 'en' : 'de') : '';
    return '<section id="fc-tools" class="noprint">' +
      '<p class="fc-note">' + tr('Sicherung und Live-Link sind jederzeit verfügbar – vor, während und nach dem Turnier. Schließen führt zurück zur vorherigen Ansicht.', 'Backup and live link are available at any time – before, during and after the event. Closing returns to the previous view.') + '</p>' +
      '<h3>' + tr('Sicherung', 'Backup') + '</h3>' +
      button('backup', tr('Eigene JSON-Sicherung herunterladen', 'Download own JSON backup')) +
      '<p class="fc-note">' + tr('Firmencup-Daten gehören nicht zur allgemeinen Bogen-Sicherung. Eigene Datei enthält die Namen der Spieler:innen; privat aufbewahren. Vorheriger gespeicherter Stand liegt zusätzlich auf diesem Gerät vor.', 'Firmencup records are not included in general sheet backups. Your own file includes player names; keep it private. The previous saved revision is also held on this device.') + '</p>' +
      button('previous', tr('Vorherigen Stand als neue Veranstaltung kopieren', 'Copy previous snapshot as new event')) +
      '<h3>' + tr('Mehrgeräte-Live-Link (Web)', 'Multi-device live link (web)') + '</h3><p id="fc-server-status" role="status">' + esc(status) + '</p>' +
      '<label><input id="fc-share-consent" type="checkbox" style="width:auto;vertical-align:middle"> ' +
      tr('Veröffentlichen macht Team-/Organisationsnamen, Nominierungen, Spielplan, Wertungen, Ergebnisse und Veranstaltungsentscheidungen öffentlich lesbar. Spieler:innen-Kader und Anwesenheit werden nicht veröffentlicht. Jede Aktualisierung wird auf dem Server gespeichert.', 'Publishing makes team/organization names, nominations, schedule, standings, results and event decisions publicly readable. Player rosters and attendance are not published. Each update is stored on the server.') + '</label>' +
      button('share', published ? tr('Live-Link aktualisieren', 'Update live link') : tr('Live-Teilnehmer:innen-Link veröffentlichen', 'Publish live participant link')) +
      (published ? '<div id="fc-share-output"><label>' + tr('Öffentlicher Nur-Lesen-Link (ohne Bearbeitungsrecht)', 'Public read-only link (no edit permission)') +
        '<textarea id="fc-share-url" readonly>' + esc(publicLink) + '</textarea></label><div id="fc-qr"></div><p id="fc-qr-note" role="status">' +
        tr('Live-Ansicht · aktualisiert sich bei Verbindung automatisch.', 'Live view · refreshes automatically when connected.') + '</p>' +
        button('editor-link', tr('Geheimen Bearbeitungs-Link anzeigen', 'Reveal secret editor link')) +
        '<div id="fc-editor-link-output" hidden><p class="fc-warning">' + tr('Geheimnis: Wer diesen Link besitzt, kann private Kaderdaten lesen und das Ereignis bearbeiten. Separat und nur an vertrauenswürdige Mitveranstalter:innen übermitteln.', 'Secret: anyone with this link can read private roster data and edit the event. Share separately, only with trusted co-organizers.') + '</p>' +
        '<label>' + tr('Geheimer Link zur Bearbeitungsberechtigung', 'Secret editor capability link') + '<textarea id="fc-editor-url" readonly></textarea></label></div></div>' : '') +
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
      const img = document.createElement('img'); img.src = qr.createDataURL(4, 4);
      img.alt = tr('QR zum Live-Nur-Lesen-Link', 'QR to the live read-only link');
      qrHost.appendChild(img);
    } catch (error) {
      note.textContent = tr('QR konnte nicht erzeugt werden; der Nur-Lesen-Link kann kopiert werden.', 'Could not create QR; copy the read-only link instead.');
    }
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
    if (!livePublic || document.visibilityState === 'hidden' || busy) return;
    try {
      const remote = await Server.get(params.get('eventId'), null, liveEtag);
      if (remote.notModified) return;
      if (remote.canEdit || !remote.event || remote.event.id !== event.id) throw new Error('Invalid public event response / Ungültige öffentliche Veranstaltungsantwort');
      const incoming = F.validate(remote.event, { publicSnapshot: true });
      if (remote.revision === liveRevision) { liveEtag = remote.etag; return; }
      event = incoming;
      liveRevision = remote.revision;
      liveEtag = remote.etag;
      render();
      notify(tr('Live-Stand aktualisiert · Serverrevision ', 'Live event refreshed · server revision ') + liveRevision);
    } catch (error) {
      console.error('Firmencup public refresh:', error);
      notify(tr('Live-Ansicht zeigt den letzten geladenen Stand; Aktualisierung fehlgeschlagen: ', 'Live view shows the last loaded state; refresh failed: ') + error.message, true);
    }
  }
  async function pollEditor() {
    if (!event || readOnly || document.visibilityState === 'hidden' || busy) return;
    try {
      binding = await Server.load(event.id);
      if (!binding || !binding.id || binding.conflict) return;
      try { binding = await Server.sync(event); }
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
      const remote = await Server.get(binding.id, binding.token, '"' + binding.revision + '"');
      if (remote.notModified || remote.revision <= binding.revision) return;
      if (Server.fingerprint(event) === binding.syncedFingerprint) {
        const replacement = F.clone(remote.event);
        replacement.revision = 0;
        event = await Store.replace(F.validate(replacement));
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
      notify(error.message, true);
    }
  }
  function render() {
    const expandedCompanies = Array.from(app.querySelectorAll('.fc-company-teams[open]')).map(node => node.parentElement.dataset.company);
    const expandedRosters = Array.from(app.querySelectorAll('.fc-roster-details[open]')).map(node => node.dataset.rosterTeam);
    identity(event.title);
    if (!phase) phase = (event.matches.length || readOnly) ? 'play' : 'configuration';
    const accessState = readOnly ? tr('Teilnehmer:innen-Ansicht · Nur Lesen', 'Participant view · read-only') :
      (binding && binding.id ? tr('Mehrgeräte-Turnierleitung · Serverrevision ' + binding.revision, 'Multi-device organizer · server revision ' + binding.revision) : '');
    app.innerHTML = (accessState ? '<p class="fc-access-state"><strong>' + accessState +
      (livePublic ? ' · ' + tr('Live · Serverrevision ' + liveRevision, 'Live · server revision ' + liveRevision) :
        (capturedAt ? ' · ' + tr('Snapshot vom ', 'Snapshot captured ') + esc(new Date(capturedAt).toLocaleString(en ? 'en-GB' : 'de-DE')) : '')) + '</strong></p>' : '') +
      (readOnly ? '<p class="fc-warning">' + (livePublic ?
        tr('Öffentliche Live-Ansicht: aktualisiert sich bei Verbindung automatisch. Team-/Organisationsnamen und Ergebnisse sind sichtbar; Spieler:innen-Namen, Kader, Anwesenheit und Bearbeitungsrecht bleiben privat.', 'Public live view: refreshes automatically when connected. Team/organization names and results are visible; player names, rosters, attendance and editor rights remain private.') :
        tr('Statischer Snapshot aus einem älteren Link. Enthält Team- und Firmennamen, keine Spieler:innen-Namen. Dieser Link lädt niemals private lokale Daten.', 'Static snapshot from an older link. Includes team and company names, no player names. This link never loads private local records.')) + '</p>' :
        '<p class="noprint"><a href="Firmencup.html?lang=' + (en ? 'en' : 'de') + '">' + tr('Alle lokalen Firmencups / Wiederherstellung', 'All local company cups / restore') + '</a></p>' + editor()) +
      rules() + capacity() + checkin() + cockpit() + live() +
      '<section id="fc-search-panel" class="noprint"><label>' + tr('Team oder Firma suchen', 'Search team or company') + '<input id="fc-search" type="search"></label><div id="fc-next" role="status"></div>' +
      button('print', tr('Drucken (gesamter Plan)', 'Print (full schedule)')) + '</section>' +
      resultsStatus() + poolsHtml() + standingsHtml() + finalPoolsHtml() + fixtures() +
      (!readOnly && event.status === 'groups' ? '<section id="fc-finals" class="noprint" tabindex="-1">' +
        '<p>' + tr('Alle Gruppenergebnisse fertig? Finale ausdrücklich auslosen: Restgleichstände werden mit einem kryptografisch zufälligen, gespeicherten Losprotokoll aufgelöst. Danach sind Gruppenergebnisse eingefroren.', 'All group results complete? Explicitly draw finals: unresolved ties use a cryptographically randomized, saved draw record. Group scores are then frozen.') + '</p>' +
        button('finals', tr('Endphase auslosen & planen', 'Draw & schedule finals')) + '</section>' : '') +
      (event.drawOrder.length ? '<details id="fc-draw-record"><summary>' + tr('Losprotokoll der Finalsetzung', 'Final seeding draw record') + '</summary><p>' +
        event.drawOrder.map(id => esc(teamName(id)) + ' (' + esc(id) + ')').join(' → ') + '</p></details>' : '') +
      (!readOnly ? tools() : '');
    groupTeamEditors(expandedCompanies, expandedRosters);
    arrangePhases();
    updateStatusAction();
    bind(); updateCountdown(); renderServerLinks();
    followAnchor();
  }
  function toolsReturnPhase() {
    if (toolsReturn && toolsReturn !== 'tools') return toolsReturn;
    return event.matches.length ? 'play' : 'configuration';
  }
  function phaseNavigation() {
    const toolsButton = readOnly ? '' : '<button type="button" id="fc-tools-open" class="fc-tools-open" data-phase="tools" aria-controls="fc-phase-tools" aria-expanded="' +
      (phase === 'tools' ? 'true' : 'false') + '"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
      '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/></svg> ' +
      tr('Teilen & Sichern', 'Sharing & backup') + '</button>';
    return '<div class="fc-phasebar noprint"><nav class="fc-phases noprint" aria-label="' + tr('Turnierphasen', 'Tournament phases') + '">' +
      ['configuration', 'play', 'results'].map((id, index) => {
        const names = [tr('Konfiguration', 'Configuration'), tr('Turnierablauf', 'Tournament play'), tr('Turnierergebnis', 'Tournament results')];
        if (readOnly && id === 'configuration') return '';
        return '<button type="button" data-phase="' + id + '" aria-controls="fc-phase-' + id + '"' +
          (id === phase ? ' aria-current="step"' : '') + (id === 'play' && !readOnly && !event.matches.length ? ' disabled' : '') +
          '><span class="fc-phase-number" aria-hidden="true">' + (index + 1) + '</span> ' + names[index] + '</button>';
      }).join('') + '</nav>' + toolsButton + '</div>';
  }
  function arrangePhases() {
    app.insertAdjacentHTML('afterbegin', phaseNavigation());
    const groups = [
      ['configuration', tr('Konfiguration', 'Configuration'), ['fc-editor', 'fc-registration', 'fc-rules', 'fc-capacity']],
      ['play', tr('Turnierablauf', 'Tournament play'), ['fc-cockpit', 'fc-checkin', 'fc-live', 'fc-search-panel', 'fc-schedule', 'fc-finals', 'fc-draw-record']
        .concat(readOnly ? ['fc-capacity', 'fc-rules'] : [])],
      ['results', tr('Turnierergebnis', 'Tournament results'), resultsState().final ?
        ['fc-results-status', 'fc-standings', 'fc-final-pools', 'fc-pools'] :
        ['fc-results-status', 'fc-pools', 'fc-final-pools', 'fc-standings']],
      ['tools', tr('Teilen & Sichern', 'Sharing & backup'), ['fc-tools']]
    ];
    groups.forEach(([id, name, ids]) => {
      if (readOnly && (id === 'configuration' || id === 'tools')) return;
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
          tr('Noch kein Spielplan. Zuerst unter Konfiguration den Gruppenplan erstellen.', 'No schedule yet. First build the group schedule under Configuration.')) + '</p>');
      ids.forEach(nodeId => {
        const node = document.getElementById(nodeId);
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
      if (id === 'configuration' && event.matches.length) panel.insertAdjacentHTML('beforeend',
        '<div class="fc-step-actions noprint"><button type="button" data-phase="play">' +
        tr('Weiter zum Turnierablauf', 'Continue to tournament play') + '</button></div>');
      if (id === 'play') panel.insertAdjacentHTML('beforeend',
        '<div class="fc-step-actions noprint"><button type="button" data-phase="results">' +
        tr('Turnierergebnis ansehen', 'View tournament results') + '</button></div>');
      if (id === 'results' && event.matches.length) panel.insertAdjacentHTML('beforeend',
        '<div class="fc-step-actions noprint"><button type="button" data-phase="play">' +
        tr('Zurück zum Turnierablauf', 'Back to tournament play') + '</button></div>');
      app.appendChild(panel);
    });
  }
  function showPhase(id, focus) {
    if (id === 'tools' && phase !== 'tools') toolsReturn = phase;
    phase = id;
    const close = app.querySelector('.fc-tools-close');
    if (close) close.dataset.phase = toolsReturnPhase();
    const opener = document.getElementById('fc-tools-open');
    if (opener) opener.setAttribute('aria-expanded', id === 'tools' ? 'true' : 'false');
    app.querySelectorAll('.fc-phase').forEach(panel => { panel.hidden = panel.id !== 'fc-phase-' + id; });
    app.querySelectorAll('.fc-phases [data-phase]').forEach(button => {
      if (button.dataset.phase === id) button.setAttribute('aria-current', 'step');
      else button.removeAttribute('aria-current');
    });
    if (focus) document.getElementById('fc-phase-' + id + '-heading').focus();
  }
  function revealTarget(target) {
    const panel = target.closest('.fc-phase');
    if (panel) showPhase(panel.id.slice('fc-phase-'.length), false);
    const fixture = target.closest('.fc-fixture');
    if (fixture && fixture.hidden) {
      document.getElementById('fc-search').value = '';
      search();
    }
    let ancestor = target.parentElement;
    while (ancestor && ancestor !== app) {
      if (ancestor.tagName === 'DETAILS') ancestor.open = true;
      ancestor = ancestor.parentElement;
    }
  }
  function followAnchor() {
    if (location.hash === routedHash || location.hash.indexOf('#fc-') !== 0) return;
    const target = document.getElementById(location.hash.slice(1));
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
    event.organizations.forEach(o => {
      const card = Array.from(registration.querySelectorAll('[data-company]')).find(node => node.dataset.company === o.id);
      const teams = event.teams.filter(t => t.orgId === o.id);
      const details = document.createElement('details');
      details.className = 'fc-company-teams';
      details.open = expandedCompanies.indexOf(o.id) !== -1;
      const summary = document.createElement('summary');
      summary.textContent = tr('Teams', 'Teams') + ' (' + teams.length + ')';
      details.appendChild(summary);
      if (!teams.length) {
        const empty = document.createElement('p');
        empty.className = 'fc-empty';
        empty.textContent = tr('Noch keine Teams. Klicke auf „+ Team“.', 'No teams yet. Select “+ Team”.');
        details.appendChild(empty);
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
    if (!next.replans.length) next.fieldLimit = Math.min(c.config.fields, c.config.referees);
    form.querySelectorAll('[data-team-name]').forEach(input => { next.teams.find(t => t.id === input.dataset.teamName).name = input.value.trim(); });
    form.querySelectorAll('[data-team-org]').forEach(input => { next.teams.find(t => t.id === input.dataset.teamOrg).orgId = input.value; });
    next.teams.forEach(t => {
      t.roster = Array.from(form.querySelectorAll('[data-member]')).filter(input => input.dataset.member === t.id)
        .map(input => input.value.trim()).filter(Boolean);
    });
    form.querySelectorAll('[data-org-name]').forEach(input => { next.organizations.find(o => o.id === input.dataset.orgName).name = input.value.trim(); });
    form.querySelectorAll('[data-nominee]').forEach(input => {
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
    const unassigned = next.organizations.find(o => !next.teams.some(t => t.id === o.nominee && t.orgId === o.id));
    if (unassigned) throw new Error(tr('In Schritt 1 das Team für den Firmenpokal wählen für: ', 'Choose the company trophy team in step 1 for: ') + unassigned.name);
    if (!(next.formatVersion >= 3) && next.teams.some(t => t.roster.length < 2)) {
      throw new Error(tr('Mindestens zwei Spieler:innen-Namen je Team für dieses ältere Planformat erforderlich.', 'At least two player names per team required for this older plan format.'));
    }
  }
  function reopenDraft(next) {
    if (event.startedAt || Object.keys(event.results).length) throw new Error('Started event frozen / Gestartete Veranstaltung eingefroren');
    if (event.status !== 'draft' && !confirm(tr('Vorläufigen Gruppenplan verwerfen? Teams, Spieler:innen und Teamauswahl für den Firmenpokal bleiben erhalten.', 'Discard preliminary pool schedule? Teams, players and company trophy team choices are retained.'))) return null;
    next.status = 'draft'; next.matches = []; next.pools = []; next.finalPools = []; next.drawOrder = [];
    return next;
  }
  function editedProgress() {
    const next = copyDraftFromForm();
    if (event.status !== 'draft' && (JSON.stringify(next.config) !== JSON.stringify(event.config) ||
        next.organizations.some(o => o.nominee === null))) return reopenDraft(next);
    return next;
  }
  function showSetupStep(step) {
    setupStep = step;
    app.querySelectorAll('[data-panel]').forEach(panel => { panel.hidden = Number(panel.dataset.panel) !== step; });
    app.querySelectorAll('.fc-substeps [data-step]').forEach(button => {
      if (Number(button.dataset.step) === step) button.setAttribute('aria-current', 'step');
      else button.removeAttribute('aria-current');
    });
    const panel = app.querySelector('[data-panel="' + step + '"]');
    if (panel) { panel.setAttribute('tabindex', '-1'); panel.focus(); }
  }
  async function goStep(step, forward) {
    if (step === 2) step = 1;
    if (step === 1 && setupStep === 3) {
      setupSettingsDraft = captureSetupSettings();
      showSetupStep(1);
      return;
    }
    let next = copyDraftFromForm();
    if (step === 3 && setupStep !== 3) {
      readyTeams(next);
      if (invalidSetupSettings()) {
        setupSettingsDraft = captureSetupSettings();
        if (event.status !== 'draft') {
          showSetupStep(3);
          notify(tr('Ungültige Regeleingaben wurden nicht gespeichert. Der bisherige Plan bleibt unverändert.', 'Invalid rule settings were not saved. The existing schedule remains unchanged.'), true);
          return;
        }
        next.config = event.config;
        next.title = event.title;
        if (!next.replans.length) next.fieldLimit = Math.min(event.config.fields, event.config.referees);
        await save(next, tr('Firmen und Teams gespeichert. Ungültige Regeleingaben sind noch nicht gespeichert.', 'Companies and teams saved. Invalid rule settings are still unsaved.'));
        showSetupStep(3);
        notify(tr('Firmen und Teams gespeichert. Ungültige Regeleingaben sind noch nicht gespeichert.', 'Companies and teams saved. Invalid rule settings are still unsaved.'), true);
        return;
      }
      setupSettingsDraft = null;
    } else next = editedProgress();
    if (!next) return;
    if (forward && step === 2 && !next.organizations.length) throw new Error(tr('Zuerst eine Firma anlegen.', 'Create a company first.'));
    setupStep = step;
    await save(next);
    const panel = app.querySelector('[data-panel="' + step + '"]');
    if (panel) { panel.setAttribute('tabindex', '-1'); panel.focus(); }
  }
  function bind() {
    app.querySelectorAll('[data-phase]').forEach(node => {
      node.onclick = () => action(async function () {
        if (!readOnly && !event.startedAt && phase === 'configuration') {
          const next = editedProgress();
          if (!next) return;
          await save(next);
        }
        const target = node.dataset.phase, leavingTools = phase === 'tools' && target !== 'tools';
        showPhase(target, !leavingTools);
        if (leavingTools) document.getElementById('fc-tools-open').focus();
      });
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
    const form = document.getElementById('fc-edit');
    if (form) {
      ['input', 'change'].forEach(type => form.addEventListener(type, updateSetupPreview));
      form.onsubmit = ev => {
        ev.preventDefault();
        action(async () => { const next = editedProgress(); if (next) await save(next); });
      };
      updateSetupPreview();
    }
    app.querySelectorAll('[data-step], [data-next]').forEach(node => {
      node.onclick = () => action(() => goStep(Number(node.dataset.step || node.dataset.next), !!node.dataset.next));
    });
    app.querySelectorAll('[data-order]').forEach(node => {
      node.onclick = () => action(async function () {
        const next = reopenDraft(copyDraftFromForm());
        if (!next) return;
        const list = next[node.dataset.order], index = list.findIndex(item => item.id === node.dataset.id);
        const target = index + Number(node.dataset.direction);
        if (index < 0 || target < 0 || target >= list.length) throw new Error('Invalid order / Ungültige Reihenfolge');
        const item = list.splice(index, 1)[0]; list.splice(target, 0, item);
        await save(next);
        const control = app.querySelector('[data-order="' + node.dataset.order + '"][data-id="' + node.dataset.id +
          '"][data-direction="' + node.dataset.direction + '"]');
        if (control && !control.disabled) control.focus();
        else {
          const input = app.querySelector('[data-' + (node.dataset.order === 'teams' ? 'team-name' : 'org-name') + '="' + node.dataset.id + '"]');
          if (input) input.focus();
        }
      });
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
      const updateDraw = function () {
        if (!draw) return;
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
          if (!form.reportValidity()) {
            const invalid = form.querySelector(':invalid');
            if (invalid) notify(invalid.validationMessage, true);
            return;
          }
          const data = new FormData(form), id = form.dataset.score;
          const next = F.score(event, id, Number(data.get('a')), Number(data.get('b')), data.get('drawWinner'));
          lastScored = id;
          await save(next);
          const item = app.querySelector('[data-match="' + id + '"]');
          if (item) { item.scrollIntoView({ block: 'center' }); item.setAttribute('tabindex', '-1'); item.focus(); }
        });
      };
    });
    app.querySelectorAll('[data-outcome]').forEach(form => {
      form.onsubmit = ev => {
        ev.preventDefault();
        action(async function () {
          const data = new FormData(form), type = String(data.get('type'));
          const absent = String(data.get('absent')), winner = String(data.get('winner')) || null;
          const typeText = type === 'withdrawal' ? tr('Rückzug aus dem Wettbewerb', 'withdrawal from the competition') :
            tr('Nichtantreten nur in dieser Begegnung', 'nonappearance in this match only');
          const rankingText = winner ?
            tr('Das gegnerische Team erhält 2 Wertungspunkte; es wird kein Ball-Spielstand erfunden.', 'The opposing team gets 2 standings points; no ball score will be invented.') :
            tr('Die Begegnung wird ohne Wertungspunkte aufgehoben.', 'The match is voided with no standings points.');
          if (!confirm(typeText + '. ' + rankingText + ' ' +
              tr('Diese Entscheidung bleibt getrennt von gespielten Ergebnissen gespeichert.', 'This organizer decision is stored separately from played scores.'))) return;
          await save(F.decideOutcome(event, form.dataset.outcome, type, absent, winner, String(data.get('note') || '')),
            tr('Entscheidung protokolliert; keine normale Punktzahl wurde gespeichert.', 'Decision recorded; no normal score was stored.'));
        });
      };
    });
    const absentForm = document.getElementById('fc-absent-form');
    if (absentForm) absentForm.onsubmit = ev => {
      ev.preventDefault();
      action(async function () {
        const select = document.getElementById('fc-absent-select'), id = select.value;
        if (!id) { select.focus(); throw new Error(tr('Zuerst das fehlende Team wählen.', 'Choose the missing team first.')); }
        await save(F.checkIn(event, id, 'absent'), teamName(id) + tr(' als abwesend gemeldet. Spielplan und Ergebnisse unverändert.', ' reported absent. Fixtures and results unchanged.'));
        const picker = document.getElementById('fc-absent-select');
        if (picker && !picker.disabled) picker.focus();
      });
    };
    app.querySelectorAll('[data-present]').forEach(node => {
      node.onclick = () => action(async function () {
        const id = node.dataset.present;
        await save(F.checkIn(event, id, 'unconfirmed'), teamName(id) + tr(' ist wieder da.', ' is back.'));
        const picker = document.getElementById('fc-absent-select');
        if (picker) picker.focus();
      });
    });
    app.querySelectorAll('[data-focus-target]').forEach(link => {
      link.onclick = function (ev) {
        ev.preventDefault();
        const target = document.getElementById(link.dataset.focusTarget);
        if (!target) return;
        revealTarget(target);
        target.scrollIntoView({ block: target.matches('section') ? 'start' : 'center' });
        if (target.matches('article')) {
          const input = target.querySelector('input, select, button');
          (input || target).focus();
        } else target.focus();
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
    document.getElementById('fc-search').oninput = search;
    app.querySelectorAll('[data-action]').forEach(node => {
      node.onclick = function () {
        if (node.dataset.action === 'print') {
          app.querySelectorAll('.fc-fixture').forEach(el => { el.hidden = false; });
          window.print(); search(); return;
        }
        if (!readOnly) action(() => runAction(node.dataset.action, node.dataset.company, node.dataset.team));
      };
    });
  }
  function search() {
    clearSuccessNotice();
    const q = document.getElementById('fc-search').value.trim().toLocaleLowerCase();
    const ids = event.teams.filter(t => (t.name + ' ' + orgName(t.orgId)).toLocaleLowerCase().indexOf(q) >= 0).map(t => t.id);
    const matches = event.matches.filter(m => {
      const a = F.resolve(event, m.a), b = F.resolve(event, m.b);
      return !q || ids.indexOf(a) >= 0 || ids.indexOf(b) >= 0;
    });
    app.querySelectorAll('.fc-fixture').forEach(el => { el.hidden = !matches.some(m => m.id === el.dataset.match); });
    const next = matches.find(m => !event.results[m.id] && !event.outcomes[m.id] && F.resolve(event, m.a) && F.resolve(event, m.b));
    document.getElementById('fc-next').innerHTML = q ?
      '<p class="fc-next">' + (next ? tr('Nächstes offenes Spiel: ', 'Next pending match: ') + F.clock(next.startMin) + ' · ' + tr('Feld ', 'Court ') + next.field + ' · ' + matchLabel(next) :
        tr('Kein offenes, bereits zugeordnetes Spiel. Finalgegner können noch offen sein.', 'No pending, assigned match. Final opponents may still be unresolved.')) + '</p>' : '';
    const summary = document.getElementById('fc-search-summary');
    if (summary) summary.textContent = q ? matches.length + tr(' Spiele gefunden; gedruckt wird immer der Gesamtplan.', ' matches found; print always includes the full schedule.') : '';
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
    next.status = 'draft'; next.matches = []; next.pools = []; next.finalPools = []; next.drawOrder = [];
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
      throw new Error(error.message + ' ' + tr('Nichts wurde geändert; bitte zuerst unter „Konfiguration“ anpassen.', 'Nothing was changed; adjust under “Configuration” first.'));
    }
    const built = F.build(next);
    if (!confirm(tr('Abwesende Teams aus der Anmeldung entfernen und Gruppenplan neu erstellen?', 'Remove absent teams from registration and rebuild the pool schedule?') + '\n' +
        tr('Entfernt: ', 'Removed: ') + ids.map(teamName).join(', ') +
        (emptied.length ? '\n' + tr('Ohne verbleibendes Team ebenfalls entfernt: ', 'Also removed, no team left: ') + emptied.map(o => o.name).join(', ') : '') + '\n' +
        tr('Noch nichts ist gestartet. Der neue Plan ersetzt den bisherigen vorläufigen Plan.', 'Nothing has started yet. The new schedule replaces the previous preliminary one.'))) return;
    await save(built, tr('Teams entfernt und Gruppenplan neu erstellt: ', 'Teams removed and pool schedule rebuilt: ') + built.matches.length + tr(' Spiele.', ' matches.'));
  }
  async function runAction(name, companyId, teamId) {
    if (name === 'save-setup') {
      let next;
      if (invalidSetupSettings()) {
        setupSettingsDraft = captureSetupSettings();
        next = copyDraftFromForm();
        next.config = event.config;
        next.title = event.title;
        if (!next.replans.length) next.fieldLimit = Math.min(event.config.fields, event.config.referees);
        await save(next, tr('Entwurf gespeichert. Ungültige Regeleingaben sind noch nicht gespeichert.', 'Draft saved. Invalid rule settings are still unsaved.'));
        notify(tr('Entwurf gespeichert. Ungültige Regeleingaben sind noch nicht gespeichert.', 'Draft saved. Invalid rule settings are still unsaved.'), true);
      } else {
        next = editedProgress();
        if (next) {
          setupSettingsDraft = null;
          await save(next, tr('Entwurf gespeichert.', 'Draft saved.'));
        }
      }
    } else if (name === 'build') {
      const next = copyDraftFromForm(); readyTeams(next);
      const draft = reopenDraft(next);
      if (draft) {
        const plan = F.build(draft);
        setupSettingsDraft = null;
        await save(plan);
        document.getElementById('fc-capacity').scrollIntoView({ block: 'start' });
      }
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
      const next = reopenDraft(copyDraftFromForm());
      if (!next) return;
      let addedTeamId = null;
      if (name === 'add-team') {
        if (next.teams.length >= teamLimit(next)) throw new Error(tr('Maximal ', 'Maximum ') + teamLimit(next) + tr(' Teams in diesem Planformat.', ' teams in this plan format.'));
        if (!next.organizations.length) throw new Error(tr('Zuerst eine Firma anlegen.', 'Create a company first.'));
        const orgField = document.getElementById('fc-new-team-org');
        const orgId = companyId || (orgField && orgField.value);
        if (!next.organizations.some(o => o.id === orgId)) throw new Error(tr('Firma für das neue Team wählen.', 'Choose a company for the new team.'));
        const id = 't-' + uid();
        addedTeamId = id;
        next.teams.push({ id: id, name: 'Team ' + (next.teams.length + 1), orgId: orgId, roster: [] });
        const organization = next.organizations.find(o => o.id === orgId);
        if (organization.nominee === null) organization.nominee = id;
      } else {
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
      await save(next);
      if (addedTeamId) {
        const input = app.querySelector('[data-team-name="' + addedTeamId + '"]');
        const details = input.closest('.fc-company-teams');
        if (details) details.open = true;
        input.focus();
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
      if (!confirm(tr('Zentral jetzt starten? Einstellungen und Teamauswahl für den Firmenpokal werden gesperrt. Timer ist nur eine lokale Uhrhilfe.', 'Start centrally now? Settings and the team choice for the company trophy will be locked. Timer is only a local clock aid.'))) return;
      await save(F.beginWave(event, wave, new Date().toISOString()));
    } else if (name === 'replan') {
      const fromWave = Number(document.getElementById('fc-replan-wave').value);
      const delay = Number(document.getElementById('fc-replan-delay').value);
      const fields = Number(document.getElementById('fc-replan-fields').value);
      const reason = document.getElementById('fc-replan-reason').value.trim();
      const before = event.matches.filter(m => m.wave >= fromWave && !event.results[m.id] && !event.outcomes[m.id]);
      const preview = F.replan(event, fromWave, delay, fields, reason);
      const after = preview.matches.filter(m => m.wave >= fromWave && !event.results[m.id] && !event.outcomes[m.id]);
      const end = list => Math.max.apply(null, list.map(m => m.startMin + preview.config.minutes));
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
      if (!document.getElementById('fc-share-consent').checked) throw new Error(tr('Öffentliches Teilen zuerst bestätigen.', 'Confirm public sharing first.'));
      binding = await Server.publish(event);
      render();
      notify(tr('Dauerhafter Live-Link veröffentlicht. Änderungen werden lokal gesichert und mit Serverrevision synchronisiert.', 'Persistent live link published. Changes are saved locally and synchronized with server revisions.'));
    } else if (name === 'editor-link') {
      if (!binding || !binding.id) throw new Error(tr('Zuerst einen Live-Link veröffentlichen.', 'Publish a live link first.'));
      if (!confirm(tr('Dieser geheime Link gewährt Bearbeitungszugriff einschließlich privater Kaderdaten. Nur vertrauenswürdigen Mitveranstalter:innen separat übermitteln; es gibt keine Konten oder individuellen Rollen.', 'This secret link grants editing access, including private roster data. Share it separately only with trusted co-organizers; there are no accounts or individual roles.'))) return;
      const output = document.getElementById('fc-editor-link-output');
      output.hidden = false;
      document.getElementById('fc-editor-url').value = Server.editorUrl(binding.id, binding.token, location.href, en ? 'en' : 'de');
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
    history.replaceState(null, '', '?local=' + event.id + '&lang=' + (en ? 'en' : 'de'));
    render(); notify(tr('Als neue Veranstaltung auf diesem Gerät wiederhergestellt; keine bestehende Veranstaltung überschrieben.', 'Restored as a new event on this device; no existing event overwritten.'));
  }
  function updateCountdown() {
    const node = document.getElementById('fc-countdown');
    if (!node || !event) return;
    if (!event.liveWave) { node.textContent = tr('Noch kein tatsächlicher Start.', 'No actual start yet.'); return; }
    const elapsed = Math.max(0, Math.floor((Date.now() - Date.parse(event.liveWave.startedAt)) / 1000));
    const play = event.config.minutes * 60, slot = (event.config.minutes + event.config.change) * 60;
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
    app.querySelectorAll('details').forEach(node => { node.dataset.printOpen = node.open ? '1' : '0'; node.open = true; });
    app.querySelectorAll('.fc-fixture').forEach(node => { node.hidden = false; });
  });
  window.addEventListener('hashchange', followAnchor);
  window.addEventListener('afterprint', function () {
    app.querySelectorAll('details[data-print-open]').forEach(node => { node.open = node.dataset.printOpen === '1'; });
    if (document.getElementById('fc-search')) search();
  });
  window.addEventListener('focus', function () {
    if (!readOnly && event && !busy) Store.load(event.id).then(function (disk) {
      if (disk && disk.revision !== event.revision) notify(tr('Anderer Tab hat diese Veranstaltung gespeichert. Neu laden; ungespeicherte Eingaben zuerst sichern.', 'Another tab saved this event. Reload; preserve unsaved entries first.'));
    }, function (error) { console.error('Firmencup:', error); notify(error.message, true); });
    if (livePublic) pollPublic();
    else if (!readOnly && event) pollEditor();
  });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') {
      if (livePublic) pollPublic();
      else if (!readOnly && event) pollEditor();
    }
  });
  setInterval(updateCountdown, 1000);
  setInterval(function () {
    if (livePublic) pollPublic();
    else if (!readOnly && event) pollEditor();
  }, 15000);
  action(async function () {
    if (readOnly) {
      if (legacySnapshot) {
        const snapshot = Share.decode(location.hash.slice(10));
        if (params.get('eventId') !== snapshot.event.id) throw new Error('Event ID mismatch / Veranstaltungs-ID stimmt nicht');
        event = snapshot.event; capturedAt = snapshot.capturedAt;
      } else {
        const remote = await Server.get(params.get('eventId'));
        if (remote.canEdit) throw new Error('Public link unexpectedly has editor access / Öffentlicher Link besitzt unerwartet Bearbeitungsrechte');
        event = F.validate(remote.event, { publicSnapshot: true });
        livePublic = true; liveRevision = remote.revision; liveEtag = remote.etag;
      }
      render();
    } else if (params.has('local')) {
      event = await Store.load(params.get('local'));
      if (!event) throw new Error('Local event not found / Lokale Veranstaltung nicht gefunden');
      binding = await Server.load(event.id);
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
      binding = await Server.adopt(event.id, serverId, capability, remote.revision, event);
      history.replaceState(null, '', '?local=' + encodeURIComponent(event.id) + '&lang=' + (en ? 'en' : 'de'));
      render();
      notify(tr('Bearbeitungsrecht geladen. Dieses Browsergerät kann nun synchronisieren.', 'Editor capability loaded. This browser can now synchronize.'));
    } else await landing();
  });
})();
