#!/usr/bin/env python3
"""测一首演唱的音域，算出翻唱该升几个半音。

为什么需要这个：Seed-VC 是「换音色」不是「换音域」。它把源人声的基频
曲线原样搬过去，只换谁在唱。男声原唱（下探到 110Hz 左右）换成女声后，
那段低音女声根本唱不实 —— 只能挤成气声，中音区也上不去胸声的厚度，
听感就是又虚又闷。这就是「薛之谦的翻唱很难听」的真正原因：

    实测《我好像在哪见过你》干声 p05=115Hz / p50=232Hz / p90=329Hz
    转换后 p05=105Hz / p50=225Hz —— 音高几乎没动，只是换了音色。

所以要把整首歌（人声 + 伴奏）一起升到女声能唱的音域。

判据用低音区而不是中位数：
  男声 p05 典型 100~145Hz，女声基本下不到 165Hz 以下。
  用中位数会误判 —— 薛之谦是男高音，p50=232Hz 落进了女声区间。

默认目标 floor=165Hz（E3）：女声流行唱法能实唱的下界。实测在这台机器上
对齐后 p50 会落在 310~350Hz（D#4~F4），正是女歌手最舒服的位置。

音色不同，下界不同 —— 所以 floor 是可传参的（--voice-lo / --voice-hi）。
真人歌手还要看上界：孙燕姿的质量音域按声乐分析是 E3–B4（165–494Hz），
歌再宽一点就唱不了，整首移调救不回来，这时会明确报冲突而不是硬算一个数。
合成音色不设上界，它跟着 f0 条件走。

用法:
    python3 scripts/voice_range.py --in vocals.wav
    python3 scripts/voice_range.py --in vocals.wav --json out.json
    python3 scripts/voice_range.py --in vocals.wav --brief      # 只打印半音数
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys

# 女声能实唱的下界。低于这个音，女声只能出气声，胸声共鸣完全建立不起来。
# 女低音可到 174Hz(F3)，女高音要到 262Hz(C4)；165 是流行女歌手常用的安全线。
TARGET_FLOOR = 165.0
# 人声基频的合理搜索范围。低于 60Hz 是贝斯/噪声，高于 1100Hz 是女声尖叫上限。
F0_MIN = 60.0
F0_MAX = 1100.0
FRAME_MS = 10.0


def _stats(values):
    """给一组基频算分位数。空数组返回 None，调用方负责兜底。"""
    import numpy as np

    if values.size == 0:
        return None
    percentiles = {}
    for q in (2, 5, 10, 15, 25, 50, 75, 90, 95, 99):
        percentiles[f"p{q:02d}"] = round(float(np.percentile(values, q)), 1)
    return percentiles


# 低于「最响的有声帧」多少 dB 就算残留。30dB 是实测出来的：人声弱音
# （气声、句尾）比强音低 15~20dB，混响尾音和伴奏漏音低 30~45dB，
# 中间这条线正好把它们分开。
GATE_DB = 30.0


def _energy_gated(f0, times, audio, sr):
    """只保留「真的有人在唱」的帧。

    harvest 只看周期性，不看电平 —— 混响尾巴也是有周期性的，照样会被判成
    有声。分离出来的人声轨里这种残留特别多，而且它们往往是低频泄漏，
    于是把「最低音」整个拉低，最终让整首歌被过度升调。
    """
    import numpy as np

    span = int(sr * FRAME_MS / 1000.0)
    half = span // 2
    levels = np.empty(f0.size, dtype="float64")
    for i, t in enumerate(times):
        center = int(t * sr)
        lo, hi = max(0, center - half), min(audio.size, center + half)
        seg = audio[lo:hi]
        levels[i] = np.sqrt(np.mean(seg ** 2)) if seg.size else 0.0

    voiced_mask = f0 > 0
    db = 20.0 * np.log10(levels + 1e-12)
    if not voiced_mask.any():
        return f0[voiced_mask], db
    # 以最响的有声帧为参照，不用全曲峰值 —— 峰值可能来自爆音/齿音。
    reference = float(np.percentile(db[voiced_mask], 95))
    keep = voiced_mask & (db > reference - GATE_DB)
    return f0[keep], db


def analyze(path, max_seconds=None, f0_min=None):
    """提取基频并统计分布。返回 dict，失败抛 ValueError。

    f0_min 默认用 F0_MIN(60Hz)。测女声要传更高（130 左右）—— harvest 在
    信号弱的地方会把 156Hz 判成 78Hz（低八度错误），高通滤波救不了，
    因为那是估计错误而不是真有低频能量。实测：孙燕姿《开始懂了》
    不设下限报 p05=76Hz，设 130 之后才落在她真实的 E3 区间。
    """
    import numpy as np
    import pyworld as pw
    import soundfile as sf

    if not os.path.exists(path):
        raise ValueError(f"找不到音频：{path}")

    floor = float(f0_min or F0_MIN)
    if not (40.0 <= floor < F0_MAX):
        raise ValueError(f"f0_min={floor} 不合理，应在 40~{F0_MAX:.0f}Hz 之间。")

    audio, sr = sf.read(path, dtype="float64")
    if audio.ndim > 1:                       # 立体声先混成单声道再测
        audio = audio.mean(axis=1)
    if max_seconds:
        audio = audio[: int(sr * max_seconds)]
    if audio.size < sr * 0.5:
        raise ValueError("音频太短，不到半秒，无法测音域。")

    # harvest 比 dio 慢一点，但对歌声（含颤音、气声）稳得多，不会把颤音
    # 误判成两个音高。frame_period=10ms 与 SVC 内部的 f0 采样率一致。
    f0, times = pw.harvest(audio, sr, f0_floor=floor, f0_ceil=F0_MAX,
                           frame_period=FRAME_MS)

    # 能量门控。demucs 分出来的人声轨永远带着混响尾音和伴奏漏音，
    # harvest 会在这些地方给出「像人声」的基频。实测《爱错》：
    # 被判为低音的 1224 帧电平中位数 -48dB，真实人声帧 -18.6dB，差 30dB；
    # 这些帧零散成 81 段、中位长度 0.06s，根本不是唱出来的音。
    # 不挡掉的话 p05 会低 40Hz，建议多升 2~3 个半音，最高音直接顶到歌手
    # 上限 —— 听感就是「高音挤卡、很假」。
    voiced, _levels = _energy_gated(f0, times, audio, sr)
    if voiced.size < 20:                     # 少于 0.2 秒有声帧，不足以判断
        raise ValueError("几乎测不到人声，可能是纯伴奏或静音。")

    percentiles = _stats(voiced)
    percentiles["gatedRatio"] = round(1.0 - voiced.size / max(int((f0 > 0).sum()), 1), 3)
    return {
        "seconds": round(float(audio.size / sr), 2),
        "voicedRatio": round(float(voiced.size / max(f0.size, 1)), 3),
        **percentiles,
    }


def span_semitones(low, high):
    """两个频率差几个半音。用来判断「这首歌比这个音色宽还是窄」。"""
    if not low or not high or low <= 0 or high <= 0 or high <= low:
        return 0.0
    return round(12.0 * math.log2(high / low), 1)


def recommend(p05, lo=TARGET_FLOOR, hi=None, p90=None):
    """按「把最低音抬到音色能实唱的下界」给出升调半音数。

    返回 (半音数, 说明)。半音数是整数，因为整首歌的伴奏要一起变调，
    非整数会引入更明显的重采样失真，而音乐上按半音走本来也更自然。

    lo 是该音色能唱实的下界，hi 是舒适上界（None = 由 SVC 外推，不设硬限）。
    只有真人歌手才需要 hi：合成音色的上限由 f0 条件决定，真人有生理极限。

    只升不降：低音区已经在范围内就保持原调。每一次升降都要让伴奏跟着重新
    变调（ffmpeg 没有 rubberband，用的是 resample 拉伸），没有必要的调整
    只会白白牺牲伴奏音色。想降调是审美选择，交给用户手动。

    上界冲突时往回退：宁可低音差一点，也不要把整首推进尖叫区。这时
    「这首歌超出该音色的舒适音域」是事实，得让用户知道，而不是硬算一个数。
    """
    if not p05 or p05 <= 0:
        return 0, "测不到低音区，按不升调处理。"
    if p05 >= lo:
        return 0, f"低音区 {p05:.0f}Hz 已在 {lo:.0f}Hz 之上，保持原调。"
    raw = 12.0 * math.log2(lo / p05)
    steps = int(round(raw))
    if steps <= 0:                           # 差不到半个半音，不值得动伴奏
        return 0, f"低音区 {p05:.0f}Hz 接近 {lo:.0f}Hz，保持原调。"
    # 升超过 8 个半音会被推进尖叫区，伴奏也已经被拉得面目全非。
    steps = min(8, steps)

    headroom = ""
    wanted = steps
    if hi and p90:
        ceiling = 12.0 * math.log2(hi / p90)
        if steps > ceiling:
            steps = max(0, int(math.floor(ceiling)))
            # 这里必须说清「本来要多少、被砍到多少」，否则读者会以为括号里
            # 的原始值就是最终结果，以为算法算错了。
            headroom = (f"本要升 {wanted} 个半音才够，但最高音会顶到 {hi:.0f}Hz 上限，"
                        f"只能升 {steps} 个——低音区会留一点虚，这是妥协。")
        else:
            headroom = f"最高音升完 {p90 * 2 ** (steps / 12):.0f}Hz，离上限 {hi:.0f}Hz 还有余量。"

    detail = (f"原唱低音区 {p05:.0f}Hz，该音色实唱下界约 {lo:.0f}Hz，"
              f"升 {steps} 个半音（{raw:+.1f} 取整）。")
    return steps, detail + headroom


def plan(stats, voice=None):
    """把音域统计 + 音色档案算成一份完整建议，供面板直接展示。

    stats 来自 analyze()，voice 是 {name, lo, hi}。不传就用通用女声下界。

    除了「升几个半音」，还回答两个用户真会问的问题：
      这首歌比这个音色宽吗？—— 歌的跨度 vs 音色的跨度
      升完之后低音区还剩多少余量？—— 余量越小越容易唱得虚
    """
    voice = voice or {}
    lo = voice.get("lo") or TARGET_FLOOR
    hi = voice.get("hi") or None
    name = voice.get("name") or "通用女声"
    p05, p90 = stats.get("p05"), stats.get("p90")

    steps, reason = recommend(p05, lo, hi, p90)
    result = {
        "voice": {"name": name, "lo": lo, "hi": hi},
        "semitones": steps,
        "reason": reason,
        "conflict": False,
        "after": None,
        "span": None,
    }
    if not p05:
        return result

    ratio = 2 ** (steps / 12)
    after = {k: round(stats[k] * ratio, 1) for k in ("p05", "p50", "p90") if stats.get(k)}
    result["after"] = after

    src_span = span_semitones(p05, p90) if p90 else 0
    result["span"] = {"song": src_span, "voice": span_semitones(lo, hi) if hi else None}
    if hi and p90:
        voice_span = span_semitones(lo, hi)
        # 歌比音色宽，靠整体移调救不了：一定有一部分落在音色能力之外
        if voice_span and src_span > voice_span:
            result["conflict"] = True
            result["reason"] += (f" 注意：这首歌跨度 {src_span} 个半音，"
                                 f"超过 {name} 的 {voice_span} 个半音，"
                                 f"总会有一段唱不到位。")
    return result


def loudest_window(path, seconds):
    """找整首里最响的一段起点，用作试听片段。

    试听要挑副歌 —— 主歌音域窄、编曲薄，听不出音色和音域的真实问题。
    用 0.5s 窗算 RMS，再按窗口平滑，避免选中单个鼓点。
    返回起点秒数（保证片段完整落在音频内）。
    """
    import numpy as np
    import soundfile as sf

    audio, sr = sf.read(path, dtype="float64")
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    total = audio.size / sr
    if total <= seconds:                      # 整首都比片段短，从头开始
        return 0.0

    hop = max(int(sr * 0.5), 1)
    frames = audio.size // hop
    rms = np.array([np.sqrt(np.mean(audio[i * hop:(i + 1) * hop] ** 2) + 1e-12)
                    for i in range(frames)])
    # 用片段长度做滑动平均：让「整段都响」的位置胜出，而不是一个爆音
    span = max(int(seconds / 0.5), 1)
    if span < rms.size:
        kernel = np.ones(span) / span
        rms = np.convolve(rms, kernel, mode="valid")
    best = int(np.argmax(rms))
    start = best * 0.5
    # 末尾留 0.2s 余量，避免片段越界被截成不足长度
    return round(max(0.0, min(start, total - seconds - 0.2)), 2)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--in", dest="src", required=True, help="人声干声（最好是分离后的人声轨）")
    parser.add_argument("--json", help="把结果写成 JSON")
    parser.add_argument("--brief", action="store_true", help="只打印推荐半音数")
    parser.add_argument("--max-seconds", type=float, default=None,
                        help="只分析前 N 秒（调试用，默认整首）")
    parser.add_argument("--pick-clip", type=float, metavar="SECONDS",
                        help="只找最响的 SECONDS 秒片段起点并输出秒数（不做音域分析）")
    parser.add_argument("--voice-lo", type=float, default=TARGET_FLOOR,
                        help=f"该音色能唱实的下界 Hz（默认 {TARGET_FLOOR:.0f}）")
    parser.add_argument("--voice-hi", type=float, default=None,
                        help="该音色的舒适上界 Hz；只有真人歌手需要，不填则不设限")
    parser.add_argument("--voice-name", default="通用女声", help="报告里显示的音色名")
    args = parser.parse_args()

    if args.pick_clip:
        try:
            print(loudest_window(args.src, args.pick_clip))
        except Exception as error:            # noqa: BLE001 - 调用方需要兜底值
            print(0.0)
            print(f"[voice-range] 定位试听片段失败：{error}", file=sys.stderr)
            return 1
        return 0

    try:
        stats = analyze(args.src, args.max_seconds)
    except ValueError as error:
        if args.brief:
            print("0")
        print(f"[voice-range] {error}", file=sys.stderr)
        return 1

    report = plan(stats, {"name": args.voice_name, "lo": args.voice_lo, "hi": args.voice_hi})
    steps = report["semitones"]
    # recommend 是给管线脚本读的老字段，保持原样别动；新字段都放在 plan 里。
    result = {"ok": True, "source": stats,
              "recommend": {"semitones": steps, "targetFloor": args.voice_lo,
                            "reason": report["reason"]},
              "plan": report}

    if args.json:
        os.makedirs(os.path.dirname(os.path.abspath(args.json)) or ".", exist_ok=True)
        with open(args.json, "w", encoding="utf-8") as handle:
            json.dump(result, handle, ensure_ascii=False, indent=2)

    if args.brief:
        print(steps)
    else:
        print(f"时长 {stats['seconds']}s  有声帧占比 {stats['voicedRatio']:.0%}")
        print(f"低音区 p05={stats['p05']}Hz  p50={stats['p50']}Hz  p90={stats['p90']}Hz"
              f"  跨度 {report['span']['song']} 个半音")
        print(f"音色：{args.voice_name}  下界 {args.voice_lo:.0f}Hz"
              + (f"  上界 {args.voice_hi:.0f}Hz" if args.voice_hi else "  上界不设限"))
        print(f"推荐：{steps:+d} 半音 —— {report['reason']}")
        if report.get("after"):
            after = report["after"]
            print(f"升完：p05={after['p05']}Hz  p50={after['p50']}Hz  p90={after['p90']}Hz")
        if report.get("conflict"):
            print("⚠ 这首歌超出该音色的舒适音域，整首移调救不回来。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
