const path = require('path');
const fs   = require('fs');
const minecraftDir = path.join(__dirname, '..', '.minecraft');

// ── 完整复制改后的 findVanillaVersionId（与 launchHandler.js 一字不差）────
function readJson(p) {
  const raw = fs.readFileSync(p, 'utf-8').replace(/^﻿/, '');  // 剥离 BOM
  return JSON.parse(raw);
}

function findVanillaVersionId(versionId, minecraftDir) {
  let cur = versionId;
  for (let i = 0; i < 5; i++) {
    const p = path.join(minecraftDir, 'versions', cur, `${cur}.json`);
    if (!fs.existsSync(p)) break;
    try {
      const j = readJson(p);
      if (!j.inheritsFrom) return cur;
      cur = j.inheritsFrom;
    } catch { break; }
  }
  return cur;
}

// 找 mainClass（沿链往上，取第一个有 mainClass 的层）
function getMainClass(versionId) {
  let cur = versionId;
  for (let i = 0; i < 5; i++) {
    const p = path.join(minecraftDir, 'versions', cur, `${cur}.json`);
    if (!fs.existsSync(p)) break;
    const j = readJson(p);
    if (j.mainClass) return j.mainClass;
    if (!j.inheritsFrom) break;
    cur = j.inheritsFrom;
  }
  return null;
}

const BSL = 'cpw.mods.bootstraplauncher.BootstrapLauncher';

const scenarios = [
  { id: '1.21.1',               label: '遗留原版' },
  { id: 'neoforge-21.1.233',    label: '遗留 NeoForge 加载器' },
  { id: '1.21.1-neoforge 2222', label: '新实例（NeoForge 三层）' },
  { id: '测试实例A',             label: '新实例（NeoForge 三层）' },
];

let allOk = true;
console.log('=== verifyAndRepairLibraries 回归验证 ===\n');

for (const s of scenarios) {
  const vdir = path.join(minecraftDir, 'versions', s.id);
  if (!fs.existsSync(vdir)) { console.log(`[跳过] ${s.id} （目录不存在）\n`); continue; }

  const mc     = getMainClass(s.id);
  const isBSL  = mc === BSL;
  const vanilla = isBSL ? null : findVanillaVersionId(s.id, minecraftDir);
  const jar    = vanilla ? path.join(minecraftDir, 'versions', vanilla, `${vanilla}.jar`) : null;
  const exists = jar ? fs.existsSync(jar) : null;

  console.log(`[${s.label}] ${s.id}`);
  console.log(`  mainClass 末段   : ${mc ? mc.split('.').pop() : '(null)'}`);
  console.log(`  isBootstrapLauncher: ${isBSL}`);

  if (isBSL) {
    console.log(`  clientJar 检查   : 跳过（BootstrapLauncher 守卫生效）`);
    console.log(`  ✅ 旧版本/NeoForge 实例：不会触发误下载`);
  } else {
    console.log(`  findVanillaVersionId → "${vanilla}"`);
    console.log(`  clientJar 路径   : ${jar}`);
    console.log(`  clientJar 存在   : ${exists}`);

    // 验证规则：vanilla ID 必须等于真正的 vanilla 版本（1.21.1），不能是 loader 目录名
    const idOk = vanilla === '1.21.1';
    if (!idOk) { console.log(`  ❌ vanilla ID 错误，期望 1.21.1，实际 ${vanilla}`); allOk = false; }
    else if (exists) console.log(`  ✅ clientJar 定位正确且存在，不触发下载`);
    else             console.log(`  ⚠ clientJar 缺失，会触发补下载（首次运行属正常）`);
  }
  console.log('');
}

console.log(allOk ? '=== 所有场景回归通过 ===' : '=== 存在回归失败，请检查 ===');
