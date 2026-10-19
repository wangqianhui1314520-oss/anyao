/* 演示附加：PB1 药盒“仅振动与休眠”的手机设置（屏幕左滑 / 右滑功能的手机端）。
   安药源码不改，本文件在页面末尾注入：在药盒页加一行入口和状态卡，动作经原生药盒通道 pb1Modes / pb1Prefs / pb1Vibrate / pb1Sleep。 */
(() => {
  if (location.pathname.endsWith('family.html') || typeof pages !== 'object' || !pages.box || !window.DeviceBridge) return;
  const modes = { status: null, busy: false };
  const LEVELS = [['gentle', '轻柔'], ['standard', '标准'], ['strong', '醒目']];
  const levelName = id => (LEVELS.find(x => x[0] === id) || [])[1] || '标准';
  const hm = ms => new Date(Number(ms)).toLocaleTimeString('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit' });
  const call = (op, extra = {}) => DeviceBridge.call(op, null, { target: 'pillbox', ...extra });
  async function load() {
    try { const s = await call('hipeeStatus'); modes.status = s?.savedDevice ? await call('pb1Modes') : null; }
    catch { modes.status = null; }
    return modes.status;
  }
  function summary() {
    const m = modes.status; if (!m) return '';
    if (m.sleep) return `休眠中，到 ${hm(m.sleep.until)} 醒来`;
    return [m.vibrateOnly ? `仅振动 · ${levelName(m.prefs.vibrateLevel)}` : '', m.prefs.vibrateAuto.enabled ? `${m.prefs.vibrateAuto.start} 起自动仅振动` : '', m.prefs.nightSleep.enabled ? `${m.prefs.nightSleep.start}–${m.prefs.nightSleep.end} 夜间休眠` : ''].filter(Boolean).join(' · ') || '振动强度、自动进入时间、休眠时间';
  }
  function cardHTML() {
    const m = modes.status; if (!m || (!m.sleep && !m.vibrateOnly)) return '';
    if (m.sleep) return `<section class="surface take-card" data-level="done" data-pb1-card><p class="take-label">药盒休眠中${m.sleep.kind === 'night' ? ' · 夜间睡眠' : ''}</p><p class="take-time">到 ${esc(hm(m.sleep.until))}</p><p class="take-note">${m.sleep.held ? `睡着时有 ${m.sleep.held} 次到点，醒来后会再提醒` : '期间到点不提醒，醒来后再提醒没吃的药'}</p><button class="m-btn m-btn-primary mega-btn" data-action="pillbox-sleep" data-id="off" ${modes.busy ? 'disabled' : ''}>我醒了</button></section>`;
    return `<p class="surface notice" data-pb1-card>${icon('clock')}<span>药盒仅振动 · ${esc(levelName(m.prefs.vibrateLevel))}${m.vibrateAutoUntil ? `，到 ${esc(hm(m.vibrateAutoUntil))} 自动结束` : ''}：到点只震动，手机不响铃不闪光</span></p>`;
  }
  const windowRow = (kind, w, label, note) =>
    `<button type="button" class="setting-row" data-action="pillbox-mode-toggle" data-id="${kind}" aria-pressed="${!!w.enabled}" ${modes.busy ? 'disabled' : ''}><span>${label}<small>${w.enabled ? `每天 ${esc(w.start)} – ${esc(w.end)}` : '已关闭'} · ${note}</small></span><span class="switch ${w.enabled ? 'on' : ''}" aria-hidden="true"></span></button>`
    + `<div class="setting-row pb1-window" ${w.enabled ? '' : 'hidden'}><label><span>开始</span><input type="time" data-pb1-time="${kind}.start" value="${esc(w.start)}"></label><label><span>结束</span><input type="time" data-pb1-time="${kind}.end" value="${esc(w.end)}"></label></div>`;
  function body() {
    const m = modes.status;
    if (!m) return `<p class="empty">请先连接药盒。</p><button class="secondary-btn" data-action="pillbox-connect">连接药盒</button>`;
    const p = m.prefs;
    return `<p class="helper">在药盒屏幕上左滑、点按键是“仅振动”；右滑、点按键是“休眠”。这里设置振动有多强、什么时候自动进入，保存后马上同步到药盒。</p>`
      + `<div class="m-section"><h2 class="m-caption">仅振动</h2></div><div class="surface">`
      + `<button type="button" class="setting-row" data-action="pillbox-vibrate" data-id="${m.vibrateOnly ? 'off' : 'on'}" aria-pressed="${!!m.vibrateOnly}" ${modes.busy ? 'disabled' : ''}><span>现在仅振动<small>${m.vibrateOnly ? '已开启 · 到点只震动，不亮灯' : '已关闭'}</small></span><span class="switch ${m.vibrateOnly ? 'on' : ''}" aria-hidden="true"></span></button>`
      + `<div class="setting-row pb1-stack"><span>振动强度<small>药盒和手机按这个强度震动</small></span>${segmented('pillbox-vibrate-level', p.vibrateLevel, LEVELS)}</div>`
      + windowRow('vibrateAuto', p.vibrateAuto, '自动进入仅振动', '比如上课、开会、在宿舍')
      + `</div><div class="m-section"><h2 class="m-caption">休眠</h2></div><div class="surface">`
      + `<div class="setting-row pb1-stack"><span>小睡多久<small>药盒右滑后按键，或点下面“现在休眠”</small></span>${segmented('pillbox-nap', String(p.napMinutes), [['30', '30 分'], ['60', '60 分'], ['90', '90 分'], ['120', '120 分']])}</div>`
      + windowRow('nightSleep', p.nightSleep, '夜间睡眠', '这段时间自动休眠')
      + `</div>`
      + (m.sleep ? `<button class="primary" data-action="pillbox-sleep" data-id="off" ${modes.busy ? 'disabled' : ''}>我醒了（结束休眠，${m.sleep.held ? `补提醒 ${m.sleep.held} 次` : '恢复提醒'}）</button>`
        : `<button class="primary" data-action="pillbox-sleep" data-id="on" ${modes.busy ? 'disabled' : ''}>现在休眠 ${p.napMinutes} 分钟</button>`)
      + `<p class="helper">休眠时到点不响铃、不亮灯，也不算“超时没吃”；醒来（时间到、按键或点“我醒了”）后，把睡着时没吃的药重新提醒一次。误开药仓的红灯提示不受影响。</p>`;
  }
  const paintPanel = () => { if (document.querySelector('#detail-dialog[open] [data-pb1-panel]')) panel('仅振动与休眠', `<div data-pb1-panel>${body()}</div>`); };
  const repaintPage = () => { if (state.tab === 'box' && !document.querySelector('#detail-dialog')?.open && !document.querySelector('#pillbox-dialog')?.open) render(); };
  async function run(op, extra, done) {
    if (modes.busy) return; modes.busy = true; paintPanel();
    try { modes.status = await call(op, extra); if (done) toast(done(modes.status)); }
    catch (e) { toast(e.message); }
    finally { modes.busy = false; paintPanel(); repaintPage(); }
  }
  const savePrefs = (prefs, text) => run('pb1Prefs', { prefs }, () => text);

  // 药盒页：顶部状态卡 + “药盒设置”里一行入口
  const baseBox = pages.box;
  pages.box = function () {
    let html = baseBox();
    if (!modes.status) return html;
    html = html.replace('<div class="m-section"><h2 class="m-caption">药盒设置</h2></div><div class="surface">',
      m => m + row('仅振动与休眠', summary(), 'setting', 'data-action="pillbox-modes"'));
    const card = cardHTML();
    if (card) html = html.replace(/(<div class="page-heading">[\s\S]*?<\/div><\/div>)/, m => m + card);
    return html;
  };
  const baseDispatch = dispatchAction;
  dispatchAction = async function (a, id, el) {
    if (a === 'pillbox-modes') { await load(); return panel('仅振动与休眠', `<div data-pb1-panel>${body()}</div>`); }
    if (a === 'pillbox-vibrate') return run('pb1Vibrate', { on: id === 'on' }, m => m.vibrateOnly ? '药盒已改为仅振动' : '药盒恢复指示灯提醒');
    if (a === 'pillbox-sleep') return run('pb1Sleep', { on: id === 'on' }, m => m.sleep ? `药盒休眠到 ${hm(m.sleep.until)}` : '已结束休眠，没吃的药会再提醒');
    if (a === 'pillbox-vibrate-level') { paintSegmented(a, id); return savePrefs({ vibrateLevel: id }, `振动强度已设为${levelName(id)}`); }
    if (a === 'pillbox-nap') { paintSegmented(a, id); return savePrefs({ napMinutes: Number(id) }, `休眠时长已设为 ${id} 分钟`); }
    if (a === 'pillbox-mode-toggle') { const w = modes.status?.prefs?.[id]; if (!w) return; return savePrefs({ [id]: { ...w, enabled: !w.enabled } }, `${id === 'nightSleep' ? '夜间睡眠' : '自动仅振动'}${w.enabled ? '已关闭' : `已开启：每天 ${w.start}–${w.end}`}`); }
    return baseDispatch(a, id, el);
  };
  document.addEventListener('change', e => {
    const t = e.target.closest?.('[data-pb1-time]');
    if (!t || !modes.status || !t.value) return;
    const [kind, edge] = t.dataset.pb1Time.split('.');
    const w = { ...modes.status.prefs[kind], [edge]: t.value };
    savePrefs({ [kind]: w }, `已改为每天 ${w.start}–${w.end}`);
  });
  const style = document.createElement('style');
  style.textContent = `.pb1-window{gap:10px;padding-top:4px}.pb1-window[hidden]{display:none}.pb1-window label{flex:1;display:grid;gap:4px;font-size:var(--m-text-sub);color:var(--th-fg-5)}.pb1-window input{min-height:42px;padding:8px 10px;border:1px solid var(--edge-subtle);border-radius:var(--radius-2xl);background:var(--surface-1);font:inherit;font-size:var(--m-text-body);color:var(--th-fg);font-variant-numeric:tabular-nums}.pb1-window input:focus{outline:none;border-color:var(--brand-cta)}.pb1-stack{flex-direction:column;align-items:stretch}.pb1-stack>span:first-child{flex:none}`;
  document.head.append(style);
  // 药盒那边按键 / 定时切换后，手机跟着刷新
  const refresh = () => load().then(() => { paintPanel(); repaintPage(); }).catch(() => {});
  window.addEventListener('anyao-native', e => { if (e.detail?.event === 'pillbox') refresh(); });
  window.addEventListener('anyao-pillbox-status', () => { if (!modes.status) refresh(); });
  refresh();
})();
