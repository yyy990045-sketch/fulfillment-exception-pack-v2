import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  V2SqliteStore,
  evaluateContextRules,
  provisionV2ManufacturingDemoData,
  type SqliteDatabaseLike,
} from "../../domain/v2/index.js";
import { resolveRootCauseProvider } from "./registry.js";
import { generateRootCauseAnalysis } from "./service.js";

type DatabaseSyncConstructor = new (path: string) => SqliteDatabaseLike & { close?(): void };

function blocked(blocker: string) {
  const summary = {
    schemaVersion: "root-cause-real-provider/v1",
    realRootCauseLlmVerified: false,
    provider: "openai",
    cases: {
      customerClaim: { generated: false, validationValid: false, error: blocker },
      quality: { generated: false, validationValid: false, error: blocker },
      payment: { generated: false, validationValid: false, error: blocker },
    },
    blocker,
  };
  const rawPath = resolve("data/runtime/root-cause-8b-verification.json");
  const summaryPath = resolve("docs/competition/runtime/root-cause-8b-summary.json");
  mkdirSync(dirname(rawPath), { recursive: true });
  mkdirSync(dirname(summaryPath), { recursive: true });
  writeFileSync(rawPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  return summary;
}

export async function runRootCauseRealVerification(env: Record<string, string | undefined> = process.env) {
  if (env.REAL_ROOT_CAUSE_LLM_VERIFICATION !== "true") return { status: "disabled" as const };
  if (env.ROOT_CAUSE_AI_PROVIDER?.trim() !== "openai") return { status: "blocked" as const, summary: blocked("ROOT_CAUSE_PROVIDER_NOT_CONFIGURED") };
  if (!env.OPENAI_API_KEY?.trim()) return { status: "blocked" as const, summary: blocked("OPENAI_API_KEY_NOT_CONFIGURED") };
  if (!env.OPENAI_ROOT_CAUSE_MODEL?.trim()) return { status: "blocked" as const, summary: blocked("OPENAI_ROOT_CAUSE_MODEL_NOT_CONFIGURED") };

  const provider = resolveRootCauseProvider({ env });
  const dir = mkdtempSync(join(tmpdir(), "fep-root-cause-live-"));
  const builtin = process.getBuiltinModule?.("node:sqlite") as { DatabaseSync?: DatabaseSyncConstructor } | undefined;
  if (!builtin?.DatabaseSync) throw new Error("sqlite_backend_requires_node_22_5_or_newer");
  const database = new builtin.DatabaseSync(join(dir, "root-cause-live.sqlite"));
  const store = new V2SqliteStore(database);
  try {
    provisionV2ManufacturingDemoData(store);
    evaluateContextRules(store, "demo-manufacturing", "ctx-so-mfg-001");
    const codeMap = new Map(store.listExceptions("demo-manufacturing", "ctx-so-mfg-001").map((item) => [item.code, item.id]));
    const cases: Record<string, { generated: boolean; validationValid: boolean; error?: string }> = {};
    for (const [name, code] of [["customerClaim", "CUSTOMER_RECEIPT_CLAIM_MISMATCH"], ["quality", "QUALITY_NONCONFORMING_QUANTITY_DETECTED"], ["payment", "PAYMENT_BALANCE_OUTSTANDING"]] as const) {
      try {
        const result = await generateRootCauseAnalysis(store, provider, "demo-manufacturing", "ctx-so-mfg-001", codeMap.get(code)!, "real-root-cause-verification");
        cases[name] = { generated: result.status === "generated", validationValid: result.validation.valid };
      } catch (error) {
        cases[name] = { generated: false, validationValid: false, error: error instanceof Error ? error.name : "ROOT_CAUSE_PROVIDER_FAILURE" };
      }
    }
    const verified = Object.values(cases).every((item) => item.generated && item.validationValid);
    const summary = {
      schemaVersion: "root-cause-real-provider/v1",
      realRootCauseLlmVerified: verified,
      provider: "openai",
      cases,
      blocker: verified ? null : "REAL_ROOT_CAUSE_LLM_VERIFICATION_FAILED",
    };
    const rawPath = resolve("data/runtime/root-cause-8b-verification.json");
    const summaryPath = resolve("docs/competition/runtime/root-cause-8b-summary.json");
    mkdirSync(dirname(rawPath), { recursive: true });
    mkdirSync(dirname(summaryPath), { recursive: true });
    writeFileSync(rawPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
    writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
    return { status: verified ? "passed" as const : "failed" as const, summary };
  } finally {
    database.close?.();
    rmSync(dir, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await runRootCauseRealVerification();
  console.log(JSON.stringify(result, null, 2));
}
