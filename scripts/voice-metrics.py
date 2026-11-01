#!/usr/bin/env python3
"""量一段语音的客观指标：时长、基频分布、浊音占比、亮度。

为什么不用肉眼看波形：验收要回答的是「两形态是不是两副音色」，
需要可比较的数，而不是「听起来像」。判断标准是同一句话下
desktop 更短（语速更快）、基频更高、过零率更大 —— 对应萌娘音色。

依赖 numpy（项目里用 .runtime/venv-tts/bin/python3）；
没有 numpy 时直接报错退出，不静默给假数值。

用法：python3 scripts/voice-metrics.py a.mp3 b.mp3 ...
输出：一个 JSON 数组，一项一段。
"""
import json
import subprocess
import sys

try:
    import numpy as np
except ImportError:
    sys.stderr.write("需要 numpy：.runtime/venv-tts/bin/python3 scripts/voice-metrics.py ...\n")
    raise SystemExit(2)


def load(path, sr=16000):
    raw = subprocess.run(
        ["ffmpeg", "-v", "quiet", "-i", path, "-f", "s16le", "-ac", "1", "-ar", str(sr), "-"],
        capture_output=True,
    ).stdout
    return np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0, sr


def stats(path):
    x, sr = load(path)
    win, hop = 640, 320  # 40ms 窗 / 20ms 步
    f0s, rms_all = [], []
    for i in range(0, max(0, len(x) - win), hop):
        frame = x[i:i + win]
        r = float(np.sqrt((frame ** 2).mean()))
        rms_all.append(r)
        if r < 0.015:  # 静音帧不参与基频估计
            continue
        frame = frame - frame.mean()
        corr = np.correlate(frame, frame, "full")[win - 1:]
        lo, hi = int(sr / 400), int(sr / 70)  # 400Hz ~ 70Hz
        seg = corr[lo:hi]
        if len(seg) == 0:
            continue
        k = int(np.argmax(seg)) + lo
        if corr[k] > 0.30 * corr[0]:
            f0s.append(sr / k)
    zcr = float(np.mean(np.abs(np.diff(np.signbit(x).astype(np.int8)))))
    return {
        "file": path.split("/")[-1],
        "sec": round(len(x) / sr, 2),
        "f0_p50": round(float(np.median(f0s)), 1) if f0s else 0.0,
        "f0_p10": round(float(np.percentile(f0s, 10)), 1) if f0s else 0.0,
        "f0_p90": round(float(np.percentile(f0s, 90)), 1) if f0s else 0.0,
        "voiced_pct": round(100.0 * len(f0s) / max(1, len(rms_all)), 1),
        "rms": round(float(np.mean(rms_all)), 4),
        "zcr": round(zcr, 4),
    }


if __name__ == "__main__":
    print(json.dumps([stats(p) for p in sys.argv[1:]], ensure_ascii=False))
