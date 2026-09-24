/* ============================================================================
   turnier-resume-picker.js – Auswahl beim mehrdeutigen Öffnen eines Bogens

   Wird ein Turnierbogen OHNE ?id= geöffnet (Lesezeichen, von Hand eingegebene
   URL, alter Tab-Link) und liegen für diesen Bogentyp bereits ein oder
   mehrere gespeicherte Turniere vor, ist unklar, welches gemeint ist. Statt
   stillschweigend im (ggf. falschen) Standard-Slot zu landen, zeigt dieses
   Modul eine kurze Auswahl. Die Wahl führt per location.replace(...&id=…) zu
   genau der URL, die der Bogen ohnehin für "id vorhanden" kennt – der ganze
   restliche Lade-/Init-Code der Bögen bleibt unverändert.

   Zwei Quellen für "was existiert bereits":
   - maybePrompt(base, typeLabel)              → core/turnier-store.js-Bögen
     (JSON-Turnier je Schlüssel, Liste über TStore.index()).
   - maybePromptFromRegistry(opts)             → Alt-Bögen ohne TStore
     (mehrere Einzel-Keys je Turnier, Liste über die vorhandene
     "beachl_sessions"-Registry aus core/turnier-archive.js).
   Beide münden in denselben Overlay-Renderer und denselben ?id=-Mechanismus.

   BASE_ID ist der Sentinel-Wert für "der unverzweigte, alte Standard-Slot
   ohne Suffix" – so bleiben vor Einführung dieses Features gespeicherte
   Turniere über die Auswahl erreichbar, ohne dass Daten verloren gehen.
   ========================================================================== */
(function (root) {
  'use strict';

  const BASE_ID = '_base_';

  function fmtDate(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  /* Alle Index-Einträge, die zu diesem Bogen gehören: der unverzweigte
     "<base>"-Schlüssel selbst sowie alle "<base>.<id>"-Varianten.
     "base" ist normalerweise ein einzelner String. Manche Bögen (z. B.
     Turnierbogen_Flex_Turnier.html) speichern aber unter EINEM Start-
     seiten-Eintrag intern zwei Modi in getrennten Slots ("flex_rr" /
     "flex_swiss") - dafür akzeptiert "base" auch ein Array aus Strings
     oder { base, params } (params = zusätzliche ?…=-Parameter, die beim
     Fortsetzen dieses Eintrags mit in die URL sollen, z. B. { mode:'rr' },
     damit der Bogen nach dem Neuladen wieder im richtigen Modus lädt). */
  function normalizeBases(base) {
    return (Array.isArray(base) ? base : [base])
      .map(b => (typeof b === 'string') ? { base: b, params: null } : b);
  }
  function listFromStore(base) {
    const TStore = root.TStore;
    if (!TStore || typeof TStore.index !== 'function') return [];
    const idx = TStore.index() || {};
    const specs = normalizeBases(base);
    const out = [];
    Object.keys(idx).forEach(k => {
      const spec = specs.filter(s => k === s.base || k.indexOf(s.base + '.') === 0)[0];
      if (!spec) return;
      out.push({
        id: k === spec.base ? BASE_ID : k.slice(spec.base.length + 1),
        params: spec.params,
        title: idx[k].title || '',
        meta: [
          idx[k].teams ? idx[k].teams + ' Teams' : '',
          idx[k].filled ? idx[k].filled + ' Ergebnis' + (idx[k].filled === 1 ? '' : 'se') : '',
          fmtDate(idx[k].updated)
        ].filter(Boolean).join(' · '),
        updated: idx[k].updated ? new Date(idx[k].updated).getTime() : 0
      });
    });
    return out;
  }

  /* Dieselbe Aufgabe für die Alt-Bögen: liest die "beachl_sessions"-Liste,
     die registerSession() in diesen Dateien ohnehin schon pflegt, und
     filtert auf die zum aktuellen Bogen (sessionKeyBase) gehörenden Einträge. */
  function listFromRegistry(sessionKeyBase) {
    let registry;
    try { registry = JSON.parse(localStorage.getItem('beachl_sessions') || '[]'); }
    catch (e) { return []; }
    if (!Array.isArray(registry)) return [];
    return registry
      .filter(s => s && !s.archived && (s.key === sessionKeyBase || String(s.key || '').indexOf(sessionKeyBase + '.') === 0))
      .map(s => ({
        id: s.key === sessionKeyBase ? BASE_ID : s.key.slice(sessionKeyBase.length + 1),
        title: s.customTitle || s.title || '',
        meta: [
          Array.isArray(s.teams) ? s.teams.join(' · ') : '',
          fmtDate(s.savedAt)
        ].filter(Boolean).join(' · '),
        updated: s.savedAt || 0
      }));
  }

  function freshId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  /* Grobe Gesamtzahl aller gespeicherten Turniere über beide Speicher-
     quellen hinweg (TStore-Index + Alt-Registry) – nur für den Hinweistext
     "es gibt noch weitere" im Overlay, daher bewusst ungenau/ungefiltert
     gehalten (kein Aufwand für Archiv-Sonderfälle o. Ä.). */
  function countAllSaved() {
    let n = 0;
    try { n += Object.keys(JSON.parse(localStorage.getItem('beachl.index') || '{}') || {}).length; } catch (e) {}
    try {
      const reg = JSON.parse(localStorage.getItem('beachl_sessions') || '[]');
      if (Array.isArray(reg)) n += reg.filter(s => s && !s.archived).length;
    } catch (e) {}
    return n;
  }

  /* idOrEntry: entweder eine reine ID (Klick auf "Neues Turnier") oder ein
     Eintrag aus listFromStore() mit optionalem .params (siehe oben). */
  function gotoId(idOrEntry) {
    const isEntry = idOrEntry && typeof idOrEntry === 'object';
    const url = new URL(location.href);
    url.searchParams.set('id', isEntry ? idOrEntry.id : idOrEntry);
    if (isEntry && idOrEntry.params) {
      Object.keys(idOrEntry.params).forEach(k => url.searchParams.set(k, idOrEntry.params[k]));
    }
    location.replace(url.pathname + url.search + url.hash);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }


  let styleInjected = false;
  function injectStyle() {
    if (styleInjected) return;
    styleInjected = true;
    const css = '' +
      'html.trp-wait body>*:not(.trp-overlay){visibility:hidden}' +
      /* "inset" statt top/right/bottom/left erst ab Safari 14.1 – auf den
         alten iPads (iOS 12.5.7) bleibt der Overlay sonst winzig/falsch
         positioniert statt den ganzen Bildschirm abzudecken. */
      '.trp-overlay{position:fixed;top:0;right:0;bottom:0;left:0;z-index:99999;background:rgba(20,24,30,.55);' +
        'display:flex;align-items:center;justify-content:center;padding:20px;' +
        'font-family:inherit;visibility:visible}' +
      '.trp-box{background:#fff;border-radius:12px;max-width:420px;width:100%;' +
        'max-height:82vh;overflow:auto;padding:20px 22px;box-shadow:0 12px 40px rgba(0,0,0,.3)}' +
      '.trp-box h2{margin:0 0 6px;font-size:18px}' +
      '.trp-box p{margin:0 0 14px;font-size:13.5px;color:#444}' +
      '.trp-list{display:flex;flex-direction:column;gap:8px;margin-bottom:14px}' +
      '.trp-item{display:flex;flex-direction:column;align-items:flex-start;gap:2px;' +
        'width:100%;text-align:left;padding:10px 12px;border:1px solid #d7dbe0;' +
        'border-radius:8px;background:#f7f8fa;cursor:pointer;font:inherit}' +
      '.trp-item:hover{background:#eef3fb;border-color:#9db8dd}' +
      '.trp-title{font-weight:600;font-size:14px}' +
      '.trp-meta{font-size:12px;color:#666}' +
      '.trp-new{width:100%;padding:10px 12px;border:1px dashed #8aa;border-radius:8px;' +
        'background:#fff;cursor:pointer;font:inherit;font-weight:600;color:#256}' +
      '.trp-new:hover{background:#f0fbff}' +
      '.trp-home{display:block;margin-top:10px;text-align:center;font-size:12.5px;' +
        'color:#667;text-decoration:none}' +
      '.trp-home:hover{text-decoration:underline}';
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
  }

  /* Gemeinsamer Renderer: existing = [{id, title, meta, updated}], id ist
     entweder BASE_ID (alter, unverzweigter Slot) oder ein ?id=-Suffix.
     otherCount = wie viele weitere gespeicherte Turniere (anderer Typen)
     zusätzlich auf der Startseite liegen – 0, wenn keine bekannt sind. */
  function render(existing, typeLabel, otherCount) {
    injectStyle();
    document.documentElement.classList.add('trp-wait');

    const overlay = document.createElement('div');
    overlay.className = 'trp-overlay';
    overlay.innerHTML =
      '<div class="trp-box">' +
        '<h2>Welches Turnier?</h2>' +
        '<p>Für „' + esc(typeLabel || 'diesen Bogen') + '“ liegen bereits gespeicherte Turniere vor. ' +
        'Welches möchtest du weiterbearbeiten?</p>' +
        '<div class="trp-list"></div>' +
        '<button type="button" class="trp-new">＋ Neues Turnier starten</button>' +
        '<a href="index.html" class="trp-home">← Zur Startseite' +
          (otherCount > 0 ? (otherCount === 1 ? ' (dort 1 weiteres gespeichertes Turnier)' : ' (dort ' + otherCount + ' weitere gespeicherte Turniere)') : '') +
        '</a>' +
      '</div>';

    const list = overlay.querySelector('.trp-list');
    existing
      .slice()
      .sort((a, b) => b.updated - a.updated)
      .forEach(e => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'trp-item';
        row.innerHTML =
          '<span class="trp-title">' + esc(e.title || 'Turnier ohne Titel') + '</span>' +
          '<span class="trp-meta">' + esc(e.meta) + '</span>';
        row.addEventListener('click', function () { gotoId(e); });
        list.appendChild(row);
      });
    overlay.querySelector('.trp-new').addEventListener('click', function () { gotoId(freshId()); });

    document.body.appendChild(overlay);
  }

  function alreadyResolved() {
    const qp = new URLSearchParams(location.search);
    /* ?id= bereits eindeutig, ?restore= wird von turnier-archive.js selbst
       verarbeitet (Archiv-Wiederherstellung), #share=/#shareoffline= von
       turnier-share.js (Link-Import) – in allen drei Fällen keine
       Nachfrage, sonst würde die automatische Übernahme gestört. */
    const hash = String(location.hash || '');
    return !!(qp.get('id') || qp.get('restore') ||
      hash.indexOf('#share=') === 0 || hash.indexOf('#shareoffline=') === 0);
  }

  /* Für Bögen mit core/turnier-store.js (ein JSON-Objekt je Turnier).
     Rückgabe: true = Auswahl wird angezeigt, Aufrufer bricht die eigene
     Initialisierung ab (Navigation folgt per location.replace).
     false = keine Mehrdeutigkeit, normal weiterladen. */
  function maybePrompt(base, typeLabel) {
    try {
      if (alreadyResolved()) return false;
      const existing = listFromStore(base);
      if (!existing.length) return false;
      render(existing, typeLabel, Math.max(0, countAllSaved() - existing.length));
      return true;
    } catch (e) { return false; }
  }

  /* Für Alt-Bögen ohne core/turnier-store.js (mehrere localStorage-Keys je
     Turnier, siehe core/turnier-archive.js "beachl_sessions"-Registry).
     opts: { sessionKeyBase, typeLabel } */
  function maybePromptFromRegistry(opts) {
    try {
      if (alreadyResolved()) return false;
      const o = opts || {};
      const existing = listFromRegistry(o.sessionKeyBase);
      if (!existing.length) return false;
      render(existing, o.typeLabel, Math.max(0, countAllSaved() - existing.length));
      return true;
    } catch (e) { return false; }
  }

  /* Aufruf NUR, wenn maybePrompt()/maybePromptFromRegistry() zuvor false
     zurückgegeben hat (kein ?id=, keine bestehenden Turniere gefunden – also
     ein wirklich neues Turnier). Schreibt in diesem Fall still eine frische
     ?id= in die Adresszeile (per history.replaceState, ohne Neuladen), damit
     zwei parallel aus der Startseite geöffnete neue Turniere desselben Typs
     nicht denselben Speicher-Slot teilen. Steht schon ein ?id= in der URL,
     passiert nichts. */
  function autoId() {
    try {
      if (alreadyResolved()) return;
      const url = new URL(location.href);
      url.searchParams.set('id', freshId());
      history.replaceState(null, '', url.pathname + url.search + url.hash);
    } catch (e) { /* z. B. file://-Aufruf ohne History-API: Standard-Slot bleibt */ }
  }

  const api = { BASE_ID, maybePrompt, maybePromptFromRegistry, autoId };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TResumePicker = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
