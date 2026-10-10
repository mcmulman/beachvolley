/* ============================================================================
   turnier-resume-picker.js – Auswahl beim mehrdeutigen Öffnen eines Bogens

   Wird ein Turnierbogen OHNE ?id= geöffnet (Lesezeichen, von Hand eingegebene
   URL, alter Tab-Link) und liegen für diesen Bogentyp bereits ein oder
   mehrere gespeicherte Turniere vor, ist unklar, welches gemeint ist. Statt
   stillschweigend im (ggf. falschen) Standard-Slot zu landen, zeigt dieses
   Modul eine kurze Auswahl. Die Wahl führt per location.replace(...&id=…) zu
   genau der URL, die der Bogen ohnehin für "id vorhanden" kennt – der ganze
   restliche Lade-/Init-Code der Bögen bleibt unverändert.

   Gespeicherte Turniere werden ausschließlich über den TStore-Index (async,
   IndexedDB/SQLite; readIndex) gefunden; maybePrompt() liefert daher ein Promise<boolean>.

   BASE_ID ist der Sentinel-Wert für "der unverzweigte, alte Standard-Slot
   ohne Suffix" – so bleiben vor Einführung dieses Features gespeicherte
   Turniere über die Auswahl erreichbar, ohne dass Daten verloren gehen.

   Jede Zeile hat daneben eine eigene Löschaktion (kein verschachtelter
   Button). Nach Bestätigung in der Zeile wird der Eintrag mit demselben
   atomaren Helfer wie auf der Startseite entfernt
   (TStore.deleteEntriesInView in EINER Transaktion, mit der beim Anzeigen
   gelesenen Revision als Erwartung – sonst Konflikt, nichts gelöscht).
   Datensatz + Indexzeile weg, Revisionsmarke bleibt, lokale Serverbindung
   wird gelöst; Rückgängig (TStore.undoDeleteInView, 15 s) stellt das
   Turnier als lokale Kopie wieder her. Server, Archive und andere Modi/IDs
   bleiben unangetastet.
   ========================================================================== */
(function (root) {
  'use strict';

  const BASE_ID = '_base_';

  /* DE/EN-Prototyp (core/turnier-i18n.js): nur auf freigeschalteten Seiten
     übersetzen, sonst exakt die bisherigen deutschen Texte. */
  function i18n() {
    return typeof TI18n !== 'undefined' && TI18n && TI18n.active() ? TI18n : null;
  }
  function tx(key, de, params) {
    const I = i18n();
    if (I) return I.t(key, params);
    const s = de && typeof de === 'object'
      ? (params && Number(params.count) === 1 ? de.one : de.other) : de;
    return String(s).replace(/\{(\w+)\}/g, (m, k) => (params && params[k] != null ? String(params[k]) : m));
  }
  function term(s) {
    const I = i18n();
    return I ? I.term(s) : s;
  }

  function fmtDate(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    if (isNaN(d.getTime())) return '';
    const I = i18n();
    return d.toLocaleString(I ? I.locale() : 'de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
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
  function listFromIndex(idx, base, tokens) {
    idx = idx || {};
    const specs = normalizeBases(base);
    const out = [];
    Object.keys(idx).forEach(k => {
      const spec = specs.filter(s => k === s.base || k.indexOf(s.base + '.') === 0)[0];
      if (!spec) return;
      out.push({
        id: k === spec.base ? BASE_ID : k.slice(spec.base.length + 1),
        /* Vollständige Bogen-ID (Speicher-Schlüssel ohne TStore.PREFIX):
           nur damit wird gelöscht – nie aus id/base rekonstruiert. */
        sheet: k,
        /* Revision/Prüfsumme des angezeigten Stands (TStore.recordTokenInView);
           undefined = unbekannt, dann wird nicht gelöscht. */
        token: tokens && Object.prototype.hasOwnProperty.call(tokens, k) ? tokens[k] : undefined,
        params: spec.params,
        title: idx[k].title || '',
        meta: [
          idx[k].teams ? tx('picker.teams', '{count} Teams', { count: idx[k].teams }) : '',
          idx[k].filled ? tx('picker.results', { one: '{count} Ergebnis', other: '{count} Ergebnisse' },
            { count: idx[k].filled }) : '',
          fmtDate(idx[k].updated)
        ].filter(Boolean).join(' · '),
        updated: idx[k].updated ? new Date(idx[k].updated).getTime() : 0
      });
    });
    return out;
  }
  /* Index + Kennung je Turnier aus EINER Transaktion lesen, damit die
     Löscherwartung exakt zum angezeigten Stand passt. Ohne Transaktion
     (Speicher blockiert) bleibt die Liste lesbar, Löschen aber gesperrt.
     → Promise<{ idx, tokens|null }> */
  function readIndex() {
    const S = root.TStore;
    const plain = () => Promise.resolve(S.index()).then(idx => ({ idx: idx, tokens: null }));
    if (typeof S.transaction !== 'function' || typeof S.refreshIndexInView !== 'function'
        || typeof S.recordTokenInView !== 'function') return plain();
    return S.transaction(view => {
      const idx = S.refreshIndexInView(view);
      const tokens = {};
      Object.keys(idx).forEach(k => { if (k.indexOf('__') !== 0) tokens[k] = S.recordTokenInView(view, k); });
      return { idx: idx, tokens: tokens };
    }, { tracked: false, report: false }).then(null, plain);
  }

  /* → Promise<[Eintrag]> */
  function listFromStore(base) {
    const TStore = root.TStore;
    if (!TStore || typeof TStore.index !== 'function') return Promise.resolve([]);
    return Promise.resolve(TStore.index()).then(idx => listFromIndex(idx, base));
  }

  function freshId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  /* Grobe Gesamtzahl laufender Turniere im Index – nur für den Hinweistext
     "es gibt noch weitere" im Overlay. */
  function countAllSaved(idx) {
    return Object.keys(idx || {}).filter(k => k.indexOf('__') !== 0).length;
  }

  /* idOrEntry: entweder eine reine ID (Klick auf "Neues Turnier") oder ein
     Eintrag aus listFromStore() mit optionalem .params (siehe oben). */
  function gotoId(idOrEntry) {
    allowLeave();
    const isEntry = idOrEntry && typeof idOrEntry === 'object';
    const url = new URL(location.href);
    url.searchParams.set('id', isEntry ? idOrEntry.id : idOrEntry);
    if (isEntry && idOrEntry.params) {
      Object.keys(idOrEntry.params).forEach(k => url.searchParams.set(k, idOrEntry.params[k]));
    }
    location.replace(url.pathname + url.search + url.hash);
  }

  /* Die Auswahl hat keinen ungespeicherten Bogenstand. Eine zuvor
     fehlgeschlagene Löschung meldet TStore aber als Speicherfehler – das
     Weiternavigieren soll deshalb nicht von beforeunload abgefangen werden. */
  function allowLeave() {
    try { if (root.TStore && typeof root.TStore.allowLeave === 'function') root.TStore.allowLeave(); } catch (e) { }
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
      /* Zeile = Öffnen-Button + daneben eigener Lösch-Button (Abstände per
         margin statt flex-gap: Safari 12 kennt gap bei Flexbox nicht). */
      '.trp-row{display:flex;flex-wrap:wrap;align-items:stretch;width:100%;margin:0 0 8px}' +
      '.trp-row:last-child{margin-bottom:0}' +
      '.trp-item{display:flex;flex-direction:column;align-items:flex-start;gap:2px;' +
        '-webkit-box-flex:1;flex:1 1 0%;min-width:0;min-height:44px;box-sizing:border-box;' +
        'text-align:left;padding:10px 12px;border:1px solid #d7dbe0;' +
        'border-radius:8px;background:#f7f8fa;cursor:pointer;font:inherit;color:inherit}' +
      '.trp-item:hover{background:#eef3fb;border-color:#9db8dd}' +
      '.trp-title{font-weight:600;font-size:14px}' +
      '.trp-title,.trp-meta{max-width:100%;word-wrap:break-word;overflow-wrap:break-word}' +
      '.trp-meta{font-size:12px;color:#666}' +
      '.trp-del{-webkit-box-flex:0;flex:0 0 44px;width:44px;min-height:44px;margin-left:6px;padding:0;' +
        'border:1px solid transparent;border-radius:8px;background:transparent;color:#77808a;cursor:pointer;' +
        'display:flex;align-items:center;justify-content:center}' +
      '.trp-del svg{width:18px;height:18px;display:block}' +
      '.trp-del:hover,.trp-del[aria-expanded="true"]{color:#b03a2e;border-color:#e3b5b0;background:#fdf3f2}' +
      '.trp-item:disabled,.trp-del:disabled,.trp-confirm button:disabled,.trp-new:disabled{cursor:default;opacity:.55}' +
      '.trp-confirm{flex:1 1 100%;width:100%;box-sizing:border-box;margin-top:6px;padding:10px 12px;' +
        'border:1px solid #e3b5b0;border-radius:8px;background:#fdf3f2}' +
      '.trp-box .trp-confirm p{margin:0 0 4px;font-size:13.5px;color:#222;font-weight:600;word-wrap:break-word}' +
      '.trp-box .trp-confirm p.trp-hint{font-weight:400;font-size:12.5px;color:#555;margin-bottom:8px}' +
      '.trp-actions{display:flex;flex-wrap:wrap;margin:0 -4px -4px 0}' +
      '.trp-actions button{min-height:44px;margin:0 4px 4px 0;padding:8px 14px;border-radius:8px;' +
        'font:inherit;font-size:13.5px;font-weight:600;cursor:pointer}' +
      '.trp-yes{background:#b03a2e;border:1px solid #b03a2e;color:#fff}' +
      '.trp-no{background:#fff;border:1px solid #b9c0c8;color:#333}' +
      '.trp-note{display:flex;flex-wrap:wrap;align-items:center;margin:0 0 12px;padding:6px 10px;border-radius:8px;' +
        'background:#eef7ee;border:1px solid #b9d8bd}' +
      '.trp-note.trp-error{background:#fdf3f2;border-color:#e3b5b0}' +
      '.trp-note.trp-quiet{margin:0;padding:0;border:0}' +
      '.trp-box p.trp-status{-webkit-box-flex:1;flex:1 1 160px;min-width:0;margin:4px 8px 4px 0;font-size:13px;' +
        'color:#245b2d;word-wrap:break-word;overflow-wrap:break-word}' +
      '.trp-note.trp-error p.trp-status{color:#8e2a20}' +
      '.trp-note.trp-quiet p.trp-status{margin:0}' +
      '.trp-undo{min-height:44px;padding:6px 14px;border:1px solid #55845b;border-radius:8px;background:#fff;' +
        'color:#245b2d;font:inherit;font-size:13.5px;font-weight:600;cursor:pointer}' +
      '.trp-undo[hidden]{display:none}' +
      '@media screen and (max-width:400px){.trp-overlay{padding:12px}.trp-box{padding:16px 14px}}' +
      '.trp-new{width:100%;min-height:44px;padding:10px 12px;border:1px dashed #8aa;border-radius:8px;' +
        'background:#fff;cursor:pointer;font:inherit;font-weight:600;color:#256}' +
      '.trp-new:hover{background:#f0fbff}' +
      'html body .trp-overlay .trp-box:focus{outline:none}' +
      /* Trefferflaeche >= 44 px Hoehe (vorher nur die Textzeile). */
      '.trp-home{display:block;margin-top:4px;padding:13px 0;text-align:center;font-size:12.5px;' +
        'line-height:18px;color:#667;text-decoration:none}' +
      '.trp-home:hover{text-decoration:underline}';
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
  }

  /* Gemeinsamer Renderer: existing = [{id, title, meta, updated}], id ist
     entweder BASE_ID (alter, unverzweigter Slot) oder ein ?id=-Suffix.
     otherCount = wie viele weitere gespeicherte Turniere (anderer Typen)
     zusätzlich auf der Startseite liegen – 0, wenn keine bekannt sind. */
  function render(existing, typeLabel, otherCount, base) {
    injectStyle();
    document.documentElement.classList.add('trp-wait');

    const overlay = document.createElement('div');
    overlay.className = 'trp-overlay';
    overlay.innerHTML =
      /* Kein aria-modal: der Hintergrund ist per visibility:hidden ohnehin
         unerreichbar, und die Android-Zurueck-Taste (turnier-native.js
         openDialog) soll hier weiterhin normal zurueck navigieren. */
      '<div class="trp-box" role="dialog" aria-labelledby="trp-title" tabindex="-1">' +
        '<h2 id="trp-title">' + esc(tx('picker.title', 'Welches Turnier?')) + '</h2>' +
        '<p>' + esc(tx('picker.intro', 'Für „{type}“ liegen bereits gespeicherte Turniere vor. ' +
          'Welches möchtest du weiterbearbeiten?', { type: typeLabel ? term(typeLabel) : tx('picker.thisSheet', 'diesen Bogen') })) + '</p>' +
        '<div class="trp-list"></div>' +
        '<div class="trp-note">' +
          '<p class="trp-status" role="status" aria-live="polite" aria-atomic="true"></p>' +
          '<button type="button" class="trp-undo" hidden>' + esc(tx('picker.undo', 'Rückgängig')) + '</button>' +
        '</div>' +
        '<button type="button" class="trp-new">' + esc(tx('picker.new', '＋ Neues Turnier starten')) + '</button>' +
        '<a href="index.html" class="trp-home">' + esc(tx('picker.home', '← Zur Startseite')) +
          (otherCount > 0 ? esc(tx('picker.homeOthers', { one: ' (dort 1 weiteres gespeichertes Turnier)',
            other: ' (dort {count} weitere gespeicherte Turniere)' }, { count: otherCount })) : '') +
        '</a>' +
      '</div>';

    const box = overlay.querySelector('.trp-box');
    const list = overlay.querySelector('.trp-list');
    const status = overlay.querySelector('.trp-status');
    const note = overlay.querySelector('.trp-note');
    const undoBtn = overlay.querySelector('.trp-undo');
    let undoKey = null;
    let undoName = '';
    let undoTimer = null;
    let entries = existing.slice();
    let others = otherCount;
    let busy = false;

    function titleOf(e) { return e.title || tx('picker.untitled', 'Turnier ohne Titel'); }
    function sorted() { return entries.slice().sort((a, b) => b.updated - a.updated); }
    function setStatus(text, isError) {
      note.className = 'trp-note' + (isError ? ' trp-error' : '') + (text ? '' : ' trp-quiet');
      status.textContent = text || '';
    }
    function hideUndo() {
      clearTimeout(undoTimer);
      undoKey = null;
      undoBtn.hidden = true;
    }
    /* Wie auf der Startseite: Rückgängig 15 s anbieten, danach die
       temporäre Sicherung entfernen (sonst räumt die Startseite sie auf). */
    function offerUndo(key, name) {
      hideUndo();
      if (!key) return;
      undoKey = key;
      undoName = name;
      undoBtn.hidden = false;
      const ttl = Number(root.TStore.UNDO_DELETE_MS) || 15000;
      undoTimer = setTimeout(function () {
        if (undoKey !== key || busy) return;
        hideUndo();
        try { Promise.resolve(root.TStore.removeItem(key)).then(null, () => { }); } catch (e) { }
      }, ttl);
    }
    setStatus('');
    function setBusy(on) {
      busy = on;
      if (on) box.setAttribute('aria-busy', 'true'); else box.removeAttribute('aria-busy');
      Array.prototype.forEach.call(box.querySelectorAll('button'), b => { b.disabled = on; });
      if (on) box.querySelector('.trp-home').setAttribute('aria-disabled', 'true');
      else box.querySelector('.trp-home').removeAttribute('aria-disabled');
    }
    function closeConfirm() {
      Array.prototype.forEach.call(list.querySelectorAll('.trp-confirm'), c => {
        const del = c.parentNode.querySelector('.trp-del');
        if (del) del.setAttribute('aria-expanded', 'false');
        c.parentNode.removeChild(c);
      });
    }
    function updateTexts() {
      const intro = box.querySelector('p');
      const type = typeLabel ? term(typeLabel) : tx('picker.thisSheet', 'diesen Bogen');
      if (!entries.length) {
        intro.textContent = tx('picker.empty', 'Für „{type}“ sind keine gespeicherten Turniere mehr vorhanden.', { type: type });
      }
      const home = box.querySelector('.trp-home');
      home.textContent = tx('picker.home', '← Zur Startseite') +
        (others > 0 ? tx('picker.homeOthers', { one: ' (dort 1 weiteres gespeichertes Turnier)',
          other: ' (dort {count} weitere gespeicherte Turniere)' }, { count: others }) : '');
    }

    function openConfirm(row, e) {
      if (busy) return;
      const del = row.querySelector('.trp-del');
      const wasOpen = !!row.querySelector('.trp-confirm');
      closeConfirm();
      if (wasOpen) { del.focus(); return; }
      const panel = document.createElement('div');
      const qid = 'trp-q-' + Math.random().toString(36).slice(2, 8);
      panel.className = 'trp-confirm';
      panel.setAttribute('role', 'group');
      panel.setAttribute('aria-labelledby', qid);
      panel.innerHTML =
        '<p id="' + qid + '">' + esc(tx('picker.deleteConfirm', '„{title}“ von diesem Gerät löschen?', { title: titleOf(e) })) + '</p>' +
        '<p class="trp-hint">' + esc(tx('picker.deleteHint', 'Nur der lokale Stand wird entfernt. Ein veröffentlichter Serverstand und archivierte Stände bleiben erhalten.')) + '</p>' +
        '<div class="trp-actions">' +
          '<button type="button" class="trp-yes">' + esc(tx('picker.deleteYes', 'Löschen')) + '</button>' +
          '<button type="button" class="trp-no">' + esc(tx('picker.deleteNo', 'Abbrechen')) + '</button>' +
        '</div>';
      panel.querySelector('.trp-no').addEventListener('click', function () {
        if (busy) return;
        closeConfirm();
        del.focus();
      });
      panel.querySelector('.trp-yes').addEventListener('click', function () { remove(e); });
      panel.addEventListener('keydown', function (ev) {
        if ((ev.key === 'Escape' || ev.key === 'Esc' || ev.keyCode === 27) && !busy) {
          ev.preventDefault();
          closeConfirm();
          del.focus();
        }
      });
      row.appendChild(panel);
      del.setAttribute('aria-expanded', 'true');
      setStatus('');
      /* Sicherer Standard: der Fokus landet auf „Abbrechen“. */
      panel.querySelector('.trp-no').focus();
    }

    function renderRows(focusIndex) {
      list.innerHTML = '';
      const rows = sorted();
      /* Leerer Zustand: die Einleitung nennt ihn (updateTexts); „Neues
         Turnier“ und „Zur Startseite“ bleiben die einzigen Aktionen. */
      list.style.display = rows.length ? '' : 'none';
      rows.forEach(e => {
        const wrap = document.createElement('div');
        wrap.className = 'trp-row';
        wrap.setAttribute('data-sheet', e.sheet);
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'trp-item';
        row.innerHTML =
          '<span class="trp-title">' + esc(titleOf(e)) + '</span>' +
          '<span class="trp-meta">' + esc(e.meta) + '</span>';
        row.addEventListener('click', function () { if (!busy) gotoId(e); });
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'trp-del';
        const label = tx('picker.delete', '„{title}“ löschen', { title: titleOf(e) });
        del.setAttribute('aria-label', label);
        del.setAttribute('aria-expanded', 'false');
        del.title = label;
        del.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" ' +
          'stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6' +
          'M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>';
        del.addEventListener('click', function () { openConfirm(wrap, e); });
        wrap.appendChild(row);
        wrap.appendChild(del);
        list.appendChild(wrap);
      });
      updateTexts();
      if (focusIndex == null) return;
      const items = list.querySelectorAll('.trp-item');
      const target = items.length ? items[Math.min(focusIndex, items.length - 1)] : box.querySelector('.trp-new');
      try { target.focus(); } catch (err) { }
    }

    /* Liste aus dem aktuellen Index neu aufbauen (auch für Änderungen aus
       anderen Tabs). → Promise<idx> */
    function reload(focusIndex) {
      return readIndex().then(res => {
        const idx = res.idx;
        entries = listFromIndex(idx, base, res.tokens);
        others = Math.max(0, countAllSaved(idx) - entries.length);
        renderRows(focusIndex);
        return idx;
      });
    }

    function focusRow(sheet, part) {
      const row = list.querySelector('.trp-row[data-sheet="' + String(sheet).replace(/["\\]/g, '') + '"] ' + part);
      try { (row || box.querySelector('.trp-new')).focus(); } catch (err) { }
    }

    function remove(e) {
      if (busy) return;
      const S = root.TStore;
      const pos = sorted().indexOf(e);
      const name = titleOf(e);
      hideUndo();
      setBusy(true);
      setStatus(tx('picker.deleting', '„{title}“ wird gelöscht …', { title: name }));
      function failed() {
        setBusy(false);
        closeConfirm();
        setStatus(tx('picker.deleteFailed', '„{title}“ konnte nicht gelöscht werden. Es wurde nichts geändert.', { title: name }), true);
        focusRow(e.sheet, '.trp-del');
      }
      Promise.resolve().then(() => {
        if (!S || typeof S.transaction !== 'function' || typeof S.deleteEntriesInView !== 'function'
            || e.token === undefined) throw new Error('unavailable');
        /* Prüfen + Sichern + Löschen atomar in EINER Transaktion. */
        return S.transaction(view => S.deleteEntriesInView(view, [{ key: 'store:' + e.sheet, expect: e.token }]),
          { sheetId: e.sheet, report: false });
      }).then(res => {
        setBusy(false);
        if (!res || !res.ok) {
          if (!res || res.code !== 'conflict') return failed();
          return reload(null).then(() => {
            setStatus(tx('picker.deleteConflict', '„{title}“ wurde inzwischen in einem anderen Fenster geändert. Die Liste ist aktualisiert; es wurde nichts gelöscht.', { title: name }), true);
            focusRow(e.sheet, '.trp-item');
          });
        }
        entries = entries.filter(x => x !== e);
        setStatus(tx('picker.deleted', '„{title}“ wurde von diesem Gerät gelöscht.', { title: name }));
        offerUndo(res.undoKey, name);
        return reload(pos).then(null, () => { renderRows(pos); });
      }).then(null, failed);
    }

    function undo() {
      if (busy || !undoKey) return;
      const S = root.TStore;
      const key = undoKey;
      const name = undoName;
      clearTimeout(undoTimer);
      setBusy(true);
      function done(text, isError, sheet) {
        setBusy(false);
        setStatus(text, isError);
        if (sheet) focusRow(sheet, '.trp-item');
        else try { (undoBtn.hidden ? box.querySelector('.trp-new') : undoBtn).focus(); } catch (err) { }
      }
      function message(code) {
        if (code === 'undo-conflict') return tx('picker.undoConflict', '„{title}“ wurde inzwischen neu angelegt; es wurde nichts wiederhergestellt.', { title: name });
        if (code === 'undo-expired' || code === 'undo-corrupt') return tx('picker.undoExpired', 'Rückgängig ist nicht mehr möglich: Die Sicherung ist abgelaufen oder fehlt.');
        return tx('picker.undoFailed', 'Rückgängig fehlgeschlagen. Es wurde nichts geändert.');
      }
      S.transaction(view => S.undoDeleteInView(view, key), { report: false }).then(res => {
        if (!res || !res.ok) {
          hideUndo();
          return reload(null).then(null, () => { }).then(() => done(message(res && res.code), true));
        }
        hideUndo();
        return reload(null).then(null, () => { }).then(() =>
          done(tx('picker.restored', '„{title}“ wurde wiederhergestellt.', { title: name }), false, res.sheets[0]));
      }, () => {
        /* Speicherfehler: nichts geändert, Sicherung bleibt – erneut anbieten. */
        offerUndo(key, name);
        done(message('failed'), true);
      });
    }
    undoBtn.addEventListener('click', undo);

    renderRows(null);
    overlay.querySelector('.trp-new').addEventListener('click', function () { if (!busy) gotoId(freshId()); });
    overlay.querySelector('.trp-home').addEventListener('click', function (ev) {
      if (busy) { ev.preventDefault(); return; }
      allowLeave();
    });

    document.body.appendChild(overlay);
    /* Fokus in die Auswahl: Screenreader lesen Titel/Frage, Tab beginnt
       bei der ersten Zeile statt im (verborgenen) Bogen. */
    try { overlay.querySelector('.trp-box').focus(); } catch (e) { }
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
  /* Übergabe einer Rangliste ("Finalrunde spielen", #rankimport=) startet
     immer ein NEUES Turnier – keine Auswahl, autoId() vergibt eine frische
     ?id=, damit kein gespeichertes Turnier überschrieben wird. */
  function isRankImport() {
    return String(location.hash || '').indexOf('rankimport=') >= 0;
  }

  /* → Promise<boolean>; rejected nie. Während der (asynchronen) Index-Abfrage
     bleibt die Seite verdeckt (trp-wait), damit kein falscher Bogen
     aufblitzt; bei false/Fehler wird sie wieder freigegeben. */
  function maybePrompt(base, typeLabel) {
    let waiting = false;
    function release() {
      if (!waiting) return;
      waiting = false;
      try { document.documentElement.classList.remove('trp-wait'); } catch (e) { }
    }
    try {
      if (alreadyResolved() || isRankImport()) return Promise.resolve(false);
      const TStore = root.TStore;
      if (!TStore || typeof TStore.index !== 'function') return Promise.resolve(false);
      try {
        injectStyle();
        document.documentElement.classList.add('trp-wait');
        waiting = true;
      } catch (e) { waiting = false; }
      return readIndex().then(res => {
        const idx = res.idx;
        const existing = listFromIndex(idx, base, res.tokens);
        if (!existing.length) { release(); return false; }
        render(existing, typeLabel, Math.max(0, countAllSaved(idx) - existing.length), base);
        waiting = false;
        return true;
      }).then(null, () => { release(); return false; });
    } catch (e) {
      release();
      return Promise.resolve(false);
    }
  }

  /* Aufruf NUR, wenn maybePrompt() zuvor false
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

  const api = { BASE_ID, maybePrompt, autoId, listFromStore, listFromIndex };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TResumePicker = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
