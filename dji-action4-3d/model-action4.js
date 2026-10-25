/* =========================================================================
   DJI Osmo Action 4 · 运动相机机型模块（model-action4.js）
   -------------------------------------------------------------------------
   18 个部件的运动相机拆解模型：镜圈 / 镜组 / 传感器 / 主控 / 电池 / 散热 /
   中框 / 双屏 / 按键 / 卡仓 / 麦克风阵列 / 磁吸底座。
   只提供数据与几何，不含任何引擎逻辑（加载 / 场景 / 轨道 / 拾取 / 拆解 /
   HUD / 面板 / 后期 / 巡航 / 蓝图 / 双语 / 展台外壳全部来自 engine.js）。
   注意：本文件先于 Three.js 加载执行，模块顶层绝对不能触碰 THREE。
   ========================================================================= */
(function () {
  'use strict';

  /* =======================================================================
     0. 引擎 helper 转发
     -----------------------------------------------------------------------
     本模型的建模代码原本写在独立页 app.js 里，直接引用自己的 THREE / TEX /
     几何工具。移植到共享引擎后，靠这一层"运行期转发"把原来的自由变量解析
     到引擎注入的 H（helper 工具包）：
       · addMesh / std（以及 matte / metal / carbon / painted / glass /
         emissiveMat）必须走引擎 —— 前者负责顶点色 AO 烘焙与拾取注册，
         后者承载"去塑料感"材质规则；
       · box / cyl / cylZ / roundedBox / ringParts / loftGeo / bladeGeo /
         placeAlong / makeTex / sectionArc / rand / lerp / clamp 同理转发，
         保证几何工具与其它三个机型完全同源。
     顶层只有变量声明与函数定义，不触碰 THREE；真正的 THREE 在 makeBuilder
     里由引擎注入（buildTextures 也推迟到那一刻才执行）。
     ======================================================================= */
  var THREE = null;   // 运行期由 makeBuilder 注入
  var H_ = null;      // 引擎的 helper 工具包
  var TEX = null;     // 本机型自带的程序化贴图（不依赖引擎 TEX 的键）

  function forward(name) {
    return function () { return H_[name].apply(null, arguments); };
  }
  var addMesh = forward('addMesh');
  var std = forward('std');
  var box = forward('box');
  var cyl = forward('cyl');
  var cylZ = forward('cylZ');
  var roundedBox = forward('roundedBox');
  var ringParts = forward('ringParts');
  var loftGeo = forward('loftGeo');
  var bladeGeo = forward('bladeGeo');
  var placeAlong = forward('placeAlong');
  var makeTex = forward('makeTex');
  var sectionArc = forward('sectionArc');
  var rand = forward('rand');
  var lerp = forward('lerp');
  var clamp = forward('clamp');
  var matte = forward('matte');
  var metal = forward('metal');
  var carbon = forward('carbon');
  var painted = forward('painted');
  var glass = forward('glass');
  var emissiveMat = forward('emissiveMat');

  /* =======================================================================
     1. 关键尺寸（cm，与旧版 app.js 完全一致；1 单位 = 1 cm，ROOT_SCALE = 1）
     ======================================================================= */
  var BODY_W = 7.05, BODY_H = 4.42, BODY_D = 3.28;
  var HX = BODY_W / 2, HY = BODY_H / 2, HZ = BODY_D / 2;
  var FRONT_Z = HZ;                    // 1.64
  var SHELL_FRONT_Z = FRONT_Z - 0.36;  // 1.28 前面板内表面
  var LENS_X = -1.62, LENS_Y = 0.10;
  var SCR_X = 1.68, SCR_Y = -0.05;

  /* =======================================================================
     2. 程序化贴图（canvas 生成，无任何外部图片）
     ======================================================================= */
  function rr(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.lineTo(x + w - r, y);
    g.quadraticCurveTo(x + w, y, x + w, y + r);
    g.lineTo(x + w, y + h - r);
    g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    g.lineTo(x + r, y + h);
    g.quadraticCurveTo(x, y + h, x, y + h - r);
    g.lineTo(x, y + r);
    g.quadraticCurveTo(x, y, x + r, y);
    g.closePath();
  }

  function buildTextures() {
    TEX = {};

    /* --- 机身表面细噪点 --- */
    TEX.noise = makeTex(256, 256, function (g, w, h) {
      g.fillStyle = '#8a8a8a';
      g.fillRect(0, 0, w, h);
      for (var i = 0; i < 26000; i++) {
        var v = 118 + Math.random() * 90;
        g.fillStyle = 'rgba(' + (v | 0) + ',' + (v | 0) + ',' + (v | 0) + ',' + (0.05 + Math.random() * 0.25) + ')';
        g.fillRect(Math.random() * w, Math.random() * h, 1.4, 1.4);
      }
    }, { linear: true, repeat: [3, 3] });

    /* --- PCB 走线 --- */
    TEX.pcb = makeTex(512, 512, function (g, w, h) {
      var grd = g.createLinearGradient(0, 0, w, h);
      grd.addColorStop(0, '#0c3227');
      grd.addColorStop(0.5, '#0a2b21');
      grd.addColorStop(1, '#0d3a2c');
      g.fillStyle = grd; g.fillRect(0, 0, w, h);
      g.lineCap = 'round';
      for (var i = 0; i < 150; i++) {
        var x = Math.random() * w, y = Math.random() * h;
        g.strokeStyle = 'rgba(126,231,180,' + (0.08 + Math.random() * 0.3) + ')';
        g.lineWidth = Math.random() < 0.75 ? 1.3 : 2.6;
        g.beginPath(); g.moveTo(x, y);
        var segs = 2 + (Math.random() * 4 | 0);
        for (var s = 0; s < segs; s++) {
          if (Math.random() < 0.5) x += (Math.random() - 0.5) * 150; else y += (Math.random() - 0.5) * 150;
          g.lineTo(x, y);
        }
        g.stroke();
      }
      for (var p = 0; p < 260; p++) {
        g.fillStyle = 'rgba(226,201,120,' + (0.15 + Math.random() * 0.55) + ')';
        var r = 1.2 + Math.random() * 2.6;
        g.beginPath(); g.arc(Math.random() * w, Math.random() * h, r, 0, 6.283); g.fill();
      }
    });

    /* --- 后置触摸屏 UI --- */
    TEX.screenRear = makeTex(1280, 720, function (g, w, h) {
      // 取景画面
      var sky = g.createLinearGradient(0, 0, 0, h * 0.62);
      sky.addColorStop(0, '#0d2340'); sky.addColorStop(0.55, '#1d4a72'); sky.addColorStop(1, '#7ba8c4');
      g.fillStyle = sky; g.fillRect(0, 0, w, h * 0.62);
      var sun = g.createRadialGradient(w * 0.72, h * 0.3, 0, w * 0.72, h * 0.3, 210);
      sun.addColorStop(0, 'rgba(255,214,170,.95)'); sun.addColorStop(0.35, 'rgba(255,170,110,.35)');
      sun.addColorStop(1, 'rgba(255,140,80,0)');
      g.fillStyle = sun; g.fillRect(0, 0, w, h * 0.62);
      // 远山
      g.fillStyle = '#0a1a2a';
      g.beginPath(); g.moveTo(0, h * 0.62);
      var pts = [[0, 0.60], [0.14, 0.48], [0.26, 0.58], [0.38, 0.42], [0.52, 0.57], [0.66, 0.46], [0.8, 0.58], [1, 0.5]];
      for (var i = 0; i < pts.length; i++) g.lineTo(pts[i][0] * w, pts[i][1] * h);
      g.lineTo(w, h * 0.62); g.closePath(); g.fill();
      // 水面
      var water = g.createLinearGradient(0, h * 0.62, 0, h);
      water.addColorStop(0, '#0e2c46'); water.addColorStop(1, '#061523');
      g.fillStyle = water; g.fillRect(0, h * 0.62, w, h * 0.38);

      // HUD
      g.font = '600 34px ui-monospace, Menlo, Consolas, monospace';
      g.textBaseline = 'middle';
      // REC
      g.fillStyle = '#ff3b30';
      g.beginPath(); g.arc(64, 52, 14, 0, 6.283); g.fill();
      g.fillStyle = 'rgba(255,255,255,.94)'; g.fillText('REC', 92, 53);
      g.fillStyle = 'rgba(255,255,255,.82)'; g.fillText('00:12:34', 176, 53);
      // 右上角
      g.textAlign = 'right';
      g.fillStyle = 'rgba(255,255,255,.92)'; g.fillText('4K 120', w - 190, 53);
      g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 3;
      g.strokeRect(w - 156, 38, 60, 28);
      g.fillStyle = 'rgba(120,240,170,.95)'; g.fillRect(w - 152, 42, 40, 20);
      g.fillStyle = 'rgba(255,255,255,.85)';
      g.fillText('155°', w - 210, 104);
      // 底部参数
      g.textAlign = 'left';
      g.fillStyle = 'rgba(0,0,0,.32)'; rr(g, 40, h - 96, w - 80, 60, 14); g.fill();
      g.fillStyle = 'rgba(255,255,255,.9)';
      g.font = '500 30px ui-monospace, Menlo, Consolas, monospace';
      g.fillText('1/240   ISO 100   EV 0.0   WB 5600K   f/2.8', 64, h - 65);
      g.textAlign = 'right';
      g.fillStyle = '#7fe6ff';
      g.fillText('D-Log M · 10-bit', w - 64, h - 65);
      // 角标
      g.strokeStyle = 'rgba(127,230,255,.55)'; g.lineWidth = 3;
      var L = 54, m = 132;
      [[m, m, 1, 1], [w - m, m, -1, 1], [m, h - m, 1, -1], [w - m, h - m, -1, -1]].forEach(function (c) {
        g.beginPath();
        g.moveTo(c[0] + c[2] * L, c[1]); g.lineTo(c[0], c[1]); g.lineTo(c[0], c[1] + c[3] * L);
        g.stroke();
      });
      // 暗角
      var vig = g.createRadialGradient(w / 2, h / 2, h * 0.35, w / 2, h / 2, h * 0.95);
      vig.addColorStop(0, 'rgba(0,0,0,0)'); vig.addColorStop(1, 'rgba(0,0,0,.45)');
      g.fillStyle = vig; g.fillRect(0, 0, w, h);
    });

    /* --- 前置触摸屏 UI --- */
    TEX.screenFront = makeTex(512, 512, function (g, w, h) {
      var bg = g.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, '#0a1c2e'); bg.addColorStop(1, '#050d16');
      g.fillStyle = bg; g.fillRect(0, 0, w, h);
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = '#7fe6ff';
      g.font = '600 26px ui-monospace, Menlo, Consolas, monospace';
      g.fillText('VIDEO', w / 2, 74);
      g.fillStyle = 'rgba(255,255,255,.97)';
      g.font = '700 92px ui-monospace, Menlo, Consolas, monospace';
      g.fillText('4K', w / 2, 168);
      g.fillStyle = '#7fe6ff';
      g.font = '600 40px ui-monospace, Menlo, Consolas, monospace';
      g.fillText('120 fps', w / 2, 240);
      // 录制按钮
      g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 5;
      g.beginPath(); g.arc(w / 2, 372, 56, 0, 6.283); g.stroke();
      g.fillStyle = '#ff3b30';
      g.beginPath(); g.arc(w / 2, 372, 38, 0, 6.283); g.fill();
      // 顶部状态
      g.font = '500 22px ui-monospace, Menlo, Consolas, monospace';
      g.textAlign = 'left'; g.fillStyle = 'rgba(255,255,255,.8)';
      g.fillText('ROCKSTEADY', 42, 44);
      g.textAlign = 'right';
      g.fillText('87%', w - 62, 44);
      g.strokeStyle = 'rgba(255,255,255,.8)'; g.lineWidth = 3;
      g.strokeRect(w - 56, 34, 30, 18);
      g.fillStyle = 'rgba(120,240,170,.95)'; g.fillRect(w - 53, 37, 21, 12);
      // 底部
      g.textAlign = 'center'; g.fillStyle = 'rgba(255,255,255,.55)';
      g.font = '500 22px ui-monospace, Menlo, Consolas, monospace';
      g.fillText('D-Log M  ·  155°', w / 2, 468);
    });

    /* --- 电池标签 --- */
    TEX.battery = makeTex(512, 384, function (g, w, h) {
      g.fillStyle = '#20262f'; g.fillRect(0, 0, w, h);
      var grd = g.createLinearGradient(0, 0, w, h);
      grd.addColorStop(0, 'rgba(255,255,255,.05)'); grd.addColorStop(1, 'rgba(0,0,0,.25)');
      g.fillStyle = grd; g.fillRect(0, 0, w, h);
      g.fillStyle = '#ffcc00'; g.fillRect(0, 0, w, 10);
      g.fillStyle = 'rgba(255,255,255,.95)';
      g.font = '800 62px Inter, Segoe UI, sans-serif';
      g.fillText('DJI', 40, 100);
      g.font = '600 26px ui-monospace, Menlo, Consolas, monospace';
      g.fillStyle = '#9fd8e6';
      g.fillText('Li-Po BATTERY  1770 mAh  6.8 Wh', 42, 152);
      g.fillStyle = 'rgba(255,255,255,.6)';
      g.font = '500 22px ui-monospace, Menlo, Consolas, monospace';
      g.fillText('Osmo Action 4  ·  HB4.0', 42, 196);
      g.fillText('18 min → 80%  /  -20°C ~ 45°C', 42, 232);
      g.fillStyle = 'rgba(255,255,255,.22)';
      g.fillRect(42, 268, w - 84, 2);
      g.fillStyle = 'rgba(255,255,255,.5)';
      g.font = '500 20px ui-monospace, Menlo, Consolas, monospace';
      g.fillText('CAUTION: DO NOT PUNCTURE / DISASSEMBLE', 42, 312);
      // 触点
      g.fillStyle = '#d8b64a';
      g.fillRect(w - 130, 320, 26, 30);
      g.fillRect(w - 92, 320, 26, 30);
      g.fillRect(w - 54, 320, 26, 30);
    });

    /* --- 扬声器网罩 --- */
    TEX.grille = makeTex(128, 128, function (g, w, h) {
      g.fillStyle = '#0b0e13'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#2b323c';
      for (var y = 8; y < h; y += 12) {
        for (var x = 8 + (y / 12 % 2) * 6; x < w; x += 12) {
          g.beginPath(); g.arc(x, y, 3.4, 0, 6.283); g.fill();
        }
      }
    });

    /* --- 发光精灵 --- */
    TEX.glow = makeTex(256, 256, function (g, w, h) {
      var grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      grd.addColorStop(0, 'rgba(255,255,255,1)');
      grd.addColorStop(0.18, 'rgba(255,255,255,.55)');
      grd.addColorStop(0.45, 'rgba(255,255,255,.14)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd; g.fillRect(0, 0, w, h);
    });

    /* --- 环境贴图（等距柱状渐变，用于金属反射） --- */
    TEX.env = makeTex(1024, 512, function (g, w, h) {
      var grd = g.createLinearGradient(0, 0, 0, h);
      grd.addColorStop(0, '#0b1622');
      grd.addColorStop(0.45, '#16283a');
      grd.addColorStop(0.55, '#0d1620');
      grd.addColorStop(1, '#05080d');
      g.fillStyle = grd; g.fillRect(0, 0, w, h);
      var blobs = [[0.24, 0.30, 'rgba(90,200,255,.95)', 190], [0.70, 0.24, 'rgba(255,180,120,.75)', 150], [0.5, 0.62, 'rgba(60,120,180,.5)', 260]];
      blobs.forEach(function (b) {
        var rg = g.createRadialGradient(b[0] * w, b[1] * h, 0, b[0] * w, b[1] * h, b[3]);
        rg.addColorStop(0, b[2]); rg.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = rg; g.fillRect(0, 0, w, h);
      });
    });
    TEX.env.mapping = THREE.EquirectangularReflectionMapping;
  }

  /* =======================================================================
     3. 本机型专用的两个几何工具（其余全部转发引擎 helper）
     ======================================================================= */
  /** 圆角矩形轮廓 */
  function roundedRectPath(target, cx, cy, w, h, r) {
    var x = cx - w / 2, y = cy - h / 2;
    target.moveTo(x + r, y);
    target.lineTo(x + w - r, y);
    target.quadraticCurveTo(x + w, y, x + w, y + r);
    target.lineTo(x + w, y + h - r);
    target.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    target.lineTo(x + r, y + h);
    target.quadraticCurveTo(x, y + h, x, y + h - r);
    target.lineTo(x, y + r);
    target.quadraticCurveTo(x, y, x + r, y);
    return target;
  }

  /** 带镂空的挤压板（前面板：镜头圆孔 + 前屏方孔） */
  function plateWithHoles(w, h, r, depth, holes) {
    var shape = new THREE.Shape();
    roundedRectPath(shape, 0, 0, w, h, r);
    (holes || []).forEach(function (ho) {
      var path = new THREE.Path();
      if (ho.type === 'circle') {
        path.absarc(ho.x, ho.y, ho.r, 0, Math.PI * 2, true);
      } else {
        roundedRectPath(path, ho.x, ho.y, ho.w, ho.h, ho.r || 0.12);
      }
      shape.holes.push(path);
    });
    var geo = new THREE.ExtrudeGeometry(shape, {
      depth: depth, bevelEnabled: true, bevelThickness: 0.035,
      bevelSize: 0.035, bevelSegments: 3, curveSegments: 28, steps: 1
    });
    geo.translate(0, 0, -depth / 2);
    geo.computeVertexNormals();
    return geo;
  }

  /** 芯片高光装饰 */
  function sparkle(g, x, y, z) {
    return addMesh(g, new THREE.PlaneGeometry(1.55, 0.95), std({
      color: 0x2a3138, roughness: 0.15, metalness: 0.9,
      emissive: 0xffd9a0, emissiveIntensity: 0.25
    }), x, y, z);
  }

  /* =======================================================================
     4. 各部件建模（全部为代码生成的几何体）
     ======================================================================= */
  var BUILDER = {

    /* ---- 前面板外壳 ---- */
    frontShell: function () {
      var g = new THREE.Group();
      var mat = std({
        color: 0x2b313a, roughness: 0.68, metalness: 0.22,
        roughnessMap: TEX.noise
      });
      addMesh(g, plateWithHoles(BODY_W, BODY_H, 0.5, 0.28, [
        { type: 'circle', x: LENS_X, y: LENS_Y, r: 1.46 },
        { type: 'rect', x: SCR_X, y: SCR_Y, w: 3.02, h: 2.34, r: 0.16 }
      ]), mat, 0, 0, SHELL_FRONT_Z + 0.14);
      // 前脸装饰槽
      var groove = std({ color: 0x151920, roughness: 0.8, metalness: 0.1 });
      addMesh(g, box(BODY_W - 0.62, 0.055, 0.06), groove, 0, HY - 0.34, 1.60);
      addMesh(g, box(BODY_W - 0.62, 0.055, 0.06), groove, 0, -HY + 0.34, 1.60);
      // 前屏凹槽边框
      var bezel = std({ color: 0x0d1015, roughness: 0.5, metalness: 0.3 });
      addMesh(g, box(3.14, 2.46, 0.06), bezel, SCR_X, SCR_Y, SHELL_FRONT_Z + 0.22);
      return g;
    },

    /* ---- 前置触摸屏 ---- */
    frontScreen: function () {
      var g = new THREE.Group();
      var frame = std({ color: 0x0a0d12, roughness: 0.42, metalness: 0.35 });
      addMesh(g, roundedBox(3.0, 2.32, 0.14, 0.14, 4), frame, SCR_X, SCR_Y, SHELL_FRONT_Z + 0.20);
      addMesh(g, new THREE.PlaneGeometry(2.72, 2.05),
        std({
          map: TEX.screenFront, emissive: 0xffffff, emissiveMap: TEX.screenFront,
          emissiveIntensity: 0.95, roughness: 0.16, metalness: 0.0
        }), SCR_X, SCR_Y, SHELL_FRONT_Z + 0.275);
      addMesh(g, new THREE.PlaneGeometry(2.9, 2.22),
        std({ color: 0x0c1c28, roughness: 0.05, metalness: 0.9, transparent: true, opacity: 0.35 }),
        SCR_X, SCR_Y, SHELL_FRONT_Z + 0.285);
      return g;
    },

    /* ---- 镜头保护镜圈 ---- */
    lensRing: function () {
      var g = new THREE.Group();
      var ringMetal = std({ color: 0x9aa4b0, roughness: 0.3, metalness: 0.95 });
      var dark = std({ color: 0x14171c, roughness: 0.45, metalness: 0.7 });
      var knurl = std({ color: 0x3c434c, roughness: 0.5, metalness: 0.9, flatShading: true });
      // 主环（中空，保护玻璃可见）
      ringParts(g, 1.36, 1.50, 0.30, LENS_X, LENS_Y, 2.40, ringMetal, dark);
      // 前端滚花环
      ringParts(g, 1.42, 1.54, 0.16, LENS_X, LENS_Y, 2.63, knurl, knurl);
      // 保护玻璃
      addMesh(g, cylZ(1.36, 1.36, 0.05, 56), std({
        color: 0x0a2436, roughness: 0.03, metalness: 1.0,
        emissive: 0x0d3f5c, emissiveIntensity: 0.45
      }), LENS_X, LENS_Y, 2.45);
      return g;
    },

    /* ---- 光学镜头模组 ---- */
    lens: function () {
      var g = new THREE.Group();
      var barrel = std({ color: 0x33383f, roughness: 0.34, metalness: 0.9 });
      var dark = std({ color: 0x101317, roughness: 0.55, metalness: 0.6 });
      // 后座
      addMesh(g, cylZ(1.36, 1.42, 0.2, 52), dark, LENS_X, LENS_Y, 0.42);
      // 镜筒
      addMesh(g, cylZ(1.28, 1.32, 1.62, 52), barrel, LENS_X, LENS_Y, 1.22);
      // 对焦环
      addMesh(g, cylZ(1.34, 1.34, 0.46, 52, true), std({ color: 0x1a1e24, roughness: 0.62, metalness: 0.75, flatShading: true }), LENS_X, LENS_Y, 1.66);
      addMesh(g, cylZ(1.37, 1.37, 0.08, 52), dark, LENS_X, LENS_Y, 1.44);
      addMesh(g, cylZ(1.37, 1.37, 0.08, 52), dark, LENS_X, LENS_Y, 1.9);
      // 前压圈（中空，前组镜片可见）
      ringParts(g, 1.04, 1.44, 0.30, LENS_X, LENS_Y, 2.06, barrel, dark);
      addMesh(g, new THREE.TorusGeometry(0.98, 0.055, 10, 48), std({ color: 0x606a76, roughness: 0.3, metalness: 1 }), LENS_X, LENS_Y, 2.16);
      // 镜片组
      var lensGlass = std({
        color: 0x08182a, roughness: 0.03, metalness: 1.0,
        emissive: 0x0a2f4a, emissiveIntensity: 0.5
      });
      var dome = new THREE.SphereGeometry(1.02, 44, 22, 0, Math.PI * 2, 0, Math.PI / 2);
      dome.rotateX(Math.PI / 2);
      dome.scale(1, 1, 0.3);
      addMesh(g, dome, lensGlass, LENS_X, LENS_Y, 2.1);
      addMesh(g, cylZ(0.9, 0.9, 0.05, 44), lensGlass, LENS_X, LENS_Y, 1.88);
      addMesh(g, cylZ(0.74, 0.74, 0.05, 44), lensGlass.clone(), LENS_X, LENS_Y, 1.3);
      // 光圈
      addMesh(g, new THREE.TorusGeometry(0.86, 0.045, 8, 40), std({ color: 0x1c2128, roughness: 0.4, metalness: 0.8 }), LENS_X, LENS_Y, 1.94);
      return g;
    },

    /* ---- 影像传感器 ---- */
    sensor: function () {
      var g = new THREE.Group();
      addMesh(g, box(1.42, 1.16, 0.12), std({ color: 0x123a2c, roughness: 0.6, metalness: 0.3 }), LENS_X, LENS_Y, 0.3);
      addMesh(g, box(1.0, 0.76, 0.06), std({ color: 0x0b1a2c, roughness: 0.08, metalness: 0.85, emissive: 0x0a3050, emissiveIntensity: 0.5 }), LENS_X, LENS_Y, 0.39);
      addMesh(g, box(0.9, 0.66, 0.02), std({ color: 0x1b3550, roughness: 0.02, metalness: 1, emissive: 0x114066, emissiveIntensity: 0.7 }), LENS_X, LENS_Y, 0.425);
      // 支架与排线
      var steel = std({ color: 0x8e97a3, roughness: 0.35, metalness: 0.9 });
      addMesh(g, box(1.5, 0.1, 0.1), steel, LENS_X, LENS_Y + 0.66, 0.3);
      addMesh(g, box(1.5, 0.1, 0.1), steel, LENS_X, LENS_Y - 0.66, 0.3);
      addMesh(g, box(0.5, 0.34, 0.03), std({ color: 0xb08b3a, roughness: 0.5, metalness: 0.7 }), LENS_X + 1.0, LENS_Y, 0.3);
      return g;
    },

    /* ---- 主控板 ---- */
    pcb: function () {
      var g = new THREE.Group();
      var pz = 0.05;
      addMesh(g, box(5.9, 3.42, 0.12), std({
        map: TEX.pcb, roughness: 0.58, metalness: 0.28
      }), 0.35, 0.05, pz);
      var chip = std({ color: 0x14171d, roughness: 0.42, metalness: 0.5 });
      var shield = std({ color: 0x9aa3ad, roughness: 0.28, metalness: 0.95 });
      // SoC
      addMesh(g, box(1.15, 1.05, 0.14), chip, -0.55, 0.3, pz + 0.12);
      // 屏蔽罩
      addMesh(g, box(1.7, 1.05, 0.16), shield, 1.35, 0.35, pz + 0.13);
      sparkle(g, 1.35, 0.35, pz + 0.21);
      // 内存 / 电源管理
      addMesh(g, box(0.62, 0.5, 0.1), chip, -0.5, -0.85, pz + 0.1);
      addMesh(g, box(0.8, 0.6, 0.1), chip, 2.5, -0.9, pz + 0.1);
      addMesh(g, box(0.45, 0.35, 0.08), std({ color: 0x2a2f36, roughness: 0.5, metalness: 0.4 }), 0.6, 1.3, pz + 0.09);
      // 电容排
      var capGeo = cyl(0.07, 0.07, 0.16, 12);
      var capMat = std({ color: 0x2f363d, roughness: 0.55, metalness: 0.5 });
      for (var i = 0; i < 9; i++) {
        addMesh(g, capGeo, capMat, -2.3 + i * 0.28, -1.3, pz + 0.12);
      }
      // 接口
      addMesh(g, box(0.9, 0.42, 0.5), std({ color: 0xb9c2cc, roughness: 0.3, metalness: 1 }), 2.85, 0.3, pz + 0.05);
      // 柔性排线
      addMesh(g, box(1.2, 0.16, 0.03), std({ color: 0xb0722a, roughness: 0.6, metalness: 0.3 }), -2.6, 0.9, pz + 0.08);
      return g;
    },

    /* ---- 散热模组 ---- */
    heatSink: function () {
      var g = new THREE.Group();
      var graphite = std({ color: 0x22262c, roughness: 0.72, metalness: 0.35 });
      var copper = std({ color: 0xb5713c, roughness: 0.32, metalness: 0.95 });
      addMesh(g, box(3.6, 0.07, 1.9), graphite, 0.5, 1.62, -0.6);
      addMesh(g, box(2.2, 0.06, 1.6), copper, 0.2, 1.7, -0.55);
      // 散热鳍片
      for (var i = 0; i < 7; i++) {
        addMesh(g, box(0.06, 0.5, 1.85), std({ color: 0x8d959f, roughness: 0.35, metalness: 0.95 }), -1.45 + i * 0.24, 1.9, -0.6);
      }
      addMesh(g, box(3.8, 0.08, 0.16), std({ color: 0x7f8891, roughness: 0.4, metalness: 0.9 }), 0.3, 2.1, -1.45);
      return g;
    },

    /* ---- 电池 ---- */
    battery: function () {
      var g = new THREE.Group();
      var side = std({ color: 0x252b34, roughness: 0.62, metalness: 0.25 });
      addMesh(g, roundedBox(4.3, 3.3, 0.92, 0.12, 4), side, 0.2, -0.15, -0.9);
      // 正面标签
      addMesh(g, new THREE.PlaneGeometry(4.05, 3.05), std({
        map: TEX.battery, roughness: 0.55, metalness: 0.15
      }), 0.2, -0.15, -0.9 + 0.46 + 0.006);
      // BMS 小板
      addMesh(g, box(1.5, 0.9, 0.08), std({ color: 0x0e3a2b, roughness: 0.6, metalness: 0.3 }), 0.2, 1.42, -0.9);
      // 触点
      var gold = std({ color: 0xd8b64a, roughness: 0.32, metalness: 1 });
      [-0.5, 0, 0.5].forEach(function (dx) {
        addMesh(g, box(0.34, 0.3, 0.06), gold, 0.2 + dx, -1.98, -0.9);
      });
      return g;
    },

    /* ---- 机身中框 ---- */
    rearShell: function () {
      var g = new THREE.Group();
      var bodyMat = std({
        color: 0x2e343d, roughness: 0.62, metalness: 0.3,
        roughnessMap: TEX.noise
      });
      var depth = BODY_D - 0.36;
      addMesh(g, roundedBox(BODY_W, BODY_H, depth, 0.5, 7), bodyMat, 0, 0, -(BODY_D / 2) + (depth / 2));
      // 内部腔体暗示：深色内壁
      addMesh(g, box(BODY_W - 0.9, BODY_H - 0.9, 0.06), std({ color: 0x11151b, roughness: 0.85, metalness: 0.1 }), 0, 0, SHELL_FRONT_Z - 0.05);
      // 侧面装饰槽
      var groove = std({ color: 0x12161c, roughness: 0.7, metalness: 0.2 });
      addMesh(g, box(0.06, 0.07, depth - 0.7), groove, HX + 0.01, HY - 0.42, -0.2);
      addMesh(g, box(0.06, 0.07, depth - 0.7), groove, -HX - 0.01, HY - 0.42, -0.2);
      // 前面板内侧密封槽
      addMesh(g, roundedBox(BODY_W - 0.18, BODY_H - 0.18, 0.05, 0.42, 4), std({ color: 0x14181e, roughness: 0.8, metalness: 0.15 }), 0, 0, SHELL_FRONT_Z - 0.13);
      return g;
    },

    /* ---- 后置触摸屏 ---- */
    rearScreen: function () {
      var g = new THREE.Group();
      var frame = std({ color: 0x0a0d12, roughness: 0.45, metalness: 0.35 });
      addMesh(g, roundedBox(5.16, 3.0, 0.16, 0.14, 4), frame, 0.1, 0, -FRONT_Z - 0.03);
      addMesh(g, new THREE.PlaneGeometry(4.86, 2.74), std({
        map: TEX.screenRear, emissive: 0xffffff, emissiveMap: TEX.screenRear,
        emissiveIntensity: 1.0, roughness: 0.14, metalness: 0.0
      }), 0.1, 0, -FRONT_Z - 0.115, 0, Math.PI, 0);
      addMesh(g, new THREE.PlaneGeometry(5.0, 2.86), std({
        color: 0x0b1a26, roughness: 0.04, metalness: 0.95, transparent: true, opacity: 0.32
      }), 0.1, 0, -FRONT_Z - 0.13, 0, Math.PI, 0);
      return g;
    },

    /* ---- 快门键 ---- */
    shutterButton: function () {
      var g = new THREE.Group();
      var mat = std({ color: 0x3a414a, roughness: 0.4, metalness: 0.8 });
      addMesh(g, cyl(0.66, 0.66, 0.1, 40), std({ color: 0x181c22, roughness: 0.6, metalness: 0.5 }), -2.05, HY - 0.02, -0.05);
      addMesh(g, cyl(0.62, 0.64, 0.26, 40), mat, -2.05, HY + 0.14, -0.05);
      addMesh(g, cyl(0.58, 0.6, 0.05, 40), std({ color: 0x22262d, roughness: 0.45, metalness: 0.7 }), -2.05, HY + 0.28, -0.05);
      // 红色装饰环
      addMesh(g, new THREE.TorusGeometry(0.62, 0.045, 10, 44), std({
        color: 0xff4d3d, roughness: 0.35, metalness: 0.4, emissive: 0xff2d1a, emissiveIntensity: 0.5
      }), -2.05, HY + 0.2, -0.05, Math.PI / 2);
      return g;
    },

    /* ---- QS 键 ---- */
    qsButton: function () {
      var g = new THREE.Group();
      addMesh(g, roundedBox(1.0, 0.22, 0.72, 0.09, 4), std({ color: 0x3a414a, roughness: 0.42, metalness: 0.75 }), 2.35, HY + 0.1, -0.05);
      for (var i = 0; i < 3; i++) {
        addMesh(g, box(0.5, 0.03, 0.05), std({ color: 0x1a1e24, roughness: 0.7, metalness: 0.3 }), 2.35, HY + 0.21, -0.24 + i * 0.19);
      }
      return g;
    },

    /* ---- 侧边电源键 ---- */
    sideKey: function () {
      var g = new THREE.Group();
      addMesh(g, roundedBox(0.22, 1.15, 0.62, 0.09, 4), std({ color: 0x3a414a, roughness: 0.45, metalness: 0.75 }), -HX - 0.1, 0.35, 0.25);
      addMesh(g, box(0.03, 0.42, 0.42), std({ color: 0xd8dee6, roughness: 0.5, metalness: 0.4, emissive: 0x223040, emissiveIntensity: 0.6 }), -HX - 0.12, 0.35, 0.25);
      return g;
    },

    /* ---- 接口仓盖 ---- */
    usbCover: function () {
      var g = new THREE.Group();
      addMesh(g, roundedBox(0.24, 2.25, 1.5, 0.12, 4), std({ color: 0x3b424c, roughness: 0.58, metalness: 0.35 }), HX + 0.1, -0.05, -0.1);
      // 抠手
      addMesh(g, box(0.06, 0.5, 0.9), std({ color: 0x1a1e24, roughness: 0.7, metalness: 0.3 }), HX + 0.22, -0.05, -0.1);
      // USB-C 端口（露出）
      addMesh(g, roundedBox(0.3, 0.42, 0.94, 0.16, 3), std({ color: 0x9aa3ad, roughness: 0.3, metalness: 1 }), HX - 0.1, 0.62, -0.28);
      return g;
    },

    /* ---- microSD 卡 ---- */
    sdCard: function () {
      var g = new THREE.Group();
      addMesh(g, roundedBox(0.09, 0.78, 1.15, 0.04, 3), std({ color: 0x1c2026, roughness: 0.5, metalness: 0.25 }), HX - 0.08, -1.15, -0.32);
      addMesh(g, box(0.02, 0.4, 0.7), std({ color: 0xc9a227, roughness: 0.5, metalness: 0.4 }), HX - 0.02, -1.15, -0.32);
      addMesh(g, box(0.02, 0.3, 0.5), std({ color: 0x2a3038, roughness: 0.6, metalness: 0.3 }), HX - 0.01, -1.3, -0.5);
      return g;
    },

    /* ---- 扬声器 ---- */
    speaker: function () {
      var g = new THREE.Group();
      var gx = -2.45, gy = -HY - 0.02, gz = 0.7;
      addMesh(g, cyl(0.44, 0.44, 0.12, 32), std({ color: 0x2a3038, roughness: 0.6, metalness: 0.35 }), gx, gy, gz);
      addMesh(g, new THREE.CircleGeometry(0.42, 32), std({
        map: TEX.grille, roughness: 0.7, metalness: 0.4
      }), gx, gy - 0.065, gz, -Math.PI / 2);
      return g;
    },

    /* ---- 麦克风阵列 ---- */
    mic: function () {
      var g = new THREE.Group();
      var portMat = std({ color: 0x05070a, roughness: 0.9, metalness: 0.0 });
      addMesh(g, cylZ(0.1, 0.1, 0.12, 12), portMat, 0.5, -1.86, 1.60);
      addMesh(g, cylZ(0.1, 0.1, 0.12, 12), portMat, 0.86, -1.86, 1.60);
      // 内部麦克风模块
      addMesh(g, box(0.72, 0.34, 0.14), std({ color: 0x1a2a22, roughness: 0.6, metalness: 0.35 }), 0.68, -1.62, FRONT_Z - 0.3);
      [-0.22, 0.22].forEach(function (dx) {
        addMesh(g, cyl(0.09, 0.09, 0.08, 12), std({ color: 0xb9c2cc, roughness: 0.35, metalness: 1 }), 0.68 + dx, -1.62, FRONT_Z - 0.21, Math.PI / 2);
      });
      return g;
    },

    /* ---- 磁吸快拆底座 ---- */
    mount: function () {
      var g = new THREE.Group();
      var baseY = -HY - 0.02;
      var mountMetal = std({ color: 0x7c848e, roughness: 0.34, metalness: 0.95 });
      addMesh(g, roundedBox(4.6, 0.42, 3.0, 0.14, 4), std({ color: 0x272d35, roughness: 0.5, metalness: 0.5 }), 0, baseY - 0.2, -0.05);
      // 金属卡扣边
      addMesh(g, roundedBox(4.7, 0.12, 0.34, 0.05, 3), mountMetal, 0, baseY - 0.4, -1.35);
      addMesh(g, roundedBox(4.7, 0.12, 0.34, 0.05, 3), mountMetal, 0, baseY - 0.4, 1.25);
      // 磁铁
      var magnet = std({ color: 0xb6bec8, roughness: 0.28, metalness: 1.0 });
      [-1.35, 1.35].forEach(function (dx) {
        addMesh(g, cyl(0.52, 0.52, 0.16, 32), magnet, dx, baseY - 0.44, -0.05);
        addMesh(g, cyl(0.36, 0.36, 0.05, 32), std({ color: 0x0e1116, roughness: 0.8, metalness: 0.2 }), dx, baseY - 0.53, -0.05);
      });
      // 1/4 螺纹孔
      addMesh(g, cyl(0.34, 0.34, 0.1, 24), std({ color: 0x14181d, roughness: 0.85, metalness: 0.2 }), 0, baseY - 0.45, -0.05);
      return g;
    }
  };

  /* =======================================================================
     5. 部件清单（结构 + 参数，18 项）
     ======================================================================= */
  var PARTS;

  function buildPartDefs() {
    PARTS = [
      {
        id: 'lensRing', name: '镜头保护镜圈', en: 'Protective Lens Ring',
        tag: '旋入式 · Ø30 mm', color: '#7dd3fc', dir: [0, 0, 1], dist: 4.7,
        role: '可旋拧拆卸的外层镜圈，用于保护前组镜片，并支持加装 ND / CPL 滤镜，是整机最外侧的光学部件。',
        specs: [
          ['结构', '旋入式螺纹卡口，可徒手拆装'],
          ['外径', '约 Ø30 mm'],
          ['材质', '铝合金圈体 + 光学保护玻璃'],
          ['功能', '保护前组镜片、滤镜转接']
        ]
      },
      {
        id: 'lens', name: '光学镜头模组', en: 'Optical Lens Module',
        tag: 'f/2.8 · 155° 超广角', color: '#38bdf8', dir: [0, 0, 1], dist: 4.4,
        role: '155° 超广角非球面镜组，负责将视场内的光线汇聚到传感器焦平面，是画质的第一道关口。',
        specs: [
          ['光圈', 'f/2.8'],
          ['视角', '155°（等效 35mm 约 12 mm）'],
          ['镜片', '多层非球面镜组'],
          ['镀膜', '多层增透镀膜，抑制鬼影眩光'],
          ['对焦', '固定焦点（超焦距设计）']
        ]
      },
      {
        id: 'frontScreen', name: '1.4" 前置触摸屏', en: 'Front Touchscreen',
        tag: '1.4" · 320×320', color: '#5eead4', dir: [0.25, 0.45, 1], dist: 4.1,
        role: '面向拍摄者的前置取景屏，vlog 自拍时无需翻转机身即可完成构图与参数调整。',
        specs: [
          ['尺寸', '1.4 英寸'],
          ['分辨率', '320 × 320'],
          ['类型', 'LCD 触控屏'],
          ['用途', '自拍取景、快捷参数调整']
        ]
      },
      {
        id: 'frontShell', name: '前面板外壳', en: 'Front Bezel',
        tag: 'PC + 玻纤 · IP68 密封', color: '#94a3b8', dir: [0, 0, 1], dist: 1.0,
        role: '整机前脸结构件，为镜头与前置屏提供精确开口，并配合密封胶圈形成前侧防水屏障。',
        specs: [
          ['材质', '聚碳酸酯 + 玻璃纤维增强'],
          ['厚度', '约 3.6 mm'],
          ['开孔', '镜头 Ø29 mm、前屏 29 × 23 mm'],
          ['密封', '前面板防水胶圈，裸机 18 m']
        ]
      },
      {
        id: 'sensor', name: '1/1.3" 影像传感器', en: 'Image Sensor',
        tag: '1/1.3" CMOS · 1040 万', color: '#34d399', dir: [0, 0.15, 1], dist: 3.9,
        role: '将镜头汇聚的光信号转换为电信号，是动态范围、低光表现与 4K/120fps 高帧率能力的物理基础。',
        specs: [
          ['规格', '1/1.3 英寸 CMOS'],
          ['有效像素', '约 1040 万'],
          ['等效像素尺寸', '2.4 μm'],
          ['视频能力', '4K/120fps、4K/60fps HDR'],
          ['色彩', '10-bit D-Log M']
        ]
      },
      {
        id: 'pcb', name: '主控板（PCB）', en: 'Main PCB',
        tag: '影像 SoC · 防抖 / 编码', color: '#4ade80', dir: [0.4, 0.45, 1], dist: 1.4,
        role: '整机的运算与控制中枢，承担图像信号处理、防抖算法运算、视频编码以及无线与接口控制。',
        specs: [
          ['核心', '影像 SoC + 协处理器'],
          ['功能', 'ISP 图像处理、增稳运算、编码'],
          ['编码', 'H.265 / H.264，最高 4K/120fps'],
          ['无线', 'Wi-Fi 2.4/5 GHz、Bluetooth 5.0'],
          ['接口', 'USB-C、microSD']
        ]
      },
      {
        id: 'battery', name: '1770mAh 锂电池', en: 'Li-Po Battery',
        tag: '1770 mAh · 6.8 Wh', color: '#facc15', dir: [-0.5, -0.35, -1], dist: 2.0,
        role: '整机能量来源，支持 PD 快充与低温放电，是长时间录制续航的关键。',
        specs: [
          ['容量', '1770 mAh'],
          ['能量', '约 6.8 Wh'],
          ['续航', '最长 160 分钟（1080p/30fps）'],
          ['快充', '约 18 分钟充至 80%'],
          ['低温', '可在 -20 ℃ 环境放电']
        ]
      },
      {
        id: 'heatSink', name: '散热模组', en: 'Thermal Module',
        tag: '石墨烯 + 铜箔', color: '#fb923c', dir: [0.15, 1, -0.5], dist: 2.4,
        role: '把 SoC 与电池的热量传导至机身金属骨架，避免高码率长时间录制时因过热而降频。',
        specs: [
          ['结构', '石墨烯导热片 + 铜箔均热'],
          ['作用', '延长持续录制时长'],
          ['场景', '4K/120fps 长时间录制'],
          ['配合', '机身金属中框散热']
        ]
      },
      {
        id: 'rearShell', name: '机身中框', en: 'Body Frame',
        tag: '70.5×44.2×32.8 mm', color: '#8b97a6', dir: [-0.25, 0, -1], dist: 5.0,
        role: '一体化结构主体：内部固定主板、电池、散热件与屏幕模组，外部集成按键、接口与磁吸底座。',
        specs: [
          ['尺寸', '70.5 × 44.2 × 32.8 mm'],
          ['重量', '整机约 145 g'],
          ['材质', '工程塑料 + 金属骨架'],
          ['防水', '裸机 18 m（含防水壳 60 m）'],
          ['工作温度', '-20 ℃ ~ 45 ℃']
        ]
      },
      {
        id: 'rearScreen', name: '2.25" 后置触摸屏', en: 'Rear Touchscreen',
        tag: '2.25" · 640×360', color: '#22d3ee', dir: [0.15, 0.2, -1], dist: 5.7,
        role: '主取景与交互界面，支持触控完成全部拍摄参数设置、回放与模式切换。',
        specs: [
          ['尺寸', '2.25 英寸'],
          ['分辨率', '640 × 360'],
          ['类型', '触控 LCD'],
          ['交互', '点按 / 滑动 / 参数面板']
        ]
      },
      {
        id: 'shutterButton', name: '快门 / 录制键', en: 'Shutter Button',
        tag: '录制 · 拍照 · 唤醒', color: '#fb7185', dir: [0, 1, 0], dist: 2.0,
        role: '最高频的物理按键，一键开始或停止录制、拍照，并可在息屏状态下直接唤醒开机。',
        specs: [
          ['功能', '开始/停止录制、拍照、唤醒'],
          ['行程', '约 0.4 mm 段落感'],
          ['标识', '红色装饰环'],
          ['位置', '机身顶部左侧']
        ]
      },
      {
        id: 'qsButton', name: 'QS 快速切换键', en: 'Quick Switch Button',
        tag: '拍摄模式快切', color: '#f472b6', dir: [0, 1, 0.15], dist: 2.0,
        role: '在预设拍摄模式之间快速切换（如 4K/120、1080p/240 慢动作），无需进入菜单。',
        specs: [
          ['功能', '模式切换、自定义预设'],
          ['位置', '机身顶部右侧'],
          ['自定义', '可绑定常用参数组合']
        ]
      },
      {
        id: 'sideKey', name: '侧边电源键', en: 'Side Power Key',
        tag: '开关机 / 息屏', color: '#c084fc', dir: [-1, 0.2, 0], dist: 3.0,
        role: '负责开机、关机与屏幕息屏，长按可执行强制关机或复位操作。',
        specs: [
          ['功能', '开关机、息屏'],
          ['长按', '强制关机 / 复位'],
          ['位置', '机身左侧']
        ]
      },
      {
        id: 'usbCover', name: 'USB-C / 存储卡仓盖', en: 'Port Cover',
        tag: 'USB-C · microSD', color: '#a3a3a3', dir: [1, 0.2, 0], dist: 3.0,
        role: '密封 USB-C 接口与 microSD 卡槽，是保证裸机 18 m 防水的关键活动部件。',
        specs: [
          ['防护', 'IP68 级密封胶塞'],
          ['接口', 'USB-C（充电 / 数据传输）'],
          ['卡槽', 'microSD，最大 512 GB'],
          ['结构', '卡扣式翻盖']
        ]
      },
      {
        id: 'sdCard', name: 'microSD 存储卡', en: 'microSD Card',
        tag: 'microSDXC · ≤512 GB', color: '#fbbf24', dir: [1, -0.25, 0.15], dist: 4.2,
        role: '存放视频与照片素材；4K/120fps 高码率录制建议使用 V30 / U3 及以上规格。',
        specs: [
          ['类型', 'microSDXC'],
          ['最大容量', '512 GB'],
          ['建议规格', 'V30 / U3 及以上'],
          ['4K/120 码率', '约 100 Mbps']
        ]
      },
      {
        id: 'speaker', name: '扬声器', en: 'Speaker',
        tag: '回放 / 提示音', color: '#2dd4bf', dir: [-0.3, -1, 0.45], dist: 2.6,
        role: '负责素材回放的声音输出与录制提示音，网罩经过防水处理。',
        specs: [
          ['位置', '机身底部'],
          ['功能', '回放、提示音、语音提示'],
          ['防护', '防水透音网罩']
        ]
      },
      {
        id: 'mic', name: '麦克风阵列', en: 'Microphone Array',
        tag: '立体声收音', color: '#67e8f9', dir: [0.25, -1, 0.6], dist: 2.6,
        role: '负责立体声收音，配合算法抑制风噪，让 vlog 人声在户外依然清晰。',
        specs: [
          ['数量', '内置麦克风阵列'],
          ['功能', '立体声收音、风噪抑制'],
          ['位置', '机身正面 / 底部开孔'],
          ['扩展', '支持外接麦克风']
        ]
      },
      {
        id: 'mount', name: '磁吸快拆底座', en: 'Magnetic Quick-Release Mount',
        tag: '磁吸 + 卡扣双锁', color: '#a78bfa', dir: [0, -1, -0.3], dist: 3.4,
        role: '与磁吸快拆配件、延长杆、头盔支架快速连接，并可外接 1/4" 螺纹转接件。',
        specs: [
          ['结构', '磁吸 + 卡扣双重锁定'],
          ['兼容', 'DJI 磁吸快拆系列配件'],
          ['扩展', '1/4" 螺纹转接件'],
          ['材质', '金属底板 + 钕磁铁']
        ]
      }
    ];
  }

  /* 部件清单是纯数据（不触碰 THREE），模块顶层即可构建 */
  buildPartDefs();

  /* =======================================================================
     6. 交给引擎的工厂：注入 H → 建贴图 → 返回 builder
     ======================================================================= */
  function makeBuilder(H) {
    H_ = H;
    THREE = H.THREE;
    if (!TEX) buildTextures();
    return BUILDER;
  }

  /* =======================================================================
     7. 自注册到页面（引擎按此装配，保持引擎与机型无关）
     ======================================================================= */
  window.DJIModelAction4 = {
    title: 'DJI Osmo Action 4 运动相机',
    titleEn: 'DJI Osmo Action 4 Action Camera',
    subtitle: 'Sports Action Camera · 18-Part Teardown',
    intro: '点击模型中的任意部件，或点击左侧「部件清单」，即可自动拆解整机并查看该部件的结构与参数；' +
      '也可以开启演示巡航与技术图纸模式，从光学模组一路看到影像链路、供电与磁吸快拆结构。',

    /* 相机不是飞行器：引擎据此不加航行灯；漂移幅度也压到最小，避免"相机在飞" */
    aerial: false,
    hoverAmp: 0.006,
    flyLift: 0.008,

    groups: ['外壳结构', '光学模组', '影像链路', '运算与散热', '供电', '交互与接口', '安装扩展'],

    /* 场景参数：逐项照抄旧版 app.js 的相机 / 地面 / 灯光取值
       （ROOT_SCALE = 1，旧版没有任何缩放；单位就是 cm） */
    scene: {
      rootScale: 1, floorY: -3.05, theta: 0.62, phi: 1.24, radius: 11.5,
      zoomBias: 5.4, phiBias: 0, minRadius: 4.5, maxRadius: 30,
      fog: 0.016, gridSize: 70, gridDiv: 35, ringR: 6, shadowR: 11,
      keyLight: [7, 12, 9], targetY: 0
    },

    spec: [
      ['尺寸', '70.5 × 44.2 × 32.8 mm'],
      ['重量', '约 145 g'],
      ['传感器', '1/1.3 英寸 CMOS，约 1040 万像素'],
      ['镜头', 'f/2.8 光圈，155° 超广角'],
      ['视频', '4K/120fps、4K/60fps HDR、2.7K/120fps、1080p/240fps'],
      ['色彩', '10-bit D-Log M'],
      ['防抖', 'RockSteady 3.0 / HorizonBalancing / HorizonSteady'],
      ['屏幕', '后置 2.25" 640×360 触摸屏 + 前置 1.4" 320×320'],
      ['电池', '1770 mAh，最长 160 分钟（1080p/30fps）'],
      ['防水', '裸机 18 m'],
      ['存储', 'microSD，最大 512 GB'],
      ['连接', 'Wi-Fi 2.4/5 GHz、Bluetooth 5.0、USB-C']
    ],

    /* 自检扫描的项目（引擎会逐项点亮） */
    selfTest: [
      ['结构完整性', 'STRUCTURE'],
      ['光学模组', 'OPTICS'],
      ['影像链路', 'IMAGING'],
      ['供电与散热', 'POWER'],
      ['交互与接口', 'I/O']
    ],

    /* 演示巡航镜头（半径是 scene.radius 的倍数） */
    tour: [
      { theta: 0.62, phi: 1.24, radius: 1.00, dur: 6.5, explode: false, label: '整机 / OVERVIEW' },
      { theta: 0.30, phi: 1.42, radius: 0.66, dur: 6.0, explode: false, label: '前脸与镜组 / FRONT' },
      { theta: 1.35, phi: 1.10, radius: 0.78, dur: 6.0, explode: false, label: '侧向 / PROFILE' },
      { theta: 2.35, phi: 0.88, radius: 1.30, dur: 8.5, explode: true, label: '拆解总览 / EXPLODED' },
      { theta: 3.60, phi: 1.22, radius: 1.02, dur: 6.0, explode: false, label: '背面与双屏 / REAR' },
      { theta: 5.20, phi: 0.60, radius: 1.28, dur: 8.5, explode: true, label: '俯视拆解 / TOP EXPLODED' }
    ],

    parts: PARTS,
    builderFactory: makeBuilder,

    constants: {
      BODY_W: BODY_W, BODY_H: BODY_H, BODY_D: BODY_D,
      LENS_X: LENS_X, LENS_Y: LENS_Y, SCR_X: SCR_X, SCR_Y: SCR_Y,
      SHELL_FRONT_Z: SHELL_FRONT_Z
    }
  };

  window.DJIPage = window.DJIPage || {};
  window.DJIPage.model = window.DJIModelAction4;
})();