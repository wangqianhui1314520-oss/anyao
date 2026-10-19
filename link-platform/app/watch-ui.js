/* 安药 · 手表提醒（小米 Watch S3 等，安卓应用里可用）。
   连上并认证后，到点把用药通知发到手表；手表上点“在手机上打开”，手机弹出确认，点了“已服药 / 稍后 10 分钟”才改记录。
   网页预览没有手表通道，入口照常显示，但说明需要安卓应用。 */
(() => {
 const native=()=>!!window.AndroidApp?.watch;
 const w={status:null,bonded:[],alarm:null,busy:false,error:'',message:'',pick:''};
 const emitStatus=()=>{if(w.status)window.dispatchEvent(new CustomEvent('anyao-watch-status',{detail:w.status}))};
 const W=async(op,extra)=>{const r=await AndroidApp.watch(op,extra);if(r&&typeof r.paired==='boolean'){w.status=r;emitStatus()}return r};
 async function refresh(){if(!native())return null;try{w.status=await W('status')}catch(e){w.error=e.message}return w.status}
 const phaseText=phase=>({connecting:'正在建立蓝牙连接',rfcomm:'正在建立蓝牙连接',negotiating:'正在协商连接协议',negotiate:'正在协商连接协议',authenticating:'正在认证手表',authenticate:'正在认证手表',verifying:'正在验证加密通信',verify:'正在验证加密通信'}[phase]||'手表没连上，会自动重连');
 const summary=()=>!native()?'需要安药安卓应用':!w.status?.paired?'还没有连接手表':!w.status.authenticated?phaseText(w.status.connectionPhase):w.status.targetPending?'提醒设置尚未完成，请重试':(w.status.targetEnabled??w.status.enabled)?'已连接 · 到点手表会提醒':'已连接，提醒已关闭';

 function rowHTML(){
  return `<div class="m-section"><h2 class="m-caption">手表</h2></div><div class="surface">`
   +`<button type="button" class="menu-row" data-action="watch-settings" data-lead="icon"><span class="row-icon">${icon('device')}</span><span class="row-body"><strong>手表提醒</strong><small data-watch-summary>${esc(summary())}</small></span><span class="arrow" aria-hidden="true"></span></button></div>`;
 }
 window.watchSectionHTML=rowHTML;

 function pairBody(){
  const list=w.bonded;
  return `<p class="helper">把手表上的用药通知接到安药：先在小米运动健康或 Gadgetbridge 里让手表和这部手机配对，再在这里选择手表、填写认证密钥。</p>`
   +`<div class="m-section"><h2 class="m-caption">选择手表</h2><button data-action="watch-bonded" ${w.busy?'disabled':''}>刷新</button></div>`
   +`<div class="surface">${list.length?list.map(d=>`<button type="button" class="setting-row" data-action="watch-pick" data-id="${esc(d.id)}" aria-pressed="${w.pick===d.id}" ${w.busy?'disabled':''}><span>${esc(d.name)}<small>${esc(d.id)}</small></span><span class="switch ${w.pick===d.id?'on':''}" aria-hidden="true"></span></button>`).join('')
     :'<p class="empty">系统蓝牙里没有已配对的手表。请先在小米运动健康或 Gadgetbridge 里完成配对，再点「刷新」。</p>'}</div>`
   +`<form data-kind="watch-pair"><div class="surface">${field('认证密钥（32 位）','key','','password',true,'autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="40" placeholder="例如 0123456789abcdef…"')}</div>`
   +`<p class="helper">认证密钥在 Gadgetbridge 的设备设置“认证密钥”里；是从小米账号取得的那一串。密钥只加密保存在这部手机上，不会进备份。</p>`
   +(w.error?`<p class="pillbox-feedback" role="alert">${esc(w.error)}</p>`:'')
   +`<button class="primary" ${w.busy||!w.pick?'disabled':''}>${w.busy?esc(w.message||'正在连接…'):'连接并认证'}</button></form>`
   +`<p class="helper">同一时间只能有一个应用连着手表。若安装过旧版安药，请先关闭旧版的手表自动同步；也请断开 Gadgetbridge / 小米运动健康中的手表连接，再在安药连接。系统蓝牙配对可以保留。</p>`;
 }
 function pairedBody(){
  const s=w.status,facts=[s.model,s.battery!=null?`电量 ${s.battery}%`:'',s.firmware?`固件 ${s.firmware}`:''].filter(Boolean).join(' · ');
  const last=s.lastDelivery;
  const a=w.alarm,as=s.alarmSettings||{};
  const alarmRows=Array.isArray(a?.alarms)?a.alarms:[];
  const alarmTimes=Array.isArray(a?.requestedTimes)?a.requestedTimes:[];
  const alarmRowsHTML=alarmRows.length?`<div class="detail-list">${alarmRows.map(x=>`<div><span>${esc(x.label||'手表闹钟')}</span><b>${esc(String(x.hour??'').padStart(2,'0'))}:${esc(String(x.minute??'').padStart(2,'0'))} · ${x.enabled?'已开启':'已关闭'}${x.managed?' · 安药':''}</b></div>`).join('')}</div>`:'<p class="helper">还没有读取手表闹钟。</p>';
  const requested=alarmTimes.length?`<p class="helper">本次计划：${alarmTimes.map(t=>esc(t)).join(' · ')}</p>`:'';
  const changes=a&&('createCount' in a||'removeCount' in a)?`<p class="helper">同步预览：将新增 ${esc(a.createCount||0)} 个、移除 ${esc(a.removeCount||0)} 个安药闹钟。</p>`:'';
  return `<section class="surface device-card"><div class="detail-hero"><span class="row-icon">${icon('device')}</span><div><strong>${esc(s.name||'小米手表')}</strong><small class="pillbox-state ${s.authenticated?'ready':''}">${s.authenticated?'已连接并认证':'没有连上，会自动重连'}</small></div></div>${facts?`<p class="helper">${esc(facts)}</p>`:''}${s.error&&!s.authenticated?`<p class="pillbox-feedback" role="alert">${esc(s.error)}</p>`:''}</section>`
   +`<div class="surface"><button type="button" class="setting-row" data-action="watch-toggle" aria-pressed="${!!s.enabled}" ${w.busy?'disabled':''}><span>药名与备注通知<small>${s.enabled?'到点、晚点吃的约定时间、超时没吃时各发一次':'已关闭'}</small></span><span class="switch ${s.enabled?'on':''}" aria-hidden="true"></span></button>`
   +`<button type="button" class="setting-row" data-action="watch-vibration-toggle" aria-pressed="${!!s.vibrationEnabled}" ${w.busy?'disabled':''}><span>用药提醒时震动<small>${s.vibrationEnabled?'已开启':'已关闭'} · 短促提醒；部分手表会同时响铃</small></span><span class="switch ${s.vibrationEnabled?'on':''}" aria-hidden="true"></span></button></div>`
   +`<section class="surface watch-alarm-card"><div class="detail-hero"><span class="row-icon">${icon('clock')}</span><div><strong>手表本地闹钟</strong><small>${as.enabled?'自动更新已开启':'手动设置 · 默认不写入'}</small></div></div><p class="helper">本地闹钟只保存时间；药名与备注通过连接手机时的通知发送。声音由手表该条闹钟的“仅震动”设置决定，安药暂不远程切换本地闹钟声音/震动。关闭闹钟不代表已经服药，仍需在安药确认。</p>${a?`${a.maxAlarms!=null?`<p class="helper">手表容量 ${alarmRows.length} / ${esc(a.maxAlarms)}</p>`:''}${requested}${changes}${a.error?`<p class="pillbox-feedback" role="status">${esc(a.error)}</p>`:''}${alarmRowsHTML}`:'<p class="helper">点“读取手表闹钟”查看现有时刻；打开页面不会自动写入。</p>'}<div class="action-grid"><button type="button" data-action="watch-alarm-preview" ${w.busy?'disabled':''}>读取手表闹钟</button><button type="button" data-action="watch-alarm-enable" ${w.busy||!a||a.canSync===false?'disabled':''}>同步用药闹钟</button></div><div class="action-grid"><button type="button" class="secondary-btn" data-action="watch-alarm-test" ${w.busy||!a||a.canSync===false?'disabled':''}>测试闹钟 · 2 分钟后</button><button type="button" class="secondary-btn" data-action="watch-alarm-clear" ${w.busy||!a?'disabled':''}>移除安药闹钟</button></div>${as.lastSyncedAt?`<p class="helper">上次同步：${esc(as.lastSyncedAt)}</p>`:''}${as.needsReview?'<p class="pillbox-feedback" role="status">上次闹钟操作需要复核，请先读取手表闹钟。</p>':''}</section>`
   +(last?`<p class="helper">${last.sent===false?`上次发送没成功：${esc(last.error||'')}`:`上次在 ${esc(stamp(last.sentAt))} 发到手表${last.test?'（测试）':''}`}</p>`:'')
   +(w.error?`<p class="pillbox-feedback" role="alert">${esc(w.error)}</p>`:'')
   +`<div class="action-grid"><button type="button" data-action="watch-test" ${w.busy?'disabled':''}>${w.busy&&w.message==='test'?'正在发送…':'试一下药名与备注通知'}</button><button type="button" data-action="watch-reconnect" ${w.busy?'disabled':''}>${w.busy&&w.message==='reconnect'?'正在连接…':'重新连接'}</button></div>`
   +`<button type="button" class="secondary-btn" data-action="watch-vibrate" ${w.busy?'disabled':''}>${w.busy&&w.message==='vibrate'?'正在发送…':'试一下手表震动'}</button>`
   +`<p class="helper">药名与备注通知会显示药名、剂量和备注。点手表上的“在手机上打开”，在安药里确认已服药或稍后 10 分钟；只看通知、划掉通知都不会记成已服药。试一下不会改服药记录。</p>`
   +`<button class="danger-btn" data-action="watch-forget" ${w.busy?'disabled':''}>断开并忘记这块手表</button>`;
 }
 const body=()=>!native()?`<p class="empty">手表提醒需要安药安卓应用：手机通过蓝牙把用药通知发到手表上。</p>`:w.status?.paired?pairedBody():pairBody();
 const paint=()=>{if(document.querySelector('#detail-dialog[open] [data-watch-panel]'))panel('手表提醒',`<div data-watch-panel>${body()}</div>`)};
 const paintRow=()=>{const el=document.querySelector('[data-watch-summary]');if(el)el.textContent=summary()};

 async function confirmPanel(id){
  const r=await W('pending');const p=r?.pending;
  if(!p)return toast('这条手表提醒已经处理过或过期了');
  return panel(p.test?'手表提醒测试':'这次药吃了吗？',`<section class="dose-focus"><span class="row-icon">${icon('device')}</span><strong class="dose-name">${esc(p.drugName||'')} ${esc(p.dose||'')}</strong>${p.time?`<h3>${esc(p.time)}</h3>`:''}${p.note?`<p>${esc(p.note)}</p>`:''}<p>${p.test?'这是测试，确认不会改服药记录。':'从手表上打开的提醒'}</p></section>`
   +`<button class="primary" data-action="watch-answer" data-id="${esc(p.notificationId)}" data-choice="taken">${icon('check')}已服药</button>`
   +`<button class="secondary-btn" data-action="watch-answer" data-id="${esc(p.notificationId)}" data-choice="snoozed">稍后 10 分钟再提醒</button>`);
 }

 const baseDispatch=dispatchAction;
 dispatchAction=async function(a,id,el){
  if(w.busy&&['watch-settings','watch-bonded','watch-pick','watch-toggle','watch-vibration-toggle','watch-test','watch-vibrate','watch-reconnect','watch-forget','watch-alarm-preview','watch-alarm-enable','watch-alarm-test','watch-alarm-clear'].includes(a))return;
  if(a==='watch-settings'){w.error='';w.alarm=null;panel('手表提醒',`<div data-watch-panel>${body()}</div>`);await refresh();if(native()&&!w.status?.paired)await dispatchAction('watch-bonded');paint();paintRow();return}
  if(a==='watch-bonded'){w.busy=true;paint();try{w.bonded=(await W('bonded')).devices||[];if(w.bonded.length===1)w.pick=w.bonded[0].id;else if(!w.bonded.some(d=>d.id===w.pick))w.pick=''}catch(e){w.error=e.message}finally{w.busy=false;paint()}return}
  if(a==='watch-pick'){w.pick=id;w.error='';paint();return}
  if(a==='watch-toggle'){w.busy=true;paint();try{w.status=await W('configure',{enabled:!w.status?.enabled});toast(w.status.enabled?'手表提醒已开启':'手表提醒已关闭')}catch(e){w.error=e.message}finally{w.busy=false;paint();paintRow()}return}
  if(a==='watch-vibration-toggle'){w.busy=true;paint();try{w.status=await W('configure',{enabled:w.status.enabled,vibrationEnabled:!w.status.vibrationEnabled});toast(w.status.vibrationEnabled?'手表震动提醒已开启':'手表震动提醒已关闭')}catch(e){w.error=e.message}finally{w.busy=false;paint();paintRow()}return}
  if(a==='watch-alarm-preview'){w.busy=true;w.message='alarm-preview';w.error='';paint();try{const r=await W('alarm-preview');if(r?.error)throw Error(r.error);w.alarm=r?.preview||r;toast('已读取手表闹钟')}catch(e){w.error=e.message}finally{w.busy=false;w.message='';paint()}return}
  if(a==='watch-alarm-enable'){w.busy=true;w.message='alarm-enable';w.error='';paint();try{const r=await W('alarm-enable');if(r?.error)throw Error(r.error);w.alarm=r?.preview||r;w.status={...w.status,alarmSettings:r?.alarmSettings||{...w.status.alarmSettings,enabled:true}};emitStatus();toast('已同步并开启自动更新手表闹钟')}catch(e){w.error=e.message}finally{w.busy=false;w.message='';paint();paintRow()}return}
  if(a==='watch-alarm-clear'){w.busy=true;w.message='alarm-clear';w.error='';paint();try{const r=await W('alarm-clear');if(r?.error)throw Error(r.error);w.alarm=r?.preview||r;w.status={...w.status,alarmSettings:r?.alarmSettings||{...w.status.alarmSettings,enabled:false}};emitStatus();toast('已关闭自动更新并移除安药闹钟')}catch(e){w.error=e.message}finally{w.busy=false;w.message='';paint();paintRow()}return}
  if(a==='watch-alarm-test'){w.busy=true;w.message='alarm-test';w.error='';paint();try{const r=await W('alarm-test');if(r?.verified!==true)throw Error(r?.error||'手表尚未确认测试闹钟，请读取手表检查');toast(`测试闹钟已设置为 ${String(r.hour).padStart(2,'0')}:${String(r.minute).padStart(2,'0')}${r.labelStored===true?'，提示已保存':''}`)}catch(e){w.error=e.message}finally{w.busy=false;w.message='';paint()}return}
  if(a==='watch-test'||a==='watch-reconnect'||a==='watch-vibrate'){w.busy=true;w.message=a==='watch-test'?'test':a==='watch-vibrate'?'vibrate':'reconnect';w.error='';paint();
   try{if(a==='watch-test'){await W('test');toast('已发到手表，请看一下手表')}else if(a==='watch-vibrate'){const r=await W('vibrate');toast(r?.deviceAccepted==='confirmed'?'震动指令已确认，请感受手表':'震动指令已发送，请感受手表')}else{w.status=await W('reconnect');toast(w.status.authenticated?'手表已连接':'手表还没连上')}}
   catch(e){w.error=e.message}finally{w.busy=false;w.message='';await refresh();paint();paintRow()}return}
  if(a==='watch-forget')return confirmDialog({title:'忘记这块手表',note:'安药不再连接这块手表，也不再把用药提醒发过去；保存的认证密钥会删掉。手表和手机的系统配对不受影响。',ok:'忘记',onConfirm:async()=>{w.status=await W('forget');w.bonded=[];w.pick='';paint();paintRow();toast('已忘记这块手表')}});
  if(a==='watch-confirm')return confirmPanel(id);
  if(a==='watch-answer'){const choice=el?.dataset.choice;await W('confirm',{notificationId:Number(id),choice});$('#detail-dialog').close();await load();toast(choice==='taken'?'已记下，家属那边也能看到':'10 分钟后再提醒你');return}
  return baseDispatch(a,id,el);
 };
 formHandlers['watch-pair']=async form=>{
  if(w.busy)return;
  const key=String(new FormData(form).get('key')||'');
  if(!w.pick)throw Error('请先选择手表');
  const deviceId=w.pick;
  w.busy=true;w.message='正在连接并认证手表，可能要半分钟…';w.error='';paint();
  try{w.status=await W('pair',{deviceId,key});if(!w.status?.authenticated)throw Error(w.status?.error||'手表尚未完成认证，请重新连接');w.status=await W('status');if(!w.status?.authenticated)throw Error(w.status?.error||'手表已断开，请重新连接');toast(w.status.enabled?'手表已连接，到点会在手表上提醒':'手表已连接并认证，提醒已关闭')}
  catch(e){w.error=e.message}finally{w.busy=false;w.message='';paint();paintRow()}
 };
 window.addEventListener('anyao-loaded',()=>{if(native()&&!w.status)refresh().then(paintRow)});
 window.addEventListener('anyao-watch-status',e=>{if(e.detail&&e.detail!==w.status){w.status={...w.status,...e.detail};paint();paintRow()}});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden&&native())refresh().then(paintRow)});
})();
