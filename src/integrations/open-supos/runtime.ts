import type { OpenSupOSAdapter } from "./adapter.js";
import { OpenSupOSMqttTransport, type UnsTransport } from "./transport.js";
import { startOpenSupOSInbound } from "./inbound.js";

export type OpenSupOSRuntimeResult =
  | { status: "disabled" }
  | { status: "started"; transport: UnsTransport };

export async function startConfiguredOpenSupOSInbound(
  adapter: OpenSupOSAdapter,
  options: {
    env?: Record<string, string | undefined>;
    transportFactory?: () => UnsTransport;
    topicPattern?: string;
  } = {},
): Promise<OpenSupOSRuntimeResult> {
  const env = options.env ?? process.env;
  if (env.OPEN_SUPOS_ENABLED !== "true") return { status: "disabled" };
  const transport = options.transportFactory?.() ?? new OpenSupOSMqttTransport({
    url: env.OPEN_SUPOS_MQTT_URL,
    username: env.OPEN_SUPOS_MQTT_USERNAME,
    password: env.OPEN_SUPOS_MQTT_PASSWORD,
    clientId: env.OPEN_SUPOS_MQTT_CLIENT_ID,
  });
  await transport.connect();
  await startOpenSupOSInbound(adapter, transport, options.topicPattern);
  return { status: "started", transport };
}
