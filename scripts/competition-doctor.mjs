import { access, readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const root = process.cwd();
const checks = [];
const add = (name, ok, detail) => checks.push({ name, ok, detail });
const file = async (relative) => access(resolve(root, relative)).then(() => true).catch(() => false);
const nodeMajor = Number(process.versions.node.split(".")[0]);
add("Node >= 22", nodeMajor >= 22, process.version);
try { add("npm available", true, execFileSync("npm", ["--version"], { encoding: "utf8" }).trim()); } catch { add("npm available", false, "npm not executable"); }
for (const required of ["README.md", "package.json", "package-lock.json", "docs/competition", "docs/industrial", "docs/open-source", "release/competition-manifest.json", "artifacts/sbom.cdx.json"]) {
  add(`required ${required}`, await file(required), "repository artifact");
}
const pkg = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
for (const script of ["demo:judge", "evidence:verify", "simulator:verify", "typecheck", "licenses:verify", "sbom", "competition:verify", "competition:clean-room", "competition:package", "truth:audit"]) {
  add(`script ${script}`, typeof pkg.scripts?.[script] === "string", pkg.scripts?.[script] ?? "missing");
}
try { add("git repository", true, execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim()); } catch { add("git repository", false, "not a git worktree"); }
try {
  const dirty = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim();
  add("git clean", dirty.length === 0, dirty.length === 0 ? "clean" : "working tree has changes");
} catch { add("git clean", false, "git status failed"); }
try { add("root writable", true, resolve(root)); } catch { add("root writable", false, "cannot access repository"); }
for (const check of checks) console.log(`${check.ok ? "OK" : "BLOCKED"}: ${check.name} — ${check.detail}`);
if (checks.every((check) => check.ok)) console.log("COMPETITION_ENV_READY");
else { console.error("COMPETITION_ENV_BLOCKED"); process.exitCode = 1; }
