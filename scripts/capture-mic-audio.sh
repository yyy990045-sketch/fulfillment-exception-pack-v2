#!/usr/bin/env bash
#
# Phase A2.1 — 真实麦克风采集
#
# 用法：
#   bash scripts/capture-mic-audio.sh <输出目录> [秒数]
#
# 产出两份工件（§5 原始 / 规范化必须分开）：
#   <out>/capture-original.m4a   原始采集（AAC，压缩）
#   <out>/capture-normalized.wav 规范化（PCM16 / 16k / mono）
#   <out>/capture.json           采集溯源（哈希、时长、设备类别）
#
# 隐私边界：本脚本只录**当前默认输入设备**，且必须由使用者主动运行。
# 不录音时不做任何采集；不记录设备序列号；不记录本机绝对路径到溯源之外的地方。
set -euo pipefail

OUT="${1:?usage: capture-mic-audio.sh <outdir> [seconds]}"
SECONDS_TO_RECORD="${2:-25}"
mkdir -p "$OUT"

command -v ffmpeg >/dev/null || { echo "ffmpeg not found"; exit 3; }
command -v afconvert >/dev/null || { echo "afconvert not found"; exit 3; }

echo "== 采集 ${SECONDS_TO_RECORD}s（请现在开始朗读测试话术）=="
# 原始采集：AAC/M4A（真实设备常见输出格式，压缩）
ffmpeg -hide_banner -loglevel error -y \
  -f avfoundation -i ":0" -t "$SECONDS_TO_RECORD" \
  -c:a aac -b:a 128k "$OUT/capture-original.m4a"

# 规范化：PCM16 / 16k / mono（ASR 与 byte-slicing 都要求未压缩 PCM）
afconvert -f WAVE -d LEI16@16000 -c 1 "$OUT/capture-original.m4a" "$OUT/capture-normalized.wav"

sha() { shasum -a 256 "$1" | cut -d' ' -f1; }
bytes() { stat -f%z "$1"; }

python3 - "$OUT" <<'PY'
import json, os, subprocess, sys, wave
out = sys.argv[1]
def sha(p):
    import hashlib
    return hashlib.sha256(open(p,'rb').read()).hexdigest()
orig = os.path.join(out, "capture-original.m4a")
norm = os.path.join(out, "capture-normalized.wav")
with wave.open(norm) as w:
    dur_ms = int(round(w.getnframes() / w.getframerate() * 1000))
    rate, ch = w.getframerate(), w.getnchannels()
manifest = {
    "captureType": "microphone",
    # 只记录能确认的粒度：本机默认输入为内建麦克风（system_profiler 确认）
    "deviceCategory": "built_in_microphone",
    "originalMediaType": "audio/mp4",
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
echo "== done: $OUT =="
