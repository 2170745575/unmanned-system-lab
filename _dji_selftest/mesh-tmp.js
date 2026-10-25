/* 临时：打印指定部件的网格级世界数据 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = process.env.ROOT;
const FILES = (process.env.FILES || '').split(',');
const GLOBAL = process.env.MODEL_GLOBAL;
const WANT = (process.env.WANT || '').split(',');
const THREE = require(path.join(ROOT, 'vendor', 'three.min.js'));
let fakeNow = 0;
Object.defineProperty(globalThis, 'performance', { value: { now: () => fakeNow }, configurable: true });
const grad = { addColorStop() {} };
const ctx2d = new Proxy({}, { get(t, p) {
  if (p === 'createLinearGradient' || p === 'createRadialGradient') return () => grad;
  if (p === 'measureText') return () => ({ width: 10 });
  return function () {};
}, set() { return true; } });
function mkEl() {
  const el = { tagName: 'DIV', style: { setProperty() {}, removeProperty() {} }, dataset: {}, children: [], _h: {}, _attrs: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    appendChild(c) { el.children.push(c); return c; }, removeChild() {},
    addEventListener(k, f) { (el._h[k] = el._h[k] || []).push(f); }, removeEventListener() {},
    fire() {}, scrollIntoView() {}, querySelector() { return null; }, textContent: '', innerHTML: '', width: 0, height: 0 };
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
  this.shadowMap = {}; this.setPixelRatio = () => {}; this.setSize = () => {}; this.render = () => {};
};
THREE.PMREMGenerator = function () {
  this.compileEquirectangularShader = () => {}; this.fromEquirectangular = () => ({ texture: new THREE.Texture() }); this.dispose = () => {};
};
const rafQueue = [];
globalThis.requestAnimationFrame = cb => { rafQueue.push(cb); };
globalThis.cancelAnimationFrame = () => {};
for (const f of FILES) new Function(fs.readFileSync(path.join(ROOT, f), 'utf8'))();
(async function () {
  await new Promise(r => setTimeout(r, 40));
  for (let i = 0; i < 8; i++) { const cb = rafQueue.shift(); if (!cb) break; fakeNow += 33; cb(); }
  const E = globalThis.DJIEngine.E;
  E.scene.updateMatrixWorld(true);
  E.parts.forEach(p => {
    if (WANT.length && WANT.indexOf(p.def.id) < 0) return;
    console.log('--- ' + p.def.id + ' group.pos=' + p.group.position.toArray().map(v => v.toFixed(3)) +
      ' spinInner=' + (p.group.userData.spinInner ? JSON.stringify({ p: p.group.userData.spinInner.position.toArray().map(v => v.toFixed(3)), ry: p.group.userData.spinInner.rotation.y.toFixed(3) }) : 'none') +
      ' groupRot=' + [p.group.rotation.x.toFixed(2), p.group.rotation.y.toFixed(2), p.group.rotation.z.toFixed(2)]);
    p.meshes.forEach(m => {
      m.updateWorldMatrix(true, false);
      const wp = new THREE.Vector3().setFromMatrixPosition(m.matrixWorld);
      const bb = m.geometry.boundingBox ? m.geometry.boundingBox.clone() : (m.geometry.computeBoundingBox(), m.geometry.boundingBox.clone());
      const wb = bb.clone().applyMatrix4(m.matrixWorld);
      console.log('    localPos=' + m.position.toArray().map(v => v.toFixed(2)) +
        ' localRot=' + [m.rotation.x.toFixed(2), m.rotation.y.toFixed(2), m.rotation.z.toFixed(2)] +
        ' worldPos=' + wp.toArray().map(v => v.toFixed(2)) +
        ' wy=[' + wb.min.y.toFixed(2) + ',' + wb.max.y.toFixed(2) + ']' +
        ' geoY=[' + bb.min.y.toFixed(2) + ',' + bb.max.y.toFixed(2) + ']' +
        ' geoX=[' + bb.min.x.toFixed(2) + ',' + bb.max.x.toFixed(2) + ']');
    });
  });
  process.exit(0);
})();