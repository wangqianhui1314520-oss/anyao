import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{createBackend,localDate}=require('../src/backend.cjs');
function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'anyao-empty-backend-'));
  const file=path.join(root,'store.json'),backend=createBackend({dataPath:file});
  t.after(()=>{backend.close();const resolved=path.resolve(root);assert.ok(path.basename(resolved).startsWith('anyao-empty-backend-'));assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));fs.rmSync(resolved,{recursive:true,force:true});});
  const api=(method,url,body={})=>backend.invokeApi({method,path:url,body});return {backend,api,file};
}
test('first launch is an empty private store without a demo patient, drug, health or seed database',async t=>{
  const {backend,api,file}=fixture(t);assert.equal(backend.isListening(),false);assert.equal(fs.existsSync(file),false);
  const backup=await api('GET','/api/backup');assert.equal(backup.status,200);assert.equal(backup.body.schemaVersion,1);
  assert.equal(backup.body.profile.name,'');assert.equal(backup.body.profile.email,'');
  for(const key of ['drugs','intakeEvents','trackers','appointments','caregivers','refills','audit','diary','conditions','medical-team','archivedDrugs','wearables'])assert.deepEqual(backup.body[key],[],key);
  assert.equal(backup.body.wearableHealth,null);assert.equal(backend.isListening(),false);
});
test('CRUD validation and persisted records survive a backend restart at the same user-selected path',async t=>{
  const {backend,api,file}=fixture(t);const profile=await api('PATCH','/api/profile',{name:'测试用户'});assert.equal(profile.status,200);
  const invalid=await api('POST','/api/drugs',{name:'验证药物',times:['25:00'],inventory:4});assert.equal(invalid.status,400);
  const drug=await api('POST','/api/drugs',{name:'验证药物',dose:'测试剂量',times:['08:00','18:00'],inventory:4});assert.equal(drug.status,201);
  const today=await api('GET','/api/today');assert.equal(today.body.events.length,2);assert.ok(today.body.events.every(event=>event.status==='scheduled'));
  backend.close();const reopened=createBackend({dataPath:file});t.after(()=>reopened.close());
  const persisted=await reopened.invokeApi({method:'GET',path:'/api/drugs'});assert.equal(persisted.body[0].id,drug.body.id);assert.equal(persisted.body[0].inventory,4);
  assert.equal((await reopened.invokeApi({method:'GET',path:'/api/profile'})).body.name,'测试用户');assert.equal(reopened.isListening(),false);
});
test('manual intake confirmation is idempotent for inventory and undo restores it exactly once',async t=>{
  const {api}=fixture(t);const drug=await api('POST','/api/drugs',{name:'验证药物',times:['08:00'],inventory:3});
  const event=(await api('GET','/api/intake-events')).body[0],url='/api/intake-events/'+event.id;
  await api('PATCH',url,{status:'taken'});await api('PATCH',url,{status:'taken'});
  assert.equal((await api('GET','/api/drugs/'+drug.body.id)).body.inventory,2);
  await api('PATCH',url,{status:'scheduled'});await api('PATCH',url,{status:'scheduled'});
  assert.equal((await api('GET','/api/drugs/'+drug.body.id)).body.inventory,3);
});
test('each original structured CRUD collection creates, patches, reads and deletes without invented hardware data',async t=>{
  const {api}=fixture(t),bodies={trackers:{value:'测试值'},appointments:{title:'测试事项',date:localDate(),time:'09:00'},caregivers:{name:'测试联系人'},diary:{body:'测试日记'},conditions:{name:'测试分类'},'medical-team':{name:'测试成员'}};
  for(const [type,body]of Object.entries(bodies)) {
    const created=await api('POST','/api/'+type,body);assert.equal(created.status,201,type);const url='/api/'+type+'/'+created.body.id;
    assert.equal((await api('GET',url)).status,200);assert.equal((await api('PATCH',url,body)).status,200);
    assert.equal((await api('DELETE',url)).status,200);assert.equal((await api('GET',url)).status,404);
  }
  assert.equal((await api('GET','/api/wearable-health')).body,null);
});
test('hardware histories are explicitly empty read-only routes and cannot confirm a dose',async t=>{
  const {api}=fixture(t);
  for(const url of ['/api/hipee-history','/api/band-history','/api/xiaomi-history']) {
    assert.deepEqual((await api('GET',url)).body,[]);assert.equal((await api('POST',url,{records:[{taken:true}]})).status,405);
    assert.deepEqual((await api('GET',url)).body,[]);
  }
  assert.deepEqual((await api('GET','/api/intake-events')).body,[]);
});
test('empty and populated backups round-trip; invalid restore does not mutate the previous state',async t=>{
  const {api}=fixture(t),empty=(await api('GET','/api/backup')).body;
  assert.equal((await api('POST','/api/restore',empty)).status,200);
  await api('PATCH','/api/profile',{name:'测试用户'});await api('POST','/api/drugs',{name:'验证药物',inventory:2,times:['12:00']});
  const backup=(await api('GET','/api/backup')).body;
  const invalid=structuredClone(backup);invalid.drugs[0].times=['29:99'];assert.equal((await api('POST','/api/restore',invalid)).status,400);
  assert.deepEqual((await api('GET','/api/drugs')).body,backup.drugs);
  assert.equal((await api('POST','/api/restore',backup)).status,200);assert.deepEqual((await api('GET','/api/drugs')).body,backup.drugs);
});
test('concurrent invokes are serialized and cannot lose independent refill updates',async t=>{
  const {api,backend}=fixture(t);const drug=await api('POST','/api/drugs',{name:'验证药物',times:['08:00'],inventory:0});
  const results=await Promise.all(Array.from({length:12},()=>api('POST','/api/drugs/'+drug.body.id+'/refill',{amount:1})));
  assert.ok(results.every(result=>result.status===201));assert.equal((await api('GET','/api/drugs/'+drug.body.id)).body.inventory,12);assert.equal(backend.isListening(),false);
});
test('IPC request validation rejects external URLs, static paths, oversized bodies and malformed commands',async t=>{
  const {backend,api}=fixture(t);
  for(const request of [null,[],{path:'https://example.com/api/profile'},{path:'/src/main.cjs'},{path:'/api/../src/main.cjs'},
    {path:'/api/profile\r\nHost:example.com'},{path:'/api/profile',method:'CONNECT'},{path:'/api/profile',body:[]},{path:'/api/profile',body:{name:'x'.repeat(70000)}}]) {
    assert.equal((await backend.invokeApi(request)).status,400);
  }
  assert.equal((await api('GET','/api/profile')).body.name,'');assert.equal(backend.isListening(),false);
});
test('close is idempotent and refuses future CRUD work',async t=>{
  const {backend,api}=fixture(t);backend.close();backend.close();assert.equal((await api('GET','/api/profile')).status,503);
});
