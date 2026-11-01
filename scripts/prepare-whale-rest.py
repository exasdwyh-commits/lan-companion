from pathlib import Path
import cv2,numpy as np,subprocess,json
base=Path(__file__).resolve().parents[1]
root=base/'assets/whale-bed-sleep'
c=cv2.VideoCapture(str(root/'source.mp4'));fs=[]
while True:
 ok,f=c.read()
 if not ok:break
 fs.append(f)
c.release()
cmd=['ffmpeg','-hide_banner','-loglevel','error','-f','rawvideo','-pix_fmt','bgr24','-s','1280x720','-r','24','-i','-','-an','-c:v','libx264','-preset','medium','-crf','17','-pix_fmt','yuv420p','-metadata','comment=AI-generated scene; visible marks repaired with clean source frames.',str(root/'sleep-repaired.mp4'),'-y']
p=subprocess.Popen(cmd,stdin=subprocess.PIPE)
m=np.zeros((720,1280),np.float32);m[630:700,1045:1268]=1;m=cv2.GaussianBlur(m,(11,11),2)[...,None]
t=np.zeros_like(m);t[:130,:270]=1;t=cv2.GaussianBlur(t,(11,11),2)[...,None]
for f in fs:
 r=np.clip(f*(1-m)+fs[108]*m,0,255).astype(np.uint8)
 r=np.clip(r*(1-t)+fs[0]*t,0,255).astype(np.uint8)
 p.stdin.write(r.tobytes())
p.stdin.close();assert p.wait()==0
# Derive an alpha matte from the gray-green screen: blue hair and white/skin remain foreground.
source=base/'assets/whale-sleepy-video/sleepy-temporal-repair-v1.mp4'
c=cv2.VideoCapture(str(source))
cmd=['ffmpeg','-hide_banner','-loglevel','error','-f','rawvideo','-pix_fmt','bgra','-s','1280x720','-r','24','-i','-','-an','-vf','format=yuva444p10le','-c:v','prores_ks','-profile:v','4','-alpha_bits','16',str(base/'assets/whale-video-test/quiet-idle.mov'),'-y']
p=subprocess.Popen(cmd,stdin=subprocess.PIPE)
while True:
 ok,f=c.read()
 if not ok:break
 b,g,r=cv2.split(f.astype(np.float32))
 e=np.minimum(g-r-4,g-b+1)
 z=np.clip(e/5,0,1);a=1-z*z*(3-2*z)
 # Keep the connected person, discarding isolated table/screen remnants.
 n,labels,stats,_=cv2.connectedComponentsWithStats((a>.7).astype(np.uint8),8)
 if n>1:
  person=(labels==(1+np.argmax(stats[1:,cv2.CC_STAT_AREA]))).astype(np.uint8)
  person=cv2.dilate(person,np.ones((7,7),np.uint8))
  a*=person
 a=cv2.GaussianBlur(a,(3,3),.5)
 spill=np.maximum(g-np.maximum(r,b),0)*(1-a)
 f[:,:,1]=np.clip(g-spill,0,255).astype(np.uint8)
 bgra=np.dstack((f,np.round(a*255).astype(np.uint8)))
 p.stdin.write(bgra.tobytes())
c.release();p.stdin.close();assert p.wait()==0
print('prepared bed sleep and transparent quiet idle')

# Rotate the loop boundary and blend the final half second into the opening.
for source, target, alpha in [
 (base/'assets/whale-video-test/quiet-idle.mov', base/'assets/whale-video-test/quiet-idle-loop.mov', True),
 (root/'sleep-repaired.mp4', base/'assets/whale-video-test/bed-sleep-loop.mp4', False),
]:
 duration=float(subprocess.check_output(['ffprobe','-v','error','-show_entries','stream=duration','-select_streams','v:0','-of','csv=p=0',str(source)]).decode().strip())
 d=.5
 filters=f'[0:v]split=3[b][t][h];[b]trim=start={d}:end={duration-d},setpts=PTS-STARTPTS[body];[t]trim=start={duration-d},setpts=PTS-STARTPTS[tail];[h]trim=end={d},setpts=PTS-STARTPTS[head];[tail][head]blend=all_expr=\'A*(1-T/{d})+B*T/{d}\'[join];[body][join]concat=n=2:v=1:a=0[out]'
 codec=['-c:v','prores_ks','-profile:v','4','-pix_fmt','yuva444p10le','-alpha_bits','16'] if alpha else ['-c:v','libx264','-crf','17','-pix_fmt','yuv420p']
 subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-i',str(source),'-filter_complex',filters,'-map','[out]','-an',*codec,'-y',str(target)],check=True)
