/* Interface du suivi des congés. Dépend de js/lib.js (window.Conges) et, en option, de data/seed.js. */
(function () {
  'use strict';
  var C = window.Conges;
  var STORAGE_KEY = 'conges-app:v1';
  var EXPORT_KEY = 'conges-app:last-export';

  /* ---------- persistance (localStorage, avec repli en mémoire) ---------- */
  function storageGet(key) { try { return window.localStorage.getItem(key); } catch (e) { return null; } }
  function storageSet(key, val) { try { window.localStorage.setItem(key, val); return true; } catch (e) { return false; } }

  var storageOk = true;
  var model;
  function load() {
    var raw = storageGet(STORAGE_KEY);
    if (raw) { try { return C.normalizeModel(JSON.parse(raw)); } catch (e) { /* sauvegarde corrompue : on retombe sur la graine */ } }
    return C.normalizeModel(window.CONGES_SEED || null);
  }
  function save() {
    storageOk = storageSet(STORAGE_KEY, JSON.stringify(model));
    if (!storageOk) toast('Impossible d’enregistrer dans ce navigateur — pensez à exporter vos données.');
  }

  /* ---------- état ---------- */
  var today = C.todayISO();
  var year = +today.slice(0, 4);
  var brush = { kind: 'code', value: 'CA' };
  var undoStack = [];
  var drag = null; // { mode: 'set' | 'clear' }

  function yearData(y) {
    var k = String(y);
    if (!model.years[k]) model.years[k] = C.emptyYear(y, model.years[String(y - 1)]);
    return model.years[k];
  }

  function $(id) { return document.getElementById(id); }
  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v === false || v == null) return;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k === 'style') n.setAttribute('style', v);
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    });
    [].concat(children || []).forEach(function (c) { if (c != null) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }

  var toastTimer;
  function toast(msg) {
    var t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove('show'); }, 3500);
  }

  /* ---------- annuler ---------- */
  function pushUndo() {
    undoStack.push({ year: year, days: JSON.stringify(yearData(year).days) });
    if (undoStack.length > 100) undoStack.shift();
    $('undo-btn').disabled = false;
  }
  function undo() {
    var s = undoStack.pop();
    if (!s) return;
    yearData(s.year).days = JSON.parse(s.days);
    if (s.year !== year) year = s.year;
    save(); render();
    $('undo-btn').disabled = !undoStack.length;
  }

  /* ---------- édition d'un jour ---------- */
  function dayMatchesBrush(entry) {
    if (!entry) return false;
    if (brush.kind === 'code') return entry.c === brush.value;
    if (brush.kind === 'place') return entry.p === brush.value;
    return false;
  }
  function applyToDay(s, mode) {
    var days = yearData(year).days, e = days[s] || {};
    if (brush.kind === 'erase') { delete days[s]; return; }
    var field = brush.kind === 'code' ? 'c' : 'p';
    if (mode === 'set') e[field] = brush.value; else delete e[field];
    if (e.c || e.p) days[s] = e; else delete days[s];
  }

  /* ---------- rendu ---------- */
  function typeColor(code) { var t = C.typeByCode(model, code); return t ? t.color : '#888'; }
  function placeColor(name) { for (var i = 0; i < model.places.length; i++) if (model.places[i].name === name) return model.places[i].color; return '#999'; }

  function renderPalette() {
    var bar = $('palette'); bar.textContent = '';
    bar.appendChild(el('span', { class: 'hint', text: 'Pinceau :' }));
    model.types.forEach(function (t) {
      bar.appendChild(el('button', {
        type: 'button', class: 'chip', style: '--c:' + t.color, title: t.label + (t.ref ? ' (' + t.ref + ')' : ''),
        'aria-pressed': String(brush.kind === 'code' && brush.value === t.code), text: t.code,
        onclick: function () { brush = { kind: 'code', value: t.code }; renderPalette(); }
      }));
    });
    bar.appendChild(el('button', {
      type: 'button', class: 'chip erase', title: 'Efface le code et le lieu du jour',
      'aria-pressed': String(brush.kind === 'erase'), text: 'Gomme',
      onclick: function () { brush = { kind: 'erase' }; renderPalette(); }
    }));
    if (model.places.length) {
      bar.appendChild(el('span', { class: 'sep' }));
      bar.appendChild(el('span', { class: 'hint', text: 'Lieu :' }));
      model.places.forEach(function (p) {
        bar.appendChild(el('button', {
          type: 'button', class: 'chip place', style: '--c:' + p.color,
          'aria-pressed': String(brush.kind === 'place' && brush.value === p.name), text: p.name,
          onclick: function () { brush = { kind: 'place', value: p.name }; renderPalette(); }
        }));
      });
    }
  }

  // Couleurs week-end / jour férié : variables CSS (les valeurs par défaut sont dans style.css).
  function applyDayColors() {
    var st = document.documentElement.style;
    st.setProperty('--weekend-c', model.dayColors.weekend);
    st.setProperty('--holiday-c', model.dayColors.holiday);
  }

  function renderYearSelect() {
    var sel = $('year-select'), years = {};
    Object.keys(model.years).forEach(function (y) { years[y] = true; });
    years[year] = true; years[year - 1] = true; years[year + 1] = true;
    sel.textContent = '';
    Object.keys(years).sort().forEach(function (y) {
      sel.appendChild(el('option', { value: y, text: y, selected: +y === year }));
    });
    sel.value = String(year);
  }

  function renderCalendar() {
    var y = yearData(year), holidays = C.toSet(y.holidays), stats = C.yearStats(model, year, today);
    var cal = $('calendar'); cal.textContent = '';
    C.MONTHS.forEach(function (m) { cal.appendChild(el('div', { class: 'cal-head', text: m })); });

    for (var d = 1; d <= 31; d++) {
      for (var m = 1; m <= 12; m++) {
        if (d > C.daysInMonth(year, m)) { cal.appendChild(el('div', { class: 'day void' })); continue; }
        cal.appendChild(el('button', { type: 'button', 'data-date': C.iso(year, m, d) }));
        patchDay(cal.lastChild, y, holidays);
      }
    }

    [['Jours ouvrés', 'workdays'], ['Absences', 'absences'], ['Télétravail', 'tt'], ['Sur site', 'onsite']].forEach(function (row, i) {
      stats.months.forEach(function (ms) {
        cal.appendChild(el('div', { class: 'cal-foot' + (i === 0 ? ' first' : ''), title: row[0], 'data-foot': row[1], 'data-m': String(ms.month) }, [el('span', { text: row[0] }), el('span', { text: String(ms[row[1]]) })]));
      });
    });
  }

  // Met à jour une cellule du calendrier sur place (pas de reconstruction : le glisser-déposer reste fluide).
  function patchDay(btn, y, holidays) {
    var s = btn.getAttribute('data-date'), e = y.days[s] || {}, cls = ['day'];
    if (holidays[s]) cls.push('holiday'); else if (C.isWeekend(s)) cls.push('off');
    if (e.c) cls.push('has-code');
    if (e.p) cls.push('has-place');
    if (s === today) cls.push('today');
    if (inSchoolHoliday(y, s)) cls.push('school');
    btn.className = cls.join(' ');
    btn.style.cssText = (e.c ? '--c:' + typeColor(e.c) + ';' : '') + (e.p ? '--p:' + placeColor(e.p) : '');
    var label = describeDay(s, e, holidays[s]);
    btn.title = label; btn.setAttribute('aria-label', label);
    btn.textContent = '';
    btn.appendChild(el('span', { class: 'dn', text: String(+s.slice(8)) }));
    btn.appendChild(el('span', { class: 'wd', text: C.WEEKDAYS[C.weekday(s)] }));
    if (e.c) btn.appendChild(el('span', { class: 'code', text: e.c }));
  }
  function patchDayByDate(s) {
    var btn = calEl.querySelector('[data-date="' + s + '"]');
    if (btn) patchDay(btn, yearData(year), C.toSet(yearData(year).holidays));
  }
  function patchFooters() {
    var stats = C.yearStats(model, year, today);
    calEl.querySelectorAll('.cal-foot').forEach(function (f) {
      f.lastChild.textContent = String(stats.months[+f.getAttribute('data-m') - 1][f.getAttribute('data-foot')]);
    });
  }

  function inSchoolHoliday(y, s) {
    var list = y.schoolHolidays || [];
    for (var i = 0; i < list.length; i++) if (s >= list[i].start && s < list[i].end) return true; // la date de fin est le jour de reprise
    return false;
  }

  var LONG_DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  function describeDay(s, e, isHoliday) {
    var p = s.split('-'), txt = LONG_DAYS[C.weekday(s)] + ' ' + (+p[2]) + ' ' + C.MONTHS[+p[1] - 1].toLowerCase() + ' ' + p[0];
    if (isHoliday) txt += ' — jour férié';
    if (e.c) { var t = C.typeByCode(model, e.c); txt += ' — ' + (t ? t.label : e.c); }
    if (e.p) txt += ' — ' + e.p;
    return txt;
  }

  function renderLegend() {
    var y = yearData(year), box = $('legend'); box.textContent = '';
    box.appendChild(el('span', {}, [el('i', { style: 'background:var(--holiday)' }), 'Jour férié']));
    box.appendChild(el('span', {}, [el('i', { style: 'background:var(--off)' }), 'Week-end']));
    var usedPlaces = {};
    Object.keys(y.days).forEach(function (d) { if (y.days[d].p) usedPlaces[y.days[d].p] = true; });
    model.places.filter(function (pl) { return usedPlaces[pl.name]; }).forEach(function (pl) {
      box.appendChild(el('span', {}, [el('i', { style: 'background:' + pl.color + ';box-shadow:inset 0 0 0 1px color-mix(in srgb, ' + pl.color + ' 55%, #000)' }), 'Lieu : ' + pl.name]));
    });
    (y.schoolHolidays || []).forEach(function (v) {
      box.appendChild(el('span', {}, [el('i', { style: 'background:var(--school)' }), v.name + ' : ' + frDate(v.start) + ' → ' + frDate(C.addDays(v.end, -1))]));
    });
  }
  function frDate(s) { var p = s.split('-'); return p[2] + '/' + p[1]; }

  function renderSummary() {
    var y = yearData(year), stats = C.yearStats(model, year, today), box = $('summary'); box.textContent = '';

    var quotaRows = stats.rows.filter(function (r) { return r.quota !== null && (r.quota > 0 || r.planned > 0); });
    var card = el('section', { class: 'card' }, [el('h2', { text: 'Soldes ' + year })]);
    if (!quotaRows.length) card.appendChild(el('p', { class: 'note', text: 'Aucun droit défini pour cette année (Réglages).' }));
    quotaRows.forEach(function (r) {
      var t = r.type, pct = function (n) { return r.quota > 0 ? Math.min(100, Math.max(0, n / r.quota * 100)) : 0; };
      var fmt = function (days, hours) { return C.formatDays(days) + ' j' + (hours != null ? ' · ' + C.formatHours(hours) : ''); };
      card.appendChild(el('div', { class: 'balance' + (r.over ? ' over' : ''), style: '--c:' + t.color }, [
        el('div', { class: 'balance-head' }, [
          el('span', { class: 'name', text: t.code }),
          el('span', { class: 'ref', text: (t.label !== t.code ? t.label : '') + (t.ref ? ' ' + t.ref : '') }),
          el('span', { class: 'big' }, [C.formatDays(r.remainingPlanned), el('small', { text: ' j restants' })])
        ]),
        el('div', { class: 'bar', title: 'Pris / posés / droits' }, [el('i', { style: 'width:' + pct(r.planned) + '%' }), el('b', { style: 'width:' + pct(r.taken) + '%' })]),
        el('dl', {}, [
          el('dt', { text: 'Droits' }), el('dd', { text: C.formatDays(r.quota) }),
          el('dt', { text: 'Pris' }), el('dd', { text: C.formatDays(r.taken) }),
          el('dt', { text: 'Posés' }), el('dd', { text: C.formatDays(r.planned) }),
          el('dt', { text: 'Reste maintenant' }), el('dd', { class: 'rest', text: fmt(r.remaining, r.remainingHours) }),
          r.remainingPlannedHours != null ? el('dt', { text: 'Reste prév.' }) : null,
          r.remainingPlannedHours != null ? el('dd', { class: 'rest', text: fmt(r.remainingPlanned, r.remainingPlannedHours) }) : null
        ])
      ]));
    });
    var sum = quotaRows.reduce(function (a, r) { a.q += r.quota; a.p += r.planned; a.t += r.taken; return a; }, { q: 0, p: 0, t: 0 });
    if (quotaRows.length > 1) {
      card.appendChild(el('dl', { class: 'year-totals balance' }, [
        el('dt', { text: 'Total droits' }), el('dd', { text: C.formatDays(sum.q) + ' j' }),
        el('dt', { text: 'Total reste prévisionnel' }), el('dd', { text: C.formatDays(sum.q - sum.p) + ' j' })
      ]));
    }
    box.appendChild(card);

    var others = stats.rows.filter(function (r) { return r.quota === null && r.planned > 0; });
    var card2 = el('section', { class: 'card' }, [el('h2', { text: 'Autres jours ' + year })]);
    var grid = el('div', { class: 'others' });
    others.forEach(function (r) {
      grid.appendChild(el('div', { style: '--c:' + r.type.color, title: r.type.label + ' — ' + r.taken + ' passés, ' + r.planned + ' au total' }, [
        el('i', { class: 'dot' }), el('span', { text: r.type.code + (r.type.label !== r.type.code ? ' · ' + r.type.label : '') }), el('span', { text: r.taken + ' / ' + r.planned })
      ]));
    });
    if (others.length) { card2.appendChild(grid); card2.appendChild(el('p', { class: 'note', text: 'passés / total sur l’année' })); box.appendChild(card2); }

    var T = stats.total;
    box.appendChild(el('section', { class: 'card' }, [
      el('h2', { text: 'Année ' + year }),
      el('dl', { class: 'year-totals' }, [
        el('dt', { text: 'Jours ouvrés' }), el('dd', { text: String(T.workdays) }),
        el('dt', { text: 'Jours fériés en semaine' }), el('dd', { text: String(T.holidaysOnWorkdays) }),
        el('dt', { text: 'Absences posées' }), el('dd', { text: String(T.absences) }),
        el('dt', { text: 'Jours travaillés' }), el('dd', { text: String(T.worked) }),
        el('dt', { text: 'dont télétravail' }), el('dd', { text: String(T.tt) }),
        el('dt', { text: 'dont sur site' }), el('dd', { text: String(T.onsite) })
      ])
    ]));
    if (!y.holidays.length) box.appendChild(el('p', { class: 'note', text: 'Aucun jour férié défini pour cette année.' }));
  }

  function render() {
    applyDayColors(); renderYearSelect(); renderPalette(); renderCalendar(); renderLegend(); renderSummary();
  }

  /* ---------- interactions calendrier ---------- */
  var calEl = $('calendar');
  function dayFromEvent(ev) { var b = ev.target.closest && ev.target.closest('.day[data-date]'); return b ? b.getAttribute('data-date') : null; }

  function refreshAfterEdit(s) { save(); patchDayByDate(s); patchFooters(); renderSummary(); }

  calEl.addEventListener('pointerdown', function (ev) {
    var s = dayFromEvent(ev);
    if (!s || ev.button > 0) return;
    pushUndo();
    var entry = yearData(year).days[s];
    drag = { mode: dayMatchesBrush(entry) ? 'clear' : 'set', mouse: ev.pointerType === 'mouse' };
    applyToDay(s, drag.mode);
    refreshAfterEdit(s);
    ev.preventDefault();
  });
  calEl.addEventListener('pointerover', function (ev) {
    if (!drag || !drag.mouse) return;
    var s = dayFromEvent(ev);
    if (!s) return;
    applyToDay(s, drag.mode);
    refreshAfterEdit(s);
  });
  window.addEventListener('pointerup', function () { drag = null; });
  window.addEventListener('pointercancel', function () { drag = null; });
  // Clavier : Entrée / Espace déclenchent un « click » sans pointeur (detail === 0).
  calEl.addEventListener('click', function (ev) {
    if (ev.detail !== 0) return;
    var s = dayFromEvent(ev);
    if (!s) return;
    pushUndo();
    applyToDay(s, dayMatchesBrush(yearData(year).days[s]) ? 'clear' : 'set');
    refreshAfterEdit(s);
  });
  window.addEventListener('keydown', function (ev) {
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { ev.preventDefault(); undo(); }
  });

  function setYear(y) { year = y; render(); }
  $('prev-year').addEventListener('click', function () { setYear(year - 1); });
  $('next-year').addEventListener('click', function () { setYear(year + 1); });
  $('year-select').addEventListener('change', function (ev) { setYear(+ev.target.value); });
  $('today-btn').addEventListener('click', function () {
    today = C.todayISO(); setYear(+today.slice(0, 4));
    var b = calEl.querySelector('[data-date="' + today + '"]');
    if (b) { b.scrollIntoView({ block: 'center', inline: 'center' }); b.classList.add('sel-flash'); }
  });
  $('undo-btn').addEventListener('click', undo);

  /* ---------- réglages ---------- */
  var settingsDlg = $('settings-dialog'), settingsBody = $('settings-body');

  function numInput(value, onChange, step) {
    return el('input', { type: 'number', class: 'num', step: step || '0.01', min: '0', value: value, onchange: function (e) { onChange(parseFloat(e.target.value)); } });
  }

  function renderSettings() {
    var y = yearData(year), b = settingsBody;
    b.textContent = '';
    b.appendChild(el('h2', { text: 'Réglages' }));
    b.appendChild(el('p', { class: 'note', text: 'Les modifications sont enregistrées immédiatement.' }));

    b.appendChild(el('h3', { text: 'Droits ' + year }));
    model.types.filter(function (t) { return t.quota; }).forEach(function (t) {
      var unit = el('span', { class: 'unit' });
      var upd = function () { var q = +y.quotas[t.code] || 0; unit.textContent = 'jours' + (t.hours ? ' = ' + C.formatHours(q * model.hoursPerDay) : ''); };
      b.appendChild(el('div', { class: 'row' }, [
        el('strong', { class: 'grow', text: t.code + (t.ref ? ' · ' + t.ref : '') }),
        numInput(y.quotas[t.code] != null ? y.quotas[t.code] : 0, function (v) { y.quotas[t.code] = isNaN(v) ? 0 : v; save(); upd(); renderSummary(); }),
        unit
      ]));
      upd();
    });
    b.appendChild(el('div', { class: 'row' }, [
      el('span', { class: 'grow', text: 'Heures par jour (conversion des soldes en heures)' }),
      numInput(model.hoursPerDay, function (v) { if (v > 0) { model.hoursPerDay = v; save(); renderSettings(); renderSummary(); } }, '0.25')
    ]));

    b.appendChild(el('h3', { text: 'Jours fériés ' + year }));
    var tags = el('div', { class: 'tag-list' });
    y.holidays.forEach(function (s) {
      tags.appendChild(el('span', { class: 'tag' }, [describeDay(s, {}, false), el('button', { type: 'button', 'aria-label': 'Supprimer ' + s, text: '×', onclick: function () { y.holidays = y.holidays.filter(function (x) { return x !== s; }); save(); renderSettings(); render(); } })]));
    });
    b.appendChild(tags);
    var dateIn = el('input', { type: 'date', min: year + '-01-01', max: year + '-12-31' });
    b.appendChild(el('div', { class: 'row' }, [
      dateIn,
      el('button', { type: 'button', class: 'btn', text: 'Ajouter', onclick: function () { if (dateIn.value && y.holidays.indexOf(dateIn.value) < 0) { y.holidays.push(dateIn.value); y.holidays.sort(); save(); renderSettings(); render(); } } }),
      el('button', { type: 'button', class: 'btn', text: 'Régénérer (France métropolitaine)', onclick: function () { y.holidays = C.frenchHolidays(year); save(); renderSettings(); render(); } })
    ]));

    b.appendChild(el('h3', { text: 'Vacances scolaires ' + year }));
    (y.schoolHolidays || []).forEach(function (v, i) {
      b.appendChild(el('div', { class: 'row' }, [
        el('input', { type: 'text', class: 'grow', value: v.name, 'aria-label': 'Nom', onchange: function (e) { v.name = e.target.value; save(); renderLegend(); } }),
        el('input', { type: 'date', value: v.start, 'aria-label': 'Début', onchange: function (e) { v.start = e.target.value; save(); render(); } }),
        el('span', { class: 'unit', text: '→ reprise le' }),
        el('input', { type: 'date', value: v.end, 'aria-label': 'Reprise', onchange: function (e) { v.end = e.target.value; save(); render(); } }),
        el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Supprimer', text: '×', onclick: function () { y.schoolHolidays.splice(i, 1); save(); renderSettings(); render(); } })
      ]));
    });
    b.appendChild(el('button', { type: 'button', class: 'btn', text: 'Ajouter une période', onclick: function () { y.schoolHolidays = y.schoolHolidays || []; y.schoolHolidays.push({ name: 'Vacances', start: year + '-01-01', end: year + '-01-08' }); save(); renderSettings(); render(); } }));
    b.appendChild(el('p', { class: 'note', text: 'La date de reprise est le premier jour de classe : le bandeau jaune s’arrête la veille.' }));

    b.appendChild(el('h3', { text: 'Couleurs du calendrier' }));
    [['weekend', 'Week-end'], ['holiday', 'Jour férié']].forEach(function (k) {
      b.appendChild(el('div', { class: 'row' }, [
        el('input', { type: 'color', value: model.dayColors[k[0]], 'aria-label': 'Couleur ' + k[1], onchange: function (e) { model.dayColors[k[0]] = e.target.value; save(); render(); } }),
        el('strong', { class: 'grow', text: k[1] }),
        el('button', { type: 'button', class: 'btn', text: 'Par défaut', onclick: function () { model.dayColors[k[0]] = C.DEFAULT_DAY_COLORS[k[0]]; save(); renderSettings(); render(); } })
      ]));
    });

    b.appendChild(el('h3', { text: 'Types de jours' }));
    model.types.forEach(function (t, i) {
      var used = Object.keys(model.years).some(function (k) { return Object.keys(model.years[k].days).some(function (d) { return model.years[k].days[d].c === t.code; }); });
      b.appendChild(el('div', { class: 'row' }, [
        el('input', { type: 'color', value: t.color, 'aria-label': 'Couleur ' + t.code, onchange: function (e) { t.color = e.target.value; save(); render(); } }),
        el('strong', { text: t.code, style: 'width:48px' }),
        el('input', { type: 'text', class: 'grow', value: t.label, 'aria-label': 'Libellé ' + t.code, onchange: function (e) { t.label = e.target.value || t.code; save(); render(); } }),
        el('input', { type: 'text', style: 'width:70px', value: t.ref || '', placeholder: 'Réf.', 'aria-label': 'Référence ' + t.code, onchange: function (e) { t.ref = e.target.value; save(); render(); } }),
        el('label', { title: 'Décompté d’un droit annuel' }, [el('input', { type: 'checkbox', checked: !!t.quota, onchange: function (e) { t.quota = e.target.checked; save(); renderSettings(); render(); } }), 'Droit']),
        el('label', { title: 'Jour non travaillé' }, [el('input', { type: 'checkbox', checked: !!t.absence, onchange: function (e) { t.absence = e.target.checked; save(); render(); } }), 'Absence']),
        el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Supprimer ' + t.code, text: '×', disabled: used, title: used ? 'Utilisé dans le calendrier' : 'Supprimer', onclick: function () { model.types.splice(i, 1); if (brush.value === t.code) brush = { kind: 'erase' }; save(); renderSettings(); render(); } })
      ]));
    });
    var newCode = el('input', { type: 'text', class: 'code', placeholder: 'Code', maxlength: '8', 'aria-label': 'Nouveau code' });
    var newLabel = el('input', { type: 'text', class: 'grow', placeholder: 'Libellé', 'aria-label': 'Nouveau libellé' });
    b.appendChild(el('div', { class: 'row' }, [newCode, newLabel, el('button', { type: 'button', class: 'btn', text: 'Ajouter un type', onclick: function () {
      var code = newCode.value.trim();
      if (!code) return;
      if (C.typeByCode(model, code)) { toast('Ce code existe déjà.'); return; }
      model.types.push({ code: code, label: newLabel.value.trim() || code, color: C.PLACE_COLORS[model.types.length % C.PLACE_COLORS.length], quota: false, absence: false });
      save(); renderSettings(); render();
    } })]));

    b.appendChild(el('h3', { text: 'Lieux' }));
    model.places.forEach(function (p, i) {
      b.appendChild(el('div', { class: 'row' }, [
        el('input', { type: 'color', value: p.color, 'aria-label': 'Couleur ' + p.name, onchange: function (e) { p.color = e.target.value; save(); render(); } }),
        el('strong', { class: 'grow', text: p.name }),
        el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Supprimer ' + p.name, text: '×', onclick: function () {
          Object.keys(model.years).forEach(function (k) { var d = model.years[k].days; Object.keys(d).forEach(function (s) { if (d[s].p === p.name) { delete d[s].p; if (!d[s].c) delete d[s]; } }); });
          model.places.splice(i, 1); if (brush.value === p.name) brush = { kind: 'erase' }; save(); renderSettings(); render();
        } })
      ]));
    });
    var newPlace = el('input', { type: 'text', class: 'grow', placeholder: 'Nouveau lieu', 'aria-label': 'Nouveau lieu' });
    b.appendChild(el('div', { class: 'row' }, [newPlace, el('button', { type: 'button', class: 'btn', text: 'Ajouter un lieu', onclick: function () {
      var n = newPlace.value.trim();
      if (!n || model.places.some(function (p) { return p.name === n; })) return;
      model.places.push({ name: n, color: C.PLACE_COLORS[model.places.length % C.PLACE_COLORS.length] }); save(); renderSettings(); render();
    } })]));

    b.appendChild(el('div', { class: 'dialog-foot' }, [el('button', { type: 'submit', class: 'btn primary', text: 'Fermer' })]));
  }
  $('settings-btn').addEventListener('click', function () { renderSettings(); settingsDlg.showModal(); });

  /* ---------- données : export / import / réinitialisation ---------- */
  var dataDlg = $('data-dialog'), dataBody = $('data-body');

  function renderData() {
    var last = storageGet(EXPORT_KEY), b = dataBody;
    b.textContent = '';
    b.appendChild(el('h2', { text: 'Données' }));
    b.appendChild(el('p', { class: 'note', text: 'Vos données sont enregistrées dans ce navigateur, sur cet appareil uniquement. Exportez-les régulièrement pour en garder une copie.' }));
    if (!storageOk) b.appendChild(el('p', { class: 'note', style: 'color:var(--danger)', text: 'Le stockage du navigateur est indisponible : les modifications seront perdues à la fermeture.' }));
    b.appendChild(el('div', { class: 'stat-line' }, [el('span', { text: 'Dernier export' }), el('strong', { text: last ? new Date(+last).toLocaleString('fr-FR') : 'jamais' })]));
    b.appendChild(el('div', { class: 'row' }, [
      el('button', { type: 'button', class: 'btn primary', text: 'Exporter (JSON)', onclick: exportJSON }),
      el('button', { type: 'button', class: 'btn', text: 'Importer une sauvegarde…', onclick: function () { $('import-file').click(); } })
    ]));
    b.appendChild(el('h3', { text: 'Zone sensible' }));
    b.appendChild(el('div', { class: 'row' }, [
      window.CONGES_SEED ? el('button', { type: 'button', class: 'btn danger', text: 'Revenir aux données importées d’Excel', onclick: function () { confirmReplace(C.normalizeModel(window.CONGES_SEED), 'Revenir aux données d’origine ? Vos modifications seront perdues.'); } }) : null,
      el('button', { type: 'button', class: 'btn danger', text: 'Tout effacer', onclick: function () { confirmReplace(C.newModel(), 'Effacer toutes les données ? Cette action est irréversible.'); } })
    ]));
    b.appendChild(el('div', { class: 'dialog-foot' }, [el('button', { type: 'submit', class: 'btn primary', text: 'Fermer' })]));
  }
  function confirmReplace(m, msg) {
    if (!window.confirm(msg)) return;
    model = m; undoStack = []; $('undo-btn').disabled = true; save(); render(); dataDlg.close(); toast('Données remplacées.');
  }
  function exportJSON() {
    var blob = new Blob([JSON.stringify(model, null, 1)], { type: 'application/json' });
    var a = el('a', { href: URL.createObjectURL(blob), download: 'conges-' + C.todayISO() + '.json' });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    storageSet(EXPORT_KEY, String(Date.now())); renderData();
  }
  $('import-file').addEventListener('change', function (ev) {
    var f = ev.target.files[0]; ev.target.value = '';
    if (!f) return;
    var r = new FileReader();
    r.onload = function () {
      try {
        var data = JSON.parse(r.result);
        if (!data || typeof data !== 'object' || !data.years) throw new Error('format');
        confirmReplace(C.normalizeModel(data), 'Remplacer toutes les données actuelles par cette sauvegarde ?');
      } catch (e) { toast('Fichier invalide : ce n’est pas une sauvegarde de l’application.'); }
    };
    r.readAsText(f);
  });
  $('data-btn').addEventListener('click', function () { renderData(); dataDlg.showModal(); });

  /* ---------- démarrage ---------- */
  model = load();
  save(); // première ouverture : on fige la graine ; sinon on enregistre le modèle migré
  yearData(year);
  render();
  window.addEventListener('load', function () {
    var b = calEl.querySelector('[data-date="' + today + '"]');
    if (b) { var sc = $('calendar-scroll'); sc.scrollLeft = Math.max(0, b.offsetLeft - sc.clientWidth / 2); }
  });
})();
