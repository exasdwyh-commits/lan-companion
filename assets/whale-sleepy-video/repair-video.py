from pathlib import Path
import cv2, numpy as np, subprocess, json
source=Path('/Users/exasdwyh/Downloads/绿幕视频制作（桌面宠物素材） (2).mp4')
out=Path('/Users/exasdwyh/Documents/VScode/vidu/desktop-companion/assets/whale-sleepy-video')
cap=cv2.VideoCapture(str(source)); fps=cap.get(cv2.CAP_PROP_FPS);frames=[]
while True:
 ok,f=cap.read()
 if not ok:break
 frames.append(f)
cap.release()
h,w=frames[0].shape[:2]
# One clean sleeve frame from the same video; local translation follows nearby fabric.
reference=frames[108]
x0,y0,x1,y1=990,550,1280,716
ref=reference[y0:y1,x0:x1]
refgray=cv2.cvtColor(ref,cv2.COLOR_BGR2GRAY).astype(np.float32)/255
valid=np.full(refgray.shape,255,np.uint8)
valid[628-y0:700-y0,1045-x0:1270-x0]=0
mask=np.zeros((h,w),np.float32);mask[630:694,1050:1264]=1
mask=cv2.GaussianBlur(mask,(11,11),2)[...,None]
# Top-left watermarks only touch uniform background. Derive the fill from nearby clean pixels.
raw=out/'repair-video-only.mp4'
cmd=['ffmpeg','-hide_banner','-loglevel','error','-f','rawvideo','-pix_fmt','bgr24','-s',f'{w}x{h}','-r',str(fps),'-i','-','-an','-c:v','libx264','-preset','medium','-crf','17','-pix_fmt','yuv420p','-movflags','+faststart',str(raw),'-y']
p=subprocess.Popen(cmd,stdin=subprocess.PIPE)
shifts=[]
for i,frame in enumerate(frames):
 result=frame.copy()
 if i<96:
  target=cv2.cvtColor(frame[y0:y1,x0:x1],cv2.COLOR_BGR2GRAY).astype(np.float32)/255
  warp=np.eye(2,3,dtype=np.float32)
  try:
   score,warp=cv2.findTransformECC(target,refgray,warp,cv2.MOTION_TRANSLATION,(cv2.TERM_CRITERIA_EPS|cv2.TERM_CRITERIA_COUNT,60,1e-5),valid,5)
   if not np.isfinite(warp).all() or np.max(np.abs(warp[:,2]))>12:warp=np.eye(2,3,dtype=np.float32)
  except cv2.error:warp=np.eye(2,3,dtype=np.float32)
  patch=cv2.warpAffine(reference,warp,(w,h),flags=cv2.INTER_LINEAR|cv2.WARP_INVERSE_MAP,borderMode=cv2.BORDER_REFLECT)
  result=np.clip(frame*(1-mask)+patch*mask,0,255).astype(np.uint8)
  shifts.append([i,float(warp[0,2]),float(warp[1,2])])
 # Same-background temporal patch removes the upper-left label without adding a new green shade.
 # Clean donor first frame has no text in this region.
 topmask=np.zeros((h,w),np.float32);topmask[0:150,0:270]=1
 topmask=cv2.GaussianBlur(topmask,(11,11),2)[...,None]
 result=np.clip(result*(1-topmask)+frames[0]*topmask,0,255).astype(np.uint8)
 p.stdin.write(result.tobytes())
p.stdin.close()
if p.wait()!=0:raise RuntimeError('ffmpeg failed')
subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-i',str(raw),'-i',str(source),'-map','0:v:0','-map','1:a:0?','-c','copy','-movflags','+faststart','-metadata','comment=AI-generated video. Visible marks repaired using clean frames from the same source; source retained.',str(out/'sleepy-temporal-repair-v1.mp4'),'-y'],check=True)
(out/'repair-parameters.json').write_text(json.dumps({'source':str(source),'frames':len(frames),'fps':fps,'donor_frame':108,'donor_seconds':108/fps,'repaired_frames':[0,95],'mask':[1050,630,214,64],'feather_sigma':2,'registration':'local ECC translation','shifts':shifts,'top_left':'same-source first-frame patch'},indent=2))
print('saved',out/'sleepy-temporal-repair-v1.mp4')
