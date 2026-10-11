"""Bounded business replay: actual user changes, fleet assignment, geometry."""
import copy
import json
from decision import V2, checks, assess, fingerprint_v1, revise_order, revise_fleet, scoped_scenario


def frozen_shape(value):
    """Frozen v2 predates the two additive display metrics; retain all other facts."""
    if isinstance(value, dict):
        return {key: frozen_shape(item) for key, item in value.items()
                if key not in ("spaceUtilizationRatio", "spaceUtilizationPercent")}
    if isinstance(value, list):
        return [frozen_shape(item) for item in value]
    return value


def replay(scenario, result):
    vehicle = next(v for v in scenario["vehicles"] if v["vehicleId"] == result["vehicleId"])
    positions = result["placements"]["positions"]
    scoped = scoped_scenario(scenario, vehicle, result["stopOrder"])
    geometry = checks.geometry(scoped, positions)
    assert frozen_shape(geometry) == frozen_shape(result["loadingCheck"])
    check = assess(scenario, vehicle, result["stopOrder"], positions, result["planId"])
    assert check["unloading"] == result["unloading"]
    assert check["timeWindowCheck"] == result["timeWindowCheck"]
    if result.get("active", True):
        assert check["costs"] == result["costs"]
    else:
        assert result["costs"]["totalCost"] == 0
    remaining = {p["cargoId"]: p for p in positions}
    stopped = False
    for step in result["unloading"]["steps"]:
        assert not stopped
        assert sorted(remaining) == step["remainingCargoIdsBefore"]
        if step["operation"] == "unload":
            cargo = remaining[step["cargoId"]]
            assert cargo["stopId"] == step["stopId"]
            assert checks.obstruction(scoped, cargo, list(remaining.values()), geometry["cargoChecks"])["canUnload"]
            assert step["movement"]["from"] == {k: cargo[k] for k in ("x", "y", "z")}
            assert step["movement"]["to"]["z"] > vehicle["rearDoor"]["position"]
            del remaining[step["cargoId"]]
        assert sorted(remaining) == step["remainingCargoIdsAfter"]
        stopped = step["operation"] == "blocked"
    assert sorted(remaining) == result["unloading"]["finalRemainingCargoIds"]


def verify():
    before = fingerprint_v1()
    manifest = json.loads((V2 / "manifest.json").read_text())
    assert manifest["v1Protection"]["sha256"] == before
    examples = json.loads((V2 / "order-adjustment-examples.json").read_text())["examples"]
    for example in examples:
        response = revise_order(example["request"])
        assert frozen_shape(response) == frozen_shape(example["response"])
        replay(response["scenario"], response["originalLayoutCheck"])
        replay(response["scenario"], response["result"])
    assert examples[0]["response"]["originalLayoutReusable"]
    assert examples[1]["response"]["revision"]["status"] == "revised"
    assert examples[1]["response"]["executable"]
    assert examples[1]["response"]["result"]["stopOrder"] not in (["S01", "S02", "S03", "S04"], ["S02", "S01", "S04", "S03"])
    assert not examples[2]["response"]["executable"] and examples[2]["response"]["revision"]["status"] == "not_repaired"
    assert not examples[3]["response"]["executable"] and examples[3]["response"]["result"]["unloadingCheck"]["valid"]
    assert any(r["type"] == "time_window" for r in examples[3]["response"]["result"]["feasibility"]["reasons"])
    malformed = copy.deepcopy(examples[0]["request"])
    malformed["stopOrder"] = ["S01", "S01", "S02", "S03"]
    try:
        revise_order(malformed)
    except ValueError:
        pass
    else:
        raise AssertionError("Duplicate store accepted")
    scenario = json.loads((V2 / "scenario.json").read_text())
    plans = json.loads((V2 / "plans.json").read_text())["plans"]
    placements = json.loads((V2 / "placements.json").read_text())["plans"]
    operations = json.loads((V2 / "unloading-steps.json").read_text())["plans"]
    comparison = json.loads((V2 / "comparison.json").read_text())
    for p in plans:
        assert p["feasibility"]["executable"]
        assigned = [cid for a in p["assignments"] for cid in a["cargoIds"]]
        assert len(assigned) == len(set(assigned)) == len(scenario["cargo"]) == 36
        assert {a["stopId"] for a in p["assignments"]} == {s["stopId"] for s in scenario["stops"]}
        assert {r["vehicleId"] for r in p["routes"]} == {v["vehicleId"] for v in scenario["vehicles"]}
        for r in p["routes"]:
            replay(scenario, r)
            assert not r["unloading"]["finalRemainingCargoIds"]
            assert r["vehicleId"] == r["placements"]["vehicleId"] == r["unloading"]["vehicleId"]
            for cp in r["placements"]["positions"]:
                a = next(a for a in p["assignments"] if a["stopId"] == cp["stopId"])
                assert cp["vehicleId"] == a["vehicleId"] and cp["cargoId"] in a["cargoIds"]
        assert next(pp for pp in placements if pp["planId"] == p["planId"])["vehicles"] == [r["placements"] for r in p["routes"]]
        assert next(pp for pp in operations if pp["planId"] == p["planId"])["vehicles"] == [r["unloading"] for r in p["routes"]]
        c = next(c for c in comparison["plans"] if c["planId"] == p["planId"])
        assert all(c[k] == v for k, v in p["totals"].items())
    for key, change in comparison["delta"].items():
        if key != "direction":
            assert abs(change - (plans[1]["totals"][key] - plans[0]["totals"][key])) < 1e-6
    fleet = json.loads((V2 / "fleet-adjustment-example.json").read_text())
    actual = revise_fleet(fleet["request"])
    assert not actual["submittedCheck"]["feasibility"]["executable"] and actual["executable"]
    assert any(reason["type"] == "stop_geometry" for reason in actual["submittedCheck"]["feasibility"]["reasons"])
    refusal = revise_fleet({**fleet["request"], "allowReassignment": False})
    assert not refusal["executable"] and not refusal["revision"]["reallocated"]
    assert fingerprint_v1() == before
    print(json.dumps({"ready": True, "v1Unchanged": True, "singleVehicle": "computed order impact / reuse / repair / late arrival rejection",
                      "fleet": "unique assignment / independent geometry / exact unload replay / explicit reallocation",
                      "comparison": comparison["delta"]}, ensure_ascii=False))


if __name__ == "__main__":
    verify()
