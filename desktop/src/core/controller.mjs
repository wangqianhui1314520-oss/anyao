/** Shared command lifecycle for desktop buttons and the model IPC bridge.
 * Transport success is never promoted to a lid, dose, or physical actuator fact.
 */
import {
  CMD07, buildQuery07, buildBind07, buildEnable07, buildSync07,
  buildSetReminder07, buildClearReminder07, buildFindBox07, buildUnbind07,
  reminderTimeField24, parseSetReminderRsp07, parseQueryRsp07, parseStatus07,
  secondsFromMidnight, BIND_CONFIRM_TIMEOUT_MS, DAY_MASK_EVERYDAY, toHex,
} from './hipee07.mjs';

export const OPERATIONS = Object.freeze(['connect', 'bind', 'enable', 'query', 'plan', 'clear', 'sync', 'find', 'unbind', 'disconnect']);
const timeSeconds = (value) => typeof value === 'string' ? secondsFromMidnight(value) : value;
const validSecond = (value) => Number.isInteger(value) && value >= 0 && value <= 86399;

export function normalizeCommand(input = {}) {
  const operation = input.operation || input.action;
  if (!OPERATIONS.includes(operation)) throw new Error('不支持的操作；网站不能伪造开盖或服药事实');
  const mode = input.mode || 'device';
  if (!['device', 'simulation'].includes(mode)) throw new Error('mode 必须为 device 或 simulation');
  const command = { ...input, kind: 'command', operation, mode,
    correlationId: String(input.correlationId || `desktop-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`).slice(0, 160) };
  if (operation === 'plan') {
    const raw = input.secondsList || input.times;
    if (!Array.isArray(raw) || raw.length !== 4) throw new Error('计划必须提供四仓时刻；跳过仓用 null');
    command.secondsList = raw.map((value) => value === null || value === '' ? null : (timeSeconds(value) ?? NaN));
    if (!command.secondsList.some(validSecond) || command.secondsList.some((value) => value !== null && !validSecond(value))) throw new Error('提醒时间非法，必须为 HH:mm 或 0..86399 秒');
  }
  if (operation === 'clear') {
    command.slot = Number(input.slot);
    command.seconds = timeSeconds(input.seconds ?? input.time);
    if (!Number.isInteger(command.slot) || command.slot < 1 || command.slot > 4 || !validSecond(command.seconds)) throw new Error('清除必须指定 1..4 仓及真实时刻');
  }
  if (['find', 'unbind'].includes(operation) && mode === 'device' && input.allowInferred !== true) throw new Error('寻找与解绑 opcode 尚未真机确认；请先明确勾选允许试验推断命令');
  return command;
}

export function createDesktopController({ connectDevice, publish, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), now = Date.now } = {}) {
  let device = null;
  let source = 'device';
  let active = null;
  let offFrame = null;
  const simulated = { connected: false, reminders: [null, null, null, null], enabled: false, bound: false };
  const emit = (command, payload) => publish?.({ source: command.mode === 'simulation' ? 'simulation' : 'device',
    correlationId: command.correlationId, timestamp: new Date(now()).toISOString(), deviceId: device?.id || (command.mode === 'simulation' ? 'sim-hi-pb1' : null), ...payload });
  const phase = (command, value, detail = {}) => emit(command, { kind: 'operation', operation: command.operation, phase: value, ...detail });
  const connection = (command, connected, extra = {}) => emit(command, { kind: 'connection', connected, stale: !connected, ...extra });

  function disconnected(reason = 'gatt-disconnected') {
    const current = active || { mode: source === 'simulation' ? 'simulation' : 'device', correlationId: `disconnect-${now()}` };
    device = null;
    offFrame?.(); offFrame = null;
    connection(current, false, { reason });
  }

  function attachFrames(dev) {
    offFrame?.();
    offFrame = dev.onFrame((frame) => {
      const current = active || { mode: 'device', correlationId: `notify-${now()}` };
      emit(current, { kind: 'frame', direction: 'rx', opcode: frame.cmd, hex: toHex(frame.raw || frame.payload), confidence: 'raw' });
      if (frame.cmd === CMD07.STATUS) {
        // 0x32 flags, mock event tags, and slot identity have not been verified on this product.
        // Keep the raw evidence; do not manufacture lid-open, dose-taken, or a closed snapshot.
        const record = parseStatus07(frame.payload);
        emit(current, { kind: 'record', record, confidence: 'unverified', physicalMeaning: 'unknown' });
      }
    });
  }

  async function write(command, frame) {
    phase(command, 'sending', { opcode: frame[2], hex: toHex(frame) });
    await device.write(frame);
    phase(command, 'sent', { opcode: frame[2], physicalExecution: 'unverified' });
  }
  async function send(command, frame, expected, options = {}) {
    phase(command, 'sending', { opcode: frame[2], hex: toHex(frame) });
    const reply = await device.send(frame, expected, { ...options,
      onSent: () => phase(command, 'sent', { opcode: frame[2], physicalExecution: 'unverified' }) });
    phase(command, 'response', { opcode: reply.cmd, hex: toHex(reply.raw || reply.payload), physicalExecution: 'unverified' });
    return reply;
  }

  async function simulate(command) {
    if (command.operation === 'connect') {
      if (device) throw new Error('真实药盒仍连接，请先断开再切换仿真');
      simulated.connected = true; source = 'simulation';
      connection(command, true, { deviceId: 'sim-hi-pb1', name: 'Hi-PB1 虚拟设备' });
      return { connected: true, simulated: true };
    }
    if (source !== 'simulation' || !simulated.connected) throw new Error('请先连接虚拟设备');
    phase(command, 'sending', { simulated: true });
    await wait(160);
    phase(command, 'sent', { simulated: true });
    switch (command.operation) {
      case 'bind': simulated.bound = true; break;
      case 'enable': simulated.enabled = true; break;
      case 'query': emit(command, { kind: 'telemetry', battery: 78, version: 'SIM-0.7', confidence: 'simulation', stale: false }); break;
      case 'plan': command.secondsList.forEach((value, index) => { if (value !== null) simulated.reminders[index] = value; }); break;
      case 'clear': if (simulated.reminders[command.slot - 1] === command.seconds) simulated.reminders[command.slot - 1] = null; break;
      case 'sync': emit(command, { kind: 'records', records: [], confidence: 'simulation', physicalMeaning: 'no-synthetic-dose-records' }); break;
      case 'unbind': simulated.bound = false; break;
      case 'disconnect': simulated.connected = false; connection(command, false, { reason: 'user' }); break;
      case 'find': break;
    }
    phase(command, 'acknowledged', { simulated: true });
    return { ...simulated, reminders: [...simulated.reminders], simulated: true, physicalExecution: 'simulation-only' };
  }

  async function run(input, { userGesture = false } = {}) {
    let command;
    try { command = normalizeCommand(input); }
    catch (error) {
      const rejected = { ...input, mode: input?.mode || 'device', correlationId: input?.correlationId || `rejected-${now()}` };
      phase(rejected, 'failed', { error: error.message });
      return { ok: false, error: error.message };
    }
    phase(command, 'requested');
    if (active) { phase(command, 'failed', { error: '另一操作尚未结束；拒绝并发以避免混淆同 opcode 回执' }); return { ok: false, error: 'busy' }; }
    if (command.operation === 'connect' && command.mode === 'device' && !userGesture) {
      phase(command, 'waiting-user', { requireConsoleGesture: true, detail: '请在桌面控制台点击连接；跨窗口 IPC 不具有浏览器设备选择手势' });
      return { ok: false, requiresUserGesture: true };
    }
    active = command;
    try {
      let result;
      if (command.mode === 'simulation') result = await simulate(command);
      else if (command.operation === 'connect') {
        if (simulated.connected || device) throw new Error('已有连接，请先断开');
        device = await connectDevice({ onDisconnected: disconnected }); source = 'device';
        attachFrames(device);
        connection(command, true, { name: device.name, deviceId: device.id });
        result = { connected: true, transport: 'web-bluetooth', deviceId: device.id };
      } else {
        if (!device || source !== 'device') throw new Error('请先连接真实 Hi-PB1 药盒');
        switch (command.operation) {
          case 'query': {
            const frame = await send(command, buildQuery07(), [CMD07.QUERY_RSP]);
            const info = parseQueryRsp07(frame.payload);
            if (info.battery === null) throw new Error('查询回复缺少电量或值越界，保留未知');
            emit(command, { kind: 'telemetry', ...info, confidence: 'inferred', stale: false });
            result = { ...info, layoutConfidence: 'inferred' }; break;
          }
          case 'plan': {
            const acknowledgedSlots = [];
            for (let index = 0; index < 4; index++) {
              if (command.secondsList[index] === null) continue;
              const frame = await send(command, buildSetReminder07(index + 1, reminderTimeField24(command.secondsList[index]), DAY_MASK_EVERYDAY), [CMD07.SET_REMINDER_RSP]);
              if (!parseSetReminderRsp07(frame.payload)) throw new Error(`药盒拒绝第 ${index + 1} 仓提醒；此前已确认的仓可能已写入，请查询核实`);
              acknowledgedSlots.push(index + 1);
              phase(command, 'acknowledged', { slot: index + 1, confidence: 'confirmed-0x31' });
            }
            await write(command, buildSync07());
            result = { secondsList: [...command.secondsList], acknowledgedSlots, commitConfirmed: false, physicalExecution: 'unverified' };
            emit(command, { kind: 'plan', ...result, stage: 'reminders-acknowledged-commit-unverified' }); break;
          }
          case 'clear': {
            const frame = await send(command, buildClearReminder07(command.slot, command.seconds), [CMD07.SET_REMINDER_RSP]);
            if (!parseSetReminderRsp07(frame.payload)) throw new Error('药盒拒绝清除该时刻');
            phase(command, 'acknowledged', { slot: command.slot, confidence: 'confirmed-0x31' });
            result = { slot: command.slot, seconds: command.seconds, reminderAcknowledged: true }; break;
          }
          case 'sync': {
            const records = [];
            const off = device.onFrame((frame) => { if (frame.cmd === CMD07.STATUS) records.push(parseStatus07(frame.payload)); });
            try { await write(command, buildSync07()); await wait(8000); } finally { off(); }
            if (!device) throw new Error('同步过程中设备断开；记录窗口未完成');
            emit(command, { kind: 'records', records, confidence: 'unverified', physicalMeaning: 'unknown' });
            result = { count: records.length, collectionWindowMs: 8000, deviceSyncEndConfirmed: false }; break;
          }
          case 'disconnect': device.disconnect(); disconnected('user'); result = { disconnected: true }; break;
          default: {
            const frame = { bind: buildBind07, enable: buildEnable07, find: buildFindBox07, unbind: buildUnbind07 }[command.operation]();
            const response = await send(command, frame, [CMD07.STATUS], command.operation === 'bind' ? { timeout: BIND_CONFIRM_TIMEOUT_MS } : {});
            result = { statusHex: toHex(response.payload), deviceExecutionConfirmed: false,
              protocolConfidence: ['find', 'unbind'].includes(command.operation) ? 'inferred-opcode' : 'unverified-status-semantics' };
          }
        }
      }
      phase(command, 'completed', { result });
      return { ok: true, result };
    } catch (error) {
      phase(command, error.name === 'NotFoundError' ? 'cancelled' : 'failed', { error: error.message });
      return { ok: false, error: error.message };
    } finally { active = null; }
  }
  return { run, disconnected, getState: () => ({ connected: source === 'simulation' ? simulated.connected : !!device,
    source, busy: !!active, simulated: { ...simulated, reminders: [...simulated.reminders] } }) };
}
