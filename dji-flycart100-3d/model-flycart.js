/* =========================================================================
   DJI FlyCart 100 物流无人机 · 机型模块（model-flycart.js）
   -------------------------------------------------------------------------
   八旋翼（4 臂 × 共轴双桨）重载物流平台：
   碳纤维机身 / 空吊系统旗舰版（绞盘 + 实时称重 + 电动开合挂钩）/ 可拆货运包装箱 /
   激光雷达 + 下视雷达 + 四目视觉 + FPV / RTK 天线 / 双电池仓 / 可展开机臂与折叠桨。
   只提供数据与几何，不含引擎逻辑。
   注意：本文件先于 Three.js 加载执行，顶层绝对不能触碰 THREE。
   ========================================================================= */
(function () {
  'use strict';

  /* ---- 关键尺寸（cm）---- */
  var SPAN = 300;                 // 含桨尖总跨度
  var ARM_A = [40, 140];          // 前后机臂方位角（度，从 +Z 机头方向起算）
  var MOTOR_R = 108;              // 电机到中心距离
  var UPPER_Y = 26, LOWER_Y = 2;  // 共轴双桨上下桨平面高度（相对机身）
  var HUB_Y = 8;                  // 机臂根部高度
  var GEAR_Y = -95;               // 起落架脚底
  var WINCH_X = 0, WINCH_Z = -46; // 空吊系统位于机腹后段

  var SEAM = -6;                  // 机身上下分缝

  /* 机身截面：紧凑的箱式机体（哑光黑 + 碳纤维），前后略收 */
  var SECTIONS = [
    { z: -78, w: 62, h: 46, y: 0, n: 3.6 },
    { z: -58, w: 86, h: 58, y: 0, n: 4.2 },
    { z: -24, w: 94, h: 62, y: 0, n: 4.6 },
    { z: 18, w: 94, h: 62, y: 0, n: 4.6 },
    { z: 50, w: 88, h: 58, y: -1, n: 4.2 },
    { z: 72, w: 70, h: 48, y: -2, n: 3.8 },
    { z: 86, w: 48, h: 34, y: -3, n: 3.2 }
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
  function armRoot(aDeg, sign) {
    var a = aDeg * Math.PI / 180 * sign;
    return new THREE.Vector3(Math.sin(a) * 40, HUB_Y, Math.cos(a) * 40);
  }
  function motorPos(aDeg, sign) {
    var a = aDeg * Math.PI / 180 * sign;
    return new THREE.Vector3(Math.sin(a) * MOTOR_R, 14, Math.cos(a) * MOTOR_R);
  }
  /* 纯数学版本（模块顶层可用，不碰 THREE）：给部件的 pivot 用 */
  function armRootArr(aDeg, sign) {
    var a = aDeg * Math.PI / 180 * sign;
    return [+(Math.sin(a) * 40).toFixed(3), HUB_Y, +(Math.cos(a) * 40).toFixed(3)];
  }
  function propArr(aDeg, sign, level) {
    var a = aDeg * Math.PI / 180 * sign;
    var y = 14 + (level === 'upper' ? 25 : 4);
    return [+(Math.sin(a) * MOTOR_R).toFixed(3), y, +(Math.cos(a) * MOTOR_R).toFixed(3)];
  }
  /** 共轴桨叶的 pivot（顶层可用） */
  function propPivot(aDeg, sign, level) { return propArr(aDeg, sign, level); }

  /* ---- 配色：哑光黑 + 金属 + 橙/灰点缀 ---- */
  var BLACK = 0x1a1d21, BLACK_L = 0x24282d, GRAY = 0x2b3036, METAL = 0x8a9199,
      STEEL = 0xa8b0b8, ORANGE = 0xe8722a, ORANGE_L = 0xff8a3d, WHITE = 0xdfeaf2,
      CYAN = 0x4fd6e8, YELLOW = 0xd8b43a;

  function bodyMat(H) { return H.carbon(0x24282d); }
  function panelMat(H) { return H.matte(BLACK, 0.86); }
  function orangeMat(H) { return H.matte(ORANGE, 0.55); }
  function metalMat(H) { return H.metal(METAL, 0.28); }

  /* 橙色装饰条 */
  function stripe(H, g, x, y, z, w, h, d, ry) {
    var m = new H.THREE.Mesh(H.box(w, h, d), orangeMat(H));
    m.position.set(x, y, z);
    if (ry) m.rotation.y = ry;
    g.add(m);
    return m;
  }

  var builder = {

    /* ---- 机身上盖 ---- */
    bodyUpper: function (H) {
      var g = new H.THREE.Group();
      g.add(new H.THREE.Mesh(H.loftGeo(SECTIONS, { part: 'upper', seam: SEAM, seg: 22 }),
        [bodyMat(H), H.matte(0x101316, 0.9)]));
      // 顶部碳纤维加强梁 + 提手
      var beam = H.carbon(0x2f343a);
      [-40, -6, 30].forEach(function (z) {
        H.addMesh(g, H.roundedBox(6, 4, 78, 2, 3), beam, 0, topAt(z) - 1, z);
      });
      var handle = new H.THREE.Mesh(new H.THREE.TorusGeometry(11, 2.2, 8, 20), metalMat(H));
      handle.position.set(0, topAt(0) + 3, -6);
      handle.rotation.x = Math.PI / 2;
      g.add(handle);
      // 橙色识别条（两侧）
      [-1, 1].forEach(function (s) {
        var hw = halfWidthAt(6, 14);
        stripe(H, g, s * (hw + 1.2), 16, 6, 2.4, 6, 54);
        stripe(H, g, s * (hw + 1.2), -6, 6, 2.4, 3, 54);
      });
      // 顶部散热格栅
      for (var i = 0; i < 6; i++) {
        H.addMesh(g, H.box(26, 1.6, 3.2), H.matte(0x0e1114, 0.95), 0, topAt(-34 + i * 12) + 0.4, -34 + i * 12);
      }
      // 顶部警示灯（橙色）
      H.addMesh(g, H.cyl(5, 6, 5, 18), H.matte(0x14171a, 0.7), 0, topAt(-58) + 2, -58);
      H.addMesh(g, new H.THREE.SphereGeometry(4.6, 16, 12), H.emissiveMat(ORANGE_L, 1.8), 0, topAt(-58) + 6, -58);
      return g;
    },

    /* ---- 机身下框（模块化承力结构 + 腹部载荷接口）---- */
    bodyLower: function (H) {
      var g = new H.THREE.Group();
      g.add(new H.THREE.Mesh(H.loftGeo(SECTIONS, { part: 'lower', seam: SEAM, seg: 22 }),
        [bodyMat(H), H.matte(0x0e1114, 0.92)]));
      var metal = metalMat(H);
      // 承力框
      H.addMesh(g, H.roundedBox(84, 7, 136, 3, 3), H.carbon(0x2a2f35), 0, bottomAt(0) + 3.5, -6);
      // 四角机臂安装座
      ARM_A.forEach(function (a) {
        [-1, 1].forEach(function (s) {
          var r = armRoot(a, s);
          H.addMesh(g, H.cyl(11, 12, 16, 20), metal, r.x, r.y - 2, r.z);
          H.addMesh(g, H.cyl(4, 4, 18, 12), H.metal(STEEL, 0.2), r.x, r.y - 2, r.z);
          H.addMesh(g, H.roundedBox(20, 12, 22, 3, 3), H.carbon(0x282d33), r.x * 0.82, r.y + 3, r.z * 0.82);
        });
      });
      // 腹部载荷挂架 + 快拆导轨
      H.addMesh(g, H.roundedBox(66, 8, 116, 3, 3), H.carbon(0x252a30), 0, bottomAt(-6) + 4, -6);
      [-1, 1].forEach(function (s) {
        H.addMesh(g, H.roundedBox(4, 5, 112, 1.5, 3), metal, 30 * s, bottomAt(-6) + 1, -6);
      });
      // 侧面检修口与橙色快拆手柄
      [-1, 1].forEach(function (s) {
        var hw = halfWidthAt(-30, -12);
        H.addMesh(g, H.roundedBox(2.4, 22, 34, 1, 3), H.matte(0x14171a, 0.85), s * (hw - 0.6), -12, -30);
        H.addMesh(g, H.roundedBox(5, 8, 16, 2, 3), orangeMat(H), s * (hw + 1.5), -12, -30);
      });
      // 机身底部橙色标识条
      stripe(H, g, 0, bottomAt(20) + 1.5, 20, 40, 2, 3);
      return g;
    },

    /* ---- 机头模块（FPV + 前向视觉）---- */
    noseUnit: function (H) {
      var g = new H.THREE.Group();
      var mat = H.carbon(0x282d33);
      g.add(new H.THREE.Mesh(H.loftGeo([
        { z: 82, w: 52, h: 40, y: -3, n: 3.4 },
        { z: 96, w: 40, h: 30, y: -4, n: 3.0 },
        { z: 104, w: 26, h: 20, y: -5, n: 2.6 }
      ], { part: 'full', seg: 18, cap: true }), mat));
      // FPV 摄像头（云台球）
      H.addMesh(g, new H.THREE.SphereGeometry(9, 20, 16), H.matte(BLACK, 0.5), 0, -12, 96);
      H.addMesh(g, H.cylZ(5.4, 5.4, 3, 24), H.glass(0x0a1116, 0x1a4a5e), 0, -12, 104);
      H.addMesh(g, new H.THREE.TorusGeometry(6.2, 1, 8, 22), metalMat(H), 0, -12, 105, Math.PI / 2);
      // 前向视觉双摄
      [-26, 26].forEach(function (x) {
        H.addMesh(g, H.cylZ(4.4, 4.4, 4, 20), H.glass(0x0a1116, 0x123a4a), x * 0.42, 4, 92);
        H.addMesh(g, new H.THREE.TorusGeometry(5, 0.9, 8, 18), metalMat(H), x * 0.42, 4, 94.2, Math.PI / 2);
      });
      // 机头橙色饰条与补光灯
      stripe(H, g, 0, 16, 88, 24, 2.6, 3);
      H.addMesh(g, H.cylZ(3.4, 3.4, 2, 16), H.emissiveMat(WHITE, 1.3), 0, -22, 92);
      return g;
    },

    /* ---- 激光雷达（顶部旋转式）---- */
    lidarUnit: function (H) {
      var g = new H.THREE.Group();
      var y = topAt(-24);
      H.addMesh(g, H.cyl(16, 18, 5, 24), H.matte(0x14171a, 0.7), 0, y + 2, -24);
      H.addMesh(g, H.cyl(15, 15, 14, 24), H.metal(0x3a4046, 0.35), 0, y + 11, -24);
      // 旋转扫描窗
      var ring = new H.THREE.Mesh(new H.THREE.CylinderGeometry(15.2, 15.2, 7, 24, 1, true),
        H.glass(0x0b1a22, 0x2e7fa8));
      ring.position.set(0, y + 11, -24);
      g.add(ring);
      H.addMesh(g, H.cyl(11, 13, 6, 20), H.carbon(0x2a2f35), 0, y + 21, -24);
      H.addMesh(g, H.cyl(6, 6, 2, 16), H.emissiveMat(ORANGE, 1.2), 0, y + 25, -24);
      // 橙色刻度环
      for (var i = 0; i < 8; i++) {
        var a = i / 8 * Math.PI * 2;
        H.addMesh(g, H.box(2.4, 1.6, 1.6), orangeMat(H),
          Math.sin(a) * 15.6, y + 5.6, -24 + Math.cos(a) * 15.6);
      }
      return g;
    },

    /* ---- 下视雷达 ---- */
    downRadar: function (H) {
      var g = new H.THREE.Group();
      var y = bottomAt(-42);
      H.addMesh(g, H.roundedBox(34, 5, 34, 2, 3), H.metal(0x3a4046, 0.4), 0, y - 1, -42);
      H.addMesh(g, H.cyl(13, 14, 6, 24), H.matte(0x14171a, 0.7), 0, y - 5, -42);
      H.addMesh(g, H.cyl(11.4, 11.4, 2, 24), H.glass(0x0a1116, 0x123a4a), 0, y - 8, -42);
      for (var i = 0; i < 4; i++) {
        var a = i / 4 * Math.PI * 2;
        H.addMesh(g, H.box(3, 1.6, 3), orangeMat(H), Math.sin(a) * 15, y + 2, -42 + Math.cos(a) * 15);
      }
      return g;
    },

    /* ---- 四目视觉系统（前后左右四摄）---- */
    visionQuad: function (H) {
      var g = new H.THREE.Group();
      var mat = H.matte(0x14171a, 0.6);
      var lens = H.glass(0x08131a, 0x16404f);
      var metal = metalMat(H);
      // 四个方向的摄像头组件
      var pos = [[0, 0, 62], [0, 0, -62], [46, 0, 0], [-46, 0, 0]];
      pos.forEach(function (p, i) {
        var isSide = i >= 2;
        var grp = new H.THREE.Group();
        H.addMesh(grp, H.roundedBox(isSide ? 12 : 26, 16, isSide ? 26 : 12, 3, 3), mat, 0, 0, 0);
        var l1 = H.addMesh(grp, H.cylZ(5, 5, 3.4, 20), lens, 0, -1, isSide ? 15 : 8);
        var l2 = H.addMesh(grp, H.cylZ(5, 5, 3.4, 20), lens, 0, -1, isSide ? -15 : -8);
        if (isSide) { l1.rotation.y = Math.PI / 2; l2.rotation.y = Math.PI / 2;
          l1.position.set(p[0] > 0 ? 8 : -8, -1, 7); l2.position.set(p[0] > 0 ? 8 : -8, -1, -7); }
        else { l1.position.set(8, -1, p[2] > 0 ? 8 : -8); l2.position.set(-8, -1, p[2] > 0 ? 8 : -8); }
        H.addMesh(grp, new H.THREE.TorusGeometry(6, 1, 8, 18), metal, 0, -1, isSide ? 15 : 8, Math.PI / 2);
        grp.position.set(p[0], -2, p[2]);
        g.add(grp);
      });
      // 视觉处理板
      H.addMesh(g, H.box(52, 4, 44), H.std({ map: H.TEX.pcb, roughness: 0.62, metalness: 0.3 }), 0, -22, -6);
      return g;
    },

    /* ---- 航电 / 飞控舱 ---- */
    avionicsBay: function (H) {
      var g = new H.THREE.Group();
      H.addMesh(g, H.roundedBox(66, 26, 60, 4, 3), H.matte(0x14171a, 0.75), 0, 4, 6);
      H.addMesh(g, H.box(56, 4, 50), H.std({ map: H.TEX.pcb, roughness: 0.6, metalness: 0.3 }), 0, 19, 6);
      var shield = H.metal(0x9aa4ac, 0.3);
      H.addMesh(g, H.box(26, 9, 24), shield, -13, 25, 8);
      H.addMesh(g, H.box(18, 7, 18), H.matte(0x161a14, 0.5), 15, 24, 12);
      [-14, 0, 14].forEach(function (x) {
        H.addMesh(g, H.box(9, 5, 9), H.metal(0xc8ced4, 0.35), x, 25, -12);
      });
      // 橙色调试点
      H.addMesh(g, H.cyl(3, 3, 2, 12), H.emissiveMat(ORANGE, 1.5), 30, 12, 26);
      H.addMesh(g, H.cyl(3, 3, 2, 12), H.emissiveMat(CYAN, 1.5), -30, 12, 26);
      return g;
    },

    /* ---- 双电池仓（模块化插槽）---- */
    batteryBay: function (H) {
      var g = new H.THREE.Group();
      var metal = metalMat(H);
      [-1, 1].forEach(function (s) {
        H.addMesh(g, H.roundedBox(30, 40, 74, 4, 3), H.matte(0x14171a, 0.8), 0, 0, 0);
        g.children[g.children.length - 1].position.set(26 * s, -6, -20);
        // 导轨与锁扣
        H.addMesh(g, H.roundedBox(3, 5, 70, 1.4, 3), metal, 26 * s + (s > 0 ? 16 : -16), -6, -20);
        H.addMesh(g, H.roundedBox(6, 10, 12, 2, 3), orangeMat(H), 26 * s, -24, 6);
      });
      H.addMesh(g, H.roundedBox(64, 12, 20, 3, 3), H.carbon(0x282d33), 0, -20, -20);
      return g;
    },

    /* ---- 双电池包 ---- */
    batteryPack: function (H) {
      var g = new H.THREE.Group();
      [-1, 1].forEach(function (s) {
        var x = 26 * s;
        H.addMesh(g, H.roundedBox(28, 38, 70, 4, 3), H.matte(0x22262b, 0.7), x, -6, -20);
        H.addMesh(g, H.roundedBox(24, 4, 62, 2, 3), H.matte(0x2b3036, 0.6), x, 14, -20);
        // 电量与散热
        for (var i = 0; i < 4; i++) {
          H.addMesh(g, H.box(4, 2, 3), H.emissiveMat(0x6ee23a, 1.1), x - 9 + i * 6, 17, -46);
        }
        H.addMesh(g, H.cyl(3, 3, 4, 12), H.metal(0xd8b64a, 0.3), x + 6 * s, -26, -20);
        for (var k = 0; k < 5; k++) {
          H.addMesh(g, H.box(22, 1.4, 2), H.matte(0x0e1114, 0.95), x, -6 + k * 6 - 12, -56);
        }
      });
      H.addMesh(g, H.box(58, 4, 8), orangeMat(H), 0, 12, -20);
      return g;
    },

    /* ---- RTK 天线组 ---- */
    rtkAntennas: function (H) {
      var g = new H.THREE.Group();
      var metal = metalMat(H);
      // 双 RTK 蘑菇头（顶部前侧）
      [-1, 1].forEach(function (s) {
        var x = 30 * s, z = 40, y = topAt(z);
        H.addMesh(g, H.cyl(3, 3, 12, 12), metal, x, y + 6, z);
        H.addMesh(g, H.cyl(9, 9, 5, 20), H.matte(0x22262b, 0.6), x, y + 14, z);
        H.addMesh(g, H.cyl(9.6, 9.6, 1.6, 20), orangeMat(H), x, y + 17, z);
      });
      // 图传天线（后部斜置）
      [-1, 1].forEach(function (s) {
        var x = 34 * s, z = -58, y = topAt(z);
        var a = new H.THREE.Mesh(H.box(3, 34, 5), H.matte(0x14171a, 0.7));
        a.position.set(x, y + 14, z);
        a.rotation.z = -0.3 * s;
        g.add(a);
        H.addMesh(g, H.box(1.6, 26, 1.6), H.metal(0xc9a227, 0.5), x + 2 * s, y + 14, z + 2.6);
      });
      return g;
    },

    /* ---- 空吊系统旗舰版（绞盘 + 实时称重）---- */
    winchUnit: function (H) {
      var g = new H.THREE.Group();
      var mat = H.carbon(0x252a30);
      var metal = metalMat(H);
      // 旗舰版绞盘本体：机腹后段的大型卷扬机构
      H.addMesh(g, H.roundedBox(46, 50, 46, 4, 3), mat, WINCH_X, bottomAt(WINCH_Z) + 22, WINCH_Z);
      H.addMesh(g, H.roundedBox(40, 6, 40, 2, 3), H.matte(0x14171a, 0.8), WINCH_X, bottomAt(WINCH_Z) + 46, WINCH_Z);
      // 卷筒（横置）+ 排线器
      var drum = new H.THREE.Mesh(H.cyl(11, 11, 34, 22), H.metal(0x6d757d, 0.3));
      drum.rotation.z = Math.PI / 2;
      drum.position.set(WINCH_X, bottomAt(WINCH_Z) + 22, WINCH_Z);
      g.add(drum);
      H.addMesh(g, H.cyl(12, 12, 3, 20), metal, WINCH_X - 18, bottomAt(WINCH_Z) + 22, WINCH_Z, 0, 0, Math.PI / 2);
      H.addMesh(g, H.cyl(12, 12, 3, 20), metal, WINCH_X + 18, bottomAt(WINCH_Z) + 22, WINCH_Z, 0, 0, Math.PI / 2);
      for (var i = 0; i < 7; i++) {
        H.addMesh(g, new H.THREE.TorusGeometry(11.4, 0.9, 6, 18), H.metal(0x3a4046, 0.5),
          WINCH_X - 14 + i * 4.6, bottomAt(WINCH_Z) + 22, WINCH_Z, 0, Math.PI / 2);
      }
      // 出线导向轮 + 张力/称重传感器模块
      H.addMesh(g, H.cyl(5, 5, 4, 16), metal, WINCH_X, bottomAt(WINCH_Z) + 2, WINCH_Z + 12, 0, 0, Math.PI / 2);
      H.addMesh(g, H.roundedBox(20, 16, 12, 3, 3), metal, WINCH_X, bottomAt(WINCH_Z) - 2, WINCH_Z + 22);
      // 实时称重显示屏
      H.addMesh(g, H.roundedBox(17, 11, 1.4, 1, 3),
        H.emissiveMat(0x6ee2a0, 0.85), WINCH_X, bottomAt(WINCH_Z) - 2, WINCH_Z + 28.4);
      // 橙色手柄与警示标
      H.addMesh(g, H.roundedBox(5, 10, 14, 2, 3), orangeMat(H), WINCH_X + 24, bottomAt(WINCH_Z) + 30, WINCH_Z);
      H.addMesh(g, H.roundedBox(5, 10, 14, 2, 3), orangeMat(H), WINCH_X - 24, bottomAt(WINCH_Z) + 30, WINCH_Z);
      // 散热风机
      for (i = 0; i < 4; i++) {
        H.addMesh(g, H.cyl(3.4, 3.4, 2, 12), H.matte(0x0e1114, 0.9),
          WINCH_X - 9 + i * 6, bottomAt(WINCH_Z) + 44, WINCH_Z + 23);
      }
      return g;
    },

    /* ---- 吊索（可伸缩：局部 -Y 单位长度圆柱，行为层只改 scale.y）---- */
    winchCable: function (H) {
      var g = new H.THREE.Group();
      var cable = new H.THREE.Mesh(H.cyl(0.7, 0.7, 1, 8),
        H.metal(0x50585f, 0.35));
      cable.position.set(0, -0.5, 0);      // 从原点向下延伸 1 单位
      g.add(cable);
      // 挂钩上方的称重吊环
      H.addMesh(g, new H.THREE.TorusGeometry(4.4, 1.2, 8, 18), metalMat(H), 0, -3, 0);
      // 只缩放缆绳网格本身（缩放整组会把吊环一起拉长）
      g.userData.cableMesh = cable;
      return g;
    },

    /* ---- 电动开合挂钩 ---- */
    winchHook: function (H) {
      var g = new H.THREE.Group();
      var metal = H.metal(0x6d757d, 0.28);
      var body = H.carbon(0x2a2f35);
      // 挂钩本体
      H.addMesh(g, H.roundedBox(14, 18, 12, 3, 3), body, 0, -9, 0);
      H.addMesh(g, H.cyl(4.4, 4.4, 10, 16), metal, 0, 2, 0);
      H.addMesh(g, new H.THREE.TorusGeometry(4.4, 1.2, 8, 18), metal, 0, 8, 0);
      // 电动开合机构（减速电机 + 齿轮）
      var m = new H.THREE.Mesh(H.cyl(5, 5, 10, 18), metal);
      m.rotation.z = Math.PI / 2;
      m.position.set(9, -6, 0);
      g.add(m);
      H.addMesh(g, H.cyl(3.6, 3.6, 12, 14), metalMat(H), 0, -20, 0);
      H.addMesh(g, H.cyl(7, 7, 3, 18), metal, -9, -6, 0, 0, 0, Math.PI / 2);
      // 两片可开合爪（行为层旋转 userData.claws）
      var claws = [];
      [-1, 1].forEach(function (s) {
        var claw = new H.THREE.Group();
        var c = new H.THREE.Mesh(H.roundedBox(4.4, 16, 7, 1.6, 3), metal);
        c.position.set(0, -8, 0);
        claw.add(c);
        var tip = new H.THREE.Mesh(H.roundedBox(3.6, 8, 5.6, 1.2, 3), metal);
        tip.position.set(0, -17, 3);
        tip.rotation.x = 0.5;
        claw.add(tip);
        claw.position.set(6 * s, -22, 0);
        claw.rotation.z = -0.18 * s;
        g.add(claw);
        claws.push(claw);
      });
      // 状态灯（闭合=绿，开启=橙）
      H.addMesh(g, H.cyl(2.6, 2.6, 2, 12), H.emissiveMat(0x6ee2a0, 1.6), 0, -6, 7);
      g.userData.claws = claws;
      return g;
    },

    /* ---- 可拆货运包装箱 ---- */
    cargoBox: function (H) {
      var g = new H.THREE.Group();
      var y = bottomAt(WINCH_Z) - 42, z = -6;
      var mat = H.matte(0x22262b, 0.85);
      var metal = metalMat(H);
      // 箱体 + 顶盖
      H.addMesh(g, H.roundedBox(122, 88, 104, 7, 4), mat, 0, y, z);
      H.addMesh(g, H.roundedBox(126, 8, 108, 4, 3), H.matte(0x1a1d21, 0.8), 0, y + 46, z);
      // 金属包角
      [[-1, -1], [-1, 1], [1, -1], [1, 1]].forEach(function (c) {
        H.addMesh(g, H.roundedBox(14, 92, 14, 3, 3), metal, 56 * c[0], y, z + 48 * c[1]);
      });
      // 橙色绑带与吊耳
      [-40, 40].forEach(function (x) {
        H.addMesh(g, H.box(12, 92, 6), orangeMat(H), x, y, z + 53);
        H.addMesh(g, H.box(12, 92, 6), orangeMat(H), x, y, z - 53);
      });
      H.addMesh(g, H.roundedBox(40, 10, 26, 3, 3), H.carbon(0x2a2f35), 0, y + 52, z);
      H.addMesh(g, new H.THREE.TorusGeometry(9, 2, 8, 20), metal, 0, y + 62, z, Math.PI / 2);
      // 标签牌与卡扣
      H.addMesh(g, H.roundedBox(44, 28, 3, 2, 3), H.matte(0x14171a, 0.6), 20, y + 12, z + 53);
      H.addMesh(g, H.roundedBox(34, 18, 1.4, 1.4, 3), H.emissiveMat(0xdfeaf2, 0.5), 20, y + 12, z + 55);
      [-1, 1].forEach(function (s) {
        H.addMesh(g, H.roundedBox(9, 14, 8, 2, 3), metal, 61 * s, y - 20, z);
      });
      // 底部缓冲脚
      [[-44, -34], [-44, 34], [44, -34], [44, 34]].forEach(function (c) {
        H.addMesh(g, H.roundedBox(16, 8, 16, 3, 3), H.matte(0x0e1114, 0.95), c[0], y - 46, z + c[1]);
      });
      return g;
    },

    /* ---- 货箱快拆锁扣机构 ---- */
    boxRelease: function (H) {
      var g = new H.THREE.Group();
      var metal = metalMat(H);
      var y = bottomAt(WINCH_Z) + 2;
      H.addMesh(g, H.roundedBox(74, 10, 22, 3, 3), H.carbon(0x2a2f35), 0, y, -6);
      [-1, 1].forEach(function (s) {
        H.addMesh(g, H.roundedBox(12, 22, 16, 3, 3), metal, 34 * s, y - 8, -6);
        H.addMesh(g, H.cyl(3.4, 3.4, 16, 12), H.metal(0x6d757d, 0.3), 34 * s, y - 12, 4, 0, 0, Math.PI / 2);
        H.addMesh(g, H.roundedBox(6, 12, 10, 2, 3), orangeMat(H), 46 * s, y - 6, -6);
      });
      H.addMesh(g, H.cyl(2.6, 2.6, 2, 12), H.emissiveMat(0x6ee2a0, 1.4), 0, y + 6, -6);
      return g;
    },

    /* ---- 警示与航行灯 ---- */
    lighting: function (H) {
      var g = new H.THREE.Group();
      // 两侧橙白频闪灯带
      [-1, 1].forEach(function (s) {
        for (var i = 0; i < 5; i++) {
          var z = -52 + i * 24;
          var hw = halfWidthAt(z, SEAM + 6);
          H.addMesh(g, H.cyl(2.2, 2.2, 1.6, 12),
            i % 2 ? H.emissiveMat(WHITE, 1.5) : H.emissiveMat(ORANGE_L, 1.7),
            s * (hw + 0.4), SEAM + 6, z, 0, 0, Math.PI / 2);
        }
      });
      // 机腹向下照明灯
      [-1, 1].forEach(function (s) {
        H.addMesh(g, H.cylZ(4.4, 4.4, 2, 16), H.emissiveMat(0xdfeaf2, 1.1), 22 * s, bottomAt(-30) - 2, -30);
      });
      return g;
    },

    /* ---- 四支前后机臂（可展开 / 折叠）---- */
    armFL: function (H) { return buildArm(H, 40, 1); },
    armFR: function (H) { return buildArm(H, 40, -1); },
    armRL: function (H) { return buildArm(H, 140, 1); },
    armRR: function (H) { return buildArm(H, 140, -1); },

    /* ---- 八支桨（共轴双桨，上下反向）---- */
    propFLu: function (H) { return buildProp(H, 40, 1, 'upper'); },
    propFLl: function (H) { return buildProp(H, 40, 1, 'lower'); },
    propFRu: function (H) { return buildProp(H, 40, -1, 'upper'); },
    propFRl: function (H) { return buildProp(H, 40, -1, 'lower'); },
    propRLu: function (H) { return buildProp(H, 140, 1, 'upper'); },
    propRLl: function (H) { return buildProp(H, 140, 1, 'lower'); },
    propRRu: function (H) { return buildProp(H, 140, -1, 'upper'); },
    propRRl: function (H) { return buildProp(H, 140, -1, 'lower'); },

    /* ---- 起落架 ---- */
    landingGear: function (H) {
      var g = new H.THREE.Group();
      var mat = H.carbon(0x252a30);
      var metal = metalMat(H);
      [-1, 1].forEach(function (s) {
        // 前后撑杆
        [-42, 30].forEach(function (z) {
          H.addMesh(g, H.roundedBox(7, 74, 9, 3, 3), mat, 44 * s, -58, z);
          H.addMesh(g, H.cyl(3.4, 3.4, 10, 12), metal, 44 * s, -90, z, 0, 0, Math.PI / 2);
        });
        // 滑橇纵梁
        H.addMesh(g, H.roundedBox(9, 8, 128, 3, 3), mat, 44 * s, -93, -6);
        // 缓冲脚垫
        [-42, 30].forEach(function (z) {
          H.addMesh(g, H.roundedBox(14, 8, 20, 3, 3), H.matte(0x0e1114, 0.95), 44 * s, GEAR_Y + 2, z);
        });
        // 橙色斜撑
        H.addMesh(g, H.roundedBox(5, 5, 56, 2, 3), orangeMat(H), 44 * s, -74, -6, 1.15);
      });
      H.addMesh(g, H.roundedBox(96, 7, 16, 3, 3), mat, 0, -88, -6);
      return g;
    },

    /* ---- 机身散热风道 ---- */
    coolingFan: function (H) {
      var g = new H.THREE.Group();
      [-1, 1].forEach(function (s) {
        var x = 22 * s, y = -14, z = -70;
        H.addMesh(g, H.cyl(11, 11, 6, 22), H.matte(0x14171a, 0.8), x, y, z, Math.PI / 2);
        H.addMesh(g, H.cyl(9.4, 9.4, 1.6, 22),
          H.std({ map: H.TEX.grille, roughness: 0.7, metalness: 0.4 }), x, y, z + 3.4, Math.PI / 2);
        for (var i = 0; i < 9; i++) {
          var a = i / 9 * Math.PI * 2;
          H.addMesh(g, H.box(2, 8.6, 1.2), H.metal(0x6d757d, 0.4), x + Math.cos(a) * 5, y + Math.sin(a) * 5, z + 3.6);
        }
      });
      return g;
    }
  };

  /* ---------- 机臂（碳纤维折叠臂 + 共轴双电机）---------- */
  function buildArm(H, aDeg, sign) {
    var g = new H.THREE.Group();
    var root = armRoot(aDeg, sign);
    var motor = motorPos(aDeg, sign);
    // 局部坐标：以机臂根部铰链为原点
    var span = new H.THREE.Vector3().subVectors(motor, root);
    var len = span.length();
    var local = new H.THREE.Vector3(0, 0, 0);
    var tipLocal = new H.THREE.Vector3(0, 0, len);

    var arm = new H.THREE.Mesh(H.loftGeo([
      { z: 0, w: 20, h: 13, y: 0, n: 4.0 },
      { z: len * 0.25, w: 17, h: 11, y: 0.5, n: 3.4 },
      { z: len * 0.55, w: 14, h: 9.5, y: 1, n: 3.0 },
      { z: len * 0.85, w: 12.5, h: 8.5, y: 1.4, n: 2.8 },
      { z: len, w: 12, h: 8, y: 1.6, n: 2.6 }
    ], { part: 'full', seg: 16 }), H.carbon(0x282d33));
    H.placeAlong(arm, local, tipLocal);
    g.add(arm);

    // 碳纤维加强筋与走线
    var rib = new H.THREE.Mesh(H.box(3.4, 5, len * 0.8), H.carbon(0x2f343a));
    H.placeAlong(rib, local, tipLocal);
    rib.position.y += 7;
    g.add(rib);
    var wire = new H.THREE.Mesh(H.cyl(2.2, 2.2, len * 0.86, 10), H.matte(0x14171a, 0.9));
    H.placeAlong(wire, local, tipLocal);
    wire.position.y -= 6;
    g.add(wire);

    // 根部铰链（展开/折叠轴）
    H.addMesh(g, H.cyl(9.5, 9.5, 20, 22), H.metal(0x6d757d, 0.3), 0, 0, 0);
    H.addMesh(g, H.cyl(4, 4, 22, 14), H.metal(0xa8b0b8, 0.2), 0, 0, 0);
    H.addMesh(g, H.roundedBox(22, 14, 24, 3, 3), H.carbon(0x2a2f35), 0, 2, 6);
    // 橙色折叠手柄
    H.addMesh(g, H.roundedBox(6, 10, 10, 2, 3), H.matte(ORANGE, 0.55), 11, 4, 4);

    // 共轴双电机塔
    var metal = H.metal(0x8a9199, 0.25);
    var dark = H.matte(0x14171a, 0.6);
    H.addMesh(g, H.cyl(11, 12, 10, 26), dark, 0, 0, len);
    H.addMesh(g, H.cyl(9, 10, 20, 26), metal, 0, 12, len);
    H.addMesh(g, H.cyl(10, 10, 4, 26), H.metal(0xa8b0b8, 0.2), 0, 23, len);
    H.addMesh(g, H.cyl(6, 7, 12, 18), metal, 0, 30, len);
    H.addMesh(g, H.cyl(7, 7, 3, 18), dark, 0, 37, len);
    // 电机臂与散热孔
    for (var i = 0; i < 6; i++) {
      var a = i / 6 * Math.PI * 2;
      H.addMesh(g, H.box(2, 18, 2), H.matte(0x0e1114, 0.9), Math.cos(a) * 9.4, 12, len + Math.sin(a) * 9.4);
    }
    // 橙色电机环
    H.addMesh(g, new H.THREE.TorusGeometry(10, 1.4, 8, 22), H.matte(ORANGE, 0.5), 0, 20, len, Math.PI / 2);
    return g;
  }

  /* ---------- 桨叶（三叶折叠桨，upper/lower 共轴反向）---------- */
  function buildProp(H, aDeg, sign, level) {
    var g = new H.THREE.Group();
    var isUpper = level === 'upper';
    // 局部坐标：以桨平面轴心为原点（机型 pivot 已给出世界位置）
    H.addMesh(g, H.cyl(6, 6.6, 4, 20), H.metal(0x8a9199, 0.3), 0, 0, 0);
    H.addMesh(g, H.cyl(8, 6.8, 1.8, 20), H.matte(0x2b3036, 0.6), 0, 2.6, 0);
    var bladeMat = H.matte(0x22262b, 0.5);
    var tipMat = H.matte(0xdfeaf2, 0.45);
    var len = isUpper ? 42 : 36;          // 上桨略大
    for (var k = 0; k < 3; k++) {
      var pivot = new H.THREE.Group();
      pivot.rotation.y = k * Math.PI * 2 / 3 + (isUpper ? 0.2 : 0.7);
      var blade = new H.THREE.Mesh(H.bladeGeo(len, 3.2, 7, 4, 0.8, -0.0024), bladeMat);
      blade.rotation.x = 0.2;
      blade.position.y = 1.2;
      pivot.add(blade);
      var tip = new H.THREE.Mesh(H.box(5, 0.6, 6), tipMat);
      tip.position.set(len - 4, 3.2, -2.2);
      tip.rotation.x = 0.2;
      pivot.add(tip);
      g.add(pivot);
    }
    // 橙色桨夹
    H.addMesh(g, H.cyl(4.2, 4.2, 2.4, 16), H.matte(ORANGE, 0.55), 0, 4, 0);
    return g;
  }

  /* =======================================================================
     部件清单（30 件）
     ======================================================================= */
  function P(o) { return o; }

  window.DJIModelFlyCart = {
    title: 'DJI FlyCart 100 物流无人机',
    subtitle: 'Heavy-Lift Logistics Octocopter',
    intro: '点击模型中的任意部件，或点击左侧「部件清单」即可自动拆解。' +
      '空吊系统可执行「挂钩下降 → 电动开合挂钩锁紧 → 实时称重 → 起吊 → 自动消摆 → 投放）全流程；' +
      '也可以折叠机臂与桨叶查看运输构型。',
    groups: ['碳纤维机身', '动力系统', '空吊与载荷', '感知系统', '航电与能源', '起落与散热'],
    scene: {
      rootScale: 0.10, floorY: -15.5, theta: 0.62, phi: 1.0, radius: 58,
      zoomBias: 11, phiBias: 0.15, minRadius: 26, maxRadius: 125,
      fog: 0.005, gridSize: 380, gridDiv: 152, ringR: 24, shadowR: 52,
      keyLight: [20, 32, 24], targetY: 3
    },
    spec: [
      ['机型', '八旋翼重载物流无人机（4 臂 × 共轴双桨）'],
      ['展开尺寸', '约 240 × 270 × 228 cm（宽 × 长 × 高，含桨）'],
      ['折叠尺寸', '机臂与桨叶折收后横向宽度约 110 cm，适配标准运输箱'],
      ['空机重量', '约 68 kg'],
      ['最大起飞重量', '约 170 kg'],
      ['最大载重', '100 kg（双电池 + 满载货箱）'],
      ['货箱', '可拆货运包装箱 120 × 100 × 90 cm'],
      ['空吊系统', '旗舰版：绞盘吊索 40 m，电动开合挂钩，实时称重'],
      ['消摆功能', '自动消摆：吊挂摆动角主动抑制，抗风吊运'],
      ['动力', '8 × 无刷电机（共轴双桨，上下反向）'],
      ['能源', '双电池包热备，支持不落地换电'],
      ['感知', '激光雷达 + 下视毫米波雷达 + 四目视觉 + FPV'],
      ['导航', '双 RTK 天线，厘米级定位'],
      ['防护', 'IP55 机身防护，工作温度 -20 ℃ ~ 50 ℃'],
      ['抗风', '12 m/s（吊运 8 m/s）'],
      ['续航', '满载 18 分钟 / 空载 32 分钟'],
      ['数据链', '双频图传 + 4G/5G 备份，图传 20 km'],
      ['起降', 'H 型起降平台，支持精准自主降落']
    ],
    builder: builder,
    constants: { SECTIONS: SECTIONS, SEAM: SEAM, MOTOR_R: MOTOR_R, ARM_A: ARM_A,
      UPPER_Y: UPPER_Y, LOWER_Y: LOWER_Y, GEAR_Y: GEAR_Y, WINCH_Z: WINCH_Z,
      topAt: topAt, bottomAt: bottomAt, halfWidthAt: halfWidthAt,
      motorPos: motorPos, armRoot: armRoot },

    parts: [
      P({ id: 'bodyUpper', name: '机身上盖', en: 'Upper Shell',
        tag: '碳纤维 · 模块化', color: '#8ad4ff', dir: [0, 1, 0.05], dist: 62,
        role: '碳纤维复合材料上盖，承载顶部雷达、RTK 天线与警示灯，橙色识别条用于空中辨识。',
        specs: [['材质', '碳纤维夹层 + 哑光黑涂装'], ['结构', '模块化上盖，四颗快拆螺钉'],
          ['标识', '橙色高可视识别条'], ['顶部', '激光雷达 / RTK / 警示灯']] }),

      P({ id: 'bodyLower', name: '机身下框', en: 'Lower Frame',
        tag: '承力主结构 · 载荷接口', color: '#7fc4f0', dir: [0, -1, 0.05], dist: 46,
        role: '整机承力主体：四支可折叠机臂安装座、双电池仓、腹部货箱接口与空吊系统全部装在这里。',
        specs: [['结构', '碳纤维承力框 + 金属节点'], ['机臂座', '4 处折叠铰链座'],
          ['载荷接口', '腹部快拆导轨（货箱 / 空吊）'], ['检修', '双侧快拆检修口']] }),

      P({ id: 'noseUnit', name: '机头模块', en: 'Nose Module',
        tag: 'FPV 摄像头 · 前向视觉', color: '#9ee0ff', dir: [0, -0.2, 1], dist: 58,
        role: '机头模块集成 FPV 摄像头与前向视觉双目，用于飞行视角回传与前方障碍识别。',
        specs: [['FPV', '广角云台摄像头，1080p 图传'], ['前向视觉', '双目立体视觉，避障 30 m'],
          ['补光', '白光 LED 辅助照明'], ['结构', '机头可整体快拆更换']] }),

      P({ id: 'lidarUnit', name: '激光雷达', en: 'LiDAR Unit',
        tag: '360° 扫描 · 顶部', color: '#7fd8c8', dir: [0.2, 1, -0.3], dist: 66,
        role: '顶部旋转激光雷达，360° 扫描构建周围地形与障碍物点云，是自主航线与精准降落的关键。',
        specs: [['扫描', '水平 360° 旋转扫描'], ['测距', '最远 120 m'], ['用途', '点云建图、避障、精准降落'],
          ['安装', '顶部减振支架']] }),

      P({ id: 'downRadar', name: '下视雷达', en: 'Downward Radar',
        tag: '毫米波 · 定高', color: '#6fc8e8', dir: [0, -1, -0.4], dist: 50,
        role: '腹部毫米波雷达，向下测量离地高度并识别地面材质，保证在扬尘、低光照与吊运悬停时的定高精度。',
        specs: [['类型', '毫米波测高雷达'], ['量程', '0.5 – 40 m'], ['精度', '±3 cm'],
          ['作用', '定高、仿地飞行、降落缓冲']] }),

      P({ id: 'visionQuad', name: '四目视觉系统', en: 'Quad Vision System',
        tag: '前后左右四摄', color: '#8ef0d0', dir: [0, -0.3, -0.2], dist: 54,
        role: '前后左右四组双目视觉，构成全向感知：飞行中避障，吊运时识别货箱与投放点。',
        specs: [['布局', '前 / 后 / 左 / 右 四组'], ['功能', '全向避障 + 视觉定位'],
          ['识别', '货箱、投放点、人员'], ['处理', '机载视觉处理板实时解算']] }),

      P({ id: 'avionicsBay', name: '航电 / 飞控舱', en: 'Avionics Bay',
        tag: '三余度 · 自主航线', color: '#4ade80', dir: [0.2, 1, 0.2], dist: 48,
        role: '飞控与航电中枢：自主起降、航线飞行、吊运控制与自动消摆算法都在这里运行。',
        specs: [['冗余', '三余度 IMU + 双气压计'], ['模式', '自主航线 / 精准悬停 / 一键返航'],
          ['吊运算法', '自动消摆与载荷补偿'], ['散热', '独立风道']] }),

      P({ id: 'batteryBay', name: '双电池仓', en: 'Dual Battery Bay',
        tag: '模块化插槽 · 热备', color: '#facc4a', dir: [-0.4, -0.6, -0.4], dist: 52,
        role: '左右双电池插槽，支持热备与不落地换电：一块电量告警时另一块无缝接管。',
        specs: [['插槽', '左右各 1 组'], ['换电', '支持不落地快速换电'],
          ['锁扣', '橙色快拆锁扣，防误脱'], ['指示', '插槽状态灯']] }),

      P({ id: 'batteryPack', name: '双电池包', en: 'Dual Battery Pack',
        tag: '热备 · 高压', color: '#fbbf24', dir: [-0.5, -0.8, -0.3], dist: 62,
        role: '两组高压智能电池包，输出功率支撑 100 kg 满载起降，电量与温度实时回传。',
        specs: [['形式', '双电池并供，单组可热插拔'], ['续航', '满载 18 分钟 / 空载 32 分钟'],
          ['管理', '智能 BMS，温度与循环次数监测'], ['充电', '约 50 分钟充至 90%']] }),

      P({ id: 'rtkAntennas', name: 'RTK 天线组', en: 'RTK Antenna Array',
        tag: '厘米级定位 · 图传', color: '#a78bfa', dir: [0.3, 1, 0.7], dist: 58,
        role: '双 RTK 天线提供厘米级定位与航向解算，配合图传天线保证远距离作业链路。',
        specs: [['定位', '双天线 RTK，厘米级'], ['航向', '双天线定向，无需磁罗盘'],
          ['图传', '双频天线 + 4G/5G 备份'], ['链路', '最远 20 km']] }),

      P({ id: 'winchUnit', name: '空吊系统旗舰版', en: 'Flagship Winch System',
        tag: '绞盘 40 m · 实时称重', color: '#ffb020', dir: [0, -1, -0.5], dist: 56,
        role: '旗舰版空吊系统：大型卷扬机构、排线器与张力传感器，吊运全程实时称重并参与消摆控制。',
        specs: [['绳长', '40 m 高强度吊索'], ['称重', '实时称重，精度 ±0.5 kg'],
          ['消摆', '张力与摆角联合反馈，主动消摆'], ['保护', '过载 / 卡绳 / 断绳制动']] }),

      P({ id: 'winchCable', name: '吊索', en: 'Winch Cable',
        tag: '40 m · 可伸缩', color: '#cbd5e1', pivot: [0, bottomAt(-46) + 2, -34],
        dir: [0, -0.9, -0.3], dist: 70,
        role: '高强度编织吊索，配合排线器均匀收放；称重吊环位于吊索末端，实时反馈载荷重量。',
        specs: [['长度', '40 m'], ['材质', '高强度编织绳，耐磨损'], ['附件', '称重吊环 + 防旋器'],
          ['维护', '磨损可视指示']] }),

      P({ id: 'winchHook', name: '电动开合挂钩', en: 'Electric Open/Close Hook',
        tag: '电动开合 · 状态灯', color: '#ff8a3d', dir: [0, -1, 0.4], dist: 62,
        role: '电动开合挂钩：减速电机驱动两片爪片开合，到位自锁，配合视觉自动对准货箱吊环。',
        specs: [['驱动', '减速电机 + 自锁蜗轮蜗杆'], ['开合', '电动开合，带到位检测'],
          ['自锁', '断电保持，防意外脱钩'], ['识别', '视觉自动对准吊环']] }),

      P({ id: 'cargoBox', name: '可拆货运包装箱', en: 'Removable Cargo Box',
        tag: '120 × 100 × 90 cm', color: '#9ec8ff', dir: [0, -1, -0.2], dist: 80,
        role: '可拆货运包装箱：模块化快拆结构，箱体带吊耳与卡扣，既可作为腹部载荷，也可由吊钩吊运。',
        specs: [['尺寸', '120 × 100 × 90 cm'], ['容积', '约 1.0 m³'],
          ['载重', '最大 100 kg'], ['拆卸', '快拆锁扣，单人 30 秒拆装'],
          ['防护', '防雨结构 + 缓冲底脚']] }),

      P({ id: 'boxRelease', name: '货箱快拆锁扣', en: 'Cargo Release Mechanism',
        tag: '电控锁扣 · 双冗余', color: '#cbd5e1', dir: [0, -1, -0.6], dist: 58,
        role: '腹部货箱电控快拆锁扣：双冗余锁止，空中不误脱，落地一键卸货。',
        specs: [['形式', '电控双冗余锁扣'], ['反馈', '锁止到位信号 + 指示灯'],
          ['应急', '断电保持锁止'], ['配套', '腹部快拆导轨']] }),

      P({ id: 'lighting', name: '警示与航行灯', en: 'Beacon & Nav Lights',
        tag: '橙白频闪 · 下照灯', color: '#ff9a8a', dir: [0.4, 0.5, 0.5], dist: 54,
        role: '橙白频闪警示灯带与机腹下照灯：夜间与低能见度下标识无人机位置，下照灯辅助投放点观察。',
        specs: [['灯带', '两侧橙白交替频闪'], ['下照灯', '机腹双灯，辅助观察投放点'],
          ['可见距离', '夜间 ≥ 3 km'], ['控制', '随任务阶段自动切换']] }),

      P({ id: 'armFL', name: '左前机臂', en: 'Front Left Arm',
        tag: '可展开 · 碳纤维', color: '#bcd8f0', pivot: armRootArr(40, 1), hinge: { axis: 'y', from: 0, to: 1.15 },
        dir: [-1, 0.35, 0.7], dist: 108,
        role: '左前碳纤维折叠机臂，根部铰链展开后自锁；末端安装共轴双电机塔，上下桨反向旋转。',
        specs: [['布局', '前左 40°'], ['结构', '碳纤维折叠臂 + 自锁铰链'],
          ['末端', '共轴双电机塔'], ['折叠', '一键折叠，适配标准集装箱']] }),

      P({ id: 'armFR', name: '右前机臂', en: 'Front Right Arm',
        tag: '可展开 · 碳纤维', color: '#bcd8f0', pivot: armRootArr(40, -1), hinge: { axis: 'y', from: 0, to: -1.15 },
        dir: [1, 0.35, 0.7], dist: 108,
        role: '与左前臂对称，八旋翼动力冗余保证单电机失效后仍可安全返航或就近降落。',
        specs: [['布局', '前右 －40°'], ['冗余', '单电机失效可控降落'],
          ['结构', '碳纤维折叠臂'], ['维护', '整臂快拆更换']] }),

      P({ id: 'armRL', name: '左后机臂', en: 'Rear Left Arm',
        tag: '可展开 · 碳纤维', color: '#bcd8f0', pivot: armRootArr(140, 1), hinge: { axis: 'y', from: 0, to: -1.15 },
        dir: [-1, 0.35, -0.7], dist: 108,
        role: '左后折叠机臂，带加强撑以承受满载吊运时的载荷突变与机动弯矩。',
        specs: [['布局', '后左 140°'], ['结构', '碳纤维折叠臂 + 斜撑'],
          ['作用', '俯仰与偏航控制力矩'], ['折叠', '与前后臂同步折叠']] }),

      P({ id: 'armRR', name: '右后机臂', en: 'Rear Right Arm',
        tag: '可展开 · 碳纤维', color: '#bcd8f0', pivot: armRootArr(140, -1), hinge: { axis: 'y', from: 0, to: 1.15 },
        dir: [1, 0.35, -0.7], dist: 108,
        role: '右后折叠机臂，与其余三臂共同构成八旋翼升力布局，保证吊运姿态稳定。',
        specs: [['布局', '后右 －140°'], ['结构', '碳纤维折叠臂 + 斜撑'],
          ['冗余', '单臂失效可继续飞行'], ['折叠', '与前后臂同步折叠']] }),

      P({ id: 'propFLu', name: '左前上桨', en: 'Front Left Upper Prop',
        tag: '三叶 · 共轴上层', color: '#f0a8d0', pivot: propPivot(40, 1, 'upper'), spin: { speed: 15, dir: 1 }, rotor: 42,
        rotorY: 0, hinge: { axis: 'x', from: 0, to: -1.2 }, dir: [-0.4, 1, 0.5], dist: 40,
        role: '共轴上层桨叶，与下层桨反向旋转互相抵消反扭矩，桨尖白色标记用于地面人员识别旋翼范围。',
        specs: [['形式', '三叶折叠桨（上层）'], ['旋向', '正转'], ['直径', '约 84 cm'],
          ['折叠', '停桨后桨叶自动收拢']] }),

      P({ id: 'propFLl', name: '左前下桨', en: 'Front Left Lower Prop',
        tag: '三叶 · 共轴下层', color: '#f0a8d0', pivot: propPivot(40, 1, 'lower'), spin: { speed: 15, dir: -1 }, rotor: 36,
        rotorY: 0, hinge: { axis: 'x', from: 0, to: -1.2 }, dir: [-0.4, 1, 0.5], dist: 40,
        role: '共轴下层桨叶，与上层桨反向旋转；上下桨直径差降低干涉噪声并提高悬停效率。',
        specs: [['形式', '三叶折叠桨（下层）'], ['旋向', '反转'], ['直径', '约 72 cm'],
          ['效率', '共轴布局提升悬停效率']] }),

      P({ id: 'propFRu', name: '右前上桨', en: 'Front Right Upper Prop',
        tag: '三叶 · 共轴上层', color: '#f0a8d0', pivot: propPivot(40, -1, 'upper'), spin: { speed: 15, dir: 1 }, rotor: 42,
        rotorY: 0, hinge: { axis: 'x', from: 0, to: -1.2 }, dir: [0.4, 1, 0.5], dist: 40,
        role: '右前共轴上层桨，与前左桨形成对角动力配对，保证俯仰与横滚解耦。',
        specs: [['形式', '三叶折叠桨（上层）'], ['旋向', '正转'], ['直径', '约 84 cm'],
          ['配对', '与左后桨同向']] }),

      P({ id: 'propFRl', name: '右前下桨', en: 'Front Right Lower Prop',
        tag: '三叶 · 共轴下层', color: '#f0a8d0', pivot: propPivot(40, -1, 'lower'), spin: { speed: 15, dir: -1 }, rotor: 36,
        rotorY: 0, hinge: { axis: 'x', from: 0, to: -1.2 }, dir: [0.4, 1, 0.5], dist: 40,
        role: '右前共轴下层桨，反向旋转抵消反扭矩，保持悬停航向稳定。',
        specs: [['形式', '三叶折叠桨（下层）'], ['旋向', '反转'], ['直径', '约 72 cm'],
          ['维护', '快拆式，单支可换']] }),

      P({ id: 'propRLu', name: '左后上桨', en: 'Rear Left Upper Prop',
        tag: '三叶 · 共轴上层', color: '#f0a8d0', pivot: propPivot(140, 1, 'upper'), spin: { speed: 15, dir: -1 }, rotor: 42,
        rotorY: 0, hinge: { axis: 'x', from: 0, to: -1.2 }, dir: [-0.4, 1, -0.5], dist: 40,
        role: '左后共轴上层桨（对角配对反向），为满载吊运提供后部升力与控制余度。',
        specs: [['形式', '三叶折叠桨（上层）'], ['旋向', '反转'], ['直径', '约 84 cm'],
          ['配对', '与右前桨同向']] }),

      P({ id: 'propRLl', name: '左后下桨', en: 'Rear Left Lower Prop',
        tag: '三叶 · 共轴下层', color: '#f0a8d0', pivot: propPivot(140, 1, 'lower'), spin: { speed: 15, dir: 1 }, rotor: 36,
        rotorY: 0, hinge: { axis: 'x', from: 0, to: -1.2 }, dir: [-0.4, 1, -0.5], dist: 40,
        role: '左后共轴下层桨，与上层反向，抑制吊运时的机体扭转振动。',
        specs: [['形式', '三叶折叠桨（下层）'], ['旋向', '正转'], ['直径', '约 72 cm'],
          ['作用', '抑制扭转振动']] }),

      P({ id: 'propRRu', name: '右后上桨', en: 'Rear Right Upper Prop',
        tag: '三叶 · 共轴上层', color: '#f0a8d0', pivot: propPivot(140, -1, 'upper'), spin: { speed: 15, dir: -1 }, rotor: 42,
        rotorY: 0, hinge: { axis: 'x', from: 0, to: -1.2 }, dir: [0.4, 1, -0.5], dist: 40,
        role: '右后共轴上层桨，与左后桨对称，构成八旋翼的最后一路升力。',
        specs: [['形式', '三叶折叠桨（上层）'], ['旋向', '反转'], ['直径', '约 84 cm'],
          ['折叠', '停桨自动收拢']] }),

      P({ id: 'propRRl', name: '右后下桨', en: 'Rear Right Lower Prop',
        tag: '三叶 · 共轴下层', color: '#f0a8d0', pivot: propPivot(140, -1, 'lower'), spin: { speed: 15, dir: 1 }, rotor: 36,
        rotorY: 0, hinge: { axis: 'x', from: 0, to: -1.2 }, dir: [0.4, 1, -0.5], dist: 40,
        role: '右后共轴下层桨，与其他七支桨共同构成动力冗余，单点失效仍可安全返航。',
        specs: [['形式', '三叶折叠桨（下层）'], ['旋向', '正转'], ['直径', '约 72 cm'],
          ['维护', '快拆式']] }),

      P({ id: 'landingGear', name: '起落架', en: 'Landing Gear',
        tag: '滑橇式 · 缓冲脚垫', color: '#cbd5e1', dir: [0, -1, -0.2], dist: 74,
        role: '滑橇式起落架：为腹部货箱与空吊系统留出作业净空，缓冲脚垫适应平台与非铺装地面起降。',
        specs: [['形式', '双滑橇 + 前后撑杆'], ['净空', '约 95 cm（可容纳货箱）'],
          ['缓冲', '弹性撑杆 + 橡胶脚垫'], ['适配', 'H 型起降平台精准降落']] }),

      P({ id: 'coolingFan', name: '机身散热风道', en: 'Cooling Ducts',
        tag: '双风机 · 独立风道', color: '#8fd8e8', dir: [-0.5, -0.3, -1], dist: 50,
        role: '双散热风机与独立风道，为电池、电调与绞盘电机散热，保证满载连续作业不过温。',
        specs: [['风机', '双离心风机'], ['风道', '电池 / 电调 / 绞盘电机独立风道'],
          ['防护', '防尘网可拆洗'], ['监控', '进出风温差实时监测']] })
    ]
  };

  /* 自注册到页面（引擎按此装配） */
  window.DJIPage = window.DJIPage || {};
  window.DJIPage.model = window.DJIModelFlyCart;
})();