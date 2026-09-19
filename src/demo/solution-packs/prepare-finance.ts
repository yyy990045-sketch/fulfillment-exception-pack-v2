import { evaluateContextRules, openV2SqliteStore } from "../../domain/v2/index.js";
import { financeReconciliationPack, registerBuiltInSolutionPacks } from "../../solution-packs/index.js";

export function prepareFinancePackDemo() {
  registerBuiltInSolutionPacks();
  const store = openV2SqliteStore();
  financeReconciliationPack.install(store, "demo-finance", "demo-system");
  const provisioned = financeReconciliationPack.provisionDemo?.(store, "demo-finance", "demo-system");
  const evaluated = evaluateContextRules(store, "demo-finance", "ctx-fin-rec-001")!;
  return {
    provisioned,
    evaluations: evaluated.evaluations.length,
    matched: evaluated.evaluations.filter((item) => item.status === "matched").length,
    notMatched: evaluated.evaluations.filter((item) => item.status === "not_matched").length,
    exceptions: evaluated.exceptions.length,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(prepareFinancePackDemo(), null, 2));
}
