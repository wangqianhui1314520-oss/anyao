/* 演示专用的小改动：只在三端联动里注入，安药源码（app/ 目录）保持与最新版完全一致。
   1. 家庭同步状态不放在页面顶部，只在“设置 → 同步与访问”里显示。
   2. 药盒还没连接时，第一次打开药盒外盖 → 手机自动弹出“连接智能药盒”窗口。 */
(() => {
  // 1. 顶部同步横幅：隐藏（设置里的“同步与访问”行和面板照常显示状态）
  const style = document.createElement('style');
  style.textContent = '#sync-banner{display:none!important}';
  document.head.append(style);

  // 2. 开盖自动弹出连接窗口
  if (document.body?.dataset.role === 'family' || location.pathname.endsWith('family.html')) return;
  let opening = false;
  async function openConnect() {
    if (opening || document.querySelector('#pillbox-dialog')?.open) return;
    opening = true;
    try {
      // 与用户点“连接药盒”走同一个入口：药盒页的 pillbox-connect 动作
      if (typeof state === 'object' && state.tab !== 'box' && typeof goTab === 'function') goTab('box');
      document.querySelector('#detail-dialog')?.open && document.querySelector('#detail-dialog').close();
      if (typeof action === 'function') await action('pillbox-connect');
      if (typeof toast === 'function') toast('检测到药盒已打开，请连接药盒');
    } catch { /* 页面还没载入完：下次开盖再弹 */ }
    finally { opening = false; }
  }
  window.addEventListener('anyao-native', e => {
    if (e.detail?.event === 'pillbox-connect-prompt') setTimeout(openConnect, 300);
  });
})();
