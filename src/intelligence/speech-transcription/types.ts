/**
 * Speech Transcription — provider-neutral capability interface.
 *
 * 位置：Capability 层。**不是 Semantic Core**，也不属于任何 Domain / Competition Pack。
 *
 * 方向与平台既有 capability 契约一致（语义对齐，不跨仓库 import 源码）：
 *
 * ```text
 * 业务需求 requirementKey
 *   ↓ 需求自己声明需要什么接口
 * 接口 interfaceKey = "speech_transcription"
 *   ↓ 能力声明它实现什么接口
 * 当前激活的具体 provider（concrete binding）
 * ```
 *
 * 三个刻意的不变式：
 *
 * 1. **Core 不知道 ASR**。这里不引入任何新的语义对象；Evidence 仍然只由
 *    `EvidenceLocator` 的位置信息表达。转写结果最终通过既有 `createEvidence` 落库。
 * 2. **Domain Pack 不知道 provider**。Pack 只能声明"我需要 speech_transcription 接口"，
 *    不允许出现 `provider = xxx` / `apiKey = xxx` / `endpoint = xxx`。
 * 3. **工件身份与运行时句柄分离**。`AudioArtifactRef` 是长期稳定的语义身份
 *    （contentHash + mediaType）；`SpeechAudioInputHandle` 是一次性的运行时输入
 *    （本地路径 / PCM 帧 / provider 侧 URL）。**绝不允许**把
 *    `/Users/.../recording.wav` 当成长期 Evidence identity。
 */

/** 不透明接口键：需求与实现之间唯一的接触面。 */
export const SPEECH_TRANSCRIPTION_INTERFACE_KEY = "speech_transcription" as const;
export type SpeechTranscriptionInterfaceKey = typeof SPEECH_TRANSCRIPTION_INTERFACE_KEY;

/**
 * 音频工件的**语义身份**。
 *
 * `contentHash` 是身份真相：同一份音频重复运行必须得到同一个 hash，
 * 不得依赖临时路径、上传时间或当前机器目录。
 */
export type AudioArtifactRef = {
  /** 稳定的工件标识（例如 `recording-20260920-1015`）。 */
  artifactId: string;
  /** 媒体类型，例如 `audio/wav`。 */
  mediaType: string;
  /** 内容哈希（hex 或 `<algo>:<hex>`）。身份真相。 */
  contentHash: string;
  /** 字节数（可选）。 */
  byteSize?: number;
  /** 采样率 / 声道等，可选，仅描述用途。 */
  sampleRateHz?: number;
  channels?: number;
  /**
   * 音频总时长（毫秒），可选。
   *
   * 它是音频内容的稳定属性（同一份字节算出的值相同），因此属于语义身份；
   * runtime 若能可靠取得就填上，R2/R3 的"区间不超出时长"校验依赖它。
   */
  durationMs?: number;
};

/**
 * 一次性的**运行时**音频输入句柄。
 *
 * 与 `AudioArtifactRef` 严格分离：这里的东西会过期、会失效、只在本机/本次调用有意义。
 * 它**不得**被写进 Evidence、不得当作 identity。
 */
export type SpeechAudioInputHandle =
  | { kind: "pcm-file"; path: string; format: "pcm"; sampleRateHz: number; channels: number }
  | { kind: "wav-file"; path: string }
  | { kind: "pcm-frames"; frames: Uint8Array; sampleRateHz: number; channels: number }
  | { kind: "provider-url"; url: string };

export type SpeechTranscriptionInput = {
  /** 语义身份：必须是稳定身份，不是路径。 */
  artifact: AudioArtifactRef;
  /** 运行时句柄：本次调用真正读取的东西。 */
  audio: SpeechAudioInputHandle;
  /** 可选语言提示，例如 `["zh"]`。只是提示，不是事实。 */
  languageHints?: string[];
  /** 可选超时。 */
  timeoutMs?: number;
};

/**
 * 一段转写片段（provider-neutral）。
 *
 * `startMs` / `endMs` 是**相对于音频工件起点的偏移**，
 * 不是 wall-clock `occurredAt`，也不是 provider 响应时间、不是 current time。
 */
export type TranscriptSegment = {
  /** 片段在本次转写中的顺序（0 起）。 */
  index: number;
  text: string;
  startMs: number;
  endMs: number;
  /**
   * provider 自带的说话人标签（如有）。
   *
   * **这不是身份**：`diarization label ≠ authenticated human identity`。
   * 缺失时必须保持 `null`——严禁用 LLM 或文本内容猜说话人，
   * 也严禁在未知时写 `speaker-1` 冒充事实身份。
   */
  speakerRef: string | null;
};

/**
 * 时间戳来源机制（R1 — Timestamp Provenance）。
 *
 * 任何进入 Temporal Evidence 的 `startMs` / `endMs` **必须**能说明它来自哪一种
 * **可验证的音频处理机制**。这份白名单就是那个可检查的边界。
 */
export const ALLOWED_TIMESTAMP_PROVENANCE = [
  /** provider 侧的真实声学对齐输出 */
  "provider_acoustic_alignment",
  /** 强制对齐（forced alignment） */
  "forced_alignment",
  /** 确定性的音频对齐处理 */
  "deterministic_audio_alignment",
] as const;
export type AllowedTimestampProvenance = (typeof ALLOWED_TIMESTAMP_PROVENANCE)[number];

/**
 * 明确**禁止**的时间戳来源。
 *
 * 把这七种写进代码（而不是只写在注释里），是为了让"拒绝"成为**可执行、可测试**的规则：
 * 一旦某个 provider 声明了其中之一，它就不能产出 Temporal Evidence。
 */
export const FORBIDDEN_TIMESTAMP_PROVENANCE = [
  "llm_generated",
  "prompt_output",
  "wall_clock",
  "projected_at",
  "manual_authoring",
  "estimated_from_text_length",
  "offset_inferred_from_characters",
] as const;
export type ForbiddenTimestampProvenance = (typeof FORBIDDEN_TIMESTAMP_PROVENANCE)[number];

export type TimestampProvenance = AllowedTimestampProvenance | ForbiddenTimestampProvenance;

export function isAllowedTimestampProvenance(value: string): value is AllowedTimestampProvenance {
  return (ALLOWED_TIMESTAMP_PROVENANCE as readonly string[]).includes(value);
}

export function isForbiddenTimestampProvenance(value: string): value is ForbiddenTimestampProvenance {
  return (FORBIDDEN_TIMESTAMP_PROVENANCE as readonly string[]).includes(value);
}

/**
 * 校验来源声明是**已知**的（白名单或黑名单皆可）。
 *
 * 用途：provider **构造**时自证"我是一个什么来源的能力"。
 * 一个 fixture 声明自己是 `manual_authoring` 是**如实描述**，不是违规——
 * 违规发生在"用它产出 Temporal Evidence"的那一刻。所以这里只挡未知值（防拼写错误），
 * 不挡禁止值。
 */
export function assertKnownTimestampProvenance(value: unknown): asserts value is TimestampProvenance {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new SpeechTranscriptionError("SPEECH_TIMESTAMP_PROVENANCE_UNDECLARED", 502, "provider must declare timestamp provenance");
  }
  if (!isAllowedTimestampProvenance(value) && !isForbiddenTimestampProvenance(value)) {
    throw new SpeechTranscriptionError("SPEECH_TIMESTAMP_PROVENANCE_UNDECLARED", 502, `unknown timestamp provenance "${value}"`);
  }
}

/**
 * 校验来源声明**可被采纳**：未声明、不认识、或属于禁止集合，一律 fail closed。
 *
 * 注意"不认识"也必须拒绝——否则新增一个来路不明的机制字符串就能绕过白名单。
 * 这是 Evidence 边界的门禁（`evidenceFromTranscriptSegment` 调用它）。
 */
export function assertTimestampProvenance(value: unknown): asserts value is AllowedTimestampProvenance {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new SpeechTranscriptionError("SPEECH_TIMESTAMP_PROVENANCE_UNDECLARED", 502, "provider must declare timestamp provenance");
  }
  if (isForbiddenTimestampProvenance(value)) {
    throw new SpeechTranscriptionError("SPEECH_TIMESTAMP_PROVENANCE_FORBIDDEN", 502, `timestamp provenance "${value}" is not admissible for Temporal Evidence`);
  }
  if (!isAllowedTimestampProvenance(value)) {
    throw new SpeechTranscriptionError("SPEECH_TIMESTAMP_PROVENANCE_UNDECLARED", 502, `unknown timestamp provenance "${value}"`);
  }
}

export type SpeechTranscriptionResult = {
  /** 接口键，恒等于 `speech_transcription`。 */
  interfaceKey: SpeechTranscriptionInterfaceKey;
  /** 实现该接口的具体能力身份（含版本，例如 `dashscope-paraformer-realtime@v1`）。 */
  capabilityId: string;
  /** provider 名（人类可读）。 */
  provider: string;
  /** provider 侧模型名。 */
  model: string;
  /** provider 是否提供可靠的时间片。false 表示本能力对时序证据只是 PARTIAL。 */
  supportsTimestamps: boolean;
  /** R1：时间戳来自哪一种可验证的音频处理机制（恒为白名单成员）。 */
  timestampProvenance: AllowedTimestampProvenance;
  /** 规范化后的片段；**保证**已通过 `assertTranscriptSegment`。 */
  segments: TranscriptSegment[];
  /** 拼接文本（便于阅读，不作为定位依据）。 */
  text: string;
  /** 本次运行耗时（毫秒）。 */
  latencyMs: number;
};

export type SpeechTranscriptionErrorCode =
  | "SPEECH_PROVIDER_NOT_CONFIGURED"
  | "SPEECH_PROVIDER_UNAVAILABLE"
  | "SPEECH_PROVIDER_AUTH_FAILED"
  | "SPEECH_AUDIO_UNREADABLE"
  | "SPEECH_TRANSCRIPT_EMPTY"
  | "SPEECH_SEGMENT_TEXT_EMPTY"
  | "SPEECH_SEGMENT_BOUNDS_INVALID"
  | "SPEECH_SEGMENT_EXCEEDS_DURATION"
  | "SPEECH_TIMESTAMP_PROVENANCE_UNDECLARED"
  | "SPEECH_TIMESTAMP_PROVENANCE_FORBIDDEN"
  | "SPEECH_PROVIDER_TIMEOUT"
  | "SPEECH_PROVIDER_PROTOCOL_ERROR";

export class SpeechTranscriptionError extends Error {
  readonly code: SpeechTranscriptionErrorCode;
  readonly status: number;

  constructor(code: SpeechTranscriptionErrorCode, status = 503, detail?: string) {
    super(detail ? `${code}:${detail}` : code);
    this.name = "SpeechTranscriptionError";
    this.code = code;
    this.status = status;
  }
}

/**
 * 具体能力必须实现的东西。
 *
 * 它是**执行体**（与平台 `CapabilityDefinition` 那种纯数据定义不同）：
 * 真实调用发生在这一层，且只在这一层。
 */
export interface SpeechTranscriptionProvider {
  /** provider 名。 */
  readonly name: string;
  /** 具体能力身份（含版本）。 */
  readonly capabilityId: string;
  readonly model: string;
  /** 该 provider 是否提供可靠时间片。 */
  readonly supportsTimestamps: boolean;
  /** R1：该 provider 的时间戳来源。构造时即校验，禁止值无法成为 provider。 */
  readonly timestampProvenance: TimestampProvenance;
  transcribe(input: SpeechTranscriptionInput): Promise<SpeechTranscriptionResult>;
}

