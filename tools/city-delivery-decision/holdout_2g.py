"""Reserved 10-stop holdout run for Phase 2G; it does not alter v1/v2."""
import copy, json, statistics, time
from pathlib import Path

from evidence_v3 import standardize
from standard import plan_standard, validate_scene

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "artifacts/phase2g-final/holdout"


def scene():
    source = json.loads((ROOT / "frontend/public/demo/city-delivery/v2/scenario.json").read_text())
    s = standardize(source)
    s["scenarioId"] = "city-delivery-holdout-010"
    s["name"] = "保留验证 · 十店异构车辆场景"
    s["source"] = {"dataType": "synthetic", "name": "Phase 2G reserved holdout",
                   "description": "在算法对照生成后保留的独立合成验证输入；不是传化企业数据。",
                   "license": "project-owned-synthetic", "authorization": "项目内验证授权。"}
    s["stops"] = copy.deepcopy(s["stops"][:9])
    s["stops"].append({"stopId": "S10", "name": "保留门店 10", "x": 5, "y": 4,
                       "color": "#D68A78", "address": "保留街区位置",
                       "timeWindow": {"start": "08:00", "end": "11:30"}, "serviceDurationMinutes": 7})
    s["cargo"] = []
    for i, stop in enumerate(s["stops"]):
        for j in range(2):
            fragile = (i + j) % 5 == 0
            s["cargo"].append({"cargoId": f"H-{i+1:02d}-{j+1}", "orderId": f"H-ORDER-{i+1:02d}",
                               "stopId": stop["stopId"], "name": "保留验证包装件",
                               "length": round(0.62 + (i % 3) * .12 + j * .06, 2),
                               "width": round(.5 + (i % 2) * .08, 2), "height": .62,
                               "weightKg": round(15.5 + i * 1.4 + j * 2.2, 2),
                               "fragile": fragile, "maxTopLoadKg": 0 if fragile else 28,
                               "orientation": {"uprightOnly": True, "allowedYawDegrees": [0, 90]},
                               "color": stop["color"]})
    s["orders"] = [{"orderId": f"H-ORDER-{i+1:02d}", "stopId": stop["stopId"],
                    "cargoIds": [c["cargoId"] for c in s["cargo"] if c["stopId"] == stop["stopId"]]}
                   for i, stop in enumerate(s["stops"])]
    s["vehicles"] = [
        {"vehicleId": "H-V01", "name": "保留厢式车", "maxPayloadKg": 300,
         "compartment": {"length": 5.2, "width": 1.9, "height": 2.0},
         "rearDoor": {"axis": "z", "position": 5.2, "xMin": 0, "xMax": 1.9, "yMin": 0, "yMax": 2.0},
         "costs": {"vehicleFixedCost": 70, "drivingCostPerKm": 5.2}},
        {"vehicleId": "H-V02", "name": "中型厢式车", "maxPayloadKg": 420,
         "compartment": {"length": 6.6, "width": 2.2, "height": 2.1},
         "rearDoor": {"axis": "z", "position": 6.6, "xMin": 0, "xMax": 2.2, "yMin": 0, "yMax": 2.1},
         "costs": {"vehicleFixedCost": 92, "drivingCostPerKm": 5.8}},
        {"vehicleId": "H-V03", "name": "长厢配送车", "maxPayloadKg": 560,
         "compartment": {"length": 8.0, "width": 2.45, "height": 2.3},
         "rearDoor": {"axis": "z", "position": 8.0, "xMin": 0, "xMax": 2.45, "yMin": 0, "yMax": 2.3},
         "costs": {"vehicleFixedCost": 118, "drivingCostPerKm": 6.3}},
    ]
    nodes = [s["warehouse"], *s["stops"]]
    matrix = [[0 if a["stopId"] == b["stopId"] else round(abs(a["x"] - b["x"]) + abs(a["y"] - b["y"]), 2) for b in nodes] for a in nodes]
    s["routing"] = {"nodeIds": [n["stopId"] for n in nodes], "distanceMatrixKm": matrix,
                     "travelTimeMatrixMinutes": [[round(v * 2, 2) for v in row] for row in matrix], "returnToDepot": True}
    s["departureTime"] = "08:00"
    return s


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    s = scene(); validate_scene(s)
    (OUT / "scenario.json").write_text(json.dumps(s, ensure_ascii=False, indent=2) + "\n")
    rows = []
    for strategy, flags in [("route-first", {"allowLayoutRepair": False, "allowReassignment": False}),
                            ("layout-repair", {"allowLayoutRepair": True, "allowReassignment": False}),
                            ("joint-feedback", {"allowLayoutRepair": True, "allowReassignment": True})]:
        for repeat in range(3):
            request = {"scenario": s, "strategy": strategy, "budgetMs": 2000, **flags}
            started = time.perf_counter(); result = plan_standard(request); wall = (time.perf_counter() - started) * 1000
            rows.append({"strategy": strategy, "repeat": repeat, "solverStatus": result["solverStatus"],
                         "executable": result["executable"], "actualExecutablePlanCost": result["actualExecutablePlanCost"],
                         "changedCargoCount": len(result["revision"]["changedCargoIds"]), "wallMs": round(wall, 3),
                         "timing": result["timing"], "failureEvidence": result["search"]["failureEvidence"][-6:]})
            if repeat == 0:
                (OUT / f"{strategy}.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    report = {"scenarioId": s["scenarioId"], "stopCount": len(s["stops"]), "cargoCount": len(s["cargo"]),
              "vehicleCount": len(s["vehicles"]), "sameBudgetMs": 2000, "rows": rows,
              "scope": "独立保留合成输入；用于验证可复核性，不代表生产规模或企业收益。"}
    (OUT / "comparison.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
