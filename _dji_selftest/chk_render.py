# 临时：高分辨率/裁剪出图，复用 render4.py 的光栅化函数（不改动既有脚本）
import importlib.util, os, sys, json, math
HERE = os.path.dirname(os.path.abspath(__file__))

spec = importlib.util.spec_from_file_location('r4', os.path.join(HERE, 'render4.py'))
r4 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r4)          # 会顺带按环境变量出一张默认图

D = r4.DATA
KEY = os.environ.get('KEY', 'drone')
L = D['lights']
OUTDIR = os.path.join(HERE, os.environ.get('SUBDIR', 'zoom'))
os.makedirs(OUTDIR, exist_ok=True)

# 视角列表：name, theta, phi, span, size, 裁剪中心(屏幕比例) 与裁剪尺寸(像素)
vf = os.environ.get('VIEWSFILE', '')
VIEWS = json.load(open(vf, encoding='utf-8')) if vf else []
for v in VIEWS:
    out = os.path.join(OUTDIR, v['name'] + '.png')
    r4.render(D[KEY], L, out, theta=v['th'], phi=v['ph'],
              size=tuple(v.get('size', [1400, 950])), span=v['span'],
              bg=(7, 11, 18))
    if v.get('crop'):
        from PIL import Image
        im = Image.open(out)
        W, H = im.size
        cx, cy, cw, ch = v['crop']            # 比例坐标 + 裁剪宽高比例
        box = (int((cx - cw / 2) * W), int((cy - ch / 2) * H),
               int((cx + cw / 2) * W), int((cy + ch / 2) * H))
        box = (max(0, box[0]), max(0, box[1]), min(W, box[2]), min(H, box[3]))
        c = im.crop(box)
        z = v.get('zoom', 2)
        c = c.resize((c.width * z, c.height * z), Image.LANCZOS)
        cp = os.path.join(OUTDIR, v['name'] + '_crop.png')
        c.save(cp)
        print('crop ->', cp, c.size)
print('done')