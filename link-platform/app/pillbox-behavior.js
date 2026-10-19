/* 药盒交互规则：显式输入、可注入时钟；输出动作由固件适配层执行。
 * 开盖不等于服药；只有确认动作产生 record-intake，调用方必须以 confirmationId 幂等落账。
 * 此模块不会写蓝牙、改真实服药记录或对药品是否适用作判断。 */
(function(root,factory){const m=factory();if(typeof module==='object'&&module.exports)module.exports=m;else root.PillboxBehavior=m})(globalThis,()=>{
 'use strict';
 const defaults=()=>({version:1,wrongOpenEnabled:true,windowMinutes:30,confirmTimeoutSeconds:60,quiet:{enabled:false,start:'22:00',end:'07:00',strength:1},sleep:{enabled:false,start:'23:00',end:'07:00'}});
 const time=s=>typeof s==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(s);
 const object=x=>x&&typeof x==='object'&&!Array.isArray(x);
 function validateSettings(x){
  if(!object(x)||x.version!==1||typeof x.wrongOpenEnabled!=='boolean'||!Number.isInteger(x.windowMinutes)||x.windowMinutes<1||x.windowMinutes>120||!Number.isInteger(x.confirmTimeoutSeconds)||x.confirmTimeoutSeconds<10||x.confirmTimeoutSeconds>300)throw Error('药盒交互参数无效');
  const out={version:1,wrongOpenEnabled:x.wrongOpenEnabled,windowMinutes:x.windowMinutes,confirmTimeoutSeconds:x.confirmTimeoutSeconds};
  for(const k of ['quiet','sleep']){const v=x[k];if(!object(v)||typeof v.enabled!=='boolean'||!time(v.start)||!time(v.end)||v.start===v.end)throw Error('请填写不同的有效起止时间');out[k]={enabled:v.enabled,start:v.start,end:v.end};}
  if(!Number.isInteger(x.quiet.strength)||x.quiet.strength<1||x.quiet.strength>3)throw Error('振动程度应为 1 至 3');out.quiet.strength=x.quiet.strength;return out;
 }
 const DAY=86400000, OFFSET=8*3600000, DOUBLE_MS=350;
 const parts=now=>new Date(now+OFFSET).toISOString();
 const clock=now=>parts(now).slice(11,19);
 const midnight=now=>Math.floor((now+OFFSET)/DAY)*DAY-OFFSET;
 const minutes=s=>Number(s.slice(0,2))*60+Number(s.slice(3));
 // Half-open interval; an overnight range belongs to its starting day.
 function interval(range,now){
  const base=midnight(now),a=minutes(range.start)*60000,b=minutes(range.end)*60000;
  for(const d of [-1,0]){const start=base+d*DAY+a,end=base+d*DAY+b+(b<=a?DAY:0);if(now>=start&&now<end)return {start,end};}return null;
 }
 const nextEnd=(range,now)=>{let end=midnight(now)+minutes(range.end)*60000;while(end<=now)end+=DAY;return end};
 const copy=x=>JSON.parse(JSON.stringify(x));
 class Engine {
  constructor({settings=defaults(),slots=[],doses=[],now=Date.now(),saved=null}={}){
   this.settings=validateSettings(settings);this.now=now;this.slots=copy(slots);
   const ids=new Set();this.doses=copy(doses).filter(d=>{if(typeof d.id!=='string'||ids.has(d.id)||!Number.isFinite(d.dueAt)||!Number.isInteger(d.compartment)||d.compartment<1||d.compartment>4)return false;ids.add(d.id);return true}).sort((a,b)=>a.dueAt-b.dueAt);
   this.s={page:'home',pending:null,lastTaken:null,acknowledged:[],deferred:[],notified:[],quietUntil:0,sleepUntil:0,skipSleepUntil:0,message:'',...copy(saved||{})};
   this.actions=[];this.buttonAt=null;this.confirmationSeq=0;this.tick(now);
  }
  mode(){if(this.sleepEnd()>this.now)return 'sleep';return this.s.quietUntil>this.now||(this.settings.quiet.enabled&&interval(this.settings.quiet,this.now))?'quiet':'normal'}
  sleepEnd(){if(this.s.sleepUntil>this.now)return this.s.sleepUntil;const i=this.settings.sleep.enabled&&interval(this.settings.sleep,this.now);return i&&this.s.skipSleepUntil<this.now?i.end:0}
  outstanding(){return this.doses.filter(d=>!['taken','skipped'].includes(d.status)&&!this.s.acknowledged.includes(d.id))}
  due(){return this.outstanding().filter(d=>d.dueAt<=this.now)}
  emit(type,extra={}){const action={type,at:this.now,...extra};this.actions.push(action);return action}
  tick(now=this.now){
   if(!Number.isFinite(now)||now<this.now)throw Error('交互时钟不可倒退');this.now=now;
   if(this.s.pending&&now>=this.s.pending.expiresAt){this.s.pending=null;this.buttonAt=null;this.s.page='home';this.s.message='确认已超时，未记录服药';}
   if(this.buttonAt!==null&&now-this.buttonAt>=DOUBLE_MS){this.buttonAt=null;this.single();}
   const sleep=this.sleepEnd();
   for(const d of this.due()){
    if(sleep){if(!this.s.deferred.includes(d.id))this.s.deferred.push(d.id);continue;}
    if(!this.s.notified.includes(d.id)){this.s.notified.push(d.id);this.emit('remind',{eventId:d.id,compartment:d.compartment,originalDueAt:d.dueAt,deferred:this.s.deferred.includes(d.id),sound:this.mode()!=='quiet',vibration:this.mode()==='quiet'?this.settings.quiet.strength:3});}
   }
   if(!sleep)this.s.deferred=[];return this.view();
  }
  input(type,data={}){
   if(type==='open'){
    const n=data.compartment,slot=this.slots.find(s=>s.compartment===n);
    this.buttonAt=null;
    if(!slot?.drugId){this.s.pending=null;this.s.page='home';this.s.message=`${n} 号仓尚未安排药物，请先在手机设置`;return this.view();}
    const due=this.outstanding().filter(d=>d.compartment===n&&Math.abs(d.dueAt-this.now)<=this.settings.windowMinutes*60000).sort((a,b)=>Math.abs(a.dueAt-this.now)-Math.abs(b.dueAt-this.now))[0];
    const wrong=!due;this.s.pending={compartment:n,drugId:slot.drugId,drugName:slot.drugName||'',eventId:due?.id||null,wrong,expiresAt:this.now+this.settings.confirmTimeoutSeconds*1000,confirmationId:`pb-confirm-${this.now}-${++this.confirmationSeq}`};
    this.s.page='confirm';this.s.message=wrong?'当前药非当前时段，是否仍要服用？':'已打开当前药仓，服用后请确认';
    this.emit('opened',{compartment:n,source:'input'});
    if(wrong&&this.settings.wrongOpenEnabled)this.emit('warning',{led:'red',vibration:1,sound:false,compartment:n});
   }else if(type==='swipe-left'||type==='swipe-right'){this.s.page=type==='swipe-left'?'quiet':'sleep';this.s.pending=null;this.buttonAt=null;}
   else if(type==='button'){
    if(this.buttonAt!==null&&this.now-this.buttonAt<DOUBLE_MS){this.buttonAt=null;if(this.s.pending)this.confirm();else this.single();}
    else this.buttonAt=this.now;
   }else if(type==='confirm'){this.buttonAt=null;this.confirm();}
   else if(type==='cancel'){this.buttonAt=null;this.s.pending=null;this.s.page='home';this.s.message='已取消，未记录服药';}
   else if(type==='wake'){
    this.buttonAt=null;this.s.skipSleepUntil=Math.max(this.sleepEnd(),nextEnd(this.settings.sleep,this.now));this.s.sleepUntil=0;this.s.page='home';this.s.message='已结束本次睡眠，待服提醒恢复';
   }else if(type==='home'){this.s.page='home';this.s.pending=null;this.buttonAt=null;}
   return this.tick(this.now);
  }
  single(){
   if(this.s.pending){this.s.pending=null;this.s.page='home';this.s.message='已取消，未记录服药';return;}
   if(this.s.page==='quiet'){this.s.quietUntil=nextEnd(this.settings.quiet,this.now);this.s.page='home';this.s.message='仅振动已启动';this.emit('quiet-start',{until:this.s.quietUntil,strength:this.settings.quiet.strength});}
   else if(this.s.page==='sleep'){if(this.mode()==='sleep')this.input('wake');else {this.s.sleepUntil=nextEnd(this.settings.sleep,this.now);this.s.page='home';this.s.message='进入睡眠，醒后补提醒';this.emit('sleep-start',{until:this.s.sleepUntil});}}
  }
  confirm(){
   const p=this.s.pending;if(!p||p.expiresAt<=this.now)return;
   this.s.lastTaken={at:this.now,compartment:p.compartment,drugName:p.drugName,eventId:p.eventId};
   if(p.eventId&&!this.s.acknowledged.includes(p.eventId))this.s.acknowledged.push(p.eventId);
   this.emit('record-intake',{...p,source:'user-confirmed',amount:1});this.s.pending=null;this.s.page='home';this.s.message='已确认服用 1 份';
  }
  snapshot(){return copy(this.s)}
  view(){
   const mode=this.mode(),sleepUntil=this.sleepEnd(),pending=this.s.pending;
   const events=mode==='sleep'?[]:this.due();
   const next=this.outstanding()[0]||null;
   return copy({clock:clock(this.now),now:this.now,page:this.s.page,mode,pending,lastTaken:this.s.lastTaken,next:next?{...next,effectiveDueAt:sleepUntil&&next.dueAt<sleepUntil?sleepUntil:next.dueAt}:null,sleepUntil,quietUntil:this.s.quietUntil,deferred:this.s.deferred,warning:!!(pending?.wrong&&this.settings.wrongOpenEnabled),feedback:{led:pending?.wrong&&this.settings.wrongOpenEnabled?'red':'off',vibration:pending?.wrong&&this.settings.wrongOpenEnabled?1:0,sound:false},alarm:{active:events.length>0,sound:events.length>0&&mode==='normal',vibration:events.length?(mode==='quiet'?this.settings.quiet.strength:3):0,events},message:this.s.message});
  }
 }
 return {defaults,validateSettings,interval,clock,Engine,DOUBLE_MS};
});
