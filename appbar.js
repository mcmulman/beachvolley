/* appbar.js – erzeugt die einheitliche App-Leiste aus der vorhandenen
   „← Zur Übersicht"-Navizeile. Rein Bildschirm-relevant; die Leiste ist .noprint
   und damit im Druck unsichtbar. */
(function () {
  function cleanTitle(t) {
    if (!t) return 'Turnierbogen';
    return t.replace(/^\s*Turnierbogen\s*[–—-]?\s*/i, '').trim() || t.trim();
  }

  function build() {
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
    title.textContent = cleanTitle(document.title);
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
    if (titleEl && window.MutationObserver) {
      new MutationObserver(function () { title.textContent = cleanTitle(document.title); })
        .observe(titleEl, { childList: true });
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
