/**
 * Transcript segment → Temporal Evidence 的桥接。
 *
 * 这是本阶段的落点：真实 provider 产出的片段，经过既有 `createEvidence`
 * 变成**带时间定位**的 Evidence，并落进既有的 `v2_evidence`。
 *
 * 三条必须守住的边界：
 *
 * 1. **工件身份与位置分离**
 *    `SourceDocument`（externalDocumentId / contentHash / mimeType / version）
 *    回答"哪一份原始音频"；`EvidenceLocator` 回答"其中的哪一段"。
 *    位置信息**绝不**被编码进 fileName、evidence id、quote 或 metadata。
 *
 * 2. **时间是相对偏移，不是 wall-clock**
 *    `startMs` / `endMs` 是相对音频起点的偏移。
 *    绝不用 provider 响应时间、当前时间或任何 projectedAt 冒充录音发生时间。
 *    若录音自身的发生时间未知，就保持未知（不进 metadata，不编造）。
 *
 * 3. **不知道就说不知道**
 *    `speakerRef` 只在 provider 真实给出时保留，且它只是 diarization label，
 *    不是 authenticated human identity；未知时保持 null。
 */
import {
  createEvidence,
  createSourceDocument,
  type SourceDocument,
  type V2Evidence,
} from "../../domain/v2/index.js";
import type { AudioArtifactRef, TranscriptSegment } from "./types.js";

/** 音频工件 → `SourceDocument`（语义身份；contentHash 是身份真相）。 */
export function sourceDocumentFromArtifact(input: {
  id: string;
  tenantId: string;
  sourceSystemId: string;
  contextId: string;
  entityId?: string;
  artifact: AudioArtifactRef;
  version: string;
  receivedAt: string;
}): SourceDocument {
  return createSourceDocument({
    id: input.id,
    tenantId: input.tenantId,
    sourceSystemId: input.sourceSystemId,
    contextId: input.contextId,
    ...(input.entityId ? { entityId: input.entityId } : {}),
    externalDocumentId: input.artifact.artifactId,
    documentType: "audio_recording",
    contentHash: input.artifact.contentHash,
    receivedAt: input.receivedAt,
    effectiveAt: null,
    version: input.version,
    // 工件自身的媒体类型/大小属于"哪个材料"，不属于"哪一段"
    metadata: {
      mediaType: input.artifact.mediaType,
      ...(input.artifact.byteSize !== undefined ? { byteSize: input.artifact.byteSize } : {}),
      ...(input.artifact.sampleRateHz !== undefined ? { sampleRateHz: input.artifact.sampleRateHz } : {}),
      ...(input.artifact.channels !== undefined ? { channels: input.artifact.channels } : {}),
    },
  });
}

/** 片段 → locator 的时序部分。只产出偏移，不产出任何字符串化时间。 */
export function temporalLocatorFromSegment(segment: TranscriptSegment): { startMs: number; endMs: number } {
  return { startMs: segment.startMs, endMs: segment.endMs };
}

/**
 * 把一段真实转写片段落成一条 Temporal Evidence。
 *
 * `locator` 里**只有**时间偏移（以及可选的转写字符偏移），没有 fileName。
 * 这是 A1 打开的能力被真正用起来的地方。
 */
export function evidenceFromTranscriptSegment(input: {
  id: string;
  tenantId: string;
  contextId: string;
  sourceSystemId: string;
  sourceDocumentId: string;
  sourceVersion: string;
  entityId?: string;
  eventId?: string;
  segment: TranscriptSegment;
  /** 观察发生的时间（摄取/转写时刻）。**不是**录音发生时间。 */
  observedAt: string;
  createdAt: string;
  /** 转写文本内的字符偏移（可选；对应 Core TextSpanLocator 语义）。 */
  transcriptOffsets?: { startOffset: number; endOffset: number };
  confidence?: number;
  support?: V2Evidence["support"];
  field?: string;
  /** 仅当**确实知道**录音发生时间时才传；不知道就不要传。 */
  recordingOccurredAt?: string;
}): V2Evidence {
  const speakerRef = input.segment.speakerRef ?? null;
  return createEvidence({
    id: input.id,
    tenantId: input.tenantId,
    contextId: input.contextId,
    sourceSystemId: input.sourceSystemId,
    sourceDocumentId: input.sourceDocumentId,
    sourceVersion: input.sourceVersion,
    ...(input.entityId ? { entityId: input.entityId } : {}),
    ...(input.eventId ? { eventId: input.eventId } : {}),
    field: input.field ?? "utterance",
    value: input.segment.text,
    valueType: "string",
    locator: {
      startMs: input.segment.startMs,
      endMs: input.segment.endMs,
      ...(input.transcriptOffsets
        ? { startOffset: input.transcriptOffsets.startOffset, endOffset: input.transcriptOffsets.endOffset }
        : {}),
    },
    quote: input.segment.text,
    confidence: input.confidence ?? 0.9,
    support: input.support ?? "supported",
    observedAt: input.observedAt,
    createdAt: input.createdAt,
    metadata: {
      transcriptSegmentIndex: input.segment.index,
      // diarization label ≠ 身份；未知就记 null，绝不猜
      speakerRef,
      speakerRefIsIdentity: false,
      // 时间语义显式标注：偏移是相对工件起点，不是 wall-clock
      timeBase: "offset_from_artifact_start",
      ...(input.recordingOccurredAt ? { recordingOccurredAt: input.recordingOccurredAt } : {}),
    },
  });
}

/** 转写文本拼接后，某一段在全文中的字符区间（用于 transcript span）。 */
export function transcriptOffsetsFor(segments: readonly TranscriptSegment[], index: number): { startOffset: number; endOffset: number } {
  let offset = 0;
  for (const segment of segments) {
    if (segment.index === index) return { startOffset: offset, endOffset: offset + segment.text.length };
    offset += segment.text.length;
  }
  throw new Error(`segment index ${index} not found`);
}
