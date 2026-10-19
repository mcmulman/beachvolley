/* Shared tournament chrome only: no scoring, persistence or sheet initialization. */
(function () {
  'use strict';
  window.TSheetHeader = {
    create: function (options) {
      var bar = document.createElement('nav');
      bar.className = 'app-bar noprint';
      bar.setAttribute('aria-label', 'Seitennavigation');
      var back = document.createElement('a');
      back.className = 'app-bar__back';
      back.href = options.overviewHref || 'index.html';
      back.innerHTML = '<span class="chev" aria-hidden="true">‹</span><span class="lbl">Übersicht</span>';
      back.setAttribute('aria-label', 'Zur Übersicht');
      bar.appendChild(back);

      var title = document.createElement('div');
      title.className = 'app-bar__title';
      var brand = document.createElement('span');
      brand.className = 'app-bar__brand';
      brand.textContent = 'CompetitionPilot';
      title.appendChild(brand);
      var context = document.createElement('span');
      context.className = 'app-bar__context';
      context.textContent = options.title;
      title.appendChild(context);
      bar.appendChild(title);

      var actions = document.createElement('div');
      actions.className = 'app-bar__actions';
      if (options.infoLink) {
        var info = document.createElement('a');
        info.className = 'app-bar__btn';
        info.href = options.infoLink.href;
        info.target = options.infoLink.target;
        info.rel = 'noopener';
        info.innerHTML = '<span class="ic"><span style="display:none">📖</span><svg class="bl-ic" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg></span><span class="lbl">Info</span>';
        info.setAttribute('aria-label', 'Format-Info');
        actions.appendChild(info);
      }
      // Hidden marker retained for TI18n's shared chrome localization.
      var print = document.createElement('button');
      print.type = 'button';
      print.className = 'app-bar__btn';
      print.innerHTML = '<span class="ic"><span style="display:none">🖨</span><svg class="bl-ic" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg></span><span class="lbl">Drucken</span>';
      print.setAttribute('aria-label', 'Drucken');
      print.addEventListener('click', function () { window.print(); });
      actions.appendChild(print);
      bar.appendChild(actions);
      return bar;
    }
  };
})();
