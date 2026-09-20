/**
 * DashScope `paraformer-realtime-v2` provider（真实外部 ASR）。
 *
 * 这是**具体能力绑定（concrete binding）**：真实调用只发生在这一层。
 * 它实现 `speech_transcription` 接口；上层只看到规范化后的
 * `TranscriptSegment[]`，看不到 DashScope 的协议、模型名或字段名。
 *
 * 协议（本文件实现并已实测）：DashScope 实时语音识别 WebSocket
 *
 * ```text
 * wss://dashscope.aliyuncs.com/api-ws/v1/inference
 *   → run-task   { task_group:"audio", task:"asr", function:"recognition", model:"paraformer-realtime-v2" }
 *   → <binary PCM frames>
 *   → finish-task
 *   ← result-generated { payload.output.sentence: { sentence_id, begin_time, end_time, text, sentence_end, speaker_id } }
 * ```
 *
 * `begin_time` / `end_time` 单位是毫秒，且**相对于音频起点**——
 * 它不是 wall-clock `occurredAt`，本 adapter 不做任何时间基准换算。
 *
 * 可测试性：WebSocket 构造器可注入，测试用假实现驱动同一套协议解析。
 */
import { readFileSync } from "node:fs";
import {
  SPEECH_TRANSCRIPTION_INTERFACE_KEY,
  SpeechTranscriptionError,
  type AudioArtifactRef,
  type SpeechAudioInputHandle,
  type SpeechTranscriptionInput,
  type SpeechTranscriptionProvider,
  type SpeechTranscriptionResult,
} from "../types.js";
import { joinSegmentText, normalizeTranscriptSegments, type RawTranscriptSegment } from "../normalize.js";

export const DASHSCOPE_REALTIME_URL = "wss://dashscope.aliyuncs.com/api-ws/v1/inference";
export const DASHSCOPE_REALTIME_MODEL = "paraformer-realtime-v2";

/** 最小 WebSocket 面（便于注入假实现）。 */
export type MinimalWebSocket = {
  send(data: string | Uint8Array): void;
  close(): void;
  addEventListener(type: string, listener: (event: { data?: unknown }) => void): void;
};

export type WebSocketFactory = (url: string, options: { headers: Record<string, string> }) => MinimalWebSocket;

export type DashScopeRealtimeConfig = {
  apiKey: string;
  model?: string;
  url?: string;
  webSocketFactory?: WebSocketFactory;
  /** 单帧字节数（默认 3200 = 16k/mono/16bit 的 100ms）。 */
  chunkBytes?: number;
  /** 帧间隔毫秒（默认 20）。 */
  chunkIntervalMs?: number;
};

/** 解析 WAV，取出 PCM 数据段（不假设固定 44 字节头）。 */
export function extractPcmFromWav(buffer: Buffer): { pcm: Buffer; sampleRateHz: number; channels: number } {
  if (buffer.length < 12 || buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw new SpeechTranscriptionError("SPEECH_AUDIO_UNREADABLE", 422, "not a RIFF/WAVE file");
  }
  let offset = 12;
  let sampleRateHz = 16000;
  let channels = 1;
  let bitsPerSample = 16;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === "fmt ") {
      channels = buffer.readUInt16LE(body + 2);
      sampleRateHz = buffer.readUInt32LE(body + 4);
      bitsPerSample = buffer.readUInt16LE(body + 14);
    }
    if (id === "data") return { pcm: buffer.subarray(body, body + size), sampleRateHz, channels };
    offset = body + size + (size % 2);
  }
  throw new SpeechTranscriptionError("SPEECH_AUDIO_UNREADABLE", 422, "WAVE has no data chunk");
}

function loadPcm(handle: SpeechAudioInputHandle): { pcm: Uint8Array; sampleRateHz: number; channels: number } {
  if (handle.kind === "pcm-frames") return { pcm: handle.frames, sampleRateHz: handle.sampleRateHz, channels: handle.channels };
  if (handle.kind === "wav-file") {
    const parsed = extractPcmFromWav(readFileSync(handle.path));
    return { pcm: parsed.pcm, sampleRateHz: parsed.sampleRateHz, channels: parsed.channels };
  }
  if (handle.kind === "pcm-file") {
    return { pcm: readFileSync(handle.path), sampleRateHz: handle.sampleRateHz, channels: handle.channels };
  }
  throw new SpeechTranscriptionError(
    "SPEECH_AUDIO_UNREADABLE",
    422,
    "provider-url handles are not supported by the realtime adapter",
  );
}

export class DashScopeRealtimeSpeechTranscriptionProvider implements SpeechTranscriptionProvider {
  readonly name = "dashscope";
  readonly capabilityId: string;
  readonly model: string;
  readonly supportsTimestamps = true;
  readonly isRealProvider = true;
  /**
   * R1：`paraformer-realtime-v2` 返回的是**声学对齐**产生的句级/逐词时间
   * （`result-generated` 事件的 `sentence.begin_time/end_time` 与 `words[].begin_time/end_time`），
   * 不是模型自由生成的时间线。实测依据见 docs/competition/runtime/speech-transcription-verification.json。
   */
  readonly timestampProvenance = "provider_acoustic_alignment" as const;

  constructor(private readonly config: DashScopeRealtimeConfig) {
    if (!config.apiKey?.trim()) throw new SpeechTranscriptionError("SPEECH_PROVIDER_NOT_CONFIGURED", 503, "DASHSCOPE_API_KEY missing");
    this.model = config.model ?? DASHSCOPE_REALTIME_MODEL;
    this.capabilityId = `dashscope-paraformer-realtime@v1`;
  }

  async transcribe(input: SpeechTranscriptionInput): Promise<SpeechTranscriptionResult> {
    const startedAt = Date.now();
    const { pcm, sampleRateHz, channels } = loadPcm(input.audio);
    if (pcm.length === 0) throw new SpeechTranscriptionError("SPEECH_AUDIO_UNREADABLE", 422, "empty audio");

    const factory = this.config.webSocketFactory ?? defaultWebSocketFactory;
    const url = this.config.url ?? DASHSCOPE_REALTIME_URL;
    const taskId = globalThis.crypto.randomUUID();
    const finalized = new Map<number, RawTranscriptSegment>();
    const chunkBytes = this.config.chunkBytes ?? 3200;
    const intervalMs = this.config.chunkIntervalMs ?? 20;
    const timeoutMs = input.timeoutMs ?? 60_000;

    await new Promise<void>((resolvePromise, rejectPromise) => {
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearInterval(pump);
        clearTimeout(guard);
        try { ws.close(); } catch { /* closing a dead socket is not an error */ }
        if (error) rejectPromise(error);
        else resolvePromise();
      };

      let ws: MinimalWebSocket;
      try {
        ws = factory(url, { headers: { Authorization: `bearer ${this.config.apiKey}`, "X-DashScope-DataInspection": "enable" } });
      } catch (error) {
        rejectPromise(new SpeechTranscriptionError("SPEECH_PROVIDER_UNAVAILABLE", 503, error instanceof Error ? error.message : "connect failed"));
        return;
      }

      let pump: NodeJS.Timeout = setInterval(() => {}, 1_000_000);
      clearInterval(pump);
      const guard = setTimeout(() => finish(new SpeechTranscriptionError("SPEECH_PROVIDER_TIMEOUT", 504, `${timeoutMs}ms`)), timeoutMs);

      ws.addEventListener("error", () => finish(new SpeechTranscriptionError("SPEECH_PROVIDER_UNAVAILABLE", 503, "websocket error")));
      ws.addEventListener("message", (event) => {
        if (typeof event.data !== "string") return;
        let message: {
          header?: { event?: string; error_code?: string; error_message?: string };
          payload?: { output?: { sentence?: { sentence_id?: number; begin_time?: number; end_time?: number; text?: string; sentence_end?: boolean; speaker_id?: string | null } } };
        };
        try { message = JSON.parse(event.data); } catch { return; }
        const name = message.header?.event;
        if (name === "task-started") {
          let offset = 0;
          pump = setInterval(() => {
            if (offset >= pcm.length) {
              clearInterval(pump);
              ws.send(JSON.stringify({ header: { action: "finish-task", task_id: taskId }, payload: { input: {} } }));
              return;
            }
            ws.send(pcm.subarray(offset, offset + chunkBytes));
            offset += chunkBytes;
          }, intervalMs);
          return;
        }
        if (name === "result-generated") {
          const sentence = message.payload?.output?.sentence;
          // 只收**已定稿**的句子：流式中间结果会被后续结果替换，收进来会重复计数
          if (sentence && sentence.sentence_end === true && typeof sentence.sentence_id === "number") {
            finalized.set(sentence.sentence_id, {
              text: sentence.text,
              startMs: sentence.begin_time,
              endMs: sentence.end_time,
              // speaker_id 为 null 时必须保持 null：diarization label ≠ 身份，未知就未知
              speakerRef: sentence.speaker_id ?? null,
            });
          }
          return;
        }
        if (name === "task-finished") { finish(); return; }
        if (name === "task-failed") {
          const code = message.header?.error_code ?? "";
          const mapped = /AUTH|Unauthorized|InvalidApiKey/i.test(code) ? "SPEECH_PROVIDER_AUTH_FAILED" : "SPEECH_PROVIDER_PROTOCOL_ERROR";
          finish(new SpeechTranscriptionError(mapped as never, 502, `${code} ${message.header?.error_message ?? ""}`.trim()));
        }
      });

      ws.addEventListener("open", () => {
        ws.send(JSON.stringify({
          header: { action: "run-task", task_id: taskId, streaming: "duplex" },
          payload: {
            task_group: "audio",
            task: "asr",
            function: "recognition",
            model: this.model,
            parameters: {
              format: "pcm",
              sample_rate: sampleRateHz,
              ...(channels > 1 ? { channel: channels } : {}),
              ...(input.languageHints?.length ? { language_hints: input.languageHints } : {}),
              // 400ms 静音即切句：让 provider 真正产出**多段**带时间片的片段，
              // 而不是把整段音频压成一条 [0, duration]。
              max_sentence_silence: 400,
            },
            input: {},
          },
        }));
      });
    });

    const ordered = [...finalized.entries()].sort((a, b) => a[0] - b[0]).map(([, value]) => value);
    // R2：若工件声明了总时长，则用它校验区间不越界（拿不到时长时不猜）
    const segments = normalizeTranscriptSegments(ordered, input.artifact.durationMs);
    return {
      interfaceKey: SPEECH_TRANSCRIPTION_INTERFACE_KEY,
      capabilityId: this.capabilityId,
      provider: this.name,
      model: this.model,
      supportsTimestamps: this.supportsTimestamps,
      timestampProvenance: this.timestampProvenance,
      segments,
      text: joinSegmentText(segments),
      latencyMs: Date.now() - startedAt,
    };
  }
}

function defaultWebSocketFactory(url: string, options: { headers: Record<string, string> }): MinimalWebSocket {
  const Ctor = (globalThis as { WebSocket?: new (u: string, o?: unknown) => MinimalWebSocket }).WebSocket;
  if (!Ctor) throw new SpeechTranscriptionError("SPEECH_PROVIDER_UNAVAILABLE", 503, "global WebSocket unavailable (Node >= 22 required)");
  return new Ctor(url, { headers: options.headers });
}

/** 便于调用方标注工件身份；不读文件、不产生副作用。 */
export function audioArtifactRef(input: AudioArtifactRef): AudioArtifactRef {
  return { ...input };
}
