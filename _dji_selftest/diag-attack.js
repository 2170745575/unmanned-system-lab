/* 数值核对：武器站各件的世界位置与朝向 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = 'D:\\deepseek工作\\dji-felon-attack';
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
  const el = { tagName: 'DIV', style: { setProperty() {}, removeProperty() {} }, dataset: {}, children: [], _h: {}, _attrs: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    appendChild(c) { el.children.push(c); return c; }, removeChild() {},
    addEventListener(t2, f) { (el._h[t2] = el._h[t2] || []).push(f); }, removeEventListener() {},
    fire(t2, e) { (el._h[t2] || []).forEach(f => f(e || {})); },
    scrollIntoView() {}, querySelector() { return null; }, textContent: '', innerHTML: '', width: 0, height: 0 };
  el.setAttribute = () => {}; el.getAttribute = () => null; el.getContext = () => ctx2d; return el;
}
const registry = {};
globalThis.document = {
  createElement: mkEl, createElementNS: (n, t) => mkEl(t),
  getElementById: id => registry[id] || (registry[id] = mkEl('div')),
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
['enemies.js', 'model-attack.js', 'combat.js', 'engine.js'].forEach(f =>
  new Function(fs.readFileSync(path.join(ROOT, f), 'utf8'))());

(async function () {
  await new Promise(r => setTimeout(r, 40));
  for (let i = 0; i < 8; i++) { const cb = rafQueue.shift(); if (!cb) break; fakeNow += 33; cb(); }
  const E = globalThis.DJIEngine.E;
  E.scene.updateMatrixWorld(true);
  const THREE2 = globalThis.THREE;
  function wpos(partId) {
    const p = E.partById[partId];
    if (!p) return null;
    const b = new THREE2.Box3();
    p.group.updateWorldMatrix(true, true);
    p.group.traverse(function (o) {
      if (!o.isMesh || o.userData.noPick) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      const bb = o.geometry.boundingBox.clone();
      bb.applyMatrix4(o.matrixWorld);
      b.union(bb);
    });
    return b.getCenter(new THREE2.Vector3());
  }
  const rows = [
    ['nosePod 吊舱', wpos('nosePod')],
    ['cannon 机炮', wpos('cannon')],
    ['turretYaw 方位座', wpos('turretYaw')],
    ['ammoDrum 弹鼓', wpos('ammoDrum')],
    ['recoilDamper 弹簧', wpos('recoilDamper')],
    ['missileRail 挂架', wpos('missileRail')],
    ['missileL 弹药', wpos('missileL')],
    ['missileR 弹药', wpos('missileR')],
    ['landingGear 起落架', wpos('landingGear')],
    ['bodyLower 机身', wpos('bodyLower')],
    ['bodyUpper 上盖', wpos('bodyUpper')]
  ];
  console.log('机体局部坐标 = cm，root.scale=0.5，世界单位 = cm × 0.5');
  console.log('（+Z = 机头方向）\n');
  rows.forEach(r => {
    const v = r[1];
    console.log('  ' + r[0].padEnd(20, ' ') + (v
      ? 'x=' + v.x.toFixed(2) + '  y=' + v.y.toFixed(2) + '  z=' + v.z.toFixed(2)
      : 'n/a'));
  });
  // 炮口方向
  const can = E.partById['cannon'];
  const q = can.group.getWorldQuaternion(new THREE2.Quaternion());
  const dir = new THREE2.Vector3(0, 0, 1).applyQuaternion(q);
  console.log('\n  炮管指向（世界）        x=' + dir.x.toFixed(3) + '  y=' + dir.y.toFixed(3) + '  z=' + dir.z.toFixed(3));
  console.log('  → z 分量为正表示朝机头（前）方向，y 为负表示向下俯角：' + (dir.z > 0 ? '朝前 OK' : '朝后 ✗') +
    ' / ' + (dir.y <= 0 ? '向下 OK' : '向上 ✗'));
  process.exit(0);
})();