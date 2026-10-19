/* 服药端的提醒设置：四种方式开关 + 三档力度 + （安卓）后台提醒保障。
   只暴露配好的档位，不提供单通道参数编辑。 */
(() => {
 const M=ReminderModel;
 const CHANNELS=[['vibration','震动'],['sound','声音'],['flash','闪光'],['phone','通知']];
 const reminderLabels={vibration:'震动提醒',sound:'声音提醒',flash:'闪光提醒',phone:'通知提醒'};
 const pendingSettings=new Set();
 /* 三档力度同时写入四种提醒方式；标准档与设计默认值一致。 */
 const INTENSITY={
  gentle:{name:'轻柔',level:{vibration:30,sound:30,flash:30,phone:60},pulseMs:200,intervalMs:800,repeats:2,curve:'steady'},
  standard:{name:'标准',level:{vibration:70,sound:50,flash:70,phone:70},pulseMs:400,intervalMs:600,repeats:3,curve:'steady'},
  strong:{name:'醒目',level:{vibration:100,sound:100,flash:100,phone:100},pulseMs:800,intervalMs:400,repeats:4,curve:'up'}
 };
 const INTENSITY_OPTIONS=Object.entries(INTENSITY).map(([id,v])=>[id,v.name]);
 let timing=null;

 /*
    三种提醒设备的总开关。手机沿用已有四种提醒方式；药盒的开关会保存
    到硬件计划前的本机状态；手表直接使用 WatchReminders 的 enabled 状态。
    设备不存在、未认证或断开时只展示原因，开关保持 disabled，避免用户
    误以为已打开了一个实际不存在的提醒目标。
 */
 const TARGET_PREF_KEY='anyao-reminder-targets';
 const readTargetPrefs=()=>{try{return JSON.parse(localStorage.getItem(TARGET_PREF_KEY)||'{}')||{}}catch{return{}}};
 const targetPrefs=readTargetPrefs();
 const saveTargetPrefs=()=>{try{localStorage.setItem(TARGET_PREF_KEY,JSON.stringify(targetPrefs))}catch{}};
 const targetPref=(name,value)=>{if(value!==undefined){targetPrefs[name]=!!value;saveTargetPrefs()}return targetPrefs[name]};
 /* pillbox-ui.js loads after this file and uses this tiny bridge for its plan
    pause/restore behavior. It intentionally exposes no device credentials. */
 window.anyaoReminderTargetPref=targetPref;
 const targets={
  phone:{available:true,enabled:false,note:'按下面的震动、声音、闪光和通知设置执行'},
  pillbox:{available:false,enabled:false,note:'正在读取药盒状态…',status:null},
  watch:{available:false,enabled:false,note:'正在读取手表状态…',status:null}
 };
 let targetRefreshPromise=null,targetRefreshQueued=false,targetBusy='';
 const phoneTargetEnabled=()=>M.keys.some(k=>!!state.settings[k]);
 const targetLabel={phone:'手机提醒',pillbox:'药盒提醒',watch:'手表提醒'};
 const targetUnavailableText=(id,s)=>id==='phone'?'手机提醒始终可用':id==='watch'
   ?(!window.AndroidApp?.watch?'需要安药安卓应用':s?.paired&&!s?.authenticated?'手表未完成认证':'手表未连接或已断开')
   :(window.DeviceBridge?.supported?.()===false?'当前环境不支持药盒蓝牙':s?.savedDevice?'药盒未连接':'还没有连接药盒');
 const targetRow=(id)=>{
  const t=targets[id],busy=targetBusy===id,enabled=!!t.enabled,available=t.available===true;
  const status=busy?'保存中…':t.status?.targetPending?t.note:t.status?.reminderPending?'上次设置未完成，请重新连接后重试':available?(enabled?'已开启':'已关闭'):(t.note||targetUnavailableText(id,t.status));
  return `<button type="button" class="setting-row reminder-target-row" data-action="reminder-target-toggle" data-id="${id}" aria-pressed="${enabled}" ${!available||busy?'disabled aria-disabled="true"':''}>`
   +`<span>${targetLabel[id]}<small>${esc(status)}</small></span><span class="switch ${enabled&&available?'on':''}" aria-hidden="true"></span></button>`;
 };
 function reminderTargetsHTML(){
  if(!state.settings||typeof state.settings!=='object')return '';
  targets.phone.enabled=phoneTargetEnabled();
  if(!targetRefreshQueued){targetRefreshQueued=true;queueMicrotask(()=>{targetRefreshQueued=false;refreshTargets().catch(()=>{})})}
  return `<div class="m-section"><h2 class="m-caption">提醒设备</h2></div><div class="surface reminder-targets" data-reminder-targets>`
   +`<p class="helper reminder-targets-intro">分别控制提醒发到手机、智能药盒或手表；未连接或不支持的设备不能开启。</p>`
   +targetRow('phone')+targetRow('pillbox')+targetRow('watch')+`</div>`;
 }
 window.reminderTargetsHTML=reminderTargetsHTML;
 const paintTargets=()=>{const box=document.querySelector('[data-reminder-targets]');if(!box)return;box.innerHTML=`<p class="helper reminder-targets-intro">分别控制提醒发到手机、智能药盒或手表；未连接或不支持的设备不能开启。</p>${targetRow('phone')}${targetRow('pillbox')}${targetRow('watch')}`};
 const updateWatchStatus=s=>{targets.watch.status=s||null;targets.watch.available=!!(s?.paired&&s?.authenticated);targets.watch.enabled=targets.watch.available&&!!(s.targetEnabled??s.enabled);targets.watch.note=s?.targetPending?('设置尚未完成'+(s.targetError?' · '+s.targetError:'')):targets.watch.available?(targets.watch.enabled?'已连接 · 到点会提醒':'已连接，提醒已关闭'):targetUnavailableText('watch',s);paintTargets()};
 const updatePillboxStatus=s=>{s=window.pillboxReminderState?.(s)||s;targets.pillbox.status=s||null;targets.pillbox.available=!!s?.connected&&s?.reminderConfigured!==false;targets.pillbox.enabled=!!s?.connected&&s.reminderEnabled!==false;targets.pillbox.note=s?.connected&&s?.reminderConfigured===false?'未配置药盒提醒计划':targets.pillbox.available?(targets.pillbox.enabled?'已连接 · 会按下发的计划提醒':'已连接，提醒已关闭'):targetUnavailableText('pillbox',s);paintTargets()};
 async function refreshTargets(){
  if(targetRefreshPromise)return targetRefreshPromise;
  targetRefreshPromise=(async()=>{
   targets.phone.enabled=phoneTargetEnabled();
   /* Native watch status is authoritative; there is no browser watch fallback. */
   if(window.AndroidApp?.watch){
    try{updateWatchStatus(await AndroidApp.watch('status'))}catch{updateWatchStatus(null)}
   }else updateWatchStatus(null);
   /* DeviceBridge status is a real reply in both Android and Web Bluetooth paths. */
   if(window.DeviceBridge?.call){
    try{updatePillboxStatus(await DeviceBridge.call('hipeeStatus',null,{target:'pillbox'}))}catch{updatePillboxStatus(null)}
   }else updatePillboxStatus(null);
   paintTargets();
  })().finally(()=>{targetRefreshPromise=null});
  return targetRefreshPromise;
 }
 window.refreshReminderTargets=refreshTargets;
 window.addEventListener('anyao-pillbox-status',e=>updatePillboxStatus(e.detail));
 window.addEventListener('anyao-pillbox-push',()=>{if(document.querySelector('[data-reminder-targets]'))refreshTargets().catch(()=>{})});
 window.addEventListener('anyao-watch-status',e=>updateWatchStatus(e.detail));

 const allProfiles=()=>M.profiles(state.settings.reminderProfiles||{});
 const currentIntensity=()=>{
  const profiles=allProfiles();
  return Object.keys(INTENSITY).find(id=>M.keys.every(k=>{const e=profiles[k],p=INTENSITY[id];return e.level===p.level[k]&&e.pulseMs===p.pulseMs&&e.intervalMs===p.intervalMs&&e.repeats===p.repeats&&M.curve(e)===p.curve}))||'';
 };
 const soundState=()=>timing?.quiet&&state.settings.sound?'手机勿扰已开启，到点不响铃，震动和闪光照常。':state.settings.sound&&timing?.ringerMode!==undefined&&timing.ringerMode!==2?'手机处于静音或震动模式，声音提醒暂不执行。':state.settings.sound&&timing?.alarmVolume===0?'手机闹钟音量为零，声音提醒暂不执行。':'';
 const readinessSummary=()=>!timing?'检查后台提醒权限':!timing.notificationsAllowed||!timing.exactAllowed||!timing.batteryUnrestricted||timing.backgroundRestricted?'后台提醒需要完善权限':'后台提醒已就绪';

 function reminderSectionHTML(){
  const switches=CHANNELS.map(([k,label])=>`<button type="button" class="setting-row" data-action="toggle" data-id="${k}" aria-pressed="${!!state.settings[k]}" ${pendingSettings.has(k)?'disabled aria-busy="true"':''}><span>${label}<small>${pendingSettings.has(k)?'保存中…':state.settings[k]?'已开启':'已关闭'}</small></span><span class="switch ${state.settings[k]?'on':''}" aria-hidden="true"></span></button>`).join('');
  const warning=soundState();
  return reminderTargetsHTML()+`<div class="m-section"><h2 class="m-caption">手机提醒方式</h2></div><div class="surface">${switches}</div>`
   +`<div class="m-section"><h2 class="m-caption">手机提醒力度</h2></div>${segmented('reminder-intensity',currentIntensity(),INTENSITY_OPTIONS)}`
   +`<p class="helper">力度只对手机上的四种提醒方式生效；没按时吃药时会按同样的力度再提醒一次。</p>`
   +`<p class="reminder-system-warning" role="status">${esc(warning)}</p>`
   +`<div class="surface">`
    +`<button type="button" class="menu-row" data-action="reminder-test"><span class="row-body"><strong>试一下提醒</strong><small>按现在的方式和力度提醒一次</small></span><span class="arrow" aria-hidden="true"></span></button>`
    +(window.AndroidApp
     ?`<button type="button" class="menu-row" data-action="reminder-background"><span class="row-body"><strong>后台提醒保障</strong><small>${esc(readinessSummary())}</small></span><span class="arrow" aria-hidden="true"></span></button>`
     :`<button type="button" class="menu-row" data-action="sync-settings"><span class="row-body"><strong>系统通知</strong><small data-notify-state>${esc(window.Reminders?.permissionLabel()||'')}</small></span><span class="arrow" aria-hidden="true"></span></button>`)
   +`</div>`;
 }
 window.reminderSectionHTML=reminderSectionHTML;
 /* 今天页的提醒保障提示：登记了按时吃的药，但通知被关或系统不允许准时提醒时，到点可能不响或晚响 */
 const reminderBlocked=()=>!!(window.AndroidApp&&timing&&state.drugs.some(d=>!d.asNeeded)&&(!timing.notificationsAllowed||!timing.exactAllowed));
 window.reminderBlockedHTML=()=>reminderBlocked()?`<button type="button" class="surface notice" data-reminder-blocked data-action="reminder-background">${icon('clock')}<span>${!timing.notificationsAllowed?'通知被关了，到点不会提醒。':'还没允许“准时提醒”，到点可能晚几分钟。'}轻点去打开</span></button>`:'';

 /* 开关注与力度都是就地重绘：保存时只把这些控件标成保存中，不动整页。 */
 const paintChannels=()=>{
  for(const [k] of CHANNELS){
   const busy=pendingSettings.has(k),on=!!state.settings[k];
   paintSwitchRow('toggle',k,on,busy?'保存中…':on?'已开启':'已关闭');
   document.querySelector(`[data-action="toggle"][data-id="${k}"]`)?.toggleAttribute('disabled',busy);
  }
  targets.phone.enabled=phoneTargetEnabled();paintTargets();
 };
 const paintIntensity=()=>{
  paintSegmented('reminder-intensity',currentIntensity());
  const busy=pendingSettings.size>0;
  document.querySelectorAll('[data-action="reminder-intensity"]').forEach(b=>b.toggleAttribute('disabled',busy));
 };

 /* 后台提醒保障（安卓）：权限、准时提醒、电池与自启动。 */
 function readinessBody(){
  const guide=timing?.deviceGuide||{name:'Android',instruction:'在安药的应用设置中允许后台运行；如有自启动或自动休眠设置，请允许安药并排除休眠。'};
  const step=(name,allowed,description,action,label)=>`<section class="readiness-step"><div class="readiness-step-heading"><h3>${name}</h3><span class="readiness-state ${allowed?'ready':'needed'}">${allowed?'已开启':'待设置'}</span></div><p class="helper">${description}</p><button type="button" class="secondary-btn" data-action="${action}">${label}</button></section>`;
  return `<p class="helper">完成以下设置，让手机在退出安药后继续按计划提醒。</p><div class="surface reminder-target-card">${step('通知权限',timing?.notificationsAllowed,'显示用药提醒，点击后返回安药。','reminder-notification-settings','设置通知权限')}${step('准时提醒',timing?.exactAllowed,'允许系统在用药时间准时唤起提醒。','reminder-timing-permission','设置准时提醒')}${step('电池与后台',timing?.batteryUnrestricted&&!timing?.backgroundRestricted,'解除系统电池优化，允许后台运行。','reminder-battery-settings','允许后台运行')}</div><div class="surface reminder-target-card"><span class="reminder-target-badge">${esc(guide.name)} 设置指引</span><h3>自启动与休眠设置</h3><p class="helper">${esc(guide.instruction)}</p><button type="button" class="secondary-btn" data-action="${guide.autostartSettings?'reminder-autostart-settings':'reminder-app-settings'}">${guide.autostartSettings?'设置后台自启动':'打开安药系统设置'}</button></div><button type="button" class="secondary-btn" data-action="reminder-background">重新检查权限</button>`;
 }
 const paintReadiness=()=>panel('后台提醒保障',readinessBody());
 window.addEventListener('anyao-reminder-status',e=>{
  timing=e.detail;window.reminderTiming=timing;
  const blocked=document.querySelector('[data-reminder-blocked]');if(blocked&&!reminderBlocked())blocked.remove();
  if(!blocked&&reminderBlocked()&&state.tab==='today')document.querySelector('#view .take-card')?.insertAdjacentHTML('beforebegin',reminderBlockedHTML());
  const link=document.querySelector('[data-action="reminder-background"] small');if(link)link.textContent=readinessSummary();
  const warning=document.querySelector('.reminder-system-warning');if(warning)warning.textContent=soundState();
  if(document.querySelector('dialog[open] .readiness-step'))paintReadiness();
 });

 const baseDispatch=dispatchAction;
 dispatchAction=async function(a,id,el){
  if(a==='reminder-target-toggle'){
   if(targetBusy||pendingSettings.size||!Object.hasOwn(targets,id))return;
   targetBusy=id;paintTargets();
   try{
    /* Re-read before writes: connection state may have changed after rendering. */
    await refreshTargets();
    if(id==='phone')state.settings=await api('settings');
    const t=targets[id];if(id==='phone')t.enabled=phoneTargetEnabled();
    if(!t.available)return toast(t.note||'设备当前不可用');
    const next=!t.enabled;
    if(id==='phone'){
     const before=Object.fromEntries(M.keys.map(k=>[k,!!state.settings[k]]));
     const remembered=targetPrefs.phoneChannels;
     const wanted=next&&remembered&&M.keys.some(k=>remembered[k])?Object.fromEntries(M.keys.map(k=>[k,!!remembered[k]])):Object.fromEntries(M.keys.map(k=>[k,next]));
     state.settings=await send('settings',{...wanted,target:'phone'},'PATCH');
     if(!next)targetPrefs.phoneChannels=before;
     saveTargetPrefs();paintChannels();
    }else if(id==='watch'){
     const r=await AndroidApp.watch('target-configure',{enabled:next});
     updateWatchStatus(r);
     if(r?.targetEnabled!==next||r?.targetPending!==false)throw Error(r?.targetError||'手表提醒设置尚未完成，请重试');
     window.dispatchEvent(new CustomEvent('anyao-watch-status',{detail:r}));
    }else{
     if(typeof window.setPillboxReminderEnabled!=='function')throw Error('药盒提醒设置尚未载入，请稍后重试');
     await window.setPillboxReminderEnabled(next);
     await refreshTargets();
    }
    toast(targetLabel[id]+(next?'已开启':'已关闭'));
   }catch(error){await refreshTargets().catch(()=>{});throw error}
   finally{targetBusy='';targets.phone.enabled=phoneTargetEnabled();paintTargets()}
   return;
  }
  if(a==='toggle'){
   if(targetBusy||pendingSettings.size)return;
   const before=!!state.settings[id];pendingSettings.add(id);state.settings[id]=!before;
   try{
    paintChannels();
    state.settings=await send('settings',{[id]:!before,target:'phone'},'PATCH');
    toast((reminderLabels[id]||'提醒')+(state.settings[id]?'已开启':'已关闭'));
   }catch(error){state.settings[id]=before;throw error}
   finally{pendingSettings.delete(id);paintChannels()}
   return;
  }
  if(a==='reminder-intensity'){
   const preset=INTENSITY[id];
   if(!preset||targetBusy||pendingSettings.size)return;
   const profiles=allProfiles();
   for(const k of M.keys)profiles[k]={...profiles[k],level:preset.level[k],pulseMs:preset.pulseMs,intervalMs:preset.intervalMs,repeats:preset.repeats,ramp:false,curve:preset.curve};
   M.keys.forEach(k=>pendingSettings.add(k));paintIntensity();
   try{
    state.settings=await send('settings',{reminderProfiles:profiles,target:'phone'},'PATCH');
    toast('提醒力度已设为'+preset.name);
   }finally{M.keys.forEach(k=>pendingSettings.delete(k));paintIntensity()}
   return;
  }
  if(a==='reminder-test'){if(!window.Reminders)return toast('提醒模块未载入');if(window.Reminders.canAsk())await window.Reminders.ask();const n=document.querySelector('[data-notify-state]');if(n)n.textContent=window.Reminders.permissionLabel();return window.Reminders.test()}
  if(a==='reminder-background'){const r=window.AndroidApp?await AndroidApp.reminderStatus():null;timing=r?.body;paintReadiness();return}
  if(a==='reminder-notification-settings'){if(!window.AndroidApp)return toast('请在安卓应用中设置');const r=await AndroidApp.reminderPermissions();timing=r.body;await AndroidApp.reminderNotificationSettings();return}
  if(a==='reminder-battery-settings'){if(window.AndroidApp)await AndroidApp.reminderBatterySettings();else toast('请在安卓应用中设置');return}
  if(a==='reminder-app-settings'){if(window.AndroidApp)await AndroidApp.reminderAppSettings();else toast('请在安卓应用中设置');return}
  if(a==='reminder-autostart-settings'){if(window.AndroidApp)await AndroidApp.reminderAutostartSettings();else toast('请在安卓应用中设置');return}
  if(a==='reminder-timing-permission'){if(window.AndroidApp)await AndroidApp.reminderTimingPermission();else toast('请在安卓应用中设置');return}
  return baseDispatch(a,id,el);
 };
})();
