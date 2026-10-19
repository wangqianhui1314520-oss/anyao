import { chromium } from 'file:///C:/Users/m5601/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
const B=process.env.BASE||'http://127.0.0.1:4200',k=process.env.KEY||'test01',out=process.argv[2]||'tests/autoplay-shots'; (await import('node:fs')).mkdirSync(out,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--enable-webgl','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required']});
const page=await browser.newPage({viewport:{width:1600,height:900}});
const errs=[];page.on('pageerror',e=>errs.push(e.message));page.on('response',r=>{if(r.status()>=400&&!/favicon|preview-rev|sw\.js/.test(r.url()))errs.push(r.status()+' '+r.url())});
await page.goto(`${B}/?k=${k}`);
await page.waitForFunction(()=>window.anyaoStage?.pillbox.snapshot().ready&&window.anyaoStage.watch.snapshot().ready,null,{timeout:60000});
await page.mouse.click(800,30); // unlock audio like a user click
await page.locator('#autoplay').click();
let last=-1, t0=Date.now();
while(Date.now()-t0<420000){
  const c=await page.evaluate(()=>{const h=document.getElementById('caption');return h.hidden?null:{step:document.getElementById('cap-step').textContent,title:document.getElementById('cap-title').textContent}});
  if(!c){ if(last>=0) break; await page.waitForTimeout(300); continue; }
  const n=parseInt(c.step);
  if(n!==last){
    if(last>=0){ const s=await page.evaluate(()=>{const v=window.anyaoStage.state();return `box=${v.box.effect}/${v.box.screen}${v.box.session?.ringing?'/ringing':''}${v.box.modes?.vibrateOnly?'/仅振动':''}${v.box.modes?.sleep?'/休眠':''} watch=${v.watch.screen} notices=${window.anyaoStage.notices().map(n=>n.title).slice(0,2).join(',')}`});
      console.log(`   end of step ${last}: ${s}`); await page.screenshot({path:`${out}/${String(last).padStart(2,'0')}.png`}); }
    console.log(`${c.step} ${c.title}`); last=n;
  }
  await page.waitForTimeout(250);
}
await page.screenshot({path:`${out}/zz-end.png`});
const v=await page.evaluate(()=>window.anyaoStage.state());
console.log('doses',v.doses.map(d=>d.planned+':'+d.status).join(' '));
console.log('feed:'); console.log(v.log.slice(0,45).reverse().map(l=>'  '+l.time+' '+l.actor+' '+l.text).join('\n'));
console.log('errors',errs, 'seconds', Math.round((Date.now()-t0)/1000));
await browser.close();
