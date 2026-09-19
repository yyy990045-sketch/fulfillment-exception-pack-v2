import { ConnectorError, type ConnectorDeliveryResult, type OutboundConnector } from "../core/types.js";
import { REFERENCE_INTERNAL_TASK_HTTP_MANIFEST } from "./manifest.js";
import { safeResponseHash, validateReferenceConfig } from "./validator.js";

export class ReferenceInternalTaskHttpConnector implements OutboundConnector {
  readonly manifest = REFERENCE_INTERNAL_TASK_HTTP_MANIFEST;

  validateConfig(config: Record<string, unknown>) {
    return validateReferenceConfig(config);
  }

  async deliver(input: Parameters<OutboundConnector["deliver"]>[0]): Promise<ConnectorDeliveryResult> {
    const config = validateReferenceConfig(input.installation.config);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const response = await fetch(`${config.baseUrl}/tasks`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": input.outbox.operationKey,
          ...(input.secret ? { authorization: `Bearer ${input.secret}` } : {}),
        },
        body: JSON.stringify(input.outbox.payload),
        signal: controller.signal,
      });
      if (response.ok) {
        const body = await response.json().catch(() => ({})) as Record<string, unknown>;
        const externalRequestId = typeof body.externalRequestId === "string" ? body.externalRequestId : input.outbox.operationKey;
        const externalResourceId = typeof body.externalResourceId === "string" ? body.externalResourceId : undefined;
        return {
          status: "succeeded",
          httpStatus: response.status,
          externalRequestId,
          ...(externalResourceId ? { externalResourceId } : {}),
          responseHash: safeResponseHash({ externalRequestId, externalResourceId }),
        };
      }
      const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
      return {
        status: retryable ? "retryable_failure" : "permanent_failure",
        httpStatus: response.status,
        errorCode: retryable ? "CONNECTOR_HTTP_RETRYABLE" : "CONNECTOR_HTTP_PERMANENT",
      };
    } catch (error) {
      return {
        status: "retryable_failure",
        errorCode: controller.signal.aborted ? "CONNECTOR_TIMEOUT" : "CONNECTOR_NETWORK_ERROR",
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
