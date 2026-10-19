/* 安药 · 网页端的到点提醒。
   安卓应用里提醒由原生层负责（锁屏、后台准时唤醒），这里不重复提醒；
   网页 / 桌面版在页面开着（含切到后台的标签页）时，按“提醒方式”和“提醒力度”执行：
   通知（系统通知）、震动（navigator.vibrate）、声音（WebAudio 提示音）、闪光（整屏闪烁）。
   服药端：到点提醒一次，超过等待时间还没吃再提醒一次。
   家属端：超过等待时间还没记录吃药，提醒家属一次。
   每一顿每个阶段只提醒一次，记在 localStorage 里，刷新页面也不会重复。 */
(() => {
 const FIRED_KEY='anyao-reminders-fired';
 const role=()=>document.body.dataset.role||'user';
 const native=()=>!!window.AndroidApp;
 let fired={};try{fired=JSON.parse(localStorage.getItem(FIRED_KEY))||{}}catch{}
 const today=()=>new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Shanghai'});
 function remember(key){
  fired[key]=today();
  for(const [k,d] of Object.entries(fired))if(d<today())delete fired[k];
  try{localStorage.setItem(FIRED_KEY,JSON.stringify(fired))}catch{}
 }
 /* 浏览器要求声音必须先有一次用户操作，第一次点页面时把音频解锁 */
 let audio=null;
 const unlock=()=>{try{audio||=new (window.AudioContext||window.webkitAudioContext)();if(audio.state==='suspended')audio.resume()}catch{}};
 document.addEventListener('pointerdown',unlock,{once:false,passive:true});

 const profile=k=>{
  try{return ReminderModel.profiles(state.settings.reminderProfiles||{})[k]}catch{return{level:70,pulseMs:400,intervalMs:600,repeats:3,curve:'steady'}}
 };
 const factor=(p,i)=>{const c=p.curve||(p.ramp?'up':'steady');const n=Math.max(1,p.repeats-1);return c==='up'?0.4+0.6*i/n:c==='down'?1-0.6*i/n:1};

 function vibrate(){
  if(!navigator.vibrate)return false;
  const p=profile('vibration'),pattern=[];
  for(let i=0;i<p.repeats;i++){pattern.push(Math.round(p.pulseMs*(0.5+0.5*p.level/100)*factor(p,i)));if(i<p.repeats-1)pattern.push(p.intervalMs)}
  return navigator.vibrate(pattern);
 }
 function beep(){
  unlock();if(!audio||audio.state!=='running')return false;
  const p=profile('sound');let t=audio.currentTime+0.05;
  for(let i=0;i<p.repeats;i++){
   const vol=Math.min(1,p.level/100*factor(p,i))*0.6,dur=Math.min(p.pulseMs,1200)/1000;
   for(const [f,off] of [[880,0],[660,dur*0.5]]){
    const o=audio.createOscillator(),g=audio.createGain();o.type='sine';o.frequency.value=f;
    g.gain.setValueAtTime(0.0001,t+off);g.gain.exponentialRampToValueAtTime(Math.max(0.001,vol),t+off+0.02);g.gain.exponentialRampToValueAtTime(0.0001,t+off+dur*0.5);
    o.connect(g).connect(audio.destination);o.start(t+off);o.stop(t+off+dur*0.5+0.02);
   }
   t+=dur+p.intervalMs/1000;
  }
  return true;
 }
 function flash(){
  const p=profile('flash');
  const el=document.createElement('div');el.className='reminder-flash';el.setAttribute('aria-hidden','true');
  el.style.setProperty('--flash-strength',String(0.35+0.55*p.level/100));
  el.style.setProperty('--flash-pulse',p.pulseMs+'ms');el.style.setProperty('--flash-gap',p.intervalMs+'ms');el.style.setProperty('--flash-count',String(p.repeats));
  document.body.append(el);setTimeout(()=>el.remove(),p.repeats*(p.pulseMs+p.intervalMs)+200);
  return true;
 }
 async function notify(title,body,tag){
  if(!('Notification' in window)||Notification.permission!=='granted')return false;
  try{
   const reg=await navigator.serviceWorker?.getRegistration?.();
   const opts={body,tag,renotify:true,requireInteraction:true,icon:'icon.svg',badge:'icon.svg',data:{url:location.href}};
   if(reg?.showNotification){await reg.showNotification(title,opts);return true}
   const n=new Notification(title,opts);n.onclick=()=>{window.focus();n.close()};return true;
  }catch{return false}
 }
 /* 按“提醒方式”四个开关执行；返回实际执行了哪几种 */
 async function fire(title,body,tag,{channels}={}){
  const s=state.settings||{},done=[];
  const want=channels||{vibration:s.vibration,sound:s.sound,flash:s.flash,phone:s.phone};
  if(want.phone&&await notify(title,body,tag))done.push('通知');
  if(want.vibration&&vibrate())done.push('震动');
  if(want.sound&&beep())done.push('声音');
  if(want.flash&&!document.hidden&&flash())done.push('闪光');
  if(!document.hidden)toast(title+' · '+body);
  return done;
 }

 function check(){
  if(native()||!state.doses)return;
  const name=d=>`${d.drug?.name||'药'}${d.drug?.dose?' '+d.drug.dose:''}`;
  for(const d of state.doses){
   if(['taken','skipped'].includes(d.status))continue;
   if(role()==='user'){
    if(d.level==='due'&&!fired[d.eventId+':due']){remember(d.eventId+':due');fire('该吃药了',`${d.planned} ${name(d)}，吃完点“我吃了”`,'anyao-'+d.eventId)}
    else if(d.level==='missed'&&!fired[d.eventId+':missed']){remember(d.eventId+':missed');remember(d.eventId+':due');fire('这顿药还没吃',`${d.planned} ${name(d)}，吃完记得点“我吃了”`,'anyao-'+d.eventId)}
   }else if(d.level==='missed'&&!fired[d.eventId+':family']){
    remember(d.eventId+':family');
    const who=state.family.user?.name||'家人';
    fire(`${who}还没吃药`,`${d.planned} ${name(d)} 已超过 ${state.family.missedAfterMinutes} 分钟没有记录`,'anyao-f-'+d.eventId,{channels:{phone:true,vibration:true,sound:true,flash:false}});
   }
  }
 }
 window.addEventListener('anyao-loaded',check);
 setInterval(()=>{if(state.loadedAt)check()},30000);

 window.Reminders={
  fire,check,
  supported:()=>'Notification' in window,
  canAsk:()=>!native()&&'Notification' in window&&Notification.permission==='default',
  permissionLabel:()=>native()?'由安卓应用管理':!('Notification' in window)?'这个浏览器不支持':Notification.permission==='granted'?'已允许':Notification.permission==='denied'?'已拒绝（请在浏览器设置里打开）':'还没有允许',
  async ask(){
   if(!('Notification' in window)){toast('这个浏览器不支持系统通知');return}
   const r=await Notification.requestPermission();
   toast(r==='granted'?'已允许安药发通知':'没有允许通知，到点时只在页面里提醒');
  },
  async test(){
   unlock();
   if(native()){
    if(state.settings.flash&&window.RepairApi){
     const permission=await AndroidApp.reminderCameraPermission();
     if(!permission.cameraAllowed)toast('未允许相机权限，背面闪光暂不可用');
    }
    const r=await AndroidApp.reminderPreview?.('all',ReminderModel.profiles(state.settings.reminderProfiles||{}).vibration);
    const result=r?.body||r,done=[...(result?.done||[])];
    if(result?.notified)done.push('通知');
    panel('提醒测试结果',`<div class="surface"><p class="card-note">${esc(done.length?'系统已执行：'+done.join('、'):'没有执行提醒，请检查开关和权限')}</p>${result?.skipped?.length?`<p class="card-note">${esc(result.skipped.join('；'))}</p>`:''}<p class="card-note">请核对手机实际的声音、震动、背面闪光和通知；系统执行记录不能代替实物确认。</p></div>`);return result;
   }
   const done=await fire('试一下提醒','这就是到点时的提醒效果','anyao-test');
   if(!done.length)toast('四种提醒方式都关着，或浏览器不支持，请先打开一种');
  }
 };
})();
