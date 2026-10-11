import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { Activity, AlertTriangle, ArrowLeftRight, Bell, ChartNoAxesCombined, Check, ClipboardList, FileCheck2, FlaskConical, Home, Menu, Network, Package, Pause, Play, RotateCcw, Search, Truck, UserRound, X } from 'lucide-react';
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, useSidebar } from '@/components/ui/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { LogisticsProvider, useLogistics } from '../logistics-provider';
import { initialOrder, sampleText } from '../fixtures';
import { ActionButton, IconButton, Status } from './shared';
import '@/styles/logistics.css';

export const steps = [
 {path:'order',number:'02',label:'订单创建',short:'订单',title:'订单创建（需求输入）',description:'自然语言输入 + 结构化抽取结果 · 将业务语言转为可执行的物流约束',icon:ClipboardList},
 {path:'analysis',number:'03',label:'可行性分析',short:'分析',title:'可行性分析（单体承运商）',description:'判断是否存在单承运商可行解，评估成本、时效与风险',icon:ChartNoAxesCombined},
 {path:'carriers',number:'04',label:'承运商画像',short:'运力',title:'承运商画像',description:'了解各承运商的公开能力与私有约束，选择合适的运力组合',icon:Truck},
 {path:'negotiation',number:'05',label:'联营协商',short:'协商',title:'联营协商过程',description:'多家承运商协同，组合各自能力，生成可执行的运输方案',icon:Network},
 {path:'solutions',number:'06',label:'方案对比',short:'方案',title:'方案对比与选择',description:'基于多家承运商的协商结果，生成多种可执行的运输方案，对比成本、时效和 SLA',icon:Package},
 {path:'plan',number:'07',label:'计划详情',short:'计划',title:'计划详情（下单）',description:'确认最终方案，生成运输计划、下达订单并联动各方执行。',icon:FileCheck2},
 {path:'execution',number:'08',label:'执行监控',short:'执行',title:'执行监控（实时状态）',description:'运输轨迹、里程节点、异常检测 · 本地模拟数据',icon:Activity},
 {path:'exceptions',number:'09',label:'异常事件',short:'异常',title:'异常事件',description:'运输计划中断事件与影响范围 · 判断是否需要重新规划',icon:AlertTriangle},
 {path:'replan',number:'10',label:'重新规划',short:'重编',title:'重新规划',description:'原计划 → 中断事件 → 新计划 · 对比成本、时效与 SLA 变化',icon:ArrowLeftRight},
 {path:'results',number:'11',label:'实验结果',short:'实验',title:'实验结果',description:'AI 在采购与计划链路中的实际增量与研究判定',icon:FlaskConical},
];
function Logo(){return <svg viewBox="0 0 48 48" className="lg-logo" aria-hidden="true"><g fill="#008cff"><circle cx="13" cy="12" r="8"/><circle cx="35" cy="12" r="8"/><circle cx="13" cy="36" r="8"/><circle cx="35" cy="36" r="8"/><path d="M13 16L24 9 36 24 24 40 12 26Z"/></g><path d="M24 16L32 24 24 32 16 24Z" fill="#04c4ff" stroke="#021629" strokeWidth="2"/></svg>;}
function Navigation({wide}:{wide:boolean}){
 const {setOpenMobile}=useSidebar();
 return <Sidebar className="lg-sidebar" collapsible="offcanvas"><SidebarHeader className="lg-sidebar-brand"><Logo/><div><strong>Trans.AI</strong><small>智能运输计划平台</small></div></SidebarHeader><SidebarContent><SidebarMenu className="lg-nav-list"><SidebarMenuItem><SidebarMenuButton asChild><NavLink to="/frontend/twin" onClick={()=>setOpenMobile(false)}><Network/><span>01 {wide?'数字孪生':'孪生'}</span></NavLink></SidebarMenuButton></SidebarMenuItem>{steps.map(s=><SidebarMenuItem key={s.path}><SidebarMenuButton asChild><NavLink to={`/frontend/${s.path}`} onClick={()=>setOpenMobile(false)}><s.icon/><span>{s.number} {wide?s.label:s.short}</span></NavLink></SidebarMenuButton></SidebarMenuItem>)}</SidebarMenu></SidebarContent><SidebarFooter className="lg-sidebar-footer"><Link to="/manufacturing/ctx-so-mfg-001" title="返回原履约工作台">原履约工作台 ↗</Link><span title="当前为本地合成演示环境">本地合成演示 · 非生产服务</span></SidebarFooter></Sidebar>;
}
function ShellBody(){
 const location=useLocation(),navigate=useNavigate();const {toggleSidebar}=useSidebar();
 const {state,dispatch,notice,notify}=useLogistics();
 const stepIndex=steps.findIndex(s=>location.pathname.endsWith('/'+s.path));const index=Math.max(0,stepIndex);const current=stepIndex>=0 ? steps[stepIndex]! : {path:'twin',number:'01',label:'数字孪生',short:'孪生',title:'仓库运行总览',description:'3D 实时履约监控驾驶舱',icon:Activity};
 const [demo,setDemo]=useState(false),[reset,setReset]=useState(false),[search,setSearch]=useState('');const elapsed=useRef(0);
 useEffect(()=>{document.title=`${current.label} · Trans.AI 物流演示`;},[current.label]);
 useEffect(()=>{if(!demo)return;elapsed.current=0;dispatch({type:'order',order:initialOrder,rawText:sampleText});dispatch({type:'confirm'});navigate('/frontend/twin');const id=window.setInterval(()=>{elapsed.current+=1;const t=elapsed.current;
  // 30 秒业务动线：0-3s 01 · 3-7s 02 · 7-10s 03 · 10-13s 05 · 13-16s 06 · 16-19s 08 · 19-23s 09 · 23-30s 10
  // 按 Owner 口径不进入 11 实验结果（研究复核页）。
  if(t===10)dispatch({type:'negotiate'});
  if(t===13)dispatch({type:'solution',id:'A'});
  if(t===16){dispatch({type:'negotiate'});dispatch({type:'submit'});}
  if(t===3)navigate('/frontend/order');
  else if(t===7)navigate('/frontend/analysis');
  else if(t===10)navigate('/frontend/negotiation');
  else if(t===13)navigate('/frontend/solutions');
  else if(t===16)navigate('/frontend/execution');
  else if(t===19)navigate('/frontend/exceptions');
  else if(t===23)navigate('/frontend/replan');
  else if(t>=30){setDemo(false);return;}
},1000);return()=>clearInterval(id);},[demo,dispatch,navigate]);
 return <><Navigation wide={current.path==='plan'}/><div className="lg-main-column"><header className="lg-topbar"><div className="lg-brand"><IconButton label="打开导航" className="lg-mobile-menu" onClick={toggleSidebar}><Menu size={20}/></IconButton><div><strong>{current.path==='plan'?'Trans.AI 运输计划':'物流非结构化采购接入层'}</strong><small>LOGISTICS PROCUREMENT INTAKE</small></div><span className="lg-demo-label">SYNTHETIC DEMO</span></div><div className="lg-top-actions">{index>=5?<form className="lg-global-search" onSubmit={e=>{e.preventDefault();notify(search.trim()?`本地演示订单 ${state.order.id} · ${state.order.origin} → ${state.order.destination}`:'请输入订单或路线关键词');}}><Search size={16}/><Input aria-label="搜索演示订单" placeholder="搜索订单、承运商、路线…" value={search} onChange={e=>setSearch(e.target.value)}/></form>:<span className="lg-session-id">{state.order.id}</span>}<ActionButton variant="outline" onClick={()=>setDemo(v=>!v)}>{demo?<Pause size={15}/>:<Play size={15} fill="currentColor"/>}{demo?'停止演示':'30 秒演示'}</ActionButton><ActionButton variant="outline" onClick={()=>setReset(true)}><RotateCcw size={15}/>重置</ActionButton>{index>=5&&<DropdownMenu><DropdownMenuTrigger asChild><ActionButton variant="ghost" size="icon" aria-label="演示账户"><UserRound size={20}/></ActionButton></DropdownMenuTrigger><DropdownMenuContent className="logistics-theme"><DropdownMenuItem onSelect={()=>notify('当前为本地演示账户，没有真实承运商权限。')}>本地演示账户</DropdownMenuItem></DropdownMenuContent></DropdownMenu>}</div></header><main id="logistics-content" className={`lg-workspace lg-page-${current.path}`}>{stepIndex>=0&&<header className="lg-page-heading"><div className="lg-page-heading-main"><span className="lg-page-number">{current.number}</span><div><h1>{current.title}</h1><p>{current.description}</p></div></div>{index<5&&<nav aria-label="物流流程" className="lg-step-nav"><ol>{steps.map((s,i)=><li key={s.path} className={i===index?'is-current':i<index?'is-done':''}><Link to={`/frontend/${s.path}`} aria-current={i===index?'step':undefined}><span>{i<index?<Check size={13}/>:i+1}</span><small>{s.label}</small></Link></li>)}</ol></nav>}</header>}<AnimatePresence mode="wait"><motion.div key={current.path} initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} transition={{duration:.12}} className="lg-page-content"><Outlet/></motion.div></AnimatePresence></main><footer className="lg-demo-footnote">SYNTHETIC DEMO · 订单、报价、位置与路况均为本地合成数据，不向外部系统发送交易</footer></div><Dialog open={reset} onOpenChange={setReset}><DialogContent className="logistics-theme lg-dialog"><DialogHeader><DialogTitle>重置本地物流演示？</DialogTitle><DialogDescription>只清除本演示的订单和流程状态；原业务系统的数据、账户与权限不会改变。</DialogDescription></DialogHeader><div className="lg-actions"><ActionButton variant="outline" onClick={()=>setReset(false)}>取消</ActionButton><ActionButton onClick={()=>{setDemo(false);dispatch({type:'reset'});setReset(false);navigate('/frontend/order');notify('本地演示已重置');}}>确认重置</ActionButton></div></DialogContent></Dialog>{notice&&<div className="lg-toast" role="status"><Bell size={16}/><span>{notice}</span><ActionButton size="icon" variant="ghost" aria-label="关闭提示" onClick={()=>notify('')}><X size={14}/></ActionButton></div>}</>;
}
export default function LogisticsShell(){const location=useLocation();return <LogisticsProvider><MotionConfig reducedMotion="user"><TooltipProvider><div className="logistics-theme lg-app"><a className="lg-skip-link" href="#logistics-content">跳转到主要内容</a><SidebarProvider className="lg-sidebar-provider" style={{'--sidebar-width':'190px'} as CSSProperties}><ShellBody/></SidebarProvider></div></TooltipProvider></MotionConfig></LogisticsProvider>;}
