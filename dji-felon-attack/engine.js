/* =========================================================================
   DJI 3D 可视化共享引擎（engine.js）
   -------------------------------------------------------------------------
   把「加载器 / 场景 / 轨道控制 / 拾取 / 爆炸 / 标注 / 战术 HUD / 面板」
   全部抽成与机型无关的核心。机型只提供：
     model    : { title, subtitle, spec, builder, parts, scene }
     behavior : { init, update, hudRows, mission, buttons, pick }   ← 可选
   用法（页面按顺序引入 enemies/model/behavior/engine）：
     DJIEngine.boot({ model: DJIModelAttack, behavior: DJICombat });
   注意：本文件在 Three.js 动态加载完成前就会被解析执行，
        模块顶层绝对不能触碰 THREE。
   ========================================================================= */
(function () {
  'use strict';

  /* =======================================================================
     0. Three.js 加载（CDN 优先 → 本地回退 → 超时兜底）
     ======================================================================= */
  // CDN 备选（本地 vendor 不可用时才用）。unpkg 放在前面：本机实测 jsdelivr 会超时。
  var CDNS = [
    'https://unpkg.com/three@0.149.0/build/three.min.js',
    'https://cdn.jsdelivr.net/npm/three@0.149.0/build/three.min.js'
  ];
  var LOCAL = './vendor/three.min.js';

  function bootText(msg) {
    var el = document.getElementById('boot-text');
    if (el) el.textContent = msg;
  }

  function loadScript(url, timeout) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      var settled = false, timer = null;
      function done(ok, err) {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        s.onload = s.onerror = null;
        if (!ok && s.parentNode) s.parentNode.removeChild(s);
        ok ? resolve() : reject(err || new Error('load failed'));
      }
      s.src = url; s.async = true;
      s.onload = function () { done(true); };
      s.onerror = function () { done(false, new Error('network error')); };
      if (timeout > 0) timer = setTimeout(function () { done(false, new Error('timeout')); }, timeout);
      document.head.appendChild(s);
    });
  }

  function bootFail(detail) {
    window.__djiFailed = true;
    var boot = document.getElementById('boot');
    if (!boot) return;
    boot.classList.remove('hide');
    boot.innerHTML =
      '<div style="font-size:34px">⚠︎</div>' +
      '<p class="err"><b>初始化失败</b><br><br>' + (detail || '未知原因') + '<br><br>' +
      '请确认 engine.js / model-*.js / combat.js 与 vendor/three.min.js 都和页面在同一目录；<br>' +
      '也可以按 F12 看控制台的红色报错。</p>';
  }

  /* =======================================================================
     1. 通用工具
     ======================================================================= */
  var clamp = function (v, a, b) { return v < a ? a : (v > b ? b : v); };
  var lerp = function (a, b, t) { return a + (b - a) * t; };
  var easeInOutCubic = function (t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
  var rand = function (a, b) { return a + Math.random() * (b - a); };

  /* =======================================================================
     2. 程序化贴图
     ======================================================================= */
  var TEX = {};

  function makeTex(w, h, draw, opt) {
    opt = opt || {};
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var g = c.getContext('2d');
    draw(g, w, h);
    var t = new THREE.CanvasTexture(c);
    t.encoding = opt.linear ? THREE.LinearEncoding : THREE.sRGBEncoding;
    t.anisotropy = 8;
    if (opt.repeat) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(opt.repeat[0], opt.repeat[1]);
    }
    return t;
  }

  function buildTextures() {
    TEX.noise = makeTex(256, 256, function (g, w, h) {
      g.fillStyle = '#8a8a8a'; g.fillRect(0, 0, w, h);
      for (var i = 0; i < 26000; i++) {
        var v = 118 + Math.random() * 90;
        g.fillStyle = 'rgba(' + (v | 0) + ',' + (v | 0) + ',' + (v | 0) + ',' + (0.05 + Math.random() * 0.25) + ')';
        g.fillRect(Math.random() * w, Math.random() * h, 1.4, 1.4);
      }
    }, { linear: true, repeat: [3, 3] });

    TEX.pcb = makeTex(512, 512, function (g, w, h) {
      var grd = g.createLinearGradient(0, 0, w, h);
      grd.addColorStop(0, '#0c3227'); grd.addColorStop(0.5, '#0a2b21'); grd.addColorStop(1, '#0d3a2c');
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
        g.beginPath(); g.arc(Math.random() * w, Math.random() * h, 1.2 + Math.random() * 2.6, 0, 6.283); g.fill();
      }
    });

    TEX.grille = makeTex(128, 128, function (g, w, h) {
      g.fillStyle = '#0b0e13'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#2b323c';
      for (var y = 8; y < h; y += 12) {
        for (var x = 8 + (y / 12 % 2) * 6; x < w; x += 12) {
          g.beginPath(); g.arc(x, y, 3.4, 0, 6.283); g.fill();
        }
      }
    });

    TEX.glow = makeTex(256, 256, function (g, w, h) {
      var grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      grd.addColorStop(0, 'rgba(255,255,255,1)');
      grd.addColorStop(0.18, 'rgba(255,255,255,.55)');
      grd.addColorStop(0.45, 'rgba(255,255,255,.14)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd; g.fillRect(0, 0, w, h);
    });

    /* 螺旋桨动态光晕盘（旋转条纹 + 边缘渐亮，配合 AdditiveBlending）*/
    TEX.rotor = makeTex(256, 256, function (g, w, h) {
      var c = w / 2;
      var grd = g.createRadialGradient(c, c, c * 0.12, c, c, c);
      grd.addColorStop(0, 'rgba(255,255,255,0)');
      grd.addColorStop(0.4, 'rgba(255,255,255,.07)');
      grd.addColorStop(0.78, 'rgba(255,255,255,.2)');
      grd.addColorStop(0.94, 'rgba(255,255,255,.34)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd; g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(255,255,255,.09)';
      g.lineWidth = 2;
      for (var i = 0; i < 54; i++) {
        var a0 = (i / 54) * Math.PI * 2;
        var a1 = a0 + 0.24;
        g.beginPath();
        g.arc(c, c, c * (0.42 + (i % 5) * 0.11), a0, a1);
        g.stroke();
      }
    });

    /* 碳纤维斜纹编织（机身/机臂用）*/
    TEX.carbon = makeTex(256, 256, function (g, w, h) {
      g.fillStyle = '#15181c'; g.fillRect(0, 0, w, h);
      var s = 32;
      for (var y = 0; y < h; y += s) {
        for (var x = 0; x < w; x += s) {
          var even = ((x / s) + (y / s)) % 2 === 0;
          var grd = g.createLinearGradient(x, y, x + s, y + s);
          if (even) {
            grd.addColorStop(0, '#22262b'); grd.addColorStop(0.5, '#31363c'); grd.addColorStop(1, '#191d21');
          } else {
            grd.addColorStop(0, '#191d21'); grd.addColorStop(0.5, '#2a2f35'); grd.addColorStop(1, '#22262b');
          }
          g.fillStyle = grd;
          g.fillRect(x, y, s, s);
        }
      }
      // 高光纤维丝
      g.strokeStyle = 'rgba(190,205,215,.05)'; g.lineWidth = 1;
      for (var i = 0; i < w; i += 4) {
        g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 18, h); g.stroke();
      }
    }, { repeat: [2, 2] });

    /* 微表面颗粒法线（哑光涂料用，linear 不参与 sRGB 解码）*/
    TEX.grainN = makeTex(128, 128, function (g, w, h) {
      var S = 2, N = w / S;
      function hsh(x, y) {
        var n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
        return n - Math.floor(n);
      }
      for (var yy = 0; yy < N; yy++) {
        for (var xx = 0; xx < N; xx++) {
          var h0 = hsh(xx, yy), hl = hsh((xx + 1) % N, yy), hu = hsh(xx, (yy + 1) % N);
          var dx = (hl - h0) * 2.2, dy = (hu - h0) * 2.2;
          var nx = -dx, ny = -dy, nz = 1.0;
          var len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
          var r = Math.round((nx / len * 0.5 + 0.5) * 255);
          var gg = Math.round((ny / len * 0.5 + 0.5) * 255);
          var b = Math.round((nz / len * 0.5 + 0.5) * 255);
          g.fillStyle = 'rgb(' + r + ',' + gg + ',' + b + ')';
          g.fillRect(xx * S, yy * S, S, S);
        }
      }
    }, { linear: true, repeat: [7, 7] });

    /* 粗糙度噪声（打破均匀高光，塑料感的直接来源之一）*/
    TEX.grainR = makeTex(128, 128, function (g, w, h) {
      for (var y = 0; y < h; y += 2) {
        for (var x = 0; x < w; x += 2) {
          var v = 0.82 + ((Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1 + 1) % 1 * 0.30;
          var c = Math.round(Math.min(1, v) * 255);
          g.fillStyle = 'rgb(' + c + ',' + c + ',' + c + ')';
          g.fillRect(x, y, 2, 2);
        }
      }
    }, { linear: true, repeat: [5, 5] });

    /* 金属拉丝法线（方向性强，金属件用）*/
    TEX.brushN = makeTex(128, 128, function (g, w, h) {
      for (var y = 0; y < h; y += 2) {
        var n = Math.sin(y * 91.7) * 43758.5453;
        var f = (n - Math.floor(n)) * 2 - 1;
        var ny = Math.round((f * 0.16 * 0.5 + 0.5) * 255);
        g.fillStyle = 'rgb(128,' + ny + ',250)';
        g.fillRect(0, y, w, 2);
      }
    }, { linear: true, repeat: [3, 3] });

    TEX.smoke = makeTex(128, 128, function (g, w, h) {
      var grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      grd.addColorStop(0, 'rgba(255,255,255,.85)');
      grd.addColorStop(0.5, 'rgba(220,220,220,.28)');
      grd.addColorStop(1, 'rgba(200,200,200,0)');
      g.fillStyle = grd; g.fillRect(0, 0, w, h);
    });

    TEX.env = makeTex(1024, 512, function (g, w, h) {
      // 天顶 → 地平线 → 地面：更陡的明暗对比，金属才有反射可看
      var grd = g.createLinearGradient(0, 0, 0, h);
      grd.addColorStop(0.00, '#05070b');
      grd.addColorStop(0.30, '#10202e');
      grd.addColorStop(0.46, '#28506b');
      grd.addColorStop(0.50, '#0d1720');
      grd.addColorStop(0.66, '#0a1116');
      grd.addColorStop(1.00, '#020406');
      g.fillStyle = grd; g.fillRect(0, 0, w, h);
      // 主柔光带（贯穿全宽的亮条 → 金属上出现长条高光）
      var sb = g.createLinearGradient(0, h * 0.30, 0, h * 0.44);
      sb.addColorStop(0, 'rgba(190,230,255,0)');
      sb.addColorStop(0.45, 'rgba(210,240,255,.55)');
      sb.addColorStop(0.62, 'rgba(160,205,240,.30)');
      sb.addColorStop(1, 'rgba(120,170,210,0)');
      g.fillStyle = sb; g.fillRect(0, h * 0.30, w, h * 0.14);
      // 三处高光块：冷主光 / 暖侧光 / 地面反光
      var blobs = [
        [0.22, 0.33, 'rgba(150,220,255,.85)', 210],
        [0.74, 0.30, 'rgba(255,176,110,.62)', 165],
        [0.50, 0.78, 'rgba(70,110,150,.34)', 300],
        [0.05, 0.40, 'rgba(120,200,245,.42)', 150]
      ];
      blobs.forEach(function (b) {
        var rg = g.createRadialGradient(b[0] * w, b[1] * h, 0, b[0] * w, b[1] * h, b[3]);
        rg.addColorStop(0, b[2]); rg.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = rg; g.fillRect(0, 0, w, h);
      });
      // 地平线锐利亮线：给抛光件一条清晰的环境反射
      g.fillStyle = 'rgba(200,235,255,.22)';
      g.fillRect(0, h * 0.495, w, 2);
    });
    TEX.env.mapping = THREE.EquirectangularReflectionMapping;
  }

  /* =======================================================================
     3. 几何工具
     ======================================================================= */
  function roundedRectPath(target, cx, cy, w, h, r) {
    var x = cx - w / 2, y = cy - h / 2;
    target.moveTo(x + r, y);
    target.lineTo(x + w - r, y);
    target.quadraticCurveTo(x + w, y, x + w, y + r);
    target.lineTo(x + w, y + h - r);
    target.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    target.lineTo(x + r, y + h);
    target.quadraticCurveTo(x, y + h, x, y + h - r);
    target.lineTo(x, y + r);
    target.quadraticCurveTo(x, y, x + r, y);
    return target;
  }

  function roundedBox(w, h, d, r, seg) {
    var bevel = Math.min(r * 0.5, 0.14);
    var depth = Math.max(0.01, d - bevel * 2);
    var shape = new THREE.Shape();
    roundedRectPath(shape, 0, 0, Math.max(0.02, w - bevel * 2), Math.max(0.02, h - bevel * 2),
      Math.max(0.005, r - bevel));
    var geo = new THREE.ExtrudeGeometry(shape, {
      depth: depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel,
      bevelSegments: 4, curveSegments: Math.max(8, (seg || 5) * 3), steps: 1
    });
    geo.translate(0, 0, -depth / 2);
    geo.computeVertexNormals();
    return geo;
  }

  function ringParts(g, rIn, rOut, len, cx, cy, cz, mat, matIn) {
    addMesh(g, cylZ(rOut, rOut, len, 48, true), mat, cx, cy, cz);
    addMesh(g, cylZ(rIn, rIn, len, 48, true), matIn || mat, cx, cy, cz);
    var face = new THREE.RingGeometry(rIn, rOut, 48);
    addMesh(g, face, mat, cx, cy, cz + len / 2);
    var back = face.clone();
    back.rotateY(Math.PI);
    addMesh(g, back, mat, cx, cy, cz - len / 2);
  }

  function cyl(rt, rb, h, seg, open) {
    return new THREE.CylinderGeometry(rt, rb, h, seg || 32, 1, !!open);
  }
  function cylZ(rt, rb, h, seg, open) {
    var g = cyl(rt, rb, h, seg, open);
    g.rotateX(Math.PI / 2);
    return g;
  }
  function box(w, h, d) { return new THREE.BoxGeometry(w, h, d); }

  /* 材质咽喉点：所有材质（含模型文件直接写的）都在这里统一规范化。
     三条规则专治"塑料感"：
     1) 非金属件的 metalness 一律压到近 0 —— 中间值 metalness 是塑料油光的根源；
     2) 补微表面法线 + 粗糙度噪声，打破"均匀高光"；
     3) 顶点色 AO（几何体在 addMesh 里烘焙过），没有 color 属性的几何体不会被用到
        （模型侧 0 处直接 new Mesh，全部经 addMesh）。*/
  function std(o) {
    var m = Object.assign({ roughness: 0.55, metalness: 0.25 }, o || {});
    if (!m.map && m.metalness > 0.12 && m.metalness < 0.85) m.metalness = 0.04;
    var isMetal = m.metalness > 0.85;
    if (m.normalMap === undefined && m.roughness >= 0.2) {
      m.normalMap = isMetal ? TEX.brushN : TEX.grainN;
      m.normalScale = new THREE.Vector2(isMetal ? 0.10 : 0.16, isMetal ? 0.22 : 0.16);
    }
    if (m.roughnessMap === undefined && m.roughness >= 0.2) m.roughnessMap = TEX.grainR;
    if (m.envMapIntensity === undefined) m.envMapIntensity = isMetal ? 1.30 : 0.80;
    if (m.vertexColors === undefined) m.vertexColors = true;
    return new THREE.MeshStandardMaterial(m);
  }
  /* 材质预设：工业级哑光黑 / 金属 / 碳纤维 / 玻璃 / 自发光
     —— 全部带微表面法线 + 粗糙度噪声；非金属 metalness 压到近 0，
        否则会出现"塑料油光"（这是此前来塑料感的头号原因）*/
  function matte(color, roughness) {
    return std({
      color: color,
      roughness: roughness !== undefined ? roughness : 0.86,
      metalness: 0.04,
      normalMap: TEX.grainN,
      normalScale: new THREE.Vector2(0.18, 0.18),
      roughnessMap: TEX.grainR,
      envMapIntensity: 0.75,
      vertexColors: true
    });
  }
  function metal(color, roughness) {
    return std({
      color: color,
      roughness: roughness !== undefined ? roughness : 0.32,
      metalness: 1.0,
      normalMap: TEX.brushN,
      normalScale: new THREE.Vector2(0.10, 0.22),
      roughnessMap: TEX.grainR,
      envMapIntensity: 1.35,
      vertexColors: true
    });
  }
  function carbon(color) {
    return std({ color: color || 0x2a2f35, roughness: 0.40, metalness: 0.30,
      map: TEX.carbon, normalMap: TEX.grainN, normalScale: new THREE.Vector2(0.22, 0.22),
      roughnessMap: TEX.grainR, envMapIntensity: 1.25, vertexColors: true });
  }
  /* 涂装件：比哑光更滑一点，用于机身大面（保留给模型按需调用）*/
  function painted(color, roughness) {
    return std({
      color: color,
      roughness: roughness !== undefined ? roughness : 0.42,
      metalness: 0.10,
      normalMap: TEX.grainN,
      normalScale: new THREE.Vector2(0.12, 0.12),
      roughnessMap: TEX.grainR,
      envMapIntensity: 1.05,
      vertexColors: true
    });
  }
  function glass(color, emissive) {
    return std({ color: color || 0x0a1116, roughness: 0.06, metalness: 1,
      emissive: emissive !== undefined ? emissive : 0x143044, emissiveIntensity: 0.55 });
  }
  function emissiveMat(color, intensity) {
    return std({ color: 0x14181c, roughness: 0.35, metalness: 0.3,
      emissive: color, emissiveIntensity: intensity !== undefined ? intensity : 1.4 });
  }
  /* 顶点色 AO 近似：按几何体自身包围盒做上下渐变 + 哈希噪声。
     不做昂贵的射线遮蔽，但足以消除"整体一样亮"的塑料感。
     只有启用 vertexColors 的材质会读取它，其它材质完全不受影响。*/
  function bakeVertexShade(geo) {
    try {
      if (!geo || !geo.attributes || !geo.attributes.position) return;
      if (geo.userData && geo.userData.__vshade) return;
      geo.userData.__vshade = true;
      var pos = geo.attributes.position;
      if (!geo.boundingBox) geo.computeBoundingBox();
      var bb = geo.boundingBox;
      var y0 = bb.min.y, span = Math.max(1e-4, bb.max.y - bb.min.y);
      var n = pos.count;
      var arr = new Float32Array(n * 3);
      for (var i = 0; i < n; i++) {
        var t = (pos.getY(i) - y0) / span;
        var base = 0.80 + 0.26 * t;                       // 下暗上亮
        var h = Math.sin(i * 12.9898) * 43758.5453;
        h = h - Math.floor(h);
        var v = base * (0.97 + h * 0.06);                 // ±3% 微变化
        v = Math.max(0.6, Math.min(1.12, v));
        arr[i * 3] = arr[i * 3 + 1] = arr[i * 3 + 2] = v;
      }
      geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
      if (geo.attributes.color) geo.attributes.color.needsUpdate = true;
    } catch (e) { /* 顶点色只是锦上添花，失败就算了 */ }
  }

  function addMesh(parent, geo, mat, x, y, z, rx, ry, rz) {
    if (geo && geo.isObject3D) {
      throw new Error('addMesh 用法错误：第 2 个参数必须是几何体（geometry），' +
        '这里收到的是 Mesh/Object3D —— 请检查是否多写了一层 new THREE.Mesh(...)');
    }
    bakeVertexShade(geo);
    var m = new THREE.Mesh(geo, mat);
    m.position.set(x || 0, y || 0, z || 0);
    if (rx || ry || rz) m.rotation.set(rx || 0, ry || 0, rz || 0);
    parent.add(m);
    return m;
  }
  function placeAlong(mesh, a, b) {
    var d = new THREE.Vector3().subVectors(b, a);
    var len = d.length();
    mesh.position.copy(a).addScaledVector(d, 0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), d.clone().normalize());
    return len;
  }
  function bladeGeo(len, cRoot, cMid, cTip, thick, sweep) {
    var s = new THREE.Shape();
    var r0 = 0.5;
    s.moveTo(r0, -cRoot);
    s.quadraticCurveTo(len * 0.3, -cMid * 1.05, len * 0.62, -cMid * 0.9);
    s.quadraticCurveTo(len * 0.9, -cMid * 0.72, len * 0.995, -cTip * 0.35);
    s.quadraticCurveTo(len * 1.02, 0, len * 0.995, cTip * 0.35);
    s.quadraticCurveTo(len * 0.9, cMid * 0.72, len * 0.62, cMid * 0.9);
    s.quadraticCurveTo(len * 0.3, cMid * 1.05, r0, cRoot);
    s.quadraticCurveTo(r0 * 0.35, 0, r0, -cRoot);
    var g = new THREE.ExtrudeGeometry(s, {
      depth: thick, bevelEnabled: true, bevelThickness: thick * 0.3,
      bevelSize: thick * 0.45, bevelSegments: 2, curveSegments: 18, steps: 1
    });
    g.translate(0, 0, -thick / 2);
    g.rotateX(Math.PI / 2);
    var pos = g.attributes.position;
    for (var i = 0; i < pos.count; i++) {
      var x = pos.getX(i), z = pos.getZ(i);
      pos.setZ(i, z + (sweep || 0) * x * x);
    }
    g.computeVertexNormals();
    return g;
  }

  /* --- 超椭圆放样（机体曲面） --- */
  function sectionArc(s, part, seam, seg) {
    var hw = s.w / 2, hh = s.h / 2, yc = s.y || 0, n = s.n || 3, e = 2 / n;
    var pts = [], a0, a1;
    if (part === 'full') { a0 = 0; a1 = Math.PI * 2; }
    else {
      var k = clamp((seam - yc) / hh, -0.995, 0.995);
      var t0 = Math.asin(Math.pow(Math.abs(k), 1 / e));
      if (part === 'upper') { a0 = t0; a1 = Math.PI - t0; }
      else { a0 = Math.PI - t0; a1 = Math.PI * 2 + t0; }
    }
    for (var i = 0; i <= seg; i++) {
      var t = a0 + (a1 - a0) * (i / seg);
      var ct = Math.cos(t), st = Math.sin(t);
      pts.push({
        x: hw * (ct < 0 ? -1 : 1) * Math.pow(Math.abs(ct), e),
        y: yc + hh * (st < 0 ? -1 : 1) * Math.pow(Math.abs(st), e)
      });
    }
    return pts;
  }

  function loftGeo(sections, opts) {
    opts = opts || {};
    var part = opts.part || 'full';
    var seg = opts.seg || 20;
    var seam = opts.seam !== undefined ? opts.seam : -0.8;
    var cap = opts.cap !== false;
    var rings = sections.map(function (s) { return { z: s.z, pts: sectionArc(s, part, seam, seg) }; });
    var K = rings[0].pts.length;
    var pos = [], idx = [], i, j;

    for (i = 0; i < rings.length; i++) {
      for (j = 0; j < K; j++) pos.push(rings[i].pts[j].x, rings[i].pts[j].y, rings[i].z);
    }
    for (i = 0; i < rings.length - 1; i++) {
      for (j = 0; j < K - 1; j++) {
        var a = i * K + j, b = a + 1, c = (i + 1) * K + j + 1, d = (i + 1) * K + j;
        idx.push(a, b, c, a, c, d);
      }
    }
    var gridCount = idx.length;
    var flip = (part === 'lower');
    function pushTri(p0, p1, p2, z) {
      var base = pos.length / 3;
      [p0, p1, p2].forEach(function (p) { pos.push(p.x, p.y, z); });
      if (flip) idx.push(base, base + 2, base + 1); else idx.push(base, base + 1, base + 2);
    }
    function pushQuad(p0, p1, p2, p3, z0, z1) {
      var base = pos.length / 3;
      pos.push(p0.x, p0.y, z0, p1.x, p1.y, z0, p2.x, p2.y, z1, p3.x, p3.y, z1);
      if (flip) idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
      else idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    if (part !== 'full') {
      for (i = 0; i < rings.length - 1; i++) {
        var r0 = rings[i].pts, r1 = rings[i + 1].pts;
        pushQuad(r0[0], r0[K - 1], r1[K - 1], r1[0], rings[i].z, rings[i + 1].z);
      }
      if (cap) {
        [0, rings.length - 1].forEach(function (ri) {
          var pts = rings[ri].pts, z = rings[ri].z;
          var isFront = ri === rings.length - 1;
          for (var m = 0; m < pts.length - 2; m++) {
            if (isFront) pushTri(pts[0], pts[m + 1], pts[m + 2], z);
            else pushTri(pts[0], pts[m + 2], pts[m + 1], z);
          }
        });
      }
    } else if (cap) {
      [0, rings.length - 1].forEach(function (ri) {
        var pts = rings[ri].pts, z = rings[ri].z, cx = 0, cy = 0;
        for (var m = 0; m < pts.length - 1; m++) { cx += pts[m].x; cy += pts[m].y; }
        cx /= (pts.length - 1); cy /= (pts.length - 1);
        var isFront = ri === rings.length - 1;
        for (var m2 = 0; m2 < pts.length - 1; m2++) {
          if (isFront) pushTri({ x: cx, y: cy }, pts[m2 + 1], pts[m2], z);
          else pushTri({ x: cx, y: cy }, pts[m2], pts[m2 + 1], z);
        }
      });
    }

    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.addGroup(0, gridCount, 0);
    geo.addGroup(gridCount, idx.length - gridCount, 1);
    geo.computeVertexNormals();
    return geo;
  }

  /* =======================================================================
     4. 部件装配
     ======================================================================= */
  function createPart(def, index, builder, H) {
    var group = builder[def.id](H);
    group.name = def.id;
    group.userData.partId = def.id;

    /* 绕部件内部某点自旋：把已有网格收进一个内层枢轴组，
       网格仍是绝对坐标建模的机型（如 FELON/MEDEVAC）无需改建模即可让桨叶自旋 */
    if (def.spinAt) {
      var inner = new THREE.Group();
      inner.position.set(def.spinAt[0], def.spinAt[1], def.spinAt[2]);
      var kids = group.children.slice();
      for (var ci = 0; ci < kids.length; ci++) {
        var ch = kids[ci];
        inner.add(ch);
        ch.position.x -= def.spinAt[0];
        ch.position.y -= def.spinAt[1];
        ch.position.z -= def.spinAt[2];
      }
      group.add(inner);
      group.userData.spinInner = inner;
    }

    var accent = new THREE.Color(def.color);
    var meshes = [];
    group.traverse(function (o) { if (o.isMesh) meshes.push(o); });

    var bbox = new THREE.Box3().setFromObject(group);
    var center = bbox.getCenter(new THREE.Vector3());
    var size = bbox.getSize(new THREE.Vector3());
    var maxDim = Math.max(size.x, size.y, size.z);

    meshes.forEach(function (m) {
      m.castShadow = true; m.receiveShadow = true;
      var mats = Array.isArray(m.material) ? m.material : [m.material];
      mats.forEach(function (mat) {
        if (mat.userData.__base === undefined) {
          mat.userData.__base = {
            emissive: mat.emissive ? mat.emissive.clone() : new THREE.Color(0x000000),
            intensity: mat.emissiveIntensity !== undefined ? mat.emissiveIntensity : 1
          };
        }
      });
      var halo = new THREE.Mesh(m.geometry, new THREE.MeshBasicMaterial({
        color: accent, transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
        side: THREE.BackSide, depthWrite: false
      }));
      halo.position.copy(m.position); halo.quaternion.copy(m.quaternion);
      halo.scale.copy(m.scale).multiplyScalar(1.055);
      halo.userData.noPick = true; halo.raycast = function () {};
      halo.renderOrder = 3; halo.visible = false;
      m.parent.add(halo);

      var edges = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry, 32),
        new THREE.LineBasicMaterial({ color: accent, transparent: true, opacity: 0, depthWrite: false }));
      edges.position.copy(m.position); edges.quaternion.copy(m.quaternion);
      edges.scale.copy(m.scale).multiplyScalar(1.012);
      edges.userData.noPick = true; edges.raycast = function () {};
      edges.renderOrder = 4; edges.visible = false;
      m.parent.add(edges);

      m.userData.partId = def.id;
      m.userData.pick = 'part';
      m.userData.halo = halo;
      m.userData.edges = edges;
    });

    var sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: TEX.glow, color: accent, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
    sprite.position.copy(center);
    sprite.scale.setScalar(maxDim * 1.5);
    sprite.userData.noPick = true; sprite.raycast = function () {};
    sprite.renderOrder = 2;
    group.add(sprite);

    /* 螺旋桨动态光晕盘：def.rotor = 桨盘半径(cm)，可选 def.rotorY 抬高 */
    var disc = null;
    if (def.rotor) {
      disc = new THREE.Mesh(new THREE.CircleGeometry(def.rotor, 44),
        new THREE.MeshBasicMaterial({
          map: TEX.rotor, color: def.rotorColor !== undefined ? def.rotorColor : 0xbcd8e8,
          transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
          depthWrite: false, side: THREE.DoubleSide
        }));
      disc.rotation.x = -Math.PI / 2;
      disc.position.y = def.rotorY || 0;
      disc.userData.noPick = true; disc.raycast = function () {};
      disc.renderOrder = 5;
      // 有内层枢轴组时挂进内层（局部原点即自旋中心）
      (group.userData.spinInner || group).add(disc);
    }

    var pivot = def.pivot;
    var basePos = new THREE.Vector3(pivot ? pivot[0] : 0, pivot ? pivot[1] : 0, pivot ? pivot[2] : 0);
    group.position.copy(basePos);

    return {
      def: def, index: index, group: group, accent: accent,
      localCenter: center, localBox: bbox, maxDim: maxDim, sprite: sprite,
      disc: disc,
      basePos: basePos,
      dir: new THREE.Vector3(def.dir[0], def.dir[1], def.dir[2]).normalize(),
      dist: def.dist, progress: 0, highlight: 0, meshes: meshes
    };
  }

  /* =======================================================================
     5. 轨道控制器
     ======================================================================= */
  function Orbit(cam, dom, cfg) {
    var self = this;
    this.cam = cam; this.dom = dom;
    // 任何非有限参数都回落到默认机位，避免相机变 NaN 导致整屏空白
    var safe = function (v, d) { return (typeof v === 'number' && isFinite(v)) ? v : d; };
    var theta0 = safe(cfg.theta, 0.62), phi0 = safe(cfg.phi, 1.06), r0 = safe(cfg.radius, 26);
    this.target = new THREE.Vector3(0, safe(cfg.targetY, 0), 0);
    this.theta = theta0; this.phi = phi0;
    this.homeTheta = theta0; this.homePhi = phi0; this.homeRadius = r0;
    this.radius = r0; this.userRadius = r0;
    this.goalTheta = theta0; this.goalPhi = phi0;
    this.goalTarget = this.target.clone();
    this.autoRotate = false;
    this.minRadius = safe(cfg.minRadius, r0 * 0.45);
    this.maxRadius = safe(cfg.maxRadius, r0 * 2.4);
    this.phiMin = 0.2; this.phiMax = 1.74;
    this._dragging = null; this._last = { x: 0, y: 0 }; this._moved = 0;
    this._pointers = new Map(); this._pinchDist = 0;

    dom.addEventListener('pointerdown', function (e) { self.onDown(e); });
    window.addEventListener('pointermove', function (e) { self.onMove(e); });
    window.addEventListener('pointerup', function (e) { self.onUp(e); });
    window.addEventListener('pointercancel', function (e) { self.onUp(e); });
    dom.addEventListener('wheel', function (e) { self.onWheel(e); }, { passive: false });
    dom.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  }

  Orbit.prototype._pt = function (i) {
    var arr = Array.from(this._pointers.values());
    return arr[i] || { x: 0, y: 0 };
  };
  Orbit.prototype.pinchDistance = function () {
    var a = this._pt(0), b = this._pt(1);
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  Orbit.prototype.onDown = function (e) {
    if (typeof this.onUserDrag === 'function') this.onUserDrag();
    this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this._pointers.size === 1) {
      this._dragging = (e.button === 2 || e.button === 1 || e.shiftKey) ? 'pan' : 'rotate';
      this._last.x = e.clientX; this._last.y = e.clientY; this._moved = 0;
      try { this.dom.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    } else if (this._pointers.size === 2) {
      this._dragging = 'pinch';
      this._pinchDist = this.pinchDistance();
      this._last.x = (this._pt(0).x + this._pt(1).x) / 2;
      this._last.y = (this._pt(0).y + this._pt(1).y) / 2;
    }
    document.body.style.cursor = 'grabbing';
  };
  Orbit.prototype.onMove = function (e) {
    if (!this._pointers.has(e.pointerId)) {
      if (typeof this.onHover === 'function') this.onHover(e);
      return;
    }
    this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this._dragging === 'pinch' && this._pointers.size >= 2) {
      var d = this.pinchDistance();
      if (this._pinchDist > 0 && d > 0) {
        this.userRadius = clamp(this.userRadius * (this._pinchDist / d), this.minRadius, this.maxRadius);
      }
      this._pinchDist = d;
      var mx = (this._pt(0).x + this._pt(1).x) / 2, my = (this._pt(0).y + this._pt(1).y) / 2;
      this.panBy((mx - this._last.x) * 1.4, (my - this._last.y) * 1.4);
      this._last.x = mx; this._last.y = my; this._moved = 99;
      return;
    }
    var dx = e.clientX - this._last.x, dy = e.clientY - this._last.y;
    this._last.x = e.clientX; this._last.y = e.clientY;
    this._moved += Math.abs(dx) + Math.abs(dy);
    if (this._dragging === 'rotate') {
      this.goalTheta -= dx * 0.0062;
      this.goalPhi = clamp(this.goalPhi - dy * 0.0062, this.phiMin, this.phiMax);
      this.autoRotate = false;
      if (typeof this.onAutoRotate === 'function') this.onAutoRotate(false);
    } else if (this._dragging === 'pan') {
      this.panBy(dx, dy);
    }
  };
  Orbit.prototype.panBy = function (dx, dy) {
    var k = this.radius * 0.0022;
    var right = new THREE.Vector3().setFromMatrixColumn(this.cam.matrix, 0);
    var up = new THREE.Vector3().setFromMatrixColumn(this.cam.matrix, 1);
    this.goalTarget.addScaledVector(right, -dx * k);
    this.goalTarget.addScaledVector(up, dy * k);
    var len = this.goalTarget.length();
    if (len > this.maxRadius) this.goalTarget.multiplyScalar(this.maxRadius / len);
  };
  Orbit.prototype.onUp = function (e) {
    this._pointers.delete(e.pointerId);
    if (this._pointers.size < 2 && this._dragging === 'pinch') {
      this._dragging = this._pointers.size === 1 ? 'rotate' : null;
      if (this._pointers.size === 1) { this._last.x = this._pt(0).x; this._last.y = this._pt(0).y; }
    }
    if (this._pointers.size === 0) {
      var wasDrag = this._moved > 6, mode = this._dragging;
      this._dragging = null;
      document.body.style.cursor = '';
      if (!wasDrag && mode === 'rotate' && typeof this.onClick === 'function') this.onClick(e);
    }
  };
  Orbit.prototype.onWheel = function (e) {
    e.preventDefault();
    var s = Math.exp(clamp(e.deltaY, -120, 120) * 0.0014);
    this.userRadius = clamp(this.userRadius * s, this.minRadius, this.maxRadius);
  };
  Orbit.prototype.reset = function () {
    this.goalTheta = this.homeTheta; this.goalPhi = this.homePhi;
    this.userRadius = this.homeRadius; this.goalTarget.set(0, this.target.y, 0);
  };
  Orbit.prototype.update = function (dt, zoomBias, phiBias) {
    // 兜底：任何一项变成非有限值就整机位复位（否则相机 NaN，画面全黑且无报错）
    if (!isFinite(this.radius) || !isFinite(this.theta) || !isFinite(this.phi) ||
        !isFinite(this.target.x) || !isFinite(this.target.y) || !isFinite(this.target.z)) {
      this.theta = this.homeTheta; this.phi = this.homePhi;
      this.userRadius = this.homeRadius; this.radius = this.homeRadius;
      this.target.set(0, 0, 0);
      this.goalTheta = this.theta; this.goalPhi = this.phi;
      this.goalTarget.copy(this.target);
    }
    var zb = (typeof zoomBias === 'number' && isFinite(zoomBias)) ? zoomBias : 0;
    var pb = (typeof phiBias === 'number' && isFinite(phiBias)) ? phiBias : 0;
    var step = (typeof dt === 'number' && isFinite(dt)) ? dt : 0.016;
    var k = 1 - Math.exp(-step * 6.5);
    this.theta = lerp(this.theta, this.goalTheta, k);
    this.phi = lerp(this.phi, this.goalPhi, k);
    this.target.lerp(this.goalTarget, k);
    this.radius = lerp(this.radius, this.userRadius + zb, k);
    if (this.autoRotate && !this._dragging) this.goalTheta += step * 0.22;
    var phi = clamp(this.phi - pb, this.phiMin, this.phiMax);
    var sp = Math.sin(phi), r = this.radius;
    this.cam.position.set(
      this.target.x + r * sp * Math.sin(this.theta),
      this.target.y + r * Math.cos(phi),
      this.target.z + r * sp * Math.cos(this.theta)
    );
    this.cam.lookAt(this.target);
  };

  /* =======================================================================
     6. 引擎主对象
     ======================================================================= */
  var E = {
    // three
    THREE: null, scene: null, camera: null, renderer: null, root: null,
    raycaster: null, pointerNDC: null, orbit: null, clock: null,
    parts: [], partById: {}, pickables: [],
    // 结构
    model: null, behavior: null, cfg: null,
    ROOT_SCALE: 0.5, FLOOR_Y: -4.6, FLOOR_BIG: false,
    // 状态
    S: {
      exploded: false, selected: null, hovered: null, labels: true,
      explodeT: 0, autoRotate: false, elapsed: 0, rotRate: 0, camAz: 0, camAlt: 0,
      markers: [], contacts: [],
      spinRate: 0, spinGoal: 1,   // 桨叶转速（0-1），带动光晕强度
      folded: false, foldT: 1,    // 机臂展开/折叠（1 = 展开到位）
      tour: false, tourI: 0, tourT: 0,   // 演示巡航
      blueprint: false,           // 蓝图线框技术模式
      intro: true,                // 启动动画是否还没进入
      fly: true,                  // 模拟飞行（展示悬停）
      scanning: false, scanProgress: 0,   // 雷达自检
      lang: 'cn'                  // 界面语言
    },
    // HUD
    hud: { brackets: [], box: null, tag: null, radar: null, rctx: null, els: {}, rows: [], t: 0,
           prevTheta: null, RADAR_S: 78, RADAR_RANGE: 40, markerSlots: [] },
    tmp: { v: null, v2: null }
  };

  var NS = 'http://www.w3.org/2000/svg';

  /* ---------- 场景 ---------- */
  function buildLights(cfg) {
    E.scene.add(new THREE.AmbientLight(0x46505c, 1.7));
    E.scene.add(new THREE.HemisphereLight(0x7fa8d8, 0x0a0e14, 1.5));
    var key = new THREE.DirectionalLight(0xfff4e2, 2.2);
    key.position.set(cfg.keyLight[0], cfg.keyLight[1], cfg.keyLight[2]);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 140;
    key.shadow.camera.left = -cfg.shadowR; key.shadow.camera.right = cfg.shadowR;
    key.shadow.camera.top = cfg.shadowR; key.shadow.camera.bottom = -cfg.shadowR;
    // 改完正交范围必须刷新投影矩阵，否则阴影相机仍然是默认的 ±5（阴影范围全错）
    key.shadow.camera.updateProjectionMatrix();
    key.shadow.bias = -0.0006;
    key.shadow.normalBias = 0.06;          // 消除自阴影黑斑
    key.shadow.radius = 2.5;
    E.scene.add(key);
    var rim1 = new THREE.PointLight(0x9ab26a, 2.0, cfg.shadowR * 4, 2);
    rim1.position.set(-cfg.shadowR, 6, -cfg.shadowR);
    E.scene.add(rim1);
    var rim2 = new THREE.PointLight(0xff6a3d, 1.5, cfg.shadowR * 4, 2);
    rim2.position.set(cfg.shadowR, -5, cfg.shadowR * 0.8);
    E.scene.add(rim2);
    var fill = new THREE.DirectionalLight(0xbfd8ff, 0.95);
    fill.position.set(-8, 5, 14);
    E.scene.add(fill);
  }

  function buildFloor(cfg) {
    var g = new THREE.Group();
    E.scene.add(g);
    var grid = new THREE.GridHelper(cfg.gridSize, cfg.gridDiv, 0x2f4a3a, 0x14241c);
    grid.material.transparent = true; grid.material.opacity = 0.34; grid.material.depthWrite = false;
    grid.position.y = E.FLOOR_Y;
    g.add(grid);

    var sp = new THREE.Mesh(new THREE.PlaneGeometry(cfg.gridSize, cfg.gridSize),
      new THREE.ShadowMaterial({ opacity: 0.44 }));
    sp.rotation.x = -Math.PI / 2;
    sp.position.y = E.FLOOR_Y + 0.01;
    sp.receiveShadow = true;
    g.add(sp);

    var pool = new THREE.Mesh(new THREE.PlaneGeometry(cfg.gridSize * 0.4, cfg.gridSize * 0.4),
      new THREE.MeshBasicMaterial({
        map: TEX.glow, color: 0x4f6a3a, transparent: true, opacity: 0.24,
        blending: THREE.AdditiveBlending, depthWrite: false
      }));
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(0, E.FLOOR_Y + 0.05, 0);
    g.add(pool);

    function ring(rin, rout, color, op) {
      var m = new THREE.Mesh(new THREE.RingGeometry(rin, rout, 128),
        new THREE.MeshBasicMaterial({
          color: color, transparent: true, opacity: op, side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending, depthWrite: false
        }));
      m.rotation.x = -Math.PI / 2;
      m.position.y = E.FLOOR_Y + 0.02;
      g.add(m);
      return m;
    }
    E.hud.ringA = ring(cfg.ringR, cfg.ringR + 0.08, 0x9ab26a, 0.36);
    E.hud.ringB = ring(cfg.ringR * 1.28, cfg.ringR * 1.29, 0x9ab26a, 0.18);
    ring(cfg.ringR * 0.62, cfg.ringR * 0.63, 0x9ab26a, 0.14);
    ring(cfg.ringR * 1.5, cfg.ringR * 1.51, 0xffb020, 0.12);

    // 方位刻度
    for (var i = 0; i < 60; i++) {
      var a = (i / 60) * Math.PI * 2;
      var len = i % 5 === 0 ? 0.7 : 0.3;
      var tick = new THREE.Mesh(new THREE.PlaneGeometry(0.06, len),
        new THREE.MeshBasicMaterial({
          color: 0x9ab26a, transparent: true, opacity: i % 5 === 0 ? 0.45 : 0.2,
          blending: THREE.AdditiveBlending, depthWrite: false
        }));
      tick.position.set(Math.sin(a) * (cfg.ringR * 1.1), E.FLOOR_Y + 0.02, Math.cos(a) * (cfg.ringR * 1.1));
      tick.rotation.x = -Math.PI / 2;
      tick.rotation.z = -a;
      g.add(tick);
    }

    // 雷达扫描扇面
    var sweep = new THREE.Group();
    var secGeo = new THREE.CircleGeometry(cfg.ringR * 1.22, 72, 0, 0.62);
    secGeo.rotateX(-Math.PI / 2);
    sweep.add(new THREE.Mesh(secGeo, new THREE.MeshBasicMaterial({
      color: 0x8ff0b0, transparent: true, opacity: 0.1, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false
    })));
    var edgeGeo = new THREE.PlaneGeometry(cfg.ringR * 1.22, 0.12);
    edgeGeo.rotateX(-Math.PI / 2);
    edgeGeo.translate(cfg.ringR * 0.61, 0, 0);
    edgeGeo.rotateY(0.62);
    sweep.add(new THREE.Mesh(edgeGeo, new THREE.MeshBasicMaterial({
      color: 0xb6ffd0, transparent: true, opacity: 0.45,
      blending: THREE.AdditiveBlending, depthWrite: false
    })));
    sweep.position.y = E.FLOOR_Y + 0.04;
    g.add(sweep);
    E.hud.sweep = sweep;

    // 上下扫描环
    E.hud.scanRing = new THREE.Mesh(new THREE.TorusGeometry(cfg.ringR * 1.45, 0.05, 8, 100),
      new THREE.MeshBasicMaterial({
        color: 0x9ab26a, transparent: true, opacity: 0.28,
        blending: THREE.AdditiveBlending, depthWrite: false
      }));
    E.hud.scanRing.rotation.x = Math.PI / 2;
    E.scene.add(E.hud.scanRing);

    // 星点
    var N = 1200, pos = new Float32Array(N * 3);
    for (var k = 0; k < N; k++) {
      var rr2 = 24 + Math.random() * 70;
      var th = Math.random() * Math.PI * 2, ph = Math.random() * Math.PI;
      pos[k * 3] = Math.sin(ph) * Math.cos(th) * rr2;
      pos[k * 3 + 1] = Math.cos(ph) * rr2 * 0.6 + 6;
      pos[k * 3 + 2] = Math.sin(ph) * Math.sin(th) * rr2;
    }
    var sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    E.hud.stars = new THREE.Points(sg, new THREE.PointsMaterial({
      color: 0xbfe0ff, size: 0.16, transparent: true, opacity: 0.5,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true
    }));
    E.scene.add(E.hud.stars);
  }

  /* ---------- 标注 ---------- */
  function buildLabels() {
    var layer = document.getElementById('labels');
    var svg = document.getElementById('lines');
    E.parts.forEach(function (p) {
      var d = document.createElement('div');
      d.className = 'label';
      var code = document.createElement('span');
      code.className = 'code';
      code.textContent = 'P-' + String(p.index + 1).padStart(2, '0');
      var b = document.createElement('b');
      b.textContent = E.S.lang === 'en' ? (p.def.en || p.def.name) : p.def.name;
      var i = document.createElement('i'); i.textContent = p.def.tag;
      d.appendChild(code); d.appendChild(b); d.appendChild(i);
      layer.appendChild(d);

      var ln = document.createElementNS(NS, 'line');
      ln.setAttribute('class', 'leader');
      svg.appendChild(ln);
      E.hud['label_' + p.def.id] = d;
      E.hud['line_' + p.def.id] = ln;
    });
  }

  function updateLabels() {
    var vw = window.innerWidth, vh = window.innerHeight;
    var showAll = E.S.labels && E.S.explodeT > 0.3;
    E.parts.forEach(function (p) {
      var el = E.hud['label_' + p.def.id], ln = E.hud['line_' + p.def.id];
      var isSel = E.S.selected === p.def.id;
      var visible = isSel || (showAll && (!E.S.selected || E.S.explodeT > 0.6));
      E.tmp.v.copy(p.localCenter);
      p.group.localToWorld(E.tmp.v);
      E.tmp.v.project(E.camera);
      var onScreen = E.tmp.v.z < 1 && Math.abs(E.tmp.v.x) < 1.4 && Math.abs(E.tmp.v.y) < 1.4;
      if (!visible || !onScreen) {
        el.classList.remove('show'); ln.style.opacity = 0;
        return;
      }
      var ax = (E.tmp.v.x * 0.5 + 0.5) * vw, ay = (-E.tmp.v.y * 0.5 + 0.5) * vh;
      var side = ax > vw * 0.5 ? 1 : -1;
      var lx = clamp(ax + side * 74, 12, vw - 12);
      var ly = clamp(ay + (ay < 140 ? 44 : -30), 12, vh - 12);
      el.style.transform = 'translate(' + lx + 'px,' + ly + 'px) translate(' +
        (side > 0 ? '0' : '-100%') + ',-50%)';
      el.classList.add('show');
      el.classList.toggle('sel', isSel);
      ln.setAttribute('x1', ax); ln.setAttribute('y1', ay);
      ln.setAttribute('x2', lx - side * 3); ln.setAttribute('y2', ly);
      ln.setAttribute('class', 'leader' + (isSel ? ' sel' : ''));
      ln.style.opacity = isSel ? 1 : (E.S.selected ? 0.25 : 0.7);
      el.style.filter = E.S.selected && !isSel ? 'saturate(.4) brightness(.8)' : '';
    });
  }

  /* ---------- 战术 HUD ---------- */
  function buildHud() {
    var svg = document.getElementById('lines');
    if (svg) {
      E.hud.box = document.createElementNS(NS, 'rect');
      E.hud.box.setAttribute('class', 'lockbox');
      svg.appendChild(E.hud.box);
      for (var i = 0; i < 4; i++) {
        var p = document.createElementNS(NS, 'path');
        p.setAttribute('class', 'lockbrk');
        svg.appendChild(p);
        E.hud.brackets.push(p);
      }
      // 敌方/目标标记槽位
      for (var k = 0; k < 6; k++) {
        var slot = { paths: [], box: null, tag: null };
        slot.box = document.createElementNS(NS, 'rect');
        slot.box.setAttribute('class', 'lockbox enemy');
        svg.appendChild(slot.box);
        for (var j = 0; j < 4; j++) {
          var q = document.createElementNS(NS, 'path');
          q.setAttribute('class', 'lockbrk enemy');
          svg.appendChild(q);
          slot.paths.push(q);
        }
        E.hud.markerSlots.push(slot);
      }
    }
    var layer = document.getElementById('labels');
    if (layer) {
      E.hud.tag = document.createElement('div');
      E.hud.tag.className = 'locktag';
      layer.appendChild(E.hud.tag);
    }
    E.hud.els = {
      mode: byId('m-mode'), wave: byId('m-wave'), kill: byId('m-kill'), threat: byId('m-threat'),
      rng: byId('rd-rng'), cont: byId('rd-cont'), ammo: byId('rd-ammo'), msl: byId('rd-msl'),
      telemetry: byId('telemetry-body'), board: byId('targetboard'), flash: byId('flash')
    };
    var cv = byId('radar');
    if (cv && cv.getContext) {
      var dpr = Math.min((window.devicePixelRatio || 1), 2);
      cv.width = E.hud.RADAR_S * dpr;
      cv.height = E.hud.RADAR_S * dpr;
      E.hud.radar = cv;
      E.hud.rctx = cv.getContext('2d');
      if (E.hud.rctx && E.hud.rctx.scale) E.hud.rctx.scale(dpr, dpr);
    }
  }

  function updateLock() {
    var sel = E.S.selected ? E.partById[E.S.selected] : null;
    var vw = window.innerWidth, vh = window.innerHeight;
    if (!sel || !E.hud.box) {
      if (E.hud.box) E.hud.box.classList.remove('on');
      E.hud.brackets.forEach(function (p) { p.classList.remove('on'); });
      if (E.hud.tag) E.hud.tag.classList.remove('on');
      return;
    }
    var b = sel.localBox;
    var xs = [b.min.x, b.max.x], ys = [b.min.y, b.max.y], zs = [b.min.z, b.max.z];
    var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, behind = false;
    for (var i = 0; i < 2; i++) for (var j = 0; j < 2; j++) for (var k = 0; k < 2; k++) {
      E.tmp.v.set(xs[i], ys[j], zs[k]);
      sel.group.localToWorld(E.tmp.v);
      E.tmp.v.project(E.camera);
      if (E.tmp.v.z > 1) behind = true;
      var sx = (E.tmp.v.x * 0.5 + 0.5) * vw, sy = (-E.tmp.v.y * 0.5 + 0.5) * vh;
      x0 = Math.min(x0, sx); y0 = Math.min(y0, sy);
      x1 = Math.max(x1, sx); y1 = Math.max(y1, sy);
    }
    if (behind || x1 - x0 < 4 || y1 - y0 < 4 || x1 < 0 || y1 < 0 || x0 > vw || y0 > vh) {
      E.hud.box.classList.remove('on');
      E.hud.brackets.forEach(function (p) { p.classList.remove('on'); });
      E.hud.tag.classList.remove('on');
      return;
    }
    drawBracket(E.hud.box, E.hud.brackets, x0, y0, x1, y1, vw, vh);
    var lockPct = 96 + Math.round(Math.sin(E.hud.t * 4.2) * 3);
    E.hud.tag.textContent = 'TGT-' + String(sel.index + 1).padStart(2, '0') + '  ' +
      sel.def.name + '  ·  LOCK ' + lockPct + '%';
    E.hud.tag.classList.remove('enemy');
    E.hud.tag.style.transform = 'translate(' + x0 + 'px,' + Math.max(10, y0 - 26) + 'px)';
    E.hud.tag.classList.add('on');
  }

  function drawBracket(boxEl, paths, x0, y0, x1, y1, vw, vh) {
    var pad = 9;
    x0 = clamp(x0 - pad, 4, vw - 4); y0 = clamp(y0 - pad, 4, vh - 4);
    x1 = clamp(x1 + pad, 4, vw - 4); y1 = clamp(y1 + pad, 4, vh - 4);
    var arm = clamp(Math.min(x1 - x0, y1 - y0) * 0.3, 9, 26);
    boxEl.setAttribute('x', x0); boxEl.setAttribute('y', y0);
    boxEl.setAttribute('width', Math.max(1, x1 - x0));
    boxEl.setAttribute('height', Math.max(1, y1 - y0));
    boxEl.classList.add('on');
    var d = [
      'M' + (x0 + arm) + ',' + y0 + 'L' + x0 + ',' + y0 + 'L' + x0 + ',' + (y0 + arm),
      'M' + (x1 - arm) + ',' + y0 + 'L' + x1 + ',' + y0 + 'L' + x1 + ',' + (y0 + arm),
      'M' + (x1 - arm) + ',' + y1 + 'L' + x1 + ',' + y1 + 'L' + x1 + ',' + (y1 - arm),
      'M' + (x0 + arm) + ',' + y1 + 'L' + x0 + ',' + y1 + 'L' + x0 + ',' + (y1 - arm)
    ];
    paths.forEach(function (p, n) { p.setAttribute('d', d[n]); p.classList.add('on'); });
  }

  /** 引擎提供：给任意世界坐标目标画锁定框（combat 每帧往 S.markers 里塞） */
  function updateMarkers() {
    var vw = window.innerWidth, vh = window.innerHeight;
    var list = E.S.markers;
    E.hud.markerSlots.forEach(function (slot, i) {
      var mk = list[i];
      if (!mk) {
        slot.box.classList.remove('on');
        slot.paths.forEach(function (p) { p.classList.remove('on'); });
        return;
      }
      var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, behind = false;
      var hx = mk.size.x / 2, hy = mk.size.y / 2, hz = mk.size.z / 2;
      for (var a = -1; a <= 1; a += 2) for (var b = -1; b <= 1; b += 2) for (var c = -1; c <= 1; c += 2) {
        E.tmp.v.set(mk.pos.x + hx * a, mk.pos.y + hy * b, mk.pos.z + hz * c);
        E.tmp.v.project(E.camera);
        if (E.tmp.v.z > 1) behind = true;
        var sx = (E.tmp.v.x * 0.5 + 0.5) * vw, sy = (-E.tmp.v.y * 0.5 + 0.5) * vh;
        x0 = Math.min(x0, sx); y0 = Math.min(y0, sy);
        x1 = Math.max(x1, sx); y1 = Math.max(y1, sy);
      }
      if (behind || x1 - x0 < 3 || y1 - y0 < 3) {
        slot.box.classList.remove('on');
        slot.paths.forEach(function (p) { p.classList.remove('on'); });
        return;
      }
      drawBracket(slot.box, slot.paths, x0, y0, x1, y1, vw, vh);
      slot.box.classList.toggle('dead', !!mk.dead);
      slot.paths.forEach(function (p) { p.classList.toggle('dead', !!mk.dead); });
    });
  }

  function updateTelemetry(dt) {
    var els = E.hud.els;
    if (!els.telemetry) return;
    var th = E.orbit.theta;
    var dth = E.hud.prevTheta === null ? 0 : Math.abs(th - E.hud.prevTheta);
    E.hud.prevTheta = th;
    E.S.rotRate = dt > 0 ? dth / dt : 0;
    E.S.camAz = ((th * 180 / Math.PI) % 360 + 360) % 360;
    E.S.camAlt = E.orbit.cam.position.y;

    var rows = [];
    if (E.behavior && E.behavior.hudRows) {
      rows = E.behavior.hudRows(E.S, E) || [];
    } else {
      rows = [
        [{ k: 'ALT', v: (118 + E.S.camAlt * 4.2).toFixed(1) + ' m', c: '' },
         { k: 'HDG', v: String(Math.round(E.S.camAz)).padStart(3, '0') + '°', c: '' }]
      ];
    }
    // 行数变化时重建，否则只改文本
    if (E.hud.rows.length !== rows.length ||
        (rows.length && E.hud.rows[0].length !== rows[0].length)) {
      els.telemetry.innerHTML = '';
      E.hud.rows = rows.map(function (row) {
        var div = document.createElement('div');
        div.className = 'row';
        var vals = row.map(function (cell) {
          var k = document.createElement('span');
          k.className = 'k'; k.textContent = cell.k || '';
          var v = document.createElement('span');
          v.className = 'v'; v.textContent = cell.v || '';
          div.appendChild(k); div.appendChild(v);
          return v;
        });
        els.telemetry.appendChild(div);
        return vals;
      });
      return;
    }
    rows.forEach(function (row, ri) {
      row.forEach(function (cell, ci) {
        var v = E.hud.rows[ri][ci];
        if (v.textContent !== String(cell.v)) v.textContent = cell.v;
        var cls = 'v ' + (cell.c || '');
        if (v.className !== cls) v.className = cls;
      });
    });
  }

  function drawRadar() {
    var g = E.hud.rctx;
    if (!g) return;
    var S = E.hud.RADAR_S, c = S / 2, R = c - 2;
    g.clearRect(0, 0, S, S);
    g.strokeStyle = 'rgba(255,120,60,.22)'; g.lineWidth = 1;
    [0.35, 0.68, 1].forEach(function (k) { g.beginPath(); g.arc(c, c, R * k, 0, 6.2832); g.stroke(); });
    g.strokeStyle = 'rgba(255,120,60,.13)';
    g.beginPath(); g.moveTo(c, 2); g.lineTo(c, S - 2); g.moveTo(2, c); g.lineTo(S - 2, c); g.stroke();

    var a = (E.hud.t * 1.6) % 6.2832;
    g.fillStyle = 'rgba(255,140,80,.10)';
    g.beginPath(); g.moveTo(c, c); g.arc(c, c, R, a - 0.6, a); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(255,190,140,.75)'; g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(c, c); g.lineTo(c + Math.sin(a) * R, c - Math.cos(a) * R); g.stroke();

    // 自身部件（绿）
    var count = 0;
    E.parts.forEach(function (p) {
      var cx2 = p.localCenter.x + p.group.position.x;
      var cz2 = p.localCenter.z + p.group.position.z;
      var r = Math.sqrt(cx2 * cx2 + cz2 * cz2) / E.hud.RADAR_RANGE * R;
      if (r > R) r = R;
      var t2 = Math.atan2(cx2, cz2);
      var sel = E.S.selected === p.def.id;
      count++;
      g.fillStyle = sel ? 'rgba(255,176,32,.95)' : 'rgba(154,178,106,.5)';
      g.beginPath(); g.arc(c + Math.sin(t2) * r, c - Math.cos(t2) * r, sel ? 2.4 : 1.3, 0, 6.2832); g.fill();
    });
    // 外部触点（敌人等，红）
    (E.S.contacts || []).forEach(function (ct) {
      var r = Math.sqrt(ct.x * ct.x + ct.z * ct.z) / E.hud.RADAR_RANGE * R;
      if (r > R) r = R;
      var t3 = Math.atan2(ct.x, ct.z);
      var px = c + Math.sin(t3) * r, py = c - Math.cos(t3) * r;
      if (ct.sel) {
        g.strokeStyle = 'rgba(255,77,61,.9)'; g.lineWidth = 1.2;
        g.beginPath(); g.arc(px, py, 5.2, 0, 6.2832); g.stroke();
      }
      g.fillStyle = ct.dead ? 'rgba(120,120,120,.7)' : (ct.sel ? 'rgba(255,120,80,1)' : 'rgba(255,77,61,.85)');
      g.beginPath(); g.arc(px, py, ct.dead ? 1.4 : 2.2, 0, 6.2832); g.fill();
      count++;
    });
    if (E.hud.els.cont) E.hud.els.cont.textContent = String(count).padStart(2, '0');
    if (E.hud.els.rng) E.hud.els.rng.textContent = String(Math.round(E.hud.RADAR_RANGE * 3));
  }

  function updateMission() {
    var els = E.hud.els;
    if (!els.mode) return;
    var m = E.behavior && E.behavior.mission ? E.behavior.mission(E.S, E) : null;
    if (!m) { els.mode.textContent = E.S.exploded ? 'MODE FIELD-MAINT' : 'MODE STANDBY'; return; }
    if (m.mode && els.mode.textContent !== m.mode) els.mode.textContent = m.mode;
    if (m.wave !== undefined && els.wave.textContent !== String(m.wave)) els.wave.textContent = String(m.wave);
    if (m.kill !== undefined && els.kill.textContent !== String(m.kill)) els.kill.textContent = String(m.kill);
    if (m.threat !== undefined && els.threat.textContent !== String(m.threat)) els.threat.textContent = String(m.threat);
  }

  function updateHud(dt) {
    E.hud.t += dt;
    updateLock();
    updateMarkers();
    updateTelemetry(dt);
    drawRadar();
    updateMission();
  }

  /* ---------- UI ---------- */
  /** 展台样式：影院遮幅、蓝图模式背景、镜头说明（引擎自带，页面无需引入） */
  function injectStageCSS() {
    try {
      if (!document.createElement || !document.head) return;
      if (document.getElementById && document.getElementById('dji-stage-css')) return;
      var css = [
        '.cinema-bars i { position: fixed; left: 0; right: 0; height: 0; background: #000;',
        '  z-index: 9; pointer-events: none; transition: height .7s cubic-bezier(.2,.7,.3,1); }',
        '.cinema-bars i.top { top: 0; } .cinema-bars i.bottom { bottom: 0; }',
        'body.cinema .cinema-bars i { height: 7.5vh; }',
        '.cinema-bars .cap { position: fixed; left: 50%; bottom: 10vh; transform: translateX(-50%);',
        '  z-index: 9; font-family: var(--mono, monospace); font-size: 11px; letter-spacing: .34em;',
        '  color: rgba(255,255,255,.75); opacity: 0; transition: opacity .5s; pointer-events: none;',
        '  text-shadow: 0 2px 12px rgba(0,0,0,.8); }',
        'body.cinema .cinema-bars .cap { opacity: 1; }',
        'body.blueprint::before { background: linear-gradient(180deg,#04121c 0%,#02090f 55%,#010407 100%) !important; }',
        'body.blueprint::after { opacity: .85 !important; }',
        '.btn#btn-lang { min-width: 40px; font-family: var(--mono); }',
        /* --- 展台外壳 --- */
        '#stage-vig { position: fixed; inset: 0; z-index: 4; pointer-events: none;',
        '  box-shadow: inset 0 0 240px 70px rgba(0,0,0,.55), inset 0 0 70px 10px rgba(0,0,0,.35); }',
        '.stage-back-inline { text-decoration: none; display: inline-flex; align-items: center; gap: 4px;',
        '  font-family: var(--mono); letter-spacing: .04em; border-color: rgba(232,114,42,.45) !important;',
        '  color: #ffd9bd !important; background: rgba(232,114,42,.10) !important; }',
        '.stage-back-inline:hover { color: #fff !important; border-color: rgba(232,114,42,.95) !important;',
        '  box-shadow: 0 0 16px rgba(232,114,42,.25); transform: translateX(-2px); }',
        '.stage-back-inline span { white-space: nowrap; }',
        '.actions .btn { padding: 7px 10px; font-size: 11.5px; }',
        '#btn-music { min-width: 38px; font-size: 13px; padding: 6px 9px; }',
        '#btn-music.on { border-color: rgba(108,224,168,.8); color: #06170f;',
        '  background: linear-gradient(135deg,#a8f0d8,#6ce0a8); }',
        /* --- 启动动画 --- */
        '#stage-intro { position: fixed; inset: 0; z-index: 18; display: flex; align-items: center;',
        '  justify-content: center; text-align: center; transition: opacity .8s;',
        '  background: radial-gradient(900px 620px at 50% 44%, rgba(18,28,36,.96), rgba(3,5,8,.99) 70%); }',
        '#stage-intro.hide { opacity: 0; pointer-events: none; }',
        '#stage-intro::before { content: ""; position: absolute; inset: 0; pointer-events: none; opacity: .5;',
        '  background-image: linear-gradient(rgba(150,200,220,.05) 1px, transparent 1px),',
        '    linear-gradient(90deg, rgba(150,200,220,.05) 1px, transparent 1px); background-size: 52px 52px; }',
        '.intro-inner { position: relative; z-index: 1; padding: 20px; }',
        '.intro-rotor { width: 76px; height: 76px; margin: 0 auto 26px; position: relative; }',
        '.intro-rotor i { position: absolute; inset: 0; border: 2px solid rgba(232,114,42,.9); border-radius: 50%;',
        '  border-right-color: transparent; border-bottom-color: transparent; animation: introrot 2.6s linear infinite; }',
        '.intro-rotor i:nth-child(2) { inset: 15px; border-color: rgba(79,214,232,.85);',
        '  border-left-color: transparent; border-top-color: transparent; animation-duration: 1.7s; animation-direction: reverse; }',
        '.intro-rotor b { position: absolute; left: 50%; top: 50%; width: 9px; height: 9px; margin: -4.5px;',
        '  border-radius: 50%; background: #fff; box-shadow: 0 0 16px rgba(232,114,42,.9); }',
        '@keyframes introrot { to { transform: rotate(360deg); } }',
        '.intro-k { font-family: var(--mono); font-size: 10.5px; letter-spacing: .42em;',
        '  color: rgba(232,114,42,.95); margin-bottom: 16px; }',
        '#stage-intro h1 { margin: 0; font-size: clamp(26px,3.6vw,44px); letter-spacing: .01em; color: #eef6fb; }',
        '#stage-intro .sub { margin: 12px 0 0; font-family: var(--mono); font-size: 11px;',
        '  letter-spacing: .26em; color: #8fa6b2; }',
        '.intro-bar { width: 260px; height: 2px; margin: 30px auto 26px; overflow: hidden;',
        '  background: rgba(255,255,255,.10); border-radius: 2px; }',
        '.intro-bar i { display: block; width: 40%; height: 100%; border-radius: 2px;',
        '  background: linear-gradient(90deg, transparent, #e8722a, #4fd6e8, transparent);',
        '  animation: introbar 2.1s ease-in-out infinite; }',
        '@keyframes introbar { 0% { transform: translateX(-110%); } 100% { transform: translateX(280%); } }',
        '#btn-enter { font: inherit; font-family: var(--mono); font-size: 13px; letter-spacing: .16em;',
        '  cursor: pointer; color: #1d0f05; font-weight: 700; padding: 13px 40px; border: 0;',
        '  border-radius: 30px; background: linear-gradient(135deg,#ffb877,#e8722a);',
        '  box-shadow: 0 10px 34px rgba(232,114,42,.34); transition: transform .2s, box-shadow .2s; }',
        '#btn-enter:hover { transform: translateY(-2px); box-shadow: 0 14px 42px rgba(232,114,42,.5); }',
        '.intro-hint { margin-top: 22px; font-family: var(--mono); font-size: 10px;',
        '  letter-spacing: .14em; color: #6f8592; }',
        '.intro-hint kbd { color: #cfe6ef; border: 1px solid rgba(160,185,205,.25);',
        '  border-radius: 4px; padding: 1px 5px; margin: 0 2px; }',
        '.intro-log { width: 300px; margin: 18px auto 0; text-align: left; min-height: 108px; }',
        '.intro-log .log-row { display: flex; align-items: center; gap: 8px; opacity: 0;',
        '  transform: translateX(-6px); transition: opacity .45s, transform .45s;',
        '  font-family: var(--mono); font-size: 10.5px; letter-spacing: .12em; color: #9fb4c0;',
        '  padding: 2.5px 0; }',
        '.intro-log .log-row.in { opacity: 1; transform: none; }',
        '.intro-log .log-row i { color: var(--intro-accent2, #4fd6e8); font-style: normal;',
        '  font-size: 10px; text-shadow: 0 0 10px rgba(79,214,232,.7); }',
        '#stage-intro .intro-k { color: var(--intro-accent, #e8722a); }',
        '.intro-rotor i { border-color: var(--intro-accent, rgba(232,114,42,.9)); }',
        '.intro-rotor i:nth-child(2) { border-color: var(--intro-accent2, rgba(79,214,232,.85)); }',
        '.intro-rotor b { box-shadow: 0 0 16px var(--intro-accent, rgba(232,114,42,.9)); }',
        '#btn-enter { background: linear-gradient(135deg, var(--intro-accent, #e8722a), #ffb877); }',
        '.selftest-panel { position: fixed; right: 18px; top: 84px; z-index: 6; width: 200px;',
        '  padding: 10px 12px; border-radius: 12px; opacity: 0; transform: translateY(-8px);',
        '  transition: opacity .4s, transform .4s; pointer-events: none;',
        '  border: 1px solid rgba(90,214,255,.28); background: rgba(5,10,14,.88); }',
        '.selftest-panel.on { opacity: 1; transform: none; }',
        '.selftest-panel .st-head { display: flex; align-items: center; gap: 8px;',
        '  font-family: var(--mono); font-size: 10px; letter-spacing: .18em; color: #7fdcff;',
        '  padding-bottom: 7px; margin-bottom: 7px; border-bottom: 1px solid rgba(90,214,255,.18); }',
        '.selftest-panel .st-head span { margin-left: auto; opacity: .6; }',
        '.selftest-panel ul { list-style: none; margin: 0; padding: 0; }',
        '.selftest-panel li { display: flex; align-items: center; gap: 7px; font-size: 11.5px;',
        '  padding: 3px 0; color: #93a7b3; transition: color .3s; }',
        '.selftest-panel li i { width: 6px; height: 6px; border-radius: 50%; flex: none;',
        '  background: rgba(255,255,255,.16); transition: background .3s, box-shadow .3s; }',
        '.selftest-panel li em { margin-left: auto; font-style: normal; font-family: var(--mono);',
        '  font-size: 8.5px; letter-spacing: .1em; opacity: .5; }',
        '.selftest-panel li.ok { color: #d8f3e6; }',
        '.selftest-panel li.ok i { background: #5df0a8; box-shadow: 0 0 9px rgba(93,240,168,.85); }',
        '.selftest-panel li.ok em { color: #5df0a8; opacity: .85; }',
        '#m-status.busy { color: #b6f0ff; border-color: rgba(90,214,255,.55);',
        '  box-shadow: 0 0 18px rgba(90,214,255,.18); }'
      ].join('\n');
      var s = document.createElement('style');
      s.id = 'dji-stage-css';
      s.textContent = css;
      document.head.appendChild(s);
    } catch (e) { /* 测试环境忽略 */ }
  }

  function byId(id) { return document.getElementById(id); }

  /* 模块级按钮工具：buildUI 与 buildStageShell 共用（注意 JS 是词法作用域，
     模块级函数拿不到 buildUI 内部的局部函数）*/
  function on(id, fn) {
    var b = byId(id);
    if (b && b.addEventListener) b.addEventListener('click', fn);
  }

  function ensureBtn(id, label) {
    var el = byId(id);
    if (el) return el;
    var box = null;
    try { box = document.querySelector ? document.querySelector('.actions') : null; } catch (e) { box = null; }
    if (!box || !box.appendChild || !document.createElement) return null;
    el = document.createElement('button');
    el.className = 'btn'; el.id = id; el.textContent = label;
    box.appendChild(el);
    return el;
  }

  function buildUI() {
    var list = byId('parts-list');
    byId('parts-count').textContent = E.parts.length + ' 项';
    E.parts.forEach(function (p) {
      var def = p.def;
      var li = document.createElement('li');
      li.className = 'part-item';
      li.dataset.id = def.id;
      var idx = document.createElement('span');
      idx.className = 'idx'; idx.textContent = String(p.index + 1).padStart(2, '0');
      var dot = document.createElement('span');
      dot.className = 'dot'; dot.style.setProperty('--c', def.color);
      var meta = document.createElement('span');
      meta.className = 'meta';
      var b = document.createElement('b');
      b.textContent = E.S.lang === 'en' ? (def.en || def.name) : def.name;
      var en = document.createElement('i');
      en.textContent = E.S.lang === 'en' ? def.tag : (def.en || '');
      meta.appendChild(b); meta.appendChild(en);
      li.appendChild(idx); li.appendChild(dot); li.appendChild(meta);
      li.addEventListener('click', function () {
        E.S.selected = def.id;
        E.S.exploded = true;
        syncUI();
      });
      li.addEventListener('pointerenter', function () { E.S.hovered = def.id; });
      li.addEventListener('pointerleave', function () {
        if (E.S.hovered === def.id) E.S.hovered = null;
      });
      list.appendChild(li);
    });

    renderDetail(null);

    // 引擎自带按钮（on / ensureBtn 见模块级定义，全部做空值保护）
    on('btn-explode', toggleExplode);
    on('btn-expand-all', toggleExplode);
    on('btn-reset', function () { E.orbit.reset(); });
    on('btn-labels', function () {
      E.S.labels = !E.S.labels;
      var b = byId('btn-labels');
      if (b) b.classList.toggle('on', E.S.labels);
    });
    on('btn-rotate', function () { setAutoRotate(!E.orbit.autoRotate); });
    on('btn-parts', function () { var b = byId('panel-parts'); if (b) b.classList.toggle('open'); });
    on('btn-detail', function () { var b = byId('panel-detail'); if (b) b.classList.toggle('open'); });
    on('btn-fold', function () { toggleFold(); });
    // 没有铰链部件的机型不显示/不绑定折叠按钮，避免死 UI
    var hasHinge = E.parts.some(function (p) { return !!p.def.hinge; });
    var fb = byId('btn-fold');
    if (fb && !hasHinge) fb.style.display = 'none';
    E.hasHinge = hasHinge;

    /* ---- 展台级功能：引擎自动创建按钮与遮幅，页面无需改动 ---- */
    injectStageCSS();
    var TIPS = {
      'btn-tour': '\u6f14\u793a\u5de1\u6e38 / Showreel (T)',
      'btn-blueprint': '\u6280\u672f\u56fe\u7eb8\u6a21\u5f0f / Blueprint (B)',
      'btn-lang': '\u4e2d\u82f1\u5207\u6362 / Language (U)',
      'btn-music': '\u97f3\u4e50\u5f00\u5173 / Music',
      'btn-explode': '\u62c6\u89e3 / \u5408\u62e2 (E)',
      'btn-rotate': '\u81ea\u52a8\u65cb\u8f6c / Auto orbit',
      'btn-labels': '\u90e8\u4ef6\u6807\u6ce8 / Labels (L)',
      'btn-reset': '\u91cd\u7f6e\u89c6\u89d2 / Reset view (R)',
      'btn-fold': '\u673a\u81c2\u5c55\u5f00\u6298\u53e0 / Fold arms (X)',
      'btn-parts': '\u90e8\u4ef6\u6e05\u5355 / Parts',
      'btn-detail': '\u53c2\u6570\u8bf4\u660e / Specs',
      'btn-expand-all': '\u4e00\u952e\u62c6\u89e3\u6216\u5408\u62e2 / Explode or assemble'
    };
    if (isAerial()) ensureBtn('btn-fly', E.S.lang === 'en' ? 'HOVER FLIGHT' : '模拟飞行');
    ensureBtn('btn-scan', E.S.lang === 'en' ? 'SELF-TEST' : '状态自检');
    on('btn-fly', toggleFly);
    var fBtn = byId('btn-fly');
    if (fBtn && !isAerial() && fBtn.style) fBtn.style.display = 'none';
    else if (fBtn && fBtn.classList) fBtn.classList.add('on');
    on('btn-scan', startScan);
    ensureBtn('btn-tour', T('tour'));
    ensureBtn('btn-blueprint', T('blueprint'));
    ensureBtn('btn-lang', E.S.lang === 'en' ? '中' : 'EN');
    buildStageShell();
    on('btn-tour', function () { setTour(!E.S.tour); });
    on('btn-blueprint', function () { setBlueprint(!E.S.blueprint); });
    on('btn-lang', function () { setLang(E.S.lang === 'en' ? 'cn' : 'en'); });
    Object.keys(TIPS).forEach(function (id) {
      var el = byId(id);
      if (el && !el.title) el.title = TIPS[id];
    });
    // 影院遮幅（巡航时出现，带镜头说明）
    if (!byId('cinema')) {
      try {
        var body = document.body || document.documentElement;
        if (body && body.appendChild) {
          var cine = document.createElement('div');
          cine.id = 'cinema'; cine.className = 'cinema-bars';
          cine.innerHTML = '<i class="top"></i><i class="bottom"></i><span class="cap" id="cinema-cap"></span>';
          body.appendChild(cine);
        }
      } catch (e4) { /* 测试环境无 DOM，忽略 */ }
    }

    // 行为自定义按钮
    if (E.behavior && E.behavior.buttons) {
      Object.keys(E.behavior.buttons).forEach(function (id) {
        var el = byId(id);
        if (el) el.addEventListener('click', function () { E.behavior.buttons[id](E); });
      });
    }

    // 拾取
    E.orbit.onHover = function (e) { onHover(e); };
    E.orbit.onClick = function (e) { onClick(e); };

    window.addEventListener('keydown', function (e) {
      if (e.target && /input|textarea/i.test(e.target.tagName)) return;
      var k = e.key.toLowerCase();
      if (E.behavior && E.behavior.keys && E.behavior.keys[k]) {
        if (E.behavior.keys[k](E) !== false) { e.preventDefault(); return; }
      }
      if (k === 'e') toggleExplode();
      else if (k === 'r') E.orbit.reset();
      else if (k === 'x') toggleFold();
      else if (k === 't') setTour(!E.S.tour);
      else if (k === 'b') setBlueprint(!E.S.blueprint);
      else if (k === 'u') setLang(E.S.lang === 'en' ? 'cn' : 'en');
      else if (k === 'l') { var lb = byId('btn-labels'); if (lb) lb.click(); }
      else if (k === 'f') toggleFly();
      else if (k === 's') startScan();
      else if (k === 'escape') { E.S.selected = null; syncUI(); }
    });

    syncUI();
  }

  function setAutoRotate(v) {
    E.orbit.autoRotate = v;
    E.S.autoRotate = v;
    var b = byId('btn-rotate');
    if (b) b.classList.toggle('on', v);
  }

  function toggleExplode() {
    E.S.exploded = !E.S.exploded;
    if (!E.S.exploded) E.S.selected = null;
    syncUI();
  }

  /** 机臂展开 / 折叠（机型用 def.hinge 声明铰链）*/
  function toggleFold() {
    E.S.folded = !E.S.folded;
    var b = byId('btn-fold');
    if (b) {
      b.classList.toggle('on', !E.S.folded);
      b.textContent = E.S.folded ? '展开机臂' : '折叠机臂';
    }
  }

  function syncUI() {
    var btnE = byId('btn-explode');
    if (btnE) {
      btnE.textContent = E.S.exploded ? '合拢' : '拆解';
      btnE.classList.toggle('on', E.S.exploded);
    }
    var items = document.querySelectorAll('.part-item');
    for (var i = 0; i < items.length; i++) {
      items[i].classList.toggle('active', items[i].dataset.id === E.S.selected);
    }
    var active = document.querySelector('.part-item.active');
    if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    renderDetail(E.S.selected ? E.partById[E.S.selected] : null);
  }

  function renderDetail(part) {
    var boxEl = byId('detail-body');
    var tag = byId('detail-tag');
    if (!boxEl) return;
    var M = E.model;
    var en = E.S.lang === 'en';
    if (!part) {
      tag.textContent = T('whole');
      boxEl.innerHTML =
        '<div class="detail-name">' + (en && M.titleEn ? M.titleEn : M.title) + '</div>' +
        '<div class="detail-en">' + (M.subtitle || '') + '</div>' +
        '<div class="detail-role">' + (M.intro ||
          '点击模型中的任意部件，或点击左侧「部件清单」，即可自动拆解整机并查看该部件的结构与参数。') +
        '</div><div class="sec-title">' + T('specs') + '</div>' + specsHTML(M.spec) +
        '<div class="sec-title">' + T('layers') + '</div><div class="chips">' +
        (M.groups || []).map(function (t) { return '<span class="chip">' + t + '</span>'; }).join('') +
        '</div>';
      return;
    }
    var d = part.def;
    tag.textContent = en ? (d.en || d.name) : d.name;
    boxEl.innerHTML =
      '<div class="detail-name">' + (en ? (d.en || d.name) : d.name) + '</div>' +
      '<div class="detail-en">' + (en ? d.name : (d.en || '')) + '</div>' +
      '<div class="detail-role">' + d.role + '</div>' +
      '<div class="sec-title">' + T('partSpecs') + '</div>' + specsHTML(d.specs) +
      '<div class="sec-title">' + T('dirTitle') + '</div><div class="chips">' +
      '<span class="chip">' + T('index') + ' ' + String(part.index + 1).padStart(2, '0') + ' / ' + E.parts.length + '</span>' +
      '<span class="chip">' + T('move') + ' ' + d.dist.toFixed(1) + ' cm</span>' +
      '<span class="chip">' + axisName(d.dir) + '</span></div>';
  }

  function axisName(dir) {
    var en = E.S.lang === 'en';
    var ax = [];
    if (Math.abs(dir[0]) > 0.25) ax.push(dir[0] > 0 ? (en ? 'RIGHT' : '右侧') : (en ? 'LEFT' : '左侧'));
    if (Math.abs(dir[1]) > 0.25) ax.push(dir[1] > 0 ? (en ? 'TOP' : '顶部') : (en ? 'BOTTOM' : '底部'));
    if (Math.abs(dir[2]) > 0.25) ax.push(dir[2] > 0 ? (en ? 'FRONT' : '前方') : (en ? 'REAR' : '后方'));
    return ax.join(' / ') || T('none');
  }

  function specsHTML(specs) {
    return (specs || []).map(function (s) {
      return '<div class="spec"><span class="k">' + s[0] + '</span><span class="v">' + s[1] + '</span></div>';
    }).join('');
  }

  /* ---------- 拾取 ---------- */
  function pickAt(x, y) {
    E.pointerNDC.x = (x / window.innerWidth) * 2 - 1;
    E.pointerNDC.y = -(y / window.innerHeight) * 2 + 1;
    E.raycaster.setFromCamera(E.pointerNDC, E.camera);
    var list = E.pickables;
    if (E.behavior && E.behavior.pickables) list = list.concat(E.behavior.pickables());
    var hits = E.raycaster.intersectObjects(list, false);
    if (!hits.length) return null;
    var o = hits[0].object;
    if (o.userData && o.userData.partId) return { kind: 'part', id: o.userData.partId };
    if (o.userData && o.userData.enemyRef) return { kind: 'enemy', ref: o.userData.enemyRef, point: hits[0].point };
    return null;
  }

  function onHover(e) {
    var hit = pickAt(e.clientX, e.clientY);
    E.S.hovered = hit && hit.kind === 'part' ? hit.id : null;
    if (E.behavior && E.behavior.hover) E.behavior.hover(hit, E);
    E.renderer.domElement.style.cursor = hit ? 'pointer' : '';
    var tipEl = byId('tip');
    if (tipEl) {
      if (hit && hit.kind === 'part') {
        var p = E.partById[hit.id];
        tipEl.textContent = (E.S.lang === 'en' ? (p.def.en || p.def.name) : p.def.name) + ' · ' + p.def.tag;
        tipEl.classList.remove('threat');
        tipEl.style.left = e.clientX + 'px';
        tipEl.style.top = e.clientY + 'px';
        tipEl.classList.add('show');
      } else if (hit && hit.kind === 'enemy' && E.behavior && E.behavior.enemyTip) {
        tipEl.textContent = E.behavior.enemyTip(hit.ref);
        tipEl.classList.add('threat', 'show');
        tipEl.style.left = e.clientX + 'px';
        tipEl.style.top = e.clientY + 'px';
      } else {
        tipEl.classList.remove('show');
      }
    }
  }

  function onClick(e) {
    var tipEl = byId('tip');
    if (tipEl) tipEl.classList.remove('show');
    var hit = pickAt(e.clientX, e.clientY);
    if (hit && hit.kind === 'part') {
      if (E.S.selected === hit.id && E.S.exploded) {
        E.S.exploded = false; E.S.selected = null;
      } else {
        E.S.selected = hit.id; E.S.exploded = true;
      }
      syncUI();
      return;
    }
    if (E.behavior && E.behavior.pick && E.behavior.pick(hit, E) !== false) return;
    E.S.selected = null;
    syncUI();
  }

  /* ---------- 每帧 ---------- */
  function updateParts(dt) {
    E.parts.forEach(function (p, i) {
      var local = clamp(E.S.explodeT * 1.75 - i * 0.032, 0, 1);
      p.progress = easeInOutCubic(local);
      p.group.position.copy(p.basePos).addScaledVector(p.dir, p.dist * p.progress);

      var isSel = E.S.selected === p.def.id;
      var isHover = E.S.hovered === p.def.id;
      p.highlight = lerp(p.highlight, isSel ? 1 : (isHover ? 0.45 : 0), 1 - Math.exp(-dt * 10));
      var pulse = isSel ? 0.82 + Math.sin(performance.now() * 0.0045) * 0.18 : 1;
      var h = p.highlight * pulse;
      var vis = p.highlight > 0.012;

      p.meshes.forEach(function (m) {
        var mats = Array.isArray(m.material) ? m.material : [m.material];
        mats.forEach(function (mat) {
          var base = mat.userData.__base;
          if (!base || !mat.emissive) return;
          mat.emissive.copy(base.emissive).lerp(p.accent, h * 0.85);
          mat.emissiveIntensity = base.intensity + h * 0.85;
        });
        if (m.userData.halo) {
          m.userData.halo.visible = vis;
          m.userData.halo.material.opacity = p.highlight * 0.3 * pulse;
        }
        if (m.userData.edges) {
          m.userData.edges.visible = vis;
          m.userData.edges.material.opacity = p.highlight * (isSel ? 0.85 : 0.5);
        }
      });
      p.sprite.material.opacity = p.highlight * (isSel ? 0.2 : 0.1) * pulse;
      p.sprite.material.color.copy(p.accent);
    });
  }

  /** 桨叶自旋 + 动态光晕 + 机臂展开/折叠（三台机型共用） */
  function updateSpinners(dt) {
    E.S.spinRate = lerp(E.S.spinRate, E.S.spinGoal,
      1 - Math.exp(-dt * (E.S.spinGoal > E.S.spinRate ? 1.6 : 2.6)));
    E.S.foldT = lerp(E.S.foldT, E.S.folded ? 0 : 1, 1 - Math.exp(-dt * 2.2));
    var rate = E.S.spinRate;
    for (var i = 0; i < E.parts.length; i++) {
      var p = E.parts[i], d = p.def;
      if (d.spin) {
        var sp = (typeof d.spin === 'number') ? d.spin : (d.spin.speed || 12);
        var axis = (d.spin && d.spin.axis) || 'y';
        var sign = (d.spin && d.spin.dir) || 1;   // 共轴双桨：上下反向
        // 折叠时桨叶停转
        var eff = rate * (0.25 + 0.75 * E.S.foldT);
        var rotor = p.group.userData.spinInner || p.group;
        rotor.rotation[axis] += sp * eff * dt * sign;
      }
      if (d.hinge) {
        var h = d.hinge;
        var ax = h.axis || 'y';
        // foldT=1 → from（展开到位）；foldT=0 → to（折叠）
        var v = lerp(h.to, h.from, E.S.foldT);
        p.group.rotation[ax] = v + (h.offset || 0);
      }
      if (p.disc) {
        var pulse = 0.88 + Math.sin(E.S.elapsed * 22 + i) * 0.12;
        p.disc.material.opacity = (0.05 + 0.2 * rate) * pulse * (0.3 + 0.7 * E.S.foldT);
        p.disc.rotation.z += dt * (5 + 26 * rate) * (d.spin && d.spin.dir === -1 ? -1 : 1);
      }
    }
  }

  /* =======================================================================
     6.5 后期处理管线：泛光 + ACES 调色 + 暗角 + 颗粒（失败自动降级为直出）
     ======================================================================= */
  var POST_VERT = [
    'varying vec2 vUv;',
    'void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }'
  ].join('\n');

  var BRIGHT_FRAG = [
    'uniform sampler2D tDiffuse;',
    'uniform float uThreshold; uniform float uKnee;',
    'varying vec2 vUv;',
    'void main() {',
    '  vec3 c = texture2D(tDiffuse, vUv).rgb;',
    '  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));',
    '  float w = smoothstep(uThreshold, uThreshold + uKnee, l);',
    '  gl_FragColor = vec4(c * w, 1.0);',
    '}'
  ].join('\n');

  var BLUR_FRAG = [
    'uniform sampler2D tDiffuse; uniform vec2 uDir;',
    'varying vec2 vUv;',
    'void main() {',
    '  vec3 s = texture2D(tDiffuse, vUv).rgb * 0.2270270;',
    '  s += texture2D(tDiffuse, vUv + uDir * 1.3846154).rgb * 0.3162162;',
    '  s += texture2D(tDiffuse, vUv - uDir * 1.3846154).rgb * 0.3162162;',
    '  s += texture2D(tDiffuse, vUv + uDir * 3.2307692).rgb * 0.0702703;',
    '  s += texture2D(tDiffuse, vUv - uDir * 3.2307692).rgb * 0.0702703;',
    '  gl_FragColor = vec4(s, 1.0);',
    '}'
  ].join('\n');

  var COMP_FRAG = [
    'uniform sampler2D tBase; uniform sampler2D tBloom;',
    'uniform float uBloom; uniform float uExposure;',
    'uniform float uVignette; uniform float uGrain; uniform vec2 uRes; uniform float uTime;',
    'uniform vec3 uTint;',
    'varying vec2 vUv;',
    'vec3 aces(vec3 x) {',
    '  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);',
    '}',
    'float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }',
    'void main() {',
    '  vec2 uv = vUv;',
    '  vec2 d = uv - 0.5;',
    '  float r2 = dot(d, d);',
    '  float ca = 0.0016 * r2;',
    '  vec3 base;',
    '  base.r = texture2D(tBase, uv + d * ca).r;',
    '  base.g = texture2D(tBase, uv).g;',
    '  base.b = texture2D(tBase, uv - d * ca).b;',
    '  vec3 bloom = texture2D(tBloom, uv).rgb;',
    '  vec3 col = base + bloom * uBloom;',
    '  col *= uExposure;',
    '  col *= uTint;',
    '  col = aces(col);',
    '  float vig = smoothstep(0.92, 0.28, r2 * 2.4);',
    '  col *= mix(1.0, vig, uVignette);',
    '  float g = hash(uv * uRes + uTime) - 0.5;',
    '  col += g * uGrain;',
    '  col = max(col, vec3(0.0));',
    '  col = mix(col * 12.92, 1.055 * pow(col, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, col));',
    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  function initPost() {
    try {
      if (!E.renderer || !THREE.WebGLRenderTarget) return null;
      // 能力检测：拿不到渲染目标 API 就直接直出（测试桩 / 极简渲染器）
      if (typeof E.renderer.setRenderTarget !== 'function') return null;
      var gl2 = !!(E.renderer.capabilities && E.renderer.capabilities.isWebGL2);
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var w = Math.max(2, Math.floor(window.innerWidth * dpr));
      var h = Math.max(2, Math.floor(window.innerHeight * dpr));
      var type = gl2 ? THREE.HalfFloatType : THREE.UnsignedByteType;
      function mkRT(ww, hh, samples, depth) {
        var o = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
          format: THREE.RGBAFormat, type: type, depthBuffer: !!depth, stencilBuffer: false };
        if (samples && gl2) o.samples = samples;
        return new THREE.WebGLRenderTarget(ww, hh, o);
      }
      var sceneRT = mkRT(w, h, 4, true);   // WebGL2 走 4×MSAA（抗锯齿）
      var bw = Math.max(2, Math.floor(w / 2)), bh = Math.max(2, Math.floor(h / 2));
      var bright = mkRT(bw, bh, 0, false), blurA = mkRT(bw, bh, 0, false), blurB = mkRT(bw, bh, 0, false);

      var quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
      var qs = new THREE.Scene(); qs.add(quad);
      var qc = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      var uT = function (t) { return { value: t }; };
      var matBright = new THREE.ShaderMaterial({
        uniforms: { tDiffuse: uT(null), uThreshold: uT(1.30), uKnee: uT(0.60) },
        vertexShader: POST_VERT, fragmentShader: BRIGHT_FRAG, depthTest: false, depthWrite: false
      });
      var matBlur = new THREE.ShaderMaterial({
        uniforms: { tDiffuse: uT(null), uDir: { value: new THREE.Vector2() } },
        vertexShader: POST_VERT, fragmentShader: BLUR_FRAG, depthTest: false, depthWrite: false
      });
      var matComp = new THREE.ShaderMaterial({
        uniforms: {
          tBase: uT(null), tBloom: uT(null),
          uBloom: uT(0.60), uExposure: uT(1.05),
          uVignette: uT(0.55), uGrain: uT(0.016),
          uRes: { value: new THREE.Vector2(w, h) }, uTime: uT(0),
          uTint: { value: new THREE.Vector3(1.0, 1.0, 1.0) }
        },
        vertexShader: POST_VERT, fragmentShader: COMP_FRAG, depthTest: false, depthWrite: false
      });
      return { scene: sceneRT, bright: bright, blurA: blurA, blurB: blurB,
        quadScene: qs, quadCam: qc, quad: quad,
        matBright: matBright, matBlur: matBlur, matComp: matComp, w: w, h: h, dpr: dpr };
    } catch (e) {
      console.warn('[post] 初始化失败，回退直出：', e && e.message);
      return null;
    }
  }

  function resizePost() {
    if (!E.post) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = Math.max(2, Math.floor(window.innerWidth * dpr));
    var h = Math.max(2, Math.floor(window.innerHeight * dpr));
    var bw = Math.max(2, Math.floor(w / 2)), bh = Math.max(2, Math.floor(h / 2));
    E.post.scene.setSize(w, h);
    E.post.bright.setSize(bw, bh);
    E.post.blurA.setSize(bw, bh);
    E.post.blurB.setSize(bw, bh);
    E.post.matComp.uniforms.uRes.value.set(w, h);
    E.post.w = w; E.post.h = h;
  }

  function renderFrame() {
    if (!E.post || E.postDead) {
      E.renderer.render(E.scene, E.camera);
      return;
    }
    try {
      var R = E.renderer, P = E.post;
      R.setRenderTarget(P.scene);
      R.clear();
      R.render(E.scene, E.camera);

      P.quad.material = P.matBright;
      P.matBright.uniforms.tDiffuse.value = P.scene.texture;
      R.setRenderTarget(P.bright);
      R.render(P.quadScene, P.quadCam);

      var w1 = 1 / P.bright.width, h1 = 1 / P.bright.height;
      for (var i = 0; i < 2; i++) {
        P.quad.material = P.matBlur;
        P.matBlur.uniforms.tDiffuse.value = P.bright.texture;
        P.matBlur.uniforms.uDir.value.set(w1 * (1 + i), 0);
        R.setRenderTarget(P.blurA);
        R.render(P.quadScene, P.quadCam);

        P.matBlur.uniforms.tDiffuse.value = P.blurA.texture;
        P.matBlur.uniforms.uDir.value.set(0, h1 * (1 + i));
        R.setRenderTarget(P.blurB);
        R.render(P.quadScene, P.quadCam);
      }

      P.quad.material = P.matComp;
      P.matComp.uniforms.tBase.value = P.scene.texture;
      P.matComp.uniforms.tBloom.value = P.blurB.texture;
      P.matComp.uniforms.uTime.value = E.S.elapsed;
      var bp = E.S.blueprint;
      P.matComp.uniforms.uTint.value.set(bp ? 0.82 : 1.0, bp ? 0.94 : 1.0, bp ? 1.18 : 1.0);
      P.matComp.uniforms.uBloom.value = bp ? 1.05 : 0.60;
      P.matComp.uniforms.uGrain.value = bp ? 0.012 : 0.016;
      R.setRenderTarget(null);
      R.render(P.quadScene, P.quadCam);
    } catch (e) {
      E.postDead = true;
      console.warn('[post] 渲染异常，回退直出：', e && e.message);
      try { if (typeof E.renderer.setRenderTarget === 'function') E.renderer.setRenderTarget(null); } catch (e2) {}
      E.renderer.render(E.scene, E.camera);
    }
  }

  /* =======================================================================
     6.6 电影级演示巡航（镜头轨迹 + 自动拆解巡展 + 遮幅）
     ======================================================================= */
  var DEFAULT_TOUR = [
    { theta: 0.62, phi: 1.02, radius: 1.00, dur: 6.5, explode: false, label: '总览 / OVERVIEW' },
    { theta: 0.30, phi: 1.34, radius: 0.62, dur: 6.0, explode: false, label: '低角度特写 / LOW ANGLE' },
    { theta: 1.35, phi: 0.98, radius: 0.80, dur: 6.0, explode: false, label: '侧向 / PROFILE' },
    { theta: 2.35, phi: 0.72, radius: 1.25, dur: 8.5, explode: true, label: '拆解总览 / EXPLODED' },
    { theta: 3.60, phi: 1.15, radius: 1.05, dur: 6.0, explode: false, label: '后侧 / REAR' },
    { theta: 5.20, phi: 0.55, radius: 1.35, dur: 8.5, explode: true, label: '俯视拆解 / TOP EXPLODED' }
  ];

  function tourShots() { return (E.model && E.model.tour) || DEFAULT_TOUR; }

  function applyTourShot(i, instant) {
    var shots = tourShots();
    var s = shots[i % shots.length];
    var sc = E.cfg.scene;
    E.orbit.goalTheta = s.theta;
    E.orbit.goalPhi = clamp(s.phi, E.orbit.phiMin, E.orbit.phiMax);
    E.orbit.userRadius = clamp(sc.radius * s.radius, E.orbit.minRadius, E.orbit.maxRadius);
    E.orbit.goalTarget.set(0, (s.targetY !== undefined ? s.targetY : sc.targetY), 0);
    if (instant) {
      E.orbit.theta = E.orbit.goalTheta; E.orbit.phi = E.orbit.goalPhi;
      E.orbit.radius = E.orbit.userRadius;
      E.orbit.target.copy(E.orbit.goalTarget);
    }
    E.S.exploded = !!s.explode;
    if (!E.S.exploded) E.S.selected = null;
    syncUI();
    var cap = byId('cinema-cap');
    if (cap) cap.textContent = s.label || '';
  }

  function setTour(on) {
    E.S.tour = !!on;
    E.S.tourI = 0; E.S.tourT = 0;
    var b = byId('btn-tour');
    if (b) {
      b.classList.toggle('on', E.S.tour);
      b.textContent = E.S.tour ? T('tourEnd') : T('tour');
    }
    if (document.body && document.body.classList) document.body.classList.toggle('cinema', E.S.tour);
    if (E.S.tour) {
      E.orbit.autoRotate = false;
      var rb = byId('btn-rotate');
      if (rb) rb.classList.remove('on');
      applyTourShot(0, true);
    }
  }

  function updateTour(dt) {
    if (!E.S.tour) return;
    var shots = tourShots();
    E.S.tourT += dt;
    var s = shots[E.S.tourI % shots.length];
    if (E.S.tourT > s.dur) {
      E.S.tourT = 0;
      E.S.tourI = (E.S.tourI + 1) % shots.length;
      applyTourShot(E.S.tourI, false);
    }
    E.orbit.goalTheta += dt * 0.03;
  }

  /* =======================================================================
     6.7 蓝图线框技术模式
     ======================================================================= */
  var _bpSaved = null;
  function setBlueprint(on) {
    E.S.blueprint = !!on;
    if (E.S.blueprint) {
      _bpSaved = [];
      var seen = [];
      E.parts.forEach(function (p) {
        p.meshes.forEach(function (mm) {
          var mats = Array.isArray(mm.material) ? mm.material : [mm.material];
          mats.forEach(function (mat) {
            // 同一材质常被多个网格共用：只存一次，否则退出蓝图会还原成"最后一次"的值
            if (seen.indexOf(mat) >= 0) return;
            seen.push(mat);
            _bpSaved.push({ mat: mat, color: mat.color ? mat.color.clone() : null,
              wire: mat.wireframe, ei: mat.emissiveIntensity,
              em: mat.emissive ? mat.emissive.clone() : null });
            mat.wireframe = true;
            if (mat.color) mat.color.setHex(0x39e0ff);
            if (mat.emissive) mat.emissive.setHex(0x1f9fd0);
            mat.emissiveIntensity = 1.15;
          });
          if (mm.userData.halo) mm.userData.halo.visible = false;
        });
        if (p.disc) p.disc.visible = false;
      });
      if (E.hud.sweep) E.hud.sweep.visible = false;
      if (E.hud.scanRing) E.hud.scanRing.visible = false;
      if (E.scene.fog) E.scene.fog.density = 0.0015;
    } else {
      if (_bpSaved) {
        _bpSaved.forEach(function (r) {
          r.mat.wireframe = r.wire;
          if (r.mat.color && r.color) r.mat.color.copy(r.color);
          if (r.mat.emissive && r.em) r.mat.emissive.copy(r.em);
          r.mat.emissiveIntensity = r.ei;
        });
        _bpSaved = null;
      }
      if (E.hud.sweep) E.hud.sweep.visible = true;
      if (E.hud.scanRing) E.hud.scanRing.visible = true;
      if (E.scene.fog) E.scene.fog.density = E.cfg.scene.fog;
    }
    var b = byId('btn-blueprint');
    if (b) b.classList.toggle('on', E.S.blueprint);
    if (document.body && document.body.classList) document.body.classList.toggle('blueprint', E.S.blueprint);
  }

  /* =======================================================================
     6.8 中英双语
     ======================================================================= */
  var I18N = {
    cn: { parts: '部件清单', detail: '参数说明', explode: '拆解', collapse: '合拢',
      rotate: '自动旋转', labels: '标注', reset: '重置视角', tour: '演示巡航',
      tourEnd: '结束巡航', blueprint: '技术图纸', whole: '整机', specs: '整机规格',
      layers: '结构分层', partSpecs: '部件参数', dirTitle: '拆解方向',
      index: '序号', move: '位移', axis: '方向', none: '中心' },
    en: { parts: 'PARTS', detail: 'SPECIFICATIONS', explode: 'EXPLODE', collapse: 'ASSEMBLE',
      rotate: 'AUTO ORBIT', labels: 'LABELS', reset: 'RESET VIEW', tour: 'SHOWREEL',
      tourEnd: 'STOP SHOWREEL', blueprint: 'BLUEPRINT', whole: 'OVERVIEW', specs: 'AIRCRAFT SPECS',
      layers: 'SUBSYSTEMS', partSpecs: 'PART SPECS', dirTitle: 'EXPLODE AXIS',
      index: 'INDEX', move: 'OFFSET', axis: 'DIRECTION', none: 'CENTER' }
  };
  function T(k) { return (I18N[E.S.lang] || I18N.cn)[k] || k; }

  function setLang(lang) {
    E.S.lang = lang === 'en' ? 'en' : 'cn';
    try { if (window.localStorage) window.localStorage.setItem('dji-lang', E.S.lang); } catch (e) {}
    var b = byId('btn-lang');
    if (b) b.textContent = E.S.lang === 'en' ? '中' : 'EN';
    syncUI();
    E.parts.forEach(function (p, i) {
      var list = byId('parts-list');
      var li = list && list.children && list.children[i];
      if (!li || !li.querySelector) return;
      var meta = li.querySelector('.meta');
      if (!meta || !meta.children || meta.children.length < 2) return;
      meta.children[0].textContent = E.S.lang === 'en' ? (p.def.en || p.def.name) : p.def.name;
      meta.children[1].textContent = E.S.lang === 'en' ? p.def.tag : (p.def.en || '');
    });
    var bt = byId('btn-parts'), bd = byId('btn-detail');
    if (bt) bt.textContent = T('parts');
    if (bd) bd.textContent = T('detail');
    ['btn-rotate', 'btn-labels', 'btn-reset', 'btn-blueprint'].forEach(function (id, k) {
      var el = byId(id);
      if (el) el.textContent = T(['rotate', 'labels', 'reset', 'blueprint'][k]);
    });
    var tb = byId('btn-tour');
    if (tb) tb.textContent = E.S.tour ? T('tourEnd') : T('tour');
    var eb = byId('btn-explode');
    if (eb) eb.textContent = E.S.exploded ? T('collapse') : T('explode');
    var be = byId('btn-expand-all');
    if (be && be.getAttribute('data-keep') !== '1') {
      be.textContent = E.S.lang === 'en' ? 'EXPLODE / ASSEMBLE' : '一键拆解 / 合拢';
    }
    var pt = byId('panel-parts-title'), dt2 = byId('panel-detail-title');
    if (pt) pt.textContent = T('parts');
    if (dt2) dt2.textContent = T('detail');
  }

  /* =======================================================================
     6.10 程序化音乐（Web Audio，零外部音频文件）
     ======================================================================= */
  var AUDIO = null;
  function musicWanted() {
    try {
      if (window.localStorage) {
        var v = window.localStorage.getItem('dji-music');
        if (v === 'off') return false;
        if (v === 'on') return true;
      }
    } catch (e) { /* 无 localStorage 时看配置 */ }
    // 没有用户偏好时，由 dsh-startup.json 的 music 字段决定
    return !(E.S.startup && E.S.startup.music === false);
  }
  function musicSetPref(on) {
    try { if (window.localStorage) window.localStorage.setItem('dji-music', on ? 'on' : 'off'); } catch (e) {}
    var b = byId('btn-music');
    if (b) {
      b.classList.toggle('on', !!on);
      b.textContent = on ? '🔊' : '🔇';
      b.title = on ? '音乐：开' : '音乐：关';
    }
  }
  function musicStart(force) {
    if (AUDIO || (!force && !musicWanted())) return;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      var ctx = new AC();
      var master = ctx.createGain();
      master.gain.value = 0.0001;
      master.connect(ctx.destination);
      // 低频氛围：两个略微失谐的锯齿过缓慢律动的低通
      var lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 380; lp.Q.value = 0.7;
      lp.connect(master);
      [55, 55.45, 82.5].forEach(function (f, i) {
        var o = ctx.createOscillator();
        o.type = i === 2 ? 'triangle' : 'sawtooth';
        o.frequency.value = f;
        var g = ctx.createGain(); g.gain.value = i === 2 ? 0.10 : 0.16;
        o.connect(g); g.connect(lp); o.start();
      });
      var lfo = ctx.createOscillator(); lfo.frequency.value = 0.045;
      var lg = ctx.createGain(); lg.gain.value = 190;
      lfo.connect(lg); lg.connect(lp.frequency); lfo.start();
      // 空气噪声层
      var buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      var ch = buf.getChannelData(0);
      for (var i = 0; i < ch.length; i++) ch[i] = (Math.random() * 2 - 1) * 0.5;
      var ns = ctx.createBufferSource(); ns.buffer = buf; ns.loop = true;
      var bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 620; bp.Q.value = 0.6;
      var ng = ctx.createGain(); ng.gain.value = 0.028;
      ns.connect(bp); bp.connect(ng); ng.connect(master); ns.start();
      AUDIO = { ctx: ctx, master: master, on: false, chords: 0 };
      // 和弦垫：每 9 秒换一次，长起音长释放
      var PROG = [[110, 164.8, 220, 261.6], [87.3, 130.8, 174.6, 220], [130.8, 164.8, 196, 261.6],
                  [98, 146.8, 196, 246.9]];
      function chord() {
        if (!AUDIO || !AUDIO.on) return;
        var f = PROG[AUDIO.chords++ % PROG.length];
        var now = ctx.currentTime;
        f.forEach(function (fr, k) {
          var o = ctx.createOscillator();
          o.type = k === 0 ? 'triangle' : 'sine';
          o.frequency.value = fr;
          var g = ctx.createGain();
          g.gain.setValueAtTime(0.0001, now);
          g.gain.linearRampToValueAtTime(k === 0 ? 0.055 : 0.032, now + 3.2);
          g.gain.linearRampToValueAtTime(0.0001, now + 9.2);
          o.connect(g); g.connect(master);
          o.start(now); o.stop(now + 9.6);
        });
      }
      // 雷达脉冲
      function ping() {
        if (!AUDIO || !AUDIO.on) return;
        var now = ctx.currentTime;
        var o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 1180;
        var g = ctx.createGain();
        g.gain.setValueAtTime(0.05, now);
        g.gain.exponentialRampToValueAtTime(0.0001, now + 0.42);
        o.connect(g); g.connect(master); o.start(now); o.stop(now + 0.5);
      }
      AUDIO.timers = [setInterval(chord, 9000), setInterval(ping, 2000)];
      musicToggle(true);
      chord();
    } catch (e) {
      console.warn('[audio] 初始化失败：', e && e.message);
      AUDIO = null;
    }
  }
  function musicToggle(on) {
    if (!AUDIO) {
      if (on) musicStart(true);
      musicSetPref(on);
      return;
    }
    try {
      AUDIO.on = !!on;
      var t = AUDIO.ctx.currentTime;
      AUDIO.master.gain.cancelScheduledValues(t);
      AUDIO.master.gain.setValueAtTime(Math.max(AUDIO.master.gain.value, 0.0001), t);
      AUDIO.master.gain.linearRampToValueAtTime(on ? 0.12 : 0.0001, t + (on ? 2.2 : 0.8));
      if (on && AUDIO.ctx.state === 'suspended') AUDIO.ctx.resume();
    } catch (e) { /* 忽略 */ }
    musicSetPref(on);
  }
  function musicClick() {
    var cur = !!(AUDIO && AUDIO.on);
    if (!AUDIO && musicWanted()) { musicStart(true); return; }
    musicToggle(!cur);
  }

  /* =======================================================================
     6.11 展台外壳：返回键 / 启动动画 / 镜头飞入
     ======================================================================= */
  /* =======================================================================
     6.13 启动配置：dsh-startup.json（http）→ dsh-startup.js（file://）→ 内置默认
     ======================================================================= */
  var STARTUP = null;
  function startupDefaults() {
    var M = E.model || {};
    return {
      brand: 'UNMANNED SYSTEM LAB',
      kicker: 'STRUCTURE SCAN · SELF-TEST',
      title: M.title || '无人系统可视化',
      subtitle: M.subtitle || '',
      tagline: (M.groups && M.groups.length) ? M.groups.join(' · ') : '',
      accent: '#e8722a',
      accent2: '#4fd6e8',
      autoEnterMs: 7000,
      music: true,
      scanOnEnter: true,
      tips: ['T 演示巡航', 'B 技术图纸', 'U 中英切换', 'F 模拟飞行', 'S 状态自检'],
      bootLines: ['INITIALISING AIRFRAME', 'LOADING PROCEDURAL GEOMETRY',
        'CALIBRATING SENSORS', 'LINK ESTABLISHED', 'READY']
    };
  }
  function mergeStartup(cfg) {
    var d = startupDefaults();
    if (!cfg || typeof cfg !== 'object') return d;
    Object.keys(cfg).forEach(function (k) { if (cfg[k] !== undefined && cfg[k] !== null) d[k] = cfg[k]; });
    return d;
  }
  function loadStartup(done) {
    var finished = false;
    function ok(cfg) { if (finished) return; finished = true; done(mergeStartup(cfg)); }
    if (window.DSH_STARTUP) return ok(window.DSH_STARTUP);
    try {
      if (typeof fetch === 'function' && window.location && /^https?:/.test(window.location.protocol)) {
        fetch('dsh-startup.json', { cache: 'no-store' }).then(function (r) {
          return r.ok ? r.json() : null;
        }).then(function (j) { ok(j); }).catch(function () { ok(null); });
        setTimeout(function () { ok(null); }, 1200);
        return;
      }
    } catch (e) { /* 继续走脚本回退 */ }
    // file:// 下 fetch/XHR 会被浏览器拦，改为动态脚本回退（存在就生效）
    try {
      var sc = document.createElement('script');
      sc.src = 'dsh-startup.js';
      sc.onload = function () { ok(window.DSH_STARTUP); };
      sc.onerror = function () { ok(null); };
      (document.head || document.body || {}).appendChild(sc);
      setTimeout(function () { ok(null); }, 1200);
    } catch (e2) { ok(null); }
  }

  function buildStageShell() {
    var body = document.body || document.documentElement;
    var M = E.model || {};
    // 暗角
    if (!byId('stage-vig') && body && body.appendChild) {
      var vig = document.createElement('div');
      vig.id = 'stage-vig';
      body.appendChild(vig);
    }
    // 返回展台
    var back = null;
    try {
      back = byId('btn-back');
      if (!back && document.createElement) {
        // 放进顶栏按钮组（顶栏左侧是品牌 Logo，固定定位会压住它）
        var backBox = null;
        try { backBox = document.querySelector ? document.querySelector('.actions') : null; } catch (eb) { backBox = null; }
        if (backBox && backBox.appendChild) {
          back = document.createElement('a');
          back.id = 'btn-back'; back.className = 'btn stage-back-inline';
          back.href = M.backUrl || '../dji-hub/index.html';
          back.innerHTML = '← <span>返回展台</span>';
          back.title = '返回作品展台 / Back to hub';
          if (backBox.firstChild) backBox.insertBefore(back, backBox.firstChild);
          else backBox.appendChild(back);
        }
      }
    } catch (e1) { /* 忽略 */ }
    E.stage = { back: back };
    // 音乐按钮
    ensureBtn('btn-music', musicWanted() ? '🔊' : '🔇');
    musicSetPref(musicWanted());
    on('btn-music', musicClick);
    // 启动动画
    var intro = byId('stage-intro');
    if (!intro && body && body.appendChild) {
      intro = document.createElement('div');
      intro.id = 'stage-intro';
      intro.innerHTML =
        '<div class="intro-inner">' +
        '<div class="intro-rotor"><i></i><i></i><b></b></div>' +
        '<div class="intro-k" id="intro-kicker">UNMANNED SYSTEM · SHOWCASE</div>' +
        '<h1 id="intro-title">' + (M.title || '无人系统可视化') + '</h1>' +
        '<p class="sub" id="intro-sub">' + (M.subtitle || '') + '</p>' +
        '<div class="intro-log" id="intro-log"></div>' +
        '<div class="intro-bar"><i></i></div>' +
        '<button id="btn-enter">▶ 进入 / ENTER</button>' +
        '<div class="intro-hint" id="intro-hint"></div>' +
        '</div>';
      body.appendChild(intro);
      E.stage.intro = intro;

      // 兜底：7 秒无人操作也进入（不播音乐，浏览器需要手势）
      E.stage.autoTimer = setTimeout(function () { enterStage(true); }, 7000);
    } else if (!intro) {
      enterStage(true);   // 没有 DOM 环境（测试桩）时直接完成进入，保证相机回到正常机位
    }
    var ent = byId('btn-enter');
    if (ent && ent.addEventListener) ent.addEventListener('click', function () { enterStage(); });
    // 底部快捷键提示条补上引擎新增键位
    try {
      var hint = document.querySelector ? document.querySelector('.hint') : null;
      if (hint && hint.appendChild && document.createElement && !byId('hint-extra')) {
        var wrap = document.createElement('span');
        wrap.id = 'hint-extra';
        wrap.innerHTML = '<kbd>T</kbd>演示巡航 <kbd>B</kbd>技术图纸 <kbd>U</kbd>中英 ' +
          (isAerial() ? '<kbd>F</kbd>模拟飞行 ' : '') + '<kbd>S</kbd>状态自检';
        hint.appendChild(wrap);
      }
    } catch (e11) { /* 忽略 */ }

    // 配置：先用内置默认渲染，再异步加载 dsh-startup.json / .js 覆盖
    applyStartup(startupDefaults());
    loadStartup(function (cfg) { try { applyStartup(cfg); } catch (e10) {} });

    // 镜头飞入预备：先把相机拉远
    var sc = E.cfg.scene;
    E.orbit.userRadius = clamp(sc.radius * 2.35, E.orbit.minRadius, E.orbit.maxRadius);
    E.orbit.radius = E.orbit.userRadius;
    E.introFly = null;
  }

  function applyStartup(cfg) {
    E.S.startup = cfg;
    if (!cfg) return;
    var root = byId('stage-intro');
    if (root && root.style && root.style.setProperty) {
      root.style.setProperty('--intro-accent', cfg.accent || '#e8722a');
      root.style.setProperty('--intro-accent2', cfg.accent2 || '#4fd6e8');
    }
    var k = byId('intro-kicker'), t = byId('intro-title'), sub = byId('intro-sub'), hint = byId('intro-hint');
    if (k && cfg.kicker) k.textContent = cfg.kicker;
    if (t && cfg.title) t.textContent = cfg.title;
    if (sub && cfg.subtitle) sub.textContent = cfg.subtitle;
    if (hint) {
      hint.innerHTML = (cfg.tips || []).map(function (x) {
        var parts = String(x).split(' ');
        return parts.length > 1 ? ('<kbd>' + parts[0] + '</kbd> ' + parts.slice(1).join(' '))
                                : ('<kbd>' + x + '</kbd>');
      }).join(' &nbsp;·&nbsp; ');
    }
    playBootLog(cfg.bootLines || []);
  }

  function playBootLog(lines) {
    var box = byId('intro-log');
    if (!box || !box.appendChild || !document.createElement) return;
    if (E.stage && E.stage.logTimer) clearInterval(E.stage.logTimer);
    box.innerHTML = '';
    var i = 0;
    E.stage = E.stage || {};
    E.stage.logTimer = setInterval(function () {
      if (i >= lines.length || E.S.intro === false) {
        clearInterval(E.stage.logTimer);
        return;
      }
      var row = document.createElement('div');
      row.className = 'log-row';
      row.innerHTML = '<i>✓</i><span>' + lines[i] + '</span>';
      box.appendChild(row);
      setTimeout(function () { row.classList.add('in'); }, 16);
      i++;
    }, 360);
  }

  function enterStage(auto) {
    if (E.S.intro === false) return;
    E.S.intro = false;
    try { if (E.stage && E.stage.autoTimer) clearTimeout(E.stage.autoTimer); } catch (e) {}
    var intro = byId('stage-intro');
    if (intro && intro.classList) {
      intro.classList.add('hide');
      setTimeout(function () { if (intro.parentNode) intro.parentNode.removeChild(intro); }, 900);
    }
    if (!auto) musicStart();
    var sc2 = E.S.startup || startupDefaults();
    if (sc2.scanOnEnter !== false) {
      setTimeout(function () { try { startScan(); } catch (e9) {} }, 2100);
    }
    E.introFly = { t: 0, dur: 2.1, from: E.orbit.userRadius, to: E.cfg.scene.radius };
  }

  function updateIntroFly(dt) {
    if (!E.introFly) return;
    var f = E.introFly;
    f.t = Math.min(f.dur, f.t + dt);
    var k = f.t / f.dur;
    var e = 1 - Math.pow(1 - k, 3);                       // easeOutCubic
    E.orbit.userRadius = f.from + (f.to - f.from) * e;
    E.orbit.radius = Math.max(E.orbit.radius, E.orbit.userRadius * 0.999);
    if (f.t >= f.dur) E.introFly = null;
  }

  function toggleFly() {
    if (!isAerial()) return;
    E.S.fly = !E.S.fly;
    var b = byId('btn-fly');
    if (b) {
      b.classList.toggle('on', E.S.fly);
      b.textContent = E.S.lang === 'en' ? (E.S.fly ? 'HOVER FLIGHT' : 'STATIC') : (E.S.fly ? '模拟飞行' : '静态展示');
    }
    if (!E.S.fly && E.root) E.root.rotation.set(0, 0, 0);
  }

  /* =======================================================================
     6.12 展示级动态：模拟飞行 / 航行灯与防撞灯 / 雷达自检扫描
     ======================================================================= */
  function isAerial() { return !(E.model && E.model.aerial === false); }

  function modelSpan() {
    if (E.S._span) return E.S._span;
    var v = 10;
    try {
      var bb = new THREE.Box3().setFromObject(E.root);
      var sz = bb.getSize(new THREE.Vector3());
      v = Math.max(sz.x, sz.y, sz.z) || 10;
    } catch (e) { v = 10; }
    E.S._span = v;
    return v;
  }

  /* 模拟飞行：低频漂移 + 轻微俯仰滚转 + 缓慢偏航（在行为层之前执行，
     行为层一旦自己写 root.position 就会自然接管，不会互相打架）*/
  function updateShowcaseMotion(dt) {
    if (!E.root) return;
    var M = E.model || {};
    var t = E.S.elapsed;
    var span = modelSpan();
    var amp = (M.hoverAmp !== undefined ? M.hoverAmp : 0.045) * span;
    var lift = (M.flyLift !== undefined ? M.flyLift : 0.055) * span;
    if (E.S.fly === false) {
      E.root.position.y = Math.sin(t * 0.55) * 0.02 * span;
      E.root.rotation.set(0, 0, 0);
      return;
    }
    if (E.behavior && E.behavior.movesRoot) {
      // 行为层按帧累积机体位移（物流吊运），这里**绝对不能写 position**——
      // 每帧 set/覆盖会把行为层累积的位移擦掉，机体永远飞不到目标点。
      // 只给一点姿态呼吸感，位移交给行为层。
      var wob = 0.012 * amp * 8;
      E.root.rotation.set(Math.sin(t * 0.47) * wob, Math.sin(t * 0.19) * wob * 2.2,
        Math.sin(t * 0.39) * wob);
      return;
    }
    var x = Math.sin(t * 0.21) * amp + Math.sin(t * 0.083) * amp * 0.35;
    var z = Math.cos(t * 0.166) * amp * 0.82 + Math.sin(t * 0.121) * amp * 0.3;
    var y = lift + Math.sin(t * 0.62) * lift * 0.14 + Math.sin(t * 0.27) * lift * 0.06;
    // 速度 → 姿态：向运动方向压坡，像真的在飞
    var vx = Math.cos(t * 0.21) * 0.21 + Math.cos(t * 0.083) * 0.083 * 0.35;
    var vz = -Math.sin(t * 0.166) * 0.166 * 0.82 + Math.cos(t * 0.121) * 0.121 * 0.3;
    var bank = clamp(-vx * amp * 2.6, -0.16, 0.16);
    var pitch = clamp(vz * amp * 2.2, -0.14, 0.14);
    var yaw = Math.sin(t * 0.085) * 0.30 + Math.sin(t * 0.037) * 0.12;
    E.root.position.set(x, y, z);
    E.root.rotation.set(pitch, yaw, bank);
    E.S.airborne = y > 0.01;
  }

  /* ---- 航行灯 / 防撞灯 ---- */
  function navLightMats() {
    function m(color, inten) {
      var mat = new THREE.MeshStandardMaterial({
        color: color, emissive: color, emissiveIntensity: inten,
        roughness: 0.4, metalness: 0.0
      });
      mat.toneMapped = false;
      return mat;
    }
    return {
      red: m(0xff2b1e, 2.6), green: m(0x2bff8a, 2.4),
      white: m(0xeaf6ff, 2.8), amber: m(0xffa21f, 2.2)
    };
  }

  function buildNavLights() {
    var M = E.model || {};
    if (M.aerial === false) return;
    var rotors = E.parts.filter(function (p) { return p.def.spin; });
    if (rotors.length < 2) return;              // 没有旋翼的机型不冒充飞行器
    var span = modelSpan();
    var r = Math.max(0.004 * span, 0.5);
    var mats = navLightMats();
    var geo = new THREE.SphereGeometry(r, 12, 10);
    var grp = new THREE.Group();
    grp.userData.noPick = true;
    var lights = [];
    // 旋翼位置 → 按方位角分出左红 / 右绿
    var hubs = rotors.map(function (p) {
      var v = new THREE.Vector3();
      p.group.getWorldPosition(v);
      return v;
    });
    var sorted = hubs.slice().sort(function (a, b) { return a.x - b.x; });
    var left = sorted[0], right = sorted[sorted.length - 1];
    function add(pos, key, kind) {
      var mesh = new THREE.Mesh(geo, mats[key]);
      mesh.position.copy(pos);
      grp.add(mesh);
      var halo = new THREE.Mesh(new THREE.CircleGeometry(r * 3.4, 20),
        new THREE.MeshBasicMaterial({ color: mats[key].emissive.getHex(), transparent: true,
          opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false }));
      halo.userData.noPick = true;
      halo.position.copy(pos);
      grp.add(halo);
      lights.push({ mesh: mesh, halo: halo, kind: kind, base: mats[key].emissiveIntensity });
    }
    // 灯一律"半嵌"进表面，看起来是装在蒙皮上的灯罩，而不是悬浮的球。
    // 注意：机体包围盒要**排除旋翼**，否则"顶部"会变成桨盘高度，灯会飘在机身之上。
    var bb = new THREE.Box3();
    E.parts.forEach(function (p) {
      if (p.def.spin) return;
      p.meshes.forEach(function (m) {
        if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
        var q = m.geometry.boundingBox.clone();
        m.updateWorldMatrix(true, false);
        q.applyMatrix4(m.matrixWorld);
        bb.union(q);
      });
    });
    if (bb.isEmpty()) bb.setFromObject(E.root);
    var cx = (bb.min.x + bb.max.x) / 2, cz = (bb.min.z + bb.max.z) / 2;
    var dy = (bb.max.z - bb.min.z) * 0.26;
    add(new THREE.Vector3(left.x, left.y + r * 0.25, left.z), 'red', 'nav');
    add(new THREE.Vector3(right.x, right.y + r * 0.25, right.z), 'green', 'nav');
    add(new THREE.Vector3(cx, bb.max.y + r * 0.35, cz - dy), 'white', 'beacon');
    add(new THREE.Vector3(cx, bb.max.y + r * 0.30, cz + dy), 'red', 'strobe');
    add(new THREE.Vector3(cx, bb.min.y - r * 0.30, cz), 'amber', 'beacon');
    E.root.add(grp);
    E.navLights = { group: grp, lights: lights, mats: mats };
  }

  function updateNavLights(dt) {
    var N = E.navLights;
    if (!N) return;
    var t = E.S.elapsed;
    // 防撞灯：航空式双闪（亮 70ms 灭 130ms 亮 70ms 灭 1s）
    var ph = t % 1.35;
    var strobe = (ph < 0.07 || (ph > 0.20 && ph < 0.27)) ? 1 : 0;
    var beacon = (t % 1.7) < 0.09 ? 1 : 0;
    var nav = 0.72 + Math.sin(t * 2.2) * 0.16;
    for (var i = 0; i < N.lights.length; i++) {
      var L = N.lights[i];
      var k = L.kind === 'strobe' ? strobe : (L.kind === 'beacon' ? beacon : nav);
      var m = L.mesh.material;
      m.emissiveIntensity = L.base * (0.25 + k * 1.15);
      L.halo.material.opacity = k * 0.5;
    }
  }

  /* ---- 雷达自检扫描：从顶部降下一道光环扫过整机，逐部件点亮 ---- */
  function buildScanFX() {
    var span = modelSpan();
    var grp = new THREE.Group();
    grp.userData.noPick = true;
    grp.visible = false;
    var mkRing = function (r, tube, op) {
      var mm = new THREE.Mesh(new THREE.TorusGeometry(r, tube, 6, 96),
        new THREE.MeshBasicMaterial({ color: 0x66e6ff, transparent: true, opacity: op,
          blending: THREE.AdditiveBlending, depthWrite: false }));
      mm.userData.noPick = true;
      return mm;
    };
    var ring = mkRing(span * 0.44, span * 0.004, 0.85);
    ring.rotation.x = Math.PI / 2;
    var ring2 = mkRing(span * 0.30, span * 0.003, 0.5);
    ring2.rotation.x = Math.PI / 2;
    var disc = new THREE.Mesh(new THREE.CircleGeometry(span * 0.46, 72),
      new THREE.MeshBasicMaterial({ color: 0x2ad6ff, transparent: true, opacity: 0.10,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    disc.rotation.x = -Math.PI / 2;
    disc.userData.noPick = true;
    grp.add(ring); grp.add(ring2); grp.add(disc);
    E.scene.add(grp);
    E.scan = { group: grp, ring: ring, ring2: ring2, disc: disc, t: -1, dur: 4.6, pings: [] };
  }

  function startScan() {
    if (!E.scan) return;
    E.scan.t = 0;
    E.scan.group.visible = true;
    E.scan.parts = E.parts.map(function (p) {
      var v = new THREE.Vector3();
      try { p.group.getWorldPosition(v); } catch (e) { v.set(0, 0, 0); }
      return { p: p, y: v.y, done: false };
    });
    E.S.scanning = true;
    E.S.scanPhase = 0;
    var panel = byId('selftest');
    if (panel && panel.classList) panel.classList.add('on');
    setStatus('结构扫描中 · STRUCTURE SCAN', true);
  }

  function updateScan(dt) {
    var S = E.scan;
    if (!S || S.t < 0) return;
    var span = modelSpan();
    S.t += dt;
    var k = clamp(S.t / S.dur, 0, 1);
    var e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    var bb = new THREE.Box3().setFromObject(E.root);
    var y0 = bb.max.y + span * 0.34, y1 = bb.min.y - span * 0.12;
    var y = y0 + (y1 - y0) * e;
    S.group.position.set(E.root.position.x, y, E.root.position.z);
    S.ring.rotation.z += dt * 1.4;
    S.ring2.rotation.z -= dt * 2.1;
    S.ring.material.opacity = 0.55 + Math.sin(S.t * 9) * 0.25;
    S.disc.material.opacity = 0.06 + Math.sin(S.t * 6) * 0.04 + 0.04;
    // 部件被扫到 → 冒一圈 ping（不改材质，避免和拆解高亮打架）
    S.parts.forEach(function (r) {
      if (r.done || Math.abs(r.y - y) > span * 0.035) return;
      r.done = true;
    });
    // 扫描进度写进面板（DOM 不存在时也把计数记在状态里，便于自动化验证）
    var rows = byId('selftest-list');
    var n = rows && rows.children ? rows.children.length : 0;
    if (!n) n = (E.S.startup && E.S.startup.bootLines ? 5 : 5);
    var upto = Math.max(0, Math.floor(k * n));
    E.S.scanTicked = upto;
    if (rows && rows.children) {
      for (var i = 0; i < rows.children.length; i++) {
        if (i < upto) rows.children[i].classList.add('ok');
      }
    }
    E.S.scanProgress = k;
    if (k >= 1) {
      S.t = -1;
      S.group.visible = false;
      E.S.scanning = false;
      setStatus('自检完成 · 全系统状态正常 / ALL SYSTEMS NOMINAL', false);
      var panel = byId('selftest');
      if (panel && panel.classList) panel.classList.remove('on');
    }
  }

  /* ---- 悬停洗流环（地面）+ 机腹光池 ---- */
  function buildDownwash() {
    if (!isAerial()) return;            // 相机没有桨，不该有桨下洗流环
    var span = modelSpan();
    var grp = new THREE.Group();
    grp.userData.noPick = true;
    var ring = new THREE.Mesh(new THREE.RingGeometry(span * 0.24, span * 0.40, 96),
      new THREE.MeshBasicMaterial({ color: 0x6fe6ff, transparent: true, opacity: 0.10,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = (E.scene.floorY || 0) + 0.06;
    ring.userData.noPick = true;
    var pool = new THREE.Mesh(new THREE.CircleGeometry(span * 0.30, 64),
      new THREE.MeshBasicMaterial({ color: 0x8fd8ff, transparent: true, opacity: 0.055,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    pool.rotation.x = -Math.PI / 2;
    pool.position.y = (E.scene.floorY || 0) + 0.04;
    pool.userData.noPick = true;
    grp.add(ring); grp.add(pool);
    E.scene.add(grp);
    E.downwash = { group: grp, ring: ring, pool: pool, t: 0 };
  }

  function updateDownwash(dt) {
    var D = E.downwash;
    if (!D) return;
    D.t += dt;
    var x = E.root ? E.root.position.x : 0;
    var z = E.root ? E.root.position.z : 0;
    D.group.position.set(x, 0, z);
    D.ring.rotation.z += dt * 0.5;
    var sp = (E.S.spinRate === undefined ? 1 : E.S.spinRate);
    // 离地越高越淡：机体悬在起降平台上方时，地面洗流环不该"浮"在平台上面
    var span2 = modelSpan();
    var bb2 = new THREE.Box3().setFromObject(E.root);
    var h = Math.max(0, bb2.min.y - (E.scene.floorY || 0));
    var fade = clamp(1 - h / (span2 * 0.6), 0.08, 1);
    D.ring.material.opacity = (0.05 + sp * (0.07 + Math.sin(D.t * 2.4) * 0.03)) * fade;
    D.pool.material.opacity = (0.03 + sp * (0.035 + Math.sin(D.t * 1.7) * 0.015)) * fade;
    var s = 1 + Math.sin(D.t * 2.4) * 0.03;
    D.ring.scale.set(s, s, 1);
  }

  /* ---- 自检面板（引擎注入 DOM） ---- */
  function buildSelfTestPanel() {
    var body = document.body;
    if (!body || !body.appendChild || byId('selftest')) return;
    var M = E.model || {};
    var list = (M.selfTest && M.selfTest.length ? M.selfTest : [
      ['结构完整性', 'STRUCTURE'], ['动力系统', 'PROPULSION'], ['能源与配电', 'POWER'],
      ['航电与导航', 'AVIONICS'], ['任务载荷', 'PAYLOAD']
    ]);
    var el = document.createElement('div');
    el.id = 'selftest';
    el.className = 'selftest-panel';
    el.innerHTML = '<div class="st-head"><b>STATUS · 自检</b><span>SCAN</span></div>' +
      '<ul id="selftest-list">' + list.map(function (r) {
        return '<li><i></i><span>' + r[0] + '</span><em>' + (r[1] || '') + '</em></li>';
      }).join('') + '</ul>';
    body.appendChild(el);
  }

  function setStatus(text, busy) {
    if (E.behavior && E.behavior.status) { try { E.behavior.status(text, busy); return; } catch (e) {} }
    var el = byId('m-status');
    if (!el && document.body && document.body.appendChild && document.createElement) {
      el = document.createElement('div');
      el.id = 'm-status'; el.className = 'statusline';
      document.body.appendChild(el);
    }
    if (el) {
      el.textContent = text;
      if (el.classList) el.classList.toggle('busy', !!busy);
    }
    E.S.stageStatus = text;
  }

  function onResize() {
    if (!E.renderer) return;
    var w = window.innerWidth, h = window.innerHeight;
    E.camera.aspect = w / h;
    E.camera.updateProjectionMatrix();
    E.renderer.setSize(w, h);
    E.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    resizePost();
  }

  function animate() {
    requestAnimationFrame(animate);
    var dt = Math.min(E.clock.getDelta(), 0.05);
    E.S.elapsed += dt;

    var targetT = E.S.exploded ? 1 : 0;
    E.S.explodeT = lerp(E.S.explodeT, targetT, 1 - Math.exp(-dt * 2.3));
    if (Math.abs(E.S.explodeT - targetT) < 0.0015) E.S.explodeT = targetT;

    updateParts(dt);
    updateSpinners(dt);
    E.orbit.update(dt, E.S.explodeT * E.cfg.scene.zoomBias, E.S.explodeT * E.cfg.scene.phiBias);
    // 受击抖动（只偏移本帧，下一帧会由 orbit 重新计算）
    if (E.S.shake > 0.001) {
      var sh = E.S.shake;
      E.camera.position.x += (Math.random() - 0.5) * sh * 0.55;
      E.camera.position.y += (Math.random() - 0.5) * sh * 0.55;
      E.camera.position.z += (Math.random() - 0.5) * sh * 0.55;
    }

    // 相机矩阵要在投影前刷新，否则标注/锁定框慢一帧
    E.camera.updateMatrixWorld();
    E.camera.matrixWorldInverse.copy(E.camera.matrixWorld).invert();

    // 环境动效 + 展示级动态（模拟飞行必须在行为层之前，行为层可自然接管）
    updateShowcaseMotion(dt);
    if (E.hud.ringA) E.hud.ringA.rotation.z += dt * 0.06;
    if (E.hud.ringB) E.hud.ringB.rotation.z -= dt * 0.045;
    if (E.hud.stars) E.hud.stars.rotation.y += dt * 0.012;
    if (E.hud.sweep) {
      E.hud.sweep.rotation.y += dt * 0.85;
      E.S.sweepAngle = E.hud.sweep.rotation.y;
    }
    if (E.hud.scanRing) {
      E.hud.scanT = ((E.hud.scanT || 0) + dt * 0.32) % 2;
      var k = E.hud.scanT < 1 ? E.hud.scanT : 2 - E.hud.scanT;
      var e2 = k * k * (3 - 2 * k);
      E.hud.scanRing.position.y = -3.4 + e2 * 6.6;
      E.hud.scanRing.material.opacity = 0.3 * Math.sin(Math.PI * clamp(k, 0, 1)) + 0.05;
      E.hud.scanRing.rotation.z += dt * 0.25;
    }

    E.scene.updateMatrixWorld();
    E.hud.shadowTick = (E.hud.shadowTick || 0) + 1;
    if (E.hud.shadowTick % 3 === 0) E.renderer.shadowMap.needsUpdate = true;
    if (E.behavior && E.behavior.update) E.behavior.update(dt, E);
    updateNavLights(dt);
    updateScan(dt);
    updateDownwash(dt);
    updateIntroFly(dt);
    updateTour(dt);
    updateLabels();
    updateHud(dt);

    renderFrame();
  }

  /* =======================================================================
     7. 启动
     ======================================================================= */
  function init(cfg) {
    E.cfg = cfg;
    E.model = cfg.model;
    E.behavior = cfg.behavior || null;
    /* 场景参数默认值 + 机型覆盖。机型把参数放在 model.scene，
       这里必须合并，否则 theta/phi/radius/zoomBias 会是 undefined → 相机 NaN → 整屏空白 */
    var SCENE_DEFAULTS = {
      rootScale: 0.5, floorY: -4.6, theta: 0.62, phi: 1.06, radius: 26,
      zoomBias: 4.2, phiBias: 0.16, minRadius: 12, maxRadius: 62,
      fog: 0.009, gridSize: 140, gridDiv: 70, ringR: 9, shadowR: 22,
      keyLight: [9, 16, 12], targetY: 0
    };
    var sc = {};
    var rawSc = cfg.scene || (cfg.model && cfg.model.scene) || {};
    Object.keys(SCENE_DEFAULTS).forEach(function (k) {
      sc[k] = (rawSc[k] !== undefined) ? rawSc[k] : SCENE_DEFAULTS[k];
    });
    E.cfg.scene = sc;
    E.ROOT_SCALE = sc.rootScale;
    E.FLOOR_Y = sc.floorY;

    buildTextures();
    E.tmp.v = new THREE.Vector3();
    /* 用现代色彩管理：否则材质 hex 会被当成线性值，整机颜色发白失真 */
    if (THREE.ColorManagement && 'legacyMode' in THREE.ColorManagement) {
      THREE.ColorManagement.legacyMode = false;
    }
    // 把 THREE / TEX 注入 helpers，供 enemies.js 等模块使用（模块顶层不能碰 THREE）
    window.DJIEngine.helpers.THREE = THREE;
    window.DJIEngine.helpers.TEX = TEX;

    var stage = document.getElementById('stage');
    E.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    E.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    E.renderer.setSize(window.innerWidth, window.innerHeight);
    E.renderer.outputEncoding = THREE.sRGBEncoding;
    E.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    E.renderer.toneMappingExposure = 1.08;
    E.renderer.shadowMap.enabled = true;
    E.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    E.renderer.shadowMap.autoUpdate = false;   // 每 3 帧手动刷一次：省掉 2/3 的阴影渲染开销
    stage.appendChild(E.renderer.domElement);

    E.scene = new THREE.Scene();
    E.scene.fog = new THREE.FogExp2(0x05080d, sc.fog);
    E.camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.05, 700);

    var bgTex = makeTex(32, 512, function (g, w, h) {
      var grd = g.createLinearGradient(0, 0, 0, h);
      grd.addColorStop(0, '#0a1410'); grd.addColorStop(0.45, '#070c10'); grd.addColorStop(1, '#03050a');
      g.fillStyle = grd; g.fillRect(0, 0, w, h);
    });
    E.scene.background = bgTex;

    var pmrem = new THREE.PMREMGenerator(E.renderer);
    pmrem.compileEquirectangularShader();
    E.scene.environment = pmrem.fromEquirectangular(TEX.env).texture;
    pmrem.dispose();

    var viewCfg = {
      keyLight: sc.keyLight,
      shadowR: sc.shadowR,
      gridSize: sc.gridSize,
      gridDiv: sc.gridDiv,
      ringR: sc.ringR
    };
    buildLights(viewCfg);
    buildFloor(viewCfg);

    // 模型
    var H = {
      THREE: THREE, std: std, box: box, cyl: cyl, cylZ: cylZ, roundedBox: roundedBox,
      ringParts: ringParts, loftGeo: loftGeo, bladeGeo: bladeGeo, addMesh: addMesh,
      placeAlong: placeAlong, makeTex: makeTex, TEX: TEX,
      sectionArc: sectionArc, rand: rand, lerp: lerp, clamp: clamp,
      matte: matte, metal: metal, carbon: carbon, painted: painted,
      glass: glass, emissiveMat: emissiveMat
    };
    E.root = new THREE.Group();
    E.root.scale.setScalar(E.ROOT_SCALE);
    E.scene.add(E.root);
    // 机型可以给静态 builder 对象，也可以给 builderFactory(H) —— 后者让"自带几何与
    // 贴图"的老模型用闭包别名注入引擎 helper，无需逐函数改写原建模代码。
    var builder = E.model.builder || (E.model.builderFactory ? E.model.builderFactory(H) : null);
    if (!builder) throw new Error('机型模块缺少 builder / builderFactory');
    E.model.parts.forEach(function (def, i) {
      var p = createPart(def, i, builder, H);
      E.root.add(p.group);
      E.parts.push(p);
      E.partById[def.id] = p;
      E.pickables = E.pickables.concat(p.meshes);
    });
    E.S.explodeT = 0;

    E.raycaster = new THREE.Raycaster();
    E.pointerNDC = new THREE.Vector2();
    E.orbit = new Orbit(E.camera, E.renderer.domElement, {
      theta: sc.theta, phi: sc.phi, radius: sc.radius, targetY: sc.targetY,
      minRadius: sc.minRadius, maxRadius: sc.maxRadius
    });
    E.orbit.onAutoRotate = function (v) { setAutoRotate(v); };

    buildLabels();
    buildHud();
    buildUI();
    if (E.behavior && E.behavior.init) E.behavior.init(E);
    // 展示级特效（构造失败绝不影响主流程）
    try { buildSelfTestPanel(); } catch (e5) { console.warn('[stage] 自检面板：', e5 && e5.message); }
    try { buildNavLights(); } catch (e6) { console.warn('[stage] 航行灯：', e6 && e6.message); }
    try { buildScanFX(); } catch (e7) { console.warn('[stage] 自检扫描：', e7 && e7.message); }
    try { buildDownwash(); } catch (e8) { console.warn('[stage] 洗流环：', e8 && e8.message); }
    E.S.scanTick = setInterval(function () {
      if (E.S.tour || E.S.scanning) return;
      startScan();
    }, 26000);
    E.orbit.onUserDrag = function () { if (E.S.tour) setTour(false); };

    // 后期处理：可用则接管渲染（关闭渲染器自带 tonemapping/编码，由合成着色器统一处理）
    E.post = initPost();
    if (E.post) {
      E.renderer.toneMapping = THREE.NoToneMapping;
      E.renderer.outputEncoding = THREE.LinearEncoding;
    } else {
      E.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      E.renderer.toneMappingExposure = 1.08;
      E.renderer.outputEncoding = THREE.sRGBEncoding;
    }
    // 语言偏好
    try {
      var savedLang = window.localStorage && window.localStorage.getItem('dji-lang');
      if (savedLang) setLang(savedLang);
    } catch (e2) { /* 忽略 */ }

    E.clock = new THREE.Clock();
    window.addEventListener('resize', onResize);
    onResize();
    animate();

    if (window.__djiBooted) window.__djiBooted();
    // URL 参数：?mode=explode / ?mode=tour / ?mode=blueprint（门户站与展台演示用）
    try {
      var q = (window.location && window.location.search) || '';
      var mm = /[?&]mode=([a-zA-Z]+)/.exec(q);
      if (mm) { try { enterStage(true); } catch (e0) {} }
      if (mm && mm[1] === 'explode') setTimeout(function () { E.S.exploded = true; syncUI(); }, 850);
      else if (mm && mm[1] === 'tour') setTimeout(function () { setTour(true); }, 700);
      else if (mm && mm[1] === 'blueprint') setTimeout(function () { setBlueprint(true); }, 700);
    } catch (e) { /* file:// 下取不到也无所谓 */ }
    // 启动遮罩必须在成功后隐藏并移除，否则会一直盖在已经跑起来的场景上面
    var boot = document.getElementById('boot');
    if (boot) {
      setTimeout(function () { boot.classList.add('hide'); }, 240);
      setTimeout(function () { if (boot.parentNode) boot.parentNode.removeChild(boot); }, 1100);
    }
    console.log('[D] ' + E.model.title + ' 构建完成 · build 2026-10-24c · 部件 ' + E.parts.length + ' 个');
  }

  /* =======================================================================
     8. bootstrap
     ======================================================================= */
  function boot(cfg) {
    bootText('正在加载 Three.js…');
    // 本地 vendor 优先：同一目录随仓库分发，零网络、离线可用、不受 CDN 可达性影响
    loadScript(LOCAL, 0)
      .then(function () { if (!window.THREE) throw new Error('本地 three.min.js 未提供 THREE'); })
      .catch(function (e) {
        // 本地缺失时才走 CDN，逐个尝试（前一个失败再试下一个）
        bootText('本地 three.min.js 不可用，尝试 CDN…');
        var i = 0;
        function tryNext() {
          if (i >= CDNS.length) throw new Error('所有 CDN 都不可用');
          var url = CDNS[i++];
          bootText('尝试 CDN：' + url.replace(/^https:\/\//, '').split('/')[0] + ' …');
          return loadScript(url, 3500).then(function () {
            if (!window.THREE) throw new Error('CDN 内容异常');
          }).catch(function () { return tryNext(); });
        }
        return tryNext();
      })
      .then(function () {
        if (!window.THREE) throw new Error('本地 three.min.js 未提供 THREE');
        bootText('正在构建模型与作战系统…');
        requestAnimationFrame(function () {
          try { init(cfg); } catch (err) {
            console.error(err);
            bootFail(String((err && err.message) || err));
          }
        });
      })
      .catch(function (e) { console.error(e); bootFail(String((e && e.message) || e)); });
  }

  window.DJIEngine = {
    boot: boot,
    E: E,
    helpers: {
      clamp: clamp, lerp: lerp, rand: rand, easeInOutCubic: easeInOutCubic,
      std: std, box: box, cyl: cyl, cylZ: cylZ, roundedBox: roundedBox, ringParts: ringParts,
      loftGeo: loftGeo, bladeGeo: bladeGeo, addMesh: addMesh, placeAlong: placeAlong,
      makeTex: makeTex, sectionArc: sectionArc,
      matte: matte, metal: metal, carbon: carbon, glass: glass, emissiveMat: emissiveMat,
      SPIN: { FWD: 1, REV: -1 }
    },
    /** 引擎给行为层用的快捷方法 */
    api: {
      flash: function (ms) {
        var f = E.hud.els.flash;
        if (!f) return;
        f.classList.add('on');
        clearTimeout(E.hud._flashTimer);
        E.hud._flashTimer = setTimeout(function () { f.classList.remove('on'); }, ms || 120);
      },
      setButton: function (id, label, on, cls) {
        var b = byId(id);
        if (!b) return;
        if (label !== null && label !== undefined) b.textContent = label;
        b.classList.toggle('on', !!on);
        if (cls) b.className = 'btn ' + cls + (on ? ' on' : '');
      },
      toggleClass: function (el, cls, on) { if (el) el.classList.toggle(cls, !!on); },
      byId: byId,
      THREE: function () { return THREE; }
    }
  };

  /* 页面装配：机型模块与行为模块自己注册到 window.DJIPage，引擎保持与机型无关。
   加载顺序（都是 defer，按文档顺序执行）：enemies/casualties → model-* → behavior → engine */
  (function () {
    var page = window.DJIPage || {};
    var model = page.model || window.DJIModel || null;
    var behavior = page.behavior || null;
    if (model) {
      boot({ model: model, behavior: behavior });
    } else if (typeof document !== 'undefined' && document.getElementById) {
      bootFail('未找到机型模块（model-*.js 需先于 engine.js 加载，并把自身注册到 window.DJIPage.model）。');
    }
  })();
})();