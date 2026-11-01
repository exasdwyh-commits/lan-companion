#!/usr/bin/env python3
"""量一首「唱出来」的歌到底是不是在唱。

我用三个客观指标代替「听着像不像」这种没法复现的判断：

* **浊音占比**：有声带振动的帧占多少。说话正常 50%~65%。掉到 20% 以下说明
  周期性被毁了，听着就是气声噪音 —— 这是插值 sp/ap 做拉伸留下的典型伤。
* **f0 跨度**：旋律该有起伏。低于 2 个半音等于没起伏（念经），高于 18 个半音
  在桌面上会很吵。取 5%~95% 分位，避开换音边界上的一两帧残留。
* **帧间抖动**：相邻 5ms 帧的音高差（中位数）。唱的时候帧间应该很顺；
  超过 0.25 半音说明每帧音高在乱跳，也就是声码器被喂了不一致的帧。

这里不能用「250ms 窗口内标准差」—— 唱歌每 250ms 就换一个音，那会把正常的
旋律走向判成抖动。第一版就是这么误判的，整首被判成 30% 波动。

    python3 scripts/sing_report.py out.m4a /tmp/tide.json

输出每行一句的分数，末尾给总评。退出码 0 = 全部通过。
"""
from __future__ import annotations

import json
import math
import os
import subprocess
import sys
import tempfile

import numpy as np
import pyworld as pw
import soundfile as sf

SR = 44100
FRAME = 5.0  # ms


def load(path: str) -> tuple[np.ndarray, int]:
    """m4a 读不进来就丢给 ffmpeg 转 wav。"""
    if path.lower().endswith((".m4a", ".mp3", ".aac")):
        tmp = tempfile.mktemp(suffix=".wav")
        ffmpeg = os.environ.get("FFMPEG") or "/Users/exasdwyh/bin/ffmpeg"
        subprocess.run([ffmpeg, "-v", "error", "-y", "-i", path, "-ac", "1",
                        "-ar", str(SR), tmp], check=True)
        data, sr = sf.read(tmp, dtype="float64")
        os.remove(tmp)
    else:
        data, sr = sf.read(path, dtype="float64")
    if data.ndim > 1:
        data = data.mean(axis=1)
    return data, sr


def analyze(data: np.ndarray, sr: int) -> dict:
    if sr != SR:
        import librosa
        data = librosa.resample(data.astype(np.float32), orig_sr=sr,
                                target_sr=SR).astype(np.float64)
    # 上限给到 1100Hz：少女音能唱到 C6，卡在 800 会把高音误判成低八度，
    # 看起来像「音高乱跳」，其实是分析器的天花板太低。
    f0, time = pw.harvest(data, SR, f0_floor=70.0, f0_ceil=1100.0,
                          frame_period=FRAME)
    voiced = f0 > 0
    ratio = float(voiced.mean()) if len(f0) else 0.0
    values = f0[voiced]
    if len(values) < 10:
        return {"voiced": ratio, "span": 0.0, "jitter": 1.0, "median": 0.0}

    # 帧间抖动只在「相邻两帧都有声」时才计：跨清音算差值没有意义，
    # 会平白把「一个字和下一个字之间」算成跳音。注意要在全帧长度上算差分，
    # 不能拿压缩过的浊音数组算，否则索引对不上。
    full = np.where(voiced, 12 * np.log2(np.maximum(f0, 1e-6) / 440.0), np.nan)
    neighbor = voiced[:-1] & voiced[1:]
    deltas = np.abs(np.diff(full))[neighbor]
    jitter = float(np.median(deltas)) if len(deltas) else 0.0

    semis = 12 * np.log2(np.maximum(values, 1e-6) / 440.0)
    # 用 10%~90% 分位而不是最大最小：句首句尾总有几帧声码器残留（见过 -30 半音
    # 的单点），拿极值当跨度会把正常句子判成「跨度过大」。
    span = float(np.percentile(semis, 90) - np.percentile(semis, 10))

    return {"voiced": ratio, "span": span, "jitter": jitter,
            "median": float(np.median(values))}


def verdict(stats: dict) -> list[str]:
    problems = []
    if stats["voiced"] < 0.30:
        problems.append(f"浊音占比 {stats['voiced']:.0%} 太低（目标 ≥50%），周期性被毁了")
    elif stats["voiced"] < 0.45:
        problems.append(f"浊音占比 {stats['voiced']:.0%} 偏低（目标 ≥50%）")
    if stats["span"] < 2.0:
        problems.append(f"f0 只跨 {stats['span']:.1f} 个半音，没有旋律起伏")
    if stats["span"] > 18.0:
        problems.append(f"f0 跨 {stats['span']:.1f} 个半音，跨度过大")
    if stats["jitter"] > 0.25:
        problems.append(f"帧间抖动 {stats['jitter']:.2f} 半音，音高在乱跳（目标 <0.25）")
    return problems


def timbre_vector(path: str) -> np.ndarray:
    """把一段音频压成一个「音色指纹」：有声帧的平均 MFCC（丢掉第 0 维）。

    第 0 维是整体能量，跟音色无关，留着会让「谁录得更响」变成"更像"。
    其余维度描述谱包络，也就是共振峰的形状 —— 同一个人的不同录音会靠得很近。
    """
    import librosa

    data, rate = load(path)
    y = data.astype(np.float32)
    if rate != 22050:
        y = librosa.resample(y, orig_sr=rate, target_sr=22050)
    mfcc = librosa.feature.mfcc(y=y, sr=22050, n_mfcc=20, n_fft=1024, hop_length=256)
    rms = librosa.feature.rms(y=y, frame_length=1024, hop_length=256)[0]
    keep = rms > rms.max() * 0.05
    if keep.sum() < 5:
        return np.zeros(19)
    return mfcc[1:, keep].mean(axis=1)


def timbre_similarity(a: np.ndarray, b: np.ndarray) -> float:
    denominator = float(np.linalg.norm(a) * np.linalg.norm(b))
    return float(np.dot(a, b) / denominator) if denominator else 0.0


def main() -> int:
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    path = sys.argv[1]
    timeline_path = sys.argv[2] if len(sys.argv) > 2 else None
    ref_path = sys.argv[3] if len(sys.argv) > 3 else None

    data, sr = load(path)
    duration = len(data) / sr
    print(f"文件：{os.path.basename(path)}  {duration:.2f}s")

    windows: list[tuple[str, float, float]] = []
    if timeline_path and os.path.exists(timeline_path):
        with open(timeline_path, encoding="utf-8") as handle:
            payload = json.load(handle)
        lines = payload.get("lyrics") or []
        for index, item in enumerate(lines):
            begin = float(item.get("at", 0.0))
            end = (float(lines[index + 1].get("at", duration))
                   if index + 1 < len(lines) else duration)
            windows.append((item.get("zh", f"第 {index + 1} 句"), begin, end))
    else:
        windows.append(("整首", 0.0, duration))

    failed = 0
    print(f"{'句':<14}{'浊音':>7}{'跨度':>8}{'抖动':>8}{'中位 f0':>10}")
    for label, begin, end in windows:
        chunk = data[int(begin * sr):int(end * sr)]
        if len(chunk) < SR // 4:
            continue
        stats = analyze(chunk, sr)
        problems = verdict(stats)
        failed += len(problems)
        mark = "ok " if not problems else "!! "
        print(f"{mark}{label:<12}{stats['voiced']:>7.0%}"
              f"{stats['span']:>7.1f}{stats['jitter']:>8.2f}"
              f"{stats['median']:>9.0f}Hz")
        for problem in problems:
            print(f"    - {problem}")

    stats = analyze(data, sr)
    print(f"\n整首：浊音 {stats['voiced']:.0%}  跨度 {stats['span']:.1f} 半音  "
          f"抖动 {stats['jitter']:.2f} 半音  中位 {stats['median']:.0f}Hz")

    if ref_path and os.path.exists(ref_path):
        # 音色相似度：拿她本人说话的 MFCC 当锚点。翻唱之后这个数应该明显高于
        # WORLD 直出（WORLD 只换音高，谐波结构还是声码器味）。
        similarity = timbre_similarity(timbre_vector(path), timbre_vector(ref_path))
        print(f"音色相似度 {similarity:.3f}（对面是她说话的样本；>0.85 听着就是她）")
        if similarity < 0.80:
            failed += 1
            print("    - 音色偏离参考太多，Seed-VC 那一步没起作用")

    print("结论：" + ("通过" if failed == 0 else f"{failed} 处需要修"))
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
