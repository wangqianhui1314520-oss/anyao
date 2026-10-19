/**
 * HiPee / Hi-PB1 智能药盒 07 帧协议 —— exe 端移植版（纯 JS，零依赖）。
 *
 * ⚠️ 为什么不用现成的 `hipee-protocol/dist/hipee07.js`：
 *    那份产物停留在 2026-10-11，**缺本轮修掉的两个 P0**——
 *      · `buildSetReminder07(slot, seconds)` 没有「重复日掩码」参数，
 *        掩码为 0 时药盒会回 `0x31 02`（拒绝），提醒根本不生效；
 *      · `buildClearReminder07(slot)` 没有「要删的时刻」参数，会发成清除 00:00，
 *        药盒不认，点了清除还在响。
 *    这里以 PWA 侧最新对齐抓包的 `commands07.ts` 与 Android 侧 `HiPee07.kt` 为移植源，
 *    并与二者逐字节对齐（有测试守护，见 `tests/protocol.test.mjs`）。
 *
 * 置信度分级（与抓包证据保持一致，别把推断当结论）：
 *   - confirmed  ：真机抓包确认（帧格式、0x30 载荷、0x31 回执语义）
 *   - inferred   ：FIND_BOX 0x23 / UNBIND 0x2a 的 opcode，抓包未捕获
 *   - 待真机确认  ：重复日掩码 bit 顺序（现按 bit0=周一…bit6=周日）、记录帧 flag 语义
 */

/** 07 framed commands belong to the ff00 control service, not the 5833 identity channel. */
export const SERVICE_CONTROL = '0000ff00-0000-1000-8000-00805f9b34fb';
export const CHAR_CONTROL_WRITE = '0000ff02-0000-1000-8000-00805f9b34fb';
export const CHAR_CONTROL_NOTIFY = '0000ff01-0000-1000-8000-00805f9b34fb';

/** Optional bare-byte identity service. Kept aliases are not valid for 07 control traffic. */
export const SERVICE_5833 = '5833ff01-9b8b-5191-6142-22a4536ef123';
export const CHAR_WRITE = '5833ff02-9b8b-5191-6142-22a4536ef123';
export const CHAR_NOTIFY = '5833ff03-9b8b-5191-6142-22a4536ef123';
export const SERVICE_IDENTITY = SERVICE_5833;
export const CHAR_IDENTITY_WRITE = CHAR_WRITE;
export const CHAR_IDENTITY_NOTIFY = CHAR_NOTIFY;

export const FRAME_START_07 = 0x07;

export const CMD07 = {
  QUERY: 0x03,
  QUERY_RSP: 0x04,
  BIND: 0x05,
  SYNC: 0x0a,
  ENABLE: 0x0b,
  SET_REMINDER: 0x30,
  SET_REMINDER_RSP: 0x31,
  STATUS: 0x32,
  FIND_BOX: 0x23,
  UNBIND: 0x2a,
};

/** 裸字节信息通道（5833ff02，无帧头无校验）。 */
export const OBS = { PING: 0x01, DEVICE_INFO: 0x02, STATUS: 0x03, R_PING_ACK: 0x06, R_STATUS: 0x05, NAK: 0x69 };

/** 药盒物理仓位数：compartment 1..4，官方抓包是 slot 01/02/03。 */
export const PILLBOX_COMPARTMENTS = 4;

/** 重复日掩码：0x7f = 每天（官方抓包里所有生效提醒都带 0x7f）。 */
export const DAY_MASK_EVERYDAY = 0x7f;

/** 绑定确认窗口：官方流程夹着一次**人工短按药盒顶部按钮**，必须给足时间。 */
export const BIND_CONFIRM_TIMEOUT_MS = 12_000;

/** 默认命令等待窗口。 */
export const DEFAULT_TIMEOUT_MS = 4_000;

/** 一天 86399 秒；时间字段是 uint24，**不存在 18:12:15 这类人为上限**。 */
export const REMINDER_TIME_MAX_SEC = 86399;

/* ------------------------------ 帧编解码 ------------------------------ */

/** 校验字节：使整帧所有字节之和 % 256 == 0。 */
export function checksum(bytes) {
  let sum = 0;
  for (const b of bytes) sum = (sum + (b & 0xff)) & 0xff;
  return (256 - sum) & 0xff;
}

export function verifyChecksum(frame) {
  if (frame.length < 3) return false;
  let sum = 0;
  for (const b of frame) sum = (sum + (b & 0xff)) & 0xff;
  return sum === 0;
}

/** 07 LEN CMD DATA[LEN-1] CHK —— LEN 含 CMD。 */
export function buildFrame07(cmd, payload = new Uint8Array(0)) {
  if (payload.length > 251) throw new RangeError('payload 过长：单帧 LEN 只有 1 字节');
  const body = new Uint8Array(3 + payload.length);
  body[0] = FRAME_START_07;
  body[1] = payload.length + 1;
  body[2] = cmd & 0xff;
  body.set(payload, 3);
  const out = new Uint8Array(body.length + 1);
  out.set(body, 0);
  out[body.length] = checksum(body);
  return out;
}

/** 面向流式 Notify 的增量解码器：处理 MTU 分片 / 粘包。 */
export class Frame07Decoder {
  #buffer = new Uint8Array(0);
  push(chunk) {
    const merged = new Uint8Array(this.#buffer.length + chunk.length);
    merged.set(this.#buffer, 0);
    merged.set(chunk, this.#buffer.length);
    const frames = [];
    let i = 0;
    while (i + 3 <= merged.length) {
      if ((merged[i] & 0xff) !== FRAME_START_07) { i++; continue; }
      const len = merged[i + 1] & 0xff;
      const total = len + 3;
      if (i + total > merged.length) break; // 未到齐，等下一包
      const frame = merged.slice(i, i + total);
      if (verifyChecksum(frame)) {
        frames.push({ cmd: frame[2] & 0xff, payload: frame.slice(3, 3 + len - 1), raw: frame });
        i += total;
      } else {
        i++; // 失步，滑一个字节重新同步
      }
    }
    this.#buffer = merged.slice(i);
    return frames;
  }
  reset() { this.#buffer = new Uint8Array(0); }
  get pending() { return this.#buffer.length; }
}

/* ------------------------------ 请求构造 ------------------------------ */

export function buildQuery07() { return buildFrame07(CMD07.QUERY); }
export function buildEnable07() { return buildFrame07(CMD07.ENABLE, new Uint8Array([0x01])); }
export function buildSync07() { return buildFrame07(CMD07.SYNC); }
export function buildBind07(token = new Uint8Array([0x6a, 0xcb, 0x2b, 0x7c])) { return buildFrame07(CMD07.BIND, token); }
export function buildFindBox07() { return buildFrame07(CMD07.FIND_BOX); }
export function buildUnbind07() { return buildFrame07(CMD07.UNBIND); }

/**
 * 0x30 纯载荷：
 *   7 字节 `02 03 <slot> <T0 T1 T2> <mask>`（variant 0x03，设置）
 *   6 字节 `02 00 <slot> <T0 T1 T2>`      （variant 0x00，清除）
 */
export function payloadSetReminder07(slot, timeField, variant = 0x03, dayMask = 0) {
  if (variant !== 0x03 && variant !== 0x00) throw new RangeError('variant 仅支持 0x03 / 0x00');
  const hasMask = variant === 0x03;
  const body = new Uint8Array(hasMask ? 7 : 6);
  body[0] = 0x02;
  body[1] = variant & 0xff;
  body[2] = slot & 0xff;
  for (let i = 0; i < 3; i++) body[3 + i] = timeField[i] ?? 0;
  if (hasMask) body[6] = dayMask & 0xff;
  return body;
}

/** 距零点秒数 -> 3 字节 uint24 大端。 */
export function reminderTimeField24(secondsFromMidnight) {
  const s = Math.max(0, Math.floor(secondsFromMidnight));
  return new Uint8Array([(s >> 16) & 0xff, (s >> 8) & 0xff, s & 0xff]);
}

export function buildSetReminder07(slot, timeField, dayMask = DAY_MASK_EVERYDAY) {
  return buildFrame07(CMD07.SET_REMINDER, payloadSetReminder07(slot, timeField, 0x03, dayMask));
}

/** 清除某仓提醒：官方抓包 `02 00 01 00 70 80`——**必须带着要删的真实时刻**。 */
export function buildClearReminder07(slot, secondsFromMidnight) {
  return buildFrame07(CMD07.SET_REMINDER, payloadSetReminder07(slot, reminderTimeField24(secondsFromMidnight), 0x00));
}

/** "HH:mm" -> 距零点秒数；非法返回 null。 */
export function secondsFromMidnight(hhmm) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(hhmm ?? '').trim());
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60;
}

/** 业务上限校验：越界抛错，绝不静默截断。 */
export function assertSecondsFromMidnight(secs) {
  if (!Number.isFinite(secs) || secs < 0 || secs > REMINDER_TIME_MAX_SEC) {
    const hh = Math.floor(Math.max(0, secs) / 3600);
    const mm = Math.floor((Math.max(0, secs) % 3600) / 60);
    throw new RangeError(
      `服药时间 ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')} 不是合法的「距零点秒数」（必须 0..86399）——拒绝静默截断`,
    );
  }
}

/* ------------------------------ 响应解析 ------------------------------ */

/** 0x31 回执：**仅 01 是成功，02 是设备拒绝**。抓包帧序 8..11 是唯一裁决依据。 */
export function parseSetReminderRsp07(payload) {
  return (payload?.[0] & 0xff) === 0x01;
}

/** 0x04 查询回复：电量与版本（布局为推断）。 */
export function parseQueryRsp07(payload) {
  return {
    battery: payload?.length >= 1 && payload[0] <= 100 ? payload[0] : null,
    version: payload?.length >= 3 ? `${payload[1]}.${String(payload[2]).padStart(2, '0')}` : null,
  };
}

/**
 * 0x32 状态帧解析。
 * 两类记录都要认：Mock 约定的 0xFE，与真机抓包的 `02 <idx> <4B ts> <flag>`。
 */
export function parseStatus07(payload) {
  const tag = payload?.[0] ?? 0;
  if (tag === 0xfc && payload.length === 1) return { type: 'sync-end' };
  if (tag === 0xfe && payload.length >= 7) {
    return {
      type: 'record',
      compartment: payload[1],
      flag: payload[2],
      semantics: 'mock-only-unverified',
      timestamp: readUintBE(payload, 3, 4),
    };
  }
  // 真机同步回包（抓包原文 07 08 32 02 00 6a ca d1 80 02 36）
  if (payload.length >= 7 && tag === 0x02) {
    return {
      type: 'record-raw',
      index: payload[1],
      timestamp: readUintBE(payload, 2, 4),
      flag: payload[6],
    };
  }
  if (payload.length === 6 && tag >= 0 && tag <= 3) {
    return { type: 'event-raw', tag, compartment: payload[1], timestamp: readUintBE(payload, 2, 4), semantics: 'unverified' };
  }
  return { type: 'unknown', payload };
}

export function readUintBE(bytes, offset, width) {
  let v = 0;
  for (let i = 0; i < width; i++) v = v * 256 + ((bytes[offset + i] ?? 0) & 0xff);
  return v;
}

export function toHex(bytes) {
  return Array.from(bytes, (b) => (b & 0xff).toString(16).padStart(2, '0')).join(' ');
}

/** 业务层「1=周一…7=周日」-> 设备掩码（bit0=周一…bit6=周日，待真机确认）。 */
export function weekToDayMask(week) {
  if (!week || week.length === 0 || week.length === 7) return DAY_MASK_EVERYDAY;
  let mask = 0;
  for (const d of week) if (Number.isInteger(d) && d >= 1 && d <= 7) mask |= 1 << (d - 1);
  return mask === 0x7f ? DAY_MASK_EVERYDAY : mask;
}
