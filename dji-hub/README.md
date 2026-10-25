# UNMANNED SYSTEM LAB · 无人系统可视化套件

面向国际赛展示的纯前端无人系统可视化套件：**五台机型、五个可交互场景、同一个自研 Three.js 引擎**，全部几何、贴图、光照与后期处理都由代码生成，**没有任何外部模型或图片资源**。

## 打开方式

双击 `index.html` 即可（不需要构建、不需要服务器；经典 script 标签，`file://` 直接可用），或 `npx serve .`。

## 体系链路（作品的叙事）

四台机型不是孤立模型，而是一条完整链路，各自对应一套可交互任务模拟：

| 步骤 | 机型 | 能力 | 目录 |
| --- | --- | --- | --- |
| STEP 01 | DJI Mavic 3 Pro | 侦察感知 · 三摄云台 + 战术 HUD | `../dji-mavic3pro-3d/` |
| STEP 02 | FELON-1 攻击无人机 | 精确打击 · 扫描锁定 → 炮塔随动 / 弹药打击 | `../dji-felon-attack/` |
| STEP 03 | MEDEVAC-1 大型医疗救援无人机 | 伤员后送 · 生命探测 → 分诊 → 绞盘吊救 | `../dji-medical-3d/` |
| STEP 04 | DJI FlyCart 100 物流无人机 | 物资投送 · 吊装 → 称重 → 消摆运输 → 投放 | `../dji-flycart100-3d/` |

另有 DJI Action 4 运动相机（18 部件）作为拆解交互的入门示例。

## 在库机型与规模

| 机型 | 部件 | 能力 |
| --- | ---: | --- |
| DJI Action 4 | 18 | 拆解查看 · 参数面板 |
| DJI Mavic 3 Pro | 23 | 拆解查看 · 战术 HUD |
| FELON-1 攻击无人机 | 24 | 拆解查看 · **作战模拟** |
| MEDEVAC-1 医疗救援无人机 | 30 | 拆解查看 · **救护模拟** |
| DJI FlyCart 100 物流无人机 | 30 | 拆解查看 · **物流模拟** |
| 合计 | **125** | 3 套任务模拟 |

## 展台级功能（引擎级，引擎机型通用）

| 功能 | 说明 | 快捷键 |
| --- | --- | --- |
| **演示巡航 Showreel** | 电影级镜头轨迹自动推进，含低角度特写、侧向、俯视等 6 个镜头位，并自动在「合拢 / 拆解」之间巡展，配影院遮幅与镜头说明 | `T` |
| **技术图纸 Blueprint** | 一键切换为发光青色线框 + 深蓝背景，隐藏光晕与特效，得到干净的工程图观感（可无损还原） | `B` |
| **中英双语** | 部件清单、参数面板、3D 标注、界面按钮全部可切中英，偏好写入 localStorage | `U` |
| **后期处理** | 自写泛光（亮部提取 + 两级高斯 + 合成）+ ACES 调色 + 暗角 + 胶片颗粒 + 轻微色差；WebGL2 走 4×MSAA；能力不足时自动降级为直出，绝不白屏 | — |
| **拆解 / 合拢** | 逐部件爆炸拆解，带高亮脉冲、光晕、描边与标注引线 | `E` |
| **动态机构** | 桨叶自旋（共轴反向）+ 桨盘动态光晕、机臂展开 / 折叠、炮塔随动、绞盘吊挂 | `X` 等 |

URL 参数可直接进入指定状态，便于演示与跳转：`?mode=explode`、`?mode=tour`、`?mode=blueprint`、`?mode=sim`。


## 展台外壳（五个页面统一具备）

| 能力 | 说明 |
| --- | --- |
| 返回展台按钮 | 引擎注入，位于顶栏按钮组首位 |
| 启动动画 + 镜头飞入 | 引擎注入，2.1s easeOutCubic，7s 兜底自动进入；带 `?mode=` 深链时跳过 |
| 程序化音乐（零音频文件） | 引擎内置 Web Audio 合成：低频氛围层 + 和弦垫 + 空气噪声 + 雷达脉冲 |
| 去塑料感材质升级 | 引擎 `std()` 咽喉点统一规范化 + `addMesh` 烘焙顶点色 AO |
| 后期处理 / 演示巡航 / 蓝图 / 双语 | 引擎内置 |
| 模拟飞行 / 航行灯 / 自检扫描 | 引擎内置；`aerial:false` 的机型（Action 4）自动关闭飞行与航行灯 |

**五个页面现在全部跑在同一套共享引擎上**（`engine.js` 在五个目录里逐字节一致）。

- 深链 `?mode=explode|tour|blueprint|sim` 会**跳过启动动画**直接进画面，保证门户跳转即时。
- 音乐状态存 `localStorage`：机型页 `dji-music`、门户 `dji-hub-music`，默认开启但需用户手势后起播（浏览器音频策略）。
- 门户站右上角有独立音乐开关，首次任意点击也会按偏好自动起播。

## 去"塑料感"做了什么

1. **metalness 二值化**：非金属件的 metalness 从 0.22~0.4 一律压到 0.04（有贴图的碳纤维/PCB 例外）——中间值 metalness 是"塑料油光"的头号来源。
2. **微表面细节**：程序化颗粒法线 + 粗糙度噪声图，打散均匀高光；金属件用方向性拉丝法线；roughness < 0.2 的镜头玻璃豁免（避免反射颗粒感）。
3. **顶点色 AO**：按几何体包围盒做 0.78→1.06 的上下渐变 + ±3% 哈希噪声，消除"整体一样亮"的玩具感。
4. **环境反射重建**：陡峭天顶/地平线对比 + 贯穿柔光带 + 冷主光/暖侧光/地面反光高光块 + 锐利地平线，让金属有东西可反射。

验证：`smoke-flycart.js` 断言 **312 种材质中"无贴图的中间 metalness"材质数为 0**，顶点色样本范围 0.78~1.09。

## 引擎与分工

```
dji-hub/                 门户（本页）：机型数据、体系链路、技术亮点、双语、动态主视觉
  index.html · assets/*.png · README.md
dji-felon-attack/        攻击型：engine.js + model-attack.js + combat.js + enemies.js
dji-medical-3d/          医疗型：engine.js + model-medical.js + medical.js + casualties.js
dji-flycart100-3d/       物流型：engine.js + model-flycart.js + flycart.js + logistics.js
dji-mavic3pro-3d/        侦察型：engine.js + model-mavic.js
dji-action4-3d/          影像型：engine.js + model-action4.js
```

五个机型共用同一份 `engine.js`（加载器 / 场景灯光 / 轨道控制 / 拾取 / 爆炸拆解 / 战术 HUD / 参数面板 / 渲染循环 / 后期处理 / 演示巡航 / 蓝图模式 / 双语），机型只提供两个文件：

- `model-*.js` —— 部件数据 + 几何构建，末尾 `window.DJIPage = { model: ... }` 自注册
- `*.js` —— 行为与任务模拟，末尾 `window.DJIPage.behavior = ...` 自注册

## 新增一台机型

1. 新建目录，拷入 `engine.js` 与 `vendor/three.min.js`；
2. 写 `model-xxx.js`（部件 + 几何，自注册到 `window.DJIPage.model`）与 `xxx.js`（行为，可选，自注册到 `window.DJIPage.behavior`）；
3. 写 `index.html`，按 defer 顺序引入 `model-xxx.js → xxx.js → engine.js`；
4. 在门户 `index.html` 的 `FLEET` 数组（如需还有 `CHAIN`、`FEATS`）里加一条，并把缩略图放进 `assets/`。

## 验证

每台机型都有 Node 冒烟测试（`_dji_selftest/smoke-*.js`）：按浏览器真实加载顺序加载全部模块、断言顶层不触碰 THREE、DOM id 完整性、几何与尺寸健全性、机构功能（自旋 / 折叠 / 吊运流程 / 称重 / 消摆）、展台功能（巡航推进 / 蓝图还原 / 双语切换）、拆解与面板交互，并覆盖 CDN 完全挂住的兜底场景。外观由自写 PBR 软件渲染器（`render4.py`）离线核对。

> 所有尺寸与参数为可视化演示用途，非任何真实产品的工程图纸。
## 展示级动态（让模型"活起来"）

| 能力 | 说明 | 快捷键 |
| --- | --- | --- |
| **模拟飞行** | 低频利萨茹漂移 + 升降 + **按位移速度推出的滚转/俯仰** + 缓慢偏航摆动，整机真的像在飞；地面有**桨下洗流环**与机腹光池脉动 | `F` |
| **航行灯 / 防撞灯** | 有旋翼的机型自动布灯：左红右绿航行灯、机顶白色信标、机背机腹红色防撞灯。红色用**航空式双闪**（每 1.35s 一个周期：亮 70ms、灭 130ms、亮 70ms、长灭），白色信标每 1.7s 闪一次 | — |
| **雷达自检扫描** | 一道青色光环从机体上方缓慢下降、边转边扫，同时右上角弹出**自检面板**逐项点亮子系统；扫完显示"全系统状态正常"。进入展台后自动跑一次，之后每 26 秒一次 | `S` |

行为层自己负责机体位移的机型（物流吊运 / 医疗吊救）会在 `behavior` 上声明 `movesRoot: true`，展示层就只保留姿态呼吸感——否则漂移量会顶住行为层的收敛阈值把状态机卡住。

## 启动动画配置：dsh-startup.json

每个页面目录下都有 `dsh-startup.json`（规范配置）与 `dsh-startup.js`（它的 file:// 孪生文件，内容一致）。启动动画的品牌字、标语、强调色、启动日志、自动进入时长、音乐默认值、是否进场自检全部从这里读：

```json
{
  "brand": "UNMANNED SYSTEM LAB",
  "kicker": "COMBAT READINESS · SELF-TEST",
  "title": "FELON-1 攻击无人机",
  "subtitle": "ARMED STRIKE QUADCOPTER · 24 PARTS",
  "accent": "#e8722a",
  "accent2": "#4fd6e8",
  "autoEnterMs": 7000,
  "music": true,
  "scanOnEnter": true,
  "tips": ["T 演示巡航", "B 技术图纸", "U 中英切换"],
  "bootLines": ["AIRFRAME INTEGRITY .......... OK", "MISSION SYSTEM READY"]
}
```

**读取顺序**：`window.DSH_STARTUP` → `fetch('dsh-startup.json')`（HTTP 服务下）→ 动态注入 `dsh-startup.js`（`file://` 双击打开时浏览器会拦本地 fetch，所以走这个孪生文件）→ 引擎内置默认。**三档都有兜底，任何一档失败都不影响页面。**

> 改启动动画：用 HTTP 服务跑就改 `dsh-startup.json`；直接双击打开就改 `dsh-startup.js`，两者内容保持一致。
