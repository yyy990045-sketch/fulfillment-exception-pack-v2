"""Targeted interface checks for the new input and the legacy demo chain."""
import argparse
import concurrent.futures
import copy
import json
import os
import time
import urllib.error
import urllib.request
from decimal import Decimal
from pathlib import Path

from decision import V1, V2
from evidence_v3 import OUT, replay

BASE=os.environ.get("CITY_DECISION_BASE", "http://127.0.0.1:8114")


def post(path, request):
    start=time.perf_counter()
    r=urllib.request.Request(BASE+path,data=json.dumps(request).encode(),headers={"Content-Type":"application/json"})
    try:
        with urllib.request.urlopen(r,timeout=12) as response:
            status,value=response.status,json.load(response)
    except urllib.error.HTTPError as e:
        status,value=e.code,json.load(e)
    return status,value,round((time.perf_counter()-start)*1000,3)


def duration_from_input(scene, order):
    """Independent decimal replay: never call route_result/evaluate_routes."""
    def minute(value):
        h,m=map(int,value.split(':'))
        return Decimal(h*60+m)
    start=now=minute(scene['departureTime'])
    stops={s['stopId']:s for s in scene['stops']}
    ids=scene['routing']['nodeIds']
    driving=waiting=service=Decimal(0)
    for a,b in zip(['DEPOT',*order],[*order,'DEPOT']):
        travel=Decimal(str(scene['routing']['travelTimeMatrixMinutes'][ids.index(a)][ids.index(b)]))
        now+=travel;driving+=travel
        if b!='DEPOT':
            stop=stops[b];wait=max(Decimal(0),minute(stop['timeWindow']['start'])-now)
            amount=Decimal(str(stop['serviceDurationMinutes']))
            now+=wait+amount;waiting+=wait;service+=amount
    return {'durationMinutes':float(now-start),'drivingMinutes':float(driving),
            'waitingMinutes':float(waiting),'serviceMinutes':float(service)}


def verify_route_duration(output):
    fixture=json.loads((Path(__file__).parent/'examples-2f/max-route-duration-request.json').read_text())
    cases=[]
    def case(name,outbound,inbound,allowed):
        request=copy.deepcopy(fixture)
        request['scenario']['routing']['travelTimeMatrixMinutes']=[[0,outbound],[inbound,0]]
        cases.append((name,request,allowed))
        return request
    case('A-479.99',239.995,239.995,True)
    case('B-480',240,240,True)
    case('C-480.01',240.005,240.005,False)
    case('D-T12-500',250,250,False)
    waiting=case('E-wait-and-service',200,200,False)
    waiting['scenario']['stops'][0]['timeWindow']['start']='12:00'
    waiting['scenario']['stops'][0]['serviceDurationMinutes']=41
    case('F-return-leg',250,251,False)
    def two_stops(request):
        s=request['scenario'];stop=copy.deepcopy(s['stops'][0]);stop['stopId']='S02';s['stops'].append(stop)
        cargo=copy.deepcopy(s['cargo'][0]);cargo.update(cargoId='S02-C01',stopId='S02',orderId='O-S02');s['cargo'].append(cargo)
        s['orders'].append({'orderId':'O-S02','stopId':'S02','cargoIds':['S02-C01']})
        s['routing']['nodeIds']=['DEPOT','S01','S02']
    multi=copy.deepcopy(fixture);two_stops(multi)
    s=multi['scenario'];v=copy.deepcopy(s['vehicles'][0]);v['vehicleId']='V02';s['vehicles'].append(v)
    s['routing']['distanceMatrixKm']=[[0,100,10],[100,0,90],[10,90,0]]
    s['routing']['travelTimeMatrixMinutes']=[[0,250,20],[250,0,240],[20,240,0]]
    multi['routes']=[{'vehicleId':'V01','stopOrder':['S01']},{'vehicleId':'V02','stopOrder':['S02']}]
    cases.append(('G-one-vehicle-over-limit',multi,False))
    idle=copy.deepcopy(cases[1][1]);v=copy.deepcopy(idle['scenario']['vehicles'][0]);v['vehicleId']='V02';idle['scenario']['vehicles'].append(v)
    idle['routes'].append({'vehicleId':'V02','stopOrder':[]});cases.append(('H-unused-vehicle',idle,True))
    repair=copy.deepcopy(fixture);two_stops(repair);s=repair['scenario']
    for stop in s['stops']:stop['timeWindow']['end']='20:00'
    s['routing']['distanceMatrixKm']=[[0,130,10],[25,0,100],[25,15,0]]
    s['routing']['travelTimeMatrixMinutes']=[[0,260,20],[50,0,200],[50,30,0]]
    repair['routes']=[{'vehicleId':'V01','stopOrder':['S01','S02']}]
    cases.append(('K-authorized-valid-reassignment',repair,None))
    layout_failure=copy.deepcopy(fixture);layout_failure['scenario']['cargo'][0]['length']=3
    cases.append(('L-layout-and-duration-failure',layout_failure,False))
    records=[]
    strategies=[('route-first',False,False),('layout-repair',True,False),('joint-feedback',True,True)]
    for name,original,allowed in cases:
        for strategy,repair,reassign in strategies:
            request=copy.deepcopy(original);request.update(strategy=strategy,allowLayoutRepair=repair,allowReassignment=reassign)
            prefix=name+'-'+strategy
            (output/(prefix+'-request.json')).write_text(json.dumps(request,ensure_ascii=False,indent=2)+'\n')
            code,response,elapsed=post('/api/city-delivery/plan-scene',request)
            (output/(prefix+'-response.json')).write_text(json.dumps(response,ensure_ascii=False,indent=2)+'\n')
            expected=allowed if allowed is not None else strategy=='joint-feedback'
            assert code==200 and response['executable'] is expected,(prefix,code,response['solverStatus'])
            assert (response['solverStatus']=='FEASIBLE') is expected,prefix
            assert (response['actualExecutablePlanCost'] is not None) is expected,prefix
            result=response['result'];assert result['feasibility']['executable'] is expected,prefix
            assert bool(result['feasibility']['reasons']) is not expected,prefix
            assert all(r['feasibility']['executable'] for r in result['routes']) is expected,prefix
            if expected:assert response['actualExecutablePlanCost']==result['totals']['totalCost'],prefix
            arithmetic=[]
            for route in result['routes']:
                independent=duration_from_input(request['scenario'],route['stopOrder'])
                duration=independent['durationMinutes'];limit=request['scenario']['rules']['maxRouteDurationMinutes']
                assert abs(duration-route['totalDurationMinutes'])<1e-7,prefix
                reasons=[r for r in route['feasibility']['reasons'] if r['type']=='max_route_duration']
                violates=bool(route['active']) and duration>limit
                assert bool(reasons) is violates,(prefix,duration,reasons)
                if violates:
                    assert not route['feasibility']['executable'] and not expected,prefix
                    reason=reasons[0]
                    assert reason['vehicleId']==route['vehicleId'] and reason['maxRouteDurationMinutes']==limit,prefix
                    assert abs(reason['actualDurationMinutes']-duration)<1e-7 and abs(reason['excessMinutes']-(duration-limit))<1e-7,prefix
                    assert reason in result['feasibility']['reasons'],prefix
                if not route['active']:
                    assert duration==0 and not reasons and route['costs']['totalCost']==0,prefix
                arithmetic.append({'vehicleId':route['vehicleId'],'active':route['active'],**independent,'durationLimitMinutes':limit,'violatesLimit':violates})
            if name=='K-authorized-valid-reassignment' and expected:
                assert result['routes'][0]['stopOrder']==['S02','S01'] and result['totals']['totalDurationMinutes']==100,prefix
            records.append({'case':name,'strategy':strategy,'httpStatus':code,'solverStatus':response['solverStatus'],'executable':response['executable'],
                            'actualExecutablePlanCost':response['actualExecutablePlanCost'],'independentArithmetic':arithmetic,'clientInterfaceMs':elapsed})
    for strategy,repair,reassign in strategies:
        request=copy.deepcopy(fixture);request.pop('routes');request.update(strategy=strategy,allowLayoutRepair=repair,allowReassignment=reassign)
        prefix='J-T12-automatic-'+strategy
        code,response,elapsed=post('/api/city-delivery/plan-scene',request)
        (output/(prefix+'-request.json')).write_text(json.dumps(request,ensure_ascii=False,indent=2)+'\n')
        (output/(prefix+'-response.json')).write_text(json.dumps(response,ensure_ascii=False,indent=2)+'\n')
        assert code==200 and not response['executable'] and response['solverStatus']!='FEASIBLE' and response['actualExecutablePlanCost'] is None,prefix
        records.append({'case':'J-T12-automatic','strategy':strategy,'httpStatus':code,'solverStatus':response['solverStatus'],'executable':False})
    report={'independentArithmetic':'Decimal replay of input travel, waiting, service and return; no evaluator imports','records':records}
    (output/'route-duration-http-verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    return report


def main(output=OUT):
    output.mkdir(parents=True,exist_ok=True)
    request=json.loads((OUT/'new-scenario-request.json').read_text())
    validation_status, validation_result, validation_elapsed = post('/api/city-delivery/validate-scene', {'scenario': request['scenario']})
    assert validation_status==200 and validation_result['solverStatus']=='VALID'
    status,result,elapsed=post('/api/city-delivery/plan-scene',request)
    assert status==200 and result['solverStatus']=='FEASIBLE'
    replay(result)
    records=[{'name':'new-independent-scene-validation','httpStatus':validation_status,'solverStatus':validation_result['solverStatus'],'clientInterfaceMs':validation_elapsed},
             {'name':'new-independent-scene','httpStatus':status,'solverStatus':result['solverStatus'],'clientInterfaceMs':elapsed,'serviceTiming':result['serviceTiming'],'timing':result['timing']}]
    (output/'new-scenario-http-response.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    bad_inputs=[]
    for name,change in [('missing-weight',lambda s:s['cargo'][0].pop('weightKg')),
                        ('zero-weight',lambda s:s['cargo'][0].update(weightKg=0)),
                        ('wrong-units',lambda s:s['units'].update(dimensions='cm')),
                        ('missing-rules',lambda s:s['rules'].pop('minimumSupportRatio')),
                        ('duplicate-cargo',lambda s:s['cargo'][1].update(cargoId=s['cargo'][0]['cargoId'])),
                        ('missing-matrix',lambda s:s['routing']['distanceMatrixKm'][0].pop())]:
        invalid=copy.deepcopy(request);change(invalid['scenario']);code,value,ms=post('/api/city-delivery/plan-scene',invalid)
        assert code==422 and value['solverStatus']=='INPUT_INVALID',name
        bad_inputs.append({'name':name,'httpStatus':code,'solverStatus':value['solverStatus'],'error':value['error']})
    broken=copy.deepcopy(request);broken['scenario']['vehicles'][0]['compartment']['width']=.2;broken['scenario']['vehicles'][0]['rearDoor']['xMax']=.2
    broken['scenario']['vehicles']=broken['scenario']['vehicles'][:1]
    code,value,ms=post('/api/city-delivery/plan-scene',broken)
    assert code==200 and value['solverStatus']=='SEARCH_EXHAUSTED' and value['actualExecutablePlanCost'] is None
    records.append({'name':'valid-but-search-failed','httpStatus':code,'solverStatus':value['solverStatus'],'clientInterfaceMs':ms})
    legacy=json.loads((V2/'order-adjustment-examples.json').read_text())['examples'][1]['request']
    code,value,ms=post('/api/city-delivery/revise-order',legacy)
    assert code==200 and value['executable']
    records.append({'name':'legacy-four-stop','httpStatus':code,'executable':value['executable'],'clientInterfaceMs':ms})
    legacy=json.loads((V2/'fleet-adjustment-example.json').read_text())['request']
    code,value,ms=post('/api/city-delivery/revise-fleet',legacy)
    assert code==200 and value['executable']
    records.append({'name':'legacy-nine-stop','httpStatus':code,'executable':value['executable'],'clientInterfaceMs':ms})
    # No permission to silently change a user-supplied failing assignment.
    supplied=copy.deepcopy(request)
    supplied.update(routes=[{'vehicleId':'V01','stopOrder':[s['stopId'] for s in request['scenario']['stops']]},{'vehicleId':'V02','stopOrder':[]}],allowReassignment=False,allowLayoutRepair=False)
    code,value,ms=post('/api/city-delivery/plan-scene',supplied)
    assert code==200 and not value['executable'] and not value['revision']['reassigned']
    assert value['result']['routes'][0]['stopOrder']==supplied['routes'][0]['stopOrder']
    records.append({'name':'authorization-preserved','httpStatus':code,'solverStatus':value['solverStatus'],'clientInterfaceMs':ms})
    method_results=[]
    for strategy, flags in [('route-first', {'allowLayoutRepair':False,'allowReassignment':False}),
                            ('layout-repair', {'allowLayoutRepair':True,'allowReassignment':False}),
                            ('joint-feedback', {'allowLayoutRepair':True,'allowReassignment':True})]:
        candidate=copy.deepcopy(request)
        candidate.update(strategy=strategy, **flags)
        code,value,ms=post('/api/city-delivery/plan-scene', candidate)
        method_results.append({'strategy':strategy,'httpStatus':code,'solverStatus':value['solverStatus'],'executable':value['executable'],'actualExecutablePlanCost':value.get('actualExecutablePlanCost'),'clientInterfaceMs':ms})
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
        concurrent_results=list(pool.map(lambda _:post('/api/city-delivery/plan-scene',request),range(5)))
    assert all(code in (200,503) for code,_,_ in concurrent_results)
    report={'baseUrl':BASE,'records':records,'methodResults':method_results,'invalidInputsRejected':bad_inputs,
            'concurrentRequests':[{'httpStatus':code,'solverStatus':value['solverStatus'],'clientInterfaceMs':ms} for code,value,ms in concurrent_results],
            'serviceMode':'HTTP threads + two isolated compute processes; health does not wait behind solver; per-request 8s hard timeout',
            'wallTimesIncludeProcessStartup':True}
    duration=verify_route_duration(output)
    report['routeDurationChecks']=len(duration['records'])
    (output/'http-verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(report,ensure_ascii=False))


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--output-dir',type=Path,default=OUT,help='Keep generated HTTP evidence outside historical fixtures when needed.')
    main(parser.parse_args().output_dir)
