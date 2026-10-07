/* ============================================================================
   turnier-i18n.js – schlankes DE/EN-Sprachmodul (Prototyp, PRODUKTPLAN §6.1)

   Umfang: die Startseite (vollständig, inkl. turnier-backup.js-Meldungen)
   und alle dort verlinkten Bögen (KO, Gruppen + Finalrunde, Modified Pool
   Play, Doppel-KO, Runden-System, Flex-Turnier, King & Queen, King/Queen of
   the Court) inklusive der von ihnen genutzten Core-Ausgaben (turnier-ui,
   -archive, -share, -resume-picker, spielplan-enh). Alle anderen Seiten
   (Formatbeschreibungen unter docs/) bleiben vollständig deutsch.

   Grundsätze
   - Deutsch ist IMMER der Standard. Englisch nur nach ausdrücklicher Wahl
     über den Sprachumschalter; die Wahl liegt als reine UI-Präferenz in
     localStorage (BEACHL.lang) – getrennt von den Turnierdaten in IndexedDB.
   - Nur Seiten mit <html data-i18n> sind "aktiv". Auf allen anderen Seiten
     liefern t()/term() garantiert Deutsch; die Core-Module behalten dort
     ihre eingebauten deutschen Fallback-Texte (unverändertes Verhalten).
   - Sprachwechsel = Präferenz speichern + Seite neu laden. Dadurch werden
     auch dynamisch erzeugte Texte, Dialoge und Druckausgaben vollständig in
     der neuen Sprache aufgebaut, ohne Live-Umschaltlogik.
   - Gespeicherte Turnierdaten (Typ "KO-System", automatische Titel, Labels
     der Engine) bleiben deutsch und unverändert. Übersetzt wird nur bei der
     Anzeige: Fachbegriffe der Engine über term() (exakte Begriffe + Muster).

   API (global TI18n)
     t(key, params)        Text zur Schlüssel-ID; {name}-Platzhalter;
                           Plural über {one, other} + params.count
     term(text)            Engine-/Datenbegriff zur Anzeige übersetzen
     lang() / locale()     aktuelle Sprache ('de'|'en') / 'de-DE'|'en-GB'
     active()              Seite hat <html data-i18n> (oder enable(true))
     apply(root)           data-i18n, data-i18n-html, data-i18n-attr,
                           data-i18n-only im DOM anwenden
     mountSwitch(el, cls)  Sprachumschalter-Button einhängen
     switchTo(lang)        Präferenz speichern, auf TStore warten, neu laden
     register(lang, res)   Sprachressource registrieren (core/i18n/*.js)
     useLang / enable      nur für Tests (in-memory, ohne Persistenz)

   Safari 12: kein ?. / ??, keine Lookbehind-Regex, kein globalThis im Code,
   localStorage nur in try/catch (AGENTS.md §7b).
   ========================================================================== */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TI18n = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const LANGS = ['de', 'en'];
  const DEFAULT_LANG = 'de';
  const PREF_KEY = 'BEACHL.lang';
  const LOCALES = { de: 'de-DE', en: 'en-GB' };
  const NAMES = { de: 'Deutsch', en: 'English' };
  const has = Object.prototype.hasOwnProperty;

  const catalogs = {};
  LANGS.forEach(function (l) { catalogs[l] = { messages: {}, terms: {}, patterns: [] }; });

  let current = null;
  let forcedActive = null;
  const warned = {};

  function normalize(l) {
    const s = String(l == null ? '' : l).toLowerCase().slice(0, 2);
    return LANGS.indexOf(s) >= 0 ? s : DEFAULT_LANG;
  }

  function storage() {
    try { return root.localStorage || null; } catch (e) { return null; }
  }
  function readPref() {
    const ls = storage();
    if (!ls) return null;
    try {
      const v = ls.getItem(PREF_KEY);
      return LANGS.indexOf(v) >= 0 ? v : null;
    } catch (e) { return null; }
  }
  function writePref(l) {
    const ls = storage();
    if (!ls) return false;
    try { ls.setItem(PREF_KEY, normalize(l)); return ls.getItem(PREF_KEY) === normalize(l); }
    catch (e) { return false; }
  }

  function doc() { return root.document || null; }

  function active() {
    if (forcedActive != null) return forcedActive;
    const d = doc();
    return !!(d && d.documentElement && d.documentElement.hasAttribute('data-i18n'));
  }
  function enable(on) { forcedActive = on == null ? null : !!on; }

  function storedLang() {
    if (current == null) current = readPref() || DEFAULT_LANG;
    return current;
  }
  /* Sprache für Ausgaben: auf nicht freigeschalteten Seiten immer Deutsch. */
  function lang() { return active() ? storedLang() : DEFAULT_LANG; }
  function locale() { return LOCALES[lang()]; }
  function useLang(l) { current = normalize(l); syncDocLang(); return current; }

  function register(l, res) {
    const c = catalogs[normalize(l)];
    if (!res) return;
    const msgs = res.messages || {};
    Object.keys(msgs).forEach(function (k) { c.messages[k] = msgs[k]; });
    const terms = res.terms || {};
    Object.keys(terms).forEach(function (k) { c.terms[k] = terms[k]; });
    (res.termPatterns || []).forEach(function (p) {
      c.patterns.push({ re: p[0] instanceof RegExp ? p[0] : new RegExp(p[0]), out: p[1] });
    });
  }

  function format(str, params) {
    return String(str).replace(/\{(\w+)\}/g, function (m, k) {
      return params && params[k] != null ? String(params[k]) : m;
    });
  }
  function pick(entry, params) {
    if (entry && typeof entry === 'object') {
      const n = params ? Number(params.count) : NaN;
      const form = n === 1 ? 'one' : 'other';
      return entry[form] != null ? entry[form] : entry.other;
    }
    return entry;
  }
  function lookup(l, key) {
    const c = catalogs[l];
    return c && has.call(c.messages, key) ? c.messages[key] : undefined;
  }
  function warnMissing(l, key) {
    const id = l + ':' + key;
    if (warned[id]) return;
    warned[id] = true;
    if (root.console && root.console.warn) root.console.warn('TI18n: fehlender Text ' + id);
  }

  function t(key, params) {
    const l = lang();
    let entry = lookup(l, key);
    if (entry === undefined && l !== DEFAULT_LANG) {
      warnMissing(l, key);
      entry = lookup(DEFAULT_LANG, key);
    }
    if (entry === undefined) { warnMissing(DEFAULT_LANG, key); return key; }
    return format(pick(entry, params), params);
  }

  function term(text) {
    if (text == null) return text;
    const s = String(text);
    const l = lang();
    if (l === DEFAULT_LANG || !s) return s;
    const c = catalogs[l];
    if (has.call(c.terms, s)) return c.terms[s];
    for (let i = 0; i < c.patterns.length; i++) {
      const m = c.patterns[i].re.exec(s);
      if (m) {
        return c.patterns[i].out.replace(/\{(\d+)\}/g, function (x, n) {
          const part = m[Number(n)];
          return part == null ? '' : term(part);
        });
      }
    }
    return s;
  }

  function syncDocLang() {
    const d = doc();
    if (d && d.documentElement && active()) d.documentElement.setAttribute('lang', lang());
  }

  /* ── DOM-Anwendung ───────────────────────────────────────────────────── */
  function each(rootEl, sel, fn) {
    const base = rootEl || doc();
    if (!base || !base.querySelectorAll) return;
    const list = base.querySelectorAll(sel);
    for (let i = 0; i < list.length; i++) fn(list[i]);
    if (base.matches && base.matches(sel)) fn(base);
  }
  function apply(rootEl) {
    if (!active()) return;
    const l = lang();
    syncDocLang();
    each(rootEl, '[data-i18n-only]', function (el) {
      el.hidden = el.getAttribute('data-i18n-only') !== l;
    });
    /* Deutsch steht bereits im Markup (Test sichert Gleichheit mit de.js) –
       ohne Sprachwechsel wird das Markup nicht angefasst. */
    if (l === DEFAULT_LANG) return;
    each(rootEl, '[data-i18n]', function (el) {
      /* <html data-i18n> ist nur der Freischalt-Marker, kein Textschlüssel. */
      if (!el.getAttribute('data-i18n') || el === el.ownerDocument.documentElement) return;
      if (el.__i18nText === l) return;
      el.__i18nText = l;
      el.textContent = t(el.getAttribute('data-i18n'));
    });
    each(rootEl, '[data-i18n-html]', function (el) {
      if (el.__i18nHtml === l) return;
      el.__i18nHtml = l;
      el.innerHTML = t(el.getAttribute('data-i18n-html'));
    });
    each(rootEl, '[data-i18n-attr]', function (el) {
      if (el.__i18nAttr === l) return;
      el.__i18nAttr = l;
      String(el.getAttribute('data-i18n-attr')).split(';').forEach(function (pair) {
        const idx = pair.indexOf(':');
        if (idx < 1) return;
        const attr = pair.slice(0, idx).trim();
        const key = pair.slice(idx + 1).trim();
        if (attr && key) el.setAttribute(attr, t(key));
      });
    });
  }

  /* ── App-Leiste (appbar.js ist tabu) nachträglich lokalisieren ────────── */
  const GROUP_KEYS = {
    'Teams & Felder': 'chrome.group.teams',
    'Spielplanung': 'chrome.group.planning',
    'Zurücksetzen': 'chrome.group.reset'
  };
  function localizeChrome() {
    const d = doc();
    if (!d || !active() || lang() === DEFAULT_LANG) return;
    const back = d.querySelector('.app-bar__back');
    if (back && !back.__i18n) {
      back.__i18n = true;
      const lbl = back.querySelector('.lbl');
      if (lbl) lbl.textContent = t('chrome.overview');
      back.setAttribute('aria-label', t('chrome.backToOverviewAria'));
    }
    each(d, '.app-bar__btn', function (btn) {
      if (btn.__i18n || btn.classList.contains('i18n-switch')) return;
      const ic = btn.querySelector('.ic');
      const lbl = btn.querySelector('.lbl');
      const icon = ic ? ic.textContent : '';
      let key = null, aria = null;
      if (icon.indexOf('🖨') === 0) { key = 'chrome.print'; aria = 'chrome.print'; }
      else if (icon.indexOf('📖') === 0) { key = 'chrome.info'; aria = 'chrome.infoAria'; }
      if (!key) return;
      btn.__i18n = true;
      if (lbl) lbl.textContent = t(key);
      btn.setAttribute('aria-label', t(aria));
    });
    each(d, '.cfg-action-group', function (g) {
      const label = g.querySelector('.cfg-action-group__label');
      const key = GROUP_KEYS[g.getAttribute('aria-label')] || (label && GROUP_KEYS[label.textContent]);
      if (!key) return;
      g.setAttribute('aria-label', t(key));
      if (label) label.textContent = t(key);
    });
    each(d, '.cfg-actions-primary', function (p) {
      p.setAttribute('aria-label', t('chrome.group.primary'));
    });
    each(d, '[data-label-key]', function (btn) {
      const key = btn.getAttribute('data-label-key');
      const nodes = btn.childNodes;
      for (let i = 0; i < nodes.length; i++) {
        if (nodes[i].nodeType === 3 && nodes[i].nodeValue.trim()) {
          nodes[i].nodeValue = ' ' + t(key) + ' ';
          break;
        }
      }
    });
  }

  /* ── Sprachumschalter ────────────────────────────────────────────────── */
  function otherLang() { return storedLang() === 'de' ? 'en' : 'de'; }

  function injectStyle() {
    const d = doc();
    if (!d || d.getElementById('i18n-switch-style')) return;
    const st = d.createElement('style');
    st.id = 'i18n-switch-style';
    st.textContent =
      '.i18n-switch{cursor:pointer;font:inherit;font-weight:700;}' +
      /* Touch-Ziel ≥ 44 × 44 px (WCAG 2.5.8) ohne die Leistenhöhe zu ändern
         (Startseite: Filterleiste klebt bei top:56px): unsichtbare, zentrierte
         Trefferfläche. Safari 12: kein inset, translate ohne Präfix ok. */
      'button.i18n-switch{position:relative;}' +
      'button.i18n-switch::after{content:"";position:absolute;top:50%;left:50%;' +
        'width:100%;height:100%;min-width:44px;min-height:44px;' +
        '-webkit-transform:translate(-50%,-50%);transform:translate(-50%,-50%);}' +
      '.i18n-switch .ic{font-size:18px;line-height:1;letter-spacing:0;}' +
      '.i18n-switch .lbl{margin-left:6px;}' +
      '@media print{.i18n-switch{display:none !important;}}';
    (d.head || d.documentElement).appendChild(st);
  }

  function mountSwitch(container, className) {
    const d = doc();
    if (!d || !container || !active()) return null;
    const existing = container.querySelector('.i18n-switch');
    if (existing) return existing;
    injectStyle();
    const target = otherLang();
    const btn = d.createElement('button');
    btn.type = 'button';
    btn.className = (className || 'app-bar__btn') + ' i18n-switch noprint';
    btn.setAttribute('lang', target);
    btn.setAttribute('data-target-lang', target);
    btn.setAttribute('aria-label', t('lang.switchAria.' + target));
    btn.setAttribute('title', t('lang.switchAria.' + target));
    const ic = d.createElement('span');
    ic.className = 'ic';
    ic.setAttribute('aria-hidden', 'true');
    ic.textContent = target === 'de' ? '\uD83C\uDDE9\uD83C\uDDEA' : '\uD83C\uDDEC\uD83C\uDDE7';
    const lbl = d.createElement('span');
    lbl.className = 'lbl';
    lbl.setAttribute('aria-hidden', 'true');
    lbl.textContent = NAMES[target];
    btn.appendChild(ic);
    btn.appendChild(lbl);
    btn.addEventListener('click', function () {
      btn.disabled = true;
      switchTo(target);
    });
    container.insertBefore(btn, container.firstChild);
    return btn;
  }

  function reload() {
    const loc = root.location;
    if (loc && typeof loc.reload === 'function') loc.reload();
  }

  /* Präferenz speichern, laufende Speichervorgänge abwarten (TStore ist
     sonst mitten im IndexedDB-Commit), dann neu laden. Gibt false zurück,
     wenn die Präferenz nicht gespeichert werden konnte (z. B. Privatmodus). */
  function switchTo(l) {
    const next = normalize(l);
    if (!writePref(next)) {
      if (root.alert) root.alert(t('lang.storageUnavailable'));
      const btn = doc() && doc().querySelector('.i18n-switch');
      if (btn) btn.disabled = false;
      return Promise.resolve(false);
    }
    current = next;
    const store = root.TStore;
    let idle = Promise.resolve();
    if (store && typeof store.whenIdle === 'function') {
      try { idle = Promise.resolve(store.whenIdle()); } catch (e) { idle = Promise.resolve(); }
    }
    const timeout = new Promise(function (resolve) { setTimeout(resolve, 3000); });
    return Promise.race([idle, timeout]).then(function () {}, function () {}).then(function () {
      reload();
      return true;
    });
  }

  function autoMount() {
    const d = doc();
    if (!d) return;
    const slot = d.querySelector('[data-i18n-switch]');
    if (slot) { mountSwitch(slot, slot.getAttribute('data-i18n-switch') || 'pill'); return; }
    const actions = d.querySelector('.app-bar__actions');
    if (actions) { mountSwitch(actions, 'app-bar__btn'); return; }
    const legacy = d.querySelector('body > .noprint');
    if (legacy) mountSwitch(legacy, 'i18n-switch--legacy');
  }

  function boot() {
    if (!active()) return;
    apply(doc());
    localizeChrome();
    autoMount();
  }

  const d0 = doc();
  if (d0 && d0.addEventListener) {
    syncDocLang();
    d0.addEventListener('DOMContentLoaded', boot);
    if (root.addEventListener) root.addEventListener('load', boot);
  }

  return {
    LANGS: LANGS.slice(),
    DEFAULT_LANG: DEFAULT_LANG,
    PREF_KEY: PREF_KEY,
    t: t,
    term: term,
    lang: lang,
    locale: locale,
    active: active,
    enable: enable,
    useLang: useLang,
    register: register,
    apply: apply,
    localizeChrome: localizeChrome,
    mountSwitch: mountSwitch,
    switchTo: switchTo,
    _catalogs: catalogs
  };
});
