/** The same loopback static / read-only SSE server is used by Electron and tests. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function locatePillbankRoot(start = ROOT) {
  let directory = start;
  for (let depth = 0; depth < 8; depth++) {
    for (const candidate of ['web', 'pillbank']) {
      const root = path.join(directory, candidate);
      if (fs.existsSync(path.join(root, 'index.html')) && fs.existsSync(path.join(root, 'src', 'medication-session.js'))) return root;
    }
    const parent = path.dirname(directory); if (parent === directory) break; directory = parent;
  }
  throw new Error('向上 8 层找不到 PILLBANK 源站（web/ 或 pillbank/）');
}
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.map': 'application/json; charset=utf-8',
  '.glb': 'model/gltf-binary', '.stl': 'model/stl', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.zip': 'application/zip', '.md': 'text/plain; charset=utf-8',
};
const copy = (object) => JSON.parse(JSON.stringify(object));
export const isLoopbackOrigin = (origin) => /^http:\/\/(127\.0\.0\.1|localhost):\d{1,5}$/.test(origin || '');

export function createStaticServer({ pillbankRoot = locatePillbankRoot(), consoleRoot = path.join(ROOT, 'src', 'console'), bridgeRoot = path.join(ROOT, 'src') } = {}) {
  const bridgeId = randomUUID();
  const subscribers = new Set();
  let sequence = 0;
  const events = [];
  const state = { connection: { connected: false, stale: true, source: 'device' }, telemetry: null, operations: Object.create(null) };
  const snapshot = () => copy({ version: 1, bridgeId, state, events, lastEventId: sequence, readOnly: true });
  const send = (response, event) => response.write(`id: ${event.eventId}\ndata: ${JSON.stringify(event)}\n\n`);
  const server = http.createServer((request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      let pathname = decodeURIComponent(url.pathname);
      if (pathname.startsWith('/api/desktop-bridge/')) {
        // Only local web origins may inspect data. There is deliberately no HTTP command endpoint.
        const origin = request.headers.origin;
        if (origin && !isLoopbackOrigin(origin)) { response.writeHead(403); response.end('Only loopback web origins are allowed'); return; }
        if (request.method !== 'GET') { response.writeHead(405, { Allow: 'GET' }); response.end('Read-only bridge'); return; }
        const cors = origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {};
        if (pathname === '/api/desktop-bridge/state') {
          response.writeHead(200, { ...cors, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
          response.end(JSON.stringify(snapshot())); return;
        }
        if (pathname === '/api/desktop-bridge/events') {
          response.writeHead(200, { ...cors, 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
          response.flushHeaders();
          send(response, { kind: 'bridge.snapshot', bridgeId, eventId: sequence, source: 'desktop', timestamp: new Date().toISOString(), snapshot: snapshot() });
          subscribers.add(response);
          const heartbeat = setInterval(() => response.write(': heartbeat\n\n'), 15000); heartbeat.unref();
          response.on('close', () => { clearInterval(heartbeat); subscribers.delete(response); }); return;
        }
        response.writeHead(404); response.end('Unknown bridge route'); return;
      }
      if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405, { Allow: 'GET, HEAD' }); response.end('Read-only static server'); return; }
      let root = pillbankRoot;
      if (pathname.startsWith('/__exe__/')) { root = bridgeRoot; pathname = pathname.slice('/__exe__'.length); }
      if (pathname === '/console') pathname = '/console/';
      if (pathname.startsWith('/console/')) { root = consoleRoot; pathname = pathname.slice('/console'.length); }
      if (pathname === '/') pathname = '/index.html';
      const target = path.resolve(root, '.' + pathname);
      if (target !== root && !target.startsWith(root + path.sep)) { response.writeHead(403); response.end('Forbidden'); return; }
      if (!fs.existsSync(target) || !fs.statSync(target).isFile()) { response.writeHead(404); response.end('Not found'); return; }
      response.writeHead(200, { 'Content-Type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      if (request.method === 'HEAD') response.end(); else fs.createReadStream(target).pipe(response);
    } catch { response.writeHead(400); response.end('Bad request'); }
  });
  server.publish = (payload) => {
    if (!payload || typeof payload !== 'object' || typeof payload.kind !== 'string') return null;
    let event;
    try {
      if (JSON.stringify(payload).length > 100000) return null;
      event = copy({ ...payload, bridgeId, eventId: ++sequence, timestamp: payload.timestamp || new Date().toISOString() });
    } catch { return null; }
    events.push(event); if (events.length > 200) events.shift();
    if (event.kind === 'connection') {
      state.connection = { ...event, stale: !event.connected };
      if (!event.connected && state.telemetry) state.telemetry = { ...state.telemetry, stale: true };
      if (event.connected) state.telemetry = null; // Old data is not made fresh by a new link.
    }
    if (event.kind === 'telemetry') state.telemetry = { ...event, stale: event.stale === true || !state.connection.connected };
    if (event.kind === 'operation' && event.correlationId) {
      state.operations[event.correlationId] = event;
      const ids = Object.keys(state.operations); if (ids.length > 100) delete state.operations[ids[0]];
    }
    for (const response of subscribers) { try { send(response, event); } catch { subscribers.delete(response); } }
    return event;
  };
  server.snapshot = snapshot;
  server.closeSubscribers = () => { for (const response of subscribers) response.end(); subscribers.clear(); };
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createStaticServer();
  server.listen(0, '127.0.0.1', async () => {
    const base = `http://127.0.0.1:${server.address().port}`;
    const checks = [['/', 'PILLBANK'], ['/src/main.js', 'import'], ['/vendor/three/build/three.module.js', 'THREE'], ['/console/', '药盒控制台'], ['/console/transport.mjs', 'navigator.bluetooth'], ['/console/hipee07.mjs', 'buildFrame07'], ['/__exe__/bridge-inject.mjs', 'import'], ['/api/desktop-bridge/state', 'readOnly']];
    let failed = 0;
    for (const [route, needle] of checks) {
      const result = await fetch(base + route); const body = await result.text();
      const ok = result.status === 200 && body.includes(needle); if (!ok) failed++;
      console.log(`${ok ? 'PASS' : 'FAIL'} ${route} status=${result.status}`);
    }
    server.close(); process.exitCode = failed ? 1 : 0;
  });
}
