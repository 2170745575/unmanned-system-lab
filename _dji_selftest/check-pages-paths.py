# -*- coding: utf-8 -*-
"""GitHub Pages 兼容性检查：绝对路径 / file:// 假设 / 相对引用 / CDN 与 vendor 回退"""
import io, os, re, sys
sys.stdout.reconfigure(encoding='utf-8')

BASE = r'D:\deepseek工作'
FOLDERS = ['dji-hub', 'dji-felon-attack', 'dji-medical-3d',
           'dji-flycart100-3d', 'dji-mavic3pro-3d', 'dji-action4-3d']

print('=== 1) 绝对路径 / file:// 引用（在子目录部署下会失效）===')
bad = 0
attr = re.compile(r'(?:src|href)\s*=\s*["\']([^"\']+)["\']')
for f in FOLDERS:
    d = os.path.join(BASE, f)
    for name in sorted(os.listdir(d)):
        if not name.endswith(('.html', '.js', '.json')) or name == 'three.min.js':
            continue
        p = os.path.join(d, name)
        try:
            t = io.open(p, encoding='utf-8').read()
        except Exception:
            continue
        for m in attr.finditer(t):
            v = m.group(1)
            if v.startswith('/') or v.startswith('file:'):
                print('  !! %s/%s -> %s' % (f, name, v)); bad += 1
        for m in re.finditer(r'fetch\(\s*["\']([^"\']+)["\']', t):
            if m.group(1).startswith('/'):
                print('  !! fetch 绝对路径 %s/%s -> %s' % (f, name, m.group(1))); bad += 1
print('  绝对/file:// 引用共 %d 处' % bad)

print()
print('=== 2) 各页相对引用（应为相对路径）===')
for f in FOLDERS:
    t = io.open(os.path.join(BASE, f, 'index.html'), encoding='utf-8').read()
    refs = sorted(set(m.group(1) for m in attr.finditer(t)
                      if not m.group(1).startswith(('#', 'http'))))
    print('  %-18s %s' % (f, ', '.join(refs)))

print()
print('=== 3) 引擎脚本与本地 vendor 回退 ===')
NO_THREE = {'dji-hub'}   # 门户是纯 HTML/CSS/Canvas2D，不加载 Three.js
for f in FOLDERS:
    t = io.open(os.path.join(BASE, f, 'index.html'), encoding='utf-8').read()
    scripts = re.findall(r'<script[^>]*src=["\']([^"\']+)["\']', t)
    three_ref = [s for s in scripts if 'three' in s.lower()]
    vendor_ok = os.path.exists(os.path.join(BASE, f, 'vendor', 'three.min.js'))
    if f in NO_THREE:
        print('  %-18s 不需要 Three.js（门户为纯 CSS/Canvas2D）  实际引用脚本: %s'
              % (f, ', '.join(scripts) or '无'))
    else:
        print('  %-18s 本地 vendor=%s  页面内直接引用 three 的脚本=%s（引擎运行期自注入 CDN 并回退）'
              % (f, '有' if vendor_ok else '缺失 !!', ', '.join(three_ref) or '无'))

print()
print('=== 4) 门户跳转目标是否存在 ===')
ok = True
hub = io.open(os.path.join(BASE, 'dji-hub', 'index.html'), encoding='utf-8').read()
for m in re.finditer(r"dir:\s*'\.\./([^/']+)/index\.html'", hub):
    tgt = os.path.join(BASE, m.group(1), 'index.html')
    e = os.path.exists(tgt)
    ok = ok and e
    print('  %-22s %s' % (m.group(1), '存在' if e else '缺失 !!'))
print('  门户链接全部有效:', ok)