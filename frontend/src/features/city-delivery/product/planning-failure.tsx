import type { Reason, StandardDecision } from '../decisions';
import { Button } from '../../../components/ui/button';
import { useCityProduct } from './state';

type Failure=Reason&{vehicleId?:string;latestServiceStart?:string;lateMinutes?:number;actualDurationMinutes?:number;maxRouteDurationMinutes?:number;excessMinutes?:number};
export function failureMessages(response:Pick<StandardDecision,'scenario'|'result'|'initialCheck'|'search'>):string[]{
 const resultReasons=response.result?.feasibility.reasons??[],initialReasons=response.initialCheck?.feasibility.reasons??[];
 const planReasons=resultReasons.length?resultReasons:initialReasons;
 // Candidate-wide evidence is a fallback, never a competing explanation for an assessed plan.
 const reasons=(planReasons.length?planReasons:response.search?.failureEvidence??[]) as Failure[];
 const unique=new Map<string,Failure>();
 const richness=(r:Failure)=>Number(!!r.arrivalTime)+Number(!!r.serviceStartTime)+Number(r.lateMinutes!=null)+Number(r.actualDurationMinutes!=null);
 for(const reason of reasons){const key=[reason.type,reason.stopId,reason.vehicleId,reason.type==='time_window'?'':reason.message??reason.reason,reason.blockingCargoIds?.join(',')].join('|');const previous=unique.get(key);if(!previous||richness(reason)>richness(previous))unique.set(key,reason);}
 return [...unique.values()].sort((a,b)=>Number(!['time_window','max_route_duration','unloading_blocked'].includes(a.type??''))-Number(!['time_window','max_route_duration','unloading_blocked'].includes(b.type??''))).map(reason=>{
  const stop=response.scenario.stops.find((s:{stopId:string})=>s.stopId===reason.stopId),prefix=[stop?.name??reason.stopId,reason.vehicleId].filter(Boolean).join(' · ');
  let text=reason.message??reason.reason??'当前检查未通过。';
  if(reason.type==='time_window'){const end=reason.latestServiceStart??stop?.timeWindow?.end;text=reason.arrivalTime?`预计 ${reason.arrivalTime} 到店${end?`，最晚服务开始 ${end}`:''}${reason.lateMinutes!=null?`，超过 ${reason.lateMinutes} 分钟`:''}。`:end?`配送时间窗截至 ${end}，当前出发时间 ${response.scenario.departureTime}；${text}`:text;}
  if(reason.type==='max_route_duration')text=reason.actualDurationMinutes!=null&&reason.maxRouteDurationMinutes!=null?`行驶、等待、服务和返仓共 ${reason.actualDurationMinutes} 分钟，超过 ${reason.maxRouteDurationMinutes} 分钟上限${reason.excessMinutes!=null?` ${reason.excessMinutes} 分钟`:''}。`:'本车完整配送时长超过场景上限。';
  if(reason.type==='unloading_blocked')text=`后门直线取货检查未通过${reason.blockingCargoIds?.length?`，阻挡货物 ${reason.blockingCargoIds.join('、')}`:''}。${reason.reason??''}`;
  if(['route_search_failed','layout_search_failed','no_supported_layout','partition_length'].includes(reason.type??''))text=`${text} 仅表示当前有限搜索未找到通过检查的方案。`;
  return `${prefix?prefix+'：':''}${text}`;
 }).filter((text,i,all)=>all.indexOf(text)===i);
}

export function PlanningFailure(){
 const p=useCityProduct(),response=p.standardResponse;
 if(p.mode!=='standard'||!response||response.executable||p.standardNeedsPlanning)return null;
 const reasons=failureMessages(response);
 const usingCandidateEvidence=!(response.result?.feasibility.reasons.length||response.initialCheck?.feasibility.reasons.length);
 return <section className="p-planning-failure" role="status"><header><strong>本次未找到可执行方案</strong><Button disabled={p.busy||!p.serviceReady} onClick={p.openEditor}>修改配送条件</Button></header>{usingCandidateEvidence&&<small>以下来自后端候选检查证据，尚未形成完整计划。</small>}{reasons.length?reasons.slice(0,4).map(text=><p key={text}>{text}</p>):<p>后端未提供更具体的失败原因；只能确认本次搜索没有发布可执行计划。</p>}{reasons.length>4&&<details><summary>其他检查原因（{reasons.length-4}）</summary>{reasons.slice(4).map(text=><p key={text}>{text}</p>)}</details>}<small>当前没有可执行费用；不能确认、模拟执行或导出合法作业单。有限搜索失败不等于全局无解。</small></section>;
}
