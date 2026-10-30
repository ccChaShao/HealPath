import { request, base, today, metrics, notify, setPatient, patientId, confirm } from '../../utils/api';
import { eventTypes, timelineGroups } from '../../utils/timeline';
Page({
  data: { page: 'home', archive: 'records', date: today(), patients: [], patient: null, patientIndex: 0, summary: { encounters: [], reports: [], tasks: [] }, tasks: [], metrics: [], metricIndex: 0, trend: null, loading: true, week: [], timeline: [], recentTimeline: [], timelineSearch: '', timelineTypeIndex: 0, timelineSortIndex: 0, timelineTypes: ['全部类型', ...eventTypes], timelineSorts: ['从近到远', '从远到近'] },
  onShow() { if (wx.getStorageSync('openTimeline')) { wx.removeStorageSync('openTimeline'); this.setData({ page: 'archive', archive: 'records', timelineSearch: '', timelineTypeIndex: 0 }); } this.refresh(); },
  async refresh() {
    const sequence = (this.sequence || 0) + 1; this.sequence = sequence;
    try {
      const patients = await request('/patients');
      if (this.sequence !== sequence) return;
      let id = patientId(); if (!patients.some((person: any) => person.id === id)) { id = patients[0]?.id || ''; setPatient(id); }
      const selected = patients.find((person: any) => person.id === id);
      this.setData({ patients, patient: selected || null, patientIndex: Math.max(0, patients.findIndex((person: any) => person.id === id)), metrics });
      if (id) {
        const path = base(), date = this.data.date;
        const [summary, tasks, trend] = await Promise.all([request(path + '/summary'), request(path + '/calendar?date=' + date), request(path + '/comparison?metric=' + metrics[this.data.metricIndex].id)]);
        if (this.sequence !== sequence) return;
        this.setData({ summary, tasks, trend });
      } else this.setData({ summary: { encounters: [], reports: [], tasks: [] }, tasks: [], trend: null });
      this.makeWeek();
      this.buildTimeline();
    } catch (error) { notify(error); }
    finally { this.setData({ loading: false }); }
  },
  makeWeek() {
    const time = Date.parse(this.data.date + 'T00:00:00Z'), offset = (new Date(time).getUTCDay() + 6) % 7;
    this.setData({ week: Array.from({ length: 7 }, (_, index) => { const date = new Date(time + (index - offset) * 86400000).toISOString().slice(0, 10); return { date, day: Number(date.slice(-2)), label: '一二三四五六日'[index] }; }) });
  },
  buildTimeline() { this.setData({ timeline: timelineGroups(this.data.summary.encounters, { query: this.data.timelineSearch, type: this.data.timelineTypeIndex ? this.data.timelineTypes[this.data.timelineTypeIndex] : '', order: this.data.timelineSortIndex ? 'asc' : 'desc' }), recentTimeline: timelineGroups(this.data.summary.encounters, { limit: 3 }) }); },
  timelineQuery(event: any) { this.setData({ timelineSearch: event.detail.value }); this.buildTimeline(); },
  timelineFilter(event: any) { this.setData({ [event.currentTarget.dataset.field]: Number(event.detail.value) }); this.buildTimeline(); },
  openTimeline() { this.setData({ page: 'archive', archive: 'records', timelineSearch: '', timelineTypeIndex: 0 }); this.buildTimeline(); },
  changePatient(event: any) { setPatient(this.data.patients[Number(event.detail.value)].id); this.setData({ timelineSearch: '', timelineTypeIndex: 0 }); this.refresh(); },
  changePage(event: any) { const page = event.currentTarget.dataset.page; this.setData({ page, ...(page === 'home' ? { date: today() } : {}) }); this.refresh(); },
  changeArchive(event: any) { this.setData({ archive: event.currentTarget.dataset.tab }); },
  changeDate(event: any) { this.setData({ date: event.detail.value || event.currentTarget.dataset.date }); this.refresh(); },
  shiftDate(event: any) { const date = new Date(Date.parse(this.data.date + 'T00:00:00Z') + Number(event.currentTarget.dataset.amount) * 7 * 86400000).toISOString().slice(0, 10); this.setData({ date }); this.refresh(); },
  changeMetric(event: any) { this.setData({ metricIndex: Number(event.detail.value) }); this.refresh(); },
  edit(event: any) { const kind = event.currentTarget.dataset.kind || 'reports'; if (kind !== 'patients' && !this.data.patient) return wx.navigateTo({ url: '/pages/editor/editor?kind=patients' }); wx.navigateTo({ url: '/pages/editor/editor?kind=' + kind + '&id=' + (event.currentTarget.dataset.id || '') }); },
  add() { wx.showActionSheet({ itemList: ['添加时间线', '上传报告', '添加日历事项', '添加家庭成员'], success: (result: any) => this.edit({ currentTarget: { dataset: { kind: ['encounters', 'reports', 'tasks', 'patients'][result.tapIndex] } } }) }); },
  viewReport(event: any) { wx.navigateTo({ url: '/pages/report/report?id=' + event.currentTarget.dataset.id }); },
  compare() { wx.navigateTo({ url: '/pages/compare/compare' }); },
  async toggle(event: any) {
    try { const task = this.data.tasks.find((item: any) => item.id === event.currentTarget.dataset.id); const status = event.currentTarget.dataset.skip ? task.status === 'skipped' ? 'pending' : 'skipped' : task.status === 'done' ? 'pending' : 'done'; await request(base() + '/tasks/' + task.id + '/occurrence', 'PUT', { date: this.data.date, status }); this.refresh(); } catch (error) { notify(error); }
  },
  async removePatient(event: any) { try { if (await confirm('永久删除该成员的全部本地资料，包括报告原件、就诊和日历记录？此操作不能撤销。')) { await request('/patients/' + event.currentTarget.dataset.id, 'DELETE'); this.refresh(); } } catch (error) { notify(error); } },
  exportHelp() { notify('请在电脑浏览器打开 http://127.0.0.1:4317，在“我的家庭”中选择“导出资料”，下载包含原件的 ZIP。'); }
});
