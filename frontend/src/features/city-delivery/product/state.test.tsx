import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { ReactNode } from 'react';
import path from 'node:path';
import * as decisions from '../decisions';
import { loadProduct, ProductProvider, useCityProduct, type DataSets } from './state';

const root=process.cwd();
const read=(name:string)=>JSON.parse(readFileSync(path.join(root,name),'utf8'));
const request=read('tools/city-delivery-decision/examples-2f/legal-request.json');
const response={...read('tools/city-delivery-decision/examples-2f/planning-success.json').response,scenarioFingerprint:'input-six-store',resultSource:{kind:'computed-per-request',inputFingerprint:'input-six-store'}} as decisions.StandardDecision;
let sets:DataSets;
beforeEach(async()=>{
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>new Response(JSON.stringify(url.includes('/health')?{ready:true}:read(`frontend/public${url}`)),{status:200})));
 vi.spyOn(decisions,'validateStandardScene').mockResolvedValue({constraintVersion:response.constraintVersion,valid:true,solverStatus:'VALID'} as decisions.StandardValidation);
 sets=await loadProduct(new AbortController().signal);
});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});
function mount(){return renderHook(()=>useCityProduct(),{wrapper:({children}:{children:ReactNode})=><ProductProvider sets={sets} page="packing">{children}</ProductProvider>});}
async function planned(){
 vi.spyOn(decisions,'planStandardScene').mockResolvedValue(structuredClone(response));
 const hook=mount();await act(async()=>{await hook.result.current.importStandardScenario(request.scenario);});
 await act(async()=>{await hook.result.current.planImportedStandard('joint-feedback');});return hook;
}

test('confirmation is shared, changed input revokes both execution and export, original input stays with the plan',async()=>{
 const {result}=await planned();expect(result.current.canExecute).toBe(false);
 act(()=>result.current.startExecution());expect(result.current.startedPlan).toBeNull();
 act(()=>result.current.confirmCandidate());expect(result.current.standardPlanConfirmed).toBe(true);expect(result.current.standardResponse?.confirmed).toBe(true);
 act(()=>result.current.setStandardDeparture('08:30'));
 expect(result.current.scenario.departureTime).toBe('08:00');expect(result.current.standardDraftScenario.departureTime).toBe('08:30');
 expect(result.current.canExecute).toBe(false);expect(result.current.exportCurrentPlan()).toBe(false);
 act(()=>result.current.keepOriginal());expect(result.current.standardDraftScenario.departureTime).toBe('08:00');expect(result.current.canExecute).toBe(true);
});

test('service rejection cannot inherit an old confirmation',async()=>{
 const {result}=await planned();act(()=>result.current.confirmCandidate());
 vi.mocked(decisions.planStandardScene).mockRejectedValueOnce(new Error('service unavailable'));
 await act(async()=>{await expect(result.current.planImportedStandard('joint-feedback')).rejects.toThrow('service unavailable');});
 expect(result.current.standardNeedsPlanning).toBe(true);expect(result.current.canExecute).toBe(false);expect(result.current.exportCurrentPlan()).toBe(false);
 expect(result.current.confirmed.planId).toBe(response.planId);
});

test('an HTTP 200 duration failure cannot be confirmed, executed or exported',async()=>{
 const {result}=await planned();act(()=>result.current.confirmCandidate());
 const rejected=read('docs/competition/phase7b-evidence/after-joint-feedback.json') as decisions.StandardDecision;
 vi.mocked(decisions.planStandardScene).mockResolvedValueOnce(structuredClone(rejected));
 await act(async()=>{await result.current.importStandardScenario(rejected.scenario);});
 await act(async()=>{await result.current.planImportedStandard('joint-feedback');});
 expect(result.current.current.feasibility.executable).toBe(false);
 expect(result.current.current.feasibility.reasons.some(reason=>reason.type==='max_route_duration')).toBe(true);
 expect(result.current.candidate).toBeNull();expect(result.current.canExecute).toBe(false);
 act(()=>result.current.confirmCandidate());act(()=>result.current.startExecution());
 expect(result.current.startedPlan).toBeNull();expect(result.current.standardPlanConfirmed).toBe(false);
 expect(result.current.exportCurrentPlan()).toBe(false);
});

test('late results cannot replace a newer imported task',async()=>{
 const {result}=await planned();let resolve!:(value:decisions.StandardDecision)=>void;
 vi.mocked(decisions.planStandardScene).mockReturnValueOnce(new Promise(r=>{resolve=r;}));
 let pending!:Promise<decisions.StandardDecision|undefined>;
 act(()=>{pending=result.current.planImportedStandard('joint-feedback');});
 const next={...request.scenario,scenarioId:'new-six-store-task'};
 await act(async()=>{await result.current.importStandardScenario(next);});
 await act(async()=>{resolve(structuredClone(response));await pending;});
 expect(result.current.scenario.scenarioId).toBe('new-six-store-task');expect(result.current.current.planId).toBe('STANDARD_DRAFT');
 expect(result.current.standardResponse).toBeNull();expect(result.current.canExecute).toBe(false);
 await waitFor(()=>expect(result.current.busy).toBe(false));
});
