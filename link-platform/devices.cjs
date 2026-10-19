// 虚拟安卓原生层 + 三维药盒 + 三维 Watch S3 的设备状态。
// 约定与 build/android MainActivity.handle()、Pillbox.kt、WatchReminders.kt、Reminders.kt 一致；
// 服药数据全部由安药自己的 server.js 保存，这里只调用它的 /api 接口。
'use strict';
const crypto = require('node:crypto');
const clock = require('./clock.cjs');

const TZ = 'Asia/Shanghai';
const pad = n => String(n).padStart(2, '0');
const parts = (ms = clock.now()) => Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms)).map(p => [p.type, p.value]));
const hhmm = (ms = clock.now()) => { const p = parts(ms); return `${p.hour}:${p.minute}`; };
const today = (ms = clock.now()) => { const p = parts(ms); return `${p.year}-${p.month}-${p.day}`; };
const at = (date, time) => Date.parse(`${date}T${time}:00+08:00`);
const iso = (ms = clock.now()) => new Date(ms).toISOString();
const mask = phone => { const p = String(phone || '').replace(/[^\d+]/g, ''); return p.length <= 7 ? '***' + p.slice(-2) : p.slice(0, 3) + '****' + p.slice(-4); };

const BOX_ID = 'C8:47:8C:12:A0:5E', WATCH_ID = '5C:E5:0C:3A:91:7B';
const INTENSITY_LEVEL = { gentle: 30, standard: 70, strong: 100 };
const LEVEL_NAME = { gentle: '轻柔', standard: '标准', strong: '醒目' };
// PB1 屏幕：右滑 = 休眠页，左滑 = 仅振动页，中间是主页
const PAGES = ['sleep', 'home', 'vibrate'];
const PAGE_IDLE = 12000;
const freshPrefs = () => ({ vibrateLevel: 'standard', vibrateAuto: { enabled: false, start: '22:00', end: '07:00' }, napMinutes: 60, nightSleep: { enabled: false, start: '22:30', end: '07:00' } });
const freshModes = () => ({ vibrateOnly: false, sleep: null });

function freshDevices() {
  return {
    version: 3,
    role: 'user',
    sync: { url: '' },
    perms: { sms: false, call: false, state: false },
    family: { autoNotify: false, autoCall: false, autoCallContactId: '', autoCallSince: null },
    attempts: [],
    ledger: {},
    lastDelivery: null,
    box: { paired: false, connected: false, battery: 86, firmware: '1.05', plans: [], clockSentAt: null, plansPushedAt: null, lastSyncAt: null, activity: null,
      outer: false, inner: [false, false, false, false], removed: [false, false, false, false], records: [], session: null, fired: {}, buttonSeq: 0, findUntil: 0, previewUntil: 0,
      fx: { mode: 'standard', vibration: true, led: true }, page: 'home', pageAt: 0, prefs: freshPrefs(), modes: freshModes() },
    wakeRefs: {},
    watch: { paired: false, authenticated: false, enabled: false, vibrationEnabled: true, battery: 78, firmware: '4.8.0', lastConnectedAt: null, lastDelivery: null,
      queue: [], nextId: 0x40000000, testId: 0x20000000, screen: 'face', notification: null, notifySeq: 0, buzzSeq: 0, wakeSeq: 0, alarmSettings: { enabled: false } },
    notifications: [], noteSeq: 0,
  };
}

function createDevices({ appFetch, persist, broadcast, saved }) {
  let dev = saved && saved.version === 3 ? saved : freshDevices();
  // 旧存档没有屏幕页、仅振动、休眠字段
  const upgrade = d => { d.box.prefs = { ...freshPrefs(), ...(d.box.prefs || {}) }; d.box.modes = { ...freshModes(), ...(d.box.modes || {}) }; d.box.page ||= 'home'; d.box.pageAt ||= 0; d.wakeRefs ||= {}; return d; };
  upgrade(dev);
  const log = [];
  let pressTimer = 0, lastPress = 0;
  let cache = { doses: null, settings: null, family: null, drugs: null, at: 0 };

  // ---------- 公共 ----------
  function note(actor, text, tone = 'info') { log.unshift({ at: clock.now(), time: hhmm(), actor, text, tone }); log.length = Math.min(log.length, 60); }
  function save() { try { persist(dev); } catch (error) { console.error('devices persist failed', error.message); } }
  let dirty = false;
  function changed() { dirty = true; }
  function flush() { if (!dirty) return; dirty = false; save(); broadcast('state', view()); }
  const push = (event, role = 'user') => broadcast('native', { ...event, role });
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  async function refresh(force = false) {
    if (!force && clock.now() - cache.at < 1500 && cache.doses) return cache;
    const [doses, settings, family, drugs] = await Promise.all([appFetch('GET', '/api/doses'), appFetch('GET', '/api/settings'), appFetch('GET', '/api/family'), appFetch('GET', '/api/drugs')]);
    cache = { doses: doses.body, settings: settings.body, family: { ...family.body, ...dev.family }, drugs: drugs.body, at: clock.now() };
    return cache;
  }

  // ---------- 手机上的“系统通知”（在页面里以安卓通知样式显示） ----------
  function notify(role, item) {
    const n = { id: ++dev.noteSeq, role, at: clock.now(), ...item };
    dev.notifications = dev.notifications.filter(x => !(item.tag && x.tag === item.tag));
    dev.notifications.unshift(n); dev.notifications.length = Math.min(dev.notifications.length, 20);
    broadcast('notification', n);
    changed();
    return n;
  }
  function cancel(tag) {
    const before = dev.notifications.length;
    dev.notifications = dev.notifications.filter(x => x.tag !== tag);
    if (before !== dev.notifications.length) { broadcast('notification-cancel', { tag }); changed(); }
  }

  // Reminders.effects：按设置与提醒力度给出手机震动 / 声音 / 闪光参数
  function effects(settings, role = 'user', preview = false) {
    const profiles = settings.reminderProfiles || {};
    const p = kind => ({ level: 70, pulseMs: 400, intervalMs: 600, repeats: 3, ...(profiles[kind] || {}) });
    const done = [], skipped = [];
    const out = { role, preview };
    if (settings.vibration) { const v = p('vibration'); out.vibration = Array.from({ length: v.repeats }, () => [v.pulseMs, v.intervalMs]).flat(); done.push('震动'); }
    if (settings.sound) { const s = p('sound'); out.sound = { level: s.level / 100, pulseMs: s.pulseMs, intervalMs: s.intervalMs, repeats: s.repeats }; done.push('声音'); }
    if (settings.flash) { const f = p('flash'); out.flash = { pulseMs: f.pulseMs, intervalMs: f.intervalMs, repeats: f.repeats }; done.push('闪光'); }
    broadcast('phone-effects', out);
    return { done, skipped };
  }

  // ---------- 提醒调度（与 Reminders.reconcile/deliver 同一规则） ----------
  const GRACE = 30 * 60000;
  async function reminderTick() {
    let c;
    try { c = await refresh(); } catch { return; }
    const doses = c.doses?.doses || [], missedAfter = (c.doses?.missedAfterMinutes || 30) * 60000, now = clock.now();
    const user = c.family?.user;
    const asleep = sleepNow();
    for (const d of doses) {
      if (['taken', 'skipped'].includes(d.status)) { cancel('dose:' + d.eventId); delete dev.wakeRefs[d.eventId]; continue; }
      const snooze = d.snoozedUntil ? Date.parse(d.snoozedUntil) : null;
      const wake = dev.wakeRefs[d.eventId];
      // 休眠期间到点：不提醒，记下来；睡醒后以醒来时刻为新的到点时间重新提醒
      if (wake?.wakeAt && !snooze) {
        const key = `${d.eventId}:wake:${wake.wakeAt}`;
        if (!dev.ledger[key]) { dev.ledger[key] = now; changed(); await deliver(d, 'wake', key, user, c); }
        if (!dev.ledger[`${d.eventId}:missed:${wake.wakeAt}`] && now >= wake.wakeAt + missedAfter) { dev.ledger[`${d.eventId}:missed:${wake.wakeAt}`] = now; changed(); await deliver(d, 'missed', key, user, c); }
        continue;
      }
      const ref = snooze || Date.parse(d.dueAt);
      if (asleep && now >= ref && !dev.ledger[snooze ? `${d.eventId}:snooze:${snooze}` : `${d.eventId}:due`]) {
        if (!wake) { dev.wakeRefs[d.eventId] = { at: now, planned: d.planned, name: d.drug?.name || '' }; note('药盒', `休眠中 · ${d.planned} ${d.drug?.name || ''} 到点不提醒，睡醒后再提醒`); changed(); }
        continue;
      }
      if (wake && !wake.wakeAt) continue;
      const keys = [];
      keys.push(snooze ? [`${d.eventId}:snooze:${snooze}`, snooze, 'due'] : [`${d.eventId}:due`, ref, 'due']);
      keys.push([`${d.eventId}:missed:${ref}`, ref + missedAfter, 'missed']);
      for (const [key, when, stage] of keys) {
        if (dev.ledger[key] || now < when) continue;
        dev.ledger[key] = now; changed();
        if (now - when > GRACE) continue;
        if (stage === 'missed' && d.level === 'delay') continue;
        await deliver(d, stage, key, user, c);
      }
    }
    for (const [id, w] of Object.entries(dev.wakeRefs)) if (now - (w.wakeAt || w.at) > 86400000) delete dev.wakeRefs[id];
    // 账本保留 3 天
    for (const [key, time] of Object.entries(dev.ledger)) if (now - time > 3 * 86400000) delete dev.ledger[key];
  }

  async function deliver(d, stage, key, user, c) {
    const name = d.drug?.name || '药物', text = `${d.planned} ${name}${d.drug?.dose ? ' ' + d.drug.dose : ''}${d.drug?.note ? ' · ' + d.drug.note : ''}`;
    dev.lastDelivery = { key, at: clock.now() };
    // 服药者手机
    const title = stage === 'missed' ? '这顿药还没吃' : stage === 'wake' ? '睡醒了，这顿药还没吃' : '该吃药了';
    if (c.settings.phone !== false) notify('user', { tag: 'dose:' + d.eventId, kind: 'dose', eventId: d.eventId, title, text, actions: [['taken', '我吃了'], ['snooze15', '15 分钟后']] });
    // 仅振动：手机只震动，不响铃不闪光
    effects(vibrateOnly() ? { ...c.settings, sound: false, flash: false, vibration: true } : c.settings, 'user');
    note('手机', `${stage === 'missed' ? '超时提醒' : stage === 'wake' ? '睡醒后补提醒' : '到点提醒'}${vibrateOnly() ? '（仅振动）' : ''} · ${text}`, 'alert');
    await watchDue(d, key);
    boxDue(d, stage);
    if (stage === 'missed') {
      await autoSms(d, user, c);
      await autoCall(d, c);
      // 家属手机（同一部手机切换到家属端时可见）
      notify('family', { tag: 'family:' + d.eventId, kind: 'family', eventId: d.eventId, title: `${user?.name || '家人'}还没吃药`, text: `${d.planned} ${name}，已超过 ${c.doses.missedAfterMinutes} 分钟没有记录`, actions: [['ack', '我知道了'], ['call', '打电话']] });
      note('家属端', `${user?.name || '家人'} ${d.planned} ${name} 超过 ${c.doses.missedAfterMinutes} 分钟没有记录`, 'alert');
    }
    changed();
  }

  async function autoSms(d, user, c) {
    if (!dev.family.autoNotify) return;
    const contacts = (c.family.contacts || []).filter(x => String(x.phone).replace(/\D/g, '').length >= 5);
    if (!contacts.length) return;
    if (!dev.perms.sms) { notify('user', { kind: 'info', title: '自动短信没有发出', text: '请打开安药，在“设置 → 家属”里允许发送短信' }); return; }
    const names = contacts.map(x => x.name).join('、');
    await appFetch('POST', `/api/doses/${d.eventId}/action`, { channel: 'sms', note: `自动短信已发给 ${names}`, by: 'auto' });
    note('手机', `自动短信（演示，未真实发送）→ ${names}：【安药】${user?.name || '家人'} ${d.planned} 的${d.drug?.name || '药'} 已超过 ${c.doses.missedAfterMinutes} 分钟没有记录吃药，请联系确认。`, 'warn');
  }

  async function autoCall(d, c) {
    const f = dev.family;
    if (!f.autoCall || !f.autoCallSince) return;
    const contact = (c.family.contacts || []).find(x => x.id === f.autoCallContactId);
    const keyId = `${d.eventId}@${Date.parse(d.dueAt)}`;
    if (dev.attempts.some(a => a.key === keyId)) return;
    const last = dev.attempts.filter(a => a.status === 'submitted').at(-1);
    let status = 'submitted', label = '拨号请求已交给系统电话，接没接通以通话记录为准';
    if (!contact) { status = 'invalid_contact'; label = '家属已删除或号码无效，没有拨号'; }
    else if (!dev.perms.call || !dev.perms.state) { status = 'not_ready'; label = '需要允许“拨打电话”'; }
    else if (last && clock.now() - Date.parse(last.at) < 10 * 60000) { status = 'cooldown'; label = '离上次自动电话不到 10 分钟，这一顿不再自动拨'; }
    dev.attempts.push({ key: keyId, at: iso(), planned: d.planned, drug: `${d.drug?.name || ''} ${d.drug?.dose || ''}`.trim(), contact: contact?.name || '已删除的家属', phoneMasked: mask(contact?.phone), status, label });
    dev.attempts = dev.attempts.slice(-200);
    if (status === 'submitted') {
      await appFetch('POST', `/api/doses/${d.eventId}/action`, { channel: 'call', note: `自动给${contact.name}打了电话（${mask(contact.phone)}）`, by: 'auto' });
      broadcast('system-ui', { role: 'user', kind: 'call', name: contact.name, phone: mask(contact.phone), auto: true });
      note('手机', `自动给${contact.name}打电话（演示，未真实拨号）`, 'warn');
    } else notify('user', { kind: 'info', title: `给${contact?.name || '家属'}的电话没有自动拨出`, text: label });
    changed();
  }

  // ---------- 手表 ----------
  function watchStatus() {
    const w = dev.watch;
    return { paired: w.paired, deviceId: w.paired ? WATCH_ID : null, name: w.paired ? 'Xiaomi Watch S3' : null, connected: w.paired && w.authenticated, authenticated: w.paired && w.authenticated,
      battery: w.paired ? w.battery : null, model: w.paired ? 'M2313W1' : null, firmware: w.paired ? w.firmware : null, lastConnectedAt: w.lastConnectedAt, error: '', permitted: true,
      enabled: w.enabled, vibrationEnabled: w.vibrationEnabled, lastDelivery: w.lastDelivery, alarmSettings: w.alarmSettings,
      targetEnabled: w.paired && w.enabled, targetDesiredEnabled: w.enabled, targetPending: false, targetError: '', connectionPhase: w.authenticated ? 'connected' : 'idle' };
  }
  function watchShow(notification, buzz) {
    const w = dev.watch;
    w.notification = notification; w.screen = 'notification'; w.notifySeq += 1;
    if (buzz) w.buzzSeq += 1;
    changed();
  }
  async function watchDue(d, key) {
    const w = dev.watch;
    if (!w.enabled || !w.paired || !w.authenticated) return;
    if (w.queue.some(q => q.key === key)) return;
    let item = w.queue.find(q => q.eventId === d.eventId && !q.handled && q.status === d.status && q.expiresAt > clock.now());
    if (!item) {
      item = { notificationId: ++w.nextId, deviceId: WATCH_ID, eventId: d.eventId, drugName: d.drug?.name || '', dose: d.drug?.dose || '', time: d.planned, date: d.date, test: false, createdAt: clock.now(), expiresAt: clock.now() + 6 * 3600000, status: d.status, key };
      w.queue.unshift(item); w.queue.length = Math.min(w.queue.length, 40);
    }
    w.lastDelivery = { sent: true, transportAcknowledged: true, transport: 'xiaomi-spp-v2', notificationId: item.notificationId, test: false, sentAt: iso(), vibration: w.vibrationEnabled ? { requested: true, sent: true, transport: 'xiaomi-spp-v2', transportAcknowledged: true, stopAcknowledged: true, durationMs: 650, method: 'xiaomi_find_watch_pulse', deviceAccepted: 'unknown', physicalVibrationVerified: false } : { requested: false } };
    watchShow({ id: item.notificationId, title: `安药 · ${d.planned} 该吃药了`, drugName: item.drugName, dose: item.dose, time: d.planned, test: false }, w.vibrationEnabled);
    note('手表', `收到用药通知${w.vibrationEnabled ? ' · 短振' : ''} · ${item.drugName}`);
  }
  // 手表上点“在手机上打开”
  function watchOpenPhone() {
    const w = dev.watch, n = w.notification;
    if (!n) return { ok: false, message: '手表上没有通知' };
    const item = w.queue.find(q => q.notificationId === n.id);
    if (item) item.openedAt = clock.now();
    w.screen = 'confirm';
    push({ event: 'watch-open', notificationId: n.id });
    note('手表', '点击“在手机上打开” → 手机弹出确认');
    changed();
    return { ok: true, message: '已在手机上打开' };
  }

  async function watchOp(req) {
    const w = dev.watch, op = req.op;
    switch (op) {
      case 'status': return watchStatus();
      case 'pending': {
        const p = w.queue.filter(q => !q.handled && q.expiresAt > clock.now()).sort((a, b) => (b.openedAt || 0) - (a.openedAt || 0) || b.createdAt - a.createdAt)[0];
        if (!p) return { pending: null };
        const { key: _k, status: _s, ...item } = p;
        return { pending: item };
      }
      case 'confirm': {
        const id = Number(req.notificationId), choice = req.choice;
        if (!['taken', 'snoozed'].includes(choice)) throw Error('请选已服药或稍后提醒');
        const item = w.queue.find(q => q.notificationId === id);
        if (!item || item.expiresAt < clock.now()) throw Error('这条提醒已经失效，请看今天的计划');
        if (item.handled) { if (item.choice === choice) return { applied: true, alreadyApplied: true, test: item.test }; throw Error('这一顿的记录已经变了或者提醒过期了，请看今天的计划'); }
        if (!item.test) {
          const body = choice === 'taken' ? { status: 'taken', time: hhmm() } : { status: 'snoozed', minutes: 10 };
          const r = await patchDose(item.eventId, body);
          if (r.status >= 400) throw Error('没有保存成功，请稍后再试');
          cache.at = 0;
        }
        item.handled = true; item.choice = choice;
        cancel('watch:' + id); if (!item.test) cancel('dose:' + item.eventId);
        if (w.notification?.id === id) { w.notification = null; w.screen = 'face'; }
        note('手机', `手表提醒确认：${choice === 'taken' ? '已服药' : '稍后 10 分钟'}${item.test ? '（测试，不改记录）' : ''}`, choice === 'taken' ? 'done' : 'info');
        push({ event: 'data-changed' });
        changed();
        return item.test ? { applied: true, test: true } : { applied: true, alreadyApplied: false, test: false };
      }
      case 'target-configure': {
        if (typeof req.enabled !== 'boolean') throw Error('手表总开关无效');
        if (!w.paired) throw Error('请先连接手表');
        w.enabled = req.enabled; if (req.enabled) w.alarmSettings = w.alarmSettings || { enabled: false };
        note('手机', `手表提醒总开关${w.enabled ? '开启' : '关闭'}`); changed();
        return watchStatus();
      }
      case 'configure': {
        if (req.vibrationEnabled !== undefined && typeof req.vibrationEnabled !== 'boolean') throw Error('震动开关无效');
        w.enabled = Boolean(req.enabled);
        if (typeof req.vibrationEnabled === 'boolean') w.vibrationEnabled = req.vibrationEnabled;
        note('手机', `手表提醒${w.enabled ? '开启' : '关闭'}${typeof req.vibrationEnabled === 'boolean' ? ` · 手表震动${w.vibrationEnabled ? '开' : '关'}` : ''}`);
        changed();
        return watchStatus();
      }
      case 'forget': {
        Object.assign(w, { paired: false, authenticated: false, notification: null, screen: 'face' });
        note('手机', '已忘记手表');
        changed();
        const { enabled: _e, vibrationEnabled: _v, lastDelivery: _l, alarmSettings: _a, ...rest } = watchStatus();
        return rest;
      }
      case 'bonded': return { devices: [{ id: WATCH_ID, name: 'Xiaomi Watch S3' }] };
      case 'pair': {
        const keyText = String(req.key || '').trim().replace(/^0x/i, '').replace(/\s+/g, '');
        if (!/^[0-9a-f]{32}$/i.test(keyText)) throw Error('认证密钥是 32 位的十六进制字符（0-9、a-f），请检查是否完整');
        if (req.deviceId !== WATCH_ID) throw Error('请选择一块手表');
        await sleep(1600);
        Object.assign(w, { paired: true, authenticated: true, enabled: true, lastConnectedAt: clock.now(), screen: 'connection' });
        w.wakeSeq += 1;
        note('手表', '已认证并连接 · 到点会在手表上提醒', 'done');
        changed();
        return watchStatus();
      }
      case 'reconnect': { if (!w.paired) throw Error('还没有连接手表'); await sleep(700); w.authenticated = true; w.lastConnectedAt = clock.now(); changed(); return watchStatus(); }
      case 'test': {
        if (!w.paired) throw Error('还没有连接手表');
        if (!w.authenticated) throw Error('手表没有连上，请把手表放在手机旁边再试');
        const item = { notificationId: ++w.testId, deviceId: WATCH_ID, test: true, drugName: '安药提醒测试', dose: '只是试一下，不会改服药记录', time: '', createdAt: clock.now(), expiresAt: clock.now() + 3600000 };
        w.queue.unshift(item);
        w.lastDelivery = { sent: true, transportAcknowledged: true, transport: 'xiaomi-spp-v2', notificationId: item.notificationId, test: true, sentAt: iso(), vibration: { requested: w.vibrationEnabled } };
        watchShow({ id: item.notificationId, title: '安药 · 提醒测试', drugName: '安药提醒测试', dose: '', time: hhmm(), test: true }, w.vibrationEnabled);
        note('手表', '收到测试提醒');
        return w.lastDelivery;
      }
      case 'vibrate': {
        if (!w.paired || !w.authenticated) throw Error('手表没有连上，请先连接手表');
        w.buzzSeq += 1; w.wakeSeq += 1; changed();
        note('手表', '震动一下（650 ms）');
        return { sent: true, transport: 'xiaomi-spp-v2', transportAcknowledged: true, stopAcknowledged: true, durationMs: 650, method: 'xiaomi_find_watch_pulse', deviceAccepted: 'confirmed', physicalVibrationVerified: false };
      }
      case 'alarms': case 'alarm-preview': case 'alarm-sync': case 'alarm-enable': case 'alarm-clear': case 'alarm-test': case 'alarm-protocol': case 'alarm-review': return watchAlarms(op, req);
      default: throw Error('不支持的手表操作');
    }
  }
  async function watchAlarms(op, req) {
    const w = dev.watch;
    if (!w.paired || !w.authenticated) throw Error('手表没有连上，请先连接手表');
    const c = await refresh(true);
    const times = [...new Set((c.drugs || []).filter(d => !d.asNeeded).flatMap(d => d.times || []))].sort();
    const managed = w.alarmSettings.enabled ? times : [];
    const preview = enabled => ({ alarms: [{ label: '起床', hour: 7, minute: 0, enabled: true, managed: false }, ...(enabled ? times : managed).map(t => ({ label: '安药', hour: Number(t.slice(0, 2)), minute: Number(t.slice(3)), enabled: true, managed: true }))], requestedTimes: times, createCount: enabled ? times.filter(t => !managed.includes(t)).length : 0, removeCount: enabled ? 0 : managed.length });
    if (op === 'alarm-enable' || op === 'alarm-sync') { w.alarmSettings = { enabled: true }; note('手表', `本地闹钟已同步：${times.join('、') || '无'}`); changed(); return { preview: preview(true), alarmSettings: w.alarmSettings }; }
    if (op === 'alarm-clear') { w.alarmSettings = { enabled: false }; note('手表', '已移除安药闹钟'); changed(); return { preview: preview(false), alarmSettings: w.alarmSettings }; }
    if (op === 'alarm-test') { const t = new Date(clock.now() + (Number(req.delayMinutes) || 2) * 60000); const p = parts(t.getTime()); note('手表', `测试闹钟 ${p.hour}:${p.minute}`); return { verified: true, hour: Number(p.hour), minute: Number(p.minute), labelStored: true }; }
    return { preview: preview(w.alarmSettings.enabled) };
  }

  // ---------- 药盒（Pillbox.kt 同一组动作） ----------
  function boxStatus() {
    const b = dev.box;
    return { connected: b.connected, deviceId: b.paired ? BOX_ID : null, name: 'Hi-PB1-A05E', savedDevice: b.paired, plans: b.paired ? b.plans : [], battery: b.connected ? b.battery : null, firmware: b.connected ? b.firmware : null,
      identity: b.connected ? { mac: BOX_ID, firmware: 'V2.1.0' } : null, clockSentAt: b.clockSentAt, plansPushedAt: b.plansPushedAt, lastSyncAt: b.lastSyncAt, activity: b.activity, transport: 'android-ble' };
  }
  const needBox = () => { if (!dev.box.paired) throw Error('请先连接药盒'); if (!dev.box.connected) throw Error('药盒已断开，请短按药盒按钮唤醒后重新连接'); };
  async function deviceOp(req) {
    const b = dev.box, op = req.op;
    switch (op) {
      case 'hipeeStatus': return boxStatus();
      case 'hipeeScan': await sleep(1800); return [{ id: BOX_ID, name: 'Hi-PB1-A05E', rssi: -58 }];
      case 'hipeeConnect': {
        if (req.deviceId !== BOX_ID) throw Error('药盒地址无效');
        await sleep(1200);
        Object.assign(b, { paired: true, connected: true, clockSentAt: clock.now() });
        note('药盒', '已连接 · 已校准时间、读取电量', 'done');
        // 演示：连上就把用药计划下发到药盒（按时吃的药依次放进 1–4 号仓），省去手动下发
        if (!b.plans.length) await autoLoadPlans();
        push({ event: 'pillbox', connected: true });
        changed();
        return boxStatus();
      }
      case 'hipeeReconnect': { if (!b.paired) throw Error('还没有连过药盒，请先搜索'); await sleep(900); b.connected = true; push({ event: 'pillbox', connected: true }); note('药盒', '已重新连接'); changed(); return boxStatus(); }
      case 'hipeeDisconnect': b.connected = false; push({ event: 'pillbox', connected: false }); note('药盒', '已断开蓝牙；药盒仍按已下发的计划自己提醒'); changed(); return boxStatus();
      case 'hipeeCalibrate': needBox(); b.clockSentAt = clock.now(); note('药盒', `时间已校准为 ${hhmm()}`); changed(); return { clockSent: true, confirmed: false };
      case 'hipeeFind': needBox(); b.findUntil = clock.now() + 4000; note('药盒', '寻找药盒：响铃并闪灯 4 秒'); changed(); return { requested: true };
      case 'hipeeQuery': needBox(); return { battery: b.battery, firmware: b.firmware };
      case 'hipeePushPlans': {
        needBox();
        const plans = Array.isArray(req.plans) ? req.plans : [];
        if (plans.length > 4) throw Error('药盒最多四个仓位');
        const seen = new Set();
        const clean = plans.map((p, i) => {
          const c = Number(p.compartment);
          if (!(c >= 1 && c <= 4)) throw Error('仓位必须在1..4');
          if (seen.has(c)) throw Error('每种药物请选择不同仓位'); seen.add(c);
          const times = (p.times || []).map(String);
          if (times.some(t => !/^([01]\d|2[0-3]):[0-5]\d$/.test(t))) throw Error(`第${i + 1}份计划有无效时间`);
          if (!times.length || times.length > 9) throw Error('每仓必须有1..9条提醒');
          if (new Set(times).size !== times.length) throw Error('同仓提醒时间不能重复');
          return { compartment: c, times: [...times].sort(), drugId: String(p.drugId || ''), drugName: String(p.drugName || '') };
        });
        await sleep(400 + clean.length * 250);
        b.plans = clean; b.plansPushedAt = clock.now(); b.clockSentAt = clock.now();
        note('药盒', clean.length ? `计划已写入药盒：${clean.map(p => `${p.compartment}号仓 ${p.drugName} ${p.times.join('/')}`).join('；')}` : '已清空药盒里的全部提醒', 'done');
        changed();
        return { pushed: clean.reduce((s, p) => s + p.times.length, 0), plans: clean, confirmed: true };
      }
      case 'hipeeClear': {
        needBox();
        const slot = Number(req.slot);
        if (!(slot >= 1 && slot <= 4)) throw Error('药盒只有 4 个仓位');
        b.plans = b.plans.filter(p => p.compartment !== slot); changed();
        return { slot, cleared: true };
      }
      case 'hipeeSync': {
        needBox();
        await sleep(900);
        const records = b.records.slice();
        const r = await appFetch('POST', '/api/hipee-history/import', { deviceId: BOX_ID, deviceName: 'Hi-PB1-A05E', capturedAt: iso(), records, syncComplete: true });
        if (r.status >= 400) throw Error(r.body?.detail || '药盒记录导入失败');
        b.records = []; b.lastSyncAt = clock.now();
        note('药盒', `同步了 ${records.length} 条药盒记录（不自动记为已服药）`); changed();
        return { count: records.length, complete: true, completion: 'record-count', matched: 0 };
      }
      case 'pb1Modes': case 'pb1Prefs': case 'pb1Vibrate': case 'pb1Sleep': return modesOp(req);
      default: throw Error('不支持的药盒操作');
    }
  }

  function boxActivity(kind, compartment) {
    const b = dev.box;
    const raw = `01 0${compartment || 0} ${Math.floor(clock.now() / 1000).toString(16).padStart(8, '0').match(/../g).join(' ')} 0${kind === 'button' ? 4 : 1}`;
    b.activity = { at: clock.now(), kind, raw };
    if (b.connected) push({ event: 'pillbox', activity: b.activity });
  }

  // 每一顿到点 / 超时 / 睡醒补提醒：药盒同时响铃震动亮灯（三端一起提醒，不依赖是否手动下发过计划）
  function boxDue(d, stage) {
    const b = dev.box;
    if (!b.paired || sleepNow()) return;
    const plan = b.plans.find(p => p.drugId === d.drugId);
    const compartment = plan?.compartment || (b.plans.length < 4 ? b.plans.length + 1 : 1);
    if (b.session && !b.session.confirmed && !b.session.skipped && b.session.eventId === d.eventId) { b.session.ringing = true; b.session.startedAt = clock.now(); changed(); return; }
    if (b.session && !b.session.confirmed && !b.session.skipped && b.session.ringing) return; // 正在响另一顿
    const key = `${today()} ${d.planned} ${compartment}`;
    b.fired[key] = clock.now();
    b.session = { key, eventId: d.eventId, compartment, time: d.planned, drugId: d.drugId, drugName: d.drug?.name || plan?.drugName || '', startedAt: clock.now(), ringing: true, removed: false };
    b.removed = [false, false, false, false];
    note('药盒', `${stage === 'missed' ? '超时再次提醒' : stage === 'wake' ? '睡醒补提醒' : d.snoozedUntil ? '稍后提醒到点' : `${d.planned} 到点`} · ${compartment} 号仓亮灯${b.fx.vibration ? '、机身震动' : ''}、响铃（${b.session.drugName}）`, 'alert');
    changed();
  }

  // 药盒按已下发的计划自己提醒：到点亮灯 + 震动，开盖后改为常亮指引，取出药片后等待手机确认。
  function boxTick() {
    const b = dev.box, now = clock.now(), date = today();
    if (!b.paired) return;
    if (!b.session) {
      for (const plan of b.plans) for (const time of plan.times) {
        const key = `${date} ${time} ${plan.compartment}`, due = at(date, time);
        if (!b.fired[key] && now >= due && now - due < GRACE) {
          b.fired[key] = now;
          // 这一顿已经在安药里记过（例如误开时双击确认提前吃了）就不再响
          if ((cache.doses?.doses || []).some(d => d.drugId === plan.drugId && d.planned === time && ['taken', 'skipped'].includes(d.status))) { note('药盒', `${time} ${plan.drugName} 已经记过服药，不再提醒`); changed(); continue; }
          if (sleepNow()) { b.held ||= []; b.held.push({ key, compartment: plan.compartment, time, drugId: plan.drugId, drugName: plan.drugName }); changed(); continue; }
          b.session ={ key, compartment: plan.compartment, time, drugId: plan.drugId, drugName: plan.drugName, startedAt: now, ringing: true, removed: false };
          b.removed = [false, false, false, false];
          note('药盒', `${time} 到点 · ${plan.compartment} 号仓亮灯${b.fx.vibration ? '、机身震动' : ''}（${plan.drugName}）`, 'alert');
          changed();
        }
      }
    } else if (b.session.ringing && now - b.session.startedAt > GRACE) { b.session.ringing = false; changed(); }
    // 提醒没处理：手表每 2.4 秒短振一次，和药盒一起持续提示
    const w = dev.watch;
    if (b.session?.ringing && w.paired && w.authenticated && w.enabled && w.vibrationEnabled && w.screen === 'notification' && !w.notification?.test && now - (w.lastBuzzAt || 0) >= 2400) { w.lastBuzzAt = now; w.buzzSeq += 1; changed(); }
    for (const key of Object.keys(b.fired)) if (!key.startsWith(date)) delete b.fired[key];
  }

  // ---------- PB1 屏幕：主页 / 仅振动 / 休眠 ----------
  // 每天 start–end 的时间窗（可跨午夜）：返回包含 now 的那一段，或 null
  function windowOf(start, end, now = clock.now()) {
    for (const back of [0, 1]) {
      const day = today(now - back * 86400000), s = at(day, start);
      let e = at(day, end); if (e <= s) e += 86400000;
      if (now >= s && now < e) return { key: s, start: s, end: e };
    }
    return null;
  }
  // 休眠期间按住的那几顿（安药记录和药盒计划可能是同一顿，按 药 + 计划时间 去重）
  const heldCount = () => new Set([...Object.values(dev.wakeRefs).filter(w => !w.wakeAt).map(w => `${w.name}@${w.planned}`), ...(dev.box.held || []).map(h => `${h.drugName}@${h.time}`)]).size;
  const sleepNow = () => { const s = dev.box.modes.sleep; return s && clock.now() < s.until ? s : null; };
  const vibrateOnly = () => dev.box.paired && dev.box.modes.vibrateOnly;
  function startSleep(kind, until, by) {
    const b = dev.box, m = b.modes;
    m.sleep = { kind, since: clock.now(), until, key: kind === 'night' ? m.nightKey : null };
    // 正在响的那一顿先收起来，睡醒后再提醒
    if (b.session && !b.session.confirmed && !b.session.removed) { b.held ||= []; b.held.push({ ...b.session }); b.session = null; }
    b.page = 'home'; push({ event: 'pillbox', modes: true });
    note('药盒', `${by} · 进入休眠${kind === 'night' ? '（夜间睡眠）' : ''}，到 ${hhmm(until)} 期间不提醒，睡醒后再提醒`, 'info');
    changed();
  }
  function wakeUp(by) {
    const b = dev.box, m = b.modes, s = m.sleep;
    if (!s) return false;
    m.sleep = null;
    const now = clock.now();
    let held = 0;
    for (const w of Object.values(dev.wakeRefs)) if (!w.wakeAt) { w.wakeAt = now; held++; }
    // 药盒按住的那一顿：醒来后亮灯震动
    const first = (b.held || [])[0];
    if (first && !b.session) {
      b.session = { ...first, startedAt: now, ringing: true, removed: false, woke: true };
      b.removed = [false, false, false, false];
    }
    b.held = []; push({ event: 'pillbox', modes: true });
    note('药盒', `${by} · 结束休眠${held || first ? ` · 补提醒 ${Math.max(held, first ? 1 : 0)} 次没吃的药` : ' · 期间没有要吃的药'}`, held || first ? 'alert' : 'done');
    changed();
    return true;
  }
  // 自动进入仅振动 / 夜间休眠，到点自动退出
  function modesTick() {
    const b = dev.box, m = b.modes, p = b.prefs, now = clock.now();
    if (!b.paired) return;
    if (m.sleep && now >= m.sleep.until) wakeUp('休眠时间到');
    if (p.nightSleep.enabled) {
      const w = windowOf(p.nightSleep.start, p.nightSleep.end, now);
      if (w && m.nightKey !== w.key) { m.nightKey = w.key; if (!m.sleep) startSleep('night', w.end, `${p.nightSleep.start} 到了`); }
    }
    if (p.vibrateAuto.enabled) {
      const w = windowOf(p.vibrateAuto.start, p.vibrateAuto.end, now);
      if (w && m.vibrateKey !== w.key) { m.vibrateKey = w.key; if (!m.vibrateOnly) { m.vibrateAutoUntil = w.end; m.vibrateOnly = true; push({ event: 'pillbox', modes: true }); note('药盒', `${p.vibrateAuto.start} 到了 · 自动进入仅振动（${LEVEL_NAME[p.vibrateLevel]}），到 ${p.vibrateAuto.end} 结束`); } changed(); }
    }
    if (m.vibrateAutoUntil && now >= m.vibrateAutoUntil) { m.vibrateAutoUntil = 0; if (m.vibrateOnly) { m.vibrateOnly = false; push({ event: 'pillbox', modes: true }); note('药盒', `${p.vibrateAuto.end} 到了 · 仅振动结束，恢复指示灯提醒`); } changed(); }
    if (b.page !== 'home' && now - b.pageAt > PAGE_IDLE) { b.page = 'home'; changed(); }
  }
  function setVibrateOnly(on, by) {
    const m = dev.box.modes;
    m.vibrateOnly = on; m.vibrateAutoUntil = 0; push({ event: 'pillbox', modes: true });
    note('药盒', `${by} · ${on ? `仅振动已开启（${LEVEL_NAME[dev.box.prefs.vibrateLevel]}）：到点只震动，不亮灯、手机不响铃不闪光` : '仅振动已关闭：恢复指示灯与手机提醒方式'}`, on ? 'info' : 'done');
    changed();
  }
  const validTime = t => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(t));
  function modesStatus() {
    const b = dev.box, s = sleepNow();
    return { supported: true, prefs: b.prefs, vibrateOnly: !!b.modes.vibrateOnly, vibrateAutoUntil: b.modes.vibrateAutoUntil || null,
      sleep: s ? { kind: s.kind, since: s.since, until: s.until, held: heldCount() } : null };
  }
  function modesOp(req) {
    const b = dev.box;
    if (!b.paired) throw Error('请先连接药盒');
    if (req.op === 'pb1Modes') return modesStatus();
    if (req.op === 'pb1Prefs') {
      const p = req.prefs || {}, next = structuredClone(b.prefs);
      if (p.vibrateLevel !== undefined) { if (!LEVEL_NAME[p.vibrateLevel]) throw Error('振动强度无效'); next.vibrateLevel = p.vibrateLevel; }
      if (p.napMinutes !== undefined) { if (![30, 60, 90, 120].includes(Number(p.napMinutes))) throw Error('休眠时长无效'); next.napMinutes = Number(p.napMinutes); }
      for (const k of ['vibrateAuto', 'nightSleep']) if (p[k]) {
        const w = { ...next[k], ...p[k] };
        if (!validTime(w.start) || !validTime(w.end) || w.start === w.end) throw Error('开始和结束时间不对');
        w.enabled = Boolean(w.enabled); next[k] = { enabled: w.enabled, start: w.start, end: w.end };
      }
      b.prefs = next;
      const parts2 = [];
      if (p.vibrateLevel) parts2.push(`仅振动强度 ${LEVEL_NAME[next.vibrateLevel]}`);
      if (p.vibrateAuto) parts2.push(next.vibrateAuto.enabled ? `每天 ${next.vibrateAuto.start}–${next.vibrateAuto.end} 自动仅振动` : '关闭自动仅振动');
      if (p.napMinutes) parts2.push(`休眠时长 ${next.napMinutes} 分钟`);
      if (p.nightSleep) parts2.push(next.nightSleep.enabled ? `每天 ${next.nightSleep.start}–${next.nightSleep.end} 夜间休眠` : '关闭夜间休眠');
      // 改了时间窗：今天的这一段按新设置重新判断
      if (p.vibrateAuto) { b.modes.vibrateKey = null; if (!next.vibrateAuto.enabled && b.modes.vibrateAutoUntil) { b.modes.vibrateAutoUntil = 0; b.modes.vibrateOnly = false; } }
      if (p.nightSleep) b.modes.nightKey = null;
      note('手机', `药盒设置已同步：${parts2.join('；')}`);
      changed(); modesTick();
      return modesStatus();
    }
    if (req.op === 'pb1Vibrate') { setVibrateOnly(Boolean(req.on), '手机'); return modesStatus(); }
    if (req.op === 'pb1Sleep') {
      if (req.on) { if (!sleepNow()) startSleep('nap', clock.now() + b.prefs.napMinutes * 60000, '手机'); }
      else wakeUp('手机');
      return modesStatus();
    }
    throw Error('不支持的药盒操作');
  }

  // 三维药盒上的实物动作
  function physical(type, payload = {}) {
    const b = dev.box, s = b.session;
    switch (type) {
      case 'box.lid': {
        const next = payload.open === undefined ? !b.outer : Boolean(payload.open);
        if (next === b.outer) return { ok: false, message: next ? '外盖已经打开' : '外盖已经合上' };
        b.outer = next;
        // 还没连接安药的药盒：打开外盖即唤醒并广播，手机自动弹出“连接智能药盒”
        if (next && !b.connected) {
          push({ event: 'pillbox-connect-prompt', paired: b.paired });
          note('药盒', `外盖打开 · 药盒唤醒并广播蓝牙${b.paired ? '（之前断开了）' : ''} · 手机弹出连接窗口`, 'info');
          changed(); return { ok: true, message: '外盖已打开 · 手机弹出连接窗口' };
        }
        if (next) { if (s) s.ringing = false; boxActivity('lid_open', s?.compartment || 0); b.records.push({ compartment: s?.compartment || 0, taken: false, timestamp: Math.floor(clock.now() / 1000) }); note('药盒', `外盖打开${s ? ` · 屏幕提示打开 ${s.compartment} 号仓` : ''}${b.connected ? '' : '（蓝牙未连，记录存在药盒里）'}`); }
        else {
          b.inner = [false, false, false, false];
          if (b.wrong) { b.wrong = null; note('药盒', '合盖 · 取消误开提示'); }
          boxActivity('lid_close', 0);
          note('药盒', '外盖合上');
          if (s && (s.removed || s.confirmed || s.skipped)) { b.session = null; b.removed = [false, false, false, false]; note('药盒', '回到待机，指示灯熄灭'); }
        }
        changed(); return { ok: true, message: next ? '外盖已打开' : '外盖已合上' };
      }
      case 'box.inner': {
        const i = Number(payload.n) - 1;
        if (!(i >= 0 && i < 4)) return { ok: false, message: '药仓编号无效' };
        if (!b.outer) return { ok: false, message: '请先打开药盒外盖' };
        const next = payload.open === undefined ? !b.inner[i] : Boolean(payload.open);
        b.inner[i] = next;
        // 误开：打开的不是本次提醒的药仓（或现在没有提醒）→ 红灯 + 轻微震动 + 屏幕询问
        const plan = b.plans.find(p => p.compartment === i + 1);
        // “当前时段”：正在提醒的那一仓，或计划时间在现在前后 30 分钟内的仓（提前一点取药不算误开）
        const nowMs = clock.now();
        const inWindow = (plan?.times || []).some(t => Math.abs(at(today(), t) - nowMs) <= 30 * 60000);
        const wrong = next && (s ? s.compartment !== i + 1 : !inWindow);
        if (wrong) {
          b.wrong = { compartment: i + 1, drugId: plan?.drugId || '', drugName: plan?.drugName || '', times: plan?.times || [], at: clock.now(), expected: s?.compartment || 0 };
          boxActivity('wrong_time_open', i + 1);
          note('药盒', `${i + 1} 号仓不是当前时段的药 · 红灯 + 轻微震动 · 屏幕询问是否确认服用（单击取消，双击确认）`, 'warn');
        } else {
          if (!next && b.wrong?.compartment === i + 1) { b.wrong = null; note('药盒', `${i + 1} 号仓合上 · 取消误开提示`); }
          else note('药盒', `${i + 1} 号仓${next ? '打开' : '合上'}`);
        }
        changed(); return { ok: true, message: `${i + 1} 号仓已${next ? '打开' : '合上'}`, warning: wrong ? `${i + 1} 号仓不是当前时段的药` : undefined };
      }
      case 'box.take': {
        const i = Number(payload.n || s?.compartment) - 1;
        if (!(i >= 0 && i < 4)) return { ok: false, message: '药仓编号无效' };
        if (!b.outer || !b.inner[i]) return { ok: false, message: `请先打开 ${i + 1} 号仓` };
        if (b.removed[i]) return { ok: false, message: '这一仓的本次药片已经取出' };
        b.removed[i] = true;
        if (s && s.compartment === i + 1) { s.removed = true; s.ringing = false; }
        b.records.push({ compartment: i + 1, taken: true, timestamp: Math.floor(clock.now() / 1000) });
        boxActivity('dose_taken', i + 1);
        note('药盒', `${i + 1} 号仓取出药片 · 已通知手机核对（不会自动记为已服药）`);
        changed(); return { ok: true, message: '已取出药片' };
      }
      case 'box.button': {
        b.buttonSeq += 1;
        boxActivity('button', b.wrong?.compartment || s?.compartment || 0);
        // 误开提示时：单击取消，双击（0.6 秒内两次）确认服用
        if (b.wrong) {
          const now = clock.now();
          if (payload.double || (lastPress && now - lastPress < 600)) {
            lastPress = 0; clearTimeout(pressTimer);
            const w = b.wrong; b.wrong = null;
            changed();
            confirmOffSchedule(w).then(async r => { note('药盒', r.text, r.ok ? 'done' : 'warn'); await refresh(true).catch(() => {}); changed(); flush(); });
            return { ok: true, message: '双击 · 确认服用' };
          }
          lastPress = now;
          clearTimeout(pressTimer);
          pressTimer = setTimeout(() => {
            if (!b.wrong || !lastPress) return;
            lastPress = 0;
            note('药盒', `单击 · 取消（${b.wrong.compartment} 号仓不记录服药）`);
            b.wrong = null; changed(); flush();
          }, 620);
          return { ok: true, message: '单击取消 · 双击确认' };
        }
        // 左滑页：按键开 / 关仅振动；右滑页：按键进入 / 结束休眠
        if (b.page === 'vibrate') { setVibrateOnly(!b.modes.vibrateOnly, '药盒按键'); b.page = 'home'; changed(); return { ok: true, message: b.modes.vibrateOnly ? '已开启仅振动' : '已关闭仅振动' }; }
        if (b.page === 'sleep') {
          if (sleepNow()) wakeUp('药盒按键'); else startSleep('nap', clock.now() + b.prefs.napMinutes * 60000, '药盒按键');
          b.page = 'home'; changed(); return { ok: true, message: sleepNow() ? '已进入休眠' : '已结束休眠' };
        }
        if (s) s.ringing = false;
        note('药盒', `按下按键${s ? ' · 停止响铃' : ''}${b.connected ? ' · 手机提示核对' : ''}`);
        changed(); return { ok: true, message: s ? '已停止响铃' : '已按下按键' };
      }
      case 'box.swipe': {
        if (!b.paired) return { ok: false, message: '药盒还没有连接安药' };
        if (b.wrong) return { ok: false, message: '请先单击取消或双击确认' };
        if (s && !s.confirmed && !s.skipped) return { ok: false, message: '正在提醒，先处理这一顿' };
        const dir = payload.dir === 'right' ? -1 : 1; // 左滑看右边一页
        const i = Math.max(0, Math.min(PAGES.length - 1, PAGES.indexOf(b.page) + dir));
        b.page = PAGES[i]; b.pageAt = clock.now();
        changed();
        return { ok: true, message: { home: '主页', vibrate: '仅振动 · 按键开关', sleep: '休眠 · 按键进入' }[b.page] };
      }
      case 'box.preview': b.previewUntil = clock.now() + 3000; changed(); return { ok: true, message: '预览 3 秒' };
      case 'box.fx': Object.assign(b.fx, payload.fx || {}); changed(); return { ok: true, message: '已更新模型效果' };
      case 'watch.raise': dev.watch.wakeSeq += 1; changed(); return { ok: true, message: '抬腕亮屏' };
      case 'watch.openPhone': return watchOpenPhone();
      case 'watch.dismiss': if (dev.watch.screen !== 'face') { dev.watch.screen = 'face'; changed(); } return { ok: true, message: '' };
      default: return { ok: false, message: '未知操作' };
    }
  }

  // 手机通知上的按钮
  async function notificationAction({ id, op }) {
    const n = dev.notifications.find(x => x.id === Number(id));
    if (!n) return { ok: false, message: '通知已过期' };
    if (op === 'dismiss') { dev.notifications = dev.notifications.filter(x => x !== n); changed(); return { ok: true }; }
    if (n.kind === 'dose' && (op === 'taken' || op === 'snooze15')) {
      const r = await patchDose(n.eventId, op === 'taken' ? { status: 'taken', time: hhmm() } : { status: 'snoozed', minutes: 15 });
      if (r.status < 400) { cancel(n.tag); note('手机', op === 'taken' ? '在通知上点了“我吃了”' : '在通知上点了“15 分钟后”', op === 'taken' ? 'done' : 'info'); }
      cache.at = 0; push({ event: 'data-changed' }); changed();
      return { ok: r.status < 400, message: r.body?.detail };
    }
    if (n.kind === 'family' && op === 'ack') { await appFetch('POST', `/api/doses/${n.eventId}/action`, { channel: 'confirm', note: '' }); cancel(n.tag); push({ event: 'data-changed' }, 'family'); return { ok: true }; }
    if (n.kind === 'family' && op === 'call') { const c = await refresh(true); broadcast('system-ui', { role: 'family', kind: 'call', name: c.family.user?.name || '家人', phone: mask(c.family.user?.phone) }); return { ok: true }; }
    if (op === 'open') {
      dev.notifications = dev.notifications.filter(x => x !== n); changed();
      if (n.kind === 'dose') push({ event: 'open-dose', eventId: n.eventId });
      if (n.kind === 'watch') push({ event: 'watch-open', notificationId: n.notificationId });
      return { ok: true };
    }
    return { ok: false, message: '未知操作' };
  }

  // 误开药仓后双击确认：记到这种药最近一顿还没记录的计划上；没有计划就记一次“临时服用”
  async function confirmOffSchedule(w) {
    if (!w.drugId) return { ok: false, text: `${w.compartment} 号仓没有登记药物，没有记录` };
    const c = await refresh(true);
    const now = hhmm();
    const open = (c.doses?.doses || []).filter(d => d.drugId === w.drugId && !['taken', 'skipped'].includes(d.status))
      .sort((a, b) => Math.abs(at(today(), a.planned) - clock.now()) - Math.abs(at(today(), b.planned) - clock.now()))[0];
    let r;
    if (open) r = await patchDose(open.eventId, { status: 'taken', time: now });
    else {
      const drug = (c.drugs || []).find(d => d.id === w.drugId);
      if (!drug) return { ok: false, text: '这种药已经从安药里删掉了，没有记录' };
      r = await appFetch('POST', '/api/intake-events', { drugId: w.drugId, time: now });
    }
    cache.at = 0;
    b_removePill(w.compartment);
    push({ event: 'data-changed' });
    if (r.status >= 400) return { ok: false, text: `记录失败：${r.body?.detail || r.status}` };
    return { ok: true, text: `双击确认 · 已记录 ${w.drugName || '药物'} ${now} 服用${open ? `（原计划 ${open.planned}，非当前时段）` : '（今日计划外）'}` };
  }
  function b_removePill(n) { dev.box.removed[n - 1] = true; dev.box.records.push({ compartment: n, taken: true, timestamp: Math.floor(clock.now() / 1000) }); changed(); }

  // 药盒正在提醒的那一顿在手机（或手表、通知）上处理掉以后，药盒的灯随之变化
  function syncBoxSession(event) {
    // 手表：这一顿在任何一端处理掉，表上的用药通知随之收起（吃了显示“已确认”）
    const w = dev.watch;
    if (event && ['taken', 'skipped', 'snoozed'].includes(event.status)) {
      for (const q of w.queue) if (q.eventId === event.id && !q.handled) { q.handled = event.status; q.handledAt = clock.now(); }
      const item = w.notification && w.queue.find(q => q.notificationId === w.notification.id);
      if (item?.eventId === event.id && ['notification', 'confirm'].includes(w.screen)) {
        if (event.status === 'taken') { w.confirmedAt = event.time; w.screen = 'records'; w.wakeSeq += 1; setTimeout(() => { if (w.screen === 'records') { w.screen = 'face'; changed(); flush(); } }, 6000); } else w.screen = 'face';
        w.notification = null; changed();
      }
    }
    const sess = dev.box.session, s = event?.status;
    if (!sess || !event || event.drugId !== sess.drugId || (event.scheduleTime || event.time) !== sess.time && event.scheduleTime !== sess.time) return;
    if (s === 'taken') { sess.confirmed = event.time; sess.ringing = false; note('药盒', `收到手机确认 · ${sess.compartment} 号仓转绿灯`, 'done'); }
    if (s === 'skipped') { sess.skipped = true; sess.ringing = false; if (!dev.box.outer) dev.box.session = null; }
    if (s === 'snoozed') { sess.ringing = false; dev.box.session = null; note('药盒', '稍后提醒 · 熄灯，到时间再提醒'); }
    changed();
  }
  async function patchDose(eventId, body) {
    const r = await appFetch('PATCH', `/api/intake-events/${eventId}`, body);
    if (r.status < 400) { cache.at = 0; syncBoxSession(r.body); }
    return r;
  }

  // 演示：药盒连上后自动装药 —— 每种按时吃的药放进一个仓位、下发提醒、登记仓位份数（1.3.0 药仓账本）
  async function autoLoadPlans() {
    const b = dev.box, c = await refresh(true);
    const fixed = (c.drugs || []).filter(d => !d.asNeeded && (d.times || []).length).slice(0, 4);
    if (!fixed.length) return;
    b.plans = fixed.map((d, i) => ({ compartment: i + 1, times: [...new Set(d.times)].sort().slice(0, 9), drugId: d.id, drugName: d.name }));
    b.plansPushedAt = clock.now();
    for (const p of b.plans) {
      const r1 = await appFetch('PATCH', `/api/pillbox/slots/${p.compartment}`, { deviceId: BOX_ID, drugId: p.drugId });
      const r2 = await appFetch('POST', `/api/pillbox/slots/${p.compartment}/stock`, { deviceId: BOX_ID, kind: 'set', amount: 14, requestId: crypto.randomUUID() });
      if (r1.status >= 400 || r2.status >= 400) console.error('autoLoad slot', p.compartment, r1.status, JSON.stringify(r1.body), r2.status, JSON.stringify(r2.body));
    }
    await appFetch('POST', '/api/pillbox/activate', { deviceId: BOX_ID });
    // 已经过去的时间点不补响
    const date = today(); for (const p of b.plans) for (const t of p.times) if (at(date, t) <= clock.now()) b.fired[`${date} ${t} ${p.compartment}`] = clock.now();
    note('药盒', `已自动装药并下发：${b.plans.map(p => `${p.compartment}号仓 ${p.drugName} ${p.times.join('/')}`).join('；')}`, 'done');
    push({ event: 'data-changed' });
  }
  // 家庭同步：演示里数据就在本机服务，连上即同步
  const syncState = () => ({ url: dev.sync.url, online: !!dev.sync.url, lastSuccessAt: dev.sync.url ? (dev.sync.lastSuccessAt = clock.now()) : 0, pending: 0, error: '' });
  // ---------- MainActivity.handle() ----------
  const READY = () => ({ notificationsAllowed: true, exactAllowed: true, batteryUnrestricted: true, backgroundRestricted: false, fullScreenAllowed: true, quiet: false, ringerMode: 2, alarmVolume: 5,
    scheduledCount: Object.keys(dev.ledger).length, error: '', smsAllowed: dev.perms.sms, role: dev.role,
    deviceGuide: { id: 'xiaomi', name: '小米 / Redmi / POCO', instruction: '打开后台自启动，并把省电策略设为“无限制”。', autostartVerifiable: false, autostartSettings: true }, lastDelivery: dev.lastDelivery });
  const callReadiness = () => {
    const ok = dev.perms.call && dev.perms.state;
    return { ready: ok, code: ok ? 'ready' : 'call_permission', reason: ok ? '' : '需要允许“拨打电话”', callPermission: dev.perms.call, statePermission: dev.perms.state, busy: false };
  };
  const systemScreen = (role, title) => { broadcast('system-ui', { role, kind: 'settings', title }); return { opened: true }; };

  async function api(req, role) {
    const method = String(req.method || 'GET').toUpperCase(), path = String(req.path || '');
    const [route] = path.split('?');
    let body = req.body || {};
    // 原生 Store 才有的家属自动通知字段：本层保存，server.js 只存其余字段
    if (route === '/api/family' && method === 'PATCH') {
      const f = dev.family, c = await refresh(true);
      const { autoNotify, autoCall, autoCallContactId, ...rest } = body;
      if (autoNotify !== undefined) { if (typeof autoNotify !== 'boolean') return { status: 400, body: { error: 'bad_request', detail: 'invalid_autoNotify' } }; f.autoNotify = autoNotify; }
      if (autoCallContactId !== undefined) f.autoCallContactId = String(autoCallContactId || '');
      if (autoCall !== undefined) {
        if (typeof autoCall !== 'boolean') return { status: 400, body: { error: 'bad_request', detail: 'invalid_autoCall' } };
        const contacts = rest.contacts || c.family.contacts || [];
        if (autoCall && !contacts.some(x => x.id === f.autoCallContactId)) return { status: 400, body: { error: 'bad_request', detail: '请先选择要打给哪位家属' } };
        if (autoCall && !f.autoCall) f.autoCallSince = iso();
        f.autoCall = autoCall;
      }
      changed();
      const r = Object.keys(rest).length ? await appFetch('PATCH', path, rest) : await appFetch('GET', '/api/family');
      if (r.status < 400) r.body = { ...r.body, ...dev.family };
      cache.at = 0; setTimeout(() => refresh(true).then(() => { changed(); flush(); }).catch(() => {}), 30);
      return r;
    }
    if (route === '/api/restore' && method === 'POST') { dev.watch.queue = []; dev.watch.notification = null; }
    const r = await appFetch(method, path, method === 'GET' ? undefined : body);
    if (route === '/api/family' && r.status < 400) r.body = { ...r.body, ...dev.family };
    if (method !== 'GET' && r.status < 400) { cache.at = 0; changed(); setTimeout(() => refresh(true).then(reminderTick).then(() => { changed(); flush(); }).catch(() => {}), 30); }
    if (method === 'PATCH' && /^\/api\/intake-events\//.test(route) && r.status < 400) {
      const s = r.body?.status;
      if (['taken', 'skipped'].includes(s)) { cancel('dose:' + r.body.id); note(role === 'family' ? '家属端' : '手机', `${r.body.drug?.name || ''} ${s === 'taken' ? `已服药 ${r.body.time}` : '本次不吃'}`, s === 'taken' ? 'done' : 'warn'); }
      else if (s === 'snoozed') note('手机', `${r.body.drug?.name || ''} 稍后提醒`, 'info');
      syncBoxSession(r.body);
    }
    return r;
  }

  async function handle(req, role = 'user') {
    const out = { id: req.id };
    try {
      let body;
      switch (req.action) {
        case 'api': { const r = await api(req, role); out.status = r.status; body = r.body; break; }
        case 'setRole': if (!['user', 'family', ''].includes(req.role)) throw Error('身份无效'); dev.role = req.role || 'user'; changed(); body = { role: dev.role }; break;
        case 'syncStatus': case 'syncNow': body = syncState(); break;
        case 'setSync': {
          const url = String(req.url || '').trim();
          if (!url) { dev.sync.url = ''; changed(); body = syncState(); break; }
          let parsed; try { parsed = new URL(/^https?:\/\//.test(url) ? url : 'https://' + url); } catch { throw Error('地址格式不对'); }
          if (parsed.protocol !== 'https:' && !['127.0.0.1', 'localhost'].includes(parsed.hostname)) throw Error('安卓版只能连接 https 地址，请给家庭服务配置证书');
          dev.sync.url = parsed.origin; dev.sync.lastSuccessAt = clock.now(); changed();
          note('手机', `已设置家庭服务 ${parsed.origin}（演示：数据仍保存在本机服务）`);
          body = syncState(); break;
        }
        case 'appInfo': body = { versionName: '1.3.0', versionCode: 30, model: 'Xiaomi Civi 4 Pro · 演示' }; break;
        case 'reminderStatus': case 'reminderPermissions': body = READY(); break;
        case 'reminderPreview': {
          const c = await refresh(true);
          if (c.settings.phone) notify(role, { tag: 'preview', kind: 'preview', title: '试一下提醒', text: '这就是到点时的提醒效果' });
          body = { ...effects(c.settings, role, true), notified: !!c.settings.phone };
          note('手机', `试一下提醒：${body.done.join('、') || '无'}`);
          break;
        }
        case 'reminderNotificationSettings': body = systemScreen(role, '通知管理'); break;
        case 'reminderTimingPermission': body = systemScreen(role, '闹钟和提醒'); break;
        case 'reminderBatterySettings': body = systemScreen(role, '省电策略：无限制'); break;
        case 'reminderFullScreenSettings': body = systemScreen(role, '全屏通知'); break;
        case 'reminderAppSettings': body = systemScreen(role, '应用信息 · 安药'); break;
        case 'reminderAutostartSettings': body = systemScreen(role, '自启动管理'); break;
        case 'callSettings': body = systemScreen(role, '默认拨出卡'); break;
        case 'dial': { const p = String(req.phone || '').replace(/[^\d+]/g, ''); if (p.length < 3) throw Error('手机号不对'); broadcast('system-ui', { role, kind: 'call', phone: mask(p) }); note('手机', `打开拨号 ${mask(p)}（演示，未真实拨号）`); body = { opened: true }; break; }
        case 'sms': { const p = String(req.phone || '').replace(/[^\d+]/g, ''); if (p.length < 3) throw Error('手机号不对'); broadcast('system-ui', { role, kind: 'sms', phone: mask(p), text: req.text }); note('手机', `打开短信 ${mask(p)}（演示，未真实发送）`); body = { opened: true }; break; }
        case 'email': if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(req.to || '')) throw Error('邮箱地址不对'); broadcast('system-ui', { role, kind: 'email', to: req.to, text: req.text }); body = { opened: true }; break;
        case 'wechat': broadcast('system-ui', { role, kind: 'wechat', text: req.text }); note('手机', '提醒文字已复制，打开微信（演示）'); body = { opened: true, copied: true }; break;
        case 'share': broadcast('system-ui', { role, kind: 'share', text: req.text }); body = { opened: true }; break;
        case 'familyAutoStatus': body = { granted: dev.perms.sms }; break;
        case 'familyAutoPermission': dev.perms.sms = true; changed(); broadcast('system-ui', { role, kind: 'permission', title: '已允许“发送短信”' }); body = { granted: true }; break;
        case 'exportBackup': { const r = await appFetch('GET', '/api/export'); broadcast('backup', { role, name: `安药备份-${today()}.json`, data: r.body }); body = { exported: true }; break; }
        case 'callStatus': body = { ...callReadiness(), attempts: dev.attempts }; break;
        case 'callPermission': dev.perms.call = dev.perms.state = true; changed(); broadcast('system-ui', { role, kind: 'permission', title: '已允许“拨打电话”和“电话状态”' }); body = callReadiness(); break;
        case 'device': body = await deviceOp({ ...req, op: req.op }); break;
        case 'watch': body = await watchOp(req); break;
        default: throw Error('不支持的操作');
      }
      out.ok = true; out.body = body;
    } catch (error) { out.ok = false; out.error = error.message || '操作失败'; }
    flush();
    return out;
  }

  // ---------- 大屏视图 ----------
  function view() {
    const b = dev.box, w = dev.watch, s = b.session, now = clock.now();
    const doses = cache.doses?.doses || [];
    const taken = doses.filter(d => d.status === 'taken').map(d => d.time).sort();
    const doneKeys = new Set(doses.filter(d => ['taken', 'skipped'].includes(d.status)).map(d => `${d.drugId}@${d.planned}`));
    const nextPlan = b.plans.flatMap(p => p.times.filter(time => !doneKeys.has(`${p.drugId}@${time}`)).map(time => ({ time, compartment: p.compartment, drugName: p.drugName }))).filter(x => x.time > hhmm()).sort((x, y) => x.time.localeCompare(y.time))[0] || null;
    let effect = 'off', target = s?.compartment || 0;
    if (b.wrong) { effect = 'wrong'; target = b.wrong.compartment; }
    else if (b.findUntil > now) { effect = 'find'; target = 0; }
    else if (b.previewUntil > now) { effect = 'preview'; target = target || nextPlan?.compartment || 1; }
    else if (s?.ringing) effect = 'reminder';
    else if (s?.confirmed && b.outer) effect = 'confirmed';
    else if (s && !s.skipped && !s.confirmed) effect = 'awaiting';
    let screen = 'standby';
    if (!b.paired) screen = 'unpaired';
    else if (b.wrong) screen = 'wrong';
    else if (s && !s.skipped && !s.confirmed) screen = s.removed ? 'awaiting' : !b.outer ? 'reminder' : !b.inner[s.compartment - 1] ? 'open' : 'take';
    else if (s?.confirmed) screen = b.outer ? 'confirmed' : 'standby';
    else if (s?.skipped && b.outer) screen = 'closing';
    if (screen === 'standby') screen = b.page !== 'home' ? b.page : sleepNow() ? 'asleep' : 'standby';
    const compOf = drugId => b.plans.find(p => p.drugId === drugId)?.compartment || 0;
    const lastDose = doses.filter(d => d.status === 'taken' && d.time).sort((x, y) => x.time.localeCompare(y.time)).at(-1);
    const sl = sleepNow();
    const modes = { vibrateOnly: !!b.modes.vibrateOnly, level: b.prefs.vibrateLevel, levelName: LEVEL_NAME[b.prefs.vibrateLevel], napMinutes: b.prefs.napMinutes, prefs: b.prefs,
      sleep: sl ? { kind: sl.kind, until: hhmm(sl.until), held: heldCount() } : null };
    const watchDose = doses.find(d => ['due', 'missed', 'delay'].includes(d.level)) || doses.find(d => d.level === 'pending');
    return {
      now, clock: hhmm(), date: today(), offset: clock.offset,
      doses, drugs: cache.drugs || [], family: cache.family, settings: cache.settings,
      box: { paired: b.paired, connected: b.connected, battery: b.battery, plans: b.plans, outer: b.outer, inner: b.inner, removed: b.removed, buttonSeq: b.buttonSeq,
        // 仅振动：按手机设置的强度震动，指示灯不亮（误开红灯照常）
        fx: modes.vibrateOnly && effect !== 'wrong' ? { ...b.fx, mode: b.prefs.vibrateLevel, vibration: true, led: false } : b.fx,
        effect, target, screen, wrong: b.wrong ? { compartment: b.wrong.compartment, drugName: b.wrong.drugName, times: b.wrong.times, expected: b.wrong.expected } : null, session: s ? { compartment: s.compartment, time: s.time, drugName: s.drugName, removed: s.removed, confirmed: s.confirmed || null, ringing: s.ringing } : null,
        next: nextPlan, last: taken.at(-1) || null, records: b.records.length, activity: b.activity,
        lastDose: lastDose ? { time: lastDose.time, compartment: compOf(lastDose.drugId), drugName: lastDose.drug?.name || '' } : null, page: b.page, modes },
      watch: { paired: w.paired, connected: w.paired && w.authenticated, enabled: w.enabled, vibrationEnabled: w.vibrationEnabled, battery: w.battery, screen: w.screen,
        notification: w.notification, notifySeq: w.notifySeq, buzzSeq: w.buzzSeq, wakeSeq: w.wakeSeq,
        next: watchDose ? { name: watchDose.drug?.name, dose: watchDose.drug?.dose, time: watchDose.planned } : null, last: taken.at(-1) || null },
      notifications: dev.notifications.slice(0, 6),
      log: log.slice(0, 30),
    };
  }

  // 主循环
  let busy = false;
  const timer = setInterval(async () => {
    if (busy) return; busy = true;
    try { modesTick(); await reminderTick(); boxTick(); const b = dev.box; if ((b.findUntil && b.findUntil < clock.now()) || (b.previewUntil && b.previewUntil < clock.now())) { b.findUntil = b.previewUntil = 0; changed(); } flush(); }
    catch (error) { console.error('tick', error.message); }
    finally { busy = false; }
  }, 1000);
  timer.unref?.();
  // 每 30 秒刷新一次大屏，让时钟、计划状态跟上
  setInterval(() => { refresh(true).then(() => broadcast('state', view())).catch(() => {}); }, 15000).unref?.();

  return {
    handle, physical: (t, p) => { const r = physical(t, p); flush(); return r; }, notificationAction: async p => { const r = await notificationAction(p); flush(); return r; },
    view, refresh, note, get raw() { return dev; }, set raw(v) { dev = v; changed(); flush(); }, fresh: freshDevices, BOX_ID, WATCH_ID, hhmm, today, at,
    async afterClockChange() { cache.at = 0; await refresh(true); modesTick(); await reminderTick(); boxTick(); changed(); flush(); },
    markPastDelivered(doses) { for (const d of doses) { if (Date.parse(d.dueAt) > clock.now()) continue; dev.ledger[`${d.eventId}:due`] = clock.now(); dev.ledger[`${d.eventId}:missed:${Date.parse(d.dueAt)}`] = clock.now(); } changed(); },
    markBoxPastFired() { const date = today(); for (const p of dev.box.plans) for (const t of p.times) if (at(date, t) <= clock.now()) dev.box.fired[`${date} ${t} ${p.compartment}`] = clock.now(); changed(); },
  };
}

module.exports = { createDevices, freshDevices };
