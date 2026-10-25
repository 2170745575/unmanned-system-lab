/* 浅穿审计：用真实几何判定"某部件有小部分插进另一部件内部"
   原理：对包围盒相交的部件对，取小部件的顶点，用射线穿越计数判断点是否在
   另一部件网格内部；内部顶点占比在 5%~45% = 只戳进去一点点（浅穿），
   占比 >60% 视为有意嵌套（例如电池在机身壳内），不报告。
   用法：ROOT/FILES/MODEL 环境变量；输出按侵入顶点数排序的表格。 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = process.env.ROOT;
const FILES = process.env.FILES.split(',');
const OUT = process.env.OUT || path.join(__dirname, 'clip.json');
const THREE = require(path.join(ROOT, 'vendor', 'three.min.js'));

// ---- 最小 DOM 桩（与 dump_generic 一致）----
let fakeNow = 0;
Object.defineProperty(globalThis, 'performance', { value: { now: () => fakeNow }, configurable: true });
const grad = { addColorStop() {} };
const ctx2d = new Proxy({}, { get(t, p) {
  if (p === 'createLinearGradient' || p === 'createRadialGradient') return () => grad;
  if (p === 'measureText') return () => ({ width: 10 });
  return function () {};
}, set() { return true; } });
function mkEl(tag) {
  const el = { tagName: String(tag || 'div').toUpperCase(), style: { setProperty() {} }, dataset: {},
    children: [], _h: {}, _attrs: {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    appendChild(c) { el.children.push(c); return c; }, removeChild() {},
    addEventListener(k, f) { (el._h[k] = el._h[k] || []).push(f); }, removeEventListener() {},
    fire() {}, scrollIntoView() {}, querySelector() { return null; },
    textContent: '', innerHTML: '', width: 0, height: 0 };
  el.setAttribute = () => {}; el.getAttribute = () => null; el.getContext = () => ctx2d;
  return el;
}
const reg = {};
globalThis.document = {
  createElement: mkEl, createElementNS: (n, t) => mkEl(t),
  getElementById: id => reg[id] || (reg[id] = mkEl()),
  querySelectorAll: () => [], querySelector: () => null,
  head: { appendChild(s) { setTimeout(() => {
    if (s.src.indexOf('vendor') >= 0) { globalThis.THREE = THREE; globalThis.window.THREE = THREE; s.onload && s.onload(); }
    else s.onerror && s.onerror(); }, 0); } },
  body: null, documentElement: { style: { setProperty() {} } }, addEventListener() {}
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
  this.compileEquirectangularShader = () => {};
  this.fromEquirectangular = () => ({ texture: new THREE.Texture() }); this.dispose = () => {};
};
const raf = [];
globalThis.requestAnimationFrame = cb => { raf.push(cb); };
globalThis.cancelAnimationFrame = () => {};
FILES.forEach(f => new Function(fs.readFileSync(path.join(ROOT, f), 'utf8'))());

function pump(n) {
  return new Promise(res => {
    let i = 0;
    (function step() {
      if (i++ >= n) return res();
      const cb = raf.shift(); if (!cb) return res();
      fakeNow += 33; cb(); setTimeout(step, 0);
    })();
  });
}

/* 世界空间三角面：Float64 数组 [ax,ay,az, bx,by,bz, cx,cy,cz, ...] */
function partTris(p) {
  const tri = [];
  p.meshes.forEach(m => {
    if (!m.geometry || !m.geometry.attributes || !m.geometry.attributes.position) return;
    if (m.userData && m.userData.noPick) return;
    const g = m.geometry, pos = g.attributes.position, idx = g.index;
    m.updateWorldMatrix(true, false);
    const mw = m.matrixWorld;
    const n = idx ? idx.count : pos.count;
    const v = new THREE.Vector3();
    for (let i = 0; i < n; i += 3) {
      for (let k = 0; k < 3; k++) {
        const j = idx ? idx.getX(i + k) : (i + k);
        v.fromBufferAttribute(pos, j).applyMatrix4(mw);
        tri.push(v.x, v.y, v.z);
      }
    }
  });
  return tri;
}

function trisBox(tri) {
  let mnx = Infinity, mny = Infinity, mnz = Infinity, mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
  for (let i = 0; i < tri.length; i += 3) {
    const x = tri[i], y = tri[i + 1], z = tri[i + 2];
    if (x < mnx) mnx = x; if (x > mxx) mxx = x;
    if (y < mny) mny = y; if (y > mxy) mxy = y;
    if (z < mnz) mnz = z; if (z > mxz) mxz = z;
  }
  return { mnx, mny, mnz, mxx, mxy, mxz, vol: (mxx - mnx) * (mxy - mny) * (mxz - mnz) };
}

/* 点是否在三角面集合内部：沿 +X 射线做穿越计数（投影到 (z,y) 平面） */
function insideX(px, py, pz, tri, bb) {
  if (px < bb.mnx - 1e-6 || px > bb.mxx + 1e-6) return false;
  if (py < bb.mny || py > bb.mxy || pz < bb.mnz || pz > bb.mxz) return false;
  let cross = 0;
  for (let i = 0; i < tri.length; i += 9) {
    const z1 = tri[i + 2], y1 = tri[i + 1];
    const z2 = tri[i + 5], y2 = tri[i + 4];
    const z3 = tri[i + 8], y3 = tri[i + 7];
    // 点在三角形 (z,y) 投影内？
    const d1 = (z2 - z1) * (py - y1) - (y2 - y1) * (pz - z1);
    const d2 = (z3 - z2) * (py - y2) - (y3 - y2) * (pz - z2);
    const d3 = (z1 - z3) * (py - y3) - (y1 - y3) * (pz - z3);
    const hasNeg = (d1 < 0) || (d2 < 0) || (d3 < 0);
    const hasPos = (d1 > 0) || (d2 > 0) || (d3 > 0);
    if (hasNeg && hasPos) continue;
    // 求该三角形平面在点处与 +X 的交点
    const ax = tri[i], bx = tri[i + 3], cx = tri[i + 6];
    // 重心坐标（用 (z,y) 投影面积法）
    const area = (z2 - z1) * (y3 - y1) - (y2 - y1) * (z3 - z1);
    if (Math.abs(area) < 1e-12) continue;
    const w1 = ((z2 - pz) * (y3 - py) - (y2 - py) * (z3 - pz)) / area;
    const w2 = ((z3 - pz) * (y1 - py) - (y3 - py) * (z1 - pz)) / area;
    const w3 = 1 - w1 - w2;
    const hx = w1 * ax + w2 * bx + w3 * cx;
    if (hx > px) cross++;
  }
  return (cross % 2) === 1;
}

(async function () {
  await new Promise(r => setTimeout(r, 40));
  await pump(8);
  const E = globalThis.DJIEngine.E;
  E.scene.updateMatrixWorld(true);

  const parts = E.parts.filter(p => p.meshes && p.meshes.length)
    .filter(p => !(p.def && /prop|rotor|blade|disc/i.test(p.def.id || '')));   // 旋翼单独看，先排除
  const data = parts.map(p => {
    const tri = partTris(p);
    return { id: p.def.id, name: p.def.name, tri, bb: tri.length ? trisBox(tri) : null };
  }).filter(d => d.bb && d.tri.length > 0);
  const span = Math.max.apply(null, data.map(d => Math.max(d.bb.mxx - d.bb.mnx, d.bb.mxy - d.bb.mny, d.bb.mxz - d.bb.mnz)));

  const hits = [];
  for (let i = 0; i < data.length; i++) {
    for (let j = 0; j < data.length; j++) {
      if (i === j) continue;
      const A = data[i], B = data[j];
      if (A.bb.vol > B.bb.vol) continue;              // 只让小件对大件
      // 包围盒相交粗筛
      if (A.bb.mxx < B.bb.mnx || A.bb.mnx > B.bb.mxx) continue;
      if (A.bb.mxy < B.bb.mny || A.bb.mny > B.bb.mxy) continue;
      if (A.bb.mxz < B.bb.mnz || A.bb.mnz > B.bb.mxz) continue;
      const sizeA = Math.max(A.bb.mxx - A.bb.mnx, A.bb.mxy - A.bb.mny, A.bb.mxz - A.bb.mnz);
      if (sizeA < span * 0.012) continue;             // 太小的零件（螺钉级）跳过
      // 抽样 A 的顶点
      const nv = A.tri.length / 9 * 3;
      const stepV = Math.max(1, Math.floor(nv / 70));
      let inside = 0, tested = 0;
      const px = [], py = [], pz = [];
      for (let v = 0; v < nv; v += stepV) {
        px.push(A.tri[v * 3]); py.push(A.tri[v * 3 + 1]); pz.push(A.tri[v * 3 + 2]);
      }
      for (let k = 0; k < px.length; k++) {
        tested++;
        if (insideX(px[k], py[k], pz[k], B.tri, B.bb)) inside++;
      }
      if (!tested) continue;
      const frac = inside / tested;
      if (frac >= 0.05 && frac <= 0.45) {
        hits.push({ a: A.id, aName: A.name, b: B.id, bName: B.name,
          frac, inside, tested, size: +(sizeA / E.ROOT_SCALE).toFixed(1) });
      }
    }
  }
  hits.sort((x, y) => y.frac - x.frac);
  console.log('部件 ' + data.length + ' 个，整机跨度 ' + (span / E.ROOT_SCALE).toFixed(0) + ' cm');
  console.log('浅穿可疑对（小件有 5%~45% 顶点落在另一部件内部）: ' + hits.length);
  hits.slice(0, 14).forEach(h => {
    console.log('  ' + h.a.padEnd(16) + ' -> ' + h.b.padEnd(16) +
      ' 内部顶点 ' + h.inside + '/' + h.tested + ' (' + (h.frac * 100).toFixed(0) + '%)' +
      '  小件跨度 ' + h.size + ' cm');
  });
  fs.writeFileSync(OUT, JSON.stringify(hits, null, 1));
  process.exit(0);
})();