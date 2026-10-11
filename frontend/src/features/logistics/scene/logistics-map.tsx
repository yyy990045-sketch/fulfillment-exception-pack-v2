import { useEffect, useMemo, useRef, useState } from 'react';
import { Crosshair, Globe2, Minus, Plus, RotateCcw } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { mapNodes, baseRoutes, solutionRoutes } from '../fixtures';
import { useLogistics } from '../logistics-provider';
import { ActionButton, IconButton } from '../components/shared';
import type { MapNode, MapRoute } from '../types';
import type { createScene } from './create-scene';

export function LogisticsMap({routes,className,vehicleOnly=false,animate=true,onSelect,overlay,nodes:nodeOverride,view='default'}:{routes?:MapRoute[];className?:string;vehicleOnly?:boolean;animate?:boolean;onSelect?:(kind:string,id:string)=>void;overlay?:React.ReactNode;nodes?:MapNode[];view?:string}){
 const {state}=useLogistics();const host=useRef<HTMLDivElement>(null),labels=useRef<HTMLDivElement>(null),scene=useRef<ReturnType<typeof createScene>|null>(null);
 const [ready,setReady]=useState(false),[error,setError]=useState(''),[attempt,setAttempt]=useState(0),[top,setTop]=useState(false),[detail,setDetail]=useState<{kind:string;id:string}|null>(null);
 const callback=useRef(onSelect);callback.current=onSelect;
 // 默认按订单起终点标注角色；传入自定义网络（如异常页的枢纽编号网络）时按传入的角色原样使用
 const nodes=useMemo<MapNode[]>(()=>{ if(nodeOverride) return nodeOverride; return mapNodes.map(n=>({...n,role:n.id===state.order.origin?'origin':n.id===state.order.destination?'destination':undefined})); },[nodeOverride,state.order.origin,state.order.destination]);
 const routeKey=JSON.stringify(routes??[...baseRoutes,...solutionRoutes(state.selectedSolution)]);
 const nodeKey=JSON.stringify(nodes);
useEffect(()=>{let cancelled=false;let timer=0;setReady(false);setError('');setTop(false);
import('./create-scene').then(({createScene})=>{if(cancelled||!host.current||!labels.current)return;try{scene.current=createScene(host.current,{nodes:JSON.parse(nodeKey),routes:JSON.parse(routeKey),labels:labels.current,animate:animate&&!new URLSearchParams(window.location.search).has('still'),vehicleOnly,view,onPick:(kind,id)=>{setDetail({kind,id});callback.current?.(kind,id);},onError:setError});
timer=window.setInterval(()=>{if(host.current?.querySelector('canvas')?.dataset.ready==='true'){window.clearInterval(timer);setReady(true);}},120);}catch{host.current.querySelector('canvas')?.remove();setError('当前浏览器无法显示 3D 地图，业务信息仍可查看，请更换浏览器或开启硬件加速后重试。');}}).catch(()=>setError('3D 地图加载失败，请重试。'));
return()=>{cancelled=true;if(timer)window.clearInterval(timer);scene.current?.dispose();scene.current=null;};
},[nodeKey,routeKey,vehicleOnly,animate,attempt]);
 return <div className={cn('lg-map',vehicleOnly&&'lg-truck-preview',className)} data-testid={vehicleOnly?'truck-model':'logistics-map'}><div ref={host} className="lg-map-canvas"/><div ref={labels} className="lg-map-labels">{!vehicleOnly&&ready&&!error&&nodes.map(n=><ActionButton key={n.id} data-node={n.id} variant="outline" className={`lg-map-node lg-map-node-${n.role??'normal'}`} aria-label={`查看节点 ${n.label}`} onClick={()=>{setDetail({kind:'node',id:n.id});callback.current?.('node',n.id);}}><strong>{n.label}</strong>{n.role&&<small>{n.role==='origin'?'起点':'终点'}</small>}</ActionButton>)}</div>{!ready&&!error&&<Skeleton className="lg-map-loading"/>}{error&&<div className="lg-map-error" role="alert"><Globe2/><p>{error}</p><ActionButton onClick={()=>setAttempt(v=>v+1)}>重新加载地图</ActionButton></div>}{!vehicleOnly&&!error&&<><div className="lg-map-legend"><strong>图例</strong><span><i className="blue"/>候选路线</span><span><i className="dashed"/>其他路线</span><span><i className="orange"/>起点 / 协商</span><span><b>◯</b> 物流节点</span></div><div className="lg-map-tools"><IconButton label="复位地图" onClick={()=>{scene.current?.reset();}}><Crosshair size={17}/></IconButton><IconButton label="放大地图" onClick={()=>scene.current?.zoom(.8)}><Plus size={17}/></IconButton><IconButton label="缩小地图" onClick={()=>scene.current?.zoom(1.25)}><Minus size={17}/></IconButton><IconButton label="切换地图视角" onClick={()=>setTop(scene.current?.toggleView()??false)}><Globe2 size={17}/></IconButton></div><span className="lg-map-caption">{top?'俯视':'3D'} 视图 · 拖动旋转 / 滚轮缩放 · 演示网络</span>{overlay}</>}{vehicleOnly&&<small className="lg-model-caption">在线运力车辆示意</small>}<Dialog open={Boolean(detail)} onOpenChange={open=>{if(!open)setDetail(null);}}><DialogContent className="logistics-theme lg-dialog"><DialogHeader><DialogTitle>{detail?.kind==='node'?'网络节点':detail?.kind==='route'?'候选路线':'模拟车辆'} · {detail?.id}</DialogTitle><DialogDescription>本地合成物流网络，不代表实际地理位置或实时 GPS 数据。</DialogDescription></DialogHeader><p>{detail?.kind==='node'?`${detail.id}节点关联线路、转运与交接能力将在当前订单约束下评估。`:`当前选中 ${detail?.id} 路线，请在承运商或方案面板中查看运力、报价与约束。`}</p><ActionButton onClick={()=>setDetail(null)}>关闭详情</ActionButton></DialogContent></Dialog></div>;
}
