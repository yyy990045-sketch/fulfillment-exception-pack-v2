"""Small, local decision service. v1 data/calculations are read-only inputs."""
from __future__ import annotations

import copy
import hashlib
import importlib.util
import itertools
import json
import sys
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[2]
V1 = ROOT / "frontend/public/demo/city-delivery/v1"
V2 = ROOT / "frontend/public/demo/city-delivery/v2"
FLEET_ID = "city-delivery-multivehicle-synthetic-001"
VERSION = "2.0.0"
spec = importlib.util.spec_from_file_location("v1_checks", ROOT / "tools/city-delivery/build_demo.py")
checks = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checks)


def read_v1(name):
    return json.loads((V1 / name).read_text())


def fingerprint_v1():
    return {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(V1.glob("*.json"))}


def identity(request):
    return hashlib.sha256(json.dumps(request, sort_keys=True).encode()).hexdigest()[:12]


def validate_order(order, expected):
    if not isinstance(order, list) or any(not isinstance(s, str) for s in order):
        raise ValueError("stopOrder 必须是门店编号列表。")
    if len(order) != len(set(order)) or set(order) != set(expected):
        raise ValueError("必须且只能访问每家门店一次，不能遗漏、重复或加入未知门店。")


def validate_time(value):
    if not isinstance(value, str) or len(value) != 5 or value[2] != ":":
        raise ValueError("departureTime 使用 HH:MM 格式。")
    try:
        h, m = (int(x) for x in value.split(":"))
    except ValueError:
        raise ValueError("departureTime 使用 HH:MM 格式。")
    if not 0 <= h < 24 or not 0 <= m < 60:
        raise ValueError("出发时间超出有效范围。")


def attach_geometry(positions, geometry):
    for p in positions:
        d = geometry["cargoChecks"][p["cargoId"]]
        p["support"] = d["support"]
        p["stacking"] = {"layer": 1 if p["y"] == 0 else 2, "supportedCargoIds": d["supportedCargoIds"], "topLoadKg": d["topLoadKg"]}
        p["spaceCheck"] = {k: d[k] for k in ("boundaryValid", "collisionFree", "overlappingCargoIds", "orientationValid", "fragileValid", "loadBearingValid", "valid")}


def scoped_scenario(scenario, vehicle, order):
    scoped = copy.deepcopy(scenario)
    scoped["vehicles"] = [copy.deepcopy(vehicle)]
    scoped["stops"] = [s for s in scoped["stops"] if s["stopId"] in order]
    scoped["cargo"] = [c for c in scoped["cargo"] if c["stopId"] in order]
    if "costs" in vehicle:
        scoped["costs"].update(vehicle["costs"])
    return scoped


def assess(scenario, vehicle, order, positions, plan_id):
    """Real geometry + exact straight extraction + route calculation, per vehicle."""
    scoped = scoped_scenario(scenario, vehicle, order)
    route = checks.route_result(scoped, order)
    layout = copy.deepcopy(positions)
    geometry = checks.geometry(scoped, layout)
    compartment_volume = geometry.get("compartmentVolumeM3", 0)
    cargo_volume = geometry.get("totalCargoVolumeM3", 0)
    geometry["spaceUtilizationRatio"] = round(cargo_volume / compartment_volume, 6) if compartment_volume else 0
    geometry["spaceUtilizationPercent"] = round(geometry["spaceUtilizationRatio"] * 100, 2)
    attach_geometry(layout, geometry)
    unload = checks.unloading(scoped, f"{plan_id}-{vehicle['vehicleId']}", order, layout, geometry["cargoChecks"], route["arrivals"])
    unload.update({"planId": plan_id, "vehicleId": vehicle["vehicleId"], "scenarioId": scenario["scenarioId"]})
    for step in unload["steps"]:
        step["vehicleId"] = vehicle["vehicleId"]
    load_error = None
    try:
        load_steps = checks.loading(scoped, f"{plan_id}-{vehicle['vehicleId']}", layout, geometry["cargoChecks"])
        for step in load_steps:
            step["vehicleId"] = vehicle["vehicleId"]
    except ValueError as error:
        load_steps, load_error = [], str(error)
    unload["loadingSteps"] = load_steps
    reasons = []
    for constraint, result in geometry["checks"].items():
        if not result["valid"]:
            reasons.append({"type": constraint, "message": f"装载约束未通过：{constraint}", "cargoIds": [cid for cid, d in geometry["cargoChecks"].items() if not d["valid"]]})
    if load_error:
        reasons.append({"type": "loading_path", "message": load_error})
    if not route["timeWindowCheck"]["valid"]:
        for arrival in route["arrivals"]:
            if not arrival["timeWindowValid"]:
                reasons.append({"type": "time_window", "stopId": arrival["stopId"], "arrivalTime": arrival["arrivalTime"],
                                "serviceStartTime": arrival["serviceStartTime"], "latestServiceStart": arrival["timeWindow"]["end"],
                                "lateMinutes": checks.minute(arrival["serviceStartTime"]) - checks.minute(arrival["timeWindow"]["end"]),
                                "message": "服务开始时间已超过门店时间窗。"})
    if not unload["valid"]:
        reasons.append({"type": "unloading_blocked", **unload["firstFailure"]})
    executable = not reasons
    return {"planId": plan_id, "scenarioId": scenario["scenarioId"], "vehicleId": vehicle["vehicleId"], **route,
            "cargoIds": sorted(c["cargoId"] for c in scoped["cargo"]), "loadingCheck": geometry,
            "loadingPathCheck": {"checked": True, "valid": load_error is None, "reason": load_error},
            "unloadingCheck": {"checked": True, "valid": unload["valid"], "firstFailure": unload["firstFailure"]},
            "feasibility": {"executable": executable, "scope": "仅限场景声明的几何、支撑、重量、时间窗和后门直线装卸规则。",
                            "reasons": reasons, "uncheckedConstraints": scenario["uncheckedConstraints"]},
            "placements": {"planId": plan_id, "vehicleId": vehicle["vehicleId"], "positions": layout}, "unloading": unload}


def delta(before, after):
    return {"direction": "candidate-minus-baseline", "distanceKm": round(after["distanceKm"] - before["distanceKm"], 3),
            "totalCost": round(after["costs"]["totalCost"] - before["costs"]["totalCost"], 2),
            "drivingMinutes": after["drivingMinutes"] - before["drivingMinutes"],
            "totalDurationMinutes": after["totalDurationMinutes"] - before["totalDurationMinutes"]}


def layout_changes(before, after):
    previous = {p["cargoId"]: p for p in before}
    changes = []
    for p in after:
        old = previous.get(p["cargoId"])
        fields = ("x", "y", "z", "rotation", "vehicleId")
        if old is None or any(old[k] != p[k] for k in fields):
            changes.append({"cargoId": p["cargoId"], "from": {k: old[k] for k in fields} if old else None,
                            "to": {k: p[k] for k in fields}})
    return changes


def revise_order(request):
    allowed = {"scenarioId", "basePlanId", "stopOrder", "allowLayoutRepair", "departureTime"}
    if not isinstance(request, dict) or set(request) - allowed:
        raise ValueError("请求包含不支持的字段。")
    scenario = read_v1("scenario.json")
    if request.get("scenarioId") != scenario["scenarioId"]:
        raise ValueError("仅支持 city-delivery-synthetic-001 的门店顺序调整。")
    base_id = request.get("basePlanId")
    source = next((p for p in read_v1("placements.json")["plans"] if p["planId"] == base_id), None)
    base_plan = next((p for p in read_v1("plans.json")["plans"] if p["planId"] == base_id), None)
    if not source or not base_plan:
        raise ValueError("basePlanId 必须为 PLAN_A 或 PLAN_B。")
    order = request.get("stopOrder")
    validate_order(order, [s["stopId"] for s in scenario["stops"]])
    if not isinstance(request.get("allowLayoutRepair", True), bool):
        raise ValueError("allowLayoutRepair 必须为 true 或 false。")
    if "departureTime" in request:
        validate_time(request["departureTime"])
        scenario["departureTime"] = request["departureTime"]
    plan_id = "ORDER-" + identity(request)
    before = assess(scenario, scenario["vehicles"][0], order, source["positions"], plan_id)
    result = before
    repair_attempts = 0
    layout_reusable = before["loadingCheck"]["valid"] and before["loadingPathCheck"]["valid"] and before["unloadingCheck"]["valid"]
    decision = "reused" if layout_reusable else "not_repaired"
    # The bounded repair keeps each stop's x/y/orientation and internal stack
    # unchanged. It searches assignments to the four existing row slots only.
    # The objective is fewest relocated cargo, then minimum z displacement.
    if before["loadingCheck"]["valid"] and not before["unloadingCheck"]["valid"] and request.get("allowLayoutRepair", True):
        stop_ids = [s["stopId"] for s in scenario["stops"]]
        row_start = {sid: min(p["z"] for p in source["positions"] if p["stopId"] == sid) for sid in stop_ids}
        slots = sorted(row_start.values())
        candidates = []
        for front_to_rear in itertools.permutations(stop_ids):
            layout = copy.deepcopy(source["positions"])
            assignments = {sid: slots[i] for i, sid in enumerate(front_to_rear)}
            for p in layout:
                p["z"] = round(p["z"] + assignments[p["stopId"]] - row_start[p["stopId"]], 6)
            moved = layout_changes(source["positions"], layout)
            candidates.append((len(moved), sum(abs(p["to"]["z"] - p["from"]["z"]) for p in moved), layout))
        for _, _, layout in sorted(candidates, key=lambda c: c[:2]):
            repair_attempts += 1
            candidate = assess(scenario, scenario["vehicles"][0], order, layout, plan_id)
            # Repair layout independently of time windows, so late arrivals are
            # still reported even when the cargo obstruction has been removed.
            if candidate["loadingCheck"]["valid"] and candidate["loadingPathCheck"]["valid"] and candidate["unloadingCheck"]["valid"]:
                result, decision = candidate, "revised"
                break
    changed = layout_changes(source["positions"], result["placements"]["positions"])
    return {"schemaVersion": VERSION, "scenarioId": scenario["scenarioId"], "planId": plan_id,
            "executionMode": "computed-per-request", "precomputedOnly": False, "request": request,
            "scenario": scenario, "source": scenario["source"],
            "originalLayoutCheck": before, "originalLayoutReusable": layout_reusable,
            "revision": {"status": decision, "method": "whole-stop-row-relocation", "attemptedLayouts": repair_attempts,
                         "objective": "fewest relocated cargo then smallest total z movement", "globallyOptimal": False,
                         "changedCargoIds": [c["cargoId"] for c in changed], "changes": changed,
                         "requiresReloadBeforeDispatch": bool(changed), "enRouteRepackingSupported": False,
                         "reloadingCostIncluded": False,
                         "costBoundary": "仅调整发车前拟定布局。费用仍按场景提供的车辆、行驶和等待规则计算，不含未提供的重装工时费；不能直接用于已发车车辆。"},
            "result": result, "executable": result["feasibility"]["executable"],
            "comparison": {"basePlanId": base_id, "delta": delta(base_plan, result), "sameOrders": True, "sameVehicle": True,
                           "sameCostRules": True, "baseDepartureTime": read_v1("scenario.json")["departureTime"],
                           "candidateDepartureTime": scenario["departureTime"], "costSavingClaim": False},
            "unsupported": scenario["uncheckedConstraints"] + ["在途自动重装", "任意货箱尺寸编辑", "额外搬运", "全局最优联合求解"]}


def make_fleet_scenario():
    scenario = read_v1("scenario.json")
    scenario.update({"schemaVersion": VERSION, "scenarioId": FLEET_ID, "name": "一仓九店三车 · 可干预配送演示"})
    scenario["source"] = {**scenario["source"], "name": "Synthetic Mechanism Case · 九店三种车厢",
                          "description": "独立构造的多车辆机制演示，不是传化企业数据，不改变 v1。"}
    palette = ["#57B8F2", "#C2A3EE", "#E7AC66", "#65CEAB", "#EF8197", "#8EC86F", "#7ABED0", "#AF99D6", "#E3C174"]
    places = [(1, 1), (2, 1), (1, 2), (4, 1), (5, 2), (4, 3), (1, 5), (3, 5), (5, 5)]
    stops, cargo = [], []
    for i, (x, y) in enumerate(places):
        sid = f"S{i + 1:02d}"
        stops.append({"stopId": sid, "name": f"配送门店 {i + 1:02d}", "x": x, "y": y, "color": palette[i],
                      "address": "合成街区位置", "timeWindow": {"start": "08:00", "end": "09:20" if i < 3 else "10:00"},
                      "serviceDurationMinutes": 6})
        length, width = (.8, .8) if i < 3 else (1.05, .85) if i < 8 else (1.4, 1.1)
        for j in range(4):
            upper = j >= 2
            cargo.append({"cargoId": f"C{i + 1:02d}-{j + 1:02d}", "stopId": sid, "name": "易碎补货箱" if upper else "承托补货箱",
                          "length": round(length - (.08 if upper else 0), 3), "width": round(width - (.06 if upper else 0), 3),
                          "height": .4 if upper else .5, "weightKg": 10 + i if upper else 35 + i,
                          "fragile": upper, "maxTopLoadKg": 0 if upper else 60,
                          "orientation": {"uprightOnly": True, "allowedYawDegrees": [0, 90]},
                          "handlingRequirements": ["保持直立", "上方不得堆货" if upper else "上方承重不超过 60 kg"], "color": palette[i]})
    vehicles = []
    for vid, name, length, width, height, payload, fixed, per_km in [
        ("V01", "小型厢式配送车", 3.05, 2.1, 1.85, 400, 110, 2.2),
        ("V02", "中型厢式配送车", 4.6, 2.2, 2.1, 650, 150, 2.8),
        ("V03", "宽厢配送车", 5.8, 2.6, 2.4, 1000, 180, 3.5),
    ]:
        vehicles.append({"vehicleId": vid, "name": name, "resourceType": "vehicle", "modelType": "synthetic-city-box-van",
                         "realVehicleModelClaim": False, "maxPayloadKg": payload,
                         "compartment": {"length": length, "width": width, "height": height},
                         "rearDoor": {"axis": "z", "position": length, "xMin": 0, "xMax": width, "yMin": 0, "yMax": height,
                                      "opening": "full-compartment-cross-section"},
                         "costs": {"vehicleFixedCost": fixed, "drivingCostPerKm": per_km}})
    scenario.update({"stops": stops, "cargo": cargo, "vehicles": vehicles})
    nodes = [scenario["warehouse"], *stops]
    distances = [[abs(a["x"] - b["x"]) + abs(a["y"] - b["y"]) for b in nodes] for a in nodes]
    scenario["routing"].update({"nodeIds": [n["stopId"] for n in nodes], "distanceMatrixKm": distances,
                                "travelTimeMatrixMinutes": [[2 * d for d in row] for row in distances]})
    scenario["packingMethod"] = {"name": "two-lane-two-level-stop-shelves", "marginM": .1, "rowGapM": .15,
                                  "description": "每站两件承托箱与两件易碎上层箱。检查朝向、两列宽度、承托面积后排入车厢；先送门店靠近后门。",
                                  "limitation": "保守的整站货架分区，不代表所有自由摆放方式；失败只表示该方法未找到可行布局。"}
    return scenario


def row_layout(scenario, vehicle, sid):
    """Choose actual orientation and supported geometry for one stop shelf."""
    cargo = sorted((c for c in scenario["cargo"] if c["stopId"] == sid), key=lambda c: c["cargoId"])
    if len(cargo) != 4 or [c["fragile"] for c in cargo] != [False, False, True, True]:
        return None
    W, H = vehicle["compartment"]["width"], vehicle["compartment"]["height"]
    candidates = []
    def oriented(c, yaw):
        return (c["width"], c["length"]) if yaw % 180 == 90 else (c["length"], c["width"])
    for rotations in itertools.product(*(c["orientation"]["allowedYawDegrees"] for c in cargo)):
        dims = [oriented(c, r) for c, r in zip(cargo, rotations)]
        if dims[0][1] + dims[1][1] + .3 > W + 1e-7:
            continue
        if any(dims[i + 2][0] > dims[i][0] + 1e-7 or dims[i + 2][1] > dims[i][1] + 1e-7 or cargo[i]["height"] + cargo[i + 2]["height"] > H + 1e-7 for i in range(2)):
            continue
        positions = []
        span = max(dims[0][0], dims[1][0])
        for i, c in enumerate(cargo):
            lane, upper = i % 2, i >= 2
            base_length, base_width = dims[lane]
            length, width = dims[i]
            positions.append({"cargoId": c["cargoId"], "stopId": sid, "vehicleId": vehicle["vehicleId"],
                              "x": round(.1 + (dims[0][1] + .1 if lane else 0) + ((base_width - width) / 2 if upper else 0), 6),
                              "y": cargo[lane]["height"] if upper else 0,
                              "z": round((base_length - length) / 2 if upper else 0, 6),
                              "length": length, "width": width, "height": c["height"], "rotation": rotations[i],
                              "rotationUnit": "degrees", "dimensionsBasis": "oriented-axis-aligned"})
        candidates.append((span, rotations, positions))
    return min(candidates, key=lambda c: c[:2]) if candidates else None


def pack(scenario, vehicle, order):
    rows = []
    for sid in reversed(order):
        row = row_layout(scenario, vehicle, sid)
        if not row:
            bottoms = sorted((c for c in scenario["cargo"] if c["stopId"] == sid and not c["fragile"]), key=lambda c: c["cargoId"])
            minimum_width = .3 + sum(min(c["length"] if yaw % 180 == 90 else c["width"]
                                       for yaw in c["orientation"]["allowedYawDegrees"]) for c in bottoms)
            width_failure = minimum_width > vehicle["compartment"]["width"] + 1e-7
            return None, {"type": "stop_geometry", "vehicleId": vehicle["vehicleId"], "stopId": sid,
                          "cargoIds": [c["cargoId"] for c in scenario["cargo"] if c["stopId"] == sid],
                          "dimension": "width" if width_failure else "height-or-support",
                          "minimumTwoLaneWidthM": round(minimum_width, 4), "availableWidthM": vehicle["compartment"]["width"],
                          "message": f"整站两列布局至少需要 {minimum_width:.2f} m 宽度，本车只有 {vehicle['compartment']['width']:.2f} m，需换车或改变分配。" if width_failure else
                                     "本车高度或货箱支撑不满足整站两列布局，需换车或改变分配。", "proofScope": "declared-shelf-method-only"}
        rows.append(row)
    needed = .2 + sum(row[0] for row in rows) + .15 * max(0, len(rows) - 1)
    if needed > vehicle["compartment"]["length"] + 1e-7:
        return None, {"type": "shelf_length", "vehicleId": vehicle["vehicleId"], "stopIds": order,
                      "requiredLengthM": round(needed, 4), "availableLengthM": vehicle["compartment"]["length"],
                      "message": "按当前整站分区摆放，车厢长度不足；需把门店移交其他车辆。", "proofScope": "declared-shelf-method-only"}
    positions, z = [], .1
    for span, _, row in rows:
        for p in row:
            p = copy.deepcopy(p)
            p["z"] = round(p["z"] + z, 6)
            positions.append(p)
        z += span + .15
    return sorted(positions, key=lambda p: p["cargoId"]), None


def validate_fleet_routes(scenario, routes):
    if not isinstance(routes, list) or len(routes) > len(scenario["vehicles"]):
        raise ValueError("routes 必须是每辆车的门店顺序列表。")
    seen_vehicles, visited = [], []
    for route in routes:
        if not isinstance(route, dict) or set(route) != {"vehicleId", "stopOrder"}:
            raise ValueError("每条路线仅包含 vehicleId 和 stopOrder。")
        if route["vehicleId"] not in {v["vehicleId"] for v in scenario["vehicles"]}:
            raise ValueError("未知车辆。")
        seen_vehicles.append(route["vehicleId"])
        if not isinstance(route["stopOrder"], list) or any(not isinstance(s, str) for s in route["stopOrder"]):
            raise ValueError("stopOrder 必须为门店编号列表。")
        visited += route["stopOrder"]
    if len(seen_vehicles) != len(set(seen_vehicles)):
        raise ValueError("同一车辆不得提交两条路线。")
    validate_order(visited, [s["stopId"] for s in scenario["stops"]])


def fleet_plan(scenario, routes, plan_id):
    validate_fleet_routes(scenario, routes)
    vehicles = {v["vehicleId"]: v for v in scenario["vehicles"]}
    results, failures, assignments = [], [], []
    routes_by_vehicle = {route["vehicleId"]: route for route in routes}
    for vid, vehicle in vehicles.items():
        route = routes_by_vehicle.get(vid, {"vehicleId": vid, "stopOrder": []})
        order = route["stopOrder"]
        if not order:
            idle = assess(scenario, vehicle, [], [], plan_id)
            idle.update({"status": "idle", "active": False, "routeNodeIds": ["DEPOT"], "legs": []})
            idle["costs"].update({"vehicleCount": 0, "vehicleFixedCost": 0, "totalCost": 0})
            results.append(idle)
            continue
        positions, error = pack(scenario, vehicles[vid], order)
        for sid in order:
            assignments.append({"stopId": sid, "vehicleId": vid, "cargoIds": sorted(c["cargoId"] for c in scenario["cargo"] if c["stopId"] == sid)})
        if error:
            failures.append(error)
            scoped = scoped_scenario(scenario, vehicles[vid], order)
            route_result = checks.route_result(scoped, order)
            total_weight = sum(c["weightKg"] for c in scoped["cargo"])
            partial_checks = {"weight": {"checked": True, "valid": total_weight <= vehicles[vid]["maxPayloadKg"],
                                          "totalWeightKg": total_weight, "maxPayloadKg": vehicles[vid]["maxPayloadKg"]},
                              "timeWindows": route_result["timeWindowCheck"]}
            vehicle_reasons = [error]
            if not partial_checks["weight"]["valid"]:
                vehicle_reasons.append({"type": "weight", "vehicleId": vid, "message": "提交分配超过本车最大载重。"})
            if not partial_checks["timeWindows"]["valid"]:
                vehicle_reasons.extend({"type": "time_window", "vehicleId": vid, "stopId": a["stopId"],
                                        "serviceStartTime": a["serviceStartTime"], "latestServiceStart": a["timeWindow"]["end"],
                                        "message": "服务开始时间超过门店时间窗。"}
                                       for a in route_result["arrivals"] if not a["timeWindowValid"])
            failures.extend(vehicle_reasons[1:])
            results.append({"planId": plan_id, "scenarioId": scenario["scenarioId"], "vehicleId": vid, **route_result,
                            "status": "infeasible", "active": True, "placements": None, "unloading": None,
                            "loadingCheck": {"checked": False, "valid": False, "reason": error},
                            "partialChecks": partial_checks,
                            "unloadingCheck": {"checked": False, "valid": False},
                            "feasibility": {"executable": False, "reasons": vehicle_reasons}})
        else:
            result = assess(scenario, vehicles[vid], order, positions, plan_id)
            result.update({"status": "scheduled" if result["feasibility"]["executable"] else "infeasible", "active": True})
            results.append(result)
            failures.extend(result["feasibility"]["reasons"])
    cargo_ids = [cid for assignment in assignments for cid in assignment["cargoIds"]]
    expected = {c["cargoId"] for c in scenario["cargo"]}
    unique = len(cargo_ids) == len(set(cargo_ids)) and set(cargo_ids) == expected
    totals = {"vehicleCount": sum(r["active"] for r in results), "distanceKm": sum(r["distanceKm"] for r in results),
              "drivingMinutes": sum(r["drivingMinutes"] for r in results),
              "totalDurationMinutes": max((r["totalDurationMinutes"] for r in results), default=0),
              "currency": "CNY", "vehicleFixedCost": round(sum(r["costs"]["vehicleFixedCost"] for r in results), 2),
              "drivingCost": round(sum(r["costs"]["drivingCost"] for r in results), 2),
              "extraHandlingMoves": 0, "extraHandlingCost": 0,
              "totalCost": round(sum(r["costs"]["totalCost"] for r in results), 2)}
    return {"planId": plan_id, "scenarioId": scenario["scenarioId"], "routes": results,
            "assignments": assignments, "assignmentCheck": {"checked": True, "everyStopServedOnce": True, "everyCargoAssignedOnce": unique},
            "totals": totals, "feasibility": {"executable": unique and not failures, "reasons": failures,
                                             "uncheckedConstraints": scenario["uncheckedConstraints"]},
            "globallyOptimal": False}


def solve_routes(scenario):
    """OR-Tools chooses route/vehicle assignment; geometry is checked afterward."""
    from ortools.constraint_solver import pywrapcp, routing_enums_pb2
    ids = scenario["routing"]["nodeIds"]
    vehicles = scenario["vehicles"]
    manager = pywrapcp.RoutingIndexManager(len(ids), len(vehicles), 0)
    routing = pywrapcp.RoutingModel(manager)
    keep_callbacks = []
    def cost_callback(per_km):
        def callback(a, b):
            return round(scenario["routing"]["distanceMatrixKm"][manager.IndexToNode(a)][manager.IndexToNode(b)] * per_km * 100)
        keep_callbacks.append(callback)
        return routing.RegisterTransitCallback(callback)
    for i, vehicle in enumerate(vehicles):
        routing.SetArcCostEvaluatorOfVehicle(cost_callback(vehicle["costs"]["drivingCostPerKm"]), i)
        routing.SetFixedCostOfVehicle(round(vehicle["costs"]["vehicleFixedCost"] * 100), i)
    weights = {s["stopId"]: sum(c["weightKg"] for c in scenario["cargo"] if c["stopId"] == s["stopId"]) for s in scenario["stops"]}
    demand = routing.RegisterUnaryTransitCallback(lambda idx: weights.get(ids[manager.IndexToNode(idx)], 0))
    routing.AddDimensionWithVehicleCapacity(demand, 0, [v["maxPayloadKg"] for v in vehicles], True, "Payload")
    rows = {(sid, i): row_layout(scenario, v, sid) for sid in ids[1:] for i, v in enumerate(vehicles)}
    row_callbacks = []
    for i, _ in enumerate(vehicles):
        def row_demand(idx, i=i):
            node = ids[manager.IndexToNode(idx)]
            row = rows.get((node, i))
            return round((row[0] + .15) * 1000) if row else 0
        row_callbacks.append(row_demand)
    routing.AddDimensionWithVehicleTransitAndCapacity([routing.RegisterUnaryTransitCallback(cb) for cb in row_callbacks], 0,
                                                      [round((v["compartment"]["length"] - .05) * 1000) for v in vehicles], True, "ShelfLength")
    for sid in ids[1:]:
        eligible = []
        for i, vehicle in enumerate(vehicles):
            layout, error = pack(scenario, vehicle, [sid])
            if error is None and checks.geometry(scoped_scenario(scenario, vehicle, [sid]), layout)["valid"]:
                eligible.append(i)
        if not eligible:
            return None, {"type": "no_vehicle_fits_stop", "stopId": sid, "message": "没有车辆能通过本店货物的实际空间检查。"}
        routing.SetAllowedVehiclesForIndex(eligible, manager.NodeToIndex(ids.index(sid)))
    service = {s["stopId"]: s["serviceDurationMinutes"] for s in scenario["stops"]}
    transit = routing.RegisterTransitCallback(lambda a, b: scenario["routing"]["travelTimeMatrixMinutes"][manager.IndexToNode(a)][manager.IndexToNode(b)] + service.get(ids[manager.IndexToNode(a)], 0))
    routing.AddDimension(transit, 180, 240, True, "Time")
    time_dim = routing.GetDimensionOrDie("Time")
    start = checks.minute(scenario["departureTime"])
    for stop in scenario["stops"]:
        low, high = max(0, checks.minute(stop["timeWindow"]["start"]) - start), checks.minute(stop["timeWindow"]["end"]) - start
        if high < low:
            return None, {"type": "time_window", "stopId": stop["stopId"], "message": "出发时已超过门店最晚服务时间。"}
        time_dim.CumulVar(manager.NodeToIndex(ids.index(stop["stopId"]))).SetRange(low, high)
    parameters = pywrapcp.DefaultRoutingSearchParameters()
    parameters.first_solution_strategy = routing_enums_pb2.FirstSolutionStrategy.PARALLEL_CHEAPEST_INSERTION
    parameters.local_search_metaheuristic = routing_enums_pb2.LocalSearchMetaheuristic.GREEDY_DESCENT
    parameters.time_limit.seconds = 2
    solution = routing.SolveWithParameters(parameters)
    if not solution:
        return None, {"type": "no_route_found", "message": "在本次有限搜索及分区装载规则下未找到可执行分配，不证明所有摆放方法均不可行。"}
    routes = []
    for i, vehicle in enumerate(vehicles):
        index, order = routing.Start(i), []
        while not routing.IsEnd(index):
            node = manager.IndexToNode(index)
            if node:
                order.append(ids[node])
            index = solution.Value(routing.NextVar(index))
        routes.append({"vehicleId": vehicle["vehicleId"], "stopOrder": order})
    return routes, None


def revise_fleet(request):
    if not isinstance(request, dict) or set(request) - {"scenarioId", "routes", "allowReassignment"}:
        raise ValueError("请求包含不支持的字段。")
    scenario = json.loads((V2 / "scenario.json").read_text())
    if request.get("scenarioId") != scenario["scenarioId"]:
        raise ValueError("多车接口只支持独立的九店三车场景。")
    if not isinstance(request.get("allowReassignment", False), bool):
        raise ValueError("allowReassignment 必须为 true 或 false。")
    submitted = fleet_plan(scenario, request.get("routes"), "SUBMITTED-" + identity(request))
    result, solver_error = submitted, None
    reallocated = False
    if not submitted["feasibility"]["executable"] and request.get("allowReassignment", False):
        routes, solver_error = solve_routes(scenario)
        if routes is not None:
            result = fleet_plan(scenario, routes, "REVISED-" + identity(request))
            reallocated = True
    return {"schemaVersion": VERSION, "scenarioId": scenario["scenarioId"], "executionMode": "computed-per-request",
            "source": scenario["source"], "request": request, "submittedCheck": submitted,
            "result": result, "executable": result["feasibility"]["executable"],
            "revision": {"reassignmentAllowed": request.get("allowReassignment", False), "reallocated": reallocated,
                         "method": "OR-Tools constrained routing + explicitly validated stop shelves" if reallocated else "validated stop shelf layout for submitted routes",
                         "reason": solver_error, "requiresReloadBeforeDispatch": True, "preservesSubmittedOrderWhenReallocating": False},
            "delta": {key: round(result["totals"][key] - submitted["totals"][key], 3) for key in
                      ("distanceKm", "totalCost", "vehicleCount", "drivingMinutes", "totalDurationMinutes")},
            "comparisonBoundary": "提交分配不可执行时，它的费用仅是名义值；允许重新分配后可能改变车辆与访问顺序。",
            "globallyOptimal": False}
