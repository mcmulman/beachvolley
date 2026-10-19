/* Team numbers are starting positions, not stable identities. Never reseed
   once results, frozen rounds or manual standings refer to those positions. */
(function (root) {
  'use strict';
  function tx(key, fallback) {
    return root.TI18n ? root.TI18n.t(key) : fallback;
  }
  function locked(state) {
    return root.TStore.anyResults(state) || ['frozen', 'frozenModes', 'manualStandings', 'manualPlacements']
      .some(function (key) { return Object.keys(state[key] || {}).length > 0; });
  }
  function swapKeys(map, a, b) {
    if (!map) return;
    var hasA = Object.prototype.hasOwnProperty.call(map, a);
    var hasB = Object.prototype.hasOwnProperty.call(map, b);
    var valueA = map[a], valueB = map[b];
    if (hasB) map[a] = valueB; else delete map[a];
    if (hasA) map[b] = valueA; else delete map[b];
  }
  function swap(state, a, b) {
    swapKeys(state.teamNames, a, b);
    swapKeys(state.pairMembers, a, b);
    swapKeys(state.teamGender, a, b);
    swapKeys(state.config.levels, a, b);
    state.absent = (state.absent || []).map(function (id) { return id === a ? b : id === b ? a : id; });
  }
  function enhance(container, options) {
    if (!container) return;
    var controller = container._teamReorder;
    if (!controller) {
      controller = container._teamReorder = { busy: false, options: options };
      container.addEventListener('click', function (event) {
        var button = event.target.closest('[data-team-move]');
        if (!button || !container.contains(button)) return;
        event.preventDefault();
        var inputs = Array.from(container.querySelectorAll('[data-name-input]'));
        var a = +button.getAttribute('data-team-position');
        var index = inputs.findIndex(function (input) { return +input.getAttribute('data-name-input') === a; });
        var next = index + (button.getAttribute('data-team-move') === 'up' ? -1 : 1);
        var state = controller.options.get();
        if (controller.busy || button.disabled || index < 0 || next < 0 || next >= inputs.length
          || inputs[index].disabled || locked(state)) return;
        var b = +inputs[next].getAttribute('data-name-input');
        controller.busy = true;
        swap(state, a, b);
        refresh(container, controller);
        /* The normal save path supplies the previous revision for Undo and
           the reordered names/attributes for reload, backup and sharing. */
        controller.options.save().then(function (ok) {
          if (!ok) swap(state, a, b);
          controller.busy = false;
          controller.options.rebuild();
          var direction = button.getAttribute('data-team-move');
          var target = container.querySelector('[data-team-position="' + (ok ? b : a) + '"][data-team-move="' + direction + '"]');
          if (target && target.disabled) target = container.querySelector('[data-team-position="' + (ok ? b : a) + '"][data-team-move="' + (direction === 'up' ? 'down' : 'up') + '"]');
          if (target) target.focus();
        });
      });
      /* Shared server views disable their inputs after painting, including
         later rebuilds. Observe that existing read-only guard, not a new one. */
      controller.observer = new MutationObserver(function () { refresh(container, controller); });
      controller.observer.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
    }
    controller.options = options;
    refresh(container, controller);
  }
  function refresh(container, controller) {
    var state = controller.options.get();
    var isLocked = locked(state);
    var shuffle = root.document && root.document.getElementById('btnShuffle');
    if (shuffle && shuffle.disabled !== (isLocked || controller.busy)) shuffle.disabled = isLocked || controller.busy;
    var inputs = Array.from(container.querySelectorAll('[data-name-input]'));
    inputs.forEach(function (input, index) {
      var row = input.closest('.nrow-del, .nrow2, td.rname') || input.parentElement;
      row.classList.add('team-reorder-row');
      var gender = row.querySelector('[data-gender-input]');
      if (gender) {
        var card = document.createElement('div');
        card.className = 'team-editor-card';
        row.parentNode.insertBefore(card, row);
        card.appendChild(row);
        var detail = document.createElement('label');
        detail.className = 'team-editor-extra';
        var text = document.createElement('span');
        text.textContent = tx('flex.gender.title', 'Team-Art');
        detail.appendChild(text);
        detail.appendChild(gender);
        card.appendChild(detail);
      }

      var controls = row.querySelector('.team-reorder');
      if (!controls) {
        controls = document.createElement('span');
        controls.className = 'team-reorder noprint';
        ['up', 'down'].forEach(function (direction) {
          var button = document.createElement('button');
          button.type = 'button';
          button.className = 'team-move';
          button.setAttribute('data-team-move', direction);
          button.setAttribute('data-team-position', input.getAttribute('data-name-input'));
          button.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + (direction === 'up' ? 'M6 14l6-6 6 6' : 'M6 10l6 6 6-6') + '"/></svg>';
          controls.appendChild(button);
        });
        row.appendChild(controls);
      }
      var remove = row.querySelector('.team-del');
      if (row.tagName === 'TD') {
        var playerRow = row.parentElement;
        remove = playerRow.querySelector('.team-del');
        [['.rlevel', 'kq.col.level', 'Niveau'], ['.rabsent', 'kq.btn.absent', 'Person ausgefallen']].forEach(function (item) {
          var cell = playerRow.querySelector(item[0]);
          var field = cell.querySelector('input, select');
          if (!cell.querySelector('.team-editor-field-label')) {
            var label = document.createElement('label');
            label.className = 'team-editor-field-label';
            var caption = document.createElement('span');
            caption.className = 'only-screen';
            caption.textContent = tx(item[1], item[2]);
            label.appendChild(caption);
            label.appendChild(field);
            cell.appendChild(label);
          }
        });

        if (!row.querySelector('.team-editor-number')) {
          var number = document.createElement('span');
          number.className = 'team-editor-number only-screen';
          number.setAttribute('aria-hidden', 'true');
          number.textContent = playerRow.querySelector('.num').textContent;
          row.insertBefore(number, input);
        }
      }
      if (remove && (controls.nextElementSibling !== remove || remove.parentElement !== row)) row.appendChild(remove);
      if (controls.hidden !== input.disabled) controls.hidden = input.disabled;
      controls.querySelectorAll('button').forEach(function (button) {
        var up = button.getAttribute('data-team-move') === 'up';
        var label = up ? tx('ui.team.moveUp', 'Nach oben') : tx('ui.team.moveDown', 'Nach unten');
        button.setAttribute('aria-label', label);
        button.title = label;
        var disabled = controller.busy || isLocked || input.disabled || (up ? index === 0 : index === inputs.length - 1);
        if (button.disabled !== disabled) button.disabled = disabled;
      });
    });
    var anchor = container.tagName === 'TBODY' ? container.closest('table') : container;
    var hint = anchor.previousElementSibling;
    if (!hint || !hint.classList.contains('team-reorder-hint')) {
      hint = document.createElement('p');
      hint.className = 'team-reorder-hint input-hint hint-top noprint';
      hint.setAttribute('role', 'status');
      anchor.parentNode.insertBefore(hint, anchor);
    }
    var text = isLocked
      ? tx('ui.team.moveLocked', 'Reihenfolge gesperrt: Ergebnisse, fixierte Runden oder Tabellenkorrekturen vorhanden.')
      : tx('ui.team.moveHint', 'Pfeile ändern die Startposition / Setzliste.');
    if (hint.textContent !== text) hint.textContent = text;
    var hidden = !inputs.length || inputs.every(function (input) { return input.disabled; });
    if (hint.hidden !== hidden) hint.hidden = hidden;
  }
  root.TTeamReorder = { enhance: enhance };
})(typeof window !== 'undefined' ? window : this);
