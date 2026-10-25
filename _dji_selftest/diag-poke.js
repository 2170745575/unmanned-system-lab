/* 检查医疗舱内部件是否穿出舱体蒙皮（按模型自身 cm 坐标精确判定） */
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
  this.domElement = mkEl(); this.domElement.setPointerCapture = () => {};
  this.shadowMap = {}; this.setPixelRatio = () => {}; this.setSize = () => {}; this.render = () => {};
};
THREE.PMREMGenerator = function () {
  this.compileEquirectangularShader = () => {}; this.fromEquirectangular = () => ({ texture: new THREE.Texture() }); this.dispose = () => {};
};
const rafQueue = [];
globalThis.requestAnimationFrame = cb => { rafQueue.push(cb); };
globalThis.cancelAnimationFrame = () => {};
['casualties.js', 'model-medical.js', 'medical.js', 'engine.js'].forEach(f =>
  new Function(fs.readFileSync(path.join(ROOT, f), 'utf8'))());

(async function () {
  await new Promise(r => setTimeout(r, 40));
  for (let i = 0; i < 6; i++) { const cb = rafQueue.shift(); if (!cb) break; fakeNow += 33; cb(); }
  const E = globalThis.DJIEngine.E;
  const K = E.model.constants;
  const S = E.model.scene.rootScale;
  const INTERNAL = ['stretcher', 'lifeSupport', 'bloodFridge', 'monitorDefib', 'medicineRack',
    'batteryPack', 'flightCtrl', 'gnssUnit', 'beaconLights', 'sensorTurret'];
  const MARGIN = 2.0;   // cm 容差
  const report = [];
  INTERNAL.forEach(id => {
    const p = E.partById[id];
    if (!p) return;
    let sideOver = 0, sideNote = '', roofOver = 0, bellyOver = 0;
    p.meshes.forEach(m => {
      const pos = m.geometry.attributes.position;
      const v = new THREE.Vector3();
      m.updateWorldMatrix(true, false);
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
        const x = v.x / S, y = v.y / S, z = v.z / S;
        const s0 = K.SECTIONS[0].z - 4, s1 = K.SECTIONS[K.SECTIONS.length - 1].z + 4;
        if (z < s0 || z > s1) continue;
        const sec = (function (zz) {          // 取截面（与模型同一套插值）
          const S2 = K.SECTIONS;
          if (zz <= S2[0].z) return S2[0];
          if (zz >= S2[S2.length - 1].z) return S2[S2.length - 1];
          for (let k = 0; k < S2.length - 1; k++) {
            if (zz >= S2[k].z && zz <= S2[k + 1].z) {
              const t = (zz - S2[k].z) / (S2[k + 1].z - S2[k].z);
              return { w: S2[k].w + (S2[k + 1].w - S2[k].w) * t,
                h: S2[k].h + (S2[k + 1].h - S2[k].h) * t,
                y: S2[k].y + (S2[k + 1].y - S2[k].y) * t,
                n: S2[k].n + (S2[k + 1].n - S2[k].n) * t };
            }
          }
          return S2[0];
        })(z);
        const hw = sec.w / 2, hh = sec.h / 2, dy = y - sec.y, n = sec.n;
        if (Math.abs(dy) >= hh) {             // 在截面上下之外 → 判为顶部/腹部外挂
          const over = Math.abs(dy) - hh;
          if (over > roofOver) roofOver = over;
          continue;
        }
        const e = Math.pow(Math.abs(x) / hw, n) + Math.pow(Math.abs(dy) / hh, n);
        if (e > 1) {
          const depth = (Math.pow(e, 1 / n) - 1) * Math.min(hw, hh);
          if (depth > sideOver) {
            sideOver = depth;
            sideNote = 'z=' + z.toFixed(0) + ' y=' + y.toFixed(0) + ' |x|=' + Math.abs(x).toFixed(0) + ' 半宽=' + hw.toFixed(0);
          }
        }
      }
    });
    report.push((sideOver > MARGIN ? '  ✗ 侧面穿壳 ' : '  ok 侧面 ') + id.padEnd(15, ' ') +
      '侧穿=' + sideOver.toFixed(1).padStart(5) + 'cm  顶/腹外挂=' + roofOver.toFixed(1).padStart(5) + 'cm  ' + sideNote);
  });
  console.log('医疗舱内部件穿壳检查（容差 ' + MARGIN + ' cm；顶部/腹部外挂属正常安装）:');
  console.log(report.join('\n'));
  process.exit(0);
})();