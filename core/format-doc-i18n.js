(function () {
  'use strict';

  var docs = {
    'format-gruppen-platzierungsrunde.html': ['home.card.gruppen.title', 'home.card.gruppen.desc'],
    'format-jeder-gegen-jeden.html': ['home.format.rr', 'home.card.rr.desc'],
    'format-schweizer-system.html': ['home.format.swiss', 'home.card.swiss.desc'],
    'format-ko-system.html': ['home.ko.title', 'home.ko.desc'],
    'format-double-elimination.html': ['home.card.de.title', 'home.card.de.desc'],
    'format-modified-pool-play.html': ['home.format.mpp', 'home.card.mpp.desc'],
    'format-king-of-the-court.html': ['home.format.koc', 'home.card.koc.desc'],
    'format-king-queen.html': ['home.format.kingqueen', 'home.card.kingqueen.desc'],
    'format-flex-turnier.html': ['home.format.flex', 'home.card.flex.desc'],
    'format-tandem.html': ['home.format.tandem', 'home.card.tandem.desc'],
    'format-eltern-kind.html': ['home.format.elternkind', 'home.card.elternkind.desc'],
    'format-meisterschaften.html': ['home.format.meisterschaften', 'home.card.meisterschaften.desc'],
    'format-davis-cup.html': ['home.format.daviscup', 'home.card.daviscup.desc']
  };

  function start() {
    if (typeof TI18n === 'undefined' || !TI18n || !document.documentElement.hasAttribute('data-format-doc')) return;
    var keys = docs[location.pathname.split('/').pop()];
    var page = document.querySelector('.page');
    if (!keys || !page) return;

    var toolbar = page.querySelector('.topbar');
    if (!toolbar) {
      toolbar = document.createElement('div');
      toolbar.className = 'topbar noprint doc-generated-toolbar';
      var backLink = document.createElement('a');
      backLink.className = 'back-link';
      backLink.href = '../index.html';
      toolbar.appendChild(backLink);
      var actions = document.createElement('div');
      actions.className = 'top-actions';
      var printButton = document.createElement('button');
      printButton.className = 'print-btn';
      printButton.type = 'button';
      printButton.addEventListener('click', function () { window.print(); });
      actions.appendChild(printButton);
      toolbar.appendChild(actions);
      page.insertBefore(toolbar, page.firstChild);
      document.documentElement.classList.add('doc-generated-toolbar');
    }

    var summary = document.createElement('section');
    summary.className = 'doc-en-summary';
    summary.innerHTML = '<h1></h1><h2></h2><p class="doc-en-description"></p><p class="doc-en-note"></p>';
    page.appendChild(summary);

    var title = summary.querySelector('h1');
    var heading = summary.querySelector('h2');
    var description = summary.querySelector('.doc-en-description');
    var note = summary.querySelector('.doc-en-note');
    var originalTitle = document.title;
    var titleKey = keys[0];

    function update() {
      var english = TI18n.lang() === 'en';
      document.documentElement.classList.toggle('doc-en', english);
      summary.hidden = !english;
      if (english) {
        title.textContent = TI18n.t(titleKey);
        heading.textContent = TI18n.t('doc.quick.heading');
        description.textContent = TI18n.t(keys[1]);
        note.textContent = TI18n.t('doc.quick.note');
        document.title = title.textContent + ' – Format guide';
      } else {
        document.title = originalTitle;
      }
    }

    var back = page.querySelector('.back-link');
    if (back) back.textContent = TI18n.t('doc.back');
    var print = page.querySelector('.print-btn:not(.i18n-switch)');
    if (print) print.textContent = TI18n.t('doc.print');
    update();

    var actions = page.querySelector('.top-actions');
    if (actions && !actions.querySelector('.i18n-switch')) {
      var slot = document.createElement('span');
      actions.insertBefore(slot, actions.firstChild);
      TI18n.mountSwitch(slot, 'print-btn');
    }

    var style = document.createElement('style');
    style.textContent =
      '.doc-en-summary{display:none;padding:24px;background:#fff;border-radius:10px;box-shadow:0 10px 30px rgba(31,78,121,0.08);}' +
      '.doc-en-summary .doc-en-note{margin-top:20px;padding:10px 12px;background:#f7fafd;border-left:4px solid #1f4e79;font-size:13px;color:#5a6375;}' +
      '.doc-generated-toolbar{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:20px;}' +
      '.doc-generated-toolbar .back-link{margin-bottom:0;}' +
      'html.doc-generated-toolbar .wrap>.back-link{display:none;}' +
      'html.doc-en .page>:not(.topbar):not(.doc-en-summary){display:none!important;}' +
      'html.doc-en .page>.doc-en-summary{display:block!important;}' +
      'html.doc-en body>footer{display:none!important;}' +
      'html.doc-en .topbar{align-items:center;}' +
      'html.doc-en .top-actions{align-items:center;}';
    document.head.appendChild(style);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
