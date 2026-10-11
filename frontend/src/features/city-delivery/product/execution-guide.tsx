import { Button } from '@/components/ui/button';
import { useCityProduct } from './state';

export function ExecutionGuide(){
 const p=useCityProduct(),steps=p.steps,index=p.playback.index,current=steps[index],next=steps[index+1],done=steps.length>0&&index>=steps.length;
 const completed=steps.slice(0,index).filter(s=>s.operation==='station_complete').length;
 const remaining=index?steps[index-1]?.remainingCargoIdsAfter?.length:p.route.unloading?.initialRemainingCargoIds.length;
 const stop=p.scenario.stops.find(s=>s.stopId===current?.stopId);
 return <section className="p-execution-guide" data-execution-step={current?.stepId??''}><header><strong>{p.vehicleId} · {done?'本车作业完成':stop?.name??'作业预览'}</strong><span>{completed}/{p.route.stopOrder.length} 站完成 · 剩余 {remaining??'—'} 件</span>{p.mode==='standard'&&<Button onClick={()=>{const el=document.getElementById('current-operation-plan');el?.scrollIntoView({block:'start'});el?.focus({preventScroll:true});}}>查看作业单</Button>}</header><div><p><span>当前动作 · {steps.length?Math.min(index+1,steps.length):0}/{steps.length}</span><strong data-current-action>{done?'所有已校验步骤完成':current?.instruction??'尚无可播放的作业步骤'}</strong></p><p><span>下一步</span><strong data-next-action>{done?'无后续作业':next?.instruction??'无后续作业'}</strong></p></div></section>;
}
