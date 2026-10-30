import { request, base, metrics, notify, today, confirm, setPatient, patientId } from '../../utils/api';
import { eventTypes, datePresets } from '../../utils/timeline';
const labels: any = { patients: '家庭成员', encounters: '时间线记录', reports: '报告', tasks: '日历事项' };
Page({
  data: { kind: '', id: '', memberName: '', fields: [], metrics: [], observations: [], confirmed: false, consent: false, saving: false, version: 0, dateOptions: [], showVisitDetails: false },
  async onLoad(options: any) {
    try {
      const kind = options.kind, id = options.id || ''; if (!labels[kind]) throw new Error('记录类型不存在');
      this.kind = kind; this.id = id; this.patient = patientId();
      const patients = await request('/patients'); const selected = patients.find((person: any) => person.id === this.patient);
      const data = id ? await request(kind === 'patients' ? '/patients' : base() + '/' + kind + '/' + id) : {};
      this.record = kind === 'patients' && id ? data.find((person: any) => person.id === id) : data;
      const record = this.record;
      const encounters = kind === 'reports' || kind === 'tasks' ? await request(base() + '/encounters') : [];
      const fields: any[] = [];
      const field = (name: string, label: string, type = 'text', fallback: any = '', options: any[] = []) => {
        const value = record[name] ?? fallback;
        fields.push({ name, label, type, value, optionalVisit: kind === 'encounters' && ['hospital', 'department', 'symptoms', 'diagnosis', 'advice'].includes(name), options: options.map(option => Array.isArray(option) ? { value: option[0], label: option[1] } : { value: option, label: option }), selected: Math.max(0, options.findIndex(option => (Array.isArray(option) ? option[0] : option) === value)) });
      };
      if (kind === 'patients') {
        field('name', '称呼 *'); field('relation', '与我的关系', 'select', '本人', ['本人', '父亲', '母亲', '配偶', '子女', '其他家人']);
        field('birthday', '出生日期（可不填）', 'date'); field('allergies', '过敏史', 'textarea'); field('history', '既往史 / 手术史 / 当前用药', 'textarea');
      } else {
        field('title', kind === 'encounters' ? '事件标题 *' : labels[kind] + '名称 *'); field('date', kind === 'reports' ? '检验日期；未知时填写报告日期 *' : kind === 'encounters' ? '发生日期 *' : '日期 *', 'date', today());
        if (kind === 'encounters') { field('eventType', '事件类型', 'select', id ? '就诊' : '复诊', eventTypes); field('topic', '健康标签（选填）'); field('note', '记录内容（选填）', 'textarea'); }
        if (kind === 'encounters' || kind === 'reports') field('hospital', '医院');
        if (kind === 'encounters') { field('department', '科室'); field('symptoms', '症状和就诊原因', 'textarea'); field('diagnosis', '诊断摘录', 'textarea'); field('advice', '医生建议', 'textarea'); }
        if (kind === 'reports') { field('kind', '报告分类', 'select', '检验', ['检验', '影像', '病理', '处方', '其他']); field('specimen', '标本（按原件填写）'); field('method', '检测方法（按原件填写）'); }
        if (kind === 'tasks') { field('type', '事项类型', 'select', '复诊', ['复诊', '检查', '用药', '待办']); field('time', '时间（不填为全天）', 'time'); field('repeat', '重复', 'select', 'none', [['none', '仅一次'], ['daily', '每天'], ['weekly', '每周']]); field('endDate', '结束日期（可不填）', 'date'); }
        if (kind === 'reports' || kind === 'tasks') { field('encounterId', '关联就诊', 'select', '', [['', '暂不关联'], ...encounters.map((item: any) => [item.id, item.date + ' ' + item.title])]); field('note', '备注 / 原文摘录', 'textarea'); }
      }
      wx.setNavigationBarTitle({ title: (id ? '编辑' : '新增') + labels[kind] });
      this.setData({ kind, id, memberName: selected?.name || '', fields, metrics, dateOptions: datePresets(), showVisitDetails: fields.some(field => field.optionalVisit && field.value), version: record.version || 0, consent: !!record.consent, confirmed: record.status === 'confirmed', observations: (record.observations || []).map((row: any) => this.decorate(row)) });
    } catch (error) { notify(error); }
  },
  decorate(row: any) { const metricIndex = Math.max(0, metrics.findIndex(metric => metric.id === row.metricId)); const metric = metrics[metricIndex]; return { ...row, key: row.key || 'observation-' + Date.now() + '-' + Math.random().toString(36).slice(2), metricId: metric.id, metricIndex, units: metric.units, unit: row.unit || metric.unit, unitIndex: Math.max(0, metric.units.indexOf(row.unit)), flag: row.flag || '', flagIndex: ['', 'H', 'L', '异常'].indexOf(row.flag || ''), flags: ['未标记', '↑ 高', '↓ 低', '异常'] }; },
  updateField(event: any) {
    const index = Number(event.currentTarget.dataset.index), fields = this.data.fields.slice(), field = { ...fields[index] };
    if (field.type === 'select') { field.selected = Number(event.detail.value); field.value = field.options[field.selected].value; } else field.value = event.detail.value;
    fields[index] = field; this.setData({ fields });
  },
  clearField(event: any) { const fields = this.data.fields.slice(); fields[Number(event.currentTarget.dataset.index)].value = ''; this.setData({ fields }); },
  pickTimelineDate(event: any) { this.setData({ fields: this.data.fields.map((field: any) => field.name === 'date' ? { ...field, value: event.currentTarget.dataset.date } : field) }); },
  toggleVisitDetails() { this.setData({ showVisitDetails: !this.data.showVisitDetails }); },
  toggleConfirmed(event: any) { this.setData({ confirmed: event.detail.value.length > 0 }); },
  toggleConsent(event: any) { this.setData({ consent: event.detail.value.length > 0 }); },
  addObservation() { this.setData({ observations: [...this.data.observations, this.decorate({ metricId: metrics[0].id, value: '', reference: '' })] }); },
  removeObservation(event: any) { this.setData({ observations: this.data.observations.filter((_: any, index: number) => index !== Number(event.currentTarget.dataset.index)) }); },
  updateObservation(event: any) {
    const index = Number(event.currentTarget.dataset.index), key = event.currentTarget.dataset.key, rows = this.data.observations.slice(); let row = { ...rows[index] };
    if (key === 'metric') row = this.decorate({ ...row, metricId: metrics[Number(event.detail.value)].id, unit: metrics[Number(event.detail.value)].unit });
    else if (key === 'unit') { row.unitIndex = Number(event.detail.value); row.unit = row.units[row.unitIndex]; }
    else if (key === 'flag') { row.flagIndex = Number(event.detail.value); row.flag = ['', 'H', 'L', '异常'][row.flagIndex]; }
    else row[key] = event.detail.value;
    rows[index] = row; this.setData({ observations: rows });
  },
  async save() {
    if (this.data.saving) return; this.setData({ saving: true });
    try {
      const body: any = Object.fromEntries(this.data.fields.map((field: any) => [field.name, field.value]));
      if (this.data.version) body.version = this.data.version;
      if (this.kind === 'patients') body.consent = this.data.consent;
      if (this.kind === 'reports') { body.status = this.data.confirmed ? 'confirmed' : 'pending'; body.observations = this.data.observations.map((row: any) => ({ metricId: row.metricId, value: row.value, unit: row.unit, reference: row.reference, flag: row.flag })); }
      const path = this.kind === 'patients' ? '/patients' : '/patients/' + this.patient + '/' + this.kind;
      const saved = await request(path + (this.id ? '/' + this.id : ''), this.id ? 'PUT' : 'POST', body);
      if (this.kind === 'patients' && !this.id) setPatient(saved.id);
      if (this.kind === 'encounters') wx.setStorageSync('openTimeline', true);
      wx.showToast({ title: '已保存到本机', icon: 'success' });
      if (this.kind === 'reports' && !this.id) wx.redirectTo({ url: '/pages/report/report?id=' + saved.id }); else wx.navigateBack();
    } catch (error) { notify(error); } finally { this.setData({ saving: false }); }
  },
  async remove() { try { if (await confirm('永久删除这条记录及原件？操作不能撤销。')) { await request('/patients/' + this.patient + '/' + this.kind + '/' + this.id, 'DELETE'); wx.navigateBack(); } } catch (error) { notify(error); } }
});
