import type {DecisionRoute,Reason,StandardDecision} from '../decisions';
import type {Placement} from '../data';

export const failureTypeLabels:Record<string,string>={boundary:'车厢边界',collision:'空间重叠',weight:'载重',orientation:'货物朝向',fragile:'易碎禁堆',support:'基础支撑',loadBearing:'上方承重',unloading_blocked:'后门取货受阻',loading_path:'后门装车通道',layout_search_failed:'有限布局未找到',partition_length:'门店分区超长',stop_geometry:'当前分区几何不匹配',time_window:'配送时间窗',max_route_duration:'完整路线时长',route_search_failed:'有限路线搜索未找到'};
export const failureTypeLabel=(type:string)=>failureTypeLabels[type]??type;
type Check={checked?:boolean;valid?:boolean};
export function checkVerdict(check?:Check){return check?.checked===true&&typeof check.valid==='boolean'?check.valid?'通过':'失败':'未检查 / 无独立结论';}
export function routeConstraintRows(route:DecisionRoute){
 const checks=route.loadingCheck?.checks;
 return [
  ['boundary','车厢边界',checks?.boundary],['collision','碰撞 / 空间重叠',checks?.collision],
  ['weight','载重',checks?.weight??route.partialChecks?.weight],['orientation','货物朝向',checks?.orientation],
  ['fragile','易碎限制',checks?.fragile],['support','基础支撑',checks?.support],['loadBearing','上方承重',checks?.loadBearing],
  ['loading_path','后门装车可达性',route.loadingPathCheck],['unloading_blocked','后门卸货可达性',route.unloadingCheck],['time_window','时间窗',route.timeWindowCheck],
 ].map(([id,label,check])=>({id:id as string,label:label as string,verdict:checkVerdict(check as Check|undefined)}));
}
export function cargoConstraintRows(position:Placement){
 const c=position.spaceCheck;
 return [['boundary','边界',c?.boundaryValid],['collision','重叠',c?.collisionFree],['orientation','朝向',c?.orientationValid],['fragile','易碎',c?.fragileValid],['support','支撑',position.support?.valid],['loadBearing','承重',c?.loadBearingValid]].map(([id,label,value])=>({id:id as string,label:label as string,verdict:checkVerdict(typeof value==='boolean'?{checked:true,valid:value}:undefined)}));
}
export type TraceRoute={vehicleId:string;stopOrder:string[]};
export type DecisionTrace={phase?:string;routes?:TraceRoute[];executable?:boolean;failures?:Reason[];failure?:Reason;reason?:string};
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
export function decisionTrace(response:StandardDecision):DecisionTrace[]{
 return (response.search?.trace??[]).filter(object).map(entry=>({
  phase:typeof entry.phase==='string'?entry.phase:undefined,executable:typeof entry.executable==='boolean'?entry.executable:undefined,
  routes:Array.isArray(entry.routes)?entry.routes.filter(object).filter(r=>typeof r.vehicleId==='string'&&Array.isArray(r.stopOrder)&&r.stopOrder.every(s=>typeof s==='string')).map(r=>({vehicleId:r.vehicleId as string,stopOrder:r.stopOrder as string[]})):undefined,
  failures:Array.isArray(entry.failures)?entry.failures.filter(object) as Reason[]:undefined,
  failure:object(entry.failure)?entry.failure as Reason:undefined,reason:typeof entry.reason==='string'?entry.reason:undefined,
 }));
}
export function traceChanges(before:TraceRoute[]|undefined,after:TraceRoute[]|undefined){
 if(!before||!after)return [];
 const changes:string[]=[];
 for(const route of after){for(const stop of route.stopOrder){const previous=before.find(r=>r.stopOrder.includes(stop));if(previous&&previous.vehicleId!==route.vehicleId)changes.push(`${stop}：${previous.vehicleId} → ${route.vehicleId}`);}}
 for(const route of after){const previous=before.find(r=>r.vehicleId===route.vehicleId);if(previous&&JSON.stringify(previous.stopOrder)!==JSON.stringify(route.stopOrder))changes.push(`${route.vehicleId} 顺序：${route.stopOrder.join(' → ')||'空闲'}`);}
 return changes;
}
export function placementChangeText(changes:unknown[]|undefined){
 if(!changes)return '后端未提供逐件货位差异。';
 let generated=0,moved=0;
 for(const change of changes){if(!object(change)||!object(change.to))continue;if(change.from===null){generated++;continue;}const from=change.from,to=change.to;if(object(from)&&['x','y','z','rotation','vehicleId'].some(k=>from[k]!==to[k]))moved++;}
 return [generated?`新生成 ${generated} 件货位（没有原坐标，不计搬动）`:'',moved?`实际修订 ${moved} 件已有货位`:''].filter(Boolean).join('；')||'未发现已有货位变化。';
}
export function placementDiffText(change:unknown){
 if(!object(change)||!object(change.to))return '货位变化数据不完整。';
 if(change.from===null)return '新生成货位';
 if(!object(change.from))return '原货位未知，不能判断是否发生移动。';
 const from=change.from,to=change.to;
 const fields=['x','y','z','rotation','vehicleId'].filter(k=>from[k]!==to[k]);
 return fields.length?fields.map(key=>`${key} ${String(from[key])} → ${String(to[key])}`).join('；'):'货位未改变';
}
