(function (root) {
  'use strict';
  const PREFIX = '__firmencup.server.';
  const API = root.FIRMENCUP_API_BASE || 'https://beachvolley.klickdienst-server.de/api/firmencup.php';

  function assertWebCloud() {
    if (root.TReleaseConfig && root.TReleaseConfig.cloudSharing === false) {
      throw new Error('Live Firmencup sharing is disabled in this native release / Live-Firmencup ist in dieser nativen Version deaktiviert');
    }
  }
  function token() {
    const bytes = new Uint8Array(32);
    if (!root.crypto || !root.crypto.getRandomValues) throw new Error('Secure random generator unavailable / Sicherer Zufallsgenerator nicht verfügbar');
    root.crypto.getRandomValues(bytes);
    return Array.from(bytes).map(n => n.toString(16).padStart(2, '0')).join('');
  }
  function fingerprint(event) {
    const copy = root.Firmencup.clone(event);
    copy.revision = 0;
    return JSON.stringify(copy);
  }
  async function persist(binding) {
    await root.TStore.transaction(function (view) {
      if (view.getItem('__firmencup.event.' + binding.localId) === null) {
        throw new Error('Local event was deleted. Reload / Lokale Veranstaltung wurde gelöscht. Neu laden.');
      }
      view.setItem(PREFIX + binding.localId, JSON.stringify(binding));
    });
    return binding;
  }
  async function load(localId) {
    const raw = await root.TStore.getItem(PREFIX + localId);
    if (!raw) return null;
    const binding = JSON.parse(raw);
    if (!binding || binding.localId !== localId || typeof binding.id !== 'string' ||
        !/^[A-Za-z0-9]{8}$/.test(binding.id) || typeof binding.token !== 'string' ||
        !/^[a-f0-9]{64}$/.test(binding.token) || !Number.isInteger(binding.revision) ||
        binding.revision < 0) throw new Error('Corrupt Firmencup server permission / Beschädigte Firmencup-Serverberechtigung');
    return binding;
  }
  async function request(url, options) {
    assertWebCloud();
    let response;
    try {
      response = await fetch(url, Object.assign({
        cache: 'no-store',
        credentials: 'omit',
        headers: { Accept: 'application/json' }
      }, options || {}));
    } catch (error) {
      const offline = new Error('Local changes are saved; server is unavailable / Lokale Änderung gespeichert; Server nicht erreichbar');
      offline.code = 'network';
      throw offline;
    }
    if (response.status === 304) return { notModified: true };
    let body;
    try { body = await response.json(); }
    catch (error) { throw new Error('Invalid Firmencup server response / Ungültige Firmencup-Serverantwort'); }
    if (!response.ok) {
      const error = new Error(body && body.message || 'Firmencup server request failed / Firmencup-Serveranfrage fehlgeschlagen');
      error.code = body && body.error || 'server_error';
      error.status = response.status;
      throw error;
    }
    return { body: body, etag: response.headers.get('ETag') };
  }
  async function flush(binding) {
    const pending = binding.pending;
    if (!pending) return binding;
    const url = API + (pending.action === 'create' ? '?action=create' : '?action=update');
    let result;
    try {
      result = await request(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pending.body)
      });
    } catch (error) {
      if (error.status === 412 || error.status === 409) {
        binding.conflict = true;
        binding.conflictCode = error.code;
        binding.pending = null;
        await persist(binding);
      }
      throw error;
    }
    binding.id = result.body.id;
    binding.revision = result.body.revision;
    binding.syncedFingerprint = pending.fingerprint;
    binding.pending = null;
    binding.conflict = false;
    binding.conflictCode = null;
    await persist(binding);
    return binding;
  }
  async function prepareUpdate(binding, event) {
    binding.pending = {
      action: 'update',
      fingerprint: fingerprint(event),
      body: {
        id: binding.id,
        expectedRevision: binding.revision,
        editorToken: binding.token,
        requestKey: token(),
        event: root.Firmencup.clone(event)
      }
    };
    await persist(binding);
    return flush(binding);
  }
  async function publish(event) {
    assertWebCloud();
    let binding = await load(event.id);
    if (!binding) {
      binding = { localId: event.id, id: null, token: token(), revision: 0,
        syncedFingerprint: null, pending: null, conflict: false, conflictCode: null };
      binding.pending = {
        action: 'create',
        fingerprint: fingerprint(event),
        body: { event: root.Firmencup.clone(event), editorToken: binding.token, requestKey: token() }
      };
      await persist(binding);
    }
    if (binding.conflict) throw Object.assign(new Error('Server changed elsewhere. Preserve the local draft and compare before continuing / Serverstand anderweitig geändert. Lokalen Entwurf sichern und vergleichen'), { code: 'revision_conflict', status: 412 });
    if (binding.pending) await flush(binding);
    if (binding.id && binding.syncedFingerprint !== fingerprint(event)) await prepareUpdate(binding, event);
    return binding;
  }
  async function sync(event) {
    let binding = await load(event.id);
    if (!binding) return null;
    if (binding.conflict) throw Object.assign(new Error('Server conflict: the local draft is retained / Serverkonflikt: Der lokale Entwurf bleibt erhalten'), { code: 'revision_conflict', status: 412 });
    if (binding.pending) await flush(binding);
    binding = await load(event.id);
    if (binding.syncedFingerprint !== fingerprint(event)) binding = await prepareUpdate(binding, event);
    return binding;
  }
  async function get(id, capability, etag) {
    const headers = {};
    if (capability) headers.Authorization = 'Bearer ' + capability;
    if (etag) headers['If-None-Match'] = etag;
    const result = await request(API + '?id=' + encodeURIComponent(id), { headers: headers });
    if (result.notModified) return result;
    if (!result.body || result.body.formatVersion !== 1 || result.body.id !== id ||
        !Number.isInteger(result.body.revision) || typeof result.body.canEdit !== 'boolean' ||
        !result.body.event) throw new Error('Incomplete Firmencup server response / Unvollständige Firmencup-Serverantwort');
    return { event: result.body.event, revision: result.body.revision, canEdit: result.body.canEdit, etag: result.etag };
  }
  async function adopt(localId, id, capability, revision, event) {
    assertWebCloud();
    const binding = { localId: localId, id: id, token: capability, revision: revision,
      syncedFingerprint: fingerprint(event), pending: null, conflict: false, conflictCode: null };
    await persist(binding);
    return binding;
  }
  async function markConflict(binding, revision, code) {
    binding.conflict = true;
    binding.remoteRevision = revision;
    binding.conflictCode = code || 'revision_conflict';
    binding.pending = null;
    return persist(binding);
  }
  function publicUrl(id, pageUrl, language) {
    const url = new URL('Firmencup.html', pageUrl);
    url.search = '?eventId=' + encodeURIComponent(id) + '&lang=' + encodeURIComponent(language || 'de');
    return url.href;
  }
  function editorUrl(id, capability, pageUrl, language) {
    const url = new URL('Firmencup.html', pageUrl);
    url.search = '?server=' + encodeURIComponent(id) + '&lang=' + encodeURIComponent(language || 'de');
    url.hash = 'edit=' + encodeURIComponent(capability);
    return url.href;
  }
  function capabilityFromHash(hash) {
    const match = /^#edit=([a-f0-9]{64})$/.exec(hash || '');
    return match ? match[1] : null;
  }
  root.FirmencupServer = {
    load: load, publish: publish, sync: sync, get: get, adopt: adopt, markConflict: markConflict,
    publicUrl: publicUrl, editorUrl: editorUrl, capabilityFromHash: capabilityFromHash,
    fingerprint: fingerprint
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
