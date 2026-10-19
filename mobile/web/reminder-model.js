/* Shared bounded reminder profiles: used by the UI and the local web API. */
(function(root,factory){const model=factory();if(typeof module==='object'&&module.exports)module.exports=model;else root.ReminderModel=model})(globalThis,()=>{
 const keys=['vibration','sound','flash','phone'];
 const targets=['phone','pillbox','wearable'];
 function phoneTarget(value='phone'){if(value!=='phone')throw Error('此设置仅用于手机提醒，请在对应设备页面操作');return value;}
 const defaults=()=>Object.fromEntries(keys.map(k=>[k,{level:k==='sound'?50:70,pulseMs:400,intervalMs:600,repeats:3,ramp:false,rules:[]}]));
 function effect(x){
  if(!x||typeof x!=='object'||Array.isArray(x))throw Error('提醒参数无效');
  const r={};for(const [k,min,max] of [['level',1,100],['pulseMs',100,2000],['intervalMs',100,5000],['repeats',1,10]]){
   if(!Number.isInteger(x[k])||x[k]<min||x[k]>max)throw Error('提醒参数超出范围');r[k]=x[k];
  }
  if(typeof x.ramp!=='boolean')throw Error('渐强设置无效');r.ramp=x.ramp;
  if(x.curve!==undefined){if(!['steady','up','down'].includes(x.curve))throw Error('强度变化设置无效');r.curve=x.curve;r.ramp=x.curve==='up';}
  if(duration(r)>8000)throw Error('单次提醒最长 8 秒，请减少次数或间隔');return r;
 }
 function profiles(x){
  if(!x||typeof x!=='object'||Array.isArray(x)||Object.keys(x).some(k=>!keys.includes(k)))throw Error('提醒类型无效');
  const out=defaults();for(const k of keys){if(x[k]===undefined)continue;const p=x[k];out[k]=effect(p);
   if(!Array.isArray(p.rules)||p.rules.length>16)throw Error('每种提醒最多 16 条定时规则');const ids=new Set();
   out[k].rules=p.rules.map(rule=>{if(!rule||typeof rule.id!=='string'||!/^[a-zA-Z0-9_-]{1,64}$/.test(rule.id)||ids.has(rule.id))throw Error('定时规则编号无效');ids.add(rule.id);
    if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(rule.time)||typeof rule.enabled!=='boolean'||!Array.isArray(rule.days)||!rule.days.length||rule.days.length>7||rule.days.some(d=>!Number.isInteger(d)||d<1||d>7)||new Set(rule.days).size!==rule.days.length)throw Error('请选择有效时间和重复日期');
    return {id:rule.id,time:rule.time,days:[...rule.days].sort(),enabled:rule.enabled,effect:effect(rule.effect)};
   });
  }return out;
 }
 function duration(p){return p.pulseMs*p.repeats+p.intervalMs*(p.repeats-1)}
 function curve(p){return p.curve??(p.ramp?'up':'steady')}
 function factor(p,i){return curve(p)==='up'?(i+1)/p.repeats:curve(p)==='down'?(p.repeats-i)/p.repeats:1}
 function snapshot(settings){const p=profiles(settings.reminderProfiles||{});return {enabled:Object.fromEntries(keys.map(k=>[k,!!settings[k]])),effects:Object.fromEntries(keys.map(k=>[k,effect(p[k])]))}}
 function mode(x){
  if(!x||typeof x!=='object'||typeof x.id!=='string'||!/^custom_[a-zA-Z0-9_-]{1,48}$/.test(x.id)||typeof x.name!=='string'||!x.name.trim()||x.name.trim().length>16)throw Error('模式名称或编号无效');
  if(!x.enabled||!x.effects||keys.some(k=>typeof x.enabled[k]!=='boolean')||!keys.some(k=>x.enabled[k]))throw Error('请至少选择一种提醒方式');
  return {id:x.id,name:x.name.trim(),enabled:Object.fromEntries(keys.map(k=>[k,x.enabled[k]])),effects:Object.fromEntries(keys.map(k=>[k,effect(x.effects[k])]))};
 }
 function modes(x){if(!Array.isArray(x)||x.length>12)throw Error('最多保存 12 个自定义模式');const result=x.map(mode);if(new Set(result.map(m=>m.id)).size!==result.length)throw Error('模式编号重复');return result;}
 function presets(){
  return [ ['vibrate','只震动',['vibration'],'steady'],['flash','只闪光',['flash'],'steady'],['vibrate_flash','震动＋闪光',['vibration','flash'],'steady'] ].map(([id,name,enabled,c])=>{
   const p=defaults();return {id,name,enabled:Object.fromEntries(keys.map(k=>[k,enabled.includes(k)])),effects:Object.fromEntries(keys.map(k=>[k,effect({...p[k],curve:k==='phone'?'steady':c,ramp:c==='up'})]))};
  });
 }
 function available(settings){return [...presets(),...modes(settings.reminderModes||[])]}
 function sameMode(a,b){return keys.every(k=>a.enabled[k]===b.enabled[k]&&(!a.enabled[k]||(['level','pulseMs','intervalMs','repeats'].every(f=>a.effects[k][f]===b.effects[k][f])&&curve(a.effects[k])===curve(b.effects[k]))))}
 function activeMode(settings){const s=snapshot(settings);return available(settings).find(m=>m.id===settings.reminderModeId&&sameMode(m,s))||available(settings).find(m=>sameMode(m,s))||null;}
 // Validate a complete patch before saving any switch; modes never replace timed rules.
 function settingsPatch(settings,x){
  const next={...settings};if(Object.hasOwn(x,'target'))phoneTarget(x.target);
  for(const k of [...keys,'autoSnooze'])if(Object.hasOwn(x,k)){if(typeof x[k]!=='boolean')throw Error('invalid_'+k);next[k]=x[k];}
  if(Object.hasOwn(x,'reminderProfiles'))next.reminderProfiles=profiles(x.reminderProfiles);
  if(Object.hasOwn(x,'reminderModes'))next.reminderModes=modes(x.reminderModes);
  if(Object.hasOwn(x,'reminderModeId')){
   if(typeof x.reminderModeId!=='string')throw Error('模式编号无效');
   const m=available(next).find(m=>m.id===x.reminderModeId);if(!m)throw Error('提醒模式不存在');
   const p=profiles(next.reminderProfiles||{});for(const k of keys){next[k]=m.enabled[k];p[k]={...m.effects[k],rules:p[k].rules};}next.reminderProfiles=p;next.reminderModeId=m.id;
  }
  next.reminderModeId=activeMode(next)?.id||'';return next;
 }
 function dialValue(x,y,rect){const angle=Math.atan2(x-rect.left-rect.width/2,-(y-rect.top-rect.height/2))*180/Math.PI;return Math.max(1,Math.min(100,Math.round((((angle+360)%360)/360)*100)))}
 return {keys,targets,phoneTarget,defaults,effect,profiles,duration,dialValue,curve,factor,snapshot,mode,modes,presets,available,sameMode,activeMode,settingsPatch};
});
