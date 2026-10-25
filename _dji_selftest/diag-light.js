/* 光照诊断：列出场景里的光源、材质与阴影参数 */
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
function mkEl() {
  const el = { tagName: 'DIV', style: { setProperty() {}, removeProperty() {} }, dataset: {}, children: [], _h: {}, _attrs: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    appendChild(c) { el.children.push(c); return c; }, removeChild() {},
    addEventListener(t, f) { (el._h[t] = el._h[t] || []).push(f); }, removeEventListener() {},
    fire(t, e) { (el._h[t] || []).forEach(f => f(e || {})); },
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
let rendererStub = null;
THREE.WebGLRenderer = function () {
  this.domElement = mkEl(); this.domElement.setPointerCapture = () => {};
  this.shadowMap = {}; this.setPixelRatio = () => {}; this.setSize = () => {}; this.render = () => {};
  this.outputEncoding = null; this.toneMapping = null; this.toneMappingExposure = 1;
  rendererStub = this;
};
THREE.PMREMGenerator = function () {
  this.compileEquirectangularShader = () => {};
  this.fromEquirectangular = () => ({ texture: new THREE.Texture() });
  this.dispose = () => {};
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

  console.log('=== 光源 ===');
  let n = 0;
  E.scene.traverse(o => {
    if (!o.isLight) return;
    n++;
    console.log('  ' + (o.type || '?').padEnd(18, ' ') +
      ' intensity=' + o.intensity +
      ' color=#' + (o.color ? o.color.getHexString() : '-') +
      ' pos=' + (o.position ? '(' + o.position.x + ',' + o.position.y + ',' + o.position.z + ')' : '-') +
      (o.castShadow ? '  castShadow' : ''));
  });
  console.log('  光源总数: ' + n);

  console.log('\n=== 场景/渲染器 ===');
  console.log('  scene.environment: ' + (E.scene.environment ? '有' : '无'));
  console.log('  scene.background : ' + (E.scene.background ? E.scene.background.type || 'Texture' : '无'));
  console.log('  scene.fog        : ' + (E.scene.fog ? E.scene.fog.type + ' density=' + E.scene.fog.density : '无'));
  console.log('  ambientLight?    : ' + !!E.scene.children.find(c => c.isAmbientLight));
  console.log('  outputEncoding   : ' + rendererStub.outputEncoding + '  (sRGBEncoding=' + THREE.sRGBEncoding + ')');
  console.log('  toneMapping      : ' + rendererStub.toneMapping + '  exposure=' + rendererStub.toneMappingExposure);
  console.log('  shadowMap        : enabled=' + rendererStub.shadowMap.enabled + ' type=' + rendererStub.shadowMap.type);

  console.log('\n=== 机体材质抽样 ===');
  const seen = new Set();
  let cnt = 0;
  E.root.traverse(o => {
    if (!o.isMesh) return;
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    if (!m || seen.has(m.uuid)) return;
    seen.add(m.uuid);
    if (cnt++ > 6) return;
    console.log('  ' + (o.userData.partId || '-').padEnd(14, ' ') + (m.type || '?').padEnd(22, ' ') +
      ' color=#' + (m.color ? m.color.getHexString() : '-') +
      ' metalness=' + m.metalness + ' roughness=' + m.roughness.toFixed(2) +
      ' emissive=#' + (m.emissive ? m.emissive.getHexString() : '-') +
      ' side=' + m.side + ' map=' + (m.map ? 'Y' : 'N') +
      ' envMapIntensity=' + (m.envMapIntensity !== undefined ? m.envMapIntensity : '-'));
  });

  console.log('\n=== 阴影相机 ===');
  const key = E.scene.children.find(c => c.isDirectionalLight && c.castShadow);
  if (key) {
    const c = key.shadow.camera;
    console.log('  light pos=(' + key.position.x + ',' + key.position.y + ',' + key.position.z + ')' +
      ' target=(' + key.target.position.x + ',' + key.target.position.y + ',' + key.target.position.z + ')');
    console.log('  shadow cam l/r/t/b = ' + c.left + '/' + c.right + '/' + c.top + '/' + c.bottom + ' near=' + c.near + ' far=' + c.far);
    console.log('  mapSize = ' + key.shadow.mapSize.x + 'x' + key.shadow.mapSize.y +
      '  bias=' + key.shadow.bias + '  normalBias=' + (key.shadow.normalBias !== undefined ? key.shadow.normalBias : 'n/a'));
  } else {
    console.log('  ✗ 没有投影主光！');
  }

  // 用 three 自己算一遍：把相机放在光源方向看场景，包围盒是否落在阴影相机视锥内
  const box = new THREE.Box3().setFromObject(E.scene);
  console.log('\n  场景包围盒: ' + JSON.stringify({
    min: [+box.min.x.toFixed(1), +box.min.y.toFixed(1), +box.min.z.toFixed(1)],
    max: [+box.max.x.toFixed(1), +box.max.y.toFixed(1), +box.max.z.toFixed(1)]
  }));
  process.exit(0);
})();