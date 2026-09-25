import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { resolve } from "node:path";

const exec = promisify(execFile);
const root = process.cwd();
const canonicalChain = "Industrial Systems → open supOS / UNS boundary → Semantic Mapping → Evidence → Exception → AI Assistance → Human Governance → Execution → Outcome → Analytics";
const claimPatterns = [
  /真实工厂已验证/,
  /真实\s*MES\s*已(?:接入|验证)/,
  /真实客户已验证/,
  /production verified/i,
  /real factory verified/i,
  /real customer verified/i,
  /open supOS runtime verified/i,
  /真实 open supOS 运行时已验证/,
  /AI\s*自动批准/,
  /自动执行已(?:上线|验证)/,
];
const negation = /不是|未验证|未接入|没有|禁止|不能|不得|不会|不把|不主张|并非|尚未|false|NOT_VERIFIED|NOT_IMPLEMENTED|BLOCKED/;
const falseFlag = /(REAL_CUSTOMER_VERIFIED|REAL_FACTORY_VERIFIED|REAL_MES_VERIFIED|REAL_OPEN_SUPOS_RUNTIME_VERIFIED|PRODUCTION_DEPLOYMENT_VERIFIED)\s*[:=]\s*true\b/;
const listed = await exec("git", ["ls-files", "-z"], { cwd: root, maxBuffer: 8 * 1024 * 1024 });
const files = listed.stdout.split("\0").filter(Boolean);
const overclaims = [];
const falseFlags = [];
for (const file of files) {
  if (!/\.(md|json|yml|yaml|ts|tsx|mjs)$/.test(file) || file === "docs/open-source/truth-audit.json" || file === "package-lock.json" || file === "artifacts/sbom.cdx.json") continue;
  const text = await readFile(resolve(root, file), "utf8");
  text.split("\n").forEach((line, index) => {
    if (falseFlag.test(line)) falseFlags.push(`${file}:${index + 1}`);
    const competitionFacing = file === "README.md" || file === "CONTRIBUTING.md" || file === "CHANGELOG.md" || file === "SECURITY.md" || file.startsWith("docs/competition/") || file.startsWith("docs/industrial/") || file.startsWith("docs/open-source/") || file.startsWith("release/");
    if (!competitionFacing) return;
    if (claimPatterns.some((pattern) => pattern.test(line)) && !negation.test(line)) overclaims.push(`${file}:${index + 1}`);
  });
}
const readme = await readFile(resolve(root, "README.md"), "utf8");
const architecture = await readFile(resolve(root, "docs/competition/architecture-one-page.md"), "utf8");
const missingMarkers = [];
if (!readme.includes("High-Fidelity Simulated Industrial Environment")) missingMarkers.push("README simulated-environment marker");
if (!readme.includes(canonicalChain) || !architecture.includes(canonicalChain)) missingMarkers.push("canonical architecture chain");
const report = {
  status: overclaims.length || falseFlags.length || missingMarkers.length ? "TRUTH_CLAIM_AUDIT_BLOCKED" : "TRUTH_CLAIM_AUDIT_LOCALLY_VERIFIED",
  canonicalChain,
  missingMarkers,
  overclaims,
  falseFlags,
  historicalPublicAddressNote: "A historical handoff document still names a public host and SSH target. That is not a credential. Remove it before a public release.",
};
await mkdir(resolve(root, "docs/open-source"), { recursive: true });
await writeFile(resolve(root, "docs/open-source/truth-audit.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(report.status);
if (report.status !== "TRUTH_CLAIM_AUDIT_LOCALLY_VERIFIED") {
  if (missingMarkers.length) console.error(`MISSING ${missingMarkers.join(",")}`);
  for (const item of overclaims) console.error(`OVERCLAIM ${item}`);
  for (const item of falseFlags) console.error(`FALSE_FLAG ${item}`);
  process.exitCode = 1;
}
