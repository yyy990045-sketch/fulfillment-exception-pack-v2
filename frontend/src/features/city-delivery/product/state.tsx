import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { loadDelivery, type DeliveryData, type Step } from '../data';
import { loadFleet, validateFleet, validateRoute, planStandardScene, standardPlanToFleetPlan, validateStandardScene, type DecisionRoute, type FleetData, type FleetPlan, type StandardDecision, type StandardScenario, type Scenario } from '../decisions';
import { submit as post, normalizeFleet, type ProductFleetDecision, type ProductOrderDecision } from './api';

export type Mode='fleet'|'single'|'standard';
export type Page='overview'|'orders'|'dispatch'|'packing'|'execution'|'effects';
export type DraftRoute={vehicleId:string;stopOrder:string[]};
export type SkuOrderDraft={stopId:string;skuId:string;name:string;quantity:number;casePack:number;caseLength:number;caseWidth:number;caseHeight:number;caseWeightKg:number;unitLength:number;unitWidth:number;unitHeight:number;unitWeightKg:number;fragile:boolean;maxTopLoadKg:number};
export type Playback={index:number;progress:number;playing:boolean;single:boolean;speed:number;phase:'unloading'|'loading'};
export type ProductStep=Step&{loadedCargoIdsBefore?:string[];loadedCargoIdsAfter?:string[]};
export const emptyPlayback:Playback={index:0,progress:0,playing:false,single:false,speed:2,phase:'unloading'};
export type DataSets={single:DeliveryData;fleet:FleetData;fleetComparison:typeof import('../../../../public/demo/city-delivery/v2/comparison.json');fleetExample:typeof import('../../../../public/demo/city-delivery/v2/fleet-adjustment-example.json')};
type StandardMeta={validation:'idle'|'validating'|'valid'|'invalid';solverStatus:StandardDecision['solverStatus']|'idle';constraintVersion?:string;scenarioFingerprint?:string;planId?:string;revisionId?:string;confirmed:boolean;strategy?:string;timing?:Record<string,number>;search?:StandardDecision['search'];source?:Record<string,unknown>};
const emptyStandardPlan=(scenario:Scenario):FleetPlan=>({planId:'STANDARD_DRAFT',scenarioId:scenario.scenarioId,routes:scenario.vehicles.map(v=>({planId:'STANDARD_DRAFT',scenarioId:scenario.scenarioId,vehicleId:v.vehicleId,stopOrder:[],routeNodeIds:['DEPOT'],arrivals:[],legs:[],distanceKm:0,drivingMinutes:0,waitingMinutes:0,serviceMinutes:0,totalDurationMinutes:0,returnTime:scenario.departureTime,timeWindowCheck:{checked:false,valid:false,arrivals:[]},costs:{currency:'CNY',vehicleCount:0,vehicleFixedCost:0,drivingCost:0,extraHandlingMoves:0,extraHandlingCost:0,waitingCost:0,totalCost:0,basis:'待提交标准场景'},cargoIds:[],loadingCheck:null,loadingPathCheck:{checked:false,valid:false,reason:'尚未规划'},unloadingCheck:{checked:false,valid:false,firstFailure:null},feasibility:{executable:false,reasons:[{type:'not_planned',message:'新场景尚未提交规划。'}]},placements:null,unloading:null,active:false,status:'idle'} as unknown as DecisionRoute)),assignments:[],totals:{vehicleCount:0,distanceKm:0,totalCost:0,totalDurationMinutes:0,drivingMinutes:0,extraHandlingMoves:0,extraHandlingCost:0},feasibility:{executable:false,reasons:[{type:'not_planned',message:'新场景尚未提交规划。'}]}});
function cleanStandardScenario(input:StandardScenario):Scenario{const value=structuredClone(input) as StandardScenario;delete value.uncheckedConstraints;if(value.routing&&typeof value.routing==='object')delete value.routing.timeWindowRule;return value as Scenario;}
function makeStandardScenarioFromSku(base:Scenario,rows:SkuOrderDraft[]):StandardScenario{
 const cargo:any[]=[];const orders:any[]=[];
 for(const row of rows){
  if(!row.skuId||!row.stopId||!Number.isInteger(row.quantity)||!Number.isInteger(row.casePack)||row.quantity<1||row.casePack<1)throw new Error('请填写商品和门店，数量与整箱数量必须为正整数。');
  const full=Math.floor(row.quantity/row.casePack),rest=row.quantity%row.casePack;const ids:string[]=[];
  for(let i=0;i<full;i++){const cargoId=`${row.skuId}-${row.stopId}-CASE-${i+1}`;ids.push(cargoId);cargo.push({cargoId,orderId:`ORDER-${row.stopId}-${row.skuId}`,stopId:row.stopId,name:`${row.name}（整箱）`,length:row.caseLength,width:row.caseWidth,height:row.caseHeight,weightKg:row.caseWeightKg,fragile:row.fragile,maxTopLoadKg:row.maxTopLoadKg,orientation:{uprightOnly:true,allowedYawDegrees:[0,90]},handlingRequirements:['保持直立',row.fragile?'上方不得堆货':`上方承重不超过 ${row.maxTopLoadKg} kg`]});}
  if(rest>0){if(!(row.unitLength>0&&row.unitWidth>0&&row.unitHeight>0&&row.unitWeightKg>0))throw new Error(`${row.skuId} 有拆零数量，但没有提供拆零包装规格。`);for(let i=0;i<rest;i++){const cargoId=`${row.skuId}-${row.stopId}-EACH-${i+1}`;ids.push(cargoId);cargo.push({cargoId,orderId:`ORDER-${row.stopId}-${row.skuId}`,stopId:row.stopId,name:`${row.name}（拆零）`,length:row.unitLength,width:row.unitWidth,height:row.unitHeight,weightKg:row.unitWeightKg,fragile:row.fragile,maxTopLoadKg:row.maxTopLoadKg,orientation:{uprightOnly:true,allowedYawDegrees:[0,90]},handlingRequirements:['保持直立',row.fragile?'上方不得堆货':`上方承重不超过 ${row.maxTopLoadKg} kg`]});}}
  orders.push({orderId:`ORDER-${row.stopId}-${row.skuId}`,stopId:row.stopId,cargoIds:ids});
 }
 const source={dataType:'synthetic',name:'SKU 包装规则生成的合成配送批次',description:'由用户声明的 SKU 数量和包装规格生成，不是企业订单。',license:'project-owned-synthetic',authorization:'当前演示会话内使用'};
 const vehicles=(base.vehicles as any[]).map(v=>({vehicleId:v.vehicleId,name:v.name,maxPayloadKg:v.maxPayloadKg,compartment:v.compartment,rearDoor:{axis:v.rearDoor?.axis??'z',position:v.rearDoor?.position??v.compartment.length,xMin:v.rearDoor?.xMin??0,xMax:v.rearDoor?.xMax??v.compartment.width,yMin:v.rearDoor?.yMin??0,yMax:v.rearDoor?.yMax??v.compartment.height},costs:{vehicleFixedCost:v.costs?.vehicleFixedCost??(base as any).costs.vehicleFixedCost,drivingCostPerKm:v.costs?.drivingCostPerKm??(base as any).costs.drivingCostPerKm}}));
 const stopIds=[...new Set(rows.map(row=>row.stopId))];const stops=(base.stops as any[]).filter(s=>stopIds.includes(s.stopId)).map(s=>({...s,serviceDurationMinutes:s.serviceDurationMinutes??6}));
 const baseNodes=(base.routing.nodeIds as string[]),selectedNodes=['DEPOT',...stopIds],indices=selectedNodes.map(id=>baseNodes.indexOf(id));const routing={...base.routing,nodeIds:selectedNodes,distanceMatrixKm:indices.map(i=>indices.map(j=>base.routing.distanceMatrixKm[i][j])),travelTimeMatrixMinutes:indices.map(i=>indices.map(j=>base.routing.travelTimeMatrixMinutes[i][j]))};
 return {schemaVersion:'3.0.0',scenarioId:`sku-batch-${Date.now()}`,name:'SKU 包装规则配送批次',units:{dimensions:'m',weight:'kg',distance:'km',time:'minutes',currency:'CNY'},source,warehouse:base.warehouse,stops,orders,cargo,vehicles,departureTime:base.departureTime,routing,costs:{currency:'CNY',waitingCostPerMinute:0,extraHandlingCostPerCargoMove:5},rules:{extraction:'rear-door-straight-positive-z',allowExtraHandling:false,minimumSupportRatio:1,fragileRule:'no-load-on-fragile',maxRouteDurationMinutes:480,supportRule:'full-footprint',timeWindowRule:'service-start',loadBearingRule:'area-proportional'}};
}

export function singleBundle(data:DeliveryData,id:string):FleetPlan {
 const p=data.plans.plans.find(p=>p.planId===id)!;
 const positions=data.placements.plans.find(p=>p.planId===id)!;
 const unloading=data.unloadingSteps.plans.find(p=>p.planId===id)!;
 const r={...p,cargoIds:data.scenario.cargo.map(c=>c.cargoId),placements:positions,unloading,active:true,status:'scheduled',
  feasibility:{...p.feasibility,reasons:p.feasibility.reasons.map(message=>({message}))}} as DecisionRoute;
 return bundleFromRoute(r);
}
export function bundleFromRoute(route:DecisionRoute):FleetPlan {
 return {planId:route.planId,scenarioId:route.scenarioId,routes:[route],assignments:route.stopOrder.map(stopId=>({stopId,vehicleId:route.vehicleId,cargoIds:route.placements?.positions.filter(p=>p.stopId===stopId).map(p=>p.cargoId)??[]})),
  totals:{...route.costs,distanceKm:route.distanceKm,totalDurationMinutes:route.totalDurationMinutes,drivingMinutes:route.drivingMinutes},feasibility:route.feasibility};
}
export function productSteps(route:DecisionRoute,phase:Playback['phase']):ProductStep[] {
 return ((phase==='loading'?route.unloading?.loadingSteps:route.unloading?.steps)??[]) as unknown as ProductStep[];
}

function useProductModel(sets:DataSets,page:Page) {
 const [mode,setModeState]=useState<Mode>('fleet');
 const [plans,setPlans]=useState<Record<Mode,FleetPlan>>({fleet:sets.fleet.plans.plans[0],single:singleBundle(sets.single,'PLAN_A'),standard:emptyStandardPlan(sets.single.scenario)});
 const [confirmed,setConfirmed]=useState<Record<Mode,FleetPlan>>({fleet:sets.fleet.plans.plans[0],single:singleBundle(sets.single,'PLAN_B'),standard:emptyStandardPlan(sets.single.scenario)});
 const [vehicleId,setVehicleIdState]=useState('V01'),[selectedStopId,setStop]=useState('S03'),[selectedCargoId,setCargo]=useState<string>();
 const [inspection,setInspection]=useState<FleetPlan|null>(null),[revision,setRevision]=useState<any>(null),[inspectionKind,setInspectionKind]=useState<'failed'|'original'|null>(null);
 const [candidate,setCandidate]=useState<FleetPlan|null>(null);
 const [planScenarios,setPlanScenarios]=useState<Record<Mode,Scenario>>({single:sets.single.scenario,fleet:sets.fleet.scenario,standard:sets.single.scenario});
 const [standardDraftScenario,setStandardDraftScenario]=useState<StandardScenario|null>(null);
 const [standardVehicleCatalog,setStandardVehicleCatalog]=useState<any[]>([]);
 const [standardMeta,setStandardMeta]=useState<StandardMeta>({validation:'idle',solverStatus:'idle',confirmed:false});
 const [standardResponse,setStandardResponse]=useState<StandardDecision|null>(null);
 const [confirmedStandardResponse,setConfirmedStandardResponse]=useState<StandardDecision|null>(null);
 const [standardNeedsPlanning,setStandardNeedsPlanning]=useState(false);
 const [serviceReady,setServiceReady]=useState<boolean|null>(null);
 const [playbacks,setPlaybacks]=useState<Record<string,Playback>>({}),[startedPlan,setStartedPlan]=useState<string|null>(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[editor,setEditor]=useState(false);
 const [draft,setDraft]=useState<DraftRoute[]>([]),[allowRepair,setAllowRepair]=useState(true),[departure,setDeparture]=useState('08:00');
 const [baseSingleId,setBaseSingleId]=useState('PLAN_A');
 const controller=useRef<AbortController|null>(null),serial=useRef(0),lastRequest=useRef<unknown>(undefined),manualInspection=useRef(false);
 const current=inspection??candidate??plans[mode];
 // Main pages describe the computed plan; editable conditions stay in the editor.
 const scenario=(mode==='fleet'?sets.fleet.scenario:revision&&'scenario' in revision&&(candidate||inspection)?revision.scenario:planScenarios[mode]) as Scenario;
 const resultLabel=mode==='standard'?standardNeedsPlanning?'条件已变化 · 请重新规划':standardMeta.confirmed?'已确认配送计划':candidate?'已校验计划 · 待确认':inspectionKind==='failed'?'当前条件未形成可执行计划':'待提交规划':inspectionKind==='failed'?'提交草案 · 检查未通过':inspectionKind==='original'?'原提交影响 · 对照查看':candidate?'已校验修订 · 待确认':revision&&plans[mode].planId===('planId' in revision?revision.planId:revision.result.planId)?'已确认修订方案':'已保存方案';
 const standardPlanConfirmed=standardMeta.confirmed&&!standardNeedsPlanning&&standardResponse?.planId===plans.standard.planId&&standardResponse?.scenarioFingerprint===standardMeta.scenarioFingerprint;
 const canExecute=!busy&&plans[mode].feasibility.executable&&!inspection&&!candidate&&(mode!=='standard'||standardPlanConfirmed);
 const route=current.routes.find(r=>r.vehicleId===vehicleId)??current.routes[0];
 const key=`${mode}:${current.planId}:${inspectionKind??'plan'}:${route.vehicleId}`;
 const playback=playbacks[key]??emptyPlayback;
 const steps=productSteps(route,playback.phase);
 const cancel=()=>{serial.current++;controller.current?.abort();setBusy(false);};
 const pause=()=>setPlaybacks(p=>Object.fromEntries(Object.entries(p).map(([k,v])=>[k,{...v,playing:false}])));
 useEffect(()=>()=>controller.current?.abort(),[]);
 useEffect(()=>{
  let alive=true;const health=new AbortController();
 async function check(){const ctrl=new AbortController();const timeout=window.setTimeout(()=>ctrl.abort(),2500);const abort=()=>ctrl.abort();health.signal.addEventListener('abort',abort);try{const response=await fetch('/api/city-delivery/health',{signal:ctrl.signal,cache:'no-store'});const value=await response.json();if(alive)setServiceReady(response.ok&&value.ready===true);}catch{if(alive)setServiceReady(false);}finally{window.clearTimeout(timeout);health.signal.removeEventListener('abort',abort);}}
  check();const timer=window.setInterval(check,5000);return()=>{alive=false;health.abort();window.clearInterval(timer);};
 },[sets.fleet.contract]);
 useEffect(()=>{pause();if(page==='execution'){setPlaybacks(old=>Object.fromEntries(Object.entries(old).map(([key,value])=>[key,value.phase==='loading'?{...emptyPlayback,speed:value.speed}:value])));if(playback.phase==='loading'){manualInspection.current=false;setStop(route.stopOrder[0]??'');setCargo(undefined);}}},[page]);
 const live=useRef({current,playbacks,mode,inspectionKind,page});live.current={current,playbacks,mode,inspectionKind,page};
 const hasPlaying=Object.values(playbacks).some(p=>p.playing);
 useEffect(()=>{
  if(!hasPlaying)return;
  let frame=0,last=0;
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const tick=(time:number)=>{
   const dt=last?(time-last)/1000:0;last=time;
   const state=live.current;
   setPlaybacks(old=>{
    let changed=false;const next={...old};
    for(const r of state.current.routes){
     const k=`${state.mode}:${state.current.planId}:${state.inspectionKind??'plan'}:${r.vehicleId}`;const p=old[k];
     if(!p?.playing)continue;
     const s=productSteps(r,p.phase);
     if(state.page!=='packing'&&state.page!=='execution'){next[k]={...p,playing:false};changed=true;continue;}
     let budget=dt,index=p.index,progress=p.progress,playing=true;
     while(playing){
      const step=s[index];
      if(!step||step.operation==='blocked'){playing=false;progress=0;break;}
      const duration=reduced?.08:Math.max(.3,step.durationSeconds)/p.speed;
      const needed=(1-progress)*duration;
      if(budget<needed){progress+=budget/duration;break;}
      budget-=needed;index++;progress=0;
      if(p.single||index>=s.length){playing=false;break;}
     }
     next[k]={...p,index,progress,playing};changed=true;
    }
    return changed?next:old;
   });
   frame=requestAnimationFrame(tick);
  };frame=requestAnimationFrame(tick);return()=>cancelAnimationFrame(frame);
 },[hasPlaying]);
 useEffect(()=>{if(playback.playing)manualInspection.current=false;else if(manualInspection.current)return;const step=steps[Math.min(playback.index,steps.length-1)];if(step&&(playback.playing||playback.index>0)){setStop(step.stopId);setCargo(step.cargoId);}},[playback.index,playback.playing,key]);
 function setPlayback(change:Partial<Playback>){if(startedPlan&&(change.phase==='loading'||change.index!==undefined&&change.index<playback.index)){setError('模拟执行已开始，请先恢复发车前规划，再重播装车或回退。');return;}setPlaybacks(p=>({...p,[key]:{...(p[key]??emptyPlayback),...change}}));}
 function selectVehicle(id:string){manualInspection.current=false;pause();setVehicleIdState(id);setCargo(undefined);const r=current.routes.find(r=>r.vehicleId===id);const p=playbacks[`${mode}:${current.planId}:${inspectionKind??'plan'}:${id}`];setStop(r?productSteps(r,p?.phase??'unloading')[p?.index??0]?.stopId??r.stopOrder[0]??'': '');}
 function selectStop(id:string){manualInspection.current=true;setStop(id);setCargo(undefined);const r=current.routes.find(r=>r.stopOrder.includes(id));if(r&&r.vehicleId!==vehicleId){pause();setVehicleIdState(r.vehicleId);}}
 function selectCargo(id:string){const c=scenario.cargo.find(c=>c.cargoId===id);if(c)selectStop(c.stopId);setCargo(id);}
 function setMode(value:Mode){if(value===mode)return;if(value==='standard'&&standardMeta.validation==='idle'){setError('请先在订单与货物页面导入并检查新场景。');return;}if(startedPlan){setError('请先恢复发车前规划，再切换场景。');return;}cancel();pause();setModeState(value);setCandidate(value==='standard'&&!standardMeta.confirmed&&!standardNeedsPlanning&&standardResponse?.executable?plans.standard:null);setInspection(null);setInspectionKind(null);setRevision(null);lastRequest.current=undefined;setError('');setEditor(false);setStartedPlan(null);setCargo(undefined);const first=plans[value].routes.find(r=>r.active!==false)??plans[value].routes[0];setVehicleIdState(first?.vehicleId??scenario.vehicles[0]?.vehicleId??'');setStop(first?.stopOrder[0]??'');}
 function choosePlan(id:string){if(mode==='standard')return;if(startedPlan){setError('请先恢复发车前规划，再切换配送方案。');return;}cancel();pause();const p=mode==='fleet'?sets.fleet.plans.plans.find(p=>p.planId===id)!:singleBundle(sets.single,id);setPlans(old=>({...old,[mode]:p}));setPlanScenarios(old=>({...old,[mode]:mode==='single'?sets.single.scenario:sets.fleet.scenario}));if(p.feasibility.executable)setConfirmed(old=>({...old,[mode]:p}));if(mode==='single')setBaseSingleId(id);setCandidate(null);setInspection(null);setInspectionKind(null);setRevision(null);lastRequest.current=undefined;setEditor(false);setError('');setStartedPlan(null);setPlaybacks({});const first=p.routes.find(r=>r.active!==false)??p.routes[0];setVehicleIdState(first.vehicleId);setStop(first.stopOrder[0]??'');setCargo(undefined);}
 function openEditor(){pause();if(mode==='standard'){setEditor(true);setError('');return;}const previous=lastRequest.current as {routes?:DraftRoute[];stopOrder?:string[];departureTime?:string}|undefined;
  const rows=inspectionKind==='failed'&&previous?(previous.routes??[{vehicleId:'V01',stopOrder:previous.stopOrder!}]):plans[mode].routes;
  setDraft(rows.map(r=>({vehicleId:r.vehicleId,stopOrder:[...r.stopOrder]})));setDeparture(inspectionKind==='failed'?previous?.departureTime??scenario.departureTime:scenario.departureTime);setEditor(true);setError('');}
 function moveStop(sid:string,offset:number){setDraft(old=>old.map(r=>{const from=r.stopOrder.indexOf(sid),to=from+offset;if(from<0||to<0||to>=r.stopOrder.length)return r;const order=[...r.stopOrder];[order[from],order[to]]=[order[to],order[from]];return {...r,stopOrder:order};}));}
 function assignStop(sid:string,vid:string){setDraft(old=>old.map(r=>({vehicleId:r.vehicleId,stopOrder:[...r.stopOrder.filter(s=>s!==sid),...(r.vehicleId===vid?[sid]:[])]})));}
 async function submit(reallocate:boolean,override?:DraftRoute[]) {
  if(serviceReady!==true){setError('调整服务不可用，已保存计划仍可查看和播放。恢复服务后才能提交。');return;}
  if(startedPlan){setError('当前为模拟执行状态，请先恢复发车前规划再调整。');return;}
  const rows=override??draft;
  if(mode==='single'&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(departure)){setError('请输入有效出发时间，例如 08:00。');return;}
  pause();controller.current?.abort();const ctrl=new AbortController(),number=++serial.current;controller.current=ctrl;setBusy(true);setError('');
  const body=mode==='fleet'?{scenarioId:scenario.scenarioId,routes:rows,allowReassignment:reallocate}:{scenarioId:scenario.scenarioId,basePlanId:baseSingleId,stopOrder:rows[0].stopOrder,departureTime:departure,allowLayoutRepair:reallocate};
  lastRequest.current=mode==='standard'?{scenario:standardDraftScenario??planScenarios.standard,strategy:allowRepair?'joint-feedback':'route-first',budgetMs:2000,allowLayoutRepair:allowRepair,allowReassignment:reallocate,routes:rows}:body;
  const timeout=window.setTimeout(()=>ctrl.abort(),15000);
  try{
  const response=mode==='standard'
   ?await planStandardScene(lastRequest.current as Record<string,unknown>,ctrl.signal)
   :await post<ProductOrderDecision|ProductFleetDecision>(sets.fleet.contract.endpoints[mode==='fleet'?'reviseFleet':'reviseOrder'].path,body,ctrl.signal);
   if(ctrl.signal.aborted||number!==serial.current)return;
   if(response.scenarioId!==scenario.scenarioId)throw new Error('返回场景与提交任务不一致，原计划已保留。');
   if(mode==='standard'){
    const standard=response as StandardDecision;
    const result=standardPlanToFleetPlan(standard.result??standard.initialCheck,standard.scenario,standard.planId);
    setStandardResponse(standard);setStandardNeedsPlanning(false);setPlans(old=>({...old,standard:result}));setStandardMeta({validation:'valid',solverStatus:standard.solverStatus,constraintVersion:standard.constraintVersion,scenarioFingerprint:standard.scenarioFingerprint,confirmed:false,planId:standard.planId,revisionId:standard.revisionId,strategy:standard.strategy,timing:standard.timing,search:standard.search,source:standard.source});
    setPlanScenarios(old=>({...old,standard:cleanStandardScenario(standard.scenario)}));setRevision(standard as unknown as ProductOrderDecision);setEditor(false);setCargo(undefined);setPlaybacks({});
    if(standard.executable){setCandidate(result);setInspection(null);setInspectionKind(null);const first=result.routes.find(r=>r.active!==false)??result.routes[0];setVehicleIdState(first?.vehicleId??'');setStop(first?.stopOrder[0]??'');}
    else{setCandidate(null);setInspection(result);setInspectionKind('failed');const failed=result.routes.find(r=>!r.feasibility.executable)??result.routes[0];setVehicleIdState(failed?.vehicleId??'');setStop(failed?.stopOrder[0]??'');}
    return;
   }
   const legacyResponse=response as ProductOrderDecision|ProductFleetDecision;
   let result:FleetPlan;
   if('submittedCheck' in legacyResponse){normalizeFleet(legacyResponse.submittedCheck);normalizeFleet(legacyResponse.result);validateFleet(scenario,legacyResponse.submittedCheck);validateFleet(scenario,legacyResponse.result);result=legacyResponse.result;}
   else{validateRoute(legacyResponse.scenario,legacyResponse.result);validateRoute(legacyResponse.scenario,legacyResponse.originalLayoutCheck);result=bundleFromRoute(legacyResponse.result);}
   setRevision(legacyResponse);setEditor(false);setCargo(undefined);setPlaybacks({});
   if(legacyResponse.executable){setCandidate(result);setInspection(null);setInspectionKind(null);const first=result.routes.find(r=>r.active!==false)??result.routes[0];setVehicleIdState(first.vehicleId);setStop(first.stopOrder[0]??'');}
   else{setCandidate(null);setInspection(result);setInspectionKind('failed');const failed=result.routes.find(r=>!r.feasibility.executable)??result.routes[0];setVehicleIdState(failed.vehicleId);const reason=failed.feasibility.reasons.find((r:any)=>r.stopId);setStop(reason?.stopId??failed.stopOrder[0]??'');}
  }catch(e){if(number===serial.current)setError(ctrl.signal.aborted?'本次检查超时，原可用方案已保留，请重试。':e instanceof Error&&!/fetch|network|json|unexpected token/i.test(e.message)?e.message:'调整服务暂时不可用，已保留原可执行计划，请重试。');}
  finally{window.clearTimeout(timeout);if(number===serial.current)setBusy(false);}
 }
 function simulateConflict(){const rows=sets.fleetExample.request.routes;setDraft(rows);setStop('S09');setVehicleIdState('V01');submit(false,rows);}
 function allowReassignment(){if(!lastRequest.current)return;const request=lastRequest.current as {routes?:DraftRoute[];stopOrder?:string[]};submit(true,request.routes??[{vehicleId:'V01',stopOrder:request.stopOrder!}]);}
 function viewOriginal(){if(!revision)return;pause();const previous:FleetPlan='submittedCheck' in revision?revision.submittedCheck:bundleFromRoute(revision.originalLayoutCheck);setInspection(previous);setInspectionKind('original');setCargo(undefined);const r=previous.routes.find((route)=>!route.feasibility.executable)??previous.routes[0];setVehicleIdState(r.vehicleId);setStop(r.feasibility.reasons.find((reason)=>reason.stopId)?.stopId??r.stopOrder[0]??'');}
 function returnCurrent(){pause();setInspection(null);setInspectionKind(null);setCargo(undefined);const view=candidate??plans[mode];const r=view.routes.find(r=>r.vehicleId===vehicleId)??view.routes[0];setVehicleIdState(r.vehicleId);setStop(r.stopOrder[0]??'');}
 function confirmCandidate(){if(busy||standardNeedsPlanning&&mode==='standard'||!candidate?.feasibility.executable)return;pause();setPlans(old=>({...old,[mode]:candidate}));setConfirmed(old=>({...old,[mode]:candidate}));if(revision&&'scenario' in revision){setPlanScenarios(old=>({...old,[mode]:mode==='standard'?cleanStandardScenario(revision.scenario):revision.scenario as Scenario}));if(mode==='standard')setStandardDraftScenario(cleanStandardScenario(revision.scenario));}if(mode==='standard'){setStandardMeta(old=>({...old,confirmed:true}));setStandardResponse(old=>old?{...old,confirmed:true}:old);setConfirmedStandardResponse(standardResponse?{...standardResponse,confirmed:true}:null);}setCandidate(null);setInspection(null);setInspectionKind(null);setPlaybacks({});setError('');}
 function keepOriginal(){if(mode==='standard'){restoreStandard();return;}cancel();pause();setCandidate(null);setInspection(null);setInspectionKind(null);setRevision(null);setEditor(false);setError('');setPlaybacks({});const r=plans[mode].routes.find(r=>r.active!==false)??plans[mode].routes[0];setVehicleIdState(r.vehicleId);setStop(r.stopOrder[0]??'');setCargo(undefined);}
 function restoreConfirmed(){if(mode==='standard'){restoreStandard();return;}cancel();pause();setPlans(old=>({...old,[mode]:confirmed[mode]}));setCandidate(null);setInspection(null);setInspectionKind(null);setRevision(null);setEditor(false);setError('');setCargo(undefined);const r=confirmed[mode].routes.find(r=>r.active!==false)??confirmed[mode].routes[0];setVehicleIdState(r.vehicleId);setStop(r.stopOrder[0]??'');}
 function invalidateStandard(){cancel();pause();setStandardNeedsPlanning(true);setStandardMeta(old=>({...old,confirmed:false}));setStandardResponse(old=>old?{...old,confirmed:false}:old);setCandidate(null);setInspection(null);setInspectionKind(null);setRevision(null);setPlaybacks({});}
 function restoreStandard(){cancel();pause();const response=confirmedStandardResponse;const restoredScenario=response?cleanStandardScenario(response.scenario):cleanStandardScenario(standardDraftScenario??planScenarios.standard);const plan=response?confirmed.standard:emptyStandardPlan(restoredScenario);setPlans(old=>({...old,standard:plan}));setPlanScenarios(old=>({...old,standard:restoredScenario}));setStandardDraftScenario(structuredClone(restoredScenario));setStandardResponse(response);setStandardNeedsPlanning(false);setStandardMeta({validation:'valid',solverStatus:response?.solverStatus??'VALID',confirmed:!!response,scenarioFingerprint:response?.scenarioFingerprint,planId:response?.planId,revisionId:response?.revisionId,constraintVersion:response?.constraintVersion,strategy:response?.strategy});setCandidate(null);setInspection(null);setInspectionKind(null);setRevision(null);setEditor(false);setError('');setPlaybacks({});const first=plan.routes.find(r=>r.active!==false)??plan.routes[0];setVehicleIdState(first.vehicleId);setStop(first.stopOrder[0]??restoredScenario.stops[0]?.stopId??'');setCargo(undefined);}
 function resetExecution(){pause();setStartedPlan(null);setPlaybacks({});setStop(route.stopOrder[0]??'');}
 function startExecution(){if(!canExecute)return;const resume=startedPlan===plans[mode].planId;setStartedPlan(plans[mode].planId);setPlaybacks(old=>({...old,...Object.fromEntries(plans[mode].routes.filter(r=>r.active!==false).map(r=>{const k=`${mode}:${current.planId}:plan:${r.vehicleId}`,previous=resume?old[k]:undefined;const state=previous?.phase==='unloading'?previous:{...emptyPlayback,speed:4};return [k,{...state,playing:state.index<productSteps(r,'unloading').length}];}))}));}
 async function importStandardScenario(input:StandardScenario){
  if(startedPlan)throw new Error('请先恢复发车前规划，再导入任务。');
  cancel();const ctrl=new AbortController(),number=serial.current;controller.current=ctrl;setBusy(true);pause();setError('');setStandardMeta(old=>({...old,validation:'validating',solverStatus:'idle',confirmed:false}));
  let validation;
  try{validation=await validateStandardScene(input,ctrl.signal);if(number!==serial.current)return;}catch(error){if(number===serial.current)setStandardMeta(old=>({...old,validation:'invalid',solverStatus:'INPUT_INVALID',confirmed:false}));throw error;}finally{if(number===serial.current)setBusy(false);}
  // The validation response includes display-only normalized fields. Re-submit the
  // original contract input so strict server validation never receives those extras.
  const normalized=cleanStandardScenario(input);const draft=emptyStandardPlan(normalized);
  setPlanScenarios(old=>({...old,standard:normalized}));setStandardDraftScenario(structuredClone(normalized));setStandardVehicleCatalog(structuredClone(normalized.vehicles??[]));setPlans(old=>({...old,standard:draft}));setConfirmed(old=>({...old,standard:draft}));setStandardResponse(null);setConfirmedStandardResponse(null);setStandardNeedsPlanning(false);setStandardMeta({validation:'valid',solverStatus:'VALID',constraintVersion:validation.constraintVersion,confirmed:false,source:normalized.source});setModeState('standard');setVehicleIdState(normalized.vehicles[0]?.vehicleId??'');setStop(normalized.stops[0]?.stopId??'');setCargo(undefined);setCandidate(null);setInspection(null);setInspectionKind(null);setRevision(null);setEditor(false);setPlaybacks({});return validation;
 }
 async function planImportedStandard(strategy:'route-first'|'layout-repair'|'joint-feedback',scenarioOverride?:StandardScenario){
  if(standardMeta.validation!=='valid'&&!scenarioOverride)throw new Error('请先导入并通过场景检查。');
  if(startedPlan)throw new Error('请先恢复发车前规划，再改变条件。');
  cancel();pause();const ctrl=new AbortController(),number=serial.current;controller.current=ctrl;setBusy(true);setStandardNeedsPlanning(true);setStandardMeta(old=>({...old,confirmed:false}));setCandidate(null);setInspection(null);setInspectionKind(null);setRevision(null);setError('');const request={scenario:scenarioOverride??standardDraftScenario??planScenarios.standard,strategy,budgetMs:2000,allowLayoutRepair:strategy!=='route-first',allowReassignment:strategy==='joint-feedback'};
  lastRequest.current=request;const timeout=window.setTimeout(()=>ctrl.abort(),15000);
  try{
   const standard=await planStandardScene(request,ctrl.signal);if(ctrl.signal.aborted||number!==serial.current)return;const result=standardPlanToFleetPlan(standard.result??standard.initialCheck,standard.scenario,standard.planId);
   setStandardResponse(standard);setStandardNeedsPlanning(false);setPlans(old=>({...old,standard:result}));setStandardMeta({validation:'valid',solverStatus:standard.solverStatus,constraintVersion:standard.constraintVersion,scenarioFingerprint:standard.scenarioFingerprint,confirmed:false,planId:standard.planId,revisionId:standard.revisionId,strategy:standard.strategy,timing:standard.timing,search:standard.search,source:standard.source});setPlanScenarios(old=>({...old,standard:cleanStandardScenario(standard.scenario)}));setStandardDraftScenario(cleanStandardScenario(standard.scenario));setRevision(standard as unknown as ProductOrderDecision);setEditor(false);setPlaybacks({});
   if(standard.executable){setCandidate(result);setInspection(null);setInspectionKind(null);const first=result.routes.find(r=>r.active!==false)??result.routes[0];setVehicleIdState(first?.vehicleId??'');setStop(first?.stopOrder[0]??'');}
   else{setCandidate(null);setInspection(result);setInspectionKind('failed');const failed=result.routes.find(r=>!r.feasibility.executable)??result.routes[0];setVehicleIdState(failed?.vehicleId??'');setStop(failed?.stopOrder[0]??'');}
   return standard;
  }catch(error){if(number===serial.current)setError(ctrl.signal.aborted?'本次规划超时，请重新计算；旧计划仅供查看。':error instanceof Error?error.message:'新条件规划失败，旧计划仅供查看。');throw error;}finally{window.clearTimeout(timeout);if(number===serial.current)setBusy(false);}
 }
 function setStandardVehicleEnabled(vehicleId:string,enabled:boolean){if(mode!=='standard'||startedPlan)return;const vehicles=standardDraftScenario?.vehicles??planScenarios.standard.vehicles;if(!enabled&&vehicles.length<=1||enabled===vehicles.some((v:any)=>v.vehicleId===vehicleId))return;invalidateStandard();setStandardDraftScenario(previous=>{const base=structuredClone(previous??planScenarios.standard) as StandardScenario;const vehicles=Array.isArray(base.vehicles)?base.vehicles:[];if(!enabled&&vehicles.length<=1)return base;const next=enabled?([...vehicles.filter((v:any)=>v.vehicleId!==vehicleId),...standardVehicleCatalog.filter((v:any)=>v.vehicleId===vehicleId)]):vehicles.filter((v:any)=>v.vehicleId!==vehicleId);if(!next.length)return base;return {...base,vehicles:next};});setStandardMeta(old=>({...old,confirmed:false}));}
 function setStandardDeparture(value:string){if(mode!=='standard'||startedPlan||value===standardDraftScenario?.departureTime)return;invalidateStandard();setDeparture(value);setStandardDraftScenario(previous=>({...structuredClone(previous??planScenarios.standard),departureTime:value}));setStandardMeta(old=>({...old,confirmed:false}));}
 function setStandardStopWindow(stopId:string,end:string){if(mode!=='standard'||startedPlan||standardDraftScenario?.stops.find((s:any)=>s.stopId===stopId)?.timeWindow.end===end)return;invalidateStandard();setStandardDraftScenario(previous=>{const base=structuredClone(previous??planScenarios.standard) as StandardScenario;return {...base,stops:base.stops.map((s:any)=>s.stopId===stopId?{...s,timeWindow:{...s.timeWindow,end}}:s)};});setStandardMeta(old=>({...old,confirmed:false}));}
 async function prepareSkuBatch(rows:SkuOrderDraft[]){const batchScenario=makeStandardScenarioFromSku(scenario,rows);const validated=await importStandardScenario(batchScenario);if(!validated)return;await planImportedStandard('joint-feedback',batchScenario);return batchScenario;}
 function exportCurrentPlan(){if(mode!=='standard'||!canExecute||!standardResponse)return false;const payload={exportVersion:'2G-1.0',exportedAt:new Date().toISOString(),scenario:planScenarios.standard,plan:plans.standard,calculation:standardResponse,identity:{scenarioId:standardResponse.scenarioId,scenarioFingerprint:standardResponse.scenarioFingerprint,planId:standardResponse.planId,revisionId:standardResponse.revisionId,constraintVersion:standardResponse.constraintVersion},status:{solverStatus:standardResponse.solverStatus,confirmed:true,strategy:standardResponse.strategy},resultSource:standardResponse.resultSource??{kind:'computed-per-request'},checkedConstraints:['车厢边界','货物重叠','载重','允许朝向','易碎与承重','支撑','后门直线装卸','时间窗','唯一分配'],capabilityBoundary:standardResponse.capabilityBoundary??[]};const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const anchor=document.createElement('a');anchor.href=url;anchor.download=`${standardResponse.scenarioId}-${standardResponse.planId}.json`;anchor.click();URL.revokeObjectURL(url);return true;}
 function focusConflict(){const failed=current.routes.find(route=>!route.feasibility.executable)||current.routes.find(route=>route.unloadingCheck?.firstFailure);if(!failed)return;pause();setVehicleIdState(failed.vehicleId);const stop=failed.feasibility.reasons.find((reason:any)=>reason.stopId)?.stopId||failed.unloadingCheck?.firstFailure?.stopId||failed.stopOrder[0];if(stop)setStop(stop);setCargo(undefined);}
 return {sets,mode,setMode,current,currentPlan:plans[mode],confirmed:confirmed[mode],scenario,route,vehicleId,selectVehicle,selectedStopId,selectStop,selectedCargoId,selectCargo,focusConflict,candidate,confirmCandidate,keepOriginal,resultLabel,serviceReady,standardMeta,standardResponse,standardDraftScenario:standardDraftScenario??planScenarios.standard,standardVehicleCatalog,setStandardVehicleEnabled,setStandardDeparture,setStandardStopWindow,prepareSkuBatch,standardNeedsPlanning,standardPlanConfirmed,canExecute,standardAvailable:standardMeta.validation!=='idle',importStandardScenario,planImportedStandard,exportCurrentPlan,
  choosePlan,busy,error,editor,setEditor,draft,moveStop,assignStop,allowRepair,setAllowRepair,departure,setDeparture,openEditor,submit,simulateConflict,allowReassignment,
  inspectionKind,revision,viewOriginal,returnCurrent,restoreConfirmed,playbacks,playback,setPlayback,steps,key,pause,startedPlan,resetExecution,startExecution};
}

type ProductModel=ReturnType<typeof useProductModel>;
const ProductContext=createContext<ProductModel|null>(null);
export function useCityProduct(){const value=useContext(ProductContext);if(!value)throw new Error('missing city delivery state');return value;}
export function ProductProvider({sets,page,children}:{sets:DataSets;page:Page;children:ReactNode}){const value=useProductModel(sets,page);return <ProductContext.Provider value={value}>{children}</ProductContext.Provider>;}
export async function loadProduct(signal:AbortSignal):Promise<DataSets>{
 const [single,fleet,extras]=await Promise.all([loadDelivery(signal),loadFleet(signal),Promise.all(['comparison.json','fleet-adjustment-example.json'].map(name=>fetch(`${import.meta.env.BASE_URL}demo/city-delivery/v2/${name}`,{signal}).then(r=>{if(!r.ok)throw new Error('多车任务尚未读取完成。');return r.json();})))]);
 return {single,fleet,fleetComparison:extras[0],fleetExample:extras[1]};
}
