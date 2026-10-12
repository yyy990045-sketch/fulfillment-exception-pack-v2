import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useCityProduct } from './state';
import { failureTypeLabel } from './decision-evidence';

export function PackingEvidence(){
 const p=useCityProduct(),[open,setOpen]=useState(false),trigger=useRef<HTMLButtonElement>(null),close=useRef<HTMLButtonElement>(null);
 const candidates=[...(p.standardResponse?.search?.candidateEvaluations??[])].sort((a,b)=>(a.rank??Number.MAX_SAFE_INTEGER)-(b.rank??Number.MAX_SAFE_INTEGER));
 const dismiss=()=>{setOpen(false);trigger.current?.focus();};
 useEffect(()=>{setOpen(false);},[p.current.planId,p.editor]);
 useEffect(()=>{if(!open||p.editor)return;close.current?.focus();const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!event.defaultPrevented&&!document.querySelector('[aria-modal="true"]')){setOpen(false);trigger.current?.focus();}};document.addEventListener('keydown',escape);return()=>document.removeEventListener('keydown',escape);},[open,p.editor]);
 if(p.mode!=='standard'||!candidates.length)return null;
 return <div className="p-packing-evidence"><button type="button" data-slot="button" ref={trigger} aria-expanded={open} aria-controls="packing-evidence-panel" onClick={()=>open?dismiss():setOpen(true)}>查看已检查的装载候选（{candidates.length} 个）</button>{open&&<section id="packing-evidence-panel" className="p-packing-evidence-panel" role="dialog" aria-modal="false" aria-labelledby="packing-evidence-title"><header><h2 id="packing-evidence-title">装载候选 · {candidates.length} 个</h2><button type="button" data-slot="button" ref={close} aria-label="关闭装载候选" onClick={dismiss}><X size={16}/></button></header><p>按后端返回的候选名次排列；失败原因来自对应检查记录。有限搜索不代表全局最优。可继续操作车厢与播放。</p><div className="p-packing-evidence-list" tabIndex={0} aria-label="候选检查记录">{candidates.map((candidate,i)=><article key={i}><strong>{candidate.rank??i+1}. {candidate.vehicleId} · {p.scenario.stops.find(s=>s.stopId===candidate.stopId)?.name??candidate.stopId}</strong><span>{candidate.feasible?'可行':'未通过'} · {candidate.method}</span><small>{candidate.spaceUtilizationPercent==null?'空间占用待定':`${candidate.spaceUtilizationPercent}% 空间占用`} · {candidate.checkedMs} ms</small>{!candidate.feasible&&<p data-candidate-failures>{candidate.failureTypes?.length?candidate.failureTypes.map(failureTypeLabel).join('、'):'后端未提供独立失败类型，不推测原因。'}</p>}</article>)}</div></section>}</div>;
}
