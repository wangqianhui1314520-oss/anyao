// 演示时钟：整个服务进程（含安药 server.js）共用一个可快进的时间。
// 只改“现在是几点”，构造指定时间的 Date 保持原样，所以记录里的时间戳都与演示时间一致。
'use strict';
const RealDate = Date;
let offset = 0;
class DemoDate extends RealDate {
  constructor(...args) { if (args.length === 0) super(RealDate.now() + offset); else super(...args); }
  static now() { return RealDate.now() + offset; }
}
global.Date = DemoDate;
module.exports = {
  now: () => RealDate.now() + offset,
  get offset() { return offset; },
  set(ms) { offset = ms - RealDate.now(); },
  add(ms) { offset += ms; },
  reset() { offset = 0; },
};
