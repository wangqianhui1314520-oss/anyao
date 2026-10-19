/* 安药 · 服药端与家属端共用的外壳。
   这里只放两端都要用的东西：图标、接口、数据载入、面板路由、表单、提示、外观、标签页骨架。
   每个端自己的页面与动作在 ui.js（服药端）与 family.js（家属端）里注册。 */
const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const state={
  tab:'',events:[],history:[],drugs:[],settings:{},
  adherence:{taken:0,total:0,percent:0,days:[]},
  doses:[],log:[],
  boxHistory:[],
  family:{user:null,contacts:[],missedAfterMinutes:30,channels:{}}
};
/* 参考库里的图标资产（assets.css 内嵌原字节）。有资产的走图片，没有资产的才用描边字形。 */
const assetIcons=new Set(['header-message','header-add','chevron','clock','heart','sleep','calorie','step','standing','target-calorie','target-step','target-standing','target-vitality','task','doctor','track','report','setting','about','version','link','shield','lock','speech','share','trophy','medal','order','prize','avatar','avatar-guest','health','sport','device','mine']);
const paths={
  check:'<path d="m5 12.5 4.5 4.5L19 7"/>',
  minus:'<path d="M5 12h14"/>',
  circle:'<circle cx="12" cy="12" r="8.5"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  back:'<path d="m15 5-7 7 7 7"/>',
  call:'<path d="M6 3h3l2 5-2.5 1.5a12 12 0 0 0 6 6L16 13l5 2v3a2 2 0 0 1-2.2 2A16 16 0 0 1 4 5.2 2 2 0 0 1 6 3Z"/>',
  message:'<path d="M20 11.5a7.5 7.5 0 0 1-10.9 6.7L4.5 20l1.5-4.3A7.5 7.5 0 1 1 20 11.5Z"/><path d="M9 11h6M9 14h3"/>',
  note:'<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/>',
  user:'<circle cx="12" cy="7" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
  trash:'<path d="M4 7h16M9 7V5h6v2M6.5 7 8 20h8l1.5-13M10 11v5M14 11v5"/>'
};
const icon=n=>assetIcons.has(n)
  ?`<span class="mi-ico" data-mi="${n}" aria-hidden="true"></span>`
  :`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[n]||paths.note}</svg>`;

/* 同步与访问：默认用本机记录；填了“家庭服务地址 + 访问码”后，两部手机读写同一份记录。 */
const SYNC_KEY='anyao-sync';
const sync=Object.assign({url:'',key:''},(()=>{try{return JSON.parse(localStorage.getItem(SYNC_KEY))||{}}catch{return{}}})());
/* 安卓里由原生转发到家庭服务，页面只需要知道“是否已连接”；访问码只存在原生侧 */
const nativeSync={url:''};
const remote=()=>window.AndroidApp?!!nativeSync.url:!!sync.url;
if(window.AndroidApp)AndroidApp.syncStatus().then(r=>{nativeSync.url=r?.url||''}).catch(()=>{});
/* 服务端返回的是错误代码，这里翻成老人和家属看得懂的话 */
const errorText={invalid_name:'请填写药物名称',invalid_dose:'剂量填写有误',invalid_inventory:'库存要填 0 到 100000 之间的整数',invalid_times:'每天的服药时间填写有误',invalid_time:'时间要写成 07:30 这样的格式',invalid_amount:'补药数量要大于 0',invalid_status:'这条记录的状态不对，请刷新后再试',invalid_minutes:'请选择 10、15、30、60 或 120 分钟',invalid_channel:'提醒方式不对',invalid_user_name:'请填写姓名',invalid_contact_name:'请填写联系人姓名',invalid_contacts:'联系人最多 20 位',invalid_missed_after:'等待时间要在 5 到 240 分钟之间',body_too_large:'内容太大，无法保存',invalid_json:'内容格式不对',unsupported_schema_version:'这不是安药的备份文件，或者版本不对',invalid_intake_drug_reference:'备份文件里的记录不完整',not_found:'这条记录已经不存在了，请刷新',unauthorized:'家庭访问码不对，请在“同步与访问”里重新填写',duplicate_drugs_id:'备份文件里有重复的药物'};
const humanError=d=>errorText[d]||(/^[a-z_]+$/.test(d||'')?'保存失败，请检查填写的内容（'+d+'）':d)||'保存失败，请重试';
Object.assign(errorText,{invalid_doseQuantity:'每次扣减数量要大于 0，最多三位小数',invalid_inventoryUnit:'请选择有效的库存单位'});
Object.assign(errorText,{invalid_weekdays:'请至少选择一个服药星期，不能重复',invalid_category:'分类最多 24 个字',invalid_barcode:'条码请填 4 到 64 位数字或字母，不支持网址',invalid_timeQuantities:'各时间的扣减数量要大于 0，最多三位小数',invalid_scheduleRevisions:'备份中的历史计划格式有误'});
async function api(path,options={}){
  const base=!window.AndroidApp&&remote()?sync.url.replace(/\/$/,''):'';
  const headers={'content-type':'application/json',...(sync.key?{'x-anyao-key':sync.key}:{}),...options.headers};
  let r;
  try{r=await fetch(base+'/api/'+path,{...options,headers})}
  catch{throw Error(remote()?'连不上家庭服务，请检查网络或“同步与访问”里的地址':'无法连接本地数据服务')}
  if(!r.ok){let data=await r.json().catch(()=>({}));throw Error(humanError(data.detail||data.error))}
  return r.json();
}
const send=(path,data,method='POST')=>{if(data&&data.inventory!==undefined)data.inventory=Number(data.inventory);if(data&&typeof data.times==='string')data.times=data.times.split(/[,，]/).map(x=>x.trim()).filter(Boolean);return api(path,{method,body:JSON.stringify(data)})};

/* ---------- 文案与行 ---------- */

const labels={taken:'已服用',scheduled:'待服用',skipped:'已跳过',snoozed:'已延后'};
const doseLabels={taken:'已服用',late:'已补服',pending:'还没到点',due:'该吃了',missed:'还没吃',delay:'稍后吃',skipped:'这次不吃'};
const heading=(title,action='',sub='')=>`<div class="page-heading"><div class="leading"><h1>${esc(title)}</h1>${sub?`<span class="page-sub">${esc(sub)}</span>`:''}</div>${action?`<div class="page-heading-actions">${action}</div>`:''}</div>`;
/* action 里放 right 时，行右侧才出现值；没有 action 的行就是纯展示（原 App 的设置行没有前导图标）。 */
const row=(title,sub,ico='',action='',trail='',badge='')=>`<button class="menu-row" ${action}${ico&&assetIcons.has(ico)?' data-lead="icon"':''}>`
  +(ico?`<span class="row-icon">${icon(ico)}</span>`:'')
  +`<span class="row-body"><strong>${esc(title)}${badge}</strong>${sub?`<small>${esc(sub)}</small>`:''}</span>`
  +(trail?`<span class="m-value">${trail}</span>`:'')
  +`<span class="arrow" aria-hidden="true"></span></button>`;
/* 页头右侧的动作图标：直接复用原 App 的页头图标资产 */
const headIcon=(name,action,label)=>`<button class="icon-button" ${action} aria-label="${esc(label)}"><span class="head-icon" data-mi="${name}"></span></button>`;
/* 剂量是数字，用现成的徽标组件做标签，和药盒页的仓位行保持一致 */
const doseBadge=dose=>dose?`<span class="m-badge" data-tone="accent">${esc(dose)}</span>`:'';
const dayKey=date=>date.toLocaleDateString('en-CA',{timeZone:'Asia/Shanghai'});
const dayLabel=key=>{const [,m,d]=key.split('-');return `${Number(m)} 月 ${Number(d)} 日`};
const doseState=s=>['taken','skipped','snoozed'].includes(s)?s:'scheduled';
const clock=value=>new Date(value).toLocaleTimeString('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit'});
const stamp=value=>new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
const nowTime=()=>new Date().toLocaleTimeString('en-GB',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit'});
const channelNames={call:'打电话',wechat:'微信',sms:'短信',email:'邮件',confirm:'确认'};
/* A contact log records an action, not proof of delivery or a connected call. */
const familyActionText=a=>a?.channel==='confirm'?'已确认会跟进':a?.channel==='call'?'记录了电话联系':`记录了${channelNames[a?.channel]||''}联系`;
const doseById=id=>state.doses.find(d=>d.eventId===id);
/* 库存按每天次数乘以每次扣减数量计算；剂量文字不参与换算。 */
function stockDays(drug){return DrugModel.stockDays(drug)}
const inventoryUnits=['片','粒','袋','支','瓶','毫升','滴','单位'];
const inventoryUnit=d=>inventoryUnits.includes(d?.inventoryUnit)?d.inventoryUnit:'片';
const doseQuantity=d=>Number.isFinite(Number(d?.doseQuantity))&&Number(d?.doseQuantity)>0?Number(d.doseQuantity):1;
const lowStock=()=>state.drugs.filter(d=>!d.asNeeded&&d.times?.length).map(d=>({drug:d,days:stockDays(d)})).filter(x=>x.days<=5).sort((a,b)=>a.days-b.days);
const medFilter={query:'',category:null};
const filteredMeds=()=>state.drugs.filter(d=>(medFilter.category===null||(d.category||'')===medFilter.category)&&(!medFilter.query||[d.name,d.dose,d.barcode,d.category].some(v=>String(v||'').toLowerCase().includes(medFilter.query.toLowerCase()))));
function medFilterHTML(){
 const categories=[...new Set(state.drugs.map(d=>d.category||''))].sort();
 return `<div class="med-filter"><label class="m-field"><span>搜索药名或条码</span><input type="search" data-med-search value="${esc(medFilter.query)}" maxlength="64"></label><label class="m-field"><span>分类</span><select data-med-category><option value="*">全部分类</option>${categories.map(c=>`<option value="c:${esc(c)}"${c===medFilter.category?' selected':''}>${esc(c||'未分类')}</option>`).join('')}</select></label></div>`;
}
document.addEventListener('input',e=>{if(!e.target.matches?.('[data-med-search]'))return;const selection=e.target.selectionStart;medFilter.query=e.target.value;render();const input=$('[data-med-search]');input?.focus();input?.setSelectionRange(selection,selection);});
document.addEventListener('change',e=>{if(e.target.matches?.('[data-med-category]')){medFilter.category=e.target.value==='*'?null:e.target.value.slice(2);render();}});

/* ---------- 服药时间：上次吃了、下次该吃、以及每一次实际吃的时间 ---------- */

/* 实际服药时间只取点过“我吃了”的记录，time 是当时记下的钟点，scheduleTime 是原计划。 */
const takenLog=()=>state.history.filter(e=>e.status==='taken'&&e.time).sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));
const lastTaken=()=>takenLog().at(-1)||null;
const dayTag=key=>key===dayKey(new Date())?'今天':key===dayKey(new Date(Date.now()-864e5))?'昨天':dayLabel(key);
/* 下一次：先看今天还没处理的那一顿，都处理完了就取明天的第一个计划时间。 */
function nextPlanned(){
  /* 按记录状态判断，不按 level：补服的级别是 late，但那一顿已经吃过了。 */
  const pending=state.doses.filter(d=>!['taken','skipped'].includes(d.status)).sort((a,b)=>a.planned.localeCompare(b.planned));
  if(pending.length)return{time:pending[0].planned,day:'今天',dose:pending[0]};
  for(let i=1;i<=7;i++){
    const key=dayKey(new Date(Date.now()+i*864e5));
    const times=state.drugs.filter(d=>DrugModel.active(d,key)).flatMap(d=>d.times||[]).sort();
    if(times.length)return{time:times[0],day:i===1?'明天':dayLabel(key),dose:null};
  }
  return null;
}
/* 那一刻是按时还是晚了：实际时间比计划晚 10 分钟以上算补服。 */
const lateBy=e=>{
  const planned=e.scheduleTime||e.time;
  if(!planned||planned===e.time)return false;
  const [ph,pm]=planned.split(':').map(Number),[th,tm]=e.time.split(':').map(Number);
  return (th*60+tm)-(ph*60+pm)>=10;
};

/* 三列指标卡：上次吃药 / 下次吃药 / 今天已吃，下面一条钻取行进“服药时间”。
   结构沿用原 App 健康页的等宽三列摘要卡（图标 + 标签 / 数值 / 补充）。 */
function statsCardHTML(){
  const last=lastTaken(),next=nextPlanned();
  const done=state.doses.filter(d=>d.status==='taken').length,total=state.doses.length;
  const metric=(mi,label,value,note,quiet)=>`<div class="metric">`
    +`<span class="metric-label">${icon(mi)}${esc(label)}</span>`
    +`<strong class="metric-value"${quiet?' data-tone="quiet"':''}>${esc(value)}</strong>`
    +`<span class="metric-target">${esc(note)}</span></div>`;
  return `<section class="surface metric-card"><div class="metric-grid">`
    +metric('clock','上次吃药',last?last.time:'—',last?`${dayTag(last.date)}${lateBy(last)?' · 补服':''}`:'还没有记录',!last)
    +metric('target-vitality','下次吃药',next?next.time:'—',next?next.day:'还没有计划',!next)
    +metric('trophy','今天已吃',total?`${done}/${total}`:'—',total?'次':'还没有计划',!total)
    +`</div><button type="button" class="metric-row" data-action="dose-times">`
      +icon('report')
      +`<span class="metric-row-text"><strong>服药时间</strong>每一次吃药的时间都记在这里</span>`
      +`<span class="arrow" aria-hidden="true"></span></button></section>`;
}

/* 每一次实际服药的时间，按日期分组倒序 */
function timeRowHTML(e,drugName,dose){
  const planned=e.scheduleTime||e.time;
  return `<div class="time-row" data-level="${lateBy(e)?'late':'taken'}"><b>${esc(e.time)}</b><span><strong>${esc(drugName||'已移除的药物')}</strong><small>计划 ${esc(planned)}${dose?` · ${esc(dose)}`:''}${lateBy(e)?' · 晚一点补服':''}</small></span></div>`;
}
function doseTimesHTML(){
  const list=takenLog().slice().reverse();
  if(!list.length)return '<p class="empty">还没有记录过吃药。点了「我吃了」以后，这里会留下每一次的时间。</p>';
  const groups=new Map();
  for(const e of list){if(!groups.has(e.date))groups.set(e.date,[]);groups.get(e.date).push(e)}
  return [...groups].map(([date,items])=>`<div class="time-group">`
    +`<div class="m-section"><h2 class="m-caption">${esc(dayTag(date))} · ${esc(dayLabel(date))}</h2></div>`
    +`<div class="surface">${items.map(e=>timeRowHTML(e,state.drugs.find(d=>d.id===e.drugId)?.name,state.drugs.find(d=>d.id===e.drugId)?.dose)).join('')}</div>`
    +`</div>`).join('');
}

/* “服药时间”二级页：先回答上次、下次，再按天列出每一次实际时间。 */
function doseTimesPanel(){
  const last=lastTaken(),next=nextPlanned();
  const line=(k,v)=>`<div><span>${esc(k)}</span><b>${esc(v)}</b></div>`;
  return `<div class="surface detail-list">`
    +line('上次吃药',last?`${last.time}${last.date===dayKey(new Date())?'':' · '+dayTag(last.date)}`:'还没有记录')
    +line('下次吃药',next?`${next.time}${next.day==='今天'?'':' · '+next.day}`:'还没有计划')
    +`</div><p class="helper">点「我吃了」的时刻会记在这里，按天倒序排列。</p>`
    +doseTimesHTML();
}

async function load(){
  const [today,drugs,history,adherence,family,doses,log,boxHistory]=await Promise.all([
    api('today'),api('drugs'),api('intake-events?all=true'),api('adherence'),api('family'),api('doses'),api('family-log'),api('hipee-history')
  ]);
  Object.assign(state,{events:today.events,settings:today.settings,drugs,history,adherence,family,doses:doses.doses,log,boxHistory});
  if(medFilter.category!==null&&!drugs.some(d=>(d.category||'')===medFilter.category))medFilter.category=null;
  state.loadedAt=Date.now();
  /* 设置类控件或输入框正在用时不整页重绘，免得打断正在填写的内容 */
  if(!quietRefresh.active)render();
  window.dispatchEvent(new CustomEvent('anyao-loaded'));
}
/* 每分钟对一次表：到点、超时这些状态要跟着时间走，另一部手机的改动也要能看到 */
const quietRefresh={active:false};
async function refreshQuietly(){
  if(document.hidden)return;
  const busy=document.activeElement?.matches?.('input,textarea,select')||$('#detail-dialog')?.open||$('#confirm-dialog')?.open;
  const before=JSON.stringify([state.doses.map(d=>[d.eventId,d.level,d.status,d.action?.id]),state.log[0]?.id,state.drugs.length,state.family.user?.id]);
  quietRefresh.active=true;
  try{await load()}catch{}finally{quietRefresh.active=false}
  const after=JSON.stringify([state.doses.map(d=>[d.eventId,d.level,d.status,d.action?.id]),state.log[0]?.id,state.drugs.length,state.family.user?.id]);
  if(before!==after&&!busy)render();
}
setInterval(refreshQuietly,remote()?20000:60000);

/* ---------- 页面骨架 ---------- */

const pages={};
let gate=null;
const tabButtons=()=>$$('.tabbar button');
function render(){
  const blocked=gate&&gate();
  if(blocked){$('#view').innerHTML=`<div class="page">${blocked}</div>`;tabButtons().forEach(b=>b.removeAttribute('aria-current'));syncSheetGeometry();return}
  $('#view').innerHTML=`<div class="page">${(pages[state.tab]||Object.values(pages)[0]||(()=>'<p class="empty">暂无可显示的页面</p>'))()}</div>`;
  tabButtons().forEach(b=>b.dataset.tab===state.tab?b.setAttribute('aria-current','page'):b.removeAttribute('aria-current'));
  syncSheetGeometry();
}
function goTab(name){if(state.tab===name)return;state.tab=name;render();$('#view').scrollTop=0}

/* 宽屏预览时手机框是屏幕中间的一块，把它的实际位置写成 CSS 变量，
   右侧面板与遮罩才能严丝合缝地落在框内（不依赖 100vw 的估算）。 */
function syncSheetGeometry(){
  const frame=$('.phone');if(!frame)return;
  const rect=frame.getBoundingClientRect();
  const root=document.documentElement.style;
  root.setProperty('--frame-top',`${rect.top}px`);
  root.setProperty('--frame-left',`${rect.left}px`);
  root.setProperty('--frame-width',`${rect.width}px`);
  root.setProperty('--frame-height',`${rect.height}px`);
  root.setProperty('--frame-radius',getComputedStyle(frame).borderTopLeftRadius||'34px');
}
window.addEventListener('resize',syncSheetGeometry);

/* ---------- 面板路由 ---------- */

const panelNavigation={current:null,parents:[],route:null,restoring:false};
const dialogOrder=new WeakMap();let dialogSequence=0;
function showDialog(dialog){dialog.showModal();dialogOrder.set(dialog,++dialogSequence)}
window.handleAndroidBack=()=>{
  const open=$$('dialog[open]').sort((a,b)=>(dialogOrder.get(a)||0)-(dialogOrder.get(b)||0));
  const dialog=open.at(-1);if(!dialog)return false;
  if(dialog.id==='detail-dialog')panelBack();
  else if(dialog.dispatchEvent(new Event('cancel',{cancelable:true})))dialog.close();
  return true;
};
function paintPanel(frame){
  const dialog=$('#detail-dialog');
  const step=frame.direction==='back'?' m-panel-step m-panel-step-back':frame.direction==='forward'?' m-panel-step':'';
  dialog.innerHTML=`<div class="m-panel-page${step}"><div class="m-panel-head"><button class="icon-button" data-action="close" aria-label="返回">${icon('back')}</button><div class="panel-titles"><h2>${esc(frame.title)}</h2></div></div><div class="m-panel-body">${frame.body}</div></div>`;
  if(!dialog.open)showDialog(dialog);
  dialog.querySelector('.m-panel-body').scrollTop=0;
}
function panel(title,body){
  const dialog=$('#detail-dialog');
  if(!dialog.open){panelNavigation.parents=[];panelNavigation.current=null}
  const previous=panelNavigation.current,navigating=!!(dialog.open&&previous&&previous.title!==title),frame={title,body,route:panelNavigation.route,direction:navigating?'forward':''};
  if(navigating&&!panelNavigation.restoring)panelNavigation.parents.push(previous);
  if(previous?.title===title&&previous.route)frame.route=previous.route;
  panelNavigation.current=frame;paintPanel(frame);dialog.scrollTop=0;
}
async function panelBack(refresh=false){
  const parent=panelNavigation.parents.pop();
  if(!parent){$('#detail-dialog').close();return}
  panelNavigation.current=parent;
  if(refresh&&parent.route){
    panelNavigation.restoring=true;
    try{await action(...parent.route)}finally{panelNavigation.restoring=false}
    if(!$('#detail-dialog').open)return;
    (panelNavigation.current||parent).direction='back';
    return paintPanel(panelNavigation.current||parent);
  }
  parent.direction='back';
  paintPanel(parent);
}
$('#detail-dialog').addEventListener('close',()=>{if(!$('#detail-dialog').open){panelNavigation.current=null;panelNavigation.parents=[];panelNavigation.route=null}});
const savedPanel=async()=>{await load();await panelBack(true)};

const confirmAction={run:null};
function confirmDialog({title,note,ok='删除',onConfirm}){
  const dialog=$('#confirm-dialog');
  dialog.querySelector('#confirm-dialog-title').textContent=title;
  dialog.querySelector('#confirm-dialog-note').textContent=note||'';
  dialog.querySelector('#confirm-dialog-ok').textContent=ok;
  confirmAction.run=onConfirm;
  showDialog(dialog);
}
$('#confirm-form').addEventListener('submit',async e=>{
  e.preventDefault();
  const run=confirmAction.run;confirmAction.run=null;
  $('#confirm-dialog').close();
  if(run){try{await run()}catch(error){toast(error.message)}}
});
$('#confirm-dialog').addEventListener('close',()=>{if(!$('#confirm-dialog').open)confirmAction.run=null});

const field=(label,name,value='',type='text',required=true,extra='')=>`<label class="m-field"><span>${esc(label)}</span><input name="${name}" type="${type}" value="${esc(value)}" ${required?'required':''} ${extra}></label>`;
const formPanel=(title,fields,kind,id='')=>panel(title,`<form data-kind="${kind}" data-id="${id}">${fields}<button class="primary">保存</button></form>`);
const savingForms=new WeakSet();
async function saveForm(event,save){
  event.preventDefault();const form=event.target;if(savingForms.has(form))return;savingForms.add(form);
  const buttons=[...form.querySelectorAll('button')].map(b=>({b,disabled:b.disabled}));
  form.setAttribute('aria-busy','true');buttons.forEach(({b})=>{b.disabled=true;b.setAttribute('aria-busy','true')});
  try{return await save()}finally{savingForms.delete(form);form.removeAttribute('aria-busy');buttons.forEach(({b,disabled})=>{b.disabled=disabled;b.removeAttribute('aria-busy')})}
}

const formHandlers={};
/* ---------- 用药计划与家属联系人：两端共用（服药者自己登记，家属也可以帮着维护） ---------- */
/* 每天的服药时间用系统时间选择器，一行一个，可以加减 */
const medTimeRow=(t='',q='')=>`<div class="med-time-row"><input type="time" name="time" value="${esc(t)}" aria-label="服药时间"><input type="number" name="timeQuantity" value="${esc(q)}" min="0.001" max="100000" step="0.001" placeholder="默认数量" aria-label="本时间扣减数量"><button type="button" class="icon-button" data-time-remove aria-label="删掉这个时间">${icon('minus')}</button></div>`;
const medFields=d=>field('药物名称','name',d?.name||'','text',true,'maxlength="40"')+field('剂量说明','dose',d?.dose||'','text',false,'placeholder="例如 每次 100mg；按既有医嘱填写"')
  +field('药品分类（选填）','category',d?.category||'','text',false,'maxlength="24" placeholder="例如 常用药、维生素" list="drug-categories"')+`<datalist id="drug-categories">${[...new Set(state.drugs.map(x=>x.category).filter(Boolean))].map(c=>`<option value="${esc(c)}">`).join('')}</datalist>`
  +field('包装条码（选填）','barcode',d?.barcode||'','text',false,'maxlength="64" inputmode="text"')+`<div class="action-grid"><button type="button" class="secondary-btn" data-barcode-scan>扫描包装条码</button><button type="button" class="secondary-btn" data-barcode-image>从图片识别</button></div><p class="helper">扫码在本机识别条码，可匹配已登记的药名。未登记的条码请核对包装填写药名，不会自动推荐剂量。</p>`
  +field('每次扣减库存数量','doseQuantity',String(doseQuantity(d)),'number',true,'min="0.001" max="100000" step="0.001" inputmode="decimal"')
  +`<label class="m-field"><span>库存单位</span><select name="inventoryUnit">${inventoryUnits.map(u=>`<option value="${u}"${inventoryUnit(d)===u?' selected':''}>${u}</option>`).join('')}</select></label><p class="helper">扣减数量使用库存单位，例如每次 2 片就填 2。剂量说明中的 mg 不会自动换算成片数；旧记录默认每次扣 1，请按实际计划核对。</p>`
  +`<label class="m-field"><span>怎么吃</span><select name="asNeeded"><option value="false"${d?.asNeeded?'':' selected'}>按星期和固定时间吃</option><option value="true"${d?.asNeeded?' selected':''}>需要时才吃</option></select></label>`
  +`<fieldset class="m-field med-weekdays"${d?.asNeeded?' hidden':''}><legend>哪些天吃</legend><div class="weekday-options">${DrugModel.all.map(n=>`<label><input type="checkbox" name="weekdays" value="${n}"${DrugModel.weekdays(d).includes(n)?' checked':''}><span>周${DrugModel.names[n-1]}</span></label>`).join('')}</div></fieldset>`
  +`<fieldset class="m-field med-times"${d?.asNeeded?' hidden':''}><legend>几点吃 · 本时间扣减数量（选填）</legend><div class="med-time-list">${((d?.times||[]).length?d.times:['08:00']).map(t=>medTimeRow(t,d?.timeQuantities?.[t]??'')).join('')}</div><button type="button" class="secondary-btn" data-time-add>${icon('plus')}再加一个时间</button><p class="helper">数量留空使用上面的默认扣减数量；早晚数量不同可逐行填写。所有数量均使用所选库存单位。</p></fieldset>`
  +field('用药说明','note',d?.note||'','text',false,'placeholder="例如 饭后吃"')+field('当前库存（所选单位）','inventory',String(d?.inventory??0),'number',false,'min="0" max="100000" step="0.001" inputmode="decimal"');
/* 表单里的字符串整理成接口要的类型，并在提交前把常见填写错误说清楚 */
function medBody(form){
  const b=Object.fromEntries(new FormData(form));
  b.asNeeded=b.asNeeded==='true';
  delete b.time;
  delete b.timeQuantity;
  b.weekdays=new FormData(form).getAll('weekdays').map(Number).sort((a,b)=>a-b);
  if(!b.asNeeded&&!b.weekdays.length)throw Error('请至少选择一个服药星期');
  if(b.asNeeded&&!b.weekdays.length)b.weekdays=[...DrugModel.all];
  const picked=new FormData(form).getAll('time').map(t=>String(t).trim()).filter(Boolean);
  b.times=b.asNeeded?[]:[...new Set(picked.map(t=>{const m=/^(\d{1,2})[:：](\d{2})$/.exec(t);if(!m||Number(m[1])>23||Number(m[2])>59)throw Error(`时间“${t}”不对，请重新选`);return m[1].padStart(2,'0')+':'+m[2]}))].sort();
  if(!b.asNeeded&&!b.times.length)throw Error('请至少选一个吃药时间，或选择“需要时才吃”');
  const quantity=value=>Number.isFinite(value)&&value>=0&&value<=100000&&Math.abs(value*1000-Math.round(value*1000))<0.000001;
  b.inventory=Number(b.inventory||0);if(!quantity(b.inventory))throw Error('库存要填 0 到 100000，最多三位小数');
  b.doseQuantity=Number(b.doseQuantity);if(!quantity(b.doseQuantity)||b.doseQuantity<=0)throw Error('每次扣减数量要大于 0，最多三位小数');
  if(!inventoryUnits.includes(b.inventoryUnit))throw Error('请选择库存单位');
  b.timeQuantities={};const seen=new Set();
  if(!b.asNeeded)for(const row of form.querySelectorAll('.med-time-row')){
    const t=row.querySelector('[name=time]').value,raw=row.querySelector('[name=timeQuantity]').value;
    if(!t)continue;if(seen.has(t))throw Error('服药时间不能重复，请合并重复行');seen.add(t);
    if(raw!==''){const q=Number(raw);if(!quantity(q)||q<=0)throw Error(`${t} 的扣减数量要大于 0，最多三位小数`);b.timeQuantities[t]=q;}
  }
  b.category=b.category.trim();b.barcode=b.barcode.trim();
  if(b.barcode&&!DrugModel.validBarcode(b.barcode))throw Error(errorText.invalid_barcode);
  return b;
}
async function manageAction(a,id){
  if(a==='contact-add')return formPanel('添加联系人',field('姓名','name','')+field('手机号','phone','','tel')+field('关系','relation','','text',false,'placeholder="例如 女儿"')+field('邮箱（选填）','email','','email',false),'contact');
  if(a==='contact-edit'){
    const c=state.family.contacts.find(x=>x.id===id);if(!c)return;
    return panel(`编辑联系人`, `<form data-kind="contact" data-id="${esc(c.id)}">${field('姓名','name',c.name)+field('手机号','phone',c.phone,'tel')+field('关系','relation',c.relation||'','text',false)+field('邮箱（选填）','email',c.email||'','email',false)}<button class="primary">保存</button></form><button class="secondary-btn" data-action="contact-call" data-id="${esc(c.id)}">给 ${esc(c.name)} 打电话</button><button class="danger-btn" data-action="contact-delete" data-id="${esc(c.id)}">删除联系人</button>`);
  }
  if(a==='contact-call'){const c=state.family.contacts.find(x=>x.id===id);if(c)return contactVia('call',c.phone);return}
  if(a==='contact-delete'){
    const c=state.family.contacts.find(x=>x.id===id);if(!c)return;
    return confirmDialog({title:`删除「${c.name}」`,note:'删除后不会再给对方发提醒。',onConfirm:async()=>{
      await send('family',{contacts:state.family.contacts.filter(x=>x.id!==c.id)},'PATCH');
      await load();$('#detail-dialog').close();toast('联系人已删除');
    }});
  }
  if(a==='med-add')return formPanel('添加药物',medFields(),'add-med');
  if(a==='med-detail'){
    const d=state.drugs.find(x=>x.id===id);if(!d)return;
    return panel(`${d.name} ${d.dose||''}`,`<div class="surface detail-list"><div><span>服药日期</span><b>${esc(DrugModel.repeat(d))}</b></div><div><span>时间与扣减数量</span><b>${esc(d.asNeeded?`${doseQuantity(d)} ${inventoryUnit(d)} / 次`:(d.times||[]).map(t=>DrugModel.timeLabel(d,t)).join('；')||'—')}</b></div><div><span>分类</span><b>${esc(d.category||'未分类')}</b></div><div><span>包装条码</span><b>${esc(d.barcode||'未登记')}</b></div><div><span>剩余库存</span><b>${d.inventory||0} ${esc(inventoryUnit(d))}</b></div><div><span>用药说明</span><b>${esc(d.note||'—')}</b></div></div><button class="primary" data-action="med-edit" data-id="${esc(d.id)}">编辑药物</button><button class="secondary-btn" data-action="refill" data-id="${esc(d.id)}">记录补药</button>`);
  }
  if(a==='med-edit'){
    const d=state.drugs.find(x=>x.id===id);if(!d)return;
    return panel('编辑药物',`<form data-kind="edit-med" data-id="${esc(d.id)}">${medFields(d)}<button class="primary">保存</button></form><button class="danger-btn" data-action="med-delete" data-id="${esc(d.id)}">删除药物</button>`);
  }
  if(a==='med-delete'){
    const d=state.drugs.find(x=>x.id===id);if(!d)return;
    return confirmDialog({title:`删除「${d.name}」`,note:'删除后不会再生成新的提醒；已经完成的服药记录会保留。',onConfirm:async()=>{
      await api('drugs/'+encodeURIComponent(d.id),{method:'DELETE'});
      await load();$('#detail-dialog').close();toast('药物已删除');
    }});
  }
  return null;
}
formHandlers.contact=async form=>{
  const body=Object.fromEntries(new FormData(form)),id=form.dataset.id;
  const list=state.family.contacts;
  const next=id?list.map(c=>c.id===id?{...c,name:body.name,phone:body.phone,relation:body.relation||'',email:body.email||''}:c)
    :[...list,{id:'c_'+crypto.randomUUID().slice(0,8),name:body.name,phone:body.phone,relation:body.relation||'',email:body.email||''}];
  await send('family',{contacts:next},'PATCH');
  await savedPanel();toast('联系人已保存');
};
async function checkDrugService(body){
  if(!remote())return;
  const required=[];if(body.weekdays.length!==7)required.push('weekdays');if(Object.keys(body.timeQuantities).length)required.push('timeQuantities');if(body.category)required.push('category');if(body.barcode)required.push('barcode');
  if(!required.length)return;
  const caps=await api('capabilities').catch(()=>null);
  if(!caps?.drugFields||required.some(k=>!caps.drugFields.includes(k)))throw Error('家庭服务尚未支持本次新增的星期、逐时间数量或药品信息。请升级家庭服务后保存，避免服务端丢弃这些设置。');
}
formHandlers['add-med']=async form=>{
  const body=medBody(form);await checkDrugService(body);
  await api('drugs',{method:'POST',body:JSON.stringify(body)});
  await savedPanel();toast('用药计划已保存');
};
formHandlers['edit-med']=async form=>{
  const body=medBody(form);await checkDrugService(body);
  await api('drugs/'+encodeURIComponent(form.dataset.id),{method:'PATCH',body:JSON.stringify(body)});
  await savedPanel();toast('已保存');
};

document.addEventListener('click',e=>{
  const scan=e.target.closest('[data-barcode-scan],[data-barcode-image]');if(scan){scanIntoForm(scan.closest('form'),scan.hasAttribute('data-barcode-image')).catch(err=>toast(err.message));return}
  const add=e.target.closest('[data-time-add]');
  if(add){const list=add.closest('fieldset')?.querySelector('.med-time-list');if(list){list.insertAdjacentHTML('beforeend',medTimeRow(''));list.lastElementChild.querySelector('input')?.focus()}return}
  const rm=e.target.closest('[data-time-remove]');
  if(rm){const list=rm.closest('.med-time-list');if(list&&list.children.length>1)rm.closest('.med-time-row').remove();else{const i=rm.closest('.med-time-row')?.querySelector('input');if(i)i.value=''}}
});
document.addEventListener('change',e=>{
  if(e.target.matches?.('select[name="asNeeded"]'))for(const f of e.target.form?.querySelectorAll('.med-times,.med-weekdays')||[])f.hidden=e.target.value==='true';
});

/* ---------- 动作分发 ---------- */

const manageActions=new Set(['contact-add','contact-edit','contact-call','contact-delete','med-add','med-detail','med-edit','med-delete']);
async function dispatchAction(a,id){
  if(a==='close')return panelBack();
  if(manageActions.has(a))return manageAction(a,id);
  if(a==='dose-times')return panel('服药时间',doseTimesPanel());
  if(a==='backup')return panel('备份与恢复',`<button class="primary" data-action="export">下载完整备份</button><div class="m-section"><h2 class="m-caption">从文件恢复</h2></div><p class="helper">恢复会替换当前本机记录，系统会先自动留一份恢复前备份。</p><form data-kind="restore"><label class="m-field"><span>选择备份 JSON</span><input type="file" name="file" accept=".json,application/json" required></label><button class="secondary-btn">验证并恢复</button></form>`);
  if(a==='export'){
    if(window.AndroidApp){const r=await AndroidApp.exportBackup();toast(r.body?.exported?'记录已导出':'已取消导出');return}
    const data=await api('export'),blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),link=document.createElement('a');
    link.href=URL.createObjectURL(blob);link.download='安药服药记录.json';link.click();
    setTimeout(()=>URL.revokeObjectURL(link.href),1000);toast('服药记录已导出');return;
  }
  if(a==='role-switch'){try{localStorage.setItem('anyao-role',document.body.dataset.role==='family'?'user':'family')}catch{}location.href=document.body.dataset.role==='family'?'index.html':'family.html';return}
  if(a==='sync-settings')return panel('同步与访问',syncBody());
  if(a==='about')return panel('关于安药',await aboutBody());
  if(a==='sync-off'){if(window.AndroidApp){await AndroidApp.setSync('','');nativeSync.url=''}Object.assign(sync,{url:'',key:''});saveSync();await load();panelBack();toast('已改回只用本机记录');return}
  if(a==='notify-permission'){await Reminders.ask();return panel('同步与访问',syncBody())}
}

/* ---------- 联系家人：电话 / 短信 / 微信 / 邮件 ----------
   安卓里由原生打开系统拨号、短信、微信或邮件界面（文字已经填好，用户点发送）；
   浏览器里用 tel: / sms: / mailto:，微信先把文字复制好再提示去微信里粘贴。 */
async function contactVia(channel,target,text=''){
  const digits=String(target||'').replace(/[^\d+]/g,'');
  if(window.AndroidApp){
    if(channel==='call')return AndroidApp.dial(digits);
    if(channel==='sms')return AndroidApp.sms(digits,text);
    if(channel==='wechat'){const r=await AndroidApp.wechat(text);if(r?.copied)toast('提醒文字已复制，在微信里粘贴发送');return r}
    if(channel==='email')return AndroidApp.email(target,'安药服药提醒',text);
    return AndroidApp.share(text);
  }
  if(channel==='call'){location.href='tel:'+digits;return}
  if(channel==='sms'){location.href='sms:'+digits+'?body='+encodeURIComponent(text);return}
  if(channel==='email'){location.href='mailto:'+encodeURIComponent(target)+'?subject='+encodeURIComponent('安药服药提醒')+'&body='+encodeURIComponent(text);return}
  try{await navigator.clipboard.writeText(text);toast('提醒文字已复制，去微信里粘贴发送')}catch{toast('请在微信里手动发送：'+text)}
}

/* ---------- 关于 ---------- */
async function aboutBody(){
  const info=window.AndroidApp?await AndroidApp.appInfo().catch(()=>null):null;
  return `<div class="surface detail-list"><div><span>版本</span><b>${esc(info?.versionName||'网页版')}</b></div><div><span>数据保存在</span><b>${remote()?'家庭服务':'这部手机'}</b></div></div>`
   +`<div class="m-section"><h2 class="m-caption">隐私</h2></div><div class="surface"><p class="card-note">安药不需要注册账号，不收集、不上传任何个人信息。用药计划和服药记录只保存在这部手机上；只有你在“同步与访问”里填写了自己的家庭服务地址，记录才会发到那台服务上。打电话、发短信都由系统界面完成，自动短信默认关闭。</p><div class="card-actions"></div></div>`
   +`<div class="m-section"><h2 class="m-caption">使用提示</h2></div><div class="surface"><p class="card-note">1. 在“用药”里登记每种药和每天吃药的时间（家属端的“计划”也能帮着改）。<br>2. 到点时手机按你选的方式提醒（震动、声音、闪光、通知），连着手表或药盒时它们也会提醒，点“我吃了”就记下。<br>3. 超过等待时间还没吃，会再提醒一次；家属端会在“提醒”里看到，并可以一键打电话、发短信或微信。<br>4. 如果到点没有提醒，请在“设置 → 后台提醒保障”里把几项权限都打开。</p><div class="card-actions"></div></div>`
   +`<p class="helper">安药是用药提醒工具，不提供诊断或用药建议；请按医生或药师的指导用药。</p>`;
}

/* ---------- 同步与访问 ---------- */
function saveSync(){try{localStorage.setItem(SYNC_KEY,JSON.stringify(sync))}catch{}}
function syncBody(){
  return `<p class="helper">只用一部手机时不用填。服药者和家属各用一部手机时，把安药数据服务放在家里的电脑或云主机上（见交付包「部署说明」），两边填同一个地址和访问码，就能看到同一份记录。</p>`
   +`<form data-kind="sync"><div class="surface">${field('家庭服务地址','url',window.AndroidApp?nativeSync.url:sync.url,'url',false,'placeholder="例如 https://anyao.example.com" inputmode="url"')}${field('家庭访问码','key',window.AndroidApp?'':sync.key,'password',false,'autocomplete="off"'+(window.AndroidApp&&nativeSync.url?' placeholder="已保存，不改可留空"':''))}</div><button class="primary">连接并保存</button></form>`
   +(remote()?`<button class="secondary-btn" data-action="sync-off">改回只用本机记录</button>`:'')
   +(window.AndroidApp?'':`<div class="m-section"><h2 class="m-caption">提醒通知</h2></div><div class="surface detail-list"><div><span>系统通知</span><b>${esc(Reminders.permissionLabel())}</b></div></div>`
   +(Reminders.canAsk()?`<button class="secondary-btn" data-action="notify-permission">允许安药发通知</button>`:''))
   +(window.AndroidApp?`<p class="helper">安卓提醒由系统调度。请在“后台提醒保障”中完成权限、自启动和电池设置，并实际测试锁屏提醒。</p>`:`<p class="helper">网页版在安药开着（包括切到后台）时按时提醒；手机锁屏、关掉浏览器后仍要准时提醒，请安装安药安卓应用。</p>`);
}
formHandlers.sync=async form=>{
  const body=Object.fromEntries(new FormData(form));
  let url=String(body.url||'').trim();
  if(url&&!/^https?:\/\//i.test(url))url='https://'+url;
  if(url){try{const u=new URL(url);if(u.protocol==='http:'&&!['localhost','127.0.0.1'].includes(u.hostname)&&!/^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))/.test(u.hostname))throw Error('公网地址请使用 https');url=u.origin}catch(e){throw Error(e.message.includes('https')?e.message:'地址格式不对')}}
  if(window.AndroidApp){
    const r=await AndroidApp.setSync(url,String(body.key||'').trim());
    Object.assign(sync,{url:r.url||'',key:''});nativeSync.url=r.url||'';
    await load();panelBack();toast(r.url?'已连接家庭服务':'已改回只用本机记录');return;
  }
  const previous={...sync};
  Object.assign(sync,{url,key:String(body.key||'').trim()});
  try{if(url){const h=await fetch(url+'/api/health').then(r=>r.json()).catch(()=>null);if(!h?.ok)throw Error('连不上这个地址，请检查是否填对');await api('family')}}
  catch(e){Object.assign(sync,previous);throw e}
  saveSync();await load();panelBack();toast(url?'已连接家庭服务':'已改回只用本机记录');
};
async function action(a,id,el){const previous=panelNavigation.route;panelNavigation.route=[a,id];try{return await dispatchAction(a,id,el)}finally{panelNavigation.route=previous}}

function toast(text){$('.m-toast')?.remove();const el=document.createElement('div');el.className='m-toast';el.setAttribute('role','status');el.textContent=text;document.body.append(el);setTimeout(()=>el.remove(),2600)}

/* ---------- 外观：主题跟随系统，字号可在端内切换 ---------- */

const APPEARANCE_KEY='anyao-appearance';
const appearance=Object.assign({fontScale:'standard'},(()=>{try{return JSON.parse(localStorage.getItem(APPEARANCE_KEY))||{}}catch{return{}}})());
const systemDark=matchMedia('(prefers-color-scheme:dark)');
const themeColorTag=document.querySelector('meta[name="theme-color"]');
function applyAppearance(){
  const root=document.documentElement;
  root.dataset.theme=systemDark.matches?'dark':'light';
  if(appearance.fontScale==='large')root.dataset.fontScale='large';else delete root.dataset.fontScale;
  if(themeColorTag)themeColorTag.content=root.dataset.theme==='dark'?'#1b1b1b':'#f2f2f2';
}
systemDark.addEventListener?.('change',applyAppearance);
function saveAppearance(){try{localStorage.setItem(APPEARANCE_KEY,JSON.stringify(appearance))}catch{}applyAppearance()}
const segmented=(action,current,options)=>`<div class="segmented" role="group">${options.map(([v,l])=>`<button type="button" data-action="${action}" data-id="${v}" class="${v===current?'selected':''}" aria-pressed="${v===current}">${l}</button>`).join('')}</div>`;
applyAppearance();

/* 分段控件与开关的就地重绘：只改这一个控件的状态，
   不重排整页、不重播页面入场动画（否则看起来像整页刷新）。 */
function paintSegmented(action,current){
  document.querySelectorAll(`[data-action="${action}"]`).forEach(b=>{
    const on=b.dataset.id===current;
    b.classList.toggle('selected',on);
    b.setAttribute('aria-pressed',String(on));
  });
}
function paintSwitchRow(action,id,on,text){
  const row=document.querySelector(`[data-action="${action}"][data-id="${id}"]`);
  if(!row)return null;
  row.setAttribute('aria-pressed',String(on));
  row.querySelector('.switch')?.classList.toggle('on',on);
  if(text){const small=row.querySelector('small');if(small)small.textContent=text}
  return row;
}

/* ---------- 交互 ---------- */

/* 按压态：手指一按下就给控件加 .is-pressed（和原生按钮一样立刻有反馈，不等浏览器判定点击），
   手指移动超过 10px（在滚动）、抬起或被系统取消时立刻去掉。禁用的控件没有按压态。 */
const press={el:null,x:0,y:0};
const releasePress=()=>{press.el?.classList.remove('is-pressed');press.el=null};
document.addEventListener('pointerdown',e=>{
  if(e.pointerType==='mouse'&&e.button!==0)return;
  const el=e.target.closest('button,a[href],summary,[data-tab],[role="button"]');
  releasePress();
  if(!el||el.disabled||el.getAttribute('aria-disabled')==='true')return;
  press.el=el;press.x=e.clientX;press.y=e.clientY;el.classList.add('is-pressed');
},{passive:true});
document.addEventListener('pointermove',e=>{if(press.el&&Math.hypot(e.clientX-press.x,e.clientY-press.y)>10)releasePress()},{passive:true});
['pointerup','pointercancel','dragstart'].forEach(t=>document.addEventListener(t,releasePress,{passive:true}));
document.addEventListener('scroll',releasePress,{passive:true,capture:true});

document.addEventListener('click',async e=>{
  const b=e.target.closest('button,[data-tab]');if(!b)return;
  if(b.dataset.tab){goTab(b.dataset.tab);return}
  const a=b.dataset.action;if(!a)return;
  try{await action(a,b.dataset.id,b)}catch(error){toast(error.message)}
});

document.addEventListener('submit',async e=>{
  const form=e.target,kind=form.dataset.kind;
  if(!kind)return;
  const handler=formHandlers[kind]||(kind==='restore'?async f=>{
    const file=new FormData(f).get('file');
    if(!file)throw Error('请选择备份文件');
    await send('restore',JSON.parse(await file.text()));
    await load();$('#detail-dialog').close();toast('已恢复，原记录已自动备份');
  }:null);
  if(!handler)return;
  await saveForm(e,async()=>{try{await handler(form)}catch(error){toast(error.message)}});
});

document.addEventListener('visibilitychange',()=>{if(!document.hidden)load().catch(()=>{})});
$$('.m-dialog [data-dialog-cancel]').forEach(b=>b.addEventListener('click',()=>b.closest('dialog').close()));

/* ---------- 启动 ---------- */

/* 底导航图标用参考库的四个一级标签图标：名称写在按钮的 data-icon 上，深浅色与选中态由 CSS 换源。 */
tabButtons().forEach(btn=>{const slot=btn.querySelector('.tab-icon');if(slot)slot.dataset.mi=btn.dataset.icon||'mine'});
state.tab=tabButtons()[0]?.dataset.tab||'';
$('#view').innerHTML='<p class="empty">正在载入记录…</p>';
load().catch(error=>{$('#view').innerHTML=`<div class="page"><p class="empty">${esc(error.message)}</p><button class="secondary-btn" data-action="sync-settings">检查同步与访问</button><button class="secondary-btn" onclick="location.reload()">重新载入</button></div>`});
/* 安装到手机桌面（PWA）：只在 http(s) 下注册，单文件 HTML 直接双击时跳过 */
if('serviceWorker' in navigator&&/^https?:$/.test(location.protocol)&&!window.NativeApi)navigator.serviceWorker.register('./sw.js').catch(()=>{});
