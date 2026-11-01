#!/usr/bin/env python3
"""量一下「音色到底换过去没有」。

Seed-VC 内部用 campplus 说话人模型把参考音频压成 192 维 embedding，再喂给扩散模型
决定「是谁在唱」。所以同一套 embedding 可以直接当尺子用：

    源人声 ──换声──> 输出
      │                │
      └── 与参考的距离 ─┘

如果 cos(输出, 参考) 只比 cos(源, 参考) 高一点点，说明换声几乎没起作用 —— 那时候
再怎么调 SHAPE / 升调 / cfg 都是白费，得换模型，不是调参数。

用法：
    python scripts/speaker-similarity.py 参考.wav 源人声.wav 输出.wav
会打印两两余弦相似度矩阵（值域 -1~1，同一说话人通常 >0.6）。
"""
from __future__ import annotations

import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SEEDVC = os.path.join(ROOT, "third_party", "seed-vc")
CKPT = os.path.join(ROOT, ".models", "seedvc", "campplus", "campplus_cn_common.bin")


def load_wav16k(path: str):
    """统一成 16k 单声道 —— campplus 是按 16k fbank 训练的，采样率错了相似度会失真。"""
    import librosa
    import numpy as np

    audio, _ = librosa.load(path, sr=16000, mono=True)
    if audio.size == 0:
        raise SystemExit(f"读不出音频：{path}")
    peak = float(np.abs(audio).max())
    if peak > 0:
        audio = audio / peak * 0.9
    return audio


def embed(model, audio):
    import torch
    import torchaudio

    feat = torchaudio.compliance.kaldi.fbank(
        torch.from_numpy(audio).float().unsqueeze(0),
        num_mel_bins=80,
        dither=0,
        sample_frequency=16000,
    )
    feat = feat - feat.mean(dim=0, keepdim=True)
    with torch.no_grad():
        emb = model(feat.unsqueeze(0))
    return emb.squeeze(0)


def main() -> int:
    files = [a for a in sys.argv[1:] if not a.startswith("-")]
    if len(files) < 2:
        print(__doc__)
        return 2

    sys.path.insert(0, SEEDVC)
    os.chdir(SEEDVC)
    import torch

    from modules.campplus.DTDNN import CAMPPlus

    if not os.path.exists(CKPT):
        raise SystemExit(f"缺 campplus 权重：{CKPT}")
    model = CAMPPlus(feat_dim=80, embedding_size=192)
    model.load_state_dict(torch.load(CKPT, map_location="cpu"))
    model.eval()

    names, embs = [], []
    for path in files:
        if not os.path.exists(path):
            raise SystemExit(f"找不到音频：{path}")
        names.append(os.path.basename(path))
        embs.append(embed(model, load_wav16k(path)))

    # 参考在第一个，源第二个，输出第三个 —— 先算「换声前后离参考多远」这一组结论
    def cos(i, j):
        a, b = embs[i], embs[j]
        return float(torch.dot(a, b) / (a.norm() * b.norm()))

    if len(files) >= 3:
        before, after = cos(1, 0), cos(2, 0)
        print(f"换成参考的音色前: cos(源, 参考) = {before:.3f}")
        print(f"换成参考的音色后: cos(输出, 参考) = {after:.3f}")
        print(f"提升 {after - before:+.3f}")
        if after - before < 0.05:
            print("→ 结论：换声几乎没起作用。调参数无效，需要换模型/换参考。")
        elif after - before < 0.15:
            print("→ 结论：换声有效但很弱，听感上仍会像原唱。")
        else:
            print("→ 结论：换声生效，音色确实被拉向参考。")

    print()
    print("余弦相似度矩阵：")
    print("        " + "  ".join(f"{n[:10]:>10s}" for n in names))
    for i, name in enumerate(names):
        print(f"{name[:8]:>8s}" + "  ".join(f"{cos(i, j):10.3f}" for j in range(len(names))))
    return 0


if __name__ == "__main__":
    sys.exit(main())
