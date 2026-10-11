"""Reproducible, bounded comparison; separate from frozen research gates."""
import copy
import hashlib
import json
import platform
import statistics
import time
from pathlib import Path

import ortools
from decision import V1, V2, checks, identity
from standard import CONTRACT, InputError, plan_standard, validate_scene

OUT = Path(__file__).parent / "evidence-v3"


def standardize(scene):
    s=copy.deepcopy(scene)
    s={k:s[k] for k in ["scenarioId","name","source","warehouse","stops","cargo","vehicles","departureTime","routing","costs"]}
    s["schemaVersion"]="3.0.0"
    s["units"]=CONTRACT["units"]
    s["rules"]=CONTRACT["rules"]
    s["source"]={k:s["source"][k] for k in ["dataType","name","description","license","authorization"]}
    s["routing"]={k:s["routing"][k] for k in ["nodeIds","distanceMatrixKm","travelTimeMatrixMinutes","returnToDepot"]}
    s["costs"]={k:s["costs"][k] for k in ["currency","waitingCostPerMinute","extraHandlingCostPerCargoMove"]}
    s["orders"]=[]
    for stop in s["stops"]:
        oid="ORDER-"+stop["stopId"]
        ids=[]
        for c in s["cargo"]:
            if c["stopId"]==stop["stopId"]:
                c["orderId"]=oid
                ids.append(c["cargoId"])
        s["orders"].append({"orderId":oid,"stopId":stop["stopId"],"cargoIds":ids})
    for v in s["vehicles"]:
        v.setdefault("costs",{k:scene["costs"][k] for k in ["vehicleFixedCost","drivingCostPerKm"]})
        for k in list(v):
            if k not in ["vehicleId","name","maxPayloadKg","compartment","rearDoor","costs"]:v.pop(k)
        v["rearDoor"].pop("opening",None)
    return s


def new_scene():
    s=standardize(json.loads((V2/"scenario.json").read_text()))
    s.update({"scenarioId":"city-independent-six-stop-003","name":"独立六店混合包装件机制实例"})
    s["source"].update({"name":"独立生成六店案例","description":"本轮独立生成，非传化订单或公开基准。每店货件数量为 1–3，与四店/九店样例不同。"})
    s["stops"]=s["stops"][:6]
    s["cargo"]=[]
    for i,stop in enumerate(s["stops"]):
        stop["timeWindow"]={"start":"08:00","end":"10:30"}
        for j in range(1+i%3):
            wide=i==4
            s["cargo"].append({"cargoId":f"NEW-{i+1}-{j+1}","orderId":"ORDER-"+stop["stopId"],"stopId":stop["stopId"],
                               "name":"独立包装件","length":1.65 if wide else .65+.12*j,"width":1.05 if wide else .55,
                               "height":.65,"weightKg":65.5 if wide else 18.25+j,"fragile":j%2==1,"maxTopLoadKg":0 if j%2==1 else 30,
                               "orientation":{"uprightOnly":True,"allowedYawDegrees":[0,90]},"color":stop["color"]})
    s["vehicles"]=s["vehicles"][:2]
    s["vehicles"][0]["compartment"]={"length":4.2,"width":1.85,"height":1.9}
    s["vehicles"][1]["compartment"]={"length":7.0,"width":2.5,"height":2.2}
    for v in s["vehicles"]:
        d=v["compartment"];v["rearDoor"]={"axis":"z","position":d["length"],"xMin":0,"xMax":d["width"],"yMin":0,"yMax":d["height"]}
    nodes=[s["warehouse"],*s["stops"]]
    d=[[abs(a["x"]-b["x"])+abs(a["y"]-b["y"]) for b in nodes] for a in nodes]
    s["routing"]={"nodeIds":[n["stopId"] for n in nodes],"distanceMatrixKm":d,"travelTimeMatrixMinutes":[[2*x for x in row] for row in d],"returnToDepot":True}
    s["orders"]=[{"orderId":"ORDER-"+stop["stopId"],"stopId":stop["stopId"],"cargoIds":[c["cargoId"] for c in s["cargo"] if c["stopId"]==stop["stopId"]]} for stop in s["stops"]]
    return s


def replay(response):
    if not response["executable"]:return
    for r in response["result"]["routes"]:
        if not r["active"]:continue
        from decision import assess
        v=next(v for v in response["scenario"]["vehicles"] if v["vehicleId"]==r["vehicleId"])
        actual=assess(response["scenario"],v,r["stopOrder"],r["placements"]["positions"],r["planId"])
        assert actual["feasibility"]["executable"]
        assert actual["unloading"]==r["unloading"]
        assert actual["costs"]==r["costs"]
        assert not r["unloading"]["finalRemainingCargoIds"]


def main():
    OUT.mkdir(exist_ok=True)
    frozen={str(p):hashlib.sha256(p.read_bytes()).hexdigest() for base in (V1,V2) for p in base.glob('*.json')}
    scenes=[standardize(json.loads((V1/'scenario.json').read_text())),standardize(json.loads((V2/'scenario.json').read_text())),new_scene()]
    rows=[]
    methods = {
        "route-first": {"allowLayoutRepair": False, "allowReassignment": False},
        "layout-repair": {"allowLayoutRepair": True, "allowReassignment": False},
        "joint-feedback": {"allowLayoutRepair": True, "allowReassignment": True},
    }
    method_order = list(methods)
    for s in scenes:
        validate_scene(s)
        for repeat in range(3):
            ordered = method_order[repeat % len(method_order):] + method_order[:repeat % len(method_order)]
            for strategy in ordered:
                req={"scenario":s,"strategy":strategy,"budgetMs":2000,**methods[strategy]}
                before=time.perf_counter();result=plan_standard(req);elapsed=(time.perf_counter()-before)*1000
                replay(result)
                initial=result["initialCheck"]
                rows.append({"scenarioId":s["scenarioId"],"inputFingerprint":identity(s),"repeat":repeat,"strategy":strategy,
                             "status":result["solverStatus"],"feasible":result["executable"],"actualPlanCost":result["actualExecutablePlanCost"],
                             "nominalFailedCost":result["result"]["totals"]["totalCost"] if result["result"] and not result["executable"] else None,
                             "initialLoadingConflictCount":sum(not r.get('loadingCheck',{}).get('valid',False) for r in initial['routes'] if r['active']) if initial else None,
                             "revisedCargoCount":len(result['revision']['changedCargoIds']),"unassignedStopCount":len(result['unassignedStopIds']),
                             "failureEvidence":result['search']['failureEvidence'][-4:],
                             "timing":result['timing'],"functionWallMs":round(elapsed,3)})
                if repeat==0:
                    (OUT/(s['scenarioId']+'-'+strategy+'.json')).write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    invalid=copy.deepcopy(scenes[2]);invalid['cargo'][0].pop('weightKg')
    try:validate_scene(invalid)
    except InputError as e:rejection=str(e)
    else:raise AssertionError('missing weight accepted')
    summary=[]
    for s in scenes:
        for strategy in method_order:
            group=[r for r in rows if r['scenarioId']==s['scenarioId'] and r['strategy']==strategy]
            summary.append({'scenarioId':s['scenarioId'],'strategy':strategy,'runs':len(group),'feasibleRuns':sum(r['feasible'] for r in group),
                            'feasibilityRate':sum(r['feasible'] for r in group)/len(group),
                            'actualCosts':[r['actualPlanCost'] for r in group],
                            'medianOverallMs':round(statistics.median(r['functionWallMs'] for r in group),3),
                            'medianSolveMs':round(statistics.median(r['timing']['solveMs'] for r in group),3),
                            'medianCheckMs':round(statistics.median(r['timing']['constraintCheckMs'] for r in group),3)})
    report={'environment':{'python':platform.python_version(),'ortools':ortools.__version__,'platform':platform.platform(),'machine':platform.machine()},
            'sameBudgetMs':2000,'sameSceneInputs':True,'sameCostsAndHardChecks':True,'alternatingRunOrder':True,
            'methods':{
                'route-first':'路线优先 OR-Tools 仅重量与时间窗，再检查固定主布局；不使用几何反馈。',
                'layout-repair':'沿用同一次路线结果，仅搜索有限替代布局；不改车、不改路线。',
                'joint-feedback':'相同预算，失败后替代布局与几何反馈路线；所有最终结果再次检查相同硬约束。'
            },
            'evidenceScope':'仅三个合成实例、每种方法三次运行，不作统计显著性或真实企业收益声称；API时间另见 http-verification.json。',
            'missingWeightRejected':rejection,'rows':rows,'summary':summary}
    (OUT/'comparison.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    (OUT/'new-scenario-request.json').write_text(json.dumps({'scenario':scenes[2],'strategy':'joint-feedback','budgetMs':2000,'allowLayoutRepair':True,'allowReassignment':True},ensure_ascii=False,indent=2)+'\n')
    (OUT/'contract.json').write_text(json.dumps(CONTRACT,ensure_ascii=False,indent=2)+'\n')
    assert frozen=={str(p):hashlib.sha256(p.read_bytes()).hexdigest() for base in (V1,V2) for p in base.glob('*.json')}
    print(json.dumps(summary,ensure_ascii=False))


if __name__=='__main__':main()
