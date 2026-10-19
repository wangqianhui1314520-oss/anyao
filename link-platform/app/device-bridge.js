/* 智能药盒的设备通道。
   1) 安卓应用里走原生消息桥 window.NativeWearable（BLE 由原生层负责）；
   2) 没有原生通道时，在支持 Web Bluetooth 的 Chrome / Edge（电脑或安卓手机，https 或本机地址）里直接连药盒，
      协议见 hipee-protocol.js（与安卓端 HiPee07.kt 同一份 07 帧协议）。
   两条通道对上层暴露同一组动作：hipeeStatus / Scan / Connect / Reconnect / Disconnect / Bind / Enable / Sync / Clear / Push / Query。
   设备状态只来自真实回复，不模拟已连接或已同步。药盒的界面在 pillbox-ui.js。 */
(() => {
 const pending=new Map();
 const nativeSupported=()=>Boolean(window.NativeWearable?.postMessage);
 function nativeCall(action,deviceId,extra={}){
  return new Promise((resolve,reject)=>{
   if(!nativeSupported())return reject(new Error('请在安药安卓应用中使用设备连接。'));
   const id=crypto.randomUUID(),timer=setTimeout(()=>{pending.delete(id);reject(new Error('设备响应超时，请重试'))},120000);
   pending.set(id,{resolve,reject,timer});
   window.NativeWearable.onmessage=event=>{
    let response;
    try{response=JSON.parse(event.data)}catch{return}
    const request=pending.get(response.id);if(!request)return;
    clearTimeout(request.timer);pending.delete(response.id);
    response.ok?request.resolve(response.data):request.reject(new Error(response.error||'设备操作失败'));
   };
   try{window.NativeWearable.postMessage(JSON.stringify({id,action,...(deviceId?{deviceId}:{}),...extra}))}
   catch(error){clearTimeout(timer);pending.delete(id);reject(error)}
  });
 }
 if(nativeSupported()){window.DeviceBridge={call:nativeCall,supported:nativeSupported,kind:'android'};return}

 /* ---------- Web Bluetooth ---------- */
 const P=window.HiPeeProtocol;
 const webSupported=()=>!!(P&&navigator.bluetooth&&window.isSecureContext);
 const SAVED_KEY='anyao-pillbox-web';
 const saved=()=>{try{return JSON.parse(localStorage.getItem(SAVED_KEY))||{}}catch{return{}}};
 const persist=v=>{try{localStorage.setItem(SAVED_KEY,JSON.stringify({...saved(),...v}))}catch{}};
 const s={device:null,server:null,write:null,notify:null,idWrite:null,idNotify:null,decoder:P?.decoder(),waiters:[],listeners:new Set(),syncing:false,activity:null,battery:null,firmware:null,identity:saved().identityDeviceId===saved().webId?saved().identity||null:null,chosen:new Map(),queue:Promise.resolve()};
 const sleep=ms=>new Promise(r=>setTimeout(r,ms));
 /* 浏览器的 device.id 不是 MAC；读到身份通道的 MAC 就用真 MAC，读不到就用 id 派生一个本地地址，只用来区分设备记录 */
 async function pseudoMac(id){
  const h=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(String(id))));
  h[0]=(h[0]|0x02)&0xfe;return [...h.slice(0,6)].map(b=>b.toString(16).padStart(2,'0')).join(':').toUpperCase();
 }
 const deviceId=async()=>s.identity?.mac||(s.device?await pseudoMac(s.device.id):saved().deviceId||null);
 const connected=()=>!!(s.device?.gatt?.connected&&s.write);
 const emit=()=>window.dispatchEvent(new CustomEvent('anyao-pillbox-push'));
 const failWaiters=message=>s.waiters.splice(0).forEach(w=>{clearTimeout(w.timer);w.reject(Error(message))});
 function onChunk(event){
  if(event.target!==s.notify)return;
  const chunk=new Uint8Array(event.target.value.buffer.slice(event.target.value.byteOffset,event.target.value.byteOffset+event.target.value.byteLength));
  for(const f of s.decoder.push(chunk)){
   const st=f.cmd===P.CMD.STATUS?P.status(f.payload):null;
   const i=s.waiters.findIndex(w=>w.cmds.includes(f.cmd)&&(!st||st.type==='unknown'));
   if(i>=0){const [w]=s.waiters.splice(i,1);clearTimeout(w.timer);w.resolve(f)}
   if(st){
    s.listeners.forEach(cb=>cb(st));
    /* 同步之外收到的状态帧：药盒那边有动作，记下来让用户核对；不当作已服药 */
    if(!s.syncing&&st.type!=='status-reply'&&st.type!=='sync-end'){s.activity={at:Date.now(),kind:st.event||st.type,raw:P.hex(f.payload)};persist({activity:s.activity});emit()}
   }
  }
 }
 /* 所有写操作排队执行，一次只占用一个 GATT 操作 */
 const serial=fn=>{const run=s.queue.then(fn,fn);s.queue=run.catch(()=>{});return run};
 async function sendWait(cmd,payload,expect,timeout=4000){
  if(!connected())throw Error('药盒没有连接，请先连接药盒');
  return serial(()=>new Promise(async(resolve,reject)=>{
   const remove=()=>{const i=s.waiters.indexOf(w);if(i>=0)s.waiters.splice(i,1)};
   const w={cmds:expect,resolve,reject,timer:setTimeout(()=>{remove();reject(Error('药盒没有回应，请靠近药盒后重试'))},timeout)};
   s.waiters.push(w);
   try{await s.write.writeValue(P.frame(cmd,payload))}catch(e){clearTimeout(w.timer);remove();reject(Error('写入药盒失败：'+e.message))}
  }));
 }
 async function readIdentity(){
  const write=s.idWrite,notify=s.idNotify,device=s.device;
  if(!write||!notify)return null;
  return serial(()=>new Promise(async resolve=>{
   let settled=false,timer=null;
   const done=v=>{
    if(settled)return;settled=true;clearTimeout(timer);
    try{notify.removeEventListener('characteristicvaluechanged',on)}catch{}
    try{device?.removeEventListener('gattserverdisconnected',disconnected)}catch{}
    resolve(v);
   };
   const disconnected=()=>done(null);
   const on=e=>{if(e.target!==notify||notify!==s.idNotify||device!==s.device)return done(null);try{done(P.identity(new Uint8Array(e.target.value.buffer)))}catch{done(null)}};
   if(write!==s.idWrite||notify!==s.idNotify||device!==s.device||!device?.gatt?.connected)return done(null);
   timer=setTimeout(()=>done(null),3000);
   notify.addEventListener('characteristicvaluechanged',on);
   device?.addEventListener('gattserverdisconnected',disconnected);
   try{await write.writeValue(Uint8Array.of(0x02))}catch{done(null)}
  }));
 }
 async function attach(device){
  /* A new device must not inherit the previous device's optional identity or characteristics. */
  failWaiters('药盒连接已变化，请重新操作');
  if(s.device&&s.device.id!==device.id){try{s.device.gatt?.disconnect()}catch{}}
  s.device=device;
  s.write=s.notify=s.idWrite=s.idNotify=null;s.battery=s.firmware=null;
  const cached=saved();s.identity=cached.identityDeviceId===device.id?cached.identity||null:null;
  device.addEventListener('gattserverdisconnected',()=>{
   if(s.device!==device||device.gatt?.connected)return;
   s.write=s.notify=s.idWrite=s.idNotify=null;failWaiters('药盒连接已断开，请重新连接后重试');emit();
  });
  s.server=await device.gatt.connect();
  const svc=await s.server.getPrimaryService(P.SERVICE).catch(()=>{throw Error('这台设备不是 HiPee 药盒，或药盒还没唤醒')});
  s.write=await svc.getCharacteristic(P.WRITE);
  s.notify=await svc.getCharacteristic(P.NOTIFY);
  s.decoder.reset();
  s.notify.addEventListener('characteristicvaluechanged',onChunk);
  await s.notify.startNotifications();
  try{const id=await s.server.getPrimaryService(P.ID_SERVICE);s.idWrite=await id.getCharacteristic(P.ID_WRITE);s.idNotify=await id.getCharacteristic(P.ID_NOTIFY);await s.idNotify.startNotifications()}catch{s.idWrite=s.idNotify=null}
  const ident=await readIdentity().catch(()=>null);if(ident)s.identity=ident;
  if(s.device!==device||!device.gatt?.connected)throw Error('药盒连接中断，请重新连接');
  persist({webId:device.id,name:device.name||'HiPee 药盒',deviceId:await deviceId(),identity:s.identity,identityDeviceId:device.id});
  await serial(()=>s.write.writeValue(P.frame(P.CMD.CLOCK,P.clockPayload()))).then(()=>persist({clockSentAt:Date.now()})).catch(()=>{});
  await actions.hipeeQuery().catch(()=>{});
  emit();
 }
 const slotsKey=async()=>'slots:'+(await deviceId());
  async function status(){
  const k=await slotsKey(),v=saved();
  return{connected:connected(),deviceId:await deviceId(),name:s.device?.name||v.name||'HiPee 智能药盒',plans:Array.isArray(v[k])?v[k]:[],battery:s.battery??null,firmware:s.firmware||null,clockSentAt:v.clockSentAt||null,plansPushedAt:v['pushedAt:'+k]||null,lastSyncAt:v.lastSyncAt||null,activity:v.activity||null,savedDevice:!!v.webId,identity:s.identity?{firmware:s.identity.firmware,mac:s.identity.mac}:null,transport:'web-bluetooth'};
 }
 const actions={
  hipeeStatus:status,
  async hipeeScan(){
   const device=await navigator.bluetooth.requestDevice({filters:[{services:[P.SERVICE]},{namePrefix:'HiPee'},{namePrefix:'Hi-PB'}],optionalServices:[P.SERVICE,P.ID_SERVICE]})
    .catch(e=>{if(e.name==='NotFoundError')return null;throw Error('无法搜索蓝牙：'+e.message)});
   if(!device)return{devices:[]};
   s.chosen.set(device.id,device);
   return{devices:[{id:device.id,name:device.name||'HiPee 药盒'}]};
  },
  async hipeeConnect(_,extra){const d=s.chosen.get(extra.deviceId);if(!d)throw Error('请重新搜索药盒');await attach(d);return status()},
  async hipeeReconnect(){
   const id=saved().webId;if(!id)throw Error('还没有连过药盒，请先搜索');
   const list=navigator.bluetooth.getDevices?await navigator.bluetooth.getDevices():[];
   const d=list.find(x=>x.id===id)||s.device;
   if(!d)throw Error('浏览器没有记住这个药盒，请重新搜索');
   for(let i=0;i<3;i++){try{await attach(d);return status()}catch(e){if(i===2)throw e;await sleep(800)}}
  },
  async hipeeDisconnect(){try{s.device?.gatt?.disconnect()}catch{}s.write=null;emit();return status()},
  async hipeeCalibrate(){if(!connected())throw Error('药盒没有连接，请先连接药盒');await serial(()=>s.write.writeValue(P.frame(P.CMD.CLOCK,P.clockPayload())));persist({clockSentAt:Date.now()});return{clockSent:true,confirmed:false}},
  async hipeeFind(){if(!connected())throw Error('药盒没有连接，请先连接药盒');await serial(()=>s.write.writeValue(P.frame(P.CMD.FIND)));return{requested:true}},
  async hipeeClear(_,extra){
   const k=await slotsKey(),plans=saved()[k]||[],old=plans.find(p=>p.compartment===extra.slot);
   const f=await sendWait(P.CMD.SET_REMINDER,P.clearReminderPayload(extra.slot,P.seconds(extra.time||old?.times?.[0]||'00:00')),[P.CMD.SET_REMINDER_RSP]);
   if(!P.reminderAck(f.payload))throw Error(`药盒没有确认清空第 ${extra.slot} 仓`);
   persist({[k]:plans.filter(p=>p.compartment!==extra.slot)});emit();return{slot:extra.slot,cleared:true};
  },
  /* 完整计划：先整表校验，再清空 4 个仓，逐条写入；每条都要等到 31 01 */
  async hipeePushPlans(_,extra){
   const plans=PillboxModel.plans(extra.plans||[]);
   if(!connected())throw Error('药盒没有连接，请先连接药盒');
   const k=await slotsKey(),previous=saved()[k]||[];
   await serial(()=>s.write.writeValue(P.frame(P.CMD.CLOCK,P.clockPayload())));
   for(let c=1;c<=P.COMPARTMENTS;c++){
    const old=previous.find(p=>p.compartment===c),mine=plans.find(p=>p.compartment===c);
    const f=await sendWait(P.CMD.SET_REMINDER,P.clearReminderPayload(c,P.seconds(old?.times?.[0]||mine?.times?.[0]||'00:00')),[P.CMD.SET_REMINDER_RSP]);
    if(!P.reminderAck(f.payload))throw Error(`第 ${c} 仓清空没有得到药盒确认，已停止；请重新下发完整计划`);
   }
   persist({[k]:[]});
   const done=[];let pushed=0;
   for(const plan of plans){
    for(let i=0;i<plan.times.length;i++){
     const f=await sendWait(P.CMD.SET_REMINDER,P.planPayload(plan.compartment,P.seconds(plan.times[i]),plan.times.length,i+1),[P.CMD.SET_REMINDER_RSP]);
     if(!P.reminderAck(f.payload)){persist({[k]:done});throw Error(`第 ${plan.compartment} 仓第 ${i+1} 条提醒没有得到药盒确认，已写入 ${pushed} 条；请重新下发完整计划`)}
     pushed++;
    }
    done.push({compartment:plan.compartment,times:plan.times,weekdays:plan.weekdays,drugId:plan.drugId||'',drugName:plan.drugName||''});persist({[k]:done});
   }
   persist({['pushedAt:'+k]:Date.now()});emit();return{pushed,plans:done,confirmed:true};
  },
  async hipeeQuery(){const f=await sendWait(P.CMD.QUERY,[],[P.CMD.QUERY_RSP]);const r={battery:f.payload[0]??null,firmware:`${f.payload[1]??0}.${String(f.payload[2]??0).padStart(2,'0')}`};s.battery=r.battery;s.firmware=r.firmware;return r},
  /* 离线记录：只以一致的声明总数+不同记录数，或明确结束，认定完整；全零状态回复不能证明完整。 */
  async hipeeSync(){
   if(!connected())throw Error('药盒没有连接，请先连接药盒');
   const records=[];let completion=null;
   const seen=new Set();let expected=-1,consistentTotal=true;
   const on=st=>{
    if(st.type==='raw-record'){
     if(expected<0)expected=st.total;else if(expected!==st.total)consistentTotal=false;
     const key=st.state+':'+st.timestamp+':'+st.flag;
     if(!seen.has(key)){seen.add(key);records.push({taken:null,interpretation:'unconfirmed',timestamp:st.timestamp,rawFlag:st.flag,rawFrame:st.raw,rawState:st.state,recordTotal:st.total})}
     completion=consistentTotal&&seen.size===expected?'record-count':null;
    }
    else if(st.type==='record')records.push({compartment:st.compartment,taken:st.taken,timestamp:st.timestamp});
    else if(st.type==='sync-end')completion='explicit-end';
    else if(st.type==='status-reply'&&!records.length)completion='status-reply';
   };
   s.listeners.add(on);s.syncing=true;
   try{await serial(()=>s.write.writeValue(P.frame(P.CMD.SYNC)));for(let t=0;t<80&&!completion&&connected();t++)await sleep(100)}
   finally{s.listeners.delete(on);s.syncing=false}
   if(!completion&&!records.length)throw Error('药盒未返回记录或状态，请重新连接后重试');
   completion=completion||(connected()?'records-without-end':'disconnected');
   const complete=completion==='record-count'||completion==='explicit-end';
   const body={deviceId:await deviceId(),deviceName:s.device?.name||'HiPee 药盒',capturedAt:new Date().toISOString(),records,complete,syncComplete:complete,completion};
   await api('hipee-history/import',{method:'POST',body:JSON.stringify(body)});persist({lastSyncAt:Date.now()});
   return{count:records.length,complete,completion,matched:0};
  }
 };
 async function webCall(action,_deviceId,extra={}){
  if(!webSupported())throw Error(navigator.bluetooth?'请用 https 地址或本机地址打开安药，浏览器才允许连接蓝牙':'这个浏览器不能连接蓝牙药盒，请用电脑或安卓手机上的 Chrome / Edge，或安药安卓应用');
  const fn=actions[action];if(!fn)throw Error('这个浏览器暂不支持该药盒操作');
  return fn(_deviceId,extra);
 }
 window.DeviceBridge={call:webCall,supported:webSupported,kind:'web-bluetooth'};
})();
