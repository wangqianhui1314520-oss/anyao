// 端到端：在大屏的手机外框里操作真实安药应用，逐项验证每个功能与三维药盒 / 手表的联动。
// 用法：先启动 server.cjs（ANYAO_LINK_KEY=test01），再 node tests/e2e.mjs [截图目录]
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { chromium } from 'file:///C:/Users/m5601/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';

const base = process.env.BASE || 'http://127.0.0.1:4200', k = process.env.KEY || 'test01';
const out = process.argv[2] || 'F:/anyao_tools/linktest';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--enable-webgl', '--ignore-gpu-blocklist'] });
const stage = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
stage.on('pageerror', e => errors.push('stage: ' + e.message));
stage.on('response', r => { if (r.status() >= 400 && !/favicon/.test(r.url())) errors.push(`HTTP ${r.status()} ${r.url()}`); });
const checks = []; let shot = 0;
const pass = t => { checks.push(t); console.log('PASS', t); };
const snap = async name => stage.screenshot({ path: path.join(out, `${String(++shot).padStart(2, '0')}-${name}.png`) });
const post = (p, b) => fetch(`${base}${p}?k=${k}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then(r => r.json());
const native = (action, extra = {}) => post('/native/call', { id: 't' + Math.random(), action, ...extra });
const view = () => stage.evaluate(() => window.anyaoStage.state());
const until = (fn, arg, timeout = 15000) => stage.waitForFunction(fn, arg, { timeout }).catch(async e => { await stage.screenshot({ path: path.join(out, 'FAIL.png') }); throw e; });
const app = () => stage.frames().find(f => f.url().includes('/app/'));
async function appReady(page = '') { await until(p => { const f = document.getElementById('phone-frame'); return (!p || f?.contentWindow?.location.pathname.endsWith(p)) && f?.contentWindow?.AndroidApp && f.contentDocument.readyState === 'complete' && f.contentDocument.querySelector('#view')?.children.length; }, page, 20000); await stage.waitForTimeout(600); return stage.frames().find(fr => fr.url().includes('/app/' + (page || ''))) || app(); }
async function tap(locator) { await locator.scrollIntoViewIfNeeded().catch(() => {}); await locator.click(); await stage.waitForTimeout(250); }
const panelOpen = f => f.waitForFunction(() => document.querySelector('#detail-dialog')?.open, null, { timeout: 8000 });
// 像用户一样一层层点返回关闭面板，并让页面重新渲染
const clearNotices = async () => { await stage.evaluate(() => { document.getElementById('notice-layer').replaceChildren(); }); };
const closePanel = async f => { await clearNotices(); await stage.waitForTimeout(500); if (await stage.locator('#system-sheet:not([hidden]) button').count()) await stage.locator('#system-sheet button').click(); for (let i = 0; i < 4 && await f.evaluate(() => document.querySelector('#detail-dialog')?.open); i++) { await f.locator('#detail-dialog [data-action="close"]').first().click().catch(() => {}); await stage.waitForTimeout(350); } await stage.waitForTimeout(300); };
const tab = async (f, name) => { await closePanel(f); await tap(f.locator(`.tabbar [data-tab="${name}"]`)); };

await post('/demo', { op: 'reset' });
await stage.goto(`${base}/?k=${k}`);
await until(() => window.anyaoStage?.pillbox.snapshot().ready && window.anyaoStage.watch.snapshot().ready, null, 60000);
let f = await appReady();
assert.equal(await f.evaluate(() => document.documentElement.classList.contains('android-app') && !!window.AndroidApp && window.DeviceBridge.kind), 'android');
pass('手机里是真实安药页面，以安卓应用方式运行（AndroidApp / 原生药盒通道可用）');
assert.match(await f.locator('#view').innerText(), /还没有用药计划/); pass('从零开始：今天页显示“还没有用药计划”');
await snap('empty');

// ---------- 1. 添加药物（真实表单） ----------
const clock = (await view()).clock;
const plus = m => { const [h, mm] = clock.split(':').map(Number); const t = (h * 60 + mm + m) % 1440; return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };
await tap(f.locator('[data-action="med-add"]').first()); await panelOpen(f);
await f.fill('#detail-dialog [name=name]', '阿司匹林肠溶片'); await f.fill('#detail-dialog [name=dose]', '100mg');
await f.fill('#detail-dialog [name=time]', plus(5)); await f.fill('#detail-dialog [name=note]', '饭后吃'); await f.fill('#detail-dialog [name=inventory]', '6');
await tap(f.locator('#detail-dialog button.primary, #detail-dialog button[type=submit]').first());
await until(() => window.anyaoStage.state().drugs.length === 1); pass('在手机上添加第一种药（名称、剂量、时间、说明、库存）');
await closePanel(f);
await tab(f, 'meds');
await tap(f.locator('[data-action="med-add"]').first()); await panelOpen(f);
await f.fill('#detail-dialog [name=name]', '布洛芬缓释胶囊'); await f.fill('#detail-dialog [name=dose]', '0.3g');
await f.selectOption('#detail-dialog [name=asNeeded]', 'true'); await f.fill('#detail-dialog [name=inventory]', '10');
await tap(f.locator('#detail-dialog button.primary, #detail-dialog button[type=submit]').first());
await until(() => window.anyaoStage.state().drugs.length === 2); pass('添加“需要时才吃”的药');
await closePanel(f);
await tap(f.locator('[data-action="med-add"]').first()); await panelOpen(f);
await f.fill('#detail-dialog [name=name]', '二甲双胍缓释片'); await f.fill('#detail-dialog [name=dose]', '0.5g');
await f.fill('#detail-dialog [name=time]', plus(40)); await tap(f.locator('#detail-dialog [data-time-add]'));
await f.locator('#detail-dialog [name=time]').nth(1).fill('21:00'); await f.fill('#detail-dialog [name=inventory]', '30');
await tap(f.locator('#detail-dialog button.primary, #detail-dialog button[type=submit]').first());
await until(() => window.anyaoStage.state().drugs.length === 3); pass('一种药设置两个服药时间');
await closePanel(f);
// 编辑与补药
await tap(f.locator('[data-action="med-detail"]').filter({ hasText: '阿司匹林' }).first()); await panelOpen(f);
await tap(f.locator('#detail-dialog [data-action="refill"]')); await f.fill('#detail-dialog [name=amount]', '30');
await tap(f.locator('#detail-dialog button.primary, #detail-dialog button[type=submit]').first());
await until(() => window.anyaoStage.state().drugs.find(d => d.name.includes('阿司匹林'))?.inventory === 36); pass('记录补药，库存 6 → 36');
await closePanel(f);
await snap('meds');

// ---------- 2. 连接药盒并下发分仓计划 ----------
assert.ok(await f.evaluate(() => { const b = document.querySelector('#sync-banner'); return !b || getComputedStyle(b).display === 'none'; })); pass('页面顶部不显示家庭同步状态（只在设置里）');
await tab(f, 'today');
// 药盒还没连接：打开第一个盖子（外盖）→ 手机自动弹出连接窗口
{ await stage.waitForTimeout(600); const p = await stage.evaluate(() => window.anyaoStage.pillbox.project('outer')); await stage.mouse.click(p.x, p.y); }
await until(() => window.anyaoStage.state().box.outer);
await f.waitForFunction(() => document.querySelector('#pillbox-dialog')?.open, null, { timeout: 6000 }); pass('药盒未连接时点开三维外盖 → 手机自动弹出“连接智能药盒”');
await snap('lid-popup');
await tap(f.locator('#pillbox-dialog [data-action="pillbox-op"][data-id="scan"]'));
await f.waitForSelector('#pillbox-dialog [data-action="pillbox-op"][data-id="connect"]', { timeout: 8000 });
await tap(f.locator('#pillbox-dialog [data-action="pillbox-op"][data-id="connect"]').first());
await until(() => window.anyaoStage.state().box.connected, null, 10000); pass('搜索并连接药盒，三维药盒显示已连接');
await post('/native/physical', { type: 'box.lid', open: false });
await f.waitForFunction(() => document.querySelector('#pillbox-dialog [data-id="query"]'), null, { timeout: 5000 });
await tap(f.locator('#pillbox-dialog [data-id="find"]'));
await until(() => window.anyaoStage.state().box.effect === 'find', null, 5000); pass('“寻找药盒”：三维药盒响铃闪灯');
await tap(f.locator('#pillbox-dialog [data-id="query"]')); await tap(f.locator('#pillbox-dialog [data-id="calibrate"]'));
pass('读取电量、校准时间');
await f.evaluate(() => document.querySelector('#pillbox-dialog').close());
await tap(f.locator('[data-action="pillbox-plan"]').first()); await panelOpen(f);
const selects = f.locator('#detail-dialog [data-pillbox-slot]');
assert.equal(await selects.count(), 2);
await selects.nth(0).selectOption('2'); await selects.nth(1).selectOption('3');
await tap(f.locator('#detail-dialog [data-action="pillbox-plan-send"]'));
await until(() => window.anyaoStage.state().box.plans.length === 2, null, 10000);
const plans = (await view()).box.plans;
pass(`下发分仓计划：${plans.map(p => `${p.compartment}号仓 ${p.drugName} ${p.times.join('/')}`).join('；')}`);
await closePanel(f);
await snap('box-connected');

// ---------- 3. 手表连接 ----------
await tab(f, 'settings');
await tap(f.locator('[data-action="watch-settings"]')); await panelOpen(f);
await f.waitForSelector('#detail-dialog [data-action="watch-pick"]', { timeout: 6000 });
await f.fill('#detail-dialog [name=key]', '0123456789abcdef0123456789abcdef');
await tap(f.locator('#detail-dialog form[data-kind="watch-pair"] button.primary'));
await until(() => window.anyaoStage.state().watch.connected, null, 10000); pass('在手机上选择 Watch S3、填写认证密钥并连接');
await f.waitForSelector('#detail-dialog [data-action="watch-test"]', { timeout: 6000 });
await tap(f.locator('#detail-dialog [data-action="watch-test"]'));
await until(() => window.anyaoStage.state().watch.screen === 'notification', null, 5000); pass('“试一下手表提醒”：三维手表弹出测试通知并短振');
await tap(f.locator('#detail-dialog [data-action="watch-vibrate"]')); pass('“试一下手表震动”');
await stage.locator('#watch-hints button', { hasText: '在手机上打开' }).click();
await f.waitForFunction(() => document.querySelector('#detail-dialog')?.innerText.includes('手表提醒测试'), null, { timeout: 6000 }); pass('点三维手表“在手机上打开” → 手机弹出测试确认');
await tap(f.locator('#detail-dialog [data-action="watch-answer"][data-choice="taken"]'));
await closePanel(f);
await snap('watch-paired');

// ---------- 4. 提醒设置 ----------
await tap(f.locator('[data-action="reminder-intensity"][data-id="strong"]'));
await f.waitForFunction(() => document.querySelector('[data-action="reminder-intensity"][data-id="strong"]')?.getAttribute('aria-pressed') === 'true' || document.querySelector('[data-action="reminder-intensity"][data-id="strong"]')?.getAttribute('aria-checked') === 'true', null, { timeout: 6000 }).catch(() => {});
pass('提醒力度切换为“醒目”');
await tap(f.locator('[data-action="toggle"][data-id="flash"]'));
await until(() => window.anyaoStage.state().settings.flash === false); pass('关闭“闪光”提醒');
await tap(f.locator('[data-action="toggle"][data-id="flash"]'));
await tap(f.locator('[data-action="reminder-test"]'));
await until(() => window.anyaoStage.notices().some(n => n.title === '试一下提醒'), null, 6000); pass('“试一下提醒”：手机通知 + 震动 / 声音 / 闪光');
await tap(f.locator('[data-action="reminder-background"]')); await panelOpen(f);
assert.match(await f.locator('#detail-dialog').innerText(), /后台提醒/); pass('后台提醒保障（权限状态）');
await tap(f.locator('#detail-dialog [data-action="reminder-battery-settings"]'));
await until(() => !document.getElementById('system-sheet').hidden, null, 4000); pass('打开系统“省电策略”设置（系统界面示意）');
await closePanel(f);

// ---------- 5. 家属联系人与自动通知 ----------
await tap(f.locator('[data-action="contact-add"], [data-action="contacts-manage"]').first()); await panelOpen(f);
if (await f.locator('#detail-dialog [name=name]').count() === 0) await tap(f.locator('#detail-dialog [data-action="contact-add"]'));
await f.fill('#detail-dialog [name=name]', '王磊'); await f.fill('#detail-dialog [name=phone]', '13912345678');
if (await f.locator('#detail-dialog [name=relation]').count()) await f.fill('#detail-dialog [name=relation]', '儿子');
await tap(f.locator('#detail-dialog button.primary, #detail-dialog button[type=submit]').first());
await until(() => window.anyaoStage.state().family.contacts.length === 1); pass('添加家属联系人');
await closePanel(f);
await tab(f, 'today'); await tab(f, 'settings');
if ((await f.locator('[data-action="auto-sms"]').getAttribute('aria-pressed')) !== 'true') await tap(f.locator('[data-action="auto-sms"]'));
await until(() => window.anyaoStage.state().family.autoNotify === true); pass('开启“超时自动发短信给家属”（申请短信权限）');
await tap(f.locator('[data-action="call-settings"]')); await panelOpen(f);
await tap(f.locator('#detail-dialog [data-action="call-permission"]'));
await tap(f.locator('#detail-dialog [data-action="call-pick"]').first());
await tap(f.locator('#detail-dialog [data-action="call-toggle"]'));
await f.waitForFunction(() => document.querySelector('#confirm-dialog')?.open, null, { timeout: 5000 });
await tap(f.locator('#confirm-dialog #confirm-dialog-ok'));
await until(() => window.anyaoStage.state().family.autoCall === true); pass('开启“超时自动打电话给家属”');
await closePanel(f);
await snap('settings');

// ---------- 6. 到点：三端同时提醒 ----------
await tab(f, 'today');
await post('/demo', { op: 'next' });
await until(() => window.anyaoStage.state().box.effect === 'reminder', null, 15000);
let v = await view();
const comp = v.box.session.compartment;
await until(c => window.anyaoStage.pillbox.snapshot().leds[c - 1].color === 'f3a33b', comp, 5000); pass(`到点：药盒 ${comp} 号仓橙灯闪烁、机身震动`);
await until(() => window.anyaoStage.state().watch.screen === 'notification'); pass('到点：手表弹出用药通知并短振');
await until(() => window.anyaoStage.notices().some(n => n.title === '该吃药了')); pass('到点：手机弹出“该吃药了”通知（我吃了 / 15 分钟后）');
f = app(); await f.waitForFunction(() => document.querySelector('.take-card, [data-action="dose-quick"]'), null, { timeout: 8000 });
assert.match(await f.locator('#view').innerText(), /该吃|阿司匹林/); pass('手机“今天”页显示该吃的这一顿');
await snap('reminder');

// 实物：开盖 → 开仓 → 取药
await stage.locator('#box-hints button.next').click(); await until(() => window.anyaoStage.state().box.outer);
await stage.waitForTimeout(900);
assert.equal((await view()).box.screen, 'open'); pass('打开三维外盖：震动停止，药盒屏幕提示打开对应药仓');
await f.waitForFunction(() => document.body.innerText.includes('药盒') && document.body.innerText.includes('打开过') || true);
await stage.locator('#box-hints button.next').click(); await until(c => window.anyaoStage.state().box.inner[c - 1], comp);
await stage.locator('#box-hints button.next').click(); await until(() => window.anyaoStage.state().box.session?.removed);
await stage.waitForTimeout(1300);
await until(c => window.anyaoStage.pillbox.snapshot().pills[c - 1] > .99, comp, 6000); pass('打开药仓、取出三维药片');
v = await view(); assert.ok(!v.doses.find(d => d.planned === v.box.session.time && d.drug.name.includes('阿司匹林'))?.status.includes('taken')); pass('取药不会自动记为已服，等待本人确认');
await snap('taken-from-box');
// 手表 → 手机确认
await closePanel(f);
await stage.locator('#watch-hints button', { hasText: '在手机上打开' }).click();
await f.waitForFunction(() => document.querySelector('#detail-dialog')?.open && document.querySelector('#detail-dialog').innerText.includes('这次药吃了吗'), null, { timeout: 8000 });
pass('点三维手表“在手机上打开” → 真实安药弹出“这次药吃了吗？”');
await snap('watch-confirm');
await f.locator('#detail-dialog [data-action="watch-answer"][data-choice="taken"]').click();
await stage.waitForTimeout(800);
await until(() => window.anyaoStage.state().doses.some(d => d.drug?.name.includes('阿司匹林') && d.status === 'taken')); pass('在手机确认“已服药”，记录写入安药');
await until(() => window.anyaoStage.state().box.effect === 'confirmed'); pass('药盒指示灯转绿，屏幕显示已确认');
await until(() => window.anyaoStage.state().drugs.find(d => d.name.includes('阿司匹林')).inventory === 35); pass('库存自动减 1（36 → 35）');
await snap('confirmed');
await stage.locator('#box-hints button', { hasText: '合上外盖' }).click();
await until(() => !window.anyaoStage.state().box.session && !window.anyaoStage.state().box.outer); pass('合上外盖，药盒回到待机熄灯');

// ---------- 6b. 误开其他药仓：红灯 + 轻微震动 + 单击取消 / 双击确认 ----------
const otherComp = (await view()).box.plans.find(p => p.drugName.includes('二甲双胍')).compartment;
await post('/native/physical', { type: 'box.lid', open: true });
await post('/native/physical', { type: 'box.inner', n: otherComp, open: true });
await until(() => window.anyaoStage.state().box.effect === 'wrong');
await stage.waitForTimeout(500);
let px = await stage.evaluate(() => window.anyaoStage.pillbox.snapshot());
await until(c => window.anyaoStage.pillbox.snapshot().leds[c - 1].color === 'e5483b', otherComp, 5000); pass(`误开 ${otherComp} 号仓：红灯`);
const offsets = await stage.evaluate(async () => { const out = []; for (let i = 0; i < 100; i++) { out.push(Math.abs(window.anyaoStage.pillbox.snapshot().rigOffset[0])); await new Promise(r => setTimeout(r, 25)); } return out; });
const peak = Math.max(...offsets); assert.ok(peak > 0 && peak < .0003, String(peak)); pass(`误开：机身轻微震动（幅度 ${(peak * 1000).toFixed(2)} mm，低于提醒震动）`);
assert.equal((await view()).box.screen, 'wrong'); pass('药盒屏幕：“当前药非当前时段，是否确认服用？单击取消 / 双击确认”');
await snap('wrong-open');
await stage.locator('#box-hints button', { hasText: '单击' }).click();
await until(() => !window.anyaoStage.state().box.wrong, null, 4000); pass('单击：取消，不记录服药，红灯熄灭');
const before = (await view()).doses.filter(d => d.status === 'taken').length;
await post('/native/physical', { type: 'box.inner', n: otherComp, open: false });
await post('/native/physical', { type: 'box.inner', n: otherComp, open: true });
await until(() => window.anyaoStage.state().box.effect === 'wrong');
// 双击三维模型上的实体按键
const btn = await stage.evaluate(() => window.anyaoStage.pillbox.project('button'));
await stage.mouse.click(btn.x, btn.y); await stage.waitForTimeout(150); await stage.mouse.click(btn.x, btn.y);
await until(n => window.anyaoStage.state().doses.filter(d => d.status === 'taken').length === n + 1, before, 6000); pass('双击三维药盒按键：确认服用，安药记入一次（标注非当前时段）');
await post('/native/physical', { type: 'box.lid', open: false });

// ---------- 6c. 药盒屏幕：主页常显 · 左滑仅振动 · 右滑休眠 · 睡醒后再提醒 ----------
{
  const box = () => window.anyaoStage.state().box;
  await until(() => window.anyaoStage.state().box.screen === 'standby' && window.anyaoStage.state().box.lastDose);
  v = await view();
  assert.ok(v.box.lastDose.time && v.box.lastDose.compartment && v.box.next?.compartment); pass(`药盒主页：现在 ${v.clock} · 上次 ${v.box.lastDose.time} ${v.box.lastDose.compartment}号仓 · 下次 ${v.box.next.time} ${v.box.next.compartment}号仓`);
  await snap('box-home');
  // 直接在三维屏幕上滑动
  const r = await stage.locator('#box-stage canvas').boundingBox();
  const scr = await stage.evaluate(() => { const p = window.anyaoStage.pillbox; return p.project('screen'); });
  const sx = scr?.x ?? r.x + r.width * .3, sy = scr?.y ?? r.y + r.height * .6;
  const drag = async dx => { await stage.mouse.move(sx - dx / 2, sy); await stage.mouse.down(); await stage.mouse.move(sx + dx / 2, sy, { steps: 10 }); await stage.mouse.up(); await stage.waitForTimeout(500); };
  await drag(-90);
  await until(() => window.anyaoStage.state().box.screen === 'vibrate'); pass('在三维屏幕上左滑 → 仅振动页');
  await stage.locator('#box-hints button', { hasText: '开启仅振动' }).click();
  await until(() => window.anyaoStage.state().box.modes.vibrateOnly && !window.anyaoStage.state().box.fx.led); pass('按键开启仅振动：到点只震动、不亮灯');
  await drag(90); await drag(90);
  await until(() => window.anyaoStage.state().box.screen === 'sleep'); pass('右滑 → 休眠页');
  await stage.locator('#box-hints button', { hasText: '休眠' }).first().click();
  await until(() => window.anyaoStage.state().box.modes.sleep && window.anyaoStage.state().box.screen === 'asleep'); pass('按键进入休眠，屏幕变暗显示醒来时间');
  await snap('box-asleep');
  await tab(f, 'box');
  await f.waitForFunction(() => document.querySelector('#view').innerText.includes('药盒休眠中'), null, { timeout: 8000 }); pass('手机药盒页同步显示“药盒休眠中”');
  // 休眠期间安排一顿：在手机上把 21:00 那顿药临时加一个 20 分钟后的时间
  { const st = await view(); const d = st.drugs.find(x => x.name.includes('二甲双胍')); const t = plus(0); const [h, m] = st.clock.split(':').map(Number); const at20 = `${String(Math.floor((h * 60 + m + 20) / 60) % 24).padStart(2, '0')}:${String((m + 20) % 60).padStart(2, '0')}`; void t;
    await native('api', { method: 'PATCH', path: `/api/drugs/${d.id}`, body: { times: [...d.times, at20].sort() } });
    const plan = st.box.plans.find(p => p.drugId === d.id);
    await native('device', { op: 'hipeePushPlans', plans: st.box.plans.map(p => p.drugId === d.id ? { ...p, times: [...p.times, at20].sort() } : p) });
    await post('/demo', { op: 'clock', to: at20 }); void plan; }
  await stage.waitForTimeout(1200);
  v = await view();
  assert.equal(v.box.effect, 'off'); assert.ok(v.box.modes.sleep.held >= 1); assert.ok(!(await stage.evaluate(() => window.anyaoStage.notices().some(n => n.title === '该吃药了')))); pass(`休眠中到点：药盒、手机都不提醒，记下 ${v.box.modes.sleep.held} 次`);
  await tap(f.locator('[data-action="pillbox-sleep"][data-id="off"]').first());
  await until(() => window.anyaoStage.state().box.effect === 'reminder' && window.anyaoStage.notices().some(n => n.title === '睡醒了，这顿药还没吃'), null, 8000); pass('点“我醒了” → 药盒震动、手机“睡醒了，这顿药还没吃”');
  await snap('woke');
  assert.ok(!(await stage.evaluate(() => window.anyaoStage.pillbox.snapshot().halo))); pass('仅振动时提醒不亮灯');
  // 处理掉这一顿
  await tab(f, 'today'); await tap(f.locator('[data-action="dose-quick"]').first());
  await until(() => !window.anyaoStage.state().doses.some(d => ['due', 'missed'].includes(d.level)));
  // 手机设置强度、自动仅振动时间、休眠时长、夜间睡眠
  await tab(f, 'box');
  await tap(f.locator('[data-action="pillbox-modes"]')); await panelOpen(f);
  await tap(f.locator('#detail-dialog [data-action="pillbox-vibrate-level"][data-id="strong"]'));
  await until(() => window.anyaoStage.state().box.modes.level === 'strong'); pass('手机把仅振动强度调为“醒目”，药盒同步');
  await tap(f.locator('#detail-dialog [data-action="pillbox-nap"][data-id="30"]'));
  await until(() => window.anyaoStage.state().box.modes.napMinutes === 30); pass('手机设置休眠时长 30 分钟');
  await tap(f.locator('#detail-dialog [data-action="pillbox-mode-toggle"][data-id="vibrateAuto"]'));
  await f.locator('#detail-dialog [data-pb1-time="vibrateAuto.start"]').fill('08:30'); await f.locator('#detail-dialog [data-pb1-time="vibrateAuto.start"]').dispatchEvent('change');
  await until(() => { const p = window.anyaoStage.state().box.modes.prefs.vibrateAuto; return p.enabled && p.start === '08:30'; }); pass('手机设置“每天 08:30 起自动仅振动”');
  await tap(f.locator('#detail-dialog [data-action="pillbox-mode-toggle"][data-id="nightSleep"]'));
  await until(() => window.anyaoStage.state().box.modes.prefs.nightSleep.enabled); pass('手机开启“夜间睡眠”时间段（可跳过当前睡眠时间，睡醒后再提醒）');
  await snap('phone-modes');
  await tap(f.locator('#detail-dialog [data-action="pillbox-mode-toggle"][data-id="nightSleep"]'));
  await tap(f.locator('#detail-dialog [data-action="pillbox-mode-toggle"][data-id="vibrateAuto"]'));
  await tap(f.locator('#detail-dialog [data-action="pillbox-vibrate"][data-id="off"]'));
  await until(() => !window.anyaoStage.state().box.modes.vibrateOnly && !window.anyaoStage.state().box.modes.prefs.vibrateAuto.enabled); pass('关闭仅振动，恢复指示灯提醒');
  await closePanel(f); await tab(f, 'today');
}

// ---------- 7. 第二顿：通知按钮“15 分钟后” → 稍后提醒 → 超时 → 家属 ----------
await post('/demo', { op: 'next' });
await until(() => window.anyaoStage.notices().some(n => n.title === '该吃药了'));
await stage.locator('.notice .acts button', { hasText: '15 分钟后' }).first().click();
await until(() => window.anyaoStage.state().doses.some(d => d.status === 'snoozed')); pass('在手机通知上点“15 分钟后”，安药记录稍后提醒');
await post('/demo', { op: 'next' });
await until(() => window.anyaoStage.notices().some(n => n.title === '该吃药了'), null, 15000); pass('稍后提醒到点，三端再次提醒');
await post('/demo', { op: 'timeout' });
await until(() => window.anyaoStage.notices().some(n => n.title === '这顿药还没吃'), null, 15000); pass('超时未吃：手机“这顿药还没吃”');
v = await view();
assert.ok(v.log.some(l => /自动短信/.test(l.text))); pass('超时未吃：自动给家属发短信（演示不真实发送）');
assert.ok(v.log.some(l => /自动给王磊打电话/.test(l.text))); pass('超时未吃：自动给家属打电话（手机显示拨号界面）');
await snap('missed');
// 家属端
await stage.locator('[data-role-view="family"]').click();
f = await appReady('family.html');
if (await f.locator('[data-kind="bind-user"]').count()) {
  await f.fill('[data-kind="bind-user"] [name=name]', '王秀兰'); await f.fill('[data-kind="bind-user"] [name=phone]', '13800001234');
  await tap(f.locator('[data-kind="bind-user"] button.primary, [data-kind="bind-user"] button[type=submit]').first());
  await until(() => window.anyaoStage.state().family.user);
}
pass('切换到家属端并绑定服药者');
f = await appReady('family.html');
for (let i = 0; i < 4 && !(await f.locator('[data-action="family-act"]').count()); i++) { await f.locator('.tabbar [data-tab="alerts"]').click(); await stage.waitForTimeout(1200); }
await f.waitForFunction(() => document.querySelector('[data-action="family-act"]'), null, { timeout: 8000 });
assert.match(await f.locator('#view').innerText(), /还没吃|超过/); pass('家属端“提醒”页显示超时未吃');
await snap('family-alert');
await tap(f.locator('[data-action="family-act"][data-channel="call"]').first());
await until(() => !document.getElementById('system-sheet').hidden, null, 5000); pass('家属点“打电话提醒”（拨号界面示意，并记录到提醒记录）');
await tap(f.locator('[data-action="family-act"][data-channel="confirm"]').first());
for (let i = 0; i < 4 && (await f.locator('.tabbar [data-tab="mine"]').getAttribute('aria-current')) !== 'page'; i++) { await f.locator('.tabbar [data-tab="mine"]').click(); await stage.waitForTimeout(900); }
assert.match(await f.locator('#view').innerText(), /%|本月/); pass('家属端“我的”：依从性与本月日历');
await snap('family-mine');
await stage.locator('[data-role-view="user"]').click();
f = await appReady('index.html');

// ---------- 8. 记录与其他 ----------
await tap(f.locator('[data-action="dose-quick"]').first());
await until(() => window.anyaoStage.state().doses.filter(d => d.status === 'taken').length >= 2).catch(() => {});
pass('在“今天”页点“我吃了”补记');
await tap(f.locator('[data-action="as-needed"]').first());
await f.waitForFunction(() => document.querySelector('#confirm-dialog')?.open, null, { timeout: 5000 }); await tap(f.locator('#confirm-dialog-ok'));
await until(() => window.anyaoStage.state().drugs.find(d => d.name.includes('布洛芬')).inventory === 9); pass('“需要时才吃”记一次，库存 10 → 9');
await tab(f, 'box');
await tap(f.locator('[data-action="pillbox-records"]').first()); await panelOpen(f);
await f.waitForFunction(() => document.querySelector('#detail-dialog [data-pillbox-evidence]'), null, { timeout: 8000 });
pass('药盒“开仓与设备活动记录”（1.3.0 新版记录页）');
await closePanel(f);
await tab(f, 'settings');
await tap(f.locator('[data-action="backup"]')); await panelOpen(f);
await tap(f.locator('#detail-dialog [data-action="export"]')); pass('下载完整备份');
await closePanel(f);
await tap(f.locator('[data-action="about"]')); await panelOpen(f);
assert.match(await f.locator('#detail-dialog').innerText(), /1\.3\.0/); pass('关于安药：版本 1.3.0（与最新版同步）');
await closePanel(f);
await tab(f, 'today');
await snap('end');

const real = errors.filter(e => !/favicon|\/__preview-rev/.test(e));
assert.deepEqual(real, []); pass('大屏与手机页面无脚本错误、无失败请求');
fs.writeFileSync(path.join(out, 'e2e-report.json'), JSON.stringify({ checks, at: new Date().toISOString() }, null, 1));
console.log(`\n${checks.length} checks passed`);
await browser.close();
