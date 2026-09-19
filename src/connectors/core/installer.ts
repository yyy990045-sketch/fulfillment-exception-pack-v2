import type { V2SqliteStore } from "../../domain/v2/index.js";
import { assertCompatibleConnectorManifest, connectorManifestHash } from "./manifest.js";
import { validateSecretRef } from "./secrets.js";
import { ConnectorError, type InboundConnector, type OutboundConnector } from "./types.js";

type InstallableConnector = OutboundConnector | InboundConnector;

export function installConnector(
  store: V2SqliteStore,
  connector: InstallableConnector,
  input: {
    tenantId: string;
    installationId: string;
    config: Record<string, unknown>;
    secretRef?: string;
    actor: string;
  },
) {
  assertCompatibleConnectorManifest(connector.manifest);
  validateSecretRef(input.secretRef);
  const config = connector.validateConfig(input.config);
  const now = new Date().toISOString();
  return store.saveConnectorInstallation({
    tenantId: input.tenantId,
    id: input.installationId,
    connectorId: connector.manifest.id,
    connectorVersion: connector.manifest.version,
    status: "active",
    manifestHash: connectorManifestHash(connector.manifest),
    config,
    ...(input.secretRef ? { secretRef: input.secretRef } : {}),
    installedBy: input.actor,
    installedAt: now,
    updatedAt: now,
  });
}

export function requireConnector(connector: OutboundConnector | undefined) {
  if (!connector) throw new ConnectorError("CONNECTOR_NOT_FOUND", 404);
  return connector;
}
