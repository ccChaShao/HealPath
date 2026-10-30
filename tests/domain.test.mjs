import test from 'node:test';
import assert from 'node:assert/strict';
import { comparison, occursOn, validate, day, exactNumber } from '../server/domain.mjs';
import { zip } from '../server/zip.mjs';

const report = (overrides = {}) => ({ id: 'a', date: '2026-09-01', status: 'confirmed', title: '检验', hospital: '医院', specimen: '血清', method: '直接法', observations: [{ metricId: 'ldl', value: '3.62', unit: 'mmol/L', reference: '0–3.4' }], ...overrides });
test('invalid dates and malformed medical input are rejected', () => {
  assert.throws(() => day('2026-02-30'));
  assert.equal(day('2024-02-29'), '2024-02-29');
  assert.throws(() => validate('patients', { name: '测试', consent: false }));
  assert.throws(() => validate('reports', { title: '报告', date: '2026-10-01', kind: '检验', observations: [{ metricId: 'unknown' }] }));
  assert.throws(() => validate('tasks', { title: '复诊', type: '复诊', date: '2026-10-30', endDate: '2026-10-01' }));
});
test('comparison excludes unconfirmed reports and computes only compatible exact results', () => {
  const result = comparison([report(), report({ id: 'b', date: '2026-10-01', observations: [{ metricId: 'ldl', value: '3.69', unit: 'mmol/L', reference: '0–3.1' }] }), report({ id: 'c', status: 'pending', date: '2026-10-03' })], 'ldl');
  assert.equal(result.points.length, 2); assert.equal(result.comparable, true); assert.equal(result.delta, 0.07);
  assert.equal(result.points[0].reference, '0–3.4'); assert.equal(result.points[1].reference, '0–3.1');
});
test('different units, methods, specimen, unknown methods, bounded and qualitative values never produce a delta', () => {
  for (const overrides of [
    { method: '' }, { method: '计算法' }, { specimen: '血浆' },
    { observations: [{ metricId: 'ldl', value: '142', unit: 'mg/dL' }] },
    { observations: [{ metricId: 'ldl', value: '<0.01', unit: 'mmol/L' }] },
    { observations: [{ metricId: 'ldl', value: '阴性', unit: 'mmol/L' }] },
  ]) {
    const result = comparison([report(), report({ id: 'b', date: '2026-10-01', ...overrides })], 'ldl');
    assert.equal(result.comparable, false); assert.equal(result.delta, null); assert.ok(result.reason);
  }
  assert.equal(exactNumber('0'), 0); assert.equal(exactNumber('1e999'), null); assert.equal(exactNumber('＞1000'), null);
});
test('same-day results are retained without inventing a temporal order; absent metrics are not zero', () => {
  const same = comparison([report(), report({ id: 'b' })], 'ldl'); assert.equal(same.points.length, 2); assert.equal(same.comparable, false);
  const absent = comparison([report({ observations: [] })], 'ldl'); assert.equal(absent.points.length, 0);
});
test('repeat schedules respect start, end, and weekly spacing', () => {
  const task = { date: '2026-10-30', endDate: '2026-11-15', repeat: 'weekly' };
  assert.equal(occursOn(task, '2026-10-29'), false); assert.equal(occursOn(task, '2026-10-30'), true);
  assert.equal(occursOn(task, '2026-11-06'), true); assert.equal(occursOn(task, '2026-11-07'), false);
  assert.equal(occursOn(task, '2026-11-20'), false); assert.equal(occursOn({ ...task, repeat: 'daily' }, '2026-10-31'), true);
});
test('ZIP export contains UTF-8 names, correct CRC and a central directory', () => {
  const bytes = zip([{ name: '档案.json', data: '123456789' }]);
  assert.equal(bytes.readUInt32LE(0), 0x04034b50); assert.equal(bytes.readUInt16LE(6), 0x800);
  assert.equal(bytes.readUInt32LE(14), 0xcbf43926); assert.equal(bytes.readUInt32LE(bytes.length - 22), 0x06054b50);
  assert.equal(bytes.readUInt16LE(bytes.length - 12), 1);
});
