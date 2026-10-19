/* Tap switches immediately; hold opens a draft editor. Profiles save explicitly. */
(() => {
 const M=ReminderModel;
 const titles={vibration:'震动',sound:'声音',flash:'指示灯',phone:'通知'};
 const targetNames={phone:'手机',pillbox:'智能药盒',wearable:'穿戴设备'};
 let target='phone',wearableStatus=null,checkingWearable=false,wearablePreviewing=false,timing=null,pillboxStatus=null,checkingPillbox=false,pillboxBusy=false;
 const picker=()=>`<div class="reminder-targets" role="group" aria-label="提醒对象">${M.targets.map(k=>`<button type="button" data-action="reminder-target" data-id="${k}" aria-pressed="${target===k}">${targetNames[k]}</button>`).join('')}</div>`;
 function externalBody(){
  if(target==='pillbox')return pillboxBody();
  const s=wearableStatus,c=s?.controls||{},connected=s?.connected===true;
  return `<section class="surface reminder-target-card" data-reminder-target="wearable"><span class="reminder-target-badge">穿戴设备</span><h3>${esc(connected?s.name:'连接你的手表或手环')}</h3><p class="helper" role="status">${checkingWearable?'正在检查设备…':!window.WearableReminders?'请在安卓应用中连接设备':s?.error?esc(s.error):!connected?'尚未连接':c.find||c.message?'已连接 · 可使用以下设备提醒':'已连接 · 当前设备未开放提醒控制'}</p><div class="action-grid"><button type="button" data-action="wearable-reminder-preview" data-id="find" ${!connected||!c.find||checkingWearable||wearablePreviewing?'disabled':''}>查找设备</button><button type="button" data-action="wearable-reminder-preview" data-id="message" ${!connected||!c.message||checkingWearable||wearablePreviewing?'disabled':''}>推送测试消息</button></div><p class="helper">震动与声音由穿戴设备自身支持的提醒方式决定。</p><button type="button" class="secondary-btn" data-action="wearable">管理穿戴设备</button></section>`;
 }
 async function readPillbox(){if(checkingPillbox)return;checkingPillbox=true;redrawTarget();try{pillboxStatus=window.PillboxReminders?await window.PillboxReminders.status():null}catch(e){pillboxStatus={connected:false,error:e.message}}finally{checkingPillbox=false;if(target==='pillbox')redrawTarget()}}
 function pillboxBody(){
  const p=pillboxStatus,connected=p?.connected===true,open=p?.open===true,box=p?.supported===true;
  const title=!window.PillboxReminders?'请在安卓应用中连接药盒':checkingPillbox?'正在检查药盒…':p?.error?esc(p.error):!connected?'连接 HiPee 智能药盒':open?'药盒已连接 · 提醒将下给药盒':box?'药盒已连接，指令会话未打开':'当前设备不是 HiPee 药盒';
  const hint=!window.PillboxReminders?'药盒提醒需要在安药 Android 应用中通过蓝牙连接 HiPee 药盒后使用。':!connected?'连接药盒后，可把服药计划下发给药盒，药盒会上报服药记录。':open?'服药计划会下发给药盒提醒；药盒上报的已服记录会自动标记今日服药并扣减库存。':'请在“管理药盒与穿戴设备”中打开药盒指令会话。';
  return `<section class="surface reminder-target-card" data-reminder-target="pillbox"><span class="reminder-target-badge">智能药盒</span><h3>${title}</h3><p class="helper" role="status">${hint}</p>${connected&&open?`<div class="action-grid"><button type="button" data-action="pillbox-push" ${pillboxBusy?'disabled':''}>${pillboxBusy?'正在下发…':'下发服药计划'}</button><button type="button" data-action="pillbox-sync" ${pillboxBusy?'disabled':''}>同步服药记录</button></div>`:''}<button type="button" class="secondary-btn" data-action="wearable">管理药盒与穿戴设备</button></section>`;
 }
 const phoneQuick=reminderQuickHTML;
 const readinessSummary=()=>!timing?'开通手机后台提醒':!timing.notificationsAllowed||!timing.exactAllowed||!timing.batteryUnrestricted||timing.backgroundRestricted?'后台提醒 · 需完善权限':'后台提醒 · 检查自启动';
 reminderQuickHTML=()=>`<div class="section-heading reminder-target-heading"><h2>提醒对象</h2><span class="note">当前：${targetNames[target]}</span></div>${picker()}${target==='phone'?`<div data-reminder-target="phone">${phoneQuick().replaceAll('指示灯','闪光')}${window.AndroidApp?`<button type="button" class="reminder-readiness-link" data-action="reminder-background">${readinessSummary()}<span aria-hidden="true">›</span></button>`:''}</div>`:externalBody()}`;
 function readinessBody(){
  const guide=timing?.deviceGuide||{name:'Android',instruction:'在安药的应用设置中允许后台运行；如有自启动或自动休眠设置，请允许安药并排除休眠。'};
  const step=(name,allowed,description,action,label)=>`<section class="readiness-step"><div class="readiness-step-heading"><h3>${name}</h3><span class="readiness-state ${allowed?'ready':'needed'}">${allowed?'已开启':'待设置'}</span></div><p class="helper">${description}</p><button type="button" class="secondary-btn" data-action="${action}">${label}</button></section>`;
  return `<div class="reminder-readiness"><p class="helper">完成以下设置，让手机在退出安药后继续按计划提醒。</p><div class="surface reminder-target-card">${step('通知权限',timing?.notificationsAllowed,'显示用药提醒，点击后返回安药。','reminder-notification-settings','设置通知权限')}${step('准时提醒',timing?.exactAllowed,'允许系统在用药时间唤起提醒。','reminder-timing-permission','设置准时提醒权限')}${step('电池与后台',timing?.batteryUnrestricted&&!timing?.backgroundRestricted,'解除系统电池优化，允许后台运行。','reminder-battery-settings','允许后台运行')}</div><div class="surface reminder-target-card"><span class="reminder-target-badge">${esc(guide.name)} 设置指引</span><h3>自启动与休眠设置</h3><p class="helper">${esc(guide.instruction)}</p><p class="helper">这项设置请在系统中确认；更新或重装后建议重新检查。</p><button type="button" class="secondary-btn" data-action="${guide.autostartSettings?'reminder-autostart-settings':'reminder-app-settings'}">${guide.autostartSettings?'设置后台自启动':'打开安药系统设置'}</button></div><button type="button" class="secondary-btn" data-action="reminder-background">重新检查权限</button><p class="helper">普通清除最近任务后，提醒由系统继续调度。系统“强行停止”会暂停提醒，重新打开安药后恢复。声音和震动仍遵循静音、勿扰设置。</p></div>`;
 }
 const paintReadiness=()=>panel('后台提醒保障','作用对象：手机',readinessBody());
 window.addEventListener('anyao-reminder-status',e=>{timing=e.detail;if(document.querySelector('dialog[open] .reminder-readiness'))paintReadiness();const link=document.querySelector('.reminder-readiness-link');if(link)link.innerHTML=readinessSummary()+'<span aria-hidden="true">›</span>'});
 const timingHint=()=>`<p class="helper reminder-duration">手机定时提醒 · ${timing?.exactAllowed?'已开启准时提醒':'请开启准时提醒权限，避免系统延后'}。</p>${window.AndroidApp&&!timing?.exactAllowed?'<button type="button" class="secondary-btn" data-action="reminder-timing-permission">开启手机准时提醒</button>':''}`;
 function redrawTarget(){render();if(document.querySelector('#detail-dialog').open&&panelNavigation.current?.route?.[0]==='reminders')panel('提醒设置','分别管理每个设备的提醒',settingsHTML())}
 async function readWearable(){if(checkingWearable)return;checkingWearable=true;redrawTarget();try{wearableStatus=window.WearableReminders?await window.WearableReminders.status():null}catch(e){wearableStatus={connected:false,error:e.message}}finally{checkingWearable=false;if(target==='wearable')redrawTarget()}}
 const originalControl=reminderControl,originalDispatch=dispatchAction;
 let draft=null,ruleDraft=null,selected='level',capabilities={},saving=false,previewing=false;
 const copy=x=>JSON.parse(JSON.stringify(x));
 const allProfiles=()=>M.profiles(state.settings.reminderProfiles||{});
 const fields=kind=>kind==='flash'?[['pulseMs','亮灯时长',100,2000,100,'毫秒'],['intervalMs','闪烁间隔',100,5000,100,'毫秒'],['repeats','闪烁次数',1,10,1,'次']]:kind==='phone'?[['level','通知优先级',1,100,1,''],['intervalMs','再次提示间隔',100,5000,100,'毫秒'],['repeats','提示次数',1,10,1,'次']]:[['level',kind==='sound'?'音量':'震动强度',1,100,1,'%'],['pulseMs',kind==='sound'?'每次响铃':'每次震动',100,2000,100,'毫秒'],['intervalMs','间隔',100,5000,100,'毫秒'],['repeats','次数',1,10,1,'次']];
 const current=()=>ruleDraft?ruleDraft.effect:draft.profile;
 const spec=()=>fields(draft.kind).find(x=>x[0]===selected)||fields(draft.kind)[0];
 const display=(key,v)=>key==='level'&&draft.kind==='phone'?(v<34?'静默':v<67?'普通':'醒目'):key.endsWith('Ms')?(v/1000).toFixed(1)+' 秒':key==='repeats'?v+' 次':v+'%';
 function capabilityText(){const k=draft.kind;if(!window.AndroidApp)return '浏览器可编辑设置，请在安卓手机上试听或试震。';if(k==='vibration')return capabilities.amplitudeControl===false?'本机支持震动节奏；强度与渐强由系统决定。':'拖动旋钮调节强度，点击“试一下”感受效果。';if(k==='flash')return capabilities.torch===false?'本机未检测到闪光灯。':'使用手机闪光灯；首次试用需要相机权限。';if(k==='sound')return '使用手机闹钟声音；音量受系统闹钟音量、静音和勿扰设置限制。';return '优先级仍受系统通知权限和渠道设置约束。'}
 function editorBody(){const p=current(),f=spec();return `<div class="reminder-editor" data-kind="${draft.kind}" data-reminder-target="phone"><p class="reminder-target-badge">作用对象：手机</p>
  ${!ruleDraft?`<button type="button" class="setting-row editor-switch" data-action="toggle" data-id="${draft.kind}" aria-pressed="${!!state.settings[draft.kind]}"><span>${titles[draft.kind]}提醒</span><span class="switch ${state.settings[draft.kind]?'on':''}"></span></button>`:''}
  <div class="reminder-presets" aria-label="快捷预设">${[['gentle','轻柔'],['standard','标准'],['strong','醒目']].map(([id,l])=>`<button type="button" data-action="reminder-preset" data-id="${id}">${l}</button>`).join('')}</div>
  <div class="dial-tabs">${fields(draft.kind).map(([k,label])=>`<button type="button" class="${selected===k?'selected':''}" data-action="reminder-field" data-id="${k}">${label}</button>`).join('')}</div>
  <div class="dial-stage"><div class="reminder-dial" tabindex="0" role="slider" aria-label="${f[1]}" aria-valuemin="${f[2]}" aria-valuemax="${f[3]}" aria-valuenow="${p[f[0]]}" aria-valuetext="${display(f[0],p[f[0]])}" style="--dial-progress:${(p[f[0]]-f[2])/(f[3]-f[2])*360}deg"><div><small>${f[1]}</small><strong>${display(f[0],p[f[0]])}</strong><span>沿圆环拖动调节</span></div></div>${!ruleDraft?'<button type="button" class="dial-plus" data-action="reminder-rule-new" aria-label="添加定时规则">＋</button>':''}</div>
  <div class="dial-stepper"><button type="button" data-action="reminder-step" data-id="-1" aria-label="减少">−</button><label>精确数值<input id="reminder-exact" type="number" min="${f[2]}" max="${f[3]}" step="${f[4]}" value="${p[f[0]]}" aria-label="${f[1]}精确数值"></label><button type="button" data-action="reminder-step" data-id="1" aria-label="增加">＋</button></div>
  <div class="effect-summary">${fields(draft.kind).map(([k,l])=>`<span>${l}<b data-effect-value="${k}">${display(k,p[k])}</b></span>`).join('')}</div>
  ${['vibration','sound'].includes(draft.kind)?`<button type="button" class="setting-row" data-action="reminder-ramp" aria-pressed="${p.ramp}"><span>${draft.kind==='sound'?'声音逐渐增强':'震动逐渐增强'}</span><span class="switch ${p.ramp?'on':''}"></span></button>`:''}
  ${ruleDraft?`<label class="form-field">提醒时间<input type="time" id="reminder-rule-time" value="${ruleDraft.time}"></label><div class="weekday-picker" aria-label="重复日期">${['一','二','三','四','五','六','日'].map((l,i)=>`<button type="button" data-action="reminder-day" data-id="${i+1}" aria-pressed="${ruleDraft.days.includes(i+1)}" class="${ruleDraft.days.includes(i+1)?'selected':''}">${l}</button>`).join('')}</div>`:`<div class="section-heading"><h3>定时规则</h3><button type="button" data-action="reminder-rule-new">＋ 添加</button></div><div class="reminder-rules">${draft.profile.rules.map(r=>`<div class="reminder-rule"><button type="button" data-action="reminder-rule-edit" data-id="${r.id}"><strong>${r.time}</strong><small>${r.days.length===7?'每天':'周'+r.days.map(d=>['一','二','三','四','五','六','日'][d-1]).join('、')} · ${display(fields(draft.kind)[0][0],r.effect[fields(draft.kind)[0][0]])}</small></button><button type="button" data-action="reminder-rule-toggle" data-id="${r.id}" aria-label="${r.enabled?'停用':'启用'}定时规则" aria-pressed="${r.enabled}"><span class="switch ${r.enabled?'on':''}"></span></button></div>`).join('')||'<p class="empty">在指定时间，按你设定的节奏提醒。</p>'}</div>`}
  <p class="helper reminder-capability" role="status">${capabilityText()}</p><p class="helper">每次最长 8 秒。</p>${timingHint()}
  <div class="reminder-actions"><button type="button" class="secondary-btn" data-action="reminder-preview" ${previewing?'disabled':''}>${previewing?'正在预览…':'试一下'}</button><button type="button" class="primary" data-action="${ruleDraft?'reminder-rule-save':'reminder-save'}" ${saving?'disabled':''}>${saving?'正在保存…':ruleDraft?'使用此规则':'保存设置'}</button></div>
  ${ruleDraft?.existing?'<button type="button" class="secondary-btn" data-action="reminder-rule-delete">删除这条规则</button>':''}
 </div>`}
 function paint(){if(!draft)return;panel(ruleDraft?'定时'+titles[draft.kind]:titles[draft.kind]+'自定义',ruleDraft?'选择时间、日期和提醒节奏':'作用于手机 · 自定义你的节奏',editorBody())}
 reminderControl=function(kind){if(!M.keys.includes(kind))return originalControl(kind);target="phone";draft={kind,profile:copy(allProfiles()[kind])};ruleDraft=null;selected=fields(kind)[0][0];paint();window.AndroidApp?.reminderStatus().then(r=>{timing=r.body;if(draft?.kind===kind&&document.querySelector(".reminder-editor"))paint()}).catch(()=>{});window.AndroidApp?.reminderCapabilities().then(r=>{capabilities=r.body;const el=document.querySelector('.reminder-capability');if(el&&draft?.kind===kind)el.textContent=capabilityText()}).catch(()=>{})};
 const originalRefresh=refreshReminderPanel;
 refreshReminderPanel=function(){if(draft && document.querySelector('#detail-dialog').open && document.querySelector('.reminder-editor')){const b=document.querySelector('.editor-switch');if(b){b.setAttribute('aria-pressed',!!state.settings[draft.kind]);b.querySelector('.switch').classList.toggle('on',!!state.settings[draft.kind]);}return}originalRefresh()};
 const originalSettings=settingsHTML;
 settingsHTML=()=>picker()+(target!=="phone"?externalBody():`<p class="reminder-target-badge">作用对象：手机</p>`+originalSettings().replace("指示灯偏好","手机闪光")+`<button type="button" class="secondary-btn" data-action="reminder-background">后台提醒保障</button><div class="section-heading"><h2>自定义提醒</h2></div><div class="surface">${M.keys.map(k=>row(titles[k]+'自定义','旋钮、节奏与定时规则','gear',`data-action="reminder-control" data-id="${k}"`)).join('')}</div>`);
 function rememberTime(){const input=document.querySelector('#reminder-rule-time');if(ruleDraft&&input)ruleDraft.time=input.value}
 function setValue(value){const f=spec();current()[f[0]]=Math.max(f[2],Math.min(f[3],Math.round(value/f[4])*f[4]));const d=document.querySelector('.reminder-dial');if(!d)return;d.style.setProperty('--dial-progress',(current()[f[0]]-f[2])/(f[3]-f[2])*360+'deg');const input=document.querySelector('#reminder-exact');if(input)input.value=current()[f[0]];d.setAttribute('aria-valuenow',current()[f[0]]);d.setAttribute('aria-valuetext',display(f[0],current()[f[0]]));d.querySelector('strong').textContent=display(f[0],current()[f[0]]);document.querySelector(`[data-effect-value="${f[0]}"]`).textContent=display(f[0],current()[f[0]])}
 dispatchAction=async function(a,id){
  if(a==='reminder-background'){
   const r=window.AndroidApp?await AndroidApp.reminderStatus():null;timing=r?.body;
   paintReadiness();return
  }
  if(a==='reminder-notification-settings'){if(window.AndroidApp){const r=await AndroidApp.reminderPermissions();timing=r.body;await AndroidApp.reminderNotificationSettings()}else toast('请在安卓应用中设置');return}
  if(a==='reminder-battery-settings'){if(window.AndroidApp)await AndroidApp.reminderBatterySettings();else toast('请在安卓应用中设置');return}
  if(a==='reminder-app-settings'){if(window.AndroidApp)await AndroidApp.reminderAppSettings();else toast('请在安卓应用中设置');return}
  if(a==='reminder-autostart-settings'){if(window.AndroidApp)await AndroidApp.reminderAutostartSettings();else toast('请在安卓应用中设置');return}
  if(a==='reminder-target'){if(!M.targets.includes(id))return;target=id;draft=null;ruleDraft=null;redrawTarget();if(id==='wearable')await readWearable();if(id==='pillbox')await readPillbox();return}
  if(a==='reminder-timing-permission'){if(!window.AndroidApp)return;await AndroidApp.reminderTimingPermission();return}
  if(a==='wearable-reminder-preview'){
   if(target!=='wearable'||wearablePreviewing)return;await readWearable();if(target!=='wearable')return;
   if(!wearableStatus?.connected||!wearableStatus.controls?.[id])throw Error('当前穿戴设备不支持此提醒');
   wearablePreviewing=true;redrawTarget();try{const result=await window.WearableReminders.preview(id,wearableStatus.deviceId);toast(result.sent?'已向穿戴设备发送，请确认设备反馈':'设备未接受提醒')}finally{wearablePreviewing=false;await readWearable()}return
  }
  if(a==='pillbox-push'||a==='pillbox-sync'){
   if(pillboxBusy||!window.PillboxReminders)return;pillboxBusy=true;redrawTarget();
   try{const r=a==='pillbox-push'?await window.PillboxReminders.pushSchedule():await window.PillboxReminders.sync();
    toast(a==='pillbox-push'?'已下发 '+(r.pushed??0)+' 个服药时段到药盒':'已同步 '+(r.recordCount??0)+' 条服药记录 · 标记 '+(r.matchedIntakeEvents??0)+' 次今日服药');
    if(a==='pillbox-sync')await load().catch(()=>{});
   }catch(e){toast(e.message)}finally{pillboxBusy=false;redrawTarget()}return
  }
  if(!a?.startsWith('reminder-')||a==='reminder-control')return originalDispatch(a,id);
  if(!draft)return;rememberTime();
  if(a==='reminder-field'){selected=id;paint()}
  if(a==='reminder-preset'){Object.assign(current(),id==='gentle'?{level:25,pulseMs:200,intervalMs:800,repeats:2,ramp:false}:id==='strong'?{level:100,pulseMs:800,intervalMs:400,repeats:4,ramp:true}:{level:65,pulseMs:400,intervalMs:600,repeats:3,ramp:false});paint()}
  if(a==='reminder-step'){const f=spec();setValue(current()[f[0]]+Number(id)*f[4])}
  if(a==='reminder-ramp'){current().ramp=!current().ramp;paint()}
  if(a==='reminder-day'){const day=Number(id);ruleDraft.days=ruleDraft.days.includes(day)?ruleDraft.days.filter(d=>d!==day):[...ruleDraft.days,day];paint()}
  if(a==='reminder-rule-new'){if(draft.profile.rules.length>=16)throw Error('每种提醒最多 16 条规则');ruleDraft={id:'r_'+crypto.randomUUID().replaceAll('-',''),time:'08:00',days:[1,2,3,4,5,6,7],enabled:true,effect:M.effect(draft.profile)};paint()}
  if(a==='reminder-rule-edit'){ruleDraft={...copy(draft.profile.rules.find(r=>r.id===id)),existing:true};paint()}
  if(a==='reminder-rule-toggle'){const r=draft.profile.rules.find(r=>r.id===id);r.enabled=!r.enabled;paint()}
  if(a==='reminder-rule-save'){const p=copy(draft.profile);p.rules=p.rules.filter(r=>r.id!==ruleDraft.id);p.rules.push(ruleDraft);draft.profile=M.profiles({[draft.kind]:p})[draft.kind];ruleDraft=null;await originalBack();paint();toast('规则已加入，保存设置后生效')}
  if(a==='reminder-rule-delete'){draft.profile.rules=draft.profile.rules.filter(r=>r.id!==ruleDraft.id);ruleDraft=null;await originalBack();paint()}
  if(a==='reminder-save'){if(saving)return;const p=allProfiles();p[draft.kind]=draft.profile;const validated=M.profiles(p);saving=true;paint();try{const result=await send('settings',{reminderProfiles:validated,target:'phone'},'PATCH');state.settings.reminderProfiles=result.reminderProfiles;render();toast('提醒设置已保存')}finally{saving=false;paint()}}
  if(a==='reminder-preview'){if(previewing)return;const effect=M.effect(current());if(!window.AndroidApp){toast('请在安卓手机上预览提醒效果');return}previewing=true;paint();try{const r=await AndroidApp.reminderPreview(draft.kind,effect,'phone');toast(r.body.message||'预览完成')}finally{previewing=false;if(document.querySelector('.reminder-editor'))paint()}}
 };
 // A long hold consumes the following synthetic click; scrolling cancels the hold.
 let press=null,suppressUntil=0;
 document.addEventListener('pointerdown',()=>{suppressUntil=0},true);
 function cancel(){if(press)clearTimeout(press.timer);press=null}
 document.addEventListener('pointerdown',e=>{const b=e.target.closest('[data-reminder-tile]');if(!b||e.isPrimary===false||e.button>0)return;cancel();press={b,x:e.clientX,y:e.clientY,id:e.pointerId};press.timer=setTimeout(()=>{suppressUntil=Date.now()+1800;const key=b.dataset.id;cancel();action('reminder-control',key)},550)});
 document.addEventListener('pointermove',e=>{if(press&&Math.hypot(e.clientX-press.x,e.clientY-press.y)>12){suppressUntil=Date.now()+300;cancel()}});
 ['pointerup','pointercancel'].forEach(t=>document.addEventListener(t,cancel));
 document.addEventListener('click',e=>{if(Date.now()<suppressUntil){suppressUntil=0;e.preventDefault();e.stopImmediatePropagation()}},true);
 document.addEventListener('contextmenu',e=>{if(e.target.closest('[data-reminder-tile],.reminder-dial'))e.preventDefault()});
 document.addEventListener('change',e=>{if(e.target.id==='reminder-exact'&&Number.isFinite(e.target.valueAsNumber)){setValue(e.target.valueAsNumber);e.target.value=current()[spec()[0]]}});
 document.addEventListener('keydown',e=>{const b=e.target.closest('[data-reminder-tile]');if(b&&(e.key==='F2'||(e.shiftKey&&e.key==='Enter'))){e.preventDefault();action('reminder-control',b.dataset.id)}const dial=e.target.closest('.reminder-dial');if(!dial)return;const f=spec();if(['ArrowUp','ArrowRight','ArrowDown','ArrowLeft','Home','End'].includes(e.key)){e.preventDefault();setValue(e.key==='Home'?f[2]:e.key==='End'?f[3]:current()[f[0]]+(['ArrowUp','ArrowRight'].includes(e.key)?1:-1)*f[4])}});
 let dragging=null;
 const drag=e=>{const f=spec(),v=M.dialValue(e.clientX,e.clientY,dragging.getBoundingClientRect());setValue(f[2]+(v-1)/99*(f[3]-f[2]))};
 document.addEventListener('pointerdown',e=>{const d=e.target.closest('.reminder-dial');if(!d)return;e.preventDefault();dragging=d;d.setPointerCapture(e.pointerId);drag(e)});
 document.addEventListener('pointermove',e=>{if(dragging)drag(e)});
 ['pointerup','pointercancel'].forEach(t=>document.addEventListener(t,()=>dragging=null));
 document.querySelector('#detail-dialog').addEventListener('close',()=>{draft=null;ruleDraft=null});
 const originalBack=panelBack;
 panelBack=async function(...args){if(ruleDraft){ruleDraft=null;await originalBack(...args);if(draft)paint();return}return originalBack(...args)};
})();
