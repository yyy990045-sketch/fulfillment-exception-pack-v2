#!/usr/bin/env python3
"""Build/recheck the bounded synthetic city-delivery case. Python stdlib only.

No search for a globally optimal plan. Every exported check is recomputed from
geometry, route matrices and the explicitly declared unloading model.
"""
import argparse
import copy
import hashlib
import json
import math
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "frontend/public/demo/city-delivery/v1"
SCENARIO_ID = "city-delivery-synthetic-001"
VERSION = "1.0.0"
EPS = 1e-7
FILES = ("scenario.json", "plans.json", "placements.json", "unloading-steps.json", "comparison.json")
SOURCE = {
    "dataType": "synthetic",
    "name": "Synthetic Mechanism Case · 一仓四店配载与卸货",
    "description": "本项目构造的机制演示场景，不是传化真实订单、药店现场数据或公开基准结果。",
    "license": "project-owned-synthetic",
    "authorization": "本次任务授权构造并在项目内使用；不含第三方数据，外部分发由项目 Owner 决定。",
    "publicBenchmarkUsed": False,
    "enterpriseDataUsed": False,
}


def envelope(**values):
    return {"schemaVersion": VERSION, "scenarioId": SCENARIO_ID, **values}


def clock(minutes):
    return f"{int(minutes) // 60:02d}:{int(minutes) % 60:02d}"


def minute(value):
    h, m = value.split(":")
    return int(h) * 60 + int(m)


def overlap(a0, a1, b0, b1):
    return min(a1, b1) - max(a0, b0) > EPS


def box(p):
    return (p["x"], p["x"] + p["width"], p["y"], p["y"] + p["height"], p["z"], p["z"] + p["length"])


def intersect(a, b, axes=(0, 2, 4)):
    return all(overlap(a[k], a[k + 1], b[k], b[k + 1]) for k in axes)


def footprint_intersection(a, b):
    aa, bb = box(a), box(b)
    return max(0, min(aa[1], bb[1]) - max(aa[0], bb[0])) * max(0, min(aa[5], bb[5]) - max(aa[4], bb[4]))


def union_area(rectangles):
    """Exact axis-aligned footprint union; touching edges have zero area."""
    xs = sorted({x for r in rectangles for x in r[:2]})
    area = 0
    for left, right in zip(xs, xs[1:]):
        intervals = sorted((r[2], r[3]) for r in rectangles if r[0] < right - EPS and r[1] > left + EPS)
        if not intervals:
            continue
        start, end = intervals[0]
        covered = 0
        for low, high in intervals[1:]:
            if low <= end + EPS:
                end = max(end, high)
            else:
                covered += end - start
                start, end = low, high
        area += (covered + end - start) * (right - left)
    return area


def make_scenario():
    warehouse = {"stopId": "DEPOT", "name": "城市配送中心仓", "x": 0, "y": 0}
    specs = [("S01", "东城店", 1, 1, "08:05", "09:05", "#57B8F2"),
             ("S02", "河畔店", 3, 1, "08:00", "09:00", "#C2A3EE"),
             ("S03", "南苑店", 3, 3, "08:10", "09:30", "#E7AC66"),
             ("S04", "西桥店", 1, 3, "08:15", "09:20", "#65CEAB")]
    stops = [{"stopId": sid, "name": name, "x": x, "y": y, "color": color,
              "timeWindow": {"start": start, "end": end}, "serviceDurationMinutes": 6,
              "address": "合成街区位置，非真实门店地址"} for sid, name, x, y, start, end, color in specs]
    cargo = []
    for stop_index, stop in enumerate(stops):
        for slot in range(4):
            top = slot >= 2
            rotated = slot % 2 == 1
            length, width, height = (0.95, 0.82, 0.5) if top else (1.1, 0.9, 0.55)
            if rotated:
                length, width = width, length
            cargo.append({"cargoId": f"C{stop_index + 1:02d}-{slot + 1:02d}", "stopId": stop["stopId"],
                          "name": "易碎补货箱" if top else "常规补货箱", "length": length, "width": width,
                          "height": height, "weightKg": (8 if top else 28) + stop_index,
                          "fragile": top, "maxTopLoadKg": 0 if top else 40,
                          "orientation": {"uprightOnly": True, "allowedYawDegrees": [0, 90]},
                          "handlingRequirements": ["保持直立", "禁止上方堆货" if top else "最大上方承重 40 kg"],
                          "color": stop["color"]})
    nodes = [warehouse, *stops]
    distances = [[abs(a["x"] - b["x"]) + abs(a["y"] - b["y"]) for b in nodes] for a in nodes]
    return envelope(
        name="一仓四店 · 路线与装卸协同演示", source=SOURCE, warehouse=warehouse, stops=stops,
        coordinateSystem={"units": "m", "origin": "车厢前壁左下角", "position": "minimum-corner",
                          "x": "车厢宽度方向", "y": "竖直向上", "z": "前壁到后门方向",
                          "lengthAxis": "z", "widthAxis": "x", "heightAxis": "y",
                          "rotation": "rotation 为绕 y 轴的角度，单位 degrees；禁止俯仰或侧翻。"},
        vehicles=[{"vehicleId": "V01", "name": "厢式配送车 01", "resourceType": "vehicle",
                   "modelType": "synthetic-city-box-van", "realVehicleModelClaim": False,
                   "maxPayloadKg": 1500, "compartment": {"length": 5.8, "width": 2.2, "height": 2.2},
                   "rearDoor": {"axis": "z", "position": 5.8, "xMin": 0, "xMax": 2.2,
                                "yMin": 0, "yMax": 2.2, "opening": "full-compartment-cross-section"}}],
        cargo=cargo, departureTime="08:00", timezone="Asia/Shanghai", serviceDate=None,
        routing={"nodeIds": [n["stopId"] for n in nodes], "distanceMatrixKm": distances,
                 "travelTimeMatrixMinutes": [[2 * d for d in row] for row in distances],
                 "distanceRule": "合成正交街区曼哈顿距离；坐标单位 km，非真实道路距离。",
                 "travelTimeRule": "固定 30 km/h，即每公里 2 分钟；不含实时交通。",
                 "returnToDepot": True, "timeWindowRule": "服务开始必须处于时间窗内；早到等待；结束时间单独记录。"},
        costs={"currency": "CNY", "vehicleFixedCost": 180, "drivingCostPerKm": 3.5,
               "extraHandlingCostPerCargoMove": 5,
               "extraHandlingCountRule": "一件货移出并重新装回计 2 次；本场景不允许额外搬运。",
               "waitingCostPerMinute": 0, "costSource": "演示假设，不是企业报价"},
        rules={"extraction": "rear-door-straight-positive-z", "allowExtraHandling": False,
               "extractionDescription": "货物保持 x、y 和朝向，沿 +z 平移到后门外；不得穿过任何剩余货物。先卸去上方承托的货物。",
               "minimumSupportRatio": 1.0, "supportRule": "放在地板上，或底面得到同高货物 100% 支撑。",
               "fragileRule": "易碎货物上方不得承托任何货物。",
               "loadBearingRule": "上方传递重量按接触面积分配，不超过 maxTopLoadKg。",
               "loadingRule": "从后门沿 -z 直线进入最终位置；底层先装，同一门店前排先装。",
               "unloadingSelection": "当前门店中先选择无阻挡的货物；同层按 cargoId 排序，上层优先。"},
        uncheckedConstraints=["轴荷与车辆重心", "车辆行驶稳定性及货物绑扎", "装卸工具及人员活动空间",
                              "冷链与品类隔离", "真实交通和司机工时", "任意旋转或侧门取货", "全局最优性"],
    )


def make_positions(scenario, plan_id, front_to_rear):
    cargo = scenario["cargo"]
    positions = []
    for c in cargo:
        slot = int(c["cargoId"][-2:]) - 1
        top, lane = slot >= 2, slot % 2
        row = front_to_rear.index(c["stopId"])
        yaw = 90 if lane else 0
        length = c["width"] if yaw == 90 else c["length"]
        width = c["length"] if yaw == 90 else c["width"]
        positions.append({"cargoId": c["cargoId"], "stopId": c["stopId"], "vehicleId": "V01",
                          "x": round(0.12 + lane * 1.06 + (0.04 if top else 0), 4),
                          "y": 0.55 if top else 0, "z": round(0.2 + row * 1.35 + (0.075 if top else 0), 4),
                          "length": length, "width": width, "height": c["height"], "rotation": yaw,
                          "rotationUnit": "degrees", "dimensionsBasis": "oriented-axis-aligned",
                          "stacking": {"layer": 2 if top else 1}})
    return {"planId": plan_id, "vehicleId": "V01", "positions": positions}


def geometry(scenario, positions):
    cargo = {c["cargoId"]: c for c in scenario["cargo"]}
    vehicle = scenario["vehicles"][0]
    dims = vehicle["compartment"]
    all_ids = [p["cargoId"] for p in positions]
    if len(all_ids) != len(set(all_ids)) or set(all_ids) != set(cargo):
        raise ValueError("Cargo identity mismatch or duplicate")
    details, supports = {}, {}
    for p in positions:
        c, bb = cargo[p["cargoId"]], box(p)
        bounds = all(math.isfinite(v) for v in bb) and all(p[k] > 0 for k in ("length", "width", "height"))
        bounds = bounds and all(v >= -EPS for v in (p["x"], p["y"], p["z"]))
        bounds = bounds and bb[1] <= dims["width"] + EPS and bb[3] <= dims["height"] + EPS and bb[5] <= dims["length"] + EPS
        collisions = [q["cargoId"] for q in positions if q is not p and intersect(bb, box(q))]
        expected = (c["width"], c["length"]) if p["rotation"] % 180 == 90 else (c["length"], c["width"])
        orientation = p["rotation"] in c["orientation"]["allowedYawDegrees"] and abs(p["height"] - c["height"]) < EPS
        orientation = orientation and abs(p["length"] - expected[0]) < EPS and abs(p["width"] - expected[1]) < EPS
        support_candidates = [q for q in positions if q is not p and abs(q["y"] + q["height"] - p["y"]) < EPS and footprint_intersection(p, q) > EPS]
        rectangles = [(max(p["x"], q["x"]), min(bb[1], q["x"] + q["width"]),
                       max(p["z"], q["z"]), min(bb[5], q["z"] + q["length"])) for q in support_candidates]
        supported_area = p["length"] * p["width"] if abs(p["y"]) < EPS else union_area(rectangles)
        ratio = min(1, supported_area / (p["length"] * p["width"]))
        supports[p["cargoId"]] = [(q["cargoId"], footprint_intersection(p, q)) for q in support_candidates]
        details[p["cargoId"]] = {"boundaryValid": bounds, "collisionFree": not collisions,
                                  "overlappingCargoIds": collisions, "orientationValid": orientation,
                                  "support": {"type": "floor" if abs(p["y"]) < EPS else "cargo",
                                              "supportingCargoIds": [q["cargoId"] for q in support_candidates],
                                              "supportRatio": round(ratio, 6),
                                              "minimumSupportRatio": scenario["rules"]["minimumSupportRatio"],
                                              "valid": ratio + EPS >= scenario["rules"]["minimumSupportRatio"]}}
    above_weight = {cid: 0.0 for cid in cargo}
    for p in sorted(positions, key=lambda p: -p["y"]):
        cid = p["cargoId"]
        area = sum(a for _, a in supports[cid])
        for base_id, contact in supports[cid]:
            above_weight[base_id] += (cargo[cid]["weightKg"] + above_weight[cid]) * contact / area
    for cid, d in details.items():
        children = [upper for upper, bases in supports.items() if any(base == cid for base, _ in bases)]
        d.update({"fragileValid": not cargo[cid]["fragile"] or not children,
                  "supportedCargoIds": children, "topLoadKg": round(above_weight[cid], 4),
                  "maxTopLoadKg": cargo[cid]["maxTopLoadKg"],
                  "loadBearingValid": above_weight[cid] <= cargo[cid]["maxTopLoadKg"] + EPS})
        d["valid"] = all(d[k] for k in ("boundaryValid", "collisionFree", "orientationValid", "fragileValid", "loadBearingValid")) and d["support"]["valid"]
    weight = sum(c["weightKg"] for c in cargo.values())
    checks = {
        "boundary": all(d["boundaryValid"] for d in details.values()),
        "collision": all(d["collisionFree"] for d in details.values()),
        "weight": weight <= vehicle["maxPayloadKg"],
        "orientation": all(d["orientationValid"] for d in details.values()),
        "fragile": all(d["fragileValid"] for d in details.values()),
        "support": all(d["support"]["valid"] for d in details.values()),
        "loadBearing": all(d["loadBearingValid"] for d in details.values()),
    }
    return {"checked": True, "valid": all(checks.values()), "checks": {k: {"checked": True, "valid": v} for k, v in checks.items()},
            "totalWeightKg": weight, "maxPayloadKg": vehicle["maxPayloadKg"],
            "totalCargoVolumeM3": round(sum(c["length"] * c["width"] * c["height"] for c in cargo.values()), 6),
            "compartmentVolumeM3": round(dims["length"] * dims["width"] * dims["height"], 6),
            "cargoChecks": details}


def obstruction(scenario, target, remaining, details):
    door = scenario["vehicles"][0]["rearDoor"]
    bb = box(target)
    blocking = [q["cargoId"] for q in remaining if q["cargoId"] != target["cargoId"]
                and intersect(bb, box(q), axes=(0, 2)) and q["z"] + q["length"] > target["z"] + EPS]
    supported = [cid for cid in details[target["cargoId"]]["supportedCargoIds"] if any(q["cargoId"] == cid for q in remaining)]
    door_valid = bb[0] >= door["xMin"] - EPS and bb[1] <= door["xMax"] + EPS and bb[2] >= door["yMin"] - EPS and bb[3] <= door["yMax"] + EPS
    return {"cargoId": target["cargoId"], "stopId": target["stopId"], "blockingCargoIds": sorted(blocking),
            "supportedCargoIds": sorted(supported), "doorClearanceValid": door_valid,
            "canUnload": not blocking and not supported and door_valid,
            "reason": "后方其他门店货物占据后门直线取货通道" if blocking else
                      "必须先卸去上方货物，不能抽走承托货箱" if supported else "后门净开口不足" if not door_valid else "可从后门直接卸出"}


def route_result(scenario, order):
    if len(order) != len(set(order)) or set(order) != {s["stopId"] for s in scenario["stops"]}:
        raise ValueError("Route must visit all stops once")
    route = scenario["routing"]
    ids = route["nodeIds"]
    stops = {s["stopId"]: s for s in scenario["stops"]}
    node = "DEPOT"
    now = minute(scenario["departureTime"])
    distance, driving, waiting = 0, 0, 0
    arrivals, legs = [], []
    for sid in [*order, "DEPOT"]:
        a, b = ids.index(node), ids.index(sid)
        km, travel = route["distanceMatrixKm"][a][b], route["travelTimeMatrixMinutes"][a][b]
        legs.append({"fromStopId": node, "toStopId": sid, "distanceKm": km, "travelMinutes": travel,
                     "departureTime": clock(now), "arrivalTime": clock(now + travel)})
        distance += km
        driving += travel
        now += travel
        if sid != "DEPOT":
            s = stops[sid]
            start = max(now, minute(s["timeWindow"]["start"]))
            wait = start - now
            waiting += wait
            end = start + s["serviceDurationMinutes"]
            arrivals.append({"stopId": sid, "sequence": len(arrivals) + 1, "arrivalTime": clock(now),
                             "serviceStartTime": clock(start), "departureTime": clock(end),
                             "serviceDurationMinutes": s["serviceDurationMinutes"], "waitingMinutes": wait,
                             "timeWindow": s["timeWindow"], "timeWindowValid": start <= minute(s["timeWindow"]["end"]),
                             "timingBasis": "proposed-route-assuming-service-can-complete"})
            now = end
        node = sid
    costs = scenario["costs"]
    fixed, travel_cost = costs["vehicleFixedCost"], round(distance * costs["drivingCostPerKm"], 2)
    return {"stopOrder": order, "routeNodeIds": ["DEPOT", *order, "DEPOT"], "arrivals": arrivals, "legs": legs,
            "distanceKm": distance, "drivingMinutes": driving, "waitingMinutes": waiting,
            "serviceMinutes": sum(a["serviceDurationMinutes"] for a in arrivals),
            "totalDurationMinutes": now - minute(scenario["departureTime"]), "returnTime": clock(now),
            "timeWindowCheck": {"checked": True, "valid": all(a["timeWindowValid"] for a in arrivals),
                                "rule": route["timeWindowRule"], "arrivals": arrivals},
            "costs": {"currency": costs["currency"], "vehicleCount": 1, "vehicleFixedCost": fixed,
                      "drivingCost": travel_cost, "extraHandlingMoves": 0, "extraHandlingCost": 0,
                      "waitingCost": round(waiting * costs["waitingCostPerMinute"], 2),
                      "totalCost": round(fixed + travel_cost + waiting * costs["waitingCostPerMinute"], 2),
                      "basis": "同一车辆、货物、费用规则下的计划费用；不可执行方案不代表实际完成配送的费用。"}}


def unloading(scenario, plan_id, order, positions, details, arrivals):
    remaining = list(positions)
    stations, steps = [], []
    arrival_map = {a["stopId"]: a for a in arrivals}
    failure = None

    def ids():
        return sorted(p["cargoId"] for p in remaining)

    def emit(kind, sid, **payload):
        step = {"stepId": f"{plan_id}-U{len(steps) + 1:03d}", "sequence": len(steps) + 1, "stopId": sid,
                "operation": kind, "remainingCargoIdsBefore": ids(), "remainingCargoIdsAfter": ids(), **payload}
        steps.append(step)
        return step

    for index, sid in enumerate(order):
        targets = [p for p in positions if p["stopId"] == sid]
        station = {"stopId": sid, "sequence": index + 1, "arrivalTime": arrival_map[sid]["arrivalTime"],
                   "serviceStartTime": arrival_map[sid]["serviceStartTime"], "targetCargoIds": sorted(p["cargoId"] for p in targets),
                   "stepIds": [], "conflicts": [], "extraHandlingMoves": 0, "extraHandlingCost": 0}
        if failure:
            station.update({"status": "not_reached", "canUnloadDirectly": None, "checked": False,
                            "remainingCargoIdsAtArrival": ids(), "remainingCargoIdsAfter": ids(),
                            "reason": "前一站卸货已停止，后续站点未执行。"})
            stations.append(station)
            continue
        start_step = len(steps)
        station["remainingCargoIdsAtArrival"] = ids()
        emit("arrive", sid, highlightCargoIds=station["targetCargoIds"], blockingCargoIds=[], durationSeconds=0.7,
             instruction="到店，确认本店货物与后门通道。")
        while any(p["stopId"] == sid for p in remaining):
            pending = sorted((p for p in remaining if p["stopId"] == sid), key=lambda p: (-p["y"], p["cargoId"]))
            checks = [obstruction(scenario, p, remaining, details) for p in pending]
            ready = next((p for p, check in zip(pending, checks) if check["canUnload"]), None)
            if ready is None:
                blockers = sorted({cid for c in checks for cid in c["blockingCargoIds"]})
                step = emit("blocked", sid, highlightCargoIds=[p["cargoId"] for p in pending], blockingCargoIds=blockers,
                            conflicts=checks, durationSeconds=0, instruction="当前门店货物被挡住。停止卸货，请选择调整方案。")
                failure = {"stopId": sid, "stepId": step["stepId"], "targetCargoIds": station["targetCargoIds"],
                           "blockingCargoIds": blockers, "conflicts": checks, "reason": step["instruction"]}
                station["conflicts"] = checks
                break
            cid = ready["cargoId"]
            emit("highlight", sid, cargoId=cid, highlightCargoIds=[cid], blockingCargoIds=[], durationSeconds=0.65,
                 instruction=f"确认 {cid}，先卸上层，再卸底层。")
            before = ids()
            end_z = scenario["vehicles"][0]["rearDoor"]["position"] + 0.25
            movement = {"kind": "translation", "axis": "z", "direction": "positive", "positionBasis": "minimum-corner",
                        "from": {k: ready[k] for k in ("x", "y", "z")},
                        "to": {"x": ready["x"], "y": ready["y"], "z": end_z},
                        "rotation": ready["rotation"], "pathChecked": True,
                        "retireAfterAnimation": True, "outsideTruckAfterStep": True}
            remaining.remove(ready)
            emit("unload", sid, cargoId=cid, highlightCargoIds=[cid], blockingCargoIds=[], movement=movement,
                 remainingCargoIdsBefore=before, durationSeconds=1.2,
                 instruction=f"{cid} 沿后门直线取出，完成后从车厢中移除。")
        if not failure:
            emit("station_complete", sid, highlightCargoIds=[], blockingCargoIds=[], durationSeconds=0.5,
                 instruction="本店货物已全部卸下，剩余货物保持原位。")
        station.update({"status": "blocked" if failure else "completed", "canUnloadDirectly": not failure,
                        "checked": True, "stepIds": [s["stepId"] for s in steps[start_step:]], "remainingCargoIdsAfter": ids()})
        stations.append(station)
    return {"planId": plan_id, "vehicleId": "V01", "stopOrder": order, "initialRemainingCargoIds": sorted(p["cargoId"] for p in positions),
            "stations": stations, "steps": steps, "finalRemainingCargoIds": ids(), "valid": not failure,
            "firstFailure": failure, "stopAtStepId": failure["stepId"] if failure else None,
            "extraHandling": {"supported": False, "allowed": False, "moves": 0, "cost": 0},
            "playback": {"timing": "illustrative-seconds-not-real-service-duration", "realTelemetry": False,
                         "advanceStationAfter": "station_complete", "stopImmediatelyOn": "blocked",
                         "remainingStateField": "remainingCargoIdsAfter"}}


def loading(scenario, plan_id, positions, details):
    loaded, steps = [], []
    for p in sorted(positions, key=lambda p: (p["z"], p["y"], p["x"])):
        # Lower cartons have smaller z than their upper cartons. All front rows
        # enter before rear rows, so the straight loading corridor remains clear.
        check = obstruction(scenario, p, [*loaded, p], details)
        support_ids = details[p["cargoId"]]["support"]["supportingCargoIds"]
        support_ok = all(any(q["cargoId"] == cid for q in loaded) for cid in support_ids)
        if not check["canUnload"] or not support_ok:
            raise ValueError(f"Unsafe loading path for {p['cargoId']}")
        before = sorted(q["cargoId"] for q in loaded)
        loaded.append(p)
        steps.append({"stepId": f"{plan_id}-L{len(steps) + 1:03d}", "operation": "load", "cargoId": p["cargoId"],
                      "stopId": p["stopId"], "loadedCargoIdsBefore": before, "loadedCargoIdsAfter": sorted(q["cargoId"] for q in loaded),
                      "movement": {"kind": "translation", "axis": "z", "direction": "negative",
                                   "from": {"x": p["x"], "y": p["y"], "z": scenario["vehicles"][0]["rearDoor"]["position"] + 0.25},
                                   "to": {k: p[k] for k in ("x", "y", "z")}, "rotation": p["rotation"], "pathChecked": True},
                      "durationSeconds": 1.2})
    return steps


def produce():
    scenario = make_scenario()
    specs = [
        ("PLAN_A", "方案 A · 基础配送", ["S01", "S02", "S03", "S04"], ["S01", "S02", "S03", "S04"]),
        ("PLAN_B", "方案 B · 顺序与布局调整", ["S02", "S01", "S04", "S03"], ["S03", "S04", "S01", "S02"]),
    ]
    plans, layouts, operations = [], [], []
    for pid, name, order, rows in specs:
        layout = make_positions(scenario, pid, rows)
        check = geometry(scenario, layout["positions"])
        route = route_result(scenario, order)
        unload = unloading(scenario, pid, order, layout["positions"], check["cargoChecks"], route["arrivals"])
        load_steps = loading(scenario, pid, layout["positions"], check["cargoChecks"])
        for p in layout["positions"]:
            per_cargo = check["cargoChecks"][p["cargoId"]]
            p["support"] = per_cargo["support"]
            p["stacking"].update({"supportedCargoIds": per_cargo["supportedCargoIds"], "topLoadKg": per_cargo["topLoadKg"]})
            p["spaceCheck"] = {k: per_cargo[k] for k in ("boundaryValid", "collisionFree", "overlappingCargoIds", "orientationValid", "fragileValid", "loadBearingValid", "valid")}
        valid = check["valid"] and route["timeWindowCheck"]["valid"] and unload["valid"]
        plans.append({"planId": pid, "scenarioId": SCENARIO_ID, "vehicleId": "V01", "name": name,
                      "kind": "baseline" if pid == "PLAN_A" else "adjusted", **route,
                      "loadingCheck": check, "unloadingCheck": {"checked": True, "valid": unload["valid"],
                          "firstFailure": unload["firstFailure"], "rule": scenario["rules"]["extraction"]},
                      "loadingSequenceCargoIds": [s["cargoId"] for s in load_steps],
                      "feasibility": {"executable": valid, "status": "executable_within_declared_constraints" if valid else "not_executable",
                                      "scope": "仅对场景明确声明并实际检查的约束有效。",
                                      "uncheckedConstraints": scenario["uncheckedConstraints"],
                                      "reasons": [] if valid else ["首站东城店货物被后方其他门店货物挡住，禁止额外搬运，卸货停止。"]},
                      "computedBy": "tools/city-delivery/build_demo.py", "globalOptimalityClaim": False})
        unload["loadingSteps"] = load_steps
        layouts.append(layout)
        operations.append(unload)
    records = []
    for p in plans:
        records.append({"planId": p["planId"], "name": p["name"], "distanceKm": p["distanceKm"],
                        **p["costs"], "drivingMinutes": p["drivingMinutes"], "totalDurationMinutes": p["totalDurationMinutes"],
                        "returnTime": p["returnTime"], "arrivals": p["arrivals"],
                        "timeWindowsSatisfied": p["timeWindowCheck"]["valid"], "loadingFeasible": p["loadingCheck"]["valid"],
                        "unloadingFeasible": p["unloadingCheck"]["valid"], "executable": p["feasibility"]["executable"],
                        "costInterpretation": "可执行计划的预计费用" if p["feasibility"]["executable"] else "不可执行计划的名义费用，不能据此认定更优"})
    a, b = records
    changes = [{"cargoId": pa["cargoId"], "from": {k: pa[k] for k in ("x", "y", "z", "rotation")},
                "to": {k: pb[k] for k in ("x", "y", "z", "rotation")}}
               for pa, pb in zip(layouts[0]["positions"], layouts[1]["positions"])
               if any(pa[k] != pb[k] for k in ("x", "y", "z", "rotation"))]
    comparison = envelope(baselinePlanId="PLAN_A", adjustedPlanId="PLAN_B", sameOrders=True, sameVehicle=True,
                          sameCostRules=True, plans=records,
                          delta={"direction": "PLAN_B-minus-PLAN_A", **{k: round(b[k] - a[k], 4) for k in
                                 ("distanceKm", "vehicleCount", "vehicleFixedCost", "drivingCost", "extraHandlingMoves", "extraHandlingCost", "totalCost", "drivingMinutes", "totalDurationMinutes")}},
                          changes={"stopOrderBefore": specs[0][2], "stopOrderAfter": specs[1][2], "placements": changes},
                          decision={"recommendedPlanId": "PLAN_B", "reason": "方案 A 虽然名义路线较短，但首站无法卸货；方案 B 增加 4 km，调整顺序和布局后能逐站直接卸货。",
                                    "costSavingClaim": False, "optimizedGlobally": False,
                                    "comparisonBoundary": "比较的是不可执行基础计划与已校验调整计划，不证明联合优化一般优于其他方法。"})
    return {"scenario.json": scenario,
            "plans.json": envelope(plans=plans, selectedPlanId="PLAN_B", planningMode="precomputed-validated-candidates"),
            "placements.json": envelope(coordinateSystem=scenario["coordinateSystem"], plans=layouts),
            "unloading-steps.json": envelope(rules=scenario["rules"], plans=operations),
            "comparison.json": comparison}


def verify(documents):
    """Replay delivered state and recompute all published business conclusions."""
    scenario = documents["scenario.json"]
    for name in FILES:
        assert documents[name]["scenarioId"] == SCENARIO_ID, name
        assert documents[name]["schemaVersion"] == VERSION, name
    positions = {p["planId"]: p for p in documents["placements.json"]["plans"]}
    operations = {p["planId"]: p for p in documents["unloading-steps.json"]["plans"]}
    records = {p["planId"]: p for p in documents["comparison.json"]["plans"]}
    plans = documents["plans.json"]["plans"]
    assert set(positions) == set(operations) == set(records) == {p["planId"] for p in plans} == {"PLAN_A", "PLAN_B"}
    for p in plans:
        pid = p["planId"]
        layout = positions[pid]["positions"]
        check = geometry(scenario, layout)
        assert check == p["loadingCheck"], f"Geometry conclusion mismatch: {pid}"
        route = route_result(scenario, p["stopOrder"])
        assert all(p[k] == value for k, value in route.items()), f"Route/cost conclusion mismatch: {pid}"
        for cp in layout:
            assert cp["support"] == check["cargoChecks"][cp["cargoId"]]["support"]
            assert cp["stopId"] == next(c["stopId"] for c in scenario["cargo"] if c["cargoId"] == cp["cargoId"])
            assert cp["vehicleId"] == p["vehicleId"] == "V01"
            assert cp["spaceCheck"] == {k: check["cargoChecks"][cp["cargoId"]][k] for k in cp["spaceCheck"]}
        expected_unload = unloading(scenario, pid, p["stopOrder"], layout, check["cargoChecks"], p["arrivals"])
        expected_unload["loadingSteps"] = loading(scenario, pid, layout, check["cargoChecks"])
        assert expected_unload == operations[pid], f"Unloading replay mismatch: {pid}"
        executable = check["valid"] and route["timeWindowCheck"]["valid"] and expected_unload["valid"]
        assert p["feasibility"]["executable"] == executable
        assert records[pid]["executable"] == executable
        assert p["unloadingCheck"]["valid"] == expected_unload["valid"]
        remaining = {cp["cargoId"]: cp for cp in layout}
        stopped = False
        for step in expected_unload["steps"]:
            assert not stopped, "Playback continued after blocked step"
            assert sorted(remaining) == step["remainingCargoIdsBefore"]
            if step["operation"] == "unload":
                target = remaining[step["cargoId"]]
                assert target["stopId"] == step["stopId"]
                assert obstruction(scenario, target, list(remaining.values()), check["cargoChecks"])["canUnload"]
                assert step["movement"]["to"]["z"] >= scenario["vehicles"][0]["rearDoor"]["position"]
                remaining.pop(step["cargoId"])
            stopped = step["operation"] == "blocked"
            assert sorted(remaining) == step["remainingCargoIdsAfter"]
        assert sorted(remaining) == expected_unload["finalRemainingCargoIds"]
    assert not plans[0]["feasibility"]["executable"] and plans[1]["feasibility"]["executable"]
    assert operations["PLAN_A"]["firstFailure"]["stopId"] == "S01"
    assert len(operations["PLAN_A"]["finalRemainingCargoIds"]) == 16
    assert not operations["PLAN_B"]["finalRemainingCargoIds"]
    # Targeted negative probes ensure rejection works, beyond the valid fixture.
    valid_layout = positions["PLAN_B"]["positions"]
    probes = [("boundary", "x", 10), ("orientation", "rotation", 180), ("support", "y", 0.2)]
    for key, field, value in probes:
        invalid = copy.deepcopy(valid_layout)
        invalid[0][field] = value
        assert not geometry(scenario, invalid)["checks"][key]["valid"], key
    overlapping = copy.deepcopy(valid_layout)
    for key in ("x", "y", "z"):
        overlapping[1][key] = overlapping[0][key]
    assert not geometry(scenario, overlapping)["checks"]["collision"]["valid"]
    overloaded = copy.deepcopy(scenario)
    overloaded["vehicles"][0]["maxPayloadKg"] = 1
    assert not geometry(overloaded, valid_layout)["checks"]["weight"]["valid"]
    fragile = copy.deepcopy(scenario)
    fragile["cargo"][0]["fragile"] = True
    assert not geometry(fragile, valid_layout)["checks"]["fragile"]["valid"]
    weak = copy.deepcopy(scenario)
    weak["cargo"][0]["maxTopLoadKg"] = 1
    assert not geometry(weak, valid_layout)["checks"]["loadBearing"]["valid"]
    late = copy.deepcopy(scenario)
    late["stops"][1]["timeWindow"]["end"] = "08:01"
    assert not route_result(late, plans[1]["stopOrder"])["timeWindowCheck"]["valid"]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--verify", action="store_true", help="Read/recheck existing delivery without writing")
    args = parser.parse_args()
    if args.verify:
        documents = {name: json.loads((OUTPUT / name).read_text()) for name in FILES}
        manifest = json.loads((OUTPUT / "manifest.json").read_text())
        for name in FILES:
            assert hashlib.sha256((OUTPUT / name).read_bytes()).hexdigest() == manifest["sha256"][name]
        assert documents == produce(), "Delivered data differs from deterministic source"
    else:
        documents = produce()
    verify(documents)
    if not args.verify:
        OUTPUT.mkdir(parents=True, exist_ok=True)
        checksums = {}
        for name, value in documents.items():
            content = (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode()
            (OUTPUT / name).write_bytes(content)
            checksums[name] = hashlib.sha256(content).hexdigest()
        manifest = envelope(source=SOURCE, dataType="synthetic", coordinateSystem=documents["scenario.json"]["coordinateSystem"],
                            files={"scenario": "scenario.json", "plans": "plans.json", "placements": "placements.json",
                                   "unloadingSteps": "unloading-steps.json", "comparison": "comparison.json"},
                            capabilities={"selectVehicle": {"supported": True, "availableVehicleIds": ["V01"]},
                                          "selectPlan": {"supported": True, "availablePlanIds": ["PLAN_A", "PLAN_B"]},
                                          "showRoute": True, "selectCargo": True, "showCargoGeometry": True,
                                          "playLoadingSteps": True, "playUnloadingSteps": True, "showBlockedCargo": True,
                                          "recheckFrozenPlan": True, "arbitraryDragAndSolve": False,
                                          "liveOptimization": False, "multiVehicleDispatch": False, "extraHandling": False},
                            validation={"method": "executed-deterministic-geometry-route-and-unloading-checks",
                                        "generator": "tools/city-delivery/build_demo.py", "allDeclaredConstraintsChecked": True,
                                        "checkedConstraints": ["boundary", "collision", "weight", "orientation", "fragile", "support", "loadBearing", "rearDoorUnloading", "timeWindow"],
                                        "uncheckedConstraints": documents["scenario.json"]["uncheckedConstraints"],
                                        "globallyOptimal": False},
                            frontend={"basePath": "/demo/city-delivery/v1/", "joinKeys": ["scenarioId", "planId", "vehicleId", "stopId", "cargoId"],
                                      "positionField": "placements.json -> plans[].positions[]",
                                      "renderGeometry": "positions.width/height/length 已为旋转后的 x/y/z 尺寸；以最小角点加半尺寸取中心。不要再次交换尺寸或旋转轴向包围盒。rotation 记录原始货箱绕 y 轴朝向。",
                                      "unloadingField": "unloading-steps.json -> plans[].stations[] and plans[].steps[]",
                                      "comparisonField": "comparison.json -> plans[], delta, changes",
                                      "playbackClockIsTelemetry": False}, sha256=checksums)
        (OUTPUT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"dataReady": True, "scenarioId": SCENARIO_ID,
                      "plans": [{"planId": p["planId"], "distanceKm": p["distanceKm"], "cost": p["costs"]["totalCost"],
                                 "executable": p["feasibility"]["executable"], "returnTime": p["returnTime"]}
                                for p in documents["plans.json"]["plans"]]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
