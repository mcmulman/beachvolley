/* appbar.js – erzeugt die einheitliche App-Leiste aus der vorhandenen
   „← Zur Übersicht"-Navizeile. Rein Bildschirm-relevant; die Leiste ist .noprint
   und damit im Druck unsichtbar. */
(function () {
  /* Titel fuer die App-Leiste: die Bogen setzen ihn ueber
     document.body.dataset.barTitle ("KO-System · 8 Teams · 4 Felder").
     Fallback fuer Seiten ohne diese Angabe: der Fenstertitel ohne das Wort
     "Turnierbogen" und ohne die Groessenangabe in Klammern. */
  function cleanTitle(t) {
    if (!t) return 'Turnierbogen';
    var s = String(t).replace(/\s*\([^()]*\)\s*$/, '');
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

      var content = document.createElement('div');
      content.className = 'cfg-setup-content cfg-actions-content';
      content.id = 'configSetup' + index;
      content.hidden = false;
      grid.parentNode.insertBefore(content, grid);
      content.appendChild(grid);

      var actions = card.querySelector('.cfg-action-content');
      if (actions && actions !== content) content.appendChild(actions);

      var toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'nbtn cfg-setup-toggle cfg-actions-toggle';
      toggle.setAttribute('aria-expanded', 'true');
      toggle.setAttribute('aria-controls', content.id);
      // Die Kartenüberschrift wird zur Beschriftung des Umschalters (eine Zeile statt zwei).
      var head = card.querySelector('.cfgcard-head');
      var label = document.createElement('span');
      label.className = 'cfg-setup-toggle__label';
      if (head) {
        if (head.hasAttribute('data-i18n')) label.setAttribute('data-i18n', head.getAttribute('data-i18n'));
        label.textContent = head.textContent.trim();
        head.parentNode.removeChild(head);
      } else {
        toggle.setAttribute('data-label-key', 'chrome.configToggle');
        label.textContent = 'Konfiguration';
      }
      toggle.appendChild(label);
      var chevron = document.createElement('span');
      chevron.className = 'cfg-actions-chevron';
      chevron.setAttribute('aria-hidden', 'true');
      toggle.appendChild(chevron);
      toggle.addEventListener('click', function () {
        content.hidden = !content.hidden;
        toggle.setAttribute('aria-expanded', String(!content.hidden));
      });
      var toolbar = card.querySelector('.cfgcard-actions');
      card.classList.add('cfgcard--collapsible');
      if (toolbar) {
        toolbar.insertBefore(toggle, toolbar.firstChild);
        card.insertBefore(toolbar, content);
      } else {
        card.insertBefore(toggle, content);
      }
    });
  }

  function groupConfigActions() {
    document.querySelectorAll('.cfgcard-actions').forEach(function (toolbar, index) {
      if (toolbar.querySelector('.cfg-actions-toggle')) return;
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
      var primary = document.createElement('div');
      primary.className = 'cfg-actions-primary';
      primary.setAttribute('role', 'group');
      primary.setAttribute('aria-label', 'Teilen und Speichern');

      // Move the existing buttons so their handlers and state stay intact.
      buttons.forEach(function (button) {
        if (button.matches('#btnShare, #btnSave, [onclick*="shareTournament"], [onclick*="manualSave"]')) {
          primary.appendChild(button);
        } else if (button.matches('#btnClearScores, #btnReset, [onclick*="clearScores"], [onclick*="resetTournament"]')) {
          reset.appendChild(button);
        } else if (button.matches('#btnToggleNames, #btnToggleFields, #btnToggleAbsent, #btnToggleDropout, [onclick*="toggleNames"], [onclick*="toggleFields"], [onclick*="toggleAbsent"], [onclick*="toggleDropout"]')) {
          teams.appendChild(button);
        } else {
          planning.appendChild(button);
        }
      });
      [teams, planning, reset].forEach(function (actions) {
        if (!actions.children.length) groups.removeChild(actions.parentElement);
      });
      toolbar.querySelectorAll('.spacer').forEach(function (spacer) { spacer.remove(); });

      if (primary.children.length) toolbar.appendChild(primary);
      toolbar.parentNode.insertBefore(content, toolbar.nextSibling);
      document.querySelectorAll('#namepanel, #fieldpanel, #absentpanel, #dropoutpanel').forEach(function (panel) {
        if (!panel.closest('.cfgcard') || panel.closest('.cfgcard') === card) content.appendChild(panel);
      });
    });
  }

  function build() {
    groupConfigActions();
    addConfigToggle();
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

    var bar = document.createElement('div');
    bar.className = 'app-bar noprint';

    var back = document.createElement('a');
    back.className = 'app-bar__back';
    back.href = overviewHref;
    back.innerHTML = '<span class="chev">‹</span><span class="lbl">Übersicht</span>';
    back.setAttribute('aria-label', 'Zur Übersicht');
    bar.appendChild(back);

    var title = document.createElement('div');
    title.className = 'app-bar__title';
    title.textContent = barTitle();
    bar.appendChild(title);

    var actions = document.createElement('div');
    actions.className = 'app-bar__actions';

    if (infoLink) {
      var info2 = document.createElement('a');
      info2.className = 'app-bar__btn';
      info2.href = infoLink.href;
      info2.target = infoLink.target;
      info2.rel = 'noopener';
      info2.innerHTML = '<span class="ic">📖</span><span class="lbl">Info</span>';
      info2.setAttribute('aria-label', 'Format-Info');
      actions.appendChild(info2);
    }

    var printBtn = document.createElement('button');
    printBtn.type = 'button';
    printBtn.className = 'app-bar__btn';
    printBtn.innerHTML = '<span class="ic">🖨</span><span class="lbl">Drucken</span>';
    printBtn.setAttribute('aria-label', 'Drucken');
    printBtn.addEventListener('click', function () { window.print(); });
    actions.appendChild(printBtn);

    bar.appendChild(actions);
    document.body.insertBefore(bar, document.body.firstChild);

    // Titel live nachziehen, falls die Seite document.title dynamisch aktualisiert
    // (z. B. bei Änderung der Teamanzahl) – sonst zeigt die App-Leiste einen veralteten Stand.
    var titleEl = document.querySelector('title');
    if (window.MutationObserver) {
      var sync = function () { title.textContent = barTitle(); };
      if (titleEl) new MutationObserver(sync).observe(titleEl, { childList: true });
      new MutationObserver(sync).observe(document.body, { attributes: true, attributeFilter: ['data-bar-title'] });
    }

    // Mobile Scroll-Hinweis: Tabellen (Spielplan/Verlauf), die border-collapse
    // nutzen, verdecken den Kanten-Schatten-Hintergrund der Tabelle selbst
    // durch die undurchsichtigen Zellenhintergründe. Daher hier bei Bedarf
    // einen schlanken Wrapper-Div (.scrollhint) einziehen, auf dem der
    // Schatten (siehe app-skin.css) zuverlässig sichtbar bleibt. Läuft
    // wiederholt, da Spielpläne oft per innerHTML neu gerendert werden.
    function wrapScrollTables() {
      var tables = document.querySelectorAll('table.sched, table.track');
      for (var i = 0; i < tables.length; i++) {
        var t = tables[i];
        var p = t.parentElement;
        if (p && p.classList && (p.classList.contains('scrollhint') || p.classList.contains('table-scroll'))) continue;
        var wrap = document.createElement('div');
        wrap.className = 'scrollhint';
        p.insertBefore(wrap, t);
        wrap.appendChild(t);
      }
    }
    wrapScrollTables();
    if (window.MutationObserver) {
      var pending = false;
      var mo = new MutationObserver(function () {
        if (pending) return;
        pending = true;
        setTimeout(function () { pending = false; wrapScrollTables(); }, 50);
      });
      mo.observe(document.body, { childList: true, subtree: true });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build);
  } else {
    build();
  }
})();
