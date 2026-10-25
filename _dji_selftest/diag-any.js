/* 通用机型诊断：ROOT + FILES 环境变量指定，检查构建、尺寸、落地、异常部件 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = process.env.ROOT || 'D:\\deepseek工作\\dji-flycart100-3d';
const FILES = (process.env.FILES || 'logistics.js,model-flycart.js,flycart.js,engine.js').split(',');
const GLOBAL = process.env.MODEL_GLOBAL || 'DJIModelFlyCart';
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

let loadErr = null;
for (const f of FILES) {
  try { new Function(fs.readFileSync(path.join(ROOT, f), 'utf8'))(); }
  catch (e) { loadErr = f + ': ' + e.message; break; }
}
if (loadErr) { console.log('模块执行失败: ' + loadErr); process.exit(1); }

(async function () {
  await new Promise(r => setTimeout(r, 40));
  for (let i = 0; i < 8; i++) { const cb = rafQueue.shift(); if (!cb) break; fakeNow += 33; cb(); }
  const E = globalThis.DJIEngine.E;
  const M = globalThis[GLOBAL] || globalThis.window[GLOBAL];
  if (!E || !M) { console.log('未构建成功 (E=' + !!E + ' M=' + !!M + ')'); process.exit(2); }
  console.log('机型: ' + M.title);
  console.log('部件: ' + E.parts.length + ' / 清单 ' + M.parts.length + '   网格: ' +
    E.parts.reduce((s, p) => s + p.meshes.length, 0));
  let tris = 0;
  E.parts.forEach(p => p.meshes.forEach(m => {
    const g = m.geometry;
    tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
  }));
  const mb = new THREE.Box3();
  E.root.traverse(o => {
    if (!o.isMesh) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    const bb = o.geometry.boundingBox.clone();
    o.updateWorldMatrix(true, false);
    bb.applyMatrix4(o.matrixWorld);
    mb.union(bb);
  });
  const s = mb.getSize(new THREE.Vector3());
  const rs = M.scene.rootScale;
  console.log('三角面: ' + Math.round(tris));
  console.log('纯网格尺寸: ' + s.x.toFixed(1) + ' × ' + s.y.toFixed(1) + ' × ' + s.z.toFixed(1) +
    '  → 实际 ' + (s.x / rs).toFixed(0) + ' × ' + (s.y / rs).toFixed(0) + ' × ' + (s.z / rs).toFixed(0) + ' cm');
  console.log('最低点(世界 y): ' + mb.min.y.toFixed(2) + '   地面 y=' + M.scene.floorY +
    (mb.min.y >= M.scene.floorY - 0.05 ? '  ✓ 不穿地' : '  ✗ 穿地 ' + (M.scene.floorY - mb.min.y).toFixed(2)));
  // 部件异常检查（尺寸奇大 / 位置离谱 / pivot 部件）
  const bad = [];
  E.parts.forEach(p => {
    const b = new THREE.Box3();
    p.meshes.forEach(m => {
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
      const bb = m.geometry.boundingBox.clone();
      m.updateWorldMatrix(true, false);
      bb.applyMatrix4(m.matrixWorld);
      b.union(bb);
    });
    const sz = b.getSize(new THREE.Vector3());
    const lim = 70;   // 30 米级机型的单部件上限（单位）
    if (sz.x > lim || sz.y > lim || sz.z > lim) {
      bad.push(p.def.id + ' size=' + sz.toArray().map(v => v.toFixed(1)).join(',') +
        ' 中心=' + b.getCenter(new THREE.Vector3()).toArray().map(v => v.toFixed(1)).join(','));
    }
  });
  console.log(bad.length ? '⚠ 尺寸异常部件:\n  ' + bad.join('\n  ') : '所有部件尺寸正常');
  const spin = E.parts.filter(p => p.def.spin).length;
  const hinge = E.parts.filter(p => p.def.hinge).length;
  const disc = E.parts.filter(p => p.disc).length;
  console.log('自旋部件: ' + spin + '  铰链部件: ' + hinge + '  光晕盘: ' + disc);
  console.log('桨叶转角抽样: ' + E.parts.filter(p => p.def.spin).slice(0, 3)
    .map(p => p.def.id + '=' + ((p.group.userData.spinInner || p.group).rotation.y).toFixed(2)).join(' '));
  process.exit(0);
})();