/**
 * Phase A2 — Speech Transcription Capability Slice
 *
 * 覆盖 §22 要求的 12 项。测试本身**不联网**：
 * 真实 provider 由 `npm run speech:verify` 单独执行（需要 DASHSCOPE_API_KEY + 授权音频）。
 * 这里的 dashscope 适配器用**假 WebSocket 驱动真实协议消息**，验证协议解析与规范化，
 * 但不声称做过真实调用。
 */
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DomainError,
  V2SqliteStore,
  createBusinessEntity,
  createFulfillmentContext,
  createSourceSystem,
  evidenceLocatorKinds,
  runV2Migrations,
} from "../src/domain/v2/index.js";
import {
  DashScopeRealtimeSpeechTranscriptionProvider,
  SPEECH_TRANSCRIPTION_INTERFACE_KEY,
  FixtureSpeechTranscriptionProvider,
  FixtureTextOnlyProvider,
  SpeechTranscriptionError,
  assertTranscriptSegment,
  canProduceTemporalEvidence,
  declaredSpeechTranscriptionCapabilities,
  evidenceFromTranscriptSegment,
  normalizeTranscriptSegments,
  resolveSpeechTranscriptionProvider,
  sourceDocumentFromArtifact,
  transcriptOffsetsFor,
  type MinimalWebSocket,
  type SpeechTranscriptionProvider,
} from "../src/intelligence/speech-transcription/index.js";

type DatabaseSyncLike = {
  exec(sql: string): void;
  prepare(sql: string): { all(...p: unknown[]): unknown[]; get(...p: unknown[]): unknown; run(...p: unknown[]): unknown };
  close(): void;
};
const sqlite = process.getBuiltinModule("node:sqlite") as { DatabaseSync: new (p: string) => DatabaseSyncLike } | undefined;
if (!sqlite?.DatabaseSync) throw new Error("sqlite_backend_requires_node_22_5_or_newer");
const DatabaseSync = sqlite.DatabaseSync;

const workspaces: string[] = [];
const openDbs: DatabaseSyncLike[] = [];
afterEach(() => {
  for (const db of openDbs.splice(0)) db.close();
  for (const dir of workspaces.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function workspace() {
  const dir = mkdtempSync(join(tmpdir(), "fep-a2-"));
  workspaces.push(dir);
  return dir;
}
function openStore() {
  const dir = workspace();
  const dbPath = join(dir, "pack-cases.sqlite");
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON");
  runV2Migrations(db);
  return { db, dbPath, store: new V2SqliteStore(db) };
}

const TENANT = "demo-manufacturing";
const NOW = "2026-09-20T14:00:00.000Z";

/** 一段真实形状的授权音频字节（测试用确定性样本，不是真实录音）。 */
const AUDIO_BYTES = Buffer.from("A2-FIXTURE-WAV-BYTES".repeat(64));
const AUDIO_HASH = createHash("sha256").update(AUDIO_BYTES).digest("hex");

/**
 * 假 WebSocket：按真实 DashScope 协议回放消息。
 * 这里回放的两段时间片，其形状与真实 `paraformer-realtime-v2` 返回一致
 * （sentence_end=true 的定稿句 + 流式中间结果）。
 */
class FakeWebSocket implements MinimalWebSocket {
  private listeners = new Map<string, Array<(e: { data?: unknown }) => void>>();
  binaryBytes = 0;
  receivedFinishTask = false;
  constructor(private readonly script: { sentences: Array<{ id: number; begin: number; end: number; text: string; speaker?: string | null }> }) {}

  addEventListener(type: string, listener: (e: { data?: unknown }) => void) {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }
  private emit(type: string, data?: unknown) {
    for (const listener of this.listeners.get(type) ?? []) listener({ data });
  }
  send(data: string | Uint8Array) {
    if (typeof data !== "string") { this.binaryBytes += data.byteLength; return; }
    const message = JSON.parse(data) as { header?: { action?: string } };
    if (message.header?.action === "run-task") {
      this.emit("message", JSON.stringify({ header: { event: "task-started" } }));
      return;
    }
    if (message.header?.action === "finish-task") {
      this.receivedFinishTask = true;
      // 先发流式中间结果（sentence_end=false），必须被忽略，否则会重复计数
      for (const s of this.script.sentences) {
        this.emit("message", JSON.stringify({
          header: { event: "result-generated" },
          payload: { output: { sentence: { sentence_id: s.id, begin_time: s.begin, end_time: null, text: s.text.slice(0, 2), sentence_end: false, speaker_id: null } } },
        }));
      }
      // 再发定稿句
      for (const s of this.script.sentences) {
        this.emit("message", JSON.stringify({
          header: { event: "result-generated" },
          payload: { output: { sentence: { sentence_id: s.id, begin_time: s.begin, end_time: s.end, text: s.text, sentence_end: true, speaker_id: s.speaker ?? null } } },
        }));
      }
      this.emit("message", JSON.stringify({ header: { event: "task-finished" } }));
    }
  }
  close() {}
  open() { this.emit("open"); }
}

function dashscopeWith(script: ConstructorParameters<typeof FakeWebSocket>[0]) {
  const sockets: FakeWebSocket[] = [];
  const provider = new DashScopeRealtimeSpeechTranscriptionProvider({
    apiKey: "test-key-not-a-real-credential",
    webSocketFactory: () => { const ws = new FakeWebSocket(script); sockets.push(ws); setTimeout(() => ws.open(), 0); return ws; },
    chunkIntervalMs: 1,
  });
  return { provider, sockets };
}

function pcmFrames(bytes = 6400) {
  return { kind: "pcm-frames" as const, frames: new Uint8Array(bytes), sampleRateHz: 16000, channels: 1 };
}
const ARTIFACT = { artifactId: "recording-a2-test", mediaType: "audio/wav", contentHash: AUDIO_HASH, byteSize: AUDIO_BYTES.length, sampleRateHz: 16000, channels: 1 };

// ---------------------------------------------------------------------------
// 1. interface contract
// ---------------------------------------------------------------------------
describe("1. speech transcription interface contract", () => {
  it("declares exactly one provider-neutral interface key", () => {
    expect(SPEECH_TRANSCRIPTION_INTERFACE_KEY).toBe("speech_transcription");
    expect(declaredSpeechTranscriptionCapabilities()).toEqual(["dashscope-paraformer-realtime@v1"]);
  });

  it("keeps the capability id versioned and provider-specific, separate from the interface key", () => {
    const { provider } = dashscopeWith({ sentences: [] });
    expect(provider.capabilityId).toContain("@v1");
    expect(provider.capabilityId).not.toBe(SPEECH_TRANSCRIPTION_INTERFACE_KEY);
  });

  it("fails closed for an unknown provider instead of falling back", () => {
    expect(() => resolveSpeechTranscriptionProvider({ provider: "nope", env: {} })).toThrowError(/SPEECH_PROVIDER_NOT_CONFIGURED/);
  });

  it("fails closed when the declared provider has no credential", () => {
    expect(() => resolveSpeechTranscriptionProvider({ provider: "dashscope", env: {} })).toThrowError(/SPEECH_PROVIDER_NOT_CONFIGURED/);
  });
});

// ---------------------------------------------------------------------------
// 2. concrete provider normalization (same contract as fixture)
// ---------------------------------------------------------------------------
describe("2. concrete provider normalization", () => {
  it("normalizes the real DashScope protocol into the same shape as the fixture provider", async () => {
    const script = { sentences: [
      { id: 1, begin: 0, end: 4460, text: "三毫电机在运行时出现周期性的摩擦声。" },
      { id: 2, begin: 4460, end: 10200, text: "怀疑是轴承润滑不足导致，建议停机检查并补充润滑脂。" },
    ] };
    const { provider, sockets } = dashscopeWith(script);
    const real = await provider.transcribe({ artifact: ARTIFACT, audio: pcmFrames(), languageHints: ["zh"] });

    const fixture = new FixtureSpeechTranscriptionProvider({ segments: script.sentences.map((s) => ({ text: s.text, startMs: s.begin, endMs: s.end })) });
    const simulated = await fixture.transcribe({ artifact: ARTIFACT, audio: pcmFrames() });

    // 两个完全不同的来源 → 同一套规范化形状
    expect(Object.keys(real).sort()).toEqual(Object.keys(simulated).sort());
    expect(real.segments.map((s) => ({ text: s.text, startMs: s.startMs, endMs: s.endMs })))
      .toEqual(simulated.segments.map((s) => ({ text: s.text, startMs: s.startMs, endMs: s.endMs })));
    // 流式中间结果（sentence_end=false）不得被重复计入
    expect(real.segments).toHaveLength(2);
    expect(sockets[0]!.binaryBytes).toBe(6400);
    expect(sockets[0]!.receivedFinishTask).toBe(true);
  });

  it("never invents a fileName and carries the artifact identity through", async () => {
    const { provider } = dashscopeWith({ sentences: [{ id: 1, begin: 0, end: 100, text: "ok" }] });
    const result = await provider.transcribe({ artifact: ARTIFACT, audio: pcmFrames() });
    expect(result.interfaceKey).toBe("speech_transcription");
    expect(JSON.stringify(result)).not.toContain("fileName");
    expect(result.supportsTimestamps).toBe(true);
  });

  it("reports a protocol failure as a stable code rather than empty success", async () => {
    const provider = new DashScopeRealtimeSpeechTranscriptionProvider({
      apiKey: "test-key-not-a-real-credential",
      webSocketFactory: () => {
        const ws = new FakeWebSocket({ sentences: [] });
        const originalSend = ws.send.bind(ws);
        ws.send = (data: string | Uint8Array) => {
          if (typeof data === "string" && JSON.parse(data).header?.action === "run-task") {
            (ws as unknown as { emit: (t: string, d?: unknown) => void }).emit("message", JSON.stringify({ header: { event: "task-failed", error_code: "InvalidApiKey", error_message: "bad key" } }));
            return;
          }
          originalSend(data);
        };
        setTimeout(() => ws.open(), 0);
        return ws;
      },
    });
    await expect(provider.transcribe({ artifact: ARTIFACT, audio: pcmFrames() })).rejects.toThrowError(/SPEECH_PROVIDER_AUTH_FAILED/);
  });
});

// ---------------------------------------------------------------------------
// 3-4. invariants: bounds + empty text
// ---------------------------------------------------------------------------
describe("3-4. segment invariants fail closed", () => {
  const invalid: Array<[string, Record<string, unknown>]> = [
    ["endMs < startMs", { text: "a", startMs: 500, endMs: 100 }],
    ["endMs == startMs", { text: "a", startMs: 500, endMs: 500 }],
    ["startMs < 0", { text: "a", startMs: -1, endMs: 100 }],
    ["NaN", { text: "a", startMs: Number.NaN, endMs: 100 }],
    ["Infinity", { text: "a", startMs: 0, endMs: Number.POSITIVE_INFINITY }],
    ["string timestamp", { text: "a", startMs: "0", endMs: "100" }],
    ["empty text", { text: "", startMs: 0, endMs: 100 }],
    ["whitespace text", { text: "   ", startMs: 0, endMs: 100 }],
    ["missing bounds", { text: "a" }],
  ];
  for (const [label, raw] of invalid) {
    it(`rejects ${label} without repairing it`, () => {
      expect(() => normalizeTranscriptSegments([raw as never])).toThrowError(SpeechTranscriptionError);
    });
  }

  it("rejects an empty transcript entirely", () => {
    expect(() => normalizeTranscriptSegments([])).toThrowError(/SPEECH_TRANSCRIPT_EMPTY/);
  });

  it("accepts a well-formed segment and assigns index by order", () => {
    const segments = normalizeTranscriptSegments([
      { text: "第一句", startMs: 0, endMs: 4460 },
      { text: "第二句", startMs: 4460, endMs: 10200 },
    ]);
    expect(segments.map((s) => s.index)).toEqual([0, 1]);
    expect(() => assertTranscriptSegment(segments[0]!)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 5. missing timestamp cannot become Temporal Evidence
// ---------------------------------------------------------------------------
describe("5. a provider without timestamps cannot produce Temporal Evidence", () => {
  it("marks a text-only provider PARTIAL_FOR_TEMPORAL_EVIDENCE", () => {
    const provider = new FixtureTextOnlyProvider("只有全文，没有时间片");
    expect(provider.supportsTimestamps).toBe(false);
    expect(provider.textOnly().temporalEvidenceEligibility).toBe("PARTIAL_FOR_TEMPORAL_EVIDENCE");
  });

  it("refuses to fabricate [0, duration] for a text-only provider", async () => {
    const provider = new FixtureTextOnlyProvider("只有全文");
    await expect(provider.transcribe({} as never)).rejects.toThrowError(/SPEECH_SEGMENT_BOUNDS_INVALID|text-only/);
  });

  it("gates on supportsTimestamps independently of segment contents", () => {
    const segments = normalizeTranscriptSegments([{ text: "a", startMs: 0, endMs: 100 }]);
    expect(canProduceTemporalEvidence({ supportsTimestamps: true, segments })).toBe(true);
    expect(canProduceTemporalEvidence({ supportsTimestamps: false, segments })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 6. speaker label stays untrusted and optional
// ---------------------------------------------------------------------------
describe("6. speaker attribution boundary", () => {
  it("keeps speakerRef null when the provider gives none", async () => {
    const { provider } = dashscopeWith({ sentences: [{ id: 1, begin: 0, end: 100, text: "a" }] });
    const result = await provider.transcribe({ artifact: ARTIFACT, audio: pcmFrames() });
    expect(result.segments[0]!.speakerRef).toBeNull();
  });

  it("carries a provider label verbatim but marks it as non-identity", () => {
    const segments = normalizeTranscriptSegments([{ text: "a", startMs: 0, endMs: 100, speakerRef: "0" }]);
    expect(segments[0]!.speakerRef).toBe("0");
    const evidence = evidenceFromTranscriptSegment({
      id: "ev-speaker", tenantId: TENANT, contextId: "ctx-1", sourceSystemId: "sys-1",
      sourceDocumentId: "doc-1", sourceVersion: "v1", segment: segments[0]!, observedAt: NOW, createdAt: NOW,
    });
    expect(evidence.metadata.speakerRef).toBe("0");
    expect(evidence.metadata.speakerRefIsIdentity).toBe(false);
  });

  it("never turns a label into a person identity", () => {
    const segments = normalizeTranscriptSegments([{ text: "a", startMs: 0, endMs: 100, speakerRef: "speaker-1" }]);
    expect(JSON.stringify(segments)).not.toContain("employeeId");
    expect(JSON.stringify(segments)).not.toContain("subjectId");
  });
});

// ---------------------------------------------------------------------------
// 7-8. artifact identity determinism
// ---------------------------------------------------------------------------
describe("7-8. audio artifact identity", () => {
  it("produces a deterministic content hash for identical bytes", () => {
    const a = createHash("sha256").update(AUDIO_BYTES).digest("hex");
    const b = createHash("sha256").update(Buffer.from(AUDIO_BYTES)).digest("hex");
    expect(a).toBe(b);
    expect(a).toBe(AUDIO_HASH);
  });

  it("keeps artifact identity stable across repeated runs and independent of path", () => {
    const first = sourceDocumentFromArtifact({ id: "doc-1", tenantId: TENANT, sourceSystemId: "sys-1", contextId: "ctx-1", artifact: ARTIFACT, version: "v1", receivedAt: NOW });
    const second = sourceDocumentFromArtifact({ id: "doc-2", tenantId: TENANT, sourceSystemId: "sys-1", contextId: "ctx-1", artifact: { ...ARTIFACT }, version: "v1", receivedAt: NOW });
    expect(first.contentHash).toBe(second.contentHash);
    expect(first.externalDocumentId).toBe("recording-a2-test");
    // 身份里不出现任何本机路径
    expect(JSON.stringify(first)).not.toContain("/Users/");
  });
});

// ---------------------------------------------------------------------------
// 10-11. real (protocol-shaped) segment → Temporal Evidence, persisted and reloaded
// ---------------------------------------------------------------------------
describe("10-11. temporal evidence from a provider segment", () => {
  async function evidenceStore() {
    const { db, dbPath, store } = openStore();
    store.saveContext(createFulfillmentContext({ id: "ctx-1", tenantId: TENANT, businessKey: "SO-1", contextType: "field_service", status: "active", openedAt: NOW, updatedAt: NOW, metadata: {} }));
    store.saveSourceSystem(createSourceSystem({ id: "sys-1", tenantId: TENANT, name: "现场录音", systemType: "file", authorityLevel: "contributing", status: "active", metadata: {} }));
    store.saveBusinessEntity(createBusinessEntity({ id: "ent-1", tenantId: TENANT, contextId: "ctx-1", entityType: "device", businessKey: "DV-3", attributes: {}, createdAt: NOW, updatedAt: NOW }));
    store.saveSourceDocument(sourceDocumentFromArtifact({ id: "doc-1", tenantId: TENANT, sourceSystemId: "sys-1", contextId: "ctx-1", entityId: "ent-1", artifact: ARTIFACT, version: "v1", receivedAt: NOW }));
    return { db, dbPath, store };
  }

  it("turns a provider segment into evidence whose locator has no fileName", async () => {
    const script = { sentences: [
      { id: 1, begin: 0, end: 4460, text: "三毫电机在运行时出现周期性的摩擦声。" },
      { id: 2, begin: 4460, end: 10200, text: "怀疑是轴承润滑不足导致，建议停机检查并补充润滑脂。" },
    ] };
    const { provider } = dashscopeWith(script);
    const result = await provider.transcribe({ artifact: ARTIFACT, audio: pcmFrames(), languageHints: ["zh"] });
    const segment = result.segments[1]!;

    const evidence = evidenceFromTranscriptSegment({
      id: "ev-seg-2", tenantId: TENANT, contextId: "ctx-1", sourceSystemId: "sys-1",
      sourceDocumentId: "doc-1", sourceVersion: "v1", entityId: "ent-1",
      segment, observedAt: NOW, createdAt: NOW,
      transcriptOffsets: transcriptOffsetsFor(result.segments, 1),
    });

    expect(evidence.locator.startMs).toBe(4460);
    expect(evidence.locator.endMs).toBe(10200);
    expect(evidence.locator.fileName).toBeUndefined();
    expect(typeof evidence.locator.startMs).toBe("number");
    expect(evidenceLocatorKinds(evidence.locator)).toEqual(["temporal", "transcript"]);
    expect(evidence.quote).toBe(segment.text);
    expect(evidence.metadata.timeBase).toBe("offset_from_artifact_start");
    // 录音发生时间未知 → 不得编造
    expect(evidence.metadata.recordingOccurredAt).toBeUndefined();
  });

  it("persists and reloads the real time range without loss or stringification", async () => {
    const { db, dbPath, store } = await evidenceStore();
    const script = { sentences: [{ id: 1, begin: 0, end: 4460, text: "三毫电机在运行时出现周期性的摩擦声。" }] };
    const { provider } = dashscopeWith(script);
    const result = await provider.transcribe({ artifact: ARTIFACT, audio: pcmFrames() });
    store.saveEvidence(evidenceFromTranscriptSegment({
      id: "ev-1", tenantId: TENANT, contextId: "ctx-1", sourceSystemId: "sys-1",
      sourceDocumentId: "doc-1", sourceVersion: "v1", segment: result.segments[0]!, observedAt: NOW, createdAt: NOW,
    }));
    db.close();

    const reopened = new DatabaseSync(dbPath);
    openDbs.push(reopened);
    const reloaded = new V2SqliteStore(reopened).getEvidence(TENANT, "ev-1")!;
    expect(reloaded.locator).toEqual({ startMs: 0, endMs: 4460 });
    expect(typeof reloaded.locator.startMs).toBe("number");
    expect(reloaded.locator.fileName).toBeUndefined();
    expect(reloaded.sourceDocumentId).toBe("doc-1");
  });

  it("still rejects a segment that bypassed normalization", () => {
    expect(() => evidenceFromTranscriptSegment({
      id: "ev-bad", tenantId: TENANT, contextId: "ctx-1", sourceSystemId: "sys-1",
      sourceDocumentId: "doc-1", sourceVersion: "v1",
      segment: { index: 0, text: "x", startMs: 500, endMs: 100, speakerRef: null },
      observedAt: NOW, createdAt: NOW,
    })).toThrowError(DomainError);
  });
});

// ---------------------------------------------------------------------------
// 12. no new semantic type in the domain layer
// ---------------------------------------------------------------------------
describe("12. no semantic core changes", () => {
  it("does not export any transcript/audio semantic type from domain/v2", async () => {
    const domain = await import("../src/domain/v2/index.js");
    const keys = Object.keys(domain);
    expect(keys).not.toContain("TranscriptSegment");
    expect(keys).not.toContain("AudioObservation");
    expect(keys).not.toContain("AudioEvent");
    expect(keys).not.toContain("HumanAttentionSignal");
  });

  it("keeps the provider interface executable-only (no semantic object leaks into it)", () => {
    const provider: SpeechTranscriptionProvider = new FixtureSpeechTranscriptionProvider({ segments: [{ text: "a", startMs: 0, endMs: 1 }] });
    expect(provider.supportsTimestamps).toBe(true);
    expect(typeof provider.transcribe).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// §8/§15 boundary: no credential in any produced artifact
// ---------------------------------------------------------------------------
describe("credential hygiene", () => {
  it("never writes a credential into evidence or provider output", async () => {
    const { provider } = dashscopeWith({ sentences: [{ id: 1, begin: 0, end: 10, text: "a" }] });
    const result = await provider.transcribe({ artifact: ARTIFACT, audio: pcmFrames() });
    const serialized = JSON.stringify(result) + JSON.stringify(ARTIFACT);
    expect(serialized).not.toMatch(/sk-[A-Za-z0-9]{10,}/);
    expect(serialized.toLowerCase()).not.toContain("authorization");
    expect(serialized.toLowerCase()).not.toContain("apikey");
  });

  it("does not put a local path into the artifact identity", () => {
    const dir = workspace();
    const file = join(dir, "recording.wav");
    writeFileSync(file, AUDIO_BYTES);
    const doc = sourceDocumentFromArtifact({ id: "doc-x", tenantId: TENANT, sourceSystemId: "sys-1", contextId: "ctx-1", artifact: { ...ARTIFACT, artifactId: "recording-x" }, version: "v1", receivedAt: NOW });
    expect(JSON.stringify(doc)).not.toContain(dir);
    expect(JSON.stringify(doc)).not.toContain(file);
  });
});
