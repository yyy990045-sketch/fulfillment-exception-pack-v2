import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ArrowDown, ArrowUp, ArrowRight, Box, Check, ChevronDown, ChevronLeft, ChevronRight, CircleCheck, Maximize, Minus, Pause, Play, Plus, RotateCcw, Route, ShieldCheck, Truck, TriangleAlert, Warehouse, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PackingView } from '../packing-view';
import { routeData, reasonText, type DecisionRoute } from '../decisions';
import type { PackingState } from '../packing-objects';
import { useCityProduct, emptyPlayback, productSteps } from './state';
import { routeReasons, type Totals } from './api';
import { GeoCityMap } from './geo-city-map';

export const vehicleColors:Record<string,string>={V01:'#82c7b3',V02:'#86adeb',V03:'#c6a3df'};
export const colorForVehicle=(id:string)=>vehicleColors[id]??['#82c7b3','#86adeb','#c6a3df','#d7a66f','#9fc4c9'][[...id].reduce((n,c)=>n+c.charCodeAt(0),0)%5];
export const money=(value:number)=>value.toLocaleString('zh-CN',{maximumFractionDigits:2});
export function Status({valid,label}:{valid:boolean;label?:string}){return <span className={`p-status ${valid?'is-good':'is-bad'}`}>{valid?<CircleCheck size={13}/>:<TriangleAlert size={13}/>} {label??(valid?'已校验可执行':'需调整')}</span>;}

export function PlanBar(){
 const p=useCityProduct(),options=p.mode==='fleet'?p.sets.fleet.plans.plans:p.mode==='single'?p.sets.single.plans.plans:[];
 if(p.mode==='standard') return <section className="p-planbar"><div className="p-plan-current"><Status valid={p.current.feasibility.executable} label={p.resultLabel}/><span>{p.standardMeta.solverStatus==='VALID'?'已通过字段检查':p.standardMeta.solverStatus==='SEARCH_EXHAUSTED'?'当前搜索范围未找到可执行计划':p.standardMeta.solverStatus==='TIMEOUT'?'计算预算耗尽，未发布可执行计划':p.standardMeta.solverStatus==='FEASIBLE'?'计算完成，等待确认':'待提交规划'}</span></div><div className="p-standard-plan-meta"><span>{p.standardMeta.strategy?`策略 ${p.standardMeta.strategy}`:'可选择路线策略'}</span><span>{p.current.totals.vehicleCount} 辆 · {p.current.totals.distanceKm} km · <b>¥{money(p.current.totals.totalCost)}</b></span><Button disabled={p.busy||!!p.startedPlan||p.standardMeta.validation!=='valid'} onClick={p.openEditor}><Route size={14}/>改变条件</Button></div></section>;
 return <section className="p-planbar"><div className="p-plan-options">{options.map((plan,i)=>{
  const totals='totals' in plan?plan.totals:{distanceKm:plan.distanceKm,totalCost:plan.costs.totalCost,vehicleCount:1};
  const selected=p.current.planId===plan.planId&&!p.inspectionKind&&!p.candidate;
  return <Button key={plan.planId} className={selected?'is-selected':''} aria-pressed={selected} disabled={p.busy||!!p.startedPlan} onClick={()=>p.choosePlan(plan.planId)}><span>{i===0?'A':'B'}</span><div><strong>{p.mode==='fleet'?i===0?'三车基础方案':'两车候选方案':i===0?'基础配送 · 卸货受阻':'可执行调整方案'}</strong><small>{totals.vehicleCount} 辆 · {totals.distanceKm} km · ¥{money(totals.totalCost)}</small></div>{selected&&<Check size={14}/>}</Button>;
 })}</div><div className="p-plan-current"><Status valid={p.current.feasibility.executable} label={p.resultLabel}/><span>{p.current.totals.vehicleCount} 辆 · {p.current.totals.distanceKm} km · <b>¥{money(p.current.totals.totalCost)}</b></span></div></section>;
}

export function FleetMap({overview=false,simulation=false}:{overview?:boolean;simulation?:boolean}){
 const p=useCityProduct();
 return <GeoCityMap overview={overview} simulation={simulation} key={`${p.mode}:${p.current.planId}:${p.vehicleId}:${p.startedPlan?'running':'idle'}`}/>;
}

function SpatialFleetMap({overview=false,simulation=false}:{overview?:boolean;simulation?:boolean}){
 const p=useCityProduct(),[tilt,setTilt]=useState(true),[zoom,setZoom]=useState(1);
 const points=useMemo(()=>{
  const nodes=[p.scenario.warehouse,...p.scenario.stops];
  return Object.fromEntries(nodes.map(n=>[n.stopId,{x:130+n.x*105-n.y*24,y:500-n.y*61-n.x*18}]));
 },[p.scenario]);
 const path=(ids:string[])=>ids.map((id,i)=>{const pt=points[id];if(!pt)return '';if(i===0)return `M${pt.x},${pt.y}`;const prev=points[ids[i-1]];const mid=(prev.x+pt.x)/2;return `Q${mid},${prev.y} ${pt.x},${pt.y}`;}).join(' ');
 const buildings=p.scenario.stops.map((s,i)=>{const pt=points[s.stopId],h=25+(i%3)*12,w=42+(i%2)*12;return {s,pt,h,w};});
 return <div className={`p-map p-spatial-map ${overview?'p-map-overview':''}`}>
  <div className="p-map-title"><span><Warehouse size={15}/>城市配送空间</span><small>合成仿真 · {p.scenario.stops.length} 家门店 · 非真实道路</small></div>
  <svg className={tilt?'is-tilt':''} viewBox="0 0 1000 650" role="img" aria-label="等距城市配送空间场景" style={{'--spatial-zoom':zoom} as CSSProperties}>
   <defs><linearGradient id="spatial-ground" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#1c3544"/><stop offset="1" stopColor="#0b1821"/></linearGradient><filter id="spatial-glow"><feGaussianBlur stdDeviation="4" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
   <rect width="1000" height="650" fill="url(#spatial-ground)"/><path d="M0 540L500 210L1000 540L500 650Z" fill="#142733" opacity=".95"/>
   <g transform={`scale(${zoom}) translate(${(1-zoom)*500/zoom} ${(1-zoom)*325/zoom})`}>
    <path d="M45 520Q280 382 500 480T950 318" fill="none" stroke="#203f52" strokeWidth="54" opacity=".8"/><path d="M45 520Q280 382 500 480T950 318" fill="none" stroke="#5b7584" strokeWidth="2" opacity=".8"/>
    {buildings.map(({s,pt,h,w})=><g key={s.stopId} className="spatial-building"><path d={`M${pt.x-w/2},${pt.y} l${w/2},${-h*.42} l${w/2},${h*.42} v${h} l${-w/2},${h*.42} l${-w/2},${-h*.42}z`} fill="#2b4c5a" stroke="#52727e"/><path d={`M${pt.x-w/2},${pt.y} l${w/2},${h*.42} l${w/2},${-h*.42} v${h} l${-w/2},${h*.42} l${-w/2},${-h*.42}z`} fill="#1b3542" opacity=".9"/><path d={`M${pt.x-w/2+9},${pt.y+11}h${w-18}v${h*.18}h${-w+18}z`} fill={s.color} opacity=".65"/></g>)}
    {p.current.routes.filter(r=>r.active!==false&&r.stopOrder.length).map(r=><path key={r.vehicleId} d={path(r.routeNodeIds)} fill="none" stroke={colorForVehicle(r.vehicleId)} strokeWidth={r.vehicleId===p.vehicleId?7:3} opacity={r.vehicleId===p.vehicleId?1:.55} strokeLinecap="round" strokeDasharray={simulation&&p.startedPlan?'none':'2 10'}/>) }
    {p.scenario.stops.map(s=>{const pt=points[s.stopId];if(!pt)return null;const selected=s.stopId===p.selectedStopId;return <g key={s.stopId} onClick={()=>p.selectStop(s.stopId)} style={{cursor:'pointer'}}><circle cx={pt.x} cy={pt.y-7} r={selected?15:10} fill="#172a34" stroke={s.color} strokeWidth={selected?3:2}/><text x={pt.x} y={pt.y-3} fill={s.color} fontSize="11" textAnchor="middle" fontWeight="700">{(p.current.routes.find(r=>r.stopOrder.includes(s.stopId))?.stopOrder.indexOf(s.stopId)??-1)+1}</text><text x={pt.x} y={pt.y+19} fill="#dbe8ec" fontSize="11" textAnchor="middle">{s.name}</text></g>})}
    {p.current.routes.filter(r=>r.active!==false&&r.stopOrder.length).map(r=>{const play=p.playbacks[`${p.mode}:${p.current.planId}:${p.inspectionKind??'plan'}:${r.vehicleId}`]??emptyPlayback;const steps=productSteps(r,'unloading');const step=steps[play.index];let target=points['DEPOT'];if(simulation&&p.startedPlan&&step){const current=points[step.stopId]??target;const previous=play.index>0?points[steps[play.index-1]?.stopId??'DEPOT']??target:points['DEPOT']??target;const t=Math.max(0,Math.min(1,play.progress));target={x:previous.x+(current.x-previous.x)*t,y:previous.y+(current.y-previous.y)*t};}else if(!simulation||!p.startedPlan){target=points['DEPOT'];}if(!target)return null;return <g key={r.vehicleId} onClick={()=>p.selectVehicle(r.vehicleId)} style={{cursor:'pointer'}}><circle cx={target.x+22} cy={target.y-30} r="15" fill={colorForVehicle(r.vehicleId)} stroke="#f1fbff" strokeWidth="2" filter="url(#spatial-glow)"/><text x={target.x+22} y={target.y-26} textAnchor="middle" fill="#0e1d26" fontSize="10" fontWeight="700">{r.vehicleId}</text></g>})}
    <g><circle cx={points.DEPOT.x} cy={points.DEPOT.y-7} r="18" fill="#162b36" stroke="#ffbb76" strokeWidth="3"/><text x={points.DEPOT.x} y={points.DEPOT.y-3} textAnchor="middle" fill="#ffcf94" fontSize="12" fontWeight="700">仓</text><text x={points.DEPOT.x} y={points.DEPOT.y+22} textAnchor="middle" fill="#dbe8ec" fontSize="11">中心仓</text></g>
   </g>
  </svg>
  <div className="p-map-tools"><Button aria-label="切换鸟瞰视角" onClick={()=>setTilt(v=>!v)}>{tilt?'鸟瞰视角':'倾斜视角'}</Button><Button aria-label="放大路线地图" onClick={()=>setZoom(v=>Math.min(1.35,v+.1))}><Plus size={16}/></Button><Button aria-label="缩小路线地图" onClick={()=>setZoom(v=>Math.max(.85,v-.1))}><Minus size={16}/></Button><Button aria-label="复位路线地图" onClick={()=>{setZoom(1);setTilt(true);}}><Maximize size={16}/></Button></div>
  <div className="p-map-legend">{p.current.routes.map(r=><button key={r.vehicleId} onClick={()=>p.selectVehicle(r.vehicleId)} style={{opacity:r.active===false?.45:1}}><i style={{background:colorForVehicle(r.vehicleId)}}/>{r.vehicleId}<span>{r.active===false?'空闲':`${r.stopOrder.length} 店`}</span></button>)}<small>{simulation?'模拟运行阶段 · 非 GPS':'路线计划 · 合成坐标'}</small></div>
 </div>;
}

function LegacyFleetMap({overview=false,simulation=false}:{overview?:boolean;simulation?:boolean}){
 const p=useCityProduct(),uid=useId().replace(/:/g,''),[zoom,setZoom]=useState(1),[pan,setPan]=useState({x:0,y:0});
 const dragging=useRef<{x:number;y:number;pan:{x:number;y:number}}|null>(null);
 const nodes=[p.scenario.warehouse,...p.scenario.stops];
 const maxX=Math.max(...nodes.map(n=>n.x),1),maxY=Math.max(...nodes.map(n=>n.y),1);
 const point=(id:string)=>{const n=nodes.find(n=>n.stopId===id)!;return {x:130+n.x*690/maxX,y:535-n.y*400/maxY};};
 const path=(route:DecisionRoute)=>route.routeNodeIds.map((id,i)=>{const end=point(id);if(i===0)return `M${end.x},${end.y}`;const start=point(route.routeNodeIds[i-1]);return `L${end.x},${start.y} L${end.x},${end.y}`;}).join(' ');
 const assigned=p.current.assignments;
 const conflictStops=new Set(p.current.routes.filter(r=>!r.feasibility.executable).flatMap(r=>{const ids=routeReasons(r).flatMap(reason=>reason.stopId?[reason.stopId]:[]);if(r.unloadingCheck.firstFailure)ids.push(r.unloadingCheck.firstFailure.stopId);return ids.length?ids:r.stopOrder;}));
 return <div className={`p-map ${overview?'p-map-overview':''}`}>
  <div className="p-map-title"><span><Warehouse size={15}/>城市配送中心</span><small>合成街区 · {p.scenario.stops.length} 家门店</small></div>
  <svg viewBox="0 0 1000 650" role="img" aria-label="多车辆配送路线地图" onPointerDown={e=>{if((e.target as Element).closest('[data-map-pick]'))return;dragging.current={x:e.clientX,y:e.clientY,pan};e.currentTarget.setPointerCapture(e.pointerId);}} onPointerMove={e=>{if(dragging.current){setPan({x:dragging.current.pan.x+(e.clientX-dragging.current.x),y:dragging.current.pan.y+(e.clientY-dragging.current.y)});}}} onPointerUp={()=>{dragging.current=null;}}>
   <defs><pattern id={`${uid}-grid`} width="70" height="65" patternUnits="userSpaceOnUse"><rect x="7" y="7" width="56" height="51" rx="4" fill="#27343e"/><rect x="12" y="13" width="18" height="15" rx="2" fill="#2d3c47"/><rect x="35" y="34" width="22" height="17" rx="2" fill="#303f49"/><path d="M0 0H70M0 0V65" stroke="#3b4954" strokeWidth="3"/></pattern>{Object.entries(vehicleColors).map(([id,color])=><marker key={id} id={`${uid}-${id}`} viewBox="0 0 10 10" refX="5" refY="5" markerWidth="4" markerHeight="4" orient="auto"><path d="M1 1L8 5L1 9" fill="none" stroke={color} strokeWidth="2"/></marker>)}</defs>
   <rect width="1000" height="650" fill="#1b2832"/>
   <g transform={`translate(${pan.x} ${pan.y}) translate(500 325) scale(${zoom}) translate(-500 -325)`}>
    <rect x="-1200" y="-800" width="3400" height="2300" fill={`url(#${uid}-grid)`}/>
    <path d="M-100 225Q240 50 505 155T1100 110" fill="none" stroke="#233f52" strokeWidth="37"/><path d="M-100 225Q240 50 505 155T1100 110" fill="none" stroke="#456277" strokeWidth="1"/>
    <g fill="#2d443b" opacity=".85"><rect x="495" y="445" width="175" height="125" rx="17"/><rect x="50" y="30" width="140" height="110" rx="14"/></g><text x="572" y="515" textAnchor="middle" fill="#7b9389" fontSize="11">配送街区</text>
    {p.current.routes.filter(r=>r.active!==false&&r.stopOrder.length).map(r=><g key={r.vehicleId} opacity={overview||r.vehicleId===p.vehicleId?1:.28} data-map-pick="route" onClick={()=>p.selectVehicle(r.vehicleId)} style={{cursor:'pointer'}}><path d={path(r)} fill="none" stroke="#172129" strokeWidth="12" strokeLinejoin="round"/><path d={path(r)} fill="none" stroke={colorForVehicle(r.vehicleId)} strokeWidth={r.vehicleId===p.vehicleId?5:3} strokeLinejoin="round"/></g>)}
    {nodes.map(n=>{const pos=point(n.stopId),assignment=assigned.find(a=>a.stopId===n.stopId),r=p.current.routes.find(r=>r.vehicleId===assignment?.vehicleId),order=r?.stopOrder.indexOf(n.stopId)??-1;
     const selected=n.stopId===p.selectedStopId,conflict=conflictStops.has(n.stopId),color=conflict?'#e69a75':assignment?colorForVehicle(assignment.vehicleId):'#c4d2d8';
     const original=p.revision&&'submittedCheck' in p.revision?p.revision.submittedCheck:p.currentPlan;
     const before=(original.assignments as Array<{stopId:string;vehicleId:string}>).find((a)=>a.stopId===n.stopId)?.vehicleId;
     const reassigned=!!before&&before!==assignment?.vehicleId;
     return <g key={n.stopId} data-map-pick="stop" data-stop-id={n.stopId} data-conflict={conflict?'true':'false'} onClick={()=>n.stopId!=='DEPOT'&&p.selectStop(n.stopId)} style={{cursor:'pointer'}}>
      {(selected||conflict)&&<circle cx={pos.x} cy={pos.y} r="25" fill={color} opacity=".13"/>}
      {reassigned&&<circle cx={pos.x} cy={pos.y} r="22" fill="none" stroke="#f1c28f" strokeWidth="2" strokeDasharray="4 3"/>}
      <circle cx={pos.x} cy={pos.y} r={n.stopId==='DEPOT'?18:13} fill="#1c2b34" stroke={color} strokeWidth="2"/>
      <text x={pos.x} y={pos.y+4} fill={color} fontSize="12" fontWeight="600" textAnchor="middle">{n.stopId==='DEPOT'?'仓':order+1}</text>
      <rect x={pos.x-57} y={pos.y+22} width="114" height="34" rx="5" fill="#17252fe6" stroke="#40515e"/>
      <text x={pos.x} y={pos.y+37} fill="#d8e6ed" fontSize="11" textAnchor="middle">{n.name}</text><text x={pos.x} y={pos.y+49} fill={reassigned?'#f1c28f':color} fontSize="9" textAnchor="middle">{assignment?reassigned?`${before} → ${assignment.vehicleId}`:`${assignment.vehicleId} · ${assignment.cargoIds.length} 件`:`${p.scenario.departureTime} 出发`}</text>
     </g>;
    })}
    {p.current.routes.filter(r=>r.active!==false).map(r=>{const k=`${p.mode}:${p.current.planId}:${p.inspectionKind??'plan'}:${r.vehicleId}`,playback=p.playbacks[k]??emptyPlayback;
     const step=productSteps(r,'unloading')[playback.index];const id=simulation&&p.startedPlan?(step?.stopId??r.stopOrder.at(-1)!):'DEPOT';const pos=point(id);
     const shift=simulation&&p.startedPlan?0:Number(r.vehicleId.slice(-1))*50;
     return <g key={r.vehicleId} data-map-pick="vehicle" onClick={()=>p.selectVehicle(r.vehicleId)} transform={`translate(${pos.x+35+shift},${pos.y-28})`} style={{cursor:'pointer'}}><rect x="-23" y="-14" width="47" height="27" rx="6" fill={colorForVehicle(r.vehicleId)} stroke="#d4e6ec" strokeWidth="1"/><text x="0" y="4" textAnchor="middle" fill="#17232c" fontSize="11" fontWeight="700">{r.vehicleId}</text></g>;
    })}
   </g>
  </svg>
  <div className="p-map-tools"><Button aria-label="放大路线地图" onClick={()=>setZoom(v=>Math.min(2,v+.2))}><Plus size={16}/></Button><Button aria-label="缩小路线地图" onClick={()=>setZoom(v=>Math.max(.65,v-.2))}><Minus size={16}/></Button><Button aria-label="复位路线地图" onClick={()=>{setZoom(1);setPan({x:0,y:0});}}><Maximize size={16}/></Button></div>
  <div className="p-map-legend">{p.current.routes.map(r=><button key={r.vehicleId} onClick={()=>p.selectVehicle(r.vehicleId)} style={{opacity:r.active===false?.5:1}}><i style={{background:colorForVehicle(r.vehicleId)}}/>{r.vehicleId}<span>{r.active===false?'空闲':`${r.stopOrder.length} 店`}</span></button>)}<small>{simulation?'模拟到店状态，非 GPS':'路线为计划，车辆尚未发车'}</small></div>
 </div>;
}

export function VehicleList({compact=false}:{compact?:boolean}){
 const p=useCityProduct();return <div className={`p-vehicle-list ${compact?'is-compact':''}`}>{p.scenario.vehicles.map(v=>{const r=p.current.routes.find(r=>r.vehicleId===v.vehicleId)!;return <button key={v.vehicleId} className={v.vehicleId===p.vehicleId?'is-current':''} onClick={()=>p.selectVehicle(v.vehicleId)} style={{'--vehicle-color':colorForVehicle(v.vehicleId)} as CSSProperties}><div className="p-vehicle-line"><span className="p-vehicle-icon"><Truck size={22}/></span><div><strong>{v.vehicleId} · {v.name}</strong><small>{v.compartment.length} × {v.compartment.width} × {v.compartment.height} m</small></div><span className={`p-tag ${r.active===false?'':'is-good'}`}>{r.active===false?'空闲':!r.feasibility.executable?'需调整':'已分配'}</span></div><div className="p-vehicle-task"><span>{r.stopOrder.length} 家门店 · {r.cargoIds.length} 件</span><strong>{r.distanceKm} km</strong></div>{!compact&&<div className="p-vehicle-stops">{r.stopOrder.map(id=><span key={id}>{p.scenario.stops.find(s=>s.stopId===id)?.name}</span>)}</div>}</button>;})}</div>;
}

export function RouteStops(){const p=useCityProduct();return <ol className="p-route-stops">{p.route.stopOrder.map((id,i)=>{const s=p.scenario.stops.find(s=>s.stopId===id)!;const arrival=p.route.arrivals.find(a=>a.stopId===id)!;return <li key={id}><button onClick={()=>p.selectStop(id)} className={id===p.selectedStopId?'is-current':''}><span style={{color:s.color,borderColor:s.color}}>{i+1}</span><div><strong>{s.name}</strong><small>{s.timeWindow.start}–{s.timeWindow.end}</small></div><b>{arrival.arrivalTime}</b></button></li>;})}{!p.route.stopOrder.length&&<li className="p-muted">本车空闲，无配送任务。</li>}</ol>;}

export function CargoScene({mini=false}:{mini?:boolean}){
 const p=useCityProduct(),r=p.route;
 const scoped=useMemo(()=>routeData(p.sets.single,p.scenario,r,'当前车辆装载'),[p.sets.single,p.scenario,r]);
 const input=useMemo(()=>({scenario:scoped.scenario,positions:r.placements?.positions??[]}),[scoped,r.placements]);
 const active=p.steps[p.playback.index];
 const previous=p.playback.index>0?p.steps[p.playback.index-1]:undefined;
 const remaining=p.playback.phase==='loading'?(previous?.loadedCargoIdsAfter??[]):(previous?.remainingCargoIdsAfter??r.unloading?.initialRemainingCargoIds??[]);
 const blockers=r.unloading?.stations.find(s=>s.stopId===p.selectedStopId)?.conflicts.flatMap(c=>c.blockingCargoIds)??[];
 // The existing renderer interpolates a supplied movement path. Loading uses
 // the delivered reverse path, not a frontend-computed placement or collision.
 const renderStep=p.playback.phase==='loading'&&active?{...active,operation:'unload',remainingCargoIdsBefore:[],remainingCargoIdsAfter:[]}:active;
 const changed=p.revision&&'originalLayoutCheck' in p.revision?p.revision.revision.changedCargoIds:[];
 const [exterior,setExterior]=useState(false),[doorsOpen,setDoorsOpen]=useState(true);
 const state:PackingState={remaining,highlighted:p.playback.playing&&active?active.highlightCargoIds??[active.cargoId!]:p.scenario.cargo.filter(c=>c.stopId===p.selectedStopId).map(c=>c.cargoId),blocking:blockers,selected:p.selectedCargoId,changed,
  step:mini?undefined:renderStep,progress:mini?0:p.playback.progress,exterior:mini?false:exterior,doorsOpen};
 const width=routeReasons(r).find(reason=>reason.minimumTwoLaneWidthM);
 const v=input.scenario.vehicles[0];
 const cargo=input.scenario.cargo,weight=cargo.reduce((n,c)=>n+c.weightKg,0),volume=cargo.reduce((n,c)=>n+c.length*c.width*c.height,0),capacity=v.compartment.length*v.compartment.width*v.compartment.height;
 return <section className={`p-cargo-scene ${mini?'is-mini':''}`}>
  <header><div><span>{p.vehicleId} · {p.scenario.vehicles.find(v=>v.vehicleId===p.vehicleId)?.name}</span><h2>{input.scenario.vehicles[0].compartment.length} × {input.scenario.vehicles[0].compartment.width} × {input.scenario.vehicles[0].compartment.height}<small>m 净空间</small></h2></div>{!mini&&<div><Button className={!exterior?'is-selected':''} onClick={()=>setExterior(false)}>透明剖视</Button><Button className={exterior?'is-selected':''} onClick={()=>setExterior(true)}>完整外观</Button><Button className={doorsOpen&&!exterior?'is-selected':''} onClick={()=>setDoorsOpen(v=>!v)}>{doorsOpen?'尾门开启':'尾门关闭'}</Button></div>}</header>
  <PackingView input={input} state={state} onSelect={p.selectCargo} autoFocus={!mini}/>
  {!mini&&<div className="p-model-truth">外观为既有卡车资产改造示意 · 车厢净尺寸与货位严格取自当前结果{changed.length?' · 金色边框为修订货箱':''}</div>}
  {width&&<div className="p-width-conflict"><TriangleAlert size={18}/><strong>车厢宽度 {width.availableWidthM} m</strong><span>当前分区至少需要 {width.minimumTwoLaneWidthM} m</span><p>重量 {weight} / {v.maxPayloadKg} kg · 总体积 {volume.toFixed(2)} / {capacity.toFixed(2)} m³，虽在容量内，仍未找到可行几何布局。</p><p>不显示虚构装载。冲突货物：{width.cargoIds?.join('、')}</p></div>}
  {r.active===false&&<div className="p-idle-scene"><Truck size={24}/><strong>车辆空闲</strong><span>没有装载货物或配送任务</span></div>}
 </section>;
}

export function DecisionFeedback(){
 const p=useCityProduct();if(!p.revision&&!p.error)return null;
 const revision=p.revision;
 const standard=p.mode==='standard'&&revision&&'strategy' in revision;
 const reasons=standard?[]:revision?('submittedCheck' in revision?revision.submittedCheck.feasibility.reasons:revision.originalLayoutCheck.feasibility.reasons):[];
 const finalReasons=standard?(revision.result?.feasibility?.reasons??[]):revision?('submittedCheck' in revision?revision.result.feasibility.reasons:revision.result.feasibility.reasons):[];
 const changed=revision&&('originalLayoutCheck' in revision||standard)?revision.revision.changedCargoIds.length:null;
 const standardBefore=standard?revision.initialCheck?.totals:null;
 const standardAfter=standard?revision.result?.totals:null;
 return <section className={`p-feedback ${revision?.executable?'is-success':'is-conflict'}`} role="status">
   <div className="p-feedback-heading">{p.current.feasibility.executable?<ShieldCheck size={21}/>:<TriangleAlert size={21}/>}<div><strong>{p.error?'本次请求未完成':p.inspectionKind==='original'?'正在对照原提交影响':p.candidate?'修订已校验，等待确认采用':revision?.executable?'已确认的修订方案':'提交草案未通过，原计划未改变'}</strong><p>{p.error|| (changed!==null?changed?`移动 ${changed} 件货物；须在发车前按新布局重新准备装车。`:'原货位可以继续使用。':standard?'新场景规划结果已返回，确认后才能作为当前计划。':'车辆归属与路线已按实际约束检查。')}</p></div>
   <div className="p-feedback-actions">{revision&&!revision.executable&&!standard&&<Button disabled={p.busy||!!p.startedPlan||!p.serviceReady} onClick={p.allowReassignment}>{p.mode==='fleet'?'允许重新分配':'允许修订装载布局'}</Button>}{revision?.executable&&!standard&&<Button onClick={p.viewOriginal}>查看原提交影响</Button>}{p.inspectionKind&&revision?.executable&&<Button onClick={p.returnCurrent}>查看修订结果</Button>}{p.candidate&&<Button className="p-primary" onClick={p.confirmCandidate}>确认采用修订方案</Button>}{(p.candidate||p.inspectionKind)&&<Button onClick={p.keepOriginal}>保留原计划</Button>}</div>
  </div>
  {(p.inspectionKind||!revision?.executable)&&<details className="p-feedback-reasons" open={!p.current.feasibility.executable}><summary>约束检查详情</summary>{[...reasons,...(!revision?.executable?finalReasons:[])].filter((r,i,arr)=>arr.findIndex(v=>v.message===r.message&&v.stopId===r.stopId&&v.type===r.type)===i).map((r,i)=><p key={i}>{reasonText(r,p.scenario)}</p>)}</details>}
  {revision?.executable&&'submittedCheck' in revision&&revision.revision.reallocated&&<div className="p-reassignment-changes">{(revision.result.assignments as Array<{stopId:string;vehicleId:string}>).filter((a)=>revision.submittedCheck.assignments.find((b:{stopId:string;vehicleId:string})=>b.stopId===a.stopId)?.vehicleId!==a.vehicleId).map((a)=><span key={a.stopId}>{p.scenario.stops.find((s)=>s.stopId===a.stopId)?.name} <b>{revision.submittedCheck.assignments.find((b:{stopId:string;vehicleId:string})=>b.stopId===a.stopId)?.vehicleId} → {a.vehicleId}</b></span>)}</div>}
  {revision?.executable&&<div className="p-revision-cost"><span>本次规划结果</span>{standard&&standardAfter?<strong>{standardAfter.distanceKm} km · ¥{money(standardAfter.totalCost)} · {standardAfter.totalDurationMinutes} 分钟</strong>:(()=>{const d='submittedCheck' in revision?revision.delta:revision.comparison.delta;return <strong>{d.distanceKm>=0?'+':''}{d.distanceKm} km · {d.totalCost>=0?'+':''}{money(d.totalCost)} 元 · {d.totalDurationMinutes>=0?'+':''}{d.totalDurationMinutes} 分钟</strong>;})()}</div>}
  {revision&&<small>本次为发车前规划检查；不是现场执行。重装工时费用未计入。{!revision.executable?'不可执行提交方案的费用仅为名义推演。':''}</small>}
 </section>;
}

export function AdjustmentEditor(){
 const p=useCityProduct();if(!p.editor)return null;
 if(p.mode==='standard') return <div className="p-editor-overlay"><section className="p-editor p-standard-editor" role="dialog" aria-modal="true" aria-label="调整标准配送条件"><header><div><span>标准场景 · 发车前条件</span><h2>改变条件，再重新规划</h2></div><Button aria-label="关闭标准场景调整面板" disabled={p.busy} onClick={()=>p.setEditor(false)}><X size={19}/></Button></header><p className="p-editor-note">这些修改会连同路线、车辆分配、货位和逐站作业步骤一起送入 8114 计算；失败时保留当前已确认方案。</p><StandardConditionEditor/><footer><label className="p-checkbox"><input type="checkbox" checked={p.allowRepair} disabled={p.busy} onChange={e=>p.setAllowRepair(e.target.checked)}/>允许在当前搜索边界内尝试布局与车辆反馈修订</label><Button className="p-primary" disabled={p.busy||!p.serviceReady} onClick={()=>p.planImportedStandard(p.allowRepair?'joint-feedback':'route-first')}>{p.busy?'正在重新规划…':!p.serviceReady?'服务不可用，暂不能提交':'提交条件并重新规划'}<ArrowRight size={16}/></Button>{p.error&&<p role="alert" className="p-error">{p.error}</p>}</footer></section></div>;
 return <div className="p-editor-overlay"><section className="p-editor" role="dialog" aria-modal="true" aria-label="调整配送条件"><header><div><span>发车前规划</span><h2>{p.mode==='fleet'?'调整车辆与门店分配':'调整配送顺序'}</h2></div><Button aria-label="关闭调整面板" disabled={p.busy} onClick={()=>p.setEditor(false)}><X size={19}/></Button></header><p className="p-editor-note">每家门店只分配一次。调整后实际检查路线、时间窗和装载。</p>
  <div className="p-editor-body">{p.draft.map(row=><section key={row.vehicleId}><h3><Truck size={17}/>{row.vehicleId} · {p.scenario.vehicles.find(v=>v.vehicleId===row.vehicleId)?.name}</h3>{row.stopOrder.map((sid,i)=><div className="p-draft-stop" key={sid}><span>{i+1}</span><strong>{p.scenario.stops.find(s=>s.stopId===sid)?.name}</strong>{p.mode==='fleet'&&<select aria-label={`${sid}配送车辆`} value={row.vehicleId} disabled={p.busy} onChange={e=>p.assignStop(sid,e.target.value)}>{p.scenario.vehicles.map(v=><option value={v.vehicleId} key={v.vehicleId}>{v.vehicleId} · {v.name}</option>)}</select>}<Button aria-label={`${sid}上移`} disabled={p.busy||i===0} onClick={()=>p.moveStop(sid,-1)}><ArrowUp size={14}/></Button><Button aria-label={`${sid}下移`} disabled={p.busy||i===row.stopOrder.length-1} onClick={()=>p.moveStop(sid,1)}><ArrowDown size={14}/></Button></div>)}{!row.stopOrder.length&&<p className="p-muted">暂未分配门店</p>}</section>)}</div>
  <footer>{p.mode==='single'&&<label>出发时间<input type="text" inputMode="numeric" placeholder="08:00" aria-label="出发时间" value={p.departure} disabled={p.busy} onChange={e=>p.setDeparture(e.target.value)}/></label>}<label className="p-checkbox"><input type="checkbox" checked={p.allowRepair} disabled={p.busy} onChange={e=>p.setAllowRepair(e.target.checked)}/>{p.mode==='fleet'?'不可执行时允许重新分配车辆与路线':'允许尝试修订装载布局'}</label><Button className="p-primary" disabled={p.busy||!p.serviceReady} onClick={()=>p.submit(p.allowRepair)}>{p.busy?'正在检查实际约束…':!p.serviceReady?'服务不可用，暂不能提交':p.allowRepair?'提交并尝试修订':'只检查当前条件'}<ArrowRight size={16}/></Button>{p.error&&<p role="alert" className="p-error">{p.error}</p>}</footer>
 </section></div>;
}

export function DeliveryTimeline({expanded=false}:{expanded?:boolean}){
 const p=useCityProduct();return <details className="p-delivery-timeline" open={expanded}><summary><Route size={16}/>配送时间轴 <span>{p.current.routes.filter(r=>r.active!==false).length} 条计划路线</span><ChevronDown size={16}/></summary><div>{p.current.routes.map(r=><div className="p-route-time" key={r.vehicleId}><strong style={{color:vehicleColors[r.vehicleId]}}>{r.vehicleId}</strong>{r.active===false?<span>空闲，不计车辆启用费用</span>:<><span>{r.legs[0]?.departureTime??p.scenario.departureTime} 中心仓</span>{r.arrivals.map(a=><div key={a.stopId}><i style={{background:vehicleColors[r.vehicleId]}}/><strong>{p.scenario.stops.find(s=>s.stopId===a.stopId)?.name}</strong><small>{a.arrivalTime} 到店 · {a.departureTime} 离店</small></div>)}<span>{r.returnTime} 返仓</span></>}</div>)}</div></details>;
}

export function PlaybackBar(){
 const p=useCityProduct(),active=p.steps[p.playback.index],done=p.steps.length>0&&p.playback.index>=p.steps.length;
 const disabled=p.busy||p.inspectionKind==='failed'||!p.route.placements||p.route.active===false||!p.steps.length||!p.route.timeWindowCheck.valid;
 const blocked=active?.operation==='blocked';
 const completed=p.playback.phase==='unloading'?p.steps.slice(0,p.playback.index).filter(s=>s.operation==='station_complete').map(s=>s.stopId):[];
 return <section className="p-playback"><div className="p-playback-title"><strong>{blocked?'卸货已停止':done?p.playback.phase==='loading'?'装车完成':'本车卸货完成':p.playback.phase==='loading'?'分步骤装车':'逐站卸货'}</strong><span>步骤 {p.steps.length?Math.min(p.playback.index+1,p.steps.length):0} / {p.steps.length} · 演示播放</span><div className="p-phase-buttons"><Button disabled={!!p.startedPlan} aria-pressed={p.playback.phase==='loading'} onClick={()=>p.setPlayback({...emptyPlayback,phase:'loading'})}>装车指导</Button><Button disabled={!!p.startedPlan} aria-pressed={p.playback.phase==='unloading'} onClick={()=>p.setPlayback({...emptyPlayback,phase:'unloading'})}>逐站卸货</Button></div></div>
  <div className="p-stop-timeline">{p.route.stopOrder.map((id,i)=><div key={id} className={completed.includes(id)?'is-complete':id===active?.stopId?'is-current':''}><span>{completed.includes(id)?<Check size={12}/>:i+1}</span><strong>{p.scenario.stops.find(s=>s.stopId===id)?.name}</strong><small>{p.route.arrivals.find(a=>a.stopId===id)?.arrivalTime}</small></div>)}</div>
  <div className="p-playback-controls"><Button aria-label="重新开始装卸" disabled={!!p.startedPlan} onClick={()=>p.setPlayback({index:0,progress:0,playing:false})}><RotateCcw size={16}/></Button><Button aria-label="上一步装卸" disabled={!!p.startedPlan||p.playback.index===0&&p.playback.progress===0} onClick={()=>p.setPlayback({index:Math.max(0,p.playback.index-1),progress:0,playing:false})}><ChevronLeft size={18}/></Button><Button className="p-primary" disabled={disabled||done||blocked} onClick={()=>p.setPlayback({playing:!p.playback.playing,single:false})}>{p.playback.playing?<Pause size={16}/>:<Play size={16}/>} {p.playback.playing?'暂停':'播放'}</Button><Button aria-label="下一步装卸" disabled={disabled||done||blocked||p.playback.playing} onClick={()=>p.setPlayback({playing:true,single:true})}><ChevronRight size={18}/></Button><select aria-label="装卸播放速度" value={p.playback.speed} onChange={e=>p.setPlayback({speed:Number(e.target.value)})}><option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option></select><p>{done?'当前车辆所有步骤已完成':active?.instruction??'空闲车辆没有装卸任务'}</p><small>{p.playback.phase==='unloading'?`${completed.length} / ${p.route.stopOrder.length} 站完成`:'按已校验装车路径'}</small></div>
 </section>;
}

export function StandardConditionEditor(){
 const p=useCityProduct();
 const draft=p.standardDraftScenario as any;
 const enabled=new Set((draft?.vehicles??[]).map((v:any)=>v.vehicleId));
 const catalog=(p.standardVehicleCatalog??[]) as any[];
 if(p.mode!=='standard'||!draft)return null;
 return <div className="p-standard-condition-editor">
  <section><div className="p-section-heading"><h3>车辆可用性</h3><span>至少保留 1 辆</span></div><div className="p-standard-vehicles">{catalog.map(v=><label key={v.vehicleId}><input type="checkbox" checked={enabled.has(v.vehicleId)} disabled={p.busy||enabled.size===1&&enabled.has(v.vehicleId)} onChange={e=>p.setStandardVehicleEnabled(v.vehicleId,e.target.checked)}/><span><strong>{v.vehicleId}</strong><small>{v.name} · {v.maxPayloadKg} kg</small></span></label>)}</div></section>
  <section><div className="p-section-heading"><h3>出发与时间窗</h3><span>改动后重新计算</span></div><label className="p-standard-field">出发时间<input aria-label="标准场景出发时间" inputMode="numeric" value={draft.departureTime??''} disabled={p.busy} onChange={e=>p.setStandardDeparture(e.target.value)}/></label><div className="p-standard-stop-windows">{(draft.stops??[]).map((s:any)=><label key={s.stopId}><span>{s.name}</span><input aria-label={`${s.name}最晚服务时间`} value={s.timeWindow?.end??''} disabled={p.busy} onChange={e=>p.setStandardStopWindow(s.stopId,e.target.value)}/></label>)}</div></section>
 </div>;
}
