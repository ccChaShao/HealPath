import { request, base, notify, openFile, metrics } from '../../utils/api';
Page({
  data: { reports: [], leftIndex: 0, rightIndex: 1, left: null, right: null, rows: [] },
  async onLoad() { try { const summary = await request(base() + '/summary'); this.setData({ reports: summary.reports.map((report: any) => ({ ...report, label: report.date + ' ' + report.title })) }); this.build(); } catch (error) { notify(error); } },
  change(event: any) { this.setData({ [event.currentTarget.dataset.side + 'Index']: Number(event.detail.value) }); this.build(); },
  build() {
    const left = this.data.reports[this.data.leftIndex], right = this.data.reports[this.data.rightIndex];
    const ids = [...new Set([...(left?.observations || []), ...(right?.observations || [])].map((row: any) => row.metricId))];
    this.setData({ left: left || null, right: right || null, rows: ids.map(id => ({ id, name: metrics.find(metric => metric.id === id)?.name || id, left: left?.observations.find((row: any) => row.metricId === id) || null, right: right?.observations.find((row: any) => row.metricId === id) || null })) });
  },
  async file(event: any) { try { const side = this.data[event.currentTarget.dataset.side]; await openFile(side.files.find((file: any) => file.id === event.currentTarget.dataset.id)); } catch (error) { notify(error); } }
});
