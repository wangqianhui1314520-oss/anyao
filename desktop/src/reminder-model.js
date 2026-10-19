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
 function dialValue(x,y,rect){const angle=Math.atan2(x-rect.left-rect.width/2,-(y-rect.top-rect.height/2))*180/Math.PI;return Math.max(1,Math.min(100,Math.round((((angle+360)%360)/360)*100)))}
 return {keys,targets,phoneTarget,defaults,effect,profiles,duration,dialValue};
});
