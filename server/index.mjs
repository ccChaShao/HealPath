import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { resolve, join, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { HttpError, assert, validate, day, occursOn, metrics, comparison, choice } from './domain.mjs';
import { zip } from './zip.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const MAX_FILE = 15 * 1024 * 1024;
const kinds = ['encounters', 'reports', 'tasks'];
const decode = row => row ? { ...JSON.parse(row.data), id: row.id, patientId: row.patient_id, version: row.version, createdAt: row.created_at } : null;
async function body(req, max) {
  const chunks = []; let length = 0;
  for await (const chunk of req) { length += chunk.length; if (length > max) throw new HttpError(413, `文件或请求太大，单文件上限 15 MB`); chunks.push(chunk); }
  return Buffer.concat(chunks);
}
async function jsonBody(req) {
  assert((req.headers['content-type'] || '').startsWith('application/json'), '请使用 JSON 格式');
  try { return JSON.parse((await body(req, 1024 * 1024)).toString()); }
  catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(400, 'JSON 格式不正确'); }
}
function detectType(bytes) {
  if (bytes.subarray(0, 5).toString() === '%PDF-') return { type: 'application/pdf', extension: 'pdf' };
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { type: 'image/png', extension: 'png' };
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return { type: 'image/jpeg', extension: 'jpg' };
  throw new HttpError(400, '当前支持 JPG、PNG 和 PDF 原件');
}
export function createApplication({ dataDir = join(root, '.data') } = {}) {
  mkdirSync(join(dataDir, 'uploads'), { recursive: true });
  const db = new DatabaseSync(join(dataDir, 'health.sqlite'));
  db.exec(`PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS patients (id TEXT PRIMARY KEY, patient_id TEXT, data TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, kind TEXT NOT NULL, patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE, data TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS records_patient_kind ON records(patient_id, kind);
    CREATE TABLE IF NOT EXISTS files (id TEXT PRIMARY KEY, report_id TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE, patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE, name TEXT NOT NULL, type TEXT NOT NULL, size INTEGER NOT NULL, hash TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS occurrences (task_id TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE, date TEXT NOT NULL, status TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(task_id, date));
    CREATE TABLE IF NOT EXISTS revisions (id TEXT PRIMARY KEY, patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE, record_id TEXT NOT NULL, version INTEGER NOT NULL, data TEXT NOT NULL, changed_at TEXT NOT NULL);`);
  const token = randomBytes(32).toString('hex');
  const getPatient = id => { const patient = decode(db.prepare('SELECT * FROM patients WHERE id = ?').get(id)); assert(patient, '家庭成员不存在', 404); return patient; };
  const getRecord = (id, kind, patientId) => { const row = db.prepare('SELECT * FROM records WHERE id = ? AND kind = ? AND patient_id = ?').get(id, kind, patientId); assert(row, '记录不存在或不属于当前成员', 404); return decode(row); };
  const list = (patientId, kind) => db.prepare('SELECT * FROM records WHERE patient_id = ? AND kind = ?').all(patientId, kind).map(decode).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  const filesFor = reportId => db.prepare('SELECT id, name, type, size, created_at AS createdAt FROM files WHERE report_id = ? ORDER BY created_at').all(reportId);
  const transaction = operation => { db.exec('BEGIN'); try { const value = operation(); db.exec('COMMIT'); return value; } catch (error) { db.exec('ROLLBACK'); throw error; } };
  const cleanup = files => files.forEach(file => { const path = join(dataDir, 'uploads', file.id); if (existsSync(path)) unlinkSync(path); });
  const json = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    const port = req.socket.localPort;
    const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`];
    try {
      assert(allowedHosts.includes(req.headers.host), '本地服务仅允许回环地址访问', 403);
      assert(!req.headers.origin || allowedHosts.some(host => req.headers.origin === `http://${host}`), '不允许跨站访问本地健康资料', 403);
      const url = new URL(req.url, `http://${req.headers.host}`), path = url.pathname;
      if (path === '/api/session' && req.method === 'GET') {
        res.setHeader('Set-Cookie', `health_local=${token}; HttpOnly; SameSite=Strict; Path=/`);
        return json(res, 200, { token, mode: 'local', message: '仅限本机开发；尚未接入微信登录和云端服务', metrics });
      }
      if (!path.startsWith('/api/')) {
        assert(req.method === 'GET' || req.method === 'HEAD', '请求方式不支持', 405);
        const routes = { '/': 'index.html', '/app.js': 'app.js', '/styles.css': 'styles.css', '/timeline.css': 'timeline.css', '/timeline.js': '../miniprogram/utils/timeline.js' };
        assert(routes[path], '页面不存在', 404);
        const bytes = readFileSync(join(root, 'web', routes[path]));
        const type = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' }[extname(routes[path])];
        res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'");
        res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store' }); return res.end(req.method === 'HEAD' ? undefined : bytes);
      }
      const cookie = (req.headers.cookie || '').split(';').map(item => item.trim()).includes(`health_local=${token}`);
      assert(cookie || req.headers.authorization === `Bearer ${token}`, '本地会话已失效，请刷新页面', 401);
      if (path === '/api/patients') {
        if (req.method === 'GET') return json(res, 200, db.prepare('SELECT * FROM patients ORDER BY created_at').all().map(decode));
        if (req.method === 'POST') {
          const data = validate('patients', await jsonBody(req)); const id = randomUUID();
          db.prepare('INSERT INTO patients(id, patient_id, data, created_at) VALUES (?, ?, ?, ?)').run(id, id, JSON.stringify(data), new Date().toISOString());
          return json(res, 201, getPatient(id));
        }
      }
      const fileMatch = path.match(/^\/api\/files\/([\w-]+)$/);
      if (fileMatch && req.method === 'GET') {
        const file = db.prepare('SELECT * FROM files WHERE id = ?').get(fileMatch[1]); assert(file, '文件不存在', 404); getPatient(file.patient_id);
        const data = readFileSync(join(dataDir, 'uploads', file.id));
        res.writeHead(200, { 'Content-Type': file.type, 'Cache-Control': 'no-store', 'Content-Disposition': `${url.searchParams.has('download') ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(file.name)}` });
        return res.end(data);
      }
      const match = path.match(/^\/api\/patients\/([\w-]+)(?:\/([\w-]+))?(?:\/([\w-]+))?(?:\/([\w-]+))?$/);
      assert(match, '接口不存在', 404);
      const [, patientId, kind, id, action] = match; const patient = getPatient(patientId);
      if (!kind) {
        if (req.method === 'PUT') {
          const body = await jsonBody(req); assert(body.version === patient.version, '档案已在其他页面更新，请刷新后重试', 409);
          const data = validate('patients', body);
          db.prepare('UPDATE patients SET data = ?, version = version + 1 WHERE id = ?').run(JSON.stringify(data), patientId);
          return json(res, 200, getPatient(patientId));
        }
        if (req.method === 'DELETE') {
          const files = db.prepare('SELECT id FROM files WHERE patient_id = ?').all(patientId);
          db.prepare('DELETE FROM patients WHERE id = ?').run(patientId); cleanup(files);
          return json(res, 200, { deleted: true });
        }
      }
      if (kind === 'export' && req.method === 'GET') {
        const files = db.prepare('SELECT * FROM files WHERE patient_id = ?').all(patientId);
        assert(files.reduce((sum, file) => sum + file.size, 0) < 200 * 1024 * 1024, '本地版单次导出限制为 200 MB，请分批下载原件', 413);
        const records = Object.fromEntries(kinds.map(key => [key, list(patientId, key)]));
        const entries = files.map(file => ({ name: `originals/${file.id}.${file.type === 'application/pdf' ? 'pdf' : file.type === 'image/png' ? 'png' : 'jpg'}`, data: readFileSync(join(dataDir, 'uploads', file.id)) }));
        const occurrences = db.prepare('SELECT o.* FROM occurrences o JOIN records r ON o.task_id = r.id WHERE r.patient_id = ?').all(patientId);
        const revisions = db.prepare('SELECT * FROM revisions WHERE patient_id = ?').all(patientId);
        entries.unshift({ name: 'records.json', data: JSON.stringify({ exportedAt: new Date().toISOString(), patient, ...records, files, occurrences, revisions }, null, 2) });
        res.writeHead(200, { 'Content-Type': 'application/zip', 'Cache-Control': 'no-store', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(patient.name + '-健康资料.zip')}` }); return res.end(zip(entries));
      }
      if (kind === 'summary' && req.method === 'GET') return json(res, 200, { patient, encounters: list(patientId, 'encounters'), reports: list(patientId, 'reports').map(report => ({ ...report, files: filesFor(report.id) })), tasks: list(patientId, 'tasks') });
      if (kind === 'calendar' && req.method === 'GET') {
        const date = day(url.searchParams.get('date'));
        return json(res, 200, list(patientId, 'tasks').filter(task => occursOn(task, date)).map(task => ({ ...task, occurrenceDate: date, status: db.prepare('SELECT status FROM occurrences WHERE task_id = ? AND date = ?').get(task.id, date)?.status || 'pending' })).sort((a, b) => a.time.localeCompare(b.time)));
      }
      if (kind === 'comparison' && req.method === 'GET') {
        assert(metrics.some(metric => metric.id === url.searchParams.get('metric')), '指标不存在');
        return json(res, 200, comparison(list(patientId, 'reports'), url.searchParams.get('metric')));
      }
      assert(kinds.includes(kind), '接口不存在', 404);
      const record = id ? getRecord(id, kind, patientId) : null;
      if (action === 'occurrence' && kind === 'tasks' && req.method === 'PUT') {
        const body = await jsonBody(req), date = day(body.date); assert(occursOn(record, date), '该日期没有此事项');
        choice(body.status, ['pending', 'done', 'skipped'], '完成状态');
        db.prepare('INSERT INTO occurrences VALUES (?, ?, ?, ?) ON CONFLICT(task_id, date) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at').run(id, date, body.status, new Date().toISOString());
        return json(res, 200, { date, status: body.status });
      }
      if (action === 'files' && kind === 'reports' && req.method === 'POST') {
        assert(filesFor(id).length < 30, '每份报告最多上传 30 个原件');
        const bytes = await body(req, MAX_FILE); const { type, extension } = detectType(bytes);
        let name; try { name = decodeURIComponent(req.headers['x-file-name'] || `报告.${extension}`); } catch { throw new HttpError(400, '文件名格式不正确'); }
        name = name.replace(/[\x00-\x1f\\/]/g, '_').slice(0, 160);
        const hash = createHash('sha256').update(bytes).digest('hex');
        const duplicate = db.prepare('SELECT id FROM files WHERE report_id = ? AND hash = ?').get(id, hash);
        assert(!duplicate, '这份报告已经包含相同文件，请勿重复上传', 409);
        const fileId = randomUUID(); const filePath = join(dataDir, 'uploads', fileId);
        writeFileSync(filePath, bytes, { flag: 'wx' });
        try { db.prepare('INSERT INTO files VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(fileId, id, patientId, name || `报告.${extension}`, type, bytes.length, hash, new Date().toISOString()); }
        catch (error) { unlinkSync(filePath); throw error; }
        return json(res, 201, filesFor(id));
      }
      assert(!action, '接口不存在', 404);
      if (req.method === 'GET') return json(res, 200, id ? { ...record, ...(kind === 'reports' ? { files: filesFor(id), revisions: db.prepare('SELECT version, changed_at AS changedAt FROM revisions WHERE record_id = ? ORDER BY changed_at DESC').all(id) } : {}) } : list(patientId, kind));
      if (req.method === 'POST' && !id || req.method === 'PUT' && id) {
        const body = await jsonBody(req), data = validate(kind, body);
        if (data.encounterId) getRecord(data.encounterId, 'encounters', patientId);
        if (id) {
          assert(body.version === record.version, '记录已在其他页面更新，请刷新后重试', 409);
          if (kind === 'tasks' && db.prepare('SELECT 1 FROM occurrences WHERE task_id = ? LIMIT 1').get(id)) {
            assert(['date', 'time', 'endDate', 'repeat'].every(key => data[key] === record[key]), '该计划已有执行记录；请保留时间规则，或新建后续计划');
          }
          transaction(() => {
            db.prepare('INSERT INTO revisions VALUES (?, ?, ?, ?, ?, ?)').run(randomUUID(), patientId, id, record.version, JSON.stringify(record), new Date().toISOString());
            db.prepare('UPDATE records SET data = ?, version = version + 1 WHERE id = ?').run(JSON.stringify(data), id);
          });
        } else {
          const newId = randomUUID(); db.prepare('INSERT INTO records(id, kind, patient_id, data, created_at) VALUES (?, ?, ?, ?, ?)').run(newId, kind, patientId, JSON.stringify(data), new Date().toISOString());
          return json(res, 201, getRecord(newId, kind, patientId));
        }
        return json(res, 200, getRecord(id, kind, patientId));
      }
      if (req.method === 'DELETE' && id) {
        const files = db.prepare('SELECT id FROM files WHERE report_id = ?').all(id);
        transaction(() => {
          if (kind === 'encounters') for (const linkedKind of ['reports', 'tasks']) for (const linked of list(patientId, linkedKind)) if (linked.encounterId === id) {
            const { id: linkedId, patientId: _, version, createdAt, ...data } = linked;
            data.encounterId = ''; db.prepare('UPDATE records SET data = ?, version = version + 1 WHERE id = ?').run(JSON.stringify(data), linkedId);
          }
          db.prepare('DELETE FROM revisions WHERE record_id = ?').run(id);
          db.prepare('DELETE FROM records WHERE id = ?').run(id);
        }); cleanup(files); return json(res, 200, { deleted: true });
      }
      throw new HttpError(405, '请求方式不支持');
    } catch (error) {
      if (!res.headersSent) json(res, error.status || 500, { error: error.status ? error.message : '本地服务处理失败，请查看终端状态' });
      else res.end();
      if (!error.status) console.error('服务异常：', error.code || error.name);
    }
  });
  server.requestTimeout = 60_000;
  return { server, db, close: () => new Promise(resolve => server.close(() => { db.close(); resolve(); })) };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const port = Number(process.env.PORT || 4317);
  assert(Number.isInteger(port) && port > 0 && port <= 65535, 'PORT 配置不正确');
  const application = createApplication();
  application.server.listen(port, '127.0.0.1', () => {
    console.log(`愈之路本地版已启动：http://127.0.0.1:${port}`);
    console.log('数据保存在 .data；仅本机可访问。尚未接入微信登录、OCR 和云端存储。');
  });
}
