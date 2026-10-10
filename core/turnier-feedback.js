(function () {
  'use strict';
  var KEY = 'BEACHL.feedbackDraft';
  var API = 'https://beachvolley.klickdienst-server.de/api/feedback.php';
  var dialog = null;
  var opener = null;
  var background = [];
  var overflow = '';
  var session = null;
  var update = null;
  var onStorage = null;
  var sentDraft = null;
  var DE = {
    button: 'Feedback / Fehler melden', title: 'Feedback', type: 'Art', error: 'Fehler', idea: 'Idee', question: 'Frage',
    message: 'Dein Feedback', email: 'Antwort-E-Mail (optional)', technical: 'Technische Angaben beifügen',
    privacy: 'Keine Spielernamen oder persönlichen Daten im Text. Keine Screenshots oder Turnierdaten werden angehängt.',
    emailAction: 'Feedback senden', save: 'Entwurf speichern', remove: 'Entwurf löschen', close: 'Schließen',
    note: 'Direkt an das Projektteam. Offline als Entwurf speicherbar.',
    saved: 'Entwurf auf diesem Gerät gespeichert. Noch nicht gesendet.', removed: 'Lokaler Entwurf gelöscht.',
    failed: 'Der Entwurf konnte nicht gespeichert oder gelesen werden. Bitte den Text vor dem Schließen kopieren.',
    sending: 'Feedback wird gesendet …', sent: 'Danke! Dein Feedback wurde übermittelt.',
    sendFailed: 'Senden nicht bestätigt. Dein Text bleibt erhalten. Prüfe deine Verbindung und versuche es erneut.',
    details: 'Technische Angaben (optional)', sentTitle: 'Danke für dein Feedback!',
    draftKept: 'Ein anderer lokaler Entwurf bleibt gespeichert.',
    cleanupFailed: 'Feedback gesendet, aber der lokale Entwurf konnte nicht entfernt werden. Bitte nicht erneut senden.'
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
    if (update) update(false);
    update = null;
    if (onStorage) window.removeEventListener('storage', onStorage);
    onStorage = null;
    if (session && session.state === 'sent') session = null;
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
    var editor = element('div', '', panel);
    var note = element('p', text('note'), editor);
    note.className = 'tf-note';
    var typeLabel = element('label', text('type'), editor);
    var type = element('select', '', typeLabel);
    ['error', 'idea', 'question'].forEach(function (key) {
      var option = element('option', text(key), type);
      option.value = key;
    });
    var messageLabel = element('label', text('message'), editor);
    var message = element('textarea', '', messageLabel);
    message.required = true;
    message.maxLength = 2000;
    message.rows = 3;
    var emailLabel = element('label', text('email'), editor);
    var email = element('input', '', emailLabel);
    email.type = 'email';
    email.maxLength = 254;
    email.autocomplete = 'email';
    var privacy = element('p', text('privacy'), editor);
    privacy.id = 'feedback-privacy';
    privacy.className = 'tf-note';
    message.setAttribute('aria-describedby', privacy.id);
    var advanced = element('details', '', editor);
    advanced.className = 'tf-details';
    element('summary', text('details'), advanced);
    var technicalLabel = element('label', '', advanced);
    technicalLabel.className = 'tf-check';
    var technical = element('input', '', technicalLabel);
    technical.type = 'checkbox';
    element('span', text('technical'), technicalLabel);
    var info = element('pre', details(), advanced);
    info.setAttribute('aria-label', text('details'));
    var status = element('p', '', editor);
    status.id = 'feedback-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.setAttribute('aria-atomic', 'true');
    var actions = element('div', '', editor);
    actions.className = 'tf-actions';
    var submit = element('button', text('emailAction'), actions);
    submit.type = 'submit';
    submit.className = 'tf-primary';
    var cancel = element('button', text('close'), actions);
    cancel.type = 'button';
    cancel.addEventListener('click', close);
    var drafts = element('div', '', editor);
    drafts.className = 'tf-drafts';
    var save = element('button', text('save'), drafts);
    save.type = 'button';
    save.id = 'feedback-save';
    var remove = element('button', text('remove'), drafts);
    remove.type = 'button';
    remove.id = 'feedback-remove';
    remove.hidden = true;
    var confirmation = element('div', '', panel);
    confirmation.className = 'tf-success';
    confirmation.hidden = true;
    var receipt = element('p', text('sent'), confirmation);
    receipt.setAttribute('role', 'status');
    var draftNotice = element('p', '', confirmation);
    draftNotice.className = 'tf-note';
    var done = element('button', text('close'), confirmation);
    done.className = 'tf-primary';
    done.type = 'button';
    done.addEventListener('click', close);
    function draft() {
      return { type: type.value, message: message.value, email: email.value, technical: technical.checked };
    }
    function sameDraft(a, b) {
      return a && b && a.type === b.type && a.message === b.message &&
        a.email === b.email && (a.technical === true) === (b.technical === true);
    }
    function refreshRemove() {
      try { remove.hidden = !localStorage.getItem(KEY); }
      catch (error) { remove.hidden = true; }
    }
    try {
      var stored = localStorage.getItem(KEY);
      if (stored && !session) {
        var value = JSON.parse(stored);
        if (!value || ['error', 'idea', 'question'].indexOf(value.type) < 0 ||
            typeof value.message !== 'string' || value.message.length > 2000 ||
            typeof value.email !== 'string' || value.email.length > 254) throw new Error('Invalid draft');
        if (!sameDraft(value, sentDraft)) {
          type.value = value.type;
          message.value = value.message;
          email.value = value.email;
          technical.checked = value.technical === true;
        }
      }
    } catch (error) { status.textContent = text('failed'); }
    if (!session) session = { values: draft(), state: 'editing', notice: '' };
    var current = session;
    type.value = current.values.type;
    message.value = current.values.message;
    email.value = current.values.email;
    technical.checked = current.values.technical;
    refreshRemove();
    onStorage = function (event) { if (event.key === KEY || event.key === null) refreshRemove(); };
    window.addEventListener('storage', onStorage);
    update = function (render) {
      if (current.state !== 'pending' && current.state !== 'sent') current.values = draft();
      if (render === false) return;
      var pending = current.state === 'pending';
      var sent = current.state === 'sent';
      editor.hidden = sent;
      confirmation.hidden = !sent;
      panel.setAttribute('aria-busy', pending ? 'true' : 'false');
      [type, message, email, technical, submit, save, remove].forEach(function (node) { node.disabled = pending || sent; });
      if (pending) status.textContent = text('sending');
      else if (current.state === 'failed') status.textContent = text('sendFailed');
      status.className = current.state === 'failed' ? 'tf-status tf-error' : 'tf-status';
      if (sent) {
        title.textContent = text('sentTitle');
        draftNotice.textContent = current.notice ? text(current.notice) : '';
        done.focus();
        panel.scrollTop = 0;
      }
      else if (pending && document.activeElement && document.activeElement.disabled) cancel.focus();
    };
    save.addEventListener('click', function () {
      if (current.state === 'pending' || current.state === 'sent') return;
      if (!message.value.trim() || !panel.reportValidity()) return;
      try {
        localStorage.setItem(KEY, JSON.stringify(draft()));
        current.values = draft(); current.state = 'editing';
        status.className = 'tf-status'; status.textContent = text('saved');
        refreshRemove();
      }
      catch (error) { status.textContent = text('failed'); }
    });
    remove.addEventListener('click', function () {
      if (current.state === 'pending' || current.state === 'sent') return;
      try {
        localStorage.removeItem(KEY);
        refreshRemove();
        current.state = 'editing';
        status.className = 'tf-status';
        status.textContent = text('removed');
        save.focus();
      } catch (error) { status.textContent = text('failed'); }
    });
    panel.addEventListener('submit', function (event) {
      event.preventDefault();
      if (current.state === 'pending' || current.state === 'sent' ||
          !message.value.trim() || !panel.reportValidity()) return;
      current.values = draft();
      current.state = 'pending';
      update();
      var controller = window.AbortController ? new AbortController() : null;
      var timeout = controller ? setTimeout(function () { controller.abort(); }, 30000) : null;
      fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: current.values.type,
          message: current.values.message.trim(),
          email: current.values.email.trim(),
          technical: current.values.technical ? details() : ''
        }),
        signal: controller ? controller.signal : undefined
      }).then(function (response) {
        if (!response.ok) throw new Error('Feedback request failed (' + response.status + ')');
        return response.json();
      }).then(function (result) {
        if (!result || result.ok !== true) throw new Error('Feedback was not confirmed');
        current.state = 'sent';
        sentDraft = current.values;
        try {
          var local = localStorage.getItem(KEY);
          if (local && sameDraft(JSON.parse(local), current.values)) localStorage.removeItem(KEY);
          else if (local) current.notice = 'draftKept';
        } catch (error) { current.notice = 'cleanupFailed'; }
      }).catch(function () {
        current.state = 'failed';
      }).then(function () {
        if (timeout !== null) clearTimeout(timeout);
        if (session === current && update) update();
      });
    });
    dialog.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
      if (event.key !== 'Tab') return;
      var nodes = Array.prototype.filter.call(panel.querySelectorAll('select, textarea, input, button, summary'), function (node) {
        return !node.disabled && !node.closest('[hidden]') && node.getClientRects().length &&
          getComputedStyle(node).visibility !== 'hidden';
      });
      var first = nodes[0], last = nodes[nodes.length - 1];
      if (event.shiftKey && (document.activeElement === first || nodes.indexOf(document.activeElement) < 0)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || nodes.indexOf(document.activeElement) < 0)) { event.preventDefault(); first.focus(); }
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
    if (current.state === 'pending') cancel.focus();
    else message.focus();
    update();
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
