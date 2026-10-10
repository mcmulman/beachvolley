(function () {
  'use strict';

  // Injected only into staged store builds, never into the web/PWA sources.
  window.TReleaseConfig = Object.freeze({ timer: false, cloudSharing: false });

  function apply() {
    function text(key, fallback) {
      return window.TI18n && window.TI18n.active() ? window.TI18n.t(key) : fallback;
    }
    document.querySelectorAll('.footer-amazon, #home-timer-link').forEach(function (node) {
      node.parentNode.removeChild(node);
    });
    [
      ['home.management.hint', 'release.code.hint', 'Offline-Link erhalten? Hier das geteilte Turnier öffnen.'],
      ['home.sheets.features', 'release.sheets.features', 'Alle Bögen: Teamnamen · Feldnamen · Zeiten konfigurierbar · Freilos/Ausfall · Druckvorlage A4 quer · Ergebnisse auf diesem Gerät gespeichert']
    ].forEach(function (entry) {
      document.querySelectorAll('[data-i18n="' + entry[0] + '"]').forEach(function (node) {
        node.setAttribute('data-i18n', entry[1]);
        node.textContent = text(entry[1], entry[2]);
      });
    });
    var hint = document.querySelector('[data-i18n="home.code.hint"]');
    if (hint) {
      hint.setAttribute('data-i18n', 'release.code.hint');
      hint.textContent = text('release.code.hint', 'Offline-Link erhalten? Hier das geteilte Turnier öffnen.');
    }
    var badge = document.querySelector('[data-i18n="home.management.shared"]');
    if (badge) {
      badge.setAttribute('data-i18n', 'release.code.badge');
      badge.textContent = text('release.code.badge', 'Offline-Link');
    }
    var input = document.getElementById('code-open-input');
    if (input) {
      input.setAttribute('data-i18n-attr', 'placeholder:release.code.placeholder;aria-label:release.code.placeholder');
      input.setAttribute('placeholder', text('release.code.placeholder', 'Vollständigen Offline-Link einfügen'));
      input.setAttribute('aria-label', text('release.code.placeholder', 'Vollständigen Offline-Link einfügen'));
    }
    var footer = document.querySelector('footer');
    var links = window.TReleaseLinks;
    if (footer && links && !document.getElementById('store-policy-links')) {
      var nav = document.createElement('nav');
      nav.id = 'store-policy-links';
      nav.className = 'noprint';
      ['support', 'privacy'].forEach(function (type) {
        var value = links[type + 'Url'];
        if (!value) return;
        var url = new URL(value);
        if (url.protocol !== 'https:' || url.username || url.password) {
          throw new Error('Invalid store ' + type + ' URL');
        }
        var link = document.createElement('a');
        link.href = url.href;
        link.setAttribute('data-i18n', 'release.links.' + type);
        link.textContent = text('release.links.' + type, type === 'support' ? 'Support' : 'Datenschutz');
        link.style.marginRight = '16px';
        nav.appendChild(link);
      });
      footer.appendChild(nav);
    }
    if (window.TI18n && window.TI18n.active()) window.TI18n.apply(document);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply);
  else apply();
})();
