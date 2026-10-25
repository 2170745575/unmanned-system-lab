/* =========================================================================
   MEDEVAC-1 大型医疗救援无人机 · 机型模块（model-medical.js）
   -------------------------------------------------------------------------
   六旋翼 3 米级医疗救援平台：增压医疗舱、生命维持、血液冷藏、监护除颤、
   绞盘吊救、可抛投医疗物资舱。只提供数据与几何，不含引擎逻辑。
   注意：本文件先于 Three.js 加载执行，顶层绝对不能触碰 THREE。
   ========================================================================= */
(function () {
  'use strict';

  /* ---- 关键尺寸（cm，真实比例）---- */
  var SPAN = 300;                       // 含桨尖总跨度
  var MOTOR_R = 105;                    // 电机到中心距离
  var ARMS = [                          // 六旋翼方位角（度，从 +Z 机头方向起算）
    { id: 'F', a: 35 }, { id: 'M', a: 90 }, { id: 'R', a: 145 }
  ];
  var FOOT_Y = -75;                     // 起落架脚底
  var SEAM = -10;                       // 医疗舱上下分缝

  /* 医疗舱截面（圆角箱体，超椭圆指数偏大 → 硬朗的舱体轮廓） */
  var SECTIONS = [
    { z: -96, w: 66, h: 66, y: 0, n: 3.8 },
    { z: -72, w: 100, h: 88, y: 0, n: 4.4 },
    { z: -34, w: 110, h: 96, y: 0, n: 5.0 },
    { z: 26, w: 110, h: 96, y: 0, n: 5.0 },
    { z: 66, w: 100, h: 88, y: -2, n: 4.6 },
    { z: 96, w: 80, h: 72, y: -4, n: 4.0 },
    { z: 124, w: 54, h: 50, y: -6, n: 3.4 },
    { z: 140, w: 30, h: 28, y: -8, n: 3.0 }
  ];

  function sectionAt(z) {
    var S = SECTIONS;
    if (z <= S[0].z) return S[0];
    if (z >= S[S.length - 1].z) return S[S.length - 1];
    for (var i = 0; i < S.length - 1; i++) {
      if (z >= S[i].z && z <= S[i + 1].z) {
        var t = (z - S[i].z) / (S[i + 1].z - S[i].z);
        return { z: z, w: S[i].w + (S[i + 1].w - S[i].w) * t,
          h: S[i].h + (S[i + 1].h - S[i].h) * t,
          y: S[i].y + (S[i + 1].y - S[i].y) * t,
          n: S[i].n + (S[i + 1].n - S[i].n) * t };
      }
    }
    return S[0];
  }
  function topAt(z) { var s = sectionAt(z); return s.y + s.h / 2; }
  function bottomAt(z) { var s = sectionAt(z); return s.y - s.h / 2; }
  function halfWidthAt(z, y) {
    var s = sectionAt(z), hw = s.w / 2, hh = s.h / 2;
    var v = Math.max(-1, Math.min(1, (y - s.y) / hh));
    return hw * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(v), s.n)), 1 / s.n);
  }
  function motorPos(aDeg, sign) {
    var a = aDeg * Math.PI / 180 * sign;
    return new THREE.Vector3(Math.sin(a) * MOTOR_R, 6, Math.cos(a) * MOTOR_R);
  }
  function armRoot(aDeg, sign) {
    var a = aDeg * Math.PI / 180 * sign;
    return new THREE.Vector3(Math.sin(a) * 46, 8, Math.cos(a) * 46);
  }

  /* 桨叶自旋中心（纯数学，模块顶层可用） */
  function propSpinAt(aDeg, sign) {
    var a = aDeg * Math.PI / 180 * sign;
    return [+(Math.sin(a) * MOTOR_R).toFixed(3), 6 + 25, +(Math.cos(a) * MOTOR_R).toFixed(3)];
  }
  var PROP_R = 45;      // 桨盘半径（cm）

  /* ---- 配色 ---- */
  var WHITE = 0xe9eef2, WHITE_D = 0xd2dade, GRAY = 0xb4bec6, DARK = 0x39424a,
      DARKER = 0x232a30, RED = 0xc0392b, RED_L = 0xd94f3d, GREEN = 0x3fa66a,
      GLASS = 0x16242c, STEEL = 0x9aa4ac;

  function shellMat(H) { return H.std({ color: WHITE, roughness: 0.42, metalness: 0.22, roughnessMap: H.TEX.noise }); }
  function darkMat() { return { color: DARK, roughness: 0.55, metalness: 0.45 }; }
  function mk(H, c, r, m) { return H.std({ color: c, roughness: r, metalness: m }); }

  /* 红十字标记（两个薄块交叉） */
  function redCross(H, g, x, y, z, size, thick, ry, color) {
    var mat = H.std({ color: color || RED, roughness: 0.5, metalness: 0.1,
      emissive: color || RED, emissiveIntensity: 0.12 });
    var a = new H.THREE.Mesh(H.box(size, size * 0.34, thick), mat);
    a.position.set(x, y, z);
    var b = new H.THREE.Mesh(H.box(size * 0.34, size, thick), mat);
    b.position.set(x, y, z);
    if (ry) { a.rotation.y = ry; b.rotation.y = ry; }
    g.add(a); g.add(b);
  }

  var builder = {

    /* ---- 医疗舱上盖（含顶部红十字与信标） ---- */
    cabinUpper: function (H) {
      var g = new H.THREE.Group();
      var mat = shellMat(H);
      var inner = H.std({ color: 0x1d242a, roughness: 0.85, metalness: 0.1 });
      g.add(new H.THREE.Mesh(H.loftGeo(SECTIONS, { part: 'upper', seam: SEAM, seg: 22 }), [mat, inner]));

      // 顶部加强梁与系留环
      var beam = mk(H, WHITE_D, 0.45, 0.3);
      [-30, 10, 50].forEach(function (z) {
        H.addMesh(g, H.roundedBox(4, 3, 96, 1.4, 3), beam, 0, topAt(z) - 1, z);
      });
      // 顶部红十字（医疗标识）
      redCross(H, g, 0, topAt(10) + 1.2, 10, 46, 2.4, 0, RED);
      // 主机翼式散热脊
      for (var i = 0; i < 6; i++) {
        H.addMesh(g, H.box(30, 1.6, 3), mk(H, DARKER, 0.6, 0.5), 0, topAt(-40 + i * 16) + 0.6, -40 + i * 16);
      }
      // 顶部航行灯（红/绿/白）
      var navL = H.std({ color: 0x2a0d0a, roughness: 0.35, metalness: 0.2, emissive: RED_L, emissiveIntensity: 1.6 });
      var navR = H.std({ color: 0x0a2a14, roughness: 0.35, metalness: 0.2, emissive: 0x4ade80, emissiveIntensity: 1.6 });
      H.addMesh(g, H.cyl(3.4, 3.4, 2.2, 16), navL, -48, topAt(-20) - 1, -20);
      H.addMesh(g, H.cyl(3.4, 3.4, 2.2, 16), navR, 48, topAt(-20) - 1, -20);
      return g;
    },

    /* ---- 医疗舱主体 ---- */
    cabinLower: function (H) {
      var g = new H.THREE.Group();
      var mat = shellMat(H);
      var inner = H.std({ color: 0x171d22, roughness: 0.9, metalness: 0.1 });
      g.add(new H.THREE.Mesh(H.loftGeo(SECTIONS, { part: 'lower', seam: SEAM, seg: 22 }), [mat, inner]));

      // 底部承力框与投放口
      H.addMesh(g, H.roundedBox(96, 6, 150, 3, 3), mk(H, WHITE_D, 0.5, 0.3), 0, bottomAt(0) + 3, -10);
      H.addMesh(g, H.roundedBox(64, 5, 58, 2.5, 3), mk(H, DARK, 0.55, 0.5), 0, bottomAt(-30) + 1.5, -30);
      H.addMesh(g, H.box(56, 2, 50), H.std({ color: 0x11161a, roughness: 0.8, metalness: 0.2 }), 0, bottomAt(-30) + 0.2, -30);

      // 舷窗与舱门框（s 是左右侧向符号 ±1，不要再乘半宽）
      var frame = mk(H, GRAY, 0.4, 0.6);
      [-1, 1].forEach(function (s) {
        [-46, 8].forEach(function (z) {
          var hw = halfWidthAt(z, -4);
          H.addMesh(g, H.roundedBox(2.6, 22, 34, 1.2, 3), frame, s * (hw - 1), -4, z);
          H.addMesh(g, H.roundedBox(1.4, 17, 29, 0.8, 3),
            H.std({ color: GLASS, roughness: 0.12, metalness: 0.9, emissive: 0x0d2a3a, emissiveIntensity: 0.45 }),
            s * (hw - 0.3), -4, z);
        });
      });
      // 侧面红十字
      [-1, 1].forEach(function (s) {
        var hw2 = halfWidthAt(34, -4);
        redCross(H, g, s * (hw2 - 0.6), -4, 34, 30, 2, 0, RED);
      });
      // 后舱舷梯与滑轨
      H.addMesh(g, H.roundedBox(70, 4, 26, 2, 3), mk(H, GRAY, 0.45, 0.6), 0, -22, -78);
      [-1, 1].forEach(function (s) {
        H.addMesh(g, H.box(4, 3, 60), mk(H, STEEL, 0.3, 0.9), 30 * s, -20, -50);
      });
      return g;
    },

    /* ---- 机头整流罩 ---- */
    noseCone: function (H) {
      var g = new H.THREE.Group();
      g.add(new H.THREE.Mesh(H.loftGeo([
        { z: 92, w: 78, h: 70, y: -4, n: 4.0 },
        { z: 120, w: 56, h: 52, y: -6, n: 3.4 },
        { z: 136, w: 34, h: 32, y: -8, n: 3.0 },
        { z: 146, w: 16, h: 15, y: -9, n: 2.6 }
      ], { part: 'full', seg: 20, cap: true }), shellMat(H)));
      // 皮托管与气象雷达
      H.addMesh(g, H.cylZ(0.6, 0.6, 14, 8), mk(H, STEEL, 0.3, 0.9), 0, -8, 150);
      H.addMesh(g, H.cyl(3, 2.4, 4, 14), mk(H, DARK, 0.5, 0.5), 0, -14, 140);
      // 机头绿色医疗灯
      H.addMesh(g, H.cylZ(2.4, 2.4, 2, 14),
        H.std({ color: 0x0d2a18, roughness: 0.35, metalness: 0.2, emissive: GREEN, emissiveIntensity: 1.4 }), 0, -2, 148);
      return g;
    },

    /* ---- 光电 / 生命探测转塔 ---- */
    sensorTurret: function (H) {
      var g = new H.THREE.Group();
      var hull = mk(H, DARK, 0.45, 0.6);
      H.addMesh(g, H.cyl(9, 10.5, 8, 26), hull, 0, -46, 96);
      H.addMesh(g, H.cyl(8.5, 8, 3, 26), mk(H, DARKER, 0.4, 0.7), 0, -52, 96);
      // 可见光窗
      H.addMesh(g, H.cylZ(4.6, 4.6, 3, 24),
        H.std({ color: 0x08131a, roughness: 0.06, metalness: 1, emissive: 0x14384d, emissiveIntensity: 0.6 }), -5.5, -50, 104);
      // 红外 / 生命探测窗（暖色）
      H.addMesh(g, H.cylZ(5.4, 5.4, 3, 24),
        H.std({ color: 0x140d08, roughness: 0.08, metalness: 1, emissive: 0x5a3410, emissiveIntensity: 0.7 }), 5.5, -50, 104);
      H.addMesh(g, new H.THREE.TorusGeometry(5.2, 0.9, 8, 24), mk(H, STEEL, 0.3, 0.95), -5.5, -50, 105.5, Math.PI / 2);
      return g;
    },

    /* ---- 左右医疗舱门 ---- */
    sideDoorL: function (H) { return buildDoor(H, -1); },
    sideDoorR: function (H) { return buildDoor(H, 1); },

    /* ---- 折叠担架 ---- */
    stretcher: function (H) {
      var g = new H.THREE.Group();
      var frame = mk(H, STEEL, 0.3, 0.95);
      var cloth = mk(H, 0xe8e4dc, 0.75, 0.05);
      // 担架框（两根纵杆 + 横撑）
      [-1, 1].forEach(function (s) {
        H.addMesh(g, H.cylZ(1.6, 1.6, 180, 12), frame, 16 * s, -32, -20);
      });
      [-70, -30, 10, 50].forEach(function (z) {
        H.addMesh(g, H.box(34, 1.6, 2.4), frame, 0, -32, z);
      });
      // 担架布面
      H.addMesh(g, H.roundedBox(34, 2, 176, 1, 3), cloth, 0, -30.5, -20);
      // 头枕与安全带
      H.addMesh(g, H.roundedBox(24, 4, 20, 1.4, 3), mk(H, 0xcfd6da, 0.7, 0.05), 0, -29, 50);
      [-40, -10, 20].forEach(function (z) {
        H.addMesh(g, H.box(34, 1.4, 2.6), mk(H, 0x2f3a42, 0.7, 0.1), 0, -29.6, z);
      });
      // 输液挂钩
      H.addMesh(g, H.cyl(0.9, 0.9, 26, 10), frame, 15, -18, 54);
      H.addMesh(g, H.cyl(0.9, 0.9, 8, 10), frame, 12, -6, 54, 0, 0, Math.PI / 2);
      return g;
    },

    /* ---- 生命维持模块 ---- */
    lifeSupport: function (H) {
      var g = new H.THREE.Group();
      // 氧气瓶 ×2
      [-1, 1].forEach(function (s) {
        var m = new H.THREE.Mesh(H.cyl(9, 9, 62, 20), mk(H, 0x2f6f5e, 0.35, 0.7));
        m.rotation.z = Math.PI / 2;
        m.position.set(-14 * s, -30, -66);
        g.add(m);
        H.addMesh(g, H.cyl(5, 5, 8, 16), mk(H, STEEL, 0.3, 0.9), -44 * s, -30, -66, 0, 0, Math.PI / 2);
      });
      // 呼吸机主机
      H.addMesh(g, H.roundedBox(40, 26, 34, 3, 3), mk(H, WHITE_D, 0.5, 0.25), 0, -30, -96);
      H.addMesh(g, H.roundedBox(30, 14, 2, 1.5, 3),
        H.std({ color: 0x0b2a22, roughness: 0.2, metalness: 0.4, emissive: 0x1fbf8a, emissiveIntensity: 0.75 }), 0, -26, -78.5);
      // 管路
      H.addMesh(g, H.cylZ(1.4, 1.4, 46, 10), mk(H, 0xd8dee2, 0.6, 0.1), 0, -18, -60);
      return g;
    },

    /* ---- 血液冷藏箱 ---- */
    bloodFridge: function (H) {
      var g = new H.THREE.Group();
      H.addMesh(g, H.roundedBox(46, 44, 40, 3, 3), mk(H, 0xd8dee2, 0.4, 0.35), -22, -18, -30);
      H.addMesh(g, H.roundedBox(40, 34, 2, 2, 3), mk(H, WHITE_D, 0.45, 0.3), -22, -18, -9.5);
      // 温控显示
      H.addMesh(g, H.roundedBox(18, 10, 1.4, 1, 3),
        H.std({ color: 0x0d2233, roughness: 0.15, metalness: 0.4, emissive: 0x3fb6ff, emissiveIntensity: 0.85 }), -22, -6, -9);
      // 血袋（透明红）
      for (var i = 0; i < 4; i++) {
        H.addMesh(g, H.roundedBox(9, 15, 7, 2, 3),
          H.std({ color: 0x6d1414, roughness: 0.25, metalness: 0.1, emissive: 0x8a1c1c, emissiveIntensity: 0.3 }),
          -38 + i * 10.5, -4, -30);
      }
      H.addMesh(g, H.cyl(2.4, 2.4, 12, 12), mk(H, STEEL, 0.3, 0.9), -22, -37, -30);
      return g;
    },

    /* ---- 监护 / 除颤仪 ---- */
    monitorDefib: function (H) {
      var g = new H.THREE.Group();
      // 监护仪（屏幕）
      H.addMesh(g, H.roundedBox(40, 30, 8, 2, 3), mk(H, DARK, 0.45, 0.45), 30, -22, -46);
      H.addMesh(g, H.roundedBox(34, 24, 1.2, 1, 3),
        H.std({ color: 0x061a14, roughness: 0.1, metalness: 0.3, emissive: 0x2fe08a, emissiveIntensity: 0.9 }), 30, -22, -41.6);
      // 除颤仪本体 + 电极片（整体内收，避免穿出舱壁）
      H.addMesh(g, H.roundedBox(36, 22, 30, 3, 3), mk(H, 0xd94f3d, 0.45, 0.2), 18, -18, -70);
      H.addMesh(g, H.roundedBox(20, 12, 2, 1.4, 3),
        H.std({ color: 0x1a0806, roughness: 0.2, metalness: 0.3, emissive: 0xff6a4d, emissiveIntensity: 0.7 }), 18, -14, -54.5);
      H.addMesh(g, H.cyl(7, 7, 2, 18), mk(H, 0xd8dee2, 0.5, 0.1), 10, -4, -70, Math.PI / 2);
      H.addMesh(g, H.cyl(7, 7, 2, 18), mk(H, 0xd8dee2, 0.5, 0.1), 26, -4, -70, Math.PI / 2);
      return g;
    },

    /* ---- 药品与耗材柜 ---- */
    medicineRack: function (H) {
      var g = new H.THREE.Group();
      H.addMesh(g, H.roundedBox(28, 60, 44, 3, 3), mk(H, WHITE_D, 0.55, 0.2), -30, 0, 54);
      // 抽屉与标签
      for (var i = 0; i < 4; i++) {
        H.addMesh(g, H.roundedBox(23, 12, 2, 1.2, 3), mk(H, 0xc8d0d6, 0.5, 0.25), -30, -12 + i * 13, 76.5);
        H.addMesh(g, H.box(14, 2.4, 0.8), mk(H, i % 2 ? GREEN : RED, 0.5, 0.1), -30, -8 + i * 13, 77.8);
      }
      // 顶部耗材箱
      H.addMesh(g, H.roundedBox(24, 12, 32, 2, 3), mk(H, 0xb9c2c8, 0.55, 0.25), -30, 22, 54);
      redCross(H, g, -30, 22, 70.4, 11, 1.2, 0, GREEN);
      return g;
    },

    /* ---- 绞盘吊救装置 ---- */
    winchHoist: function (H) {
      var g = new H.THREE.Group();
      var steel = mk(H, STEEL, 0.3, 0.95);
      // 绞盘鼓 + 支架 + 吊臂
      H.addMesh(g, H.cyl(9, 9, 34, 20), mk(H, DARK, 0.45, 0.6), 0, 4, -56, 0, 0, Math.PI / 2);
      [-1, 1].forEach(function (s) {
        H.addMesh(g, H.roundedBox(4, 24, 20, 1.5, 3), mk(H, DARK, 0.5, 0.5), 20 * s, 0, -56);
      });
      H.addMesh(g, H.cyl(2.2, 2.2, 46, 12), steel, 0, 22, -50, Math.PI / 2);
      H.addMesh(g, H.cyl(1.6, 1.6, 30, 10), steel, 0, 12, -28, 0.5);
      // 吊钩与吊带（折叠状态）
      H.addMesh(g, new H.THREE.TorusGeometry(4, 1.2, 8, 18), steel, 0, -4, -20);
      H.addMesh(g, H.roundedBox(26, 3, 40, 1.2, 3), mk(H, 0x2f3a42, 0.7, 0.1), 0, -8, -6);
      // 导向轮
      H.addMesh(g, H.cyl(3.4, 3.4, 3, 16), steel, 0, 22, -74, 0, 0, Math.PI / 2);
      return g;
    },

    /* ---- 可抛投医疗物资舱 ---- */
    supplyPod: function (H) {
      var g = new H.THREE.Group();
      var y = -62;
      H.addMesh(g, H.roundedBox(74, 44, 92, 6, 4), mk(H, WHITE, 0.45, 0.25), 0, y, -30);
      // 投放伞包与开伞环
      H.addMesh(g, H.roundedBox(60, 14, 74, 5, 3), mk(H, 0xd2dade, 0.5, 0.2), 0, y + 28, -30);
      H.addMesh(g, new H.THREE.TorusGeometry(11, 1.6, 8, 20), mk(H, STEEL, 0.3, 0.95), 0, y + 37, -30, Math.PI / 2);
      // 红十字与标识
      redCross(H, g, 0, y, 16.4, 34, 2, 0, RED);
      [-1, 1].forEach(function (s) {
        redCross(H, g, 37.4 * s, y, -30, 30, 2, Math.PI / 2, RED);
      });
      // 缓冲底垫与锁扣
      H.addMesh(g, H.roundedBox(70, 8, 88, 3, 3), mk(H, 0x2f3a42, 0.7, 0.15), 0, y - 24, -30);
      [-1, 1].forEach(function (s) {
        H.addMesh(g, H.roundedBox(6, 8, 6, 1.5, 3), mk(H, STEEL, 0.3, 0.9), 26 * s, y + 24, -30);
      });
      // 物资明细条
      H.addMesh(g, H.box(40, 3, 1), mk(H, GREEN, 0.5, 0.1), 0, y - 8, 16.2);
      return g;
    },

    /* ---- 大容量电池组 ---- */
    batteryPack: function (H) {
      var g = new H.THREE.Group();
      H.addMesh(g, H.roundedBox(48, 34, 66, 3, 3), mk(H, 0x333c44, 0.5, 0.35), 0, 30, -34);
      H.addMesh(g, H.roundedBox(40, 3, 56, 1.5, 3), mk(H, 0x2a3238, 0.5, 0.3), 0, 48, -34);
      // 电量灯与高压触点
      for (var i = 0; i < 5; i++) {
        H.addMesh(g, H.box(5, 1.6, 2),
          H.std({ color: 0x0d1f12, roughness: 0.4, metalness: 0.2, emissive: 0x6ee23a, emissiveIntensity: 1.1 }),
          -16 + i * 8, 47, -62);
      }
      [-1, 1].forEach(function (s) {
        H.addMesh(g, H.box(5, 5, 5), mk(H, 0xd8b64a, 0.3, 1), 14 * s, 14, -4);
      });
      H.addMesh(g, H.cyl(4, 4, 60, 12), mk(H, DARK, 0.5, 0.5), 26, 30, -34, Math.PI / 2);
      return g;
    },

    /* ---- 飞控 / 导航计算机 ---- */
    flightCtrl: function (H) {
      var g = new H.THREE.Group();
      H.addMesh(g, H.box(56, 4, 48), H.std({ map: H.TEX.pcb, roughness: 0.6, metalness: 0.28 }), 0, 40, 22);
      var shield = mk(H, 0x9aa4ac, 0.3, 0.95);
      H.addMesh(g, H.box(26, 9, 24), shield, -14, 46, 22);
      H.addMesh(g, H.box(18, 7, 18), mk(H, 0x161a14, 0.45, 0.5), 14, 45, 28);
      H.addMesh(g, H.box(12, 6, 12), mk(H, 0x161a14, 0.45, 0.5), 14, 44, 12);
      // 三余度 IMU
      [-14, 0, 14].forEach(function (x) {
        H.addMesh(g, H.box(9, 5, 9), mk(H, 0xc8ced4, 0.35, 0.9), x, 46, 6);
      });
      return g;
    },

    /* ---- 定位与卫通 ---- */
    gnssUnit: function (H) {
      var g = new H.THREE.Group();
      H.addMesh(g, H.roundedBox(34, 12, 34, 3, 3), mk(H, 0xd8dee2, 0.45, 0.2), 0, 54, 46);
      // 卫通天线的相控阵面
      H.addMesh(g, H.roundedBox(30, 3, 30, 1.5, 3), mk(H, 0x9aa4ac, 0.35, 0.7), 0, 61, 46);
      H.addMesh(g, H.cyl(6, 7, 5, 16), mk(H, 0x2a3238, 0.5, 0.5), 0, 50, 46);
      // 双天线杆
      [-1, 1].forEach(function (s) {
        H.addMesh(g, H.cyl(1.6, 1.6, 40, 8), mk(H, 0x2a3238, 0.5, 0.4), 22 * s, 48, 78, 0, 0, 0.22 * s);
        H.addMesh(g, H.cyl(0.8, 0.8, 34, 6), mk(H, 0xc9a227, 0.5, 0.6), 20 * s, 48, 78, 0, 0, 0.22 * s);
      });
      return g;
    },

    /* ---- 医疗警示灯带 ---- */
    beaconLights: function (H) {
      var g = new H.THREE.Group();
      var redGlow = H.std({ color: 0x2a0d0a, roughness: 0.32, metalness: 0.2, emissive: RED_L, emissiveIntensity: 1.9 });
      var whiteGlow = H.std({ color: 0x2a2f34, roughness: 0.32, metalness: 0.2, emissive: 0xffffff, emissiveIntensity: 1.5 });
      // 两侧灯带
      [-1, 1].forEach(function (s) {
        for (var i = 0; i < 5; i++) {
          var z = -60 + i * 30;
          var hw = halfWidthAt(z, SEAM + 2);
          H.addMesh(g, H.cyl(2, 2, 1.6, 12), i % 2 ? whiteGlow : redGlow,
            s * (hw - 0.6), SEAM + 4, z, 0, 0, Math.PI / 2);
        }
      });
      // 顶部旋转信标
      H.addMesh(g, H.cyl(6, 7, 6, 18), mk(H, DARK, 0.5, 0.5), 0, 58, -6);
      H.addMesh(g, new H.THREE.SphereGeometry(5.4, 18, 14), redGlow, 0, 64, -6);
      H.addMesh(g, new H.THREE.TorusGeometry(6.6, 1, 8, 20), mk(H, STEEL, 0.3, 0.9), 0, 62, -6, Math.PI / 2);
      return g;
    },

    /* ---- 六支机臂 ---- */
    armFL: function (H) { return buildArm(H, 35, 1); },
    armFR: function (H) { return buildArm(H, 35, -1); },
    armML: function (H) { return buildArm(H, 90, 1); },
    armMR: function (H) { return buildArm(H, 90, -1); },
    armRL: function (H) { return buildArm(H, 145, 1); },
    armRR: function (H) { return buildArm(H, 145, -1); },

    /* ---- 六支桨 ---- */
    propFL: function (H) { return buildProp(H, 35, 1, 0); },
    propFR: function (H) { return buildProp(H, 35, -1, Math.PI / 3); },
    propML: function (H) { return buildProp(H, 90, 1, Math.PI / 6); },
    propMR: function (H) { return buildProp(H, 90, -1, Math.PI / 2); },
    propRL: function (H) { return buildProp(H, 145, 1, Math.PI / 4); },
    propRR: function (H) { return buildProp(H, 145, -1, Math.PI / 5); },

    /* ---- 起落架（滑橇 + 轮） ---- */
    landingGear: function (H) {
      var g = new H.THREE.Group();
      var strut = mk(H, DARK, 0.5, 0.55);
      var steel = mk(H, STEEL, 0.3, 0.9);
      [-1, 1].forEach(function (s) {
        // 四条支柱
        [-56, 42].forEach(function (z) {
          H.addMesh(g, H.roundedBox(5, 52, 7, 2, 3), strut, 40 * s, -48, z);
          H.addMesh(g, H.cyl(2.6, 2.6, 8, 12), steel, 40 * s, -70, z, 0, 0, Math.PI / 2);
        });
        // 滑橇纵梁
        H.addMesh(g, H.roundedBox(7, 6, 118, 2.5, 3), strut, 40 * s, -72, -7);
        // 前轮 + 后轮
        [-56, 42].forEach(function (z) {
          var w = new H.THREE.Mesh(H.cyl(9, 9, 6, 20), mk(H, 0x1c2228, 0.7, 0.15));
          w.rotation.z = Math.PI / 2;
          w.position.set(40 * s, -72, z);
          g.add(w);
          H.addMesh(g, H.cyl(3, 3, 7, 12), steel, 40 * s, -72, z, 0, 0, Math.PI / 2);
        });
        // 斜撑
        H.addMesh(g, H.roundedBox(4, 4, 44, 1.5, 3), strut, 40 * s, -58, -7, 1.1);
      });
      // 中央缓冲脚
      H.addMesh(g, H.roundedBox(70, 6, 20, 2, 3), mk(H, 0x2f3a42, 0.7, 0.1), 0, -70, -16);
      return g;
    }
  };

  /* ---------- 舱门 ---------- */
  function buildDoor(H, side) {
    var g = new H.THREE.Group();
    var hw = 55;
    // 门板（带舷窗与把手）
    H.addMesh(g, H.roundedBox(3, 74, 78, 2, 3), shellMat(H), side * (hw + 0.6), -6, 10);
    H.addMesh(g, H.roundedBox(1.4, 34, 54, 1.4, 3),
      H.std({ color: GLASS, roughness: 0.12, metalness: 0.9, emissive: 0x0d2a3a, emissiveIntensity: 0.4 }),
      side * (hw + 2), -2, 10);
    H.addMesh(g, H.cyl(1.6, 1.6, 12, 10), mk(H, STEEL, 0.3, 0.9), side * (hw + 3), -34, 42);
    // 滑轨与铰链
    H.addMesh(g, H.roundedBox(4, 4, 82, 1.5, 3), mk(H, GRAY, 0.4, 0.6), side * (hw + 2.4), 34, 10);
    [-24, 44].forEach(function (z) {
      H.addMesh(g, H.cyl(2.4, 2.4, 8, 12), mk(H, DARK, 0.5, 0.5), side * (hw + 2), -30, z, 0, 0, Math.PI / 2);
    });
    // 门上红十字
    redCross(H, g, side * (hw + 2.6), 14, 10, 26, 1.6, Math.PI / 2, RED);
    return g;
  }

  /* ---------- 机臂 ---------- */
  function buildArm(H, aDeg, sign) {
    var g = new H.THREE.Group();
    var root = armRoot(aDeg, sign);
    var motor = motorPos(aDeg, sign);
    var span = new H.THREE.Vector3().subVectors(motor, root);
    var len = span.length();

    // 臂梁（放样，根部粗、端部细）
    var arm = new H.THREE.Mesh(H.loftGeo([
      { z: -len / 2, w: 22, h: 17, y: 0, n: 4.2 },
      { z: -len * 0.2, w: 19, h: 14.5, y: 0.4, n: 3.6 },
      { z: len * 0.2, w: 15, h: 12, y: 0.8, n: 3.0 },
      { z: len * 0.44, w: 13, h: 11, y: 1.1, n: 2.8 },
      { z: len / 2, w: 12, h: 10, y: 1.4, n: 2.6 }
    ], { part: 'full', seg: 16 }), mk(H, WHITE_D, 0.45, 0.3));
    H.placeAlong(arm, root, motor);
    g.add(arm);

    // 臂上走线管
    var tube = new H.THREE.Mesh(H.cyl(2.4, 2.4, len * 0.72, 10), mk(H, DARKER, 0.6, 0.3));
    H.placeAlong(tube, root, motor);
    tube.position.y += 11;
    g.add(tube);

    // 根部铰链
    H.addMesh(g, H.cyl(9, 9, 22, 20), mk(H, DARK, 0.5, 0.5), root.x, root.y, root.z);
    H.addMesh(g, H.cyl(3.6, 3.6, 24, 14), mk(H, STEEL, 0.3, 0.9), root.x, root.y, root.z);
    H.addMesh(g, H.roundedBox(20, 16, 26, 3, 3), mk(H, GRAY, 0.45, 0.5), root.x, root.y + 2, root.z);

    // 电机与桨夹
    var metal = mk(H, STEEL, 0.28, 0.95);
    H.addMesh(g, H.cyl(11, 12, 6, 26), mk(H, DARK, 0.5, 0.5), motor.x, motor.y - 6, motor.z);
    H.addMesh(g, H.cyl(9.5, 10.5, 18, 26), metal, motor.x, motor.y + 4, motor.z);
    for (var i = 0; i < 8; i++) {
      var ang = i / 8 * Math.PI * 2;
      H.addMesh(g, H.box(1.6, 16, 1.6), mk(H, DARKER, 0.5, 0.5),
        motor.x + Math.cos(ang) * 9.6, motor.y + 4, motor.z + Math.sin(ang) * 9.6);
    }
    H.addMesh(g, H.cyl(10, 10, 2, 26), mk(H, GRAY, 0.4, 0.7), motor.x, motor.y + 13, motor.z);
    H.addMesh(g, H.cyl(3, 3, 8, 14), metal, motor.x, motor.y + 18, motor.z);
    H.addMesh(g, H.cyl(5.4, 5.4, 2.4, 20), mk(H, DARK, 0.45, 0.6), motor.x, motor.y + 23, motor.z);
    return g;
  }

  /* ---------- 桨（三叶，重载） ---------- */
  function buildProp(H, aDeg, sign, phase) {
    var g = new H.THREE.Group();
    var m = motorPos(aDeg, sign);
    var cy = m.y + 25;
    H.addMesh(g, H.cyl(5.6, 6.2, 4, 20), mk(H, GRAY, 0.4, 0.7), m.x, cy, m.z);
    H.addMesh(g, H.cyl(7.5, 6.4, 1.6, 20), mk(H, 0x2f3a42, 0.45, 0.6), m.x, cy + 2.6, m.z);
    var bladeMat = mk(H, 0x22282e, 0.45, 0.35);
    var tipMat = mk(H, 0xe9eef2, 0.5, 0.2);
    for (var k = 0; k < 3; k++) {
      var pivot = new H.THREE.Group();
      pivot.position.set(m.x, cy, m.z);
      pivot.rotation.y = phase + k * Math.PI * 2 / 3;
      var blade = new H.THREE.Mesh(H.bladeGeo(45, 3.4, 7.4, 4.2, 0.9, -0.0022), bladeMat);
      blade.rotation.x = 0.22;
      blade.position.y = 1.4;
      pivot.add(blade);
      var tip = new H.THREE.Mesh(H.box(5.5, 0.6, 6.4), tipMat);
      tip.position.set(41, 3.6, -2.4);
      tip.rotation.x = 0.22;
      pivot.add(tip);
      g.add(pivot);
    }
    return g;
  }

  /* =======================================================================
     部件清单
     ======================================================================= */
  function P(o) { return o; }

  window.DJIModelMedical = {
    title: 'MEDEVAC-1 大型医疗救援无人机',
    subtitle: 'Large Medical Evacuation & Resupply UAV',
    intro: '点击模型中的任意部件，或点击左侧「部件清单」即可自动拆解。' +
      '生命探测雷达会持续搜索地面伤员并给出分诊优先级，锁定后可选择投送医疗物资或绞盘吊救后送；' +
      '也可以直接点击伤员手动指定救治对象。',
    groups: ['医疗舱体', '生命支持', '救援与投送', '动力与能源', '航电与导航', '感知与照明'],
    scene: {
      rootScale: 0.10, floorY: -9.2, theta: 0.62, phi: 1.03, radius: 46,
      zoomBias: 9, phiBias: 0.14, minRadius: 22, maxRadius: 105,
      fog: 0.006, gridSize: 300, gridDiv: 120, ringR: 17, shadowR: 40,
      keyLight: [16, 26, 20], targetY: 1.5
    },
    spec: [
      ['机型', '大型六旋翼医疗救援无人机（MEDEVAC / 医疗投送）'],
      ['展开尺寸', '约 300 × 240 × 130 cm（含桨与起落架）'],
      ['空机重量', '约 78 kg'],
      ['最大起飞重量', '约 240 kg'],
      ['有效载荷', '伤员 1 名（约 100 kg）或医疗物资 120 kg'],
      ['医疗舱', '增压恒温舱，可容纳 1 副担架 + 2 名医护设备位'],
      ['生命支持', '氧气 2 × 12 L、呼吸机、监护除颤、血液冷藏 4 ℃'],
      ['救援装置', '35 m 绞盘吊救，最大吊重 150 kg'],
      ['投送装置', '腹部可抛投物资舱，带缓冲底垫与伞包'],
      ['动力', '6 × 无刷电机 + 三叶重载桨'],
      ['能源', '高压锂电 14S 58.8 V 60 Ah，支持双电池热备'],
      ['续航', '满载 42 分钟 / 投送构型 68 分钟'],
      ['数据链', '双频图传 + 卫通，最远 60 km'],
      ['医疗数据链', '伤员生命体征实时回传，支持远程会诊'],
      ['感知', '光电 + 红外生命探测 + 全向避障雷达'],
      ['巡航速度', '110 km/h，最大 160 km/h'],
      ['抗风', '15 m/s'],
      ['作业半径', '30 km（医疗投送）/ 12 km（伤员后送）']
    ],
    builder: builder,
    constants: { SECTIONS: SECTIONS, SEAM: SEAM, MOTOR_R: MOTOR_R, FOOT_Y: FOOT_Y, SPAN: SPAN,
      topAt: topAt, bottomAt: bottomAt, halfWidthAt: halfWidthAt, motorPos: motorPos, armRoot: armRoot },

    parts: [
      P({ id: 'cabinUpper', name: '医疗舱上盖', en: 'Cabin Upper Shell',
        tag: '增压恒温 · 医疗标识', color: '#8ef0c0', dir: [0, 1, 0.05], dist: 90,
        role: '增压恒温医疗舱的上半壳，承担结构承力与设备安装，顶部为高可视度医疗标识与航行灯。',
        specs: [['舱内环境', '增压、恒温 22 ± 2 ℃'], ['舱门', '双侧滑门 + 后舷梯'],
          ['顶部标识', '红十字（夜间自发光标）'], ['承力', '复合材料夹层结构']] }),

      P({ id: 'cabinLower', name: '医疗舱主体', en: 'Cabin Lower Shell',
        tag: '担架舱 · 双侧舷窗', color: '#7fe0b0', dir: [0, -1, 0.05], dist: 60,
        role: '整机结构主体：担架滑轨、舷窗、后舱舷梯、腹部投放口与承力框全部安装在此。',
        specs: [['担架位', '1 副（滑轨推入式）'], ['舷窗', '4 处医疗舱观察窗'],
          ['投放口', '腹部开口 56 × 50 cm'], ['舱内照明', '可调白光 / 夜间红光照护']] }),

      P({ id: 'noseCone', name: '机头整流罩', en: 'Nose Fairing',
        tag: '气象雷达 · 皮托管', color: '#9ae8c8', dir: [0, -0.2, 1], dist: 95,
        role: '机头气动整流罩，内置气象雷达，为救援航线规避危险天气。',
        specs: [['雷达', '机头气象雷达'], ['空速', '皮托管 + 静压孔'],
          ['灯光', '绿色医疗示廓灯'], ['结构', '快拆检修盖板']] }),

      P({ id: 'sensorTurret', name: '光电 / 生命探测转塔', en: 'EO/IR & Life Detection Turret',
        tag: '可见光 + 红外生命探测', color: '#7fd8ff', dir: [0, -1, 0.6], dist: 55,
        role: '救援核心传感器：可见光寻找伤员，红外通道通过体温在夜间与烟尘中定位生命体。',
        specs: [['通道', '可见光 + 红外热成像'], ['生命探测', '体温识别，探测距离约 800 m'],
          ['测距', '激光测距 2 km'], ['稳定', '两轴增稳云台']] }),

      P({ id: 'sideDoorL', name: '左侧医疗舱门', en: 'Left Medical Door',
        tag: '滑门 · 快速上担架', color: '#a8f0d0', dir: [-1, 0.1, 0], dist: 70,
        role: '左侧滑门，救护时整扇侧滑打开，便于在狭小场地快速推入担架。',
        specs: [['形式', '上滑轨电动滑门'], ['净开口', '74 × 78 cm'], ['标识', '外侧红十字'],
          ['附件', '内藏式踏板与氧气接口']] }),

      P({ id: 'sideDoorR', name: '右侧医疗舱门', en: 'Right Medical Door',
        tag: '滑门 · 医护进出', color: '#a8f0d0', dir: [1, 0.1, 0], dist: 70,
        role: '右侧滑门，医护进出与设备装卸通道，与左侧门形成对流换气条件。',
        specs: [['形式', '上滑轨电动滑门'], ['净开口', '74 × 78 cm'], ['标识', '外侧红十字'],
          ['附件', '折叠踏板与担架滚轮']] }),

      P({ id: 'stretcher', name: '折叠担架', en: 'Folding Stretcher',
        tag: '快拆滑轨 · 1 副', color: '#ffd9a0', dir: [0, -0.6, -1], dist: 85,
        role: '专用折叠担架，沿舱内滑轨推入即可锁定，是伤员后送的核心装载单元。',
        specs: [['尺寸', '180 × 34 cm'], ['锁定', '滑轨卡扣，单人可操作'],
          ['附件', '头枕、三点式固定带、输液挂钩'], ['自重', '约 7 kg']] }),

      P({ id: 'lifeSupport', name: '生命维持模块', en: 'Life Support Module',
        tag: '氧气 2 × 12 L · 呼吸机', color: '#5ee0c0', dir: [0, -0.5, -1], dist: 80,
        role: '维持重伤员途中生命体征：氧气供给、机械通气与管路，是后送途中不可中断的一环。',
        specs: [['氧气', '2 × 12 L 高压瓶'], ['呼吸机', '容量控制 / 压力支持模式'],
          ['续航', '满载通气 ≥ 90 分钟'], ['监测', '气道压力与血氧回传']] }),

      P({ id: 'bloodFridge', name: '血液冷藏箱', en: 'Blood Refrigerator',
        tag: '4 ℃ 恒温 · 血袋 8 单位', color: '#ff9a8a', dir: [-0.6, -0.5, -0.4], dist: 62,
        role: '4 ℃ 恒温冷藏箱，途中可输血，使伤员在后送途中就能开始抗休克治疗。',
        specs: [['温度', '4 ± 1 ℃ 恒温'], ['容量', '红细胞 8 单位 + 血浆 6 单位'],
          ['报警', '超温声光 + 遥测报警'], ['供电', '主电 + 备用电池 4 h']] }),

      P({ id: 'monitorDefib', name: '监护 / 除颤仪', en: 'Monitor & Defibrillator',
        tag: '心电监护 · 除颤', color: '#7fe0ff', dir: [0.6, -0.4, -0.6], dist: 60,
        role: '持续心电、血压、血氧监护，必要时实施除颤，并把波形实时回传给后方医疗组。',
        specs: [['监护', '心电 / 血压 / 血氧 / 体温'], ['除颤', '双相波，1–200 J'],
          ['回传', '生命体征波形实时回传'], ['除颤电极', '成人与儿童电极片常备']] }),

      P({ id: 'medicineRack', name: '药品与耗材柜', en: 'Medicine & Consumables Rack',
        tag: '4 抽屉 · 分类标识', color: '#9de8b8', dir: [-0.7, 0.3, 0.6], dist: 58,
        role: '分类收纳急救药品与耗材，抽屉带夜光标色，戴手套也能快速取用。',
        specs: [['抽屉', '4 层分类（止血 / 镇痛 / 复苏 / 耗材）'],
          ['固定', '弹力压条防颠簸散落'], ['标识', '夜光标签 + 电子清单'],
          ['清单同步', '取用即记录并回传']] }),

      P({ id: 'winchHoist', name: '绞盘吊救装置', en: 'Winch & Hoist',
        tag: '35 m · 吊重 150 kg', color: '#ffc95e', dir: [0, 1, -0.6], dist: 72,
        role: '在无法降落的陡坡、水面或废墟上方悬停吊救，把伤员或救援人员吊入舱内。',
        specs: [['绳长', '35 m'], ['最大吊重', '150 kg'], ['吊放速度', '0–1.2 m/s 可调'],
          ['安全', '过载保护 + 断绳制动'], ['附件', '吊篮 / 吊带 / 救援三角带']] }),

      P({ id: 'supplyPod', name: '可抛投医疗物资舱', en: 'Air-drop Medical Pod',
        tag: '120 kg · 带缓冲底垫', color: '#ffb0a0', dir: [0, -1, -0.3], dist: 78,
        role: '腹部可抛投物资舱：在伤员无法移动时把血液、药品与血浆直接投到身边，落点由红外标记确认。',
        specs: [['载荷', '医疗物资 120 kg'], ['投送高度', '建议 ≤ 30 m（带伞包）'],
          ['缓冲', '底部缓冲垫 + 伞包'], ['定位', '落点红外标记 + 落地信标']] }),

      P({ id: 'batteryPack', name: '大容量电池组', en: 'High-Voltage Battery Pack',
        tag: '14S 58.8 V · 60 Ah', color: '#facc4a', dir: [0.2, 0.8, -0.6], dist: 66,
        role: '高压大容量电池组，支撑满载伤员后送与长距离医疗投送，支持双电池热备切换。',
        specs: [['规格', '14S 58.8 V / 60 Ah'], ['能量', '约 3.5 kWh'],
          ['热备', '双电池并供，单组故障不断电'], ['充电', '45 分钟充至 90%']] }),

      P({ id: 'flightCtrl', name: '飞控 / 导航计算机', en: 'Flight Control Computer',
        tag: '三余度 IMU · 自主航线', color: '#4ade80', dir: [0.3, 1, 0.2], dist: 52,
        role: '飞行控制与导航核心：自动起飞、航线飞行、悬停吊救与自主返航，全程可用一键模式完成。',
        specs: [['冗余', '三余度 IMU + 双气压计'], ['模式', '自主航线 / 悬停吊救 / 一键返航'],
          ['限高限速', '可设医疗任务包线'], ['应急', '单电机失效可控降落']] }),

      P({ id: 'gnssUnit', name: '定位与卫通', en: 'GNSS & Satellite Link',
        tag: 'RTK 厘米级 · 卫通', color: '#a78bfa', dir: [0.2, 1, 0.6], dist: 56,
        role: '提供厘米级定位与卫星通信，在无地面网络的山区与灾区仍能保持医疗数据链。',
        specs: [['定位', 'RTK 厘米级（GPS + BeiDou + Galileo）'],
          ['卫通', '相控阵天线，链路自动切换'], ['用途', '航线、落点、生命体征回传'],
          ['失效保护', '失联自动返航 / 悬停等待']] }),

      P({ id: 'beaconLights', name: '医疗警示灯带', en: 'Medical Beacon Lighting',
        tag: '红白频闪 + 旋转信标', color: '#ff8a7a', dir: [0.4, 0.6, 0.4], dist: 62,
        role: '夜间与低能见度下的识别与警戒：红白频闪灯带让地面人员远距离识别救援机，并提示降落区风险。',
        specs: [['灯带', '双侧红白交替频闪'], ['顶部', '红色旋转信标'],
          ['可见距离', '夜间 ≥ 3 km'], ['控制', '随任务模式自动切换亮度']] }),

      P({ id: 'armFL', name: '左前机臂', en: 'Front Left Arm',
        tag: '折叠臂 · 重载电机', color: '#cfe8ff', dir: [-1, 0.3, 0.7], dist: 105,
        role: '六旋翼的前左动力支臂，根部铰链可向后折叠以适配标准集装箱运输。',
        specs: [['布局', '六旋翼前左（35°）'], ['结构', '碳纤维折叠臂 + 铰链锁定'],
          ['电机', '无刷重载电机'], ['走线', '臂上走线管，防水接插件']] }),

      P({ id: 'armFR', name: '右前机臂', en: 'Front Right Arm',
        tag: '折叠臂 · 重载电机', color: '#cfe8ff', dir: [1, 0.3, 0.7], dist: 105,
        role: '与左前臂对称，六旋翼冗余布局保证单臂失效后仍可继续飞行与返航。',
        specs: [['布局', '六旋翼前右（－35°）'], ['冗余', '单臂失效可继续飞行'],
          ['电机', '无刷重载电机'], ['维护', '单臂可整体快拆更换']] }),

      P({ id: 'armML', name: '左中机臂', en: 'Mid Left Arm',
        tag: '折叠臂 · 横向支臂', color: '#d8ecff', dir: [-1, 0.3, 0], dist: 105,
        role: '中部横向支臂，承担最大升力份额，是吊救悬停时保持稳定的关键。',
        specs: [['布局', '六旋翼中左（90°）'], ['结构', '碳纤维折叠臂'],
          ['作用', '悬停吊救主要升力来源'], ['附件', '臂端航灯']] }),

      P({ id: 'armMR', name: '右中机臂', en: 'Mid Right Arm',
        tag: '折叠臂 · 横向支臂', color: '#d8ecff', dir: [1, 0.3, 0], dist: 105,
        role: '与左中臂对称，共同构成横向升力面，抵抗吊救时的偏载力矩。',
        specs: [['布局', '六旋翼中右（－90°）'], ['结构', '碳纤维折叠臂'],
          ['作用', '抵抗吊救偏载'], ['附件', '臂端航灯']] }),

      P({ id: 'armRL', name: '左后机臂', en: 'Rear Left Arm',
        tag: '折叠臂 · 加强撑', color: '#cfe8ff', dir: [-1, 0.3, -0.7], dist: 105,
        role: '后左动力支臂，带加强撑以承受投放作业时的载荷突变。',
        specs: [['布局', '六旋翼后左（145°）'], ['结构', '折叠臂 + 斜撑加强'],
          ['作用', '俯仰与偏航控制力矩'], ['附件', '后航行灯']] }),

      P({ id: 'armRR', name: '右后机臂', en: 'Rear Right Arm',
        tag: '折叠臂 · 加强撑', color: '#cfe8ff', dir: [1, 0.3, -0.7], dist: 105,
        role: '六旋翼的最后一路动力，与前臂共同构成稳定可靠的动力冗余。',
        specs: [['布局', '六旋翼后右（－145°）'], ['结构', '折叠臂 + 斜撑加强'],
          ['冗余', '单臂失效仍可返航'], ['附件', '后航行灯']] }),

      P({ id: 'propFL', name: '左前三叶桨', en: 'Front Left Propeller',
        pivot: null, spin: { speed: 15, dir: 1 }, spinAt: propSpinAt(35, 1), rotor: PROP_R, rotorY: -1, tag: '三叶重载 · 快拆', color: '#f0a8d0', dir: [-0.5, 1, 0.4], dist: 45,
        role: '三叶重载桨把电机扭矩转化为升力，桨尖白色标记用于地面人员识别旋翼范围。',
        specs: [['形式', '三叶重载桨'], ['直径', '约 90 cm'], ['特点', '低噪桨型 + 桨尖警示色'],
          ['维护', '快拆式，单支可换']] }),

      P({ id: 'propFR', name: '右前三叶桨', en: 'Front Right Propeller',
        pivot: null, spin: { speed: 15, dir: -1 }, spinAt: propSpinAt(35, -1), rotor: PROP_R, rotorY: -1, tag: '三叶重载 · 快拆', color: '#f0a8d0', dir: [0.5, 1, 0.4], dist: 45,
        role: '与左前桨反向旋转抵消反扭矩，保持吊救悬停时的航向稳定。',
        specs: [['形式', '三叶重载桨'], ['旋向', '与左前桨反向'], ['直径', '约 90 cm'],
          ['维护', '快拆式，单支可换']] }),

      P({ id: 'propML', name: '左中三叶桨', en: 'Mid Left Propeller',
        pivot: null, spin: { speed: 15, dir: -1 }, spinAt: propSpinAt(90, 1), rotor: PROP_R, rotorY: -1, tag: '三叶重载 · 快拆', color: '#f0a8d0', dir: [-0.5, 1, 0], dist: 45,
        role: '中部升力单元，吊救悬停时输出最大推力，直接决定吊重能力。',
        specs: [['形式', '三叶重载桨'], ['直径', '约 90 cm'], ['作用', '悬停吊重主升力'],
          ['维护', '快拆式']] }),

      P({ id: 'propMR', name: '右中三叶桨', en: 'Mid Right Propeller',
        pivot: null, spin: { speed: 15, dir: 1 }, spinAt: propSpinAt(90, -1), rotor: PROP_R, rotorY: -1, tag: '三叶重载 · 快拆', color: '#f0a8d0', dir: [0.5, 1, 0], dist: 45,
        role: '与左中桨配平，保证偏载吊救时姿态可控。',
        specs: [['形式', '三叶重载桨'], ['旋向', '与左中桨反向'], ['直径', '约 90 cm'],
          ['维护', '快拆式']] }),

      P({ id: 'propRL', name: '左后三叶桨', en: 'Rear Left Propeller',
        pivot: null, spin: { speed: 15, dir: 1 }, spinAt: propSpinAt(145, 1), rotor: PROP_R, rotorY: -1, tag: '三叶重载 · 快拆', color: '#f0a8d0', dir: [-0.5, 1, -0.4], dist: 45,
        role: '后部动力单元，与其余五支桨分配俯仰、横滚与偏航力矩。',
        specs: [['形式', '三叶重载桨'], ['直径', '约 90 cm'], ['特点', '低噪桨型'],
          ['维护', '快拆式']] }),

      P({ id: 'propRR', name: '右后三叶桨', en: 'Rear Right Propeller',
        pivot: null, spin: { speed: 15, dir: -1 }, spinAt: propSpinAt(145, -1), rotor: PROP_R, rotorY: -1, tag: '三叶重载 · 快拆', color: '#f0a8d0', dir: [0.5, 1, -0.4], dist: 45,
        role: '六旋翼的最后一路升力，与其他桨共同保证单点失效后的可控性。',
        specs: [['形式', '三叶重载桨'], ['旋向', '与左后桨反向'], ['直径', '约 90 cm'],
          ['维护', '快拆式']] }),

      P({ id: 'landingGear', name: '起落架', en: 'Landing Gear',
        tag: '滑橇 + 四轮 · 缓冲', color: '#cbd5e1', dir: [0, -1, -0.2], dist: 88,
        role: '滑橇式起落架带四只缓冲轮：既能在地面推行装卸担架，也能在草地与碎石地稳定起降，并为腹部投放口留出净空。',
        specs: [['形式', '双滑橇 + 四轮'], ['离地净空', '约 75 cm（可容纳投放舱）'],
          ['缓冲', '弹性支柱 + 橡胶轮'], ['推行', '可安装牵引杆地面转移伤员']] })
    ]
  };

  /* 自注册到页面（引擎按此装配，保持引擎与机型无关） */
  window.DJIPage = window.DJIPage || {};
  window.DJIPage.model = window.DJIModelMedical;
})();