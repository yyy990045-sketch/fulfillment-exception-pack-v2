import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
const root = process.cwd();
const temp = await mkdtemp(resolve(tmpdir(), "fulfillment-competition-clean-room-"));
const archive = join(temp, "source.tar");
try {
  await exec("git", ["archive", "--format=tar", "--output", archive, "HEAD"], { cwd: root, maxBuffer: 4 * 1024 * 1024 });
  await exec("tar", ["-xf", archive, "-C", temp], { cwd: root, maxBuffer: 4 * 1024 * 1024 });
  await exec("npm", ["ci", "--ignore-scripts"], { cwd: temp, maxBuffer: 16 * 1024 * 1024 });
  await exec("npm", ["run", "typecheck"], { cwd: temp, maxBuffer: 16 * 1024 * 1024 });
  const demo = await exec("npm", ["run", "demo:judge"], { cwd: temp, maxBuffer: 16 * 1024 * 1024 });
  const context = demo.stdout.match(/contextId\s*[=:]\s*([A-Za-z0-9_.:-]+)/)?.[1];
  if (!context) throw new Error("clean-room judge demo did not expose a context id");
  await exec("npm", ["run", "evidence:verify", "--", "--context", context], { cwd: temp, maxBuffer: 16 * 1024 * 1024 });
  console.log("COMPETITION_CLEAN_ROOM_VERIFIED");
} finally { await rm(temp, { recursive: true, force: true }); }
