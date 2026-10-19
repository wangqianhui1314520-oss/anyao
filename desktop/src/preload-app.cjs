const {contextBridge,ipcRenderer}=require('electron');
const subscribe=(channel,handler)=>{
  if(typeof handler!=='function')throw new TypeError('Handler must be a function');
  const listener=(_event,payload)=>handler(payload);ipcRenderer.on(channel,listener);
  return ()=>ipcRenderer.removeListener(channel,listener);
};
contextBridge.exposeInMainWorld('anyaoHost',Object.freeze({
  invokeApi(request){return ipcRenderer.invoke('anyao:api',request);},
  publish(event){ipcRenderer.send('anyao:publish',event);},
  onVirtualCommand(handler){return subscribe('anyao:virtual-action',handler);},
  bridgeInfo(){return ipcRenderer.invoke('anyao:bridge-info');},
  getBridgeState(){return ipcRenderer.invoke('anyao:bridge-state');},
  onBluetoothDevices(handler){return subscribe('anyao:bluetooth-devices',handler);},
  chooseBluetooth(deviceId){ipcRenderer.send('anyao:bluetooth-select',String(deviceId||''));},
}));
