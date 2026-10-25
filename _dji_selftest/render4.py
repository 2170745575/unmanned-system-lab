# PBR 近似光栅化：按 three.js r149 的管线（线性光照 → ACES → sRGB）预测浏览器实际画面
import json, math, os
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = json.load(open(os.environ.get('MODEL', os.path.join(HERE, 'felon.json')), encoding='utf-8'))
UP = np.array([0.0, 1.0, 0.0])
EXPOSURE = float(DATA.get('exposure', 1.0))
POST = os.environ.get('POST', '0') == '1'
P_THRESH = float(os.environ.get('THRESH', '1.30'))
P_KNEE = float(os.environ.get('KNEE', '0.60'))
P_BLOOM = float(os.environ.get('BLOOM', '0.60'))
P_VIG = float(os.environ.get('VIG', '0.55'))
P_GRAIN = float(os.environ.get('GRAIN', '0.016'))
P_TINT = [float(x) for x in os.environ.get('TINT', '1,1,1').split(',')]


def gblur(a, radius=16.0):
    sigma = radius / 2.0
    n = int(radius) * 2 + 1
    k = np.exp(-0.5 * ((np.arange(n) - n // 2) / sigma) ** 2)
    k /= k.sum()
    out = np.zeros_like(a)
    for tap in range(n):
        out += k[tap] * np.roll(a, tap - n // 2, axis=0)
    tmp = np.zeros_like(out)
    for tap in range(n):
        tmp += k[tap] * np.roll(out, tap - n // 2, axis=1)
    return tmp


def unit(v):
    return v / (np.linalg.norm(v) or 1.0)


CM = os.environ.get('COLOR_MGMT', '1') == '1'


def hex2lin(h):
    """COLOR_MGMT=1：按现代色彩管理把 sRGB hex 转成线性；否则 three r149 旧模式直接用原值当线性"""
    x = np.array([(h >> 16) & 255, (h >> 8) & 255, h & 255], dtype=np.float64) / 255.0
    if not CM:
        return x
    return np.where(x <= 0.04045, x / 12.92, np.power((x + 0.055) / 1.055, 2.4))


def srgb(x):
    x = np.clip(x, 0, 1)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055)


def aces(x):
    a, b, c, d, e = 2.51, 0.03, 2.43, 0.59, 0.14
    return np.clip((x * (a * x + b)) / (x * (c * x + d) + e), 0, 1)


def render(meshes, lights, out, theta=0.62, phi=1.06, size=(1200, 820), span=30.0, bg=(7, 11, 18)):
    W, H = size
    cam = np.array([math.sin(phi) * math.sin(theta), math.cos(phi), math.sin(phi) * math.cos(theta)])
    zax = unit(cam)
    xax = unit(np.cross(UP, zax))
    yax = np.cross(zax, xax)
    scale = min(W, H) / span

    L_amb = hex2lin(lights['ambient']['color']) * lights['ambient']['intensity'] if lights.get('ambient') else np.zeros(3)
    hemi = lights.get('hemi')
    L_hemi_sky = hex2lin(hemi['color']) * hemi['intensity'] if hemi else np.zeros(3)
    L_hemi_gnd = hex2lin(hemi['ground']) * hemi['intensity'] if hemi else np.zeros(3)
    dirs = [(unit(np.array(d['pos'])), hex2lin(d['color']) * d['intensity']) for d in lights.get('dir', [])]
    pts = [(np.array(p['pos']), hex2lin(p['color']) * p['intensity'], p.get('distance', 0), p.get('decay', 2))
           for p in lights.get('point', [])]

    color = np.tile(np.array(bg, dtype=np.float64), (H, W, 1))
    linbuf = np.tile(np.zeros(3), (H, W, 1))
    zbuf = np.full((H, W), -1e18)
    tris = 0

    for m in meshes:
        v = np.array(m['v'], dtype=np.float64).reshape(-1, 3, 3)
        albedo = hex2lin(m['color'])
        if m.get('hasMap'):
            albedo = np.array([32.0, 92.0, 124.0]) / 255.0
        if m.get('emissive'):
            albedo = hex2lin(m['emissive'])
        metal = m.get('metalness', 0.0)
        diff_albedo = albedo * (1.0 - metal * 0.85)
        emissive = hex2lin(m['emissive']) * 1.0 if m.get('emissive') else np.zeros(3)

        sx = v @ xax * scale + W / 2
        sy = -v @ yax * scale + H / 2
        sz = v @ zax
        n = np.cross(v[:, 1] - v[:, 0], v[:, 2] - v[:, 0])
        nl = np.linalg.norm(n, axis=1)
        ok = nl > 1e-9
        n = np.where(ok[:, None], n / np.where(ok[:, None], nl[:, None], 1), 0.0)
        face = np.sign(n @ zax)
        face[face == 0] = 1
        nn = n * face[:, None]          # 双面：法线朝向相机

        # 累积漫反射光照
        acc = np.tile(emissive, (len(v), 1)) + L_amb * diff_albedo + \
            (L_hemi_gnd + (L_hemi_sky - L_hemi_gnd) * 0.5) * diff_albedo
        for Ldir, Lcol in dirs:
            ndl = np.clip(nn @ Ldir, 0, None)
            acc += (Lcol[None, :] * ndl[:, None]) * diff_albedo[None, :]
        for ppos, pcol, pdist, pdecay in pts:
            dv = ppos[None, :] - v[:, 0, :]
            d = np.linalg.norm(dv, axis=1)
            Ldir2 = dv / np.where(d[:, None] > 1e-9, d[:, None], 1)
            att = np.ones(len(v)) if pdist <= 0 else np.clip(1 - d / pdist, 0, 1) ** pdecay
            ndl = np.clip((nn * Ldir2).sum(axis=1), 0, None)
            acc += (pcol[None, :] * (ndl * att)[:, None]) * diff_albedo[None, :]
        # 环境反射近似（金属感）
        acc += (0.16 * (1 - m.get('roughness', 0.5)) + 0.05) * metal * np.array([0.28, 0.42, 0.55])
        sh = aces(acc * EXPOSURE)
        cols = (srgb(sh) * 255.0)

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
            d = w0 * sz[i, 0] + w1 * sz[i, 1] + w2 * sz[i, 2]
            sub_z = zbuf[miny:maxy + 1, minx:maxx + 1]
            upd = inside & (d > sub_z)
            if not upd.any():
                continue
            sub_z[upd] = d[upd]
            color[miny:maxy + 1, minx:maxx + 1][upd] = cols[i]
            if POST:
                linbuf[miny:maxy + 1, minx:maxx + 1][upd] = (acc[i] * EXPOSURE)

    if POST:
        lum = linbuf @ np.array([0.2126, 0.7152, 0.0722])
        t0, t1 = P_THRESH, P_THRESH + P_KNEE
        w = np.clip((lum - t0) / max(t1 - t0, 1e-6), 0, 1)
        w = w * w * (3 - 2 * w)
        blur = gblur(linbuf * w[:, :, None], 16.0)
        comp = (linbuf + blur * P_BLOOM) * np.array(P_TINT)
        sh = aces(comp)
        yy, xx = np.mgrid[0:H, 0:W]
        r2 = ((xx / W) - 0.5) ** 2 + ((yy / H) - 0.5) ** 2
        vig = np.clip((0.92 - r2 * 2.4) / (0.92 - 0.28), 0, 1)
        sh = sh * (1.0 - P_VIG + P_VIG * vig)[:, :, None]
        rng = np.random.RandomState(7)
        sh = np.clip(sh + (rng.rand(H, W, 1) - 0.5) * P_GRAIN, 0, None)
        color = srgb(sh) * 255.0
        print('  [post] 阈值=%.2f 拐点=%.2f 强度=%.2f  亮部占比=%.2f%%' % (
            P_THRESH, P_KNEE, P_BLOOM, 100.0 * float((w > 0.02).mean())))

    img = Image.fromarray(color.astype(np.uint8))
    img.save(out)
    arr = np.asarray(img).astype(np.float64)
    lum = arr.sum(axis=2) / 3.0
    print('saved %s  tris=%d  平均亮度=%.1f  p99=%.0f  峰值=%.0f' % (
        os.path.basename(out), tris, lum.mean(), np.percentile(lum, 99), lum.max()))


KEY = os.environ.get('KEY', 'world')
TAG = os.environ.get('TAG', 'pbr')
SPAN = float(os.environ.get('SPAN', '26'))
TH = float(os.environ.get('THETA', '0.6'))
PH = float(os.environ.get('PHI', '1.05'))
render(DATA[KEY], DATA['lights'], os.path.join(HERE, TAG + '_' + KEY + '.png'), theta=TH, phi=PH, span=SPAN)