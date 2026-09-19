import {
  evaluateContextRules,
  openV2SqliteStore,
  provisionV2ManufacturingDemoData,
} from "../../domain/v2/index.js";

const store = openV2SqliteStore();
const provisioned = provisionV2ManufacturingDemoData(store);
const evaluated = evaluateContextRules(store, "demo-manufacturing", "ctx-so-mfg-001");

console.log(JSON.stringify({
  contextId: provisioned.contextId,
  provisioned,
  evaluations: evaluated?.evaluations.length ?? 0,
  matched: evaluated?.results.filter((item) => item.evaluation.status === "matched").length ?? 0,
  notMatched: evaluated?.results.filter((item) => item.evaluation.status === "not_matched").length ?? 0,
  exceptions: evaluated?.exceptions.length ?? 0,
}, null, 2));
