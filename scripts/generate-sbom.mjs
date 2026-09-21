import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const lock = JSON.parse(await readFile(resolve(root, "package-lock.json"), "utf8"));
const direct = { ...lock.packages[""].dependencies, ...lock.packages[""].devDependencies };
const components = Object.entries(lock.packages ?? {})
  .filter(([name]) => name.startsWith("node_modules/"))
  .map(([name, value]) => {
    const packageName = name.slice("node_modules/".length);
    return {
      type: "library",
      "bom-ref": `pkg:npm/${packageName}@${value.version}`,
      name: packageName,
      version: value.version ?? "UNKNOWN",
      purl: `pkg:npm/${packageName}@${value.version}`,
      licenses: [{ license: { id: value.license ?? "UNKNOWN" } }],
      properties: [{ name: "cdx:npm:direct", value: String(Object.prototype.hasOwnProperty.call(direct, packageName)) }],
    };
  })
  .sort((a, b) => a.name.localeCompare(b.name));
const bom = {
  bomFormat: "CycloneDX", specVersion: "1.5",
  serialNumber: "urn:uuid:00000000-0000-4000-8000-000000000001", version: 1,
  metadata: { timestamp: new Date().toISOString(), component: { type: "application", name: lock.name, version: lock.version } },
  components,
};
await mkdir(resolve(root, "artifacts"), { recursive: true });
await writeFile(resolve(root, "artifacts/sbom.cdx.json"), `${JSON.stringify(bom, null, 2)}\n`, "utf8");
await import(new URL("./generate-dependency-license-report.mjs", import.meta.url));
console.log(`SBOM_GENERATED (${components.length} components)`);
