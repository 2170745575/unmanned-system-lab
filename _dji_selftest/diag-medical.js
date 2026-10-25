/* 医疗页骨架自检：只加载模型与引擎（行为模块可后补），验证几何可构建 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = 'D:\\deepseek工作\\dji-medical-3d';
const THREE = require(path.join(ROOT, 'vendor', 'three.min.js'));
let fakeNow = 0;
Object.defineProperty(globalThis, 'performance', { value: { now: () => fakeNow }, configurable: true });
const grad = { addColorStop() {} };
const ctx2d = new Proxy({}, { get(t, p) {
  if (p === 'createLinearGradient' || p === 'createRadialGradient') return () => grad;
  if (p === 'measureText') return () => ({ width: 10 });
  return function () {};
}, set() { return true; } });
function mkEl(t) {
  const el = { tagName: String(t || 'div').toUpperCase(), style: { setProperty() {}, removeProperty() {} },
    dataset: {}, children: [], _h: {}, _attrs: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    appendChild(c) { el.children.push(c); return c; }, removeChild() {},
    addEventListener(k, f) { (el._h[k] = el._h[k] || []).push(f); }, removeEventListener() {},
    fire(k, e) { (el._h[k] || []).forEach(f => f(e || {})); },
    scrollIntoView() {}, querySelector() { return null; }, textContent: '', innerHTML: '', width: 0, height: 0 };
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

const FILES = (process.env.FILES || 'model-medical.js,engine.js').split(',');
FILES.forEach(f => new Function(fs.readFileSync(path.join(ROOT, f), 'utf8'))());

(async function () {
  await new Promise(r => setTimeout(r, 40));
  for (let i = 0; i < 6; i++) { const cb = rafQueue.shift(); if (!cb) break; fakeNow += 33; cb(); }
  const E = globalThis.DJIEngine.E;
  const M = globalThis.DJIModelMedical;
  console.log('机型: ' + M.title);
  console.log('部件数: ' + E.parts.length + ' / 清单 ' + M.parts.length);
  let tot = 0, verts = 0;
  E.parts.forEach(p => {
    p.meshes.forEach(m => {
      const g = m.geometry;
      tot += (g.index ? g.index.count : g.attributes.position.count) / 3;
    });
  });
  const box = new THREE.Box3().setFromObject(E.root);
  const size = box.getSize(new THREE.Vector3());
  console.log('整机三角面: ' + Math.round(tot));
  console.log('世界尺寸(单位): ' + size.x.toFixed(1) + ' × ' + size.y.toFixed(1) + ' × ' + size.z.toFixed(1));
  console.log('→ 按 rootScale=' + M.scene.rootScale + ' 换算实际: ' +
    (size.x / M.scene.rootScale).toFixed(0) + ' × ' + (size.y / M.scene.rootScale).toFixed(0) +
    ' × ' + (size.z / M.scene.rootScale).toFixed(0) + ' cm');
  console.log('最低点(世界 y): ' + box.min.y.toFixed(2) + '   地面 y=' + M.scene.floorY);
  console.log('网格总数: ' + E.parts.reduce((s, p) => s + p.meshes.length, 0));
  // 只统计网格（排除 sprite / line，它们会放大包围盒）
  const meshBox = new THREE.Box3();
  let nMesh = 0;
  E.root.traverse(o => {
    if (!o.isMesh) return;
    nMesh++;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    const bb = o.geometry.boundingBox.clone();
    o.updateWorldMatrix(true, false);
    bb.applyMatrix4(o.matrixWorld);
    meshBox.union(bb);
  });
  const ms = meshBox.getSize(new THREE.Vector3());
  console.log('纯网格三角面: ' + Math.round(tot) + '  网格数: ' + nMesh);
  console.log('纯网格世界尺寸: ' + ms.x.toFixed(1) + ' × ' + ms.y.toFixed(1) + ' × ' + ms.z.toFixed(1) +
    '  → 实际 ' + (ms.x / M.scene.rootScale).toFixed(0) + ' × ' + (ms.y / M.scene.rootScale).toFixed(0) +
    ' × ' + (ms.z / M.scene.rootScale).toFixed(0) + ' cm');
  console.log('最低点(世界 y): ' + meshBox.min.y.toFixed(2) + '   地面 y=' + M.scene.floorY);
  // 找出尺寸异常的部件（只看网格）
  const bad = [];
  E.parts.forEach(p => {
    const b = new THREE.Box3();
    p.meshes.forEach(m => {
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
      const bb = m.geometry.boundingBox.clone();
      bb.applyMatrix4(m.matrixWorld);
      b.union(bb);
    });
    const s = b.getSize(new THREE.Vector3());
    if (s.x > 60 || s.y > 60 || s.z > 60 || b.min.y < -12) {
      bad.push(p.def.id + ' size=' + s.toArray().map(v => v.toFixed(1)) + ' min=' + b.min.toArray().map(v => v.toFixed(1)));
    }
  });
  console.log(bad.length ? '⚠ 网格尺寸异常:\n  ' + bad.join('\n  ') : '所有部件网格尺寸正常');
  console.log('发光 sprite 尺寸抽样: ' + E.parts.slice(0, 3).map(p => p.def.id + '=' + p.sprite.scale.x.toFixed(1)).join(', '));
  process.exit(0);
})();