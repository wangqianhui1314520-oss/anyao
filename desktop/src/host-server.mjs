/** Static windows + read-only event stream; all CRUD writes remain in trusted IPC. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createStaticServer} from './static-server.mjs';
import patches from './desktop-asset-patches.cjs';
const directory=path.dirname(fileURLToPath(import.meta.url));
export function injectBootstrap(html) {
  if(html.includes('data-anyao-bootstrap'))return html;
  const tag="<script data-anyao-bootstrap src='/__exe__/bootstrap.js'></script>\n";
  const native=/<script\b[^>]*\bsrc\s*=\s*['"]native-client\.js['"][^>]*>/i;
  if(native.test(html))return html.replace(native,match=>tag+match);
  return html.replace(/<\/head>/i,tag+'</head>');
}
export function createHostServer({
  pillbankRoot=fs.existsSync(path.resolve(directory,'../web/index.html'))?path.resolve(directory,'../web'):path.resolve(directory,'../../../pillbank/web'),
  appRoot=fs.existsSync(path.resolve(directory,'../assets/app/index.html'))?path.resolve(directory,'../assets/app'):path.resolve(directory,'../assets'),bridgeRoot=directory,
}={}) {
  const inner=createStaticServer({pillbankRoot,consoleRoot:appRoot,bridgeRoot});
  const handler=inner.listeners('request')[0];
  const server=http.createServer((request,response)=>{
    let url;try{url=new URL(request.url,'http://127.0.0.1');}catch{response.writeHead(400);response.end('Bad request');return;}
    if(['/console','/console/','/console/index.html'].includes(url.pathname)&&['GET','HEAD'].includes(request.method)) {
      try {
        const body=injectBootstrap(fs.readFileSync(path.join(appRoot,'index.html'),'utf8'));
        response.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});
        response.end(request.method==='HEAD'?undefined:body);
      }catch{response.writeHead(404);response.end('Anyao assets are unavailable');}
      return;
    }
    if(url.pathname==='/console/bluetooth.js'&&['GET','HEAD'].includes(request.method)) {
      try {
        const body=patches.patchAsset('bluetooth.js',fs.readFileSync(path.join(appRoot,'bluetooth.js'),'utf8'));
        response.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});
        response.end(request.method==='HEAD'?undefined:body);
      }catch{response.writeHead(404);response.end('Anyao Bluetooth asset is unavailable');}
      return;
    }
    handler(request,response);
  });
  server.publish=payload=>inner.publish(payload);
  server.snapshot=()=>inner.snapshot();
  server.closeSubscribers=()=>inner.closeSubscribers();
  server.on('close',()=>inner.closeSubscribers());
  return server;
}
