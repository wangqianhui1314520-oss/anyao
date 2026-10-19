import {createDesktopController} from './core/controller.mjs';
import {HiPeeDevice} from './core/transport.mjs';
import {SERVICE_CONTROL,SERVICE_5833} from './core/hipee07.mjs';
import {createVirtualHiPb1Device} from './virtual-device.mjs';
import {createModuleBus,simulatedDescriptor} from './module-bus.mjs';

/** Adapter for the APK's NativeWearable contract, with provenance kept explicit. */
export function createAnyaoRuntime({host,bluetooth=globalThis.navigator?.bluetooth,connectReal=options=>HiPeeDevice.connect(options),virtualFactory=createVirtualHiPb1Device,onChange=()=>{}}={}) {
  let mode='simulation',picked=null,virtual=null,offVirtual=null,open=false,destroyed=false,sequence=0,lastTelemetry=null,history=[],moduleBus;
  const publish=event=>{const sample={...event,source:mode==='simulation'?'simulation':'device',transport:mode==='simulation'?'virtual-protocol':'web-bluetooth',app:'anyao-0.4.6-windows',timestamp:event.timestamp||new Date().toISOString()};if(mode==='simulation'&&sample.kind==='telemetry')sample.confidence='simulation';history.push(sample);history=history.slice(-200);host?.publish?.(sample);onChange(snapshot());};
  const controller=createDesktopController({publish,connectDevice:async options=>{
    if(mode==='simulation'){
      if(!moduleBus.has('power')||!moduleBus.has('ble'))throw new Error('请先插入并识别供电模块与蓝牙模块');
      offVirtual?.();virtual??=virtualFactory();offVirtual=virtual.onState(()=>{moduleBus.apply(Boolean(virtual.getSnapshot().reminding?.length));publishVirtual();});return virtual.connect({onDisconnected:options.onDisconnected});
    }
    if(!picked)throw new Error('请先点击连接设备并选择蓝牙药盒');return connectReal({...options,chosenDevice:picked});
  }});
  function publishVirtual(){publish({kind:'virtual-state',snapshot:{...(virtual?.getSnapshot()||{connected:false,bound:false,enabled:false,lids:[],led:[],plans:[],reminding:[]}),modules:moduleBus?.snapshot()||null,moduleProfile:'V0.9 可插拔模块候选 · 非 Hi-PB1 原厂结构'},measured:false});}
  moduleBus=createModuleBus({onChange:()=>{if(moduleBus&&mode==='simulation')publishVirtual();}});
  function snapshot(){const connected=controller.getState().connected;return {mode,connected,open:Boolean(open&&connected),telemetry:lastTelemetry,virtual:mode==='simulation'?virtual?.getSnapshot()||null:null,modules:moduleBus?.snapshot(),history:[...history],hardwareValidated:false};}
  async function run(operation,extra={}){
    const result=await controller.run({kind:'command',operation,mode:'device',allowInferred:mode==='simulation'||extra.allowInferred===true,correlationId:`anyao-${Date.now()}-${++sequence}`,...extra},{userGesture:true});
    if(!result.ok)throw new Error(result.error||'操作没有完成');return result.result;
  }
  async function invokeWearableAction(request){
    if(destroyed)throw new Error('桌面会话已关闭');const action=request.action;
    if(action==='scan') {
      if(controller.getState().connected)throw new Error('请先断开当前药盒，再选择设备');
      if(mode==='simulation'){publishVirtual();return moduleBus.has('power')&&moduleBus.has('ble')?[{deviceId:'sim-hi-pb1',name:'Hi-PB1 虚拟药盒（本机协议仿真）',pillbox:true,source:'simulation',services:[SERVICE_CONTROL]}]:[];}
      if(!bluetooth?.requestDevice)throw new Error('当前 Windows 蓝牙环境不可用');
      picked=await bluetooth.requestDevice({filters:[{services:[SERVICE_CONTROL]},{namePrefix:'Hi-PB'},{namePrefix:'HiPee'}],optionalServices:[SERVICE_CONTROL,SERVICE_5833,'battery_service']});
      return [{deviceId:picked.id,name:picked.name||'Hi-PB1',pillbox:true,source:'device'}];
    }
    if(action==='connect') {
      if(mode==='simulation'&&request.deviceId!=='sim-hi-pb1')throw new Error('请选择本次扫描的虚拟药盒');
      if(mode==='device'&&request.deviceId!==picked?.id)throw new Error('设备选择已过期，请重新选择');
      await run('connect');open=true;lastTelemetry=null;
      return {deviceId:mode==='simulation'?'sim-hi-pb1':picked.id,name:mode==='simulation'?'Hi-PB1 虚拟药盒（模拟）':picked.name,connected:true,open:true,supported:true,hipeeSupported:true,transport:mode==='simulation'?'virtual-protocol':'web-bluetooth',source:mode,services:[SERVICE_CONTROL],battery:null,firmware:null,authenticated:false};
    }
    if(action==='disconnect'){await run('disconnect');open=false;lastTelemetry=null;onChange(snapshot());return {disconnected:true};}
    if(action==='hipeeStatus')return {connected:controller.getState().connected,open:Boolean(open&&controller.getState().connected),supported:controller.getState().connected,deviceId:mode==='simulation'?'sim-hi-pb1':picked?.id||null,battery:mode==='simulation'?lastTelemetry?.battery??null:null,firmwareFromQuery:mode==='simulation'?lastTelemetry?.version??null:null,source:mode,realCurrentA:null,rawStatusMeaning:'unknown'};
    if(action==='hipeeOpen'){if(!controller.getState().connected)throw new Error('请先连接药盒');open=true;return {connected:true,open:true,supported:true};}
    if(action==='hipeeClose'){open=false;return {closed:true};}
    if(!controller.getState().connected||!open)throw new Error('请先连接药盒并打开指令会话');
    const map={hipeeBind:'bind',hipeeEnable:'enable',hipeeFindBox:'find',hipeeUnbind:'unbind',hipeeQuery:'query',hipeePushSchedule:'plan',hipeeSync:'sync'};
    if(action==='hipeeQuery') {const info=await run('query');lastTelemetry=info;return {...info,battery:mode==='simulation'?info.battery:null,firmwareFromQuery:mode==='simulation'?info.version:null,candidates:mode==='device'?{battery:info.battery,version:info.version}:null,source:mode,measured:false};}
    if(action==='hipeePushSchedule'){
      if(!Array.isArray(request.times)||request.times.length<1||request.times.length>4)throw new Error('真实药盒为四仓，需提供 1–4 个时刻');
      const times=[...request.times,...Array(4-request.times.length).fill(null)];const result=await run('plan',{times});return {...result,pushed:request.times.length,slots:request.times.map((time,index)=>({slot:index+1,time})),commitConfirmed:false,source:mode};
    }
    if(action==='hipeeSetReminder'){
      const slot=Number(request.slot),seconds=Number(request.secondsFromMidnight);if(!Number.isInteger(slot)||slot<1||slot>4)throw new Error('仓位必须为 1–4');
      const secondsList=[null,null,null,null];secondsList[slot-1]=seconds;return {...await run('plan',{secondsList}),slot,source:mode};
    }
    if(action==='hipeeClearReminder')return {...await run('clear',{slot:request.slot,seconds:request.secondsFromMidnight}),slot:request.slot,source:mode};
    if(action==='hipeeSync'){const result=await run('sync');return {...result,recordCount:result.count||0,matchedIntakeEvents:0,records:[],rawMeaning:'unverified',source:mode};}
    if(map[action])return {...await run(map[action],{allowInferred:request.allowInferred===true}),source:mode};
    if(action==='read')return {battery:mode==='simulation'?lastTelemetry?.battery??null:null,source:mode,currentA:null,voltageV:null};
    throw new Error('这个 Android 健康或穿戴接口尚未迁移到 Windows；不会返回模拟健康数据');
  }
  async function wearableAction(request){try{return await invokeWearableAction(request);}finally{onChange(snapshot());}}
  const virtualCommand=command=>{
    const action=command.virtualAction||command.action;if(mode!=='simulation'||command.mode!=='simulation'||!action)throw new Error('网站仅能操作显式模拟会话');
    if(action.type==='module-remove'||action.type==='module-insert'){
      if(action.type==='module-remove')moduleBus.remove(action.port);else moduleBus.insert(action.port,simulatedDescriptor(action.moduleType,`SIM-${action.moduleType}-P${action.port}`));
      virtual?.setPowered?.(moduleBus.has('power'));
      if(!moduleBus.has('power')||!moduleBus.has('ble')){virtual?.disconnect();controller.disconnected('required-module-removed');open=false;}
      moduleBus.apply(Boolean(virtual?.getSnapshot().reminding?.length));publishVirtual();return {ok:true,source:'simulation',modules:moduleBus.snapshot()};
    }
    if(!virtual)throw new Error('请先在安药桌面应用初始化虚拟药盒');
    if(!moduleBus.has('power'))throw new Error('供电模块未连接，主机无法执行本地功能');
    if(['open-lid','close-lid'].includes(action.type)&&!moduleBus.has('cover'))throw new Error('没有已识别的开合检测模块，无法上报盖位');
    const result=virtual.action(action);if(!result.ok)throw new Error(result.error||'模拟动作失败');return result;
  };
  publishVirtual();
  return {wearableAction,virtualCommand,snapshot,async setMode(next){if(!['simulation','device'].includes(next))throw new Error('未知模式');if(controller.getState().connected||controller.getState().busy)throw new Error('请先结束当前操作并断开设备');mode=next;picked=null;open=false;lastTelemetry=null;onChange(snapshot());},destroy(){destroyed=true;offVirtual?.();virtual?.disconnect();controller.disconnected('window-closed');}};
}

if(typeof window!=='undefined'&&window.anyaoHost){
  const host=window.anyaoHost;
  const renderState=state=>{const status=document.getElementById('anyao-desktop-link-state');if(status)status.textContent=`${state.mode==='simulation'?'本机协议仿真':'真实 Hi-PB1'} · ${state.connected?'已连接':'未连接'} · ${state.open?'指令会话已打开':'会话未打开'}`;window.dispatchEvent(new CustomEvent('anyao-desktop-state',{detail:state}));};
  const runtime=createAnyaoRuntime({host,onChange:renderState});
  const off=host.onVirtualCommand?.(command=>{try{runtime.virtualCommand(command);}catch(error){host.publish({kind:'operation',operation:'query',phase:'failed',source:'simulation',correlationId:command.correlationId||'virtual-action',detail:error.message});}});
  window.anyaoDesktopRuntime=runtime;
  window.addEventListener('DOMContentLoaded',()=>renderState(runtime.snapshot()));
  window.addEventListener('pagehide',()=>{off?.();runtime.destroy();},{once:true});
}
