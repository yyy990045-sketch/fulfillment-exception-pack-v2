import { useEffect, useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { BarChart3, Box, ChevronRight, ClipboardList, Download, Gauge, Layers3, Navigation, Route, Truck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AdjustmentEditor } from './components';
import { loadProduct, ProductProvider, useCityProduct, type DataSets, type Page } from './state';
import { DispatchPage, EffectsPage, ExecutionPage, OrdersPage, OverviewPage, PackingPage } from './pages';
import '../workbench.css';
import './product.css';
import './phase3b.css';
import './phase4a.css';
import './screening.css';

const navigation=[{id:'overview',name:'配送驾驶舱',icon:Gauge},{id:'orders',name:'订单与货物',icon:ClipboardList},{id:'dispatch',name:'智能调度',icon:Route},{id:'packing',name:'三维配载与装卸',icon:Box},{id:'execution',name:'执行与调整',icon:Navigation},{id:'effects',name:'优化效果',icon:BarChart3}] as const;
const pages={overview:OverviewPage,orders:OrdersPage,dispatch:DispatchPage,packing:PackingPage,execution:ExecutionPage,effects:EffectsPage};
export default function CityDeliveryProduct(){
 const location=useLocation();const part=location.pathname.split('/').at(-1);const page:Page=navigation.some(n=>n.id===part)?part as Page:'dispatch';
 const [sets,setSets]=useState<DataSets|null>(null),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
 useEffect(()=>{const controller=new AbortController();setError('');loadProduct(controller.signal).then(setSets).catch(e=>{if(!controller.signal.aborted)setError(e.message);});return()=>controller.abort();},[attempt]);
 if(part==='city-delivery'||part==='')return <Navigate to="/frontend/city-delivery/overview" replace/>;
 if(!sets)return <div className="cd-loading-page"><Layers3 size={40}/><h1>{error?'配送任务暂时无法打开':'正在准备城市配送工作台'}</h1><p>{error||'读取订单、车辆、三维货位和装卸步骤'}</p>{error&&<Button onClick={()=>setAttempt(n=>n+1)}>重新打开</Button>}</div>;
 return <ProductProvider sets={sets} page={page}><ProductShell page={page}/></ProductProvider>;
}
function ProductShell({page}:{page:Page}){
 const p=useCityProduct(),current=navigation.find(n=>n.id===page)!,Content=pages[page];
 useEffect(()=>{document.title=`${current.name} · 城市配送智能配载`;},[page]);
 return <div className="city-product" data-scenario={p.current.scenarioId} data-plan={p.current.planId} data-vehicle={p.vehicleId} data-page={page}>
  <aside className="p-sidebar"><Link to="/frontend/city-delivery/overview" className="p-brand"><span><Layers3 size={24}/></span><div><strong>城市配送</strong><small>配载与调度工作台</small></div></Link><div className="p-sidebar-label">配送运营</div><nav aria-label="城市配送导航">{navigation.map((n,i)=><Link key={n.id} to={`/frontend/city-delivery/${n.id}`} aria-current={page===n.id?'page':undefined} className={page===n.id?'is-active':''}><n.icon size={18}/><span>{n.name}</span><small>{String(i+1).padStart(2,'0')}</small></Link>)}</nav><div className="p-sidebar-bottom"><span className="p-source-label">合成演示数据</span><p>发车前规划 · 模拟执行</p><Link to="/frontend/city-delivery/legacy">查看原工作台<ChevronRight size={13}/></Link></div></aside>
  <main className="p-main"><header className="p-header"><div><span className="p-breadcrumb"><Truck size={14}/>城市配送 / {current.name}</span><h1>{current.name}<i/></h1></div><div className="p-scenario-switch"><button aria-label="九店多车" disabled={!!p.startedPlan} aria-pressed={p.mode==='fleet'} onClick={()=>p.setMode('fleet')}>九店多车 · 历史示例</button><button aria-label="四店单车" disabled={!!p.startedPlan} aria-pressed={p.mode==='single'} onClick={()=>p.setMode('single')}>四店单车 · 历史示例</button>{p.standardAvailable&&<button disabled={!!p.startedPlan} aria-pressed={p.mode==='standard'} onClick={()=>p.setMode('standard')}>当前导入</button>}<span>{p.mode==='fleet'?'36 件 · 3 辆资源':p.mode==='single'?'16 件 · 1 辆车':`${p.scenario.cargo.length} 件 · ${p.scenario.vehicles.length} 辆资源`}</span>{p.mode==='standard'&&<Button aria-label="导出已确认计划" title="导出已确认计划" disabled={!p.canExecute||!p.standardResponse} onClick={p.exportCurrentPlan}><Download size={15}/>导出</Button>}</div></header>
   {p.startedPlan&&page!=='execution'&&<div className="p-running-banner"><span>当前为模拟执行计划，修改条件前须恢复发车前规划。</span><Button onClick={p.resetExecution}>恢复规划</Button></div>}
   {p.error&&!p.editor&&<p className="p-error" role="alert">{p.error}</p>}
   <div className="p-result-version" data-result-version={p.current.planId}><span>{p.busy?'正在检查路线、时间窗与装载…':p.resultLabel}</span><strong>{p.mode==='standard'&&(p.standardNeedsPlanning||!p.standardResponse?.executable||!p.standardResponse.result)?'尚无当前条件下的有效规划结果':`${p.current.totals.vehicleCount} 辆 / ${p.current.totals.distanceKm} km / ¥${p.current.totals.totalCost}`}</strong>{p.mode==='standard'&&p.confirmed.feasibility.executable&&(p.standardNeedsPlanning||p.confirmed.planId!==p.current.planId)&&<small>旧条件已确认计划仅供查看：{p.confirmed.planId} · {p.confirmed.totals.distanceKm} km · ¥{p.confirmed.totals.totalCost}</small>}{(p.candidate||p.inspectionKind||p.busy)&&p.currentPlan.feasibility.executable&&<small>保留计划：{p.currentPlan.planId} · ¥{p.currentPlan.totals.totalCost}</small>}</div>
   {p.serviceReady===false&&<div className="p-service-offline" role="status">调整服务不可用 · 已保存场景可继续查看，实时提交已禁用。</div>}
   <Content/>
   <footer className="p-page-footer"><span>城市配送智能配载与调度工作台</span><small>合成机制案例 · 约束结论限当前规则 · 不代表企业现场运营</small></footer>
  </main><AdjustmentEditor/>
 </div>;
}
