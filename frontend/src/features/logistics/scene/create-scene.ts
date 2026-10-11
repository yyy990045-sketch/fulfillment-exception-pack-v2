import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { MapNode, MapRoute } from '../types';
import { addPackingObjects, type PackingInput, type PackingState } from '../../city-delivery/packing-objects';

function shadowed(object: THREE.Group): THREE.Group {
  object.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
  return object;
}

// 轮胎：真实胎肩 + 轮辋 + 轮毂 + 螺栓（前单胎 / 后双胎不同宽度）
function buildWheel(radius: number, width: number, dual: boolean, mats: {
  tireMat: THREE.Material; rimMat: THREE.Material; hubMat: THREE.Material;
  chromeMat: THREE.Material; darkMat: THREE.Material;
}) {
  const g = new THREE.Group();
  const hw = width / 2;
  const shoulder = Math.min(.08, hw * .32);
  const pts = [
    new THREE.Vector2(radius * .60, -hw),
    new THREE.Vector2(radius * .90, -hw),
    new THREE.Vector2(radius, -hw + shoulder),
    new THREE.Vector2(radius, hw - shoulder),
    new THREE.Vector2(radius * .90, hw),
    new THREE.Vector2(radius * .60, hw),
  ];
  const tire = new THREE.Mesh(new THREE.LatheGeometry(pts, 30), mats.tireMat);
  tire.rotation.x = Math.PI / 2;
  g.add(tire);
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(radius * .7, radius * .7, width * .96, 26), mats.rimMat);
  rim.rotation.x = Math.PI / 2;
  g.add(rim);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(radius * .26, radius * .26, width * 1.04, 18), mats.hubMat);
  hub.rotation.x = Math.PI / 2;
  g.add(hub);
  for (let i = 0; i < 8; i += 1) {
    const a = (i / 8) * Math.PI * 2;
    const lug = new THREE.Mesh(new THREE.CylinderGeometry(radius * .042, radius * .042, width * 1.08, 8), mats.chromeMat);
    lug.rotation.x = Math.PI / 2;
    lug.position.set(Math.cos(a) * radius * .38, Math.sin(a) * radius * .38, 0);
    g.add(lug);
  }
  if (dual) {
    const seam = new THREE.Mesh(new THREE.TorusGeometry(radius * .99, .02, 6, 26), mats.darkMat);
    g.add(seam);
  }
  return g;
}

export function createTruck(accent = '#4d5c6b') {
  /* 真实米制重卡：总长 15.3m / 驾驶室顶 3.5m / 挂车顶 4.05m / 挂车宽 2.5m / 轮胎直径 1.04m
     驾驶室用挤出侧影（真实倾斜前风挡 + 倒角），挂车用圆角挤出截面，避免"方块感"。 */
  const group = new THREE.Group();

  const cabPaint = new THREE.MeshPhysicalMaterial({ color: accent, metalness: .34, roughness: .32, clearcoat: .5, clearcoatRoughness: .24 });
  const trailerPaint = new THREE.MeshStandardMaterial({ color: '#9ba2a8', metalness: .26, roughness: .44 });
  const frameDark = new THREE.MeshStandardMaterial({ color: '#232a2f', metalness: .6, roughness: .52 });
  const bumperMat = new THREE.MeshStandardMaterial({ color: '#2c3237', metalness: .38, roughness: .58 });
  const tireMat = new THREE.MeshStandardMaterial({ color: '#191d20', metalness: 0, roughness: .9 });
  const rimMat = new THREE.MeshStandardMaterial({ color: '#9ba3a9', metalness: .88, roughness: .3 });
  const hubMat = new THREE.MeshStandardMaterial({ color: '#5f676c', metalness: .8, roughness: .4 });
  const chromeMat = new THREE.MeshStandardMaterial({ color: '#a8b0b6', metalness: .92, roughness: .22 });
  const glassMat = new THREE.MeshPhysicalMaterial({ color: '#1d2f3a', metalness: .24, roughness: .05, transparent: true, opacity: .62, clearcoat: .9, envMapIntensity: 1.5 });
  const lensMat = new THREE.MeshPhysicalMaterial({ color: '#cfd8dd', metalness: .18, roughness: .12, clearcoat: .85, envMapIntensity: 1.4 });
  const steelMat = new THREE.MeshStandardMaterial({ color: '#8b9399', metalness: .84, roughness: .36 });

  const box = (x: number, y: number, z: number, w: number, h: number, d: number, mat: THREE.Material, rz = 0) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    mesh.rotation.z = rz;
    group.add(mesh);
    return mesh;
  };
  const cylinder = (x: number, y: number, z: number, r: number, len: number, mat: THREE.Material, axis: 'x' | 'z' | 'y' = 'z') => {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 20), mat);
    mesh.position.set(x, y, z);
    if (axis === 'z') mesh.rotation.x = Math.PI / 2;
    else if (axis === 'x') mesh.rotation.z = Math.PI / 2;
    group.add(mesh);
    return mesh;
  };
  const wheelMats = { tireMat, rimMat, hubMat, chromeMat, darkMat: frameDark };
  const addWheel = (x: number, z: number, width: number, dual: boolean) => {
    const wheel = buildWheel(.52, width, dual, wheelMats);
    wheel.position.set(x, .52, z);
    group.add(wheel);
  };

  /* ---------------- 驾驶室：真实侧影挤出 ---------------- */
  const shape = new THREE.Shape();
  shape.moveTo(5.40, 1.02);
  shape.lineTo(5.50, 1.24);
  shape.lineTo(5.46, 1.60);          // 前围上沿 / 风挡下沿
  shape.lineTo(5.02, 2.44);          // 倾斜前风挡
  shape.lineTo(4.28, 3.32);          // 顶盖前角
  shape.lineTo(3.16, 3.44);
  shape.lineTo(1.62, 3.42);
  shape.lineTo(1.52, 2.58);
  shape.lineTo(1.50, 1.24);
  shape.lineTo(1.56, 1.02);
  shape.closePath();
  const cabGeo = new THREE.ExtrudeGeometry(shape, { depth: 2.46, bevelEnabled: true, bevelThickness: .05, bevelSize: .05, bevelSegments: 2, steps: 1 });
  cabGeo.translate(0, 0, -1.23);
  const cab = new THREE.Mesh(cabGeo, cabPaint);
  group.add(cab);

  // 倾斜前风挡（沿真实倾角嵌入）
  const windshield = new THREE.Mesh(new THREE.BoxGeometry(.95, .07, 2.04), glassMat);
  windshield.position.set(5.21, 1.99, 0);
  windshield.rotation.z = Math.atan2(-.84, .44);
  group.add(windshield);
  box(5.10, 2.56, 0, .2, .13, 2.1, cabPaint, .18);   // 遮阳罩
  box(4.06, 2.44, 1.235, 1.62, .74, .06, glassMat);  // 侧窗
  box(4.06, 2.44, -1.235, 1.62, .74, .06, glassMat);
  box(4.06, 2.08, 1.225, 1.66, .06, .08, frameDark); // 窗下压条
  box(4.06, 2.08, -1.225, 1.66, .06, .08, frameDark);
  box(3.24, 1.62, 1.235, 1.64, .06, .05, frameDark); // 车门缝（横）
  box(3.24, 1.62, -1.235, 1.64, .06, .05, frameDark);
  box(2.60, 2.42, 1.235, .06, 1.5, .05, frameDark);  // 车门缝（竖）
  box(2.60, 2.42, -1.235, .06, 1.5, .05, frameDark);
  box(2.94, 1.92, 1.255, .17, .06, .06, chromeMat);  // 门把手
  box(2.94, 1.92, -1.255, .17, .06, .06, chromeMat);
  for (const z of [-1.235, 1.235]) {                 // 侧围特征线 + 下裙防擦条
    box(3.3, 2.02, z, 1.7, .05, .03, frameDark);
    box(3.3, 1.12, z, 2.0, .12, .04, frameDark);
  }

  // 前脸：格栅 + 保险杠 + 灯组
  box(5.44, 1.34, 0, .09, .66, 1.94, bumperMat);
  for (let i = 0; i < 5; i += 1) box(5.47, 1.08 + i * .13, 0, .05, .05, 1.86, chromeMat);
  box(5.46, .96, 0, .07, .12, 2.0, frameDark);       // 格栅上沿
  box(5.52, .72, 0, .34, .5, 2.5, bumperMat);        // 前保险杠
  box(5.55, .58, 0, .16, .16, 1.0, frameDark);       // 保险杠踏步凹口
  box(5.46, 1.05, .92, .13, .26, .58, lensMat);      // 前照灯（熄灭）
  box(5.46, 1.05, -.92, .13, .26, .58, lensMat);
  box(5.43, 1.05, .92, .06, .3, .62, frameDark);
  box(5.43, 1.05, -.92, .06, .3, .62, frameDark);
  box(5.5, .62, .7, .1, .13, .3, lensMat);           // 雾灯
  box(5.5, .62, -.7, .1, .13, .3, lensMat);

  // 后视镜 + 车门下视镜
  for (const z of [-1.42, 1.42]) {
    box(4.92, 2.42, z * .82, .06, .5, .07, frameDark);
    box(4.82, 2.78, z * 1.02, .06, .46, .24, glassMat);
    box(4.86, 2.98, z * .84, .06, .1, .16, chromeMat);
  }
  // 车顶导流罩（与顶盖一体，避免"顶了块板"）
  box(3.9, 3.52, 0, 1.7, .12, 2.3, cabPaint);
  box(4.62, 3.34, 0, .7, .22, 2.24, cabPaint, .42);

  /* ---------------- 底盘 / 行走系统 ---------------- */
  box(3.0, 1.0, .46, 5.0, .26, .24, frameDark);      // 主车架纵梁
  box(3.0, 1.0, -.46, 5.0, .26, .24, frameDark);
  for (const x of [1.0, 2.0, 3.0, 4.0, 5.0]) box(x, 1.0, 0, .12, .3, 1.3, frameDark);
  cylinder(1.3, .52, 0, .13, 1.9, frameDark);        // 后桥
  cylinder(4.7, .52, 0, .12, 1.9, frameDark);        // 前桥
  box(2.0, 1.22, 0, 1.2, .1, 1.4, frameDark);        // 第五轮鞍座
  cylinder(2.0, 1.3, 0, .22, .16, steelMat);         // 鞍座销
  cylinder(2.1, .8, 1.06, .32, 1.5, frameDark, 'x'); // 油箱
  cylinder(2.1, .8, -1.06, .32, 1.5, frameDark, 'x');
  for (const x of [1.5, 2.7]) {
    const strap = new THREE.Mesh(new THREE.TorusGeometry(.33, .022, 6, 18), steelMat);
    strap.position.set(x, .8, 1.06);
    strap.rotation.y = Math.PI / 2;
    group.add(strap);
  }
  cylinder(1.72, 2.3, 1.12, .07, 2.0, steelMat, 'y'); // 排气立管
  box(4.3, .58, 1.18, .5, .1, .36, steelMat);         // 登车踏板
  box(4.3, .92, 1.18, .5, .1, .36, steelMat);
  box(4.3, .58, -1.18, .5, .1, .36, steelMat);
  box(4.3, .92, -1.18, .5, .1, .36, steelMat);
  for (const z of [-1.18, 1.18]) {                    // 前轮拱
    const arch = new THREE.Mesh(new THREE.TorusGeometry(.7, .055, 8, 18, Math.PI), cabPaint);
    arch.position.set(4.7, 1.02, z);
    group.add(arch);
  }

  /* ---------------- 厢式挂车：圆角挤出截面 ---------------- */
  const trailerShape = new THREE.Shape();
  const tw = 1.25;
  const th = 2.8;
  const rr = .16;
  trailerShape.moveTo(-tw + rr, 0);
  trailerShape.lineTo(tw - rr, 0);
  trailerShape.quadraticCurveTo(tw, 0, tw, rr);
  trailerShape.lineTo(tw, th - rr - .06);
  trailerShape.quadraticCurveTo(tw, th - .06, tw - rr * 1.4, th - .02);
  trailerShape.quadraticCurveTo(0, th, -tw + rr * 1.4, th - .02);
  trailerShape.quadraticCurveTo(-tw, th - .06, -tw, th - rr - .06);
  trailerShape.lineTo(-tw, rr);
  trailerShape.quadraticCurveTo(-tw, 0, -tw + rr, 0);
  const trailerGeo = new THREE.ExtrudeGeometry(trailerShape, { depth: 10.7, bevelEnabled: true, bevelThickness: .02, bevelSize: .02, bevelSegments: 1, steps: 1 });
  const trailer = new THREE.Mesh(trailerGeo, trailerPaint);
  trailer.rotation.y = Math.PI / 2;
  trailer.position.set(-9.7, 1.25, 0);
  group.add(trailer);

  box(-4.35, 4.09, 0, 10.6, .08, 2.42, trailerPaint);       // 顶沿
  for (let i = 0; i < 11; i += 1) {                          // 侧板波纹
    for (const z of [-1.27, 1.27]) box(-9.25 + i * .9, 2.7, z, .05, 2.6, .04, frameDark);
  }
  for (const z of [-1.29, 1.29]) {                           // 侧面下围防擦轨
    box(-4.35, 1.32, z, 10.5, .08, .05, frameDark);
    box(-4.35, 3.86, z, 10.5, .06, .04, steelMat);
  }
  box(-9.74, 2.66, 0, .05, 2.74, 2.42, frameDark);          // 后门框
  for (const z of [-.62, .62]) box(-9.79, 2.66, z, .04, 2.66, 1.14, trailerPaint); // 门板
  for (const z of [-1.16, 1.16]) cylinder(-9.82, 2.66, z, .045, 2.6, steelMat, 'y'); // 门锁杆
  for (const y of [1.6, 2.7, 3.8]) {
    for (const z of [-1.2, 1.2]) box(-9.84, y, z, .1, .16, .1, steelMat);           // 铰链
  }
  box(-9.9, .66, 0, .16, .36, 2.44, frameDark);             // 后下部防护
  for (const z of [-1.05, 1.05]) box(-9.86, .95, z, .16, .5, .16, frameDark);
  for (const z of [-.96, .96]) {                            // 支腿
    box(-1.05, .82, z, .16, 1.1, .16, steelMat);
    box(-1.05, 1.32, z, .3, .08, .3, steelMat);
  }
  cylinder(-1.05, .5, 0, .05, 1.9, steelMat, 'z');          // 支腿横梁
  for (const z of [-1.3, 1.3]) box(-5.0, 1.06, z, 5.6, .52, .07, trailerPaint); // 侧裙板
  for (const x of [-9.6, -1.1]) {                           // 角件
    for (const y of [1.35, 3.95]) {
      for (const z of [-1.22, 1.22]) box(x, y, z, .22, .22, .22, frameDark);
    }
  }
  box(.4, 1.32, 0, 1.2, .1, 1.7, frameDark);                // 牵引板
  for (const z of [-1.02, 1.02]) box(-9.8, 1.06, z, .06, .2, .3, lensMat); // 尾灯（熄灭）
  for (const z of [-1.18, 1.18]) {                          // 挂车轮拱
    const arch = new THREE.Mesh(new THREE.TorusGeometry(.62, .05, 8, 16, Math.PI), trailerPaint);
    arch.position.set(-8.5, 1.0, z);
    group.add(arch);
  }

  /* ---------------- 车轮 ---------------- */
  addWheel(4.7, -.98, .34, false);
  addWheel(4.7, .98, .34, false);
  for (const x of [1.9, .7]) { addWheel(x, -.96, .62, true); addWheel(x, .96, .62, true); }
  for (const x of [-7.9, -9.1]) { addWheel(x, -.96, .62, true); addWheel(x, .96, .62, true); }

  return shadowed(group);
}

export function disposeObject(object: THREE.Object3D) {
  const geometry = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  object.traverse((item) => {
    if (item instanceof THREE.Mesh || item instanceof THREE.Line || item instanceof THREE.Points) {
      geometry.add(item.geometry);
      for (const material of Array.isArray(item.material) ? item.material : [item.material]) materials.add(material);
    }
  });
  geometry.forEach((item) => item.dispose());
  materials.forEach((item) => item.dispose());
}

export interface SceneOptions {
  nodes: MapNode[];
  routes: MapRoute[];
  labels: HTMLElement;
  onPick: (kind: string, id: string) => void;
  onError: (message: string) => void;
  animate: boolean;
  selected?: string;
  vehicleOnly?: boolean;
  // 机位预设：'default' 常规、'compare' 拉远抬高（新旧方案对照）、'alert' 推近（异常段特写）
  view?: string;
  packing?: PackingInput;
  compactVehicles?: boolean;
}

// 程序化渐变环境贴图：给金属与漆面真实高光，避免加载外部 HDR
function gradientEnvTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createLinearGradient(0, 0, 0, 128);
  gradient.addColorStop(0, '#d5dde3');
  gradient.addColorStop(0.48, '#939ca3');
  gradient.addColorStop(1, '#2e3439');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 256, 128);
  const texture = new THREE.CanvasTexture(canvas);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/* ---------------- 真实车辆资产（CC0，来自 3D Assets "Long-Haul Trucking" 包） ----------------
   资产约定：+Y 向上、车头朝 +Z、轮轴沿 X、单位为米、车轮接地于 y=0。
   本项目 +X 为车头，故统一绕 Y 旋转 90°；再让挂车 kingpin 对齐牵引车 fifth-wheel。 */
const TRACTOR_URL = '/assets/models/tractor-cabover-sleeper.glb';
const TRAILER_URL = '/assets/models/trailer-dry-van.glb';

async function loadSemiTruck(): Promise<THREE.Group | null> {
  const loader = new GLTFLoader();
  const [tractorGltf, trailerGltf] = await Promise.all([loader.loadAsync(TRACTOR_URL), loader.loadAsync(TRAILER_URL)]);
  const tractor = tractorGltf.scene;
  const trailer = trailerGltf.scene;
  tractor.rotation.y = Math.PI / 2;
  trailer.rotation.y = Math.PI / 2;

  const fifthWheel = tractor.getObjectByName('fifth-wheel');
  const kingpin = trailer.getObjectByName('kingpin');
  if (fifthWheel && kingpin) {
    tractor.updateMatrixWorld(true);
    trailer.updateMatrixWorld(true);
    const fw = new THREE.Vector3();
    const kp = new THREE.Vector3();
    fifthWheel.getWorldPosition(fw);
    kingpin.getWorldPosition(kp);
    trailer.position.x += fw.x - kp.x;
  }

  const group = new THREE.Group();
  group.add(tractor, trailer);
  // 按材质名重上色：货厢/白件 → 低饱和工业浅灰；驾驶室 → 低饱和蓝灰；琥珀标识件降饱和
  const TINT: Record<string, string> = {
    white: '#b3b9bf',
    paint: '#4c5f70',
    accent: '#b0763a',
  };
  group.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.castShadow = true;
      child.receiveShadow = true;
      const list = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of list) {
        const m = material as THREE.MeshStandardMaterial;
        if (!m) continue;
        m.envMapIntensity = 1.1;
        if (m.name && TINT[m.name]) {
          m.color.set(TINT[m.name]);
          if (m.name === 'white') { m.roughness = .58; m.metalness = .12; }
        }
      }
    }
  });
  return group;
}

// 04 页产品展示用的无缝摄影棚地台（亮部只留车下光池，四周迅速收进深石墨背景）
function studioBackdrop() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(256, 300, 20, 256, 300, 300);
  gradient.addColorStop(0, '#5c666e');
  gradient.addColorStop(0.28, '#3a434b');
  gradient.addColorStop(0.6, '#232a30');
  gradient.addColorStop(1, '#181e23');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 512, 512);
  // 地面细节：轻微不规则，避免"纯渐变塑料感"
  const noise = ctx.getImageData(0, 0, 512, 512);
  for (let index = 0; index < noise.data.length; index += 4) {
    const grain = (Math.random() - 0.5) * 7;
    noise.data[index] += grain;
    noise.data[index + 1] += grain;
    noise.data[index + 2] += grain;
  }
  ctx.putImageData(noise, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

// 车辆接触阴影：车轮落地点周围的柔性暗斑，补足 shadowMap 在近距离偏"虚"的问题
function contactShadow() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(256, 128, 4, 256, 128, 246);
  gradient.addColorStop(0, 'rgba(0,0,0,.78)');
  gradient.addColorStop(0.24, 'rgba(0,0,0,.6)');
  gradient.addColorStop(0.52, 'rgba(0,0,0,.26)');
  gradient.addColorStop(0.78, 'rgba(0,0,0,.07)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 512, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createScene(host: HTMLElement, options: SceneOptions) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: Boolean(options.packing) });
  renderer.setClearColor(options.vehicleOnly ? '#101418' : '#2b3339');
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, host.clientWidth < 650 ? 1.35 : 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const canvas = renderer.domElement;
  canvas.setAttribute('aria-label', options.packing ? '车辆装载与卸货三维视图' : options.vehicleOnly ? '运力车辆模型' : '物流网络示意图');
  canvas.dataset.renderer = 'three';
  host.prepend(canvas);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(options.vehicleOnly ? '#101418' : '#2b3339');
  scene.fog = new THREE.FogExp2(options.vehicleOnly ? '#101418' : '#2b3339', options.vehicleOnly ? .0042 : .011);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envSource = gradientEnvTexture();
  const envTexture = pmrem.fromEquirectangular(envSource).texture;
  scene.environment = envTexture;
  scene.environmentIntensity = .48;
  pmrem.dispose();
  envSource.dispose();

  if (options.vehicleOnly) {
    // 三点工业产品灯光：主光前上方、右侧弱补光、后上方极弱轮廓光。无 Bloom。
    // 压低环境/半球光，让阴影落到接近黑位，车体与背景分离。
    scene.add(new THREE.HemisphereLight('#c3ccd4', '#1b2024', .26));
    scene.add(new THREE.AmbientLight('#4a545c', .18));
    const key = new THREE.DirectionalLight('#ffffff', 3.15);
    key.position.set(18, 12, 14);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -11;
    key.shadow.camera.right = 11;
    key.shadow.camera.top = 11;
    key.shadow.camera.bottom = -11;
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 60;
    key.shadow.bias = -.0003;
    key.shadow.normalBias = .018;
    key.shadow.radius = 2.4;
    scene.add(key);
    const studioFill = new THREE.DirectionalLight('#ccd8e2', .38);
    studioFill.position.set(-6, 6, 16);
    scene.add(studioFill);
    const rim = new THREE.DirectionalLight('#e6eff7', .95);
    rim.position.set(-14, 11, -12);
    scene.add(rim);
    // 深石墨渐变天幕（上半略亮、地平线以下收黑），与浅色车身形成明暗对比
    const skyCanvas = document.createElement('canvas');
    skyCanvas.width = 8;
    skyCanvas.height = 256;
    const skyCtx = skyCanvas.getContext('2d')!;
    const skyGrad = skyCtx.createLinearGradient(0, 0, 0, 256);
    skyGrad.addColorStop(0, '#5a636b');
    skyGrad.addColorStop(0.3, '#48515a');
    skyGrad.addColorStop(0.42, '#3a424a');
    skyGrad.addColorStop(0.5, '#313941');
    skyGrad.addColorStop(0.62, '#242b31');
    skyGrad.addColorStop(1, '#14191d');
    skyCtx.fillStyle = skyGrad;
    skyCtx.fillRect(0, 0, 8, 256);
    const skyTexture = new THREE.CanvasTexture(skyCanvas);
    skyTexture.colorSpace = THREE.SRGBColorSpace;
    const dome = new THREE.Mesh(new THREE.SphereGeometry(70, 24, 16), new THREE.MeshBasicMaterial({ map: skyTexture, side: THREE.BackSide, fog: false }));
    scene.add(dome);
  } else {
    scene.add(new THREE.HemisphereLight('#cfd8df', '#33393e', .78));
    const sun = new THREE.DirectionalLight('#f4f7fa', 2.6);
    sun.position.set(-12, 22, 14);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -25;
    sun.shadow.camera.right = 25;
    sun.shadow.camera.top = 25;
    sun.shadow.camera.bottom = -25;
    sun.shadow.bias = -.0004;
    sun.shadow.normalBias = .02;
    scene.add(sun);
    const fillLight = new THREE.DirectionalLight('#c3d3e0', .5);
    fillLight.position.set(15, 9, -18);
    scene.add(fillLight);
  }
  // 车辆展示位用较长焦距（约 60–70mm 等效），避免广角畸变与"模型预览器"感
  const camera = new THREE.PerspectiveCamera(options.vehicleOnly ? 32 : 40, 1, .1, 400);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = .075;
  controls.maxPolarAngle = options.vehicleOnly ? Math.PI * .49 : Math.PI * .47;
  controls.minPolarAngle = options.vehicleOnly ? .28 : .08;
  controls.enablePan = true;
  controls.minDistance = options.packing ? 2 : 9;
  if (options.packing) { controls.minPolarAngle = .001; controls.maxPolarAngle = Math.PI * .49; }
  controls.maxDistance = options.vehicleOnly ? 46 : 65;

  const composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(scene, camera);
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), .16, .4, .88);
  const output = new OutputPass();
  composer.addPass(renderPass);
  // 车辆展示位不使用 Bloom，保持工业资产质感
  if (!options.vehicleOnly) composer.addPass(bloom);
  composer.addPass(output);

  const pickables: THREE.Object3D[] = [];
  const movers: { truck: THREE.Group; curve: THREE.CatmullRomCurve3; offset: number; pinned?: number }[] = [];
  const heightAt = (x: number, z: number) => .28 + .42 * Math.sin(x * .38) * Math.cos(z * .48) + .2 * Math.sin(x * 1.25 + z * .55) + .16 * Math.cos(z * .92);
  const terrainHeight = (x: number, z: number) => heightAt(x, z) * .65;

  let alive = true;
  let packingObjects: ReturnType<typeof addPackingObjects> | undefined;

  if (options.packing) {
    packingObjects = addPackingObjects(scene, pickables, options.packing);
  } else if (options.vehicleOnly) {
    // 04 承运商画像：专业产品展示 —— 灰蓝摄影棚地台、接触阴影、固定 3/4 前侧视角
    // 先放程序化车辆占位；真实 CC0 资产加载完成后替换，加载失败即保留 fallback
    const truck = createTruck('#4f6f88');
    truck.position.x = 2.2; // 把视觉中心移回原点，方便环绕
    scene.add(truck);
    loadSemiTruck().then((asset) => {
      if (!alive || !asset) return;
      scene.remove(truck);
      disposeObject(truck);
      const bounds = new THREE.Box3().setFromObject(asset);
      const size = bounds.getSize(new THREE.Vector3());
      const center = bounds.getCenter(new THREE.Vector3());
      asset.position.x = -center.x; // 整车视觉中心回到原点
      scene.add(asset);
      console.info('[semi-asset]', JSON.stringify({ size: [+size.x.toFixed(2), +size.y.toFixed(2), +size.z.toFixed(2)], center: [+center.x.toFixed(2), +center.y.toFixed(2), +center.z.toFixed(2)] }));
    }).catch(() => { /* 资产不可用时保留程序化车辆 */ });
    const backdropTexture = studioBackdrop();
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(70, 70), new THREE.MeshStandardMaterial({ map: backdropTexture, roughness: .9, metalness: 0 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -.01;
    ground.receiveShadow = true;
    scene.add(ground);
    // 接触阴影：车下柔性暗斑（约 18m × 7m，覆盖牵引车＋挂车全长）
    const patch = new THREE.Mesh(new THREE.PlaneGeometry(18.5, 7.5), new THREE.MeshBasicMaterial({ map: contactShadow(), transparent: true, depthWrite: false, opacity: .92 }));
    patch.rotation.x = -Math.PI / 2;
    patch.position.y = .012;
    scene.add(patch);
  } else {
    const terrain = new THREE.PlaneGeometry(48, 36, 64, 48);
    const position = terrain.attributes.position;
    for (let index = 0; index < position.count; index += 1) position.setZ(index, terrainHeight(position.getX(index), position.getY(index)));
    terrain.computeVertexNormals();
    terrain.rotateX(-Math.PI / 2);
    const terrainMaterial = new THREE.MeshPhysicalMaterial({ color: '#0b2a40', metalness: .18, roughness: .82, clearcoat: .18, clearcoatRoughness: .6 });
    const terrainMesh = new THREE.Mesh(terrain, terrainMaterial);
    terrainMesh.receiveShadow = true;
    scene.add(terrainMesh);

    const radius = .52;
    const columns = 40;
    const rows = 28;
    const tileGeometry = new THREE.CylinderGeometry(radius * .95, radius, .16, 6, 1, false);
    const tileMaterial = new THREE.MeshStandardMaterial({ color: '#0a2135', metalness: .36, roughness: .74 });
    const tiles = new THREE.InstancedMesh(tileGeometry, tileMaterial, columns * rows);
    tiles.receiveShadow = true;
    const matrix = new THREE.Matrix4();
    const tileColor = new THREE.Color();
    const orangeVertices: number[] = [];
    const blueVertices: number[] = [];
    let tileIndex = 0;
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const x = (column - columns / 2) * radius * Math.sqrt(3) + (row % 2 ? radius * .86 : 0);
        const z = (row - rows / 2) * radius * 1.5;
        const y = terrainHeight(x, z) + .07;
        matrix.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
        tiles.setMatrixAt(tileIndex, matrix);
        const seed = Math.abs((Math.sin(column * 12.989 + row * 78.23) * 43758.5) % 1);
        tileColor.setHSL(.57 + seed * .035, .5, .07 + seed * .08);
        tiles.setColorAt(tileIndex, tileColor);
        const target = seed > .966 ? orangeVertices : blueVertices;
        for (let side = 0; side < 6; side += 1) {
          const a = side * Math.PI / 3;
          const b = (side + 1) * Math.PI / 3;
          target.push(x + Math.sin(a) * radius * .97, y + .095, z + Math.cos(a) * radius * .97, x + Math.sin(b) * radius * .97, y + .095, z + Math.cos(b) * radius * .97);
        }
        tileIndex += 1;
      }
    }
    tiles.instanceMatrix.needsUpdate = true;
    if (tiles.instanceColor) tiles.instanceColor.needsUpdate = true;
    scene.add(tiles);
    for (const [vertices, color, opacity] of [[blueVertices, '#0a5a91', .36], [orangeVertices, '#ff8d38', .66]] as const) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      scene.add(new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color, transparent: true, opacity }))); 
    }

    const rocks = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(.15, 1), new THREE.MeshStandardMaterial({ color: '#081725', roughness: .94, metalness: .08, flatShading: true }), 96);
    const rockMatrix = new THREE.Matrix4();
    const rockColor = new THREE.Color();
    for (let index = 0; index < 96; index += 1) {
      const x = ((index * 37) % 41) - 20;
      const z = ((index * 61) % 29) - 14;
      const scale = .4 + (index % 7) * .12;
      rockMatrix.compose(new THREE.Vector3(x, terrainHeight(x, z) + .16 * scale, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, index * .71, index * .22)), new THREE.Vector3(scale, scale * (1.2 + (index % 3) * .18), scale));
      rocks.setMatrixAt(index, rockMatrix);
      rockColor.setHSL(.56, .35, .045 + (index % 5) * .012);
      rocks.setColorAt(index, rockColor);
    }
    rocks.instanceMatrix.needsUpdate = true;
    if (rocks.instanceColor) rocks.instanceColor.needsUpdate = true;
    rocks.castShadow = true;
    rocks.receiveShadow = true;
    scene.add(rocks);

    // Spatial city massing for the city-delivery surface. Building positions
    // are deterministic offsets from the supplied synthetic stop coordinates;
    // they are visual context only and never replace the route data.
    if (options.view === 'spatial') {
      const buildingMaterial = new THREE.MeshStandardMaterial({ color: '#334b58', metalness: .18, roughness: .68 });
      const windowMaterial = new THREE.MeshBasicMaterial({ color: '#b5d4d0', transparent: true, opacity: .48 });
      options.nodes.filter(node => node.id !== 'DEPOT').forEach((node, index) => {
        const height = 1.5 + (index % 3) * .65;
        const width = .72 + (index % 2) * .22;
        const depth = .8 + ((index + 1) % 2) * .24;
        const building = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), buildingMaterial.clone());
        building.position.set(node.x + (index % 2 ? .9 : -.85), terrainHeight(node.x, node.z) + height / 2, node.z + (index % 3 === 0 ? .85 : -.8));
        building.castShadow = true;
        building.receiveShadow = true;
        scene.add(building);
        const windowStrip = new THREE.Mesh(new THREE.BoxGeometry(width * .74, .045, depth + .012), windowMaterial.clone());
        windowStrip.position.set(building.position.x, building.position.y + .18 + (index % 2) * .38, building.position.z + depth / 2 + .008);
        scene.add(windowStrip);
      });
    }

    for (const node of options.nodes) {
      const color = node.role === 'origin' ? '#ff7d2f' : node.role === 'destination' ? '#00e0c7' : '#1896ff';
      const y = terrainHeight(node.x, node.z) + 1.05;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(.46, .055, 10, 56), new THREE.MeshBasicMaterial({ color }));
      ring.rotation.x = Math.PI / 2;
      ring.position.set(node.x, y, node.z);
      ring.userData = { kind: 'node', id: node.id };
      scene.add(ring);
      pickables.push(ring);
      const disk = new THREE.Mesh(new THREE.CylinderGeometry(.3, .3, .08, 36), new THREE.MeshPhysicalMaterial({ color, emissive: color, emissiveIntensity: node.role ? 1.2 : .22, metalness: .38, roughness: .22, clearcoat: .7 }));
      disk.position.copy(ring.position);
      disk.userData = ring.userData;
      disk.castShadow = true;
      scene.add(disk);
      pickables.push(disk);
      const halo = new THREE.Mesh(new THREE.TorusGeometry(.65, .018, 8, 56), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .42 }));
      halo.rotation.x = Math.PI / 2;
      halo.position.copy(ring.position);
      scene.add(halo);
      const beacon = new THREE.PointLight(color, node.role ? 5 : 1.3, node.role ? 7 : 3, 2);
      beacon.position.copy(ring.position).setY(y + .25);
      scene.add(beacon);
    }

    for (const route of options.routes) {
      const points = route.nodes.map((id) => options.nodes.find((node) => node.id === id)).filter((node): node is MapNode => Boolean(node)).map((node) => new THREE.Vector3(node.x, terrainHeight(node.x, node.z) + 1.08, node.z));
      if (points.length < 2) continue;
      const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', .16);
      const color = new THREE.Color(route.color);
      const routeOpacity = route.opacity ?? 1;
      const radius = route.width ?? .04;
      const glowStrength = route.glow ?? 1.9;
      if (route.dashed) {
        const geometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(140));
        const line = new THREE.Line(geometry, new THREE.LineDashedMaterial({ color, dashSize: .28, gapSize: .2, transparent: true, opacity: route.opacity ?? .72 }));
        line.computeLineDistances();
        scene.add(line);
      } else {
        const core = new THREE.Mesh(new THREE.TubeGeometry(curve, 120, radius, 8, false), new THREE.MeshPhysicalMaterial({ color, emissive: color, emissiveIntensity: glowStrength, metalness: .32, roughness: .18, clearcoat: .8, transparent: routeOpacity < 1, opacity: routeOpacity }));
        core.userData = { kind: 'route', id: route.id };
        core.castShadow = true;
        scene.add(core);
        pickables.push(core);
        // 弱化的旧方案不再叠加发光，避免"半透明 + 自发光"看起来比新方案还亮
        const glowOpacity = Math.min(.12, .1 * glowStrength / 1.9) * routeOpacity;
        if (glowOpacity > .012) {
          const glow = new THREE.Mesh(new THREE.TubeGeometry(curve, 120, radius * 3, 6, false), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: glowOpacity, blending: THREE.AdditiveBlending, depthWrite: false }));
          scene.add(glow);
        }
      }
      for (let index = 0; index < (route.vehicles ?? 0); index += 1) {
        const truck = options.view === 'spatial' ? new THREE.Group() : createTruck(route.color);
        if (options.view === 'spatial') {
          const body = new THREE.Mesh(new THREE.BoxGeometry(.68,.24,.38), new THREE.MeshStandardMaterial({ color: route.color, metalness: .35, roughness: .42 }));
          body.position.y = .18;
          body.castShadow = true;
          truck.add(body);
          for (const wheelX of [-.22,.22]) {
            const wheel = new THREE.Mesh(new THREE.CylinderGeometry(.09,.09,.08,12), new THREE.MeshStandardMaterial({ color: '#17232b', roughness: .85 }));
            wheel.rotation.z = Math.PI / 2;
            wheel.position.set(wheelX, .09, .2);
            truck.add(wheel);
          }
        } else {
          truck.scale.setScalar(options.compactVehicles ? .025 : .16);
        }
        truck.userData = { kind: 'vehicle', id: route.id };
        scene.add(truck);
        pickables.push(truck);
        movers.push({ truck, curve, offset: (index + .5) / (route.vehicles ?? 1), pinned: route.stopped ? .52 : undefined });
      }
    }
  }

  let width = 0; let heightPx = 0; let frame = 0; let visible = true; let disposed = false; let topView = false; let lastTime = 0; let travelled = 0;
  let preset = options.view ?? 'default';
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const reset = () => {
    const aspect = width / Math.max(1, heightPx);
    // 竖幅容器（约 268×521）放不下 15.6m 半挂的侧视全景，因此改用
    // 「前侧 3/4 + 略高机位」：整车（驾驶室 / 全部车轮 / 挂车尾门）完整入镜，
    // 同时把车长造成的横向跨度压到画面宽度以内。
    if (options.packing) {
      const fit = packingObjects?.fitBounds?.();
      const bounds = fit ?? new THREE.Box3(new THREE.Vector3(-3, 0, -1.3), new THREE.Vector3(3, 3, 1.3));
      const center = bounds.getCenter(new THREE.Vector3());
      const size = bounds.getSize(new THREE.Vector3());
      const vertical = THREE.MathUtils.degToRad(camera.fov);
      const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * Math.max(.55, aspect));
      const distance = Math.max(size.y / (2 * Math.tan(vertical / 2)), size.x / (2 * Math.tan(horizontal / 2)), size.z / (2 * Math.tan(horizontal / 2))) * 1.82;
      controls.target.copy(center).add(new THREE.Vector3(0, -.08, 0));
      if (preset === 'top') camera.position.copy(center).add(new THREE.Vector3(0, distance * 1.08, .01));
      else if (preset === 'side') camera.position.copy(center).add(new THREE.Vector3(0, Math.max(1.2, size.y * .32), distance * 1.05));
      else if (preset === 'rear') camera.position.copy(center).add(new THREE.Vector3(distance * 1.12, Math.max(1.1, size.y * .36), 0));
      else camera.position.copy(center).add(new THREE.Vector3(distance * .52, distance * .42, distance * .88));
    } else if (options.vehicleOnly) { camera.position.set(24.71, 10.71, 7.06); controls.target.set(3.0, 2.4, 0); }
    else {
      // 机位预设：compare 拉远抬高（同时看清新旧两条路线），alert 推近（异常段特写）
      const scale = preset === 'compare' ? 1.2 : preset === 'alert' ? .74 : 1;
      const lift = preset === 'compare' ? .9 : preset === 'alert' ? .54 : .68;
      const distance = Math.max(preset === 'spatial' ? 18 : 23, 30 / Math.max(.65, aspect)) * scale;
      const centerX = preset === 'spatial' ? options.nodes.reduce((sum,node)=>sum+node.x,0)/Math.max(1,options.nodes.length) : 0;
      const centerZ = preset === 'spatial' ? options.nodes.reduce((sum,node)=>sum+node.z,0)/Math.max(1,options.nodes.length) : 0;
      camera.position.set(centerX + .5, topView ? distance : centerZ + distance * lift, topView ? centerZ + .01 : centerZ + distance * .85);
      controls.target.set(centerX, preset === 'spatial' ? .65 : .35, centerZ);
    }
    controls.update();
  };
  const resize = () => { width = Math.max(1, host.clientWidth); heightPx = Math.max(1, host.clientHeight); renderer.setSize(width, heightPx, false); composer.setSize(width, heightPx); camera.aspect = width / heightPx; camera.updateProjectionMatrix(); reset(); if(options.packing){composer.render();canvas.dataset.ready='true';} };
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();
  // 唯一的重启入口：可见性、文档前后台、上下文丢失都走这里，避免出现“再也画不出来”的黑屏
  const schedule = () => { if (!disposed && visible && !document.hidden && !frame) frame = requestAnimationFrame(render); };
  const intersection = new IntersectionObserver(([entry]) => { visible = Boolean(entry?.isIntersecting); schedule(); });
  intersection.observe(host);
  const visibility = () => { if (document.hidden) { if (frame) cancelAnimationFrame(frame); frame = 0; } lastTime = 0; schedule(); };
  document.addEventListener('visibilitychange', visibility);
  const point = new THREE.Vector3();
  const projected = () => { for (const node of options.nodes) { const element = options.labels.querySelector<HTMLElement>(`[data-node="${node.id}"]`); if (!element) continue; point.set(node.x, terrainHeight(node.x, node.z) + 2.2, node.z).project(camera); element.style.transform = `translate(-50%, -100%) translate(${(point.x * .5 + .5) * width}px, ${(-point.y * .5 + .5) * heightPx}px)`; element.style.visibility = point.z > 1 || Math.abs(point.x) > 1 || Math.abs(point.y) > 1 ? 'hidden' : 'visible'; } };
  function render(time: number) { frame = 0; if (disposed || !visible || document.hidden) return; const dt = lastTime ? Math.min(.05, (time - lastTime) / 1000) : 0; lastTime = time; if (options.animate && !reduced) travelled += dt * .017; for (const mover of movers) { const t = mover.pinned ?? (mover.offset + travelled) % 1; mover.truck.position.copy(mover.curve.getPoint(t)); const tangent = mover.curve.getTangent(t); mover.truck.rotation.y = -Math.atan2(tangent.z, tangent.x); } controls.update(); projected(); composer.render(); canvas.dataset.ready = 'true'; schedule(); }
  let down = { x: 0, y: 0 };
  const pointerDown = (event: PointerEvent) => { down = { x: event.clientX, y: event.clientY }; };
  const pick = (event: PointerEvent) => { if (Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5) return; const rect = canvas.getBoundingClientRect(); const ray = new THREE.Raycaster(); ray.params.Line = { threshold: .15 }; ray.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), camera); const object = ray.intersectObjects(pickables, true).find(hit=>{let item:THREE.Object3D|null=hit.object;while(item){if(!item.visible)return false;item=item.parent;}return true;})?.object; if (object?.userData.id) options.onPick(object.userData.kind, object.userData.id); };
  const lost = (event: Event) => { event.preventDefault(); options.onError('3D 画面已中断，请重新加载地图。'); if (frame) cancelAnimationFrame(frame); frame = 0; };
  canvas.addEventListener('webglcontextlost', lost); canvas.addEventListener('pointerdown', pointerDown); canvas.addEventListener('pointerup', pick); schedule();
  return { reset, updatePacking: (state:PackingState) => packingObjects?.update(state), focusCargo: (id:string) => { const p=packingObjects?.position(id); if(p){controls.target.copy(p);camera.position.copy(p).add(new THREE.Vector3(3,2.6,3));controls.update();} }, zoom: (factor: number) => { camera.position.sub(controls.target).multiplyScalar(factor).add(controls.target); controls.update(); }, toggleView: () => { topView = !topView; reset(); return topView; }, focus: (view: string) => { preset = view; reset(); }, dispose: () => { disposed = true; alive = false; packingObjects?.dispose(); if (frame) cancelAnimationFrame(frame); observer.disconnect(); intersection.disconnect(); document.removeEventListener('visibilitychange', visibility); canvas.removeEventListener('webglcontextlost', lost); canvas.removeEventListener('pointerdown', pointerDown); canvas.removeEventListener('pointerup', pick); controls.dispose(); disposeObject(scene); envTexture.dispose(); bloom.dispose(); output.dispose(); composer.dispose(); renderer.dispose(); canvas.remove(); } };
}
