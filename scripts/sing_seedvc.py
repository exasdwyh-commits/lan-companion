#!/usr/bin/env python3
"""Local Seed-VC conversion. --singing uses the F0-conditioned 44kHz SVC model.

The speech tiny model remains available for historical experiments. Product
cover jobs always pass --singing; missing singing weights fail, never use TTS.
"""
from __future__ import annotations

import argparse
import glob
import os
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SEEDVC = os.path.join(ROOT, "third_party", "seed-vc")
WEIGHTS = os.path.join(ROOT, ".models", "seedvc")

# hifigan 的最后一步是 torch.istft，里面用到 aten::unfold_backward —— MPS 上没实现，
# 会直接抛 NotImplementedError。开 fallback 让它掉回 CPU 算这一步。
# 必须在 import torch 之前设，否则不生效。
os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")

# 文件名 → 本地权重。键是 hf 仓库里的原始文件名，值是 .models/seedvc 下的相对路径。
LOCAL = {
    "DiT_uvit_tat_xlsr_ema.pth": "seedvc/DiT_uvit_tat_xlsr_ema.pth",
    "config_dit_mel_seed_uvit_xlsr_tiny.yml": "seedvc/config_dit_mel_seed_uvit_xlsr_tiny.yml",
    "campplus_cn_common.bin": "campplus/campplus_cn_common.bin",
    "rmvpe.pt": "svc/rmvpe.pt",
    "hift.pt": "hifigan/hift.pt",
    "bigvgan_generator.pt": "bigvgan/bigvgan_generator.pt",
}


def local_weight(filename: str) -> str:
    rel = LOCAL.get(filename)
    if rel is None:
        raise SystemExit(f"没有为 {filename} 配置本地权重，见 scripts/fetch_sing_models.py")
    path = os.path.join(WEIGHTS, rel)
    if not os.path.exists(path):
        raise SystemExit(f"权重缺失：{path}（跑 python3 scripts/fetch_sing_models.py）")
    return path


def local_config(singing: bool = False) -> str:
    """把配置里的 speech_tokenizer.name 换成本地目录。

    不改的话 transformers 会去连 huggingface.co —— 这台机器连不上，会卡到超时。
    写出来的 local 配置放在权重目录旁边，不污染 third_party 里的原始文件。
    """
    import yaml

    source = os.path.join(WEIGHTS,"svc/config_dit_mel_seed_uvit_whisper_base_f0_44k.yml") if singing else local_weight("config_dit_mel_seed_uvit_xlsr_tiny.yml")
    with open(source, encoding="utf-8") as handle:
        config = yaml.safe_load(handle)
    tokenizer = config["model_params"]["speech_tokenizer"]
    if tokenizer.get("type") == "xlsr":
        tokenizer["name"] = os.path.join(WEIGHTS, "wav2vec2-xls-r-300m")
    if singing:
        tokenizer["name"] = os.path.join(WEIGHTS,"whisper-small")
        config["model_params"]["vocoder"]["name"] = os.path.join(WEIGHTS,"bigvgan44")
    target = os.path.join(os.path.dirname(source), "config_local.yml")
    with open(target, "w", encoding="utf-8") as handle:
        yaml.safe_dump(config, handle, allow_unicode=True, sort_keys=False)
    return target


def stub_dac() -> None:
    """让 `from dac.nn.quantize import VectorQuantize` 能过，但不装 audiotools。

    seed-vc 的 length_regulator 顶部无条件 import 了 VectorQuantize，可 tiny 模型的
    配置里 `vector_quantize: false`，这个类从头到尾没被实例化。而 descript-audio-codec
    的 `dac/__init__.py` 会连锁 import audiotools（几十个包，其中还要 ffmpeg 绑定）。
    为了一个用不到的符号拖一整套进来不值得 —— 先试真的，不成再挂个空壳。
    """
    try:
        import dac.nn.quantize  # noqa: F401
        return
    except Exception:  # noqa: BLE001 - audiotools 缺失/版本冲突都走兜底
        pass

    import types

    dac = types.ModuleType("dac")
    dac.__path__ = []          # 声明成空包，避免真的去执行 site-packages 里的 dac/__init__
    nn = types.ModuleType("dac.nn")
    nn.__path__ = []
    quantize = types.ModuleType("dac.nn.quantize")

    class VectorQuantize:      # 只有类名被引用，构造即报错，防止被悄悄用上
        def __init__(self, *args, **kwargs):
            raise RuntimeError("stub VectorQuantize: 需要装 descript-audio-codec + audiotools")

    quantize.VectorQuantize = VectorQuantize
    nn.quantize = quantize
    dac.nn = nn
    sys.modules.update({"dac": dac, "dac.nn": nn, "dac.nn.quantize": quantize})


def patch_mps_float64() -> None:
    """让 float64 张量在搬到 MPS 之前先降成 float32。

    Seed-VC 的 inference.py 在 f0_condition 分支写的是

        F0_ori = torch.from_numpy(F0_ori).to(device)[None]
        F0_alt = torch.from_numpy(F0_alt).to(device)[None]

    RMVPE 提取的 F0 是 float64 numpy，Apple 的 MPS 后端完全不支持 float64，
    于是 `.to(device)` 直接抛

        TypeError: Cannot convert a MPS Tensor to float64 dtype as the MPS
                   framework doesn't support float64.

    这就是翻唱一直「卡在人声分离之后」的真正原因 —— 不是慢，是崩了。

    上游自己的 app_svc.py 和 seed_vc_wrapper.py 在同样的位置都带了 `.float()`，
    只有 inference.py 漏了。直接改 third_party 的源码会在升级时被覆盖，
    所以沿用本文件既有的做法（autocast / load_custom_model_from_hf），
    在运行期打补丁：凡是目标是 MPS 且当前是 float64 的张量，先转 float32。
    F0 与音频用 float32 精度足够，不会改变默认音高。
    """
    import torch

    original_to = torch.Tensor.to

    def to(self, *args, **kwargs):  # type: ignore[no-untyped-def]
        device = kwargs.get("device")
        if device is None and args:
            device = args[0]

        is_mps = (isinstance(device, torch.device) and device.type == "mps") or (
            isinstance(device, str) and "mps" in device
        )
        if is_mps and self.dtype == torch.float64:
            self = self.float()
        return original_to(self, *args, **kwargs)

    torch.Tensor.to = to


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True, help="已分离的人声音轨")
    parser.add_argument("--singing", action="store_true", help="F0-conditioned 44kHz singing conversion")
    parser.add_argument("--ref", required=True, help="她的说话样本，决定输出音色")
    parser.add_argument("--out", required=True, help="输出路径（.wav）")
    parser.add_argument("--steps", type=int, default=30, help="扩散步数，25~50")
    parser.add_argument("--cfg-rate", type=float, default=0.7)
    parser.add_argument("--length-adjust", type=float, default=1.0)
    parser.add_argument("--semi-tone", type=int, default=0, help="整体升降调")
    args = parser.parse_args()

    for path in (args.source, args.ref):
        if not os.path.exists(path):
            raise SystemExit(f"找不到输入：{path}")
    if not os.path.isdir(os.path.join(SEEDVC, "modules")):
        raise SystemExit(f"缺少 Seed-VC 源码：{SEEDVC}")

    config = local_config(args.singing)
    checkpoint = os.path.join(WEIGHTS,"svc/DiT_seed_v2_uvit_whisper_base_f0_44k_bigvgan_pruned_ft_ema_v2.pth") if args.singing else local_weight("DiT_uvit_tat_xlsr_ema.pth")
    if not os.path.isfile(checkpoint):raise SystemExit("缺歌声转换权重：运行 scripts/fetch_svc_models.py")
    os.environ["HF_HUB_OFFLINE"]="1"
    os.environ["TRANSFORMERS_OFFLINE"]="1"

    sys.path.insert(0, SEEDVC)
    stub_dac()
    # hifigan.yml 和 modules 都是按相对路径引用的，必须站在仓库根上跑。
    os.chdir(SEEDVC)
    import inference  # noqa: E402  - 必须在 sys.path 与 cwd 就位之后

    def resolve_local(repo, filename, config_filename=None):  # noqa: ARG001
        return local_weight(filename)

    inference.load_custom_model_from_hf = resolve_local

    # torch 2.4 的 autocast 只认 cuda/cpu，传 'mps' 会直接抛
    # "User specified an unsupported autocast device_type 'mps'"。
    # inference.py 里那句 `with torch.autocast(device_type=device.type, ...)` 是硬编码的，
    # 与其改第三方源码（升级就丢），不如在这里把它换成空上下文 —— 反正我们都跑 fp32。
    import contextlib

    import torch

    torch.autocast = lambda *a, **k: contextlib.nullcontext()
    patch_mps_float64()

    work = tempfile.mkdtemp(prefix="seedvc-")
    job = argparse.Namespace(
        source=os.path.abspath(os.path.join(ROOT, args.source)),
        target=os.path.abspath(os.path.join(ROOT, args.ref)),
        output=work,
        diffusion_steps=args.steps,
        length_adjust=args.length_adjust,
        inference_cfg_rate=args.cfg_rate,
        f0_condition=args.singing,
        auto_f0_adjust=False,
        semi_tone_shift=args.semi_tone,
        checkpoint=checkpoint,
        config=config,
        # MPS 上开 fp16 autocast 会出 NaN，宁慢一点也别出杂音。
        fp16=False,
    )
    print(f"[seedvc] {os.path.basename(job.source)} -> {os.path.basename(job.target)}  "
          f"steps={args.steps}", flush=True)
    inference.main(job)

    produced = sorted(glob.glob(os.path.join(work, "vc_*.wav")))
    if not produced:
        raise SystemExit("Seed-VC 没有产出文件")
    out = os.path.abspath(os.path.join(ROOT, args.out))
    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    shutil.move(produced[-1], out)
    shutil.rmtree(work, ignore_errors=True)
    print(f"  -> {args.out}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
