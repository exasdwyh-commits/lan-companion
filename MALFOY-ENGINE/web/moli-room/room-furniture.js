/* Room furniture overlays from room-plan grid (14×9).
 * Primitive placeholders only — aesthetics come later. */
(function () {
'use strict';

window.createRoomFurniture = function ({ scene, THREE }) {
  const T = THREE;
  const root = new T.Group();
  root.name = 'lan-room-furniture';
  scene.add(root);

  // Map grid cells onto the cutaway floor. Tuned to the moli room footprint.
  const ORIGIN = { x: -1.85, z: -1.95 };
  const CELL = 0.28;
  const GRID = { w: 14, h: 9 };

  const COLORS = {
    seat: 0x6b8cae, sleep: 0x8a6b8a, table: 0xb08968, storage: 0x7a6a55,
    floor: 0xc4b49a, plant: 0x5a9a6a, pet: 0x4a8ab8, light: 0xe8d090,
    music: 0x9a7a9a, decor: 0xd0c0a8,
  };

  let edit = false;
  let ghost = null;
  let pending = null; // { item, rot }
  let itemsGroup = new T.Group();
  itemsGroup.name = 'lan-furniture-items';
  root.add(itemsGroup);

  const gridHelper = new T.Group();
  gridHelper.name = 'lan-furniture-grid';
  gridHelper.visible = false;
  root.add(gridHelper);
  for (let y = 0; y <= GRID.h; y++) {
    const g = new T.BufferGeometry().setFromPoints([
      new T.Vector3(ORIGIN.x, 0.502, ORIGIN.z + y * CELL),
      new T.Vector3(ORIGIN.x + GRID.w * CELL, 0.502, ORIGIN.z + y * CELL),
    ]);
    gridHelper.add(new T.Line(g, new T.LineBasicMaterial({ color: 0x88aacc, transparent: true, opacity: 0.35 })));
  }
  for (let x = 0; x <= GRID.w; x++) {
    const g = new T.BufferGeometry().setFromPoints([
      new T.Vector3(ORIGIN.x + x * CELL, 0.502, ORIGIN.z),
      new T.Vector3(ORIGIN.x + x * CELL, 0.502, ORIGIN.z + GRID.h * CELL),
    ]);
    gridHelper.add(new T.Line(g, new T.LineBasicMaterial({ color: 0x88aacc, transparent: true, opacity: 0.35 })));
  }

  function cellToWorld(cx, cy, w, h) {
    return {
      x: ORIGIN.x + (cx + w / 2) * CELL,
      z: ORIGIN.z + (cy + h / 2) * CELL,
    };
  }

  function footprint(def, rot) {
    const swapped = rot === 90 || rot === 270;
    return { w: swapped ? def.h : def.w, h: swapped ? def.w : def.h };
  }

  function makeMesh(itemId, def, fp) {
    const kind = def.kind || 'decor';
    const color = COLORS[kind] || 0xaaaaaa;
    const mat = new T.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.05 });
    let mesh;
    if (kind === 'pet') {
      const g = new T.Group();
      const tank = new T.Mesh(new T.BoxGeometry(fp.w * CELL * 0.9, 0.22, fp.h * CELL * 0.9),
        new T.MeshStandardMaterial({ color: 0x7ec8e3, transparent: true, opacity: 0.45, roughness: 0.2 }));
      tank.position.y = 0.12;
      const base = new T.Mesh(new T.BoxGeometry(fp.w * CELL * 0.95, 0.04, fp.h * CELL * 0.95), mat);
      base.position.y = 0.02;
      g.add(base, tank);
      g.userData.tank = tank;
      mesh = g;
    } else if (kind === 'plant') {
      mesh = new T.Mesh(new T.ConeGeometry(CELL * 0.35, 0.35, 8), mat);
      mesh.position.y = 0.18;
    } else {
      const h = kind === 'sleep' ? 0.28 : kind === 'seat' ? 0.22 : kind === 'storage' ? 0.5 : 0.16;
      mesh = new T.Mesh(new T.BoxGeometry(fp.w * CELL * 0.92, h, fp.h * CELL * 0.92), mat);
      mesh.position.y = h / 2 + 0.5;
    }
    if (mesh.position.y < 0.5 && kind !== 'pet' && kind !== 'plant') mesh.position.y = 0.58;
    if (kind === 'plant') mesh.position.y = 0.68;
    if (kind === 'pet') { /* group already positioned */ }
    else if (kind !== 'plant') { /* box y set */ }
    mesh.userData.itemId = itemId;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  function clearItems() {
    while (itemsGroup.children.length) {
      const c = itemsGroup.children.pop();
      c.traverse?.((o) => {
        if (o.geometry) o.geometry.dispose?.();
        if (o.material) {
          if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose?.());
          else o.material.dispose?.();
        }
      });
    }
  }

  function applySnapshot(snap) {
    clearItems();
    if (!snap || !Array.isArray(snap.items)) return;
    const catalog = {};
    for (const c of snap.catalog || []) catalog[c.id] = c;
    for (const it of snap.items) {
      const def = catalog[it.item] || { w: 1, h: 1, kind: 'decor', name: it.item };
      const fp = footprint(def, it.rot || 0);
      const mesh = makeMesh(it.item, def, fp);
      const pos = cellToWorld(it.x, it.y, fp.w, fp.h);
      mesh.position.x = pos.x;
      mesh.position.z = pos.z;
      if (mesh.position.y === 0) mesh.position.y = 0.58;
      mesh.rotation.y = -((it.rot || 0) * Math.PI) / 180;
      mesh.userData.uid = it.uid;
      mesh.userData.planItem = it;
      itemsGroup.add(mesh);
    }
  }

  function setEditMode(on) {
    edit = !!on;
    gridHelper.visible = edit;
    if (!edit && ghost) {
      root.remove(ghost);
      ghost = null;
      pending = null;
    }
  }

  function setPending(item, def, rot) {
    pending = { item, def, rot: rot || 0 };
    if (ghost) { root.remove(ghost); ghost = null; }
    if (!pending) return;
    const fp = footprint(def, pending.rot);
    ghost = makeMesh(item, def, fp);
    ghost.traverse((o) => {
      if (o.material) {
        o.material = o.material.clone();
        o.material.transparent = true;
        o.material.opacity = 0.45;
      }
    });
    ghost.visible = false;
    root.add(ghost);
  }

  function worldToCell(wx, wz) {
    const cx = Math.floor((wx - ORIGIN.x) / CELL);
    const cy = Math.floor((wz - ORIGIN.z) / CELL);
    return { x: cx, y: cy };
  }

  function hover(wx, wz) {
    if (!edit || !ghost || !pending) return null;
    const def = pending.def;
    const fp = footprint(def, pending.rot);
    const cell = worldToCell(wx, wz);
    const pos = cellToWorld(cell.x, cell.y, fp.w, fp.h);
    ghost.visible = true;
    ghost.position.x = pos.x;
    ghost.position.z = pos.z;
    if (!ghost.position.y) ghost.position.y = 0.58;
    return { x: cell.x, y: cell.y, item: pending.item, rot: pending.rot };
  }

  function aquariumMeshes() {
    return itemsGroup.children.filter((c) => c.userData.itemId === 'aquarium' || c.userData.itemId === 'fishtank');
  }

  return {
    root,
    applySnapshot,
    setEditMode,
    setPending,
    hover,
    worldToCell,
    get edit() { return edit; },
    get pending() { return pending; },
    aquariumMeshes,
    GRID,
    ORIGIN,
    CELL,
  };
};
})();
