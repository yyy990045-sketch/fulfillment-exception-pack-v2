import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Focus, Minus, Plus, RotateCcw, TriangleAlert, Warehouse } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCityProduct } from './state';
import { GEO_BASE, geoRegion, matchesGeoInput, project, routesOnNetwork, type GeoData } from './geo-model';
import { buildCity, disposeGroup, ribbon } from './geo-scene';

const colorForVehicle=(id:string)=>({V01:'#45e7b5',V02:'#56acff',V03:'#d098ff'} as Record<string,string>)[id]??'#ffc175';
interface MapRuntime {routes:THREE.Group;markers:Map<string,THREE.Mesh>;invalidate:()=>void;zoom:(factor:number)=>void;reset:()=>void;close:()=>void;focus:(stopId:string)=>void}
export function GeoCityMap({overview=false,simulation=false}:{overview?:boolean;simulation?:boolean}){
 const p=useCityProduct(),region=geoRegion(p.mode,p.scenario.scenarioId)!;
 const host=useRef<HTMLDivElement>(null),labels=useRef(new Map<string,HTMLButtonElement>()),runtime=useRef<MapRuntime|null>(null);
 const [data,setData]=useState<GeoData|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true);
 const currentSelection=useRef(p.selectedStopId);currentSelection.current=p.selectedStopId;
 useEffect(()=>{
  const controller=new AbortController();setLoading(true);setError('');setData(null);
  Promise.all(['metadata.json','buildings.geojson','roads.geojson','land.geojson','paths.json'].map(name=>fetch(`${GEO_BASE}${region}/${name}`,{signal:controller.signal}).then(r=>{if(!r.ok)throw new Error('离线城市数据读取失败。');return r.json();})))
   .then(([metadata,buildings,roads,land,paths])=>setData({metadata,buildings,roads,land,paths}))
   .catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:'离线城市数据读取失败。');})
   .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  return ()=>controller.abort();
 },[region]);
 const roadResult=useMemo(()=>{
  if(!data)return {routes:[],error:''};
  if(!matchesGeoInput(data,p.scenario))return {routes:[],error:'当前坐标或距离矩阵与离线路网不一致，暂停路线叠加。请重新导入地理任务。'};
  try{return {routes:routesOnNetwork(data,p.current),error:''};}catch(e){return {routes:[],error:e instanceof Error?e.message:'当前计划没有可核验的道路路径。'};}
 },[data,p.scenario,p.current]);

 // Buildings, streets and camera live for the region lifetime; selection only updates overlays.
 useEffect(()=>{
  if(!host.current||!data)return;
  const element=host.current,origin=data.metadata.origin;
  let renderer:THREE.WebGLRenderer;
  try{renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance',preserveDrawingBuffer:true});}
  catch{setError('此浏览器无法启动 WebGL，请使用支持硬件加速的浏览器。');return;}
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.setClearColor('#243640');element.appendChild(renderer.domElement);
  const scene=new THREE.Scene();scene.background=new THREE.Color('#243640');scene.add(new THREE.HemisphereLight('#f4f3e3','#385161',2));
  const sun=new THREE.DirectionalLight('#fff4de',3);sun.position.set(-800,1600,800);scene.add(sun);
  scene.add(buildCity(data));const routes=new THREE.Group();scene.add(routes);
  const markerGroup=new THREE.Group(),markers=new Map<string,THREE.Mesh>();scene.add(markerGroup);
  for(const stop of data.paths.locations){
   const point=project(origin,[stop.lon,stop.lat]),depot=stop.stopId==='DEPOT';
   const mesh=new THREE.Mesh(new THREE.CylinderGeometry(depot?14:8,depot?14:8,3,20),new THREE.MeshBasicMaterial({color:depot?'#ffc46b':'#a9bdc7',depthTest:false}));mesh.position.set(point.x,4,point.z);mesh.renderOrder=30;markerGroup.add(mesh);markers.set(stop.stopId,mesh);
  }
  const camera=new THREE.PerspectiveCamera(42,1,1,18000),controls=new OrbitControls(camera,renderer.domElement);
  controls.enableDamping=true;controls.dampingFactor=.1;controls.minDistance=140;controls.maxDistance=9000;controls.maxPolarAngle=Math.PI*.46;
  const west=project(origin,[data.metadata.bbox[0],data.metadata.bbox[1]]),east=project(origin,[data.metadata.bbox[2],data.metadata.bbox[3]]),extent=Math.max(east.x-west.x,west.z-east.z);
  const reset=()=>{controls.target.set(0,0,0);camera.position.set(extent*.22,extent*.96,extent*1.02);controls.update();};
  const focus=(stopId:string)=>{const marker=markers.get(stopId);if(!marker)return;const offset=camera.position.clone().sub(controls.target);controls.target.copy(marker.position);camera.position.copy(marker.position).add(offset);controls.update();};
  const close=()=>{const point=markers.get(currentSelection.current)?.position??new THREE.Vector3();controls.target.copy(point);camera.position.copy(point).add(new THREE.Vector3(180,340,430));controls.update();};
  let dirty=true;const invalidate=()=>{dirty=true;};controls.addEventListener('change',invalidate);
  reset();runtime.current={routes,markers,invalidate,reset,close,focus,zoom:factor=>{camera.position.sub(controls.target).multiplyScalar(factor).add(controls.target);controls.update();}};
  const resize=()=>{const width=Math.max(1,element.clientWidth),height=Math.max(1,element.clientHeight);renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();invalidate();};
  const observer=new ResizeObserver(resize);observer.observe(element);resize();
  let frame=0;const projected=new THREE.Vector3();
  const render=()=>{
   controls.update();
   if(dirty){dirty=false;renderer.render(scene,camera);
   for(const [id,button] of labels.current){const mesh=markers.get(id);if(!mesh)continue;projected.copy(mesh.position).add(new THREE.Vector3(0,18,0)).project(camera);const visible=projected.z<1&&Math.abs(projected.x)<.96&&Math.abs(projected.y)<.96;button.style.visibility=visible?'visible':'hidden';button.style.left=`${(projected.x+1)/2*element.clientWidth}px`;button.style.top=`${(1-projected.y)/2*element.clientHeight}px`;}
   element.dataset.camera=[...camera.position.toArray(),...controls.target.toArray()].map(n=>n.toFixed(3)).join(',');}
   frame=requestAnimationFrame(render);
  };frame=requestAnimationFrame(render);
  return ()=>{cancelAnimationFrame(frame);observer.disconnect();controls.dispose();disposeGroup(scene);renderer.dispose();renderer.domElement.remove();runtime.current=null;};
 },[data]);
 useEffect(()=>{
  const map=runtime.current;if(!map||!data)return;disposeGroup(map.routes);map.routes.clear();
  for(const route of roadResult.routes){if(!route.coordinates.length)continue;const group=new THREE.Group();group.userData.vehicleId=route.vehicleId;
   const outline=new THREE.Mesh(ribbon(route.coordinates,data.metadata.origin,10,.62),new THREE.MeshBasicMaterial({color:'#182c3d',side:THREE.DoubleSide}));
   const path=new THREE.Mesh(ribbon(route.coordinates,data.metadata.origin,6,.72),new THREE.MeshBasicMaterial({color:colorForVehicle(route.vehicleId),side:THREE.DoubleSide,transparent:true}));group.add(outline,path);map.routes.add(group);
  }
  map.invalidate();
 },[data,roadResult]);
 useEffect(()=>{
  const map=runtime.current;if(!map)return;
  for(const group of map.routes.children){const selected=group.userData.vehicleId===p.vehicleId;for(const object of group.children){const mesh=object as THREE.Mesh;const material=mesh.material as THREE.MeshBasicMaterial;material.opacity=selected?1:.74;mesh.renderOrder=selected?10:0;mesh.position.y=selected?.3:0;}}
  for(const [id,mesh] of map.markers){const vehicle=p.current.routes.find(r=>r.stopOrder.includes(id));const material=mesh.material as THREE.MeshBasicMaterial;material.color.set(id==='DEPOT'?'#ffc46b':colorForVehicle(vehicle?.vehicleId??''));mesh.scale.setScalar(id===p.selectedStopId?1.5:1);}
  map.invalidate();
 },[data,roadResult,p.vehicleId,p.selectedStopId,p.current]);
 const selected=p.scenario.stops.find(s=>s.stopId===p.selectedStopId),arrival=p.route.arrivals.find(a=>a.stopId===p.selectedStopId),pieces=p.scenario.cargo.filter(c=>c.stopId===p.selectedStopId&&p.route.cargoIds.includes(c.cargoId)).length;
 return <div className={`p-map p-geo-city-map ${overview?'p-map-overview':''}`} data-geo-region={region} data-geo-plan={p.current.planId} data-geo-routes={JSON.stringify(roadResult.routes.map(r=>({vehicleId:r.vehicleId,stopOrder:r.stopOrder,km:r.networkDistanceKm,minutes:r.networkTravelMinutes,points:r.coordinates.length})))}>
  <div ref={host} className="p-geo-city-host"/>
  <div className="p-map-title"><span><Warehouse size={15}/>{region==='berlin'?'Mitte · 城市配送路网':'杭州城西 · 历史配送空间'}</span><small>{data?`${data.metadata.buildingCount} 栋建筑 · ${data.metadata.roadCount} 条道路`:'读取离线城市'}{simulation?' · 模拟作业，非 GPS':''}</small></div>
  <div className="p-geo-labels">{data?.paths.locations.map(stop=>{const route=p.current.routes.find(r=>r.stopOrder.includes(stop.stopId)),selected=stop.stopId===p.selectedStopId,depot=stop.stopId==='DEPOT';return <button key={stop.stopId} ref={el=>{if(el)labels.current.set(stop.stopId,el);else labels.current.delete(stop.stopId);}} data-geo-stop={stop.stopId} aria-label={`地图定位${stop.name}`} className={`${selected?'is-current':''} ${route?.vehicleId===p.vehicleId?'is-assigned':''} ${depot?'is-depot':''}`} style={{'--geo-color':depot?'#ffc46b':colorForVehicle(route?.vehicleId??'')} as CSSProperties} onClick={()=>{if(!depot)p.selectStop(stop.stopId);runtime.current?.focus(stop.stopId);}}><b>{depot?'仓':(route?.stopOrder.indexOf(stop.stopId)??-1)+1}</b><span>{stop.name}</span></button>;})}</div>
  {selected&&<div className="p-geo-stop-card"><span style={{color:colorForVehicle(p.vehicleId)}}>{p.vehicleId} · 第 {p.route.stopOrder.indexOf(selected.stopId)+1} 站</span><strong>{selected.name}</strong><small>{pieces} 件包装件 · {arrival?.arrivalTime??'待规划'} 预计到店</small><button onClick={()=>runtime.current?.focus(selected.stopId)}>定位到门店 ↗</button></div>}
  <div className="p-map-legend">{p.current.routes.map(route=><button key={route.vehicleId} aria-pressed={route.vehicleId===p.vehicleId} onClick={()=>p.selectVehicle(route.vehicleId)}><i style={{background:colorForVehicle(route.vehicleId)}}/>{route.vehicleId}<span>{route.active===false?'空闲':`${route.stopOrder.length} 店`}</span></button>)}</div>
  <details className="p-geo-source"><summary>© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a> · 数据与口径</summary><p>真实建筑足迹与道路，合成仓库、门店、车辆、订单。离线快照：{data?.metadata.snapshotDate.slice(0,10)}，ODbL 1.0。</p><p>{data?.metadata.buildingPolicy} 道宽按标签或道路类型估计。</p>{region==='berlin'?<><p>{data?.metadata.roadModel}</p><p>{data?.metadata.speedModel} 地图路径与本次规划距离矩阵同源。</p></>:<p>历史路线为道路示意，不用于重算业务：计划 {p.current.totals.distanceKm} km；示意路网 {Math.round(roadResult.routes.reduce((n,r)=>n+r.networkDistanceKm,0)*1000)/1000} km。历史费用与时效保持原口径，未检查单行或转向规则。</p>}</details>
  <div className="p-map-tools"><Button aria-label="复位城市地图" onClick={()=>runtime.current?.reset()}><RotateCcw size={16}/></Button><Button aria-label="放大城市地图" onClick={()=>runtime.current?.zoom(.8)}><Plus size={16}/></Button><Button aria-label="缩小城市地图" onClick={()=>runtime.current?.zoom(1.25)}><Minus size={16}/></Button><Button aria-label="倾斜近景" onClick={()=>runtime.current?.close()}><Focus size={16}/></Button></div>
  <span className="p-geo-gestures">左键旋转 · 右键平移 · 滚轮缩放</span>
  {loading&&<div className="p-geo-loading">正在加载离线建筑与道路网络</div>}{(error||roadResult.error)&&<div role="alert" className="p-geo-loading is-error"><TriangleAlert size={18}/>{error||roadResult.error}</div>}
 </div>;
}
