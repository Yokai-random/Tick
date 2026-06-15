const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const serverHandler = require('./handlers/serverHandler');
const mrpackHandler = require('./handlers/mrpackHandler');
const path = require('path');
const fs = require('fs');

const { detectJava, selectBestJava, downloadJava, deleteJava } = require('./handlers/javaHandler');
const { getVersionList, getLocalVersions } = require('./handlers/versionHandler');
const { downloadVersion } = require('./handlers/downloadHandler');
const { launchGame } = require('./handlers/launchHandler');
const { loginMicrosoft, getValidAccount } = require('./handlers/authHandler');
const { getFabricLoaderVersions, installFabric, getForgeVersions, installForge, getNeoForgeVersions, installNeoForge } = require('./handlers/modLoaderHandler');
const { searchContent, searchMods, getProjectVersions, getProjects, downloadMod, getInstalledMods, listInstalledFiles, toggleMod, deleteMod, checkDependencies } = require('./handlers/modrinthHandler');

// 启动器根目录：打包后优先用 PORTABLE_EXECUTABLE_DIR（portable exe 真实所在目录），
// 回退 path.dirname(app.getPath('exe'))（非 portable 安装包兼容），开发时用项目根目录
function getLauncherDir() {
  if (app.isPackaged) {
    return process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(app.getPath('exe'));
  }
  return path.resolve(__dirname, '..');
}

function getDefaultMinecraftDir() {
  return path.join(getLauncherDir(), '.minecraft');
}

function getServersDir() {
  return path.join(getLauncherDir(), '.servers');
}

// 设置文件也存在启动器旁边，实现真正的绿色便携
// 若目录不可写（如安装到 Program Files），回退到 %APPDATA%
function getSettingsPath() {
  const launcherDir = getLauncherDir();
  try {
    fs.accessSync(launcherDir, fs.constants.W_OK);
    return path.join(launcherDir, 'CMCL-settings.json');
  } catch {
    return path.join(app.getPath('userData'), 'CMCL-settings.json');
  }
}

const SETTINGS_PATH = getSettingsPath();

const DEFAULT_SETTINGS = {
  username: 'Steve',
  javaPath: '',
  downloadSource: 'bmclapi',
  maxMemory: 2048,
  portableMode: true,
  minecraftDir: '',
  account: null,
  theme: 'light',
  lastLaunchedVersion: null,
};

function loadSettings() {
  const defaultDir = getDefaultMinecraftDir();
  try {
    const raw = fs.readFileSync(SETTINGS_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    const merged = { ...DEFAULT_SETTINGS, ...parsed };

    // 兼容旧配置：若无 portableMode 字段，根据 minecraftDir 是否与默认路径一致来推断
    let portableMode;
    if ('portableMode' in parsed) {
      portableMode = parsed.portableMode !== false;
    } else {
      portableMode = !parsed.minecraftDir || parsed.minecraftDir === defaultDir;
    }

    const minecraftDir = portableMode ? defaultDir : (merged.minecraftDir || defaultDir);
    return { ...merged, portableMode, minecraftDir, defaultMinecraftDir: defaultDir };
  } catch {
    return { ...DEFAULT_SETTINGS, portableMode: true, minecraftDir: defaultDir, defaultMinecraftDir: defaultDir };
  }
}

function saveSettings(settings) {
  // defaultMinecraftDir 是运行时计算值，不写入配置文件
  const { defaultMinecraftDir, ...toSave } = settings;
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(toSave, null, 2));
}

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 680,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    backgroundColor: '#1a1b2e',
    title: 'Tick',
    icon: path.join(__dirname, '../icon/icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const isDev = process.argv.includes('--dev');
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => { mainWindow = null; });

  // ── Pendant inertia: push window velocity on every move ─────────────────────
  // Velocity-based: sign is unambiguous and gives persistent deflection during drag.
  {
    let _px = null, _pt = 0;
    mainWindow.on('move', () => {
      const now = Date.now();
      if (now - _pt < 16) return; // throttle to ~60 fps
      const { x } = mainWindow.getBounds();
      if (_px !== null) {
        const dt = (now - _pt) / 1000;
        if (dt < 0.25 && !mainWindow.isDestroyed()) {
          const vx = (x - _px) / dt;
          mainWindow.webContents.send('window:moved', { vx });
        }
      }
      _px = x; _pt = now;
    });
  }
}

app.whenReady().then(() => {
  createWindow();

  // Window controls
  ipcMain.on('window:minimize', () => mainWindow?.minimize());
  ipcMain.on('window:maximize', () => {
    mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow?.maximize();
  });
  ipcMain.on('window:close', () => mainWindow?.close());

  // Settings
  ipcMain.handle('settings:get', () => loadSettings());
  ipcMain.handle('settings:save', (_, settings) => { saveSettings(settings); return true; });

  // Dialog
  ipcMain.handle('dialog:selectDir', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
    return result.canceled ? null : result.filePaths[0];
  });

  // Versions
  ipcMain.handle('version:list', async (_, source) => {
    return await getVersionList(source || loadSettings().downloadSource);
  });
  ipcMain.handle('version:local', async () => {
    const s = loadSettings();
    return await getLocalVersions(s.minecraftDir);
  });

  // Download
  ipcMain.handle('download:version', async (_, versionInfo) => {
    const s = loadSettings();
    try {
      await downloadVersion(versionInfo, s.minecraftDir, s.downloadSource, mainWindow);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Java
  ipcMain.handle('java:detect', async () => detectJava());

  ipcMain.handle('java:download', async (_, major) => {
    return downloadJava(major, mainWindow);
  });

  ipcMain.handle('java:delete', (_, major) => {
    return deleteJava(major);
  });

  // Launch
  ipcMain.handle('launch:game', async (_, options) => {
    const s = loadSettings();
    try {
      let account = s.account;
      if (account?.type === 'microsoft') {
        account = await getValidAccount(account);
        if (account !== s.account) {
          saveSettings({ ...s, account });
        }
      }
      const result = await launchGame({ ...options, account }, s.minecraftDir, mainWindow);
      return { success: true, ...result };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Microsoft auth
  ipcMain.handle('auth:microsoft', async () => {
    try {
      const account = await loginMicrosoft(mainWindow);
      const s = loadSettings();
      saveSettings({ ...s, account, username: account.username });
      return { success: true, account };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
  ipcMain.handle('auth:logout', async () => {
    const s = loadSettings();
    saveSettings({ ...s, account: null });
    return true;
  });

  // Mod loaders
  ipcMain.handle('loader:fabric:versions', async (_, mcVersion) => {
    try { return { success: true, data: await getFabricLoaderVersions(mcVersion) }; }
    catch (err) { return { success: false, error: err.message }; }
  });
  ipcMain.handle('loader:fabric:install', async (_, { mcVersion, loaderVersion }) => {
    const s = loadSettings();
    try {
      const versionId = await installFabric(mcVersion, loaderVersion, s.minecraftDir, mainWindow);
      return { success: true, versionId };
    } catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('loader:forge:versions', async (_, mcVersion) => {
    try { return { success: true, data: await getForgeVersions(mcVersion) }; }
    catch (err) { return { success: false, error: err.message }; }
  });
  ipcMain.handle('loader:forge:install', async (_, { mcVersion, forgeVersion }) => {
    const s = loadSettings();
    try {
      const versionId = await installForge(mcVersion, forgeVersion, s.minecraftDir, s.javaPath, mainWindow);
      return { success: true, versionId };
    } catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('loader:neoforge:versions', async (_, mcVersion) => {
    try { return { success: true, data: await getNeoForgeVersions(mcVersion) }; }
    catch (err) { return { success: false, error: err.message }; }
  });
  ipcMain.handle('loader:neoforge:install', async (_, { mcVersion, neoForgeVersion }) => {
    const s = loadSettings();
    try {
      const versionId = await installNeoForge(mcVersion, neoForgeVersion, s.minecraftDir, s.javaPath, mainWindow);
      return { success: true, versionId };
    } catch (err) { return { success: false, error: err.message }; }
  });

  // Modrinth
  ipcMain.handle('modrinth:search', async (_, { query, mcVersion, loader, offset, sortIndex }) => {
    try { return await searchMods(query, mcVersion, loader, offset, sortIndex); }
    catch (err) { return { hits: [], total: 0 }; }
  });
  // 通用内容搜索（光影包 / 资源包）
  ipcMain.handle('modrinth:search-content', async (_, { query, mcVersion, projectType, offset }) => {
    try { return await searchContent(query, mcVersion, projectType, offset); }
    catch (err) { return { hits: [], total: 0 }; }
  });
  // 通用内容下载：contentType = 'shaderpacks' | 'resourcepacks'
  ipcMain.handle('modrinth:download-content', async (_, { fileUrl, fileName, versionId, contentType }) => {
    const s = loadSettings();
    const destDir = path.join(s.minecraftDir, 'versions', versionId, contentType);
    console.log(`[download-content] 目标目录: ${destDir}`);
    try {
      const dest = await downloadMod(fileUrl, fileName, destDir);
      console.log(`[download-content] 安装完成: ${dest}`);
      return { success: true, dest };
    } catch (err) { return { success: false, error: err.message }; }
  });
  // 列出已安装内容（用于重复检测）
  ipcMain.handle('content:list-installed', async (_, { versionId, contentType }) => {
    const s = loadSettings();
    const dir = path.join(s.minecraftDir, 'versions', versionId, contentType);
    return listInstalledFiles(dir);
  });
  ipcMain.handle('modrinth:versions', async (_, { projectId, mcVersion, loader }) => {
    try { return await getProjectVersions(projectId, mcVersion, loader); }
    catch { return []; }
  });
  ipcMain.handle('modrinth:projects', async (_, ids) => {
    try { return await getProjects(ids); }
    catch { return []; }
  });
  ipcMain.handle('modrinth:download', async (_, { fileUrl, fileName, versionId }) => {
    const s = loadSettings();
    const modsDir = require('path').join(s.minecraftDir, 'versions', versionId, 'mods');
    try {
      const dest = await downloadMod(fileUrl, fileName, modsDir);
      return { success: true, dest };
    } catch (err) { return { success: false, error: err.message }; }
  });

  // Mod management
  ipcMain.handle('mods:list', async (_, versionId) => {
    const s = loadSettings();
    const modsDir = path.join(s.minecraftDir, 'versions', versionId, 'mods');
    return getInstalledMods(modsDir);
  });
  ipcMain.handle('mods:toggle', async (_, modPath) => {
    try { return { success: true, newPath: toggleMod(modPath) }; }
    catch (err) { return { success: false, error: err.message }; }
  });
  ipcMain.handle('mods:delete', async (_, modPath) => {
    try { deleteMod(modPath); return { success: true }; }
    catch (err) { return { success: false, error: err.message }; }
  });
  ipcMain.handle('mods:checkDeps', async (_, versionId) => {
    const s = loadSettings();
    const modsDir = path.join(s.minecraftDir, 'versions', versionId, 'mods');
    try { return await checkDependencies(modsDir); }
    catch { return []; }
  });

  // Version management
  ipcMain.handle('version:delete', async (_, versionId) => {
    const s = loadSettings();
    const versionDir = path.join(s.minecraftDir, 'versions', versionId);
    try {
      fs.rmSync(versionDir, { recursive: true, force: true });
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
  ipcMain.handle('version:openDir', (_, versionId) => {
    const s = loadSettings();
    shell.openPath(path.join(s.minecraftDir, 'versions', versionId));
  });

  // ── 实例管理 ──────────────────────────────────────────────────────────────────
  ipcMain.handle('instance:create', async (_, { instanceName, inheritsFrom, meta }) => {
    const trimmed = (instanceName || '').trim();
    // 名称校验：非空
    if (!trimmed) return { success: false, error: '实例名不能为空' };
    // 名称校验：Windows 文件名非法字符
    if (/[\\/:*?"<>|]/.test(trimmed))
      return { success: false, error: '实例名包含非法字符（\\ / : * ? " < > |），请重新输入' };
    if (trimmed.length > 80)
      return { success: false, error: '实例名不能超过 80 个字符' };

    const s = loadSettings();
    const versionDir = path.join(s.minecraftDir, 'versions', trimmed);

    // 重名校验：目录已存在则拒绝
    if (fs.existsSync(versionDir))
      return { success: false, error: `实例名「${trimmed}」已存在，请换一个名称` };

    try {
      fs.mkdirSync(versionDir, { recursive: true });
      // 同时创建 mods / saves 目录，保证实例隔离
      fs.mkdirSync(path.join(versionDir, 'mods'), { recursive: true });
      fs.mkdirSync(path.join(versionDir, 'saves'), { recursive: true });

      const instanceJson = {
        id: trimmed,
        inheritsFrom,
        type: 'release',
        releaseTime: new Date().toISOString(),
        _cmcl: {
          name: trimmed,
          mcVersion: meta?.mcVersion || null,
          modLoader: meta?.modLoader || null,
          loaderVersion: meta?.loaderVersion || null,
          createdAt: new Date().toISOString(),
        },
      };
      fs.writeFileSync(
        path.join(versionDir, `${trimmed}.json`),
        JSON.stringify(instanceJson, null, 2),
      );
      console.log(`[instance:create] 已创建实例: ${trimmed}  inheritsFrom=${inheritsFrom}`);
      return { success: true, instanceId: trimmed };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Shell
  ipcMain.handle('shell:openFolder',   (_, folderPath) => { shell.openPath(folderPath); });
  ipcMain.handle('shell:openExternal', (_, url)        => { shell.openExternal(url); });

  // ── Server management ────────────────────────────────────────────────────────
  // All handles are append-only; launchHandler and other existing handlers untouched.

  ipcMain.handle('server:list', () => {
    return serverHandler.listServers(getServersDir());
  });

  ipcMain.handle('server:create', async (_, opts) => {
    return serverHandler.createServer(opts, getServersDir(), mainWindow);
  });

  ipcMain.handle('server:delete', (_, serverId) => {
    return serverHandler.deleteServer(serverId, getServersDir());
  });

  ipcMain.handle('server:start', (_, serverId) => {
    const s = loadSettings();
    return serverHandler.startServer(serverId, getServersDir(), s.javaPath, mainWindow);
  });

  ipcMain.handle('server:stop', (_, serverId) => {
    return serverHandler.stopServer(serverId, mainWindow);
  });

  ipcMain.handle('server:kill', (_, serverId) => {
    return serverHandler.killServer(serverId, mainWindow);
  });

  ipcMain.handle('server:sendCmd', (_, { serverId, command }) => {
    return serverHandler.sendCommand(serverId, command);
  });

  ipcMain.handle('server:status', (_, serverId) => {
    return serverHandler.getServerStatus(serverId);
  });

  ipcMain.handle('server:acceptEula', (_, serverId) => {
    try {
      serverHandler.acceptEula(serverId, getServersDir());
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('server:getProperties', (_, serverId) => {
    try { return serverHandler.getProperties(serverId, getServersDir()); }
    catch (err) { return { raw: '', parsed: {} }; }
  });

  ipcMain.handle('server:saveProperties', (_, { serverId, updates }) => {
    try { return serverHandler.saveProperties(serverId, getServersDir(), updates); }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('server:worldExists', (_, serverId) => {
    try { return serverHandler.worldExists(serverId, getServersDir()); }
    catch (err) { return { exists: false }; }
  });

  ipcMain.handle('server:rebuildWorld', (_, { serverId, seed, levelType, generateStructures }) => {
    try { return serverHandler.rebuildWorld(serverId, getServersDir(), { seed, levelType, generateStructures }); }
    catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('server:readPlayerData', (_, serverId) => {
    return serverHandler.readPlayerData(serverId, getServersDir());
  });

  ipcMain.handle('server:openDir', (_, serverId) => {
    const sDir = path.join(getServersDir(), serverId);
    shell.openPath(sDir);
  });

  ipcMain.handle('server:listMods', (_, serverId) => {
    return serverHandler.listServerMods(serverId, getServersDir());
  });

  ipcMain.handle('server:removeModById', (_, { serverId, modId }) => {
    return serverHandler.removeServerModById(serverId, getServersDir(), modId);
  });

  // ── Mrpack import ────────────────────────────────────────────────────────────

  ipcMain.handle('dialog:selectMrpack', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择整合包文件',
      filters: [{ name: 'Minecraft 整合包', extensions: ['mrpack', 'zip'] }],
      properties: ['openFile'],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  // Returns a unified preview object regardless of pack format (.mrpack / CurseForge zip)
  ipcMain.handle('mrpack:parse', async (_, filePath) => {
    try {
      return { success: true, ...await mrpackHandler.detectAndParse(filePath) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('mrpack:importClient', async (_, { filePath, instanceName }) => {
    const s = loadSettings();
    const opts = { minecraftDir: s.minecraftDir, javaPath: s.javaPath || '' };
    try {
      const fmt = await mrpackHandler.detectFormat(filePath);
      if (fmt === 'mrpack') {
        return mrpackHandler.importMrpackAsClient(filePath, instanceName, opts, mainWindow);
      } else {
        return mrpackHandler.importLocalPackAsClient(filePath, instanceName, opts, mainWindow);
      }
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('mrpack:importServer', async (_, { filePath, serverName, maxMemory, port }) => {
    const s = loadSettings();
    const opts = {
      serversDir: getServersDir(),
      javaPath:   s.javaPath || '',
      maxMemory:  maxMemory  || 4096,
      port:       port       || 25565,
    };
    try {
      const fmt = await mrpackHandler.detectFormat(filePath);
      if (fmt === 'mrpack') {
        return mrpackHandler.importMrpackAsServer(filePath, serverName, opts, mainWindow);
      } else {
        return mrpackHandler.importLocalPackAsServer(filePath, serverName, opts, mainWindow);
      }
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ── Instance export ────────────────────────────────────────────────────────
  ipcMain.handle('instance:export', async (_, { instanceId, options }) => {
    try {
      const s = loadSettings();

      // Resolve a human-readable default filename from instance metadata
      let defaultName = instanceId;
      try {
        const jsonPath = path.join(s.minecraftDir, 'versions', instanceId, `${instanceId}.json`);
        const json = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
        defaultName = json._cmcl?.name || instanceId;
      } catch {}

      // Ask user where to save before doing any work
      const saveRes = await dialog.showSaveDialog(mainWindow, {
        title:       '导出整合包',
        defaultPath: `${defaultName}.zip`,
        filters:     [{ name: 'ZIP 整合包', extensions: ['zip'] }],
      });

      if (saveRes.canceled || !saveRes.filePath) {
        return { success: false, canceled: true };
      }

      return await mrpackHandler.exportInstanceAsPack(
        instanceId,
        saveRes.filePath,
        options,
        { minecraftDir: s.minecraftDir },
        mainWindow,
      );
    } catch (err) {
      // Send error through progress channel so the UI can react immediately
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('instance:exportProgress', {
          phase: 'error',
          message: `✗ 导出失败: ${err.message}`,
        });
      }
      return { success: false, error: err.message };
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// ── App quit: prevent orphan server processes ──────────────────────────────────
let _isQuitting = false;

app.on('before-quit', async (e) => {
  if (_isQuitting) return;            // already confirmed, let it through
  if (!serverHandler.hasRunningServers()) return;  // nothing running, quit normally

  e.preventDefault();

  const ids = serverHandler.getRunningServerIds();
  const { response } = await dialog.showMessageBox({
    type: 'warning',
    title: 'Tick — 服务器正在运行',
    message: `有 ${ids.length} 个服务器仍在运行`,
    detail: `运行中：${ids.join('、')}\n\n建议先在控制台执行 stop 命令保存世界。\n强制退出将立即终止所有服务器进程。`,
    buttons: ['强制停止并退出', '取消'],
    defaultId: 0,
    cancelId: 1,
  });

  if (response === 0) {
    serverHandler.stopAllServers();
    _isQuitting = true;
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
