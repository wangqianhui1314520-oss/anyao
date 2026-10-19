/* Offline native scanning. A barcode is an identifier, never a dosage or a URL to open. */
let barcodeBusy=false;
async function scanDrugBarcode(image=false){
 if(barcodeBusy)throw Error('扫码正在进行，请先完成或取消');
 if(!window.RepairApi?.[image?'scanBarcodeImage':'scanBarcode'])throw Error('扫码需要更新后的安药安卓版；也可手动填写包装条码');
 barcodeBusy=true;
 try{
  const token=image?RepairApi.scanBarcodeImage():RepairApi.scanBarcode();
  for(let i=0;i<720;i++){
   const r=JSON.parse(RepairApi.barcodeResult(token));
   if(r.state==='cancelled')return null;
   if(r.state==='error')throw Error(r.error||'扫码失败，请重试');
   if(r.state==='done'){
    const code=String(r.text||'').trim();
    if(/^https?:\/\/q\.hipee\.cn\/hibox\/\d+\/?$/i.test(code))throw Error('这是药盒设备码。添加药物请扫描药品包装条形码；连接药盒请进入“药盒”页。');
    if(!DrugModel.validBarcode(code))throw Error('识别内容不是可登记的药品条码，请扫描包装上的条形码；二维码网址不会打开');
    return code;
   }
   await new Promise(resolve=>setTimeout(resolve,250));
  }
  throw Error('扫码尚未结束，请返回后重试');
 }finally{barcodeBusy=false;}
}
async function scanIntoForm(form,image=false){
 const code=await scanDrugBarcode(image);if(!code||!form?.isConnected)return;
 form.elements.barcode.value=code;
 const known=state.drugs.find(d=>d.barcode===code);
 if(known&&!form.elements.name.value.trim()){
  form.elements.name.value=known.name;form.elements.category.value=known.category||'';
 }
 toast(known?'已识别登记过的条码，请核对药名与计划':'条码已识别，请按包装填写药名和既有用药计划');
}
const scanBaseDispatch=dispatchAction;
dispatchAction=async function(a,id,el){
 if(a==='med-scan'||a==='med-scan-image'){
  const code=await scanDrugBarcode(a==='med-scan-image');if(!code)return;
  const matches=state.drugs.filter(d=>d.barcode===code);
  if(matches.length)return panel('已登记这个条码',`<p class="helper">${esc(code)}，已有 ${matches.length} 份计划。请核对，避免重复服药提醒。</p><div class="surface">${matches.map(d=>row(d.name,DrugModel.schedule(d),'report',`data-action="med-detail" data-id="${esc(d.id)}"`)).join('')}</div><button class="secondary-btn" data-action="med-scan-new" data-id="${esc(code)}">另建一份用药计划</button>`);
  return formPanel('扫码添加药物',medFields({barcode:code}),'add-med');
 }
 if(a==='med-scan-new')return formPanel('添加药物',medFields({barcode:id}),'add-med');
 return scanBaseDispatch(a,id,el);
};
