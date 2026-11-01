// Real Three r128 geometry/bones, isolated DOM/canvas doubles; no renderer.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const ROOM=path.resolve(__dirname,'../MALFOY-ENGINE/web/moli-room');
const THREE=require(path.join(ROOM,'vendor/three.min.js'));
class Element {
 constructor(tag='div'){this.tagName=tag;this.dataset={};this.attributes={};this.children=[];this.queries=new Map();this.width=512;this.height=768;}
 setAttribute(k,v){this.attributes[k]=String(v);}getAttribute(k){return this.attributes[k];}
 append(...nodes){this.children.push(...nodes);}addEventListener(){}focus(){}
 querySelector(k){if(!this.queries.has(k))this.queries.set(k,new Element());return this.queries.get(k);}
 getContext(){return new Proxy({createLinearGradient(){return{addColorStop(){}};}},{get:(o,k)=>k in o?o[k]:()=>{}});}
}
function dom(){const elements=new Map();return {createElement:t=>new Element(t),querySelector(k){if(!elements.has(k))elements.set(k,new Element());return elements.get(k);},body:new Element('body')};}
function digest(a){return crypto.createHash('sha256').update(Buffer.from(a.buffer,a.byteOffset,a.byteLength)).digest('hex');}
function sourceModel(){const raw=fs.readFileSync(path.join(ROOM,'assets/lan-room/lan-v2-game.glb')),n=raw.readUInt32LE(12),doc=JSON.parse(raw.subarray(20,20+n)),bin=raw.subarray(28+n);
 function attr(i){const a=doc.accessors[i],b=doc.bufferViews[a.bufferView],C={5126:Float32Array,5125:Uint32Array,5123:Uint16Array}[a.componentType];return new C(bin.buffer,bin.byteOffset+(b.byteOffset||0)+(a.byteOffset||0),a.count*{SCALAR:1,VEC2:2,VEC3:3,VEC4:4}[a.type]).slice();}
 const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.BufferAttribute(attr(0),3));geo.setAttribute('normal',new THREE.BufferAttribute(attr(1),3));geo.setAttribute('uv',new THREE.BufferAttribute(attr(2),2));geo.setIndex(new THREE.BufferAttribute(attr(3),1));const m=new THREE.Mesh(geo,new THREE.MeshStandardMaterial());m.quaternion.fromArray(doc.nodes[0].rotation);const scene=new THREE.Group();scene.add(m);return {scene};
}
async function boot(stored='tide',rejectStorage=false){
 const document=dom(),values=new Map([['lan.room.wardrobe.v1',stored]]),localStorage={getItem:k=>{if(rejectStorage)throw Error('denied');return values.get(k);},setItem:(k,v)=>{if(rejectStorage)throw Error('denied');values.set(k,v);}};
 const T={...THREE,GLTFLoader:class{load(_,done){queueMicrotask(()=>done(sourceModel()));}}};
 const context={window:{THREE:T},document,localStorage,console,location:{search:''},TextDecoder,fetch:async url=>{const name=url.includes('contact-cuts')?'lan-v2-contact-cuts.bin':'lan-v2-skin.bin',b=fs.readFileSync(path.join(ROOM,'assets/lan-room',name));return{ok:true,arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)};}};
 for(const name of ['lan-model.js','lan-wardrobe.js','lan-book.js'])vm.runInNewContext(fs.readFileSync(path.join(ROOM,name),'utf8'),context);
 const scene=new THREE.Scene(),moli=new THREE.Group();scene.add(moli);moli.position.set(1,.5,-.8);moli.rotation.y=.65;moli.scale.setScalar(1.6);scene.updateMatrixWorld(true);
 const model=context.window.createLanModel({moli,rig:new THREE.Group()});await model.ready;
 let mesh;model.root.traverse(o=>{if(o.name==='lan-smooth-skin')mesh=o;});
 const before={};for(const k of ['position','normal','uv','skinIndex','skinWeight'])before[k]=digest(mesh.geometry.attributes[k].array);before.index=digest(mesh.geometry.index.array);
 const wardrobe=context.window.createLanWardrobe({model,THREE:T});assert.equal(await wardrobe.ready,true);
 return{context,scene,model,mesh,wardrobe,values,before};
}
const pose={y:0,pitch:-.15,roll:0,hl:{x:-.12,y:.24,z:.23},hr:{x:.12,y:.24,z:.23},fl:{x:-.083,y:-.166,z:.03},fr:{x:.083,y:-.166,z:.03},lhl:{x:0,y:.1,z:1},lhr:{x:0,y:.1,z:1}};
test('three outfits retain all original base vertices, contact cuts, UVs and four weights',async()=>{
 const {mesh,wardrobe,before}=await boot();
 for(const id of ['tide','mist','astral','tide'])assert.equal(wardrobe.select(id),true);
 for(const k of ['position','normal','uv','skinIndex','skinWeight'])assert.equal(digest(mesh.geometry.attributes[k].array),before[k],k);
 assert.equal(digest(mesh.geometry.index.array),before.index);assert.equal(mesh.skeleton.bones.length,12);assert.equal(mesh.material.skinning,true);
 assert.equal(wardrobe.select('missing'),false);assert.equal(wardrobe.state.id,'tide');
});
test('stored outfit is restored, card selection stays exclusive, storage denial stays usable',async()=>{
 const {wardrobe,values}=await boot('astral');assert.equal(wardrobe.state.id,'astral');wardrobe.select('mist');assert.equal(values.get('lan.room.wardrobe.v1'),'mist');
 const cards=wardrobe.panel.querySelector('.lw-cards').children;assert.equal(cards.filter(o=>o.attributes['aria-pressed']==='true').length,1);
 const denied=await boot('astral',true);assert.equal(denied.wardrobe.select('mist'),true);assert.equal(denied.wardrobe.state.storage,false);
});
test('capelets share the actual skeleton, use normalized finite weights and stay finite during poses',async()=>{
 const {model,mesh,scene,wardrobe}=await boot();
 for(const id of ['mist','astral']){wardrobe.select(id);let cape;model.root.traverse(o=>{if(o.isSkinnedMesh&&o!==mesh&&o.visible&&o.name.includes(id==='mist'?'capelet':'cape'))cape=o;});assert.ok(cape);assert.equal(cape.skeleton,mesh.skeleton);const w=cape.geometry.attributes.skinWeight;
 for(let i=0;i<w.count;i++){const sum=w.getX(i)+w.getY(i)+w.getZ(i)+w.getW(i);assert.ok(Math.abs(sum-1)<1e-6);}
 for(const pitch of [0,-.15,-Math.PI/2]){model.pose({...pose,pitch},null,1,1/60);scene.updateMatrixWorld(true);mesh.skeleton.update();const v=new THREE.Vector3();for(let i=0;i<cape.geometry.attributes.position.count;i+=23){v.fromBufferAttribute(cape.geometry.attributes.position,i);cape.boneTransform(i,v);assert.ok(v.toArray().every(Number.isFinite));}}
 }
});
test('hand anchors use the live lower-arm joints and remain finite through seated and lying poses',async()=>{
 const {model}=await boot();for(const pitch of [0,-.15,-Math.PI/2]){model.pose({...pose,pitch},null,2,1/60);const a=model.handAnchors();assert.ok(a.left.toArray().every(Number.isFinite));assert.ok(a.right.toArray().every(Number.isFinite));assert.ok(a.left.distanceTo(a.right)>.05);assert.ok(Math.abs(a.rotation.length()-1)<1e-6);}
 model.pose(pose,null,2,1/60,false);const normal=model.handAnchors();
 model.pose(pose,null,2,1/60,true);const grip=model.handAnchors();
 assert.ok(grip.left.distanceTo(grip.right)<normal.left.distanceTo(normal.right),'reading grip is narrower than the generic face-avoidance target');
 model.pose(pose,null,2,1/60,false);const restored=model.handAnchors();
 assert.ok(restored.left.distanceTo(normal.left)<1e-6);assert.ok(restored.right.distanceTo(normal.right)<1e-6);
});
test('hardback has two covers, curved pages, real page blocks and bookmark; turn finishes and reduced motion stops it',async()=>{
 const {context}=await boot(),book=context.window.createLanBook({THREE,kind:'se'}),names=[];book.traverse(o=>names.push(o.name));
 assert.equal(names.filter(x=>x==='hard-cover').length,2);for(const n of ['curved-printed-page','bound-spine','ribbon-bookmark','paper-edge','bound-page-block'])assert.ok(names.includes(n),n);
 const api=book.userData.lanBook;api.update(1,true,0);assert.ok(api.state.open>.99);assert.ok(api.state.thickness>.025);
 api.update(.05,true,.92);assert.equal(api.state.turning,true);let page;book.traverse(o=>{if(o.name==='flexing-paper')page=o;});assert.ok(page.geometry.attributes.position.array.some((x,i)=>i%3===2&&x>.001));
 api.update(1,true,0);assert.equal(api.state.turning,false);api.update(.1,false,0,true);assert.equal(api.state.open,0);assert.equal(api.state.turning,false);
});
