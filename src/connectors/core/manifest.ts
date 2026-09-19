import { createHash } from "node:crypto";
import { CORE_CONNECTOR_API_VERSION, ConnectorError, type ConnectorManifest } from "./types.js";

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function connectorManifestHash(manifest: ConnectorManifest) {
  return createHash("sha256").update(stableJson(manifest)).digest("hex");
}

export function assertCompatibleConnectorManifest(manifest: ConnectorManifest) {
  if (!/^\d+\.\d+\.\d+/.test(manifest.version)) throw new ConnectorError("CONNECTOR_VERSION_INVALID");
  if (manifest.compatibility.coreApiVersion !== CORE_CONNECTOR_API_VERSION) {
    throw new ConnectorError("CONNECTOR_CORE_VERSION_INCOMPATIBLE", 409);
  }
}
