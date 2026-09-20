/**
 * 转写片段的规范化与不变量校验。
 *
 * 原则：**fail closed，不静默修复**。
 *
 * provider 返回非法片段（空文本、缺时间、时间倒置、非有限数、字符串时间戳）时，
 * 一律抛错，而不是"顺手改成合法值"。原因很直接：被悄悄修正过的时间片已经无法回答
 * 「这条结论依据了哪一段原始材料」，而可复核正是 Evidence 存在的理由。
 *
 * 另一条边界：**provider 不提供时间片时，不得伪造时间**。
 * 那种 provider 只能标 `supportsTimestamps = false`，
 * 它对时序证据的状态是 `PARTIAL_FOR_TEMPORAL_EVIDENCE`，不是"也能用"。
 */
import {
  SpeechTranscriptionError,
  type TranscriptSegment,
} from "./types.js";

/** provider 原始输出里的一条片段（字段名各异，由各 provider adapter 归一到这里）。 */
export type RawTranscriptSegment = {
  text: unknown;
  startMs: unknown;
  endMs: unknown;
  speakerRef?: unknown;
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** 单段校验：任何一条不满足即抛错，不做修补。 */
export function assertTranscriptSegment(segment: TranscriptSegment): void {
  if (typeof segment.text !== "string" || segment.text.trim().length === 0) {
    throw new SpeechTranscriptionError("SPEECH_SEGMENT_TEXT_EMPTY", 502, `segment ${segment.index}`);
  }
  if (!isFiniteNumber(segment.startMs) || !isFiniteNumber(segment.endMs)) {
    throw new SpeechTranscriptionError(
      "SPEECH_SEGMENT_BOUNDS_INVALID",
      502,
      `segment ${segment.index}: bounds must be finite numbers (got ${typeof segment.startMs}/${typeof segment.endMs})`,
    );
  }
  if (segment.startMs < 0) {
    throw new SpeechTranscriptionError("SPEECH_SEGMENT_BOUNDS_INVALID", 502, `segment ${segment.index}: startMs < 0`);
  }
  if (segment.endMs <= segment.startMs) {
    throw new SpeechTranscriptionError(
      "SPEECH_SEGMENT_BOUNDS_INVALID",
      502,
      `segment ${segment.index}: endMs (${segment.endMs}) must be greater than startMs (${segment.startMs})`,
    );
  }
}

/**
 * 把 provider 原始片段规范化为 `TranscriptSegment[]`。
 *
 * - 保持 provider 给出的顺序，`index` 由本函数按顺序赋值
 * - 每条都过 `assertTranscriptSegment`
 * - `speakerRef` 只在 provider 真实给出非空字符串时保留，否则为 `null`（绝不猜）
 * - 全部结果为空 → `SPEECH_TRANSCRIPT_EMPTY`
 */
export function normalizeTranscriptSegments(raw: readonly RawTranscriptSegment[]): TranscriptSegment[] {
  const segments: TranscriptSegment[] = raw.map((item, index) => ({
    index,
    text: typeof item.text === "string" ? item.text : "",
    startMs: item.startMs as number,
    endMs: item.endMs as number,
    speakerRef: typeof item.speakerRef === "string" && item.speakerRef.trim().length > 0 ? item.speakerRef : null,
  }));
  if (segments.length === 0) throw new SpeechTranscriptionError("SPEECH_TRANSCRIPT_EMPTY", 502);
  for (const segment of segments) assertTranscriptSegment(segment);
  return segments;
}

/** 片段文本拼接（仅用于阅读，不作为定位依据）。 */
export function joinSegmentText(segments: readonly TranscriptSegment[]): string {
  return segments.map((segment) => segment.text).join("");
}

/**
 * 时间片是否足以支撑**时序证据**。
 *
 * `supportsTimestamps = false` 的 provider 即便返回了文本，也只是
 * `PARTIAL_FOR_TEMPORAL_EVIDENCE`：它不能产出 Temporal Evidence。
 */
export function canProduceTemporalEvidence(result: {
  supportsTimestamps: boolean;
  segments: readonly TranscriptSegment[];
}): boolean {
  if (!result.supportsTimestamps) return false;
  if (result.segments.length === 0) return false;
  return result.segments.every(
    (segment) => isFiniteNumber(segment.startMs) && isFiniteNumber(segment.endMs) && segment.endMs > segment.startMs,
  );
}
