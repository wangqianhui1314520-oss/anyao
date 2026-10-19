import { createPillbox } from './pillbox3d.js';
import { createWatch } from './watch3d.js';
import { boxRinging, watchRinging, beep2, softAlert, onUnlock } from './stage-sound.js';
import { createAutoplay } from './autoplay.js';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const key = params.get('k') || localStorage.getItem('anyao-link-key') || '';
if (params.get('k')) localStorage.setItem('anyao-link-key', params.get('k'));
let view = null, phoneRole = 'user';

const post = (path, body) => fetch(`${path}?k=${encodeURIComponent(key)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json()).catch(() => ({ ok: false, message: '联动服务没有响应' }));

// ---------- 手机：真实安药应用 ----------
function loadPhone(role) {
  phoneRole = role;
  $('phone-frame').src = `/app/${role === 'family' ? 'family' : 'index'}.html?k=${encodeURIComponent(key)}&embed=1`;
  document.querySelectorAll('[data-role-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.roleView === role)));
  renderNotices();
}
document.querySelectorAll('[data-role-view]').forEach(b => b.addEventListener('click', () => loadPhone(b.dataset.roleView)));
// 手机屏幕上的安卓通知（与真机通知同一组按钮）
let notices = [];
function renderNotices() {
  const layer = $('notice-layer');
  layer.replaceChildren(...notices.filter(n => n.role === phoneRole).slice(0, 2).map(n => {
    const el = document.createElement('div'); el.className = 'notice'; el.dataset.id = n.id;
    el.innerHTML = '<header><i></i>安药<span></span></header><strong></strong><p></p>';
    el.querySelector('span').textContent = n.time || '现在';
    el.querySelector('strong').textContent = n.title; el.querySelector('p').textContent = n.text || '';
    if (n.actions?.length) {
      const acts = document.createElement('div'); acts.className = 'acts';
      n.actions.forEach(([op, label]) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.onclick = e => { e.stopPropagation(); act(n, op); }; acts.append(b); });
      el.append(acts);
    }
    el.addEventListener('click', () => act(n, 'open'));
    return el;
  }));
}
async function act(n, op) {
  notices = notices.filter(x => x.id !== n.id); renderNotices();
  await post('/native/notification', { id: n.id, op });
}
function addNotice(n) {
  const d = new Date(n.at); n.time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  notices = [n, ...notices.filter(x => x.id !== n.id && !(n.tag && x.tag === n.tag))].slice(0, 6);
  renderNotices();
  // 与安卓悬浮通知一样：几秒后收起，不长时间挡住应用
  setTimeout(() => { if (notices.includes(n)) { notices = notices.filter(x => x !== n); renderNotices(); } }, n.actions?.length ? 9000 : 5000);
}

// 拨号、短信、系统设置等：在手机屏幕上弹出系统界面示意
function systemSheet(ui) {
  if (ui.role && ui.role !== phoneRole) return;
  const sheet = $('system-sheet');
  const phoneIcon = '<div class="call-ring"><svg viewBox="0 0 24 24"><path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1A17 17 0 0 1 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.2.2 2.4.6 3.6.1.3 0 .7-.2 1z"/></svg></div>';
  const map = {
    call: [`${ui.auto ? '安药自动拨号' : '系统电话'}`, `正在呼叫 ${ui.name || ''}`, `${ui.phone || ''}<br>演示：没有真实拨出`, phoneIcon],
    sms: ['系统短信', `发给 ${ui.phone || ''}`, ui.text || '', ''],
    email: ['邮件', `发给 ${ui.to || ''}`, ui.text || '', ''],
    wechat: ['微信', '提醒文字已复制', `${ui.text || ''}<br>选择联系人后粘贴发送`, ''],
    share: ['系统分享', '分享提醒', ui.text || '', ''],
    settings: ['系统设置', ui.title, '演示：已打开对应的系统设置页', ''],
    permission: ['系统权限', ui.title, '演示：已在系统弹窗里允许', ''],
  }[ui.kind] || ['系统', ui.title || '', '', ''];
  sheet.innerHTML = `<small>${map[0]}</small>${map[3]}<h4></h4><p>${map[2]}</p><button type="button">好的</button>`;
  sheet.querySelector('h4').textContent = map[1];
  sheet.querySelector('button').onclick = () => { sheet.hidden = true; };
  sheet.hidden = false;
  clearTimeout(systemSheet.t); systemSheet.t = setTimeout(() => { sheet.hidden = true; }, ui.kind === 'call' ? 6000 : 4200);
}

// 手机震动 / 闪光（嵌在大屏的手机通过 postMessage 报告效果）
addEventListener('message', event => {
  if (event.data?.anyao !== 'phone-effects') return;
  const e = event.data.effects;
  if (e.vibration) { $('phone-panel').classList.remove('ringing'); void $('phone-panel').offsetWidth; $('phone-panel').classList.add('ringing'); }
  if (e.flash) {
    let n = 0; const layer = document.createElement('div'); layer.className = 'screen-flash'; document.querySelector('.phone-screen').append(layer);
    const step = () => { if (n++ >= e.flash.repeats) return layer.remove(); layer.style.opacity = '.9'; setTimeout(() => { layer.style.opacity = '0'; setTimeout(step, e.flash.intervalMs); }, e.flash.pulseMs); };
    step();
  }
});

// ---------- 三维设备 ----------
let flashTimer = 0;
function flash(text) {
  $('box-screen-text').dataset.flash = '1'; $('box-screen-text').textContent = text; $('box-screen-card').style.background = '#4a2a1a';
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { delete $('box-screen-text').dataset.flash; $('box-screen-card').style.background = ''; if (view) paint(view); }, 2200);
}
const fire = async (type, payload = {}) => {
  const r = await post('/native/physical', { type, ...payload });
  if (r && !r.ok && r.message) flash(r.message); else if (r?.warning) flash(r.warning);
};
const pillbox = createPillbox($('box-stage'), { onAction: fire, onReady: error => { $('box-loading').hidden = !error; if (error) $('box-loading').textContent = '药盒模型未能载入，请通过“启动联动.cmd”打开'; } });
const watch = createWatch($('watch-stage'), { onAction: fire, onReady: error => { $('watch-loading').hidden = !error; if (error) $('watch-loading').textContent = '手表模型未能载入'; } });

const BOX_SCREEN = { unpairedOpen: '已唤醒 · 等待手机连接', wrong: '当前药非当前时段 · 单击取消 / 双击确认', standby: '主页 · 现在 / 上次 / 下次与药仓', vibrate: '左滑 · 仅振动（按键开关）', sleep: '右滑 · 休眠（按键进入 / 结束）', asleep: '休眠中 · 睡醒后再提醒', unpaired: '未连接安药', reminder: '该吃药了', open: '请打开药仓', take: '取出药片', awaiting: '取药后请确认', confirmed: '已确认服用', closing: '请合上药盒' };
function hintButtons(host, list) {
  const sig = JSON.stringify(list.map(item => item.slice(0, 2)));
  if (host.dataset.sig === sig) return;
  host.dataset.sig = sig;
  host.replaceChildren(...list.map(([label, type, payload, next]) => {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = label; if (next) b.className = 'next';
    b.addEventListener('click', () => fire(type, payload)); return b;
  }));
}

function paint(v) {
  view = v;
  $('sb-time').textContent = v.clock;
  $('demo-clock').textContent = v.clock;
  $('demo-clock').parentElement.classList.toggle('shifted', Math.abs(v.offset) > 30000);
  pillbox.update(v); watch.update(v);
  const box = v.box, s = box.session;
  // 提示音：药盒提醒期间持续响铃（仅振动 / 休眠时不响）；手表每次短振“嘀嘀”；误开药仓短促提示
  const level = { gentle: .6, standard: 1, strong: 1.4 }[box.fx?.mode] || 1;
  boxRinging(box.effect === 'reminder' && !!s?.ringing && !box.modes?.vibrateOnly && !box.modes?.sleep, level);
  if (paint.buzz !== undefined && v.watch.buzzSeq !== paint.buzz) beep2(v.watch.vibrationEnabled === false ? .5 : 1);
  paint.buzz = v.watch.buzzSeq;
  // 手表：用药通知没处理之前，每 2.4 秒再嘀嘀一次（同时表体短振）
  watchRinging(v.watch.screen === 'notification' && !v.watch.notification?.test && !!s?.ringing, level);
  if (box.wrong && !paint.wrong) softAlert();
  paint.wrong = !!box.wrong;
  const boxBadge = !box.paired ? ['未连接', 'off'] : {
 wrong: ['红灯 · 误开药仓', 'alert'], reminder: ['橙灯 · 震动', 'alert'], preview: ['预览效果', 'warn'], find: ['寻找药盒', 'warn'], awaiting: ['等待确认', 'warn'], confirmed: ['绿灯 · 已确认', 'done'], off: [box.modes?.sleep ? `休眠中 · 到 ${box.modes.sleep.until}` : box.outer ? '外盖打开' : box.connected ? '已连接 · 待机' : '待机（蓝牙未连）', ''] }[box.effect];
  if (box.paired && box.modes?.vibrateOnly && box.effect !== 'wrong') boxBadge[0] += ' · 仅振动';
  $('box-badge').textContent = boxBadge[0]; $('box-badge').className = 'badge ' + boxBadge[1];
  $('box-panel').classList.toggle('is-offline', !box.paired);
  if (!$('box-screen-text').dataset.flash) $('box-screen-text').textContent = (box.screen === 'unpaired' && box.outer ? BOX_SCREEN.unpairedOpen : BOX_SCREEN[box.screen]) + (s && ['reminder', 'open', 'take'].includes(box.screen) ? ` · ${s.compartment}号仓` : '');
  const w = v.watch;
  $('watch-badge').textContent = !w.paired ? '未连接' : !w.enabled ? '提醒已关闭' : { face: '表盘', notification: '用药通知', confirm: '请在手机确认', records: '确认记录', connection: '已连接' }[w.screen] || '表盘';
  $('watch-badge').className = 'badge ' + (!w.paired ? 'off' : w.screen === 'notification' ? 'alert' : '');
  $('watch-panel').classList.toggle('is-offline', !w.connected);
  const dose = v.doses.find(d => ['due', 'missed', 'delay'].includes(d.level));
  const phoneBadge = !v.drugs.length ? ['还没有用药计划', ''] : dose ? { due: ['该吃药了', 'alert'], missed: ['超时未吃', 'alert'], delay: ['稍后提醒', 'warn'] }[dose.level] : v.doses.every(d => ['taken', 'late', 'skipped'].includes(d.level)) && v.doses.length ? ['今天都吃完了', 'done'] : ['待机', ''];
  $('phone-badge').textContent = phoneBadge[0]; $('phone-badge').className = 'badge ' + phoneBadge[1];

  // 药盒上“下一步”：总是给出当下最自然的实物动作
  const hints = [];
  if (box.wrong) {
    hints.push(['单击 · 取消', 'box.button', {}]);
    hints.push(['双击 · 确认服用', 'box.button', { double: true }, true]);
    hints.push([`合上 ${box.wrong.compartment} 号仓`, 'box.inner', { n: box.wrong.compartment, open: false }]);
  } else if (s && !s.confirmed) {
    if (!box.outer) hints.push(['打开外盖', 'box.lid', { open: true }, true]);
    else if (!box.inner[s.compartment - 1] && !s.removed) hints.push([`打开 ${s.compartment} 号仓`, 'box.inner', { n: s.compartment, open: true }, true]);
    else if (!s.removed) hints.push(['取出药片', 'box.take', { n: s.compartment }, true]);
    if (s.ringing) hints.push(['按键停止响铃', 'box.button', {}]);
    if (box.outer && s.removed) hints.push(['合上外盖', 'box.lid', { open: false }]);
  } else if (box.outer) hints.push(['合上外盖', 'box.lid', { open: false }, !!s]);
  else hints.push([box.connected ? '打开外盖' : '打开外盖 · 手机弹出连接', 'box.lid', { open: true }, !box.connected]);
  // 误开演示：盖子开着、没有误开时，可直接点开一个不是本次的药仓
  if (!box.wrong && box.outer) { const other = [1, 2, 3, 4].find(n => n !== s?.compartment && !box.inner[n - 1] && box.plans.some(p => p.compartment === n)); if (other) hints.push([`打开 ${other} 号仓`, 'box.inner', { n: other, open: true }]); }
  // 屏幕滑动与当前页的按键（主页时才能滑）
  if (box.paired && !box.wrong && (!s || s.confirmed || s.skipped)) {
    const m = box.modes || {};
    if (box.page === 'vibrate') hints.unshift([m.vibrateOnly ? '按键 · 关闭仅振动' : '按键 · 开启仅振动', 'box.button', {}, true], ['右滑 · 回主页', 'box.swipe', { dir: 'right' }]);
    else if (box.page === 'sleep') hints.unshift([m.sleep ? '按键 · 结束休眠' : `按键 · 休眠 ${m.napMinutes} 分钟`, 'box.button', {}, true], ['左滑 · 回主页', 'box.swipe', { dir: 'left' }]);
    else hints.push(['屏幕左滑 · 仅振动', 'box.swipe', { dir: 'left' }], ['屏幕右滑 · 休眠', 'box.swipe', { dir: 'right' }]);
  }
  hintButtons($('box-hints'), hints);
  const watchHints = [['抬腕', 'watch.raise', {}]];
  if (w.screen === 'notification' && w.notification) watchHints.push(['在手机上打开', 'watch.openPhone', {}, true]);
  if (w.screen !== 'face') watchHints.push(['返回表盘', 'watch.dismiss', {}]);
  hintButtons($('watch-hints'), watchHints);

  $('p-phone').classList.toggle('on', (v.presence?.phone || 0) > 0);
  $('p-phone-text').textContent = v.presence?.phone ? `手机已加入 ${v.presence.phone} 台` : '手机未加入';
  const feed = $('feed'), sig = v.log.slice(0, 6).map(item => item.at + item.text).join('|');
  if (feed.dataset.sig !== sig) {
    feed.dataset.sig = sig;
    feed.replaceChildren(...v.log.slice(0, 6).map(item => { const li = document.createElement('li'); li.dataset.tone = item.tone; li.innerHTML = '<time></time><b></b><span></span>'; li.querySelector('time').textContent = item.time; li.querySelector('b').textContent = item.actor; li.querySelector('span').textContent = item.text; return li; }));
  }
}

loadPhone('user');

// 手机画面按外框尺寸缩放
const screenBox = document.querySelector('.phone-screen');
new ResizeObserver(() => { const r = screenBox.getBoundingClientRect(); screenBox.style.setProperty('--s', r.width / 393); screenBox.style.setProperty('--ratio', r.height / r.width); }).observe(screenBox);

// ---------- 实时连接 ----------
let presence = { phone: 0 };
const source = new EventSource(`/api/events?role=stage&k=${encodeURIComponent(key)}`);
source.addEventListener('open', () => { $('p-link').classList.add('on'); $('p-link').querySelector('span').textContent = '联动服务'; });
source.addEventListener('error', () => { $('p-link').classList.remove('on'); $('p-link').querySelector('span').textContent = source.readyState === 2 ? '配对码无效' : '服务重连中'; });
source.addEventListener('state', e => { const v = JSON.parse(e.data); v.presence = presence; paint(v); });
source.addEventListener('presence', e => { presence = JSON.parse(e.data); if (view) { view.presence = presence; paint(view); } });
source.addEventListener('notification', e => addNotice(JSON.parse(e.data)));
source.addEventListener('notification-cancel', e => { const { tag } = JSON.parse(e.data); notices = notices.filter(n => n.tag !== tag); renderNotices(); });
source.addEventListener('system-ui', e => systemSheet(JSON.parse(e.data)));
source.addEventListener('reload', () => loadPhone(phoneRole));
source.addEventListener('backup', e => {
  const { name, data, role } = JSON.parse(e.data);
  if (role !== phoneRole) return;
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })); a.download = name; a.click();
  systemSheet({ kind: 'settings', title: `已保存 ${name}`, role });
});
fetch(`/native/state?k=${encodeURIComponent(key)}`).then(r => r.json()).then(paint).catch(() => {});

// ---------- 演示时间 ----------
document.querySelectorAll('[data-demo]').forEach(b => b.addEventListener('click', async () => {
  const kind = b.dataset.demo;
  if (kind === 'reset' && !confirm('从零开始：清空安药里的全部记录，药盒与手表恢复未连接。确定吗？')) return;
  b.disabled = true;
  const body = kind === 'add' ? { op: 'clock', addMinutes: Number(b.dataset.min) } : kind === 'now' ? { op: 'clock', reset: true } : { op: kind };
  const r = await post('/demo', body);
  b.disabled = false;
  if (r?.message) flash(r.message);
  if (['sample', 'now'].includes(kind)) loadPhone(phoneRole);
}));

// ---------- 扫码加入 ----------
async function openPair() {
  const info = await fetch(`/native/info?k=${encodeURIComponent(key)}`).then(r => r.json()).catch(() => null);
  const urls = [`${location.origin}/app/entry.html?k=${key}`, ...(info?.lan || [])];
  const pick = url => {
    const qr = qrcode(0, 'M'); qr.addData(url); qr.make();
    $('qr').innerHTML = qr.createSvgTag({ cellSize: 6, margin: 0, scalable: true });
    $('pair-url').textContent = url;
    [...$('url-select').children].forEach(b => b.setAttribute('aria-pressed', String(b.dataset.url === url)));
  };
  $('url-select').replaceChildren(...(urls.length > 1 ? urls : []).map(url => { const b = document.createElement('button'); b.type = 'button'; b.dataset.url = url; b.textContent = new URL(url).hostname; b.onclick = () => pick(url); return b; }));
  pick(urls.find(url => url.startsWith(location.origin)) || urls[0]);
  $('pair').showModal();
}
$('pair-open').addEventListener('click', openPair);
$('pair-close').addEventListener('click', () => $('pair').close());
// ---------- 一键演示全部功能 ----------
const autoplay = createAutoplay({
  post, fire, state: () => view, notices: () => notices, phoneFrame: () => $('phone-frame'), loadPhone, pillbox,
  onCaption: c => {
    $('caption').hidden = !c;
    $('autoplay').setAttribute('aria-pressed', String(!!c)); $('autoplay').textContent = c ? '演示中…' : '▶ 一键演示全部功能';
    $('autoplay-pause').hidden = $('autoplay-stop').hidden = !c;
    if (!c) { $('autoplay-pause').textContent = '暂停'; return; }
    $('cap-step').textContent = `${c.step + 1} / ${c.total}`; $('cap-title').textContent = c.title; $('cap-text').textContent = c.text;
  },
});
onUnlock(on => $('cap-sound').classList.toggle('on', on));
$('autoplay').addEventListener('click', () => { if (!autoplay.running) autoplay.play(); });
$('autoplay-pause').addEventListener('click', () => { $('autoplay-pause').textContent = autoplay.pause() ? '继续' : '暂停'; });
$('autoplay-stop').addEventListener('click', () => autoplay.stop());
if (params.get('autoplay') === '1') setTimeout(() => autoplay.play(), 2500);
window.anyaoStage = { state: () => view, pillbox, watch, fire, post, openPair, loadPhone, notices: () => notices, autoplay };
