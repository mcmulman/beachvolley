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
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TShare = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
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
      if (b && b.readOnly) {
        TStore.detachServerInView(view, o.sheet);
        b = null;
      }
      if (!b) {
        b = { instance: secret(), token: secret(), revision: 0, id: null };
        bindInView(view, o.sheet, b);
      }
      return b;
    });
    async function transmit(pending) {
      let data;
      try {
        data = await apiPost('/share.php?action=' + pending.action, pending.body);
      } catch (err) {
        /* Altes Backend kennt places/final nicht (422): einmal ohne diese Felder erneut senden. */
        const tv = pending.body.teamView;
        if (err && err.status === 422 && tv && ('places' in tv || 'final' in tv)) {
          delete tv.places; delete tv.final;
          pending.body.requestKey = secret();
          await TStore.transaction(function (view) {
            const cur = TStore.serverBindingInView(view, o.sheet);
            if (cur && cur.instance === binding.instance && cur.pending) { cur.pending = pending; bindInView(view, o.sheet, cur); }
          });
          return transmit(pending);
        }
        /* Dauerhaft abgelehnte Anfrage nicht ewig wiederholen: neu aus dem lokalen Stand aufbauen. */
        if (err && [400, 403, 409, 413, 422].indexOf(err.status) >= 0) {
          await TStore.transaction(function (view) {
            const cur = TStore.serverBindingInView(view, o.sheet);
            if (cur && cur.instance === binding.instance && cur.pending && cur.pending.body.requestKey === pending.body.requestKey) {
              delete cur.pending; bindInView(view, o.sheet, cur);
            }
          }).catch(function () {});
        }
        throw err;
      }
      if (!data || !/^[A-Za-z0-9]{1,12}$/.test(data.id) || !Number.isSafeInteger(data.revision)
          || data.revision < 1 || data.formatVersion !== 2 || (binding.id && data.id !== binding.id)) {
        throw new Error(tx('server.protocol', 'Der Server unterstützt das aktuelle Turnierformat nicht. Bitte Backend aktualisieren.'));
      }
      binding = await TStore.transaction(function (view) {
        const current = TStore.serverBindingInView(view, o.sheet);
        if (!current || current.instance !== binding.instance) throw new Error(tx('server.replaced', 'Das lokale Turnier wurde inzwischen ersetzt. Der Upload gehört zum vorherigen Turnier.'));
        current.id = data.id;
        current.revision = Math.max(current.revision, data.revision);
        if (pending.body.teamView === null) {
          current.teamView = false; delete current.teamViewOff; delete current.viewCode;
        } else if (data.viewCode !== undefined) current.viewCode = data.viewCode;
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
    for (let n = 1; n <= count; n++) teams.push(root.TSport
      ? root.TSport.teamLabel(record, n, (o.sheet.indexOf('kingqueen') === 0 ? 'Person ' : 'Team ') + n)
      : record.teamNames && record.teamNames[n] || 'Team ' + n);
    const body = {
      formatVersion: 2, sheet: o.sheet, file: o.file || '', type: o.type || '',
      title: record.title || o.title || '', teams: teams.length ? teams : (Array.isArray(o.teams) ? o.teams : []),
      snapshot: snapshot, password: pw || '', editToken: binding.token, requestKey: secret()
    };
    if (binding.id) {
      body.id = binding.id; body.expectedRevision = binding.revision;
      if (!pw && !removePassword) delete body.password;
    }
    if (binding.teamView === true && typeof TTeamView !== 'undefined') {
      const view = await TTeamView.build(o);
      if (view) body.teamView = view;
    } else if (binding.teamViewOff) body.teamView = null;
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
    live.conflict = false;
    await renderServerStatus(o);
    return data;
  }

  /* ============================================================ Live-Sicherung
     Optional pro Turnier (binding.live). Nach jedem lokalen Speichern wird der
     Stand entprellt per publish() gespiegelt; IndexedDB bleibt die Wahrheit.
     Ein Lauf zur Zeit, danach erneute Prüfung. Nachsenden bei online,
     Sichtbarwerden und Seitenstart; kein Verlass auf pagehide/Background Sync. */
  const LIVE_DEBOUNCE_MS = 3000;
  const LIVE_BACKOFF_MS = [5000, 15000, 60000];
  const live = { timer: null, retry: null, running: null, again: false, force: false, fails: 0, state: 'busy', conflict: false, on: false };

  function liveSchedule(delay) {
    clearTimeout(live.timer);
    live.timer = setTimeout(function () { liveRun(); }, delay);
  }
  function liveRun(force) {
    if (force) live.force = true;
    if (live.running) { live.again = true; return live.running; }
    clearTimeout(live.timer); clearTimeout(live.retry);
    live.running = liveLoop().then(function () { live.running = null; }, function () { live.running = null; });
    return live.running;
  }
  async function liveLoop() {
    const o = statusOpts;
    if (!o) return;
    try {
      do {
        live.again = false;
        const force = live.force; live.force = false;
        const b = await TStore.serverBinding(o.sheet);
        live.on = !!(b && b.live);
        if (!live.on || live.conflict || live.state === 'gone') return;
        await TStore.whenIdle();
        if (!force && !b.pending && b.id && b.published === snapshotSignature(await readSnapshot(o))) {
          live.state = 'synced'; live.fails = 0;
          continue;
        }
        live.state = 'busy';
        try {
          const data = await publish(o);
          live.fails = 0; live.state = 'synced';
          if (data.dirty) live.again = true;
        } catch (err) {
          if (err && err.status === 412) { live.conflict = true; live.state = 'conflict'; return; }
          live.again = false;
          if (err && (err.status === 410 || err.status === 404)) { live.state = 'gone'; return; }
          if (err && (err.network || err.status >= 500)) {
            live.state = err.network ? 'offline' : 'error';
            live.retry = setTimeout(liveRun, LIVE_BACKOFF_MS[Math.min(live.fails, LIVE_BACKOFF_MS.length - 1)]);
            live.fails++;
          } else live.state = 'error';
          return;
        }
      } while (live.again);
    } finally {
      await renderServerStatus(o).catch(function () {});
    }
  }
  async function setLive(o, on) {
    live.conflict = false; live.fails = 0; live.state = 'busy';
    clearTimeout(live.timer); clearTimeout(live.retry);
    await TStore.whenIdle();
    await TStore.transaction(function (view) {
      let b = TStore.serverBindingInView(view, o.sheet);
      if (b && b.readOnly) { TStore.detachServerInView(view, o.sheet); b = null; }
      if (!b) {
        if (!on) return;
        b = { instance: secret(), token: secret(), revision: 0, id: null };
      }
      b.live = !!on;
      bindInView(view, o.sheet, b);
    });
    statusOpts = o;
    live.on = !!on;
    if (on) await liveRun();
    else await renderServerStatus(o);
  }
  function confirmLive(o, thenTeam) {
    openInfoDialog({
      title: tx('server.live.title', 'Live-Sicherung einschalten?'),
      bodyHtml: '<p>' + escapeHtml(tx('server.live.consent', 'Turnierdaten inklusive Namen werden online gespeichert. Nach 30 Tagen ohne Änderung werden sie gelöscht. Link nur an Mitorganisator:innen geben.')) + '</p>',
      confirmLabel: tx('server.live.on', 'Einschalten'),
      onCancel: function () { renderShareForm(o); },
      onConfirm: function () {
        renderShareLoading(tx('server.live.starting', 'Live-Sicherung wird eingeschaltet …'));
        setLive(o, true).then(function () {
          if (!thenTeam) return backToForm(o);
          return setTeamView(o, true).then(function () { backToForm(o); });
        }, function () { backToForm(o); });
      }
    });
  }
  async function setTeamView(o, on) {
    await TStore.transaction(function (view) {
      const b = TStore.serverBindingInView(view, o.sheet);
      if (!b) return;
      if (on) { b.teamView = true; delete b.teamViewOff; } else { b.teamView = false; b.teamViewOff = true; }
      bindInView(view, o.sheet, b);
    });
    await liveRun(true);
    const b = await TStore.serverBinding(o.sheet);
    if (!on) return;
    if (b && b.viewCode && live.state === 'synced') TTeamView.openDialog(o, b.viewCode);
    else alert(tx('server.team.failed', 'Team-Live-View nicht übertragen. Bitte Live-Sicherung prüfen.'));
  }

  async function independentCopy(o) {
    await TStore.whenIdle();
    await TStore.transaction(function (view) { TStore.detachServerInView(view, o.sheet); });
    location.reload();
  }

  async function deleteFromServer(o) {
    const b = await TStore.serverBinding(o.sheet);
    if (!b || !b.id || !b.token || b.readOnly) return;
    try {
      await apiPost('/share.php?action=delete', { id: b.id, editToken: b.token });
    } catch (err) {
      if (!err || (err.status !== 404 && err.status !== 410)) { alert(err && err.message); return; }
    }
    await independentCopy(o);
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
        title: tx('server.transfer', 'Bearbeitungslink anzeigen'),
        bodyHtml: '<p>' + escapeHtml(tx('server.secretWarning', 'Geheimer Link: erlaubt Änderungen. Nur an Mitorganisator:innen geben, nie öffentlich. Sicherungsdateien enthalten ihn nicht.'))
          + '</p><input id="tserver-secret" type="text" readonly class="tshare-input">'
      }).querySelector('#tserver-secret').value = url;
    });
  }

  /* Zustand der Live-Sicherung für Statusleiste und Teilen-Dialog. */
  async function liveStatus(b, o) {
    const dirty = !!b && b.published !== snapshotSignature(await readSnapshot(o));
    const key = !b || !b.live ? 'off' : live.conflict ? 'conflict'
      : live.state === 'synced' && !dirty ? 'synced' : live.state === 'busy' || live.state === 'synced' ? 'busy' : live.state;
    const label = { off: ['Aus', 'Aus'], synced: ['Live, synchron', 'Live-Sicherung an, synchron.'],
      busy: ['Live, überträgt …', 'Live-Sicherung an, Änderungen werden übertragen …'],
      offline: ['Wartet auf Verbindung', 'Keine Verbindung. Änderungen bleiben lokal und werden später gesendet.'],
      conflict: ['Konflikt', 'Pausiert: Jemand anderes hat gespeichert. Dein Stand bleibt lokal erhalten.'],
      gone: ['Online-Turnier abgelaufen', 'Online-Turnier abgelaufen oder gelöscht. Dein Stand bleibt lokal erhalten.'],
      error: ['Live, Fehler', 'Senden fehlgeschlagen. Änderungen bleiben lokal, wir versuchen es erneut.'] }[key];
    return { key: key, dirty: dirty, short: tx('server.live.short.' + key, label[0]), msg: tx('server.live.msg.' + key, label[1]) };
  }

  /* Weitere Serveraktionen im Teilen-Dialog („Weitere Optionen“). */
  function serverActions(o, b) {
    const list = [{ act: 'copy-local', key: 'server.copy', label: 'Als lokale Kopie weiterarbeiten',
      hint: 'Trennt dieses Gerät vom Online-Turnier. Dessen Stand bleibt unverändert.', fn: function () {
        if (confirm(tx('server.copyConfirm', 'Serverbindung lösen? Dieser Stand wird eine unabhängige lokale Kopie; der Server bleibt unverändert.'))) independentCopy(o);
      } }];
    if (b.id) {
      list.push({ act: 'load', key: 'server.load', label: 'Online-Stand laden',
        hint: 'Sichert deinen Entwurf und lädt dann die Online-Version.', fn: function () {
          location.hash = SERVER_PREFIX + b.id + (b.token ? '&edit=' + b.token : '');
          location.reload();
        } });
      if (!b.readOnly) list.push({ act: 'open-transfer', key: 'server.transfer', label: 'Bearbeitungslink anzeigen',
        hint: 'Öffnet das Turnier in einem anderen Browser. Nur an Mitorganisator:innen geben.',
        fn: function () { openTransfer(o); } });
    }
    if (cloudSharingEnabled() && b.id && b.token && !b.readOnly) {
      list.push({ act: 'delete', key: 'server.delete', label: 'Online-Turnier löschen', danger: true,
        hint: 'Löscht Links und Team-Live-View endgültig. Dein lokaler Stand bleibt.', fn: function () {
          if (confirm(tx('server.deleteConfirm', 'Turnier endgültig vom Server löschen? Alle Links und QR-Codes werden ungültig. Dein lokaler Stand bleibt erhalten.'))) deleteFromServer(o);
        } });
    }
    return list;
  }

  let statusOpts = null;
  /* Live-Status als Punkt am Teilen-Button (grau aus, grün synchron, gelb busy/offline, rot Fehler). */
  async function renderHeaderLive(o, b) {
    const share = document.getElementById('btnShare');
    if (!share || !share.parentNode) return;
    const st = await liveStatus(b, o);
    const stTitle = tx('share.sec.live.title', 'Live-Sicherung') + ': ' + st.short;
    /* Status als Punkt am Teilen-Button. */
    if (!share.hasAttribute('data-base-label')) {
      share.setAttribute('data-base-label', share.getAttribute('aria-label') || share.textContent.replace(/\s+/g, ' ').trim());
    }
    share.setAttribute('data-live', st.key);
    const baseLabel = share.getAttribute('data-base-label');
    const full = st.key === 'off' ? baseLabel : baseLabel + ' – ' + stTitle;
    share.setAttribute('aria-label', full);
    share.setAttribute('title', full);
  }
  /* Kompakte Zusammenfassung; bedient wird alles im Teilen-Dialog. */
  async function renderServerStatus(o) {
    if (typeof document === 'undefined' || !o || !o.sheet) return;
    statusOpts = o;
    const b = await TStore.serverBinding(o.sheet);
    live.on = !!(b && b.live);
    if (live.on && !live.started) { live.started = true; liveRun(); }
    await renderHeaderLive(o, b).catch(function () {});
    const old = document.getElementById('tserver-status');
    const wasOpen = !!(old && old.open);
    if (old) old.remove();
    if (!b || (!b.id && !b.live)) return;
    const bar = document.createElement('details');
    bar.id = 'tserver-status'; bar.className = 'noprint tserver-status';
    bar.open = wasOpen;
    const summary = document.createElement('summary');
    const st = await liveStatus(b, o);
    summary.textContent = tx('server.heading', 'Serververbindung') + ' · ' + st.short;
    bar.appendChild(summary);
    const status = document.createElement('p');
    status.className = 'tserver-status-message';
    status.textContent = b.live ? st.msg
      : b.teamView ? tx('server.live.msg.staleTeam', 'Live-Sicherung aus – Team-Live-View nicht aktuell.')
      : (st.dirty
        ? tx('server.dirty', 'Lokale Änderungen sind noch nicht veröffentlicht. Öffne „Teilen“, um sie auf dem Server zu speichern.')
        : tx('server.bound', 'Verbunden. Änderungen werden lokal gespeichert; über „Teilen“ veröffentlichst du sie auf dem Server.'));
    bar.appendChild(status);
    const item = document.createElement('div');
    item.className = 'tserver-action';
    const open = document.createElement('button');
    open.type = 'button'; open.className = 'nbtn tserver-action-button';
    open.textContent = tx('server.openShare', 'Teilen öffnen');
    open.addEventListener('click', function () { renderShareForm(o); });
    const description = document.createElement('small');
    description.textContent = tx('server.openShareHint', 'Live-Sicherung, Team-Live-View und mehr.');
    item.appendChild(open);
    item.appendChild(description);
    bar.appendChild(item);
    const config = document.getElementById('configSection');
    (config || document.body).appendChild(bar);
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
      '.tshare-panel{position:relative;background:#fff;background:var(--app-surface,#fff);color:#1a1a2e;width:100%;max-width:440px;border-radius:14px;border-radius:var(--app-radius-lg,14px);' +
        'box-shadow:0 12px 40px rgba(0,0,0,.28);max-height:100%;min-width:0;min-height:0;display:flex;flex-direction:column;' +
        'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;}' +
      '.tshare-panel:focus{outline:none;}.tshare-panel:focus-visible{outline:none;}' +
      '.tshare-panel button,.tshare-panel input,.tshare-panel summary{font-family:inherit;}' +
      '.tshare-head{display:flex;align-items:center;' +
        'padding:16px 64px 16px 16px;border-bottom:1px solid #e2e8f0;flex:0 0 auto;}' +
      '.tshare-head > * + *{margin-left:12px;}' +
      '.tshare-head h3{margin:0;min-width:0;word-wrap:break-word;overflow-wrap:break-word;font-size:18px;line-height:1.3;font-weight:800;color:#1a3a5c;color:var(--app-blue-dark,#1a3a5c);}' +
      '.tshare-body{padding:16px;font-size:14px;line-height:1.45;min-height:0;overflow:auto;-webkit-overflow-scrolling:touch;word-wrap:break-word;overflow-wrap:break-word;}' +
      '.tshare-body p{margin:0 0 8px;color:#3a4356;}' +
      '.tshare-hint{font-size:13px;color:#5a6375;color:var(--app-muted,#5a6375);}' +
      '.tshare-error{color:#b3261e;font-weight:600;}' +
      '.tshare-options{display:flex;flex-direction:column;gap:8px;margin-bottom:12px;}' +
      '.tshare-opt{display:flex;gap:12px;align-items:flex-start;border:1.5px solid #cfd8e3;' +
        'border-radius:10px;padding:12px;cursor:pointer;min-height:44px;box-sizing:border-box;}' +
      '.tshare-opt.is-checked{border-color:#1f6fa8;background:#e8f3fb;box-shadow:inset 0 0 0 1px #1f6fa8;}' +
      '.tshare-opt input{margin:1px 0 0;width:20px;height:20px;flex:0 0 auto;}' +
      '.tshare-opt>span{min-width:0;}' +
      '.tshare-opt strong{display:block;font-size:14px;color:#1a1a2e;}' +
      '.tshare-opt small{display:block;color:#5a6375;font-size:13px;margin-top:2px;}' +
      '.tshare-sec{border:1px solid #dce5ef;border-radius:12px;padding:12px;margin:0 0 12px;background:#fff;}' +
      '.tshare-sec > summary{font-size:15px;font-weight:700;color:#1a3a5c;cursor:pointer;min-height:44px;line-height:44px;margin:-12px;padding:0 12px;list-style:none;position:relative;}' +
      '.tshare-sec > summary::-webkit-details-marker{display:none;}' +
      '.tshare-sec > summary::after{content:"";position:absolute;right:16px;top:50%;width:8px;height:8px;margin-top:-6px;border-right:2px solid #5a6375;border-bottom:2px solid #5a6375;-webkit-transform:rotate(45deg);transform:rotate(45deg);}' +
      '.tshare-sec[open] > summary{margin-bottom:0;}' +
      '.tshare-sec[open] > summary::after{margin-top:-2px;-webkit-transform:rotate(-135deg);transform:rotate(-135deg);}' +
      '.tshare-sec > summary:focus{outline:2px solid #1f6fa8;outline-offset:-2px;border-radius:10px;}' +
      '.tshare-sec > summary:focus:not(:focus-visible){outline:none;}' +
      '.tshare-sec > summary:focus-visible{outline:2px solid #1f6fa8;outline-offset:-2px;border-radius:10px;}' +
      '.tshare-sec > .tshare-hint{margin:12px 0 12px;}' +
      '.tshare-sec-primary h4{margin:0 0 4px;font-size:15px;font-weight:800;color:#1a3a5c;}' +
      '.tshare-sec-primary > .tshare-hint{margin:0 0 8px;}' +
      '.tshare-sec-live.is-on{border-color:#0a7d2c;background:#f2faf4;box-shadow:inset 0 0 0 1px #0a7d2c;}' +
      '.tshare-switch{display:flex;align-items:center;min-height:44px;font-size:14px;font-weight:700;color:#1a1a2e;cursor:pointer;}' +
      '.tshare-switch input{-webkit-appearance:none;appearance:none;flex:0 0 auto;width:44px;height:26px;margin:0 12px 0 0;border-radius:13px;border:0;cursor:pointer;' +
        'background:#76849a;background-image:radial-gradient(circle at 13px 13px,#fff 9px,rgba(255,255,255,0) 10px);background-repeat:no-repeat;background-size:44px 26px;background-position:0 0;}' +
      '.tshare-switch input:checked{background-color:#0a7d2c;background-image:radial-gradient(circle at 31px 13px,#fff 9px,rgba(255,255,255,0) 10px);}' +
      '.tshare-switch input:focus{outline:2px solid #1f6fa8;outline-offset:2px;}' +
      '.tshare-switch input:focus:not(:focus-visible){outline:none;}' +
      '.tshare-switch input:focus-visible{outline:2px solid #1f6fa8;outline-offset:2px;}' +
      '.tshare-live-status{margin:0 0 4px !important;font-size:13px;font-weight:700;color:#5a6375 !important;}' +
      '.tshare-live-status.is-synced{color:#0a7d2c !important;}' +
      '.tshare-live-status.is-conflict,.tshare-live-status.is-gone,.tshare-live-status.is-error{color:#b3261e !important;}' +
      '.tshare-btn-block{display:block;width:100%;box-sizing:border-box;margin:8px 0 0;}' +
      '.tshare-need{margin:8px 0 0 !important;}' +
      '.tshare-org .tshare-options{margin-bottom:12px;}' +
      '.tshare-action{margin:12px 0 0;}.tshare-action .tshare-btn-block{margin-top:0;}.tshare-action small{display:block;margin-top:4px;color:#5a6375;font-size:13px;}' +
      '.tshare-advanced .tshare-hint{margin:12px 0 0;}' +
      '.tshare-password{padding:0;}' +
      '.tshare-password>small,.tshare-pw-update small{display:block;margin-top:4px;color:#5a6375;font-size:13px;}' +
      '.tshare-pw-update[hidden]{display:none;}' +
      '.tshare-check{display:flex;align-items:center;min-height:44px;font-size:14px;color:#1a1a2e;cursor:pointer;}' +
      '.tshare-check input{width:20px;height:20px;margin:0 12px 0 0;flex:0 0 auto;}' +
      '.tshare-field{display:block;font-size:13px;font-weight:700;color:#3a4356;margin:0 0 4px;}' +
      '.tshare-field small{font-weight:400;color:#5a6375;}' +
      '.tshare-input{display:block;width:100%;padding:10px 12px;font-size:14px;color:#1a1a2e;min-height:44px;' +
        'border:1.5px solid #8a96a8;border-radius:9px;background:#fff;box-sizing:border-box;}' +
      '.tshare-input::placeholder{color:#5a6375;opacity:1;}' +
      '.tshare-input:focus{outline:none;border-color:#1f6fa8;box-shadow:0 0 0 2px #1f6fa8;}' +
      '.tshare-linkrow{display:flex;gap:8px;margin-bottom:12px;}' +
      '.tshare-linkrow input{flex:1;min-width:0;}' +
      '.tshare-qr-wrap{text-align:center;margin:0 auto 12px;padding:12px;background:#f3f6fa;border-radius:12px;}' +
      '.tshare-qr-label{margin:0 0 8px !important;font-weight:700;color:#1a3a5c !important;}' +
      '.tshare-qr{display:block;width:220px;max-width:100%;height:auto;margin:0 auto;background:#fff;border:8px solid #fff;}' +
      '.tshare-qr[hidden]{display:none;}' +
      '.tshare-copied{color:#0a7d2c !important;font-size:13px;font-weight:600;margin:0 0 8px;}' +
      '.tshare-loading{display:flex;flex-direction:column;align-items:center;gap:12px;padding:16px 0 8px;color:#3a4356;}' +
      '.tshare-spinner{width:30px;height:30px;border-radius:50%;border:3px solid #ccd8e8;' +
        'border-top-color:#1f6fa8;animation:tshare-spin .8s linear infinite;}' +
      '@keyframes tshare-spin{to{transform:rotate(360deg);}}' +
      '.tshare-foot{display:flex;justify-content:flex-end;flex-wrap:wrap;' +
        'padding:12px 16px 4px;border-top:1px solid #e2e8f0;flex:0 0 auto;}' +
      '.tshare-foot > *{margin:0 0 8px 8px;}' +
      '.tshare-btn{border:none;border-radius:9px;padding:10px 16px;font-size:14px;font-weight:700;font-family:inherit;' +
        'cursor:pointer;white-space:normal;min-height:44px;max-width:100%;word-wrap:break-word;}' +
      '.tshare-btn:disabled{background:#e6eaf0 !important;color:#5a6375 !important;border:none !important;cursor:not-allowed;}' +
      '.tshare-btn-primary{background:#1a3a5c;background:var(--app-blue-dark,#1a3a5c);color:#fff;}' +
      '.tshare-btn-primary:hover{background:#1f6fa8;}' +
      '.tshare-btn-ghost{background:#fff;color:#1a3a5c;border:1.5px solid #76849a;}' +
      '.tshare-btn-ghost:hover{border-color:#1f6fa8;}' +
      '.tshare-btn-danger{color:#b3261e;border-color:#b3261e;}' +
      '.tshare-btn-danger:hover{border-color:#b3261e;background:#fdf0ef;}' +
      '.tshare-btn:focus{outline:2px solid #1f6fa8;outline-offset:2px;}' +
      '.tshare-btn:focus:not(:focus-visible){outline:none;}' +
      '.tshare-btn:focus-visible{outline:2px solid #1f6fa8;outline-offset:2px;}' +
      '@media screen and (max-width:640px){.tshare-input{font-size:16px;}' +
        '.tshare-linkrow{flex-wrap:wrap;}.tshare-linkrow input{flex-basis:100%;}.tshare-linkrow .tshare-btn{width:100%;margin-top:8px;}.tshare-head{padding:12px 60px 12px 12px;}' +
        '.tshare-body{padding:12px;}.tshare-foot{padding:12px 12px 4px;}}' +
      '@media screen and (max-width:479px){.tshare-foot{flex-direction:column-reverse;flex-wrap:nowrap;}' +
        '.tshare-foot > *{margin:0 0 8px;width:100%;}}';
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
     opts: { title, bodyHtml, confirmLabel, cancelLabel, onConfirm, onCancel,
             altLabel, onAlt }  – altLabel/onAlt: optionale zweite Aktion
     (sekundär gestaltet, zwischen Abbrechen und der Hauptaktion). */
  function openInfoDialog(opts) {
    opts = opts || {};
    const confirmLabel = opts.confirmLabel || tx('share.continue', 'Weiter');
    const cancelLabel = opts.cancelLabel || tx('share.cancel', 'Abbrechen');
    const root = openShareModalShell(
      opts.title || '',
      opts.bodyHtml || '',
      '<button type="button" class="tshare-btn tshare-btn-ghost" data-act="cancel">' + escapeHtml(cancelLabel) + '</button>' +
      (opts.altLabel ? '<button type="button" class="tshare-btn tshare-btn-ghost" data-act="alt">' + escapeHtml(opts.altLabel) + '</button>' : '') +
      '<button type="button" class="tshare-btn tshare-btn-primary" data-act="confirm">' + escapeHtml(confirmLabel) + '</button>'
    );
    root.querySelector('[data-act="cancel"]').addEventListener('click', function () {
      closeShareModal();
      if (typeof opts.onCancel === 'function') opts.onCancel();
    });
    const alt = root.querySelector('[data-act="alt"]');
    if (alt) alt.addEventListener('click', function () {
      closeShareModal();
      if (typeof opts.onAlt === 'function') opts.onAlt();
    });
    root.querySelector('[data-act="confirm"]').addEventListener('click', function () {
      closeShareModal();
      if (typeof opts.onConfirm === 'function') opts.onConfirm();
    });
    return root;
  }

  function shareSection(cls, title, desc, innerHtml) {
    return '<section class="tshare-sec ' + cls + '"><h4>' + escapeHtml(title) + '</h4>' +
      '<p class="tshare-hint">' + escapeHtml(desc) + '</p>' + (innerHtml || '') + '</section>';
  }

  /* Nach Live-/Team-Änderungen den Dialog mit frischem Zustand neu aufbauen
     (nur, wenn der Nutzer ihn nicht inzwischen geschlossen hat). */
  function backToForm(o) { if (document.getElementById(MODAL_ID)) renderShareForm(o); }

  function renderShareForm(o) {
    return TStore.serverBinding(o.sheet).then(null, function () { return null; }).then(function (b) {
      return liveStatus(b, o).then(function (st) { buildShareForm(o, b, st); });
    });
  }

  function buildShareForm(o, b, st) {
    const cloud = cloudSharingEnabled();
    const liveOn = !!(b && b.live);
    const actions = b && (b.id || b.live) ? serverActions(o, b) : [];
    const btn = function (act, cls, text, extra) {
      return '<button type="button" class="tshare-btn ' + cls + '" data-act="' + act + '"' + (extra || '') + '>' + escapeHtml(text) + '</button>';
    };
    let primary = '';
    if (cloud) {
      primary += shareSection('tshare-sec-primary tshare-sec-live' + (liveOn ? ' is-on' : ''), tx('share.sec.live.title', 'Live-Sicherung'),
        tx('share.sec.live.desc', 'Speichert jede Änderung automatisch online.'),
        '<label class="tshare-switch"><input type="checkbox" id="tshare-live"' + (liveOn ? ' checked' : '') + '> <span>'
          + escapeHtml(tx('server.live.option', 'Automatisch speichern')) + '</span></label>' +
        '<p class="tshare-live-status is-' + st.key + '" id="tshare-live-status">' + escapeHtml(tx('share.live.status', 'Status: {state}', { state: st.short })) + '</p>' +
        (st.key === 'off' || st.key === 'synced' || st.key === 'busy' ? '' : '<p class="tshare-hint">' + escapeHtml(st.msg) + '</p>') +
        (st.key === 'conflict' ? btn('live-resolve', 'tshare-btn-ghost tshare-btn-block', tx('server.live.resolve', 'Konflikt lösen')) : '') +
        (st.key === 'gone' ? btn('live-copy', 'tshare-btn-ghost tshare-btn-block', tx('server.copy', 'Als lokale Kopie weiterarbeiten')) : ''));
      const teamTitle = tx('share.sec.team.title', 'Team-Live-View für Spieler:innen');
      if (typeof TTeamView === 'undefined' || !TTeamView.supported(o)) {
        primary += shareSection('tshare-sec-primary tshare-sec-team', teamTitle,
          tx('share.sec.team.unsupported', 'Für dieses Format nicht verfügbar.'), '');
      } else {
        primary += shareSection('tshare-sec-primary tshare-sec-team', teamTitle,
          tx('share.sec.team.desc', 'Spieler:innen scannen den QR-Code und sehen ihre Spiele live.'),
          btn('team-show', 'tshare-btn-primary tshare-btn-block', tx('server.team.open', 'QR-Code & Aushang anzeigen')) +
          (liveOn ? '' : '<p class="tshare-hint tshare-need">' + escapeHtml(tx('share.sec.team.needLive', 'Schaltet die Live-Sicherung ein. Der QR-Code kann schon vor dem Turnier ausgehängt werden.')) + '</p>') +
          (liveOn && b.teamView ? btn('team-end', 'tshare-btn-ghost tshare-btn-block', tx('server.team.end', 'Team-Live-View beenden')) +
            '<p class="tshare-hint tshare-need">' + escapeHtml(tx('server.team.endHint', 'Bestehende QR-Codes werden ungültig.')) + '</p>' : ''));
      }
    }
    const canUpdatePw = cloud && !!(b && b.id);
    const root = openShareModalShell(
      tx('share.title', 'Turnier teilen'),
      primary +
      '<details class="tshare-sec tshare-org"' + (liveOn ? '' : ' open') + '><summary>' + escapeHtml(tx('share.sec.org.title', 'Mit Organisator:innen teilen')) + '</summary>' +
      '<p class="tshare-hint">' + escapeHtml(tx('share.sec.org.desc', 'Andere öffnen eine bearbeitbare Kopie des Turniers.')) + '</p>' +
      '<div class="tshare-options" role="radiogroup" aria-label="' + escapeHtml(tx('share.sec.org.title', 'Mit Organisator:innen teilen')) + '">' +
        (cloud ? '<label class="tshare-opt"><input type="radio" name="tshare-mode" value="qr" checked>' +
          '<span><strong>' + escapeHtml(tx('share.qr.title', 'QR-Code / Turniercode')) + '</strong>' +
          '<small>' + escapeHtml(tx('share.qr.desc', 'Kurz und praktisch. Zum Öffnen ist Internet nötig.')) + '</small></span>' +
          '</label>' : '') +
        '<label class="tshare-opt"><input type="radio" name="tshare-mode" value="offline"' + (cloud ? '' : ' checked') + '>' +
        '<span><strong>' + escapeHtml(tx('share.offline.title', 'Offline-Link')) + '</strong>' +
        '<small>' + escapeHtml(tx('share.offline.desc', 'Enthält das ganze Turnier im Link. Geht ohne Internet, ist aber sehr lang.')) + '</small></span>' +
        '</label>' +
        '<div class="tshare-password">' +
        '<label class="tshare-field" for="tshare-pw">' + escapeHtml(tx('share.password', 'Passwort (optional)')) + '</label>' +
          '<input type="password" id="tshare-pw" class="tshare-input" placeholder="' + escapeHtml(tx('share.passwordPlaceholder', 'Optional'))
          + '" autocomplete="new-password">' +
        '<small>' + escapeHtml(tx('share.password.desc', 'Passwort separat vom Link weitergeben.')) + '</small>' +
        (canUpdatePw ? '<div class="tshare-pw-update"><small>' + escapeHtml(tx('server.passwordKeep', 'Leeres Feld behält das bisherige Passwort.')) + '</small>' +
          '<label class="tshare-check"><input type="checkbox" id="tshare-remove-pw"> <span>' + escapeHtml(tx('server.passwordRemove', 'Passwort beim Update entfernen')) + '</span></label></div>' : '') +
        '</div>' +
      '</div>' +
      btn('create', 'tshare-btn-primary tshare-btn-block', cloud ? tx('share.createQr', 'Link & QR-Code erstellen') : tx('share.createOffline', 'Offline-Link erstellen')) +
      '</details>' +
      '<details class="tshare-sec tshare-advanced"><summary>' + escapeHtml(tx('share.moreOptions', 'Weitere Optionen')) + '</summary>' +
        (actions.length ? actions.map(function (a) {
          return '<div class="tshare-action">' + btn(a.act, 'tshare-btn-ghost tshare-btn-block' + (a.danger ? ' tshare-btn-danger' : ''), tx(a.key, a.label))
            + '<small>' + escapeHtml(tx(a.key + 'Hint', a.hint)) + '</small></div>';
        }).join('') : '<p class="tshare-hint">' + escapeHtml(tx('share.moreOptions.none', 'Weitere Optionen erscheinen, sobald das Turnier online ist.')) + '</p>') +
      '</details>',
      btn('cancel', 'tshare-btn-ghost', tx('share.close', 'Schließen'))
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
      const pwUpdate = root.querySelector('.tshare-pw-update');
      if (pwUpdate) pwUpdate.hidden = root.querySelector('input[name="tshare-mode"]:checked').value !== 'qr';
    }
    root.querySelectorAll('input[name="tshare-mode"]').forEach(function (input) {
      input.addEventListener('change', function () {
        syncCheckedOpt();
        root.querySelector('[data-act="create"]').textContent = input.value === 'offline'
          ? tx('share.createOffline', 'Offline-Link erstellen')
          : tx('share.createQr', 'Link & QR-Code erstellen');
      });
    });
    syncCheckedOpt();
    actions.forEach(function (a) { root.querySelector('[data-act="' + a.act + '"]').addEventListener('click', a.fn); });
    const liveCopy = root.querySelector('[data-act="live-copy"]');
    if (liveCopy) liveCopy.addEventListener('click', actions[0].fn);
    const liveBox = root.querySelector('#tshare-live');
    if (liveBox) liveBox.addEventListener('change', function () {
      if (liveBox.checked) confirmLive(o);
      else setLive(o, false).then(function () { backToForm(o); }, function () { backToForm(o); });
    });
    const resolve = root.querySelector('[data-act="live-resolve"]');
    if (resolve) resolve.addEventListener('click', function () { renderConflict(o, '', false); });
    const show = root.querySelector('[data-act="team-show"]');
    if (show) show.addEventListener('click', function () {
      if (!liveOn) return confirmLive(o, true);
      show.disabled = true;
      setTeamView(o, true).then(function () { show.disabled = false; });
    });
    const end = root.querySelector('[data-act="team-end"]');
    if (end) end.addEventListener('click', function () {
      end.disabled = true;
      setTeamView(o, false).then(function () { backToForm(o); });
    });
    root.querySelector('[data-act="create"]').addEventListener('click', function () {
      const mode = root.querySelector('input[name="tshare-mode"]:checked').value;
      const pw = root.querySelector('#tshare-pw').value || '';
      if (mode === 'qr' && cloud) {
        const rm = root.querySelector('#tshare-remove-pw');
        const removePw = !!(rm && rm.checked);
        renderShareLoading();
        createServerShare(o, pw, removePw);
      } else {
        createOfflineShare(o, pw);
      }
    });
  }

  function renderShareLoading(text) {
    openShareModalShell(tx('share.title', 'Turnier teilen'),
      '<div class="tshare-loading"><div class="tshare-spinner"></div><p style="margin:0">'
        + escapeHtml(text || tx('share.loading', 'Link wird erstellt…')) + '</p></div>', '');
  }

  /* o (optional): archiveOpts() des Bogens – Titel für das System-Teilen-Menü. */
  function renderShareResult(url, pw, longWarnLen, code, o) {
    const nativeShare = nativeApp() && typeof TNative !== 'undefined' && TNative && typeof TNative.shareLink === 'function';
    const root = openShareModalShell(
      tx('share.result.title', 'Link zum Teilen'),
      '<p class="tshare-hint">' + escapeHtml(code
        ? (o && o.serverUpdated ? tx('server.updated', 'Aktualisiert – Link, Code und QR-Code bleiben gleich.') + ' ' : '')
          + tx('server.result', 'Link erstellt. Andere öffnen eine bearbeitbare Kopie; dein Turnier bleibt unverändert.')
        : tx('share.result.hint', 'Der Link zeigt den heutigen Stand. Spätere Änderungen brauchen einen neuen Link.')) +
        (o && o.serverDirty ? ' ' + escapeHtml(tx('server.dirty', 'Lokale Änderungen sind noch nicht veröffentlicht. Öffne „Teilen“, um sie auf dem Server zu speichern.')) : '') +
        (pw ? escapeHtml(tx('share.result.pwHint', ' Mit Passwort geschützt – bitte separat mitteilen.')) : '') + '</p>' +
        (longWarnLen ? '<p class="tshare-error">' + escapeHtml(cloudSharingEnabled() ? tx('share.result.long', 'Der Link ist sehr lang ({len} Zeichen). Manche Messenger kürzen ihn. Besser: den kurzen Link nutzen.', { len: longWarnLen }) :
          tx('release.share.long', 'Hinweis: Der Link ist sehr lang ({len} Zeichen). Falls er abgeschnitten wird, bitte eine Sicherungsdatei exportieren und teilen.',
            { len: longWarnLen })) + '</p>' : '') +
        '<div class="tshare-qr-wrap"><p class="tshare-qr-label">' +
          escapeHtml(tx('share.result.qr', 'QR-Code zum Scannen')) + '</p>' +
          '<img id="tshare-qr" class="tshare-qr" alt="' +
          escapeHtml(tx('share.result.qrAlt', 'QR-Code für den Turnierlink')) + '"></div>' +
        '<label class="tshare-field" for="tshare-url">' + escapeHtml(tx('share.result.link', 'Link')) + '</label>' +
      '<div class="tshare-linkrow"><input type="text" id="tshare-url" class="tshare-input" readonly>' +
      '<button type="button" class="tshare-btn tshare-btn-ghost" data-act="copy">' + escapeHtml(tx('share.copy', 'Kopieren')) + '</button></div>' +
      (code
        ? '<label class="tshare-field" for="tshare-code">' + escapeHtml(tx('share.result.code', 'Turniercode')) + ' <small>'
          + escapeHtml(tx('share.result.codeHint', '(alternativ auf der Startseite eingeben)')) + '</small></label>' +
          '<div class="tshare-linkrow"><input type="text" id="tshare-code" class="tshare-input" readonly>' +
          '<button type="button" class="tshare-btn tshare-btn-ghost" data-act="copy-code">' + escapeHtml(tx('share.copy', 'Kopieren')) + '</button></div>'
        : '') +
      '<p class="tshare-copied" id="tshare-copied-msg" hidden>' + escapeHtml(tx('share.copied', 'Kopiert ✓')) + '</p>' +
      (code ? '<details class="tshare-sec tshare-advanced"><summary>' + escapeHtml(tx('share.moreOptions', 'Weitere Optionen')) +
        '</summary><div class="tshare-action"><button type="button" class="tshare-btn tshare-btn-ghost tshare-btn-block" data-act="transfer">' +
        escapeHtml(tx('server.transfer', 'Bearbeitungslink anzeigen')) + '</button></div></details>' : '') +
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
        'Für diesen Link konnte kein QR-Code erstellt werden. Nutze den Link.');
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
      tx('share.error.title', 'Link nicht erstellt'),
      '<p class="tshare-error">' + escapeHtml(message) + '</p>' +
      '<p class="tshare-hint">' + escapeHtml(tx('share.error.safe', 'Dein Turnier auf diesem Gerät ist sicher gespeichert.')) + '</p>',
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
    return renderShareForm(o);
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
    const root = openShareModalShell(tx('server.conflict', 'Konflikt – nichts überschrieben'),
      '<p>' + escapeHtml(tx('server.conflictHint', 'Jemand anderes hat gespeichert. Dein Entwurf bleibt erhalten.'))
        + '</p>',
      '<button type="button" class="tshare-btn tshare-btn-ghost" data-act="cancel">' + escapeHtml(tx('share.cancel', 'Abbrechen')) + '</button>' +
      '<button type="button" class="tshare-btn tshare-btn-ghost" data-act="fork">' + escapeHtml(tx('server.fork', 'Als neues Turnier veröffentlichen')) + '</button>' +
      '<button type="button" class="tshare-btn tshare-btn-primary" data-act="load">' + escapeHtml(tx('server.load', 'Online-Stand laden')) + '</button>');
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
        const binding = token && full.canEdit ? {
          instance: secret(), id: id, revision: full.revision,
          readOnly: false,
          token: token,
          published: snapshotSignature(full.snapshot)
        } : null;
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
      + (!binding ? '\n\n' + tx('share.localCopyHint',
        'Du kannst diesen Bogen auf diesem Gerät bearbeiten. Änderungen bleiben in deiner lokalen Kopie; der ursprüngliche Serverstand bleibt unverändert.') : '')
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
      if (live.on && statusOpts && e.detail && e.detail.sheetId === statusOpts.sheet && !live.conflict) {
        liveSchedule(LIVE_DEBOUNCE_MS);
      }
      if (!e.detail || !e.detail.sheetId || !e.detail.revision || !document.getElementById('tserver-status')) return;
      clearTimeout(statusTimer);
      statusTimer = setTimeout(function () {
        if (statusOpts && statusOpts.sheet === e.detail.sheetId) renderServerStatus(statusOpts).catch(function () {});
      }, 50);
    });
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('online', function () { if (live.on) { live.fails = 0; liveRun(); } });
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', function () {
      if (live.on && document.visibilityState === 'visible') liveRun();
    });
  }

  return {
    buildShareUrl: buildServerShareUrl, openShareDialog, applyPendingShare, openByCode, openInfoDialog,
    publish, transferUrl, independentCopy, safeServerFile,
    offlineEncode, offlineDecodeEnvelope, offlineResolveSnapshot, buildOfflineShareUrl
  };
});
