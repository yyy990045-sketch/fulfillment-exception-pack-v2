#!/usr/bin/env bash
#
# Phase A2.1 — 把**任意来源**的真实录音准备成 A2.1 可验证的工件对。
#
# 用途：当 DSH 进程无法直接取用麦克风时（macOS 对无 bundle 的脱离进程默认不授权），
# 用系统 App（语音备忘录 / QuickTime Player）或手机录好，再用本脚本规范化。
#
# 用法：
#   bash scripts/prepare-mic-capture.sh <输入音频> <输出目录> [设备类别]
#
# 设备类别（只记录能确认的粒度）：
#   built_in_microphone | external_usb_microphone | phone_recording_import | unknown_controlled_microphone
#
# 产出（§5 原始 / 规范化分开）：
#   <out>/capture-original.<ext>    原始录音（原样保留，不改动）
#   <out>/capture-normalized.wav    规范化 PCM16 / 16k / mono
#   <out>/capture.json              溯源（两个哈希 + 派生关系）
set -euo pipefail

IN="${1:?usage: prepare-mic-capture.sh <input-audio> <outdir> [deviceCategory]}"
OUT="${2:?usage: prepare-mic-capture.sh <input-audio> <outdir> [deviceCategory]}"
DEVICE="${3:-unknown_controlled_microphone}"

[ -f "$IN" ] || { echo "input not found: $IN"; exit 3; }
command -v afconvert >/dev/null || { echo "afconvert not found"; exit 3; }
mkdir -p "$OUT"

EXT="${IN##*.}"
ORIG="$OUT/capture-original.$EXT"
cp "$IN" "$ORIG"

# 规范化：PCM16 / 16k / mono（ASR 与 byte-slicing 都要求未压缩 PCM）
afconvert -f WAVE -d LEI16@16000 -c 1 "$ORIG" "$OUT/capture-normalized.wav"

python3 - "$OUT" "$ORIG" "$DEVICE" "$EXT" <<'PY'
import hashlib, json, os, sys, wave
out, orig, device, ext = sys.argv[1:5]
norm = os.path.join(out, "capture-normalized.wav")
sha = lambda p: hashlib.sha256(open(p,'rb').read()).hexdigest()
with wave.open(norm) as w:
    dur_ms = int(round(w.getnframes()/w.getframerate()*1000)); rate=w.getframerate(); ch=w.getnchannels()
media = {"wav":"audio/wav","m4a":"audio/mp4","mp4":"audio/mp4","caf":"audio/x-caf",
         "aac":"audio/aac","mp3":"audio/mpeg"}.get(ext.lower(), "application/octet-stream")
manifest = {
  "captureType": "microphone",
  "deviceCategory": device,
  "originalMediaType": media,
  "originalContentHash": sha(orig),
  "originalByteSize": os.path.getsize(orig),
  "normalizedMediaType": "audio/wav",
  "normalizedContentHash": sha(norm),
  "normalizedByteSize": os.path.getsize(norm),
  "normalizedDurationMs": dur_ms,
  "normalizedSampleRateHz": rate,
  "normalizedChannels": ch,
  "derivation": {"relationship": "normalized_from", "tool": "afconvert -f WAVE -d LEI16@16000 -c 1"},
}
json.dump(manifest, open(os.path.join(out,"capture.json"),"w"), ensure_ascii=False, indent=2)
print(json.dumps(manifest, ensure_ascii=False, indent=2))
PY
echo "== prepared: $OUT =="
