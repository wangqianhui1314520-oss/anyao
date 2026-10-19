/** Windows port host for the actual Anyao 0.4.6 H5 app, with isolated model UI. */
const {app,BrowserWindow,ipcMain,dialog}=require('electron');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {createBackend}=require('./backend.cjs');
let appWindow=null,modelWindow=null,host=null,backend=null,baseUrl='',selection=null;
const deviceIds=new Set();
function trusted(event,window) {
  if(!window||window.isDestroyed()||event.sender!==window.webContents)return false;
  if(event.senderFrame&&event.senderFrame!==window.webContents.mainFrame)return false;
  try{return new URL(event.senderFrame?.url||event.sender.getURL()).origin===baseUrl;}catch{return false;}
}
function local(url){try{return new URL(url).origin===baseUrl;}catch{return false;}}
function secureWindow(window) {
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('will-navigate',(event,url)=>{if(!local(url))event.preventDefault();});
  window.webContents.on('will-redirect',(event,url)=>{if(!local(url))event.preventDefault();});
}
function cancelChooser() {const callback=selection;selection=null;deviceIds.clear();if(callback)callback('');}
function publish(payload) {
  if(!payload||typeof payload!=='object'||Array.isArray(payload)||!['device','simulation','browser_simulation'].includes(payload.source))return null;
  if(!['connection','telemetry','operation','record','records','plan','frame','virtual-state'].includes(payload.kind))return null;
  const event=host?.publish(payload);
  if(event&&modelWindow&&!modelWindow.isDestroyed())modelWindow.webContents.send('anyao:device-state',event);
  return event;
}
function createAppWindow() {
  const window=new BrowserWindow({width:1020,height:900,title:'安药 0.4.6 · Windows 联动版',backgroundColor:'#fbf9f7',
    webPreferences:{preload:path.join(__dirname,'preload-app.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  secureWindow(window);window.loadURL(baseUrl+'/console/');
  window.webContents.on('select-bluetooth-device',(event,devices,callback)=>{
    event.preventDefault();
    if(selection&&selection!==callback)cancelChooser();
    selection=callback;deviceIds.clear();
    for(const item of devices)deviceIds.add(String(item.deviceId));
    window.webContents.send('anyao:bluetooth-devices',devices.map(({deviceId,deviceName})=>({deviceId,deviceName})));
  });
  window.on('closed',()=>{
    cancelChooser();appWindow=null;
    for(const source of ['device','simulation'])publish({kind:'connection',source,connected:false,stale:true,reason:'anyao-window-closed'});
  });
  return window;
}
function createModelWindow() {
  const window=new BrowserWindow({width:1240,height:900,title:'安药 × PILLBANK · 虚拟产品联调',backgroundColor:'#0b0f14',
    webPreferences:{preload:path.join(__dirname,'preload-model.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  secureWindow(window);window.loadURL(baseUrl+'/?view=3d#hardware-lab');
  window.webContents.on('did-finish-load',()=>{
    if(window.isDestroyed())return;const snapshot=host.snapshot();
    window.webContents.send('anyao:device-state',{kind:'bridge.snapshot',source:'desktop',bridgeId:snapshot.bridgeId,snapshot});
  });
  window.on('closed',()=>{modelWindow=null;});return window;
}
function virtualCommand(payload) {
  if(!payload||typeof payload!=='object'||Array.isArray(payload)||payload.mode!=='simulation')throw new Error('网站只能控制模拟产品动作；真实设备操作必须在安药窗口由本人发起');
  if(typeof payload.correlationId!=='string'||!payload.correlationId.trim()||payload.correlationId.length>160)throw new Error('无效的操作编号');
  const action=payload.virtualAction||payload.action;
  if(payload.operation!=='virtual-action'&&!payload.virtualAction)throw new Error('网站通道只接受 virtual-action 模拟动作');
  if(!action||typeof action!=='object'||Array.isArray(action)||typeof action.type!=='string'||!action.type.trim()||action.type.length>64)throw new Error('无效的模拟动作');
  if(action.slot!==undefined&&(!Number.isInteger(action.slot)||action.slot<1||action.slot>4))throw new Error('模拟仓位必须为 1..4');
  if(action.seconds!==undefined&&(!Number.isFinite(action.seconds)||action.seconds<0||action.seconds>86400))throw new Error('模拟步进秒数必须为 0..86400');
  const copied=JSON.parse(JSON.stringify(payload));if(JSON.stringify(copied).length>8000)throw new Error('模拟动作过大');
  return {...copied,kind:'virtualAction',operation:'virtual-action',mode:'simulation',source:'model',action:{...action},virtualAction:{...action}};
}
function installIpc() {
  ipcMain.handle('anyao:api',(event,request)=>{if(!trusted(event,appWindow))throw new Error('Untrusted app renderer');return backend.invokeApi(request);});
  ipcMain.on('anyao:publish',(event,payload)=>{if(trusted(event,appWindow))publish(payload);});
  ipcMain.handle('anyao:bridge-info',event=>{
    if(!trusted(event,appWindow)&&!trusted(event,modelWindow))throw new Error('Untrusted renderer');
    return {baseUrl,origin:baseUrl,readOnlyEventsUrl:baseUrl+'/api/desktop-bridge/events',readOnly:true,appFamily:'anyao-0.4.6-port'};
  });
  ipcMain.handle('anyao:bridge-state',event=>{if(!trusted(event,appWindow)&&!trusted(event,modelWindow))throw new Error('Untrusted renderer');return host.snapshot();});
  ipcMain.handle('anyao:virtual-command',(event,payload)=>{
    if(!trusted(event,modelWindow))throw new Error('Untrusted model renderer');
    const command=virtualCommand(payload);
    if(!appWindow||appWindow.isDestroyed())throw new Error('安药窗口已关闭，模拟会话不可用');
    appWindow.webContents.send('anyao:virtual-action',command);return {ok:true,queued:true,correlationId:command.correlationId,source:'simulation'};
  });
  ipcMain.on('anyao:bluetooth-select',(event,id)=>{
    if(!trusted(event,appWindow)||!selection)return;
    const value=String(id||'');if(value&&!deviceIds.has(value))return;
    const callback=selection;selection=null;deviceIds.clear();callback(value);
  });
}
app.whenReady().then(async()=>{
  try {
    backend=createBackend({dataPath:path.join(app.getPath('userData'),'anyao-data.json')});
    const {createHostServer}=await import(pathToFileURL(path.join(__dirname,'host-server.mjs')).href);
    host=createHostServer();
    await new Promise((resolve,reject)=>{host.once('error',reject);host.listen(0,'127.0.0.1',resolve);});
    baseUrl='http://127.0.0.1:'+host.address().port;
    installIpc();appWindow=createAppWindow();modelWindow=createModelWindow();
    console.log('[anyao] 安药 /console/ · 网页 / · 只读事件 '+baseUrl+'/api/desktop-bridge/events');
  }catch(error){dialog.showErrorBox('安药 Windows 启动失败',error.message);app.quit();return;}
  app.on('activate',()=>{if(!appWindow)appWindow=createAppWindow();if(!modelWindow)modelWindow=createModelWindow();});
});
app.on('before-quit',()=>{
  cancelChooser();backend?.close();host?.closeSubscribers();host?.close();
  for(const channel of ['anyao:api','anyao:bridge-info','anyao:bridge-state','anyao:virtual-command'])ipcMain.removeHandler(channel);
  for(const channel of ['anyao:publish','anyao:bluetooth-select'])ipcMain.removeAllListeners(channel);
});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
