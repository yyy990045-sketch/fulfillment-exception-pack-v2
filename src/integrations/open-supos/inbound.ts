import type { OpenSupOSAdapter } from "./adapter.js";
import type { UnsTransport } from "./transport.js";

export function startOpenSupOSInbound(
  adapter: OpenSupOSAdapter,
  transport: UnsTransport,
  topicPattern = "fulfillment/+/+/+/+/+",
) {
  return transport.subscribe(topicPattern, async (topic, payload) => {
    adapter.ingest(topic, payload);
  });
}
