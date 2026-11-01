/* Original procedural hardback: curved paper, layered edges, bound spine and
   a deforming leaf. Keeps the upstream pick-up/rest/held item contract. */
(function () {
  'use strict';
  window.createLanBook = function ({ kind = 'se', THREE: T = window.THREE }) {
    const themes = { se: [0x365f85, '潮汐手记'], dev: [0x4e546e, '星海拾光'], mech: [0x56716b, '风与远方'] };
    const [color, title] = themes[kind] || themes.se;
    const root = new T.Group(); root.name = 'lan-hardback-' + kind;
    const book = new T.Group(); book.rotation.x = -Math.PI / 2; book.position.y = .017; root.add(book);
    const W = .145, H = .170, D = .013;
    const cloth = new T.MeshStandardMaterial({ color, roughness: .86, metalness: .02 });
    const paper = new T.MeshStandardMaterial({ color: 0xeee3cb, roughness: .98 });
    const gilt = new T.MeshStandardMaterial({ color: 0xd7bc80, metalness: .6, roughness: .4 });
    const mesh = (geometry, material, parent, x = 0, y = 0, z = 0, name = '') => {
      const o = new T.Mesh(geometry, material); o.position.set(x, y, z); o.name = name;
      o.castShadow = true; o.receiveShadow = true; parent.add(o); return o;
    };
    function texture(side, cover = false) {
      const c = document.createElement('canvas'); c.width = 512; c.height = 768;
      const g = c.getContext('2d');
      g.fillStyle = cover ? '#' + new T.Color(color).getHexString() : '#f5eddc'; g.fillRect(0, 0, 512, 768);
      if (cover) {
        g.strokeStyle = '#d8bd85'; g.lineWidth = 3; g.strokeRect(27, 27, 458, 714); g.strokeRect(35, 35, 442, 698);
        g.textAlign = 'center'; g.fillStyle = '#ecdbb0'; g.font = '28px serif'; g.fillText('LAN · LIBRARY', 256, 158);
        g.font = '46px serif'; g.fillText(title, 256, 352);
        g.beginPath(); g.arc(256, 471, 48, .2, Math.PI * 1.85); g.stroke();
        g.beginPath(); g.moveTo(199, 493); g.quadraticCurveTo(256, 450, 313, 493); g.stroke();
        g.font = '21px serif'; g.fillText('把日常，轻轻收进书里', 256, 633);
      } else {
        const shade = g.createLinearGradient(side ? 0 : 512, 0, side ? 80 : 432, 0);
        shade.addColorStop(0, '#cbbb9f'); shade.addColorStop(1, '#f5eddc'); g.fillStyle = shade; g.fillRect(0, 0, 512, 768);
        g.fillStyle = '#746958'; g.textAlign = 'center'; g.font = '21px serif'; g.fillText(title, 256, 66);
        g.strokeStyle = '#baac90'; g.lineWidth = 1; g.beginPath(); g.moveTo(60, 89); g.lineTo(452, 89); g.stroke();
        g.fillStyle = '#433d35'; g.font = '30px serif'; g.fillText(side ? '风从海上来' : '写给远方的你', 256, 154);
        const lines = ['清晨的海风翻过窗沿。','她把一枚书签夹进书里，','留住还没有读完的故事。','日子慢一点，也很好。','愿每一段安静的时光，','都有可以继续的下一页。'];
        g.textAlign = 'left'; g.font = '23px serif';
        for (let i = 0; i < 13; i++) g.fillText(lines[(i + side * 2) % lines.length], 62, 224 + i * 31);
        g.textAlign = 'center'; g.font = '20px serif'; g.fillStyle = '#8d806b'; g.fillText(side ? '13' : '12', 256, 715);
      }
      const t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding; t.anisotropy = 4; return t;
    }
    const leaves = [], covers = [], hinges = [];
    for (const side of [-1, 1]) {
      const hinge = new T.Group(); hinge.name = side < 0 ? 'left-binding' : 'right-binding'; book.add(hinge); hinges.push(hinge);
      const cover = mesh(new T.BoxGeometry(W + .008, H + .010, .004), cloth, hinge, side * (W / 2), 0, -.010, 'hard-cover');
      covers.push(cover);
      const art = new T.MeshStandardMaterial({ map: texture(side > 0 ? 1 : 0, true), roughness: .9 });
      const face = mesh(new T.PlaneGeometry(W, H), art, cover, 0, 0, -.0022, 'foil-cover'); face.rotation.y = Math.PI;
      const block = mesh(new T.BoxGeometry(W - .004, H - .003, D), paper, hinge, side * W / 2, 0, -.0008, 'bound-page-block');
      // Visible stacked paper lines, geometry rather than a flat edge texture.
      for (let i = 0; i < 7; i++) {
        const edge = mesh(new T.BoxGeometry(W - .005, .00045, .0004), new T.MeshStandardMaterial({color: i % 2 ? 0xc8bda7 : 0xdfd3ba, roughness: 1}), hinge, side * W / 2, -H / 2 + .001, -.006 + i * .0018, 'paper-edge');
        edge.castShadow = false;
      }
      const geo = new T.PlaneGeometry(W - .004, H - .005, 18, 2), a = geo.attributes.position;
      for (let i = 0; i < a.count; i++) { const u = a.getX(i) / (W - .004) + .5; a.setZ(i, .004 * Math.sin(Math.PI * u) + .004 * (side < 0 ? u : 1 - u)); }
      geo.computeVertexNormals();
      const leafMat = new T.MeshStandardMaterial({ map: texture(side > 0 ? 1 : 0), roughness: .96, side: T.DoubleSide });
      leaves.push(mesh(geo, leafMat, hinge, side * W / 2, 0, .0065, 'curved-printed-page'));
      block.userData.paperThickness = D;
    }
    const spine = mesh(new T.CylinderGeometry(.008, .008, H + .008, 12, 1, false, 0, Math.PI), cloth, book, 0, 0, -.005, 'bound-spine'); spine.rotation.y = Math.PI / 2;
    for (const y of [-.052, -.044, .044, .052]) mesh(new T.TorusGeometry(.0082, .0007, 4, 14, Math.PI), gilt, spine, 0, y, 0, 'spine-gilding').rotation.x = Math.PI / 2;
    const ribbon = mesh(new T.BoxGeometry(.009, .046, .0007), new T.MeshStandardMaterial({color:0xb27867,roughness:.9,side:T.DoubleSide}), book, .016, -H / 2 - .010, .004, 'ribbon-bookmark'); ribbon.rotation.z = -.13;
    const turn = new T.Group(); turn.name = 'turning-page'; turn.position.z = .010; book.add(turn);
    const turnGeo = new T.PlaneGeometry(W - .006, H - .006, 20, 2); turnGeo.translate((W - .006) / 2, 0, 0);
    const turnBase = Float32Array.from(turnGeo.attributes.position.array);
    mesh(turnGeo, leaves[1].material, turn, 0, 0, 0, 'flexing-paper'); turn.visible = false;
    let open = 0, turning = false, progress = 0, previousPhase = 0;
    function update(dt, held, pagePhase = 0, reduced = false) {
      const target = held ? 1 : 0;
      open += (target - open) * (reduced ? 1 : 1 - Math.exp(-Math.max(0, dt) * 9));
      hinges[0].rotation.y = -Math.PI * (1 - open) + .12 * open;
      hinges[1].rotation.y = -.12 * open;
      // The existing life.page pulse runs 1 -> 0 exactly once per turn.
      if (!reduced && held && pagePhase > .2 && pagePhase > previousPhase + .08 && !turning) { turning = true; progress = 0; }
      previousPhase = pagePhase;
      if (turning) progress = Math.min(1, progress + Math.max(0, dt) / .66);
      turn.visible = !reduced && turning && open > .8 && held;
      turn.rotation.y = -.12 - Math.PI * progress;
      const p = turnGeo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = turnBase[i * 3], u = x / (W - .006);
        p.setZ(i, Math.sin(Math.PI * u) * Math.sin(Math.PI * progress) * .018);
      }
      if (turn.visible) { p.needsUpdate = true; turnGeo.computeVertexNormals(); }
      if (progress >= 1 || !held || reduced) turning = false;
      root.userData.bookState = { open, turning, progress, width: W * 2, thickness: D * 2 + .008 };
    }
    const api = { update, width: W * 2, height: H, get state() { return root.userData.bookState; } };
    root.userData.lanBook = api; root.userData.t = .034; root.userData.h = H;
    update(1, false); return root;
  };
})();
