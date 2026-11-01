#!/usr/bin/env python3
"""Multi-engine TTS worker.

stdin  : one JSON job per line  {"id", "text", "engine", "voice", "speed", "pitch"}
stdout : one JSON result per line {"id", "path", "seconds", "engine", "voice",
                                   "synthesis_seconds"}   or {"id", "error"}
stderr : model logs only (never parsed by the app)

Engines
  edgetts  Microsoft neural voices, free, no key. Needs network. Best quality.
  kokoro   Local mlx-community/Kokoro-82M-4bit. Offline. 8 Chinese voices, mixable.
  auto     Try edgetts, fall back to kokoro. Reported engine is the one that worked.

Everything that can fail degrades instead of crashing the persistent worker:
a bad job returns {"error": ...} and the loop keeps going.
"""
import argparse
import asyncio
import contextlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
import uuid
from pathlib import Path

os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")

# --------------------------------------------------------------------------
# voices
# --------------------------------------------------------------------------

# Allow-list. The voice string reaches the edge-tts API and a ffmpeg argv,
# so anything not listed here is rejected rather than passed through.
EDGE_VOICES = {
    # Mandarin, mainland
    "zh-CN-XiaoxiaoNeural": "女 · 温柔自然（微软旗舰，最像真人）",
    "zh-CN-XiaoyiNeural": "女 · 明亮活泼",
    "zh-CN-YunxiNeural": "男 · 清亮年轻",
    "zh-CN-YunyangNeural": "男 · 沉稳专业",
    "zh-CN-YunjianNeural": "男 · 浑厚，适合旁白",
    "zh-CN-YunxiaNeural": "男 · 少年感",
    "zh-CN-liaoning-XiaobeiNeural": "女 · 东北口音",
    "zh-CN-shaanxi-XiaoniNeural": "女 · 陕西口音",
    # Regional
    "zh-HK-HiuGaaiNeural": "女 · 粤语",
    "zh-TW-HsiaoChenNeural": "女 · 台湾腔",
}

# Every Chinese voice present in the Kokoro snapshot. Comma-separated names are
# averaged by the upstream pipeline, so "zf_xiaoni,zf_xiaoxiao" is a real blend;
# repeating a name approximates weighting ("a,a,b" ≈ 2:1).
KOKORO_VOICES = {
    "zf_xiaoxiao": "女 · 温柔清晰（Kokoro 中文公认最稳）",
    "zf_xiaoni": "女 · 柔软偏低",
    "zf_xiaobei": "女 · 明亮偏高",
    "zf_xiaoyi": "女 · 清亮",
    "zm_yunjian": "男 · 浑厚",
    "zm_yunxi": "男 · 年轻",
    "zm_yunxia": "男 · 少年",
    "zm_yunyang": "男 · 沉稳",
}

# Qwen3-TTS CustomVoice speakers. The ones that read Chinese are marked; the
# rest are included so a scene pack aimed at another language still works.
QWEN3_VOICES = {
    "Vivian": "女 · 活泼明亮，中文（最接近 18 岁少女）",
    "Serena": "女 · 温柔安静，中文",
    "Uncle_Fu": "男 · 成熟稳重，中文",
    "Dylan": "男 · 北京口音，中文",
    "Eric": "男 · 成都口音，中文",
    "Ryan": "男 · 英文",
    "Aiden": "男 · 英文",
    "Ono_Anna": "女 · 日文",
    "Sohee": "女 · 韩文",
}

def default_qwen3_model() -> str:
    """Qwen3 权重的解析顺序：显式指定 → 项目自带 → 旧缓存位置。

    `.runtime/models/qwen3-tts` 是「运行时收口」之后的位置，权重跟着项目走。
    `~/.cache/pet-tts/...` 是收口前的位置，留着是为了不打断还没迁移的机器。
    脚本被拷进 .app 的 Contents/Resources/ 之后算不出项目根，那条路由
    PetNeuralSpeech 用 PET_TTS_MODEL 传进来。
    """
    override = os.environ.get("PET_TTS_MODEL")
    if override:
        return override
    project = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    bundled = os.path.join(project, ".runtime", "models", "qwen3-tts")
    if os.path.isdir(bundled):
        return bundled
    return os.path.expanduser("~/.cache/pet-tts/Qwen3-TTS-CustomVoice-mlx-8bit")


# Used when the caller gives no instruct. Short on purpose: long style prompts
# make the model over-act and slow down.
DEFAULT_INSTRUCT = "温柔、自然，像十八岁的女孩，语速适中"

SAMPLE_RATE = 24000
MAX_TEXT = 5000


def ffmpeg() -> str | None:
    return shutil.which("ffmpeg") or (
        "/Users/exasdwyh/bin/ffmpeg"
        if os.path.isfile("/Users/exasdwyh/bin/ffmpeg")
        else None
    )


# --------------------------------------------------------------------------
# text cleanup — TTS engines read punctuation literally; models read digits badly
# --------------------------------------------------------------------------

_ZH_DIGITS = "零一二三四五六七八九"
_MARKDOWN = re.compile(r"[*_`#>~\[\]]+")


def _digits_to_zh(match: re.Match) -> str:
    """Small integers read as Chinese; anything else is left alone.

    Only handles 0-9999 and bare decimals. Percentages, times, long IDs and
    code-ish numbers keep their digits because a wrong guess is worse than an
    unpolished read.
    """
    raw = match.group(0)
    if "." in raw:
        return raw
    value = int(raw)
    if value > 9999:
        return raw
    if value < 10:
        return _ZH_DIGITS[value]
    if value < 20:
        return "十" + (_ZH_DIGITS[value - 10] if value % 10 else "")
    if value < 100:
        tens, ones = divmod(value, 10)
        return _ZH_DIGITS[tens] + "十" + (_ZH_DIGITS[ones] if ones else "")
    thousands, rest = divmod(value, 1000)
    out = _ZH_DIGITS[thousands] + "千"
    hundreds, rest = divmod(rest, 100)
    if hundreds:
        out += _ZH_DIGITS[hundreds] + "百"
    elif rest:
        out += "零"
    if rest:
        tens, ones = divmod(rest, 10)
        if tens:
            out += _ZH_DIGITS[tens] + "十"
        elif ones:
            out += "零"
        if ones:
            out += _ZH_DIGITS[ones]
    return out


def prepare(text: str) -> str:
    """Normalise chat text into something a voice model reads well."""
    out = _MARKDOWN.sub("", text)
    out = re.sub(r"\d+", _digits_to_zh, out)
    out = out.replace("…", "，").replace("——", "，")
    out = re.sub(r"[ \t]+", " ", out)
    out = re.sub(r"\n{2,}", "\n", out)
    # A trailing run of punctuation makes engines trail off or click.
    out = re.sub(r"[，。！？、,.!?]{2,}$", lambda m: m.group(0)[:1], out.strip())
    return out.strip()


# --------------------------------------------------------------------------
# engines
# --------------------------------------------------------------------------


class EdgeBackend:
    """Microsoft neural voices via edge-tts. One event loop for the process."""

    name = "edgetts"

    def __init__(self):
        self._comm = None  # module handle, imported lazily
        self._loop = None

    def _import(self):
        if self._comm is None:
            with contextlib.redirect_stdout(sys.stderr):
                import edge_tts
            self._comm = edge_tts
        return self._comm

    def available(self) -> bool:
        try:
            self._import()
            return True
        except Exception as exc:
            print(f"[pet-tts] edge-tts unavailable: {exc}", file=sys.stderr)
            return False

    def say(self, text: str, voice: str, speed: float, pitch: float, out: Path) -> None:
        edge_tts = self._import()
        # edge-tts takes relative rate/pitch, not an absolute speed multiplier.
        rate = f"{round((speed - 1.0) * 100):+d}%"
        pitch_hz = f"{round((pitch - 1.0) * 50):+d}Hz"

        async def run() -> None:
            comm = edge_tts.Communicate(
                text, voice, rate=rate, pitch=pitch_hz, volume="+0%"
            )
            await comm.save(str(out))

        if self._loop is None:
            self._loop = asyncio.new_event_loop()
        self._loop.run_until_complete(run())


class KokoroBackend:
    """Local offline Kokoro-82M. Weights load on first use, then stay warm."""

    name = "kokoro"

    def __init__(self, repo: str):
        self.repo = repo
        self._model = None

    def _load(self):
        if self._model is None:
            with contextlib.redirect_stdout(sys.stderr):
                import numpy  # noqa: F401  (imported for the error surface)
                from mlx_audio.tts.utils import load_model

                self._model = load_model(self.repo)
        return self._model

    def available(self) -> bool:
        try:
            self._load()
            return True
        except Exception as exc:
            print(f"[pet-tts] kokoro unavailable: {exc}", file=sys.stderr)
            return False

    def say(self, text: str, voice: str, speed: float) -> tuple[object, int]:
        """Returns (float32 ndarray, sample rate)."""
        import numpy as np

        model = self._load()
        with contextlib.redirect_stdout(sys.stderr):
            chunks = list(
                model.generate(text=text, voice=voice, lang_code="z", speed=speed)
            )
        if not chunks:
            raise ValueError("Empty synthesis")
        audio = np.concatenate(
            [np.asarray(c.audio, dtype=np.float32).reshape(-1) for c in chunks]
        )
        return audio, int(chunks[0].sample_rate or SAMPLE_RATE)


class Qwen3Backend:
    """Qwen3-TTS CustomVoice: preset speakers plus a free-form style prompt.

    This is the only engine here that can act — `instruct` changes delivery,
    which edge-tts and Kokoro cannot do at all.
    """

    name = "qwen3"

    def __init__(self, repo: str):
        self.repo = repo
        self._model = None

    def _load(self):
        if self._model is None:
            with contextlib.redirect_stdout(sys.stderr):
                from mlx_audio.tts.utils import load_model

                self._model = load_model(self.repo)
        return self._model

    def available(self) -> bool:
        return os.path.isdir(self.repo)

    def say(self, text: str, voice: str, instruct: str) -> tuple[object, int]:
        import numpy as np

        model = self._load()
        kwargs = {"text": text, "speaker": voice, "language": "Chinese"}
        if instruct:
            kwargs["instruct"] = instruct
        with contextlib.redirect_stdout(sys.stderr):
            chunks = list(model.generate_custom_voice(**kwargs))
        if not chunks:
            raise ValueError("Empty synthesis")
        audio = np.concatenate(
            [np.asarray(c.audio, dtype=np.float32).reshape(-1) for c in chunks]
        )
        return audio, int(chunks[0].sample_rate or SAMPLE_RATE)


# --------------------------------------------------------------------------
# output shaping
# --------------------------------------------------------------------------


def loudnorm_to_wav(src: Path, dst: Path, target_i: float = -20.0,
                    gain_db: float = 0.0) -> bool:
    """Loudness-normalise so every engine comes out at the same level.

    Default -20 LUFS (4 dB under the old -16): a desktop pet sits inches from
    the user all day, and -16 LUFS is mixed-for-video loud. `gain_db` is an
    extra trim on top, for people who want it quieter still.

    Returns False when ffmpeg is missing; the caller then keeps the source file.
    """
    exe = ffmpeg()
    if not exe:
        return False
    chain = f"loudnorm=I={target_i}:TP=-1.5:LRA=11"
    if abs(gain_db) > 0.01:
        chain += f",volume={gain_db}dB"
    proc = subprocess.run(
        [
            exe, "-y", "-loglevel", "error", "-i", str(src),
            "-af", chain,
            "-ar", str(SAMPLE_RATE), "-ac", "1", "-c:a", "pcm_s16le", str(dst),
        ],
        capture_output=True,
    )
    if proc.returncode != 0:
        print(f"[pet-tts] ffmpeg: {proc.stderr.decode(errors='replace')[:300]}",
              file=sys.stderr)
        return False
    return dst.is_file()


def write_normalised(audio, rate: int, dst: Path, gain_db: float = 0.0) -> float:
    """Normalise to about -6 dBFS peak (-3 is harsh on a near-field speaker),
    then apply `gain_db` on top. Cheap and dependency-free."""
    import numpy as np
    import soundfile as sf

    peak = float(np.max(np.abs(audio))) if audio.size else 0.0
    if peak > 1e-6:
        gain = min(0.5 / peak, 8.0)  # never amplify noise more than 8x
        audio = audio * gain
    if abs(gain_db) > 0.01:
        audio = audio * (10.0 ** (gain_db / 20.0))
    sf.write(dst, audio, rate)
    return len(audio) / rate


def seconds_of(path: Path) -> float:
    probe = shutil.which("ffprobe") or "/opt/homebrew/bin/ffprobe"
    if not (os.path.isfile(probe) if probe.startswith("/") else True):
        return 0.0
    try:
        out = subprocess.run(
            [probe, "-v", "error", "-show_entries", "format=duration",
             "-of", "csv=p=0", str(path)],
            capture_output=True, text=True, timeout=10,
        ).stdout.strip()
        return float(out) if out else 0.0
    except Exception:
        return 0.0


# --------------------------------------------------------------------------
# main loop
# --------------------------------------------------------------------------


def resolve_voice(engine: str, voice: str | None, default: str) -> str:
    voice = (voice or default).strip()
    table = {"edgetts": EDGE_VOICES, "kokoro": KOKORO_VOICES,
             "qwen3": QWEN3_VOICES}.get(engine, KOKORO_VOICES)
    if voice in table:
        return voice
    # A blend is only legal for Kokoro, and every part must be known.
    if engine == "kokoro" and "," in voice:
        parts = [p for p in voice.split(",") if p]
        if parts and all(p in KOKORO_VOICES for p in parts):
            return ",".join(parts)
    raise ValueError(f"Unsupported voice for {engine}: {voice}")


def main() -> int:
    ap = argparse.ArgumentParser(description="Persistent multi-engine TTS worker")
    ap.add_argument("outdir", help="directory for rendered audio (mode 0700)")
    ap.add_argument("--engine", default="auto",
                    choices=["auto", "edgetts", "kokoro"])
    ap.add_argument("--voice", default="zh-CN-XiaoxiaoNeural",
                    help="default voice; ignored if the job names one")
    ap.add_argument("--speed", type=float, default=1.0)
    ap.add_argument("--gain", type=float, default=0.0,
                    help="extra output trim in dB, -30..12 (negative = quieter)")
    ap.add_argument("--lufs", type=float, default=-20.0,
                    help="edge-tts loudness target in LUFS (default -20, "
                         "quieter than the -16 broadcast norm)")
    ap.add_argument("--pitch", type=float, default=1.0)
    ap.add_argument("--kokoro-repo", default="mlx-community/Kokoro-82M-4bit")
    ap.add_argument("--qwen3-model", default=default_qwen3_model(),
                    help="local MLX directory for Qwen3-TTS CustomVoice")
    ap.add_argument("--instruct", default="",
                    help="default Qwen3 style prompt; empty means DEFAULT_INSTRUCT")
    ap.add_argument("--offline", action="store_true",
                    help="treat 'auto' as kokoro-only (skip network)")
    ap.add_argument("--warm", action="store_true",
                    help="load Qwen3 weights at startup so the first line is not 13s late")
    ap.add_argument("--list-voices", action="store_true")
    args = ap.parse_args()

    if args.list_voices:
        print(json.dumps({"qwen3": QWEN3_VOICES, "edgetts": EDGE_VOICES,
                          "kokoro": KOKORO_VOICES}, ensure_ascii=False, indent=2))
        return 0

    root = Path(args.outdir)
    root.mkdir(parents=True, exist_ok=True, mode=0o700)

    edge = EdgeBackend()
    kokoro = KokoroBackend(args.kokoro_repo)
    qwen3 = Qwen3Backend(args.qwen3_model)

    if args.warm and qwen3.available():
        # Blocking on purpose: this runs on a background warm-up, and the point
        # is that the model is hot before the user says anything.
        try:
            t0 = time.monotonic()
            qwen3.say("warm up", "Vivian", DEFAULT_INSTRUCT)
            print(f"[pet-tts] qwen3 warm in {time.monotonic()-t0:.1f}s", file=sys.stderr, flush=True)
        except Exception as exc:
            print(f"[pet-tts] qwen3 warm failed: {exc}", file=sys.stderr, flush=True)

    for line in sys.stdin:
        job = {}
        try:
            job = json.loads(line)
            token = str(uuid.UUID(job["id"]))
            text = prepare(str(job.get("text", "")).strip())
            if not text or len(text) > MAX_TEXT:
                raise ValueError("Invalid text length")

            want = str(job.get("engine") or args.engine).lower()
            speed = float(job.get("speed") or args.speed)
            if not 0.5 <= speed <= 2.0:
                speed = args.speed
            pitch = float(job.get("pitch") or args.pitch)
            if not 0.5 <= pitch <= 2.0:
                pitch = args.pitch
            voice_raw = job.get("voice") or args.voice
            instruct = str(job.get("instruct") or args.instruct or "").strip()
            gain_db = float(job.get("gain") if job.get("gain") is not None
                            else args.gain)
            if not -30.0 <= gain_db <= 12.0:
                gain_db = args.gain

            start = time.monotonic()
            wav = root / f"{token}.wav"
            used = None

            plan = []
            if want == "auto":
                # Best first, cheapest-last. Kokoro is the only offline option,
                # so it stays in the chain even when everything else works.
                plan.append("qwen3")
                if not args.offline:
                    plan.append("edgetts")
                plan.append("kokoro")
            else:
                plan.append(want)

            last_error = None
            for engine in plan:
                try:
                    if engine == "qwen3":
                        voice = resolve_voice("qwen3", voice_raw, args.voice)
                        audio, rate = qwen3.say(text, voice, instruct or DEFAULT_INSTRUCT)
                        write_normalised(audio, rate, wav, gain_db)
                        used = "qwen3"
                    elif engine == "edgetts":
                        voice = resolve_voice("edgetts", voice_raw, args.voice)
                        mp3 = root / f"{token}.mp3"
                        edge.say(text, voice, speed, pitch, mp3)
                        if loudnorm_to_wav(mp3, wav, args.lufs, gain_db):
                            mp3.unlink(missing_ok=True)
                        else:
                            wav = mp3  # no ffmpeg: hand back the mp3 as-is
                        used = "edgetts"
                    else:
                        # An edge-tts voice name is meaningless to Kokoro.
                        voice = resolve_voice(
                            "kokoro",
                            voice_raw if voice_raw in KOKORO_VOICES or "," in str(voice_raw)
                            else None,
                            "zf_xiaoxiao",
                        )
                        audio, rate = kokoro.say(text, voice, speed)
                        write_normalised(audio, rate, wav, gain_db)
                        used = "kokoro"
                    last_error = None
                    break
                except Exception as exc:
                    last_error = exc
                    print(f"[pet-tts] {engine} failed: {exc}", file=sys.stderr)
                    continue

            if used is None:
                raise last_error or ValueError("No TTS engine available")

            print(json.dumps({
                "id": token,
                "path": str(wav),
                "seconds": seconds_of(wav),
                "engine": used,
                "voice": voice,
                "synthesis_seconds": round(time.monotonic() - start, 3),
            }), flush=True)
        except Exception as exc:
            print(json.dumps({"id": job.get("id"), "error": str(exc)}), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
