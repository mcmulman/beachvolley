(function (root, factory) {
  const api = factory(root.Firmencup || (typeof require === 'function' ? require('./firmencup.js') : null));
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FirmencupShare = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (F) {
  'use strict';
  const LIMIT = 250000;
  // A bounded UTF-8 LZW snapshot keeps ordinary event links QR-sized.
  function pack(text) {
    const input = unescape(encodeURIComponent(text)), dict = new Map();
    let next = 256, word = '', output = '';
    function emit(w) {
      const code = w.length === 1 ? w.charCodeAt(0) : dict.get(w);
      output += String.fromCharCode(code >> 8, code & 255);
    }
    for (let i = 0; i < input.length; i++) {
      const char = input[i], joined = word + char;
      if (joined.length === 1 || dict.has(joined)) word = joined;
      else {
        emit(word);
        if (next < 65535) dict.set(joined, next++);
        word = char;
      }
    }
    if (word) emit(word);
    return btoa(output).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function unpack(payload) {
    if (typeof payload !== 'string' || payload.length > LIMIT || !/^[A-Za-z0-9_-]+$/.test(payload)) throw new Error('Invalid public snapshot / Ungültiger öffentlicher Stand');
    const bytes = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    if (!bytes.length || bytes.length % 2) throw new Error('Invalid snapshot encoding / Kodierung');
    const dict = Array.from({ length: 256 }, (_, i) => String.fromCharCode(i));
    function code(i) { return bytes.charCodeAt(i) * 256 + bytes.charCodeAt(i + 1); }
    let word = dict[code(0)], output = word;
    if (word == null) throw new Error('Invalid snapshot dictionary / Wörterbuch');
    for (let i = 2; i < bytes.length; i += 2) {
      const k = code(i), entry = dict[k] != null ? dict[k] : k === dict.length ? word + word[0] : null;
      if (entry == null || output.length + entry.length > LIMIT) throw new Error('Invalid or oversized snapshot / Ungültiger oder zu großer Stand');
      output += entry;
      if (dict.length < 65535) dict.push(word + entry[0]);
      word = entry;
    }
    return decodeURIComponent(escape(output));
  }
  function encode(event) {
    const snapshot = F.publicSnapshot(event), e = snapshot.event;
    if (F.refereeMode(e) === 'teams' || (e.transfers && e.transfers.length) || e.replans.length || Object.keys(e.outcomes).length) {
      return pack(JSON.stringify([3, snapshot]));
    }
    const ids = e.teams.map(t => t.id);
    const data = [2, e.formatVersion == null ? 1 : e.formatVersion, e.id, e.title, e.config,
      e.teams.map(t => [t.id, t.name, e.organizations.findIndex(o => o.id === t.orgId)]),
      e.organizations.map(o => [o.id, o.name, ids.indexOf(o.nominee)]), e.status,
      e.matches.map(m => {
        const r = e.results[m.id];
        return r ? [r.a, r.b, r.drawWinner ? ids.indexOf(r.drawWinner) : -1] : null;
      }), e.drawOrder.map(id => ids.indexOf(id)), e.startedAt, snapshot.capturedAt, e.liveWave || null];
    return pack(JSON.stringify(data));
  }
  function decode(payload) {
    const d = JSON.parse(unpack(payload));
    if (Array.isArray(d) && d.length === 2 && d[0] === 3) {
      const snapshot = d[1];
      if (!snapshot || snapshot.kind !== 'firmencup-public' || snapshot.version !== 1 ||
          typeof snapshot.capturedAt !== 'string' || !Number.isFinite(Date.parse(snapshot.capturedAt))) {
        throw new Error('Invalid public snapshot / Ungültiger öffentlicher Stand');
      }
      F.validate(snapshot.event, { publicSnapshot: true });
      if (snapshot.event.teams.some(t => t.roster.length) || snapshot.event.checkIns !== undefined ||
          Object.keys(snapshot.event.outcomes).some(id => snapshot.event.outcomes[id].note) ||
          Object.keys(snapshot.event.withdrawals).some(id => snapshot.event.withdrawals[id].note) ||
          (snapshot.event.transfers || []).some(entry => entry.note)) {
        throw new Error('Public snapshot contains private data / Öffentlicher Stand enthält private Daten');
      }
      return snapshot;
    }
    const legacy = Array.isArray(d) && d.length === 12 && d[0] === 1;
    const versioned = Array.isArray(d) && d.length === 13 && d[0] === 2;
    if ((!legacy && !versioned) || !Array.isArray(d[legacy ? 4 : 5]) ||
        !Array.isArray(d[legacy ? 5 : 6]) || !Array.isArray(d[legacy ? 7 : 8]) ||
        !Array.isArray(d[legacy ? 8 : 9])) throw new Error('Unsupported snapshot / Nicht unterstützter Stand');
    const offset = legacy ? 0 : 1, formatVersion = legacy ? 1 : d[1];
    const id = d[1 + offset], title = d[2 + offset], config = d[3 + offset];
    const teams = d[4 + offset].map(t => ({ id: t[0], name: t[1], orgId: d[5 + offset][t[2]] && d[5 + offset][t[2]][0], roster: [] }));
    const orgs = d[5 + offset].map(o => ({ id: o[0], name: o[1], nominee: o[2] === -1 ? null : teams[o[2]] && teams[o[2]].id }));
    const status = d[6 + offset], results = d[7 + offset], drawOrder = d[8 + offset];
    let e = F.create(id, title, config, teams, orgs, formatVersion);
    if (status !== 'draft') e = F.build(e, { allowMissingRoster: true });
    const groupLength = e.matches.length;
    e.matches.forEach((m, i) => { if (results[i]) e = F.score(e, m.id, results[i][0], results[i][1]); });
    if (status === 'finals') {
      e = F.finals(e, drawOrder.map(i => teams[i] && teams[i].id));
      e.matches.slice(groupLength).forEach((m, j) => {
        const r = results[j + groupLength];
        if (r) e = F.score(e, m.id, r[0], r[1], r[2] < 0 ? null : teams[r[2]] && teams[r[2]].id);
      });
    }
    if (e.status !== status || results.length !== e.matches.length) throw new Error('Snapshot schedule mismatch / Spielplan stimmt nicht');
    e.startedAt = d[9 + offset]; if (d[11 + offset]) e.liveWave = d[11 + offset];
    delete e.checkIns;
    if (legacy) delete e.formatVersion;
    F.validate(e, { publicSnapshot: true });
    const capturedAt = d[10 + offset];
    if (typeof capturedAt !== 'string' || !Number.isFinite(Date.parse(capturedAt))) throw new Error('Invalid snapshot date / Datum');
    return { kind: 'firmencup-public', version: 1, event: e, capturedAt: capturedAt };
  }
  return { encode: encode, decode: decode };
});
