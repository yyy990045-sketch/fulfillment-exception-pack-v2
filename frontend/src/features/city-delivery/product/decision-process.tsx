import {Link} from 'react-router-dom';
import {reasonText} from '../decisions';
import {decisionTrace,failureTypeLabel,traceChanges} from './decision-evidence';
import {failureMessages} from './planning-failure';
import {useCityProduct} from './state';

const phases:Record<string,string>={'route-first-check':'初始路线与装载检查','alternative-layout-check':'保持路线，尝试替代布局','layout-feedback-routing':'装载约束反馈到路线候选','budget-stop':'计算预算停止'};
export function DecisionProcess(){
 const p=useCityProduct(),response=p.standardResponse;
 if(p.mode!=='standard'||!response)return null;
 const trace=decisionTrace(response),initialPassed=response.initialCheck?.feasibility.executable===true;
 return <section className="p-decision-process" data-decision-process={response.planId} aria-label="本次联合反馈过程">
  <header><strong>{p.standardNeedsPlanning?'旧条件计算记录':initialPassed?'初始方案已通过，无需反馈':'本次路线—装载反馈'}</strong><Link to="/frontend/city-delivery/effects">历史策略证据</Link></header>
  <ol>{trace.map((entry,i)=>{
   const reasons=entry.failures??(entry.failure?[entry.failure]:[]),changes=traceChanges(trace[i-1]?.routes,entry.routes);
   return <li key={i} data-feedback-phase={entry.phase}>
    <strong>{i+1}. {phases[entry.phase??'']??entry.phase??'后端检查记录'}</strong>
    <span>{entry.executable===true?'整套检查通过':entry.executable===false?'检查未通过':entry.phase==='budget-stop'?'预算已耗尽':'未形成已核验候选'}{entry.routes&&` · ${entry.routes.filter(r=>r.stopOrder.length).map(r=>`${r.vehicleId} ${r.stopOrder.length} 店`).join('；')||'无启用车辆'}`}</span>
    {reasons[0]&&<p>{[reasons[0].vehicleId,reasons[0].stopId&&p.scenario.stops.find(s=>s.stopId===reasons[0].stopId)?.name,reasons[0].type&&failureTypeLabel(reasons[0].type)].filter(Boolean).join(' · ')}：{reasonText(reasons[0],p.scenario)}</p>}{entry.reason&&<p>{entry.reason}</p>}
    {(reasons.length>0||changes.length>0||entry.routes)&&<details><summary>{changes.length?`实际分配 / 顺序变化（${changes.length}）`:'查看路线与检查证据'}</summary>
     {changes.map(text=><p key={text}>{text}</p>)}{reasons.map((r,j)=><p key={j}>{reasonText(r,p.scenario)}</p>)}
     {entry.routes?.map(r=><p key={r.vehicleId}>{r.vehicleId}：{r.stopOrder.join(' → ')||'未启用'}</p>)}
    </details>}
   </li>;
  })}</ol>
  {!trace.length&&<p>后端未提供逐步记录，不推测修订过程。</p>}
  {!response.executable&&<div>{failureMessages(response).slice(0,2).map(text=><p key={text}>{text}</p>)}</div>}
  <small>{response.executable?'最终找到可执行候选，确认后才能执行。':'本次未找到可执行方案；有限搜索失败不等于全局无解。'}</small>
  <details><summary>计算身份与边界</summary><p>{response.planId} · {response.revisionId}</p><p>{response.constraintVersion} · {response.solverStatus}</p><p>{response.capabilityBoundary?.join('；')??'按本次返回的受支持规则检查，不宣称全局最优。'}</p></details>
 </section>;
}
