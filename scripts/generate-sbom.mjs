import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { readLicenseInventory } from "./license-inventory.mjs";

const exec = promisify(execFile);
const root = process.cwd();
const { packageJson, packages } = await readLicenseInventory(root);
const lockBytes = await readFile(resolve(root, "package-lock.json"));
const digest = createHash("sha256").update(lockBytes).digest();
digest[6] = (digest[6] & 0x0f) | 0x40;
digest[8] = (digest[8] & 0x3f) | 0x80;
const hex = digest.toString("hex");
const serial = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;

function purlName(name) {
  return name.startsWith("@") ? `%40${name.slice(1)}` : encodeURIComponent(name);
}

function licenseEntries(license) {
  if (license === "UNKNOWN" || / OR | AND |\(|\)/.test(license)) return [{ expression: license }];
  return [{ license: { id: license } }];
}

const components = packages.map((item) => ({
  type: "library",
  "bom-ref": `pkg:npm/${purlName(item.name)}@${item.version}#${createHash("sha256").update(item.lockPath).digest("hex").slice(0, 12)}`,
  name: item.name,
  version: item.version,
  purl: `pkg:npm/${purlName(item.name)}@${item.version}`,
  licenses: licenseEntries(item.license),
  properties: [
    { name: "cdx:npm:direct", value: String(item.direct) },
    { name: "fulfillment:license-review", value: item.status },
  ],
}));

const bom = {
  bomFormat: "CycloneDX",
  specVersion: "1.5",
  serialNumber: `urn:uuid:${serial}`,
  version: 1,
  metadata: {
    component: {
      type: "application",
      name: packageJson.name,
      version: packageJson.version,
      description: "One npm lockfile covers the backend in src and the frontend in frontend. No container image is included.",
    },
    tools: [{ name: "fulfillment-exception-pack-sbom", version: packageJson.version }],
    properties: [
      { name: "coverage", value: "backend,frontend" },
      { name: "container-sbom", value: "not-included" },
    ],
  },
  components,
};

await mkdir(resolve(root, "artifacts"), { recursive: true });
await writeFile(resolve(root, "artifacts/sbom.cdx.json"), `${JSON.stringify(bom, null, 2)}\n`, "utf8");
await import(new URL("./generate-dependency-license-report.mjs", import.meta.url));
console.log(`SBOM_GENERATED (${components.length} components)`);

let syft = false;
try {
  await access("/usr/local/bin/syft").then(() => { syft = true; });
} catch {
  try {
    await exec("syft", ["version"]);
    syft = true;
  } catch {
    syft = false;
  }
}
if (!syft) console.log("CONTAINER_SBOM_SKIPPED tool=syft-unavailable image=not-built");
