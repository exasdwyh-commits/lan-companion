#!/usr/bin/env python3
"""Fetch the exact F0 singing model used by vendored Seed-VC, into project assets cache."""
import argparse, json, os, shutil, urllib.request
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];BASE=ROOT/'.models/seedvc'
FILES=[
 ('Plachta/Seed-VC','DiT_seed_v2_uvit_whisper_base_f0_44k_bigvgan_pruned_ft_ema_v2.pth','svc/DiT_seed_v2_uvit_whisper_base_f0_44k_bigvgan_pruned_ft_ema_v2.pth'),
 ('lj1995/VoiceConversionWebUI','rmvpe.pt','svc/rmvpe.pt'),
 ('openai/whisper-small','config.json','whisper-small/config.json'),
 ('openai/whisper-small','preprocessor_config.json','whisper-small/preprocessor_config.json'),
 ('openai/whisper-small','model.safetensors','whisper-small/model.safetensors'),
 ('nvidia/bigvgan_v2_44khz_128band_512x','config.json','bigvgan44/config.json'),
 ('nvidia/bigvgan_v2_44khz_128band_512x','bigvgan_generator.pt','bigvgan44/bigvgan_generator.pt'),
]
def ranges(url,dest,size):
    import concurrent.futures
    chunks=dest.parent/(dest.name+'.chunks');chunks.mkdir(exist_ok=True)
    span=16*1024*1024
    def part(start):
        end=min(size,start+span)-1;file=chunks/str(start);expected=end-start+1
        if file.is_file() and file.stat().st_size==expected:return file
        for attempt in range(8):
            try:
                req=urllib.request.Request(url+f'?segment={start}',headers={'Range':f'bytes={start}-{end}','Accept-Encoding':'identity'})
                with urllib.request.urlopen(req,timeout=40) as r:
                    if r.status!=206 or r.headers.get('Content-Range')!=f'bytes {start}-{end}/{size}':raise ValueError('Range mismatch')
                    with file.open('wb') as f:shutil.copyfileobj(r,f,1024*1024)
                if file.stat().st_size!=expected:raise ValueError('Truncated range')
                return file
            except Exception:
                if attempt==7:raise
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:files=list(pool.map(part,range(0,size,span)))
    partial=dest.with_suffix(dest.suffix+'.partial')
    with partial.open('wb') as out:
        for file in files:
            with file.open('rb') as src:shutil.copyfileobj(src,out,1024*1024)
    if partial.stat().st_size!=size:raise ValueError('Truncated result')
    os.replace(partial,dest);shutil.rmtree(chunks)

def download(repo,name,rel):
    url=f'https://huggingface.co/{repo}/resolve/main/{name}';dest=BASE/rel
    req=urllib.request.Request(url,method='HEAD')
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req,timeout=30) as r:size=int(r.headers.get('Content-Length',0))
            break
        except Exception:
            if attempt==4:raise
    if not size and not name.endswith('.json'):raise ValueError(f'Missing length: {rel}')
    if dest.is_file() and ((size and dest.stat().st_size==size) or (not size and json.loads(dest.read_text()))):return {'file':rel,'bytes':size,'source':url}
    dest.parent.mkdir(parents=True,exist_ok=True);partial=dest.with_suffix(dest.suffix+'.partial')
    if size>64*1024*1024:
        ranges(url,dest,size);print(f'[ready] {rel} {size//1048576}MB',flush=True);return {'file':rel,'bytes':size,'source':url}
    for attempt in range(3):
        try:
            with urllib.request.urlopen(url,timeout=60) as r,partial.open('wb') as f:
                shutil.copyfileobj(r,f,1024*1024)
            if size and partial.stat().st_size!=size:raise ValueError('Truncated download')
            if name.endswith('.json'):json.loads(partial.read_text())
            os.replace(partial,dest);print(f'[ready] {rel} {size//1048576}MB',flush=True)
            return {'file':rel,'bytes':size,'source':url}
        except Exception:
            if attempt==2:raise
    raise RuntimeError(rel)
def main():
    import concurrent.futures
    parser=argparse.ArgumentParser();parser.add_argument('--check',action='store_true');args=parser.parse_args()
    config=BASE/'svc/config_dit_mel_seed_uvit_whisper_base_f0_44k.yml'
    if args.check:
        missing=[rel for _,_,rel in FILES if not (BASE/rel).is_file()]
        if not config.is_file():missing.append(str(config.relative_to(BASE)))
        print(json.dumps({'ready':not missing,'missing':missing}));return bool(missing)
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:manifest=list(pool.map(lambda row:download(*row),FILES))
    config.parent.mkdir(parents=True,exist_ok=True)
    shutil.copy2(ROOT/'third_party/seed-vc/configs/presets/config_dit_mel_seed_uvit_whisper_base_f0_44k.yml',config)
    (BASE/'svc/sources.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print('[ready] F0 singing model, RMVPE, Whisper and 44kHz vocoder',flush=True)
    return 0
if __name__=='__main__':raise SystemExit(main())
