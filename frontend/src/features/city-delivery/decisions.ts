import type { DeliveryData, Operations, Placement, Plan, Scenario } from './data';
export type { Scenario } from './data';

export interface Reason { type?:string; message?:string; reason?:string; stopId?:string; cargoIds?:string[]; targetCargoIds?:string[]; blockingCargoIds?:string[]; arrivalTime?:string; serviceStartTime?:string }
export interface DecisionRoute extends Omit<Plan,'loadingCheck'|'feasibility'|'unloadingCheck'|'loadingSequenceCargoIds'|'name'|'kind'|'computedBy'|'globalOptimalityClaim'> {
 loadingCheck:Plan['loadingCheck']|null;
 unloadingCheck:{checked:boolean;valid:boolean;firstFailure:Plan['unloadingCheck']['firstFailure']};
 feasibility:{executable:boolean;reasons:Reason[];scope?:string;uncheckedConstraints?:string[]};
 placements:{planId:string;vehicleId:string;positions:Placement[]}|null;
 unloading:Operations|null; cargoIds:string[];active?:boolean;status?:string;
 partialChecks?:{weight:{checked:boolean;valid:boolean;totalWeightKg:number;maxPayloadKg:number}};
}
export interface FleetPlan {
 planId:string;scenarioId:string;routes:DecisionRoute[];
 assignments:{stopId:string;vehicleId:string;cargoIds:string[]}[];
 totals:{vehicleCount:number;distanceKm:number;totalCost:number;totalDurationMinutes:number;drivingMinutes:number;extraHandlingMoves:number;extraHandlingCost:number};
 feasibility:{executable:boolean;reasons:Reason[]};
}
export interface FleetData {scenario:Scenario;plans:{plans:FleetPlan[]};contract:DecisionContract}
export interface DecisionContract { serviceBaseUrl:string;readinessPath:string;endpoints:{reviseOrder:{path:string};reviseFleet:{path:string}} }
export type StandardScenario=Record<string,any>;
export interface StandardDecision {
 schemaVersion:string; scenarioId:string; scenarioFingerprint?:string; planId:string; revisionId:string; constraintVersion:string;
 executionMode:string; solverStatus:'FEASIBLE'|'SEARCH_EXHAUSTED'|'INPUT_INVALID'|'SERVICE_ERROR'|'TIMEOUT'|'BUSY'|'VALID';
 executable:boolean; confirmed:boolean; scenario:StandardScenario; result:FleetPlan|null; initialCheck:FleetPlan|null;
 strategy:string; timing?:Record<string,number>; search?:{failureEvidence?:Reason[];scope?:string;limits?:Record<string,number>;trace?:unknown[];candidateEvaluations?:Array<{rank?:number;vehicleId:string;stopId:string;method:string;spanM:number;feasible:boolean;spaceUtilizationRatio:number|null;spaceUtilizationPercent:number|null;checkedMs:number;failureTypes:string[];movementCountBasis:string;rankingBasis?:string}>};
 revision:{changedCargoIds:string[];changes?:unknown[];reassigned?:boolean;requiresReloadBeforeDispatch?:boolean};
 actualExecutablePlanCost:number|null; capabilityBoundary?:string[]; source?:Record<string,unknown>; serviceTiming?:Record<string,number>; resultSource?:{kind?:string;service?:string;inputFingerprint?:string;historicalStaticComparison?:boolean};
}
export interface StandardValidation { schemaVersion:string;scenarioId:string;scenarioFingerprint?:string;constraintVersion:string;executionMode:'validation-only';solverStatus:'VALID';valid:true;scenario:StandardScenario;checkedConstraints:string[];capabilityBoundary:string[] }
export interface OrderDecision {
 scenarioId:string;planId:string;executionMode:string;precomputedOnly:boolean;scenario:Scenario;
 originalLayoutCheck:DecisionRoute;originalLayoutReusable:boolean;result:DecisionRoute;executable:boolean;
 revision:{status:string;changedCargoIds:string[];requiresReloadBeforeDispatch:boolean;costBoundary:string};
 comparison:{delta:{distanceKm:number;totalCost:number;totalDurationMinutes:number}};
}
export interface FleetDecision {scenarioId:string;executionMode:string;submittedCheck:FleetPlan;result:FleetPlan;executable:boolean;revision:{reallocated:boolean;requiresReloadBeforeDispatch:boolean};delta:{distanceKm:number;totalCost:number;vehicleCount:number;totalDurationMinutes:number}}

export async function loadFleet(signal:AbortSignal):Promise<FleetData> {
 const base=`${import.meta.env.BASE_URL}demo/city-delivery/v2/`;
 const manifest=await fetch(base+'manifest.json',{signal}).then(checkResponse);
 const [scenario,plans,placements,unloading,contract]=await Promise.all(['scenario','plans','placements','unloadingSteps','decisionContract'].map(k=>fetch(base+manifest.files[k],{signal}).then(checkResponse)));
 if([scenario,plans,placements,unloading].some(d=>d.scenarioId!==manifest.scenarioId))throw new Error('多车场景文件不一致，已停止加载。');
 for(const p of plans.plans as FleetPlan[]) {
  for(const route of p.routes) {
   const placement=placements.plans.find((v:{planId:string})=>v.planId===p.planId)?.vehicles.find((v:{vehicleId:string})=>v.vehicleId===route.vehicleId);
   const operations=unloading.plans.find((v:{planId:string})=>v.planId===p.planId)?.vehicles.find((v:{vehicleId:string})=>v.vehicleId===route.vehicleId);
   if(!placement||!operations)throw new Error('车辆缺少独立的货位或装卸步骤。');
   route.placements=placement;route.unloading=operations;
  }
  validateFleet(scenario,p);
 }
 return {scenario,plans,contract};
}
async function checkResponse(response:Response) {
 if(!response.ok)throw new Error('配送数据暂时无法读取。');
 return response.json();
}
export async function submitDecision<T>(contract:DecisionContract,kind:'reviseOrder'|'reviseFleet',body:unknown,signal:AbortSignal):Promise<T> {
 const response=await fetch(contract.serviceBaseUrl+contract.endpoints[kind].path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal});
 const result=await response.json();
 if(!response.ok)throw new Error(result.message||result.error||'请求未被接受，请检查配送条件。');
 if(result.executionMode!=='computed-per-request')throw new Error('没有取得本次调整的计算结果，原方案仍然保留。');
 return result;
}
const cityApi=(path:string)=>`${import.meta.env.VITE_CITY_DELIVERY_API??''}${path}`;
async function readCityResponse(response:Response){
 const result=await response.json().catch(()=>({error:'服务返回了无法读取的内容。'}));
 if(!response.ok){const detail=result.field?`${result.field}：${result.error??'输入不符合契约。'}`:result.error??'城市配送计算服务暂时不可用。';const error=new Error(detail);(error as Error&{status?:number;payload?:unknown}).status=response.status;(error as Error&{status?:number;payload?:unknown}).payload=result;throw error;}
 return result;
}
export async function validateStandardScene(scenario:StandardScenario,signal:AbortSignal):Promise<StandardValidation>{
 const response=await fetch(cityApi('/api/city-delivery/validate-scene'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scenario}),signal});
 const result=await readCityResponse(response);
 if(result.solverStatus!=='VALID'||result.valid!==true)throw new Error('新场景没有通过输入检查。');
 return result as StandardValidation;
}
export async function planStandardScene(request:Record<string,unknown>,signal:AbortSignal):Promise<StandardDecision>{
 const response=await fetch(cityApi('/api/city-delivery/plan-scene'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request),signal});
 const result=await readCityResponse(response);
 if(result.executionMode!=='computed-per-request')throw new Error('没有取得本次实际规划结果，原计划已保留。');
 return result as StandardDecision;
}
export function standardPlanToFleetPlan(result:StandardDecision['result'],scenario:StandardScenario,planId:string):FleetPlan{
 const sourceRoutes=result?.routes??(scenario.vehicles??[]).map((vehicle:any)=>({planId,scenarioId:scenario.scenarioId,vehicleId:vehicle.vehicleId,stopOrder:[],routeNodeIds:['DEPOT'],arrivals:[],legs:[],distanceKm:0,drivingMinutes:0,waitingMinutes:0,serviceMinutes:0,totalDurationMinutes:0,returnTime:scenario.departureTime,timeWindowCheck:{checked:false,valid:false,arrivals:[]},costs:{currency:'CNY',vehicleCount:0,vehicleFixedCost:0,drivingCost:0,extraHandlingMoves:0,extraHandlingCost:0,waitingCost:0,totalCost:0,basis:'当前搜索未发布计划'},cargoIds:[],loadingCheck:null,loadingPathCheck:{checked:false,valid:false,reason:'当前搜索未发布计划'},unloadingCheck:{checked:false,valid:false,firstFailure:null},feasibility:{executable:false,reasons:[{type:'search_failed',message:'当前搜索边界内没有发布可执行计划。'}]},placements:null,unloading:null,active:false,status:'search_failed'}));
 const routes=sourceRoutes.map((route:any)=>({...route,scenarioId:scenario.scenarioId,planId:route.planId??planId,
   cargoIds:route.cargoIds??(scenario.cargo as Array<{cargoId:string;stopId:string}>).filter(c=>route.stopOrder.includes(c.stopId)).map(c=>c.cargoId),
   active:route.active!==false,status:route.status??(route.feasibility?.executable?'scheduled':'search_failed'),
   placements:route.placements??null,unloading:route.unloading??null,
   loadingCheck:route.loadingCheck??null,unloadingCheck:route.unloadingCheck??{checked:false,valid:false,firstFailure:null},
   feasibility:route.feasibility??{executable:false,reasons:[]}})) as unknown as DecisionRoute[];
 const assignments=result?.assignments??routes.flatMap(r=>r.stopOrder.map(stopId=>({stopId,vehicleId:r.vehicleId,cargoIds:r.cargoIds.filter((id:string)=>(scenario.cargo as Array<{cargoId:string;stopId:string}>).some(c=>c.cargoId===id&&c.stopId===stopId))})));
 const totals=result?.totals??{vehicleCount:routes.filter(r=>r.active!==false).length,distanceKm:routes.reduce((n,r)=>n+r.distanceKm,0),totalCost:0,totalDurationMinutes:Math.max(0,...routes.map(r=>r.totalDurationMinutes??0)),drivingMinutes:routes.reduce((n,r)=>n+(r.drivingMinutes??0),0),extraHandlingMoves:0,extraHandlingCost:0};
 return {planId:result?.planId??planId,scenarioId:scenario.scenarioId,routes,assignments,totals,feasibility:result?.feasibility??{executable:false,reasons:[]}};
}
export function reasonText(reason:Reason,scenario:Scenario) {
 const name=scenario.stops.find(s=>s.stopId===reason.stopId)?.name;
 return `${name?name+'：':''}${reason.message||reason.reason||(reason.type==='time_window'?'到店时间超出配送时间窗。':reason.type==='unloading_blocked'?'后方货物挡住后门取货通道。':'当前约束未通过，请检查车辆与门店分配。')}`;
}
export function validateRoute(scenario:Scenario,route:DecisionRoute) {
 // Failed routes intentionally omit coordinates and may omit cargoIds. Map
 // declared stop assignments back to the scenario, without inventing geometry.
 route.cargoIds??=scenario.cargo.filter(c=>route.stopOrder.includes(c.stopId)).map(c=>c.cargoId);
 route.unloadingCheck.firstFailure??=null;
 const ids=new Set(scenario.cargo.map(c=>c.cargoId));
 if(route.scenarioId!==scenario.scenarioId||!scenario.vehicles.some(v=>v.vehicleId===route.vehicleId))throw new Error('返回的车辆或场景不一致。');
 if(route.placements){
  const positions=route.placements.positions;
  if(positions.some(p=>p.vehicleId!==route.vehicleId||!ids.has(p.cargoId))||new Set(positions.map(p=>p.cargoId)).size!==positions.length||positions.length!==route.cargoIds.length)throw new Error('返回货物与车辆归属不一致。');
 }
 if(route.feasibility.executable&&(!route.placements||!route.unloading||!route.unloading.valid||!route.loadingCheck?.valid||!route.timeWindowCheck.valid))throw new Error('返回方案缺少必要的可执行检查。');
}
export function validateFleet(scenario:Scenario,plan:FleetPlan) {
 if(plan.scenarioId!==scenario.scenarioId)throw new Error('返回的多车场景不一致。');
 plan.routes.forEach(r=>validateRoute(scenario,r));
 const stops=plan.routes.flatMap(r=>r.stopOrder),cargo=plan.routes.flatMap(r=>r.cargoIds);
 if(new Set(stops).size!==scenario.stops.length||stops.length!==scenario.stops.length||new Set(cargo).size!==scenario.cargo.length||cargo.length!==scenario.cargo.length)throw new Error('门店或货物出现重复分配、遗漏。');
}

// Thin read model only. No planning or constraint calculation is performed by
// the frontend. Unknown/failed geometry is rendered as unchecked, never passed.
export function routeData(base:DeliveryData,scenario:Scenario,route:DecisionRoute,name:string):DeliveryData {
 const s=structuredClone(scenario);
 s.vehicles=[scenario.vehicles.find(v=>v.vehicleId===route.vehicleId)!];
 s.cargo=scenario.cargo.filter(c=>route.cargoIds.includes(c.cargoId));
 const unchecked=structuredClone(base.plans.plans[0].loadingCheck);
 unchecked.checked=false;unchecked.valid=false;unchecked.cargoChecks={};
 unchecked.totalWeightKg=s.cargo.reduce((n,c)=>n+c.weightKg,0);unchecked.maxPayloadKg=s.vehicles[0].maxPayloadKg;
 for(const item of Object.values(unchecked.checks)){item.checked=false;item.valid=false;}
 if(route.partialChecks?.weight){Object.assign(unchecked.checks.weight,route.partialChecks.weight);unchecked.totalWeightKg=route.partialChecks.weight.totalWeightKg;unchecked.maxPayloadKg=route.partialChecks.weight.maxPayloadKg;}
 const p:Plan={...structuredClone(base.plans.plans[0]),...route,name,kind:'adjusted',loadingCheck:route.loadingCheck?.checked?route.loadingCheck:unchecked,
  unloadingCheck:{...route.unloadingCheck,rule:scenario.rules.extraction},
  feasibility:{...base.plans.plans[0].feasibility,...route.feasibility,reasons:route.feasibility.reasons.map(r=>reasonText(r,scenario))},
  loadingSequenceCargoIds:route.unloading?.loadingSteps.map(s=>s.cargoId)??[],computedBy:'existing-city-delivery-decision-service',globalOptimalityClaim:false};
 const empty:Operations={...structuredClone(base.unloadingSteps.plans[1]),planId:route.planId,vehicleId:route.vehicleId,stopOrder:route.stopOrder,
  steps:[],stations:[],loadingSteps:[],initialRemainingCargoIds:route.cargoIds,finalRemainingCargoIds:route.cargoIds,valid:false};
 return {...base,scenario:s,plans:{...base.plans,scenarioId:s.scenarioId,plans:[p]},
  placements:{...base.placements,scenarioId:s.scenarioId,plans:[{planId:p.planId,vehicleId:route.vehicleId,positions:route.placements?.positions??[]}]},
  unloadingSteps:{...base.unloadingSteps,scenarioId:s.scenarioId,plans:[route.unloading??empty]}};
}
