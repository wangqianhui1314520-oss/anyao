// 大屏上的药盒、手表提示音（WebAudio 合成，无外部音频文件）。
// 药盒：提醒期间每 1.6 秒“叮咚”一次，取药 / 按键 / 确认后停止；仅振动、休眠时不响。
// 手表：每次短振同时“嘀嘀”两声。
// 浏览器要求用户先点一下页面才能出声：第一次点击时解锁，并在右上角显示“声音已开启”。
let ctx = null, unlocked = false;
const listeners = new Set();
function ensure() {
  try { ctx ||= new AudioContext(); if (ctx.state === 'suspended') ctx.resume(); unlocked = ctx.state === 'running' || unlocked; } catch { /* 无音频设备 */ }
  return ctx;
}
addEventListener('pointerdown', () => { ensure(); setTimeout(() => listeners.forEach(f => f(unlocked)), 60); }, { capture: true });

function tone(freq, start, dur, gain = .22, type = 'sine') {
  const c = ensure(); if (!c || c.state !== 'running') return;
  const o = c.createOscillator(), g = c.createGain(), t = c.currentTime + start;
  o.type = type; o.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + .015); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
  o.connect(g).connect(c.destination); o.start(t); o.stop(t + dur + .05);
}
export const chime = (level = 1) => { tone(988, 0, .38, .2 * level); tone(784, .2, .5, .18 * level); };
export const beep2 = (level = 1) => { tone(1760, 0, .09, .16 * level, 'square'); tone(1760, .16, .09, .16 * level, 'square'); };
export const softAlert = () => { tone(440, 0, .18, .12, 'triangle'); };

let boxTimer = 0, boxOn = false;
export function boxRinging(on, level = 1) {
  if (on === boxOn) return; boxOn = on;
  clearInterval(boxTimer);
  if (on) { chime(level); boxTimer = setInterval(() => chime(level), 1600); }
}
let watchTimer = 0, watchOn = false;
export function watchRinging(on, level = 1) {
  if (on === watchOn) return; watchOn = on;
  clearInterval(watchTimer);
  if (on) watchTimer = setInterval(() => beep2(level), 2400);
}
export const onUnlock = f => { listeners.add(f); f(unlocked); };
export const isUnlocked = () => unlocked;
