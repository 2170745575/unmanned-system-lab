/* =========================================================================
   MEDEVAC-1 救护模拟行为（medical.js）
   -------------------------------------------------------------------------
   生命探测扫描 → 分诊定级 → 投送医疗物资 / 绞盘吊救后送 → 生命体征稳定
   行为层只通过引擎暴露的 E 与 DJIEngine.helpers 交互。
   注意：本文件先于 Three.js 加载执行，顶层绝对不能触碰 THREE。
   ========================================================================= */
(function () {
  'use strict';

  var PROP_SCALE = 0.10;             // 地面道具与机型同比例（cm → 场景单位）
  var RING_MIN = 15, RING_MAX = 34;  // 伤员分布半径（场景单位）
  var SCAN_WIDTH = 0.15;             // 生命探测扇面判定宽度（弧度）
  var VITAL_TIME = 1.8;              // 从发现到生命体征确认

  var LEVELS = {
    critical: { name: '危重', cls: 'critical', color: '#ff5a4d', order: 0 },
    severe: { name: '重伤', cls: 'severe', color: '#ffb020', order: 1 },
    minor: { name: '轻伤', cls: 'minor', color: '#7fd8a0', order: 2 }
  };

  var C = {
    E: null, H: null, E3: null,
    propGroup: null, fxGroup: null,
    casualties: [], wave: 0, saved: 0, lost: 0, evacuated: 0,
    auto: true, target: null, manual: null,
    triaged: 0, sortie: 0,
    supplies: { blood: 6, o2: 2, drug: 8 },
    suppliesMax: { blood: 6, o2: 2, drug: 8 },
    pod: null, hoist: null, ops: [], fx: [], cable: null,
    boardCd: 0, nextCd: 0, mode: 'SEARCH', status: '待命'
  };

  function V(x, y, z) { return new C.E3.Vector3(x, y, z); }
  function angDiff(a, b) {
    var d = (a - b + Math.PI) % (Math.PI * 2);
    if (d < 0) d += Math.PI * 2;
    return d - Math.PI;
  }
  function byId(id) { return document.getElementById(id); }
  function pad(n) { return String(n).padStart(2, '0'); }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  /* ---------------- 伤员 ---------------- */
  function spawnWave() {
    C.wave++;
    var n = Math.min(2 + C.wave, 7);
    var spread = ['wounded', 'wounded', 'walkingwounded'];
    for (var i = 0; i < n; i++) {
      var a = (i / n) * Math.PI * 2 + Math.random() * 0.6;
      var r = RING_MIN + Math.random() * (RING_MAX - RING_MIN);
      spawnCasualty(spread[i % spread.length], Math.sin(a) * r, Math.cos(a) * r, a);
    }
    // 每批附带一处医疗标记与信标
    var ma = Math.random() * Math.PI * 2, mr = RING_MIN + 3;
    addProp('marker', Math.sin(ma) * mr, Math.cos(ma) * mr);
    addProp('crate', Math.sin(ma + 0.6) * (mr + 3), Math.cos(ma + 0.6) * (mr + 3));
    C.nextCd = 0;
    C.status = '已接收新一批伤员';
  }

  function addProp(kind, x, z, rotY) {
    var H = C.H;
    var fn = (window.DJICasualties || {})[kind];
    if (!fn) return null;
    var g = fn(H);
    g.position.set(x, C.E.FLOOR_Y, z);
    g.rotation.y = rotY || Math.random() * 6.28;
    g.scale.setScalar(PROP_SCALE);
    C.propGroup.add(g);
    return g;
  }

  var CODE = 0;
  function spawnCasualty(kind, x, z, bearing) {
    var H = C.H;
    var fn = (window.DJICasualties || {})[kind] || (window.DJICasualties || {}).wounded;
    if (!fn) return null;
    var model = fn(H);
    var g = new C.E3.Group();
    g.add(model);
    g.scale.setScalar(PROP_SCALE);
    g.position.set(x, C.E.FLOOR_Y + 0.02, z);
    g.rotation.y = -bearing + Math.PI;
    C.propGroup.add(g);

    // 生命体征（真实感数值：危重者心率快、血氧低）
    var roll = Math.random();
    var level = roll < 0.34 ? 'critical' : (roll < 0.72 ? 'severe' : 'minor');
    var vit = level === 'critical'
      ? { hr: 128 + Math.random() * 26, spo2: 78 + Math.random() * 7, sbp: 70 + Math.random() * 12 }
      : (level === 'severe'
        ? { hr: 106 + Math.random() * 18, spo2: 88 + Math.random() * 6, sbp: 92 + Math.random() * 12 }
        : { hr: 84 + Math.random() * 14, spo2: 95 + Math.random() * 4, sbp: 112 + Math.random() * 12 });

    var meshes = [];
    g.traverse(function (o) { if (o.isMesh) { o.castShadow = true; meshes.push(o); } });

    var c = {
      kind: kind, group: g, meshes: meshes, code: 'C-' + pad(++CODE),
      level: level, levelName: LEVELS[level].name,
      detected: false, lock: 0, treated: false, evacuated: false, critical: level === 'critical',
      vit: vit, vitBase: { hr: vit.hr, spo2: vit.spo2, sbp: vit.sbp },
      alive: true, bleed: level === 'critical' ? 0.5 : (level === 'severe' ? 0.26 : 0.1),
      size: model.userData.size || { x: 40, y: 30, z: 176 }, action: null
    };
    meshes.forEach(function (m) { m.userData.enemyRef = c; });
    C.casualties.push(c);
    return c;
  }

  /* ---------------- 生命体征推演 ---------------- */
  function updateVitals(dt) {
    for (var i = 0; i < C.casualties.length; i++) {
      var c = C.casualties[i];
      if (!c.alive) continue;
      if (c.treated) {
        // 救治后逐步稳定
        c.vit.hr += (78 - c.vit.hr) * Math.min(1, dt * 0.5);
        c.vit.spo2 += (97 - c.vit.spo2) * Math.min(1, dt * 0.55);
        c.vit.sbp += (118 - c.vit.sbp) * Math.min(1, dt * 0.45);
        if (Math.abs(c.vit.spo2 - 97) < 1 && c.level !== 'minor') {
          c.level = c.level === 'critical' ? 'severe' : 'minor';
          c.levelName = LEVELS[c.level].name;
        }
      } else {
        // 未救治则持续恶化（给玩家紧迫感，但不至于瞬间归零）
        var k = dt * c.bleed * 0.09;
        c.vit.spo2 = Math.max(55, c.vit.spo2 - k * 26);
        c.vit.hr = Math.min(190, c.vit.hr + k * 34);
        c.vit.sbp = Math.max(40, c.vit.sbp - k * 22);
        if (c.vit.spo2 <= 58 || c.vit.hr >= 188) {
          c.alive = false;
          C.lost++;
          C.status = c.code + ' 未能及时救治';
          spawnFx('cross', c.group.position.clone().add(V(0, 3, 0)), 0x8a8f95);
        }
      }
    }
  }

  /* ---------------- 扫描 / 分诊 ---------------- */
  function updateScan(dt) {
    var sweepPhi = 0.62 + (C.E.S.sweepAngle || 0);
    for (var i = 0; i < C.casualties.length; i++) {
      var c = C.casualties[i];
      if (!c.alive) continue;
      var phi = Math.atan2(-c.group.position.z, c.group.position.x);
      if (Math.abs(angDiff(phi, sweepPhi)) < SCAN_WIDTH && !c.detected) {
        c.detected = true;
        C.triaged++;
        spawnFx('ping', c.group.position.clone(), 0x3fa66a);
        C.status = c.code + ' 生命体征已确认';
      }
      if (c.detected && c.lock < 1) c.lock = Math.min(1, c.lock + dt / VITAL_TIME);
    }
  }

  function pickTarget() {
    if (C.manual && C.manual.alive && !C.manual.evacuated) return C.manual;
    var best = null, bestScore = -1e9;
    for (var i = 0; i < C.casualties.length; i++) {
      var c = C.casualties[i];
      if (!c.alive || c.evacuated || c.lock < 1) continue;
      // 优先级：先看分诊等级，再看待救治时间（血氧越低越急）
      var score = -LEVELS[c.level].order * 1000 + (100 - c.vit.spo2) * 4 -
        c.group.position.distanceTo(C.E.root.position) * 0.6;
      if (score > bestScore) { bestScore = score; best = c; }
    }
    return best;
  }

  /* ---------------- 救援作业 ---------------- */
  function spawnPod() {
    var H = C.H, E = C.E;
    if (C.pod) return C.pod;
    var pod = E.model.builder.supplyPod(H);
    var g = new C.E3.Group();
    g.add(pod);
    g.scale.setScalar(PROP_SCALE);
    g.visible = false;
    E.scene.add(g);
    C.pod = { g: g, state: 'idle', t: 0, target: null, y: 0 };
    return C.pod;
  }

  function spawnHoist() {
    var H = C.H, E = C.E;
    if (C.hoist) return C.hoist;
    // 吊救吊篮：简易框架 + 吊带
    var g = new C.E3.Group();
    var mat = H.std({ color: 0xb4bec6, roughness: 0.45, metalness: 0.5 });
    var red = H.std({ color: 0xc0392b, roughness: 0.5, metalness: 0.15,
      emissive: 0xc0392b, emissiveIntensity: 0.2 });
    g.add(new H.THREE.Mesh(H.cyl(46, 40, 34, 20, true), mat));
    g.children[g.children.length - 1].position.set(0, -17, 0);
    g.add(new H.THREE.Mesh(H.cyl(46, 46, 4, 20), mat));
    g.add(new H.THREE.Mesh(new H.THREE.TorusGeometry(46, 4, 8, 24), mat));
    g.children[g.children.length - 1].rotation.x = Math.PI / 2;
    for (var i = 0; i < 3; i++) {
      var a = i / 3 * Math.PI * 2;
      H.addMesh(g, H.box(4, 60, 4), mat, Math.cos(a) * 40, 26, Math.sin(a) * 40, 0, 0, -Math.cos(a) * 0.3);
    }
    H.addMesh(g, H.box(30, 6, 60), red, 0, -8, 0);
    var wrap = new C.E3.Group();
    wrap.add(g);
    wrap.scale.setScalar(PROP_SCALE);
    wrap.visible = false;
    E.scene.add(wrap);
    C.hoist = { g: wrap, state: 'idle', t: 0, target: null, load: null };
    return C.hoist;
  }

  /** 已救治计数（每个伤员只计一次，投送与吊救都算）*/
  function countSaved(c) {
    if (!c.counted) { c.counted = true; C.saved++; }
  }

  /** 投送医疗物资（物资舱降到伤员旁）*/
  function dropSupplies() {
    var c = C.target || pickTarget();
    if (!c || !c.alive) { C.status = '没有可投送的目标'; return false; }
    if (C.supplies.blood <= 0 && C.supplies.drug <= 0) { C.status = '物资已耗尽，等待补给'; return false; }
    var pod = spawnPod();
    if (pod.state !== 'idle') return false;
    pod.state = 'lowering'; pod.t = 0; pod.target = c;
    pod.g.visible = true;
    var belly = C.E.partById['supplyPod'].group.localToWorld(V(0, -62, -30));
    pod.g.position.copy(belly);
    pod.y = belly.y;
    c.action = 'supply';
    C.supplies.blood = Math.max(0, C.supplies.blood - 1);
    C.supplies.drug = Math.max(0, C.supplies.drug - 2);
    C.status = '向 ' + c.code + ' 投送血液与急救药品';
    return true;
  }

  /** 绞盘吊救后送（危重伤员优先）*/
  function hoistCasualty() {
    var c = C.target || pickTarget();
    if (!c || !c.alive) { C.status = '没有可吊救的目标'; return false; }
    var h = spawnHoist();
    if (h.state !== 'idle') return false;
    h.state = 'lowering'; h.t = 0; h.target = c;
    h.g.visible = true;
    var belly = C.E.partById['winchHoist'].group.localToWorld(V(0, -8, -6));
    h.g.position.copy(belly);
    c.action = 'hoist';
    C.status = '对 ' + c.code + ' 实施绞盘吊救';
    return true;
  }

  /** 电缆可视化 */
  function updateCable(from, to, on) {
    var H = C.H, E = C.E;
    if (!C.cable) {
      var m = new C.E3.Mesh(H.cylZ(0.22, 0.22, 1, 8), H.std({ color: 0x8a9299, roughness: 0.4, metalness: 0.8 }));
      m.visible = false;
      E.scene.add(m);
      C.cable = m;
    }
    C.cable.visible = !!on;
    if (!on) return;
    var d = new C.E3.Vector3().subVectors(to, from);
    var len = d.length();
    if (len < 0.05) { C.cable.visible = false; return; }
    H.placeAlong(C.cable, from, to);
    C.cable.scale.set(1, 1, len);
  }

  function updateOps(dt) {
    var E = C.E;
    // ---- 物资投送 ----
    if (C.pod) {
      var p = C.pod;
      var bellyP = E.partById['supplyPod'].group.localToWorld(V(0, -62, -30));
      if (p.state === 'lowering' || p.state === 'lifting') {
        p.t += dt;
        p.y += (p.state === 'lowering' ? -1 : 1) * dt * (p.state === 'lowering' ? 6.5 : 5.0);
        p.g.position.set(bellyP.x, p.y, bellyP.z);
        updateCable(bellyP, p.g.position.clone().add(V(0, 24, 0)), true);
        if (p.state === 'lowering' && p.y <= E.FLOOR_Y + 1.2) {
          p.y = E.FLOOR_Y + 1.2;
          p.state = 'landed'; p.t = 0;
          spawnFx('smoke', p.g.position.clone(), 0xc8d6cf);
          var c = p.target;
          if (c && c.alive) {
            c.treated = true; c.lock = 1;
            countSaved(c);                       // 投送物资使其稳定，也算已救治
            C.status = c.code + ' 已获得血液与药品，生命体征开始稳定';
            spawnFx('cross', c.group.position.clone().add(V(0, 3, 0)), 0x3fa66a);
          }
        } else if (p.state === 'lifting' && p.y >= bellyP.y) {
          p.state = 'idle'; p.t = 0; p.g.visible = false; p.target = null;
          updateCable(bellyP, bellyP, false);
          C.status = '物资舱已回收';
        }
      } else if (p.state === 'landed') {
        p.t += dt;
        updateCable(bellyP, p.g.position.clone().add(V(0, 24, 0)), true);
        if (p.t > 2.6) { p.state = 'lifting'; p.t = 0; }
      }
    }
    // ---- 绞盘吊救 ----
    if (C.hoist) {
      var h = C.hoist;
      var bellyH = E.partById['winchHoist'].group.localToWorld(V(0, -8, -6));
      if (h.state === 'lowering' || h.state === 'lifting') {
        h.t += dt;
        h.y = h.y === undefined ? bellyH.y : h.y;
        h.y += (h.state === 'lowering' ? -1 : 1) * dt * 7.5;
        h.g.position.set(bellyH.x, h.y, bellyH.z);
        updateCable(bellyH, h.g.position.clone().add(V(0, 20, 0)), true);
        if (h.state === 'lowering' && h.y <= E.FLOOR_Y + 9) {
          h.y = E.FLOOR_Y + 9;
          h.state = 'loading'; h.t = 0;
          var c2 = h.target;
          if (c2 && c2.alive) {
            c2.treated = true;
            C.status = c2.code + ' 已固定于吊篮，准备起吊';
          }
        } else if (h.state === 'lifting' && h.y >= bellyH.y) {
          h.state = 'idle'; h.t = 0; h.g.visible = false;
          var c3 = h.target;
          if (c3) {
            c3.evacuated = true; C.evacuated++;
            c3.treated = true;
            countSaved(c3);                      // 舱内救治同样计入已救治
            c3.group.visible = false;
            C.status = c3.code + ' 已后送进入医疗舱';
          }
          h.target = null;
          updateCable(bellyH, bellyH, false);
        }
      } else if (h.state === 'loading') {
        h.t += dt;
        updateCable(bellyH, h.g.position.clone().add(V(0, 20, 0)), true);
        if (h.t > 2.2) { h.state = 'lifting'; h.t = 0; }
      }
    }
  }

  /* ---------------- 特效 ---------------- */
  function spawnFx(kind, pos, color) {
    var H = C.H, E = C.E;
    if (kind === 'ping') {
      var r = new C.E3.Mesh(new C.E3.RingGeometry(0.6, 0.8, 40),
        new C.E3.MeshBasicMaterial({ color: color || 0x3fa66a, transparent: true, opacity: 0.9,
          side: C.E3.DoubleSide, blending: C.E3.AdditiveBlending, depthWrite: false }));
      r.rotation.x = -Math.PI / 2;
      r.position.copy(pos);
      r.userData.life = 0; r.userData.max = 1.0; r.userData.ring = true;
      C.fxGroup.add(r); C.fx.push(r);
    } else if (kind === 'cross') {
      var fn = (window.DJICasualties || {}).medcross;
      if (!fn) return;
      var g = fn(H);
      g.position.copy(pos);
      g.scale.setScalar(PROP_SCALE);
      g.userData.life = 0; g.userData.max = 1.8; g.userData.rise = 1.2; g.userData.cross = true;
      C.fxGroup.add(g); C.fx.push(g);
    } else if (kind === 'smoke') {
      var fn2 = (window.DJICasualties || {}).dropsmoke;
      if (!fn2) return;
      var s = fn2(H);
      s.position.copy(pos);
      s.scale.setScalar(PROP_SCALE);
      s.userData.life = 0; s.userData.max = 2.4; s.userData.smoke = true;
      C.fxGroup.add(s); C.fx.push(s);
    }
  }

  function updateFx(dt) {
    for (var i = C.fx.length - 1; i >= 0; i--) {
      var f = C.fx[i];
      f.userData.life += dt;
      var maxAge = (typeof f.userData.max === 'number' && isFinite(f.userData.max) && f.userData.max > 0)
        ? f.userData.max : 1;
      var k = f.userData.life / maxAge;
      if (!isFinite(k) || k >= 1) {
        if (f.parent) f.parent.remove(f);
        C.fx.splice(i, 1);
        continue;
      }
      if (f.userData.ring) {
        f.scale.setScalar(0.5 + k * 5.5);
        f.material.opacity = 0.9 * (1 - k);
      } else if (f.userData.cross) {
        f.position.y += dt * f.userData.rise;
        // 医疗十字只有 ±Z 两个薄板，自转会变成一条线 → 始终面向相机（billboard）
        if (C.E.camera) f.quaternion.copy(C.E.camera.quaternion);
        var mesh = f.children[0];
        if (mesh) {
          mesh.traverse(function (o) {
            if (o.isMesh && o.material) {
              o.material.transparent = true;
              o.material.opacity = Math.min(1, (1 - k) * 2.2);
            }
          });
        }
      } else if (f.userData.smoke) {
        f.scale.setScalar(PROP_SCALE * (1 + k * 1.6));
        f.position.y += dt * 1.2;
        f.traverse(function (o) {
          if (o.isMesh && o.material && o.material.transparent) o.material.opacity = 0.6 * (1 - k);
        });
      }
    }
  }

  /* ---------------- 目标板 ---------------- */
  function updateBoard() {
    var el = byId('casualtyboard');
    if (!el) return;
    var list = C.casualties.slice().sort(function (a, b) {
      if (a.alive !== b.alive) return a.alive ? -1 : 1;
      if (a.evacuated !== b.evacuated) return a.evacuated ? 1 : -1;
      return LEVELS[a.level].order - LEVELS[b.level].order;
    }).slice(0, 6);
    var html = list.map(function (c) {
      var cls = 'cas' + (c.level === 'critical' ? ' critical' : (c.level === 'severe' ? ' severe' : ' minor'));
      if (c.evacuated) cls = 'cas evacuated';
      if (!c.alive) cls = 'cas lost';
      if (!c.detected && c.alive) cls = 'cas idle';
      if (C.target === c) cls += ' primary';
      var state = c.evacuated ? '已后送' : (!c.alive ? '已失去' : (c.treated ? '已稳定' :
        (c.lock >= 1 ? '待救治' : (c.detected ? '体征确认中' : '未探测'))));
      var pct = c.evacuated ? 100 : Math.round(c.lock * 100);
      return '<div class="' + cls + '">' +
        '<div class="r1"><b>' + c.code + '</b><span>' + state + '</span></div>' +
        '<div class="r2">' + c.levelName + ' · ' + (c.group.position.length() * 10).toFixed(0) + 'm' +
        ' · HR ' + Math.round(c.vit.hr) + ' · SpO₂ ' + Math.round(c.vit.spo2) + '%</div>' +
        '<div class="bar"><i style="width:' + (c.alive ? pct : 0) + '%"></i></div>' +
        '</div>';
    }).join('');
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
      E.hud.RADAR_RANGE = 420;      // 医疗页雷达量程更大（单位 cm）
      C.els = {
        supply1: byId('rd-sup1'), supply2: byId('rd-sup2'),
        status: byId('m-status'), board: byId('casualtyboard') };

      // 战场医院（固定场景元素）
      addProp('tent', -24, -30, 0.35);
      addProp('tent', -30, -18, 0.1);
      addProp('ambulance', -18, -42, 0.9);
      addProp('ivstand', -21, -26, 0);
      addProp('ivstand', -26, -33, 0);
      addProp('crate', -16, -34, 0.4);
      addProp('crate', -14, -38, 1.2);
      addProp('beacon', -12, -26, 0);
      addProp('beacon', 18, 26, 0);

      spawnWave();
    },

    update: function (dt, E) {
      C.target = pickTarget();
      updateScan(dt);
      updateVitals(dt);
      updateOps(dt);
      updateFx(dt);

      // 自动救护
      if (C.auto && C.target && C.target.alive && !C.target.evacuated) {
        if (!C.target.action) {
          var busy = (C.pod && C.pod.state !== 'idle') || (C.hoist && C.hoist.state !== 'idle');
          if (!busy) {
            if (C.target.critical || C.target.level === 'critical') hoistCasualty();
            else if (C.supplies.blood > 0 || C.supplies.drug > 0) dropSupplies();
            else hoistCasualty();
          }
        }
      }

      // 物资补给（每次出动后逐步补充，避免卡死）
      C.supplies.blood = Math.min(C.suppliesMax.blood, C.supplies.blood + dt * 0.12);
      C.supplies.drug = Math.min(C.suppliesMax.drug, C.supplies.drug + dt * 0.2);

      // 模式与状态
      var pending = C.casualties.filter(function (c) { return c.alive && !c.evacuated; }).length;
      var busy2 = (C.pod && C.pod.state !== 'idle') || (C.hoist && C.hoist.state !== 'idle');
      C.mode = busy2 ? (C.hoist && C.hoist.state !== 'idle' ? 'RECOVER' : 'DEPLOY')
        : (pending ? (C.target ? 'TRIAGE' : 'SEARCH') : 'STANDBY');
      if (pending === 0 && C.nextCd !== -1) {
        C.nextCd += dt;
        if (C.nextCd > 4) { C.nextCd = 0; spawnWave(); }
      }

      // 雷达触点与标记
      E.S.contacts = C.casualties.filter(function (c) { return c.alive && !c.evacuated; }).map(function (c) {
        return { x: c.group.position.x * 10, z: c.group.position.z * 10, sel: C.target === c, dead: false };
      });
      var markers = [];
      C.casualties.forEach(function (c) {
        if (!c.alive || c.evacuated || !c.detected) return;
        var s = c.size;
        markers.push({ pos: c.group.position.clone().add(V(0, s.y * PROP_SCALE * 0.5, 0)),
          size: { x: s.x * PROP_SCALE * 2.4, y: s.y * PROP_SCALE * 2.6, z: s.z * PROP_SCALE * 1.4 },
          dead: false, lock: c.lock });
      });
      markers.sort(function (a, b) { return b.lock - a.lock; });
      E.S.markers = markers.slice(0, 6);

      C.boardCd -= dt;
      if (C.boardCd <= 0) { C.boardCd = 0.2; updateBoard(); }

      var els = C.els;      // 医用面板自己的 DOM 引用（在 init 里解析，引擎保持通用）
      if (els.supply1) els.supply1.textContent = Math.floor(C.supplies.blood) + '/' + C.suppliesMax.blood;
      if (els.supply2) els.supply2.textContent = Math.floor(C.supplies.drug) + '/' + C.suppliesMax.drug;
      if (els.status) els.status.textContent = C.status;
    },

    hudRows: function (S, E) {
      var pending = C.casualties.filter(function (c) { return c.alive && !c.evacuated; }).length;
      var t = C.target;
      return [
        [{ k: 'ALT', v: (12 + S.camAlt * 1.6).toFixed(0) + ' m' },
         { k: 'SPD', v: (18 + S.rotRate * 14).toFixed(0) + ' km/h' },
         { k: 'HDG', v: pad(Math.round(S.camAz)) + '°' }],
        [{ k: 'CAS', v: t ? t.code : '—' },
         { k: 'PRI', v: t ? t.levelName : '—', c: t && t.level === 'critical' ? 'hot' : '' },
         { k: 'HR', v: t ? Math.round(t.vit.hr) + ' bpm' : '—', c: t && t.vit.hr > 130 ? 'hot' : '' },
         { k: 'SpO₂', v: t ? Math.round(t.vit.spo2) + '%' : '—', c: t && t.vit.spo2 < 88 ? 'hot' : '' }],
        [{ k: 'PENDING', v: pad(pending), c: pending > 4 ? 'hot' : '' },
         { k: 'SAVED', v: pad(C.saved), c: 'ok' },
         { k: 'LOST', v: pad(C.lost), c: C.lost ? 'hot' : '' },
         { k: 'EVAC', v: pad(C.evacuated) }]
      ];
    },

    mission: function (S) {
      var pending = C.casualties.filter(function (c) { return c.alive && !c.evacuated; }).length;
      return { mode: 'MODE ' + C.mode, wave: Math.max(1, C.wave), kill: C.saved, threat: pending };
    },

    buttons: {
      'btn-auto': function (E) {
        C.auto = !C.auto;
        window.DJIEngine.api.setButton('btn-auto', '自动救护', C.auto, '');
      },
      'btn-drop': function (E) { C.auto = false; dropSupplies(); },
      'btn-hoist': function (E) { C.auto = false; hoistCasualty(); },
      'btn-wave': function (E) { spawnWave(); }
    },

    keys: {
      'd': function (E) { behavior.buttons['btn-drop'](E); },
      'h': function (E) { behavior.buttons['btn-hoist'](E); },
      'g': function (E) { behavior.buttons['btn-auto'](E); },
      'n': function (E) { spawnWave(); }
    },

    pickables: function () {
      var out = [];
      C.casualties.forEach(function (c) { if (c.alive && !c.evacuated) out = out.concat(c.meshes); });
      return out;
    },

    pick: function (hit, E) {
      if (hit && hit.kind === 'enemy') {
        C.manual = hit.ref;
        if (!hit.ref.detected) { hit.ref.detected = true; hit.ref.lock = 1; }
        C.status = '已手动指定 ' + hit.ref.code + '（' + hit.ref.levelName + '）';
        return true;
      }
      return true;
    },

    hover: function (hit) { C.hover = hit && hit.kind === 'enemy' ? hit.ref : null; },

    enemyTip: function (c) {
      if (!c) return '';
      return c.code + ' · ' + c.levelName + ' · HR ' + Math.round(c.vit.hr) +
        ' · SpO₂ ' + Math.round(c.vit.spo2) + '%' + (c.treated ? ' · 已稳定' : '') +
        (c.evacuated ? ' · 已后送' : '');
    }
  };

  window.DJIMedical = behavior;
  window.DJIPage = window.DJIPage || {};
  window.DJIPage.behavior = behavior;
})();