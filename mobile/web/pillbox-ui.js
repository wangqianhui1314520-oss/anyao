/* 安药 · 药盒页（HiPee / Hi-PB1 四仓药盒，按 0.4.11 真机验证过的协议）。
   每种按时吃的药放进一个仓位，计划下发到药盒后，药盒按自己的方式响铃亮灯；断开蓝牙也照样提醒。
   药盒那边有动作（开盖 / 按键）只提示用户核对，由用户点「我吃了」记账——真机状态字节的含义还没有确认，不自动记服药。
   设备状态只来自原生（或浏览器蓝牙）回复，页面不模拟已连接、已下发或已同步。 */
(() => {
 const M=PillboxModel;
 const box={status:null,devices:[],history:[],busy:false,message:'',error:'',draft:null,signature:''};
 const SEEN_KEY='anyao-pillbox-activity-seen';
 const supported=()=>window.DeviceBridge?.supported()===true;
 const connected=()=>box.status?.connected===true;
 const batteryWarning=()=>connected()&&Number.isFinite(box.status?.battery)&&box.status.battery<=20?`<p class="pillbox-feedback" role="alert">药盒电量 ${esc(box.status.battery)}%，请及时充电。电量来自最近一次连接读取；离线时无法持续检测。</p>`:'';
 const call=(action,extra={})=>window.DeviceBridge.call(action,box.status?.deviceId,{target:'pillbox',...extra});
 const plans=()=>Array.isArray(box.status?.plans)?box.status.plans:[];
 const fixedDrugs=()=>state.drugs.filter(d=>!d.asNeeded&&(d.times||[]).length);
 const when=v=>v?new Date(Number(v)).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):'';
 const planDrug=p=>state.drugs.find(d=>d.id===p.drugId);
 /* 用药时间改过、药删了、改成需要时才吃：药盒里还是旧提醒，要提示重新下发 */
 const drift=()=>plans().some(p=>{const d=planDrug(p);return !d||d.asNeeded||JSON.stringify(DrugModel.weekdays(d))!==JSON.stringify(p.weekdays||DrugModel.all)||JSON.stringify([...(d.times||[])].sort())!==JSON.stringify(p.times)})
   ||fixedDrugs().some(d=>plans().length&&!plans().some(p=>p.drugId===d.id)&&plans().length<4);
 /* 现在该吃的那一顿：到点、超时、说好晚点吃，或者 60 分钟内就到点的下一顿 */
 const targetDose=at=>[...state.doses].filter(d=>!['taken','skipped'].includes(d.status))
   .sort((a,b)=>({missed:0,due:1,delay:2,pending:3}[a.level]??9)-({missed:0,due:1,delay:2,pending:3}[b.level]??9)||a.planned.localeCompare(b.planned))
   .find(d=>['missed','due','delay'].includes(d.level)||(d.level==='pending'&&Date.parse(d.dueAt)-at<=3600000))||null;
 const activity=()=>{const a=box.status?.activity;if(!a?.at)return null;const seen=Number(localStorage.getItem(SEEN_KEY)||0);return a.at>seen&&Date.now()-a.at<6*3600000?a:null};
 const markSeen=()=>{try{localStorage.setItem(SEEN_KEY,String(box.status?.activity?.at||Date.now()))}catch{}};
 const emit=()=>window.dispatchEvent(new CustomEvent('anyao-pillbox-status',{detail:box.status}));
 const connectDialog=()=>document.querySelector('#pillbox-dialog');
 const connectOpen=()=>!!connectDialog()?.open;
 const pageVisible=()=>state.tab==='box'&&!connectOpen()&&!document.querySelector('#detail-dialog')?.open;
 const signature=()=>JSON.stringify([box.status,box.busy,box.error,box.message,state.drugs.map(d=>[d.id,d.times,d.asNeeded]),state.doses.map(d=>[d.eventId,d.status,d.level])]);
 function syncBoxPage(force){
  const s=signature();if(!force&&s===box.signature)return;box.signature=s;emit();
  if(pageVisible())render();
 }
 async function status(){
  const before=box.status?.activity?.at;
  box.status=supported()?await call('hipeeStatus'):null;
  const a=activity();
  if(a&&a.at!==before)toast('收到药盒活动记录，吃了药请点「我吃了」');
  syncBoxPage();return box.status;
 }
 async function history(){box.history=await api('hipee-history');return box.history}

 /* ---------- 药盒页 ---------- */

 function statusCardHTML(){
  const s=box.status,on=connected();
  const facts=on?[s.battery!=null?`电量 ${s.battery}%`:'',s.firmware?`固件 ${s.firmware}`:''].filter(Boolean).join(' · '):'';
  const label=on?'药盒已连接':s?.savedDevice?'药盒没有连着':'还没有连接药盒';
  const note=on?(facts||'已连接'):plans().length?'药盒按已下发的计划自己提醒；需要改计划或读记录时再连接':'连上以后把药放进仓位，药盒到点会响铃亮灯';
  return `<section class="surface box-card" data-tone="${on?'closed':'off'}">
    <div class="device-art box-art">${deviceArt.pillbox}</div>
    <p class="box-label">${esc(label)}</p>
    <p class="box-time">${esc(note)}</p>
    ${batteryWarning()}
    ${on?`<button class="m-btn m-btn-secondary" data-action="pillbox-op" data-id="find" ${box.busy?'disabled':''}>寻找药盒（让它响一下）</button>`
       :`<button class="m-btn m-btn-primary" data-action="pillbox-connect">${s?.savedDevice?'重新连接药盒':'连接药盒'}</button>`}
  </section>`;
 }
 function activityHTML(){
  const a=activity();if(!a)return '';
  const dose=targetDose(a.at);
  return `<section class="surface take-card" data-level="${dose?'due':'done'}"><p class="take-label">${esc(clock(a.at))} 收到药盒活动记录</p>`
   +(dose?`<p class="take-time">${esc(dose.planned)}</p><p class="take-name">${esc(dose.drug?.name||'')}<span>${esc(dose.drug?.dose||'')}</span></p><p class="take-note">药盒不能确定你是不是吃了药，吃了就点一下</p><button class="m-btn m-btn-primary mega-btn" data-action="pillbox-activity-taken" data-id="${esc(dose.eventId)}">${icon('check')}我吃了</button>`
       :`<p class="take-note">现在没有要吃的那一顿</p>`)
   +`<button class="secondary-btn" data-action="pillbox-activity-dismiss">暂不记录服药</button></section>`;
 }
 function slotRowsHTML(){
  const list=[1,2,3,4].map(c=>({c,p:plans().find(x=>x.compartment===c)}));
  if(!list.some(x=>x.p))return `<p class="empty">${connected()?'药盒里还没有提醒计划。点下面的「装药与提醒」，把每种药放进一个仓位再下发。':'药盒里还没有安药下发的计划。连接药盒后可以设置。'}</p>`;
  const next=targetDose(Date.now());
  return list.map(({c,p})=>{
   if(!p)return `<div class="box-slot"><b class="box-slot-no">${c}</b><span class="box-slot-body"><strong>空仓</strong><small>没有提醒</small></span></div>`;
   const d=planDrug(p),now=next&&d&&next.drugId===d.id;
   return `<div class="box-slot" ${now?'data-current="true" data-tone="due"':''}><b class="box-slot-no">${c}</b><span class="box-slot-body"><strong>${esc(d?.name||p.drugName||'已删除的药')}${d?.dose?`<span class="m-badge" data-tone="accent">${esc(d.dose)}</span>`:''}</strong><small>${esc(p.times.join(' · '))}${now?` · 现在吃这一仓（${esc(next.planned)}）`:''}</small></span></div>`;
  }).join('');
 }
 function lowStockHTML(){
  const low=lowStock();if(!low.length)return '';
  return `<div class="m-section"><h2 class="m-caption">需要补药</h2></div><div class="surface">${low.map(x=>`<button class="menu-row" data-action="refill" data-id="${esc(x.drug.id)}" data-lead="icon"><span class="row-icon">${icon('task')}</span><span class="row-body"><strong>${esc(x.drug.name)} 快吃完了</strong><small>还剩 ${x.drug.inventory||0} ${esc(inventoryUnit(x.drug))} · 大约 ${x.days} 天</small></span><span class="arrow" aria-hidden="true"></span></button>`).join('')}</div>`;
 }
 function boxPage(){
  const s=box.status;
  return heading('药盒')
   +activityHTML()
   +statusCardHTML()
   +(box.error?`<p class="pillbox-feedback" role="alert">${esc(box.error)}</p>`:box.busy&&box.message?`<p class="helper" role="status">${esc(box.message)}</p>`:'')
   +(drift()?`<button class="surface notice" data-action="pillbox-plan">${icon('clock')}<span>用药时间改过了，药盒里还是旧的提醒。轻点重新下发</span></button>`:'')
   +`<div class="m-section"><h2 class="m-caption">药盒仓位</h2></div><div class="surface">${slotRowsHTML()}</div>`
   +(s?.plansPushedAt?`<p class="helper">${plans().length?`计划在 ${esc(when(s.plansPushedAt))} 下发，药盒已逐条确认。`:`在 ${esc(when(s.plansPushedAt))} 清空了全部提醒，药盒已确认。`}</p>`:'')
   +lowStockHTML()
   +`<div class="m-section"><h2 class="m-caption">药盒设置</h2></div><div class="surface">`
     +row('装药与提醒','每种药放进一个仓位，把提醒时间下发到药盒','clock','data-action="pillbox-plan"')
     +row(connected()?'管理药盒':'连接药盒',connected()?(s?.name||'HiPee 智能药盒'):supported()?'短按药盒顶部按钮唤醒后搜索':'需要安药安卓应用，或支持蓝牙的 Chrome / Edge','shield','data-action="pillbox-connect"')
     +row('药盒记录',s?.lastSyncAt?`上次同步 ${when(s.lastSyncAt)}`:'读取药盒自己记下的活动记录','report','data-action="pillbox-records"')
   +`</div>`;
 }
 pages.box=boxPage;
 /* ---------- 连接药盒 ---------- */

 function connectBody(){
  const s=box.status,on=connected();
  const facts=on?[s.battery!=null?`电量 ${s.battery}%`:'',s.firmware?`固件 ${s.firmware}`:'',s.identity?.mac||''].filter(Boolean).join(' · '):'';
  return `<div class="device-connect"><section class="surface device-card"><div class="detail-hero"><span class="row-icon">${icon('shield')}</span><div><strong>${esc(s?.name||'智能药盒')}</strong><small class="pillbox-state ${on?'ready':''}">${on?'已连接':'尚未连接'}</small></div></div>`
   +`<p class="helper" role="status">${esc(box.busy?box.message:box.message||(on?facts:'短按药盒顶部按钮唤醒药盒，再搜索并选择它。'))}</p>`+batteryWarning()
   +`<div class="action-grid"><button type="button" data-action="pillbox-op" data-id="scan" ${!supported()||box.busy?'disabled':''}>${box.busy&&box.message===messages.scan?'正在搜索…':'搜索药盒'}</button>`
   +(on?`<button type="button" data-action="pillbox-op" data-id="disconnect" ${box.busy?'disabled':''}>断开药盒</button>`:`<button type="button" data-action="pillbox-op" data-id="reconnect" ${!supported()||box.busy||!s?.savedDevice?'disabled':''}>重新连接</button>`)
   +`</div></section>`
   +(box.error?`<p class="pillbox-feedback" role="alert">${esc(box.error)}</p>`:'')
   +(box.devices.length?`<section class="surface pillbox-choices"><h3>附近的药盒</h3>${box.devices.map(d=>`<button type="button" class="menu-row" data-action="pillbox-op" data-id="connect" data-device="${esc(d.id)}" ${box.busy?'disabled':''}><span class="row-body"><strong>${esc(d.name)}</strong><small>${d.rssi?`信号 ${esc(d.rssi)} · `:''}轻点连接</small></span><span class="arrow" aria-hidden="true"></span></button>`).join('')}</section>`:'')
   +`<ol class="device-steps"><li>短按药盒顶部按钮唤醒药盒（药盒只在唤醒后的一小段时间里能被找到）。</li><li>点「搜索药盒」，在列表里选你的药盒。</li><li>连上后安药会把手机时间发给药盒，再到「装药与提醒」里下发计划。</li><li>下发完可以断开，药盒按计划自己响铃亮灯。</li></ol>`
   +(on?`<div class="action-grid"><button type="button" data-action="pillbox-op" data-id="find" ${box.busy?'disabled':''}>寻找药盒</button><button type="button" data-action="pillbox-op" data-id="calibrate" ${box.busy?'disabled':''}>校准时间</button><button type="button" data-action="pillbox-op" data-id="query" ${box.busy?'disabled':''}>读取电量</button></div>`:'')
   +`<details class="surface pillbox-details"><summary>帮助</summary><p class="helper">搜索不到时再唤醒一次，并关掉正在连接这个药盒的其他应用（如果实智能药盒小程序）。</p><p class="helper">药盒的绑定与解绑请在果实智能药盒小程序里管理；安药只做校时、下发提醒、读取记录和寻找药盒。</p><p class="helper">支持 HiPee / Hi-PB1 四仓药盒；响铃与灯光由药盒固件决定。</p>${!supported()?`<p class="helper">${navigator.bluetooth&&!window.isSecureContext?'浏览器只在 https 地址或本机地址下允许蓝牙。':'连接药盒需要安药安卓应用，或电脑 / 安卓手机上的 Chrome、Edge。'}</p>`:''}</details></div>`;
 }
 function paintConnect(){const d=connectDialog();if(d)d.querySelector('#pillbox-connect-body').innerHTML=connectBody()}
 async function openConnect(){const d=connectDialog();if(!d)return;paintConnect();if(!d.open)showDialog(d);try{await status()}catch(e){box.error=e.message}if(connectOpen())paintConnect()}

 /* ---------- 装药与提醒（完整计划） ---------- */

 function draftFrom(){
  const used=new Set(),saved=plans();
  return fixedDrugs().slice(0,8).map(d=>{
   const old=saved.find(p=>p.drugId===d.id)?.compartment;
   const c=old&&!used.has(old)?old:[1,2,3,4].find(n=>!used.has(n)&&!saved.some(p=>p.compartment===n&&p.drugId!==d.id&&fixedDrugs().some(x=>x.id===p.drugId)))||[1,2,3,4].find(n=>!used.has(n))||0;
   if(c)used.add(c);
   return {drugId:d.id,compartment:c};
  });
 }
 function planBody(){
  const drugs=fixedDrugs();
  if(!box.draft)box.draft=draftFrom();
   const rows=drugs.map(d=>{const a=box.draft.find(x=>x.drugId===d.id)||{compartment:0};
   return `<label class="m-field"><span>${esc(d.name)}${d.dose?' · '+esc(d.dose):''} · ${esc(DrugModel.schedule(d))}</span><select data-pillbox-slot="${esc(d.id)}"><option value="0"${a.compartment?'':' selected'}>不放进药盒</option>${[1,2,3,4].map(n=>`<option value="${n}"${a.compartment===n?' selected':''}>${n} 号仓</option>`).join('')}</select></label>`}).join('');
  return `<p class="helper">每种药放进一个仓位，药盒按这些时间提醒（每仓最多 9 个时间）。下发会替换药盒 4 个仓的全部提醒，没有分配的仓会清空。</p><p class="helper">当前药盒仅验证了每天重复。非每日计划请先选择“不放进药盒”，手机仍按星期提醒；若药盒里已有这份药的旧每日计划，须连接后重新下发完整计划或清空，避免旧提醒继续响。</p>`
   +(drugs.length?`<div class="surface">${rows}</div>`:`<p class="empty">还没有要按时吃的药。先在「用药」里添加，再回来下发。</p>`)
   +(!connected()?`<p class="pillbox-feedback" role="alert">药盒没有连着。请先连接药盒再下发。</p>`:'')
   +(box.error?`<p class="pillbox-feedback" role="alert">${esc(box.error)}</p>`:'')
   +`<button class="primary" data-action="pillbox-plan-send" ${box.busy||!connected()?'disabled':''}>${box.busy?esc(box.message||'正在下发…'):drugs.length?'按这样装药并下发到药盒':'清空药盒里的全部提醒'}</button>`
   +(!connected()?`<button class="secondary-btn" data-action="pillbox-connect">连接药盒</button>`:'');
 }
 const paintPlan=()=>{if(document.querySelector('#detail-dialog[open] [data-action="pillbox-plan-send"]'))panel('装药与提醒',planBody())};

 /* ---------- 药盒记录 ---------- */

 function recordsHTML(){
  const records=box.history.flatMap(h=>(h.records||[]).map(r=>({...r,deviceName:h.deviceName}))).sort((a,b)=>b.timestamp-a.timestamp);
  const body=records.length?`<div class="surface pillbox-records"><div class="pillbox-timeline">${records.slice(0,60).map(r=>`<article><time datetime="${new Date(r.timestamp*1000).toISOString()}">${esc(stamp(r.timestamp*1000))}</time><div><strong>${r.rawFrame?'药盒记了一次':`第 ${esc(r.compartment)} 仓`}</strong><small>${esc(r.deviceName||'智能药盒')} · ${r.taken===true?'药盒报告已服药':r.taken===false?'药盒报告没有服药':'是否吃了药需要你核对'}</small></div></article>`).join('')}</div></div>${records.length>60?'<p class="helper">展示最近 60 条，完整记录随本机备份保存。</p>':''}`
   :'<p class="empty">还没有药盒记录。连接药盒后点「同步药盒记录」。</p>';
  return body+`<p class="helper">药盒原始活动记录不能证明实际服药，部分状态和仓位仍未确定。吃了药请本人点“我吃了”，安药不会据此自动记为已服药。</p>`
   +`<button class="secondary-btn" data-action="pillbox-op" data-id="sync" ${!connected()||box.busy?'disabled':''}>${box.busy&&box.message===messages.sync?'正在同步…':'同步药盒记录'}</button>`;
 }

 const messages={scan:'正在搜索，请短按药盒按钮唤醒…',connect:'正在连接药盒…',reconnect:'正在重新连接…',disconnect:'正在断开…',find:'正在让药盒响铃…',calibrate:'正在把手机时间发给药盒…',query:'正在读取电量…',sync:'正在读取药盒记录…',push:'正在下发计划，请让药盒靠近手机…'};
 async function run(operation,extra={}){
  if(box.busy)return;
  box.busy=true;box.message=messages[operation]||'';box.error='';
  const paint=()=>{if(connectOpen())paintConnect();paintPlan();if(document.querySelector('#detail-dialog[open] .pillbox-records,#detail-dialog[open] [data-id="sync"]'))panel('药盒记录',recordsHTML());syncBoxPage(true)};
  paint();
  try{
   if(operation==='scan'){const list=await call('hipeeScan');box.devices=Array.isArray(list)?list:list?.devices||[]}
   else if(operation==='connect'){await call('hipeeConnect',extra);box.devices=[]}
   else if(operation==='reconnect')await call('hipeeReconnect');
   else if(operation==='disconnect'){await call('hipeeDisconnect');box.devices=[]}
   else if(operation==='find'){await call('hipeeFind');toast('寻找指令已发出，请确认药盒是否响铃或亮灯')}
   else if(operation==='calibrate'){await call('hipeeCalibrate');toast('已把手机时间发给药盒')}
   else if(operation==='query'){const r=await call('hipeeQuery');toast(`药盒电量 ${r?.battery??'未知'}%`)}
   else if(operation==='sync'){const r=await call('hipeeSync');await history();await load();toast(`收到 ${r?.count??0} 条药盒记录${r?.complete===false?'（药盒没有给出结束标记，可能不完整）':''}${r?.matched?`，${r.matched} 次已记为服药`:''}`)}
   else if(operation==='push'){
    const drugs=fixedDrugs();
    const list=M.plans(box.draft.filter(x=>x.compartment&&drugs.some(d=>d.id===x.drugId)).map(x=>{const d=drugs.find(y=>y.id===x.drugId);return{compartment:x.compartment,times:d.times,weekdays:DrugModel.weekdays(d),drugId:d.id,drugName:d.name}}));
    const r=await call('hipeePushPlans',{plans:list});
    box.draft=null;toast(list.length?`药盒已确认 ${r?.pushed??0} 个提醒`:'药盒里的提醒已全部清空');
   }
   await status();
   box.message=operation==='scan'?(box.devices.length?'选择要连接的药盒':'没有找到药盒，请再唤醒一次'):'';
  }catch(error){box.error=error.message;box.message=''}
  finally{box.busy=false;paint();if(operation==='push'&&!box.error&&document.querySelector('#detail-dialog[open] [data-action="pillbox-plan-send"]'))panelBack(true)}
 }

 const baseDispatch=dispatchAction;
 dispatchAction=async function(a,id,el){
  if(a==='pillbox-connect')return openConnect();
  if(a==='pillbox-plan'){box.draft=null;box.error='';return panel('装药与提醒',planBody())}
  if(a==='pillbox-plan-send'){
   const used=box.draft?.filter(x=>x.compartment).map(x=>x.compartment)||[];
   if(new Set(used).size!==used.length){box.error='每个仓只能放一种药，请重新选仓位';return paintPlan()}
   return run('push');
  }
  if(a==='pillbox-records'){box.error='';try{await history()}catch(error){box.error=error.message}return panel('药盒记录',recordsHTML())}
  if(a==='pillbox-activity-taken'){
   await send('intake-events/'+encodeURIComponent(id),{status:'taken',time:nowTime()},'PATCH');
   markSeen();await load();toast('已记下，家属那边也能看到');syncBoxPage(true);return;
  }
  if(a==='pillbox-activity-dismiss'){markSeen();syncBoxPage(true);return}
  if(a==='pillbox-op')return run(id,{deviceId:el?.dataset.device});
  return baseDispatch(a,id,el);
 };

 document.addEventListener('change',e=>{
  const sel=e.target.closest?.('[data-pillbox-slot]');if(!sel||!box.draft)return;
  const item=box.draft.find(x=>x.drugId===sel.dataset.pillboxSlot);if(item)item.compartment=Number(sel.value);
  box.error='';
 });
 connectDialog()?.addEventListener('close',()=>syncBoxPage(true));
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)status().catch(()=>{})});
 window.addEventListener('anyao-pillbox-push',()=>{status().then(()=>{if(connectOpen())paintConnect()}).catch(()=>{})});
 /* load() 已经整页重绘过，这里只对齐签名，避免同一份数据再画一遍 */
 window.addEventListener('anyao-loaded',()=>{box.signature=signature();emit()});
 status().catch(()=>{}).then(()=>history().catch(()=>{}));
})();
