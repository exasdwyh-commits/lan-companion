"""Build reproducible geodesic skin weights for the existing generated Lan mesh.
Run from the project root. The GLB topology, texture and source file stay intact.
Requires numpy/scipy/Pillow; runtime only loads the resulting weight buffer.
"""
from pathlib import Path
import io,json,struct,hashlib
import numpy as np
from PIL import Image
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import dijkstra

ROOT=Path(__file__).resolve().parents[1]
MODEL=ROOT/'MALFOY-ENGINE/web/moli-room/assets/lan-room/lan-v2-game.glb'
OUT=MODEL.parent
raw=MODEL.read_bytes();ln=struct.unpack_from('<I',raw,12)[0];doc=json.loads(raw[20:20+ln]);buf=raw[28+ln:]
def attr(i):
 a=doc['accessors'][i];v=doc['bufferViews'][a['bufferView']]
 return np.frombuffer(buf,dtype={5126:'<f4',5125:'<u4',5123:'<u2'}[a['componentType']],count=a['count']*{'VEC3':3,'VEC2':2,'SCALAR':1}[a['type']],offset=v.get('byteOffset',0)+a.get('byteOffset',0)).reshape((a['count'],-1))
pos=attr(0).copy();pos=pos[:,[0,2,1]]*np.array([1,-1,1]);lo=pos.min(0);hi=pos.max(0);pos-=np.array([(lo[0]+hi[0])/2,lo[1],(lo[2]+hi[2])/2]);pos*=.78/(hi[1]-lo[1])
# The tail biases the full bounding-box centre; use the skull/torso centre.
pos[:,0]+=.039
tri=attr(3).ravel().reshape((-1,3));uv=attr(2)
view=doc['bufferViews'][doc['images'][1]['bufferView']];im=np.array(Image.open(io.BytesIO(buf[view['byteOffset']:view['byteOffset']+view['byteLength']])).convert('RGB'))/255
rgb=im[np.clip((uv[:,1]*im.shape[0]).astype(int),0,im.shape[0]-1),np.clip((uv[:,0]*im.shape[1]).astype(int),0,im.shape[1]-1)]
unique,reps,inv=np.unique(np.round(pos,5),axis=0,return_index=True,return_inverse=True);N=len(unique)
x,y,z=pos.T;ax=np.abs(x);r,g,b=rgb.T
# Semantic regions seed the geodesic solve. Unlike per-vertex color weights,
# colors select a region; they never directly modulate a moving vertex's weight.
labels=np.full(len(pos),1,dtype=int) # torso
labels[y<.255]=2 # apron/hem/tail
labels[(y<.155)&(ax<.115)&(z>-.05)&(z<.12)]=np.where(x[(y<.155)&(ax<.115)&(z>-.05)&(z<.12)]<0,5,6)
# The leg carve above stops at z<.12, so shoe tips that reach further forward fell
# into the apron region and rode the skirt bone — visibly twisting the shoes on
# every step. Claim the whole shoe volume for the legs (sign by foot).
shoe=(y<.095)&(ax<.118)&(z>-.02)&(z<.185)
labels[shoe]=np.where(x[shoe]<0,5,6)
arm=(y>.185)&(y<.375)&(ax>.095)&(ax<.205)&(z>-.04)&(z<.145)
labels[arm]=np.where(x[arm]<0,3,4)
hair=(y>.425)|((z<-.045)&(y>.205))|((b-r>.14)&(g>.24)&(ax>.105)&(y>.21))
labels[hair]=0
# Hand skin must remain a single moving region, including pale fingers/lace.
hand=(y>.185)&(y<.275)&(ax>.125)&(ax<.215)&(z>.025)&(z<.16)&(r>b*.9)
labels[hand]=np.where(x[hand]<0,3,4)
ulabels=labels[reps]
utri=inv[tri];edges=np.concatenate([utri[:,[0,1]],utri[:,[1,2]],utri[:,[2,0]]]);edges=np.unique(np.sort(edges,axis=1),axis=0);edges=edges[edges[:,0]!=edges[:,1]]
# Remove isolated texture speckles before separating fused contact surfaces.
from scipy.sparse import diags
adj=coo_matrix((np.ones(len(edges)*2),(np.r_[edges[:,0],edges[:,1]],np.r_[edges[:,1],edges[:,0]])),shape=(N,N)).tocsr()
for _ in range(6):
 votes=adj@np.eye(7)[ulabels]+np.eye(7)[ulabels]*3
 ulabels=votes.argmax(axis=1)
face_labels=ulabels[utri]
has_arm=np.isin(face_labels,[3,4]).any(axis=1)
contact=np.isin(face_labels,[0,2]).any(axis=1)
cut=has_arm&contact
cuts=np.flatnonzero(cut).astype('<u4')
(OUT/'lan-v2-contact-cuts.bin').write_bytes(cuts.tobytes())
utri=utri[~cut]
edges=np.concatenate([utri[:,[0,1]],utri[:,[1,2]],utri[:,[2,0]]]);edges=np.unique(np.sort(edges,axis=1),axis=0);edges=edges[edges[:,0]!=edges[:,1]]
length=np.linalg.norm(unique[edges[:,0]]-unique[edges[:,1]],axis=1)
graph=coo_matrix((np.r_[length,length],(np.r_[edges[:,0],edges[:,1]],np.r_[edges[:,1],edges[:,0]])),shape=(N,N)).tocsr()
# Erode seed borders, then solve distances ALONG the mesh. Nearby disconnected
# hair and sleeves do not exchange weights. Every transition has real surface width.
dist=[];counts=[]
for label in range(7):
 mask=ulabels==label
 boundary=np.unique(edges[(ulabels[edges[:,0]]==label)!=(ulabels[edges[:,1]]==label)])
 d=dijkstra(graph,directed=False,indices=boundary,min_only=True)
 seeds=np.flatnonzero(mask&(d>.012))
 if len(seeds)<8: seeds=np.flatnonzero(mask&(d>.004))
 if not len(seeds):raise RuntimeError(f'No interior seeds for part {label}')
 counts.append(len(seeds));dist.append(dijkstra(graph,directed=False,indices=seeds,min_only=True))
dist=np.array(dist).T
# Isolated source slivers without any seeded path follow the nearest spatial region.
bad=~np.isfinite(dist).any(axis=1)
if bad.any():
 from scipy.spatial import cKDTree
 nearest=cKDTree(unique[~bad]).query(unique[bad])[1];dist[bad]=dist[~bad][nearest]
dist=np.nan_to_num(dist,posinf=10);dist-=dist.min(axis=1,keepdims=True)
field=np.exp(-dist/.025);field/=field.sum(axis=1,keepdims=True)
# Compress semantic regions into the runtime's 12 anatomical bones.
def smooth(a,b,t):
 u=np.clip((t-a)/(b-a),0,1);return u*u*(3-2*u)
# The centre apron/chest never follows a hand merely because a generated
# contact provides a short path across its surface.
arm_mask=smooth(.06,.115,np.abs(unique[:,0]))
freed=field[:,3:5].sum(axis=1)*(1-arm_mask)
field[:,3:5]*=arm_mask[:,None]
hem=1-smooth(.18,.275,unique[:,1]);field[:,2]+=freed*hem;field[:,1]+=freed*(1-hem)
w=np.zeros((N,12));w[:,2]=field[:,0];w[:,1]=field[:,1];w[:,3]=field[:,2]
for s in (0,1):
 lower=1-smooth(.275,.332,unique[:,1]);w[:,4+s]=field[:,3+s]*(1-lower);w[:,6+s]=field[:,3+s]*lower
 lower=1-smooth(.075,.125,unique[:,1]);w[:,8+s]=field[:,5+s]*(1-lower);w[:,10+s]=field[:,5+s]*lower
order=np.argsort(-w,axis=1)[:,:4];values=np.take_along_axis(w,order,axis=1);values/=values.sum(axis=1,keepdims=True)
indices=order[inv].astype('<u2');values=values[inv].astype('<f4')
path=OUT/'lan-v2-skin.bin';path.write_bytes(b'LANSKIN1'+struct.pack('<II',len(pos),4)+indices.tobytes()+values.tobytes())
report={'modelSha256':hashlib.sha256(raw).hexdigest(),'vertices':len(pos),'weldedVertices':N,'bones':['lan-root','lan-spine','lan-head','lan-skirt',*[f'lan-arm-upper-{s}' for s in (0,1)],*[f'lan-arm-lower-{s}' for s in (0,1)],*[f'lan-leg-upper-{s}' for s in (0,1)],*[f'lan-leg-lower-{s}' for s in (0,1)]],'seedCounts':counts,'transitionScale':.025,'bytes':path.stat().st_size,'skinSha256':hashlib.sha256(path.read_bytes()).hexdigest()}
report['bodyCentreOffsetX']=.039
report['contactTrianglesRemoved']=len(cuts)
report['cutsSha256']=hashlib.sha256(cuts.tobytes()).hexdigest()
(OUT/'lan-v2-skin.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
