import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createHostServer,injectBootstrap} from '../src/host-server.mjs';
const directory=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(directory,'..');
const {patchAsset}=createRequire(import.meta.url)('../src/desktop-asset-patches.cjs');
function fakeRequest(server,{url,method='GET',origin}={}) {
  return new Promise(resolve=>{
    const headers={};let status;
    server.emit('request',{url,method,headers:origin?{origin}:{}},{writeHead(value,more){status=value;Object.assign(headers,more);},end(body){resolve({status,body:body==null?'':String(body),headers});}});
  });
}
test('bootstrap injection preserves original HTML and precedes untouched native-client.js exactly once',()=>{
  const original='<html><head></head><body><script src="native-client.js"></script><script src="ui.js"></script></body></html>';
  const served=injectBootstrap(original);assert.ok(served.indexOf('/__exe__/bootstrap.js')<served.indexOf('native-client.js'));
  assert.equal(injectBootstrap(served),served);assert.equal(served.replace("<script data-anyao-bootstrap src='/__exe__/bootstrap.js'></script>\n",''),original);
});
test('the reused bridge initializes an empty read-only snapshot without listening',()=>{
  const server=createHostServer();assert.equal(server.listening,false);const snapshot=server.snapshot();assert.equal(snapshot.version,1);assert.equal(snapshot.readOnly,true);
  assert.equal(snapshot.state.connection.connected,false);assert.equal(snapshot.state.telemetry,null);assert.deepEqual(snapshot.events,[]);assert.equal(typeof snapshot.bridgeId,'string');server.closeSubscribers();
});
test('original H5 is served with a runtime patch only in memory; asset file bytes stay intact',async()=>{
  const server=createHostServer();
  const appRoot=fs.existsSync(path.join(root,'assets/app/index.html'))?path.join(root,'assets/app'):path.join(root,'assets');
  const indexFile=path.join(appRoot,'index.html'),bleFile=path.join(appRoot,'bluetooth.js');
  const index=fs.readFileSync(indexFile),ble=fs.readFileSync(bleFile);
  const html=await fakeRequest(server,{url:'/console/'});assert.equal(html.status,200);assert.match(html.body,/data-anyao-bootstrap/);
  assert.ok(html.body.indexOf('bootstrap.js')<html.body.indexOf('native-client.js'));
  const bluetooth=await fakeRequest(server,{url:'/console/bluetooth.js'});assert.equal(bluetooth.status,200);assert.equal(bluetooth.body,patchAsset('bluetooth.js',ble.toString()));
  assert.deepEqual(fs.readFileSync(indexFile),index);assert.deepEqual(fs.readFileSync(bleFile),ble);server.closeSubscribers();
});
test('host HTTP writes and non-loopback bridge origins are refused without invoking private CRUD',async()=>{
  const server=createHostServer();
  assert.equal((await fakeRequest(server,{url:'/api/profile',method:'PATCH'})).status,405);
  assert.equal((await fakeRequest(server,{url:'/api/desktop-bridge/state',method:'POST'})).status,405);
  assert.equal((await fakeRequest(server,{url:'/api/desktop-bridge/state',origin:'https://example.com'})).status,403);
  const state=await fakeRequest(server,{url:'/api/desktop-bridge/state',origin:'http://127.0.0.1:4187'});assert.equal(state.status,200);assert.equal(JSON.parse(state.body).readOnly,true);server.closeSubscribers();
});
test('virtual-state, protocol lifecycle and disconnect use the same bridge snapshot contract',()=>{
  const server=createHostServer();server.publish({source:'simulation',kind:'connection',connected:true,deviceId:'virtual-test'});
  server.publish({source:'simulation',kind:'telemetry',battery:80,confidence:'simulation',measured:false});
  server.publish({source:'simulation',kind:'virtual-state',snapshot:{lids:['unknown','unknown','unknown','unknown']}});
  server.publish({source:'simulation',kind:'operation',operation:'query',phase:'completed',correlationId:'test-query'});
  server.publish({source:'simulation',kind:'connection',connected:false});
  const state=server.snapshot();assert.equal(state.events.length,5);assert.equal(state.state.connection.connected,false);assert.equal(state.state.telemetry.stale,true);
  assert.equal(state.state.operations['test-query'].phase,'completed');assert.ok(state.events.every(event=>event.bridgeId===state.bridgeId));server.closeSubscribers();
});
