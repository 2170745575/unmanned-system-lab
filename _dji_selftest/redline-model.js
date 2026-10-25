/* 独立红线验证：在 THREE 全程 undefined（且被 getter 陷阱监控）的环境里
   执行模型模块源码，确认顶层不触碰 THREE、且模块正确自注册。
   用法：ROOT / FILES / GLOBAL 环境变量。 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = process.env.ROOT;
const FILES = process.env.FILES.split(',');
const GLOBAL = process.env.GLOBAL;

let touched = 0;
const win = {};
// THREE 只存在于 window 上，且任何读写都会被计数（模型不该在顶层碰它）
Object.defineProperty(win, 'THREE', {
  configurable: true,
  get() { touched++; throw new Error('RED LINE: 顶层读取了 THREE'); },
  set() { touched++; throw new Error('RED LINE: 顶层写入 THREE'); }
});
global.window = win;
global.document = undefined;

let err = null;
for (const f of FILES) {
  try {
    new Function('window', fs.readFileSync(path.join(ROOT, f), 'utf8'))(win);
  } catch (e) { err = f + ': ' + e.message; break; }
}
const page = win.DJIPage || {};
const model = page.model;
const out = {
  files: FILES,
  topLevelError: err,
  threeTouched: touched,
  registered: !!model,
  globalName: GLOBAL,
  hasModel: !!model,
  partCount: model && model.parts ? model.parts.length : 0,
  hasBuilder: !!(model && model.builder),
  hasBuilderFactory: !!(model && typeof model.builderFactory === 'function'),
  hasScene: !!(model && model.scene),
  aerial: model ? model.aerial : undefined,
  // 注意：不要去读 win.THREE —— 那会触发上面的陷阱，污染 touched 计数。
  // touched === 0 本身就等价于"顶层没碰过 THREE"。
  threeUntouched: touched === 0
};
console.log(JSON.stringify(out, null, 1));
const ok = !err && touched === 0 && model && out.partCount > 0 &&
  (out.hasBuilder || out.hasBuilderFactory) && out.hasScene;
console.log(ok ? '[PASS] 红线通过' : '[FAIL] 红线未通过');
process.exit(ok ? 0 : 1);