(function (root) {
  'use strict';
  const prefix = '__firmencup.event.', backup = '__firmencup.previous.';
  const server = '__firmencup.server.';
  // Local write time only: never part of engine snapshots or server payloads.
  const local = '__firmencup.local.';
  function validId(id) { return typeof id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(id); }
  function key(id) {
    if (!validId(id)) throw new Error('Invalid event ID / Veranstaltungs-ID');
    return prefix + id;
  }
  function validationOptions(event) {
    return { publicSnapshot: !Object.prototype.hasOwnProperty.call(event, 'checkIns') &&
      event.teams.every(team => Array.isArray(team.roster) && team.roster.length === 0) };
  }
  function parse(raw) {
    const event = JSON.parse(raw);
    return root.Firmencup.validate(event, validationOptions(event));
  }
  function savedAt(raw) {
    try {
      const value = JSON.parse(raw);
      const date = value && value.savedAt;
      return typeof date === 'string' && new Date(date).toISOString() === date ? date : null;
    } catch (error) { return null; }
  }
  function markSaved(view, id) {
    view.setItem(local + id, JSON.stringify({ savedAt: new Date(Date.now()).toISOString() }));
  }
  root.FirmencupStore = {
    load: function (id) {
      return root.TStore.getItem(key(id)).then(raw => raw == null ? null : parse(raw));
    },
    list: function (options) {
      return root.TStore.readEntries().then(entries => {
        const values = new Map(entries.map(row => [row.key, row.value]));
        return entries.filter(row => row.key.indexOf(prefix) === 0).map(row => {
          const id = row.key.slice(prefix.length);
          let result;
          try {
            key(id);
            const e = parse(row.value);
            if (e.id !== id) throw new Error('Event ID mismatch / Veranstaltungs-ID stimmt nicht');
            result = { id: id, title: e.title, status: e.status };
          } catch (error) {
            result = { id: id, status: 'corrupt', error: error.message };
          }
          result.savedAt = validId(id) ? savedAt(values.get(local + id)) : null;
          if (options && options.removal) {
            result.removal = validId(id) ? [row.value,
              values.has(backup + id) ? values.get(backup + id) : null,
              values.has(server + id) ? values.get(server + id) : null,
              values.has(local + id) ? values.get(local + id) : null] : null;
          }
          return result;
        }).sort((a, b) => {
          if (a.savedAt !== b.savedAt) {
            if (a.savedAt === null) return 1;
            if (b.savedAt === null) return -1;
            return Date.parse(b.savedAt) - Date.parse(a.savedAt);
          }
          return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
        });
      });
    },
    remove: function (id, expected) {
      const current = key(id), keys = [current, backup + id, server + id, local + id];
      if (!Array.isArray(expected) || (expected.length !== 3 && expected.length !== keys.length) ||
          expected[0] == null || expected.some(raw => raw !== null && typeof raw !== 'string')) {
        throw new Error('Deletion snapshot required / Löschstand erforderlich');
      }
      // Old three-key snapshots are safe only while local metadata is absent.
      const snapshot = expected.length === 3 ? expected.concat(null) : expected.slice();
      return root.TStore.transaction(function (view) {
        if (keys.some((k, index) => view.getItem(k) !== snapshot[index])) {
          throw new Error('Changed in another tab. Reload / In anderem Tab geändert. Neu laden.');
        }
        keys.forEach(k => view.removeItem(k));
        return true;
      });
    },
    save: function (event, options) {
      root.Firmencup.validate(event, options);
      return root.TStore.transaction(function (view) {
        const k = key(event.id), raw = view.getItem(k), old = raw ? parse(raw) : null;
        if (!old && event.revision !== 0) throw new Error('New event must have revision zero / Neue Veranstaltung muss Revision null haben');
        if (old && old.revision !== event.revision) throw new Error('Changed in another tab. Reload / In anderem Tab geändert. Neu laden.');
        if (old) root.Firmencup.validateTransition(old, event);
        if (old && (old.status === 'finals' || old.startedAt) && old.status !== event.status &&
            !(old.status === 'groups' && event.status === 'finals')) {
          throw new Error('Started phase cannot be reset / Gestartete Phase kann nicht zurückgesetzt werden');
        }
        const next = root.Firmencup.clone(event);
        next.revision++;
        if (raw) view.setItem(backup + event.id, raw);
        view.setItem(k, JSON.stringify(next));
        markSaved(view, event.id);
        return next;
      });
    },
    fork: function (source, event) {
      root.Firmencup.validate(source);
      root.Firmencup.validate(event);
      if (source.id === event.id || event.revision !== 0) throw new Error('New local copy required / Neue lokale Kopie erforderlich');
      return root.TStore.transaction(function (view) {
        const raw = view.getItem(key(source.id)), target = key(event.id);
        if (!raw || JSON.stringify(parse(raw)) !== JSON.stringify(source)) {
          throw new Error('Changed in another tab. Reload / In anderem Tab geändert. Neu laden.');
        }
        if (view.getItem(target) !== null) throw new Error('Event already exists / Veranstaltung bereits vorhanden');
        const next = root.Firmencup.clone(event);
        next.revision = 1;
        view.setItem(backup + event.id, raw);
        view.setItem(target, JSON.stringify(next));
        markSaved(view, event.id);
        return next;
      });
    },
    replace: function (event, options) {
      root.Firmencup.validate(event, options);
      return root.TStore.transaction(function (view) {
        const k = key(event.id), raw = view.getItem(k), next = root.Firmencup.clone(event);
        const old = raw ? parse(raw) : null;
        if (raw) view.setItem(backup + event.id, raw);
        next.revision = old ? old.revision + 1 : 1;
        view.setItem(k, JSON.stringify(next));
        markSaved(view, event.id);
        return next;
      });
    },
    previous: function (id) {
      key(id);
      return root.TStore.getItem(backup + id).then(raw => {
        if (!raw) throw new Error('No previous snapshot / Kein vorheriger Stand');
        return parse(raw);
      });
    }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
