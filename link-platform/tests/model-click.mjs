import assert from 'node:assert/strict';
import { chromium } from 'file:///C:/Users/m5601/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
const base = 'http://127.0.0.1:4200', k = 'test01';
const api = (type, payload = {}) => fetch(`${base}/api/action?k=${k}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type, ...payload }) }).then(r => r.json());
const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--enable-webgl', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await api('demo.reset'); await api('settings.set', { autoSchedule: false });
await page.goto(`${base}/index.html?k=${k}`);
await page.waitForFunction(() => window.anyaoStage?.pillbox.snapshot().ready && window.anyaoStage.watch.snapshot().ready, null, { timeout: 30000 });
await api('dose.trigger');
const n = (await api('box.lid', { open: false })).ok, s0 = await page.evaluate(() => window.anyaoStage.state()); void n;
const c = s0.active.med.compartment;
const click = async (kind, i) => { await page.waitForTimeout(1200); const p = await page.evaluate(([k, i]) => window.anyaoStage.pillbox.project(k, i), [kind, i]); await page.mouse.click(p.x, p.y); };
await click('outer'); await page.waitForFunction(() => window.anyaoStage.state().box.outer, null, { timeout: 5000 }); console.log('PASS 点三维外盖 → 开盖');
await click('inner', c); await page.waitForFunction(c => window.anyaoStage.state().box.inner[c - 1], c, { timeout: 5000 }); console.log('PASS 点三维药仓盖 → 开仓');
await click('pill', c); console.log(await page.evaluate(() => document.getElementById('box-stage').dataset.lastHit)); await page.waitForFunction(() => window.anyaoStage.state().active.status === 'taken', null, { timeout: 5000 }); console.log('PASS 点三维药片 → 取药');
await click('button'); await page.waitForFunction(() => window.anyaoStage.state().active.status === 'confirmed', null, { timeout: 5000 }); console.log('PASS 点三维确认键 → 确认服药');
await api('demo.reset'); await api('dose.trigger');
await page.waitForTimeout(500);
const box = await page.locator('#watch-stage canvas').boundingBox();
// 手表屏幕上“在手机上打开”位于表盘下部约 77% 高度处
let opened = false;
for (const dy of [0.06, 0.08, 0.1, 0.04, 0.12]) {
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2 + box.height * dy);
  await page.waitForTimeout(300);
  if ((await page.evaluate(() => window.anyaoStage.state().phone.sheet)) === 'confirm') { opened = true; break; }
}
assert.ok(opened); console.log('PASS 点三维手表屏幕“在手机上打开” → 手机确认窗');
await api('demo.reset');
await browser.close();
