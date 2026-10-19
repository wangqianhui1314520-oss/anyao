/** Candidate modular hardware bus. Software enumeration simulation, not a fabricated I2C read. */
export const MODULE_TYPES=Object.freeze({
  screen:{name:'屏幕模块',driver:'display-v1',capabilities:['display'],maxMa:150,candidate:'本地显示控制器 + SPI 显示屏'},
  motor:{name:'震动马达模块',driver:'motor-v1',capabilities:['vibrate'],maxMa:300,candidate:'本地控制器 + DRV8837C + 匹配电压的电机/稳压'},
  audio:{name:'音响模块',driver:'audio-v1',capabilities:['audio'],maxMa:750,candidate:'本地控制器 + DFRobot DFR0299 / 本地语音文件'},
  bluetooth:{name:'蓝牙模块',driver:'ble-v1',capabilities:['ble'],maxMa:400,candidate:'ESP32-C3-MINI-1-H4X + 本地稳压与桥接固件'},
  led:{name:'指示灯模块',driver:'led-v1',capabilities:['led'],maxMa:100,candidate:'恒流/限流驱动 + RGB LED'},
  cover:{name:'开合检测模块',driver:'cover-v1',capabilities:['cover'],maxMa:30,candidate:'本地控制器 + 独立 Hall / 盖磁铁'},
  lock:{name:'锁驱动模块',driver:'lock-v1',capabilities:['lock'],maxMa:600,candidate:'本地控制器 + 驱动与独立锁位检测；执行器待定'},
  power:{name:'供电识别模块',driver:'power-v1',capabilities:['power'],maxMa:30,candidate:'独立高电流电池接口 + 身份/NTC，不走通用信号座供电'},
});
const clone=value=>JSON.parse(JSON.stringify(value));
const encode=value=>new TextEncoder().encode(JSON.stringify(value));
export function descriptorCrc(value){let crc=0xffffffff;for(const byte of encode(value)){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
export function simulatedDescriptor(type,serial='SIM-'+type){const spec=MODULE_TYPES[type];if(!spec)throw new Error('未知模块类型');const value={magic:'ANYAO-MOD',protocol:1,type,driver:spec.driver,serial,supplyMv:5000,maxMa:spec.maxMa,capabilities:[...spec.capabilities]};return {...value,crc:descriptorCrc(value)};}
export function createModuleBus({onChange=()=>{},initial=true,budgetMa=2500}={}){
  const ports=Array.from({length:8},(_,index)=>({port:index+1,state:'absent',descriptor:null,output:'off',reason:'未插入'}));let revision=0;const log=[];
  const snapshot=()=>clone({source:'simulation',basis:'candidate-modular-bus-v1',hardwareValidated:false,revision,budgetMa,ports,log});
  function emit(port,event){revision++;log.push({revision,port,event,source:'simulation'});if(log.length>80)log.shift();onChange(snapshot());}
  const portAt=port=>{if(!Number.isInteger(port)||port<1||port>8)throw new Error('端口必须为 1–8');return ports[port-1];};
  function insert(port,descriptor){const node=portAt(port);if(node.state!=='absent')throw new Error('先拔出该端口模块');node.state='detected';emit(port,'检测到插入');node.state='power-ramp';emit(port,'受控供电阶段（软件演示）');
    try{if(!descriptor||typeof descriptor!=='object')throw new Error('缺少身份描述符');const {crc,...value}=descriptor;if(crc!==descriptorCrc(value))throw new Error('身份 CRC 错误');const spec=MODULE_TYPES[value.type];if(value.magic!=='ANYAO-MOD'||value.protocol!==1||!spec||value.driver!==spec.driver)throw new Error('没有匹配驱动');if(value.supplyMv!==5000||!Number.isFinite(value.maxMa)||value.maxMa<=0||value.maxMa>spec.maxMa)throw new Error('电压或额定电流超限');if(JSON.stringify(value.capabilities)!==JSON.stringify(spec.capabilities))throw new Error('能力与白名单不匹配');if(typeof value.serial!=='string'||!value.serial.trim()||value.serial.length>64||ports.some(item=>item!==node&&item.state==='ready'&&item.descriptor?.serial===value.serial))throw new Error('身份重复或非法');const requested=ports.filter(item=>item.state==='ready').reduce((sum,item)=>sum+MODULE_TYPES[item.descriptor.type].maxMa,0)+spec.maxMa;if(requested>budgetMa)throw new Error('主机白名单的最坏电流预算不足');
      node.state='identifying';emit(port,'校验身份与协议版本');node.descriptor=clone(descriptor);node.state='ready';node.reason='已加载 '+value.driver;node.output='idle';emit(port,'驱动就绪，自动注册能力');return snapshot();
    }catch(error){node.state='quarantined';node.reason=error.message;node.output='off';node.descriptor=null;emit(port,'拒绝模块并切断该口（软件演示）');return snapshot();}}
  function remove(port){const node=portAt(port);node.output='off';emit(port,'先停驱动/撤销能力');Object.assign(node,{state:'absent',descriptor:null,reason:'已拔出',output:'off'});emit(port,'模块离线，保留计划与其他模块');return snapshot();}
  const has=capability=>ports.some(node=>node.state==='ready'&&node.descriptor.capabilities.includes(capability));
  function apply(reminding){const powered=has('power');for(const node of ports){node.output=node.state!=='ready'||!powered?'off':reminding&&node.descriptor.capabilities.some(cap=>['vibrate','audio','led'].includes(cap))?'active':node.descriptor.capabilities.includes('display')?'displaying':'idle';}emit(0,'按当前计划自动应用可用驱动');return snapshot();}
  const api={snapshot,insert,remove,has,apply};
  if(initial)Object.keys(MODULE_TYPES).forEach((type,index)=>insert(index+1,simulatedDescriptor(type)));
  return Object.freeze(api);
}
