import type { OpenSupOSAdapter } from "./adapter.js";
import type { UnsTransport } from "./transport.js";
import type { OpenSupOSInboundResult } from "./types.js";

export function startOpenSupOSInbound(
  adapter: OpenSupOSAdapter,
  transport: UnsTransport,
  topicPattern = "fulfillment/+/+/+/+/+",
  onIngest?: (topic: string, payload: string, result: OpenSupOSInboundResult) => void | Promise<void>,
) {
  return transport.subscribe(topicPattern, async (topic, payload) => {
    const result = adapter.ingest(topic, payload);
    await onIngest?.(topic, payload, result);
  });
}
