import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export const ALLOWED_LICENSE_IDS = new Set([
  "MIT",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "0BSD",
  "MIT-0",
  "BlueOak-1.0.0",
  "MPL-2.0",
  "CC0-1.0",
  "CC-BY-4.0",
  "Python-2.0",
  "Unlicense",
]);

const REVIEW_PATTERNS = [
  { id: "UNKNOWN", pattern: /^UNKNOWN$/i },
  { id: "UNLICENSED", pattern: /^UNLICENSED$/i },
  { id: "SEE_LICENSE", pattern: /see license/i },
  { id: "CUSTOM", pattern: /^custom$/i },
];

export const DIRECT_PURPOSES = {
  "@azure/msal-node": "Optional Power BI token client",
  "@playwright/test": "Frontend end-to-end test runner",
  "@radix-ui/react-dialog": "Frontend dialog primitive",
  "@radix-ui/react-separator": "Frontend separator primitive",
  "@radix-ui/react-slot": "Frontend composition primitive",
  "@radix-ui/react-tabs": "Frontend tabs primitive",
  "@superset-ui/embedded-sdk": "Optional Superset embed API client",
  "@tailwindcss/vite": "Frontend CSS build plugin",
  "@tanstack/react-query": "Frontend server-state client",
  "@testing-library/jest-dom": "Frontend DOM test matchers",
  "@testing-library/react": "Frontend component tests",
  "@testing-library/user-event": "Frontend interaction tests",
  "@types/node": "Node.js TypeScript types",
  "@types/react": "React TypeScript types",
  "@types/react-dom": "React DOM TypeScript types",
  "@vitejs/plugin-react": "Frontend React build plugin",
  "class-variance-authority": "Frontend variant class helper",
  clsx: "Frontend class name helper",
  jsdom: "Frontend test DOM implementation",
  "lucide-react": "Frontend icons",
  mqtt: "Optional UNS MQTT client",
  openai: "Optional external model client",
  "openapi-typescript": "OpenAPI type generation",
  "powerbi-client": "Optional Power BI embed client",
  "powerbi-client-react": "Optional Power BI React embed wrapper",
  react: "Frontend UI runtime",
  "react-dom": "Frontend DOM renderer",
  "react-router-dom": "Frontend routing",
  "tailwind-merge": "Frontend class name merge helper",
  tailwindcss: "Frontend CSS framework",
  tsx: "TypeScript command runner",
  typescript: "Typechecker and compiler",
  vite: "Frontend dev server and build tool",
  vitest: "Test runner",
  zod: "Runtime schema validation shared by backend and frontend",
};

export function packageNameFromLockPath(lockPath) {
  const parts = lockPath.split("node_modules/");
  return parts[parts.length - 1];
}

export function normalizeLicense(value) {
  if (value == null) return "UNKNOWN";
  if (typeof value === "string") return value.trim() || "UNKNOWN";
  if (Array.isArray(value)) {
    const parts = value.map((item) => normalizeLicense(item)).filter((item) => item !== "UNKNOWN");
    return parts.length ? parts.join(" OR ") : "UNKNOWN";
  }
  if (typeof value === "object" && typeof value.type === "string") return value.type.trim() || "UNKNOWN";
  return "UNKNOWN";
}

export function classifyLicense(license) {
  const raw = normalizeLicense(license);
  const marker = REVIEW_PATTERNS.find((item) => item.pattern.test(raw));
  if (marker) return { license: raw, status: "review", marker: marker.id };
  const ids = raw.replace(/[()]/g, " ").split(/\s+(?:OR|AND)\s+/i).map((item) => item.trim()).filter(Boolean);
  if (ids.length === 0 || ids.some((id) => !ALLOWED_LICENSE_IDS.has(id))) {
    return { license: raw, status: "review", marker: "UNRECOGNIZED" };
  }
  return { license: raw, status: "allowed", marker: null };
}

export async function readLicenseInventory(root) {
  const lock = JSON.parse(await readFile(resolve(root, "package-lock.json"), "utf8"));
  const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
  const rootEntry = lock.packages?.[""] ?? {};
  const directNames = new Set([
    ...Object.keys(rootEntry.dependencies ?? {}),
    ...Object.keys(rootEntry.devDependencies ?? {}),
  ]);
  let exceptions = { packages: [] };
  try {
    exceptions = JSON.parse(await readFile(resolve(root, "docs/open-source/license-exceptions.json"), "utf8"));
  } catch {
    exceptions = { packages: [] };
  }
  const approved = new Set(
    (exceptions.packages ?? [])
      .filter((item) => item?.ownerApproved === true)
      .map((item) => `${item.name}@${item.version}@${item.license}`),
  );
  const packages = Object.entries(lock.packages ?? {})
    .filter(([name]) => name.startsWith("node_modules/"))
    .map(([lockPath, value]) => {
      const name = packageNameFromLockPath(lockPath);
      const version = value.version ?? "UNKNOWN";
      const classification = classifyLicense(value.license);
      const topLevel = lockPath === `node_modules/${name}`;
      const direct = topLevel && directNames.has(name);
      const exceptionKey = `${name}@${version}@${classification.license}`;
      const excepted = classification.status !== "allowed" && approved.has(exceptionKey);
      return {
        name,
        version,
        license: classification.license,
        marker: excepted ? "EXCEPTION" : classification.marker,
        status: excepted ? "allowed" : classification.status,
        direct,
        purpose: direct
          ? (DIRECT_PURPOSES[name] ?? "UNCLASSIFIED")
          : "Transitive dependency; this repository does not select it directly",
        source: value.resolved ?? "package-lock.json",
        lockPath,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version) || a.lockPath.localeCompare(b.lockPath));
  return { lock, packageJson, packages, directNames };
}
