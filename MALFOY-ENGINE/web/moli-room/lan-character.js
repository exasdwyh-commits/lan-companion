/* Lan's procedural 3D costume. Scene choreography and IK remain moli-room's. */
(function () {
'use strict';
window.createLanCharacter = function ({ rig, body, eye, xmark, arms, legs, hands, feet, thumbs, jellied }) {
  const T = window.THREE, V = (x,y,z) => new T.Vector3(x,y,z);
  const color = h => new T.Color(h).convertSRGBToLinear();
  const material = (h, roughness=0.6, metalness=0) => new T.MeshStandardMaterial({color:color(h),roughness,metalness});
  const skin=material(0xffdecf), ivory=material(0xfff8ee), blue=material(0x344b8d), hairBlue=material(0x4466b1,0.4), hairLight=material(0x79b9e8,0.4);
  const hairDark=material(0x30477e,0.45), navy=material(0x26365f), gold=material(0xd5b680,0.35,0.5), iris=material(0x5089c9,0.25), irisLight=material(0x9bdef1,0.3);
  const sock=material(0xbcd4ec,0.72), shoe=material(0xf4f1ea,0.6);
  const dark=material(0x202c50), shine=new T.MeshBasicMaterial({color:color(0xffffff)});
  const group = (parent, x=0,y=0,z=0) => {const g=new T.Group();g.position.set(x,y,z);parent.add(g);return g;};
  const mesh = (geo,mat,parent,x=0,y=0,z=0) => {const m=new T.Mesh(geo,mat);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;};
  const ball = (parent,mat,x,y,z,rx,ry,rz) => {const m=mesh(new T.SphereGeometry(1,24,16),mat,parent,x,y,z);m.scale.set(rx,ry,rz);return m;};
  const tube = (parent,points,r,mat) => mesh(new T.TubeGeometry(new T.CatmullRomCurve3(points.map(p=>V(...p))),24,r,7,false),mat,parent);
  // Elliptical swept strands, with real depth and tapered tips at every angle.
  function strand(parent, points, widths, depth, mat) {
    const c=new T.CatmullRomCurve3(points.map(p=>V(...p))), n=28, k=10, f=c.computeFrenetFrames(n,false), pos=[],ids=[];
    for(let i=0;i<=n;i++) {const u=i/n, q=c.getPointAt(u), a=u*(widths.length-1), j=Math.min(widths.length-2,Math.floor(a)), w=T.MathUtils.lerp(widths[j],widths[j+1],a-j);
      for(let s=0;s<=k;s++) {const ang=s/k*Math.PI*2,p=q.clone().addScaledVector(f.normals[i],Math.cos(ang)*depth*Math.min(1,w/0.008)).addScaledVector(f.binormals[i],Math.sin(ang)*w);pos.push(p.x,p.y,p.z);}
    }
    for(let i=0;i<n;i++)for(let s=0;s<k;s++){const a=i*(k+1)+s,b=a+k+1;ids.push(a,a+1,b,b,a+1,b+1);}
    const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(pos,3));geo.setIndex(ids);geo.computeVertexNormals();return mesh(geo,mat,parent);
  }
  /* A fin ear: a narrow leaf off the crown, angled up and back so it clears the
     hair cap and still reads from behind. The leaf is drawn along +x, so a
     mirrored group gives the other side. */
  function finEar(parent, side, x, y, z, size=1) {
    const g=group(parent,x,y,z); g.scale.set(side*size,size,size);
    g.rotation.set(0, side*0.62, side*0.62);
    const s=new T.Shape(); s.moveTo(.004,.006);
    s.bezierCurveTo(.032,.034,.082,.058,.116,.026);
    s.bezierCurveTo(.090,.006,.052,-.014,.014,-.024); s.closePath();
    mesh(new T.ExtrudeGeometry(s,{depth:.011,bevelEnabled:true,bevelThickness:.004,bevelSize:.0035,bevelSegments:2,curveSegments:18}),hairDark,g);
    const inner=mesh(new T.ShapeGeometry(s,18),ivory,g,0,-.004,.018); inner.scale.set(.86,.62,1);
    for(let j=0;j<2;j++)tube(g,[[.014,-.006,.022],[.048+j*.012,.004,.023],[.070+j*.012,.017,.021]],.0016,hairLight);
    return g;
  }
  /* A whale fluke: a flat, swept leaf that opens sideways. Both halves stay
     level with each other, so it reads as a tail and not a pair of wings. */
  function fluke(parent, side, x, y, z) {
    const g=group(parent,x,y,z); g.scale.x=side; g.rotation.z=side*.11;
    const s=new T.Shape(); s.moveTo(.006,.016);
    s.bezierCurveTo(.055,.052,.125,.066,.182,.022);
    s.bezierCurveTo(.150,.012,.088,-.014,.022,-.030); s.closePath();
    const geo=new T.ExtrudeGeometry(s,{depth:.013,bevelEnabled:true,bevelThickness:.005,bevelSize:.004,bevelSegments:2,curveSegments:20});
    geo.rotateX(-Math.PI/2);                                  // lay it flat: the shape's y becomes -z
    mesh(geo,hairBlue,g);
    const under=mesh(geo,ivory,g,0,-.019,0); under.scale.set(.95,1,.95);
    return g;
  }
  function bow(parent,x,y,z,size=1) {
    const b=group(parent,x,y,z);b.scale.setScalar(size);
    for(const side of [-1,1]){const l=ball(b,navy,side*.027,0,0,.031,.019,.012);l.rotation.z=side*.35;}
    ball(b,gold,0,0,.012,.012,.012,.008);ball(b,iris,0,0,.018,.008,.008,.005);return b;
  }
  const root=group(rig);root.name='lan-whale-girl';
  const dress=group(root), head=group(root,0,.44,0), tail=group(root,0,.055,-.02);
  head.name='lan-head';tail.name='lan-whale-tail';
  // A compact two-head silhouette preserves the room's existing hand/foot anchors.
  ball(dress,blue,0,.245,0,.104,.089,.08);
  const skirtProfile=[[.09,.23],[.115,.20],[.145,.15],[.166,.07],[.163,.035]].reverse().map(p=>new T.Vector2(...p));
  mesh(new T.LatheGeometry(skirtProfile,48),navy,dress);
  const apronProfile=[[.164,.055],[.169,.08],[.15,.15],[.113,.205]].map(p=>new T.Vector2(...p));
  mesh(new T.LatheGeometry(apronProfile,28,-.75,1.5),ivory,dress);
  /* pearl edging: small flattened beads sitting half-sunk in the hem */
  for(let i=0;i<18;i++){const a=i/18*Math.PI*2;const b=ball(dress,ivory,Math.sin(a)*.159,.032,Math.cos(a)*.159,.013,.009,.013);b.rotation.y=a;}
  for(const side of [-1,1]) {const collar=ball(dress,ivory,side*.035,.304,.057,.034,.026,.018);collar.rotation.z=side*.5;}
  bow(dress,0,.282,.088,.75);
  for(const y of [.235,.211])for(const side of [-1,1])ball(dress,gold,side*.041,y,.08,.005,.005,.003);
  ball(dress,ivory,0,.336,0,.034,.038,.033);
  const apronLogo=group(dress,0,.115,.162);
  ball(apronLogo,hairBlue,-.005,0,0,.027,.016,.003);
  for(const side of [-1,1]){const f=ball(apronLogo,hairBlue,.028,side*.009,0,.015,.006,.003);f.rotation.z=side*.5;}
  ball(apronLogo,ivory,-.016,.003,.003,.002,.002,.001);
  bow(dress,0,.19,-.098,1.3);
  // Hair behind the round face; separate long locks keep the silhouette legible.
  ball(head,hairDark,0,-.030,-.062,.186,.183,.128);
  const longHair=[];
  for(const side of [-1,1])for(let i=0;i<3;i++) {
    const h=strand(head,[[side*(.12+i*.015),.06,-.06],[side*(.18+i*.01),-.08,-.08],[side*(.15+i*.027),-.20,-.05],[side*(.19+i*.023),-.258,-.035]],[.035,.045,.035,.001],.027,i===2?hairLight:hairBlue);longHair.push(h);
  }
  ball(head,skin,0,0,.019,.174,.155,.143);
  const cap=mesh(new T.SphereGeometry(.19,40,24,0,Math.PI*2,0,1.36),hairBlue,head,0,.008,-.01);cap.scale.z=.85;
  // Swept side fringe and a shorter central bang leave both eyes visible.
  for(const side of [-1,1]) {
    strand(head,[[side*.14,.12,.07],[side*.16,.045,.12],[side*.148,-.06,.10],[side*.12,-.10,.11]],[.035,.042,.028,.001],.021,hairBlue);
    strand(head,[[side*.045,.153,.03],[side*.07,.113,.13],[side*.095,.067,.15],[side*.127,.023,.12]],[.025,.04,.035,.001],.016,hairBlue);
    /* the fin sits on the crown, tipped back so it clears the hair mass */
    finEar(head,side,side*.104,.108,-.028,.95);
    bow(head,side*.171,.065,.034,.55);
  }
  strand(head,[[0,.16,.04],[-.02,.12,.13],[.008,.07,.163],[.04,.044,.151]],[.023,.038,.03,.001],.016,hairBlue);
  /* a pearl headband sitting in the hair, plus one soft curl of a forelock */
  for(let i=0;i<13;i++){const a=-1.02+i/12*2.04;ball(head,ivory,Math.sin(a)*.181,Math.cos(a)*.185+.004,.010,.0092,.0072,.0098);}
  tube(head,[[-.004,.176,-.014],[.002,.204,-.024],[.036,.218,-.014],[.043,.199,.006],[.021,.188,.014]],.0062,hairBlue);
  const eyes=[], pupils=[];
  for(const side of [-1,1]) {
    const e=group(head,side*.063,-.008,.147);e.rotation.y=side*.27;eyes.push(e);
    ball(e,ivory,0,0,0,.039,.046,.009);
    const p=group(e,0,-.002,.008);pupils.push(p);
    ball(p,dark,0,0,0,.029,.040,.009);ball(p,iris,0,-.006,.006,.024,.032,.007);
    ball(p,irisLight,0,-.023,.009,.019,.014,.005);ball(p,dark,0,.003,.012,.010,.024,.004);
    ball(p,shine,-.009,.018,.017,.009,.012,.003);ball(p,shine,.010,-.014,.017,.0045,.005,.002);
    tube(e,[[-.037,.020,.007],[-.018,.044,.011],[.014,.044,.011],[.038,.023,.007]],.0045,dark);
    tube(e,[[side*.028,.03,.01],[side*.046,.038,.01],[side*.05,.048,.008]],.0025,dark);
    tube(head,[[side*.035,.062,.145],[side*.062,.071,.139],[side*.091,.062,.123]],.0028,hairDark);
    const blush=material(0xf3a8af);blush.transparent=true;blush.opacity=.34;
    const cheek=ball(head,blush,side*.107,-.057,.125,.024,.012,.002);cheek.rotation.y=side*.48;
  }
  ball(head,skin,0,-.034,.164,.009,.007,.009);
  tube(head,[[-.014,-.075,.151],[0,-.080,.154],[.014,-.075,.151]],.0023,material(0xb16875));
  /* The tail leaves the hem at the back and sweeps down and behind, so it stays
     clear of the seated feet and never reads as a floating fin. */
  strand(tail,[[0,0,.02],[0,-.032,-.055],[0,-.045,-.115],[0,-.016,-.163]],[.150,.134,.100,.068],.075,hairBlue);
  strand(tail,[[.004,-.006,.014],[.004,-.038,-.052],[.004,-.050,-.112],[.004,-.022,-.158]],[.108,.096,.070,.046],.012,ivory);
  fluke(tail,1,0,-.014,-.168);
  fluke(tail,-1,0,-.014,-.168);
  // Replace the original black surfaces while keeping its proven IK solvers.
  for(const a of arms){a.a.geometry=new T.CylinderGeometry(.027,.033,1,16);a.b.geometry=new T.CylinderGeometry(.021,.023,1,16);a.j.geometry=new T.SphereGeometry(.024,12,8);a.a.material=blue;a.b.material=a.j.material=skin;}
  for(const l of legs){l.a.geometry=new T.CylinderGeometry(.025,.027,1,16);l.b.geometry=new T.CylinderGeometry(.026,.025,1,16);l.j.geometry=new T.SphereGeometry(.027,12,8);l.a.material=skin;l.b.material=sock;l.j.material=skin;}
  for(const h of hands){h.children[0].material=blue;h.traverse(o=>{if(o.isMesh&&o!==h.children[0])o.material=skin;});}
  for(const foot of feet){foot.children[0].material=shoe;const strap=ball(foot,gold,0,.008,.039,.01,.005,.005);strap.name='shoe-buckle';}
  for(const thumb of thumbs)thumb.material=skin;
  const shoulders=[group(root),group(root)];
  for(const s of shoulders)ball(s,blue,0,0,0,.041,.043,.043);
  body.visible=false;eye.visible=false;xmark.visible=false;
  const scratch=V(0,0,0), headBase=V(0,.44,0), sh=[V(-.115,.275,0),V(.115,.275,0)];
  const neutralHair=longHair.map(h=>h.position.clone());
  return {
    root,head,tail,eyes,shoulders,kind:'procedural-3d-whale-girl',
    update({time,dt,blink,openness,look,blanket}) {
      head.position.copy(jellied(headBase,scratch));
      head.rotation.z=Math.sin(time*1.3)*.018;
      for(let i=0;i<2;i++){
        eyes[i].scale.y=Math.max(.055,openness*(1-Math.sin(blink*Math.PI)*.93));
        pupils[i].position.x=T.MathUtils.lerp(pupils[i].position.x,T.MathUtils.clamp(look.x,-1,1)*.009,Math.min(1,dt*8));
        pupils[i].position.y=T.MathUtils.lerp(pupils[i].position.y,-.002+T.MathUtils.clamp(look.y,-1,1)*.007,Math.min(1,dt*8));
        shoulders[i].position.copy(jellied(sh[i],scratch));shoulders[i].visible=blanket<.45;
      }
      /* the tail swishes behind her: a slow roll with a little lift at the tip */
      tail.rotation.y=Math.sin(time*1.6)*.13;
      tail.rotation.z=Math.sin(time*1.9)*.05;
      tail.position.y=.055+Math.sin(time*2.1)*.006;
      tail.visible=blanket<.45;
      for(let i=0;i<longHair.length;i++){longHair[i].position.copy(neutralHair[i]);longHair[i].rotation.z=Math.sin(time*1.8+i*.6)*.017;}
    }
  };
};
})();
