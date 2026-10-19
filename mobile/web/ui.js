/* 安药 · 服药端（老人手机）。
   一屏只做一件事：现在该吃什么 → 点“我吃了” → 家属那边看得到。
   视觉取值全部来自 mira.css，业务布局来自 app.css。 */

/* 药盒简图：药盒页的示意与开合动画，跟随主题令牌。 */
const deviceArt={
  pillbox:`<svg viewBox="0 0 160 120" aria-hidden="true"><rect class="d-shadow" x="24" y="104" width="112" height="6" rx="3"/><rect class="d-body" x="26" y="44" width="108" height="58" rx="13"/><rect class="d-soft" x="36" y="52" width="42" height="19" rx="6"/><rect class="d-soft" x="82" y="52" width="42" height="19" rx="6"/><rect class="d-soft" x="36" y="75" width="42" height="19" rx="6"/><rect class="d-soft" x="82" y="75" width="42" height="19" rx="6"/><g class="d-lid"><rect class="d-body" x="26" y="32" width="108" height="16" rx="8"/><rect class="d-chip" x="70" y="38" width="20" height="4" rx="2"/></g><circle class="d-accent" cx="124" cy="40" r="3"/></svg>`
};
const deviceHeroHTML=(kind,name,status,action,label)=>`<section class="surface device-hero" data-device="${kind}"><div class="device-art">${deviceArt[kind]||''}</div><div class="device-hero-body"><h3>${esc(name)}</h3>${status?`<p class="helper" role="status">${esc(status)}</p>`:''}<button class="m-btn m-btn-primary" ${action}>${esc(label)}</button></div></section>`;

/* ---------- 今天 ---------- */

/* 记录里存的是 HH:mm；补记过就是补记的时间。 */
const clockOf=dose=>dose.time||dose.planned;

function doseLinesHTML(list){
  if(!list.length)return state.drugs.some(d=>!d.asNeeded)?'<p class="empty">今天没有要按时吃的药。</p>':'<p class="empty">还没有登记要按时吃的药。在「用药」里添加后，这里会列出每天的每一次。</p>';
  return [...list].sort((a,b)=>a.planned.localeCompare(b.planned)).map(d=>{
    const taken=d.status==='taken';
    return `<div class="dose-row" data-level="${esc(d.level)}">
      <button class="dose-main" data-action="dose" data-id="${esc(d.eventId)}">
        <b class="dose-time">${esc(d.planned)}</b>
        <span class="dose-copy"><strong>${esc(d.drug?.name||'已移除的药物')}</strong><small>${esc(d.drug?.dose||'')}${taken?` · 实际 ${esc(clockOf(d))}`:''}</small></span>
        <span class="dose-state">${esc(doseLabels[d.level]||'')}</span>
      </button>
      <button class="dose-check" data-action="dose-quick" data-id="${esc(d.eventId)}" data-state="${doseState(d.status)}" aria-label="${taken?'已经吃过，轻点可以修改':'标记为已经吃过'}">${taken?icon('check'):icon('circle')}</button>
    </div>`;
  }).join('');
}

function takeCardHTML(dose,done,total){
  if(!dose&&!total&&state.drugs.some(d=>!d.asNeeded&&(d.times||[]).length)){
    const next=nextPlanned();return `<section class="surface take-card" data-level="done"><p class="take-label">今天没有按时服药计划</p><p class="take-time">${next?esc(next.time):'—'}</p><p class="take-name">${next?'下次 '+esc(next.day):'请检查用药计划'}</p></section>`;
  }
  if(!dose)return `<section class="surface take-card" data-level="done">
    <p class="take-label">${total?'今天的药都吃完了':'还没有用药计划'}</p>
    <p class="take-time">${total?`已吃 ${done} / ${total} 次`:'先登记用药'}</p>
    ${total?'':'<p class="take-name">把每天要吃的药和时间记下来，到点就会提醒你</p><button class="m-btn m-btn-primary mega-btn" data-action="med-add">'+icon('plus')+'添加第一种药</button>'}
  </section>`;
  const tone=dose.level==='missed'?'missed':dose.level==='due'?'due':dose.level==='delay'?'delay':'pending';
  return `<section class="surface take-card" data-level="${tone}">
    <p class="take-label">${esc(dose.level==='due'?'该吃药了':dose.level==='missed'?'这顿药还没吃':dose.level==='delay'?'说好晚点吃':'下一次吃药')}</p>
    <p class="take-time">${esc(dose.planned)}</p>
    <p class="take-name">${esc(dose.drug?.name||'已移除的药物')}<span>${esc(dose.drug?.dose||'')}</span></p>
    ${dose.drug?.note?`<p class="take-note">${esc(dose.drug.note)}</p>`:''}
    <button class="m-btn m-btn-primary mega-btn" data-action="dose-quick" data-id="${esc(dose.eventId)}" data-state="${doseState(dose.status)}">${icon('check')}我吃了</button>
  </section>`;
}

/* 家属那边对这次服药做过什么，回到老人这一端说一句。 */
function familyNoticeHTML(){
  const recent=[...state.log].sort((a,b)=>Date.parse(b.at)-Date.parse(a.at))[0];
  if(!recent)return '';
  const who=state.family.contacts.find(c=>c.id===recent.by)||state.family.contacts[0];
  const name=who?.name||'家人';
  const what=familyActionText(recent);
  return `<p class="surface notice">${icon('share')}<span>${esc(name)}${esc(what)}${recent.dose?` ${esc(recent.dose.planned)} 这次的吃药`:''}</span></p>`;
}

/* 需要时才吃的药：没有固定时间，吃一次点一次 */
function asNeededHTML(){
  const list=state.drugs.filter(d=>d.asNeeded);
  if(!list.length)return '';
  const today=dayKey(new Date());
  return `<div class="m-section"><h2 class="m-caption">需要时才吃</h2></div><div class="surface">${list.map(d=>{
    const n=state.history.filter(e=>e.drugId===d.id&&e.date===today&&e.status==='taken').length;
    return row(d.name,`${n?`今天已吃 ${n} 次`:'今天还没吃'} · 剩 ${d.inventory||0} ${esc(inventoryUnit(d))} · 轻点记一次`,'task',`data-action="as-needed" data-id="${esc(d.id)}"`,'',doseBadge(d.dose));
  }).join('')}</div>`;
}

function todayPage(){
  const date=new Date().toLocaleDateString('zh-CN',{timeZone:'Asia/Shanghai',month:'long',day:'numeric',weekday:'long'});
  const done=state.doses.filter(d=>d.status==='taken').length;
  const next=state.doses.find(d=>['missed','due','delay','pending'].includes(d.level));
  const urgent=state.doses.some(d=>['missed','due'].includes(d.level));
  return `<div class="today-head">${heading('今天',headIcon('header-message','data-action="today-plan"','今天的服药记录'),date)}</div>`
    +(window.reminderBlockedHTML?reminderBlockedHTML():'')
    +takeCardHTML(next,done,state.doses.length)
    +statsCardHTML()
    +familyNoticeHTML()
    +`<div class="m-section"><h2 class="m-caption">${urgent?'今天还有药没吃':'今天的药'}</h2></div>`
    +`<div class="surface">${doseLinesHTML(state.doses)}</div>`
    +asNeededHTML();
}

/* ---------- 设置 ---------- */

function familySectionHTML(){
  const contacts=state.family.contacts;
  return `<div class="m-section"><h2 class="m-caption">家属</h2><button data-action="contacts-manage">${contacts.length?'管理':'添加'}</button></div>`
    +`<div class="surface">${contacts.length
      ?contacts.map(c=>`<button class="menu-row" data-action="call-family" data-id="${esc(c.id)}" data-lead="icon"><span class="row-icon">${icon('share')}</span><span class="row-body"><strong>${esc(c.name)}${c.relation?` · ${esc(c.relation)}`:''}</strong><small>${esc(c.phone)} · 轻点打电话</small></span><span class="arrow" aria-hidden="true"></span></button>`).join('')
      :'<button class="menu-row" data-action="contact-add" data-lead="icon"><span class="row-icon">'+icon('share')+'</span><span class="row-body"><strong>添加家属联系人</strong><small>没按时吃药时可以提醒家人，也能一键给家人打电话</small></span><span class="arrow" aria-hidden="true"></span></button>'}</div>`
    +(contacts.length?escalationHTML():'');
}

/* 超时没吃药时：等多久算没吃、自动短信、自动电话（都默认关闭，都在这部手机上用 SIM 卡执行） */
function escalationHTML(){
  const f=state.family,who=f.contacts.find(c=>c.id===f.autoCallContactId);
  return `<div class="m-section"><h2 class="m-caption">超时没吃药时</h2></div>`
    +`<div class="surface"><div class="setting-row"><span>等多久算没吃<small>到点后这么久还没点「我吃了」，会再提醒你一次</small></span>${segmented('missed-after',String(f.missedAfterMinutes),[['15','15 分'],['30','30 分'],['60','1 小时']])}</div>`
    +(window.AndroidApp
      ?`<button type="button" class="setting-row" data-action="auto-sms" data-id="sms" aria-pressed="${!!f.autoNotify}"><span>自动发短信给家属<small>${f.autoNotify?'超时没吃会用本机 SIM 卡给每位家属发一条短信':'已关闭'}</small></span><span class="switch ${f.autoNotify?'on':''}" aria-hidden="true"></span></button>`
       +`<button type="button" class="menu-row" data-action="call-settings"><span class="row-body"><strong>自动打电话给家属</strong><small>${f.autoCall&&who?`已开启 · 打给 ${esc(who.name)}`:'已关闭'}</small></span><span class="arrow" aria-hidden="true"></span></button>`
      :`<p class="helper">自动短信和自动电话需要安药安卓应用。</p>`)
    +`</div>`;
}
const callView={status:null,pick:''};
function callBody(){
  const f=state.family,st=callView.status,pick=callView.pick||f.autoCallContactId||f.contacts[0]?.id||'';
  const target=f.contacts.find(c=>c.id===pick);
  const attempts=(st?.attempts||[]).slice().reverse().slice(0,20);
  return `<p class="helper">超过 ${f.missedAfterMinutes} 分钟还没记录吃药，用这部手机的 SIM 卡给选定的家属打一个普通电话。每一顿最多打一次，两次自动电话至少隔 10 分钟；开启以前错过的不会补打。</p>`
    +`<div class="m-section"><h2 class="m-caption">打给谁</h2></div><div class="surface">${f.contacts.map(c=>`<button type="button" class="setting-row" data-action="call-pick" data-id="${esc(c.id)}" aria-pressed="${c.id===pick}"><span>${esc(c.name)}${c.relation?` · ${esc(c.relation)}`:''}<small>${esc(c.phone)}</small></span><span class="switch ${c.id===pick?'on':''}" aria-hidden="true"></span></button>`).join('')}</div>`
    +`<div class="m-section"><h2 class="m-caption">这部手机准备好了吗</h2></div><div class="surface detail-list"><div><span>电话权限</span><b>${st?.callPermission&&st?.statePermission?'已允许':'待允许'}</b></div><div><span>SIM 卡</span><b>${esc(st?(st.ready?'可以拨打':st.reason):'检查中…')}</b></div></div>`
    +`<div class="action-grid"><button type="button" data-action="call-permission">允许电话权限</button><button type="button" data-action="call-sim">设置默认拨出卡</button></div>`
    +`<button type="button" class="setting-row surface" data-action="call-toggle" data-id="${esc(pick)}" aria-pressed="${!!f.autoCall}"><span>超时没吃时自动打电话<small>${f.autoCall?'已开启':'已关闭'}</small></span><span class="switch ${f.autoCall?'on':''}" aria-hidden="true"></span></button>`
    +`<p class="helper">打的是普通电话，没有语音播报，话费按这张卡的套餐算。“拨号请求已交给系统”只说明手机开始拨号，对方接没接请看通话记录。${target?'':'请先选择家属。'}</p>`
    +`<div class="m-section"><h2 class="m-caption">电话提醒记录</h2></div><div class="surface">${attempts.map(x=>`<div class="record-row"><b class="mono">${esc(stamp(x.at))}</b><span><strong>${esc(x.planned)} ${esc(x.drug)} · ${esc(x.contact)} ${esc(x.phoneMasked)}</strong><small>${esc(x.label)}</small></span></div>`).join('')||'<p class="empty">还没有自动电话记录。</p>'}</div>`;
}
const paintCall=()=>{if(document.querySelector('#detail-dialog[open] [data-call-panel]'))panel('自动打电话给家属',`<div data-call-panel>${callBody()}</div>`)};

/* ---------- 用药 ---------- */

function medsPage(){
  const list=filteredMeds(),fixed=list.filter(d=>!d.asNeeded),asNeeded=list.filter(d=>d.asNeeded);
  const line=d=>row(d.name,`${DrugModel.schedule(d)} · ${d.category||'未分类'} · 剩 ${d.inventory||0} ${inventoryUnit(d)}${!d.asNeeded&&d.times?.length&&stockDays(d)<=5?' · 快吃完了':''}`,'report',`data-action="med-detail" data-id="${esc(d.id)}"`,'',doseBadge(d.dose));
  if(!state.drugs.length)return heading('用药',headIcon('header-add','data-action="med-add"','添加药物'))
    +`<section class="surface take-card" data-level="done"><p class="take-label">还没有登记药物</p><p class="take-time">从第一种开始</p><p class="take-name">填药名、每次吃多少、哪些天几点吃，到点手机会提醒你</p><button class="m-btn m-btn-primary mega-btn" data-action="med-add">${icon('plus')}添加药物</button><button class="secondary-btn" data-action="med-scan">扫码添加</button></section>`;
  return heading('用药',headIcon('header-add','data-action="med-add"','添加药物'))
    +medFilterHTML()+`<button class="secondary-btn" data-action="med-scan">扫码添加</button>`
    +(!list.length?'<p class="empty">没有匹配的药物，请调整搜索或分类。</p>':'')
    +(fixed.length?`<div class="m-section"><h2 class="m-caption">按计划吃</h2></div><div class="surface">${fixed.map(line).join('')}</div>`:'')
    +(asNeeded.length?`<div class="m-section"><h2 class="m-caption">需要时才吃</h2></div><div class="surface">${asNeeded.map(line).join('')}</div>`:'')
    +`<div class="m-section"><h2 class="m-caption">库存</h2></div><div class="surface">`
      +row('补药记录','药还剩多少、什么时候补的','task','data-action="refill-history"')
    +`</div><p class="helper">点「我吃了」会按登记的数量扣减库存，撤销时退回当次实际扣减量；剩下不到 5 天时会提示补药。</p>`
    +`<button type="button" class="page-action" data-action="med-add">添加药物</button>`;
}

function settingsPage(){
  return heading('设置')
    +reminderSectionHTML()
    +(window.watchSectionHTML?watchSectionHTML():'')
    +familySectionHTML()
    +`<div class="m-section"><h2 class="m-caption">显示</h2></div><div class="surface">`
      +`<div class="setting-row"><span>字号<small>看不清时调大</small></span>${segmented('font-scale',appearance.fontScale,[['standard','标准'],['large','较大']])}</div>`
    +`</div>`
    +`<div class="m-section"><h2 class="m-caption">记录</h2></div><div class="surface">`
      +row('服药时间','每一次吃药的时间都在这里','report','data-action="dose-times"')
      +row('备份与恢复','保存或恢复本机记录','version','data-action="backup"')
      +row('同步与访问',remote()?'已连接家庭服务':'和家属的手机共用一份记录','link','data-action="sync-settings"')
      +row('关于安药','版本、隐私与使用说明','about','data-action="about"')
    +`</div><p class="helper">${remote()?'记录保存在你们自己的家庭服务上。':'服药记录只保存在这部手机上，不会上传。'}</p>`
    +`<button type="button" class="page-action" data-action="role-switch">切换到家属端</button>`;
}

pages.today=todayPage;
pages.meds=medsPage;
pages.settings=settingsPage;

/* ---------- 服药端的动作 ---------- */

const baseDispatch=dispatchAction;
dispatchAction=async function(a,id,el){
  if(a==='dose-quick'){
    if(!id)return;
    const dose=doseById(id);
    if(dose?.status==='taken')return action('dose',id);
    const receipt=await send('intake-events/'+encodeURIComponent(id),{status:'taken',time:nowTime()},'PATCH');
    await load();toast(receipt.inventoryDeducted===false?'已记录服药；库存不足，本次未扣减，请核对库存':'已记录服药');return;
  }
  if(a==='dose'){
    const d=doseById(id);if(!d){toast('这条记录已更新');return load()}
    const taken=d.status==='taken',t=nowTime();
    return panel(d.drug?.name||'服药记录',
      `<section class="dose-focus">
        <span class="row-icon">${icon('report')}</span>
        <strong class="dose-name">${esc(d.drug?.name||'')} ${esc(d.drug?.dose||'')}</strong>
        <h3>${esc(d.planned)}</h3>
        ${d.drug?.note?`<p>${esc(d.drug.note)}</p>`:''}
        <span class="badge ${esc(doseState(d.status))}">${esc(doseLabels[d.level]||'')}</span>
        ${taken?`<p class="helper">记录的时间是 ${esc(d.time)}</p>`:''}
      </section>`
      +(taken
        ?`<button class="secondary-btn" data-action="dose-save" data-id="${esc(d.eventId)}" data-status="scheduled">改成还没吃</button>`
        :`<button class="primary" data-action="dose-save" data-id="${esc(d.eventId)}" data-status="taken" data-time="${t}">刚刚吃的（现在 ${t}）</button>`
          +`<form data-kind="dose-time" data-id="${esc(d.eventId)}">
             <div class="m-section"><h2 class="m-caption">记不清几点</h2></div>
             <label class="m-field"><span>我大概是这个时间吃的</span><input type="time" name="time" value="${esc(d.planned)}" required /></label>
             <button class="secondary-btn">按这个时间记成已服用</button>
           </form>`
          +`<div class="m-section"><h2 class="m-caption">晚点再吃</h2></div><div class="action-grid snooze-grid">${[15,30,60].map(n=>`<button type="button" data-action="dose-save" data-id="${esc(d.eventId)}" data-status="snoozed" data-minutes="${n}">${n===60?'1 小时后':n+' 分钟后'}</button>`).join('')}</div>`
          +`<button class="secondary-btn" data-action="dose-save" data-id="${esc(d.eventId)}" data-status="skipped">这次不吃了</button>`));
  }
  if(a==='dose-save'){
    const status=el?.dataset.status,eventId=id;
    if(!status||!eventId)return;
    const payload={status};
    if(el.dataset.time)payload.time=el.dataset.time;
    if(el.dataset.minutes)payload.minutes=Number(el.dataset.minutes);
    const receipt=await send('intake-events/'+encodeURIComponent(eventId),payload,'PATCH');
    $('#detail-dialog').close();await load();
    toast(status==='taken'?(receipt.inventoryDeducted===false?'已记录服药；库存不足，本次未扣减，请核对库存':'已记录服药'):status==='skipped'?'这次就不吃了':status==='snoozed'?`${el.dataset.minutes==='60'?'1 小时':(el.dataset.minutes||30)+' 分钟'}后再提醒你`:'已改成还没吃');
    return;
  }
  if(a==='today-plan'){
    const rows=[...state.doses].sort((a,b)=>a.planned.localeCompare(b.planned)).map(d=>{
      const who=d.action?(state.family.contacts.find(c=>c.id===d.action.by)?.name||'家人')+(d.action.channel==='call'?'打过电话':'已确认'):'';
      return `<div class="record-row"><b class="mono">${esc(d.planned)}</b><span><strong>${esc(d.drug?.name||'')}</strong><small>${esc(doseLabels[d.level]||'')}${d.status==='taken'?` · 实际 ${esc(clockOf(d))}`:''}${who?` · ${esc(who)}`:''}</small></span></div>`;
    }).join('');
    return panel('今天的服药记录',`<div class="surface">${rows||'<p class="empty">今天还没有记录。</p>'}</div><p class="helper">点“今天”页里的药可以补记时间或改成没吃。</p>`);
  }
  if(a==='missed-after'){
    const n=Number(id);if(![15,30,60].includes(n))return;
    state.family=await send('family',{missedAfterMinutes:n},'PATCH');paintSegmented('missed-after',String(state.family.missedAfterMinutes));toast('已保存');return;
  }
  if(a==='auto-sms'){
    const next=!state.family.autoNotify;
    if(next){const r=await AndroidApp.familyAutoPermission();if(!r.granted)return toast('没有允许发短信，自动短信没有开启')}
    state.family=await send('family',{autoNotify:next},'PATCH');
    paintSwitchRow('auto-sms','sms',!!state.family.autoNotify,state.family.autoNotify?'超时没吃会用本机 SIM 卡给每位家属发一条短信':'已关闭');return;
  }
  if(a==='call-settings'){callView.pick='';callView.status=null;panel('自动打电话给家属',`<div data-call-panel>${callBody()}</div>`);callView.status=await AndroidApp.callStatus().catch(()=>null);return paintCall()}
  if(a==='call-pick'){callView.pick=id;if(state.family.autoCall&&id!==state.family.autoCallContactId){state.family=await send('family',{autoCallContactId:id},'PATCH');toast('以后打给这位家属')}return paintCall()}
  if(a==='call-permission'){callView.status={...(callView.status||{}),...await AndroidApp.callPermission()};callView.status=await AndroidApp.callStatus().catch(()=>callView.status);return paintCall()}
  if(a==='call-sim'){await AndroidApp.callSettings();return}
  if(a==='call-toggle'){
    if(state.family.autoCall){state.family=await send('family',{autoCall:false},'PATCH');toast('自动电话已关闭');return paintCall()}
    const c=state.family.contacts.find(x=>x.id===(callView.pick||state.family.autoCallContactId||state.family.contacts[0]?.id));
    if(!c)return toast('请先选择打给哪位家属');
    const st=await AndroidApp.callStatus().catch(()=>null);callView.status=st;
    if(!st?.ready){paintCall();return toast(st?.reason||'这部手机还不能自动打电话')}
    return confirmDialog({title:'开启自动电话',note:`超过 ${state.family.missedAfterMinutes} 分钟还没记录吃药，会用这部手机的 SIM 卡给 ${c.name}（${c.phone}）打电话，话费按套餐计算。`,ok:'确认开启',onConfirm:async()=>{
      state.family=await send('family',{autoCall:true,autoCallContactId:c.id},'PATCH');toast('自动电话已开启');paintCall();
    }});
  }
  if(a==='contacts-manage'){
    const contacts=state.family.contacts;
    return panel('家属联系人',`<div class="surface">${contacts.map(c=>`<button class="menu-row" data-action="contact-edit" data-id="${esc(c.id)}" data-lead="icon"><span class="row-icon">${icon('share')}</span><span class="row-body"><strong>${esc(c.name)}${c.relation?` · ${esc(c.relation)}`:''}</strong><small>${esc(c.phone)}</small></span><span class="arrow" aria-hidden="true"></span></button>`).join('')||'<p class="empty">还没有家属联系人。</p>'}</div><button class="primary" data-action="contact-add">添加家属联系人</button><p class="helper">联系人只保存在这部手机上。</p>`);
  }
  if(a==='call-family'){
    const c=state.family.contacts.find(x=>x.id===id);if(!c)return;
    return contactVia('call',c.phone);
  }
  if(a==='as-needed'){
    const d=state.drugs.find(x=>x.id===id);if(!d)return;
    return confirmDialog({title:`记一次「${d.name}」`,note:`现在 ${nowTime()} 吃了${d.dose?' '+d.dose:''}，会按当前计划扣减 ${doseQuantity(d)} ${inventoryUnit(d)}库存。`,ok:'记下',onConfirm:async()=>{
      const receipt=await api('intake-events',{method:'POST',body:JSON.stringify({drugId:d.id})});await load();toast(receipt.inventoryDeducted===false?'已记录服药；库存不足，本次未扣减，请核对库存':'已记下这一次');
    }});
  }
  if(a==='font-scale'){
    appearance.fontScale=id==='large'?'large':'standard';
    saveAppearance();paintSegmented('font-scale',appearance.fontScale);return;
  }
  if(a==='refill-history'){
    const records=[...await api('refills')].sort((x,y)=>Date.parse(y.at)-Date.parse(x.at));
    const drugs=state.drugs.map(d=>row(d.name,`剩 ${d.inventory||0} ${esc(inventoryUnit(d))} · 轻点记一次补药`,'task',`data-action="refill" data-id="${esc(d.id)}"`,'',doseBadge(d.dose))).join('');
    return panel('补药记录',`<div class="surface">${drugs||'<p class="empty">还没有药物。</p>'}</div><div class="m-section"><h2 class="m-caption">最近补药</h2></div><div class="surface">${records.map(x=>`<div class="record-row"><b class="mono">${esc(stamp(x.at))}</b><span><strong>${esc(state.drugs.find(d=>d.id===x.drugId)?.name||'已移除的药物')}</strong><small>补充 ${esc(x.amount)} ${esc(x.inventoryUnit||'片')}</small></span></div>`).join('')||'<p class="empty">还没有补药记录。</p>'}</div>`);
  }
  if(a==='refill'){const d=state.drugs.find(x=>x.id===id);if(!d)return;return formPanel('记录补药',field('这次补了多少（'+inventoryUnit(d)+'）','amount','30','number',true,'min="0.001" step="0.001"'),'refill',id)}
  return baseDispatch(a,id,el);
};

formHandlers.refill=async form=>{
  const body=Object.fromEntries(new FormData(form));
  await send('drugs/'+encodeURIComponent(form.dataset.id)+'/refill',{amount:Number(body.amount)});
  await savedPanel();toast('补药已记录');
};
formHandlers['dose-time']=async form=>{
  const body=Object.fromEntries(new FormData(form));
  const receipt=await send('intake-events/'+encodeURIComponent(form.dataset.id),{status:'taken',time:body.time},'PATCH');
  $('#detail-dialog').close();await load();toast(receipt.inventoryDeducted===false?'已记录服药；库存不足，本次未扣减，请核对库存':'已按这个时间记下');
};
