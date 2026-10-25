/* DJI Mavic 3 Pro 页冒烟测试（共享引擎版）
   按浏览器顺序加载 model-mavic.js → engine.js，跑完整展示级能力：
   红线探针 / 部件与几何 / DOM 完整性 / 拆解合拢 / 桨叶自旋 / 航行灯 /
   模拟飞行 / 展台外壳 / 材质体检 / 顶点色 AO / 后期与帧循环
   用法：node smoke-mavic.js        （可选环境变量 CDN_MODE=hang 模拟 CDN 卡死） */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = 'D:\\deepseek工作\\dji-mavic3pro-3d';
const FILES = ['model-mavic.js', 'engine.js'];

/* 页面里应当存在的 23 个部件 id（顺序即拆解编号） */
const PART_IDS = [
  'bodyUpper', 'gpsAntenna', 'visionFront', 'bodyLower', 'battery', 'usbCover', 'mainboard',
  'escBoard', 'coolingFan', 'visionBottom', 'armFrontL', 'armFrontR', 'armRearL', 'armRearR',
  'propFL', 'propFR', 'propRL', 'propRR', 'gimbalMount', 'gimbal',
  'cameraMain', 'cameraMid', 'cameraTele'
];

/* 引擎在运行期自己创建的元素 id（页面不必提供） */
const ENGINE_MADE = [
  'stage-vig', 'btn-back', 'btn-music', 'stage-intro', 'intro-kicker', 'intro-title',
  'intro-sub', 'intro-log', 'intro-hint', 'btn-enter', 'hint-extra', 'selftest', 'selftest-list',
  'cinema', 'cinema-cap', 'm-status', 'btn-fly', 'btn-scan', 'btn-tour', 'btn-blueprint', 'btn-lang',
  'dji-stage-css',
  /* 引擎通用可选槽位（页面未提供时引擎自行降级，不影响任何功能） */
  'rd-ammo', 'rd-msl', 'targetboard', 'btn-fold'
];

/* 引擎注入到顶栏/启动动画里的元素：真实浏览器里由引擎 appendChild/ensureBtn 建出来，
   测试桩用预置元素代表"注入完成后的 DOM"（页面 HTML 本身不含这些 id） */
const PRE_MADE = [
  'btn-back', 'btn-music', 'btn-fly', 'btn-scan', 'btn-tour', 'btn-blueprint', 'btn-lang',
  'btn-enter', 'intro-kicker', 'intro-title', 'intro-sub', 'intro-log', 'intro-hint',
  'cinema-cap', 'selftest-list', 'hint-extra'
];

console.log('project: ' + ROOT);
console.log('-- 红线：THREE 未加载时执行机型模块 --');
let threeTouched = null;
Object.defineProperty(globalThis, 'THREE', {
  configurable: true,
  get() { threeTouched = true; throw new Error('机型模块顶层读取了 THREE'); }
});
globalThis.window = globalThis;
globalThis.document = { getElementById: () => null, createElement: () => ({}), addEventListener() {} };
globalThis.localStorage = null;

const srcs = FILES.map(f => ({ f, src: fs.readFileSync(path.join(ROOT, f), 'utf8') }));
const modelSrc = srcs[0].src;
let probeErr = null;
try { new Function(modelSrc)(); } catch (e) { probeErr = e; }
const modAtProbe = globalThis.window.DJIModelMavic;
/* 只信探针标记，绝不真的去读 globalThis.THREE（读一下就会触发 getter 抛错） */
const probeOk = !probeErr && !threeTouched && !!modAtProbe &&
  Array.isArray(modAtProbe.parts) && modAtProbe.parts.length === 23 &&
  !!modAtProbe.builderFactory && typeof modAtProbe.builderFactory === 'function';
delete globalThis.THREE;

/* ---------- 浏览器环境桩（THREE 走 vendor 本地回退） ---------- */
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
    appendChild(c) { el.children.push(c); c.parentNode = el; if (c.id) registry[c.id] = c; return c; },
    insertBefore(c) { el.children.unshift(c); c.parentNode = el; if (c.id) registry[c.id] = c; return c; },
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

/* index.html 里真实存在的 id —— 冒烟测试按它建注册表，
   引擎引用了不存在的 id 时会被记入 dynamicIds，最后统一核对 */
const htmlSrc = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const definedIds = new Set((htmlSrc.match(/id="([^"]+)"/g) || []).map(s => s.slice(4, -1)));

const registry = {};
const dynamicIds = new Set();
definedIds.forEach(id => { registry[id] = mkEl(id.indexOf('btn') === 0 ? 'button' : 'div'); });
PRE_MADE.forEach(id => { registry[id] = mkEl(id.indexOf('btn') === 0 ? 'button' : 'div'); });

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
  /* 与真实浏览器一致：页面没写、引擎也还没建出来的 id 一律返回 null，
     这样引擎的"不存在就自建"分支才会真正被执行到 */
  getElementById: id => {
    if (registry[id]) return registry[id];
    dynamicIds.add(id);
    return null;
  },
  querySelectorAll: sel => (sel === '.part-item' ? registry['parts-list'].children : []),
  querySelector: sel => (sel === '.part-item.active'
    ? registry['parts-list'].children.find(c => c.classList.contains('active')) || null
    : (sel === '.actions' ? null : null)),
  head, body: mkEl('body'), addEventListener() {}
};
globalThis.innerWidth = 1600; globalThis.innerHeight = 900; globalThis.devicePixelRatio = 1.5;
globalThis.addEventListener = (t, f) => { (winListeners[t] = winListeners[t] || []).push(f); };
globalThis.removeEventListener = () => {};
const _ls = {};
globalThis.localStorage = { getItem: k => (k in _ls ? _ls[k] : null), setItem: (k, v) => { _ls[k] = String(v); },
  removeItem: k => { delete _ls[k]; } };
globalThis.location = { search: '' };

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
  check('模型在 THREE 未加载时可安全执行', probeOk, '23 个部件 / 未触碰 THREE');

  console.log('\n-- 加载（浏览器顺序：model-mavic.js → engine.js）--');
  let loadErr = null;
  for (const s of srcs) {
    try { new Function(s.src)(); } catch (e) { loadErr = s.f + ': ' + (e && e.message); break; }
  }
  check('2 个模块在 THREE 未就绪前可安全解析执行', !loadErr, loadErr || '');
  if (loadErr) { console.log('\n[FAIL] ' + loadErr); process.exit(1); }

  await new Promise(r => setTimeout(r, 40));
  if (CDN_MODE === 'hang') await new Promise(r => setTimeout(r, 4400));
  await pump(6);
  const E = globalThis.window.DJIEngine && globalThis.window.DJIEngine.E;
  check('引擎实例存在', !!E);
  if (!E) { console.log('\n[FAIL] 引擎未初始化'); process.exit(2); }

  await new Promise(r => setTimeout(r, 420));
  check('启动遮罩已隐藏', registry['boot'].classList.contains('hide'));

  // 进入展台：引擎的启动动画（点「进入」，等同真实用户操作）
  registry['btn-enter'].fire('click');
  await pump(80, 33);
  check('启动动画可进入（遮罩隐藏 + S.intro=false）',
    E.S.intro === false && registry['stage-intro'].classList.contains('hide'));
  check('展台外壳已挂载（返回键槽位）', !!E.stage && !!E.stage.back);
  check('镜头飞入到位（入场后回到展示半径）',
    E.orbit.userRadius <= E.cfg.scene.radius + 0.5 && E.orbit.userRadius > 0,
    'userRadius=' + E.orbit.userRadius.toFixed(1) + ' 目标=' + E.cfg.scene.radius);

  // JS 源码引用的 id 必须存在于 index.html（引擎自建的可选 id 除外）
  const asked = new Set();
  FILES.forEach(f => {
    const s2 = fs.readFileSync(path.join(ROOT, f), 'utf8');
    (s2.match(/(?:byId|getElementById)\(\s*'([^']+)'/g) || []).forEach(m =>
      asked.add(m.replace(/^[^']*'/, '').replace(/'$/, '')));
  });
  const missing = Array.from(asked).filter(k => !definedIds.has(k) && ENGINE_MADE.indexOf(k) < 0);
  check('JS 引用的 DOM id 都存在于 index.html', missing.length === 0,
    missing.length ? '缺失: ' + missing.join(', ') : asked.size + ' 个全部命中');
  const unexpected = Array.from(dynamicIds).filter(k => !definedIds.has(k) && ENGINE_MADE.indexOf(k) < 0);
  check('运行期未出现意料之外的 DOM id', unexpected.length === 0,
    unexpected.length ? '意外: ' + unexpected.join(', ') : '（引擎自建 ' + dynamicIds.size + ' 个）');

  const order = (htmlSrc.match(/<script src="([^"]+)"/g) || []).map(s => s.replace(/.*src="/, '').replace(/".*/, ''));
  check('脚本顺序为 model-mavic.js → engine.js（引擎最后）',
    order.length === 2 && order[0] === 'model-mavic.js' && order[1] === 'engine.js', order.join(' → '));
  check('index.html 不再引用 app.js / stage-extras.js', !/app\.js|stage-extras\.js/.test(htmlSrc));

  console.log('\n-- 模型 --');
  check('部件数量 = 23', E.parts.length === 23 && E.model.parts.length === 23, E.parts.length + ' 个');
  const ids = E.parts.map(p => p.def.id);
  const idDiff = PART_IDS.filter(id => ids.indexOf(id) < 0).concat(ids.filter(id => PART_IDS.indexOf(id) < 0));
  check('部件 id 列表与设计一致', idDiff.length === 0, idDiff.length ? '差异: ' + idDiff.join(',') : '23 个 id 全对');
  check('渲染循环有帧输出', renderCount > 0, renderCount + ' 帧');
  check('详情面板已填充', registry['detail-body'].innerHTML.length > 200);
  check('部件清单已渲染', registry['parts-list'].children.length === 23,
    registry['parts-list'].children.length + ' 项');

  // 尺寸与落地：先把 root 的飞行漂移与桨叶自旋归零，得到建模姿态下的包围盒
  const rootSave = { p: E.root.position.clone(), r: E.root.rotation.clone() };
  E.root.position.set(0, 0, 0); E.root.rotation.set(0, 0, 0);
  E.root.updateWorldMatrix(true, true);
  const spinSave = [];
  E.parts.forEach(p => {
    const inner = p.group.userData && p.group.userData.spinInner;
    if (inner) { spinSave.push([inner, inner.rotation.y]); inner.rotation.y = 0; }
  });
  E.parts.forEach(p => p.group.updateWorldMatrix(true, true));
  const mb = new THREE.Box3();
  E.root.traverse(o => {
    if (!o.isMesh || !o.geometry || (o.userData && o.userData.noPick)) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    const bb = o.geometry.boundingBox.clone();
    o.updateWorldMatrix(true, false);
    bb.applyMatrix4(o.matrixWorld);
    mb.union(bb);
  });
  const ms = mb.getSize(new THREE.Vector3());
  const real = [ms.x, ms.y, ms.z].map(v => v / E.ROOT_SCALE);
  spinSave.forEach(sv => { sv[0].rotation.y = sv[1]; });
  E.root.position.copy(rootSave.p); E.root.rotation.copy(rootSave.r);
  E.root.updateWorldMatrix(true, true);
  check('整机尺寸符合 Mavic 3 Pro 级别（展开含桨约 28×9×28 cm 建模尺度）',
    real[0] > 27 && real[0] < 30 && real[1] > 8.5 && real[1] < 10.5 && real[2] > 27 && real[2] < 30,
    real.map(v => v.toFixed(2)).join(' × ') + ' cm');
  check('整机不穿地（最低点 ≥ 地面）', mb.min.y >= E.FLOOR_Y - 0.05,
    'min.y=' + mb.min.y.toFixed(2) + ' floor=' + E.FLOOR_Y);
  check('部件都在场内（无 NaN 顶点）',
    isFinite(ms.x) && isFinite(ms.y) && isFinite(ms.z) && E.parts.every(p => isFinite(p.group.position.x)));

  console.log('\n-- 相机与数值健全性 --');
  const finite = v => typeof v === 'number' && isFinite(v);
  check('轨道参数有限', finite(E.orbit.theta) && finite(E.orbit.phi) && finite(E.orbit.radius),
    'radius=' + E.orbit.radius.toFixed(1));
  check('相机位置有限', finite(E.camera.position.x) && finite(E.camera.position.y) && finite(E.camera.position.z));
  check('场景参数合并自 model.scene（rootScale=0.5）', E.cfg.scene.rootScale === 0.5 &&
    E.cfg.scene.radius === E.model.scene.radius && E.cfg.scene.zoomBias === E.model.scene.zoomBias &&
    E.ROOT_SCALE === 0.5, 'radius=' + E.cfg.scene.radius + ' zoomBias=' + E.cfg.scene.zoomBias);
  let badLights = [];
  E.scene.traverse(o => {
    if (!o.isLight) return;
    if (!isFinite(o.intensity) || o.intensity < 0 || !isFinite(o.position.x)) badLights.push(o.type + ' I=' + o.intensity);
  });
  check('场景光源全部健全（无 NaN 强度）', badLights.length === 0, badLights.slice(0, 3).join(' | ') || '无异常');
  const err0 = await pump(30, 33);
  check('空闲渲染循环无异常', !err0, err0 ? String(err0 && err0.message) : '');

  console.log('\n-- 拆解与合拢 --');
  registry['btn-explode'].fire('click');
  await pump(90, 33);
  check('拆解动画正常', E.parts.every(p => p.group.position.distanceTo(p.basePos) > 0.5));
  check('拆解时相机自动拉远', E.orbit.radius > E.orbit.userRadius + 2,
    'radius=' + E.orbit.radius.toFixed(1) + ' user=' + E.orbit.userRadius.toFixed(1));
  registry['btn-explode'].fire('click');
  await pump(90, 33);
  check('合拢归位', E.parts.every(p => p.group.position.distanceTo(p.basePos) < 0.05));
  const idx = E.parts.findIndex(p => p.def.id === 'cameraMain');
  registry['parts-list'].children[idx].fire('click');
  await pump(6, 33);
  check('选中主相机后详情正确', registry['detail-body'].innerHTML.indexOf('哈苏') >= 0);
  registry['btn-explode'].fire('click');
  await pump(4, 33);

  console.log('\n-- 桨叶自旋 --');
  const props = E.parts.filter(p => p.def.spin);
  check('4 支桨叶声明了 spin', props.length === 4, props.map(p => p.def.id).join(','));
  check('桨叶有 spinAt 内层枢轴（绝对坐标建模可自旋）',
    props.every(p => p.group.userData && p.group.userData.spinInner));
  check('桨叶有动态桨盘光晕', props.every(p => !!p.disc && p.def.rotor > 0));
  const before = props.map(p => p.group.userData.spinInner.rotation.y);
  await pump(40, 33);
  const after = props.map(p => p.group.userData.spinInner.rotation.y);
  const spun = after.every((v, i) => isFinite(v) && Math.abs(v - before[i]) > 0.05);
  check('桨叶自旋（spin 部件在转）', spun,
    after.map((v, i) => (v - before[i]).toFixed(2)).join(' / '));
  check('相邻桨反向自旋（抵消反扭矩）',
    Math.sign(after[0] - before[0]) !== Math.sign(after[1] - before[1]) &&
    Math.sign(after[2] - before[2]) !== Math.sign(after[3] - before[3]));

  console.log('\n-- 航行灯 / 模拟飞行 --');
  check('航行灯已生成（旋翼机型 ≥ 4 盏）',
    !!E.navLights && E.navLights.lights.length >= 4,
    E.navLights ? E.navLights.lights.length + ' 盏：' + E.navLights.lights.map(l => l.kind).join(',') : '无');
  const navBefore = E.navLights ? E.navLights.lights[0].mesh.material.emissiveIntensity : 0;
  await pump(30, 33);
  check('航行灯在闪烁（emissive 每帧变化）',
    E.navLights && E.navLights.lights.some((l, i) => l.mesh.material.emissiveIntensity !== navBefore),
    'strobe/beacon 双闪');

  check('模拟飞行默认开启', E.S.fly === true);
  registry['btn-fly'].fire('click');
  await pump(20, 33);
  check('模拟飞行可关闭（E.S.fly 开关）', E.S.fly === false &&
    E.root.rotation.x === 0 && E.root.rotation.z === 0);
  registry['btn-fly'].fire('click');
  await pump(40, 33);
  check('模拟飞行开启后机体离地并有姿态', E.S.fly === true && E.S.airborne === true,
    'y=' + E.root.position.y.toFixed(3) + ' pitch=' + E.root.rotation.x.toFixed(3));

  let musicErr = null;
  try { registry['btn-music'].fire('click'); registry['btn-music'].fire('click'); } catch (e) { musicErr = e; }
  check('展台外壳：音乐开关安全（无 Web Audio 环境也不抛错）', !musicErr, musicErr ? String(musicErr.message) : '已切换两次');

  console.log('\n-- 后期处理 / 自检扫描 / 蓝图 / 巡航 --');
  check('后期处理管线已就绪（泛光合成或直出降级）', !!E.post || E.renderer.toneMapping !== null,
    E.post ? 'POST 泛光合成' : '直出（无 WebGL 扩展时降级）');
  let uiErr = null;
  try {
    registry['btn-tour'].fire('click');
    registry['btn-blueprint'].fire('click');
    registry['btn-lang'].fire('click');
    registry['btn-scan'].fire('click');
    registry['btn-rotate'].fire('click');
    registry['btn-labels'].fire('click');
    registry['btn-reset'].fire('click');
    registry['btn-expand-all'].fire('click');
    (winListeners['resize'] || []).forEach(f => f());
  } catch (e) { uiErr = e; }
  await pump(60, 33);
  check('展台级按钮（巡航 / 蓝图 / 中英 / 自检 / 旋转 / 标注 / 重置）无异常', !uiErr,
    uiErr ? String(uiErr.message) : '8 个按钮 + resize 全部安全');
  check('自检面板已生成', !!registry['selftest'] && String(registry['selftest'].innerHTML).indexOf('自检') >= 0);
  check('中英切换未破坏部件清单', registry['parts-list'].children.length === 23);
  registry['btn-lang'].fire('click');
  await pump(10, 33);
  registry['btn-tour'].fire('click');
  registry['btn-blueprint'].fire('click');
  await pump(20, 33);

  console.log('\n-- 材质体检 --');
  /* 只看机型部件自身的网格：引擎展示级特效（航行灯 / 桨盘光晕 / 扫描环）不参与体检，
     这样"材质规则"这条断言才真正对着移植过来的建模代码 */
  let mats = 0, midMetal = 0, vcMats = 0, geoTotal = 0, noColorGeo = 0;
  const seen = new Set();
  E.parts.forEach(p => p.meshes.forEach(o => {
    if (!o.geometry) return;
    if (!seen.has(o.geometry)) {
      seen.add(o.geometry); geoTotal++;
      if (!o.geometry.attributes.color) noColorGeo++;
    }
    const list = Array.isArray(o.material) ? o.material : [o.material];
    list.forEach(m => {
      if (!m) return;
      mats++;
      if (!m.map && m.metalness > 0.12 && m.metalness < 0.85) midMetal++;
      if (m.vertexColors) vcMats++;
    });
  }));
  check('材质体检：无"无贴图的中间 metalness"（去塑料感规则生效）', midMetal === 0,
    midMetal + ' / ' + mats + ' 个材质槽');
  check('顶点色 AO 已烘焙（部件几何体全覆盖）', geoTotal > 0 && noColorGeo === 0,
    (geoTotal - noColorGeo) + ' / ' + geoTotal + ' 个几何体带 color 属性');
  check('材质启用顶点色（vertexColors=true）', vcMats === mats && mats > 0, vcMats + ' / ' + mats);
  check('部件网格总数与几何保真一致（246 网格）',
    E.parts.reduce((s, p) => s + p.meshes.length, 0) === 246,
    E.parts.reduce((s, p) => s + p.meshes.length, 0) + ' 个网格');

  console.log('\n-- 遥测 / 配置 --');
  let tel = '';
  registry['telemetry-body'].children.forEach(row =>
    row.children.forEach(c => { if (c.classList.contains('v')) tel += c.textContent + ' '; }));
  check('遥测无 NaN', tel.indexOf('NaN') < 0, tel.trim().slice(0, 60));
  check('状态行有内容', String(registry['m-status'].textContent).length > 2,
    String(registry['m-status'].textContent).slice(0, 30));
  const startup = JSON.parse(fs.readFileSync(path.join(ROOT, 'dsh-startup.json'), 'utf8'));
  check('dsh-startup.json 保留且 aerial=true', startup.aerial === true,
    'title=' + startup.title + ' / lines=' + (startup.bootLines || []).length);
  check('dsh-startup.js 保留（file:// 孪生）', fs.existsSync(path.join(ROOT, 'dsh-startup.js')));
  check('部件数文案与清单一致', String(registry['parts-count'].textContent).indexOf('23') >= 0,
    String(registry['parts-count'].textContent));

  const err = await pump(200, 33);
  check('长时间展示循环无异常', !err, err ? String(err && err.message) : '');
  check('渲染帧持续输出', renderCount > 100, renderCount + ' 帧');

  console.log('\n' + (failures.length ? '[FAIL] ' + failures.length + ': ' + failures.join(' | ') : '[PASS] all checks passed'));
  process.exit(failures.length ? 1 : 0);
})().catch(e => {
  console.error('[ERROR] runtime exception:');
  console.error(e && e.stack || e);
  process.exit(2);
});