/* 虚拟安卓层：让真实的安药页面（与 APK 内置页面完全相同）在浏览器里以“安卓应用”方式运行。
   页面发给 NativeApi 的每条消息，按 MainActivity.handle() 的同一份约定转发给联动服务：
   - action:"api"  → 安药自己的 server.js（真实数据层）
   - 药盒 / 手表 / 提醒 / 电话等原生能力 → 联动服务里的三维药盒、三维 Watch S3 与手机效果
   服务端推送的原生事件（data-changed / pillbox / open-dose / watch-open）原样送回页面。 */
(() => {
  const params = new URLSearchParams(location.search);
  const key = params.get('k') || (() => { try { return localStorage.getItem('anyao-link-key') || ''; } catch { return ''; } })();
  if (params.get('k')) { try { localStorage.setItem('anyao-link-key', params.get('k')); } catch { /* ignore */ } }
  const embed = params.has('embed');
  const role = location.pathname.endsWith('family.html') ? 'family' : 'user';
  // 安卓 WebView 会提供状态栏 / 导航栏高度；嵌在大屏的手机外框里时给出与真机相近的值。
  const root = document.documentElement;
  root.style.setProperty('--sat', embed ? '38px' : 'env(safe-area-inset-top)');
  root.style.setProperty('--sab', embed ? '14px' : 'env(safe-area-inset-bottom)');

  // 演示时钟：页面的“现在”跟随联动服务（可快进），与真机上“系统时间”一致
  const RealDate = Date;
  let offset = Number(sessionStorage.getItem('anyao-demo-offset') || 0);
  class DemoDate extends RealDate { constructor(...a) { if (a.length) super(...a); else super(RealDate.now() + offset); } static now() { return RealDate.now() + offset; } }
  window.Date = DemoDate;
  const setOffset = next => { if (Math.abs(next - offset) < 1500) return; offset = next; sessionStorage.setItem('anyao-demo-offset', String(offset)); };

  // native-client.js 会接管 window.fetch；本层自己的请求用原始 fetch
  const rawFetch = window.fetch.bind(window);
  const api = { onmessage: null };
  let open = 0;
  async function forward(message) {
    let request;
    try { request = JSON.parse(message); } catch { return; }
    open++;
    try {
      const response = await rawFetch(`/native/call?k=${encodeURIComponent(key)}&role=${role}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
      const out = await response.json();
      api.onmessage?.({ data: JSON.stringify(out) });
    } catch (error) {
      api.onmessage?.({ data: JSON.stringify({ id: request.id, ok: false, error: '与电脑上的安药联动服务断开了，请检查网络' }) });
    } finally { open--; }
  }
  api.postMessage = text => { forward(text); };
  window.NativeApi = api;

  // 原生推送：服务端广播 native 事件，只转发给本页面角色关心的内容。
  const source = new EventSource(`/api/events?role=${embed ? 'viewer' : 'phone'}&k=${encodeURIComponent(key)}`);
  source.addEventListener('state', event => {
    const before = offset;
    setOffset(JSON.parse(event.data).offset || 0);
    // 时间跳转后让页面立即按新时间刷新（真机上相当于系统时间变化后回到前台）
    if (before !== offset) api.onmessage?.({ data: JSON.stringify({ event: 'data-changed' }) });
  });
  source.addEventListener('native', event => {
    const detail = JSON.parse(event.data);
    if (detail.role && detail.role !== role) return;
    const { role: _r, ...payload } = detail;
    api.onmessage?.({ data: JSON.stringify(payload) });
  });
  // 手机端效果：到点震动 / 闪光 / 提示音，由服务端按“试一下提醒”与到点提醒的设置下发。
  let audio = null;
  const beep = (level = .5, ms = 400) => {
    try {
      audio ||= new AudioContext();
      const o = audio.createOscillator(), g = audio.createGain();
      o.frequency.value = 880; g.gain.value = .25 * level; o.connect(g).connect(audio.destination);
      o.start(); o.stop(audio.currentTime + ms / 1000);
    } catch { /* audio blocked until first tap */ }
  };
  addEventListener('pointerdown', () => { try { audio ||= new AudioContext(); audio.resume(); } catch { /* ignore */ } }, { once: true });
  function flash(times, pulse, gap) {
    let n = 0;
    const layer = document.createElement('div');
    layer.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#fff;pointer-events:none;opacity:0;transition:opacity .08s';
    document.body.append(layer);
    const step = () => { if (n++ >= times) { layer.remove(); return; } layer.style.opacity = '.92'; setTimeout(() => { layer.style.opacity = '0'; setTimeout(step, gap); }, pulse); };
    step();
  }
  source.addEventListener('phone-effects', event => {
    const e = JSON.parse(event.data);
    if (e.role && e.role !== role) return;
    if (embed) { window.parent?.postMessage({ anyao: 'phone-effects', effects: e }, '*'); if (!e.preview) return; }
    if (e.vibration) navigator.vibrate?.(e.vibration);
    if (e.sound) for (let i = 0; i < e.sound.repeats; i++) setTimeout(() => beep(e.sound.level, e.sound.pulseMs), i * (e.sound.pulseMs + e.sound.intervalMs));
    if (e.flash) flash(e.flash.repeats, e.flash.pulseMs, e.flash.intervalMs);
  });
  // 真手机上直接打开时：在页面顶部显示安卓式通知（带“我吃了 / 15 分钟后”等按钮），以及拨号 / 短信等系统界面示意。
  if (!embed) {
    const style = document.createElement('style');
    style.textContent = `.fa-notes{position:fixed;left:8px;right:8px;top:calc(8px + env(safe-area-inset-top));z-index:2147483000;display:flex;flex-direction:column;gap:8px;pointer-events:none}
.fa-note{pointer-events:auto;background:#fffffff5;backdrop-filter:blur(14px);border-radius:20px;padding:12px 14px;box-shadow:0 10px 30px -10px #0007;color:#111;font:14px/1.4 system-ui,"PingFang SC","MiSans",sans-serif;animation:faDrop .35s cubic-bezier(.2,.8,.2,1)}
.fa-note header{display:flex;gap:6px;align-items:center;font-size:12px;color:#777;margin-bottom:2px}.fa-note header i{width:15px;height:15px;border-radius:5px;background:#f04d18}
.fa-note strong{font-size:15px;display:block}.fa-note .acts{display:flex;gap:8px;margin-top:10px}.fa-note .acts button{flex:1;border:0;border-radius:14px;padding:9px 0;background:#f1f1f3;font:inherit}.fa-note .acts button:first-child{background:#f04d18;color:#fff}
.fa-sheet{position:fixed;left:0;right:0;bottom:0;z-index:2147483001;background:#fff;border-radius:24px 24px 0 0;padding:22px 22px calc(24px + env(safe-area-inset-bottom));box-shadow:0 -10px 30px -12px #0006;font:15px/1.5 system-ui,"PingFang SC",sans-serif;color:#111;animation:faUp .3s}
.fa-sheet small{color:#888;display:block}.fa-sheet h4{margin:4px 0;font-size:19px}.fa-sheet p{color:#555;margin:0 0 14px;word-break:break-all}.fa-sheet button{width:100%;border:0;border-radius:16px;background:#f1f1f3;padding:12px;font:inherit}
@keyframes faDrop{from{transform:translateY(-120%);opacity:0}}@keyframes faUp{from{transform:translateY(100%)}}`;
    document.head.append(style);
    let host = null;
    const layer = () => { if (!host) { host = document.createElement('div'); host.className = 'fa-notes'; document.body.append(host); } return host; };
    const act = (n, op, el) => { el.remove(); rawFetch(`/native/notification?k=${encodeURIComponent(key)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: n.id, op }) }); };
    source.addEventListener('notification', event => {
      const n = JSON.parse(event.data);
      if (n.role !== role) return;
      layer().querySelectorAll(`[data-tag="${CSS.escape(n.tag || '')}"]`).forEach(x => x.remove());
      const el = document.createElement('div'); el.className = 'fa-note'; if (n.tag) el.dataset.tag = n.tag;
      el.innerHTML = '<header><i></i>安药 · 现在</header><strong></strong><div></div>';
      el.querySelector('strong').textContent = n.title; el.querySelector('div').textContent = n.text || '';
      if (n.actions?.length) { const acts = document.createElement('div'); acts.className = 'acts'; n.actions.forEach(([op, label]) => { const b = document.createElement('button'); b.textContent = label; b.onclick = e => { e.stopPropagation(); act(n, op, el); }; acts.append(b); }); el.append(acts); }
      setTimeout(() => el.remove(), n.actions?.length ? 9000 : 5000);
      el.onclick = () => act(n, 'open', el);
      layer().prepend(el);
      navigator.vibrate?.([300, 150, 300]);
    });
    source.addEventListener('notification-cancel', event => { const { tag } = JSON.parse(event.data); host?.querySelectorAll(`[data-tag="${CSS.escape(tag)}"]`).forEach(x => x.remove()); });
    source.addEventListener('system-ui', event => {
      const ui = JSON.parse(event.data);
      if (ui.role && ui.role !== role) return;
      document.querySelector('.fa-sheet')?.remove();
      const titles = { call: ['电话', `正在呼叫 ${ui.name || ''} ${ui.phone || ''}`, '演示：没有真实拨出'], sms: ['短信', `发给 ${ui.phone || ''}`, ui.text || ''], email: ['邮件', `发给 ${ui.to || ''}`, ui.text || ''], wechat: ['微信', '提醒文字已复制', ui.text || ''], share: ['分享', '分享提醒', ui.text || ''], settings: ['系统设置', ui.title, '演示：已打开对应设置'], permission: ['系统权限', ui.title, '演示：已允许'] }[ui.kind] || ['系统', ui.title || '', ''];
      const el = document.createElement('div'); el.className = 'fa-sheet';
      el.innerHTML = '<small></small><h4></h4><p></p><button type="button">好的</button>';
      el.querySelector('small').textContent = titles[0]; el.querySelector('h4').textContent = titles[1]; el.querySelector('p').textContent = titles[2];
      el.querySelector('button').onclick = () => el.remove();
      document.body.append(el); setTimeout(() => el.remove(), 5000);
    });
    source.addEventListener('backup', event => {
      const { name, data, role: r } = JSON.parse(event.data);
      if (r !== role) return;
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })); a.download = name; a.click();
    });
  }
  if (!embed) source.addEventListener('reload', () => location.reload());
  window.anyaoFakeAndroid = { role, embed, get pending() { return open; } };
})();
