const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const AdmZip = require('adm-zip');
const { fetchJson, fetchText } = require('./versionHandler');
const { downloadFile, downloadFiles, getLibraryFiles, mavenCoordToPath } = require('./downloadHandler');

const BMCLAPI = 'https://bmclapi2.bangbang93.com';
const FABRIC_META = 'https://meta.fabricmc.net/v2';
const NEOFORGE_MAVEN = 'https://maven.neoforged.net/releases/net/neoforged/neoforge';

// ─── Fabric ──────────────────────────────────────────────────────────────────

async function getFabricLoaderVersions(mcVersion) {
  const data = await fetchJson(`${FABRIC_META}/versions/loader/${mcVersion}`);
  return data.map((item) => ({
    version: item.loader.version,
    stable: item.loader.stable,
  }));
}

async function installFabric(mcVersion, loaderVersion, minecraftDir, win) {
  const sendProgress = (msg) => { if (win && !win.isDestroyed()) win.webContents.send('loader:progress', { message: msg }); };

  sendProgress(`正在获取 Fabric ${loaderVersion} 配置...`);
  const profileJson = await fetchJson(`${FABRIC_META}/versions/loader/${mcVersion}/${loaderVersion}/profile/json`);
  const versionId = profileJson.id; // e.g. "fabric-loader-0.15.6-1.21.4"
  const versionDir = path.join(minecraftDir, 'versions', versionId);
  fs.mkdirSync(versionDir, { recursive: true });
  fs.writeFileSync(path.join(versionDir, `${versionId}.json`), JSON.stringify(profileJson, null, 2));
  sendProgress('版本配置已保存');

  // Download Fabric libraries
  const librariesDir = path.join(minecraftDir, 'libraries');
  const libFiles = getLibraryFiles(profileJson.libraries || [], librariesDir, 'none');
  let completed = 0;
  const total = libFiles.length;
  sendProgress(`下载 Fabric 库文件 (共 ${total} 个)...`);
  await downloadFiles(libFiles, 8, (c, t, name) => {
    completed = c;
    sendProgress(`下载库 ${c}/${t}: ${name}`);
  });

  sendProgress(`Fabric ${loaderVersion} 安装完成！版本ID: ${versionId}`);
  return versionId;
}

// ─── Forge ───────────────────────────────────────────────────────────────────

async function getForgeVersions(mcVersion) {
  const data = await fetchJson(`${BMCLAPI}/forge/minecraft/${mcVersion}`);
  return data.map((item) => ({
    version: item.version,
    build: item.build,
    modified: item.modified,
  })).reverse(); // newest first
}

function resolveProcessorArg(arg, dataVars, librariesDir) {
  if (arg.startsWith('[') && arg.endsWith(']')) {
    // Library reference
    const coord = arg.slice(1, -1);
    return path.join(librariesDir, mavenCoordToPath(coord));
  }
  if (arg.startsWith('{') && arg.endsWith('}')) {
    const key = arg.slice(1, -1);
    return dataVars[key] || arg;
  }
  return arg;
}

async function runForgeProcessors(installProfile, minecraftDir, mcVersion, javaPath, installerZip, win) {
  const sendProgress = (msg) => { if (win && !win.isDestroyed()) win.webContents.send('loader:progress', { message: msg }); };
  const librariesDir = path.join(minecraftDir, 'libraries');
  const tmpDir = path.join(os.tmpdir(), 'cmcl-forge-data');
  fs.mkdirSync(tmpDir, { recursive: true });

  // Extract data files from installer
  const dataVars = {};
  for (const [key, val] of Object.entries(installProfile.data || {})) {
    const clientVal = val.client || val;
    if (typeof clientVal !== 'string') continue;

    if (clientVal.startsWith('/data/') || clientVal.startsWith('data/')) {
      const entryName = clientVal.replace(/^\//, '');
      const entry = installerZip.getEntry(entryName);
      if (entry) {
        const dest = path.join(tmpDir, path.basename(entryName));
        fs.writeFileSync(dest, entry.getData());
        dataVars[key] = dest;
      }
    } else if (clientVal.startsWith('[') && clientVal.endsWith(']')) {
      const coord = clientVal.slice(1, -1);
      dataVars[key] = path.join(librariesDir, mavenCoordToPath(coord));
    } else {
      let resolved = clientVal
        .replace('{MINECRAFT_DIR}', minecraftDir)
        .replace('{MC_VERSION}', mcVersion);
      dataVars[key] = resolved;
    }
  }
  dataVars['MINECRAFT_JAR'] = path.join(minecraftDir, 'versions', mcVersion, `${mcVersion}.jar`);
  dataVars['SIDE'] = 'client';

  let javaExe = javaPath;
  if (!javaExe.endsWith('.exe')) {
    javaExe = path.join(javaPath, 'bin', 'java.exe');
    if (!fs.existsSync(javaExe)) javaExe = javaExe.replace('java.exe', 'javaw.exe');
  }

  const processors = (installProfile.processors || []).filter(
    (p) => !p.sides || p.sides.includes('client')
  );

  for (let i = 0; i < processors.length; i++) {
    const proc = processors[i];
    const procLabel = `[${i + 1}/${processors.length}] ${proc.jar.split(':')[1]}`;
    sendProgress(`运行安装处理器 ${procLabel}`);

    // Check for already-existing outputs — skip if all outputs present
    if (proc.outputs && Object.keys(proc.outputs).length > 0) {
      const allExist = Object.keys(proc.outputs).every((outKey) => {
        const resolved = resolveProcessorArg(outKey, dataVars, librariesDir);
        return fs.existsSync(resolved);
      });
      if (allExist) {
        sendProgress(`  跳过（输出已存在）: ${procLabel}`);
        continue;
      }
    }

    const jarPath = path.join(librariesDir, mavenCoordToPath(proc.jar));
    if (!fs.existsSync(jarPath)) {
      throw new Error(`处理器 ${procLabel} 的 JAR 不存在: ${jarPath}`);
    }

    let mainClass = '';
    try {
      const zip = new AdmZip(jarPath);
      const manifest = zip.readAsText('META-INF/MANIFEST.MF');
      const match = manifest.match(/Main-Class:\s*(.+)/);
      if (match) mainClass = match[1].trim();
    } catch (e) {
      throw new Error(`处理器 ${procLabel} 读取 MANIFEST 失败: ${e.message}`);
    }

    const cp = [
      jarPath,
      ...(proc.classpath || []).map((c) => path.join(librariesDir, mavenCoordToPath(c))),
    ].join(path.delimiter);

    const args = (proc.args || []).map((a) => resolveProcessorArg(a, dataVars, librariesDir));

    // Ensure output directories exist
    for (const outKey of Object.keys(proc.outputs || {})) {
      const outPath = resolveProcessorArg(outKey, dataVars, librariesDir);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
    }
    // Also create dirs for --output / --slim / --extra / --srg args
    for (let a = 0; a < args.length - 1; a++) {
      if (['--output', '--slim', '--extra', '--srg'].includes(args[a])) {
        fs.mkdirSync(path.dirname(args[a + 1]), { recursive: true });
      }
    }

    await new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      const p = spawn(javaExe, ['-cp', cp, mainClass, ...args]);
      p.stdout.on('data', (d) => { stdout += d.toString(); });
      p.stderr.on('data', (d) => { stderr += d.toString(); });
      p.on('close', (code) => {
        if (code === 0) {
          sendProgress(`  ✓ 处理器 ${procLabel} 完成`);
          resolve();
        } else {
          const detail = (stderr || stdout).trim().split('\n').slice(-10).join('\n');
          reject(new Error(`处理器 ${procLabel} 退出码 ${code}\n${detail}`));
        }
      });
      p.on('error', (err) => reject(new Error(`处理器 ${procLabel} 启动失败: ${err.message}`)));
    });
  }
}

async function installForge(mcVersion, forgeVersion, minecraftDir, javaPath, win) {
  const sendProgress = (msg) => { if (win && !win.isDestroyed()) win.webContents.send('loader:progress', { message: msg }); };

  const installerUrl = `${BMCLAPI}/forge/download?mcversion=${mcVersion}&version=${forgeVersion}&category=installer&format=jar`;
  const installerPath = path.join(os.tmpdir(), `forge-${mcVersion}-${forgeVersion}-installer.jar`);

  sendProgress('下载 Forge 安装器...');
  await downloadFile(installerUrl, installerPath, (dl, total) => {
    if (total > 0) sendProgress(`下载安装器 ${(dl / 1024 / 1024).toFixed(1)}/${(total / 1024 / 1024).toFixed(1)} MB`);
  });

  sendProgress('解析安装器...');
  const installerZip = new AdmZip(installerPath);

  const versionEntry = installerZip.getEntry('version.json');
  const profileEntry = installerZip.getEntry('install_profile.json');

  if (!versionEntry) throw new Error('安装器格式无法识别，请尝试其他版本');

  const versionJson = JSON.parse(installerZip.readAsText('version.json'));
  const versionId = versionJson.id;
  const versionDir = path.join(minecraftDir, 'versions', versionId);
  fs.mkdirSync(versionDir, { recursive: true });
  fs.writeFileSync(path.join(versionDir, `${versionId}.json`), JSON.stringify(versionJson, null, 2));

  const librariesDir = path.join(minecraftDir, 'libraries');

  // Download version.json libraries
  sendProgress('下载 Forge 库文件...');
  const libFiles = getLibraryFiles(versionJson.libraries || [], librariesDir, 'bmclapi');
  await downloadFiles(libFiles, 8, (c, t, name) => sendProgress(`下载库 ${c}/${t}: ${name}`));

  if (profileEntry) {
    const installProfile = JSON.parse(installerZip.readAsText('install_profile.json'));
    // Download processor libraries
    const procLibFiles = getLibraryFiles(installProfile.libraries || [], librariesDir, 'bmclapi');
    if (procLibFiles.length > 0) {
      sendProgress('下载处理器依赖...');
      await downloadFiles(procLibFiles, 8, (c, t, name) => sendProgress(`下载处理器库 ${c}/${t}: ${name}`));
    }

    // Run processors
    sendProgress('运行安装处理器...');
    await runForgeProcessors(installProfile, minecraftDir, mcVersion, javaPath, installerZip, win);
  }

  sendProgress(`Forge ${forgeVersion} 安装完成！版本ID: ${versionId}`);
  return versionId;
}

// ─── NeoForge ────────────────────────────────────────────────────────────────

async function getNeoForgeVersions(mcVersion) {
  // Parse maven-metadata.xml to get versions for this MC version
  const xml = await fetchText(`${NEOFORGE_MAVEN}/maven-metadata.xml`);
  const versions = [];
  const matches = xml.matchAll(/<version>([^<]+)<\/version>/g);
  // NeoForge version for MC 1.21.4 → starts with "21.4."
  const prefix = mcVersion.split('.').slice(1).join('.');
  for (const m of matches) {
    if (m[1].startsWith(prefix + '.') || m[1].startsWith(mcVersion.replace('1.', '') + '.')) {
      versions.push(m[1]);
    }
  }
  return versions.reverse();
}

async function installNeoForge(mcVersion, neoForgeVersion, minecraftDir, javaPath, win) {
  const sendProgress = (msg) => { if (win && !win.isDestroyed()) win.webContents.send('loader:progress', { message: msg }); };

  const installerUrl = `${NEOFORGE_MAVEN}/${neoForgeVersion}/neoforge-${neoForgeVersion}-installer.jar`;
  const installerPath = path.join(os.tmpdir(), `neoforge-${neoForgeVersion}-installer.jar`);

  sendProgress('下载 NeoForge 安装器...');
  await downloadFile(installerUrl, installerPath, (dl, total) => {
    if (total > 0) sendProgress(`下载安装器 ${(dl / 1024 / 1024).toFixed(1)}/${(total / 1024 / 1024).toFixed(1)} MB`);
  });

  sendProgress('解析安装器...');
  const installerZip = new AdmZip(installerPath);
  const versionEntry = installerZip.getEntry('version.json');
  if (!versionEntry) throw new Error('NeoForge 安装器格式无法识别');

  const versionJson = JSON.parse(installerZip.readAsText('version.json'));
  const versionId = versionJson.id;
  const versionDir = path.join(minecraftDir, 'versions', versionId);
  fs.mkdirSync(versionDir, { recursive: true });
  fs.writeFileSync(path.join(versionDir, `${versionId}.json`), JSON.stringify(versionJson, null, 2));

  const librariesDir = path.join(minecraftDir, 'libraries');
  const libFiles = getLibraryFiles(versionJson.libraries || [], librariesDir, 'mojang');
  sendProgress('下载 NeoForge 库文件...');
  await downloadFiles(libFiles, 8, (c, t, name) => sendProgress(`下载库 ${c}/${t}: ${name}`));

  const profileEntry = installerZip.getEntry('install_profile.json');
  if (profileEntry) {
    const installProfile = JSON.parse(installerZip.readAsText('install_profile.json'));
    const procLibFiles = getLibraryFiles(installProfile.libraries || [], librariesDir, 'mojang');
    if (procLibFiles.length > 0) {
      sendProgress('下载处理器依赖...');
      await downloadFiles(procLibFiles, 8, (c, t, name) => sendProgress(`下载处理器库 ${c}/${t}: ${name}`));
    }
    sendProgress('运行安装处理器...');
    await runForgeProcessors(installProfile, minecraftDir, mcVersion, javaPath, installerZip, win);
  }

  sendProgress(`NeoForge ${neoForgeVersion} 安装完成！版本ID: ${versionId}`);
  return versionId;
}

module.exports = {
  getFabricLoaderVersions, installFabric,
  getForgeVersions, installForge,
  getNeoForgeVersions, installNeoForge,
};
