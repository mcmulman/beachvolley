/* spielplan-enh.js · Bedienhilfen für ALLE Turnierbögen
   ----------------------------------------------------------------------------
   Diese Datei buendelt die Komfortfunktionen, die frueher nur im Bogen
   "Alle gegen Alle" inline vorhanden waren. Sie arbeitet ausschliesslich ueber
   Klassen/Attribute des Spielplan-Markups und ist damit unabhaengig davon, ob
   ein Bogen self-contained ist oder das core/-Modul nutzt.

   Enthalten:
   - offene Spiele hervorheben (td.bl-open), erledigte zuruecknehmen (td.bl-done)
   - Tooltip an ungueltigen Ergebnissen
   - "✓ gespeichert"-Hinweis beim echten Schreiben in den localStorage
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
    + '#bl-toast.show{opacity:1;transform:translateX(-50%) translateY(0)}'
    + '@media screen{td.bl-open{box-shadow:inset 0 0 0 2px #f0a000}td.bl-done{opacity:.62}}'
    + '@media print{#bl-toast{display:none!important}'
    + 'td.bl-open{box-shadow:none!important}td.bl-done{opacity:1!important}}';
  var st = document.createElement('style');
  st.textContent = css;
  document.head.appendChild(st);

  /* ---------------------------------------------------- Speicher-Feedback */
  var toast = document.createElement('div');
  toast.id = 'bl-toast';
  toast.textContent = '✓ gespeichert';
  var toastT = null, saveT = null, armed = false;
  function showToast() {
    if (!toast.isConnected && document.body) document.body.appendChild(toast);
    toast.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(function () { toast.classList.remove('show'); }, 1400);
  }
  try {
    var SP = window.Storage && window.Storage.prototype;
    if (SP && !SP.__bl_wrapped) {
      var _set = SP.setItem;
      SP.__bl_wrapped = true;
      SP.setItem = function (k, v) {
        _set.call(this, k, v);
        if (armed) { clearTimeout(saveT); saveT = setTimeout(showToast, 450); }
      };
    }
  } catch (e) { /* privater Modus o. ae. – dann eben ohne Hinweis */ }

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

  /* -------------------------------------- offene/erledigte Spiele markieren
     Bewusst rein am Markup entschieden: ein Spiel gilt als erledigt, wenn
     alle aktiven Kaestchen der Zelle gefuellt und keines ungueltig ist.    */
  function update() {
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

  function boot() { observe(); setTimeout(update, 80); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
  window.addEventListener('load', function () { setTimeout(update, 120); });
})();
