import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
 import { ArrowDown, ArrowUp, ArrowRight, Box, Check, ChevronLeft, ChevronRight, CircleCheck, ClipboardList, Layers3, PackageCheck, Pause, Play, RotateCcw, Route, ShieldCheck, Truck, TriangleAlert, Warehouse } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { loadDelivery, type DeliveryData, type Plan, type Scenario, type Step } from './data';
import { PackingView } from './packing-view';
import { loadFleet, routeData, submitDecision, validateRoute, type DecisionRoute, type FleetData, type OrderDecision } from './decisions';
import { FleetWorkspace } from './fleet-workspace';
import './workbench.css';

function RouteMap({scenario,plan,current,onSelect,fleetRoutes}:{scenario:Scenario;plan:Plan;current:string;onSelect:(id:string)=>void;fleetRoutes?:DecisionRoute[]}) {
 const nodes=[scenario.warehouse,...scenario.stops];
 const maxX=Math.max(...nodes.map(n=>n.x),1),maxY=Math.max(...nodes.map(n=>n.y),1);
 const point=(id:string)=>{const n=nodes.find(n=>n.stopId===id)!;return {x:35+n.x*205/maxX,y:207-n.y*158/maxY};};
 const routePath=(ids:string[])=>ids.map((id,index)=>{const p=point(id);if(index===0)return `M${p.x},${p.y}`;const prev=point(ids[index-1]);return `L${p.x},${prev.y} L${p.x},${p.y}`;}).join(' ');
 const path=plan.routeNodeIds.map((id,index)=>{const p=point(id);if(index===0)return `M${p.x},${p.y}`;const prev=point(plan.routeNodeIds[index-1]);return `L${p.x},${prev.y} L${p.x},${p.y}`;}).join(' ');
 return <svg className="cd-route-map" viewBox="0 0 280 248" role="img" aria-label={`${plan.name}配送路线`}>
  <defs><pattern id="cd-streets" width="28" height="27" patternUnits="userSpaceOnUse"><rect width="22" height="21" x="3" y="3" fill="#24313c" rx="3"/><path d="M0 0H28M0 0V27" stroke="#35434e" strokeWidth="2"/></pattern></defs>
  <rect width="280" height="248" fill="url(#cd-streets)"/>
  <path d="M0 82Q130 25 280 62" fill="none" stroke="#314d62" strokeWidth="12" opacity=".6"/>
  {fleetRoutes?.filter(r=>r.vehicleId!==plan.vehicleId).map((r,i)=><path key={r.vehicleId} d={routePath(r.routeNodeIds)} fill="none" stroke={['#ac9ee0','#cfaa76','#75bfc5'][i%3]} strokeWidth="2" strokeDasharray="4 4" opacity=".45"/>)}
  <path d={path} fill="none" stroke="#76c7ba" strokeWidth="3" strokeLinejoin="round" opacity=".85"/>
  {nodes.map(n=>{const p=point(n.stopId),i=plan.stopOrder.indexOf(n.stopId);const color=scenario.stops.find(s=>s.stopId===n.stopId)?.color??'#c4d4df';return <g key={n.stopId} onClick={()=>onSelect(n.stopId)} style={{cursor:n.stopId==='DEPOT'?'default':'pointer'}}>
   {current===n.stopId&&<circle cx={p.x} cy={p.y} r="15" fill="none" stroke={color} strokeWidth="2"/>}
   <circle cx={p.x} cy={p.y} r="9" fill={color} stroke="#15202a" strokeWidth="2"/><text x={p.x} y={p.y+3} textAnchor="middle" fontSize="9" fontWeight="700" fill="#101b24">{n.stopId==='DEPOT'?'仓':i<0?'·':i+1}</text>
   <text x={p.x} y={p.y+24} textAnchor="middle" fill="#d8e4ec" fontSize={fleetRoutes?'8':'10'}>{fleetRoutes?n.stopId==='DEPOT'?'中心仓':n.name.replace('配送门店 ','店'):n.name}</text>
  </g>;})}
  <text x="12" y="16" fill="#90a6b9" fontSize="9">合成街区 · 非实时位置</text>
 </svg>;
}

export default function CityDeliveryWorkbench() {
 const [data,setData]=useState<DeliveryData|null>(null),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
 const [fleet,setFleet]=useState<FleetData|null>(null),[fleetError,setFleetError]=useState(''),[mode,setMode]=useState('single');
 useEffect(()=>{const title=document.title;document.title='城市配送 · 三维配载与装卸';return()=>{document.title=title;};},[]);
 useEffect(()=>{const controller=new AbortController();setError('');loadDelivery(controller.signal).then(setData).catch(e=>{if(!controller.signal.aborted)setError(e.message);});return()=>controller.abort();},[attempt]);
 useEffect(()=>{const controller=new AbortController();loadFleet(controller.signal).then(setFleet).catch(e=>{if(!controller.signal.aborted)setFleetError(e.message);});return()=>controller.abort();},[attempt]);
 if(!data)return <div className="cd-loading-page"><Box size={40}/><h1>{error?'场景暂时无法打开':'正在准备配送任务'}</h1><p>{error||'读取统一订单、车辆、方案与装卸步骤'}</p>{error&&<Button onClick={()=>setAttempt(n=>n+1)}>重新加载</Button>}</div>;
 return <><div className="cd-mode-switch"><div><span>配送任务</span><Button aria-pressed={mode==='single'} className={mode==='single'?'is-selected':''} onClick={()=>setMode('single')}>一仓四店 · 单车</Button><Button aria-pressed={mode==='fleet'} className={mode==='fleet'?'is-selected':''} onClick={()=>setMode('fleet')}>九店 · 多车辆</Button></div><span>合成演示数据 · 发车前规划</span></div>{mode==='single'?<Workbench data={data} contract={fleet?.contract}/>:fleet?<FleetWorkspace base={data} fleet={fleet}/>:<div className="cd-loading-page"><h1>{fleetError||'正在打开多车任务'}</h1>{fleetError&&<Button onClick={()=>setAttempt(n=>n+1)}>重新读取</Button>}</div>}</>;
}

export function Workbench({data:sourceData,contract,activeVehicle=true,fleetRoutes,embedded=false,resultKind='saved'}:{data:DeliveryData;contract?:FleetData['contract'];activeVehicle?:boolean;fleetRoutes?:DecisionRoute[];embedded?:boolean;resultKind?:'saved'|'computed'}) {
 const [decision,setDecision]=useState<OrderDecision|null>(null),[originalView,setOriginalView]=useState(false),[editing,setEditing]=useState(false),[draft,setDraft]=useState<string[]>([]),[departure,setDeparture]=useState(sourceData.scenario.departureTime),[busy,setBusy]=useState(false),[requestError,setRequestError]=useState('');
 const request=useRef<AbortController|null>(null);
 const data=useMemo(()=>decision?routeData(sourceData,decision.scenario,originalView?decision.originalLayoutCheck:decision.result,originalView?'调整后 · 原货位检查':'本次配送调整结果'):sourceData,[sourceData,decision,originalView]);
 const {scenario}=data;
 const [planId,setPlanId]=useState(sourceData.plans.plans[0].planId),[selectedStop,setSelectedStop]=useState(sourceData.plans.plans[0].stopOrder[0]??''),[selectedCargo,setSelectedCargo]=useState<string>(),[exterior,setExterior]=useState(false);
 const [index,setIndex]=useState(0),[playing,setPlaying]=useState(false),[single,setSingle]=useState(false),[progress,setProgress]=useState(0),[speed,setSpeed]=useState(2);
 const progressRef=useRef(0);progressRef.current=progress;
 const plan=data.plans.plans.find(p=>p.planId===planId)??data.plans.plans[0];
 const layout=data.placements.plans.find(p=>p.planId===plan.planId)!;
 const operations=data.unloadingSteps.plans.find(p=>p.planId===plan.planId)!;
 const steps=operations.steps as Step[];
 const active=steps[index];
 const done=steps.length>0&&index>=steps.length;
 const noGeometry=!plan.loadingCheck.checked;
 const idle=plan.stopOrder.length===0;
 const blocked=active?.operation==='blocked';
 const remaining=index===0?operations.initialRemainingCargoIds:steps[Math.min(index,steps.length)-1].remainingCargoIdsAfter;
 const completedStops=steps.slice(0,index).filter(s=>s.operation==='station_complete').map(s=>s.stopId);
 const selected= scenario.stops.find(s=>s.stopId===selectedStop)??{name:'当前车辆'};
 const cargo=scenario.cargo.find(c=>c.cargoId===selectedCargo);
 const cargoPlacement=layout.positions.find(p=>p.cargoId===selectedCargo);
 const failure=plan.unloadingCheck.firstFailure;
 const inspectedConflict=operations.stations.find(s=>s.stopId===selectedStop)?.conflicts ?? [];
 const blockers=inspectedConflict.flatMap(c=>c.blockingCargoIds);
 const highlighted=playing&&active?active.highlightCargoIds:scenario.cargo.filter(c=>c.stopId===selectedStop).map(c=>c.cargoId);
 const input=useMemo(()=>({scenario,positions:layout.positions}),[scenario,layout]);
 const sceneState=useMemo(()=>({remaining,highlighted,blocking:blockers,selected:selectedCargo,step:active,progress,exterior}),[remaining,highlighted.join(','),blockers.join(','),selectedCargo,active,progress,exterior]);
 useEffect(()=>{
  if(!playing||!active||blocked){if(blocked)setPlaying(false);return;}
  setSelectedStop(active.stopId);
  let frame=0,last=0,fraction=progressRef.current;
  const reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const duration=reduce?.12:Math.max(.35,active.durationSeconds)/speed;
  const tick=(time:number)=>{
   const delta=last?Math.min(.1,(time-last)/1000):0;last=time;
   fraction=Math.min(1,fraction+delta/duration);setProgress(fraction);
   if(fraction>=1){setProgress(0);setIndex(n=>n+1);if(single||index===steps.length-1)setPlaying(false);}
   else frame=requestAnimationFrame(tick);
  };
  frame=requestAnimationFrame(tick);return()=>cancelAnimationFrame(frame);
 },[playing,index,plan.planId,single,speed,blocked,activeVehicle]);
 useEffect(()=>{if(!activeVehicle)setPlaying(false);},[activeVehicle]);
 useEffect(()=>{if(active)setSelectedStop(active.stopId);setSelectedCargo(active?.cargoId);},[index,plan.planId]);
 useEffect(()=>()=>request.current?.abort(),[]);
 function changePlan(id:string) {
  if(id===planId&&!decision)return;
  setDecision(null);setOriginalView(false);setEditing(false);setRequestError('');
  setPlaying(false);setProgress(0);setIndex(0);setPlanId(id);setSelectedCargo(undefined);setExterior(false);
  setSelectedStop(data.plans.plans.find(p=>p.planId===id)!.stopOrder[0]);
 }
 function restart(){setPlaying(false);setProgress(0);setIndex(0);setSelectedStop(plan.stopOrder[0]);setSelectedCargo(undefined);}
 function next(){if(done||blocked)return;setSingle(true);setPlaying(true);}
 function pickCargo(id:string){setSelectedCargo(id);const c=scenario.cargo.find(c=>c.cargoId===id);if(c)setSelectedStop(c.stopId);}
 function editOrder(){restart();setDraft([...plan.stopOrder]);setDeparture(scenario.departureTime);setEditing(true);setRequestError('');}
 function moveStop(id:string,offset:number){setDraft(order=>{const from=order.indexOf(id),to=from+offset;if(to<0||to>=order.length)return order;const next=[...order];[next[from],next[to]]=[next[to],next[from]];return next;});}
 async function checkOrder(allowLayoutRepair:boolean){
  if(!contract){setRequestError('没有读取到配送调整入口，已保留原方案。');return;}
  request.current?.abort();const controller=new AbortController();request.current=controller;setBusy(true);setRequestError('');setPlaying(false);
  try{
   const result=await submitDecision<OrderDecision>(contract,'reviseOrder',{scenarioId:sourceData.scenario.scenarioId,basePlanId:planId,stopOrder:draft,departureTime:departure,allowLayoutRepair},controller.signal);
   validateRoute(result.scenario,result.originalLayoutCheck);validateRoute(result.scenario,result.result);
   if(result.scenarioId!==sourceData.scenario.scenarioId||result.precomputedOnly)throw new Error('没有取得当前场景的新结果。');
   setDecision(result);setOriginalView(false);setProgress(0);setIndex(0);setSelectedStop(result.result.stopOrder[0]);setSelectedCargo(undefined);setExterior(false);setEditing(false);
  }catch(e){if(!controller.signal.aborted)setRequestError(e instanceof Error?e.message:'配送检查未完成，原方案保持不变。');}
  finally{if(request.current===controller)setBusy(false);}
 }
 function switchResult(original:boolean){setOriginalView(original);setPlaying(false);setProgress(0);setIndex(0);setSelectedCargo(undefined);setSelectedStop((original?decision?.originalLayoutCheck:decision?.result)?.stopOrder[0]??'');}
 const checked=[['空间',plan.loadingCheck.valid],['载重',plan.loadingCheck.checks.weight.valid],['时间窗',plan.timeWindowCheck.valid],['卸货顺序',plan.unloadingCheck.valid]] as const;
 const vehicle=scenario.vehicles[0],compartment=vehicle.compartment;
 const stopTotal=plan.stopOrder.length;
 const notice=idle?'当前车辆未启用，没有配送门店和装载货物。':noGeometry?'当前分配无法生成有效货位，未展示虚构货箱。':done?`${stopTotal} 站配送演示完成，车厢内已无剩余货物。`:blocked?`卸货已停止：${scenario.stops.find(s=>s.stopId===active.stopId)?.name}货物的后门通道被其他货物占据。`:active?.instruction||'按步骤查看卸货';
 return <div className={`city-delivery ${embedded?'cd-embedded':''}`} data-plan={plan.planId} data-scenario={scenario.scenarioId} data-vehicle={plan.vehicleId}>
  <aside className="cd-rail"><div className="cd-brand"><Layers3 size={25}/></div><span className="cd-rail-line"/><div className="cd-rail-active" title="三维配载与装卸"><Box size={23}/><small>配载</small></div><span className="cd-rail-bottom">04</span></aside>
  <main className="cd-main">
   <header className="cd-header"><div><div className="cd-breadcrumb"><Truck size={14}/>城市配送<span>/</span>配载工作台</div><h1>三维配载与装卸<span className="cd-header-dot"/></h1></div><div className="cd-header-meta"><span className="cd-source">合成演示数据</span><span>{decision||resultKind==='computed'?'本次计算结果':'已保存候选方案'}</span></div></header>
   <section className="cd-plan-bar" aria-label="配送方案选择">
    <div className="cd-plan-tabs">{!embedded?sourceData.plans.plans.map(p=><Button key={p.planId} disabled={busy} onClick={()=>changePlan(p.planId)} aria-pressed={!decision&&p.planId===planId} className={!decision&&p.planId===planId?'is-selected':''}><span>{p.planId==='PLAN_A'?'A':'B'}</span><div><strong>{p.planId==='PLAN_A'?'基础配送方案':'可执行调整方案'}</strong><small>{p.distanceKm} km · ¥{p.costs.totalCost}</small></div>{!decision&&p.planId===planId&&<Check size={15}/>}</Button>):<div className="cd-vehicle-plan-heading"><Truck size={23}/><div><strong>{vehicle.name}</strong><small>本车 {plan.distanceKm} km · ¥{plan.costs.totalCost} · {stopTotal} 家门店</small></div></div>}</div>
    <div className={`cd-plan-verdict ${plan.feasibility.executable?'is-good':'is-warning'}`}>{plan.feasibility.executable?<ShieldCheck size={19}/>:<TriangleAlert size={19}/>}<div><strong>{idle?'当前车辆未启用':plan.feasibility.executable?'当前规则下可执行':noGeometry?'当前分配未找到有效布局':!plan.timeWindowCheck.valid?'到店时间超出时间窗':'装得下，但卸货顺序受阻'}</strong><small>{decision?'本次条件已实际检查 · 非动画推演':embedded?'每车独立路线、货位与装卸任务':plan.feasibility.executable?`增加 ${data.comparison.delta.distanceKm} km · 增加 ¥${data.comparison.delta.totalCost} · 无额外搬运`:'空间布局通过 · 配送顺序与货位冲突'}</small></div></div>
   </section>
   {!embedded&&<div className="cd-order-tools"><span>发车前调整配送条件</span><Button disabled={busy||!contract} onClick={editOrder}><Route size={15}/>调整门店顺序与出发时间</Button>{!contract&&<small>配送调整入口暂未就绪</small>}</div>}
   {editing&&<section className="cd-order-editor"><div className="cd-editor-heading"><strong>调整配送顺序</strong><button disabled={busy} onClick={()=>setEditing(false)}>收起</button></div><ol>{draft.map((id,i)=><li key={id}><span>{i+1}</span><strong>{scenario.stops.find(s=>s.stopId===id)?.name}</strong><button aria-label={`${id}上移`} disabled={busy||i===0} onClick={()=>moveStop(id,-1)}><ArrowUp size={15}/></button><button aria-label={`${id}下移`} disabled={busy||i===draft.length-1} onClick={()=>moveStop(id,1)}><ArrowDown size={15}/></button></li>)}</ol><div className="cd-editor-actions"><label>出发时间<input aria-label="出发时间" type="text" inputMode="numeric" placeholder="08:00" maxLength={5} value={departure} disabled={busy} onChange={e=>setDeparture(e.target.value)} aria-invalid={!/^([01]\d|2[0-3]):[0-5]\d$/.test(departure)}/></label><Button disabled={busy||!/^([01]\d|2[0-3]):[0-5]\d$/.test(departure)} onClick={()=>checkOrder(false)}>{busy?'正在检查路线和货位…':'检查调整影响'}</Button><Button disabled={busy||!/^([01]\d|2[0-3]):[0-5]\d$/.test(departure)} onClick={()=>checkOrder(true)}>允许重排货位并复核</Button><small>基于已保存{planId==='PLAN_A'?'方案 A':'方案 B'}货位检查。原文件不会改变。</small></div></section>}
   {requestError&&<p role="alert" className="cd-request-error">{requestError.includes('fetch')?'配送调整服务暂时不可用，原计划已保留。':requestError}</p>}
   {decision&&<section className="cd-decision-feedback"><div className="cd-editor-heading"><strong>{decision.executable?'修订结果可执行':'本次调整仍不可执行'}</strong><span>本次计算 · {decision.revision.status==='revised'?`调整 ${decision.revision.changedCargoIds.length} 件货物`:decision.revision.status==='reused'?'原布局可以继续使用':'原布局存在约束冲突'}</span></div><div className="cd-decision-facts"><p>{decision.originalLayoutCheck.unloadingCheck.firstFailure?`${scenario.stops.find(s=>s.stopId===decision.originalLayoutCheck.unloadingCheck.firstFailure?.stopId)?.name}原货位受阻；目标 ${decision.originalLayoutCheck.unloadingCheck.firstFailure.targetCargoIds.join('、')}，阻挡 ${decision.originalLayoutCheck.unloadingCheck.firstFailure.blockingCargoIds.join('、')}。`:'原布局装卸检查通过。'}{decision.revision.requiresReloadBeforeDispatch?'调整后的货位需要在发车前重新准备装车。':''}</p><span>相比已保存基础：{decision.comparison.delta.distanceKm>=0?'+':''}{decision.comparison.delta.distanceKm} km · {decision.comparison.delta.totalCost>=0?'+':''}{decision.comparison.delta.totalCost} 元 · {decision.comparison.delta.totalDurationMinutes>=0?'+':''}{decision.comparison.delta.totalDurationMinutes} 分钟 · 额外搬运 0 次</span></div>{decision.result.feasibility.reasons.map((r,i)=><p className="cd-request-error" key={i}>{r.message||r.reason||`门店 ${r.stopId??''} 时间窗或装卸约束未通过`}</p>)}<div className="cd-editor-actions"><Button className={originalView?'is-selected':''} onClick={()=>switchResult(true)}>查看原货位影响</Button><Button className={!originalView?'is-selected':''} onClick={()=>switchResult(false)}>查看本次结果</Button>{!decision.executable&&<Button onClick={editOrder}>修改条件或允许重排</Button>}<small>费用未包含未提供的重新装车工时费。仅为发车前计划，播放不代表实际执行。</small></div></section>}
   <div className="cd-workspace">
    <aside className="cd-route-panel"><div className="cd-section-title"><Route size={17}/><h2>配送路线</h2><span>{plan.distanceKm} km</span></div>
     <RouteMap scenario={scenario} plan={plan} current={selectedStop} fleetRoutes={fleetRoutes} onSelect={id=>{if(plan.stopOrder.includes(id)){setSelectedStop(id);setSelectedCargo(undefined);}}}/>
     <div className="cd-route-origin"><Warehouse size={15}/><strong>{scenario.warehouse.name}</strong><span>{scenario.departureTime} 出发</span></div>
     <ol className="cd-stop-list">{plan.stopOrder.map((id,i)=>{const stop=scenario.stops.find(s=>s.stopId===id)!;const arrival=plan.arrivals.find(a=>a.stopId===id)!;const complete=completedStops.includes(id);return <li key={id} style={{'--stop-color':stop.color} as CSSProperties}><button className={selectedStop===id?'is-current':''} onClick={()=>{setSelectedStop(id);setSelectedCargo(undefined);}} aria-pressed={selectedStop===id}><span className="cd-stop-number">{complete?<Check size={14}/>:i+1}</span><div><strong>{stop.name}</strong><small>{stop.timeWindow.start}–{stop.timeWindow.end} · 4 件</small></div><span className="cd-stop-time">{complete?'已完成':arrival.arrivalTime}</span></button></li>;})}</ol>
     <div className="cd-route-return"><RotateCcw size={13}/><span>{plan.returnTime} 预计返仓</span>{!plan.feasibility.executable&&<small>未完成的路线推演</small>}</div>
     <div className="cd-vehicle"><Truck size={20}/><div><label>执行车辆</label><strong>{vehicle.vehicleId} · {vehicle.name}</strong><small>{embedded?'切换车辆可查看其独立任务':'本场景提供 1 辆车'}</small></div></div>
    </aside>
    <section className="cd-center"><div className="cd-cargo-header"><div><span>{vehicle.vehicleId} · 车厢装载</span><h2>{compartment.length} × {compartment.width} × {compartment.height}<small>m 净空间</small></h2></div><div className="cd-shell-toggle"><Button aria-pressed={!exterior} onClick={()=>setExterior(false)} className={!exterior?'is-active':''}><ScanIcon/>透明剖视</Button><Button aria-pressed={exterior} onClick={()=>setExterior(true)} className={exterior?'is-active':''}>完整外观</Button></div></div>
     <PackingView input={input} state={sceneState} onSelect={pickCargo}/>
     <div className="cd-scene-legend">{scenario.stops.filter(s=>plan.stopOrder.includes(s.stopId)).map(s=><button key={s.stopId} onClick={()=>setSelectedStop(s.stopId)}><i style={{background:s.color}}/>{s.name}</button>)}<span>合成演示数据 · 车辆外观为资产改造示意</span></div>
     <div className={`cd-task-banner ${done?'is-good':failure||noGeometry?'is-warning':''}`} role="status">{done?<PackageCheck size={21}/>:failure||noGeometry?<TriangleAlert size={21}/>:<Box size={21}/>}<div><strong>{idle?'车辆未启用':done?'全部卸货完成':failure?`${scenario.stops.find(s=>s.stopId===failure.stopId)?.name} · 后门通道受阻`:noGeometry?'无法生成有效装载布局':`${selected.name} · 装卸任务`}</strong><p>{notice}</p></div>{failure&&!embedded&&!decision&&<Button onClick={()=>changePlan('PLAN_B')}>查看可执行调整方案<ArrowRight size={15}/></Button>}{done&&<span className="cd-done-mark">{stopTotal} / {stopTotal} 站</span>}</div>
    </section>
    <aside className="cd-inspector"><div className="cd-section-title"><ClipboardList size={17}/><h2>配载检查</h2><span className={plan.feasibility.executable?'cd-green':'cd-amber'}>{plan.feasibility.executable?'可执行':'需调整'}</span></div>
     <div className="cd-cargo-count"><strong data-testid="remaining-count">{remaining.length}</strong><span>{noGeometry?'件待配载':'件仍在车厢'}</span><small>{noGeometry?'未生成货位':`已卸 ${scenario.cargo.length-remaining.length} / ${scenario.cargo.length}`}</small></div>
     <div className="cd-weight"><div><span>初始货重</span><strong>{plan.loadingCheck.totalWeightKg} / {vehicle.maxPayloadKg} kg</strong></div><div className="cd-weight-track"><i style={{width:`${plan.loadingCheck.totalWeightKg/vehicle.maxPayloadKg*100}%`}}/></div></div>
     <div className="cd-checks">{checked.map(([name,valid])=>{const unknown=name==='空间'&&!plan.loadingCheck.checked||name==='载重'&&!plan.loadingCheck.checks.weight.checked||name==='卸货顺序'&&!plan.unloadingCheck.checked;return <div key={name}><span>{name}</span><strong className={valid&&!unknown?'cd-green':'cd-amber'}>{valid&&!unknown?<CircleCheck size={14}/>:<TriangleAlert size={14}/>} {unknown?'未检查':valid?'通过':'不通过'}</strong></div>;})}</div>
     <div className="cd-inspector-divider"/>
     <div className="cd-detail-title"><Box size={16}/><h3>{cargo?'选中货物':`${selected.name}货物`}</h3>{cargo&&<button onClick={()=>setSelectedCargo(undefined)}>返回</button>}</div>
     {cargo&&cargoPlacement?<div className="cd-cargo-detail"><div className="cd-cargo-identity"><i style={{background:cargo.color}}/><strong>{cargo.cargoId}</strong><span>{remaining.includes(cargo.cargoId)?'已装载 / 待卸':'已卸货'}</span></div><p>{scenario.stops.find(s=>s.stopId===cargo.stopId)?.name} · {cargo.name}</p><dl><div><dt>原始尺寸</dt><dd>{cargo.length} × {cargo.width} × {cargo.height} m</dd></div><div><dt>重量</dt><dd>{cargo.weightKg} kg</dd></div><div><dt>朝向</dt><dd>保持直立 · {cargoPlacement.rotation}°</dd></div><div><dt>支撑</dt><dd>{cargoPlacement.support.type==='floor'?'车厢地板':'下方货箱'} · 100%</dd></div></dl><div className="cd-handling">{cargo.handlingRequirements.map(r=><span key={r}>{r}</span>)}</div></div>:<div className="cd-cargo-list">{scenario.cargo.filter(c=>c.stopId===selectedStop).map(c=><button key={c.cargoId} onClick={()=>pickCargo(c.cargoId)}><Box size={15}/><div><strong>{c.cargoId}</strong><small>{c.fragile?'易碎 · 禁止上方堆货':'常规 · 保持直立'}</small></div><span>{remaining.includes(c.cargoId)?`${c.weightKg} kg`:<Check size={15}/>}</span></button>)}</div>}
     {blockers.length>0&&<div className="cd-conflict-details"><strong><TriangleAlert size={15}/>实际阻挡货物</strong><p>后方货物占据取货通道。红色为阻挡货物，本站货物保留门店颜色。</p><div>{[...new Set(blockers)].map(id=><button key={id} onClick={()=>pickCargo(id)}>{id}</button>)}</div></div>}
     <div className="cd-cost-line"><span>{plan.feasibility.executable?'预计计划费用':'不可执行计划名义费用'}</span><strong>¥{plan.costs.totalCost}</strong></div>
     {plan.feasibility.reasons.length>0&&<div className="cd-route-reasons">{plan.feasibility.reasons.map((reason,i)=><p key={i}>{reason}</p>)}</div>}
     <p className="cd-scope">{noGeometry?'未生成有效货位，空间与卸货未检查；不能执行。':'已检查尺寸、重量、朝向、易碎、支撑和后门取货。仅对本场景规则有效。'}</p>
    </aside>
   </div>
   <footer className="cd-playback"><div className="cd-playback-heading"><div><span className="cd-live-dot"/><strong>{done?'配送演示已完成':blocked?'卸货已停止':'逐站卸货演示'}</strong><span>步骤 {Math.min(index+1,steps.length)} / {steps.length}</span></div><span>演示播放 · 非现场记录</span></div>
    <div className="cd-timeline">{plan.stopOrder.map((id,i)=>{const stop=scenario.stops.find(s=>s.stopId===id)!;const arrival=plan.arrivals.find(a=>a.stopId===id)!;const completed=completedStops.includes(id);const current=active?.stopId===id;return <div className={`cd-timeline-stop ${completed?'is-complete':current?'is-current':''}`} key={id}><span className="cd-timeline-node">{completed?<Check size={12}/>:i+1}</span><div><strong>{stop.name}</strong><small>{arrival.arrivalTime} · {completed?'卸货完成':current?blocked?'受阻':'当前任务':'待配送'}</small></div></div>;})}</div>
    <div className="cd-controls"><div><Button aria-label="重新开始" onClick={restart}><RotateCcw size={17}/></Button><Button aria-label="上一步" disabled={index===0&&progress===0} onClick={()=>{setPlaying(false);setProgress(0);setIndex(n=>Math.max(0,n-1));}}><ChevronLeft size={20}/></Button><Button className="cd-play" disabled={done||blocked||!steps.length||noGeometry||editing||busy} onClick={()=>{setSingle(false);setPlaying(v=>!v);}}>{playing?<Pause size={17}/>:<Play size={17}/>} {playing?'暂停':'播放'}</Button><Button aria-label="下一步" disabled={done||blocked||playing||!steps.length||noGeometry||editing||busy} onClick={next}><ChevronRight size={20}/></Button><select aria-label="播放速度" value={speed} onChange={e=>setSpeed(Number(e.target.value))}><option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option></select></div><p>{idle?'本车未启用，无卸货任务':done?'本站任务全部完成 · 剩余 0 件':blocked?'当前方案不可继续卸货，请修改条件':noGeometry?'没有有效货位，卸货演示不可播放':`${scenario.stops.find(s=>s.stopId===(active?.stopId||selectedStop))?.name} · ${active?.operation==='unload'?`取出 ${active.cargoId}`:'按已校验步骤操作'}`}</p><span className="cd-progress-label">{completedStops.length} / {stopTotal} 站完成</span></div>
   </footer>
  </main>
 </div>;
}
function ScanIcon(){return <Layers3 size={14}/>;}
