/* =========================================================================
   FELON-1 作战系统（combat.js）
   -------------------------------------------------------------------------
   扫描 → 识别 → 锁定 → 机炮扫射 / 导弹打击 → 击毁 → 波次推进
   行为层只通过引擎暴露的 E（引擎实例）与 DJIEngine.helpers 交互。
   注意：本文件先于 Three.js 加载执行，顶层绝对不能触碰 THREE。
   ========================================================================= */
(function () {
  'use strict';

  var FLOOR_KEEP = 0.5;          // 敌人缩放（cm → 场景单位）
  var ENEMY_SCALE = 0.9;         // 敌人在场景里的额外放大倍率
  var SPAWN_R_MIN = 9.5, SPAWN_R_MAX = 17.5;
  var SCAN_WIDTH = 0.14;         // 雷达扇面命中判定（弧度）
  var LOCK_TIME = 1.5;           // 从发现到锁定所需秒数

  var C = {
    E: null, H: null, E3: null,
    enemyGroup: null, fxGroup: null,
    enemies: [], wave: 0, kills: 0,
    auto: true,
    ammo: 60, ammoMax: 60, msl: 2, mslMax: 2,
    integrity: 100,
    target: null, manual: null,
    yaw: 0, pitch: 0, yawGoal: 0, pitchGoal: 0,
    fireCd: 0, shotCd: 0, burst: 0, reload: 0,
    tracers: [], missiles: [], fx: [], pings: [], aaShots: [],
    boardCd: 0, waveCd: 0, lastHit: 99,
    turretParts: {}, primaryName: '—', mode: 'SEARCH'
  };

  /* ---------------- 工具 ---------------- */
  function V(x, y, z) { return new C.E3.Vector3(x, y, z); }
  function angDiff(a, b) {
    var d = (a - b + Math.PI) % (Math.PI * 2);
    if (d < 0) d += Math.PI * 2;
    return d - Math.PI;
  }
  function byId(id) { return document.getElementById(id); }
  function pad(n) { return String(n).padStart(2, '0'); }

  /* ---------------- 敌人 ---------------- */
  function spawnWave(n) {
    C.wave++;
    var types = ['tank', 'apc', 'truck', 'aa'];
    var count = Math.min(3 + C.wave, 9);
    for (var i = 0; i < count; i++) {
      var a = (i / count) * Math.PI * 2 + Math.random() * 0.5;
      var r = SPAWN_R_MIN + Math.random() * (SPAWN_R_MAX - SPAWN_R_MIN);
      var type = types[(i + C.wave) % types.length];
      spawnEnemy(type, Math.sin(a) * r, Math.cos(a) * r, a);
    }
    C.waveCd = 0;
    DJIEngine.api.flash(200);
  }

  function spawnEnemy(type, x, z, bearing) {
    var E = C.E, H = C.H;
    var model = (DJIEnemies[type] || DJIEnemies.tank)(H);
    var g = new C.E3.Group();
    g.add(model);
    g.scale.setScalar(ENEMY_SCALE);
    var size = model.userData.size || { x: 3, y: 2, z: 6 };
    g.position.set(x, E.FLOOR_Y + 0.02, z);
    g.rotation.y = -bearing + Math.PI;      // 面向机体
    C.enemyGroup.add(g);

    var hp = type === 'tank' ? 100 : (type === 'apc' ? 70 : (type === 'aa' ? 60 : 45));
    var maxHp = hp * (1 + (C.wave - 1) * 0.18);

    var meshes = [];
    g.traverse(function (o) {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        meshes.push(o);
      }
    });

    var e = {
      type: type, group: g, meshes: meshes, bearing: bearing,
      hp: maxHp, maxHp: maxHp, dead: false,
      detected: false, lock: 0, flashT: 0, aaCd: 2 + Math.random() * 5,
      size: size, name: ({ tank: '主战坦克', apc: '装甲车', truck: '运输车', aa: '自行高炮' })[type],
      code: 'T-' + pad(C.enemies.length + 1 + C.kills)
    };
    meshes.forEach(function (m) { m.userData.enemyRef = e; });
    C.enemies.push(e);
    return e;
  }

  function killEnemy(e) {
    if (e.dead) return;
    e.dead = true;
    C.kills++;
    // 换成残骸
    var H = C.H;
    var wreck = (DJIEnemies.wreck || DJIEnemies.tank)(H);
    while (e.group.children.length) e.group.remove(e.group.children[0]);
    e.group.add(wreck);
    e.group.scale.setScalar(ENEMY_SCALE);
    spawnExplosion(e.group.position.clone().add(V(0, 1.2, 0)), 4.2, true);
    DJIEngine.api.flash(260);
    C.E.S.shake = 0.6;
    if (C.target === e) { C.target = null; C.manual = null; }
  }

  /* ---------------- 特效 ---------------- */
  function spawnExplosion(pos, scale, big) {
    var g = (DJIEnemies.explosion || function () { return new C.E3.Group(); })(C.H);
    g.position.copy(pos);
    g.scale.setScalar(0.2);
    g.userData.life = 0;
    g.userData.max = big ? 0.85 : 0.5;
    g.userData.scale = scale;
    C.fxGroup.add(g);
    C.fx.push(g);

    // 火光
    var light = new C.E3.PointLight(0xff8a3d, big ? 6 : 3, big ? 26 : 14, 2);
    light.position.copy(pos);
    light.userData.life = 0;
    light.userData.max = big ? 0.85 : 0.5;   // 必须设！漏了会让 k=life/undefined=NaN
    C.E.scene.add(light);                    // → intensity=NaN → 整个场景光照被污染成全黑
    C.fx.push(light);

    // 烟
    for (var i = 0; i < (big ? 10 : 5); i++) spawnPuff(pos.clone().add(V(
      (Math.random() - 0.5) * 2.4, Math.random() * 1.6, (Math.random() - 0.5) * 2.4)), big);
  }

  function spawnPuff(pos, big) {
    var s = new C.E3.Sprite(new C.E3.SpriteMaterial({
      map: C.E3 ? C.H.TEX.smoke : null, color: 0x6a6259,
      transparent: true, opacity: 0.55, depthWrite: false
    }));
    s.position.copy(pos);
    s.scale.setScalar(big ? 1.6 : 1.0);
    s.userData.life = 0;
    s.userData.max = 1.6 + Math.random() * 0.8;
    s.userData.rise = 0.8 + Math.random() * 1.2;
    C.fxGroup.add(s);
    C.fx.push(s);
  }

  function spawnPing(pos) {
    var m = new C.E3.Mesh(new C.E3.RingGeometry(0.6, 0.75, 40),
      new C.E3.MeshBasicMaterial({
        color: 0xffb020, transparent: true, opacity: 0.9, side: C.E3.DoubleSide,
        blending: C.E3.AdditiveBlending, depthWrite: false
      }));
    m.rotation.x = -Math.PI / 2;
    m.position.copy(pos);
    m.userData.life = 0;
    m.userData.max = 0.9;
    C.fxGroup.add(m);
    C.fx.push(m);
  }

  /* ---------------- 扫描 ---------------- */
  function updateScan(dt) {
    var sweepPhi = 0.62 + (C.E.S.sweepAngle || 0);
    for (var i = 0; i < C.enemies.length; i++) {
      var e = C.enemies[i];
      if (e.dead) continue;
      var phi = Math.atan2(-e.group.position.z, e.group.position.x);
      if (Math.abs(angDiff(phi, sweepPhi)) < SCAN_WIDTH && !e.detected) {
        e.detected = true;
        spawnPing(e.group.position.clone());
      }
      if (e.detected && e.lock < 1) e.lock = Math.min(1, e.lock + dt / LOCK_TIME);
    }
  }

  function pickTarget() {
    if (C.manual && !C.manual.dead) return C.manual;
    var best = null, bestD = 1e9;
    for (var i = 0; i < C.enemies.length; i++) {
      var e = C.enemies[i];
      if (e.dead || e.lock < 1) continue;
      var d = e.group.position.distanceTo(C.E.root.position);
      if (d < bestD) { bestD = d; best = e; }
    }
    return best;
  }

  /* ---------------- 武器 ---------------- */
  function turretWorld() {
    var t = C.turretParts.yaw;
    if (!t) return V(0, 0, 0);
    return t.group.localToWorld(V(0, 0, 0));
  }

  function updateAim(dt) {
    var t = C.turretParts.yaw, can = C.turretParts.cannon;
    if (!t || !can) return;
    var tgt = C.target;
    var orig = turretWorld();
    if (tgt && !tgt.dead) {
      var p = tgt.group.position.clone();
      p.y += (tgt.size.y * ENEMY_SCALE) * 0.5;
      var d = p.sub(orig);
      C.yawGoal = Math.atan2(d.x, d.z);
      C.pitchGoal = -Math.atan2(d.y, Math.hypot(d.x, d.z));
    } else {
      C.pitchGoal = 0.42;                 // 待机时炮口略微下俯
    }
    // 正角度 = 炮口向下俯（对地攻击），必须夹在正区间
    C.pitchGoal = Math.max(0.05, Math.min(1.35, C.pitchGoal));
    var k = Math.min(1, dt * 5.5);
    C.yaw += angDiff(C.yawGoal, C.yaw) * k;
    C.pitch += (C.pitchGoal - C.pitch) * k;

    t.group.rotation.y = C.yaw;
    can.group.rotation.order = 'YXZ';
    can.group.rotation.y = C.yaw;
    can.group.rotation.x = C.pitch;
    if (C.turretParts.drum) C.turretParts.drum.group.rotation.y = C.yaw;
    if (C.turretParts.damper) C.turretParts.damper.group.rotation.y = C.yaw;
    t.group.updateWorldMatrix(true, false);
    can.group.updateWorldMatrix(true, false);
  }

  function fireCannon() {
    if (C.ammo <= 0 || !C.target || C.target.dead) return false;
    var can = C.turretParts.cannon;
    if (!can) return false;
    can.group.updateWorldMatrix(true, false);        // 刚改过转角，先刷新矩阵再算炮口
    var muzzle = can.group.localToWorld(V(0, -0.16, 7.4));
    var dir = V(0, 0, 1).applyQuaternion(can.group.getWorldQuaternion(new C.E3.Quaternion())).normalize();

    var e = C.target;
    var aim = e.group.position.clone();
    aim.y += (e.size.y * ENEMY_SCALE) * 0.55;
    var toAim = aim.clone().sub(muzzle).normalize();
    var hit = dir.dot(toAim) > 0.965;                  // 瞄得准才算命中
    var travel = muzzle.distanceTo(aim);

    var tg = (DJIEnemies.tracer || function () { return new C.E3.Group(); })(C.H);
    tg.position.copy(muzzle);
    tg.scale.setScalar(0.9);
    var look = muzzle.clone().add(hit ? toAim : dir);
    tg.lookAt(look);
    C.fxGroup.add(tg);
    C.tracers.push({ g: tg, prev: muzzle.clone(), dir: (hit ? toAim : dir), speed: 95, life: 0,
      hit: hit, target: e, travel: travel });

    C.ammo--;
    C.shotCd = 0.09;
    C.E.S.shake = Math.min(1.2, C.E.S.shake + 0.16);
    // 枪口火光
    var fl = new C.E3.Sprite(new C.E3.SpriteMaterial({
      map: C.H.TEX.glow, color: 0xffd070, transparent: true, opacity: 0.9,
      blending: C.E3.AdditiveBlending, depthWrite: false
    }));
    fl.position.copy(muzzle);
    fl.scale.setScalar(1.6);
    fl.userData.life = 0; fl.userData.max = 0.08;
    C.fxGroup.add(fl); C.fx.push(fl);
    // 后坐（炮身后移，指数回位）
    C.recoil = 0.42;
    return true;
  }

  function fireMissile() {
    if (C.msl <= 0 || !C.target || C.target.dead) return false;
    var rail = C.turretParts.rail;
    var e = C.target;
    var start = e && rail ? rail.group.localToWorld(V(0, -0.6, 0)) : V(0, -2, 0);
    var m = (DJIEnemies.missile || function () { return new C.E3.Group(); })(C.H);
    m.position.copy(start);
    m.scale.setScalar(1.1);
    C.fxGroup.add(m);
    C.missiles.push({ g: m, target: e, speed: 34, life: 0, trail: 0 });
    C.msl--;
    DJIEngine.api.flash(150);
    return true;
  }

  /* ---------------- 每帧 ---------------- */
  function updateTracers(dt) {
    for (var i = C.tracers.length - 1; i >= 0; i--) {
      var t = C.tracers[i];
      t.life += dt;
      t.prev.copy(t.g.position);
      t.g.position.addScaledVector(t.dir, t.speed * dt);
      if (t.hit && t.target && !t.target.dead) {
        // 线段—球体命中：子弹再快也不会跳过目标
        var c = t.target.group.position;
        var r = 2.4;
        var ab = t.g.position.clone().sub(t.prev);
        var ac = c.clone().sub(t.prev);
        var abLen2 = ab.lengthSq();
        var s = abLen2 > 1e-6 ? Math.max(0, Math.min(1, ac.dot(ab) / abLen2)) : 0;
        var closest = t.prev.clone().addScaledVector(ab, s);
        if (closest.distanceTo(c) < r) {
          damage(t.target, 9 + Math.random() * 5, closest);
          C.fxGroup.remove(t.g); C.tracers.splice(i, 1);
          continue;
        }
      }
      if (t.life > 2.2 || t.g.position.length() > 90) {
        C.fxGroup.remove(t.g); C.tracers.splice(i, 1);
      }
    }
  }

  function damage(e, amount, pos) {
    e.hp -= amount;
    e.flashT = 0.12;
    spawnExplosion(pos || e.group.position.clone(), 1.1, false);
    if (e.hp <= 0) killEnemy(e);
  }

  function updateMissiles(dt) {
    for (var i = C.missiles.length - 1; i >= 0; i--) {
      var m = C.missiles[i];
      m.life += dt;
      var tgt = m.target && !m.target.dead ? m.target.group.position.clone().add(V(0, 1.2, 0))
        : m.g.position.clone().addScaledVector(V(0, 0, 1), 4);
      var d = tgt.sub(m.g.position);
      var dist = d.length();
      d.normalize();
      var cur = V(0, 0, 1).applyQuaternion(m.g.getWorldQuaternion(new C.E3.Quaternion())).normalize();
      // 简单制导：朝目标转向
      var nd = cur.clone().lerp(d, Math.min(1, dt * 3.2)).normalize();
      m.g.lookAt(m.g.position.clone().add(nd));
      m.g.position.addScaledVector(nd, m.speed * dt);
      m.trail += dt;
      if (m.trail > 0.035) { m.trail = 0; spawnPuff(m.g.position.clone(), false); }
      if (dist < 3.0) {
        var pos = m.g.position.clone();
        spawnExplosion(pos, 5.2, true);
        C.E.S.shake = 1.0;
        DJIEngine.api.flash(300);
        // 溅射
        for (var j = 0; j < C.enemies.length; j++) {
          var e2 = C.enemies[j];
          if (e2.dead) continue;
          var dd = e2.group.position.distanceTo(pos);
          if (dd < 9) damage(e2, e2 === m.target ? 300 : (9 - dd) * 12, pos);
        }
        C.fxGroup.remove(m.g); C.missiles.splice(i, 1);
      } else if (m.life > 8) {
        C.fxGroup.remove(m.g); C.missiles.splice(i, 1);
      }
    }
  }

  function updateFx(dt) {
    for (var i = C.fx.length - 1; i >= 0; i--) {
      var f = C.fx[i];
      f.userData.life += dt;
      var maxAge = (typeof f.userData.max === 'number' && isFinite(f.userData.max) && f.userData.max > 0)
        ? f.userData.max : 0.6;                       // 兜底，绝不让 k 变成 NaN
      var k = f.userData.life / maxAge;
      if (!isFinite(k) || k >= 1) {
        if (f.isLight) C.E.scene.remove(f);
        else if (f.parent) f.parent.remove(f);
        C.fx.splice(i, 1);
        continue;
      }
      if (f.isLight) {
        var baseI = f.userData.baseI;
        if (baseI === undefined) { baseI = f.intensity; f.userData.baseI = baseI; }
        var next = baseI * (1 - k) * (1 - k);
        f.intensity = isFinite(next) ? next : 0;      // 非有限值立即归零，防止污染整场景光照
      } else if (f.isSprite) {
        f.material.opacity = 0.55 * (1 - k);
        f.scale.setScalar(f.scale.x + dt * f.userData.rise * 2.2);
        f.position.y += dt * f.userData.rise * 1.6;
      } else {
        var sc = f.userData.scale * (0.35 + 0.65 * Math.min(1, k * 2.6));
        f.scale.setScalar(sc * (1 + k * 0.6));
        if (f.material) f.material.opacity = Math.max(0, 1 - k) * (f.userData.flash ? 0.9 : 1);
        var sp = f.userData.scale;
        f.rotation.y += dt * 1.6;
        // 环状扩散
        if (f.geometry && f.geometry.type === 'RingGeometry') {
          f.scale.setScalar(f.userData.scale * (0.4 + k * 2.6));
          f.material.opacity = 0.9 * (1 - k);
        }
        void sp;
      }
    }
  }

  function updateEnemyAA(dt) {
    for (var i = 0; i < C.enemies.length; i++) {
      var e = C.enemies[i];
      if (e.dead || e.type !== 'aa' || !e.detected) continue;
      e.aaCd -= dt;
      if (e.aaCd > 0) continue;
      e.aaCd = 7 + Math.random() * 6;
      // 朝机体打一串曳光（视觉 + 轻微战损）
      var from = e.group.position.clone().add(V(0, 2.4, 0));
      var to = C.E.root.position.clone();
      var dir = to.sub(from).normalize();
      var tg = (DJIEnemies.tracer || function () { return new C.E3.Group(); })(C.H);
      tg.position.copy(from);
      tg.scale.setScalar(1.1);
      tg.lookAt(from.clone().add(dir));
      C.fxGroup.add(tg);
      C.aaShots.push({ g: tg, dir: dir, life: 0, speed: 60 });
    }
  }

  function updateAAShots(dt) {
    for (var i = C.aaShots.length - 1; i >= 0; i--) {
      var s = C.aaShots[i];
      s.life += dt;
      s.g.position.addScaledVector(s.dir, s.speed * dt);
      if (s.life > 0.55) {
        if (s.life < 0.7) {
          C.integrity = Math.max(0, C.integrity - 2.5);
          C.lastHit = 0;
          DJIEngine.api.flash(120);
          C.E.S.shake = Math.min(1.4, C.E.S.shake + 0.35);
          spawnExplosion(s.g.position.clone(), 1.4, false);
        }
        if (s.life > 0.8) { C.fxGroup.remove(s.g); C.aaShots.splice(i, 1); }
      }
    }
  }

  function updateBoard() {
    var el = byId('targetboard');
    if (!el) return;
    var rows = [];
    var shown = C.enemies.slice().sort(function (a, b) {
      if (a.dead !== b.dead) return a.dead ? 1 : -1;
      return b.lock - a.lock;
    }).slice(0, 5);
    shown.forEach(function (e) {
      var cls = 'tgt';
      if (e.dead) cls += ' dead';
      else if (e.lock >= 1) cls += ' locked';
      else if (e.detected) cls += ' detected';
      if (C.target === e) cls += ' primary';
      var hpPct = Math.max(0, Math.round(e.hp / e.maxHp * 100));
      var scanPct = Math.round(e.lock * 100);
      rows.push('<div class="' + cls + '">' +
        '<div class="r1"><b>' + e.code + '</b><span>' + (e.dead ? 'DESTROYED' : (e.lock >= 1 ? 'LOCK' : (e.detected ? 'TRACK' : 'IDLE'))) + '</span></div>' +
        '<div class="r2">' + e.name + ' · ' + (e.group.position.length() * 2).toFixed(0) + 'm</div>' +
        '<div class="bar' + (e.lock >= 1 ? '' : ' scan') + '"><i style="width:' + (e.dead ? 0 : (e.lock >= 1 ? hpPct : scanPct)) + '%"></i></div>' +
        '</div>');
    });
    var html = rows.join('');
    if (el.__html !== html) { el.innerHTML = html; el.__html = html; }
  }

  /* ---------------- 行为接口 ---------------- */
  var behavior = {
    init: function (E) {
      C.E = E;
      C.E3 = window.THREE;
      C.H = window.DJIEngine.helpers;
      C.turretParts = {
        yaw: E.partById['turretYaw'],
        cannon: E.partById['cannon'],
        drum: E.partById['ammoDrum'],
        damper: E.partById['recoilDamper'],
        rail: E.partById['missileRail']
      };
      C.enemyGroup = new C.E3.Group();
      E.scene.add(C.enemyGroup);
      C.fxGroup = new C.E3.Group();
      E.scene.add(C.fxGroup);
      E.hud.RADAR_RANGE = 90;
      C.pitch = C.pitchGoal = 0.42;
      spawnWave(0);
      C.spawnCd = 0;
    },

    update: function (dt, E) {
      // 后坐回位（在引擎写好 explode 位置之后再叠加）
      C.recoil = Math.max(0, (C.recoil || 0) - dt * 2.4);
      var canon = E.partById['cannon'];
      if (canon && C.recoil > 0.001) canon.group.position.z -= C.recoil;

      C.target = pickTarget();
      updateScan(dt);
      updateAim(dt);

      // 交战状态机
      if (!C.target) C.mode = C.enemies.some(function (e) { return !e.dead && e.lock > 0; }) ? 'TRACK' : 'SEARCH';
      else C.mode = C.auto ? 'ENGAGE' : 'MANUAL';

      if (C.target && !C.target.dead) {
        var dist = C.target.group.position.distanceTo(E.root.position);
        if (C.auto) {
          C.fireCd -= dt;
          C.shotCd -= dt;
          if (C.burst > 0 && C.shotCd <= 0) { if (fireCannon()) C.burst--; else C.burst = 0; }
          if (C.burst === 0 && C.fireCd <= 0 && C.ammo > 0) {
            C.burst = 5; C.fireCd = 1.15;
          }
          if (C.msl > 0 && dist > 22 && !C.target.weakFired) {
            C.target.weakFired = true;
            fireMissile();
          }
        }
      }

      // 弹药补给（不放任无限连射）
      if (C.ammo < C.ammoMax) C.ammo = Math.min(C.ammoMax, C.ammo + dt * 2.2);
      if (C.msl < C.mslMax) {
        C.mslCd = (C.mslCd || 0) + dt;
        if (C.mslCd > 14) { C.mslCd = 0; C.msl++; }
      }

      updateTracers(dt);
      updateMissiles(dt);
      updateEnemyAA(dt);
      updateAAShots(dt);
      updateFx(dt);
      C.E.S.shake = Math.max(0, C.E.S.shake - dt * 2.2);

      // 战损恢复
      C.lastHit += dt;
      if (C.lastHit > 5) C.integrity = Math.min(100, C.integrity + dt * 2.4);

      // 波次推进
      var alive = C.enemies.filter(function (e) { return !e.dead; }).length;
      if (alive === 0 && E.S.exploded === false) {
        C.waveCd += dt;
        if (C.waveCd > 3) spawnWave(0);
      }

      // 雷达触点 + 锁定框
      E.S.contacts = C.enemies.map(function (e) {
        return { x: e.group.position.x * 2, z: e.group.position.z * 2,
          sel: C.target === e, dead: e.dead };
      });
      var markers = [];
      C.enemies.forEach(function (e) {
        if (e.dead || !e.detected) return;
        var halo = e.size;
        markers.push({ pos: e.group.position.clone().add(V(0, halo.y * ENEMY_SCALE * 0.5, 0)),
          size: { x: halo.x * ENEMY_SCALE * 1.5, y: halo.y * ENEMY_SCALE * 1.9, z: halo.z * ENEMY_SCALE * 1.5 },
          dead: false, lock: e.lock });
      });
      markers.sort(function (a, b) { return b.lock - a.lock; });
      E.S.markers = markers.slice(0, 6);

      C.boardCd -= dt;
      if (C.boardCd <= 0) { C.boardCd = 0.15; updateBoard(); }

      // 雷达侧栏
      var els = E.hud.els;
      if (els.ammo) els.ammo.textContent = Math.round(C.ammo) + '/' + C.ammoMax;
      if (els.msl) els.msl.textContent = C.msl + '/' + C.mslMax;
    },

    hudRows: function (S, E) {
      var alt = 36 + (S.camAlt + 3) * 2.4;
      var spd = 14 + S.rotRate * 22 + S.explodeT * 4;
      return [
        [{ k: 'ALT', v: alt.toFixed(0) + ' m' }, { k: 'SPD', v: spd.toFixed(0) + ' km/h' },
         { k: 'HDG', v: pad(Math.round(S.camAz)) + '°' }],
        [{ k: 'TGT', v: C.target ? C.target.code : '—' },
         { k: 'LOCK', v: C.target ? Math.round(C.target.lock * 100) + '%' : '—',
           c: C.target ? 'hot' : '' },
         { k: 'THREAT', v: pad(C.enemies.filter(function (e) { return !e.dead; }).length),
           c: 'hot' }],
        [{ k: 'AMMO', v: Math.round(C.ammo) + '/60', c: C.ammo < 15 ? 'hot' : 'ok' },
         { k: 'MSL', v: C.msl + '/2', c: C.msl === 0 ? 'hot' : 'ok' },
         { k: 'HULL', v: Math.round(C.integrity) + '%', c: C.integrity < 60 ? 'hot' : 'ok' }]
      ];
    },

    mission: function (S) {
      return {
        mode: 'MODE ' + C.mode,
        wave: Math.max(1, C.wave),
        kill: C.kills,
        threat: C.enemies.filter(function (e) { return !e.dead; }).length
      };
    },

    buttons: {
      'btn-auto': function (E) {
        C.auto = !C.auto;
        DJIEngine.api.setButton('btn-auto', '自动交战', C.auto, '');
      },
      'btn-fire': function (E) {
        if (!C.auto) { C.burst = 5; C.fireCd = 0; }
        else if (C.burst === 0) { C.burst = 5; C.fireCd = 0; C.auto = false; }
        else { C.burst = 5; C.fireCd = 0; }
        DJIEngine.api.setButton('btn-auto', '自动交战', C.auto, '');
      },
      'btn-missile': function (E) { fireMissile(); },
      'btn-wave': function (E) { spawnWave(0); }
    },

    keys: {
      'f': function (E) { behavior.buttons['btn-fire'](E); },
      'm': function (E) { fireMissile(); },
      'g': function (E) { behavior.buttons['btn-auto'](E); },
      'n': function (E) { spawnWave(0); }
    },

    pickables: function () {
      var out = [];
      C.enemies.forEach(function (e) { if (!e.dead) out = out.concat(e.meshes); });
      return out;
    },

    pick: function (hit, E) {
      if (hit && hit.kind === 'enemy') {
        C.manual = hit.ref;
        if (!hit.ref.detected) { hit.ref.detected = true; hit.ref.lock = 1; spawnPing(hit.ref.group.position.clone()); }
        return true;
      }
      return true;    // 点击空白不取消部件选中之外的逻辑
    },

    hover: function (hit) {
      if (hit && hit.kind === 'enemy') C.hoverEnemy = hit.ref;
      else C.hoverEnemy = null;
    },

    enemyTip: function (e) {
      return e.name + ' · ' + e.code + (e.dead ? ' · DESTROYED'
        : (e.lock >= 1 ? ' · 已锁定，可打击' : ' · 跟踪中 ' + Math.round(e.lock * 100) + '%'));
    }
  };

  window.DJICombat = behavior;
  window.DJIPage = window.DJIPage || {};
  window.DJIPage.behavior = behavior;
})();