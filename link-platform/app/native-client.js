/* 安卓通道：页面通过 NativeApi 消息桥读写手机上的数据、调用提醒 / 拨号 / 短信 / 分享 / 药盒。
   没有这个桥时（桌面预览、单文件 HTML）本文件什么都不做，页面走 server.js 或浏览器内数据层。 */
(() => {
  if (!window.NativeApi?.postMessage) return;
  const requests = new Map();
  function invoke(request, timeout = 120000) {
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      const timer = setTimeout(() => { requests.delete(id); reject(Error('手机响应超时，请重试')); }, timeout);
      requests.set(id, { resolve, reject, timer });
      try { NativeApi.postMessage(JSON.stringify({ ...request, id })); }
      catch (error) { clearTimeout(timer); requests.delete(id); reject(error); }
    });
  }
  NativeApi.onmessage = event => {
    let response;
    try { response = JSON.parse(event.data); } catch { return; }
    if (response.event) { window.dispatchEvent(new CustomEvent('anyao-native', { detail: response })); return; }
    const request = requests.get(response.id);
    if (!request) return;
    clearTimeout(request.timer); requests.delete(response.id);
    response.ok ? request.resolve(response) : request.reject(Error(response.error || '手机操作失败'));
  };
  window.fetch = async (input, options = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (url.pathname.startsWith('/api/') && url.origin === location.origin) {
      const result = await invoke({ action: 'api', method: options.method || 'GET',
        path: url.pathname + url.search, body: options.body ? JSON.parse(options.body) : {} });
      if (result.sync) window.dispatchEvent(new CustomEvent('anyao-sync-status', { detail: result.sync }));
      return new Response(JSON.stringify(result.body), { status: result.status, headers: { 'content-type': 'application/json' } });
    }
    throw Error('安药安卓版不访问外部网页');
  };
  const call = (action, extra = {}, timeout) => invoke({ action, ...extra }, timeout).then(r => r.body);
  window.AndroidApp = {
    call,
    exportBackup: () => invoke({ action: 'exportBackup' }),
    reminderPermissions: () => invoke({ action: 'reminderPermissions' }),
    reminderStatus: () => invoke({ action: 'reminderStatus' }),
    reminderPreview: () => invoke({ action: 'reminderPreview' }, 30000),
    reminderTimingPermission: () => invoke({ action: 'reminderTimingPermission' }),
    reminderAppSettings: () => invoke({ action: 'reminderAppSettings' }),
    reminderAutostartSettings: () => invoke({ action: 'reminderAutostartSettings' }),
    reminderBatterySettings: () => invoke({ action: 'reminderBatterySettings' }),
    reminderNotificationSettings: () => invoke({ action: 'reminderNotificationSettings' }),
    reminderFullScreenSettings: () => invoke({ action: 'reminderFullScreenSettings' }),
    /* 联系：拨号器 / 短信 / 微信 / 邮件 / 系统分享，都是打开系统界面由用户确认，不在后台偷偷发 */
    dial: phone => call('dial', { phone }),
    sms: (phone, text) => call('sms', { phone, text }),
    wechat: text => call('wechat', { text }),
    email: (to, subject, text) => call('email', { to, subject, text }),
    share: text => call('share', { text }),
    setRole: role => call('setRole', { role }),
    syncStatus: () => call('syncStatus'),
    syncNow: () => call('syncNow', {}, 60000),
    setSync: (url, key, initializeFromLocal = false) => call('setSync', { url, key, initializeFromLocal }, 60000),
    familyAutoStatus: () => call('familyAutoStatus'),
    familyAutoPermission: () => call('familyAutoPermission'),
    appInfo: () => call('appInfo'),
    /* 手表：已配对设备 / 认证并连接 / 状态 / 开关 / 试一下 / 忘记；确认（已服药 / 稍后）走手机界面 */
    watch: (op, extra = {}) => call('watch', { op, ...extra }, op === 'pair' || op === 'reconnect' || op === 'target-configure' || op.startsWith('alarm-') ? 120000 : 60000),
    /* 自动电话：就绪状态与记录 / 申请电话权限 / 打开系统“默认拨出卡”设置 */
    callStatus: () => call('callStatus'),
    callPermission: () => call('callPermission'),
    callSettings: () => call('callSettings')
  };
  /* 药盒：原生 BLE。动作名与 device-bridge.js 的 Web Bluetooth 通道一致 */
  window.NativeWearable = { postMessage: text => {
    const req = JSON.parse(text);
    invoke({ ...req, action: 'device', op: req.action }, 130000)
      .then(r => window.NativeWearable.onmessage?.({ data: JSON.stringify({ id: req.id, ok: true, data: r.body }) }))
      .catch(e => window.NativeWearable.onmessage?.({ data: JSON.stringify({ id: req.id, ok: false, error: e.message }) }));
  } };
  document.documentElement.classList.add('android-app');
  window.addEventListener('anyao-native', e => {
    const d = e.detail;
    if (d.event === 'data-changed' && typeof refreshQuietly === 'function') refreshQuietly().catch(() => {});
    if (d.event === 'sync-status') window.dispatchEvent(new CustomEvent('anyao-sync-status', { detail: d.body || d.sync || d }));
    if (d.event === 'watch-status') window.dispatchEvent(new CustomEvent('anyao-watch-status', { detail: d.body || d }));
    if (d.event === 'pillbox') {
      window.dispatchEvent(new CustomEvent('anyao-pillbox-push', { detail: d }));
      if (d.recordError && typeof toast === 'function') toast(d.recordError);
    }
    if (d.event === 'open-dose' && d.eventId && typeof action === 'function') setTimeout(() => action('dose', d.eventId).catch(() => {}), 400);
    if (d.event === 'watch-open' && typeof action === 'function') setTimeout(() => action('watch-confirm', String(d.notificationId || '')).catch(() => {}), 300);
  });
  const refresh = async () => {
    try { const r = await AndroidApp.reminderStatus(); window.dispatchEvent(new CustomEvent('anyao-reminder-status', { detail: r.body })); } catch { }
  };
  document.addEventListener('DOMContentLoaded', () => {
    refresh();
    AndroidApp.setRole(document.body.dataset.role || '').catch(() => {});
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
})();
