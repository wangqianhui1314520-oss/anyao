/* Synchronous Android-bridge shape before the APK's untouched native-client.js. */
(() => {
  const host=window.anyaoHost;if(!host)return;
  const runtimeReady=import('/__exe__/runtime.mjs').then(()=>window.anyaoDesktopRuntime);
  const deliver=(bridge,id,ok,payload)=>bridge.onmessage?.({data:JSON.stringify({id,ok,...payload})});
  window.NativeApi={postMessage(serialized){let request;try{request=JSON.parse(serialized);}catch{return;}
    if(request.action==='api')host.invokeApi({method:request.method,path:request.path,body:request.body}).then(result=>deliver(window.NativeApi,request.id,true,result)).catch(error=>deliver(window.NativeApi,request.id,false,{error:error.message}));
    else runtimeReady.then(async()=>{
      const capabilities={platform:'windows',notificationsAllowed:false,exactAllowed:false,batteryExempt:false,scheduledCount:0,androidNative:false,windowsForegroundOnly:true,vibration:false,flash:false,phone:false,sound:false,message:'Windows 适配版：Android 准时权限、手机震动/闪光与 Health Connect 不适用。'};
      if(['reminderStatus','reminderCapabilities','reminderPermissions'].includes(request.action))return deliver(window.NativeApi,request.id,true,{body:capabilities});
      if(request.action==='reminderPreview')throw new Error('Android 手机效果未迁移；药盒 LED / 提醒请在虚拟联动实验室演示');
      if(request.action==='exportBackup'){const result=await host.invokeApi({method:'GET',path:'/api/backup'});return deliver(window.NativeApi,request.id,true,result);}
      throw new Error('此操作依赖 Android 系统，Windows 版暂不支持');
    }).catch(error=>deliver(window.NativeApi,request.id,false,{error:error.message}));
  }};
  window.NativeWearable={postMessage(serialized){let request;try{request=JSON.parse(serialized);}catch{return;}runtimeReady.then(runtime=>runtime.wearableAction(request)).then(data=>deliver(window.NativeWearable,request.id,true,{data})).catch(error=>deliver(window.NativeWearable,request.id,false,{error:error.message}));}};
  const ready=()=>{
    const bar=document.createElement('aside');bar.className='anyao-desktop-bar';bar.setAttribute('aria-label','Windows 设备连接与联动');
    Object.assign(bar.style,{padding:'14px 18px',background:'#eef4ed',color:'#294e3d',borderBottom:'1px solid #cedbd0',display:'flex',gap:'12px',alignItems:'center',flexWrap:'wrap',fontSize:'13px'});
    const title=document.createElement('strong');title.textContent='安药 0.4.6 · Windows 适配版';
    const mode=document.createElement('select');mode.setAttribute('aria-label','安药桌面连接模式');for(const [value,label]of [['simulation','虚拟药盒 · 本机协议联调'],['device','实体 Hi-PB1 · 蓝牙']]){const o=document.createElement('option');o.value=value;o.textContent=label;mode.append(o);}
    const status=document.createElement('output');status.id='anyao-desktop-link-state';status.textContent='本机协议仿真 · 未连接';status.setAttribute('role','status');
    const instruction=document.createElement('span');instruction.textContent='设备页连接虚拟药盒后，在网站确认绑定、开合与提醒；虚拟联动不使用无线蓝牙。';instruction.style.fontSize='11px';
    mode.addEventListener('change',async()=>{try{await (await runtimeReady).setMode(mode.value);}catch(error){status.textContent=error.message;mode.value=(await runtimeReady).snapshot().mode;}});
    bar.append(title,mode,status,instruction);document.body.prepend(bar);
    const picker=document.createElement('dialog'),heading=document.createElement('h2'),list=document.createElement('div'),cancel=document.createElement('button');heading.textContent='选择实际蓝牙设备';cancel.textContent='取消选择';cancel.type='button';picker.append(heading,list,cancel);document.body.append(picker);
    const choose=id=>{host.chooseBluetooth?.(id);picker.close();};cancel.addEventListener('click',()=>choose(''));picker.addEventListener('cancel',event=>{event.preventDefault();choose('');});
    host.onBluetoothDevices?.(devices=>{list.replaceChildren();for(const d of devices){const button=document.createElement('button');button.type='button';button.textContent=d.deviceName||d.deviceId;button.addEventListener('click',()=>choose(d.deviceId));list.append(button);}if(!picker.open)picker.showModal();});
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ready,{once:true});else ready();
})();
