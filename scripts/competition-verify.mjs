import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
const run = async (label, command, args) => {
  console.log(`\n== ${label} ==`);
  try { const result = await exec(command, args, { cwd: process.cwd(), maxBuffer: 16 * 1024 * 1024 }); process.stdout.write(result.stdout); process.stderr.write(result.stderr); return true; }
  catch (error) { process.stdout.write(error.stdout ?? ""); process.stderr.write(error.stderr ?? ""); console.error(`BLOCKED: ${label}`); return false; }
};
const steps = [
  ["environment doctor", "npm", ["run", "competition:doctor"]],
  ["typecheck", "npm", ["run", "typecheck"]],
  ["core tests", "npm", ["test"]],
  ["industrial simulator", "npm", ["run", "simulator:verify"]],
  ["judge demo", "npm", ["run", "demo:judge"]],
  ["evidence-broken gate", "npm", ["run", "demo:judge", "--", "--scenario", "evidence-broken"]],
  ["backup verification", "npm", ["run", "db:verify-backup"]],
  ["recovery drill", "npm", ["run", "ops:recovery-drill"]],
  ["truth audit", "npm", ["run", "truth:audit"]],
  ["license verification", "npm", ["run", "licenses:verify"]],
  ["SBOM generation", "npm", ["run", "sbom"]],
];
for (const [label, command, args] of steps) if (!await run(label, command, args)) { process.exitCode = 1; break; }
if (!process.exitCode) console.log("COMPETITION_ACCEPTANCE_VERIFIED");
