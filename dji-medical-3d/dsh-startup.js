/* dsh-startup.js —— dsh-startup.json 的 file:// 孪生文件
   双击打开（file://）时浏览器会拦截 fetch 读取本地 JSON，所以这里内置同一份配置。
   修改启动动画：HTTP 服务下改 dsh-startup.json；file:// 下改本文件。两者内容保持一致。 */
window.DSH_STARTUP = {
  "brand": "UNMANNED SYSTEM LAB",
  "kicker": "MEDICAL READINESS · SELF-TEST",
  "title": "MEDEVAC-1 大型医疗救援无人机",
  "subtitle": "LARGE MEDICAL EVACUATION UAV · 30 PARTS",
  "tagline": "生命探测 · 伤情分诊 · 物资投送 · 绞盘吊救",
  "accent": "#6ce0a8",
  "accent2": "#4fd6e8",
  "autoEnterMs": 7000,
  "music": true,
  "scanOnEnter": true,
  "aerial": true,
  "rotorHint": "prop",
  "tips": [
    "T 演示巡航",
    "B 技术图纸",
    "U 中英切换",
    "F 模拟飞行",
    "S 状态自检"
  ],
  "bootLines": [
    "AIRFRAME INTEGRITY .......... OK",
    "MEDICAL CABIN .......... PRESSURISED",
    "LIFE SUPPORT .......... ONLINE",
    "BLOOD STORAGE .......... 4.0 C",
    "TRIAGE SYSTEM READY"
  ]
};
