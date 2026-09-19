import { spawnSync } from "node:child_process";

export default function setup() {
  const build = spawnSync("npm", ["run", "frontend:build"], {
    cwd: process.cwd(),
    stdio: "pipe",
    encoding: "utf8",
  });
  if (build.status !== 0) throw new Error(build.stderr || build.stdout);
}
