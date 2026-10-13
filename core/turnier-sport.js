(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TSport = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const GENERIC_FORMATS = Object.freeze([
    'runden_rr', 'runden_swiss', 'flex_rr', 'flex_swiss',
    'gruppen-final', 'ko-flex', 'de-flex', 'mpp'
  ]);
  const PROFILES = {
    'volleyball.beach': Object.freeze({
      id: 'volleyball.beach', version: 1, nameKey: 'sport.beach',
      defaultMode: '2x21tb',
      participantKey: 'sport.participant.team', surfaceKey: 'sport.surface.court',
      matchUnitKey: 'sport.unit.set', modeIds: Object.freeze(['15', '21', '2x15', '2x21', '2x15tb', '2x21tb']),
      rankingProfiles: Object.freeze(['beach-house']),
      rankingProfileLabels: Object.freeze({ 'beach-house': 'sport.ranking.beach' }),
      capabilities: Object.freeze({ serveCounter: true, sidesSwitch: true }),
      formats: Object.freeze(GENERIC_FORMATS.concat(['koc', 'kingqueen', 'tandem', 'eltern-kind', 'meisterschaften', 'daviscup']))
    }),
    'volleyball.indoor': Object.freeze({
      id: 'volleyball.indoor', version: 1, nameKey: 'sport.indoor',
      defaultMode: 'indoor-bo5',
      participantKey: 'sport.participant.team', surfaceKey: 'sport.surface.court',
      matchUnitKey: 'sport.unit.set',
      modeIds: Object.freeze(['indoor-1x25', 'indoor-2x25', 'indoor-bo3', 'indoor-bo5', 'indoor-custom']),
      rankingProfiles: Object.freeze(['indoor-3-2-1-0', 'indoor-fivb-2026', 'indoor-hobby']),
      rankingProfileLabels: Object.freeze({
        'indoor-3-2-1-0': 'sport.ranking.indoor321',
        'indoor-fivb-2026': 'sport.ranking.indoorFivb2026',
        'indoor-hobby': 'sport.ranking.hobby'
      }),
      capabilities: Object.freeze({ serveCounter: false, sidesSwitch: false }),
      formats: GENERIC_FORMATS
    }),
    'table-tennis.singles': Object.freeze({
      id: 'table-tennis.singles', version: 1, nameKey: 'sport.tableTennisSingles',
      defaultMode: 'tt-best-of-5',
      participantKey: 'sport.participant.player', surfaceKey: 'sport.surface.table',
      matchUnitKey: 'sport.unit.game', modeIds: Object.freeze(['tt-best-of-3', 'tt-best-of-5', 'tt-best-of-7']),
      rankingProfiles: Object.freeze(['table-tennis-hobby']),
      rankingProfileLabels: Object.freeze({ 'table-tennis-hobby': 'sport.ranking.tableTennis' }),
      capabilities: Object.freeze({ serveCounter: false, sidesSwitch: false }),
      formats: GENERIC_FORMATS
    }),
    'table-tennis.doubles': Object.freeze({
      id: 'table-tennis.doubles', version: 1, nameKey: 'sport.tableTennisDoubles',
      defaultMode: 'tt-best-of-5',
      participantKey: 'sport.participant.pair', surfaceKey: 'sport.surface.table',
      matchUnitKey: 'sport.unit.game', modeIds: Object.freeze(['tt-best-of-3', 'tt-best-of-5', 'tt-best-of-7']),
      rankingProfiles: Object.freeze(['table-tennis-hobby']),
      rankingProfileLabels: Object.freeze({ 'table-tennis-hobby': 'sport.ranking.tableTennis' }),
      capabilities: Object.freeze({ serveCounter: false, sidesSwitch: false }),
      formats: GENERIC_FORMATS
    })
  };
  const BEACH = PROFILES['volleyball.beach'];
  const has = Object.prototype.hasOwnProperty;
  const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
  const PREFERENCE_KEY = 'BEACHL.sportPreference';

  function get(id, version) {
    const profile = PROFILES[id];
    return profile && (version == null || version === profile.version) ? profile : null;
  }

  function availableProfiles() {
    const config = root && root.TReleaseConfig;
    const allowed = config && Array.isArray(config.sports) ? config.sports : Object.keys(PROFILES);
    return allowed.map(id => PROFILES[id]).filter(Boolean);
  }
  function isAvailable(id) {
    return availableProfiles().some(profile => profile.id === id);
  }
  function supportsFormat(id, formatId) {
    const profile = get(id, 1);
    return !!(profile && profile.formats.indexOf(formatId) >= 0);
  }
  function homeSelection() {
    try {
      const storage = root && root.localStorage;
      const id = storage && storage.getItem(PREFERENCE_KEY);
      return isAvailable(id) ? id : (availableProfiles()[0] || BEACH).id;
    } catch (e) { return (availableProfiles()[0] || BEACH).id; }
  }
  function rememberHomeSelection(id) {
    if (!isAvailable(id)) return false;
    try {
      const storage = root && root.localStorage;
      if (!storage) return false;
      storage.setItem(PREFERENCE_KEY, id);
      return storage.getItem(PREFERENCE_KEY) === id;
    } catch (e) { return false; }
  }

  function validate(value) {
    if (!object(value) || typeof value.id !== 'string' || !Number.isInteger(value.version) ||
        Object.keys(value).length !== 2 || !has.call(value, 'id') || !has.call(value, 'version')) {
      return { ok: false, code: 'invalid-sport' };
    }
    const profile = get(value.id, value.version);
    return profile ? { ok: true, profile: profile } : { ok: false, code: 'unsupported-sport' };
  }

  function recordSport(record) {
    if (!object(record)) return { ok: false, code: 'invalid-record' };
    if (!has.call(record, 'sport')) {
      return isAvailable(BEACH.id)
        ? { ok: true, profile: BEACH, migrated: true }
        : { ok: false, code: 'unsupported-sport' };
    }
    const result = validate(record.sport);
    return result.ok && isAvailable(result.profile.id)
      ? { ok: true, profile: result.profile, migrated: false }
      : { ok: false, code: result.ok ? 'unsupported-sport' : result.code };
  }

  function value(profile) {
    const resolved = profile && get(profile.id, profile.version);
    if (!resolved) throw new Error('Unsupported sport profile');
    return { id: resolved.id, version: resolved.version };
  }

  function fromSearch(search) {
    let params;
    try { params = new URLSearchParams(search == null ? '' : search); }
    catch (e) { return { ok: false, code: 'invalid-sport' }; }
    const id = params.get('sport');
    if (id == null || id === '') return { ok: true, profile: BEACH, explicit: false };
    const profile = get(id, 1);
    return profile
      && isAvailable(profile.id)
      ? { ok: true, profile: profile, explicit: true }
      : { ok: false, code: 'unsupported-sport' };
  }

  return {
    PROFILES: PROFILES,
    IDs: Object.keys(PROFILES),
    GENERIC_FORMATS: GENERIC_FORMATS,
    BEACH: BEACH,
    availableProfiles: availableProfiles,
    homeSelection: homeSelection,
    rememberHomeSelection: rememberHomeSelection,
    supportsFormat: supportsFormat,
    get: get,
    validate: validate,
    recordSport: recordSport,
    value: value,
    fromSearch: fromSearch
  };
});
