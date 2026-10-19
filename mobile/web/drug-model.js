/* Shared ISO weekday and structured quantity rules. No dose is inferred from text. */
(function(root,factory){const m=factory();if(typeof module==='object'&&module.exports)module.exports=m;else root.DrugModel=m})(typeof globalThis!=='undefined'?globalThis:this,()=>{
 const all=[1,2,3,4,5,6,7],names=['一','二','三','四','五','六','日'];
 function weekdays(d){return Array.isArray(d?.weekdays)?[...d.weekdays].sort((a,b)=>a-b):[...all]}
 const isoDay=key=>{const n=new Date(key+'T12:00:00+08:00').getUTCDay();return n||7};
 const active=(d,date)=>!d.asNeeded&&weekdays(d).includes(isoDay(date));
 const repeat=d=>d.asNeeded?'需要时才吃':weekdays(d).length===7?'每天':'周'+weekdays(d).map(x=>names[x-1]).join('、');
 const quantity=(d,t)=>Number(d?.timeQuantities?.[t]??d?.doseQuantity??1);
 const timeLabel=(d,t)=>`${t} · ${quantity(d,t)} ${d.inventoryUnit||'片'}`;
 const schedule=d=>d.asNeeded?'需要时才吃':`${repeat(d)} ${(d.times||[]).join(' · ')||'—'}`;
 function stockDays(d){const perDay=(d.times||[]).reduce((s,t)=>s+quantity(d,t),0)*weekdays(d).length/7;return perDay>0?Math.floor(Number(d.inventory||0)/perDay):null}
 const validBarcode=s=>typeof s==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{3,63}$/.test(s);
 return {all,names,weekdays,isoDay,active,repeat,quantity,timeLabel,schedule,stockDays,validBarcode};
});
