"""Bounded read-only evidence collection. Writes only judge-evidence records.

Run with tools/city-delivery-decision/.venv/bin/python -B artifacts/judge-evidence/audit_run.py
Uses existing checkers/services; no solver changes, new benchmark, or scaling input.
"""
import copy
import datetime
import hashlib
import importlib.util
import itertools
import json
import math
import os
import platform
import statistics
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / 'tools/city-delivery-decision'))
import decision


def protected_hashes():
    files = list((ROOT / 'frontend/public/demo/city-delivery').rglob('*.json'))
    files += list((ROOT / 'tools/city-delivery').glob('*.py'))
    files += list((ROOT / 'tools/city-delivery-decision').glob('*.py'))
    files += list((ROOT / 'frontend/src/features/city-delivery').rglob('*'))
    files += [ROOT / 'frontend/src/features/logistics/scene/create-scene.ts', ROOT / 'frontend/vite.config.ts']
    return {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(files) if p.is_file()}


def summary(response):
    result = response['result']
    single = 'originalLayoutCheck' in response
    routes = [result] if single else result['routes']
    return {'executable': response['executable'], 'revision': response['revision'],
            'totals': result['costs'] if single else result['totals'],
            'originalLayoutReusable': response.get('originalLayoutReusable'),
            'routes': [{'vehicleId': r['vehicleId'], 'stopOrder': r['stopOrder'], 'returnTime': r['returnTime'],
                        'distanceKm': r['distanceKm'], 'executable': r['feasibility']['executable'],
                        'reasons': r['feasibility']['reasons'],
                        'remainingCargoIds': r['unloading']['finalRemainingCargoIds'] if r.get('unloading') else None,
                        'geometryChecked': r['loadingCheck']['checked'], 'geometryValid': r['loadingCheck']['valid']}
                       for r in routes]}


def post(path, body):
    request = urllib.request.Request('http://127.0.0.1:8111' + path, data=json.dumps(body).encode(),
                                     headers={'Content-Type': 'application/json', 'Origin': 'http://127.0.0.1:8111'})
    start = time.perf_counter()
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            value, status = json.load(response), response.status
    except urllib.error.HTTPError as error:
        value, status = json.load(error), error.code
    return (time.perf_counter() - start) * 1000, status, value


def independently_check(scenario, route):
    """Separate simple boundary/rotation/pair checks and exact step state replay.

    Existing support checker also runs below, explicitly not independent support
    or physics validation. This collector does not certify worker/forklift access.
    """
    vehicle = next(v for v in scenario['vehicles'] if v['vehicleId'] == route['vehicleId'])
    positions = route['placements']['positions']
    cargos = {c['cargoId']: c for c in scenario['cargo'] if c['stopId'] in route['stopOrder']}
    assert {p['cargoId'] for p in positions} == set(cargos)
    assert len(positions) == len(cargos)
    assert sum(c['weightKg'] for c in cargos.values()) <= vehicle['maxPayloadKg']
    def interval(p, axis):
        dimension = {'x': 'width', 'y': 'height', 'z': 'length'}[axis]
        return p[axis], p[axis] + p[dimension]
    def intersects(a, b, axes):
        return all(min(interval(a,k)[1], interval(b,k)[1]) - max(interval(a,k)[0], interval(b,k)[0]) > 1e-7 for k in axes)
    for p in positions:
        assert p['vehicleId'] == route['vehicleId']
        c = cargos[p['cargoId']]
        assert p['rotation'] in c['orientation']['allowedYawDegrees']
        length, width = (c['width'], c['length']) if p['rotation'] % 180 == 90 else (c['length'], c['width'])
        assert (p['length'], p['width'], p['height']) == (length, width, c['height'])
        for k, dim in [('x','width'),('y','height'),('z','length')]:
            assert p[k] >= -1e-7 and p[k] + p[dim] <= vehicle['compartment'][dim] + 1e-7
    assert not any(intersects(a,b,['x','y','z']) for a,b in itertools.combinations(positions,2))
    remain = {p['cargoId']: p for p in positions}
    stopped = False
    for step in route['unloading']['steps']:
        assert not stopped
        assert sorted(remain) == step['remainingCargoIdsBefore']
        if step['operation'] == 'unload':
            p = remain[step['cargoId']]
            assert p['stopId'] == step['stopId']
            blockers = [q for cid,q in remain.items() if cid != p['cargoId'] and intersects(p,q,['x','y']) and q['z']+q['length'] > p['z']+1e-7]
            assert not blockers
            assert step['movement']['from'] == {k:p[k] for k in ['x','y','z']}
            assert step['movement']['to']['z'] > vehicle['rearDoor']['position']
            del remain[p['cargoId']]
        stopped = step['operation'] == 'blocked'
        assert sorted(remain) == step['remainingCargoIdsAfter']
    assert sorted(remain) == route['unloading']['finalRemainingCargoIds']


def main():
    before = protected_hashes()
    metadata = {'time': datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8))).isoformat(),
                'os': platform.platform(), 'python': sys.version, 'ortools': __import__('ortools').__version__,
                'logicalCpu': os.cpu_count(), 'memoryBytes': int(subprocess.check_output(['sysctl','-n','hw.memsize'])),
                'scope': 'four-store and nine-store existing scenarios only; sequential local requests; not load or scale testing',
                'requestsPerCase': 5, 'httpTimeoutSeconds': 15, 'frontendAbortTimeoutSeconds': 15,
                'solverSearchLimitSeconds': 2, 'orderLayoutCandidates': 24}
    performance = []
    pid = int(subprocess.check_output(['lsof','-t','-iTCP:8112','-sTCP:LISTEN']).decode().strip().splitlines()[0])
    samples = []
    done = threading.Event()
    def sample():
        while not done.is_set():
            line = subprocess.check_output(['ps','-p',str(pid),'-o','rss=,%cpu=,time=']).decode().strip()
            samples.append({'atSeconds':time.monotonic(),'psRssKiB_cpuPercent_cumulativeCpu':line})
            done.wait(.1)
    worker = threading.Thread(target=sample,daemon=True)
    worker.start()
    order = {'scenarioId':'city-delivery-synthetic-001','basePlanId':'PLAN_B',
             'stopOrder':['S01','S02','S04','S03'],'allowLayoutRepair':True}
    fleet = json.loads((decision.V2/'fleet-adjustment-example.json').read_text())['request']
    base_plan = json.loads((decision.V2/'plans.json').read_text())['plans'][0]
    cases = [
        ('order-reuse','revise-order',{**order,'stopOrder':['S02','S01','S04','S03']}),
        ('order-blocked','revise-order',{**order,'allowLayoutRepair':False}),
        ('order-repair','revise-order',order),
        ('order-time-window-failure','revise-order',{**order,'departureTime':'09:00'}),
        ('fleet-valid','revise-fleet',{'scenarioId':decision.FLEET_ID,'routes':[{'vehicleId':r['vehicleId'],'stopOrder':r['stopOrder']} for r in base_plan['routes']],'allowReassignment':False}),
        ('fleet-width-failure','revise-fleet',{**fleet,'allowReassignment':False}),
        ('fleet-reassign','revise-fleet',fleet),
    ]
    try:
        for name,path,payload in cases:
            times, statuses, fingerprints, successful = [],[],[],[]
            for repetition in range(5):
                elapsed,status,result = post('/api/city-delivery/'+path,payload)
                times.append(elapsed);statuses.append(status)
                if status==200:
                    compact=summary(result)
                    fingerprints.append(hashlib.sha256(json.dumps(compact,sort_keys=True).encode()).hexdigest())
                    successful.append(result['executable'])
                else:
                    compact=result
                if repetition==0:
                    (OUT/(name+'-response.json')).write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
            performance.append({'case':name,'request':payload,'ms':times,'medianMs':statistics.median(times),
                                'minMs':min(times),'maxMs':max(times),'p95NearestRankMs':sorted(times)[math.ceil(.95*len(times))-1],
                                'httpStatuses':statuses,'executable':successful,'stableResult':len(set(fingerprints))==1,'result':compact})
        invalid={**order,'stopOrder':['S01','S01','S02','S03']}
        elapsed,status,value=post('/api/city-delivery/revise-order',invalid)
        assert status==422
        negative={'request':invalid,'httpStatus':status,'elapsedMs':elapsed,'response':value}
    finally:
        done.set();worker.join(timeout=1)
    metadata['resourceSampling']={'pid':pid,'intervalSeconds':.1,'method':'ps RSS and lifetime-averaged CPU percent, not instantaneous per-request CPU',
                                  'peakObservedRssKiB':max(int(s['psRssKiB_cpuPercent_cumulativeCpu'].split()[0]) for s in samples),
                                  'maxObservedLifetimeCpuPercent':max(float(s['psRssKiB_cpuPercent_cumulativeCpu'].split()[1]) for s in samples),
                                  'samples':samples}
    (OUT/'performance.json').write_text(json.dumps({'environment':metadata,'cases':performance,'invalidInput':negative},ensure_ascii=False,indent=2)+'\n')
    scenario=json.loads((decision.V2/'scenario.json').read_text())
    plans=json.loads((decision.V2/'plans.json').read_text())['plans']
    saved=[]
    for plan in plans:
        for route in plan['routes']:
            independently_check(scenario,route)
            scoped=decision.scoped_scenario(scenario,next(v for v in scenario['vehicles'] if v['vehicleId']==route['vehicleId']),route['stopOrder'])
            assert decision.checks.geometry(scoped,route['placements']['positions']) == route['loadingCheck']
            route_new=decision.checks.route_result(scoped,route['stopOrder'])
            assert route_new['arrivals']==route['arrivals']
            assert route_new['distanceKm']==route['distanceKm']
            if route['active']:
                assert route_new['costs']==route['costs']
        saved.append({'planId':plan['planId'],'totals':plan['totals'],'latestReturn':max(r['returnTime'] for r in plan['routes']),
                      'allGeometryPassed':all(r['loadingCheck']['valid'] for r in plan['routes']),
                      'allTimeWindowsPassed':all(r['timeWindowCheck']['valid'] for r in plan['routes']),
                      'allCargoUnloaded':all(not r['unloading']['finalRemainingCargoIds'] for r in plan['routes']),
                      'uniqueAssignedCargoCount':len({cid for a in plan['assignments'] for cid in a['cargoIds']}),
                      'assignedCargoCount':sum(len(a['cargoIds']) for a in plan['assignments']),
                      'assignedStops':len(plan['assignments'])})
    # Full finite candidate audit under the implemented row-permutation scope.
    original=decision.read_v1('scenario.json')
    positions=next(p for p in decision.read_v1('placements.json')['plans'] if p['planId']=='PLAN_B')['positions']
    stop_ids=[s['stopId'] for s in original['stops']]
    starts={sid:min(p['z'] for p in positions if p['stopId']==sid) for sid in stop_ids}
    slots=sorted(starts.values())
    permutation_results=[]
    for visit in itertools.permutations(stop_ids):
        response=decision.revise_order({**order,'stopOrder':list(visit)})
        feasible=[]
        for rows in itertools.permutations(stop_ids):
            trial=copy.deepcopy(positions)
            mapping=dict(zip(rows,slots))
            for p in trial:p['z']=round(p['z']+mapping[p['stopId']]-starts[p['stopId']],6)
            result=decision.assess(original,original['vehicles'][0],list(visit),trial,'EVIDENCE-CANDIDATE')
            if result['loadingCheck']['valid'] and result['loadingPathCheck']['valid'] and result['unloadingCheck']['valid']:
                changes=decision.layout_changes(positions,trial)
                feasible.append((len(changes),round(sum(abs(c['to']['z']-c['from']['z']) for c in changes),6)))
        changes=response['revision']['changes']
        actual=(len(changes),round(sum(abs(c['to']['z']-c['from']['z']) for c in changes),6))
        assert feasible and actual==min(feasible)
        independently_check(response['scenario'],response['result'])
        permutation_results.append({'stopOrder':list(visit),'revisionStatus':response['revision']['status'],
                                    'movedCargoCount':actual[0],'sumAbsoluteZMovementM':actual[1],
                                    'minimumWithin24RowLayouts':list(min(feasible)),
                                    'attemptedLayouts':response['revision']['attemptedLayouts'],'executable':response['executable']})
    after=protected_hashes()
    assert before==after, 'Protected source/data changed during audit'
    (OUT/'integrity-and-local-revision.json').write_text(json.dumps({'savedPlanChecks':saved,'orders':permutation_results,
                'scope':'24 visit orders x 24 existing row-layout permutations, fixed x/y/rotation/stacking; no free-box optimum claim',
                'protectedFilesUnchanged':True,'sha256':before},ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'cases':[{k:r[k] for k in ['case','medianMs','maxMs','stableResult']} for r in performance],
                      'resources':{k:metadata['resourceSampling'][k] for k in ['peakObservedRssKiB','maxObservedLifetimeCpuPercent']},
                      'savedPlanChecks':saved,'finiteRepairValidated':len(permutation_results),'protectedFilesUnchanged':True},ensure_ascii=False))


if __name__=='__main__':main()
