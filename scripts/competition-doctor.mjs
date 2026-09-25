import { access, constants, readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";

const exec = promisify(execFile);
const root = process.cwd();
const checks = [];
const add = (name, ok, detail) => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "OK" : "BLOCKED"}: ${name} — ${detail}`);
};
const info = (name, detail) => console.log(`INFO: ${name} — ${detail}`);
const exists = (relative) => access(resolve(root, relative)).then(() => true).catch(() => false);

const [major, minor] = process.versions.node.split(".").map(Number);
add("Node >= 22.5", major > 22 || (major === 22 && minor >= 5), process.version);
try {
  const version = (await exec("npm", ["--version"], { cwd: root })).stdout.trim();
  add("npm available", version.length > 0, version);
} catch {
  add("npm available", false, "npm not executable");
}

const required = [
  "README.md",
  "CONTRIBUTING.md",
  "CODE_OF_CONDUCT.md",
  "SECURITY.md",
  "CHANGELOG.md",
  "package.json",
  "package-lock.json",
  ".gitignore",
  "docs/competition/release-notes.md",
  "docs/competition/judge-acceptance-matrix.md",
  "docs/competition/architecture-one-page.md",
  "docs/industrial",
  "docs/open-source/license-audit.md",
  "docs/open-source/third-party-dependencies.md",
  "docs/open-source/license-exceptions.json",
  "docs/open-source/governance-audit.md",
  "release/competition-manifest.json",
  "artifacts/sbom.cdx.json",
  ".github/ISSUE_TEMPLATE/bug_report.yml",
  ".github/ISSUE_TEMPLATE/feature_request.yml",
  ".github/ISSUE_TEMPLATE/integration_request.yml",
  ".github/PULL_REQUEST_TEMPLATE.md",
];
for (const relative of required) add(`required ${relative}`, await exists(relative), "repository file");
if (await exists("LICENSE")) info("LICENSE", "present");
else info("LICENSE", "LICENSE_DECISION_REQUIRED");
if (await exists(".github/workflows")) info("release workflow", "present");
else info("release workflow", "MISSING; not invented in this seal");

const pkg = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
for (const script of ["demo:judge", "evidence:verify", "simulator:verify", "typecheck", "test", "licenses:verify", "sbom", "secrets:scan", "truth:audit", "competition:verify", "competition:clean-room", "competition:package"]) {
  add(`script ${script}`, typeof pkg.scripts?.[script] === "string", pkg.scripts?.[script] ?? "missing");
}
add("dependencies installed", await exists("node_modules/vitest") && await exists("node_modules/react"), "node_modules present");

let head = "";
try {
  head = (await exec("git", ["rev-parse", "HEAD"], { cwd: root })).stdout.trim();
  add("git commit", /^[0-9a-f]{40}$/.test(head), head);
} catch {
  add("git commit", false, "git rev-parse failed");
}
try {
  const dirty = (await exec("git", ["status", "--porcelain"], { cwd: root })).stdout.trim();
  add("git clean", dirty.length === 0, dirty.length === 0 ? "clean" : "working tree has changes");
} catch {
  add("git clean", false, "git status failed");
}

try {
  await access(root, constants.W_OK);
  const sqlite = process.getBuiltinModule?.("node:sqlite");
  add("db writable", typeof sqlite?.DatabaseSync === "function", "repository parent is writable and node:sqlite is available");
} catch {
  add("db writable", false, "repository is not writable or node:sqlite is missing");
}
try {
  await access(root, constants.W_OK);
  if (await exists(".preview")) await access(resolve(root, ".preview"), constants.W_OK);
  add("judge workspace writable", true, ".preview parent is writable");
} catch {
  add("judge workspace writable", false, "judge workspace parent is not writable");
}

const requiredEnv = ["SUPERSET_REQUIRED", "POWERBI_REQUIRED", "OPEN_SUPOS_REQUIRED", "JEV_REQUIRED"];
const forced = requiredEnv.filter((key) => process.env[key] === "true");
add("demo mode", pkg.scripts?.["demo:judge"] === "tsx src/demo/judge/cli.ts" && forced.length === 0, forced.length ? `external integration forced: ${forced.join(",")}` : "production-shortfall; Docker, Superset, Power BI, open supOS, JEV and MQTT are not required");

const optional = {
  superset: ["SUPERSET_DOMAIN", "SUPERSET_DASHBOARD_ID"],
  openSupos: ["OPEN_SUPOS_ENABLED", "OPEN_SUPOS_MQTT_URL"],
  powerbi: ["POWERBI_CLIENT_ID", "POWERBI_TENANT_ID"],
  jev: ["JEV_ENABLED", "JEV_BASE_URL"],
};
for (const [name, keys] of Object.entries(optional)) {
  const configured = keys.some((key) => Boolean(process.env[key]));
  info(`optional ${name}`, configured ? "configured; values are not printed" : "not configured");
}

try {
  await exec("node", ["scripts/secret-scan.mjs"], { cwd: root, maxBuffer: 8 * 1024 * 1024 });
  add("secret scan", true, "no credential patterns in tracked files");
} catch (error) {
  process.stderr.write(error.stderr ?? "");
  process.stdout.write(error.stdout ?? "");
  add("secret scan", false, "credential pattern found; value was not printed");
}

if (checks.every((check) => check.ok)) console.log("COMPETITION_ENV_READY");
else {
  console.error("COMPETITION_ENV_BLOCKED");
  process.exitCode = 1;
}
