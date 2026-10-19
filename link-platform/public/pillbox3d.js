// 三维 PB1 药盒：不再播放固定动画，而是由共享状态逐个驱动外盖、四个药仓、药片、
// 屏幕、指示灯、震动和实体确认键。点击模型会发出与手机相同的操作。
import * as THREE from 'three';
import { GLTFLoader } from './vendor/loaders/GLTFLoader.js';
import { OrbitControls } from './vendor/controls/OrbitControls.js';

const OUTER_OPEN = new THREE.Quaternion(-0.8192, 0, 0, 0.5736).normalize();
const INNER_OPEN = new THREE.Quaternion(-0.7934, 0, 0, 0.6088).normalize();
const PRESETS = {
  gentle: { amplitude: .00028, rotation: .0014, period: 2.4, frequency: 20, bursts: [[0, .72]], ledFloor: .08, ledPeak: 2.6 },
  standard: { amplitude: .00068, rotation: .0034, period: 1.2, frequency: 26, bursts: [[0, .28], [.43, .28]], ledFloor: .04, ledPeak: 4.0 },
  strong: { amplitude: .00125, rotation: .0065, period: .72, frequency: 34, bursts: [[0, .18], [.24, .18]], ledFloor: .02, ledPeak: 5.6 },
};
const AMBER = new THREE.Color('#f3a33b'), GREEN = new THREE.Color('#72ad70'), RED = new THREE.Color('#e5483b');
// 误开药仓：红灯慢闪 + 轻微短震（幅度低于“轻柔”档）
const WRONG = { amplitude: .00022, rotation: .0011, period: 1.6, frequency: 22, bursts: [[0, .16], [.22, .16]], ledFloor: .15, ledPeak: 3.6 };
const norm = name => name.toLowerCase().replaceAll('_', ' ');

export function createPillbox(container, { onAction, onReady } = {}) {
  let view = null, ready = false, elapsed = 0, lastFrame = null, effectKey = '';
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.setClearColor(0, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = .95;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.className = 'model-canvas';
  renderer.domElement.setAttribute('role', 'img');
  renderer.domElement.setAttribute('aria-label', 'PB1 智能药盒三维模型。点外盖开合，点药仓盖开仓，点药片取药，点左侧按键确认。');
  container.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, .001, 20);
  const controls = new OrbitControls(camera, renderer.domElement);
  Object.assign(controls, { enableDamping: true, dampingFactor: .075, enablePan: false, maxPolarAngle: Math.PI * .48, minPolarAngle: Math.PI * .07 });
  scene.add(new THREE.HemisphereLight(0xfff8ea, 0xa99e8b, 1.8));
  const key = new THREE.DirectionalLight(0xfff9ef, 2.8); key.position.set(-.18, .4, .22); key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048); Object.assign(key.shadow.camera, { left: -.25, bottom: -.25, right: .25, top: .25, near: .01, far: 2 });
  key.shadow.normalBias = .0002; key.shadow.bias = -.00005; key.shadow.radius = 3; scene.add(key);
  const rim = new THREE.DirectionalLight(0xffffff, 1.35); rim.position.set(.2, .18, -.23); scene.add(rim);
  const fill = new THREE.DirectionalLight(0xffe6c2, .5); fill.position.set(.28, .09, .12); scene.add(fill);
  {
    const studio = new THREE.Scene(); studio.background = new THREE.Color(0x938b7f);
    [[[-3, 3.5, 2], [4.5, 3.5], [3.2, 3.0, 2.7]], [[3, 2, -2.5], [1.3, 4.5], [2.7, 2.8, 2.8]], [[0, 5, -.5], [3.5, 2], [2.8, 2.7, 2.5]]].forEach(([p, s, c]) => {
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(...s), new THREE.MeshBasicMaterial({ color: new THREE.Color(...c), side: THREE.DoubleSide, toneMapped: false }));
      panel.position.set(...p); panel.lookAt(0, 0, 0); studio.add(panel);
    });
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(studio, .06, .1, 30).texture; scene.environmentIntensity = .36; pmrem.dispose();
  }
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShadowMaterial({ color: 0x685341, opacity: .14 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -.001; floor.receiveShadow = true; scene.add(floor);

  const rig = new THREE.Group(); scene.add(rig);
  const parts = { outer: null, inner: [], pills: [[], [], [], []], leds: [], button: null, screen: null };
  let extent = .2, size = new THREE.Vector3();
  const screenCanvas = document.createElement('canvas'); screenCanvas.width = 480; screenCanvas.height = 640;
  const screenTexture = new THREE.CanvasTexture(screenCanvas);
  screenTexture.flipY = false; screenTexture.colorSpace = THREE.SRGBColorSpace;
  let screenSignature = '';

  // 指示灯光晕与震动波纹，与 R4 查看器效果一致，但跟随任意药仓。
  const glow = document.createElement('canvas'); glow.width = glow.height = 128;
  { const g = glow.getContext('2d'), gradient = g.createRadialGradient(64, 64, 3, 64, 64, 64);
    gradient.addColorStop(0, 'rgba(255,255,255,1)'); gradient.addColorStop(.17, 'rgba(255,255,255,.82)'); gradient.addColorStop(.42, 'rgba(255,255,255,.24)'); gradient.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gradient; g.fillRect(0, 0, 128, 128); }
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(glow), color: AMBER, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }));
  halo.scale.setScalar(.013); halo.visible = false; scene.add(halo);
  const lamp = new THREE.PointLight(AMBER, 0, .024, 2); scene.add(lamp);
  const waves = [0, 1].map(() => {
    const points = Array.from({ length: 81 }, (_, i) => { const a = i / 80 * Math.PI * 2; return new THREE.Vector3(Math.cos(a) * .103, .0003, Math.sin(a) * .047); });
    const wave = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: 0xbd7b42, transparent: true, opacity: 0, depthWrite: false }));
    wave.visible = false; scene.add(wave); return wave;
  });

  function frame() {
    const distance = extent * (camera.aspect < .9 ? 2.4 : camera.aspect < 1.3 ? 1.85 : 1.6);
    controls.target.set(0, Math.max(size.y * .45, extent * .14), 0);
    camera.position.copy(new THREE.Vector3(-.63, .72, .78).normalize().multiplyScalar(distance).add(controls.target));
    controls.update();
  }
  function resize() {
    const { width, height } = container.getBoundingClientRect();
    if (width < 2 || height < 2) return;
    camera.aspect = width / height; camera.updateProjectionMatrix(); renderer.setSize(width, height, false);
    if (ready) frame();
  }
  new ResizeObserver(resize).observe(container);

  new GLTFLoader().load('./models/pillbox.glb', gltf => {
    const model = gltf.scene;
    model.traverse(object => {
      if (!object.isMesh && !object.isObject3D) return;
      const name = norm(object.name);
      if (object.isMesh) { object.castShadow = object.receiveShadow = true; }
      if (name === 'outer lid | rear illustrative hinge') parts.outer = { node: object, base: object.quaternion.clone(), open: object.quaternion.clone().multiply(OUTER_OPEN), t: 0 };
      let match = name.match(/^inner lid ([1-4]) \| pivot$/);
      if (match) parts.inner[match[1] - 1] = { node: object, base: object.quaternion.clone(), open: object.quaternion.clone().multiply(INNER_OPEN), t: 0 };
      // three.js 会去掉节点名中的点号：“pill 2.1” 载入后是 “pill 21”。
      match = name.match(/^illustrative pill ([1-4])\.?\d$/);
      if (match && object.isMesh) parts.pills[match[1] - 1].push({ node: object, position: object.position.clone(), scale: object.scale.clone(), t: 0 });
      match = name.match(/^indicator ([1-4]) \| unlit$/);
      if (match && object.isMesh) {
        object.material = object.material.clone();
        parts.leds[match[1] - 1] = { mesh: object, material: object.material, base: { color: object.material.color.clone(), emissive: object.material.emissive.clone(), intensity: object.material.emissiveIntensity, roughness: object.material.roughness, metalness: object.material.metalness } };
      }
      if (name === 'physical confirm button') parts.button = { node: object, y: object.position.y, press: 0 };
      if (/^screen [1-6] \|/.test(name)) object.visible = false;
      if (/^compartment 2 \| (amber status|green confirmation)$/.test(name)) object.visible = false;
      if (name === 'screen 0 | standby' && object.isMesh) {
        const material = object.material.clone();
        material.emissiveMap = screenTexture; material.emissive.setRGB(1, 1, 1); material.emissiveIntensity = 1;
        material.color.setRGB(0, 0, 0); object.material = material; parts.screen = object;
      }
    });
    const wrapper = new THREE.Group(); wrapper.add(model);
    const bounds = new THREE.Box3().setFromObject(model);
    const center = bounds.getCenter(new THREE.Vector3()); bounds.getSize(size);
    wrapper.position.set(-center.x, -bounds.min.y, -center.z);
    rig.add(wrapper);
    extent = Math.max(size.x, size.y * 1.25, size.z);
    controls.minDistance = extent * .32; controls.maxDistance = extent * 5;
    ready = true; resize(); frame();
    if (view) paintScreen(true);
    onReady?.();
  }, undefined, error => { container.dataset.error = String(error?.message || error); onReady?.(error); });

  // 拖动不算点击；点击命中哪一个零件，就发出对应的真实操作。
  const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();
  let down = null;
  // 在三维屏幕上横向滑动 = 药盒触摸屏左滑 / 右滑（左滑仅振动、右滑休眠）
  let swipe = null;
  const hitsScreen = event => {
    if (!ready || !parts.screen) return false;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    return raycaster.intersectObject(parts.screen, false).length > 0;
  };
  container.addEventListener('pointerdown', event => {
    if (event.target !== renderer.domElement || !hitsScreen(event)) return;
    swipe = { x: event.clientX, y: event.clientY, id: event.pointerId };
    controls.enabled = false;
  }, true);
  addEventListener('pointerup', event => {
    if (!swipe || event.pointerId !== swipe.id) return;
    const dx = event.clientX - swipe.x, dy = event.clientY - swipe.y;
    swipe = null; controls.enabled = true;
    if (Math.abs(dx) > 28 && Math.abs(dx) > Math.abs(dy) * 1.2) { down = null; container.dataset.lastHit = 'screen swipe ' + (dx < 0 ? 'left' : 'right'); onAction?.('box.swipe', { dir: dx < 0 ? 'left' : 'right' }); }
  });
  renderer.domElement.addEventListener('pointerdown', event => { down = { x: event.clientX, y: event.clientY }; });
  renderer.domElement.addEventListener('pointerup', event => {
    if (!ready || !down || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 6) return;
    down = null;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    // 已打开药仓里的药片很小，且可能被屏幕模组挡住：在其投影 30px 内点击即视为取药。
    if (view?.box.outer) {
      scene.updateMatrixWorld(true);
      for (let i = 0; i < 4; i++) {
        const pill = parts.pills[i][0];
        if (!pill || !view.box.inner[i] || view.box.removed[i]) continue;
        const p = new THREE.Box3().setFromObject(pill.node).getCenter(new THREE.Vector3()).project(camera);
        const px = (p.x * .5 + .5) * rect.width, py = (-p.y * .5 + .5) * rect.height;
        if (Math.hypot(px - (event.clientX - rect.left), py - (event.clientY - rect.top)) < 30) { container.dataset.lastHit = `pill ${i + 1} (near)`; onAction?.('box.take', { n: i + 1 }); return; }
      }
    }
    const hit = raycaster.intersectObject(rig, true)[0]?.object;
    if (!hit) return;
    let names = ''; for (let object = hit; object; object = object.parent) names += ' ' + norm(object.name);
    container.dataset.lastHit = names.trim().slice(0, 160);
    let match;
    if ((match = names.match(/illustrative pill ([1-4])/))) onAction?.('box.take', { n: Number(match[1]) });
    else if ((match = names.match(/inner (?:lid|tab|hinge) ([1-4])|compartment number ([1-4])/))) onAction?.('box.inner', { n: Number(match[1] || match[2]) });
    else if (/confirm (?:button|key|switch)/.test(names)) onAction?.('box.button'); // 两次点击间隔 < 0.6 秒即为双击，由服务端判定
    else if (/outer lid|lid inner inset|lid front|moving lid guard/.test(names)) onAction?.('box.lid');
  });

  // ---------- 屏幕：实时绘制当前计划，而不是固定贴图 ----------
  const SCREEN = { bg: '#0c1813', bar: '#12221a', ink: '#f1ead9', muted: '#9fb1a6', amber: '#f0a85a', chip: '#4a3322', green: '#93d6a8' };
  const FONT = '"AnYao Sans","MiSans","Microsoft YaHei",sans-serif';
  function paintScreen(force = false) {
    if (!view) return;
    const box = view.box, s = box.session, next = box.next, modes = box.modes || {};
    const n = s?.compartment || next?.compartment;
    const signature = JSON.stringify([box.screen, view.clock, s, next, box.last, box.lastDose, modes, box.battery, document.fonts?.status]);
    if (!force && signature === screenSignature) return;
    screenSignature = signature;
    const c = screenCanvas.getContext('2d');
    c.setTransform(2, 0, 0, 2, 0, 0);
    c.fillStyle = SCREEN.bg; c.fillRect(0, 0, 240, 320);
    const text = (value, x, y, size, color = SCREEN.ink, weight = 400) => { c.font = `${weight} ${size}px ${FONT}`; c.fillStyle = color; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(value, x, y); };
    const moon = (x, y, r, color) => { c.fillStyle = color; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); c.fillStyle = SCREEN.bg; c.beginPath(); c.arc(x + r * .45, y - r * .3, r * .85, 0, Math.PI * 2); c.fill(); };
    // 页码点：0 休眠 · 1 主页 · 2 仅振动
    const dots = i => { for (let k = 0; k < 3; k++) { c.fillStyle = k === i ? SCREEN.ink : '#ffffff30'; c.beginPath(); c.arc(108 + k * 12, 256, k === i ? 3.2 : 2.6, 0, Math.PI * 2); c.fill(); } };
    // 其他页底部：上次 / 下次（含药仓）一直在
    const homeRows = () => {
      c.fillStyle = SCREEN.bar; c.fillRect(0, 266, 240, 54); c.fillStyle = '#ffffff10'; c.fillRect(16, 266, 208, 1);
      c.textBaseline = 'middle';
      const l = box.lastDose, nx = box.next;
      c.font = `400 12px ${FONT}`; c.fillStyle = SCREEN.muted; c.textAlign = 'left'; c.fillText('上次', 18, 282); c.fillText('下次', 128, 282);
      c.font = `300 18px ${FONT}`; c.fillStyle = SCREEN.ink;
      c.fillText(l ? `${l.time}${l.compartment ? ` ${l.compartment}仓` : ''}` : '--:--', 18, 304);
      c.fillText(nx ? `${nx.time} ${nx.compartment}仓` : '--:--', 128, 304);
    };
    const chip = label => { c.fillStyle = SCREEN.chip; c.beginPath(); c.roundRect(70, 207, 100, 38, 19); c.fill(); text(label, 120, 227, 19, SCREEN.amber); };
    c.strokeStyle = SCREEN.muted; c.lineWidth = 1.4; c.strokeRect(205, 21, 14, 7); c.fillStyle = SCREEN.green; c.fillRect(207, 23, 10 * (box.battery / 100), 3);
    c.fillStyle = box.connected ? SCREEN.green : SCREEN.muted; c.fillRect(22, 21, 2, 8); c.fillRect(26, 18, 2, 11);
    const drawBox = (y, open, highlight) => {
      c.strokeStyle = SCREEN.green; c.lineWidth = 2;
      c.beginPath(); c.roundRect(87, y + 20, 66, 34, 5); c.stroke();
      for (let i = 1; i < 4; i++) { c.beginPath(); c.moveTo(87 + i * 16.5, y + 26); c.lineTo(87 + i * 16.5, y + 50); c.stroke(); }
      if (open) { c.beginPath(); c.moveTo(87, y + 16); c.lineTo(93, y); c.lineTo(147, y); c.lineTo(153, y + 16); c.closePath(); c.stroke(); }
      else { c.beginPath(); c.roundRect(86, y + 12, 68, 8, 3); c.stroke(); }
      if (highlight) { c.strokeStyle = SCREEN.amber; c.beginPath(); c.roundRect(87 + (highlight - 1) * 16.5 + 3, y + 27, 10.5, 21, 3); c.stroke(); }
    };
    switch (box.screen) {
      case 'reminder':
        c.fillStyle = SCREEN.amber; c.beginPath(); c.roundRect(106, 47, 28, 14, 7); c.fill(); c.fillStyle = '#fff3e0'; c.fillRect(120, 49, 11, 10);
        text('该吃药了', 120, 100, 27); text(s.time, 120, 160, 46, SCREEN.ink, 300); chip(`${n}号仓`); break;
      case 'open': drawBox(62, true, n); text(`打开${n}号仓`, 120, 182, 26); text(s.drugName || '', 120, 222, 15, SCREEN.muted); break;
      case 'take': drawBox(62, true, n); text('取出药片', 120, 168, 26); text(s.drugName || '', 120, 204, 15, SCREEN.muted); chip(`${n}号仓`); break;
      case 'awaiting': drawBox(62, true, n); text('取药后请确认', 120, 168, 23); text('服用后在手机点“我吃了”', 120, 210, 15, SCREEN.muted); break;
      case 'confirmed':
        c.fillStyle = '#21452f'; c.beginPath(); c.arc(120, 86, 27, 0, Math.PI * 2); c.fill();
        c.strokeStyle = SCREEN.green; c.lineWidth = 4; c.lineCap = 'round'; c.beginPath(); c.moveTo(107, 87); c.lineTo(117, 97); c.lineTo(134, 77); c.stroke();
        text('已确认服用', 120, 160, 25, SCREEN.green); text(s.confirmed || '', 120, 212, 36, SCREEN.ink, 300); break;
      case 'closing': drawBox(70, false, 0); text('请合上药盒', 120, 190, 26); break;
      case 'wrong': {
        const w = box.wrong;
        c.fillStyle = '#4a1d1a'; c.beginPath(); c.arc(120, 62, 22, 0, Math.PI * 2); c.fill();
        c.fillStyle = '#ff8a7a'; c.font = `600 28px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('!', 120, 63);
        text(`${w.compartment}号仓 ${w.drugName || ''}`.trim(), 120, 106, 17, SCREEN.ink);
        text('当前药非当前时段', 120, 140, 21, '#ff9b8c', 500);
        text('是否确认服用？', 120, 172, 21, SCREEN.ink);
        c.fillStyle = '#20302a'; c.beginPath(); c.roundRect(22, 198, 92, 42, 12); c.fill(); c.beginPath(); c.roundRect(126, 198, 92, 42, 12); c.fill();
        text('单击', 68, 212, 13, SCREEN.muted); text('取消', 68, 229, 16, SCREEN.ink);
        text('双击', 172, 212, 13, SCREEN.muted); text('确认', 172, 229, 16, SCREEN.green);
        break;
      }
      case 'unpaired': text('HiPee', 120, 110, 30, SCREEN.ink, 300); text(box.outer ? '已唤醒，等待手机连接' : '打开外盖唤醒', 120, 160, 17, box.outer ? SCREEN.amber : SCREEN.muted); text(box.outer ? '手机上选择这个药盒' : '手机会自动弹出连接', 120, 188, 15, SCREEN.muted); break;
      case 'vibrate': { // 左滑页：仅振动
        const on = modes.vibrateOnly;
        c.strokeStyle = on ? SCREEN.amber : SCREEN.muted; c.lineWidth = 3; c.lineCap = 'round';
        c.beginPath(); c.roundRect(108, 50, 24, 40, 5); c.stroke();
        for (const side of [-1, 1]) for (const r of [20, 28]) { c.beginPath(); c.arc(120, 70, r, side < 0 ? Math.PI * .8 : -Math.PI * .2, side < 0 ? Math.PI * 1.2 : Math.PI * .2); c.stroke(); }
        text('仅振动', 120, 122, 25);
        text(on ? `已开启 · ${modes.levelName}` : `强度 ${modes.levelName}`, 120, 152, 16, on ? SCREEN.amber : SCREEN.muted);
        text('到点只震动，不亮灯', 120, 176, 13, SCREEN.muted);
        c.fillStyle = on ? '#20302a' : SCREEN.chip; c.beginPath(); c.roundRect(42, 200, 156, 44, 22); c.fill();
        text(on ? '按键 · 关闭' : '按键 · 开启', 120, 222, 18, on ? SCREEN.ink : SCREEN.amber, 500);
        dots(2); break;
      }
      case 'sleep': { // 右滑页：休眠
        const s = modes.sleep;
        moon(120, 70, 22, SCREEN.green);
        text(s ? '休眠中' : '休眠', 120, 122, 25);
        text(s ? `到 ${s.until} 醒来` : `休眠 ${modes.napMinutes} 分钟`, 120, 152, 16, SCREEN.muted);
        text('期间到点不提醒，醒后再提醒', 120, 176, 13, SCREEN.muted);
        c.fillStyle = s ? SCREEN.chip : '#20302a'; c.beginPath(); c.roundRect(42, 200, 156, 44, 22); c.fill();
        text(s ? '按键 · 结束休眠' : '按键 · 进入休眠', 120, 222, 18, s ? SCREEN.amber : SCREEN.green, 500);
        dots(0); break;
      }
      case 'asleep': { // 休眠中的主页：暗屏，只留时间和醒来时间
        const s = modes.sleep;
        text(view.clock, 120, 92, 44, '#8fa198', 300);
        moon(68, 150, 11, SCREEN.green);
        c.font = `400 16px ${FONT}`; c.fillStyle = SCREEN.muted; c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillText(`休眠到 ${s?.until || ''}`, 88, 150);
        text(s?.held ? `醒来后提醒 ${s.held} 次没吃的药` : '睡醒后再提醒', 120, 186, 14, s?.held ? SCREEN.amber : SCREEN.muted);
        text('右滑 · 按键结束休眠', 120, 222, 12, '#5d6f66');
        homeRows(); break;
      }
      default: { // 主页：始终显示现在时间、上次 / 下次服用时间和药仓
        text(view.clock, 120, 78, 46, SCREEN.ink, 300);
        text(view.date ? `${Number(view.date.slice(5, 7))}月${Number(view.date.slice(8))}日` : '', 120, 112, 13, SCREEN.muted);
        const card = (y, label, item, empty, accent) => {
          c.fillStyle = '#132219'; c.beginPath(); c.roundRect(16, y, 208, 54, 12); c.fill();
          c.font = `400 13px ${FONT}`; c.fillStyle = SCREEN.muted; c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillText(label, 28, y + 18);
          if (!item) { c.font = `400 14px ${FONT}`; c.fillStyle = SCREEN.muted; c.fillText(empty, 28, y + 38); return; }
          c.font = `300 24px ${FONT}`; c.fillStyle = SCREEN.ink; c.fillText(item.time, 28, y + 38);
          if (item.compartment) { c.fillStyle = accent ? SCREEN.chip : '#20302a'; c.beginPath(); c.roundRect(150, y + 15, 62, 26, 13); c.fill(); text(`${item.compartment}号仓`, 181, y + 28, 14, accent ? SCREEN.amber : SCREEN.green); }
        };
        card(130, '上次服用', box.lastDose, '今天还没吃');
        card(192, '下次服用', next, box.plans.length ? '今日已完成' : '还没有计划', true);
        if (box.paired) dots(1);
      }
    }
    if (!['vibrate', 'sleep', 'asleep', 'standby', 'unpaired'].includes(box.screen)) homeRows();
    // 状态图标：仅振动 / 休眠
    if (modes.vibrateOnly) { c.strokeStyle = SCREEN.amber; c.lineWidth = 1.6; c.beginPath(); c.roundRect(176, 19, 6, 11, 1.5); c.stroke(); c.beginPath(); c.moveTo(172, 21); c.lineTo(172, 28); c.moveTo(186, 21); c.lineTo(186, 28); c.stroke(); }
    if (modes.sleep) moon(160, 24, 6, SCREEN.green);
    screenTexture.needsUpdate = true;
  }
  document.fonts?.ready.then(() => paintScreen(true));

  let lastButtonSeq = null;
  function update(next) {
    view = next;
    if (lastButtonSeq !== null && next.box.buttonSeq !== lastButtonSeq && parts.button) parts.button.press = 1;
    lastButtonSeq = next.box.buttonSeq;
    paintScreen();
  }

  function burst(preset) {
    const time = elapsed % preset.period;
    for (const [start, length] of preset.bursts) if (time >= start && time < start + length) return Math.sin((time - start) / length * Math.PI);
    return 0;
  }
  const ease = t => t * t * (3 - 2 * t);
  function approach(part, target, delta, seconds) { part.t += Math.sign(target - part.t) * Math.min(Math.abs(target - part.t), delta / seconds); return ease(part.t); }

  renderer.setAnimationLoop(now => {
    const delta = lastFrame === null ? 0 : Math.min((now - lastFrame) / 1000, .1); lastFrame = now;
    if (ready && view) {
      const box = view.box;
      if (parts.outer) parts.outer.node.quaternion.slerpQuaternions(parts.outer.base, parts.outer.open, approach(parts.outer, box.outer ? 1 : 0, delta, .85));
      parts.inner.forEach((lid, i) => lid && lid.node.quaternion.slerpQuaternions(lid.base, lid.open, approach(lid, box.outer && box.inner[i] ? 1 : 0, delta, .5)));
      parts.pills.forEach((pills, i) => pills.forEach((pill, j) => {
        const target = box.removed[i] ? 1 : 0;
        pill.t += Math.sign(target - pill.t) * Math.min(Math.abs(target - pill.t), delta / (target ? 1.1 : .01));
        const lift = Math.min(pill.t / .6, 1), vanish = Math.max(0, (pill.t - .6) / .4);
        // 只有本次计划要取的那一片离开药仓，另一片保留在仓内。
        if (j > 0) return;
        pill.node.position.copy(pill.position); pill.node.position.y += ease(lift) * 17;
        pill.node.scale.copy(pill.scale).multiplyScalar(1 - ease(vanish));
      }));
      if (parts.button) {
        parts.button.press = Math.max(0, parts.button.press - delta * 2.6);
        parts.button.node.position.y = parts.button.y - .38 * Math.sin(Math.min(parts.button.press, 1) * Math.PI);
      }
      // 震动与灯效
      const effect = box.effect, settings = box.fx, preset = effect === 'wrong' ? WRONG : PRESETS[settings.mode] || PRESETS.standard;
      const keyNow = effect + (box.session?.time || '');
      if (keyNow !== effectKey) { effectKey = keyNow; elapsed = 0; }
      elapsed += delta;
      const reminding = effect === 'reminder' || effect === 'preview' || effect === 'find' || effect === 'wrong';
      const level = reminding ? burst(preset) : effect === 'confirmed' ? .78 : effect === 'awaiting' ? .46 : 0;
      const vibrate = reminding && settings.vibration;
      rig.position.set(0, 0, 0); rig.quaternion.identity();
      if (vibrate) {
        const o = Math.sin(elapsed * Math.PI * 2 * preset.frequency), x = Math.sin(elapsed * Math.PI * 2 * preset.frequency * .83 + .7);
        rig.position.set(o * preset.amplitude * level, Math.abs(x) * preset.amplitude * .12 * level, x * preset.amplitude * .38 * level);
        rig.quaternion.setFromEuler(new THREE.Euler(x * preset.rotation * .3 * level, o * preset.rotation * .4 * level, o * preset.rotation * level));
      }
      const target = box.target;
      const lit = settings.led && effect !== 'off';
      const color = effect === 'confirmed' ? GREEN : effect === 'wrong' ? RED : AMBER;
      const strength = reminding ? preset.ledFloor + level * preset.ledPeak : effect === 'confirmed' ? 2.7 : 1.6;
      parts.leds.forEach((led, i) => {
        if (!led) return;
        const m = led.material, on = lit && (target === 0 || i === target - 1);
        m.color.copy(led.base.color); m.emissive.copy(led.base.emissive); m.emissiveIntensity = led.base.intensity; m.roughness = led.base.roughness; m.metalness = led.base.metalness;
        if (on) { m.color.lerp(color, reminding ? Math.max(.04, level) : 1); m.emissive.copy(color); m.emissiveIntensity = strength; m.roughness = .18; m.metalness = 0; }
      });
      rig.updateMatrixWorld(true);
      if (lit && parts.leds[Math.max(target, 1) - 1]) {
        const p = new THREE.Box3().setFromObject(parts.leds[Math.max(target, 1) - 1].mesh).getCenter(new THREE.Vector3());
        halo.position.copy(p).add(new THREE.Vector3(0, .0007, .001)); lamp.position.copy(halo.position);
        halo.visible = true; halo.material.color.copy(color); halo.material.opacity = reminding ? .02 + level * .68 : .11 + level * .59;
        halo.scale.setScalar(.010 + level * .009); lamp.color.copy(color); lamp.intensity = strength * .000035;
      } else { halo.visible = false; lamp.intensity = 0; }
      waves.forEach((wave, i) => {
        const cycle = ((elapsed / preset.period) + i * .5) % 1;
        wave.visible = vibrate; wave.scale.setScalar(1 + cycle * .1);
        wave.material.opacity = vibrate ? Math.max(0, 1 - cycle) * .18 * Math.max(level, .15) : 0;
      });
      if (view.box.screen === 'standby') paintScreen();
    }
    controls.update();
    renderer.render(scene, camera);
  });

  return {
    update, frame,
    // 测试用：返回某个零件在画布上的屏幕坐标，便于验证“直接点模型”。
    project(kind, n = 1) {
      const node = kind === 'outer' ? rig.getObjectByName('PB1_blank_outer_lid_|_no_logo') || parts.outer?.node : kind === 'inner' ? parts.inner[n - 1]?.node : kind === 'pill' ? parts.pills[n - 1][0]?.node : kind === 'screen' ? parts.screen : parts.button?.node;
      if (!node) return null;
      scene.updateMatrixWorld(true);
      const p = new THREE.Box3().setFromObject(node).getCenter(new THREE.Vector3()).project(camera);
      const r = renderer.domElement.getBoundingClientRect();
      return { x: r.left + (p.x * .5 + .5) * r.width, y: r.top + (-p.y * .5 + .5) * r.height };
    },
    focusScreen() {
      if (!parts.screen) return;
      const p = parts.screen.getWorldPosition(new THREE.Vector3());
      controls.target.copy(p); camera.position.copy(p).add(new THREE.Vector3(-.004, .105, .05)); controls.update();
    },
    snapshot: () => ({
      ready, outer: parts.outer?.t, inner: parts.inner.map(lid => lid?.t), pills: parts.pills.map(list => list[0]?.t ?? null),
      leds: parts.leds.map(led => ({ intensity: led?.material.emissiveIntensity, color: led?.material.emissive.getHexString() })),
      halo: halo.visible, rigOffset: rig.position.toArray(), button: parts.button?.press, screenSignature,
    }),
  };
}
