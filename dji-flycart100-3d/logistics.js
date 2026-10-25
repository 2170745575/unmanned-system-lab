/* ============================================================================
 * DJI FLYCART 100 · 地面物流道具几何模块 (logistics.js)
 * ----------------------------------------------------------------------------
 * 纯几何模块：不依赖任何外部资源文件，全部网格由代码生成。
 *
 * 约定
 *   · 单位：cm；y 轴向上；地面道具（起降平台 / 货运箱 / 投放点 / 保障车 /
 *     充电桩 / 信标柱 / 尘环）的包围盒最低点严格落在 y = 0，
 *     group 原点留在底盘 / 地面平面上（引擎用原点摆放）
 *   · 朝向：+Z 为正面（保障车车头、货运箱标签面）
 *   · 涂装：哑光黑 0x1a1d21 / 深灰 0x2b3036 / 中灰金属 0x8a9199 +
 *     亮橙 0xe8722a · 0xff8a3d / 警示黄 0xd8b43a / 冷白灯 0xdfeaf2 /
 *     青色指示 0x4fd6e8；不使用军绿，不使用医疗红白
 *   · 每个构建函数签名统一为 fn(H)，H 为引擎注入的辅助集合：
 *       { THREE, std, box, cyl, cylZ, roundedBox, loftGeo, addMesh,
 *         placeAlong, makeTex, TEX }
 *   · 所有 THREE 用法都写在函数体内：模块顶层绝不出现 THREE，
 *     否则 Three.js 尚未动态加载完就会 ReferenceError 导致白屏
 *   · 返回值统一为 THREE.Group，并在 userData.size 写入包围盒尺寸（cm）
 *   · ES5 风格：var + function，无箭头函数 / let / const / 模板字符串 / class
 * ==========================================================================*/
(function () {
  'use strict';

  /* =======================================================================
     0. 调色板与通用几何工具
     ======================================================================= */

  /* 只存数字，模块顶层不碰 THREE */
  var C_BLACK = 0x1a1d21;   // 哑光黑（平台骨架 / 箱体 / 柜体）
  var C_GREY = 0x2b3036;    // 深灰（甲板 / 面板）
  var C_GREY2 = 0x3b4249;   // 稍亮深灰（盖板 / 筋板）
  var C_METAL = 0x8a9199;   // 中灰金属（包角 / 立柱 / 轮毂）
  var C_ORANGE = 0xe8722a;  // 亮橙（绑带 / 边界条 / 边灯）
  var C_ORANGE2 = 0xff8a3d; // 高亮橙（发光件）
  var C_YELLOW = 0xd8b43a;  // 警示黄（反光条 / 定位块）
  var C_WHITE = 0xdfeaf2;   // 冷白（H 标识 / 大灯）
  var C_CYAN = 0x4fd6e8;    // 青色指示（充电状态灯 / 引导灯）

  /**
   * 收尾：量出 group 的包围盒尺寸写进 userData.size（引擎据此绘制框选 / 标记）
   * @param fb     兜底尺寸（几何体退化时使用）
   * @param ground 地面道具：为 true 时整组平移，保证最低点严格落在 y = 0
   */
  function finish(H, g, fb, ground) {
    var bb = new H.THREE.Box3().setFromObject(g);
    if (ground && Math.abs(bb.min.y) > 0.0005) {
      /* 只平移子节点，group 原点仍留在地面平面上（引擎用原点摆放） */
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

  /** 特效类：整组子节点平移，使包围盒中心落在 group 原点 */
  function recenter(H, g) {
    var bb = new H.THREE.Box3().setFromObject(g);
    var cx = (bb.min.x + bb.max.x) / 2;
    var cy = (bb.min.y + bb.max.y) / 2;
    var cz = (bb.min.z + bb.max.z) / 2;
    for (var i = 0; i < g.children.length; i++) {
      g.children[i].position.x -= cx;
      g.children[i].position.y -= cy;
      g.children[i].position.z -= cz;
    }
    return g;
  }

  /** 自发光材质：toneMapped 关掉，否则 ACES 色调映射会把指示灯压成灰 */
  function glowMat(H, color, intensity, base) {
    var m = H.std({
      color: base === undefined ? color : base,
      emissive: color, emissiveIntensity: intensity || 1.0,
      roughness: 0.42, metalness: 0.0
    });
    m.toneMapped = false;
    return m;
  }

  /** 轴向为 X 的圆柱（车轮 / 卷盘 / 充电枪插销） */
  function cylX(H, r, len, seg) {
    var geo = H.cyl(r, r, len, seg || 9);
    geo.rotateZ(Math.PI / 2);
    return geo;
  }

  /** 车轮：轮心取 y ≈ 半径，最低点贴近 y = 0（多边形的细微悬空由 finish 统一对齐） */
  function wheel(H, parent, mt, x, y, z, r, w, seg) {
    return H.addMesh(parent, cylX(H, r, w, seg || 10), mt, x, y, z);
  }

  /** 平铺圆环（RingGeometry 在 XY 面，转到 XZ 面贴地） */
  function flatRing(H, rIn, rOut, seg) {
    var geo = new H.THREE.RingGeometry(rIn, rOut, seg);
    geo.rotateX(-Math.PI / 2);
    return geo;
  }

  /**
   * 十字标识（两个互相垂直的薄长方体搭成"+"）
   *   axis = 'z' → 十字面朝 ±Z；'x' → 朝 ±X；'y' → 平铺朝上
   */
  function cross(H, parent, mt, x, y, z, len, arm, thick, axis) {
    if (axis === 'x') {
      H.addMesh(parent, H.box(thick, arm, len), mt, x, y, z);   // 横杠沿 Z
      H.addMesh(parent, H.box(thick, len, arm), mt, x, y, z);   // 竖杠沿 Y
    } else if (axis === 'y') {
      H.addMesh(parent, H.box(len, thick, arm), mt, x, y, z);   // 横杠沿 X
      H.addMesh(parent, H.box(arm, thick, len), mt, x, y, z);   // 竖杠沿 Z
    } else {
      H.addMesh(parent, H.box(len, arm, thick), mt, x, y, z);   // 横杠沿 X
      H.addMesh(parent, H.box(arm, len, thick), mt, x, y, z);   // 竖杠沿 Y
    }
  }

  /** 软管 / 拉索：按两端点摆放一段圆柱（placeAlong 负责朝向） */
  function span(H, parent, mt, ax, ay, az, bx, by, bz, r, seg) {
    var dx = bx - ax, dy = by - ay, dz = bz - az;
    var len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    var m = H.addMesh(parent, H.cylZ(r, r, len, seg || 5), mt, 0, 0, 0);
    H.placeAlong(m,
      new H.THREE.Vector3(ax, ay, az),
      new H.THREE.Vector3(bx, by, bz));
    return m;
  }

  /** 确定性伪随机（保证每次构建的尘团 / 涡团位置一致） */
  function hash(i) {
    var v = Math.sin(i * 12.9898 + 4.1414) * 43758.5453;
    return v - Math.floor(v);
  }

  /* =======================================================================
     1. H 型起降平台 hpad(H) —— 700 × 700 cm 见方，高约 105 cm，贴地
        顶面深灰防滑格栅 + 中央巨型 H 标识 + 四角橙色边灯 + 边缘警示条纹
     ======================================================================= */
  function hpad(H) {
    var g = new H.THREE.Group();

    var BLACK = H.std({ color: C_BLACK, roughness: 0.88, metalness: 0.24 });
    var BEAM = H.std({ color: 0x23282d, roughness: 0.84, metalness: 0.30 });
    var DECK = H.std({ color: C_GREY, roughness: 0.82, metalness: 0.26 });
    var DECK2 = H.std({ color: C_GREY2, roughness: 0.86, metalness: 0.22 });
    var MET = H.std({ color: C_METAL, roughness: 0.34, metalness: 0.86 });
    var ORANGE = H.std({ color: C_ORANGE, roughness: 0.52, metalness: 0.14 });
    var WHITE = H.std({ color: C_WHITE, roughness: 0.60, metalness: 0.10 });
    var LAMP = glowMat(H, C_ORANGE2, 1.7, 0x3a1a05);

    /* --- 四周支撑脚 ×8（四角 + 四边中） --- */
    var fp = [[-1, -1], [1, -1], [-1, 1], [1, 1], [-1, 0], [1, 0], [0, -1], [0, 1]];
    for (var i = 0; i < fp.length; i++) {
      var fx = fp[i][0] * 322, fz = fp[i][1] * 322;
      H.addMesh(g, H.box(46, 22, 46), BLACK, fx, 11, fz);          // 支撑脚 0 ~ 22
      H.addMesh(g, H.box(56, 6, 56), MET, fx, 25, fz);             // 脚顶法兰 22 ~ 28
    }

    /* --- 主梁（周边方框）+ 交叉副梁 --- */
    H.addMesh(g, H.box(700, 26, 54), BEAM, 0, 39, 323);            // 前主梁 26 ~ 52
    H.addMesh(g, H.box(700, 26, 54), BEAM, 0, 39, -323);           // 后主梁
    H.addMesh(g, H.box(54, 26, 592), BEAM, 323, 39, 0);            // 右主梁
    H.addMesh(g, H.box(54, 26, 592), BEAM, -323, 39, 0);           // 左主梁
    H.addMesh(g, H.box(600, 18, 36), BEAM, 0, 45, 0);              // 交叉副梁 36 ~ 54
    H.addMesh(g, H.box(36, 18, 600), BEAM, 0, 45, 0);
    H.addMesh(g, H.cyl(60, 74, 22, 12), BLACK, 0, 41, 0);          // 中央支撑座

    /* --- 甲板 700 × 700，顶面 y = 74 --- */
    H.addMesh(g, H.box(700, 22, 700), DECK, 0, 63, 0);             // 52 ~ 74

    /* --- 甲板包边（凸起的挡边，形成平台轮廓） --- */
    H.addMesh(g, H.box(700, 10, 34), DECK2, 0, 79, 333);           // 74 ~ 84
    H.addMesh(g, H.box(700, 10, 34), DECK2, 0, 79, -333);
    H.addMesh(g, H.box(34, 10, 640), DECK2, 333, 79, 0);
    H.addMesh(g, H.box(34, 10, 640), DECK2, -333, 79, 0);

    /* --- 顶面中央巨大 H 标识：两条竖条 + 一条横条（冷白高亮） --- */
    H.addMesh(g, H.box(84, 9, 400), WHITE, 118, 78.5, 0);          // 右竖条 74 ~ 83
    H.addMesh(g, H.box(84, 9, 400), WHITE, -118, 78.5, 0);         // 左竖条
    H.addMesh(g, H.box(236, 11, 84), ORANGE, 0, 79.5, 0);          // 横条 74 ~ 85（橙色，压住竖条）

    /* --- 四角橙色边灯（灯座 + 发光灯罩） --- */
    [-1, 1].forEach(function (sx) {
      [-1, 1].forEach(function (sz) {
        H.addMesh(g, H.box(48, 12, 48), BEAM, 326 * sx, 90, 326 * sz);
        H.addMesh(g, H.box(30, 8, 30), LAMP, 326 * sx, 100, 326 * sz);
      });
    });

    /* --- 边缘警示条纹 ×20（橙色 / 深灰交替，沿包边顶面） --- */
    var st = [-240, -120, 0, 120, 240];
    for (var s = 0; s < st.length; s++) {
      H.addMesh(g, H.box(50, 6, 26), ORANGE, st[s], 87, 333);
      H.addMesh(g, H.box(50, 6, 26), ORANGE, st[s], 87, -333);
      H.addMesh(g, H.box(26, 6, 50), ORANGE, 333, 87, st[s]);
      H.addMesh(g, H.box(26, 6, 50), ORANGE, -333, 87, st[s]);
    }

    /* --- 防滑格栅条（避开 H 标识区域） --- */
    H.addMesh(g, H.box(660, 4, 22), DECK2, 0, 76, 250);
    H.addMesh(g, H.box(660, 4, 22), DECK2, 0, 76, -250);
    H.addMesh(g, H.box(660, 4, 22), DECK2, 0, 76, 296);
    H.addMesh(g, H.box(660, 4, 22), DECK2, 0, 76, -296);
    H.addMesh(g, H.box(140, 4, 22), DECK2, 0, 76, 128);
    H.addMesh(g, H.box(140, 4, 22), DECK2, 0, 76, -128);

    /* --- 甲板检修盖板 ×2 --- */
    H.addMesh(g, H.box(150, 8, 96), BLACK, 236, 78, 240);
    H.addMesh(g, H.box(150, 8, 96), BLACK, -236, 78, -240);

    /* --- 侧边电缆卷盘 + 出线盒 --- */
    H.addMesh(g, cylX(H, 15, 18, 12), MET, -180, 88, -333);
    H.addMesh(g, H.box(10, 30, 26), BEAM, -206, 88, -333);
    H.addMesh(g, H.box(30, 18, 40), BLACK, 333, 95, 180);
    H.addMesh(g, H.box(30, 18, 40), BLACK, -333, 95, -180);

    /* --- 四角吊装环（平台整体吊运） --- */
    H.addMesh(g, H.box(26, 26, 12), MET, 326, 46, 326);
    H.addMesh(g, H.box(26, 26, 12), MET, -326, 46, 326);
    H.addMesh(g, H.box(26, 26, 12), MET, 326, 46, -326);
    H.addMesh(g, H.box(26, 26, 12), MET, -326, 46, -326);

    return finish(H, g, { x: 700, y: 105, z: 700 }, true);
  }

  /* =======================================================================
     2. 起降平台灯环 hpadLight(H) —— 直径约 620 cm、厚 8 cm，平铺贴地
        分段的发光圆环 + 四角 45° 角标 + 进近箭头，用于动态指示灯效
     ======================================================================= */
  function hpadLight(H) {
    var g = new H.THREE.Group();

    var GLOW = glowMat(H, C_ORANGE2, 1.9, 0x2a1206);
    var CYAN = glowMat(H, C_CYAN, 1.6, 0x08262c);
    var YEL = glowMat(H, C_YELLOW, 1.3, 0x2a2408);

    /* --- 外圈：16 段切向灯条（半径 300） --- */
    var i, a;
    for (i = 0; i < 16; i++) {
      a = i * Math.PI / 8;
      H.addMesh(g, H.box(104, 8, 18), GLOW,
        Math.sin(a) * 300, 4, Math.cos(a) * 300, 0, a, 0);
    }

    /* --- 内圈：8 段青色引导灯（半径 150） --- */
    for (i = 0; i < 8; i++) {
      a = i * Math.PI / 4 + Math.PI / 8;
      H.addMesh(g, H.box(84, 6, 12), CYAN,
        Math.sin(a) * 150, 3, Math.cos(a) * 150, 0, a, 0);
    }

    /* --- 四角 45° 角标灯 --- */
    [-1, 1].forEach(function (sx) {
      [-1, 1].forEach(function (sz) {
        H.addMesh(g, H.box(96, 8, 26), YEL, 170 * sx, 4, 170 * sz,
          0, sx * sz * Math.PI / 4, 0);
      });
    });

    /* --- 前后进近箭头（在环内，不越出平台） --- */
    H.addMesh(g, H.box(70, 6, 20), GLOW, 0, 3, 250);
    H.addMesh(g, H.box(20, 6, 54), GLOW, 0, 3, 285);
    H.addMesh(g, H.box(70, 6, 20), GLOW, 0, 3, -250);
    H.addMesh(g, H.box(20, 6, 54), GLOW, 0, 3, -285);

    return finish(H, g, { x: 640, y: 8, z: 640 }, true);
  }

  /* =======================================================================
     3. 可拆货运包装箱 cargoBox(H) —— 长 120 × 宽 100 × 高 90 cm（含吊挂环），贴地
        哑光黑箱体 + 金属包角 + 橙色绑带与吊耳 + 顶部吊挂环 + 标签牌与卡扣
     ======================================================================= */
  function cargoBox(H) {
    var g = new H.THREE.Group();

    var BODY = H.std({ color: C_BLACK, roughness: 0.86, metalness: 0.20 });
    var BODY2 = H.std({ color: 0x23282d, roughness: 0.82, metalness: 0.26 });
    var SKID = H.std({ color: C_GREY, roughness: 0.80, metalness: 0.30 });
    var MET = H.std({ color: C_METAL, roughness: 0.32, metalness: 0.88 });
    var ORANGE = H.std({ color: C_ORANGE, roughness: 0.50, metalness: 0.16 });
    var ORANGE2 = H.std({ color: C_ORANGE2, roughness: 0.54, metalness: 0.12 });
    var PLATE = H.std({ color: C_WHITE, roughness: 0.66, metalness: 0.06 });
    var GLOW = glowMat(H, C_CYAN, 1.2, 0x0a2630);

    /* --- 底部托盘（叉车槽） --- */
    H.addMesh(g, H.box(120, 8, 100), SKID, 0, 4, 0);               // 0 ~ 8
    H.addMesh(g, H.box(96, 8, 4), BODY, 0, 4, 49);                 // 叉车槽（前）
    H.addMesh(g, H.box(96, 8, 4), BODY, 0, 4, -49);                // 叉车槽（后）

    /* --- 箱身 + 箱盖 --- */
    H.addMesh(g, H.box(112, 60, 92), BODY, 0, 38, 0);              // 8 ~ 68
    H.addMesh(g, H.box(118, 10, 98), BODY2, 0, 73, 0);             // 箱盖 68 ~ 78
    H.addMesh(g, H.box(114, 3, 94), ORANGE, 0, 68, 0);             // 合缝橙色密封条
    H.addMesh(g, H.box(6, 66, 4), BODY2, 24, 41, 47);              // 可拆模块竖向分缝
    H.addMesh(g, H.box(6, 66, 4), BODY2, -24, 41, 47);
    H.addMesh(g, H.box(6, 66, 4), BODY2, 24, 41, -47);
    H.addMesh(g, H.box(6, 66, 4), BODY2, -24, 41, -47);

    /* --- 金属包角：四根立柱 + 四个顶部角件 --- */
    [-1, 1].forEach(function (sx) {
      [-1, 1].forEach(function (sz) {
        H.addMesh(g, H.box(12, 68, 12), MET, 54 * sx, 42, 45 * sz);
        H.addMesh(g, H.box(16, 10, 16), MET, 52 * sx, 82, 45 * sz);
      });
    });

    /* --- 橙色绑带：顶部 2 道 + 前后 2 道 + 左右 2 道 --- */
    H.addMesh(g, H.box(120, 5, 14), ORANGE2, 0, 80, 30);
    H.addMesh(g, H.box(120, 5, 14), ORANGE2, 0, 80, -30);
    H.addMesh(g, H.box(14, 76, 5), ORANGE2, 0, 40, 48.5);          // 前立面
    H.addMesh(g, H.box(14, 76, 5), ORANGE2, 0, 40, -48.5);         // 后立面
    H.addMesh(g, H.box(6, 76, 14), ORANGE2, 57.5, 40, 0);          // 右立面
    H.addMesh(g, H.box(6, 76, 14), ORANGE2, -57.5, 40, 0);         // 左立面

    /* --- 顶部吊耳 ×4 + 中央吊挂环 --- */
    H.addMesh(g, H.box(16, 12, 10), MET, 40, 84, 45);
    H.addMesh(g, H.box(16, 12, 10), MET, -40, 84, 45);
    H.addMesh(g, H.box(16, 12, 10), MET, 40, 84, -45);
    H.addMesh(g, H.box(16, 12, 10), MET, -40, 84, -45);
    H.addMesh(g, H.box(34, 6, 24), MET, 0, 79, 0);                 // 吊环安装座
    H.addMesh(g, H.box(10, 10, 16), MET, 8, 81, 0);                // 铰链耳
    H.addMesh(g, H.box(10, 10, 16), MET, -8, 81, 0);
    var ring = new H.THREE.TorusGeometry(6, 2, 6, 12);             // 竖立吊挂环，供吊钩挂取
    H.addMesh(g, ring, MET, 0, 84, 0);

    /* --- 侧面标签牌 + 把手 + 快拆卡扣 --- */
    H.addMesh(g, H.box(44, 26, 3), PLATE, 0, 50, 47);              // 标签牌
    H.addMesh(g, H.box(34, 4, 4), ORANGE, 0, 34, 47.5);            // 标签橙色条码
    H.addMesh(g, H.box(26, 12, 3), GLOW, 0, 24, 47);               // 侧面电子铭牌
    H.addMesh(g, H.box(8, 16, 5), MET, 40, 71, 48);                // 快拆卡扣 ×4
    H.addMesh(g, H.box(8, 16, 5), MET, -40, 71, 48);
    H.addMesh(g, H.box(8, 16, 5), MET, 40, 71, -48);
    H.addMesh(g, H.box(8, 16, 5), MET, -40, 71, -48);
    H.addMesh(g, H.box(6, 6, 14), MET, 57.5, 51, 22);              // 快拆轴销 ×4
    H.addMesh(g, H.box(6, 6, 14), MET, -57.5, 51, 22);
    H.addMesh(g, H.box(6, 6, 14), MET, 57.5, 51, -22);
    H.addMesh(g, H.box(6, 6, 14), MET, -57.5, 51, -22);
    H.addMesh(g, H.box(4, 6, 22), MET, 58.5, 42, 38);              // 可拆侧板提手
    H.addMesh(g, H.box(4, 6, 22), MET, -58.5, 42, 38);
    H.addMesh(g, H.box(4, 6, 22), MET, 58.5, 42, -38);
    H.addMesh(g, H.box(4, 6, 22), MET, -58.5, 42, -38);

    return finish(H, g, { x: 120, y: 90, z: 100 }, true);
  }

  /* =======================================================================
     4. 投放点标记平台 dropPad(H) —— 300 × 300 cm、高约 22 cm，贴地
        低矮平台 + 中心十字与方框 + 四角定位块 + 橙色边界条
     ======================================================================= */
  function dropPad(H) {
    var g = new H.THREE.Group();

    var BASE = H.std({ color: C_BLACK, roughness: 0.88, metalness: 0.22 });
    var PAINT = H.std({ color: C_GREY2, roughness: 0.90, metalness: 0.10 });
    var ORANGE = H.std({ color: C_ORANGE, roughness: 0.60, metalness: 0.10 });
    var WHITE = H.std({ color: C_WHITE, roughness: 0.70, metalness: 0.06 });
    var YEL = H.std({ color: C_YELLOW, roughness: 0.62, metalness: 0.10 });
    var MET = H.std({ color: C_METAL, roughness: 0.40, metalness: 0.80 });

    /* --- 低矮平台 300 × 300（0 ~ 12） --- */
    H.addMesh(g, H.box(300, 12, 300), BASE, 0, 6, 0);
    H.addMesh(g, H.box(240, 6, 6), MET, 0, 3, 147);                // 底缘检修压条
    H.addMesh(g, H.box(240, 6, 6), MET, 0, 3, -147);
    H.addMesh(g, H.box(6, 6, 240), MET, 147, 3, 0);
    H.addMesh(g, H.box(6, 6, 240), MET, -147, 3, 0);

    /* --- 外围喷涂层边框（270 见方） --- */
    H.addMesh(g, H.box(270, 3, 16), PAINT, 0, 13.5, 137);
    H.addMesh(g, H.box(270, 3, 16), PAINT, 0, 13.5, -137);
    H.addMesh(g, H.box(16, 3, 270), PAINT, 137, 13.5, 0);
    H.addMesh(g, H.box(16, 3, 270), PAINT, -137, 13.5, 0);

    /* --- 中心方框 --- */
    H.addMesh(g, H.box(120, 3, 12), WHITE, 0, 15, 60);
    H.addMesh(g, H.box(120, 3, 12), WHITE, 0, 15, -60);
    H.addMesh(g, H.box(12, 3, 120), WHITE, 60, 15, 0);
    H.addMesh(g, H.box(12, 3, 120), WHITE, -60, 15, 0);

    /* --- 中心十字（橙色，压在方框之上） --- */
    cross(H, g, ORANGE, 0, 17, 0, 200, 26, 3, 'y');

    /* --- 四角定位块（黄黑警示） --- */
    [-1, 1].forEach(function (sx) {
      [-1, 1].forEach(function (sz) {
        H.addMesh(g, H.box(34, 10, 34), BASE, 118 * sx, 17, 118 * sz);
        H.addMesh(g, H.box(22, 4, 22), YEL, 118 * sx, 24, 118 * sz);
        H.addMesh(g, H.cyl(6, 6, 5, 6), MET, 130 * sx, 14, 130 * sz);   // 定位螺栓
      });
    });

    /* --- 橙色边界条 ×4（最外缘） --- */
    H.addMesh(g, H.box(300, 5, 22), ORANGE, 0, 14.5, 139);
    H.addMesh(g, H.box(300, 5, 22), ORANGE, 0, 14.5, -139);
    H.addMesh(g, H.box(22, 5, 300), ORANGE, 139, 14.5, 0);
    H.addMesh(g, H.box(22, 5, 300), ORANGE, -139, 14.5, 0);

    /* --- 四角 45° 斜标 --- */
    H.addMesh(g, H.box(60, 4, 10), ORANGE, 108, 14, 108, 0, Math.PI / 4, 0);
    H.addMesh(g, H.box(60, 4, 10), ORANGE, -108, 14, 108, 0, -Math.PI / 4, 0);
    H.addMesh(g, H.box(60, 4, 10), ORANGE, 108, 14, -108, 0, -Math.PI / 4, 0);
    H.addMesh(g, H.box(60, 4, 10), ORANGE, -108, 14, -108, 0, Math.PI / 4, 0);

    return finish(H, g, { x: 300, y: 22, z: 300 }, true);
  }

  /* =======================================================================
     5. 地面保障车 serviceCart(H) —— 长 260 × 宽 140 × 高约 165 cm，车头朝 +Z，贴地
        小型电动保障车：车身 + 驾驶台 + 货斗（电池 / 工具箱）+ 4 轮 + 顶部警示灯
     ======================================================================= */
  function serviceCart(H) {
    var g = new H.THREE.Group();

    var BODY = H.std({ color: C_BLACK, roughness: 0.84, metalness: 0.24 });
    var BODY2 = H.std({ color: C_GREY, roughness: 0.80, metalness: 0.28 });
    var DARK = H.std({ color: 0x14171a, roughness: 0.92, metalness: 0.18 });
    var RUB = H.std({ color: 0x1d1e20, roughness: 0.97, metalness: 0.04 });
    var MET = H.std({ color: C_METAL, roughness: 0.34, metalness: 0.86 });
    var ORANGE = H.std({ color: C_ORANGE, roughness: 0.52, metalness: 0.14 });
    var YEL = H.std({ color: C_YELLOW, roughness: 0.55, metalness: 0.12 });
    var GLASS = H.std({
      color: 0x1b2429, roughness: 0.08, metalness: 0.55,
      emissive: 0x14343f, emissiveIntensity: 0.35
    });
    var HEAD = glowMat(H, C_WHITE, 0.7, 0xe6eef4);
    var AMBER = glowMat(H, C_ORANGE2, 1.8, 0x3a1c06);
    var CYAN = glowMat(H, C_CYAN, 1.3, 0x0a2630);

    /* --- 底盘大梁 + 上装底板 --- */
    H.addMesh(g, H.box(124, 20, 230), DARK, 0, 46, 0);             // 36 ~ 56
    H.addMesh(g, H.box(136, 10, 236), BODY2, 0, 61, 0);            // 56 ~ 66
    H.addMesh(g, H.box(140, 8, 16), DARK, 0, 50, 122);             // 前横梁
    H.addMesh(g, H.box(140, 8, 16), DARK, 0, 50, -122);            // 后横梁

    /* --- 4 轮 + 轮毂 + 挡泥板（最低点由 finish 统一贴地） --- */
    [-1, 1].forEach(function (s) {
      wheel(H, g, RUB, 60 * s, 24, 82, 24, 16, 10);
      wheel(H, g, RUB, 60 * s, 24, -82, 24, 16, 10);
      H.addMesh(g, cylX(H, 10, 18, 8), MET, 60 * s, 24, 82);
      H.addMesh(g, cylX(H, 10, 18, 8), MET, 60 * s, 24, -82);
      H.addMesh(g, H.box(24, 10, 72), BODY, 58 * s, 54, 82);       // 挡泥板
      H.addMesh(g, H.box(24, 10, 72), BODY, 58 * s, 54, -82);
    });

    /* --- 货斗（后段）：底板 + 侧板 + 尾板 --- */
    H.addMesh(g, H.box(132, 12, 130), BODY2, 0, 72, -56);          // 66 ~ 78
    H.addMesh(g, H.box(10, 40, 130), BODY, 65, 98, -56);           // 侧板 78 ~ 118
    H.addMesh(g, H.box(10, 40, 130), BODY, -65, 98, -56);
    H.addMesh(g, H.box(132, 40, 8), BODY, 0, 98, -126);            // 尾板
    H.addMesh(g, H.box(140, 6, 6), ORANGE, 0, 120, -126);          // 尾板橙色压条

    /* --- 货斗内的电池箱与工具箱 --- */
    H.addMesh(g, H.box(58, 34, 58), DARK, -30, 95, -62);           // 电池箱
    H.addMesh(g, H.box(48, 4, 48), CYAN, -30, 114, -62);           // 电池状态灯面
    H.addMesh(g, H.box(46, 26, 44), MET, 32, 91, -30);             // 工具箱
    H.addMesh(g, H.box(30, 4, 34), BODY, 32, 106, -30);            // 箱盖
    H.addMesh(g, H.box(22, 22, 18), MET, 40, 90, -104);            // 卷线盘
    H.addMesh(g, H.box(6, 6, 24), RUB, 0, 66, -104);               // 盘绕线缆

    /* --- 驾驶台（前段）：前围 + 仪表面板 + 转向柱 + 座椅 --- */
    H.addMesh(g, H.box(134, 62, 14), BODY, 0, 99, 118);            // 前围 66 ~ 128
    H.addMesh(g, H.box(138, 6, 18), BODY2, 0, 131, 118);           // 前围顶沿
    H.addMesh(g, H.box(126, 22, 40), BODY2, 0, 90, 100);           // 仪表面板 79 ~ 101
    H.addMesh(g, H.box(70, 26, 6), GLASS, -26, 92, 120);           // 小仪表屏
    H.addMesh(g, H.box(30, 12, 6), CYAN, 30, 92, 120);             // 电量指示
    H.addMesh(g, H.cyl(4.5, 4.5, 32, 8), MET, 0, 118, 96, 0.5, 0, 0); // 转向柱
    H.addMesh(g, H.box(56, 5, 7), DARK, 0, 130, 90);               // 车把
    H.addMesh(g, H.box(56, 14, 46), BODY, 0, 87, 42);              // 坐垫 80 ~ 94
    H.addMesh(g, H.box(56, 40, 12), BODY, 0, 110, 20);             // 靠背 90 ~ 130
    H.addMesh(g, H.box(60, 5, 5), ORANGE, 0, 131, 20);             // 靠背橙色顶条

    /* --- 前保险杠 / 大灯 / 后视镜 --- */
    H.addMesh(g, H.box(130, 12, 12), DARK, 0, 62, 124);
    H.addMesh(g, H.box(18, 12, 6), HEAD, 44, 96, 126);             // 前大灯
    H.addMesh(g, H.box(18, 12, 6), HEAD, -44, 96, 126);
    H.addMesh(g, H.box(8, 8, 8), DARK, 63, 122, 104);              // 后视镜臂
    H.addMesh(g, H.box(8, 8, 8), DARK, -63, 122, 104);
    H.addMesh(g, H.box(4, 20, 14), MET, 67, 120, 104);             // 镜面
    H.addMesh(g, H.box(4, 20, 14), MET, -67, 120, 104);

    /* --- 车身加强筋 --- */
    H.addMesh(g, H.box(4, 26, 200), BODY2, 68, 70, 0);
    H.addMesh(g, H.box(4, 26, 200), BODY2, -68, 70, 0);

    /* --- 顶部警示灯：立柱 + 底座 + 橙色灯罩 --- */
    H.addMesh(g, H.cyl(4, 4, 20, 6), MET, 0, 141, 116);            // 128 ~ 148
    H.addMesh(g, H.box(24, 6, 24), DARK, 0, 151, 116);
    H.addMesh(g, H.cyl(12, 11, 16, 10), AMBER, 0, 158, 116);       // 灯罩 150 ~ 166

    return finish(H, g, { x: 140, y: 165, z: 260 }, true);
  }

  /* =======================================================================
     6. 充电 / 换电桩 chargeStation(H) —— 宽 130 × 深 90 × 高约 215 cm，贴地
        立式机柜 + 散热格栅 + 顶部青色状态灯 + 侧面充电枪与线缆 + 底座
     ======================================================================= */
  function chargeStation(H) {
    var g = new H.THREE.Group();

    var BODY = H.std({ color: C_BLACK, roughness: 0.82, metalness: 0.26 });
    var PANEL = H.std({ color: C_GREY, roughness: 0.78, metalness: 0.30 });
    var DARK = H.std({ color: 0x14171a, roughness: 0.92, metalness: 0.18 });
    var MET = H.std({ color: C_METAL, roughness: 0.32, metalness: 0.88 });
    var ORANGE = H.std({ color: C_ORANGE, roughness: 0.52, metalness: 0.14 });
    var GLASS = H.std({
      color: 0x101820, roughness: 0.10, metalness: 0.50,
      emissive: 0x0e3a44, emissiveIntensity: 0.55
    });
    var CYAN = glowMat(H, C_CYAN, 1.9, 0x07242a);
    var ORGLOW = glowMat(H, C_ORANGE2, 1.4, 0x2a1206);

    /* --- 底座 + 地脚螺栓 --- */
    H.addMesh(g, H.box(130, 14, 90), DARK, 0, 7, 0);               // 0 ~ 14
    H.addMesh(g, H.box(124, 4, 84), PANEL, 0, 15, 0);              // 底座压边
    [-1, 1].forEach(function (sx) {
      [-1, 1].forEach(function (sz) {
        H.addMesh(g, H.cyl(5, 5, 6, 6), MET, 58 * sx, 17, 38 * sz);
      });
    });

    /* --- 柜体：超椭圆截面放样，四角带圆（沿 Z 挤出） --- */
    var SEC = [
      { z: -35, w: 110, h: 176, y: 102, n: 5.0 },
      { z: -12, w: 114, h: 178, y: 102, n: 5.0 },
      { z: 35, w: 110, h: 176, y: 102, n: 5.0 }
    ];
    g.add(new H.THREE.Mesh(H.loftGeo(SEC, { part: 'full', seg: 12, cap: true }), [BODY, PANEL]));

    /* --- 柜顶 + 顶部青色状态灯 --- */
    H.addMesh(g, H.box(116, 10, 76), PANEL, 0, 195, 0);            // 190 ~ 200
    H.addMesh(g, H.box(88, 14, 36), CYAN, 0, 207, 0);              // 状态灯 200 ~ 214
    H.addMesh(g, H.box(20, 14, 20), ORGLOW, 0, 207, 30);           // 橙色告警灯
    H.addMesh(g, H.box(96, 4, 44), DARK, 0, 216, 0);               // 灯罩顶盖

    /* --- 前脸：面板 + 显示屏 + 铭牌 + 散热格栅 --- */
    H.addMesh(g, H.box(96, 132, 8), PANEL, 0, 112, 36);            // 前面板
    H.addMesh(g, H.box(76, 52, 4), GLASS, 0, 142, 42);             // 显示屏
    H.addMesh(g, H.box(60, 6, 3), CYAN, 0, 118, 42);               // 屏幕下沿指示条
    H.addMesh(g, H.box(44, 22, 3), ORANGE, -22, 88, 40);           // 橙色铭牌
    H.addMesh(g, H.box(44, 10, 3), PANEL, 22, 88, 40);             // 标识牌
    var i;
    for (i = 0; i < 7; i++) {                                      // 前散热格栅 ×7
      H.addMesh(g, H.box(76, 5, 4), DARK, 0, 32 + i * 10, 38);
    }

    /* --- 侧面散热格栅 ×5 + 检修门 --- */
    for (i = 0; i < 5; i++) {
      H.addMesh(g, H.box(4, 5, 46), DARK, -56, 44 + i * 11, 0);
    }
    H.addMesh(g, H.box(4, 68, 50), PANEL, 56, 150, -6);            // 侧面检修门
    H.addMesh(g, H.box(3, 6, 26), MET, 59, 150, -6);               // 门把手
    H.addMesh(g, H.box(4, 30, 30), DARK, 56, 96, 20);              // 充电枪挂座

    /* --- 充电枪 + 线缆 --- */
    H.addMesh(g, H.box(16, 24, 22), DARK, 65, 118, 20);            // 枪体
    H.addMesh(g, H.box(10, 12, 12), MET, 74, 116, 20);             // 枪头
    H.addMesh(g, H.box(6, 8, 8), ORANGE, 60, 130, 20);             // 释放按钮
    H.addMesh(g, H.box(8, 8, 12), MET, 56, 118, 20);               // 枪尾护套
    span(H, g, DARK, 56, 124, 20, 60, 96, 30, 3, 6);
    span(H, g, DARK, 60, 96, 30, 58, 60, 26, 3, 6);
    span(H, g, DARK, 58, 60, 26, 52, 40, 12, 3, 6);

    /* --- 顶部吊装耳 + 线缆挂钩 --- */
    H.addMesh(g, H.box(16, 10, 10), MET, -34, 201, -20);
    H.addMesh(g, H.box(16, 10, 10), MET, 34, 201, -20);
    H.addMesh(g, H.box(6, 6, 22), MET, 58, 70, -30);
    H.addMesh(g, H.box(6, 6, 22), MET, -58, 70, -30);

    return finish(H, g, { x: 130, y: 218, z: 90 }, true);
  }

  /* =======================================================================
     7. 场地信标灯柱 beaconTower(H) —— 约 60 × 266 × 60 cm，贴地
        细立柱 + 顶部橙色发光指示灯 + 中部反光条 + 底座
     ======================================================================= */
  function beaconTower(H) {
    var g = new H.THREE.Group();

    var DARK = H.std({ color: C_BLACK, roughness: 0.82, metalness: 0.28 });
    var MET = H.std({ color: C_METAL, roughness: 0.32, metalness: 0.86 });
    var YEL = H.std({ color: C_YELLOW, roughness: 0.48, metalness: 0.18 });
    var ORANGE = H.std({ color: C_ORANGE, roughness: 0.52, metalness: 0.14 });
    var LAMP = glowMat(H, C_ORANGE2, 2.0, 0x3a1a05);
    var CORE = glowMat(H, 0xffd9b0, 1.4, 0x2a1008);

    /* --- 底座 + 地脚螺栓（最低点 0） --- */
    H.addMesh(g, H.cyl(24, 30, 16, 12), DARK, 0, 8, 0);            // 0 ~ 16
    H.addMesh(g, H.cyl(19, 19, 4, 12), MET, 0, 18, 0);             // 底座压盖
    var i;
    for (i = 0; i < 3; i++) {
      H.addMesh(g, H.cyl(4, 4, 6, 6), MET,
        Math.sin(i * 2.0944) * 22, 17, Math.cos(i * 2.0944) * 22);
    }

    /* --- 细立柱 --- */
    H.addMesh(g, H.cyl(6, 8.5, 200, 8), MET, 0, 120, 0);           // 20 ~ 220
    H.addMesh(g, H.cyl(11, 11, 6, 8), DARK, 0, 60, 0);             // 加强环
    H.addMesh(g, H.cyl(11, 11, 6, 8), DARK, 0, 150, 0);

    /* --- 中部反光条 ×3（黄 / 橙交替） --- */
    H.addMesh(g, H.cyl(9.2, 9.2, 16, 8), YEL, 0, 92, 0);
    H.addMesh(g, H.cyl(9.2, 9.2, 16, 8), ORANGE, 0, 122, 0);
    H.addMesh(g, H.cyl(9.2, 9.2, 16, 8), YEL, 0, 178, 0);

    /* --- 顶部指示灯：灯座 + 橙色发光灯罩 + 顶盖 --- */
    H.addMesh(g, H.cyl(14, 19, 14, 10), DARK, 0, 227, 0);          // 灯座 220 ~ 234
    H.addMesh(g, H.cyl(17, 17, 30, 10), LAMP, 0, 249, 0);          // 灯罩 234 ~ 264
    H.addMesh(g, H.cyl(9, 9, 26, 8), CORE, 0, 248, 0);             // 灯芯
    H.addMesh(g, H.cyl(19, 19, 6, 10), DARK, 0, 267, 0);           // 顶盖 264 ~ 270

    /* --- 检修挂钩 + 编号牌 --- */
    H.addMesh(g, H.box(4, 34, 8), MET, 11, 52, 0);
    H.addMesh(g, H.box(4, 16, 22), ORANGE, 10, 70, 0);

    return finish(H, g, { x: 60, y: 270, z: 60 }, true);
  }

  /* =======================================================================
     8. 地面气流尘环特效 dustRing(H) —— 直径约 720 cm，平铺贴地，原点居中
        多层半透明环 + 贴地尘团，用于悬停时地面气流的视觉表现
     ======================================================================= */
  function dustRing(H) {
    var g = new H.THREE.Group();

    var RING = H.std({
      color: 0xb9b2a4, roughness: 0.99, metalness: 0.0,
      transparent: true, opacity: 0.32, side: H.THREE.DoubleSide, depthWrite: false
    });
    var RING2 = H.std({
      color: 0xcfc7b8, roughness: 0.99, metalness: 0.0,
      transparent: true, opacity: 0.20, side: H.THREE.DoubleSide, depthWrite: false
    });
    var HAZE = H.std({
      color: 0xd8d2c4, roughness: 0.99, metalness: 0.0,
      transparent: true, opacity: 0.24, depthWrite: false
    });
    var HAZE2 = H.std({
      color: 0x9aa3a9, roughness: 0.99, metalness: 0.0,
      transparent: true, opacity: 0.16, depthWrite: false
    });

    /* --- 三层同心薄环（贴地，略高于 0） --- */
    H.addMesh(g, flatRing(H, 150, 330, 40), RING, 0, 0.6, 0);
    H.addMesh(g, flatRing(H, 330, 360, 36), RING2, 0, 1.4, 0);
    H.addMesh(g, flatRing(H, 70, 140, 32), RING2, 0, 1.0, 0);

    /* --- 贴地尘团：压扁球体，球心取 y = 半高，正好压在 y = 0 上 --- */
    var i, a, r, ry, geo, m;
    for (i = 0; i < 6; i++) {
      a = hash(i * 3 + 1) * Math.PI * 2;
      r = 150 + hash(i * 3 + 2) * 190;
      ry = 14 + hash(i * 3 + 3) * 12;
      geo = new H.THREE.SphereGeometry(ry, 7, 5);
      /* +0.05 抵消 float32 顶点取整，确保最低点不被压到 y < 0 之下 */
      m = H.addMesh(g, geo, i % 3 === 0 ? HAZE2 : HAZE,
        Math.sin(a) * r, ry * 0.55 + 0.05, Math.cos(a) * r);
      m.scale.set(1.5 + hash(i + 21) * 0.8, 0.55, 1.5 + hash(i + 31) * 0.8);
    }

    /* --- 地面拉出的薄气流片（最低点精确落在 y = 0） --- */
    for (i = 0; i < 4; i++) {
      a = i * Math.PI / 2 + 0.6;
      H.addMesh(g, H.box(240, 3, 26), RING2,
        Math.sin(a) * 210, 1.5, Math.cos(a) * 210, 0, a, 0);
    }

    return finish(H, g, { x: 720, y: 30, z: 720 }, true);
  }

  /* =======================================================================
     9. 单个气流涡团 windPuff(H) —— 直径约 90 cm，原点居中，供随机摆放
     ======================================================================= */
  function windPuff(H) {
    var g = new H.THREE.Group();

    var WISP = H.std({
      color: 0xcfc7b8, roughness: 0.99, metalness: 0.0,
      transparent: true, opacity: 0.34, depthWrite: false
    });
    var WISP2 = H.std({
      color: 0x9aa3a9, roughness: 0.99, metalness: 0.0,
      transparent: true, opacity: 0.22, depthWrite: false
    });

    var core = H.addMesh(g, new H.THREE.SphereGeometry(24, 8, 6), WISP, 0, 0, 0);
    core.scale.set(1.25, 0.85, 1.1);

    var i, a, r, geo, m;
    for (i = 0; i < 3; i++) {
      a = hash(i * 5 + 2) * Math.PI * 2;
      r = 22 + hash(i * 5 + 3) * 16;
      geo = new H.THREE.SphereGeometry(13 + hash(i * 5 + 4) * 7, 7, 5);
      m = H.addMesh(g, geo, i === 1 ? WISP2 : WISP,
        Math.sin(a) * r, (hash(i + 40) - 0.5) * 26, Math.cos(a) * r);
      m.scale.set(1.1, 0.9, 1.1);
    }

    /* --- 顶部被抽走的气流尾迹（与主团相接，不悬空） --- */
    H.addMesh(g, H.box(16, 12, 16), WISP2, 6, 26, -4, 0.4, 0.6, 0);

    return finish(H, recenter(H, g), { x: 90, y: 80, z: 90 });
  }

  /* =======================================================================
     10. 导出：挂到 window，供引擎动态加载后调用
     ======================================================================= */
  window.DJILogistics = {
    hpad: hpad,
    hpadLight: hpadLight,
    cargoBox: cargoBox,
    dropPad: dropPad,
    serviceCart: serviceCart,
    chargeStation: chargeStation,
    beaconTower: beaconTower,
    dustRing: dustRing,
    windPuff: windPuff
  };
})();