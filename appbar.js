/* appbar.js – erzeugt die einheitliche App-Leiste aus der vorhandenen
   „← Zur Übersicht"-Navizeile. Rein Bildschirm-relevant; die Leiste ist .noprint
   und damit im Druck unsichtbar. */
(function () {
  var sectionToggles = [];
  var initialUiApplied = false;
  var namesPreference = 'BEACHL.uiSection.v1:' + location.pathname + ':names';

  function namesPanel() {
    var input = document.querySelector('[data-name-input]');
    return input && input.closest('.namepanel, #rosterSection');
  }

  function rememberNames() {
    var panel = namesPanel();
    if (!panel) return;
    try { localStorage.setItem(namesPreference, panel.hidden ? '0' : '1'); } catch (e) {}
  }

  function addNamingClosers() {
    if (!window.TNative || !window.TNative.mountClose) return;
    [
      { panel: namesPanel(), button: document.getElementById('btnToggleNames'), preference: namesPreference },
      { panel: document.getElementById('fieldpanel'), button: document.getElementById('btnToggleFields'),
        preference: 'BEACHL.uiSection.v1:' + location.pathname + ':fields' },
      { panel: document.getElementById('absentpanel'), button: document.getElementById('btnToggleAbsent'),
        preference: 'BEACHL.uiSection.v1:' + location.pathname + ':absent' }
    ].forEach(function (entry) {
      var panel = entry.panel, button = entry.button;
      if (!panel || !button || panel.__namingCloseWired || !initialUiApplied) return;
      panel.__namingCloseWired = true;
      button.setAttribute('aria-controls', panel.id);
      var close = window.TNative.mountClose(panel, 'Schließen', function () {
        // Use the sheet's own toggle, including its active state and related roster actions.
        if (!panel.hidden && !button.disabled) button.click();
        if (!panel.hidden) return;
        button.focus();
      }, null, true);
      close.classList.add('section-toggle-close');
      close.setAttribute('aria-controls', panel.id);
      function sync() {
        var expanded = !panel.hidden;
        button.setAttribute('aria-expanded', String(expanded));
        close.setAttribute('aria-expanded', String(expanded));
        close.hidden = !expanded || button.disabled;
        var state = window.TStore && window.TStore.initialUiState && window.TStore.initialUiState();
        if (!state || !state.readOnly) {
          try { localStorage.setItem(entry.preference, expanded ? '1' : '0'); } catch (e) {}
        }
      }
      if (panel.id === 'fieldpanel') {
        var saved = null;
        try { saved = localStorage.getItem(entry.preference); } catch (e) {}
        if (!button.disabled && saved !== null && panel.hidden === (saved === '1')) button.click();
      }
      button.addEventListener('click', function () {
        sync();
        if (!panel.hidden) {
          var input = panel.querySelector('input:not([disabled]):not([readonly]), select:not([disabled])');
          if (input) input.focus();
        }
      });
      if (window.MutationObserver) {
        new MutationObserver(sync).observe(panel, { attributes: true, attributeFilter: ['hidden'] });
        new MutationObserver(sync).observe(button, { attributes: true, attributeFilter: ['disabled'] });
      }
      sync();
      if (window.TI18n && window.TI18n.active()) window.TI18n.apply(close);
    });
  }

  function initializeVisibility() {
    if (initialUiApplied || !document.body.hasAttribute('data-bar-title')) return;
    var state = window.TStore && window.TStore.initialUiState && window.TStore.initialUiState();
    var panel = namesPanel(), button = document.getElementById('btnToggleNames');
    if (!state || !panel || !button) return;
    initialUiApplied = true;
    if (state.readOnly) return;
    if (state.isNew) sectionToggles.forEach(function (toggle) { toggle.setExpanded(true, true, false); });
    var preference = null;
    try { preference = localStorage.getItem(namesPreference); } catch (e) {}
    var show = state.isNew || preference === '1';
    var input = document.querySelector('[data-name-input]');
    if (!button.disabled && input && !input.disabled && !input.readOnly && panel.hidden === show) button.click();
    rememberNames();
    if (window.MutationObserver) {
      new MutationObserver(rememberNames).observe(panel, { attributes: true, attributeFilter: ['hidden'] });
    }
  }

  window.addEventListener('beachl:tournament-started', function () {
    sectionToggles.forEach(function (toggle) { toggle.setExpanded(true, true, false); });
    try { localStorage.setItem(namesPreference, '1'); } catch (e) {}
    setTimeout(function () {
      var panel = namesPanel(), button = document.getElementById('btnToggleNames');
      var input = document.querySelector('[data-name-input]');
      if (panel && panel.hidden && button && !button.disabled && input && !input.disabled && !input.readOnly) button.click();
    }, 0);
  });

  /* Titel fuer die App-Leiste: die Bogen setzen ihn ueber
     document.body.dataset.barTitle ("KO-System · 8 Teams · 4 Felder").
     Fallback fuer Seiten ohne diese Angabe: der Fenstertitel ohne das Wort
     "Turnierbogen" und ohne die Groessenangabe in Klammern. */
  function cleanTitle(t) {
    if (!t) return 'Turnierbogen';
    var s = String(t).replace(/\s*\([^()]*\)\s*$/, '');
    s = s.replace(/^\s*CompetitionPilot\s*[|–—-]\s*/i, '');
    s = s.replace(/\s*[–—-]\s*Turnierbogen\b/i, '');
    s = s.replace(/^\s*Turnierbogen\s*[–—-]?\s*/i, '');
    return s.trim() || String(t).trim();
  }
  function barTitle() {
    var t = document.body && document.body.getAttribute('data-bar-title');
    return (t && t.trim()) ? t.trim() : cleanTitle(document.title);
  }

  function addConfigToggle() {
    document.querySelectorAll('.cfgcard').forEach(function (card, index) {
      var grid = card.querySelector('.cfgcard-grid');
      if (!grid || card.querySelector('.cfg-setup-toggle')) return;

      var start = grid.querySelector('.cfgfield--start');
      var end = grid.querySelector('.cfgfield--end');
      if (start && end) {
        var times = document.createElement('div');
        times.className = 'cfg-time-pair';
        start.parentNode.insertBefore(times, start);
        times.appendChild(start);
        times.appendChild(end);
      }

      var content = document.createElement('div');
      content.className = 'cfg-setup-content';
      content.id = 'configSetup' + index;
      grid.parentNode.insertBefore(content, grid);
      content.appendChild(grid);
      var result = card.querySelector('.cfgresult');
      if (result) content.appendChild(result);
      var summary = document.getElementById('modeSummary');
      if (summary) content.appendChild(summary);
      var actions = card.querySelector('.cfg-action-content');
      if (actions) content.appendChild(actions);

      var head = card.querySelector('.cfgcard-head');
      if (!head) {
        head = document.createElement('div');
        head.className = 'cfgcard-head';
        card.insertBefore(head, content);
      }
      var heading = document.createElement('span');
      heading.className = 'cfgcard-head__label';
      if (head.hasAttribute('data-i18n')) {
        heading.setAttribute('data-i18n', head.getAttribute('data-i18n'));
        head.removeAttribute('data-i18n');
      }
      heading.textContent = head.textContent.trim() || 'Konfiguration';
      head.textContent = '';
      head.appendChild(heading);

      var reveal = document.createElement('button');
      reveal.type = 'button';
      reveal.className = 'nbtn cfg-setup-toggle cfg-actions-toggle section-toggle-open noprint';
      reveal.setAttribute('data-i18n', 'ui.section.configShow');
      reveal.textContent = 'Turnier-Konfiguration einblenden';
      head.appendChild(reveal);

      var toolbar = card.querySelector('.cfgcard-actions');
      card.classList.add('cfgcard--collapsible');
      if (toolbar) card.appendChild(toolbar);
      if (window.TI18n && window.TI18n.active()) window.TI18n.apply(head);
      if (window.TUI && window.TUI.wireSectionToggle) {
        sectionToggles.push(window.TUI.wireSectionToggle(content, reveal, head, {
          relatedContent: Array.prototype.slice.call(document.querySelectorAll('#rosterSection, #rosterActions')),
          preferenceId: 'setup-' + index,
          showKey: 'ui.section.configShow',
          hideKey: 'ui.section.configHide',
          showText: 'Turnier-Konfiguration einblenden',
          hideText: 'Turnier-Konfiguration ausblenden',
          focusSelector: 'input,select,button'
        }));
      }
    });
  }

  function addGuideToggle() {
    document.querySelectorAll('.guide').forEach(function (guide, index) {
      var heading = guide.querySelector('h2');
      if (!heading || guide.querySelector('.guide-content')) return;
      var header = document.createElement('div');
      header.className = 'guide-heading';
      var content = document.createElement('div');
      content.className = 'guide-content';
      content.id = 'guideContent' + index;
      heading.setAttribute('tabindex', '-1');
      guide.insertBefore(header, guide.firstChild);
      header.appendChild(heading);
      while (header.nextSibling) content.appendChild(header.nextSibling);
      guide.appendChild(content);

      var reveal = document.createElement('button');
      reveal.type = 'button';
      reveal.className = 'section-toggle-open guide-toggle-open noprint';
      reveal.setAttribute('data-i18n', 'ui.section.guideShow');
      reveal.textContent = 'Kurzanleitung einblenden';
      header.appendChild(reveal);
      if (window.TUI && window.TUI.wireSectionToggle) {
        sectionToggles.push(window.TUI.wireSectionToggle(content, reveal, header, {
          preferenceId: 'guide-' + guide.id,
          showKey: 'ui.section.guideShow',
          hideKey: 'ui.section.guideHide',
          showText: 'Kurzanleitung einblenden',
          hideText: 'Kurzanleitung ausblenden',
          defaultExpanded: true,
          focusTarget: heading
        }));
      }
    });
  }

  function groupConfigActions() {
    document.querySelectorAll('.cfgcard-actions').forEach(function (toolbar, index) {
      if (toolbar.querySelector('.cfg-actions-primary')) return;
      var card = toolbar.closest('.cfgcard');
      if (!card) return;
      var buttons = Array.prototype.slice.call(toolbar.querySelectorAll('button'));
      var content = document.createElement('div');
      content.className = 'cfg-action-content';
      content.id = 'configActions' + index;
      content.hidden = false;

      var groups = document.createElement('div');
      groups.className = 'cfg-action-groups';
      content.appendChild(groups);
      function makeGroup(label, danger) {
        var group = document.createElement('div');
        group.className = 'cfg-action-group' + (danger ? ' cfg-action-group--danger' : '');
        group.setAttribute('role', 'group');
        group.setAttribute('aria-label', label);
        var heading = document.createElement('div');
        heading.className = 'cfg-action-group__label';
        heading.textContent = label;
        group.appendChild(heading);
        var actions = document.createElement('div');
        actions.className = 'cfg-action-group__buttons';
        group.appendChild(actions);
        groups.appendChild(group);
        return actions;
      }
      var teams = makeGroup('Teams & Felder');
      var planning = makeGroup('Spielplanung');
      var reset = makeGroup('Zurücksetzen', true);
      var optionLabel = window.TI18n && window.TI18n.t
        ? window.TI18n.t('ui.section.options') : 'Weitere Optionen';
      var options = makeGroup(optionLabel);
      options.parentElement.classList.add('cfg-action-group--options');
      options.parentElement.setAttribute('data-cfg-options-group', '');
      options.setAttribute('data-cfg-options', '');
      var primary = document.createElement('div');
      primary.className = 'cfg-actions-primary';
      primary.setAttribute('role', 'group');
      primary.setAttribute('aria-label', 'Teilen und Speichern');

      // Move the existing buttons so their handlers and state stay intact.
      buttons.forEach(function (button) {
        if (button.matches('#btnShare, #btnSave, [onclick*="shareTournament"], [onclick*="manualSave"]')) {
          primary.appendChild(button);
        } else if (button.matches('#btnClearScores, #btnReset, [onclick*="clearScores"], [onclick*="resetTournament"]')) {
          button.classList.add('cfg-reset-action');
          reset.appendChild(button);
        } else if (button.matches('#btnToggleNames, #btnToggleFields, #btnToggleAbsent, #btnToggleDropout, [onclick*="toggleNames"], [onclick*="toggleFields"], [onclick*="toggleAbsent"], [onclick*="toggleDropout"]')) {
          teams.appendChild(button);
        } else {
          planning.appendChild(button);
        }
      });
      Array.prototype.slice.call(card.querySelectorAll(
        '.format-switch, #sport-profile-controls, #sport-mode-estimate-controls, #outcome-profile-controls'
      ))
        .forEach(function (control) { options.appendChild(control); });
      [teams, planning, reset].forEach(function (actions) {
        if (!actions.children.length) groups.removeChild(actions.parentElement);
      });
      function syncOptionsVisibility() {
        options.parentElement.hidden = options.children.length === 0;
      }
      syncOptionsVisibility();
      if (window.MutationObserver) {
        new MutationObserver(syncOptionsVisibility).observe(options, { childList: true });
      }
      toolbar.querySelectorAll('.spacer').forEach(function (spacer) { spacer.remove(); });

      if (primary.children.length) toolbar.appendChild(primary);
      toolbar.parentNode.insertBefore(content, toolbar.nextSibling);
      document.querySelectorAll('.namepanel, #dropoutpanel').forEach(function (panel) {
        if (!panel.closest('.cfgcard') || panel.closest('.cfgcard') === card) content.appendChild(panel);
      });
    });
  }
  function addTeamCaptionEditors() {
    var original = document.getElementById('btnToggleNames');
    addCaptionEditors('table.teams caption, table.roster caption, #menStandTable caption, #womenStandTable caption',
      'team', '[data-name-input]', 'sheet.teams.editNames', 'Team / Namen bearbeiten', original);
    addCaptionEditors('table.timeplan caption', 'timeplan', '.cfg-setup-content input[type="time"]',
      'sheet.timeplan.editSettings', 'Zeiteinstellungen bearbeiten');
  }

  function addCaptionEditors(selector, kind, inputSelector, ariaKey, ariaLabel, original) {
    var first = document.querySelector(inputSelector);
    var editable = !!(first && !first.disabled && !first.readOnly && (kind !== 'team' || (original && !original.disabled)));
    document.querySelectorAll(selector).forEach(function (caption) {
      var captionKey = caption.getAttribute('data-i18n') || caption.getAttribute('data-team-caption-key');
      if (caption.closest('table.teams') && !/^(sheet|ko|dko)\.teams\.caption$/.test(captionKey || '')) return;
      var edit = caption.querySelector('.' + kind + '-caption-edit');
      if (!edit) {
        var title = caption.querySelector('.cap-title');
        if (!title) {
          title = document.createElement('span');
          title.className = 'cap-title';
          title.textContent = caption.textContent;
          var key = caption.getAttribute('data-i18n') || caption.getAttribute('data-team-caption-key');
          if (key) {
            title.setAttribute('data-i18n', key);
            caption.setAttribute('data-team-caption-key', key);
            caption.removeAttribute('data-i18n');
          }
          caption.textContent = '';
          caption.appendChild(title);
          if (key === 'ko.teams.caption' || key === 'dko.teams.caption') {
            var hint = document.createElement('span');
            hint.className = 'cap-hint only-print';
            hint.setAttribute('data-i18n', 'sheet.teams.seedHint');
            hint.textContent = 'Nr. 1 = Favorit.';
            caption.appendChild(hint);
          }
        }
        edit = document.createElement('button');
        edit.type = 'button';
        edit.className = 'caption-edit ' + kind + '-caption-edit noprint';
        edit.setAttribute('aria-label', ariaLabel);
        edit.setAttribute('data-i18n-attr', 'aria-label:' + ariaKey);
        var icon = document.querySelector('#btnToggleNames svg');
        if (icon) edit.appendChild(icon.cloneNode(true));
        var label = document.createElement('span');
        label.className = 'caption-edit-label team-caption-label';
        title.parentNode.insertBefore(label, title);
        label.appendChild(title);
        label.appendChild(edit);
        edit.addEventListener('click', function () {
          openConfigEditor(inputSelector, kind === 'team' ? original : null);
        });
        if (window.TI18n && window.TI18n.active()) window.TI18n.apply(caption);
      }
      if (edit.hidden === editable) edit.hidden = !editable;
    });
  }

  function openConfigEditor(inputSelector, original) {
    var input = document.querySelector(inputSelector);
    if (!input || input.disabled || input.readOnly) return false;
    var content = document.querySelector('.cfg-setup-content');
    var deferScroll = !!(content && content.hidden) || !!(original && !input.offsetHeight);
    if (content && content.hidden) document.querySelector('.cfg-setup-toggle').click();
    if (original && !input.offsetHeight) original.click();
    input = document.querySelector(inputSelector);
    input.focus();
    function scrollFocusedInput() {
      input = document.querySelector(inputSelector);
      if (!input || input.disabled || input.readOnly) return;
      var top = 12, bottom = window.innerHeight - 12;
      document.querySelectorAll('.app-bar, .mobile-jumpbar').forEach(function (bar) {
        var style = window.getComputedStyle(bar), box = bar.getBoundingClientRect();
        if (!box.height || (style.position !== 'fixed' && style.position !== 'sticky')) return;
        if (box.top < window.innerHeight / 2) top = Math.max(top, box.bottom + 12);
        else bottom = Math.min(bottom, box.top - 12);
      });
      var box = input.getBoundingClientRect();
      window.scrollTo(0, Math.max(0, window.pageYOffset + box.top - top - Math.max(0, (bottom - top - box.height) / 2)));
    }
    if (deferScroll) {
      window.requestAnimationFrame(function () { window.requestAnimationFrame(scrollFocusedInput); });
    } else {
      scrollFocusedInput();
    }
    return true;
  }

  function scrollToPanel(panel) {
    if (!panel) return;
    window.requestAnimationFrame(function () {
      if (panel.hidden || panel.classList.contains('section-content-collapsed')) return;
      var focused = document.activeElement;
      if (focused && panel.contains(focused) && /^(INPUT|SELECT|TEXTAREA)$/.test(focused.tagName)) return;
      var top = 12;
      document.querySelectorAll('.app-bar, .mobile-jumpbar').forEach(function (bar) {
        var style = window.getComputedStyle(bar), box = bar.getBoundingClientRect();
        if (!box.height || (style.position !== 'fixed' && style.position !== 'sticky')) return;
        if (box.top < window.innerHeight / 2) top = Math.max(top, box.bottom + 12);
      });
      var box = panel.getBoundingClientRect();
      window.scrollTo(0, Math.max(0, window.pageYOffset + box.top - top));
    });
  }

  function ensurePanelHeading(panel, button) {
    if (!panel || !button) return panel;
    panel.classList.add('section-panel-labelled');
    if (panel.id === 'rosterSection') panel.classList.add('section-roster-grid');
    var heading = panel.querySelector('.section-panel-heading');
    if (!heading || heading.parentNode !== panel) {
      heading = document.createElement('h2');
      heading.className = 'section-panel-heading';
      heading.id = 'section-panel-title-' + (panel.id || 'content');
      panel.insertBefore(heading, panel.firstChild);
    }
    var label = button.querySelector('span');
    heading.textContent = (label ? label.textContent : button.textContent).trim();
    panel.setAttribute('aria-labelledby', heading.id);
    return panel;
  }

  function wirePanelAutoScroll() {
    document.addEventListener('click', function (event) {
      var button = event.target.closest
        && event.target.closest('.section-toggle-open, #btnToggleNames, #btnToggleFields, #btnToggleAbsent, #btnToggleDropout');
      if (!button) return;
      var panel = null;
      if (button.classList.contains('section-toggle-open')) {
        var panelId = (button.getAttribute('aria-controls') || '').split(/\s+/)[0];
        panel = panelId && document.getElementById(panelId);
      } else if (button.id === 'btnToggleNames') {
        panel = namesPanel() || document.getElementById('rosterSection');
      } else if (button.id === 'btnToggleFields') {
        panel = document.getElementById('fieldpanel');
      } else if (button.id === 'btnToggleAbsent') {
        panel = document.getElementById('absentpanel') || document.getElementById('rosterSection');
      } else {
        panel = document.getElementById('dropoutpanel');
      }
      if (panel && !panel.hidden && !panel.classList.contains('section-content-collapsed')) {
        ensurePanelHeading(panel, button);
        scrollToPanel(panel);
      }
    });
  }

  window.TSheetEditors = window.TSheetEditors || {};
  window.TSheetEditors.openTimeEditor = function () {
    return openConfigEditor('.cfg-setup-content input[type="time"]');
  };
  window.TSheetEditors.scrollToPanel = scrollToPanel;


  function build() {
    document.body.classList.add('tournament-sheet');
    wirePanelAutoScroll();
    var alternateSchedule = document.getElementById('roundsContainer') || document.getElementById('ladderSection');
    if (alternateSchedule && typeof TUI !== 'undefined') {
      var jumpbar = document.getElementById('jumpbar');
      if (!jumpbar) {
        jumpbar = document.createElement('div');
        jumpbar.id = 'jumpbar';
        jumpbar.className = 'mobile-jumpbar noprint';
        document.body.appendChild(jumpbar);
      }
      jumpbar.innerHTML = TUI.jumpBarHtml({ schedule: alternateSchedule.id });
      TUI.wireJumpBar(jumpbar);
    }
    groupConfigActions();
    addConfigToggle();
    addGuideToggle();
    if (document.querySelector('.app-bar')) return;

    // vorhandene Navizeile finden (enthält Link zur Übersicht)
    var navs = Array.prototype.slice.call(document.querySelectorAll('body > .noprint'));
    var legacy = null, overviewHref = 'index.html', infoLink = null;
    for (var i = 0; i < navs.length; i++) {
      var a = navs[i].querySelector('a[href*="index.html"]');
      if (a) { legacy = navs[i]; overviewHref = a.getAttribute('href') || 'index.html'; break; }
    }
    if (legacy) {
      var info = legacy.querySelector('a[href*="docs/"], a[href*="format-"]');
      if (info) infoLink = { href: info.getAttribute('href'), target: info.getAttribute('target') || '_blank' };
      legacy.classList.add('legacy-nav');
    }

    var bar = window.TSheetHeader.create({ title: barTitle(), overviewHref: overviewHref, infoLink: infoLink });
    var title = bar.querySelector('.app-bar__context');
    var headerActions = bar.querySelector('.app-bar__actions');
    var primaryActions = document.querySelector('.cfg-actions-primary');
    if (headerActions && primaryActions) {
      primaryActions.querySelectorAll('button').forEach(function (button) {
        button.classList.add('app-bar__btn');
        button.removeAttribute('style');
        var label = button.querySelector('[data-i18n]');
        if (label) {
          label.classList.add('lbl');
          var attr = button.getAttribute('data-i18n-attr') || '';
          button.setAttribute('data-i18n-attr', (attr ? attr + ';' : '') + 'aria-label:' + label.getAttribute('data-i18n'));
        }
      });
      headerActions.insertBefore(primaryActions, headerActions.querySelector('.i18n-switch'));
    }
    document.body.insertBefore(bar, document.body.firstChild);
    if (window.TI18n && window.TI18n.active()) window.TI18n.apply(bar);

    // Titel live nachziehen, falls die Seite document.title dynamisch aktualisiert
    // (z. B. bei Änderung der Teamanzahl) – sonst zeigt die App-Leiste einen veralteten Stand.
    var titleEl = document.querySelector('title');
    if (window.MutationObserver) {
      var sync = function () { title.textContent = barTitle(); };
      if (titleEl) new MutationObserver(sync).observe(titleEl, { childList: true });
      new MutationObserver(sync).observe(document.body, { attributes: true, attributeFilter: ['data-bar-title'] });
    }

    // Mobile Scroll-Container: Tabellen (Spielplan/Verlauf) bei Bedarf in
    // einen schlanken Wrapper-Div (.scrollhint) einziehen, der horizontal
    // scrollt (flach, ohne Kanten-Verlauf – siehe app-skin.css). Läuft
    // wiederholt, da Spielpläne oft per innerHTML neu gerendert werden.
    function wrapScrollTables() {
      var language = document.querySelector('.app-bar__actions .i18n-switch');
      if (language && language.nextElementSibling) language.parentNode.appendChild(language);
      initializeVisibility();
      addNamingClosers();
      addTeamCaptionEditors();
      var tables = document.querySelectorAll('table.sched, table.track, table.stand, table.central-table');
      for (var i = 0; i < tables.length; i++) {
        var t = tables[i];
        var p = t.parentElement;
        if (p && p.classList && (p.classList.contains('scrollhint') || p.classList.contains('table-scroll'))) continue;
        var wrap = document.createElement('div');
        wrap.className = 'scrollhint';
        p.insertBefore(wrap, t);
        wrap.appendChild(t);
      }
      document.querySelectorAll('.table-scroll, .scrollhint').forEach(function (wrap, index) {
        if (!wrap.querySelector('table')) return;
        wrap.setAttribute('tabindex', '0');
        wrap.setAttribute('role', 'region');
        if (!wrap.hasAttribute('aria-labelledby') && !wrap.hasAttribute('aria-label')) {
          var caption = wrap.querySelector('caption');
          if (caption && caption.textContent.trim()) {
            if (!caption.id) caption.id = 'sheet-scroll-caption-' + index;
            wrap.setAttribute('aria-labelledby', caption.id);
          } else if (wrap.closest('#scheduleSection')) wrap.setAttribute('aria-labelledby', 'capSched');
          else wrap.setAttribute('aria-labelledby', 'standingsSection');
        }
      });
    }
    wrapScrollTables();
    if (window.MutationObserver) {
      var pending = false;
      var mo = new MutationObserver(function () {
        if (pending) return;
        pending = true;
        setTimeout(function () { pending = false; wrapScrollTables(); }, 50);
      });
      mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'readonly'] });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build);
  } else {
    build();
  }
})();
