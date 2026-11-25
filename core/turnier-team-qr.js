/* Anonyme Team-Live-View per QR (teamView v1).
   Wandelt den aktuellen Spielplan eines Turnierbogens in ein Objekt aus
   NUR Teamnummern (keine Namen) um und zeigt den QR-Dialog/Aushang.
   Der Bogen meldet sich mit window.BEACHL_TEAMVIEW = () => ({ state, plan }).
   Die Spiel-/Tabellenlogik bleibt komplett im Core (TFormat/TPlanning). */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TTeamView = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function (root) {
  'use strict';

  const MAX_MATCHES = 600;
  const MAX_TABLES = 12;
  const MAX_BYTES = 60000;
  const TEAMS_MAX = 128;

  function tx(key, fallback, params) {
    let s = fallback;
    if (typeof TI18n !== 'undefined' && TI18n && TI18n.active && TI18n.active()) s = TI18n.t(key, params);
    else if (params) Object.keys(params).forEach(function (k) { s = s.split('{' + k + '}').join(params[k]); });
    return s;
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function clean(s, max) {
    const t = String(s == null ? '' : s).replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
    return t.length > max ? t.slice(0, max).trim() : t;
  }
  function term(s) {
    return (typeof TI18n !== 'undefined' && TI18n && TI18n.term) ? TI18n.term(s) : s;
  }
  function isInt(n) { return typeof n === 'number' && isFinite(n) && Math.floor(n) === n; }
  function byteLength(s) {
    try { return unescape(encodeURIComponent(s)).length; } catch (e) { return s.length; }
  }
  function hook() {
    const h = root && root.BEACHL_TEAMVIEW;
    return typeof h === 'function' ? h : null;
  }

  /* Unterstützt: Bogen mit Hook, Teams (Volleyball). Sportarten mit Spielern/Paaren
     statt „Team“ (z. B. Tischtennis) bleiben außen vor. */
  function supported(o) {
    const h = hook();
    if (!h) return false;
    let ctx;
    try { ctx = h(o); } catch (e) { return false; }
    if (!ctx || !ctx.state || !ctx.plan) return false;
    const sp = ctx.state.sport && ctx.state.sport.id;
    return !sp || String(sp).indexOf('volleyball.') === 0;
  }

  function hhmm(min) {
    if (!isInt(min) && !(typeof min === 'number' && isFinite(min))) return '';
    const m = Math.round(min) % 1440;
    const v = m < 0 ? m + 1440 : m;
    return ('0' + Math.floor(v / 60)).slice(-2) + ':' + ('0' + (v % 60)).slice(-2);
  }

  function fieldName(state, f, n) {
    const names = state.fieldNames;
    const custom = names && names[f] ? clean(names[f], 20) : '';
    if (custom) return custom;
    if (typeof TUI !== 'undefined' && TUI && TUI.surfaceLabel) return clean(TUI.surfaceLabel(f + 1), 20);
    return clean(tx('teamview.field', 'Feld {n}', { n: f + 1 }), 20);
  }

  function setsOf(state, id) {
    const r = state.results && state.results[id];
    const out = [];
    if (!Array.isArray(r)) return out;
    for (let i = 0; i < r.length && out.length < 5; i++) {
      const s = r[i];
      if (!s || s.length < 2) continue;
      const a = s[0], b = s[1];
      if (a === '' || b === '' || a == null || b == null) continue;
      const x = Number(a), y = Number(b);
      if (isInt(x) && isInt(y) && x >= 0 && y >= 0 && x <= 99 && y <= 99) out.push([x, y]);
    }
    return out;
  }

  /* Schweizer System: Folgerunden sind nur Vorschau, bis alle Vorrunden stehen. */
  function swissVisible(plan, round) {
    if (plan.mode !== 'swiss' || !Array.isArray(plan.rounds)) return true;
    for (let i = 0; i < plan.rounds.length; i++) {
      const rd = plan.rounds[i];
      if (rd.round === round) {
        if (rd.frozen) return true;
        break;
      }
      if (rd.round > round) continue;
      const open = (rd.matches || []).some(function (m) { return m && m.bye == null && !m.dead && !m.result; });
      if (open) return false;
    }
    return true;
  }

  function roundLabel(slot, m) {
    let s;
    if (slot.title) s = m.label || term(slot.title);
    else s = m.name || tx('teamview.round', 'Runde {n}', { n: slot.round });
    return clean(s, 40) || clean(tx('teamview.round', 'Runde {n}', { n: slot.round }), 40);
  }

  function tableRows(ranked, teams) {
    const rows = [];
    (ranked || []).forEach(function (r) {
      if (!r || !isInt(r.team) || r.team < 1 || r.team > teams) return;
      const st = r.stat || {};
      rows.push({
        team: r.team,
        rank: isInt(r.place) && r.place >= 1 ? r.place : rows.length + 1,
        played: isInt(st.games) && st.games >= 0 ? st.games : 0,
        pts: isInt(st.pts) ? st.pts : null,
        diff: isInt(st.bd) ? st.bd : null
      });
    });
    return rows.slice(0, TEAMS_MAX);
  }

  /* Endplatzierungen der Turnierform (KO, Gruppen + Finalrunde …): nur aufgelöste Teams. */
  function placesOf(plan, teams, started) {
    const out = [];
    if (!started && !plan.complete) return out;
    (Array.isArray(plan.placements) ? plan.placements : []).forEach(function (p) {
      if (!p || !isInt(p.team) || p.team < 1 || p.team > teams || !isInt(p.place) || p.place < 1 || p.place > 999 || p.unresolved) return;
      out.push({ team: p.team, place: p.place, to: isInt(p.placeTo) && p.placeTo > p.place && p.placeTo <= 999 ? p.placeTo : null });
    });
    out.forEach(function (o) {
      if (o.to == null) {
        const n = out.filter(function (x) { return x.place === o.place; }).length;
        if (n > 1) o.to = o.place + n - 1;
      }
    });
    return out.length <= TEAMS_MAX ? out : [];
  }

  function tablesOf(plan, teams) {
    const out = [];
    function add(name, ranked) {
      const rows = tableRows(ranked, teams);
      if (rows.length && out.length < MAX_TABLES) out.push({ name: clean(name, 40), rows: rows });
    }
    const g = plan.groupTables;
    if (g) {
      (Array.isArray(g) ? g : Object.keys(g).map(function (k) { return g[k]; })).forEach(function (t, i) {
        if (t) add(t.name || t.title || ('Gruppe ' + String.fromCharCode(65 + i)), t.ranked);
      });
    }
    const mt = plan.mainTables;
    if (mt) {
      Object.keys(mt).forEach(function (k) {
        const t = mt[k];
        if (t) add(term(t.name || t.title || String(k)), t.ranked);
      });
    }
    if (plan.table && plan.table.ranked) add(tx('teamview.table', 'Tabelle'), plan.table.ranked);
    return out;
  }

  /* Reine Umwandlung (ohne DOM/Storage) – auch für Node-Tests. */
  function fromPlan(state, plan, o) {
    if (!state || !plan || !state.config) return null;
    const teams = Number(state.config.teams);
    if (!isInt(teams) || teams < 1 || teams > TEAMS_MAX) return null;
    const TP = (typeof TPlanning !== 'undefined' && TPlanning) ? TPlanning
      : (typeof require === 'function' ? require('./planning-engine.js') : null);
    if (!TP) return null;
    const matches = [];
    TP.slots(plan).forEach(function (slot) {
      if (!slot || slot.displayOnly || !Array.isArray(slot.matches)) return;
      slot.matches.forEach(function (m, idx) {
        if (!m || m.bye != null || m.dead) return;
        if (m.reset && plan.deResetNeeded === false) return;
        if (!swissVisible(plan, m.round || slot.round)) return;
        const a = isInt(m.ta) && m.ta >= 1 && m.ta <= teams ? m.ta : null;
        const b = isInt(m.tb) && m.tb >= 1 && m.tb <= teams ? m.tb : null;
        const f = isInt(m.field) ? m.field : idx;
        const id = String(m.id == null ? '' : m.id);
        matches.push({
          id: id && id.length <= 24 && !/[\u0000-\u001F\u007F]/.test(id) ? id : 'm' + matches.length,
          round: roundLabel(slot, m),
          a: a,
          b: b,
          field: fieldName(state, f),
          time: hhmm(slot.startMin),
          sets: setsOf(state, m.id),
          done: !!m.result
        });
      });
    });
    if (matches.length > MAX_MATCHES) return null;
    const title = clean((o && o.title) || state.title || (o && o.type ? term(o.type) : ''), 80)
      || clean(tx('share.tournament', 'Turnier'), 80);
    const view = { v: 1, title: title, teams: teams, matches: matches, tables: tablesOf(plan, teams) };
    const places = placesOf(plan, teams, matches.some(function (m) { return m.done; }));
    if (places.length) { view.places = places; view.final = !!plan.complete; }
    if (byteLength(JSON.stringify(view)) > MAX_BYTES) return null;
    return view;
  }

  function build(o) {
    return new Promise(function (resolve) {
      const h = hook();
      if (!h) { resolve(null); return; }
      let ctx;
      try { ctx = h(o); } catch (e) { resolve(null); return; }
      if (!supported(o)) { resolve(null); return; }
      let v = null;
      try { v = fromPlan(ctx.state, ctx.plan, o); } catch (e) { v = null; }
      resolve(v);
    });
  }

  /* ------------------------------------------------------------ Link/QR */
  function viewUrl(code) {
    let base;
    if (typeof TNative !== 'undefined' && TNative && TNative.isNative && TNative.isNative()) {
      base = TNative.publicPageUrl(root.location.href);
    } else {
      base = new URL(root.location.href);
    }
    base.hash = '';
    base.search = '';
    return new URL('team.html', base).href + '#v=' + encodeURIComponent(code);
  }

  function qrImage(url) {
    try {
      const qr = qrcode(0, 'M');
      qr.addData(url, 'Byte');
      qr.make();
      return qr.createDataURL(4, 16);
    } catch (e) { return ''; }
  }

  function ensureStyle() {
    const doc = root.document;
    if (doc.getElementById('tteamqr-style')) return;
    const st = doc.createElement('style');
    st.id = 'tteamqr-style';
    st.textContent =
      '.tteamqr-qr{display:block;width:240px;max-width:100%;height:auto;margin:0 auto 12px;background:#fff;border:8px solid #fff;}' +
      '.tteamqr-link{display:flex;margin-bottom:12px;}' +
      '.tteamqr-link input{flex:1;min-width:0;min-height:44px;padding:10px 12px;font-size:14px;font-family:inherit;color:#1a1a2e;border:1.5px solid #8a96a8;border-radius:9px;background:#fff;box-sizing:border-box;}' +
      '.tteamqr-link button{margin-left:8px;}' +
      '.tteamqr-warn{background:#fff7e0;border:1px solid #ecd48a;border-radius:8px;padding:8px 12px;font-size:13px;}' +
      '.tteamqr-prev{background:#f3f6fa;border-radius:8px;padding:8px 12px;font-size:13px;margin:0 0 12px;}' +
      '.tteamqr-prev b{color:#1a3a5c;}' +
      '@media screen and (max-width:479px){.tteamqr-link{flex-wrap:wrap;}.tteamqr-link input{flex-basis:100%;}.tteamqr-link button{width:100%;margin:8px 0 0;}}' +
      '#tteamqr-poster{display:none;}' +
      '@media print{@page{size:A4;margin:14mm;}' +
        'body.tteamqr-printing > *{display:none !important;}' +
        'body.tteamqr-printing > #tteamqr-poster{display:block !important;text-align:center;color:#000;font-family:Arial,Helvetica,sans-serif;}' +
        '#tteamqr-poster h1{font-size:40pt;line-height:1.15;margin:0 0 10mm;word-wrap:break-word;}' +
        '#tteamqr-poster img{width:150mm;height:150mm;max-width:100%;}' +
        '#tteamqr-poster .tteamqr-plink{font-size:16pt;margin:8mm 0;word-wrap:break-word;}' +
        '#tteamqr-poster p{font-size:18pt;margin:0 0 4mm;}}';
    doc.head.appendChild(st);
  }

  function copyText(text, input) {
    function fallback() {
      try { input.focus(); input.select(); return root.document.execCommand('copy'); } catch (e) { return false; }
    }
    if (root.navigator && root.navigator.clipboard && root.navigator.clipboard.writeText) {
      return root.navigator.clipboard.writeText(text).then(function () { return true; }, function () { return fallback(); });
    }
    return Promise.resolve(fallback());
  }

  function printPoster(view, url, img) {
    const doc = root.document;
    const poster = doc.createElement('div');
    poster.id = 'tteamqr-poster';
    poster.innerHTML =
      '<h1>' + esc(view.title) + '</h1>' +
      '<img alt="' + esc(tx('teamview.qrAlt', 'QR-Code')) + '" src="' + img + '">' +
      '<div class="tteamqr-plink">' + esc(url) + '</div>' +
      '<p><b>' + esc(tx('teamview.poster.scan', 'QR-Code scannen, Teamnummer wählen – fertig.')) + '</b></p>' +
      '<p>' + esc(tx('teamview.poster.hint', 'Nächstes Spiel, Ergebnisse und Tabellen live auf dem Handy.')) + '</p>';
    doc.body.appendChild(poster);
    doc.body.classList.add('tteamqr-printing');
    function cleanup() {
      doc.body.classList.remove('tteamqr-printing');
      if (poster.parentNode) poster.parentNode.removeChild(poster);
    }
    if (typeof TNative !== 'undefined' && TNative && TNative.isNative && TNative.isNative() && TNative.print) {
      TNative.print().then(cleanup, cleanup);
      return;
    }
    root.addEventListener('afterprint', function once() {
      root.removeEventListener('afterprint', once);
      cleanup();
    });
    root.setTimeout(function () { root.print(); }, 50);
  }

  function openDialog(o, viewCode) {
    const share = root.TShare;
    if (!share || !share.openInfoDialog || !viewCode) return Promise.resolve(false);
    let url;
    try { url = viewUrl(viewCode); } catch (e) {
      root.alert(tx('native.share.noPublicUrl', 'Für diese Seite gibt es keinen öffentlichen Link.'));
      return Promise.resolve(false);
    }
    return build(o).then(function (view) {
      if (!view) {
        root.alert(tx('teamview.unsupported', 'Für dieses Turnier ist keine Team-Live-View möglich.'));
        return false;
      }
      ensureStyle();
      const img = qrImage(url);
      const fields = [];
      view.matches.forEach(function (m) { if (m.field && fields.indexOf(m.field) < 0) fields.push(m.field); });
      const body =
        (img ? '<img class="tteamqr-qr" alt="' + esc(tx('teamview.qrAlt', 'QR-Code')) + '" src="' + img + '">' : '<p class="tshare-error">' + esc(tx('share.result.qrUnavailable', 'Für diesen Link konnte kein QR-Code erstellt werden. Nutze den Link.')) + '</p>') +
        '<div class="tteamqr-link"><input type="text" readonly value="' + esc(url) + '" aria-label="' + esc(tx('teamview.linkLabel', 'Link')) + '">' +
        '<button type="button" class="tshare-btn tshare-btn-ghost" data-act="copy">' + esc(tx('share.copy', 'Kopieren')) + '</button></div>' +
        '<p class="tshare-copied" data-role="copied" hidden></p>' +
        '<p>' + esc(tx('teamview.hint', 'Spieler:innen wählen nach dem Scannen ihre Teamnummer. Andere Teams erscheinen nur als Nummer.')) + '</p>' +
        '<p class="tteamqr-warn">' + esc(tx('teamview.stable', 'Teamnummern nach dem Aushang nicht mehr ändern. Der QR-Code bleibt gleich, die Nummern nicht.')) + '</p>' +
        '<div class="tteamqr-prev"><b>' + esc(tx('teamview.preview', 'Wird veröffentlicht')) + ':</b><br>' +
        esc(tx('teamview.preview.title', 'Titel')) + ': ' + esc(view.title) + '<br>' +
        esc(tx('teamview.preview.teams', 'Teams')) + ': ' + view.teams + '<br>' +
        esc(tx('teamview.preview.fields', 'Felder')) + ': ' + (fields.length ? esc(fields.join(', ')) : '–') + '</div>';
      const panel = share.openInfoDialog({
        title: tx('teamview.title', 'Team-Live-View'),
        bodyHtml: body,
        confirmLabel: tx('teamview.print', 'Aushang drucken'),
        cancelLabel: tx('share.close', 'Schließen'),
        onConfirm: function () { if (img) printPoster(view, url, img); }
      });
      const btn = panel && panel.querySelector && panel.querySelector('[data-act="copy"]');
      if (btn) btn.addEventListener('click', function () {
        const input = panel.querySelector('.tteamqr-link input');
        const msg = panel.querySelector('[data-role="copied"]');
        copyText(url, input).then(function (ok) {
          if (ok && msg) { msg.textContent = tx('share.copied', 'Kopiert ✓'); msg.hidden = false; }
        });
      });
      return true;
    });
  }

  return { supported: supported, build: build, fromPlan: fromPlan, openDialog: openDialog, viewUrl: viewUrl };
});
