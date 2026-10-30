import { datePresets, eventTypes, timelineGroups } from '/timeline.js';

const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const shift = (date, amount) => new Date(Date.parse(`${date}T00:00:00Z`) + amount * 86400000).toISOString().slice(0, 10);
const dateLabel = date => new Intl.DateTimeFormat('zh-CN', { timeZone: 'UTC', month: 'long', day: 'numeric', weekday: 'long' }).format(new Date(`${date}T00:00:00Z`));
const paths = {
  leaf: '<path d="M19 4C7 2 3 7 5 14c2 7 14 6 14-10Z"/><path d="M5 21c0-7 5-10 10-13"/>',
  home: '<path d="m3 10 9-7 9 7v10H3Z"/><path d="M9 20v-7h6v7"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 11h18m-13 4h2m4 0h2"/>',
  folder: '<path d="M3 7V5h7l2 3h9l-3 12H3V7Zm0 5h16"/>',
  users: '<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3m0-16a3 3 0 0 1 0 6m3 3a5 5 0 0 1 3 5v2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  report: '<path d="M5 3h10l4 4v14H5Z"/><path d="M14 3v5h5M8 12h8m-8 4h5"/>',
  heart: '<path d="M3 12h4l3-7 4 14 3-7h4"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4m-4 5v2"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
};
const icon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.report}</svg>`;
const illustration = `<div class="hero-illustration" aria-hidden="true"><svg viewBox="0 0 210 160"><ellipse cx="112" cy="145" rx="78" ry="7" fill="#d6dfcd"/><path d="M160 139c-6-40 9-74 24-98" fill="none" stroke="#94aa80" stroke-width="2"/><path d="M166 99c-24-8-35-19-29-35 19 1 30 12 29 35m4-20c-3-24 6-40 22-43 5 17-4 30-22 43m-10 41c-19-3-31-11-30-24 15-2 28 7 30 24" fill="#b2c3a0"/><g transform="rotate(-9 90 90)"><rect x="38" y="32" width="94" height="114" rx="7" fill="#fafbf4" stroke="#c8d5bb"/><rect x="59" y="25" width="50" height="15" rx="5" fill="#789368"/><rect x="50" y="51" width="28" height="29" rx="6" fill="#e3edd9"/><path d="M58 65h12m-6-6v12" stroke="#7c956b" stroke-width="2"/><path d="M88 57h28m-28 9h21m-62 28h65m-65 11h65m-65 11h45" stroke="#d4dfc7" stroke-width="3" stroke-linecap="round"/></g><circle cx="128" cy="119" r="24" fill="#54794b"/><path d="m117 119 7 7 14-15" fill="none" stroke="#fafbf4" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg></div>`;
const state = { patients: [], patientId: localStorage.getItem('health-patient') || '', page: 'home', archive: 'records', date: today(), calendarMode: 'week', metric: 'ldl', summary: { encounters: [], reports: [], tasks: [] }, tasks: [], comparison: null, metrics: [], search: '', timelineType: '', timelineOrder: 'desc', loading: false };
let token = '', refreshSequence = 0, toastTimer;
async function api(path, options = {}, retry = true) {
  const headers = { Authorization: `Bearer ${token}`, ...(options.body && !(options.body instanceof ArrayBuffer) ? { 'Content-Type': 'application/json' } : {}), ...options.headers };
  const response = await fetch(`/api${path}`, { ...options, headers, body: options.body && !(options.body instanceof ArrayBuffer) ? JSON.stringify(options.body) : options.body });
  if (response.status === 401 && retry) { const session = await fetch('/api/session').then(response => response.json()); token = session.token; return api(path, options, false); }
  const result = await response.json(); if (!response.ok) throw new Error(result.error || '请求失败'); return result;
}
const patient = () => state.patients.find(item => item.id === state.patientId);
const base = () => `/patients/${state.patientId}`;
function toast(message) { $('#toast').textContent = message; $('#toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 4000); }
function fail(error) { const area = $('#editor .error'); if ($('#editor').open && area) { area.textContent = error.message; area.classList.add('visible'); } else toast(error.message); }
async function refresh() {
  const sequence = ++refreshSequence;
  const patients = await api('/patients'); if (sequence !== refreshSequence) return;
  state.patients = patients;
  if (!patients.some(item => item.id === state.patientId)) state.patientId = patients[0]?.id || '';
  localStorage.setItem('health-patient', state.patientId);
  if (state.patientId) {
    const target = base();
    const [summary, tasks, trend] = await Promise.all([api(`${target}/summary`), api(`${target}/calendar?date=${state.date}`), api(`${target}/comparison?metric=${state.metric}`)]);
    if (sequence !== refreshSequence) return;
    state.summary = summary; state.tasks = tasks; state.comparison = trend;
  } else { state.summary = { encounters: [], reports: [], tasks: [] }; state.tasks = []; state.comparison = null; }
  render();
}
const button = (action, label, extra = '', style = '') => `<button class="btn ${style}" data-action="${action}" ${extra}>${label}</button>`;
const empty = (name, title, description, action = '', label = '', large = false) => `<div class="empty ${large ? 'large' : ''}">${icon(name)}<strong>${title}</strong><p>${description}</p>${action ? button(action, label, '', 'light') : ''}</div>`;
function taskRows(tasks) {
  return tasks.length ? tasks.map(task => `<div class="task-row ${task.status !== 'pending' ? 'finished' : ''}"><button class="check ${esc(task.status)}" data-action="toggle-task" data-id="${task.id}" data-status="${task.status}" aria-label="${task.status === 'done' ? '撤销完成' : '完成'} ${esc(task.title)}">${task.status === 'done' ? '✓' : task.status === 'skipped' ? '−' : ''}</button><div class="task-main"><strong>${esc(task.title)}</strong><small>${esc(task.type)} · ${task.time || '全天'}${task.repeat !== 'none' ? ' · 重复事项' : ''}${task.status === 'skipped' ? ' · 已跳过' : ''}</small></div><div class="task-actions"><button data-action="skip-task" data-id="${task.id}">${task.status === 'skipped' ? '恢复' : '跳过'}</button><button data-action="edit-tasks" data-id="${task.id}">编辑</button></div></div>`).join('') : empty('calendar', '今天，留一点时间给自己', '还没有安排事项，可以添加复查、用药或其他待办。', 'new-task', '添加事项');
}
function reportRows(reports) {
  return reports.length ? reports.map(report => `<div class="list-row"><span class="record-icon">${icon('report')}</span><div class="list-copy"><button class="open" data-action="view-report" data-id="${report.id}"><strong>${esc(report.title)}</strong></button><small>${esc(report.hospital || '医院未填写')} · ${esc(report.kind)} · ${report.files?.length || 0} 份原件</small></div><div><span class="tag ${report.status === 'pending' ? 'amber' : ''}">${report.status === 'pending' ? '待核对' : '已核对'}</span><p class="record-date">${report.date}</p></div></div>`).join('') : empty('folder', '第一份报告，从这里归档', '照片和 PDF 都可以保存，也可以先手动录入检验结果。', 'new-report', '新增报告');
}
function timeline(records, compact = false) {
  const groups = timelineGroups(records, compact ? { limit: 3 } : { query: state.search, type: state.timelineType, order: state.timelineOrder });
  if (!groups.length) return empty('heart', records.length ? '没有找到符合条件的记录' : '把每次复诊，连成一条时间线', records.length ? '试试其他关键词或事件类型。' : '今天的肺部复诊、前天的甲状腺复诊，或更早的经历，都可以在这里补记。', 'new-encounter', '添加时间线');
  return `<div class="timeline ${compact ? 'compact' : ''}">${groups.map(month => `<section class="timeline-month"><h3>${month.label}</h3>${month.days.map(day => `<div class="timeline-day"><div class="timeline-date"><strong>${day.day}</strong><span>${esc(day.relative || day.weekday)}</span><time datetime="${day.date}">${day.date}</time></div><div class="timeline-track">${day.items.map(record => {
    const related = state.summary.reports.filter(report => report.encounterId === record.id);
    const text = record.note || record.symptoms || record.diagnosis || record.advice;
    return `<article class="timeline-event"><div class="timeline-event-head"><div class="badge-list"><span class="tag">${esc(record.eventType)}</span>${record.topic ? `<span class="tag topic">${esc(record.topic)}</span>` : ''}</div><button class="text-btn" data-action="edit-encounters" data-id="${record.id}" aria-label="编辑 ${esc(record.title)}">编辑</button></div><button class="timeline-title" data-action="view-encounter" data-id="${record.id}">${esc(record.title)}</button>${text ? `<p class="timeline-note">${esc(text)}</p>` : ''}<div class="timeline-meta">${[record.hospital, record.department].filter(Boolean).map(esc).join(' · ')}${related.length ? `<button class="text-btn" data-action="view-encounter" data-id="${record.id}">${related.length} 份关联报告 →</button>` : ''}</div></article>`;
  }).join('')}</div></div>`).join('')}</section>`).join('')}</div>`;
}
function metricOptions(value) { return state.metrics.map(metric => `<option value="${metric.id}" ${metric.id === value ? 'selected' : ''}>${metric.name}</option>`).join(''); }
function chart() {
  const trend = state.comparison;
  if (!trend?.points.length) return empty('heart', '看见身体的细微变化', '完成报告核对后，这里会展示指标历史。');
  const last = trend.points.at(-1);
  const summary = `<div class="chart-info"><strong>${esc(last.value)}</strong><small>${esc(last.unit)} · ${last.date}</small></div>`;
  if (!trend.comparable) return `${summary}<p class="hint">${esc(trend.reason)}</p><div class="table-wrap"><table><tbody>${trend.points.slice(-6).map(point => `<tr><td>${point.date}</td><td>${esc(point.value)} ${esc(point.unit)}</td><td>${esc(point.reference || '未填写参考范围')}</td></tr>`).join('')}</tbody></table></div>`;
  const points = trend.points.slice(-8), numbers = points.map(point => point.number);
  const min = Math.min(...numbers), max = Math.max(...numbers), spread = max - min || Math.max(Math.abs(max) * .2, 1);
  const coordinates = points.map((point, index) => [38 + index / (points.length - 1) * 364, 115 - (point.number - min) / spread * 75]);
  return `${summary}<svg class="chart" viewBox="0 0 440 165" role="img" aria-label="${esc(trend.metric.name)}历史趋势"><path d="M30 35H420M30 80H420M30 125H420" stroke="#e7ecdf" stroke-dasharray="4 5" fill="none"/><polyline points="${coordinates.map(point => point.join(',')).join(' ')}" stroke="#7b9564" stroke-width="2" fill="none"/>${coordinates.map(([x, y], index) => `<circle cx="${x}" cy="${y}" r="4" fill="#fffefb" stroke="#76915f" stroke-width="2"/><text x="${x}" y="${y - 12}" text-anchor="middle">${esc(points[index].value)}</text><text x="${x}" y="149" text-anchor="middle">${points[index].date.slice(5)}</text>`).join('')}</svg><div class="hint">较上次 ${trend.delta > 0 ? '+' : ''}${trend.delta} ${esc(last.unit)}。参考范围请查看每次原报告。</div>`;
}
function renderHome() {
  const { encounters, reports } = state.summary;
  const pending = reports.filter(report => report.status === 'pending').length;
  return `<div class="home-grid">
    <section class="card timeline-home"><div class="card-title"><h2>我的健康时间线 <span class="sub-count">${encounters.length} 条</span></h2><button class="text-btn" data-action="open-timeline">查看全部 →</button></div>${timeline(encounters, true)}<div class="card-footer"><button class="text-btn" data-action="new-encounter">＋ 补记一次经历</button></div></section>
    <section class="card"><div class="card-title"><h2>${state.date === today() ? '今日事项' : dateLabel(state.date)} <span class="sub-count">${state.tasks.length} 项</span></h2><button class="text-btn" data-action="page" data-page="calendar">查看日历 →</button></div>${taskRows(state.tasks.slice(0, 4))}</section>
    <section class="card"><div class="card-title"><h2>档案小记</h2>${icon('folder')}</div><div class="stats"><div class="stat"><strong>${reports.length.toString().padStart(2, '0')}</strong><span>已存报告</span></div><div class="stat"><strong>${encounters.length.toString().padStart(2, '0')}</strong><span>时间线记录</span></div><div class="stat"><strong>${pending.toString().padStart(2, '0')}</strong><span>待核对</span></div></div><div class="card-footer"><button class="text-btn" data-action="page" data-page="archive">打开完整档案 →</button></div></section>
    <section class="card"><div class="card-title"><h2>最近的报告</h2><button class="text-btn" data-action="new-report">＋ 新增报告</button></div>${reportRows(reports.slice(0, 3))}</section>
    <section class="card"><div class="card-title"><h2>关注指标</h2>${icon('heart')}</div><select class="inline-select" id="metric-picker" aria-label="关注指标">${metricOptions(state.metric)}</select><div class="chart-block">${chart()}</div></section>
  </div>`;
}
function calendarGrid() {
  if (state.calendarMode === 'week') {
    const offset = (new Date(`${state.date}T00:00:00Z`).getUTCDay() + 6) % 7;
    return `<div class="week">${Array.from({ length: 7 }, (_, i) => { const date = shift(state.date, i - offset); return `<button class="day ${date === state.date ? 'selected' : ''} ${date === today() ? 'today' : ''}" data-action="date" data-date="${date}"><span>${'一二三四五六日'[i]}</span><strong>${Number(date.slice(-2))}</strong></button>`; }).join('')}</div>`;
  }
  const start = `${state.date.slice(0, 7)}-01`, offset = (new Date(`${start}T00:00:00Z`).getUTCDay() + 6) % 7;
  return `<div class="month-grid">${Array.from('一二三四五六日').map(name => `<div class="weekday">${name}</div>`).join('')}${Array.from({ length: 42 }, (_, i) => { const date = shift(start, i - offset); return `<button class="day ${date === state.date ? 'selected' : ''} ${date.slice(0, 7) !== state.date.slice(0, 7) ? 'outside' : ''}" data-action="date" data-date="${date}"><strong>${Number(date.slice(-2))}</strong>${date === today() ? '<span>今天</span>' : ''}</button>`; }).join('')}</div>`;
}
function renderCalendar() {
  return `<div class="two-cols"><section class="card"><div class="calendar-head"><h2>${state.date.slice(0, 4)} 年 ${Number(state.date.slice(5, 7))} 月</h2><div class="calendar-controls"><button data-action="shift-date" data-shift="-1" aria-label="上一周或月">‹</button><button data-action="date" data-date="${today()}">今天</button><button data-action="shift-date" data-shift="1" aria-label="下一周或月">›</button></div></div><div class="tabs"><button class="${state.calendarMode === 'week' ? 'active' : ''}" data-action="calendar-mode" data-mode="week">周</button><button class="${state.calendarMode === 'month' ? 'active' : ''}" data-action="calendar-mode" data-mode="month">月</button></div>${calendarGrid()}<div class="card-title"><h2>${dateLabel(state.date)}的事项</h2><button class="text-btn" data-action="new-task">＋ 添加</button></div>${taskRows(state.tasks)}</section><aside><section class="card"><div class="card-title"><h2>把重要的事，提前记下</h2>${icon('leaf')}</div><p class="muted">复诊、检查、用药或日常待办，都可以安排在日历里。每天或每周重复的计划，会为每次执行分别保留状态。</p><div class="hint">本地版提供日历记录，尚未接入微信订阅消息，不会发送手机提醒。</div></section><section class="card" style="margin-top:20px"><div class="card-title"><h2>所有计划 <span class="sub-count">${state.summary.tasks.length} 项</span></h2></div>${state.summary.tasks.map(task => `<div class="list-row"><div class="list-copy"><button class="open" data-action="edit-tasks" data-id="${task.id}"><strong>${esc(task.title)}</strong></button><small>${task.date} 起 · ${esc(task.type)}</small></div></div>`).join('') || '<p class="muted">暂无计划</p>'}</section></aside></div>`;
}
function renderArchive() {
  const { reports, encounters } = state.summary;
  const filteredReports = reports.filter(row => [row.title, row.hospital, row.date].join(' ').includes(state.search));
  const controls = `<div class="timeline-controls"><select id="timeline-type" class="inline-select" aria-label="筛选事件类型"><option value="">全部类型</option>${eventTypes.map(type => `<option ${type === state.timelineType ? 'selected' : ''}>${type}</option>`).join('')}</select><select id="timeline-order" class="inline-select" aria-label="时间线排序"><option value="desc" ${state.timelineOrder === 'desc' ? 'selected' : ''}>从近到远</option><option value="asc" ${state.timelineOrder === 'asc' ? 'selected' : ''}>从远到近</option></select><span class="muted">按实际发生日期排列，支持补记历史</span></div>`;
  return `<div class="toolbar"><div class="tabs">${[['records', '健康时间线'], ['reports', '报告存档'], ['trends', '指标趋势']].map(([key, label]) => `<button data-action="archive-tab" data-tab="${key}" class="${state.archive === key ? 'active' : ''}">${label}</button>`).join('')}</div>${state.archive !== 'trends' ? `<input class="search" id="search" placeholder="搜索标题、标签、内容或日期" aria-label="搜索档案" value="${esc(state.search)}">` : ''}</div>
    <section class="card">${state.archive === 'records' ? `<div class="card-title"><h2>我的健康时间线 <span class="sub-count">${encounters.length} 条记录</span></h2>${button('new-encounter', icon('plus') + ' 添加时间线')}</div>${controls}${timeline(encounters)}` : state.archive === 'reports' ? `<div class="card-title"><h2>报告存档</h2><button class="text-btn" data-action="compare">报告对比 →</button></div>${reportRows(filteredReports)}` : `<div class="card-title"><h2>指标历史</h2><select class="inline-select" id="metric-picker" aria-label="选择指标">${metricOptions(state.metric)}</select></div>${chart()}<div class="table-wrap"><table><thead><tr><th>检验日期</th><th>结果</th><th>该次参考范围</th><th>来源</th></tr></thead><tbody>${(state.comparison?.points || []).map(point => `<tr><td>${point.date}</td><td>${esc(point.value)} ${esc(point.unit)}</td><td>${esc(point.reference || '未填写')}</td><td><button class="text-btn" data-action="view-report" data-id="${point.reportId}">${esc(point.title)}</button></td></tr>`).join('')}</tbody></table></div>`}</section>`;
}
function renderMembers() {
  return `<div class="member-grid">${state.patients.map(person => `<section class="card member-card"><span class="avatar">${esc(person.name.slice(0, 1))}</span><div class="content"><h3>${esc(person.name)} <span class="tag">${esc(person.relation)}</span></h3><p>出生日期：${person.birthday || '未填写'}</p><p>过敏史：${esc(person.allergies || '未填写')}</p><p>既往史：${esc(person.history || '未填写')}</p><div class="buttons">${button('edit-patients', '编辑档案', `data-id="${person.id}"`, 'light')}<a class="btn outline" href="/api/patients/${person.id}/export">导出资料</a><button class="text-btn" data-action="delete-patient" data-id="${person.id}">删除</button></div></div></section>`).join('')}<section class="card">${empty('users', '也为家人留一份关心', '每位成员的记录、日历与报告独立保存。', 'new-patient', '添加家庭成员')}</section></div><p class="hint" style="margin-top:22px">本地版仅供这台电脑的使用者访问。账号邀请、微信登录、云端同步和自动备份尚未接入。数据保存在项目 .data 目录，可导出含原件的 ZIP 资料包。</p>`;
}
function render() {
  const titles = { home: ['YOUR HEALTH, ONE DAY AT A TIME', '把健康，记在心上。', '每一次记录，都是对自己和家人的照顾。'], calendar: ['A LITTLE CARE, EVERY DAY', '把关心，安排进日常。', '记下复诊与用药，让重要的事情有迹可循。'], archive: ['YOUR HEALTH STORY', '每一份记录，都有来处。', '就诊、报告与指标，串起属于你的健康时间线。'], members: ['CARE FOR THE ONES YOU LOVE', '家人的健康，一起照顾。', '一人一份档案，让关心更有条理。'] };
  const title = titles[state.page];
  const hasPatient = !!patient();
  const mainAction = state.page === 'members' || !hasPatient ? 'new-patient' : state.page === 'calendar' ? 'new-task' : state.page === 'archive' && state.archive !== 'records' ? 'new-report' : 'new-encounter';
  const mainLabel = { 'new-patient': '添加成员', 'new-task': '添加事项', 'new-report': '新增报告', 'new-encounter': '添加时间线' }[mainAction];
  $('#app').innerHTML = `<div class="shell"><aside class="sidebar"><div class="brand"><span class="brand-mark">${icon('leaf')}</span><div>愈之路<small>HEALTH JOURNEY</small></div></div><nav class="nav" aria-label="主导航">${[['home', 'home', '健康首页'], ['calendar', 'calendar', '健康日历'], ['archive', 'folder', '健康档案'], ['members', 'users', '我的家庭']].map(([page, symbol, label]) => `<button data-action="page" data-page="${page}" class="${state.page === page ? 'active' : ''}">${icon(symbol)}<span>${label}</span></button>`).join('')}</nav><div class="sidebar-note"><div class="leaf">✳</div><strong>健康，是日常的小事。</strong><br>慢慢记录，好好生活。<br><br>LOCAL EDITION · 0.1</div></aside><main class="main"><header class="topbar"><div class="crumb">${state.page === 'home' ? '我的健康空间' : '我的健康空间 / ' + { calendar: '日历', archive: '档案', members: '家庭' }[state.page]}</div><div class="top-right"><span class="local">本地开发版</span><div class="member-select"><span class="avatar">${esc(patient()?.name.slice(0, 1) || '家')}</span>${state.patients.length ? `<select id="patient-picker" aria-label="当前家庭成员">${state.patients.map(person => `<option value="${person.id}" ${person.id === state.patientId ? 'selected' : ''}>${esc(person.name)} · ${esc(person.relation)}</option>`).join('')}</select>` : '<button class="text-btn" data-action="new-patient">建立档案</button>'}</div></div></header><div class="greeting"><div><p class="eyebrow">${title[0]}</p><h1>${title[1]}</h1><p class="subtitle">${hasPatient ? esc(patient().name) + ' · ' : ''}${title[2]}</p></div>${button(mainAction, `${icon('plus')} ${mainLabel}`)}</div>${!hasPatient && state.page !== 'members' ? `<section class="card hero"><div class="hero-copy"><h2>从一份属于你的档案开始。</h2><p>为自己或家人建立档案，<br>把报告、就诊和下一次复查放在一起。</p>${button('new-patient', `${icon('plus')} 建立第一份档案`)}</div>${illustration}</section><section class="card" style="margin-top:22px">${empty('leaf', '欢迎来到愈之路', '目前还没有健康资料。添加成员后，就可以开始记录。', '', '', true)}</section>` : ({ home: renderHome, calendar: renderCalendar, archive: renderArchive, members: renderMembers }[state.page])()}<div class="footer-note">${icon('lock')} 资料保存在本机 · 未上传至云端 · 仅作个人健康记录</div></main></div>`;
}
const field = (label, name, value = '', type = 'text', full = false, required = false) => `<label class="field ${full ? 'full' : ''}">${label}${required ? ' *' : ''}${type === 'textarea' ? `<textarea name="${name}" maxlength="4000">${esc(value)}</textarea>` : `<input type="${type}" name="${name}" value="${esc(value)}" ${required ? 'required' : ''} ${type === 'text' ? 'maxlength="200"' : ''}>`}</label>`;
const selectField = (label, name, options, value, full = false) => `<label class="field ${full ? 'full' : ''}">${label}<select name="${name}">${options.map(option => { const [key, text] = Array.isArray(option) ? option : [option, option]; return `<option value="${esc(key)}" ${key === value ? 'selected' : ''}>${esc(text)}</option>`; }).join('')}</select></label>`;
function openDialog(title, subtitle, content) { const dialog = $('#editor'); dialog.innerHTML = `<div class="dialog-heading"><div><h2 id="dialog-title">${esc(title)}</h2><p class="muted">${esc(subtitle)}</p></div><button class="close" data-action="close" aria-label="关闭">×</button></div>${content}<div class="error" role="alert"></div>`; if (!dialog.open) dialog.showModal(); }
function observationRow(row = {}) {
  const metric = state.metrics.find(metric => metric.id === row.metricId) || state.metrics[0];
  return `<div class="observation"><select name="metricId" aria-label="指标名称">${metricOptions(metric.id)}</select><input name="value" placeholder="结果或原文" aria-label="指标结果" value="${esc(row.value)}" required><select name="unit" aria-label="单位">${metric.units.map(unit => `<option ${unit === row.unit ? 'selected' : ''}>${esc(unit)}</option>`).join('')}</select><input name="reference" placeholder="参考范围" aria-label="参考范围" value="${esc(row.reference)}"><select name="flag" aria-label="原报告异常标记">${[['', '未标记'], ['H', '↑ 高'], ['L', '↓ 低'], ['异常', '异常']].map(([value, label]) => `<option value="${value}" ${row.flag === value ? 'selected' : ''}>${label}</option>`).join('')}</select><button type="button" data-action="remove-observation" aria-label="移除指标">×</button></div>`;
}
function edit(kind, id = '') {
  if (kind !== 'patients' && !patient()) return edit('patients');
  const data = kind === 'patients' ? state.patients.find(item => item.id === id) || {} : state.summary[kind].find(item => item.id === id) || {};
  const names = { patients: '家庭成员', encounters: '时间线记录', reports: '报告', tasks: '日历事项' };
  let fields = '';
  const encounters = [['', '暂不关联'], ...state.summary.encounters.map(record => [record.id, `${record.date} ${record.title}`])];
  if (kind === 'patients') fields = `${field('称呼', 'name', data.name, 'text', false, true)}${selectField('与我的关系', 'relation', ['本人', '父亲', '母亲', '配偶', '子女', '其他家人'], data.relation || '本人')}${field('出生日期（可不填）', 'birthday', data.birthday, 'date')}${field('过敏史', 'allergies', data.allergies, 'textarea', true)}${field('既往史 / 手术史 / 当前用药', 'history', data.history, 'textarea', true)}`;
  if (kind === 'encounters') fields = `${field('事件标题', 'title', data.title, 'text', true, true)}${field('发生日期', 'date', data.date || today(), 'date', false, true)}${selectField('事件类型', 'eventType', eventTypes, data.eventType || (id ? '就诊' : '复诊'))}<div class="date-shortcuts field full"><span>快速选择日期</span><div>${datePresets().map(preset => `<button type="button" data-action="timeline-preset" data-date="${preset.date}">${preset.label}</button>`).join('')}</div><small>按自然月回溯；所选月份无对应日期时使用该月最后一天。保存的是上方具体日期。</small></div>${field('健康标签（选填）', 'topic', data.topic, 'text', true)}${field('记录内容（选填）', 'note', data.note, 'textarea', true)}<details class="field full visit-details" ${[data.hospital, data.department, data.symptoms, data.diagnosis, data.advice].some(Boolean) ? 'open' : ''}><summary>补充就诊信息（选填）</summary><div class="form-grid">${field('医院', 'hospital', data.hospital)}${field('科室', 'department', data.department)}${field('症状与就诊原因', 'symptoms', data.symptoms, 'textarea', true)}${field('诊断摘录', 'diagnosis', data.diagnosis, 'textarea', true)}${field('医生建议', 'advice', data.advice, 'textarea', true)}</div></details>`;

  if (kind === 'tasks') fields = `${field('事项名称', 'title', data.title, 'text', true, true)}${selectField('事项类型', 'type', ['复诊', '检查', '用药', '待办'], data.type || '复诊')}${field('开始日期', 'date', data.date || state.date, 'date', false, true)}${field('时间（不填为全天）', 'time', data.time, 'time')}${selectField('重复方式', 'repeat', [['none', '仅一次'], ['daily', '每天'], ['weekly', '每周']], data.repeat || 'none')}${field('结束日期（可不填）', 'endDate', data.endDate, 'date')}${selectField('关联就诊', 'encounterId', encounters, data.encounterId || '')}${field('备注 / 处方中记载的用法', 'note', data.note, 'textarea', true)}`;
  if (kind === 'reports') fields = `${field('报告名称', 'title', data.title, 'text', true, true)}${field('采样/检验日期；未知时填报告日期', 'date', data.date || today(), 'date', false, true)}${selectField('报告分类', 'kind', ['检验', '影像', '病理', '处方', '其他'], data.kind || '检验')}${field('医院', 'hospital', data.hospital)}${selectField('关联就诊', 'encounterId', encounters, data.encounterId || '')}${field('标本（按原件填写，如血清）', 'specimen', data.specimen)}${field('检测方法（按原件填写）', 'method', data.method)}${field('备注 / 原文摘录', 'note', data.note, 'textarea', true)}`;
  openDialog(`${id ? '编辑' : '新增'}${names[kind]}`, kind === 'patients' ? '每位家人的健康资料独立保存' : `当前成员：${patient().name}`, `<form id="record-form" data-kind="${kind}" data-id="${id}" data-version="${data.version || ''}" data-patient="${state.patientId}"><div class="form-grid">${fields}</div>${kind === 'reports' ? `<div class="observations"><div class="card-title"><h2>检验指标</h2><button class="text-btn" type="button" data-action="add-observation">＋ 添加指标</button></div><p class="muted">按原件录入；结果可填“＜0.01”或文字。未知的方法和标本留空，不要猜测。</p><div id="observation-rows">${(data.observations || []).map(observationRow).join('')}</div><label class="consent"><input type="checkbox" name="confirmed" ${data.status === 'confirmed' ? 'checked' : ''}>我已逐项核对日期、数值、单位和参考范围，允许这些结果进入正式对比。</label><p class="hint">保存后可上传 JPG、PNG、PDF 原件。OCR 尚未接入，当前使用手动录入。</p></div>` : ''}${kind === 'patients' ? `<label class="consent"><input type="checkbox" name="consent" required ${data.consent ? 'checked' : ''}>这是我的档案，或我已获得合法授权 / 具有监护权，可以管理该成员的健康资料。</label>` : ''}${kind === 'tasks' ? '<p class="hint">本地版不会发送手机提醒。已有执行记录的计划不能改动时间规则，可新建后续计划。</p>' : ''}<div class="form-actions">${id && kind !== 'patients' ? button('delete-record', '删除记录', `type="button" data-kind="${kind}" data-id="${id}"`, 'danger') : ''}<button type="button" class="btn outline" data-action="close">取消</button><button type="submit" class="btn">保存${kind === 'reports' ? '报告' : ''}</button></div></form>`);
}
async function viewReport(id) {
  const report = await api(`${base()}/reports/${id}`);
  openDialog(report.title, `${patient().name} · ${report.date} · ${report.hospital || '医院未填写'}`, `<div class="badge-list"><span class="tag">${report.kind}</span><span class="tag ${report.status === 'pending' ? 'amber' : ''}">${report.status === 'pending' ? '待核对' : '已核对'}</span><span class="tag">修订 ${report.version}</span></div><div class="details"><div class="detail-section"><strong>标本 / 方法</strong>${esc(report.specimen || '未填写')} / ${esc(report.method || '未填写')}</div>${report.note ? `<div class="detail-section"><strong>备注 / 原文摘录</strong>${esc(report.note)}</div>` : ''}${report.encounterId ? `<button class="text-btn" data-action="view-encounter" data-id="${report.encounterId}">查看关联就诊 →</button>` : ''}</div>${report.observations.length ? `<div class="table-wrap"><table><thead><tr><th>指标</th><th>结果</th><th>参考范围</th></tr></thead><tbody>${report.observations.map(row => `<tr><td>${esc(row.name)}</td><td>${esc(row.value)} ${esc(row.unit)} ${esc(row.flag)}</td><td>${esc(row.reference || '未填写')}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">尚未录入检验指标</p>'}<h3 class="section-heading">报告原件 · ${report.files.length} 份</h3><div class="originals">${report.files.map(file => `<a class="file-card" href="/api/files/${file.id}" target="_blank" rel="noopener">${file.type.startsWith('image/') ? `<img src="/api/files/${file.id}" alt="${esc(file.name)}">` : icon('report')}${esc(file.name)}<small>${(file.size / 1024).toFixed(0)} KB · 点击查看原件</small></a>`).join('')}</div><label class="field" style="margin-top:20px">添加原件（每份不超过 15 MB）<input type="file" id="report-upload" class="file-input" accept=".jpg,.jpeg,.png,.pdf" multiple data-id="${id}"></label><div class="detail-actions">${button('edit-reports', '编辑与核对', `data-id="${id}"`, 'light')}${button('compare', '对比历史报告', '', 'outline')}</div>`);
}
function viewEncounter(id) {
  const record = state.summary.encounters.find(record => record.id === id); if (!record) throw new Error('就诊记录不存在');
  openDialog(record.title, `${patient().name} · ${record.date} · ${[record.hospital, record.department].filter(Boolean).join(' / ')}`, `<div class="details">${[['记录内容', record.note], ['健康标签', record.topic], ['事件类型', record.eventType || '就诊'], ['症状与原因', record.symptoms], ['诊断摘录', record.diagnosis], ['医生建议', record.advice]].map(([label, value]) => `<div class="detail-section"><strong>${label}</strong>${esc(value || '未填写')}</div>`).join('')}</div><h3 class="section-heading">关联报告</h3>${reportRows(state.summary.reports.filter(report => report.encounterId === id))}<div class="detail-actions">${button('edit-encounters', '编辑时间线记录', `data-id="${id}"`, 'light')}</div>`);
}
function compare(ids) {
  const reports = state.summary.reports;
  const selected = ids || reports.slice(0, 2).map(report => report.id);
  const chosen = reports.filter(report => selected.includes(report.id)).sort((a, b) => a.date.localeCompare(b.date));
  const metricIds = [...new Set(chosen.flatMap(report => report.observations.map(row => row.metricId)))];
  const heading = `<p class="hint">选择 2～5 份同一成员的报告。此处逐项显示原始结果；待核对资料不参与数值计算。不同单位不自动换算。</p><div class="compare-select">${reports.map(report => `<label><input type="checkbox" class="compare-check" value="${report.id}" ${selected.includes(report.id) ? 'checked' : ''}>${report.date} ${esc(report.title)}${report.status === 'pending' ? '（待核对）' : ''}</label>`).join('')}</div>`;
  openDialog('报告对比', `当前成员：${patient()?.name || ''}`, `${heading}${chosen.length < 2 ? empty('report', '至少选择两份报告', '可以对照检验指标，也可以查看两份报告的原件。') : `<div class="table-wrap"><table><thead><tr><th class="metric-cell">指标 / 来源</th>${chosen.map(report => `<th>${report.date}<small>${esc(report.hospital || report.title)}</small></th>`).join('')}</tr></thead><tbody>${metricIds.map(id => `<tr><td class="metric-cell">${esc(state.metrics.find(metric => metric.id === id)?.name || id)}</td>${chosen.map(report => { const row = report.observations.find(row => row.metricId === id); return `<td>${row ? `${esc(row.value)} ${esc(row.unit)} ${esc(row.flag)}<small>参考：${esc(row.reference || '未填写')}</small>` : '未检测 / 未录入'}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div><h3 class="section-heading">原件对照</h3><div class="originals">${chosen.slice(0, 2).map(report => `<section><p class="muted">${report.date} · ${esc(report.title)}</p>${report.files.map(file => `<div class="file-card">${file.type.startsWith('image/') ? `<img src="/api/files/${file.id}" alt="${esc(file.name)}">` : `<iframe src="/api/files/${file.id}" title="${esc(file.name)}"></iframe>`}<a href="/api/files/${file.id}" target="_blank" rel="noopener">打开 ${esc(file.name)}</a></div>`).join('') || '<p class="muted">暂无原件</p>'}</section>`).join('')}</div>`}`);
}
document.addEventListener('click', async event => {
  const element = event.target.closest('[data-action]'); if (!element) return;
  const { action, id } = element.dataset;
  try {
    if (action === 'close') return $('#editor').close();
    if (action === 'page') { state.page = element.dataset.page; if (state.page === 'home') state.date = today(); return await refresh(); }
    if (action === 'new-patient') return edit('patients');
    if (action === 'new-report') return edit('reports');
    if (action === 'new-encounter') return edit('encounters');
    if (action === 'open-timeline') { state.page = 'archive'; state.archive = 'records'; state.search = ''; return render(); }
    if (action === 'timeline-preset') { $('#record-form [name="date"]').value = element.dataset.date; return; }
    if (action === 'new-task') return edit('tasks');
    if (action.startsWith('edit-')) return edit(action.slice(5), id);
    if (action === 'view-report') return await viewReport(id);
    if (action === 'view-encounter') return viewEncounter(id);
    if (action === 'compare') return compare();
    if (action === 'archive-tab') { state.archive = element.dataset.tab; state.search = ''; return render(); }
    if (action === 'calendar-mode') { state.calendarMode = element.dataset.mode; return render(); }
    if (action === 'date') { state.date = element.dataset.date; return await refresh(); }
    if (action === 'shift-date') {
      const amount = Number(element.dataset.shift);
      if (state.calendarMode === 'week') state.date = shift(state.date, amount * 7);
      else { const date = new Date(`${state.date.slice(0, 7)}-01T00:00:00Z`); date.setUTCMonth(date.getUTCMonth() + amount); state.date = date.toISOString().slice(0, 10); }
      return await refresh();
    }
    if (action === 'toggle-task' || action === 'skip-task') {
      const task = state.tasks.find(task => task.id === id); const status = action === 'toggle-task' ? task.status === 'done' ? 'pending' : 'done' : task.status === 'skipped' ? 'pending' : 'skipped';
      element.disabled = true; await api(`${base()}/tasks/${id}/occurrence`, { method: 'PUT', body: { date: state.date, status } }); return await refresh();
    }
    if (action === 'add-observation') return $('#observation-rows').insertAdjacentHTML('beforeend', observationRow());
    if (action === 'remove-observation') return element.closest('.observation').remove();
    if (action === 'delete-record') {
      if (!confirm('删除这条记录及其原件？此操作不能撤销；已导出的副本不受影响。')) return;
      await api(`${base()}/${element.dataset.kind}/${id}`, { method: 'DELETE' }); $('#editor').close(); await refresh(); return toast('记录已删除');
    }
    if (action === 'delete-patient') {
      const person = state.patients.find(item => item.id === id);
      if (!confirm(`永久删除“${person.name}”的档案、报告原件、就诊和日历记录？已导出的副本不受影响。`)) return;
      await api(`/patients/${id}`, { method: 'DELETE' }); await refresh(); return toast('该成员的本地资料已删除');
    }
  } catch (error) { fail(error); element.disabled = false; }
});
document.addEventListener('change', async event => {
  const element = event.target;
  try {
    if (element.id === 'patient-picker') { state.patientId = element.value; state.search = ''; state.timelineType = '';  return await refresh(); }
    if (element.id === 'timeline-type') { state.timelineType = element.value; return render(); }
    if (element.id === 'timeline-order') { state.timelineOrder = element.value; return render(); }
    if (element.id === 'metric-picker') { state.metric = element.value; return await refresh(); }
    if (element.name === 'metricId') { const metric = state.metrics.find(metric => metric.id === element.value); element.closest('.observation').querySelector('[name="unit"]').innerHTML = metric.units.map(unit => `<option>${esc(unit)}</option>`).join(''); }
    if (element.classList.contains('compare-check')) {
      const ids = [...document.querySelectorAll('.compare-check:checked')].map(item => item.value);
      if (ids.length > 5) { element.checked = false; return toast('最多选择 5 份报告'); } return compare(ids);
    }
    if (element.id === 'report-upload') {
      const files = [...element.files], target = `${base()}/reports/${element.dataset.id}/files`; element.disabled = true;
      let count = 0; const errors = [];
      for (const file of files) {
        try { if (file.size > 15 * 1024 * 1024) throw new Error('超过 15 MB'); await api(target, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) }, body: await file.arrayBuffer() }); count++; }
        catch (error) { errors.push(`${file.name}：${error.message}`); }
      }
      await refresh(); await viewReport(element.dataset.id); toast(`已上传 ${count} 份原件`);
      if (errors.length) fail(new Error(errors.join('；')));
    }
  } catch (error) { fail(error); element.disabled = false; }
});
function handleSearchInput(event) {
  if (event.target.id === 'search' && !event.isComposing) {
    const position = event.target.selectionStart; state.search = event.target.value; render(); const search = $('#search'); search.focus(); search.setSelectionRange(position, position);
  }
}
document.addEventListener('input', handleSearchInput);
document.addEventListener('compositionend', handleSearchInput);
document.addEventListener('submit', async event => {
  if (event.target.id !== 'record-form') return;
  event.preventDefault(); const form = event.target, submit = form.querySelector('[type="submit"]'); submit.disabled = true;
  const { kind, id, version, patient: patientId } = form.dataset;
  try {
    const body = Object.fromEntries(new FormData(form));
    if (version) body.version = Number(version);
    if (kind === 'patients') body.consent = !!form.querySelector('[name="consent"]').checked;
    if (kind === 'reports') {
      body.status = form.querySelector('[name="confirmed"]').checked ? 'confirmed' : 'pending';
      body.observations = [...form.querySelectorAll('.observation')].map(row => Object.fromEntries([...row.querySelectorAll('[name]')].map(input => [input.name, input.value])));
    }
    const path = kind === 'patients' ? `/patients${id ? '/' + id : ''}` : `/patients/${patientId}/${kind}${id ? '/' + id : ''}`;
    const saved = await api(path, { method: id ? 'PUT' : 'POST', body });
    if (kind === 'patients' && !id) state.patientId = saved.id;
    $('#editor').close(); await refresh(); toast('已保存到本机');
    if (kind === 'encounters') { state.page = 'archive'; state.archive = 'records'; state.search = ''; state.timelineType = ''; render(); }
    if (kind === 'reports') await viewReport(saved.id);
  } catch (error) { fail(error); submit.disabled = false; }
});
async function start() {
  try { const response = await fetch('/api/session'); if (!response.ok) throw new Error('无法建立本地会话'); const session = await response.json(); token = session.token; state.metrics = session.metrics; await refresh(); }
  catch (error) { $('#app').innerHTML = `<div class="loading">${esc(error.message)}<p>请确认本地服务已启动，然后刷新页面。</p></div>`; }
}
start();
