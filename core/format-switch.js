(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TFormatSwitch = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const Sport = root.TSport || (typeof require === 'function' ? require('./turnier-sport.js') : null);
  const RETURN_PREFIX = '__beachl_format_return.';
  const beachModes = ['15', '21', '2x15', '2x21', '2x15tb', '2x21tb'];
  const targets = [
    { id: 'runden_rr', file: 'Turnierbogen_Runden_System.html', type: 'Jeder gegen Jeden', mode: 'rr', min: 4, max: 24 },
    { id: 'runden_swiss', file: 'Turnierbogen_Runden_System.html', type: 'Schweizer System', mode: 'swiss', min: 4, max: 24 },
    { id: 'flex_rr', file: 'Turnierbogen_Flex_Turnier.html', type: 'Flex-Turnier', mode: 'rr', min: 4, max: 24 },
    { id: 'flex_swiss', file: 'Turnierbogen_Flex_Turnier.html', type: 'Flex-Turnier', mode: 'swiss', min: 4, max: 24 },
    { id: 'gruppen-final', file: 'Turnierbogen_Gruppen_Finalrunde.html', type: 'Gruppen + Finalrunde', min: 4, max: 24 },
    { id: 'ko-flex', file: 'Turnierbogen_KO_System.html', type: 'KO-System', min: 4, max: 32 },
    { id: 'de-flex', file: 'Turnierbogen_Doppel_KO_System.html', type: 'Doppel-KO-System', min: 4, max: 16 },
    { id: 'mpp', file: 'Turnierbogen_Modified_Pool_Play.html', type: 'Modified Pool Play', min: 6, max: 24 },
    { id: 'koc', file: 'Turnierbogen_King_Queen_of_the_Court.html', type: 'King/Queen of the Court', min: 6, max: 24 },
    { id: 'kingqueen', file: 'Turnierbogen_King_Queen.html', type: 'King & Queen', min: 4, max: 32 }
  ].map(t => Object.assign({ base: t.id }, t));
  const grouped = id => id === 'gruppen-final' || id === 'mpp';
  const flex = id => /^flex_/.test(id);
  const swiss = id => /_swiss$/.test(id);
  const object = v => !!v && typeof v === 'object' && !Array.isArray(v);
  const integer = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
  const time = v => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
  const copy = v => JSON.parse(JSON.stringify(v));
  function targetFor(id) { return targets.find(t => t.id === id); }
  function sourceBase(sheet) { return typeof sheet === 'string' ? sheet.split('.')[0] : ''; }
  function defaults(t, sportId) {
    if (t.id === 'koc') return { teams: 12, courts: 3, rounds: null, roundMinutes: 15, startTime: '10:00' };
    const setMode = Sport ? Sport.get(sportId || 'volleyball.beach', 1).defaultMode : '2x21tb';
    if (t.id === 'kingqueen') return { men: 4, women: 4, rounds: 4, fields: 2, startTime: '10:00', endTime: '14:00', setMode: setMode, levels: {} };
    const c = { teams: 8, fields: 4, setMode: setMode, startTime: '10:00', endTime: '14:00' };
    if (t.mode) Object.assign(c, { mode: t.mode, rounds: null });
    if (grouped(t.id)) Object.assign(c, { groups: 'auto', finalMode: 'placement', finalSetMode: '', endTime: '14:30' });
    if (t.id === 'ko-flex') Object.assign(c, { groups: 0, finalMode: 'ko', thirdPlace: true });
    if (t.id === 'de-flex') Object.assign(c, { groups: 0, bracketMode: 'double', finalMode: 'doubleko', endTime: '15:00' });
    return c;
  }

  function map(source, targetId) {
    const target = targetFor(targetId), base = sourceBase(source && source.sheet);
    const notices = [];
    const note = (key, params) => notices.push({ key: 'formatSwitch.' + key, params: params || {} });
    const blocked = key => { note(key || 'invalid'); return { blocked: true, notices: notices }; };
    if (!target || !targetFor(base) || targetId === base || !object(source.config)) return blocked('invalidTarget');
    const sourceProfile = Sport ? Sport.recordSport(source) : { ok: true, profile: { id: 'volleyball.beach', version: 1 } };
    if (!sourceProfile.ok || (Sport && !Sport.supportsFormat(sourceProfile.profile.id, targetId))) return blocked('invalidTarget');
    const profile = Sport && Sport.get(sourceProfile.profile.id, sourceProfile.profile.version);
    const modes = profile ? profile.modeIds : beachModes;
    const c = source.config, cfg = defaults(target, sourceProfile.profile.id);
    if (profile && c.rankingProfile != null && profile.rankingProfiles.indexOf(c.rankingProfile) < 0) return blocked();
    if (c.customSetTarget != null
        && (!Number.isInteger(c.customSetTarget) || c.customSetTarget < 11 || c.customSetTarget > 50)) return blocked();
    if (c.modeMinutes != null && (!object(c.modeMinutes)
        || Object.keys(c.modeMinutes).some(mode => !modes.includes(mode)
          || !integer(c.modeMinutes[mode], 1, 360)))) return blocked();
    if (c.rankingProfile != null) cfg.rankingProfile = c.rankingProfile;
    if (c.customSetTarget != null) cfg.customSetTarget = c.customSetTarget;
    if (c.modeMinutes && Object.keys(c.modeMinutes).length) cfg.modeMinutes = copy(c.modeMinutes);
    const sourcePeople = base === 'kingqueen', targetPeople = targetId === 'kingqueen';
    if ((source.stageDecisions || []).length) return blocked();
    const sourceCourt = base === 'koc', targetCourt = targetId === 'koc';
    const count = sourcePeople ? c.men + c.women : c.teams;
    if (!integer(count, 2, 128) || (sourcePeople && (!integer(c.men, 0, 16) || !integer(c.women, 0, 16)))) return blocked();
    if (!time(c.startTime) || (c.endTime != null && !time(c.endTime))) return blocked();
    if (c.rounds != null && !integer(c.rounds, 1, 256)) return blocked();
    if (sourceCourt && !integer(c.roundMinutes, 1, 128)) return blocked();
    if (!sourceCourt && !modes.includes(c.setMode)) return blocked();
    const names = source.teamNames || {}, fields = source.fieldNames || {};
    if (!object(names) || !object(fields)
        || !Object.keys(names).every(k => /^[1-9]\d*$/.test(k) && typeof names[k] === 'string')
        || !Object.keys(fields).every(k => /^\d+$/.test(k) && typeof fields[k] === 'string')) return blocked();
    const sport = Sport ? Sport.recordSport(source) : { ok: true, profile: { id: 'volleyball.beach', version: 1 } };
    if (!sport.ok) return blocked('invalid');
    const tournament = {
      title: source.title || '',
      sport: Sport ? Sport.value(sport.profile) : { id: 'volleyball.beach', version: 1 },
      config: cfg,
      teamNames: {},
      fieldNames: {}
    };
    if (sourcePeople !== targetPeople) {
      note(targetPeople ? 'peopleRoster' : 'teamRoster', { count: targetPeople ? 8 : cfg.teams, sourceCount: count });
      if (sourcePeople && Object.keys(c.levels || {}).length) note('levels');
    } else {
      const maxTeams = targetId === 'de-flex' && /^volleyball\./.test(sport.profile.id)
        ? 32 : target.max;
      if (!integer(count, target.min, maxTeams)) {
        note('countRange', { count: count, min: target.min, max: maxTeams });
        return { blocked: true, notices: notices };
      }
      cfg.teams = count;
      if (Object.keys(names).some(k => +k > count && names[k])) return blocked('extraNames');
      tournament.teamNames = copy(names);
      if (Sport && !Sport.validatePairMembers(source)) return blocked('invalid');
      if (source.pairMembers) tournament.pairMembers = copy(source.pairMembers);
    }
    cfg.startTime = c.startTime;
    if (!targetCourt && c.endTime != null) cfg.endTime = c.endTime;
    else if (targetCourt && c.endTime != null) note('noEnd', { time: c.endTime });
    else if (!targetCourt) note('newEnd', { time: cfg.endTime });
    const sourceFields = sourceCourt ? c.courts : c.fields;
    if (!integer(sourceFields, 1, 10)) return blocked();
    const maxFields = targetCourt ? 5 : Math.max(1, Math.min(10, Math.floor((targetPeople ? (cfg.men + cfg.women) / 2 : cfg.teams) / 2)));
    if (sourceFields > maxFields) {
      if (!targetPeople) {
        note('fieldRange', { count: sourceFields, max: maxFields });
        return { blocked: true, notices: notices };
      }
      note('peopleFields', { count: sourceFields, target: cfg.fields });
    } else cfg[targetCourt ? 'courts' : 'fields'] = sourceFields;
    if (!sourceCourt && !targetCourt) {
      const max = cfg.fields;
      Object.keys(fields).forEach(k => {
        if (+k < max) tournament.fieldNames[k] = fields[k];
        else if (fields[k]) note('fieldName', { name: fields[k] });
      });
    } else if (Object.keys(fields).some(k => fields[k])) note('fieldNames');
    if (!targetCourt && !sourceCourt) cfg.setMode = c.setMode;
    else if (targetCourt) note('timedMode', { mode: c.setMode, minutes: cfg.roundMinutes });
    else note('newSetMode', { mode: cfg.setMode });
    const copyRounds = !targetCourt && !targetPeople && !sourcePeople && swiss(base) && swiss(targetId);
    if (copyRounds) {
      if (c.rounds != null) {
        const maxRounds = count - (count % 2 === 0 ? 1 : 0);
        if (!integer(c.rounds, 2, maxRounds)) return blocked();
        cfg.rounds = c.rounds;
      }
    } else if (c.rounds != null && c.rounds !== cfg.rounds) {
      note('rounds', { count: c.rounds, target: cfg.rounds == null ? 'auto' : cfg.rounds });
    }
    if (grouped(base) && grouped(targetId)) {
      if (c.groups !== 'auto' && !integer(c.groups, 2, 6)) return blocked();
      if (!['none', 'placement', 'blocks', 'ko', 'main'].includes(c.finalMode)) return blocked();
      if (c.finalSetMode && !modes.includes(c.finalSetMode)) return blocked();
      cfg.groups = c.groups;
      cfg.finalMode = c.finalMode;
      cfg.finalSetMode = c.finalSetMode || '';
    } else if (c.finalSetMode && c.finalSetMode !== c.setMode) {
      note('finalMode', { mode: c.finalSetMode });
    }
    if (!sourcePeople && object(source.teamGender) && Object.keys(source.teamGender).length) {
      if (flex(targetId) && flex(base)) tournament.teamGender = copy(source.teamGender);
      else note('gender');
    }
    if (c.planning && Object.keys(c.planning).length) note('planning');
    if (!targetCourt && ['ko-flex', 'de-flex'].includes(targetId) && ['2x15', '2x21'].includes(cfg.setMode)) {
      cfg.setMode += 'tb';
      note('decidingMode', { mode: cfg.setMode });
    } else if (grouped(targetId) && ['placement', 'blocks', 'ko'].includes(cfg.finalMode)
        && ['2x15', '2x21'].includes(cfg.finalSetMode || cfg.setMode)) {
      note('finalDecidingMode', { mode: (cfg.finalSetMode || cfg.setMode) + 'tb' });
    }
    return { blocked: false, tournament: tournament, notices: notices };
  }

  function urlFor(target, sheet, sportId) {
    const id = sheet.indexOf('.') < 0 ? '_base_' : sheet.slice(sheet.indexOf('.') + 1);
    const params = new URLSearchParams();
    params.set('id', id);
    if (target.mode) params.set('mode', target.mode);
    if (sportId && sportId !== 'volleyball.beach') params.set('sport', sportId);
    return target.file + '?' + params.toString();
  }
  function fileFor(target, sportId) {
    const params = new URLSearchParams();
    if (target.mode) params.set('mode', target.mode);
    if (sportId && sportId !== 'volleyball.beach') params.set('sport', sportId);
    const query = params.toString();
    return target.file + (query ? '?' + query : '');
  }
  function archiveCopy(view, target, sheet, data) {
    const S = root.TStore;
    root.TArchive.archiveCurrentInView(view, {
      sheet: sheet, file: fileFor(target, (data.sport || { id: 'volleyball.beach' }).id),
      type: target.type, title: data.title, teams: Object.values(data.teamNames || {}),
      keys: [S.PREFIX + sheet], empty: false
    });
    S.updateIndexInView(view, data);
  }
  function create(source, targetId, mapped) {
    const S = root.TStore, A = root.TArchive, target = targetFor(targetId);
    return S.whenIdle().then(() => S.transaction(view => {
      const sourceKey = S.PREFIX + source.sheet;
      if (view.getItem(sourceKey) == null && source._revision === 0) {
        const saved = S.saveInView(view, source, source.sheet, 0, new Date().toISOString());
        if (!saved.ok) throw new Error('formatSwitch.saveError');
        source._revision = saved.revision;
        source.updated = saved.updated;
      }
      const parsed = S.parseRecord(view.getItem(sourceKey), source.sheet);
      if (!parsed.ok || parsed.data._revision !== source._revision) throw new Error('formatSwitch.conflict');
      const binding = S.serverBindingInView(view, source.sheet);
      if (binding && binding.readOnly) throw new Error('formatSwitch.readonly');
      archiveCopy(view, targetFor(sourceBase(source.sheet)), source.sheet, parsed.data);
      // Existing target instances stay live, with their rights intact; only safety copies are added.
      view.keys().filter(k => k.indexOf(S.PREFIX) === 0 && S.sheetBaseOf(k.slice(S.PREFIX.length)) === target.base).forEach(k => {
        const sheet = k.slice(S.PREFIX.length), record = S.parseRecord(view.getItem(k), sheet);
        if (!record.ok) throw new Error('formatSwitch.targetCorrupt');
        archiveCopy(view, target, sheet, record.data);
      });
      let id, sheet;
      do {
        const bytes = new Uint32Array(3);
        root.crypto.getRandomValues(bytes);
        id = Date.now().toString(36) + Array.from(bytes, n => n.toString(36)).join('');
        sheet = target.base + '.' + id;
      } while (view.getItem(S.PREFIX + sheet) != null || view.getItem(S.SERVER_PREFIX + sheet) != null);
        const sourceSport = Sport ? Sport.recordSport(parsed.data)
          : { ok: true, profile: { id: 'volleyball.beach', version: 1 } };
      if (!sourceSport.ok) throw new Error('formatSwitch.invalid');
      const result = A.startNewInView(view, {
        sheet: sheet, keys: [S.PREFIX + sheet], empty: true,
        fresh: () => Object.assign(S.emptyTournament(sheet, {}), copy(mapped.tournament))
      }, mapped.tournament.title);
      if (!A.validTournamentRecord(result.tournament, sheet)) throw new Error('formatSwitch.invalid');
      S.markNewInView(view, sheet, 'format');
      view.setItem(RETURN_PREFIX + sheet, JSON.stringify({
        sheet: source.sheet, target: sourceBase(source.sheet), sport: sourceSport.profile.id
      }));
      return { url: urlFor(target, sheet, sourceSport.profile.id), sourceRevision: source._revision, sourceUpdated: source.updated };
    }, { sheetId: source.sheet }));
  }

  function mount(opts) {
    const doc = root.document, S = root.TStore, I = root.TI18n;
    const section = doc.getElementById('configSection');
    if (!section || doc.getElementById('formatSwitchTarget')) return;
    const profileResult = Sport ? Sport.recordSport(opts.get()) : null;
    const profile = profileResult && profileResult.ok ? Sport.get(profileResult.profile.id, 1) : null;
    const modes = profile ? profile.modeIds : beachModes;
    const t = (key, params) => I.t('formatSwitch.' + key, params);
    const noticeText = n => {
      const params = Object.assign({}, n.params);
      if (modes.includes(params.mode)) params.mode = I.t('setMode.' + params.mode);
      if (params.target === 'auto') params.target = t('automatic');
      return I.t(n.key, params);
    };
    const state = S.initialUiState();
    if (state && state.readOnly) return;
    const box = doc.createElement('div');
    box.className = 'format-switch noprint';
    box.innerHTML = '<label for="formatSwitchTarget"></label><div class="format-switch-controls"><select id="formatSwitchTarget"></select><button type="button" class="nbtn" id="btnFormatSwitch"></button></div><p id="formatSwitchNotice" role="status"></p>';
    box.querySelector('label').textContent = t('label');
    const select = box.querySelector('select'), button = box.querySelector('button'), status = box.querySelector('p');
    select.add(new Option(t('choose'), ''));
    const base = sourceBase(opts.get().sheet);
    targets.filter(target => target.id !== base && (!profile || Sport.supportsFormat(profile.id, target.id))).forEach(target => {
      const label = flex(target.id) ? I.term(target.type) + ' · ' + I.term(target.mode === 'rr' ? 'Jeder gegen Jeden' : 'Schweizer System') : I.term(target.type);
      select.add(new Option(label, target.id));
    });
    button.textContent = t('button');
    status.textContent = t('hint');
    function place() {
      const setup = section.querySelector('[data-cfg-options]') || section.querySelector('.cfg-action-groups')
        || section.querySelector('.cfg-setup-content') || section;
      if (box.parentNode !== setup) setup.appendChild(box);
    }
    place();
    const first = () => doc.querySelector('#session-title-input');
    function readOnly() {
      const input = first();
      return !!(input && (input.disabled || input.readOnly));
    }
    function refresh() { box.hidden = readOnly(); place(); }
    new MutationObserver(refresh).observe(section, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'readonly'] });
    select.addEventListener('change', () => {
      const mapped = map(opts.get(), select.value);
      status.textContent = select.value ? mapped.notices.map(noticeText).join(' ') || t('hint') : t('hint');
    });
    button.addEventListener('click', async () => {
      if (readOnly() || button.disabled) return;
      const targetId = select.value;
      button.disabled = true;
      try {
        await S.whenIdle();
        if (S.hasUnsavedWork()) { status.textContent = t('saveError'); return; }
        if (readOnly()) { status.textContent = t('readonly'); return; }
        const source = copy(opts.get()), mapped = map(source, targetId);
        if (mapped.blocked) { status.textContent = mapped.notices.map(noticeText).join(' '); return; }
        const invalid = Array.from(section.querySelectorAll('input')).find(input => !input.disabled && !input.checkValidity());
        if (invalid) { status.textContent = t('invalid'); invalid.reportValidity(); return; }
        if (mapped.notices.length && !root.confirm(mapped.notices.map(noticeText).join('\n') + '\n\n' + t('confirm'))) return;
        const result = await create(source, targetId, mapped);
        const current = opts.get();
        if (current.sheet === source.sheet) {
          current._revision = result.sourceRevision;
          current.updated = result.sourceUpdated;
        }
        S.allowLeave();
        root.location.assign(result.url);
      } catch (error) {
        root.console.error('Format switch failed', error);
        const key = /^formatSwitch\./.test(error.message) ? error.message : 'formatSwitch.saveError';
        status.textContent = I.t(key);
      } finally { button.disabled = false; }
    });
    S.getItem(RETURN_PREFIX + opts.get().sheet).then(raw => {
      if (!raw) return;
      const info = JSON.parse(raw), target = targetFor(info.target);
      if (!target || S.sheetBaseOf(info.sheet) !== target.base
          || !Sport || !Sport.get(info.sport, 1)) throw new Error('Invalid format return reference');
      const link = doc.createElement('a');
      link.className = 'format-switch-return';
      link.href = urlFor(target, info.sheet, info.sport);
      link.textContent = t('undo');
      link.title = t('undoHint');
      box.appendChild(link);
    }).catch(error => {
      root.console.error('Format return failed', error);
      status.textContent = t('saveError');
    });
    refresh();
  }
  return { targets: targets, map: map, mount: mount };
});
