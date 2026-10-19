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

 const allProfiles=()=>M.profiles(state.settings.reminderProfiles||{});
 const currentIntensity=()=>{
  const profiles=allProfiles();
  return Object.keys(INTENSITY).find(id=>M.keys.every(k=>{const e=profiles[k],p=INTENSITY[id];return e.level===p.level[k]&&e.pulseMs===p.pulseMs&&e.intervalMs===p.intervalMs&&e.repeats===p.repeats&&M.curve(e)===p.curve}))||'';
 };
 const soundState=()=>timing?.quiet?'手机勿扰已开启，请检查系统是否允许用药闹钟和震动。':state.settings.vibration&&timing?.notificationVibrationAllowed===false?'系统未允许通知震动，请检查声音与振动中的“响铃时振动”。':state.settings.sound&&timing?.ringerMode!==undefined&&timing.ringerMode!==2?'手机处于静音或震动模式，声音提醒暂不执行。':state.settings.sound&&timing?.alarmVolume===0?'手机闹钟音量为零，声音提醒暂不执行。':'';
 const readinessSummary=()=>!timing?'检查后台提醒权限':!timing.notificationsAllowed||!timing.exactAllowed||!timing.batteryUnrestricted||timing.backgroundRestricted?'后台提醒需要完善权限':'系统权限已开启，还需核对自启动并测试锁屏提醒';

 function reminderSectionHTML(){
  const switches=CHANNELS.map(([k,label])=>`<button type="button" class="setting-row" data-action="toggle" data-id="${k}" aria-pressed="${!!state.settings[k]}" ${pendingSettings.has(k)?'disabled aria-busy="true"':''}><span>${label}<small>${pendingSettings.has(k)?'保存中…':state.settings[k]?'已开启':'已关闭'}</small></span><span class="switch ${state.settings[k]?'on':''}" aria-hidden="true"></span></button>`).join('');
  const warning=soundState();
  return `<div class="m-section"><h2 class="m-caption">提醒方式</h2></div><div class="surface">${switches}</div>`
   +`<div class="m-section"><h2 class="m-caption">提醒力度</h2></div>${segmented('reminder-intensity',currentIntensity(),INTENSITY_OPTIONS)}`
   +`<p class="helper">档位同时调整四种提醒的节奏；闪光灯亮度由系统控制。没按时吃药时会按同样的方式再提醒一次。</p>`
   +`<p class="reminder-system-warning" role="status">${esc(warning)}</p>`
   +(window.RepairApi?`<button type="button" class="secondary-btn" data-action="reminder-sound-settings">检查系统声音与振动</button>`:'')
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
  const vendorBattery=window.RepairApi&&timing?.vendorBatteryAvailable?`<p class="helper">进入电池 → 后台耗电管理 → 安药，选择允许后台耗电；使用验证版时选择安药验证。</p><button type="button" class="secondary-btn" data-action="reminder-vendor-battery-settings">设置厂商后台耗电</button>`:'';
  return `<p class="helper">完成以下设置后，请保持锁屏测试到点提醒。</p><div class="surface reminder-target-card">${step('通知权限',timing?.notificationsAllowed,'显示用药提醒，点击后返回安药。','reminder-notification-settings','设置通知权限')}${step('准时提醒',timing?.exactAllowed,'允许系统在用药时间准时唤起提醒。','reminder-timing-permission','设置准时提醒')}${step('系统电池优化',timing?.batteryUnrestricted&&!timing?.backgroundRestricted,'解除系统电池优化；厂商后台耗电管理需要另行设置。','reminder-battery-settings','设置电池优化豁免')}</div><div class="surface reminder-target-card"><span class="reminder-target-badge">${esc(guide.name)} 设置指引</span><h3>自启动与休眠设置</h3><p class="helper">${esc(guide.instruction)}</p><button type="button" class="secondary-btn" data-action="${guide.autostartSettings?'reminder-autostart-settings':'reminder-app-settings'}">${guide.autostartSettings?'设置后台自启动':'打开安药系统设置'}</button>${vendorBattery}</div><button type="button" class="secondary-btn" data-action="reminder-background">重新检查权限</button>`;
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
  if(a==='toggle'){
   if(pendingSettings.has(id))return;
   const before=!!state.settings[id];pendingSettings.add(id);state.settings[id]=!before;
   try{
    if(id==='flash'&&!before&&window.RepairApi){
     const permission=await AndroidApp.reminderCameraPermission();
     if(!permission.cameraAllowed)throw Error('未允许相机权限，闪光提醒没有开启；可在系统应用权限中允许相机');
    }
    paintChannels();
    state.settings=await send('settings',{[id]:!before,target:'phone'},'PATCH');
    toast((reminderLabels[id]||'提醒')+(state.settings[id]?'已开启':'已关闭'));
   }catch(error){state.settings[id]=before;throw error}
   finally{pendingSettings.delete(id);paintChannels()}
   return;
  }
  if(a==='reminder-intensity'){
   const preset=INTENSITY[id];
   if(!preset||pendingSettings.size)return;
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
  if(a==='reminder-sound-settings'){window.RepairApi?.openSoundSettings();return}
  if(a==='reminder-vendor-battery-settings'){window.RepairApi?.openVendorBatterySettings();return}
  if(a==='reminder-background'){const r=window.AndroidApp?await AndroidApp.reminderStatus():null;timing=r?.body;paintReadiness();return}
  if(a==='reminder-notification-settings'){if(!window.AndroidApp)return toast('请在安卓应用中设置');const r=await AndroidApp.reminderPermissions();timing=r.body;await AndroidApp.reminderNotificationSettings();return}
  if(a==='reminder-battery-settings'){if(window.AndroidApp)await AndroidApp.reminderBatterySettings();else toast('请在安卓应用中设置');return}
  if(a==='reminder-app-settings'){if(window.AndroidApp)await AndroidApp.reminderAppSettings();else toast('请在安卓应用中设置');return}
  if(a==='reminder-autostart-settings'){if(window.RepairApi&&timing?.vendorAutostartAvailable)RepairApi.openAutostartSettings();else if(window.AndroidApp)await AndroidApp.reminderAutostartSettings();else toast('请在安卓应用中设置');return}
  if(a==='reminder-timing-permission'){if(window.AndroidApp)await AndroidApp.reminderTimingPermission();else toast('请在安卓应用中设置');return}
  return baseDispatch(a,id,el);
 };
})();
