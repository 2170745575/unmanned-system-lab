/* 穿模检测（真实几何）：BVH + 多方向 ray-parity inside 投票 + 穿透深度估计
   env: ROOT FILES MODEL_GLOBAL [N=900] [SKIP=a,b] [SPIN=1] [BB=1] [SELF=1] [DEEP=0.15] */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = process.env.ROOT;
const FILES = (process.env.FILES || '').split(',');
const GLOBAL = process.env.MODEL_GLOBAL;
const NS = parseInt(process.env.N || '900', 10);
const SKIP = (process.env.SKIP || '').split(',').filter(Boolean);
const USE_SPIN = process.env.SPIN === '1';
const DEEP = parseFloat(process.env.DEEP || '0.15');
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
  catch (e) { loadErr = f + ': ' + e.stack; break; }
}
if (loadErr) { console.log('模块执行失败: ' + loadErr); process.exit(1); }

/* ---------------- BVH ---------------- */
const LEAF = 8;
function buildBVH(tris) {
  const T = tris.length / 9;
  const idx = new Uint32Array(T);
  const cx = new Float32Array(T), cy = new Float32Array(T), cz = new Float32Array(T);
  for (let i = 0; i < T; i++) {
    idx[i] = i;
    const o = i * 9;
    cx[i] = (tris[o] + tris[o + 3] + tris[o + 6]) / 3;
    cy[i] = (tris[o + 1] + tris[o + 4] + tris[o + 7]) / 3;
    cz[i] = (tris[o + 2] + tris[o + 5] + tris[o + 8]) / 3;
  }
  const nodes = [];
  function mk(lo, hi, depth) {
    let mnx = Infinity, mny = Infinity, mnz = Infinity, mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
    for (let i = lo; i < hi; i++) {
      const o = idx[i] * 9;
      for (let k = 0; k < 3; k++) {
        const x = tris[o + k * 3], y = tris[o + k * 3 + 1], z = tris[o + k * 3 + 2];
        if (x < mnx) mnx = x; if (x > mxx) mxx = x;
        if (y < mny) mny = y; if (y > mxy) mxy = y;
        if (z < mnz) mnz = z; if (z > mxz) mxz = z;
      }
    }
    const node = { mnx, mny, mnz, mxx, mxy, mxz, lo, hi, left: -1, right: -1 };
    nodes.push(node);
    const ni = nodes.length - 1;
    if (hi - lo <= LEAF || depth <= 0) return ni;
    const ex = mxx - mnx, ey = mxy - mny, ez = mxz - mnz;
    const ax = ex >= ey && ex >= ez ? 1 : (ey >= ez ? 2 : 3);
    const arr = Array.prototype.slice.call(idx, lo, hi);
    const cmp = ax === 1 ? (a, b) => cx[a] - cx[b] : ax === 2 ? (a, b) => cy[a] - cy[b] : (a, b) => cz[a] - cz[b];
    arr.sort(cmp);
    for (let i = 0; i < arr.length; i++) idx[lo + i] = arr[i];
    const mid = (lo + hi) >> 1;
    if (mid > lo) { node.left = mk(lo, mid, depth - 1); node.right = mk(mid, hi, depth - 1); }
    return ni;
  }
  const root = T ? mk(0, T, 40) : -1;
  return { tris, idx, nodes, root, T };
}
const EPS = 1e-5;
function slabHit(n, ox, oy, oz, ix, iy, iz) {
  let t0 = -Infinity, t1 = Infinity, a, b, t;
  a = (n.mnx - ox) * ix; b = (n.mxx - ox) * ix; if (a > b) { t = a; a = b; b = t; }
  if (a > t0) t0 = a; if (b < t1) t1 = b; if (t0 > t1) return false;
  a = (n.mny - oy) * iy; b = (n.mxy - oy) * iy; if (a > b) { t = a; a = b; b = t; }
  if (a > t0) t0 = a; if (b < t1) t1 = b; if (t0 > t1) return false;
  a = (n.mnz - oz) * iz; b = (n.mxz - oz) * iz; if (a > b) { t = a; a = b; b = t; }
  if (a > t0) t0 = a; if (b < t1) t1 = b; if (t0 > t1) return false;
  return t1 > EPS;
}
function mt(bvh, t9, ox, oy, oz, dx, dy, dz) {
  const T = bvh.tris;
  const ax = T[t9], ay = T[t9 + 1], az = T[t9 + 2];
  const e1x = T[t9 + 3] - ax, e1y = T[t9 + 4] - ay, e1z = T[t9 + 5] - az;
  const e2x = T[t9 + 6] - ax, e2y = T[t9 + 7] - ay, e2z = T[t9 + 8] - az;
  const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (det > -1e-12 && det < 1e-12) return -1;
  const inv = 1 / det;
  const tx = ox - ax, ty = oy - ay, tz = oz - az;
  const u = (tx * px + ty * py + tz * pz) * inv;
  if (u < -1e-9 || u > 1 + 1e-9) return -1;
  const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
  const v = (dx * qx + dy * qy + dz * qz) * inv;
  if (v < -1e-9 || u + v > 1 + 1e-9) return -1;
  const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
  return t > EPS ? t : -1;
}
function rayHits(bvh, ox, oy, oz, dx, dy, dz) {
  const out = [];
  if (bvh.root < 0) return out;
  const ix = 1 / dx, iy = 1 / dy, iz = 1 / dz;
  const stack = [bvh.root];
  while (stack.length) {
    const n = bvh.nodes[stack.pop()];
    if (!slabHit(n, ox, oy, oz, ix, iy, iz)) continue;
    if (n.left < 0) {
      for (let i = n.lo; i < n.hi; i++) {
        const t = mt(bvh, bvh.idx[i] * 9, ox, oy, oz, dx, dy, dz);
        if (t >= 0) out.push(t);
      }
    } else { stack.push(n.left, n.right); }
  }
  return out;
}
function norm(v) { const L = Math.hypot(v[0], v[1], v[2]); return [v[0] / L, v[1] / L, v[2] / L]; }
/* 5 个投票方向（全部避开坐标轴，降低与平面/棱边擦边导致的计数错误） */
const VDIRS = [norm([0.31, 0.62, 0.72]), norm([-0.77, 0.45, 0.44]), norm([0.55, -0.71, 0.44]),
  norm([0.20, 0.20, -0.96]), norm([0.88, 0.33, -0.33])];
/* 14 个深度方向 */
const DIRS = (function () {
  const d = [];
  [[1, 0, 0], [0, 1, 0], [0, 0, 1]].forEach(a => { d.push(a); d.push([-a[0], -a[1], -a[2]]); });
  for (let i = 0; i < 8; i++) d.push(norm([(i & 1) ? 1 : -1, (i & 2) ? 1 : -1, (i & 4) ? 1 : -1]));
  return d;
})();
function insideVotes(bvh, ox, oy, oz) {
  let v = 0, best = Infinity;
  for (const d of VDIRS) {
    const h = rayHits(bvh, ox, oy, oz, d[0], d[1], d[2]);
    if (h.length % 2 === 1) { v++; for (const t of h) if (t < best) best = t; }
  }
  return { v, exit: best };
}
function depthAt(bvh, ox, oy, oz) {
  let best = Infinity;
  for (const d of DIRS) {
    const h = rayHits(bvh, ox, oy, oz, d[0], d[1], d[2]);
    for (const t of h) if (t < best) best = t;
  }
  return best;
}
const TMP = new THREE.Vector3();

/* ---------------- 采样 ---------------- */
function lcg(seed) { let s = seed >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }
function samplePoints(tris, n, seed) {
  const T = tris.length / 9;
  const cum = new Float64Array(T);
  let tot = 0;
  for (let i = 0; i < T; i++) {
    const o = i * 9;
    const ax = tris[o], ay = tris[o + 1], az = tris[o + 2];
    const b1x = tris[o + 3] - ax, b1y = tris[o + 4] - ay, b1z = tris[o + 5] - az;
    const b2x = tris[o + 6] - ax, b2y = tris[o + 7] - ay, b2z = tris[o + 8] - az;
    const cxv = b1y * b2z - b1z * b2y, cyv = b1z * b2x - b1x * b2z, czv = b1x * b2y - b1y * b2x;
    tot += Math.sqrt(cxv * cxv + cyv * cyv + czv * czv) / 2;
    cum[i] = tot;
  }
  const rnd = lcg(seed);
  const out = [];
  const cnt = Math.max(80, Math.min(n, T));
  for (let k = 0; k < cnt; k++) {
    const r = rnd() * tot;
    let lo = 0, hi = T - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < r) lo = mid + 1; else hi = mid; }
    const o = lo * 9;
    let u = rnd(), v = rnd();
    if (u + v > 1) { u = 1 - u; v = 1 - v; }
    const w = 1 - u - v;
    out.push([tris[o] * w + tris[o + 3] * u + tris[o + 6] * v,
      tris[o + 1] * w + tris[o + 4] * u + tris[o + 7] * v,
      tris[o + 2] * w + tris[o + 5] * u + tris[o + 8] * v]);
  }
  return out;
}

(async function () {
  await new Promise(r => setTimeout(r, 40));
  for (let i = 0; i < 8; i++) { const cb = rafQueue.shift(); if (!cb) break; fakeNow += 33; cb(); }
  const E = globalThis.DJIEngine.E;
  const M = globalThis[GLOBAL] || globalThis.window[GLOBAL];
  if (!E || !M) { console.log('未构建成功'); process.exit(2); }
  console.log('机型: ' + M.title + '   foldT=' + (E.S && E.S.foldT) + '  rootScale=' + M.scene.rootScale);
  E.scene.updateMatrixWorld(true);

  const rootInv = new THREE.Matrix4().copy(E.root.matrixWorld).invert();
  const mwTmp = new THREE.Matrix4();
  const P = [];
  E.parts.forEach((p, i) => {
    const pos = [];
    p.meshes.forEach(m => {
      const g = m.geometry, at = g.attributes.position, ix = g.index;
      m.updateWorldMatrix(true, false);
      const mw = mwTmp.multiplyMatrices(rootInv, m.matrixWorld);
      const n = ix ? ix.count : at.count;
      for (let k = 0; k < n; k += 3) {
        for (let j = 0; j < 3; j++) {
          const q = ix ? ix.getX(k + j) : (k + j);
          TMP.fromBufferAttribute(at, q).applyMatrix4(mw);
          pos.push(TMP.x, TMP.y, TMP.z);
        }
      }
    });
    const tris = new Float32Array(pos);
    const bvh = buildBVH(tris);
    const pts = samplePoints(tris, NS, 12345 + i * 977);
    const bb = { mnx: Infinity, mny: Infinity, mnz: Infinity, mxx: -Infinity, mxy: -Infinity, mxz: -Infinity };
    for (let k = 0; k < tris.length; k += 3) {
      const x = tris[k], y = tris[k + 1], z = tris[k + 2];
      if (x < bb.mnx) bb.mnx = x; if (x > bb.mxx) bb.mxx = x;
      if (y < bb.mny) bb.mny = y; if (y > bb.mxy) bb.mxy = y;
      if (z < bb.mnz) bb.mnz = z; if (z > bb.mxz) bb.mxz = z;
    }
    P.push({ id: p.def.id, name: p.def.name, tris, bvh, pts, bb, T: tris.length / 9, spinAt: p.def.spinAt || null });
  });
  console.log('部件 ' + P.length + '  三角面 ' + P.reduce((s, p) => s + p.T, 0) + '  采样 ' + P[0].pts.length + '/部件');
  if (process.env.BB === '1') {
    P.forEach(p => console.log('  ' + p.id.padEnd(18) + ' x[' + p.bb.mnx.toFixed(2) + ',' + p.bb.mxx.toFixed(2) +
      '] y[' + p.bb.mny.toFixed(2) + ',' + p.bb.mxy.toFixed(2) + '] z[' + p.bb.mnz.toFixed(2) + ',' + p.bb.mxz.toFixed(2) + ']'));
  }
  /* ---- 自检：与解析超椭圆机壳公式比对 ---- */
  if (process.env.SELF === '1' && M.constants && M.constants.halfWidthAt) {
    const C = M.constants;
    const S = C.SECTIONS;
    const sectionAt = z => {
      if (z <= S[0].z) return S[0];
      if (z >= S[S.length - 1].z) return S[S.length - 1];
      for (let i = 0; i < S.length - 1; i++) {
        if (z >= S[i].z && z <= S[i + 1].z) {
          const t = (z - S[i].z) / (S[i + 1].z - S[i].z);
          return { w: S[i].w + (S[i + 1].w - S[i].w) * t, h: S[i].h + (S[i + 1].h - S[i].h) * t,
            y: S[i].y + (S[i + 1].y - S[i].y) * t, n: S[i].n + (S[i + 1].n - S[i].n) * t };
        }
      }
      return S[0];
    };
    /* sectionArc 里 upper/lower 的接缝平面实际在 y = 2*yc - seam（seam 关于截面中心镜像） */
    const splitAt = z => 2 * sectionAt(z).y - C.SEAM;
    const hull = (part) => {
      const A = P.find(p => p.id === (part === 'upper' ? 'bodyUpper' : 'bodyLower'));
      if (!A) { console.log('  自检 ' + part + ': 无对应部件，跳过'); return; }
      const rnd = lcg(999);
      let bad = 0, worst = 0, n = 0;
      for (let k = 0; k < 40000; k++) {
        const x = (rnd() * 2 - 1) * 3.6;
        const z = A.bb.mnz + rnd() * (A.bb.mxz - A.bb.mnz);
        if (z < S[0].z + 0.05 || z > S[S.length - 1].z - 0.05) continue;
        const sec = sectionAt(z), sp = splitAt(z);
        const y = A.bb.mny + rnd() * (A.bb.mxy - A.bb.mny);
        const inSeam = part === 'upper' ? y > sp : y < sp;
        if (!inSeam) continue;
        const hw = C.halfWidthAt(z, y);
        const analytic = Math.abs(x) < hw;
        const top = sec.y + sec.h / 2, bot = sec.y - sec.h / 2;
        const clearance = Math.min(Math.abs(y - sp), hw - Math.abs(x), top - y, y - bot);
        if (clearance < 0.3) continue;              // 靠近表面/接缝的点不参与比对
        n++;
        const v = insideVotes(A.bvh, x, y, z).v >= 3;
        if (v !== analytic) { bad++; if (clearance > worst) worst = clearance; }
      }
      console.log('  自检 ' + A.id + ': 内部点 ' + n + '  与解析公式不一致 ' + bad +
        (bad ? '  最大离面距离=' + worst.toFixed(3) : '') + '  ' + (bad / Math.max(1, n) < 0.02 ? '✓ 判据可信' : '✗ 判据可疑'));
    };
    hull('upper'); hull('lower');
  }

  const spinOn = p => p.spinAt && USE_SPIN;
  const angles = [0, 0.785, 1.571, 2.356, 3.142, 3.927, 4.712, 5.498];
  const RY = (p, a) => { const ca = Math.cos(a), sa = Math.sin(a), cx = p.spinAt[0], cz = p.spinAt[2];
    return pt => { const x = pt[0] - cx, z = pt[2] - cz; return [cx + x * ca - z * sa, pt[1], cz + x * sa + z * ca]; }; };

  const rows = [], nest = [];
  const bboxHit = [];
  for (let i = 0; i < P.length; i++) {
    for (let j = 0; j < P.length; j++) {
      if (i === j) continue;
      const A = P[i], B = P[j];
      if (SKIP.indexOf(A.id) >= 0 || SKIP.indexOf(B.id) >= 0) continue;
      if (A.bb.mnx > B.bb.mxx || A.bb.mxx < B.bb.mnx ||
          A.bb.mny > B.bb.mxy || A.bb.mxy < B.bb.mny ||
          A.bb.mnz > B.bb.mxz || A.bb.mxz < B.bb.mnz) continue;
      bboxHit.push(A.id + '↔' + B.id);
      const cand = A.pts.filter(q => q[0] >= B.bb.mnx - 0.05 && q[0] <= B.bb.mxx + 0.05 &&
        q[1] >= B.bb.mny - 0.05 && q[1] <= B.bb.mxy + 0.05 &&
        q[2] >= B.bb.mnz - 0.05 && q[2] <= B.bb.mxz + 0.05);
      if (!cand.length) continue;
      const testAngles = spinOn(A) ? angles : [null];
      let bestInside = 0, bestPts = [], bestCand = cand;
      for (const ang of testAngles) {
        const f = spinOn(A) ? RY(A, ang) : (q => q);
        let ins = 0; const ip = [];
        for (const q0 of cand) {
          const q = f(q0);
          if (insideVotes(B.bvh, q[0], q[1], q[2]).v >= 3) { ins++; ip.push(q); }
        }
        if (ins > bestInside) { bestInside = ins; bestPts = ip; bestCand = cand; }
      }
      if (!bestInside) continue;
      // 深度：对最多 70 个内点用 14 方向估计最近出口距离
      const step = Math.max(1, Math.ceil(bestPts.length / 70));
      const sub = bestPts.filter((_, k) => k % step === 0);
      let dmax = 0, dsum = 0, deep = 0;
      const deepPts = [];
      sub.forEach(q => { const d = depthAt(B.bvh, q[0], q[1], q[2]);
        if (d > dmax) dmax = d; dsum += d; if (d > DEEP) { deep++; deepPts.push([q, d]); } });
      if (dsum / sub.length > 0 && dmax > DEEP) deep = Math.round(deep * sub.length / bestPts.length);
      let cx0 = 0, cy0 = 0, cz0 = 0;
      (deepPts.length ? deepPts.map(a => a[0]) : bestPts).forEach(q => { cx0 += q[0]; cy0 += q[1]; cz0 += q[2]; });
      const m = (deepPts.length || bestPts.length);
      const row = { A: A.id, B: B.id, cand: bestCand.length, ins: bestInside,
        ratio: bestInside / bestCand.length, deep, dmax, dmean: dsum / sub.length,
        reg: [cx0 / m, cy0 / m, cz0 / m] };
      if (row.ratio > 0.6 && row.dmean > 0.5) nest.push(row); else rows.push(row);
    }
  }
  rows.sort((a, b) => b.dmax - a.dmax);
  const fmt = r => [r.A.padEnd(15), '→', r.B.padEnd(15),
    ((r.ratio * 100).toFixed(0) + '%').padStart(5), ('/' + r.cand).padStart(6),
    ('深点' + r.deep).padStart(7), ('max' + r.dmax.toFixed(2)).padStart(9), ('avg' + r.dmean.toFixed(2)).padStart(9),
    '@[' + r.reg.map(v => v.toFixed(1)).join(',') + ']'].join(' ');
  console.log('\n=== 部件对（A 表面点被 B 包住）· 深度单位=模型 cm ===');
  console.log('A部件           →  B部件            比例  /采样   深点>     最大深     平均深    穿透区域(模型坐标)');
  rows.forEach(r => console.log(fmt(r)));
  console.log('\n=== 判定为有意嵌套（>60% 在内部 且 平均深>0.5cm）===');
  nest.sort((a, b) => b.dmean - a.dmean);
  nest.forEach(r => console.log(fmt(r)));
  if (process.env.BBHIT === '1') { console.log('\n=== 世界包围盒相交的部件对 (' + bboxHit.length + ') ==='); console.log(bboxHit.join(' ')); }
  const fixable = rows.filter(r => r.dmax >= 0.3);
  console.log('\n共 ' + rows.length + ' 对重叠, ' + nest.length + ' 对嵌套;  最大穿透 ≥0.3cm 的: ' + fixable.length + ' 对');
  fixable.slice(0, 12).forEach(r => console.log('  ' + r.A + '→' + r.B + '  max=' + r.dmax.toFixed(2) + ' avg=' + r.dmean.toFixed(2)));
  process.exit(0);
})();