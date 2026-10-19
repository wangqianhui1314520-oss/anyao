// Integration regressions for APK-derived pages. API/Android responses are fixtures.
const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert/strict');
let playwright;
try{playwright=require(process.env.ANYAO_PLAYWRIGHT_PATH||'playwright')}
catch(error){
 if(process.env.ANYAO_PLAYWRIGHT_PATH)throw error;
 playwright=require('C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
}
const {chromium}=playwright;
const assets=path.resolve(__dirname,'../web'),out=path.resolve(__dirname,'../../../../evidence/mobile-current-20261016');
const results=[],errors=[],requests=[];
const drug={id:'drug',name:'测试药物',dose:'每次100mg',doseQuantity:2,inventoryUnit:'片',times:['08:00','20:00'],inventory:20};
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(new Date());
const family={user:{name:'测试服药者',phone:'000',email:'fixture@example.invalid'},contacts:[{id:'contact',name:'测试家属',phone:'000'}],missedAfterMinutes:30,channels:{},autoNotify:false,autoCall:false};
const dose={eventId:'dose',drugId:'drug',drug,planned:'20:00',date:today,status:'scheduled',level:'pending'};
const db={family,drugs:[drug],doses:[dose],log:[],history:[],boxHistory:[],settings:{vibration:true,sound:true,flash:true,phone:true}};
const server=http.createServer((req,res)=>{
 const file=path.resolve(assets,'.'+new URL(req.url,'http://localhost').pathname);
 if(!file.startsWith(assets+path.sep)||!fs.existsSync(file)){res.writeHead(404);return res.end()}
 res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.woff2')?'font/woff2':'text/html');res.end(fs.readFileSync(file));
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const localChrome='C:/Program Files/Google/Chrome/Application/chrome.exe';
 const browser=await chromium.launch({headless:true,executablePath:process.env.ANYAO_CHROME_PATH||(fs.existsSync(localChrome)?localChrome:undefined)});
 const page=await browser.newPage({viewport:{width:412,height:915},locale:'zh-CN',timezoneId:'Asia/Shanghai'});
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  const fn=value=>async()=>value;
  window.AndroidApp={setRole:fn({}),syncStatus:fn({}),reminderStatus:fn({body:{}}),appInfo:fn({versionName:'1.1.0-repair.1'}),
   dial:fn({opened:true}),sms:fn({opened:true}),wechat:fn({copied:true,opened:true}),email:fn({opened:true}),
   reminderPreview:fn({body:{done:['声音'],skipped:['闪光：缺少权限'],notified:true}})};
 });
 await page.route('**/api/**',async route=>{
  const request=route.request(),p=new URL(request.url()).pathname.replace('/api/',''),method=request.method();
  const body=request.postDataJSON()||{};if(method!=='GET')requests.push({p,method,body});
  let data;
  if(p.startsWith('doses/')&&p.endsWith('/action')){dose.action={...body,id:'action',at:new Date().toISOString()};db.log=[dose.action];data=dose.action}
  else data=({today:{events:[],settings:db.settings},drugs:db.drugs,'intake-events':db.history,adherence:{taken:0,total:0,percent:0,days:[]},family:db.family,doses:{doses:db.doses},'family-log':db.log,'hipee-history':db.boxHistory,refills:[]})[p]||{};
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
 });
 const base='http://127.0.0.1:'+server.address().port;
 const open=async file=>{await page.goto(base+'/'+file);await page.waitForFunction(()=>typeof state!=='undefined'&&state.loadedAt)};
 const act=async(a,id,extra)=>page.evaluate(async([a,id,extra])=>action(a,id,extra?{dataset:extra}:undefined),[a,id,extra]);
 const close=async()=>{await page.evaluate(()=>document.querySelectorAll('dialog[open]').forEach(d=>d.close()));await page.waitForTimeout(40)};
 const refresh=async()=>{await page.evaluate(()=>load())};
 const text=()=>page.locator('#view').innerText();
 async function test(name,fn){try{await fn();results.push({name,status:'PASS'})}catch(e){results.push({name,status:'FAIL',detail:e.message})}}
 await open('family.html');
 await test('未来计划不显示全部已服',async()=>{assert.doesNotMatch(await text(),/都按时吃了|均已记录/);assert.match(await text(),/等待服药记录/)});
 await test('已跳过不显示全部已服',async()=>{dose.status='skipped';dose.level='skipped';await refresh();assert.match(await text(),/次已跳过/);assert.doesNotMatch(await text(),/均已记录/)});
 await test('已补服不虚构按时',async()=>{dose.status='taken';dose.level='late';await refresh();assert.match(await text(),/均已记录/);assert.doesNotMatch(await text(),/都按时吃了/)});
 await test('未知仓位和原始记录不显示开盒服药',async()=>{db.boxHistory=[{records:[{timestamp:1792000000,compartment:0,rawFlag:1}]}];await refresh();assert.doesNotMatch(await text(),/第 0 仓|开盒就记一次服药|打开过/);assert.match(await text(),/不能代替实际服药确认/)});
 for(const channel of ['wechat','sms','call','email'])await test('打开'+channel+'不自动记录已发送',async()=>{
  await close();const n=requests.length;await act('family-act','dose',{channel});assert.equal(requests.length,n);assert.equal(await page.locator('#confirm-dialog').evaluate(d=>d.open),true);
  await page.locator('#confirm-dialog [data-dialog-cancel]').click();assert.equal(requests.length,n);
 });
 await test('用户确认后才写入联系记录',async()=>{await act('family-act','dose',{channel:'wechat'});const n=requests.length;await page.locator('#confirm-dialog-ok').click();await page.waitForFunction(()=>state.log.length===1);assert.equal(requests.length,n+1);assert.equal(requests.at(-1).body.channel,'wechat');assert.doesNotMatch(await text(),/发了微信/);assert.match(await text(),/记录了微信联系/)});
 await test('系统返回关闭最上层确认并保留编辑内容',async()=>{
  await close();await act('med-detail','drug');await act('med-edit','drug');await page.locator('[name=name]').fill('尚未保存');await act('med-delete','drug');
  const before=await page.evaluate(()=>panelNavigation.parents.length);await page.evaluate(()=>handleAndroidBack());
  assert.equal(await page.locator('#confirm-dialog').evaluate(d=>d.open),false);assert.equal(await page.locator('#detail-dialog').evaluate(d=>d.open),true);
  assert.equal(await page.locator('[name=name]').inputValue(),'尚未保存');assert.equal(await page.evaluate(()=>panelNavigation.parents.length),before);
 });
 await test('返回编辑页面后可返回药物详情',async()=>{await page.evaluate(()=>handleAndroidBack());assert.match(await page.locator('#detail-dialog').innerText(),/剩余库存/)});
 await test('结构化数量计算库存天数，不解析mg说明',async()=>{assert.equal(await page.evaluate(()=>stockDays(state.drugs[0])),5)});
 await test('混合单位库存不相加成总片数',async()=>{await close();await page.evaluate(()=>goTab('plan'));assert.equal(await page.locator('.inventory-total strong').innerText(),'1');assert.match(await page.locator('.inventory-total').innerText(),/种药物/)});
 await test('添加表单提交结构化数量与单位',async()=>{
  await close();await act('med-add');await page.locator('[name=name]').fill('测试');await page.locator('[name=doseQuantity]').fill('1.5');await page.locator('[name=inventoryUnit]').selectOption('毫升');
  const body=await page.evaluate(()=>medBody(document.querySelector('form[data-kind="add-med"]')));assert.equal(body.doseQuantity,1.5);assert.equal(body.inventoryUnit,'毫升');
 });
 await test('零或负扣减数量拒绝保存',async()=>{await page.locator('[name=doseQuantity]').fill('0');await assert.rejects(page.evaluate(()=>medBody(document.querySelector('form[data-kind="add-med"]'))),/大于 0/)});
 await test('星期、分类、条码和逐时间数量写入表单提交',async()=>{
  await close();await act('med-add');await page.locator('[name=category]').fill('常用药');await page.locator('[name=barcode]').fill('6901234567892');
  for(const box of await page.locator('[name=weekdays]').all())await box.uncheck();await page.locator('[name=weekdays][value="1"]').check();await page.locator('[name=weekdays][value="3"]').check();
  await page.locator('[name=timeQuantity]').fill('0.5');
  const b=await page.evaluate(()=>medBody(document.querySelector('form[data-kind="add-med"]')));assert.deepEqual(b.weekdays,[1,3]);assert.equal(b.category,'常用药');assert.equal(b.barcode,'6901234567892');assert.equal(b.timeQuantities['08:00'],0.5);
 });
 await test('没有星期或重复时间拒绝保存',async()=>{
  for(const box of await page.locator('[name=weekdays]').all())await box.uncheck();await assert.rejects(page.evaluate(()=>medBody(document.querySelector('form[data-kind="add-med"]'))),/至少选择/);
  await page.locator('[name=weekdays][value="1"]').check();await page.locator('[data-time-add]').click();await page.locator('[name=time]').nth(1).fill('08:00');
  await assert.rejects(page.evaluate(()=>medBody(document.querySelector('form[data-kind="add-med"]'))),/不能重复/);
 });
 await test('按星期估算库存，早晚使用各自数量',async()=>{
  assert.equal(await page.evaluate(()=>stockDays({inventory:30,times:['08:00','20:00'],weekdays:[1,3,5],doseQuantity:1,timeQuantities:{'08:00':0.5,'20:00':2}})),28);
 });
 await test('下次服药跳过未选星期，休息日不显示没有计划',async()=>{
  await close();await page.evaluate(()=>{state.doses=[];state.drugs=[{id:'weekday',name:'隔日药',times:['08:00'],weekdays:[(DrugModel.isoDay(dayKey(new Date()))+1)%7+1],inventory:10}];});
  const next=await page.evaluate(()=>nextPlanned());assert.equal(next.day,await page.evaluate(()=>dayLabel(dayKey(new Date(Date.now()+2*864e5)))));
 });
 await test('分类和搜索过滤家属端药物清单',async()=>{
  await page.evaluate(()=>{state.drugs=[{id:'a',name:'甲药',category:'常用药',barcode:'12345678',times:['08:00'],inventory:10},{id:'b',name:'乙药',category:'备用药',asNeeded:true,inventory:5}];goTab('plan');render();});
  await page.locator('[data-med-category]').selectOption('c:常用药');assert.match(await text(),/甲药/);assert.doesNotMatch(await text(),/乙药/);
  await page.locator('[data-med-search]').fill('9876');assert.match(await text(),/没有匹配/);await page.locator('[data-med-search]').fill('1234');assert.match(await text(),/甲药/);
  await page.evaluate(()=>{medFilter.query='';medFilter.category=null;});
 });
 await test('扫码匹配已登记药物，拒绝二维码网址且不打开网页',async()=>{
  await page.evaluate(()=>{window.RepairApi={scanBarcode:()=> 'fixture',barcodeResult:()=>JSON.stringify({state:'done',text:'12345678'})};});await act('med-scan');assert.match(await page.locator('#detail-dialog').innerText(),/已登记这个条码/);assert.match(await page.locator('#detail-dialog').innerText(),/甲药/);
  await page.evaluate(()=>{RepairApi.barcodeResult=()=>JSON.stringify({state:'done',text:'https://example.invalid'});});
  await assert.rejects(page.evaluate(()=>scanDrugBarcode()),/二维码网址不会打开/);await close();
  await page.evaluate(()=>{RepairApi.barcodeResult=()=>JSON.stringify({state:'done',text:'http://q.hipee.cn/hibox/123456789012345678'});});await assert.rejects(page.evaluate(()=>scanDrugBarcode()),/这是药盒设备码/);
 });
 await test('取消图片识别保留未保存药物表单',async()=>{
  await close();await act('med-add');await page.locator('[name=name]').fill('未保存的名字');
  await page.evaluate(async()=>{RepairApi.scanBarcodeImage=()=> 'image';RepairApi.barcodeResult=()=>JSON.stringify({state:'cancelled'});await scanIntoForm(document.querySelector('form[data-kind="add-med"]'),true);});
  assert.equal(await page.locator('[name=name]').inputValue(),'未保存的名字');await close();
 });
 await test('旧家庭服务拒绝新增字段，避免丢弃星期计划',async()=>{
  await page.evaluate(()=>{nativeSync.url='https://fixture.invalid';});
  await assert.rejects(page.evaluate(()=>checkDrugService({weekdays:[1],timeQuantities:{},category:'',barcode:''})),/家庭服务尚未支持/);
  await page.evaluate(()=>{nativeSync.url='';});
 });
 await test('非每日药盒计划在写入前被拒绝，完整每日计划保留日期字段',async()=>{
  const result=await page.evaluate(()=>{try{PillboxModel.plans([{compartment:1,times:['08:00'],weekdays:[1,3,5]}]);return 'accepted'}catch(e){return e.message;}});assert.match(result,/尚未验证/);
  const plans=await page.evaluate(()=>PillboxModel.plans([{compartment:1,times:['08:00']}]));assert.deepEqual(plans[0].weekdays,[1,2,3,4,5,6,7]);
 });
 await test('跨月历史可见且下月不超过当前月',async()=>{
  await close();const previous=new Date(today.slice(0,7)+'-15T12:00:00+08:00');previous.setMonth(previous.getMonth()-1);
  const key=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(previous);db.history=[{id:'old',drugId:'drug',drug,date:key,time:'08:00',status:'taken'}];
  await refresh();await page.evaluate(()=>goTab('mine'));assert.equal(await page.locator('[data-action=calendar-month][data-id="1"]').isDisabled(),true);
  await act('calendar-month','-1');assert.equal(await page.locator('[data-action=day]').count(),1);await page.locator('[data-action=day]').click();assert.match(await page.locator('#detail-dialog').innerText(),/已服用/);
 });
 await open('index.html');
 await test('提醒测试显示执行结果和失败原因',async()=>{await page.evaluate(()=>Reminders.test());assert.match(await page.locator('#detail-dialog').innerText(),/声音、通知/);assert.match(await page.locator('#detail-dialog').innerText(),/缺少权限/)});
 await test('服药端联系记录不声称发送或接通',async()=>{await close();assert.doesNotMatch(await text(),/发了微信|已接通/);assert.match(await text(),/记录了微信联系/)});
 await test('页面无未处理脚本错误',async()=>assert.deepEqual(errors,[]));
 await page.screenshot({path:path.join(out,'repaired-user.png'),fullPage:true});
 await open('family.html');await page.waitForTimeout(450);await page.screenshot({path:path.join(out,'repaired-family.png'),fullPage:true});
 await browser.close();server.close();
 const report={scope:'Desktop Chromium + fixture API/Android bridge; not phone or physical acceptance',at:new Date().toISOString(),results,errors};
 fs.writeFileSync(path.join(out,'ui-regressions.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
 if(results.some(r=>r.status==='FAIL'))process.exitCode=1;
})().catch(e=>{server.close();console.error(e);process.exitCode=1});
