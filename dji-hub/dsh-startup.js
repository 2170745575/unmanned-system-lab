/* dsh-startup.js —— dsh-startup.json 的 file:// 孪生文件
   双击打开（file://）时浏览器会拦截 fetch 读取本地 JSON，所以这里内置同一份配置。
   修改启动动画：HTTP 服务下改 dsh-startup.json；file:// 下改本文件。两者内容保持一致。 */
window.DSH_STARTUP = {
  "brand": "UNMANNED SYSTEM LAB",
  "kicker": "FLEET TERMINAL · ONLINE",
  "title": "无人系统可视化套件",
  "subtitle": "UNMANNED SYSTEM LAB · FIVE AIRFRAMES",
  "tagline": "侦察 · 打击 · 救护 · 补给",
  "accent": "#6ce0a8",
  "accent2": "#5fd0f0",
  "autoEnterMs": 2200,
  "music": true,
  "scanOnEnter": false,
  "tips": [
    "点击卡片进入机型",
    "T 演示巡航",
    "B 技术图纸",
    "U 中英切换"
  ],
  "bootLines": [
    "FLEET MANIFEST .......... 5 DOCKS",
    "PROCEDURAL ASSETS ..... 0 EXTERNAL",
    "MISSION MODULES ....... 3 ACTIVE",
    "LINK ESTABLISHED"
  ]
};
