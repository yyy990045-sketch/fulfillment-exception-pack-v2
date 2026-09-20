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
  transcribe(input: SpeechTranscriptionInput): Promise<SpeechTranscriptionResult>;
}
