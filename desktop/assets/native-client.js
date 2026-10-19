/* Local Android API transport. No server address or user database is embedded. */
(() => {
  if (!window.NativeApi?.postMessage) return;
  const requests = new Map();
  function invoke(request) {
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      const timer = setTimeout(() => { requests.delete(id); reject(Error('手机本地服务响应超时，请重试')); }, 120000);
      requests.set(id, { resolve, reject, timer });
      try { NativeApi.postMessage(JSON.stringify({ ...request, id })); }
      catch (error) { clearTimeout(timer); requests.delete(id); reject(error); }
    });
  }
  NativeApi.onmessage = event => {
    let response;
    try { response = JSON.parse(event.data); } catch { return; }
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
      return new Response(JSON.stringify(result.body), { status: result.status, headers: { 'content-type': 'application/json' } });
    }
    throw Error('安卓本地版未启用网络请求');
  };
  window.AndroidApp = {
    exportBackup: () => invoke({ action: 'exportBackup' }),
    reminderPermissions: () => invoke({ action: 'reminderPermissions' }),
    reminderStatus: () => invoke({ action: 'reminderStatus' }),
    reminderCapabilities: () => invoke({ action: 'reminderCapabilities' }),
    reminderPreview: (kind, effect, target='phone') => invoke({ action: 'reminderPreview', kind, effect, target }),
    reminderTimingPermission: () => invoke({ action: 'reminderTimingPermission' }),
    reminderAppSettings: () => invoke({ action: 'reminderAppSettings' }),
    reminderAutostartSettings: () => invoke({ action: 'reminderAutostartSettings' }),
    reminderBatterySettings: () => invoke({ action: 'reminderBatterySettings' }),
    reminderNotificationSettings: () => invoke({ action: 'reminderNotificationSettings' })
  };
  document.documentElement.classList.add('android-app');
  document.addEventListener('DOMContentLoaded', async () => {
    let reminder = { notificationsAllowed: false, scheduledCount: 0 };
    const original = profile;
    profile = () => original() + `<div class="section-heading"><h2>手机用药提醒</h2></div><div class="surface"><p class="helper" style="padding:15px">${reminder.notificationsAllowed ? '通知权限已开启，已安排 ' + reminder.scheduledCount + ' 条手机提醒' : '请授权手机通知以接收用药提醒'}。${reminder.exactAllowed?'准时提醒已开启':'准时提醒未授权，系统可能延后'}。</p><button class="secondary-btn" data-action="android-reminders">授权并检查手机提醒</button>${reminder.exactAllowed?'':'<button class="secondary-btn" data-action="reminder-timing-permission">开启手机准时提醒</button>'}</div>`;
    const refresh = async () => { const r = await AndroidApp.reminderStatus(); reminder = r.body; window.dispatchEvent(new CustomEvent('anyao-reminder-status',{detail:reminder})); if (state.tab === 'profile') render(); };
    document.addEventListener('click', async event => {
      if (event.target.closest('button')?.dataset.action !== 'android-reminders') return;
      try { const r = await AndroidApp.reminderPermissions(); reminder = r.body; render(); toast(reminder.notificationsAllowed ? '手机通知权限已开启' : '尚未获得手机通知权限'); }
      catch (error) { toast(error.message); }
    });
    try { await refresh(); } catch { /* Other pages remain available if status lookup fails. */ }
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh().catch(()=>{})});
  });
})();
