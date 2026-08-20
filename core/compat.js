/* ============================================================================
   compat.js – Feature-Detection fuer aeltere iPads (Safari < 14.1 / iOS < 14.5)

   Flexbox-"gap" wird von Safari erst ab 14.1 unterstuetzt. Eine reine
   CSS-Loesung (@supports not (gap: 1px)) reicht NICHT: Safari kennt die
   Eigenschaft "gap" seit Version 12 fuer CSS-Grid, meldet sie deshalb in
   @supports als unterstuetzt und ignoriert sie in Flex-Containern trotzdem.
   Betroffen sind genau die alten Geraete (iPad Air 1, iPad mini 2/3 enden bei
   iOS 12.5.7) – dort waeren ohne diese Erkennung saemtliche Leisten, Karten,
   Formularfelder und Satz-Kaestchen ohne jeden Abstand aneinandergeklebt.

   Ergebnis: <html class="no-flexgap"> – die Ersatzabstaende stehen in
   core/compat-flexgap.css. Muss synchron im <head> laufen (vor dem ersten
   Rendern), damit es kein sichtbares Umspringen gibt. Bewusst ES5.
   ========================================================================== */
(function () {
  'use strict';
  var doc = document;
  var root = doc.documentElement;

  function add(cls) {
    if ((' ' + root.className + ' ').indexOf(' ' + cls + ' ') < 0) {
      root.className += (root.className ? ' ' : '') + cls;
    }
  }

  var probe = doc.createElement('div');
  probe.style.cssText =
    'position:absolute;visibility:hidden;pointer-events:none;' +
    'display:flex;flex-direction:column;row-gap:1px;';
  probe.appendChild(doc.createElement('div'));
  probe.appendChild(doc.createElement('div'));
  root.appendChild(probe);
  var supported = probe.scrollHeight === 1;
  probe.parentNode.removeChild(probe);

  if (!supported) add('no-flexgap');
})();
