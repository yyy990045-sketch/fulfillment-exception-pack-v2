import { ConnectorError, type ConnectorManifest, type InboundConnector, type OutboundConnector } from "./types.js";

export class ConnectorRegistry {
  private readonly outboundConnectors = new Map<string, OutboundConnector>();
  private readonly inboundConnectors = new Map<string, InboundConnector>();

  register(connector: OutboundConnector) {
    const existing = this.outboundConnectors.get(connector.manifest.id);
    if (existing && existing.manifest.version !== connector.manifest.version) throw new ConnectorError("CONNECTOR_ID_CONFLICT", 409);
    if (existing && existing !== connector) throw new ConnectorError("CONNECTOR_ID_CONFLICT", 409);
    this.outboundConnectors.set(connector.manifest.id, connector);
    return connector;
  }

  registerInbound(connector: InboundConnector) {
    const existing = this.inboundConnectors.get(connector.manifest.id);
    if (existing && existing.manifest.version !== connector.manifest.version) throw new ConnectorError("CONNECTOR_ID_CONFLICT", 409);
    if (existing && existing !== connector) throw new ConnectorError("CONNECTOR_ID_CONFLICT", 409);
    this.inboundConnectors.set(connector.manifest.id, connector);
    return connector;
  }

  get(connectorId: string) {
    return this.outboundConnectors.get(connectorId);
  }

  getInbound(connectorId: string) {
    return this.inboundConnectors.get(connectorId);
  }

  list(): ConnectorManifest[] {
    return [...this.outboundConnectors.values()].map((item) => item.manifest).sort((left, right) => left.id.localeCompare(right.id));
  }

  listInbound(): ConnectorManifest[] {
    return [...this.inboundConnectors.values()].map((item) => item.manifest).sort((left, right) => left.id.localeCompare(right.id));
  }
}

export const connectorRegistry = new ConnectorRegistry();
