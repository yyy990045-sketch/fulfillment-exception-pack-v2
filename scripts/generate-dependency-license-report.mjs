import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { readLicenseInventory } from "./license-inventory.mjs";

const root = process.cwd();
const { lock, packages } = await readLicenseInventory(root);
const unclassified = packages.filter((item) => item.direct && item.purpose === "UNCLASSIFIED");
if (unclassified.length) {
  console.error(`UNCLASSIFIED_DIRECT_PURPOSE ${unclassified.map((item) => item.name).join(",")}`);
  process.exitCode = 1;
}

function cell(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}

const markers = ["UNKNOWN", "UNLICENSED", "SEE_LICENSE", "CUSTOM", "UNRECOGNIZED"];
const lines = [
  "# Third-party dependency inventory",
  "",
  "Generated from the root `package-lock.json`. Backend (`src/`) and frontend (`frontend/`) share this one npm project; the frontend has no separate lockfile.",
  `Lockfile SHA-256: \`${createHash("sha256").update(JSON.stringify(lock.packages)).digest("hex")}\`.`,
  "",
  "This is a lockfile inventory, not a legal opinion. Missing npm license metadata is recorded as `UNKNOWN` and is not treated as permission to use the package.",
  "",
  "| PACKAGE | VERSION | LICENSE | PURPOSE | DIRECT/TRANSITIVE | SOURCE |",
  "| --- | --- | --- | --- | --- | --- |",
  ...packages.map((item) => `| ${cell(item.name)} | ${cell(item.version)} | ${cell(item.license)} | ${cell(item.purpose)} | ${item.direct ? "DIRECT" : "TRANSITIVE"} | ${cell(item.source)} |`),
  "",
  "## Review markers",
  "",
  "Packages below are not allowed by the dependency verifier until the license is identified or an owner-approved exception is added to `docs/open-source/license-exceptions.json`.",
  "",
];
for (const marker of markers) {
  const matches = packages.filter((item) => item.marker === marker);
  lines.push(`### ${marker}`, "");
  lines.push(matches.length ? matches.map((item) => `- ${item.name}@${item.version} — ${item.license}`).join("\n") : "- none", "");
}
lines.push(
  "## Known licenses with extra obligations",
  "",
  "These licenses are recognized and allowed for dependency verification. Allowing them does not remove their obligations and does not choose a license for this repository.",
  "",
  "- `MPL-2.0`: weak copyleft. The current copies are transitive build tooling (`lightningcss`), not modified in this repository. A modified MPL file would need its source made available.",
  "- `CC-BY-4.0`: `caniuse-lite` requires attribution. It is consumed as an npm package and is not vendored into the competition bundle.",
  "- `Python-2.0`: `argparse`, a permissive historical license, transitive.",
  "- `(MIT OR CC0-1.0)`: `type-fest`, a dual license. Either license in the expression is in the allowed set.",
  "",
  "The project license is still undecided. See `docs/open-source/license-audit.md`.",
  "",
);
await mkdir(resolve(root, "docs/open-source"), { recursive: true });
const body = `${lines.join("\n").replace(/\n+$/, "")}\n`;
await writeFile(resolve(root, "docs/open-source/third-party-dependencies.md"), body, "utf8");
console.log(`THIRD_PARTY_DEPENDENCY_REPORT_GENERATED (${packages.length} packages)`);
if (process.exitCode) process.exit(process.exitCode);
