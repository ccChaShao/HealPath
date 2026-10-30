import test from 'node:test';
import assert from 'node:assert/strict';
import { datePresets, shiftMonths, relativeDate, timelineGroups } from '../miniprogram/utils/timeline.js';
import { validate } from '../server/domain.mjs';

const reference = '2026-10-30';
test('quick dates represent calendar months, including leap years and month-end clamping', () => {
  assert.deepEqual(datePresets(reference).map(item => item.date), ['2026-10-30', '2026-10-29', '2026-10-28', '2026-07-30']);
  assert.equal(shiftMonths('2026-05-31', -3), '2026-02-28');
  assert.equal(shiftMonths('2024-05-31', -3), '2024-02-29');
  assert.equal(shiftMonths('2027-01-31', -3), '2026-10-31');
  assert.equal(relativeDate('2026-07-30', reference), '3 个月前');
  assert.equal(relativeDate('2026-10-28', reference), '前天');
  assert.equal(relativeDate(reference, reference), '今天');
});
test('historical events sort by occurrence date rather than recording time and group same-day entries', () => {
  const records = [
    { id: 'old', title: '复诊', date: '2026-07-30', createdAt: '2026-11-01' },
    { id: 'today', title: '肺部复诊', date: reference, createdAt: '2026-10-30', topic: '肺部', eventType: '复诊' },
    { id: 'thyroid', title: '甲状腺复诊', date: '2026-10-28', createdAt: '2026-10-31', eventType: '复诊' },
    { id: 'same-day', title: '检查', date: reference, createdAt: '2026-10-30', eventType: '检查' },
  ];
  const original = structuredClone(records);
  const groups = timelineGroups(records, { reference });
  assert.deepEqual(groups.map(group => group.key), ['2026-10', '2026-07']);
  assert.deepEqual(groups[0].days.map(day => day.date), [reference, '2026-10-28']);
  assert.equal(groups[0].days[0].items.length, 2);
  assert.equal(groups[1].days[0].items[0].eventType, '就诊');
  assert.equal(timelineGroups(records, { order: 'asc' })[0].days[0].date, '2026-07-30');
  assert.equal(timelineGroups(records, { limit: 1 })[0].days[0].items.length, 1);
  assert.deepEqual(records, original);
});
test('timeline searches labels and free text, filters types, and validates optional new fields', () => {
  const records = [{ id: 'a', title: '复诊', date: reference, eventType: '复诊', topic: '甲状腺', note: '下次检查前记得带报告' }, { id: 'b', title: '检查', date: reference, eventType: '检查', topic: '肺部' }];
  assert.equal(timelineGroups(records, { query: '甲状腺' })[0].days[0].items[0].id, 'a');
  assert.equal(timelineGroups(records, { query: '带报告' })[0].days[0].items[0].id, 'a');
  assert.equal(timelineGroups(records, { type: '检查' })[0].days[0].items[0].id, 'b');
  assert.deepEqual(timelineGroups(records, { query: '心脏' }), []);
  const minimal = validate('encounters', { title: '复诊', date: '2026-07-30' });
  assert.equal(minimal.eventType, '就诊'); assert.equal(minimal.note, '');
  assert.throws(() => validate('encounters', { title: '复诊', date: reference, eventType: '非法类型' }));
  assert.throws(() => validate('encounters', { title: '复诊', date: reference, topic: '字'.repeat(41) }));
});
