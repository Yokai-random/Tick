const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const AdmZip = require('adm-zip');
const { mavenCoordToPath, downloadFile, rulesAllow: _rulesAllow } = require('./downloadHandler');
const { detectJava, selectBestJava } = require('./javaHandler');

function getJavaMajorVersion(javaExe) {
  try {
    const { spawnSync } = require('child_process');
    const r = spawnSync(javaExe, ['-version'], { encoding: 'utf-8', timeout: 5000 });
    const out = r.stderr || r.stdout || '';
    const m = out.match(/version "([^"]+)"/);
    if (!m) return 0;
    const parts = m[1].split('.');
    return parts[0] === '1' ? parseInt(parts[1]) : parseInt(parts[0]);
  } catch {
    return 0;
  }
}

function offlineUUID(username) {
  const md5 = crypto.createHash('md5').update('OfflinePlayer:' + username).digest();
  md5[6] = (md5[6] & 0x0f) | 0x30;
  md5[8] = (md5[8] & 0x3f) | 0x80;
  const hex = md5.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function rulesAllow(rules, features = {}) {
  if (!rules || rules.length === 0) return true;
  let allow = false;
  for (const rule of rules) {
    let matches = true;
    if (rule.os) {
      if (rule.os.name && rule.os.name !== 'windows') matches = false;
    }
    if (rule.features) {
      for (const [k, v] of Object.entries(rule.features)) {
        if ((features[k] || false) !== v) { matches = false; break; }
      }
    }
    if (rule.action === 'allow' && matches) allow = true;
    if (rule.action === 'disallow' && matches) allow = false;
  }
  return allow;
}

function substituteVars(str, vars) {
  return str.replace(/\$\{([^}]+)\}/g, (_, key) => vars[key] ?? '');
}

// Resolve inheritsFrom chain and merge version JSONs
function resolveVersionJson(versionId, minecraftDir) {
  const jsonPath = path.join(minecraftDir, 'versions', versionId, `${versionId}.json`);
  if (!fs.existsSync(jsonPath)) throw new Error(`找不到版本文件: ${jsonPath}`);
  const vJson = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));

  if (!vJson.inheritsFrom) return vJson;

  // Merge with parent
  const parent = resolveVersionJson(vJson.inheritsFrom, minecraftDir);
  return {
    ...parent,
    ...vJson,
    id: vJson.id,
    mainClass: vJson.mainClass || parent.mainClass,
    assetIndex: vJson.assetIndex || parent.assetIndex,
    assets: vJson.assets || parent.assets,
    arguments: {
      game: [
        ...(parent.arguments?.game || []),
        ...(vJson.arguments?.game || []),
      ],
      jvm: [
        ...(parent.arguments?.jvm || []),
        ...(vJson.arguments?.jvm || []),
      ],
    },
    libraries: [...(parent.libraries || []), ...(vJson.libraries || [])],
    minecraftArguments: vJson.minecraftArguments || parent.minecraftArguments,
  };
}

function buildClasspath(versionJson, minecraftDir) {
  const librariesDir = path.join(minecraftDir, 'libraries');
  const jars = [];
  const seen = new Set();

  for (const lib of (versionJson.libraries || [])) {
    if (!rulesAllow(lib.rules)) continue;
    const dl = lib.downloads;
    let relPath;

    if (dl?.artifact?.path) {
      relPath = dl.artifact.path;
    } else if (lib.name) {
      relPath = mavenCoordToPath(lib.name);
    } else {
      continue;
    }

    const fullPath = path.join(librariesDir, relPath);
    if (!seen.has(fullPath) && fs.existsSync(fullPath)) {
      seen.add(fullPath);
      jars.push(fullPath);
    }
  }

  // Modern NeoForge/Forge (BootstrapLauncher) manages the vanilla jar itself via FML;
  // putting it on -cp causes minecraft [MISSING]. All other loaders need it on -cp.
  const isBootstrapLauncher = versionJson.mainClass === 'cpw.mods.bootstraplauncher.BootstrapLauncher';
  if (!isBootstrapLauncher) {
    const clientJar = path.join(minecraftDir, 'versions', versionJson.inheritsFrom || versionJson.id, `${versionJson.inheritsFrom || versionJson.id}.jar`);
    if (fs.existsSync(clientJar) && !seen.has(clientJar)) jars.push(clientJar);
  }

  return jars.join(path.delimiter);
}

async function extractNatives(libraries, librariesDir, nativesDir) {
  fs.mkdirSync(nativesDir, { recursive: true });
  for (const lib of libraries) {
    if (!rulesAllow(lib.rules)) continue;
    const dl = lib.downloads;
    if (!dl?.classifiers || !lib.natives?.windows) continue;

    const nativeKey = lib.natives.windows.replace('${arch}', '64');
    const nativeArtifact = dl.classifiers[nativeKey];
    if (!nativeArtifact) continue;

    const jarPath = path.join(librariesDir, nativeArtifact.path);
    if (!fs.existsSync(jarPath)) continue;
    try {
      const zip = new AdmZip(jarPath);
      for (const entry of zip.getEntries()) {
        if (entry.isDirectory) continue;
        if (lib.extract?.exclude?.some((ex) => entry.entryName.startsWith(ex))) continue;
        const name = path.basename(entry.entryName);
        if (name.endsWith('.dll') || name.endsWith('.so') || name.endsWith('.dylib')) {
          fs.writeFileSync(path.join(nativesDir, name), entry.getData());
        }
      }
    } catch { /* skip */ }
  }
}

function resolveArgs(argList, vars) {
  const result = [];
  for (const arg of argList) {
    if (typeof arg === 'string') {
      result.push(substituteVars(arg, vars));
    } else if (arg && typeof arg === 'object') {
      if (!rulesAllow(arg.rules)) continue;
      const values = Array.isArray(arg.value) ? arg.value : [arg.value];
      for (const v of values) result.push(substituteVars(v, vars));
    }
  }
  return result;
}

// 沿 inheritsFrom 链遍历实际 JSON 文件，找到最深层的 vanilla version ID
// 不依赖合并后的 versionJson.inheritsFrom（三层继承时该字段会被实例层覆盖，指向 loader 而非 vanilla）
function findVanillaVersionId(versionId, minecraftDir) {
  let cur = versionId;
  for (let i = 0; i < 5; i++) {
    const p = path.join(minecraftDir, 'versions', cur, `${cur}.json`);
    if (!fs.existsSync(p)) break;
    try {
      const raw = fs.readFileSync(p, 'utf-8').replace(/^﻿/, '');  // 剥离 BOM
      const j = JSON.parse(raw);
      if (!j.inheritsFrom) return cur;   // 没有 inheritsFrom = vanilla 层
      cur = j.inheritsFrom;
    } catch {
      break;  // JSON 损坏，回落当前 cur
    }
  }
  return cur;  // 兜底：5 层耗尽或文件不存在时返回最后已知的 cur
}

async function verifyAndRepairLibraries(versionJson, minecraftDir, sendLog, versionId) {
  const librariesDir = path.join(minecraftDir, 'libraries');
  const missing = [];

  // 检查所有库
  for (const lib of (versionJson.libraries || [])) {
    if (!_rulesAllow(lib.rules)) continue;
    const dl = lib.downloads;
    if (!dl?.artifact?.path || !dl.artifact.url) continue;

    const fullPath = path.join(librariesDir, dl.artifact.path);
    if (!fs.existsSync(fullPath) || fs.statSync(fullPath).size === 0) {
      missing.push({ dest: fullPath, url: dl.artifact.url, name: path.basename(dl.artifact.path) });
    }
  }

  // 检查客户端 JAR：BootstrapLauncher（NeoForge/Forge）由 FML 自己管理，无需验证
  // 普通版本（原版/Fabric）则递归读取实际 JSON 文件链找到真正的 vanilla version ID
  const isBootstrapLauncher = versionJson.mainClass === 'cpw.mods.bootstraplauncher.BootstrapLauncher';
  if (!isBootstrapLauncher) {
    const clientId = findVanillaVersionId(versionId, minecraftDir);
    const clientJar = path.join(minecraftDir, 'versions', clientId, `${clientId}.jar`);
    if (!fs.existsSync(clientJar) || fs.statSync(clientJar).size === 0) {
      const clientUrl = versionJson.downloads?.client?.url;
      if (clientUrl) missing.push({ dest: clientJar, url: clientUrl, name: `${clientId}.jar` });
    }
  }

  if (missing.length === 0) {
    sendLog('info', `✓ 校验通过：${(versionJson.libraries || []).length} 个库均完整`);
    return;
  }

  sendLog('error', `⚠ 发现 ${missing.length} 个缺失文件，使用 Mojang 官方源补充下载...`);
  const stillMissing = [];

  for (const m of missing) {
    try {
      sendLog('info', `  补下: ${m.name}`);
      await downloadFile(m.url, m.dest);
      sendLog('info', `  ✓ ${m.name}`);
    } catch (e) {
      sendLog('error', `  ✗ ${m.name}: ${e.message}`);
      stillMissing.push(m.name);
    }
  }

  if (stillMissing.length === 0) {
    sendLog('info', `✓ 已补全所有 ${missing.length} 个缺失文件`);
  } else {
    sendLog('error', `━━ 仍有 ${stillMissing.length} 个文件无法下载（启动极大可能失败）━━`);
    stillMissing.forEach(n => sendLog('error', `  · ${n}`));
  }
}

async function launchGame(options, minecraftDir, win) {
  const { versionId, javaPath, username, maxMemory = 2048, account } = options;

  const versionDir = path.join(minecraftDir, 'versions', versionId);
  const nativesDir = path.join(versionDir, 'natives');
  const librariesDir = path.join(minecraftDir, 'libraries');
  const assetsDir = path.join(minecraftDir, 'assets');
  // Version isolation: each version uses its own dir as gameDir
  const gameDir = versionDir;

  fs.mkdirSync(gameDir, { recursive: true });
  fs.mkdirSync(nativesDir, { recursive: true });

  const sendLog = (type, message) => {
    if (win && !win.isDestroyed()) win.webContents.send('launch:output', { type, message });
  };

  // Resolve version JSON (handles inheritsFrom chain)
  const versionJson = resolveVersionJson(versionId, minecraftDir);

  sendLog('info', '正在提取原生库...');
  await extractNatives(versionJson.libraries || [], librariesDir, nativesDir);

  // ── 启动前校验所有 classpath JAR，缺失的用 Mojang 官方源补下 ──────────
  await verifyAndRepairLibraries(versionJson, minecraftDir, sendLog, versionId);

  const classpath = buildClasspath(versionJson, minecraftDir);

  // Determine auth info
  let playerName, playerUUID, accessToken, userType, xuid, clientId;
  if (account?.type === 'microsoft') {
    playerName = account.username;
    playerUUID = account.uuid;
    accessToken = account.accessToken;
    userType = 'msa';
    xuid = account.xuid || '';
    clientId = account.clientId || '';
  } else {
    playerName = username || 'Steve';
    playerUUID = offlineUUID(playerName);
    accessToken = '0';
    userType = 'legacy';
    xuid = '';
    clientId = '';
  }

  const vars = {
    auth_player_name: playerName,
    version_name: versionId,
    game_directory: gameDir,
    assets_root: assetsDir,
    assets_index_name: versionJson.assetIndex?.id || versionJson.assets || versionId,
    auth_uuid: playerUUID,
    auth_access_token: accessToken,
    auth_session: accessToken,
    user_type: userType,
    version_type: versionJson.type || 'release',
    natives_directory: nativesDir,
    launcher_name: 'CMCL',
    launcher_version: '1.0.0',
    classpath,
    library_directory: librariesDir,
    classpath_separator: path.delimiter,
    resolution_width: '854',
    resolution_height: '480',
    clientid: clientId,
    auth_xuid: xuid,
    user_properties: '{}',
  };

  let jvmArgs = [];
  if (versionJson.arguments?.jvm) {
    jvmArgs = resolveArgs(versionJson.arguments.jvm, vars);
  } else {
    jvmArgs = [
      `-Djava.library.path=${nativesDir}`,
      `-Dminecraft.launcher.brand=CMCL`,
      `-Dminecraft.launcher.version=1.0.0`,
      `-cp`, classpath,
    ];
  }
  jvmArgs.unshift(`-Xmx${maxMemory}m`, `-Xms256m`);

  let gameArgs = [];
  if (versionJson.arguments?.game) {
    gameArgs = resolveArgs(versionJson.arguments.game, vars);
  } else if (versionJson.minecraftArguments) {
    gameArgs = substituteVars(versionJson.minecraftArguments, vars).split(' ');
  }

  const mainClass = versionJson.mainClass;
  const fullArgs = [...jvmArgs, mainClass, ...gameArgs];

  // 优先使用 java.exe（而非 javaw.exe），确保 stdout/stderr 正常管道；
  // windowsHide 选项隐藏控制台窗口，效果与 javaw.exe 一致
  let javaExe = javaPath;
  if (!javaExe.endsWith('.exe')) {
    const bin = path.join(javaPath, 'bin');
    javaExe = path.join(bin, 'java.exe');
    if (!fs.existsSync(javaExe)) javaExe = path.join(bin, 'javaw.exe');
  } else if (javaExe.endsWith('javaw.exe')) {
    const alt = javaExe.replace('javaw.exe', 'java.exe');
    if (fs.existsSync(alt)) javaExe = alt;
  }

  // ── Java 版本预检 + 自动切换 ───────────────────────────────
  const requiredMajor = versionJson.javaVersion?.majorVersion ?? 8;
  let currentMajor = getJavaMajorVersion(javaExe);

  if (currentMajor > 0 && currentMajor < requiredMajor) {
    sendLog('info', `当前 Java ${currentMajor} 不满足要求（需 Java ${requiredMajor}+），正在自动查找合适版本...`);
    const allJavas = detectJava();
    const best = selectBestJava(allJavas, requiredMajor);
    if (best) {
      // 优先用 java.exe 以保证 stdio 管道
      const bestExe = best.path.replace(/javaw\.exe$/i, 'java.exe');
      javaExe = fs.existsSync(bestExe) ? bestExe : best.path;
      currentMajor = best.major;
      sendLog('info', `✓ 自动切换至 Java ${best.major}：${javaExe}`);
    } else {
      sendLog('error', `❌ 未找到 Java ${requiredMajor}+，已扫描以下安装：`);
      (allJavas || []).forEach(j => sendLog('error', `   Java ${j.major}  ${j.path}`));
      sendLog('error', `请安装 Java ${requiredMajor} 后重试（推荐 Eclipse Temurin）`);
      throw new Error(`未找到满足要求的 Java ${requiredMajor}+`);
    }
  }

  const cpJars = classpath.split(path.delimiter);
  sendLog('info', `━━━━━━━━━━ 启动信息 ━━━━━━━━━━`);
  sendLog('info', `Java 路径:   ${javaExe}`);
  sendLog('info', `Java 版本:   Java ${currentMajor > 0 ? currentMajor : '(检测失败)'}`);
  sendLog('info', `需要版本:    Java ${requiredMajor}+`);
  sendLog('info', `Minecraft:   ${versionId}`);
  sendLog('info', `用户名:      ${playerName}`);
  sendLog('info', `UUID:        ${playerUUID}`);
  sendLog('info', `内存上限:    ${maxMemory} MB`);
  sendLog('info', `游戏目录:    ${gameDir}`);
  sendLog('info', `Classpath:   ${cpJars.length} 个 JAR`);
  sendLog('info', `主类:        ${mainClass}`);
  sendLog('info', `完整启动命令:`);
  sendLog('info', `"${javaExe}" ${fullArgs.join(' ')}`);
  sendLog('info', `━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  if (cpJars.length <= 1) {
    sendLog('error', `⚠ Classpath 异常：仅 ${cpJars.length} 个 JAR，依赖库可能未完整下载`);
  }

  sendLog('info', '正在启动游戏...');

  // 不使用 detached，确保 Windows 下 stdio 管道可靠；
  // windowsHide 隐藏控制台窗口，效果与 javaw.exe 一致。
  const proc = spawn(javaExe, fullArgs, {
    cwd: gameDir,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderrBuf = '';
  proc.stdout.on('data', (d) => sendLog('stdout', d.toString()));
  proc.stderr.on('data', (d) => {
    const text = d.toString();
    stderrBuf += text;
    sendLog('stderr', text);
  });

  proc.on('close', (code) => {
    sendLog('exit', `━━━━━━━━━━ 进程结束 ━━━━━━━━━━`);
    sendLog('exit', `退出码: ${code}`);

    if (code !== 0 && code !== null) {
      sendLog('error', `━━━ 错误诊断 ━━━`);
      if (!stderrBuf.trim()) {
        sendLog('error', '（无 stderr 输出）');
        sendLog('error', '可能原因：① Java 路径错误，无法执行  ② JVM 初始化即崩溃  ③ 依赖库严重缺失');
      } else {
        sendLog('error', `stderr 完整内容：\n${stderrBuf.trim()}`);
      }

      if (code === 1) {
        sendLog('error', '━━━ 退出码 1 常见原因 ━━━');
        sendLog('error', '① Java 版本不足（如用 Java 17 启动 1.21.1 需要 Java 21+）');
        sendLog('error', '② Classpath 中有 JAR 文件损坏或缺失');
        sendLog('error', '③ JVM 参数含有不支持的选项');
        sendLog('error', '④ 原生库（.dll）提取失败或缺少');
        sendLog('error', '→ 请对照上方「完整启动命令」排查，或尝试重新下载该版本');
      }
    }
  });

  proc.on('error', (err) => {
    sendLog('error', `启动失败: ${err.message}`);
    if (err.code === 'ENOENT') {
      sendLog('error', `找不到 Java 可执行文件: ${javaExe}`);
      sendLog('error', '请在「设置」中重新检测或手动填写正确的 Java 路径');
    }
  });

  return { pid: proc.pid };
}

module.exports = { launchGame, resolveVersionJson };
