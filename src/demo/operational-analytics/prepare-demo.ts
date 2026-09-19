import {
  evaluateContextRules,
  openV2SqliteStore,
  provisionV2ManufacturingDemoData,
} from "../../domain/v2/index.js";
import { provisionOperationalPortfolio } from "./provision-portfolio.js";

const store = openV2SqliteStore();
provisionV2ManufacturingDemoData(store);
evaluateContextRules(store, "demo-manufacturing", "ctx-so-mfg-001");
const portfolio = provisionOperationalPortfolio(store);

console.log(JSON.stringify({
  tenantId: "demo-manufacturing",
  heroContextId: "ctx-so-mfg-001",
  portfolio,
  totals: {
    contexts: store.listContexts("demo-manufacturing").length,
    ruleEvaluations: store.listContexts("demo-manufacturing").reduce((sum, context) => sum + store.listRuleEvaluations("demo-manufacturing", context.id).length, 0),
    exceptions: store.listContexts("demo-manufacturing").reduce((sum, context) => sum + store.listExceptions("demo-manufacturing", context.id).length, 0),
    resolutionCases: store.listContexts("demo-manufacturing").reduce((sum, context) => sum + store.listResolutionCases("demo-manufacturing", context.id).length, 0),
  },
}, null, 2));
