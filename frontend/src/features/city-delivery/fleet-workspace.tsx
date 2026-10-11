import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Check, Route, Truck, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { DeliveryData } from './data';
import { reasonText, routeData, submitDecision, validateFleet, type FleetData, type FleetDecision, type FleetPlan } from './decisions';
import { Workbench } from './workbench';

export function FleetWorkspace({base,fleet}:{base:DeliveryData;fleet:FleetData}) {
 const [savedId,setSavedId]=useState('FLEET_BASELINE'),[decision,setDecision]=useState<FleetDecision|null>(null),[showSubmitted,setShowSubmitted]=useState(false);
 const saved=fleet.plans.plans.find(p=>p.planId===savedId)!;
 const plan=decision?(showSubmitted?decision.submittedCheck:decision.result):saved;
 const [vehicleId,setVehicleId]=useState('V01'),[editing,setEditing]=useState(false),[draft,setDraft]=useState<{vehicleId:string;stopOrder:string[]}[]>([]);
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const request=useRef<AbortController|null>(null);
 useEffect(()=>()=>request.current?.abort(),[]);
 const scoped=fleet.scenario;
 const views=useMemo(()=>plan.routes.map(r=>({route:r,data:routeData(base,scoped,r,decision?'本次多车调整结果':savedId==='FLEET_BASELINE'?'三车基础方案':'两车候选方案')})),[base,scoped,plan,decision,savedId]);
 function open(){setDraft(plan.routes.map(r=>({vehicleId:r.vehicleId,stopOrder:[...r.stopOrder]})));setEditing(true);setError('');}
 function move(id:string,offset:number){setDraft(rows=>rows.map(r=>{const i=r.stopOrder.indexOf(id);if(i<0)return r;const j=i+offset;if(j<0||j>=r.stopOrder.length)return r;const order=[...r.stopOrder];[order[i],order[j]]=[order[j],order[i]];return {...r,stopOrder:order};}));}
 function assign(id:string,vid:string){setDraft(rows=>rows.map(r=>({vehicleId:r.vehicleId,stopOrder:[...r.stopOrder.filter(s=>s!==id),...(r.vehicleId===vid?[id]:[])]})));}
 async function submit(allowReassignment:boolean){
  request.current?.abort();const controller=new AbortController();request.current=controller;setBusy(true);setError('');
  try{
   const value=await submitDecision<FleetDecision>(fleet.contract,'reviseFleet',{scenarioId:scoped.scenarioId,routes:draft,allowReassignment},controller.signal);
   validateFleet(scoped,value.submittedCheck);validateFleet(scoped,value.result);
   if(value.scenarioId!==scoped.scenarioId)throw new Error('返回场景不一致。');
   setDecision(value);setShowSubmitted(false);setVehicleId(value.result.routes.find(r=>r.active)?.vehicleId??'V01');setEditing(false);
  }catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'调整检查未完成，原方案保持不变。');}
  finally{if(request.current===controller)setBusy(false);}
 }
 const summary=(p:FleetPlan)=>`${p.totals.vehicleCount} 辆 · ${p.totals.distanceKm} km · ¥${p.totals.totalCost}`;
 return <div className="cd-fleet-workspace">
  <section className="cd-fleet-switchboard">
   <div className="cd-fleet-top"><div><Truck size={19}/><strong>九店三车 · 统一配送任务</strong><span>36 件货物 · 合成场景</span></div><div><Button disabled={busy} onClick={open}><Route size={15}/>调整门店分配与顺序</Button></div></div>
   <div className="cd-fleet-options">{fleet.plans.plans.map(p=><Button key={p.planId} disabled={busy} className={!decision&&savedId===p.planId?'is-selected':''} onClick={()=>{setDecision(null);setSavedId(p.planId);setEditing(false);setError('');setVehicleId(p.routes.find(r=>r.active)?.vehicleId??'V01');}}><span>{p.planId==='FLEET_BASELINE'?'已保存 · 三车基础方案':'已保存 · 两车候选方案'}</span><strong>{summary(p)}</strong></Button>)}
    <div className="cd-fleet-summary"><span>{decision?'本次计算结果':'已保存候选方案'}</span><strong>{summary(plan)}</strong><small>{plan.feasibility.executable?'当前规则下可执行':'分配存在约束冲突'} · 最晚返仓 {plan.routes.map(r=>r.returnTime).sort().at(-1)}</small></div>
   </div>
   {!decision&&savedId==='FLEET_ADJUSTED'&&<p className="cd-fleet-tradeoff">相比三车基础方案：少用 1 辆车、少走 12 km、费用少 141.6 元；最晚返仓增加 4 分钟。仅为本场景结果。</p>}
   {editing&&<div className="cd-fleet-editor"><div className="cd-editor-heading"><strong>发车前调整 · 门店必须完整且唯一分配</strong><button disabled={busy} onClick={()=>setEditing(false)}>收起</button></div><div className="cd-fleet-draft-columns">{draft.map(r=><div key={r.vehicleId}><h3>{scoped.vehicles.find(v=>v.vehicleId===r.vehicleId)?.name}</h3>{r.stopOrder.map((id,i)=><div className="cd-fleet-draft-stop" key={id}><span>{i+1}</span><strong>{scoped.stops.find(s=>s.stopId===id)?.name}</strong><select aria-label={`${id}配送车辆`} value={r.vehicleId} disabled={busy} onChange={e=>assign(id,e.target.value)}>{scoped.vehicles.map(v=><option key={v.vehicleId} value={v.vehicleId}>{v.name}</option>)}</select><button aria-label={`${id}上移`} disabled={busy||i===0} onClick={()=>move(id,-1)}><ArrowUp size={13}/></button><button aria-label={`${id}下移`} disabled={busy||i===r.stopOrder.length-1} onClick={()=>move(id,1)}><ArrowDown size={13}/></button></div>)}</div>)}</div><div className="cd-editor-actions"><Button disabled={busy} onClick={()=>submit(false)}>{busy?'正在检查实际约束…':'检查提交分配'}</Button><Button disabled={busy} onClick={()=>submit(true)}>允许重新分配并复核</Button><span>只有明确允许时才改变车辆归属；失败时不编造货位。</span></div></div>}
   {error&&<p role="alert" className="cd-request-error">{error.includes('fetch')?'调整服务暂时不可用，已保留原计划。请恢复本机配送调整服务。':error}</p>}
   {decision&&<div className="cd-fleet-decision"><div className="cd-editor-heading"><strong>{decision.executable?'本次修订可执行':'本次提交未通过检查'}</strong><span>本次实际计算 · 发车前规划</span></div>{decision.submittedCheck.routes.flatMap(r=>r.feasibility.reasons).map((r,i)=><p key={i}><TriangleAlert size={14}/>{reasonText(r,scoped)}{r.cargoIds?.length?` 受影响：${r.cargoIds.join('、')}`:''}</p>)}<div className="cd-editor-actions">{decision.revision.reallocated&&<><Button className={showSubmitted?'is-selected':''} onClick={()=>setShowSubmitted(true)}>查看原提交冲突</Button><Button className={!showSubmitted?'is-selected':''} onClick={()=>setShowSubmitted(false)}>查看修订结果</Button><span>调整前后：{decision.delta.distanceKm>0?'+':''}{decision.delta.distanceKm} km · {decision.delta.totalCost>0?'+':''}{decision.delta.totalCost} 元 · 最晚时长 {decision.delta.totalDurationMinutes>0?'+':''}{decision.delta.totalDurationMinutes} 分钟</span></>}{!decision.executable&&<Button onClick={open}>修改条件后再检查</Button>}</div><small>布局或分配修订须在发车前重新准备装车；未计未提供的重装工时费用。不可执行提交方案费用为名义推演。</small></div>}
   <nav className="cd-vehicle-tabs" aria-label="选择配送车辆">{plan.routes.map(r=>{const v=scoped.vehicles.find(v=>v.vehicleId===r.vehicleId)!;return <Button key={r.vehicleId} className={r.vehicleId===vehicleId?'is-selected':''} onClick={()=>setVehicleId(r.vehicleId)}><Truck size={17}/><div><strong>{r.vehicleId} · {v.name}</strong><small>{v.compartment.length} × {v.compartment.width} × {v.compartment.height} m · {r.cargoIds.length} 件 · {r.stopOrder.length} 店</small></div><span className={r.feasibility.executable?'cd-green':'cd-amber'}>{r.status==='idle'?'未启用':r.feasibility.executable?<Check size={15}/>:<TriangleAlert size={15}/>}</span></Button>;})}</nav>
  </section>
  {views.map(({route:r,data})=><div key={`${plan.planId}-${r.vehicleId}-${showSubmitted}`} hidden={vehicleId!==r.vehicleId}><Workbench data={data} activeVehicle={vehicleId===r.vehicleId&&!editing&&!busy} fleetRoutes={plan.routes} embedded resultKind={decision?'computed':'saved'} /></div>)}
 </div>;
}
