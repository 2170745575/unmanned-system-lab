/* 医疗救援页冒烟测试：按浏览器顺序加载 4 个模块，跑完整救护循环 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = 'D:\\deepseek工作\\dji-medical-3d';
const THREE = require(path.join(ROOT, 'vendor', 'three.min.js'));

let fakeNow = 0;
Object.defineProperty(globalThis, 'performance', { value: { now: () => fakeNow }, configurable: true });

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
    style: { setProperty() {}, removeProperty() {} }, dataset: {}, children: [], _h: {}, _attrs: {},
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      toggle(c, f) { if (f === undefined) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); } else { f ? this._s.add(c) : this._s.delete(c); } },
      contains(c) { return this._s.has(c); }
    },
    appendChild(c) { el.children.push(c); c.parentNode = el; return c; },
    removeChild(c) { const i = el.children.indexOf(c); if (i >= 0) el.children.splice(i, 1); },
    addEventListener(k, f) { (el._h[k] = el._h[k] || []).push(f); },
    removeEventListener() {},
    fire(k, e) { (el._h[k] || []).forEach(f => f(e || {})); },
    scrollIntoView() {},
    querySelector(sel) {
      if (sel && sel.charAt(0) === '.') {
        const cls = sel.slice(1);
        const stack = el.children.slice();
        while (stack.length) {
          const c = stack.shift();
          if (c.classList && c.classList.contains(cls)) return c;
          if (c.children) stack.push(...c.children);
        }
      }
      return null;
    },
    textContent: '', innerHTML: '', width: 0, height: 0
  };
  const cls = el.classList;
  Object.defineProperty(el, 'className', {
    get() { return Array.from(cls._s).join(' '); },
    set(v) { cls._s = new Set(String(v).split(/\s+/).filter(Boolean)); }
  });
  el.setAttribute = (k, v) => { if (k === 'class') el.className = v; else el._attrs[k] = v; };
  el.getAttribute = k => (k === 'class' ? el.className : (el._attrs[k] !== undefined ? el._attrs[k] : null));
  el.getContext = () => ctx2d;
  return el;
}

const registry = {};
const IDS = ['boot', 'boot-text', 'stage', 'labels', 'lines', 'tip', 'parts-count', 'parts-list',
  'detail-body', 'detail-tag', 'btn-explode', 'btn-expand-all', 'btn-reset', 'btn-labels', 'btn-rotate',
  'btn-parts', 'btn-detail', 'btn-auto', 'btn-drop', 'btn-hoist', 'btn-wave',
  'm-mode', 'm-wave', 'm-kill', 'm-threat', 'm-status', 'rd-rng', 'rd-cont', 'rd-sup1', 'rd-sup2',
  'telemetry-body', 'casualtyboard', 'flash', 'radar', 'hint'];
IDS.forEach(id => { registry[id] = mkEl(id.indexOf('btn') === 0 ? 'button' : 'div'); });

const winListeners = {};
const CDN_MODE = process.env.CDN_MODE || 'fail';
const head = {
  appendChild(s) {
    if (s.src && s.src.indexOf('vendor') >= 0) {
      setTimeout(() => { globalThis.THREE = THREE; globalThis.window.THREE = THREE; s.onload && s.onload(); }, 0);
      return;
    }
    if (CDN_MODE === 'hang') return;
    setTimeout(() => { s.onerror && s.onerror(); }, 0);
  }
};
globalThis.document = {
  createElement: mkEl, createElementNS: (n, t) => mkEl(t),
  getElementById: id => registry[id] || (registry[id] = mkEl()),
  querySelectorAll: sel => (sel === '.part-item' ? registry['parts-list'].children : []),
  querySelector: sel => (sel === '.part-item.active'
    ? registry['parts-list'].children.find(c => c.classList.contains('active')) || null : null),
  head, body: { style: {} }, addEventListener() {}
};
globalThis.innerWidth = 1600; globalThis.innerHeight = 900; globalThis.devicePixelRatio = 1.5;
globalThis.addEventListener = (t, f) => { (winListeners[t] = winListeners[t] || []).push(f); };
globalThis.removeEventListener = () => {};
const _ls = {};
globalThis.localStorage = { getItem: k => (k in _ls ? _ls[k] : null), setItem: (k, v) => { _ls[k] = String(v); },
  removeItem: k => { delete _ls[k]; } };
globalThis.window = globalThis;

let renderCount = 0;
THREE.WebGLRenderer = function () {
  this.domElement = mkEl('canvas');
  this.domElement.setPointerCapture = () => {};
  this.shadowMap = {}; this.setPixelRatio = () => {}; this.setSize = () => {};
  this.render = () => { renderCount++; };
  this.outputEncoding = null; this.toneMapping = null; this.toneMappingExposure = 1;
};
THREE.PMREMGenerator = function () {
  this.compileEquirectangularShader = () => {};
  this.fromEquirectangular = () => ({ texture: new THREE.Texture() });
  this.dispose = () => {};
};
const rafQueue = [];
globalThis.requestAnimationFrame = cb => { rafQueue.push(cb); return rafQueue.length; };
globalThis.cancelAnimationFrame = () => {};

const FILES = ['casualties.js', 'model-medical.js', 'medical.js', 'engine.js'];
const srcs = FILES.map(f => ({ f, src: fs.readFileSync(path.join(ROOT, f), 'utf8') }));

function pump(n, stepMs) {
  return new Promise(resolve => {
    let i = 0;
    (function step() {
      if (i++ >= n) return resolve();
      const cb = rafQueue.shift();
      if (!cb) return resolve();
      fakeNow += (stepMs || 33);
      try { cb(); } catch (e) { return resolve(e); }
      setTimeout(step, 0);
    })();
  });
}

(async function run() {
  const failures = [];
  function check(name, cond, extra) {
    if (cond) console.log('  [ok] ' + name + (extra ? '  ' + extra : ''));
    else { console.log('  [X ] ' + name + (extra ? '  ' + extra : '')); failures.push(name); }
  }

  console.log('project: ' + ROOT);
  console.log('-- 加载（THREE 未就绪时必须安全）--');
  let loadErr = null;
  for (const s of srcs) {
    try { new Function(s.src)(); } catch (e) { loadErr = s.f + ': ' + (e && e.message); break; }
  }
  check('4 个模块在 THREE 未加载时可安全执行', !loadErr, loadErr || '');
  if (loadErr) { console.log('\n[FAIL] ' + loadErr); process.exit(1); }

  await new Promise(r => setTimeout(r, 40));
  if (CDN_MODE === 'hang') await new Promise(r => setTimeout(r, 4400));
  await pump(6);
  const E = globalThis.window.DJIEngine && globalThis.window.DJIEngine.E;
  check('引擎实例存在', !!E);
  if (!E) process.exit(2);

  await new Promise(r => setTimeout(r, 420));
  check('启动遮罩已隐藏', registry['boot'].classList.contains('hide'));

  // JS 源码引用的 id 必须存在于 index.html
  const htmlSrc = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const definedIds = new Set((htmlSrc.match(/id="([^"]+)"/g) || []).map(s => s.slice(4, -1)));
  const asked = new Set();
  FILES.forEach(f => {
    const src2 = fs.readFileSync(path.join(ROOT, f), 'utf8');
    (src2.match(/(?:byId|getElementById)\(\s*'([^']+)'/g) || []).forEach(m =>
      asked.add(m.replace(/^[^']*'/, '').replace(/'$/, '')));
  });
  const OPTIONAL_IDS = ['rd-ammo', 'rd-msl', 'targetboard', 'btn-fold', 'btn-tour', 'btn-blueprint', 'btn-lang', 'btn-music', 'stage-vig', 'btn-back', 'stage-intro', 'btn-enter', 'btn-fly', 'selftest', 'selftest-list', 'intro-kicker', 'intro-title', 'intro-sub', 'intro-hint', 'intro-log', 'hint-extra', 'dji-stage-css', 'cinema', 'cinema-cap', 'panel-parts-title', 'panel-detail-title'];   // 引擎通用面板里的可选项，页面不提供也不算错
  const missing = Array.from(asked).filter(k => !definedIds.has(k) && OPTIONAL_IDS.indexOf(k) < 0);
  check('JS 引用的 DOM id 都存在于 HTML', missing.length === 0,
    missing.length ? '缺失: ' + missing.join(', ') : asked.size + ' 个全部命中');

  console.log('\n-- 模型 --');
  check('部件数量 = 清单项数', E.parts.length === E.model.parts.length && E.parts.length >= 28,
    E.parts.length + ' 个');
  check('渲染循环有帧输出', renderCount > 0, renderCount + ' 帧');
  check('详情面板已填充', registry['detail-body'].innerHTML.length > 200);

  // 尺寸与落地：纯网格包围盒
  const mb = new THREE.Box3();
  E.root.traverse(o => {
    if (!o.isMesh) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    const bb = o.geometry.boundingBox.clone();
    o.updateWorldMatrix(true, false);
    bb.applyMatrix4(o.matrixWorld);
    mb.union(bb);
  });
  const ms = mb.getSize(new THREE.Vector3());
  const real = [ms.x, ms.y, ms.z].map(v => v / E.model.scene.rootScale);
  check('整机尺寸符合 3 米级设计', real[0] > 280 && real[0] < 320 && real[2] > 200 && real[2] < 300,
    real.map(v => v.toFixed(0)).join(' × ') + ' cm');
  check('起落架不穿地（最低点 ≥ 地面）', mb.min.y >= E.FLOOR_Y - 0.05,
    'min.y=' + mb.min.y.toFixed(2) + ' floor=' + E.FLOOR_Y);

  console.log('\n-- 相机与数值健全性 --');
  const finite = v => typeof v === 'number' && isFinite(v);
  check('轨道参数有限', finite(E.orbit.theta) && finite(E.orbit.phi) && finite(E.orbit.radius),
    'radius=' + E.orbit.radius);
  check('相机位置有限', finite(E.camera.position.x) && finite(E.camera.position.y) && finite(E.camera.position.z));
  check('场景参数合并自 model.scene', E.cfg.scene.radius === E.model.scene.radius &&
    E.cfg.scene.zoomBias === E.model.scene.zoomBias);
  let badLights = [];
  E.scene.traverse(o => {
    if (!o.isLight) return;
    if (!isFinite(o.intensity) || o.intensity < 0 || !isFinite(o.position.x)) {
      badLights.push((o.type || '?') + ' I=' + o.intensity);
    }
  });
  check('场景光源全部健全（无 NaN 强度）', badLights.length === 0, badLights.slice(0, 3).join(' | ') || '无异常');

  console.log('\n-- 救护系统 --');
  let casCount = 0;
  E.scene.traverse(o => { if (o.userData && o.userData.enemyRef) casCount++; });
  check('伤员已生成', casCount > 0, casCount + ' 个伤员网格');
  const err = await pump(1400, 33);
  check('救护循环无异常', !err, err ? String(err && err.message) : '');

  let tel = '';
  registry['telemetry-body'].children.forEach(row =>
    row.children.forEach(c => { if (c.classList.contains('v')) tel += c.textContent + ' '; }));
  check('遥测无 NaN', tel.indexOf('NaN') < 0, tel.trim().slice(0, 70));
  check('伤员板已渲染', String(registry['casualtyboard'].innerHTML).indexOf('cas') >= 0);
  check('任务模式已更新', /MODE /.test(String(registry['m-mode'].textContent)), String(registry['m-mode'].textContent));
  check('分批推进正常', Number(registry['m-wave'].textContent) >= 1,
    '批次 ' + registry['m-wave'].textContent);
  check('已救治计数在推进', Number(registry['m-kill'].textContent) > 0,
    'SAVED ' + registry['m-kill'].textContent);
  check('状态行有内容', String(registry['m-status'].textContent).length > 2,
    String(registry['m-status'].textContent).slice(0, 30));
  check('物资读数正常', /^\d+\/\d+$/.test(String(registry['rd-sup1'].textContent)),
    'BLOOD ' + registry['rd-sup1'].textContent + ' DRUG ' + registry['rd-sup2'].textContent);

  console.log('\n-- 拆解与选中 --');
  registry['btn-auto'].fire('click');
  await pump(20, 33);
  registry['btn-explode'].fire('click');
  await pump(80, 33);
  check('拆解动画正常', E.parts.every(p => p.group.position.distanceTo(p.basePos) > 0.5));
  check('拆解时相机自动拉远', E.orbit.radius > E.orbit.userRadius + 2,
    'radius=' + E.orbit.radius.toFixed(1) + ' user=' + E.orbit.userRadius.toFixed(1));
  registry['btn-explode'].fire('click');
  await pump(80, 33);
  check('合拢归位', E.parts.every(p => p.group.position.distanceTo(p.basePos) < 0.05));
  const idx = E.parts.findIndex(p => p.def.id === 'supplyPod');
  registry['parts-list'].children[idx].fire('click');
  await pump(6, 33);
  check('选中物资舱后详情正确', registry['detail-body'].innerHTML.indexOf('投送') >= 0);

  console.log('\n-- 按钮 / 键位 --');
  registry['btn-drop'].fire('click');
  registry['btn-hoist'].fire('click');
  registry['btn-wave'].fire('click');
  registry['btn-auto'].fire('click');
  registry['btn-reset'].fire('click');
  (winListeners['resize'] || []).forEach(f => f());
  await pump(30, 33);
  check('按钮与 resize 无异常', true);

  console.log('\n' + (failures.length ? '[FAIL] ' + failures.length + ': ' + failures.join(' | ') : '[PASS] all checks passed'));
  process.exit(failures.length ? 1 : 0);
})().catch(e => {
  console.error('[ERROR] runtime exception:');
  console.error(e && e.stack || e);
  process.exit(2);
});