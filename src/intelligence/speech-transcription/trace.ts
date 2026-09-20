/**
 * R2 — Artifact + Interval Traceability
 * R3 — Reverse Trace Verification
 *
 * A1 只证明了「locator 字段 round-trip 不丢失」。
 * 本模块进一步证明两件事：
 *
 *   R2  给定一条**持久化之后**的 Evidence，能解析出
 *       原始音频工件身份（artifactId / contentHash / mediaType）
 *       + 对应时间区间（startMs / endMs）。
 *
 *   R3  该定位信息**足以重新读取原音频的那一段**。
 *       这里做一次确定性的切片提取：按 WAV 的格式把毫秒换算成 PCM 字节区间，
 *       从真实文件里读回来，并断言非空、且落在文件范围内。
 *
 * 两条刻意的设计约束：
 *
 * 1. **工件身份从 SourceDocument 解析，不从 Evidence metadata 复制。**
 *    复制等于把「哪个材料」塞进「哪一段」里，正是 A1 要消除的问题。
 * 2. **换算不出来就报错，不猜。** 非 PCM WAV 一律 `SPEECH_AUDIO_UNREADABLE`。
 *
 * 明确不做：播放器、转码、缓存切片、写回磁盘。
 */
import { readFileSync } from "node:fs";
import type { SourceDocument, V2Evidence } from "../../domain/v2/index.js";
import { SpeechTranscriptionError } from "./types.js";
import { extractPcmFromWav } from "./providers/dashscope-realtime.js";

/** Evidence 反查出来的「工件 + 区间」。 */
export type EvidenceAudioTrace = {
  evidenceId: string;
  /** 工件身份——是语义身份，**不是**路径、不是上传时间 */
  artifact: {
    sourceDocumentId: string;
    externalDocumentId: string;
    mediaType: string;
    contentHash: string;
    version: string;
    durationMs: number | null;
  };
  interval: {
    startMs: number;
    endMs: number;
    lengthMs: number;
  };
  /** R1 的来源机制（自 Evidence metadata 读回，用于事后审计） */
  timestampProvenance: string | null;
  /** locator 是否为非空区间 */
  intervalIsNonEmpty: boolean;
  /** 若时长已知，区间是否落在 (0, duration] 内；未知时为 null，**不猜** */
  intervalWithinDuration: boolean | null;
  /** 是否用 fileName 冒充时序定位（必须为 false） */
  locatorUsesFileName: boolean;
};

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * R2：从持久化的 Evidence + 其工件（SourceDocument）反查到身份 + 区间。
 *
 * 只读入参对象自身的字段，不依赖任何进程内状态——
 * 因此它对「close 之后重新打开读回来的记录」同样成立。
 */
export function traceEvidenceToArtifactAndInterval(input: {
  evidence: V2Evidence;
  sourceDocument: SourceDocument;
}): EvidenceAudioTrace {
  const { evidence, sourceDocument } = input;
  const locator = evidence.locator ?? {};
  const startMs = locator.startMs;
  const endMs = locator.endMs;

  if (typeof startMs !== "number" || typeof endMs !== "number") {
    throw new SpeechTranscriptionError(
      "SPEECH_SEGMENT_BOUNDS_INVALID",
      422,
      `evidence ${evidence.id} has no temporal locator (startMs/endMs missing)`,
    );
  }
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    throw new SpeechTranscriptionError("SPEECH_SEGMENT_BOUNDS_INVALID", 422, `evidence ${evidence.id} has invalid interval`);
  }

  const docMeta = (sourceDocument.metadata ?? {}) as Record<string, unknown>;
  const evMeta = (evidence.metadata ?? {}) as Record<string, unknown>;
  const durationMs = numberOrNull(docMeta.durationMs);
  const mediaType = typeof docMeta.mediaType === "string"
    ? docMeta.mediaType
    : (sourceDocument.mimeType ?? "audio/unknown");

  return {
    evidenceId: evidence.id,
    artifact: {
      sourceDocumentId: sourceDocument.id,
      externalDocumentId: sourceDocument.externalDocumentId,
      mediaType,
      contentHash: sourceDocument.contentHash,
      version: sourceDocument.version,
      durationMs,
    },
    interval: { startMs, endMs, lengthMs: endMs - startMs },
    timestampProvenance: typeof evMeta.timestampProvenance === "string" ? evMeta.timestampProvenance : null,
    intervalIsNonEmpty: endMs > startMs,
    intervalWithinDuration: durationMs === null ? null : endMs <= durationMs,
    locatorUsesFileName: typeof locator.fileName === "string" && locator.fileName.trim().length > 0,
  };
}

export type AudioSlice = {
  startMs: number;
  endMs: number;
  byteStart: number;
  byteEnd: number;
  byteLength: number;
  sampleRateHz: number;
  channels: number;
  bitsPerSample: number;
  audioDurationMs: number;
  bytes: Buffer;
};

/**
 * R3：确定性地把毫秒区间换算成 PCM 字节区间，并从真实文件里读回那一段。
 *
 * 只支持未压缩 PCM WAV（本阶段测试素材即此格式）。不能确定性换算时一律报错。
 */
export function readAudioInterval(audioPath: string, startMs: number, endMs: number): AudioSlice {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs < 0 || endMs <= startMs) {
    throw new SpeechTranscriptionError("SPEECH_SEGMENT_BOUNDS_INVALID", 422, `invalid interval ${startMs}..${endMs}`);
  }
  const file = readFileSync(audioPath);
  const { pcm, sampleRateHz, channels } = extractPcmFromWav(file);
  const bitsPerSample = 16;
  const bytesPerMs = (sampleRateHz * channels * (bitsPerSample / 8)) / 1000;
  const audioDurationMs = Math.floor(pcm.length / bytesPerMs);

  if (endMs > audioDurationMs) {
    throw new SpeechTranscriptionError(
      "SPEECH_SEGMENT_EXCEEDS_DURATION",
      422,
      `interval ${startMs}..${endMs} exceeds audio duration ${audioDurationMs}ms`,
    );
  }
  const byteStart = Math.floor(startMs * bytesPerMs);
  const byteEnd = Math.min(Math.ceil(endMs * bytesPerMs), pcm.length);
  const bytes = pcm.subarray(byteStart, byteEnd);
  if (bytes.length === 0) {
    // 空切片 = 定位信息不足以重新读取该区间。必须暴露，而不是返回空 buffer。
    throw new SpeechTranscriptionError("SPEECH_AUDIO_UNREADABLE", 422, `slice ${startMs}..${endMs} produced empty bytes`);
  }
  return {
    startMs,
    endMs,
    byteStart,
    byteEnd,
    byteLength: bytes.length,
    sampleRateHz,
    channels,
    bitsPerSample,
    audioDurationMs,
    bytes: Buffer.from(bytes),
  };
}

/** `readAudioInterval` 的便捷包装：只要字节。 */
export function sliceAudioInterval(audioPath: string, startMs: number, endMs: number): Buffer {
  return readAudioInterval(audioPath, startMs, endMs).bytes;
}

/**
 * R3 汇总：Evidence →（工件 + 区间）→ 真实读回该区间。
 *
 * 返回的 `sliceNonEmpty` / `intervalWithinDuration` / `artifactResolved` 三项，
 * 就是"定位信息足够重新读取该区间"的可判定证据。
 */
export function reverseTraceEvidenceToAudio(input: {
  evidence: V2Evidence;
  sourceDocument: SourceDocument;
  audioPath: string;
}) {
  const trace = traceEvidenceToArtifactAndInterval({ evidence: input.evidence, sourceDocument: input.sourceDocument });
  const slice = readAudioInterval(input.audioPath, trace.interval.startMs, trace.interval.endMs);
  return {
    trace,
    slice: {
      byteStart: slice.byteStart,
      byteEnd: slice.byteEnd,
      byteLength: slice.byteLength,
      sampleRateHz: slice.sampleRateHz,
      channels: slice.channels,
      audioDurationMs: slice.audioDurationMs,
      sliceNonEmpty: slice.byteLength > 0,
      intervalWithinDuration: trace.intervalWithinDuration,
      artifactResolved: trace.artifact.contentHash.length > 0 && trace.artifact.externalDocumentId.length > 0,
    },
  };
}
