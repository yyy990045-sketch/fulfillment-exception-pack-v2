import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

export const MANIFEST_PATH = "release/competition-manifest.json";
export const COMMIT_SHA_SENTINEL = "STAMPED_IN_DIST_BUNDLE";

const FALSE_FLAGS = [
  "REAL_CUSTOMER_VERIFIED",
  "REAL_FACTORY_VERIFIED",
  "REAL_MES_VERIFIED",
  "REAL_OPEN_SUPOS_RUNTIME_VERIFIED",
  "PRODUCTION_DEPLOYMENT_VERIFIED",
];
const TRUE_FLAGS = [
  "OPEN_SOURCE_GOVERNANCE_IMPLEMENTED",
  "DEPENDENCY_LICENSE_AUDIT_LOCALLY_VERIFIED",
  "SBOM_GENERATED",
  "COMPETITION_CLEAN_ROOM_VERIFIED",
  "COMPETITION_ACCEPTANCE_LOCALLY_VERIFIED",
  "COMPETITION_RELEASE_PACKAGE_VERIFIED",
  "TRUTH_CLAIM_AUDIT_LOCALLY_VERIFIED",
];

export async function loadManifest(root, relative = MANIFEST_PATH) {
  return JSON.parse(await readFile(resolve(root, relative), "utf8"));
}

export function validateCompetitionManifest(manifest, head) {
  const errors = [];
  const requireEqual = (path, actual, expected) => {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) errors.push(`${path} expected ${JSON.stringify(expected)}`);
  };
  requireEqual("projectName", manifest.projectName, "fulfillment-exception-pack");
  requireEqual("version", manifest.version, "0.1.0");
  requireEqual("versionLine", manifest.versionLine, "competition-candidate-pre-1.0");
  requireEqual("releaseTag", manifest.releaseTag, "competition-v0.1.0");
  requireEqual("judgeScenario", manifest.judgeScenario, "production-shortfall");
  requireEqual("judgeCommand", manifest.judgeCommand, "npm run demo:judge");
  if (manifest.commitSha === COMMIT_SHA_SENTINEL) {
    if (!head) errors.push("commitSha sentinel requires a git HEAD");
  } else if (manifest.commitSha !== head) {
    errors.push("commitSha does not match git HEAD");
  }
  for (const flag of FALSE_FLAGS) {
    if (manifest.truthFlags?.[flag] !== false) errors.push(`${flag} must stay false`);
  }
  requireEqual("truthBoundary", manifest.truthBoundary, {
    realCustomerVerified: false,
    realFactoryVerified: false,
    realMesVerified: false,
    realOpenSuposRuntimeVerified: false,
    productionDeploymentVerified: false,
  });
  for (const flag of TRUE_FLAGS) {
    if (manifest.truthFlags?.[flag] !== true) errors.push(`${flag} must be true only after the corresponding local check is part of the seal`);
  }
  for (const name of ["real-customer", "real-factory", "real-mes", "production-deployment"]) {
    if (!manifest.notVerifiedCapabilities?.includes(name)) errors.push(`notVerifiedCapabilities missing ${name}`);
    if (manifest.locallyVerifiedCapabilities?.includes(name)) errors.push(`${name} must not be listed as locally verified`);
  }
  for (const name of ["project-license-decision", "current-environment-superset-embed", "real-open-supos-runtime"]) {
    if (!manifest.blockedCapabilities?.includes(name)) errors.push(`blockedCapabilities missing ${name}`);
  }
  requireEqual("optionalIntegrations.superset", manifest.optionalIntegrations?.superset, {
    SUPERSET_EMBED_IMPLEMENTED: true,
    SUPERSET_LOCAL_DASHBOARD_VERIFIED: true,
    CURRENT_ENV_SUPERSET_VERIFY: "BLOCKED_BY_ENVIRONMENT",
    note: "SUPERSET_LOCAL_DASHBOARD_VERIFIED records earlier local historical evidence. This environment has not rerun that check.",
  });
  requireEqual("optionalIntegrations.openSupos", manifest.optionalIntegrations?.openSupos, {
    OpenSuposInboundConnector: "IMPLEMENTED",
    unsMqttContract: "LOCALLY_VERIFIED",
    REAL_OPEN_SUPOS_RUNTIME: "NOT_VERIFIED",
  });
  requireEqual("optionalIntegrations.powerbi.runtime", manifest.optionalIntegrations?.powerbi?.runtime, "NOT_VERIFIED");
  requireEqual("optionalIntegrations.jev.runtime", manifest.optionalIntegrations?.jev?.runtime, "NOT_VERIFIED");
  requireEqual("optionalIntegrations.jev.realCustomerDecisionQualityVerified", manifest.optionalIntegrations?.jev?.realCustomerDecisionQualityVerified, false);
  if (manifest.requiredRuntime?.coreDemoExternalServices !== false) errors.push("core demo must not require external services");
  return errors;
}

export function gitHead(root) {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
}
