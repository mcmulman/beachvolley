(function () {
  'use strict';
  var KEY = 'BEACHL.feedbackDraft';
  var API = 'https://beachvolley.klickdienst-server.de/api/feedback.php';
  var dialog = null;
  var opener = null;
  var background = [];
  var overflow = '';
  var DE = {
    button: 'Feedback / Fehler melden', title: 'Feedback', type: 'Art', error: 'Fehler', idea: 'Idee', question: 'Frage',
    message: 'Dein Feedback', email: 'Antwort-E-Mail (optional)', technical: 'Die unten gezeigten technischen Angaben beifügen',
    privacy: 'Bitte keine Spielernamen, Ergebnisse oder sonstigen personenbezogenen Daten eingeben. Es werden weder Screenshot noch Turnierdaten angehängt.',
    emailAction: 'Feedback senden', save: 'Entwurf speichern', remove: 'Entwurf löschen', close: 'Schließen',
    note: 'Dein Feedback wird direkt an das Projektteam übermittelt. Eine Antwort-E-Mail ist optional. Offline kannst du einen Entwurf auf diesem Gerät speichern.',
    saved: 'Entwurf auf diesem Gerät gespeichert. Noch nicht gesendet.', removed: 'Lokaler Entwurf gelöscht.',
    failed: 'Der Entwurf konnte nicht gespeichert oder gelesen werden. Bitte den Text vor dem Schließen kopieren.',
    sending: 'Feedback wird gesendet …', sent: 'Danke! Dein Feedback wurde übermittelt.',
    sendFailed: 'Feedback konnte nicht gesendet werden. Bitte prüfe deine Internetverbindung und versuche es erneut.',
    details: 'Technische Angaben'
  };
  function lang() { return window.TI18n ? window.TI18n.lang() : document.documentElement.lang.slice(0, 2); }
  function text(key) { return window.TI18n && window.TI18n.active() ? window.TI18n.t('feedback.' + key) : DE[key]; }
  function element(tag, value, parent) {
    var node = document.createElement(tag);
    if (value) node.textContent = value;
    if (parent) parent.appendChild(node);
    return node;
  }
  function details() {
    var platform = window.Capacitor && window.Capacitor.getPlatform ? window.Capacitor.getPlatform() : 'web';
    return 'Version: ' + (window.TReleaseLinks && window.TReleaseLinks.version || 'development') +
      '\nPlatform: ' + platform + '\nLanguage: ' + lang() +
      '\nPage: ' + location.pathname.split('/').pop();
  }
  function close() {
    if (!dialog) return;
    dialog.parentNode.removeChild(dialog);
    dialog = null;
    background.forEach(function (entry) {
      if (entry.hidden === null) entry.node.removeAttribute('aria-hidden');
      else entry.node.setAttribute('aria-hidden', entry.hidden);
      entry.node.inert = entry.inert;
    });
    background = [];
    document.body.style.overflow = overflow;
    if (opener && opener.isConnected) opener.focus();
  }
  function open() {
    if (dialog) return;
    opener = document.activeElement;
    if (!opener || opener === document.body) opener = document.getElementById('feedback-open');
    dialog = element('div');
    dialog.id = 'feedback-dialog';
    dialog.className = 'tf-overlay noprint';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'feedback-title');
    var panel = element('form', '', dialog);
    panel.className = 'tf-panel';
    var title = element('h2', text('title'), panel);
    title.id = 'feedback-title';
    element('p', text('note'), panel);
    var typeLabel = element('label', text('type'), panel);
    var type = element('select', '', typeLabel);
    ['error', 'idea', 'question'].forEach(function (key) {
      var option = element('option', text(key), type);
      option.value = key;
    });
    var messageLabel = element('label', text('message'), panel);
    var message = element('textarea', '', messageLabel);
    message.required = true;
    message.maxLength = 2000;
    message.rows = 5;
    var emailLabel = element('label', text('email'), panel);
    var email = element('input', '', emailLabel);
    email.type = 'email';
    email.maxLength = 254;
    email.autocomplete = 'email';
    element('p', text('privacy'), panel);
    var technicalLabel = element('label', '', panel);
    technicalLabel.className = 'tf-check';
    var technical = element('input', '', technicalLabel);
    technical.type = 'checkbox';
    element('span', text('technical'), technicalLabel);
    var info = element('pre', details(), panel);
    info.setAttribute('aria-label', text('details'));
    var status = element('p', '', panel);
    status.id = 'feedback-status';
    status.setAttribute('role', 'status');
    var actions = element('div', '', panel);
    actions.className = 'tf-actions';
    var submit = element('button', text('emailAction'), actions);
    submit.type = 'submit';
    var save = element('button', text('save'), actions);
    save.type = 'button';
    var remove = element('button', text('remove'), actions);
    remove.type = 'button';
    var cancel = element('button', text('close'), actions);
    cancel.type = 'button';
    cancel.addEventListener('click', close);
    function draft() {
      return { type: type.value, message: message.value, email: email.value, technical: technical.checked };
    }
    try {
      var stored = localStorage.getItem(KEY);
      if (stored) {
        var value = JSON.parse(stored);
        if (!value || ['error', 'idea', 'question'].indexOf(value.type) < 0 ||
            typeof value.message !== 'string' || value.message.length > 2000 ||
            typeof value.email !== 'string' || value.email.length > 254) throw new Error('Invalid draft');
        type.value = value.type;
        message.value = value.message;
        email.value = value.email;
        technical.checked = value.technical === true;
      }
    } catch (error) { status.textContent = text('failed'); }
    save.addEventListener('click', function () {
      if (!message.value.trim() || !panel.reportValidity()) return;
      try { localStorage.setItem(KEY, JSON.stringify(draft())); status.textContent = text('saved'); }
      catch (error) { status.textContent = text('failed'); }
    });
    remove.addEventListener('click', function () {
      try {
        localStorage.removeItem(KEY);
        message.value = ''; email.value = ''; technical.checked = false;
        status.textContent = text('removed');
      } catch (error) { status.textContent = text('failed'); }
    });
    panel.addEventListener('submit', function (event) {
      event.preventDefault();
      if (!message.value.trim() || !panel.reportValidity() || submit.disabled) return;
      submit.disabled = true;
      status.textContent = text('sending');
      fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: type.value,
          message: message.value.trim(),
          email: email.value.trim(),
          technical: technical.checked ? details() : ''
        })
      }).then(function (response) {
        if (!response.ok) throw new Error('Feedback request failed (' + response.status + ')');
        status.textContent = text('sent');
        submit.disabled = true;
      }).catch(function () {
        status.textContent = text('sendFailed');
        submit.disabled = false;
      });
    });
    dialog.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
      if (event.key !== 'Tab') return;
      var nodes = panel.querySelectorAll('select, textarea, input, button');
      var first = nodes[0], last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
    dialog.addEventListener('click', function (event) { if (event.target === dialog) close(); });
    background = Array.prototype.map.call(document.body.children, function (node) {
      var entry = { node: node, hidden: node.getAttribute('aria-hidden'), inert: !!node.inert };
      node.setAttribute('aria-hidden', 'true');
      node.inert = true;
      return entry;
    });
    overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.body.appendChild(dialog);
    message.focus();
  }
  function mount() {
    var footer = document.querySelector('.footer-legal, footer');
    if (!footer) return;
    if (!document.getElementById('feedback-open')) {
      var footerButton = element('button', text('button'), footer);
      footerButton.id = 'feedback-open';
      footerButton.className = 'tf-open noprint';
      footerButton.type = 'button';
      footerButton.addEventListener('click', open);
    }
    if (!document.getElementById('feedback-plan-open') && footer.parentNode) {
      var planButton = element('button', text('button'));
      planButton.id = 'feedback-plan-open';
      planButton.className = 'tf-open tf-plan-open noprint';
      planButton.type = 'button';
      planButton.addEventListener('click', open);
      var placement = document.getElementById('affiliate-recommendations') || footer;
      placement.parentNode.insertBefore(planButton, placement);
    }
  }
  window.TFeedback = { open: open, close: close };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
