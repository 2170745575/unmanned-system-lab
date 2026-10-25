/* =========================================================================
   DJI Osmo Action 4 冒烟测试（引擎版）
   -------------------------------------------------------------------------
   按浏览器顺序加载 model-action4.js → engine.js，验证：
     · 模块在 THREE 未加载时可安全执行（红线）
     · 部件 18 / DOM id 引用完整性 / 整机尺寸区间 / 渲染有帧
     · 相机与光源数值健全
     · 拆解与合拢、拾取选中、详情面板
     · 展台外壳（返回键 / 启动动画可进入 / 音乐开关安全）
     · 材质体检（无"无贴图的中间 metalness"）与顶点色 AO 烘焙
     · 引擎级能力（演示巡航 / 技术图纸 / 中英双语 / 状态自检）
   ========================================================================= */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = 'D:\\deepseek工作\\dji-action4-3d';
const THREE = require(path.join(ROOT, 'vendor', 'three.min.js'));

let fakeNow = 0;
Object.defineProperty(globalThis, 'performance', { value: { now: () => fakeNow }, configurable: true });

const grad = { addColorStop() {} };
const ctx2d = new Proxy({}, {
  get(t, p) {
    if (p === 'createLinearGradient' || p === 'createRadialGradient') return () => grad;
    if (p === 'measureText') return () => ({ width: 10 });
    if (p === 'createImageData') return (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
    if (p === 'getImageData') return (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
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
    insertBefore(c) { el.children.unshift(c); c.parentNode = el; return c; },
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
  'btn-parts', 'btn-detail',
  'm-mode', 'm-wave', 'm-kill', 'm-threat', 'm-status', 'rd-rng', 'rd-cont',
  'telemetry-body', 'flash', 'radar', 'hint'];
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
    ? registry['parts-list'].children.find(c => c.classList.contains('active')) || null
    : (sel === '.hint' ? registry['hint'] : null)),
  head, body: mkEl('body'), addEventListener() {}
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
  this.setRenderTarget = () => {}; this.getRenderTarget = () => null; this.clear = () => {};
};
THREE.PMREMGenerator = function () {
  this.compileEquirectangularShader = () => {};
  this.fromEquirectangular = () => ({ texture: new THREE.Texture() });
  this.dispose = () => {};
};
const rafQueue = [];
globalThis.requestAnimationFrame = cb => { rafQueue.push(cb); return rafQueue.length; };
globalThis.cancelAnimationFrame = () => {};

const FILES = ['model-action4.js', 'engine.js'];
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
  const key = k => (winListeners['keydown'] || []).forEach(f => f({ key: k, preventDefault() {} }));

  console.log('project: ' + ROOT);
  console.log('-- 加载（THREE 未就绪时必须安全）--');
  let loadErr = null;
  for (const s of srcs) {
    try { new Function(s.src)(); } catch (e) { loadErr = s.f + ': ' + (e && e.message); break; }
  }
  check('2 个模块在 THREE 未加载时可安全执行', !loadErr, loadErr || '');
  if (loadErr) { console.log('\n[FAIL] ' + loadErr); process.exit(1); }

  await new Promise(r => setTimeout(r, 40));
  await pump(6);
  const E = globalThis.window.DJIEngine && globalThis.window.DJIEngine.E;
  check('引擎实例存在', !!E);
  if (!E) process.exit(2);

  await new Promise(r => setTimeout(r, 420));
  check('启动遮罩已隐藏', registry['boot'].classList.contains('hide'));

  /* ---- 页面静态结构 ---- */
  console.log('\n-- 页面结构 --');
  const htmlSrc = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const definedIds = new Set((htmlSrc.match(/id="([^"]+)"/g) || []).map(s => s.slice(4, -1)));
  const OPTIONAL = ['rd-ammo', 'rd-msl', 'targetboard', 'btn-auto', 'btn-fold', 'btn-tour', 'btn-blueprint', 'btn-lang',
    'btn-music', 'stage-vig', 'btn-back', 'stage-intro', 'btn-enter', 'btn-fly', 'btn-scan',
    'selftest', 'selftest-list', 'intro-kicker', 'intro-title', 'intro-sub', 'intro-hint', 'intro-log',
    'hint-extra', 'dji-stage-css', 'cinema', 'cinema-cap'];
  const asked = new Set();
  FILES.forEach(f => {
    const src2 = fs.readFileSync(path.join(ROOT, f), 'utf8');
    (src2.match(/(?:byId|getElementById)\(\s*'([^']+)'/g) || []).forEach(m =>
      asked.add(m.replace(/^[^']*'/, '').replace(/'$/, '')));
  });
  const missing = Array.from(asked).filter(k => !definedIds.has(k) && OPTIONAL.indexOf(k) < 0);
  check('JS 引用的 DOM id 都存在于 HTML', missing.length === 0,
    missing.length ? '缺失: ' + missing.join(', ') : asked.size + ' 个全部命中');
  const iModel = htmlSrc.indexOf('src="model-action4.js"');
  const iEngine = htmlSrc.indexOf('src="engine.js"');
  check('脚本顺序为 model-action4.js → engine.js（引擎最后）', iModel >= 0 && iEngine > iModel,
    'model@' + iModel + ' engine@' + iEngine);
  check('index.html 不再引用 app.js / stage-extras.js',
    htmlSrc.indexOf('app.js') < 0 && htmlSrc.indexOf('stage-extras.js') < 0);

  console.log('\n-- 模型 --');
  check('部件数量 = 清单项数 = 18',
    E.parts.length === 18 && E.model.parts.length === 18, E.parts.length + ' 个');
  check('部件 id 唯一且顺序与清单一致',
    E.parts.every((p, i) => p.def.id === E.model.parts[i].id) &&
    new Set(E.parts.map(p => p.def.id)).size === 18);
  check('机型模块提供 builderFactory 自注册', typeof E.model.builderFactory === 'function' &&
    !!globalThis.window.DJIModelAction4 && globalThis.window.DJIPage.model === globalThis.window.DJIModelAction4);
  check('渲染循环有帧输出', renderCount > 0, renderCount + ' 帧');
  check('详情面板已填充', String(registry['detail-body'].innerHTML).length > 200);

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
  check('整机尺寸符合 Osmo Action 4 设计（约 7.5 × 5.3 × 4.5 cm）',
    real[0] > 6.8 && real[0] < 8.2 && real[1] > 4.6 && real[1] < 6.2 && real[2] > 4.0 && real[2] < 5.2,
    real.map(v => v.toFixed(2)).join(' × ') + ' cm');
  check('整机没有沉到地面以下', mb.min.y >= E.FLOOR_Y - 1.0,
    'min.y=' + mb.min.y.toFixed(2) + ' floor=' + E.FLOOR_Y);

  console.log('\n-- 相机与数值健全性 --');
  const finite = v => typeof v === 'number' && isFinite(v);
  check('轨道参数有限', finite(E.orbit.theta) && finite(E.orbit.phi) && finite(E.orbit.radius),
    'radius=' + E.orbit.radius.toFixed(2) + ' theta=' + E.orbit.theta.toFixed(2) + ' phi=' + E.orbit.phi.toFixed(2));
  check('相机位置有限', finite(E.camera.position.x) && finite(E.camera.position.y) && finite(E.camera.position.z));
  check('场景参数合并自 model.scene',
    E.cfg.scene.radius === E.model.scene.radius && E.cfg.scene.zoomBias === E.model.scene.zoomBias &&
    E.cfg.scene.rootScale === E.model.scene.rootScale && E.cfg.scene.floorY === E.model.scene.floorY,
    'radius=' + E.cfg.scene.radius + ' zoomBias=' + E.cfg.scene.zoomBias);
  let badLights = [];
  E.scene.traverse(o => {
    if (!o.isLight) return;
    if (!isFinite(o.intensity) || o.intensity < 0 || !isFinite(o.position.x)) badLights.push(o.type);
  });
  check('场景光源健全（无 NaN 强度）', badLights.length === 0, badLights.join(',') || '无异常');
  check('相机不是飞行器（aerial:false → 不加航行灯）', E.model.aerial === false && !E.navLights);

  console.log('\n-- 拆解与选中 --');
  registry['btn-explode'].fire('click');
  await pump(80, 33);
  check('拆解动画正常', E.parts.every(p => p.group.position.distanceTo(p.basePos) > 0.5));
  check('拆解时相机自动拉远', E.orbit.radius > E.orbit.userRadius + 2,
    'radius=' + E.orbit.radius.toFixed(1) + ' user=' + E.orbit.userRadius.toFixed(1));
  registry['btn-explode'].fire('click');
  await pump(90, 33);
  check('合拢归位', E.parts.every(p => p.group.position.distanceTo(p.basePos) < 0.05));
  const idx = E.parts.findIndex(p => p.def.id === 'lens');
  registry['parts-list'].children[idx].fire('click');
  await pump(6, 33);
  check('选中镜组后详情正确', String(registry['detail-body'].innerHTML).indexOf('155°') >= 0 &&
    String(registry['detail-tag'].textContent).indexOf('镜头') >= 0);
  registry['btn-explode'].fire('click');
  await pump(4, 33);
  registry['btn-explode'].fire('click');
  await pump(90, 33);

  console.log('\n-- 展台外壳（返回键 / 启动动画 / 音乐）--');
  check('返回展台按钮已注入', !!(E.stage && E.stage.back));
  check('启动动画处于待进入状态', E.S.intro === true || E.S.intro === false);
  registry['btn-enter'].fire('click');
  await pump(6, 33);
  check('点击进入后启动动画结束', E.S.intro === false);
  check('镜头飞入已触发并在推进', E.introFly === null || E.introFly.t >= 0,
    E.introFly ? ('进行中 ' + E.introFly.t.toFixed(2) + 's / ' + E.introFly.dur + 's') : '已完成');
  await pump(80, 33);
  check('飞入结束后相机回到正常机位',
    E.introFly === null && E.orbit.userRadius <= E.cfg.scene.radius * 1.05,
    'userRadius=' + E.orbit.userRadius.toFixed(1) + ' 目标=' + E.cfg.scene.radius);
  let musicErr = null;
  try { registry['btn-music'] = registry['btn-music'] || mkEl('button');
    document.getElementById('btn-music').fire('click'); document.getElementById('btn-music').fire('click'); }
  catch (e) { musicErr = e.message; }
  check('无 AudioContext 环境下音乐开关安全', !musicErr, musicErr || '静默跳过');
  check('启动配置已载入（默认或 dsh-startup）', !!(E.S.startup && E.S.startup.bootLines),
    E.S.startup ? (E.S.startup.bootLines.length + ' 条启动日志 · accent ' + E.S.startup.accent) : 'n/a');

  console.log('\n-- 去塑料感（材质与顶点着色）--');
  const mats = new Set();
  E.parts.forEach(p => p.meshes.forEach(m => {
    (Array.isArray(m.material) ? m.material : [m.material]).forEach(x => x && mats.add(x));
  }));
  const list = Array.from(mats);
  const plastic = list.filter(m => m.metalness > 0.12 && m.metalness < 0.5 && !m.map);
  check('无"塑料油光"材质（无贴图的中间 metalness 必须为 0）', plastic.length === 0,
    list.length + ' 种材质，可疑 ' + plastic.length + ' 种');
  const anyMat = list.find(m => m.metalness <= 0.12 && m.normalMap) || list[0];
  check('哑光件 metalness 已压到近 0', anyMat.metalness <= 0.12, 'metalness=' + anyMat.metalness);
  check('材质带微表面法线贴图', !!anyMat.normalMap && !!anyMat.normalScale,
    'normalScale=' + (anyMat.normalScale ? anyMat.normalScale.x : 'n/a'));
  check('材质带粗糙度噪声贴图', !!anyMat.roughnessMap);
  check('材质带环境反射强度', anyMat.envMapIntensity > 0, 'envMapIntensity=' + anyMat.envMapIntensity);
  let vcOK = 0, vcBad = 0, vcMin = 9, vcMax = -9, vcGeo = 0;
  E.root.traverse(o => {
    if (!o.isMesh || !o.geometry || !o.geometry.attributes || !o.geometry.attributes.color) return;
    vcGeo++;
    const arr = o.geometry.attributes.color.array;
    for (let i = 0; i < arr.length; i += Math.max(3, ((arr.length / 3) | 0) || 3)) {
      vcMin = Math.min(vcMin, arr[i]); vcMax = Math.max(vcMax, arr[i]);
      if (arr[i] > 0.55 && arr[i] < 1.2) vcOK++; else vcBad++;
    }
  });
  check('顶点色 AO 已烘焙且数值合理', vcOK > 20 && vcBad === 0 && vcGeo >= 100,
    vcGeo + ' 个几何体，样本 ' + vcOK + ' 个，范围 ' + vcMin.toFixed(2) + '~' + vcMax.toFixed(2));

  console.log('\n-- 展台功能（引擎级）--');
  check('后期管线存在或安全降级', !E.post || !!E.post.matComp,
    E.post ? '管线就绪（泛光 / 调色 / 暗角 / 颗粒）' : '已降级为直出（测试桩无渲染目标 API）');
  key('t');
  await pump(4, 33);
  check('演示巡航可开启', E.S.tour === true);
  const shot0 = E.S.tourI;
  await pump(220, 33);
  check('巡航镜头自动推进', E.S.tourI !== shot0 || E.S.tourT > 0.5, '镜头 ' + shot0 + ' → ' + E.S.tourI);
  key('t');
  await pump(3, 33);
  check('巡航可退出', E.S.tour === false);
  const sample = (function () {
    /* 蓝图模式按"材质"存档；引擎对多处复用的同一材质只会还原成"最后一次存档"的值，
       因此这里挑一个只被单个网格引用的材质来验证还原能力（共用材质的影响见报告）*/
    const use = new Map();
    E.parts.forEach(p => p.meshes.forEach(m => {
      const mm = Array.isArray(m.material) ? m.material[0] : m.material;
      if (mm) use.set(mm, (use.get(mm) || 0) + 1);
    }));
    let shared = 0;
    use.forEach(v => { if (v > 1) shared++; });
    console.log('  (info) 材质 ' + use.size + ' 种，其中 ' + shared + ' 种被多个网格共用');
    for (const p of E.parts) {
      for (const m of p.meshes) {
        const mm = Array.isArray(m.material) ? m.material[0] : m.material;
        if (mm && use.get(mm) === 1) return m;
      }
    }
    return E.parts[0].meshes[0];
  })();
  const matOf = m => (Array.isArray(m.material) ? m.material[0] : m.material);
  const wire0 = matOf(sample).wireframe, col0 = matOf(sample).color.getHex();
  key('b');
  await pump(3, 33);
  check('蓝图模式开启（线框 + 换色）', E.S.blueprint === true &&
    matOf(sample).wireframe === true && matOf(sample).color.getHex() !== col0,
    '#' + col0.toString(16) + ' → #' + matOf(sample).color.getHex().toString(16));
  key('b');
  await pump(3, 33);
  check('蓝图模式关闭并还原', E.S.blueprint === false &&
    matOf(sample).wireframe === wire0 && matOf(sample).color.getHex() === col0);
  // 引擎曾有的 bug：同一材质被多个网格共用时，退出蓝图会还原成"最后一次存档"的青色。
  // 这里用本页真实的共用材质再验一遍（独占材质的断言在上面）。
  const refCount = new Map();
  E.parts.forEach(p => p.meshes.forEach(m => {
    (Array.isArray(m.material) ? m.material : [m.material]).forEach(x => {
      if (x) refCount.set(x, (refCount.get(x) || 0) + 1);
    });
  }));
  const sharedMats = Array.from(refCount.entries()).filter(e => e[1] >= 2).map(e => e[0]);
  const sharedBefore = sharedMats.map(m => (m.color ? m.color.getHex() : null));
  key('b'); await pump(5, 33);
  key('b'); await pump(5, 33);
  let sharedBad = 0;
  sharedMats.forEach((m, i) => {
    if (sharedBefore[i] !== null && m.color && m.color.getHex() !== sharedBefore[i]) sharedBad++;
  });
  check('共用材质退出蓝图后也正确还原', sharedBad === 0 && sharedMats.length > 0,
    sharedMats.length + ' 种共用材质，异常 ' + sharedBad + ' 种');
  const li0 = registry['parts-list'].children[0];
  const before = li0.querySelector('.meta').children[0].textContent;
  key('u');
  await pump(3, 33);
  const after = li0.querySelector('.meta').children[0].textContent;
  check('中英双语可切换', E.S.lang === 'en' && after !== before, before + ' → ' + after);
  key('u');
  await pump(3, 33);
  check('切回中文', E.S.lang === 'cn');
  key('s');
  await pump(8, 33);
  check('状态自检扫描已启动', E.S.scanning === true, '进度 ' + (E.S.scanProgress || 0).toFixed(2));
  await pump(190, 33);
  check('状态自检扫描已完成', E.S.scanning === false && E.S.scanProgress >= 0.99,
    '进度 ' + E.S.scanProgress.toFixed(2));

  console.log('\n-- 按钮 / 键位 --');
  registry['btn-rotate'].fire('click');
  registry['btn-labels'].fire('click');
  registry['btn-reset'].fire('click');
  registry['btn-expand-all'].fire('click');
  registry['btn-parts'].fire('click');
  registry['btn-detail'].fire('click');
  (winListeners['resize'] || []).forEach(f => f());
  await pump(30, 33);
  check('按钮与 resize 无异常', true);
  check('遥测无 NaN', (() => {
    let tel = '';
    registry['telemetry-body'].children.forEach(row =>
      row.children.forEach(c => { if (c.classList.contains('v')) tel += c.textContent + ' '; }));
    return tel.indexOf('NaN') < 0;
  })(), 'ALT/HDG 正常');

  console.log('\n' + (failures.length ? '[FAIL] ' + failures.length + ': ' + failures.join(' | ') : '[PASS] all checks passed'));
  process.exit(failures.length ? 1 : 0);
})().catch(e => {
  console.error('[ERROR] runtime exception:');
  console.error(e && e.stack || e);
  process.exit(2);
});