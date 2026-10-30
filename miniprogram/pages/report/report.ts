import { request, base, notify, upload, openFile } from '../../utils/api';
Page({
  data: { report: null, busy: false },
  onLoad(options: any) { this.id = options.id; },
  onShow() { this.refresh(); },
  async refresh() { try { this.setData({ report: await request(base() + '/reports/' + this.id) }); } catch (error) { notify(error); } },
  edit() { wx.navigateTo({ url: '/pages/editor/editor?kind=reports&id=' + this.id }); },
  compare() { wx.navigateTo({ url: '/pages/compare/compare' }); },
  async file(event: any) { try { await openFile(this.data.report.files.find((file: any) => file.id === event.currentTarget.dataset.id)); } catch (error) { notify(error); } },
  async uploadFiles(files: any[]) {
    this.setData({ busy: true }); let count = 0; const errors = [];
    for (const file of files) { try { await upload(this.id, file.path, file.name); count++; } catch (error) { errors.push(file.name + '：' + error.message); } }
    this.setData({ busy: false }); await this.refresh(); wx.showToast({ title: '已上传 ' + count + ' 份', icon: 'none' }); if (errors.length) notify(errors.join('；'));
  },
  photos() { wx.chooseMedia({ count: 9, mediaType: ['image'], sourceType: ['album', 'camera'], success: (result: any) => this.uploadFiles(result.tempFiles.map((file: any, index: number) => ({ path: file.tempFilePath, name: '报告照片-' + Date.now() + '-' + index + '.' + (file.tempFilePath.toLowerCase().endsWith('.png') ? 'png' : 'jpg') }))) }); },
  documents() { wx.chooseMessageFile({ count: 9, type: 'file', extension: ['pdf', 'png', 'jpg', 'jpeg'], success: (result: any) => this.uploadFiles(result.tempFiles.map((file: any) => ({ path: file.path, name: file.name }))) }); }
});
