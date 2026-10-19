/** A frame-level Hi-PB1 simulator. This is an explicit software peripheral, never BLE hardware. */
import {
  CMD07, SERVICE_CONTROL, CHAR_CONTROL_WRITE, CHAR_CONTROL_NOTIFY,
  BIND_CONFIRM_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, buildFrame07, Frame07Decoder,
  verifyChecksum, readUintBE, toHex,
} from './core/hipee07.mjs';

const SOURCE = Object.freeze({ source: 'simulation', transport: 'virtual', physicalExecution: 'simulation-only' });
const clone = value => JSON.parse(JSON.stringify(value));
const validSeconds = value => Number.isInteger(value) && value >= 0 && value <= 86399;
const validSlot = value => Number.isInteger(value) && value >= 1 && value <= 4;
const bytesOf = value => {
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (value instanceof DataView) return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  throw new TypeError('虚拟外设只接受真实字节帧');
};
const u32 = value => Uint8Array.of((value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255);

export function createVirtualHiPb1Device({ seconds = 28800, date = '2026-10-15', battery = 78, bindTimeoutMs = BIND_CONFIRM_TIMEOUT_MS } = {}) {
  if (!validSeconds(seconds)) throw new RangeError('初始模拟时刻必须为 0..86399 秒');
  if (!Number.isInteger(battery) || battery < 0 || battery > 100) throw new RangeError('模拟电量必须为 0..100');
  const baseMs = Date.parse(`${date}T00:00:00+08:00`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(baseMs) || new Date(baseMs + 8 * 3600_000).toISOString().slice(0, 10) !== date) throw new RangeError('模拟起始日期非法');
  const bindingLimit = Math.min(BIND_CONFIRM_TIMEOUT_MS, Math.max(1, Number.isFinite(bindTimeoutMs) ? bindTimeoutMs : BIND_CONFIRM_TIMEOUT_MS));
  // Local hardware power and the GATT transport have independent lifetimes.
  // This is a manually advanced simulator; disconnecting Bluetooth never pauses its local logic.
  let powered = true, connected = false, bound = false, enabled = false, elapsed = seconds, batteryLevel = battery;
  let pendingBind = false, bindTimer = null, disconnectCallback = null, revision = 0, epoch = 0, receiveBuffer = new Uint8Array(0);
  let feedback = null, findingUntil = -1;
  const plans = Array.from({ length: 4 }, (_, index) => ({ slot: index + 1, reminders: [] }));
  const lids = ['closed', 'closed', 'closed', 'closed'];
  const records = [], reminding = [], triggered = new Set(), confirmed = new Set(), frames = [];
  const frameListeners = new Set(), stateListeners = new Set(), waiters = [];
  const timestamp = () => Math.floor(baseMs / 1000) + elapsed;
  const clock = () => ({ day: Math.floor(elapsed / 86400), seconds: elapsed % 86400, elapsedSeconds: elapsed,
    date, localDate: new Date(baseMs + elapsed * 1000 + 8 * 3600_000).toISOString().slice(0, 10),
    weekday: ((new Date(baseMs + 8 * 3600_000).getUTCDay() + 6 + Math.floor(elapsed / 86400)) % 7) + 1 });
  function getSnapshot() {
    const current = clock();
    const dueSlots = new Set(reminding.filter(item => item.day === current.day).map(item => item.slot));
    return clone({ ...SOURCE, revision, deviceId: 'sim-hi-pb1', name: 'Hi-PB1 虚拟药盒',
      connected, connection: connected ? 'connected' : 'disconnected', stale: !connected,
      localPowered: powered, physicalStateAvailable: powered, clockPolicy: 'manual-simulation-frozen-while-unpowered',
      bound, enabled, pendingBind,
      battery: batteryLevel, lowBattery: batteryLevel <= 10, plans, clock: current,
      lids: lids.map((state, index) => ({ slot: index + 1, state: powered ? state : 'unknown', lastState: state,
        stale: !powered, gattStale: !connected, observedVia: 'simulation-local-hardware' })),
      led: lids.map((_, index) => {
        const slot = index + 1, completed = confirmed.has(`${current.day}:${slot}`), due = dueSlots.has(slot);
        const color = !powered ? 'off' : completed ? 'green' : due ? 'amber' : 'off';
        return { slot, color, rgb: { gray: '#66757a', green: '#55c59b', amber: '#edb25c', off: '#3b4842' }[color],
          reason: !powered ? 'local-power-off' : completed ? 'explicit-simulated-confirmation' : due ? 'simulated-dose-due' : 'idle' };
      }),
      reminding, finding: powered && elapsed < findingUntil,
      records, frameLog: frames, lastFeedback: feedback, bufferedBytes: receiveBuffer.length,
      current: null, currentA: null, voltageV: null, powerW: null,
      telemetryReason: '虚拟协议外设没有实测电流、电压或功率；电源仿真是独立计算模型。',
      channels: { service: SERVICE_CONTROL, write: CHAR_CONTROL_WRITE, notify: CHAR_CONTROL_NOTIFY },
    });
  }
  function stateEvent(type, detail = {}) {
    revision++;
    feedback = { ...SOURCE, type, detail: clone(detail), clock: clock() };
    const snapshot = getSnapshot();
    const event = { ...snapshot, type, detail: clone(detail), snapshot };
    for (const listener of stateListeners) { try { listener(clone(event)); } catch { /* view error cannot alter peripheral state */ } }
    return event;
  }
  function logFrame(direction, raw, extra = {}) {
    frames.push({ ...SOURCE, direction, hex: toHex(raw), opcode: raw[2], clock: clock(), ...extra });
    if (frames.length > 200) frames.shift();
  }
  function reply(cmd, payload, extra = {}) {
    // Local lid/confirmation actions may occur offline. They alter the simulated
    // hardware state, but cannot manufacture GATT notifications while disconnected.
    if (!connected) return;
    const raw = buildFrame07(cmd, payload);
    // Decode outbound bytes too, instead of inventing an already-parsed return object.
    const frame = new Frame07Decoder().push(raw)[0];
    logFrame('rx', raw, extra);
    const responseEpoch = epoch;
    queueMicrotask(() => {
      if (!connected || responseEpoch !== epoch) return;
      const result = { ...SOURCE, ...extra, ...frame };
      for (const listener of frameListeners) {
        try { listener({ ...result, payload: new Uint8Array(result.payload), raw: new Uint8Array(result.raw) }); } catch { /* observers only */ }
      }
      const waiter = waiters.find(item => item.expect.includes(cmd));
      waiter?.received(result);
    });
  }
  function requirePower() { if (!powered) throw new Error('虚拟药盒本地主机未供电；不能执行物理动作'); }
  function requireConnection() { requirePower(); if (!connected) throw new Error('虚拟药盒尚未连接或已断开'); }
  function clearBinding() { clearTimeout(bindTimer); bindTimer = null; pendingBind = false; }
  function dueBetween(previous, current) {
    if (!enabled) return;
    const firstDay = Math.floor(previous / 86400), lastDay = Math.floor(current / 86400);
    const baseWeekday = (new Date(baseMs + 8 * 3600_000).getUTCDay() + 6) % 7;
    for (let day = firstDay; day <= lastDay; day++) {
      for (const plan of plans) for (const reminder of plan.reminders) {
        const at = day * 86400 + reminder.seconds;
        const key = `${day}:${plan.slot}:${reminder.seconds}`;
        if (at < previous || at > current || triggered.has(key) || confirmed.has(`${day}:${plan.slot}`) || !(reminder.dayMask & (1 << ((baseWeekday + day) % 7)))) continue;
        triggered.add(key);
        reminding.push({ slot: plan.slot, day, dueSeconds: reminder.seconds, status: 'due', ...SOURCE });
      }
    }
    if (reminding.length > 200) reminding.splice(0, reminding.length - 200);
  }
  function handle(frame) {
    const { cmd, payload } = frame;
    switch (cmd) {
      case CMD07.QUERY: {
        if (payload.length !== 0) throw new Error('虚拟 QUERY 不接受额外载荷');
        const info = new Uint8Array(11); info[0] = batteryLevel; info[1] = 0; info[2] = 46;
        reply(CMD07.QUERY_RSP, info, { confidence: 'simulation-convention' }); stateEvent('query-response'); return;
      }
      case CMD07.BIND:
        if (payload.length !== 4) throw new Error('虚拟绑定令牌必须为四字节');
        if (pendingBind) throw new Error('已有虚拟绑定正在等待本人按键');
        pendingBind = true;
        bindTimer = setTimeout(() => { pendingBind = false; bindTimer = null; stateEvent('binding-expired'); }, bindingLimit);
        stateEvent('binding-waits-for-button', { limitMs: bindingLimit }); return;
      case CMD07.ENABLE:
        if (payload.length !== 1 || payload[0] !== 1) throw new Error('虚拟启用命令载荷须为 01');
        if (!bound) throw new Error('虚拟药盒尚未完成按键绑定');
        enabled = true; dueBetween(elapsed, elapsed);
        reply(CMD07.STATUS, new Uint8Array(7), { confidence: 'simulation-convention' }); stateEvent('reminders-enabled'); return;
      case CMD07.SET_REMINDER: {
        const variant = payload[1], slot = payload[2], seconds = readUintBE(payload, 3, 3), mask = payload[6];
        const valid = payload[0] === 2 && validSlot(slot) && validSeconds(seconds) &&
          ((variant === 3 && payload.length === 7 && Number.isInteger(mask) && mask > 0 && mask <= 0x7f) || (variant === 0 && payload.length === 6));
        if (!valid || !bound) { reply(CMD07.SET_REMINDER_RSP, Uint8Array.of(2)); stateEvent('reminder-rejected', { slot, seconds, reason: !bound ? 'not-bound' : 'invalid-payload' }); return; }
        const plan = plans[slot - 1];
        if (variant === 0) {
          plan.reminders = plan.reminders.filter(reminder => reminder.seconds !== seconds);
          for (let index = reminding.length - 1; index >= 0; index--) if (reminding[index].slot === slot && reminding[index].dueSeconds === seconds) reminding.splice(index, 1);
        } else {
          const existing = plan.reminders.find(reminder => reminder.seconds === seconds);
          if (existing) existing.dayMask = mask; else plan.reminders.push({ seconds, dayMask: mask });
          plan.reminders.sort((a, b) => a.seconds - b.seconds); dueBetween(elapsed, elapsed);
        }
        reply(CMD07.SET_REMINDER_RSP, Uint8Array.of(1)); stateEvent(variant === 0 ? 'reminder-cleared' : 'reminder-set', { slot, seconds, dayMask: mask ?? null }); return;
      }
      case CMD07.SYNC:
        if (payload.length !== 0) throw new Error('虚拟 SYNC 不接受额外载荷');
        for (const record of records) reply(CMD07.STATUS, Uint8Array.of(0xfe, record.slot, 1, ...u32(record.timestamp)), { confidence: 'explicit-simulation-record', recordId: record.id });
        reply(CMD07.STATUS, Uint8Array.of(0xfc), { confidence: 'simulation-convention' });
        stateEvent('records-streamed', { count: records.length }); return;
      case CMD07.FIND_BOX:
        if (payload.length !== 0) throw new Error('虚拟 FIND 不接受额外载荷');
        findingUntil = elapsed + 5;
        reply(CMD07.STATUS, Uint8Array.of(0xfc), { opcodeConfidence: 'inferred', confidence: 'simulation-convention' });
        stateEvent('find-simulated', { opcodeConfidence: 'inferred' }); return;
      case CMD07.UNBIND:
        if (payload.length !== 0) throw new Error('虚拟 UNBIND 不接受额外载荷');
        bound = enabled = false; clearBinding(); plans.forEach(plan => { plan.reminders = []; }); reminding.splice(0);
        reply(CMD07.STATUS, Uint8Array.of(0xfc), { opcodeConfidence: 'inferred', confidence: 'simulation-convention' });
        stateEvent('unbind-simulated', { opcodeConfidence: 'inferred' }); return;
      default: throw new Error(`虚拟外设不支持 opcode 0x${cmd.toString(16)}`);
    }
  }
  async function write(value, { service = SERVICE_CONTROL, characteristic = CHAR_CONTROL_WRITE } = {}) {
    requireConnection();
    if (service !== '0000ff00-0000-1000-8000-00805f9b34fb' || characteristic !== '0000ff02-0000-1000-8000-00805f9b34fb') throw new Error('07 帧仅允许 ff00/ff02 控制通道，禁止身份通道');
    const bytes = bytesOf(value), joined = new Uint8Array(receiveBuffer.length + bytes.length);
    joined.set(receiveBuffer); joined.set(bytes, receiveBuffer.length); receiveBuffer = joined;
    while (receiveBuffer.length >= 2) {
      if (receiveBuffer[0] !== 7 || receiveBuffer[1] < 1 || receiveBuffer[1] > 252) { receiveBuffer = new Uint8Array(0); throw new Error('07 帧头或 LEN 非法'); }
      const total = receiveBuffer[1] + 3;
      if (receiveBuffer.length < total) return;
      const raw = receiveBuffer.slice(0, total); receiveBuffer = receiveBuffer.slice(total);
      if (!verifyChecksum(raw)) { receiveBuffer = new Uint8Array(0); throw new Error('07 帧 CHK 校验失败'); }
      logFrame('tx', raw);
      handle({ cmd: raw[2], payload: raw.slice(3, -1), raw });
    }
  }
  async function send(value, expect, { timeout = DEFAULT_TIMEOUT_MS, onSent } = {}) {
    requireConnection();
    const frame = bytesOf(value);
    if (frame.length < 4 || frame[0] !== 7 || frame[1] + 3 !== frame.length || !verifyChecksum(frame)) throw new Error('send 需要完整、LEN/CHK 正确的 07 帧');
    if (!Array.isArray(expect) || !expect.length || !expect.every(Number.isInteger)) throw new Error('必须指定合法回复 opcode');
    if (waiters.length) throw new Error('虚拟通道拒绝并发请求，避免共用 opcode 回包');
    return new Promise((resolve, reject) => {
      let done = false, written = false, early = null;
      const waiter = { expect, finish(error, response) {
        if (done) return; done = true; clearTimeout(timer);
        const index = waiters.indexOf(waiter); if (index >= 0) waiters.splice(index, 1);
        error ? reject(error) : resolve(response);
      }, received(response) { if (written) waiter.finish(null, response); else early = response; } };
      const duration = frame[2] === CMD07.BIND ? Math.min(bindingLimit, timeout) : timeout;
      const timer = setTimeout(() => { if (frame[2] === CMD07.BIND) clearBinding(); waiter.finish(new Error('虚拟协议回复超时；设备动作没有自动成功')); stateEvent('command-timeout', { opcode: frame[2] }); }, Math.max(1, duration));
      waiters.push(waiter);
      write(frame).then(() => { if (done) return; written = true; onSent?.(); if (early) waiter.finish(null, early); }).catch(error => waiter.finish(error));
    });
  }
  function action(input = {}) {
    try {
      requirePower();
      const slot = Number(input.slot);
      let event;
      switch (input.type) {
        case 'press-button':
          if (!pendingBind) { event = stateEvent('button-pressed-without-binding'); break; }
          clearBinding(); bound = true;
          reply(CMD07.STATUS, new Uint8Array(7), { confidence: 'simulation-button-confirmed' });
          event = stateEvent('binding-button-confirmed'); break;
        case 'open-lid': case 'close-lid':
          if (!validSlot(slot)) throw new Error('模拟仓位必须为 1..4');
          lids[slot - 1] = input.type === 'open-lid' ? 'open' : 'closed';
          reply(CMD07.STATUS, Uint8Array.of(input.type === 'open-lid' ? 1 : 0, slot, ...u32(timestamp())), { confidence: 'simulation-lid-action' });
          event = stateEvent(input.type, { slot, medicationConfirmed: false }); break;
        case 'confirm-intake': {
          if (!validSlot(slot)) throw new Error('模拟仓位必须为 1..4');
          const key = `${clock().day}:${slot}`;
          if (confirmed.has(key)) throw new Error('该模拟仓今日已明确确认，拒绝重复记录');
          const eligible = reminding.find(item => item.slot === slot && item.day === clock().day);
          if (!eligible) throw new Error('当前模拟仓没有到点任务，不能确认模拟服药');
          const record = { ...SOURCE, id: `sim-dose-${records.length + 1}`, slot, timestamp: timestamp(),
            localDate: clock().localDate, seconds: clock().seconds, type: 'explicit-confirmation', confirmedBy: 'simulation-user' };
          records.push(record); confirmed.add(key);
          for (let index = reminding.length - 1; index >= 0; index--) if (reminding[index].slot === slot && reminding[index].day === clock().day) reminding.splice(index, 1);
          reply(CMD07.STATUS, Uint8Array.of(2, slot, ...u32(timestamp())), { confidence: 'explicit-simulation-confirmation', recordId: record.id });
          event = stateEvent('confirm-intake', { slot, record }); break;
        }
        case 'advance-clock': {
          let next;
          if (Number.isInteger(input.deltaSeconds) && input.deltaSeconds >= 0) next = elapsed + input.deltaSeconds;
          else if (validSeconds(input.seconds)) {
            const day = input.day ?? clock().day;
            if (!Number.isInteger(day) || day < 0) throw new Error('模拟 day 必须为非负整数');
            next = day * 86400 + input.seconds;
          } else throw new Error('需要明确 seconds(0..86399) 或 deltaSeconds');
          if (next < elapsed || next - elapsed > 7 * 86400) throw new Error('模拟时钟不能倒退，单次最多推进七天');
          const previous = elapsed; elapsed = next; dueBetween(previous, elapsed);
          event = stateEvent('advance-clock', { previous, current: elapsed }); break;
        }
        case 'low-battery':
          if (!Number.isInteger(input.percent ?? 5) || (input.percent ?? 5) < 0 || (input.percent ?? 5) > 100) throw new Error('模拟电量必须为 0..100');
          batteryLevel = input.percent ?? 5; event = stateEvent('low-battery', { battery: batteryLevel }); break;
        default: throw new Error('不支持的模拟动作');
      }
      return { ok: true, ...SOURCE, event, snapshot: getSnapshot() };
    } catch (error) { return { ok: false, ...SOURCE, error: error.message, snapshot: getSnapshot() }; }
  }
  const device = {
    ...SOURCE, id: 'sim-hi-pb1', name: 'Hi-PB1 虚拟药盒', getSnapshot, action, write, send,
    connect({ onDisconnected } = {}) { requirePower(); if (onDisconnected) disconnectCallback = onDisconnected; if (!connected) epoch++; connected = true; stateEvent('connected'); return device; },
    setPowered(value) {
      if (typeof value !== 'boolean') throw new TypeError('setPowered 只接受明确的布尔供电状态');
      if (powered === value) return getSnapshot();
      powered = value;
      if (!powered) { device.disconnect(); findingUntil = -1; }
      stateEvent(powered ? 'local-power-restored' : 'local-power-off', {
        clockPolicy: 'manual-simulation-frozen-while-unpowered',
        planPersistence: 'simulation-memory-only', autoReconnect: false,
      });
      return getSnapshot();
    },
    disconnect() {
      if (!connected) return;
      connected = false; epoch++; clearBinding(); receiveBuffer = new Uint8Array(0);
      for (const waiter of [...waiters]) waiter.finish(new Error('虚拟药盒已断开，等待操作未确认'));
      stateEvent('disconnected'); disconnectCallback?.('virtual-disconnected');
    },
    onFrame(callback) { frameListeners.add(callback); return () => frameListeners.delete(callback); },
    onState(callback) { stateListeners.add(callback); const snapshot = getSnapshot(); callback({ ...snapshot, type: 'snapshot', snapshot }); return () => stateListeners.delete(callback); },
  };
  return device;
}
