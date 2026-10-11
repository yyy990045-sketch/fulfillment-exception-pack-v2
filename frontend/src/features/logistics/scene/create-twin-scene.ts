import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { twinZones } from '../twin-fixtures';
import type { TwinLayer, TwinSceneController, TwinSceneOptions, TwinVehicle } from '../twin-types';

/* ------------------------------------------------------------------ *
 * 工业仓储数字孪生场景
 * 全部按真实米制尺度构建：地坪 36×27m，货架 6.4m 高，AMR 高 0.47m。
 * 现实资产只用工业 PBR 材质；cyan / amber / red 只出现在数字孪生 Overlay。
 * ------------------------------------------------------------------ */

const FLOOR_W = 36;
const FLOOR_D = 27;
const EAVE = 9.2;
const RACK_H = 6.4;
const BAY = 2.7;
const RACK_DEPTH = 1.1;
const BEAM_LEVELS = [1.5, 3.0, 4.5, 6.0];

// 货架排：中心 z、沿 x 起点、跨数
const RACK_ROWS: Array<{ z: number; x0: number; bays: number }> = [
  { z: -6.0, x0: -13.5, bays: 5 },
  { z: -4.8, x0: -13.5, bays: 5 },
  { z: -1.0, x0: -13.5, bays: 5 },
  { z: 0.2, x0: -13.5, bays: 5 },
  { z: 4.4, x0: -2.0, bays: 5 },
  { z: 5.6, x0: -2.0, bays: 5 },
];

// 数字孪生路径：沿真实巷道与装卸通道敷设
const ROUTE_POINTS: Array<[number, number]> = [
  [-15.6, 6.8], [-15.6, 1.0], [-15.3, -2.9], [-10.5, -2.9], [-5.5, -2.9],
  [-0.5, -2.9], [4.5, -2.9], [9.5, -2.9], [12.6, -4.2], [11.8, -7.0],
  [8.0, -7.6], [2.0, -7.9], [-4.0, -8.2], [-9.5, -7.6], [-14.4, -7.2],
];

const matrix = (x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, ry = 0) =>
  new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)),
    new THREE.Vector3(sx, sy, sz),
  );

function buildInstanced(geometry: THREE.BufferGeometry, material: THREE.Material, matrices: THREE.Matrix4[], castShadow = true, receiveShadow = true) {
  if (!matrices.length) return null;
  const mesh = new THREE.InstancedMesh(geometry, material, matrices.length);
  matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = castShadow;
  mesh.receiveShadow = receiveShadow;
  mesh.frustumCulled = false;
  return mesh;
}

function disposeObject(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  root.traverse((item) => {
    const mesh = item as THREE.Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    list.filter(Boolean).forEach((material) => materials.add(material));
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
}

/* ---------------------------- 程序化贴图 ---------------------------- */

function concreteTexture() {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#4b5155';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 9000; i += 1) {
    const shade = 52 + Math.random() * 46;
    ctx.fillStyle = `rgba(${shade},${shade + 2},${shade + 4},${0.16 + Math.random() * 0.3})`;
    const r = Math.random() * 2.6 + 0.4;
    ctx.fillRect(Math.random() * size, Math.random() * size, r, r);
  }
  for (let i = 0; i < 26; i += 1) {
    ctx.fillStyle = `rgba(${60 + Math.random() * 26},${63 + Math.random() * 26},${66 + Math.random() * 26},.13)`;
    ctx.beginPath();
    ctx.ellipse(Math.random() * size, Math.random() * size, 22 + Math.random() * 60, 14 + Math.random() * 40, Math.random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = 'rgba(28,31,33,.5)';
  ctx.lineWidth = 1.4;
  for (let i = 0; i <= 4; i += 1) {
    ctx.beginPath(); ctx.moveTo((i * size) / 4, 0); ctx.lineTo((i * size) / 4, size); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, (i * size) / 4); ctx.lineTo(size, (i * size) / 4); ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function hazardTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#d8a233';
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = '#26221a';
  ctx.lineWidth = 22;
  for (let i = -size; i < size * 2; i += 52) {
    ctx.beginPath();
    ctx.moveTo(i, -10);
    ctx.lineTo(i + size + 10, size + 10);
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.repeat.set(5, 2.4);
  texture.anisotropy = 8;
  return texture;
}

function labelTexture(text: string) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#d7dde1';
  ctx.fillRect(0, 0, 128, 64);
  ctx.fillStyle = '#14181b';
  ctx.font = 'bold 34px "Helvetica Neue", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 64, 34);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// 混凝土地面粗糙度变化：补丁 + 轻微轮胎磨亮轨迹（程度极轻，正常运营仓库）
function concreteRoughness() {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#dcdcdc';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 42; i += 1) {
    const v = 188 + Math.round(Math.random() * 44);
    ctx.fillStyle = `rgba(${v},${v},${v},.16)`;
    ctx.beginPath();
    ctx.ellipse(Math.random() * size, Math.random() * size, 30 + Math.random() * 70, 18 + Math.random() * 44, Math.random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < 7; i += 1) {
    ctx.strokeStyle = 'rgba(148,148,148,.2)';
    ctx.lineWidth = 8 + Math.random() * 14;
    const y = Math.random() * size;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(size * .3, y + (Math.random() - .5) * 60, size * .7, y + (Math.random() - .5) * 60, size, y);
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  return texture;
}

// 物流标签贴纸（白底 + 灰条 + 条码），只贴在少数箱体上
function labelSheetTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 48;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#e9edf0';
  ctx.fillRect(0, 0, 64, 48);
  ctx.fillStyle = '#b9c2c8';
  ctx.fillRect(6, 6, 34, 6);
  ctx.fillRect(6, 16, 26, 5);
  ctx.fillStyle = '#2a3238';
  for (let i = 0; i < 14; i += 1) ctx.fillRect(6 + i * 3.4, 30, i % 3 === 0 ? 2 : 1, 12);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function signTexture(text: string, fg: string, bg: string) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 96;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 256, 96);
  ctx.strokeStyle = 'rgba(255,255,255,.28)';
  ctx.lineWidth = 4;
  ctx.strokeRect(6, 6, 244, 84);
  ctx.fillStyle = fg;
  ctx.font = 'bold 52px "Helvetica Neue", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 52);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/* ------------------------------ 材质库 ------------------------------ */

function createMaterials() {
  const standard = (color: string, roughness: number, metalness: number) =>
    new THREE.MeshStandardMaterial({ color, roughness, metalness });
  return {
    floor: new THREE.MeshStandardMaterial({ color: '#6e7479', roughness: .84, metalness: 0 }),
    concrete: standard('#545a5e', .9, 0),
    wall: standard('#454b50', .88, 0),
    steelGalv: standard('#9aa1a7', .38, .86),
    steelDark: standard('#3e4448', .46, .82),
    beamOrange: standard('#ab5a2c', .55, .3),
    deck: standard('#5c6367', .58, .62),
    wood: standard('#8a6a46', .84, 0),
    cardboard: standard('#a1845c', .9, 0),
    tape: standard('#6b5334', .82, 0),
    tote: standard('#26394a', .6, .04),
    bin: standard('#5f676b', .46, .68),
    wrap: standard('#8d959b', .4, .04),
    paintedMetal: standard('#6c757c', .38, .4),
    rubber: standard('#15191c', .86, 0),
    glass: new THREE.MeshPhysicalMaterial({ color: '#1d2c34', roughness: .1, metalness: .12, transparent: true, opacity: .58, clearcoat: .8 }),
    sensor: standard('#232a2e', .3, .5),
  };
}

/* ------------------------------ AMR 模型 ------------------------------ */

function createAmr(vehicle: TwinVehicle, materials: ReturnType<typeof createMaterials>) {
  const group = new THREE.Group();
  group.userData = { id: vehicle.id };
  const accent = new THREE.MeshStandardMaterial({ color: '#5a6570', roughness: .4, metalness: .45 });

  const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.18, .2, .78), materials.paintedMetal);
  chassis.position.y = .17;
  group.add(chassis);
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.08, .14, .7), accent);
  body.position.y = .31;
  group.add(body);
  const bumper = new THREE.Mesh(new THREE.BoxGeometry(1.24, .07, .84), materials.rubber);
  bumper.position.y = .09;
  group.add(bumper);
  const deck = new THREE.Mesh(new THREE.BoxGeometry(1.02, .05, .74), materials.steelDark);
  deck.position.y = .43;
  group.add(deck);
  for (const [dx, dz] of [[-.42, -.32], [.42, -.32], [-.42, .32], [.42, .32]]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(.022, .022, .06, 8), materials.steelGalv);
    post.position.set(dx, .38, dz);
    group.add(post);
  }
  const wheelGeo = new THREE.CylinderGeometry(.095, .095, .065, 16);
  for (const [dx, dz] of [[-.42, -.36], [.42, -.36], [-.42, .36], [.42, .36]]) {
    const wheel = new THREE.Mesh(wheelGeo, materials.rubber);
    wheel.rotation.x = Math.PI / 2;
    wheel.position.set(dx, .095, dz);
    wheel.userData.role = 'wheel';
    group.add(wheel);
  }
  const casterGeo = new THREE.CylinderGeometry(.055, .055, .04, 12);
  for (const dx of [-.46, .46]) {
    const caster = new THREE.Mesh(casterGeo, materials.rubber);
    caster.rotation.x = Math.PI / 2;
    caster.position.set(dx, .055, 0);
    group.add(caster);
  }
  const lidar = new THREE.Mesh(new THREE.CylinderGeometry(.052, .052, .055, 14), materials.sensor);
  lidar.position.set(.44, .39, 0);
  group.add(lidar);
  const lidarGlass = new THREE.Mesh(new THREE.CylinderGeometry(.05, .05, .016, 14), materials.glass);
  lidarGlass.position.set(.44, .42, 0);
  group.add(lidarGlass);

  // 状态灯：极小面积，仅绿/黄/红
  const statusColor = vehicle.status === 'alert' ? '#e0464f' : vehicle.status === 'charging' ? '#e8a13c' : vehicle.status === 'idle' ? '#8f9aa2' : '#3fb37a';
  const beacon = new THREE.Mesh(
    new THREE.BoxGeometry(.1, .035, .07),
    new THREE.MeshStandardMaterial({ color: statusColor, emissive: statusColor, emissiveIntensity: .85, roughness: .4, metalness: .1 }),
  );
  beacon.position.set(-.42, .47, 0);
  group.add(beacon);

  const plate = new THREE.Mesh(new THREE.PlaneGeometry(.26, .13), new THREE.MeshStandardMaterial({ map: labelTexture(vehicle.id), roughness: .7, metalness: .1 }));
  plate.position.set(0, .26, .355);
  group.add(plate);

  group.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
  return { group, wheels: group.children.filter((child) => child.userData.role === 'wheel') };
}

/* ------------------------------ 主场景 ------------------------------ */

export function createTwinScene(host: HTMLElement, options: TwinSceneOptions): TwinSceneController {
  RectAreaLightUniformsLib.init();

  const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.52;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.dataset.renderer = 'three';
  renderer.domElement.dataset.ready = 'false';
  renderer.domElement.setAttribute('aria-label', '仓库运行场景');
  // 首帧画出之前不暴露半成品画面，完成后 220ms 淡入
  renderer.domElement.style.opacity = '0';
  renderer.domElement.style.transition = 'opacity 220ms ease-out';
  host.append(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#12171b');
  scene.fog = new THREE.FogExp2('#12171b', .0075);

  // 程序化环境反射：让金属不发黑，避免加载外部 HDR
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envCanvas = document.createElement('canvas');
  envCanvas.width = 256;
  envCanvas.height = 128;
  const envCtx = envCanvas.getContext('2d')!;
  const envGrad = envCtx.createLinearGradient(0, 0, 0, 128);
  envGrad.addColorStop(0, '#d3dbe1');
  envGrad.addColorStop(0.48, '#8d969c');
  envGrad.addColorStop(1, '#2b3034');
  envCtx.fillStyle = envGrad;
  envCtx.fillRect(0, 0, 256, 128);
  const envSource = new THREE.CanvasTexture(envCanvas);
  envSource.mapping = THREE.EquirectangularReflectionMapping;
  envSource.colorSpace = THREE.SRGBColorSpace;
  const envTexture = pmrem.fromEquirectangular(envSource).texture;
  scene.environment = envTexture;
  scene.environmentIntensity = .62;
  pmrem.dispose();
  envSource.dispose();

  const materials = createMaterials();

  /* ------------------------------ 地坪 ------------------------------ */
  const floorTexture = concreteTexture();
  floorTexture.repeat.set(7, 5.25);
  materials.floor.map = floorTexture;
  const floorRough = concreteRoughness();
  floorRough.repeat.set(7, 5.25);
  materials.floor.roughnessMap = floorRough;
  materials.floor.roughness = .86;
  materials.floor.metalness = .04;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(FLOOR_W, FLOOR_D), materials.floor);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const flat = (color: string, opacity: number, y: number) => new THREE.MeshStandardMaterial({
    color, roughness: .74, metalness: 0,
    transparent: opacity < 1, opacity,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const whiteLine = flat('#d8dde0', .8, .012);
  const markings = new THREE.Group();
  const stripe = (x: number, z: number, w: number, d: number, material: THREE.Material, y = .012) => {
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(w, d), material);
    plane.rotation.x = -Math.PI / 2;
    plane.position.set(x, y, z);
    markings.add(plane);
  };
  // 巷道边界与库位边界（白色）
  for (const row of RACK_ROWS) {
    const w = row.bays * BAY;
    stripe(row.x0 + w / 2, row.z - RACK_DEPTH / 2 - .3, w + .5, .09, whiteLine);
    stripe(row.x0 + w / 2, row.z + RACK_DEPTH / 2 + .3, w + .5, .09, whiteLine);
    stripe(row.x0 + w / 2, row.z - RACK_DEPTH / 2, w, .05, whiteLine, .015);
    stripe(row.x0 + w / 2, row.z + RACK_DEPTH / 2, w, .05, whiteLine, .015);
  }
  // 主通道边界
  stripe(0, -1.65, 30, .07, whiteLine);
  stripe(0, -4.15, 30, .07, whiteLine);
  scene.add(markings);

  // 装卸区：黄色斜纹警示地坪 + 边线（安全 / 作业区域）
  const hazardTex = hazardTexture();
  const hazardMat = new THREE.MeshStandardMaterial({
    map: hazardTex, roughness: .82, metalness: 0,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  });
  for (const [x, z] of [[-10, 6.4], [-8, -7.2]] as Array<[number, number]>) {
    const apron = new THREE.Mesh(new THREE.PlaneGeometry(7.2, 3.4), hazardMat);
    apron.rotation.x = -Math.PI / 2;
    apron.position.set(x, .013, z);
    markings.add(apron);
  }
  for (const [x, z] of [[-10, 6.4], [-8, -7.2]] as Array<[number, number]>) {
    const border = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(7.3, .01, 3.5)),
      new THREE.LineBasicMaterial({ color: '#d8a233', transparent: true, opacity: .7 }),
    );
    border.position.set(x, .017, z);
    markings.add(border);
  }

  /* --------------------------- 建筑结构 --------------------------- */
  const structure = new THREE.Group();
  const wall = (w: number, d: number, x: number, z: number) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, EAVE, d), materials.wall);
    mesh.position.set(x, EAVE / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    structure.add(mesh);
  };
  wall(FLOOR_W + .6, .3, 0, -FLOOR_D / 2 - .15);
  wall(FLOOR_W + .6, .3, 0, FLOOR_D / 2 + .15);
  wall(.3, FLOOR_D, FLOOR_W / 2 + .15, 0);
  // 西墙留两个装卸门洞
  wall(.3, 8.4, -FLOOR_W / 2 - .15, -1.6);
  wall(.3, 4.4, -FLOOR_W / 2 - .15, 11.3);
  wall(.3, 3.0, -FLOOR_W / 2 - .15, 2.7);

  const doorFrameMat = new THREE.MeshStandardMaterial({ color: '#c08d2c', roughness: .6, metalness: .35 });
  for (const z of [6.4, -7.2]) {
    const door = new THREE.Mesh(new THREE.BoxGeometry(.22, 4.3, 3.4), new THREE.MeshStandardMaterial({ color: '#2b3034', roughness: .72, metalness: .3 }));
    door.position.set(-FLOOR_W / 2 - .1, 2.15, z);
    structure.add(door);
    for (const dz of [-1.78, 1.78]) {
      const frame = new THREE.Mesh(new THREE.BoxGeometry(.06, 4.4, .16), doorFrameMat);
      frame.position.set(-FLOOR_W / 2 + .1, 2.2, z + dz);
      structure.add(frame);
    }
    const leveller = new THREE.Mesh(new THREE.BoxGeometry(1.6, .12, 2.6), materials.steelDark);
    leveller.position.set(-FLOOR_W / 2 + .95, .06, z);
    leveller.castShadow = true;
    leveller.receiveShadow = true;
    structure.add(leveller);
  }

  // 立柱只沿墙体布置（贴墙，避免高位视角下出现"悬空立柱"）
  const columns: THREE.Matrix4[] = [];
  const bases: THREE.Matrix4[] = [];
  for (const z of [-11.2, -5.4, 1.4, 8.4]) {
    for (const x of [-17.15, 17.15]) {
      columns.push(matrix(x, (EAVE - .6) / 2, z, .32, EAVE - .6, .32));
      bases.push(matrix(x, .08, z, .66, .16, .66));
    }
  }
  for (const x of [-13.5, -7.4, -1.4, 4.6, 10.6, 16.4]) {
    for (const z of [-12.85, 12.85]) {
      columns.push(matrix(x, (EAVE - .6) / 2, z, .32, EAVE - .6, .32));
      bases.push(matrix(x, .08, z, .66, .16, .66));
    }
  }
  structure.add(buildInstanced(new THREE.BoxGeometry(1, 1, 1), materials.steelDark, columns)!);
  structure.add(buildInstanced(new THREE.BoxGeometry(1, 1, 1), materials.steelDark, bases)!);

  // 顶部只保留檐口收边梁，不做吊顶、不做横穿视线的桁架（相机为高位俯视）
  for (const [w, d, x, z] of [
    [FLOOR_W, .18, 0, -FLOOR_D / 2],
    [FLOOR_W, .18, 0, FLOOR_D / 2],
    [.18, FLOOR_D, FLOOR_W / 2, 0],
    [.18, FLOOR_D, -FLOOR_W / 2, 0],
  ] as Array<[number, number, number, number]>) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(w, .24, d), materials.steelDark);
    beam.position.set(x, EAVE - .12, z);
    beam.castShadow = true;
    structure.add(beam);
  }
  scene.add(structure);

  /* ------------------------------ 货架 ------------------------------ */
  const uprights: THREE.Matrix4[] = [];
  const beams: THREE.Matrix4[] = [];
  const decks: THREE.Matrix4[] = [];
  const feet: THREE.Matrix4[] = [];
  const pallets: THREE.Matrix4[] = [];
  const cartons: THREE.Matrix4[] = [];
  const tapes: THREE.Matrix4[] = [];
  const totes: THREE.Matrix4[] = [];
  const bins: THREE.Matrix4[] = [];
  const wraps: THREE.Matrix4[] = [];

  const rand = (seed: number) => {
    const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
    return value - Math.floor(value);
  };
  let seedIndex = 0;

  for (const row of RACK_ROWS) {
    for (let bay = 0; bay < row.bays; bay += 1) {
      const cx = row.x0 + bay * BAY + BAY / 2;
      for (const dz of [-RACK_DEPTH / 2 + .06, RACK_DEPTH / 2 - .06]) {
        uprights.push(matrix(cx - BAY / 2 + .065, RACK_H / 2, row.z + dz, .13, RACK_H, .13));
        uprights.push(matrix(cx + BAY / 2 - .065, RACK_H / 2, row.z + dz, .13, RACK_H, .13));
        feet.push(matrix(cx - BAY / 2 + .065, .03, row.z + dz, .24, .06, .2));
        feet.push(matrix(cx + BAY / 2 - .065, .03, row.z + dz, .24, .06, .2));
      }
      for (const level of BEAM_LEVELS) {
        for (const dz of [-RACK_DEPTH / 2 + .06, RACK_DEPTH / 2 - .06]) {
          beams.push(matrix(cx, level + .04, row.z + dz, BAY - .16, .1, .05));
        }
        decks.push(matrix(cx, level + .11, row.z, BAY - .1, .03, RACK_DEPTH - .12));
        for (const px of [-.66, .66]) {
          seedIndex += 1;
          const r = rand(seedIndex);
          const py = level + .2;
          pallets.push(matrix(cx + px, py, row.z, 1.16, .13, .78));
          if (r < .07) { wraps.push(matrix(cx + px, py + .44, row.z, 1.06, .72, .72)); continue; }
          if (r < .22) { totes.push(matrix(cx + px, py + .26, row.z, 1.04, .34, .7)); continue; }
          if (r < .34) { bins.push(matrix(cx + px, py + .3, row.z, 1.02, .46, .7)); continue; }
          if (r < .62) continue;   // 约 28% 空库位：整体库存率 ~72%，空位本身就是真实感
          const stack = r < .84 ? 1 : 2;
          for (let s = 0; s < stack; s += 1) {
            const w = .7 + rand(seedIndex + s * 3) * .26;
            const hh = .3 + rand(seedIndex + s * 5) * .18;
            const dpt = .58 + rand(seedIndex + s * 7) * .14;
            const ry = (rand(seedIndex + s * 11) - .5) * .05;   // ±1.4° 摆放偏差
            const bx = cx + px + (rand(seedIndex + s) - .5) * .12;
            const by = py + .065 + hh / 2 + s * (hh + .02);
            const bz = row.z + (rand(seedIndex + s + 9) - .5) * .1;
            cartons.push(matrix(bx, by, bz, w, hh, dpt, ry));
            // 封箱胶带：只在约 1/3 的箱顶
            if (s === 0 && rand(seedIndex + s * 13) < .34) {
              tapes.push(matrix(bx, by + hh / 2 + .004, bz, w * .92, .008, .1, ry));
            }
          }
        }
      }
    }
  }

  // 框架横向拉杆：让立柱读作完整钢架，而不是悬空的细杆
  const ties: THREE.Matrix4[] = [];
  for (const row of RACK_ROWS) {
    for (let bay = 0; bay <= row.bays; bay += 1) {
      const fx = row.x0 + bay * BAY;
      for (const y of [.5, 2.2, 3.9, 5.6]) ties.push(matrix(fx, y, row.z, .09, .07, RACK_DEPTH - .12));
    }
  }

  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  // 纸箱用轻微倒角的圆角盒，边缘不再是"锐利 CG 切角"
  const cartonBox = new RoundedBoxGeometry(1, 1, 1, 2, .045);
  // 货物逐实例做轻微明度/色相抖动，消除"复制粘贴"感；可传入色板
  const tintJitter = (mesh: THREE.InstancedMesh, amount: number, seed: number, palette?: string[]) => {
    const color = new THREE.Color();
    for (let i = 0; i < mesh.count; i += 1) {
      if (palette) color.set(palette[Math.floor(rand(seed + i) * palette.length) % palette.length]);
      else {
        const f = 1 + (rand(seed + i) - .5) * amount;
        color.setRGB(
          Math.min(1, f),
          Math.min(1, f * (1 + (rand(seed + i + 1) - .5) * amount * .5)),
          Math.min(1, f * (1 - (rand(seed + i + 2) - .5) * amount * .35)),
        );
      }
      const g = 1 + (rand(seed + i + 7) - .5) * amount;
      color.multiplyScalar(Math.max(.6, g));
      mesh.setColorAt(i, color);
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  };
  const rackGroup = new THREE.Group();
  const uprightsMesh = buildInstanced(unitBox, materials.steelGalv, uprights)!;
  rackGroup.add(uprightsMesh);
  const tiesMesh = buildInstanced(unitBox, materials.steelDark, ties)!;
  tintJitter(tiesMesh, .07, 241);
  rackGroup.add(tiesMesh);
  rackGroup.add(buildInstanced(unitBox, materials.beamOrange, beams)!);
  rackGroup.add(buildInstanced(unitBox, materials.deck, decks)!);
  rackGroup.add(buildInstanced(unitBox, materials.steelDark, feet)!);
  rackGroup.add(buildInstanced(unitBox, materials.wood, pallets)!);
  const cartonMesh = buildInstanced(cartonBox, materials.cardboard, cartons)!;
  const tapeMesh = buildInstanced(unitBox, materials.tape, tapes)!;
  const toteMesh = buildInstanced(unitBox, materials.tote, totes)!;
  const binMesh = buildInstanced(unitBox, materials.bin, bins)!;
  const wrapMesh = buildInstanced(unitBox, materials.wrap, wraps)!;
  // 纸箱用 6 种牛皮纸色 + 轻微明度抖动，消除复制粘贴感
  const KRAFT = ['#a8845c', '#bb9869', '#93714c', '#c3a276', '#8a6844', '#b08a5f'];
  tintJitter(cartonMesh, .12, 31, KRAFT);
  tintJitter(toteMesh, .14, 113);
  tintJitter(binMesh, .12, 151);
  tintJitter(wrapMesh, .1, 193);
  tintJitter(uprightsMesh, .07, 211);
  for (const mesh of [cartonMesh, tapeMesh, toteMesh, binMesh, wrapMesh]) if (mesh) rackGroup.add(mesh);

  // 少数箱体贴物流标签（约 12%）
  const labelMatrices: THREE.Matrix4[] = [];
  const labelPos = new THREE.Vector3();
  const labelScale = new THREE.Vector3();
  let labelSeed = 500;
  for (const m of cartons) {
    labelSeed += 1;
    if (rand(labelSeed) > .14) continue;
    labelPos.setFromMatrixPosition(m);
    labelScale.setFromMatrixScale(m);
    labelMatrices.push(matrix(labelPos.x, labelPos.y, labelPos.z + labelScale.z / 2 + .008, Math.min(.3, labelScale.x * .34), Math.min(.22, labelScale.z * .3), 1));
  }
  const labelSheet = labelSheetTexture();
  const labelMaterial = new THREE.MeshStandardMaterial({ map: labelSheet, roughness: .82, metalness: 0 });
  rackGroup.add(buildInstanced(new THREE.PlaneGeometry(1, 1), labelMaterial, labelMatrices, false, false)!);

  // 端头防撞护角：只在少数排两端，不铺满
  const guards: THREE.Matrix4[] = [];
  for (const row of [RACK_ROWS[0], RACK_ROWS[2], RACK_ROWS[4]]) {
    for (const sx of [-.3, row.bays * BAY + .3]) {
      guards.push(matrix(row.x0 + sx, .42, row.z, .2, .84, RACK_DEPTH + .25));
      guards.push(matrix(row.x0 + sx, .93, row.z, .3, .1, RACK_DEPTH + .35));
    }
  }
  const guardYellow = new THREE.MeshStandardMaterial({ color: '#c8912c', roughness: .62, metalness: .2 });
  rackGroup.add(buildInstanced(unitBox, guardYellow, guards)!);
  scene.add(rackGroup);

  // 库区 / 门编号标识：极少量，增加真实运营空间感（不是 HUD）
  const signage = new THREE.Group();
  const addSign = (text: string, x: number, y: number, z: number, w: number, h: number, ry: number, fg: string, bg: string) => {
    const texture = signTexture(text, fg, bg);
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: texture, roughness: .6, metalness: .1, emissive: bg, emissiveIntensity: .18 }));
    plane.position.set(x, y, z);
    plane.rotation.y = ry;
    signage.add(plane);
    return texture;
  };
  const signTextures = [
    addSign('DB-01', -17.4, 4.85, 6.4, 1.5, .55, Math.PI / 2, '#eaf3f7', '#1d4d63'),
    addSign('DB-02', -17.4, 4.85, -7.2, 1.5, .55, Math.PI / 2, '#eaf3f7', '#1d4d63'),
    addSign('A 区', -8.5, 6.4, -13.3, 1.6, .6, 0, '#eaf3f7', '#2b4a63'),
    addSign('B 区', 3.5, 6.4, -13.3, 1.6, .6, 0, '#eaf3f7', '#5c4a1e'),
    addSign('C 区', 12.5, 6.4, -13.3, 1.6, .6, 0, '#eaf3f7', '#5c2327'),
    addSign('安全出口', -17.4, 5.6, 2.7, 1.7, .55, Math.PI / 2, '#dff6ea', '#1c5c3a'),
  ];
  scene.add(signage);

  /* ------------------------ 数字孪生 Overlay ------------------------ */
  const overlay = new THREE.Group();
  const zoneColor = { blue: '#4f8fd6', cyan: '#2ad4e6', amber: '#e8a13c', red: '#e0464f' } as const;
  const zoneObjects: Array<{ object: THREE.Object3D; zone: typeof twinZones[number] }> = [];
  for (const zone of twinZones) {
    const tint = zoneColor[zone.tone];
    const fill = new THREE.Mesh(
      new THREE.PlaneGeometry(zone.width, zone.depth),
      new THREE.MeshBasicMaterial({ color: tint, transparent: true, opacity: zone.tone === 'red' ? .07 : .04, depthWrite: false, side: THREE.DoubleSide }),
    );
    fill.rotation.x = -Math.PI / 2;
    fill.position.set(zone.x, .022, zone.z);
    overlay.add(fill);
    zoneObjects.push({ object: fill, zone });
    const border = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(zone.width, .02, zone.depth)),
      new THREE.LineBasicMaterial({ color: tint, transparent: true, opacity: .7 }),
    );
    border.position.set(zone.x, .03, zone.z);
    overlay.add(border);
    zoneObjects.push({ object: border, zone });
  }

  const routeCurve = new THREE.CatmullRomCurve3(ROUTE_POINTS.map(([x, z]) => new THREE.Vector3(x, .06, z)), false, 'catmullrom', .02);
  const routeMat = new THREE.MeshStandardMaterial({ color: '#2ad4e6', emissive: '#1a8b98', emissiveIntensity: .34, roughness: .42, metalness: .1 });
  const routeTrafficMat = new THREE.MeshStandardMaterial({ color: '#39e0f0', emissive: '#25aebd', emissiveIntensity: .95, roughness: .35, metalness: .1 });
  const route = new THREE.Mesh(new THREE.TubeGeometry(routeCurve, 240, .05, 6, false), routeMat);
  route.castShadow = false;
  overlay.add(route);
  scene.add(overlay);

  /* ------------------------------ 灯光 ------------------------------ */
  scene.add(new THREE.HemisphereLight('#c6d0d7', '#2c3135', .45));
  scene.add(new THREE.AmbientLight('#3d444a', .24));

  const sun = new THREE.DirectionalLight('#f2f5f8', 1.95);
  sun.position.set(-18, 26, 14);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -24;
  sun.shadow.camera.right = 24;
  sun.shadow.camera.top = 22;
  sun.shadow.camera.bottom = -22;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 72;
  sun.shadow.bias = -.0004;
  sun.shadow.normalBias = .022;
  scene.add(sun);

  const fillLight = new THREE.DirectionalLight('#b7c6d2', .3);
  fillLight.position.set(16, 14, -12);
  scene.add(fillLight);

  const ceilingLights = new THREE.Group();
  // 灯带只落在主要巷道上方：巷道亮、墙角暗，形成纵深
  for (const z of [-8.6, -2.9, 2.3, 6.9]) {
    const rect = new THREE.RectAreaLight('#f2f5f0', 2.9, 26, .5);
    rect.position.set(0, EAVE - .8, z);
    rect.lookAt(0, 0, z);
    ceilingLights.add(rect);
  }
  scene.add(ceilingLights);

  /* ------------------------------ 设备 ------------------------------ */
  const movers = options.vehicles.map((vehicle, index) => {
    const { group, wheels } = createAmr(vehicle, materials);
    scene.add(group);
    return { item: group, vehicle, wheels, offset: index / options.vehicles.length };
  });
  const pickables = movers.map(({ item }) => item);

  /* ------------------------------ 相机 ------------------------------ */
  const camera = new THREE.PerspectiveCamera(42, 1, .1, 400);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = .075;
  controls.minPolarAngle = .45;
  controls.maxPolarAngle = 1.36;
  controls.minDistance = 6;
  controls.maxDistance = 68;
  controls.target.set(0, 1.4, 0);

  /* ---------------------------- 后处理 ---------------------------- */
  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.addPass(new RenderPass(scene, camera));
  const gtao = new GTAOPass(scene, camera, 1, 1);
  gtao.output = GTAOPass.OUTPUT.Default;
  gtao.blendIntensity = .88;
  gtao.updateGtaoMaterial({ radius: .55, distanceExponent: 1.2, thickness: 1.4, scale: 1, samples: 16 });
  composer.addPass(gtao);
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), .14, .45, .92);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  composer.addPass(new SMAAPass());

  /* ------------------------ 尺寸 / 渲染循环 ------------------------ */
  let width = 1;
  let height = 1;
  let frame = 0;
  let disposed = false;
  let top = false;
  let planAutoTop = false;
  let layer = options.layer;
  let running = options.running;
  let speed = options.speed;
  let elapsed = 0;
  let lastTime = 0;
  let faded = false;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const reset = () => {
    const distance = top ? 34 : 29;
    const polar = top ? .12 : .98; // 约 34° 俯视，前排货架可遮挡后排
    const azimuth = -.72;
    camera.position.set(
      controls.target.x + distance * Math.sin(polar) * Math.sin(azimuth),
      controls.target.y + distance * Math.cos(polar),
      controls.target.z + distance * Math.sin(polar) * Math.cos(azimuth),
    );
    controls.update();
  };
  const resize = () => {
    width = Math.max(1, host.clientWidth);
    height = Math.max(1, host.clientHeight);
    renderer.setSize(width, height, false);
    composer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    reset();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let down = { x: 0, y: 0 };
  const onDown = (event: PointerEvent) => { down = { x: event.clientX, y: event.clientY }; };
  const onUp = (event: PointerEvent) => {
    if (Math.hypot(event.clientX - down.x, event.clientY - down.y) > 6) return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(pickables, true)[0]?.object;
    const id = hit?.userData.id ?? hit?.parent?.userData.id;
    if (typeof id === 'string') options.onPick(id);
  };
  const onContextLost = (event: Event) => {
    event.preventDefault();
    renderer.domElement.dataset.ready = 'false';
    options.onError('场景暂时中断，请重新加载。');
  };
  renderer.domElement.addEventListener('pointerdown', onDown);
  renderer.domElement.addEventListener('pointerup', onUp);
  renderer.domElement.addEventListener('webglcontextlost', onContextLost);

  const setLayerVisibility = () => {
    const plan = layer === 'plan';
    const heat = layer === 'heat';
    structure.visible = !plan;
    rackGroup.visible = !plan;
    ceilingLights.visible = !plan;
    route.visible = !plan && !heat;
    for (const { object, zone } of zoneObjects) {
      object.visible = !plan && (!heat || zone.tone === 'amber' || zone.tone === 'red');
    }
    movers.forEach(({ item, vehicle }) => {
      item.visible = !plan && (!heat || vehicle.status === 'alert' || vehicle.status === 'charging');
    });
    route.material = layer === 'traffic' ? routeTrafficMat : routeMat;
    if (plan && !planAutoTop) {
      planAutoTop = true;
      top = true;
      controls.maxPolarAngle = .2;
      reset();
    } else if (!plan && planAutoTop) {
      planAutoTop = false;
      top = false;
      controls.maxPolarAngle = 1.36;
      reset();
    }
  };

  function pathPose(curve: THREE.CatmullRomCurve3, progress: number) {
    const t = THREE.MathUtils.clamp(progress, 0, 1);
    const delta = .0006;
    const point = curve.getPoint(t);
    const before = curve.getPoint(Math.max(0, t - delta));
    const after = curve.getPoint(Math.min(1, t + delta));
    const direction = after.sub(before);
    return { point, yaw: direction.lengthSq() > 1e-10 ? -Math.atan2(direction.z, direction.x) : 0 };
  }

  const render = (time: number) => {
    frame = 0;
    if (disposed || document.hidden) return;
    try {
      const dt = lastTime ? Math.min(.05, (time - lastTime) / 1000) : 0;
      lastTime = time;
      const moving = running && !reduced;
      if (moving) elapsed += dt;
      movers.forEach(({ item, offset, wheels }) => {
        const phase = (offset + elapsed * .021 * speed) % 2;
        const progress = phase <= 1 ? phase : 2 - phase;
        const pose = pathPose(routeCurve, progress);
        item.position.set(pose.point.x, 0, pose.point.z);
        item.rotation.y = pose.yaw;
        if (moving) wheels.forEach((wheel) => { wheel.rotation.z += dt * speed * 4.2; });
      });
      setLayerVisibility();
      controls.update();
      composer.render();
      renderer.domElement.dataset.ready = 'true';
      if (!faded) {
        faded = true;
        renderer.domElement.style.opacity = '1';
      }
      schedule();
    } catch (error) {
      renderer.domElement.dataset.ready = 'false';
      options.onError('场景暂时中断，请点击重试。');
    }
  };

  const schedule = () => {
    if (!disposed && !document.hidden && !frame) frame = requestAnimationFrame(render);
  };
  const onVisibility = () => {
    if (document.hidden) {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      lastTime = 0;
    } else {
      lastTime = 0;
      schedule();
    }
  };
  document.addEventListener('visibilitychange', onVisibility);
  setLayerVisibility();
  schedule();

  return {
    reset,
    zoom: (factor) => { camera.position.sub(controls.target).multiplyScalar(factor).add(controls.target); controls.update(); },
    toggleTop: () => { top = !top; reset(); return top; },
    setLayer: (next) => { layer = next; setLayerVisibility(); },
    update: (state) => { running = state.running; speed = state.speed; },
    dispose: () => {
      disposed = true;
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointerup', onUp);
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
      controls.dispose();
      disposeObject(scene);
      floorTexture.dispose();
      floorRough.dispose();
      hazardTex.dispose();
      labelSheet.dispose();
      signTextures.forEach((texture) => texture.dispose());
      envTexture.dispose();
      gtao.dispose();
      bloom.dispose();
      composer.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
