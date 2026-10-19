// 三维 Watch S3：屏幕画面、两次短振、抬腕亮屏都由共享状态驱动。
// 点表盘 = 抬腕；点通知上的“在手机上打开” = 手机弹出确认窗口。
import * as THREE from 'three';
import { GLTFLoader } from './vendor/loaders/GLTFLoader.js';
import { OrbitControls } from './vendor/controls/OrbitControls.js';

export function createWatch(container, { onAction, onReady } = {}) {
  let view = null, model = null, screenMesh = null, last = 0, buzzAt = -1e9, wakeAt = -1e9, lastInteraction = 0;
  let seq = { notify: null, buzz: null, wake: null };
  const screen = new window.WatchS3Screen({
    size: 932,
    onOpenPhone: () => onAction?.('watch.openPhone'),
    onTap: ({ mode, top }) => {
      if (mode === 'face') onAction?.('watch.raise');
      else if (top) onAction?.('watch.dismiss');
    },
  });
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1;
  renderer.setClearColor(0, 0);
  renderer.domElement.className = 'model-canvas';
  renderer.domElement.setAttribute('role', 'img');
  renderer.domElement.setAttribute('aria-label', 'Watch S3 三维模型。点表盘抬腕亮屏，点通知上的“在手机上打开”在手机确认。');
  container.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, .1, 1800); camera.position.set(10, 4, 190);
  const controls = new OrbitControls(camera, renderer.domElement);
  Object.assign(controls, { enableDamping: true, dampingFactor: .075, enablePan: false, enableZoom: false, rotateSpeed: .6, minDistance: 70, maxDistance: 450 });
  controls.addEventListener('start', () => { lastInteraction = performance.now(); });
  {
    const room = new THREE.Scene(); room.background = new THREE.Color(0x65645e);
    room.add(new THREE.Mesh(new THREE.BoxGeometry(800, 800, 800), new THREE.MeshBasicMaterial({ color: 0x70746b, side: THREE.BackSide })));
    [[-160, 120, 160, 110, 250, 5], [200, 20, 90, 70, 330, 3.8], [0, -220, 60, 320, 50, 2.2]].forEach(([x, y, z, w, h, i]) => {
      const light = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(i, i, i) }));
      light.position.set(x, y, z); light.lookAt(0, 0, 0); room.add(light);
    });
    const pmrem = new THREE.PMREMGenerator(renderer); scene.environment = pmrem.fromScene(room, .025, .1, 1200).texture; pmrem.dispose();
  }
  scene.add(new THREE.HemisphereLight(0xfff5e6, 0x77786b, 1.5));
  const key = new THREE.DirectionalLight(0xfff4e3, 3.4); key.position.set(-60, 95, 120); scene.add(key);
  const rim = new THREE.DirectionalLight(0xc4d3de, 2.2); rim.position.set(90, 15, -40); scene.add(rim);
  const rig = new THREE.Group(); scene.add(rig);
  const texture = new THREE.CanvasTexture(screen.canvas);
  texture.colorSpace = THREE.SRGBColorSpace; texture.flipY = false; texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const screenMaterial = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false, side: THREE.DoubleSide });

  function resize() {
    const { width, height } = container.getBoundingClientRect();
    if (width < 2 || height < 2) return;
    camera.aspect = width / height; camera.updateProjectionMatrix(); renderer.setSize(width, height, false);
    camera.position.setLength(camera.aspect < .8 ? 250 : 215);
  }
  new ResizeObserver(resize).observe(container);

  new GLTFLoader().loadAsync('./models/watch-s3.glb').then(asset => {
    model = asset.scene;
    model.traverse(object => {
      if (!object.isMesh) return;
      if (object.name.includes('WatchS3_Display')) screenMesh = object;
      (Array.isArray(object.material) ? object.material : [object.material]).forEach(m => { if (m.metalness > .5) m.envMapIntensity = 1.15; });
    });
    if (!screenMesh) throw new Error('模型缺少圆形屏幕');
    screenMesh.material = screenMaterial;
    rig.add(model); rig.rotation.set(-.04, -.12, -.025);
    resize(); onReady?.();
  }).catch(error => { container.dataset.error = String(error?.message || error); onReady?.(error); });

  const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();
  let down = null;
  renderer.domElement.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY }; });
  renderer.domElement.addEventListener('pointerup', e => {
    if (!screenMesh || !down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 7) return;
    down = null;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set((e.clientX - rect.left) / rect.width * 2 - 1, -(e.clientY - rect.top) / rect.height * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObject(screenMesh, false)[0];
    if (hit?.uv) screen.handleTap(hit.uv.x, hit.uv.y);
    else if (raycaster.intersectObject(rig, true).length) onAction?.('watch.raise');
  });

  function update(next) {
    view = next;
    const w = next.watch, n = w.notification;
    screen.setLive({
      med: n ? n.drugName : w.next?.name || '今日已完成', dose: n ? (n.dose ? `每次 ${n.dose}` : '') : w.next?.dose ? `每次 ${w.next.dose}` : '', time: n?.time || w.next?.time || '--:--',
      confirmedAt: w.last || '--:--', battery: w.battery, connected: w.connected,
    });
    screen.setMode(w.connected ? (w.screen === 'notification' && !n ? 'face' : w.screen) : 'face');
    if (seq.buzz !== null && w.buzzSeq !== seq.buzz) buzzAt = performance.now();
    if (seq.wake !== null && w.wakeSeq !== seq.wake) wakeAt = performance.now();
    seq = { notify: w.notifySeq, buzz: w.buzzSeq, wake: w.wakeSeq };
    container.classList.toggle('is-offline', !w.connected);
  }

  function animate(t) {
    requestAnimationFrame(animate);
    if (t - last < 1000 / 50 || document.hidden) return;
    last = t;
    if (screen.tick(t)) texture.needsUpdate = true;
    if (!model) return;
    const s = t / 1000;
    if (t - lastInteraction > 1800) {
      rig.rotation.y = -.12 + Math.sin(s * .38) * .055;
      rig.position.y = Math.sin(s * .7) * .55;
    }
    // 抬腕：表体从倾斜转向镜头；两次短振：横向高频抖动。
    const wake = t - Math.max(wakeAt, buzzAt);
    rig.rotation.x = wake >= 0 && wake < 900 ? -.04 - .32 * (1 - THREE.MathUtils.smoothstep(wake, 0, 750)) : -.04 + Math.sin(s * .55) * .035;
    const since = t - buzzAt, on = since >= 0 && (since < 280 || (since > 470 && since < 750));
    rig.position.x = on ? Math.sin(since * .22) * .9 : 0;
    rig.rotation.z = -.025 + (on ? Math.sin(since * .2) * .02 : 0);
    container.classList.toggle('is-buzzing', since >= 0 && since < 900);
    controls.update();
    renderer.render(scene, camera);
  }
  requestAnimationFrame(animate);

  return {
    update,
    snapshot: () => ({ ready: !!model, mode: screen.mode, buzzing: performance.now() - buzzAt < 900, live: screen.live }),
    tapScreen: (x, y) => screen.handleTap(x, y),
  };
}
