import type { V2SqliteStore } from "../../domain/v2/index.js";
import { connectorRegistry } from "./registry.js";
import { EnvironmentSecretResolver, type SecretResolver } from "./secrets.js";
import { ConnectorError, type ConnectorDeliveryResult } from "./types.js";

export type DrainConnectorOptions = {
  workerId: string;
  clock?: () => Date;
  maxAttempts?: number;
  leaseMs?: number;
  secretResolver?: SecretResolver;
  onBeforeFinalize?: (result: ConnectorDeliveryResult) => void | Promise<void>;
};

export async function drainConnectorOutbox(store: V2SqliteStore, options: DrainConnectorOptions) {
  const clock = options.clock ?? (() => new Date());
  const now = clock().toISOString();
  const claimed = store.claimConnectorOutbox(options.workerId, now, options.leaseMs ?? 60_000);
  if (!claimed) return { claimed: 0, result: null };
  const installation = store.getConnectorInstallation(claimed.tenantId, claimed.connectorInstallationId);
  const connector = installation ? connectorRegistry.get(installation.connectorId) : undefined;
  const attemptNumber = claimed.attemptCount + 1;
  const startedAt = now;
  let result: ConnectorDeliveryResult;
  try {
    if (!installation || installation.status !== "active" || !connector || connector.manifest.version !== installation.connectorVersion) {
      throw new ConnectorError("CONNECTOR_NOT_FOUND", 404);
    }
    const secret = installation.secretRef ? (options.secretResolver ?? new EnvironmentSecretResolver()).resolve(installation.secretRef) : undefined;
    result = await connector.deliver({ installation, outbox: claimed, ...(secret ? { secret } : {}), now: clock });
  } catch (error) {
    result = {
      status: "retryable_failure",
      errorCode: error instanceof ConnectorError ? error.code : "CONNECTOR_NETWORK_ERROR",
    };
  }
  await options.onBeforeFinalize?.(result);
  const completedAt = clock().toISOString();
  const attempt = {
    tenantId: claimed.tenantId,
    id: `attempt-${claimed.id}-${attemptNumber}`,
    outboxId: claimed.id,
    attemptNumber,
    workerId: options.workerId,
    startedAt,
    completedAt,
    status: result.status,
    ...(result.httpStatus !== undefined ? { httpStatus: result.httpStatus } : {}),
    ...(result.errorCode ? { errorCode: result.errorCode } : {}),
    ...(result.responseHash ? { responseHash: result.responseHash } : {}),
  } as const;
  if (result.status === "succeeded") {
    const receipt = {
      tenantId: claimed.tenantId,
      id: `receipt-${claimed.id}`,
      outboxId: claimed.id,
      externalRequestId: result.externalRequestId ?? claimed.operationKey,
      ...(result.externalResourceId ? { externalResourceId: result.externalResourceId } : {}),
      receiptSource: connector!.manifest.id,
      status: "succeeded" as const,
      payloadHash: result.responseHash ?? "0".repeat(64),
      createdAt: completedAt,
    };
    store.finalizeConnectorOutboxSuccess({ outbox: claimed, attempt, receipt });
    return { claimed: 1, result: store.getConnectorOutbox(claimed.tenantId, claimed.id), receipt };
  }
  const maxAttempts = options.maxAttempts ?? 3;
  const deadLetter = result.status === "permanent_failure" || attemptNumber >= maxAttempts;
  const backoffMs = attemptNumber === 1 ? 1_000 : attemptNumber === 2 ? 5_000 : 0;
  const nextAvailableAt = new Date(clock().getTime() + backoffMs).toISOString();
  store.finalizeConnectorOutboxFailure({ outbox: claimed, attempt, nextAvailableAt, deadLetter });
  return {
    claimed: 1,
    result: store.getConnectorOutbox(claimed.tenantId, claimed.id),
    receipt: undefined,
    deadLetter,
  };
}
