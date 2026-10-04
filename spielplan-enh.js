/* spielplan-enh.js · Bedienhilfen für ALLE Turnierbögen
   ----------------------------------------------------------------------------
   Diese Datei buendelt die Komfortfunktionen, die frueher nur im Bogen
   "Alle gegen Alle" inline vorhanden waren. Sie arbeitet ausschliesslich ueber
   Klassen/Attribute des Spielplan-Markups und ist damit unabhaengig davon, ob
   ein Bogen self-contained ist oder das core/-Modul nutzt.

   Enthalten:
   - offene Spiele im Ergebnisbereich hervorheben (td.bl-open)
   - Tooltip an ungueltigen Ergebnissen
   - "✓ gespeichert"-Hinweis nach abgeschlossener IndexedDB-Transaktion
   - Eingabe von "21:19" auf beide Kaestchen verteilen, ":" springt weiter
   - Pfeiltasten ↑/↓ zwischen den Ergebnisfeldern

   Alles davon gilt nur am Bildschirm – der Ausdruck bleibt unveraendert. */
(function () {
  if (window.__BL_ENH__) return;
  window.__BL_ENH__ = true;

  var INVALID_TITLE = 'Ungültiges Ergebnis: Zielpunktzahl nicht erreicht oder kein 2-Punkte-Vorsprung.';

  var css = ''
    + '#bl-toast{position:fixed;left:50%;bottom:22px;transform:translateX(-50%) translateY(16px);'
    + 'background:#0a7d2c;color:#fff;padding:8px 16px;border-radius:8px;font:600 13px system-ui,Arial,sans-serif;'
    + 'box-shadow:0 4px 14px rgba(0,0,0,.3);opacity:0;pointer-events:none;transition:opacity .2s,transform .2s;z-index:80}'
    + '#bl-toast.error{background:#a61b1b;max-width:min(90vw,620px);text-align:center;pointer-events:auto}'
    + '#bl-toast.warning{background:#8a4b08;max-width:min(90vw,620px);text-align:center;pointer-events:auto}'
    + '#bl-toast button{margin-left:10px;padding:5px 9px;border:1px solid currentColor;border-radius:5px;'
    + 'min-height:44px;background:#fff;color:#761010;font:inherit;cursor:pointer;pointer-events:auto}'
    + '#bl-toast.show{opacity:1;transform:translateX(-50%) translateY(0)}'
    + '@media screen{td.bl-open .psets{background:#f3e6e8;border-bottom:3px solid #925d68;'
    + 'border-radius:6px;padding:6px 4px}td.bl-done{opacity:1}}'
    + '@media print{#bl-toast{display:none!important}'
    + 'td.bl-open{box-shadow:none!important}td.bl-done{opacity:1!important}}';
  var st = document.createElement('style');
  st.textContent = css;
  document.head.appendChild(st);

  /* ---------------------------------------------------- Speicher-Feedback */
  var toast = document.createElement('div');
  toast.id = 'bl-toast';
  toast.textContent = '✓ gespeichert';
  var toastT = null, armed = false, undoSequence = 0, undoBusy = false;
  function showToast() {
    if (!toast.isConnected && document.body) document.body.appendChild(toast);
    while (toast.firstChild) toast.removeChild(toast.firstChild);
    toast.textContent = '✓ gespeichert';
    toast.classList.remove('error', 'warning');
    toast.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(function () { toast.classList.remove('show'); }, 1400);
  }
  function showUndoToast(sheetId) {
    var sequence = ++undoSequence;
    if (!window.TStore || !sheetId || typeof window.TStore.hasBackup !== 'function') {
      showToast();
      return;
    }
    window.TStore.hasBackup(sheetId).then(function (available) {
      if (sequence !== undoSequence) return;
      if (!available) { showToast(); return; }
      if (!toast.isConnected && document.body) document.body.appendChild(toast);
      while (toast.firstChild) toast.removeChild(toast.firstChild);
      toast.appendChild(document.createTextNode('✓ gespeichert'));
      var button = document.createElement('button');
      button.type = 'button';
      button.id = 'bl-undo-button';
      button.textContent = 'Rückgängig';
      button.setAttribute('aria-label', 'Letzten gespeicherten Stand wiederherstellen');
      button.addEventListener('click', function () {
        button.disabled = true;
        undoBusy = true;
        window.TStore.restorePrevious(sheetId).then(function (restored) {
          if (!restored) {
            undoBusy = false;
            showStorageNotice('Der letzte Stand konnte nicht wiederhergestellt werden. Bitte Daten sichern.', 'error');
            return;
          }
          while (toast.firstChild) toast.removeChild(toast.firstChild);
          toast.textContent = 'Voriger Stand wiederhergestellt. Seite wird neu geladen …';
          setTimeout(function () { window.location.reload(); }, 300);
        }, function () {
          undoBusy = false;
          showStorageNotice('Der letzte Stand konnte nicht wiederhergestellt werden. Bitte Daten sichern.', 'error');
        });
      });
      toast.appendChild(button);
      toast.classList.remove('error', 'warning');
      toast.classList.add('show');
      clearTimeout(toastT);
      toastT = setTimeout(function () {
        toast.classList.remove('show');
        while (toast.firstChild) toast.removeChild(toast.firstChild);
        toast.textContent = '✓ gespeichert';
      }, 10000);
    });
  }
  function showStorageNotice(message, kind, issue) {
    if (!toast.isConnected && document.body) document.body.appendChild(toast);
    while (toast.firstChild) toast.removeChild(toast.firstChild);
    toast.textContent = message;
    if (kind === 'error' && issue && (issue.code === 'corrupt' || issue.code === 'incompatible')
        && window.TStore) {
      var restore = document.createElement('button');
      restore.type = 'button';
      restore.textContent = 'Vorversion wiederherstellen';
      restore.disabled = true;
      window.TStore.hasBackup(issue.sheetId).then(function (available) {
        restore.disabled = !available;
        if (!available && restore.parentNode) restore.parentNode.removeChild(restore);
      });
      restore.addEventListener('click', async function () {
        if (!window.confirm('Die aktuelle Datei wird vorher separat aufbewahrt. Die letzte gültige Vorversion wird wiederhergestellt. Fortfahren?')) return;
        restore.disabled = true;
        if (await window.TStore.restorePrevious(issue.sheetId)) {
          toast.textContent = 'Vorversion wiederhergestellt. Seite wird neu geladen …';
          setTimeout(function () { window.location.reload(); }, 500);
        } else restore.disabled = false;
      });
      toast.appendChild(restore);
    }
    toast.classList.remove('error', 'warning');
    toast.classList.add(kind, 'show');
    clearTimeout(toastT);
    if (kind !== 'error') {
      toastT = setTimeout(function () {
        toast.classList.remove('show', kind);
        toast.textContent = '✓ gespeichert';
      }, 10000);
    }
  }
  var storageErrors = {
    unavailable: 'Speicher nicht verfügbar. Änderungen werden nicht gespeichert.',
    blocked: 'Turnierspeicher ist durch ein anderes Fenster blockiert. Andere BeachL-Tabs schließen und erneut versuchen.',
    corrupt: 'Gespeicherte Daten sind beschädigt. Sie wurden nicht überschrieben. Bitte diese Seite nicht schließen.',
    incompatible: 'Gespeicherte Daten sind nicht kompatibel. Sie wurden nicht überschrieben.',
    conflict: 'Ein anderer Tab hat neuere Daten gespeichert. Bitte neu laden; dieser Stand wurde nicht gespeichert.',
    'backup-failed': 'Sicherung fehlgeschlagen. Änderungen wurden vorsichtshalber nicht gespeichert.',
    'write-failed': 'Speichern fehlgeschlagen (möglicherweise ist der Gerätespeicher voll). Bitte Daten sichern.',
    'index-failed': 'Turnierübersicht konnte nicht gespeichert werden. Bitte Speicherplatz prüfen.',
    'backup-corrupt': 'Die Vorversion ist beschädigt. Eine Wiederherstellung ist nicht möglich.',
    'external-change': 'Dieses Turnier wurde in einem anderen Tab geändert. Vor weiteren Eingaben bitte neu laden.'
  };
  function handleStorageError(event) {
    var issue = event.detail || {};
    var pending = window.__BL_PENDING_STORAGE_ISSUES__ || [];
    var index = pending.indexOf(issue);
    if (index >= 0) pending.splice(index, 1);
    if (issue.code !== 'index-failed') {
      window.__BL_UNSAVED_SHEETS__ = window.__BL_UNSAVED_SHEETS__ || {};
      window.__BL_UNSAVED_SHEETS__[issue.sheetId || '_unknown'] = true;
    }
    showStorageNotice(storageErrors[issue.code] || 'Speicherfehler. Änderungen wurden nicht sicher gespeichert.', 'error', issue);
  }
  function handleStorageSaved(event) {
    var detail = event.detail || {};
    var unsaved = window.__BL_UNSAVED_SHEETS__ || {};
    delete unsaved[detail.sheetId || '_unknown'];
    delete unsaved._unknown;
    if (Object.keys(unsaved).length || (window.TStore && window.TStore.isPending())) return;
    window.__BL_UNSAVED_SHEETS__ = {};
    if (undoBusy) return;
    clearTimeout(toastT);
    toast.classList.remove('show', 'error', 'warning');
    if (armed && typeof detail.revision === 'number' && detail.sheetId) showUndoToast(detail.sheetId);
    else if (armed) showToast();
  }
  window.addEventListener('beachl:storage-error', handleStorageError);
  window.addEventListener('beachl:storage-saved', handleStorageSaved);
  window.addEventListener('beachl:storage-external-change', function () {
    showStorageNotice(storageErrors['external-change'], 'warning');
  });
  var pendingStorageIssues = window.__BL_PENDING_STORAGE_ISSUES__ || [];
  delete window.__BL_PENDING_STORAGE_ISSUES__;
  if (pendingStorageIssues.length) {
    handleStorageError({ detail: pendingStorageIssues[pendingStorageIssues.length - 1] });
  }
  window.addEventListener('beforeunload', function (event) {
    if (!Object.keys(window.__BL_UNSAVED_SHEETS__ || {}).length
        && !(window.TStore && window.TStore.isPending())) return;
    event.preventDefault();
    event.returnValue = '';
  });

  /* ------------------------------------------- Partnerfeld eines Kaestchens
     Neue Boegen adressieren ueber data-mid/data-set/data-side, die aelteren
     ueber IDs (g/g2/g3 bzw. sA/sB). Beide Wege werden unterstuetzt.        */
  function scorePartner(inp) {
    var mid = inp.getAttribute && inp.getAttribute('data-mid');
    if (mid) {
      var side = inp.getAttribute('data-side') === 'a' ? 'b' : 'a';
      var set = inp.getAttribute('data-set');
      return document.querySelector('input.score[data-mid="' + mid + '"][data-set="'
        + set + '"][data-side="' + side + '"]');
    }
    var id = inp.id || '', m;
    if (inp.dataset && inp.dataset.op != null && (m = /^(g[23]?)(\d+)_(\d+)$/.exec(id))) {
      return document.getElementById(m[1] + m[2] + '_' + inp.dataset.op);
    }
    if ((m = /^(s[23]?)(A|B)_(\d+)_(\d+)$/.exec(id))) {
      return document.getElementById(m[1] + (m[2] === 'A' ? 'B' : 'A') + '_' + m[3] + '_' + m[4]);
    }
    return null;
  }

  /* "21:19" (auch eingefuegt) auf beide Kaestchen verteilen. */
  function sanitizeScore(inp) {
    var v = inp.value == null ? '' : String(inp.value);
    var pair = /^\s*(\d{1,3})\s*[:\-\/]\s*(\d{1,3})\s*$/.exec(v);
    if (pair) {
      inp.value = pair[1];
      var partner = scorePartner(inp);
      if (partner && !partner.disabled) {
        partner.value = pair[2];
        partner.dispatchEvent(new Event('input', { bubbles: true }));
        partner.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return;
    }
    var clean = v.replace(/\D+/g, '').slice(0, 3);
    if (clean !== v) inp.value = clean;
  }
  document.addEventListener('input', function (e) {
    var el = e.target;
    if (!el || !el.classList || !el.classList.contains('score')) return;
    /* Jede ECHTE Eingabe (auch Loeschen) hebt eine evtl. vorher automatisch
       gesetzte Gewinner-Zahl (siehe Autovervollstaendigung in den einzelnen
       Boegen bzw. wireScoreInputs()) wieder auf "manuell" - sonst haelt der
       naechste "Wert schon vorhanden"-Check faelschlich einen laengst
       ueberholten Auto-Wert fest und die Autovervollstaendigung wirkt danach
       "kaputt". Das Autofill selbst setzt dieses Attribut immer ERST NACH
       dem eigenen dispatchEvent('input', ...), wird also hier nie sofort
       wieder entfernt. */
    el.removeAttribute('data-bl-auto');
    sanitizeScore(el);
  }, true);

  /* The round-robin template keeps every round in the DOM while its round
     filter hides inactive rows. Enter must skip those hidden inputs and blur
     first so the change handler can complete a corrected score. */
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' || !e.target || !e.target.matches
        || !e.target.matches('input.score[data-rr-round]')) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    var currentId = e.target.id;
    e.target.blur();
    var visible = Array.prototype.slice.call(document.querySelectorAll('input.score[data-rr-round]:not(:disabled)'))
      .filter(function (inp) { return inp.getClientRects().length > 0; });
    var current = visible.findIndex(function (inp) { return inp.id === currentId; });
    if (current >= 0 && current + 1 < visible.length) {
      visible[current + 1].focus();
      if (visible[current + 1].select) visible[current + 1].select();
    }
  }, true);

  document.addEventListener('keydown', function (e) {
    if (e.key !== ':' && e.key !== '-' && e.key !== '/') return;
    var el = e.target;
    if (!el || !el.classList || !el.classList.contains('score') || el.disabled) return;
    var partner = scorePartner(el);
    if (!partner || partner.disabled) return;
    e.preventDefault();
    partner.focus();
    if (partner.select) partner.select();
  }, true);

  /* ------------------------------------------------------- OK-Knopf (iPad)
     Geraete ohne Tab-Taste (iPad) koennen ein Ergebnis nicht per Tab
     verlassen/bestaetigen. Ein kleiner OK-Knopf neben dem Kaestchenpaar
     (siehe *.setColumnHtml()/courtLadderHtml() - Klasse "sbox", Attribut
     [data-score-ok]) nimmt den Fokus und springt - wie sonst Enter/Tab -
     zum naechsten aktiven Ergebnisfeld. Gibt es keins mehr, wird nur der
     Fokus entfernt (blur), was das Auto-Ausfuellen (change-Event) ausloest.
     Funktioniert unabhaengig vom Attribut-Schema (data-mid/-side oder die
     aelteren IDs), weil rein auf DOM-Reihenfolge innerhalb "sbox" geschaut
     wird - so ist ein einziger Handler fuer alle Turnierbogen ausreichend.

     Validierung vor dem Sprung: Ist das Kaestchenpaar unvollstaendig (noch
     leer) oder bereits als ungueltig markiert (siehe markScores()/
     markScoreInputs() der jeweiligen Bogen - die setzen "invalid" bei jeder
     Eingabe live neu), springt der Knopf NICHT weiter, sondern markiert
     beide Kaestchen rot (gleiche Klasse/Optik wie eine echte Falscheingabe)
     und fokussiert das erste noch leere bzw. erste Kaestchen. Sobald wieder
     getippt wird, raeumt die Bogen-eigene Logik die Markierung ohnehin neu
     auf (sie entfernt "invalid" bei jeder Eingabe zuerst global).

     WICHTIG (Schweizer System / Rundenmodus mit Swiss-Runden): Wird ein
     Spiel durch DIESES Kaestchenpaar bereits entschieden (z.B. klares 2:0
     ohne Entscheidungssatz), aendert sich dadurch oft die Paarungs-Vorschau
     einer noch nicht gestarteten Folgerunde - der Bogen baut dann den
     KOMPLETTEN Spielplan neu auf (siehe rebuild()/buildStructure() in den
     jeweiligen Turnierboegen). Passiert dieser Neuaufbau waehrend eines
     nativen Fokuswechsels (Button "stiehlt" per mousedown den Fokus ->
     blur/change auf dem alten Feld -> Neuaufbau ersetzt das gesamte Markup
     INKLUSIVE des gerade angeklickten Knopfes), kommt der "click" auf dem
     inzwischen aus dem DOM entfernten Knopf gar nicht mehr an - der Sprung
     zum naechsten Feld unterbleibt komplett und alle Kaestchen bleiben
     gelb markiert. Deshalb: der Knopf nimmt (siehe "mousedown" unten) nie
     selbst den Fokus, und wir loesen die Auto-Vervollstaendigung/Validierung
     HIER kontrolliert per "change" aus - anschliessend werden Anchor/Liste
     ueber eine stabile Signatur (data-mid/-set/-side bzw. ID) NEU aus dem
     (ggf. frisch aufgebauten) DOM geholt, statt alte Knoten weiterzunutzen. */
  document.addEventListener('mousedown', function (e) {
    var btn = e.target && e.target.closest ? e.target.closest('[data-score-ok]') : null;
    if (btn) e.preventDefault();
  }, true);

  function scoreInputSig(inp) {
    var mid = inp.getAttribute('data-mid');
    if (mid) {
      return 'input.score[data-mid="' + mid + '"][data-set="' + inp.getAttribute('data-set')
        + '"][data-side="' + inp.getAttribute('data-side') + '"]';
    }
    return inp.id ? 'input.score#' + inp.id : null;
  }

  document.addEventListener('click', function (e) {
    var btn = e.target && e.target.closest ? e.target.closest('[data-score-ok]') : null;
    if (!btn) return;
    e.preventDefault();
    var box = btn.closest('.sbox');
    var boxInputs = box ? Array.prototype.slice.call(box.querySelectorAll('input.score')) : [];
    if (!boxInputs.length) return;
    var sigs = boxInputs.map(scoreInputSig);
    /* Autovervollstaendigung/Validierung ZUERST ausloesen (ersetzt das
       native "blur", das der Knopf per "mousedown" oben bewusst verhindert)
       - erst DANACH steht fest, ob das Kaestchenpaar wirklich vollstaendig
       ist (die Gegenseite kann durch genau dieses "change" gerade erst
       automatisch befuellt werden). */
    boxInputs.forEach(function (inp) { if (!inp.disabled) inp.dispatchEvent(new Event('change', { bubbles: true })); });
    /* Ab hier keine der oben gelesenen DOM-Referenzen mehr verwenden - das
       "change" kann (siehe Kommentar oben) bereits einen kompletten
       Neuaufbau ausgeloest haben. Alles Weitere ueber die Signaturen frisch
       aus dem (ggf. neuen) DOM holen. */
    var freshInputs = sigs.map(function (sig) { return sig ? document.querySelector(sig) : null; })
      .filter(function (inp) { return inp; });
    if (!freshInputs.length) return;
    var active = freshInputs.filter(function (inp) { return !inp.disabled; });
    if (!active.length) return;
    var empty = active.filter(function (inp) { return String(inp.value || '').trim() === ''; });
    var invalid = active.some(function (inp) { return inp.classList.contains('invalid'); });
    if (empty.length || invalid) {
      active.forEach(function (inp) { inp.classList.add('invalid'); });
      var focusTarget = empty[0] || active[0];
      focusTarget.focus();
      if (focusTarget.select) focusTarget.select();
      schedule();
      return;
    }
    var anchor = freshInputs[freshInputs.length - 1];
    var list = Array.prototype.slice.call(document.querySelectorAll('input.score:not([disabled])'));
    var idx = list.indexOf(anchor);
    var next = idx >= 0 ? list[idx + 1] : null;
    if (next) {
      next.focus();
      if (next.select) next.select();
    } else if (document.activeElement && document.activeElement.blur) {
      document.activeElement.blur();
    }
  }, true);

  /* ------------------------------------------------ Runde abschliessen (✓)
     Boegen ohne eigenen Runden-Knopf (Vorlagen, King/Queen) bekommen rechts
     im Rundenkopf denselben runden ✓-Knopf wie die Universal-Boegen. Er
     prueft alle Ergebnisse der Runde: fehlt eines oder ist eines ungueltig,
     wird es rot markiert und fokussiert - sonst geht es zur naechsten Runde. */
  var ROUND_HEAD_SEL = 'tr.rhead > td.rhead-cell, .kq-round-title, .kq-round-head';

  function injectRoundButtons() {
    document.querySelectorAll(ROUND_HEAD_SEL).forEach(function (head) {
      if (head.querySelector('.rconfirm')) return;
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'nbtn rconfirm bl-rdone noprint';
      btn.setAttribute('data-bl-round-done', '');
      btn.setAttribute('aria-label', 'Runde abschließen');
      btn.title = 'Runde abschließen';
      btn.textContent = '✓';
      head.appendChild(btn);
    });
  }

  function roundInputs(btn) {
    var tr = btn.closest('tr.rhead');
    var nodes = [];
    if (tr) {
      var r = tr.getAttribute('data-round');
      var slot = tr.getAttribute('data-slot');
      var sel = 'tr[data-round="' + r + '"]' + (slot != null ? '[data-slot="' + slot + '"]' : '');
      nodes = Array.prototype.slice.call(tr.parentNode.querySelectorAll(sel));
    } else {
      var box = btn.closest('.kq-round, [data-round-block], .round-block');
      if (box) nodes = [box];
    }
    var out = [];
    nodes.forEach(function (n) {
      Array.prototype.forEach.call(n.querySelectorAll('input.score'), function (inp) { out.push(inp); });
    });
    return out;
  }

  document.addEventListener('mousedown', function (e) {
    if (e.target && e.target.closest && e.target.closest('[data-bl-round-done]')) e.preventDefault();
  }, true);

  document.addEventListener('click', function (e) {
    var btn = e.target && e.target.closest ? e.target.closest('[data-bl-round-done]') : null;
    if (!btn) return;
    e.preventDefault();
    var ae = document.activeElement;
    if (ae && ae.classList && ae.classList.contains('score')) {
      ae.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (!btn.isConnected) return;
    var inputs = roundInputs(btn);
    var active = inputs.filter(function (inp) { return !inp.disabled; });
    if (!active.length) return;
    var bad = [];
    active.forEach(function (inp) {
      var partner = scorePartner(inp);
      var empty = String(inp.value || '').trim() === '';
      var pEmpty = partner && !partner.disabled ? String(partner.value || '').trim() === '' : empty;
      if (inp.classList.contains('invalid') || empty || pEmpty) bad.push(inp);
    });
    if (bad.length) {
      bad.forEach(function (inp) { inp.classList.add('invalid'); });
      var first = bad.filter(function (inp) { return String(inp.value || '').trim() === ''; })[0] || bad[0];
      first.focus();
      if (first.select) first.select();
      schedule();
      return;
    }
    var last = inputs[inputs.length - 1];
    var all = Array.prototype.slice.call(document.querySelectorAll('input.score:not([disabled])'));
    var next = all[all.indexOf(last) + 1] || null;
    var nextSig = next ? scoreInputSig(next) : null;
    if (next && !next.getClientRects().length) {
      var nav = Array.prototype.slice.call(document.querySelectorAll('.nbtn-round-next'))
        .filter(function (b) { return b.getClientRects().length && !b.disabled; })[0];
      if (nav) nav.click();
    }
    (window.requestAnimationFrame || setTimeout)(function () {
      var target = nextSig ? document.querySelector(nextSig) : null;
      if (target && target.getClientRects().length) {
        target.focus();
        if (target.select) target.select();
        if (target.scrollIntoView) target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      } else if (document.activeElement && document.activeElement.blur) {
        document.activeElement.blur();
      }
    });
  }, true);

  /* -------------------------------------- offene/erledigte Spiele markieren
     Bewusst rein am Markup entschieden: ein Spiel gilt als erledigt, wenn
     alle aktiven Kaestchen der Zelle gefuellt und keines ungueltig ist.    */
  function update() {
    injectRoundButtons();
    document.querySelectorAll('input.score').forEach(function (inp) {
      if (inp.classList.contains('invalid')) {
        if (inp.title !== INVALID_TITLE) inp.title = INVALID_TITLE;
      } else if (inp.title === INVALID_TITLE) {
        inp.removeAttribute('title');
      }
    });

    document.querySelectorAll('td.match').forEach(function (td) {
      td.classList.remove('bl-open', 'bl-done');
      var active = Array.prototype.slice.call(td.querySelectorAll('input.score'))
        .filter(function (inp) { return !inp.disabled; });
      if (!active.length) return;
      var filled = active.every(function (inp) { return String(inp.value || '').trim() !== ''; });
      var invalid = active.some(function (inp) { return inp.classList.contains('invalid'); });
      td.classList.add(filled && !invalid ? 'bl-done' : 'bl-open');
    });

    /* OK-Knopf (.score-ok, siehe unten): grün statt grau, sobald BEIDE
       Kaestchen des zugehoerigen Kaestchenpaars (.sbox) ausgefuellt UND
       gueltig sind - reine Bestaetigung/Weiterspringen bleibt grau, bis
       ein echtes Ergebnis feststeht. */
    document.querySelectorAll('.sbox').forEach(function (box) {
      var ins = Array.prototype.slice.call(box.querySelectorAll('input.score'))
        .filter(function (inp) { return !inp.disabled; });
      var filled = ins.length > 0 && ins.every(function (inp) { return String(inp.value || '').trim() !== ''; });
      var invalid = ins.some(function (inp) { return inp.classList.contains('invalid'); });
      box.classList.toggle('sbox-valid', filled && !invalid);
    });
  }

  var scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    (window.requestAnimationFrame || setTimeout)(function () {
      scheduled = false;
      try { update(); } catch (e) { /* Rendering laeuft noch */ }
    });
  }

  ['computeAll', 'rebuild', 'paintAll'].forEach(function (fn) {
    if (typeof window[fn] === 'function') {
      var orig = window[fn];
      window[fn] = function () { var r = orig.apply(this, arguments); schedule(); return r; };
    }
  });
  document.addEventListener('input', function () { armed = true; schedule(); }, true);
  document.addEventListener('click', function () { armed = true; }, true);
  document.addEventListener('change', schedule, true);

  /* Die dynamischen Boegen bauen den Spielplan bei jeder Aenderung neu auf –
     ohne Beobachter waeren die Markierungen danach weg. */
  function observe() {
    var host = document.getElementById('schedBody') || document.getElementById('sched') || document.body;
    if (!host || !window.MutationObserver) return;
    new MutationObserver(schedule).observe(host, { childList: true, subtree: true });
  }

  /* --------------------------------------------------------- Pfeiltasten */
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    var el = e.target;
    if (!el || !el.classList || !el.classList.contains('score')) return;
    var list = Array.prototype.slice.call(document.querySelectorAll('input.score:not([disabled])'));
    var idx = list.indexOf(el);
    if (idx < 0) return;
    var next = idx + (e.key === 'ArrowDown' ? 1 : -1);
    if (next >= 0 && next < list.length) {
      e.preventDefault();
      list[next].focus();
      if (list[next].select) list[next].select();
    }
  }, true);

  /* ------------------------------------------------- Kennzahlen-Übersicht
     Zweistufig: oben wenige große Kacheln mit den Key-Infos (Teams, Felder,
     Spiele pro Team, Ende, Zeitreserve), darunter eine ruhige Detailzeile.
     Die bestehenden Elemente (#rv-…) werden nur umsortiert, damit die
     bogeneigene Befüllung inkl. is-warn unverändert weiterarbeitet.       */
  var KPI_MAIN = [
    ['rv-teams', 'Teams'], ['rv-participants', 'Teilnehmer:innen'], ['rv-groups', 'Gruppen'],
    ['rv-fields', 'Felder'], ['rv-perTeam', 'Spiele pro Team'], ['rv-perPerson', 'Spiele pro Person'],
    ['rv-fitEnd', 'Ende ca.'], ['rv-buffer', 'Zeitreserve']
  ];
  var KPI_MORE = [
    ['rv-mode', 'Modus'], ['rv-rounds', 'Runden'], ['rv-size', 'Baumgröße'], ['rv-byes', 'Freilose Runde 1'],
    ['rv-games', 'Spiele'], ['rv-grpGames', 'Spiele Vorrunde'], ['rv-finGames', 'Spiele Finalrunde'],
    ['rv-subsets', 'Sätze'], ['rv-perGame', 'Zeit pro Spiel (verfügbar / nötig)'],
    ['rv-duration', 'Zeitfenster / Bedarf']
  ];
  function layoutKpis() {
    var box = document.querySelector('.cfgresult');
    if (!box || box.classList.contains('kpi2') || box.querySelectorAll('.cfgres-item').length < 7) return;
    var main = document.createElement('div'); main.className = 'kpi-main';
    var more = document.createElement('div'); more.className = 'kpi-more';
    function move(list, target) {
      list.forEach(function (d) {
        var el = document.getElementById(d[0]);
        var item = el && el.closest('.cfgres-item');
        if (!item || item.parentNode !== box) return;
        item.classList.remove('is-primary');
        item.setAttribute('data-kpi', d[0].slice(3));
        var lbl = item.querySelector('.cfgres-lbl');
        if (lbl) { lbl.setAttribute('title', lbl.textContent); lbl.textContent = d[1]; }
        if (target === more && lbl) item.insertBefore(lbl, item.firstChild);
        target.appendChild(item);
      });
    }
    move(KPI_MAIN, main);
    move(KPI_MORE, more);
    Array.prototype.slice.call(box.children).forEach(function (rest) {
      if (rest.classList && rest.classList.contains('cfgres-item')) main.appendChild(rest);
    });
    box.appendChild(main);
    if (more.children.length) box.appendChild(more);
    box.classList.add('kpi2');
  }

  function boot() { layoutKpis(); observe(); setTimeout(update, 80); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
  window.addEventListener('load', function () { setTimeout(update, 120); });
})();
