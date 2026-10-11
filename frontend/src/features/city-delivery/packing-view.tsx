import { useEffect, useRef, useState } from 'react';
import { Box, Focus, Maximize2, RotateCcw, Scan, ZoomIn, ZoomOut } from 'lucide-react';
import { createScene } from '../logistics/scene/create-scene';
import type { PackingInput, PackingState } from './packing-objects';
import { Button } from '@/components/ui/button';

export function PackingView({input,state,onSelect,autoFocus=false}:{input:PackingInput;state:PackingState;onSelect:(id:string)=>void;autoFocus?:boolean}) {
 const host=useRef<HTMLDivElement>(null),labels=useRef<HTMLDivElement>(null),scene=useRef<ReturnType<typeof createScene>|null>(null);
 const select=useRef(onSelect);select.current=onSelect;
 const current=useRef(state);current.current=state;
 const [error,setError]=useState(''),[view,setView]=useState('free'),[attempt,setAttempt]=useState(0),[ready,setReady]=useState(false);
 useEffect(()=>{
  if(!host.current||!labels.current)return;setError('');setReady(false);setView('free');
  try {
   scene.current=createScene(host.current,{nodes:[],routes:[],labels:labels.current,vehicleOnly:true,animate:false,packing:input,
    onPick:(kind,id)=>{if(kind==='cargo'&&!current.current.exterior)select.current(id);},onError:setError});
   scene.current.updatePacking(current.current);
  } catch {setError('车厢画面暂时无法打开，请开启浏览器硬件加速后重试。');}
  const timer=window.setInterval(()=>{if(host.current?.querySelector('canvas')?.dataset.ready==='true'){setReady(true);window.clearInterval(timer);}},150);
  return()=>{window.clearInterval(timer);scene.current?.dispose();scene.current=null;};
 },[input,attempt]);
 useEffect(()=>{scene.current?.updatePacking(state);},[state]);
 const conflictKey=state.blocking.length?[...state.highlighted,...state.blocking].join(','):'';
 useEffect(()=>{if(autoFocus&&conflictKey&&!state.exterior){scene.current?.focus('rear');setView('rear');}},[autoFocus,conflictKey,input]);
 const changeView=(value:string)=>{setView(value);scene.current?.focus(value);};
 return <div className="cd-scene" data-testid="packing-scene" data-visible-cargo={state.remaining.length}>
  <div ref={host} className="cd-scene-host"/><div ref={labels}/>
  <div className="cd-scene-heading"><span><Scan size={14}/>车厢空间</span><strong>后门直线卸货</strong></div>
  <div className="cd-view-tools">{[['free','自由视角'],['top','俯视'],['side','侧视'],['rear','后门']].map(([key,label])=><Button key={key} className={view===key?'is-active':''} onClick={()=>changeView(key)}>{label}</Button>)}
   <Button aria-label="放大车厢" onClick={()=>scene.current?.zoom(.8)}><ZoomIn size={16}/></Button><Button aria-label="缩小车厢" onClick={()=>scene.current?.zoom(1.2)}><ZoomOut size={16}/></Button>
   <Button aria-label="复位视角" onClick={()=>changeView('free')}><RotateCcw size={16}/></Button>
  </div>
  {!ready&&!error&&<div className="cd-scene-loading"><Box size={28}/><span>正在打开车厢</span></div>}
  {error&&<div className="cd-scene-loading" role="alert"><p>{error}</p><Button onClick={()=>setAttempt(n=>n+1)}>重新打开</Button></div>}
  <div className="cd-scene-footer"><span><Maximize2 size={13}/>{state.exterior?'拖动旋转 · 切换剖视后点选货箱':'拖动旋转 · 滚轮缩放 · 点击货箱'}</span><Button disabled={state.exterior||!state.selected||!state.remaining.includes(state.selected)} onClick={()=>state.selected&&scene.current?.focusCargo(state.selected)}><Focus size={14}/>聚焦货物</Button></div>
 </div>;
}
