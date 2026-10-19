/* 安药 · 家属端。
   只做三件事：今天吃了几次、哪次没吃、没吃就去催一下并留下记录。
   用药计划的维护也放在这里，服药端只保留“我吃了”。 */

const who=()=>state.family.user?.name||'家人';
const riskyDoses=()=>state.doses.filter(d=>['missed','due','delay'].includes(d.level));
const takenDoses=()=>state.doses.filter(d=>d.status==='taken');
const latestBox=()=>{
  const records=state.boxHistory.flatMap(h=>(h.records||[])).sort((a,b)=>b.timestamp-a.timestamp);
  return records[0]?{...records[0],deviceName:state.boxHistory[0]?.deviceName}:null;
};

/* ---------- 绑定服药者 ---------- */

function bindHTML(){
  const u=state.family.user;
  return `<div class="bind-screen">
    <span class="bind-photo" aria-hidden="true"></span>
    <h2 class="bind-title">绑定要照顾的人</h2>
    <p class="helper">填写服药者的姓名和手机号，之后就能看到对方每天的服药情况。</p>
    <form data-kind="bind-user" class="surface">
      <label class="m-field"><span>姓名</span><input name="name" required value="${esc(u?.name||'')}" placeholder="例如：张桂英" /></label>
      <label class="m-field"><span>手机号</span><input name="phone" type="tel" required value="${esc(u?.phone||'')}" placeholder="例如：13800000000" /></label>
      <div class="card-actions"><button class="primary">完成绑定</button></div>
    </form>
    <button class="secondary-btn" data-action="role-switch">切换到服药端</button>
  </div>`;
}
gate=()=>state.family.user?'':bindHTML();

/* ---------- 今天 ---------- */

function familyDoseRow(d){
  const us=d.action?(state.family.contacts.find(c=>c.id===d.action.by)?.name||'家属'):'';
  return `<div class="record-row" data-level="${esc(d.level)}">
    <b class="mono">${esc(d.planned)}</b>
    <span><strong>${esc(d.drug?.name||'已移除的药物')} ${esc(d.drug?.dose||'')}</strong><small>${esc(doseLabels[d.level]||'')}${d.status==='taken'?` · 实际 ${esc(d.time)}`:''}${us?` · ${esc(us)}${esc(familyActionText(d.action))}`:''}</small></span>
  </div>`;
}

function todayPage(){
  const u=state.family.user;
  const total=state.doses.length,done=takenDoses().length;
  const risky=riskyDoses();
  const box=latestBox();
  const compartment=Number(box?.compartment);
  const boxLine=box?`${stamp(box.timestamp*1000)} 收到${Number.isInteger(compartment)&&compartment>=1&&compartment<=4?`第 ${compartment} 仓记录`:'药盒记录'}`:'还没有药盒记录';
  const pending=state.doses.filter(d=>!['taken','skipped'].includes(d.status));
  const skipped=state.doses.filter(d=>d.status==='skipped').length;
  const summary=!total?'还没有用药计划':done===total?'今天的服药均已记录':risky.length?`还有 ${risky.length} 次需要跟进`:pending.length?`还有 ${pending.length} 次等待服药记录`:`今天的计划已处理，${skipped} 次已跳过`;
  return heading(u?.name||'今天',`<button class="icon-button" data-action="call-user" aria-label="给${esc(u?.name||'服药者')}打电话">${icon('call')}</button>`)
    +`<section class="surface family-summary">
        <div class="family-count"><strong>${done}</strong><span>/ ${total||0} 次已服用</span></div>
        <p class="family-state ${risky.length?'risky':done===total&&total?'ok':''}">${esc(summary)}</p>
      </section>`
    +statsCardHTML()
    +`<div class="m-section"><h2 class="m-caption">智能药盒</h2></div><div class="surface detail-list"><div><span>最近药盒记录</span><b>${esc(boxLine)}</b></div><div><span>服药记录</span><b>点“我吃了”后才记为已服用</b></div></div><p class="helper">药盒记录用于辅助核对，不能代替实际服药确认。</p>`
    +`<div class="m-section"><h2 class="m-caption">今天的每一次</h2></div><div class="surface">${state.doses.length?[...state.doses].sort((a,b)=>a.planned.localeCompare(b.planned)).map(familyDoseRow).join(''):'<p class="empty">今天没有需要服用的药。</p>'}</div>`
    +`<div class="m-section"><h2 class="m-caption">补药</h2></div><div class="surface">${row('补药记录','药品还剩多少、什么时候补的','pill','data-action="refill-history"')}</div>`;
}

/* ---------- 提醒 ---------- */

function alertCardHTML(d){
  const acted=d.action;
  return `<section class="surface alert-card" data-level="${esc(d.level)}">
    <div class="alert-head"><b class="mono">${esc(d.planned)}</b><span class="badge ${esc(doseState(d.status))}">${esc(doseLabels[d.level]||'')}</span></div>
    <p class="alert-drug">${esc(d.drug?.name||'已移除的药物')} ${esc(d.drug?.dose||'')}</p>
    <p class="helper">${acted?`${esc(familyActionText(acted))} · ${esc(stamp(acted.at))}`:'还没有人处理这一顿'}</p>
    <div class="action-grid">
      <button type="button" data-action="family-act" data-id="${esc(d.eventId)}" data-channel="call">${icon('call')}打电话提醒</button>
      <button type="button" data-action="family-act" data-id="${esc(d.eventId)}" data-channel="wechat">${icon('message')}发微信提醒</button>
      <button type="button" data-action="family-act" data-id="${esc(d.eventId)}" data-channel="confirm">${icon('check')}我知道了</button>
      <button type="button" data-action="family-act" data-id="${esc(d.eventId)}" data-channel="sms">${icon('note')}发短信</button>
    </div>
  </section>`;
}

function notifySettingsHTML(){
  const ch=state.family.channels||{};
  const channels=[['wechat','微信提醒'],['call','电话提醒'],['sms','短信提醒'],['email','邮件提醒']];
  const contacts=state.family.contacts;
  return `<div class="m-section"><h2 class="m-caption">多久没吃就提醒</h2></div>${segmented('notify-delay',String(state.family.missedAfterMinutes),[['15','15 分钟'],['30','30 分钟'],['60','1 小时']])}`
    +`<div class="m-section"><h2 class="m-caption">用哪些方式</h2><button data-action="contact-add">加联系人</button></div><div class="surface">`
    +channels.map(([k,label])=>`<button type="button" class="setting-row" data-action="notify-channel" data-id="${k}" aria-pressed="${!!ch[k]}"><span>${label}<small>${ch[k]?'已开启':'已关闭'}</small></span><span class="switch ${ch[k]?'on':''}" aria-hidden="true"></span></button>`).join('')
    +`</div>`
    +(window.AndroidApp?`<div class="m-section"><h2 class="m-caption">自动通知</h2></div><div class="surface"><button type="button" class="setting-row" data-action="auto-notify" data-id="sms" aria-pressed="${!!state.family.autoNotify}"><span>超时没吃自动发短信<small>${state.family.autoNotify?'超时没吃会自动发短信给联系人':'已关闭'}</small></span><span class="switch ${state.family.autoNotify?'on':''}" aria-hidden="true"></span></button></div><p class="helper">用这部手机的 SIM 卡发出，按运营商标准收费；每一顿最多发一次。家属和服药者在不同手机上时，需要先在“我的 → 同步与访问”连上同一个家庭服务。</p>`:'')
    +`<div class="m-section"><h2 class="m-caption">联系人</h2></div><div class="surface">${contacts.length?contacts.map(c=>`<button class="menu-row" data-action="contact-edit" data-id="${esc(c.id)}" data-lead="icon"><span class="row-icon">${icon('share')}</span><span class="row-body"><strong>${esc(c.name)}${c.relation?` · ${esc(c.relation)}`:''}</strong><small>${esc(c.phone)}</small></span><span class="arrow" aria-hidden="true"></span></button>`).join(''):'<p class="empty">还没有联系人，加一个才能发提醒。</p>'}</div>`;
}

function logHTML(){
  if(!state.log.length)return '<p class="empty">还没有提醒记录。</p>';
  return state.log.map(x=>`<div class="record-row"><b class="mono">${esc(stamp(x.at))}</b><span><strong>${esc(x.drug?.name||'服药记录')} ${esc(x.drug?.dose||'')}</strong><small>${esc(channelNames[x.channel]||'提醒')}${x.dose?` · ${esc(x.dose.planned)} 这一顿`:''}${x.note?` · ${esc(x.note)}`:''}</small></span></div>`).join('');
}

function alertsPage(){
  const list=riskyDoses();
  return heading('提醒')
    +`<div class="m-section"><h2 class="m-caption">需要注意</h2><button data-action="refresh">刷新</button></div>`
    +`<div class="alert-list">${list.length?list.map(alertCardHTML).join(''):'<div class="surface"><p class="empty">现在没有需要提醒的服药。</p></div>'}</div>`
    +notifySettingsHTML()
    +`<div class="m-section"><h2 class="m-caption">提醒记录</h2></div><div class="surface">${logHTML()}</div>`;
}

/* ---------- 用药计划 ---------- */

function planPage(){
  const total=state.drugs.length;
  return heading('用药计划',headIcon('header-add','data-action="med-add"','添加药物'))
    +`<div class="m-section"><h2 class="m-caption">药品库存</h2></div><div class="surface"><div class="inventory-total"><strong>${total}</strong><span>种药物 · 按每种药的数量与单位计算库存</span></div></div>`
    +medFilterHTML()+`<button class="secondary-btn" data-action="med-scan">扫码添加</button>`
    +`<div class="m-section"><h2 class="m-caption">药物清单</h2></div><div class="surface">${filteredMeds().map(d=>row(d.name,`${DrugModel.schedule(d)} · ${d.category||'未分类'} · 剩 ${d.inventory||0} ${inventoryUnit(d)}${stockDays(d)<=5&&!d.asNeeded?' · 快吃完了':''}`,'report',`data-action="med-detail" data-id="${esc(d.id)}"`,'',doseBadge(d.dose))).join('')||'<p class="empty">没有匹配的药物。</p>'}</div>`
    +`<div class="m-section"><h2 class="m-caption">补药</h2><button data-action="refill-history">补药记录</button></div><p class="helper">在药物详情里可以按对应库存单位记录补药数量。</p>`;
}

/* ---------- 我的 ---------- */

let calendarMonth=dayKey(new Date()).slice(0,7);
function calendarHTML(){
  const now=dayKey(new Date()),month=calendarMonth,[y,m]=month.split('-').map(Number);
  const first=new Date(y,m-1,1),days=new Date(y,m,0).getDate(),offset=(first.getDay()+6)%7;
  const counts=new Map();
  for(const e of state.history){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(e.date||''))continue;
    const c=counts.get(e.date)||{date:e.date,taken:0,total:0};
    c.total++;if(e.status==='taken')c.taken++;counts.set(e.date,c);
  }
  const cells=Array.from({length:days},(_,i)=>{const key=month+'-'+String(i+1).padStart(2,'0'),c=counts.get(key);
    const cls=!c?'':c.taken===c.total?'good':c.taken||key>=now?'current':'missed';
    return c?`<button type="button" class="day ${cls}" data-action="day" data-id="${key}" aria-label="${dayLabel(key)} 已服用 ${c.taken} / ${c.total} 次">${i+1}</button>`
      :`<span class="day" aria-hidden="true">${i+1}</span>`}).join('');
  const recorded=[...counts.keys()].filter(key=>key.startsWith(month)).length;
  return `<div class="calendar"><div class="calendar-head"><button type="button" class="icon-button" data-action="calendar-month" data-id="-1" aria-label="上个月">${icon('back')}</button><strong>${y} 年 ${m} 月</strong><button type="button" class="icon-button calendar-next" data-action="calendar-month" data-id="1" aria-label="下个月" ${month>=now.slice(0,7)?'disabled':''}>${icon('back')}</button></div><p class="helper">${recorded?recorded+' 天有记录':'这个月还没有记录'}</p>
    <div class="calendar-grid">${['一','二','三','四','五','六','日'].map(x=>`<span>${x}</span>`).join('')}${'<span></span>'.repeat(offset)}${cells}</div></div>`;
}

function minePage(){
  const a=state.adherence,rate=Math.max(0,Math.min(100,Number(a.percent)||0)),u=state.family.user;
  return heading('我的')
    +`<button class="surface profile-row" data-action="bind-edit">`
      +`<span class="profile-avatar" aria-hidden="true"></span>`
      +`<span class="profile-body"><strong>${esc(u?.name||'还没有绑定服药者')}</strong><small>${esc(u?.phone||'轻点填写姓名与手机号')}</small></span>`
      +`<span class="arrow" aria-hidden="true"></span></button>`
    +`<div class="m-section"><h2 class="m-caption">用药依从性</h2></div>`
    +`<section class="surface adherence-card"><div class="adherence-main"><strong class="adherence-count">${a.taken}<em>次已服用</em></strong><span class="m-quiet">近 7 天 ${a.week?.percent??rate}% · 近 30 天 ${a.month?.percent??rate}%</span><span class="m-quiet">累计到点 ${a.total} 次 · 未完成 ${Math.max(0,a.total-a.taken)} 次</span></div><div class="adherence-ring" style="--rate:${rate}%"><b>${rate}%</b></div></section>`
    +`<div class="m-section"><h2 class="m-caption">服药日历</h2></div><div class="surface">${calendarHTML()}</div>`
    +`<div class="m-section"><h2 class="m-caption">其他</h2></div><div class="surface">`
      +`<div class="setting-row"><span>字号<small>看不清时调大</small></span>${segmented('font-scale',appearance.fontScale,[['standard','标准'],['large','较大']])}</div>`
      +row('服药时间','每一次吃药的时间都在这里','report','data-action="dose-times"')
      +row('备份与恢复','保存或恢复本机记录','version','data-action="backup"')
      +row('同步与访问',remote()?'已连接家庭服务':'和服药者的手机共用一份记录','link','data-action="sync-settings"')
      +row('关于安药','版本、隐私与使用说明','about','data-action="about"')
    +`</div><p class="helper">${remote()?'记录保存在你们自己的家庭服务上。':'记录只保存在这部手机上，不会上传。'}</p>`
    +`<button type="button" class="page-action" data-action="role-switch">切换到服药端</button>`;
}

pages.today=todayPage;
pages.alerts=alertsPage;
pages.plan=planPage;
pages.mine=minePage;

/* ---------- 动作 ---------- */

const baseDispatch=dispatchAction;
dispatchAction=async function(a,id,el){
  if(a==='calendar-month'){
    const step=Number(id);if(![-1,1].includes(step))return;
    const [year,month]=calendarMonth.split('-').map(Number),date=new Date(year,month-1+step,1,12);
    const next=String(date.getFullYear()).padStart(4,'0')+'-'+String(date.getMonth()+1).padStart(2,'0');
    if(next<'1900-01'||next>dayKey(new Date()).slice(0,7))return;
    calendarMonth=next;render();return;
  }
  if(a==='call-user'){const u=state.family.user;if(!u?.phone)return toast('还没有填写服药者的手机号');return contactVia('call',u.phone)}
  if(a==='family-act'){
    const channel=el?.dataset.channel;
    if(!channel)return;
    const d=doseById(id),u=state.family.user;
    const text=`${u?.name||''}，${d?.planned||''} 的${d?.drug?.name||'药'}${d?.drug?.dose?' '+d.drug.dose:''}该吃了，吃完在安药里点一下“我吃了”。`;
    if(!d)throw Error('这条服药记录已经不存在，请刷新');
    const record=async()=>{
      await api('doses/'+encodeURIComponent(id)+'/action',{method:'POST',body:JSON.stringify({channel,note:channel==='confirm'?'':text})});
      await load();toast(channel==='confirm'?'已记下你会跟进':'已保存联系记录，未确认对方收到');
    };
    /* Opening a system composer or copying text must never create a sent record. */
    if(channel!=='confirm'){
      if(channel!=='wechat'&&channel!=='email'&&!u?.phone)return toast('还没有填写服药者的手机号，请到“我的”里补上');
      if(channel==='email'&&!u?.email)return toast('还没有填写服药者的邮箱，请到“我的”里补上');
      await contactVia(channel,channel==='email'?u.email:u?.phone,text);
      return confirmDialog({title:channel==='call'?'是否已拨出电话？':'是否已发送提醒？',note:channel==='call'?'请在实际拨出后确认；打开拨号界面不会自动记为已联系，也不表示对方已接听。':'请在微信、短信或邮件中实际发送后再确认。只打开界面或复制文字，不会保存为已联系。',ok:channel==='call'?'已拨出，记录':'已发送，记录',onConfirm:record});
    }
    return record();
  }
  if(a==='auto-notify'){
    const next=!state.family.autoNotify;
    if(next&&window.AndroidApp){const r=await AndroidApp.familyAutoPermission();if(!r.granted)return toast('没有允许发短信，自动通知没有开启')}
    state.family=await send('family',{autoNotify:next},'PATCH');
    paintSwitchRow('auto-notify','sms',!!state.family.autoNotify,state.family.autoNotify?'超时没吃会自动发短信给联系人':'已关闭');
    return;
  }
  if(a==='notify-delay'){
    const minutes=Number(id);if(![15,30,60].includes(minutes))return;
    state.family=await send('family',{missedAfterMinutes:minutes},'PATCH');
    paintSegmented('notify-delay',String(state.family.missedAfterMinutes));
    return;
  }
  if(a==='notify-channel'){
    const ch=state.family.channels||{};if(!(id in ch))return;
    const next=!ch[id],row=paintSwitchRow('notify-channel',id,next,next?'已开启':'已关闭');
    row?.toggleAttribute('disabled',true);
    try{
      state.family=await send('family',{channels:{[id]:next}},'PATCH');
      const saved=!!state.family.channels[id];
      paintSwitchRow('notify-channel',id,saved,saved?'已开启':'已关闭');
    }finally{row?.toggleAttribute('disabled',false)}
    return;
  }
  if(a==='refill'){const d=state.drugs.find(x=>x.id===id);if(!d)return;return formPanel('记录补药',field('这次补了多少（'+inventoryUnit(d)+'）','amount','30','number',true,'min="0.001" step="0.001"'),'refill',id)}
  if(a==='refill-history'){
    const records=[...await api('refills')].sort((x,y)=>Date.parse(y.at)-Date.parse(x.at));
    return panel('补药记录',`<div class="surface">${records.map(x=>`<div class="record-row"><b class="mono">${esc(stamp(x.at))}</b><span><strong>${esc(state.drugs.find(d=>d.id===x.drugId)?.name||'已移除的药物')}</strong><small>补充 ${esc(x.amount)} ${esc(x.inventoryUnit||'片')}</small></span></div>`).join('')||'<p class="empty">还没有补药记录。</p>'}</div>`);
  }
  if(a==='day'){
    if(!id)return;
    const list=state.history.filter(e=>e.date===id).sort((x,y)=>x.time.localeCompare(y.time));
    return panel(`${dayLabel(id)}的服药记录`,`<div class="surface">${list.map(e=>`<div class="record-row"><b class="mono">${esc(e.scheduleTime||e.time)}</b><span><strong>${esc(e.drug?.name||'已移除的药物')}</strong><small>${esc(labels[e.status]||e.status)}${e.status==='taken'?` · 实际 ${esc(e.time)}`:''}</small></span></div>`).join('')||'<p class="empty">这一天没有服药记录。</p>'}</div>`);
  }
  if(a==='bind-edit')return panel('绑定服药者',`<form data-kind="bind-user" data-id="edit"><div class="surface">${field('姓名','name',state.family.user?.name||'')}${field('手机号','phone',state.family.user?.phone||'','tel')}${field('邮箱（选填）','email',state.family.user?.email||'','email',false)}</div><button class="primary">保存</button></form><button class="danger-btn" data-action="unbind">解除绑定</button>`);
  if(a==='unbind')return confirmDialog({title:'解除绑定',note:'解除后家属端不再显示这个人的服药情况。',ok:'解除',onConfirm:async()=>{
    await send('family',{user:null},'PATCH');await load();$('#detail-dialog').close();toast('已解除绑定');
  }});
  if(a==='font-scale'){appearance.fontScale=id==='large'?'large':'standard';saveAppearance();paintSegmented('font-scale',appearance.fontScale);return}
  if(a==='refresh'){await load();toast('已刷新');return}
  return baseDispatch(a,id,el);
};

formHandlers['bind-user']=async form=>{
  const body=Object.fromEntries(new FormData(form));
  await send('family',{user:{id:state.family.user?.id,name:body.name,phone:body.phone,email:body.email||''}},'PATCH');
  await load();
  if(form.dataset.id==='edit'){$('#detail-dialog').close();toast('已更新绑定')}
};
formHandlers.refill=async form=>{
  const body=Object.fromEntries(new FormData(form));
  await send('drugs/'+encodeURIComponent(form.dataset.id)+'/refill',{amount:Number(body.amount)});
  await savedPanel();toast('补药已记录');
};
