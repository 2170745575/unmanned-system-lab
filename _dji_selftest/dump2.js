/* 把 app.js 构建出的模型导出成三角形 + 颜色，供 Python 软件渲染检查外观 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = process.env.PROJ || 'D:\\deepseek工作\\dji-action4-3d';
const OUT = process.env.OUT || 'D:\\deepseek工作\\_dji_selftest\\model.json';
const THREE = require(path.join(ROOT, 'vendor', 'three.min.js'));

const grad = { addColorStop() {} };
const ctx2d = new Proxy({}, {
  get(t, p) {
    if (p === 'createLinearGradient' || p === 'createRadialGradient') return () => grad;
    if (p === 'measureText') return () => ({ width: 10 });
    return function () {};
  },
  set() { return true; }
});
function mkEl(tag) {
  const el = {
    tagName: String(tag || 'div').toUpperCase(),
    style: { setProperty() {}, removeProperty() {} }, dataset: {}, children: [], _h: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    appendChild(c) { el.children.push(c); c.parentNode = el; return c; },
    removeChild() {}, addEventListener(t, f) { (el._h[t] = el._h[t] || []).push(f); },
    removeEventListener() {}, setAttribute() {}, getAttribute() { return null; },
    fire(t, ev) { (el._h[t] || []).forEach(f => f(ev || {})); },
    scrollIntoView() {}, querySelector() { return null; },
    textContent: '', innerHTML: '', width: 0, height: 0
  };
  el.getContext = () => ctx2d;
  return el;
}
const registry = {};
const documentStub = {
  createElement: mkEl, createElementNS: (n, t) => mkEl(t),
  getElementById: id => registry[id] || (registry[id] = mkEl('div')),
  querySelectorAll: () => [], querySelector: () => null,
  head: {
    appendChild(s) {
      setTimeout(() => {
        if (s.src.indexOf('vendor') >= 0) { globalThis.window.THREE = THREE; s.onload && s.onload(); }
        else { s.onerror && s.onerror(); }
      }, 0);
    }
  },
  body: { style: {} }, addEventListener() {}
};
const winListeners = {};
const windowStub = {
  innerWidth: 1600, innerHeight: 900, devicePixelRatio: 1,
  addEventListener(t, f) { (winListeners[t] = winListeners[t] || []).push(f); }, removeEventListener() {}
};
THREE.WebGLRenderer = function () {
  this.domElement = mkEl('canvas');
  this.domElement.setPointerCapture = () => {};
  this.shadowMap = {}; this.setPixelRatio = () => {}; this.setSize = () => {};
  this.render = () => {}; this.outputEncoding = null; this.toneMapping = null; this.toneMappingExposure = 1;
};
THREE.PMREMGenerator = function () {
  this.compileEquirectangularShader = () => {};
  this.fromEquirectangular = () => ({ texture: new THREE.Texture() });
  this.dispose = () => {};
};
const _Group = THREE.Group; const allGroups = [];
THREE.Group = function () { const g = new _Group(); allGroups.push(g); return g; };

const rafQueue = [];
globalThis.THREE = THREE; globalThis.window = windowStub; globalThis.document = documentStub;
globalThis.requestAnimationFrame = cb => { rafQueue.push(cb); };
globalThis.cancelAnimationFrame = () => {};

new Function(fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8'))();

function pump(n) {
  return new Promise(res => {
    let i = 0;
    (function step() { if (i++ >= n) return res(); const cb = rafQueue.shift(); if (!cb) return res(); cb(); setTimeout(step, 16); })();
  });
}

(async function () {
  await new Promise(r => setTimeout(r, 40));
  await pump(10);
  const partGroups = allGroups.filter(g => g.userData && g.userData.partId);

  function grab() {
    const out = [];
    partGroups.forEach(g => {
      g.updateWorldMatrix(true, true);
      g.traverse(o => {
        if (!o.isMesh || o.userData.noPick) return;
        const geo = o.geometry;
        const pos = geo.attributes.position;
        const idx = geo.index;
        const m = Array.isArray(o.material) ? o.material[0] : o.material;
        const col = m.color ? m.color.getHex() : 0x999999;
        const hasMap = !!m.map;
        const tri = [];
        const n = idx ? idx.count : pos.count;
        const v = new THREE.Vector3();
        for (let i = 0; i < n; i++) {
          const j = idx ? idx.getX(i) : i;
          v.fromBufferAttribute(pos, j).applyMatrix4(o.matrixWorld);
          tri.push(+v.x.toFixed(4), +v.y.toFixed(4), +v.z.toFixed(4));
        }
        out.push({ part: o.userData.partId, color: col, hasMap: hasMap,
          metalness: m.metalness !== undefined ? m.metalness : 0,
          roughness: m.roughness !== undefined ? m.roughness : 0.5,
          emissive: (m.emissive && (m.emissive.r + m.emissive.g + m.emissive.b) > 0.15) ? m.emissive.getHex() : null,
          v: tri });
      });
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

  const sceneRoot = (function () { let s = partGroups[0]; while (s && s.parent) s = s.parent; return s; })();

  const collapsed = grab();
  registry['btn-explode'].fire('click');
  await pump(70);
  const moved = partGroups.filter(g => g.position.length() > 0.5).length;
  const exploded = grab();

  fs.writeFileSync(OUT, JSON.stringify({
    collapsed: collapsed, exploded: exploded,
    lights: grabLights(sceneRoot), exposure: 1.08
  }));
  const tris = collapsed.reduce((a, m) => a + m.v.length / 9, 0);
  console.log('collapsed meshes ' + collapsed.length + ', triangles ' + tris + ', exploded parts ' + moved + '/' + partGroups.length);
  process.exit(0);
})();