#!/usr/bin/env python3
"""把一首歌 + 一批音色档案，算成一份「人话版」翻唱方案。

回答三个真问题：
    1. 这首歌原来唱在哪个音域、什么调、多快
    2. 换成每个音色唱，该升几个半音、会不会唱不到
    3. 节奏和速度要不要动

第 3 个问题的答案是不用，而且有实测依据：变调用 asetrate + atempo 补偿后，
伴奏时长与源严格相等（修复前 25 秒会短 44ms，整首累积 370ms，已修）。
SVC 换音色本身是逐帧的，不改节奏。所以「升 K 顺便调速度」是个误会。

用法:
    python3 scripts/analyze_song.py --vocals vocals.wav --backing no_vocals.wav \\
        --voices assets/voices/voices.json --json report.json
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import voice_range  # noqa: E402  - 同目录，直接复用音域分析

NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
# Krumhansl-Schmuckler 调性模板：大调/小调各 12 个音级的经验权重
MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
# 快到这个速度以上、又升得多，咬字会被听成「赶」，这时候才值得提示降速
FAST_BPM = 132


def _load_audio(path, seconds=None):
    import librosa

    return librosa.load(path, sr=22050, mono=True, duration=seconds)


def detect_tempo(path, max_seconds=90):
    """估 BPM。只取前 90 秒 —— 整首分析对一首 4 分钟的歌没必要，慢一倍。"""
    try:
        import librosa

        y, sr = _load_audio(path, max_seconds)
        tempo, _ = librosa.beat.beat_track(y=y, sr=sr)
        # librosa 新版本返回 (1,) 数组，老版本返回 float，统一成标量
        if hasattr(tempo, "__len__"):
            tempo = tempo[0]
        return round(float(tempo), 1)
    except Exception:                        # noqa: BLE001 - 分析失败不该拦住翻唱
        return None


def detect_key(path, max_seconds=90):
    """估调性。用色度向量和 Krumhansl 模板做相关，取相关最高的那个调。"""
    try:
        import librosa
        import numpy as np

        y, sr = _load_audio(path, max_seconds)
        chroma = librosa.feature.chroma_cqt(y=y, sr=sr)
        mean = chroma.mean(axis=1)

        best_corr, best = -2.0, None
        for root in range(12):
            for mode, profile in (("大调", MAJOR_PROFILE), ("小调", MINOR_PROFILE)):
                rotated = np.roll(np.array(profile), root)
                corr = float(np.corrcoef(mean, rotated)[0, 1])
                if corr > best_corr:
                    best_corr, best = corr, (root, mode)
        if not best:
            return None
        root, mode = best
        return {
            "tonic": NOTES[root],
            "mode": mode,
            "label": f"{NOTES[root]} {mode}",
            # 相关系数不是概率，别当置信度用，只用来判断「像不像一个明确的调」
            "score": round(best_corr, 2),
        }
    except Exception:                        # noqa: BLE001
        return None


def transpose_key(key, semitones):
    """升调后的调名。看不出来就不猜。"""
    if not key or not semitones:
        return key["label"] if key else None
    root = NOTES.index(key["tonic"])
    return f"{NOTES[(root + semitones) % 12]} {key['mode']}"


def load_voices(path):
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
    except Exception:                        # noqa: BLE001
        return []
    return [
        {"id": v.get("id"), "name": v.get("name") or v.get("id"),
         "lo": (v.get("range") or {}).get("lo"),
         "hi": (v.get("range") or {}).get("hi")}
        for v in data.get("voices") or []
    ]


def build_advice(vocal, tempo, plan_by_voice, key):
    """把数据翻译成结论。这里每一句都得能对着上面某个数字说清依据。"""
    advice = []
    # 节奏这条是实测结论，不是感觉：变调后伴奏时长与源严格一致
    advice.append("节奏和速度不用调：变调用 asetrate + atempo 补偿，伴奏时长与源"
                  "严格相等（实测 25 秒片段对齐到 0 误差）。SVC 是逐帧换音色，不改节拍。")

    if tempo and tempo >= FAST_BPM:
        fast = [p for p in plan_by_voice if (p.get("semitones") or 0) >= 5]
        if fast:
            advice.append(f"不过这首 {tempo:.0f} BPM 偏快，又升了 5 个半音以上，"
                          "咬字会显得赶。这属于编曲层面，真要缓解可以把伴奏降 2% 速度，"
                          "但会改掉原曲的呼吸感，默认不做。")

    if vocal.get("voicedRatio") is not None and vocal["voicedRatio"] < 0.55:
        advice.append(f"这首歌有声帧只占 {vocal['voicedRatio']:.0%}，气声和半声很多，"
                      "换音色后容易听着飘，整形档位别选太亮的。")

    for p in plan_by_voice:
        if not p.get("semitones"):
            continue
        if p.get("conflict"):
            advice.append(f"{p['name']}：这首歌比它的舒适音域还宽，"
                          f"整首移调救不回来（歌 {p['span']['song']} 个半音 > "
                          f"音色 {p['span']['voice']} 个半音）。")
    return advice


def analyze(vocals, backing, voices_path, current=None):
    stats = voice_range.analyze(vocals)
    tempo = detect_tempo(backing or vocals)
    key = detect_key(backing or vocals)
    voices = load_voices(voices_path)

    # 当前音色排在最前。它可能不在档案里（用户自定义，或者档案整个没铺进来），
    # 那种情况下也得给结论 —— 不能因为查不到档案就不推荐。
    if current and current.get("lo"):
        voices = [current] + [v for v in voices if v.get("id") != current.get("id")]

    plans = []
    for voice in voices:
        report = voice_range.plan(stats, voice)
        plans.append({
            "id": voice["id"],
            "name": voice["name"],
            "semitones": report["semitones"],
            "reason": report["reason"],
            "after": report["after"],
            "conflict": report["conflict"],
            "span": report["span"],
            "keyAfter": transpose_key(key, report["semitones"]),
        })

    return {
        "ok": True,
        "duration": stats["seconds"],
        "vocal": {
            "p05": stats["p05"], "p50": stats["p50"], "p90": stats["p90"],
            "voicedRatio": stats["voicedRatio"],
            "span": voice_range.span_semitones(stats["p05"], stats["p90"]),
        },
        "tempo": tempo,
        "key": key,
        "voices": plans,
        "advice": build_advice(stats, tempo, plans, key),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--vocals", required=True, help="人声干声（测音域）")
    parser.add_argument("--backing", help="伴奏（测 BPM 与调性，更准）；不给就用人声")
    parser.add_argument("--voices", default=str(Path(__file__).resolve().parent.parent
                                                / "assets/voices/voices.json"))
    parser.add_argument("--voice-id", help="当前选中的音色 id，会排在方案列表最前")
    parser.add_argument("--voice-lo", type=float, help="当前音色的下界 Hz（档案里查不到时用）")
    parser.add_argument("--voice-hi", type=float, help="当前音色的上界 Hz")
    parser.add_argument("--voice-name", help="当前音色名")
    parser.add_argument("--json", help="把报告写成 JSON")
    args = parser.parse_args()

    current = None
    if args.voice_lo:
        current = {"id": args.voice_id or "current",
                   "name": args.voice_name or "当前音色",
                   "lo": args.voice_lo, "hi": args.voice_hi}

    try:
        report = analyze(args.vocals, args.backing, args.voices, current)
    except ValueError as error:
        print(f"[analyze-song] {error}", file=sys.stderr)
        return 1

    if args.json:
        Path(args.json).parent.mkdir(parents=True, exist_ok=True)
        Path(args.json).write_text(json.dumps(report, ensure_ascii=False, indent=2),
                                   encoding="utf-8")

    print(f"时长 {report['duration']}s   "
          f"BPM {report['tempo'] or '未知'}   "
          f"调性 {report['key']['label'] if report['key'] else '未知'}")
    v = report["vocal"]
    print(f"人声音域 p05={v['p05']}Hz p50={v['p50']}Hz p90={v['p90']}Hz "
          f"跨度 {v['span']} 个半音")
    print()
    for p in report["voices"]:
        flag = " ⚠" if p["conflict"] else ""
        print(f"{p['name']:8s} 升 {p['semitones']:+d} 半音 → "
              f"{p['keyAfter'] or '?'}{flag}")
    print()
    for line in report["advice"]:
        print(f"· {line}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
