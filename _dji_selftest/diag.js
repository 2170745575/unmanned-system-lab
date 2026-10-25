/* 诊断：检查挤压面板与圆角盒的三角形绕序/法线朝向 */
'use strict';
const path = require('path');
const THREE = require(path.join('D:\\deepseek工作\\dji-action4-3d', 'vendor', 'three.min.js'));

function roundedRectPath(target, cx, cy, w, h, r) {
  const x = cx - w / 2, y = cy - h / 2;
  target.moveTo(x + r, y);
  target.lineTo(x + w - r, y);
  target.quadraticCurveTo(x + w, y, x + w, y + r);
  target.lineTo(x + w, y + h - r);
  target.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  target.lineTo(x + r, y + h);
  target.quadraticCurveTo(x, y + h, x, y + h - r);
  target.lineTo(x, y + r);
  target.quadraticCurveTo(x, y, x + r, y);
  return target;
}
function plateWithHoles(w, h, r, depth, holes) {
  const shape = new THREE.Shape();
  roundedRectPath(shape, 0, 0, w, h, r);
  (holes || []).forEach(ho => {
    const p = new THREE.Path();
    if (ho.type === 'circle') p.absarc(ho.x, ho.y, ho.r, 0, Math.PI * 2, true);
    else roundedRectPath(p, ho.x, ho.y, ho.w, ho.h, ho.r || 0.12);
    shape.holes.push(p);
  });
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: true, bevelThickness: 0.035,
    bevelSize: 0.035, bevelSegments: 3, curveSegments: 28, steps: 1
  });
  geo.translate(0, 0, -depth / 2);
  geo.computeVertexNormals();
  return geo;
}

function audit(name, geo, axis) {
  const pos = geo.attributes.position, idx = geo.index;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const n = new THREE.Vector3(), ab = new THREE.Vector3(), ac = new THREE.Vector3();
  let fwd = 0, back = 0, areaFwd = 0, areaBack = 0;
  const nTris = idx ? idx.count / 3 : pos.count / 3;
  for (let t = 0; t < nTris; t++) {
    const i0 = idx ? idx.getX(t * 3) : t * 3;
    const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
    a.fromBufferAttribute(pos, i0); b.fromBufferAttribute(pos, i1); c.fromBufferAttribute(pos, i2);
    ab.subVectors(b, a); ac.subVectors(c, a);
    n.crossVectors(ab, ac);
    const area = n.length() / 2;
    const d = n.normalize().dot(axis);
    if (d > 0) { fwd++; areaFwd += area; } else { back++; areaBack += area; }
  }
  console.log(name.padEnd(16) + ' 三角形 ' + nTris +
    '  法线朝 ' + JSON.stringify(axis) + ' 的: ' + fwd + ' 个 / 面积 ' + areaFwd.toFixed(2) +
    '  |  反向: ' + back + ' 个 / 面积 ' + areaBack.toFixed(2));
}

geoDump();
function geoDump() {
  const plate = plateWithHoles(7.05, 4.42, 0.5, 0.28, [
    { type: 'circle', x: -1.62, y: 0.1, r: 1.46 },
    { type: 'rect', x: 1.68, y: -0.05, w: 3.02, h: 2.34, r: 0.16 }
  ]);
  plate.computeBoundingBox();
  console.log('面板 bbox', JSON.stringify(plate.boundingBox));
  audit('前后面板', plate, new THREE.Vector3(0, 0, 1));

  // 只看前盖（z 最大的那一层）三角形
  const pos = plate.attributes.position, idx = plate.index;
  const zmax = plate.boundingBox.max.z;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const n = new THREE.Vector3(), ab = new THREE.Vector3(), ac = new THREE.Vector3();
  let fwd = 0, back = 0, areaF = 0, areaB = 0;
  const nTris = idx ? idx.count / 3 : pos.count / 3;
  const at = i => (idx ? idx.getX(i) : i);
  for (let t = 0; t < nTris; t++) {
    a.fromBufferAttribute(pos, at(t * 3));
    b.fromBufferAttribute(pos, at(t * 3 + 1));
    c.fromBufferAttribute(pos, at(t * 3 + 2));
    if ((a.z + b.z + c.z) / 3 < zmax - 0.02) continue;
    ab.subVectors(b, a); ac.subVectors(c, a);
    n.crossVectors(ab, ac);
    const ar = n.length() / 2;
    n.normalize();
    if (n.z > 0) { fwd++; areaF += ar; } else { back++; areaB += ar; }
  }
  console.log('前盖三角形：朝外 ' + fwd + ' 个 / 面积 ' + areaF.toFixed(2) +
    '  |  朝内 ' + back + ' 个 / 面积 ' + areaB.toFixed(2));
  console.log('panel.index =', plate.index ? 'indexed' : 'non-indexed');
  console.log('panel.normal 是否存在:', !!plate.attributes.normal,
    ' 前盖顶点法线示例:',
    (() => {
      const nrm = plate.attributes.normal;
      for (let i = 0; i < pos.count; i++) {
        if (pos.getZ(i) > zmax - 0.005 && Math.abs(pos.getX(i)) < 0.05 && Math.abs(pos.getY(i)) < 0.05) {
          return [nrm.getX(i).toFixed(2), nrm.getY(i).toFixed(2), nrm.getZ(i).toFixed(2)].join(',');
        }
      }
      return 'n/a';
    })());

  // 圆角盒
  const rb = roundedBox(7.05, 4.42, 2.92, 0.5, 7);
  audit('圆角盒', rb, new THREE.Vector3(0, 0, 1));
}

function roundedBox(w, h, d, r, seg) {
  seg = seg || 5;
  const g = new THREE.BoxGeometry(w, h, d, seg, seg, seg);
  const p = g.attributes.position;
  const hx = w / 2 - r, hy = h / 2 - r, hz = d / 2 - r;
  const v = new THREE.Vector3(), cc = new THREE.Vector3(), dv = new THREE.Vector3();
  const clamp = (x, a, b) => x < a ? a : (x > b ? b : x);
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    cc.set(clamp(v.x, -hx, hx), clamp(v.y, -hy, hy), clamp(v.z, -hz, hz));
    dv.set(v.x - cc.x, v.y - cc.y, v.z - cc.z);
    const len = dv.length();
    if (len > 1e-6) { dv.multiplyScalar(r / len); v.set(cc.x + dv.x, cc.y + dv.y, cc.z + dv.z); }
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}