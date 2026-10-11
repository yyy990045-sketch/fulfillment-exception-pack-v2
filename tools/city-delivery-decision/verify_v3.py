"""Targeted interface checks for the new input and the legacy demo chain."""
import concurrent.futures
import copy
import json
import os
import time
import urllib.error
import urllib.request
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


def main():
    request=json.loads((OUT/'new-scenario-request.json').read_text())
    validation_status, validation_result, validation_elapsed = post('/api/city-delivery/validate-scene', {'scenario': request['scenario']})
    assert validation_status==200 and validation_result['solverStatus']=='VALID'
    status,result,elapsed=post('/api/city-delivery/plan-scene',request)
    assert status==200 and result['solverStatus']=='FEASIBLE'
    replay(result)
    records=[{'name':'new-independent-scene-validation','httpStatus':validation_status,'solverStatus':validation_result['solverStatus'],'clientInterfaceMs':validation_elapsed},
             {'name':'new-independent-scene','httpStatus':status,'solverStatus':result['solverStatus'],'clientInterfaceMs':elapsed,'serviceTiming':result['serviceTiming'],'timing':result['timing']}]
    (OUT/'new-scenario-http-response.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
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
    (OUT/'http-verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(report,ensure_ascii=False))


if __name__=='__main__':main()
