/* ============================================================================
   turnier-share.js – dauerhafte Serverturniere und unabhängige Offline-Links

   1) SERVER-LINK (Standard, empfohlen): Der Turnierstand wird an ein eigenes
      PHP/MySQL-Backend gesendet (siehe backend/README.md) und dort
      verschlüsselt gespeichert. Der Link enthält nur eine kurze ID:
        Turnierbogen_XY.html#share=<kurze ID>
      Weitere Veröffentlichungen derselben Instanz aktualisieren denselben
      Code mit getrennter Bearbeitungsberechtigung und atomarer Serverrevision.
      Öffentliche Empfänger lesen nur; Rechteübertrag ist explizit geheim.
      Vorteil: kurzer Link, Admin kann Passwort/Zugriff zentral verwalten.
      Nachteil: zum Erstellen UND zum Öffnen ist Internet nötig.

   2) OFFLINE-LINK (optional): Der komplette Turnierstand steckt Base64-kodiert
      direkt im Link selbst, hinter einem eigenen Präfix:
        Turnierbogen_XY.html#shareoffline=<Kopfdaten+Nutzdaten, Base64>
      Ein optionales Passwort schützt die Nutzdaten mit PBKDF2-SHA256 und
      AES-256-GCM (v2, zufälliges Salt/Nonce, authentifizierte Kopfdaten).
      Vorteil: funktioniert ohne Server/Internet. Passwortschutz benötigt
      WebCrypto in einem sicheren Kontext (HTTPS/localhost, native App).
      Nachteil: sehr lange Links, die manche Messenger/Browser kappen können.

   Der Nutzer wählt beim Teilen zwischen beiden Varianten. Empfangene Links
   werden anhand ihres Präfixes automatisch der richtigen Variante zugeordnet.

   Offline-/Datenverlust-Sicherheit (wichtig, bewusst so gebaut):
   - Das laufende Turnier lebt immer in IndexedDB (siehe turnier-store.js)
     und wird davon völlig unabhängig ganz normal weiter automatisch
     gespeichert - das Teilen ist rein "on top" und rührt den lokalen Stand
     nicht an (Serverrechte/Wiederholungsrequests liegen separat), außer der Nutzer bestätigt aktiv die Übernahme eines *fremden*
     geteilten Turniers (und selbst dann wird der bisherige Stand vorher
     automatisch archiviert – in derselben Transaktion, siehe
     confirmAndApplySnapshot() / TArchive.importSnapshot()).
   - Netzwerkfehler beim Erstellen/Öffnen eines SERVER-Links führen zu keinem
     Verlust: Ein Übertragungsrequest wird vorher separat lokal gesichert;
     der laufende Turnierstand wird durch das Veröffentlichen nicht ersetzt.
     Ein per Link empfangener, aber (noch) nicht ladbarer
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

  /* DE/EN-Prototyp (core/turnier-i18n.js): Dialoge/Meldungen nur auf
     freigeschalteten Seiten übersetzen; sonst exakt die bisherigen Texte.
     Server-Fehlermeldungen (data.message) werden unverändert angezeigt. */
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
  function errMsg(err) { return String(err && err.message); }
  /* Anzeigename eines geteilten Turniers für Rückfragen. */
  function shareInfo(env) {
    return (env.title || (env.type ? term(env.type) : '') || tx('share.tournament', 'Turnier'))
      + (env.teams && env.teams.length ? ' (' + shortTeams(env.teams) + ')' : '');
  }

  /* Adresse des eigenen Backends (siehe backend/README.md für das Deployment).
     Muss https:// sein - hier laufen Passwörter/Turnierdaten durch. */
  const API_BASE = 'https://beachvolley.klickdienst-server.de/api';

  const SERVER_PREFIX = '#share=';
  const OFFLINE_PREFIX = '#shareoffline=';
  const MAX_PW_TRIES = 3;
  const REQUEST_TIMEOUT_MS = 10000; // vermeidet endloses "Hängen" bei totem Netz
  const LONG_URL_WARN = 6000; // Warnschwelle beim Offline-Link (Messenger/Browser könnten kappen)

  function cloudSharingEnabled() {
    return typeof TReleaseConfig === 'undefined' || TReleaseConfig.cloudSharing !== false;
  }
  function cloudSharingError() {
    const error = new Error(tx('release.share.disabled',
      'Server-Codes und Server-Links sind in dieser App-Version nicht verfügbar. Bitte einen vollständigen Offline-Link oder eine Sicherungsdatei verwenden.'));
    error.code = 'cloud-sharing-disabled';
    return error;
  }
  /* ============================================================ Server-API
     network:true markiert Fehler, bei denen der Server gar nicht erreicht
     wurde (offline, Timeout, DNS, CORS) - im Unterschied zu einer regulären
     Fehlerantwort vom Server (z. B. 404/401). Wird genutzt, um zu
     entscheiden, ob ein empfangener Link verworfen werden darf oder ob er
     für einen späteren, erneuten Versuch erhalten bleiben soll. */
  async function request(path, opts) {
    if (!cloudSharingEnabled()) throw cloudSharingError();
    const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS) : null;
    let res;
    try {
      res = await fetch(API_BASE + path, Object.assign({ cache: 'no-store', credentials: 'omit' }, opts, ctrl ? { signal: ctrl.signal } : {}));
    } catch (e) {
      const err = new Error(
        (e && e.name === 'AbortError')
          ? tx('share.err.timeout', 'Zeitüberschreitung - der Server hat nicht rechtzeitig geantwortet.')
          : tx('share.err.offline', 'Keine Verbindung zum Server (offline oder nicht erreichbar).')
      );
      err.network = true;
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
    }
    let data = null;
    try { data = await res.json(); } catch (e) { /* leere/kaputte Antwort */ }
    if (!res.ok) {
      const err = new Error((data && data.message) || tx('share.err.server', 'Serverfehler ({status})', { status: res.status }));
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

  /* Native App (Capacitor): Seiten laufen unter capacitor://localhost bzw.
     https://localhost – solche Links wären für Empfänger wertlos. Dort
     liefert TNative (core/turnier-native.js) dieselbe Seite der öffentlichen
     Web-App. Fehlt TNative in der App, wird abgebrochen statt einen lokalen
     Link zu erzeugen. Browser/PWA: unverändert location.href. */
  function nativeApp() {
    if (typeof TNative !== 'undefined' && TNative && typeof TNative.isNative === 'function') return TNative.isNative();
    const cap = typeof Capacitor !== 'undefined' ? Capacitor : null;
    if (!cap || typeof cap.isNativePlatform !== 'function') return false;
    try { return !!cap.isNativePlatform(); } catch (e) { return true; }
  }
  /* → URL dieser Seite ohne #Hash, Grundlage aller Teilen-Links. */
  function sharePageUrl() {
    if (nativeApp()) {
      if (typeof TNative === 'undefined' || !TNative || typeof TNative.publicPageUrl !== 'function') {
        const err = new Error(tx('native.share.noPublicUrl', 'Für diese Seite gibt es keinen öffentlichen Link.'));
        err.code = 'no-public-url';
        throw err;
      }
      return TNative.publicPageUrl(location.href);
    }
    const url = new URL(location.href);
    url.hash = '';
    return url;
  }

  function buildServerShareUrl(id) {
    return sharePageUrl().toString() + SERVER_PREFIX + encodeURIComponent(id);
  }

  function secret() {
    if (typeof crypto === 'undefined' || !crypto.getRandomValues) throw new Error(tx('server.crypto', 'Sichere Zufallszahlen sind nicht verfügbar.'));
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return Array.prototype.map.call(bytes, function (n) { return n.toString(16).padStart(2, '0'); }).join('');
  }
  function bindingKey(sheet) { return TStore.SERVER_PREFIX + sheet; }
  function bindInView(view, sheet, binding) { view.setItem(bindingKey(sheet), JSON.stringify(binding)); }
  function snapshotSignature(snapshot) {
    const clean = {};
    Object.keys(snapshot || {}).sort().forEach(function (key) {
      const record = JSON.parse(snapshot[key]);
      delete record._revision; delete record.updated;
      clean[key] = record;
    });
    return JSON.stringify(clean);
  }
  function parsedServerInput(value) {
    const parts = String(value || '').split('&edit=');
    const id = extractServerCode(parts[0]);
    const token = parts[1] || '';
    if (!/^[A-Za-z0-9]{1,12}$/.test(id) || (token && !/^[a-f0-9]{64}$/.test(token))) {
      throw new Error(tx('code.invalidInput', 'Bitte einen gültigen Code oder Link eingeben.'));
    }
    return { id: id, token: token };
  }

  /* Persist the exact request BEFORE sending. Recovery requires the client's
     256-bit secret, never a public request ID. Complete an uncertain request
     before starting a different one, even if local data have changed. */
  async function publish(o, pw, removePassword) {
    if (!cloudSharingEnabled()) throw cloudSharingError();
    if (removePassword) pw = '';
    sharePageUrl();
    await TStore.whenIdle();
    let binding = await TStore.transaction(function (view) {
      let b = TStore.serverBindingInView(view, o.sheet);
      if (b && b.readOnly) throw new Error(tx('server.readonly', 'Schreibgeschützte Serveransicht'));
      if (!b) {
        b = { instance: secret(), token: secret(), revision: 0, id: null };
        bindInView(view, o.sheet, b);
      }
      return b;
    });
    async function transmit(pending) {
      const data = await apiPost('/share.php?action=' + pending.action, pending.body);
      if (!data || !/^[A-Za-z0-9]{1,12}$/.test(data.id) || !Number.isSafeInteger(data.revision)
          || data.revision < 1 || data.formatVersion !== 2 || (binding.id && data.id !== binding.id)) {
        throw new Error(tx('server.protocol', 'Der Server unterstützt das aktuelle Turnierformat nicht. Bitte Backend aktualisieren.'));
      }
      binding = await TStore.transaction(function (view) {
        const current = TStore.serverBindingInView(view, o.sheet);
        if (!current || current.instance !== binding.instance) throw new Error(tx('server.replaced', 'Das lokale Turnier wurde inzwischen ersetzt. Der Upload gehört zum vorherigen Turnier.'));
        current.id = data.id;
        current.revision = Math.max(current.revision, data.revision);
        if (current.pending && current.pending.body.requestKey === pending.body.requestKey) {
          delete current.pending;
          current.published = snapshotSignature(pending.body.snapshot);
        }
        bindInView(view, o.sheet, current);
        return current;
      });
      return data;
    }
    const recovery = binding.pending;
    const recovered = recovery ? await transmit(recovery) : null;
    const snapshot = await readSnapshot(o);
    const signature = snapshotSignature(snapshot);
    const sameRecoveredPassword = recovery && ((!pw && !removePassword && recovery.body.password === undefined)
      || (pw || '') === recovery.body.password);
    if (recovered && signature === snapshotSignature(recovery.body.snapshot) && sameRecoveredPassword) {
      recovered.dirty = false;
      await renderServerStatus(o);
      return recovered;
    }
    const record = JSON.parse(snapshot[TStore.PREFIX + o.sheet] || '{}');
    const count = Number(record.config && record.config.teams)
      || Number(record.config && record.config.men) + Number(record.config && record.config.women) || 0;
    const teams = [];
    for (let n = 1; n <= count; n++) teams.push(record.teamNames && record.teamNames[n]
      || (o.sheet.indexOf('kingqueen') === 0 ? 'Person ' : 'Team ') + n);
    const body = {
      formatVersion: 2, sheet: o.sheet, file: o.file || '', type: o.type || '',
      title: record.title || o.title || '', teams: teams.length ? teams : (Array.isArray(o.teams) ? o.teams : []),
      snapshot: snapshot, password: pw || '', editToken: binding.token, requestKey: secret()
    };
    if (binding.id) {
      body.id = binding.id; body.expectedRevision = binding.revision;
      if (!pw && !removePassword) delete body.password;
    }
    const pending = { action: binding.id ? 'update' : 'create', body: body };
    await TStore.transaction(function (view) {
      const b = TStore.serverBindingInView(view, o.sheet);
      if (!b || b.instance !== binding.instance) throw new Error(tx('server.replaced', 'Das lokale Turnier wurde inzwischen ersetzt. Der Upload gehört zum vorherigen Turnier.'));
      if (b.pending) throw new Error(tx('server.busy', 'Eine Übertragung läuft bereits. Bitte erneut versuchen.'));
      b.pending = pending;
      bindInView(view, o.sheet, b);
    });
    const data = await transmit(pending);
    data.dirty = snapshotSignature(await readSnapshot(o)) !== signature;
    await renderServerStatus(o);
    return data;
  }

  async function independentCopy(o) {
    await TStore.whenIdle();
    await TStore.transaction(function (view) { TStore.detachServerInView(view, o.sheet); });
    location.reload();
  }

  function transferUrl(o) {
    return TStore.serverBinding(o.sheet).then(function (b) {
      if (!b || !b.id || !b.token || b.readOnly) throw new Error(tx('server.noRights', 'Kein Bearbeitungsrecht vorhanden.'));
      return buildServerShareUrl(b.id) + '&edit=' + b.token;
    });
  }
  function openTransfer(o) {
    return transferUrl(o).then(function (url) {
      openInfoDialog({
        title: tx('server.transfer', 'Bearbeitungszugang sichern / übertragen'),
        bodyHtml: '<p>' + escapeHtml(tx('server.secretWarning', 'Geheimer Link: erlaubt Änderungen in einem anderen Browser. Nur ausdrücklich an Mitorganisatoren geben, niemals öffentlich teilen. Rechte vor Browserdatenlöschung oder dem Schließen einer privaten Sitzung separat sichern; gewöhnliche Sicherungsdateien enthalten sie nicht.'))
          + '</p><input id="tserver-secret" type="text" readonly style="width:100%">'
      }).querySelector('#tserver-secret').value = url;
    });
  }

  let readonlyObserver = null;
  let readonlyActive = false;
  let statusOpts = null;
  function lockServerView() {
    readonlyActive = true;
    function allowed(el) {
      return el.closest && el.closest('#tserver-status, #' + MODAL_ID + ', .schedule-roundbar, .mobile-jumpbar, .app-bar, .format-info-toggle, .cfg-actions-toggle');
    }
    function disable() {
      if (!readonlyActive) return;
      document.querySelectorAll('input, select, textarea, button').forEach(function (el) {
        if (allowed(el)) return;
        if (el.tagName !== 'BUTTON' || !/^(btnShare|btnPrint|btnToggle\w*)$/.test(el.id)) el.disabled = true;
      });
    }
    if (!readonlyObserver) {
      readonlyObserver = new MutationObserver(disable);
      readonlyObserver.observe(document.body, { childList: true, subtree: true });
      ['input', 'change'].forEach(function (event) {
        document.addEventListener(event, function (e) {
          if (readonlyActive && !allowed(e.target)) { e.preventDefault(); e.stopImmediatePropagation(); }
        }, true);
      });
    }
    disable();
  }

  async function renderServerStatus(o) {
    if (typeof document === 'undefined' || !o || !o.sheet) return;
    statusOpts = o;
    const b = await TStore.serverBinding(o.sheet);
    const old = document.getElementById('tserver-status');
    if (old) old.remove();
    if (!b || !b.id) return;
    const bar = document.createElement('div');
    bar.id = 'tserver-status'; bar.className = 'noprint';
    bar.style.cssText = 'padding:12px;border:1px solid #b4bfd0;background:#eef3fa;margin:12px 0;';
    const dirty = b.published !== snapshotSignature(await readSnapshot(o));
    bar.textContent = (b.readOnly ? tx('server.readonly', 'Schreibgeschützte Serveransicht')
      : dirty ? tx('server.dirty', 'Lokaler Entwurf – noch nicht veröffentlicht')
        : tx('server.bound', 'Dieser Browser kann aktualisieren'));
    const more = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = tx('share.moreOptions', 'Weitere Optionen');
    more.appendChild(summary);
    bar.appendChild(more);
    function button(key, de, fn) {
      const el = document.createElement('button'); el.type = 'button'; el.textContent = tx(key, de);
      el.style.margin = '4px'; el.addEventListener('click', fn); more.appendChild(el);
    }
    button('server.copy', 'Unabhängige lokale Kopie', function () {
      if (confirm(tx('server.copyConfirm', 'Serverbindung lösen? Dieser Stand wird eine unabhängige lokale Kopie; der Server bleibt unverändert.'))) independentCopy(o);
    });
    button('server.load', 'Entwurf sichern + Server laden', function () {
      location.hash = SERVER_PREFIX + b.id + (b.token ? '&edit=' + b.token : '');
      location.reload();
    });
    if (!b.readOnly) button('server.transfer', 'Bearbeitungszugang sichern / übertragen', function () { openTransfer(o); });
    document.body.insertBefore(bar, document.body.firstChild);
    if (b.readOnly) lockServerView();
  }

  /* =================================================== Offline-Kodierung */
  const OFFLINE_V2 = 'v2.';
  const KDF_ITERATIONS = 600000;
  const MAX_OFFLINE_BYTES = 450000;
  function cryptoUnavailable() {
    const err = new Error(tx('share.cryptoUnavailable',
      'Sicherer Passwortschutz ist hier nicht verfügbar. Bitte die App oder eine HTTPS-Seite verwenden. Es wurde kein ungeschützter Ersatzlink erstellt.'));
    err.code = 'crypto-unavailable';
    return err;
  }
  function secureCrypto() {
    if (typeof crypto === 'undefined' || !crypto.subtle || !crypto.getRandomValues
        || (typeof isSecureContext !== 'undefined' && !isSecureContext)) throw cryptoUnavailable();
    return crypto;
  }
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
  async function offlineKey(password, salt) {
    const subtle = secureCrypto().subtle;
    const material = await subtle.importKey('raw', strToBytes(password), 'PBKDF2', false, ['deriveKey']);
    return subtle.deriveKey({ name: 'PBKDF2', salt: salt, iterations: KDF_ITERATIONS, hash: 'SHA-256' },
      material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  function offlineHeader(env) {
    return strToBytes(JSON.stringify([env.v, env.sheet, env.type, env.title, env.teams, env.ts,
      env.enc, env.kdf, env.iterations, env.salt, env.iv]));
  }
  async function offlineEncode(opts, password) {
    const snapshotJson = JSON.stringify(opts.snapshot || {});
    if (strToBytes(snapshotJson).length > 300000) throw new Error(tx('share.invalid', 'Der Link enthält keine gültigen Turnierdaten.'));
    const envelope = {
      v: 2,
      sheet: opts.sheet || '',
      type: opts.type || '',
      title: opts.title || '',
      teams: Array.isArray(opts.teams) ? opts.teams : [],
      ts: Date.now(),
      enc: !!password,
      payload: snapshotJson
    };
    if (password) {
      const c = secureCrypto();
      const salt = c.getRandomValues(new Uint8Array(16)), iv = c.getRandomValues(new Uint8Array(12));
      envelope.kdf = 'PBKDF2-SHA256';
      envelope.iterations = KDF_ITERATIONS;
      envelope.salt = bytesToBase64Url(salt);
      envelope.iv = bytesToBase64Url(iv);
      const key = await offlineKey(password, salt);
      envelope.payload = bytesToBase64Url(new Uint8Array(await c.subtle.encrypt({
        name: 'AES-GCM', iv: iv, additionalData: offlineHeader(envelope), tagLength: 128
      }, key, strToBytes(snapshotJson))));
    }
    return OFFLINE_V2 + bytesToBase64Url(strToBytes(JSON.stringify(envelope)));
  }

  function offlineDecodeEnvelope(hashValue) {
    try {
      if (typeof hashValue !== 'string' || hashValue.indexOf(OFFLINE_V2) !== 0
          || hashValue.length > MAX_OFFLINE_BYTES * 2) return null;
      const bytes = base64UrlToBytes(hashValue.slice(OFFLINE_V2.length));
      if (bytes.length > MAX_OFFLINE_BYTES) return null;
      const json = bytesToStr(bytes);
      const env = JSON.parse(json);
      if (!env || env.v !== 2 || typeof env.payload !== 'string' || typeof env.enc !== 'boolean'
          || !safeServerFile(env) || typeof env.type !== 'string' || env.type.length > 500
          || typeof env.title !== 'string' || env.title.length > 500 || !Number.isFinite(env.ts)
          || !Array.isArray(env.teams) || env.teams.length > 128
          || !env.teams.every(t => typeof t === 'string' && t.length <= 500)) return null;
      if (env.enc && (env.kdf !== 'PBKDF2-SHA256' || env.iterations !== KDF_ITERATIONS
          || typeof env.salt !== 'string' || !/^[A-Za-z0-9_-]{22}$/.test(env.salt)
          || typeof env.iv !== 'string' || !/^[A-Za-z0-9_-]{16}$/.test(env.iv)
          || !/^[A-Za-z0-9_-]+$/.test(env.payload) || base64UrlToBytes(env.payload).length < 16)) return null;
      return env;
    } catch (e) { return null; }
  }

  /* Entschlüsselt/parst die Nutzdaten eines Offline-Envelopes. Wirft bei
     falschem Passwort oder beschädigten Daten (JSON.parse schlägt fehl). */
  async function offlineResolveSnapshot(env, password) {
    if (!env || env.v !== 2) throw new Error(tx('share.invalid', 'Der Link enthält keine gültigen Turnierdaten.'));
    let json;
    if (env.enc) {
      if (env.kdf !== 'PBKDF2-SHA256' || env.iterations !== KDF_ITERATIONS) throw new Error('Invalid KDF');
      const salt = base64UrlToBytes(env.salt), iv = base64UrlToBytes(env.iv);
      if (salt.length !== 16 || iv.length !== 12) throw new Error('Invalid salt/nonce');
      const key = await offlineKey(password || '', salt);
      json = bytesToStr(new Uint8Array(await secureCrypto().subtle.decrypt({
        name: 'AES-GCM', iv: iv, additionalData: offlineHeader(env), tagLength: 128
      }, key, base64UrlToBytes(env.payload))));
    } else {
      json = env.payload;
    }
    return JSON.parse(json); // wirft bei falschem Passwort/kaputten Daten
  }

  async function buildOfflineShareUrl(opts, password) {
    const page = sharePageUrl().toString();
    const hash = OFFLINE_PREFIX + await offlineEncode(opts, password);
    return page + hash;
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
      /* "inset:0" statt der vier Langformen wuerde auf Safari 12 (altes iPad,
         siehe AGENTS.md §7b) klanglos ignoriert - das Overlay haette dann
         keine Verankerung und wuerde ausserhalb des Viewports gerendert
         (unsichtbar, ohne Fehlermeldung). Daher immer top/right/bottom/left. */
      '.tshare-backdrop{position:fixed;top:0;right:0;bottom:0;left:0;z-index:10000;background:rgba(20,30,45,.55);' +
        'display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;' +
        'padding-top:calc(16px + env(safe-area-inset-top,0px));padding-bottom:calc(16px + env(safe-area-inset-bottom,0px));' +
        'padding-left:calc(16px + env(safe-area-inset-left,0px));padding-right:calc(16px + env(safe-area-inset-right,0px));' +
        '-webkit-backdrop-filter:blur(2px);backdrop-filter:blur(2px);}' +
      '@media print{.tshare-backdrop{display:none !important;}}' +
      '.tshare-panel{position:relative;background:#fff;color:#1a1a2e;width:100%;max-width:440px;border-radius:14px;' +
        'box-shadow:0 12px 40px rgba(0,0,0,.28);max-height:100%;min-width:0;min-height:0;display:flex;flex-direction:column;' +
        'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;}' +
      '.tshare-head{display:flex;align-items:center;gap:12px;' +
        'padding:16px 66px 16px 18px;border-bottom:1px solid #e2e8f0;flex:0 0 auto;}' +
      '.tshare-head h3{margin:0;min-width:0;word-wrap:break-word;overflow-wrap:break-word;font-size:16px;font-weight:800;color:#1a3a5c;}' +
      '#tshare-overlay-root .tshare-panel:focus{outline:none;}' +
      '.tshare-body{padding:16px 18px;font-size:14px;line-height:1.5;min-height:0;overflow:auto;-webkit-overflow-scrolling:touch;word-wrap:break-word;overflow-wrap:break-word;}' +
      '.tshare-body p{margin:0 0 10px;color:#3a4356;}' +
      '.tshare-hint{font-size:12.5px;color:#5a6375;}' +
      '.tshare-error{color:#b3261e;font-weight:600;}' +
      '.tshare-options{display:flex;flex-direction:column;gap:10px;margin-bottom:14px;}' +
      '.tshare-opt{display:flex;gap:10px;align-items:flex-start;border:1.5px solid #ccd8e8;' +
        'border-radius:10px;padding:10px 12px;cursor:pointer;}' +
      '.tshare-opt.is-checked{border-color:#1f6fa8;background:#e8f3fb;}' +
      '.tshare-opt-primary{padding:14px 12px;border-width:2px;}' +
      '.tshare-opt input{margin-top:3px;flex:0 0 auto;}' +
      '.tshare-opt>span{min-width:0;}' +
      '.tshare-opt strong{display:block;font-size:13.5px;color:#1a1a2e;}' +
      '.tshare-opt em{font-style:normal;color:#0a7d2c;font-size:11.5px;font-weight:700;margin-left:4px;}' +
      '.tshare-opt small{display:block;color:#5a6375;font-size:12px;margin-top:2px;}' +
      '.tshare-advanced{margin-top:4px;border-top:1px solid #e2e8f0;padding-top:10px;}' +
      '.tshare-advanced summary{color:#1a3a5c;font-size:13px;font-weight:700;cursor:pointer;padding:4px 0 8px;}' +
      '.tshare-advanced .tshare-opt{margin-bottom:12px;}' +
      '.tshare-password{margin:0 0 14px;padding:10px 12px;background:#f3f6fa;border:1px solid #dce5ef;border-radius:10px;}' +
      '.tshare-password .tshare-field{margin:0;font-size:13px;}' +
      '.tshare-password>small{display:block;margin-top:6px;color:#5a6375;font-size:11.5px;}' +
      '.tshare-field{display:block;font-size:12.5px;font-weight:700;color:#3a4356;margin-bottom:14px;}' +
      '.tshare-field input{display:block;width:100%;margin-top:6px;padding:10px 12px;font-size:14px;' +
        'border:1.5px solid #ccd8e8;border-radius:9px;background:#f3f6fa;box-sizing:border-box;}' +
      '.tshare-field input:focus{outline:none;border-color:#1f6fa8;background:#fff;}' +
      '.tshare-linkrow{display:flex;gap:8px;margin-bottom:8px;}' +
      '.tshare-linkrow input{flex:1;min-width:0;padding:9px 10px;font-size:12.5px;border:1.5px solid #ccd8e8;' +
        'border-radius:9px;background:#f3f6fa;box-sizing:border-box;}' +
      '.tshare-qr-wrap{text-align:center;margin:0 auto 14px;padding:12px;background:#f3f6fa;border-radius:12px;}' +
      '.tshare-qr-label{font-weight:700;color:#1a3a5c !important;}' +
      '.tshare-qr{display:block;width:220px;max-width:100%;height:auto;margin:0 auto;background:#fff;border:8px solid #fff;}' +
      '.tshare-qr[hidden]{display:none;}' +
      '.tshare-copied{color:#0a7d2c;font-size:12.5px;font-weight:600;margin:0;}' +
      '.tshare-loading{display:flex;flex-direction:column;align-items:center;gap:14px;padding:14px 0 6px;color:#3a4356;}' +
      '.tshare-spinner{width:30px;height:30px;border-radius:50%;border:3px solid #ccd8e8;' +
        'border-top-color:#1f6fa8;animation:tshare-spin .8s linear infinite;}' +
      '@keyframes tshare-spin{to{transform:rotate(360deg);}}' +
      '.tshare-foot{display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap;' +
        'padding:14px 18px;border-top:1px solid #e2e8f0;flex:0 0 auto;}' +
      '.tshare-btn{border:none;border-radius:9px;padding:10px 16px;font-size:13.5px;font-weight:700;' +
        'cursor:pointer;white-space:normal;min-height:44px;max-width:100%;word-wrap:break-word;}' +
      '.tshare-btn-primary{background:#1a3a5c;color:#fff;}' +
      '.tshare-btn-primary:hover{background:#1f6fa8;}' +
      '.tshare-btn-ghost{background:none;color:#1a3a5c;border:1.5px solid #ccd8e8;}' +
      '.tshare-btn-ghost:hover{border-color:#1f6fa8;}' +
      '@media screen and (max-width:640px){.tshare-field input,.tshare-linkrow input{font-size:16px;min-height:44px;}' +
        '.tshare-linkrow{flex-wrap:wrap;}.tshare-linkrow input{flex-basis:100%;}.tshare-head{padding:12px 60px 12px 12px;}' +
        '.tshare-body,.tshare-foot{padding:12px;}}';
    document.head.appendChild(style);
  }

  /* Fokusfuehrung (WCAG 2.4.3): Fokus in den Dialog, Tab bleibt darin,
     Hintergrund fuer Screenreader stumm (aria-hidden), beim Schliessen
     zurueck zum ausloesenden Element. Escape schliesst weiterhin (auch der
     synthetische Escape aus turnier-native.js dismissDialog()). */
  let shareReturnFocus = null;
  let shareHiddenSiblings = [];
  let shareViewportCleanup = null;

  function shareFocusables(root) {
    return Array.prototype.filter.call(root.querySelectorAll(
      'button, [href], input:not([type="hidden"]), select, textarea, summary, [tabindex]:not([tabindex="-1"])'),
      function (el) { return !el.disabled && !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length); });
  }

  function onShareEscKey(e) {
    if (e.key === 'Escape' || e.key === 'Esc') { closeShareModal(); return; }
    if (e.key !== 'Tab') return;
    const root = document.getElementById(MODAL_ID);
    if (!root) return;
    const f = shareFocusables(root);
    if (!f.length) { e.preventDefault(); return; }
    const a = document.activeElement, i = f.indexOf(a);
    if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && (i === -1 || i === f.length - 1)) { e.preventDefault(); f[0].focus(); }
  }

  function removeShareModal(restoreFocus) {
    if (shareViewportCleanup) { shareViewportCleanup(); shareViewportCleanup = null; }
    const el = document.getElementById(MODAL_ID);
    if (el) el.remove();
    document.removeEventListener('keydown', onShareEscKey);
    shareHiddenSiblings.forEach(function (n) { n.removeAttribute('aria-hidden'); });
    shareHiddenSiblings = [];
    if (restoreFocus) {
      const back = shareReturnFocus;
      shareReturnFocus = null;
      if (back && back.focus && document.documentElement.contains(back)) {
        try { back.focus(); } catch (e) { }
      }
    }
  }

  function closeShareModal() { removeShareModal(true); }

  /* Baut/ersetzt das Overlay-Grundgerüst und liefert das Root-Element zum
     Anhängen von Event-Handlern durch die jeweilige "Seite" (Formular,
     Ladeanzeige, Ergebnis, Fehler). */
  function openShareModalShell(title, bodyHtml, footerHtml) {
    /* Folgeschritt (Formular → Laden → Ergebnis) behaelt das urspruengliche
       Ruecksprungziel. */
    const chained = !!document.getElementById(MODAL_ID);
    const back = chained ? shareReturnFocus : document.activeElement;
    removeShareModal(false);
    shareReturnFocus = back;
    ensureShareStyles();
    const root = document.createElement('div');
    root.id = MODAL_ID;
    root.className = 'tshare-backdrop';
    root.innerHTML =
      '<div class="tshare-panel" role="dialog" aria-modal="true" tabindex="-1" aria-label="' + escapeHtml(title) + '">' +
      '<div class="tshare-head"><h3>' + escapeHtml(title) + '</h3>' +
      '<button type="button" class="tshare-x" aria-label="' + escapeHtml(tx('share.close', 'Schließen')) + '"></button></div>' +
      '<div class="tshare-body">' + bodyHtml + '</div>' +
      (footerHtml ? '<div class="tshare-foot">' + footerHtml + '</div>' : '') +
      '</div>';
    document.body.appendChild(root);
    /* iOS's keyboard resizes the visual viewport, not the layout viewport.
       Safari 12 falls back to window resize / innerHeight. */
    const viewport = window.visualViewport;
    function fitViewport() {
      root.style.top = (viewport ? viewport.offsetTop : 0) + 'px';
      root.style.height = (viewport ? viewport.height : window.innerHeight) + 'px';
      root.style.bottom = 'auto';
    }
    fitViewport();
    window.addEventListener('resize', fitViewport);
    if (viewport) {
      viewport.addEventListener('resize', fitViewport);
      viewport.addEventListener('scroll', fitViewport);
    }
    shareViewportCleanup = function () {
      window.removeEventListener('resize', fitViewport);
      if (viewport) {
        viewport.removeEventListener('resize', fitViewport);
        viewport.removeEventListener('scroll', fitViewport);
      }
    };
    Array.prototype.forEach.call(document.body.children, function (n) {
      if (n === root || n.tagName === 'SCRIPT' || n.tagName === 'STYLE' || n.hasAttribute('aria-hidden')) return;
      n.setAttribute('aria-hidden', 'true');
      shareHiddenSiblings.push(n);
    });
    root.addEventListener('mousedown', function (e) { if (e.target === root) closeShareModal(); });
    TNative.mountClose(root.querySelector('.tshare-panel'), tx('share.close', 'Schließen'), closeShareModal, root.querySelector('.tshare-x'), true);
    document.addEventListener('keydown', onShareEscKey);
    /* Panel selbst fokussieren (nicht das erste Eingabefeld): Screenreader
       lesen den Dialogtitel, mobil klappt keine Tastatur ungefragt auf. */
    try { root.querySelector('.tshare-panel').focus(); } catch (e) { }
    return root;
  }

  /* Generisches Info-/Bestätigungs-Overlay im gleichen visuellen Stil wie der
     Teilen-Dialog - für andere Aktionen im Bogen (z. B. "Finalrunde spielen"),
     bei denen ein natives confirm() zu wenig Platz für Erklärungen bietet.
     opts: { title, bodyHtml, confirmLabel, cancelLabel, onConfirm } */
  function openInfoDialog(opts) {
    opts = opts || {};
    const confirmLabel = opts.confirmLabel || tx('share.continue', 'Weiter');
    const cancelLabel = opts.cancelLabel || tx('share.cancel', 'Abbrechen');
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
      tx('share.title', 'Turnier teilen'),
      '<div class="tshare-options">' +
        '<label class="tshare-opt tshare-opt-primary"><input type="radio" name="tshare-mode" value="qr" checked>' +
        '<span><strong>' + escapeHtml(tx('share.qr.title', 'QR-Code / Turniercode')) + '</strong>' +
        '<small>' + escapeHtml(tx('share.qr.desc', 'Zum Scannen oder Eingeben auf der Startseite – inklusive Kurzlink. Internet erforderlich.')) + '</small></span>' +
        '</label>' +
        '<div class="tshare-password">' +
        '<label class="tshare-field" for="tshare-pw">' + escapeHtml(tx('share.password', 'Passwortschutz (optional)')) +
          '<input type="password" id="tshare-pw" placeholder="' + escapeHtml(tx('share.passwordPlaceholder', 'Leer lassen für keinen Passwortschutz'))
          + '" autocomplete="new-password"></label>' +
        '<small>' + escapeHtml(tx('share.password.desc', 'Das Passwort separat an Empfänger weitergeben.')) + '</small>' +
        '</div>' +
        '<details class="tshare-advanced"><summary>' + escapeHtml(tx('share.moreOptions', 'Weitere Optionen')) + '</summary>' +
        '<small>' + escapeHtml(tx('server.passwordKeep', 'Bei Updates: leer lassen behält das bisherige Lesepasswort.')) + '</small>' +
        '<label><input type="checkbox" id="tshare-remove-pw"> ' + escapeHtml(tx('server.passwordRemove', 'Lesepasswort beim Update ausdrücklich entfernen')) + '</label>' +
        '<label class="tshare-opt"><input type="radio" name="tshare-mode" value="offline">' +
        '<span><strong>' + escapeHtml(tx('share.offline.title', 'Offline-Link')) + '</strong>' +
        '<small>' + escapeHtml(tx('share.offline.desc', 'Enthält den kompletten Turnierstand direkt im Link. Funktioniert ohne Server/Internet, ist aber sehr lang.')) + '</small></span>' +
        '</label>' +
        '</details>' +
        '</div>',
      '<button type="button" class="tshare-btn tshare-btn-ghost" data-act="cancel">' + escapeHtml(tx('share.cancel', 'Abbrechen')) + '</button>' +
      '<button type="button" class="tshare-btn tshare-btn-primary" data-act="create">' + escapeHtml(tx('share.createQr', 'QR-Code erstellen')) + '</button>'
    );
    root.querySelector('[data-act="cancel"]').addEventListener('click', closeShareModal);
    /* Ersatz fuer ".tshare-opt:has(input:checked)" (Safari erst ab 15.4, siehe
       AGENTS.md §7b): Klasse manuell je Radio-Wechsel setzen. */
    const opts = root.querySelectorAll('.tshare-opt');
    function syncCheckedOpt() {
      opts.forEach(function (opt) {
        const input = opt.querySelector('input');
        opt.classList.toggle('is-checked', !!(input && input.checked));
      });
    }
    root.querySelectorAll('input[name="tshare-mode"]').forEach(function (input) {
      input.addEventListener('change', function () {
        syncCheckedOpt();
        root.querySelector('[data-act="create"]').textContent = input.value === 'offline'
          ? tx('share.createOffline', 'Offline-Link erstellen')
          : tx('share.createQr', 'QR-Code erstellen');
      });
    });
    syncCheckedOpt();
    root.querySelector('[data-act="create"]').addEventListener('click', function () {
      const mode = root.querySelector('input[name="tshare-mode"]:checked').value;
      const pw = root.querySelector('#tshare-pw').value || '';
      if (mode === 'qr' && cloudSharingEnabled()) {
        renderShareLoading();
        createServerShare(o, pw, root.querySelector('#tshare-remove-pw').checked);
      } else {
        createOfflineShare(o, pw);
      }
    });
  }

  function renderShareLoading() {
    openShareModalShell(tx('share.title', 'Turnier teilen'),
      '<div class="tshare-loading"><div class="tshare-spinner"></div><p style="margin:0">'
        + escapeHtml(tx('share.loading', 'Link wird erstellt…')) + '</p></div>', '');
  }

  /* o (optional): archiveOpts() des Bogens – Titel für das System-Teilen-Menü. */
  function renderShareResult(url, pw, longWarnLen, code, o) {
    const nativeShare = nativeApp() && typeof TNative !== 'undefined' && TNative && typeof TNative.shareLink === 'function';
    const root = openShareModalShell(
      tx('share.result.title', 'Link zum Teilen'),
      '<p class="tshare-hint">' + escapeHtml(code
        ? (o && o.serverUpdated ? tx('server.updated', 'Aktualisiert – Link, Code und QR bleiben gleich. ') : '')
          + tx('server.result', 'Dieser Browser kann aktualisieren. Öffentlicher Link, Code und QR erlauben nur Lesen.')
        : tx('share.result.hint', 'Der Link enthält einen Snapshot des aktuellen Turnierstands. Spätere Änderungen sind erst in einem neuen Link sichtbar.')) +
        (o && o.serverDirty ? ' ' + escapeHtml(tx('server.dirty', 'Lokaler Entwurf – noch nicht veröffentlicht')) : '') +
        (pw ? escapeHtml(tx('share.result.pwHint', ' Mit Passwort geschützt – bitte separat mitteilen.')) : '') + '</p>' +
        (longWarnLen ? '<p class="tshare-error">' + escapeHtml(cloudSharingEnabled() ? tx('share.result.long', 'Hinweis: Der Link ist sehr lang ({len} Zeichen) und wird evtl. '
          + 'nicht von jedem Messenger/Browser vollständig übernommen. Bei Problemen: über den PC teilen '
          + 'oder den kürzeren Server-Link verwenden.', { len: longWarnLen }) :
          tx('release.share.long', 'Hinweis: Der Link ist sehr lang ({len} Zeichen). Falls er abgeschnitten wird, bitte eine Sicherungsdatei exportieren und teilen.',
            { len: longWarnLen })) + '</p>' : '') +
        '<div class="tshare-qr-wrap"><p class="tshare-qr-label">' +
          escapeHtml(tx('share.result.qr', 'QR-Code zum Scannen')) + '</p>' +
          '<img id="tshare-qr" class="tshare-qr" alt="' +
          escapeHtml(tx('share.result.qrAlt', 'QR-Code für den Turnierlink')) + '"></div>' +
        '<label class="tshare-field" style="margin-bottom:8px">' + escapeHtml(tx('share.result.link', 'Link')) +
      '<div class="tshare-linkrow"><input type="text" id="tshare-url" readonly>' +
      '<button type="button" class="tshare-btn tshare-btn-ghost" data-act="copy">' + escapeHtml(tx('share.copy', 'Kopieren')) + '</button></div></label>' +
      (code
        ? '<label class="tshare-field">' + escapeHtml(tx('share.result.code', 'Turniercode')) + ' <small style="font-weight:400;color:#5a6375">'
          + escapeHtml(tx('share.result.codeHint', '(zum Eingeben auf der Startseite, statt den Link zu öffnen)')) + '</small>' +
          '<div class="tshare-linkrow"><input type="text" id="tshare-code" readonly>' +
          '<button type="button" class="tshare-btn tshare-btn-ghost" data-act="copy-code">' + escapeHtml(tx('share.copy', 'Kopieren')) + '</button></div></label>'
        : '') +
      '<p class="tshare-copied" id="tshare-copied-msg" hidden>' + escapeHtml(tx('share.copied', 'In die Zwischenablage kopiert ✓')) + '</p>' +
      (code ? '<details><summary>' + escapeHtml(tx('share.moreOptions', 'Weitere Optionen')) +
        '</summary><button type="button" class="tshare-btn tshare-btn-ghost" data-act="transfer">' +
        escapeHtml(tx('server.transfer', 'Bearbeitungszugang sichern / übertragen')) + '</button></details>' : '') +
      (nativeShare ? '<p class="tshare-error" id="tshare-native-msg" hidden></p>' : ''),
      (nativeShare ? '<button type="button" class="tshare-btn tshare-btn-ghost" data-act="native-share">'
        + escapeHtml(tx('native.share.button', 'Teilen…')) + '</button>' : '') +
      '<button type="button" class="tshare-btn tshare-btn-primary" data-act="done">' + escapeHtml(tx('share.done', 'Fertig')) + '</button>'
    );
    const urlInput = root.querySelector('#tshare-url');
    urlInput.value = url; // per JS statt HTML-Attribut, um Escaping-Probleme bei Sonderzeichen zu vermeiden
    const qrImage = root.querySelector('#tshare-qr');
    try {
      if (typeof qrcode !== 'function') throw new Error('QR-Code-Generator nicht geladen.');
      const qr = qrcode(0, 'M');
      qr.addData(url, 'Byte');
      qr.make();
      qrImage.src = qr.createDataURL(4, 16);
    } catch (err) {
      qrImage.hidden = true;
      const qrError = document.createElement('p');
      qrError.className = 'tshare-error';
      qrError.textContent = tx('share.result.qrUnavailable',
        'Für diesen Link konnte kein QR-Code erstellt werden. Verwende den Link oder den kürzeren Server-Link.');
      qrImage.parentNode.appendChild(qrError);
    }
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
    if (code) root.querySelector('[data-act="transfer"]').addEventListener('click', function () { openTransfer(o); });
    if (nativeShare) {
      /* App: System-Teilen-Menü (iOS) bzw. Chooser (Android) mit dem
         öffentlichen Link. Abbrechen bleibt still, Fehler stehen im Dialog. */
      const nativeMsg = root.querySelector('#tshare-native-msg');
      const name = (o && (o.title || (o.type ? term(o.type) : ''))) || tx('share.tournament', 'Turnier');
      root.querySelector('[data-act="native-share"]').addEventListener('click', function () {
        nativeMsg.hidden = true;
        TNative.shareLink({
          url: url,
          title: name,
          text: tx('native.share.text', 'Turnier „{title}“', { title: name })
            + (code ? '\n' + tx('share.result.code', 'Turniercode') + ': ' + code : '')
        }).then(null, function (err) {
          if (err && err.code === 'share-busy') return;
          nativeMsg.textContent = tx('native.share.failed', 'Das Teilen-Menü konnte nicht geöffnet werden: {message}', { message: errMsg(err) });
          nativeMsg.hidden = false;
        });
      });
    }
    copyText(url, urlInput); // gleich beim Öffnen automatisch den Link in die Zwischenablage legen (wie zuvor)
    urlInput.focus(); urlInput.select();
  }

  function renderShareError(message, cfg) {
    const c = cfg || {};
    const root = openShareModalShell(
      tx('share.error.title', 'Link konnte nicht erstellt werden'),
      '<p class="tshare-error">' + escapeHtml(message) + '</p>' +
      '<p class="tshare-hint">' + escapeHtml(tx('share.error.safe', 'Dein Turnier auf diesem Gerät ist davon nicht betroffen und weiterhin sicher gespeichert.')) + '</p>',
      '<button type="button" class="tshare-btn tshare-btn-ghost" data-act="cancel">' + escapeHtml(tx('share.cancel', 'Abbrechen')) + '</button>' +
      (c.showOfflineFallback ? '<button type="button" class="tshare-btn tshare-btn-ghost" data-act="offline">'
        + escapeHtml(tx('share.error.offlineFallback', 'Offline-Link stattdessen')) + '</button>' : '') +
      (c.onRetry ? '<button type="button" class="tshare-btn tshare-btn-primary" data-act="retry">' + escapeHtml(tx('share.error.retry', 'Erneut versuchen')) + '</button>' : '')
    );
    root.querySelector('[data-act="cancel"]').addEventListener('click', closeShareModal);
    if (c.onRetry) root.querySelector('[data-act="retry"]').addEventListener('click', c.onRetry);
    if (c.showOfflineFallback) root.querySelector('[data-act="offline"]').addEventListener('click', c.onOfflineFallback);
  }

  /* ================================================================ Teilen
     Öffnet das Overlay zur Auswahl von Link-Art und Passwort.
     opts: dieselbe Form wie archiveOpts() in den Bögen
           ({ sheet, file, type, keys, title, teams, empty }). */
  function openShareDialog(opts) {
    const o = opts || {};
    if (o.empty) { alert(tx('share.empty', 'Dieses Turnier ist noch leer – es gibt noch nichts zu teilen.')); return; }
    renderShareForm(o);
  }

  /* Aktueller Schnappschuss der Turnierdaten aus IndexedDB (wartet auf
     laufende Speichervorgänge). → Promise<{ key: string }> */
  function readSnapshot(o) {
    if (typeof TArchive === 'undefined' || !TArchive.snapshot) return Promise.resolve({});
    return Promise.resolve().then(function () { return TArchive.snapshot(o.keys); });
  }

  /* App ohne öffentliche Adresse für diese Seite: Hinweis ohne Wiederholen
     (ein neuer Versuch oder der Offline-Link hätte dasselbe Problem). */
  function renderNoPublicUrl(err) {
    renderShareError(errMsg(err), {});
  }

  /* -------------------------------------------------------- Server-Variante
     Wird bei einem Netzwerkfehler über den "Erneut versuchen"-Button im
     Overlay erneut aufgerufen, ohne das Passwort nochmal abzufragen - der
     Nutzer muss bei wackliger Verbindung nicht von vorn anfangen. */
  function createServerShare(o, pw, removePassword) {
    // Unbestätigte Übertragungen werden zuerst identisch wiederholt; danach
    // wird ggf. ein inzwischen geänderter Entwurf separat veröffentlicht.
    // Die Link-Adresse wird VOR dem Hochladen geprüft (App: öffentliche URL),
    // damit kein Server-Eintrag ohne verwendbaren Link entsteht.
    return Promise.resolve().then(function () {
      sharePageUrl();
      return publish(o, pw, removePassword);
    }).then(function (data) {
      renderShareResult(buildServerShareUrl(data.id), pw, null, data.id, Object.assign({}, o, { serverDirty: data.dirty, serverUpdated: data.revision > 1 }));
    }).catch(function (err) {
      if (err && err.code === 'no-public-url') { renderNoPublicUrl(err); return; }
      if (err && err.status === 412) {
        renderConflict(o, pw, removePassword);
        return;
      }
      // Ein Servercommit kann bereits erfolgt sein. Der gespeicherte Request
      // ermöglicht sichere Wiederholung; der lokale Entwurf ist unberührt.
      const msg = err.network
        ? tx('share.create.network', 'Der Link konnte nicht erstellt werden: {message}', { message: errMsg(err) })
        : (err.status
          ? tx('share.create.server', 'Der Link konnte nicht erstellt werden (Serverfehler): {message}', { message: errMsg(err) })
          : tx('share.create.read', 'Der Turnierstand konnte nicht gelesen werden: {message}', { message: errMsg(err) }));
      renderShareError(msg, {
        showOfflineFallback: true,
        onRetry: function () { renderShareLoading(); createServerShare(o, pw, removePassword); },
        onOfflineFallback: function () { createOfflineShare(o, pw); }
      });
    });
  }

  function renderConflict(o, pw, removePassword) {
    const root = openShareModalShell(tx('server.conflict', 'Serverkonflikt – nichts überschrieben'),
      '<p>' + escapeHtml(tx('server.conflictHint', 'Ein anderer Bearbeiter hat gespeichert. Dein Entwurf bleibt lokal erhalten. Keine automatische Zusammenführung.'))
        + '</p>',
      '<button type="button" class="tshare-btn" data-act="cancel">' + escapeHtml(tx('share.cancel', 'Abbrechen')) + '</button>' +
      '<button type="button" class="tshare-btn" data-act="load">' + escapeHtml(tx('server.load', 'Entwurf sichern + Server laden')) + '</button>' +
      '<button type="button" class="tshare-btn" data-act="fork">' + escapeHtml(tx('server.fork', 'Als neues unabhängiges Turnier veröffentlichen')) + '</button>');
    root.querySelector('[data-act="cancel"]').onclick = closeShareModal;
    root.querySelector('[data-act="load"]').onclick = function () {
      TStore.serverBinding(o.sheet).then(function (b) {
        location.hash = SERVER_PREFIX + b.id + '&edit=' + b.token;
        location.reload();
      });
    };
    root.querySelector('[data-act="fork"]').onclick = function () {
      TStore.transaction(function (view) { TStore.detachServerInView(view, o.sheet); }).then(function () {
        renderShareLoading(); createServerShare(o, pw, removePassword);
      });
    };
  }

  /* ------------------------------------------------------- Offline-Variante
     Rein clientseitig, funktioniert ohne Server/Internet. */
  function createOfflineShare(o, pw) {
    return readSnapshot(o).then(async function (snapshot) {
      const url = await buildOfflineShareUrl({
        sheet: o.sheet, type: o.type, title: o.title, teams: o.teams, snapshot: snapshot
      }, pw || null);
      renderShareResult(url, pw, url.length > LONG_URL_WARN ? url.length : null, null, o);
    }).catch(function (err) {
      if (err && err.code === 'no-public-url') { renderNoPublicUrl(err); return; }
      renderShareError(tx('share.create.read', 'Der Turnierstand konnte nicht gelesen werden: {message}', { message: errMsg(err) }), {
        onRetry: function () { createOfflineShare(o, pw); }
      });
    });
  }

  /* ========================================================== Übernehmen
     Prüft/übernimmt einen per Link empfangenen Turnierstand, falls die
     Adresszeile #share=… oder #shareoffline=… enthält. Analog zu
     TArchive.applyPendingRestore(): archiviert zuerst den aktuellen Stand,
     schreibt dann den Snapshot in den laufenden Speicherplatz und lädt neu.
     opts: archiveOpts() des Bogens (für das Sichern des bisherigen Standes). */
  /* Geteilt werden alle Namen; in Abfragen nur die ersten 4 anzeigen. */
  function shortTeams(t) {
    const SEP = ', ';
    return (t.length > 4 ? t.slice(0, 4).join(SEP) + SEP + '… (+' + (t.length - 4) + ')' : t.join(SEP));
  }

  /* → Promise<boolean>; rejected nie. true = ein Link wurde übernommen und
     die Seite navigiert/lädt gleich neu (Aufrufer sollte nichts mehr
     speichern). Fehler werden dem Nutzer angezeigt. */
  function applyPendingShare(opts) {
    let pending = null;
    try { pending = readPendingHash(); } catch (e) { pending = null; }
    if (!pending) return renderServerStatus(opts).then(function () { return false; }, function () { return false; });
    if (pending.kind === 'server' && !cloudSharingEnabled()) {
      alert(cloudSharingError().message);
      return Promise.resolve(false);
    }
    const run = pending.kind === 'offline'
      ? function () { return applyOfflineShare(pending.value, opts); }
      : function () { return applyServerShare(pending.value, opts); };
    return Promise.resolve().then(run).then(function (r) { return !!r; }, function (err) {
      alert(tx('share.apply.failed', 'Das geteilte Turnier konnte nicht übernommen werden:\n{message}', { message: errMsg(err) }));
      return false;
    });
  }

  /* Speicherplatz-Konvention aller Bögen: "base" bzw. "base.<id>" (Basen
     enthalten keinen Punkt, ?id=_base_ steht für die nackte Basis). */
  function sheetParts(sheet) {
    const s = String(sheet || '');
    const dot = s.indexOf('.');
    return dot >= 0 ? { base: s.slice(0, dot), id: s.slice(dot + 1) } : { base: s, id: '' };
  }

  /* URL dieser Seite, die genau den Speicherplatz "sheet" öffnet (mit
     explizitem ?id= und – bei Bögen mit mehreren Modi – passendem ?mode=).
     null, wenn "sheet" nicht zu dieser Seite gehört. opts.sheetModes
     (optional): { <base>: <mode> } für Bögen, deren Basis vom ?mode= abhängt. */
  function urlForSheet(sheet, opts) {
    const want = sheetParts(sheet);
    const cur = sheetParts(opts && opts.sheet);
    const modes = (opts && opts.sheetModes) || {};
    const sameBase = want.base && want.base === cur.base;
    const mapped = Object.prototype.hasOwnProperty.call(modes, want.base)
      && Object.prototype.hasOwnProperty.call(modes, cur.base);
    if (!sameBase && !mapped) return null;
    try {
      const url = new URL(location.href);
      url.hash = '';
      url.searchParams.delete('restore');
      url.searchParams.set('id', want.id || '_base_');
      if (Object.prototype.hasOwnProperty.call(modes, want.base)) url.searchParams.set('mode', modes[want.base]);
      return url.pathname + url.search;
    } catch (e) { return null; }
  }

  /* Link passt nicht zum aktuell geöffneten Speicherplatz (z. B. Admin-Link
     oder alter Link ohne ?id=/?mode=): auf denselben Bogen mit richtigem
     ?id=/?mode= umleiten, der Link-Hash bleibt erhalten. Nur wenn das nicht
     möglich ist (anderer Bogen-Typ), wird abgelehnt.
     → false (passt) | 'redirect' (Navigation läuft) | 'rejected'. */
  function handleSheetMismatch(envSheet, opts, hash) {
    if (!opts || !opts.sheet || !envSheet || envSheet === opts.sheet) return false;
    const target = urlForSheet(envSheet, opts);
    if (target && target !== location.pathname + location.search) {
      location.replace(target + hash);
      return 'redirect';
    }
    clearHash();
    alert(tx('share.mismatch', 'Dieser Link gehört zu einem anderen Turnierbogen und kann hier nicht übernommen werden.'));
    return 'rejected';
  }

  async function applyServerShare(value, opts) {
    const input = parsedServerInput(value);
    const known = await TStore.serverBinding(opts.sheet);
    const id = input.id;
    const token = input.token || (known && known.id === id && known.token) || '';
    return apiGet('/share.php?id=' + encodeURIComponent(id)).then(function (env) {
      if (!safeServerFile(env) || env.formatVersion !== 2
          || !Number.isSafeInteger(env.revision) || env.revision < 1
          || typeof env.title !== 'string' || typeof env.type !== 'string'
          || !Array.isArray(env.teams) || typeof env.protected !== 'boolean') {
        throw new Error(tx('share.invalid', 'Der Link enthält keine gültigen Turnierdaten.'));
      }
      const mismatch = handleSheetMismatch(env.sheet, opts, SERVER_PREFIX + id + (token ? '&edit=' + token : ''));
      if (mismatch) return mismatch === 'redirect';
      const info = shareInfo(env);
      return serverUnlockLoop(id, env, info, opts, 0, token);
    }, function (err) {
      if (err.network) {
        // Link bleibt bewusst stehen: Dein Turnier auf diesem Gerät bleibt
        // unverändert; ein Neuladen der Seite versucht es automatisch
        // erneut, z. B. sobald wieder eine Internetverbindung besteht.
        alert(tx('share.load.network',
          'Der geteilte Turnierlink konnte gerade nicht geladen werden:\n{message}'
          + '\n\nDein aktuelles Turnier auf diesem Gerät ist davon nicht betroffen.'
          + ' Bitte Internetverbindung prüfen und die Seite neu laden, um es erneut zu versuchen.', { message: errMsg(err) }));
        return false;
      }
      clearHash();
      if (err.status === 404) alert(tx('share.invalid404', 'Der Link enthält keine gültigen Turnierdaten (oder wurde bereits gelöscht).'));
      else alert(tx('share.load.server', 'Das geteilte Turnier konnte nicht geladen werden (Serverfehler):\n{message}', { message: errMsg(err) }));
      return false;
    });
  }

  function serverUnlockLoop(id, env, info, opts, tries, token) {
    let pw = '';
    if (env.protected && !token) {
      pw = prompt(tx('share.pwPrompt', 'Geteiltes Turnier "{info}" ist passwortgeschützt.\nBitte Passwort eingeben:', { info: info }), '');
      if (pw === null) { clearHash(); return Promise.resolve(false); } // abgebrochen
    }

    return apiPost('/share.php?action=unlock', { id: id, password: pw, editToken: token || '' }).then(function (full) {
      return { full: full };
    }, function (err) { return { err: err }; }).then(function (r) {
      if (r.full) {
        const full = r.full;
        if (!safeServerFile(full) || full.formatVersion !== 2 || full.sheet !== env.sheet
            || !Number.isSafeInteger(full.revision) || full.revision < 1
            || typeof full.canEdit !== 'boolean' || typeof full.title !== 'string'
            || typeof full.type !== 'string' || !Array.isArray(full.teams)
            || typeof full.protected !== 'boolean' || !full.snapshot || typeof full.snapshot !== 'object') {
          throw new Error(tx('server.protocol', 'Der Server unterstützt das aktuelle Turnierformat nicht. Bitte Backend aktualisieren.'));
        }
        const binding = {
          instance: secret(), id: id, revision: full.revision,
          readOnly: !(token && full.canEdit),
          token: token && full.canEdit ? token : null,
          published: snapshotSignature(full.snapshot)
        };
        return confirmAndApplySnapshot(info, full.snapshot, opts, binding);
      }
      const err = r.err;
      if (err.network) {
        // Link bleibt stehen, kein lokaler Datenverlust - siehe Kommentar
        // in applyServerShare(). Der Nutzer kann die Seite neu laden,
        // sobald wieder eine Verbindung besteht.
        alert(tx('share.unlock.network',
          'Konnte den Server gerade nicht erreichen:\n{message}'
          + '\n\nDein aktuelles Turnier auf diesem Gerät ist davon nicht betroffen.'
          + ' Bitte Internetverbindung prüfen und die Seite neu laden.', { message: errMsg(err) }));
        return false;
      }
      if (err.code === 'wrong_password' && tries + 1 < MAX_PW_TRIES) {
        alert(tx('share.pwRetry', 'Falsches Passwort, bitte erneut versuchen.'));
        return serverUnlockLoop(id, env, info, opts, tries + 1, token);
      }
      clearHash();
      if (err.code === 'wrong_password') alert(tx('share.pwAbort', 'Falsches Passwort – Übernahme abgebrochen.'));
      else if (err.code === 'too_many_attempts') alert(tx('share.tooMany', 'Zu viele Versuche – bitte später erneut versuchen.'));
      else alert(tx('share.load.failed', 'Das geteilte Turnier konnte nicht geladen werden:\n{message}', { message: errMsg(err) }));
      return false;
    });
  }

  async function applyOfflineShare(hashValue, opts) {
    const env = offlineDecodeEnvelope(hashValue);
    if (!env) { clearHash(); alert(tx('share.invalidOffline', 'Ungültiger Link.')); return false; }
    if (env.enc) {
      try { secureCrypto(); }
      catch (e) { clearHash(); alert(e.message); return false; }
    }
    const mismatch = handleSheetMismatch(env.sheet, opts, OFFLINE_PREFIX + hashValue);
    if (mismatch) return mismatch === 'redirect';

    const info = shareInfo(env);

    let snapshot = null, tries = 0;
    while (snapshot == null) {
      let pw = '';
      if (env.enc) {
        pw = prompt(tx('share.pwPrompt', 'Geteiltes Turnier "{info}" ist passwortgeschützt.\nBitte Passwort eingeben:', { info: info }), '');
        if (pw === null) { clearHash(); return false; } // abgebrochen
      }
      try { snapshot = await offlineResolveSnapshot(env, pw); }
      catch (e) {
        tries++;
        if (!env.enc || tries >= MAX_PW_TRIES) {
          clearHash();
          alert(env.enc ? tx('share.pwAbort', 'Falsches Passwort – Übernahme abgebrochen.')
            : tx('share.invalidOffline', 'Ungültiger Link.'));
          return false;
        }
        alert(tx('share.pwRetry', 'Falsches Passwort, bitte erneut versuchen.'));
      }
    }

    return confirmAndApplySnapshot(info, snapshot, opts);
  }

  /* Gemeinsamer letzter Schritt beider Varianten: Nutzer bestätigen lassen,
     dann in EINER IndexedDB-Transaktion den bisherigen Stand sichern und den
     geteilten Snapshot übernehmen. Neu geladen wird erst, wenn die
     Transaktion dauerhaft abgeschlossen ist. Schlägt das Speichern fehl,
     bleibt der Link in der Adresszeile (Neuladen = neuer Versuch) und der
     bisherige Stand ist unverändert. → Promise<boolean> */
  function confirmAndApplySnapshot(info, snapshot, opts, binding) {
    if (typeof TArchive === 'undefined' || !TArchive.validShareSnapshot
        || !opts || !TArchive.validShareSnapshot(snapshot, opts.sheet)) {
      clearHash();
      alert(tx('share.invalid', 'Der Link enthält keine gültigen Turnierdaten.'));
      return Promise.resolve(false);
    }
    const ok = confirm(tx('share.confirmApply',
      'Geteiltes Turnier gefunden: "{info}".\n\n'
      + 'Übernehmen? Das aktuelle Turnier auf diesem Gerät wird vorher automatisch\n'
      + 'gesichert und bleibt über die Startseite abrufbar.', { info: info })
    );
    if (!ok) { clearHash(); return Promise.resolve(false); }
    if (typeof TArchive === 'undefined' || !TArchive.importSnapshot) {
      alert(tx('share.noStorage', 'Das geteilte Turnier konnte nicht übernommen werden: Speicher nicht verfügbar.'));
      return Promise.resolve(false);
    }

    return TArchive.importSnapshot(opts, snapshot, binding).then(function () {
      /* Explizit mit ?id= (und ggf. ?mode=) neu öffnen: ein bloßes reload()
         ohne ?id= ließe Auswahl-Overlay/autoId() einen ANDEREN (leeren)
         Speicherplatz öffnen – die übernommenen Daten wären unsichtbar. */
      const target = opts && opts.sheet ? urlForSheet(opts.sheet, opts) : null;
      clearHash();
      if (target) location.replace(target);
      else location.reload();
      return true;
    }, function (err) {
      if (err && err.code === 'invalid-snapshot') {
        clearHash();
        alert(tx('share.invalid', 'Der Link enthält keine gültigen Turnierdaten.'));
        return false;
      }
      alert(tx('share.saveFailed', 'Das geteilte Turnier konnte nicht gespeichert werden:\n{message}'
        + '\n\nDein bisheriges Turnier auf diesem Gerät ist unverändert.'
        + ' Bitte Speicherplatz prüfen und die Seite neu laden, um es erneut zu versuchen.', { message: errMsg(err) }));
      return false;
    });
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

  function offlineShareUrl(input) {
    try {
      const url = new URL(String(input || '').trim(), location.href);
      if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.origin !== location.origin
          || !url.hash.startsWith(OFFLINE_PREFIX) || !url.hash.slice(OFFLINE_PREFIX.length)
          || !/(^|\/)Turnierbogen_[A-Za-z0-9_-]+\.html$/.test(url.pathname)) return '';
      return url.href;
    } catch (e) {
      return '';
    }
  }

  function openByCode(input) {
    const offlineUrl = offlineShareUrl(input);
    if (offlineUrl) { location.href = offlineUrl; return; }
    /* App: eingefügter öffentlicher Offline-Link → dieselbe Seite im App-
       Bundle öffnen (Server-Links/Codes laufen unten über die Vorschau). */
    if (nativeApp() && typeof TNative !== 'undefined' && TNative && typeof TNative.localPageFromPublicUrl === 'function') {
      const local = TNative.localPageFromPublicUrl(input);
      if (local && local.indexOf(OFFLINE_PREFIX) !== -1) { location.href = local; return; }
    }
    if (!cloudSharingEnabled()) { alert(cloudSharingError().message); return; }
    let parsed;
    try { parsed = parsedServerInput(input); } catch (e) { alert(e.message); return; }
    const id = parsed.id;
    if (!id) { alert(tx('code.invalidInput', 'Bitte einen gültigen Code oder Link eingeben.')); return; }

    apiGet('/share.php?id=' + encodeURIComponent(id)).then(function (env) {
      const file = safeServerFile(env);
      if (!file) {
        alert(tx('code.noPage', 'Zu diesem Code konnte keine passende Turnierseite gefunden werden.'));
        return;
      }
      /* Der Code kennt nur die Datei – der Snapshot liegt aber unter den
         Speicher-Schlüsseln des Absenders (base.<id>). Ohne dieselbe ?id=
         wäre "sheet" auf der Zielseite ein anderes und der Import würde als
         "anderer Turnierbogen" abgelehnt. id aus env.sheet ableiten
         (Konvention: "base" bzw. "base.<id>", Basen enthalten keinen Punkt). */
      const sheet = String(env.sheet || '');
      const dot = sheet.indexOf('.');
      const sid = dot >= 0 ? sheet.slice(dot + 1) : '_base_';
      const target = /[?&]id=/.test(file) ? file
        : file + (file.indexOf('?') >= 0 ? '&' : '?') + 'id=' + encodeURIComponent(sid);
      location.href = target + SERVER_PREFIX + encodeURIComponent(id) + (parsed.token ? '&edit=' + parsed.token : '');
    }).catch(function (err) {
      if (err.network) {
        alert(tx('code.network', 'Der Code konnte gerade nicht überprüft werden:\n{message}'
          + '\n\nBitte Internetverbindung prüfen und erneut versuchen.', { message: errMsg(err) }));
        return;
      }

      if (err.status === 404) alert(tx('code.notFound', 'Dieser Code ist ungültig oder das Turnier wurde bereits gelöscht.'));
      else alert(tx('code.server', 'Der Code konnte nicht geladen werden (Serverfehler):\n{message}', { message: errMsg(err) }));
    });
  }

  function safeServerFile(env) {
    const pages = {
      'ko-flex': 'Turnierbogen_KO_System.html', 'de-flex': 'Turnierbogen_Doppel_KO_System.html',
      'gruppen-final': 'Turnierbogen_Gruppen_Finalrunde.html', mpp: 'Turnierbogen_Modified_Pool_Play.html',
      kingqueen: 'Turnierbogen_King_Queen.html', koc: 'Turnierbogen_King_Queen_of_the_Court.html',
      runden_rr: 'Turnierbogen_Runden_System.html?mode=rr',
      runden_swiss: 'Turnierbogen_Runden_System.html?mode=swiss',
      flex_rr: 'Turnierbogen_Flex_Turnier.html?mode=rr', flex_swiss: 'Turnierbogen_Flex_Turnier.html?mode=swiss'
    };
    if (!env || !/^[a-z_-]+(?:\.[A-Za-z0-9_-]+)?$/.test(String(env.sheet || ''))) return null;
    const base = sheetParts(env.sheet).base;
    return Object.prototype.hasOwnProperty.call(pages, base) ? pages[base] : null;
  }

  if (typeof window !== 'undefined') {
    let statusTimer = null;
    window.addEventListener('beachl:storage-saved', function (e) {
      if (!e.detail || !e.detail.sheetId || !e.detail.revision || !document.getElementById('tserver-status')) return;
      clearTimeout(statusTimer);
      statusTimer = setTimeout(function () {
        if (statusOpts && statusOpts.sheet === e.detail.sheetId) renderServerStatus(statusOpts).catch(function () {});
      }, 50);
    });
  }

  return {
    buildShareUrl: buildServerShareUrl, openShareDialog, applyPendingShare, openByCode, openInfoDialog,
    publish, transferUrl, independentCopy, safeServerFile,
    offlineEncode, offlineDecodeEnvelope, offlineResolveSnapshot, buildOfflineShareUrl
  };
});
