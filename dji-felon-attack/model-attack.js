/* =========================================================================
   FELON-1 攻击无人机 · 机型模块（model-attack.js）
   -------------------------------------------------------------------------
   只提供数据与几何构建函数，不含任何引擎逻辑。
   注意：本文件先于 Three.js 加载执行，顶层绝对不能触碰 THREE。
   ========================================================================= */
(function () {
  'use strict';

  /* 关键坐标（cm） */
  var MOTOR = { x: 8.7, y: 1.05, z: 7.4 };
  var TURRET = [0, -2.55, 1.15];      // 武器转塔轴心（炮塔/弹鼓/缓冲器共用）
  var RAIL = [0, -2.25, -3.35];       // 导弹挂架

  function armRoot(sx, sz, isRear) {
    return new THREE.Vector3(
      (isRear ? 3.05 : 2.55) * sx,
      isRear ? 0.5 : 0.42,
      (isRear ? 3.85 : 3.35) * sz
    );
  }
  /* 机臂铰链座的安装点：沿机臂轴向内侧收 1.7 cm。
     铰链是竖直圆柱，留在原机臂根点时顶面会从收窄的机身肩部戳出一小片（浅穿）。 */
  var HINGE_IN = 1.7;
  function hingePos(sx, sz, isRear) {
    var root = armRoot(sx, sz, isRear);
    var motor = new THREE.Vector3(MOTOR.x * sx, MOTOR.y, MOTOR.z * sz);
    return root.addScaledVector(new THREE.Vector3().subVectors(motor, root).normalize(), -HINGE_IN);
  }

  /* 机体截面（军用装甲盒式轮廓：超椭圆指数偏大，棱线硬朗） */
  var SEAM = -1.0;
  var SECTIONS = [
    { z: -6.30, w: 3.0, h: 2.6, y: 0.25, n: 3.0 },
    { z: -5.50, w: 5.8, h: 3.6, y: 0.18, n: 3.6 },
    { z: -4.10, w: 7.3, h: 4.1, y: 0.08, n: 4.0 },
    { z: -2.10, w: 7.6, h: 4.3, y: 0.0, n: 4.2 },
    { z: 0.40, w: 7.3, h: 4.3, y: -0.06, n: 4.2 },
    { z: 2.40, w: 6.7, h: 4.1, y: -0.16, n: 4.0 },
    { z: 4.10, w: 5.6, h: 3.7, y: -0.32, n: 3.6 },
    { z: 5.50, w: 4.3, h: 3.0, y: -0.48, n: 3.2 },
    { z: 6.40, w: 2.8, h: 2.0, y: -0.58, n: 2.8 }
  ];

  function sectionAt(z) {
    var S = SECTIONS;
    if (z <= S[0].z) return S[0];
    if (z >= S[S.length - 1].z) return S[S.length - 1];
    for (var i = 0; i < S.length - 1; i++) {
      if (z >= S[i].z && z <= S[i + 1].z) {
        var t = (z - S[i].z) / (S[i + 1].z - S[i].z);
        return {
          z: z, w: S[i].w + (S[i + 1].w - S[i].w) * t,
          h: S[i].h + (S[i + 1].h - S[i].h) * t,
          y: S[i].y + (S[i + 1].y - S[i].y) * t,
          n: S[i].n + (S[i + 1].n - S[i].n) * t
        };
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

  /* 桨叶自旋中心（纯数学，模块顶层可用） */
  function propSpinAt(sx, sz) {
    return [+(MOTOR.x * sx).toFixed(3), +(MOTOR.y + 1.22).toFixed(3), +(MOTOR.z * sz).toFixed(3)];
  }
  /* 桨盘半径（cm） */
  var PROP_R = 5.0;

  var OLIVE = 0x4e5540, OLIVE_D = 0x3a4034, GUN = 0x30352c, BLACK = 0x14171a, STEEL = 0x8b9299;

  function shellMat(H) {
    return H.std({ color: OLIVE, roughness: 0.66, metalness: 0.28, roughnessMap: H.TEX.noise });
  }
  function darkMat() { return { color: 0x23271f, roughness: 0.72, metalness: 0.2 }; }

  var builder = {

    /* ---- 机身上装甲盖 ---- */
    bodyUpper: function (H) {
      var g = new H.THREE.Group();
      var mat = shellMat(H);
      var inner = H.std({ color: 0x171a14, roughness: 0.9, metalness: 0.1 });
      g.add(new H.THREE.Mesh(H.loftGeo(SECTIONS, { part: 'upper', seam: SEAM, seg: 20 }), [mat, inner]));
      // 顶部装甲棱线
      var ridge = H.std(darkMat());
      for (var i = 0; i < 5; i++) {
        var rz = -3.6 + i * 1.15;
        [-0.75, 0.75].forEach(function (rx) {
          H.addMesh(g, H.box(0.1, 0.1, 1.0), ridge, rx, topAt(rz) - 0.02, rz);
        });
      }
      // 尾部排气格栅
      for (i = 0; i < 5; i++) {
        var vz = -5.2 + i * 0.3;
        H.addMesh(g, H.box(2.0, 0.12, 0.16), ridge, 0, topAt(vz) - 0.02, vz);
      }
      // 两侧挂点与吊耳
      [-1, 1].forEach(function (s) {
        var hw = halfWidthAt(-1.2, 0.9);
        H.addMesh(g, H.roundedBox(0.22, 0.5, 1.4, 0.08, 3), H.std({ color: GUN, roughness: 0.6, metalness: 0.4 }), (hw - 0.06) * s, 0.9, -1.2);
      });
      // 顶部任务标识牌
      H.addMesh(g, H.roundedBox(1.9, 0.06, 0.7, 0.03, 3), H.std({ color: 0x2b3125, roughness: 0.7, metalness: 0.2 }), 0, topAt(0.4) + 0.01, 0.4);
      return g;
    },

    /* ---- 前视光电吊舱 ---- */
    nosePod: function (H) {
      var g = new H.THREE.Group();
      var shell = H.std({ color: GUN, roughness: 0.6, metalness: 0.35 });
      H.addMesh(g, H.roundedBox(2.3, 1.5, 1.7, 0.3, 4), shell, 0, -0.5, 6.2);
      // 可见光窗 + 红外窗
      H.addMesh(g, H.cylZ(0.42, 0.42, 0.3, 26), H.std({ color: 0x0a1016, roughness: 0.06, metalness: 1,
        emissive: 0x14324a, emissiveIntensity: 0.5 }), -0.55, -0.45, 7.0);
      H.addMesh(g, H.cylZ(0.34, 0.34, 0.3, 26), H.std({ color: 0x120c08, roughness: 0.08, metalness: 1,
        emissive: 0x4a2a10, emissiveIntensity: 0.55 }), 0.6, -0.45, 7.0);
      H.addMesh(g, new H.THREE.TorusGeometry(0.46, 0.06, 8, 26), H.std({ color: STEEL, roughness: 0.32, metalness: 0.95 }), -0.55, -0.45, 7.06, Math.PI / 2);
      // 激光指示器
      H.addMesh(g, H.cylZ(0.12, 0.12, 0.4, 12), H.std({ color: 0x2a0f0c, roughness: 0.4, metalness: 0.6,
        emissive: 0x8a1a10, emissiveIntensity: 0.7 }), 0, 0.05, 6.95);
      return g;
    },

    /* ---- 机身中框 ---- */
    bodyLower: function (H) {
      var g = new H.THREE.Group();
      var mat = shellMat(H);
      var inner = H.std({ color: 0x15180f, roughness: 0.9, metalness: 0.1 });
      g.add(new H.THREE.Mesh(H.loftGeo(SECTIONS, { part: 'lower', seam: SEAM, seg: 20 }), [mat, inner]));

      // 机臂铰链座
      var hinge = H.std({ color: 0x2a2f26, roughness: 0.6, metalness: 0.45 });
      var pin = H.std({ color: STEEL, roughness: 0.35, metalness: 0.9 });
      [[-1, 1, false], [1, 1, false], [-1, -1, true], [1, -1, true]].forEach(function (sd) {
        var h = hingePos(sd[0], sd[1], sd[2]);
        H.addMesh(g, H.cyl(0.82, 0.82, 1.35, 22), hinge, h.x, h.y, h.z);
        H.addMesh(g, H.cyl(0.34, 0.34, 1.5, 14), pin, h.x, h.y, h.z);
      });

      // 腹部武器站安装面
      H.addMesh(g, H.roundedBox(3.4, 0.4, 4.2, 0.14, 3), H.std({ color: GUN, roughness: 0.62, metalness: 0.4 }), 0, -2.25, 1.0);
      H.addMesh(g, H.roundedBox(2.2, 0.3, 2.4, 0.1, 3), H.std({ color: 0x2a2f26, roughness: 0.6, metalness: 0.45 }), 0, -2.1, -3.3);

      // 侧面装甲槽与螺栓
      [-1, 1].forEach(function (s) {
        [-0.8, 1.2].forEach(function (sz2) {
          var hw = halfWidthAt(sz2, -1.1);
          H.addMesh(g, H.roundedBox(0.12, 0.9, 1.8, 0.04, 3), H.std(darkMat()), (hw - 0.03) * s, -1.1, sz2);
        });
        var hw2 = halfWidthAt(-4.2, -0.5);
        H.addMesh(g, H.roundedBox(0.12, 0.6, 1.2, 0.04, 3), H.std(darkMat()), (hw2 - 0.03) * s, -0.5, -4.2);
      });
      var bolt = H.std({ color: 0x6d7468, roughness: 0.4, metalness: 0.85 });
      [[-1, -3.4], [1, -3.4], [-1, 2.6], [1, 2.6]].forEach(function (p) {
        var hw3 = halfWidthAt(p[1], SEAM + 0.4);
        H.addMesh(g, H.cyl(0.13, 0.13, 0.08, 10), bolt, p[0] * (hw3 - 0.06), SEAM + 0.36, p[1]);
      });

      // 底部散热口
      for (var i = 0; i < 5; i++) {
        var gz = -2.6 + i * 0.66;
        H.addMesh(g, H.box(1.8, 0.1, 0.18), H.std(darkMat()), 0, bottomAt(gz) + 0.02, gz);
      }
      return g;
    },

    /* ---- 高倍率电池组 ---- */
    battery: function (H) {
      var g = new H.THREE.Group();
      var body = H.std({ color: 0x33382c, roughness: 0.62, metalness: 0.25 });
      var b = new H.THREE.Mesh(H.roundedBox(5.4, 2.4, 5.4, 0.4, 4), body);
      b.position.set(0, -0.5, -3.2);
      g.add(b);
      // 电量指示与释放扣
      H.addMesh(g, H.roundedBox(1.6, 0.5, 0.3, 0.14, 3), H.std({ color: 0x24281f, roughness: 0.6, metalness: 0.4 }), 0, 0.55, -5.95);
      var led = H.std({ color: 0x0f1a0c, roughness: 0.4, metalness: 0.2, emissive: 0x6ee23a, emissiveIntensity: 1.1 });
      for (var i = 0; i < 4; i++) H.addMesh(g, H.box(0.22, 0.1, 0.1), led, -0.5 + i * 0.33, 0.55, -6.2);
      // 输出触点
      var gold = H.std({ color: 0xd8b64a, roughness: 0.3, metalness: 1 });
      for (i = 0; i < 3; i++) H.addMesh(g, H.box(0.34, 0.3, 0.1), gold, -0.6 + i * 0.6, 0.5, -0.55);
      return g;
    },

    /* ---- 飞控 / 任务计算机 ---- */
    flightController: function (H) {
      var g = new H.THREE.Group();
      H.addMesh(g, H.box(4.6, 0.16, 4.0), H.std({ map: H.TEX.pcb, roughness: 0.6, metalness: 0.28 }), 0, 1.05, -0.4);
      var shield = H.std({ color: 0x9aa3ad, roughness: 0.3, metalness: 0.95 });
      var chip = H.std({ color: 0x161a14, roughness: 0.45, metalness: 0.5 });
      H.addMesh(g, H.box(1.9, 0.5, 1.7), shield, -1.0, 1.36, -0.2);
      H.addMesh(g, H.box(1.4, 0.45, 1.3), chip, 1.2, 1.24, 0.4);
      H.addMesh(g, H.box(0.9, 0.2, 0.9), chip, 0.4, 1.22, -1.6);
      H.addMesh(g, H.box(0.7, 0.16, 0.5), chip, -1.7, 1.2, -1.7);
      H.addMesh(g, H.box(1.0, 0.28, 0.5), H.std({ color: 0xb9c2cc, roughness: 0.32, metalness: 1 }), 0, 1.2, 1.5);
      return g;
    },

    /* ---- 四合一电调 ---- */
    escBoard: function (H) {
      var g = new H.THREE.Group();
      H.addMesh(g, H.box(5.0, 0.16, 3.6), H.std({ map: H.TEX.pcb, roughness: 0.62, metalness: 0.25 }), 0, -1.55, 0.2);
      var mos = H.std({ color: 0x181c16, roughness: 0.5, metalness: 0.6 });
      var cap = H.std({ color: 0x2f3630, roughness: 0.55, metalness: 0.5 });
      [[-1, 1], [1, 1], [-1, -1], [1, -1]].forEach(function (sd) {
        H.addMesh(g, H.box(1.3, 0.24, 0.9), mos, 1.7 * sd[0], -1.35, 0.2 + 1.1 * sd[1]);
        H.addMesh(g, H.cyl(0.22, 0.22, 0.46, 12), cap, 2.2 * sd[0], -1.3, 0.2 + 0.5 * sd[1]);
      });
      H.addMesh(g, H.box(4.2, 0.1, 0.4), H.std({ color: 0xb5713c, roughness: 0.35, metalness: 0.95 }), 0, -1.4, -1.5);
      return g;
    },

    /* ---- 数据链 / 图传模块 ---- */
    datalink: function (H) {
      var g = new H.THREE.Group();
      H.addMesh(g, H.box(2.6, 0.5, 2.0), H.std({ color: 0x262b21, roughness: 0.5, metalness: 0.6 }), 0, 0.35, -4.4);
      H.addMesh(g, H.box(2.2, 0.06, 1.7), H.std({ color: 0x1b2018, roughness: 0.35, metalness: 0.6,
        emissive: 0xffd9a0, emissiveIntensity: 0.22 }), 0, 0.62, -4.4);
      // 双天线（斜置于机身两侧）
      var ant = H.std({ color: 0x1d2417, roughness: 0.55, metalness: 0.35 });
      [-1, 1].forEach(function (s) {
        var a = new H.THREE.Mesh(H.box(0.22, 1.9, 2.4), ant);
        a.position.set(2.4 * s, 0.5, -4.0);
        a.rotation.z = -0.2 * s;
        g.add(a);
        H.addMesh(g, H.box(0.09, 1.6, 0.18), H.std({ color: 0xc9a227, roughness: 0.5, metalness: 0.6 }), 2.25 * s, 0.5, -4.0);
      });
      return g;
    },

    /* ---- 定位模块 ---- */
    gnssUnit: function (H) {
      var g = new H.THREE.Group();
      H.addMesh(g, H.box(1.7, 0.24, 1.7), H.std({ color: 0xd8dde4, roughness: 0.35, metalness: 0.2 }), 0, 1.62, 1.2);
      H.addMesh(g, H.box(1.3, 0.08, 1.3), H.std({ color: 0x9aa3ad, roughness: 0.4, metalness: 0.7 }), 0, 1.78, 1.2);
      H.addMesh(g, H.cyl(0.4, 0.4, 0.3, 16), H.std({ color: 0x2a2f26, roughness: 0.6, metalness: 0.4 }), 0, 1.4, 1.2);
      return g;
    },

    /* ---- 机臂（四个） ---- */
    armFL: function (H) { return buildArm(H, -1, 1, false); },
    armFR: function (H) { return buildArm(H, 1, 1, false); },
    armRL: function (H) { return buildArm(H, -1, -1, true); },
    armRR: function (H) { return buildArm(H, 1, -1, true); },

    /* ---- 桨叶（四支） ---- */
    propFL: function (H) { return buildProp(H, -1, 1, -56 * Math.PI / 180); },
    propFR: function (H) { return buildProp(H, 1, 1, 56 * Math.PI / 180); },
    propRL: function (H) { return buildProp(H, -1, -1, 56 * Math.PI / 180); },
    propRR: function (H) { return buildProp(H, 1, -1, -56 * Math.PI / 180); },

    /* ---- 武器站（共用轴心，引擎按 pivot 放置，运行时靠旋转瞄准） ---- */
    turretYaw: function (H) {
      var g = new H.THREE.Group();
      var metal = H.std({ color: 0x6e7568, roughness: 0.34, metalness: 0.92 });
      var dark = H.std({ color: 0x1d2119, roughness: 0.55, metalness: 0.5 });
      H.addMesh(g, H.cyl(0.95, 1.0, 0.55, 32), dark, 0, 0.1, 0);
      H.addMesh(g, H.cyl(0.78, 0.78, 0.5, 32), metal, 0, 0.28, 0);
      H.addMesh(g, H.roundedBox(1.4, 0.55, 2.4, 0.16, 3), dark, 0, -0.3, -0.2);
      // 伺服驱动与角度标志
      H.addMesh(g, H.cyl(0.26, 0.26, 0.7, 14), metal, 0.85, 0.1, -0.5);
      H.addMesh(g, H.box(0.1, 0.5, 0.16), H.std({ color: 0x8a2b24, roughness: 0.5, metalness: 0.3 }), 0, 0.46, 0.95);
      return g;
    },

    cannon: function (H) {
      var g = new H.THREE.Group();
      var gun = H.std({ color: 0x2b3027, roughness: 0.42, metalness: 0.85 });
      var dark = H.std({ color: 0x14180f, roughness: 0.55, metalness: 0.6 });
      // 炮身
      H.addMesh(g, H.roundedBox(0.95, 0.9, 3.0, 0.18, 4), gun, 0, -0.25, 0.4);
      // 炮管 + 炮口制退器
      H.addMesh(g, H.cylZ(0.19, 0.22, 5.4, 22), dark, 0, -0.16, 4.4);
      H.addMesh(g, H.cylZ(0.3, 0.3, 0.5, 22), gun, 0, -0.16, 7.0);
      for (var i = 0; i < 3; i++) H.addMesh(g, H.cylZ(0.32, 0.32, 0.09, 22), dark, 0, -0.16, 6.8 + i * 0.22);
      // 供弹口与抛壳口
      H.addMesh(g, H.roundedBox(0.7, 0.55, 0.9, 0.12, 3), dark, 0, 0.3, 0.2);
      H.addMesh(g, H.roundedBox(0.6, 0.4, 0.6, 0.1, 3), H.std({ color: 0x1a1e15, roughness: 0.7, metalness: 0.3 }), 0.55, -0.4, 0.6);
      // 炮管护套散热孔
      for (i = 0; i < 6; i++) H.addMesh(g, H.box(0.5, 0.5, 0.1), H.std({ color: 0x10140d, roughness: 0.8, metalness: 0.3 }), 0, -0.16, 2.2 + i * 0.34);
      return g;
    },

    ammoDrum: function (H) {
      var g = new H.THREE.Group();
      var drum = H.std({ color: 0x2f342a, roughness: 0.58, metalness: 0.45 });
      var m = new H.THREE.Mesh(H.cyl(1.05, 1.05, 1.7, 36), drum);
      m.rotation.z = Math.PI / 2;
      m.position.set(0, -0.75, -1.3);
      g.add(m);
      H.addMesh(g, H.cyl(1.1, 1.1, 0.16, 36), H.std({ color: 0x1d2119, roughness: 0.6, metalness: 0.4 }), -0.9, -0.75, -1.3, 0, 0, Math.PI / 2);
      H.addMesh(g, H.cyl(1.1, 1.1, 0.16, 36), H.std({ color: 0x1d2119, roughness: 0.6, metalness: 0.4 }), 0.9, -0.75, -1.3, 0, 0, Math.PI / 2);
      // 弹链
      for (var i = 0; i < 5; i++) {
        H.addMesh(g, H.cylZ(0.11, 0.11, 0.34, 10), H.std({ color: 0xd8b64a, roughness: 0.32, metalness: 1 }), 0, -0.9 + i * 0.02, -0.5 + i * 0.16);
      }
      return g;
    },

    recoilDamper: function (H) {
      var g = new H.THREE.Group();
      var metal = H.std({ color: 0x8b9299, roughness: 0.3, metalness: 0.95 });
      // 后坐缓冲弹簧（多圈环）
      for (var i = 0; i < 13; i++) {
        H.addMesh(g, new H.THREE.TorusGeometry(0.34, 0.055, 6, 20), metal,
          0, -0.05, -2.0 - i * 0.17, 0, 0, 0);
      }
      H.addMesh(g, H.cylZ(0.3, 0.3, 0.5, 16), H.std({ color: 0x2b3027, roughness: 0.5, metalness: 0.8 }), 0, -0.05, -0.75);
      H.addMesh(g, H.cylZ(0.3, 0.3, 0.5, 16), H.std({ color: 0x2b3027, roughness: 0.5, metalness: 0.8 }), 0, -0.05, -4.35);
      // 缓冲导轨
      [-1, 1].forEach(function (s) {
        H.addMesh(g, H.cylZ(0.06, 0.06, 3.9, 8), metal, 0.42 * s, -0.05, -2.55);
      });
      return g;
    },

    /* ---- 导弹挂架 ---- */
    missileRail: function (H) {
      var g = new H.THREE.Group();
      var mat = H.std({ color: 0x2b3027, roughness: 0.55, metalness: 0.6 });
      var y = RAIL[1], z = RAIL[2];
      // 挂架横梁（贴机腹下方）
      H.addMesh(g, H.roundedBox(1.0, 0.34, 1.5, 0.08, 3), mat, 0, y + 0.18, z);
      H.addMesh(g, H.roundedBox(4.2, 0.3, 0.5, 0.08, 3), mat, 0, y, z + 0.6);
      H.addMesh(g, H.roundedBox(4.2, 0.3, 0.5, 0.08, 3), mat, 0, y, z - 0.6);
      // 挂钩与释放机构
      [-1, 1].forEach(function (s) {
        H.addMesh(g, H.roundedBox(0.3, 0.6, 1.7, 0.08, 3), mat, 1.75 * s, y - 0.05, z);
        H.addMesh(g, H.cyl(0.1, 0.1, 0.4, 10), H.std({ color: STEEL, roughness: 0.35, metalness: 0.9 }), 1.75 * s, y - 0.5, z);
      });
      // 与机腹的连接支臂
      [-1, 1].forEach(function (s) {
        H.addMesh(g, H.roundedBox(0.26, 0.5, 0.26, 0.06, 3), mat, 1.4 * s, y + 0.45, z);
      });
      return g;
    },

    missileL: function (H) { return buildMissile(H, RAIL[0] - 1.75, RAIL[1] - 0.9, RAIL[2]); },
    missileR: function (H) { return buildMissile(H, RAIL[0] + 1.75, RAIL[1] - 0.9, RAIL[2]); },

    /* ---- 起落架 ---- */
    landingGear: function (H) {
      var g = new H.THREE.Group();
      var leg = H.std({ color: 0x2a2f26, roughness: 0.6, metalness: 0.45 });
      [-1, 1].forEach(function (s) {
        H.addMesh(g, H.roundedBox(0.42, 4.4, 0.42, 0.14, 3), leg, 3.1 * s, -3.9, -2.6);
        H.addMesh(g, H.roundedBox(0.36, 0.36, 2.6, 0.12, 3), leg, 3.1 * s, -1.8, -3.4);
        H.addMesh(g, H.cyl(0.42, 0.34, 0.24, 14), H.std({ color: 0x14180f, roughness: 0.75, metalness: 0.2 }), 3.1 * s, -6.1, -2.6);
      });
      H.addMesh(g, H.roundedBox(0.5, 0.5, 0.7, 0.16, 3), leg, 0, -2.0, -5.0);
      H.addMesh(g, H.roundedBox(0.4, 3.4, 0.4, 0.12, 3), leg, 0, -3.9, -5.0);
      return g;
    }
  };

  /* ---------- 机臂 ---------- */
  function buildArm(H, sx, sz, isRear) {
    var g = new H.THREE.Group();
    var root = armRoot(sx, sz, isRear);
    var motorPos = new H.THREE.Vector3(MOTOR.x * sx, MOTOR.y, MOTOR.z * sz);
    var span = new H.THREE.Vector3().subVectors(motorPos, root);
    var len = span.length();
    var sections = [
      { z: -len / 2, w: 1.8, h: 1.35, y: 0, n: 3.8 },
      { z: -len * 0.15, w: 1.66, h: 1.24, y: 0.02, n: 3.4 },
      { z: len * 0.18, w: 1.46, h: 1.12, y: 0.04, n: 3.0 },
      { z: len * 0.38, w: 1.3, h: 1.02, y: 0.06, n: 2.8 },
      { z: len / 2, w: 1.2, h: 0.95, y: 0.08, n: 2.6 }
    ];
    var arm = new H.THREE.Mesh(H.loftGeo(sections, { part: 'full', seg: 14 }),
      H.std({ color: OLIVE_D, roughness: 0.6, metalness: 0.32, roughnessMap: H.TEX.noise }));
    H.placeAlong(arm, root, motorPos);
    g.add(arm);

    // 臂上走线槽
    var groove = new H.THREE.Mesh(H.box(0.62, 0.12, len * 0.6), H.std(darkMat()));
    H.placeAlong(groove, root, motorPos);
    groove.position.y += 0.7;
    g.add(groove);

    // 折叠铰链（安装点与机身中框的铰链座一致：沿机臂轴内收，避免戳出肩部）
    var hinge = hingePos(sx, sz, isRear);
    H.addMesh(g, H.cyl(0.72, 0.72, 1.6, 20), H.std({ color: 0x2a2f26, roughness: 0.6, metalness: 0.45 }), hinge.x, hinge.y, hinge.z);
    H.addMesh(g, H.cyl(0.3, 0.3, 1.8, 14), H.std({ color: STEEL, roughness: 0.35, metalness: 0.9 }), hinge.x, hinge.y, hinge.z);

    // 电机
    var metal = H.std({ color: STEEL, roughness: 0.3, metalness: 0.95 });
    var dark = H.std({ color: 0x14180f, roughness: 0.55, metalness: 0.5 });
    H.addMesh(g, H.cyl(0.8, 0.86, 0.38, 26), dark, motorPos.x, motorPos.y - 0.42, motorPos.z);
    H.addMesh(g, H.cyl(0.66, 0.72, 1.1, 26), metal, motorPos.x, motorPos.y + 0.18, motorPos.z);
    H.addMesh(g, H.cyl(0.7, 0.7, 0.1, 26), H.std({ color: 0x2a2f26, roughness: 0.45, metalness: 0.7 }), motorPos.x, motorPos.y + 0.58, motorPos.z);
    H.addMesh(g, H.cyl(0.22, 0.22, 0.46, 14), metal, motorPos.x, motorPos.y + 0.9, motorPos.z);
    H.addMesh(g, H.cyl(0.36, 0.36, 0.13, 18), dark, motorPos.x, motorPos.y + 1.13, motorPos.z);

    // 后机臂加强撑
    if (isRear) {
      var mid = new H.THREE.Vector3().copy(root).lerp(motorPos, 0.5);
      H.addMesh(g, H.cyl(0.14, 0.14, 1.1, 10), dark, mid.x, mid.y - 0.5, mid.z);
    }
    return g;
  }

  /* ---------- 桨叶 ---------- */
  function buildProp(H, sx, sz, bladeAngle) {
    var g = new H.THREE.Group();
    var cx = MOTOR.x * sx, cy = MOTOR.y + 1.22, cz = MOTOR.z * sz;
    H.addMesh(g, H.cyl(0.4, 0.44, 0.28, 18), H.std({ color: 0x1d2119, roughness: 0.5, metalness: 0.6 }), cx, cy, cz);
    H.addMesh(g, H.cyl(0.58, 0.48, 0.1, 18), H.std({ color: 0x2f342a, roughness: 0.45, metalness: 0.6 }), cx, cy + 0.18, cz);
    var bladeMat = H.std({ color: 0x181c15, roughness: 0.48, metalness: 0.4 });
    [0, Math.PI].forEach(function (off) {
      var pivot = new H.THREE.Group();
      pivot.position.set(cx, cy, cz);
      pivot.rotation.y = bladeAngle + off;
      var blade = new H.THREE.Mesh(H.bladeGeo(5.2, 0.19, 0.48, 0.25, 0.055, -0.011), bladeMat);
      blade.rotation.x = 0.25;
      blade.position.y = 0.1;
      pivot.add(blade);
      var tip = new H.THREE.Mesh(H.box(0.7, 0.02, 0.46), H.std({ color: 0xb8442f, roughness: 0.5, metalness: 0.2 }));
      tip.position.set(4.75, 0.17, -0.25);
      tip.rotation.x = 0.25;
      pivot.add(tip);
      g.add(pivot);
    });
    return g;
  }

  /* ---------- 弹药 ---------- */
  function buildMissile(H, x, y, z) {
    var g = new H.THREE.Group();
    var body = H.std({ color: 0x3a3f36, roughness: 0.5, metalness: 0.5 });
    var head = H.std({ color: 0x8a3324, roughness: 0.45, metalness: 0.45 });
    var m = new H.THREE.Mesh(H.cylZ(0.24, 0.26, 2.4, 20), body);
    m.position.set(x, y, z);
    g.add(m);
    var nose = new H.THREE.Mesh(new H.THREE.ConeGeometry(0.24, 0.6, 20), head);
    nose.rotation.x = Math.PI / 2;
    nose.position.set(x, y, z + 1.5);
    g.add(nose);
    for (var i = 0; i < 4; i++) {
      var a = i * Math.PI / 2;
      var fin = new H.THREE.Mesh(H.box(0.5, 0.06, 0.5), body);
      fin.position.set(x + Math.cos(a) * 0.34, y + Math.sin(a) * 0.34, z - 1.0);
      fin.rotation.z = a;
      g.add(fin);
    }
    return g;
  }

  /* =======================================================================
     部件清单
     ======================================================================= */
  function P(o) { return o; }

  window.DJIModelAttack = {
    title: 'FELON-1 攻击无人机',
    subtitle: 'Armed Strike Quadcopter',
    intro: '点击模型中的任意部件，或点击左侧「部件清单」即可自动拆解。' +
      '扫描雷达会持续搜索周围目标，锁定后武器站自动转向并开火；也可直接点击敌人手动指定目标。',
    groups: ['机体装甲', '动力系统', '武器站', '航电与数据链', '感知与供电'],
    scene: {
      rootScale: 0.5, floorY: -4.8, theta: 0.6, phi: 1.05, radius: 33,
      zoomBias: 4.6, phiBias: 0.16, minRadius: 14, maxRadius: 72,
      fog: 0.008, gridSize: 190, gridDiv: 95, ringR: 11, shadowR: 30,
      keyLight: [10, 17, 13], targetY: 0
    },
    spec: [
      ['机型', '攻击型四轴无人机（Strike Quadcopter）'],
      ['展开尺寸', '约 78 × 70 × 34 cm（含武器站）'],
      ['空机重量', '约 4.2 kg'],
      ['最大起飞重量', '约 8.5 kg'],
      ['武器载荷', '30mm 机炮（60 发）+ 2 × 精确制导弹药'],
      ['动力', '4 × 无刷电机 + 折叠桨'],
      ['电池', '6S 22.2 V 高倍率锂电 22 Ah'],
      ['续航', '38 分钟（侦察构型）/ 22 分钟（满载武装）'],
      ['数据链', '双频图传 + 卫通备份，最远 20 km'],
      ['光电载荷', '双通道（可见光 + 红外）三轴稳定吊舱'],
      ['感知', '全向视觉 + 毫米波雷达'],
      ['巡飞速度', '60 km/h，俯冲攻击 140 km/h'],
      ['作战半径', '8 km']
    ],
    builder: builder,
    constants: { MOTOR: MOTOR, TURRET: TURRET, RAIL: RAIL, SEAM: SEAM, SECTIONS: SECTIONS,
      topAt: topAt, bottomAt: bottomAt, halfWidthAt: halfWidthAt, armRoot: armRoot },

    parts: [
      P({ id: 'nosePod', name: '前视光电吊舱', en: 'EO/IR Sensor Pod',
        tag: '双通道 · 三轴稳定', color: '#7fd1e8', dir: [0, 0.4, 1], dist: 4.6,
        role: '机头双通道光电吊舱，可见光与红外同时成像，负责搜索、识别与激光指示，是打击链路的起点。',
        specs: [['通道', '可见光 + 红外双通道'], ['稳定', '三轴机械增稳'], ['功能', '搜索、识别、激光测距/指示'],
          ['输出', '目标坐标回传火控']] }),

      P({ id: 'bodyUpper', name: '机身上装甲盖', en: 'Upper Armour Shell',
        tag: '复合装甲 · 承力上壳', color: '#9ab26a', dir: [0, 1, 0.06], dist: 5.6,
        role: '承力上壳，覆盖航电、数据链与弹药舱，同时构成气动外形与散热风道，表面为军用低可探测涂装。',
        specs: [['材质', '复合装甲 + 内部加强筋'], ['涂装', '低可探测军绿'], ['固定', '卡扣 + 螺钉'],
          ['下方部件', '飞控、数据链、定位模块']] }),

      P({ id: 'bodyLower', name: '机身中框', en: 'Airframe Chassis',
        tag: '78 × 70 × 34 cm', color: '#8a9a63', dir: [0, -1, -0.06], dist: 2.0,
        role: '整机结构主体：四条折叠机臂、腹部武器站、电池仓与起落架全部安装在中框上。',
        specs: [['展开尺寸', '约 78 × 70 × 34 cm'], ['空重', '约 4.2 kg'], ['最大起飞重量', '约 8.5 kg'],
          ['抗风', '12 m/s'], ['安装', '机臂铰链座 ×4、武器站挂点']] }),

      P({ id: 'battery', name: '高倍率电池组', en: '6S High-Rate Battery',
        tag: '6S 22.2 V · 22 Ah', color: '#facc15', dir: [-0.1, -0.45, -1], dist: 5.0,
        role: '高倍率放电锂电，为四个电机与武器站提供瞬时大电流，是满载武装续航的关键。',
        specs: [['规格', '6S 22.2 V / 22 Ah'], ['放电', '持续 25C、瞬时 50C'], ['续航', '22 分钟（满载武装）'],
          ['指示', '4 段电量灯'], ['保护', '过放 / 过温 / 短路']] }),

      P({ id: 'flightController', name: '飞控 / 任务计算机', en: 'Flight Control Computer',
        tag: '飞控 + 火控解算', color: '#4ade80', dir: [0.25, 1, 0.2], dist: 3.2,
        role: '飞行控制与任务计算的合体模块：稳定姿态、解算火控诸元、管理打击链路与自主交战逻辑。',
        specs: [['核心', '双核飞控 + 火控解算单元'], ['冗余', '双 IMU / 双气压计'], ['功能', '姿态控制、航线、火控解算'],
          ['自主', '搜索—锁定—交战状态机']] }),

      P({ id: 'escBoard', name: '四合一电调', en: '4-in-1 ESC',
        tag: '4 路 · FOC 驱动', color: '#22c55e', dir: [-0.25, -1, 0.2], dist: 2.8,
        role: '把电池直流电按飞控指令分配给四个电机，决定转速响应速度与机动性。',
        specs: [['通道', '4 路无刷电调'], ['驱动', 'FOC 正弦驱动'], ['电流', '持续 60 A / 路'],
          ['协同', '与飞控闭环，支持紧急姿态回正']] }),

      P({ id: 'datalink', name: '数据链 / 图传模块', en: 'Datalink & Video',
        tag: '双频 · 20 km', color: '#38bdf8', dir: [0.2, 0.6, -1], dist: 4.2,
        role: '双频图传与遥控链路，向地面站回传光电画面与遥测，并接收目标指派。',
        specs: [['链路', '双频图传 + 卫通备份'], ['距离', '最远 20 km'], ['回传', '1080p/60 光电画面 + 遥测'],
          ['天线', '双天线分集']] }),

      P({ id: 'gnssUnit', name: '定位模块', en: 'GNSS Module',
        tag: 'GPS + BeiDou + Galileo', color: '#a78bfa', dir: [0.15, 1, 0.4], dist: 4.0,
        role: '提供定位与返航基准，为航线飞行与目标坐标标注提供绝对位置。',
        specs: [['定位', 'GPS + BeiDou + Galileo'], ['功能', '定点、返航、目标坐标标注'],
          ['精度', '米级（非差分）'], ['位置', '上壳内侧顶部']] }),

      P({ id: 'turretYaw', name: '武器站方位座', en: 'Turret Yaw Base',
        tag: '方位伺服 · 360°', color: '#ffb020', pivot: TURRET, dir: [0, -1, 0.15], dist: 3.4,
        role: '武器站的方位回转座，驱动整个武器站水平转向目标，并承担后坐力向机体的传递。',
        specs: [['自由度', '方位 360° 连续回转'], ['驱动', '直驱伺服 + 磁编码'],
          ['最大角速度', '180°/s'], ['承载', '机炮 + 弹鼓 + 缓冲器']] }),

      P({ id: 'cannon', name: '30mm 机炮', en: '30mm Autocannon',
        tag: '60 发 · 俯仰伺服', color: '#ff8a3d', pivot: TURRET, dir: [0, -1, 1], dist: 5.0,
        role: '主要杀伤手段：对地面软目标与轻型装甲进行俯冲扫射，配俯仰伺服实现大俯角攻击。',
        specs: [['口径', '30 mm'], ['备弹', '60 发'], ['射速', '约 600 发/分'],
          ['俯仰范围', '-10° ~ -85°（对地）'], ['有效射程', '约 1200 m']] }),

      P({ id: 'ammoDrum', name: '弹鼓与供弹机构', en: 'Ammunition Drum',
        tag: '60 发弹鼓', color: '#fbbf24', pivot: TURRET, dir: [-0.6, -0.8, -0.3], dist: 3.6,
        role: '随动弹鼓，通过弹链向机炮持续供弹，保证连续点射不中断。',
        specs: [['容量', '60 发'], ['供弹', '柔性弹链，随炮塔随动'],
          ['类型', '高爆燃烧弹 / 穿甲弹混装'], ['位置', '武器站左侧']] }),

      P({ id: 'recoilDamper', name: '后坐缓冲器', en: 'Recoil Damper',
        tag: '弹簧 + 导轨', color: '#cbd5e1', pivot: TURRET, dir: [0.2, -0.7, -1], dist: 4.4,
        role: '吸收机炮连发时的后坐冲量，避免冲击直接传到机体造成姿态抖动与光电画面抖动。',
        specs: [['结构', '双导轨 + 螺旋弹簧'], ['行程', '约 45 mm'], ['作用', '隔离后坐、保护光电吊舱'],
          ['寿命', '≥ 20000 发']] }),

      P({ id: 'missileRail', name: '导弹挂架', en: 'Missile Pylon',
        tag: '双联挂架', color: '#94a3b8', dir: [0, -0.6, -1], dist: 3.4,
        role: '腹部双联挂架，挂载两枚精确制导弹药，可在防区外对坚固目标实施一击必杀。',
        specs: [['挂点', '2 × 精确制导弹药'], ['释放', '电控挂脱，支持应急投放'],
          ['接口', '火控总线 + 视频回传'], ['位置', '机腹后段']] }),

      P({ id: 'missileL', name: '左弹药', en: 'Guided Munition (L)',
        tag: '精确制导弹药', color: '#f97316', dir: [-0.7, -1, -0.4], dist: 5.4,
        role: '小型精确制导弹药：发射后自主追踪激光/图像指定目标，用于摧毁机炮难以处理的目标。',
        specs: [['制导', '激光半主动 / 图像末制导'], ['战斗部', '高爆反装甲'], ['射程', '约 3 km'],
          ['命中精度', 'CEP ≤ 1 m']] }),

      P({ id: 'missileR', name: '右弹药', en: 'Guided Munition (R)',
        tag: '精确制导弹药', color: '#f97316', dir: [0.7, -1, -0.4], dist: 5.4,
        role: '与左弹药对称挂载，双发齐射可同时压制两个目标或实现补射。',
        specs: [['制导', '激光半主动 / 图像末制导'], ['战斗部', '高爆反装甲'], ['射程', '约 3 km'],
          ['发射', '单发 / 双发齐射']] }),

      P({ id: 'armFL', name: '左前机臂', en: 'Front Left Arm',
        tag: '折叠机臂 · 无刷电机', color: '#a3c47a', dir: [-1, 0.3, 0.7], dist: 6.4,
        role: '折叠机臂，展开后由卡扣锁定，末端安装无刷电机；收纳时向后收拢便于运输。',
        specs: [['结构', '折叠 + 卡扣锁定'], ['电机', '无刷电机，闭环转速控制'],
          ['桨叶', '快拆折叠桨'], ['位置', '机身左前方']] }),

      P({ id: 'armFR', name: '右前机臂', en: 'Front Right Arm',
        tag: '折叠机臂 · 无刷电机', color: '#a3c47a', dir: [1, 0.3, 0.7], dist: 6.4,
        role: '与左前机臂对称，为机体提供前向升力与俯仰控制力矩。',
        specs: [['结构', '折叠 + 卡扣锁定'], ['电机', '无刷电机，闭环转速控制'],
          ['桨叶', '快拆折叠桨'], ['位置', '机身右前方']] }),

      P({ id: 'armRL', name: '左后机臂', en: 'Rear Left Arm',
        tag: '折叠机臂 · 加强撑', color: '#8fb567', dir: [-1, 0.3, -0.7], dist: 6.4,
        role: '后置折叠机臂，带加强撑以承受满载武器站带来的额外载荷。',
        specs: [['结构', '折叠 + 卡扣锁定'], ['加强', '斜撑杆提高刚度'],
          ['电机', '无刷电机，闭环转速控制'], ['位置', '机身左后方']] }),

      P({ id: 'armRR', name: '右后机臂', en: 'Rear Right Arm',
        tag: '折叠机臂 · 加强撑', color: '#8fb567', dir: [1, 0.3, -0.7], dist: 6.4,
        role: '与左后机臂对称，四支机臂共同构成冗余动力配置，单臂失效仍可返航。',
        specs: [['结构', '折叠 + 卡扣锁定'], ['冗余', '单臂失效可继续飞行'],
          ['电机', '无刷电机，闭环转速控制'], ['位置', '机身右后方']] }),

      P({ id: 'propFL', name: '左前桨叶', en: 'Front Left Propeller',
        pivot: null, spin: { speed: 17, dir: 1 }, spinAt: propSpinAt(-1, 1), rotor: PROP_R, rotorY: 0.9, tag: '低噪快拆折叠桨', color: '#f472b6', dir: [-0.5, 1, 0.4], dist: 3.8,
        role: '把电机扭矩转化为升力，折叠设计便于收纳，快拆结构便于战损后快速更换。',
        specs: [['类型', '折叠快拆桨'], ['数量', '每机 4 支'], ['特点', '低噪桨型 + 叶尖警示'],
          ['维护', '单支可换']] }),

      P({ id: 'propFR', name: '右前桨叶', en: 'Front Right Propeller',
        pivot: null, spin: { speed: 17, dir: -1 }, spinAt: propSpinAt(1, 1), rotor: PROP_R, rotorY: 0.9, tag: '低噪快拆折叠桨', color: '#f472b6', dir: [0.5, 1, 0.4], dist: 3.8,
        role: '与左前桨反向旋转抵消反扭矩，保证航向稳定。',
        specs: [['类型', '折叠快拆桨'], ['旋向', '与左前桨反向'], ['特点', '低噪桨型 + 叶尖警示'],
          ['维护', '单支可换']] }),

      P({ id: 'propRL', name: '左后桨叶', en: 'Rear Left Propeller',
        pivot: null, spin: { speed: 17, dir: -1 }, spinAt: propSpinAt(-1, -1), rotor: PROP_R, rotorY: 0.9, tag: '低噪快拆折叠桨', color: '#f472b6', dir: [-0.5, 1, -0.4], dist: 3.8,
        role: '后部动力单元，与前三支桨配合完成俯仰、横滚与偏航的力矩分配。',
        specs: [['类型', '折叠快拆桨'], ['数量', '每机 4 支'], ['特点', '低噪桨型 + 叶尖警示'],
          ['维护', '单支可换']] }),

      P({ id: 'propRR', name: '右后桨叶', en: 'Rear Right Propeller',
        pivot: null, spin: { speed: 17, dir: 1 }, spinAt: propSpinAt(1, -1), rotor: PROP_R, rotorY: 0.9, tag: '低噪快拆折叠桨', color: '#f472b6', dir: [0.5, 1, -0.4], dist: 3.8,
        role: '与左后桨反向旋转，构成 X 型四轴的最后一路动力。',
        specs: [['类型', '折叠快拆桨'], ['旋向', '与左后桨反向'], ['特点', '低噪桨型 + 叶尖警示'],
          ['维护', '单支可换']] }),

      P({ id: 'landingGear', name: '起落架', en: 'Landing Gear',
        tag: '后三点 · 减震', color: '#cbd5e1', dir: [0, -1, -0.5], dist: 5.8,
        role: '后三点式起落架，为腹部武器站留出离地间隙，并在地面滑跑与硬着陆时提供缓冲。',
        specs: [['形式', '后三点式'], ['离地间隙', '约 12 cm（可容纳武器站）'],
          ['缓冲', '弹性支撑腿 + 橡胶脚垫'], ['材质', '碳纤 + 铝合金']] })
    ]
  };

  /* 自注册到页面（引擎按此装配，保持引擎与机型无关） */
  window.DJIPage = window.DJIPage || {};
  window.DJIPage.model = window.DJIModelAttack;
})();