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
      next: 'Nächstes Spiel', vs: 'gegen {opp}', oppOpen: 'Gegner noch offen',
      at: '{t} Uhr', myMatches: 'Deine Spiele', noMatches: 'Noch keine Spiele.',
      done: 'beendet', open: 'offen', toPlay: 'Noch zu spielen', playedH: 'Gespielt', tables: 'Tabellen',
      team: 'Team', rank: 'Pl.', played: 'Sp.', pts: 'Pkt.', diff: 'Diff.', allDone: 'Alle Spiele sind gespielt.',
      teamN: 'Team {n}',
      win: 'Sieg', loss: 'Niederlage', draw: 'Unentschieden', live: 'Live', you: 'Du',
      placeFinal: 'Endplatzierung', placeNow: 'Aktuelle Platzierung', placeIn: 'Platz {r} in {name}',
      finalDone: 'Turnier beendet', finalList: 'Endstand', finalListNow: 'Zwischenstand',
      stPlayed: 'Spiele', stPts: 'Punkte', stDiff: 'Differenz', 
      promoTitle: 'Dein Turnier selbst planen?', promoText: 'CompetitionPilot: Spielpläne, Tabellen und Ergebnisse für Beachvolleyball-Turniere – kostenlos im Browser.', promoCta: 'Web-App öffnen ↗'
    },
    en: {
      title: 'Team-Live-View', pick: 'Pick your team number', change: 'Change team',
      asOf: 'As of {time} (revision {rev})', offline: 'Offline – as of {time}',
      ended: 'This view has ended.', invalid: 'Invalid link.', loading: 'Loading …',
      noData: 'No connection and no saved data yet.',
      next: 'Next match', vs: 'vs. {opp}', oppOpen: 'Opponent to be decided',
      at: '{t}', myMatches: 'Your matches', noMatches: 'No matches yet.',
      done: 'finished', open: 'open', toPlay: 'Still to play', playedH: 'Played', tables: 'Standings', 
      team: 'Team', rank: 'Pos.', played: 'P', pts: 'Pts', diff: 'Diff', allDone: 'All your matches are played.',
      teamN: 'Team {n}',
      win: 'Win', loss: 'Loss', draw: 'Draw', live: 'Live', you: 'You',
      placeFinal: 'Final place', placeNow: 'Current place', placeIn: 'Place {r} in {name}',
      finalDone: 'Tournament finished', finalList: 'Final standings', finalListNow: 'Current standings',
      stPlayed: 'Played', stPts: 'Points', stDiff: 'Difference', 
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
  function flip(sets, me) { return (sets || []).map(function (s) { return me === 'b' ? [s[1], s[0]] : [s[0], s[1]]; }); }
  function setsText(sets) { return (sets || []).map(function (s) { return s[0] + ':' + s[1]; }).join(' · '); }
  function outcome(sets) {
    var w = 0, l = 0;
    (sets || []).forEach(function (s) { if (s[0] > s[1]) w++; else if (s[0] < s[1]) l++; });
    return w > l ? 'win' : (w < l ? 'loss' : 'draw');
  }
  function placeLabel(p, to) { return to != null && to > p ? p + '–' + to + '.' : p + '.'; }
  function medal(p) { return p === 1 ? ' tv-gold' : p === 2 ? ' tv-silver' : p === 3 ? ' tv-bronze' : ''; }

  function matchHtml(mm, extra) {
    var side = mm.a === team ? 'a' : 'b';
    var opp = side === 'a' ? mm.b : mm.a;
    var meta = [esc(mm.round)];
    if (mm.field) meta.push(esc(mm.field));
    if (mm.time) meta.push(esc(t('at', { t: mm.time })));
    var sets = flip(mm.sets, side), res = mm.done && sets.length ? outcome(sets) : '';
    return '<div class="tv-card tv-match' + (mm.done ? ' tv-done' : '') + (res ? ' tv-' + res : '') + (extra || '') + '">' +
      '<div class="tv-mrow"><div class="tv-big">' + esc(opp == null ? t('oppOpen') : t('vs', { opp: teamName(opp) })) + '</div>' +
      (res ? '<span class="tv-pill tv-pill-' + res + '">' + esc(t(res)) + '</span>'
        : '<span class="tv-pill">' + esc(t(mm.done ? 'done' : 'open')) + '</span>') + '</div>' +
      (extra && extra.indexOf('tv-next') >= 0 && (mm.field || mm.time) ? '<div class="tv-when">' + esc([mm.field, mm.time ? t('at', { t: mm.time }) : ''].filter(Boolean).join(' · ')) + '</div>' : '') +
      '<div class="tv-sub">' + meta.join(' · ') + '</div>' +
      (mm.done && sets.length ? '<div class="tv-sets">' + esc(setsText(sets)) + '</div>' : '') + '</div>';
  }

  function tableHtml(tb) {
    var h = '<div class="tv-tname">' + esc(tb.name) + '</div><table class="tv-tbl"><thead><tr><th>' + esc(t('rank')) +
      '</th><th>' + esc(t('team')) + '</th><th>' + esc(t('played')) + '</th><th>' + esc(t('pts')) + '</th><th>' + esc(t('diff')) + '</th></tr></thead><tbody>';
    tb.rows.forEach(function (r) {
      h += '<tr' + (r.team === team ? ' class="tv-me"' : '') + '><td>' + r.rank + '</td><td>' + esc(teamName(r.team)) +
        (r.team === team ? ' <span class="tv-you">' + esc(t('you')) + '</span>' : '') +
        '</td><td>' + r.played + '</td><td>' + (r.pts == null ? '–' : r.pts) + '</td><td>' + (r.diff == null ? '–' : (r.diff > 0 ? '+' + r.diff : r.diff)) + '</td></tr>';
    });
    return h + '</tbody></table>';
  }

  /* Endstand: nur Teilnehmer-Nummern. Stammt aus data.places (Endplatzierungen der Turnierform)
     oder – bei einer einzigen Tabelle (Jeder gegen Jeden) – aus der Tabelle. */
  function standings(allDone) {
    if (data.places && data.places.length) {
      return { final: data.final === true, rows: data.places.slice().sort(function (x, y) { return x.place - y.place || x.team - y.team; })
        .map(function (p) { return { team: p.team, place: p.place, to: p.to }; }) };
    }
    if ((data.tables || []).length === 1 && data.tables[0].rows.length) {
      return { final: allDone, rows: data.tables[0].rows.map(function (r) { return { team: r.team, place: r.rank, to: null, pts: r.pts, diff: r.diff, played: r.played }; }) };
    }
    return null;
  }

  function standingsHtml(st) {
    var h = '<h2>' + esc(t(st.final ? 'finalList' : 'finalListNow')) + '</h2><ol class="tv-rank">';
    st.rows.forEach(function (r) {
      var me = r.team === team;
      h += '<li class="tv-rrow' + (me ? ' tv-me' : '') + '"><span class="tv-medal' + medal(r.place) + '">' + esc(placeLabel(r.place, r.to)) + '</span>' +
        '<span class="tv-rname">' + esc(teamName(r.team)) + (me ? ' <span class="tv-you">' + esc(t('you')) + '</span>' : '') + '</span>' +
        (r.pts != null ? '<span class="tv-rstat">' + r.pts + ' ' + esc(t('pts')) + '</span>' : '') + '</li>';
    });
    return h + '</ol>';
  }

  function myRow() {
    var out = null;
    (data.tables || []).forEach(function (tb) { tb.rows.forEach(function (r) { if (r.team === team) out = { tb: tb, r: r }; }); });
    return out;
  }

  function heroHtml(st, allDone) {
    var mineRow = myRow(), pl = null;
    if (st) st.rows.forEach(function (r) { if (r.team === team) pl = r; });
    var h = '<section class="tv-hero' + (pl && st.final ? ' tv-hero-final' : '') + '"><div class="tv-hero-top"><div class="tv-hero-id"><span class="tv-badge">' + team +
      '</span><div><div class="tv-hero-kicker">' + esc(t('title')) + '</div><div class="tv-hero-team">' + esc(teamName(team)) + '</div></div></div>' +
      '<button type="button" class="tv-btn tv-btn-light" data-change="1">' + esc(t('change')) + '</button></div>';
    if (pl) {
      h += '<div class="tv-hero-place"><span class="tv-hero-rank' + (st.final ? medal(pl.place) : '') + '">' + esc(placeLabel(pl.place, pl.to)) + '</span><span class="tv-hero-lbl">' +
        esc(t(st.final ? 'placeFinal' : 'placeNow')) + '</span></div>';
    } else if (mineRow) {
      h += '<div class="tv-hero-place"><span class="tv-hero-rank">' + mineRow.r.rank + '.</span><span class="tv-hero-lbl">' + esc(t('placeIn', { r: mineRow.r.rank, name: mineRow.tb.name })) + '</span></div>';
    }
    if (mineRow) {
      var d = mineRow.r.diff;
      h += '<div class="tv-stats"><div><b>' + mineRow.r.played + '</b><span>' + esc(t('stPlayed')) + '</span></div>' +
        '<div><b>' + (mineRow.r.pts == null ? '–' : mineRow.r.pts) + '</b><span>' + esc(t('stPts')) + '</span></div>' +
        '<div><b>' + (d == null ? '–' : (d > 0 ? '+' + d : d)) + '</b><span>' + esc(t('stDiff')) + '</span></div></div>';
    }
    return h + '</section>';
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
      '<p class="tv-meta" role="status"><span class="tv-dot' + (status === 'offline' ? ' tv-dot-off' : '') + '"></span>' + esc(t('asOf', { time: clock(at), rev: data.revision })) + '</p>' +
      (status === 'offline' ? '<div class="tv-off">' + esc(t('offline', { time: clock(at) })) + '</div>' : '');
    if (!team || team > data.teams) {
      h += '<h2>' + esc(t('pick')) + '</h2><div class="tv-grid">';
      for (var i = 1; i <= data.teams; i++) h += '<button type="button" data-team="' + i + '" aria-label="' + esc(teamName(i)) + '"><span>' + i + '</span></button>';
      root.innerHTML = h + '</div>';
      return;
    }
    var mine = (data.matches || []).filter(function (x) { return x.a === team || x.b === team; });
    var allMatches = data.matches || [];
    var allDone = allMatches.length > 0 && allMatches.every(function (x) { return x.done; });
    var st = standings(allDone);
    var next = null;
    mine.forEach(function (x) { if (!next && !x.done) next = x; });
    h += heroHtml(st, allDone);
    if (st && st.final) h += '<div class="tv-finished">' + esc(t('finalDone')) + '</div>';
    else h += '<h2>' + esc(t('next')) + '</h2>' + (next ? matchHtml(next, ' tv-next') : '<div class="tv-card">' + esc(mine.length ? t('allDone') : t('noMatches')) + '</div>');
    var open = mine.filter(function (x) { return !x.done && x !== next; }), fin = mine.filter(function (x) { return x.done; });
    if (!mine.length) h += '<h2>' + esc(t('myMatches')) + '</h2><div class="tv-card">' + esc(t('noMatches')) + '</div>';
    if (open.length) h += '<h2><span class="tv-sq tv-sq-open"></span>' + esc(t('toPlay')) + ' (' + open.length + ')</h2>' + open.map(function (x) { return matchHtml(x, ''); }).join('');
    if (fin.length) h += '<h2><span class="tv-sq tv-sq-done"></span>' + esc(t('playedH')) + ' (' + fin.length + ')</h2>' + fin.map(function (x) { return matchHtml(x, ''); }).join('');
    if (st && data.places && data.places.length) h += standingsHtml(st);
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
        if (res.status === 304) { at = Date.now(); if (status === 'offline') { status = 'ok'; render(); } else { var mt = root.querySelector('.tv-meta'); if (mt && data) mt.lastChild.nodeValue = t('asOf', { time: clock(at), rev: data.revision }); } return; }
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
