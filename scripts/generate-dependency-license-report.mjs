import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const lock = JSON.parse(await readFile(resolve(root, "package-lock.json"), "utf8"));
const direct = { ...lock.packages[""].dependencies, ...lock.packages[""].devDependencies };
const entries = Object.entries(lock.packages ?? {})
  .filter(([name]) => name.startsWith("node_modules/"))
  .map(([name, value]) => ({
    name: name.slice("node_modules/".length),
    version: value.version ?? "UNKNOWN",
    license: value.license ?? "UNKNOWN",
    source: value.resolved ?? "package-lock.json",
    direct: Object.prototype.hasOwnProperty.call(direct, name.slice("node_modules/".length)),
  }))
  .sort((a, b) => a.name.localeCompare(b.name));
const lines = [
  "# Third-party dependency inventory", "",
  `Generated from package-lock.json at ${new Date().toISOString()}.`,
  "This is a lockfile inventory, not a legal opinion. Unknown or custom licenses must be reviewed before release.", "",
  "| PACKAGE | VERSION | LICENSE | PURPOSE | DIRECT/TRANSITIVE | SOURCE |",
  "| --- | --- | --- | --- | --- | --- |",
  ...entries.map((entry) => `| ${entry.name} | ${entry.version} | ${entry.license} | Runtime/build dependency; package-specific purpose is the package's own documented role | ${entry.direct ? "DIRECT" : "TRANSITIVE"} | ${entry.source} |`),
  "", "## Review flags", "",
  "- The project license is absent; see license-audit.md.",
  "- Copied/adapted source and bundled documents are outside npm metadata and require separate review.",
];
await mkdir(resolve(root, "docs/open-source"), { recursive: true });
await writeFile(resolve(root, "docs/open-source/third-party-dependencies.md"), `${lines.join("\n")}\n`, "utf8");
console.log(`THIRD_PARTY_DEPENDENCY_REPORT_GENERATED (${entries.length} packages)`);
