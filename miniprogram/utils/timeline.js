// 浏览器与小程序共用日期和分组规则；使用 UTC 运算，避免设备时区改变日期。
export const eventTypes = ['复诊', '就诊', '检查', '治疗', '用药', '症状', '其他'];
export function shanghaiToday() {
  return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
}
export function shiftDays(date, days) {
  return new Date(Date.parse(date + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);
}
export function shiftMonths(date, months) {
  const [year, month, day] = date.split('-').map(Number);
  const first = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(day, lastDay));
  return first.toISOString().slice(0, 10);
}
export function datePresets(reference = shanghaiToday()) {
  return [
    { label: '今天', date: reference },
    { label: '昨天', date: shiftDays(reference, -1) },
    { label: '前天', date: shiftDays(reference, -2) },
    { label: '三个月前', date: shiftMonths(reference, -3) },
  ];
}
export function relativeDate(date, reference = shanghaiToday()) {
  const days = Math.round((Date.parse(reference + 'T00:00:00Z') - Date.parse(date + 'T00:00:00Z')) / 86400000);
  if (days === 0) return '今天';
  if (days === 1) return '昨天';
  if (days === 2) return '前天';
  if (days < 0) return Math.abs(days) + ' 天后';
  if (days < 31) return days + ' 天前';
  const [year, month] = reference.split('-').map(Number);
  const [pastYear, pastMonth] = date.split('-').map(Number);
  const months = (year - pastYear) * 12 + month - pastMonth;
  if (months > 0 && shiftMonths(reference, -months) === date) return months + ' 个月前';
  return '';
}
/** @param {any[]} records */
export function timelineGroups(records, { reference = shanghaiToday(), query = '', type = '', order = 'desc', limit = Infinity } = {}) {
  const needle = query.trim().toLocaleLowerCase();
  const entries = records.map(record => ({ ...record, eventType: record.eventType || '就诊', topic: record.topic || '', note: record.note || '' }))
    .filter(record => (!type || record.eventType === type) && (!needle || [record.title, record.topic, record.note, record.date, record.hospital, record.department, record.symptoms, record.diagnosis, record.advice].join(' ').toLocaleLowerCase().includes(needle)))
    .sort((a, b) => (order === 'asc' ? 1 : -1) * a.date.localeCompare(b.date) || String(b.createdAt || '').localeCompare(String(a.createdAt || '')) || a.id.localeCompare(b.id))
    .slice(0, limit);
  const groups = [];
  for (const entry of entries) {
    const key = entry.date.slice(0, 7);
    let month = groups[groups.length - 1];
    if (!month || month.key !== key) { month = { key, label: `${key.slice(0, 4)} 年 ${Number(key.slice(5))} 月`, days: [] }; groups.push(month); }
    let day = month.days[month.days.length - 1];
    if (!day || day.date !== entry.date) {
      day = { date: entry.date, day: entry.date.slice(-2), month: Number(entry.date.slice(5, 7)) + '月', relative: relativeDate(entry.date, reference), weekday: '周' + '日一二三四五六'[new Date(entry.date + 'T00:00:00Z').getUTCDay()], items: [] };
      month.days.push(day);
    }
    day.items.push(entry);
  }
  return groups;
}
