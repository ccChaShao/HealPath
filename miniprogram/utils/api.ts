export const API_BASE = 'http://127.0.0.1:4317';
let token = '';
export let metrics: any[] = [];
function raw(path: string, method = 'GET', data?: any, header: any = {}): Promise<any> {
  return new Promise((resolve, reject) => wx.request({ url: API_BASE + '/api' + path, method, data,
    header: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', ...header },
    success: (response: any) => { if (response.statusCode < 400) resolve(response.data); else { const error: any = new Error(response.data?.error || '请求失败'); error.status = response.statusCode; reject(error); } },
    fail: () => reject(new Error('无法连接本地服务。请先运行 npm start，并在开发者工具中关闭合法域名校验。')) }));
}
export async function session() { const result = await raw('/session'); token = result.token; metrics = result.metrics; }
export async function request(path: string, method = 'GET', data?: any) {
  if (!token) await session();
  try { return await raw(path, method, data); }
  catch (error) { if (error.status !== 401) throw error; await session(); return raw(path, method, data); }
}
export function patientId(): string { return wx.getStorageSync('patientId') || ''; }
export function setPatient(id: string) { wx.setStorageSync('patientId', id); }
export const base = () => '/patients/' + patientId();
export function today() { return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10); }
export function notify(error: any) { wx.showModal({ title: '提示', content: error?.message || String(error), showCancel: false }); }
export function confirm(content: string): Promise<boolean> { return new Promise(resolve => wx.showModal({ title: '请确认', content, success: (result: any) => resolve(result.confirm) })); }
export async function upload(reportId: string, path: string, name: string) {
  const bytes: ArrayBuffer = await new Promise((resolve, reject) => wx.getFileSystemManager().readFile({ filePath: path, success: (result: any) => resolve(result.data), fail: reject }));
  if (bytes.byteLength > 15 * 1024 * 1024) throw new Error('单个文件不能超过 15 MB');
  return raw(base() + '/reports/' + reportId + '/files', 'POST', bytes, { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(name) });
}
export async function openFile(file: any) {
  if (!token) await session();
  const path: string = await new Promise((resolve, reject) => wx.downloadFile({ url: API_BASE + '/api/files/' + file.id, header: { Authorization: 'Bearer ' + token }, success: (result: any) => result.statusCode === 200 ? resolve(result.tempFilePath) : reject(new Error('原件下载失败')), fail: reject }));
  if (file.type === 'application/pdf') wx.openDocument({ filePath: path, fileType: 'pdf', showMenu: true, fail: notify });
  else wx.previewImage({ current: path, urls: [path] });
}
