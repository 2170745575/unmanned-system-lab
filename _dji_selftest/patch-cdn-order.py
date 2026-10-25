# -*- coding: utf-8 -*-
"""把引擎的 Three.js 加载改成：本地 vendor 优先（瞬时、离线可用）→ unpkg → jsdelivr。
替换原因：原顺序是"CDN 优先、3.5 秒超时回退"，在本机实测 cdn.jsdelivr.net 超时，
每次加载都白等 3.5 秒；且本地 vendor 本来就随仓库分发，本地优先严格更优。"""
import io, os, sys
sys.stdout.reconfigure(encoding='utf-8')

MASTER = r'D:\deepseek工作\dji-felon-attack\engine.js'
COPIES = [r'D:\deepseek工作\%s\engine.js' % d for d in
          ('dji-medical-3d', 'dji-flycart100-3d', 'dji-action4-3d', 'dji-mavic3pro-3d')]

s = io.open(MASTER, encoding='utf-8').read()

# ---- 1) CDN 常量 → 备选列表 ----
old_cdn = "  var CDN = 'https://cdn.jsdelivr.net/npm/three@0.149.0/build/three.min.js';"
assert old_cdn in s, 'CDN 常量未匹配'
new_cdn = ("  // CDN 备选（本地 vendor 不可用时才用）。unpkg 放在前面：本机实测 jsdelivr 会超时。\n"
           "  var CDNS = [\n"
           "    'https://unpkg.com/three@0.149.0/build/three.min.js',\n"
           "    'https://cdn.jsdelivr.net/npm/three@0.149.0/build/three.min.js'\n"
           "  ];")
s = s.replace(old_cdn, new_cdn, 1)

# ---- 2) 启动流程：本地优先，再逐个试 CDN ----
old_boot = """    bootText('正在加载 Three.js…');
    loadScript(CDN, 3500)
      .then(function () { if (!window.THREE) throw new Error('CDN 内容异常'); })
      .catch(function (e) {
        bootText('CDN 不可用（' + (e && e.message) + '），切换本地 three.min.js…');
        return loadScript(LOCAL, 0);
      })"""
assert old_boot in s, '启动流程未匹配'
new_boot = """    bootText('正在加载 Three.js…');
    // 本地 vendor 优先：同一目录随仓库分发，零网络、离线可用、不受 CDN 可达性影响
    loadScript(LOCAL, 0)
      .then(function () { if (!window.THREE) throw new Error('本地 three.min.js 未提供 THREE'); })
      .catch(function (e) {
        // 本地缺失时才走 CDN，逐个尝试（前一个失败再试下一个）
        bootText('本地 three.min.js 不可用，尝试 CDN…');
        var i = 0;
        function tryNext() {
          if (i >= CDNS.length) throw new Error('所有 CDN 都不可用');
          var url = CDNS[i++];
          bootText('尝试 CDN：' + url.replace(/^https:\\/\\//, '').split('/')[0] + ' …');
          return loadScript(url, 3500).then(function () {
            if (!window.THREE) throw new Error('CDN 内容异常');
          }).catch(function () { return tryNext(); });
        }
        return tryNext();
      })"""
s = s.replace(old_boot, new_boot, 1)

io.open(MASTER, 'w', encoding='utf-8').write(s)
for c in COPIES:
    io.open(c, 'w', encoding='utf-8').write(s)
print('引擎加载顺序已改为「本地优先 → unpkg → jsdelivr」，并同步到 5 个目录')
print('  CDNS 列表:', 'unpkg' in s and 'jsdelivr' in s)
print('  本地优先:', 'loadScript(LOCAL, 0)' in s and s.index('loadScript(LOCAL, 0)') < s.index('tryNext()'))