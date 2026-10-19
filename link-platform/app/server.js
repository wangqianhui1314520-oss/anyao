/* 安药本机数据服务：用药计划、服药记录、提醒设置、药盒记录。
   桌面预览用 node server.js 启动；安卓端由原生层提供同一组接口。 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = __dirname;
const ReminderModel = require('./reminder-model.js');
const PillboxModel = require('./pillbox-model.js');
const PillboxLedger = require('./pillbox-ledger.js');
const PillboxBehavior = require('./pillbox-behavior.js');
const localDate = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
function createServer(options = {}) {
 const accessToken = options.accessToken ?? process.env.ACCESS_TOKEN ?? '';
 const shared = !!accessToken;
 const dbPath = options.dataPath || process.env.DATA_PATH || path.join(root, 'data.json');
 const seed = { drugs: options.demo === true && !shared ? [{ id: 'd1', name: '莫达非尼', dose: '100mg', inventory: 12, times: ['07:00', '12:00', '18:00'] }] : [], intakeEvents: [], refills: [], audit: [], hipeeHistory: [], pillboxLedger: PillboxLedger.empty(), settings: { vibration: true, sound: true, flash: true, phone: true, autoSnooze: true, pillboxBehavior: PillboxBehavior.defaults() }, alerts: [], family: { user: null, contacts: [], missedAfterMinutes: 30, channels: { wechat: true, sms: true, email: false, call: true } } };
 let db = JSON.parse(JSON.stringify(seed));
 if (fs.existsSync(dbPath)) {
  try { db = JSON.parse(fs.readFileSync(dbPath, 'utf8')); if (!db || typeof db !== 'object' || Array.isArray(db)) throw Error('invalid'); }
  catch (e) { /* 云端必须保留权威数据，读取失败时拒绝启动，不能悄悄换成空库。 */
   if (shared) throw Error('database_unreadable_refusing_empty_reset', { cause: e });
   try { fs.writeFileSync(dbPath + '.corrupt-' + Date.now() + '.json', fs.readFileSync(dbPath)); } catch { }
   db = JSON.parse(JSON.stringify(seed));
  }
 }
 // 只保留本版本仍在使用的数据结构，旧版本遗留的其它集合在读入时清掉。
 for (const key of Object.keys(db)) if (!['drugs', 'intakeEvents', 'refills', 'audit', 'hipeeHistory', 'pillboxLedger', 'settings', 'alerts', 'family', 'meta'].includes(key)) delete db[key];
 for (const key of ['drugs', 'intakeEvents', 'refills', 'audit', 'hipeeHistory', 'alerts']) db[key] ||= [];
 db.settings ||= seed.settings;
 db.settings.pillboxBehavior ??= PillboxBehavior.defaults();
 db.pillboxLedger ??= PillboxLedger.empty();
 db.family ||= { ...seed.family };
 db.family.contacts ||= [];
 db.family.channels = { ...seed.family.channels, ...db.family.channels };
 if (!Number.isFinite(db.family.missedAfterMinutes)) db.family.missedAfterMinutes = seed.family.missedAfterMinutes;
 db.meta ||= {};
 if (db.audit.length > 5000) db.audit.splice(0, db.audit.length - 5000);
 let inTransaction = false, pendingWrite = false, requestQueue = Promise.resolve();
 const persist = () => {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true, mode: 0o700 });
  const temporary = dbPath + '.tmp-' + crypto.randomUUID();
  let fd, replaced = false;
  try {
   fd = fs.openSync(temporary, 'wx', 0o600);
   fs.writeFileSync(fd, JSON.stringify(db, null, 2)); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
   fs.renameSync(temporary, dbPath); replaced = true;
   if (process.platform !== 'win32') { const directory = fs.openSync(path.dirname(dbPath), 'r'); try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); } }
  } catch (e) { e.databaseReplaced = replaced; throw e; } finally {
   if (fd !== undefined) fs.closeSync(fd);
   try { fs.unlinkSync(temporary); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
 };
 const save = () => { if (inTransaction) pendingWrite = true; else persist(); };
 // Receipt payloads are immutable strings. Copy their array without repeatedly
 // parsing up to 32 MiB during every short status poll or nested transaction.
 const draft = data => {
  const receipts = data.meta?.syncReceipts || [];
  const next = JSON.parse(JSON.stringify({ ...data, meta: { ...data.meta, syncReceipts: [] } }));
  next.meta.syncReceipts = receipts.slice(); return next;
 };
 // Draft the complete transaction so validation or persistence failure cannot leave half a debit.
 const commit = operation => { const previous = db; db = draft(db); try { const result = operation(); save(); return result; } catch (e) { db = previous; throw e; } };
 const id = prefix => prefix + '_' + crypto.randomUUID();
 const json = (res, status, data) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(data)); };
 const fail = message => { throw Error(message); };
 const str = (v, k, required = false) => { if (v === undefined && !required) return undefined; if (typeof v !== 'string' || v.length > 1000 || (required && !v.trim())) fail('invalid_' + k); return v.trim(); };
 const num = (v, k) => { if (v === undefined || !Number.isFinite(Number(v)) || Number(v) < 0 || Number(v) > 100000) fail('invalid_' + k); return Number(v); };
 const date = v => { if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v + 'T00:00:00Z')) || new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) !== v) fail('invalid_date'); return v; };
 const timestamp = (v, k) => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.test(v) || !Number.isFinite(Date.parse(v))) fail('invalid_' + k);
  date(v.slice(0, 10)); return Date.parse(v);
 };
 /* 姓名、手机号、邮箱：给出能看懂的中文错误，前端直接显示 */
 const name = (v, k) => { const t = str(v, k, true); if (t.length > 40) fail('姓名不能超过 40 个字'); return t; };
 const phone = (v, k) => { const t = str(v, k, true).replace(/[\s-]/g, ''); if (!/^\+?\d{5,20}$/.test(t)) fail('请填写正确的手机号'); return t; };
 const email = v => { if (v === undefined || v === null || v === '') return ''; const t = str(v, 'email'); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) fail('请填写正确的邮箱地址'); return t; };
 const time = v => { if (typeof v !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) fail('invalid_time'); return v; };
 async function body(req, limit = 65536) {
  if (req.anyaoBody !== undefined) return req.anyaoBody;
  const chunks = []; let length = 0;
  for await (const c of req) { length += c.length; if (length > limit) fail('body_too_large'); chunks.push(c); }
  const wire = Buffer.concat(chunks).toString('utf8'); let b;
  try { b = wire ? JSON.parse(wire) : {}; } catch { fail('invalid_json'); }
  if (!b || Array.isArray(b) || typeof b !== 'object') fail('invalid_body');
  req.anyaoBody = b; req.anyaoWire = wire; return b;
 }
 const audit = (action, recordId) => db.audit.push({ id: id('a'), action, recordId, at: new Date().toISOString() });
 /* 按用药计划生成待服用记录。除了今天，还会补上“上次生成之后、应用没打开的那几天”（最多 31 天），
    这样漏开应用的日子也会算进依从性与月历，不会被当成“没有计划”。 */
 const dayOffset = k => localDate(new Date(Date.now() - k * 864e5));
 function schedule() {
  let changed = false;
  const today = localDate();
  const last = typeof db.meta.lastScheduled === 'string' ? db.meta.lastScheduled : today;
  const days = [];
  for (let k = 31; k >= 1; k--) { const d = dayOffset(k); if (d > last) days.push(d); }
  days.push(today);
  for (const d of db.drugs) {
   if (d.asNeeded) continue;
   const created = d.at ? localDate(new Date(d.at)) : today;
   const times = d.times || [];
   for (const day of days) {
    if (day < created) continue;
    for (const t of times) if (!db.intakeEvents.some(e => e.drugId === d.id && e.date === day && (e.scheduleTime || e.time) === t)) {
     db.intakeEvents.push({ id: id('i'), drugId: d.id, date: day, time: t, scheduleTime: t, status: 'scheduled' });
     changed = true;
    }
   }
  }
  if (db.meta.lastScheduled !== today) { db.meta.lastScheduled = today; changed = true; }
  if (db.intakeEvents.length > 20000) { db.intakeEvents.sort((a, b) => a.date.localeCompare(b.date)); db.intakeEvents.splice(0, db.intakeEvents.length - 20000); PillboxLedger.retainEvents(db.pillboxLedger, db.intakeEvents); changed = true; }
  if (changed) save();
 }
 const minutesOf = t => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
 /* 实际记录时间比计划晚 10 分钟以上才算补服，和前端的口径一致 */
 const isLate = e => e.status === 'taken' && !!e.scheduleTime && e.time !== e.scheduleTime && minutesOf(e.time) - minutesOf(e.scheduleTime) >= 10;
 const events = all => { schedule(); return db.intakeEvents.filter(e => all || e.date === localDate()).map(e => ({ ...e, drug: db.drugs.find(d => d.id === e.drugId) })) };
 /* 家属端看到的每一条服药状态：按计划时间算“还没到点 / 到点未服 / 超时未服 / 已补服”，
    再挂上家属已经做过的动作（打电话、发微信、确认）。两边读的是同一份当天记录。 */
 function doseStates() {
  schedule();
  const latest = new Map();
  for (const a of db.alerts) { const prev = latest.get(a.eventId); if (!prev || Date.parse(a.at) >= Date.parse(prev.at)) latest.set(a.eventId, a); }
  const missedAfter = db.family.missedAfterMinutes, now = Date.now();
  return db.intakeEvents.filter(e => e.date === localDate() && !e.asNeeded).map(e => {
   const planned = e.scheduleTime || e.time;
   const due = Date.parse(`${e.date}T${planned}:00+08:00`);
   /* 说好晚点吃：在约定时间之前算“稍后吃”，过了约定时间重新变成该吃 / 还没吃 */
   const until = e.status === 'snoozed' && e.snoozedUntil ? Date.parse(e.snoozedUntil) : NaN;
   const ref = Number.isFinite(until) ? until : due;
   const level = e.status === 'taken' ? (isLate(e) ? 'late' : 'taken')
    : e.status === 'skipped' ? 'skipped'
    : e.status === 'snoozed' && (!Number.isFinite(until) || now < until) ? 'delay'
    : Number.isFinite(ref) && now - ref >= missedAfter * 60000 ? 'missed'
    : Number.isFinite(ref) && now >= ref ? 'due' : 'pending';
   const drug = db.drugs.find(d => d.id === e.drugId);
   return {
    eventId: e.id, level, time: e.time, planned, date: e.date, status: e.status, snoozedUntil: e.snoozedUntil || null, dueAt: new Date(due).toISOString(),
    drugId: e.drugId, inventoryDeducted: e.inventoryDeducted !== false,
    drug: drug ? { name: drug.name, dose: drug.dose || '', note: drug.note || '' } : null,
    action: latest.get(e.id) || null
   };
  }).sort((a, b) => a.planned.localeCompare(b.planned));
 }
 /* 未处理的状态会浮到最前面，已服用与已跳过的沉到下面。 */
 const alertRank = { missed: 0, due: 1, delay: 2, late: 3, pending: 4, taken: 5, skipped: 6 };
 const familyPatch = b => {
  const next = {};
  if (b.user !== undefined) {
   if (b.user === null) next.user = null;
   else { if (!b.user || typeof b.user !== 'object' || Array.isArray(b.user)) fail('invalid_user'); next.user = { id: str(b.user.id, 'user_id') || id('u'), name: name(b.user.name, 'user_name'), phone: phone(b.user.phone, 'user_phone'), email: email(b.user.email) }; }
  }
  if (b.contacts !== undefined) {
   if (!Array.isArray(b.contacts) || b.contacts.length > 20) fail('invalid_contacts');
   next.contacts = b.contacts.map(c => { if (!c || typeof c !== 'object' || Array.isArray(c)) fail('invalid_contact'); return { id: str(c.id, 'contact_id') || id('c'), name: name(c.name, 'contact_name'), phone: phone(c.phone, 'contact_phone'), relation: str(c.relation, 'contact_relation') || '', email: email(c.email) }; });
  }
  if (b.missedAfterMinutes !== undefined) { const n = num(b.missedAfterMinutes, 'missedAfterMinutes'); if (n < 5 || n > 240) fail('invalid_missed_after'); next.missedAfterMinutes = Math.round(n); }
  if (b.channels !== undefined) {
   if (!b.channels || typeof b.channels !== 'object' || Array.isArray(b.channels)) fail('invalid_channels');
   const channels = { ...db.family.channels };
   for (const k of Object.keys(channels)) { if (b.channels[k] === undefined) continue; if (typeof b.channels[k] !== 'boolean') fail('invalid_channel_' + k); channels[k] = b.channels[k]; }
   next.channels = channels;
  }
  return next;
 };
 function drugFields(b, partial = false) {
  const r = {};
  if (b.name !== undefined || !partial) r.name = str(b.name, 'name', true);
  if (b.dose !== undefined) r.dose = str(b.dose, 'dose');
  if (b.note !== undefined) r.note = str(b.note, 'note');
  if (b.inventory !== undefined || !partial) r.inventory = num(b.inventory ?? 0, 'inventory');
  if (b.asNeeded !== undefined) { if (typeof b.asNeeded !== 'boolean') fail('invalid_asNeeded'); r.asNeeded = b.asNeeded; }
  if (b.times !== undefined || b.time !== undefined || !partial) {
   const times = b.times || [b.time || '12:00'];
   if (!Array.isArray(times) || times.length > 24) fail('invalid_times');
   r.times = [...new Set(times.map(time))];
  }
  return r;
 }
 function validateRestore(b) {
  if (b.schemaVersion !== 1) fail('unsupported_schema_version');
  if (!b.settings || typeof b.settings !== 'object' || Array.isArray(b.settings)) fail('invalid_settings');
  for (const k of ['vibration', 'sound', 'flash', 'phone', 'autoSnooze']) if (typeof b.settings[k] !== 'boolean') fail('invalid_settings_' + k);
  const clean = { settings: { ...b.settings } };
  clean.settings.pillboxBehavior = b.settings.pillboxBehavior === undefined ? PillboxBehavior.defaults() : PillboxBehavior.validateSettings(b.settings.pillboxBehavior);
  if (b.settings.reminderProfiles !== undefined) clean.settings.reminderProfiles = ReminderModel.profiles(b.settings.reminderProfiles);
  if (b.settings.reminderModes !== undefined) clean.settings.reminderModes = ReminderModel.modes(b.settings.reminderModes);
  if (b.settings.reminderModeId !== undefined) { if (typeof b.settings.reminderModeId !== 'string') fail('invalid_reminderModeId'); clean.settings.reminderModeId = ReminderModel.activeMode(clean.settings)?.id || ''; }
  for (const k of ['drugs', 'intakeEvents', 'refills', 'audit']) {
   const list = b[k];
   if (!Array.isArray(list) || list.length > 20000) fail('invalid_' + k);
   const ids = new Set();
   clean[k] = list.map(r => { if (!r || typeof r !== 'object' || Array.isArray(r)) fail('invalid_' + k + '_record'); str(r.id, k + '_id', true); if (ids.has(r.id)) fail('duplicate_' + k + '_id'); ids.add(r.id); return { ...r }; });
  }
  for (const d of clean.drugs) { str(d.name, 'drug_name', true); num(d.inventory, 'inventory'); if (d.times !== undefined) { if (!Array.isArray(d.times) || d.times.length > 24) fail('invalid_times'); d.times.forEach(time); } }
  const drugIds = new Set(clean.drugs.map(d => d.id));
  for (const e of clean.intakeEvents) { str(e.drugId, 'intake_drug_reference', true); if (!drugIds.has(e.drugId) && !['taken', 'skipped'].includes(e.status)) fail('invalid_intake_drug_reference'); date(e.date); time(e.time); if (e.scheduleTime !== undefined) time(e.scheduleTime); if (!['taken', 'scheduled', 'skipped', 'snoozed'].includes(e.status)) fail('invalid_status'); }
  for (const r of clean.refills) { str(r.drugId, 'refill_drug_reference', true); if (num(r.amount, 'amount') <= 0) fail('invalid_amount'); }
  if (b.hipeeHistory !== undefined && (!Array.isArray(b.hipeeHistory) || b.hipeeHistory.length > 100)) fail('invalid_hipee_history');
  const boxIds = new Set();
  clean.hipeeHistory = (b.hipeeHistory || []).map(v => { const h = PillboxModel.normalize(v); if (boxIds.has(h.deviceId)) fail('duplicate_hipee_device'); boxIds.add(h.deviceId); return h; });
  clean.pillboxLedger = b.pillboxLedger === undefined ? PillboxLedger.empty() : PillboxLedger.validate(b.pillboxLedger, clean.intakeEvents, clean.hipeeHistory);
  /* 家属绑定、联系人与家属动作也在备份里，恢复时一并校验后带回来 */
  clean.family = { user: null, contacts: [], missedAfterMinutes: 30, channels: { ...seed.family.channels } };
  if (b.family !== undefined) {
   if (!b.family || typeof b.family !== 'object' || Array.isArray(b.family)) fail('invalid_family');
   const saved = db.family; db.family = clean.family;
   try { Object.assign(clean.family, familyPatch(b.family)); } finally { db.family = saved; }
  }
  if (b.alerts !== undefined && (!Array.isArray(b.alerts) || b.alerts.length > 10000)) fail('invalid_alerts');
  const eventIds = new Set(clean.intakeEvents.map(e => e.id));
  clean.alerts = (b.alerts || []).filter(a => a && typeof a === 'object' && eventIds.has(a.eventId) && ['call', 'wechat', 'sms', 'email', 'confirm'].includes(a.channel) && Number.isFinite(Date.parse(a.at)))
   .map(a => ({ id: str(a.id, 'alert_id') || id('n'), eventId: a.eventId, channel: a.channel, note: str(a.note, 'note') || '', by: str(a.by, 'by') || 'family', at: new Date(a.at).toISOString() })).slice(-500);
  clean.meta = { lastScheduled: localDate() };
  return clean;
 }
 /* 家庭访问码：设置了 ACCESS_TOKEN 时，所有 /api 请求都要带 x-anyao-key。
    用于把这台服务放到家里的电脑 / 云主机上，让服药者和家属的两部手机读同一份记录。 */
 const authorized = req => {
  if (!accessToken) return true;
  const given = Buffer.from(String(req.headers?.['x-anyao-key'] || ''));
  const expected = Buffer.from(accessToken);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
 };
 const MAX_RECEIPTS = 10000, MAX_RECEIPT_BYTES = 32 * 1024 * 1024;
 db.meta.syncRevision = Number.isSafeInteger(db.meta.syncRevision) && db.meta.syncRevision >= 0 ? db.meta.syncRevision : 0;
 db.meta.syncReceipts ??= [];
 if (!Array.isArray(db.meta.syncReceipts) || db.meta.syncReceipts.length > MAX_RECEIPTS || Buffer.byteLength(JSON.stringify(db.meta.syncReceipts)) > MAX_RECEIPT_BYTES) throw Error('invalid_sync_receipts');
 const hasUserData = () => db.meta.syncInitialized === true || ['drugs', 'intakeEvents', 'refills', 'audit', 'hipeeHistory', 'alerts'].some(k => db[k].length > 0)
  || JSON.stringify(db.settings) !== JSON.stringify(seed.settings) || JSON.stringify(db.family) !== JSON.stringify(seed.family)
  || Object.keys(db.pillboxLedger.devices || {}).length > 0 || (db.pillboxLedger.journal || []).length > 0;
 const syncStatus = () => ({
  revision: db.meta.syncRevision, serverTime: new Date().toISOString(), initialized: hasUserData(), shared,
  counts: { drugs: db.drugs.length, intakeEvents: db.intakeEvents.length, refills: db.refills.length, familyContacts: db.family.contacts.length, familyActions: db.alerts.length, pillboxDevices: db.hipeeHistory.length },
  idempotency: { required: shared, receipts: db.meta.syncReceipts.length, capacity: MAX_RECEIPTS, maxBytes: MAX_RECEIPT_BYTES }
 });
 async function api(req, res, url) {
  try {
   const p = url.pathname, m = req.method;
   if (p === '/api/health') return json(res, 200, { ok: true, auth: !!accessToken });
   if (!authorized(req)) return json(res, 401, { error: 'unauthorized', detail: '家庭访问码不对，请在“设置 → 同步与访问”里重新填写' });
   if (m === 'GET' && p === '/api/sync/status') return json(res, 200, syncStatus());
   if (m === 'POST' && p === '/api/sync/bootstrap') {
    if (hasUserData()) return json(res, 409, { error: 'already_initialized', detail: '服务器已有家庭数据，请连接同步，不能用本地备份覆盖' });
    const restored = validateRestore(await body(req, 8 * 1024 * 1024));
    db = { ...restored, meta: { ...db.meta, ...restored.meta, syncInitialized: true } };
    audit('sync.bootstrap', 'shared'); save();
    return json(res, 200, { imported: true, counts: syncStatus().counts });
   }
   if (m === 'GET' && p === '/api/pillbox') return json(res, 200, PillboxLedger.view(db.pillboxLedger, url.searchParams.get('deviceId'), db.drugs, db.hipeeHistory));
   if (m === 'POST' && p === '/api/pillbox/activate') {
    const b = await body(req);
    return json(res, 200, commit(() => { PillboxLedger.activate(db.pillboxLedger, b); return PillboxLedger.view(db.pillboxLedger, b.deviceId, db.drugs, db.hipeeHistory); }));
   }
   const boxSlot = p.match(/^\/api\/pillbox\/slots\/(\d+)(?:\/(stock|open))?$/);
   if (boxSlot) {
    const action = boxSlot[2] || '', n = Number(boxSlot[1]);
    if ((!action && m !== 'PATCH') || (action && m !== 'POST')) return json(res, 404, { error: 'not_found' });
    const b = await body(req);
    return json(res, 200, commit(() => {
     if (!action) PillboxLedger.assign(db.pillboxLedger, n, b, db.drugs);
     else if (action === 'stock') PillboxLedger.stock(db.pillboxLedger, n, b);
     else PillboxLedger.open(db.pillboxLedger, n, b, db.hipeeHistory);
     return PillboxLedger.view(db.pillboxLedger, b.deviceId, db.drugs, db.hipeeHistory);
    }));
   }
   if (m === 'POST' && p === '/api/restore') {
    if (shared) return json(res, 403, { error: 'remote_restore_disabled', detail: '家庭云端不支持覆盖恢复，请先导出备份并联系服务管理员' });
    const restored = validateRestore(await body(req, 8 * 1024 * 1024));
    const backupPath = dbPath + '.before-restore-' + Date.now() + '.json';
    fs.mkdirSync(path.dirname(dbPath), { recursive: true, mode: 0o700 }); fs.writeFileSync(backupPath, JSON.stringify(db, null, 2), { flag: 'wx', mode: 0o600 });
    const previous = db; db = { ...restored, meta: { ...db.meta, ...restored.meta } };
    try { audit('backup.restore', 'local'); save(); } catch (e) { db = previous; throw e; }
    return json(res, 200, { restored: true, backupCreated: true });
   }
   if (m === 'GET' && p === '/api/hipee-history') return json(res, 200, db.hipeeHistory);
   if (m === 'POST' && p === '/api/hipee-history/import') {
    const record = PillboxModel.normalize(await body(req, 8 * 1024 * 1024)), previous = db.hipeeHistory;
    const index = previous.findIndex(x => x.deviceId === record.deviceId);
    if (index >= 0) record.records = PillboxModel.merge(previous[index].records, record.records);
    else if (previous.length >= 100) fail('hipee_devices_too_many');
    record.recordCount = record.records.length;
    const next = [...previous];
    if (index >= 0) next[index] = record; else next.unshift(record);
    const auditLength = db.audit.length; db.hipeeHistory = next;
    try { audit('pillbox.history_import', record.deviceId); save(); } catch (e) { db.hipeeHistory = previous; db.audit.length = auditLength; throw e; }
    return json(res, 200, record);
   }
   if (m === 'GET' && p === '/api/today') return json(res, 200, { date: localDate(), events: events(false), settings: db.settings });
   if (m === 'GET' && p === '/api/settings') return json(res, 200, db.settings);
   if (m === 'PATCH' && p === '/api/settings') {
    const patch = await body(req), previous = db.settings;
    const next = ReminderModel.settingsPatch(db.settings, patch);
    if (Object.hasOwn(patch, 'pillboxBehavior')) next.pillboxBehavior = PillboxBehavior.validateSettings(patch.pillboxBehavior);
    db.settings = next;
    try { save(); } catch (e) { db.settings = previous; throw e; }
    return json(res, 200, db.settings);
   }
   if (m === 'POST' && p === '/api/intake-events') {
    /* 需要时才吃的药：每吃一次记一条，扣一次库存 */
    const b = await body(req);
    const drug = db.drugs.find(d => d.id === b.drugId);
    if (!drug) return json(res, 404, { error: 'not_found', detail: '找不到这种药' });
    const t = b.time === undefined ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date()) : time(b.time);
    return json(res, 201, commit(() => {
     const currentDrug = db.drugs.find(d => d.id === drug.id);
     const event = { id: id('i'), drugId: currentDrug.id, date: localDate(), time: t, scheduleTime: t, status: 'taken', asNeeded: true, updatedAt: new Date().toISOString() };
     PillboxLedger.taken(db.pillboxLedger, event, currentDrug);
     event.inventoryDeducted = currentDrug.inventory >= 1; if (event.inventoryDeducted) currentDrug.inventory--;
     db.intakeEvents.push(event); audit('intake.as_needed', event.id);
     return { ...event, drug: currentDrug };
    }));
   }
   if (m === 'GET' && p === '/api/intake-events') return json(res, 200, events(url.searchParams.get('all') === 'true'));
   const intake = p.match(/^\/api\/intake-events\/([^/]+)$/);
   if (intake && m === 'PATCH') {
    if (!db.intakeEvents.some(e => e.id === intake[1])) return json(res, 404, { error: 'not_found' });
    const b = await body(req);
    if (!['taken', 'skipped', 'scheduled', 'snoozed'].includes(b.status)) fail('invalid_status');
    const existingEvent = db.intakeEvents.find(e => e.id === intake[1]);
    if (['scheduled', 'snoozed'].includes(b.status) && !db.drugs.some(d => d.id === existingEvent.drugId)) fail('invalid_intake_drug_reference');
    const t = b.time === undefined ? undefined : time(b.time);
    const minutes = b.status === 'snoozed' ? (b.minutes === undefined ? 30 : num(b.minutes, 'minutes')) : null;
    if (b.status === 'snoozed' && ![10, 15, 30, 60, 120].includes(minutes)) fail('invalid_minutes');
    let snoozedUntil;
    if (b.status === 'snoozed' && (b.requestedAt !== undefined || b.snoozedUntil !== undefined)) {
     const requestedAt = timestamp(b.requestedAt, 'requestedAt'), until = timestamp(b.snoozedUntil, 'snoozedUntil');
     if (requestedAt > Date.now() + 5 * 60000 || until - requestedAt !== minutes * 60000) fail('invalid_snooze_window');
     // A delayed offline replay keeps the original deadline, even if already past.
     snoozedUntil = new Date(until).toISOString();
    }
    return json(res, 200, commit(() => {
    const event = db.intakeEvents.find(e => e.id === intake[1]);
    if (event.status !== b.status) {
     const drug = db.drugs.find(d => d.id === event.drugId);
     if (b.status === 'taken') PillboxLedger.taken(db.pillboxLedger, event, drug);
     if (event.status === 'taken') PillboxLedger.undoTaken(db.pillboxLedger, event);
     if (drug && b.status === 'taken') { event.inventoryDeducted = drug.inventory >= 1; if (event.inventoryDeducted) drug.inventory--; }
     if (drug && event.status === 'taken' && event.inventoryDeducted !== false) { drug.inventory++; event.inventoryDeducted = false; }
     event.status = b.status; event.updatedAt = new Date().toISOString();
     audit('intake.' + event.status, event.id);
    }
    if (t !== undefined) { event.scheduleTime ||= event.time; event.time = t; }
    /* 改回还没吃 / 这次不吃：记录的钟点回到计划时间，避免把旧的服药时间带过去 */
    if (b.status !== 'taken' && t === undefined && event.scheduleTime) event.time = event.scheduleTime;
    /* 晚点再吃：记下约好的时间，到点后重新变成该吃 */
    if (b.status === 'snoozed') {
     event.snoozedUntil = snoozedUntil || new Date(Date.now() + minutes * 60000).toISOString();
    } else delete event.snoozedUntil;
    return { ...event, drug: db.drugs.find(d => d.id === event.drugId) };
    }));
   }
   if (m === 'GET' && p === '/api/adherence') {
    schedule();
    /* 还没到点的那几顿不算没吃：只统计已经到点的、已经吃过的和明确不吃的 */
    const now = Date.now();
    const counted = db.intakeEvents.filter(e => !e.asNeeded && (e.status === 'taken' || e.status === 'skipped' || Date.parse(`${e.date}T${e.scheduleTime || e.time}:00+08:00`) <= now));
    const taken = counted.filter(e => e.status === 'taken').length, days = {};
    for (const e of counted) { days[e.date] ||= { date: e.date, taken: 0, total: 0, late: 0, skipped: 0 }; const d = days[e.date]; d.total++; if (e.status === 'taken') { d.taken++; if (isLate(e)) d.late++; } if (e.status === 'skipped') d.skipped++; }
    const list = Object.values(days).sort((a, b) => a.date.localeCompare(b.date));
    const since = k => { const from = localDate(new Date(now - (k - 1) * 864e5)); const r = list.filter(d => d.date >= from); const t = r.reduce((s, d) => s + d.total, 0), k2 = r.reduce((s, d) => s + d.taken, 0); return { taken: k2, total: t, percent: t ? Math.round(100 * k2 / t) : 0 }; };
    return json(res, 200, { taken, total: counted.length, percent: counted.length ? Math.round(100 * taken / counted.length) : 0, week: since(7), month: since(30), days: list });
   }
   if (m === 'GET' && (p === '/api/export' || p === '/api/backup')) {
    res.setHeader('content-disposition', `attachment; filename="anyao-${localDate()}.json"`);
    // 网络重试回执只属于服务器，不放入可迁移的患者备份。
    return json(res, 200, { schemaVersion: 1, exportedAt: new Date().toISOString(), ...db, meta: { lastScheduled: db.meta.lastScheduled } });
   }
   if (m === 'GET' && p === '/api/refills') return json(res, 200, db.refills);
   const refill = p.match(/^\/api\/drugs\/([^/]+)\/refill$/);
   if (refill && m === 'POST') {
    const drug = db.drugs.find(d => d.id === refill[1]);
    if (!drug) return json(res, 404, { error: 'not_found' });
    const amount = num((await body(req)).amount, 'amount');
    if (amount <= 0) fail('invalid_amount');
    drug.inventory += amount;
    const record = { id: id('r'), drugId: drug.id, amount, at: new Date().toISOString() };
    db.refills.unshift(record);
    audit('inventory.refill', drug.id); save();
    return json(res, 201, { ...record, drug });
   }
   if (p === '/api/drugs' && m === 'GET') return json(res, 200, db.drugs);
   if (p === '/api/drugs' && m === 'POST') {
    const record = { ...drugFields(await body(req)), id: id('d'), at: new Date().toISOString() };
    db.drugs.unshift(record);
    audit('drugs.create', record.id); schedule(); save();
    return json(res, 201, record);
   }
   const drug = p.match(/^\/api\/drugs\/([^/]+)$/);
   if (drug) {
    const index = db.drugs.findIndex(x => x.id === drug[1]);
    if (index < 0) return json(res, 404, { error: 'not_found' });
    if (m === 'GET') return json(res, 200, db.drugs[index]);
    if (m === 'PATCH') {
     const update = drugFields(await body(req), true);
     Object.assign(db.drugs[index], update, { updatedAt: new Date().toISOString() });
     if (update.times !== undefined || update.asNeeded !== undefined) {
      const d = db.drugs[index];
      // 时间变化后，清掉今天还没处理过的旧待服用记录，再按新时间重新生成。
      db.intakeEvents = db.intakeEvents.filter(e => e.drugId !== d.id || e.date !== localDate() || ['taken', 'skipped'].includes(e.status) || (!d.asNeeded && (d.times || []).includes(e.scheduleTime || e.time)));
      schedule();
     }
     audit('drugs.update', drug[1]); save();
     return json(res, 200, db.drugs[index]);
    }
    if (m === 'DELETE') {
     db.drugs.splice(index, 1);
     db.intakeEvents = db.intakeEvents.filter(e => e.drugId !== drug[1] || ['taken', 'skipped'].includes(e.status));
     audit('drugs.delete', drug[1]); save();
     return json(res, 200, { deleted: true });
    }
   }
   if (m === 'GET' && p === '/api/family') return json(res, 200, { user: db.family.user, contacts: db.family.contacts, missedAfterMinutes: db.family.missedAfterMinutes, channels: db.family.channels });
   if (m === 'PATCH' && p === '/api/family') {
    const previous = db.family;
    db.family = { ...db.family, ...familyPatch(await body(req)) };
    try { audit('family.update', 'local'); save(); } catch (e) { db.family = previous; throw e; }
    return json(res, 200, { user: db.family.user, contacts: db.family.contacts, missedAfterMinutes: db.family.missedAfterMinutes, channels: db.family.channels });
   }
   if (m === 'GET' && p === '/api/doses') {
    const list = doseStates().sort((a, b) => (alertRank[a.level] - alertRank[b.level]) || a.planned.localeCompare(b.planned));
    return json(res, 200, { date: localDate(), missedAfterMinutes: db.family.missedAfterMinutes, doses: list, user: db.family.user });
   }
   const punch = p.match(/^\/api\/doses\/([^/]+)\/action$/);
   if (punch && m === 'POST') {
    const event = db.intakeEvents.find(e => e.id === punch[1]);
    if (!event) return json(res, 404, { error: 'not_found' });
    const b = await body(req);
    if (!['call', 'wechat', 'sms', 'email', 'confirm'].includes(b.channel)) fail('invalid_channel');
    const by = typeof b.by === 'string' && db.family.contacts.some(c => c.id === b.by) ? b.by : 'family';
    const record = { id: id('n'), eventId: event.id, channel: b.channel, note: (str(b.note, 'note') || '').slice(0, 200), by, at: new Date().toISOString() };
    db.alerts.push(record);
    if (db.alerts.length > 500) db.alerts.splice(0, db.alerts.length - 500);
    audit('family.' + record.channel, event.id); save();
    return json(res, 201, record);
   }
   if (m === 'GET' && p === '/api/family-log') {
    const events = new Map(db.intakeEvents.map(e => [e.id, e]));
    return json(res, 200, [...db.alerts].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 50).map(a => {
     const e = events.get(a.eventId);
     const drug = e ? db.drugs.find(d => d.id === e.drugId) : null;
     return { ...a, dose: e ? { date: e.date, planned: e.scheduleTime || e.time } : null, drug: drug ? { name: drug.name, dose: drug.dose || '' } : null };
    }));
   }
   return json(res, 404, { error: 'not_found' });
  } catch (e) { return json(res, 400, { error: 'bad_request', detail: e.message }); }
 }
 // Serialize the household database. A mutation and its replay receipt share one
 // atomic, fsynced file replacement; a lost HTTP response cannot debit twice.
 async function handleApi(req, res, url) {
  if (url.pathname === '/api/health') return api(req, res, url);
  if (!authorized(req)) return json(res, 401, { error: 'unauthorized', detail: '家庭访问码不对，请在“设置 → 同步与访问”里重新填写' });
  const override = req.headers['x-http-method-override'];
  if (override !== undefined) {
   if (req.method !== 'POST' || String(override).toUpperCase() !== 'PATCH') return json(res, 400, { error: 'invalid_method_override' });
   req.method = 'PATCH';
  }
  const mutation = ['POST', 'PATCH', 'DELETE'].includes(req.method);
  if (shared && mutation && url.pathname === '/api/restore') return json(res, 403, { error: 'remote_restore_disabled', detail: '家庭云端不支持覆盖恢复' });
  const requestId = typeof req.headers['x-anyao-request-id'] === 'string' ? req.headers['x-anyao-request-id'].toLowerCase() : undefined;
  if (mutation && ((shared && !requestId) || (requestId && !/^(?:[a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})$/i.test(requestId)))) {
   return json(res, 400, { error: 'invalid_request_id', detail: '请升级应用后重试：云端操作需要唯一请求编号' });
  }
  let fingerprint;
  try {
   if (mutation) {
    const large = ['/api/sync/bootstrap', '/api/restore', '/api/hipee-history/import'].includes(url.pathname);
    await body(req, large ? 8 * 1024 * 1024 : 65536);
    fingerprint = crypto.createHash('sha256').update(req.method + '\n' + url.pathname + url.search + '\n' + req.anyaoWire).digest('hex');
   }
  } catch (e) { return json(res, e.message === 'body_too_large' ? 413 : 400, { error: e.message }); }
  const task = async () => {
   if (mutation && requestId) {
    const receipt = db.meta.syncReceipts.find(r => r.requestId === requestId);
    if (receipt) {
     if (receipt.fingerprint !== fingerprint) return json(res, 409, { error: 'request_id_conflict', detail: '同一请求编号不能用于不同操作' });
     res.setHeader('x-anyao-replayed', 'true'); res.setHeader('x-anyao-revision', String(db.meta.syncRevision));
     res.writeHead(receipt.status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); return res.end(receipt.payload);
    }
    if (db.meta.syncReceipts.length >= MAX_RECEIPTS) return json(res, 507, { error: 'receipt_capacity_reached', detail: '同步回执已满，请联系管理员归档，操作尚未执行' });
   }
   const previous = db;
   db = draft(db); pendingWrite = false; inTransaction = true;
   const captured = { status: 200, headers: {}, payload: '', setHeader(k, v) { this.headers[k] = v; }, writeHead(s, h = {}) { this.status = s; Object.assign(this.headers, h); }, end(p = '') { this.payload = String(p); } };
   try {
    await api(req, captured, url);
    inTransaction = false;
    if (captured.status >= 400) db = previous;
    else if (mutation || pendingWrite) {
     db.meta.syncRevision = previous.meta.syncRevision + 1;
     db.meta.syncUpdatedAt = new Date().toISOString();
     if (mutation) db.meta.syncInitialized = true;
     if (mutation && requestId) {
      db.meta.syncReceipts.push({ requestId, fingerprint, status: captured.status, payload: captured.payload, revision: db.meta.syncRevision, at: db.meta.syncUpdatedAt });
      if (Buffer.byteLength(JSON.stringify(db.meta.syncReceipts)) > MAX_RECEIPT_BYTES) {
       db = previous; return json(res, 507, { error: 'receipt_capacity_reached', detail: '同步回执已满，操作尚未执行' });
      }
     }
     persist();
    }
    res.setHeader('x-anyao-revision', String(db.meta.syncRevision));
    res.writeHead(captured.status, captured.headers); return res.end(captured.payload);
   } catch (e) {
    if (!e.databaseReplaced) db = previous;
    // The response never exposes filesystem paths, tokens, or raw system errors.
    console.error('anyao request persistence failed:', e.code || e.name);
    return json(res, 500, { error: 'storage_unavailable', detail: '服务器未能保存操作，请保留请求编号后重试' });
   } finally { inTransaction = false; pendingWrite = false; }
  };
  const queued = requestQueue.then(task);
  requestQueue = queued.catch(() => {});
  return queued;
 }
 const PREVIEW_RELOAD = (source) => {
  const tag = String.fromCharCode(60) + 'script>(' +
   '()=>{let rev=null;setInterval(async()=>{try{const r=await(await fetch("/__preview-rev",{cache:"no-store"})).json();if(rev!==null&&r.rev!==rev)location.reload();rev=r.rev}catch{}},1500)})()' +
   String.fromCharCode(60) + '/script>';
  return source.includes('</body>') ? source.replace('</body>', tag + '</body>') : source + tag;
 };
 const allowed = new Set(['entry.html', 'index.html', 'family.html', 'assets.css', 'mira.css', 'app.css', 'app-core.js', 'ui.js', 'family.js', 'reminder-model.js', 'reminder-ui.js', 'pillbox-model.js', 'pillbox-ui.js', 'pillbox-ledger.js', 'pillbox-behavior.js', 'pillbox-records-ui.js', 'watch-ui.js', 'hipee-protocol.js', 'reminder-engine.js', 'device-bridge.js', 'native-client.js', 'sync-client.js', 'manifest.webmanifest', 'sw.js', 'icon.svg', 'fonts.css', 'fonts/anyao-sans-light.woff2', 'fonts/anyao-sans-regular.woff2', 'fonts/anyao-sans-bold.woff2']);
 return http.createServer((req, res) => {
  let u;
  try { u = new URL(req.url, 'http://localhost'); } catch { return json(res, 400, { error: 'invalid_url' }); }
  /* 只有启用了家庭访问码才允许跨源访问（单文件 HTML 连家里的服务时需要）；没有访问码时不开放，避免其它网页读到本机记录 */
  if (u.pathname.startsWith('/api/') && accessToken && req.headers.origin) {
   res.setHeader('access-control-allow-origin', '*');
   res.setHeader('access-control-allow-headers', 'content-type, x-anyao-key, x-anyao-request-id, x-http-method-override');
   res.setHeader('access-control-expose-headers', 'x-anyao-revision, x-anyao-replayed');
   res.setHeader('access-control-allow-methods', 'GET, POST, PATCH, DELETE, OPTIONS');
   res.setHeader('access-control-max-age', '600');
   if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  }
  if (u.pathname.startsWith('/api/')) { handleApi(req, res, u).catch(() => { if (!res.headersSent) json(res, 500, { error: 'server_error' }); else res.end(); }); return; }
  if (u.pathname === '/__preview-rev') { let rev = 0; for (const f of allowed) { try { rev = Math.max(rev, fs.statSync(path.join(root, f)).mtimeMs); } catch { } } return json(res, 200, { rev }); }
  if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, { error: 'method_not_allowed' });
  const file = u.pathname === '/' ? 'index.html' : u.pathname.slice(1);
  if (!allowed.has(file)) return json(res, 404, { error: 'not_found' });
  const full = path.join(root, file);
  if (!fs.existsSync(full)) return json(res, 404, { error: 'not_found' });
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
  res.writeHead(200, { 'content-type': types[path.extname(full)] || 'application/octet-stream', 'x-content-type-options': 'nosniff', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY' });
  if (req.method === 'HEAD') return res.end();
  if (file.endsWith('.html')) return res.end(options.liveReload === false || process.env.LIVE_RELOAD === '0' ? fs.readFileSync(full) : PREVIEW_RELOAD(fs.readFileSync(full, 'utf8')));
  fs.createReadStream(full).pipe(res);
 });
}
if (require.main === module) {
 const host = process.env.HOST || '127.0.0.1', port = Number(process.env.PORT || 4173);
 if (process.env.REQUIRE_AUTH === '1' && !process.env.ACCESS_TOKEN) { console.error('云端模式需要 ACCESS_TOKEN，已拒绝启动。'); process.exit(1); }
 if (!['127.0.0.1', 'localhost', '::1'].includes(host) && !process.env.ACCESS_TOKEN) { console.error('对局域网或公网开放时必须设置 ACCESS_TOKEN（家庭访问码），已拒绝启动。'); process.exit(1); }
 const server = createServer({ demo: process.env.DEMO_DATA === '1' });
 server.requestTimeout = 45000; server.headersTimeout = 15000;
 server.listen(port, host, () => console.log('anyao listening on http://' + host + ':' + port + (process.env.ACCESS_TOKEN ? '  (已启用家庭访问码)' : '')));
 let stopping = false;
 const stop = () => { if (stopping) return; stopping = true; server.close(() => process.exit(0)); setTimeout(() => process.exit(1), 15000).unref(); };
 process.on('SIGTERM', stop); process.on('SIGINT', stop);
}
module.exports = { createServer, localDate };
