const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('pillbankExe',Object.freeze({
  isDesktop:true,
  integrationKind:'anyao-apk-port',
  appFamily:'anyao-0.4.6-port',
  getBridgeInfo(){return ipcRenderer.invoke('anyao:bridge-info');},
  getBridgeState(){return ipcRenderer.invoke('anyao:bridge-state');},
  onDeviceState(handler){
    if(typeof handler!=='function')throw new TypeError('Handler must be a function');
    const listener=(_event,payload)=>handler(payload);ipcRenderer.on('anyao:device-state',listener);
    return ()=>ipcRenderer.removeListener('anyao:device-state',listener);
  },
  // The main process refuses device-mode commands. This method controls only a
  // virtual product's actions, never a real patient's device.
  sendCommand(payload){return ipcRenderer.invoke('anyao:virtual-command',payload);},
}));
