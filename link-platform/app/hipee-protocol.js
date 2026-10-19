/* HiPee / Hi-PB1 四仓药盒 07 帧协议（浏览器与 Node 共用）。
   忠实移植自安卓端 protocol/HiPee07.kt：帧格式 07 LEN CMD DATA CHK，LEN 含 CMD，整帧字节和 %256 == 0。
   控制通道 0000ff00（写 ff02 / 通知 ff01）；裸字节身份通道 5833ff01（写 ff02 / 通知 ff03）。 */
(function(root,factory){const m=factory();if(typeof module==='object'&&module.exports)module.exports=m;else root.HiPeeProtocol=m})(typeof globalThis!=='undefined'?globalThis:this,()=>{
 const SERVICE='0000ff00-0000-1000-8000-00805f9b34fb',WRITE='0000ff02-0000-1000-8000-00805f9b34fb',NOTIFY='0000ff01-0000-1000-8000-00805f9b34fb';
 const ID_SERVICE='5833ff01-9b8b-5191-6142-22a4536ef123',ID_WRITE='5833ff02-9b8b-5191-6142-22a4536ef123',ID_NOTIFY='5833ff03-9b8b-5191-6142-22a4536ef123';
 const CMD={QUERY:0x03,QUERY_RSP:0x04,CLOCK:0x05,FIND:0x08,SYNC:0x0a,SET_REMINDER:0x30,SET_REMINDER_RSP:0x31,STATUS:0x32};
 const EVERYDAY=0x7f,COMPARTMENTS=4,PER_COMPARTMENT=9;
 /* 0x05 校时：当前 Unix 秒，4 字节大端（官方小程序不等回包） */
 const clockPayload=(epoch=Math.floor(Date.now()/1000))=>[(epoch>>>24)&0xff,(epoch>>>16)&0xff,(epoch>>>8)&0xff,epoch&0xff];
 const checksum=bytes=>{let s=0;for(const b of bytes)s=(s+(b&0xff))&0xff;return(256-s)&0xff};
 const verify=frame=>{if(frame.length<3)return false;let s=0;for(const b of frame)s=(s+(b&0xff))&0xff;return s===0};
 const hex=bytes=>[...bytes].map(b=>(b&0xff).toString(16).padStart(2,'0')).join(' ');
 const fromHex=h=>{const c=h.replace(/[^0-9a-f]/gi,'');if(c.length%2)throw Error('非法十六进制长度');return Uint8Array.from(c.match(/../g)||[],x=>parseInt(x,16))};
 const u24=v=>[(v>>16)&0xff,(v>>8)&0xff,v&0xff];
 const uintBE=(b,o,w)=>{let v=0;for(let i=0;i<w;i++)v=v*256+((b[o+i]??0)&0xff);return v};
 function frame(cmd,payload=[]){if(payload.length>251)throw Error('载荷过长');const body=[0x07,payload.length+1,cmd&0xff,...payload];return Uint8Array.from([...body,checksum(body)])}
 /* 流式解码：处理 MTU 分片与粘包，跨调用缓冲未完成的帧 */
 function decoder(){let buf=[];return{push(chunk){const m=[...buf,...chunk],out=[];let i=0;
   while(i+3<=m.length){if(m[i]!==0x07){i++;continue}const len=m[i+1];if(len<1){i++;continue}const total=len+3;if(i+total>m.length)break;
    const f=m.slice(i,i+total);if(verify(f)){out.push({cmd:f[2],payload:Uint8Array.from(f.slice(3,3+len-1)),raw:Uint8Array.from(f)});i+=total}else i++}
   buf=m.slice(i);return out},reset(){buf=[]},get pending(){return buf.length}}}
 const seconds=hhmm=>{const m=/^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(hhmm).trim());return m?Number(m[1])*3600+Number(m[2])*60:null};
 const timeField=s=>{if(!Number.isInteger(s)||s<0||s>86399)throw Error('服药时间不是合法的距零点秒数');return u24(s)};
 const setReminderPayload=(slot,s,mask=EVERYDAY)=>{if(slot<1||slot>COMPARTMENTS)throw Error('药盒只有 4 个仓位');if(mask!==EVERYDAY)throw Error('本台药盒仅验证了每天重复');return[slot,0x01,0x01,...timeField(s),mask]};
 /* 0x30 真机格式（官方抓包）：仓位 / 该仓条数 / 第几条 / 时刻(uint24) / 每天 7f；清空整仓：仓位 00 01 时刻，不带掩码 */
 const planPayload=(slot,s,count,index)=>{if(slot<1||slot>COMPARTMENTS)throw Error('药盒只有 4 个仓位');if(count<1||count>PER_COMPARTMENT||index<1||index>count)throw Error('每仓最多 9 个提醒');return[slot,count,index,...timeField(s),EVERYDAY]};
 const clearReminderPayload=(slot,s)=>{if(slot<1||slot>COMPARTMENTS)throw Error('药盒只有 4 个仓位');return[slot,0x00,0x01,...timeField(s)]};
 /* 0x31 回执：只有 01 是成功，02 是设备拒绝 */
 const reminderAck=p=>p.length>0&&p[0]===0x01;
 /* 0x32 状态帧：FC/FE/6字节事件是早期约定；真机离线记录是 total/state/epoch32/flag，语义待核对。 */
 function status(p,legacyMockLayout=false){
  const tag=p[0]??0;
  if(legacyMockLayout&&tag===0xfc&&p.length===1)return{type:'sync-end'};
  if(legacyMockLayout&&tag===0xfe&&p.length===7)return{type:'record',compartment:p[1],taken:p[2]===1,timestamp:uintBE(p,3,4)};
  /* 真机七字节记录：记录总数 / 状态字节（含义未确认）/ 4B 时间 / 标记；首字节随总数变化 */
  if(p.length===7&&p.every(b=>b===0))return{type:'status-reply'};
  if(p.length===7&&tag>=1&&tag<=0xff)return{type:'raw-record',total:tag,state:p[1],timestamp:uintBE(p,2,4),flag:p[6],raw:hex(p)};
  if(p.length===6&&tag<=3)return{type:'event',event:['lid-close','lid-open','dose-taken','wrong-time-open'][tag],compartment:p[1],timestamp:uintBE(p,2,4)};
  return{type:'unknown'};
 }
 /* 裸字节身份回复：status + MAC（反序 6 字节）+ 以 0 结尾的固件版本 */
 function identity(rx){
  if(!rx||rx.length<14||rx[0]===0x69)return null;
  const mac=[...rx.slice(1,7)].reverse().map(b=>b.toString(16).padStart(2,'0')).join(':').toUpperCase();
  let end=7;while(end<rx.length&&rx[end]!==0)end++;
  return{status:rx[0],mac,firmware:String.fromCharCode(...rx.slice(7,end))};
 }
 return{SERVICE,WRITE,NOTIFY,ID_SERVICE,ID_WRITE,ID_NOTIFY,CMD,EVERYDAY,COMPARTMENTS,PER_COMPARTMENT,clockPayload,planPayload,checksum,verify,hex,fromHex,frame,decoder,seconds,setReminderPayload,clearReminderPayload,reminderAck,status,identity};
});
