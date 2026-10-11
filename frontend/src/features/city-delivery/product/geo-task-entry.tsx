import { useState } from 'react';
import { MapPinned } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCityProduct } from './state';
import { GEO_BASE } from './geo-model';
export function GeoTaskEntry(){
 const p=useCityProduct(),[loading,setLoading]=useState(false),[error,setError]=useState('');
 async function load(){
  setLoading(true);setError('');
  try{const response=await fetch(`${GEO_BASE}berlin/task.json`);if(!response.ok)throw new Error('离线地理任务读取失败。');const task=await response.json();const checked=await p.importStandardScenario(task);if(checked)await p.planImportedStandard('joint-feedback',task);}
  catch(e){setError(e instanceof Error?e.message:'地理任务未完成规划，请重试。');}finally{setLoading(false);}
 }
 return <div className="p-geo-task-entry"><Button disabled={loading||p.busy||!!p.startedPlan||!p.serviceReady} onClick={()=>void load()}><MapPinned size={15}/>{loading?'正在规划地理任务…':'加载地理任务并规划'}</Button><a href={`${GEO_BASE}berlin/task.json`} download="berlin-mitte-task.json">任务 JSON</a>{error&&<span role="alert">{error}</span>}</div>;
}
