const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cmcl', {
  // Window
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),

  // Settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (s) => ipcRenderer.invoke('settings:save', s),
  selectDir: () => ipcRenderer.invoke('dialog:selectDir'),

  // Versions
  getVersionList: (source) => ipcRenderer.invoke('version:list', source),
  getLocalVersions: () => ipcRenderer.invoke('version:local'),
  deleteVersion: (id) => ipcRenderer.invoke('version:delete', id),
  openVersionDir: (id) => ipcRenderer.invoke('version:openDir', id),

  // Download
  downloadVersion: (info) => ipcRenderer.invoke('download:version', info),
  onDownloadProgress: (cb) => {
    const h = (_, d) => cb(d);
    ipcRenderer.on('download:progress', h);
    return () => ipcRenderer.removeListener('download:progress', h);
  },

  // Java
  detectJava: () => ipcRenderer.invoke('java:detect'),
  javaDownload: (major) => ipcRenderer.invoke('java:download', major),
  javaDelete:   (major) => ipcRenderer.invoke('java:delete',   major),
  onJavaDownloadProgress: (cb) => {
    const h = (_, d) => cb(d);
    ipcRenderer.on('java:downloadProgress', h);
    return () => ipcRenderer.removeListener('java:downloadProgress', h);
  },

  // Launch
  launchGame: (opts) => ipcRenderer.invoke('launch:game', opts),
  onLaunchOutput: (cb) => {
    const h = (_, d) => cb(d);
    ipcRenderer.on('launch:output', h);
    return () => ipcRenderer.removeListener('launch:output', h);
  },

  // Auth
  loginMicrosoft: () => ipcRenderer.invoke('auth:microsoft'),
  logout: () => ipcRenderer.invoke('auth:logout'),

  // Mod loaders
  getFabricVersions: (mc) => ipcRenderer.invoke('loader:fabric:versions', mc),
  installFabric: (mc, loader) => ipcRenderer.invoke('loader:fabric:install', { mcVersion: mc, loaderVersion: loader }),
  getForgeVersions: (mc) => ipcRenderer.invoke('loader:forge:versions', mc),
  installForge: (mc, forge) => ipcRenderer.invoke('loader:forge:install', { mcVersion: mc, forgeVersion: forge }),
  getNeoForgeVersions: (mc) => ipcRenderer.invoke('loader:neoforge:versions', mc),
  installNeoForge: (mc, ver) => ipcRenderer.invoke('loader:neoforge:install', { mcVersion: mc, neoForgeVersion: ver }),
  onLoaderProgress: (cb) => {
    const h = (_, d) => cb(d);
    ipcRenderer.on('loader:progress', h);
    return () => ipcRenderer.removeListener('loader:progress', h);
  },

  // Modrinth
  searchMods: (query, mcVersion, loader, offset, sortIndex) => ipcRenderer.invoke('modrinth:search', { query, mcVersion, loader, offset, sortIndex }),
  searchContent: (query, mcVersion, projectType, offset) => ipcRenderer.invoke('modrinth:search-content', { query, mcVersion, projectType, offset }),
  getModVersions: (projectId, mcVersion, loader) => ipcRenderer.invoke('modrinth:versions', { projectId, mcVersion, loader }),
  getProjects: (ids) => ipcRenderer.invoke('modrinth:projects', ids),
  downloadMod: (fileUrl, fileName, versionId) => ipcRenderer.invoke('modrinth:download', { fileUrl, fileName, versionId }),
  downloadContent: (fileUrl, fileName, versionId, contentType) => ipcRenderer.invoke('modrinth:download-content', { fileUrl, fileName, versionId, contentType }),
  listInstalledContent: (versionId, contentType) => ipcRenderer.invoke('content:list-installed', { versionId, contentType }),

  // Mod management
  getInstalledMods: (versionId) => ipcRenderer.invoke('mods:list', versionId),
  toggleMod: (modPath) => ipcRenderer.invoke('mods:toggle', modPath),
  deleteMod: (modPath) => ipcRenderer.invoke('mods:delete', modPath),
  checkDeps: (versionId) => ipcRenderer.invoke('mods:checkDeps', versionId),

  // 实例管理
  createInstance: (opts) => ipcRenderer.invoke('instance:create', opts),

  // Shell
  openFolder:    (p)   => ipcRenderer.invoke('shell:openFolder', p),
  openExternal:  (url) => ipcRenderer.invoke('shell:openExternal', url),

  // ── Server management ──────────────────────────────────────────────────────
  serverList:         ()                  => ipcRenderer.invoke('server:list'),
  serverCreate:       (opts)              => ipcRenderer.invoke('server:create', opts),
  serverDelete:       (id)                => ipcRenderer.invoke('server:delete', id),
  serverStart:        (id)                => ipcRenderer.invoke('server:start', id),
  serverStop:         (id)                => ipcRenderer.invoke('server:stop', id),
  serverKill:         (id)                => ipcRenderer.invoke('server:kill', id),
  serverSendCmd:      (id, cmd)           => ipcRenderer.invoke('server:sendCmd', { serverId: id, command: cmd }),
  serverStatus:       (id)                => ipcRenderer.invoke('server:status', id),
  serverAcceptEula:   (id)                => ipcRenderer.invoke('server:acceptEula', id),
  serverGetProps:     (id)                => ipcRenderer.invoke('server:getProperties', id),
  serverSaveProps:    (id, updates)       => ipcRenderer.invoke('server:saveProperties', { serverId: id, updates }),
  serverReadPlayerData: (id)              => ipcRenderer.invoke('server:readPlayerData', id),
  serverOpenDir:      (id)                => ipcRenderer.invoke('server:openDir', id),
  serverListMods:     (id)                => ipcRenderer.invoke('server:listMods', id),
  serverRemoveModById:(id, modId)         => ipcRenderer.invoke('server:removeModById', { serverId: id, modId }),
  serverWorldExists:  (id)               => ipcRenderer.invoke('server:worldExists', id),
  serverRebuildWorld: (id, opts)         => ipcRenderer.invoke('server:rebuildWorld', { serverId: id, ...opts }),

  // Push events: main → renderer
  onServerOutput: (cb) => {
    const h = (_, d) => cb(d);
    ipcRenderer.on('server:output', h);
    return () => ipcRenderer.removeListener('server:output', h);
  },
  onServerStatus: (cb) => {
    const h = (_, d) => cb(d);
    ipcRenderer.on('server:status', h);
    return () => ipcRenderer.removeListener('server:status', h);
  },
  onServerProgress: (cb) => {
    const h = (_, d) => cb(d);
    ipcRenderer.on('server:installProgress', h);
    return () => ipcRenderer.removeListener('server:installProgress', h);
  },

  // Pendant inertia — window move signal from main process
  onWindowMoved: (cb) => {
    const h = (_, d) => cb(d);
    ipcRenderer.on('window:moved', h);
    return () => ipcRenderer.removeListener('window:moved', h);
  },

  // ── Mrpack import ──────────────────────────────────────────────────────────
  selectMrpackFile: () => ipcRenderer.invoke('dialog:selectMrpack'),
  parseMrpack: (fp) => ipcRenderer.invoke('mrpack:parse', fp),
  importMrpackAsClient: (fp, name) =>
    ipcRenderer.invoke('mrpack:importClient', { filePath: fp, instanceName: name }),
  importMrpackAsServer: (fp, name, mem, port) =>
    ipcRenderer.invoke('mrpack:importServer', { filePath: fp, serverName: name, maxMemory: mem, port }),
  onMrpackProgress: (cb) => {
    const h = (_, d) => cb(d);
    ipcRenderer.on('mrpack:progress', h);
    return () => ipcRenderer.removeListener('mrpack:progress', h);
  },

  // ── Instance export ────────────────────────────────────────────────────────
  instanceExport: (instanceId, options) =>
    ipcRenderer.invoke('instance:export', { instanceId, options }),
  onExportProgress: (cb) => {
    const h = (_, d) => cb(d);
    ipcRenderer.on('instance:exportProgress', h);
    return () => ipcRenderer.removeListener('instance:exportProgress', h);
  },
});
