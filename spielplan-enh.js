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
