"""Read-only algorithm acceptance; writes new requests/results outside the repository."""
import argparse, copy, hashlib, json, platform, sys, time, urllib.request
from pathlib import Path

parser=argparse.ArgumentParser()
parser.add_argument('--repo',type=Path,required=True)
parser.add_argument('--out',type=Path,required=True)
parser.add_argument('--base-url',default='http://127.0.0.1:8114')
args=parser.parse_args();root=args.repo.resolve();out=args.out.resolve();out.mkdir(parents=True,exist_ok=True)
sys.path.insert(0,str(root/'tools/city-delivery-decision'))
from evidence_v3 import standardize, replay
from decision import identity
import ortools

def read(p):return json.loads((root/p).read_text(encoding='utf-8'))
def save(name,value):(out/(name+'.json')).write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
protected=[*sorted((root/'frontend/public/demo/city-delivery/v1').glob('*.json')),*sorted((root/'frontend/public/demo/city-delivery/v2').glob('*.json')),*[root/p for p in ['tools/city-delivery-decision/standard.py','tools/city-delivery-decision/decision.py','tools/city-delivery/build_demo.py']]]
before={str(p.relative_to(root)):sha(p) for p in protected}
def post(name,endpoint,body):
 save(name+'-request',body)
 start=time.perf_counter()
 req=urllib.request.Request(args.base_url.rstrip('/')+'/api/city-delivery/'+endpoint,data=json.dumps(body).encode('utf-8'),headers={'Content-Type':'application/json'},method='POST')
 with urllib.request.urlopen(req,timeout=20) as response:value=json.load(response)
 assert value['executionMode']=='computed-per-request'
 save(name+'-response',value)
 return value,round((time.perf_counter()-start)*1000,3)

scenes={'four':standardize(read('frontend/public/demo/city-delivery/v1/scenario.json')),
        'nine':standardize(read('frontend/public/demo/city-delivery/v2/scenario.json')),
        'six':read('tools/city-delivery-decision/examples-2f/legal-request.json')['scenario']}
if (root/'frontend/public/demo/city-delivery/geo-city/v1/berlin/task.json').exists():scenes['geo-nine']=read('frontend/public/demo/city-delivery/geo-city/v1/berlin/task.json')
methods={'route-first':(False,False),'layout-repair':(True,False),'joint-feedback':(True,True)}
rows=[]
for label,scene in scenes.items():
 fingerprints=set()
 for repeat in range(1,4):
  names=list(methods);names=names[(repeat-1)%3:]+names[:(repeat-1)%3]
  for method in names:
   repair,reassign=methods[method]
   body={'scenario':copy.deepcopy(scene),'strategy':method,'budgetMs':2000,'allowLayoutRepair':repair,'allowReassignment':reassign}
   response,ms=post(f'{label}-{method}-{repeat}','plan-scene',body);replay(response)
   fingerprints.add(response['scenarioFingerprint']);result=response['result'];active=[r for r in (result or {}).get('routes',[]) if r['active']]
   rows.append({'case':label,'repeat':repeat,'method':method,'inputFingerprint':response['scenarioFingerprint'],'requestScenarioHash':identity({'scenario':scene}),
     'solverStatus':response['solverStatus'],'executable':response['executable'],'actualCost':response['actualExecutablePlanCost'],
     'totals':result['totals'] if response['executable'] else None,'returnTime':max((r['returnTime'] for r in active),default=None) if response['executable'] else None,
     'changedCargo':len(response['revision']['changedCargoIds']),'reassigned':response['revision']['reassigned'],
     'phases':[t['phase'] for t in response['search']['trace']],'routeAssignments':[{'vehicleId':r['vehicleId'],'stopOrder':r['stopOrder']} for r in active],
     'failureReasons':(result or {}).get('feasibility',{}).get('reasons',[]),'httpWallMs':ms,'timing':response['timing']})
 assert len(fingerprints)==1,(label,fingerprints)
 print(label,[(m,sum(r['executable'] for r in rows if r['case']==label and r['method']==m)) for m in methods],flush=True)

four=[]
for allow in (False,True):
 body={'scenarioId':scenes['four']['scenarioId'],'basePlanId':'PLAN_B','stopOrder':['S01','S02','S04','S03'],'allowLayoutRepair':allow}
 response,ms=post('four-revision-'+str(allow).lower(),'revise-order',body)
 assert response['executable']==allow
 four.append({'allowLayoutRepair':allow,'executable':response['executable'],'originalExecutable':response['originalLayoutCheck']['feasibility']['executable'],
              'attempts':response['revision']['attemptedLayouts'],'changedCargoIds':response['revision']['changedCargoIds'],'resultCosts':response['result']['costs'],
              'distanceKm':response['result']['distanceKm'],'returnTime':response['result']['returnTime'],'comparison':response['comparison']})
assert len(four[1]['changedCargoIds'])==8

def operational(route):
 return {'vehicleId':route['vehicleId'],'active':route['active'],'stopOrder':route['stopOrder'],'cargoIds':route['cargoIds'],
   'distanceKm':route['distanceKm'],'costs':route['costs'],'totalDurationMinutes':route['totalDurationMinutes'],'returnTime':route['returnTime'],
   'positions':route['placements']['positions'],
   'steps':[{k:s.get(k) for k in ['operation','stopId','cargoId','movementPath','remainingCargoIdsBefore','remainingCargoIdsAfter']} for s in route['unloading']['steps']],
   'loading':[{k:s.get(k) for k in ['operation','cargoId','path','loadedCargoIdsBefore','loadedCargoIdsAfter']} for s in route['unloading']['loadingSteps']]}
historical=[]
for plan in read('frontend/public/demo/city-delivery/v2/plans.json')['plans']:
 body={'scenarioId':plan['scenarioId'],'routes':[{'vehicleId':r['vehicleId'],'stopOrder':r['stopOrder']} for r in plan['routes']],'allowReassignment':False}
 response,ms=post('nine-fixed-'+plan['planId'],'revise-fleet',body)
 assert response['executable'] and not response['revision']['reallocated']
 assert response['result']['totals']==plan['totals']
 for old,new in zip(plan['routes'],response['result']['routes']):assert operational(old)==operational(new),old['vehicleId']
 historical.append({'historicalPlanId':plan['planId'],'kind':'HTTP fixed-route recomputation, not fresh route optimization','totals':response['result']['totals'],
                    'returnTime':max(r['returnTime'] for r in response['result']['routes']),'exactOperationalMatch':True})

after={str(p.relative_to(root)):sha(p) for p in protected};assert before==after
summary={'python':platform.python_version(),'ortools':ortools.__version__,'budgetMs':2000,'repeats':3,
 'strategyRows':rows,'fourFixedOrderRevision':four,'nineHistoricalRecomputation':historical,'protectedHashesBefore':before,'protectedHashesAfter':after,
 'unchangedSolverAndFrozenData':True,'boundary':'Synthetic business data; actual HTTP computation. Saved plans reproduced with fixed routes; unconstrained new strategy outputs are separate.'}
save('summary',summary)
print(json.dumps({'ready':True,'runs':len(rows),'historical':historical,'four':four,'unchanged':True},ensure_ascii=False),flush=True)
