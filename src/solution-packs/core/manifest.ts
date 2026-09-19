import { createHash } from "node:crypto";
import { CORE_SOLUTION_PACK_API_VERSION, SolutionPackError, type SolutionPackManifest } from "./types.js";

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function solutionPackManifestHash(manifest: SolutionPackManifest) {
  return createHash("sha256").update(stableJson(manifest)).digest("hex");
}

export function assertCompatibleManifest(manifest: SolutionPackManifest) {
  if (!manifest.version.trim() || !/^\d+\.\d+\.\d+/.test(manifest.version)) throw new SolutionPackError("PACK_VERSION_INVALID");
  if (manifest.compatibility.coreApiVersion !== CORE_SOLUTION_PACK_API_VERSION) {
    throw new SolutionPackError("PACK_CORE_VERSION_INCOMPATIBLE", 409);
  }
}
