import { useRef } from 'react';
import { Button } from '@/components/ui/button';
import type { Scenario, FleetPlan } from '../decisions';
import { useCityProduct } from './state';

// Read the solver's operation order; never infer it from cargo-array order.
export function buildOperationManifest(scenario:Scenario,plan:FleetPlan){
 const item=(cargoId:string,steps:{stepId:string;instruction?:string}[])=>({
  cargoId,cargo:scenario.cargo.find(c=>c.cargoId===cargoId)!,
  position:plan.routes.flatMap(r=>r.placements?.positions??[]).find(p=>p.cargoId===cargoId)!,steps,
 });
 return plan.routes.filter(r=>r.active!==false).map(route=>({
  vehicleId:route.vehicleId,executable:route.feasibility.executable,reasons:route.feasibility.reasons,
  loading:(route.unloading?.loadingSteps??[]).filter(s=>s.operation==='load'&&s.cargoId).map(s=>item(s.cargoId,[s])),
  stops:route.stopOrder.map(stopId=>{
   const steps=route.unloading?.steps.filter(s=>s.stopId===stopId)??[];
   const cargoIds=[...new Set(steps.filter(s=>s.operation==='unload'&&s.cargoId).map(s=>s.cargoId!))];
   return {stopId,name:scenario.stops.find(s=>s.stopId===stopId)!.name,
    cargo:cargoIds.map(id=>item(id,steps.filter(s=>s.cargoId===id))),
    blocked:steps.find(s=>s.operation==='blocked'),
    remainingCargoIdsAfter:route.unloading?.stations.find(s=>s.stopId===stopId)?.remainingCargoIdsAfter,
   };
  }),
 }));
}

const printStyles=`body{font:14px/1.4 sans-serif;color:#111;padding:24px}table{border-collapse:collapse;width:100%;margin:12px 0}th,td{border:1px solid #aaa;padding:8px;text-align:left}section{margin-bottom:24px}h2,h3,summary{break-after:avoid}tr,li{break-inside:avoid}li>strong,li>span{display:block;margin:4px 0}summary{font-weight:bold;margin:12px 0}small{display:block}button{padding:8px 16px}@media print{button{display:none}body{padding:0}}`;
export function OperationPlan(){
 const p=useCityProduct(),report=useRef<HTMLElement>(null);
 const vehicles=buildOperationManifest(p.scenario,p.current);
 function exportReadable(){
  if(!p.canExecute||!report.current)return;
  const copy=report.current.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('details').forEach(el=>el.open=true);
  const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>配送装卸作业清单</title><style>${printStyles}</style><body><button onclick="window.print()">打印 / 保存为 PDF</button>${copy.outerHTML}</body></html>`;
  const url=URL.createObjectURL(new Blob([html],{type:'text/html;charset=utf-8'}));
  const a=document.createElement('a');a.href=url;a.download=`${p.current.planId}-装卸作业单.html`;a.click();URL.revokeObjectURL(url);
 }
 const renderItem=(item:ReturnType<typeof buildOperationManifest>[number]['loading'][number])=><>
  <strong>{item.cargoId} · {item.cargo.name}</strong>
  <span>货位 x={item.position.x}, y={item.position.y}, z={item.position.z} m；朝向 {item.position.rotation}°</span>
  <span>{item.cargo.weightKg} kg · {item.cargo.fragile?'易碎，顶部禁堆':`上方承重 ≤ ${item.cargo.maxTopLoadKg} kg`} · 保持直立</span>
  <small>{(item.cargo as typeof item.cargo&{handlingRequirements?:string[]}).handlingRequirements?.join('；')}</small>
  <ol>{item.steps.map(step=><li key={step.stepId}>{step.instruction||'沿后门直线送入已检查货位，保持指定朝向。'}</li>)}</ol>
 </>;
 return <section className="p-standard-operation p-operation-delivery">
  <header><div><h2>装车与逐站卸货作业单</h2><p>{p.canExecute?'当前已确认计划，可交付作业清单。':'当前为检查预览；重新规划并确认后才能交付。'}</p></div><div><Button disabled={!p.canExecute} onClick={p.exportCurrentPlan}>导出已确认计划 JSON</Button><Button disabled={!p.canExecute} onClick={exportReadable}>导出可打印作业单</Button></div></header>
  <article ref={report} data-operation-plan={p.current.planId}>
   <h2>配送装卸作业清单</h2><p>{p.scenario.stops.length} 家门店 · {p.scenario.cargo.length} 件 · {vehicles.length} 辆启用车辆</p>
   <p>位置以车厢坐标记录，后门沿 z 轴直线装卸；按核验顺序操作，禁止自行绕障或额外搬货。本清单用于合成场景演示。</p>
   {vehicles.map(vehicle=><section key={vehicle.vehicleId} data-operation-vehicle={vehicle.vehicleId}><h3>{vehicle.vehicleId} · {vehicle.loading.length} 件装车</h3>
    {!vehicle.executable?<p role="alert">本车不可执行，不交付安全作业指引：{vehicle.reasons.map(r=>r.message??r.reason).join('；')}{vehicle.stops.filter(s=>s.blocked).map(s=>`${s.name}：${s.blocked!.instruction}`).join('；')}</p>:<>
     <details open><summary>装车清单 · 按实际装车顺序</summary><ol>{vehicle.loading.map(item=><li key={item.cargoId} data-loading-cargo={item.cargoId}><span>配送门店：{p.scenario.stops.find(s=>s.stopId===item.cargo.stopId)?.name}</span>{renderItem(item)}</li>)}</ol></details>
     {vehicle.stops.map((stop,i)=><details key={stop.stopId} open data-unloading-stop={stop.stopId}><summary>第 {i+1} 站 · {stop.name} · 卸货 {stop.cargo.length} 件</summary>
      <ol>{stop.cargo.map(item=><li key={item.cargoId} data-unloading-cargo={item.cargoId}>{renderItem(item)}</li>)}</ol>
      <p>完成后剩余 {stop.remainingCargoIdsAfter?.length??'未核验'} 件：{stop.remainingCargoIdsAfter?.join('、')||'无'}</p>
     </details>)}
    </>}
   </section>)}
   <details><summary>作业来源核对</summary><p>计划：{p.current.planId}；场景：{p.current.scenarioId}；修订：{p.standardResponse?.revisionId}；约束：{p.standardResponse?.constraintVersion}</p><p>输入指纹：{p.standardResponse?.scenarioFingerprint}；来源：{p.standardResponse?.resultSource?.kind}；确认状态：{p.standardPlanConfirmed?'已确认':'待确认'}</p></details>
  </article>
 </section>;
}
