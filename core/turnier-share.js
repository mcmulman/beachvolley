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

   Nur Text-/Fetch-Utilities + drei native Dialoge (prompt/confirm/alert) –
   passend zum Rest der App, die ebenfalls ohne eigenes Modal-System auskommt.
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

  /* ================================================================ Teilen
     Fragt Passwort und gewünschte Link-Art ab und erstellt den Link.
     opts: dieselbe Form wie archiveOpts() in den Bögen
           ({ sheet, file, type, keys, title, teams, empty }). */
  function openShareDialog(opts) {
    const o = opts || {};
    if (o.empty) { alert('Dieses Turnier ist noch leer – es gibt noch nichts zu teilen.'); return; }

    const useServerLink = confirm(
      'Link zum Teilen erstellen.\n\n' +
      'OK = kurzer Link über den Server (empfohlen; zum Öffnen ist Internet nötig).\n' +
      'Abbrechen = Offline-Link, der den kompletten Turnierstand direkt im Link\n' +
      'enthält (kein Server/Internet nötig, dafür ein sehr langer Link).'
    );

    const pw = prompt(
      'Passwort für den Link (leer lassen für keinen Passwortschutz):', ''
    );
    if (pw === null) return; // abgebrochen

    if (useServerLink) createServerShare(o, pw);
    else createOfflineShare(o, pw);
  }

  /* -------------------------------------------------------- Server-Variante
     Wird bei einem Netzwerkfehler mit "Erneut versuchen" erneut aufgerufen,
     ohne das Passwort nochmal abzufragen - der Nutzer muss bei wackliger
     Verbindung nicht von vorn anfangen. */
  function createServerShare(o, pw) {
    // Der Snapshot wird bei jedem Versuch frisch gelesen, damit auch ein
    // "Erneut versuchen" nach längerem Warten den aktuellsten Stand teilt.
    const snapshot = (typeof TArchive !== 'undefined') ? TArchive.snapshot(o.keys) : {};

    apiPost('/share.php?action=create', {
      sheet: o.sheet || '', file: o.file || '', type: o.type || '',
      title: o.title || '', teams: Array.isArray(o.teams) ? o.teams : [],
      snapshot: snapshot, password: pw || ''
    }).then(function (data) {
      showShareResult(buildServerShareUrl(data.id), pw);
    }).catch(function (err) {
      // Es wurde nichts gespeichert - das laufende Turnier ist unberührt.
      const retry = confirm(
        (err.network
          ? 'Der Link konnte nicht erstellt werden: ' + err.message
          : 'Der Link konnte nicht erstellt werden (Serverfehler):\n' + err.message)
        + '\n\nDein Turnier auf diesem Gerät ist davon nicht betroffen und weiterhin sicher gespeichert.'
        + '\n\nJetzt erneut versuchen? (Abbrechen, um stattdessen einen Offline-Link zu erstellen.)'
      );
      if (retry) createServerShare(o, pw);
      else createOfflineShare(o, pw);
    });
  }

  /* ------------------------------------------------------- Offline-Variante
     Rein clientseitig, funktioniert ohne Server/Internet. */
  function createOfflineShare(o, pw) {
    const snapshot = (typeof TArchive !== 'undefined') ? TArchive.snapshot(o.keys) : {};
    const url = buildOfflineShareUrl({
      sheet: o.sheet, type: o.type, title: o.title, teams: o.teams, snapshot: snapshot
    }, pw || null);

    if (url.length > LONG_URL_WARN) {
      alert('Hinweis: Der Offline-Link ist sehr lang (' + url.length + ' Zeichen) und wird evtl.\n'
        + 'nicht von jedem Messenger/Browser vollständig übernommen. Bei Problemen:\n'
        + 'über den PC teilen oder den (kürzeren) Server-Link verwenden.');
    }
    showShareResult(url, pw);
  }

  function showShareResult(url, pw) {
    const note = pw
      ? '\n\nGeschützt mit Passwort – bitte separat mitteilen.'
      : '';
    const snapshotInfo = '\n\nHinweis: Der Link enthält einen Snapshot des aktuellen Turnierstands zu diesem Zeitpunkt.\n'
      + 'Spätere Änderungen sind erst in einem neuen Link sichtbar.';
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).catch(function () { });
    }
    prompt('Link zum Teilen (in die Zwischenablage kopiert – hier auch manuell kopierbar):' + snapshotInfo + note, url);
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

  return {
    buildShareUrl: buildServerShareUrl, openShareDialog, applyPendingShare
  };
});
