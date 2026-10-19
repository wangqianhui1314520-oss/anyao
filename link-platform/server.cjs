// 安药三端实时联动服务。
// - /app/*      真实的安药应用页面（与 APK 内置页面完全相同），注入虚拟安卓层后以“安卓应用”运行
// - /api/*      安药自己的 server.js（真实数据层，进程内调用）
// - /native/*   虚拟安卓原生层：药盒、手表、提醒、电话等，驱动三维药盒与三维 Watch S3
// - /           电脑大屏：带外框的手机 + 三维药盒 + 三维手表
'use strict';
const clock = require('./clock.cjs');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { createDevices } = require('./devices.cjs');

const here = __dirname;
const appDir = path.join(here, 'app'), stageDir = path.join(here, 'public'), dataDir = path.join(here, 'data');
const port = Number(process.env.PORT) || Number(process.env.ANYAO_LINK_PORT) || 4200;
const key = process.env.ANYAO_LINK_KEY || crypto.randomBytes(3).toString('hex');
fs.mkdirSync(dataDir, { recursive: true });
const appData = path.join(dataDir, 'anyao-data.json'), devData = path.join(dataDir, 'devices.json');
if (!fs.existsSync(appData)) fs.copyFileSync(path.join(appDir, 'empty-data.json'), appData);

// 真实数据层：安药 server.js
const { createServer: createAnyaoServer } = require(path.join(appDir, 'server.js'));
// server.js 返回 http.Server；取出它的请求处理函数在进程内调用
const createAnyao = options => createAnyaoServer(options).listeners('request')[0];
const anyaoRef = { current: createAnyao({ dataPath: appData, demo: false, liveReload: false }) };
async function appFetch(method, url, body) {
  const payload = body === undefined ? '' : JSON.stringify(body);
  const req = Readable.from(payload ? [Buffer.from(payload)] : []);
  Object.assign(req, { method, url, headers: { host: 'local', 'content-type': 'application/json' } });
  return new Promise(resolve => {
    let status = 200, chunks = [];
    const res = {
      writeHead(code) { status = code; return res; }, setHeader() {}, getHeader() {},
      write(chunk) { chunks.push(Buffer.from(chunk)); return true; },
      end(chunk) { if (chunk) chunks.push(Buffer.from(chunk)); const text = Buffer.concat(chunks).toString('utf8'); let parsed; try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { detail: text }; } resolve({ status, body: parsed }); },
    };
    anyaoRef.current(req, res);
  });
}

const clients = new Set();
function broadcast(kind, payload) { const frame = `event: ${kind}\ndata: ${JSON.stringify(payload)}\n\n`; for (const c of clients) c.write(frame); }
let saved = null; try { saved = JSON.parse(fs.readFileSync(devData, 'utf8')); } catch { /* first run */ }
const devices = createDevices({ appFetch, broadcast, saved, persist(state) { fs.writeFileSync(devData + '.tmp', JSON.stringify(state)); fs.renameSync(devData + '.tmp', devData); } });
const presence = { phone: 0, stage: 0, viewer: 0 };

const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.glb': 'model/gltf-binary', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json' };
const send = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
const readBody = req => new Promise((resolve, reject) => { const chunks = []; let size = 0; req.on('data', c => { size += c.length; if (size > 9e6) { reject(Error('too large')); req.destroy(); } else chunks.push(c); }); req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch (e) { reject(e); } }); req.on('error', reject); });
const lan = () => Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal && !/^169\.254\./.test(i.address)).map(i => i.address);
const authed = (req, url) => url.searchParams.get('k') === key || req.headers['x-anyao-key'] === key || (req.headers.cookie || '').includes(`anyao_link=${key}`);

// 页面注入：在 native-client.js 之前装上虚拟安卓层，并保存配对码
function injectApp(html) {
  // 放在 <head> 最前一次，页面的 android-app 判定与 native-client.js 都能看到 NativeApi
  return html.replace('<meta charset="UTF-8" />', '<meta charset="UTF-8" />\n  <script src="/fake-android.js"></script>')
    .replace('</body>', '  <script src="/demo-overrides.js"></script>\n  <script src="/demo-pb1-modes.js"></script>\n</body>');
}

function serveFile(res, file, transform) {
  fs.stat(file, (error, stat) => {
    if (error || !stat.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Not found'); }
    const type = mime[path.extname(file).toLowerCase()] || 'application/octet-stream';
    if (transform) { const text = transform(fs.readFileSync(file, 'utf8')); res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' }); return res.end(text); }
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': stat.size, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    fs.createReadStream(file).pipe(res);
  });
}

async function demo(body) {
  const minute = 60000;
  switch (body.op) {
    case 'clock': {
      if (body.reset) clock.reset();
      else if (body.addMinutes) clock.add(Number(body.addMinutes) * minute);
      else if (body.to) { // 跳到今天的某个时刻（只能往后）
        const target = devices.at(devices.today(), body.to);
        if (!(target > clock.now())) return { ok: false, message: '只能把时间往后调' };
        // 逐分钟推进，经过的每个提醒都按顺序发生
        const step = async () => { while (clock.now() < target) { clock.add(Math.min(minute, target - clock.now())); await devices.afterClockChange(); } };
        await step();
        return { ok: true, message: `现在 ${devices.hhmm()}` };
      }
      await devices.afterClockChange();
      return { ok: true, message: `现在 ${devices.hhmm()}` };
    }
    case 'next': { // 跳到下一次计划时刻
      const c = await devices.refresh(true);
      const now = devices.hhmm();
      const doses = (c.doses?.doses || []).filter(d => !['taken', 'skipped'].includes(d.status));
      const times = doses.map(d => d.snoozedUntil ? devices.hhmm(Date.parse(d.snoozedUntil)) : d.planned).filter(t => t > now).sort();
      const done = new Set((c.doses?.doses || []).filter(d => ['taken', 'skipped'].includes(d.status)).map(d => `${d.drugId}@${d.planned}`));
      const boxTimes = devices.raw.box.plans.flatMap(p => p.times.filter(t => !done.has(`${p.drugId}@${t}`))).filter(t => t > now).sort();
      const next = [...times, ...boxTimes].sort()[0];
      if (!next) return { ok: false, message: '今天没有更晚的计划了' };
      // 稍后提醒的到点时间带秒，跳到整分钟会差几秒：直接跳到那一刻
      const snoozeAt = doses.map(d => d.snoozedUntil && Date.parse(d.snoozedUntil)).filter(t => t && devices.hhmm(t) === next).sort()[0];
      const r = await demo({ op: 'clock', to: next });
      if (snoozeAt && snoozeAt > clock.now()) { clock.add(snoozeAt - clock.now() + 1000); await devices.afterClockChange(); }
      return r;
    }
    case 'timeout': { // 跳过“超时未吃”的等待
      const c = await devices.refresh(true);
      const d = (c.doses?.doses || []).find(x => ['due', 'delay'].includes(x.level));
      if (!d) return { ok: false, message: '现在没有到点未吃的一顿' };
      const ref = d.snoozedUntil ? Date.parse(d.snoozedUntil) : Date.parse(d.dueAt);
      const target = ref + c.doses.missedAfterMinutes * minute + 1000;
      clock.add(target - clock.now());
      await devices.afterClockChange();
      return { ok: true, message: `已过 ${c.doses.missedAfterMinutes} 分钟 · 现在 ${devices.hhmm()}` };
    }
    case 'sample': { // 一键准备示例：服药者、家属、两种药、早上那顿已吃
      const now = clock.now(), hm = devices.hhmm();
      const plus = m => devices.hhmm(now + m * minute);
      const morning = hm > '08:00' ? '08:00' : null;
      const drugs = [
        { name: '阿司匹林肠溶片', dose: '100mg', inventory: 28, times: [plus(3), '21:00'].filter((t, i, a) => a.indexOf(t) === i).sort(), note: '饭后' },
        { name: '二甲双胍缓释片', dose: '0.5g', inventory: 6, times: [morning || plus(40), plus(20)].filter(Boolean).sort(), note: '随餐' },
        { name: '苯磺酸氨氯地平', dose: '5mg', inventory: 20, times: [plus(60)] },
        { name: '布洛芬缓释胶囊', dose: '0.3g', inventory: 10, asNeeded: true, times: [], note: '头痛时' },
      ];
      for (const d of drugs) await appFetch('POST', '/api/drugs', d);
      await appFetch('PATCH', '/api/family', { user: { name: '王秀兰', phone: '13800001234' }, contacts: [{ name: '王磊', phone: '13912345678', relation: '儿子' }, { name: '李娜', phone: '13687654321', relation: '女儿' }] });
      const c = await devices.refresh(true);
      for (const d of c.doses.doses) if (d.planned < hm) await appFetch('PATCH', `/api/intake-events/${d.eventId}`, { status: 'taken', time: d.planned });
      await devices.refresh(true);
      devices.markPastDelivered((await devices.refresh(true)).doses.doses);
      // 完整展示：药盒与手表直接连好（药盒自动装药下发），三端从这里就能联动
      await devices.handle({ id: 'demo-box', action: 'device', op: 'hipeeConnect', deviceId: devices.BOX_ID }, 'user').catch(() => {});
      await devices.handle({ id: 'demo-watch', action: 'watch', op: 'pair', deviceId: devices.WATCH_ID, key: '0123456789abcdef0123456789abcdef' }, 'user').catch(() => {});
      devices.markBoxPastFired();
      devices.note('演示', '已准备示例：4 种药、服药者王秀兰、两位家属；药盒与手表已连接');
      await devices.afterClockChange();
      return { ok: true, message: '示例已准备好' };
    }
    case 'reset': {
      clock.reset();
      fs.copyFileSync(path.join(appDir, 'empty-data.json'), appData);
      const fresh = createAnyao({ dataPath: appData, demo: false, liveReload: false });
      anyaoRef.current = fresh;
      devices.raw = devices.fresh();
      devices.note('演示', '已清空：安药从零开始，设备未连接');
      broadcast('native', { event: 'data-changed' });
      broadcast('reload', {});
      await devices.afterClockChange();
      return { ok: true, message: '已清空' };
    }
    default: return { ok: false, message: '未知演示操作' };
  }
}

const server = http.createServer(async (req, res) => {
  let url; try { url = new URL(req.url, 'http://local'); } catch { return send(res, 400, { error: 'bad_request' }); }
  const route = decodeURIComponent(url.pathname);
  const needKey = route.startsWith('/api/') || route.startsWith('/native/') || route.startsWith('/demo/');
  if (needKey && !authed(req, url)) return send(res, 403, { error: 'pairing_required', detail: '配对码不正确，请重新扫描电脑上的二维码。' });

  if (route === '/api/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write(`retry: 1500\nevent: state\ndata: ${JSON.stringify(devices.view())}\n\n`);
    const role = ['phone', 'stage'].includes(url.searchParams.get('role')) ? url.searchParams.get('role') : 'viewer';
    clients.add(res); presence[role]++; broadcast('presence', presence);
    const ping = setInterval(() => res.write(': ping\n\n'), 15000);
    req.on('close', () => { clearInterval(ping); clients.delete(res); presence[role]--; broadcast('presence', presence); });
    return;
  }
  if (route.startsWith('/api/')) {
    // 浏览器直接请求 /api（例如没有虚拟安卓层时）也交给 server.js
    return anyaoRef.current(req, res);
  }
  if (route === '/native/call' && req.method === 'POST') {
    try { return send(res, 200, await devices.handle(await readBody(req), url.searchParams.get('role') === 'family' ? 'family' : 'user')); }
    catch (error) { return send(res, 400, { ok: false, error: error.message }); }
  }
  if (route === '/native/physical' && req.method === 'POST') { const b = await readBody(req).catch(() => ({})); return send(res, 200, devices.physical(b.type, b)); }
  if (route === '/native/notification' && req.method === 'POST') { const b = await readBody(req).catch(() => ({})); return send(res, 200, await devices.notificationAction(b)); }
  if (route === '/native/state') return send(res, 200, devices.view());
  if (route === '/native/info') return send(res, 200, { key, port, presence, lan: lan().map(ip => `http://${ip}:${port}/app/entry.html?k=${key}`) });
  if (route === '/demo' && req.method === 'POST') { const b = await readBody(req).catch(() => ({})); try { return send(res, 200, await demo(b)); } catch (e) { return send(res, 500, { ok: false, message: e.message }); } }

  if (route === '/' || route === '/index.html') {
    if (!url.searchParams.get('k')) { res.writeHead(302, { 'Location': `/?k=${key}`, 'Set-Cookie': `anyao_link=${key}; Path=/; SameSite=Lax` }); return res.end(); }
    return serveFile(res, path.join(stageDir, 'index.html'));
  }
  if (route === '/fake-android.js') return serveFile(res, path.join(stageDir, 'fake-android.js'));
  if (route === '/demo-overrides.js') return serveFile(res, path.join(stageDir, 'demo-overrides.js'));
  if (route === '/demo-pb1-modes.js') return serveFile(res, path.join(stageDir, 'demo-pb1-modes.js'));
  if (route === '/app' || route === '/app/') { res.writeHead(302, { Location: '/app/entry.html' + url.search }); return res.end(); }
  if (route.startsWith('/app/')) {
    const file = path.resolve(appDir, '.' + route.slice(4));
    if (!file.startsWith(appDir + path.sep) || /server\.js$|\.json$/.test(file)) { res.writeHead(403); return res.end(); }
    if (url.searchParams.get('k') === key) res.setHeader?.('Set-Cookie', `anyao_link=${key}; Path=/; SameSite=Lax`);
    return serveFile(res, file, file.endsWith('.html') ? injectApp : null);
  }
  const file = path.resolve(stageDir, '.' + route);
  if (!file.startsWith(stageDir + path.sep)) { res.writeHead(403); return res.end(); }
  serveFile(res, file);
});

server.listen(port, process.env.ANYAO_LINK_HOST || '0.0.0.0', () => {
  try { fs.writeFileSync(path.join(dataDir, 'key.txt'), key); } catch { /* 只用于再次双击时打开大屏 */ }
  console.log('\n安药 · 手机 × Watch S3 × 智能药盒  实时联动');
  console.log(`\n电脑大屏：http://127.0.0.1:${port}/?k=${key}`);
  lan().forEach(ip => console.log(`手机打开安药：http://${ip}:${port}/app/entry.html?k=${key}`));
  console.log(`USB 连接：adb reverse tcp:${port} tcp:${port} 后打开 http://127.0.0.1:${port}/app/entry.html?k=${key}`);
  console.log(`\n配对码 ${key}。保持此窗口；Ctrl+C 结束。\n`);
  if (process.env.ANYAO_NO_OPEN !== '1' && process.platform === 'win32') require('node:child_process').spawn('rundll32.exe', ['url.dll,FileProtocolHandler', `http://127.0.0.1:${port}/?k=${key}${process.env.ANYAO_AUTOPLAY === "1" ? "&autoplay=1" : ""}`], { detached: true, stdio: 'ignore', windowsHide: true }).on('error', () => {}).unref();
});
module.exports = { appFetch };
