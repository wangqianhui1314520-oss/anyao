/** Observe Windows transport state inside the original H5 closure without issuing commands. */
const desktopStateSync=String.raw`
  let desktopWearableKey=null;
  function redrawDesktopWearablePanel(){
    if(wearable.busy)return;
    const marker=document.querySelector('dialog[open] [data-band=healthRead]');
    const dialog=marker?.closest('dialog');if(!dialog)return;
    const drafts=[...dialog.querySelectorAll('input[id],select[id],textarea[id]')].filter(input=>input.type!=='file').map(input=>({id:input.id,value:input.value,checked:input.checked}));
    const expanded=[...dialog.querySelectorAll('details')].map(detail=>detail.open),scroll=dialog.scrollTop;
    const focus=document.activeElement,focusedId=dialog.contains(focus)?focus?.id:null;
    const selection=focusedId&&typeof focus.selectionStart==='number'?[focus.selectionStart,focus.selectionEnd]:null;
    show();
    for(const draft of drafts){const input=document.getElementById(draft.id);if(input&&dialog.contains(input)){input.value=draft.value;if(typeof draft.checked==='boolean')input.checked=draft.checked;}}
    [...dialog.querySelectorAll('details')].forEach((detail,index)=>{if(index<expanded.length)detail.open=expanded[index];});
    dialog.scrollTop=scroll;
    if(focusedId){const input=document.getElementById(focusedId);if(input&&dialog.contains(input)){input.focus({preventScroll:true});if(selection)input.setSelectionRange?.(...selection);}}
  }
  function syncDesktopWearableState(next,{redraw=true,force=false}={}){
    if(!window.anyaoHost||!next||!['simulation','device'].includes(next.mode))return false;
    const connected=next.connected===true,open=connected&&next.open===true;
    const key=next.mode+':'+connected+':'+open,changed=key!==desktopWearableKey;
    if(!changed&&!force)return false;
    const modeChanged=desktopWearableKey!==null&&desktopWearableKey.split(':')[0]!==next.mode;
    desktopWearableKey=key;
    hipee.status={...(modeChanged?{}:hipee.status||{}),connected,open,supported:connected,source:next.mode};
    if(!connected){
      wearable.device=null;wearable.authenticated=false;delete wearable.hipeeError;
      hipee.battery=null;hipee.firmware=null;
      hipee.status={...hipee.status,deviceId:null,battery:null,firmwareFromQuery:null,hipeeOpenError:null,hipeeQueryError:null};
      if(changed)wearable.devices=[];
    }else{
      wearable.device={...(wearable.device||{}),connected:true};
      if(next.mode==='simulation')wearable.device={...wearable.device,deviceId:'sim-hi-pb1',name:'Hi-PB1 虚拟药盒（本机协议仿真）',source:'simulation'};
    }
    if(modeChanged){hipee.lastPush=null;hipee.lastSync=null;hipee.battery=null;hipee.firmware=null;wearable.devices=[];wearable.authenticated=false;}
    if(changed)wearable.status=connected?(open?'Hi-PB1 指令会话已打开':'Hi-PB1 指令会话已关闭'):'药盒已断开连接';
    if(changed&&redraw)redrawDesktopWearablePanel();
    return changed;
  }
  window.addEventListener('anyao-desktop-state',event=>syncDesktopWearableState(event.detail));
  syncDesktopWearableState(window.anyaoDesktopRuntime?.snapshot?.(),{redraw:false});
`;

/** Keep APK originals on disk; apply platform, receipt, and state-display changes only in memory. */
function patchAsset(filename,source){
  if(filename!=='bluetooth.js')return source;
  return source.replace(/  refreshWearableHealth\(\);\r?\n\}\)\(\);/,()=>desktopStateSync+'\n  refreshWearableHealth();\n})();')
    .replace('delete extra.authKey;wearable.busy=false;show()','delete extra.authKey;wearable.busy=false;syncDesktopWearableState(window.anyaoDesktopRuntime?.snapshot?.(),{redraw:false,force:true});show()')
    .replaceAll('min="1" max="255"','min="1" max="4"').replaceAll('slot>255','slot>4').replaceAll('格号（1..255）','格号（1..4）')
    .replaceAll('药盒上报的服药记录会自动标记今日服药并扣减库存。','展示原始药盒反馈；未验证的记录不会自动确认服药或扣减库存。')
    .replaceAll('读取药盒离线保存的服药记录，按本地时间匹配今日计划并标记已服用。','读取原始药盒记录，未知标志保留为待核实，不判定吞服。')
    .replaceAll("wearable.status='药盒已绑定'","wearable.status='绑定流程收到响应，实际状态请核实'")
    .replaceAll("wearable.status='药盒提醒已启用'","wearable.status='启用流程收到响应，实际提醒请核实'")
    .replaceAll("wearable.status='药盒已解绑'","wearable.status='解绑流程收到响应，实际状态请核实'")
    .replaceAll("wearable.status='第 '+esc(data.slot)+' 格提醒已设置'","wearable.status='第 '+esc(data.slot)+' 格提醒收到设置回执'")
    .replaceAll("wearable.status='第 '+esc(data.slot)+' 格提醒已清除'","wearable.status='第 '+esc(data.slot)+' 格提醒收到清除回执'")
    .replaceAll('药盒报告未服药','原始记录 · 含义未验证');
}
module.exports={patchAsset};
