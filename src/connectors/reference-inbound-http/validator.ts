import { validateConnectorBaseUrl } from "../core/security.js";
import { ConnectorError } from "../core/types.js";

export function validateReferenceInboundConfig(config: Record<string, unknown>) {
  const baseUrl = typeof config.baseUrl === "string" ? config.baseUrl : "";
  const timeoutMs = config.timeoutMs === undefined ? 20_000 : Number(config.timeoutMs);
  if (!baseUrl) throw new ConnectorError("CONNECTOR_BASE_URL_REQUIRED");
  if (!Number.isFinite(timeoutMs) || timeoutMs < 100 || timeoutMs > 60_000) {
    throw new ConnectorError("CONNECTOR_TIMEOUT_INVALID");
  }
  return { baseUrl: validateConnectorBaseUrl(baseUrl), timeoutMs };
}
