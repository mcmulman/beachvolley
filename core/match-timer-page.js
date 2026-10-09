/* ============================================================================
   match-timer-page.js – Bedienung der Seite Spiel_Timer.html (PRODUKTPLAN §6.5)

   Verbindet den reinen Zustand aus core/match-timer.js (TMatchTimer) mit dem
   DOM. Grundsätze:
   - Jede Aktion speichert sofort (synchron, localStorage). Eine Anzeige wird
     immer aus den gespeicherten Zeitpunkten berechnet – App-Wechsel,
     gedrosselte Intervalle und Neustart verfälschen die Zeit nicht.
   - Rückmeldung nie nur akustisch: sichtbare Anzeige, kurzes Aufleuchten
     und eine Live-Region für Screenreader. Ton standardmäßig aus.
   - Zurücksetzen nur nach Bestätigung; Korrekturen (−1, Direkteingabe,
     Rückgängig, Seitentausch, Satz beenden) verändern die Zeit nicht.
   - Countdown: Ablauf wird einmalig sichtbar, per Live-Region, mit Ton
     (falls an) und Vibration gemeldet; danach läuft Nachspielzeit „+MM:SS“.
   - Haptik: kurzes Antippen bei Punkten – nativ über das App-Plugin
     AppHaptics, im Browser über navigator.vibrate (iOS-Safari: ohne).
   - ?a=…&b=… (aus dem Turnierbogen) übernimmt Teamnamen; läuft bereits ein
     Spiel, erst nach Rückfrage.
   - Kein Zugriff auf TStore/Turnierdaten: Turnierergebnisse werden nie
     überschrieben; das Ergebnis wird bewusst im Turnierbogen eingetragen.
   - Mehrere Tabs: Änderungen aus anderen Tabs (storage-Ereignis) werden
     übernommen.

   Texte: tx('timer.…', deutscher Fallback) – Fallback == core/i18n/de.js.
   Safari 12: bewusst ES5, AudioContext mit webkit-Präfix (AGENTS.md §7b).
   ========================================================================== */
(function (root) {
  'use strict';
  var doc = root.document;
  var TM = root.TMatchTimer;
  if (!doc || !TM) return;

  function i18n() {
    return typeof TI18n !== 'undefined' && TI18n && TI18n.active() ? TI18n : null;
  }
  function tx(key, de, params) {
    var I = i18n();
    if (I) return I.t(key, params);
    return String(de).replace(/\{(\w+)\}/g, function (m, k) {
      return params && params[k] != null ? String(params[k]) : m;
    });
  }
  function byId(id) { return doc.getElementById(id); }
  function now() { return Date.now(); }
  function storage() {
    try { return root.localStorage || null; } catch (e) { return null; }
  }

  var STATUS_TEXT = {
    idle: function () { return tx('timer.status.idle', 'Bereit'); },
    running: function () { return tx('timer.status.running', 'Läuft'); },
    paused: function () { return tx('timer.status.paused', 'Pausiert'); },
    stopped: function () { return tx('timer.status.stopped', 'Gestoppt'); }
  };
  var PRIMARY = {
    start: { text: function () { return tx('timer.start', 'Start'); } },
    pause: { text: function () { return tx('timer.pause', 'Pause'); } },
    resume: { text: function () { return tx('timer.resume', 'Fortsetzen'); } },
    clear: { text: function () { return tx('timer.resetTime', 'Uhr zurücksetzen'); } }
  };

  var state = TM.create();
  var storageOk = true;
  var tickId = null;
  var lastTimeText = '';
  var wakeLock = null;
  var wakeDesired = null;
  var wakePlugin = null;
  var wakePluginEnabled = false;
  var wakePluginQueue = Promise.resolve();
  var pageUnloading = false;
  var expiredSignaled = false;
  var hapticPlugin = null;
  var pendingPrefill = null;
  var returnTarget = null;
  var RESULT_KEY = 'BEACHL.timerResult';
  var el = {};

  function sideName(side) {
    return state.names[side] || (side === 'a' ? tx('timer.sideA', 'Seite A') : tx('timer.sideB', 'Seite B'));
  }

  /* ------------------------------------------------------------ Speicher */
  function persist() {
    storageOk = TM.save(storage(), state);
    el.warning.hidden = storageOk;
  }
  function commit(next) {
    if (next === state) return false;
    state = next;
    persist();
    render();
    return true;
  }

  /* ----------------------------------------------------------------- Ton */
  var audioCtx = null;
  function beep(freq, delay, length) {
    if (!state.sound) return false;
    var Ctx = root.AudioContext || root.webkitAudioContext;
    if (!Ctx) return false;
    try {
      if (!audioCtx) audioCtx = new Ctx();
      if (audioCtx.state === 'suspended' && typeof audioCtx.resume === 'function') audioCtx.resume();
      var t = audioCtx.currentTime + (delay || 0);
      var len = length || 0.12;
      var osc = audioCtx.createOscillator();
      var gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.25, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + len);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(t);
      osc.stop(t + len + 0.01);
      return true;
    } catch (e) {
      return false;
    }
  }

  /* ------------------------------------------------------------- Haptik */
  function nativeHaptics() {
    if (hapticPlugin) return hapticPlugin;
    var cap = root.Capacitor;
    if (!cap || typeof cap.isNativePlatform !== 'function' || !cap.isNativePlatform() ||
        typeof cap.registerPlugin !== 'function') return null;
    try {
      var plugin = cap.registerPlugin('AppHaptics');
      hapticPlugin = plugin && typeof plugin.impact === 'function' ? plugin : null;
    } catch (e) {
      hapticPlugin = null;
    }
    return hapticPlugin;
  }
  /* style: 'light' (Punkt) | 'notice' (Seitenwechsel, Satzgewinn) |
     'warning' (Countdown/Auszeit abgelaufen). Nativ gibt es nur light/warning. */
  function haptic(style) {
    var plugin = nativeHaptics();
    if (plugin) {
      try {
        var p = plugin.impact({ style: style === 'light' ? 'light' : 'warning' });
        if (p && typeof p.catch === 'function') p.catch(function () {});
      } catch (e) { /* ohne Haptik */ }
      return;
    }
    var nav = root.navigator;
    if (nav && typeof nav.vibrate === 'function') {
      try { nav.vibrate(style === 'warning' ? [250, 120, 250, 120, 250] : (style === 'notice' ? [70, 60, 70] : 15)); } catch (e) { /* ohne Haptik */ }
    }
  }

  /* ------------------------------------------------------- Rückmeldungen */
  function announce(text) {
    /* Neu setzen, damit auch ein gleichlautender Text erneut vorgelesen wird. */
    el.announce.textContent = '';
    setTimeout(function () { el.announce.textContent = text; }, 30);
  }
  function scoreSentence() {
    return tx('timer.announce.score', 'Spielstand: {nameA} {a}, {nameB} {b}',
      { nameA: sideName('a'), a: state.score.a, nameB: sideName('b'), b: state.score.b });
  }
  var flashTimers = {};
  function flash(side) {
    var v = el.value[side];
    v.classList.remove('mt-flash');
    void v.offsetWidth;
    v.classList.add('mt-flash');
    clearTimeout(flashTimers[side]);
    flashTimers[side] = setTimeout(function () { v.classList.remove('mt-flash'); }, 600);
  }
  function showError(text) {
    el.error.textContent = text;
    el.error.hidden = !text;
  }

  /* ------------------------------------------------------------- Anzeige */
  function renderTime() {
    var t = now();
    var text = TM.formatClock(state, t);
    if (text !== lastTimeText) {
      el.time.textContent = text;
      lastTimeText = text;
    }
    var expired = TM.isExpired(state, t);
    el.root.classList.toggle('is-expired', expired);
    if (!expired) {
      expiredSignaled = false;
    } else if (!expiredSignaled) {
      expiredSignaled = true;
      el.status.textContent = statusText();
      if (state.status === 'running') signalExpired();
    }
  }
  function statusText() {
    if (state.status === 'running' && TM.isExpired(state, now())) return tx('timer.status.expired', 'Zeit abgelaufen');
    return STATUS_TEXT[state.status]();
  }
  function signalExpired() {
    beep(988, 0, 0.25);
    beep(988, 0.35, 0.25);
    beep(1319, 0.7, 0.45);
    haptic('warning');
    announce(tx('timer.announce.expired', 'Zeit abgelaufen'));
  }
  function modeText(ms) {
    return ms > 0 ? tx('timer.modeCountdown', 'Countdown {min} min', { min: Math.round(ms / 60000) })
      : tx('timer.modeStopwatch', 'Stoppuhr');
  }
  var COUNTDOWN_MINUTES = [5, 10, 12, 15, 20, 25, 30, 45, 60, 90];
  function addModeOption(min) {
    var opt = doc.createElement('option');
    opt.value = String(min);
    opt.textContent = tx('timer.modeCountdown', 'Countdown {min} min', { min: min });
    el.mode.appendChild(opt);
  }
  function renderMode() {
    var value = String(Math.round(state.countdownMs / 60000));
    var opts = el.mode.options;
    var found = false;
    for (var i = 0; i < opts.length; i++) if (opts[i].value === value) found = true;
    if (!found) addModeOption(parseInt(value, 10));
    if (el.mode.value !== value) el.mode.value = value;
    el.mode.disabled = state.status !== 'idle';
  }
  /* Hinweise nach Beach-Regeln: Satzgewinn vor Seitenwechsel. */
  function renderNotice() {
    var winner = TM.setWinner(state);
    el.setWonTitle.textContent = winner
      ? tx('timer.notice.setWon', 'Satzgewinn {name} – Satz beenden', { name: sideName(winner) }) : '';
    el.endSet.classList.toggle('is-ready', !!winner);
  }
  /* Seitenwechsel-Rhythmus: Einstellung und Popup teilen sich denselben Wert. */
  function renderSwitchSelects() {
    var values = [TM.SWITCH_AUTO].concat(TM.SWITCH_OPTIONS, [TM.SWITCH_OFF]);
    var auto = TM.switchEvery(TM.setTarget(state));
    el.switchSelects.forEach(function (sel) {
      if (sel.options.length !== values.length) {
        sel.innerHTML = '';
        values.forEach(function (v) {
          var opt = doc.createElement('option');
          opt.value = String(v);
          sel.appendChild(opt);
        });
      }
      values.forEach(function (v, i) {
        sel.options[i].textContent = v === TM.SWITCH_AUTO
          ? tx('timer.switch.auto', 'Automatisch (alle {n})', { n: auto })
          : v === TM.SWITCH_OFF ? tx('timer.switch.off', 'Aus')
            : tx('timer.switch.every', 'Alle {n} Punkte', { n: v });
      });
      if (sel.value !== String(state.switchPts)) sel.value = String(state.switchPts);
    });
  }
  function onSwitchPts(e) {
    commit(TM.setSwitchPts(state, parseInt(e.target.value, 10)));
    var every = TM.switchInterval(state);
    announce(every
      ? tx('timer.switch.every', 'Alle {n} Punkte', { n: every })
      : tx('timer.switch.off', 'Aus'));
  }

  /* ------------------------------------------------------------- Popups
     Eigenes Overlay statt <dialog> (erst ab Safari 15.4): Hintergrund per
     aria-hidden ausblenden, Fokus im Popup halten und danach zurückgeben. */
  var modal = null;
  function focusables(box) {
    var list = box.querySelectorAll('button, select, input, [href]');
    var out = [];
    for (var i = 0; i < list.length; i++) if (!list[i].disabled && list[i].offsetParent !== null) out.push(list[i]);
    return out;
  }
  function setBackgroundHidden(hidden) {
    [el.bar, el.root].forEach(function (node) {
      if (!node) return;
      if (hidden) node.setAttribute('aria-hidden', 'true'); else node.removeAttribute('aria-hidden');
    });
  }
  function openModal(box, focusEl, onClose) {
    if (modal && modal.box !== box) closeModal(false);
    if (!modal) modal = { box: box, back: doc.activeElement };
    modal.onClose = onClose;
    box.hidden = false;
    doc.documentElement.classList.add('mt-modal-open');
    setBackgroundHidden(true);
    try { focusEl.focus(); } catch (e) { /* ohne Fokus */ }
  }
  function closeModal(restore) {
    if (!modal) return;
    var m = modal;
    modal = null;
    m.box.hidden = true;
    doc.documentElement.classList.remove('mt-modal-open');
    setBackgroundHidden(false);
    if (restore === false) return;
    var target = restore && restore.focus ? restore : m.back;
    if (!target || !target.focus || target.disabled || target.offsetParent === null) target = el.primary;
    try { target.focus(); } catch (e) { /* ohne Fokus */ }
  }
  function onModalKey(e) {
    if (!modal) return;
    if (e.key === 'Escape' || e.key === 'Esc') {
      e.preventDefault();
      modal.onClose();
      return;
    }
    if (e.key !== 'Tab') return;
    var items = focusables(modal.box);
    if (!items.length) return;
    var first = items[0], last = items[items.length - 1];
    var inside = modal.box.contains(doc.activeElement);
    if (e.shiftKey && (doc.activeElement === first || !inside)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (doc.activeElement === last || !inside)) { e.preventDefault(); first.focus(); }
  }
  function showSwitch() {
    el.switchScore.textContent = sideName('a') + ' ' + state.score.a + ' : ' + state.score.b + ' ' + sideName('b');
    openModal(el.switchModal, el.switchOk, function () { closeModal(true); });
  }
  function renderTransfer() {
    el.transfer.hidden = !(returnTarget && TM.resultFor(state));
  }
  /* Auswertung über das ganze Spiel: Name A · Sätze a : b · Name B. */
  function renderLead() {
    var sets = TM.leader(state.sets);
    /* Erst ab dem ersten beendeten Satz – im laufenden Satz zeigen Karte und
       Balken die Führung bereits. */
    el.lead.hidden = !state.setHistory.length;
    el.lead.className = 'mt-lead' + (sets.side ? ' is-' + sets.side : ' is-tie');
    ['a', 'b'].forEach(function (s) {
      el.matchName[s].textContent = sideName(s);
      el.matchSets[s].textContent = String(state.sets[s]);
    });
    /* Balken über den Punkten: Verhältnis im laufenden Satz. */
    var cur = TM.leader(state.score);
    var curTotal = state.score.a + state.score.b;
    el.curBar.className = 'mt-cur-bar' + (cur.side ? ' is-' + cur.side : ' is-tie');
    var ca = curTotal ? Math.round(state.score.a / curTotal * 1000) / 10 : 0;
    el.curSeg.a.style.width = ca + '%';
    el.curSeg.b.style.width = (curTotal ? 100 - ca : 0) + '%';
    ['a', 'b'].forEach(function (s) {
      el.card[s].classList.toggle('is-leading', cur.side === s);
    });
  }
  function renderSets() {
    var hist = state.setHistory;
    el.sets.textContent = '';
    if (!hist.length) {
      el.sets.hidden = true;
      return;
    }
    el.sets.hidden = false;
    /* Vorleser bekommen einen Satz, sichtbar sind kompakte Satz-Chips. */
    var sr = doc.createElement('span');
    sr.className = 'mt-vh';
    sr.textContent = tx('timer.sets', 'Sätze {a} : {b}', { a: state.sets.a, b: state.sets.b }) +
      ' (' + hist.map(function (p) { return p.a + ':' + p.b; }).join(', ') + ')';
    el.sets.appendChild(sr);
    hist.forEach(function (p, i) {
      var chip = doc.createElement('span');
      chip.className = 'mt-set-chip';
      chip.setAttribute('aria-hidden', 'true');
      var no = doc.createElement('span');
      no.className = 'mt-set-no';
      no.textContent = String(i + 1);
      chip.appendChild(no);
      ['a', 'b'].forEach(function (side, k) {
        if (k) chip.appendChild(doc.createTextNode(':'));
        var v = doc.createElement('span');
        v.textContent = String(p[side]);
        if (p[side] > p[side === 'a' ? 'b' : 'a']) v.className = 'mt-set-win';
        chip.appendChild(v);
      });
      el.sets.appendChild(chip);
    });
  }
  function syncTick() {
    if (state.status === 'running') {
      if (tickId == null) tickId = setInterval(renderTime, 250);
    } else if (tickId != null) {
      clearInterval(tickId);
      tickId = null;
    }
  }
  function wantsWake() {
    return (state.status === 'running' || !state.clockEnabled) && state.keepAwake && !doc.hidden && !pageUnloading;
  }
  function wakeMessage(key) {
    el.wakeStatus.textContent = key ? tx(key, key) : '';
    el.wakeStatus.hidden = !key;
  }
  function nativeWakePlugin() {
    if (wakePlugin) return wakePlugin;
    var cap = root.Capacitor;
    if (!cap || typeof cap.isNativePlatform !== 'function' || !cap.isNativePlatform() ||
        typeof cap.registerPlugin !== 'function') return null;
    try {
      wakePlugin = cap.registerPlugin('AppKeepAwake');
      return wakePlugin && typeof wakePlugin.setEnabled === 'function' ? wakePlugin : null;
    } catch (e) {
      return null;
    }
  }
  function syncWake(force) {
    var wanted = wantsWake();
    if (!force && wanted === wakeDesired) return;
    wakeDesired = wanted;
    if (!wanted) {
      wakeMessage(null);
      if (wakeLock) {
        var oldLock = wakeLock;
        wakeLock = null;
        oldLock.release().catch(function () {});
      }
      var inactivePlugin = nativeWakePlugin();
      if (inactivePlugin) {
        wakePluginQueue = wakePluginQueue.then(function () {
          if (!wakePluginEnabled) return;
          return inactivePlugin.setEnabled({ enabled: false }).then(function () {
            wakePluginEnabled = false;
          });
        }).catch(function () {
          wakePluginEnabled = false;
          wakeMessage('timer.keepAwakeError');
        });
      }
      return;
    }

    wakeMessage(null);
    var activePlugin = nativeWakePlugin();
    if (activePlugin) {
      wakePluginQueue = wakePluginQueue.then(function () {
        if (!wantsWake() || wakePluginEnabled) return;
        return activePlugin.setEnabled({ enabled: true }).then(function () {
          wakePluginEnabled = true;
          if (!wantsWake()) syncWake(true);
        });
      }).catch(function () {
        wakePluginEnabled = false;
        wakeMessage('timer.keepAwakeError');
      });
      return;
    }

    var api = root.navigator && root.navigator.wakeLock;
    if (!api || typeof api.request !== 'function') {
      wakeMessage('timer.keepAwakeUnsupported');
      return;
    }
    if (wakeLock) return;
    api.request('screen').then(function (lock) {
      if (!wantsWake()) {
        return lock.release();
      }
      wakeLock = lock;
      if (typeof lock.addEventListener === 'function') {
        lock.addEventListener('release', function () {
          if (wakeLock === lock) {
            wakeLock = null;
            if (wantsWake()) syncWake(true);
          }
        });
      }
      wakeMessage(null);
    }, function () {
      wakeMessage('timer.keepAwakeError');
    });
  }
  function isAutoCompact() {
    try { return !!(root.matchMedia && root.matchMedia('(max-width: 300px)').matches); }
    catch (e) { return false; }
  }
  function render() {
    el.clock.hidden = !state.clockEnabled;
    el.clockOpen.hidden = state.clockEnabled;
    el.root.classList.toggle('is-points-only', !state.clockEnabled);
    renderTime();
    el.root.setAttribute('data-status', state.status);
    el.status.textContent = statusText();
    renderMode();
    renderSets();
    renderLead();
    renderNotice();
    renderTransfer();
    renderSwitchSelects();
    el.hint.hidden = !returnTarget || !!state.match;
    el.undo.disabled = !TM.canUndo(state);
    el.endSet.disabled = !TM.canEndSet(state);
    el.undo.title = tx('timer.undoAria', 'Letzte Spielstandsänderung rückgängig machen');
    el.endSet.title = tx('timer.endSetAria', 'Satz beenden: geht an die Seite mit mehr Punkten, Punkte starten wieder bei 0');

    var action = TM.primaryAction(state);
    var p = PRIMARY[action];
    el.primaryLabel.textContent = p.text();
    el.primary.setAttribute('data-action', action);
    var stopped = state.status === 'stopped';
    el.stop.disabled = !TM.canStop(state) && !stopped;
    el.stop.setAttribute('data-action', stopped ? 'resume' : 'stop');
    el.stopLabel.textContent = stopped ? tx('timer.continue', 'Weiter') : tx('timer.stop', 'Stopp');
    el.reset.disabled = !TM.hasProgress(state);
    if (el.reset.disabled) hideResetConfirm(false);

    ['a', 'b'].forEach(function (side) {
      var name = sideName(side);
      el.value[side].textContent = String(state.score[side]);
      el.short[side].textContent = name;
      if (doc.activeElement !== el.name[side]) el.name[side].value = state.names[side];
      if (doc.activeElement !== el.direct[side]) el.direct[side].value = String(state.score[side]);
      el.plus[side].setAttribute('aria-label', tx('timer.plusAria', '+1 für {name}', { name: name }));
      el.minus[side].setAttribute('aria-label', tx('timer.minusAria', '−1 Korrektur für {name}', { name: name }));
      el.minus[side].disabled = state.score[side] <= 0;
      el.plus[side].disabled = state.score[side] >= TM.MAX_SCORE;
      el.direct[side].setAttribute('aria-label', tx('timer.directAria', 'Spielstand {name} direkt eingeben', { name: name }));
    });

    el.sound.setAttribute('aria-pressed', state.sound ? 'true' : 'false');
    el.keepAwake.setAttribute('aria-pressed', state.keepAwake ? 'true' : 'false');
    var auto = isAutoCompact();
    el.wakeHint.hidden = !state.keepAwake;
    el.wakeHint.textContent = state.clockEnabled
      ? tx('timer.keepAwakeHint', 'Display bleibt an, solange die Zeit läuft (braucht mehr Akku).')
      : tx('timer.keepAwakePointsHint', 'Display bleibt beim Punktezählen an (braucht mehr Akku).');
    el.compactLabel.textContent = state.compact ? tx('timer.normal', 'Normal') : tx('timer.compact', 'Kompakt');
    el.compact.setAttribute('aria-label', state.compact
      ? tx('timer.normalAria', 'Zur Normalansicht wechseln')
      : tx('timer.compactAria', 'Zur Kompaktansicht wechseln'));
    el.compact.hidden = auto;
    el.root.classList.toggle('is-compact', !!state.compact || auto);
    syncTick();
    syncWake(false);
  }

  /* ------------------------------------------------------------ Aktionen */
  function onPrimary() {
    var action = TM.primaryAction(state);
    var t = now();
    if (action === 'start' && commit(TM.start(state, t))) announce(tx('timer.announce.started', 'Timer gestartet'));
    else if (action === 'pause' && commit(TM.pause(state, t))) {
      announce(tx('timer.announce.paused', 'Timer pausiert bei {time}', { time: TM.formatElapsed(TM.elapsed(state, t)) }));
    } else if (action === 'resume' && commit(TM.resume(state, t))) announce(tx('timer.announce.resumed', 'Timer läuft weiter'));
    else if (action === 'clear' && commit(TM.resetTime(state))) {
      announce(tx('timer.announce.resetTime', 'Uhr zurückgesetzt, Spielstand bleibt'));
    }
  }
  function onStop() {
    var t = now();
    if (state.status === 'stopped') {
      if (commit(TM.resume(state, t))) announce(tx('timer.announce.resumed', 'Timer läuft weiter'));
      return;
    }
    if (commit(TM.stop(state, t))) {
      announce(tx('timer.announce.stopped', 'Timer gestoppt bei {time}', { time: TM.formatElapsed(TM.elapsed(state, t)) }));
    }
  }
  function changeScore(side, next, freq) {
    showError('');
    var wasWon = TM.setWinner(state);
    var wasSwitch = TM.isSideSwitch(state);
    if (!commit(next)) return;
    flash(side);
    var winner = TM.setWinner(state);
    if (winner && !wasWon) {
      beep(660, 0, 0.18);
      beep(990, 0.2, 0.3);
      haptic('notice');
      announce(scoreSentence() + '. ' + tx('timer.announce.setWon', 'Satzgewinn für {name}', { name: sideName(winner) }));
      openModal(el.setWonModal, el.setWonEnd, function () { closeModal(true); });
    } else if (freq === 880 && TM.isSideSwitch(state) && !wasSwitch) {
      beep(freq);
      beep(freq, 0.18);
      haptic('notice');
      announce(tx('timer.announce.switch', 'Seitenwechsel bei {a} : {b}', { a: state.score.a, b: state.score.b }));
      showSwitch();
    } else {
      beep(freq);
      haptic('light');
      announce(scoreSentence());
    }
  }
  /* Ergebnis an den Turnierbogen übergeben: spielplan-enh.js trägt es beim
     Öffnen des Bogens in genau dieses Spiel ein (nur einmal, 30 Minuten). */
  function onTransfer() {
    var sets = TM.resultFor(state);
    if (!sets || !returnTarget) return;
    var payload = JSON.stringify({
      v: 1, from: returnTarget, ref: state.match.ref, ts: now(),
      sets: sets.map(function (p) { return [p.a, p.b]; })
    });
    var ok = false;
    try {
      var st = storage();
      if (st) { st.setItem(RESULT_KEY, payload); ok = st.getItem(RESULT_KEY) === payload; }
    } catch (e) { ok = false; }
    if (!ok) {
      var msg = tx('timer.transferFail', 'Das Ergebnis konnte nicht gespeichert werden (Speicher nicht verfügbar).');
      showError(msg);
      announce(msg);
      return;
    }
    root.location.href = returnTarget;
  }
  function onUndo() {
    showError('');
    if (!commit(TM.undo(state))) return;
    beep(440);
    haptic('light');
    announce(tx('timer.announce.undo', 'Rückgängig. {score}', { score: scoreSentence() }));
  }
  function onSwap() {
    showError('');
    if (!commit(TM.swapSides(state))) return;
    announce(tx('timer.announce.swap', 'Seiten getauscht. {score}', { score: scoreSentence() }));
  }
  function onEndSet() {
    showError('');
    var before = state.score;
    var winner = before.a > before.b ? 'a' : 'b';
    var name = sideName(winner);
    if (!commit(TM.endSet(state))) return;
    flash(winner);
    beep(660, 0, 0.18);
    beep(880, 0.2, 0.25);
    haptic('light');
    announce(tx('timer.announce.endSet', 'Satz an {name} ({a} : {b}). Sätze {sa} : {sb}',
      { name: name, a: before.a, b: before.b, sa: state.sets.a, sb: state.sets.b }));
  }
  function onMode() {
    var min = parseInt(el.mode.value, 10);
    if (commit(TM.setCountdown(state, isFinite(min) ? min * 60000 : 0))) {
      announce(tx('timer.announce.mode', 'Modus: {mode}', { mode: modeText(state.countdownMs) }));
    } else {
      renderMode();
    }
  }

  /* --------------------------------------------- Namen aus dem Turnierbogen */
  function readPrefill() {
    var params;
    try { params = new URLSearchParams(root.location.search); } catch (e) { return null; }
    var names = TM.prefillNames(params.get('a'), params.get('b'));
    var ref = params.get('m');
    var targets = String(params.get('t') || '').split(',').filter(function (x) { return x !== ''; });
    if (names) names.match = ref && targets.length ? { ref: ref, targets: targets } : null;
    if (params.has('a') || params.has('b') || params.has('m') || params.has('t')) {
      /* Nur einmal anwenden: Neuladen fragt nicht erneut. */
      params.delete('a');
      params.delete('b');
      params.delete('m');
      params.delete('t');
      try {
        var q = params.toString();
        root.history.replaceState(root.history.state, '', root.location.pathname + (q ? '?' + q : '') + root.location.hash);
      } catch (e) { /* Adresse bleibt */ }
    }
    return names;
  }
  function withMatch(s, names) {
    return names.match ? TM.setMatch(s, names.match.ref, names.match.targets) : TM.setMatch(s, null, null);
  }
  function applyPrefill(names) {
    if (!names) return;
    /* Dasselbe Spiel erneut geöffnet: Stand (auch nach Seitentausch) behalten. */
    if (names.match && state.match && names.match.ref === state.match.ref) return;
    if (names.a === state.names.a && names.b === state.names.b) {
      if (!state.match && names.match) commit(withMatch(state, names));
      return;
    }
    var label = function (side) { return names[side] || (side === 'a' ? tx('timer.sideA', 'Seite A') : tx('timer.sideB', 'Seite B')); };
    if (!TM.hasProgress(state)) {
      commit(withMatch(TM.setNames(state, names.a, names.b), names));
      announce(tx('timer.announce.prefill', 'Namen übernommen: {a} gegen {b}', { a: label('a'), b: label('b') }));
      return;
    }
    pendingPrefill = names;
    el.prefillQuestion.textContent = tx('timer.prefillQuestion',
      'Neues Spiel aus dem Turnierbogen: {a} gegen {b}. Das laufende Spiel ({score}) wird dabei zurückgesetzt.',
      { a: label('a'), b: label('b'), score: sideName('a') + ' ' + state.score.a + ' : ' + state.score.b + ' ' + sideName('b') });
    openModal(el.prefill, el.prefillNo, function () { closePrefill(false); });
  }
  function closePrefill(accept) {
    var names = pendingPrefill;
    pendingPrefill = null;
    closeModal(el.primary);
    if (accept && names) {
      commit(withMatch(TM.setNames(TM.reset(state), names.a, names.b), names));
      announce(tx('timer.announce.prefill', 'Namen übernommen: {a} gegen {b}', { a: sideName('a'), b: sideName('b') }));
    }
  }
  function commitDirect(side) {
    var input = el.direct[side];
    var value = TM.parseScore(input.value);
    if (value == null) {
      input.value = String(state.score[side]);
      input.setAttribute('aria-invalid', 'true');
      var msg = tx('timer.invalidScore', 'Bitte eine ganze Zahl von 0 bis 999 eingeben. Der Spielstand bleibt unverändert.');
      showError(msg);
      announce(msg);
      return;
    }
    input.removeAttribute('aria-invalid');
    input.value = String(value);
    changeScore(side, TM.setScore(state, side, value), 440);
  }

  function showResetConfirm() {
    if (el.reset.disabled) return;
    el.resetConfirm.hidden = false;
    el.reset.setAttribute('aria-expanded', 'true');
    el.resetNo.focus();
  }
  function hideResetConfirm(focusReset) {
    if (el.resetConfirm.hidden) return;
    el.resetConfirm.hidden = true;
    el.reset.setAttribute('aria-expanded', 'false');
    if (focusReset && !el.reset.disabled) el.reset.focus();
  }
  function onResetConfirmed() {
    el.resetConfirm.hidden = true;
    el.reset.setAttribute('aria-expanded', 'false');
    showError('');
    if (commit(TM.reset(state))) announce(tx('timer.announce.reset', 'Zeit, Spielstand und Sätze zurückgesetzt'));
    el.primary.focus();
  }

  /* ------------------------------------------------------------ Rückweg */
  function wireBack() {
    var target = null;
    try { target = TM.returnTarget(new URLSearchParams(root.location.search).get('from')); }
    catch (e) { target = null; }
    if (!target) return;
    returnTarget = target;
    el.back.setAttribute('href', target);
    el.backLabel.textContent = tx('timer.back.sheet', 'Turnierbogen');
    el.back.setAttribute('aria-label', tx('timer.back.sheetAria', 'Zurück zum Turnierbogen'));
    el.back.addEventListener('click', function (e) {
      /* Kam der Aufruf direkt von diesem Bogen, im Verlauf zurückgehen
         (Scrollposition bleibt, kein zusätzlicher Verlaufseintrag). */
      var ref = '';
      try { ref = doc.referrer ? new URL(doc.referrer).href.split('#')[0] : ''; } catch (err) { ref = ''; }
      var dest = new URL(target, root.location.href).href;
      if (ref && ref === dest && root.history.length > 1) {
        e.preventDefault();
        root.history.back();
      }
    });
  }

  /* -------------------------------------------------------- Initialisierung */
  function mount() {
    el.root = byId('match-timer');
    if (!el.root) return;
    el.clock = byId('mt-clock');
    el.clockOpen = byId('mt-clock-open');
    el.clockClose = byId('mt-clock-close');
    el.warning = byId('mt-storage-warning');
    el.status = byId('mt-status');
    el.time = byId('mt-time');
    el.primary = byId('mt-primary');
    el.primaryLabel = byId('mt-primary-label');
    el.stop = byId('mt-stop');
    el.stopLabel = byId('mt-stop-label');
    el.sound = byId('mt-sound');
    el.keepAwake = byId('mt-keep-awake');
    el.wakeStatus = byId('mt-wake-status');
    el.wakeHint = byId('mt-wake-hint');
    el.compactLabel = byId('mt-compact-label');
    el.compact = byId('mt-compact');
    el.reset = byId('mt-reset');
    el.resetConfirm = byId('mt-reset-confirm');
    el.resetYes = byId('mt-reset-yes');
    el.resetNo = byId('mt-reset-no');
    el.announce = byId('mt-announce');
    el.error = byId('mt-error');
    el.back = byId('mt-back');
    el.mode = byId('mt-mode');
    el.sets = byId('mt-sets');
    el.lead = byId('mt-lead');
    el.matchName = { a: byId('mt-match-name-a'), b: byId('mt-match-name-b') };
    el.matchSets = { a: byId('mt-match-a'), b: byId('mt-match-b') };
    el.curBar = byId('mt-cur-bar');
    el.curSeg = { a: byId('mt-cur-a'), b: byId('mt-cur-b') };
    el.card = {
      a: doc.querySelector('.mt-side[data-side="a"]'),
      b: doc.querySelector('.mt-side[data-side="b"]')
    };
    el.hint = byId('mt-hint');
    el.setWonModal = byId('mt-set-won');
    el.setWonTitle = byId('mt-set-won-title');
    el.setWonEnd = byId('mt-set-won-end');
    el.setWonContinue = byId('mt-set-won-continue');
    el.transfer = byId('mt-transfer');
    el.undo = byId('mt-undo');
    el.swap = byId('mt-swap');
    el.endSet = byId('mt-end-set');
    el.prefill = byId('mt-prefill');
    el.prefillQuestion = byId('mt-prefill-question');
    el.prefillYes = byId('mt-prefill-yes');
    el.prefillNo = byId('mt-prefill-no');
    el.bar = doc.querySelector('.mt-bar');
    el.switchModal = byId('mt-switch');
    el.switchScore = byId('mt-switch-score');
    el.switchOk = byId('mt-switch-ok');
    el.switchSwap = byId('mt-switch-swap');
    el.switchSelects = [byId('mt-switch-pts'), byId('mt-switch-pts-modal')];
    el.backLabel = byId('mt-back-label');
    el.name = {}; el.value = {}; el.short = {}; el.plus = {}; el.minus = {}; el.direct = {};
    ['a', 'b'].forEach(function (side) {
      el.name[side] = byId('mt-name-' + side);
      el.value[side] = byId('mt-score-' + side);
      el.short[side] = byId('mt-short-' + side);
      el.plus[side] = byId('mt-plus-' + side);
      el.minus[side] = byId('mt-minus-' + side);
      el.direct[side] = byId('mt-direct-' + side);
    });

    var loaded = TM.load(storage());
    state = loaded.state;
    storageOk = loaded.readable;
    el.warning.hidden = storageOk;
    COUNTDOWN_MINUTES.forEach(addModeOption);
    /* Bereits vor dem Öffnen abgelaufen: nicht erneut melden. */
    expiredSignaled = TM.isExpired(state, now());

    el.primary.addEventListener('click', onPrimary);
    el.clockClose.addEventListener('click', function () {
      commit(TM.setClockEnabled(state, false, now()));
      el.clockOpen.focus();
    });
    el.clockOpen.addEventListener('click', function () {
      commit(TM.setClockEnabled(state, true, now()));
      el.clockClose.focus();
    });
    el.mode.addEventListener('change', onMode);
    el.undo.addEventListener('click', onUndo);
    el.swap.addEventListener('click', onSwap);
    el.endSet.addEventListener('click', onEndSet);
    el.transfer.addEventListener('click', onTransfer);
    el.prefillYes.addEventListener('click', function () { closePrefill(true); });
    el.prefillNo.addEventListener('click', function () { closePrefill(false); });
    doc.addEventListener('keydown', onModalKey);
    [el.prefill, el.switchModal, el.setWonModal].forEach(function (box) {
      box.addEventListener('click', function (e) {
        if (e.target === box && modal && modal.box === box) modal.onClose();
      });
    });
    el.switchOk.addEventListener('click', function () { closeModal(true); });
    el.setWonContinue.addEventListener('click', function () { closeModal(true); });
    el.setWonEnd.addEventListener('click', function () {
      closeModal(el.primary);
      onEndSet();
    });
    el.switchSwap.addEventListener('click', function () {
      closeModal(el.primary);
      onSwap();
    });
    el.switchSelects.forEach(function (sel) { sel.addEventListener('change', onSwitchPts); });
    el.stop.addEventListener('click', onStop);
    ['a', 'b'].forEach(function (side) {
      el.plus[side].addEventListener('click', function () { changeScore(side, TM.addPoint(state, side, 1), 880); });
      el.minus[side].addEventListener('click', function () { changeScore(side, TM.addPoint(state, side, -1), 440); });
      el.direct[side].addEventListener('change', function () { commitDirect(side); });
      el.direct[side].addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); commitDirect(side); }
      });
      el.direct[side].addEventListener('blur', function () {
        if (TM.parseScore(el.direct[side].value) === state.score[side]) el.direct[side].removeAttribute('aria-invalid');
      });
      el.name[side].addEventListener('input', function () {
        state = TM.setName(state, side, el.name[side].value);
        persist();
        render();
      });
      el.name[side].addEventListener('change', function () { el.name[side].value = state.names[side]; });
    });
    el.sound.addEventListener('click', function () {
      commit(TM.setSound(state, !state.sound));
      /* Bestätigungston im Klick: schaltet zugleich die Audio-Wiedergabe frei (iOS). */
      if (state.sound) beep(660);
      announce(state.sound ? tx('timer.announce.soundOn', 'Ton an') : tx('timer.announce.soundOff', 'Ton aus'));
    });
    el.keepAwake.addEventListener('click', function () {
      var enabled = !state.keepAwake;
      commit(TM.setKeepAwake(state, enabled));
      announce(enabled
        ? el.wakeHint.textContent
        : tx('timer.announce.keepAwakeOff', 'Bildschirm darf sich wieder abschalten'));
    });
    el.compact.addEventListener('click', function () { commit(TM.setCompact(state, !state.compact)); });
    el.reset.addEventListener('click', function () {
      if (el.resetConfirm.hidden) showResetConfirm(); else hideResetConfirm(true);
    });
    el.resetYes.addEventListener('click', onResetConfirmed);
    el.resetNo.addEventListener('click', function () { hideResetConfirm(true); });
    el.resetConfirm.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' || e.key === 'Esc') { e.preventDefault(); hideResetConfirm(true); }
    });

    /* Zurück aus dem Hintergrund / bfcache: sofort aus den Zeitpunkten neu zeichnen. */
    doc.addEventListener('visibilitychange', function () {
      if (!doc.hidden) renderTime();
      syncWake(true);
    });
    root.addEventListener('pageshow', function () {
      pageUnloading = false;
      renderTime();
      syncWake(true);
    });
    root.addEventListener('pagehide', function () {
      pageUnloading = true;
      syncWake(true);
    });
    root.addEventListener('beachl:native-pause', function () {
      pageUnloading = true;
      syncWake(true);
    });
    root.addEventListener('beachl:native-resume', function () {
      pageUnloading = false;
      renderTime();
      syncWake(true);
    });
    root.addEventListener('focus', function () { renderTime(); });
    root.addEventListener('storage', function (e) {
      if (e.key !== TM.STORAGE_KEY) return;
      state = TM.parse(e.newValue) || TM.create();
      expiredSignaled = TM.isExpired(state, now());
      render();
    });
    if (root.matchMedia) {
      try {
        var mq = root.matchMedia('(max-width: 300px)');
        if (typeof mq.addListener === 'function') mq.addListener(render);
      } catch (e) { /* ohne automatische Kompaktansicht */ }
    }

    wireBack();
    render();
    applyPrefill(readPrefill());
    el.root.setAttribute('data-ready', 'true');
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', mount);
  else mount();
})(typeof window !== 'undefined' ? window : this);
