import { evaluateContextRules, openV2SqliteStore, provisionV2ManufacturingDemoData } from "../../domain/v2/index.js";
import { registerBuiltInSolutionPacks } from "../../solution-packs/index.js";
import { prepareFinancePackDemo } from "./prepare-finance.js";

if (import.meta.url === `file://${process.argv[1]}`) {
  registerBuiltInSolutionPacks();
  const manufacturing = provisionV2ManufacturingDemoData();
  const manufacturingRules = evaluateContextRules(openV2SqliteStore(), "demo-manufacturing", "ctx-so-mfg-001")!;
  const finance = prepareFinancePackDemo();
  console.log(JSON.stringify({
    manufacturing,
    manufacturingRules: {
      evaluations: manufacturingRules.evaluations.length,
      matched: manufacturingRules.evaluations.filter((item) => item.status === "matched").length,
      notMatched: manufacturingRules.evaluations.filter((item) => item.status === "not_matched").length,
      exceptions: manufacturingRules.exceptions.length,
    },
    finance,
  }, null, 2));
}
