/* Shared pillbox validation for the browser and local Node API. */
(function(root,factory){const model=factory();if(typeof module==='object'&&module.exports)module.exports=model;else root.PillboxModel=model})(typeof globalThis!=='undefined'?globalThis:this,()=>{
 const fail=s=>{throw Error(s)},object=v=>v&&typeof v==='object'&&!Array.isArray(v);
 const integer=(v,name,max)=>{if(typeof v!=='number'||!Number.isSafeInteger(v)||v<0||v>max)fail('hipee_record_'+name+'_invalid');return v};
 const validTime=t=>typeof t==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(t);
 function times(drugs){return [...new Set((drugs||[]).filter(d=>!d.asNeeded).flatMap(d=>Array.isArray(d.times)?d.times:[]))].filter(validTime).sort()}
 function plan(value){if(!Array.isArray(value)||!value.length)fail('请先设置药盒提醒时间');if(value.length>4)fail('药盒最多支持 4 个仓位，请手动选择时段');if(value.some(t=>!validTime(t)))fail('提醒时间必须为 HH:mm');if(new Set(value).size!==value.length)fail('提醒时间不能重复');return [...value]}
 /* 药盒计划（0.4.11 真机协议）：每种药一个仓位（1..4），每仓 1..9 个时间；下发前整表校验，任何一项不对都不写药盒 */
 function plans(value){
  if(!Array.isArray(value))fail('药盒计划格式不对');if(value.length>4)fail('药盒只有 4 个仓位，最多放 4 种按时吃的药');
  const seen=new Set();
  return value.map(p=>{
   const c=Number(p?.compartment);if(!Number.isInteger(c)||c<1||c>4)fail('请给每种药选 1 到 4 号仓');if(seen.has(c))fail(`${c} 号仓只能放一种药`);seen.add(c);
   const t=[...new Set((p.times||[]).filter(validTime))].sort();if(!t.length)fail(`${c} 号仓还没有提醒时间`);if(t.length>9)fail(`${c} 号仓最多 9 个提醒时间`);
   const weekdays=p.weekdays===undefined?[1,2,3,4,5,6,7]:p.weekdays;
   if(!Array.isArray(weekdays)||weekdays.length!==7||new Set(weekdays).size!==7||weekdays.some(d=>!Number.isInteger(d)||d<1||d>7))fail('本台药盒的星期位映射尚未验证，非每日计划目前只在手机提醒；此次药盒计划未改动');
   return {compartment:c,times:t,weekdays:[...weekdays].sort((a,b)=>a-b),drugId:String(p.drugId||''),drugName:String(p.drugName||'').slice(0,40)};
  });
 }
 function noSecrets(v,depth=0){if(depth>25)fail('hipee_data_too_deep');if(v&&typeof v==='object')for(const [k,x]of Object.entries(v)){if(/secret|token|password|auth.?key|pairing.?key|credential|private.?key/i.test(k))fail('hipee_secrets_not_allowed');noSecrets(x,depth+1)}}
 const rawBytes=r=>typeof r.rawFrame==='string'&&/^[a-f0-9]{2}( [a-f0-9]{2}){6}$/i.test(r.rawFrame)?r.rawFrame.split(' ').map(x=>parseInt(x,16)):null;
 /* 旧存档把第二字节误称序号/仓位；真实记录身份只取状态、时间、标记，总数变化不新增记录。 */
 const key=r=>r.eventType!==undefined?`event:${r.eventType}:${r.compartment}:${r.timestamp}`:r.rawFlag!==undefined?`raw:${rawBytes(r)?.[1]??r.rawState??r.recordIndex??r.compartment??'unknown'}:${r.rawFlag}:${r.timestamp}`:`legacy:${r.timestamp}:${r.compartment}:${r.reportedTaken??r.taken}`;
 function normalize(b){
  if(!object(b))fail('hipee_records_invalid');noSecrets(b);
  if(typeof b.deviceId!=='string'||!/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(b.deviceId))fail('hipee_device_id_invalid');
  const name=b.deviceName??'HiPee 药盒';if(typeof name!=='string'||name.length>128)fail('hipee_device_name_invalid');
  const at=b.capturedAt??new Date().toISOString();if(typeof at!=='string'||!/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(at)||!Number.isFinite(Date.parse(at))||new Date(at.slice(0,10)+'T00:00:00Z').toISOString().slice(0,10)!==at.slice(0,10))fail('hipee_captured_at_invalid');
  if(!Array.isArray(b.records)||b.records.length>10000)fail('hipee_records_invalid');
  const rows=new Map();for(const r of b.records){if(!object(r))fail('hipee_record_invalid');const row={timestamp:integer(r.timestamp,'timestamp',0xffffffff),interpretation:'unconfirmed',taken:null};
   if(r.eventType!==undefined){
    const types=['lid_close','lid_open','dose_taken','wrong_time_open'],tag=types.indexOf(r.eventType);
    if(tag<0||r.rawFlag!==undefined)fail('hipee_record_event_type_invalid');
    row.eventType=r.eventType;row.compartment=integer(r.compartment,'compartment',255);
    if(typeof r.reportedTaken!=='boolean'||r.reportedTaken!==(tag===2))fail('hipee_record_taken_invalid');
    row.reportedTaken=r.reportedTaken;
    if(typeof r.rawFrame!=='string'||!/^[a-f0-9]{2}( [a-f0-9]{2}){5}$/i.test(r.rawFrame))fail('hipee_record_frame_invalid');
    const bytes=r.rawFrame.split(' ').map(x=>parseInt(x,16));
    if(bytes[0]!==tag||bytes[1]!==row.compartment||bytes.slice(2).reduce((n,x)=>n*256+x,0)!==row.timestamp)fail('hipee_record_frame_mismatch');
    row.rawFrame=r.rawFrame.toLowerCase();
   }else if(r.rawFlag!==undefined){
    const flag=integer(r.rawFlag,'flag',255),bytes=rawBytes(r);
    if(r.rawFrame!==undefined&&!bytes)fail('hipee_record_frame_invalid');
    if(r.recordIndex!==undefined)integer(r.recordIndex,'index',255);
    row.rawFlag=flag;
    if(bytes){
     const timestamp=bytes.slice(2,6).reduce((n,x)=>n*256+x,0);
     if(row.timestamp!==timestamp||flag!==bytes[6]||(r.rawState!==undefined&&integer(r.rawState,'state',255)!==bytes[1])||(r.recordTotal!==undefined&&integer(r.recordTotal,'total',255)!==bytes[0]))fail('hipee_record_frame_mismatch');
     row.rawFrame=r.rawFrame.toLowerCase();row.rawState=bytes[1];row.recordTotal=bytes[0];
    }else{
     row.rawState=integer(r.rawState??r.recordIndex??r.compartment,'state',255);
     if(r.recordTotal!==undefined)row.recordTotal=integer(r.recordTotal,'total',255);
    }
   }else{
    row.compartment=integer(r.compartment,'compartment',255);row.reportedTaken=r.reportedTaken??r.taken;if(typeof row.reportedTaken!=='boolean')fail('hipee_record_taken_invalid');
    if(r.rawFrame!==undefined){if(typeof r.rawFrame!=='string'||r.rawFrame.length>768||!/^[a-f0-9 ]+$/i.test(r.rawFrame)||r.rawFrame.replaceAll(' ','').length%2)fail('hipee_record_frame_invalid');row.rawFrame=r.rawFrame.toLowerCase()}
   }
   rows.set(key(row),row);
  }
  if(b.syncComplete!==undefined&&typeof b.syncComplete!=='boolean'||b.complete!==undefined&&typeof b.complete!=='boolean')fail('hipee_sync_complete_invalid');
  const complete=b.syncComplete??b.complete??false;
  return {source:'direct_ble',protocol:'hipee-07-frame',deviceId:b.deviceId.toUpperCase(),deviceName:name,capturedAt:new Date(at).toISOString(),complete,syncComplete:complete,completion:typeof b.completion==='string'?b.completion.slice(0,40):'unverified',records:[...rows.values()],recordCount:rows.size,receivedCount:rows.size,receivedRecordCount:rows.size};
 }
 function merge(previous,incoming){const rows=new Map([...previous,...incoming].map(r=>{const n={...r,interpretation:'unconfirmed',taken:null};if(r.rawFlag!==undefined){const bytes=rawBytes(r);n.rawState=bytes?.[1]??r.rawState??r.recordIndex??r.compartment;if(bytes)n.recordTotal=bytes[0];delete n.compartment;delete n.recordIndex}else n.reportedTaken=r.reportedTaken??r.taken;return[key(n),n]}));if(rows.size>10000)fail('hipee_records_too_many');return [...rows.values()].sort((a,b)=>a.timestamp-b.timestamp)}
 return {times,plan,plans,validTime,normalize,merge,key};
});
