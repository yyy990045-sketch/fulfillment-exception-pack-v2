import { ConnectorError, type ConnectorManifest, type OutboundConnector } from "./types.js";

export class ConnectorRegistry {
  private readonly connectors = new Map<string, OutboundConnector>();

  register(connector: OutboundConnector) {
    const existing = this.connectors.get(connector.manifest.id);
    if (existing && existing.manifest.version !== connector.manifest.version) throw new ConnectorError("CONNECTOR_ID_CONFLICT", 409);
    if (existing && existing !== connector) throw new ConnectorError("CONNECTOR_ID_CONFLICT", 409);
    this.connectors.set(connector.manifest.id, connector);
    return connector;
  }

  get(connectorId: string) {
    return this.connectors.get(connectorId);
  }

  list(): ConnectorManifest[] {
    return [...this.connectors.values()].map((item) => item.manifest).sort((left, right) => left.id.localeCompare(right.id));
  }
}

export const connectorRegistry = new ConnectorRegistry();
