import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const {patchAsset}=createRequire(import.meta.url)('../src/desktop-asset-patches.cjs');
const original=fs.readFileSync(new URL('../assets/bluetooth.js',import.meta.url),'utf8');

function harness(initial={mode:'simulation',connected:false,open:false}){
  const listeners=new Map(),documentListeners=new Map(),nativeCalls=[],draws=[],inputs=new Map();let visible=false,current=initial;
  let details=[{open:true},{open:false}],focused=null;
  const makeInput=(id,value,type='text')=>({id,value,type,checked:false,selectionStart:null,selectionEnd:null,
    focus(){focused=this;},setSelectionRange(start,end){this.selectionStart=start;this.selectionEnd=end;}});
  inputs.set('hipee-slot',makeInput('hipee-slot','1','number'));
  inputs.set('hipee-time',makeInput('hipee-time','08:00','time'));
  const dialog={scrollTop:0,contains(input){return input!=null&&inputs.get(input.id)===input;},querySelectorAll(selector){return selector==='details'?details:[...inputs.values()];}};
  const marker={closest(){return dialog;}};
  const document={hidden:true,addEventListener(type,fn){if(!documentListeners.has(type))documentListeners.set(type,[]);documentListeners.get(type).push(fn);},querySelector(){return visible?marker:null;},getElementById(id){return inputs.get(id)||null;},get activeElement(){return focused;}};
  const window={anyaoHost:{},NativeWearable:{postMessage(value){nativeCalls.push(value);}},anyaoDesktopRuntime:{snapshot:()=>current},
    addEventListener(type,fn){listeners.set(type,fn);}};
  const context=vm.createContext({window,document,localStorage:{getItem:()=>null,setItem(){}},state:{tab:'today',drugs:[]},
    profile:()=>'',health:()=>'',esc:value=>String(value??''),icon:()=>'',heading:()=>'',row:()=>'',render(){},
    panel(title,subtitle,html){draws.push(html);inputs.set('hipee-slot',makeInput('hipee-slot','1','number'));inputs.set('hipee-time',makeInput('hipee-time','08:00','time'));details=[{open:false},{open:false}];dialog.scrollTop=0;},
    api:async()=>({records:[]}),setInterval(){},setTimeout,clearTimeout,crypto:{randomUUID:()=>String(nativeCalls.length)},console,Date,Map,Set,JSON,Promise});
  const patched=patchAsset('bluetooth.js',original);
  assert.ok(patched.includes('function syncDesktopWearableState('),'state observer was injected into the untouched APK H5 closure');
  vm.runInContext(patched.replace(/\}\)\(\);\s*$/,"window.__test={wearable,hipee,show,syncDesktopWearableState};})();"),context);
  return {window,draws,nativeCalls,inputs,dialog,get details(){return details;},set visible(value){visible=value;},
    emit(state){current=state;listeners.get('anyao-desktop-state')({detail:state});},
    click(action){const button={dataset:{band:action},closest:selector=>selector==='button'?button:null};return Promise.all(documentListeners.get('click').map(fn=>fn({target:button})));},
    reply(data){const request=JSON.parse(nativeCalls.at(-1));window.NativeWearable.onmessage({data:JSON.stringify({id:request.id,ok:true,data})});},
    get model(){return window.__test;}};
}

test('connect and open events update the original device and HiPee UI without issuing native commands',()=>{
  const h=harness();h.visible=true;h.emit({mode:'simulation',connected:true,open:true});
  assert.equal(h.model.hipee.status.open,true);assert.equal(h.model.hipee.status.supported,true);
  assert.equal(h.model.wearable.device.deviceId,'sim-hi-pb1');
  assert.equal(h.draws.length,1);assert.match(h.draws[0],/指令会话已打开/);
  assert.doesNotMatch(h.draws[0],/data-band="hipeeBind" disabled/);assert.deepEqual(h.nativeCalls,[]);
});

test('BLE removal clears the original connected card and stale scan results immediately',()=>{
  const h=harness();h.visible=true;h.emit({mode:'simulation',connected:true,open:true});
  h.model.wearable.authenticated=true;h.model.wearable.devices=[{deviceId:'stale-device'}];
  h.model.hipee.battery=78;h.emit({mode:'simulation',connected:false,open:true});
  assert.equal(h.model.wearable.device,null);assert.equal(h.model.wearable.authenticated,false);
  assert.equal(h.model.wearable.devices.length,0);assert.equal(h.model.hipee.status.open,false);
  assert.equal(h.model.hipee.status.supported,false);assert.equal(h.model.hipee.battery,null);
  assert.match(h.draws.at(-1),/尚未连接/);assert.match(h.draws.at(-1),/data-band="hipeeBind" disabled/);
  assert.deepEqual(h.nativeCalls,[]);
});

test('clock, telemetry and module payload updates do not redraw or discard editing state',()=>{
  const h=harness();h.visible=true;h.emit({mode:'simulation',connected:true,open:true});
  const input=h.inputs.get('hipee-time');input.value='19:25';const count=h.draws.length;
  h.emit({mode:'simulation',connected:true,open:true,virtual:{clock:{seconds:69900}},telemetry:{battery:60}});
  assert.equal(h.draws.length,count);assert.equal(h.inputs.get('hipee-time'),input);assert.equal(input.value,'19:25');
});

test('busy and hidden device panels synchronize state without being rebuilt',()=>{
  const h=harness();h.emit({mode:'simulation',connected:true,open:true});assert.equal(h.draws.length,0);
  h.visible=true;h.model.wearable.busy=true;h.emit({mode:'simulation',connected:false,open:false});
  assert.equal(h.draws.length,0);assert.equal(h.model.wearable.device,null);assert.equal(h.model.hipee.status.connected,false);
  h.model.wearable.busy=false;h.model.wearable.devices=[{deviceId:'fresh-scan'}];
  h.model.syncDesktopWearableState(h.window.anyaoDesktopRuntime.snapshot(),{redraw:false,force:true});
  assert.equal(h.model.wearable.devices[0].deviceId,'fresh-scan','finally reconciliation keeps a new successful scan');
  h.model.wearable.device={deviceId:'late-connect-response'};
  h.model.syncDesktopWearableState(h.window.anyaoDesktopRuntime.snapshot(),{redraw:false,force:true});
  assert.equal(h.model.wearable.device,null,'a late native reply cannot restore a disconnected card');
});

test('connection-state redraw retains form drafts, expanded sections and panel scroll',()=>{
  const h=harness();h.visible=true;h.inputs.get('hipee-slot').value='3';h.inputs.get('hipee-time').value='17:42';h.dialog.scrollTop=284;
  h.emit({mode:'simulation',connected:true,open:true});
  assert.equal(h.inputs.get('hipee-slot').value,'3');assert.equal(h.inputs.get('hipee-time').value,'17:42');
  assert.deepEqual(h.details.map(detail=>detail.open),[true,false]);assert.equal(h.dialog.scrollTop,284);
});

test('initial runtime state is consumed and switching source clears simulation-only receipts',()=>{
  const h=harness({mode:'simulation',connected:true,open:true});
  assert.equal(h.model.hipee.status.open,true);assert.equal(h.draws.length,0);
  h.model.hipee.lastPush={pushed:1};h.model.hipee.lastSync={recordCount:1};
  h.emit({mode:'device',connected:false,open:false});
  assert.equal(h.model.wearable.device,null);assert.equal(h.model.hipee.lastPush,null);assert.equal(h.model.hipee.lastSync,null);
  assert.deepEqual(h.nativeCalls,[]);
});

test('the original scan/connect handler reconciles final runtime state without a manual refresh',async()=>{
  const h=harness();h.visible=true;
  const scanning=h.click('scan');h.reply([{deviceId:'sim-hi-pb1',name:'Hi-PB1',pillbox:true}]);await scanning;
  assert.equal(h.model.wearable.devices.length,1);assert.equal(h.model.wearable.busy,false);
  const connecting=h.click('connect');
  assert.equal(h.model.wearable.busy,true);
  h.emit({mode:'simulation',connected:true,open:true});
  h.reply({deviceId:'sim-hi-pb1',name:'Hi-PB1',connected:true,open:true,hipeeSupported:true});await connecting;
  assert.equal(h.model.hipee.status.open,true);assert.match(h.draws.at(-1),/指令会话已打开/);
  assert.deepEqual(h.nativeCalls.map(value=>JSON.parse(value).action),['scan','connect']);
});

test('a native reply arriving after BLE removal cannot restore the stale connected device card',async()=>{
  const h=harness({mode:'simulation',connected:true,open:true});h.visible=true;
  const reading=h.click('read');h.emit({mode:'simulation',connected:false,open:false});
  h.reply({battery:78,connected:true,deviceId:'sim-hi-pb1'});await reading;
  assert.equal(h.model.wearable.device,null);assert.equal(h.model.hipee.status.connected,false);
  assert.match(h.draws.at(-1),/尚未连接/);assert.deepEqual(h.nativeCalls.map(value=>JSON.parse(value).action),['read']);
});

test('non-Bluetooth assets remain byte-for-byte unchanged',()=>{
  assert.equal(patchAsset('ui.js','original-source'),'original-source');
  assert.equal(fs.readFileSync(new URL('../assets/bluetooth.js',import.meta.url),'utf8'),original);
});
