'use strict';
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const AdmZip = require('adm-zip');
const StreamZip = require('node-stream-zip');
const archiver = require('archiver');
const { fetchJson } = require('./versionHandler');
const { downloadVersion, downloadFiles } = require('./downloadHandler');
const { installFabric, installNeoForge, installForge } = require('./modLoaderHandler');
const serverHandler = require('./serverHandler');

const BMCLAPI = 'https://bmclapi2.bangbang93.com';

// ── Progress ──────────────────────────────────────────────────────────────────

function sendProgress(win, data) {
  if (win && !win.isDestroyed()) {
    win.webContents.send('mrpack:progress', data);
  }
}

// ── Path traversal prevention ─────────────────────────────────────────────────
// Ensures relPath stays strictly within baseDir after normalization.
// Throws on absolute paths, ../ escapes, or Windows device paths.

function safeJoinPath(baseDir, relPath) {
  if (!relPath || typeof relPath !== 'string') throw new Error('路径为空');

  // Reject obvious attacks early
  const rel = relPath.replace(/\\/g, '/');
  if (path.isAbsolute(rel) || path.isAbsolute(relPath)) {
    throw new Error(`非法路径（绝对路径）: ${relPath}`);
  }

  const base = path.resolve(baseDir);
  const target = path.resolve(path.join(base, relPath));

  // Must start with base + sep (or equal base for the dir itself)
  if (target !== base && !target.startsWith(base + path.sep)) {
    throw new Error(`非法路径（路径穿越）: ${relPath}`);
  }
  return target;
}

// ── Parse ─────────────────────────────────────────────────────────────────────

function parseMrpack(filePath) {
  let zip;
  try {
    zip = new AdmZip(filePath);
  } catch (e) {
    throw new Error(`无法读取文件（可能已损坏或不是有效的 .mrpack）: ${e.message}`);
  }

  const indexEntry = zip.getEntry('modrinth.index.json');
  if (!indexEntry) throw new Error('不是有效的 .mrpack 文件（找不到 modrinth.index.json）');

  let manifest;
  try {
    manifest = JSON.parse(zip.readAsText('modrinth.index.json'));
  } catch {
    throw new Error('modrinth.index.json 解析失败，文件可能已损坏');
  }

  if (manifest.game !== 'minecraft') {
    throw new Error(`不支持的游戏类型: ${manifest.game}`);
  }
  if (manifest.formatVersion !== 1) {
    throw new Error(`不支持的 mrpack 格式版本: ${manifest.formatVersion}`);
  }
  if (!manifest.dependencies?.minecraft) {
    throw new Error('清单缺少 minecraft 版本信息');
  }
  if (!Array.isArray(manifest.files)) {
    throw new Error('清单 files 字段格式错误');
  }

  return { manifest, zip };
}

// ── Loader detection ──────────────────────────────────────────────────────────

function detectLoader(dependencies) {
  if (dependencies['quilt-loader']) {
    throw new Error('Quilt 加载器暂不支持，请使用同整合包的 Fabric 版本导入');
  }
  if (dependencies['fabric-loader']) {
    return { loader: 'fabric', loaderVersion: dependencies['fabric-loader'] };
  }
  if (dependencies['neoforge']) {
    return { loader: 'neoforge', loaderVersion: dependencies['neoforge'] };
  }
  if (dependencies['forge']) {
    return { loader: 'forge', loaderVersion: dependencies['forge'] };
  }
  return { loader: null, loaderVersion: null }; // vanilla
}

// ── env filtering ─────────────────────────────────────────────────────────────

function filterFiles(files, side) {
  return (files || []).filter(file => {
    if (!file.env) return true; // no restriction → include
    return file.env[side] !== 'unsupported';
  });
}

// ── Hash verification ─────────────────────────────────────────────────────────

function verifySha512(filePath, expected) {
  if (!expected) return true;
  try {
    const data = fs.readFileSync(filePath);
    const actual = crypto.createHash('sha512').update(data).digest('hex');
    return actual === expected.toLowerCase();
  } catch {
    return false;
  }
}

// ── Mod download ──────────────────────────────────────────────────────────────

async function downloadMrpackFiles(filteredFiles, instanceDir, win) {
  const fileList = [];

  for (const file of filteredFiles) {
    if (!file.path) continue;

    let dest;
    try {
      dest = safeJoinPath(instanceDir, file.path);
    } catch (e) {
      sendProgress(win, { phase: 'mods', message: `⚠ 跳过非法路径: ${file.path} (${e.message})` });
      continue;
    }

    const urls = file.downloads || [];
    if (urls.length === 0) {
      sendProgress(win, { phase: 'mods', message: `⚠ 跳过无下载链接: ${path.basename(file.path)}` });
      continue;
    }

    fileList.push({
      url: urls[0],
      // Second URL as fallback for downloadWithFallback logic inside downloadFiles
      originalUrl: urls.length > 1 ? urls[1] : urls[0],
      dest,
      name: path.basename(file.path),
      sha512: file.hashes?.sha512 || null,
    });
  }

  const total = fileList.length;
  if (total === 0) {
    sendProgress(win, { phase: 'mods', message: '无需下载 Mod 文件', completed: 0, total: 0 });
    return { failed: [] };
  }

  sendProgress(win, { phase: 'mods', message: `开始下载 ${total} 个 Mod 文件...`, completed: 0, total });

  // downloadFiles returns the list of files that failed to download
  const dlFailed = await downloadFiles(
    fileList.map(f => ({ url: f.url, originalUrl: f.originalUrl, dest: f.dest, name: f.name })),
    8,
    (done, tot, name) => {
      sendProgress(win, { phase: 'mods', message: `下载 Mod ${done}/${tot}: ${name}`, completed: done, total: tot });
    },
  );

  const dlFailedDests = new Set(dlFailed.map(f => f.dest));
  const failed = [];

  // Verify hashes for successfully downloaded files
  let hashFailCount = 0;
  for (const file of fileList) {
    if (dlFailedDests.has(file.dest)) {
      failed.push({ name: file.name, reason: '下载失败（网络错误或超时）' });
      continue;
    }
    if (file.sha512 && !verifySha512(file.dest, file.sha512)) {
      // Delete corrupted file so a retry would re-download it
      try { fs.unlinkSync(file.dest); } catch {}
      failed.push({ name: file.name, reason: '哈希校验失败（文件可能已损坏）' });
      hashFailCount++;
    }
  }

  if (hashFailCount > 0) {
    sendProgress(win, { phase: 'mods', message: `⚠ ${hashFailCount} 个文件哈希校验失败，已删除（可重新导入补全）` });
  }

  const okCount = total - failed.length;
  sendProgress(win, { phase: 'mods', message: `✓ Mod 下载完成: ${okCount}/${total} 成功${failed.length > 0 ? `，${failed.length} 个失败` : ''}`, completed: total, total });

  return { failed };
}

// ── Copy overrides ────────────────────────────────────────────────────────────

function copyOverrides(zip, folderName, destDir) {
  const prefix = folderName + '/';
  const entries = zip.getEntries().filter(e =>
    e.entryName.startsWith(prefix) && !e.isDirectory,
  );

  let copied = 0;
  for (const entry of entries) {
    const relPath = entry.entryName.slice(prefix.length);
    if (!relPath) continue;

    let destPath;
    try {
      destPath = safeJoinPath(destDir, relPath);
    } catch {
      continue; // skip paths that escape destDir
    }

    try {
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.writeFileSync(destPath, entry.getData());
      copied++;
    } catch {
      // Non-fatal: skip individual file copy failures
    }
  }
  return copied;
}

// ── Fetch MC version URL ──────────────────────────────────────────────────────

async function fetchMcVersionUrl(mcVersion) {
  let manifest;
  try {
    manifest = await fetchJson(`${BMCLAPI}/mc/game/version_manifest.json`);
  } catch {
    manifest = await fetchJson('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json');
  }
  const vInfo = (manifest.versions || []).find(v => v.id === mcVersion);
  if (!vInfo) throw new Error(`未找到 MC 版本 ${mcVersion}（不在版本列表中）`);
  return vInfo.url;
}

// ── Client import ─────────────────────────────────────────────────────────────

async function importMrpackAsClient(filePath, instanceName, { minecraftDir, javaPath }, win) {
  const instanceDir = path.join(minecraftDir, 'versions', instanceName);
  let instanceDirCreated = false;

  try {
    // ── 0. Name conflict check — first gate, before any file operation ────────
    if (fs.existsSync(instanceDir)) {
      throw new Error(`实例「${instanceName}」已存在，请换一个名称`);
    }

    // ── 1. Parse manifest ────────────────────────────────────────────────────
    sendProgress(win, { phase: 'parse', message: '解析整合包清单...' });
    const { manifest, zip } = parseMrpack(filePath);
    const mcVersion = manifest.dependencies.minecraft;
    const { loader, loaderVersion } = detectLoader(manifest.dependencies);
    const clientFiles = filterFiles(manifest.files, 'client');

    sendProgress(win, {
      phase: 'parse',
      message: `整合包: ${manifest.name || '(未命名)'} | MC ${mcVersion} | ${loader ? `${loader} ${loaderVersion}` : '原版'} | ${clientFiles.length} 个客户端 Mod`,
    });

    // Upfront Java check for loaders that need it
    if ((loader === 'forge' || loader === 'neoforge') && !(javaPath || '').trim()) {
      throw new Error('Forge / NeoForge 安装需要 Java，请先在「设置」页配置 Java 路径');
    }

    // ── 2. Download MC base version ──────────────────────────────────────────
    sendProgress(win, { phase: 'mc-download', message: `获取 MC ${mcVersion} 版本信息...` });
    const versionUrl = await fetchMcVersionUrl(mcVersion);
    sendProgress(win, { phase: 'mc-download', message: `下载 MC ${mcVersion} 核心文件（已有则跳过）...` });
    await downloadVersion({ id: mcVersion, url: versionUrl }, minecraftDir, 'bmclapi', win);
    sendProgress(win, { phase: 'mc-download', message: `✓ MC ${mcVersion} 已就绪` });

    // ── 3. Install loader ────────────────────────────────────────────────────
    let loaderId = mcVersion; // vanilla: inherits from mc version directly
    if (loader === 'fabric') {
      sendProgress(win, { phase: 'loader', message: `安装 Fabric ${loaderVersion}...` });
      loaderId = await installFabric(mcVersion, loaderVersion, minecraftDir, win);
      sendProgress(win, { phase: 'loader', message: `✓ Fabric ${loaderVersion} 安装完成` });
    } else if (loader === 'neoforge') {
      sendProgress(win, { phase: 'loader', message: `安装 NeoForge ${loaderVersion}...` });
      loaderId = await installNeoForge(mcVersion, loaderVersion, minecraftDir, javaPath, win);
      sendProgress(win, { phase: 'loader', message: `✓ NeoForge ${loaderVersion} 安装完成` });
    } else if (loader === 'forge') {
      sendProgress(win, { phase: 'loader', message: `安装 Forge ${loaderVersion}...` });
      loaderId = await installForge(mcVersion, loaderVersion, minecraftDir, javaPath, win);
      sendProgress(win, { phase: 'loader', message: `✓ Forge ${loaderVersion} 安装完成` });
    }

    // ── 4. Create instance directory ─────────────────────────────────────────
    sendProgress(win, { phase: 'instance', message: `创建实例「${instanceName}」...` });
    fs.mkdirSync(instanceDir, { recursive: true });
    instanceDirCreated = true;
    fs.mkdirSync(path.join(instanceDir, 'mods'), { recursive: true });
    fs.mkdirSync(path.join(instanceDir, 'saves'), { recursive: true });

    const instanceJson = {
      id: instanceName,
      inheritsFrom: loaderId,
      type: 'release',
      releaseTime: new Date().toISOString(),
      _cmcl: {
        name: instanceName,
        mcVersion,
        modLoader: loader,
        loaderVersion: loaderVersion || null,
        createdAt: new Date().toISOString(),
        fromMrpack: manifest.name || null,
      },
    };
    fs.writeFileSync(
      path.join(instanceDir, `${instanceName}.json`),
      JSON.stringify(instanceJson, null, 2),
    );
    sendProgress(win, { phase: 'instance', message: '✓ 实例目录已创建' });

    // ── 5. Download mods ─────────────────────────────────────────────────────
    const { failed } = await downloadMrpackFiles(clientFiles, instanceDir, win);

    // ── 6. Copy overrides ────────────────────────────────────────────────────
    sendProgress(win, { phase: 'overrides', message: '复制 overrides 文件...' });
    const n1 = copyOverrides(zip, 'overrides', instanceDir);
    const n2 = copyOverrides(zip, 'client-overrides', instanceDir);
    const overrideCount = n1 + n2;
    sendProgress(win, {
      phase: 'overrides',
      message: overrideCount > 0 ? `✓ 已复制 ${overrideCount} 个配置文件` : '无 overrides 文件',
    });

    // ── Done ─────────────────────────────────────────────────────────────────
    const successCount = clientFiles.length - failed.length;
    sendProgress(win, {
      phase: 'done',
      message: `✓ 导入完成！实例「${instanceName}」已创建，${successCount}/${clientFiles.length} 个 Mod 安装成功`,
    });

    return { success: true, instanceId: instanceName, failedMods: failed };

  } catch (err) {
    sendProgress(win, { phase: 'error', message: `✗ 导入失败: ${err.message}` });
    // Only clean up the directory if THIS import created it — never touch pre-existing instances
    if (instanceDirCreated && fs.existsSync(instanceDir)) {
      try { fs.rmSync(instanceDir, { recursive: true, force: true }); } catch {}
      sendProgress(win, { phase: 'error', message: '已清理不完整的实例目录' });
    }
    return { success: false, error: err.message };
  }
}

// ── Server import ─────────────────────────────────────────────────────────────

async function importMrpackAsServer(filePath, serverName, { serversDir, javaPath, maxMemory, port }, win) {
  try {
    // ── 1. Parse manifest ────────────────────────────────────────────────────
    sendProgress(win, { phase: 'parse', message: '解析整合包清单...' });
    const { manifest, zip } = parseMrpack(filePath);
    const mcVersion = manifest.dependencies.minecraft;
    const { loader, loaderVersion } = detectLoader(manifest.dependencies);
    // Include ALL files — no env-based filtering.
    // Some packs use compatibility layers (Sinytra Connector, etc.) that make
    // "client-only" mods run on the server. Filtering here breaks those packs.
    const allFiles = manifest.files || [];

    sendProgress(win, {
      phase: 'parse',
      message: `整合包: ${manifest.name || '(未命名)'} | MC ${mcVersion} | ${loader ? `${loader} ${loaderVersion}` : '原版'} | Mod: ${allFiles.length} 个（完整导入，不过滤）`,
    });

    // ── 2. Create server (installs loader + server.jar) ──────────────────────
    sendProgress(win, { phase: 'server-create', message: `创建服务端「${serverName}」并安装 ${loader || 'vanilla'}...` });
    const createResult = await serverHandler.createServer({
      name: serverName,
      mcVersion,
      loader: loader || 'vanilla',
      loaderVersion: loaderVersion || null,
      maxMemory: maxMemory || 4096,
      javaPath: javaPath || '',
      port: port || 25565,
    }, serversDir, win);

    if (!createResult.success) {
      throw new Error(`服务端创建失败: ${createResult.error}`);
    }
    sendProgress(win, { phase: 'server-create', message: `✓ 服务端「${serverName}」创建完成` });

    // ── 3. Download all mods ─────────────────────────────────────────────────
    const serverDir = path.join(serversDir, serverName);
    const { failed } = await downloadMrpackFiles(allFiles, serverDir, win);

    // ── 4. Copy overrides ────────────────────────────────────────────────────
    sendProgress(win, { phase: 'overrides', message: '复制 overrides 文件...' });
    const n1 = copyOverrides(zip, 'server-overrides', serverDir);
    const n2 = copyOverrides(zip, 'overrides', serverDir);
    const overrideCount = n1 + n2;
    sendProgress(win, {
      phase: 'overrides',
      message: overrideCount > 0 ? `✓ 已复制 ${overrideCount} 个配置文件` : '无 overrides 文件',
    });

    // ── Done ─────────────────────────────────────────────────────────────────
    const successCount = allFiles.length - failed.length;
    sendProgress(win, {
      phase: 'done',
      message: `✓ 服务端整合包导入完成！${successCount}/${allFiles.length} 个 Mod 安装成功`,
    });

    return { success: true, serverId: serverName, failedMods: failed };

  } catch (err) {
    sendProgress(win, { phase: 'error', message: `✗ 服务端导入失败: ${err.message}` });
    return { success: false, error: err.message };
  }
}

// ── CurseForge / HMCL local-pack support (streaming, no 2 GiB limit) ─────────
//
// Uses node-stream-zip which reads only the zip central directory via positioned
// I/O, then streams each entry on demand. Never loads the whole archive into
// memory — handles 8+ GiB packs fine.

// Helper: open a StreamZip.async, run fn(zip), always close on exit.
async function withZip(filePath, fn) {
  const zip = new StreamZip.async({ file: filePath });
  try {
    return await fn(zip);
  } finally {
    await zip.close().catch(() => {});
  }
}

// Detect format by reading only the central directory (fast for any file size).
async function detectFormat(filePath) {
  return withZip(filePath, async (zip) => {
    const entries = await zip.entries();
    if ('modrinth.index.json' in entries) return 'mrpack';
    if ('manifest.json'       in entries) return 'curseforge';
    throw new Error('不支持的整合包格式（找不到 modrinth.index.json 或 manifest.json）');
  });
}

// Parse CF manifest.json and count overrides stats — no file data extracted.
// Opens and closes its own StreamZip; does NOT keep zip open.
async function parseLocalPackManifest(filePath) {
  return withZip(filePath, async (zip) => {
    const entries = await zip.entries();
    if (!('manifest.json' in entries)) throw new Error('找不到 manifest.json');

    let mf;
    try {
      const buf = await zip.entryData('manifest.json');
      mf = JSON.parse(buf.toString('utf-8'));
    } catch (e) {
      throw new Error(`manifest.json 解析失败: ${e.message}`);
    }

    if (mf.manifestType !== 'minecraftModpack') {
      throw new Error(`不是 Minecraft 整合包（manifestType: ${mf.manifestType || '未知'}）`);
    }
    const mcVersion = mf.minecraft?.version;
    if (!mcVersion) throw new Error('清单缺少 minecraft.version');

    const modLoaders = mf.minecraft?.modLoaders || [];
    const primary = modLoaders.find(l => l.primary) || modLoaders[0];
    let loader = null, loaderVersion = null;
    if (primary?.id) {
      const id = primary.id;
      if      (id.startsWith('neoforge-')) { loader = 'neoforge'; loaderVersion = id.slice('neoforge-'.length); }
      else if (id.startsWith('forge-'))    { loader = 'forge';    loaderVersion = id.slice('forge-'.length); }
      else if (id.startsWith('fabric-'))   { loader = 'fabric';   loaderVersion = id.slice('fabric-'.length); }
      else if (id.startsWith('quilt-'))    { throw new Error('Quilt 加载器暂不支持，请使用同整合包的 Fabric 版本'); }
    }

    const overridesDir = mf.overrides || 'overrides';
    const networkFiles = mf.files || [];
    const prefix       = overridesDir + '/';
    const modPfxLc     = (prefix + 'mods/').toLowerCase();

    let bundledModCount = 0, overridesFileCount = 0;
    for (const name of Object.keys(entries)) {
      if (entries[name].isDirectory || !name.startsWith(prefix)) continue;
      overridesFileCount++;
      if (name.toLowerCase().startsWith(modPfxLc) && name.toLowerCase().endsWith('.jar')) bundledModCount++;
    }

    return {
      mcVersion, loader, loaderVersion, overridesDir,
      bundledModCount, networkFileCount: networkFiles.length, overridesFileCount,
      name: mf.name || '', version: mf.version || '',
    };
  });
}

// Unified preview — single zip open for both formats.
// For CF packs this reads the central directory exactly once (was twice before),
// which matters when the pack contains tens-of-thousands of save/chunk files.
async function detectAndParse(filePath) {
  return withZip(filePath, async (zip) => {
    const entries = await zip.entries();

    // ── .mrpack ───────────────────────────────────────────────────────────────
    if ('modrinth.index.json' in entries) {
      let manifest;
      try {
        const buf = await zip.entryData('modrinth.index.json');
        manifest = JSON.parse(buf.toString('utf-8'));
      } catch { throw new Error('modrinth.index.json 解析失败'); }
      if (manifest.game !== 'minecraft') throw new Error(`不支持的游戏类型: ${manifest.game}`);
      if (!manifest.dependencies?.minecraft) throw new Error('清单缺少 minecraft 版本信息');
      const deps      = manifest.dependencies || {};
      const allFiles  = manifest.files || [];
      const { loader, loaderVersion } = detectLoader(deps);
      const clientCount = filterFiles(allFiles, 'client').length;
      return {
        packFormat: 'mrpack',
        name: manifest.name || '', mcVersion: deps.minecraft || '',
        loader, loaderVersion,
        modCount: clientCount, networkModCount: clientCount, bundledModCount: 0,
        warnCfNetworkFiles: false,
      };
    }

    // ── CurseForge / HMCL ─────────────────────────────────────────────────────
    if (!('manifest.json' in entries)) {
      throw new Error('不支持的整合包格式（找不到 modrinth.index.json 或 manifest.json）');
    }

    let mf;
    try {
      const buf = await zip.entryData('manifest.json');
      mf = JSON.parse(buf.toString('utf-8'));
    } catch (e) { throw new Error(`manifest.json 解析失败: ${e.message}`); }

    if (mf.manifestType !== 'minecraftModpack') {
      throw new Error(`不是 Minecraft 整合包（manifestType: ${mf.manifestType || '未知'}）`);
    }
    const mcVersion = mf.minecraft?.version;
    if (!mcVersion) throw new Error('清单缺少 minecraft.version');

    const modLoaders = mf.minecraft?.modLoaders || [];
    const primary    = modLoaders.find(l => l.primary) || modLoaders[0];
    let loader = null, loaderVersion = null;
    if (primary?.id) {
      const id = primary.id;
      if      (id.startsWith('neoforge-')) { loader = 'neoforge'; loaderVersion = id.slice('neoforge-'.length); }
      else if (id.startsWith('forge-'))    { loader = 'forge';    loaderVersion = id.slice('forge-'.length); }
      else if (id.startsWith('fabric-'))   { loader = 'fabric';   loaderVersion = id.slice('fabric-'.length); }
      else if (id.startsWith('quilt-'))    { throw new Error('Quilt 加载器暂不支持'); }
    }

    const overridesDir = mf.overrides || 'overrides';
    const networkFiles = mf.files || [];
    const prefix   = overridesDir + '/';
    const modPfxLc = (prefix + 'mods/').toLowerCase();

    let bundledModCount = 0, overridesFileCount = 0;
    for (const name of Object.keys(entries)) {
      if (entries[name].isDirectory || !name.startsWith(prefix)) continue;
      overridesFileCount++;
      if (name.toLowerCase().startsWith(modPfxLc) && name.toLowerCase().endsWith('.jar')) bundledModCount++;
    }

    return {
      packFormat: 'curseforge',
      name: mf.name || '', mcVersion, loader, loaderVersion,
      modCount: bundledModCount, networkModCount: networkFiles.length,
      bundledModCount, overridesFileCount,
      warnCfNetworkFiles: networkFiles.length > 0,
    };
  });
}

// Stream-extract overrides/ into instanceDir, one entry at a time.
// Opens its own StreamZip so we never hold the full archive in memory.
async function copyLocalPackOverrides(filePath, overridesDir, instanceDir, win) {
  return withZip(filePath, async (zip) => {
    const entries = await zip.entries();
    const prefix  = overridesDir + '/';
    const names   = Object.keys(entries).filter(n => !entries[n].isDirectory && n.startsWith(prefix));
    const total   = names.length;

    if (total === 0) {
      sendProgress(win, { phase: 'overrides', message: 'overrides 目录为空' });
      return 0;
    }

    sendProgress(win, {
      phase: 'overrides',
      message: `开始解压 ${total} 个文件（mod、config、脚本等）...`,
      completed: 0, total,
    });

    let done = 0, skipped = 0;

    for (const entryName of names) {
      const relPath = entryName.slice(prefix.length);
      if (!relPath) continue;

      let destPath;
      try { destPath = safeJoinPath(instanceDir, relPath); }
      catch { skipped++; continue; }

      try {
        await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
        // zip.extract streams one entry to destPath — no full-file Buffer
        await zip.extract(entryName, destPath);
        done++;
      } catch { skipped++; }

      // Progress every 5 files so user sees movement during large JAR extraction
      if ((done + skipped) % 5 === 0 || done + skipped === total) {
        sendProgress(win, {
          phase: 'overrides',
          message: `解压 ${done + skipped}/${total}: ${path.basename(relPath)}`,
          completed: done + skipped, total,
        });
      }
    }

    if (skipped > 0) {
      sendProgress(win, { phase: 'overrides', message: `⚠ ${skipped} 个文件跳过（路径非法或写入失败）` });
    }
    return done;
  });
}

// Full CurseForge / HMCL local-pack client import.
// Step 1 parses manifest (closes zip); step 5 re-opens zip for streaming extraction.
async function importLocalPackAsClient(filePath, instanceName, { minecraftDir, javaPath }, win) {
  const instanceDir = path.join(minecraftDir, 'versions', instanceName);
  let instanceDirCreated = false;

  try {
    // ── 0. Name conflict check — first gate, before any file operation ────────
    if (fs.existsSync(instanceDir)) {
      throw new Error(`实例「${instanceName}」已存在，请换一个名称`);
    }

    // ── 1. Parse manifest (streaming, zip auto-closed) ────────────────────────
    sendProgress(win, { phase: 'parse', message: '解析整合包清单...' });
    const parsed = await parseLocalPackManifest(filePath);
    const { mcVersion, loader, loaderVersion, overridesDir, bundledModCount, networkFileCount } = parsed;

    sendProgress(win, {
      phase: 'parse',
      message: `整合包: ${parsed.name || '(未命名)'} | MC ${mcVersion} | ${loader ? `${loader} ${loaderVersion}` : '原版'} | ${bundledModCount} 个 Mod（已内嵌）${networkFileCount > 0 ? `，另有 ${networkFileCount} 个 CurseForge 引用文件无法自动下载` : ''}`,
    });

    if ((loader === 'forge' || loader === 'neoforge') && !(javaPath || '').trim()) {
      throw new Error('Forge / NeoForge 安装需要 Java，请先在「设置」页配置 Java 路径');
    }

    // ── 2. Download MC base version ───────────────────────────────────────────
    sendProgress(win, { phase: 'mc-download', message: `获取 MC ${mcVersion} 版本信息...` });
    const versionUrl = await fetchMcVersionUrl(mcVersion);
    sendProgress(win, { phase: 'mc-download', message: `下载 MC ${mcVersion} 核心文件（已有则跳过）...` });
    await downloadVersion({ id: mcVersion, url: versionUrl }, minecraftDir, 'bmclapi', win);
    sendProgress(win, { phase: 'mc-download', message: `✓ MC ${mcVersion} 已就绪` });

    // ── 3. Install loader ─────────────────────────────────────────────────────
    let loaderId = mcVersion;
    if (loader === 'fabric') {
      sendProgress(win, { phase: 'loader', message: `安装 Fabric ${loaderVersion}...` });
      loaderId = await installFabric(mcVersion, loaderVersion, minecraftDir, win);
      sendProgress(win, { phase: 'loader', message: `✓ Fabric ${loaderVersion} 安装完成` });
    } else if (loader === 'neoforge') {
      sendProgress(win, { phase: 'loader', message: `安装 NeoForge ${loaderVersion}...` });
      loaderId = await installNeoForge(mcVersion, loaderVersion, minecraftDir, javaPath, win);
      sendProgress(win, { phase: 'loader', message: `✓ NeoForge ${loaderVersion} 安装完成` });
    } else if (loader === 'forge') {
      sendProgress(win, { phase: 'loader', message: `安装 Forge ${loaderVersion}...` });
      loaderId = await installForge(mcVersion, loaderVersion, minecraftDir, javaPath, win);
      sendProgress(win, { phase: 'loader', message: `✓ Forge ${loaderVersion} 安装完成` });
    }

    // ── 4. Create instance directory ──────────────────────────────────────────
    sendProgress(win, { phase: 'instance', message: `创建实例「${instanceName}」...` });
    fs.mkdirSync(instanceDir, { recursive: true });
    instanceDirCreated = true;
    // mods/ and saves/ created here so they exist even if overrides doesn't contain them
    fs.mkdirSync(path.join(instanceDir, 'mods'),  { recursive: true });
    fs.mkdirSync(path.join(instanceDir, 'saves'), { recursive: true });

    const instanceJson = {
      id: instanceName,
      inheritsFrom: loaderId,
      type: 'release',
      releaseTime: new Date().toISOString(),
      _cmcl: {
        name: instanceName,
        mcVersion,
        modLoader: loader,
        loaderVersion: loaderVersion || null,
        createdAt: new Date().toISOString(),
        fromLocalPack: parsed.name || null,
      },
    };
    fs.writeFileSync(
      path.join(instanceDir, `${instanceName}.json`),
      JSON.stringify(instanceJson, null, 2),
    );
    sendProgress(win, { phase: 'instance', message: '✓ 实例目录已创建' });

    // ── 5. Stream-extract overrides (re-opens zip, one entry at a time) ─────
    const copied = await copyLocalPackOverrides(filePath, overridesDir, instanceDir, win);
    sendProgress(win, { phase: 'overrides', message: `✓ 解压完成，共 ${copied} 个文件` });

    // ── Done ──────────────────────────────────────────────────────────────────
    sendProgress(win, {
      phase: 'done',
      message: `✓ 导入完成！实例「${instanceName}」已创建，包含 ${bundledModCount} 个 Mod${networkFileCount > 0 ? `（注意：${networkFileCount} 个 CurseForge 引用文件未能自动下载）` : ''}`,
    });

    return {
      success: true,
      instanceId: instanceName,
      failedMods: [],
      warnCfNetworkFiles: networkFileCount,
    };

  } catch (err) {
    sendProgress(win, { phase: 'error', message: `✗ 导入失败: ${err.message}` });
    // Only clean up the directory if THIS import created it — never touch pre-existing instances
    if (instanceDirCreated && fs.existsSync(instanceDir)) {
      try { fs.rmSync(instanceDir, { recursive: true, force: true }); } catch {}
      sendProgress(win, { phase: 'error', message: '已清理不完整的实例目录' });
    }
    return { success: false, error: err.message };
  }
}

// ── Client-only mod scanner ───────────────────────────────────────────────────
// CurseForge/HMCL packs carry no env flags, so we can't auto-filter.
// Scan the server's mods/ folder post-import and flag common client-only mods.

// Filename keyword patterns — fast first-pass, catches most common client mods.
const CLIENT_ONLY_PATTERNS = [
  { pattern: 'iris',                reason: '光影加载器（客户端专用）' },
  { pattern: 'oculus',              reason: '光影加载器 NeoForge/Forge 版（客户端专用）' },
  { pattern: 'sodium',              reason: '渲染加速（客户端专用）' },
  { pattern: 'embeddium',           reason: '渲染加速 NeoForge 版（客户端专用）' },
  { pattern: 'rubidium',            reason: '渲染加速 Forge 版（客户端专用）' },
  { pattern: 'optifine',            reason: 'OptiFine（客户端专用）' },
  { pattern: 'optifabric',          reason: 'OptiFabric（客户端专用）' },
  { pattern: 'flerovium',           reason: '依赖 Sodium 的客户端渲染扩展' },
  { pattern: 'colorwheel',          reason: '依赖 Iris 的客户端光效扩展' },
  { pattern: 'distanthorizons',     reason: 'Distant Horizons LOD（客户端专用）' },
  { pattern: 'xaero',               reason: 'Xaero 小地图/世界地图（客户端专用）' },
  { pattern: 'journeymap',          reason: 'JourneyMap 小地图（客户端专用）' },
  { pattern: 'voxelmap',            reason: 'VoxelMap 小地图（客户端专用）' },
  { pattern: 'modmenu',             reason: 'Mod 菜单 UI（客户端专用）' },
  { pattern: 'controlling',         reason: '按键绑定 UI（客户端专用）' },
  { pattern: 'entityculling',       reason: '实体剔除渲染优化（客户端专用）' },
  { pattern: 'notenoughanimations', reason: '动作优化（客户端专用）' },
];

// Known client-only mod IDs used when reading JAR metadata dependencies.
const KNOWN_CLIENT_ONLY_MOD_IDS = new Set([
  'sodium', 'iris', 'embeddium', 'rubidium', 'oculus',
  'optifine', 'optifabric', 'distanthorizons',
]);

// Shallow scan: filename keyword match only (fast, O(n) in mod count).
function scanClientOnlyMods(modsDir) {
  if (!fs.existsSync(modsDir)) return [];
  const suspected = [];
  try {
    for (const file of fs.readdirSync(modsDir)) {
      const lc = file.toLowerCase();
      if (!lc.endsWith('.jar') && !lc.endsWith('.jar.disabled')) continue;
      for (const { pattern, reason } of CLIENT_ONLY_PATTERNS) {
        if (lc.includes(pattern)) {
          suspected.push({ name: file, reason, path: path.join(modsDir, file) });
          break;
        }
      }
    }
  } catch { /* ignore read errors */ }
  return suspected;
}

// Deep scan: also reads neoforge.mods.toml / fabric.mod.json from each JAR
// to catch mods whose FILENAME doesn't hint at being client-only but whose
// declared dependencies include known client-only mod IDs (e.g. flerovium→sodium).
// Uses node-stream-zip so only the central directory + one small entry is read
// per JAR — efficient even for 200+ mods.
async function scanClientOnlyModsDeep(modsDir) {
  if (!fs.existsSync(modsDir)) return [];
  let files;
  try { files = fs.readdirSync(modsDir); } catch { return []; }
  files = files.filter(f => { const l = f.toLowerCase(); return l.endsWith('.jar') || l.endsWith('.jar.disabled'); });

  const suspected = [];
  const BATCH = 16; // max concurrent open ZIPs to stay well below OS fd limits

  for (let i = 0; i < files.length; i += BATCH) {
    const batch = files.slice(i, i + BATCH);
    const results = await Promise.all(batch.map(async (file) => {
      const filePath = path.join(modsDir, file);
      const lc = file.toLowerCase();

      // Fast path: keyword in filename
      for (const { pattern, reason } of CLIENT_ONLY_PATTERNS) {
        if (lc.includes(pattern)) return { name: file, reason, path: filePath };
      }

      // Deep path: read mod metadata from JAR
      try {
        return await withZip(filePath, async (zip) => {
          const entries = await zip.entries();

          // NeoForge: META-INF/neoforge.mods.toml
          if ('META-INF/neoforge.mods.toml' in entries) {
            const buf  = await zip.entryData('META-INF/neoforge.mods.toml');
            const toml = buf.toString('utf-8');
            // Split on [[dependencies.*]] sections; each block lists one dep
            const depBlocks = toml.split(/\[\[dependencies\.[^\]]+\]\]/);
            for (let j = 1; j < depBlocks.length; j++) {
              const block = depBlocks[j].split(/\[\[/)[0]; // stop before next section
              const m = block.match(/modId\s*=\s*"([^"]+)"/);
              if (m && KNOWN_CLIENT_ONLY_MOD_IDS.has(m[1].toLowerCase())) {
                return { name: file, reason: `依赖纯客户端 Mod: ${m[1]}`, path: filePath };
              }
            }
          }

          // Fabric: fabric.mod.json
          if ('fabric.mod.json' in entries) {
            const buf  = await zip.entryData('fabric.mod.json');
            const json = JSON.parse(buf.toString('utf-8'));
            for (const depId of Object.keys(json.depends || {})) {
              if (KNOWN_CLIENT_ONLY_MOD_IDS.has(depId.toLowerCase())) {
                return { name: file, reason: `依赖纯客户端 Mod: ${depId}`, path: filePath };
              }
            }
          }

          return null;
        });
      } catch { return null; }
    }));

    for (const r of results) { if (r) suspected.push(r); }
  }
  return suspected;
}

// ── Local pack server import ──────────────────────────────────────────────────
// CurseForge/HMCL format: createServer installs loader, then stream-extract overrides.
// No env filtering — all mods copied; UI warns user to review client-only mods.

async function importLocalPackAsServer(filePath, serverName, { serversDir, javaPath, maxMemory, port }, win) {
  try {
    // ── 1. Parse manifest ─────────────────────────────────────────────────────
    sendProgress(win, { phase: 'parse', message: '解析整合包清单...' });
    const parsed = await parseLocalPackManifest(filePath);
    const { mcVersion, loader, loaderVersion, overridesDir, bundledModCount, networkFileCount } = parsed;

    sendProgress(win, {
      phase: 'parse',
      message: `整合包: ${parsed.name || '(未命名)'} | MC ${mcVersion} | ${loader ? `${loader} ${loaderVersion}` : '原版'} | ${bundledModCount} 个 Mod（已内嵌，无 env 标记，将全部导入）`,
    });

    // ── 2. Create server — installs loader + downloads server.jar ─────────────
    sendProgress(win, { phase: 'server-create', message: `创建服务端「${serverName}」并安装 ${loader || 'vanilla'}...` });
    const createResult = await serverHandler.createServer({
      name:          serverName,
      mcVersion,
      loader:        loader        || 'vanilla',
      loaderVersion: loaderVersion || null,
      maxMemory:     maxMemory     || 4096,
      javaPath:      javaPath      || '',
      port:          port          || 25565,
    }, serversDir, win);

    if (!createResult.success) throw new Error(`服务端创建失败: ${createResult.error}`);
    sendProgress(win, { phase: 'server-create', message: `✓ 服务端「${serverName}」创建完成` });

    // ── 3. Stream-extract overrides (mods, config, scripts, saves…) ──────────
    const serverDir = path.join(serversDir, serverName);
    const copied = await copyLocalPackOverrides(filePath, overridesDir, serverDir, win);
    sendProgress(win, { phase: 'overrides', message: `✓ 解压完成，共 ${copied} 个文件` });

    // ── 4. Informational scan — detect, but NEVER auto-delete ────────────────
    // Some packs run "client-only" mods via compatibility layers (Sinytra Connector
    // etc.). Deleting them breaks the pack. We only surface them as FYI; the user
    // decides if they want to remove anything.
    const suspectedClientMods = await scanClientOnlyModsDeep(path.join(serverDir, 'mods'));
    if (suspectedClientMods.length > 0) {
      sendProgress(win, {
        phase: 'scan',
        message: `ℹ 检测到 ${suspectedClientMods.length} 个疑似纯客户端 Mod（仅供参考，已全部保留，CMCL 不自动删除）`,
      });
    }

    sendProgress(win, {
      phase: 'done',
      message: `✓ 服务端整合包导入完成！「${serverName}」| ${bundledModCount} 个 Mod${networkFileCount > 0 ? `（另有 ${networkFileCount} 个 CurseForge 引用未下载）` : ''}`,
    });

    return {
      success: true,
      serverId: serverName,
      failedMods: [],
      warnCfNetworkFiles: networkFileCount,
      suspectedClientMods, // FYI only — UI must NOT provide auto-delete for these
    };

  } catch (err) {
    sendProgress(win, { phase: 'error', message: `✗ 服务端导入失败: ${err.message}` });
    // Keep the server dir if createServer succeeded (loader already installed is valuable)
    return { success: false, error: err.message };
  }
}

// ── Instance export ───────────────────────────────────────────────────────────
//
// Packs an existing CMCL client instance into a self-contained CurseForge/HMCL
// compatible zip that can be re-imported by importLocalPackAsClient.
//
// Zip layout produced:
//   manifest.json          ← CurseForge manifest, files:[] (all mods bundled)
//   overrides/<everything> ← ALL instance content by default (kubejs, config,
//                            mods, defaultconfigs, scripts, xaero, …)
//
// Blacklist — never packed (runtime artifacts, not pack content):
//   logs/, crash-reports/, cache/, .mixin.out/, natives*/ (re-extracted at launch)
//   <instanceId>.json, <instanceId>.jar, session.lock, *.log (any depth)
//
// Opt-in via options (excluded unless checked):
//   saves/                         ← options.includeSaves
//   resourcepacks/, shaderpacks/   ← options.includeResourcePacks
//   options.txt, optionsof.txt, optionsshaders.txt ← options.includeGameSettings
//   servers.dat (may hold private server addresses) ← options.includeServerList
//
// Uses archiver for streaming zip creation — safe for multi-GB instances.

function sendExportProgress(win, data) {
  if (win && !win.isDestroyed()) {
    win.webContents.send('instance:exportProgress', data);
  }
}

function exportInstanceAsPack(instanceId, savePath, options, { minecraftDir }, win) {
  const {
    includeSaves        = false,
    includeResourcePacks = false,
    includeGameSettings  = false,
    includeServerList    = false,
  } = options || {};

  // ── 1. Read instance metadata ─────────────────────────────────────────────
  const versionsDir = path.join(minecraftDir, 'versions');
  const instanceDir = path.join(versionsDir, instanceId);
  const jsonPath    = path.join(instanceDir, `${instanceId}.json`);

  if (!fs.existsSync(jsonPath)) {
    return Promise.reject(new Error(`找不到实例描述文件: ${instanceId}.json`));
  }

  let instanceJson;
  try {
    instanceJson = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  } catch (e) {
    return Promise.reject(new Error(`读取实例描述文件失败: ${e.message}`));
  }

  const cmcl = instanceJson._cmcl;
  if (!cmcl) {
    return Promise.reject(new Error('该条目不是 Tick 实例（缺少 _cmcl 元数据），暂不支持导出'));
  }

  const { mcVersion, modLoader, loaderVersion, name: instanceName } = cmcl;
  if (!mcVersion) {
    return Promise.reject(new Error('实例元数据缺少 mcVersion'));
  }

  // ── 2. Build manifest.json ────────────────────────────────────────────────
  // modLoaders id format must match what parseLocalPackManifest expects:
  //   "fabric-<ver>"  /  "forge-<ver>"  /  "neoforge-<ver>"
  const modLoaders = [];
  if (modLoader && loaderVersion) {
    modLoaders.push({ id: `${modLoader}-${loaderVersion}`, primary: true });
  }

  const manifest = {
    manifestType:    'minecraftModpack',
    manifestVersion: 1,
    name:    instanceName || instanceId,
    version: '1.0.0',
    minecraft: { version: mcVersion, modLoaders },
    files:     [],          // everything is bundled in overrides/
    overrides: 'overrides',
  };

  // ── 3. Stream-pack with archiver ──────────────────────────────────────────
  return new Promise((resolve, reject) => {
    let outputClosed = false;

    const fail = (err) => {
      if (outputClosed) return;
      // Best-effort cleanup of partial file
      try { if (fs.existsSync(savePath)) fs.unlinkSync(savePath); } catch {}
      reject(err);
    };

    let output;
    try {
      output = fs.createWriteStream(savePath);
    } catch (e) {
      return reject(new Error(`无法创建输出文件: ${e.message}`));
    }

    // zlib level 0 = store (no deflate) — fastest; JARs are already compressed
    const archive = archiver('zip', { zlib: { level: 0 } });

    output.on('close', () => {
      outputClosed = true;
      const bytes = archive.pointer();
      sendExportProgress(win, {
        phase: 'done',
        message: `✓ 导出完成，文件大小: ${(bytes / 1048576).toFixed(1)} MB`,
        bytes,
      });
      resolve({ success: true, bytes });
    });

    output.on('error', (err) => fail(new Error(`写入文件失败: ${err.message}`)));

    archive.on('error', (err) => fail(new Error(`打包失败: ${err.message}`)));

    archive.on('warning', (warn) => {
      // ENOENT = file vanished between listing and reading — non-fatal, just log
      if (warn.code === 'ENOENT') {
        sendExportProgress(win, { phase: 'progress', message: `⚠ 跳过（文件消失）: ${warn.path || ''}` });
      } else {
        fail(warn);
      }
    });

    archive.on('progress', ({ entries, fs: { processedBytes } }) => {
      sendExportProgress(win, {
        phase: 'progress',
        message: `打包中 ${entries.processed}/${entries.total || '?'} 个文件...`,
        processedBytes,
        processed: entries.processed,
        total:     entries.total,
      });
    });

    archive.pipe(output);

    // manifest.json at zip root
    archive.append(Buffer.from(JSON.stringify(manifest, null, 2), 'utf-8'), {
      name: 'manifest.json',
    });

    sendExportProgress(win, { phase: 'progress', message: '开始打包...' });

    // Entry filter: skip session.lock and any stray .log files at any depth
    const entryFilter = (entry) => {
      const base = path.basename(entry.name);
      if (base === 'session.lock')  return false;
      if (base.endsWith('.log'))    return false;
      return entry;
    };

    // Blacklist over whitelist: pack EVERYTHING in the instance dir except
    // known runtime artifacts. A whitelist silently dropped kubejs/,
    // defaultconfigs/ etc. and broke export→re-import round-trips.
    // Only certain-garbage goes here (logs/caches/locks/regenerated-at-launch);
    // anything ambiguous ships — an unknown dir is likely some mod's data.
    const excludedDirs = new Set(['logs', 'crash-reports', 'cache', '.mixin.out']);
    // natives / natives-windows-x86_64 / natives-... — extracted again at launch
    const isNativesDir = (nameLc) => /^natives([-_.]|$)/.test(nameLc);
    const optionalGameSettingFiles = new Set(['options.txt', 'optionsof.txt', 'optionsshaders.txt']);

    let entries;
    try {
      entries = fs.readdirSync(instanceDir, { withFileTypes: true });
    } catch (e) {
      return fail(new Error(`读取实例目录失败: ${e.message}`));
    }

    for (const entry of entries) {
      const name   = entry.name;
      const nameLc = name.toLowerCase();
      const full   = path.join(instanceDir, name);

      if (entry.isDirectory()) {
        if (excludedDirs.has(nameLc) || isNativesDir(nameLc)) continue;
        if (nameLc === 'saves' && !includeSaves) continue;
        if ((nameLc === 'resourcepacks' || nameLc === 'shaderpacks') && !includeResourcePacks) continue;
        archive.directory(full, `overrides/${name}`, entryFilter);
      } else if (entry.isFile()) {
        // Instance metadata lives in manifest.json, not overrides
        if (name === `${instanceId}.json` || name === `${instanceId}.jar`) continue;
        if (name === 'session.lock' || nameLc.endsWith('.log')) continue;
        if (optionalGameSettingFiles.has(nameLc) && !includeGameSettings) continue;
        // Privacy: server list may contain private server addresses — opt-in only
        if (nameLc === 'servers.dat' && !includeServerList) continue;
        archive.file(full, { name: `overrides/${name}` });
      }
      // Symlinks and other entry types are skipped intentionally
    }

    archive.finalize();
  });
}

// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  parseMrpack,
  filterFiles,
  detectFormat,
  detectAndParse,
  importMrpackAsClient,
  importMrpackAsServer,
  importLocalPackAsClient,
  importLocalPackAsServer,
  scanClientOnlyMods,
  scanClientOnlyModsDeep,
  exportInstanceAsPack,
};
