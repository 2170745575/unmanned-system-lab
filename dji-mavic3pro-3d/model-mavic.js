/* =========================================================================
   DJI Mavic 3 Pro · 三摄航拍无人机 · 机型模块（model-mavic.js）
   -------------------------------------------------------------------------
   共享引擎（engine.js）机型模块：只提供数据与几何，不含任何引擎逻辑。
   · 所有几何与贴图均由代码生成，不使用任何外部模型 / 图片 / 音频
   · 建模单位：cm（1 模型单位 = 1 cm），整机根节点统一缩放 0.5（见 scene.rootScale）
   · 本文件先于 Three.js 加载执行，顶层绝对不能触碰 THREE：
     THREE / TEX / 建模 helper 全部由 builderFactory(H) 在引擎内部注入。
   · addMesh / std / matte / metal / carbon / painted / glass / emissiveMat
     一律转发到引擎：前者负责顶点色 AO 烘焙与拾取注册，后者承载材质规范化
     （非金属 metalness 归零、微表面法线、粗糙度噪声），不能自带一套。
   ========================================================================= */
(function () {
  'use strict';

  /* ---- 引擎注入的工具包（运行期解析，顶层为 null，绝不触碰 THREE）---- */
  var H_ = null, THREE = null, TEX = null;

  function addMesh() { return H_.addMesh.apply(null, arguments); }
  function std() { return H_.std.apply(null, arguments); }
  function box() { return H_.box.apply(null, arguments); }
  function cyl() { return H_.cyl.apply(null, arguments); }
  function cylZ() { return H_.cylZ.apply(null, arguments); }
  function roundedBox() { return H_.roundedBox.apply(null, arguments); }
  function ringParts() { return H_.ringParts.apply(null, arguments); }
  function loftGeo() { return H_.loftGeo.apply(null, arguments); }
  function bladeGeo() { return H_.bladeGeo.apply(null, arguments); }
  function placeAlong() { return H_.placeAlong.apply(null, arguments); }
  function makeTex() { return H_.makeTex.apply(null, arguments); }
  function sectionArc() { return H_.sectionArc.apply(null, arguments); }
  function rand() { return H_.rand.apply(null, arguments); }
  function lerp() { return H_.lerp.apply(null, arguments); }
  function clamp() { return H_.clamp.apply(null, arguments); }
  function matte() { return H_.matte.apply(null, arguments); }
  function metal() { return H_.metal.apply(null, arguments); }
  function carbon() { return H_.carbon.apply(null, arguments); }
  function painted() { return H_.painted.apply(null, arguments); }
  function glass() { return H_.glass.apply(null, arguments); }
  function emissiveMat() { return H_.emissiveMat.apply(null, arguments); }

  /* =======================================================================
     2. 程序化贴图（canvas 生成，无外部图片）
     注意：引擎自带的 TEX 里没有 battery / lensBrand 两个键，
          所以本机型在 builderFactory 里自建一份 TEX（不依赖引擎 TEX 的内容）。
     ======================================================================= */
  function buildTextures() {
    TEX = TEX || {};

    /* --- 机身表面细噪点（复合材质质感） --- */
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

    /* --- 智能飞行电池标签 --- */
    TEX.battery = makeTex(512, 384, function (g, w, h) {
      g.fillStyle = '#20262f'; g.fillRect(0, 0, w, h);
      var grd = g.createLinearGradient(0, 0, w, h);
      grd.addColorStop(0, 'rgba(255,255,255,.06)'); grd.addColorStop(1, 'rgba(0,0,0,.28)');
      g.fillStyle = grd; g.fillRect(0, 0, w, h);
      g.fillStyle = '#ffcc00'; g.fillRect(0, 0, w, 10);
      g.fillStyle = 'rgba(255,255,255,.95)';
      g.font = '800 60px Inter, Segoe UI, sans-serif';
      g.fillText('DJI', 40, 96);
      g.font = '600 25px ui-monospace, Menlo, Consolas, monospace';
      g.fillStyle = '#9fd8e6';
      g.fillText('INTELLIGENT FLIGHT BATTERY', 42, 146);
      g.fillStyle = 'rgba(255,255,255,.9)';
      g.font = '700 34px ui-monospace, Menlo, Consolas, monospace';
      g.fillText('5000 mAh   77 Wh', 42, 200);
      g.fillStyle = 'rgba(255,255,255,.6)';
      g.font = '500 22px ui-monospace, Menlo, Consolas, monospace';
      g.fillText('Mavic 3 Pro  ·  BWX260-5000-15.4', 42, 244);
      g.fillText('65W 快充  /  最长飞行 43 分钟', 42, 278);
      g.fillStyle = 'rgba(255,255,255,.22)';
      g.fillRect(42, 306, w - 84, 2);
      g.fillStyle = 'rgba(255,255,255,.5)';
      g.font = '500 19px ui-monospace, Menlo, Consolas, monospace';
      g.fillText('CAUTION: DO NOT PUNCTURE / DISASSEMBLE', 42, 344);
      // 电量指示触点
      g.fillStyle = '#d8b64a';
      [0, 1, 2, 3].forEach(function (i) { g.fillRect(w - 190 + i * 34, 30, 24, 26); });
    });

    /* --- 哈苏镜头铭牌（环绕镜筒） --- */
    TEX.lensBrand = makeTex(2048, 96, function (g, w, h) {
      g.fillStyle = '#1b2026'; g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(190,205,220,.92)';
      g.font = '600 42px Inter, Segoe UI, sans-serif';
      g.textBaseline = 'middle';
      g.fillText('HASSELBLAD', 190, 46);
      g.fillText('HASSELBLAD', 1210, 46);
      g.fillStyle = 'rgba(255,255,255,.28)';
      g.fillRect(0, 4, w, 2);
      g.fillRect(0, h - 6, w, 2);
    });

    /* --- 风扇网罩 --- */
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
     3. 机体截面表（Mavic 3 Pro 俯视轮廓 + 鲨鱼头式前脸）
     ======================================================================= */
  var BODY_SEAM = -0.8;
  var BODY_SECTIONS = [
    { z: -7.15, w: 3.2, h: 2.6, y: 0.10, n: 2.4 },
    { z: -6.55, w: 6.2, h: 3.7, y: 0.15, n: 2.8 },
    { z: -5.30, w: 8.5, h: 4.5, y: 0.05, n: 3.2 },
    { z: -3.60, w: 9.4, h: 4.8, y: -0.05, n: 3.5 },
    { z: -1.60, w: 9.5, h: 4.9, y: -0.10, n: 3.5 },
    { z: 0.60, w: 9.2, h: 4.7, y: -0.15, n: 3.3 },
    { z: 2.60, w: 8.1, h: 4.4, y: -0.25, n: 3.1 },
    { z: 4.40, w: 6.9, h: 3.9, y: -0.40, n: 2.8 },
    { z: 5.80, w: 5.5, h: 3.2, y: -0.55, n: 2.6 },
    { z: 6.70, w: 3.6, h: 2.4, y: -0.65, n: 2.4 },
    { z: 7.10, w: 1.8, h: 1.4, y: -0.72, n: 2.2 }
  ];

  /* ---- 关键坐标（cm）---- */
  var MOTOR = { x: 10.8, y: 1.35, z: 9.2 };
  var CAM_Y = -4.72, CAM_Z = 5.95;
  var FOOT_Y = -6.0;
  var PROP_HUB_Y = MOTOR.y + 1.3;     // 桨毂高度（自旋中心）
  var PROP_R = 5.6;                   // 桨盘半径 = 桨叶长度

  /** 四支机臂的根部位置（前臂更靠前内、后臂更靠后外） */
  function armRoot(sx, sz, isRear) {
    return new THREE.Vector3(
      (isRear ? 3.95 : 3.10) * sx,
      isRear ? 0.62 : 0.55,
      (isRear ? 4.55 : 3.95) * sz
    );
  }

  /** 机体截面插值 + 曲面高度查询（用来把散热口/分模线精确贴到曲面上） */
  function sectionAt(z) {
    var S = BODY_SECTIONS;
    if (z <= S[0].z) return S[0];
    if (z >= S[S.length - 1].z) return S[S.length - 1];
    for (var i = 0; i < S.length - 1; i++) {
      if (z >= S[i].z && z <= S[i + 1].z) {
        var t = (z - S[i].z) / (S[i + 1].z - S[i].z);
        return {
          z: z,
          w: lerp(S[i].w, S[i + 1].w, t),
          h: lerp(S[i].h, S[i + 1].h, t),
          y: lerp(S[i].y, S[i + 1].y, t),
          n: lerp(S[i].n, S[i + 1].n, t)
        };
      }
    }
    return S[0];
  }
  function bodyTopAt(z) { var s = sectionAt(z); return s.y + s.h / 2; }
  function bodyBottomAt(z) { var s = sectionAt(z); return s.y - s.h / 2; }
  function bodyHalfWidthAt(z, y) {
    var s = sectionAt(z), hw = s.w / 2, hh = s.h / 2;
    var v = clamp((y - s.y) / hh, -1, 1);
    return hw * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(v), s.n)), 1 / s.n);
  }

  /* 桨叶自旋中心（纯数学，模块顶层即可用） —— 引擎把网格收进这个内层枢轴组 */
  function propSpinAt(sx, sz) {
    return [+(MOTOR.x * sx).toFixed(3), +PROP_HUB_Y.toFixed(3), +(MOTOR.z * sz).toFixed(3)];
  }

  /* ---- 材质（std 一律转发到引擎，承接材质规范化）---- */
  function BODY_MAT() {
    return std({ color: 0x2f353e, roughness: 0.62, metalness: 0.28, roughnessMap: TEX.noise });
  }
  function DARK_MAT() { return std({ color: 0x15181d, roughness: 0.62, metalness: 0.4 }); }
  function METAL_MAT() { return std({ color: 0x8e97a3, roughness: 0.3, metalness: 0.95 }); }

  /* =======================================================================
     4. 各部件建模（全部为代码生成的几何体）
     ======================================================================= */
  var BUILDER = {

    /* ---- 机身上盖 ---- */
    bodyUpper: function () {
      var g = new THREE.Group();
      var mat = BODY_MAT();
      var inner = std({ color: 0x12151a, roughness: 0.85, metalness: 0.15 });

      // 放样出的顶部壳体（沿接缝与中框严格吻合）
      addMesh(g, loftGeo(BODY_SECTIONS, { part: 'upper', seam: BODY_SEAM, seg: 22 }), [mat, inner]);

      // 顶部中脊分模线（贴着曲面走）
      var ridge = std({ color: 0x1a1e24, roughness: 0.7, metalness: 0.2 });
      for (var i = 0; i < 6; i++) {
        var rz = -4.4 + i * 1.15;
        var rl = 1.05;
        [-0.92, 0.92].forEach(function (rx) {
          addMesh(g, box(0.09, 0.09, rl), ridge, rx, bodyTopAt(rz) - 0.02, rz);
        });
      }

      // 尾部散热格栅（贴着曲面）
      var slot = DARK_MAT();
      for (i = 0; i < 6; i++) {
        var vz = -5.5 + i * 0.34;
        var vw = 2.6 - i * 0.12;
        addMesh(g, box(vw, 0.12, 0.18), slot, 0, bodyTopAt(vz) - 0.02, vz);
      }

      // 两侧肩线（按曲面半宽贴合）
      [-1, 1].forEach(function (s) {
        [-1.2, 0.2, 1.6].forEach(function (sz2) {
          var hw = bodyHalfWidthAt(sz2, 1.05);
          addMesh(g, roundedBox(0.12, 0.13, 2.0, 0.05, 3), slot,
            (hw - 0.03) * s, 1.05, sz2, 0, 0, -0.22 * s);
        });
      });

      // 前上部视觉窗口遮光罩
      addMesh(g, roundedBox(3.5, 0.42, 0.8, 0.2, 3), std({ color: 0x1b1f25, roughness: 0.7, metalness: 0.2 }), 0, 0.42, 6.35);

      // 上盖前缘的一圈工艺缝
      addMesh(g, new THREE.TorusGeometry(0.9, 0.045, 8, 40), slot, 0, 0.05, 6.1, Math.PI / 2);
      return g;
    },

    /* ---- 定位与天线模块 ---- */
    gpsAntenna: function () {
      var g = new THREE.Group();
      // 陶瓷贴片天线（在上盖内侧，拆解后才看得到）
      addMesh(g, box(1.9, 0.28, 1.9), std({ color: 0xd8dde4, roughness: 0.35, metalness: 0.2 }), 0, 1.78, 1.5);
      addMesh(g, box(1.5, 0.08, 1.5), std({ color: 0x9aa3ad, roughness: 0.4, metalness: 0.7 }), 0, 1.94, 1.5);
      // 天线板（左右各一，斜置于机身两侧内壁）
      var antMat = std({ color: 0x1d2b36, roughness: 0.5, metalness: 0.3 });
      [-1, 1].forEach(function (s) {
        addMesh(g, box(0.24, 2.2, 3.0), antMat, 2.6 * s, 0.55, -2.2, 0, 0, -0.18 * s);
        addMesh(g, box(0.1, 1.9, 0.2), std({ color: 0xc9a227, roughness: 0.5, metalness: 0.6 }), 2.4 * s, 0.55, -2.2);
      });
      return g;
    },

    /* ---- 前视双目视觉 ---- */
    visionFront: function () {
      var g = new THREE.Group();
      var glassMat = glass(0x061420, 0x0d3550);   // 引擎玻璃预设：metalness=1，不落"中间金属度"
      // 前脸较窄，双目按机头曲面朝向做外八字
      [-1, 1].forEach(function (s) {
        var yaw = 0.5 * s;
        addMesh(g, cylZ(0.4, 0.4, 0.4, 26), std({ color: 0x14181d, roughness: 0.6, metalness: 0.35 }), 1.52 * s, 0.12, 6.58, 0, yaw, 0);
        addMesh(g, cylZ(0.3, 0.3, 0.12, 26), glassMat, 1.6 * s, 0.13, 6.7, 0, yaw, 0);
        addMesh(g, new THREE.TorusGeometry(0.35, 0.045, 8, 26), std({ color: 0x8b95a1, roughness: 0.28, metalness: 1 }), 1.62 * s, 0.13, 6.73, 0, yaw, 0);
      });
      // 机头遮光眉板与视觉处理小板
      addMesh(g, roundedBox(2.6, 0.26, 0.7, 0.12, 3), std({ color: 0x1b1f25, roughness: 0.7, metalness: 0.2 }), 0, 0.5, 6.42);
      addMesh(g, box(3.6, 0.14, 1.2), std({ map: TEX.pcb, roughness: 0.6, metalness: 0.25 }), 0, 0.05, 6.0);
      return g;
    },

    /* ---- 机身中框 ---- */
    bodyLower: function () {
      var g = new THREE.Group();
      var mat = BODY_MAT();
      var inner = std({ color: 0x111419, roughness: 0.85, metalness: 0.15 });

      addMesh(g, loftGeo(BODY_SECTIONS, { part: 'lower', seam: BODY_SEAM, seg: 22 }), [mat, inner]);

      // 机臂铰链座（四条机臂的安装点）
      var hinge = std({ color: 0x22272e, roughness: 0.55, metalness: 0.5 });
      [[-1, 1, false], [1, 1, false], [-1, -1, true], [1, -1, true]].forEach(function (sd) {
        var r = armRoot(sd[0], sd[1], sd[2]);
        addMesh(g, cyl(0.9, 0.9, 1.45, 24), hinge, r.x, r.y, r.z);
        addMesh(g, cyl(0.38, 0.38, 1.6, 16), std({ color: 0x9aa3ad, roughness: 0.35, metalness: 0.9 }), r.x, r.y, r.z);
      });

      // 两侧装饰与散热槽（按曲面半宽贴合）
      var slot = DARK_MAT();
      [-1, 1].forEach(function (s) {
        [-1.4, -3.2, 0.4].forEach(function (sz2) {
          var hw = bodyHalfWidthAt(sz2, -0.55);
          addMesh(g, roundedBox(0.12, 0.16, 1.5, 0.05, 3), slot, (hw - 0.02) * s, -0.55, sz2, 0, 0, -0.1 * s);
        });
        [-2.6, -1.0].forEach(function (sz3) {
          var hw2 = bodyHalfWidthAt(sz3, -1.5);
          addMesh(g, roundedBox(0.12, 0.12, 1.4, 0.05, 3), slot, (hw2 - 0.02) * s, -1.5, sz3);
        });
      });

      // 底部散热格栅（贴着底面）
      for (var i = 0; i < 7; i++) {
        var gz = -3.2 + i * 0.62;
        addMesh(g, box(2.2, 0.1, 0.2), DARK_MAT(), 0, bodyBottomAt(gz) + 0.02, gz);
      }

      // 电池仓口（尾部深色内腔）
      addMesh(g, roundedBox(5.6, 2.5, 0.3, 0.4, 4), std({ color: 0x0e1116, roughness: 0.9, metalness: 0.1 }), 0, -0.35, -6.8);

      // 底部感知窗与补光灯座
      [-1, 1].forEach(function (s) {
        addMesh(g, cyl(0.52, 0.52, 0.18, 24), std({ color: 0x14181d, roughness: 0.6, metalness: 0.35 }), 1.25 * s, -2.42, 1.7);
      });
      // 机身螺丝（俯视可见的工艺点，贴在曲面肩部）
      var screw = std({ color: 0x767f8a, roughness: 0.35, metalness: 0.9 });
      [[-1, -5.2], [1, -5.2], [-1, 3.2], [1, 3.2]].forEach(function (p) {
        var sx = p[0] * (bodyHalfWidthAt(p[1], BODY_SEAM + 0.35) - 0.06);
        addMesh(g, cyl(0.13, 0.13, 0.08, 10), screw, sx, BODY_SEAM + 0.32, p[1]);
      });
      return g;
    },

    /* ---- 智能飞行电池 ---- */
    battery: function () {
      var g = new THREE.Group();
      var side = std({ color: 0x262c35, roughness: 0.62, metalness: 0.25 });
      addMesh(g, roundedBox(6.3, 3.1, 7.2, 0.55, 4), side, 0, -0.3, -4.6);
      // 尾部标签
      addMesh(g, new THREE.PlaneGeometry(5.6, 2.6),
        std({ map: TEX.battery, roughness: 0.55, metalness: 0.15 }), 0, -0.3, -8.22, 0, Math.PI, 0);
      // 电量指示 / 释放按钮
      addMesh(g, roundedBox(2.4, 0.6, 0.3, 0.2, 3), std({ color: 0x3a414a, roughness: 0.5, metalness: 0.5 }), 0, 1.1, -8.1);
      addMesh(g, box(1.6, 0.34, 0.12), std({ color: 0x0d1014, roughness: 0.6, metalness: 0.3 }), 0, 1.1, -8.22);
      // 触点
      var gold = std({ color: 0xd8b64a, roughness: 0.32, metalness: 1 });
      for (var i = 0; i < 4; i++) {
        addMesh(g, box(0.34, 0.3, 0.1), gold, -0.9 + i * 0.6, 1.45, -1.05);
      }
      return g;
    },

    /* ---- 接口仓盖 ---- */
    usbCover: function () {
      var g = new THREE.Group();
      addMesh(g, roundedBox(3.0, 1.6, 0.6, 0.24, 3), std({ color: 0x363c45, roughness: 0.58, metalness: 0.3 }), 0, -1.15, -7.0);
      addMesh(g, roundedBox(1.1, 0.42, 0.44, 0.16, 3), std({ color: 0x9aa3ad, roughness: 0.3, metalness: 1 }), -0.7, -1.15, -7.15);
      addMesh(g, roundedBox(0.62, 0.34, 0.36, 0.1, 3), std({ color: 0x1b1f25, roughness: 0.6, metalness: 0.4 }), 0.75, -1.15, -7.15);
      return g;
    },

    /* ---- 主板 / 图传 ---- */
    mainboard: function () {
      var g = new THREE.Group();
      var y = 1.15;
      addMesh(g, box(6.8, 0.16, 6.0), std({ map: TEX.pcb, roughness: 0.58, metalness: 0.28 }), 0, y, 0.2);
      var shield = std({ color: 0x9aa3ad, roughness: 0.28, metalness: 0.95 });
      var chip = std({ color: 0x14171d, roughness: 0.42, metalness: 0.5 });
      // 飞控屏蔽罩
      addMesh(g, box(2.7, 0.5, 2.1), shield, -1.55, y + 0.32, 0.6);
      // 图传模块
      addMesh(g, box(2.1, 0.45, 1.7), std({ color: 0x2a3138, roughness: 0.4, metalness: 0.7 }), 1.8, y + 0.3, -1.0);
      addMesh(g, box(1.8, 0.06, 1.4), std({ color: 0x1b2027, roughness: 0.3, metalness: 0.6, emissive: 0xffd9a0, emissiveIntensity: 0.2 }), 1.8, y + 0.55, -1.0);
      // 处理器与存储
      addMesh(g, box(1.0, 0.2, 1.0), chip, 0.3, y + 0.18, 2.2);
      addMesh(g, box(0.5, 0.14, 0.7), chip, 2.4, y + 0.16, 2.1);
      addMesh(g, box(0.7, 0.16, 0.5), chip, -2.7, y + 0.16, -2.1);
      // 接口
      addMesh(g, box(1.1, 0.4, 0.5), std({ color: 0xb9c2cc, roughness: 0.3, metalness: 1 }), 0, y + 0.1, -3.0);
      // 柔性排线
      addMesh(g, box(0.6, 0.04, 2.0), std({ color: 0xb0722a, roughness: 0.6, metalness: 0.3 }), 2.8, y + 0.02, 1.6);
      return g;
    },

    /* ---- 电调板 ---- */
    escBoard: function () {
      var g = new THREE.Group();
      var y = -0.55;
      addMesh(g, box(7.0, 0.16, 4.4), std({ map: TEX.pcb, roughness: 0.6, metalness: 0.25 }), 0, y, 1.6);
      var mos = std({ color: 0x171b21, roughness: 0.5, metalness: 0.6 });
      var cap = std({ color: 0x2f363d, roughness: 0.55, metalness: 0.5 });
      // 4 路功率级
      [[-1, 1], [1, 1], [-1, -1], [1, -1]].forEach(function (sd) {
        addMesh(g, box(1.5, 0.24, 1.0), mos, 2.4 * sd[0], y + 0.2, 1.6 + 1.5 * sd[1]);
        addMesh(g, cyl(0.24, 0.24, 0.5, 14), cap, 3.2 * sd[0], y + 0.32, 1.6 + 0.8 * sd[1]);
      });
      // 供电母排
      addMesh(g, box(6.0, 0.1, 0.5), std({ color: 0xb5713c, roughness: 0.35, metalness: 0.95 }), 0, y + 0.16, -0.6);
      return g;
    },

    /* ---- 散热风扇 ---- */
    coolingFan: function () {
      var g = new THREE.Group();
      var cx = 0, cy = 0.75, cz = -2.9;
      addMesh(g, cyl(1.5, 1.5, 0.9, 28, true), std({ color: 0x1b1f25, roughness: 0.6, metalness: 0.35 }), cx, cy, cz);
      // 扇叶
      var bladeMat = std({ color: 0x2a3138, roughness: 0.5, metalness: 0.4 });
      for (var i = 0; i < 7; i++) {
        var a = (i / 7) * Math.PI * 2;
        addMesh(g, box(1.25, 0.06, 0.5), bladeMat,
          cx + Math.cos(a) * 0.72, cy, cz + Math.sin(a) * 0.72, 0, -a, 0.42);
      }
      addMesh(g, cyl(0.42, 0.42, 1.0, 16), std({ color: 0x767f8a, roughness: 0.35, metalness: 0.9 }), cx, cy, cz);
      // 网罩
      addMesh(g, new THREE.CircleGeometry(1.45, 28), std({
        map: TEX.grille, roughness: 0.7, metalness: 0.4, transparent: true, alphaTest: 0.2
      }), cx, cy + 0.47, cz, -Math.PI / 2, 0, 0);
      return g;
    },

    /* ---- 下视视觉 + 红外 ToF ---- */
    visionBottom: function () {
      var g = new THREE.Group();
      var glassMat = glass(0x061420, 0x10384f);
      [-1, 1].forEach(function (s) {
        addMesh(g, cyl(0.5, 0.5, 0.42, 26), std({ color: 0x1b1f25, roughness: 0.6, metalness: 0.3 }), 1.25 * s, -2.32, 1.7);
        addMesh(g, cyl(0.38, 0.38, 0.12, 26), glassMat, 1.25 * s, -2.55, 1.7);
      });
      // 红外 ToF 与补光灯
      addMesh(g, roundedBox(1.2, 0.3, 0.7, 0.12, 3), std({ color: 0x14181d, roughness: 0.5, metalness: 0.4 }), 0, -2.42, 4.1);
      addMesh(g, box(0.6, 0.1, 0.4), std({
        color: 0x1a2230, roughness: 0.15, metalness: 0.9, emissive: 0x2a4a6a, emissiveIntensity: 0.6
      }), 0, -2.58, 4.1);
      addMesh(g, box(3.4, 0.12, 1.2), std({ map: TEX.pcb, roughness: 0.6, metalness: 0.25 }), 0, -2.2, 1.6);
      return g;
    },

    /* ---- 云台减震挂架 ---- */
    gimbalMount: function () {
      var g = new THREE.Group();
      var metal = METAL_MAT();
      addMesh(g, roundedBox(4.8, 0.3, 3.6, 0.14, 3), std({ color: 0x2a3138, roughness: 0.5, metalness: 0.55 }), 0, -2.55, 5.5);
      addMesh(g, roundedBox(3.8, 0.7, 2.2, 0.2, 3), std({ color: 0x22272e, roughness: 0.55, metalness: 0.5 }), 0, -2.2, 5.5);
      // 4 个橡胶减震球
      var rubber = std({ color: 0x14161a, roughness: 0.75, metalness: 0.1 });
      [[-1, 1], [1, 1], [-1, -1], [1, -1]].forEach(function (sd) {
        addMesh(g, new THREE.SphereGeometry(0.34, 16, 12), rubber, 1.95 * sd[0], -2.72, 5.5 + 1.35 * sd[1]);
        addMesh(g, cyl(0.1, 0.1, 0.7, 10), metal, 1.95 * sd[0], -2.72, 5.5 + 1.35 * sd[1]);
      });
      return g;
    },

    /* ---- 三轴云台 ---- */
    gimbal: function () {
      var g = new THREE.Group();
      var metal = std({ color: 0x8e97a3, roughness: 0.3, metalness: 0.95 });
      var dark = std({ color: 0x1b1f25, roughness: 0.5, metalness: 0.6 });
      // 偏航电机
      addMesh(g, cyl(0.85, 0.9, 1.0, 32), dark, 0, -3.15, 5.5);
      addMesh(g, cyl(0.7, 0.7, 1.1, 32), metal, 0, -3.15, 5.5);
      // 横滚臂
      addMesh(g, roundedBox(0.62, 1.9, 0.62, 0.2, 3), dark, 3.1, -3.9, 5.5);
      addMesh(g, roundedBox(2.6, 0.6, 0.62, 0.2, 3), dark, 1.85, -3.05, 5.5);
      // 俯仰电机
      addMesh(g, cylZ(0.66, 0.66, 0.7, 28), metal, 3.1, CAM_Y, 5.5);
      addMesh(g, cylZ(0.5, 0.5, 0.5, 24), dark, 3.55, CAM_Y, 5.5);
      // 相机承载横梁
      addMesh(g, roundedBox(6.6, 0.34, 0.9, 0.14, 3), dark, 0, CAM_Y - 0.05, 5.2);
      addMesh(g, box(6.2, 0.06, 0.5), metal, 0, CAM_Y + 0.14, 5.2);
      // 云台驱动板
      addMesh(g, box(2.0, 0.1, 1.4), std({ map: TEX.pcb, roughness: 0.6, metalness: 0.25 }), -1.6, CAM_Y + 0.25, 5.0);
      return g;
    },

    /* ---- 哈苏主相机 ---- */
    cameraMain: function () {
      var g = new THREE.Group();
      var x = -1.75;
      addMesh(g, roundedBox(2.9, 3.1, 2.5, 0.4, 4), std({ color: 0x2a2f36, roughness: 0.45, metalness: 0.5 }), x, CAM_Y, CAM_Z);
      // 镜筒
      var barrel = std({ color: 0x3a4048, roughness: 0.32, metalness: 0.9 });
      addMesh(g, cylZ(1.14, 1.2, 1.5, 40), barrel, x, CAM_Y, CAM_Z + 1.95);
      // 哈苏铭牌环
      addMesh(g, cylZ(1.19, 1.19, 0.5, 40, true),
        std({ map: TEX.lensBrand, roughness: 0.45, metalness: 0.5 }), x, CAM_Y, CAM_Z + 1.85);
      // 压圈 + 前组镜片
      ringParts(g, 0.96, 1.22, 0.34, x, CAM_Y, CAM_Z + 2.6, std({ color: 0x1b1f25, roughness: 0.4, metalness: 0.7 }));
      var glassMat = glass(0x08182a, 0x0d3a5c);
      var dome = new THREE.SphereGeometry(0.94, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2);
      dome.rotateX(Math.PI / 2);
      dome.scale(1, 1, 0.28);
      addMesh(g, dome, glassMat, x, CAM_Y, CAM_Z + 2.6);
      addMesh(g, cylZ(0.8, 0.8, 0.05, 36), glassMat, x, CAM_Y, CAM_Z + 2.2);
      // 光圈叶片示意
      addMesh(g, new THREE.TorusGeometry(0.74, 0.05, 8, 32), std({ color: 0x14181d, roughness: 0.4, metalness: 0.8 }), x, CAM_Y, CAM_Z + 2.3);
      // 传感器板
      addMesh(g, box(1.9, 1.5, 0.14), std({ color: 0x123a2c, roughness: 0.6, metalness: 0.3 }), x, CAM_Y, CAM_Z - 1.35);
      addMesh(g, box(1.35, 1.05, 0.06), std({
        color: 0x1b3550, roughness: 0.04, metalness: 1, emissive: 0x114066, emissiveIntensity: 0.7
      }), x, CAM_Y, CAM_Z - 1.43);
      return g;
    },

    /* ---- 中长焦相机 ---- */
    cameraMid: function () {
      var g = new THREE.Group();
      var x = 0.65;
      addMesh(g, roundedBox(2.1, 2.4, 2.0, 0.32, 4), std({ color: 0x2a2f36, roughness: 0.45, metalness: 0.5 }), x, CAM_Y, CAM_Z);
      addMesh(g, cylZ(0.66, 0.7, 1.15, 32), std({ color: 0x3a4048, roughness: 0.32, metalness: 0.9 }), x, CAM_Y, CAM_Z + 1.6);
      ringParts(g, 0.5, 0.7, 0.26, x, CAM_Y, CAM_Z + 2.05, std({ color: 0x1b1f25, roughness: 0.4, metalness: 0.7 }));
      var glassMat = glass(0x08182a, 0x0d3a5c);
      addMesh(g, cylZ(0.5, 0.5, 0.06, 28), glassMat, x, CAM_Y, CAM_Z + 2.05);
      addMesh(g, box(1.4, 1.2, 0.12), std({ map: TEX.pcb, roughness: 0.6, metalness: 0.25 }), x, CAM_Y, CAM_Z - 1.05);
      return g;
    },

    /* ---- 长焦相机 ---- */
    cameraTele: function () {
      var g = new THREE.Group();
      var x = 2.05;
      addMesh(g, roundedBox(1.7, 2.0, 1.8, 0.3, 4), std({ color: 0x2a2f36, roughness: 0.45, metalness: 0.5 }), x, CAM_Y, CAM_Z);
      addMesh(g, cylZ(0.5, 0.54, 1.0, 28), std({ color: 0x3a4048, roughness: 0.32, metalness: 0.9 }), x, CAM_Y, CAM_Z + 1.5);
      ringParts(g, 0.38, 0.54, 0.24, x, CAM_Y, CAM_Z + 1.9, std({ color: 0x1b1f25, roughness: 0.4, metalness: 0.7 }));
      addMesh(g, cylZ(0.38, 0.38, 0.06, 24), glass(0x08182a, 0x0d3a5c), x, CAM_Y, CAM_Z + 1.9);
      addMesh(g, box(1.1, 1.0, 0.12), std({ map: TEX.pcb, roughness: 0.6, metalness: 0.25 }), x, CAM_Y, CAM_Z - 0.95);
      return g;
    },

    /* ---- 机臂（前后左右通用） ---- */
    armFrontL: function () { return buildArm(-1, 1, false); },
    armFrontR: function () { return buildArm(1, 1, false); },
    armRearL: function () { return buildArm(-1, -1, true); },
    armRearR: function () { return buildArm(1, -1, true); },

    /* ---- 桨叶 ---- */
    propFL: function () { return buildProp(-1, 1, -58 * Math.PI / 180); },
    propFR: function () { return buildProp(1, 1, 58 * Math.PI / 180); },
    propRL: function () { return buildProp(-1, -1, 58 * Math.PI / 180); },
    propRR: function () { return buildProp(1, -1, -58 * Math.PI / 180); }
  };

  /** 机臂：放样锥形臂管 + 折叠铰链 + 电机（后机臂另带起落架） */
  function buildArm(sx, sz, isRear) {
    var g = new THREE.Group();
    var root = armRoot(sx, sz, isRear);
    var motorPos = new THREE.Vector3(MOTOR.x * sx, MOTOR.y, MOTOR.z * sz);
    var span = new THREE.Vector3().subVectors(motorPos, root);
    var len = span.length();

    // 臂管：根部粗、末端细，带轻微上反
    var sections = [
      { z: -len / 2, w: 2.0, h: 1.7, y: 0, n: 3.4 },
      { z: -len * 0.18, w: 1.85, h: 1.55, y: 0.02, n: 3.1 },
      { z: len * 0.16, w: 1.6, h: 1.38, y: 0.05, n: 2.9 },
      { z: len * 0.36, w: 1.42, h: 1.26, y: 0.07, n: 2.7 },
      { z: len / 2, w: 1.3, h: 1.16, y: 0.09, n: 2.5 }
    ];
    var arm = addMesh(g, loftGeo(sections, { part: 'full', seg: 16 }),
      std({ color: 0x333942, roughness: 0.55, metalness: 0.35, roughnessMap: TEX.noise }));
    placeAlong(arm, root, motorPos);

    // 臂上装饰槽
    var groove = addMesh(g, box(0.75, 0.12, len * 0.66), DARK_MAT());
    placeAlong(groove, root, motorPos);
    groove.position.y += 0.82;

    // 折叠铰链
    addMesh(g, cyl(0.82, 0.82, 1.85, 22), std({ color: 0x22272e, roughness: 0.55, metalness: 0.5 }), root.x, root.y, root.z);
    addMesh(g, cyl(0.34, 0.34, 2.05, 14), std({ color: 0x9aa3ad, roughness: 0.35, metalness: 0.9 }), root.x, root.y, root.z);

    // 电机（定子座 + 转子壳 + 桨夹）
    var metalMat = std({ color: 0x8e97a3, roughness: 0.3, metalness: 0.95 });
    var dark = std({ color: 0x14181d, roughness: 0.55, metalness: 0.5 });
    addMesh(g, cyl(0.88, 0.94, 0.4, 28), dark, motorPos.x, motorPos.y - 0.44, motorPos.z);
    addMesh(g, cyl(0.72, 0.78, 1.2, 28), metalMat, motorPos.x, motorPos.y + 0.2, motorPos.z);
    addMesh(g, cyl(0.76, 0.76, 0.1, 28), std({ color: 0x2a3138, roughness: 0.45, metalness: 0.7 }), motorPos.x, motorPos.y + 0.64, motorPos.z);
    // 转子壳上的三颗螺钉
    var screw = std({ color: 0x767f8a, roughness: 0.35, metalness: 0.9 });
    for (var k = 0; k < 3; k++) {
      var ang = k * Math.PI * 2 / 3;
      addMesh(g, cyl(0.08, 0.08, 0.06, 8), screw, motorPos.x + Math.cos(ang) * 0.5, motorPos.y + 0.7, motorPos.z + Math.sin(ang) * 0.5);
    }
    addMesh(g, cyl(0.24, 0.24, 0.5, 16), metalMat, motorPos.x, motorPos.y + 0.98, motorPos.z);
    addMesh(g, cyl(0.4, 0.4, 0.14, 20), std({ color: 0x1b1f25, roughness: 0.5, metalness: 0.6 }), motorPos.x, motorPos.y + 1.24, motorPos.z);

    // 后机臂起落架
    if (isRear) {
      var t = 0.6;
      var lx = root.x + span.x * t, ly = root.y + span.y * t, lz = root.z + span.z * t;
      var topY = ly - 0.5;
      addMesh(g, roundedBox(0.66, 0.66, 0.66, 0.22, 3), std({ color: 0x22272e, roughness: 0.55, metalness: 0.5 }), lx, topY, lz);
      var legLen = topY - FOOT_Y;
      addMesh(g, roundedBox(0.46, legLen, 0.46, 0.16, 3), std({ color: 0x2a3138, roughness: 0.55, metalness: 0.45 }), lx, topY - legLen / 2, lz);
      addMesh(g, cyl(0.44, 0.36, 0.22, 16), std({ color: 0x14161a, roughness: 0.7, metalness: 0.2 }), lx, FOOT_Y, lz);
    }
    return g;
  }

  /** 桨叶：轮毂 + 两片折叠桨 */
  function buildProp(sx, sz, bladeAngle) {
    var g = new THREE.Group();
    var cx = MOTOR.x * sx, cy = PROP_HUB_Y, cz = MOTOR.z * sz;
    var hub = std({ color: 0x22262c, roughness: 0.5, metalness: 0.6 });
    addMesh(g, cyl(0.42, 0.46, 0.3, 20), hub, cx, cy, cz);
    addMesh(g, cyl(0.62, 0.5, 0.12, 20), std({ color: 0x2f353d, roughness: 0.45, metalness: 0.6 }), cx, cy + 0.2, cz);
    var bladeMat = std({ color: 0x1e232a, roughness: 0.45, metalness: 0.4 });
    [0, Math.PI].forEach(function (off) {
      var pivot = new THREE.Group();
      pivot.position.set(cx, cy, cz);
      pivot.rotation.y = bladeAngle + off;
      addMesh(pivot, bladeGeo(5.6, 0.2, 0.5, 0.26, 0.055, -0.011), bladeMat, 0, 0.1, 0, 0.24, 0, 0);
      // 叶尖警示条
      addMesh(pivot, box(0.85, 0.02, 0.5), std({ color: 0xd94a3a, roughness: 0.5, metalness: 0.2 }),
        5.05, 0.17, -0.28, 0.24, 0, 0);
      g.add(pivot);
    });
    return g;
  }

  /* =======================================================================
     5. 部件定义（结构 + 参数）
     ======================================================================= */
  function P(o) { return o; }

  function buildPartDefs() {
    return [
      P({
        id: 'bodyUpper', name: '机身上盖', en: 'Upper Shell',
        tag: '复合材质 · 承力上壳', color: '#94a3b8', dir: [0, 1, 0.08], dist: 5.8,
        role: '机身顶部承力壳体，覆盖主板、图传与定位模块，同时构成气动外形与内部散热风道。',
        specs: [
          ['材质', '高强度复合塑料 + 内部加强筋'],
          ['固定', '卡扣 + 螺钉复合固定'],
          ['功能', '承力、电磁屏蔽、散热风道'],
          ['下方部件', '主板、图传模块、GPS 天线']
        ]
      }),
      P({
        id: 'gpsAntenna', name: '定位与天线模块', en: 'GNSS & Antenna',
        tag: 'GPS + Galileo + BeiDou', color: '#a78bfa', dir: [0.15, 1, 0.35], dist: 4.4,
        role: '提供定位基准与返航依据，并承载 O3+ 图传天线的馈电与匹配结构。',
        specs: [
          ['定位', 'GPS + Galileo + BeiDou'],
          ['功能', '定点悬停、自动返航、航线飞行'],
          ['天线', '图传双天线分集'],
          ['位置', '上盖内侧顶部']
        ]
      }),
      P({
        id: 'visionFront', name: '前视双目视觉', en: 'Forward Vision System',
        tag: '前向避障 · APAS 5.0', color: '#5eead4', dir: [0, 0.4, 1], dist: 4.0,
        role: '前向双目视觉，通过两路图像的视差实时构建前方障碍物的深度信息，是自动绕障的基础。',
        specs: [
          ['类型', '前向双目视觉'],
          ['作用', '前向避障、APAS 5.0 自动绕障'],
          ['体系', '全向避障的组成部分'],
          ['位置', '机身前脸两侧']
        ]
      }),
      P({
        id: 'bodyLower', name: '机身中框', en: 'Airframe',
        tag: '347.5 × 283 × 107.7 mm', color: '#8b97a6', dir: [0, -1, -0.1], dist: 1.8,
        role: '整机结构主体：四支折叠机臂、云台减震挂架、电池仓与起落结构全部安装在中框上。',
        specs: [
          ['展开尺寸', '347.5 × 283 × 107.7 mm'],
          ['折叠尺寸', '221 × 96.3 × 90.3 mm'],
          ['起飞重量', '约 958 g'],
          ['最大速度', '21 m/s（运动挡）'],
          ['抗风能力', '12 m/s']
        ]
      }),
      P({
        id: 'battery', name: '智能飞行电池', en: 'Intelligent Flight Battery',
        tag: '5000 mAh · 77 Wh', color: '#facc15', dir: [-0.15, -0.4, -1], dist: 5.4,
        role: '从机身尾部推入的智能电池，内置 BMS 与自放电保护逻辑，是整机续航与配重的核心。',
        specs: [
          ['容量', '5000 mAh'],
          ['能量', '77 Wh'],
          ['最长飞行', '43 分钟（无风环境）'],
          ['充电', '65W 快充，约 96 分钟充满'],
          ['保护', '存放自放电、低温保护']
        ]
      }),
      P({
        id: 'usbCover', name: '接口仓盖', en: 'Port Cover',
        tag: 'USB-C · microSD', color: '#a3a3a3', dir: [0, -0.6, -1], dist: 3.6,
        role: '机身尾部接口仓盖，内含 USB-C 充电/数据接口与 microSD 卡槽，兼作机身尾部封闭结构。',
        specs: [
          ['接口', 'USB-C（充电 / 数据传输）'],
          ['卡槽', 'microSD'],
          ['内置存储', '8 GB'],
          ['功能', '导素材、固件升级']
        ]
      }),
      P({
        id: 'mainboard', name: '主板 / 图传模块', en: 'Mainboard & O3+',
        tag: 'O3+ 图传 · SoC', color: '#4ade80', dir: [0.28, 1, 0.22], dist: 3.4,
        role: '飞控、图像处理、O3+ 图传与全向避障运算的核心电路板，是整机的“大脑”。',
        specs: [
          ['图传', 'O3+，最远 15 km'],
          ['实时画面', '1080p / 60fps'],
          ['编码', 'H.265，最高 5.1K/50fps'],
          ['功能', '飞控、ISP、避障运算'],
          ['存储', '内置 8 GB']
        ]
      }),
      P({
        id: 'escBoard', name: '电调板', en: 'ESC Board',
        tag: '4 路无刷电调', color: '#22c55e', dir: [-0.28, -1, 0.22], dist: 3.2,
        role: '把电池的直流电按飞控指令精确分配给四个电机，决定转速响应与飞行姿态的细腻度。',
        specs: [
          ['通道', '4 路无刷电调'],
          ['驱动', 'FOC 正弦驱动'],
          ['协同', '双 IMU 冗余 + 飞控闭环'],
          ['位置', '中框下部']
        ]
      }),
      P({
        id: 'coolingFan', name: '散热风扇', en: 'Cooling Fan',
        tag: '主动风冷', color: '#fb923c', dir: [-0.55, 0.15, -1], dist: 3.8,
        role: '主动把主板与图传模块的热量排出机身，保证长时间高码率录制与图传稳定不降频。',
        specs: [
          ['类型', '主动风冷涡轮风扇'],
          ['位置', '机身内部 / 尾部风道'],
          ['触发', '录制、高负载图传'],
          ['作用', '抑制过热降频']
        ]
      }),
      P({
        id: 'visionBottom', name: '下视视觉 + 红外 ToF', en: 'Downward Vision & ToF',
        tag: '下视定位 · 红外测距', color: '#2dd4bf', dir: [0, -1, 0.3], dist: 3.6,
        role: '向下测量地面纹理与距离，实现无 GPS 环境下的精准悬停与低空平稳飞行。',
        specs: [
          ['组成', '下视双目视觉 + 红外 ToF'],
          ['功能', '精准悬停、低空定高'],
          ['场景', '室内、无 GPS 环境'],
          ['辅助', '下视补光灯']
        ]
      }),
      P({
        id: 'armFrontL', name: '左前机臂', en: 'Front Left Arm',
        tag: '折叠机臂 · 无刷电机', color: '#7dd3fc', dir: [-1, 0.25, 0.75], dist: 6.2,
        role: '展开后由卡扣锁定的折叠机臂，末端安装无刷电机，为整机提供升力与姿态控制力矩。',
        specs: [
          ['结构', '折叠 + 卡扣锁定'],
          ['电机', '无刷电机，闭环转速控制'],
          ['桨叶', '快拆折叠桨'],
          ['位置', '机身左前方']
        ]
      }),
      P({
        id: 'armFrontR', name: '右前机臂', en: 'Front Right Arm',
        tag: '折叠机臂 · 无刷电机', color: '#7dd3fc', dir: [1, 0.25, 0.75], dist: 6.2,
        role: '与左前机臂对称的前置折叠机臂，收纳时向后收拢贴合机身。',
        specs: [
          ['结构', '折叠 + 卡扣锁定'],
          ['电机', '无刷电机，闭环转速控制'],
          ['桨叶', '快拆折叠桨'],
          ['位置', '机身右前方']
        ]
      }),
      P({
        id: 'armRearL', name: '左后机臂', en: 'Rear Left Arm',
        tag: '折叠机臂 · 集成起落架', color: '#38bdf8', dir: [-1, 0.25, -0.75], dist: 6.2,
        role: '后置折叠机臂，下方集成起落架，为云台相机留出离地间隙。',
        specs: [
          ['结构', '折叠 + 卡扣锁定'],
          ['电机', '无刷电机，闭环转速控制'],
          ['起落架', '后机臂集成支撑腿'],
          ['位置', '机身左后方']
        ]
      }),
      P({
        id: 'armRearR', name: '右后机臂', en: 'Rear Right Arm',
        tag: '折叠机臂 · 集成起落架', color: '#38bdf8', dir: [1, 0.25, -0.75], dist: 6.2,
        role: '与左后机臂对称的后置折叠机臂，同样集成起落架支撑腿。',
        specs: [
          ['结构', '折叠 + 卡扣锁定'],
          ['电机', '无刷电机，闭环转速控制'],
          ['起落架', '后机臂集成支撑腿'],
          ['位置', '机身右后方']
        ]
      }),
      /* 四支桨：引擎据 def.spin 让它转，据 def.spinAt 找到自旋中心（网格为绝对坐标建模，
         引擎会自动把网格收进内层枢轴组）；def.rotor 是动态桨盘光晕半径。*/
      P({
        id: 'propFL', name: '左前桨叶', en: 'Front Left Propeller',
        pivot: null, spin: { speed: 15, dir: 1 }, spinAt: propSpinAt(-1, 1),
        rotor: PROP_R, rotorY: 0.1, aspect: 0.2,
        tag: '低噪快拆折叠桨', color: '#f472b6', dir: [-0.45, 1, 0.4], dist: 3.8,
        role: '把电机扭矩转换成升力；折叠桨设计便于收纳，快拆结构便于单支更换。',
        specs: [
          ['类型', '折叠快拆桨'],
          ['数量', '每机 4 支'],
          ['特点', '低噪桨型，叶尖后掠'],
          ['维护', '可单独拆装更换']
        ]
      }),
      P({
        id: 'propFR', name: '右前桨叶', en: 'Front Right Propeller',
        pivot: null, spin: { speed: 15, dir: -1 }, spinAt: propSpinAt(1, 1),
        rotor: PROP_R, rotorY: 0.1, aspect: 0.2,
        tag: '低噪快拆折叠桨', color: '#f472b6', dir: [0.45, 1, 0.4], dist: 3.8,
        role: '与前桨成对反向旋转，抵消反扭矩，保持机身航向稳定。',
        specs: [
          ['类型', '折叠快拆桨'],
          ['旋向', '与左前桨反向'],
          ['特点', '低噪桨型，叶尖后掠'],
          ['维护', '可单独拆装更换']
        ]
      }),
      P({
        id: 'propRL', name: '左后桨叶', en: 'Rear Left Propeller',
        pivot: null, spin: { speed: 15, dir: -1 }, spinAt: propSpinAt(-1, -1),
        rotor: PROP_R, rotorY: 0.1, aspect: 0.2,
        tag: '低噪快拆折叠桨', color: '#f472b6', dir: [-0.45, 1, -0.4], dist: 3.8,
        role: '后部动力单元，与前桨配合完成俯仰、横滚与偏航的力矩分配。',
        specs: [
          ['类型', '折叠快拆桨'],
          ['数量', '每机 4 支'],
          ['特点', '低噪桨型，叶尖后掠'],
          ['维护', '可单独拆装更换']
        ]
      }),
      P({
        id: 'propRR', name: '右后桨叶', en: 'Rear Right Propeller',
        pivot: null, spin: { speed: 15, dir: 1 }, spinAt: propSpinAt(1, -1),
        rotor: PROP_R, rotorY: 0.1, aspect: 0.2,
        tag: '低噪快拆折叠桨', color: '#f472b6', dir: [0.45, 1, -0.4], dist: 3.8,
        role: '与左后桨反向旋转，构成 X 型四轴的最后一路动力。',
        specs: [
          ['类型', '折叠快拆桨'],
          ['旋向', '与左后桨反向'],
          ['特点', '低噪桨型，叶尖后掠'],
          ['维护', '可单独拆装更换']
        ]
      }),
      P({
        id: 'gimbalMount', name: '云台减震挂架', en: 'Gimbal Damper Mount',
        tag: '4 点橡胶减震', color: '#fbbf24', dir: [0, -0.6, 1], dist: 2.8,
        role: '用四点橡胶减震球把云台与机身隔开，过滤机身振动与电机高频抖动，是画面稳定的第一道防线。',
        specs: [
          ['结构', '4 点橡胶减震球悬挂'],
          ['作用', '隔离机身与电机振动'],
          ['材质', '金属挂架 + 硅胶减震球'],
          ['下方部件', '三轴云台']
        ]
      }),
      P({
        id: 'gimbal', name: '三轴云台', en: '3-Axis Gimbal',
        tag: '三轴机械增稳', color: '#f97316', dir: [0, -0.7, 1], dist: 4.2,
        role: '俯仰、横滚、偏航三轴无刷电机实时反向补偿机身姿态，让相机始终指向目标。',
        specs: [
          ['轴数', '3 轴（俯仰 / 横滚 / 偏航）'],
          ['可控范围', '俯仰 -90° ~ +35°'],
          ['结构', '无刷电机 + 磁编码闭环'],
          ['模式', '跟随 / 锁定 / FPV']
        ]
      }),
      P({
        id: 'cameraMain', name: '哈苏主相机', en: 'Hasselblad Main Camera',
        tag: '4/3 CMOS · 2000 万像素', color: '#22d3ee', dir: [-0.25, -0.5, 1], dist: 5.6,
        role: '与哈苏联合调校的 4/3 英寸主摄，负责最高画质拍摄，是 Mavic 3 Pro 的成像主力。',
        specs: [
          ['传感器', '4/3 英寸 CMOS'],
          ['有效像素', '2000 万'],
          ['光圈', 'f/2.8 – f/11 可变光圈'],
          ['等效焦距', '24 mm'],
          ['视频', '5.1K/50fps、4K/120fps'],
          ['色彩', '10-bit D-Log']
        ]
      }),
      P({
        id: 'cameraMid', name: '中长焦相机', en: 'Medium Tele Camera',
        tag: '1/1.3" · 4800 万像素', color: '#67e8f9', dir: [0.1, -0.25, 1], dist: 6.4,
        role: '等效 70 mm 的中长焦相机，用于中距离取景与人像压缩感构图，兼顾画质与机动性。',
        specs: [
          ['传感器', '1/1.3 英寸 CMOS'],
          ['有效像素', '4800 万'],
          ['等效焦距', '70 mm'],
          ['光圈', 'f/2.8'],
          ['视频', '4K/60fps']
        ]
      }),
      P({
        id: 'cameraTele', name: '长焦相机', en: 'Tele Camera',
        tag: '1/2" · 1200 万像素', color: '#a5f3fc', dir: [0.35, -0.55, 1], dist: 6.0,
        role: '等效 166 mm 长焦相机，可在远距离安全拍摄特写与强压缩构图。',
        specs: [
          ['传感器', '1/2 英寸 CMOS'],
          ['有效像素', '1200 万'],
          ['等效焦距', '166 mm'],
          ['光圈', 'f/3.4'],
          ['视频', '4K/60fps']
        ]
      })
    ];
  }

  var PARTS = buildPartDefs();

  /* =======================================================================
     6. 引擎注入：返回 BUILDER（引擎按 def.id 调用 builder[def.id](H)）
     ======================================================================= */
  function makeBuilder(H) {
    H_ = H;
    THREE = H.THREE;
    if (!TEX) buildTextures();     // 本机型自带贴图，不依赖引擎 TEX 里有没有对应键
    return BUILDER;
  }

  /* =======================================================================
     7. 机型自注册（引擎按 window.DJIPage.model 装配，保持引擎与机型无关）
     ======================================================================= */
  window.DJIModelMavic = {
    title: 'DJI Mavic 3 Pro',
    subtitle: 'Triple-Camera Flagship Aerial Drone',
    titleEn: 'DJI Mavic 3 Pro · Triple Camera',
    aerial: true,                       // 飞行器：引擎据此启用模拟飞行与航行灯
    intro: '点击模型中的任意部件，或点击左侧「部件清单」，即可自动拆解整机并逐件查看结构；' +
      '主摄（4/3 哈苏）、中长焦（70 mm）与长焦（166 mm）三摄同轴，一机完成广角到特写的连续构图。' +
      '顶部按钮可进入演示巡航、技术图纸模式、中英切换与模拟飞行，S 键触发整机状态自检。',
    groups: ['机身结构', '动力系统', '相机与云台', '飞控与图传', '感知与避障', '供电'],
    scene: {
      rootScale: 0.5, floorY: -4.6, theta: 0.62, phi: 1.06, radius: 26,
      zoomBias: 4.0, phiBias: 0.18, minRadius: 11, maxRadius: 60,
      fog: 0.009, gridSize: 90, gridDiv: 45, ringR: 8.6, shadowR: 13,
      keyLight: [9, 16, 12], targetY: 0
    },
    spec: [
      ['展开尺寸', '347.5 × 283 × 107.7 mm（含桨）'],
      ['折叠尺寸', '221 × 96.3 × 90.3 mm'],
      ['起飞重量', '约 958 g'],
      ['最长飞行', '43 分钟（无风环境）'],
      ['主摄', '4/3 英寸 CMOS 哈苏相机，2000 万像素，f/2.8–f/11 可变光圈'],
      ['中长焦', '1/1.3 英寸 CMOS，4800 万像素，等效 70 mm'],
      ['长焦', '1/2 英寸 CMOS，1200 万像素，等效 166 mm'],
      ['视频', '5.1K/50fps、4K/120fps、10-bit D-Log'],
      ['云台', '三轴机械增稳，俯仰 -90° ~ +35°'],
      ['图传', 'O3+，最远 15 km，1080p/60fps'],
      ['避障', '全向双目视觉 + 下视红外 ToF，APAS 5.0'],
      ['电池', '5000 mAh / 77 Wh，65W 快充'],
      ['速度/抗风', '最大 21 m/s，抗风 12 m/s'],
      ['存储', '内置 8 GB + microSD'],
      ['定位', 'GPS + Galileo + BeiDou']
    ],
    selfTest: [
      ['结构完整性', 'AIRFRAME'], ['折叠机臂锁定', 'ARMS'],
      ['动力与桨叶', 'PROPULSION'], ['三摄云台', 'GIMBAL'],
      ['O3+ 图传与飞控', 'AVIONICS'], ['避障与定位', 'VISION'],
      ['电池与配电', 'POWER']
    ],
    builderFactory: makeBuilder,
    parts: PARTS,

    /* 只读导出：几何常量与截面查询，供自检脚本核对尺寸用 */
    constants: { MOTOR: MOTOR, CAM_Y: CAM_Y, CAM_Z: CAM_Z, FOOT_Y: FOOT_Y,
      BODY_SEAM: BODY_SEAM, BODY_SECTIONS: BODY_SECTIONS, PROP_R: PROP_R,
      sectionAt: sectionAt, bodyTopAt: bodyTopAt, bodyBottomAt: bodyBottomAt,
      bodyHalfWidthAt: bodyHalfWidthAt, armRoot: armRoot }
  };

  window.DJIPage = window.DJIPage || {};
  window.DJIPage.model = window.DJIModelMavic;
})();