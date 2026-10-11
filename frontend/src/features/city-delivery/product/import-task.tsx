import { useRef, useState } from 'react';
import { FileJson, Upload, X, TriangleAlert, Box, Truck, Clock3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCityProduct } from './state';

interface Preview {scenarioId?:string;stops:Record<string,unknown>[];cargo:Record<string,unknown>[];vehicles:Record<string,unknown>[];missing:string[];unsupported:string[]}
function records(value:unknown):Record<string,unknown>[] {return Array.isArray(value)?value.filter(v=>v!==null&&typeof v==='object'&&!Array.isArray(v)):[];}
function previewTask(value:unknown):Preview{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('请选择包含配送任务的 JSON 文件。');
 const input=value as Record<string,unknown>,stops=records(input.stops),cargo=records(input.cargo),vehicles=records(input.vehicles),missing:string[]=[];
 if(!input.scenarioId)missing.push('缺少场景编号');
 if(!stops.length)missing.push('缺少配送门店');if(!cargo.length)missing.push('缺少包装件');if(!vehicles.length)missing.push('缺少车辆');
 stops.forEach((s,i)=>{if(!s.stopId)missing.push(`门店 ${i+1} 缺少编号`);const window=s.timeWindow as Record<string,unknown>|undefined;if(!window?.start||!window?.end)missing.push(`门店 ${s.stopId??i+1} 缺少时间窗`);});
 cargo.forEach((c,i)=>{for(const field of ['cargoId','stopId','length','width','height','weightKg'])if(c[field]===undefined||c[field]===null)missing.push(`包装件 ${c.cargoId??i+1} 缺少 ${({cargoId:'编号',stopId:'目的门店',length:'长度',width:'宽度',height:'高度',weightKg:'重量'} as Record<string,string>)[field]}`);});
 vehicles.forEach((v,i)=>{const size=v.compartment as Record<string,unknown>|undefined;if(!v.vehicleId)missing.push(`车辆 ${i+1} 缺少编号`);if(!size?.length||!size?.width||!size?.height)missing.push(`车辆 ${v.vehicleId??i+1} 缺少车厢净尺寸`);if(v.maxPayloadKg===undefined)missing.push(`车辆 ${v.vehicleId??i+1} 缺少载重上限`);});
 const unsupported=Object.keys(input).filter(k=>/cold|gps|axle|telemetry/i.test(k));
 return {scenarioId:typeof input.scenarioId==='string'?input.scenarioId:undefined,stops,cargo,vehicles,missing,unsupported};
}
export function ImportTask(){
 const p=useCityProduct(),[open,setOpen]=useState(false),[preview,setPreview]=useState<Preview|null>(null),[raw,setRaw]=useState<Record<string,unknown>|null>(null),[error,setError]=useState(''),[filename,setFilename]=useState(''),[strategy,setStrategy]=useState<'route-first'|'layout-repair'|'joint-feedback'>('joint-feedback'),[checking,setChecking]=useState(false),[checked,setChecked]=useState(false),file=useRef<HTMLInputElement>(null);
 async function readFile(value:File){setError('');setPreview(null);setRaw(null);setChecked(false);setFilename(value.name);try{if(value.size>2_000_000)throw new Error('任务文件超过当前导入预览范围，请使用小规模配送批次。');const input=JSON.parse(await value.text());setRaw(input);setPreview(previewTask(input));}catch(e){setError(e instanceof Error?e.message:'文件无法读取。');}}
 async function validate(){if(!raw)return;setChecking(true);setError('');try{await p.importStandardScenario(raw);setChecked(true);}catch(e){setError(e instanceof Error?e.message:'新场景未通过检查。');}finally{setChecking(false);}}
 async function plan(){if(!raw||!checked)return;setChecking(true);setError('');try{await p.planImportedStandard(strategy);setOpen(false);}catch(e){setError(e instanceof Error?e.message:'新场景规划失败，原计划已保留。');}finally{setChecking(false);}}
 return <><Button disabled={p.busy||!!p.startedPlan} onClick={()=>setOpen(true)}><Upload size={15}/>导入配送任务</Button>{open&&<div className="p-editor-overlay"><section className="p-editor p-import-task" role="dialog" aria-modal="true" aria-label="导入配送任务"><header><div><span>配送任务导入</span><h2>先核对订单、车辆与包装件</h2></div><Button aria-label="关闭任务导入" onClick={()=>setOpen(false)}><X size={18}/></Button></header>
  <input ref={file} type="file" accept="application/json,.json" aria-label="配送任务文件" onChange={e=>{const value=e.target.files?.[0];if(value)readFile(value);}}/>
  <button className="p-import-drop" onClick={()=>file.current?.click()}><FileJson size={33}/><strong>{filename||'选择配送任务文件'}</strong><span>本地 JSON · 原任务和计划保持不变</span></button>
  {error&&<p className="p-error" role="alert">{error}</p>}
   {preview&&<><div className="p-import-summary"><span><Box size={18}/>{preview.cargo.length} 件包装件</span><span><Truck size={18}/>{preview.vehicles.length} 辆车</span><span><Clock3 size={18}/>{preview.stops.length} 家门店</span></div><h3>{preview.scenarioId??'待补场景编号'}</h3><div className="p-import-inventory">{preview.vehicles.map((v,i)=><p key={i}><strong>{String(v.name??v.vehicleId??`车辆 ${i+1}`)}</strong><span>{v.compartment?Object.values(v.compartment as object).slice(0,3).join(' × ')+' m':'净尺寸待补'}</span></p>)}{preview.stops.map((s,i)=>{const w=s.timeWindow as {start?:string;end?:string}|undefined;return <p key={`s${i}`}><strong>{String(s.name??s.stopId??`门店 ${i+1}`)}</strong><span>{w?.start??'待补'}–{w?.end??'待补'}</span></p>;})}</div>
   {preview.missing.length>0&&<section className="p-import-missing"><strong><TriangleAlert size={16}/>需要补齐的数据</strong>{preview.missing.map((text,i)=><p key={i}>{text}</p>)}</section>}
   {preview.unsupported.length>0&&<p className="p-muted">文件含尚未接入的规则：{preview.unsupported.join('、')}。不会按已生效条件显示。</p>}
   <label className="p-import-strategy">规划策略<select value={strategy} disabled={checking||preview.missing.length>0} onChange={e=>setStrategy(e.target.value as typeof strategy)}><option value="route-first">A · 路线优先</option><option value="layout-repair">B · 固定路线修货位</option><option value="joint-feedback">C · 路线与装载联合反馈</option></select></label>
  </>}
  <footer><span className="p-import-pending">{checked?'已通过标准场景检查，可提交真实规划。':'文件预览不会替代后端检查；通过后才允许生成计划。'}</span><div className="p-import-actions"><Button disabled={!raw||!!preview?.missing.length||checking} onClick={validate}>{checking?'正在检查…':checked?'重新检查':'提交后端检查'}</Button><Button className="p-primary" disabled={!checked||checking} onClick={plan}>开始真实规划</Button></div></footer>
 </section></div>}</>;
}
