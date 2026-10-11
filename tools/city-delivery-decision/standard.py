"""Bounded general scene intake and route/packing feedback. No persistence.

Keeps the frozen v1/v2 implementation intact. Every emitted layout is checked
by the existing 3D, support, loading and exact straight-unloading checks.
"""
from __future__ import annotations

import copy
import itertools
import math
import re
import time
from dataclasses import dataclass, field

from decision import assess, checks, identity, layout_changes, row_layout, scoped_scenario, validate_fleet_routes, validate_time

CONSTRAINT_VERSION = "city-rear-door-3d-1.0"
LIMITS = {"stops": 16, "vehicles": 6, "cargo": 96, "cargoPerStop": 16,
          "budgetMs": 5000, "routeCandidates": 6, "layoutCandidatesPerStop": 8}
BOUNDARY = ["整站分区，不拆分同店到不同车", "底层直立箱或已有两层承托模式",
            "后门沿 z 轴直线装卸，不允许额外搬运", "无轴荷、重心、绑扎、冷链、真实交通或司机工时检查",
            "有限搜索失败不代表全局无解", "不证明全局最优，不支持在途自动重装"]


class InputError(ValueError):
    def __init__(self, path, message):
        self.path = path
        super().__init__(f"{path}: {message}")


def fail(path, message):
    raise InputError(path, message)


def obj(value, path, required, optional=()):
    if not isinstance(value, dict):
        fail(path, "必须是对象")
    missing, extra = set(required) - set(value), set(value) - set(required) - set(optional)
    if missing:
        fail(path, "缺少字段 " + ", ".join(sorted(missing)))
    if extra:
        fail(path, "不支持字段 " + ", ".join(sorted(extra)))


def number(value, path, minimum=0, maximum=100000, positive=False):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        fail(path, "必须是有限数字，不能缺失、布尔或字符串")
    if value < minimum or value > maximum or positive and value <= 0:
        fail(path, f"数值超出受支持范围 ({minimum}, {maximum})")


def ident(value, path):
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,79}", value):
        fail(path, "编号须为 1–80 位字母、数字、下划线或连字符")


def text(value, path):
    if not isinstance(value, str) or not value.strip() or len(value) > 300:
        fail(path, "须提供 1–300 字的明确说明")


def validate_scene(value):
    obj(value, "scenario", ["schemaVersion", "scenarioId", "name", "units", "source", "warehouse", "stops", "orders", "cargo", "vehicles", "departureTime", "routing", "costs", "rules"])
    if value["schemaVersion"] != "3.0.0":
        fail("scenario.schemaVersion", "只接受 3.0.0")
    ident(value["scenarioId"], "scenario.scenarioId")
    text(value["name"], "scenario.name")
    if value["units"] != {"dimensions": "m", "weight": "kg", "distance": "km", "time": "minutes", "currency": "CNY"}:
        fail("scenario.units", "必须显式使用 m/kg/km/minutes/CNY；不猜测原始单位")
    obj(value["source"], "scenario.source", ["dataType", "name", "description", "license", "authorization"])
    if value["source"]["dataType"] not in ("synthetic", "public-benchmark"):
        fail("scenario.source.dataType", "仅支持 synthetic 或 public-benchmark")
    for key in ("name", "description", "license", "authorization"):
        text(value["source"][key], "scenario.source." + key)
    obj(value["warehouse"], "scenario.warehouse", ["stopId", "name", "x", "y"])
    if value["warehouse"]["stopId"] != "DEPOT":
        fail("scenario.warehouse.stopId", "当前单中心仓编号必须为 DEPOT")
    text(value["warehouse"]["name"], "scenario.warehouse.name")
    for key in ("x", "y"):
        number(value["warehouse"][key], "scenario.warehouse." + key, -10000, 10000)
    for key, limit in (("stops", 16), ("cargo", 96), ("vehicles", 6), ("orders", 96)):
        if not isinstance(value[key], list) or not 1 <= len(value[key]) <= limit:
            fail("scenario." + key, f"必须提供 1–{limit} 个对象")
    stop_ids, cargo_ids, vehicle_ids, order_ids = set(), set(), set(), set()
    for i, stop in enumerate(value["stops"]):
        path = f"scenario.stops[{i}]"
        obj(stop, path, ["stopId", "name", "x", "y", "timeWindow", "serviceDurationMinutes"], ["color", "address"])
        ident(stop["stopId"], path + ".stopId")
        if stop["stopId"] == "DEPOT" or stop["stopId"] in stop_ids:
            fail(path, "门店编号重复或与中心仓冲突")
        stop_ids.add(stop["stopId"])
        text(stop["name"], path + ".name")
        for key in ("x", "y"):
            number(stop[key], path + "." + key, -10000, 10000)
        number(stop["serviceDurationMinutes"], path + ".serviceDurationMinutes", 0, 120)
        obj(stop["timeWindow"], path + ".timeWindow", ["start", "end"])
        for key in ("start", "end"):
            validate_time(stop["timeWindow"][key])
        if checks.minute(stop["timeWindow"]["start"]) > checks.minute(stop["timeWindow"]["end"]):
            fail(path + ".timeWindow", "不支持跨午夜时间窗")
        if "color" in stop and (not isinstance(stop["color"], str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", stop["color"])):
            fail(path + ".color", "使用 #RRGGBB")
    for i, c in enumerate(value["cargo"]):
        path = f"scenario.cargo[{i}]"
        obj(c, path, ["cargoId", "orderId", "stopId", "name", "length", "width", "height", "weightKg", "fragile", "maxTopLoadKg", "orientation"], ["handlingRequirements", "color"])
        ident(c["cargoId"], path + ".cargoId")
        if c["cargoId"] in cargo_ids:
            fail(path, "货物编号重复")
        cargo_ids.add(c["cargoId"])
        if c["stopId"] not in stop_ids:
            fail(path + ".stopId", "货物指向未知门店")
        ident(c["orderId"], path + ".orderId")
        text(c["name"], path + ".name")
        for key in ("length", "width", "height"):
            number(c[key], path + "." + key, 0, 15, positive=True)
        number(c["weightKg"], path + ".weightKg", 0, 30000, positive=True)
        number(c["maxTopLoadKg"], path + ".maxTopLoadKg", 0, 30000)
        if not isinstance(c["fragile"], bool):
            fail(path + ".fragile", "须明确 true 或 false")
        if c["fragile"] and c["maxTopLoadKg"] != 0:
            fail(path, "当前易碎规则禁止上方堆货，maxTopLoadKg 必须为 0")
        obj(c["orientation"], path + ".orientation", ["uprightOnly", "allowedYawDegrees"])
        yaw = c["orientation"]["allowedYawDegrees"]
        if c["orientation"]["uprightOnly"] is not True or not isinstance(yaw, list) or not yaw or any(type(r) is not int or r not in (0, 90) for r in yaw) or len(yaw) != len(set(yaw)):
            fail(path + ".orientation", "当前支持直立货箱，朝向集合为 0/90 度的非空子集")
    assigned = []
    for i, order in enumerate(value["orders"]):
        path = f"scenario.orders[{i}]"
        obj(order, path, ["orderId", "stopId", "cargoIds"])
        ident(order["orderId"], path + ".orderId")
        if order["orderId"] in order_ids or order["stopId"] not in stop_ids:
            fail(path, "订单编号重复或门店未知")
        order_ids.add(order["orderId"])
        if not isinstance(order["cargoIds"], list) or not order["cargoIds"]:
            fail(path, "订单必须明确列出包装件")
        for cid in order["cargoIds"]:
            c = next((c for c in value["cargo"] if c["cargoId"] == cid), None)
            if c is None or c["stopId"] != order["stopId"] or c["orderId"] != order["orderId"]:
                fail(path, "订单、货物和门店关联不一致")
        assigned.extend(order["cargoIds"])
    if len(assigned) != len(set(assigned)) or set(assigned) != cargo_ids:
        fail("scenario.orders", "每件包装件必须且只能属于一个订单")
    for sid in stop_ids:
        count = sum(c["stopId"] == sid for c in value["cargo"])
        if not 1 <= count <= 16:
            fail("scenario.cargo", "每店需有 1–16 件实际包装件")
    for i, v in enumerate(value["vehicles"]):
        path = f"scenario.vehicles[{i}]"
        obj(v, path, ["vehicleId", "name", "maxPayloadKg", "compartment", "rearDoor", "costs"])
        ident(v["vehicleId"], path + ".vehicleId")
        if v["vehicleId"] in vehicle_ids:
            fail(path, "车辆编号重复")
        vehicle_ids.add(v["vehicleId"])
        text(v["name"], path + ".name")
        number(v["maxPayloadKg"], path + ".maxPayloadKg", 0, 30000, True)
        obj(v["compartment"], path + ".compartment", ["length", "width", "height"])
        for key in ("length", "width", "height"):
            number(v["compartment"][key], path + ".compartment." + key, 0, 15, True)
        door = v["rearDoor"]
        obj(door, path + ".rearDoor", ["axis", "position", "xMin", "xMax", "yMin", "yMax"])
        for key in ("position", "xMin", "xMax", "yMin", "yMax"):
            number(door[key], path + ".rearDoor." + key, 0, 15)
        if door["axis"] != "z" or abs(door["position"] - v["compartment"]["length"]) > 1e-7 or not 0 <= door["xMin"] < door["xMax"] <= v["compartment"]["width"] or not 0 <= door["yMin"] < door["yMax"] <= v["compartment"]["height"]:
            fail(path + ".rearDoor", "后门必须位于最大 z，净开口须在车厢有效空间内")
        obj(v["costs"], path + ".costs", ["vehicleFixedCost", "drivingCostPerKm"])
        for key in ("vehicleFixedCost", "drivingCostPerKm"):
            number(v["costs"][key], path + ".costs." + key)
    validate_time(value["departureTime"])
    obj(value["routing"], "scenario.routing", ["nodeIds", "distanceMatrixKm", "travelTimeMatrixMinutes", "returnToDepot"])
    r = value["routing"]
    if r["nodeIds"] != ["DEPOT", *[s["stopId"] for s in value["stops"]]] or r["returnToDepot"] is not True:
        fail("scenario.routing", "矩阵节点按中心仓及门店顺序排列；须返回中心仓")
    for key in ("distanceMatrixKm", "travelTimeMatrixMinutes"):
        matrix, n = r[key], len(r["nodeIds"])
        if not isinstance(matrix, list) or len(matrix) != n or any(not isinstance(row, list) or len(row) != n for row in matrix):
            fail("scenario.routing." + key, "矩阵必须为完整 n×n，不接受缺失路段")
        for i, row in enumerate(matrix):
            for j, item in enumerate(row):
                number(item, f"scenario.routing.{key}[{i}][{j}]", 0, 480 if key == "travelTimeMatrixMinutes" else 10000)
                if (i == j and item != 0) or (i != j and item <= 0):
                    fail("scenario.routing." + key, "对角为0，其他路段须大于0")
    obj(value["costs"], "scenario.costs", ["currency", "waitingCostPerMinute", "extraHandlingCostPerCargoMove"])
    if value["costs"]["currency"] != "CNY" or value["costs"]["waitingCostPerMinute"] != 0:
        fail("scenario.costs", "当前支持 CNY、等待不计费；不忽略未支持的等待费用")
    number(value["costs"]["extraHandlingCostPerCargoMove"], "scenario.costs.extraHandlingCostPerCargoMove")
    expected = {"extraction": "rear-door-straight-positive-z", "allowExtraHandling": False,
                "minimumSupportRatio": 1, "fragileRule": "no-load-on-fragile", "maxRouteDurationMinutes": 480,
                "supportRule": "full-footprint", "timeWindowRule": "service-start", "loadBearingRule": "area-proportional"}
    if value["rules"] != expected:
        fail("scenario.rules", "须完整声明受支持规则，不默认缺失约束或静默忽略其他规则")
    normalized = copy.deepcopy(value)
    normalized["uncheckedConstraints"] = BOUNDARY
    normalized["routing"]["timeWindowRule"] = "服务开始须处于时间窗；提前到店等待。"
    palette = ["#57B8F2", "#C2A3EE", "#E7AC66", "#65CEAB"]
    for i, stop in enumerate(normalized["stops"]):
        stop.setdefault("color", palette[i % len(palette)])
    for c in normalized["cargo"]:
        c.setdefault("color", next(s["color"] for s in normalized["stops"] if s["stopId"] == c["stopId"]))
        c.setdefault("handlingRequirements", ["保持直立", "上方禁堆" if c["fragile"] else f"上方承重不超过 {c['maxTopLoadKg']} kg"])
    return normalized


@dataclass
class Budget:
    milliseconds: int
    start: float = field(default_factory=time.perf_counter)
    solve_ms: float = 0
    check_ms: float = 0
    layout_ms: float = 0
    solver_calls: int = 0
    route_attempts: int = 0
    layout_attempts: int = 0
    candidate_evaluations: list = field(default_factory=list)
    budget_exhausted: bool = False

    def remaining(self):
        return self.milliseconds - (time.perf_counter() - self.start) * 1000

    def require(self):
        if self.remaining() <= 0:
            raise TimeoutError("本次统一计算预算耗尽")

    def timing(self):
        return {"solveMs": round(self.solve_ms, 3), "constraintCheckMs": round(self.check_ms, 3),
                "layoutGenerationMs": round(self.layout_ms, 3), "overallComputeMs": round((time.perf_counter()-self.start)*1000, 3),
                "budgetMs": self.milliseconds, "solverCalls": self.solver_calls, "routeCandidates": self.route_attempts,
                "layoutCandidatesChecked": self.layout_attempts}


def cargo_position(c, vehicle, yaw, x, z):
    length, width = (c["width"], c["length"]) if yaw == 90 else (c["length"], c["width"])
    return {"cargoId": c["cargoId"], "stopId": c["stopId"], "vehicleId": vehicle["vehicleId"], "x": round(x, 6), "y": 0,
            "z": round(z, 6), "length": length, "width": width, "height": c["height"], "rotation": yaw,
            "rotationUnit": "degrees", "dimensionsBasis": "oriented-axis-aligned"}


def stop_layouts(scenario, vehicle, sid, budget, repair):
    """Alternatives: existing supported stacks + 1/2/3-column floor rows.

    All floor rows avoid unsupported stacking. Choices are finite, explicit,
    and are checked in 3D including actual door clearance, not just 2D area.
    """
    cargo = sorted((c for c in scenario["cargo"] if c["stopId"] == sid), key=lambda c:c["cargoId"])
    candidates = []
    start = time.perf_counter()
    shelf = row_layout(scenario, vehicle, sid)
    if shelf:
        positions = copy.deepcopy(shelf[2])
        for p in positions:
            p["z"] = round(p["z"] + .1, 6)
        candidates.append((shelf[0], "supported-two-level", positions))
    # Baseline uses the existing two-layer layout when possible, otherwise
    # one deterministic two-column floor layout. Joint feedback has alternatives.
    if repair or not candidates:
        for columns in ([2, 1, 3] if repair else [2]):
            for preferred in ([0, 90] if repair else [0]):
                x, z, depth, lane = .1, .1, 0.0, 0
                positions = []
                for c in cargo:
                    yaw = preferred if preferred in c["orientation"]["allowedYawDegrees"] else c["orientation"]["allowedYawDegrees"][0]
                    p = cargo_position(c, vehicle, yaw, x, z)
                    positions.append(p)
                    x += p["width"] + .1
                    depth = max(depth, p["length"])
                    lane += 1
                    if lane == columns:
                        z += depth + .1
                        x, depth, lane = .1, 0.0, 0
                span = max(p["z"] + p["length"] for p in positions) - .1
                candidates.append((span, f"floor-{columns}-columns-yaw-{preferred}", positions))
    budget.layout_ms += (time.perf_counter()-start)*1000
    valid, failures, seen = [], [], set()
    for span, method, positions in candidates[:LIMITS["layoutCandidatesPerStop"]]:
        budget.require()
        fingerprint = identity(positions)
        if fingerprint in seen:
            continue
        seen.add(fingerprint)
        start = time.perf_counter()
        result = assess(scenario, vehicle, [sid], positions, "STOP-CHECK")
        budget.check_ms += (time.perf_counter()-start)*1000
        budget.layout_attempts += 1
        loading = result.get("loadingCheck") or {}
        utilization = loading.get("spaceUtilizationRatio")
        budget.candidate_evaluations.append({
            "vehicleId": vehicle["vehicleId"], "stopId": sid, "method": method,
            "spanM": round(span, 6), "feasible": bool(result["feasibility"]["executable"]),
            "spaceUtilizationRatio": utilization, "spaceUtilizationPercent": loading.get("spaceUtilizationPercent"),
            "checkedMs": round((time.perf_counter()-start)*1000, 3),
            "failureTypes": sorted({str(reason.get("type")) for reason in result["feasibility"]["reasons"] if reason.get("type")}),
            "movementCountBasis": "not-computed-per-stop-candidate"
        })
        if result["feasibility"]["executable"]:
            valid.append((span, method, positions))
        else:
            failures.extend(result["feasibility"]["reasons"])
    # The primary choice stays primary until feedback is explicitly permitted.
    return (sorted(valid, key=lambda v:(v[0],v[1])) if repair else valid), failures


def pack_order(scenario, vehicle, order, options):
    positions, z, methods = [], .1, []
    for sid in reversed(order):
        if not options.get((sid, vehicle["vehicleId"])):
            return None, {"type": "layout_search_failed", "stopId": sid, "vehicleId": vehicle["vehicleId"],
                          "message": "当前有限布局集合未找到可装、可卸的门店分区", "notGlobalInfeasibility": True}
        span, method, row = options[sid, vehicle["vehicleId"]][0]
        for p in row:
            p = copy.deepcopy(p)
            p["z"] = round(p["z"] + z - .1, 6)
            positions.append(p)
        z += span + .15
        methods.append({"stopId": sid, "method": method})
    if positions and max(p["z"]+p["length"] for p in positions) > vehicle["compartment"]["length"]-.1+1e-7:
        return None, {"type": "partition_length", "vehicleId": vehicle["vehicleId"], "stopIds": order,
                      "message": "已检查的门店分区组合超过本车有效长度，需要其他车辆或路线分配", "notGlobalInfeasibility": True}
    return (positions, methods), None


def solve(scenario, budget, options=None, candidate_index=0):
    from ortools.constraint_solver import pywrapcp, routing_enums_pb2
    budget.require()
    start = time.perf_counter()
    ids, vehicles = scenario["routing"]["nodeIds"], scenario["vehicles"]
    manager = pywrapcp.RoutingIndexManager(len(ids), len(vehicles), 0)
    routing = pywrapcp.RoutingModel(manager)
    callbacks = []
    for i, v in enumerate(vehicles):
        def cost(a, b, v=v):
            return round(scenario["routing"]["distanceMatrixKm"][manager.IndexToNode(a)][manager.IndexToNode(b)] * v["costs"]["drivingCostPerKm"]*100)
        callbacks.append(cost)
        routing.SetArcCostEvaluatorOfVehicle(routing.RegisterTransitCallback(cost), i)
        routing.SetFixedCostOfVehicle(round(v["costs"]["vehicleFixedCost"]*100), i)
    weights = {s["stopId"]: sum(math.ceil(c["weightKg"]*1000) for c in scenario["cargo"] if c["stopId"]==s["stopId"]) for s in scenario["stops"]}
    routing.AddDimensionWithVehicleCapacity(routing.RegisterUnaryTransitCallback(lambda idx:weights.get(ids[manager.IndexToNode(idx)],0)),0,
                                           [math.floor(v["maxPayloadKg"]*1000) for v in vehicles],True,"PayloadGrams")
    if options is not None:
        for sid in ids[1:]:
            eligible = [i for i,v in enumerate(vehicles) if options.get((sid,v["vehicleId"]))]
            if not eligible:
                budget.solve_ms+=(time.perf_counter()-start)*1000
                budget.solver_calls+=1
                return None, {"type":"no_supported_layout", "stopId":sid, "message":"所有车辆的有限布局搜索均失败，不证明全局无解"}
            routing.SetAllowedVehiclesForIndex(eligible, manager.NodeToIndex(ids.index(sid)))
        for i,v in enumerate(vehicles):
            def span(idx,v=v):
                row=options.get((ids[manager.IndexToNode(idx)],v["vehicleId"]))
                return math.ceil((row[0][0]+.15)*1000) if row else 0
            callbacks.append(span)
        row_callbacks=callbacks[-len(vehicles):]
        routing.AddDimensionWithVehicleTransitAndCapacity([routing.RegisterUnaryTransitCallback(cb) for cb in row_callbacks],0,
                                                         [max(0,math.floor((v["compartment"]["length"]-.05)*1000)) for v in vehicles],True,"CheckedPartitionLengthMm")
    service={s["stopId"]:s["serviceDurationMinutes"] for s in scenario["stops"]}
    def duration(a,b):
        return math.ceil((scenario["routing"]["travelTimeMatrixMinutes"][manager.IndexToNode(a)][manager.IndexToNode(b)] + service.get(ids[manager.IndexToNode(a)],0))*60)
    callbacks.append(duration)
    routing.AddDimension(routing.RegisterTransitCallback(duration),480*60,480*60,True,"TimeSeconds")
    dim=routing.GetDimensionOrDie("TimeSeconds")
    departure=checks.minute(scenario["departureTime"])
    for s in scenario["stops"]:
        low=max(0,(checks.minute(s["timeWindow"]["start"])-departure)*60)
        high=(checks.minute(s["timeWindow"]["end"])-departure)*60
        if high<low or low>480*60:
            budget.solve_ms+=(time.perf_counter()-start)*1000
            budget.solver_calls+=1
            return None,{"type":"time_window", "stopId":s["stopId"],"message":"出发时间已超过门店时间窗"}
        dim.CumulVar(manager.NodeToIndex(ids.index(s["stopId"]))).SetRange(low,min(high,480*60))
    remaining_today=(24*60-departure)*60-1
    for i in range(len(vehicles)):
        dim.CumulVar(routing.End(i)).SetMax(min(remaining_today,480*60))
    parameters=pywrapcp.DefaultRoutingSearchParameters()
    strategies=[routing_enums_pb2.FirstSolutionStrategy.PARALLEL_CHEAPEST_INSERTION,
                routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC,
                routing_enums_pb2.FirstSolutionStrategy.SAVINGS]
    parameters.first_solution_strategy=strategies[candidate_index%len(strategies)]
    parameters.local_search_metaheuristic=routing_enums_pb2.LocalSearchMetaheuristic.GREEDY_DESCENT
    parameters.time_limit.FromMilliseconds(max(1,min(900,int(budget.remaining()-25))))
    solution=routing.SolveWithParameters(parameters)
    budget.solve_ms+=(time.perf_counter()-start)*1000
    budget.solver_calls+=1
    if solution is None:
        return None,{"type":"route_search_failed", "solverStatus":routing.status(), "message":"路线搜索在本次边界内未找到完整解，不宣称全局无解"}
    routes=[]
    for i,v in enumerate(vehicles):
        index,order=routing.Start(i),[]
        while not routing.IsEnd(index):
            node=manager.IndexToNode(index)
            if node:order.append(ids[node])
            index=solution.Value(routing.NextVar(index))
        routes.append({"vehicleId":v["vehicleId"],"stopOrder":order})
    return routes,None


def evaluate_routes(scenario, routes, options, plan_id, budget):
    validate_fleet_routes(scenario,routes)
    by_vehicle={r["vehicleId"]:r["stopOrder"] for r in routes}
    results,failures,assignments=[],[],[]
    for v in scenario["vehicles"]:
        budget.require()
        order=by_vehicle.get(v["vehicleId"],[])
        cargo=[c["cargoId"] for c in scenario["cargo"] if c["stopId"] in order]
        assignments.extend({"stopId":sid,"vehicleId":v["vehicleId"],"cargoIds":[c["cargoId"] for c in scenario["cargo"] if c["stopId"]==sid]} for sid in order)
        packed,error=pack_order(scenario,v,order,options)
        started=time.perf_counter()
        if error:
            route=checks.route_result(scoped_scenario(scenario,v,order),order)
            result={"planId":plan_id,"scenarioId":scenario["scenarioId"],"vehicleId":v["vehicleId"],**route,"cargoIds":cargo,
                    "placements":None,"unloading":None,"loadingCheck":{"checked":False,"valid":False},"unloadingCheck":{"checked":False,"valid":False,"firstFailure":None},
                    "feasibility":{"executable":False,"reasons":[error]},"layoutSearch":{"found":False,"reason":error}}
            failures.append(error)
        else:
            result=assess(scenario,v,order,packed[0],plan_id)
            result["layoutSearch"]={"found":True,"methods":packed[1]}
            failures.extend(result["feasibility"]["reasons"])
        # Standard v3 also accepts supplied routes, which bypass solve's time
        # dimension. Check the complete trip after every evaluation, including
        # waiting, service and the depot return, without changing legacy assess.
        duration=result["totalDurationMinutes"]
        limit=scenario["rules"]["maxRouteDurationMinutes"]
        if order and duration > limit:
            reason={"type":"max_route_duration","vehicleId":v["vehicleId"],
                    "actualDurationMinutes":duration,"maxRouteDurationMinutes":limit,
                    "excessMinutes":duration-limit}
            result["feasibility"]["executable"]=False
            result["feasibility"]["reasons"].append(reason)
            failures.append(reason)
        result.update({"active":bool(order),"status":"idle" if not order else "scheduled" if result["feasibility"]["executable"] else "search_failed"})
        if not order:
            result["costs"].update({"vehicleCount":0,"vehicleFixedCost":0,"totalCost":0})
            result.update({"routeNodeIds":["DEPOT"],"legs":[]})
        results.append(result)
        budget.check_ms+=(time.perf_counter()-started)*1000
    totals={"vehicleCount":sum(r["active"] for r in results),"distanceKm":sum(r["distanceKm"] for r in results),
            "drivingMinutes":sum(r["drivingMinutes"] for r in results),"totalDurationMinutes":max(r["totalDurationMinutes"] for r in results),
            "currency":"CNY","extraHandlingMoves":0,"extraHandlingCost":0}
    for key in ("vehicleFixedCost","drivingCost","totalCost"):
        totals[key]=round(sum(r["costs"][key] for r in results),2)
    return {"planId":plan_id,"scenarioId":scenario["scenarioId"],"routes":results,"assignments":assignments,"totals":totals,
            "assignmentCheck":{"checked":True,"everyStopServedOnce":True,"everyCargoAssignedOnce":True},
            "feasibility":{"executable":not failures,"reasons":failures,"uncheckedConstraints":BOUNDARY},"globallyOptimal":False}


def plan_standard(request):
    started=time.perf_counter()
    obj(request,"request",["scenario"],["routes","allowReassignment","allowLayoutRepair","strategy","budgetMs"])
    scenario=validate_scene(request["scenario"])
    for key in ("allowReassignment","allowLayoutRepair"):
        if key in request and not isinstance(request[key],bool):fail(key,"必须为 true/false")
    strategy=request.get("strategy","joint-feedback")
    if strategy not in ("route-first", "layout-repair", "joint-feedback"):
        fail("strategy", "仅支持 route-first、layout-repair 或 joint-feedback")
    milliseconds=request.get("budgetMs",2000)
    if type(milliseconds) is not int or not 100<=milliseconds<=LIMITS["budgetMs"]:fail("budgetMs","使用 100–5000 的整数")
    budget=Budget(milliseconds,started)
    plan_id="PLAN-"+identity(request)
    revision_id="REV-"+identity(request)
    scenario_fingerprint = identity({"scenario": scenario})
    supplied=request.get("routes")
    if supplied is not None:validate_fleet_routes(scenario,supplied)
    trace,failures,options=[],[],{}
    result=None
    best=None
    feasible_candidates=[]
    initial=None
    authorization={"allowLayoutRepair":request.get("allowLayoutRepair",False),"allowReassignment":request.get("allowReassignment",False),
                   "initialPlanning":supplied is None,"automaticConfirmation":False}
    try:
        for v in scenario["vehicles"]:
            for s in scenario["stops"]:
                rows,reasons=stop_layouts(scenario,v,s["stopId"],budget,False)
                options[s["stopId"],v["vehicleId"]]=rows
                failures.extend(reasons)
        routes,error=(supplied,None) if supplied is not None else solve(scenario,budget)
        if routes is not None:
            result=evaluate_routes(scenario,routes,options,plan_id,budget)
            initial=copy.deepcopy(result)
            budget.route_attempts+=1
            trace.append({"phase":"route-first-check","routes":routes,"executable":result["feasibility"]["executable"],"failures":result["feasibility"]["reasons"]})
            if result["feasibility"]["executable"]:feasible_candidates.append(result);best=result
        elif error:failures.append(error)
        if not best and strategy in ("layout-repair", "joint-feedback"):
            if authorization["allowLayoutRepair"]:
                improved={}
                for v in scenario["vehicles"]:
                    for s in scenario["stops"]:
                        rows,reasons=stop_layouts(scenario,v,s["stopId"],budget,True)
                        improved[s["stopId"],v["vehicleId"]]=rows
                        failures.extend(reasons)
                options=improved
                if routes is not None:
                    result=evaluate_routes(scenario,routes,options,plan_id,budget)
                    budget.route_attempts+=1
                    trace.append({"phase":"alternative-layout-check","routes":routes,"executable":result["feasibility"]["executable"],"failures":result["feasibility"]["reasons"]})
                    if result["feasibility"]["executable"]:feasible_candidates.append(result);best=result
            if not best and strategy == "joint-feedback" and authorization["allowReassignment"]:
                for i in range(1,4):
                    budget.require()
                    routes,error=solve(scenario,budget,options,i)
                    if routes is None:
                        failures.append(error)
                        trace.append({"phase":"layout-feedback-routing","failure":error})
                        continue
                    result=evaluate_routes(scenario,routes,options,plan_id,budget)
                    budget.route_attempts+=1
                    trace.append({"phase":"layout-feedback-routing","routes":routes,"executable":result["feasibility"]["executable"],"failures":result["feasibility"]["reasons"]})
                    if result["feasibility"]["executable"]:
                        feasible_candidates.append(result);best=result
                        break
    except TimeoutError:
        budget.budget_exhausted = True
        trace.append({"phase":"budget-stop","reason":"统一计算预算耗尽"})
    except Exception:
        # Unexpected errors are handled by the service as SERVICE_ERROR, never
        # disguised as proof of an infeasible business request.
        raise
    def candidate_score(value):
        total_volume=sum((route.get("loadingCheck") or {}).get("totalCargoVolumeM3",0) for route in value.get("routes",[]))
        total_capacity=sum((route.get("loadingCheck") or {}).get("compartmentVolumeM3",0) for route in value.get("routes",[]) if route.get("active"))
        utilization=(total_volume/total_capacity) if total_capacity else 0
        return (value["totals"]["totalCost"],value["totals"]["totalDurationMinutes"],-utilization)
    if feasible_candidates:
        best=min(feasible_candidates,key=candidate_score)
        best["selectionObjective"]={"order":["totalCost","totalDurationMinutes","fleetSpaceUtilizationRatio"],"score":candidate_score(best),"globalOptimal":False}
    result=best or result
    changed=[]
    if best and initial:
        old=[p for r in initial["routes"] if r["placements"] for p in r["placements"]["positions"]]
        new=[p for r in best["routes"] for p in r["placements"]["positions"]]
        changed=layout_changes(old,new)
    solver_status = "FEASIBLE" if best else "TIMEOUT" if budget.budget_exhausted else "SEARCH_EXHAUSTED"
    ranked_candidates = sorted(budget.candidate_evaluations, key=lambda item: (
        not item["feasible"], -(item["spaceUtilizationRatio"] or 0), item["spanM"], item["checkedMs"]
    ))
    for rank, item in enumerate(ranked_candidates, 1):
        item["rank"] = rank
        item["rankingBasis"] = "feasible-first, then space-utilization-desc, then span-asc"
    return {"schemaVersion":"3.0.0","scenarioId":scenario["scenarioId"],"scenarioFingerprint":scenario_fingerprint,
            "planId":plan_id,"revisionId":revision_id,
            "constraintVersion":CONSTRAINT_VERSION,"executionMode":"computed-per-request","solverStatus":solver_status,
            "executable":bool(best),"source":scenario["source"],"scenario":scenario,"result":result,"initialCheck":initial,
            "confirmed":False,"authorization":authorization,"strategy":strategy,"timing":budget.timing(),
            "search":{"trace":trace,"exhausted":not bool(best),"limits":LIMITS,"notGlobalInfeasibility":not bool(best),
                      "candidateEvaluations":budget.candidate_evaluations,
                      "failureEvidence":failures[-24:],"scope":BOUNDARY},
            "revision":{"changedCargoIds":[c["cargoId"] for c in changed],"changes":changed,"requiresReloadBeforeDispatch":bool(changed),
                        "reassigned":bool(initial and best and initial["assignments"]!=best["assignments"]),
                        "reloadingCostIncluded":False,"confirmed":False},
            "unassignedStopIds":[] if result else [s["stopId"] for s in scenario["stops"]],
            "actualExecutablePlanCost":best["totals"]["totalCost"] if best else None,
            "capabilityBoundary":BOUNDARY,
            "resultSource":{"kind":"computed-per-request","service":"city-delivery-decision","inputFingerprint":scenario_fingerprint,
                            "historicalStaticComparison":False}}


def validate_standard(request):
    """Validate and normalize a scene without spending time on route planning."""
    obj(request, "request", ["scenario"], [])
    scenario = validate_scene(request["scenario"])
    return {
        "schemaVersion": "3.0.0",
        "scenarioId": scenario["scenarioId"],
        "scenarioFingerprint": identity({"scenario": scenario}),
        "constraintVersion": CONSTRAINT_VERSION,
        "executionMode": "validation-only",
        "solverStatus": "VALID",
        "valid": True,
        "scenario": scenario,
        "checkedConstraints": [
            "字段、单位与编号完整性", "订单-门店-货物唯一关联", "车辆车厢与后门范围",
            "距离/时间矩阵完整性", "时间窗格式", "已声明规则是否受支持"
        ],
        "capabilityBoundary": BOUNDARY
    }


CONTRACT = {"schemaVersion":"3.0.0","constraintVersion":CONSTRAINT_VERSION,
            "endpoint":{"method":"POST","path":"/api/city-delivery/plan-scene"},
            "validationEndpoint":{"method":"POST","path":"/api/city-delivery/validate-scene"},
            "status":{"FEASIBLE":"所有已声明约束已检查，待用户确认", "SEARCH_EXHAUSTED":"本次预算或有限布局/路线集合未找到可行计划，不是全局无解",
                      "INPUT_INVALID":"输入缺失、单位、关联或不支持规则，HTTP 422", "SERVICE_ERROR":"计算发生异常，HTTP 500",
                      "TIMEOUT":"服务硬超时，HTTP 504", "BUSY":"计算槽位已满，HTTP 503"},
            "limits":LIMITS,"units":{"dimensions":"m","weight":"kg","distance":"km","time":"minutes","currency":"CNY"},
            "rules":{"extraction":"rear-door-straight-positive-z","allowExtraHandling":False,"minimumSupportRatio":1,
                     "fragileRule":"no-load-on-fragile","maxRouteDurationMinutes":480,"supportRule":"full-footprint",
                     "timeWindowRule":"service-start","loadBearingRule":"area-proportional"},
            "strategies":{"route-first":"先求路线，再检查主布局；不使用几何反馈。",
                         "layout-repair":"固定第一次路线，只在同一路线下尝试有限替代布局；不改车、不改路线。",
                         "joint-feedback":"布局失败后，在授权范围内尝试替代布局，再尝试换车或改路线。"},
            "authorization":"改变用户提交的车辆/路线须 allowReassignment=true，替代布局须 allowLayoutRepair=true；不自动确认结果。",
            "capabilityBoundary":BOUNDARY}
