/* ============================================================================
   turnier-native.js – App-Funktionen der nativen iOS-/Android-App (Capacitor)

   Im Browser/PWA tut diese Datei NICHTS: window.print bleibt unverändert,
   Teilen-Links entstehen weiter aus location.href (turnier-share.js), das
   native Bundle wird nie geladen.

   In der App (Capacitor.isNativePlatform()):
   - Öffentliche Links: Seiten laufen dort unter capacitor://localhost (iOS)
     bzw. https://localhost (Android). Solche Adressen sind für Empfänger
     wertlos. publicPageUrl() bildet die aktuelle App-Seite auf dieselbe
     Seite der gehosteten Web-App (PUBLIC_WEB_BASE) ab; ?id=/?mode= bleiben,
     der Link-Hash (#share=/#shareoffline=) wird vom Aufrufer angehängt.
     Nur bekannte Seiten (Startseite, Turnierbögen, Formatbeschreibungen)
     werden abgebildet; sonst Fehler 'no-public-url' statt einer lokalen URL.
     localPageFromPublicUrl() macht das Umgekehrte für eingefügte Links
     (Code-Eingabe auf der Startseite).
   - System-Teilen: shareLink() → TNativeShare (Teilen-Menü/Chooser).
   - Drucken/PDF: WKWebView und Android-WebView ignorieren window.print().
     install() ersetzt window.print daher NUR in der App durch print():
     Auswahl „Drucken…“ (System-Druckdialog: AirPrint bzw. Android-Druck)
     und „PDF“ (iOS: A4-PDF über das Teilen-Menü; Android: Druckdialog mit
     „Als PDF speichern“). Gedruckt wird die aktuelle Seite mit ihren
     Druck-Styles; Ausrichtung und Ränder kommen aus der @page-Regel.
     Damit gilt das für alle Bögen (App-Leiste, Sprungleiste) und die
     Formatbeschreibungen (onclick="window.print()").
   - Android-Zurück-Taste (handleBack, über TNativeApp/@capacitor/app):
     offener App-Dialog (Teilen, Drucken/PDF) → schließen; sonst fokussiertes
     Eingabefeld übernehmen (blur → change → Speichern), laufende
     Speichervorgänge abwarten und erst dann zur vorigen Seite (WebView-
     Verlauf), ohne Verlauf zur Startseite bzw. auf der Startseite die App in
     den Hintergrund legen (wie Android ab 12; nichts wird beendet). Ist nicht
     alles gespeichert, wird vor dem Verlassen der Seite nachgefragt.
   - App geht in den Hintergrund (pause, iOS/Android): fokussiertes
     Eingabefeld übernehmen, damit eine getippte Eingabe gespeichert wird,
     bevor das System die App beendet.

   Konfiguration: PUBLIC_WEB_BASE = Basis-URL der veröffentlichten Web-App
   (muss https:// sein und mit / enden; entspricht frontend_base_url in
   backend/config.php). Für einen anderen Hosting-Ort nur hier ändern.

   Safari 12: kein ?. / ??, kein globalThis im Code (AGENTS.md §7b).
   ========================================================================== */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.TNative = api;
    api.install();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const PUBLIC_WEB_BASE = 'https://mcmulman.github.io/beachvolley/';
  /* Seiten des App-Bundles (relativ zu webDir), die es öffentlich gibt. */
  const PUBLIC_PAGE = /^(?:index\.html|Turnierbogen_[A-Za-z0-9_]+\.html|docs\/format-[a-z0-9-]+\.html)?$/;
  const NATIVE_BUNDLE = 'native-store.bundle.js';
  const MODAL_ID = 'tnative-print-root';

  function i18n() {
    return typeof TI18n !== 'undefined' && TI18n && TI18n.active() ? TI18n : null;
  }
  function tx(key, de, params) {
    const I = i18n();
    if (I) return I.t(key, params);
    return String(de).replace(/\{(\w+)\}/g, function (m, k) { return params && params[k] != null ? String(params[k]) : m; });
  }
  function codedError(code, message, cause) {
    const error = new Error(message);
    error.code = code;
    if (cause !== undefined) error.cause = cause;
    return error;
  }
  function errMsg(err) { return String((err && err.message) || err); }

  /* ------------------------------------------------------------ Plattform */
  /* Wie TStore: wirft isNativePlatform(), gilt die Seite als nativ (lieber
     keinen lokalen Link erzeugen als einen falschen). */
  function isNative() {
    const cap = root && root.Capacitor;
    if (!cap || typeof cap.isNativePlatform !== 'function') return false;
    try { return !!cap.isNativePlatform(); } catch (e) { return true; }
  }
  function platform() {
    const cap = root && root.Capacitor;
    try { return cap && typeof cap.getPlatform === 'function' ? String(cap.getPlatform()) : 'web'; }
    catch (e) { return 'web'; }
  }

  /* ------------------------------------------------------ Öffentliche URL */
  function publicBase() {
    let base;
    try { base = new URL(PUBLIC_WEB_BASE); } catch (e) { base = null; }
    if (!base || base.protocol !== 'https:' || base.search || base.hash || !/\/$/.test(base.pathname)) {
      throw codedError('no-public-url', 'PUBLIC_WEB_BASE must be an https:// URL ending with /');
    }
    return base;
  }
  function noPublicUrl() {
    return codedError('no-public-url', tx('native.share.noPublicUrl', 'Für diese Seite gibt es keinen öffentlichen Link.'));
  }
  /* App-Seite (href) → URL-Objekt derselben Seite unter PUBLIC_WEB_BASE,
     mit ?Query, ohne #Hash. Wirft 'no-public-url'. */
  function publicPageUrl(href) {
    let local, rel;
    try {
      local = new URL(String(href));
      rel = decodeURIComponent(local.pathname).replace(/^\/+/, '');
    } catch (e) { throw noPublicUrl(); }
    if (!PUBLIC_PAGE.test(rel)) throw noPublicUrl();
    const url = new URL(rel, publicBase());
    url.search = local.search;
    url.hash = '';
    return url;
  }
  /* Eingefügter öffentlicher Link → relative App-Seite inkl. ?Query und
     #Hash (für die Startseite im App-Wurzelverzeichnis), sonst null. */
  function localPageFromPublicUrl(input) {
    const base = publicBase();
    const s = String(input || '').trim();
    if (s.indexOf(base.href) !== 0) return null;
    let url, rel;
    try {
      url = new URL(s);
      rel = decodeURIComponent(url.pathname).slice(base.pathname.length);
    } catch (e) { return null; }
    if (url.origin !== base.origin || !PUBLIC_PAGE.test(rel)) return null;
    return (rel || 'index.html') + url.search + url.hash;
  }

  /* -------------------------------------------------- Natives Bundle laden
     Auf Seiten mit TStore lädt TStore das Bundle (einmal je Seite), sonst
     (Formatbeschreibungen) diese Datei selbst – relativ zu ihrem Pfad. */
  const bundleUrl = (function () {
    try {
      const script = root && root.document && root.document.currentScript;
      const src = script && script.src;
      if (src) return String(src).replace(/[^\/?#]*(?:[?#].*)?$/, NATIVE_BUNDLE);
    } catch (e) { }
    return 'core/' + NATIVE_BUNDLE;
  })();
  let bundlePromise = null;
  function injectBundle() {
    return new Promise(function (resolve, reject) {
      const doc = root && root.document;
      if (!doc || typeof doc.createElement !== 'function') {
        reject(new Error('native bundle cannot be loaded without a document'));
        return;
      }
      const script = doc.createElement('script');
      script.src = bundleUrl;
      script.async = true;
      script.onload = function () { resolve(); };
      script.onerror = function () {
        if (script.parentNode) script.parentNode.removeChild(script);
        reject(new Error('failed to load ' + bundleUrl));
      };
      (doc.head || doc.documentElement).appendChild(script);
    });
  }
  function loadBundle() {
    if (!isNative()) return Promise.reject(codedError('native-unavailable', 'native features are only available in the app'));
    if (root.TNativePrint && root.TNativeShare) return Promise.resolve();
    if (bundlePromise) return bundlePromise;
    const store = root.TStore;
    const load = store && typeof store.loadNativeBundle === 'function' && !root.TNativeStorage
      ? store.loadNativeBundle() : (root.TNativeStorage ? Promise.resolve() : injectBundle());
    const p = load.then(function () {
      if (!root.TNativePrint || !root.TNativeShare) throw new Error('native bundle did not register TNativePrint/TNativeShare');
    });
    bundlePromise = p;
    p.then(null, function () { if (bundlePromise === p) bundlePromise = null; });
    return p;
  }

  /* ---------------------------------------------------------- Link teilen
     { url, title, text } → Promise<{ status: 'shared'|'cancelled' }> */
  function shareLink(request) {
    return loadBundle().then(function () {
      return root.TNativeShare.shareLink({
        url: request && request.url,
        title: request && request.title,
        text: request && request.text,
        dialogTitle: tx('native.share.dialogTitle', 'Turnierlink teilen')
      });
    });
  }

  /* ------------------------------------------------------ Seiteneinrichtung
     Ausrichtung und Ränder aus der zuletzt gültigen @page-Regel (auch in
     @media print). → { orientation, margins: [oben, rechts, unten, links] mm } */
  const MM = { mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72, pc: 25.4 / 6, px: 25.4 / 96 };
  function toMm(value) {
    const m = /^(-?\d*\.?\d+)(mm|cm|in|pt|pc|px)?$/.exec(String(value).trim());
    if (!m) return null;
    const n = parseFloat(m[1]);
    if (!m[2]) return n === 0 ? 0 : null;
    return Math.round(n * MM[m[2]] * 10) / 10;
  }
  function parseMargins(text) {
    const parts = String(text).trim().split(/\s+/).map(toMm);
    if (!parts.length || parts.length > 4 || parts.some(function (v) { return v == null || v < 0; })) return null;
    const t = parts[0];
    const r = parts.length > 1 ? parts[1] : t;
    const b = parts.length > 2 ? parts[2] : t;
    const l = parts.length > 3 ? parts[3] : r;
    return [t, r, b, l];
  }
  function collectPageRules(rules, out) {
    for (let i = 0; rules && i < rules.length; i++) {
      const rule = rules[i];
      const text = String(rule && rule.cssText || '');
      if (/^@page\b/i.test(text)) out.push(text);
      else if (rule && rule.cssRules) collectPageRules(rule.cssRules, out);
    }
  }
  function pageSetup() {
    const setup = { orientation: 'portrait', margins: [10, 10, 10, 10] };
    const doc = root && root.document;
    const sheets = doc && doc.styleSheets ? doc.styleSheets : [];
    const pages = [];
    for (let i = 0; i < sheets.length; i++) {
      let rules = null;
      try { rules = sheets[i].cssRules; } catch (e) { rules = null; }
      collectPageRules(rules, pages);
    }
    pages.forEach(function (text) {
      const size = /(?:^|[;{\s])size\s*:\s*([^;}]+)/i.exec(text);
      if (size) setup.orientation = /landscape/i.test(size[1]) ? 'landscape' : 'portrait';
      const margin = /(?:^|[;{\s])margin\s*:\s*([^;}]+)/i.exec(text);
      const parsed = margin && parseMargins(margin[1].replace(/!important/i, ''));
      if (parsed) setup.margins = parsed;
    });
    return setup;
  }
  function jobName() {
    const doc = root && root.document;
    const bar = doc && doc.body && doc.body.getAttribute('data-bar-title');
    return String((bar && bar.trim()) || (doc && doc.title) || 'CompetitionPilot').trim();
  }
  function pdfFileName(name) {
    const d = new Date();
    const pad = function (n) { return (n < 10 ? '0' : '') + n; };
    return name + ' ' + d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  /* ------------------------------------------------------------- Auswahl */
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function ensureStyles() {
    const doc = root.document;
    if (doc.getElementById('tnative-style')) return;
    const style = doc.createElement('style');
    style.id = 'tnative-style';
    style.textContent =
      '.tnative-backdrop{position:fixed;top:0;right:0;bottom:0;left:0;z-index:10001;background:rgba(20,30,45,.55);' +
        'display:flex;align-items:flex-end;justify-content:center;padding:12px;' +
        'padding-bottom:12px;padding-bottom:calc(12px + env(safe-area-inset-bottom));}' +
      '@media print{.tnative-backdrop{display:none !important;}}' +
      '@media (min-width:600px){.tnative-backdrop{align-items:center;}}' +
      '.tnative-panel{background:#fff;color:#1a1a2e;width:100%;max-width:420px;border-radius:14px;' +
        'box-shadow:0 12px 40px rgba(0,0,0,.28);overflow:hidden;' +
        'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;}' +
      '.tnative-panel h3{margin:0;padding:16px 18px 10px;font-size:16px;font-weight:800;color:#1a3a5c;}' +
      '.tnative-opt{display:block;width:100%;text-align:left;border:none;border-top:1px solid #e2e8f0;' +
        'background:#fff;padding:13px 18px;cursor:pointer;font:inherit;color:#1a1a2e;}' +
      '.tnative-opt:active,.tnative-opt:hover{background:#eef4fa;}' +
      '.tnative-opt strong{display:block;font-size:15px;color:#1a3a5c;}' +
      '.tnative-opt small{display:block;margin-top:2px;font-size:12.5px;line-height:1.4;color:#5a6375;}' +
      '.tnative-cancel{display:block;width:100%;border:none;border-top:1px solid #e2e8f0;background:#f3f6fa;' +
        'padding:13px 18px;font:inherit;font-size:15px;font-weight:700;color:#1a3a5c;cursor:pointer;}';
    doc.head.appendChild(style);
  }
  function closeChooser() {
    const el = root.document.getElementById(MODAL_ID);
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }
  /* → Promise<'print' | 'pdf' | null> (null = abgebrochen) */
  function chooseOutput(caps) {
    return new Promise(function (resolve) {
      const doc = root.document;
      closeChooser();
      ensureStyles();
      const android = platform() === 'android';
      const options = [];
      if (caps.print) {
        options.push({ act: 'print', label: tx('native.print.print', 'Drucken…'),
          hint: android
            ? tx('native.print.printHintAndroid', 'Öffnet den Android-Druckdialog (A4).')
            : tx('native.print.printHint', 'Öffnet den Systemdruckdialog (AirPrint, A4).') });
      }
      if (caps.pdf === 'file') {
        options.push({ act: 'pdf', label: tx('native.print.pdf', 'Als PDF teilen…'),
          hint: tx('native.print.pdfHint', 'Erstellt ein A4-PDF zum Senden oder Sichern („In Dateien sichern“).') });
      } else if (caps.pdf === 'dialog') {
        options.push({ act: 'pdf', label: tx('native.print.pdfDialog', 'Als PDF speichern…'),
          hint: tx('native.print.pdfDialogHint', 'Öffnet den Druckdialog – dort oben als Drucker „Als PDF speichern“ wählen.') });
      }
      const title = tx('native.print.title', 'Drucken / PDF');
      const el = doc.createElement('div');
      el.id = MODAL_ID;
      el.className = 'tnative-backdrop noprint';
      el.innerHTML = '<div class="tnative-panel" role="dialog" aria-modal="true" aria-label="' + escapeHtml(title) + '">' +
        '<h3>' + escapeHtml(title) + '</h3>' +
        options.map(function (o) {
          return '<button type="button" class="tnative-opt" data-act="' + o.act + '"><strong>' + escapeHtml(o.label) +
            '</strong><small>' + escapeHtml(o.hint) + '</small></button>';
        }).join('') +
        '<button type="button" class="tnative-cancel" data-act="cancel">' + escapeHtml(tx('native.print.cancel', 'Abbrechen')) + '</button>' +
        '</div>';
      let done = false;
      /* Fokusfuehrung: Tab bleibt im Dialog, Hintergrund ist fuer
         Screenreader stumm, danach Fokus zurueck zum Druck-Knopf. */
      const back = doc.activeElement;
      const muted = [];
      function finish(choice) {
        if (done) return;
        done = true;
        doc.removeEventListener('keydown', onKey);
        closeChooser();
        muted.forEach(function (n) { n.removeAttribute('aria-hidden'); });
        if (back && back.focus && doc.documentElement.contains(back)) {
          try { back.focus(); } catch (err) { }
        }
        resolve(choice);
      }
      function onKey(e) {
        if (e.key === 'Escape' || e.key === 'Esc') { finish(null); return; }
        if (e.key !== 'Tab') return;
        const f = Array.prototype.slice.call(el.querySelectorAll('button'));
        const i = f.indexOf(doc.activeElement);
        if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && (i === -1 || i === f.length - 1)) { e.preventDefault(); f[0].focus(); }
      }
      el.addEventListener('click', function (e) {
        if (e.target === el) { finish(null); return; }
        const btn = e.target.closest ? e.target.closest('[data-act]') : null;
        if (!btn) return;
        const act = btn.getAttribute('data-act');
        finish(act === 'cancel' ? null : act);
      });
      doc.addEventListener('keydown', onKey);
      doc.body.appendChild(el);
      Array.prototype.forEach.call(doc.body.children, function (n) {
        if (n === el || n.tagName === 'SCRIPT' || n.tagName === 'STYLE' || n.hasAttribute('aria-hidden')) return;
        n.setAttribute('aria-hidden', 'true');
        muted.push(n);
      });
      const first = el.querySelector('.tnative-opt');
      if (first && first.focus) first.focus();
    });
  }

  /* -------------------------------------------------------- Drucken / PDF
     beforeprint/afterprint (z. B. Copyright-Zeile im Fuß): WebKit löst sie
     beim Drucken über den Print-Formatter selbst aus (im iOS-Simulator
     beobachtet). Für Android wird sie hier ausgelöst; die Handler der Seiten
     sind idempotent, ein zusätzliches Ereignis der WebView schadet nicht. */
  function dispatch(type) {
    if (platform() === 'ios') return;
    try { root.dispatchEvent(new Event(type)); } catch (e) { /* alte Engines ohne Event-Konstruktor */ }
  }
  function errorText(err) {
    const code = err && err.code;
    if (code === 'print-unavailable' || code === 'native-unavailable') {
      return tx('native.print.unavailable', 'Drucken ist in der App auf diesem Gerät nicht verfügbar.');
    }
    if (code === 'pdf-failed') return tx('native.pdf.failed', 'Das PDF konnte nicht erstellt werden: {message}', { message: errMsg(err) });
    if (code === 'share-failed') return tx('native.pdf.shareFailed', 'Das Teilen-Menü konnte nicht geöffnet werden: {message}', { message: errMsg(err) });
    return tx('native.print.failed', 'Drucken fehlgeschlagen: {message}', { message: errMsg(err) });
  }
  function runOutput(choice, caps) {
    const setup = pageSetup();
    const name = jobName();
    const printer = root.TNativePrint;
    dispatch('beforeprint');
    const job = choice === 'pdf' && caps.pdf === 'file'
      ? printer.sharePdf({ fileName: pdfFileName(name), title: name, orientation: setup.orientation, margins: setup.margins })
      : printer.print({ jobName: name, orientation: setup.orientation });
    return job.then(function (result) {
      dispatch('afterprint');
      return result;
    }, function (err) {
      dispatch('afterprint');
      throw err;
    });
  }
  let printing = null;
  /* Ersatz für window.print() in der App. → Promise<{ status } | null>;
     Fehler werden angezeigt (alert), Abbruch bleibt still. */
  function print() {
    if (!isNative()) return Promise.resolve(null);
    if (printing) return printing;
    let caps = null;
    const p = loadBundle().then(function () {
      return root.TNativePrint.capabilities();
    }).then(function (c) {
      caps = c;
      if (!caps.print && !caps.pdf) throw codedError('print-unavailable', 'printing is not available');
      return chooseOutput(caps);
    }).then(function (choice) {
      return choice ? runOutput(choice, caps) : { status: 'cancelled' };
    }).then(null, function (err) {
      if (err && err.code === 'print-busy') return null;
      root.alert(errorText(err));
      return { status: 'failed', code: (err && err.code) || 'print-failed' };
    });
    printing = p;
    p.then(function () { printing = null; });
    return p;
  }

  /* ------------------------------------------- Zurück-Taste / Hintergrund */
  const BACK_SAVE_TIMEOUT_MS = 4000;
  const BACK_NAV_GUARD_MS = 800;
  let backBusy = false;
  let lifecycleActive = false;

  function wait(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }
  function isShown(el) {
    if (!el || el.isConnected === false) return false;
    return typeof el.getClientRects !== 'function' || el.getClientRects().length > 0;
  }
  /* Oberster sichtbarer modaler App-Dialog (TShare, Druckauswahl) oder null. */
  function openDialog() {
    const doc = root.document;
    if (!doc || typeof doc.querySelectorAll !== 'function') return null;
    const list = doc.querySelectorAll('[aria-modal="true"]');
    for (let i = list.length - 1; i >= 0; i--) if (isShown(list[i])) return list[i];
    return null;
  }
  /* Wie die Escape-Taste: beide App-Dialoge schließen darauf (Abbruch). */
  function dismissDialog() {
    const doc = root.document;
    let event;
    try {
      event = new root.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    } catch (e) {
      event = doc.createEvent('Event');
      event.initEvent('keydown', true, true);
      try { Object.defineProperty(event, 'key', { value: 'Escape' }); } catch (e2) { event.key = 'Escape'; }
    }
    const target = doc.activeElement && doc.activeElement !== doc.body ? doc.activeElement : doc;
    target.dispatchEvent(event);
    return !openDialog();
  }
  /* Getippte, noch nicht übernommene Eingabe übernehmen: blur löst das
     change-Ereignis aus, über das die Bögen speichern. */
  function commitFocusedField() {
    const doc = root.document;
    const el = doc && doc.activeElement;
    if (!el || el === doc.body || !/^(?:INPUT|TEXTAREA|SELECT)$/.test(String(el.tagName))) return false;
    if (typeof el.blur === 'function') el.blur();
    return true;
  }
  /* → Promise<boolean>: true = alles gespeichert (oder keine Speicherung
     auf dieser Seite). Wartet höchstens BACK_SAVE_TIMEOUT_MS. */
  function settleSaves() {
    const store = root.TStore;
    if (!store || typeof store.whenIdle !== 'function') return Promise.resolve(true);
    return new Promise(function (resolve) {
      let done = false;
      const finish = function (value) { if (!done) { done = true; resolve(value); } };
      setTimeout(function () { finish(false); }, BACK_SAVE_TIMEOUT_MS);
      store.whenIdle().then(function () { finish(true); }, function () { finish(false); });
    }).then(function (idle) {
      const marked = root.__BL_UNSAVED_SHEETS__;
      return idle && !(typeof store.hasUnsavedWork === 'function' && store.hasUnsavedWork())
        && !(marked && Object.keys(marked).length);
    });
  }
  function isStartPage() {
    return /^\/(?:index\.html)?$/.test(String(root.location.pathname));
  }
  function startPageUrl() {
    return new URL('/index.html', String(root.location.href)).href;
  }
  /* Android-Zurück-Taste. event = { canGoBack } (WebView-Verlauf).
     → Promise<'busy'|'dialog-closed'|'dialog-open'|'stayed'|'back'|'home'|'minimized'|'failed'> */
  function handleBack(event) {
    if (backBusy) return Promise.resolve('busy');
    if (openDialog()) return Promise.resolve(dismissDialog() ? 'dialog-closed' : 'dialog-open');
    backBusy = true;
    let navigating = false;
    commitFocusedField();
    /* Ein Takt Pause: change-Handler, die erst asynchron speichern, sollen
       ihren Speichervorgang noch anmelden können. */
    return wait(0).then(settleSaves).then(function (saved) {
      if (isStartPage() && !(event && event.canGoBack)) {
        const app = root.TNativeApp;
        if (!app || typeof app.minimize !== 'function') return 'stayed';
        return app.minimize().then(function () { return 'minimized'; }, function () { return 'stayed'; });
      }
      if (!saved && !root.confirm(tx('native.back.unsaved',
        'Nicht alle Änderungen sind gespeichert. Seite trotzdem verlassen? Nicht gespeicherte Eingaben gehen dabei verloren.'))) {
        return 'stayed';
      }
      /* Bereits bestätigt: beforeunload von TStore nicht ein zweites Mal fragen lassen. */
      if (!saved && root.TStore && typeof root.TStore.allowLeave === 'function') root.TStore.allowLeave();
      navigating = true;
      if (event && event.canGoBack) { root.history.back(); return 'back'; }
      root.location.href = startPageUrl();
      return 'home';
    }).then(null, function (err) {
      if (root.console) root.console.error('[TNative] back failed', err);
      return 'failed';
    }).then(function (result) {
      /* Nach dem Navigationsstart einen zweiten Tastendruck kurz ignorieren,
         sonst springt der Verlauf zwei Seiten zurück. */
      if (navigating) setTimeout(function () { backBusy = false; }, BACK_NAV_GUARD_MS);
      else backBusy = false;
      return result;
    });
  }
  function handlePause() {
    commitFocusedField();
    dispatchLifecycleEvent('pause');
  }
  function handleResume() {
    dispatchLifecycleEvent('resume');
  }
  function dispatchLifecycleEvent(name) {
    const doc = root.document;
    if (!doc || typeof doc.createEvent !== 'function') return;
    const event = doc.createEvent('Event');
    event.initEvent('beachl:native-' + name, false, false);
    root.dispatchEvent(event);
  }
  /* Registriert Zurück-Taste/Hintergrund für diese Seite. → Promise<{…}|null> */
  function listenLifecycle() {
    if (!isNative()) return Promise.resolve(null);
    return loadBundle().then(function () {
      const app = root.TNativeApp;
      if (!app || typeof app.listen !== 'function') throw codedError('native-unavailable', 'native bundle did not register TNativeApp');
      return app.listen({ backButton: handleBack, pause: handlePause, resume: handleResume });
    }).then(function (registered) {
      lifecycleActive = true;
      return registered;
    }, function (err) {
      if (root.console) root.console.warn('[TNative] back button/background handling unavailable', err);
      return null;
    });
  }
  let lifecycleReady = null;
  /* Erst nach dem Parsen: TStore (später im Dokument) soll das Bundle laden,
     damit es nie doppelt eingebunden wird. */
  function installLifecycle() {
    const doc = root.document;
    if (!doc || typeof root.addEventListener !== 'function') return;
    lifecycleReady = new Promise(function (resolve) {
      const start = function () { resolve(listenLifecycle()); };
      if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start);
      else start();
    });
    root.addEventListener('pagehide', function () {
      if (lifecycleActive && root.TNativeApp && typeof root.TNativeApp.release === 'function') root.TNativeApp.release();
      lifecycleActive = false;
    });
    root.addEventListener('pageshow', function (e) {
      if (e && e.persisted) lifecycleReady = listenLifecycle();
    });
  }

  let installed = false;
  /* Nur in der App: window.print → print(), Zurück-Taste/Hintergrund.
     Browser/PWA bleiben unverändert. */
  function install() {
    if (installed || !isNative() || !root) return false;
    installed = true;
    root.print = function () { print(); };
    installLifecycle();
    return true;
  }

  return {
    PUBLIC_WEB_BASE: PUBLIC_WEB_BASE,
    isNative: isNative, platform: platform,
    publicPageUrl: publicPageUrl, localPageFromPublicUrl: localPageFromPublicUrl,
    shareLink: shareLink, print: print, install: install, loadBundle: loadBundle,
    pageSetup: pageSetup, handleBack: handleBack,
    lifecycleReady: function () { return lifecycleReady || Promise.resolve(null); }
  };
});
