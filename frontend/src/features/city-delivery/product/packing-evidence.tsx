import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useCityProduct } from './state';

export function PackingEvidence(){
 const p=useCityProduct(),[open,setOpen]=useState(false),trigger=useRef<HTMLButtonElement>(null),close=useRef<HTMLButtonElement>(null);
 const candidates=p.standardResponse?.search?.candidateEvaluations??[];
 const dismiss=()=>{setOpen(false);trigger.current?.focus();};
 useEffect(()=>{setOpen(false);},[p.current.planId,p.editor]);
 useEffect(()=>{if(!open||p.editor)return;close.current?.focus();const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!event.defaultPrevented&&!document.querySelector('[aria-modal="true"]')){setOpen(false);trigger.current?.focus();}};document.addEventListener('keydown',escape);return()=>document.removeEventListener('keydown',escape);},[open,p.editor]);
 if(p.mode!=='standard'||!candidates.length)return null;
 return <div className="p-packing-evidence"><button type="button" data-slot="button" ref={trigger} aria-expanded={open} aria-controls="packing-evidence-panel" onClick={()=>open?dismiss():setOpen(true)}>查看已检查的装载候选（{candidates.length} 个）</button>{open&&<section id="packing-evidence-panel" className="p-packing-evidence-panel" role="dialog" aria-modal="false" aria-labelledby="packing-evidence-title"><header><h2 id="packing-evidence-title">装载候选 · {candidates.length} 个</h2><button type="button" data-slot="button" ref={close} aria-label="关闭装载候选" onClick={dismiss}><X size={16}/></button></header><p>硬约束优先，再按空间占用和分区长度排序；有限搜索不代表全局最优。可继续操作车厢与播放。</p><div className="p-packing-evidence-list" tabIndex={0} aria-label="候选检查记录">{candidates.map((candidate,i)=><article key={i}><strong>{candidate.vehicleId} · {p.scenario.stops.find(s=>s.stopId===candidate.stopId)?.name??candidate.stopId}</strong><span>{candidate.feasible?'可行':'未通过'} · {candidate.method}</span><small>{candidate.spaceUtilizationPercent==null?'空间占用待定':`${candidate.spaceUtilizationPercent}% 空间占用`} · {candidate.checkedMs} ms</small></article>)}</div></section>}</div>;
}
