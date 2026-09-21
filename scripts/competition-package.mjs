import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, cp, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
const root = process.cwd();
const temp = await mkdtemp(resolve(tmpdir(), "fulfillment-competition-package-"));
const out = resolve(root, "dist/competition");
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
try {
  await exec("git", ["archive", "HEAD", "|", "tar", "-x", "-C", temp], { cwd: root, shell: true });
  const include = ["README.md", "CHANGELOG.md", "CONTRIBUTING.md", "SECURITY.md", "CODE_OF_CONDUCT.md", "package.json", "package-lock.json", "docs/competition", "docs/industrial", "docs/open-source", "release", "artifacts", "contracts"];
  for (const relative of include) { try { await access(join(temp, relative)); await cp(join(temp, relative), join(out, relative), { recursive: true }); } catch { /* optional until owner decision */ } }
  if (!(await access(join(out, "LICENSE")).then(() => true).catch(() => false))) await writeFile(join(out, "LICENSE_DECISION_REQUIRED.txt"), "Project license is not selected. See docs/open-source/license-audit.md.\n", "utf8");
  const files = [];
  async function collect(path) { for (const entry of await readdir(path, { withFileTypes: true })) { const child = join(path, entry.name); if (entry.isDirectory()) await collect(child); else if (entry.name !== "SHA256SUMS") files.push(child); } }
  await collect(out);
  const sums = (await Promise.all(files.sort().map(async (path) => `${createHash("sha256").update(await readFile(path)).digest("hex")}  ${path.slice(out.length + 1)}`))).join("\n") + "\n";
  await writeFile(join(out, "SHA256SUMS"), sums, "utf8");
  console.log(`COMPETITION_PACKAGE_CREATED ${out}`);
} finally { await rm(temp, { recursive: true, force: true }); }
