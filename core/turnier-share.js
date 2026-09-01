/* ============================================================================
   turnier-share.js – Turnier per Link teilen (ohne eigenen Server)

   GitHub Pages liefert nur statische Dateien, es gibt keinen Server, der
   Turnierdaten speichern könnte. Deshalb steckt der komplette Turnierstand
   (dieselbe Datenform wie beim Archivieren, siehe turnier-archive.js
   snapshot()/writeSnapshot()) im Link selbst, hinter dem #-Zeichen:

     Turnierbogen_XY.html#share=<Kopfdaten+Nutzdaten, Base64>

   Ein optionales Passwort verschlüsselt die Nutzdaten mit einem simplen,
   passwortabhängigen XOR-Bytestrom (deterministisch aus dem Passwort
   abgeleitet). WICHTIG: Das ist bewusst KEINE kryptografisch sichere
   Verschlüsselung, sondern nur eine Verschleierung – sie verhindert das
   zufällige Mitlesen des Links, schützt aber nicht vor gezieltem Knacken.
   Dafür läuft sie überall synchron, auch offline/unter file://, ohne
   Web-Crypto-Abhängigkeit und ohne zusätzliche Bibliothek.

   Nur Text-Utilities + drei native Dialoge (prompt/confirm/alert) – passend
   zum Rest der App, die ebenfalls ohne eigenes Modal-System auskommt.
   ========================================================================== */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TShare = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const HASH_PREFIX = '#share=';
  const MAX_PW_TRIES = 3;
  const LONG_URL_WARN = 6000; // Warnschwelle, ab der Messenger/Browser den Link kappen könnten

  /* ------------------------------------------------------------- Bytes/Text */
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

  /* --------------------------------------------- Passwort-Bytestrom (XOR)
     FNV-1a als Startwert, mulberry32 als schneller, deterministischer PRNG –
     beide bewusst simpel gehalten, siehe Kopfkommentar (nur Verschleierung). */
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

  /* ------------------------------------------------------------- Kodierung
     Envelope = Klartext-Kopf (Titel/Typ/Teams für die Vorschau) + payload:
     unverschlüsseltes oder XOR-verschleiertes JSON des Snapshots. */
  function encode(opts, password) {
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

  function decodeEnvelope(hashValue) {
    try {
      const json = bytesToStr(base64UrlToBytes(hashValue));
      const env = JSON.parse(json);
      if (!env || env.v !== 1 || typeof env.payload !== 'string') return null;
      return env;
    } catch (e) { return null; }
  }

  /* Entschlüsselt/parst die Nutzdaten eines Envelopes. Wirft bei falschem
     Passwort oder beschädigten Daten (JSON.parse schlägt fehl). */
  function resolveSnapshot(env, password) {
    let json;
    if (env.enc) {
      const bytes = xorWithPassword(base64UrlToBytes(env.payload), password || '');
      json = bytesToStr(bytes);
    } else {
      json = env.payload;
    }
    return JSON.parse(json); // wirft bei falschem Passwort/kaputten Daten
  }

  /* --------------------------------------------------------------- Link-URL */
  function buildShareUrl(opts, password) {
    const hash = HASH_PREFIX + encode(opts, password);
    const url = new URL(location.href);
    url.hash = '';
    return url.toString() + hash;
  }

  /* ------------------------------------------------------------------- API */

  /* Erstellt den Link für das aktuelle Turnier und bietet ihn zum Kopieren an.
     opts: dieselbe Form wie archiveOpts() in den Bögen
           ({ sheet, file, type, keys, title, teams, empty }). */
  function openShareDialog(opts) {
    const o = opts || {};
    if (o.empty) { alert('Dieses Turnier ist noch leer – es gibt noch nichts zu teilen.'); return; }

    const pw = prompt(
      'Link zum Teilen erstellen.\n\n' +
      'Passwort für den Link (leer lassen für keinen Passwortschutz):', ''
    );
    if (pw === null) return; // abgebrochen

    const snapshot = (typeof TArchive !== 'undefined') ? TArchive.snapshot(o.keys) : {};
    const url = buildShareUrl({
      sheet: o.sheet, type: o.type, title: o.title, teams: o.teams, snapshot: snapshot
    }, pw || null);

    if (url.length > LONG_URL_WARN) {
      alert('Hinweis: Der Link ist sehr lang (' + url.length + ' Zeichen) und wird evtl. nicht\n'
        + 'von jedem Messenger/Browser vollständig übernommen. Bei Problemen: über den\n'
        + 'PC teilen oder erst nach dem Turnier (weniger laufende Änderungen) verlinken.');
    }

    const note = pw
      ? '\n\nGeschützt mit Passwort – bitte separat mitteilen. Achtung: Das ist nur eine\n'
        + 'Verschleierung, kein echter Verschlüsselungsschutz.'
      : ''; 
    const snapshotInfo = '\n\nHinweis: Der Link enthält einen Snapshot des aktuellen Turnierstands zu diesem Zeitpunkt.\n'
      + 'Spätere Änderungen sind erst in einem neuen Link sichtbar.';
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).catch(function () { });
    }
    prompt('Link zum Teilen (in die Zwischenablage kopiert – hier auch manuell kopierbar):' + snapshotInfo + note, url);
  }

  /* Prüft/übernimmt einen per Link empfangenen Turnierstand, falls die
     Adresszeile #share=… enthält. Analog zu TArchive.applyPendingRestore():
     archiviert zuerst den aktuellen Stand, schreibt dann den Snapshot in den
     laufenden Speicherplatz und lädt neu.
     opts: archiveOpts() des Bogens (für das Sichern des bisherigen Standes). */
  function applyPendingShare(opts) {
    const raw = String(location.hash || '');
    if (raw.indexOf(HASH_PREFIX) !== 0) return false;
    const env = decodeEnvelope(raw.slice(HASH_PREFIX.length));
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
      try { snapshot = resolveSnapshot(env, pw); }
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

    const ok = confirm(
      'Geteiltes Turnier gefunden: "' + info + '".\n\n'
      + 'Übernehmen? Das aktuelle Turnier auf diesem Gerät wird vorher automatisch\n'
      + 'gesichert und bleibt über die Startseite abrufbar.'
    );
    if (!ok) { clearHash(); return false; }

    if (typeof TArchive !== 'undefined') {
      TArchive.save(opts);              // bisherigen Stand sichern (No-op, falls leer)
      TArchive.writeSnapshot(snapshot); // geteilten Stand in den laufenden Speicherplatz schreiben
    }
    clearHash();
    location.reload();
    return true;
  }

  function clearHash() {
    try {
      const url = new URL(location.href);
      url.hash = '';
      history.replaceState(null, '', url.pathname + (url.search || ''));
    } catch (e) { }
  }

  return {
    buildShareUrl, openShareDialog, applyPendingShare,
    _encode: encode, _decodeEnvelope: decodeEnvelope, _resolveSnapshot: resolveSnapshot
  };
});
