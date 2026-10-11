import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { polygonRings, project, type AreaGeometry, type Coordinate, type GeoData } from './geo-model';

export function areaShapes(geometry:AreaGeometry,origin:{lon:number;lat:number}){
 return polygonRings(geometry).map(rings=>{
  const shape=new THREE.Shape();
  rings.forEach((ring,index)=>{
   const path=index===0?shape:new THREE.Path();
   ring.forEach((coord,i)=>{const p=project(origin,coord);if(i===0)path.moveTo(p.x,-p.z);else path.lineTo(p.x,-p.z);});
   if(index>0)shape.holes.push(path);
  });return shape;
 });
}
export function buildingGeometry(geometry:AreaGeometry,origin:{lon:number;lat:number},height:number){
 const g=new THREE.ExtrudeGeometry(areaShapes(geometry,origin),{depth:height,bevelEnabled:false,steps:1,curveSegments:1});
 // Shape y is north; rotating puts extrusion up and north at world negative z.
 g.rotateX(-Math.PI/2);return g;
}
export function ribbon(coords:Coordinate[],origin:{lon:number;lat:number},width:number,y:number){
 const vertices:number[]=[];
 for(let i=1;i<coords.length;i++){
  const a=project(origin,coords[i-1]),b=project(origin,coords[i]);const d=Math.hypot(b.x-a.x,b.z-a.z);if(d<.01)continue;
  const nx=-(b.z-a.z)/d*width/2,nz=(b.x-a.x)/d*width/2;
  const points=[[a.x+nx,y,a.z+nz],[a.x-nx,y,a.z-nz],[b.x+nx,y,b.z+nz],[b.x-nx,y,b.z-nz]];
  for(const index of [0,2,1,2,3,1])vertices.push(...points[index]);
 }
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geometry.computeVertexNormals();return geometry;
}
function mergedMesh(group:THREE.Group,geometries:THREE.BufferGeometry[],material:THREE.Material|THREE.Material[],shadow=false){
 if(!geometries.length)return;
 const combined=mergeGeometries(geometries,false);geometries.forEach(g=>g.dispose());if(!combined)throw new Error('城市几何合并失败。');
 const mesh=new THREE.Mesh(combined,material);mesh.castShadow=shadow;mesh.receiveShadow=true;group.add(mesh);
}
export function buildCity(data:GeoData){
 const city=new THREE.Group(),origin=data.metadata.origin;
 const west=project(origin,[data.metadata.bbox[0],data.metadata.bbox[1]]),east=project(origin,[data.metadata.bbox[2],data.metadata.bbox[3]]);
 const ground=new THREE.Mesh(new THREE.PlaneGeometry(east.x-west.x+600,west.z-east.z+600),new THREE.MeshStandardMaterial({color:'#263c44',roughness:1}));ground.rotation.x=-Math.PI/2;ground.position.y=-.5;ground.receiveShadow=true;city.add(ground);
 const green:THREE.BufferGeometry[]=[],water:THREE.BufferGeometry[]=[];
 for(const feature of data.land.features){
  const p=feature.properties;const kind=p.natural==='water'?'water':p.leisure==='park'||['forest','grass','meadow','recreation_ground','village_green'].includes(p.landuse??'')?'green':null;if(!kind)continue;
  const g=new THREE.ShapeGeometry(areaShapes(feature.geometry,origin));g.rotateX(-Math.PI/2);g.translate(0,0,0);(kind==='water'?water:green).push(g);
 }
 mergedMesh(city,green,new THREE.MeshStandardMaterial({color:'#35574e',roughness:1,side:THREE.DoubleSide}));
 mergedMesh(city,water,new THREE.MeshStandardMaterial({color:'#244f66',roughness:.35,metalness:.15,side:THREE.DoubleSide}));
 const pavements:THREE.BufferGeometry[]=[],asphalt:THREE.BufferGeometry[]=[],paths:THREE.BufferGeometry[]=[],marks:THREE.BufferGeometry[]=[];
 const junctions=new Map<string,{coord:Coordinate;width:number;count:number}>();
 for(const road of data.roads.features){
  const p=road.properties,coords=road.geometry.coordinates;const major=['primary','secondary','tertiary'].includes(p.highway);const declared=Number(p.width),lanes=Number(p.lanes?.split(';')[0]);
  const width=Number.isFinite(declared)&&declared>0?declared:Number.isFinite(lanes)&&lanes>0?Math.max(5,lanes*3.1):major?12:p.driveAllowed?6:1.8;
  if(p.driveAllowed){
   pavements.push(ribbon(coords,origin,width+3,.04));asphalt.push(ribbon(coords,origin,width,.09));
   if(width>7)for(let i=1;i<coords.length;i++){
    const a=project(origin,coords[i-1]),b=project(origin,coords[i]);const length=Math.hypot(b.x-a.x,b.z-a.z);
    for(let d=0;d+4<length;d+=12){const t=d/length,u=(d+4)/length;const start:Coordinate=[coords[i-1][0]+(coords[i][0]-coords[i-1][0])*t,coords[i-1][1]+(coords[i][1]-coords[i-1][1])*t];const end:Coordinate=[coords[i-1][0]+(coords[i][0]-coords[i-1][0])*u,coords[i-1][1]+(coords[i][1]-coords[i-1][1])*u];marks.push(ribbon([start,end],origin,.28,.13));}
   }
   for(const coord of [coords[0],coords.at(-1)!]){const key=coord.join(',');const old=junctions.get(key);junctions.set(key,{coord,width:Math.max(width,old?.width??0),count:(old?.count??0)+1});}
  }else paths.push(ribbon(coords,origin,width,.025));
 }
 for(const node of junctions.values())if(node.count>1){const pt=project(origin,node.coord);const disk=new THREE.CircleGeometry(node.width/2,16).toNonIndexed();disk.deleteAttribute('uv');disk.rotateX(-Math.PI/2);disk.translate(pt.x,.1,pt.z);asphalt.push(disk);}
 mergedMesh(city,paths,new THREE.MeshStandardMaterial({color:'#4e6467',roughness:1,side:THREE.DoubleSide}));
 mergedMesh(city,pavements,new THREE.MeshStandardMaterial({color:'#80918e',roughness:1,side:THREE.DoubleSide}));
 mergedMesh(city,asphalt,new THREE.MeshStandardMaterial({color:'#35454d',roughness:1,side:THREE.DoubleSide}));
 mergedMesh(city,marks,new THREE.MeshBasicMaterial({color:'#d1d1b8',side:THREE.DoubleSide}));
 const roofs:THREE.BufferGeometry[][]=[[],[],[],[]],walls:THREE.BufferGeometry[][]=[[],[],[],[]],edges:THREE.BufferGeometry[]=[];
 for(const feature of data.buildings.features){
  const h=feature.properties.heightM??6,bucket=h<10?0:h<20?1:h<35?2:3;
  const g=buildingGeometry(feature.geometry,origin,h);edges.push(new THREE.EdgesGeometry(g,30));
  // ExtrudeGeometry groups distinguish roofs from vertical facades.
  const position=g.getAttribute('position'),normal=g.getAttribute('normal');
  for(const group of g.groups){const part=new THREE.BufferGeometry();part.setAttribute('position',new THREE.Float32BufferAttribute(Array.from(position.array).slice(group.start*3,(group.start+group.count)*3),3));part.setAttribute('normal',new THREE.Float32BufferAttribute(Array.from(normal.array).slice(group.start*3,(group.start+group.count)*3),3));(group.materialIndex===0?roofs:walls)[bucket].push(part);}
  g.dispose();
 }
 const roofColors=['#b6c5c4','#d1d7cf','#d9d3c1','#dadccf'],wallColors=['#68838d','#8199a0','#8299a6','#93aab3'];
 for(let i=0;i<4;i++){mergedMesh(city,roofs[i],new THREE.MeshStandardMaterial({color:roofColors[i],roughness:.9}),true);mergedMesh(city,walls[i],new THREE.MeshStandardMaterial({color:wallColors[i],roughness:.9}),true);}
 if(edges.length){const g=mergeGeometries(edges,false)!;edges.forEach(e=>e.dispose());city.add(new THREE.LineSegments(g,new THREE.LineBasicMaterial({color:'#3e5863',transparent:true,opacity:.48})));}
 return city;
}
export function disposeGroup(group:THREE.Object3D){
 group.traverse(object=>{if(object instanceof THREE.Mesh||object instanceof THREE.Line){object.geometry.dispose();const materials=Array.isArray(object.material)?object.material:[object.material];materials.forEach(m=>m.dispose());}});
}
