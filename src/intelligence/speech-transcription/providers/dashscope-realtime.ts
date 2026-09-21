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
/**
 * 解析 WAV 并取出 PCM 数据段。
 *
 * **只接受未压缩 PCM**（§6）。这是 `readAudioInterval` 能把毫秒确定性换算成
 * 字节偏移的前提；缺了这些条件，任何"按比例估算"的切片都会给出一个
 * 看起来非空、实际错误的 slice。
 *
 * 明确拒绝（fail closed，不估算、不猜 codec）：
 *   - 非 RIFF/WAVE 容器：MP3 / AAC / M4A / OGG / FLAC …
 *   - WAV 容器内的**压缩**格式：ADPCM(0x0002) / A-law(0x0006) / µ-law(0x0007) /
 *     MP3-in-WAV(0x0055) 等 —— 这类文件以前会被静默错误切片
 *   - WAVE_FORMAT_EXTENSIBLE(0xFFFE) 且子格式不是 PCM
 *   - 采样率 / 声道 / 位深缺失或与 blockAlign 不一致
 *   - data chunk 越界
 */
export function extractPcmFromWav(buffer: Buffer): {
  pcm: Buffer;
  sampleRateHz: number;
  channels: number;
  bitsPerSample: number;
  bytesPerSecond: number;
} {
  // 用函数声明（而非 const 箭头函数），TS 才会在 never 返回后正确收窄类型
  function reject(detail: string): never {
    throw new SpeechTranscriptionError("SPEECH_AUDIO_NOT_UNCOMPRESSED_PCM", 422, detail);
  }
  if (buffer.length < 12 || buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    // MP3(ID3/0xFFFx) / M4A(ftyp) / OGG / FLAC 都会走到这里
    reject("not a RIFF/WAVE container");
  }

  let offset = 12;
  let fmt: { audioFormat: number; channels: number; sampleRateHz: number; blockAlign: number; bitsPerSample: number } | null = null;
  let data: Buffer | null = null;

  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const declaredSize = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;
    // 容错：某些导出工具把 size 写错，用实际可用长度兜底后再校验
    const size = Math.min(declaredSize, buffer.length - body);

    if (id === "fmt ") {
      if (size < 16) reject("fmt chunk too small");
      const audioFormat = buffer.readUInt16LE(body + 0);
      const channels = buffer.readUInt16LE(body + 2);
      const sampleRateHz = buffer.readUInt32LE(body + 4);
      const blockAlign = buffer.readUInt16LE(body + 12);
      const bitsPerSample = buffer.readUInt16LE(body + 14);
      if (audioFormat !== 1) {
        // 0xFFFE = WAVE_FORMAT_EXTENSIBLE：再读子格式 GUID 的前两字节
        if (audioFormat === 0xfffe && size >= 40) {
          const subFormatFirst2 = buffer.readUInt16LE(body + 24);
          if (subFormatFirst2 !== 1) reject(`WAVE_FORMAT_EXTENSIBLE with non-PCM subformat 0x${subFormatFirst2.toString(16)}`);
        } else {
          reject(`compressed WAV format 0x${audioFormat.toString(16)} is not supported for byte slicing`);
        }
      }
      if (channels <= 0) reject("invalid channel count");
      if (sampleRateHz <= 0) reject("invalid sample rate");
      if (bitsPerSample <= 0 || bitsPerSample % 8 !== 0) reject(`invalid bit depth ${bitsPerSample}`);
      const expectedBlockAlign = channels * (bitsPerSample / 8);
      if (blockAlign !== expectedBlockAlign) {
        reject(`blockAlign ${blockAlign} inconsistent with channels*bitsPerSample (${expectedBlockAlign})`);
      }
      fmt = { audioFormat: 1, channels, sampleRateHz, blockAlign, bitsPerSample };
    }
    if (id === "data") {
      if (declaredSize > buffer.length - body) reject("data chunk exceeds file size");
      data = buffer.subarray(body, body + declaredSize);
      break;
    }
    offset = body + size + (size % 2);
  }

  if (!fmt) reject("WAVE has no usable fmt chunk");
  if (!data) reject("WAVE has no data chunk");
  if (data.length === 0) reject("WAVE data chunk is empty");
  if (data.length % fmt.blockAlign !== 0) reject("data length is not a whole number of frames");

  return {
    pcm: data,
    sampleRateHz: fmt.sampleRateHz,
    channels: fmt.channels,
    bitsPerSample: fmt.bitsPerSample,
    bytesPerSecond: fmt.sampleRateHz * fmt.blockAlign,
  };
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
   * R1：来源名称只描述**可证事实**。
   *
   * 官方文档（help.aliyun.com/zh/model-studio/paraformer-server-events）把
   * `sentence.begin_time/end_time` 定义为「句子开始（结束）时间（ms）」，
   * `words[].begin_time/end_time` 定义为「字时间戳信息」——
   * 即 provider **正式声明并报告**的时间戳字段。
   *
   * 文档**没有**说明这些时间戳由何种内部算法产生，因此这里**不**声称
   * "acoustic alignment"（那是对 provider 内部实现的推断）。
   */
  readonly timestampProvenance = "provider_reported_timestamps" as const;

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
