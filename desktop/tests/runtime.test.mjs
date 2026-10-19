import test from 'node:test';
import assert from 'node:assert/strict';
import {createAnyaoRuntime} from '../src/runtime.mjs';
import {createModuleBus,simulatedDescriptor,descriptorCrc} from '../src/module-bus.mjs';
import {readFileSync} from 'node:fs';
const rig=()=>{const events=[];return {events,app:createAnyaoRuntime({host:{publish:event=>events.push(event)},bluetooth:{requestDevice(){throw new Error('real chooser forbidden');}}})};};
async function connect(app){const list=await app.wearableAction({action:'scan'});await app.wearableAction({action:'connect',deviceId:list[0].deviceId});}
async function bind(app){const pending=app.wearableAction({action:'hipeeBind'});app.virtualCommand({mode:'simulation',virtualAction:{type:'press-button'}});await pending;}
test('APK NativeWearable contract uses a framed virtual peripheral and never a real chooser',async()=>{
 const {app,events}=rig();await connect(app);const info=await app.wearableAction({action:'hipeeQuery'});assert.equal(info.source,'simulation');assert.equal(info.battery,78);
 assert.ok(events.some(event=>event.kind==='operation'&&event.hex?.startsWith('07 ')));assert.ok(events.some(event=>event.kind==='frame'&&event.opcode===4));assert.ok(events.every(event=>event.source==='simulation'));
 assert.equal(app.snapshot().modules.ports.filter(p=>p.state==='ready').length,8);app.destroy();
});
test('binding requires the model button; plan, explicit clock and manual confirmation form a round trip',async()=>{
 const {app}=rig();await connect(app);const pending=app.wearableAction({action:'hipeeBind'});assert.equal(app.snapshot().virtual.pendingBind,true);assert.equal(app.snapshot().virtual.bound,false);
 app.virtualCommand({mode:'simulation',virtualAction:{type:'press-button'}});await pending;await app.wearableAction({action:'hipeeEnable'});
 const result=await app.wearableAction({action:'hipeePushSchedule',times:['08:00','18:00']});assert.equal(result.pushed,2);assert.equal(result.commitConfirmed,false);
 app.virtualCommand({mode:'simulation',virtualAction:{type:'advance-clock',seconds:28800}});assert.equal(app.snapshot().virtual.reminding[0].slot,1);
 app.virtualCommand({mode:'simulation',virtualAction:{type:'open-lid',slot:1}});assert.equal(app.snapshot().virtual.records.length,0);
 app.virtualCommand({mode:'simulation',virtualAction:{type:'close-lid',slot:1}});assert.equal(app.snapshot().virtual.records.length,0);
 app.virtualCommand({mode:'simulation',virtualAction:{type:'confirm-intake',slot:1}});assert.equal(app.snapshot().virtual.records.length,1);assert.equal(app.snapshot().virtual.records[0].source,'simulation');app.destroy();
});
test('motor, screen and audio insertions register a driver and automatically apply the current reminder',async()=>{
 const {app}=rig();await connect(app);await bind(app);await app.wearableAction({action:'hipeeEnable'});await app.wearableAction({action:'hipeePushSchedule',times:['08:00']});app.virtualCommand({mode:'simulation',virtualAction:{type:'advance-clock',seconds:28800}});
 for(const [port,moduleType]of [[1,'screen'],[2,'motor'],[3,'audio']]){app.virtualCommand({mode:'simulation',virtualAction:{type:'module-remove',port}});assert.equal(app.snapshot().modules.ports[port-1].output,'off');app.virtualCommand({mode:'simulation',virtualAction:{type:'module-insert',port,moduleType}});assert.equal(app.snapshot().modules.ports[port-1].state,'ready');assert.equal(app.snapshot().modules.ports[port-1].output,moduleType==='screen'?'displaying':'active');}
 assert.equal(app.snapshot().virtual.plans[0].reminders.length,1);app.destroy();
});
test('removing Bluetooth disconnects the app; reconnecting the module is required before discovery',async()=>{
 const {app}=rig();await connect(app);await bind(app);app.virtualCommand({mode:'simulation',virtualAction:{type:'module-remove',port:4}});assert.equal(app.snapshot().connected,false);assert.deepEqual(await app.wearableAction({action:'scan'}),[]);
 app.virtualCommand({mode:'simulation',virtualAction:{type:'module-insert',port:4,moduleType:'bluetooth'}});await connect(app);assert.equal(app.snapshot().connected,true);assert.equal(app.snapshot().virtual.bound,true);app.destroy();
});
test('CRC, driver, duplicate identity, incompatible power and budget violations quarantine only the affected port',()=>{
 const bus=createModuleBus({initial:false,budgetMa:400});bus.insert(1,simulatedDescriptor('motor'));assert.equal(bus.snapshot().ports[0].state,'ready');
 bus.insert(2,simulatedDescriptor('audio'));assert.equal(bus.snapshot().ports[1].state,'quarantined');assert.equal(bus.snapshot().ports[0].state,'ready');bus.remove(2);
 const bad=simulatedDescriptor('screen');bad.type='motor';bus.insert(2,bad);assert.equal(bus.snapshot().ports[1].state,'quarantined');assert.equal(bus.snapshot().ports[1].descriptor,null);
 const snapshot=bus.snapshot();snapshot.ports[0].descriptor.type='evil';assert.equal(bus.snapshot().ports[0].descriptor.type,'motor');
});
test('real mode and unsupported native capabilities cannot silently invoke virtual actions',async()=>{
 const {app}=rig();await app.setMode('device');assert.throws(()=>app.virtualCommand({mode:'simulation',virtualAction:{type:'module-remove',port:1}}),/显式模拟/);
 await assert.rejects(app.wearableAction({action:'scan'}),/real chooser forbidden/);assert.equal(app.snapshot().connected,false);app.destroy();
});
test('removing the power module disables every output and web/desktop use identical module rules',()=>{
 const bus=createModuleBus();bus.apply(true);assert.equal(bus.snapshot().ports[1].output,'active');bus.remove(8);bus.apply(true);assert.ok(bus.snapshot().ports.every(p=>p.output==='off'));
 bus.insert(8,simulatedDescriptor('power','POWER-RETURN'));bus.apply(true);assert.equal(bus.snapshot().ports[1].output,'active');
 assert.equal(readFileSync(new URL('../src/module-bus.mjs',import.meta.url),'utf8'),readFileSync(new URL('../../../pillbank/web/src/twin/module-bus.mjs',import.meta.url),'utf8'));
});
test('native action completion reports the final connected/open state and detach clears both',async()=>{
 const states=[],app=createAnyaoRuntime({onChange:s=>states.push(s)});await connect(app);assert.equal(states.at(-1).connected,true);assert.equal(states.at(-1).open,true);
 await app.wearableAction({action:'hipeeClose'});assert.equal(states.at(-1).open,false);await app.wearableAction({action:'hipeeOpen'});assert.equal(states.at(-1).open,true);
 app.virtualCommand({mode:'simulation',virtualAction:{type:'module-remove',port:4}});assert.equal(states.at(-1).connected,false);assert.equal(states.at(-1).open,false);app.destroy();
});
test('a module cannot under-report its current to bypass the host white-list budget',()=>{
 const bus=createModuleBus({initial:false,budgetMa:400});bus.insert(1,simulatedDescriptor('motor'));const descriptor=simulatedDescriptor('audio');descriptor.maxMa=0.1;const {crc,...value}=descriptor;descriptor.crc=descriptorCrc(value);bus.insert(2,descriptor);
 assert.equal(bus.snapshot().ports[1].state,'quarantined');assert.match(bus.snapshot().ports[1].reason,/白名单/);
});
test('offline host reminders work without BLE while power removal suppresses every output',async()=>{
 const {app}=rig();await connect(app);await bind(app);await app.wearableAction({action:'hipeeEnable'});await app.wearableAction({action:'hipeePushSchedule',times:['09:00']});
 app.virtualCommand({mode:'simulation',virtualAction:{type:'module-remove',port:4}});app.virtualCommand({mode:'simulation',virtualAction:{type:'advance-clock',seconds:32400}});
 assert.equal(app.snapshot().connected,false);assert.equal(app.snapshot().virtual.localPowered,true);assert.equal(app.snapshot().modules.ports[1].output,'active');assert.equal(app.snapshot().virtual.led[0].color,'amber');
 app.virtualCommand({mode:'simulation',virtualAction:{type:'module-remove',port:8}});assert.ok(app.snapshot().modules.ports.every(p=>p.output==='off'));assert.equal(app.snapshot().virtual.localPowered,false);
 assert.throws(()=>app.virtualCommand({mode:'simulation',virtualAction:{type:'advance-clock',seconds:36000}}),/供电/);app.destroy();
});
test('an explicit App disconnect also preserves local host observation and reminder execution',async()=>{
 const {app,events}=rig();await connect(app);await bind(app);await app.wearableAction({action:'hipeeEnable'});await app.wearableAction({action:'hipeePushSchedule',times:['09:00']});await app.wearableAction({action:'disconnect'});
 app.virtualCommand({mode:'simulation',virtualAction:{type:'advance-clock',seconds:32400}});assert.equal(app.snapshot().modules.ports[1].output,'active');assert.equal(events.findLast(e=>e.kind==='virtual-state').snapshot.reminding[0].slot,1);assert.equal(app.snapshot().connected,false);app.destroy();
});
