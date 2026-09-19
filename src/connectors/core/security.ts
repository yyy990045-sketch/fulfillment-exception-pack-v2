import type { InternalWorkItemRecord } from "../../domain/v2/index.js";
import { ConnectorError, type ConnectorManifest } from "./types.js";

export const SAFE_CONNECTOR_ACTIONS = new Set(["create_task", "supplement_evidence"]);

export function assertConnectorSafety(manifest: ConnectorManifest, actionType: string) {
  if (manifest.audience !== "internal_operations"
    || manifest.effects.customerFacing
    || manifest.effects.financialMovement
    || manifest.effects.legalEffect) {
    throw new ConnectorError("CONNECTOR_EFFECT_NOT_ALLOWED", 409);
  }
  if (!SAFE_CONNECTOR_ACTIONS.has(actionType)) throw new ConnectorError("CONNECTOR_ACTION_NOT_ALLOWED", 409);
}

export function validateConnectorBaseUrl(value: string, env = process.env) {
  let url: URL;
  try { url = new URL(value); } catch { throw new ConnectorError("CONNECTOR_BASE_URL_INVALID"); }
  const production = env.NODE_ENV === "production";
  if (production && url.protocol !== "https:") throw new ConnectorError("CONNECTOR_HTTPS_REQUIRED", 409);
  if (!production && !["http:", "https:"].includes(url.protocol)) throw new ConnectorError("CONNECTOR_BASE_URL_INVALID");
  return url.toString().replace(/\/$/, "");
}

export function deliveryPayload(item: InternalWorkItemRecord) {
  return {
    workItemId: item.id,
    contextId: item.contextId,
    exceptionId: item.exceptionId,
    kind: item.kind,
    actionType: item.actionType,
    title: item.title,
    description: item.description,
  };
}
