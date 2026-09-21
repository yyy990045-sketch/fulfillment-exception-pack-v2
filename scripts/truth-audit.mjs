import { readFile, mkdir, writeFile, readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const targets = ["README.md", "docs/competition", "docs/industrial", "docs/open-source", "release/competition-manifest.json"];
const risky = /\b(real|production|verified|live|factory|MES|open supOS|AI approval|auto execute|autonomous)\b/gi;
const boundaryMarkers = ["High-Fidelity Simulated Industrial Environment", "真实 MES / open supOS 运行时", "REAL_OPEN_SUPOS_RUNTIME_VERIFIED", "LICENSE_DECISION_REQUIRED"];
const findings = [];
async function walk(path) {
  const info = await stat(path);
  if (info.isDirectory()) for (const child of await readdir(path)) await walk(resolve(path, child));
  else if (/\.(md|json|yml|yaml|ts|tsx)$/.test(path)) {
    const text = await readFile(path, "utf8");
    const matches = [...text.matchAll(risky)].map((match) => match[0]);
    if (matches.length) findings.push({ file: path.slice(root.length + 1), count: matches.length, review: "context-required" });
  }
}
for (const target of targets) await walk(resolve(root, target));
const markerTexts = [];
async function collectText(path) {
  try {
    const info = await stat(path);
    if (info.isDirectory()) {
      for (const child of await readdir(path)) await collectText(resolve(path, child));
    } else if (/\.(md|json|yml|yaml|ts|tsx)$/.test(path)) {
      markerTexts.push(await readFile(path, "utf8"));
    }
  } catch { /* optional paths are handled as absent */ }
}
for (const target of targets) await collectText(resolve(root, target));
const missing = boundaryMarkers.filter((marker) => !markerTexts.join("\n").includes(marker));
const report = { generatedAt: new Date().toISOString(), status: missing.length === 0 ? "TRUTH_CLAIM_AUDIT_LOCALLY_VERIFIED" : "TRUTH_CLAIM_AUDIT_BLOCKED", boundaryMarkersMissing: missing, riskyTermFiles: findings };
await mkdir(resolve(root, "docs/open-source"), { recursive: true });
await writeFile(resolve(root, "docs/open-source/truth-audit.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(report.status);
console.log(`TRUTH_AUDIT_CONTEXT_REVIEW_FILES=${findings.length}`);
if (missing.length) { console.error(`MISSING_BOUNDARY_MARKERS=${missing.join(",")}`); process.exitCode = 1; }
