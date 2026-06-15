'use strict';
const path = require('path');
const fs = require('fs');
const { spawn, spawnSync } = require('child_process');
const iconv = require('iconv-lite');
const StreamZip = require('node-stream-zip');
const { fetchJson } = require('./versionHandler');
const { downloadWithFallback } = require('./downloadHandler');
const { detectJava, selectBestJava } = require('./javaHandler');

const BMCLAPI = 'https://bmclapi2.bangbang93.com';
const NEOFORGE_MAVEN = 'https://maven.neoforged.net/releases/net/neoforged/neoforge';
const FABRIC_META   = 'https://meta.fabricmc.net/v2';

// ── Java version helpers (parallel to launchHandler, no shared dep) ───────────

function getJavaMajorVersion(javaExe) {
  try {
    const r = spawnSync(javaExe, ['-version'], { encoding: 'utf-8', timeout: 5000 });
    const out = r.stderr || r.stdout || '';
    const m = out.match(/version "([^"]+)"/);
    if (!m) return 0;
    const parts = m[1].split('.');
    return parts[0] === '1' ? parseInt(parts[1], 10) : parseInt(parts[0], 10);
  } catch { return 0; }
}

// MC version string → minimum required Java major version
function getMcJavaRequirement(mcVersion) {
  const parts = (mcVersion || '').split('.').map(Number);
  const minor = parts[1] || 0;
  const patch = parts[2] || 0;
  if (minor > 20 || (minor === 20 && patch >= 5)) return 21; // 1.20.5+
  if (minor >= 17) return 17;                                  // 1.17–1.20.4
  return 8;                                                    // ≤1.16
}

// ── Module-level process registry ─────────────────────────────────────────────
// Lives here so it persists across all IPC calls in the same app session.
const serverProcesses = new Map(); // serverId → ChildProcess

// ── Helpers ───────────────────────────────────────────────────────────────────

function serverDir(serversDir, serverId) {
  return path.join(serversDir, serverId);
}

function metaPath(serversDir, serverId) {
  return path.join(serverDir(serversDir, serverId), 'cmcl-server.json');
}

function readMeta(serversDir, serverId) {
  return JSON.parse(fs.readFileSync(metaPath(serversDir, serverId), 'utf-8'));
}

function writeMeta(serversDir, serverId, meta) {
  fs.writeFileSync(metaPath(serversDir, serverId), JSON.stringify(meta, null, 2));
}

function sendInstallProgress(win, serverId, message) {
  if (win && !win.isDestroyed()) {
    win.webContents.send('server:installProgress', { serverId, message });
  }
}

// ── Instance list ─────────────────────────────────────────────────────────────

function listServers(serversDir) {
  if (!fs.existsSync(serversDir)) return [];
  const servers = [];
  for (const entry of fs.readdirSync(serversDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const mp = path.join(serversDir, entry.name, 'cmcl-server.json');
    if (!fs.existsSync(mp)) continue;
    try { servers.push(JSON.parse(fs.readFileSync(mp, 'utf-8'))); } catch { /* skip */ }
  }
  return servers;
}

// ── Download vanilla server.jar ───────────────────────────────────────────────

async function downloadVanillaServer(serverId, sDir, mcVersion, win) {
  sendInstallProgress(win, serverId, '获取版本清单...');

  // 1. Get version manifest
  let manifest;
  try { manifest = await fetchJson(`${BMCLAPI}/mc/game/version_manifest.json`); }
  catch { manifest = await fetchJson('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'); }

  const vInfo = manifest.versions.find(v => v.id === mcVersion);
  if (!vInfo) throw new Error(`未找到 MC 版本 ${mcVersion}`);

  // 2. Get version JSON (prefer BMCLAPI mirror)
  sendInstallProgress(win, serverId, `获取版本信息: ${mcVersion}`);
  let vJson;
  try { vJson = await fetchJson(`${BMCLAPI}/version/${mcVersion}/json`); }
  catch { vJson = await fetchJson(vInfo.url); }

  const serverUrl = vJson.downloads?.server?.url;
  if (!serverUrl) throw new Error(`版本 ${mcVersion} 没有可用的服务端下载`);

  // 3. Download – BMCLAPI mirror first, official fallback
  const mirrorUrl = `${BMCLAPI}/version/${mcVersion}/server`;
  const destPath = path.join(sDir, 'server.jar');

  await downloadWithFallback(mirrorUrl, serverUrl, destPath, (dl, total) => {
    if (total > 0) {
      sendInstallProgress(win, serverId,
        `下载服务端 ${(dl / 1048576).toFixed(1)} / ${(total / 1048576).toFixed(1)} MB`);
    }
  });

  sendInstallProgress(win, serverId, '✓ 服务端核心下载完成');
  return 'server.jar';
}

// ── Fabric server installation ───────────────────────────────────────────────

async function installFabricServer(serverId, sDir, mcVersion, loaderVersion, win) {
  // 1. Fetch latest stable installer version
  // URL requires: /loader/{mc}/{loader}/{installer}/server/jar
  sendInstallProgress(win, serverId, '获取 Fabric installer 版本...');
  const installers = await fetchJson(`${FABRIC_META}/versions/installer`);
  if (!Array.isArray(installers) || installers.length === 0)
    throw new Error('无法获取 Fabric installer 版本列表');
  const installerVer = (installers.find(i => i.stable) || installers[0]).version;
  sendInstallProgress(win, serverId, `使用 Fabric installer ${installerVer}`);

  // 2. Download the Fabric server launcher JAR
  const launchUrl = `${FABRIC_META}/versions/loader/${mcVersion}/${loaderVersion}/${installerVer}/server/jar`;
  const launchPath = path.join(sDir, 'fabric-server-launch.jar');
  sendInstallProgress(win, serverId, `下载 Fabric ${loaderVersion} 服务端启动器...`);
  await downloadWithFallback(launchUrl, launchUrl, launchPath, (dl, total) => {
    if (total > 0) sendInstallProgress(win, serverId,
      `下载启动器 ${(dl / 1048576).toFixed(1)} / ${(total / 1048576).toFixed(1)} MB`);
  });
  sendInstallProgress(win, serverId, '✓ Fabric 启动器下载完成');

  // 3. Pre-download vanilla server.jar — Fabric launcher needs it on first run
  await downloadVanillaServer(serverId, sDir, mcVersion, win);

  sendInstallProgress(win, serverId, `✓ Fabric ${loaderVersion} 服务端安装完成`);
  return 'fabric-server-launch.jar';
}

// ── NeoForge server installation ─────────────────────────────────────────────

// Scan for win_args.txt produced by NeoForge installer --installServer.
function findNeoForgeArgsFile(sDir, neoForgeVersion) {
  // Canonical path (neoForgeVersion = e.g. "21.4.57")
  const canonical = path.join('libraries', 'net', 'neoforged', 'neoforge', neoForgeVersion, 'win_args.txt');
  if (fs.existsSync(path.join(sDir, canonical))) return canonical;

  // Fallback: scan libraries/ recursively
  function scan(absDir, relBase) {
    let entries;
    try { entries = fs.readdirSync(absDir, { withFileTypes: true }); } catch { return null; }
    for (const e of entries) {
      if (e.isDirectory()) {
        const r = scan(path.join(absDir, e.name), path.join(relBase, e.name));
        if (r) return r;
      } else if (e.name === 'win_args.txt') {
        return path.join(relBase, e.name);
      }
    }
    return null;
  }
  const libDir = path.join(sDir, 'libraries');
  if (fs.existsSync(libDir)) return scan(libDir, 'libraries');
  return null;
}

async function installNeoForgeServer(serverId, sDir, mcVersion, neoForgeVersion, javaPath, win) {
  // Resolve java.exe
  let javaExe = (javaPath || '').trim();
  if (!javaExe) throw new Error('未配置 Java 路径，请在「设置」中配置后重试');
  if (!javaExe.endsWith('.exe')) {
    const candidate = path.join(javaExe, 'bin', 'java.exe');
    if (fs.existsSync(candidate)) javaExe = candidate;
  }
  if (javaExe.endsWith('javaw.exe')) {
    const alt = javaExe.replace('javaw.exe', 'java.exe');
    if (fs.existsSync(alt)) javaExe = alt;
  }

  // 1. Download installer jar
  const installerUrl = `${NEOFORGE_MAVEN}/${neoForgeVersion}/neoforge-${neoForgeVersion}-installer.jar`;
  const installerPath = path.join(sDir, 'neoforge-installer.jar');
  sendInstallProgress(win, serverId, `下载 NeoForge ${neoForgeVersion} 安装器...`);
  await downloadWithFallback(installerUrl, installerUrl, installerPath, (dl, total) => {
    if (total > 0) sendInstallProgress(win, serverId,
      `下载安装器 ${(dl / 1048576).toFixed(1)} / ${(total / 1048576).toFixed(1)} MB`);
  });
  sendInstallProgress(win, serverId, '✓ 安装器下载完成');

  // 2. Run installer --installServer (downloads server libs, may take minutes)
  sendInstallProgress(win, serverId,
    '运行 NeoForge 安装器（正在下载服务端依赖，可能需要数分钟，请耐心等待）...');
  await new Promise((resolve, reject) => {
    const proc = spawn(javaExe, ['-jar', installerPath, '--installServer'], {
      cwd: sDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    try { proc.stdin.end(); } catch {}

    let outBuf = '', errBuf = '';
    const onChunk = (buf, bufRef) => {
      bufRef.val += iconv.decode(buf, 'gbk');
      const lines = bufRef.val.split('\n');
      bufRef.val = lines.pop();
      for (const line of lines) {
        const t = line.trim();
        if (t) sendInstallProgress(win, serverId, t);
      }
    };
    const ob = { val: outBuf }, eb = { val: errBuf };
    proc.stdout.on('data', buf => onChunk(buf, ob));
    proc.stderr.on('data', buf => onChunk(buf, eb));

    proc.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`NeoForge 安装器以退出码 ${code} 结束，安装失败`));
    });
    proc.on('error', err => reject(new Error(`安装器启动失败: ${err.message}`)));
  });

  // 3. Locate win_args.txt
  sendInstallProgress(win, serverId, '查找启动参数文件...');
  const argsFile = findNeoForgeArgsFile(sDir, neoForgeVersion);
  if (!argsFile) throw new Error('找不到 NeoForge 启动参数文件（win_args.txt），安装可能不完整');

  sendInstallProgress(win, serverId, `✓ NeoForge ${neoForgeVersion} 服务端安装完成`);
  return argsFile; // e.g. "libraries/net/neoforged/neoforge/21.4.57/win_args.txt"
}

// ── Forge server installation ─────────────────────────────────────────────────

// Modern Forge (1.17+) produces win_args.txt under libraries/
function findForgeArgsFile(sDir, mcVersion, forgeVersion) {
  const canonical = path.join('libraries', 'net', 'minecraftforge', 'forge',
    `${mcVersion}-${forgeVersion}`, 'win_args.txt');
  if (fs.existsSync(path.join(sDir, canonical))) return canonical;

  function scan(absDir, relBase) {
    let entries;
    try { entries = fs.readdirSync(absDir, { withFileTypes: true }); } catch { return null; }
    for (const e of entries) {
      if (e.isDirectory()) {
        const r = scan(path.join(absDir, e.name), path.join(relBase, e.name));
        if (r) return r;
      } else if (e.name === 'win_args.txt') {
        return path.join(relBase, e.name);
      }
    }
    return null;
  }
  const libDir = path.join(sDir, 'libraries');
  if (fs.existsSync(libDir)) return scan(libDir, 'libraries');
  return null;
}

// Legacy Forge (≤1.16) produces a forge-*.jar in the server root
function findForgeLegacyJar(sDir, mcVersion, forgeVersion) {
  for (const name of [
    `forge-${mcVersion}-${forgeVersion}.jar`,
    `forge-${mcVersion}-${forgeVersion}-universal.jar`,
  ]) {
    if (fs.existsSync(path.join(sDir, name))) return name;
  }
  // Fallback: first forge-*.jar in root (excluding installer)
  try {
    for (const f of fs.readdirSync(sDir)) {
      if (/^forge-.+\.jar$/i.test(f) && !f.includes('installer')) return f;
    }
  } catch {}
  return null;
}

async function installForgeServer(serverId, sDir, mcVersion, forgeVersion, javaPath, win) {
  // Resolve java.exe
  let javaExe = (javaPath || '').trim();
  if (!javaExe) throw new Error('未配置 Java 路径，请在「设置」中配置后重试');
  if (!javaExe.endsWith('.exe')) {
    const candidate = path.join(javaExe, 'bin', 'java.exe');
    if (fs.existsSync(candidate)) javaExe = candidate;
  }
  if (javaExe.endsWith('javaw.exe')) {
    const alt = javaExe.replace('javaw.exe', 'java.exe');
    if (fs.existsSync(alt)) javaExe = alt;
  }

  // 1. Download Forge installer from BMCLAPI
  const installerUrl = `${BMCLAPI}/forge/download?mcversion=${mcVersion}&version=${forgeVersion}&category=installer&format=jar`;
  const installerPath = path.join(sDir, 'forge-installer.jar');
  sendInstallProgress(win, serverId, `下载 Forge ${forgeVersion} 安装器...`);
  await downloadWithFallback(installerUrl, installerUrl, installerPath, (dl, total) => {
    if (total > 0) sendInstallProgress(win, serverId,
      `下载安装器 ${(dl / 1048576).toFixed(1)} / ${(total / 1048576).toFixed(1)} MB`);
  });
  sendInstallProgress(win, serverId, '✓ 安装器下载完成');

  // 2. Run installer --installServer
  sendInstallProgress(win, serverId,
    '运行 Forge 安装器（正在下载服务端依赖，可能需要数分钟，请耐心等待）...');
  await new Promise((resolve, reject) => {
    const proc = spawn(javaExe, ['-jar', installerPath, '--installServer'], {
      cwd: sDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    try { proc.stdin.end(); } catch {}

    let outBuf = '', errBuf = '';
    const onChunk = (buf, ref) => {
      ref.v += iconv.decode(buf, 'gbk');
      const lines = ref.v.split('\n');
      ref.v = lines.pop();
      for (const line of lines) {
        const t = line.trim();
        if (t) sendInstallProgress(win, serverId, t);
      }
    };
    const ob = { v: outBuf }, eb = { v: errBuf };
    proc.stdout.on('data', buf => onChunk(buf, ob));
    proc.stderr.on('data', buf => onChunk(buf, eb));
    proc.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`Forge 安装器以退出码 ${code} 结束，安装失败`));
    });
    proc.on('error', err => reject(new Error(`安装器启动失败: ${err.message}`)));
  });

  // 3. Detect installation type
  sendInstallProgress(win, serverId, '检测安装产物...');
  const argsFile = findForgeArgsFile(sDir, mcVersion, forgeVersion);
  if (argsFile) {
    sendInstallProgress(win, serverId, `✓ Forge ${forgeVersion} 服务端安装完成（现代模式）`);
    return { argsFile, serverJar: null };
  }
  const legacyJar = findForgeLegacyJar(sDir, mcVersion, forgeVersion);
  if (legacyJar) {
    sendInstallProgress(win, serverId, `✓ Forge ${forgeVersion} 服务端安装完成（兼容模式: ${legacyJar}）`);
    return { argsFile: null, serverJar: legacyJar };
  }
  throw new Error('Forge 安装完成但找不到启动文件（win_args.txt 或 forge-*.jar），安装可能不完整');
}

// ── Create instance ───────────────────────────────────────────────────────────

async function createServer({ name, mcVersion, loader, loaderVersion, maxMemory, javaPath, port, levelSeed, levelType, generateStructures }, serversDir, win) {
  const id = (name || '').trim();
  if (!id) return { success: false, error: '服务器名不能为空' };
  if (/[\\/:*?"<>|]/.test(id)) return { success: false, error: '名称含非法字符（\\ / : * ? " < > |）' };
  if (id.length > 60) return { success: false, error: '名称不能超过 60 个字符' };

  const finalLoader = loader || 'vanilla';
  const needsLoader = ['neoforge', 'fabric', 'forge'];
  if (needsLoader.includes(finalLoader) && !loaderVersion)
    return { success: false, error: `请选择 ${finalLoader.charAt(0).toUpperCase() + finalLoader.slice(1)} 版本` };

  const sDir = serverDir(serversDir, id);
  if (fs.existsSync(sDir)) return { success: false, error: `服务器「${id}」已存在` };

  try {
    fs.mkdirSync(sDir, { recursive: true });
    fs.mkdirSync(path.join(sDir, 'mods'), { recursive: true });

    let serverJar = null;
    let argsFile  = null;

    if (finalLoader === 'neoforge') {
      argsFile = await installNeoForgeServer(id, sDir, mcVersion, loaderVersion, javaPath, win);
    } else if (finalLoader === 'fabric') {
      serverJar = await installFabricServer(id, sDir, mcVersion, loaderVersion, win);
    } else if (finalLoader === 'forge') {
      const r = await installForgeServer(id, sDir, mcVersion, loaderVersion, javaPath, win);
      argsFile  = r.argsFile;
      serverJar = r.serverJar;
    } else {
      serverJar = await downloadVanillaServer(id, sDir, mcVersion, win);
    }

    // Write initial server.properties
    const portNum = parseInt(port, 10);
    const finalPort = (portNum >= 1 && portNum <= 65535) ? portNum : 25565;
    const initLines = ['# Minecraft server properties', '# Generated by Tick', `server-port=${finalPort}`];
    if (levelSeed && String(levelSeed).trim()) initLines.push(`level-seed=${String(levelSeed).trim()}`);
    initLines.push(`level-type=${levelType || 'minecraft:normal'}`);
    initLines.push(`generate-structures=${(generateStructures === false || generateStructures === 'false') ? 'false' : 'true'}`);
    fs.writeFileSync(path.join(sDir, 'server.properties'), initLines.join('\n') + '\n', 'utf-8');
    sendInstallProgress(win, id, `已设置服务器端口: ${finalPort}`);

    const meta = {
      id,
      name: id,
      mcVersion,
      loader: finalLoader,
      loaderVersion: loaderVersion || null,
      serverJar,
      argsFile,
      javaPath: javaPath || '',
      maxMemory: maxMemory || 4096,
      port: finalPort,
      createdAt: new Date().toISOString(),
    };
    writeMeta(serversDir, id, meta);

    sendInstallProgress(win, id, `✓ 服务器「${id}」创建完成`);
    return { success: true, id };
  } catch (err) {
    try { fs.rmSync(sDir, { recursive: true, force: true }); } catch {}
    return { success: false, error: err.message };
  }
}

// ── Delete instance ───────────────────────────────────────────────────────────

function deleteServer(serverId, serversDir) {
  if (serverProcesses.has(serverId)) {
    return { success: false, error: '服务器正在运行，请先停止' };
  }
  const sDir = serverDir(serversDir, serverId);
  if (!fs.existsSync(sDir)) return { success: false, error: '服务器不存在' };
  try {
    fs.rmSync(sDir, { recursive: true, force: true });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ── EULA ──────────────────────────────────────────────────────────────────────

function checkEula(serverId, serversDir) {
  const p = path.join(serverDir(serversDir, serverId), 'eula.txt');
  if (!fs.existsSync(p)) return false;
  return fs.readFileSync(p, 'utf-8').includes('eula=true');
}

function acceptEula(serverId, serversDir) {
  const sDir = serverDir(serversDir, serverId);
  const comment = '# By changing the setting below to TRUE you are indicating your agreement\n'
    + '# to the Mojang EULA (https://aka.ms/MinecraftEULA).\n'
    + '# Generated by Tick\n';
  fs.writeFileSync(path.join(sDir, 'eula.txt'), `${comment}eula=true\n`, 'utf-8');
}

// ── Start server ──────────────────────────────────────────────────────────────

function startServer(serverId, serversDir, defaultJavaPath, win) {
  // Define sendOutput early so we can use it for pre-spawn diagnostics
  const sendOutput = (type, message) => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('server:output', { serverId, type, message });
    }
  };

  // Guard: already running
  if (serverProcesses.has(serverId)) {
    const existingProc = serverProcesses.get(serverId);
    if (existingProc.exitCode === null && !existingProc.killed) {
      return { success: false, error: '该服务器已在运行中，请先停止后再启动' };
    }
    // Stale entry: process exited but close event not fired yet — clean up
    serverProcesses.delete(serverId);
    sendOutput('info', '检测到残留进程记录，已自动清理，准备重新启动...');
  }

  const sDir = serverDir(serversDir, serverId);
  if (!fs.existsSync(metaPath(serversDir, serverId))) {
    return { success: false, error: '服务器实例不存在' };
  }

  // Guard: EULA not accepted
  if (!checkEula(serverId, serversDir)) {
    return { success: false, requiresEula: true };
  }

  const meta = readMeta(serversDir, serverId);

  // Resolve Java executable
  let javaExe = meta.javaPath || defaultJavaPath || '';
  if (!javaExe) return { success: false, error: '未配置 Java 路径，请在设置中配置' };

  if (!javaExe.endsWith('.exe')) {
    const candidate = path.join(javaExe, 'bin', 'java.exe');
    javaExe = fs.existsSync(candidate) ? candidate : javaExe;
  }
  // Prefer java.exe over javaw.exe for reliable stdio pipes
  if (javaExe.endsWith('javaw.exe')) {
    const alt = javaExe.replace('javaw.exe', 'java.exe');
    if (fs.existsSync(alt)) javaExe = alt;
  }

  // ── Java version check ──────────────────────────────────────────────────────
  const requiredMajor = getMcJavaRequirement(meta.mcVersion);
  const currentMajor  = getJavaMajorVersion(javaExe);

  // MC ≤1.16 + any modloader (Forge/Fabric/NeoForge) strictly needs Java 8.
  // Java 9+ module system seals internal APIs that old modloaders (ModLauncher 8.x)
  // depend on — running with Java 9+ causes IllegalAccessError at startup.
  const isLegacyModded = requiredMajor === 8 && meta.loader && meta.loader !== 'vanilla';

  if (currentMajor > 0 && currentMajor < requiredMajor) {
    // Java too old → try to find a newer compatible version
    sendOutput('info',
      `当前 Java ${currentMajor} 不满足 MC ${meta.mcVersion} 要求（需 Java ${requiredMajor}+），正在自动查找兼容版本...`);
    const allJavas = detectJava();
    const best = selectBestJava(allJavas, requiredMajor);
    if (best) {
      const betterExe = best.path.replace(/javaw\.exe$/i, 'java.exe');
      javaExe = fs.existsSync(betterExe) ? betterExe : best.path;
      sendOutput('info', `✓ 已自动切换至 Java ${best.major}: ${javaExe}`);
    } else {
      const msg = `未找到 Java ${requiredMajor}+，无法启动 MC ${meta.mcVersion} 服务器。\n`
        + `请安装 Java ${requiredMajor}（推荐 Eclipse Temurin: https://adoptium.net）后重试。`;
      sendOutput('error', msg);
      return { success: false, error: `需要 Java ${requiredMajor}+，当前 Java ${currentMajor}，未找到满足要求的安装` };
    }
  } else if (isLegacyModded && currentMajor > 8) {
    // Java too new for legacy modded server → try to find Java 8 specifically
    sendOutput('info',
      `MC ${meta.mcVersion} + ${meta.loader} 需要 Java 8（Java 9+ 模块系统封锁了旧版模组加载器的内部 API），正在查找 Java 8...`);
    const allJavas = detectJava();
    const java8 = allJavas.find(j => j.major === 8);
    if (java8) {
      const betterExe = java8.path.replace(/javaw\.exe$/i, 'java.exe');
      javaExe = fs.existsSync(betterExe) ? betterExe : java8.path;
      sendOutput('info', `✓ 已自动切换至 Java 8: ${javaExe}`);
    } else {
      sendOutput('error',
        `⚠ MC ${meta.mcVersion} + ${meta.loader} 需要 Java 8，但系统未找到 Java 8 安装。\n`
        + `原因：Java 9+ 的模块系统封锁了旧版模组加载器访问内部 API，会导致 IllegalAccessError 崩溃。\n`
        + `解决方法：请安装 Java 8（推荐 Eclipse Temurin: https://adoptium.net/temurin/releases/?version=8）后重试。\n`
        + `（CMCL 后续版本将支持 Java 自动管理，届时可自动下载所需 Java）`);
      return { success: false,
        error: `MC ${meta.mcVersion} + ${meta.loader} 需要 Java 8，当前 Java ${currentMajor} 不兼容，请安装 Java 8 后重试` };
    }
  } else if (currentMajor === 0) {
    sendOutput('info', `⚠ 无法检测 Java 版本（${javaExe}），尝试继续启动...`);
  }
  // ───────────────────────────────────────────────────────────────────────────

  const maxMem = meta.maxMemory || 4096;
  let spawnArgs, startDesc;

  // argsFile mode: NeoForge, or modern Forge (1.17+)
  if (meta.argsFile) {
    const argsFilePath = path.join(sDir, meta.argsFile);
    if (!fs.existsSync(argsFilePath)) {
      return { success: false, error: `启动参数文件不存在: ${meta.argsFile}` };
    }
    spawnArgs = [`-Xmx${maxMem}m`, '-Xms512m', `@${argsFilePath}`, 'nogui'];
    startDesc = `${(meta.loader || 'forge').toUpperCase()}: ${meta.argsFile}`;
  } else {
    // jar mode: Vanilla, Fabric, legacy Forge
    const jarPath = path.join(sDir, meta.serverJar || 'server.jar');
    if (!fs.existsSync(jarPath)) {
      return { success: false, error: `服务端 JAR 不存在: ${meta.serverJar}` };
    }
    spawnArgs = [`-Xmx${maxMem}m`, '-Xms512m', '-jar', jarPath, 'nogui'];
    startDesc = `JAR:   ${jarPath}`;
  }

  const proc = spawn(javaExe, spawnArgs, {
    cwd: sDir,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });

  // Windows 中文系统下 JVM 默认用 GBK 输出，用 iconv-lite 按 GBK 解码 Buffer
  proc.stdout.on('data', (buf) => sendOutput('stdout', iconv.decode(buf, 'gbk')));
  proc.stderr.on('data', (buf) => {
    const text = iconv.decode(buf, 'gbk');
    sendOutput('stderr', text);
    if (text.includes('session.lock') || text.includes('SessionLock')) {
      sendOutput('error',
        '⚠ 世界存档被锁定（session.lock 冲突）\n'
        + '原因：有残留的 Java 服务端进程未关闭，仍在占用世界文件。\n'
        + '解决步骤：\n'
        + '  1. 按 Ctrl+Shift+Esc 打开任务管理器\n'
        + '  2. 在「详细信息」标签页中找到所有 java.exe\n'
        + '  3. 右键→结束任务，关闭全部 java.exe\n'
        + '  4. 返回 CMCL 再次点击启动');
    }
  });

  proc.on('close', (code, signal) => {
    serverProcesses.delete(serverId);
    const exitDesc = code !== null ? `退出码 ${code}` : `信号 ${signal}`;
    sendOutput('exit', `服务器已停止（${exitDesc}）`);
    if (win && !win.isDestroyed()) {
      win.webContents.send('server:status', { serverId, running: false, code });
    }
  });

  proc.on('error', (err) => {
    serverProcesses.delete(serverId);
    sendOutput('error', `启动失败: ${err.message}`);
    if (err.code === 'ENOENT') {
      sendOutput('error', `找不到 Java 可执行文件: ${javaExe}`);
    }
    if (win && !win.isDestroyed()) {
      win.webContents.send('server:status', { serverId, running: false, code: -1 });
    }
  });

  serverProcesses.set(serverId, proc);

  // Immediately notify renderer that server is now running
  if (win && !win.isDestroyed()) {
    win.webContents.send('server:status', { serverId, running: true, pid: proc.pid });
  }
  sendOutput('info',
    `━━━ 服务器启动 ━━━\nJava:  ${javaExe}\n内存:  ${maxMem} MB\n${startDesc}\nPID:   ${proc.pid}\n━━━━━━━━━━━━━━━━━`);

  return { success: true, pid: proc.pid };
}

// ── Stop / kill ───────────────────────────────────────────────────────────────

// Windows-only: kill entire process tree (parent + all children) via taskkill.
// proc.kill('SIGKILL') only terminates the top-level process; /T covers the tree.
function taskkillTree(pid) {
  try {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
      windowsHide: true, timeout: 5000,
    });
  } catch { /* ignore — process may already be dead */ }
}

// Force-clean Map + notify renderer. Used as fallback when close event doesn't fire.
function forceCleanup(serverId, win) {
  if (!serverProcesses.has(serverId)) return;
  serverProcesses.delete(serverId);
  if (win && !win.isDestroyed()) {
    win.webContents.send('server:output', { serverId, type: 'exit', message: '服务器已强制终止（进程已清理）' });
    win.webContents.send('server:status', { serverId, running: false, code: -1 });
  }
}

function stopServer(serverId, win) {
  const proc = serverProcesses.get(serverId);
  if (!proc) return { success: false, error: '服务器未在运行' };

  // Graceful: send "stop" command
  try { proc.stdin.write('stop\n', 'utf8'); } catch { /* stdin may already be closed */ }

  // After 15 s: escalate to taskkill /T /F (kills entire process tree, not just parent)
  const gracefulTimer = setTimeout(() => {
    if (!serverProcesses.has(serverId)) return;
    taskkillTree(proc.pid);
    // Extra 3 s fallback: manually clean Map if close event still doesn't fire
    setTimeout(() => forceCleanup(serverId, win), 3000);
  }, 15000);
  proc.once('close', () => clearTimeout(gracefulTimer));

  return { success: true };
}

function killServer(serverId, win) {
  const proc = serverProcesses.get(serverId);
  if (!proc) return { success: false, error: '服务器未在运行' };

  // Kill entire process tree immediately
  taskkillTree(proc.pid);

  // Fallback: if close event doesn't fire within 3 s, forcibly clean up state
  const cleanup = setTimeout(() => forceCleanup(serverId, win), 3000);
  proc.once('close', () => clearTimeout(cleanup));

  return { success: true };
}

// ── Send command via stdin ────────────────────────────────────────────────────

function sendCommand(serverId, command) {
  const proc = serverProcesses.get(serverId);
  if (!proc) return { success: false, error: '服务器未在运行' };
  try {
    proc.stdin.write(command + '\n', 'utf8');
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ── Status query ──────────────────────────────────────────────────────────────

function getServerStatus(serverId) {
  const proc = serverProcesses.get(serverId);
  return proc ? { running: true, pid: proc.pid } : { running: false };
}

// ── App quit helpers ──────────────────────────────────────────────────────────

function hasRunningServers() {
  return serverProcesses.size > 0;
}

function getRunningServerIds() {
  return Array.from(serverProcesses.keys());
}

// Kill every running server before Electron quits. Uses synchronous taskkill
// to ensure all process trees are dead before the app exits.
function stopAllServers() {
  for (const [, proc] of serverProcesses) {
    try { proc.stdin.write('stop\n', 'utf8'); } catch {}
    taskkillTree(proc.pid);
  }
  serverProcesses.clear();
}

// ── server.properties ─────────────────────────────────────────────────────────

const DEFAULT_PROPERTIES = {
  // Common
  'server-port':           '25565',
  'max-players':           '20',
  'gamemode':              'survival',
  'difficulty':            'easy',
  'online-mode':           'true',
  'pvp':                   'true',
  'white-list':            'false',
  'motd':                  'A Minecraft Server',
  'allow-flight':          'false',
  // World
  'level-seed':            '',
  'level-name':            'world',
  'level-type':            'minecraft:normal',
  'generate-structures':   'true',
  // Performance
  'view-distance':         '10',
  'simulation-distance':   '10',
  'max-tick-time':         '60000',
  // Spawn
  'spawn-protection':      '16',
  'spawn-npcs':            'true',
  'spawn-animals':         'true',
  'spawn-monsters':        'true',
  // Network / admin
  'enforce-secure-profile':'true',
  'enable-command-block':  'false',
  'player-idle-timeout':   '0',
};

function parseProperties(raw) {
  const result = {};
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#') || t.startsWith('!')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    result[t.slice(0, eq).trim()] = t.slice(eq + 1);
  }
  return result;
}

function serializeProperties(originalRaw, updates) {
  const lines = originalRaw.split(/\r?\n/);
  const written = new Set();
  const out = lines.map(line => {
    const t = line.trim();
    if (!t || t.startsWith('#') || t.startsWith('!')) return line;
    const eq = t.indexOf('=');
    if (eq < 0) return line;
    const key = t.slice(0, eq).trim();
    if (key in updates) { written.add(key); return `${key}=${updates[key]}`; }
    return line;
  });
  for (const [k, v] of Object.entries(updates)) {
    if (!written.has(k)) out.push(`${k}=${v}`);
  }
  return out.join('\n');
}

function getProperties(serverId, serversDir) {
  const propsPath = path.join(serverDir(serversDir, serverId), 'server.properties');
  if (!fs.existsSync(propsPath)) {
    return { raw: '', parsed: { ...DEFAULT_PROPERTIES } };
  }
  const raw = fs.readFileSync(propsPath, 'utf-8');
  // Merge defaults so UI always has all keys
  const parsed = { ...DEFAULT_PROPERTIES, ...parseProperties(raw) };
  return { raw, parsed };
}

function saveProperties(serverId, serversDir, updates) {
  const propsPath = path.join(serverDir(serversDir, serverId), 'server.properties');
  const raw = fs.existsSync(propsPath) ? fs.readFileSync(propsPath, 'utf-8') : '';
  fs.writeFileSync(propsPath, serializeProperties(raw, updates), 'utf-8');
  return { success: true };
}

function worldExists(serverId, serversDir) {
  const sDir = serverDir(serversDir, serverId);
  const propsPath = path.join(sDir, 'server.properties');
  let levelName = 'world';
  if (fs.existsSync(propsPath)) {
    const parsed = parseProperties(fs.readFileSync(propsPath, 'utf-8'));
    levelName = (parsed['level-name'] || 'world').trim() || 'world';
  }
  return { exists: fs.existsSync(path.join(sDir, levelName)) };
}

function rebuildWorld(serverId, serversDir, { seed, levelType, generateStructures }) {
  const proc = serverProcesses.get(serverId);
  if (proc && proc.exitCode === null && !proc.killed) {
    return { success: false, error: '服务器正在运行，请先停止后再重建世界' };
  }

  const sDir = serverDir(serversDir, serverId);
  if (!fs.existsSync(sDir)) return { success: false, error: '服务器不存在' };

  const propsPath = path.join(sDir, 'server.properties');
  let levelName = 'world';
  if (fs.existsSync(propsPath)) {
    const parsed = parseProperties(fs.readFileSync(propsPath, 'utf-8'));
    levelName = (parsed['level-name'] || 'world').trim() || 'world';
  }

  // Explicit empty check — the two-tier fallback above should prevent this,
  // but guard here so refactors can't accidentally introduce a blank levelName.
  if (!levelName) {
    return { success: false, error: 'level-name 为空，无法确定世界目录，拒绝操作' };
  }

  // Guard 1: levelName must be a simple directory name — no path separators,
  // no leading dots (blocks "..", ".", embedded "world/../mods", etc.)
  if (/[/\\]/.test(levelName) || levelName.startsWith('.')) {
    return { success: false, error: `level-name "${levelName}" 含路径分隔符或以点开头，拒绝操作` };
  }

  // Guard 2: levelName must not collide with any critical file or directory inside sDir
  const PROTECTED_NAMES = new Set([
    'mods', 'config', 'plugins', 'logs', 'crash-reports', 'libraries',
    'server.jar', 'fabric-server-launch.jar', 'neoforge-installer.jar', 'forge-installer.jar',
    'cmcl-server.json', 'eula.txt', 'server.properties',
    'ops.json', 'whitelist.json', 'banned-players.json', 'banned-ips.json',
  ]);
  if (PROTECTED_NAMES.has(levelName.toLowerCase())) {
    return { success: false, error: `level-name "${levelName}" 与关键文件/目录重名，拒绝操作` };
  }

  // Guard 3: path.resolve check — final safety net, confirms world dir is strictly
  // inside sDir (after guards 1+2 this should always pass for legitimate names)
  const resolvedSDir = path.resolve(sDir);
  const worldPath = path.resolve(sDir, levelName);
  if (!worldPath.startsWith(resolvedSDir + path.sep)) {
    return { success: false, error: '世界目录路径异常，拒绝操作' };
  }

  const dirsToDelete = [
    worldPath,
    path.resolve(sDir, `${levelName}_nether`),
    path.resolve(sDir, `${levelName}_the_end`),
  ];

  try {
    for (const p of dirsToDelete) {
      if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
    }
  } catch (err) {
    return { success: false, error: `删除世界目录失败: ${err.message}` };
  }

  const updates = {
    'level-seed': (seed && seed.trim()) ? seed.trim() : '',
    'level-type': levelType || 'minecraft:normal',
    'generate-structures': (generateStructures === false || generateStructures === 'false') ? 'false' : 'true',
  };

  try {
    saveProperties(serverId, serversDir, updates);
  } catch (err) {
    return { success: false, error: `更新配置失败: ${err.message}` };
  }

  return { success: true };
}

// ── Player data (read JSON files from server directory) ───────────────────────
// Reading JSON is always allowed even when server is not running.
// Operations (via stdin commands) require the server to be running—that check
// lives in the frontend.

function readPlayerData(serverId, serversDir) {
  const sDir = serverDir(serversDir, serverId);

  function safeJson(filename) {
    const p = path.join(sDir, filename);
    try {
      if (!fs.existsSync(p)) return [];
      const arr = JSON.parse(fs.readFileSync(p, 'utf-8'));
      return Array.isArray(arr) ? arr : [];
    } catch { return []; }
  }

  return {
    ops:           safeJson('ops.json'),
    bannedPlayers: safeJson('banned-players.json'),
    bannedIPs:     safeJson('banned-ips.json'),
    whitelist:     safeJson('whitelist.json'),
  };
}

// ── Server mod list ───────────────────────────────────────────────────────────

function listServerMods(serverId, serversDir) {
  const modsDir = path.join(serverDir(serversDir, serverId), 'mods');
  if (!fs.existsSync(modsDir)) return [];
  try {
    return fs.readdirSync(modsDir)
      .filter(f => f.toLowerCase().endsWith('.jar'))
      .sort();
  } catch { return []; }
}

// Read the declared mod ID from a JAR's metadata (neoforge.mods.toml / fabric.mod.json).
// Returns the primary modId string, or null if the JAR can't be read / has no metadata.
async function getModIdFromJar(jarPath) {
  const zip = new StreamZip.async({ file: jarPath });
  try {
    const entries = await zip.entries();

    // NeoForge (1.20.5+) and legacy Forge use TOML
    for (const name of ['META-INF/neoforge.mods.toml', 'META-INF/mods.toml']) {
      if (!(name in entries)) continue;
      try {
        const buf  = await zip.entryData(name);
        const toml = buf.toString('utf-8');
        // [[mods]] section declares the primary modId; split on that header
        const parts = toml.split(/\[\[mods\]\]/i);
        if (parts.length > 1) {
          const block = parts[1].split(/\[\[/)[0]; // stop before next [[…]] section
          const m = block.match(/modId\s*=\s*"([^"]+)"/);
          if (m) return m[1];
        }
      } catch { /* malformed TOML — skip */ }
    }

    // Fabric / Quilt
    if ('fabric.mod.json' in entries) {
      try {
        const buf  = await zip.entryData('fabric.mod.json');
        const json = JSON.parse(buf.toString('utf-8'));
        if (json.id) return json.id;
      } catch { /* malformed JSON */ }
    }

    return null;
  } catch { return null; }
  finally { await zip.close().catch(() => {}); }
}

// Remove a server mod by its declared modId.
// Reads neoforge.mods.toml / fabric.mod.json from each JAR in mods/ to find
// an EXACT match — never touches a mod with a different modId, even if the
// filenames share a common prefix (e.g. "create" ≠ "createaddition").
async function removeServerModById(serverId, serversDir, modId) {
  const modsDir = path.join(serverDir(serversDir, serverId), 'mods');
  if (!fs.existsSync(modsDir)) return { success: false, error: 'mods 目录不存在' };

  let files;
  try { files = fs.readdirSync(modsDir); }
  catch (err) { return { success: false, error: err.message }; }

  const jarFiles = files.filter(f => {
    const l = f.toLowerCase();
    return l.endsWith('.jar') || l.endsWith('.jar.disabled');
  });

  const idLc = modId.toLowerCase().trim();
  const BATCH = 16; // scan 16 JARs in parallel; safe for OS fd limits
  let targetFile = null;

  outer:
  for (let i = 0; i < jarFiles.length; i += BATCH) {
    const batch = jarFiles.slice(i, i + BATCH);
    const results = await Promise.all(batch.map(async f => ({
      file: f,
      realId: await getModIdFromJar(path.join(modsDir, f)),
    })));
    for (const { file, realId } of results) {
      if (realId && realId.toLowerCase() === idLc) { targetFile = file; break outer; }
    }
  }

  if (!targetFile) {
    return {
      success: false,
      error: `在 mods/ 中找不到 modId="${modId}" 的 JAR（可手动删除）`,
      notFound: true,
    };
  }

  try {
    fs.unlinkSync(path.join(modsDir, targetFile));
    return { success: true, removed: targetFile };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  listServers,
  createServer,
  deleteServer,
  startServer,
  stopServer,
  killServer,
  sendCommand,
  getServerStatus,
  checkEula,
  acceptEula,
  getProperties,
  saveProperties,
  worldExists,
  rebuildWorld,
  hasRunningServers,
  getRunningServerIds,
  stopAllServers,
  readPlayerData,
  listServerMods,
  removeServerModById,
};
