/* Complete, paginated evidence history shared by the medication and family views. */
(() => {
 let rows=[],limit=50,deviceFilter='all',kindFilter='all',lastSignature='';
 // Ledger claims predate PillboxModel's legacy key naming; use the ledger identity.
 const sourceKey=r=>r.eventType!==undefined?`event:${r.eventType}:${r.compartment}:${r.timestamp}`:r.rawFlag!==undefined?PillboxModel.key(r):`decoded:${r.compartment}:${r.reportedTaken??r.taken??false}:${r.timestamp}`;
 const activityLabel=r=>({lid_close:'设备上报关盖',lid_open:'设备上报开盖',dose_taken:'设备上报服药动作',wrong_time_open:'设备上报错时开盖'}[String(r.eventType||'').toLowerCase()]||'药盒活动')+' · 仓位未确认';
 const when=v=>new Date(v).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
 const body=()=>{
  const devices=[...new Map(rows.map(r=>[r.deviceId,r.deviceName||r.deviceId])).entries()];
  const filtered=rows.filter(r=>(deviceFilter==='all'||r.deviceId===deviceFilter)&&(kindFilter==='all'||r.kind===kindFilter));
  return `<div data-pillbox-evidence><p class="helper">每条已收到的药盒活动和人工确认开仓均在此保存，按时间倒序显示。设备未提供可靠仓位时显示“仓位未确认”；开仓不等于服药，也不扣药。未连接期间的记录在药盒支持离线存储并重新连接后补读。</p><div class="surface"><label class="m-field"><span>药盒</span><select data-record-device><option value="all">全部药盒</option>${devices.map(([id,name])=>`<option value="${esc(id)}" ${id===deviceFilter?'selected':''}>${esc(name)} · ${esc(id)}</option>`).join('')}</select></label><label class="m-field"><span>记录类型</span><select data-record-kind><option value="all">全部记录</option><option value="open" ${kindFilter==='open'?'selected':''}>已确认开仓</option><option value="activity" ${kindFilter==='activity'?'selected':''}>仓位未确认的设备活动</option></select></label></div><p class="helper">共 ${filtered.length} 条，已显示 ${Math.min(limit,filtered.length)} 条</p><div class="surface pillbox-records"><div class="pillbox-timeline">${filtered.slice(0,limit).map(r=>`<article><time datetime="${new Date(r.at).toISOString()}">${esc(when(r.at))}</time><div><strong>${r.kind==='open'?`${r.compartment} 号仓 · 已确认开仓`:esc(activityLabel(r))}</strong><small>${esc(r.deviceName)} · ${r.source==='manual-user-confirmed'?'人工补记':r.kind==='open'?'根据设备记录人工确认':'设备原始上报'}${r.pending?' · 等待同步':''}</small>${r.drugName?`<small>${esc(r.drugName)}</small>`:''}${r.raw?`<details><summary>查看设备原始记录</summary><code>${esc(r.raw)}</code></details>`:''}</div></article>`).join('')||'<p class="empty">还没有收到药盒记录。</p>'}</div></div>${filtered.length>limit?'<button class="secondary-btn" data-action="pillbox-evidence-more">继续显示 50 条</button>':''}<button class="secondary-btn" data-action="pillbox-evidence-refresh">刷新全部记录</button></div>`;
 };
 async function open(reset=true){
  if(reset){limit=50;deviceFilter='all';kindFilter='all'}
  const history=await api('hipee-history');
  const active=await api('pillbox');
  const ids=[...new Set([active.deviceId,...(active.deviceIds||[]),...history.map(h=>h.deviceId)])];
  const views=await Promise.all(ids.map(id=>id===active.deviceId?active:api('pillbox?deviceId='+encodeURIComponent(id))));
  rows=[];
  for(const view of views){
   const archive=history.find(h=>h.deviceId===view.deviceId),deviceName=archive?.deviceName||'药盒';
   const claims=new Set();
   for(const r of view.journal||[]){if(r.kind!=='open')continue;if(r.sourceKey)claims.add(r.sourceKey);rows.push({...r,deviceName,at:Date.parse(r.at)})}
   for(const raw of archive?.records||[]){const key=sourceKey(raw);if(claims.has(key))continue;rows.push({id:view.deviceId+':'+key,deviceId:view.deviceId,deviceName,kind:'activity',eventType:raw.eventType,at:raw.timestamp*1000,raw:raw.rawFrame||'',pending:!!raw.syncPending})}
  }
  rows.sort((a,b)=>b.at-a.at||String(a.id).localeCompare(String(b.id)));
  const signature=JSON.stringify(rows);
  if(!reset&&lastSignature===signature&&document.querySelector('[data-pillbox-evidence]'))return;
  lastSignature=signature;
  panel('开仓与设备活动记录',body());
 }
 const previous=dispatchAction;
 dispatchAction=async function(a,id,el){
  if(a==='pillbox-evidence'||a==='pillbox-records')return open();
  if(a==='pillbox-evidence-refresh')return open(false);
  if(a==='pillbox-evidence-more'){limit+=50;return panel('开仓与设备活动记录',body())}
  return previous(a,id,el);
 };
 document.addEventListener('change',e=>{if(e.target.matches('[data-record-device]')){deviceFilter=e.target.value;limit=50;panel('开仓与设备活动记录',body())}if(e.target.matches('[data-record-kind]')){kindFilter=e.target.value;limit=50;panel('开仓与设备活动记录',body())}});
 window.addEventListener('anyao-loaded',()=>{if(document.querySelector('[data-pillbox-evidence]')&&!document.activeElement?.matches('input,select,textarea'))open(false).catch(()=>{})});
})();
