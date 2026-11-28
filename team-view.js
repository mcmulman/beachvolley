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
      asOf: 'Stand {time}', checked: 'zuletzt geprüft vor {n} Min', refresh: 'Aktualisieren', share: 'Teilen', copied: 'Link kopiert',
      inMin: 'in {n} Min', now: 'jetzt', overdue: 'geplant war {t} Uhr', goTo: 'Zum {f}!', goToAny: 'Mach dich bereit!', goSub: 'Dein Spiel beginnt in {n} Min.', goNow: 'Dein Spiel beginnt jetzt.', goLate: 'Geplant war {t} Uhr – bitte bereit halten.',
      chTitle: 'Änderungen', dismiss: 'Schließen',
      chTime: '{r}: Zeit {a} → {b}', chField: '{r}: Feld {a} → {b}', chOpp: '{r}: Gegner steht fest – {o}', chDone: '{r}: Ergebnis eingetragen', chNew: 'Neues Spiel: {r}', offline: 'Offline – Stand von {time}',
      ended: 'Diese Ansicht wurde beendet.', invalid: 'Ungültiger Link.', loading: 'Lade …',
      noData: 'Keine Verbindung und noch keine Daten gespeichert.',
      next: 'Nächstes Spiel', vs: 'gegen {opp}', oppOpen: 'Gegner noch offen',
      at: '{t} Uhr', myMatches: 'Deine Spiele', noMatches: 'Noch keine Spiele.',
      done: 'beendet', open: 'offen', toPlay: 'Noch zu spielen', playedH: 'Gespielt', tables: 'Tabellen',
      team: 'Team', rank: 'Pl.', played: 'Sp.', pts: 'Pkt.', diff: 'Diff.', noNext: 'Aktuell kein offenes Spiel – ggf. folgen weitere Runden.', stOf: 'Zahlen aus {name}', later: 'Folgerunden', laterHint: 'Teilnehmer stehen noch nicht fest.',
      teamN: 'Team {n}',
      win: 'Sieg', loss: 'Niederlage', draw: 'Unentschieden', live: 'Live', you: 'Du',
      placeFinal: 'Endplatzierung', placeNow: 'Aktuelle Platzierung', placeIn: 'Platz {r} in {name}', tiedWith: 'Geteilt mit {teams}',
      finalDone: 'Turnier beendet', finalList: 'Endstand', finalListNow: 'Zwischenstand',
      stPlayed: 'Spiele', stPts: 'Punkte', stDiff: 'Differenz', 
      promoTitle: 'Dein Turnier selbst planen?', promoText: 'CompetitionPilot: Spielpläne, Tabellen und Ergebnisse für Beachvolleyball-Turniere – kostenlos im Browser.', promoCta: 'Web-App öffnen ↗'
    },
    en: {
      title: 'Team-Live-View', pick: 'Pick your team number', change: 'Change team',
      asOf: 'Updated {time}', checked: 'last checked {n} min ago', refresh: 'Refresh', share: 'Share', copied: 'Link copied',
      inMin: 'in {n} min', now: 'now', overdue: 'scheduled {t}', goTo: 'Go to {f}!', goToAny: 'Get ready!', goSub: 'Your match starts in {n} min.', goNow: 'Your match starts now.', goLate: 'Scheduled for {t} – please be ready.',
      chTitle: 'Changes', dismiss: 'Dismiss',
      chTime: '{r}: time {a} → {b}', chField: '{r}: court {a} → {b}', chOpp: '{r}: opponent decided – {o}', chDone: '{r}: result entered', chNew: 'New match: {r}', offline: 'Offline – as of {time}',
      ended: 'This view has ended.', invalid: 'Invalid link.', loading: 'Loading …',
      noData: 'No connection and no saved data yet.',
      next: 'Next match', vs: 'vs. {opp}', oppOpen: 'Opponent to be decided',
      at: '{t}', myMatches: 'Your matches', noMatches: 'No matches yet.',
      done: 'finished', open: 'open', toPlay: 'Still to play', playedH: 'Played', tables: 'Standings', 
      team: 'Team', rank: 'Pos.', played: 'P', pts: 'Pts', diff: 'Diff', noNext: 'No open match right now – more rounds may follow.', stOf: 'Figures from {name}', later: 'Later rounds', laterHint: 'Participants are not decided yet.',
      teamN: 'Team {n}',
      win: 'Win', loss: 'Loss', draw: 'Draw', live: 'Live', you: 'You',
      placeFinal: 'Final place', placeNow: 'Current place', placeIn: 'Place {r} in {name}', tiedWith: 'Shared with {teams}',
      finalDone: 'Tournament finished', finalList: 'Final standings', finalListNow: 'Current standings',
      stPlayed: 'Played', stPts: 'Points', stDiff: 'Difference', 
      promoTitle: 'Plan your own tournament?', promoText: 'CompetitionPilot: schedules, standings and results for beach volleyball tournaments – free in your browser.', promoCta: 'Open web app ↗'
    }
  };
  var lang = typeof TI18n !== 'undefined' && TI18n ? TI18n.lang() : (/^de/i.test(navigator.language || navigator.userLanguage || 'de') ? 'de' : 'en');
  document.documentElement.lang = lang;
  ['title', 'text', 'cta'].forEach(function (k) {
    var el = document.getElementById('tl-promo-' + k);
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

  var root = document.getElementById('tl');
  var m = /[#&]v=([^&]+)/.exec(location.hash || '');
  var code = '';
  try { code = m ? decodeURIComponent(m[1]) : ''; } catch (e) { code = ''; }
  var KEY_TEAM = 'beachl-tv-team-' + code;
  var KEY_DATA = 'beachl-tv-data-' + code;

  var data = null, at = 0, etag = '', team = 0, status = 'loading', timer = null, busy = false, retryMs = 0, changes = [], alerted = {}, toast = '';

  function load(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function save(key, v) { try { localStorage.setItem(key, v); } catch (e) { } }
  function drop(key) { try { localStorage.removeItem(key); } catch (e) { } }

  function clock(ms) {
    var d = new Date(ms);
    return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  }
  function minutesTo(hhmm) {
    var mt = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '');
    if (!mt || parseInt(mt[1], 10) > 23 || parseInt(mt[2], 10) > 59) return null;
    var d = new Date();
    return parseInt(mt[1], 10) * 60 + parseInt(mt[2], 10) - (d.getHours() * 60 + d.getMinutes());
  }
  function teamLink() { return location.href.split('#')[0] + '#v=' + encodeURIComponent(code) + '&t=' + team; }
  function buzz() { try { if (navigator.vibrate) navigator.vibrate([200, 100, 200]); } catch (e) { } }

  /* Vergleicht nur die Spiele des gewählten Teams (alt vs. neu) und liefert Hinweistexte. */
  function diffMine(oldD, newD) {
    var out = [];
    if (!oldD || !team) return out;
    var olds = {};
    (oldD.matches || []).forEach(function (x) { olds[x.id] = x; });
    var hadMine = (oldD.matches || []).some(function (x) { return x.a === team || x.b === team; });
    (newD.matches || []).forEach(function (n) {
      if (n.a !== team && n.b !== team) return;
      var o = olds[n.id];
      if (!o) { if (hadMine) out.push(t('chNew', { r: n.round })); return; }
      var opp = n.a === team ? n.b : n.a, oldOpp = o.a === team ? o.b : o.a;
      if (o.time !== n.time && n.time) out.push(t('chTime', { r: n.round, a: o.time || '–', b: n.time }));
      if (o.field !== n.field && n.field) out.push(t('chField', { r: n.round, a: o.field || '–', b: n.field }));
      if (opp != null && opp !== oldOpp) out.push(t('chOpp', { r: n.round, o: teamName(opp) }));
      if (n.done && !o.done) out.push(t('chDone', { r: n.round }));
    });
    return out;
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
  function medal(p) { return p === 1 ? ' tl-gold' : p === 2 ? ' tl-silver' : p === 3 ? ' tl-bronze' : ''; }

  function matchHtml(mm, extra) {
    var side = mm.a === team ? 'a' : 'b';
    var opp = side === 'a' ? mm.b : mm.a;
    var isNext = !!extra && extra.indexOf('tl-next') >= 0;
    var meta = [esc(mm.round)];
    if (mm.field && !isNext) meta.push(esc(mm.field));
    if (mm.time && !isNext) meta.push(esc(t('at', { t: mm.time })));
    var cd = '';
    if (extra && extra.indexOf('tl-next') >= 0 && !mm.done) {
      var mn = minutesTo(mm.time);
      if (mn != null && mn > 10 && mn < 720) cd = '<div class="tl-count">' + esc(mn > 0 ? t('inMin', { n: mn }) : (mn === 0 ? t('now') : t('overdue', { t: mm.time }))) + '</div>';
    }
    var sets = flip(mm.sets, side), res = mm.done && sets.length ? outcome(sets) : '';
    return '<div class="tl-card tl-match' + (mm.done ? ' tl-done' : '') + (res ? ' tl-' + res : '') + (extra || '') + '">' +
      '<div class="tl-mrow"><div class="tl-big">' + esc(opp == null ? t('oppOpen') : t('vs', { opp: teamName(opp) })) + '</div>' +
      (res ? '<span class="tl-pill tl-pill-' + res + '">' + esc(t(res)) + '</span>'
        : '<span class="tl-pill">' + esc(t(mm.done ? 'done' : 'open')) + '</span>') + '</div>' +
      (extra && extra.indexOf('tl-next') >= 0 && (mm.field || mm.time) ? '<div class="tl-when">' + esc([mm.field, mm.time ? t('at', { t: mm.time }) : ''].filter(Boolean).join(' · ')) + '</div>' : '') +
      cd + '<div class="tl-sub">' + meta.join(' · ') + '</div>' +
      (mm.done && sets.length ? '<div class="tl-sets">' + esc(setsText(sets)) + '</div>' : '') + '</div>';
  }

  function tableHtml(tb) {
    var h = '<div class="tl-tname">' + esc(tb.name) + '</div><table class="tl-tbl"><thead><tr><th>' + esc(t('rank')) +
      '</th><th>' + esc(t('team')) + '</th><th>' + esc(t('played')) + '</th><th>' + esc(t('pts')) + '</th><th>' + esc(t('diff')) + '</th></tr></thead><tbody>';
    tb.rows.forEach(function (r) {
      h += '<tr' + (r.team === team ? ' class="tl-me"' : '') + '><td>' + (anyDone() ? r.rank : '–') + '</td><td>' + esc(teamName(r.team)) +
        (r.team === team ? ' <span class="tl-you">' + esc(t('you')) + '</span>' : '') +
        '</td><td>' + (r.pts == null ? '–' : r.played) + '</td><td>' + (r.pts == null ? '–' : r.pts) + '</td><td>' + (r.diff == null ? '–' : (r.diff > 0 ? '+' + r.diff : r.diff)) + '</td></tr>';
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
    var h = '<h2>' + esc(t(st.final ? 'finalList' : 'finalListNow')) + '</h2><ol class="tl-rank">';
    st.rows.forEach(function (r) {
      var me = r.team === team;
      h += '<li class="tl-rrow' + (me ? ' tl-me' : '') + '"><span class="tl-medal' + medal(r.place) + '">' + esc(placeLabel(r.place, r.to)) + '</span>' +
        '<span class="tl-rname">' + esc(teamName(r.team)) + (me ? ' <span class="tl-you">' + esc(t('you')) + '</span>' : '') + '</span>' +
        (r.pts != null ? '<span class="tl-rstat">' + r.pts + ' ' + esc(t('pts')) + '</span>' : '') + '</li>';
    });
    return h + '</ol>';
  }

  function anyDone() { return (data.matches || []).some(function (x) { return x.done; }); }

  function tiedHtml(names) {
    return names.length ? '<span class="tl-hero-tie">' + esc(t('tiedWith', { teams: names.map(teamName).join(', ') })) + '</span>' : '';
  }

  function metaHtml() {
    var upd = data.updated ? Date.parse(data.updated) : NaN;
    var age = Math.max(0, Math.floor((Date.now() - at) / 60000));
    var stale = status === 'offline' || age >= 2;
    return '<p class="tl-status' + (stale ? ' tl-status-stale' : '') + '" role="status"><span class="tl-dot' + (stale ? ' tl-dot-off' : '') + '"></span>' +
      esc(t('asOf', { time: clock(isNaN(upd) ? at : upd) })) + (stale ? ' · ' + esc(t('checked', { n: age })) : '') +
      ' <button type="button" class="tl-icon" data-refresh="1" aria-label="' + esc(t('refresh')) + '" title="' + esc(t('refresh')) + '">↻</button>' +
      (team ? '<button type="button" class="tl-icon" data-share="1" aria-label="' + esc(t('share')) + '" title="' + esc(t('share')) + '">⇪</button>' : '') +
      (toast ? ' <span class="tl-toast">' + esc(toast) + '</span>' : '') + '</p>';
  }

  function goHtml(next) {
    if (!next || next.done) return '';
    var min = minutesTo(next.time);
    if (min == null || min > 10 || min < -45) return '';
    var key = next.id + '@' + next.time;
    if (!alerted[key]) { alerted[key] = 1; buzz(); }
    return '<div class="tl-go" role="alert"><b>' + esc(next.field ? t('goTo', { f: next.field }) : t('goToAny')) + '</b><span>' +
      esc(min > 0 ? t('inMin', { n: min }) : (min === 0 ? t('now') : t('overdue', { t: next.time }))) + '</span></div>';
  }

  function changesHtml() {
    if (!changes.length) return '';
    return '<div class="tl-changes" role="status"><b>' + esc(t('chTitle')) + '</b><ul>' + changes.map(function (c) { return '<li>' + esc(c) + '</li>'; }).join('') +
      '</ul><button type="button" class="tl-link" data-dismiss="1">' + esc(t('dismiss')) + '</button></div>';
  }

  function myRow() {
    var out = null;
    (data.tables || []).forEach(function (tb) { tb.rows.forEach(function (r) { if (r.team === team) out = { tb: tb, r: r }; }); });
    return out;
  }

  function heroHtml(st) {
    var mineRow = myRow(), pl = null, started = anyDone();
    if (!started) mineRow = mineRow ? { tb: mineRow.tb, r: { played: 0, pts: null, diff: null, rank: null } } : null;
    if (st && started) st.rows.forEach(function (r) { if (r.team === team) pl = r; });
    var h = '<section class="tl-hero' + (pl && st.final ? ' tl-hero-final' : '') + '"><div class="tl-hero-top"><div class="tl-hero-id"><span class="tl-badge">' + team +
      '</span><div><div class="tl-hero-team">' + esc(teamName(team)) + '</div></div></div>' +
      '<button type="button" class="tl-btn tl-btn-light" data-change="1">' + esc(t('change')) + '</button></div>';
    if (pl) {
      var tied = st.rows.filter(function (r) { return r.team !== team && r.place === pl.place && r.to === pl.to; }).map(function (r) { return r.team; });
      h += '<div class="tl-hero-place"><span class="tl-hero-rank' + (st.final ? medal(pl.place) : '') + '">' + esc(placeLabel(pl.place, pl.to)) + '</span><span class="tl-hero-lbl">' +
        esc(t(st.final ? 'placeFinal' : 'placeNow')) + '</span>' + tiedHtml(tied) + '</div>';
    } else if (mineRow && mineRow.r.rank != null) {
      var rk = mineRow.r.rank;
      var tiedT = mineRow.tb.rows.filter(function (r) { return r.team !== team && r.rank === rk; }).map(function (r) { return r.team; });
      h += '<div class="tl-hero-place"><span class="tl-hero-rank">' + mineRow.r.rank + '.</span><span class="tl-hero-lbl">' + esc(t('placeIn', { r: mineRow.r.rank, name: mineRow.tb.name })) + '</span>' + tiedHtml(tiedT) + '</div>';
    }
    if (mineRow && started) {
      var d = mineRow.r.diff;
      h += '<div class="tl-stats"><div><b>' + mineRow.r.played + '</b><span>' + esc(t('stPlayed')) + '</span></div>' +
        '<div><b>' + (mineRow.r.pts == null ? '–' : mineRow.r.pts) + '</b><span>' + esc(t('stPts')) + '</span></div>' +
        '<div><b>' + (d == null ? '–' : (d > 0 ? '+' + d : d)) + '</b><span>' + esc(t('stDiff')) + '</span></div></div>' +
        ((data.tables || []).length > 1 ? '<div class="tl-stats-note">' + esc(t('stOf', { name: mineRow.tb.name })) + '</div>' : '');
    }
    return h + '</section>';
  }

  function render() {
    var h;
    if (status === 'invalid') { paint('<div class="tl-msg">' + esc(t('invalid')) + '</div>'); return; }
    if (status === 'ended') { paint('<div class="tl-msg">' + esc(t('ended')) + '</div>'); return; }
    if (!data) {
      paint('<div class="tl-msg">' + esc(status === 'offline' ? t('noData') : t('loading')) + '</div>');
      return;
    }
    h = '<h1>' + esc(data.title) + '</h1>' +
      metaHtml() +
      (status === 'offline' ? '<div class="tl-off">' + esc(t('offline', { time: clock(at) })) + '</div>' : '');
    if (team > data.teams) { team = 0; drop(KEY_TEAM); }
    if (!team) {
      h += '<h2>' + esc(t('pick')) + '</h2><div class="tl-grid">';
      for (var i = 1; i <= data.teams; i++) h += '<button type="button" data-team="' + i + '" aria-label="' + esc(teamName(i)) + '"><span>' + i + '</span></button>';
      paint(h + '</div>');
      return;
    }
    var mine = (data.matches || []).filter(function (x) { return x.a === team || x.b === team; });
    var allMatches = data.matches || [];
    var allDone = allMatches.length > 0 && allMatches.every(function (x) { return x.done; });
    var st = standings(allDone);
    var next = null;
    mine.forEach(function (x) { if (!next && !x.done) next = x; });
    h += heroHtml(st) + changesHtml();
    if (st && st.final) h += '<div class="tl-finished">' + esc(t('finalDone')) + '</div>';
    else h += goHtml(next) + '<h2>' + esc(t('next')) + '</h2>' + (next ? matchHtml(next, ' tl-next') : '<div class="tl-card">' + esc(mine.length ? t('noNext') : t('noMatches')) + '</div>');
    var open = mine.filter(function (x) { return !x.done && x !== next; }), fin = mine.filter(function (x) { return x.done; });
    if (open.length) h += '<h2><span class="tl-sq tl-sq-open"></span>' + esc(t('toPlay')) + ' (' + open.length + ')</h2>' + open.map(function (x) { return matchHtml(x, ''); }).join('');
    if (fin.length) h += '<h2><span class="tl-sq tl-sq-done"></span>' + esc(t('playedH')) + ' (' + fin.length + ')</h2>' + fin.map(function (x) { return matchHtml(x, ''); }).join('');
    var later = allMatches.filter(function (x) { return (x.a == null || x.b == null) && x.a !== team && x.b !== team && !x.done; });
    if (later.length) h += '<h2>' + esc(t('later')) + '</h2><div class="tl-card tl-later"><small>' + esc(t('laterHint')) + '</small><ul>' + later.map(function (x) {
      return '<li><b>' + esc(x.round) + '</b>' + (x.time ? ' · ' + esc(x.field ? x.field + ' · ' : '') + esc(t('at', { t: x.time })) : '') + '</li>'; }).join('') + '</ul></div>';
    if (st && data.places && data.places.length && anyDone()) h += standingsHtml(st);
    if ((data.tables || []).length) h += '<h2>' + esc(t('tables')) + '</h2>' + data.tables.map(tableHtml).join('');
    paint(h);
  }

  var lastHtml = '';
  function paint(h) {
    if (h === lastHtml) return;
    var ae = document.activeElement, key = null;
    if (ae && root.contains(ae)) {
      ['data-refresh', 'data-share', 'data-change', 'data-dismiss', 'data-team'].forEach(function (a) { if (!key && ae.getAttribute(a)) key = '[' + a + '="' + ae.getAttribute(a) + '"]'; });
    }
    root.innerHTML = lastHtml = h;
    if (key) { var again = root.querySelector(key); if (again) again.focus(); }
  }

  function doShare() {
    var url = teamLink();
    function copied() { toast = t('copied'); render(); setTimeout(function () { toast = ''; render(); }, 2500); }
    if (navigator.share) { navigator.share({ title: data ? data.title : t('title'), url: url }).then(null, function () { }); return; }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(copied, function () { window.prompt(t('share'), url); });
    else window.prompt(t('share'), url);
  }

  root.addEventListener('click', function (e) {
    var el = e.target;
    var ATTRS = ['data-team', 'data-change', 'data-refresh', 'data-dismiss', 'data-share'];
    function hit(x) { return ATTRS.some(function (a) { return x.getAttribute(a); }); }
    while (el && el !== root && !(el.getAttribute && hit(el))) el = el.parentNode;
    if (!el || el === root) return;
    if (el.getAttribute('data-refresh')) { clearTimeout(timer); poll(); return; }
    if (el.getAttribute('data-share')) { doShare(); return; }
    if (el.getAttribute('data-dismiss')) { changes = []; render(); return; }
    changes = [];
    var n = el.getAttribute('data-team');
    if (n) { team = parseInt(n, 10); save(KEY_TEAM, String(team)); }
    else { team = 0; drop(KEY_TEAM); }
    try { history.replaceState(null, '', location.href.split('#')[0] + '#v=' + encodeURIComponent(code) + (team ? '&t=' + team : '')); } catch (err) { }
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
        if (res.status === 304) { at = Date.now(); status = 'ok'; render(); return; }
        if (res.status === 429) { retryMs = Math.min(300, Math.max(5, parseInt(res.headers.get('Retry-After'), 10) || 30)) * 1000 + Math.floor(Math.random() * 3000); return; }
        if (res.status === 404) { status = 'ended'; drop(KEY_DATA); render(); return; }
        if (!res.ok) throw new Error('http ' + res.status);
        var tag = res.headers.get('ETag');
        return res.json().then(function (d) {
          if (!d || d.v !== 1 || !Array.isArray(d.matches)) throw new Error('format');
          var found = diffMine(data, d);
          if (found.length) { changes = found; buzz(); }
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
  var tm = /[#&]t=(\d+)/.exec(location.hash || '');
  if (tm && parseInt(tm[1], 10) > 0) { team = parseInt(tm[1], 10); save(KEY_TEAM, String(team)); }
  try {
    var saved = JSON.parse(load(KEY_DATA) || 'null');
    if (saved && saved.data) { data = saved.data; at = saved.at || 0; etag = saved.etag || ''; status = 'offline'; }
  } catch (e) { }
  status = data ? 'ok' : 'loading';
  render();
  poll();
  setInterval(function () { if (data && !document.hidden && team && status !== 'ended') render(); }, 30000);
})();
