/**
 * 原始载荷留存（Raw Payload Retention）。
 *
 * 为什么必须有这个东西：
 *   Source Ledger 只保存 `rawHash`，不保存载荷本体（现有表结构未改）。
 *   因此"rawHash 是否与内容一致"这个问题**无法只靠账本回答** —— 必须有一份可复核的原始载荷。
 *
 * 真实部署里，这份载荷来自：连接器的持久化原始响应 / 对象存储 / 源系统重新拉取。
 * 在本仓库的仿真环境里，它就是 Factory Simulator 发布出去的那一串 UNS 消息
 * （`.preview/judge-demo/uns-stream.jsonl`），逐字节可重放。
 *
 * 纪律：拿不到载荷就**不能**声称证据可回源。缺失时一律 fail-closed，
 * 绝不把"没有检查"写成"检查通过"。
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export const UNS_STREAM_ARTIFACT_NAME = "uns-stream.jsonl";

/** judge demo 工作区（原始载荷留存物的默认位置）。 */
export const DEFAULT_JUDGE_WORKSPACE_DIR = ".preview/judge-demo";

export function defaultUnsStreamPath(baseDir = process.cwd()) {
  return resolve(baseDir, DEFAULT_JUDGE_WORKSPACE_DIR, UNS_STREAM_ARTIFACT_NAME);
}

export type UnsStreamEntry = {
  topic: string;
  messageId: string;
  cursor: string;
  payload: string;
  envelope: Record<string, unknown>;
  /** 该条目自身的 sha256，用于证明"我们读到的文件没被截断/替换" */
  entryHash: string;
};

export type UnsPayloadSource = {
  path: string | null;
  available: boolean;
  entries: number;
  unparsable: number;
  byMessageId: Map<string, UnsStreamEntry>;
  byCursor: Map<string, UnsStreamEntry>;
  duplicateMessageIds: string[];
};

export function emptyUnsPayloadSource(path: string | null = null): UnsPayloadSource {
  return {
    path,
    available: false,
    entries: 0,
    unparsable: 0,
    byMessageId: new Map(),
    byCursor: new Map(),
    duplicateMessageIds: [],
  };
}

/** 写出 UNS 流（评委 demo 的原始载荷留存物）。同一条 messageId 只保留第一条。 */
export function writeUnsStream(
  path: string,
  messages: Array<{ topic: string; payload: string }>,
) {
  const target = resolve(path);
  mkdirSync(dirname(target), { recursive: true });
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const message of messages) {
    let envelope: Record<string, unknown> = {};
    try {
      envelope = JSON.parse(message.payload) as Record<string, unknown>;
    } catch {
      envelope = {};
    }
    const messageId = typeof envelope.messageId === "string" ? envelope.messageId : "";
    if (messageId && seen.has(messageId)) continue;
    if (messageId) seen.add(messageId);
    lines.push(JSON.stringify({ topic: message.topic, payload: message.payload }));
  }
  writeFileSync(target, lines.length ? `${lines.join("\n")}\n` : "", "utf8");
  return { path: target, entries: lines.length };
}

export function readUnsStream(path: string | null): UnsPayloadSource {
  if (!path) return emptyUnsPayloadSource(null);
  const target = resolve(path);
  if (!existsSync(target)) return emptyUnsPayloadSource(target);
  const source = emptyUnsPayloadSource(target);
  source.available = true;
  const content = readFileSync(target, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed: { topic?: unknown; payload?: unknown };
    try {
      parsed = JSON.parse(trimmed) as { topic?: unknown; payload?: unknown };
    } catch {
      source.unparsable += 1;
      continue;
    }
    if (typeof parsed.topic !== "string" || typeof parsed.payload !== "string") {
      source.unparsable += 1;
      continue;
    }
    let envelope: Record<string, unknown>;
    try {
      envelope = JSON.parse(parsed.payload) as Record<string, unknown>;
    } catch {
      source.unparsable += 1;
      continue;
    }
    const messageId = typeof envelope.messageId === "string" ? envelope.messageId : "";
    const event = (envelope.event ?? {}) as Record<string, unknown>;
    const occurredAt = typeof event.occurredAt === "string" ? event.occurredAt : "";
    const cursor = messageId ? `${occurredAt}#${messageId}` : "";
    const payloadSha = sha256Hex(parsed.payload);
    const entry: UnsStreamEntry = {
      topic: parsed.topic,
      messageId,
      cursor,
      payload: parsed.payload,
      envelope,
      entryHash: payloadSha,
    };
    if (messageId) {
      if (source.byMessageId.has(messageId)) source.duplicateMessageIds.push(messageId);
      else source.byMessageId.set(messageId, entry);
    }
    if (cursor) source.byCursor.set(cursor, entry);
    source.entries += 1;
  }
  source.duplicateMessageIds = [...new Set(source.duplicateMessageIds)].sort();
  return source;
}

export function lookupUnsPayload(source: UnsPayloadSource, input: { externalRecordId: string; cursor?: string | null }) {
  const byId = source.byMessageId.get(input.externalRecordId);
  if (byId) return byId;
  if (input.cursor) return source.byCursor.get(input.cursor) ?? null;
  return null;
}

export function sha256Hex(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
