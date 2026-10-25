/* ============================================================================
 * DJI MEDICAL AID · 地面医用道具与特效几何模块 (casualties.js)
 * ----------------------------------------------------------------------------
 * 纯几何模块：不依赖任何外部资源文件，全部网格由代码生成。
 *
 * 约定
 *   · 单位：cm；y 轴向上；地面道具（伤员 / 帐篷 / 救护车 / 物资箱 / 标记 /
 *     输液架）的包围盒最低点严格落在 y = 0，group 原点留在底盘 / 地面平面
 *   · 朝向：+Z 为正面（救护车车头、伤员头部方向）
 *   · 涂装：医疗白 / 浅灰 / 深灰金属 + 医疗红、医疗绿；沙色与橄榄军绿
 *     只出现在伤员衣物上，绝不出现武器 / 炮管 / 弹药等攻击性元素
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
     0. 通用几何工具
     ======================================================================= */

  /**
   * 收尾：量出 group 的包围盒尺寸写进 userData.size（引擎据此绘制标记框）
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

  /** 空中特效：整组子节点平移，使包围盒中心落在 group 原点 */
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

  /** 轴向为 X 的圆柱（车轮） */
  function cylX(H, r, len, seg) {
    var geo = H.cyl(r, r, len, seg || 9);
    geo.rotateZ(Math.PI / 2);
    return geo;
  }

  /** 车轮：轮心取 y ≈ 半径，最低点贴近 y = 0（多边形的细微悬空由 finish 统一对齐） */
  function wheel(H, parent, mt, x, y, z, r, w, seg) {
    return H.addMesh(parent, cylX(H, r, w, seg || 9), mt, x, y, z);
  }

  /** 自发光材质：toneMapped 关掉，否则 ACES 色调映射会把指示灯压成灰 */
  function glowMat(H, color, intensity, base) {
    var m = H.std({
      color: base === undefined ? color : base,
      emissive: color, emissiveIntensity: intensity || 1.0,
      roughness: 0.45, metalness: 0.0
    });
    m.toneMapped = false;
    return m;
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

  /** 软管 / 拉绳：按两端点摆放一段圆柱（placeAlong 负责朝向） */
  function span(H, parent, mt, ax, ay, az, bx, by, bz, r, seg) {
    var dx = bx - ax, dy = by - ay, dz = bz - az;
    var len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    var m = H.addMesh(parent, H.cylZ(r, r, len, seg || 5), mt, 0, 0, 0);
    H.placeAlong(m,
      new H.THREE.Vector3(ax, ay, az),
      new H.THREE.Vector3(bx, by, bz));
    return m;
  }

  /** 确定性伪随机（避免烟雾团每次构建都换位置） */
  function hash(i) {
    var v = Math.sin(i * 12.9898 + 4.1414) * 43758.5453;
    return v - Math.floor(v);
  }

  /* =======================================================================
     1. 重伤员 wounded(H) —— 仰卧昏迷，约 178 × 63 × 32 cm，贴地
     ======================================================================= */
  function wounded(H) {
    var g = new H.THREE.Group();

    var SKIN = H.std({ color: 0xc9a184, roughness: 0.86, metalness: 0.02 });
    var UNI = H.std({ color: 0x4a5240, roughness: 0.94, metalness: 0.03 });   // 橄榄军绿上衣
    var PANT = H.std({ color: 0x8a7a5c, roughness: 0.95, metalness: 0.02 });  // 沙色裤
    var BAND = H.std({ color: 0xe8eef2, roughness: 0.92, metalness: 0.02 });  // 绷带 / 敷料
    var DARK = H.std({ color: 0x3a4148, roughness: 0.78, metalness: 0.26 });
    var BLOOD = H.std({ color: 0x6e1f18, roughness: 0.52, metalness: 0.02 });
    var LAMP = glowMat(H, 0xd94f3d, 1.5, 0x2a0f0d);

    /* --- 地面血迹：薄圆片，将成为整组的最低点（y = 0） --- */
    H.addMesh(g, H.cyl(27, 30, 0.16, 14), BLOOD, 3, 0.08, 26);
    H.addMesh(g, H.cyl(13, 16, 0.14, 12), BLOOD, 15, 0.07, -16);

    /* --- 下肢：仰卧伸直，脚尖朝 -Z --- */
    [-1, 1].forEach(function (s) {
      H.addMesh(g, H.box(15, 15, 16), DARK, 11.5 * s, 7.5, -76);       // 作战靴 -84 ~ -68
      H.addMesh(g, H.box(15, 16, 36), PANT, 11.5 * s, 9, -50);         // 小腿 -68 ~ -32
      H.addMesh(g, H.box(19, 19, 32), PANT, 11.5 * s, 10, -16);        // 大腿 -32 ~ 0
      H.addMesh(g, H.box(17, 18, 13), BAND, 11.5 * s, 9, -58);         // 小腿包扎
    });

    /* --- 躯干 --- */
    H.addMesh(g, H.box(36, 24, 20), PANT, 0, 13, 8);                   // 骨盆 -2 ~ 18
    H.addMesh(g, H.box(40, 26, 42), UNI, 0, 14, 37);                   // 胸腹 16 ~ 58
    H.addMesh(g, H.box(44, 24, 14), UNI, 0, 13, 60);                   // 肩 53 ~ 67
    H.addMesh(g, H.box(46, 10, 18), BAND, 0, 24, 40);                  // 胸前加压敷料
    H.addMesh(g, H.box(11, 11, 10), SKIN, 0, 12, 69);                  // 颈 64 ~ 74

    var head = H.addMesh(g, new H.THREE.SphereGeometry(10, 12, 9), SKIN, 0, 13.5, 83);
    head.scale.set(0.92, 1.0, 1.15);                                   // 头 71.5 ~ 94.5
    H.addMesh(g, H.box(20, 15, 9), BAND, 0, 20, 76);                   // 头部包扎
    H.addMesh(g, H.box(28, 10, 24), BAND, 0, 5, 82);                   // 头枕

    /* --- 双臂：沿体侧自然摊开 --- */
    [-1, 1].forEach(function (s) {
      H.addMesh(g, H.box(11, 12, 32), UNI, 25 * s, 11, 42);            // 上臂 26 ~ 58
      H.addMesh(g, H.box(10, 10, 30), SKIN, 26.5 * s, 8, 12);          // 前臂 -3 ~ 27
      H.addMesh(g, H.box(9, 8, 12), SKIN, 27 * s, 7, -8);              // 手
    });
    H.addMesh(g, H.box(13, 13, 14), BAND, 26.5, 11, 18);               // 右前臂包扎

    /* --- 微弱红色生命灯（贴在胸口，雷达 / 医疗扫描可发现） --- */
    H.addMesh(g, H.box(6, 4, 6), LAMP, 0, 28, 50);

    return finish(H, g, { x: 63, y: 32, z: 178 }, true);
  }

  /* =======================================================================
     2. 轻伤员 walkingwounded(H) —— 盘腿坐地等待，约 80 × 95 × 80 cm，贴地
     ======================================================================= */
  function walkingwounded(H) {
    var g = new H.THREE.Group();

    var SKIN = H.std({ color: 0xc9a184, roughness: 0.86, metalness: 0.02 });
    var UNI = H.std({ color: 0x4a5240, roughness: 0.94, metalness: 0.03 });
    var PANT = H.std({ color: 0x8a7a5c, roughness: 0.95, metalness: 0.02 });
    var BAND = H.std({ color: 0xe8eef2, roughness: 0.92, metalness: 0.02 });
    var DARK = H.std({ color: 0x3a4148, roughness: 0.78, metalness: 0.26 });
    var BLANK = H.std({ color: 0xb9c2c8, roughness: 0.96, metalness: 0.02 }); // 保温毯

    /* --- 盘腿：两条大腿向前外侧张开，小腿收回身前交叉 --- */
    H.addMesh(g, H.box(34, 20, 20), PANT, 0, 18, 4);                   // 骨盆
    H.addMesh(g, H.box(18, 18, 38), PANT, 14, 11, 16, 0, 0.50, 0);     // 左大腿
    H.addMesh(g, H.box(18, 18, 38), PANT, -14, 11, 16, 0, -0.50, 0);   // 右大腿
    H.addMesh(g, H.box(16, 16, 34), PANT, 12.5, 11, 46.5, 0, -0.66, 0); // 左小腿收回
    H.addMesh(g, H.box(16, 16, 34), PANT, -12.5, 11, 46.5, 0, 0.66, 0); // 右小腿收回
    H.addMesh(g, H.box(14, 12, 18), DARK, 3, 6, 64, 0, -0.66, 0);      // 交叠的作战靴
    H.addMesh(g, H.box(14, 12, 18), DARK, -3, 6, 68, 0, 0.66, 0);
    H.addMesh(g, H.box(18, 18, 13), BAND, -12.5, 11, 46.5, 0, 0.66, 0); // 小腿包扎

    /* --- 躯干 --- */
    H.addMesh(g, H.box(38, 34, 24), UNI, 0, 45, 2);                    // 腰背 28 ~ 62
    H.addMesh(g, H.box(42, 16, 22), UNI, 0, 62, 2);                    // 肩 54 ~ 70
    H.addMesh(g, H.box(44, 12, 26), BLANK, 0, 68, 2);                  // 披在肩上的保温毯
    H.addMesh(g, H.box(11, 10, 10), SKIN, 0, 74, 3);                   // 颈

    var head = H.addMesh(g, new H.THREE.SphereGeometry(10, 12, 9), SKIN, 0, 84, 3);
    head.scale.set(0.92, 1.05, 1.0);                                   // 头 73.5 ~ 94.5
    H.addMesh(g, H.box(20, 13, 10), BAND, 0, 88, 3);                   // 头部包扎

    /* --- 右手扶膝，左臂撑在身后 --- */
    H.addMesh(g, H.box(11, 11, 26), UNI, 21, 50, 8, -0.47, 0, 0);      // 右上臂
    H.addMesh(g, H.box(10, 10, 24), SKIN, 22, 34, 23, -0.98, 0, 0);    // 右前臂
    H.addMesh(g, H.box(9, 8, 11), SKIN, 23, 27, 33);                   // 扶膝的手
    H.addMesh(g, H.box(13, 13, 14), BAND, 22, 34, 23, -0.98, 0, 0);    // 右前臂包扎
    H.addMesh(g, H.box(11, 11, 30), UNI, -21, 48, -2, 0.34, 0, 0);     // 左上臂
    H.addMesh(g, H.box(10, 10, 26), SKIN, -22, 28, -10, 0.20, 0, 0);   // 左前臂撑地
    H.addMesh(g, H.box(9, 7, 12), SKIN, -22, 8, -14);                  // 撑地的手

    return finish(H, g, { x: 80, y: 95, z: 80 }, true);
  }

  /* =======================================================================
     3. 野外医疗帐篷 tent(H) —— 约 400 × 200 × 300 cm（不含拉绳），贴地
     ======================================================================= */
  function tent(H) {
    var g = new H.THREE.Group();

    var CANV = H.std({ color: 0xe8eef2, roughness: 0.90, metalness: 0.03 });  // 篷布
    var GABLE = H.std({ color: 0xb9c2c8, roughness: 0.88, metalness: 0.05 }); // 山墙
    var SKIRT = H.std({ color: 0x3a4148, roughness: 0.86, metalness: 0.18 }); // 地裙
    var RED = H.std({ color: 0xb03a2e, roughness: 0.70, metalness: 0.04 });
    var RED2 = H.std({ color: 0xd94f3d, roughness: 0.66, metalness: 0.04 });
    var DARK = H.std({ color: 0x2a2f34, roughness: 0.90, metalness: 0.10 });  // 门洞内暗部
    var MET = H.std({ color: 0x9aa3a9, roughness: 0.38, metalness: 0.78 });

    /* --- 主体：五边形截面沿 X 挤出（脊线沿 X，跨度 300，脊高 200） --- */
    var sec = new H.THREE.Shape();
    sec.moveTo(-150, 0);
    sec.lineTo(150, 0);
    sec.lineTo(150, 100);
    sec.lineTo(0, 200);
    sec.lineTo(-150, 100);
    sec.lineTo(-150, 0);
    var bodyGeo = new H.THREE.ExtrudeGeometry(sec, {
      depth: 400, bevelEnabled: false, steps: 1, curveSegments: 1
    });
    bodyGeo.translate(0, 0, -200);
    bodyGeo.rotateY(Math.PI / 2);   // 挤出方向转到 +X，截面 x 轴转到 ∓Z
    bodyGeo.computeVertexNormals();
    g.add(new H.THREE.Mesh(bodyGeo, [GABLE, CANV]));

    /* --- 地裙：压住篷布下沿，最低点 y = 0 --- */
    H.addMesh(g, H.box(402, 8, 302), SKIRT, 0, 4, 0);

    /* --- 前后山墙门帘（±X 面） --- */
    H.addMesh(g, H.box(4, 150, 92), DARK, 199, 76, 0);                 // 门洞暗部
    H.addMesh(g, H.box(5, 148, 44), CANV, 203, 75, -24, 0, 0.22, 0);   // 左门帘
    H.addMesh(g, H.box(5, 148, 44), CANV, 203, 75, 24, 0, -0.22, 0);   // 右门帘
    H.addMesh(g, H.box(10, 8, 104), MET, 202, 154, 0);                 // 门楣横杆
    H.addMesh(g, H.box(4, 150, 92), DARK, -199, 76, 0);                // 后墙门洞
    H.addMesh(g, H.box(5, 148, 92), CANV, -203, 75, 0);                // 后帘（闭合）

    /* --- 山墙红十字 --- */
    cross(H, g, RED, 203, 175, 0, 76, 20, 5, 'z');

    /* --- 两坡屋面红十字 --- */
    var sa = Math.atan2(100, 150);                                     // 屋面倾角 ≈ 0.588 rad
    var nz = Math.sin(sa) * 2.6, ny = Math.cos(sa) * 2.6;
    H.addMesh(g, H.box(80, 5, 20), RED2, 0, 150 + ny, 75 + nz, sa, 0, 0);
    H.addMesh(g, H.box(20, 5, 80), RED2, 0, 150 + ny, 75 + nz, sa, 0, 0);
    H.addMesh(g, H.box(80, 5, 20), RED2, 0, 150 + ny, -75 - nz, -sa, 0, 0);
    H.addMesh(g, H.box(20, 5, 80), RED2, 0, 150 + ny, -75 - nz, -sa, 0, 0);

    /* --- 四角拉绳 + 地钉 --- */
    var c = [[200, 100, 150], [200, 100, -150], [-200, 100, 150], [-200, 100, -150]];
    for (var i = 0; i < 4; i++) {
      var px = c[i][0] < 0 ? -252 : 252;
      var pz = c[i][2] < 0 ? -196 : 196;
      span(H, g, MET, c[i][0], c[i][1], c[i][2], px, 9, pz, 0.7, 4);
      H.addMesh(g, H.cyl(1.4, 0.8, 20, 5), MET, px, 8, pz, 0.34, 0, 0.22);
    }
    H.addMesh(g, H.cyl(1.2, 0.7, 16, 5), MET, 203, 7, 0, 0, 0, 0.44);   // 长边压边钉
    H.addMesh(g, H.cyl(1.2, 0.7, 16, 5), MET, -203, 7, 0, 0, 0, -0.44);

    return finish(H, g, { x: 400, y: 200, z: 300 }, true);
  }

  /* =======================================================================
     4. 野战救护车 ambulance(H) —— 约 520 × 280 × 240 cm，车头朝 +Z，贴地
     ======================================================================= */
  function ambulance(H) {
    var g = new H.THREE.Group();

    var BODY = H.std({ color: 0xe8eef2, roughness: 0.70, metalness: 0.08 });  // 医疗白厢体
    var BODY2 = H.std({ color: 0xb9c2c8, roughness: 0.68, metalness: 0.12 });
    var DARK = H.std({ color: 0x3a4148, roughness: 0.60, metalness: 0.42 });
    var RUB = H.std({ color: 0x1d1e20, roughness: 0.97, metalness: 0.04 });
    var MET = H.std({ color: 0x9aa3a9, roughness: 0.34, metalness: 0.82 });
    var GLASS = H.std({
      color: 0x1b2429, roughness: 0.08, metalness: 0.55,
      emissive: 0x14343f, emissiveIntensity: 0.35
    });
    var RED = H.std({ color: 0xb03a2e, roughness: 0.68, metalness: 0.06 });
    var RED2 = H.std({ color: 0xd94f3d, roughness: 0.62, metalness: 0.05 });
    var HEAD = glowMat(H, 0xffe6b0, 0.55, 0xe8eef2);
    var LAMP = glowMat(H, 0xd94f3d, 1.3, 0x3a1410);
    var AMBER = glowMat(H, 0xffa030, 1.0, 0x3a2408);

    /* --- 底盘大梁 --- */
    H.addMesh(g, H.box(150, 30, 480), DARK, 0, 46, -6);
    H.addMesh(g, H.box(120, 24, 130), MET, 0, 40, -120);               // 油箱 / 储物箱
    H.addMesh(g, H.box(160, 8, 20), DARK, 0, 34, 150);                 // 前横梁

    /* --- 车轮：前轴 + 后轴，最低点 y = 0 --- */
    [-1, 1].forEach(function (s) {
      wheel(H, g, RUB, 100 * s, 36, 160, 36, 26, 12);
      wheel(H, g, RUB, 100 * s, 36, -135, 36, 26, 12);
      H.addMesh(g, cylX(H, 15, 30, 10), MET, 100 * s, 36, 160);        // 轮毂
      H.addMesh(g, cylX(H, 15, 30, 10), MET, 100 * s, 36, -135);
      H.addMesh(g, H.box(30, 16, 118), DARK, 100 * s, 76, 160);        // 轮罩
      H.addMesh(g, H.box(30, 16, 118), DARK, 100 * s, 76, -135);
      H.addMesh(g, H.box(30, 52, 6), RUB, 100 * s, 26, -190);          // 挡泥帘
    });

    /* --- 厢式医疗舱（后段） --- */
    H.addMesh(g, H.box(216, 205, 330), BODY, 0, 162, -80);             // z -245 ~ 85
    H.addMesh(g, H.box(222, 10, 336), BODY2, 0, 269, -80);             // 车顶
    H.addMesh(g, H.box(220, 12, 334), BODY2, 0, 64, -80);              // 厢体下沿
    H.addMesh(g, H.box(8, 40, 300), BODY2, 108, 90, -80);              // 侧面腰线
    H.addMesh(g, H.box(8, 40, 300), BODY2, -108, 90, -80);

    /* --- 两侧红十字 --- */
    cross(H, g, RED, 111, 175, -80, 74, 20, 6, 'x');
    cross(H, g, RED, -111, 175, -80, 74, 20, 6, 'x');

    /* --- 车顶红十字（空中识别） --- */
    H.addMesh(g, H.box(126, 3, 62), BODY2, 0, 275, -80);
    cross(H, g, RED2, 0, 277.5, -80, 92, 22, 5, 'y');

    /* --- 驾驶室（前段） --- */
    H.addMesh(g, H.box(202, 150, 160), BODY, 0, 130, 166);             // z 86 ~ 246
    H.addMesh(g, H.box(206, 12, 166), BODY2, 0, 211, 166);             // 驾驶室顶
    H.addMesh(g, H.box(180, 96, 12), GLASS, 0, 160, 243, -0.24, 0, 0); // 前风挡
    H.addMesh(g, H.box(8, 60, 96), GLASS, 100, 165, 148);              // 侧窗
    H.addMesh(g, H.box(8, 60, 96), GLASS, -100, 165, 148);
    H.addMesh(g, H.box(5, 122, 3), DARK, 101, 126, 112);               // 车门缝
    H.addMesh(g, H.box(5, 122, 3), DARK, -101, 126, 112);
    H.addMesh(g, H.box(152, 44, 8), DARK, 0, 116, 248);                // 进气格栅
    H.addMesh(g, H.box(214, 30, 18), DARK, 0, 70, 252);                // 前保险杠
    H.addMesh(g, H.box(30, 20, 8), HEAD, 74, 110, 249);                // 前大灯
    H.addMesh(g, H.box(30, 20, 8), HEAD, -74, 110, 249);
    H.addMesh(g, H.box(10, 10, 24), DARK, 112, 196, 232);              // 后视镜臂
    H.addMesh(g, H.box(10, 10, 24), DARK, -112, 196, 232);
    H.addMesh(g, H.box(7, 28, 16), MET, 120, 186, 230);                // 镜面
    H.addMesh(g, H.box(7, 28, 16), MET, -120, 186, 230);

    /* --- 车顶警示灯排 --- */
    H.addMesh(g, H.box(132, 14, 44), DARK, 0, 224, 166);
    H.addMesh(g, H.box(46, 14, 32), LAMP, -42, 237, 166);
    H.addMesh(g, H.box(46, 14, 32), AMBER, 42, 237, 166);
    H.addMesh(g, H.box(30, 14, 32), AMBER, 0, 237, 166);

    /* --- 尾门 --- */
    H.addMesh(g, H.box(104, 190, 8), BODY2, 53, 152, -248);
    H.addMesh(g, H.box(104, 190, 8), BODY2, -53, 152, -248);
    H.addMesh(g, H.box(5, 190, 8), DARK, 0, 152, -249);                // 门缝
    H.addMesh(g, H.box(70, 58, 6), GLASS, 53, 205, -250);              // 尾窗
    H.addMesh(g, H.box(70, 58, 6), GLASS, -53, 205, -250);
    H.addMesh(g, H.box(7, 26, 8), MET, 14, 120, -253);                 // 门把手
    H.addMesh(g, H.box(7, 26, 8), MET, -14, 120, -253);
    cross(H, g, RED, 0, 96, -253, 68, 18, 4, 'z');                     // 尾门红十字
    H.addMesh(g, H.box(130, 10, 20), DARK, 0, 52, -252);               // 后踏板
    H.addMesh(g, H.box(8, 46, 8), MET, 96, 92, -247);                  // 尾部示廓灯杆
    H.addMesh(g, H.box(8, 46, 8), MET, -96, 92, -247);

    return finish(H, g, { x: 240, y: 280, z: 520 }, true);
  }

  /* =======================================================================
     5. 医疗物资箱 crate(H) —— 约 100 × 75 × 70 cm，贴地
     ======================================================================= */
  function crate(H) {
    var g = new H.THREE.Group();

    var BOX = H.std({ color: 0xe8eef2, roughness: 0.74, metalness: 0.06 });
    var BOX2 = H.std({ color: 0xb9c2c8, roughness: 0.72, metalness: 0.10 });
    var LID = H.std({ color: 0xf5f8fa, roughness: 0.70, metalness: 0.05 });
    var GREEN = H.std({ color: 0x3fa66a, roughness: 0.72, metalness: 0.05 });
    var RED = H.std({ color: 0xb03a2e, roughness: 0.70, metalness: 0.05 });
    var DARK = H.std({ color: 0x3a4148, roughness: 0.62, metalness: 0.38 });
    var MET = H.std({ color: 0x9aa3a9, roughness: 0.36, metalness: 0.80 });

    /* --- 箱体：白箱 + 深灰包角 + 绿封条 + 红十字 --- */
    H.addMesh(g, H.box(96, 58, 66), BOX, 0, 29, 0);                    // 箱身 0 ~ 58
    H.addMesh(g, H.box(100, 12, 70), LID, 0, 64, 0);                   // 箱盖 58 ~ 70
    H.addMesh(g, H.box(100, 7, 70), GREEN, 0, 61, 0);                  // 封条
    H.addMesh(g, H.box(100, 3, 70), DARK, 0, 56, 0);                   // 合缝线
    cross(H, g, RED, 0, 36, 34.5, 56, 14, 3, 'z');                     // 正面红十字
    cross(H, g, RED, 0, 36, -34.5, 56, 14, 3, 'z');                    // 背面红十字
    H.addMesh(g, H.box(8, 60, 8), BOX2, 46, 30, 31);                   // 四角包角
    H.addMesh(g, H.box(8, 60, 8), BOX2, -46, 30, 31);
    H.addMesh(g, H.box(8, 60, 8), BOX2, 46, 30, -31);
    H.addMesh(g, H.box(8, 60, 8), BOX2, -46, 30, -31);
    H.addMesh(g, H.box(4, 6, 26), DARK, 50, 38, 0);                    // 侧面提手
    H.addMesh(g, H.box(4, 6, 26), DARK, -50, 38, 0);
    H.addMesh(g, H.box(5, 4, 5), MET, 50, 38, 0);                      // 提手座
    H.addMesh(g, H.box(5, 4, 5), MET, -50, 38, 0);
    H.addMesh(g, H.box(38, 5, 5), DARK, 0, 73, 0);                     // 顶部提手
    H.addMesh(g, H.box(5, 7, 5), DARK, 17, 71, 0);
    H.addMesh(g, H.box(5, 7, 5), DARK, -17, 71, 0);

    return finish(H, g, { x: 100, y: 75, z: 70 }, true);
  }

  /* =======================================================================
     6. 输液架 ivstand(H) —— 约 46 × 195 × 46 cm，贴地
     ======================================================================= */
  function ivstand(H) {
    var g = new H.THREE.Group();

    var MET = H.std({ color: 0x9aa3a9, roughness: 0.30, metalness: 0.85 });
    var DARK = H.std({ color: 0x3a4148, roughness: 0.58, metalness: 0.45 });
    var BAG = H.std({
      color: 0xe8eef2, roughness: 0.32, metalness: 0.02,
      transparent: true, opacity: 0.72
    });
    var FLUID = H.std({
      color: 0xd94f3d, roughness: 0.30, metalness: 0.02,
      transparent: true, opacity: 0.78
    });
    var TUBE = H.std({ color: 0xc8d2d8, roughness: 0.45, metalness: 0.05 });
    var GREEN = H.std({ color: 0x3fa66a, roughness: 0.60, metalness: 0.10 });

    /* --- 五爪底座 + 脚轮：最低点 y = 0 --- */
    H.addMesh(g, H.cyl(9, 12, 8, 10), DARK, 0, 7, 0);
    for (var i = 0; i < 5; i++) {
      H.addMesh(g, H.box(44, 5, 8), MET, 0, 4, 0, 0, i * Math.PI * 0.4, 0);
      var ax = Math.sin(i * Math.PI * 0.4) * 22;
      var az = Math.cos(i * Math.PI * 0.4) * 22;
      H.addMesh(g, H.cyl(4, 4, 6, 6), DARK, ax, 4, az);
    }

    /* --- 立柱 --- */
    H.addMesh(g, H.cyl(1.6, 1.9, 176, 8), MET, 0, 92, 0);              // y 4 ~ 180
    H.addMesh(g, H.cyl(3.4, 3.4, 4, 8), DARK, 0, 40, 0);               // 调节环
    H.addMesh(g, H.cyl(3.4, 3.4, 4, 8), DARK, 0, 120, 0);
    H.addMesh(g, H.cyl(1.1, 1.1, 16, 8), MET, 0, 188, 0);              // 顶部延伸杆
    H.addMesh(g, H.cyl(4.5, 4.5, 3, 8), GREEN, 0, 181, 0);             // 顶部标识环

    /* --- 双挂钩 --- */
    H.addMesh(g, H.box(3, 3, 26), MET, 0, 194, 0);
    H.addMesh(g, H.cyl(1.2, 1.2, 6, 5), MET, 0, 190, 12);
    H.addMesh(g, H.cyl(1.2, 1.2, 6, 5), MET, 0, 190, -12);

    /* --- 输液袋 ×2（含液体与滴壶） --- */
    H.addMesh(g, H.box(14, 30, 8), BAG, 9, 172, 12);
    H.addMesh(g, H.box(12, 24, 6), FLUID, 9, 169, 12);
    H.addMesh(g, H.cyl(2.6, 2.6, 9, 6), TUBE, 9, 152, 12);             // 滴壶
    H.addMesh(g, H.box(12, 26, 7), BAG, -9, 174, -12);
    H.addMesh(g, H.box(10, 20, 5), FLUID, -9, 171, -12);
    H.addMesh(g, H.cyl(2.4, 2.4, 8, 6), TUBE, -9, 156, -12);

    /* --- 软管：从滴壶垂到床面高度 --- */
    span(H, g, TUBE, 9, 148, 12, 11, 110, 15, 0.5, 5);
    span(H, g, TUBE, 11, 110, 15, 9, 60, 12, 0.5, 5);
    span(H, g, TUBE, 9, 60, 12, 6, 24, 16, 0.5, 5);
    span(H, g, TUBE, -9, 152, -12, -11, 100, -16, 0.5, 5);
    span(H, g, TUBE, -11, 100, -16, -8, 40, -14, 0.5, 5);

    return finish(H, g, { x: 46, y: 195, z: 46 }, true);
  }

  /* =======================================================================
     7. 地面医疗标记 marker(H) —— 直径 160 cm、厚 4 cm，平铺贴地
     ======================================================================= */
  function marker(H) {
    var g = new H.THREE.Group();

    var WHITE = H.std({ color: 0xe8eef2, roughness: 0.86, metalness: 0.02 });
    var RED = H.std({ color: 0xb03a2e, roughness: 0.84, metalness: 0.02 });
    var RED2 = H.std({ color: 0xd94f3d, roughness: 0.82, metalness: 0.02 });
    var GREEN = H.std({ color: 0x3fa66a, roughness: 0.84, metalness: 0.02 });

    /* --- 三层同心薄圆片：白底 → 红环 → 白心 --- */
    H.addMesh(g, H.cyl(80, 80, 1.6, 24), WHITE, 0, 0.8, 0);
    H.addMesh(g, H.cyl(74, 74, 0.8, 24), RED, 0, 2.0, 0);
    H.addMesh(g, H.cyl(66, 66, 0.8, 24), WHITE, 0, 2.8, 0);

    /* --- 顶面红十字 --- */
    cross(H, g, RED2, 0, 3.7, 0, 104, 24, 1.8, 'y');

    /* --- 四角绿色定位贴（落在白心内，不越出圆盘） --- */
    H.addMesh(g, H.box(18, 1.2, 10), GREEN, 40, 3.0, 40, 0, 0.79, 0);
    H.addMesh(g, H.box(18, 1.2, 10), GREEN, -40, 3.0, 40, 0, -0.79, 0);
    H.addMesh(g, H.box(18, 1.2, 10), GREEN, 40, 3.0, -40, 0, -0.79, 0);
    H.addMesh(g, H.box(18, 1.2, 10), GREEN, -40, 3.0, -40, 0, 0.79, 0);

    return finish(H, g, { x: 160, y: 5, z: 160 }, true);
  }

  /* =======================================================================
     8. 医疗信标 beacon(H) —— 约 36 × 150 × 36 cm，贴地，可被雷达 / 扫描发现
     ======================================================================= */
  function beacon(H) {
    var g = new H.THREE.Group();

    var DARK = H.std({ color: 0x3a4148, roughness: 0.58, metalness: 0.42 });
    var MET = H.std({ color: 0x9aa3a9, roughness: 0.32, metalness: 0.82 });
    var CROSS = glowMat(H, 0xd94f3d, 1.6, 0x3a1210);
    var CORE = glowMat(H, 0xffd9d0, 1.4, 0x2a1010);
    var RING = glowMat(H, 0x3fa66a, 0.9, 0x0f2a1c);

    /* --- 底座 --- */
    H.addMesh(g, H.cyl(16, 20, 10, 10), DARK, 0, 5, 0);
    H.addMesh(g, H.cyl(13, 13, 3, 10), MET, 0, 11, 0);

    /* --- 立柱 --- */
    H.addMesh(g, H.cyl(3.2, 4.2, 96, 8), MET, 0, 60, 0);               // y 12 ~ 108
    H.addMesh(g, H.cyl(5.0, 5.0, 4, 8), RING, 0, 30, 0);               // 绿色标识环
    H.addMesh(g, H.cyl(5.0, 5.0, 4, 8), DARK, 0, 96, 0);

    /* --- 发光十字：两个互相垂直的十字面，360° 可见 --- */
    cross(H, g, CROSS, 0, 128, 0, 36, 10, 7, 'z');
    cross(H, g, CROSS, 0, 128, 0, 36, 10, 7, 'x');
    cross(H, g, CORE, 0, 128, 0, 18, 5, 9, 'z');
    cross(H, g, CORE, 0, 128, 0, 18, 5, 9, 'x');
    H.addMesh(g, new H.THREE.SphereGeometry(4.5, 10, 8), CORE, 0, 128, 0);

    return finish(H, g, { x: 36, y: 150, z: 36 }, true);
  }

  /* =======================================================================
     9. 投送落地信号烟 dropsmoke(H) —— 直径约 150 cm，原点居中
     ======================================================================= */
  function dropsmoke(H) {
    var g = new H.THREE.Group();

    var smokeTex = (H.TEX && H.TEX.smoke) ? H.TEX.smoke : null;

    var SMOKE = H.std({
      color: 0xd8d2c4, roughness: 0.98, metalness: 0.0,
      transparent: true, opacity: 0.55, map: smokeTex, depthWrite: false
    });
    var SMOKE2 = H.std({
      color: 0xb9c2c8, roughness: 0.98, metalness: 0.0,
      transparent: true, opacity: 0.42, map: smokeTex, depthWrite: false
    });
    var COR = glowMat(H, 0xd94f3d, 1.1, 0x8a3020);
    COR.transparent = true;
    COR.opacity = 0.9;
    COR.depthWrite = false;

    /* --- 落地药柱 + 少量球状烟团 --- */
    H.addMesh(g, H.cyl(9, 12, 26, 10), COR, 0, -46, 0);

    var i, a, r, geo;
    for (i = 0; i < 7; i++) {
      a = hash(i * 3 + 1) * Math.PI * 2;
      r = 22 + hash(i * 3 + 2) * 46;
      geo = new H.THREE.SphereGeometry(i < 2 ? 34 : 24, i < 2 ? 10 : 8, i < 2 ? 8 : 6);
      H.addMesh(g, geo, i % 3 === 0 ? SMOKE2 : SMOKE,
        Math.cos(a) * r * 0.7, -18 + hash(i + 40) * 62, Math.sin(a) * r * 0.7);
    }
    H.addMesh(g, new H.THREE.SphereGeometry(26, 8, 6), SMOKE, 0, 14, 0);
    H.addMesh(g, new H.THREE.SphereGeometry(20, 8, 6), SMOKE2, 8, 44, -6);

    return finish(H, recenter(H, g), { x: 150, y: 150, z: 150 });
  }

  /* =======================================================================
     10. 悬浮医疗十字特效 medcross(H) —— 80 × 80 × 20 cm，原点居中
     ======================================================================= */
  function medcross(H) {
    var g = new H.THREE.Group();

    var RED = glowMat(H, 0xd94f3d, 1.9, 0x4a1612);

    /* --- 两个薄长方体交叉成"+"，面朝 ±Z，共用同一材质 --- */
    H.addMesh(g, H.box(80, 16, 14), RED, 0, 0, 0);
    H.addMesh(g, H.box(16, 80, 14), RED, 0, 0, 0);

    return finish(H, g, { x: 80, y: 80, z: 14 });
  }

  /* =======================================================================
     11. 导出：挂到 window，供引擎动态加载后调用
     ======================================================================= */
  window.DJICasualties = {
    wounded: wounded,
    walkingwounded: walkingwounded,
    tent: tent,
    ambulance: ambulance,
    crate: crate,
    ivstand: ivstand,
    marker: marker,
    beacon: beacon,
    dropsmoke: dropsmoke,
    medcross: medcross
  };
})();