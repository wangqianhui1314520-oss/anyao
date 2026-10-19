import test from 'node:test';
import assert from 'node:assert/strict';
import { createVirtualHiPb1Device } from '../src/virtual-device.mjs';
import { HiPeeDevice } from '../src/core/transport.mjs';
import { createDesktopController } from '../src/core/controller.mjs';
import {
  CMD07, buildFrame07, buildQuery07, buildBind07, buildEnable07,
  buildSetReminder07, buildClearReminder07, buildSync07, buildFindBox07, buildUnbind07,
  reminderTimeField24, parseSetReminderRsp07, verifyChecksum,
} from '../src/core/hipee07.mjs';

const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
async function ready({ seconds = 7 * 3600, ...options } = {}) {
  const device = createVirtualHiPb1Device({ seconds, ...options }); device.connect();
  const bind = device.send(buildBind07(), [0x32], { timeout: 50 });
  assert.equal(device.getSnapshot().pendingBind, true);
  device.action({ type: 'press-button' }); await bind;
  await device.send(buildEnable07(), [0x32]);
  return device;
}

test('explicit connection, full-byte query response, null measured current and safe detached snapshots', async () => {
  const device = createVirtualHiPb1Device(); assert.equal(device.getSnapshot().connected, false);
  await assert.rejects(device.send(buildQuery07(), [4]), /尚未连接/);
  device.connect(); const response = await device.send(buildQuery07(), [4]);
  assert.equal(response.cmd, 4); assert.equal(response.payload.length, 11); assert.equal(response.payload[0], 78);
  assert.equal(verifyChecksum(response.raw), true); assert.equal(response.source, 'simulation');
  const state = device.getSnapshot(); assert.equal(state.current, null); assert.equal(state.currentA, null);
  assert.equal(state.voltageV, null); assert.equal(state.powerW, null); assert.equal(state.plans.length, 4); assert.equal(state.lids.length, 4);
  state.plans[0].reminders.push({ seconds: 1, dayMask: 127 }); assert.equal(device.getSnapshot().plans[0].reminders.length, 0);
  device.disconnect();
});

test('bind waits for explicit user button; pressing never silently enables reminders', async () => {
  const device = createVirtualHiPb1Device(); device.connect(); let resolved = false;
  const bind = device.send(buildBind07(), [0x32], { timeout: 100 }).then(frame => { resolved = true; return frame; });
  await flush(); assert.equal(resolved, false); assert.equal(device.getSnapshot().bound, false);
  const action = device.action({ type: 'press-button' }); assert.equal(action.ok, true);
  const frame = await bind; assert.equal(frame.source, 'simulation'); assert.equal(frame.confidence, 'simulation-button-confirmed');
  assert.equal(device.getSnapshot().bound, true); assert.equal(device.getSnapshot().enabled, false); device.disconnect();
});

test('enable rejects an unbound device; binding expiration and disconnect reject waiting requests', async () => {
  const device = createVirtualHiPb1Device({ bindTimeoutMs: 5 }); device.connect();
  await assert.rejects(device.send(buildEnable07(), [0x32]), /尚未完成按键绑定/);
  await assert.rejects(device.send(buildBind07(), [0x32], { timeout: 5 }), /超时/);
  assert.equal(device.getSnapshot().pendingBind, false); assert.equal(device.getSnapshot().bound, false);
  const pending = device.send(buildBind07(), [0x32]); device.disconnect(); await assert.rejects(pending, /已断开/);
  assert.equal(device.getSnapshot().stale, true);
});

test('frame validation checks LEN/CHK and ff00 channel independently of command semantics', async () => {
  const device = createVirtualHiPb1Device(); device.connect(); let count = 0; device.onFrame(() => count++);
  const invalid = buildQuery07(); invalid[3] ^= 1;
  await assert.rejects(device.write(invalid), /CHK/);
  await assert.rejects(device.send(Uint8Array.of(7, 2, 3, 0xf5), [4]), /LEN\/CHK/);
  await assert.rejects(device.write(buildQuery07(), { service: '5833ff01-9b8b-5191-6142-22a4536ef123', characteristic: '5833ff02-9b8b-5191-6142-22a4536ef123' }), /控制通道/);
  await flush(); assert.equal(count, 0);
  assert.equal(device.getSnapshot().channels.service, '0000ff00-0000-1000-8000-00805f9b34fb'); device.disconnect();
});

test('fragmented input and packed frames use actual stream lengths rather than direct command calls', async () => {
  const device = createVirtualHiPb1Device(); device.connect(); const replies = []; device.onFrame(frame => replies.push(frame));
  const query = buildQuery07(); await device.write(query.subarray(0, 2)); await flush(); assert.equal(replies.length, 0);
  await device.write(query.subarray(2)); await flush(); assert.equal(replies.length, 1);
  const both = new Uint8Array(query.length * 2); both.set(query); both.set(query, query.length);
  await device.write(both); await flush(); assert.equal(replies.length, 3); device.disconnect();
});

test('valid reminders ack 01; illegal slots, uint24 seconds, variants and day masks ack 02 without mutation', async () => {
  const device = await ready();
  const valid = await device.send(buildSetReminder07(1, reminderTimeField24(20 * 3600)), [0x31]);
  assert.equal(parseSetReminderRsp07(valid.payload), true);
  const before = JSON.stringify(device.getSnapshot().plans);
  for (const body of [
    [2, 3, 0, 0, 0, 0, 127], [2, 3, 5, 0, 0, 0, 127], [2, 3, 1, 1, 0x51, 0x80, 127],
    [2, 3, 1, 0, 0, 0, 0], [2, 3, 1, 0, 0, 0, 128], [2, 7, 1, 0, 0, 0, 127], [2, 3, 1, 0],
  ]) {
    const reply = await device.send(buildFrame07(0x30, Uint8Array.from(body)), [0x31]);
    assert.deepEqual(Array.from(reply.payload), [2]); assert.equal(JSON.stringify(device.getSnapshot().plans), before);
  }
  device.disconnect();
});

test('clear removes only the exact slot/time while preserving another reminder and another compartment', async () => {
  const device = await ready();
  await device.send(buildSetReminder07(1, reminderTimeField24(8 * 3600)), [0x31]);
  await device.send(buildSetReminder07(1, reminderTimeField24(12 * 3600)), [0x31]);
  await device.send(buildSetReminder07(2, reminderTimeField24(8 * 3600)), [0x31]);
  await device.send(buildClearReminder07(1, 8 * 3600), [0x31]);
  const state = device.getSnapshot(); assert.deepEqual(state.plans[0].reminders.map(item => item.seconds), [12 * 3600]);
  assert.equal(state.plans[1].reminders.length, 1); device.disconnect();
});

test('explicit clock advance activates only due compartments; open/close never confirm or stop reminder', async () => {
  const device = await ready();
  await device.send(buildSetReminder07(1, reminderTimeField24(8 * 3600)), [0x31]);
  await device.send(buildSetReminder07(2, reminderTimeField24(9 * 3600)), [0x31]);
  assert.equal(device.getSnapshot().reminding.length, 0);
  assert.equal(device.action({ type: 'advance-clock', seconds: 8 * 3600 }).ok, true);
  assert.deepEqual(device.getSnapshot().reminding.map(item => item.slot), [1]);
  assert.equal(device.getSnapshot().led[0].color, 'amber');
  device.action({ type: 'open-lid', slot: 1 }); device.action({ type: 'close-lid', slot: 1 });
  assert.equal(device.getSnapshot().records.length, 0); assert.equal(device.getSnapshot().reminding.length, 1);
  assert.equal(device.getSnapshot().lids[0].state, 'closed'); device.disconnect();
});

test('only explicit eligible simulated confirmation produces a source-tagged record and green LED', async () => {
  const device = await ready();
  assert.equal(device.action({ type: 'confirm-intake', slot: 1 }).ok, false);
  await device.send(buildSetReminder07(1, reminderTimeField24(8 * 3600)), [0x31]);
  device.action({ type: 'advance-clock', seconds: 8 * 3600 });
  assert.equal(device.action({ type: 'confirm-intake', slot: 1 }).ok, true);
  const state = device.getSnapshot(); assert.equal(state.records.length, 1); assert.equal(state.records[0].source, 'simulation');
  assert.equal(state.records[0].confirmedBy, 'simulation-user'); assert.equal(state.led[0].color, 'green'); assert.equal(state.reminding.length, 0);
  assert.equal(device.action({ type: 'confirm-intake', slot: 1 }).ok, false); assert.equal(device.getSnapshot().records.length, 1);
  device.disconnect();
});

test('sync streams only explicit simulation records through framed 32 and a mock end marker', async () => {
  const device = await ready(); await device.send(buildSetReminder07(1, reminderTimeField24(8 * 3600)), [0x31]);
  device.action({ type: 'advance-clock', seconds: 8 * 3600 }); device.action({ type: 'confirm-intake', slot: 1 }); await flush();
  const replies = []; const off = device.onFrame(frame => replies.push(frame));
  await device.write(buildSync07()); await flush(); off();
  assert.equal(replies.length, 2); assert.equal(replies[0].cmd, 0x32); assert.equal(replies[0].payload[0], 0xfe);
  assert.equal(replies[0].confidence, 'explicit-simulation-record'); assert.deepEqual(Array.from(replies[1].payload), [0xfc]);
  assert.ok(replies.every(frame => frame.source === 'simulation' && verifyChecksum(frame.raw))); device.disconnect();
});

test('day masks, monotonic simulation clock and explicit low-battery remain isolated from wall time', async () => {
  const device = await ready({ date: '2026-10-15' }); // Thursday, mask bit3.
  await device.send(buildSetReminder07(1, reminderTimeField24(8 * 3600), 1), [0x31]); // Monday only.
  device.action({ type: 'advance-clock', seconds: 8 * 3600 }); assert.equal(device.getSnapshot().reminding.length, 0);
  assert.equal(device.action({ type: 'advance-clock', seconds: 7 * 3600 }).ok, false);
  device.action({ type: 'advance-clock', deltaSeconds: 4 * 86400 }); assert.equal(device.getSnapshot().clock.localDate, '2026-10-19');
  assert.equal(device.getSnapshot().reminding[0].slot, 1);
  device.action({ type: 'low-battery', percent: 5 }); assert.equal(device.getSnapshot().battery, 5); assert.equal(device.getSnapshot().lowBattery, true);
  const reply = await device.send(buildQuery07(), [4]); assert.equal(reply.payload[0], 5); device.disconnect();
});

test('find/unbind preserve inferred opcode provenance and disconnect invalidates queued replies', async () => {
  const device = await ready();
  const find = await device.send(buildFindBox07(), [0x32]); assert.equal(find.opcodeConfidence, 'inferred');
  assert.equal(device.getSnapshot().finding, true);
  const unbind = await device.send(buildUnbind07(), [0x32]); assert.equal(unbind.opcodeConfidence, 'inferred'); assert.equal(device.getSnapshot().bound, false);
  let received = 0; device.onFrame(() => received++);
  const written = device.write(buildQuery07()); device.disconnect(); device.connect(); await written; await flush();
  assert.equal(received, 0, 'queued responses from the previous connection cannot reach a new epoch'); device.disconnect();
});

test('onState offers complete state plus an explicit simulation event and supports unsubscribe', async () => {
  const device = createVirtualHiPb1Device(); const events = []; const off = device.onState(event => events.push(event));
  assert.equal(events[0].source, 'simulation'); assert.equal(events[0].snapshot.connected, false);
  device.connect(); device.action({ type: 'open-lid', slot: 2 });
  assert.equal(events.at(-1).lids[1].state, 'open'); assert.equal(events.at(-1).snapshot.records.length, 0);
  const count = events.length; off(); device.action({ type: 'close-lid', slot: 2 }); assert.equal(events.length, count); device.disconnect();
});

test('copied desktop controller exercises bytes through virtual send/write, not its command-level mock', async () => {
  const device = createVirtualHiPb1Device({ seconds: 7 * 3600 }); const events = [];
  const controller = createDesktopController({ connectDevice: options => device.connect(options), publish: event => events.push(event), wait: async () => {} });
  const run = (operation, extra = {}) => controller.run({ operation, mode: 'device', ...extra }, { userGesture: true });
  await run('connect');
  const bind = run('bind'); await flush(); device.action({ type: 'press-button' }); assert.equal((await bind).ok, true);
  assert.equal((await run('enable')).ok, true); assert.equal((await run('query')).ok, true);
  assert.equal((await run('plan', { times: ['08:00', '12:00', '18:00', '21:00'] })).ok, true);
  assert.equal(device.getSnapshot().plans.every(plan => plan.reminders.length === 1), true);
  assert.ok(device.getSnapshot().frameLog.some(frame => frame.direction === 'tx' && frame.opcode === 0x30));
  assert.ok(device.getSnapshot().frameLog.every(frame => frame.source === 'simulation'));
  assert.ok(events.some(event => event.phase === 'acknowledged'));
  await run('disconnect');
});

test('new core accepts a previously selected BluetoothDevice without reopening a chooser, still ff00 only', async () => {
  const requested = [], notifications = new Map();
  const characteristic = { properties: { write: true }, writeValueWithResponse: async () => {}, startNotifications: async () => {},
    addEventListener: (name, callback) => notifications.set(name, callback), removeEventListener: name => notifications.delete(name) };
  const gatt = { connected: false, connect: async () => {
    gatt.connected = true;
    return { getPrimaryService: async service => { requested.push(service); assert.equal(service, '0000ff00-0000-1000-8000-00805f9b34fb');
      return { getCharacteristic: async uuid => { requested.push(uuid); assert.ok(['0000ff02-0000-1000-8000-00805f9b34fb', '0000ff01-0000-1000-8000-00805f9b34fb'].includes(uuid)); return characteristic; } }; } };
  }, disconnect: () => { gatt.connected = false; } };
  const chosenDevice = { id: 'selected', name: 'Hi-PB1', gatt, addEventListener: () => {}, removeEventListener: () => {} };
  const device = await HiPeeDevice.connect({ chosenDevice });
  assert.deepEqual(requested, ['0000ff00-0000-1000-8000-00805f9b34fb', '0000ff02-0000-1000-8000-00805f9b34fb', '0000ff01-0000-1000-8000-00805f9b34fb']);
  assert.equal(device.id, 'selected'); device.disconnect();
});
