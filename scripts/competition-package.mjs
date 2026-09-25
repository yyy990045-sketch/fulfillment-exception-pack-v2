import { createHash } from "node:crypto";
import { access, cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { COMMIT_SHA_SENTINEL, MANIFEST_PATH, gitHead, loadManifest, validateCompetitionManifest } from "./competition-manifest.mjs";

const exec = promisify(execFile);
const root = process.cwd();
const temp = await mkdtempSafe();
const out = resolve(root, "dist/competition");
const include = [
  "README.md",
  "CHANGELOG.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "CODE_OF_CONDUCT.md",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "vitest.config.ts",
  ".gitignore",
  "docs/competition",
  "docs/industrial",
  "docs/open-source",
  "release",
  "artifacts/sbom.cdx.json",
  "contracts",
  "src",
  "frontend/src",
  "frontend/e2e",
  "frontend/index.html",
  "frontend/tsconfig.json",
  "frontend/vite.config.ts",
  "frontend/vitest.config.ts",
  "frontend/playwright.config.ts",
  "scripts",
  "tests",
  "gold-set",
];
const forbidden = /(\.env$|\.env\.local$|\.sqlite$|node_modules|\.preview|\/backups\/|\/logs\/|\/coverage\/|\.pem$|\.key$|id_rsa|test-results|playwright-report)/;

async function mkdtempSafe() {
  const { mkdtemp } = await import("node:fs/promises");
  return mkdtemp(resolve(tmpdir(), "fulfillment-competition-package-"));
}

async function collect(dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const child = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await collect(child));
    else if (entry.name !== "SHA256SUMS") files.push(child);
  }
  return files;
}

try {
  const head = gitHead(root);
  const archive = join(temp, "source.tar");
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  await exec("git", ["archive", "--format=tar", "--output", archive, "HEAD"], { cwd: root });
  await exec("tar", ["-xf", archive, "-C", temp], { cwd: root });
  for (const relativePath of include) {
    await access(join(temp, relativePath));
    await cp(join(temp, relativePath), join(out, relativePath), { recursive: true });
  }
  if (await access(join(temp, "LICENSE")).then(() => true).catch(() => false)) {
    await cp(join(temp, "LICENSE"), join(out, "LICENSE"));
  } else {
    await writeFile(join(out, "LICENSE_DECISION_REQUIRED.txt"), "Project license is not selected. See docs/open-source/license-audit.md.\n", "utf8");
  }
  if (await access(join(temp, "NOTICE")).then(() => true).catch(() => false)) await cp(join(temp, "NOTICE"), join(out, "NOTICE"));

  const manifest = await loadManifest(out);
  if (manifest.commitSha !== COMMIT_SHA_SENTINEL) throw new Error("source manifest commitSha must stay unresolved until packaging");
  manifest.commitSha = head;
  const errors = validateCompetitionManifest(manifest, head);
  if (errors.length) throw new Error(errors.join("; "));
  await writeFile(join(out, MANIFEST_PATH), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const files = await collect(out);
  const leaked = files.filter((file) => forbidden.test(file));
  if (leaked.length) throw new Error(`PACKAGE_LEAK ${leaked.map((file) => relative(out, file)).join(",")}`);
  const sums = `${(await Promise.all(files.sort().map(async (file) => `${createHash("sha256").update(await readFile(file)).digest("hex")}  ${relative(out, file).split("\\").join("/")}`))).join("\n")}\n`;
  await writeFile(join(out, "SHA256SUMS"), sums, "utf8");
  console.log(`COMPETITION_PACKAGE_CREATED ${out}`);
  console.log("COMPETITION_RELEASE_PACKAGE_VERIFIED");
} catch (error) {
  console.error(error instanceof Error ? error.message : "PACKAGE_FAILED");
  process.exitCode = 1;
} finally {
  await rm(temp, { recursive: true, force: true });
}
