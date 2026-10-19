/* 安药 · 手表提醒（小米 Watch S3 等，安卓应用里可用）。
   连上并认证后，到点把用药通知发到手表；手表上点“在手机上打开”，手机弹出确认，点了“已服药 / 稍后 10 分钟”才改记录。
   网页预览没有手表通道，入口照常显示，但说明需要安卓应用。 */
(() => {
 const native=()=>!!window.AndroidApp?.watch;
 const w={status:null,bonded:[],busy:false,error:'',message:'',pick:''};
 const W=(op,extra)=>AndroidApp.watch(op,extra);
 async function refresh(){if(!native())return null;try{w.status=await W('status')}catch(e){w.error=e.message}return w.status}
 const summary=()=>!native()?'需要安药安卓应用':!w.status?.paired?'还没有连接手表':!w.status.enabled?'已连接，提醒已关闭':w.status.authenticated?'已连接 · 到点手表会提醒':'手表没连上，会自动重连';

 function rowHTML(){
  return `<div class="m-section"><h2 class="m-caption">手表</h2></div><div class="surface">`
   +`<button type="button" class="menu-row" data-action="watch-settings" data-lead="icon"><span class="row-icon">${icon('device')}</span><span class="row-body"><strong>手表提醒</strong><small data-watch-summary>${esc(summary())}</small></span><span class="arrow" aria-hidden="true"></span></button></div>`;
 }
 window.watchSectionHTML=rowHTML;

 function pairBody(){
  const list=w.bonded;
  return `<p class="helper">把手表上的用药通知接到安药：先在小米运动健康或 Gadgetbridge 里让手表和这部手机配对，再在这里选择手表、填写认证密钥。</p>`
   +`<div class="m-section"><h2 class="m-caption">选择手表</h2><button data-action="watch-bonded">刷新</button></div>`
   +`<div class="surface">${list.length?list.map(d=>`<button type="button" class="setting-row" data-action="watch-pick" data-id="${esc(d.id)}" aria-pressed="${w.pick===d.id}"><span>${esc(d.name)}<small>${esc(d.id)}</small></span><span class="switch ${w.pick===d.id?'on':''}" aria-hidden="true"></span></button>`).join('')
     :'<p class="empty">系统蓝牙里没有已配对的手表。请先在小米运动健康或 Gadgetbridge 里完成配对，再点「刷新」。</p>'}</div>`
   +`<form data-kind="watch-pair"><div class="surface">${field('认证密钥（32 位）','key','','text',true,'autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="40" placeholder="例如 0123456789abcdef…"')}</div>`
   +`<p class="helper">认证密钥在 Gadgetbridge 的设备设置“认证密钥”里；是从小米账号取得的那一串。密钥只加密保存在这部手机上，不会进备份。</p>`
   +(w.error?`<p class="pillbox-feedback" role="alert">${esc(w.error)}</p>`:'')
   +`<button class="primary" ${w.busy||!w.pick?'disabled':''}>${w.busy?esc(w.message||'正在连接…'):'连接并认证'}</button></form>`
   +`<p class="helper">同一时间只能有一个应用连着手表。如果连不上，请让正在连接这块手表的其他应用先断开。</p>`;
 }
 function pairedBody(){
  const s=w.status,facts=[s.model,s.battery!=null?`电量 ${s.battery}%`:'',s.firmware?`固件 ${s.firmware}`:''].filter(Boolean).join(' · ');
  const last=s.lastDelivery;
  return `<section class="surface device-card"><div class="detail-hero"><span class="row-icon">${icon('device')}</span><div><strong>${esc(s.name||'小米手表')}</strong><small class="pillbox-state ${s.authenticated?'ready':''}">${s.authenticated?'已连接并认证':'没有连上，会自动重连'}</small></div></div>${facts?`<p class="helper">${esc(facts)}</p>`:''}${s.error&&!s.authenticated?`<p class="pillbox-feedback" role="alert">${esc(s.error)}</p>`:''}</section>`
   +`<div class="surface"><button type="button" class="setting-row" data-action="watch-toggle" aria-pressed="${!!s.enabled}" ${w.busy?'disabled':''}><span>到点在手表上提醒<small>${s.enabled?'到点、晚点吃的约定时间、超时没吃时各发一次':'已关闭'}</small></span><span class="switch ${s.enabled?'on':''}" aria-hidden="true"></span></button></div>`
   +(last?`<p class="helper">${last.sent===false?`上次发送没成功：${esc(last.error||'')}`:`上次在 ${esc(stamp(last.sentAt))} 发到手表${last.test?'（测试）':''}`}</p>`:'')
   +(w.error?`<p class="pillbox-feedback" role="alert">${esc(w.error)}</p>`:'')
   +`<div class="action-grid"><button type="button" data-action="watch-test" ${w.busy?'disabled':''}>${w.busy&&w.message==='test'?'正在发送…':'试一下手表提醒'}</button><button type="button" data-action="watch-reconnect" ${w.busy?'disabled':''}>${w.busy&&w.message==='reconnect'?'正在连接…':'重新连接'}</button></div>`
   +`<p class="helper">手表上会显示药名、剂量和时间。点手表上的“在手机上打开”，在安药里确认已服药或稍后 10 分钟；只看通知、划掉通知都不会记成已服药。试一下不会改服药记录。</p>`
   +`<button class="danger-btn" data-action="watch-forget">断开并忘记这块手表</button>`;
 }
 const body=()=>!native()?`<p class="empty">手表提醒需要安药安卓应用：手机通过蓝牙把用药通知发到手表上。</p>`:w.status?.paired?pairedBody():pairBody();
 const paint=()=>{if(document.querySelector('#detail-dialog[open] [data-watch-panel]'))panel('手表提醒',`<div data-watch-panel>${body()}</div>`)};
 const paintRow=()=>{const el=document.querySelector('[data-watch-summary]');if(el)el.textContent=summary()};

 async function confirmPanel(id){
  const r=await W('pending');const p=r?.pending;
  if(!p)return toast('这条手表提醒已经处理过或过期了');
  return panel(p.test?'手表提醒测试':'这次药吃了吗？',`<section class="dose-focus"><span class="row-icon">${icon('device')}</span><strong class="dose-name">${esc(p.drugName||'')} ${esc(p.dose||'')}</strong>${p.time?`<h3>${esc(p.time)}</h3>`:''}<p>${p.test?'这是测试，确认不会改服药记录。':'从手表上打开的提醒'}</p></section>`
   +`<button class="primary" data-action="watch-answer" data-id="${esc(p.notificationId)}" data-choice="taken">${icon('check')}已服药</button>`
   +`<button class="secondary-btn" data-action="watch-answer" data-id="${esc(p.notificationId)}" data-choice="snoozed">稍后 10 分钟再提醒</button>`);
 }

 const baseDispatch=dispatchAction;
 dispatchAction=async function(a,id,el){
  if(a==='watch-settings'){w.error='';panel('手表提醒',`<div data-watch-panel>${body()}</div>`);await refresh();if(native()&&!w.status?.paired)await dispatchAction('watch-bonded');paint();paintRow();return}
  if(a==='watch-bonded'){try{w.bonded=(await W('bonded')).devices||[];if(w.bonded.length===1)w.pick=w.bonded[0].id}catch(e){w.error=e.message}paint();return}
  if(a==='watch-pick'){w.pick=id;w.error='';paint();return}
  if(a==='watch-toggle'){w.busy=true;paint();try{w.status=await W('configure',{enabled:!w.status?.enabled});toast(w.status.enabled?'手表提醒已开启':'手表提醒已关闭')}catch(e){w.error=e.message}finally{w.busy=false;paint();paintRow()}return}
  if(a==='watch-test'||a==='watch-reconnect'){w.busy=true;w.message=a==='watch-test'?'test':'reconnect';w.error='';paint();
   try{if(a==='watch-test'){await W('test');toast('已发到手表，请看一下手表')}else{w.status=await W('reconnect');toast(w.status.authenticated?'手表已连接':'手表还没连上')}}
   catch(e){w.error=e.message}finally{w.busy=false;w.message='';await refresh();paint();paintRow()}return}
  if(a==='watch-forget')return confirmDialog({title:'忘记这块手表',note:'安药不再连接这块手表，也不再把用药提醒发过去；保存的认证密钥会删掉。手表和手机的系统配对不受影响。',ok:'忘记',onConfirm:async()=>{w.status=await W('forget');w.bonded=[];w.pick='';paint();paintRow();toast('已忘记这块手表')}});
  if(a==='watch-confirm')return confirmPanel(id);
  if(a==='watch-answer'){const choice=el?.dataset.choice;await W('confirm',{notificationId:Number(id),choice});$('#detail-dialog').close();await load();toast(choice==='taken'?'已记下，家属那边也能看到':'10 分钟后再提醒你');return}
  return baseDispatch(a,id,el);
 };
 formHandlers['watch-pair']=async form=>{
  const key=String(new FormData(form).get('key')||'');
  if(!w.pick)throw Error('请先选择手表');
  w.busy=true;w.message='正在连接并认证手表，可能要半分钟…';w.error='';paint();
  try{w.status=await W('pair',{deviceId:w.pick,key});toast('手表已连接，到点会在手表上提醒')}
  catch(e){w.error=e.message}finally{w.busy=false;w.message='';paint();paintRow()}
 };
 window.addEventListener('anyao-loaded',()=>{if(native()&&!w.status)refresh().then(paintRow)});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden&&native())refresh().then(paintRow)});
})();
