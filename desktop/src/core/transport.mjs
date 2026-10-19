/** Real BLE transport, separated from DOM for lifecycle and race regression tests. */
import { SERVICE_CONTROL, CHAR_CONTROL_WRITE, CHAR_CONTROL_NOTIFY, SERVICE_IDENTITY, Frame07Decoder, toHex, DEFAULT_TIMEOUT_MS } from './hipee07.mjs';
export class HiPeeDevice {
  #writeChar = null; #notifyChar = null; #decoder = new Frame07Decoder();
  #waiters = []; #listeners = new Set(); #onNotification; #onDisconnect;
  constructor(device, log = () => {}) { this.gatt = device; this.log = log; }
  static async connect({ chosenDevice = null, onDisconnected, log = () => {} } = {}) {
    if (!chosenDevice && !globalThis.navigator?.bluetooth) throw new Error('当前环境不支持 Web Bluetooth（需要 Electron/Chrome 顶层窗口）');
    const chosen = chosenDevice || await globalThis.navigator.bluetooth.requestDevice({
      filters: [{ services: [SERVICE_CONTROL] }, { namePrefix: 'Hi-PB' }, { namePrefix: 'HiPee' }], optionalServices: [SERVICE_CONTROL, SERVICE_IDENTITY],
    });
    if (!chosen?.gatt || typeof chosen.gatt.connect !== 'function') throw new Error('已选设备未提供可连接的 GATT 对象');
    const instance = new HiPeeDevice(chosen, log);
    try {
      const server = await chosen.gatt.connect();
      let service;
      try { service = await server.getPrimaryService(SERVICE_CONTROL); }
      catch (cause) {
        const unsupported = new Error('该设备未暴露 Hi-PB1 ff00 控制服务，无法发送药盒指令；不会改向 5833 身份通道');
        unsupported.name = 'NotSupportedError'; unsupported.cause = cause; throw unsupported;
      }
      instance.#writeChar = await service.getCharacteristic(CHAR_CONTROL_WRITE);
      instance.#notifyChar = await service.getCharacteristic(CHAR_CONTROL_NOTIFY);
      instance.#onNotification = (event) => {
        const value = event.target.value;
        const chunk = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
        log('RX ' + toHex(chunk));
        for (const frame of instance.#decoder.push(chunk)) {
          instance.#listeners.forEach((fn) => fn(frame));
          const index = instance.#waiters.findIndex((waiter) => waiter.expect.includes(frame.cmd));
          if (index >= 0) instance.#waiters[index].received(frame);
        }
      };
      instance.#onDisconnect = () => { instance.#cleanup(); onDisconnected?.('gatt-disconnected'); };
      instance.#notifyChar.addEventListener('characteristicvaluechanged', instance.#onNotification);
      chosen.addEventListener('gattserverdisconnected', instance.#onDisconnect);
      await instance.#notifyChar.startNotifications();
      return instance;
    } catch (error) { instance.disconnect(); throw error; }
  }
  get name() { return this.gatt.name || 'HiPee 药盒'; }
  get id() { return this.gatt.id || this.name; }
  async write(bytes) {
    if (!this.gatt.gatt.connected || !this.#writeChar) throw new Error('GATT 已断开');
    // Choose one ATT capability. Blindly retrying another write method can execute twice.
    if (this.#writeChar.properties?.write) await this.#writeChar.writeValueWithResponse(bytes);
    else if (this.#writeChar.properties?.writeWithoutResponse) await this.#writeChar.writeValueWithoutResponse(bytes);
    else throw new Error('特征不支持已知写入方式');
  }
  async send(frame, expect, { timeout = DEFAULT_TIMEOUT_MS, onSent } = {}) {
    return new Promise((resolve, reject) => {
      let settled = false, written = false, earlyResponse = null;
      const waiter = { expect,
        finish: (error, response) => {
          if (settled) return; settled = true; clearTimeout(timer);
          const index = this.#waiters.indexOf(waiter); if (index >= 0) this.#waiters.splice(index, 1);
          error ? reject(error) : resolve(response);
        },
        received: (response) => { if (written) waiter.finish(null, response); else earlyResponse = response; },
      };
      const timer = setTimeout(() => {
        waiter.finish(new Error(`等待 ${expect.map((code) => '0x' + code.toString(16)).join('/')} 超时（${timeout}ms）；需重连以防迟到回包误匹配`));
        // The wire protocol has no request identifier. A timed-out reply must never acknowledge
        // the next command with the same opcode; terminate this GATT epoch instead.
        const disconnected = this.#onDisconnect;
        this.disconnect(); disconnected?.();
      }, timeout);
      this.#waiters.push(waiter); this.log('TX ' + toHex(frame));
      this.write(frame).then(() => {
        if (settled) return; // Late ATT completion cannot overwrite a terminal timeout event.
        written = true; onSent?.();
        if (earlyResponse) waiter.finish(null, earlyResponse);
      }).catch((error) => waiter.finish(error));
    });
  }
  onFrame(handler) { this.#listeners.add(handler); return () => this.#listeners.delete(handler); }
  #cleanup() {
    this.#notifyChar?.removeEventListener('characteristicvaluechanged', this.#onNotification);
    this.gatt.removeEventListener('gattserverdisconnected', this.#onDisconnect);
    for (const waiter of [...this.#waiters]) waiter.finish(new Error('设备断开，操作未确认'));
    this.#listeners.clear(); this.#decoder.reset(); this.#writeChar = null;
  }
  disconnect() { this.#cleanup(); if (this.gatt.gatt?.connected) this.gatt.gatt.disconnect(); }
}
