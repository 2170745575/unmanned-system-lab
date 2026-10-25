/* =========================================================================
   DJI FlyCart 100 物流行为（flycart.js）
   -------------------------------------------------------------------------
   空吊系统旗舰版全流程：挂钩下降 → 电动开合挂钩锁紧 → 实时称重 → 起吊 →
   自动消摆运输 → 精准投放 → 返航。含机臂展开/折叠联动与桨叶动态光晕。
   行为层只通过引擎暴露的 E 与 DJIEngine.helpers 交互。
   注意：本文件先于 Three.js 加载执行，顶层绝对不能触碰 THREE。
   ========================================================================= */
(function () {
  'use strict';

  var PROP_SCALE = 0.10;          // 地面道具与机型同比例（cm → 场景单位）
  var HOVER_LOW = 1.6;            // 未载货悬停高度（root 的 y，场景单位）
  var HOVER_HIGH = 12.0;          // 载货运输高度（起吊后机体爬升，避免货箱触地）
  var CABLE_MIN = 40;             // 收索到位（cm）
  var CABLE_PICK = 52;            // 下放到平台货箱吊环的高度（cm）
  var CABLE_CARRY = 94;           // 吊运时货箱贴于机腹下方（cm）
  var CABLE_MAX = 120;
  var GRAV = 980;                 // 重力（cm/s²，用于摆动力学）

  var C = {
    E: null, H: null, E3: null,
    propGroup: null, fxGroup: null,
    // 作业状态
    phase: 'HOVER', t: 0, cycle: 0,
    cable: 120, cableGoal: 120,          // 吊索长度（cm）
    hookOpen: 0, hookGoal: 0,            // 0=闭合 1=全开
    attached: false, boxMass: 78.4, weigh: 0, weighNoise: 0,
    swing: 0, swingRate: 0, antiSway: true, swayErr: 0,
    // 机体运动
    rootTarget: null, rootVel: 0, tiltZ: 0, tiltX: 0,
    padA: null, padB: null, boxHome: null, boxHang: null, dropPad: null,
    dust: [], puffs: [], boardCd: 0, status: '待命 · 悬停于 H 型起降平台上方',
    els: {}
  };

  function V(x, y, z) { return new C.E3.Vector3(x, y, z); }
  function byId(id) { return document.getElementById(id); }
  function pad(n) { return String(n).padStart(2, '0'); }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  /* ---------------- 场景道具 ---------------- */
  function addProp(kind, x, z, rotY, scale) {
    var fn = (window.DJILogistics || {})[kind];
    if (!fn) return null;
    var g = fn(C.H);
    g.position.set(x, C.E.FLOOR_Y, z);
    g.rotation.y = rotY || 0;
    g.scale.setScalar(scale || PROP_SCALE);
    C.propGroup.add(g);
    return g;
  }

  function spawnHangingBox() {
    var H = C.H;
    var fn = (window.DJILogistics || {}).cargoBox || C.E.model.builder.cargoBox;
    if (!fn) return null;
    var g = new C.E3.Group();
    g.add(fn(H));
    g.scale.setScalar(PROP_SCALE);
    g.visible = false;
    C.E.scene.add(g);
    return g;
  }

  /* ---------------- 吊挂动力学（含主动消摆）---------------- */
  function updateSwing(dt) {
    var L = Math.max(60, C.cable);          // 摆长（cm）
    var omega2 = GRAV / L;
    // 机体水平加速度驱动摆动（×0.0006 换算到模型量级）
    var drive = -C.rootVel * 0.28 * 0.0006 * GRAV * 0.02;
    var damp = C.antiSway ? 2.6 : 0.45;      // 主动消摆 = 大阻尼
    var acc = -omega2 * Math.sin(C.swing) - damp * C.swingRate + drive;
    C.swingRate += acc * dt;
    C.swing += C.swingRate * dt;
    C.swing = clamp(C.swing, -0.62, 0.62);
    // 记录残余摆角（HUD 用）
    C.swayErr = Math.abs(C.swing);
  }

  /* ---------------- 作业阶段机 ---------------- */
  function setPhase(p, msg) {
    C.phase = p; C.t = 0;
    if (msg) C.status = msg;
  }

  function updateOps(dt) {
    var E = C.E;
    var pCable = E.partById['winchCable'], pHook = E.partById['winchHook'];
    if (!pCable || !pHook) return;
    var K = E.model.constants;
    // 吊索出口（模型 cm 坐标）
    var ex = 0, ey = K.bottomAt(K.WINCH_Z) + 2, ez = K.WINCH_Z + 12;

    C.t += dt;

    if (C.phase === 'HOVER') {
      C.cableGoal = CABLE_MIN; C.hoverGoal = HOVER_LOW;
      if (C.t > 1.4) setPhase('DESCEND', '吊钩下降，视觉对准货箱吊环');
    } else if (C.phase === 'DESCEND') {
      C.cableGoal = CABLE_PICK; C.hoverGoal = HOVER_LOW;   // 下放到货箱吊环
      C.hookGoal = 0;
      if (C.cable > CABLE_PICK - 4) { setPhase('ALIGN', '电动开合挂钩打开，套入吊环'); }
    } else if (C.phase === 'ALIGN') {
      C.hookGoal = 1;                         // 打开挂钩
      if (C.t > 1.1) { C.hookGoal = 0; setPhase('LOCK', '挂钩闭合自锁，吊环已锁紧'); }
    } else if (C.phase === 'LOCK') {
      C.hookGoal = 0;
      if (C.t > 1.2) { C.attached = true; setPhase('WEIGH', '实时称重中…'); }
    } else if (C.phase === 'WEIGH') {
      var k = Math.min(1, C.t / 1.5);
      C.weigh = C.boxMass * k + Math.sin(C.t * 14) * 0.6 * (1 - k);
      if (C.t > 1.8) { C.weigh = C.boxMass; setPhase('LIFT', '载荷 ' + C.weigh.toFixed(1) + ' kg，开始起吊并爬升'); }
    } else if (C.phase === 'LIFT') {
      C.cableGoal = CABLE_CARRY; C.hoverGoal = HOVER_HIGH;   // 收索同时机体爬升
      if (C.cable > CABLE_CARRY - 6 && C.hoverY > HOVER_HIGH - 0.6) {
        setPhase('TRANSIT', '运输中 · 自动消摆已介入');
        C.rootTarget = V(26, 0, 20);
      }
    } else if (C.phase === 'TRANSIT') {
      C.cableGoal = CABLE_CARRY; C.hoverGoal = HOVER_HIGH;
      if (C.rootTarget && Math.abs(E.root.position.x - C.rootTarget.x) < 1.2 &&
          Math.abs(E.root.position.z - C.rootTarget.z) < 1.2 && C.t > 1) {
        setPhase('LOWER', '到达投放点，开始下放');
      }
    } else if (C.phase === 'LOWER') {
      C.cableGoal = CABLE_PICK; C.hoverGoal = HOVER_LOW;
      if (C.cable > CABLE_PICK - 4 && C.hoverY < HOVER_LOW + 1) {
        setPhase('RELEASE', '挂钩打开，货箱已投放');
      }
    } else if (C.phase === 'RELEASE') {
      C.hookGoal = 1; C.cableGoal = CABLE_PICK; C.hoverGoal = HOVER_LOW;
      if (C.t > 1.4) {
        C.attached = false; C.weigh = 0;
        setPhase('RETURN', '货箱已就位，返航至 H 型起降平台');
      }
    } else if (C.phase === 'RETURN') {
      C.cableGoal = CABLE_MIN; C.hoverGoal = HOVER_HIGH;
      C.rootTarget = V(0, 0, 0);
      if (Math.abs(E.root.position.x) < 1.2 && Math.abs(E.root.position.z) < 1.2 &&
          C.cable < CABLE_MIN + 8) {
        C.cycle++; C.boxMass = 42 + Math.random() * 58;
        setPhase('HOVER', '第 ' + (C.cycle + 1) + ' 次吊运 · 载荷约 ' + C.boxMass.toFixed(1) + ' kg');
      }
    }

    // 吊索收放
    C.cable = lerp(C.cable, C.cableGoal, 1 - Math.exp(-dt * 2.2));
    if (C.attached) C.cable = Math.min(C.cable, CABLE_MAX);

    // 挂钩开合
    C.hookOpen = lerp(C.hookOpen, C.hookGoal, 1 - Math.exp(-dt * 7));

    // 摆动力学
    updateSwing(dt);

    // ---- 机体平移与姿态 ----
    if (C.rootTarget) {
      var tx = C.rootTarget.x, tz = C.rootTarget.z;
      var prevX = E.root.position.x, prevZ = E.root.position.z;
      var dx = tx - prevX, dz = tz - prevZ;
      var dist = Math.hypot(dx, dz);
      var speed = Math.min(6.5, dist * 1.6) * dt;
      if (dist > 0.02) {
        E.root.position.x += dx / dist * speed;
        E.root.position.z += dz / dist * speed;
      }
      C.rootVel = Math.hypot(E.root.position.x - prevX, E.root.position.z - prevZ) / Math.max(dt, 1e-4);
      // 加速倾斜 + 吊挂反向补偿
      C.tiltZ = lerp(C.tiltZ, clamp((E.root.position.x - prevX) / Math.max(dt, 1e-4) * 0.045, -0.14, 0.14), 1 - Math.exp(-dt * 3));
      C.tiltX = lerp(C.tiltX, clamp((E.root.position.z - prevZ) / Math.max(dt, 1e-4) * 0.045, -0.14, 0.14), 1 - Math.exp(-dt * 3));
    } else {
      C.rootVel *= Math.exp(-dt * 2);
    }
    E.root.rotation.z = C.tiltZ;
    E.root.rotation.x = C.tiltX;
    C.hoverY = lerp(C.hoverY === undefined ? HOVER_LOW : C.hoverY,
      C.hoverGoal === undefined ? HOVER_LOW : C.hoverGoal, 1 - Math.exp(-dt * 0.9));
    E.root.position.y = C.hoverY + Math.sin(E.S.elapsed * 0.9) * 0.09;

    // ---- 吊索 / 挂钩 / 货箱姿态 ----
    var sinS = Math.sin(C.swing), cosS = Math.cos(C.swing);
    var hx = ex + sinS * C.cable;
    var hy = ey - cosS * C.cable;
    var hz = ez;

    // 吊索：只缩放缆绳网格本身（缩放整组会把称重吊环一起拉长）
    var cmesh = pCable.group.userData.cableMesh;
    if (cmesh) cmesh.scale.y = C.cable;
    pCable.group.scale.set(1, 1, 1);

    pHook.group.position.set(hx, hy, hz);
    pHook.group.rotation.z = -C.swing * 0.85;
    // 电动开合：两片爪绕铰点张合
    var claws = pHook.group.userData.claws;
    if (claws && claws.length === 2) {
      claws[0].rotation.z = -0.18 - C.hookOpen * 0.75;
      claws[1].rotation.z = 0.18 + C.hookOpen * 0.75;
    }

    // 吊运中的货箱：跟随挂钩（含摆动），未吊运时留在平台
    if (C.boxHang) {
      C.boxHang.visible = C.attached || C.phase === 'RELEASE';
      if (C.boxHang.visible) {
        C.boxHang.position.set(
          E.root.position.x + hx * PROP_SCALE,
          E.root.position.y + (hy - 46) * PROP_SCALE,
          E.root.position.z + hz * PROP_SCALE);
        C.boxHang.rotation.z = -C.swing * 0.5;
        C.boxHang.rotation.y = C.tiltZ * 1.2;
      }
    }
    if (C.boxHome) {
      // 起吊后地面货箱消失；投放点出现货箱
      var flying = C.attached || C.phase === 'RELEASE';
      C.boxHome.visible = !flying || C.phase === 'RELEASE';
      if (C.phase === 'RELEASE' || C.phase === 'RETURN') {
        C.boxHome.position.set(E.root.position.x + hx * PROP_SCALE,
          E.FLOOR_Y, E.root.position.z + hz * PROP_SCALE);
      } else if (!flying) {
        C.boxHome.position.set(0, E.FLOOR_Y, 0);
      }
    }

    // 桨叶下洗气流尘环
    for (var i = 0; i < C.dust.length; i++) {
      var d = C.dust[i];
      d.userData.life += dt;
      var k2 = d.userData.life / d.userData.max;
      if (!isFinite(k2) || k2 >= 1) {
        d.userData.life = 0;
        d.position.copy(E.root.position); d.position.y = E.FLOOR_Y + 0.1;
        k2 = 0;
      }
      d.scale.setScalar(PROP_SCALE * (0.6 + k2 * 2.6));
      d.traverse(function (o) {
        if (o.isMesh && o.material && o.material.transparent) o.material.opacity = 0.35 * (1 - k2);
      });
    }
  }

  /* ---------------- 载荷板 ---------------- */
  var PHASES = [['HOVER', '悬停待命'], ['DESCEND', '下放挂钩'], ['ALIGN', '开钩对位'],
    ['LOCK', '锁紧称重'], ['LIFT', '起吊'], ['TRANSIT', '消摆运输'], ['LOWER', '下放投放'], ['RELEASE', '脱钩投放'], ['RETURN', '返航']];
  function updateBoard() {
    var el = C.els.board;
    if (!el) return;
    var idx = -1;
    for (var i = 0; i < PHASES.length; i++) if (PHASES[i][0] === C.phase) idx = i;
    var html = PHASES.map(function (p, i) {
      var cls = 'step' + (i === idx ? ' on' : '') + (i < idx ? ' done' : '');
      return '<div class="' + cls + '"><i>' + (i + 1) + '</i>' + p[1] + '</div>';
    }).join('');
    html += '<div class="weigh"><span>实时称重</span><b>' +
      (C.weigh > 0 ? C.weigh.toFixed(1) + ' kg' : '— kg') + '</b></div>';
    html += '<div class="weigh"><span>吊索长度</span><b>' + (C.cable / 100).toFixed(2) + ' m</b></div>';
    html += '<div class="weigh"><span>摆动角</span><b class="' +
      (C.swayErr > 0.16 ? 'hot' : 'ok') + '">' + (C.swing * 57.3).toFixed(1) + '°</b></div>';
    if (el.__html !== html) { el.innerHTML = html; el.__html = html; }
  }

  /* ---------------- 行为接口 ---------------- */
  var behavior = {
  movesRoot: true,   // 机体位移由本行为负责（展示层不再叠加漂移）
    init: function (E) {
      C.E = E;
      C.E3 = window.THREE;
      C.H = window.DJIEngine.helpers;
      C.propGroup = new C.E3.Group();
      E.scene.add(C.propGroup);
      C.fxGroup = new C.E3.Group();
      E.scene.add(C.fxGroup);
      E.hud.RADAR_RANGE = 620;
      C.els = { board: byId('loadboard'), status: byId('m-status')  };

      // H 型起降平台 + 场地
      C.padA = addProp('hpad', 0, 0, 0);
      addProp('hpadLight', 0, 0, 0);
      addProp('beaconTower', -46, -40, 0.3);
      addProp('beaconTower', 46, 40, -0.4);
      addProp('serviceCart', -52, 26, 0.9);
      addProp('chargeStation', 52, -26, -0.6);
      C.dropPad = addProp('dropPad', 0, 0, 0);
      C.dropPad.position.set(26, E.FLOOR_Y, 20);

      // 地面货箱（待吊运）与吊运货箱
      var fn = (window.DJILogistics || {}).cargoBox;
      if (fn) {
        var home = new C.E3.Group();
        home.add(fn(C.H));
        home.scale.setScalar(PROP_SCALE);
        home.position.set(0, E.FLOOR_Y, 0);
        C.propGroup.add(home);
        C.boxHome = home;
      }
      C.boxHang = spawnHangingBox();

      // 桨叶下洗尘环（悬停视觉）
      var dfn = (window.DJILogistics || {}).dustRing;
      if (dfn) {
        for (var i = 0; i < 3; i++) {
          var d = dfn(C.H);
          d.position.set(0, E.FLOOR_Y + 0.1 + i * 0.06, 0);
          d.scale.setScalar(PROP_SCALE);
          d.userData.life = i * 0.7;
          d.userData.max = 2.1;
          C.fxGroup.add(d);
          C.dust.push(d);
        }
      }
      E.root.position.set(0, HOVER_LOW, 0);
    },

    update: function (dt, E) {
      updateOps(dt);
      C.boardCd -= dt;
      if (C.boardCd <= 0) { C.boardCd = 0.12; updateBoard(); }
      if (C.els.status) C.els.status.textContent = C.status;

      // 雷达触点：平台 / 货箱 / 投放点
      E.S.contacts = [
        { x: 0, z: 0, sel: false, dead: false },
        { x: C.boxHome ? C.boxHome.position.x * 10 : 260, z: C.boxHome ? C.boxHome.position.z * 10 : 200, sel: true, dead: false }
      ];
      var markers = [];
      if (C.boxHome && C.boxHome.visible) {
        markers.push({ pos: V(C.boxHome.position.x, C.boxHome.position.y + 4.5, C.boxHome.position.z),
          size: { x: 13, y: 10, z: 11 }, dead: false, lock: 1 });
      }
      if (C.boxHang && C.boxHang.visible) {
        markers.push({ pos: V(C.boxHang.position.x, C.boxHang.position.y + 4.5, C.boxHang.position.z),
          size: { x: 13, y: 10, z: 11 }, dead: false, lock: 0.6 });
      }
      markers.push({ pos: V(26, E.FLOOR_Y + 2, 20), size: { x: 30, y: 4, z: 30 }, dead: false, lock: 0.35 });
      E.S.markers = markers.slice(0, 6);
    },

    hudRows: function (S, E) {
      var mode = ({ HOVER: 'HOVER', DESCEND: 'WINCH-DN', ALIGN: 'HOOK-OPEN', LOCK: 'HOOK-LOCK',
        WEIGH: 'WEIGHING', LIFT: 'LIFT', TRANSIT: 'TRANSIT', LOWER: 'WINCH-DN',
        RELEASE: 'RELEASE', RETURN: 'RETURN' })[C.phase] || C.phase;
      return [
        [{ k: 'ALT', v: (6 + S.camAlt * 1.1).toFixed(0) + ' m' },
         { k: 'SPD', v: (C.rootVel * 3.6 * 1.4).toFixed(0) + ' km/h' },
         { k: 'HDG', v: pad(Math.round(S.camAz)) + '°' }],
        [{ k: 'LOAD', v: C.weigh > 0 ? C.weigh.toFixed(1) + ' kg' : '— kg',
           c: C.weigh > 0 ? 'ok' : '' },
         { k: 'CABLE', v: (C.cable / 100).toFixed(2) + ' m' },
         { k: 'SWING', v: (C.swing * 57.3).toFixed(1) + '°', c: C.swayErr > 0.16 ? 'hot' : 'ok' },
         { k: 'HOOK', v: C.hookOpen > 0.5 ? 'OPEN' : 'LOCKED', c: C.hookOpen > 0.5 ? 'hot' : 'ok' }],
        [{ k: 'MODE', v: mode },
         { k: 'FOLD', v: S.foldT > 0.9 ? '展开' : (S.foldT < 0.1 ? '折叠' : '动作中') },
         { k: 'CYCLE', v: pad(C.cycle + 1) },
         { k: 'SYS', v: C.antiSway ? '消摆 ON' : '消摆 OFF', c: C.antiSway ? 'ok' : 'hot' }]
      ];
    },

    mission: function (S) {
      return { mode: 'MODE ' + C.phase, wave: C.cycle + 1,
        kill: Math.round(C.weigh), threat: Math.round(Math.abs(C.swing) * 57.3) };
    },

    buttons: {
      'btn-sway': function (E) {
        C.antiSway = !C.antiSway;
        window.DJIEngine.api.setButton('btn-sway', '自动消摆', C.antiSway, '');
      },
      'btn-cycle': function (E) {
        C.cycle++; C.boxMass = 42 + Math.random() * 58;
        setPhase('HOVER', '手动开始第 ' + (C.cycle + 1) + ' 次吊运');
        C.E.root.position.set(0, HOVER_LOW, 0);
        C.attached = false; C.weigh = 0; C.swing = 0; C.swingRate = 0;
      }
    },

    keys: {
      'z': function (E) { behavior.buttons['btn-sway'](E); },
      'v': function (E) { behavior.buttons['btn-cycle'](E); }
    },

    // 地面货箱与投放点可点击查看
    pickables: function () {
      var out = [];
      [C.boxHome, C.boxHang].forEach(function (g) {
        if (!g || !g.visible) return;
        g.traverse(function (o) { if (o.isMesh) out.push(o); });
      });
      return out;
    },
    pick: function (hit, E) {
      if (hit && hit.kind === 'enemy') return true;
      return true;
    },
    hover: function () {},
    enemyTip: function () { return '货箱 · 可吊运载荷'; }
  };

  window.DJIFlyCart = behavior;
  /* 测试钩子：只读状态 / 注入扰动，便于自动化验证消摆等功能 */
  behavior.__phase = function () { return C.phase; };
  behavior.__target = function () { return C.rootTarget; };
  behavior.__swing = function () { return C.swing; };
  behavior.__cable = function () { return C.cable; };
  behavior.__weigh = function () { return C.weigh; };
  behavior.__setSway = function (on) { C.antiSway = !!on; };
  behavior.__kick = function (v) { C.swingRate += v; };
  window.DJIPage = window.DJIPage || {};
  window.DJIPage.behavior = behavior;
})();