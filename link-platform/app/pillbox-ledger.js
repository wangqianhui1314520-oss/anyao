/* User-confirmed portions ledger. Keep raw device evidence separate from intake. */
'use strict';
const crypto = require('node:crypto');
const MAX_DEVICES = 100, MAX_JOURNAL = 10000, MAX_REQUESTS = 20000, MAX_ALLOCATIONS = 20000, MAX_PORTIONS = 100000;
const own = (o, key) => Object.hasOwn(o, key);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const clone = value => JSON.parse(JSON.stringify(value));
const fail = error => { throw Error(error); };
const requireValue = (condition, error) => { if (!condition) fail(error); };
const put = (o, key, value) => Object.defineProperty(o, key, { value, enumerable: true, writable: true, configurable: true });
const id = () => 'pb_' + crypto.randomUUID();
const iso = now => new Date(now).toISOString();
const dateFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' });
const day = now => dateFormatter.format(new Date(now));
const integer = (value, error, max = MAX_PORTIONS) => { requireValue(typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= max, error); return value; };
const text = (value, error, max = 200, allowEmpty = true) => { requireValue(typeof value === 'string' && value.length <= max && (allowEmpty || value.trim().length > 0), error); return value; };
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
const timestamp = (value, error, optional = false) => {
 if (optional && value == null) return;
 requireValue(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && validDate(value.slice(0, 10)) && Number.isFinite(Date.parse(value)), error);
};
function deviceId(value) {
 requireValue(typeof value === 'string' && value.length <= 32, 'invalid_pillbox_device_id');
 if (value === 'local') return value;
 requireValue(/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(value), 'invalid_pillbox_device_id');
 return value.toUpperCase();
}
const empty = () => ({ version: 1, activeDeviceId: 'local', devices: {}, journal: [], allocations: {} });
const freshSlot = compartment => ({ compartment, drugId: '', drugName: '', dose: '', remaining: null, openedTotal: 0, consumedTotal: 0, daily: {}, lastOpenedAt: null, stockUpdatedAt: null, stockNeedsReview: false, stockIssue: '', cycle: id(), stockEpoch: id() });
const freshDevice = () => ({ slots: [1, 2, 3, 4].map(freshSlot), requests: {}, claims: {} });
function device(state, key) {
 if (own(state.devices, key)) return state.devices[key];
 requireValue(Object.keys(state.devices).length < MAX_DEVICES, 'pillbox_devices_full');
 const result = freshDevice(); put(state.devices, key, result); return result;
}
function slot(d, n) { requireValue(Number.isInteger(n) && n >= 1 && n <= 4, 'invalid_pillbox_compartment'); return d.slots[n - 1]; }
function request(d, body, signature) {
 const key = text(body.requestId, 'invalid_pillbox_request_id', 120, false);
 if (own(d.requests, key)) { requireValue(d.requests[key] === signature, 'pillbox_request_id_conflict'); return false; }
 requireValue(Object.keys(d.requests).length < MAX_REQUESTS, 'pillbox_requests_full_export_backup');
 put(d.requests, key, signature); return true;
}
const record = (state, row) => { requireValue(state.journal.length < MAX_JOURNAL, 'pillbox_journal_full_export_backup'); state.journal.push(row); };
const row = (kind, deviceId, compartment, at, source) => ({ id: id(), kind, deviceId, compartment, at, source });
function count(s, at, field, delta, now) {
 const total = field === 'opened' ? 'openedTotal' : 'consumedTotal';
 s[total] = Math.max(0, s[total] + delta);
 const date = day(Date.parse(at)), today = day(now), cutoff = day(now - 31 * 86400000);
 if (date >= cutoff && date <= today) {
  if (!own(s.daily, date)) put(s.daily, date, { opened: 0, consumed: 0 });
  s.daily[date][field] = Math.max(0, s.daily[date][field] + delta);
 }
 for (const key of Object.keys(s.daily)) if (key < cutoff || key > today) delete s.daily[key];
}
function recordKey(r) {
 if (r.eventType !== undefined) return `event:${r.eventType}:${r.compartment}:${r.timestamp}`;
 if (r.rawFlag !== undefined) {
  const bytes = typeof r.rawFrame === 'string' ? r.rawFrame.split(' ').map(x => parseInt(x, 16)) : null;
  return `raw:${bytes?.[1] ?? r.rawState ?? r.recordIndex ?? r.compartment ?? 0}:${r.rawFlag}:${r.timestamp}`;
 }
 return `decoded:${r.compartment}:${r.reportedTaken ?? r.taken ?? false}:${r.timestamp}`;
}
const sourceRows = (history, key) => history.find(h => String(h.deviceId).toUpperCase() === key)?.records || [];
function view(state, requestedDevice, drugs, history, now = Date.now()) {
 const key = deviceId(requestedDevice ?? state.activeDeviceId ?? 'local');
 const d = own(state.devices, key) ? state.devices[key] : freshDevice();
 const drugMap = new Map(drugs.map(d => [d.id, d]));
 const slots = d.slots.map(s => {
  const drug = drugMap.get(s.drugId), daily = s.daily[day(now)];
  return { compartment: s.compartment, drugId: s.drugId, drugName: drug?.name ?? s.drugName, dose: drug?.dose ?? s.dose, drugAvailable: !!drug,
   remaining: s.remaining, unit: '份', openedToday: daily?.opened ?? 0, openedTotal: s.openedTotal, consumedToday: daily?.consumed ?? 0, consumedTotal: s.consumedTotal,
   lastOpenedAt: s.lastOpenedAt, stockUpdatedAt: s.stockUpdatedAt, stockNeedsReview: s.stockNeedsReview, stockIssue: s.stockIssue };
 });
 const deviceName = history.find(h => String(h.deviceId).toUpperCase() === key)?.deviceName ?? '药盒';
 const unassignedRecords = sourceRows(history, key).filter(r => !own(d.claims, recordKey(r))).sort((a, b) => b.timestamp - a.timestamp)
  .map(r => ({ key: recordKey(r), timestamp: r.timestamp, deviceName, interpretation: 'unconfirmed' }));
 return { deviceIds: Object.keys(state.devices), deviceId: key, activeDeviceId: state.activeDeviceId, slots, journal: state.journal.filter(r => r.deviceId === key).slice().reverse(), unassignedRecords, unit: '份', measurement: 'user-confirmed' };
}
function activate(state, body) { const key = deviceId(body.deviceId); device(state, key); state.activeDeviceId = key; }
function assign(state, n, body, drugs, now = Date.now()) {
 const key = deviceId(body.deviceId), drugId = body.drugId === null ? '' : text(body.drugId, 'invalid_pillbox_drug', 100);
 const drug = drugId === '' ? null : drugs.find(d => d.id === drugId);
 requireValue(drugId === '' || drug, 'pillbox_drug_not_found');
 const d = device(state, key), s = slot(d, n);
 requireValue(!d.slots.some(x => x.compartment !== n && drugId !== '' && x.drugId === drugId), 'pillbox_drug_already_assigned');
 state.activeDeviceId = key;
 if (s.drugId === drugId) return;
 const beforeDrugId = s.drugId;
 Object.assign(s, { drugId, drugName: drug?.name ?? '', dose: drug?.dose ?? '', remaining: null, stockUpdatedAt: null, cycle: id(), stockEpoch: id(), stockNeedsReview: false, stockIssue: '' });
 record(state, { ...row('assign', key, n, iso(now), 'user'), drugId, drugName: drug?.name ?? '', beforeDrugId });
}
function stock(state, n, body, now = Date.now()) {
 const key = deviceId(body.deviceId), kind = text(body.kind, 'invalid_pillbox_stock_kind', 10, false);
 requireValue(['set', 'add'].includes(kind), 'invalid_pillbox_stock_kind');
 const amount = integer(body.amount, 'invalid_pillbox_portions');
 requireValue(kind !== 'add' || amount > 0, 'invalid_pillbox_portions');
 const d = device(state, key), s = slot(d, n);
 if (!request(d, body, JSON.stringify(['stock', n, kind, amount]))) return;
 requireValue(s.drugId !== '', 'pillbox_assign_drug_first');
 if (kind === 'add') requireValue(s.remaining !== null, 'pillbox_count_stock_first');
 const before = s.remaining, after = kind === 'set' ? amount : before + amount;
 requireValue(after <= MAX_PORTIONS, 'invalid_pillbox_portions');
 if (kind === 'add') {
  const undoRoom = Object.values(state.allocations).filter(a => a.deviceId === key && a.compartment === n && a.cycle === s.cycle && a.stockEpoch === s.stockEpoch && a.deducted).reduce((sum, a) => sum + a.amount, 0);
  requireValue(after + undoRoom <= MAX_PORTIONS, 'invalid_pillbox_portions');
 }
 Object.assign(s, { remaining: after, stockUpdatedAt: iso(now) });
 if (kind === 'set') Object.assign(s, { stockEpoch: id(), stockNeedsReview: false, stockIssue: '' });
 state.activeDeviceId = key;
 record(state, { ...row('stock-' + kind, key, n, iso(now), 'user'), amount, before, after, drugName: s.drugName });
}
function open(state, n, body, history, now = Date.now()) {
 const key = deviceId(body.deviceId), sourceKey = own(body, 'sourceKey') ? text(body.sourceKey, 'invalid_pillbox_source_key', 200, false) : null;
 const d = device(state, key), s = slot(d, n);
 if (!request(d, body, JSON.stringify(['open', n, sourceKey ?? '']))) return;
 const source = sourceKey === null ? null : sourceRows(history, key).find(r => recordKey(r) === sourceKey);
 requireValue(sourceKey === null || source, 'pillbox_source_not_found');
 requireValue(sourceKey === null || !own(d.claims, sourceKey), 'pillbox_source_already_assigned');
 const at = source ? iso(source.timestamp * 1000) : iso(now);
 const r = { ...row('open', key, n, at, source ? 'pillbox-history-user-confirmed' : 'manual-user-confirmed'), confirmedAt: iso(now), drugName: s.drugName };
 if (sourceKey !== null) { r.sourceKey = sourceKey; put(d.claims, sourceKey, { compartment: n, openId: r.id }); }
 count(s, at, 'opened', 1, now);
 if (s.lastOpenedAt === null || s.lastOpenedAt < at) s.lastOpenedAt = at;
 state.activeDeviceId = key; record(state, r);
}
function taken(state, event, drug, now = Date.now()) {
 if (own(state.allocations, event.id)) return;
 const key = state.activeDeviceId ?? 'local', d = own(state.devices, key) ? state.devices[key] : null;
 const s = d?.slots.find(s => s.drugId === event.drugId);
 if (!s) return;
 requireValue(Object.keys(state.allocations).length < MAX_ALLOCATIONS, 'pillbox_allocations_full_export_backup');
 const known = s.remaining !== null, before = s.remaining, deducted = known && before >= 1;
 if (deducted) s.remaining--; else Object.assign(s, { stockNeedsReview: true, stockIssue: known ? 'insufficient' : 'unset' });
 count(s, iso(now), 'consumed', 1, now);
 const r = { ...row('taken', key, s.compartment, iso(now), 'medication-confirmation'), eventId: event.id, amount: 1, deducted, before, after: s.remaining, drugName: drug?.name ?? s.drugName };
 put(state.allocations, event.id, { deviceId: key, compartment: s.compartment, cycle: s.cycle, stockEpoch: s.stockEpoch, amount: 1, deducted, at: iso(now), journalId: r.id, drugId: event.drugId, drugName: r.drugName });
 record(state, r);
}
function undoTaken(state, event, now = Date.now()) {
 if (!own(state.allocations, event.id)) return;
 const a = state.allocations[event.id], d = own(state.devices, a.deviceId) ? state.devices[a.deviceId] : null;
 requireValue(d, 'pillbox_allocation_device_missing');
 const s = slot(d, a.compartment), sameStock = s.cycle === a.cycle && s.stockEpoch === a.stockEpoch;
 const restored = a.deducted && sameStock && s.remaining !== null, before = s.remaining;
 if (restored) { requireValue(s.remaining + a.amount <= MAX_PORTIONS, 'invalid_pillbox_portions'); s.remaining += a.amount; }
 count(s, a.at, 'consumed', -1, now);
 record(state, { ...row('undo-taken', a.deviceId, s.compartment, iso(now), 'medication-confirmation'), eventId: event.id, amount: a.amount, before, after: s.remaining, restored, originalJournalId: a.journalId, drugName: a.drugName, stockBaselineChanged: !sameStock });
 delete state.allocations[event.id];
}
function retainEvents(state, events) { const ids = new Set(events.map(e => e.id)); for (const key of Object.keys(state.allocations)) if (!ids.has(key)) delete state.allocations[key]; }
function validate(raw, intakeEvents, history = []) {
 requireValue(object(raw), 'invalid_pillbox_ledger');
 const s = clone(raw);
 requireValue(integer(s.version, 'invalid_pillbox_version', 1) === 1, 'invalid_pillbox_version');
 const active = deviceId(s.activeDeviceId);
 requireValue(s.activeDeviceId === active, 'invalid_pillbox_device_id');
 requireValue(object(s.devices) && Object.keys(s.devices).length <= MAX_DEVICES, 'invalid_pillbox_devices');
 for (const [key, d] of Object.entries(s.devices)) {
  requireValue(deviceId(key) === key, 'invalid_pillbox_device_id'); requireValue(object(d), 'invalid_pillbox_device');
  requireValue(Array.isArray(d.slots) && d.slots.length === 4, 'invalid_pillbox_slots');
  const assigned = new Set();
  d.slots.forEach((slot, i) => {
   requireValue(object(slot), 'invalid_pillbox_slots');
   requireValue(integer(slot.compartment, 'invalid_pillbox_compartment', 4) === i + 1, 'invalid_pillbox_compartment');
   const drugId = text(slot.drugId, 'invalid_pillbox_drug', 100);
   requireValue(drugId === '' || !assigned.has(drugId), 'pillbox_drug_already_assigned'); assigned.add(drugId);
   text(slot.drugName, 'invalid_pillbox_drug_name', 1000); text(slot.dose, 'invalid_pillbox_dose', 1000);
   requireValue(own(slot, 'remaining'), 'invalid_pillbox_remaining'); if (slot.remaining !== null) integer(slot.remaining, 'invalid_pillbox_remaining');
   requireValue(drugId !== '' || slot.remaining === null, 'invalid_pillbox_unassigned_stock');
   for (const field of ['openedTotal', 'consumedTotal']) integer(slot[field], 'invalid_pillbox_counter', 2147483647);
   for (const field of ['cycle', 'stockEpoch']) text(slot[field], 'invalid_pillbox_cycle', 100, false);
   for (const field of ['lastOpenedAt', 'stockUpdatedAt']) timestamp(slot[field], 'invalid_pillbox_timestamp', true);
   requireValue(typeof slot.stockNeedsReview === 'boolean', 'invalid_pillbox_stock_review'); requireValue(['', 'unset', 'insufficient'].includes(slot.stockIssue), 'invalid_pillbox_stock_issue');
   requireValue(slot.stockNeedsReview === (slot.stockIssue !== ''), 'invalid_pillbox_stock_issue');
   requireValue(object(slot.daily) && Object.keys(slot.daily).length <= 100, 'invalid_pillbox_daily');
   for (const [date, count] of Object.entries(slot.daily)) { requireValue(validDate(date), 'invalid_pillbox_daily_date'); requireValue(object(count), 'invalid_pillbox_daily'); for (const field of ['opened', 'consumed']) integer(count[field], 'invalid_pillbox_counter', 2147483647); }
  });
  requireValue(object(d.requests) && Object.keys(d.requests).length <= MAX_REQUESTS, 'invalid_pillbox_requests');
  for (const [rid, receipt] of Object.entries(d.requests)) {
   text(rid, 'invalid_pillbox_request_id', 120, false); text(receipt, 'invalid_pillbox_receipt', 1000, false);
   let signature; try { signature = JSON.parse(receipt); } catch { fail('invalid_pillbox_receipt'); }
   requireValue(Array.isArray(signature) && signature.length >= 3 && signature.length <= 4, 'invalid_pillbox_receipt');
   requireValue(integer(signature[1], 'invalid_pillbox_receipt', 4) >= 1, 'invalid_pillbox_receipt');
   if (signature[0] === 'stock') {
    requireValue(signature.length === 4 && ['set', 'add'].includes(signature[2]), 'invalid_pillbox_receipt');
    const amount = integer(signature[3], 'invalid_pillbox_receipt'); requireValue(signature[2] !== 'add' || amount > 0, 'invalid_pillbox_receipt');
   } else if (signature[0] === 'open') { requireValue(signature.length === 3, 'invalid_pillbox_receipt'); text(signature[2], 'invalid_pillbox_receipt', 200); }
   else fail('invalid_pillbox_receipt');
  }
  requireValue(object(d.claims) && Object.keys(d.claims).length <= 10000, 'invalid_pillbox_claims');
  for (const [key, claim] of Object.entries(d.claims)) { text(key, 'invalid_pillbox_source_key', 200, false); requireValue(object(claim), 'invalid_pillbox_claim'); requireValue(integer(claim.compartment, 'invalid_pillbox_compartment', 4) >= 1, 'invalid_pillbox_compartment'); text(claim.openId, 'invalid_pillbox_open_id', 100, false); }
 }
 requireValue(active === 'local' || own(s.devices, active), 'invalid_pillbox_active_device');
 requireValue(Array.isArray(s.journal) && s.journal.length <= MAX_JOURNAL, 'invalid_pillbox_journal');
 const ids = new Set(), kinds = new Set(['open', 'stock-set', 'stock-add', 'taken', 'undo-taken', 'assign']);
 for (const r of s.journal) {
  requireValue(object(r), 'invalid_pillbox_journal'); text(r.id, 'invalid_pillbox_journal_id', 100, false); requireValue(!ids.has(r.id), 'duplicate_pillbox_journal_id'); ids.add(r.id);
  requireValue(kinds.has(r.kind) && own(s.devices, deviceId(r.deviceId)), 'invalid_pillbox_journal_reference'); requireValue(integer(r.compartment, 'invalid_pillbox_compartment', 4) >= 1, 'invalid_pillbox_compartment');
  timestamp(r.at, 'invalid_pillbox_timestamp'); text(r.source, 'invalid_pillbox_source', 100, false);
  if (own(r, 'amount')) integer(r.amount, 'invalid_pillbox_portions'); for (const field of ['before', 'after']) if (own(r, field) && r[field] !== null) integer(r[field], 'invalid_pillbox_remaining');
 }
 const journalById = new Map(s.journal.map(r => [r.id, r])), claimedOpenIds = new Set();
 for (const [deviceId, d] of Object.entries(s.devices)) {
  const sources = new Map(sourceRows(history, deviceId).map(r => [recordKey(r), r])), perSlot = new Map();
  for (const [key, claim] of Object.entries(d.claims)) {
   requireValue(sources.has(key), 'invalid_pillbox_claim_source');
   requireValue(!claimedOpenIds.has(claim.openId), 'duplicate_pillbox_claim_open_id'); claimedOpenIds.add(claim.openId);
   perSlot.set(claim.compartment, (perSlot.get(claim.compartment) || 0) + 1);
   const row = journalById.get(claim.openId);
   if (row) requireValue(row.kind === 'open' && row.deviceId === deviceId && row.compartment === claim.compartment && row.sourceKey === key, 'invalid_pillbox_claim_journal');
  }
  for (const [n, count] of perSlot) requireValue(slot(d, n).openedTotal >= count, 'invalid_pillbox_open_count');
 }
 const retainedSources = new Set();
 for (const r of s.journal.filter(r => own(r, 'sourceKey'))) {
  requireValue(r.kind === 'open', 'invalid_pillbox_journal_source'); text(r.sourceKey, 'invalid_pillbox_source_key', 200, false);
  const key = `${r.deviceId}|${r.sourceKey}`;
  requireValue(!retainedSources.has(key), 'duplicate_pillbox_journal_source'); retainedSources.add(key);
  const claim = s.devices[r.deviceId]?.claims[r.sourceKey];
  requireValue(claim && claim.openId === r.id && claim.compartment === r.compartment, 'invalid_pillbox_journal_claim');
 }
 requireValue(object(s.allocations) && Object.keys(s.allocations).length <= MAX_ALLOCATIONS, 'invalid_pillbox_allocations');
 const events = new Map(intakeEvents.map(e => [e.id, e])), allocationCounts = new Map(), allocationDays = new Map(), undoRooms = new Map();
 for (const [key, a] of Object.entries(s.allocations)) {
  requireValue(object(a), 'invalid_pillbox_allocation'); const e = events.get(key);
  requireValue(e && e.status === 'taken' && e.drugId === a.drugId, 'invalid_pillbox_allocation_event');
  requireValue(own(s.devices, deviceId(a.deviceId)), 'invalid_pillbox_allocation_device'); requireValue(integer(a.compartment, 'invalid_pillbox_compartment', 4) >= 1, 'invalid_pillbox_compartment');
  requireValue(integer(a.amount, 'invalid_pillbox_portions', 1) === 1 && typeof a.deducted === 'boolean', 'invalid_pillbox_allocation_amount');
  for (const field of ['cycle', 'stockEpoch', 'journalId']) text(a[field], 'invalid_pillbox_allocation_reference', 100, false);
  text(a.drugName, 'invalid_pillbox_drug_name', 1000); timestamp(a.at, 'invalid_pillbox_timestamp');
  const d = s.devices[a.deviceId]; requireValue(d, 'invalid_pillbox_allocation_device');
  const current = slot(d, a.compartment);
  requireValue(a.cycle !== current.cycle || a.drugId === current.drugId, 'invalid_pillbox_allocation_cycle');
  if (a.cycle === current.cycle && a.stockEpoch === current.stockEpoch && a.deducted) {
   requireValue(current.remaining !== null, 'invalid_pillbox_allocation_stock');
   const roomKey = `${a.deviceId}|${a.compartment}`; undoRooms.set(roomKey, (undoRooms.get(roomKey) || 0) + a.amount);
  }
  const r = journalById.get(a.journalId);
  if (r) requireValue(r.kind === 'taken' && r.eventId === key && r.deviceId === a.deviceId && r.compartment === a.compartment && r.deducted === a.deducted && r.amount === a.amount && r.at === a.at, 'invalid_pillbox_allocation_journal');
  const countKey = `${a.deviceId}|${a.compartment}`, dateKey = `${countKey}|${day(Date.parse(a.at))}`;
  allocationCounts.set(countKey, (allocationCounts.get(countKey) || 0) + 1); allocationDays.set(dateKey, (allocationDays.get(dateKey) || 0) + 1);
 }
 for (const [key, d] of Object.entries(s.devices)) for (const slot of d.slots) {
  const countKey = `${key}|${slot.compartment}`;
  if (slot.remaining !== null) requireValue(slot.remaining + (undoRooms.get(countKey) || 0) <= MAX_PORTIONS, 'invalid_pillbox_allocation_stock');
  requireValue(slot.consumedTotal >= (allocationCounts.get(countKey) || 0), 'invalid_pillbox_consumed_count');
  for (const [date, counts] of Object.entries(slot.daily)) requireValue(counts.consumed >= (allocationDays.get(`${countKey}|${date}`) || 0), 'invalid_pillbox_consumed_daily');
 }
 return s;
}
module.exports = { empty, deviceId, view, activate, assign, stock, open, taken, undoTaken, retainEvents, validate, recordKey };
