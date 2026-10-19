const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = __dirname;
const ReminderModel=require('./reminder-model.js');
const localDate = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year:'numeric',month:'2-digit',day:'2-digit' }).format(now);
function createServer(options = {}) {
 const dbPath = options.dataPath || process.env.DATA_PATH || path.join(root,'data.json');
 const seed = {profile:{id:'p1',name:'',email:'',condition:''},drugs:[],intakeEvents:[],trackers:[],settings:{vibration:true,sound:true,flash:true,phone:true,autoSnooze:true},appointments:[],caregivers:[],refills:[],audit:[]};
 let db = fs.existsSync(dbPath) ? JSON.parse(fs.readFileSync(dbPath,'utf8')) : seed;
 for(const k of ['appointments','caregivers','refills','audit','drugs','intakeEvents','trackers','diary','conditions','medical-team','archivedDrugs','wearables'])db[k] ||= [];
 db.settings ||= seed.settings;
 db.wearableHealth ??= null;
 const save = () => {fs.mkdirSync(path.dirname(dbPath),{recursive:true});fs.writeFileSync(dbPath+'.tmp',JSON.stringify(db,null,2));fs.renameSync(dbPath+'.tmp',dbPath);};
 const id = prefix => prefix+'_'+crypto.randomUUID();
 const json = (res,status,data) => {res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(data));};
 const fail = message => {throw Error(message);};
 const str = (v,k,required=false) => {if(v===undefined&&!required)return undefined;if(typeof v!=='string'||v.length>1000||(required&&!v.trim()))fail('invalid_'+k);return v.trim();};
 const num = (v,k) => {if(v===undefined||!Number.isFinite(Number(v))||Number(v)<0||Number(v)>100000)fail('invalid_'+k);return Number(v);};
 const date = v => {if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||Number.isNaN(Date.parse(v+'T00:00:00Z'))||new Date(v+'T00:00:00Z').toISOString().slice(0,10)!==v)fail('invalid_date');return v;};
 const time = v => {if(typeof v!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(v))fail('invalid_time');return v;};
 async function body(req,limit=65536){let s='';for await(const c of req){s+=c;if(Buffer.byteLength(s)>limit)fail('body_too_large');}const b=s?JSON.parse(s):{};if(!b||Array.isArray(b)||typeof b!=='object')fail('invalid_body');return b;}
 const audit = (action,recordId) => db.audit.push({id:id('a'),action,recordId,at:new Date().toISOString()});
 function schedule(){let changed=false;for(const d of db.drugs){if(d.asNeeded)continue;const times=d.times||[...new Set(db.intakeEvents.filter(e=>e.drugId===d.id).map(e=>e.scheduleTime||e.time))];for(const t of times)if(!db.intakeEvents.some(e=>e.drugId===d.id&&e.date===localDate()&&(e.scheduleTime||e.time)===t)){db.intakeEvents.push({id:id('i'),drugId:d.id,date:localDate(),time:t,scheduleTime:t,status:'scheduled'});changed=true;}}if(changed)save();}
 const events = all => {schedule();return db.intakeEvents.filter(e=>all||e.date===localDate()).map(e=>({...e,drug:db.drugs.find(d=>d.id===e.drugId)}));};
 function fields(b,type,partial=false){const r={},defs={appointments:['title','location','note'],caregivers:['name','relationship','phone','email'],drugs:['name','dose','note'],trackers:['type','title','value','note'],diary:['title','body'],conditions:['name','note'],'medical-team':['name','type','contact','note']},required={appointments:'title',caregivers:'name',drugs:'name',trackers:'value',diary:'body',conditions:'name','medical-team':'name'}[type];for(const k of defs[type])if(b[k]!==undefined||(!partial&&k===required))r[k]=str(b[k],k,k===required);
  if(type==='diary'&&(b.date!==undefined||!partial))r.date=date(b.date||localDate());if(type==='appointments'){if(b.date!==undefined||!partial)r.date=date(b.date);if(b.time!==undefined||!partial)r.time=time(b.time||'09:00');if(b.status!==undefined){if(!['scheduled','completed','cancelled'].includes(b.status))fail('invalid_status');r.status=b.status;}else if(!partial)r.status='scheduled';}
  if(type==='caregivers'&&b.permissions!==undefined){if(!Array.isArray(b.permissions)||b.permissions.some(x=>typeof x!=='string'||x.length>50)||b.permissions.length>10)fail('invalid_permissions');r.permissions=b.permissions;}
  if(type==='drugs'){if(b.inventory!==undefined||!partial)r.inventory=num(b.inventory??0,'inventory');if(b.asNeeded!==undefined){if(typeof b.asNeeded!=='boolean')fail('invalid_asNeeded');r.asNeeded=b.asNeeded;}if(b.times!==undefined||b.time!==undefined||!partial){const ts=b.times||[b.time||'12:00'];if(!Array.isArray(ts)||ts.length>24)fail('invalid_times');r.times=[...new Set(ts.map(time))];}}
  return r;
 }
 function wearable(b){
  if(!b||typeof b!=='object'||Array.isArray(b))fail('invalid_wearable');
  const rejectSecrets=v=>{if(v&&typeof v==='object')for(const [k,x] of Object.entries(v)){if(/secret|token|password|auth.?key|pairing.?key|credential|private.?key/i.test(k))fail('wearable_secrets_not_allowed');rejectSecrets(x);}};
  rejectSecrets(b);
  if(b.source!=='web-bluetooth-standard-gatt')fail('invalid_wearable_source');
  if(typeof b.capturedAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(b.capturedAt)||Number.isNaN(Date.parse(b.capturedAt)))fail('invalid_capturedAt');
  const r={deviceId:str(b.deviceId,'deviceId',true),name:str(b.name,'name',true),source:b.source,capturedAt:new Date(b.capturedAt).toISOString()};
  for(const [k,max] of [['battery',100],['heartRate',300]]){const v=b[k];if(v===undefined||v===null)r[k]=null;else{if(typeof v!=='number'||!Number.isInteger(v)||v<(k==='heartRate'?1:0)||v>max)fail('invalid_'+k);r[k]=v;}}
  for(const k of ['manufacturer','model','firmware'])if(b[k]!==undefined)r[k]=str(b[k],k);
  return r;
 }
 function validateRestore(b){
  if(b.schemaVersion!==1)fail('unsupported_schema_version');
  if(!b.profile||typeof b.profile!=='object'||Array.isArray(b.profile))fail('invalid_profile');
  if(typeof b.profile.name!=='string')fail('invalid_profile_name');str(b.profile.name,'profile_name');
  if(!b.settings||typeof b.settings!=='object'||Array.isArray(b.settings))fail('invalid_settings');
  for(const k of ['vibration','sound','flash','phone','autoSnooze'])if(typeof b.settings[k]!=='boolean')fail('invalid_settings_'+k);
  const clean={profile:{...b.profile},settings:{...b.settings}};
  if(b.settings.reminderProfiles!==undefined)clean.settings.reminderProfiles=ReminderModel.profiles(b.settings.reminderProfiles);
  for(const k of ['drugs','intakeEvents','trackers','appointments','caregivers','refills','audit','diary','conditions','medical-team','archivedDrugs']){
   const list=b[k]??(['diary','conditions','medical-team','archivedDrugs'].includes(k)?[]:undefined);
   if(!Array.isArray(list)||list.length>10000)fail('invalid_'+k);
   const ids=new Set();
   clean[k]=list.map(r=>{if(!r||typeof r!=='object'||Array.isArray(r))fail('invalid_'+k+'_record');str(r.id,k+'_id',true);if(ids.has(r.id))fail('duplicate_'+k+'_id');ids.add(r.id);return {...r};});
  }
  for(const k of ['drugs','archivedDrugs'])for(const r of clean[k]){str(r.name,'drug_name',true);num(r.inventory,'inventory');if(r.times!==undefined){if(!Array.isArray(r.times)||r.times.length>24)fail('invalid_times');r.times.forEach(time);}}
  for(const k of ['trackers','appointments','caregivers','diary','conditions','medical-team'])for(const r of clean[k])fields(r,k);
  const drugIds=new Set([...clean.drugs,...clean.archivedDrugs].map(d=>d.id));
  for(const e of clean.intakeEvents){if(!drugIds.has(e.drugId))fail('invalid_intake_drug_reference');date(e.date);time(e.time);if(e.scheduleTime!==undefined)time(e.scheduleTime);if(!['taken','scheduled','skipped','snoozed'].includes(e.status))fail('invalid_status');}
  for(const r of clean.refills){if(!drugIds.has(r.drugId))fail('invalid_refill_drug_reference');if(num(r.amount,'amount')<=0)fail('invalid_amount');}
  if(b.wearables!==undefined&&!Array.isArray(b.wearables))fail('invalid_wearables');
  if((b.wearables||[]).length>10000)fail('invalid_wearables');
  const devices=new Set();clean.wearables=(b.wearables||[]).map(r=>{const x=wearable(r);if(devices.has(x.deviceId))fail('duplicate_wearable_deviceId');devices.add(x.deviceId);return x;});
  clean.wearableHealth=b.wearableHealth==null?null:wearableHealth(b.wearableHealth);
  return clean;
 }
 function wearableHealth(b){
  const types=['StepsRecord','HeartRateRecord','RestingHeartRateRecord','XiaomiStressRecord','SleepSessionRecord','OxygenSaturationRecord','TotalCaloriesBurnedRecord','ActiveCaloriesBurnedRecord','DistanceRecord','SpeedRecord','ExerciseSessionRecord','RespiratoryRateRecord','BodyTemperatureRecord','WeightRecord','BloodPressureRecord'];
  const obj=v=>{if(!v||typeof v!=='object'||Array.isArray(v))fail('invalid_health_object');return v;};
  const rejectSecrets=(v,depth=0)=>{if(depth>30)fail('health_data_too_deep');if(v&&typeof v==='object')for(const [k,x] of Object.entries(v)){if(/secret|token|password|auth.?key|pairing.?key|credential|private.?key/i.test(k))fail('health_secrets_not_allowed');rejectSecrets(x,depth+1);}};
  obj(b);rejectSecrets(b);
  const instant=v=>{if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(v)||Number.isNaN(Date.parse(v)))fail('invalid_health_time');date(v.slice(0,10));const fraction=(v.match(/\.(\d+)/)?.[1]||'').replace(/0+$/,'');return new Date(v).toISOString().slice(0,19)+(fraction?'.'+fraction.padEnd(Math.ceil(fraction.length/3)*3,'0'):'')+'Z';};
  const finite=(v,k,min=0,max=Number.MAX_SAFE_INTEGER,integer=false)=>{if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max||(integer&&!Number.isSafeInteger(v)))fail('invalid_health_'+k);return v;};
  const text=(v,k,nullable=false)=>{if(nullable&&v==null)return null;return str(v,k,!nullable);};
  const list=v=>{if(!Array.isArray(v)||v.length>10000)fail('invalid_health_array');return v;};
  const interval=(v,parent)=>{obj(v);const r={start:instant(v.start),end:instant(v.end)};if(healthInstantOrder(r.start,r.end)>=0)fail('invalid_health_interval');if(parent&&(healthInstantOrder(r.start,parent.start)<0||healthInstantOrder(r.end,parent.end)>0))fail('health_interval_outside_record');return r;};
  if(!['health_connect','direct_xiaomi'].includes(b.source))fail('invalid_health_source');
  const r={source:b.source,originPackage:str(b.originPackage,'originPackage',false)??'',from:instant(b.from),to:instant(b.to)};
  if(healthInstantOrder(r.from,r.to)>=0)fail('invalid_health_range');
  const ids=new Set();
  r.records=list(b.records).map(v=>{
   obj(v);if(!types.includes(v.type))fail('invalid_health_type');
   const x={id:text(v.id,'id'),type:v.type,originPackage:text(v.originPackage,'originPackage'),lastModified:instant(v.lastModified)};
   if(r.originPackage&&x.originPackage!==r.originPackage)fail('health_origin_mismatch');
   const key=x.type+'\0'+x.originPackage+'\0'+x.id;if(ids.has(key))fail('duplicate_health_record');ids.add(key);
   x.device=v.device==null?null:{manufacturer:text(obj(v.device).manufacturer,'manufacturer',true),model:text(v.device.model,'model',true),type:finite(v.device.type,'device_type',0,100,true)};
   const point=['XiaomiStressRecord','RestingHeartRateRecord','OxygenSaturationRecord','RespiratoryRateRecord','BodyTemperatureRecord','WeightRecord','BloodPressureRecord'].includes(x.type);
   if(point)x.time=instant(v.time);else Object.assign(x,interval(v));
   const nums={StepsRecord:['count'],OxygenSaturationRecord:['percent'],TotalCaloriesBurnedRecord:['kcal'],ActiveCaloriesBurnedRecord:['kcal'],DistanceRecord:['meters'],RespiratoryRateRecord:['breathsPerMinute'],BodyTemperatureRecord:['celsius'],WeightRecord:['kg'],BloodPressureRecord:['systolicMmHg','diastolicMmHg']};
   for(const k of nums[x.type]||[])x[k]=finite(v[k],k,k==='celsius'?-100:0,k==='percent'?100:Number.MAX_SAFE_INTEGER,k==='count');
   if(x.type==='XiaomiStressRecord'){if(x.originPackage!=='com.anyao.smartdemo')fail('invalid_xiaomi_stress_origin');x.score=finite(v.score,'score',0,100,true);}
   if(x.type==='RestingHeartRateRecord')x.bpm=finite(v.bpm,'bpm',1,300,true);
   if(['HeartRateRecord','SpeedRecord'].includes(x.type))x.samples=list(v.samples).map(s=>{obj(s);const at=instant(s.time);if(healthInstantOrder(at,x.start)<0||healthInstantOrder(at,x.end)>0)fail('health_sample_outside_record');const k=x.type==='HeartRateRecord'?'bpm':'metersPerSecond';return {time:at,[k]:finite(s[k],k,k==='bpm'?1:0,k==='bpm'?300:Number.MAX_SAFE_INTEGER,k==='bpm')};});
   if(['SleepSessionRecord','ExerciseSessionRecord'].includes(x.type)){x.title=text(v.title,'title',true);x.notes=text(v.notes,'notes',true);}
   if(x.type==='SleepSessionRecord')x.stages=list(v.stages).map(s=>({...interval(s,x),stage:finite(s.stage,'stage',0,100,true)}));
   if(x.type==='ExerciseSessionRecord'){x.exerciseType=finite(v.exerciseType,'exerciseType',0,10000,true);x.segments=list(v.segments).map(s=>({...interval(s,x),type:finite(s.type,'segment_type',0,10000,true),repetitions:finite(s.repetitions,'repetitions',0,Number.MAX_SAFE_INTEGER,true)}));x.laps=list(v.laps).map(s=>({...interval(s,x),meters:s.meters==null?null:finite(s.meters,'meters')}));}
   return x;
  });
  r.records.sort(healthRecordOrder);
  for(const record of r.records)for(const key of ['samples','stages','segments','laps'])record[key]?.sort((a,b)=>healthInstantOrder(a.time||a.start,b.time||b.start));
  r.recordCount=r.records.length;
  r.importedRecordCount=b.importedRecordCount===undefined?r.recordCount:finite(b.importedRecordCount,'importedRecordCount',0,10000,true);
  r.unavailable=list(b.unavailable).map(v=>{obj(v);if(!types.includes(v.type))fail('invalid_health_unavailable_type');return {type:v.type,reason:text(v.reason,'reason')};});
  return r;
 }
 const healthRecordKey=r=>r.originPackage+'\0'+r.type+'\0'+r.id;
 function healthInstantNanos(v){const fraction=v.match(/\.(\d+)/)?.[1]||'';return BigInt(Date.parse(v.replace(/\.\d+/,'')))*1000000n+BigInt(fraction.padEnd(9,'0'));}
 function healthInstantOrder(a,b){const av=healthInstantNanos(a),bv=healthInstantNanos(b);return av<bv?-1:av>bv?1:0;}
 function healthRecordOrder(a,b){const delta=healthInstantOrder(a.time||a.start,b.time||b.start);if(delta)return delta;const ak=healthRecordKey(a),bk=healthRecordKey(b);return ak<bk?-1:ak>bk?1:0;}
 function mergeWearableHealth(previous,incoming){
  const records=new Map((previous?.records||[]).map(r=>[healthRecordKey(r),r]));
  for(const record of incoming.records){const key=healthRecordKey(record),old=records.get(key);if(!old||healthInstantOrder(record.lastModified,old.lastModified)>=0)records.set(key,record);}
  if(records.size>10000)fail('health_history_limit_reached');
  const merged={...incoming,records:[...records.values()].sort(healthRecordOrder),importedRecordCount:incoming.records.length};
  merged.recordCount=merged.records.length;
  if(previous){merged.from=healthInstantOrder(previous.from,incoming.from)<0?previous.from:incoming.from;merged.to=healthInstantOrder(previous.to,incoming.to)>0?previous.to:incoming.to;}
  const origins=new Set(merged.records.map(r=>r.originPackage));merged.originPackage=origins.size===1?[...origins][0]:origins.size>1?'':incoming.originPackage;
  return merged;
 }
 async function api(req,res,url){try{const p=url.pathname,m=req.method;
  if(m==='POST'&&p==='/api/restore'){
   const restored=validateRestore(await body(req,8*1024*1024));
   const backupPath=dbPath+'.before-restore-'+Date.now()+'.json';
   fs.mkdirSync(path.dirname(dbPath),{recursive:true});fs.writeFileSync(backupPath,JSON.stringify(db,null,2),{flag:'wx'});
   const previous=db;db=restored;try{audit('backup.restore','local');save();}catch(e){db=previous;throw e;}
   return json(res,200,{restored:true,backupCreated:true});
  }
  if(['/api/hipee-history','/api/band-history','/api/xiaomi-history'].includes(p))return json(res,m==='GET'?200:405,m==='GET'?[]:{error:'read_only_history',detail:'Windows 尚未导入原生硬件历史；不生成健康或服药记录'});
  if(m==='GET'&&p==='/api/wearable-health')return json(res,200,db.wearableHealth);
  if(m==='POST'&&p==='/api/wearable-health/import'){const r=mergeWearableHealth(db.wearableHealth,wearableHealth(await body(req,8*1024*1024)));db.wearableHealth=r;audit('wearable.health_import',r.originPackage||'all_origins');save();return json(res,200,r);}
  if(m==='GET'&&p==='/api/wearables')return json(res,200,db.wearables);
  if(m==='POST'&&p==='/api/wearables'){
   const r=wearable(await body(req)),i=db.wearables.findIndex(x=>x.deviceId===r.deviceId);
   if(i>=0&&Date.parse(db.wearables[i].capturedAt)>Date.parse(r.capturedAt))return json(res,200,db.wearables[i]);
   if(i>=0)db.wearables[i]=r;else db.wearables.unshift(r);
   audit('wearable.observation',r.deviceId);save();return json(res,i>=0?200:201,r);
  }
  if(m==='GET'&&p==='/api/today')return json(res,200,{date:localDate(),events:events(false),profile:db.profile,settings:db.settings,trackers:db.trackers});
  if(m==='GET'&&p==='/api/profile')return json(res,200,db.profile);
  if(m==='PATCH'&&p==='/api/profile'){const b=await body(req),r={};for(const k of ['name','email','condition','allergies'])if(b[k]!==undefined)r[k]=str(b[k],k,k==='name');Object.assign(db.profile,r);save();return json(res,200,db.profile);}
  if(m==='GET'&&p==='/api/settings')return json(res,200,db.settings);
  if(m==='PATCH'&&p==='/api/settings'){const b=await body(req),r={};if(b.target!==undefined)ReminderModel.phoneTarget(b.target);for(const k of ['vibration','sound','flash','phone','autoSnooze'])if(b[k]!==undefined){if(typeof b[k]!=='boolean')fail('invalid_'+k);r[k]=b[k];}if(b.reminderProfiles!==undefined)r.reminderProfiles=ReminderModel.profiles(b.reminderProfiles);Object.assign(db.settings,r);save();return json(res,200,db.settings);}
  if(m==='GET'&&p==='/api/intake-events')return json(res,200,events(url.searchParams.get('all')==='true'));
  const intake=p.match(/^\/api\/intake-events\/([^/]+)$/);
  if(intake&&m==='PATCH'){const e=db.intakeEvents.find(e=>e.id===intake[1]);if(!e)return json(res,404,{error:'not_found'});const b=await body(req);if(!['taken','skipped','scheduled','snoozed'].includes(b.status))fail('invalid_status');const t=b.time===undefined?undefined:time(b.time);if(e.status!==b.status){const d=db.drugs.find(d=>d.id===e.drugId);if(d&&b.status==='taken'){e.inventoryDeducted=d.inventory>=1;if(e.inventoryDeducted)d.inventory--;}if(d&&e.status==='taken'&&e.inventoryDeducted!==false){d.inventory++;e.inventoryDeducted=false;}e.status=b.status;e.updatedAt=new Date().toISOString();audit('intake.'+e.status,e.id);}if(t!==undefined){e.scheduleTime ||= e.time;e.time=t;}save();return json(res,200,{...e,drug:db.drugs.find(d=>d.id===e.drugId)});}
  if(m==='GET'&&p==='/api/adherence'){schedule();const all=db.intakeEvents,taken=all.filter(e=>e.status==='taken').length,days={};for(const e of all){days[e.date]||={date:e.date,taken:0,total:0};days[e.date].total++;if(e.status==='taken')days[e.date].taken++;}return json(res,200,{taken,total:all.length,percent:all.length?Math.round(100*taken/all.length):0,days:Object.values(days).sort((a,b)=>a.date.localeCompare(b.date))});}
  if(m==='GET'&&(p==='/api/export'||p==='/api/backup')){res.setHeader('content-disposition',`attachment; filename="smartdemo-${localDate()}.json"`);return json(res,200,{schemaVersion:1,exportedAt:new Date().toISOString(),...db});}
  if(m==='GET'&&p==='/api/refills')return json(res,200,db.refills);
  const refill=p.match(/^\/api\/drugs\/([^/]+)\/refill$/);
  if(refill&&m==='POST'){const d=db.drugs.find(d=>d.id===refill[1]);if(!d)return json(res,404,{error:'not_found'});const b=await body(req),amount=num(b.amount,'amount');if(amount<=0)fail('invalid_amount');d.inventory+=amount;const r={id:id('r'),drugId:d.id,amount,at:new Date().toISOString()};db.refills.unshift(r);audit('inventory.refill',d.id);save();return json(res,201,{...r,drug:d});}
  for(const type of ['drugs','trackers','appointments','caregivers','diary','conditions','medical-team']){if(p===`/api/${type}`&&m==='GET')return json(res,200,db[type]);if(p===`/api/${type}`&&m==='POST'){const r={...fields(await body(req),type),id:id(type[0]),at:new Date().toISOString()};if(type==='trackers'){r.type||='symptom';r.title||=r.type;}db[type].unshift(r);audit(type+'.create',r.id);if(type==='drugs')schedule();save();return json(res,201,r);}const match=p.match(new RegExp(`^/api/${type}/([^/]+)$`));if(match){const i=db[type].findIndex(x=>x.id===match[1]);if(i<0)return json(res,404,{error:'not_found'});if(m==='GET')return json(res,200,db[type][i]);if(m==='PATCH'){const update=fields(await body(req),type,true);Object.assign(db[type][i],update,{updatedAt:new Date().toISOString()});if(type==='drugs'&&(update.times!==undefined||update.asNeeded!==undefined)){const d=db[type][i];db.intakeEvents=db.intakeEvents.filter(e=>e.drugId!==d.id||e.date!==localDate()||['taken','skipped'].includes(e.status)||(!d.asNeeded&&(d.times||[]).includes(e.scheduleTime||e.time)));schedule();}audit(type+'.update',match[1]);save();return json(res,200,db[type][i]);}if(m==='DELETE'){if(type==='drugs')db.archivedDrugs.push({...db[type][i],deletedAt:new Date().toISOString()});db[type].splice(i,1);if(type==='drugs')db.intakeEvents=db.intakeEvents.filter(e=>e.drugId!==match[1]||['taken','skipped'].includes(e.status));audit(type+'.delete',match[1]);save();return json(res,200,{deleted:true});}}}
  return json(res,404,{error:'not_found'});
 }catch(e){return json(res,400,{error:'bad_request',detail:e.message});}}
 const allowed=new Set(['index.html','app.js','styles.css','enhancements.css','secondary.js','secondary.css','ui.js','reminder-model.js','reminder-ui.js','refined.css','bluetooth.js','native-client.js','manifest.webmanifest','sw.js']);
 return http.createServer((req,res)=>{let u;try{u=new URL(req.url,'http://localhost');}catch{return json(res,400,{error:'invalid_url'});}if(u.pathname.startsWith('/api/'))return api(req,res,u);if(!['GET','HEAD'].includes(req.method))return json(res,405,{error:'method_not_allowed'});const file=u.pathname==='/'?'index.html':u.pathname.slice(1);if(!allowed.has(file))return json(res,404,{error:'not_found'});const full=path.join(root,file);if(!fs.existsSync(full))return json(res,404,{error:'not_found'});const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.webmanifest':'application/manifest+json'};res.writeHead(200,{'content-type':types[path.extname(full)]||'application/octet-stream','x-content-type-options':'nosniff'});if(req.method==='HEAD')return res.end();fs.createReadStream(full).pipe(res);});
}
/** Invoke the copied CRUD handler through IPC without binding any HTTP socket. */
function createBackend({dataPath}={}) {
 if(typeof dataPath!=='string'||!path.isAbsolute(dataPath))throw new TypeError('Backend needs an explicit absolute user data path');
 const server=createServer({dataPath});
 let queue=Promise.resolve(),closed=false;
 const error=detail=>({status:400,body:{error:'bad_request',detail}});
 function invokeApi(request) {
  let normalized;
  try {
   if(!request||typeof request!=='object'||Array.isArray(request))return Promise.resolve(error('invalid_request'));
   const method=String(request.method||'GET').toUpperCase();
   if(!['GET','POST','PATCH','DELETE'].includes(method))return Promise.resolve(error('invalid_method'));
   if(typeof request.path!=='string'||!request.path.startsWith('/api/')||request.path.length>2048||/[\r\n\\]/.test(request.path))return Promise.resolve(error('invalid_api_path'));
   const url=new URL(request.path,'http://ipc.invalid');
   if(url.origin!=='http://ipc.invalid'||!url.pathname.startsWith('/api/'))return Promise.resolve(error('invalid_api_path'));
   const body=request.body===undefined?{}:request.body;
   if(!body||typeof body!=='object'||Array.isArray(body))return Promise.resolve(error('invalid_body'));
   const text=JSON.stringify(body),limit=url.pathname==='/api/restore'||url.pathname==='/api/wearable-health/import'?8*1024*1024:65536;
   if(Buffer.byteLength(text)>limit)return Promise.resolve(error('body_too_large'));
   normalized={method,path:url.pathname+url.search,text};
  }catch(exception){return Promise.resolve(error(exception.message));}
  const result=queue.then(()=>{
   if(closed)return {status:503,body:{error:'backend_closed'}};
   return new Promise(resolve=>{
    const {Readable}=require('node:stream');
    const req=Readable.from([Buffer.from(normalized.text)]);req.method=normalized.method;req.url=normalized.path;req.headers={'content-type':'application/json'};
    let status=200,done=false;const headers={};
    const finish=(body)=>{if(done)return;done=true;resolve({status,body});};
    const res={setHeader(name,value){headers[name.toLowerCase()]=value;},writeHead(value,extra){status=value;Object.assign(headers,extra||{});},
     end(text){try{finish(text?JSON.parse(String(text)):null);}catch{status=500;finish({error:'invalid_backend_response'});}}};
    try{server.emit('request',req,res);}catch(exception){status=500;finish({error:'backend_failed',detail:exception.message});}
   });
  });
  queue=result.catch(()=>{});return result;
 }
 return Object.freeze({invokeApi,isListening:()=>server.listening,close(){closed=true;server.removeAllListeners('request');},dataPath});
}
module.exports={createServer,createBackend,localDate};
