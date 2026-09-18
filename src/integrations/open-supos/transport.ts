import { OpenSupOSIntegrationError } from "./types.js";

export type UnsMessageHandler = (topic: string, payload: string) => void | Promise<void>;

export interface UnsTransport {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  subscribe(topicPattern: string, handler: UnsMessageHandler): Promise<void>;
  publish(topic: string, payload: string): Promise<void>;
}

export class InMemoryUnsTransport implements UnsTransport {
  private connected = false;
  private readonly subscriptions: Array<{ pattern: string; handler: UnsMessageHandler }> = [];

  async connect() { this.connected = true; }
  async disconnect() { this.connected = false; }

  async subscribe(topicPattern: string, handler: UnsMessageHandler) {
    if (!this.connected) throw new OpenSupOSIntegrationError("UNS_TRANSPORT_NOT_CONNECTED");
    this.subscriptions.push({ pattern: topicPattern, handler });
  }

  async publish(topic: string, payload: string) {
    if (!this.connected) throw new OpenSupOSIntegrationError("UNS_TRANSPORT_NOT_CONNECTED");
    for (const subscription of this.subscriptions) {
      if (this.matches(subscription.pattern, topic)) await subscription.handler(topic, payload);
    }
  }

  private matches(pattern: string, topic: string) {
    const expected = pattern.split("/");
    const actual = topic.split("/");
    return expected.length === actual.length && expected.every((segment, index) => segment === "+" || segment === actual[index]);
  }
}

export class OpenSupOSMqttTransport implements UnsTransport {
  private client?: import("mqtt").MqttClient;

  constructor(private readonly config: {
    url?: string;
    username?: string;
    password?: string;
    clientId?: string;
    connectionTimeoutMs?: number;
  } = {}) {}

  async connect() {
    const url = this.config.url ?? process.env.OPEN_SUPOS_MQTT_URL;
    if (!url) throw new OpenSupOSIntegrationError("UNS_TRANSPORT_NOT_CONFIGURED", "OPEN_SUPOS_MQTT_URL");
    const { connect } = await import("mqtt");
    const client = connect(url, {
      username: this.config.username ?? process.env.OPEN_SUPOS_MQTT_USERNAME,
      password: this.config.password ?? process.env.OPEN_SUPOS_MQTT_PASSWORD,
      clientId: this.config.clientId ?? process.env.OPEN_SUPOS_MQTT_CLIENT_ID,
      reconnectPeriod: 0,
    });
    this.client = client;
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        client.removeListener("connect", onConnect);
        client.removeListener("error", onError);
        client.end(true, {}, () => reject(new OpenSupOSIntegrationError("UNS_TRANSPORT_CONNECTION_TIMEOUT")));
      }, this.config.connectionTimeoutMs ?? 15_000);
      const onConnect = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve();
      };
      const onError = (error: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        client.removeListener("connect", onConnect);
        client.end(true, {}, () => reject(new OpenSupOSIntegrationError("UNS_TRANSPORT_CONNECTION_FAILED", error.name)));
      };
      client.once("connect", onConnect);
      client.on("error", onError);
    });
  }

  async disconnect() {
    await new Promise<void>((resolve) => {
      if (!this.client) return resolve();
      this.client.end(false, {}, () => resolve());
    });
  }

  async subscribe(topicPattern: string, handler: UnsMessageHandler) {
    if (!this.client) throw new OpenSupOSIntegrationError("UNS_TRANSPORT_NOT_CONNECTED");
    await new Promise<void>((resolve, reject) => this.client!.subscribe(topicPattern, (error) => error ? reject(error) : resolve()));
    this.client.on("message", (topic, payload) => { void handler(topic, payload.toString("utf8")); });
  }

  async publish(topic: string, payload: string) {
    if (!this.client) throw new OpenSupOSIntegrationError("UNS_TRANSPORT_NOT_CONNECTED");
    await new Promise<void>((resolve, reject) => this.client!.publish(topic, payload, (error) => error ? reject(error) : resolve()));
  }
}
