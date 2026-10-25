/* 医疗页几何导出（引擎版：模型 + 地面道具 + 特效） */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = 'D:\\deepseek工作\\dji-medical-3d';
const OUT = process.env.OUT || 'D:\\deepseek工作\\_dji_selftest\\medevac.json';
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
['casualties.js', 'model-medical.js', 'medical.js', 'engine.js'].forEach(f =>
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
    if (!o.isMesh || !o.geometry || o.userData.noPick) return;
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
  E.scene.updateMatrixWorld(true);
  const drone = grab(E.root);
  const world = grab(E.scene);
  await pump(320, 33);                       // 跑一段救护作业，抓"作业中"的画面
  E.scene.updateMatrixWorld(true);
  const ops = grab(E.scene);
  fs.writeFileSync(OUT, JSON.stringify({
    drone: drone, world: world, ops: ops,
    lights: grabLights(E.scene), exposure: E.renderer.toneMappingExposure,
    camera: [E.camera.position.x, E.camera.position.y, E.camera.position.z]
  }));
  const tri = a => Math.round(a.reduce((s, m) => s + m.v.length / 9, 0));
  console.log('drone meshes ' + drone.length + ' tris ' + tri(drone));
  console.log('world meshes ' + world.length + ' tris ' + tri(world));
  console.log('ops   meshes ' + ops.length + ' tris ' + tri(ops));
  process.exit(0);
})();