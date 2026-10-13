(function () {
  'use strict';

  var docs = {
    // 0: titleKey, 1: summaryKey, 2: isGeneric, 3: formatKey
    'format-gruppen-platzierungsrunde.html': ['home.card.gruppen.title', 'doc.summary.gruppen', true, 'gruppen-final'],
    'format-jeder-gegen-jeden.html': ['home.format.rr', 'doc.summary.rr', true, 'runden_rr'],
    'format-schweizer-system.html': ['home.format.swiss', 'doc.summary.swiss', true, 'runden_swiss'],
    'format-ko-system.html': ['home.ko.title', 'doc.summary.ko', true, 'ko-flex'],
    'format-double-elimination.html': ['home.card.de.title', 'doc.summary.de', true, 'de-flex'],
    'format-modified-pool-play.html': ['home.format.mpp', 'doc.summary.mpp', true, 'mpp'],
    'format-king-of-the-court.html': ['home.format.koc', 'home.card.koc.desc', false, 'koc'],
    'format-king-queen.html': ['home.format.kingqueen', 'home.card.kingqueen.desc', false, 'kingqueen'],
    'format-flex-turnier.html': ['home.format.flex', 'doc.summary.flex', true, 'flex_rr'],
    'format-tandem.html': ['home.format.tandem', 'home.card.tandem.desc', false, 'tandem'],
    'format-eltern-kind.html': ['home.format.elternkind', 'home.card.elternkind.desc', false, 'eltern-kind'],
    'format-meisterschaften.html': ['home.format.meisterschaften', 'home.card.meisterschaften.desc', false, 'meisterschaften'],
    'format-davis-cup.html': ['home.format.daviscup', 'home.card.daviscup.desc', false, 'daviscup']
  };

  var FALLBACK_PROFILES = {
    'volleyball.beach': {
      id: 'volleyball.beach', version: 1, nameKey: 'sport.beach',
      participantKey: 'sport.participant.team', surfaceKey: 'sport.surface.court',
      matchUnitKey: 'sport.unit.set'
    },
    'volleyball.indoor': {
      id: 'volleyball.indoor', version: 1, nameKey: 'sport.indoor',
      participantKey: 'sport.participant.team', surfaceKey: 'sport.surface.court',
      matchUnitKey: 'sport.unit.set'
    },
    'table-tennis.singles': {
      id: 'table-tennis.singles', version: 1, nameKey: 'sport.tableTennisSingles',
      participantKey: 'sport.participant.player', surfaceKey: 'sport.surface.table',
      matchUnitKey: 'sport.unit.game'
    },
    'table-tennis.doubles': {
      id: 'table-tennis.doubles', version: 1, nameKey: 'sport.tableTennisDoubles',
      participantKey: 'sport.participant.pair', surfaceKey: 'sport.surface.table',
      matchUnitKey: 'sport.unit.game'
    }
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

    var contextPanel = document.createElement('section');
    contextPanel.className = 'doc-context-panel';
    contextPanel.id = 'docContextPanel';
    contextPanel.setAttribute('aria-labelledby', 'docContextHeading');
    contextPanel.innerHTML =
      '<h2 id="docContextHeading" class="doc-context-heading">' +
        '<span class="doc-context-title"></span> ' +
        '<span class="doc-context-tag"></span>' +
      '</h2>' +
      '<p class="doc-context-scope"></p>' +
      '<dl class="doc-context-glossary">' +
        '<div class="doc-context-term"><dt class="doc-context-dt"></dt><dd class="doc-context-dd doc-context-participant"></dd></div>' +
        '<div class="doc-context-term"><dt class="doc-context-dt"></dt><dd class="doc-context-dd doc-context-surface"></dd></div>' +
        '<div class="doc-context-term"><dt class="doc-context-dt"></dt><dd class="doc-context-dd doc-context-unit"></dd></div>' +
      '</dl>' +
      '<p class="doc-context-rules"></p>' +
      '<p class="doc-context-disclaimer"></p>' +
      '<p class="doc-context-unsupported" hidden></p>';

    var container = page.classList.contains('wrap') ? page : (page.querySelector('.wrap') || page);
    var sportNoteDe = container.querySelector('.doc-sport-note');
    if (sportNoteDe) {
      sportNoteDe.parentNode.insertBefore(contextPanel, sportNoteDe.nextSibling);
    } else {
      var navEl = container.querySelector('.nav');
      if (navEl) {
        navEl.parentNode.insertBefore(contextPanel, navEl.nextSibling);
      } else {
        var introEl = container.querySelector('.intro');
        if (introEl) {
          introEl.parentNode.insertBefore(contextPanel, introEl.nextSibling);
        } else {
          container.appendChild(contextPanel);
        }
      }
    }

    var summary = document.createElement('section');
    summary.className = 'doc-en-summary';
    summary.innerHTML = '<h1></h1><h2></h2><p class="doc-en-description"></p>' +
      (keys[2] ? '<p class="doc-en-note doc-en-sport"><strong></strong> <span></span></p>' : '') +
      '<p class="doc-en-note"></p>';
    contextPanel.parentNode.insertBefore(summary, contextPanel);

    var title = summary.querySelector('h1');
    var heading = summary.querySelector('h2');
    var description = summary.querySelector('.doc-en-description');
    var note = summary.querySelector('.doc-en-note:not(.doc-en-sport)');
    var sportNote = summary.querySelector('.doc-en-sport');
    var originalTitle = document.title;
    var titleKey = keys[0];

    var contextTitle = contextPanel.querySelector('.doc-context-title');
    var contextTag = contextPanel.querySelector('.doc-context-tag');
    var contextScope = contextPanel.querySelector('.doc-context-scope');
    var contextRules = contextPanel.querySelector('.doc-context-rules');
    var contextDisclaimer = contextPanel.querySelector('.doc-context-disclaimer');
    var contextUnsupported = contextPanel.querySelector('.doc-context-unsupported');
    var termDtList = contextPanel.querySelectorAll('.doc-context-dt');
    var termParticipant = contextPanel.querySelector('.doc-context-participant');
    var termSurface = contextPanel.querySelector('.doc-context-surface');
    var termUnit = contextPanel.querySelector('.doc-context-unit');

    function update() {
      var english = TI18n.lang() === 'en';
      document.documentElement.classList.toggle('doc-en', english);
      summary.hidden = !english;
      if (english) {
        title.textContent = TI18n.t(titleKey);
        heading.textContent = TI18n.t('doc.quick.heading');
        description.textContent = TI18n.t(keys[1]);
        note.textContent = TI18n.t('doc.quick.note');
        if (sportNote) {
          sportNote.querySelector('strong').textContent = TI18n.t('doc.sportNote.title');
          sportNote.querySelector('span').textContent = TI18n.t('doc.sportNote');
        }
        document.title = 'CompetitionPilot – ' + title.textContent + ' – Format guide';
      } else {
        document.title = originalTitle;
      }

      var isGeneric = !!keys[2];
      var formatKey = keys[3];
      var activeProfile = null;
      var explicitSport = false;
      if (typeof TSport !== 'undefined' && TSport) {
        var q = TSport.fromSearch ? TSport.fromSearch(location.search) : null;
        if (q && q.ok && q.explicit) {
          activeProfile = q.profile;
          explicitSport = true;
        } else if (q && q.ok && !isGeneric) {
          activeProfile = q.profile;
        } else if (TSport.homeSelection) {
          var homeId = TSport.homeSelection();
          activeProfile = TSport.get(homeId, 1);
        }
      }
      if (!activeProfile && typeof FALLBACK_PROFILES !== 'undefined') {
        var match = /[?&]sport=([^&#]+)/.exec(location.search);
        var sportParam = match ? decodeURIComponent(match[1]) : '';
        if (sportParam && FALLBACK_PROFILES[sportParam]) {
          activeProfile = FALLBACK_PROFILES[sportParam];
          explicitSport = true;
        } else {
          activeProfile = FALLBACK_PROFILES['volleyball.beach'];
        }
      }

      contextTitle.textContent = TI18n.t('doc.context.title');
      if (termDtList && termDtList.length >= 3) {
        termDtList[0].textContent = TI18n.t('sport.glossary.participant');
        termDtList[1].textContent = TI18n.t('sport.glossary.surface');
        termDtList[2].textContent = TI18n.t('sport.glossary.unit');
      }

      if (explicitSport && activeProfile) {
        contextTag.textContent = TI18n.t(activeProfile.nameKey);
        termParticipant.textContent = TI18n.t(activeProfile.participantKey);
        termSurface.textContent = TI18n.t(activeProfile.surfaceKey);
        termUnit.textContent = TI18n.t(activeProfile.matchUnitKey);

        var formatSupported = true;
        if (typeof TSport !== 'undefined' && TSport && formatKey) {
          formatSupported = TSport.supportsFormat(activeProfile.id, formatKey);
        } else if (!isGeneric && activeProfile.id !== 'volleyball.beach') {
          formatSupported = false;
        }
        if (!formatSupported) {
          contextUnsupported.hidden = false;
          contextUnsupported.textContent = TI18n.t('doc.context.notStandard');
        } else {
          contextUnsupported.hidden = true;
        }
      } else if (!isGeneric) {
        contextTag.textContent = TI18n.t('sport.beach');
        termParticipant.textContent = TI18n.t('sport.participant.team');
        termSurface.textContent = TI18n.t('sport.surface.court');
        termUnit.textContent = TI18n.t('sport.unit.set');
        contextUnsupported.hidden = true;
      } else {
        contextTag.textContent = TI18n.t('doc.context.multiSportBadge');
        termParticipant.textContent = TI18n.t('doc.context.multiParticipant');
        termSurface.textContent = TI18n.t('doc.context.multiSurface');
        termUnit.textContent = TI18n.t('doc.context.multiUnit');
        contextUnsupported.hidden = true;
      }

      contextScope.textContent = TI18n.t('doc.context.drawOnly');
      contextRules.textContent = TI18n.t('doc.context.separateRules');
      contextDisclaimer.textContent = TI18n.t('doc.context.disclaimer');
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
      '.topbar.doc-generated-toolbar{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;margin-bottom:8px;}' +
      '.topbar.doc-generated-toolbar>*{margin-right:12px;margin-bottom:12px;}' +
      '.topbar.doc-generated-toolbar>:last-child{margin-right:0;}' +
      '.topbar.doc-generated-toolbar .back-link,.topbar.doc-generated-toolbar .print-btn{display:inline-flex;align-items:center;min-height:44px;}' +
      '.topbar.doc-generated-toolbar .top-actions{display:flex;align-items:center;}' +
      '.topbar.doc-generated-toolbar .top-actions>*+*{margin-left:8px;}' +
      'html.doc-generated-toolbar .wrap>.back-link{display:none;}' +
      'html.doc-en .page>:not(.topbar):not(.doc-en-summary):not(.doc-context-panel):not(.wrap){display:none!important;}html.doc-en .wrap>:not(.topbar):not(.doc-en-summary):not(.doc-context-panel){display:none!important;}' +
      'html.doc-en .doc-en-summary{display:block!important;}' +
      'html.doc-en .doc-context-panel{display:block!important;margin-top:20px;}' +
      'html.doc-en body>footer{display:none!important;}' +
      'html.doc-en .topbar{align-items:center;}' +
      'html.doc-en .top-actions{align-items:center;}' +
      '.doc-context-panel{display:block;background:#f7fafd;border:1px solid #cdd8e6;border-left:4px solid #1f4e79;border-radius:6px;padding:12px 14px;margin:16px 0 20px;font-size:13px;line-height:1.5;color:#222;}' +
      '.doc-context-panel .doc-context-heading{font-size:14px;font-weight:700;color:#1f4e79;margin:0 0 6px 0;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;}' +
      '.doc-context-panel .doc-context-tag{display:inline-block;background:#e8edf3;color:#1f4e79;font-size:11px;font-weight:700;padding:2px 8px;border-radius:12px;margin-left:8px;}' +
      '.doc-context-panel .doc-context-glossary{display:flex;flex-wrap:wrap;margin:6px 0 8px;padding:6px 0;border-top:1px solid #e0e6ef;border-bottom:1px solid #e0e6ef;font-size:12px;}' +
      '.doc-context-panel .doc-context-term{display:flex;margin-right:16px;margin-bottom:2px;}' +
      '.doc-context-panel .doc-context-dt{font-weight:700;color:#1a3a5c;margin-right:4px;}' +
      '.doc-context-panel .doc-context-dd{margin:0;color:#333;font-weight:600;}' +
      '.doc-context-panel p{margin:4px 0 0;font-size:12.5px;color:#39465a;}' +
      '.doc-context-panel p:first-of-type{margin-top:0;}' +
      '.doc-context-panel .doc-context-disclaimer{font-size:11.5px;color:#5a6375;margin-top:6px;}' +
      '.doc-context-panel .doc-context-unsupported{font-size:12px;color:#854d0e;background:#fef9c3;padding:4px 8px;border-radius:4px;margin-top:6px;}' +
      '@media print{' +
        'html.doc-en .doc-context-panel{display:block!important;}' +
        '.doc-context-panel{display:block!important;background:#fff!important;border:1px solid #1f4e79!important;border-left:3pt solid #1f4e79!important;padding:6pt 8pt!important;margin:3mm 0!important;font-size:8.5pt!important;line-height:1.35!important;page-break-inside:avoid;break-inside:avoid;}' +
        '.doc-context-panel .doc-context-heading{font-size:9.5pt!important;margin-bottom:3pt!important;}' +
        '.doc-context-panel .doc-context-glossary{display:flex!important;flex-wrap:wrap!important;margin:3pt 0!important;padding:3pt 0!important;border-top:.5pt solid #ccc!important;border-bottom:.5pt solid #ccc!important;font-size:8pt!important;}' +
        '.doc-context-panel .doc-context-term{display:flex!important;margin-right:12pt!important;}' +
        '.doc-context-panel p{margin:2pt 0 0!important;font-size:8pt!important;}' +
        '.doc-context-panel .doc-context-disclaimer{font-size:7.5pt!important;color:#444!important;}' +
      '}';
    document.head.appendChild(style);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
