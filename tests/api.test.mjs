import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createApplication } from '../server/index.mjs';

test('local API: persistence, isolation, reports, recurrence, files, export and deletion', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'health-journey-test-'));
  let app, origin, token;
  const boot = async () => {
    app = createApplication({ dataDir: directory }); await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${app.server.address().port}`;
    token = (await fetch(origin + '/api/session').then(response => response.json())).token;
  };
  const api = async (path, method = 'GET', body, expected = 200) => {
    const response = await fetch(origin + '/api' + path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body == null ? undefined : JSON.stringify(body) });
    const data = await response.json(); assert.equal(response.status, expected, JSON.stringify(data)); return data;
  };
  try {
    await boot();
    assert.equal((await fetch(origin + '/api/patients')).status, 401);
    assert.equal((await fetch(origin + '/api/session', { headers: { Origin: 'https://untrusted.example' } })).status, 403);
    const alice = await api('/patients', 'POST', { name: '测试甲', relation: '本人', consent: true }, 201);
    const bob = await api('/patients', 'POST', { name: '测试乙', relation: '母亲', consent: true }, 201);
    const a = '/patients/' + alice.id, b = '/patients/' + bob.id;
    const encounter = await api(a + '/encounters', 'POST', { title: '复查', date: '2026-10-30', hospital: '测试医院' }, 201);
    // 历史记录可以晚于今天的记录补录，排序依据是发生日期。
    const historic = await api(a + '/encounters', 'POST', { title: '三个月前的复诊', date: '2026-07-30', eventType: '复诊', topic: '甲状腺', note: '补记的历史经历' }, 201);
    const recent = await api(a + '/encounters', 'POST', { title: '甲状腺复诊', date: '2026-10-28', eventType: '复诊' }, 201);
    assert.deepEqual((await api(a + '/summary')).encounters.map(item => item.id), [encounter.id, recent.id, historic.id]);
    assert.equal((await api(a + '/encounters/' + historic.id)).note, '补记的历史经历');
    await api(b + '/encounters/' + historic.id, 'GET', null, 404);
    await api(b + '/encounters/' + historic.id, 'PUT', { ...historic, title: '越权修改' }, 404);
    const changed = await api(a + '/encounters/' + recent.id, 'PUT', { ...recent, date: '2026-06-01', note: '更正发生日期' });
    assert.equal(changed.version, 2);
    assert.deepEqual((await api(a + '/summary')).encounters.map(item => item.id), [encounter.id, historic.id, recent.id]);
    await api(a + '/encounters/' + recent.id, 'PUT', { ...recent, date: '2026-06-02' }, 409);
    const reportInput = { title: '生化报告', date: '2026-10-30', kind: '检验', encounterId: encounter.id, specimen: '血清', method: '直接法', observations: [{ metricId: 'ldl', value: '3.69', unit: 'mmol/L', reference: '0–3.4' }] };
    const report = await api(a + '/reports', 'POST', reportInput, 201);
    assert.equal(report.status, 'pending');
    await api(b + '/reports/' + report.id, 'GET', null, 404);
    await api(b + '/reports', 'POST', reportInput, 404);
    await api(a + '/reports/' + report.id, 'PUT', { ...reportInput, version: 99 }, 409);
    const updated = await api(a + '/reports/' + report.id, 'PUT', { ...reportInput, version: 1, status: 'confirmed' });
    assert.equal(updated.version, 2); assert.equal((await api(a + '/reports/' + report.id)).revisions.length, 1);
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
    const upload = bytes => fetch(origin + '/api' + a + '/reports/' + report.id + '/files', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent('测试原件.png') }, body: bytes });
    assert.equal((await upload(Buffer.from('<html>not an image</html>'))).status, 400);
    const uploaded = await upload(png); assert.equal(uploaded.status, 201); const files = await uploaded.json();
    assert.equal((await upload(png)).status, 409);
    assert.equal((await fetch(origin + '/api/files/' + files[0].id)).status, 401);
    const download = await fetch(origin + '/api/files/' + files[0].id, { headers: { Authorization: `Bearer ${token}` } });
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), png);
    const taskInput = { title: '复查提醒', type: '复诊', date: '2026-10-30', repeat: 'weekly', encounterId: encounter.id };
    const task = await api(a + '/tasks', 'POST', taskInput, 201);
    await api(a + '/tasks/' + task.id + '/occurrence', 'PUT', { date: '2026-10-31', status: 'done' }, 400);
    await api(a + '/tasks/' + task.id + '/occurrence', 'PUT', { date: '2026-10-30', status: 'done' });
    assert.equal((await api(a + '/calendar?date=2026-10-30'))[0].status, 'done');
    assert.equal((await api(a + '/calendar?date=2026-11-06'))[0].status, 'pending');
    await api(a + '/tasks/' + task.id, 'PUT', { ...taskInput, date: '2026-10-29', version: 1 }, 400);
    await app.close(); app = null; await boot();
    assert.equal((await api(a + '/reports/' + report.id)).files.length, 1);
    assert.equal((await api(a + '/encounters/' + historic.id)).topic, '甲状腺');
    assert.equal((await api(a + '/encounters/' + recent.id)).note, '更正发生日期');
    assert.equal((await api(a + '/calendar?date=2026-10-30'))[0].status, 'done');
    const archive = await fetch(origin + '/api' + a + '/export', { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(archive.status, 200); const zip = Buffer.from(await archive.arrayBuffer()); assert.equal(zip.readUInt32LE(0), 0x04034b50); assert.equal(zip.readUInt16LE(zip.length - 12), 2);
    await api(a + '/encounters/' + encounter.id, 'DELETE'); assert.equal((await api(a + '/reports/' + report.id)).encounterId, '');
    await api(a, 'DELETE'); assert.equal(readdirSync(join(directory, 'uploads')).length, 0);
    await api(a, 'GET', null, 404); assert.equal((await api('/patients')).length, 1);
  } finally {
    if (app) await app.close();
    assert.equal(dirname(resolve(directory)), resolve(tmpdir())); assert.ok(directory.includes('health-journey-test-'));
    rmSync(directory, { recursive: true, force: true });
  }
});
