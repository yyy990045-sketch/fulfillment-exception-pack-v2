"""Generate independent v2 fleet data and actual request/response examples."""
import copy
import json
from pathlib import Path

from decision import (VERSION, V2, fingerprint_v1, make_fleet_scenario, fleet_plan,
                      solve_routes, revise_order, revise_fleet)


CONTRACT = {
    "schemaVersion": VERSION,
    "executionMode": "computed-per-request",
    "serviceBaseUrl": "http://127.0.0.1:8112",
    "readinessPath": "/health",
    "endpoints": {
        "reviseOrder": {"method": "POST", "path": "/api/city-delivery/revise-order",
                        "request": {"scenarioId": "city-delivery-synthetic-001", "basePlanId": "PLAN_B",
                                    "stopOrder": ["S01", "S02", "S04", "S03"], "allowLayoutRepair": True},
                        "optional": {"departureTime": "HH:MM"},
                        "response": {"originalLayoutCheck": "原布局在提交顺序下的检查、阻挡货物和逐步停止结果",
                                     "originalLayoutReusable": "仅指空间、装车与卸货；时间窗另看结果，不能代替 executable",
                                     "revision": "是否保留/修订及实际货位变化",
                                     "result.placements.positions": "最终三维位置，旋转后的尺寸",
                                     "result.unloading.steps": "逐步卸货；blocked 时停止",
                                     "result.timeWindowCheck": "实际路线的门店时间窗检查",
                                     "result.costs": "相同费用规则下的计划代价",
                                     "executable": "包含装载、装车、卸货和时间窗的最终结论"},
                        "scope": "v1 一车四店发车前调整；允许任意完整门店排列，不只是 PLAN_A/PLAN_B。"},
        "reviseFleet": {"method": "POST", "path": "/api/city-delivery/revise-fleet",
                        "request": {"scenarioId": "city-delivery-multivehicle-synthetic-001",
                                    "routes": [{"vehicleId": "V01", "stopOrder": ["S01", "S02", "S03"]},
                                               {"vehicleId": "V02", "stopOrder": ["S04", "S05", "S06"]},
                                               {"vehicleId": "V03", "stopOrder": ["S07", "S08", "S09"]}],
                                    "allowReassignment": False},
                        "response": {"submittedCheck.routes": "每辆车的提交分配检查；失败时不伪造货位或装卸步骤",
                                     "submittedCheck.feasibility.reasons": "空间不足、超重、时间窗等原因",
                                     "result.routes": "每辆车最终路线、货位和装卸动作",
                                     "result.assignments": "每家门店的唯一服务车辆及货物",
                                     "result.totals": "费用、里程、车辆数量",
                                     "revision.reallocated": "是否经授权重新分配车辆与门店",
                                     "executable": "最终每车和全体分配均通过声明约束"},
                        "scope": "固定九店三车场景；完整覆盖全部门店。默认只检查提交分配，只有 allowReassignment=true 才允许改车/改序。"},
    },
    "requestLimits": {"bodyBytes": 32768, "routingSearchSeconds": 2, "orderRepairLayouts": 24},
    "http": {"invalidRequest": 422, "computedInfeasibleResult": 200, "unknownPath": 404,
             "corsOrigins": ["http://127.0.0.1:8111", "http://localhost:8111", "http://127.0.0.1:5173", "http://localhost:5173"]},
    "dataSources": {"v1": "/demo/city-delivery/v1/manifest.json", "fleet": "/demo/city-delivery/v2/manifest.json"},
    "constraints": ["实际货位边界", "货箱不重叠", "朝向", "载重", "易碎", "100% 支撑", "上方承重",
                    "后门直线装车", "逐站直线取货与抽走承托箱限制", "时间窗", "货物与门店唯一分配"],
    "notSupported": ["在途自动重装", "任意单箱拖拽", "任意车型或货物输入", "额外搬运", "真实交通",
                     "轴荷重心", "冷链", "任意多层自由装箱", "全局最优性", "生产级服务"],
    "truthBoundary": "均为合成机制演示；动画秒数不是现场耗时。布局修订需要发车前重新装车。失败只代表声明的分区方法或有限路线搜索未找到解。",
}


def write(name, value):
    (V2 / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def build():
    before = fingerprint_v1()
    scenario = make_fleet_scenario()
    baseline_routes = [{"vehicleId": "V01", "stopOrder": ["S03", "S01", "S02"]},
                       {"vehicleId": "V02", "stopOrder": ["S05", "S04", "S06"]},
                       {"vehicleId": "V03", "stopOrder": ["S09", "S07", "S08"]}]
    baseline = fleet_plan(scenario, baseline_routes, "FLEET_BASELINE")
    routes, error = solve_routes(scenario)
    if error:
        raise ValueError(error)
    candidate = fleet_plan(scenario, routes, "FLEET_ADJUSTED")
    if not baseline["feasibility"]["executable"] or not candidate["feasibility"]["executable"]:
        raise ValueError({"baseline": baseline["feasibility"], "candidate": candidate["feasibility"]})
    if any(route["unloading"]["finalRemainingCargoIds"] for p in (baseline, candidate) for route in p["routes"]):
        raise ValueError("A vehicle cannot unload all assigned cargo")
    wrapper = {"schemaVersion": VERSION, "scenarioId": scenario["scenarioId"]}
    changes = {key: round(candidate["totals"][key] - baseline["totals"][key], 4) for key in
               ("vehicleCount", "distanceKm", "vehicleFixedCost", "drivingCost", "extraHandlingMoves", "extraHandlingCost", "totalCost", "drivingMinutes", "totalDurationMinutes")}
    comparison = {**wrapper, "baselinePlanId": baseline["planId"], "adjustedPlanId": candidate["planId"],
                  "sameOrders": True, "sameVehicleResources": True, "sameCostRules": True, "sameConstraints": True,
                  "plans": [{"planId": p["planId"], **p["totals"], "executable": p["feasibility"]["executable"],
                             "loadingFeasible": all(r["loadingCheck"]["valid"] for r in p["routes"]),
                             "unloadingFeasible": all(r["unloadingCheck"]["valid"] for r in p["routes"]),
                             "timeWindowsSatisfied": all(r["timeWindowCheck"]["valid"] for r in p["routes"]),
                             "arrivalsByVehicle": [{"vehicleId": r["vehicleId"], "arrivals": r["arrivals"]} for r in p["routes"]]}
                            for p in (baseline, candidate)],
                  "delta": {"direction": "FLEET_ADJUSTED-minus-FLEET_BASELINE", **changes},
                  "decision": {"costAdvantageInThisCase": changes["totalCost"] < 0, "generalizedSavingsClaim": False,
                               "globalOptimalityClaim": False, "explanation": "同一合成订单和三辆异构车辆下，两套都可执行的方案比较；不推断真实企业收益。"}}
    V2.mkdir(parents=True, exist_ok=True)
    write("scenario.json", scenario)
    write("plans.json", {**wrapper, "plans": [baseline, candidate], "planningMode": "computed-at-delivery-with-live-request-endpoints"})
    write("placements.json", {**wrapper, "coordinateSystem": scenario["coordinateSystem"],
                             "plans": [{"planId": p["planId"], "vehicles": [r["placements"] for r in p["routes"]]} for p in (baseline, candidate)]})
    write("unloading-steps.json", {**wrapper, "rules": scenario["rules"],
                                  "plans": [{"planId": p["planId"], "vehicles": [r["unloading"] for r in p["routes"]]} for p in (baseline, candidate)]})
    write("comparison.json", comparison)
    write("decision-contract.json", CONTRACT)
    repair_request = CONTRACT["endpoints"]["reviseOrder"]["request"]
    reuse_request = {**repair_request, "stopOrder": ["S02", "S01", "S04", "S03"]}
    late_request = {**repair_request, "departureTime": "09:00"}
    write("order-adjustment-examples.json", {"schemaVersion": VERSION, "scenarioId": "city-delivery-synthetic-001",
                                           "examples": [{"name": name, "request": request, "response": revise_order(request)}
                                                        for name, request in [("原布局可用", reuse_request), ("原布局受阻并修订", repair_request),
                                                                              ("禁止修订时返回阻挡", {**repair_request, "allowLayoutRepair": False}),
                                                                              ("布局修好但时间窗失败", late_request)]]})
    bad_routes = copy.deepcopy(baseline_routes)
    # S09's wide cartons fit only the wide box. Swapping stops demonstrates a
    # geometric width failure even though payload and total volume are adequate.
    bad_routes[0]["stopOrder"][-1] = "S09"
    bad_routes[2]["stopOrder"][0] = "S02"
    bad_request = {"scenarioId": scenario["scenarioId"], "routes": bad_routes, "allowReassignment": True}
    recovered = revise_fleet(bad_request)
    assert not recovered["submittedCheck"]["feasibility"]["executable"] and recovered["executable"]
    write("fleet-adjustment-example.json", recovered)
    write("manifest.json", {**wrapper, "source": scenario["source"], "dataType": "synthetic",
                            "files": {"scenario": "scenario.json", "plans": "plans.json", "placements": "placements.json",
                                      "unloadingSteps": "unloading-steps.json", "comparison": "comparison.json",
                                      "decisionContract": "decision-contract.json", "orderExamples": "order-adjustment-examples.json",
                                      "fleetExample": "fleet-adjustment-example.json"},
                            "capabilities": {"liveOrderRecheck": True, "wholeStopLayoutRepair": True, "multiVehicleRoutes": True,
                                             "liveFleetRecheck": True, "allowExplicitReassignment": True,
                                             "extraHandling": False, "arbitraryDragSolve": False, "globallyOptimal": False},
                            "frontend": {"basePath": "/demo/city-delivery/v2/", "placements": "plans[].vehicles[].positions[]",
                                         "unloading": "plans[].vehicles[].stations[] / steps[] / loadingSteps[]",
                                         "routes": "plans[].routes[]", "assignments": "plans[].assignments[]",
                                         "singleVehicleBridge": "选中车辆后用 routes[] 中的 vehicleId、stopOrder、placements、unloading。不能再只取 vehicles[0]。",
                                         "rendering": "尺寸已包含朝向，最小角点坐标使用米；x宽/y高/z长、前壁0、后门最大z。"},
                            "validation": {"geometryActuallyChecked": True, "routesActuallyChecked": True, "unloadingActuallyReplayed": True,
                                           "uncheckedConstraints": scenario["uncheckedConstraints"]},
                            "v1Protection": {"unchanged": before == fingerprint_v1(), "sha256": before}})
    assert before == fingerprint_v1(), "v1 was modified"
    print(json.dumps({"scenarioId": scenario["scenarioId"], "baseline": baseline["totals"], "candidate": candidate["totals"],
                      "executable": True, "delta": changes, "v1Unchanged": True}, ensure_ascii=False))


if __name__ == "__main__":
    build()
