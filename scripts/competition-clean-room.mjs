import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const root = process.cwd();
const realHome = process.env.HOME ?? "";
const temp = join("/tmp", `fep-cr-${randomBytes(4).toString("hex")}`);
await mkdir(temp, { recursive: true });
const archive = join(temp, "source.tar");
const home = join(temp, "empty-home");
const scratch = join(temp, "tmp");
const outputLimit = 64 * 1024 * 1024;

function cleanEnv() {
  return {
    PATH: process.env.PATH ?? "",
    HOME: home,
    TMPDIR: scratch,
    LANG: process.env.LANG ?? "C.UTF-8",
    LC_ALL: process.env.LC_ALL ?? process.env.LANG ?? "C.UTF-8",
    npm_config_cache: join(scratch, "npm-cache"),
    npm_config_userconfig: join(scratch, "user-npmrc"),
    npm_config_globalconfig: join(scratch, "global-npmrc"),
    NPM_CONFIG_UPDATE_NOTIFIER: "false",
  };
}

async function filesUnder(dir) {
  const found = [];
  async function walk(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) await walk(child);
      else found.push(child);
    }
  }
  if (existsSync(dir)) await walk(dir);
  return found.sort();
}

function resolveSpec(fromFile, spec) {
  const base = resolve(dirname(fromFile), spec).replace(/\.(js|mjs|cjs)$/, "");
  return [`${base}.ts`, `${base}.tsx`, `${base}.mjs`, join(base, "index.ts")].find((item) => existsSync(item));
}

async function hiddenDependencyScan(tree) {
  const seen = new Set();
  const queue = [join(tree, "src/demo/judge/cli.ts")];
  const importRe = /from\s+["'](\.[^"']+)["']|import\(\s*["'](\.[^"']+)["']\s*\)/g;
  const patterns = [/\/Users\//, /\/home\//, /homedir\(/, /process\.env\.HOME\b/, /\bdocker\b/i, /127\.0\.0\.1/, /\blocalhost\b/];
  const hits = [];
  while (queue.length) {
    const file = queue.pop();
    if (!file || seen.has(file)) continue;
    seen.add(file);
    const text = (await readFile(file, "utf8")).replace(/\/\*[\s\S]*?\*\//g, "");
    for (const match of text.matchAll(importRe)) {
      const next = resolveSpec(file, match[1] || match[2]);
      if (next) queue.push(next);
    }
    text.split("\n").forEach((line, index) => {
      const trimmed = line.trim();
      if (trimmed.startsWith("//")) return;
      if (!patterns.some((pattern) => pattern.test(line))) return;
      const safetyGuard = file.endsWith("src/demo/judge/workspace.ts") && line.includes("process.env.HOME") && line.includes("forbidden");
      const homeGuard = file.endsWith("src/demo/judge/workspace.ts") && line.includes("const home = process.env.HOME");
      if (safetyGuard || homeGuard) return;
      hits.push(`${file.slice(tree.length + 1)}:${index + 1}`);
    });
  }
  return { files: seen.size, hits };
}

async function runChecked(command, args, label, sandbox) {
  const env = cleanEnv();
  try {
    if (!sandbox) return await exec(command, args, { cwd: temp, env, maxBuffer: outputLimit });
    const profile = join(temp, "clean-room.sb");
    const denied = [root, realHome, "/Users/xieweikai"].filter(Boolean);
    const rules = [
      "(version 1)",
      "(allow default)",
      ...denied.flatMap((path) => [`(deny file-read* (subpath "${path}"))`, `(deny file-write* (subpath "${path}"))`]),
      "(deny network*)",
    ];
    await writeFile(profile, `${rules.join("\n")}\n`, "utf8");
    return await exec("sandbox-exec", ["-f", profile, command, ...args], { cwd: temp, env, maxBuffer: outputLimit });
  } catch (error) {
    process.stdout.write(error.stdout ?? "");
    process.stderr.write(error.stderr ?? "");
    throw new Error(`CLEAN_ROOM_FAILED ${label}`);
  }
}

try {
  await mkdir(home);
  await mkdir(scratch);
  await writeFile(join(scratch, "user-npmrc"), "fund=false\n");
  await writeFile(join(scratch, "global-npmrc"), "fund=false\n");
  await exec("git", ["archive", "--format=tar", "--output", archive, "HEAD"], { cwd: root, maxBuffer: outputLimit });
  await exec("tar", ["-xf", archive, "-C", temp], { cwd: root, maxBuffer: outputLimit });
  const tracked = await filesUnder(temp);
  const leaked = tracked.filter((file) => /(?:^|\/)(?:node_modules|\.preview|backups)(?:\/|$)/.test(file) || file.endsWith(".sqlite") || file.endsWith("/.env") || file.endsWith("/.env.local"));
  if (leaked.length) throw new Error(`CLEAN_ROOM_TRACKED_LEAK ${leaked.length}`);

  const installed = await runChecked("npm", ["install"], "npm install", false);
  process.stdout.write(installed.stdout);
  const before = await filesUnder(home);
  const scan = await hiddenDependencyScan(temp);
  if (scan.hits.length) throw new Error(`HIDDEN_DEPENDENCY ${scan.hits.join(",")}`);
  console.log(`HIDDEN_DEPENDENCY_SCAN files=${scan.files} hits=0`);

  const sandbox = existsSync("/usr/bin/sandbox-exec");
  if (!sandbox) console.log("HIDDEN_DEPENDENCY_SANDBOX=UNAVAILABLE");
  else console.log("HIDDEN_DEPENDENCY_SANDBOX=ENFORCED");
  const typecheck = await runChecked("npm", ["run", "typecheck"], "typecheck", sandbox);
  process.stdout.write(typecheck.stdout);
  const demo = await runChecked("npm", ["run", "demo:judge"], "demo:judge", sandbox);
  process.stdout.write(demo.stdout);
  const contextId = demo.stdout.match(/contextId\s*=\s*(\S+)/)?.[1];
  if (!contextId || !demo.stdout.includes("JUDGE_DEMO_VERIFIED") || !demo.stdout.includes("SIMULATED INDUSTRIAL ENVIRONMENT")) {
    throw new Error("CLEAN_ROOM_DEMO_OUTPUT");
  }
  if (demo.stdout.includes(root) || (realHome && demo.stdout.includes(realHome))) throw new Error("CLEAN_ROOM_OUTPUT_LEAKED_HOST_PATH");
  const evidence = await runChecked("npm", ["run", "evidence:verify", "--", "--context", contextId], "evidence:verify", sandbox);
  process.stdout.write(evidence.stdout);
  if (!evidence.stdout.includes("EVIDENCE_TRACE_VERIFIED")) throw new Error("CLEAN_ROOM_EVIDENCE");
  const after = await filesUnder(home);
  if (after.join("\n") !== before.join("\n")) throw new Error("CLEAN_ROOM_HOME_MUTATION");
  const database = join(temp, ".preview/judge-demo/pack-cases.sqlite");
  if (!existsSync(database)) throw new Error("CLEAN_ROOM_DEMO_DATABASE_MISSING");
  console.log("COMPETITION_CLEAN_ROOM_VERIFIED");
} catch (error) {
  console.error(error instanceof Error ? error.message : "CLEAN_ROOM_FAILED");
  process.exitCode = 1;
} finally {
  await rm(temp, { recursive: true, force: true });
}
