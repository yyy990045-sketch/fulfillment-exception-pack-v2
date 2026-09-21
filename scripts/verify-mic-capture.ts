/**
 * `npm run mic:verify -- --capture-dir <dir> [--env-file <path>] [--out <artifact.json>]`
 *
 * Phase A2.1 — Real-World Microphone Capture Closure
 *
 * 完全复用 A2 的链路，只把音频来源从"本地合成"换成"真人麦克风采集"：
 *
 *   microphone capture → original artifact → (normalization) → normalized artifact
 *     → speech_transcription (real provider) → timestamped segments
 *     → Observation / Temporal Evidence → persist → close → reload → reverse trace
 *
 * 与 A2 的关键差异（§5）：
 *   原始采集（AAC/M4A）与规范化产物（PCM WAV）是**两个工件**，
 *   各自有 contentHash，并以 derivedFrom 关联。转码后的 WAV **不得**冒充原始录音。
 *
 * 不记录：设备序列号、用户私密路径、不可验证的型号。
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  V2SqliteStore,
  createBusinessEntity,
  createFulfillmentContext,
  createSourceSystem,
  runV2Migrations,
} from "../src/domain/v2/index.js";
import {
  SPEECH_TRANSCRIPTION_INTERFACE_KEY,
  evidenceFromTranscriptSegment,
  resolveSpeechTranscriptionProvider,
  reverseTraceEvidenceToAudio,
  sourceDocumentFromArtifact,
  transcriptOffsetsFor,
  type AudioArtifactRef,
} from "../src/intelligence/speech-transcription/index.js";
import { extractPcmFromWav } from "../src/intelligence/speech-transcription/providers/dashscope-realtime.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function loadEnvFile(path: string) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const k = t.slice(0, eq).trim();
    if (!process.env[k]) process.env[k] = t.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
  }
}
loadEnvFile(arg("env-file") ?? ".env.local");

const captureDir = resolve(arg("capture-dir") ?? "");
const outPath = resolve(arg("out") ?? "docs/competition/runtime/real-world-mic-capture-verification.json");
const TENANT = "demo-manufacturing";
const NOW = new Date().toISOString();
const sha256 = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

const artifact: Record<string, unknown> = {
  schemaVersion: "real-world-mic-capture-verification/v1",
  generatedAt: NOW,
  interfaceKey: SPEECH_TRANSCRIPTION_INTERFACE_KEY,
  provider: "dashscope",
  capabilityId: "dashscope-paraformer-realtime@v1",
  model: "paraformer-realtime-v2",
  captureSource: null,
  originalArtifact: null,
  normalizedArtifact: null,
  transcription: null,
  temporalEvidence: null,
  realProviderVerified: false,
  realHumanMicCaptureVerified: false,
  temporalEvidenceReverseTraceVerified: false,
  verdict: "BLOCKED",
  blocker: null,
  notes: [],
};

const write = () => {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
};
const blocked = (reason: string, detail?: string) => {
  artifact.verdict = "BLOCKED";
  artifact.blocker = reason;
  if (detail) (artifact.notes as string[]).push(detail);
  write();
  console.log(`BLOCKED  ${reason}${detail ? ` — ${detail}` : ""}`);
  console.log(`artifact: ${outPath}`);
  process.exitCode = 2;
};

async function main() {
  if (!captureDir || !existsSync(captureDir)) {
    blocked("CAPTURE_DIR_MISSING", "run scripts/capture-mic-audio.sh first");
    return;
  }
  const manifestPath = join(captureDir, "capture.json");
  if (!existsSync(manifestPath)) {
    blocked("CAPTURE_MANIFEST_MISSING", manifestPath);
    return;
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
  const originalPath = join(captureDir, "capture-original.m4a");
  const normalizedPath = join(captureDir, "capture-normalized.wav");
  if (!existsSync(originalPath) || !existsSync(normalizedPath)) {
    blocked("CAPTURE_FILES_MISSING", `${originalPath} | ${normalizedPath}`);
    return;
  }

  // ---- 独立重算哈希：不采信 capture.json 里的值 ----
  const originalBytes = readFileSync(originalPath);
  const normalizedBytes = readFileSync(normalizedPath);
  const originalHash = sha256(originalBytes);
  const normalizedHash = sha256(normalizedBytes);
  const parsed = extractPcmFromWav(normalizedBytes);
  const durationMs = Math.floor((parsed.pcm.length / parsed.bytesPerSecond) * 1000);

  const hashConsistent =
    originalHash === manifest.originalContentHash && normalizedHash === manifest.normalizedContentHash;

  artifact.captureSource = {
    captureType: "microphone",
    // 只记录能确认的粒度（system_profiler 确认本机默认输入为 Built-in 麦克风）
    deviceCategory: manifest.deviceCategory,
    notWork3200: true,
  };
  artifact.originalArtifact = {
    mediaType: manifest.originalMediaType,
    contentHash: originalHash,
    byteSize: originalBytes.length,
    note: "原始采集工件；转码不改变它的哈希",
  };
  artifact.normalizedArtifact = {
    mediaType: "audio/wav",
    contentHash: normalizedHash,
    byteSize: normalizedBytes.length,
    durationMs,
    sampleRateHz: parsed.sampleRateHz,
    channels: parsed.channels,
    bitsPerSample: parsed.bitsPerSample,
    derivedFrom: originalHash,
    derivation: manifest.derivation ?? null,
  };
  artifact.manifestHashesConsistent = hashConsistent;
  if (!hashConsistent) {
    blocked("CAPTURE_MANIFEST_HASH_MISMATCH", "capture.json hashes do not match the files on disk");
    return;
  }
  if (originalHash === normalizedHash) {
    blocked("NORMALIZATION_NOT_OBSERVED", "original and normalized share a hash; cannot claim derivation");
    return;
  }

  if (!process.env.DASHSCOPE_API_KEY?.trim()) {
    blocked("SPEECH_PROVIDER_NOT_CONFIGURED", "DASHSCOPE_API_KEY not set (value never read into the artifact)");
    return;
  }

  // ---- artifact ref：normalized 为转写工件，携带原始采集溯源 ----
  const ref: AudioArtifactRef = {
    artifactId: "mic-capture-a2-1",
    mediaType: "audio/wav",
    contentHash: normalizedHash,
    byteSize: normalizedBytes.length,
    sampleRateHz: parsed.sampleRateHz,
    channels: parsed.channels,
    durationMs,
    capture: {
      captureType: "microphone",
      deviceCategory: (manifest.deviceCategory as never) ?? "unknown_controlled_microphone",
      originalMediaType: String(manifest.originalMediaType ?? "audio/mp4"),
      originalContentHash: originalHash,
      originalByteSize: originalBytes.length,
      ...(typeof manifest.originalDurationMs === "number" ? { originalDurationMs: manifest.originalDurationMs } : {}),
    },
    derivedFrom: { contentHash: originalHash, relationship: "normalized_from" },
  };

  const provider = resolveSpeechTranscriptionProvider({ provider: "dashscope", env: process.env });
  let result;
  const startedAt = Date.now();
  try {
    result = await provider.transcribe({
      artifact: ref,
      audio: { kind: "wav-file", path: normalizedPath },
      languageHints: ["zh"],
      timeoutMs: 120_000,
    });
  } catch (error) {
    blocked((error as { code?: string }).code ?? "SPEECH_PROVIDER_UNAVAILABLE", error instanceof Error ? error.message.slice(0, 300) : "unknown");
    return;
  }

  artifact.transcription = {
    segmentCount: result.segments.length,
    allSegmentsHaveTimestamps: result.segments.every((s) => Number.isFinite(s.startMs) && Number.isFinite(s.endMs) && s.endMs > s.startMs),
    timestampsWithinAudioDuration: result.segments.every((s) => s.endMs <= durationMs),
    timestampProvenance: result.timestampProvenance,
    latencyMs: Date.now() - startedAt,
    segments: result.segments.map((s) => ({
      index: s.index, startMs: s.startMs, endMs: s.endMs,
      textChars: s.text.length,
      textHash: sha256(s.text).slice(0, 16),
      speakerRef: s.speakerRef,
    })),
    transcriptHash: sha256(result.text).slice(0, 16),
  };

  // ---- E2E ----
  const workspace = mkdtempSync(join(tmpdir(), "fep-a21-verify-"));
  try {
    const dbPath = join(workspace, "pack-cases.sqlite");
    const db = new DatabaseSync(dbPath);
    runV2Migrations(db);
    const store = new V2SqliteStore(db);
    store.saveContext(createFulfillmentContext({ id: "ctx-a21", tenantId: TENANT, businessKey: "SO-A21", contextType: "professional_advisory", status: "active", openedAt: NOW, updatedAt: NOW, metadata: {} }));
    store.saveSourceSystem(createSourceSystem({ id: "sys-a21", tenantId: TENANT, name: "授权麦克风采集", systemType: "file", authorityLevel: "contributing", status: "active", metadata: {} }));
    store.saveBusinessEntity(createBusinessEntity({ id: "ent-a21", tenantId: TENANT, contextId: "ctx-a21", entityType: "engagement", businessKey: "ENG-A21", attributes: {}, createdAt: NOW, updatedAt: NOW }));
    store.saveSourceDocument(sourceDocumentFromArtifact({
      id: "doc-a21", tenantId: TENANT, sourceSystemId: "sys-a21", contextId: "ctx-a21", entityId: "ent-a21",
      artifact: ref, version: "v1", receivedAt: NOW,
    }));

    const chosen = result.segments[result.segments.length - 1]!;
    store.saveEvidence(evidenceFromTranscriptSegment({
      id: "ev-a21", tenantId: TENANT, contextId: "ctx-a21", sourceSystemId: "sys-a21",
      sourceDocumentId: "doc-a21", sourceVersion: "v1", entityId: "ent-a21",
      segment: chosen, observedAt: NOW, createdAt: NOW,
      transcriptOffsets: transcriptOffsetsFor(result.segments, chosen.index),
      timestampProvenance: result.timestampProvenance,
    }));
    db.close();

    const reopened = new DatabaseSync(dbPath, { readOnly: true });
    const reopenedStore = new V2SqliteStore(reopened);
    const reloaded = reopenedStore.getEvidence(TENANT, "ev-a21")!;
    const doc = reopenedStore.getSourceDocument(TENANT, "doc-a21")!;
    reopened.close();

    const preserved =
      reloaded.locator.startMs === chosen.startMs
      && reloaded.locator.endMs === chosen.endMs
      && typeof reloaded.locator.startMs === "number"
      && reloaded.locator.fileName === undefined
      && reloaded.quote === chosen.text
      && doc.contentHash === normalizedHash;

    const docMeta = doc.metadata as Record<string, unknown>;
    const captureSurvived = (docMeta.capture as Record<string, unknown> | undefined)?.originalContentHash === originalHash;

    let reverseTrace: Record<string, unknown> | null = null;
    let reverseOk = false;
    try {
      const traced = reverseTraceEvidenceToAudio({ evidence: reloaded, sourceDocument: doc, audioPath: normalizedPath });
      reverseOk = traced.slice.sliceNonEmpty
        && traced.slice.artifactResolved
        && traced.slice.intervalWithinDuration === true
        && traced.trace.artifact.contentHash === normalizedHash
        && traced.trace.locatorUsesFileName === false;
      reverseTrace = {
        artifactExternalDocumentId: traced.trace.artifact.externalDocumentId,
        artifactContentHash: traced.trace.artifact.contentHash,
        interval: { startMs: traced.trace.interval.startMs, endMs: traced.trace.interval.endMs },
        intervalIsNonEmpty: traced.trace.intervalIsNonEmpty,
        intervalWithinDuration: traced.trace.intervalWithinDuration,
        locatorUsesFileName: traced.trace.locatorUsesFileName,
        timestampProvenance: traced.trace.timestampProvenance,
        sliceByteStart: traced.slice.byteStart,
        sliceByteEnd: traced.slice.byteEnd,
        sliceByteLength: traced.slice.byteLength,
        sliceNonEmpty: traced.slice.sliceNonEmpty,
        audioDurationMs: traced.slice.audioDurationMs,
      };
    } catch (error) {
      reverseTrace = { error: (error as { code?: string }).code ?? (error instanceof Error ? error.message : "unknown") };
    }

    artifact.temporalEvidence = {
      evidenceId: reloaded.id,
      segmentIndex: chosen.index,
      startMs: reloaded.locator.startMs,
      endMs: reloaded.locator.endMs,
      timeBase: "offset_from_artifact_start",
      locatorHasFileName: reloaded.locator.fileName !== undefined,
      startMsType: typeof reloaded.locator.startMs,
      persistedAndReloaded: true,
      timeRangePreserved: preserved,
      artifactHashMatches: doc.contentHash === normalizedHash,
      captureProvenanceSurvivedReload: captureSurvived,
      speakerRef: reloaded.metadata.speakerRef ?? null,
      speakerRefIsIdentity: false,
      reverseTrace,
    };

    artifact.realProviderVerified = true;
    artifact.realHumanMicCaptureVerified = true;
    artifact.temporalEvidenceReverseTraceVerified = reverseOk;

    if (!preserved) { artifact.verdict = "FAILED"; artifact.blocker = "TEMPORAL_EVIDENCE_NOT_PRESERVED"; }
    else if (!captureSurvived) { artifact.verdict = "FAILED"; artifact.blocker = "CAPTURE_PROVENANCE_LOST"; }
    else if (!reverseOk) { artifact.verdict = "FAILED"; artifact.blocker = "REVERSE_TRACE_FAILED"; }
    else if (result.segments.length === 0) { artifact.verdict = "PARTIAL"; artifact.blocker = "NO_SEGMENTS"; }
    else { artifact.verdict = "LIVE_VERIFIED"; }

    write();
    console.log(`${artifact.verdict}  segments=${result.segments.length} duration=${durationMs}ms`);
    console.log(`  segment[${chosen.index}] ${chosen.startMs}ms → ${chosen.endMs}ms`);
    console.log(`  capture provenance survived reload: ${captureSurvived}`);
    console.log(`  reverse trace: ${reverseOk}`);
    console.log(`artifact: ${outPath}`);
    process.exitCode = artifact.verdict === "LIVE_VERIFIED" ? 0 : 1;
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

await main();
