import { type FleetPlan, type DecisionRoute, type FleetDecision, type OrderDecision, type Reason } from '../decisions';
export type ProductReason=Reason&{vehicleId?:string;minimumTwoLaneWidthM?:number;availableWidthM?:number};
export type ProductOrderDecision=OrderDecision&{revision:OrderDecision['revision']&{changes:{cargoId:string;from:{x:number;y:number;z:number;rotation:number;vehicleId:string};to:{x:number;y:number;z:number;rotation:number;vehicleId:string}}[]}};
export type ProductFleetDecision=FleetDecision;
export type Totals=FleetPlan['totals']&{vehicleFixedCost?:number;drivingCost?:number};
export async function submit<T>(path:string,body:unknown,signal:AbortSignal):Promise<T>{
 const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal});
 const value=await response.json();
 if(!response.ok)throw new Error(value.error??'当前调整未被接受。');
 if(value.executionMode!=='computed-per-request')throw new Error('未取得本次实际检查结果，原计划已保留。');
 return value;
}
export function normalizeFleet(plan:FleetPlan){for(const route of plan.routes){route.cargoIds??=plan.assignments.filter(a=>a.vehicleId===route.vehicleId).flatMap(a=>a.cargoIds);route.unloadingCheck.firstFailure??=null;}return plan;}
export function routeReasons(route:DecisionRoute):ProductReason[]{return route.feasibility.reasons as ProductReason[];}
