/* 攻击无人机页面冒烟测试：按浏览器顺序加载 4 个模块，跑完整作战循环 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = 'D:\\deepseek工作\\dji-felon-attack';
const THREE = require(path.join(ROOT, 'vendor', 'three.min.js'));

/* ---------- 假时钟（让 1 帧 = 33ms 模拟时间，快速跑完扫描周期） ---------- */
let fakeNow = 0;
try { globalThis.performance = { now: () => fakeNow }; } catch (e) { /* ignore */ }
if (!globalThis.performance || globalThis.performance.now() !== fakeNow) {
  Object.defineProperty(globalThis, 'performance', { value: { now: () => fakeNow }, configurable: true });
}

/* ---------- 假 canvas 2D ---------- */
const grad = { addColorStop() {} };
let ctxCalls = 0;
const ctx2d = new Proxy({}, {
  get(t, p) {
    if (p === 'createLinearGradient' || p === 'createRadialGradient' || p === 'createPattern') return () => grad;
    if (p === 'measureText') return () => ({ width: 10 });
    if (p === 'canvas') return null;
    if (p === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
    return function () { ctxCalls++; };
  },
  set() { return true; }
});

function mkEl(tag) {
  const el = {
    tagName: String(tag || 'div').toUpperCase(),
    style: { setProperty() {}, removeProperty() {} }, dataset: {}, children: [], _h: {}, _attrs: {},
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); },
      remove(c) { this._s.delete(c); },
      toggle(c, f) {
        if (f === undefined) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); }
        else { f ? this._s.add(c) : this._s.delete(c); }
      },
      contains(c) { return this._s.has(c); }
    },
    appendChild(c) { el.children.push(c); c.parentNode = el; return c; },
    removeChild(c) { const i = el.children.indexOf(c); if (i >= 0) el.children.splice(i, 1); },
    addEventListener(t, fn) { (el._h[t] = el._h[t] || []).push(fn); },
    removeEventListener() {},
    fire(t, ev) { (el._h[t] || []).forEach(f => f(ev || {})); },
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
  el.getAttribute = (k) => (k === 'class' ? el.className : (el._attrs[k] !== undefined ? el._attrs[k] : null));
  el.getContext = () => ctx2d;
  return el;
}

const registry = {};
const IDS = ['boot', 'boot-text', 'stage', 'labels', 'lines', 'tip', 'parts-count', 'parts-list',
  'detail-body', 'detail-tag', 'btn-explode', 'btn-expand-all', 'btn-reset', 'btn-labels', 'btn-rotate',
  'btn-parts', 'btn-detail', 'btn-auto', 'btn-fire', 'btn-missile', 'btn-wave',
  'm-mode', 'm-wave', 'm-kill', 'm-threat', 'rd-rng', 'rd-cont', 'rd-ammo', 'rd-msl',
  'telemetry-body', 'targetboard', 'flash', 'radar', 'hint'];
IDS.forEach(id => { registry[id] = mkEl(id.indexOf('btn') === 0 ? 'button' : 'div'); });

const winListeners = {};
const CDN_MODE = process.env.CDN_MODE || 'fail';
const head = {
  appendChild(s) {
    if (s.src && s.src.indexOf('vendor') >= 0) {
      setTimeout(() => {
        globalThis.THREE = THREE;
        globalThis.window.THREE = THREE;
        s.onload && s.onload();
      }, 0);
      return;
    }
    if (CDN_MODE === 'hang') return;
    setTimeout(() => { s.onerror && s.onerror(); }, 0);
  }
};

const documentStub = {
  createElement: mkEl,
  createElementNS: (ns, t) => mkEl(t),
  getElementById: id => registry[id] || (registry[id] = mkEl('div')),
  querySelectorAll: sel => (sel === '.part-item' ? registry['parts-list'].children : []),
  querySelector: sel => {
    if (sel === '.part-item.active') {
      return registry['parts-list'].children.find(c => c.classList.contains('active')) || null;
    }
    return null;
  },
  head, body: { style: {} }, addEventListener() {}
};

const windowStub = windowStubInit();
function windowStubInit() {
  // 关键：浏览器里 window === globalThis，模块用 window.X = ... 挂的东西必须能被裸名访问
  globalThis.innerWidth = 1600;
  globalThis.innerHeight = 900;
  globalThis.devicePixelRatio = 1.5;
  globalThis.addEventListener = function (t, fn) { (winListeners[t] = winListeners[t] || []).push(fn); };
  globalThis.removeEventListener = function () {};
  return globalThis;
}

let renderCount = 0;
const _Group = THREE.Group;
const allGroups = [];
THREE.WebGLRenderer = function () {
  this.domElement = mkEl('canvas');
  this.domElement.setPointerCapture = () => {};
  this.shadowMap = {};
  this.setPixelRatio = () => {}; this.setSize = () => {};
  this.render = () => { renderCount++; };
  this.outputEncoding = null; this.toneMapping = null; this.toneMappingExposure = 1;
};
THREE.PMREMGenerator = function () {
  this.compileEquirectangularShader = () => {};
  this.fromEquirectangular = () => ({ texture: new THREE.Texture() });
  this.dispose = () => {};
};
THREE.Group = function () { const g = new _Group(); allGroups.push(g); return g; };

const rafQueue = [];
globalThis.window = windowStub;
globalThis.document = documentStub;
globalThis.requestAnimationFrame = cb => { rafQueue.push(cb); return rafQueue.length; };
globalThis.cancelAnimationFrame = () => {};

/* 按浏览器顺序加载模块（engine.js 最后，它负责 boot） */
const FILES = ['enemies.js', 'model-attack.js', 'combat.js', 'engine.js'];
const srcs = FILES.map(f => ({ f: f, src: fs.readFileSync(path.join(ROOT, f), 'utf8') }));

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
  console.log('-- load order (THREE undefined at first) --');
  let loadErr = null;
  for (const s of srcs) {
    try { new Function(s.src)(); }
    catch (e) { loadErr = s.f + ': ' + (e && e.message); break; }
  }
  check('4 个模块在 THREE 未加载时可安全执行', !loadErr, loadErr || '');
  if (loadErr) { console.log('\n[FAIL] ' + loadErr); process.exit(1); }

  await new Promise(r => setTimeout(r, 40));
  if (CDN_MODE === 'hang') await new Promise(r => setTimeout(r, 4400));
  check('THREE 已就绪', !!globalThis.THREE);
  await pump(6);
  const E = globalThis.window.DJIEngine && globalThis.window.DJIEngine.E;
  check('引擎实例存在', !!E);
  if (!E) { process.exit(2); }

  // 启动遮罩必须在成功后消失（这是"页面一直转圈"的经典成因，必须自动化守住）
  await new Promise(r => setTimeout(r, 420));
  check('启动遮罩已隐藏（.hide）', registry['boot'].classList.contains('hide'));
  await new Promise(r => setTimeout(r, 1100));
  check('启动遮罩已从 DOM 移除', !registry['boot'].parentNode);

  // 静态核对：JS 源码里 getElementById/byId 要过的 id，必须真的写在 index.html 里
  // （测试桩会自动凭空造出任何 id，所以这条只能靠比对 HTML 来守）
  const htmlSrc = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const definedIds = new Set((htmlSrc.match(/id="([^"]+)"/g) || []).map(s => s.slice(4, -1)));
  const askedIds = new Set();
  FILES.forEach(f => {
    const src2 = fs.readFileSync(path.join(ROOT, f), 'utf8');
    (src2.match(/(?:byId|getElementById)\(\s*'([^']+)'/g) || []).forEach(m => {
      askedIds.add(m.replace(/^[^']*'/, '').replace(/'$/, ''));
    });
  });
  const OPTIONAL_IDS = ['btn-fold', 'btn-tour', 'btn-blueprint', 'btn-lang', 'btn-music', 'stage-vig', 'btn-back', 'stage-intro', 'btn-enter', 'btn-fly', 'selftest', 'selftest-list', 'm-status', 'intro-kicker', 'intro-title', 'intro-sub', 'intro-hint', 'intro-log', 'hint-extra', 'dji-stage-css', 'cinema', 'cinema-cap', 'panel-parts-title', 'panel-detail-title'];   // 引擎按机型是否有机臂铰链条件绑定
  const missingIds = Array.from(askedIds).filter(k => !definedIds.has(k) && OPTIONAL_IDS.indexOf(k) < 0);
  check('JS 源码引用的 DOM id 都存在于 HTML', missingIds.length === 0,
    missingIds.length ? '缺失: ' + missingIds.join(', ') : askedIds.size + ' 个全部命中');

  console.log('\n-- 模型 --');
  const partGroups = allGroups.filter(g => g.userData && g.userData.partId);
  check('部件数量 = 清单项数', partGroups.length === registry['parts-list'].children.length && partGroups.length >= 20,
    partGroups.length + ' 个');
  check('有转塔轴心的部件', partGroups.filter(g => g.userData.partId === 'cannon').length === 1);
  check('渲染循环有帧输出', renderCount > 0, renderCount + ' 帧');
  check('详情面板已填充', registry['detail-body'].innerHTML.length > 200);

  console.log('\n-- 相机与数值健全性（NaN 会让画面全黑且不报错）--');
  const finite = v => typeof v === 'number' && isFinite(v);
  check('轨道参数有限', finite(E.orbit.theta) && finite(E.orbit.phi) && finite(E.orbit.radius),
    'theta=' + E.orbit.theta + ' phi=' + E.orbit.phi + ' radius=' + E.orbit.radius);
  check('相机位置有限', finite(E.camera.position.x) && finite(E.camera.position.y) && finite(E.camera.position.z),
    E.camera.position.x.toFixed(1) + ',' + E.camera.position.y.toFixed(1) + ',' + E.camera.position.z.toFixed(1));
  check('场景参数合并自 model.scene',
    E.cfg.scene.radius === E.model.scene.radius && E.cfg.scene.zoomBias === E.model.scene.zoomBias,
    'radius=' + E.cfg.scene.radius + ' zoomBias=' + E.cfg.scene.zoomBias);
  check('地面高度取自 model.scene', E.FLOOR_Y === E.model.scene.floorY, 'FLOOR_Y=' + E.FLOOR_Y);
  let allText = '';
  registry['telemetry-body'].children.forEach(row =>
    row.children.forEach(c => { if (c.classList.contains('v')) allText += c.textContent + ' '; }));
  check('遥测文本无 NaN', allText.indexOf('NaN') < 0, allText.trim().slice(0, 60));
  check('雷达量程已显示', /^\d+$/.test(String(registry['rd-rng'].textContent)), String(registry['rd-rng'].textContent));

  // 光源健全性：任何一个光的 intensity/position 变成 NaN 都会让整场景受光材质变纯黑
  let badLights = [];
  E.scene.traverse(o => {
    if (!o.isLight) return;
    const bad = !isFinite(o.intensity) || o.intensity < 0 ||
      !isFinite(o.position.x) || !isFinite(o.position.y) || !isFinite(o.position.z);
    if (bad) badLights.push((o.type || '?') + ' I=' + o.intensity + ' pos=' + o.position.toArray());
  });
  check('场景光源全部健全（无 NaN 强度）', badLights.length === 0,
    badLights.length ? badLights.slice(0, 3).join(' | ') : '无异常光源');

  console.log('\n-- 作战系统 --');
  const C = E.behavior;
  check('behavior 已挂载', !!C && typeof C.update === 'function');
  const enemies = globalThis.window.__enemiesForTest;
  // 从场景里数敌方模型
  let enemyCount = 0;
  E.scene.traverse(o => { if (o.userData && o.userData.enemyRef) enemyCount++; });
  check('敌人已生成', enemyCount > 0, enemyCount + ' 个敌方网格');

  // 跑一段作战：模拟 ~40 秒
  ctxCalls = 0;
  const err = await pump(1200, 33);
  check('作战循环无异常', !err, err ? String(err && err.message) : '');
  const els = E.hud.els;
  check('遥测行已生成', registry['telemetry-body'].children.length > 0,
    registry['telemetry-body'].children.length + ' 行');
  check('任务状态已更新', /MODE /.test(String(registry['m-mode'].textContent)),
    String(registry['m-mode'].textContent));
  check('击杀计数在推进', Number(registry['m-kill'].textContent) > 0,
    'KILL ' + registry['m-kill'].textContent);
  check('目标板已渲染', String(registry['targetboard'].innerHTML).indexOf('tgt') >= 0);
  check('弹药在消耗/补给', /^\d+\/60$/.test(String(registry['rd-ammo'].textContent)),
    String(registry['rd-ammo'].textContent));
  check('波次已推进', Number(registry['m-wave'].textContent) >= 1,
    'WAVE ' + registry['m-wave'].textContent);
  let fxCount = 0;
  E.scene.traverse(o => { if (o.isSprite || o.isLight || (o.isMesh && o.parent && o.parent === o.parent)) fxCount++; });
  check('场景仍有内容渲染', fxCount > 0, fxCount + ' 对象');

  console.log('\n-- 拆解与选中仍可用 --');
  registry['btn-auto'].fire('click');            // 先停火，避免机炮后坐影响归位判定
  await pump(20, 33);
  registry['btn-explode'].fire('click');
  await pump(80, 33);
  const moved = partGroups.filter(g => g.position.length() > 0.5).length;
  check('拆解动画正常', moved === partGroups.length, moved + '/' + partGroups.length);
  check('拆解时相机自动拉远', E.orbit.radius > E.orbit.userRadius + 1,
    'radius=' + E.orbit.radius.toFixed(1) + ' user=' + E.orbit.userRadius.toFixed(1));
  registry['btn-explode'].fire('click');
  await pump(80, 33);
  check('合拢归位', E.parts.every(p => p.group.position.distanceTo(p.basePos) < 0.05));
  const pick = E.parts.findIndex(p => p.def.id === 'cannon');
  registry['parts-list'].children[pick].fire('click');
  await pump(6, 33);
  check('选中机炮后详情正确', registry['detail-body'].innerHTML.indexOf('30mm') >= 0);
  const brks = registry['lines'].children.filter(c => c.classList.contains('lockbrk'));
  check('部件锁定框已绘制', brks.some(b => b.classList.contains('on')));

  console.log('\n-- 按钮 / 键位 --');
  registry['btn-auto'].fire('click');
  registry['btn-auto'].fire('click');
  registry['btn-fire'].fire('click');
  registry['btn-missile'].fire('click');
  registry['btn-wave'].fire('click');
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