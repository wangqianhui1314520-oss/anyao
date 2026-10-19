/* 安药 · 药盒页（HiPee / Hi-PB1 四仓药盒，按 0.4.11 真机验证过的协议）。
   每种按时吃的药放进一个仓位，计划下发到药盒后，药盒按自己的方式响铃亮灯；断开蓝牙也照样提醒。
   药盒那边有动作（开盖 / 按键）只提示用户核对，由用户点「我吃了」记账——真机状态字节的含义还没有确认，不自动记服药。
   设备状态只来自原生（或浏览器蓝牙）回复，页面不模拟已连接、已下发或已同步。 */
(() => {
 const M=PillboxModel;
 const box={status:null,devices:[],history:[],busy:false,message:'',error:'',draft:null,signature:'',operation:'',operationToken:0};
 const ledger={data:null,deviceId:'',scope:null,busy:false,loading:false,error:'',panel:null,requests:new Map(),refresh:null,retry:null};
 const validDeviceId=value=>typeof value==='string'&&/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(value)?value.toUpperCase():null;
 const ledgerDeviceId=()=>ledger.scope||validDeviceId(box.status?.deviceId)||'local';
 const ledgerSlots=()=>[1,2,3,4].map(compartment=>({compartment,drugId:'',drugName:'',dose:'',remaining:null,openedToday:0,openedTotal:0,consumedToday:0,consumedTotal:0,lastOpenedAt:null,...(ledger.deviceId===ledgerDeviceId()?ledger.data?.slots?.find(s=>s.compartment===compartment):null)}));
 const ledgerSlot=n=>ledgerSlots().find(s=>s.compartment===Number(n));
 const ledgerTime=value=>value?stamp(typeof value==='number'&&value<100000000000?value*1000:value):'还没有记录';
 const ledgerRows=()=>ledger.deviceId===ledgerDeviceId()&&Array.isArray(ledger.data?.journal)?ledger.data.journal:[];
 const unassignedRows=()=>ledger.deviceId===ledgerDeviceId()&&Array.isArray(ledger.data?.unassignedRecords)?ledger.data.unassignedRecords:[];
 const stockText=s=>s.remaining===null||s.remaining===undefined?'待设置':`${s.remaining} 份`;
 const stockIssueText=s=>s.stockIssue==='unset'?'之前还没有盘点份数，请按实际剩余药量盘点':s.stockIssue==='insufficient'?'确认服药时记录的份数不足，请核对并盘点':s.stockIssue||'份数需要核对，请盘点这一仓';
 const ledgerErrorText=error=>{
  const text=error?.message||String(error),messages={pillbox_drug_already_assigned:'这份药已绑定到别的仓位，请先解绑原仓',pillbox_assign_drug_first:'请先给这一仓绑定药物',pillbox_count_stock_first:'请先盘点这一仓的实际份数，再补药',pillbox_source_not_found:'找不到这条活动记录，请重新同步后查看',pillbox_source_already_assigned:'这条活动已归属过，不能重复计数',pillbox_request_id_conflict:'上次请求内容发生变化，请关闭后重新操作',invalid_pillbox_portions:'份数要填 0 到 100000 的整数'};
  return Object.entries(messages).find(([code])=>text.includes(code))?.[1]||text;
 };
 const ledgerBusy=()=>ledger.busy||box.busy;
 const retryLedgerHTML=()=>ledger.retry?`<button type="button" class="secondary-btn" data-action="pillbox-ledger-retry" ${ledgerBusy()?'disabled':''}>重试上次保存</button>`:'';
 async function refreshLedger({force=false}={}){
  const deviceId=ledgerDeviceId();
  if(!force&&ledger.refresh&&ledger.refresh.deviceId===deviceId)return ledger.refresh.promise;
  const token={deviceId,promise:null};ledger.loading=true;
  token.promise=(async()=>{
   try{
    const result=await api('pillbox?deviceId='+encodeURIComponent(deviceId));
    if(!result||!Array.isArray(result.slots))throw Error('药仓记录未能载入，请重试');
    if(deviceId===ledgerDeviceId()&&ledger.refresh===token){ledger.data=result;ledger.deviceId=deviceId;ledger.error=''}
    return result;
   }catch(error){if(deviceId===ledgerDeviceId())ledger.error=error.message;throw error}
   finally{if(ledger.refresh===token){ledger.refresh=null;ledger.loading=false}syncBoxPage(true);paintSlotPanel()}
  })();ledger.refresh=token;return token.promise;
 }
 const ledgerRequestId=key=>{if(!ledger.requests.has(key))ledger.requests.set(key,crypto.randomUUID());return ledger.requests.get(key)};
 async function mutateLedger(path,body,{method='POST',label='已保存',requestKey=''}={}){
  if(ledgerBusy())return false;
  const deviceId=ledgerDeviceId();
  if(body.deviceId!==deviceId)throw Error('当前药仓已切换，请重新打开后保存');
  if(ledger.retry&&ledger.retry.requestKey!==requestKey)throw Error('上次操作结果还未确认，请先点“重试上次保存”');
  ledger.busy=true;ledger.error='';paintSlotPanel();syncBoxPage(true);
  try{
   if(requestKey){body={...body,requestId:ledgerRequestId(requestKey)};ledger.retry={path,body:{...body},method,label,requestKey}}
   await send(path,body,method);
   await refreshLedger({force:true});
   if(deviceId!==ledgerDeviceId())throw Error('药仓范围已切换，原药仓操作已保存，请切回查看');
   if(requestKey){ledger.requests.delete(requestKey);ledger.retry=null}
   toast(label);return true;
  }catch(error){
   ledger.error=ledgerErrorText(error);
   /* Server validation rejections do not apply a mutation. Transport/refresh
      failures keep the exact action available for an idempotent retry. */
   if(requestKey&&/pillbox_|invalid_/.test(error.message||'')){ledger.requests.delete(requestKey);ledger.retry=null}
   throw Error(ledger.error);
  }
  finally{ledger.busy=false;syncBoxPage(true);paintSlotPanel()}
 }
 const SEEN_KEY='anyao-pillbox-activity-seen';
 const PAUSED_KEY='anyao-pillbox-paused-plans:';
 const supported=()=>window.DeviceBridge?.supported()===true;
 const connected=()=>box.status?.connected===true;
 const batteryWarning=()=>connected()&&Number.isFinite(box.status?.battery)&&box.status.battery>=0&&box.status.battery<=20?`<p class="pillbox-feedback" role="alert">药盒电量 ${esc(box.status.battery)}%，请及时充电。电量来自最近一次连接读取；离线时无法持续检测。</p>`:'';
 const call=(action,extra={})=>window.DeviceBridge.call(action,box.status?.deviceId,{target:'pillbox',...extra});
 const pauseKey=s=>PAUSED_KEY+String(s?.deviceId||'').toUpperCase();
 const paused=s=>{try{const p=JSON.parse(localStorage.getItem(pauseKey(s))||'null');return p&&String(p.deviceId).toUpperCase()===String(s?.deviceId).toUpperCase()?p:null}catch{return null}};
 const reminderEnabled=s=>paused(s)?.enabled!==false;
 const persistPause=(s,value)=>{if(!s?.deviceId)throw Error('药盒身份尚未读取，不能保存提醒开关');try{localStorage.setItem(pauseKey(s),JSON.stringify({deviceId:s.deviceId,...value}))}catch{throw Error('无法保存药盒提醒计划，请检查手机存储后重试')}};
 const stampReminderState=s=>s?{...s,reminderEnabled:reminderEnabled(s),reminderConfigured:!!((s.plans||[]).length||(paused(s)?.plans||[]).length),reminderPending:!!paused(s)?.pending}:s;
 window.pillboxReminderState=stampReminderState;
 const plans=()=>Array.isArray(box.status?.plans)?box.status.plans:[];
 const fixedDrugs=()=>state.drugs.filter(d=>!d.asNeeded&&(d.times||[]).length);
 const when=v=>v?new Date(Number(v)).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):'';
 const planDrug=p=>state.drugs.find(d=>d.id===p.drugId);
 const weekdays=d=>d?.weekdays===undefined?[1,2,3,4,5,6,7]:Array.isArray(d.weekdays)?[...d.weekdays].sort((a,b)=>a-b):[];
 const repeat=d=>JSON.stringify(weekdays(d))==='[1,2,3,4,5,6,7]'?'每天':'非每日计划（仅手机提醒）';
 /* 用药时间改过、药删了、改成需要时才吃：药盒里还是旧提醒，要提示重新下发 */
 const drift=()=>plans().some(p=>{const d=planDrug(p);return !d||d.asNeeded||JSON.stringify(weekdays(d))!==JSON.stringify(weekdays(p))||JSON.stringify([...(d.times||[])].sort())!==JSON.stringify(p.times)})
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
 const signature=()=>JSON.stringify([box.status,box.busy,box.error,box.message,ledger.data,ledger.deviceId,ledger.scope,ledger.busy,ledger.error,ledger.retry,state.drugs.map(d=>[d.id,d.name,d.dose,d.times,d.weekdays,d.asNeeded]),state.doses.map(d=>[d.eventId,d.status,d.level])]);
 function syncBoxPage(force){
  const s=signature();if(!force&&s===box.signature)return;box.signature=s;emit();
  if(pageVisible())render();
 }
 async function status(){
  const before=box.status?.activity?.at;
  box.status=stampReminderState(supported()?await call('hipeeStatus'):null);
  const a=activity();
  if(a&&a.at!==before)toast('收到药盒活动记录，吃了药请点「我吃了」');
  if(ledger.deviceId!==ledgerDeviceId())refreshLedger().catch(()=>{});
  syncBoxPage();return box.status;
 }
 /* Keep the recovery copy until all hardware changes and the resulting status are confirmed. */
 window.setPillboxReminderEnabled=async enabled=>{
  if(box.busy)throw Error('药盒正在处理其他操作，请稍后重试');
  box.busy=true;box.error='';
  try{
   const fresh=await status();if(!fresh?.connected||!fresh.deviceId)throw Error('药盒没有连接，请先连接药盒');
   const deviceId=fresh.deviceId,previous=paused(fresh),wasEnabled=reminderEnabled(fresh);
   if(enabled===wasEnabled)return fresh;
   const saved=M.plans(enabled||previous?.pending?(previous?.plans||[]):(fresh.plans||[]));
   if(enabled&&!saved.length)throw Error('还没有可恢复的药盒计划，请先在“药盒 → 装药与提醒”里下发');
   persistPause(fresh,{enabled:wasEnabled,plans:saved,pending:enabled?'enable':'disable'});
   const beforeWrite=await call('hipeeStatus');if(!beforeWrite?.connected||beforeWrite.deviceId!==deviceId)throw Error('药盒连接已变化，未修改提醒，请重新连接');
   const wanted=enabled?saved:[];
   const result=await call('hipeePushPlans',{plans:wanted});
   if(result?.confirmed!==true)throw Error('药盒尚未确认提醒开关，请重新连接后检查');
   const after=await call('hipeeStatus');if(!after?.connected||after.deviceId!==deviceId)throw Error('药盒连接已变化，请重新连接后检查提醒');
   const signature=p=>JSON.stringify(M.plans(p||[]));
   if(signature(after.plans)!==signature(wanted))throw Error('药盒提醒计划没有完成保存，请重新下发');
   persistPause(after,{enabled,plans:saved});
   box.status=stampReminderState(after);syncBoxPage(true);return box.status;
  }catch(error){box.error=error.message;throw error}
  finally{box.busy=false;syncBoxPage(true)}
 };
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
  const known=ledger.deviceId===ledgerDeviceId()&&Array.isArray(ledger.data?.slots),busy=ledgerBusy();
  const count=value=>known?String(value??0):'—';
  return ledgerSlots().map(s=>`<section class="surface pill-slot-card" data-pillbox-compartment="${s.compartment}">`
   +`<div class="pill-slot-heading"><span class="box-slot-no">${s.compartment}</span><span><strong>${esc(s.drugName||'未绑定药物')}</strong><small>${s.drugId?`每次 ${esc(s.dose||'按用药说明')} · 1 份`:'先选择这一仓放的药'}</small></span><button type="button" class="pill-slot-link" data-action="pillbox-slot" data-id="${s.compartment}" ${busy?'disabled':''}>管理</button></div>`
   +`<div class="pill-slot-stock"><span>剩余份数</span><strong>${esc(stockText(s))}</strong></div>`
   +`<div class="pill-slot-counts"><div><span>已确认开仓</span><b>今日 ${count(s.openedToday)} 次 <small>累计 ${count(s.openedTotal)} 次</small></b></div><div><span>已用份数</span><b>今日 ${count(s.consumedToday)} 份 <small>累计 ${count(s.consumedTotal)} 份</small></b></div></div>`
   +`<p class="pill-slot-last">最近开仓：${esc(ledgerTime(s.lastOpenedAt))}</p>`
   +(s.stockNeedsReview?`<p class="pillbox-feedback" role="status">${esc(stockIssueText(s))}</p>`:'')
   +`<div class="pill-slot-actions"><button type="button" data-action="pillbox-slot-stock" data-id="${s.compartment}" aria-label="${s.compartment} 号仓装药补药或盘点份数" ${busy||!s.drugId?'disabled':''}>份数</button><button type="button" data-action="pillbox-slot-open" data-id="${s.compartment}" aria-label="记录 ${s.compartment} 号仓开仓" ${busy?'disabled':''}>记开仓</button><button type="button" data-action="pillbox-slot-journal" data-id="${s.compartment}" ${busy?'disabled':''}>日志</button></div></section>`).join('');
 }
 function ledgerScopeHTML(){
  const current=ledgerDeviceId(),physical=validDeviceId(box.status?.deviceId),active=ledger.data?.activeDeviceId||'local';
  const select=physical?`<label class="pill-scope-select"><span>查看仓位</span><select data-pillbox-ledger-device aria-label="查看哪一个药盒的仓位" ${ledgerBusy()?'disabled':''}><option value="${physical}"${current===physical?' selected':''}>${esc(box.status?.name||'这台药盒')}</option><option value="local"${current==='local'?' selected':''}>本机四仓安排</option></select></label>`:`<p class="helper">本机四仓安排 · 连接药盒前也能保存</p>`;
  return select+`<div class="pill-scope-note"><span>${active===current?'确认服药时从这些仓位扣份数':'当前仅查看；服药不会扣这里的份数'}</span>${active!==current?`<button type="button" data-action="pillbox-ledger-activate" ${ledgerBusy()?'disabled':''}>设为当前用药药盒</button>`:''}</div>`;
 }
 function unassignedHTML(){
  const rows=unassignedRows();if(!rows.length)return '';
  return `<button type="button" class="surface notice pill-unassigned" data-action="pillbox-unassigned" ${ledgerBusy()?'disabled':''}>${icon('report')}<span>有 ${rows.length} 条未归属活动记录<small>确认是哪个仓位打开过，再手动归属</small></span><span class="arrow" aria-hidden="true"></span></button>`;
 }
 const journalLabel={open:'已确认开仓','stock-set':'装药 / 盘点','stock-add':'补药',taken:'确认服药','undo-taken':'撤回服药',assign:'更换药物'};
 function slotJournalHTML(compartment){
  const rows=ledgerRows().filter(r=>r.compartment===compartment).slice().sort((a,b)=>Date.parse(b.at)-Date.parse(a.at));
  return rows.length?`<div class="pill-slot-journal">${rows.slice(0,100).map(r=>`<article><time>${esc(ledgerTime(r.at))}</time><strong>${esc(journalLabel[r.kind]||'药仓记录')}</strong><p>${r.kind==='open'?(['manual','manual-user-confirmed'].includes(r.source)?'手动记录开仓 · 没有扣药':'根据活动记录人工确认 · 没有扣药'):r.before!==undefined&&r.after!==undefined?`${r.before==null?'未盘点':esc(r.before)+' 份'} → ${r.after==null?'待盘点':esc(r.after)+' 份'}`:esc(r.drugName||'已更新绑定')}</p></article>`).join('')}</div>`:'<p class="empty">这一仓还没有记录。</p>';
 }
 function slotPanelBody(){
  const p=ledger.panel,s=ledgerSlot(p?.compartment);if(!s)return '';
  const busy=ledgerBusy(),scope=ledgerDeviceId(),error=ledger.error?`<p class="pillbox-feedback" role="alert">${esc(ledger.error)}</p>`:'';
  const intro=`<div class="pill-slot-panel-head"><span class="box-slot-no">${s.compartment}</span><div><strong>${esc(s.drugName||'未绑定药物')}</strong><small>${s.drugId?`每次 ${esc(s.dose||'按用药说明')} · 1 份`:'选择药物后，再填实际放入的份数'}</small></div><b>${esc(stockText(s))}</b></div>`+retryLedgerHTML();
  if(p.view==='bind')return intro+`<p class="helper">这里只安排仓位，不会向药盒下发提醒。更换药物后须重新盘点这一仓。</p><form data-kind="pillbox-slot-bind" data-id="${s.compartment}" data-device-id="${esc(scope)}"><label class="m-field"><span>这一仓放的药</span><select name="drugId" ${busy?'disabled':''}><option value="">不绑定药物</option>${state.drugs.map(d=>`<option value="${esc(d.id)}"${d.id===s.drugId?' selected':''}>${esc(d.name)}${d.dose?' · 每次 '+esc(d.dose):''}</option>`).join('')}</select></label>${!state.drugs.length?'<p class="helper">先在“用药”里添加药物，再回来绑定。</p>':''}${error}<button class="primary" ${busy?'disabled':''}>${busy?'保存中…':'保存仓位药物'}</button></form>`;
  if(p.view==='stock')return intro+`<p class="helper">一份是一次服用量。请按实际放入的药量填写，开仓不会自动扣药。</p>`
   +`<form data-kind="pillbox-slot-stock" data-id="${s.compartment}" data-device-id="${esc(scope)}"><label class="m-field"><span>这次要做什么</span><select name="kind" ${busy?'disabled':''}><option value="set">装药 / 盘点：设为实际剩余份数</option><option value="add"${p.stockKind==='add'?' selected':''}${s.remaining==null?' disabled':''}>${s.remaining==null?'补药：请先盘点':'补药：增加放入的份数'}</option></select></label>`
   +field('份数','amount',p.amount??(s.remaining==null?'':String(s.remaining)),'number',true,'min="0" max="100000" step="1" inputmode="numeric"')+error+`<button class="primary" ${busy||!s.drugId?'disabled':''}>${busy?'保存中…':'保存实际份数'}</button></form>`;
  if(p.view==='journal')return intro+`<p class="helper">开仓是已确认的记录，不代表服药；“已用”来自安药中的服药确认。</p>`+error+slotJournalHTML(s.compartment);
  return intro+`<div class="surface detail-list"><div><span>已确认开仓</span><b>今日 ${s.openedToday} 次 · 累计 ${s.openedTotal} 次</b></div><div><span>已用份数</span><b>今日 ${s.consumedToday} 份 · 累计 ${s.consumedTotal} 份</b></div><div><span>最近开仓</span><b>${esc(ledgerTime(s.lastOpenedAt))}</b></div><div><span>最近份数更新</span><b>${esc(ledgerTime(s.stockUpdatedAt))}</b></div></div>`
   +(s.stockNeedsReview?`<p class="pillbox-feedback">${esc(stockIssueText(s))}</p>`:'')+error
   +`<div class="action-grid"><button type="button" data-action="pillbox-slot-bind" data-id="${s.compartment}" ${busy?'disabled':''}>${s.drugId?'更换 / 解绑药物':'绑定药物'}</button><button type="button" data-action="pillbox-slot-stock" data-id="${s.compartment}" ${busy||!s.drugId?'disabled':''}>装药 / 补药 / 盘点</button></div>`
   +`<div class="action-grid"><button type="button" data-action="pillbox-slot-open" data-id="${s.compartment}" ${busy?'disabled':''}>记录一次开仓</button><button type="button" data-action="pillbox-slot-journal" data-id="${s.compartment}" ${busy?'disabled':''}>查看这一仓日志</button></div><p class="helper">开仓不等于服药，也不会扣减份数。吃药后仍在“今天”点“我吃了”。</p>`;
 }
 function unassignedPanelBody(){
  const rows=unassignedRows(),busy=ledgerBusy();
  return `<p class="helper">这些活动记录没有可靠仓位。只有你确认是哪一仓打开过，才会计入该仓的“已确认开仓”；不会扣药。</p>`
   +retryLedgerHTML()
   +(ledger.error?`<p class="pillbox-feedback" role="alert">${esc(ledger.error)}</p>`:'')
   +(rows.length?rows.slice(0,100).map(r=>`<form class="surface pill-unassigned-record" data-kind="pillbox-slot-assign-open" data-source-key="${esc(r.key)}" data-device-id="${esc(ledgerDeviceId())}"><strong>${esc(ledgerTime(r.timestamp))}</strong><p class="helper">${esc(r.deviceName||'药盒活动')}</p><label class="m-field"><span>我确认打开的是</span><select name="compartment" ${busy?'disabled':''}><option value="">请选择仓位</option>${ledgerSlots().map(s=>`<option value="${s.compartment}">${s.compartment} 号仓${s.drugName?' · '+esc(s.drugName):''}</option>`).join('')}</select></label><button class="secondary-btn" ${busy?'disabled':''}>确认归属并记录开仓</button></form>`).join(''):'<p class="empty">没有待归属的活动记录。</p>');
 }
 function paintSlotPanel(){
  if(!ledger.panel)return;
  if(!ledger.busy&&document.activeElement?.matches?.('input,select,textarea'))return;
  if(ledger.panel.view==='unassigned'){
   if(document.querySelector('#detail-dialog[open] [data-pillbox-unassigned-panel]'))panel('未归属活动',`<div data-pillbox-unassigned-panel>${unassignedPanelBody()}</div>`);
  }else if(document.querySelector('#detail-dialog[open] [data-pillbox-slot-panel]'))panel(`${ledger.panel.compartment} 号仓`, `<div data-pillbox-slot-panel>${slotPanelBody()}</div>`);
 }
 async function openSlotPanel(compartment,view='detail'){
  if(ledgerBusy())return;
  if(![1,2,3,4].includes(Number(compartment)))throw Error('仓位无效');
  ledger.panel={compartment:Number(compartment),view};ledger.error='';
  panel(`${compartment} 号仓`,`<div data-pillbox-slot-panel>${slotPanelBody()}</div>`);
  await refreshLedger();paintSlotPanel();
 }
 function lowStockHTML(){
  const low=lowStock();if(!low.length)return '';
  return `<div class="m-section"><h2 class="m-caption">需要补药</h2></div><div class="surface">${low.map(x=>`<button class="menu-row" data-action="refill" data-id="${esc(x.drug.id)}" data-lead="icon"><span class="row-icon">${icon('task')}</span><span class="row-body"><strong>${esc(x.drug.name)} 快吃完了</strong><small>还剩 ${x.drug.inventory||0} 片 · 大约 ${x.days} 天</small></span><span class="arrow" aria-hidden="true"></span></button>`).join('')}</div>`;
 }
 function boxPage(){
  const s=box.status;
  return heading('药盒')
   +ledgerScopeHTML()
   +`<p class="helper pill-slot-help">一份是一次服用量；确认服药扣 1 份，开仓不扣药。仓位份数与药物总库存分开记录。</p>`
   +(ledger.error?`<p class="pillbox-feedback" role="alert">${esc(ledger.error)}</p><button type="button" class="secondary-btn" data-action="pillbox-ledger-refresh" ${ledgerBusy()?'disabled':''}>重新载入药仓</button>`:'')
   +(ledger.retry?`<p class="helper">上次保存结果尚未确认，请重试确认后再进行其他药仓操作。</p>`+retryLedgerHTML():'')
   +`<div class="pill-slot-grid">${slotRowsHTML()}</div>`
   +unassignedHTML()
   +activityHTML()
   +statusCardHTML()
   +(box.error?`<p class="pillbox-feedback" role="alert">${esc(box.error)}</p>`:box.busy&&box.message?`<p class="helper" role="status">${esc(box.message)}</p>`:'')
   +(drift()?`<button class="surface notice" data-action="pillbox-plan">${icon('clock')}<span>用药计划改过了，药盒里还是旧的提醒。轻点重新下发</span></button>`:'')
   +(s?.plansPushedAt?`<p class="helper">${plans().length?`计划在 ${esc(when(s.plansPushedAt))} 下发，药盒已逐条确认。`:`在 ${esc(when(s.plansPushedAt))} 清空了全部提醒，药盒已确认。`}</p>`:'')
   +lowStockHTML()
   +`<div class="m-section"><h2 class="m-caption">药盒设置</h2></div><div class="surface">`
     +row('药盒提醒时间','与仓位份数分开设置；连接后才会下发硬件','clock','data-action="pillbox-plan"')
     +row(connected()?'管理药盒':'连接药盒',connected()?(s?.name||'HiPee 智能药盒'):supported()?'短按药盒顶部按钮唤醒后搜索':'需要安药安卓应用，或支持蓝牙的 Chrome / Edge','shield','data-action="pillbox-connect"')
     +row('药盒记录',s?.lastSyncAt?`上次同步 ${when(s.lastSyncAt)}`:'读取药盒自己记下的活动记录','report','data-action="pillbox-records"')
   +`</div>`+(window.PillboxBehaviorUI?.html?.()||'');
 }
 pages.box=boxPage;
 /* ---------- 连接药盒 ---------- */

 function connectBody(){
  const s=box.status,on=connected();
  const facts=on?['设备已就绪',s.battery!=null?`电量 ${s.battery}%`:'',s.firmware?`固件 ${s.firmware}`:'',s.recordsReadAt?'记录已读取':'',s.cloudPending?'家庭服务待同步':'',s.identity?.mac||''].filter(Boolean).join(' · '):'';
  return `<div class="device-connect"><section class="surface device-card"><div class="detail-hero"><span class="row-icon">${icon('shield')}</span><div><strong>${esc(s?.name||'智能药盒')}</strong><small class="pillbox-state ${on?'ready':''}">${on?'已连接':'尚未连接'}</small></div></div>`
   +`<p class="helper" role="status">${esc(box.busy?box.message:box.message||(on?facts:'短按药盒顶部按钮唤醒药盒，再搜索并选择它。'))}</p>`+batteryWarning()
   +`<div class="action-grid"><button type="button" data-action="pillbox-op" data-id="scan" ${!supported()||box.busy?'disabled':''}>${box.busy&&box.message===messages.scan?'正在搜索…':'搜索药盒'}</button>`
   +(on?`<button type="button" data-action="pillbox-op" data-id="disconnect" ${box.busy?'disabled':''}>断开药盒</button>`:`<button type="button" data-action="pillbox-op" data-id="reconnect" ${!supported()||box.busy||!s?.savedDevice?'disabled':''}>重新连接</button>`)
   +`</div></section>`
   +(box.error?`<p class="pillbox-feedback" role="alert">${esc(box.error)}</p>`:'')
   +(box.devices.length?`<section class="surface pillbox-choices"><h3>可连接的药盒</h3>${box.devices.map(d=>`<button type="button" class="menu-row" data-action="pillbox-op" data-id="connect" data-device="${esc(d.id)}" ${box.busy&&box.operation!=='scan'?'disabled':''}><span class="row-body"><strong>${esc(d.name)}</strong><small>${d.rssi?`信号 ${esc(d.rssi)} · `:d.saved?'已保存 · 请先唤醒 · ':''}轻点连接</small></span><span class="arrow" aria-hidden="true"></span></button>`).join('')}</section>`:'')
   +`<ol class="device-steps"><li>短按药盒顶部按钮唤醒药盒（药盒只在唤醒后的一小段时间里能被找到）。</li><li>点「搜索药盒」，在列表里选你的药盒。</li><li>连上后安药会把手机时间发给药盒，再到「装药与提醒」里下发计划。</li><li>下发完可以断开，药盒按计划自己响铃亮灯。</li></ol>`
   +(on?`<div class="action-grid"><button type="button" data-action="pillbox-op" data-id="find" ${box.busy?'disabled':''}>寻找药盒</button><button type="button" data-action="pillbox-op" data-id="calibrate" ${box.busy?'disabled':''}>校准时间</button><button type="button" data-action="pillbox-op" data-id="query" ${box.busy?'disabled':''}>读取电量</button></div>`:'')
   +`<details class="surface pillbox-details"><summary>帮助</summary><p class="helper">搜索不到时再唤醒一次，并关掉正在连接这个药盒的其他应用（如果实智能药盒小程序）。</p><p class="helper">药盒的绑定与解绑请在果实智能药盒小程序里管理；安药只做校时、下发提醒、读取记录和寻找药盒。</p><p class="helper">支持 HiPee / Hi-PB1 四仓药盒；响铃与灯光由药盒固件决定。</p>${!supported()?`<p class="helper">${navigator.bluetooth&&!window.isSecureContext?'浏览器只在 https 地址或本机地址下允许蓝牙。':'连接药盒需要安药安卓应用，或电脑 / 安卓手机上的 Chrome、Edge。'}</p>`:''}</details></div>`;
 }
 function paintConnect(){const d=connectDialog();if(d)d.querySelector('#pillbox-connect-body').innerHTML=connectBody()}
 async function openConnect(){const d=connectDialog();if(!d)return;paintConnect();if(!d.open)d.showModal();try{await status()}catch(e){box.error=e.message}if(connectOpen())paintConnect()}

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
   return `<label class="m-field"><span>${esc(d.name)}${d.dose?' · '+esc(d.dose):''} · ${esc(repeat(d))} ${esc((d.times||[]).join('、'))}</span><select data-pillbox-slot="${esc(d.id)}"><option value="0"${a.compartment?'':' selected'}>不放进药盒</option>${[1,2,3,4].map(n=>`<option value="${n}"${a.compartment===n?' selected':''}>${n} 号仓</option>`).join('')}</select></label>`}).join('');
  return `<p class="helper">每种药放进一个仓位，药盒按这些时间提醒（每仓最多 9 个时间）。下发会替换药盒 4 个仓的全部提醒，没有分配的仓会清空。</p><p class="helper">当前药盒仅验证了每天重复。非每日计划请先选择“不放进药盒”，手机仍按已保存的计划提醒；若药盒里已有这份药的旧每日计划，须连接后重新下发完整计划或清空，避免旧提醒继续响。</p>`
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
  const body=records.length?`<div class="surface pillbox-records"><div class="pillbox-timeline">${records.slice(0,60).map(r=>`<article><time datetime="${new Date(r.timestamp*1000).toISOString()}">${esc(stamp(r.timestamp*1000))}</time><div><strong>药盒活动记录</strong><small>${esc(r.deviceName||'智能药盒')} · 是否吃了药需要你核对</small></div></article>`).join('')}</div></div>${records.length>60?'<p class="helper">展示最近 60 条，完整记录随本机备份保存。</p>':''}`
   :'<p class="empty">还没有药盒记录。连接药盒后点「同步药盒记录」。</p>';
  return body+`<p class="helper">药盒原始活动记录不能证明实际服药，部分状态和仓位仍未确定。吃了药请本人点“我吃了”，安药不会据此自动记为已服药。</p>`
   +`<button class="secondary-btn" data-action="pillbox-op" data-id="sync" ${!connected()||box.busy?'disabled':''}>${box.busy&&box.message===messages.sync?'正在同步…':'同步药盒记录'}</button>`;
 }

 const messages={scan:'正在搜索，请短按药盒按钮唤醒…',connect:'正在连接药盒…',reconnect:'正在重新连接…',disconnect:'正在断开…',find:'正在让药盒响铃…',calibrate:'正在把手机时间发给药盒…',query:'正在读取电量…',sync:'正在读取药盒记录…',push:'正在下发计划，请让药盒靠近手机…'};
 async function run(operation,extra={}){
  if(box.busy&&!(box.operation==='scan'&&operation==='connect'))return;
  const token=++box.operationToken;box.operation=operation;
  box.busy=true;box.message=messages[operation]||'';box.error='';
  const paint=()=>{if(connectOpen())paintConnect();paintPlan();if(document.querySelector('#detail-dialog[open] .pillbox-records,#detail-dialog[open] [data-id="sync"]'))panel('药盒记录',recordsHTML());syncBoxPage(true)};
  paint();
  try{
   if(operation==='scan'){const list=await call('hipeeScan');if(token!==box.operationToken)return;box.devices=Array.isArray(list)?list:list?.devices||[]}
   else if(operation==='connect'){await call('hipeeConnect',extra);box.devices=[]}
   else if(operation==='reconnect')await call('hipeeReconnect');
   else if(operation==='disconnect'){await call('hipeeDisconnect');box.devices=[]}
   else if(operation==='find'){await call('hipeeFind');toast('寻找指令已发出，请确认药盒是否响铃或亮灯')}
   else if(operation==='calibrate'){await call('hipeeCalibrate');toast('已把手机时间发给药盒')}
   else if(operation==='query'){const r=await call('hipeeQuery');toast(`药盒电量 ${r?.battery??'未知'}%`)}
   else if(operation==='sync'){const r=await call('hipeeSync');history().then(()=>refreshQuietly()).catch(()=>{});if(token!==box.operationToken)return;toast(`设备已读取 ${r?.count??0} 条记录${r?.complete===false?'（完整性待确认）':''}；${r?.pending?'家庭服务待同步':'家庭服务已更新'}，服药请本人确认`)}
   else if(operation==='push'){
    const drugs=fixedDrugs();
    const list=M.plans(box.draft.filter(x=>x.compartment&&drugs.some(d=>d.id===x.drugId)).map(x=>{const d=drugs.find(y=>y.id===x.drugId);return{compartment:x.compartment,times:d.times,weekdays:weekdays(d),drugId:d.id,drugName:d.name}}));
    const s=await call('hipeeStatus');if(!s?.connected||!s.deviceId)throw Error('药盒没有连接，请先连接药盒');
    if(paused(s)?.pending)throw Error('上次药盒提醒开关尚未完成，请先在“设置 → 提醒设备”里重试，计划尚未修改');
    if(!reminderEnabled(s)){
     persistPause(s,{enabled:false,plans:list});box.draft=null;toast('计划已保存；药盒提醒仍关闭，在设置中开启后才会下发');
    }else{
     const r=await call('hipeePushPlans',{plans:list});
     if(r?.confirmed!==true)throw Error('药盒尚未确认提醒计划，请重试');
     const after=await call('hipeeStatus');if(!after?.connected||after.deviceId!==s.deviceId)throw Error('药盒连接已变化，请重新连接后检查计划');
     persistPause(after,{enabled:true,plans:list});
     box.draft=null;toast(list.length?`药盒已确认 ${r?.pushed??0} 个提醒`:'药盒里的提醒已全部清空');
    }
   }
   if(token!==box.operationToken)return;
   await status();
   box.message=operation==='scan'?(box.devices.length?'选择要连接的药盒':'没有找到药盒，请再唤醒一次'):'';
  }catch(error){if(token===box.operationToken){box.error=error.message;box.message=''}}
  finally{if(token===box.operationToken){box.busy=false;paint();if(operation==='push'&&!box.error&&document.querySelector('#detail-dialog[open] [data-action="pillbox-plan-send"]'))panelBack(true)}}
 }

 const baseDispatch=dispatchAction;
 dispatchAction=async function(a,id,el){
  if(a==='pillbox-ledger-retry'){
   if(ledgerBusy()||!ledger.retry)return;
   const r=ledger.retry;
   if(r.body.deviceId!==ledgerDeviceId())throw Error('请切回上次操作的药盒范围后重试');
   return mutateLedger(r.path,r.body,{method:r.method,label:r.label,requestKey:r.requestKey});
  }
  if(a==='pillbox-ledger-refresh'){if(!ledgerBusy())await refreshLedger({force:true});return}
  if(a==='pillbox-ledger-activate')return mutateLedger('pillbox/activate',{deviceId:ledgerDeviceId()},{label:'已设为当前用药药盒'});
  if(a==='pillbox-slot')return openSlotPanel(id);
  if(a==='pillbox-slot-bind')return openSlotPanel(id,'bind');
  if(a==='pillbox-slot-stock')return openSlotPanel(id,'stock');
  if(a==='pillbox-slot-journal')return openSlotPanel(id,'journal');
  if(a==='pillbox-slot-open'){
   if(ledgerBusy())return;
   const n=Number(id);if(![1,2,3,4].includes(n))throw Error('仓位无效');
   const deviceId=ledgerDeviceId();
   return mutateLedger(`pillbox/slots/${n}/open`,{deviceId},{label:`已记录 ${n} 号仓开仓，没有扣药`,requestKey:JSON.stringify([deviceId,n,'open'])});
  }
  if(a==='pillbox-unassigned'){
   if(ledgerBusy())return;
   ledger.panel={view:'unassigned'};ledger.error='';
   panel('未归属活动',`<div data-pillbox-unassigned-panel>${unassignedPanelBody()}</div>`);
   await refreshLedger();paintSlotPanel();return;
  }
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
   markSeen();await load();await refreshLedger({force:true});toast('已记下，家属那边也能看到');syncBoxPage(true);return;
  }
  if(a==='pillbox-activity-dismiss'){markSeen();syncBoxPage(true);return}
  if(a==='pillbox-op')return run(id,{deviceId:el?.dataset.device});
  return baseDispatch(a,id,el);
 };

 formHandlers['pillbox-slot-bind']=async form=>{
  if(ledgerBusy())return;
  const n=Number(form.dataset.id),deviceId=form.dataset.deviceId;
  const drugId=String(new FormData(form).get('drugId')||'');
  if(![1,2,3,4].includes(n))throw Error('仓位无效');
  if(drugId&&!state.drugs.some(d=>d.id===drugId))throw Error('这份药已不存在，请重新选择');
  if(await mutateLedger(`pillbox/slots/${n}`,{deviceId,drugId},{method:'PATCH',label:drugId?'仓位药物已保存，请按实际药量盘点份数':'已解除药物绑定'})){
   ledger.panel={compartment:n,view:'detail'};paintSlotPanel();
  }
 };
 formHandlers['pillbox-slot-stock']=async form=>{
  if(ledgerBusy())return;
  const data=new FormData(form),n=Number(form.dataset.id),deviceId=form.dataset.deviceId,kind=String(data.get('kind')||''),raw=String(data.get('amount')??'').trim();
  const amount=Number(raw);
  if(![1,2,3,4].includes(n))throw Error('仓位无效');
  if(!['set','add'].includes(kind))throw Error('请选择装药盘点或补药');
  if(!/^\d+$/.test(raw)||!Number.isSafeInteger(amount)||amount<0||amount>100000||(kind==='add'&&amount===0))throw Error(kind==='add'?'补药份数要填 1 到 100000 的整数':'实际份数要填 0 到 100000 的整数');
  if(ledger.panel){ledger.panel.stockKind=kind;ledger.panel.amount=raw}
  if(await mutateLedger(`pillbox/slots/${n}/stock`,{deviceId,kind,amount},{label:kind==='add'?'补药份数已保存':'实际剩余份数已保存',requestKey:JSON.stringify([deviceId,n,'stock',kind,amount])})){
   ledger.panel={compartment:n,view:'detail'};paintSlotPanel();
  }
 };
 formHandlers['pillbox-slot-assign-open']=async form=>{
  if(ledgerBusy())return;
  const n=Number(new FormData(form).get('compartment')),deviceId=form.dataset.deviceId,sourceKey=form.dataset.sourceKey;
  if(![1,2,3,4].includes(n))throw Error('请先选择你确认打开的仓位');
  if(!unassignedRows().some(r=>r.key===sourceKey))throw Error('这条活动已经处理过，请刷新后查看');
  await mutateLedger(`pillbox/slots/${n}/open`,{deviceId,sourceKey},{label:`已人工归属到 ${n} 号仓，没有扣药`,requestKey:JSON.stringify([deviceId,n,'source-open',sourceKey])});
 };

 document.addEventListener('change',e=>{
  const scope=e.target.closest?.('[data-pillbox-ledger-device]');
  if(scope){if(ledgerBusy())return;const next=scope.value;if(next!=='local'&&!validDeviceId(next))return;ledger.scope=next;ledger.panel=null;ledger.error='';syncBoxPage(true);refreshLedger({force:true}).catch(error=>toast(error.message));return}
  const sel=e.target.closest?.('[data-pillbox-slot]');if(!sel||!box.draft)return;
  const item=box.draft.find(x=>x.drugId===sel.dataset.pillboxSlot);if(item)item.compartment=Number(sel.value);
  box.error='';
 });
 connectDialog()?.addEventListener('close',()=>syncBoxPage(true));
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)status().catch(()=>{})});
 window.addEventListener('anyao-pillbox-push',event=>{
  const d=event.detail||{};
  if(Array.isArray(d.devices))box.devices=d.devices;
  if(d.recordsRead){
   if(box.operation==='sync')box.busy=false;
   if(!box.busy)box.message=`设备已读取 ${d.count??0} 条记录；${d.cloudPending?'家庭服务正在同步':'已保存在本机'}`;
  }
  if(d.recordError)box.error=d.recordError;
  if(connectOpen())paintConnect();syncBoxPage(true);
  status().then(()=>{if(connectOpen())paintConnect()}).catch(()=>{});
 });
 /* load() 已经整页重绘过，这里只对齐签名，避免同一份数据再画一遍 */
 window.addEventListener('anyao-loaded',()=>{box.signature=signature();emit();refreshLedger().catch(()=>{})});
 status().catch(()=>{}).then(()=>history().catch(()=>{})).then(()=>refreshLedger().catch(()=>{}));
})();
