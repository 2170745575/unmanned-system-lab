/* 临时：导出每个部件的局部包围盒（不做射线检测） */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = process.env.ROOT;
const OUT = process.env.OUT || 'D:\\deepseek工作\\_dji_selftest\\chk_parts.json';
const THREE = require(path.join(ROOT, 'vendor', 'three.min.js'));

let fakeNow = 0;
Object.defineProperty(globalThis, 'performance', { value: { now: () => fakeNow }, configurable: true });
const grad = { addColorStop() {} };
const ctx2d = new Proxy({}, { get(t, p) {
  if (p === 'createLinearGradient' || p === 'createRadialGradient') return () => grad;
  if (p === 'measureText') return () => ({ width: 10 });
  return function () {};
}, set() { return true; } });
function mkEl(tag) {
  const el = { tagName: String(tag || 'div').toUpperCase(),
    style: { setProperty() {}, removeProperty() {} }, dataset: {}, children: [], _h: {}, _attrs: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    appendChild(c) { el.children.push(c); c.parentNode = el; return c; }, removeChild() {},
    addEventListener(k, f) { (el._h[k] = el._h[k] || []).push(f); }, removeEventListener() {},
    fire() {}, scrollIntoView() {}, querySelector() { return null; },
    textContent: '', innerHTML: '', width: 0, height: 0 };
  el.setAttribute = () => {}; el.getAttribute = () => null; el.getContext = () => ctx2d; return el;
}
const registry = {};
globalThis.document = {
  createElement: mkEl, createElementNS: (n, t) => mkEl(t),
  getElementById: id => registry[id] || (registry[id] = mkEl()),
  querySelectorAll: () => [], querySelector: () => null,
  head: { appendChild(s) { setTimeout(() => {
    if (s.src.indexOf('vendor') >= 0) { globalThis.THREE = THREE; globalThis.window.THREE = THREE; s.onload && s.onload(); }
    else s.onerror && s.onerror(); }, 0); } },
  body: { style: {} }, addEventListener() {}
};
globalThis.innerWidth = 1600; globalThis.innerHeight = 900; globalThis.devicePixelRatio = 1;
globalThis.addEventListener = function () {}; globalThis.removeEventListener = function () {};
globalThis.window = globalThis;
THREE.WebGLRenderer = function () {
  this.domElement = mkEl('canvas'); this.domElement.setPointerCapture = () => {};
  this.shadowMap = {}; this.setPixelRatio = () => {}; this.setSize = () => {};
  this.render = () => {}; this.outputEncoding = null; this.toneMapping = null; this.toneMappingExposure = 1;
};
THREE.PMREMGenerator = function () {
  this.compileEquirectangularShader = () => {}; this.fromEquirectangular = () => ({ texture: new THREE.Texture() }); this.dispose = () => {};
};
const rafQueue = [];
globalThis.requestAnimationFrame = cb => { rafQueue.push(cb); };
globalThis.cancelAnimationFrame = () => {};
(process.env.FILES || '').split(',').forEach(f =>
  new Function(fs.readFileSync(path.join(ROOT, f), 'utf8'))());

function pump(n, ms) {
  return new Promise(res => {
    let i = 0;
    (function step() {
      if (i++ >= n) return res();
      const cb = rafQueue.shift(); if (!cb) return res();
      fakeNow += (ms || 33); cb(); setTimeout(step, 0);
    })();
  });
}

function grab(rootObj) {
  const out = [];
  rootObj.traverse(o => {
    if (!o.isMesh || !o.geometry || o.userData.noPick || o.visible === false) return;
    const geo = o.geometry, pos = geo.attributes.position, idx = geo.index;
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    if (!m) return;
    const tri = [];
    const n = idx ? idx.count : pos.count;
    const v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const j = idx ? idx.getX(i) : i;
      v.fromBufferAttribute(pos, j).applyMatrix4(o.matrixWorld);
      tri.push(+v.x.toFixed(4), +v.y.toFixed(4), +v.z.toFixed(4));
    }
    out.push({ color: m.color ? m.color.getHex() : 0x999999,
      hasMap: !!m.map,
      metalness: m.metalness !== undefined ? m.metalness : 0,
      roughness: m.roughness !== undefined ? m.roughness : 0.5,
      emissive: (m.emissive && (m.emissive.r + m.emissive.g + m.emissive.b) > 0.15) ? m.emissive.getHex() : null,
      v: tri });
  });
  return out;
}
function grabLights(scene) {
  const L = { ambient: null, hemi: null, dir: [], point: [] };
  scene.traverse(o => {
    if (!o.isLight) return;
    const rec = { color: o.color ? o.color.getHex() : 0xffffff, intensity: o.intensity,
      pos: [o.position.x, o.position.y, o.position.z] };
    if (o.isAmbientLight) L.ambient = rec;
    else if (o.isHemisphereLight) { rec.ground = o.groundColor.getHex(); L.hemi = rec; }
    else if (o.isDirectionalLight) L.dir.push(rec);
    else if (o.isPointLight) { rec.distance = o.distance; rec.decay = o.decay; L.point.push(rec); }
  });
  return L;
}

(async function () {
  await new Promise(r => setTimeout(r, 40));
  await pump(8);
  const E = globalThis.DJIEngine.E;
  // 只保留 / 隐藏某些部件（仅用于本导出进程，不改源码）
  const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);
  const HIDE = (process.env.HIDE || '').split(',').filter(Boolean);
  if (ONLY.length || HIDE.length) {
    E.parts.forEach(function (p) {
      const id = p.def.id;
      const keep = ONLY.length ? ONLY.indexOf(id) >= 0 : HIDE.indexOf(id) < 0;
      if (!keep) E.root.remove(p.group);
    });
  }
  // 归零根节点变换，得到"模型自身坐标系"
  E.root.position.set(0, 0, 0);
  E.root.rotation.set(0, 0, 0);
  E.root.updateMatrixWorld(true);
  const out = [];
  E.parts.forEach(function (p) {
    const b = new THREE.Box3();
    let tri = 0;
    p.group.traverse(o => {
      if (!o.isMesh || !o.geometry || o.userData.noPick) return;
      const g = o.geometry;
      if (!g.boundingBox) g.computeBoundingBox();
      const bb = g.boundingBox.clone().applyMatrix4(o.matrixWorld);
      b.union(bb);
      if (g.index) tri += g.index.count / 3;
    });
    out.push({ id: p.def.id, name: p.def.name,
      min: [b.min.x, b.min.y, b.min.z], max: [b.max.x, b.max.y, b.max.z], tri: tri });
  });
  console.log('E.root scale', E.root.scale.toArray(), 'pos', E.root.position.toArray(),
    'rot', E.root.rotation.toArray(), 'parent', E.root.parent && E.root.parent.type);
  const bu = E.parts.filter(p => p.def.id === 'bodyUpper')[0];
  if (bu && process.env.DEBUGCHILD === '1') bu.group.children.forEach(function (c, i) {
    c.geometry.computeBoundingBox();
    const wb = new THREE.Box3().setFromObject(c);
    console.log('  child', i, c.type, 'geo', c.geometry.boundingBox.min.toArray().map(n=>+n.toFixed(2)).join(','),
      '..', c.geometry.boundingBox.max.toArray().map(n=>+n.toFixed(2)).join(','),
      ' world', wb.min.toArray().map(n=>+n.toFixed(2)).join(','), '..', wb.max.toArray().map(n=>+n.toFixed(2)).join(','));
  });
  const body = out.reduce(function (b, o) {
    return b.union(new THREE.Box3(new THREE.Vector3(o.min[0], o.min[1], o.min[2]),
      new THREE.Vector3(o.max[0], o.max[1], o.max[2])));
  }, new THREE.Box3());
  fs.writeFileSync(OUT, JSON.stringify({ parts: out,
    root: { min: [body.min.x, body.min.y, body.min.z], max: [body.max.x, body.max.y, body.max.z] },
    drone: grab(E.root), world: grab(E.scene), lights: grabLights(E.scene),
    exposure: E.renderer.toneMappingExposure, camera: [E.camera.position.x, E.camera.position.y, E.camera.position.z] }));
  out.forEach(function (o) {
    console.log(o.id.padEnd(18), 'x[%s,%s] y[%s,%s] z[%s,%s]'.replace(/%s/g, () => ''), 
      '[' + o.min.map(n => n.toFixed(2)).join(',') + '] .. [' + o.max.map(n => n.toFixed(2)).join(',') + ']  tri=' + o.tri);
  });
  console.log('ROOT bbox', body.min.toArray().map(n => n.toFixed(2)).join(','), body.max.toArray().map(n => n.toFixed(2)).join(','),
    'size', body.getSize(new THREE.Vector3()).toArray().map(n => n.toFixed(2)).join(','));
  process.exit(0);
})();