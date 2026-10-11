import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapPinned } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCityProduct } from './state';
import { GEO_BASE } from './geo-model';
export function GeoTaskEntry({quick=false}:{quick?:boolean}){
 const p=useCityProduct(),navigate=useNavigate(),[loading,setLoading]=useState(false),[error,setError]=useState('');
 async function load(){
  setLoading(true);setError('');
  try{const response=await fetch(`${GEO_BASE}berlin/task.json`);if(!response.ok)throw new Error('离线地理任务读取失败。');const task=await response.json();const checked=await p.importStandardScenario(task);if(checked){const result=await p.planImportedStandard('joint-feedback',task);if(result)navigate('/frontend/city-delivery/dispatch');}}
  catch(e){setError(e instanceof Error?e.message:'地理任务未完成规划，请重试。');}finally{setLoading(false);}
 }
 return <div className="p-geo-task-entry" aria-busy={loading}><Button className={quick?'p-primary':undefined} disabled={loading||p.busy||!!p.startedPlan||!p.serviceReady} onClick={()=>void load()}><MapPinned size={15}/>{loading?'正在加载并计算…':quick?'加载示例任务并计算':'加载地理任务并规划'}</Button>{!quick&&<a href={`${GEO_BASE}berlin/task.json`} download="berlin-mitte-task.json">任务 JSON</a>}{error&&<span role="alert">{error}</span>}</div>;
}
