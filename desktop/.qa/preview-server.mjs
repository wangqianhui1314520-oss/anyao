/** Development-only browser preview of the shipping two-window integration.
 * Not part of the EXE payload. Uses a fresh QA database, never user data.
 * Native GATT is blocked; only explicit simulation events/actions may cross it.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createHostServer,injectBootstrap} from '../src/host-server.mjs';
import {MODULE_TYPES} from '../src/module-bus.mjs';

const require=createRequire(import.meta.url),{createBackend}=require('../src/backend.cjs');
const qaRoot=path.dirname(fileURLToPath(import.meta.url)),desktopRoot=path.resolve(qaRoot,'..');
const webRoot=path.resolve(desktopRoot,'../../pillbank/web'),appRoot=path.join(desktopRoot,'assets');
const port=Number(process.argv[2])||4189,origin=`http://127.0.0.1:${port}`,dataPath=path.join(qaRoot,`temp-data-${port}.json`);
// Preserve previous development runs rather than loading or deleting their data.
if(fs.existsSync(dataPath)){
  const target=path.join(qaRoot,`temp-data.previous-${Date.now()}.json`);
  if(path.dirname(path.resolve(target))!==qaRoot||path.dirname(path.resolve(dataPath))!==qaRoot)throw new Error('QA data path escaped the preview directory');
  fs.renameSync(dataPath,target);
}
const backend=createBackend({dataPath}),server=createHostServer({pillbankRoot:webRoot,appRoot,bridgeRoot:path.join(desktopRoot,'src')});
const originalHandler=server.listeners('request')[0],commandClients=new Set();
const kinds=new Set(['connection','telemetry','operation','record','records','plan','frame','virtual-state']);
const actions=new Set(['press-button','open-lid','close-lid','confirm-intake','advance-clock','low-battery','module-remove','module-insert']);
let acceptedEvents=0,rejectedDeviceEvents=0,queuedCommands=0,closing=false;

function qaCommon(){
  const originalFetch=window.fetch.bind(window);
  const post=async(route,body)=>{
    const response=await originalFetch(route,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
    const value=await response.json();if(!response.ok)throw new Error(value.error||value.detail||'QA bridge request failed');return value;
  };
  const deny=async()=>{throw new Error('浏览器开发验收禁止真实蓝牙；请选择虚拟药盒。本页未扫描或连接实际设备。');};
  const bluetooth=Object.freeze({requestDevice:deny,getDevices:async()=>[],getAvailability:async()=>false,addEventListener(){},removeEventListener(){}});
  // Install before the shipping runtime reads navigator.bluetooth.
  Object.defineProperty(navigator,'bluetooth',{value:bluetooth,configurable:true});
  const getBridgeState=async()=>{const response=await originalFetch('/api/desktop-bridge/state');if(!response.ok)throw new Error('QA bridge snapshot unavailable');return response.json();};
  const bridgeInfo=async()=>({baseUrl:location.origin,origin:location.origin,readOnlyEventsUrl:location.origin+'/api/desktop-bridge/events',readOnly:true,appFamily:'anyao-0.4.6-port',developmentPreview:true,realBluetoothAllowed:false});
  Object.defineProperty(window,'__anyaoQa',{value:Object.freeze({post,getBridgeState,bridgeInfo,bluetooth}),configurable:false});
  document.addEventListener('DOMContentLoaded',()=>{
    const label=document.createElement('aside');label.setAttribute('role','note');label.textContent='开发浏览器验收 · 独立空白测试数据 · 真实蓝牙已阻止 · 非 Windows EXE 实机验收';
    Object.assign(label.style,{padding:'7px 14px',background:'#f5e6bf',color:'#584621',fontSize:'11px',lineHeight:'1.5'});document.body.prepend(label);
  },{once:true});
}
function appShim(){
  const qa=window.__anyaoQa;let publication=Promise.resolve();
  window.anyaoHost=Object.freeze({
    developmentPreview:true,bluetooth:qa.bluetooth,
    invokeApi:request=>qa.post('/__qa__/api',request),
    publish(event){
      if(event?.source!=='simulation'){console.warn('QA refused a non-simulation publication');return;}
      publication=publication.then(()=>qa.post('/__qa__/event',event)).catch(error=>console.warn(error.message));
    },
    onVirtualCommand(handler){
      const stream=new EventSource('/__qa__/commands');stream.onmessage=event=>{try{handler(JSON.parse(event.data));}catch(error){console.warn(error.message);}};
      const close=()=>stream.close();window.addEventListener('pagehide',close,{once:true});return ()=>{window.removeEventListener('pagehide',close);close();};
    },
    bridgeInfo:qa.bridgeInfo,getBridgeState:qa.getBridgeState,
    onBluetoothDevices(){return ()=>{};},chooseBluetooth(){throw new Error('QA 禁止实际蓝牙设备选择');},
  });
}
function modelShim(){
  const qa=window.__anyaoQa;
  window.pillbankExe=Object.freeze({
    isDesktop:true,integrationKind:'anyao-apk-port',appFamily:'anyao-0.4.6-port',developmentPreview:true,
    getBridgeState:qa.getBridgeState,getBridgeInfo:qa.bridgeInfo,
    onDeviceState(handler){
      const stream=new EventSource('/api/desktop-bridge/events');
      stream.onmessage=event=>{try{handler(JSON.parse(event.data));}catch(error){console.warn(error.message);}};
      stream.onerror=()=>handler({kind:'connection',source:'simulation',connected:false,stale:true,reason:'qa-event-stream-interrupted'});
      const close=()=>stream.close();window.addEventListener('pagehide',close,{once:true});return ()=>{window.removeEventListener('pagehide',close);close();};
    },
    sendCommand:command=>qa.post('/__qa__/virtual-command',command),
  });
}
const commonCode=`(${qaCommon.toString()})();`;
const appCode=`${commonCode}\n(${appShim.toString()})();`,modelCode=`${commonCode}\n(${modelShim.toString()})();`;
function injectApp(html){return injectBootstrap(html).replace(/<script\s+data-anyao-bootstrap\b/i,`<script data-anyao-qa>${appCode}</script>\n<script data-anyao-bootstrap`);}
function injectModel(html){return html.replace(/<\/head>/i,`<script data-anyao-qa>${modelCode}</script>\n</head>`);}
function json(response,status,value){response.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});response.end(JSON.stringify(value));}
function html(response,method,body){response.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});response.end(method==='HEAD'?undefined:body);}
async function readJson(request,limit=8*1024*1024){
  if(!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type']||''))throw new Error('QA writes require application/json');
  let length=0;const chunks=[];for await(const chunk of request){length+=chunk.length;if(length>limit)throw new Error('QA request body too large');chunks.push(chunk);}
  const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('QA request must be an object');return value;
}
function validateCommand(payload){
  if(payload.mode!=='simulation'||payload.operation!=='virtual-action')throw new Error('QA only accepts explicit virtual-action simulation commands');
  if(typeof payload.correlationId!=='string'||!payload.correlationId.trim()||payload.correlationId.length>160)throw new Error('Invalid simulation correlation ID');
  const action=payload.virtualAction||payload.action;
  if(!action||typeof action!=='object'||Array.isArray(action)||!actions.has(action.type))throw new Error('Unknown simulation action');
  if(action.slot!==undefined&&(!Number.isInteger(action.slot)||action.slot<1||action.slot>4))throw new Error('Simulation slot must be 1..4');
  if(action.seconds!==undefined&&(!Number.isInteger(action.seconds)||action.seconds<0||action.seconds>86399))throw new Error('Simulation clock must be 0..86399 seconds');
  if(action.deltaSeconds!==undefined&&(!Number.isInteger(action.deltaSeconds)||action.deltaSeconds<0||action.deltaSeconds>7*86400))throw new Error('Simulation clock delta must be 0..604800 seconds');
  if(action.type.startsWith('module-')&&(!Number.isInteger(action.port)||action.port<1||action.port>8))throw new Error('Module port must be 1..8');
  if(action.type==='module-insert'&&!Object.hasOwn(MODULE_TYPES,action.moduleType))throw new Error('Unknown candidate module type');
  if(action.percent!==undefined&&(!Number.isInteger(action.percent)||action.percent<0||action.percent>100))throw new Error('Simulation battery must be 0..100');
  if(JSON.stringify(payload).length>8000)throw new Error('Simulation command too large');
  return {...payload,kind:'virtualAction',operation:'virtual-action',mode:'simulation',source:'model',action:{...action},virtualAction:{...action}};
}

server.removeListener('request',originalHandler);
server.on('request',async(request,response)=>{
  try{
    const host=request.headers.host||'',requestOrigin=request.headers.origin;
    if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(host))return json(response,403,{error:'QA server only accepts its loopback host'});
    const url=new URL(request.url,origin),qaRoute=url.pathname.startsWith('/__qa__/');
    if(qaRoute&&(requestOrigin&&requestOrigin!==origin&&requestOrigin!==`http://localhost:${port}`||request.headers['sec-fetch-site']==='cross-site'))return json(response,403,{error:'QA bridge accepts same-origin requests only'});
    if(url.pathname==='/__qa__/health'&&request.method==='GET')return json(response,200,{developmentOnly:true,origin,dataPath,backendListening:backend.isListening(),consoleCommandSubscribers:commandClients.size,acceptedEvents,rejectedDeviceEvents,queuedCommands,realBluetoothAllowed:false});
    if(url.pathname==='/__qa__/commands'&&request.method==='GET'){
      response.writeHead(200,{'content-type':'text/event-stream; charset=utf-8','cache-control':'no-store',connection:'keep-alive','x-accel-buffering':'no'});response.flushHeaders();response.write(': QA virtual-command channel ready\n\n');commandClients.add(response);
      const heartbeat=setInterval(()=>response.write(': heartbeat\n\n'),15000);heartbeat.unref();
      response.on('close',()=>{clearInterval(heartbeat);commandClients.delete(response);if(!commandClients.size&&!closing)server.publish({kind:'connection',source:'simulation',connected:false,stale:true,reason:'qa-console-closed'});});return;
    }
    if(qaRoute){
      if(request.method!=='POST')return json(response,405,{error:'QA endpoint requires an explicit JSON POST'});
      const payload=await readJson(request);
      if(url.pathname==='/__qa__/api')return json(response,200,await backend.invokeApi(payload));
      if(url.pathname==='/__qa__/event'){
        if(payload.source!=='simulation'){rejectedDeviceEvents++;return json(response,403,{error:'QA refuses device/real measurement events'});}
        if(!kinds.has(payload.kind)||JSON.stringify(payload).length>100000)return json(response,400,{error:'Invalid simulation event'});
        const event=server.publish(payload);if(!event)return json(response,400,{error:'Simulation event was not accepted'});acceptedEvents++;return json(response,200,{ok:true,eventId:event.eventId});
      }
      if(url.pathname==='/__qa__/virtual-command'){
        const command=validateCommand(payload);if(!commandClients.size)return json(response,409,{error:'请先打开安药开发预览页，并连接虚拟药盒'});
        for(const client of commandClients)client.write(`data: ${JSON.stringify(command)}\n\n`);queuedCommands++;
        return json(response,200,{ok:true,queued:true,correlationId:command.correlationId,source:'simulation'});
      }
      return json(response,404,{error:'Unknown QA endpoint'});
    }
    if(['/console','/console/','/console/index.html'].includes(url.pathname)&&['GET','HEAD'].includes(request.method))return html(response,request.method,injectApp(fs.readFileSync(path.join(appRoot,'index.html'),'utf8')));
    if(['/','/index.html'].includes(url.pathname)&&['GET','HEAD'].includes(request.method))return html(response,request.method,injectModel(fs.readFileSync(path.join(webRoot,'index.html'),'utf8')));
    originalHandler(request,response);
  }catch(error){if(!response.headersSent)json(response,400,{error:error.message});else response.end();}
});
server.publish({kind:'connection',source:'simulation',connected:false,stale:true,reason:'fresh-qa-session'});
function close(){
  if(closing)return;closing=true;for(const client of commandClients)client.end();commandClients.clear();server.closeSubscribers();backend.close();server.close(()=>process.exit(0));
}
process.on('SIGINT',close);process.on('SIGTERM',close);
server.on('error',error=>{console.error('[anyao-qa] '+error.message);backend.close();process.exitCode=1;});
server.listen(port,'127.0.0.1',()=>{
  console.log(`[anyao-qa] Application: ${origin}/console/`);
  console.log(`[anyao-qa] Website: ${origin}/?view=3d#hardware-lab`);
  console.log(`[anyao-qa] Fresh test store: ${dataPath}`);
  console.log('[anyao-qa] Development preview only; real Bluetooth and device-source publications are blocked.');
});
