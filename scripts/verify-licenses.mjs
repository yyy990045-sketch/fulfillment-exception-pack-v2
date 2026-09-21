import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const lock = JSON.parse(await readFile(resolve(root, "package-lock.json"), "utf8"));
const allowed = new Set(["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "0BSD", "MIT-0", "BlueOak-1.0.0", "MPL-2.0", "CC0-1.0", "CC-BY-4.0", "Python-2.0", "(MIT OR CC0-1.0)"]);
const dependencyLicenses = Object.entries(lock.packages ?? {})
  .filter(([name]) => name.startsWith("node_modules/"))
  .map(([, value]) => value.license ?? "UNKNOWN");
const unknown = [...new Set(dependencyLicenses)].filter((license) => !allowed.has(license));
const projectLicense = packageJson.license ?? (await access(resolve(root, "LICENSE")).then(() => "FILE_PRESENT").catch(() => null));
if (!projectLicense || unknown.length > 0) {
  console.error("LICENSE_AUDIT_BLOCKED");
  if (!projectLicense) console.error("LICENSE_DECISION_REQUIRED: project has no LICENSE or package license");
  if (unknown.length > 0) console.error(`UNKNOWN_DEPENDENCY_LICENSES: ${unknown.join(", ")}`);
  process.exitCode = 1;
} else console.log("LICENSE_AUDIT_VERIFIED");
