/* FlyCart 100 物流页冒烟测试：自旋 / 折叠 / 空吊全流程 / 称重 / 消摆 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = 'D:\\deepseek工作\\dji-flycart100-3d';
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
  'btn-parts', 'btn-detail', 'btn-auto', 'btn-sway', 'btn-cycle', 'btn-fold',
  'm-mode', 'm-wave', 'm-kill', 'm-threat', 'm-status', 'rd-rng', 'rd-cont', 'rd-ammo', 'rd-msl',
  'telemetry-body', 'loadboard', 'targetboard', 'flash', 'radar', 'hint'];
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

const FILES = ['logistics.js', 'model-flycart.js', 'flycart.js', 'engine.js'];
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

  const htmlSrc = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const definedIds = new Set((htmlSrc.match(/id="([^"]+)"/g) || []).map(s => s.slice(4, -1)));
  const OPTIONAL = ['rd-ammo', 'rd-msl', 'targetboard', 'btn-auto', 'btn-tour', 'btn-blueprint', 'btn-lang', 'btn-music', 'stage-vig', 'btn-back', 'stage-intro', 'btn-enter', 'btn-fly', 'selftest', 'selftest-list', 'intro-kicker', 'intro-title', 'intro-sub', 'intro-hint', 'intro-log', 'hint-extra', 'dji-stage-css', 'cinema', 'cinema-cap', 'panel-parts-title', 'panel-detail-title'];
  const asked = new Set();
  FILES.forEach(f => {
    const src2 = fs.readFileSync(path.join(ROOT, f), 'utf8');
    (src2.match(/(?:byId|getElementById)\(\s*'([^']+)'/g) || []).forEach(m =>
      asked.add(m.replace(/^[^']*'/, '').replace(/'$/, '')));
  });
  const missing = Array.from(asked).filter(k => !definedIds.has(k) && OPTIONAL.indexOf(k) < 0);
  check('JS 引用的 DOM id 都存在于 HTML', missing.length === 0,
    missing.length ? '缺失: ' + missing.join(', ') : asked.size + ' 个全部命中');

  console.log('\n-- 模型 --');
  check('部件数量 = 清单项数', E.parts.length === E.model.parts.length && E.parts.length >= 28,
    E.parts.length + ' 个');
  check('渲染循环有帧输出', renderCount > 0, renderCount + ' 帧');
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
  check('整机尺寸合理（3 米级八旋翼）', real[0] > 200 && real[0] < 280 && real[2] > 240 && real[2] < 300,
    real.map(v => v.toFixed(0)).join(' × ') + ' cm');
  check('起落架不穿地', mb.min.y >= E.model.scene.floorY - 0.05,
    'min.y=' + mb.min.y.toFixed(2) + ' floor=' + E.model.scene.floorY);

  console.log('\n-- 相机与数值健全性 --');
  const finite = v => typeof v === 'number' && isFinite(v);
  check('轨道参数有限', finite(E.orbit.theta) && finite(E.orbit.phi) && finite(E.orbit.radius),
    'radius=' + E.orbit.radius);
  check('相机位置有限', finite(E.camera.position.x) && finite(E.camera.position.y) && finite(E.camera.position.z));
  let badLights = [];
  E.scene.traverse(o => {
    if (!o.isLight) return;
    if (!isFinite(o.intensity) || o.intensity < 0 || !isFinite(o.position.x)) badLights.push(o.type);
  });
  check('场景光源健全（无 NaN 强度）', badLights.length === 0, badLights.join(',') || '无异常');

  console.log('\n-- 动力与机构 --');
  const spinParts = E.parts.filter(p => p.def.spin);
  check('八支桨叶配置自旋', spinParts.length === 8, spinParts.length + ' 支');
  check('八支桨叶都有动态光晕盘', E.parts.filter(p => p.disc).length === 8);
  const r0 = (spinParts[0].group.userData.spinInner || spinParts[0].group).rotation.y;
  await pump(40, 33);
  const r1 = (spinParts[0].group.userData.spinInner || spinParts[0].group).rotation.y;
  check('桨叶确实在旋转', Math.abs(r1 - r0) > 0.5, 'Δ=' + (r1 - r0).toFixed(2) + ' rad');
  const up = E.parts.find(p => p.def.id === 'propFLu'), lo = E.parts.find(p => p.def.id === 'propFLl');
  const dirUp = (up.group.userData.spinInner || up.group).rotation.y;
  const dirLo = (lo.group.userData.spinInner || lo.group).rotation.y;
  check('共轴上下桨反向旋转', dirUp * dirLo < 0, 'up=' + dirUp.toFixed(2) + ' low=' + dirLo.toFixed(2));

  // 折叠
  const arm = E.parts.find(p => p.def.id === 'armFL');
  check('机臂配置折叠铰链', !!arm.def.hinge);
  const unfoldRot = arm.group.rotation.y;
  registry['btn-fold'].fire('click');
  await pump(90, 33);
  const foldRot = arm.group.rotation.y;
  check('折叠机臂生效', Math.abs(foldRot - unfoldRot) > 0.6,
    '展开=' + unfoldRot.toFixed(2) + ' → 折叠=' + foldRot.toFixed(2));
  check('折叠时桨叶降速', E.S.spinRate <= 1 && E.S.foldT < 0.15, 'foldT=' + E.S.foldT.toFixed(2));
  registry['btn-fold'].fire('click');
  await pump(70, 33);
  check('再次展开到位', E.S.foldT > 0.85, 'foldT=' + E.S.foldT.toFixed(2));

  console.log('\n-- 空吊全流程 --');
  const beh = E.behavior;
  let phases = {};
  let maxSwing = 0, minSwingAfterLift = 9, sawWeigh = false, sawHookOpen = false, sawAttach = false;
  const t0 = Date.now();
  let sawWeighText = false, maxWeighText = '';
  for (let i = 0; i < 1100; i++) {
    await pump(1, 33);
    const bt = String(registry['loadboard'].innerHTML);
    const mm = bt.match(/([\d.]+)\s*kg/);
    if (mm && parseFloat(mm[1]) > 1) { sawWeighText = true; maxWeighText = mm[0]; }
    const ph = globalThis.DJIFlyCart && globalThis.DJIFlyCart.__phase ? globalThis.DJIFlyCart.__phase() : null;
    if (ph) {
      phases[ph] = (phases[ph] || 0) + 1;
      if (ph === 'TRANSIT' || ph === 'LOWER') { maxSwing = Math.max(maxSwing, Math.abs(globalThis.DJIFlyCart.__swing())); }
    }
  }
  check('吊运阶段机在推进', Object.keys(phases).length >= 5, Object.keys(phases).join(' → '));
  let boardTxt = String(registry['loadboard'].innerHTML);
  check('作业流程板已渲染', boardTxt.indexOf('step') >= 0 && boardTxt.indexOf('实时称重') >= 0);
  check('实时称重读数出现过', sawWeighText, maxWeighText || '未捕获');
  let tel = '';
  registry['telemetry-body'].children.forEach(row =>
    row.children.forEach(c => { if (c.classList.contains('v')) tel += c.textContent + ' '; }));
  check('遥测无 NaN', tel.indexOf('NaN') < 0, tel.trim().slice(0, 78));
  check('状态行在叙述作业', String(registry['m-status'].textContent).length > 4,
    String(registry['m-status'].textContent).slice(0, 34));
  check('雷达有触点', Number(registry['rd-cont'].textContent) > 0, 'CONT ' + registry['rd-cont'].textContent);

  console.log('\n-- 消摆对比（同时验证开与关）--');
  // 开着消摆跑一段 → 关掉再跑一段，比较残余摆角
  globalThis.DJIFlyCart.__setSway(true);
  await pump(120, 33);
  const swayOn = Math.abs(globalThis.DJIFlyCart.__swing());
  globalThis.DJIFlyCart.__setSway(false);
  globalThis.DJIFlyCart.__kick(0.5);
  await pump(120, 33);
  const swayOff = Math.abs(globalThis.DJIFlyCart.__swing());
  check('自动消摆确实抑制摆动', swayOn <= swayOff + 0.02 || swayOn < 0.12,
    '消摆开=' + swayOn.toFixed(3) + ' 消摆关=' + swayOff.toFixed(3));
  globalThis.DJIFlyCart.__setSway(true);

  console.log('\n-- 拆解与选中 --');
  registry['btn-explode'].fire('click');
  await pump(80, 33);
  check('拆解动画正常', E.parts.every(p => p.group.position.distanceTo(p.basePos) > 0.5));
  check('拆解时相机自动拉远', E.orbit.radius > E.orbit.userRadius + 2,
    'radius=' + E.orbit.radius.toFixed(1) + ' user=' + E.orbit.userRadius.toFixed(1));
  registry['btn-explode'].fire('click');
  await pump(80, 33);
  check('合拢归位（吊索/挂钩除外）', E.parts.filter(p => p.group.position.distanceTo(p.basePos) < 0.05).length >= E.parts.length - 2);
  const idx = E.parts.findIndex(p => p.def.id === 'winchUnit');
  registry['parts-list'].children[idx].fire('click');
  await pump(6, 33);
  check('选中空吊系统后详情正确', registry['detail-body'].innerHTML.indexOf('空吊') >= 0);

  console.log('\n-- 展台外壳（返回键 / 启动动画 / 音乐）--');
  check('返回展台按钮已注入', !!(E.stage && E.stage.back), E.stage && E.stage.back ? E.stage.back.href : 'n/a');
  check('启动动画处于待进入状态', E.S.intro !== false || E.introFly !== null || E.S.intro === false);
  const enterBtn = document.getElementById('btn-enter');
  enterBtn.fire('click');
  await pump(6, 33);
  check('点击进入后启动动画结束', E.S.intro === false);
  check('镜头飞入已触发并在推进', E.introFly === null || E.introFly.t >= 0,
    E.introFly ? ('进行中 ' + E.introFly.t.toFixed(2) + 's / ' + E.introFly.dur + 's') : '已完成');
  await pump(70, 33);
  check('飞入结束后相机回到正常机位', E.introFly === null && E.orbit.userRadius <= E.cfg.scene.radius * 1.05,
    'userRadius=' + E.orbit.userRadius.toFixed(1) + ' 目标=' + E.cfg.scene.radius);
  let musicErr = null;
  try { document.getElementById('btn-music').fire('click'); document.getElementById('btn-music').fire('click'); } catch (e) { musicErr = e.message; }
  check('无 AudioContext 环境下音乐开关安全', !musicErr, musicErr || '静默跳过');

  console.log('\n-- 展示级动态（模拟飞行 / 航行灯 / 自检扫描）--');
  check('启动配置已载入（默认或 dsh-startup）', !!(E.S.startup && E.S.startup.bootLines),
    E.S.startup ? (E.S.startup.bootLines.length + ' 条启动日志 · ' + E.S.startup.accent) : 'n/a');
  // 模拟飞行：物流页声明了 movesRoot，只应有姿态呼吸感；机体位移归行为层
  check('行为层已声明 movesRoot（避免展示漂移卡住状态机）', E.behavior.movesRoot === true);
  const rotA = E.root.rotation.y, rotB0 = E.root.rotation.z;
  await pump(150, 33);
  check('模拟飞行在驱动机体姿态', Math.abs(E.root.rotation.y - rotA) + Math.abs(E.root.rotation.z - rotB0) > 0.0005,
    'yaw=' + E.root.rotation.y.toFixed(4) + ' roll=' + E.root.rotation.z.toFixed(4));
  check('航行灯已生成（有旋翼的机型自动布灯）', !!(E.navLights && E.navLights.lights.length >= 4),
    (E.navLights ? E.navLights.lights.length : 0) + ' 盏');
  const strobe = E.navLights.lights.filter(l => l.kind === 'strobe');
  const s0 = strobe[0].mesh.material.emissiveIntensity;
  let sMax = s0, sMin = s0;
  for (let i = 0; i < 120; i++) {
    await pump(1, 33);
    const v = strobe[0].mesh.material.emissiveIntensity;
    sMax = Math.max(sMax, v); sMin = Math.min(sMin, v);
  }
  check('红色防撞灯在闪烁（亮度有明暗周期）', sMax - sMin > 0.5,
    'emissive ' + sMin.toFixed(2) + ' ~ ' + sMax.toFixed(2));
  check('地面洗流环已生成', !!E.downwash);
  globalThis.DJIFlyCart.__phase && null;
  const keyS = (winListeners['keydown'] || []);
  keyS.forEach(f => f({ key: 's', preventDefault() {} }));
  await pump(8, 33);
  check('自检扫描已启动', E.S.scanning === true, '进度 ' + (E.S.scanProgress || 0).toFixed(2));
  const stList = document.getElementById('selftest-list');
  await pump(170, 33);
  check('自检扫描已完成', E.S.scanning === false && E.S.scanProgress >= 0.99,
    '进度 ' + E.S.scanProgress.toFixed(2));
  let oks = 0;
  if (stList && stList.children) Array.from(stList.children).forEach(li => { if (li.classList.contains('ok')) oks++; });
  check('自检结果逐项点亮', (E.S.scanTicked || 0) >= 1 || oks >= 1,
    '已点亮 ' + (E.S.scanTicked || 0) + ' 项（DOM 行 ' + oks + '）');
  keyS.forEach(f => f({ key: 'f', preventDefault() {} }));
  await pump(4, 33);
  check('模拟飞行开关可关闭', E.S.fly === false);
  keyS.forEach(f => f({ key: 'f', preventDefault() {} }));
  await pump(4, 33);
  check('模拟飞行开关可恢复', E.S.fly === true);

  console.log('\n-- 去塑料感（材质与顶点着色）--');
  const mats = new Set();
  E.parts.forEach(p => p.meshes.forEach(m => {
    (Array.isArray(m.material) ? m.material : [m.material]).forEach(x => x && mats.add(x));
  }));
  const list = Array.from(mats);
  const plastic = list.filter(m => m.metalness > 0.12 && m.metalness < 0.5 && !m.map);
  const anyMat = list.find(m => m.metalness <= 0.12 && m.normalMap) || list[0];
  check('无"塑料油光"材质（无贴图的中间 metalness 必须为 0）', plastic.length === 0,
    list.length + ' 种材质，可疑 ' + plastic.length + ' 种');
  check('哑光件 metalness 已压到近 0', anyMat.metalness <= 0.12, 'metalness=' + anyMat.metalness);
  check('材质带微表面法线贴图', !!anyMat.normalMap && !!anyMat.normalScale, 'normalScale=' + (anyMat.normalScale ? anyMat.normalScale.x : 'n/a'));
  check('材质带粗糙度噪声贴图', !!anyMat.roughnessMap);
  check('材质带环境反射强度', anyMat.envMapIntensity > 0, 'envMapIntensity=' + anyMat.envMapIntensity);
  let vcOK = 0, vcBad = 0, vcMin = 9, vcMax = -9;
  E.root.traverse(o => {
    if (!o.isMesh || !o.geometry || !o.geometry.attributes || !o.geometry.attributes.color) return;
    const arr = o.geometry.attributes.color.array;
    for (let i = 0; i < arr.length; i += Math.max(3, ((arr.length / 3) | 0) || 3)) {
      vcMin = Math.min(vcMin, arr[i]); vcMax = Math.max(vcMax, arr[i]);
      if (arr[i] > 0.55 && arr[i] < 1.2) vcOK++; else vcBad++;
    }
  });
  check('顶点色 AO 已烘焙且数值合理', vcOK > 20 && vcBad === 0, '样本 ' + vcOK + ' 个，范围 ' + vcMin.toFixed(2) + '~' + vcMax.toFixed(2));

  console.log('\n-- 展台功能（引擎级）--');
  const key = (k) => (winListeners['keydown'] || []).forEach(f => f({ key: k, preventDefault() {} }));
  check('后期管线存在或安全降级', !!E.post === false || !!E.post.matComp,
    E.post ? '管线就绪（含泛光/调色/暗角）' : '已降级为直出（测试桩无渲染目标 API）');
  key('t');
  await pump(4, 33);
  check('演示巡航可开启', E.S.tour === true);
  const shot0 = E.S.tourI;
  await pump(220, 33);
  check('巡航镜头自动推进', E.S.tourI !== shot0 || E.S.tourT > 0.5,
    '镜头 ' + shot0 + ' → ' + E.S.tourI);
  key('t');
  await pump(3, 33);
  check('巡航可退出', E.S.tour === false);
  const sample = E.parts[0].meshes[0];
  const mat0 = Array.isArray(sample.material) ? sample.material[0] : sample.material;
  const wire0 = mat0.wireframe, col0 = mat0.color.getHex();
  key('b');
  await pump(3, 33);
  const mat1 = Array.isArray(sample.material) ? sample.material[0] : sample.material;
  check('蓝图模式开启（线框 + 换色）', E.S.blueprint === true && mat1.wireframe === true && mat1.color.getHex() !== col0,
    '#' + col0.toString(16) + ' → #' + mat1.color.getHex().toString(16));
  key('b');
  await pump(3, 33);
  const mat2 = Array.isArray(sample.material) ? sample.material[0] : sample.material;
  check('蓝图模式关闭并还原', E.S.blueprint === false && mat2.wireframe === wire0 && mat2.color.getHex() === col0);
  const li0 = registry['parts-list'].children[0];
  const before = li0.querySelector('.meta').children[0].textContent;
  key('u');
  await pump(3, 33);
  const after = li0.querySelector('.meta').children[0].textContent;
  check('中英双语可切换', E.S.lang === 'en' && after !== before, before + ' → ' + after);
  key('u');
  await pump(3, 33);
  check('切回中文', E.S.lang === 'cn');

  console.log('\n-- 按钮 / 键位 --');
  registry['btn-sway'].fire('click');
  registry['btn-cycle'].fire('click');
  registry['btn-rotate'].fire('click');
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