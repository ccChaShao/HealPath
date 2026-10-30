import { eventTypes } from '../miniprogram/utils/timeline.js';

export const metrics = [
  { id: 'ldl', name: '低密度脂蛋白胆固醇', unit: 'mmol/L', units: ['mmol/L', 'mg/dL'] },
  { id: 'hdl', name: '高密度脂蛋白胆固醇', unit: 'mmol/L', units: ['mmol/L', 'mg/dL'] },
  { id: 'tc', name: '总胆固醇', unit: 'mmol/L', units: ['mmol/L', 'mg/dL'] },
  { id: 'tg', name: '甘油三酯', unit: 'mmol/L', units: ['mmol/L', 'mg/dL'] },
  { id: 'ua', name: '尿酸', unit: 'μmol/L', units: ['μmol/L', 'mg/dL'] },
  { id: 'glucose', name: '葡萄糖', unit: 'mmol/L', units: ['mmol/L', 'mg/dL'] },
  { id: 'creatinine', name: '肌酐', unit: 'μmol/L', units: ['μmol/L', 'mg/dL'] },
  { id: 'wbc', name: '白细胞计数', unit: '10^9/L', units: ['10^9/L'] },
  { id: 'hgb', name: '血红蛋白', unit: 'g/L', units: ['g/L', 'g/dL'] },
  { id: 'plt', name: '血小板计数', unit: '10^9/L', units: ['10^9/L'] },
  { id: 'hba1c', name: '糖化血红蛋白', unit: '%', units: ['%', 'mmol/mol'] },
  { id: 'alt', name: '丙氨酸氨基转移酶', unit: 'U/L', units: ['U/L'] },
];

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const assert = (condition, message, status = 400) => { if (!condition) throw new HttpError(status, message); };
export function text(value, label, max = 500, required = false) {
  assert(value == null || typeof value === 'string', `${label}格式不正确`);
  const result = (value ?? '').trim();
  assert(result.length <= max, `${label}不能超过 ${max} 个字符`);
  assert(!required || result.length > 0, `请填写${label}`);
  return result;
}
export function day(value, label = '日期', optional = false) {
  if (!value && optional) return '';
  assert(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value), `${label}格式不正确`);
  const date = new Date(`${value}T00:00:00Z`);
  assert(!Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value, `${label}不存在`);
  return value;
}
export function choice(value, allowed, label) {
  assert(allowed.includes(value), `${label}不正确`); return value;
}
export function validate(kind, body) {
  assert(body && typeof body === 'object' && !Array.isArray(body), '请求内容格式不正确');
  if (kind === 'patients') return {
    name: text(body.name, '称呼', 40, true), relation: text(body.relation, '关系', 20) || '本人',
    birthday: day(body.birthday, '出生日期', true), allergies: text(body.allergies, '过敏史', 2000),
    history: text(body.history, '既往史', 4000), consent: choice(body.consent, [true], '本人或合法管理授权确认'),
  };
  if (kind === 'encounters') return {
    title: text(body.title, '事件标题', 100, true), date: day(body.date), hospital: text(body.hospital, '医院', 100),
    eventType: choice(body.eventType || '就诊', eventTypes, '事件类型'),
    topic: text(body.topic, '健康标签', 40), note: text(body.note, '时间线内容', 4000),
    department: text(body.department, '科室', 60), symptoms: text(body.symptoms, '症状', 4000),
    diagnosis: text(body.diagnosis, '诊断摘录', 4000), advice: text(body.advice, '医生建议', 4000),
  };
  if (kind === 'tasks') {
    const date = day(body.date); const endDate = day(body.endDate, '结束日期', true);
    assert(!endDate || endDate >= date, '结束日期不能早于开始日期');
    assert(!body.time || /^([01]\d|2[0-3]):[0-5]\d$/.test(body.time), '时间格式不正确');
    return { title: text(body.title, '事项名称', 100, true), date, endDate, time: body.time || '',
      type: choice(body.type, ['复诊', '检查', '用药', '待办'], '事项类型'),
      repeat: choice(body.repeat || 'none', ['none', 'daily', 'weekly'], '重复方式'),
      note: text(body.note, '备注', 2000), encounterId: text(body.encounterId, '关联就诊', 80) };
  }
  if (kind === 'reports') {
    const observations = body.observations ?? [];
    assert(Array.isArray(observations) && observations.length <= 100, '一份报告最多录入 100 项指标');
    const used = new Set();
    const normalized = observations.map(row => {
      const definition = metrics.find(metric => metric.id === row.metricId);
      assert(definition, '请选择支持的检验指标');
      assert(!used.has(row.metricId), '同一报告中指标不能重复'); used.add(row.metricId);
      return { metricId: definition.id, name: definition.name,
        value: text(row.value, '指标结果', 100, true), unit: choice(row.unit, definition.units, `${definition.name}单位`),
        reference: text(row.reference, '参考范围', 200), flag: choice(row.flag || '', ['', 'H', 'L', '异常'], '原报告异常标记') };
    });
    return { title: text(body.title, '报告名称', 100, true), date: day(body.date, '检验/报告日期'),
      hospital: text(body.hospital, '医院', 100), kind: choice(body.kind, ['检验', '影像', '病理', '处方', '其他'], '报告分类'),
      specimen: text(body.specimen, '标本', 100), method: text(body.method, '检测方法', 100),
      note: text(body.note, '备注', 4000), encounterId: text(body.encounterId, '关联就诊', 80),
      status: choice(body.status || 'pending', ['pending', 'confirmed'], '核对状态'), observations: normalized };
  }
  throw new HttpError(404, '资源不存在');
}
export function occursOn(task, date) {
  if (date < task.date || (task.endDate && date > task.endDate)) return false;
  if (task.repeat === 'none') return date === task.date;
  if (task.repeat === 'daily') return true;
  return (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${task.date}T00:00:00Z`)) / 86400000 % 7 === 0;
}
export function exactNumber(value) {
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) return null;
  const number = Number(value); return Number.isFinite(number) ? number : null;
}
export function comparison(reports, metricId) {
  const points = reports.filter(report => report.status === 'confirmed').flatMap(report => {
    const observation = report.observations.find(row => row.metricId === metricId);
    return observation ? [{ ...observation, reportId: report.id, title: report.title, date: report.date,
      specimen: report.specimen, method: report.method, hospital: report.hospital,
      number: exactNumber(observation.value) }] : [];
  }).sort((a, b) => a.date.localeCompare(b.date) || a.reportId.localeCompare(b.reportId));
  let reason = '';
  if (points.length < 2) reason = '至少需要两次已核对的结果';
  else if (points.some(point => point.number === null)) reason = '包含文字或有界结果，仅作原文对照';
  else if (points.some(point => !point.specimen || !point.method)) reason = '标本或检测方法未注明，暂不计算变化';
  else if (new Set(points.map(point => `${point.unit}|${point.specimen}|${point.method}`)).size !== 1) reason = '单位、标本或检测方法不同，暂不连线或计算变化';
  else if (new Set(points.map(point => point.date)).size !== points.length) reason = '同日有多次检验，当前未录入具体时刻，暂不计算先后变化';
  const delta = !reason ? Number((points.at(-1).number - points.at(-2).number).toPrecision(12)) : null;
  return { metric: metrics.find(metric => metric.id === metricId), points, comparable: !reason, reason, delta };
}
