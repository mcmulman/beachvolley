(function (root) {
  'use strict';
  const PREFIX = '__firmencup.server.';
  const API = root.FIRMENCUP_API_BASE || 'https://beachvolley.klickdienst-server.de/api/firmencup.php';
  const adminSessions = Object.create(null);
  const operations = Object.create(null);

  function serial(localId, run) {
    const previous = operations[localId] || Promise.resolve();
    // A failed operation rejects its caller, but must not poison subsequent retries.
    const result = previous.then(run, run);
    operations[localId] = result;
    const release = function () {
      if (operations[localId] === result) delete operations[localId];
    };
    result.then(release, release);
    return result;
  }
  function withEvent(run, event, options) {
    const snapshot = root.Firmencup.clone(event);
    const settings = options ? Object.assign({}, options) : options;
    return serial(snapshot.id, () => run(snapshot, settings));
  }
  function withBinding(run, binding, args) {
    return serial(binding.localId, async function () {
      const current = await load(binding.localId);
      if (!current) throw new Error('Server binding was removed / Serverbindung wurde entfernt');
      const result = await run.apply(null, [current].concat(args || []));
      Object.keys(binding).forEach(key => { if (!Object.prototype.hasOwnProperty.call(current, key)) delete binding[key]; });
      Object.assign(binding, current);
      return result === current ? binding : result;
    });
  }

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
      const stored = Object.assign({}, binding);
      if (binding.role === 'admin') stored.token = '';
      view.setItem(PREFIX + binding.localId, JSON.stringify(stored));
    });
    return binding;
  }
  const HEX64 = /^[a-f0-9]{64}$/;
  const SERVER_ID = /^[A-Za-z0-9]{8}$/;
  function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }
  function hasExactKeys(value, keys) {
    const own = Object.keys(value).sort();
    return own.length === keys.length && keys.slice().sort().every((key, i) => own[i] === key);
  }
  // Offline-first publish persists the create request before the server assigns an id.
  function validPendingCreate(binding) {
    const pending = binding.pending;
    if (binding.id !== null || binding.revision !== 0 || binding.syncedFingerprint !== null ||
        !isPlainObject(pending) || !hasExactKeys(pending, ['action', 'body', 'fingerprint']) ||
        pending.action !== 'create' || typeof pending.fingerprint !== 'string') return false;
    const body = pending.body;
    if (!isPlainObject(body) || !hasExactKeys(body, ['editorToken', 'event', 'requestKey'].concat(
      Object.prototype.hasOwnProperty.call(body, 'publicRead') ? ['publicRead'] : [])) ||
        (Object.prototype.hasOwnProperty.call(body, 'publicRead') && typeof body.publicRead !== 'boolean') ||
        body.editorToken !== binding.token || typeof body.requestKey !== 'string' ||
        !HEX64.test(body.requestKey) || !isPlainObject(body.event) ||
        body.event.id !== binding.localId) return false;
    return fingerprint(body.event) === pending.fingerprint;
  }
  async function load(localId) {
    const raw = await root.TStore.getItem(PREFIX + localId);
    if (!raw) return null;
    const binding = JSON.parse(raw);
    if (!binding || binding.localId !== localId || typeof binding.token !== 'string' ||
        !(binding.role === 'admin' ? binding.token === '' : HEX64.test(binding.token)) ||
        !Number.isInteger(binding.revision) || binding.revision < 0 ||
        !(typeof binding.id === 'string' ? SERVER_ID.test(binding.id) : validPendingCreate(binding))) {
      throw new Error('Corrupt Firmencup server permission / Beschädigte Firmencup-Serverberechtigung');
    }
    if (binding.role === 'admin') {
      const session = adminSessions[localId];
      binding.token = session && Date.parse(session.expiresAt) > Date.now() ? session.token : '';
    }
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
    if (binding.role === 'admin' && !binding.token) {
      throw Object.assign(new Error('Admin session expired. Unlock again; local draft retained / Adminsitzung abgelaufen. Erneut entsperren; lokaler Entwurf bleibt erhalten'), { code: 'admin_session_required', status: 403 });
    }
    const url = API + '?action=' + pending.action;
    let result;
    try {
      result = await request(url, {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' },
          binding.role === 'admin' || binding.role === 'participant' ? { Authorization: 'Bearer ' + binding.token } : {}),
        body: JSON.stringify(pending.body)
      });
    } catch (error) {
      if (error.status === 412 || error.status === 409) {
        binding.conflict = true;
        binding.conflictCode = error.code;
        // An unpublished binding keeps its create request; dropping it would orphan the capability.
        if (pending.action !== 'create') binding.pending = null;
        await persist(binding);
      }
      throw error;
    }
    if (!result.body || typeof result.body.id !== 'string' || !SERVER_ID.test(result.body.id) ||
        !Number.isInteger(result.body.revision) || result.body.revision < 1 ||
        (binding.id !== null && result.body.id !== binding.id)) {
      throw new Error('Incomplete Firmencup server response / Unvollständige Firmencup-Serverantwort');
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
    if (binding.role === 'participant') return prepareScore(binding, event);
    binding.pending = {
      action: 'update',
      fingerprint: fingerprint(event),
      body: {
        id: binding.id,
        expectedRevision: binding.revision,
        requestKey: token(),
        event: root.Firmencup.clone(event)
      }
    };
    if (binding.role !== 'admin') binding.pending.body.editorToken = binding.token;
    await persist(binding);
    return flush(binding);
  }
  async function prepareScore(binding, event) {
    const previous = JSON.parse(binding.syncedFingerprint), next = root.Firmencup.clone(previous);
    const changed = Object.keys(event.results).filter(id =>
      JSON.stringify(previous.results[id]) !== JSON.stringify(event.results[id]));
    // Scores are the only participant command; all other state originates on the server.
    const allowed = root.Firmencup.clone(event);
    allowed.results = previous.results;
    allowed.startedAt = previous.startedAt;
    if (Object.keys(previous.results).some(id => !Object.prototype.hasOwnProperty.call(event.results, id)) ||
        fingerprint(allowed) !== fingerprint(previous)) {
      throw Object.assign(new Error('Participant access permits scores only / Teilnehmerzugriff erlaubt nur Punkte'), { code: 'score_only', status: 403 });
    }
    for (const matchId of changed) {
      const score = event.results[matchId];
      next.results[matchId] = root.Firmencup.clone(score);
      next.startedAt = event.startedAt;
      binding.pending = { action: 'score', fingerprint: fingerprint(next), body: {
        id: binding.id, expectedRevision: binding.revision, requestKey: token(),
        matchId: matchId, a: score.a, b: score.b, drawWinner: score.drawWinner
      } };
      await persist(binding);
      await flush(binding);
    }
    return binding;
  }
  async function publish(event, options) {
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
      if (options && typeof options.publicRead === 'boolean') {
        binding.pending.body.publicRead = options.publicRead;
        binding.access = { publicRead: options.publicRead };
      }
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
    return { event: result.body.event, revision: result.body.revision, canEdit: result.body.canEdit,
      canScore: result.body.canScore === true, role: result.body.role || (result.body.canEdit ? 'owner' : 'public'),
      access: result.body.access || null, etag: result.etag };
  }
  async function adopt(localId, id, capability, revision, event, role, expiresAt, adminShareToken) {
    assertWebCloud();
    const previous = await load(localId);
    const binding = { localId: localId, id: id, token: capability, revision: revision,
      syncedFingerprint: fingerprint(event), pending: null, conflict: false, conflictCode: null };
    const effectiveRole = role || (previous && previous.id === id ? previous.role : null);
    if (effectiveRole) binding.role = effectiveRole;
    if (previous && previous.id === id && (previous.role || 'owner') === (effectiveRole || 'owner')) {
      for (const key of ['participantShareToken', 'adminShareToken', 'access']) {
        if (Object.prototype.hasOwnProperty.call(previous, key)) binding[key] = previous[key];
      }
    }
    if (effectiveRole === 'admin') {
      if (expiresAt) adminSessions[localId] = { token: capability, expiresAt: expiresAt };
      if (adminShareToken) binding.adminShareToken = adminShareToken;
    }
    await persist(binding);
    return binding;
  }
  async function reauthorize(binding, sessionToken, expiresAt) {
    if (binding.role !== 'admin' || !HEX64.test(sessionToken) || !Number.isFinite(Date.parse(expiresAt))) {
      throw new Error('Invalid admin session / Ungültige Adminsitzung');
    }
    adminSessions[binding.localId] = { token: sessionToken, expiresAt: expiresAt };
    binding.token = sessionToken;
    return persist(binding);
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
  function accessFromHash(hash) {
    const match = /^#(participant|admin)=([a-f0-9]{64})$/.exec(hash || '');
    return match ? { role: match[1], token: match[2] } : null;
  }
  function accessUrl(id, capability, role, pageUrl, language) {
    const url = new URL('Firmencup.html', pageUrl);
    url.search = '?server=' + encodeURIComponent(id) + '&lang=' + encodeURIComponent(language || 'de');
    url.hash = role + '=' + encodeURIComponent(capability);
    return url.href;
  }
  async function sharing(binding, settings) {
    if (binding.role === 'participant') throw Object.assign(new Error('Admin permission required / Adminberechtigung erforderlich'), { code: 'forbidden' });
    const result = await request(API + '?action=sharing', { method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + binding.token },
      body: JSON.stringify(Object.assign({}, settings, { id: binding.id })) });
    binding.access = result.body.access;
    if (settings.participantToken) binding.participantShareToken = settings.participantToken;
    if (settings.adminShareToken) binding.adminShareToken = settings.adminShareToken;
    if (settings.revokeParticipant) delete binding.participantShareToken;
    if (settings.revokeAdmin) delete binding.adminShareToken;
    await persist(binding);
    return result.body.access;
  }
  async function unlock(id, adminShareToken, password) {
    const result = await request(API + '?action=unlock', { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: id, adminShareToken: adminShareToken, password: password }) });
    if (!result.body || !HEX64.test(result.body.sessionToken) || !Number.isFinite(Date.parse(result.body.expiresAt))) {
      throw new Error('Invalid admin session / Ungültige Adminsitzung');
    }
    return result.body;
  }
  async function logout(binding) {
    await request(API + '?action=logout', { method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + binding.token },
      body: JSON.stringify({ id: binding.id }) });
    delete adminSessions[binding.localId];
    binding.token = '';
    await persist(binding);
  }
  root.FirmencupServer = {
    load: localId => serial(localId, () => load(localId)),
    publish: (event, options) => withEvent(publish, event, options),
    sync: event => withEvent(sync, event), get: get,
    adopt: function (localId, id, capability, revision, event, role, expiresAt, adminShareToken) {
      const snapshot = root.Firmencup.clone(event);
      return serial(localId, () => adopt(localId, id, capability, revision, snapshot, role, expiresAt, adminShareToken));
    },
    markConflict: (binding, revision, code) => withBinding(markConflict, binding, [revision, code]),
    publicUrl: publicUrl, editorUrl: editorUrl, capabilityFromHash: capabilityFromHash,
    fingerprint: fingerprint, token: token,
    sharing: (binding, settings) => withBinding(sharing, binding, [Object.assign({}, settings)]),
    unlock: unlock,
    logout: binding => withBinding(logout, binding),
    reauthorize: (binding, sessionToken, expiresAt) => withBinding(reauthorize, binding, [sessionToken, expiresAt]),
    rememberAccess: function (binding, access) {
      const snapshot = access ? root.Firmencup.clone(access) : access;
      return withBinding(function (current) {
        current.access = snapshot;
        return persist(current);
      }, binding);
    },
    accessFromHash: accessFromHash,
    participantUrl: (id, capability, pageUrl, language) => accessUrl(id, capability, 'participant', pageUrl, language),
    adminUrl: (id, capability, pageUrl, language) => accessUrl(id, capability, 'admin', pageUrl, language)
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
