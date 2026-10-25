/* ============================================================================
 * DJI FELON ATTACK · 敌方目标几何模块 (enemies.js)
 * ----------------------------------------------------------------------------
 * 纯几何模块：不依赖任何外部资源文件，全部网格由代码生成。
 *
 * 约定
 *   · 单位：cm；y 轴向上；载具底盘（履带 / 轮胎最低点）落在 y = 0
 *   · 朝向：+Z 为车头方向（弹药类弹体同样沿 +Z 拉长）
 *   · 涂装：沙褐 / 暗棕 / 深灰绿 —— 蓝、青、紫一律留给友军
 *   · 每个构建函数签名统一为 fn(H)，H 为引擎注入的辅助集合：
 *       { THREE, std, box, cyl, cylZ, roundedBox, loftGeo, addMesh, placeAlong, makeTex }
 *   · 所有 THREE 用法都写在函数体内：模块顶层绝不出现 THREE，
 *     否则 Three.js 尚未动态加载完就会 ReferenceError 导致白屏
 *   · 返回值统一为 THREE.Group，并在 userData.size 写入包围盒尺寸（cm）
 *   · ES5 风格：var + function，无箭头函数 / let / const / 模板字符串 / class
 * ==========================================================================*/
(function () {
  'use strict';

  /* =======================================================================
     0. 通用几何工具
     ======================================================================= */

  /**
   * 收尾：量出 group 的包围盒尺寸写进 userData.size（引擎据此绘制锁定框）
   * @param fb     兜底尺寸（几何体退化时使用）
   * @param ground 载具底盘：为 true 时整组平移，保证最低点严格落在 y = 0
   */
  function finish(H, g, fb, ground) {
    var bb = new H.THREE.Box3().setFromObject(g);
    if (ground && Math.abs(bb.min.y) > 0.0005) {
      /* 只平移子节点，group 原点仍留在底盘平面上（引擎用原点摆放） */
      for (var i = 0; i < g.children.length; i++) {
        g.children[i].position.y -= bb.min.y;
      }
      bb.setFromObject(g);
    }
    var sz = new H.THREE.Vector3();
    bb.getSize(sz);
    g.userData.size = {
      x: sz.x > 0.0001 ? sz.x : fb.x,
      y: sz.y > 0.0001 ? sz.y : fb.y,
      z: sz.z > 0.0001 ? sz.z : fb.z
    };
    return g;
  }

  /** 轴向为 X 的圆柱（车轮 / 负重轮 / 主动轮） */
  function cylX(H, r, len, seg) {
    var geo = H.cyl(r, r, len, seg || 9);
    geo.rotateZ(Math.PI / 2);
    return geo;
  }

  /** 尖锥，锥尖朝 +Z（导弹 / 弹头整流罩） */
  function coneZ(H, r, len, seg) {
    var geo = H.cyl(0, r, len, seg || 10);
    geo.rotateX(Math.PI / 2);
    return geo;
  }

  /** 车轮：轮心取 y ≈ 半径，最低点贴近 y = 0（多边形的细微悬空由 finish 统一对齐） */
  function wheel(H, parent, mt, x, y, z, r, w, seg) {
    return H.addMesh(parent, cylX(H, r, w, seg || 9), mt, x, y, z);
  }

  /** 确定性伪随机（避免爆炸碎片每帧乱跳） */
  function hash(i) {
    var v = Math.sin(i * 12.9898 + 4.1414) * 43758.5453;
    return v - Math.floor(v);
  }

  /* =======================================================================
     1. 主战坦克 tank(H) —— 约 6.4 × 3.4 × 2.4 cm，沙褐
     ======================================================================= */
  function tank(H) {
    var g = new H.THREE.Group();

    var HULL = H.std({ color: 0x6b6146, roughness: 0.80, metalness: 0.20 });
    var HULL2 = H.std({ color: 0x7c7154, roughness: 0.84, metalness: 0.16 });
    var DARK = H.std({ color: 0x2c2a22, roughness: 0.90, metalness: 0.22 });
    var RUB = H.std({ color: 0x1d1c18, roughness: 0.97, metalness: 0.04 });
    var MET = H.std({ color: 0x4e4b3e, roughness: 0.40, metalness: 0.75 });
    var GLASS = H.std({ color: 0x181e14, roughness: 0.10, metalness: 0.55, emissive: 0x3a2c08, emissiveIntensity: 0.45 });

    /* --- 履带总成：最低点 y = 0，左右对称 --- */
    [-1, 1].forEach(function (s) {
      H.addMesh(g, H.box(0.50, 0.74, 5.80), DARK, 1.28 * s, 0.37, -0.30);      // 履带板主体
      H.addMesh(g, H.box(0.58, 0.10, 5.86), RUB, 1.28 * s, 0.05, -0.30);       // 下缘履带齿
      H.addMesh(g, H.box(0.58, 0.08, 5.86), RUB, 1.28 * s, 0.70, -0.30);       // 上缘履带齿

      var i, wz;
      for (i = 0; i < 5; i++) {                                                // 负重轮 ×5
        wz = -2.30 + i * 1.00;
        wheel(H, g, RUB, 1.60 * s, 0.33, wz, 0.33, 0.20, 9);
      }
      wheel(H, g, MET, 1.54 * s, 0.42, 2.40, 0.30, 0.24, 8);                   // 主动轮（前）
      wheel(H, g, MET, 1.54 * s, 0.42, -2.70, 0.30, 0.24, 8);                  // 诱导轮（后）
      H.addMesh(g, H.box(0.07, 0.46, 3.60), HULL2, 1.42 * s, 0.98, -0.60);     // 侧裙板
    });

    /* --- 车体 --- */
    H.addMesh(g, H.box(2.06, 0.62, 5.50), HULL, 0, 0.31, -0.30);               // 下体
    H.addMesh(g, H.box(2.06, 0.42, 3.70), HULL, 0, 0.83, -0.95);               // 上体 / 甲板
    H.addMesh(g, H.box(2.06, 0.10, 1.80), HULL2, 0, 0.80, 1.72, -0.38, 0, 0);  // 首上倾斜装甲
    H.addMesh(g, H.box(2.06, 0.72, 0.12), HULL2, 0, 0.50, -3.05);              // 尾板
    H.addMesh(g, H.box(0.52, 0.08, 0.32), DARK, 0, 1.00, 2.30, -0.38, 0, 0);   // 备用履带块

    /* --- 炮塔 --- */
    H.addMesh(g, H.box(1.72, 0.64, 1.90), HULL, 0, 1.36, 0.10);                // 塔体
    H.addMesh(g, H.box(1.72, 0.44, 0.80), HULL2, 0, 1.28, 1.25, -0.42, 0, 0);  // 首部楔形附加装甲
    H.addMesh(g, H.box(1.44, 0.10, 1.60), HULL2, 0, 1.72, 0.05);               // 顶盖
    H.addMesh(g, H.box(0.62, 0.32, 0.62), HULL2, -0.26, 1.90, -0.42);          // 车长指挥塔
    H.addMesh(g, H.cyl(0.22, 0.22, 0.07, 8), HULL2, 0.34, 1.80, 0.28);         // 装填手舱盖
    H.addMesh(g, H.cyl(0.20, 0.20, 0.06, 8), HULL2, -0.26, 2.08, -0.42);       // 塔顶舱盖
    H.addMesh(g, H.box(0.50, 0.26, 0.70), DARK, 0, 1.40, -1.10);               // 尾部储物箱

    /* --- 主炮 --- */
    H.addMesh(g, H.box(0.68, 0.50, 0.30), HULL2, 0, 1.36, 1.06);               // 炮盾
    H.addMesh(g, H.cylZ(0.13, 0.13, 0.90, 8), HULL2, 0, 1.36, 1.60);           // 炮管热护套
    H.addMesh(g, H.cylZ(0.075, 0.09, 2.10, 9), MET, 0, 1.36, 2.12);            // 炮管
    H.addMesh(g, H.cylZ(0.12, 0.12, 0.24, 9), DARK, 0, 1.36, 3.05);            // 炮口制退器

    /* --- 观瞄 / 天线 / 附件 --- */
    H.addMesh(g, H.box(0.34, 0.18, 0.14), GLASS, 0.30, 1.66, 0.92);            // 炮长瞄具
    H.addMesh(g, H.box(0.26, 0.16, 0.14), GLASS, -0.20, 2.06, -0.20);          // 车长周视镜
    H.addMesh(g, H.box(0.30, 0.14, 0.12), GLASS, -0.70, 1.32, 0.95);           // 驾驶员观察窗
    H.addMesh(g, H.box(0.60, 0.05, 0.05), DARK, -0.26, 2.20, -0.42);           // 高射机枪
    H.addMesh(g, H.cylZ(0.022, 0.022, 0.34, 5, true), DARK, -0.26, 2.20, -0.10);
    H.addMesh(g, H.cyl(0.02, 0.02, 0.60, 5, true), MET, 0.66, 2.10, -0.95);    // 天线
    H.addMesh(g, H.cyl(0.016, 0.016, 0.42, 5, true), MET, -0.74, 1.96, -1.30);

    var sl, sx;
    for (sl = 0; sl < 2; sl++) {                                               // 烟幕发射器 ×4
      for (sx = 0; sx < 2; sx++) {
        H.addMesh(g, H.cyl(0.05, 0.055, 0.24, 6, true), DARK,
          0.62 * (sl ? -1 : 1), 1.62 + sx * 0.02, 0.55 - sx * 0.20, 0.30, 0, 0);
      }
    }
    H.addMesh(g, H.box(0.22, 0.16, 0.22), MET, 0.94, 0.90, 2.30);              // 前大灯
    H.addMesh(g, H.box(0.22, 0.16, 0.22), MET, -0.94, 0.90, 2.30);

    return finish(H, g, { x: 3.4, y: 2.4, z: 6.4 }, true);
  }

  /* =======================================================================
     2. 轮式装甲车 apc(H) —— 约 5.6 × 2.8 × 2.2 cm，暗棕
     ======================================================================= */
  function apc(H) {
    var g = new H.THREE.Group();

    var HULL = H.std({ color: 0x5a4f3c, roughness: 0.82, metalness: 0.18 });
    var HULL2 = H.std({ color: 0x6b5f48, roughness: 0.86, metalness: 0.15 });
    var DARK = H.std({ color: 0x2a261e, roughness: 0.92, metalness: 0.20 });
    var RUB = H.std({ color: 0x1c1b17, roughness: 0.97, metalness: 0.04 });
    var MET = H.std({ color: 0x4a463a, roughness: 0.42, metalness: 0.72 });
    var GLASS = H.std({ color: 0x171a12, roughness: 0.10, metalness: 0.55, emissive: 0x3a2c08, emissiveIntensity: 0.45 });

    /* --- 倾斜车体：超椭圆截面沿 Z 放样，前脸下压、尾部收窄 --- */
    var SEC = [
      { z: -2.80, w: 2.10, h: 0.86, y: 0.82, n: 3.2 },
      { z: -2.10, w: 2.42, h: 1.00, y: 0.84, n: 3.0 },
      { z: -0.60, w: 2.48, h: 1.06, y: 0.85, n: 3.0 },
      { z: 1.00, w: 2.48, h: 1.02, y: 0.84, n: 3.0 },
      { z: 2.10, w: 2.30, h: 0.88, y: 0.80, n: 3.0 },
      { z: 2.80, w: 1.60, h: 0.62, y: 0.72, n: 2.6 }
    ];
    g.add(new H.THREE.Mesh(H.loftGeo(SEC, { part: 'full', seg: 10, cap: true }), [HULL, DARK]));

    /* --- 8 个车轮（4 × 2），最低点 y = 0 --- */
    [-1, 1].forEach(function (s) {
      var i, wz;
      for (i = 0; i < 4; i++) {
        wz = -1.90 + i * 1.30;
        wheel(H, g, RUB, 1.27 * s, 0.42, wz, 0.42, 0.26, 10);
        H.addMesh(g, cylX(H, 0.16, 0.30, 8), MET, 1.27 * s, 0.42, wz);         // 轮毂
        H.addMesh(g, H.box(0.30, 0.08, 1.00), DARK, 1.18 * s, 0.90, wz);       // 轮罩
      }
    });

    /* --- 小炮塔 --- */
    H.addMesh(g, H.cyl(0.52, 0.58, 0.18, 12), HULL2, 0, 1.42, 0.55);           // 座圈
    H.addMesh(g, H.box(0.96, 0.36, 1.00), HULL, 0, 1.68, 0.50);                // 塔体
    H.addMesh(g, H.box(0.96, 0.30, 0.42), HULL2, 0, 1.62, 1.10, -0.42, 0, 0);  // 首部斜面
    H.addMesh(g, H.box(0.80, 0.08, 0.86), HULL2, 0, 1.88, 0.48);               // 顶盖
    H.addMesh(g, H.cylZ(0.050, 0.045, 0.85, 8), MET, 0, 1.66, 1.75);           // 小口径炮管
    H.addMesh(g, H.cylZ(0.075, 0.075, 0.14, 8), DARK, 0, 1.66, 2.12);          // 炮口

    /* --- 观察窗 / 舱盖 / 附件 --- */
    H.addMesh(g, H.box(0.62, 0.30, 0.10), GLASS, -0.52, 1.05, 2.30, -0.42, 0, 0);  // 驾驶员窗
    H.addMesh(g, H.box(0.46, 0.26, 0.10), GLASS, 0.42, 1.05, 2.34, -0.42, 0, 0);   // 车长窗
    H.addMesh(g, H.box(0.10, 0.22, 0.62), GLASS, 1.16, 0.98, 1.35, 0, 0, 0);       // 侧观察窗
    H.addMesh(g, H.box(0.10, 0.22, 0.62), GLASS, -1.16, 0.98, 1.35, 0, 0, 0);
    H.addMesh(g, H.box(0.28, 0.16, 0.14), GLASS, 0.30, 1.76, 0.98);                // 炮塔瞄具
    H.addMesh(g, H.box(0.52, 0.10, 0.52), HULL2, -0.40, 1.36, -1.30);              // 顶部舱盖
    H.addMesh(g, H.box(0.52, 0.10, 0.52), HULL2, 0.90, 1.26, -0.10, 0, 0, 0.10);
    H.addMesh(g, H.box(0.30, 0.14, 0.16), DARK, -0.62, 1.30, -0.10);               // 潜望镜
    H.addMesh(g, H.box(0.30, 0.14, 0.16), DARK, 0.62, 1.30, -0.10);
    H.addMesh(g, H.cyl(0.018, 0.018, 0.34, 5, true), MET, -0.74, 2.03, -0.60);     // 天线
    H.addMesh(g, H.cyl(0.016, 0.016, 0.26, 5, true), MET, 0.80, 1.99, -1.00);
    H.addMesh(g, H.box(0.20, 0.14, 0.20), MET, 0.86, 0.78, 2.62);                  // 前大灯
    H.addMesh(g, H.box(0.20, 0.14, 0.20), MET, -0.86, 0.78, 2.62);
    H.addMesh(g, H.box(1.30, 0.50, 0.10), DARK, 0, 0.80, -2.76);                   // 尾门
    H.addMesh(g, H.box(0.60, 0.34, 0.08), HULL2, -0.90, 0.86, 1.60, 0, 0, 0.6);    // 侧裙附件

    return finish(H, g, { x: 2.8, y: 2.2, z: 5.6 }, true);
  }

  /* =======================================================================
     3. 军用卡车 truck(H) —— 约 6.0 × 2.4 × 2.6 cm，深灰绿
     ======================================================================= */
  function truck(H) {
    var g = new H.THREE.Group();

    var BDY = H.std({ color: 0x4c5343, roughness: 0.84, metalness: 0.18 });
    var BDY2 = H.std({ color: 0x5b6350, roughness: 0.86, metalness: 0.16 });
    var CANV = H.std({ color: 0x3d4438, roughness: 0.96, metalness: 0.05 });
    var DARK = H.std({ color: 0x26291f, roughness: 0.90, metalness: 0.22 });
    var RUB = H.std({ color: 0x1b1a16, roughness: 0.97, metalness: 0.04 });
    var MET = H.std({ color: 0x4b4c42, roughness: 0.42, metalness: 0.72 });
    var GLASS = H.std({ color: 0x14180f, roughness: 0.08, metalness: 0.55, emissive: 0x3a2c08, emissiveIntensity: 0.40 });

    /* --- 车架 --- */
    [-1, 1].forEach(function (s) {
      H.addMesh(g, H.box(0.16, 0.18, 5.60), DARK, 0.52 * s, 0.78, 0);
      H.addMesh(g, H.box(0.24, 0.34, 0.72), MET, 0.80 * s, 0.74, 0.30);        // 油箱
    });
    H.addMesh(g, H.box(1.10, 0.12, 0.16), DARK, 0, 0.78, -2.20);
    H.addMesh(g, H.box(1.10, 0.12, 0.16), DARK, 0, 0.78, 0.00);
    H.addMesh(g, H.box(1.10, 0.12, 0.16), DARK, 0, 0.78, 2.20);

    /* --- 6 个车轮：前 1 轴 + 后 2 轴，最低点 y = 0 --- */
    [-1, 1].forEach(function (s) {
      wheel(H, g, RUB, 1.02 * s, 0.46, 2.05, 0.46, 0.26, 10);                  // 前轴
      wheel(H, g, RUB, 1.02 * s, 0.46, -1.30, 0.46, 0.26, 10);                 // 后轴一
      wheel(H, g, RUB, 1.02 * s, 0.46, -2.20, 0.46, 0.26, 10);                 // 后轴二
      H.addMesh(g, cylX(H, 0.17, 0.30, 8), MET, 1.02 * s, 0.46, 2.05);
      H.addMesh(g, cylX(H, 0.17, 0.30, 8), MET, 1.02 * s, 0.46, -1.30);
      H.addMesh(g, cylX(H, 0.17, 0.30, 8), MET, 1.02 * s, 0.46, -2.20);
    });

    /* --- 驾驶室 --- */
    H.addMesh(g, H.box(2.20, 1.02, 1.80), BDY, 0, 1.38, 1.95);                 // 驾驶室
    H.addMesh(g, H.box(2.18, 0.10, 1.70), BDY2, 0, 1.94, 1.95);                // 车顶
    H.addMesh(g, H.box(1.96, 0.62, 0.10), GLASS, 0, 1.66, 2.72, 0.34, 0, 0);   // 前风挡
    H.addMesh(g, H.box(0.06, 0.52, 0.90), BDY2, 1.12, 1.42, 1.70);             // 车门缝
    H.addMesh(g, H.box(0.06, 0.52, 0.90), BDY2, -1.12, 1.42, 1.70);
    H.addMesh(g, H.box(1.90, 0.48, 0.08), DARK, 0, 1.12, 2.86);                // 进气格栅
    H.addMesh(g, H.box(2.28, 0.30, 0.22), DARK, 0, 0.98, 2.88);                // 前保险杠
    H.addMesh(g, H.box(0.22, 0.16, 0.12), MET, 0.80, 1.30, 2.90);              // 大灯
    H.addMesh(g, H.box(0.22, 0.16, 0.12), MET, -0.80, 1.30, 2.90);
    H.addMesh(g, H.box(0.10, 0.10, 0.22), DARK, 1.16, 1.86, 2.30);             // 后视镜臂
    H.addMesh(g, H.box(0.10, 0.10, 0.22), DARK, -1.16, 1.86, 2.30);
    H.addMesh(g, H.box(0.06, 0.26, 0.16), MET, 1.19, 1.72, 2.28);              // 镜面
    H.addMesh(g, H.box(0.06, 0.26, 0.16), MET, -1.19, 1.72, 2.28);
    H.addMesh(g, H.cyl(0.06, 0.06, 0.90, 6, true), DARK, 0.96, 1.35, 0.95);    // 排气管

    /* --- 篷布车厢 --- */
    H.addMesh(g, H.box(2.30, 0.50, 3.50), BDY, 0, 1.10, -1.15);                // 货厢底板
    H.addMesh(g, H.box(0.08, 0.55, 3.50), BDY2, 1.14, 1.42, -1.15);            // 侧板
    H.addMesh(g, H.box(0.08, 0.55, 3.50), BDY2, -1.14, 1.42, -1.15);
    H.addMesh(g, H.box(2.24, 0.80, 3.40), CANV, 0, 1.82, -1.15);               // 篷布主体
    H.addMesh(g, H.box(1.90, 0.28, 3.30), CANV, 0, 2.34, -1.15);               // 篷顶
    H.addMesh(g, H.box(2.26, 0.06, 0.08), BDY2, 0, 2.42, 0.30);                // 篷布撑杆
    H.addMesh(g, H.box(2.26, 0.06, 0.08), BDY2, 0, 2.42, -0.60);
    H.addMesh(g, H.box(2.26, 0.06, 0.08), BDY2, 0, 2.42, -1.50);
    H.addMesh(g, H.box(2.26, 0.06, 0.08), BDY2, 0, 2.42, -2.40);
    H.addMesh(g, H.box(2.24, 0.55, 0.08), BDY2, 0, 1.42, -2.94);               // 尾门
    H.addMesh(g, H.cyl(0.018, 0.018, 0.62, 5, true), MET, -0.98, 2.30, 1.30);  // 天线

    return finish(H, g, { x: 2.4, y: 2.6, z: 6.0 }, true);
  }

  /* =======================================================================
     4. 自行高炮 aa(H) —— 约 5.0 × 2.6 × 2.6 cm，深灰绿
     ======================================================================= */
  function aa(H) {
    var g = new H.THREE.Group();

    var HULL = H.std({ color: 0x565e4a, roughness: 0.82, metalness: 0.20 });
    var HULL2 = H.std({ color: 0x666e56, roughness: 0.85, metalness: 0.18 });
    var DARK = H.std({ color: 0x272b20, roughness: 0.92, metalness: 0.20 });
    var RUB = H.std({ color: 0x1c1b17, roughness: 0.97, metalness: 0.04 });
    var MET = H.std({ color: 0x4d5044, roughness: 0.38, metalness: 0.78 });
    var GLASS = H.std({ color: 0x141810, roughness: 0.10, metalness: 0.55, emissive: 0x3a2c08, emissiveIntensity: 0.45 });

    /* --- 履带底盘（最低点 y = 0） --- */
    [-1, 1].forEach(function (s) {
      H.addMesh(g, H.box(0.46, 0.62, 4.60), DARK, 1.02 * s, 0.31, -0.20);
      H.addMesh(g, H.box(0.52, 0.09, 4.66), RUB, 1.02 * s, 0.05, -0.20);
      var i, wz;
      for (i = 0; i < 4; i++) {
        wz = -1.65 + i * 1.05;
        wheel(H, g, RUB, 1.22 * s, 0.31, wz, 0.31, 0.19, 9);
      }
      H.addMesh(g, H.box(0.06, 0.30, 2.60), HULL2, 1.28 * s, 0.75, -0.40);     // 侧裙
    });
    H.addMesh(g, H.box(2.00, 0.72, 4.20), HULL, 0, 0.55, -0.20);               // 车体
    H.addMesh(g, H.box(2.00, 0.16, 3.00), HULL2, 0, 0.95, -0.40);              // 甲板

    /* --- 可旋转双联炮塔 --- */
    H.addMesh(g, H.cyl(0.72, 0.78, 0.20, 12), HULL2, 0, 1.12, 0.15);           // 座圈
    H.addMesh(g, H.box(1.60, 0.56, 1.80), HULL, 0, 1.45, 0.05);                // 塔体
    H.addMesh(g, H.box(1.60, 0.44, 0.60), HULL2, 0, 1.38, 1.10, -0.40, 0, 0);  // 首部斜面
    H.addMesh(g, H.box(1.40, 0.08, 1.50), HULL2, 0, 1.77, 0.00);               // 顶盖
    H.addMesh(g, H.box(0.30, 0.18, 0.16), GLASS, 0.52, 1.62, 0.92);            // 光学瞄准具
    H.addMesh(g, H.box(0.30, 0.18, 0.16), GLASS, -0.52, 1.62, 0.92);

    var k;
    for (k = 0; k < 2; k++) {                                                  // 两根细长炮管
      var ox = k ? 0.30 : -0.30;
      H.addMesh(g, H.cylZ(0.05, 0.062, 2.20, 8), MET, ox, 1.50, 1.38);
      H.addMesh(g, H.cylZ(0.075, 0.075, 0.16, 8), DARK, ox, 1.50, 2.40);       // 炮口制退器
      H.addMesh(g, H.box(0.16, 0.16, 0.30), HULL2, ox, 1.50, 0.42);            // 炮箱
    }

    /* --- 搜索雷达：桅杆 + 倾斜平板天线 --- */
    H.addMesh(g, H.box(0.09, 0.46, 0.09), MET, 0, 2.03, -0.75);                // 桅杆
    H.addMesh(g, H.box(1.30, 0.05, 0.85), HULL2, 0, 2.32, -0.85, -0.70, 0, 0); // 雷达阵面
    H.addMesh(g, H.box(0.60, 0.05, 0.14), MET, 0, 2.46, -1.05, -0.70, 0, 0);   // 馈源
    H.addMesh(g, H.box(0.06, 0.42, 0.06), MET, -0.34, 2.02, -1.10, 0.30, 0, 0);
    H.addMesh(g, H.box(0.06, 0.42, 0.06), MET, 0.34, 2.02, -1.10, 0.30, 0, 0);
    H.addMesh(g, H.cyl(0.018, 0.018, 0.42, 5, true), MET, 0.86, 2.02, -0.60);  // 电台天线

    /* --- 烟幕发射器 ×4 --- */
    var m;
    for (m = 0; m < 4; m++) {
      H.addMesh(g, H.cyl(0.045, 0.05, 0.22, 6, true), DARK,
        (m < 2 ? -0.62 : 0.62), 1.42, -0.60 + (m % 2) * 0.22, 0.28, 0, 0);
    }
    H.addMesh(g, H.box(0.22, 0.14, 0.20), MET, 0.86, 0.62, 2.02);              // 前大灯
    H.addMesh(g, H.box(0.22, 0.14, 0.20), MET, -0.86, 0.62, 2.02);

    return finish(H, g, { x: 2.6, y: 2.6, z: 5.0 }, true);
  }

  /* =======================================================================
     5. 焦黑残骸 wreck(H) —— 约 6.0 × 3.3 × 2.0 cm，接近黑
     ======================================================================= */
  function wreck(H) {
    var g = new H.THREE.Group();

    var ASH = H.std({ color: 0x1a1712, roughness: 0.97, metalness: 0.10 });
    var SOOT = H.std({ color: 0x231d17, roughness: 0.98, metalness: 0.06 });
    var RUST = H.std({ color: 0x2f2119, roughness: 0.94, metalness: 0.16 });
    var MET = H.std({ color: 0x2a2722, roughness: 0.72, metalness: 0.48 });
    var EMBER = H.std({ color: 0x2a1206, emissive: 0xff5a12, emissiveIntensity: 0.9, roughness: 0.95, metalness: 0.0 });

    /* --- 烧毁坍塌的车体（整体压扁、歪斜） --- */
    H.addMesh(g, H.box(2.06, 0.48, 5.20), ASH, 0.04, 0.30, -0.40, 0.02, 0, 0.04);
    H.addMesh(g, H.box(2.00, 0.26, 3.20), SOOT, -0.08, 0.60, -1.00, 0.18, 0, 0.12);   // 塌陷甲板
    H.addMesh(g, H.box(1.70, 0.36, 0.12), RUST, 0.10, 0.42, -3.00, 0, 0, 0.10);       // 尾板残片
    H.addMesh(g, H.box(1.40, 0.34, 0.90), ASH, -0.30, 0.26, 2.35, 0.05, 0.35, -0.15); // 车头断块
    H.addMesh(g, H.box(1.10, 0.30, 0.70), SOOT, -0.10, 0.52, -0.55, 0.18, 0, 0.12);   // 烧穿的破洞盖板

    /* --- 塌陷炮塔 --- */
    H.addMesh(g, H.box(1.66, 0.52, 1.70), ASH, 0.30, 1.05, -0.35, -0.10, 0.14, 0.30);
    H.addMesh(g, H.box(1.30, 0.09, 1.40), SOOT, 0.44, 1.32, -0.42, -0.10, 0.14, 0.30);
    H.addMesh(g, H.box(0.62, 0.26, 0.60), SOOT, 0.74, 1.02, -1.05, 0, 0.30, 0.40);    // 掀开的舱盖
    H.addMesh(g, H.box(0.60, 0.24, 0.36), MET, 0.16, 0.86, 0.55, -0.10, 0.10, 0.30);  // 扭曲炮盾

    /* --- 断裂炮管：一截插地、一截落地 --- */
    H.addMesh(g, H.cylZ(0.075, 0.095, 1.20, 8), MET, 0.16, 0.62, 1.05, 0.85, 0, 0);
    H.addMesh(g, H.cylZ(0.075, 0.075, 1.05, 8), MET, 1.15, 0.13, 2.10, 0.10, 0.55, 0);

    /* --- 断裂履带 / 脱落履带段 --- */
    H.addMesh(g, H.box(0.48, 0.34, 4.20), SOOT, -1.30, 0.22, -0.40, 0.03, 0, 0.06);
    H.addMesh(g, H.box(0.48, 0.30, 2.20), SOOT, 1.32, 0.20, 0.60, -0.03, 0, -0.10);
    H.addMesh(g, H.box(0.48, 0.26, 1.50), RUST, 1.15, 0.17, -1.70, 0, 0.34, 0.08);
    H.addMesh(g, H.box(0.46, 0.10, 1.70), SOOT, 0.95, 0.06, 1.90, 0, 0.62, 0);

    /* --- 破碎车轮（侧倒） --- */
    var bw = [[-1.35, 0.14, 1.35, 0.10], [1.32, 0.14, -2.35, 0.20], [0.55, 0.13, 2.55, 0.12]];
    for (var i = 0; i < bw.length; i++) {
      H.addMesh(g, cylX(H, 0.30, 0.20, 8), MET, bw[i][0], bw[i][1], bw[i][2],
        0, 0, Math.PI / 2 + bw[i][3]);
    }

    /* --- 余烬与断折天线 --- */
    H.addMesh(g, H.box(0.20, 0.10, 0.26), EMBER, 0.32, 0.08, 1.35, 0, 0.40, 0);
    H.addMesh(g, H.box(0.16, 0.08, 0.20), EMBER, -0.55, 0.07, 0.20, 0, -0.30, 0);
    H.addMesh(g, H.box(0.14, 0.07, 0.18), EMBER, 0.05, 0.06, -2.20, 0, 0.80, 0);
    H.addMesh(g, H.cyl(0.014, 0.018, 0.55, 5, true), MET, -0.30, 1.62, -0.90, 0, 0, 0.25);
    H.addMesh(g, H.cyl(0.012, 0.012, 0.40, 5, true), MET, -0.50, 1.85, -0.95, 0, 0, 0.90);

    return finish(H, g, { x: 3.3, y: 2.0, z: 6.0 }, true);
  }

  /* =======================================================================
     6. 曳光弹弹体 tracer(H) —— 0.12 × 0.12 × 1.2 cm，沿 +Z 拉长，原点居中
     ======================================================================= */
  function tracer(H) {
    var g = new H.THREE.Group();

    var GLOW = H.std({
      color: 0xffc040, emissive: 0xffc040, emissiveIntensity: 1.6,
      roughness: 0.35, metalness: 0.0
    });
    GLOW.toneMapped = false;

    var CORE = H.std({
      color: 0xfff0c0, emissive: 0xfff0c0, emissiveIntensity: 2.2,
      roughness: 0.35, metalness: 0.0
    });
    CORE.toneMapped = false;

    H.addMesh(g, H.cylZ(0.06, 0.06, 1.20, 8), GLOW, 0, 0, 0);      // 弹体（半径 0.06 → 直径 0.12）
    H.addMesh(g, H.cylZ(0.028, 0.028, 1.00, 6), CORE, 0, 0, 0.06); // 过热弹芯

    return finish(H, g, { x: 0.12, y: 0.12, z: 1.2 });
  }

  /* =======================================================================
     7. 小型精确制导弹药 missile(H) —— 0.5 × 0.5 × 3.0 cm，弹体沿 +Z
     ======================================================================= */
  function missile(H) {
    var g = new H.THREE.Group();

    var BODY = H.std({ color: 0x3a3f36, roughness: 0.62, metalness: 0.35 });
    var NOSE = H.std({ color: 0x8a3324, roughness: 0.55, metalness: 0.30 });
    var FIN = H.std({ color: 0x2e332c, roughness: 0.72, metalness: 0.30 });
    var DARK = H.std({ color: 0x1e211b, roughness: 0.85, metalness: 0.25 });
    var GLOW = H.std({
      color: 0x2a1a10, emissive: 0xff7a20, emissiveIntensity: 0.9,
      roughness: 0.85, metalness: 0.0
    });
    GLOW.toneMapped = false;

    H.addMesh(g, H.cylZ(0.13, 0.13, 2.10, 10), BODY, 0, 0, -0.45);      // 弹体：z -1.5 ~ 0.6
    H.addMesh(g, coneZ(H, 0.13, 0.90, 10), NOSE, 0, 0, 1.05);           // 尖锥弹头：0.6 ~ 1.5
    H.addMesh(g, H.cylZ(0.115, 0.13, 0.18, 10), DARK, 0, 0, -1.40);     // 尾喷管
    H.addMesh(g, H.cylZ(0.10, 0.10, 0.04, 10), GLOW, 0, 0, -1.47);      // 喷口焰

    var i, px, py;
    for (i = 0; i < 4; i++) {                                            // 4 片尾翼
      var fin = new H.THREE.Mesh(H.box(0.02, 0.13, 0.55), FIN);
      px = i === 1 ? -0.185 : (i === 3 ? 0.185 : 0);
      py = i === 0 ? 0.185 : (i === 2 ? -0.185 : 0);
      fin.position.set(px, py, -1.15);
      fin.rotation.z = i * Math.PI / 2;
      g.add(fin);
    }
    for (i = 0; i < 2; i++) {                                            // 中部导流条
      H.addMesh(g, H.box(0.02, 0.05, 0.40), FIN, (i ? -1 : 1) * 0.14, 0, 0.10);
    }

    return finish(H, g, { x: 0.5, y: 0.5, z: 3.0 });
  }

  /* =======================================================================
     8. 爆炸特效组 explosion(H) —— 直径 2 cm，火球 + 冲击环 + 碎片
     ======================================================================= */
  function explosion(H) {
    var g = new H.THREE.Group();

    var FIRE = H.std({
      color: 0xff6a1a, emissive: 0xff5a10, emissiveIntensity: 1.5,
      roughness: 0.9, metalness: 0.0, transparent: true, opacity: 0.85
    });
    FIRE.toneMapped = false;
    FIRE.depthWrite = false;

    var RINGM = H.std({
      color: 0xffd070, emissive: 0xffc050, emissiveIntensity: 1.2,
      roughness: 0.9, metalness: 0.0, transparent: true, opacity: 0.8,
      side: H.THREE.DoubleSide
    });
    RINGM.toneMapped = false;
    RINGM.depthWrite = false;

    var DEB = H.std({ color: 0x241f1a, roughness: 0.95, metalness: 0.10 });

    H.addMesh(g, new H.THREE.SphereGeometry(1, 10, 8), FIRE, 0, 0, 0);   // 火球，半径 1

    var ring = new H.THREE.RingGeometry(0.6, 1.0, 24);                   // 朝上的冲击波环
    ring.rotateX(-Math.PI / 2);
    H.addMesh(g, ring, RINGM, 0, 0, 0);

    var i, a, b, r, px, py, pz, geo;
    for (i = 0; i < 9; i++) {                                            // 9 片不规则碎片
      a = hash(i * 3 + 1) * Math.PI * 2;
      b = (hash(i * 3 + 2) - 0.5) * Math.PI * 0.8;
      r = 0.70 + hash(i * 3 + 3) * 0.12;
      px = Math.cos(b) * Math.cos(a) * r;
      py = Math.sin(b) * r * 0.9;
      pz = Math.cos(b) * Math.sin(a) * r;
      if (i % 2 === 0) geo = new H.THREE.TetrahedronGeometry(0.10 + hash(i + 21) * 0.05);
      else geo = H.box(0.10, 0.08, 0.12);
      H.addMesh(g, geo, DEB, px, py, pz,
        hash(i + 31) * 3, hash(i + 41) * 3, hash(i + 51) * 3);
    }

    return finish(H, g, { x: 2, y: 2, z: 2 });
  }

  /* =======================================================================
     9. 导出：挂到 window，供引擎动态加载后调用
     ======================================================================= */
  window.DJIEnemies = {
    tank: tank,
    apc: apc,
    truck: truck,
    aa: aa,
    wreck: wreck,
    tracer: tracer,
    missile: missile,
    explosion: explosion
  };
})();