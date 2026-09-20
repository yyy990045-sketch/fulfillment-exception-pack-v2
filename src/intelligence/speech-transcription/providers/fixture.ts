/**
 * Fixture speech transcription provider.
 *
 * 用途：在**不联网**的情况下验证 provider-neutral 契约（规范化、不变量、Evidence 映射）。
 *
 * 明确标记：本 provider 不调用任何真实 ASR，其输出是本地构造的样本。
 * 任何由它产生的结论都只能是 `SIMULATED_FIXTURE`，
 * **不得**用于声称 SPEECH_TRANSCRIPTION_LIVE_VERIFIED。
 */
import {
  SPEECH_TRANSCRIPTION_INTERFACE_KEY,
  assertKnownTimestampProvenance,
  type AllowedTimestampProvenance,
  type SpeechTranscriptionInput,
  type SpeechTranscriptionProvider,
  type SpeechTranscriptionResult,
  type TimestampProvenance,
} from "../types.js";
import { joinSegmentText, normalizeTranscriptSegments, type RawTranscriptSegment } from "../normalize.js";

export type FixtureSegment = {
  text: string;
  startMs: number;
  endMs: number;
  speakerRef?: string | null;
};

export type FixtureTranscript = {
  model?: string;
  supportsTimestamps?: boolean;
  /**
   * R1：fixture 的时间戳是**人工构造**的，因此默认来源是 `manual_authoring`——
   * 属于禁止集合。也就是说：**默认情况下 fixture 不能产出 Temporal Evidence**。
   * 只有当调用方显式改成本白名单内的来源（且确实有对应机制）时才放行。
   */
  timestampProvenance?: TimestampProvenance;
  segments: FixtureSegment[];
};

export class FixtureSpeechTranscriptionProvider implements SpeechTranscriptionProvider {
  readonly name = "fixture";
  readonly capabilityId = "local-fixture-speech-transcription@v1";
  readonly model: string;
  readonly supportsTimestamps: boolean;
  readonly timestampProvenance: TimestampProvenance;
  /** 显式标记：这不是真实 ASR。 */
  readonly isRealProvider = false;

  constructor(private readonly transcript: FixtureTranscript) {
    this.model = transcript.model ?? "fixture-transcript-v1";
    this.supportsTimestamps = transcript.supportsTimestamps ?? true;
    // 默认 manual_authoring：如实描述"这是人工构造的时间戳"。
    // 构造本身合法，但它**不能**产出 Temporal Evidence（门禁在 evidence 边界）。
    this.timestampProvenance = transcript.timestampProvenance ?? "manual_authoring";
    assertKnownTimestampProvenance(this.timestampProvenance);
  }

  async transcribe(input: SpeechTranscriptionInput): Promise<SpeechTranscriptionResult> {
    const startedAt = Date.now();
    const raw: RawTranscriptSegment[] = this.transcript.segments.map((segment) => ({
      text: segment.text,
      startMs: segment.startMs,
      endMs: segment.endMs,
      speakerRef: segment.speakerRef ?? null,
    }));
    const segments = normalizeTranscriptSegments(raw);
    return {
      interfaceKey: SPEECH_TRANSCRIPTION_INTERFACE_KEY,
      capabilityId: this.capabilityId,
      provider: this.name,
      model: this.model,
      supportsTimestamps: this.supportsTimestamps,
      timestampProvenance: this.timestampProvenance as never,
      segments,
      text: joinSegmentText(segments),
      latencyMs: Date.now() - startedAt,
      // artifact 只用于校验它是语义身份而不是路径；fixture 不读文件
      ...(input.artifact.contentHash ? {} : {}),
    };
  }
}

/**
 * 一个**无时间片**的 fixture provider，用于固定
 * "缺时间片的文本转写不能变成 Temporal Evidence" 这条边界。
 */
export class FixtureTextOnlyProvider implements SpeechTranscriptionProvider {
  readonly name = "fixture-text-only";
  readonly capabilityId = "local-fixture-text-only-asr@v1";
  readonly model = "fixture-text-only-v1";
  readonly supportsTimestamps = false;
  readonly timestampProvenance = "llm_generated" as const;
  readonly isRealProvider = false;

  constructor(private readonly text: string) {}

  async transcribe(_input?: SpeechTranscriptionInput): Promise<SpeechTranscriptionResult> {
    // 无时间片 provider 的真实形态：只有全文，没有偏移。
    // 这里显式抛错而不是伪造 [0, duration]——伪造时间是最严重的语义造假。
    throw Object.assign(new Error("SPEECH_SEGMENT_BOUNDS_INVALID:text-only provider cannot produce timestamped segments"), {
      code: "SPEECH_SEGMENT_BOUNDS_INVALID",
    });
  }

  /** 无时间片时唯一诚实的产物：纯文本，标注为对时序证据 PARTIAL。 */
  textOnly(): { text: string; supportsTimestamps: false; temporalEvidenceEligibility: "PARTIAL_FOR_TEMPORAL_EVIDENCE" } {
    return { text: this.text, supportsTimestamps: false, temporalEvidenceEligibility: "PARTIAL_FOR_TEMPORAL_EVIDENCE" };
  }
}
