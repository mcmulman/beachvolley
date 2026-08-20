/* ===========================================================================
   round-nav.js – Nachrüstung für die festen Turnierbögen
   ---------------------------------------------------------------------------
   Bringt den festen Bögen die drei Bedienelemente bei, die es in den Vorlagen
   „Schweizer System" und „Alle gegen Alle" schon gibt:

     1. Sprungmarken  – configSection / guideContainer / scheduleSection /
                        standingsSection
     2. Rundennavigator – sticky Leiste mit Auswahl + Zurück/Weiter
     3. Sprungleiste  – feste Leiste am unteren Rand auf Mobilgeräten

   Das Skript arbeitet rein additiv auf dem fertigen DOM. Es fasst weder das
   Markup noch das JavaScript der Bögen an; fehlt eine Struktur, macht es
   nichts. Bögen, die den Navigator bereits mitbringen (die beiden Vorlagen und
   die dynamischen Universalbögen), erkennt es und lässt sie unberührt.

   Unterschied zu den Vorlagen: dort steht der gesamte Spielplan in einer
   Tabelle und es werden Zeilen ausgeblendet. Die festen Bögen haben pro Runde
   eine eigene Tabelle in einem eigenen `.table-scroll`-Block – hier wird
   deshalb der ganze Block ausgeblendet. Bedienung und Aussehen sind gleich.
   =========================================================================== */
(function () {
  'use strict';

  /* ------------------------------------------------------------- Hilfsmittel */
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  function setIdIfMissing(el, id) {
    if (el && !el.id && !document.getElementById(id)) el.id = id;
  }

  /* --------------------------------------------------------- 1. Sprungmarken */
  function addAnchors(blocks) {
    setIdIfMissing($('.guide'), 'guideContainer');
    setIdIfMissing($('.cfgcard'), 'configSection');

    /* Die Endstand-Tabelle heißt in allen Bögen `table.stand`. Sprungziel ist
       die zugehörige Überschrift, damit der Kontext mit im Bild ist. */
    if (!document.getElementById('standingsSection')) {
      const stand = $('table.stand');
      if (stand) {
        const scroll = stand.closest('.table-scroll') || stand;
        let target = scroll;
        for (let p = scroll.previousElementSibling; p; p = p.previousElementSibling) {
          if (/^H[12]$/.test(p.tagName)) { target = p; break; }
          if (p.classList && p.classList.contains('table-scroll')) break;
        }
        setIdIfMissing(target, 'standingsSection');
      }
    }
  }

  /* ----------------------------------------------- 2. Runden im Bogen finden */
  /* Ein „Block" ist eine Runde. Die Bögen klammern sie – wo vorhanden – bereits
     in `.round-block`; darin steckt neben der Tabelle auch der Ausfüllhinweis.
     Fehlt die Klammer, dient der `.table-scroll`-Container als Block.
     Beschriftung und Kennung stammen aus der Kopfzeile, damit der Navigator
     dieselben Namen zeigt wie der ausgedruckte Bogen (auch „Finalrunde 1"
     statt einer Nummer). */
  function collectBlocks() {
    const out = [];
    $$('table.sched').forEach(tab => {
      const wrap = tab.closest('.round-block') || tab.closest('.table-scroll');
      if (!wrap) return;
      const head = tab.querySelector('tr.rhead[data-round]')
                || tab.querySelector('[data-round]');
      if (!head) return;
      const key = head.getAttribute('data-round');
      const lab = tab.querySelector('tr.rhead .rlabel');
      out.push({
        wrap: wrap,
        key: key,
        label: (lab && lab.textContent.trim()) || ('Runde ' + key)
      });
    });
    return out;
  }

  /* --------------------------------------------------- 3. Rundennavigator */
  /* Markup exakt wie in den Vorlagen – nur so greift das CSS aus
     spielplan.css (sticky Pille, Chevron-Knöpfe, Live-Status). */
  function buildRoundBar(blocks, storeKey) {
    const bar = document.createElement('div');
    bar.className = 'noprint schedule-roundbar';
    bar.innerHTML =
      '<label>Runde <select data-round-select></select></label>' +
      '<button type="button" class="nbtn nbtn-round nbtn-round-prev" ' +
        'data-round-prev aria-label="Vorherige Runde">' +
        '<span class="chev chev-left" aria-hidden="true"></span> Zurück</button>' +
      '<button type="button" class="nbtn nbtn-round nbtn-round-next" ' +
        'data-round-next aria-label="Nächste Runde">' +
        'Weiter <span class="chev chev-right" aria-hidden="true"></span></button>' +
      '<span class="state" aria-live="polite"></span>';

    const sel = $('[data-round-select]', bar);
    const prev = $('[data-round-prev]', bar);
    const next = $('[data-round-next]', bar);
    const state = $('.state', bar);

    /* Die Vorlagen zeigen immer genau eine Runde – ohne Sammeleintrag. Damit
       sich alle Bögen gleich verhalten, wird das hier genauso gemacht. Der
       Ausdruck enthält weiterhin den vollständigen Plan. */
    sel.innerHTML = blocks.map(b => '<option value="' + b.key + '">' +
        b.label.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</option>').join('');

    let active = load();

    function load() {
      let v = null;
      try { v = localStorage.getItem(storeKey); } catch (e) { /* Privatmodus */ }
      return (v && blocks.some(b => b.key === v)) ? v : blocks[0].key;
    }
    function store(v) {
      try { localStorage.setItem(storeKey, v); } catch (e) { /* Privatmodus */ }
    }

    function apply() {
      blocks.forEach(b => b.wrap.classList.toggle('round-block-hidden', b.key !== active));
      sel.value = active;
      const i = blocks.findIndex(b => b.key === active);
      state.textContent = (i + 1) + ' / ' + blocks.length;
      prev.disabled = i <= 0;
      next.disabled = i >= blocks.length - 1;
    }

    function shift(d) {
      const i = blocks.findIndex(b => b.key === active);
      active = blocks[Math.max(0, Math.min(blocks.length - 1, i + d))].key;
      store(active); apply();
      bar.scrollIntoView({ block: 'nearest' });
    }

    sel.addEventListener('change', () => { active = sel.value; store(active); apply(); });
    prev.addEventListener('click', () => shift(-1));
    next.addEventListener('click', () => shift(1));

    apply();
    return bar;
  }

  /* ---------------------------------------------------- 4. Sprungleiste */
  function buildJumpBar() {
    const items = [
      ['configSection', '⚙️ Setup'],
      ['guideContainer', '📖 Anleitung'],
      ['scheduleSection', '📋 Spielplan'],
      ['standingsSection', '🏁 Tabelle']
    ].filter(it => document.getElementById(it[0]));

    const bar = document.createElement('div');
    bar.className = 'mobile-jumpbar noprint';
    bar.innerHTML = items.map(it =>
      '<button type="button" class="nbtn" data-jump="' + it[0] + '">' + it[1] + '</button>'
    ).join('') + '<button type="button" class="nbtn" data-jump-print>🖨️ Drucken</button>';

    /* Die Vorlagen legen die Leiste als 5-Spalten-Raster an. Hat ein Bogen
       keinen Endstand (reiner KO-Bogen), sind es entsprechend weniger. */
    bar.style.gridTemplateColumns = 'repeat(' + (items.length + 1) + ', 1fr)';

    bar.addEventListener('click', ev => {
      const b = ev.target.closest('button');
      if (!b) return;
      if (b.hasAttribute('data-jump-print')) { window.print(); return; }
      const t = document.getElementById(b.getAttribute('data-jump'));
      if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return bar;
  }

  /* ------------------------------------------------------------ Einbau */
  function init() {
    /* Bögen mit eigenem Navigator bleiben unangetastet. */
    if (document.querySelector('.schedule-roundbar')) return;

    const blocks = collectBlocks();
    addAnchors(blocks);

    if (blocks.length > 1) {
      const key = 'beachl.roundnav.' + (location.pathname.split('/').pop() || 'bogen');
      const first = blocks[0].wrap;
      const bar = buildRoundBar(blocks, key);
      /* Die Leiste steht VOR dem ersten Rundenblock, nicht darin: sonst würde
         sie mitsamt Runde 1 verschwinden, sobald eine andere Runde gewählt
         ist. Als eigenständiges Element klebt sie außerdem zuverlässig oben
         (`position: sticky` scheitert in einem Container mit `overflow`). */
      first.parentNode.insertBefore(bar, first);
      setIdIfMissing(bar, 'scheduleSection');
    } else if (blocks.length === 1) {
      setIdIfMissing(blocks[0].wrap, 'scheduleSection');
    }

    if (!document.querySelector('.mobile-jumpbar')) {
      document.body.appendChild(buildJumpBar());
      document.body.classList.add('has-jumpbar');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
