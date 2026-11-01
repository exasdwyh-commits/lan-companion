#!/usr/bin/env python3
"""Extract generated grid frames, normalize canvas and encode alpha VP9.
No invented in-between poses or background keying: the generated alpha is preserved.
"""
import hashlib,json,subprocess,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
PACK=ROOT/'assets/dsh-pet-desktop-v1'
CONFIG=json.loads((PACK/'generated/spec.json').read_text())
import argparse
parser=argparse.ArgumentParser();parser.add_argument('--only',nargs='*');args=parser.parse_args()
rows=json.loads((PACK/'generated.json').read_text()) if (PACK/'generated.json').exists() else {}
for key,spec in CONFIG.items():
 if args.only and key not in args.only: continue
 filename,label,fps,order,repeats,anchor=(spec[k] for k in ['file','label','fps','order','repeats','anchorY'])
 src=PACK/'generated'/filename
 # PNG dimensions from its standard IHDR; no external imaging dependency.
 import struct
 w,h=struct.unpack('>II',src.read_bytes()[16:24]);cw,ch=w//4,h//2
 with tempfile.TemporaryDirectory(prefix='lan-sprites-') as tmp:
  for i,idx in enumerate(order):
   subprocess.run(['ffmpeg','-v','error','-i',str(src),'-vf',f'format=rgba,crop={cw}:{ch}:{idx%4*cw}:{idx//4*ch},scale=284:284:flags=lanczos,pad=640:360:178:46:color=black@0','-frames:v','1','-y',f'{tmp}/{i:02d}.png'],check=True)
  subprocess.run(['ffmpeg','-v','error','-stream_loop',str(repeats-1),'-framerate',str(fps),'-i',f'{tmp}/%02d.png','-c:v','libvpx-vp9','-pix_fmt','yuva420p','-b:v','0','-crf','24','-auto-alt-ref','0','-an','-y',str(PACK/(key+'.webm'))],check=True)
 rows[key]={'file':key+'.webm','label':label,'sourceFile':'generated/'+filename,'sourceSha256':hashlib.sha256(src.read_bytes()).hexdigest(),'method':'built-in imagegen, reference-conditioned sprite sequence; not continuous video generation','frameCount':len(order),'frameOrder':order,'fps':fps,'repeats':repeats,'anchorY':anchor,'license':'Derivative of dsh-pet character, CC BY-NC-SA 4.0; retain upstream attribution','category':spec['category'],'promptSummary':spec.get('promptSummary','See generated/README.md for original prompt')}
(PACK/'generated.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n')
print(f'{len(rows)} generated animations registered; run prepare-dsh-desktop.py to mirror.')
