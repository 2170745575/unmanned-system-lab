# Z-buffer 软件光栅化（通用版：按 KEY 渲染，支持自发光材质）
import json, math, os
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
MODEL = os.environ.get('MODEL', os.path.join(HERE, 'felon.json'))
DATA = json.load(open(MODEL, encoding='utf-8'))
UP = np.array([0.0, 1.0, 0.0])
BG = np.array([7, 11, 18], dtype=np.float64)


def unit(v):
    return v / (np.linalg.norm(v) or 1.0)


def render(meshes, out, theta=0.62, phi=1.06, size=(1200, 820), span=30.0):
    W, H = size
    cam = np.array([math.sin(phi) * math.sin(theta), math.cos(phi), math.sin(phi) * math.cos(theta)])
    zax = unit(cam)
    xax = unit(np.cross(UP, zax))
    yax = np.cross(zax, xax)
    light = unit(np.array([-0.42, 0.74, 0.52]))
    scale = min(W, H) / span
    color = np.tile(BG, (H, W, 1))
    zbuf = np.full((H, W), -1e18)
    tris = 0

    for m in meshes:
        v = np.array(m['v'], dtype=np.float64).reshape(-1, 3, 3)
        if m.get('emissive'):
            base = np.array([(m['emissive'] >> s) & 255 for s in (16, 8, 0)], dtype=np.float64)
            base = np.clip(base * 1.25 + 30, 0, 255)
        else:
            base = np.array([(m['color'] >> s) & 255 for s in (16, 8, 0)], dtype=np.float64)
            if m.get('hasMap'):
                base = np.array([32.0, 92.0, 124.0])
        sx = v @ xax * scale + W / 2
        sy = -v @ yax * scale + H / 2
        sz = v @ zax
        n = np.cross(v[:, 1] - v[:, 0], v[:, 2] - v[:, 0])
        nl = np.linalg.norm(n, axis=1)
        ok = nl > 1e-9
        n = np.where(ok[:, None], n / np.where(ok[:, None], nl[:, None], 1), 0.0)
        face = np.sign(n @ zax)
        face[face == 0] = 1
        nn = n * face[:, None]
        sh = (0.24 + 0.78 * np.clip(nn @ light, 0, None)) * np.clip(0.80 + 0.35 * np.clip(nn @ zax, 0, 1), 0, 1.3)

        for i in range(len(v)):
            if not ok[i]:
                continue
            tris += 1
            x0, x1, x2 = sx[i, 0], sx[i, 1], sx[i, 2]
            y0, y1, y2 = sy[i, 0], sy[i, 1], sy[i, 2]
            minx = max(0, int(math.floor(min(x0, x1, x2)))); maxx = min(W - 1, int(math.ceil(max(x0, x1, x2))))
            miny = max(0, int(math.floor(min(y0, y1, y2)))); maxy = min(H - 1, int(math.ceil(max(y0, y1, y2))))
            if minx > maxx or miny > maxy:
                continue
            xs = np.arange(minx, maxx + 1); ys = np.arange(miny, maxy + 1)
            X, Y = np.meshgrid(xs, ys)
            den = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2)
            if abs(den) < 1e-12:
                continue
            w0 = ((y1 - y2) * (X - x2) + (x2 - x1) * (Y - y2)) / den
            w1 = ((y2 - y0) * (X - x2) + (x0 - x2) * (Y - y2)) / den
            w2 = 1.0 - w0 - w1
            inside = ((w0 >= 0) & (w1 >= 0) & (w2 >= 0)) | ((w0 <= 0) & (w1 <= 0) & (w2 <= 0))
            if not inside.any():
                continue
            d = (w0 * sz[i, 0] + w1 * sz[i, 1] + w2 * sz[i, 2])
            sub_z = zbuf[miny:maxy + 1, minx:maxx + 1]
            upd = inside & (d > sub_z)
            if not upd.any():
                continue
            sub_z[upd] = d[upd]
            col = np.clip(base * sh[i], 0, 255)
            color[miny:maxy + 1, minx:maxx + 1][upd] = col

    Image.fromarray(color.astype(np.uint8)).save(out)
    print('saved', os.path.basename(out), 'tris', tris)


KEY = os.environ.get('KEY', 'drone')
TAG = os.environ.get('TAG', 'f')
SPAN = float(os.environ.get('SPAN', '30'))
TH = float(os.environ.get('THETA', '0.62'))
PH = float(os.environ.get('PHI', '1.06'))
render(DATA[KEY], os.path.join(HERE, TAG + '_' + KEY + '.png'), theta=TH, phi=PH, span=SPAN)
if os.environ.get('ALL_VIEWS'):
    render(DATA[KEY], os.path.join(HERE, TAG + '_front.png'), theta=0.0, phi=1.5708, span=SPAN)
    render(DATA[KEY], os.path.join(HERE, TAG + '_side.png'), theta=1.5708, phi=1.5708, span=SPAN)
    render(DATA[KEY], os.path.join(HERE, TAG + '_top.png'), theta=0.0, phi=0.42, span=SPAN)