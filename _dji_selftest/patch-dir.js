/* 补丁：给前后堆叠部件加入横向分量，让爆炸图呈放射状而非一条直线 */
const fs = require('fs');
const p = 'D:\\deepseek工作\\dji-action4-3d\\app.js';
let s = fs.readFileSync(p, 'utf8');
const map = [
  ['dir: [0, 0, 1], dist: 3.9,', 'dir: [0, 0.15, 1], dist: 3.9,'],           // sensor
  ['dir: [0, 0.1, 1], dist: 1.4,', 'dir: [0.4, 0.45, 1], dist: 1.4,'],        // pcb
  ['dir: [0, -0.1, -1], dist: 2.0,', 'dir: [-0.5, -0.35, -1], dist: 2.0,'],   // battery
  ['dir: [0, 0, -1], dist: 5.0,', 'dir: [-0.25, 0, -1], dist: 5.0,'],         // rearShell
  ['dir: [0, 0.12, -1], dist: 5.7,', 'dir: [0.15, 0.2, -1], dist: 5.7,']      // rearScreen
];
let miss = [];
map.forEach(m => {
  const n = s.split(m[0]).length - 1;
  if (n !== 1) { miss.push(n + '× ' + m[0]); return; }
  s = s.replace(m[0], m[1]);
});
if (miss.length) { console.error('未唯一匹配:\n' + miss.join('\n')); process.exit(1); }
fs.writeFileSync(p, s);
console.log('已替换 ' + map.length + ' 处');