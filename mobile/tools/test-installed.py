"""Real QA phone checks; requires unlocked QA app with no formal medication plans."""
import datetime, hashlib, json, time
import phone_cdp as probe
from phone_cdp import OUT, connect

results=[]
def check(name, value):
    results.append({'name':name,'status':'PASS' if value else 'FAIL'})
    if not value:raise AssertionError(name)
def evaluate(expr):
    v=dt.evaluate(expr,timeout=30)
    if isinstance(v,str) and v.startswith('__EXCEPTION__'):raise AssertionError(v)
    return v
def opened():
    return evaluate("[...document.querySelectorAll('dialog[open]')].map(d=>d.id)")

dt=connect()
for _ in range(30):
    if evaluate("typeof api==='function' && !!state.loadedAt"):break
    time.sleep(.2)
else:raise RuntimeError('WebView API not ready')
baseline=evaluate("api('export')")
(OUT/'qa-before-installed-tests-private.json').write_text(json.dumps(baseline,ensure_ascii=False),encoding='utf-8')
check('test app has no real medication plans',len(baseline['drugs'])==0)
try:
    evaluate("document.querySelectorAll('dialog[open]').forEach(d=>d.close());true")
    fixture=evaluate("(async()=>{const d=await send('drugs',{name:'库存验证临时项',dose:'100mg',doseQuantity:2,inventoryUnit:'片',inventory:20,asNeeded:true,times:[]});const e=await send('intake-events',{drugId:d.id});return {id:d.id,eid:e.id,stock:(await api('drugs'))[0].inventory};})()")
    check('installed app bridge deducts 2 units',fixture['stock']==18)
    check('installed app rejects invalid dose',evaluate("(async()=>{try{await send('drugs/"+fixture['id']+"',{doseQuantity:0},'PATCH');return false}catch{return true}})()"))
    evaluate("(async()=>{await load();await action('med-detail','"+fixture['id']+"');await action('med-edit','"+fixture['id']+"');document.querySelector('[name=name]').value='未保存的编辑';await action('med-delete','"+fixture['id']+"');return true;})()")
    time.sleep(.8) # Let the WebView dialog/IME transition finish before injecting hardware Back.
    check('two nested dialogs open on phone',len(opened())==2)
    probe.adb('shell','input','keyevent','KEYCODE_BACK')
    for _ in range(12):
        if opened()==['detail-dialog']:break
        time.sleep(.2)
    check('Android back closes topmost confirmation',opened()==['detail-dialog'])
    check('Android back preserves unsaved edit',evaluate("document.querySelector('[name=name]').value==='未保存的编辑'"))
    probe.adb('shell','input','keyevent','KEYCODE_BACK');time.sleep(.4)
    check('Android back returns from edit to drug detail',evaluate("document.querySelector('#detail-dialog').open&&!document.querySelector('#detail-dialog form')"))
    evaluate("document.querySelector('#detail-dialog').close();true")
    weekly=evaluate("(async()=>{const day=DrugModel.isoDay(dayKey(new Date()));const d=await send('drugs',{name:'星期验证临时项',category:'测试分类',barcode:'6901234567892',weekdays:[day%7+1],times:['23:57','23:58'],doseQuantity:1,timeQuantities:{'23:57':0.5,'23:58':2},inventory:10});const doses=(await api('doses')).doses.filter(x=>x.drugId===d.id);return{id:d.id,day,count:doses.length,status:(await AndroidApp.reminderStatus()).body};})()")
    wid=weekly['id']
    check('unselected weekday creates no phone dose or alarm',weekly['count']==0 and weekly['status']['scheduledCount']==0)
    selected=evaluate("(async()=>{await send('drugs/"+wid+"',{weekdays:["+str(weekly['day'])+"]},'PATCH');await load();const a=state.doses.filter(x=>x.drugId==='"+wid+"');return{count:a.length,eid:a[0].eventId,q:a[0].plannedQuantity,text:a[0].drug.dose,scheduled:(await AndroidApp.reminderStatus()).body.scheduledCount};})()")
    check('selecting today creates two phone doses and four due/missed alarms',selected['count']==2 and selected['scheduled']==4)
    check('installed dose shows per-time quantity',selected['q']==.5 and '0.5' in selected['text'])
    data=evaluate("(async()=>{await action('med-detail','"+wid+"');return document.querySelector('#detail-dialog').innerText;})()")
    check('installed detail shows classification, barcode and weekday',all(s in data for s in ['测试分类','6901234567892','服药日期','0.5']))
    timed=evaluate("(async()=>{await send('intake-events/"+selected['eid']+"',{status:'taken',time:nowTime()},'PATCH');await send('drugs/"+wid+"',{weekdays:["+str(weekly['day']%7+1)+"],timeQuantities:{'23:57':3}},'PATCH');const a=(await api('doses')).doses.filter(x=>x.drugId==='"+wid+"');return{stock:(await api('drugs')).find(d=>d.id==='"+wid+"').inventory,count:a.length,scheduled:(await AndroidApp.reminderStatus()).body.scheduledCount};})()")
    check('weekday edit cancels pending alarms and retains completed dose',timed['stock']==9.5 and timed['count']==1 and timed['scheduled']==0)
    check('timed undo refunds original half unit after quantity edit',evaluate("(async()=>{await send('intake-events/"+selected['eid']+"',{status:'scheduled'},'PATCH');return(await api('drugs')).find(d=>d.id==='"+wid+"').inventory===10})()"))
    guard=evaluate("(async()=>{const before=await DeviceBridge.call('hipeeStatus',null,{target:'pillbox'});let message='';try{await DeviceBridge.call('hipeePushPlans',null,{target:'pillbox',plans:[{compartment:1,times:['23:58'],weekdays:[1]}]})}catch(e){message=e.message}const after=await DeviceBridge.call('hipeeStatus',null,{target:'pillbox'});return{message,same:JSON.stringify(before.plans)===JSON.stringify(after.plans)};})()")
    check('native bridge refuses weekly hardware write without changing saved plans','尚未验证' in guard['message'] and guard['same'])
    probe.adb('shell','am','force-stop','com.anyao.app.qa')
    probe.adb('shell','am','start','-n','com.anyao.app.qa/com.anyao.app.MainActivity');time.sleep(1)
    dt=connect()
    for _ in range(30):
        if evaluate("typeof api==='function' && !!state.loadedAt"):break
        time.sleep(.2)
    check('structured quantity and stock persist after app restart',evaluate("(async()=>{const d=(await api('drugs')).find(d=>d.id==='"+fixture['id']+"');return d.doseQuantity===2&&d.inventory===18&&d.inventoryUnit==='片'})()"))
    check('weekday, barcode and category persist after restart',evaluate("(async()=>{const d=(await api('drugs')).find(d=>d.id==='"+wid+"');return d.category==='测试分类'&&d.barcode==='6901234567892'&&d.timeQuantities['23:57']===3&&d.weekdays.length===1})()"))
    check('undo through installed app restores original quantity',evaluate("(async()=>{await send('drugs/"+fixture['id']+"',{doseQuantity:3},'PATCH');await send('intake-events/"+fixture['eid']+"',{status:'scheduled'},'PATCH');return (await api('drugs')).find(d=>d.id==='"+fixture['id']+"').inventory===20})()"))
finally:
    dt=connect()
    evaluate("(async()=>{await send('restore',"+json.dumps(baseline,ensure_ascii=False)+");await load();return true;})()")
    check('all temporary medication data removed',evaluate("(async()=>{const b=await api('export');return b.drugs.length===0&&b.intakeEvents.length===0})()"))
    report={'scope':'Installed QA app on iQOO Neo10; actual Android back key, app restart, native bridge, weekday alarm generation/cancellation. No physical reminder acceptance.', 'at':datetime.datetime.now().astimezone().isoformat(),'apkSha256':hashlib.sha256((OUT/'anyao-1.1.0-repair.2-qa.apk').read_bytes()).hexdigest(),'results':results}
    (OUT/'installed-regressions.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(report,ensure_ascii=False,indent=2))
