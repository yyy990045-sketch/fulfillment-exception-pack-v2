import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { resolve } from "node:path";

const exec = promisify(execFile);
const root = process.cwd();
const skip = new Set([
  "package-lock.json",
  "artifacts/sbom.cdx.json",
  "docs/open-source/third-party-dependencies.md",
]);
const placeholder = /^(?:changeme|example|placeholder|password|secret|redacted|dummy|test|xxx+|your[-_].*|<[^>]+>|TODO)$/i;
const rules = [
  { id: "private-key", pattern: /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/ },
  { id: "bearer-token", pattern: /\bBearer\s+(?!example\b|redacted\b|<)[A-Za-z0-9\-._~+/]{24,}=*/ },
  { id: "jwt", pattern: /\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{8,}\b/ },
  { id: "cloud-credential", pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b|\b(?:xox[baprs]-|ghp_|github_pat_|glpat-)[A-Za-z0-9_\-]{16,}\b/ },
  { id: "database-credential", pattern: /\b(?:postgres|postgresql|mysql|mongodb(?:\+srv)?):\/\/[^:\s/'"]+:[^@\s/'"]+@/i },
  { id: "ssh-password", pattern: /\bsshpass\s+-p\s+\S+|\b(?:ssh|scp)\b[^\n]{0,160}\b(?:password|passwd)\b\s*[:=]\s*['"]?\S+/i },
];

function assignedSecret(line) {
  const match = line.match(/\b(?:password|passwd|pwd|client_secret|api[_-]?key|secret)\b\s*[:=]\s*['"]([^'"]+)['"]/i);
  if (!match) return null;
  const value = match[1].trim();
  if (placeholder.test(value)) return null;
  return value;
}

function liveCredential(value) {
  return /^(?:sk-proj-|sk-live-|sk-ant-|AKIA|ASIA|ghp_|github_pat_|xox[baprs]-)/.test(value);
}

const listed = await exec("git", ["ls-files", "-z"], { cwd: root, maxBuffer: 8 * 1024 * 1024 });
const files = listed.stdout.split("\0").filter(Boolean).filter((file) => !skip.has(file) && !file.endsWith(".docx"));
const findings = [];
let testFixtures = 0;
for (const file of files) {
  let text;
  try {
    text = await readFile(resolve(root, file), "utf8");
  } catch {
    continue;
  }
  if (text.includes("\0")) continue;
  const fixtureFile = file.startsWith("tests/");
  text.split("\n").forEach((line, index) => {
    const hits = [];
    for (const rule of rules) {
      if (rule.pattern.test(line)) hits.push(rule.id);
    }
    const secret = assignedSecret(line);
    if (secret) hits.push("password-assignment");
    for (const id of hits) {
      const fixture = fixtureFile && !liveCredential(secret ?? "") && (id === "password-assignment" || id === "jwt");
      if (fixture) testFixtures += 1;
      else findings.push({ file, line: index + 1, id });
    }
  });
}

if (testFixtures) console.log(`TEST_FIXTURE_NOT_A_RELEASE_SECRET count=${testFixtures}`);
if (findings.length) {
  console.error("SECRET_SCAN_BLOCKED");
  for (const finding of findings) console.error(`${finding.id} ${finding.file}:${finding.line}`);
  process.exitCode = 1;
} else {
  console.log(`SECRET_SCAN_CLEAN files=${files.length}`);
}
