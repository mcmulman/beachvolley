/* ============================================================================
   turnier-share.js – Turnier per Link teilen (zwei Varianten)

   1) SERVER-LINK (Standard, empfohlen): Der Turnierstand wird an ein eigenes
      PHP/MySQL-Backend gesendet (siehe backend/README.md) und dort
      verschlüsselt gespeichert. Der Link enthält nur eine kurze ID:
        Turnierbogen_XY.html#share=<kurze ID>
      Vorteil: kurzer Link, Admin kann Passwort/Zugriff zentral verwalten.
      Nachteil: zum Erstellen UND zum Öffnen ist Internet nötig.

   2) OFFLINE-LINK (optional, wie früher): Der komplette Turnierstand steckt
      Base64-kodiert direkt im Link selbst, hinter einem eigenen Präfix:
        Turnierbogen_XY.html#shareoffline=<Kopfdaten+Nutzdaten, Base64>
      Ein optionales Passwort verschlüsselt die Nutzdaten mit einem simplen,
      passwortabhängigen XOR-Bytestrom (deterministisch aus dem Passwort
      abgeleitet). WICHTIG: Das ist bewusst KEINE kryptografisch sichere
      Verschlüsselung, sondern nur eine Verschleierung – sie verhindert das
      zufällige Mitlesen des Links, schützt aber nicht vor gezieltem Knacken.
      Vorteil: funktioniert komplett ohne Server/Internet, auch unter file://.
      Nachteil: sehr lange Links, die manche Messenger/Browser kappen können.

   Der Nutzer wählt beim Teilen zwischen beiden Varianten. Empfangene Links
   werden anhand ihres Präfixes automatisch der richtigen Variante zugeordnet.

   Offline-/Datenverlust-Sicherheit (wichtig, bewusst so gebaut):
   - Das laufende Turnier lebt immer im localStorage (siehe turnier-store.js)
     und wird davon völlig unabhängig ganz normal weiter automatisch
     gespeichert - das Teilen ist rein "on top" und rührt den lokalen Stand
     NIE an, außer der Nutzer bestätigt aktiv die Übernahme eines *fremden*
     geteilten Turniers (und selbst dann wird der bisherige Stand vorher
     automatisch archiviert, siehe unlockLoop()/applyOfflineShare()).
   - Netzwerkfehler beim Erstellen/Öffnen eines SERVER-Links führen zu keinem
     Verlust: Es wird nichts geschrieben, bevor der Server erfolgreich
     geantwortet hat; ein per Link empfangener, aber (noch) nicht ladbarer
     Server-Link bleibt in der Adresszeile stehen (statt verworfen zu
     werden), damit ein erneutes Laden - z. B. sobald wieder Internet
     verfügbar ist - automatisch einen neuen Versuch startet.
   - Der OFFLINE-Link braucht dagegen gar keine Verbindung und funktioniert
     daher auch komplett ohne Internet (z. B. wenn kein Backend erreichbar
     ist oder rein clientseitig geteilt werden soll).

   Nutzeroberfläche: Ein eigenes, in dieser Datei selbst injiziertes
   Overlay/Modal (Styles + Markup werden bei Bedarf per JS erzeugt) - bewusst
   kein Rückgriff auf Browser-native prompt()/confirm()-Popups, damit sich
   das Teilen wie ein normaler Teil der App anfühlt (Passwortfeld, Radio-
   Auswahl, Kopieren-Button, Fehler mit "Erneut versuchen" direkt im Dialog).
   ========================================================================== */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TShare = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* Adresse des eigenen Backends (siehe backend/README.md für das Deployment).
     Muss https:// sein - hier laufen Passwörter/Turnierdaten durch. */
  const API_BASE = 'https://beachvolley.klickdienst-server.de/api';

  const SERVER_PREFIX = '#share=';
  const OFFLINE_PREFIX = '#shareoffline=';
  const MAX_PW_TRIES = 3;
  const REQUEST_TIMEOUT_MS = 10000; // vermeidet endloses "Hängen" bei totem Netz
  const LONG_URL_WARN = 6000; // Warnschwelle beim Offline-Link (Messenger/Browser könnten kappen)

  /* ============================================================ Server-API
     network:true markiert Fehler, bei denen der Server gar nicht erreicht
     wurde (offline, Timeout, DNS, CORS) - im Unterschied zu einer regulären
     Fehlerantwort vom Server (z. B. 404/401). Wird genutzt, um zu
     entscheiden, ob ein empfangener Link verworfen werden darf oder ob er
     für einen späteren, erneuten Versuch erhalten bleiben soll. */
  async function request(path, opts) {
    const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS) : null;
    let res;
    try {
      res = await fetch(API_BASE + path, Object.assign({}, opts, ctrl ? { signal: ctrl.signal } : {}));
    } catch (e) {
      const err = new Error(
        (e && e.name === 'AbortError')
          ? 'Zeitüberschreitung - der Server hat nicht rechtzeitig geantwortet.'
          : 'Keine Verbindung zum Server (offline oder nicht erreichbar).'
      );
      err.network = true;
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
    }
    let data = null;
    try { data = await res.json(); } catch (e) { /* leere/kaputte Antwort */ }
    if (!res.ok) {
      const err = new Error((data && data.message) || ('Serverfehler (' + res.status + ')'));
      err.code = data && data.error;
      err.status = res.status;
      throw err;
    }
    return data;
  }
  function apiGet(path) { return request(path, { method: 'GET' }); }
  function apiPost(path, body) {
    return request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
  }

  function buildServerShareUrl(id) {
    const url = new URL(location.href);
    url.hash = '';
    return url.toString() + SERVER_PREFIX + encodeURIComponent(id);
  }

  /* =================================================== Offline-Kodierung
     Bytes/Text-Helfer + Passwort-Bytestrom (XOR): FNV-1a als Startwert,
     mulberry32 als schneller, deterministischer PRNG - beide bewusst simpel
     gehalten (siehe Kopfkommentar: nur Verschleierung, keine echte Krypto). */
  function strToBytes(s) { return new TextEncoder().encode(s); }
  function bytesToStr(b) { return new TextDecoder().decode(b); }
  function bytesToBase64Url(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }
  function base64UrlToBytes(b64) {
    let s = String(b64 || '').replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function seedFromPassword(pw) {
    let h = 0x811c9dc5;
    const s = String(pw || '');
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0) || 1;
  }
  function mulberry32(seed) {
    let a = seed;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function xorWithPassword(bytes, password) {
    const rnd = mulberry32(seedFromPassword(password));
    const out = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) out[i] = bytes[i] ^ Math.floor(rnd() * 256);
    return out;
  }

  /* Envelope = Klartext-Kopf (Titel/Typ/Teams für die Vorschau) + payload:
     unverschlüsseltes oder XOR-verschleiertes JSON des Snapshots. */
  function offlineEncode(opts, password) {
    const snapshotJson = JSON.stringify(opts.snapshot || {});
    let payload, enc;
    if (password) {
      payload = bytesToBase64Url(xorWithPassword(strToBytes(snapshotJson), password));
      enc = true;
    } else {
      payload = snapshotJson;
      enc = false;
    }
    const envelope = {
      v: 1,
      sheet: opts.sheet || '',
      type: opts.type || '',
      title: opts.title || '',
      teams: Array.isArray(opts.teams) ? opts.teams : [],
      ts: Date.now(),
      enc: enc,
      payload: payload
    };
    return bytesToBase64Url(strToBytes(JSON.stringify(envelope)));
  }

  function offlineDecodeEnvelope(hashValue) {
    try {
      const json = bytesToStr(base64UrlToBytes(hashValue));
      const env = JSON.parse(json);
      if (!env || env.v !== 1 || typeof env.payload !== 'string') return null;
      return env;
    } catch (e) { return null; }
  }

  /* Entschlüsselt/parst die Nutzdaten eines Offline-Envelopes. Wirft bei
     falschem Passwort oder beschädigten Daten (JSON.parse schlägt fehl). */
  function offlineResolveSnapshot(env, password) {
    let json;
    if (env.enc) {
      const bytes = xorWithPassword(base64UrlToBytes(env.payload), password || '');
      json = bytesToStr(bytes);
    } else {
      json = env.payload;
    }
    return JSON.parse(json); // wirft bei falschem Passwort/kaputten Daten
  }

  function buildOfflineShareUrl(opts, password) {
    const hash = OFFLINE_PREFIX + offlineEncode(opts, password);
    const url = new URL(location.href);
    url.hash = '';
    return url.toString() + hash;
  }

  /* ================================================================== Hash
     Erkennt, welche der beiden Linkvarianten (falls überhaupt eine) in der
     aktuellen Adresszeile steckt. */
  function readPendingHash() {
    const raw = String(location.hash || '');
    if (raw.indexOf(SERVER_PREFIX) === 0) {
      return { kind: 'server', value: decodeURIComponent(raw.slice(SERVER_PREFIX.length)) };
    }
    if (raw.indexOf(OFFLINE_PREFIX) === 0) {
      return { kind: 'offline', value: raw.slice(OFFLINE_PREFIX.length) };
    }
    return null;
  }

  function clearHash() {
    try {
      const url = new URL(location.href);
      url.hash = '';
      history.replaceState(null, '', url.pathname + (url.search || ''));
    } catch (e) { }
  }

  /* ============================================================ Overlay-UI
     Minimales, selbst-injiziertes Modal (kein externes Modal-System nötig).
     Wird bei jedem Öffnen neu aufgebaut (bestehendes Overlay wird vorher
     entfernt), damit kein Zustand zwischen den Schritten hängen bleibt. */
  const MODAL_ID = 'tshare-overlay-root';

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function ensureShareStyles() {
    if (document.getElementById('tshare-style')) return;
    const style = document.createElement('style');
    style.id = 'tshare-style';
    style.textContent =
      '.tshare-backdrop{position:fixed;inset:0;z-index:10000;background:rgba(20,30,45,.55);' +
        'display:flex;align-items:center;justify-content:center;padding:16px;' +
        '-webkit-backdrop-filter:blur(2px);backdrop-filter:blur(2px);}' +
      '@media print{.tshare-backdrop{display:none !important;}}' +
      '.tshare-panel{background:#fff;color:#1a1a2e;width:100%;max-width:440px;border-radius:14px;' +
        'box-shadow:0 12px 40px rgba(0,0,0,.28);max-height:90vh;overflow:auto;' +
        'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;}' +
      '.tshare-head{display:flex;align-items:center;justify-content:space-between;gap:12px;' +
        'padding:16px 18px;border-bottom:1px solid #e2e8f0;}' +
      '.tshare-head h3{margin:0;font-size:16px;font-weight:800;color:#1a3a5c;}' +
      '.tshare-x{border:none;background:none;font-size:22px;line-height:1;color:#5a6375;cursor:pointer;padding:2px 6px;border-radius:6px;}' +
      '.tshare-x:hover{background:#eef2f7;}' +
      '.tshare-body{padding:16px 18px;font-size:14px;line-height:1.5;}' +
      '.tshare-body p{margin:0 0 10px;color:#3a4356;}' +
      '.tshare-hint{font-size:12.5px;color:#5a6375;}' +
      '.tshare-error{color:#b3261e;font-weight:600;}' +
      '.tshare-options{display:flex;flex-direction:column;gap:10px;margin-bottom:14px;}' +
      '.tshare-opt{display:flex;gap:10px;align-items:flex-start;border:1.5px solid #ccd8e8;' +
        'border-radius:10px;padding:10px 12px;cursor:pointer;}' +
      '.tshare-opt:has(input:checked){border-color:#1f6fa8;background:#e8f3fb;}' +
      '.tshare-opt input{margin-top:3px;flex:0 0 auto;}' +
      '.tshare-opt strong{display:block;font-size:13.5px;color:#1a1a2e;}' +
      '.tshare-opt em{font-style:normal;color:#0a7d2c;font-size:11.5px;font-weight:700;margin-left:4px;}' +
      '.tshare-opt small{display:block;color:#5a6375;font-size:12px;margin-top:2px;}' +
      '.tshare-field{display:block;font-size:12.5px;font-weight:700;color:#3a4356;margin-bottom:14px;}' +
      '.tshare-field input{display:block;width:100%;margin-top:6px;padding:10px 12px;font-size:14px;' +
        'border:1.5px solid #ccd8e8;border-radius:9px;background:#f3f6fa;box-sizing:border-box;}' +
      '.tshare-field input:focus{outline:none;border-color:#1f6fa8;background:#fff;}' +
      '.tshare-linkrow{display:flex;gap:8px;margin-bottom:8px;}' +
      '.tshare-linkrow input{flex:1;min-width:0;padding:9px 10px;font-size:12.5px;border:1.5px solid #ccd8e8;' +
        'border-radius:9px;background:#f3f6fa;box-sizing:border-box;}' +
      '.tshare-copied{color:#0a7d2c;font-size:12.5px;font-weight:600;margin:0;}' +
      '.tshare-loading{display:flex;flex-direction:column;align-items:center;gap:14px;padding:14px 0 6px;color:#3a4356;}' +
      '.tshare-spinner{width:30px;height:30px;border-radius:50%;border:3px solid #ccd8e8;' +
        'border-top-color:#1f6fa8;animation:tshare-spin .8s linear infinite;}' +
      '@keyframes tshare-spin{to{transform:rotate(360deg);}}' +
      '.tshare-foot{display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap;' +
        'padding:14px 18px;border-top:1px solid #e2e8f0;}' +
      '.tshare-btn{border:none;border-radius:9px;padding:10px 16px;font-size:13.5px;font-weight:700;' +
        'cursor:pointer;white-space:nowrap;}' +
      '.tshare-btn-primary{background:#1a3a5c;color:#fff;}' +
      '.tshare-btn-primary:hover{background:#1f6fa8;}' +
      '.tshare-btn-ghost{background:none;color:#1a3a5c;border:1.5px solid #ccd8e8;}' +
      '.tshare-btn-ghost:hover{border-color:#1f6fa8;}';
    document.head.appendChild(style);
  }

  function onShareEscKey(e) { if (e.key === 'Escape') closeShareModal(); }

  function closeShareModal() {
    const el = document.getElementById(MODAL_ID);
    if (el) el.remove();
    document.removeEventListener('keydown', onShareEscKey);
  }

  /* Baut/ersetzt das Overlay-Grundgerüst und liefert das Root-Element zum
     Anhängen von Event-Handlern durch die jeweilige "Seite" (Formular,
     Ladeanzeige, Ergebnis, Fehler). */
  function openShareModalShell(title, bodyHtml, footerHtml) {
    closeShareModal();
    ensureShareStyles();
    const root = document.createElement('div');
    root.id = MODAL_ID;
    root.className = 'tshare-backdrop';
    root.innerHTML =
      '<div class="tshare-panel" role="dialog" aria-modal="true" aria-label="' + escapeHtml(title) + '">' +
      '<div class="tshare-head"><h3>' + escapeHtml(title) + '</h3>' +
      '<button type="button" class="tshare-x" aria-label="Schließen">&times;</button></div>' +
      '<div class="tshare-body">' + bodyHtml + '</div>' +
      (footerHtml ? '<div class="tshare-foot">' + footerHtml + '</div>' : '') +
      '</div>';
    document.body.appendChild(root);
    root.addEventListener('mousedown', function (e) { if (e.target === root) closeShareModal(); });
    root.querySelector('.tshare-x').addEventListener('click', closeShareModal);
    document.addEventListener('keydown', onShareEscKey);
    return root;
  }

  /* Generisches Info-/Bestätigungs-Overlay im gleichen visuellen Stil wie der
     Teilen-Dialog - für andere Aktionen im Bogen (z. B. "Finalrunde spielen"),
     bei denen ein natives confirm() zu wenig Platz für Erklärungen bietet.
     opts: { title, bodyHtml, confirmLabel, cancelLabel, onConfirm } */
  function openInfoDialog(opts) {
    opts = opts || {};
    const confirmLabel = opts.confirmLabel || 'Weiter';
    const cancelLabel = opts.cancelLabel || 'Abbrechen';
    const root = openShareModalShell(
      opts.title || '',
      opts.bodyHtml || '',
      '<button type="button" class="tshare-btn tshare-btn-ghost" data-act="cancel">' + escapeHtml(cancelLabel) + '</button>' +
      '<button type="button" class="tshare-btn tshare-btn-primary" data-act="confirm">' + escapeHtml(confirmLabel) + '</button>'
    );
    root.querySelector('[data-act="cancel"]').addEventListener('click', closeShareModal);
    root.querySelector('[data-act="confirm"]').addEventListener('click', function () {
      closeShareModal();
      if (typeof opts.onConfirm === 'function') opts.onConfirm();
    });
    return root;
  }

  function renderShareForm(o) {
    const root = openShareModalShell(
      'Turnier teilen',
      '<div class="tshare-options">' +
        '<label class="tshare-opt"><input type="radio" name="tshare-mode" value="server" checked>' +
        '<span><strong>Server-Link <em>Empfohlen</em></strong>' +
        '<small>Kurzer Link über den eigenen Server. Zum Erstellen &amp; Öffnen ist Internet nötig.</small></span>' +
        '</label>' +
        '<label class="tshare-opt"><input type="radio" name="tshare-mode" value="offline">' +
        '<span><strong>Offline-Link</strong>' +
        '<small>Enthält den kompletten Turnierstand direkt im Link. Funktioniert ohne Server/Internet, ist aber sehr lang.</small></span>' +
        '</label>' +
        '</div>' +
      '<label class="tshare-field">Passwort (optional)' +
        '<input type="password" id="tshare-pw" placeholder="Leer lassen für keinen Passwortschutz" autocomplete="new-password"></label>',
      '<button type="button" class="tshare-btn tshare-btn-ghost" data-act="cancel">Abbrechen</button>' +
      '<button type="button" class="tshare-btn tshare-btn-primary" data-act="create">Link erstellen</button>'
    );
    root.querySelector('[data-act="cancel"]').addEventListener('click', closeShareModal);
    root.querySelector('[data-act="create"]').addEventListener('click', function () {
      const mode = root.querySelector('input[name="tshare-mode"]:checked').value;
      const pw = root.querySelector('#tshare-pw').value || '';
      if (mode === 'server') {
        renderShareLoading();
        createServerShare(o, pw);
      } else {
        createOfflineShare(o, pw);
      }
    });
  }

  function renderShareLoading() {
    openShareModalShell('Turnier teilen',
      '<div class="tshare-loading"><div class="tshare-spinner"></div><p style="margin:0">Link wird erstellt…</p></div>', '');
  }

  function renderShareResult(url, pw, longWarnLen, code) {
    const root = openShareModalShell(
      'Link zum Teilen',
      '<p class="tshare-hint">Der Link enthält einen Snapshot des aktuellen Turnierstands. ' +
        'Spätere Änderungen sind erst in einem neuen Link sichtbar.' +
        (pw ? ' Mit Passwort geschützt – bitte separat mitteilen.' : '') + '</p>' +
        (longWarnLen ? '<p class="tshare-error">Hinweis: Der Link ist sehr lang (' + longWarnLen + ' Zeichen) und wird evtl. '
          + 'nicht von jedem Messenger/Browser vollständig übernommen. Bei Problemen: über den PC teilen '
          + 'oder den kürzeren Server-Link verwenden.</p>' : '') +
      '<label class="tshare-field" style="margin-bottom:8px">Link' +
      '<div class="tshare-linkrow"><input type="text" id="tshare-url" readonly>' +
      '<button type="button" class="tshare-btn tshare-btn-ghost" data-act="copy">Kopieren</button></div></label>' +
      (code
        ? '<label class="tshare-field">Code <small style="font-weight:400;color:#5a6375">(zum Eingeben auf der Startseite, statt den Link zu öffnen)</small>' +
          '<div class="tshare-linkrow"><input type="text" id="tshare-code" readonly>' +
          '<button type="button" class="tshare-btn tshare-btn-ghost" data-act="copy-code">Kopieren</button></div></label>'
        : '') +
      '<p class="tshare-copied" id="tshare-copied-msg" hidden>In die Zwischenablage kopiert ✓</p>',
      '<button type="button" class="tshare-btn tshare-btn-primary" data-act="done">Fertig</button>'
    );
    const urlInput = root.querySelector('#tshare-url');
    urlInput.value = url; // per JS statt HTML-Attribut, um Escaping-Probleme bei Sonderzeichen zu vermeiden
    const copiedMsg = root.querySelector('#tshare-copied-msg');
    function showCopied() { copiedMsg.hidden = false; }
    function copyText(text, fallbackEl) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(showCopied).catch(function () { fallbackCopy(fallbackEl); });
      } else {
        fallbackCopy(fallbackEl);
      }
    }
    function fallbackCopy(inputEl) {
      inputEl.focus(); inputEl.select();
      try { if (document.execCommand('copy')) showCopied(); } catch (e) { /* ignore */ }
    }
    root.querySelector('[data-act="copy"]').addEventListener('click', function () { copyText(url, urlInput); });
    if (code) {
      const codeInput = root.querySelector('#tshare-code');
      codeInput.value = code;
      root.querySelector('[data-act="copy-code"]').addEventListener('click', function () { copyText(code, codeInput); });
    }
    root.querySelector('[data-act="done"]').addEventListener('click', closeShareModal);
    copyText(url, urlInput); // gleich beim Öffnen automatisch den Link in die Zwischenablage legen (wie zuvor)
    urlInput.focus(); urlInput.select();
  }

  function renderShareError(message, cfg) {
    const c = cfg || {};
    const root = openShareModalShell(
      'Link konnte nicht erstellt werden',
      '<p class="tshare-error">' + escapeHtml(message) + '</p>' +
      '<p class="tshare-hint">Dein Turnier auf diesem Gerät ist davon nicht betroffen und weiterhin sicher gespeichert.</p>',
      '<button type="button" class="tshare-btn tshare-btn-ghost" data-act="cancel">Abbrechen</button>' +
      (c.showOfflineFallback ? '<button type="button" class="tshare-btn tshare-btn-ghost" data-act="offline">Offline-Link stattdessen</button>' : '') +
      '<button type="button" class="tshare-btn tshare-btn-primary" data-act="retry">Erneut versuchen</button>'
    );
    root.querySelector('[data-act="cancel"]').addEventListener('click', closeShareModal);
    root.querySelector('[data-act="retry"]').addEventListener('click', c.onRetry);
    if (c.showOfflineFallback) root.querySelector('[data-act="offline"]').addEventListener('click', c.onOfflineFallback);
  }

  /* ================================================================ Teilen
     Öffnet das Overlay zur Auswahl von Link-Art und Passwort.
     opts: dieselbe Form wie archiveOpts() in den Bögen
           ({ sheet, file, type, keys, title, teams, empty }). */
  function openShareDialog(opts) {
    const o = opts || {};
    if (o.empty) { alert('Dieses Turnier ist noch leer – es gibt noch nichts zu teilen.'); return; }
    renderShareForm(o);
  }

  /* -------------------------------------------------------- Server-Variante
     Wird bei einem Netzwerkfehler über den "Erneut versuchen"-Button im
     Overlay erneut aufgerufen, ohne das Passwort nochmal abzufragen - der
     Nutzer muss bei wackliger Verbindung nicht von vorn anfangen. */
  function createServerShare(o, pw) {
    // Der Snapshot wird bei jedem Versuch frisch gelesen, damit auch ein
    // "Erneut versuchen" nach längerem Warten den aktuellsten Stand teilt.
    const snapshot = (typeof TArchive !== 'undefined') ? TArchive.snapshot(o.keys) : {};

    apiPost('/share.php?action=create', {
      sheet: o.sheet || '', file: o.file || '', type: o.type || '',
      title: o.title || '', teams: Array.isArray(o.teams) ? o.teams : [],
      snapshot: snapshot, password: pw || ''
    }).then(function (data) {
      renderShareResult(buildServerShareUrl(data.id), pw, null, data.id);
    }).catch(function (err) {
      // Es wurde nichts gespeichert - das laufende Turnier ist unberührt.
      const msg = err.network
        ? ('Der Link konnte nicht erstellt werden: ' + err.message)
        : ('Der Link konnte nicht erstellt werden (Serverfehler): ' + err.message);
      renderShareError(msg, {
        showOfflineFallback: true,
        onRetry: function () { renderShareLoading(); createServerShare(o, pw); },
        onOfflineFallback: function () { createOfflineShare(o, pw); }
      });
    });
  }

  /* ------------------------------------------------------- Offline-Variante
     Rein clientseitig, funktioniert ohne Server/Internet. */
  function createOfflineShare(o, pw) {
    const snapshot = (typeof TArchive !== 'undefined') ? TArchive.snapshot(o.keys) : {};
    const url = buildOfflineShareUrl({
      sheet: o.sheet, type: o.type, title: o.title, teams: o.teams, snapshot: snapshot
    }, pw || null);
    renderShareResult(url, pw, url.length > LONG_URL_WARN ? url.length : null);
  }

  /* ========================================================== Übernehmen
     Prüft/übernimmt einen per Link empfangenen Turnierstand, falls die
     Adresszeile #share=… oder #shareoffline=… enthält. Analog zu
     TArchive.applyPendingRestore(): archiviert zuerst den aktuellen Stand,
     schreibt dann den Snapshot in den laufenden Speicherplatz und lädt neu.
     opts: archiveOpts() des Bogens (für das Sichern des bisherigen Standes). */
  function applyPendingShare(opts) {
    const pending = readPendingHash();
    if (!pending) return false;

    if (pending.kind === 'offline') return applyOfflineShare(pending.value, opts);
    return applyServerShare(pending.value, opts);
  }

  function applyServerShare(id, opts) {
    apiGet('/share.php?id=' + encodeURIComponent(id)).then(function (env) {
      if (opts && opts.sheet && env.sheet && env.sheet !== opts.sheet) {
        clearHash();
        alert('Dieser Link gehört zu einem anderen Turnierbogen und kann hier nicht übernommen werden.');
        return;
      }
      const info = (env.title || env.type || 'Turnier')
        + (env.teams && env.teams.length ? ' (' + env.teams.join(', ') + ')' : '');
      serverUnlockLoop(id, env, info, opts, 0);
    }).catch(function (err) {
      if (err.network) {
        // Link bleibt bewusst stehen: Dein Turnier auf diesem Gerät bleibt
        // unverändert; ein Neuladen der Seite versucht es automatisch
        // erneut, z. B. sobald wieder eine Internetverbindung besteht.
        alert(
          'Der geteilte Turnierlink konnte gerade nicht geladen werden:\n' + err.message
          + '\n\nDein aktuelles Turnier auf diesem Gerät ist davon nicht betroffen.'
          + ' Bitte Internetverbindung prüfen und die Seite neu laden, um es erneut zu versuchen.'
        );
        return;
      }
      clearHash();
      if (err.status === 404) alert('Der Link enthält keine gültigen Turnierdaten (oder wurde bereits gelöscht).');
      else alert('Das geteilte Turnier konnte nicht geladen werden (Serverfehler):\n' + err.message);
    });
    return true;
  }

  function serverUnlockLoop(id, env, info, opts, tries) {
    let pw = '';
    if (env.protected) {
      pw = prompt('Geteiltes Turnier "' + info + '" ist passwortgeschützt.\nBitte Passwort eingeben:', '');
      if (pw === null) { clearHash(); return; } // abgebrochen
    }

    apiPost('/share.php?action=unlock', { id: id, password: pw }).then(function (full) {
      confirmAndApplySnapshot(info, full.snapshot, opts);
    }).catch(function (err) {
      if (err.network) {
        // Link bleibt stehen, kein lokaler Datenverlust - siehe Kommentar
        // in applyServerShare(). Der Nutzer kann die Seite neu laden,
        // sobald wieder eine Verbindung besteht.
        alert(
          'Konnte den Server gerade nicht erreichen:\n' + err.message
          + '\n\nDein aktuelles Turnier auf diesem Gerät ist davon nicht betroffen.'
          + ' Bitte Internetverbindung prüfen und die Seite neu laden.'
        );
        return;
      }
      if (err.code === 'wrong_password' && tries + 1 < MAX_PW_TRIES) {
        alert('Falsches Passwort, bitte erneut versuchen.');
        serverUnlockLoop(id, env, info, opts, tries + 1);
        return;
      }
      clearHash();
      if (err.code === 'wrong_password') alert('Falsches Passwort – Übernahme abgebrochen.');
      else if (err.code === 'too_many_attempts') alert('Zu viele Versuche – bitte später erneut versuchen.');
      else alert('Das geteilte Turnier konnte nicht geladen werden:\n' + err.message);
    });
  }

  function applyOfflineShare(hashValue, opts) {
    const env = offlineDecodeEnvelope(hashValue);
    if (!env) { clearHash(); alert('Der Link enthält keine gültigen Turnierdaten.'); return false; }
    if (opts && opts.sheet && env.sheet && env.sheet !== opts.sheet) {
      clearHash();
      alert('Dieser Link gehört zu einem anderen Turnierbogen und kann hier nicht übernommen werden.');
      return false;
    }

    const info = (env.title || env.type || 'Turnier')
      + (env.teams && env.teams.length ? ' (' + env.teams.join(', ') + ')' : '');

    let snapshot = null, tries = 0;
    while (snapshot == null) {
      let pw = '';
      if (env.enc) {
        pw = prompt('Geteiltes Turnier "' + info + '" ist passwortgeschützt.\nBitte Passwort eingeben:', '');
        if (pw === null) { clearHash(); return false; } // abgebrochen
      }
      try { snapshot = offlineResolveSnapshot(env, pw); }
      catch (e) {
        tries++;
        if (!env.enc || tries >= MAX_PW_TRIES) {
          clearHash();
          alert(env.enc ? 'Falsches Passwort – Übernahme abgebrochen.' : 'Der Link enthält keine gültigen Turnierdaten.');
          return false;
        }
        alert('Falsches Passwort, bitte erneut versuchen.');
      }
    }

    confirmAndApplySnapshot(info, snapshot, opts);
    return true;
  }

  /* Gemeinsamer letzter Schritt beider Varianten: Nutzer bestätigen lassen,
     bisherigen Stand sichern, geteilten Snapshot übernehmen, neu laden. */
  function confirmAndApplySnapshot(info, snapshot, opts) {
    const ok = confirm(
      'Geteiltes Turnier gefunden: "' + info + '".\n\n'
      + 'Übernehmen? Das aktuelle Turnier auf diesem Gerät wird vorher automatisch\n'
      + 'gesichert und bleibt über die Startseite abrufbar.'
    );
    if (!ok) { clearHash(); return; }

    if (typeof TArchive !== 'undefined') {
      TArchive.save(opts);              // bisherigen Stand sichern (No-op, falls leer)
      TArchive.writeSnapshot(snapshot);  // geteilten Stand in den laufenden Speicherplatz schreiben
    }
    clearHash();
    location.reload();
  }

  /* ============================================================ Code-Eingabe
     Für die Startseite: Nutzer kann statt (oder zusätzlich zu) dem Klick auf
     einen Link auch nur die kurze Server-ID eingeben ("Code"), z. B. wenn der
     Link per Telefon durchgegeben wurde. Akzeptiert wahlweise den nackten
     Code oder einen kompletten eingefügten Link/Hash - beides wird auf die
     reine ID reduziert. Löst dann über die Vorschau (GET, ohne Passwort) auf,
     zu welcher Bogen-Datei der Code gehört, und leitet dorthin weiter; die
     eigentliche Übernahme (inkl. Passwortabfrage/Bestätigung) übernimmt danach
     ganz normal applyPendingShare() auf der Zielseite. */
  function extractServerCode(input) {
    let s = String(input || '').trim();
    if (!s) return '';
    const idx = s.indexOf(SERVER_PREFIX);
    if (idx !== -1) s = s.slice(idx + SERVER_PREFIX.length);
    s = s.replace(/^#/, '');
    try { s = decodeURIComponent(s); } catch (e) { /* schon dekodiert */ }
    return s.trim();
  }

  function openByCode(input) {
    const id = extractServerCode(input);
    if (!id) { alert('Bitte einen gültigen Code oder Link eingeben.'); return; }

    apiGet('/share.php?id=' + encodeURIComponent(id)).then(function (env) {
      const file = env && env.file;
      if (!file) {
        alert('Zu diesem Code konnte keine passende Turnierseite gefunden werden.');
        return;
      }
      location.href = file + SERVER_PREFIX + encodeURIComponent(id);
    }).catch(function (err) {
      if (err.network) {
        alert('Der Code konnte gerade nicht überprüft werden:\n' + err.message
          + '\n\nBitte Internetverbindung prüfen und erneut versuchen.');
        return;
      }
      if (err.status === 404) alert('Dieser Code ist ungültig oder das Turnier wurde bereits gelöscht.');
      else alert('Der Code konnte nicht geladen werden (Serverfehler):\n' + err.message);
    });
  }

  return {
    buildShareUrl: buildServerShareUrl, openShareDialog, applyPendingShare, openByCode, openInfoDialog
  };
});
