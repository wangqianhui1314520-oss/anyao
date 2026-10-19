/* Android bridge UI. Device/health values are rendered only from native replies. */
(() => {
  const pending=new Map();
  const wearable={device:null,devices:[],health:null,privateHistory:[],authenticated:false,profile:'LEGACY_4',status:'尚未连接',error:'',busy:false,originPackage:localStorage.getItem('anyao-health-origin')??'com.anyao.smartdemo',days:7};
  const hipee={status:null,battery:null,firmware:null,history:[],lastPush:null,lastSync:null};
  /** 手机端服药时刻表：去重排序后下发给药盒（药盒按顺序分配格号，一次最多 24 个时段）。 */
  // 药盒物理上只有 4 个仓位，超过 4 个时段无法落到硬件，因此这里就截断并如实提示。
  const BOX_SLOTS=4;
  function scheduleTimes(){return [...new Set((state.drugs||[]).filter(d=>!d.asNeeded).flatMap(d=>Array.isArray(d.times)?d.times:[]))].filter(t=>/^([01]\d|2[0-3]):[0-5]\d$/.test(t)).sort().slice(0,BOX_SLOTS)}
  async function refreshHipeeHistory(){try{return hipee.history=await api('hipee-history')}catch(_){return hipee.history=[]}}
  const supported=()=>Boolean(window.NativeWearable?.postMessage);
  function nativeCall(action,deviceId,extra={}){return new Promise((resolve,reject)=>{
    if(!supported())return reject(new Error('需要在 Android 客户端中使用。当前浏览器不能访问 Android 蓝牙和健康记录。'));
    const id=crypto.randomUUID(),timer=setTimeout(()=>{pending.delete(id);reject(new Error('设备响应超时，请重试'));},action==='syncXiaomi'?300000:120000);
    pending.set(id,{resolve,reject,timer});
    window.NativeWearable.onmessage=event=>{try{const r=JSON.parse(event.data),p=pending.get(r.id);if(!p)return;clearTimeout(p.timer);pending.delete(r.id);r.ok?p.resolve(r.data):p.reject(new Error(r.error||'操作失败'));}catch(e){wearable.error=e.message}};
    try { window.NativeWearable.postMessage(JSON.stringify({id,action,days:wearable.days,originPackage:wearable.originPackage,...(deviceId?{deviceId}:{}),...extra})); }
    catch(e){clearTimeout(timer);pending.delete(id);reject(e)}
  })}
  const metric=(label,value,unit='')=>`<div class="wearable-metric"><span>${label}</span><b>${value===undefined||value===null?'未读取':esc(value)+(unit?' <small>'+esc(unit)+'</small>':'')}</b></div>`;
  window.WearableReminders = supported() ? {
    status:()=>nativeCall('watchReminderStatus'),
    preview:(kind,deviceId)=>nativeCall('watchAlert',deviceId,{target:'wearable',kind,message:'安药 · 该服药了'})
  } : null;
  // HiPee 药盒桥：状态查询 / 下发服药计划 / 同步服药记录（导入与联动由原生侧完成）。
  window.PillboxReminders = supported() ? {
    status:()=>nativeCall('hipeeStatus'),
    pushSchedule:()=>nativeCall('hipeePushSchedule',null,{times:scheduleTimes()}),
    sync:()=>nativeCall('hipeeSync')
  } : null;
  function mergeDevice(data,previous=wearable.device||{}){
    const info=data?.deviceInfo&&typeof data.deviceInfo==='object'?data.deviceInfo:{};
    return {...previous,...info,...data,
      model:data?.model||info.model||data?.modelNumber||info.modelNumber||previous.model||previous.modelNumber,
      firmware:data?.firmware||info.firmware||data?.firmwareRevision||info.firmwareRevision||previous.firmware||previous.firmwareRevision,
      manufacturer:data?.manufacturer||info.manufacturer||previous.manufacturer};
  }
  const recordNames={XiaomiStressRecord:'压力指数（小米）',StepsRecord:'步数',HeartRateRecord:'心率',RestingHeartRateRecord:'静息心率',SleepSessionRecord:'睡眠',OxygenSaturationRecord:'血氧',TotalCaloriesBurnedRecord:'总热量',ActiveCaloriesBurnedRecord:'活动热量',DistanceRecord:'距离',ExerciseSessionRecord:'运动',SpeedRecord:'速度',RespiratoryRateRecord:'呼吸频率',BodyTemperatureRecord:'体温',WeightRecord:'体重',BloodPressureRecord:'血压'};
  const summaries={XiaomiStressRecord:{unit:'分',kind:'mean',field:'score'},RestingHeartRateRecord:{unit:'次/分钟',kind:'mean',field:'bpm'},StepsRecord:{unit:'步',kind:'sum',field:'count'},HeartRateRecord:{unit:'次/分钟',kind:'mean',sample:'bpm'},SleepSessionRecord:{unit:'小时',kind:'sum',duration:true},OxygenSaturationRecord:{unit:'%',kind:'mean',field:'percent'},TotalCaloriesBurnedRecord:{unit:'千卡',kind:'sum',field:'kcal'},ActiveCaloriesBurnedRecord:{unit:'千卡',kind:'sum',field:'kcal'},DistanceRecord:{unit:'米',kind:'sum',field:'meters'},ExerciseSessionRecord:{unit:'分钟',kind:'sum',duration:true},SpeedRecord:{unit:'米/秒',kind:'mean',sample:'metersPerSecond'},RespiratoryRateRecord:{unit:'次/分钟',kind:'mean',field:'breathsPerMinute'},BodyTemperatureRecord:{unit:'℃',kind:'mean',field:'celsius'},WeightRecord:{unit:'公斤',kind:'mean',field:'kg'},BloodPressureRecord:{unit:'mmHg',kind:'mean',field:'systolicMmHg'}};
  const dayKey=time=>{const d=new Date(time);return Number.isNaN(d.getTime())?'':`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
  const formatNumber=n=>Number.isFinite(n)?Number(n.toFixed(1)).toLocaleString('zh-CN'):'—';
  const when=time=>{const d=new Date(time);return Number.isNaN(d.getTime())?'时间未提供':d.toLocaleString('zh-CN',{year:'numeric',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'})};
  const healthView={day:'',period:'day',type:'',source:wearable.originPackage,limit:60};
  const stageNames={0:'未知',1:'清醒',2:'睡眠',3:'离床',4:'浅睡',5:'深睡',6:'快速眼动'};
  const sourceName=p=>p==='com.anyao.smartdemo'?'安药直接读取':gbPackages.includes(p)?'Gadgetbridge':p==='com.mi.health'?'小米运动健康':p||'全部已授权来源';
  const recordTime=r=>r.time||(r.end&&Date.parse(r.end)>Date.parse(r.start)?new Date(Date.parse(r.end)-1).toISOString():r.end||r.start);
  function healthEntries(data){
    return (data?.records||[]).flatMap(r=>{
      const config=summaries[r.type];
      if(config?.sample)return (r.samples||[]).filter(s=>Number.isFinite(Date.parse(s.time))).map(s=>({...r,time:s.time,samples:[s],sampleEntry:true}));
      return Number.isFinite(Date.parse(r.time||r.end||r.start))?[r]:[];
    }).sort((a,b)=>Date.parse(recordTime(b))-Date.parse(recordTime(a)));
  }
  function healthWindow(day=healthView.day||dayKey(new Date()),period=healthView.period){
    const start=new Date(day+'T00:00:00'),end=new Date(start);
    if(period==='week')start.setDate(start.getDate()-6);
    if(period==='month')start.setDate(start.getDate()-29);
    end.setDate(end.getDate()+1);
    return {start:start.getTime(),end:end.getTime()};
  }
  function selectedHealth(data,type=healthView.type){
    const {start,end}=healthWindow();
    return healthEntries(data).filter(r=>{const time=Date.parse(recordTime(r));return (!type||r.type===type)&&(!healthView.source||!r.originPackage||r.originPackage===healthView.source)&&time>=start&&time<end});
  }
  function healthControls(data,type=''){
    initializeHealthDate(data);
    const types=[...new Set((data?.records||[]).map(r=>r.type))],sources=[...new Set([healthView.source,...(data?.records||[]).map(r=>r.originPackage).filter(Boolean)])];
    return `<div class="health-date-control"><button data-health-shift="-1" aria-label="前一天">‹</button><label>记录日期<input id="health-date" type="date" value="${esc(healthView.day)}" /></label><button data-health-shift="1" aria-label="后一天">›</button></div><div class="health-period-tabs" role="group" aria-label="查看时间范围">${[['day','日'],['week','近 7 日'],['month','近 30 日']].map(([value,label])=>`<button data-health-period="${value}" aria-pressed="${healthView.period===value}">${label}</button>`).join('')}</div><details class="health-filter-options"><summary>筛选记录</summary>${type?'':`<label class="health-type-filter">数据类型<select id="health-type"><option value="">全部已同步项目</option>${types.map(t=>`<option value="${esc(t)}" ${healthView.type===t?'selected':''}>${esc(recordNames[t]||t)}</option>`).join('')}</select></label>`}<label class="health-type-filter">数据来源<select id="health-source">${sources.map(source=>`<option value="${esc(source)}" ${source===healthView.source?'selected':''}>${esc(sourceName(source))}</option>`).join('')}</select></label></details>`;
  }
  function initializeHealthDate(data){if(healthView.day)return;const entries=healthEntries(data).filter(r=>!healthView.source||!r.originPackage||r.originPackage===healthView.source),today=dayKey(new Date());healthView.day=entries.some(r=>dayKey(recordTime(r))===today)?today:dayKey(entries.length?recordTime(entries[0]):new Date());}
  function healthTimeline(data,type=''){
    const allEntries=selectedHealth(data,type),entries=allEntries.slice(0,healthView.limit),groups=new Map();
    for(const r of entries){const day=dayKey(recordTime(r));if(!groups.has(day))groups.set(day,[]);groups.get(day).push(r)}
    const html=`<div class="health-timeline">${[...groups].map(([day,records])=>`<section class="health-timeline-day"><h3>${esc(day.replaceAll('-',' / '))}<small>${records.length} 项测量 / 时段</small></h3>${records.map(r=>`<article class="health-timeline-item"><time datetime="${esc(r.time||r.end||r.start)}">${esc(new Date(r.time||r.end||r.start).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',second:'2-digit'}))}</time><div><strong>${esc(recordNames[r.type]||r.type)}</strong><p>${esc(recordDescription(r))}</p>${r.stages?.length?`<div class="sleep-stage-list">${r.stages.map(s=>`<span>${esc(stageNames[s.stage]||'未知')} · ${esc(when(s.start))} — ${esc(when(s.end))}</span>`).join('')}</div>`:''}<small>${esc(r.device?.model||'设备型号未提供')} · ${esc(sourceName(r.originPackage))}</small></div></article>`).join('')}</section>`).join('')||'<p class="empty">所选日期暂无记录。</p>'}</div>`;
    return html+(allEntries.length>entries.length?`<button class="secondary-btn" data-health-more="true">显示更多 · 已显示 ${entries.length} / ${allEntries.length} 项</button>`:'');
  }
  function summarizeHealth(data){
    const groups=new Map();
    for(const r of data?.records||[]){const config=summaries[r.type];if(!config)continue;if(!groups.has(r.type))groups.set(r.type,{type:r.type,config,records:[],points:[]});const group=groups.get(r.type);group.records.push(r);
      if(config.sample){for(const s of r.samples||[]){const value=Number(s[config.sample]);if(s[config.sample]!=null&&Number.isFinite(value)&&dayKey(s.time))group.points.push({time:s.time,value})}}
      else {const time=recordTime(r);let value=config.duration?(Date.parse(r.end)-Date.parse(r.start))/(r.type==='SleepSessionRecord'?3600000:60000):Number(r[config.field]);if((config.duration||r[config.field]!=null)&&Number.isFinite(value)&&value>=0&&dayKey(time))group.points.push({time,value,record:r})}
    }
    for(const group of groups.values()){group.points.sort((a,b)=>Date.parse(a.time)-Date.parse(b.time));const buckets=new Map();for(const p of group.points){const day=dayKey(p.time);if(!buckets.has(day))buckets.set(day,[]);buckets.get(day).push(p.value)}group.days=[...buckets].sort(([a],[b])=>a.localeCompare(b)).map(([day,values])=>({day,value:values.reduce((a,b)=>a+b,0)/(group.config.kind==='mean'?values.length:1),count:values.length}));group.latest=group.points.at(-1);group.latestDay=group.days.at(-1);}
    return [...groups.values()];
  }
  function chartHealth(group){
    const {start,end}=healthWindow(),points=group.points.filter(p=>Date.parse(p.time)>=start&&Date.parse(p.time)<end),buckets=new Map();
    for(const p of points){const label=healthView.period==='day'?new Date(p.time).getHours().toString().padStart(2,'0')+':00':dayKey(p.time).slice(5).replace('-','/');if(!buckets.has(label))buckets.set(label,[]);buckets.get(label).push(p.value)}
    const days=[...buckets].map(([day,values])=>({day,value:values.reduce((a,b)=>a+b,0)/(group.config.kind==='mean'?values.length:1)}));if(!days.length)return '<p class="empty">所选日期暂无可绘制的测量值</p>';
    const max=Math.max(...days.map(x=>x.value),1);return `<div class="wearable-chart" role="img" aria-label="${esc(recordNames[group.type])}所选日期趋势"><div class="wearable-chart-bars">${days.map(x=>`<div class="wearable-chart-column"><span>${formatNumber(x.value)}</span><i style="height:${Math.max(2,x.value/max*96)}px"></i><small>${esc(x.day)}</small></div>`).join('')}</div></div><p class="helper">${group.config.kind==='sum'?'累计':'平均'} · ${esc(group.config.unit)}</p>`;
  }
  function wearableVisualization(data,compact=false){
    const synced=summarizeHealth(data).filter(g=>g.latest),types=['StepsRecord','HeartRateRecord','RestingHeartRateRecord','SleepSessionRecord','OxygenSaturationRecord','XiaomiStressRecord','DistanceRecord','ActiveCaloriesBurnedRecord','ExerciseSessionRecord'],groups=[...new Set([...types,...synced.map(g=>g.type)])].filter(type=>!healthView.type||healthView.type===type).map(type=>synced.find(g=>g.type===type)||{type,config:summaries[type],records:[],points:[]});
    const cards=groups.map(g=>{if(!g.latest)return `<button class="wearable-summary-card" data-health-type="${esc(g.type)}"><span>${esc(recordNames[g.type])}</span><strong class="health-not-synced">未同步</strong><small>${esc(healthView.day)} · 所选日期暂无记录</small></button>`;const total=g.points.reduce((sum,p)=>sum+p.value,0);let value=g.config.kind==='sum'?formatNumber(total):formatNumber(g.latest.value);if(g.type==='BloodPressureRecord')value+=` / ${formatNumber(Number(g.latest.record.diastolicMmHg))}`;return `<button class="wearable-summary-card" data-health-type="${esc(g.type)}"><span>${esc(recordNames[g.type])}${g.type==='SleepSessionRecord'?'时长':''}</span><strong>${value}<small>${esc(g.config.unit)}</small></strong><small>${g.config.kind==='sum'?esc(healthView.day)+' · 累计':'最近 '+esc(when(g.latest.time))}</small></button>`}).join('');
    // Trend graphs belong to the health overview. Detail views deliberately use
    // healthTimeline only, so a record's samples remain readable in time order.
    return `<div class="wearable-summary-grid">${cards}</div>${compact?'':groups.filter(g=>g.latest).map(g=>`<details class="surface wearable-trend" open><summary>${esc(recordNames[g.type])}趋势 <span>${g.records.length} 条记录</span></summary>${chartHealth(g)}</details>`).join('')}`;
  }
  function recordDescription(r){
    const c=summaries[r.type];if(!c)return '原始记录';if(c.sample)return (r.samples||[]).map(s=>`${r.sampleEntry?'':when(s.time)+' '}${formatNumber(Number(s[c.sample]))} ${c.unit}`).join('；')||'无测量样本';
    if(c.duration)return `${r.title?r.title+' · ':''}${when(r.start)} — ${when(r.end)} · ${formatNumber((Date.parse(r.end)-Date.parse(r.start))/(r.type==='SleepSessionRecord'?3600000:60000))} ${c.unit}${r.stages?.length?' · '+r.stages.length+' 个睡眠阶段':''}`;
    if(r.type==='BloodPressureRecord')return `${formatNumber(Number(r.systolicMmHg))} / ${formatNumber(Number(r.diastolicMmHg))} mmHg`;
    return `${r.start&&r.end?when(r.start)+' — '+when(r.end)+' · ':''}${formatNumber(Number(r[c.field]))} ${c.unit}`;
  }
  function healthCards(data){
    const records=Array.isArray(data.records)?data.records:[];
    return `<p class="helper">已保存 ${records.length} 条记录${data.to?' · 更新于 '+esc(when(data.to)):''}</p>`+healthControls(data)+wearableVisualization({records:selectedHealth(data)},true)+healthTimeline(data)+(data.unavailable?.length?`<details class="health-record-group"><summary>权限与读取详情</summary><p class="helper">${data.unavailable.map(x=>`${esc(recordNames[x.type]||x.type)}：${esc(x.reason==='permission_not_granted'?'尚未授权':x.reason)}`).join('<br>')}</p></details>`:'');
  }
  const summaryFields={steps:['步数','步'],activeCaloriesKcal:['活动热量','千卡'],totalCaloriesKcal:['总热量','千卡'],restingHeartRateBpm:['静息心率','次/分钟'],maxHeartRateBpm:['最高心率','次/分钟'],minHeartRateBpm:['最低心率','次/分钟'],averageHeartRateBpm:['平均心率','次/分钟'],averageStressScore:['平均压力指数','分'],maxStressScore:['最高压力指数','分'],minStressScore:['最低压力指数','分'],maxSpo2Percent:['最高血氧','%'],minSpo2Percent:['最低血氧','%'],averageSpo2Percent:['平均血氧','%'],recoveryHours:['恢复时间','小时'],trainingLoadDay:['当日训练负荷',''],trainingLoadWeek:['周训练负荷',''],trainingLoadLevel:['训练负荷档位',''],vitalityIncreaseLight:['轻度活动活力增量','分'],vitalityIncreaseModerate:['中度活动活力增量','分'],vitalityIncreaseHigh:['高强度活动活力增量','分'],vitalityCurrent:['当前活力值','分']};
  function summaryEntries(){return wearable.privateHistory.flatMap(h=>(h.files||[]).filter(f=>f.parsed?.summary).map(f=>({...f.parsed.summary,model:h.deviceName||'小米设备'}))).sort((a,b)=>Date.parse(b.time)-Date.parse(a.time));}
  function summaryValues(s){return Object.entries(summaryFields).filter(([key])=>Number.isFinite(s.values?.[key])).map(([key,[label,unit]])=>`<div><span>${esc(label)}</span><b>${formatNumber(s.values[key])}${unit?' '+esc(unit):''}</b></div>`).join('')+(Array.isArray(s.standingHours)?`<div><span>有站立活动的小时</span><b>${s.standingHours.length} 小时</b></div>`:'');}
  function dailySummarySection(){if(healthView.source&&healthView.source!=='com.anyao.smartdemo')return '';const entries=summaryEntries(),{start,end}=healthWindow();const cards=entries.map((s,index)=>({s,index})).filter(({s})=>Date.parse(s.time)>=start&&Date.parse(s.time)<end);return `<div class="section-heading"><h2>手表每日汇总</h2></div><p class="helper">手表统计的每日健康数据。</p>${cards.length?cards.map(({s,index})=>`<button class="surface menu-row" data-xiaomi-summary="${index}"><span class="row-body"><strong>${esc(dayKey(s.time))} · ${esc(s.model)}</strong><small>${Object.entries(summaryFields).filter(([key])=>['steps','activeCaloriesKcal','restingHeartRateBpm','vitalityCurrent'].includes(key)&&Number.isFinite(s.values?.[key])).map(([key,[label,unit]])=>`${esc(label)} ${formatNumber(s.values[key])} ${esc(unit)}`).join(' · ')||'已读取手表每日统计'}</small></span><span>查看 ›</span></button>`).join(''):'<p class="empty">所选日期暂无手表每日汇总。</p>'}`;}
  function showDailySummary(index){const s=summaryEntries()[index];if(!s)return;openedHealthType='';panel('手表每日汇总',dayKey(s.time),`<p class="helper">${esc(s.model)} · ${esc(dayKey(s.time))}</p><div class="detail-list">${summaryValues(s)}</div>${[['maxHeartRateEpochSeconds','最高心率测量时间'],['minHeartRateEpochSeconds','最低心率测量时间'],['maxSpo2EpochSeconds','最高血氧测量时间'],['minSpo2EpochSeconds','最低血氧测量时间']].filter(([key])=>s.values?.[key]>0).map(([key,label])=>`<p class="helper">${esc(label)}：${esc(when(s.values[key]*1000))}</p>`).join('')}${Array.isArray(s.standingHours)?`<p class="helper">有站立活动的时段：${s.standingHours.map(hour=>`${String(hour).padStart(2,'0')}:00—${String(hour+1).padStart(2,'0')}:00`).join('、')||'手表报告无活动小时'}。每个标记表示该小时有站立活动，不代表连续站立一小时。</p>`:''}`);}
  let openedHealthType='';
  function showHealthType(type){openedHealthType=type;panel(recordNames[type]||type,'按测量时间查看',healthControls(wearable.health,type)+healthTimeline(wearable.health,type));}
  function redrawHealthView(){if(openedHealthType&&document.querySelector('dialog[open] #health-date'))showHealthType(openedHealthType);else if(document.querySelector('dialog[open] [data-band=healthRead]'))show();else refreshHealthOverview();}
  document.addEventListener('change',e=>{if(e.target.id==='health-date'){healthView.limit=60;healthView.day=e.target.value||dayKey(new Date());redrawHealthView()}if(e.target.id==='health-source'){healthView.limit=60;healthView.source=e.target.value;localStorage.setItem('anyao-native-source-migrated-v1','1');redrawHealthView()}if(e.target.id==='health-type'){healthView.limit=60;healthView.type=e.target.value;redrawHealthView()}});
  document.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.healthMore){healthView.limit+=60;redrawHealthView()}if(b.dataset.healthPeriod){healthView.limit=60;healthView.period=b.dataset.healthPeriod;redrawHealthView()}if(b.dataset.healthShift){healthView.limit=60;const d=new Date(healthView.day+'T12:00:00');d.setDate(d.getDate()+Number(b.dataset.healthShift));healthView.day=dayKey(d);redrawHealthView()}});
  const gbPackages=['nodomain.freeyourgadget.gadgetbridge','nodomain.freeyourgadget.gadgetbridge.nightly'];
  function syncCoverageStatus(data){const count=key=>Number.isInteger(data?.[key])?String(data[key]):'待确认';return `${data?.complete===true?'本次下载流程已结束':'本次同步尚未结束'} · 已保存 ${count('fileCount')} 个文件 · 已解析 ${count('parsedFileCount')} 个 / 待解析 ${count('unparsedFileCount')} 个 · 列表缺失 ${count('missingAnnouncedFileCount')} 个${data?.coverageComplete===true&&data?.healthParseComplete===true?' · 本次文件已完整覆盖并解析':' · 尚未确认全部文件已读取并解析'}`;}
  function latestSync(){return wearable.privateHistory.filter(h=>h.protocol?.startsWith('xiaomi')).sort((a,b)=>Date.parse(b.capturedAt)-Date.parse(a.capturedAt))[0];}
  function syncCoverageBlock(){const latest=latestSync();return latest?`<details class="health-record-group"><summary>同步详情</summary><p class="helper">${esc(syncCoverageStatus(latest))}</p></details>`:'';}
  function xiaomiSection(){return `<details class="wearable-settings-group"><summary>首次连接设置</summary><p class="helper">首次连接需要设备的已有绑定密钥，设置后会安全保存。</p><label>绑定密钥<input id="xiaomi-auth-key" type="password" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="输入已有绑定密钥" maxlength="34" /></label><button class="secondary-btn" data-band="authenticateXiaomi" ${!supported()||!wearable.device||wearable.busy?'disabled':''}>保存并启用自动同步</button></details>`}
  function gadgetbridgeSection(){return `<details class="surface" style="padding:16px"><summary>其他同步方式 · Gadgetbridge</summary><p class="helper">已有 Gadgetbridge 配对时，可通过手机健康数据导入记录。</p><div class="action-grid"><button data-band="gadgetbridgeOpen" ${!supported()||wearable.busy?'disabled':''}>打开 Gadgetbridge</button><button data-band="gadgetbridgeSync" ${!supported()||wearable.busy?'disabled':''}>请求外部同步</button></div></details>`}
  function hipeeRecordTime(ts){const d=new Date(Number(ts)*1000);return Number.isNaN(d.getTime())?'时间未提供':d.toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}
  function hipeeHistoryBlock(){
    const entries=(hipee.history||[]).filter(h=>Array.isArray(h.records)&&h.records.length);
    if(!entries.length)return '<p class="helper">还没有药盒上报的服药记录。连接药盒后点击“同步服药记录”，已服记录会自动标记今日服药。</p>';
    return entries.map(h=>`<details class="surface health-record-group"><summary>${esc(h.deviceName||'HiPee 药盒')} · ${h.records.length} 条记录<span>${esc(when(h.capturedAt))}</span></summary>${h.records.slice(-40).reverse().map(r=>`<div class="health-record"><strong>${esc(hipeeRecordTime(r.timestamp))} · 第 ${esc(r.compartment)} 格</strong><small>${r.taken?'药盒报告已服药':'药盒报告未服药'}</small></div>`).join('')}<p class="helper">展示最近 40 条，完整记录包含在本机备份中。</p></details>`).join('');
  }
  function hipeeSection(){
    const s=hipee.status,connected=s?.connected===true,open=s?.open===true,box=s?.supported===true;
    const times=scheduleTimes(),battery=s?.battery??hipee.battery,firmware=s?.firmwareFromQuery??hipee.firmware;
    const connHint=open?'指令会话已打开':box?'会话会在你点击功能时自动打开':connected?'当前设备未暴露 HiPee 药盒服务':'尚未连接药盒';
    // 失败原因必须看得见：原生侧会把 hipeeOpenError / hipeeQueryError 随 hipeeStatus 返回，
    // 以前没人读它，所以"什么都点不了"变成了一个黑洞。
    const boxError=open?(s?.hipeeQueryError||''):(s?.hipeeOpenError||wearable.hipeeError||'');
    // 2026-10-14 真机 P0：原为 `const gate=wearable.busy||!supported()||!open;`
    // —— 所有功能按钮都要求"指令会话必须先手动打开"。一旦 hipeeOpen 因 query 未回包而失败，
    // 绑定/启用/下发/同步/单格提醒/寻找会**全部变灰**，用户看到的是"药盒已连接，指令会话未打开"，
    // 既不知道原因也没有补救入口。原生侧现已支持按需自动开会话，这里改为只要求"设备暴露药盒服务"。
    const gate=wearable.busy||!supported()||!box;
    return `<div class="section-heading"><h2>HiPee 智能药盒</h2><span class="note">${esc(connHint)}</span></div>${boxError?`<p class="helper wearable-feedback" role="status">药盒诊断：${esc(boxError)}</p>`:''}<div class="surface wearable-settings-group"><p class="helper">通过蓝牙连接 HiPee 智能药盒：把服药计划下发到药盒提醒，药盒上报的服药记录会自动标记今日服药并扣减库存。</p><div class="tracker-grid">${metric('指令会话',open?'已打开':'未打开')}${metric('电量',battery,'%')}${metric('固件版本',firmware||undefined)}</div><div class="action-grid"><button data-band="hipeeStatus" ${wearable.busy||!supported()?'disabled':''}>刷新状态</button><button data-band="hipeeOpen" ${wearable.busy||!supported()||!connected||open||!(wearable.device||s?.deviceId)?'disabled':''}>打开指令会话</button><button data-band="hipeeQuery" ${gate?'disabled':''}>查询电量</button><button data-band="hipeeBind" ${gate?'disabled':''}>绑定药盒</button><button data-band="hipeeEnable" ${gate?'disabled':''}>启用提醒</button></div><p class="helper"><b>绑定需要你在药盒上确认</b>：点「绑定药盒」后，药盒会滴一声提示，请在 12 秒内<b>短按药盒顶部按钮</b>完成配对，否则会超时失败。绑定没完成，后面的启用与下发都会被药盒拒绝。</p>${connected?'':'<p class="helper">请先在上方设备列表连接药盒；连接成功会自动打开指令会话。</p>'}<p class="helper">药盒<b>不是一直广播</b>：它只在唤醒后的一小段时间内可被发现，之后会自动休眠。列表里看不到它或连不上时，<b>短按药盒顶部按钮</b>唤醒，再点扫描 / 连接。</p><details class="wearable-settings-group"><summary>下发服药计划</summary><p class="helper">把 App 内药物的每日服药时间下发到药盒，按时间顺序分配到 <b>1~${BOX_SLOTS} 号仓位</b>。药盒物理只有 ${BOX_SLOTS} 个仓位，因此最多只能下发 ${BOX_SLOTS} 个时段。</p><p class="helper">${times.length?'将下发 '+times.length+' 个时段：'+esc(times.join('、')):'尚未设置可下发的服药时间，请先在 App 内添加药物与服药时间。'}</p><div class="action-grid"><button data-band="hipeePushSchedule" ${gate||!times.length?'disabled':''}>下发服药计划</button></div>${hipee.lastPush?`<p class="helper">上次下发 ${esc(hipee.lastPush.pushed)} 个时段${hipee.lastPush.slots?.length?'：'+esc(hipee.lastPush.slots.map(x=>'第 '+esc(x.slot)+' 格 '+esc(x.time)).join('、')):''}</p>`:''}</details><details class="wearable-settings-group"><summary>同步服药记录</summary><p class="helper">读取药盒离线保存的服药记录，按本地时间匹配今日计划并标记已服用。</p><div class="action-grid"><button data-band="hipeeSync" ${gate?'disabled':''}>同步服药记录</button></div>${hipee.lastSync?`<p class="helper">上次同步 ${esc(hipee.lastSync.recordCount)} 条记录 · 自动标记 ${esc(hipee.lastSync.matchedIntakeEvents)} 次今日服药</p>`:''}${hipeeHistoryBlock()}</details><details class="wearable-settings-group"><summary>单格提醒</summary><p class="helper">为指定格号设置或清除提醒时间。</p><label>格号<input id="hipee-slot" type="number" min="1" max="255" value="1" /></label><label>提醒时间<input id="hipee-time" type="time" value="08:00" /></label><div class="action-grid"><button data-band="hipeeSetReminder" ${gate?'disabled':''}>设置提醒</button><button data-band="hipeeClearReminder" ${gate?'disabled':''}>清除提醒</button></div></details><details class="wearable-settings-group"><summary>更多操作</summary><div class="action-grid"><button data-band="hipeeFindBox" ${gate?'disabled':''}>寻找药盒</button><button data-band="hipeeClose" ${wearable.busy||!supported()||!open?'disabled':''}>关闭指令会话</button><button data-band="hipeeUnbind" ${gate?'disabled':''}>解绑药盒</button></div><p class="helper">解绑后药盒不再与本手机联动，需要重新绑定后才能下发计划。</p></details></div>`;
  }
  function privateSection(){return `<div class="section-heading"><h2>直接读取手环历史</h2></div><p class="helper">当前接入旧版华米认证与分钟记录协议。选择实际手环对应的协议；小米手环 7 Pro、8 及以后使用其他协议。</p><label>设备协议<select id="band-profile">${[['LEGACY_2_3','手环 2 / 3 旧协议'],['LEGACY_4','手环 4 旧协议'],['LEGACY_5_6','手环 5 / 6 旧协议']].map(([v,l])=>`<option value="${v}" ${wearable.profile===v?'selected':''}>${l}</option>`).join('')}</select></label><label>已有设备认证密钥<input id="band-auth-key" type="password" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="32 位十六进制绑定密钥" maxlength="34" /></label><p class="helper">密钥仅用于本次连接，不写入备份。设备需要匹配的既有绑定密钥；此功能不会生成密钥或重新绑定。</p><div class="action-grid"><button data-band="authenticateLegacy" ${!supported()||!wearable.device||wearable.busy?'disabled':''}>认证当前连接</button><button data-band="syncLegacy" ${!supported()||!wearable.authenticated||wearable.busy?'disabled':''}>读取分钟历史</button></div><p class="helper">${wearable.authenticated?'旧协议认证已完成':'尚未完成私有协议认证'}。读取完整返回块后保存；原始活动类型保留设备编码。</p>${wearable.privateHistory.map(h=>`<details class="surface health-record-group"><summary>${esc(h.deviceId)} · ${h.records?.length||0} 条分钟记录</summary><p class="helper">${esc(h.protocol)} · ${esc(h.capturedAt)}</p>${(h.records||[]).slice(-60).map(r=>`<div class="health-record"><strong>${esc(r.time)}</strong><small>${esc(r.steps)} 步 · ${r.heartRate==null?'心率未测量':esc(r.heartRate)+' 次/分'} · 活动编码 ${esc(r.kind)}</small></div>`).join('')}<p class="helper">展示最近 60 条，完整记录包含在本机备份中。</p></details>`).join('')}`}
  document.addEventListener('change',async e=>{if(e.target.id==='band-origin'){localStorage.setItem('anyao-native-source-migrated-v1','1');wearable.originPackage=e.target.value;localStorage.setItem('anyao-health-origin',wearable.originPackage);if(supported()&&gbPackages.includes(wearable.originPackage)){try{const r=await nativeCall('gadgetbridgeMode',null,{gadgetbridgePackage:wearable.originPackage});wearable.device=null;wearable.authenticated=false;wearable.status=r.message;wearable.error=''}catch(err){wearable.error=err.message}}show()};if(e.target.id==='band-days')wearable.days=Number(e.target.value);if(e.target.id==='band-profile'){wearable.profile=e.target.value;wearable.authenticated=false}});
  document.addEventListener('submit',async e=>{
    if(e.target.id!=='band-health-import')return;e.preventDefault();
    const file=new FormData(e.target).get('file');if(!file)return;
    try{
      if(file.size>8*1024*1024)throw Error('文件过大，请按较短日期范围分批导出');
      const data=JSON.parse(await file.text());
      wearable.health=await send('wearable-health/import',data);
      wearable.error='';wearable.status='手机健康记录已保存至本机';
    }catch(err){wearable.error=err.message}show();
  });
  function advancedSettings(){return `<details class="surface wearable-advanced"><summary>高级设置</summary><div class="wearable-advanced-body">${xiaomiSection()}<details class="wearable-settings-group"><summary>设备详情</summary><div class="detail-list">${[['型号',wearable.device?.model],['制造商',wearable.device?.manufacturer],['固件版本',wearable.device?.firmware]].map(([label,value])=>`<div><span>${label}</span><b>${esc(value||'暂无信息')}</b></div>`).join('')}</div><button class="secondary-btn" data-band="read" ${wearable.busy||!supported()||!wearable.device?'disabled':''}>更新设备信息</button></details><details class="wearable-settings-group"><summary>其他健康数据来源</summary><p class="helper">补充导入手机中已授权的健康记录。</p><label>数据来源<select id="band-origin">${[['com.anyao.smartdemo','安药'],['nodomain.freeyourgadget.gadgetbridge','Gadgetbridge'],['nodomain.freeyourgadget.gadgetbridge.nightly','Gadgetbridge 测试版'],['com.mi.health','小米运动健康'],['com.xiaomi.wearable','其他小米健康应用'],['','全部已授权来源']].map(([value,label])=>`<option value="${value}" ${wearable.originPackage===value?'selected':''}>${label}</option>`).join('')}</select></label><label>导入范围<select id="band-days">${[7,14,30].map(n=>`<option value="${n}" ${wearable.days===n?'selected':''}>最近 ${n} 天</option>`).join('')}</select></label><div class="action-grid"><button data-band="healthPermissions" ${!supported()||wearable.busy?'disabled':''}>授权健康数据</button><button data-band="healthRead" ${!supported()||wearable.busy?'disabled':''}>导入记录</button></div>${gadgetbridgeSection()}</details><details class="wearable-settings-group"><summary>早期小米手环</summary>${privateSection()}</details><details class="wearable-settings-group"><summary>从文件导入</summary><form id="band-health-import"><label>健康记录文件<input name="file" type="file" accept="application/json,.json" required /></label><p class="helper">支持手机导出的健康记录文件。</p><button class="secondary-btn" type="submit">导入记录</button></form></details>${syncCoverageBlock()}</div></details>`}
  function show(){initializeHealthDate(wearable.health);const d=wearable.device||{},latest=latestSync(),records=wearable.health?.records||[],updated=latest?.capturedAt||wearable.health?.to;panel('穿戴设备','连接与同步',`<div class="surface wearable-device-card"><div class="detail-hero"><span class="row-icon">${icon('heart')}</span><div><strong>${esc(d.name||'连接手表、手环或智能药盒')}</strong><small>${wearable.busy?'正在更新…':wearable.authenticated?'已连接 · 自动同步已开启':wearable.device?'已连接 · 需要完成首次设置':'尚未连接'}</small></div></div>${wearable.device?`<div class="tracker-grid">${metric('电量',d.battery,'%')}${metric('心率',d.heartRate,'次/分钟')}</div>`:''}<div class="action-grid"><button data-band="scan" ${wearable.busy||!supported()?'disabled':''}>${wearable.device?'更换设备':'连接设备'}</button><button data-band="syncXiaomi" ${!supported()||!wearable.device||!wearable.authenticated||wearable.busy?'disabled':''}>${wearable.busy?'同步中…':'立即同步'}</button></div>${updated?`<p class="helper">上次同步 ${esc(when(updated))}</p>`:''}</div>${supported()?'':'<p class="helper">请在安药 Android 应用中连接设备。</p>'}${wearable.error?`<p class="helper wearable-feedback" role="status">${esc(wearable.error)}</p>`:''}${wearable.devices.length?`<div class="section-heading"><h2>可连接设备</h2></div><div class="surface">${wearable.devices.map(x=>`<button class="menu-row" data-band="connect" data-device="${esc(x.deviceId||x.address||x.id)}"><span class="row-icon">${icon('heart')}</span><span class="row-body"><strong>${esc(x.name||'未命名设备')}</strong><small>${x.pillbox?'智能药盒 · ':''}${(x.deviceId||x.address||x.id)===(d.deviceId||d.address||d.id)?'当前设备':'点击连接'}</small></span><span>›</span></button>`).join('')}</div>`:''}${hipeeSection()}<div class="section-heading"><h2>健康记录</h2><span class="note">${records.length} 条</span></div><p class="helper">同步后自动保存到健康页，按日期查看数据与趋势。</p>${records.length?wearableVisualization({records:selectedHealth(wearable.health)},true):'<p class="empty">同步后，你的健康数据会显示在这里。</p>'}${advancedSettings()}${wearable.device?'<button class="secondary-btn" data-band="disconnect">断开连接</button>':''}`)}
  window.openWearablePanel=async()=>{openedHealthType='';show();try{const [data,legacy,modern]=await Promise.all([api('wearable-health'),supported()?api('band-history'):Promise.resolve([]),supported()?api('xiaomi-history'):Promise.resolve([]),refreshHipeeHistory()]);wearable.health=data;restoreVisibleNativeSource(data);wearable.privateHistory=[...legacy,...modern]}catch(err){wearable.error=err.message}if(document.querySelector('dialog[open] [data-band=healthRead]'))show();if(supported())nativeCall('hipeeStatus').then(s=>{hipee.status=s;if(document.querySelector('dialog[open] [data-band=healthRead]'))show()}).catch(()=>{})};
  document.addEventListener('click',async e=>{
    const b=e.target.closest('button');if(!b)return;
    if(b.dataset.xiaomiSummary!==undefined){showDailySummary(Number(b.dataset.xiaomiSummary));return}
    if(b.dataset.healthType){showHealthType(b.dataset.healthType);return}
    if(b.dataset.action==='health-manual'){openedHealthType='';panel('手动健康记录','用药期间的身体观察',`<div class="surface">${metrics.map(([type,title,ico])=>{const t=state.trackers.filter(x=>x.type===type||x.title===title).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at))[0];return row(title,t?.value||'尚无手动记录',ico,`data-action="tracker-detail" data-id="${type}"`)}).join('')}</div>`);return}
    if(!b.dataset.band||wearable.busy)return;
    const action=b.dataset.band,extra={};if(action.startsWith('gadgetbridge'))extra.gadgetbridgePackage=gbPackages.includes(wearable.originPackage)?wearable.originPackage:gbPackages[0];
    if(action==='authenticateXiaomi'){extra.authKey=document.getElementById('xiaomi-auth-key')?.value?.trim()||'';if(!/^(0x)?[a-fA-F0-9]{32}$/.test(extra.authKey)){wearable.error='请填写当前设备已有的 32 位十六进制绑定密钥';show();return}document.getElementById('xiaomi-auth-key').value=''}
    if(action==='authenticateLegacy'){extra.profile=wearable.profile;extra.authKey=document.getElementById('band-auth-key')?.value||'';if(!/^(0x)?[a-fA-F0-9]{32}$/.test(extra.authKey)){wearable.error='请填写当前手环已有的 32 位十六进制绑定密钥';show();return}document.getElementById('band-auth-key').value=''}
    if(action==='syncLegacy')extra.profile=wearable.profile;
    if(action==='hipeePushSchedule'){const times=scheduleTimes();if(!times.length){wearable.error='没有可下发的服药时间，请先在 App 内添加药物与服药时间';show();return}extra.times=times}
    if(action==='hipeeSetReminder'){const slot=Number(document.getElementById('hipee-slot')?.value||0),time=document.getElementById('hipee-time')?.value||'';if(!Number.isInteger(slot)||slot<1||slot>255||!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)){wearable.error='请填写有效格号（1..255）与提醒时间';show();return}extra.slot=slot;extra.secondsFromMidnight=Number(time.slice(0,2))*3600+Number(time.slice(3,5))*60}
    if(action==='hipeeClearReminder'){const slot=Number(document.getElementById('hipee-slot')?.value||0),ctime=document.getElementById('hipee-time')?.value||'';if(!Number.isInteger(slot)||slot<1||slot>255||!/^([01]\d|2[0-3]):[0-5]\d$/.test(ctime)){wearable.error='请填写有效格号（1..255）与提醒时间';show();return}extra.slot=slot;extra.secondsFromMidnight=Number(ctime.slice(0,2))*3600+Number(ctime.slice(3,5))*60}
    const hipeeStatusText={hipeeStatus:'正在读取药盒状态…',hipeeOpen:'正在打开药盒指令会话…',hipeeClose:'正在关闭药盒指令会话…',hipeeQuery:'正在查询电量与固件…',hipeeBind:'正在绑定药盒…（请短按药盒顶部按钮确认，12 秒内）',hipeeEnable:'正在启用药盒提醒…',hipeeFindBox:'正在让药盒响铃…',hipeeUnbind:'正在解绑药盒…',hipeeSetReminder:'正在设置单格提醒…',hipeeClearReminder:'正在清除单格提醒…',hipeePushSchedule:'正在下发服药计划到药盒…',hipeeSync:'正在同步药盒服药记录…'};
    const hipeeDeviceId=action==='hipeeOpen'?(wearable.device?.deviceId||wearable.device?.address||wearable.device?.id||hipee.status?.deviceId||b.dataset.device):b.dataset.device;
    wearable.busy=true;wearable.error='';wearable.status=action==='scan'?'正在扫描…':action==='connect'?'正在连接…':['syncLegacy','syncXiaomi'].includes(action)?'正在读取手表健康历史…':action==='authenticateXiaomi'?'正在认证并保存连接…':hipeeStatusText[action]||wearable.status;show();
    try{const data=await nativeCall(action,hipeeDeviceId,extra);
      if(action==='scan'){wearable.devices=Array.isArray(data)?data:data?.devices||[];wearable.status='扫描完成，共 '+wearable.devices.length+' 个设备'}
      if(action==='connect'){wearable.device=mergeDevice(data,{});wearable.authenticated=data.authenticated===true;wearable.originPackage='com.anyao.smartdemo';healthView.source='com.anyao.smartdemo';localStorage.setItem('anyao-health-origin',wearable.originPackage);wearable.status=wearable.authenticated?'安药已恢复认证连接':'蓝牙连接完成，请认证后同步健康数据'
        // 自动开会话失败原本被静默丢弃，界面只显示"指令会话未打开"。现在把它显示出来。
        if(data.hipeeOpenError)wearable.hipeeError='药盒指令会话未能打开：'+data.hipeeOpenError}
      if(action==='read'){wearable.device=mergeDevice(data);wearable.status='设备信息已更新'}
      if(action==='disconnect'){wearable.device=null;wearable.authenticated=false;wearable.status='已断开'}
      if(action==='authenticateXiaomi'){wearable.authenticated=data.authenticated===true;wearable.device=mergeDevice(data);wearable.originPackage='com.anyao.smartdemo';healthView.source='com.anyao.smartdemo';localStorage.setItem('anyao-health-origin',wearable.originPackage);wearable.status='已连接，自动同步已开启'}
      if(action==='syncXiaomi'){wearable.originPackage='com.anyao.smartdemo';healthView.source='com.anyao.smartdemo';localStorage.setItem('anyao-health-origin',wearable.originPackage);wearable.privateHistory=await api('xiaomi-history');wearable.busy=false;await refreshWearableHealth();wearable.status=syncCoverageStatus(data);if(data.coverageComplete!==true||data.healthParseComplete!==true)wearable.error=data.syncError||'已保存本次读取的记录，部分数据尚未同步，请稍后重试';}
      if(action==='authenticateLegacy'){wearable.authenticated=data.authenticated===true;wearable.status='旧协议认证已完成，可以读取历史'}
      if(action==='syncLegacy'){wearable.privateHistory=await api('band-history');wearable.status='手环返回的完整历史块已保存'}
      if(action==='healthRead'){wearable.health=data;if(data.originPackage===''){healthView.source='';localStorage.setItem('anyao-health-origin','');}refreshHealthOverview();wearable.status='已导入 '+(data.records?.length||data.recordCount||0)+' 条健康记录';if(data.message)wearable.error=data.message;}
      if(action==='gadgetbridgeOpen'){wearable.device=null;wearable.authenticated=false;wearable.status='已打开 Gadgetbridge，请完成认证和连接设置';}
      if(action==='gadgetbridgeSync'){wearable.device=null;wearable.authenticated=false;wearable.status=data.message||'同步请求已发送，尚未确认同步完成';wearable.originPackage='';localStorage.setItem('anyao-health-origin','');}
      if(action==='hipeeStatus'){hipee.status=data;wearable.status='药盒状态已更新'}
      if(action==='hipeeOpen'){hipee.status={...(hipee.status||{}),...data,connected:true,open:true,supported:true};if(data.battery!=null)hipee.battery=data.battery;if(data.firmwareFromQuery)hipee.firmware=data.firmwareFromQuery;wearable.status='药盒指令会话已打开'}
      if(action==='hipeeClose'){if(hipee.status)hipee.status={...hipee.status,open:false};wearable.status='药盒指令会话已关闭'}
      if(action==='hipeeQuery'){hipee.battery=data.battery;hipee.firmware=data.firmwareFromQuery;wearable.status='电量 '+(data.battery??'未知')+'% · 固件 '+(data.firmwareFromQuery||'未知')}
      if(action==='hipeeBind'){wearable.status='药盒已绑定'}
      if(action==='hipeeEnable'){wearable.status='药盒提醒已启用'}
      if(action==='hipeeFindBox'){wearable.status='已请求药盒响铃，请注意查听'}
      if(action==='hipeeUnbind'){wearable.status='药盒已解绑'}
      if(action==='hipeeSetReminder'){wearable.status='第 '+esc(data.slot)+' 格提醒已设置'}
      if(action==='hipeeClearReminder'){wearable.status='第 '+esc(data.slot)+' 格提醒已清除'}
      if(action==='hipeePushSchedule'){hipee.lastPush=data;wearable.status='已下发 '+(data.pushed??0)+' 个服药时段到药盒'}
      if(action==='hipeeSync'){hipee.lastSync=data;await refreshHipeeHistory();wearable.status='已同步 '+(data.recordCount??0)+' 条服药记录 · 自动标记 '+(data.matchedIntakeEvents??0)+' 次今日服药';await load().catch(()=>{})}
      if(action==='healthPermissions')wearable.status='健康数据权限请求已完成';
    }catch(err){
      let msg=err.message||'操作未完成';
      // 药盒不是持续广播：只在唤醒后的一小段窗口里可被发现/可连接，随后自睡；
      // 且会被官方小程序独占。这两条是"扫不到 / 连不上"最常见的真正原因，
      // 不提示的话用户只会反复重试，永远不知道要按一下药盒上的按钮。
      if(['scan','connect'].includes(action)||action?.startsWith?.('hipee')){
        msg+='\n若一直如此：① 短按药盒顶部按钮把它唤醒后再试；② 若官方微信小程序正连着药盒，请先在其内解绑或临时关闭手机蓝牙，释放连接；③ 药盒电量耗尽时也会连不上。';
        if(action==='hipeeBind')msg+='\n绑定还需要药盒滴一声后短按顶部按钮确认。';
      }
      wearable.error=msg;wearable.status='操作未完成';
      if(['authenticateLegacy','authenticateXiaomi','read','connect'].includes(action)){wearable.authenticated=false;wearable.device=null}
    }finally{delete extra.authKey;wearable.busy=false;show()}
  });
  function refreshHealthOverview(){if(state.tab!=='health')return;const view=document.getElementById('view'),scroll=view?.scrollTop||0;render();if(view)view.scrollTop=scroll;}
  let refreshInFlight=false;
  function restoreVisibleNativeSource(data){const records=data?.records||[],native=records.some(r=>r.originPackage==='com.anyao.smartdemo');if(!native)return false;const migrated=localStorage.getItem('anyao-native-source-migrated-v1')==='1';if(!migrated){localStorage.setItem('anyao-native-source-migrated-v1','1');if(healthView.source&&gbPackages.includes(healthView.source)){healthView.source='com.anyao.smartdemo';wearable.originPackage='com.anyao.smartdemo';localStorage.setItem('anyao-health-origin',wearable.originPackage);return true}}return false;}
  async function refreshWearableHealth(){if(wearable.busy||refreshInFlight||document.hidden)return;refreshInFlight=true;try{const [data,histories]=await Promise.all([api('wearable-health'),api('xiaomi-history').catch(()=>[])]);if(restoreVisibleNativeSource(data)||JSON.stringify(data)!==JSON.stringify(wearable.health)||JSON.stringify(histories)!==JSON.stringify(wearable.privateHistory)){wearable.health=data;wearable.privateHistory=Array.isArray(histories)?histories:[];refreshHealthOverview();if(document.querySelector('dialog[open] [data-band=healthRead]'))show()}}catch(_){}finally{refreshInFlight=false}}
  setInterval(()=>{if(state.tab==='health'||document.querySelector('dialog[open] [data-band=healthRead]'))refreshWearableHealth()},5000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshWearableHealth()});
  document.addEventListener('click',e=>{if(e.target.closest('[data-tab="health"]'))refreshWearableHealth()});
  const originalProfile=profile;profile=function(){return originalProfile()+`<div class="section-heading"><h2>智能穿戴</h2></div><div class="surface">${row('小米手环 / 手表','连接设备与健康信息','heart','data-action="wearable"')}</div>`};
  health=function(){return heading('健康','你的每日健康记录',`<button class="icon-button" data-action="tracker-catalog" aria-label="记录健康数据">${icon('plus')}</button>`)+`<div class="surface wearable-health-entry">${row('穿戴设备与同步','查看设备与同步状态','heart','data-action="wearable"')}</div>`+healthControls(wearable.health)+`<div class="section-heading"><h2>数据与趋势</h2><span class="note">${selectedHealth(wearable.health).length} 项记录</span></div>`+wearableVisualization({records:selectedHealth(wearable.health)},false)+dailySummarySection()+`<p class="helper">点击数据卡片，查看详细记录。</p><div class="surface">${row('记录健康数据','心情、症状、饮水及其他身体观察','note','data-action="tracker-catalog"')}${row('健康日记','查看每日记录与备注','note','data-action="diary"')}${row('病情管理','管理病情与健康资料','heart','data-action="conditions"')}</div>`};
  refreshWearableHealth();
})();


