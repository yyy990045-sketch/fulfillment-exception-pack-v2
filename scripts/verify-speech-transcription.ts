/**
 * `npm run speech:verify -- --audio <path> [--out <artifact.json>] [--env-file <path>]`
 *
 * Phase A2 的真实 provider 验证：用一段**用户有权使用**的真实音频，
 * 走真实 speech transcription runtime，把真实片段落成 Temporal Evidence，
 * 并写出机器可读的验证 artifact。
 *
 * 明确的真值边界：
 *   - 只有**真实调用了 provider** 才写 realProviderVerified=true
 *   - 缺凭据 / 网络不可达 / provider 报错 → BLOCKED，**绝不用 fixture 冒充 PASS**
 *   - 验证 artifact **不含任何凭据**，也不含完整转写全文（只记 hash 与计数）
 *   - 不联网的 fixture 结果只能标 SIMULATED_FIXTURE
 */
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { mkdirSync } from "node:fs";
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
  sourceDocumentFromArtifact,
  transcriptOffsetsFor,
  type AudioArtifactRef,
} from "../src/intelligence/speech-transcription/index.js";
import { extractPcmFromWav } from "../src/intelligence/speech-transcription/providers/dashscope-realtime.js";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

/** 极简 dotenv 读取：只为本地验证服务，绝不回显值。 */
function loadEnvFile(path: string) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

// 默认只读本仓库根的 .env.local；要读别处的凭据必须显式 --env-file <path>。
// 这里刻意不写死任何机器上的绝对路径。
const envFile = arg("env-file") ?? ".env.local";
loadEnvFile(envFile);

const audioPath = arg("audio") ?? "/tmp/fep-a2-audio/recording.wav";
const outPath = resolve(arg("out") ?? "docs/competition/runtime/speech-transcription-verification.json");
const TENANT = "demo-manufacturing";
const NOW = new Date().toISOString();

const artifact: Record<string, unknown> = {
  schemaVersion: "speech-transcription-verification/v1",
  generatedAt: NOW,
  interfaceKey: SPEECH_TRANSCRIPTION_INTERFACE_KEY,
  provider: "dashscope",
  capabilityId: "dashscope-paraformer-realtime@v1",
  model: "paraformer-realtime-v2",
  audio: null,
  result: null,
  temporalEvidence: null,
  realProviderVerified: false,
  realAudioToTemporalEvidenceVerified: false,
  verdict: "BLOCKED",
  blocker: null,
  notes: [],
};

function write() {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
}

function blocked(reason: string, detail?: string) {
  artifact.verdict = "BLOCKED";
  artifact.blocker = reason;
  if (detail) (artifact.notes as string[]).push(detail);
  write();
  console.log(`BLOCKED  ${reason}${detail ? ` — ${detail}` : ""}`);
  console.log(`artifact: ${outPath}`);
  process.exitCode = 2;
}

async function main() {
  if (!existsSync(audioPath)) {
    blocked("AUDIO_FILE_MISSING", `${audioPath} (generate the authorized clip first; see the A2 doc)`);
    return;
  }
  const audioBytes = readFileSync(audioPath);
  const contentHash = createHash("sha256").update(audioBytes).digest("hex");
  const parsed = extractPcmFromWav(audioBytes);
  const ref: AudioArtifactRef = {
    artifactId: "a2-authorized-tts-clip",
    mediaType: "audio/wav",
    contentHash,
    byteSize: audioBytes.length,
    sampleRateHz: parsed.sampleRateHz,
    channels: parsed.channels,
  };
  artifact.audio = {
    artifactId: ref.artifactId,
    mediaType: ref.mediaType,
    contentHash: ref.contentHash,
    byteSize: ref.byteSize,
    sampleRateHz: ref.sampleRateHz,
    channels: ref.channels,
    // 绝不记录本机绝对路径
    sourceNote: "locally synthesized authorized clip; not a field recording",
  };

  if (!process.env.DASHSCOPE_API_KEY?.trim()) {
    blocked("SPEECH_PROVIDER_NOT_CONFIGURED", "DASHSCOPE_API_KEY not set (value never read into the artifact)");
    return;
  }

  const provider = resolveSpeechTranscriptionProvider({ provider: "dashscope", env: process.env });
  const startedAt = Date.now();
  let result;
  try {
    result = await provider.transcribe({
      artifact: ref,
      audio: { kind: "wav-file", path: resolve(audioPath) },
      languageHints: ["zh"],
      timeoutMs: 90_000,
    });
  } catch (error) {
    const code = (error as { code?: string }).code ?? "SPEECH_PROVIDER_UNAVAILABLE";
    blocked(code, error instanceof Error ? error.message.slice(0, 300) : "unknown");
    return;
  }
  const latencyMs = Date.now() - startedAt;

  if (!result.supportsTimestamps) {
    artifact.verdict = "PARTIAL";
    artifact.blocker = "PROVIDER_HAS_NO_TIMESTAMPS";
    artifact.result = { segmentCount: result.segments.length, error: "provider reports no timestamp support" };
    write();
    console.log("PARTIAL  provider has no timestamps");
    process.exitCode = 3;
    return;
  }

  artifact.result = {
    segmentCount: result.segments.length,
    allSegmentsHaveTimestamps: result.segments.every((s) => Number.isFinite(s.startMs) && Number.isFinite(s.endMs) && s.endMs > s.startMs),
    segments: result.segments.map((s) => ({
      index: s.index,
      startMs: s.startMs,
      endMs: s.endMs,
      textChars: s.text.length,
      textHash: createHash("sha256").update(s.text).digest("hex").slice(0, 16),
      speakerRef: s.speakerRef,
    })),
    transcriptHash: createHash("sha256").update(result.text).digest("hex").slice(0, 16),
    latencyMs,
    capabilityId: result.capabilityId,
    interfaceKey: result.interfaceKey,
  };

  // ---- E2E: real segment → Temporal Evidence → persist → reload ----
  const workspace = mkdtempSync(join(tmpdir(), "fep-a2-verify-"));
  try {
    const dbPath = join(workspace, "pack-cases.sqlite");
    const db = new DatabaseSync(dbPath);
    runV2Migrations(db);
    const store = new V2SqliteStore(db);
    store.saveContext(createFulfillmentContext({ id: "ctx-a2", tenantId: TENANT, businessKey: "SO-A2", contextType: "field_service", status: "active", openedAt: NOW, updatedAt: NOW, metadata: {} }));
    store.saveSourceSystem(createSourceSystem({ id: "sys-a2", tenantId: TENANT, name: "授权验证音频", systemType: "file", authorityLevel: "contributing", status: "active", metadata: {} }));
    store.saveBusinessEntity(createBusinessEntity({ id: "ent-a2", tenantId: TENANT, contextId: "ctx-a2", entityType: "device", businessKey: "DV-A2", attributes: {}, createdAt: NOW, updatedAt: NOW }));
    store.saveSourceDocument(sourceDocumentFromArtifact({
      id: "doc-a2", tenantId: TENANT, sourceSystemId: "sys-a2", contextId: "ctx-a2", entityId: "ent-a2",
      artifact: ref, version: "v1", receivedAt: NOW,
    }));

    const chosen = result.segments[result.segments.length - 1]!;
    const evidence = evidenceFromTranscriptSegment({
      id: "ev-a2", tenantId: TENANT, contextId: "ctx-a2", sourceSystemId: "sys-a2",
      sourceDocumentId: "doc-a2", sourceVersion: "v1", entityId: "ent-a2",
      segment: chosen, observedAt: NOW, createdAt: NOW,
      transcriptOffsets: transcriptOffsetsFor(result.segments, chosen.index),
    });
    store.saveEvidence(evidence);
    db.close();

    const reopened = new DatabaseSync(dbPath, { readOnly: true });
    const reloaded = new V2SqliteStore(reopened).getEvidence(TENANT, "ev-a2")!;
    const doc = new V2SqliteStore(reopened).getSourceDocument(TENANT, "doc-a2")!;
    reopened.close();

    const preserved =
      reloaded.locator.startMs === chosen.startMs
      && reloaded.locator.endMs === chosen.endMs
      && typeof reloaded.locator.startMs === "number"
      && reloaded.locator.fileName === undefined
      && reloaded.quote === chosen.text
      && doc.contentHash === contentHash;

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
      artifactHashMatches: doc.contentHash === contentHash,
      speakerRef: reloaded.metadata.speakerRef ?? null,
      speakerRefIsIdentity: false,
    };

    artifact.realProviderVerified = true;
    artifact.realAudioToTemporalEvidenceVerified = preserved;

    if (!preserved) {
      artifact.verdict = "FAILED";
      artifact.blocker = "TEMPORAL_EVIDENCE_NOT_PRESERVED";
    } else if (result.segments.length === 0) {
      artifact.verdict = "PARTIAL";
      artifact.blocker = "NO_SEGMENTS";
    } else {
      artifact.verdict = "LIVE_VERIFIED";
    }
    write();
    console.log(`${artifact.verdict}  segments=${result.segments.length} latency=${latencyMs}ms`);
    console.log(`  segment[${chosen.index}] ${chosen.startMs}ms → ${chosen.endMs}ms`);
    console.log(`  temporal evidence preserved through persist+reload: ${preserved}`);
    console.log(`artifact: ${outPath}`);
    process.exitCode = artifact.verdict === "LIVE_VERIFIED" ? 0 : 1;
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

await main();
