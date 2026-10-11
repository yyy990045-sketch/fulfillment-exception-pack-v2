import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { Placement, Scenario, Step } from './data';

export interface PackingInput { scenario:Scenario; positions:Placement[] }
export interface PackingState {
 remaining:string[]; highlighted:string[]; blocking:string[]; selected?:string;
 step?:Step; progress:number; exterior:boolean; doorsOpen?:boolean;
 changed?:string[];
}

// Geometry extension only: renderer, controls, lights, picking and lifecycle are
// owned by the existing logistics createScene, rather than a second 3D engine.
export function addPackingObjects(scene:THREE.Scene, pickables:THREE.Object3D[], input:PackingInput) {
 const {width:W,height:H,length:L}=input.scenario.vehicles[0].compartment;
 const floorY=.95, root=new THREE.Group(), shell=new THREE.Group();
 scene.add(root);root.add(shell);
 const textures:THREE.Texture[]=[];
 let alive=true;
 const steel=new THREE.MeshStandardMaterial({color:'#42525e',metalness:.7,roughness:.35,envMapIntensity:.7});
 const floorSteel=new THREE.MeshStandardMaterial({color:'#66747d',metalness:.58,roughness:.42,envMapIntensity:.65});
 const panels=new THREE.MeshPhysicalMaterial({color:'#9ab3c1',metalness:.15,roughness:.3,transparent:true,opacity:.07,depthWrite:false,side:THREE.DoubleSide});
 const wallMat=new THREE.MeshStandardMaterial({color:'#71818a',metalness:.38,roughness:.5,envMapIntensity:.5});
 function box(parent:THREE.Group,x:number,y:number,z:number,w:number,h:number,d:number,material:THREE.Material) {
  const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),material);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;
 }
 function label(text:string,color:string,w=2,h=.5) {
  const c=document.createElement('canvas');c.width=512;c.height=128;const ctx=c.getContext('2d')!;
  ctx.fillStyle=color;ctx.font='600 40px sans-serif';ctx.textAlign='center';ctx.fillText(text,256,78);
  const tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;textures.push(tex);
  const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,transparent:true,depthTest:false}));sprite.scale.set(w,h,1);return sprite;
 }
 box(root,0,floorY-.1,0,L+.16,.2,W+.16,floorSteel);
 for(let z=-W/2+.18;z<W/2-.12;z+=.34) box(root,0,floorY+.012,z,L-.18,.025,.045,steel);
 box(root,0,.58,0,L+.3,.2,W*.72,new THREE.MeshStandardMaterial({color:'#202b33',metalness:.7,roughness:.5}));
 for(const x of [-L/2,L/2]) for(const z of [-W/2,W/2]) box(root,x,floorY+H/2,z,.035,H,.035,steel);
 for(const z of [-W/2,W/2]) for(const y of [floorY,floorY+H]) box(root,0,y,z,L,.035,.035,steel);
 for(const z of [-W/2+.04,W/2-.04]) for(let x=-L/2+.42;x<L/2-.2;x+=.62) box(root,x,floorY+H*.54,z,.025,H*.72,.04,wallMat);
 box(shell,0,floorY+H,0,L,.025,W,panels);
 for(const z of [-W/2,W/2]) box(shell,0,floorY+H/2,z,L,H,.025,panels);
 box(shell,-L/2,floorY+H/2,0,.025,H,W,panels);
 // Rear doors stay open during extraction; a separate closed door panel makes
 // the exterior/inspection state legible without changing the cargo geometry.
 const openDoors=new THREE.Group();root.add(openDoors);
 for(const z of [-W/2-.55,W/2+.55]) box(openDoors,L/2+.04,floorY+H/2,z,.045,H,1.0,steel);
 const closedDoor=box(root,L/2+.015,floorY+H/2,0,.05,H-.08,W-.08,wallMat);
 for(const z of [-W/4,W/4]) box(root,L/2+.045,floorY+H/2,z,.035,H-.16,.035,steel);
 for(const y of [floorY+.3,floorY+H-.3]) box(root,L/2+.05,y,0,.04,.04,W-.2,steel);
 const handle=box(root,L/2+.08,floorY+H*.52,0,.04,.18,.06,steel);
 for(const x of [-L/2+.9,L/2-1.05]) for(const z of [-W/2,W/2]) {
  const tire=new THREE.Mesh(new THREE.CylinderGeometry(.39,.39,.25,32),new THREE.MeshStandardMaterial({color:'#101820',roughness:.85}));
  tire.rotation.x=Math.PI/2;tire.position.set(x,.4,z);root.add(tire);
  const rim=new THREE.Mesh(new THREE.CylinderGeometry(.23,.23,.27,24),steel);rim.rotation.x=Math.PI/2;rim.position.copy(tire.position);root.add(rim);
 }
 const grid=new THREE.GridHelper(Math.max(L+3,12),24,'#354956','#243440');grid.position.y=.01;root.add(grid);
 const ground=new THREE.Mesh(new THREE.PlaneGeometry(80,80),new THREE.MeshStandardMaterial({color:'#111c24',roughness:.87,metalness:.08}));
 ground.rotation.x=-Math.PI/2;ground.receiveShadow=true;root.add(ground);
 const dimension=label(`${L.toFixed(1)} m · 后门直线取货 →`,'#93b1c4',4,.45);dimension.position.set(.4,.24,W/2+.55);root.add(dimension);
 const door=label('后门 / 卸货出口','#cbdde7',2,.35);door.position.set(L/2+.4,floorY+H+.22,0);root.add(door);
 const cargoMeshes=new Map<string,THREE.Group>();
 const cargoById=new Map(input.scenario.cargo.map(c=>[c.cargoId,c]));
 const positionById=new Map(input.positions.map(p=>[p.cargoId,p]));
 const world=(p:{x:number;y:number;z:number},item:Placement)=>new THREE.Vector3(p.z+item.length/2-L/2,p.y+item.height/2+floorY,W/2-p.x-item.width/2);
 const corridor=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshBasicMaterial({color:'#efb76f',transparent:true,opacity:.1,depthWrite:false}));
 const corridorEdge=new THREE.LineSegments(new THREE.EdgesGeometry(corridor.geometry),new THREE.LineBasicMaterial({color:'#e9b771',transparent:true,opacity:.7}));corridor.add(corridorEdge);corridor.visible=false;root.add(corridor);
 for(const p of input.positions) {
  const c=cargoById.get(p.cargoId)!;const g=new THREE.Group();g.position.copy(world(p,p));
  const material=new THREE.MeshStandardMaterial({color:c.color,roughness:.72,metalness:.02,envMapIntensity:.35});
  const mesh=new THREE.Mesh(new RoundedBoxGeometry(p.length,p.height,p.width,4,.035),material);mesh.castShadow=true;mesh.receiveShadow=true;mesh.userData={kind:'cargo',id:p.cargoId};g.add(mesh);pickables.push(mesh);
  const edge=new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry),new THREE.LineBasicMaterial({color:'#dce6eb',transparent:true,opacity:.35}));g.add(edge);
  const tape=new THREE.MeshStandardMaterial({color:'#e2dbbe',roughness:.8,transparent:true,opacity:.45});
  box(g,0,p.height/2+.002,0,.11,.004,p.width,tape);
  box(g,0,p.height/2+.004,0,p.length-.16,.008,.025,tape);
  box(g,p.length/2-.055,0,0,.025,p.height-.16,.025,tape);
  const tag=label(p.cargoId,c.fragile?'#fff1dd':'#f8fcff',.65,.17);tag.position.set(0,p.height/2+.11,0);g.add(tag);
  root.add(g);cargoMeshes.set(p.cargoId,g);
 }
 // Reuse the real GLB cab as an explicitly adapted exterior reference. Its
 // dimensions never determine compartment geometry or cargo positions.
 new GLTFLoader().load(`${import.meta.env.BASE_URL}assets/models/tractor-cabover-sleeper.glb`, gltf=>{
  if(!alive){gltf.scene.traverse(o=>{if(o instanceof THREE.Mesh)o.geometry.dispose();});return;}
  const cab=gltf.scene;cab.getObjectByName('fifth-wheel')?.removeFromParent();
  cab.rotation.y=-Math.PI/2;cab.updateMatrixWorld(true);
  const bounds=new THREE.Box3().setFromObject(cab),size=bounds.getSize(new THREE.Vector3());
  const scale=W/size.z;cab.scale.setScalar(scale);cab.updateMatrixWorld(true);
  const resized=new THREE.Box3().setFromObject(cab),center=resized.getCenter(new THREE.Vector3());
  cab.position.set(-L/2-1.1-center.x,-resized.min.y,-center.z);
  cab.traverse(o=>{if(o instanceof THREE.Mesh){o.castShadow=true;o.receiveShadow=true;const mats=Array.isArray(o.material)?o.material:[o.material];mats.forEach(m=>{if(m instanceof THREE.MeshStandardMaterial){m.envMapIntensity=.8;if(m.name==='paint')m.color.set('#718999');}});}});
  root.add(cab);
 },undefined,()=>{ /* Compartment remains usable if optional exterior fails. */ });
 function update(state:PackingState) {
  panels.opacity=state.exterior?1:.07;panels.depthWrite=state.exterior;
  const doorsOpen=state.doorsOpen!==false&&!state.exterior;openDoors.visible=doorsOpen;closedDoor.visible=!doorsOpen;handle.visible=!doorsOpen;
  const target=state.highlighted.map(id=>positionById.get(id)).find(p=>p&&state.remaining.includes(p.cargoId));
  corridor.visible=Boolean(target&&state.blocking.length&&!state.exterior);
  if(target){const reach=L-target.z-target.length;corridor.scale.set(Math.max(.01,reach),target.height,target.width);corridor.position.set(target.z+target.length+reach/2-L/2,target.y+target.height/2+floorY,W/2-target.x-target.width/2);}
  for(const [id,g] of cargoMeshes) {
   const p=positionById.get(id)!;const c=cargoById.get(id)!;g.position.copy(world(p,p));
   g.visible=state.remaining.includes(id);
   if(state.step?.operation==='unload' && state.step.cargoId===id && state.step.movement && state.progress<1) {
    g.visible=true;const eased=state.progress*state.progress*(3-2*state.progress);g.position.copy(world(state.step.movement.from,p)).lerp(world(state.step.movement.to,p),eased);
   }
   const mesh=g.children[0] as THREE.Mesh<THREE.BoxGeometry,THREE.MeshStandardMaterial>;
   const blocked=state.blocking.includes(id),target=state.highlighted.includes(id),selected=state.selected===id;
   mesh.material.color.set(blocked?'#ee836e':target?'#f3b46c':c.color);
   mesh.material.emissive.set(selected?'#d4eaff':target?c.color:blocked?'#ad382b':'#000000');
   mesh.material.emissiveIntensity=selected?.38:target?.24:blocked?.22:0;
   const edge=g.children[1] as THREE.LineSegments<THREE.EdgesGeometry,THREE.LineBasicMaterial>;
   const changed=state.changed?.includes(id);
   edge.material.color.set(selected?'#ffffff':changed?'#ffd18a':target?'#d4f7ff':blocked?'#ffb8a6':'#dce6eb');edge.material.opacity=selected||target||blocked||changed?1:.3;
  }
 }
 const fitBounds=()=>new THREE.Box3(
  new THREE.Vector3(-L/2-1.65,0,-W/2-.82),
  new THREE.Vector3(L/2+1.45,floorY+H+.7,W/2+.82),
 );
 return { update, position:(id:string)=>cargoMeshes.get(id)?.position.clone(), fitBounds, dispose:()=>{alive=false;textures.forEach(t=>t.dispose());} };
}
