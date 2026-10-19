// 一键演示：按顺序自动操作手机、三维药盒、三维手表，把全部功能完整走一遍。
// 每一步都是真实操作（和手点完全相同的接口），屏幕上方字幕说明正在做什么；可暂停 / 停止。
export function createAutoplay({ post, fire, state, notices, phoneFrame, loadPhone, pillbox, onCaption }) {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let running = false, paused = false, stopped = false, stepIndex = 0;
  const wait = async ms => { const end = Date.now() + ms; while (Date.now() < end) { if (stopped) throw Error('stopped'); while (paused && !stopped) await sleep(150); await sleep(Math.min(150, end - Date.now())); } };
  const until = async (fn, ms = 12000) => { const end = Date.now() + ms; while (Date.now() < end) { if (stopped) throw Error('stopped'); try { if (await fn()) return true; } catch { /* 下一轮再看 */ } await sleep(200); } return false; };
  const app = () => phoneFrame().contentWindow;
  const doc = () => phoneFrame().contentDocument;
  const appReady = () => until(() => app()?.AndroidApp && doc()?.querySelector('#view')?.children.length, 20000);
  const tap = async (selector, root = () => doc()) => { const el = await (async () => { let e = null; await until(() => (e = root()?.querySelector(selector)), 6000); return e; })(); if (!el) return false; el.scrollIntoView?.({ block: 'center', behavior: 'smooth' }); await wait(450); el.click(); await wait(500); return true; };
  const tab = async name => { await tap(`.tabbar [data-tab="${name}"]`); await wait(700); };
  const closePanels = async () => { for (const id of ['#pillbox-dialog', '#detail-dialog', '#confirm-dialog']) { const d = doc()?.querySelector(id); if (d?.open) d.close(); } await wait(300); };
  const say = (title, text) => onCaption({ title, text, step: stepIndex, total: STEPS.length });
  const box = () => state().box, watch = () => state().watch;

  // 每一步：[标题, 说明, 动作]
  const STEPS = [
    ['准备', '清空数据，从零开始；登记 4 种药、服药者与两位家属', async () => {
      await post('/demo', { op: 'reset' }); await wait(1500);
      await post('/demo', { op: 'sample' }); loadPhone('user'); await appReady(); await wait(1800);
    }],
    ['手机 · 今天', '真实安药 1.3.0：下一次吃药、上次 / 下次时间、今天的每一顿', async () => { await tab('today'); await wait(2600); }],
    ['药盒已连接', '药盒、手表已经连上；药盒自动装药：每种药一个仓位，提醒时间已下发', async () => { await tab('box'); await wait(3200); }],
    ['提醒设备', '设置里：手机提醒、药盒提醒、手表提醒三路都已开启', async () => { await tab('settings'); await until(() => doc().querySelector('[data-reminder-targets]')); doc().querySelector('[data-reminder-targets]')?.scrollIntoView({ block: 'start', behavior: 'smooth' }); await wait(3000); }],
    ['到点提醒 · 三端同时', '到吃药时间：手机通知响铃震动，药盒对应药仓亮灯、震动、响铃，手表弹通知并振动、嘀嘀响', async () => {
      await tab('today'); await post('/demo', { op: 'next' });
      await until(() => box().effect === 'reminder' && watch().screen === 'notification'); await wait(4500);
    }],
    ['打开药盒', '打开外盖：药盒停止响铃，屏幕提示打开对应药仓', async () => { await fire('box.lid', { open: true }); await wait(2600); }],
    ['取药', '打开该仓、取出药片 —— 取药不会自动记为已服，等待本人确认', async () => {
      const n = box().session?.compartment || 1; await fire('box.inner', { n, open: true }); await wait(1600); await fire('box.take', { n }); await wait(2400);
    }],
    ['手表确认', '在手表通知上点“在手机上打开”，手机弹出“这次药吃了吗？”', async () => {
      await fire('watch.openPhone'); await until(() => doc().querySelector('#detail-dialog')?.open, 6000); await wait(2200);
    }],
    ['已服药', '手机点“我吃了”：记录服药时间、库存减 1；药盒转绿灯，手表显示已确认', async () => {
      const ok = await tap('#detail-dialog [data-action="watch-answer"][data-choice="taken"]');
      if (!ok) { const n = notices().find(x => x.kind === 'dose'); if (n) await post('/native/notification', { id: n.id, op: 'taken' }); }
      await until(() => box().session?.confirmed || box().effect !== 'reminder', 6000); await wait(3000);
    }],
    ['合上药盒', '合上药仓和外盖，药盒熄灯回到主页：现在时间、上次 / 下次服用时间与药仓', async () => {
      const n = box().session?.compartment || 1; await fire('box.inner', { n, open: false }); await wait(600); await fire('box.lid', { open: false }); await closePanels();
      pillbox.focusScreen?.(); await wait(3500);
    }],
    ['误开药仓', '打开不是这个时段的药仓：红灯、轻微震动，屏幕“当前药非当前时段，是否确认服用？”', async () => {
      await fire('box.lid', { open: true }); await wait(1200);
      const plans = box().plans, next = box().next?.compartment; const other = plans.map(p => p.compartment).find(c => c !== next) || 1;
      await fire('box.inner', { n: other, open: true }); await wait(3500);
    }],
    ['单击取消', '单击按键：取消，不记录服药，红灯熄灭', async () => {
      await wait(1200); await fire('box.button'); await until(() => !box().wrong, 3000); await wait(2600);
      const open = box().inner.findIndex(Boolean) + 1; if (open) await fire('box.inner', { n: open, open: false }); await wait(800);
    }],
    ['双击确认', '再误开一次，双击按键：确认服用，记到这种药最近一顿并标注“非当前时段”', async () => {
      // 选一顿今天已经吃过的药所在的仓（不会影响后面的提醒）
      const doses = state().doses, plans = box().plans;
      const done = plans.find(p => doses.some(d => d.drugId === p.drugId && d.status === 'taken')) || plans.find(p => p.compartment !== box().next?.compartment) || plans[0];
      const other = done.compartment;
      await fire('box.inner', { n: other, open: true }); await wait(2200);
      await fire('box.button', { double: true }); await wait(3200);
      await fire('box.inner', { n: other, open: false }); await wait(500); await fire('box.lid', { open: false }); await wait(1200);
    }],
    ['屏幕左滑 · 仅振动', '药盒屏幕左滑到“仅振动”，按键开启：到点只震动，不亮灯，手机不响铃', async () => {
      pillbox.focusScreen?.(); await fire('box.swipe', { dir: 'left' }); await wait(2200); await fire('box.button'); await wait(2400);
    }],
    ['仅振动的提醒', '到下一次吃药：药盒只震动，手表仍振动提醒', async () => {
      await post('/demo', { op: 'next' }); await until(() => box().session?.ringing); await wait(4000);
      const n = notices().find(x => x.kind === 'dose'); if (n) await post('/native/notification', { id: n.id, op: 'taken' }); await wait(1500);
      await fire('box.swipe', { dir: 'left' }); await wait(800); if (box().page === 'vibrate' && box().modes?.vibrateOnly) await fire('box.button'); await wait(1200);
    }],
    ['手机调节仅振动', '手机：药盒 → 仅振动与休眠，振动强度调为“醒目”，设置每天自动进入仅振动的时间', async () => {
      await tab('box'); await tap('[data-action="pillbox-modes"]'); await wait(1600);
      await tap('#detail-dialog [data-action="pillbox-vibrate-level"][data-id="strong"]'); await wait(1400);
      await tap('#detail-dialog [data-action="pillbox-mode-toggle"][data-id="vibrateAuto"]'); await wait(2200);
      await tap('#detail-dialog [data-action="pillbox-mode-toggle"][data-id="vibrateAuto"]'); await wait(600);
    }],
    ['手机设置休眠', '设置小睡时长、夜间睡眠时间段：休眠期间到点不提醒，醒来后再提醒', async () => {
      await tap('#detail-dialog [data-action="pillbox-nap"][data-id="60"]'); await wait(1200);
      await tap('#detail-dialog [data-action="pillbox-mode-toggle"][data-id="nightSleep"]'); await wait(2400);
      await tap('#detail-dialog [data-action="pillbox-mode-toggle"][data-id="nightSleep"]'); await wait(500); await closePanels(); await tab('today');
    }],
    ['屏幕右滑 · 休眠', '药盒屏幕右滑到“休眠”，按键进入休眠：屏幕变暗，显示醒来时间', async () => {
      // 小睡时长按下一顿来定，保证睡着时会到点
      const nx = box().next?.time; if (nx) { const [h, m] = nx.split(':').map(Number), [ch, cm] = state().clock.split(':').map(Number); const gap = (h * 60 + m) - (ch * 60 + cm); const nap = [30, 60, 90, 120].find(x => x > gap + 5) || 120; await post('/native/call', { id: 'auto-nap', action: 'device', op: 'pb1Prefs', prefs: { napMinutes: nap } }); }
      pillbox.focusScreen?.(); await fire('box.swipe', { dir: 'right' }); await wait(2000); await fire('box.button'); await wait(3000);
    }],
    ['睡着时到点', '休眠中到吃药时间：药盒、手表都不提醒，只记下这一顿', async () => {
      const nx = box().next?.time; if (nx) await post('/demo', { op: 'clock', to: nx }); await wait(3800);
    }],
    ['睡醒后再提醒', '醒来（这里在手机点“我醒了”）：药盒响铃震动，手表振动，手机“睡醒了，这顿药还没吃”', async () => {
      await tab('box'); await wait(800);
      if (!await tap('[data-action="pillbox-sleep"][data-id="off"]')) await post('/native/call', { id: 'auto-wake', action: 'device', op: 'pb1Sleep', on: false });
      await until(() => box().session?.ringing, 6000); await wait(4500);
    }],
    ['稍后提醒', '在手机通知上点“15 分钟后”：三端熄灭，到时间再一起提醒', async () => {
      await tab('today'); const n = notices().find(x => x.kind === 'dose'); if (n) await post('/native/notification', { id: n.id, op: 'snooze15' }); await wait(2500);
      await post('/demo', { op: 'clock', addMinutes: 15 }); await until(() => box().session?.ringing, 8000); await wait(3500);
    }],
    ['超时没吃', '超过 30 分钟没记录：手机“这顿药还没吃”，三端再次提醒；家属端收到提醒', async () => {
      await post('/demo', { op: 'timeout' }); await wait(4200);
    }],
    ['家属端', '切到家属端：看到超时未吃，可以打电话、发微信、发短信', async () => {
      loadPhone('family'); await appReady(); await wait(1800); await tab('alerts'); await wait(3200);
    }],
    ['家属：依从性', '家属端“我的”：近 7 天 / 30 天服药率与本月日历', async () => { await tab('mine'); await wait(3200); }],
    ['补记服药', '回到服药端，点“我吃了”补记：三端提醒全部结束', async () => {
      loadPhone('user'); await appReady(); await wait(1200);
      const n = notices().find(x => x.kind === 'dose'); if (n) await post('/native/notification', { id: n.id, op: 'taken' });
      else await tap('[data-action="dose-quick"]');
      await wait(3000);
    }],
    ['演示结束', '全部功能已演示完成。你可以继续在手机、药盒、手表上自由操作', async () => { await wait(2500); }],
  ];

  async function play() {
    if (running) return; running = true; stopped = false; paused = false;
    try {
      for (stepIndex = 0; stepIndex < STEPS.length; stepIndex++) {
        const [title, text, run] = STEPS[stepIndex];
        say(title, text);
        try { await run(); } catch (e) { if (e.message === 'stopped') throw e; /* 某一步没成功：继续下一步 */ }
      }
    } catch { /* 停止 */ }
    finally { running = false; onCaption(null); }
  }
  return {
    play, steps: STEPS.map(s => s[0]),
    pause() { paused = !paused; return paused; },
    stop() { stopped = true; paused = false; },
    get running() { return running; }, get paused() { return paused; },
  };
}
