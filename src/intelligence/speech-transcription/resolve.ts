/**
 * Speech transcription 能力的解析（capability runtime）。
 *
 * 方向与平台既有 capability 契约一致：**需求 → 接口 → 具体能力**，反向不存在。
 *
 * fail closed，没有默认实现、没有回退链、不猜：
 *
 * ```text
 * 未配置               → SPEECH_PROVIDER_NOT_CONFIGURED
 * 认识的 provider 但缺凭据 → SPEECH_PROVIDER_NOT_CONFIGURED
 * 不认识的 provider     → SPEECH_PROVIDER_NOT_CONFIGURED
 * 缺音频运行时句柄       → SPEECH_AUDIO_UNREADABLE
 * ```
 *
 * 注意这里**没有**"试一个不行换下一个"的逻辑：一旦引入回退链，
 * provider 身份就不再是确定的，Evidence 的 provenance 也随之失真。
 */
import {
  SPEECH_TRANSCRIPTION_INTERFACE_KEY,
  SpeechTranscriptionError,
  type SpeechTranscriptionProvider,
} from "./types.js";
import {
  DashScopeRealtimeSpeechTranscriptionProvider,
  type WebSocketFactory,
} from "./providers/dashscope-realtime.js";

export type SpeechTranscriptionEnv = Record<string, string | undefined>;

/** 已声明的具体能力绑定表：provider 名 → 构造方式。 */
export type SpeechTranscriptionBinding = {
  provider: string;
  capabilityId: string;
  build: (input: { env: SpeechTranscriptionEnv; webSocketFactory?: WebSocketFactory }) => SpeechTranscriptionProvider;
};

export const SPEECH_TRANSCRIPTION_BINDINGS: readonly SpeechTranscriptionBinding[] = Object.freeze([
  Object.freeze({
    provider: "dashscope",
    capabilityId: "dashscope-paraformer-realtime@v1",
    build: ({ env, webSocketFactory }: { env: SpeechTranscriptionEnv; webSocketFactory?: WebSocketFactory }) =>
      new DashScopeRealtimeSpeechTranscriptionProvider({
        apiKey: env.DASHSCOPE_API_KEY?.trim() ?? "",
        ...(env.SPEECH_TRANSCRIPTION_DASHSCOPE_MODEL?.trim() ? { model: env.SPEECH_TRANSCRIPTION_DASHSCOPE_MODEL.trim() } : {}),
        ...(webSocketFactory ? { webSocketFactory } : {}),
      }),
  }),
]);

/**
 * 解析具体能力。
 *
 * `provider` 必须由**运行时配置/调用方**显式给出，
 * 不允许 Domain / Competition Pack 声明 `provider = xxx` 或携带 apiKey/endpoint。
 */
export function resolveSpeechTranscriptionProvider(input: {
  provider: string;
  env?: SpeechTranscriptionEnv;
  webSocketFactory?: WebSocketFactory;
}): SpeechTranscriptionProvider {
  const env = input.env ?? process.env;
  const binding = SPEECH_TRANSCRIPTION_BINDINGS.find((item) => item.provider === input.provider);
  if (!binding) {
    throw new SpeechTranscriptionError(
      "SPEECH_PROVIDER_NOT_CONFIGURED",
      503,
      `unknown provider "${input.provider}" for interface ${SPEECH_TRANSCRIPTION_INTERFACE_KEY}`,
    );
  }
  return binding.build({
    env,
    ...(input.webSocketFactory ? { webSocketFactory: input.webSocketFactory } : {}),
  });
}

/** 已声明的 capabilityId 列表，供审计与文档使用。 */
export function declaredSpeechTranscriptionCapabilities(): string[] {
  return SPEECH_TRANSCRIPTION_BINDINGS.map((binding) => binding.capabilityId);
}
