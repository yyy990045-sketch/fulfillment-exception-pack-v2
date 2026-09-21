/**
 * Transport Abstraction。
 *
 * Simulator **不直接依赖 open supOS**：业务逻辑（生成什么事件、什么时候发生、来自哪个系统）
 * 与「怎么送出去」完全分离。三个实现共用同一份 UNS 信封与 topic：
 *
 *   local  → 直接推进 Connector Core 的缓冲队列（等价 injected transport，无序列化边界）
 *   inmem  → MQTT 形状的内存 broker（同 topic 通配符、同 JSON 字符串载荷），
 *            用于在**没有 broker** 的情况下验证「MQTT 模式发布出去的字节就是连接器契约接受的字节」
 *   mqtt   → 真实 MQTT broker（EMQX / open supOS 运行时）；拿不到回执就 fail-closed，绝不假装成功
 *
 * 将来真实 open supOS runtime 解锁后，同一 simulator 只需换 --transport，不改业务逻辑。
 */
import { InMemoryUnsTransport, OpenSupOSMqttTransport, type UnsTransport } from "../../integrations/open-supos/transport.js";
import type { OpenSupOSUnsEnvelope } from "../../integrations/open-supos/types.js";
import { OpenSupOSUnsQueue } from "../../integrations/open-supos/connector.js";
import { parseOpenSupOSUnsEnvelope } from "../../integrations/open-supos/envelope.js";
import { OpenSupOSIntegrationError } from "../../integrations/open-supos/types.js";
import { PLAYBACK_MS_PER_DAY, type SimulatedUnsMessage } from "./emitter.js";

export type SimulatorTransportKind = "local" | "inmem" | "mqtt";

export const SIMULATOR_TRANSPORT_KINDS: SimulatorTransportKind[] = ["local", "inmem", "mqtt"];

/**
 * UNS 订阅模式：11 段 industrial 式子。
 *   enterprise/{e}/site/{s}/area/{a}/line/{l}/{domain}/{entityId}/{eventType}
 */
export const SIMULATOR_UNS_SUBSCRIBE_PATTERN = "enterprise/+/site/+/area/+/line/+/+/+/+";

export type TransportDelivery = {
  kind: SimulatorTransportKind;
  /** 送出的消息数 */
  published: number;
  /** broker / 传输层确认收到的消息数 */
  received: number;
  /** 是否经过真实序列化边界（payload 是字符串，接收端重新解析） */
  serialized: boolean;
  topicSamples: string[];
  /** 真实 broker 端点（mqtt 模式），不含任何凭据 */
  endpoint: string | null;
};

export type SimulatorTransportInput = {
  messages: SimulatedUnsMessage[];
  /** 传输层收到消息后必须落进这个队列，之后交给既有 runInboundSync */
  queue: OpenSupOSUnsQueue;
  /** 1x 速度下 1 工业日 ≈ 1 秒；speed=0 表示不等速（测试/校验用） */
  speed: number;
  /** 收到一条消息时回调（用于打印进度） */
  onMessage?: (message: { topic: string; envelope: OpenSupOSUnsEnvelope }) => void;
  mqtt?: {
    url?: string;
    username?: string;
    password?: string;
    clientId?: string;
    connectionTimeoutMs?: number;
    ackTimeoutMs?: number;
  };
  sleep?: (ms: number) => Promise<void>;
};

export interface SimulatorTransport {
  readonly kind: SimulatorTransportKind;
  deliver(input: SimulatorTransportInput): Promise<TransportDelivery>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function pacingDelay(previous: SimulatedUnsMessage | undefined, current: SimulatedUnsMessage, speed: number) {
  if (!previous || speed <= 0) return 0;
  const deltaMinutes = Math.max(0, (Date.parse(current.record.occurredAt) - Date.parse(previous.record.occurredAt)) / 60_000);
  return Math.round((deltaMinutes / 1440) * PLAYBACK_MS_PER_DAY / speed);
}

function topicSamples(messages: SimulatedUnsMessage[]) {
  return [...new Set(messages.map((item) => item.topic))].slice(0, 3);
}

/** 解析收到的载荷并落进队列：serialized 路径必须走这一步，不能直接透传内存对象。 */
function ingestReceivedPayload(queue: OpenSupOSUnsQueue, topic: string, payload: string) {
  const envelope = parseOpenSupOSUnsEnvelope(payload);
  const accepted = queue.push({ topic, payload, envelope });
  if (!accepted) throw new OpenSupOSIntegrationError("UNS_MESSAGE_DUPLICATE_CURSOR", envelope.messageId);
  return envelope;
}

export class LocalSimulatorTransport implements SimulatorTransport {
  readonly kind = "local" as const;

  async deliver(input: SimulatorTransportInput): Promise<TransportDelivery> {
    const sleep = input.sleep ?? defaultSleep;
    let previous: SimulatedUnsMessage | undefined;
    for (const message of input.messages) {
      const delay = pacingDelay(previous, message, input.speed);
      if (delay > 0) await sleep(delay);
      input.queue.push({ topic: message.topic, payload: message.payload, envelope: message.envelope });
      input.onMessage?.({ topic: message.topic, envelope: message.envelope });
      previous = message;
    }
    return {
      kind: this.kind,
      published: input.messages.length,
      received: input.messages.length,
      serialized: false,
      topicSamples: topicSamples(input.messages),
      endpoint: null,
    };
  }
}

/** 由 UnsTransport（MQTT 形状）驱动的传输：inmem 与 mqtt 共用，保证两者语义一致。 */
async function deliverViaUnsTransport(input: SimulatorTransportInput & {
  kind: SimulatorTransportKind;
  transport: UnsTransport;
  endpoint: string | null;
  ackTimeoutMs: number;
}): Promise<TransportDelivery> {
  const sleep = input.sleep ?? defaultSleep;
  await input.transport.connect();
  let received = 0;
  try {
    await input.transport.subscribe(SIMULATOR_UNS_SUBSCRIBE_PATTERN, async (topic, payload) => {
      const envelope = ingestReceivedPayload(input.queue, topic, payload);
      received += 1;
      input.onMessage?.({ topic, envelope });
    });
    let previous: SimulatedUnsMessage | undefined;
    for (const message of input.messages) {
      const delay = pacingDelay(previous, message, input.speed);
      if (delay > 0) await sleep(delay);
      await input.transport.publish(message.topic, message.payload);
      previous = message;
    }
    const deadline = Date.now() + input.ackTimeoutMs;
    while (received < input.messages.length && Date.now() < deadline) await sleep(20);
  } finally {
    await input.transport.disconnect();
  }
  if (received !== input.messages.length) {
    throw new OpenSupOSIntegrationError(
      "UNS_TRANSPORT_DELIVERY_INCOMPLETE",
      `published=${input.messages.length}:received=${received}`,
    );
  }
  return {
    kind: input.kind,
    published: input.messages.length,
    received,
    serialized: true,
    topicSamples: topicSamples(input.messages),
    endpoint: input.endpoint,
  };
}

/**
 * MQTT 形状的内存传输。
 *
 * 它不是「假装连上了 broker」：它只证明**序列化后的 UNS 载荷**能原样穿过 topic 通配符
 * 并重新被连接器解析。真实 broker 仍然必须走 mqtt 模式并拿到回执。
 */
export class InMemorySimulatorTransport implements SimulatorTransport {
  readonly kind = "inmem" as const;

  async deliver(input: SimulatorTransportInput): Promise<TransportDelivery> {
    return deliverViaUnsTransport({
      ...input,
      kind: this.kind,
      transport: new InMemoryUnsTransport(),
      endpoint: "inmemory://uns-simulator",
      ackTimeoutMs: input.mqtt?.ackTimeoutMs ?? 5_000,
    });
  }
}

export class MqttSimulatorTransport implements SimulatorTransport {
  readonly kind = "mqtt" as const;

  async deliver(input: SimulatorTransportInput): Promise<TransportDelivery> {
    const transport = new OpenSupOSMqttTransport({
      ...(input.mqtt?.url ? { url: input.mqtt.url } : {}),
      ...(input.mqtt?.username ? { username: input.mqtt.username } : {}),
      ...(input.mqtt?.password ? { password: input.mqtt.password } : {}),
      ...(input.mqtt?.clientId ? { clientId: input.mqtt.clientId } : {}),
      ...(input.mqtt?.connectionTimeoutMs ? { connectionTimeoutMs: input.mqtt.connectionTimeoutMs } : {}),
    });
    return deliverViaUnsTransport({
      ...input,
      kind: this.kind,
      transport,
      // 端点只保留协议与主机，绝不含凭据
      endpoint: sanitizeEndpoint(input.mqtt?.url ?? process.env.OPEN_SUPOS_MQTT_URL ?? null),
      ackTimeoutMs: input.mqtt?.ackTimeoutMs ?? 15_000,
    });
  }
}

export function sanitizeEndpoint(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

export function createSimulatorTransport(kind: SimulatorTransportKind): SimulatorTransport {
  if (kind === "local") return new LocalSimulatorTransport();
  if (kind === "inmem") return new InMemorySimulatorTransport();
  if (kind === "mqtt") return new MqttSimulatorTransport();
  throw new OpenSupOSIntegrationError("UNSUPPORTED_SIMULATOR_TRANSPORT", String(kind));
}

/** 全部消息的工业日历跨度（分钟），用于打印「这 14 天压缩成了几秒」。 */
export function simulatedSpanMinutes(messages: SimulatedUnsMessage[]) {
  if (messages.length < 2) return 0;
  const first = Date.parse(messages[0]!.record.occurredAt);
  const last = Date.parse(messages[messages.length - 1]!.record.occurredAt);
  return Math.round((last - first) / 60_000);
}

export function playbackSeconds(minutes: number, speed: number) {
  if (speed <= 0) return 0;
  return Number(((minutes / 1440) * PLAYBACK_MS_PER_DAY / speed / 1000).toFixed(3));
}
