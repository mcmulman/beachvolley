/* form-flow.js – Formularfeld-Workflow für die Turnierbögen.
   Reines Bildschirm-/Eingabeverhalten (Event-Listener + Tastatur-Hinweise) → KEIN
   Einfluss auf die Druckausgabe (der Druck rendert nur die Werte). Wird – wie
   appbar.js – in allen Bögen mit `defer` geladen. Nutzt Event-Delegation, damit
   auch dynamisch erzeugte Felder (Schweizer-Runden, Namensfelder) sofort greifen.

   Verbesserungen für schnelles, fehlerarmes Ausfüllen:
   • Ergebnis- und Namensfelder markieren beim Fokus ihren Inhalt → direktes
     Überschreiben per Tastatur wie per Tap (Touch & Desktop).
   • Mobile-Tastatur: enterKeyHint="next" + inputmode="numeric" für Ergebnisse,
     damit die Bildschirmtastatur eine „Weiter"-Aktion und den Ziffernblock zeigt.
   • Enter in Namensfeldern springt zum nächsten Namensfeld (Ergebnisfelder regeln
     die Bögen selbst – hier bewusst NICHT behandelt, um doppelte Sprünge zu vermeiden). */
(function () {
  'use strict';

  function isScore(el) {
    return !!(el && el.tagName === 'INPUT' && el.classList && el.classList.contains('score'));
  }
  function isName(el) {
    return !!(el && el.tagName === 'INPUT' && el.id && /^tn\d+$/.test(el.id));
  }
  function selectAll(el) {
    if (el && el.select) { try { el.select(); } catch (_) {} }
  }

  /* Fokus (v. a. Tab/Enter/Pfeiltasten): Feld vorbereiten + Inhalt markieren. */
  document.addEventListener('focusin', function (e) {
    var el = e.target;
    if (isScore(el)) {
      if (!el.getAttribute('inputmode')) el.setAttribute('inputmode', 'numeric');
      el.setAttribute('enterkeyhint', 'next');
    } else if (isName(el)) {
      el.setAttribute('enterkeyhint', 'next');
    } else {
      return;
    }
    selectAll(el);
  });

  /* Maus-Klick: den fokussierenden Klick markieren lassen, spätere Klicks aber
     normal den Cursor setzen (kein „Reselect-Kampf" mit dem mouseup). */
  document.addEventListener('mousedown', function (e) {
    var el = e.target;
    if ((isScore(el) || isName(el)) && document.activeElement !== el) {
      el._selectOnUp = true;
    }
  }, true);
  document.addEventListener('mouseup', function (e) {
    var el = e.target;
    if ((isScore(el) || isName(el)) && el._selectOnUp) {
      el._selectOnUp = false;
      e.preventDefault();
      selectAll(el);
    }
  }, true);

  /* Enter in Namensfeldern → nächstes sichtbares Namensfeld (letztes = Feld verlassen). */
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.keyCode !== 13) return;
    var el = e.target;
    if (!isName(el)) return;
    var list = Array.prototype.slice
      .call(document.querySelectorAll('input[id^="tn"]'))
      .filter(function (n) {
        return /^tn\d+$/.test(n.id) && !n.disabled && n.offsetParent !== null;
      });
    var idx = list.indexOf(el);
    if (idx < 0) return;
    e.preventDefault();
    if (idx < list.length - 1) {
      var n = list[idx + 1];
      n.focus();
      selectAll(n);
    } else {
      el.blur();
    }
  });
})();
