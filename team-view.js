/* Anonyme Team-Ansicht (team.html#v=<viewCode>). Kein TStore, keine Planungs-
   engine: zeigt nur, was der Server als teamView v1 liefert (Teamnummern). */
(function () {
  'use strict';

  /* Dupliziert aus core/turnier-share.js (API_BASE) – bewusst hier an EINER
     Stelle, damit die schlanke Seite nicht das ganze Share-Modul laden muss. */
  var API_BASE = 'https://beachvolley.klickdienst-server.de/api';
  var POLL_MS = 20000;

  var L = {
    de: {
      title: 'Team-Live-View', pick: 'Wähle deine Teamnummer', change: 'Team wechseln',
      asOf: 'Stand: {time} (Revision {rev})', offline: 'Offline – Stand von {time}',
      ended: 'Diese Ansicht wurde beendet.', invalid: 'Ungültiger Link.', loading: 'Lade …',
      noData: 'Keine Verbindung und noch keine Daten gespeichert.',
      yourTeam: 'Dein Team: Team {n}', next: 'Nächstes Spiel', vs: 'gegen {opp}', oppOpen: 'Gegner noch offen',
      at: '{t} Uhr', myMatches: 'Deine Spiele', noMatches: 'Noch keine Spiele.',
      done: 'beendet', open: 'ausstehend', tables: 'Tabellen', myPlaces: 'Deine Platzierung',
      team: 'Team', rank: 'Pl.', played: 'Sp.', pts: 'Pkt.', diff: 'Diff.', allDone: 'Alle Spiele sind gespielt.',
      teamN: 'Team {n}',
      promoTitle: 'Dein Turnier selbst planen?', promoText: 'CompetitionPilot: Spielpläne, Tabellen und Ergebnisse für Beachvolleyball-Turniere – kostenlos im Browser.', promoCta: 'Web-App öffnen ↗'
    },
    en: {
      title: 'Team-Live-View', pick: 'Pick your team number', change: 'Change team',
      asOf: 'As of {time} (revision {rev})', offline: 'Offline – as of {time}',
      ended: 'This view has ended.', invalid: 'Invalid link.', loading: 'Loading …',
      noData: 'No connection and no saved data yet.',
      yourTeam: 'Your team: Team {n}', next: 'Next match', vs: 'vs. {opp}', oppOpen: 'Opponent to be decided',
      at: '{t}', myMatches: 'Your matches', noMatches: 'No matches yet.',
      done: 'finished', open: 'upcoming', tables: 'Standings', myPlaces: 'Your standing',
      team: 'Team', rank: 'Pos.', played: 'P', pts: 'Pts', diff: 'Diff', allDone: 'All your matches are played.',
      teamN: 'Team {n}',
      promoTitle: 'Plan your own tournament?', promoText: 'CompetitionPilot: schedules, standings and results for beach volleyball tournaments – free in your browser.', promoCta: 'Open web app ↗'
    }
  };
  var lang = typeof TI18n !== 'undefined' && TI18n ? TI18n.lang() : (/^de/i.test(navigator.language || navigator.userLanguage || 'de') ? 'de' : 'en');
  document.documentElement.lang = lang;
  ['title', 'text', 'cta'].forEach(function (k) {
    var el = document.getElementById('tv-promo-' + k);
    if (el) el.textContent = L[lang]['promo' + k.charAt(0).toUpperCase() + k.slice(1)];
  });
  function t(key, p) {
    var s = L[lang][key] || key;
    if (p) Object.keys(p).forEach(function (k) { s = s.split('{' + k + '}').join(p[k]); });
    return s;
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var root = document.getElementById('tv');
  var m = /[#&]v=([^&]+)/.exec(location.hash || '');
  var code = '';
  try { code = m ? decodeURIComponent(m[1]) : ''; } catch (e) { code = ''; }
  var KEY_TEAM = 'beachl-tv-team-' + code;
  var KEY_DATA = 'beachl-tv-data-' + code;

  var data = null, at = 0, etag = '', team = 0, status = 'loading', timer = null, busy = false, retryMs = 0;

  function load(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function save(key, v) { try { localStorage.setItem(key, v); } catch (e) { } }
  function drop(key) { try { localStorage.removeItem(key); } catch (e) { } }

  function clock(ms) {
    var d = new Date(ms);
    return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  }
  function teamName(n) { return t('teamN', { n: n }); }
  function setsText(sets) { return (sets || []).map(function (s) { return s[0] + ':' + s[1]; }).join(', '); }

  function matchHtml(mm, extra) {
    var opp = mm.a === team ? mm.b : mm.a;
    var meta = [esc(mm.round)];
    if (mm.field) meta.push(esc(mm.field));
    if (mm.time) meta.push(esc(t('at', { t: mm.time })));
    return '<div class="tv-card' + (mm.done ? ' tv-done' : '') + (extra || '') + '">' +
      '<div class="tv-big">' + esc(opp == null ? t('oppOpen') : t('vs', { opp: teamName(opp) })) + '</div>' +
      '<div class="tv-sub">' + meta.join(' · ') + '</div>' +
      (mm.done ? '<div class="tv-sets">' + esc(setsText(mm.sets)) + '</div>' : '') +
      '<div class="tv-st">' + esc(mm.done ? t('done') : t('open')) + '</div></div>';
  }

  function tableHtml(tb) {
    var h = '<div class="tv-tname">' + esc(tb.name) + '</div><table class="tv-tbl"><thead><tr><th>' + esc(t('rank')) +
      '</th><th>' + esc(t('team')) + '</th><th>' + esc(t('played')) + '</th><th>' + esc(t('pts')) + '</th><th>' + esc(t('diff')) + '</th></tr></thead><tbody>';
    tb.rows.forEach(function (r) {
      h += '<tr' + (r.team === team ? ' class="tv-me"' : '') + '><td>' + r.rank + '</td><td>' + esc(teamName(r.team)) +
        '</td><td>' + r.played + '</td><td>' + (r.pts == null ? '–' : r.pts) + '</td><td>' + (r.diff == null ? '–' : r.diff) + '</td></tr>';
    });
    return h + '</tbody></table>';
  }

  function render() {
    var h;
    if (status === 'invalid') { root.innerHTML = '<div class="tv-msg">' + esc(t('invalid')) + '</div>'; return; }
    if (status === 'ended') { root.innerHTML = '<div class="tv-msg">' + esc(t('ended')) + '</div>'; return; }
    if (!data) {
      root.innerHTML = '<div class="tv-msg">' + esc(status === 'offline' ? t('noData') : t('loading')) + '</div>';
      return;
    }
    h = '<h1>' + esc(data.title) + '</h1>' +
      '<p class="tv-meta">' + esc(t('asOf', { time: clock(at), rev: data.revision })) + '</p>' +
      (status === 'offline' ? '<div class="tv-off">' + esc(t('offline', { time: clock(at) })) + '</div>' : '');
    if (!team || team > data.teams) {
      h += '<h2>' + esc(t('pick')) + '</h2><div class="tv-grid">';
      for (var i = 1; i <= data.teams; i++) h += '<button type="button" data-team="' + i + '"><span>' + i + '</span></button>';
      root.innerHTML = h + '</div>';
      return;
    }
    var mine = (data.matches || []).filter(function (x) { return x.a === team || x.b === team; });
    var next = null;
    mine.forEach(function (x) { if (!next && !x.done) next = x; });
    h += '<div class="tv-top"><div class="tv-big">' + esc(t('yourTeam', { n: team })) + '</div>' +
      '<button type="button" class="tv-btn tv-btn-ghost" data-change="1">' + esc(t('change')) + '</button></div>';
    h += '<h2>' + esc(t('next')) + '</h2>' + (next ? matchHtml(next, ' tv-next') : '<div class="tv-card">' + esc(mine.length ? t('allDone') : t('noMatches')) + '</div>');
    h += '<h2>' + esc(t('myMatches')) + '</h2>';
    h += mine.length ? mine.map(function (x) { return matchHtml(x, ''); }).join('') : '<div class="tv-card">' + esc(t('noMatches')) + '</div>';
    var places = [];
    (data.tables || []).forEach(function (tb) {
      tb.rows.forEach(function (r) { if (r.team === team) places.push({ name: tb.name, rank: r.rank }); });
    });
    if (places.length) {
      h += '<h2>' + esc(t('myPlaces')) + '</h2>' + places.map(function (p) {
        return '<div class="tv-card"><span class="tv-big">' + p.rank + '.</span> <span class="tv-sub">' + esc(p.name) + '</span></div>';
      }).join('');
    }
    if ((data.tables || []).length) h += '<h2>' + esc(t('tables')) + '</h2>' + data.tables.map(tableHtml).join('');
    root.innerHTML = h;
  }

  root.addEventListener('click', function (e) {
    var el = e.target;
    while (el && el !== root && !(el.getAttribute && (el.getAttribute('data-team') || el.getAttribute('data-change')))) el = el.parentNode;
    if (!el || el === root) return;
    var n = el.getAttribute('data-team');
    if (n) { team = parseInt(n, 10); save(KEY_TEAM, String(team)); }
    else { team = 0; drop(KEY_TEAM); }
    render();
    window.scrollTo(0, 0);
  });

  function schedule() {
    clearTimeout(timer);
    if (status === 'ended' || status === 'invalid') return;
    var wait = retryMs || (POLL_MS + Math.floor(Math.random() * 5000));
    retryMs = 0;
    timer = setTimeout(poll, wait);
  }

  function poll() {
    if (document.hidden) { schedule(); return; }
    if (busy) return;
    busy = true;
    var headers = {};
    if (etag && data) headers['If-None-Match'] = etag;
    fetch(API_BASE + '/share.php?action=view&code=' + encodeURIComponent(code), { headers: headers, cache: 'no-store' })
      .then(function (res) {
        if (res.status === 304) { if (status === 'offline') { status = 'ok'; render(); } return; }
        if (res.status === 429) { retryMs = Math.min(300, Math.max(5, parseInt(res.headers.get('Retry-After'), 10) || 30)) * 1000 + Math.floor(Math.random() * 3000); return; }
        if (res.status === 404) { status = 'ended'; drop(KEY_DATA); render(); return; }
        if (!res.ok) throw new Error('http ' + res.status);
        var tag = res.headers.get('ETag');
        return res.json().then(function (d) {
          if (!d || d.v !== 1 || !Array.isArray(d.matches)) throw new Error('format');
          data = d; at = Date.now();
          etag = tag || '"' + d.revision + '"';
          status = 'ok';
          save(KEY_DATA, JSON.stringify({ data: d, at: at, etag: etag }));
          render();
        });
      })
      .then(null, function () { if (status !== 'ended') { status = 'offline'; render(); } })
      .then(function () { busy = false; schedule(); });
  }

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && status !== 'ended' && status !== 'invalid') { clearTimeout(timer); poll(); }
  });
  window.addEventListener('online', function () { clearTimeout(timer); poll(); });
  window.addEventListener('hashchange', function () { location.reload(); });

  document.title = t('title');
  if (!code) { status = 'invalid'; render(); return; }
  team = parseInt(load(KEY_TEAM) || '0', 10) || 0;
  try {
    var saved = JSON.parse(load(KEY_DATA) || 'null');
    if (saved && saved.data) { data = saved.data; at = saved.at || 0; etag = saved.etag || ''; status = 'offline'; }
  } catch (e) { }
  status = data ? 'ok' : 'loading';
  render();
  poll();
})();
