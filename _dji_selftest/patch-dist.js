/* 一次性补丁：调整各部件拆解位移，使整体爆炸图适配取景框 */
const fs = require('fs');
const p = 'D:\\deepseek工作\\dji-action4-3d\\app.js';
let s = fs.readFileSync(p, 'utf8');

const map = [
  ['dir: [0, 0, 1], dist: 8.8,', 'dir: [0, 0, 1], dist: 4.7,'],          // lensRing
  ['dir: [0, 0, 1], dist: 6.6,', 'dir: [0, 0, 1], dist: 4.4,'],          // lens
  ['dir: [0.25, 0.45, 1], dist: 6.4,', 'dir: [0.25, 0.45, 1], dist: 4.1,'], // frontScreen
  ['dir: [0, 0, 1], dist: 2.6,', 'dir: [0, 0, 1], dist: 1.0,'],          // frontShell
  ['dir: [0, 0, 1], dist: 4.6,', 'dir: [0, 0, 1], dist: 3.9,'],          // sensor
  ['dir: [0, 0.1, 1], dist: 3.0,', 'dir: [0, 0.1, 1], dist: 1.4,'],      // pcb
  ['dir: [0, -0.1, -1], dist: 2.9,', 'dir: [0, -0.1, -1], dist: 2.0,'],  // battery
  ['dir: [0.15, 1, -0.5], dist: 4.6,', 'dir: [0.15, 1, -0.5], dist: 2.4,'], // heatSink
  ['dir: [0, 0, -1], dist: 5.8,', 'dir: [0, 0, -1], dist: 5.0,'],        // rearShell
  ['dir: [0, 0.12, -1], dist: 8.8,', 'dir: [0, 0.12, -1], dist: 5.7,'],  // rearScreen
  ['dir: [0, 1, 0], dist: 4.8,', 'dir: [0, 1, 0], dist: 2.0,'],          // shutterButton
  ['dir: [0, 1, 0.15], dist: 4.2,', 'dir: [0, 1, 0.15], dist: 2.0,'],    // qsButton
  ['dir: [-1, 0.2, 0], dist: 5.0,', 'dir: [-1, 0.2, 0], dist: 3.0,'],    // sideKey
  ['dir: [1, 0.2, 0], dist: 5.0,', 'dir: [1, 0.2, 0], dist: 3.0,'],      // usbCover
  ['dir: [1, -0.25, 0.15], dist: 6.6,', 'dir: [1, -0.25, 0.15], dist: 4.2,'], // sdCard
  ['dir: [-0.3, -1, 0.45], dist: 4.6,', 'dir: [-0.3, -1, 0.45], dist: 2.6,'], // speaker
  ['dir: [0.25, -1, 0.6], dist: 4.2,', 'dir: [0.25, -1, 0.6], dist: 2.6,'],   // mic
  ['dir: [0, -1, -0.3], dist: 6.4,', 'dir: [0, -1, -0.3], dist: 3.4,'],  // mount
  ['orbit.update(dt, state.explodeT * 4.6);', 'orbit.update(dt, state.explodeT * 5.4);'],
  ["'<span class=\"chip\">位移 ' + d.dist.toFixed(1) + ' 单位</span>'",
   "'<span class=\"chip\">位移 ' + d.dist.toFixed(1) + ' cm（1 单位 = 1 cm）</span>'"]
];

let ok = 0, miss = [];
map.forEach(function (m) {
  const n = s.split(m[0]).length - 1;
  if (n !== 1) { miss.push(n + '× ' + m[0]); return; }
  s = s.replace(m[0], m[1]);
  ok++;
});
if (miss.length) { console.error('未唯一匹配：\n' + miss.join('\n')); process.exit(1); }
fs.writeFileSync(p, s);
console.log('已替换 ' + ok + ' 处');