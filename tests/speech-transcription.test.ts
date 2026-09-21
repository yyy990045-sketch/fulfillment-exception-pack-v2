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
  ALLOWED_TIMESTAMP_PROVENANCE,
  FORBIDDEN_TIMESTAMP_PROVENANCE,
  assertTimestampProvenance,
  assertArtifactDerivation,
  traceEvidenceToArtifactAndInterval,
  reverseTraceEvidenceToAudio,
  sliceAudioInterval,
} from "../src/intelligence/speech-transcription/index.js";

type DatabaseSyncLike = {
  exec(sql: string): void;
  prepare(sql: string): { all(...p: unknown[]): unknown[]; get(...p: unknown[]): unknown; run(...p: unknown[]): unknown };
  close(): void;
};
const sqlite = process.getBuiltinModule("node:sqlite") as { DatabaseSync: new (p: string, o?: { readOnly?: boolean }) => DatabaseSyncLike } | undefined;
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
      timestampProvenance: "provider_reported_timestamps",
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
      timestampProvenance: "provider_reported_timestamps",
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
      timestampProvenance: "provider_reported_timestamps",
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
      timestampProvenance: "provider_reported_timestamps",
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

// ---------------------------------------------------------------------------
// Phase A2 R1 — Timestamp Provenance
// §20.3 timestamp provenance test：证明时间戳字段来自 provider/alignment 响应，
//         而不是 LLM 生成或任何本地推断出来的元数据
// ---------------------------------------------------------------------------
describe("R1 · timestamp provenance", () => {
  it("declares an admissible provenance on the real provider", () => {
    const { provider } = dashscopeWith({ sentences: [] });
    expect(provider.timestampProvenance).toBe("provider_reported_timestamps");
    expect(ALLOWED_TIMESTAMP_PROVENANCE).toContain(provider.timestampProvenance);
  });

  it("carries the provider-declared provenance through to the result", async () => {
    const { provider } = dashscopeWith({ sentences: [{ id: 1, begin: 120, end: 900, text: "三号电机" }] });
    const result = await provider.transcribe({ artifact: ARTIFACT, audio: pcmFrames() });
    expect(result.timestampProvenance).toBe("provider_reported_timestamps");
    // 时间戳确实来自协议里的 begin_time/end_time，而不是任何本地推导
    expect(result.segments[0]!.startMs).toBe(120);
    expect(result.segments[0]!.endMs).toBe(900);
  });

  it("rejects every forbidden provenance at the evidence boundary", () => {
    for (const forbidden of FORBIDDEN_TIMESTAMP_PROVENANCE) {
      expect(() => evidenceFromTranscriptSegment({
        id: `ev-${forbidden}`, tenantId: TENANT, contextId: "ctx-1", sourceSystemId: "sys-1",
        sourceDocumentId: "doc-1", sourceVersion: "v1",
        segment: { index: 0, text: "x", startMs: 0, endMs: 100, speakerRef: null },
        observedAt: NOW, createdAt: NOW,
        timestampProvenance: forbidden,
      })).toThrowError(/SPEECH_TIMESTAMP_PROVENANCE_FORBIDDEN/);
    }
  });

  it("rejects an undeclared or unknown provenance instead of assuming one", () => {
    const base = {
      id: "ev-undeclared", tenantId: TENANT, contextId: "ctx-1", sourceSystemId: "sys-1",
      sourceDocumentId: "doc-1", sourceVersion: "v1",
      segment: { index: 0, text: "x", startMs: 0, endMs: 100, speakerRef: null },
      observedAt: NOW, createdAt: NOW,
    };
    expect(() => evidenceFromTranscriptSegment({ ...base, timestampProvenance: "" }))
      .toThrowError(/SPEECH_TIMESTAMP_PROVENANCE_UNDECLARED/);
    expect(() => evidenceFromTranscriptSegment({ ...base, timestampProvenance: "trust-me-bro" }))
      .toThrowError(/SPEECH_TIMESTAMP_PROVENANCE_UNDECLARED/);
  });

  it("prevents a locally authored fixture from producing Temporal Evidence by default", async () => {
    // fixture 的时间戳是人工构造的 → 默认来源 manual_authoring → 属于禁止集合
    const fixture = new FixtureSpeechTranscriptionProvider({ segments: [{ text: "人工构造", startMs: 0, endMs: 500 }] });
    expect(fixture.timestampProvenance).toBe("manual_authoring");
    const result = await fixture.transcribe({ artifact: ARTIFACT, audio: pcmFrames() });
    expect(canProduceTemporalEvidence(result)).toBe(false);
    expect(() => evidenceFromTranscriptSegment({
      id: "ev-fixture", tenantId: TENANT, contextId: "ctx-1", sourceSystemId: "sys-1",
      sourceDocumentId: "doc-1", sourceVersion: "v1",
      segment: result.segments[0]!, observedAt: NOW, createdAt: NOW,
      timestampProvenance: result.timestampProvenance,
    })).toThrowError(/SPEECH_TIMESTAMP_PROVENANCE_FORBIDDEN/);
  });

  it("records the provenance on the evidence for later audit", () => {
    const evidence = evidenceFromTranscriptSegment({
      id: "ev-prov", tenantId: TENANT, contextId: "ctx-1", sourceSystemId: "sys-1",
      sourceDocumentId: "doc-1", sourceVersion: "v1",
      segment: { index: 0, text: "x", startMs: 0, endMs: 100, speakerRef: null },
      observedAt: NOW, createdAt: NOW,
      timestampProvenance: "forced_alignment",
    });
    expect(evidence.metadata.timestampProvenance).toBe("forced_alignment");
  });
});

// ---------------------------------------------------------------------------
// Phase A2 R2/R3 — Artifact + Interval Traceability / Reverse Trace Verification
// ---------------------------------------------------------------------------

/** 造一个确定性的 PCM WAV：给定毫秒生成静音 PCM。 */
function writeSilentWav(path: string, durationMs: number, sampleRateHz = 16000, channels = 1) {
  const frames = Math.round((durationMs / 1000) * sampleRateHz);
  const dataBytes = frames * channels * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(sampleRateHz, 24);
  buf.writeUInt32LE(sampleRateHz * channels * 2, 28);
  buf.writeUInt16LE(channels * 2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(dataBytes, 40);
  writeFileSync(path, buf);
  return { path, durationMs, sampleRateHz, channels, byteSize: buf.length };
}

describe("R2/R3 · artifact + interval traceability", () => {
  // 每个用例生成自己的音频：afterEach 会清掉 workspace，共享文件会在首个用例后被删
  const AUDIO_MS = 12_000;
  function makeAudio() {
    return writeSilentWav(join(workspace(), "authorized.wav"), AUDIO_MS);
  }

  async function persistedEvidence(audio: { path: string; durationMs: number }) {
    const dir = workspace();
    const dbPath = join(dir, "pack-cases.sqlite");
    const db = new DatabaseSync(dbPath);
    db.exec("PRAGMA foreign_keys = ON");
    runV2Migrations(db);
    const store = new V2SqliteStore(db);
    store.saveContext(createFulfillmentContext({ id: "ctx-1", tenantId: TENANT, businessKey: "SO-1", contextType: "professional_advisory", status: "active", openedAt: NOW, updatedAt: NOW, metadata: {} }));
    store.saveSourceSystem(createSourceSystem({ id: "sys-1", tenantId: TENANT, name: "授权测试录音", systemType: "file", authorityLevel: "contributing", status: "active", metadata: {} }));
    store.saveBusinessEntity(createBusinessEntity({ id: "ent-1", tenantId: TENANT, contextId: "ctx-1", entityType: "engagement", businessKey: "ENG-1", attributes: {}, createdAt: NOW, updatedAt: NOW }));
    store.saveSourceDocument(sourceDocumentFromArtifact({
      id: "doc-real", tenantId: TENANT, sourceSystemId: "sys-1", contextId: "ctx-1", entityId: "ent-1",
      artifact: { ...ARTIFACT, durationMs: audio.durationMs }, version: "v1", receivedAt: NOW,
    }));
    const { provider } = dashscopeWith({ sentences: [
      { id: 1, begin: 0, end: 4_460, text: "第一段真实转写" },
      { id: 2, begin: 4_460, end: 10_200, text: "第二段真实转写" },
    ] });
    const result = await provider.transcribe({
      artifact: { ...ARTIFACT, durationMs: audio.durationMs },
      audio: { kind: "wav-file", path: audio.path },
    });
    store.saveEvidence(evidenceFromTranscriptSegment({
      id: "ev-real", tenantId: TENANT, contextId: "ctx-1", sourceSystemId: "sys-1",
      sourceDocumentId: "doc-real", sourceVersion: "v1", entityId: "ent-1",
      segment: result.segments[1]!, observedAt: NOW, createdAt: NOW,
      timestampProvenance: result.timestampProvenance,
    }));
    db.close();

    const reopened = new DatabaseSync(dbPath, { readOnly: true });
    openDbs.push(reopened);
    const reopenedStore = new V2SqliteStore(reopened);
    return {
      evidence: reopenedStore.getEvidence(TENANT, "ev-real")!,
      document: reopenedStore.getSourceDocument(TENANT, "doc-real")!,
    };
  }

  it("resolves artifact identity and interval from a reloaded evidence record", async () => {
    const audio = makeAudio();
    const { evidence, document } = await persistedEvidence(audio);
    const trace = traceEvidenceToArtifactAndInterval({ evidence, sourceDocument: document });
    expect(trace.artifact.externalDocumentId).toBe(ARTIFACT.artifactId);
    expect(trace.artifact.contentHash).toBe(AUDIO_HASH);
    expect(trace.artifact.mediaType).toBe("audio/wav");
    expect(trace.interval.startMs).toBe(4_460);
    expect(trace.interval.endMs).toBe(10_200);
    expect(trace.intervalIsNonEmpty).toBe(true);
    expect(trace.locatorUsesFileName).toBe(false);
    expect(trace.timestampProvenance).toBe("provider_reported_timestamps");
  });

  it("proves the interval fits inside the real audio duration", async () => {
    const audio = makeAudio();
    const { evidence, document } = await persistedEvidence(audio);
    const trace = traceEvidenceToArtifactAndInterval({ evidence, sourceDocument: document });
    expect(trace.artifact.durationMs).toBe(AUDIO_MS);
    expect(trace.intervalWithinDuration).toBe(true);
  });

  it("reverse-traces back into the original audio and re-reads that exact interval", async () => {
    const audio = makeAudio();
    const { evidence, document } = await persistedEvidence(audio);
    const { trace, slice } = reverseTraceEvidenceToAudio({ evidence, sourceDocument: document, audioPath: audio.path });
    // 定位信息确实足以重新读取该区间
    expect(slice.sliceNonEmpty).toBe(true);
    expect(slice.byteLength).toBeGreaterThan(0);
    // 毫秒 → 字节换算可验证：16kHz/mono/16bit ⇒ 每毫秒 32 字节
    const expectedBytes = Math.ceil(10_200 * 32) - Math.floor(4_460 * 32);
    expect(slice.byteLength).toBe(expectedBytes);
    expect(slice.audioDurationMs).toBe(AUDIO_MS);
    expect(slice.artifactResolved).toBe(true);
    expect(trace.artifact.contentHash).toBe(AUDIO_HASH);
  });

  it("re-reads a different interval to a different slice (not a constant)", async () => {
    const audio = makeAudio();
    const { evidence, document } = await persistedEvidence(audio);
    const full = traceEvidenceToArtifactAndInterval({ evidence, sourceDocument: document });
    const first = sliceAudioInterval(audio.path, 0, 1_000);
    const second = sliceAudioInterval(audio.path, full.interval.startMs, full.interval.endMs);
    expect(first.length).not.toBe(second.length);
  });

  it("fails closed when the interval exceeds the real audio", () => {
    const audio = makeAudio();
    expect(() => sliceAudioInterval(audio.path, 11_000, 99_000)).toThrowError(/SPEECH_SEGMENT_EXCEEDS_DURATION/);
  });

  it("fails closed on an empty or inverted interval", () => {
    const audio = makeAudio();
    expect(() => sliceAudioInterval(audio.path, 500, 500)).toThrowError(/SPEECH_SEGMENT_BOUNDS_INVALID/);
    expect(() => sliceAudioInterval(audio.path, 900, 100)).toThrowError(/SPEECH_SEGMENT_BOUNDS_INVALID/);
  });

  it("rejects a segment whose endMs exceeds the declared audio duration", () => {
    expect(() => normalizeTranscriptSegments([{ text: "x", startMs: 0, endMs: 20_000 }], 12_000))
      .toThrowError(/SPEECH_SEGMENT_EXCEEDS_DURATION/);
    // 时长未知时跳过该检查，而不是猜
    expect(() => normalizeTranscriptSegments([{ text: "x", startMs: 0, endMs: 20_000 }]))
      .not.toThrow();
  });

  it("refuses to trace an evidence that has no temporal locator", () => {
    const { evidence, document } = { evidence: null as never, document: null as never };
    void evidence; void document;
    expect(() => traceEvidenceToArtifactAndInterval({
      evidence: { id: "ev-doc", tenantId: TENANT, contextId: "ctx-1", sourceSystemId: "sys-1", sourceDocumentId: "doc", sourceVersion: "v1", field: "f", value: "v", valueType: "string", locator: { fileName: "a.csv" }, quote: "q", confidence: 1, support: "supported", observedAt: NOW, createdAt: NOW, metadata: {} },
      sourceDocument: { id: "doc", tenantId: TENANT, sourceSystemId: "sys-1", externalDocumentId: "a", documentType: "t", contentHash: "h", receivedAt: NOW, effectiveAt: null, version: "v1", metadata: {} },
    })).toThrowError(/SPEECH_SEGMENT_BOUNDS_INVALID/);
  });
});

// ---------------------------------------------------------------------------
// Phase A2.1 — Real-World Microphone Capture Closure
// §18.5 compressed / non-PCM media cannot use PCM byte slicing
// ---------------------------------------------------------------------------

/** 造一个 **压缩** WAV 容器：RIFF/WAVE 但 audioFormat != 1。 */
function writeCompressedWav(path: string, audioFormat: number, bitsPerSample = 4) {
  const body = Buffer.alloc(64);
  body.write("RIFF", 0, "ascii");
  body.writeUInt32LE(60, 4);
  body.write("WAVE", 8, "ascii");
  body.write("fmt ", 12, "ascii");
  body.writeUInt32LE(16, 16);
  body.writeUInt16LE(audioFormat, 20); // ← 关键：非 PCM
  body.writeUInt16LE(1, 22);
  body.writeUInt32LE(16000, 24);
  body.writeUInt32LE(8000, 28);
  body.writeUInt16LE(2, 32);
  body.writeUInt16LE(bitsPerSample, 34);
  body.write("data", 36, "ascii");
  body.writeUInt32LE(20, 40);
  writeFileSync(path, body);
  return path;
}

describe("A2.1 · compressed media must not use PCM byte slicing", () => {
  it("rejects MP3 / M4A / OGG style containers", () => {
    const dir = workspace();
    const mp3 = join(dir, "clip.mp3");
    writeFileSync(mp3, Buffer.concat([Buffer.from("ID3"), Buffer.alloc(200)]));
    const m4a = join(dir, "clip.m4a");
    writeFileSync(m4a, Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from("ftypM4A ", "ascii"), Buffer.alloc(100)]));
    const ogg = join(dir, "clip.ogg");
    writeFileSync(ogg, Buffer.concat([Buffer.from("OggS"), Buffer.alloc(100)]));

    for (const path of [mp3, m4a, ogg]) {
      expect(() => sliceAudioInterval(path, 0, 500)).toThrowError(/SPEECH_AUDIO_NOT_UNCOMPRESSED_PCM/);
    }
  });

  it("rejects a compressed WAV container instead of silently mis-slicing it", () => {
    const dir = workspace();
    // 0x0002 = ADPCM, 0x0055 = MP3-in-WAV, 0x0006 = A-law, 0x0007 = µ-law
    for (const fmt of [0x0002, 0x0055, 0x0006, 0x0007]) {
      const path = writeCompressedWav(join(dir, `compressed-${fmt.toString(16)}.wav`), fmt);
      expect(() => sliceAudioInterval(path, 0, 100)).toThrowError(/SPEECH_AUDIO_NOT_UNCOMPRESSED_PCM/);
    }
  });

  it("rejects a WAV whose blockAlign contradicts channels × bit depth", () => {
    const dir = workspace();
    const path = join(dir, "bad-align.wav");
    const buf = Buffer.alloc(64);
    buf.write("RIFF", 0, "ascii"); buf.writeUInt32LE(56, 4); buf.write("WAVE", 8, "ascii");
    buf.write("fmt ", 12, "ascii"); buf.writeUInt32LE(16, 16);
    buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(16000, 24);
    buf.writeUInt32LE(64000, 28); buf.writeUInt16LE(99, 32); buf.writeUInt16LE(16, 34); // blockAlign 应为 4
    buf.write("data", 36, "ascii"); buf.writeUInt32LE(16, 40);
    writeFileSync(path, buf);
    expect(() => sliceAudioInterval(path, 0, 1)).toThrowError(/SPEECH_AUDIO_NOT_UNCOMPRESSED_PCM/);
  });

  it("never falls back to a size-proportional estimate for unsupported media", () => {
    const dir = workspace();
    const mp3 = join(dir, "ratio.mp3");
    writeFileSync(mp3, Buffer.alloc(50_000, 7));
    // 若实现按文件大小线性映射就会"成功"返回一个非空 slice —— 必须是报错
    expect(() => sliceAudioInterval(mp3, 100, 900)).toThrowError(/SPEECH_AUDIO_NOT_UNCOMPRESSED_PCM/);
  });

  it("still slices genuine uncompressed PCM WAV", () => {
    const dir = workspace();
    const wav = writeSilentWav(join(dir, "pcm.wav"), 3_000);
    expect(sliceAudioInterval(wav.path, 100, 900).length).toBe(25_600);
  });
});

// ---------------------------------------------------------------------------
// §18.9 timestamp provenance must not claim an unverified internal algorithm
// ---------------------------------------------------------------------------
describe("A2.1 · timestamp provenance is not an algorithm claim", () => {
  it("no longer accepts the removed acoustic-alignment claim", () => {
    expect(ALLOWED_TIMESTAMP_PROVENANCE as readonly string[]).not.toContain("provider_acoustic_alignment");
    expect(() => assertTimestampProvenance("provider_acoustic_alignment"))
      .toThrowError(/SPEECH_TIMESTAMP_PROVENANCE_UNDECLARED/);
  });

  it("accepts only provenance that describes an observable fact", () => {
    // provider_reported_timestamps = 「provider 报告了这些时间戳」——可观测事实
    expect(assertTimestampProvenance("provider_reported_timestamps")).toBeUndefined();
    // 我们自己跑并验证过的对齐机制也允许
    expect(assertTimestampProvenance("forced_alignment")).toBeUndefined();
    expect(assertTimestampProvenance("deterministic_audio_alignment")).toBeUndefined();
  });

  it("the real provider declares provider_reported_timestamps", () => {
    const { provider } = dashscopeWith({ sentences: [] });
    expect(provider.timestampProvenance).toBe("provider_reported_timestamps");
  });
});

// ---------------------------------------------------------------------------
// §18.1-4 capture provenance + original/normalized artifact separation
// ---------------------------------------------------------------------------
describe("A2.1 · capture provenance and artifact derivation", () => {
  const ORIGINAL_HASH = "b".repeat(64);
  const NORMALIZED_HASH = "c".repeat(64);
  const capture = {
    captureType: "microphone" as const,
    deviceCategory: "built_in_microphone" as const,
    originalMediaType: "audio/x-caf",
    originalContentHash: ORIGINAL_HASH,
    originalByteSize: 480_000,
    originalDurationMs: 20_000,
  };

  it("keeps original and normalized artifacts distinguishable", () => {
    const ref = { ...ARTIFACT, contentHash: NORMALIZED_HASH, capture, derivedFrom: { contentHash: ORIGINAL_HASH, relationship: "normalized_from" as const } };
    expect(() => assertArtifactDerivation(ref)).not.toThrow();
    expect(ref.contentHash).not.toBe(ref.capture.originalContentHash);
  });

  it("refuses a normalized artifact that pretends to be the original", () => {
    expect(() => assertArtifactDerivation({
      ...ARTIFACT, contentHash: ORIGINAL_HASH, capture, derivedFrom: { contentHash: ORIGINAL_HASH, relationship: "normalized_from" },
    })).toThrowError(/SPEECH_ARTIFACT_DERIVATION_INVALID/);
  });

  it("refuses a derivedFrom that disagrees with the capture hash", () => {
    expect(() => assertArtifactDerivation({
      ...ARTIFACT, contentHash: NORMALIZED_HASH, capture,
      derivedFrom: { contentHash: "d".repeat(64), relationship: "normalized_from" },
    })).toThrowError(/SPEECH_ARTIFACT_DERIVATION_INVALID/);
  });

  it("refuses derivedFrom without capture provenance", () => {
    expect(() => assertArtifactDerivation({
      ...ARTIFACT, contentHash: NORMALIZED_HASH,
      derivedFrom: { contentHash: ORIGINAL_HASH, relationship: "normalized_from" },
    })).toThrowError(/SPEECH_ARTIFACT_DERIVATION_INVALID/);
  });

  it("carries capture provenance into the SourceDocument so it survives reload", async () => {
    const dir = workspace();
    const dbPath = join(dir, "pack-cases.sqlite");
    const db = new DatabaseSync(dbPath);
    db.exec("PRAGMA foreign_keys = ON");
    runV2Migrations(db);
    const store = new V2SqliteStore(db);
    store.saveContext(createFulfillmentContext({ id: "ctx-cap", tenantId: TENANT, businessKey: "SO-CAP", contextType: "professional_advisory", status: "active", openedAt: NOW, updatedAt: NOW, metadata: {} }));
    store.saveSourceSystem(createSourceSystem({ id: "sys-cap", tenantId: TENANT, name: "麦克风采集", systemType: "file", authorityLevel: "contributing", status: "active", metadata: {} }));
    store.saveSourceDocument(sourceDocumentFromArtifact({
      id: "doc-cap", tenantId: TENANT, sourceSystemId: "sys-cap", contextId: "ctx-cap",
      artifact: { ...ARTIFACT, contentHash: NORMALIZED_HASH, capture, derivedFrom: { contentHash: ORIGINAL_HASH, relationship: "normalized_from" } },
      version: "v1", receivedAt: NOW,
    }));
    db.close();
    const reopened = new DatabaseSync(dbPath, { readOnly: true });
    openDbs.push(reopened);
    const doc = new V2SqliteStore(reopened).getSourceDocument(TENANT, "doc-cap")!;
    const meta = doc.metadata as Record<string, unknown>;
    expect((meta.capture as Record<string, unknown>).deviceCategory).toBe("built_in_microphone");
    expect((meta.capture as Record<string, unknown>).originalContentHash).toBe(ORIGINAL_HASH);
    expect((meta.derivedFrom as Record<string, unknown>).contentHash).toBe(ORIGINAL_HASH);
    expect(doc.contentHash).toBe(NORMALIZED_HASH);
  });
});
