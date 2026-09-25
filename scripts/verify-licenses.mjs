import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { readLicenseInventory } from "./license-inventory.mjs";

const root = process.cwd();
const { packageJson, packages, directNames } = await readLicenseInventory(root);
const blocked = packages.filter((item) => item.status !== "allowed");
const unclassified = [...directNames].filter((name) => packages.some((item) => item.direct && item.name === name && item.purpose === "UNCLASSIFIED"));
let projectLicense = packageJson.license ?? null;
if (!projectLicense) {
  projectLicense = await access(resolve(root, "LICENSE")).then(() => "FILE_PRESENT").catch(() => null);
}

if (!projectLicense) console.log("LICENSE_DECISION_REQUIRED");
console.log(`DEPENDENCY_PACKAGES=${packages.length}`);
console.log(`DEPENDENCY_REVIEW=${blocked.length}`);

if (blocked.length > 0 || unclassified.length > 0) {
  console.error("LICENSE_AUDIT_BLOCKED");
  for (const item of blocked) {
    console.error(`REVIEW ${item.marker} ${item.name}@${item.version} license=${item.license}`);
  }
  for (const name of unclassified) console.error(`UNCLASSIFIED_DIRECT_PURPOSE ${name}`);
  process.exitCode = 1;
} else {
  console.log("LICENSE_AUDIT_VERIFIED");
}
