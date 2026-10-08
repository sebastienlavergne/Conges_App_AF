/* Logique pure (dates, jours fériés, soldes) — utilisable dans le navigateur et sous Node. */
(function (root) {
  'use strict';

  var MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
  var WEEKDAYS = ['D', 'L', 'M', 'M', 'J', 'V', 'S']; // indexé par Date#getUTCDay()

  // Types par défaut. `quota` : décompté d'un droit annuel ; `absence` : jour non travaillé ;
  // `hours` : solde également affiché en heures.
  var DEFAULT_TYPES = [
    { code: 'TT', label: 'Télétravail', color: '#4f9d69', quota: false, absence: false },
    { code: 'A', label: 'Astreinte', color: '#e0a526', quota: false, absence: false },
    { code: 'PI', label: 'PI Event', color: '#b07fd4', quota: false, absence: false },
    { code: 'CA', label: 'Congés annuels', ref: 'CA01', color: '#3b82c4', quota: true, absence: true },
    { code: 'CJT', label: 'CJT', ref: 'RE01', color: '#8b5cc7', quota: true, absence: true },
    { code: 'CCA', label: 'CCA', ref: 'CA03', color: '#d9558f', quota: true, absence: true },
    { code: 'RA', label: 'RA', ref: 'AB60', color: '#e07a3f', quota: true, absence: true, hours: true },
    { code: 'CH', label: 'CH', ref: 'AB01', color: '#2fa3a3', quota: true, absence: true, hours: true },
    { code: 'Dmgt', label: 'Déménagement', ref: 'SP09', color: '#9a7b4f', quota: false, absence: true },
    { code: 'SP', label: 'Congé spécial', ref: 'SP11', color: '#a4a43a', quota: false, absence: true },
    { code: 'ML', label: 'Maladie', color: '#d44b4b', quota: false, absence: true },
    { code: 'F', label: 'Activité partielle', color: '#7a8aa0', quota: false, absence: true },
    { code: 'OFF', label: 'Off', color: '#9aa0a6', quota: false, absence: true }
  ];

  var PLACE_COLORS = ['#b8a1d9', '#f2a6d8', '#e6b84a', '#6bb5a8', '#7fa6e0', '#d99a6c', '#a3c76b', '#c9a0a0'];

  var HOURS_PER_DAY = 7;
  var MODEL_VERSION = 2;
  var DEFAULT_DAY_COLORS = { weekend: '#aeb4bf', holiday: '#e07b7b' };

  /* ---------- dates (toutes en ISO « AAAA-MM-JJ », calculs en UTC) ---------- */

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function iso(y, m, d) { return y + '-' + pad(m) + '-' + pad(d); } // m : 1..12
  function toUTC(s) { var p = s.split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }
  function fromUTC(t) { var d = new Date(t); return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()); }
  function addDays(s, n) { return fromUTC(toUTC(s) + n * 86400000); }
  function weekday(s) { return new Date(toUTC(s)).getUTCDay(); } // 0 = dimanche
  function isWeekend(s) { var w = weekday(s); return w === 0 || w === 6; }
  function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); } // m : 1..12
  function todayISO() { var d = new Date(); return iso(d.getFullYear(), d.getMonth() + 1, d.getDate()); }

  // Dimanche de Pâques (algorithme grégorien anonyme).
  function easter(y) {
    var a = y % 19, b = Math.floor(y / 100), c = y % 100;
    var d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
    var g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
    var i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
    var m = Math.floor((a + 11 * h + 22 * l) / 451);
    var month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
    return iso(y, month, day);
  }

  // Jours fériés légaux en France métropolitaine (hors Alsace-Moselle).
  function frenchHolidays(y) {
    var e = easter(y);
    return [iso(y, 1, 1), addDays(e, 1), iso(y, 5, 1), iso(y, 5, 8), addDays(e, 39), addDays(e, 50),
      iso(y, 7, 14), iso(y, 8, 15), iso(y, 11, 1), iso(y, 11, 11), iso(y, 12, 25)].sort();
  }

  function isWorkday(s, holidaySet) { return !isWeekend(s) && !holidaySet[s]; }

  function toSet(list) { var o = {}; (list || []).forEach(function (s) { o[s] = true; }); return o; }

  /* ---------- modèle ---------- */

  function emptyYear(y, prev) {
    var quotas = {};
    if (prev) Object.keys(prev.quotas || {}).forEach(function (k) { quotas[k] = prev.quotas[k]; });
    return { quotas: quotas, holidays: frenchHolidays(y), schoolHolidays: [], days: {} };
  }

  function newModel() {
    return {
      version: MODEL_VERSION, hoursPerDay: HOURS_PER_DAY, types: JSON.parse(JSON.stringify(DEFAULT_TYPES)),
      dayColors: JSON.parse(JSON.stringify(DEFAULT_DAY_COLORS)), places: [], years: {}
    };
  }

  // Construit un modèle complet à partir d'une sauvegarde / de la graine (tolérant aux champs manquants).
  function normalizeModel(src) {
    var m = newModel();
    if (!src || typeof src !== 'object') return m;
    if (Array.isArray(src.types) && src.types.length) m.types = src.types;
    if (typeof src.hoursPerDay === 'number' && src.hoursPerDay > 0) m.hoursPerDay = src.hoursPerDay;
    if (src.dayColors) {
      ['weekend', 'holiday'].forEach(function (k) { if (/^#[0-9a-f]{6}$/i.test(src.dayColors[k] || '')) m.dayColors[k] = src.dayColors[k]; });
    }
    (src.places || []).forEach(function (p, i) {
      var place = typeof p === 'string' ? { name: p, color: PLACE_COLORS[i % PLACE_COLORS.length] } : p;
      if (place && place.name) m.places.push(place);
    });
    Object.keys(src.years || {}).forEach(function (y) {
      var s = src.years[y] || {};
      m.years[y] = {
        quotas: s.quotas || {},
        holidays: (s.holidays && s.holidays.length ? s.holidays : frenchHolidays(+y)).slice().sort(),
        schoolHolidays: s.schoolHolidays || [],
        days: s.days || {}
      };
    });
    migrate(m, src.version || 1);
    return m;
  }

  // v1 -> v2 : « PI Event » n'est plus un lieu mais un type de jour (code PI).
  function migrate(m, fromVersion) {
    if (fromVersion >= 2) return;
    if (!typeByCode(m, 'PI')) {
      var at = 0;
      m.types.forEach(function (t, i) { if (t.code === 'A') at = i + 1; });
      m.types.splice(at, 0, JSON.parse(JSON.stringify(DEFAULT_TYPES[2])));
    }
    m.places = m.places.filter(function (p) { return p.name !== 'PI Event'; });
    Object.keys(m.years).forEach(function (y) {
      var days = m.years[y].days;
      Object.keys(days).forEach(function (d) {
        if (days[d].p !== 'PI Event') return;
        delete days[d].p;
        if (!days[d].c) days[d].c = 'PI'; // un code déjà saisi est conservé
      });
    });
  }

  function typeByCode(model, code) {
    for (var i = 0; i < model.types.length; i++) if (model.types[i].code === code) return model.types[i];
    return null;
  }

  /* ---------- statistiques ---------- */

  // today : date ISO servant à séparer « pris » (<= today) de « posé » (toute l'année).
  function yearStats(model, year, today) {
    var y = model.years[year];
    var holidays = toSet(y.holidays);
    var perType = {};
    model.types.forEach(function (t) { perType[t.code] = { code: t.code, taken: 0, planned: 0 }; });

    var months = [];
    for (var m = 1; m <= 12; m++) {
      months.push({ month: m, workdays: 0, tt: 0, absences: 0, worked: 0, onsite: 0 });
    }
    var total = { workdays: 0, holidaysOnWorkdays: 0, absences: 0, worked: 0, tt: 0, onsite: 0 };

    for (var mm = 1; mm <= 12; mm++) {
      var n = daysInMonth(+year, mm), ms = months[mm - 1];
      for (var d = 1; d <= n; d++) {
        var s = iso(+year, mm, d), entry = y.days[s], code = entry && entry.c;
        var work = isWorkday(s, holidays);
        if (work) ms.workdays++;
        else if (!isWeekend(s)) total.holidaysOnWorkdays++;
        if (!code) continue;
        var t = typeByCode(model, code);
        if (!perType[code]) perType[code] = { code: code, taken: 0, planned: 0 };
        perType[code].planned++;
        if (s <= today) perType[code].taken++;
        if (code === 'TT' || (t && t.code === 'TT')) ms.tt++;
        if (t && t.absence && work) ms.absences++;
      }
      ms.worked = ms.workdays - ms.absences;
      ms.onsite = ms.worked - ms.tt;
      total.workdays += ms.workdays; total.absences += ms.absences; total.tt += ms.tt;
    }
    total.worked = total.workdays - total.absences;
    total.onsite = total.worked - total.tt;

    var rows = model.types.map(function (t) {
      var c = perType[t.code];
      var quota = t.quota ? (+y.quotas[t.code] || 0) : null;
      return {
        type: t, taken: c.taken, planned: c.planned,
        quota: quota,
        remaining: quota === null ? null : quota - c.taken,
        remainingPlanned: quota === null ? null : quota - c.planned,
        remainingHours: quota !== null && t.hours ? (quota - c.taken) * model.hoursPerDay : null,
        remainingPlannedHours: quota !== null && t.hours ? (quota - c.planned) * model.hoursPerDay : null,
        over: quota !== null && c.planned > quota + 1e-9
      };
    });
    return { rows: rows, months: months, total: total };
  }

  function formatDays(n) {
    var r = Math.round(n * 100) / 100;
    return String(r).replace('.', ',');
  }
  function formatHours(h) { // 12,5 -> « 12 h 30 »
    var neg = h < 0, a = Math.abs(h), hh = Math.floor(a + 1e-9), mm = Math.round((a - hh) * 60);
    if (mm === 60) { hh++; mm = 0; }
    return (neg ? '-' : '') + hh + ' h' + (mm ? ' ' + pad(mm) : '');
  }

  var api = {
    MONTHS: MONTHS, DEFAULT_DAY_COLORS: DEFAULT_DAY_COLORS, WEEKDAYS: WEEKDAYS, DEFAULT_TYPES: DEFAULT_TYPES, PLACE_COLORS: PLACE_COLORS,
    iso: iso, addDays: addDays, weekday: weekday, isWeekend: isWeekend, daysInMonth: daysInMonth, todayISO: todayISO,
    easter: easter, frenchHolidays: frenchHolidays, isWorkday: isWorkday, toSet: toSet,
    emptyYear: emptyYear, newModel: newModel, normalizeModel: normalizeModel, typeByCode: typeByCode,
    yearStats: yearStats, formatDays: formatDays, formatHours: formatHours
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Conges = api;
})(typeof window !== 'undefined' ? window : globalThis);
