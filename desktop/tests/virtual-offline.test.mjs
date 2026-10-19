import test from 'node:test';
import assert from 'node:assert/strict';
import { createVirtualHiPb1Device } from '../src/virtual-device.mjs';
import { buildQuery07, buildBind07, buildEnable07, buildSetReminder07, reminderTimeField24 } from '../src/core/hipee07.mjs';

async function scheduled() {
  const device = createVirtualHiPb1Device({ seconds: 7 * 3600 });
  device.connect();
  const binding = device.send(buildBind07(), [0x32]);
  device.action({ type: 'press-button' }); await binding;
  await device.send(buildEnable07(), [0x32]);
  await device.send(buildSetReminder07(1, reminderTimeField24(8 * 3600)), [0x31]);
  return device;
}

test('Bluetooth disconnection leaves the powered local clock, reminder and physical lid state usable', async () => {
  const device = await scheduled();
  device.disconnect();
  const before = device.getSnapshot();
  assert.equal(before.connected, false);
  assert.equal(before.localPowered, true);
  assert.equal(before.stale, true, 'the GATT observation is stale even while local hardware is available');
  assert.equal(before.lids[0].state, 'closed');
  assert.equal(before.lids[0].gattStale, true);
  assert.equal(before.lids[0].stale, false);
  assert.equal(device.action({ type: 'advance-clock', seconds: 8 * 3600 }).ok, true);
  assert.equal(device.getSnapshot().led[0].color, 'amber');
  assert.equal(device.getSnapshot().reminding.length, 1);
  assert.equal(device.action({ type: 'open-lid', slot: 1 }).ok, true);
  assert.equal(device.getSnapshot().lids[0].state, 'open');
  assert.equal(device.action({ type: 'close-lid', slot: 1 }).ok, true);
  assert.equal(device.getSnapshot().records.length, 0, 'lid activity never establishes ingestion');
  assert.equal(device.action({ type: 'confirm-intake', slot: 1 }).ok, true);
  assert.equal(device.getSnapshot().led[0].color, 'green');
  assert.equal(device.getSnapshot().records[0].confirmedBy, 'simulation-user');
  assert.equal(device.getSnapshot().connected, false, 'local actions must not reconnect Bluetooth');
});

test('offline physical actions do not manufacture notifications or open a GATT command channel', async () => {
  const device = await scheduled();
  const frameCount = device.getSnapshot().frameLog.length;
  const notifications = [];
  device.onFrame(frame => notifications.push(frame));
  device.disconnect();
  device.action({ type: 'advance-clock', seconds: 8 * 3600 });
  device.action({ type: 'open-lid', slot: 1 });
  device.action({ type: 'confirm-intake', slot: 1 });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(notifications.length, 0);
  assert.equal(device.getSnapshot().frameLog.length, frameCount);
  await assert.rejects(device.send(buildQuery07(), [4]), /尚未连接/);
  await assert.rejects(device.write(buildQuery07()), /尚未连接/);
  device.connect();
  const response = await device.send(buildQuery07(), [4]);
  assert.equal(response.cmd, 4);
  assert.equal(device.getSnapshot().records.length, 1);
  device.disconnect();
});

test('power removal stops outputs and physical actions; restoration preserves plans without reconnecting or advancing time', async () => {
  const device = await scheduled();
  device.action({ type: 'advance-clock', seconds: 8 * 3600 });
  assert.equal(device.getSnapshot().led[0].color, 'amber');
  let disconnects = 0;
  device.connect({ onDisconnected: () => disconnects++ });
  const elapsed = device.getSnapshot().clock.elapsedSeconds;
  const off = device.setPowered(false);
  assert.equal(disconnects, 1);
  assert.equal(off.connected, false);
  assert.equal(off.localPowered, false);
  assert.equal(off.physicalStateAvailable, false);
  assert.equal(off.led[0].color, 'off');
  assert.equal(off.lids[0].state, 'unknown');
  assert.equal(off.lids[0].lastState, 'closed');
  assert.equal(device.action({ type: 'advance-clock', deltaSeconds: 3600 }).ok, false);
  assert.equal(device.action({ type: 'open-lid', slot: 1 }).ok, false);
  assert.equal(device.action({ type: 'confirm-intake', slot: 1 }).ok, false);
  assert.equal(device.getSnapshot().clock.elapsedSeconds, elapsed);
  assert.throws(() => device.connect(), /未供电/);
  await assert.rejects(device.send(buildQuery07(), [4]), /未供电/);
  const restored = device.setPowered(true);
  assert.equal(restored.connected, false);
  assert.equal(restored.localPowered, true);
  assert.equal(restored.bound, true);
  assert.equal(restored.enabled, true);
  assert.equal(restored.plans[0].reminders.length, 1);
  assert.equal(restored.clock.elapsedSeconds, elapsed);
  assert.equal(restored.led[0].color, 'amber');
  assert.equal(restored.lastFeedback.detail.planPersistence, 'simulation-memory-only');
  assert.equal(device.action({ type: 'confirm-intake', slot: 1 }).ok, true);
  assert.equal(device.getSnapshot().connected, false);
});

test('power control requires a boolean and repeated assignments do not invent device events', () => {
  const device = createVirtualHiPb1Device();
  assert.throws(() => device.setPowered(0), /布尔/);
  assert.throws(() => device.setPowered('true'), /布尔/);
  const revision = device.getSnapshot().revision;
  assert.equal(device.setPowered(true).revision, revision);
  const off = device.setPowered(false);
  assert.equal(device.setPowered(false).revision, off.revision);
});
