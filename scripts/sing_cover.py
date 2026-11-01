#!/usr/bin/env python3
"""Make the character sing.

Two steps, both local:

1. **说话** — 用现有 TTS worker 把歌词念出来（澜的声线），每行一个 wav。
2. **唱** — 用 WORLD 声码器把每行的音高换成旋律，保留原来说话的音色（共振峰）。
   这一步只改 f0，所以听起来还是她，只是把「念」变成了「唱」。

为什么不是直接上翻唱模型：声音权。拿孙燕姿那类真人歌手的模型翻唱，属于
民法典 1023 条保护的"声音"，商用模板里放不得。这条路用的是她自己 TTS 出来的
声线，素材是我们自己产的，可以对外卖。

    python3 scripts/sing_cover.py --lyrics lyrics.txt --out song.m4a
    python3 scripts/sing_cover.py --lyrics lyrics.txt --out song.m4a --meter 3/4 --tempo 92

歌词文件一行一句，空行表示换气停顿。输出的 `--json` 给 pack.json 用。
"""
from __future__ import annotations

import argparse
import json
import math
import os
import re
import subprocess
import sys
import tempfile
import uuid

import numpy as np
import pyworld as pw
import soundfile as sf

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_TTS = os.path.join(os.path.dirname(ROOT), "LiveTalking/.venv/bin/python")
SR = 44100

# 五声音阶（宫商角徵羽）比自然大调更"东方"，也不容易撞到半音的刺耳处。
PENTATONIC = [0, 2, 4, 7, 9]


def midi_to_hz(note: float) -> float:
    """MIDI 音高转频率。A4(69) = 440Hz。

    这里曾经写成 `(note - 9) / 12`，把所有音高高了整整五个八度（C4 变成 8.3kHz），
    声码器照唱，但再分析回来全是次谐波——听感上是刺耳的啸叫加气声。
    """
    return 440.0 * 2 ** ((note - 69) / 12)


def scale_ladder(root: int, octaves: int = 2) -> list[int]:
    """把五声音阶摊成一条连续的音梯，末尾补上高八度的主音。

    逐级移动比"索引取模再补八度"好懂也不会算出界：旋律就在这条梯子上
    来回走，走到哪一级就是哪个音。
    """
    ladder = [root + step + 12 * octave
              for octave in range(octaves) for step in PENTATONIC]
    ladder.append(root + 12 * octaves)
    return ladder


def render_speech(lines: list[str], outdir: str, voice: str, instruct: str,
                  engine: str = "auto", speed: float = 1.0) -> list[str]:
    """通过常驻 TTS worker 把每行歌词念成一个 wav。

    worker 是流式的（stdin 一行 JSON、stdout 一行结果），冷启动要十几秒，
    所以只起一次、按顺序把所有行发过去。
    """
    python = os.environ.get("LINGDESK_TTS_PYTHON", DEFAULT_TTS)
    script = os.path.join(ROOT, "scripts", "pet_tts.py")
    if not os.path.exists(python):
        raise SystemExit(f"TTS 解释器不存在：{python}（用 LINGDESK_TTS_PYTHON 指定）")
    os.makedirs(outdir, exist_ok=True)
    task = subprocess.Popen(
        [python, script, outdir, "--engine", engine, "--warm"],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
        text=True, bufsize=1,
    )
    assert task.stdin and task.stdout
    paths: list[str] = []
    try:
        for index, line in enumerate(lines):
            job = uuid.uuid4().hex
            task.stdin.write(json.dumps({
                "id": job, "text": line, "engine": engine, "voice": voice,
                "speed": speed, "pitch": 1.0, "instruct": instruct,
            }, ensure_ascii=False) + "\n")
            task.stdin.flush()
            while True:
                raw = task.stdout.readline()
                if not raw:
                    raise SystemExit(f"TTS worker 提前退出（第 {index + 1} 行）")
                try:
                    reply = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                if reply.get("id") != job:
                    continue
                if reply.get("error") or not reply.get("path"):
                    raise SystemExit(f"第 {index + 1} 行合成失败：{reply.get('error')}")
                paths.append(reply["path"])
                print(f"  [tts] {index + 1}/{len(lines)} {reply.get('engine')} "
                      f"{os.path.basename(reply['path'])}", flush=True)
                break
    finally:
        task.stdin.close()
        task.wait(timeout=20)
    return paths


def syllable_count(line: str) -> int:
    """中文按字算，英文按音节粗估。

    只用来决定「这一行分几个音」，不需要精确：分多了像念经，分少了像拉长音，
    大致对上字数的效果最自然。
    """
    han = re.findall(r"[\u4e00-\u9fff]", line)
    latin = re.findall(r"[A-Za-z]+", line)
    syllables = len(han)
    for word in latin:
        groups = re.findall(r"[aeiouy]+", word.lower())
        syllables += max(1, len(groups))
    return max(1, syllables)


def melody_for(count: int, start_beat: float, meter: int, ladder: list[int],
               rng: np.random.Generator) -> tuple[list[tuple[float, float, int]], float]:
    """给一行生成旋律：一个字一个音，长度按半拍走。

    单位是「拍」，不是「拍数」—— 一个音 0.5 拍才接近说话的语速；给整数拍的话
    一行七个字会唱成十秒，听感直接垮掉。

    起点落在梯子中段（E4~E5），随机游走不越界。这个约束很关键：不限制的话
    游走到低音区听起来像男声，走到顶上就变成尖叫。
    """
    notes: list[tuple[float, float, int]] = []
    position = start_beat
    # 只在梯子中段游走：C4 起两个八度时，这里正好是 E4~G5（330~784Hz），
    # 少女音唱得上去又不刺耳。放开边界的话七个音连走 +2 能冲到 C6。
    low = max(0, int(len(ladder) * 0.2))
    high = min(len(ladder) - 1, int(len(ladder) * 0.8))
    # 从中间起手，留出上下浮动的余量。
    degree = (low + high) // 2
    tonic = ladder[0]
    for index in range(count):
        last = index == count - 1
        length = float(rng.choice([1.0, 1.5, 2.0])) if last else float(rng.choice([0.5, 0.5, 1.0, 1.0, 1.5]))
        if index:
            # 相邻音不要同高度、不要大跳：这两条就足以听起来像旋律而不是念数字。
            degree = int(np.clip(degree + int(rng.choice([-2, -1, -1, 1, 1, 2])),
                                 low, high))
        semitone = ladder[degree]
        if last:
            # 句尾落回主音（就近的那个八度），听起来像「唱完了」而不是「断了」。
            semitone = min((tonic + 12 * o for o in (0, 1, 2)),
                           key=lambda tone: abs(tone - ladder[degree]))
        notes.append((position, length, semitone))
        position += length
    return notes, position


def sing_line(path: str, notes: list[tuple[float, float, int]], unit: float,
              vibrato: float = 0.0) -> np.ndarray:
    """把一句话唱出来：保留音色（谱包络），只换基频。

    关键约束：**不改时长**。早期版本为了让旋律长度对上而插值了 sp/ap，
    结果 aperiodicity 被插成半气声，浊音比例从 58% 掉到 14%，整首像噪音。
    正确的做法是反过来——旋律去贴说话本身的节奏，一个音节一个音，
    说话说多久就唱多久，中间的清音（s/zh 这类）自然留在原处。
    """
    data, sr = sf.read(path, dtype="float64")
    if data.ndim > 1:
        data = data.mean(axis=1)
    if sr != SR:
        import librosa
        data = librosa.resample(data.astype(np.float32), orig_sr=sr, target_sr=SR).astype(np.float64)
    if len(data) < 2048:
        return np.zeros(0)

    f0, time = pw.harvest(data, SR, f0_floor=70.0, f0_ceil=700.0, frame_period=5.0)
    sp = pw.cheaptrick(data, f0, time, SR)
    ap = pw.d4c(data, f0, time, SR)
    voiced = f0 > 0
    vocal_frames = int(voiced.sum())
    if vocal_frames < 20:
        return np.zeros(0)

    # 按「第几个浊音帧」分配音符，而不是按绝对时间：
    # 清音（p/t/s）占的时间不该分到音符，否则「海」的 h 会吃掉半个音。
    target = np.zeros_like(f0)
    seen = 0
    total = len(notes)
    for index in range(len(f0)):
        if not voiced[index]:
            continue
        # 0.0 到 total 之间的浮点位置，整数部分=第几个音，小数部分=这个音唱了多少。
        position = seen / vocal_frames * total
        seen += 1
        active = notes[min(int(position), total - 1)]
        _, length, semitone = active
        freq = midi_to_hz(semitone)
        local = position - math.floor(position)
        # 每个音的头 25% 从略低滑上去：硬切会「咔」，全程平滑又听不出换音。
        glide = min(1.0, local / 0.25)
        freq *= 0.955 + 0.045 * glide
        if vibrato and length >= 1.0:
            # 颤音只在音的后半段长出来，前半段直着唱，才像人在换气。
            depth = max(0.0, (local - 0.35) / 0.65)
            freq *= 1.0 + vibrato * depth * math.sin(2 * math.pi * 5.2 * time[index])
        target[index] = freq

    out = pw.synthesize(target, sp, ap, SR)
    return np.asarray(out, dtype=np.float64)


def pad_track(total: float, notes: list[tuple[float, float, int]]) -> np.ndarray:
    """一层很轻的琶音垫底。没有伴奏的清唱在桌面上听着像未完成。

    `notes` 用绝对秒数 (起点, 时长, 半音)，因为每句唱多久取决于说话多长，
    按拍子推算会对不上。
    """
    length = int(total * SR) + SR // 2
    track = np.zeros(length, dtype=np.float64)
    for start, hold, semitone in notes:
        freq = midi_to_hz(semitone) / 2        # 低八度，垫在下面不抢人声
        begin = int(start * SR)
        duration = int(max(hold, 0.15) * SR * 1.4)
        if begin >= length:
            continue
        duration = min(duration, length - begin)
        if duration <= 0:
            continue
        t = np.arange(duration) / SR
        env = np.exp(-t * 2.2)
        wave = (np.sin(2 * np.pi * freq * t)
                + 0.35 * np.sin(2 * np.pi * freq * 2 * t)
                + 0.12 * np.sin(2 * np.pi * freq * 3 * t))
        track[begin:begin + duration] += wave * env * 0.12
    return track


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--lyrics", required=True, help="歌词文本，一行一句")
    parser.add_argument("--out", required=True, help="输出音频（.wav / .m4a）")
    parser.add_argument("--json", help="同时写出歌词时间轴 JSON（给 pack.json 用）")
    parser.add_argument("--voice", default="Vivian")
    parser.add_argument("--engine", default="auto")
    parser.add_argument("--speed", type=float, default=1.0)
    parser.add_argument("--instruct", default="少女音，音调偏高，清脆干净，语气天真烂漫")
    parser.add_argument("--tempo", type=float, default=84.0, help="每分钟拍数")
    parser.add_argument("--meter", default="4/4")
    parser.add_argument("--root", type=int, default=52,
                        help="主音 MIDI（52 = E3）。别往高调：她的说话基频在 236Hz 附近，"
                             "歌声音区落在 200~500Hz 最像真人；抬过一个八度会盖掉第一共振峰，听着发飘。")
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--vibrato", type=float, default=0.008, help="颤音深度，0 关闭")
    parser.add_argument("--gap", type=float, default=0.55, help="句间停顿秒数")
    parser.add_argument("--no-pad", action="store_true", help="不加垫底琶音")
    parser.add_argument("--keep-stems", action="store_true", help="保留每行清唱")
    parser.add_argument("--spoken-manifest",
                        help="已渲染好的每行语音清单（jsonl：id/path，按 id 排序）")
    args = parser.parse_args()

    with open(args.lyrics, encoding="utf-8") as handle:
        lines = [line.strip() for line in handle if line.strip()]
    if not lines:
        raise SystemExit("歌词是空的")

    beat = 60.0 / args.tempo
    meter = int(args.meter.split("/")[0])
    rng = np.random.default_rng(args.seed)
    # 五声音阶铺两个八度：C4~C6。主音落在这里，随机游走也被夹在梯子内，
    # 所以女声唱起来不会掉到男声区，也不会飙成尖叫。
    ladder = scale_ladder(args.root, octaves=2)

    work = tempfile.mkdtemp(prefix="sing-")
    if args.spoken_manifest:
        # 两段式：歌词先由 scripts/sing_from_lyrics.sh 在 bash 层渲染好。
        # 原因很实际——直接在这里 spawn TTS worker 会被沙箱按内存掐掉（Qwen3 要 2.4 GB）。
        print(f"[1/3] 复用已渲染语音 {args.spoken_manifest}", flush=True)
        entries = []
        with open(args.spoken_manifest, encoding="utf-8") as handle:
            for raw in handle:
                raw = raw.strip()
                if not raw:
                    continue
                item = json.loads(raw)
                if item.get("path"):
                    entries.append(item)
        entries.sort(key=lambda item: item.get("id", ""))
        spoken = [item["path"] for item in entries]
        if len(spoken) != len(lines):
            raise SystemExit(f"语音行数对不上：歌词 {len(lines)} 行，语音 {len(spoken)} 句")
    else:
        print(f"[1/3] 念歌词（{len(lines)} 句，{args.voice}）", flush=True)
        spoken = render_speech(lines, work, args.voice, args.instruct, args.engine, args.speed)

    print("[2/3] 换音高", flush=True)
    track = np.zeros(int((args.gap * len(lines) + 30.0) * SR), dtype=np.float64)
    timeline = []
    cursor = 0.0
    pad_notes: list[tuple[float, float, int]] = []
    step_position = 0
    for index, (line, path) in enumerate(zip(lines, spoken)):
        count = syllable_count(line)
        line_start = step_position
        notes, step_position = melody_for(count, step_position, meter, ladder, rng)
        # 音符位置是「全曲拍数」，但每一行都要从 0 开始算自己的时长，
        # 否则第二行会继承第一行的起点，越唱越长。
        notes = [(start - line_start, length, semitone) for start, length, semitone in notes]
        audio = sing_line(path, notes, beat, args.vibrato)
        if len(audio) == 0:
            print(f"  [skip] 第 {index + 1} 行没有浊音，跳过", flush=True)
            continue
        # 唱多久 = 说话多久。旋律贴着她的语速走，不强行拉长：
        # 拉伸要插值 sp/ap，会把周期性毁掉（浊音率 58%→14%，听着像气声噪音）。
        line_seconds = len(audio) / SR
        if notes:
            slot = line_seconds / len(notes)
            pad_notes += [(cursor + k * slot, slot, note[2])
                          for k, note in enumerate(notes)]
        begin = int(cursor * SR)
        if begin + len(audio) > len(track):
            track = np.pad(track, (0, begin + len(audio) - len(track) + SR))
        track[begin:begin + len(audio)] += audio * 0.9
        timeline.append({"at": round(cursor, 2), "zh": line})
        cursor += line_seconds + args.gap
        print(f"  [sing] {index + 1}/{len(lines)} 《{line}》 {count} 音 / "
              f"{line_seconds:.2f}s @ {cursor - args.gap - line_seconds:.2f}s", flush=True)

    total = cursor - args.gap + 0.8
    track = track[: int(total * SR)]
    if not args.no_pad:
        track += pad_track(total, pad_notes)[: len(track)] * 0.55
    # 收尾淡出，别让最后一下「啪」地断掉。
    fade = min(int(0.9 * SR), len(track))
    if fade > 0:
        track[-fade:] *= np.linspace(1, 0, fade)
    peak = float(np.max(np.abs(track))) or 1.0
    track = track / peak * 0.86

    print("[3/3] 写文件", flush=True)
    os.makedirs(os.path.dirname(os.path.abspath(args.out)) or ".", exist_ok=True)
    if args.out.lower().endswith(".m4a"):
        wav = os.path.join(work, "final.wav")
        sf.write(wav, track, SR, subtype="PCM_16")
        ffmpeg = os.environ.get("FFMPEG") or "/Users/exasdwyh/bin/ffmpeg"
        subprocess.run([ffmpeg, "-v", "error", "-y", "-i", wav,
                        "-c:a", "aac", "-b:a", "160k", args.out], check=True)
    else:
        sf.write(args.out, track, SR, subtype="PCM_16")
    print(f"  -> {args.out}  {total:.1f}s", flush=True)

    if args.json:
        payload = {"duration": round(total, 2), "tempo": args.tempo,
                   "meter": args.meter, "lyrics": timeline}
        with open(args.json, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2)
        print(f"  -> {args.json}  {len(timeline)} 行歌词", flush=True)
    if not args.keep_stems:
        for path in spoken:
            try:
                os.remove(path)
            except OSError:
                pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
