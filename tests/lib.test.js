'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const L = require('../js/lib.js');

function loadSeed() {
  const src = fs.readFileSync(path.join(__dirname, '../data/seed.js'), 'utf8');
  const sandbox = { window: {} };
  new Function('window', src)(sandbox.window);
  return sandbox.window.CONGES_SEED;
}

test('dates : pâques et jours fériés', () => {
  assert.equal(L.easter(2026), '2026-04-05');
  assert.equal(L.easter(2024), '2024-03-31');
  assert.deepEqual(L.frenchHolidays(2026), ['2026-01-01', '2026-04-06', '2026-05-01', '2026-05-08', '2026-05-14',
    '2026-05-25', '2026-07-14', '2026-08-15', '2026-11-01', '2026-11-11', '2026-12-25']);
});

test('jours fériés générés = ceux saisis dans le classeur, pour chaque année', () => {
  const seed = loadSeed();
  for (const y of Object.keys(seed.years)) {
    assert.deepEqual(L.frenchHolidays(+y), seed.years[y].holidays, 'année ' + y);
  }
});

test('addDays / weekday / daysInMonth', () => {
  assert.equal(L.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(L.addDays('2024-02-28', 1), '2024-02-29');
  assert.equal(L.weekday('2026-10-08'), 4); // jeudi
  assert.equal(L.daysInMonth(2024, 2), 29);
  assert.equal(L.daysInMonth(2026, 2), 28);
});

test('soldes 2026 = valeurs du classeur (posés), pris = jusqu\'à la date du jour', () => {
  const m = L.normalizeModel(loadSeed());
  const s = L.yearStats(m, '2026', '2026-10-08');
  const row = (c) => s.rows.find((r) => r.type.code === c);
  // « Posés » du classeur : CA 22, CJT 12, CCA 3, TT 82
  assert.equal(row('CA').planned, 22);
  assert.equal(row('CJT').planned, 12);
  assert.equal(row('CCA').planned, 3);
  assert.equal(row('TT').planned, 82);
  assert.equal(row('CA').remainingPlanned, 4);
  assert.equal(row('CJT').remainingPlanned, 0);
  assert.ok(Math.abs(row('RA').remainingPlannedHours - 53.5) < 1e-3);
  assert.ok(Math.abs(row('CH').remainingPlannedHours - 51.3667) < 1e-3);
  // Ligne 35 / 37 du classeur : jours ouvrés et jours travaillés par mois, et total (252)
  assert.deepEqual(s.months.map((x) => x.workdays), [21, 20, 22, 21, 17, 22, 22, 21, 22, 22, 20, 22]);
  assert.deepEqual(s.months.map((x) => x.worked), [21, 18, 22, 19, 11, 21, 11, 19, 17, 20, 18, 18]);
  assert.deepEqual(s.months.map((x) => x.tt), [9, 7, 8, 9, 3, 8, 5, 8, 6, 8, 6, 5]);
  assert.equal(s.total.workdays, 252);
  assert.equal(s.total.holidaysOnWorkdays, 9); // 11 fériés, dont le 15 août (sam.) et le 1er nov. (dim.)
});

test('« pris » ne compte que les jours passés', () => {
  const m = L.normalizeModel(loadSeed());
  const before = L.yearStats(m, '2026', '2026-01-01');
  const after = L.yearStats(m, '2026', '2026-12-31');
  const ca = (s) => s.rows.find((r) => r.type.code === 'CA');
  assert.ok(ca(before).taken < ca(after).taken);
  assert.equal(ca(after).taken, ca(after).planned);
});

test('formatage', () => {
  assert.equal(L.formatDays(7.642857), '7,64');
  assert.equal(L.formatHours(53.5), '53 h 30');
  assert.equal(L.formatHours(-7), '-7 h');
});

test('migration v1 -> v2 : « PI Event » devient un type de jour', () => {
  const old = {
    version: 1,
    places: ['CDG', 'PI Event'],
    years: { 2026: { quotas: {}, holidays: [], schoolHolidays: [], days: {
      '2026-01-19': { p: 'PI Event' }, '2026-01-20': { c: 'TT', p: 'PI Event' }, '2026-01-21': { c: 'CA', p: 'CDG' } } } }
  };
  const m = L.normalizeModel(old);
  assert.equal(m.version, 2);
  assert.deepEqual(m.places.map((p) => p.name), ['CDG']);
  assert.ok(L.typeByCode(m, 'PI'));
  const d = m.years['2026'].days;
  assert.deepEqual(d['2026-01-19'], { c: 'PI' });
  assert.deepEqual(d['2026-01-20'], { c: 'TT' }); // le code déjà saisi est conservé
  assert.deepEqual(d['2026-01-21'], { c: 'CA', p: 'CDG' });
  // idempotent
  assert.deepEqual(L.normalizeModel(JSON.parse(JSON.stringify(m))).years['2026'].days, d);
});

test('migration : un modèle v1 déjà stocké sans type PI le reçoit après « A »', () => {
  const old = { version: 1, types: [{ code: 'TT', label: 'TT', color: '#000' }, { code: 'A', label: 'A', color: '#111' }, { code: 'CA', label: 'CA', color: '#222' }], years: {} };
  assert.deepEqual(L.normalizeModel(old).types.map((t) => t.code), ['TT', 'A', 'PI', 'CA']);
});

test('couleurs week-end / férié : valeurs par défaut, personnalisées, et ignorées si invalides', () => {
  assert.deepEqual(L.normalizeModel({ years: {} }).dayColors, L.DEFAULT_DAY_COLORS);
  const m = L.normalizeModel({ version: 2, dayColors: { weekend: '#112233', holiday: 'rouge' }, years: {} });
  assert.equal(m.dayColors.weekend, '#112233');
  assert.equal(m.dayColors.holiday, L.DEFAULT_DAY_COLORS.holiday);
});

test('graine : PI Event est un type, 10 jours en 2026, plus de lieu du même nom', () => {
  const m = L.normalizeModel(loadSeed());
  assert.ok(!m.places.some((p) => p.name === 'PI Event'));
  const s = L.yearStats(m, '2026', '2026-10-08');
  assert.equal(s.rows.find((r) => r.type.code === 'PI').planned, 10);
});

test('graine : aucun lieu sur un week-end ou un jour férié (invisible dans l\'Excel d\'origine)', () => {
  const m = L.normalizeModel(loadSeed());
  assert.deepEqual(L.weekendPlaceDays(m), []);
  const days = m.years['2026'].days;
  assert.equal(days['2026-02-08'], undefined);       // dimanche
  assert.equal(days['2026-05-25'], undefined);       // lundi de Pentecôte
  assert.deepEqual(days['2026-01-28'], { p: 'CDG' }); // jour ouvré : visible dans Excel
  assert.deepEqual(days['2026-10-13'], { p: 'CDG' });
});

test('weekendPlaceDays repère les lieux posés un week-end ou un jour férié', () => {
  const m = L.normalizeModel({ version: 2, places: ['CDG'], years: { 2026: { holidays: ['2026-05-25'], days: {
    '2026-02-08': { p: 'CDG' }, '2026-05-25': { c: 'CA', p: 'CDG' }, '2026-02-09': { p: 'CDG' } } } } });
  assert.deepEqual(L.weekendPlaceDays(m).map((x) => x.date), ['2026-02-08', '2026-05-25']);
});
