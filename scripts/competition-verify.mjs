import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { gitHead, loadManifest, validateCompetitionManifest } from "./competition-manifest.mjs";

const exec = promisify(execFile);
const root = process.cwd();

async function run(label, command, args) {
  console.log(`\n== ${label} ==`);
  try {
    const result = await exec(command, args, { cwd: root, maxBuffer: 64 * 1024 * 1024 });
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    return result.stdout;
  } catch (error) {
    process.stdout.write(error.stdout ?? "");
    process.stderr.write(error.stderr ?? "");
    console.error(`BLOCKED: ${label}`);
    return null;
  }
}

const doctor = await run("01 environment doctor", "npm", ["run", "competition:doctor"]);
if (doctor === null) process.exit(1);
if (await run("02 typecheck", "npm", ["run", "typecheck"]) === null) process.exit(1);
if (await run("03 core tests", "npm", ["test"]) === null) process.exit(1);
if (await run("04 industrial simulator", "npm", ["run", "simulator:verify"]) === null) process.exit(1);
const judge = await run("05 judge demo", "npm", ["run", "demo:judge"]);
if (judge === null) process.exit(1);
const contextId = judge.match(/contextId\s*=\s*(\S+)/)?.[1];
if (!contextId) {
  console.error("BLOCKED: 05 judge demo did not expose a context id");
  process.exit(1);
}
if (await run("06 evidence verify", "npm", ["run", "evidence:verify", "--", "--context", contextId]) === null) process.exit(1);
if (await run("07 evidence-broken gate", "npm", ["run", "demo:judge", "--", "--scenario", "evidence-broken"]) === null) process.exit(1);
if (await run("08 replay/idempotency", "npm", ["test", "--", "tests/industrial-scenarios-ab.test.ts"]) === null) process.exit(1);
if (await run("09 backup verification", "npm", ["run", "db:verify-backup"]) === null) process.exit(1);
if (await run("10 recovery drill", "npm", ["run", "ops:recovery-drill"]) === null) process.exit(1);
if (await run("11 license verification", "npm", ["run", "licenses:verify"]) === null) process.exit(1);

console.log("\n== 12 SBOM presence ==");
try {
  const bom = JSON.parse(await readFile(resolve(root, "artifacts/sbom.cdx.json"), "utf8"));
  const coverage = bom.metadata?.properties?.find((item) => item.name === "coverage")?.value ?? "";
  if (bom.bomFormat !== "CycloneDX" || !Array.isArray(bom.components) || bom.components.length === 0 || !coverage.includes("backend") || !coverage.includes("frontend")) {
    throw new Error("SBOM_INVALID");
  }
  console.log(`SBOM_PRESENT components=${bom.components.length} coverage=${coverage}`);
} catch {
  console.error("BLOCKED: 12 SBOM presence");
  process.exit(1);
}

console.log("\n== 13 truth manifest validation ==");
const manifestErrors = validateCompetitionManifest(await loadManifest(root), gitHead(root));
if (manifestErrors.length) {
  for (const error of manifestErrors) console.error(`MANIFEST ${error}`);
  console.error("BLOCKED: 13 truth manifest validation");
  process.exit(1);
}
if (await run("13 truth audit", "npm", ["run", "truth:audit"]) === null) process.exit(1);
console.log("COMPETITION_ACCEPTANCE_VERIFIED");
