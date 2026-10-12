import {expect,test} from 'vitest';
import {readFileSync} from 'node:fs';
import type {DecisionRoute,StandardDecision} from '../decisions';
import {checkVerdict,decisionTrace,placementChangeText,placementDiffText,routeConstraintRows,traceChanges} from './decision-evidence';
test('unknown child constraints never inherit an aggregate pass',()=>{
 expect(checkVerdict({valid:true})).toBe('未检查 / 无独立结论');expect(checkVerdict({checked:true,valid:false})).toBe('失败');
 const response=JSON.parse(readFileSync('tools/city-delivery-decision/examples-2f/planning-success.json','utf8')).response as StandardDecision;
 const route=response.result!.routes.find(r=>r.active)!;const copy=structuredClone(route);
 delete (copy.loadingCheck!.checks as Partial<NonNullable<DecisionRoute['loadingCheck']>['checks']>).fragile;
 expect(routeConstraintRows(copy).find(r=>r.id==='fragile')!.verdict).toBe('未检查 / 无独立结论');
 copy.unloadingCheck={...copy.unloadingCheck,checked:true,valid:false};expect(routeConstraintRows(copy).find(r=>r.id==='unloading_blocked')!.verdict).toBe('失败');
 expect(routeConstraintRows(route).filter(r=>r.id!=='loading_path').every(r=>r.verdict==='通过')).toBe(true);
 expect(routeConstraintRows({loadingCheck:null,partialChecks:undefined} as DecisionRoute).filter(r=>r.id!=='loading_path').every(r=>r.verdict!=='通过')).toBe(true);
});
test('real trace changes distinguish layout attempts from reassignment and report order changes',()=>{
 const before=[{vehicleId:'V01',stopOrder:['S01','S02']},{vehicleId:'V02',stopOrder:[]}];
 expect(traceChanges(before,structuredClone(before))).toEqual([]);
 expect(traceChanges(before,[{vehicleId:'V01',stopOrder:[]},{vehicleId:'V02',stopOrder:['S02','S01']}])).toContain('S01：V01 → V02');
 expect(decisionTrace({search:{trace:[null,{phase:'budget-stop',reason:'预算耗尽'}]}} as StandardDecision)).toEqual([{phase:'budget-stop',reason:'预算耗尽',executable:undefined,routes:undefined,failures:undefined,failure:undefined}]);
});
test('new placements with no old coordinates are not described as cargo movement',()=>{
 const to={x:0,y:0,z:1,rotation:0,vehicleId:'V01'};
 expect(placementChangeText([{from:null,to}])).toContain('新生成 1 件货位');
 expect(placementChangeText([{from:to,to:{...to,z:2}}])).toContain('实际修订 1 件已有货位');
 expect(placementChangeText([{from:to,to}])).toBe('未发现已有货位变化。');
 expect(placementDiffText({from:null,to})).toBe('新生成货位');expect(placementDiffText({from:to,to:{...to,x:1,z:2}})).toBe('x 0 → 1；z 1 → 2');
});
