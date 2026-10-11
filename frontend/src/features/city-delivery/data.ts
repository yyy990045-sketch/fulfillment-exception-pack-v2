import type scenarioSource from '../../../public/demo/city-delivery/v1/scenario.json';
import type plansSource from '../../../public/demo/city-delivery/v1/plans.json';
import type placementsSource from '../../../public/demo/city-delivery/v1/placements.json';
import type stepsSource from '../../../public/demo/city-delivery/v1/unloading-steps.json';
import type comparisonSource from '../../../public/demo/city-delivery/v1/comparison.json';
import type manifestSource from '../../../public/demo/city-delivery/v1/manifest.json';

export type Scenario = typeof scenarioSource;
type StoredPlan = (typeof plansSource)['plans'][number];
export type Failure = NonNullable<StoredPlan['unloadingCheck']['firstFailure']>;
export type Plan = Omit<StoredPlan,'loadingCheck'|'unloadingCheck'|'feasibility'> & {
 loadingCheck:Omit<StoredPlan['loadingCheck'],'cargoChecks'> & {cargoChecks:Record<string,unknown>};
 unloadingCheck:{checked:boolean;valid:boolean;firstFailure:Failure|null;rule:string};
 feasibility:{executable:boolean;status?:string;scope:string;uncheckedConstraints:string[];reasons:string[]};
};
export type Placement = (typeof placementsSource)['plans'][number]['positions'][number];
type StoredOperations = (typeof stepsSource)['plans'][number];
export type Operations = Omit<StoredOperations,'steps'|'stations'|'finalRemainingCargoIds'|'firstFailure'|'stopAtStepId'> & {
 steps:Step[]; stations:{stopId:string;targetCargoIds:string[];stepIds:string[];conflicts:Failure['conflicts'];status:string;remainingCargoIdsAfter:string[]}[];
 finalRemainingCargoIds:string[];firstFailure:Failure|null;stopAtStepId:string|null;
};
export type Move = { from: {x:number;y:number;z:number}; to: {x:number;y:number;z:number} };
// Optional fields vary by the delivered operation: arrive/highlight/unload/blocked/complete.
export interface Step {
 stepId:string; sequence:number; stopId:string; operation:string; cargoId?:string;
 remainingCargoIdsBefore:string[]; remainingCargoIdsAfter:string[];
 highlightCargoIds:string[]; blockingCargoIds:string[]; durationSeconds:number; instruction:string;
 movement?:Move;
}
export interface DeliveryData {
 manifest:typeof manifestSource; scenario:Scenario; plans:Omit<typeof plansSource,'plans'> & {plans:Plan[]};
 placements:typeof placementsSource; unloadingSteps:Omit<typeof stepsSource,'plans'> & {plans:Operations[]}; comparison:typeof comparisonSource;
}
export async function loadDelivery(signal:AbortSignal):Promise<DeliveryData> {
 const base=`${import.meta.env.BASE_URL}demo/city-delivery/v1/`;
 async function read(name:string) {
  const response=await fetch(base+name,{signal,cache:'no-store'});
  if(!response.ok) throw new Error('演示场景暂时无法读取，请重新加载。');
  return response.json();
 }
 const manifest=await read('manifest.json');
 const keys=['scenario','plans','placements','unloadingSteps','comparison'] as const;
 const values=await Promise.all(keys.map(key=>read(manifest.files[key])));
 const result={manifest,...Object.fromEntries(keys.map((key,i)=>[key,values[i]]))} as DeliveryData;
 if(values.some(value=>value.scenarioId!==manifest.scenarioId || value.schemaVersion!==manifest.schemaVersion)) throw new Error('场景数据不一致，已停止播放。');
 const cargoIds=new Set(result.scenario.cargo.map(c=>c.cargoId));
 for(const plan of result.plans.plans) {
  const placement=result.placements.plans.find(p=>p.planId===plan.planId);
  const operations=result.unloadingSteps.plans.find(p=>p.planId===plan.planId);
  if(!placement || !operations || placement.positions.length!==cargoIds.size || placement.positions.some(p=>!cargoIds.has(p.cargoId))) throw new Error('方案缺少关联货物，已停止播放。');
 }
 return result;
}
