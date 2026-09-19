import { createHash } from "node:crypto";
import type { V2SqliteStore } from "../../domain/v2/index.js";
import { connectorRegistry } from "./registry.js";
import { assertConnectorSafety, deliveryPayload } from "./security.js";
import { ConnectorError, type ConnectorDeliveryView } from "./types.js";

function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function enqueueInternalWorkItemDelivery(
  store: V2SqliteStore,
  tenantId: string,
  workItemId: string,
  connectorInstallationId: string,
) {
  return store.transaction(() => {
    const workItem = store.getInternalWorkItem(tenantId, workItemId);
    if (!workItem || workItem.source !== "policy_automation" || workItem.status !== "open") throw new ConnectorError("CONNECTOR_WORK_ITEM_NOT_ELIGIBLE", 409);
    const installation = store.getConnectorInstallation(tenantId, connectorInstallationId);
    if (!installation || installation.status !== "active") throw new ConnectorError("CONNECTOR_INSTALLATION_NOT_ACTIVE", 409);
    const connector = connectorRegistry.get(installation.connectorId);
    if (!connector || connector.manifest.version !== installation.connectorVersion) throw new ConnectorError("CONNECTOR_NOT_FOUND", 404);
    assertConnectorSafety(connector.manifest, workItem.actionType);
    const capability = workItem.kind === "task" ? "deliver_internal_task" : "deliver_evidence_request";
    if (!connector.manifest.capabilities.includes(capability)) throw new ConnectorError("CONNECTOR_CAPABILITY_NOT_SUPPORTED", 409);
    const operationKey = hash({
      tenantId,
      connectorInstallationId,
      workItemId,
      connectorVersion: installation.connectorVersion,
      capability,
    });
    const now = new Date().toISOString();
    return store.enqueueConnectorOutbox({
      tenantId,
      id: `outbox-${operationKey.slice(0, 24)}`,
      connectorInstallationId,
      workItemId,
      contextId: workItem.contextId,
      exceptionId: workItem.exceptionId,
      capability,
      operationKey,
      payload: deliveryPayload(workItem),
      status: "pending",
      attemptCount: 0,
      availableAt: now,
      createdAt: now,
      updatedAt: now,
    });
  });
}

export function getConnectorDeliveryView(store: V2SqliteStore, tenantId: string, outboxId: string): ConnectorDeliveryView | undefined {
  const outbox = store.getConnectorOutbox(tenantId, outboxId);
  if (!outbox) return undefined;
  return {
    outbox,
    attempts: store.listConnectorDeliveryAttempts(tenantId, outboxId),
    ...(store.getConnectorReceipt(tenantId, outboxId) ? { receipt: store.getConnectorReceipt(tenantId, outboxId)! } : {}),
  };
}
