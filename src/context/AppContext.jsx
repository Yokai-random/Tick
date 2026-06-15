import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [page, setPage] = useState('home');
  const [settings, setSettings] = useState(null);
  const [theme, setThemeState] = useState('light');
  const [localVersions, setLocalVersions] = useState([]);
  const [downloadState, setDownloadState] = useState(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [loaderLog, setLoaderLog] = useState([]);
  const [isInstallingLoader, setIsInstallingLoader] = useState(false);
  const [launchLog, setLaunchLog] = useState([]);
  const [isLaunching, setIsLaunching] = useState(false);
  const [javaList, setJavaList] = useState(null);

  useEffect(() => {
    loadSettings();
    refreshLocalVersions();
    detectJava();
  }, []);

  useEffect(() => {
    if (!window.cmcl) return;
    const cleanup = window.cmcl.onDownloadProgress((data) => {
      setDownloadState(data);
      if (data.stage === '下载完成') {
        setTimeout(() => { setIsDownloading(false); setDownloadState(null); refreshLocalVersions(); }, 1500);
      }
    });
    return cleanup;
  }, []);

  useEffect(() => {
    if (!window.cmcl) return;
    const cleanup = window.cmcl.onLoaderProgress((data) => {
      setLoaderLog((prev) => [...prev.slice(-200), data.message]);
    });
    return cleanup;
  }, []);

  useEffect(() => {
    if (!window.cmcl) return;
    const cleanup = window.cmcl.onLaunchOutput((data) => {
      setLaunchLog((prev) => [...prev.slice(-500), data]);
      if (data.type === 'exit' || data.type === 'error') setIsLaunching(false);
    });
    return cleanup;
  }, []);

  const loadSettings = useCallback(async () => {
    if (!window.cmcl) return;
    const s = await window.cmcl.getSettings();
    setSettings(s);
    const t = s?.theme || 'light';
    setThemeState(t);
    document.documentElement.setAttribute('data-theme', t);
  }, []);

  const toggleTheme = useCallback(async () => {
    const next = theme === 'light' ? 'dark' : 'light';
    setThemeState(next);
    document.documentElement.setAttribute('data-theme', next);
    if (window.cmcl && settings) {
      await window.cmcl.saveSettings({ ...settings, theme: next });
      setSettings(prev => ({ ...prev, theme: next }));
    }
  }, [theme, settings]);

  const updateSettings = useCallback(async (newSettings) => {
    if (!window.cmcl) return;
    const merged = { ...settings, ...newSettings };
    await window.cmcl.saveSettings(merged);
    setSettings(merged);
  }, [settings]);

  const refreshLocalVersions = useCallback(async () => {
    if (!window.cmcl) return;
    const versions = await window.cmcl.getLocalVersions();
    setLocalVersions(versions);
  }, []);

  const detectJava = useCallback(async () => {
    if (!window.cmcl) return;
    const list = await window.cmcl.detectJava();
    setJavaList(list);
    if (list?.length > 0) {
      const s = await window.cmcl.getSettings();
      if (!s.javaPath) {
        const updated = { ...s, javaPath: list[0].path };
        await window.cmcl.saveSettings(updated);
        setSettings(updated);
      }
    }
  }, []);

  const startDownload = useCallback(async (versionInfo) => {
    setIsDownloading(true);
    setDownloadState({ stage: '准备中...', completed: 0, total: 0, detail: '' });
    const result = await window.cmcl.downloadVersion(versionInfo);
    if (!result.success) {
      setIsDownloading(false);
      setDownloadState(null);
      throw new Error(result.error);
    }
  }, []);

  const launch = useCallback(async (versionId) => {
    if (!settings) return;
    setIsLaunching(true);
    setLaunchLog([]);
    const result = await window.cmcl.launchGame({
      versionId,
      javaPath: settings.javaPath,
      username: settings.username || 'Steve',
      maxMemory: settings.maxMemory || 2048,
      account: settings.account || null,
    });
    if (!result.success) {
      setIsLaunching(false);
      throw new Error(result.error);
    }
    await updateSettings({ lastLaunchedVersion: versionId });
  }, [settings, updateSettings]);

  const loginMicrosoft = useCallback(async () => {
    const result = await window.cmcl.loginMicrosoft();
    if (result.success) {
      await loadSettings();
    }
    return result;
  }, [loadSettings]);

  const logout = useCallback(async () => {
    await window.cmcl.logout();
    await loadSettings();
  }, [loadSettings]);

  const deleteVersion = useCallback(async (versionId) => {
    if (!window.cmcl) return { success: false, error: 'cmcl not available' };
    const result = await window.cmcl.deleteVersion(versionId);
    if (result.success) await refreshLocalVersions();
    return result;
  }, [refreshLocalVersions]);

  const installLoader = useCallback(async (fn) => {
    setIsInstallingLoader(true);
    setLoaderLog([]);
    try {
      const result = await fn();
      if (result.success) await refreshLocalVersions();
      return result;
    } finally {
      setIsInstallingLoader(false);
    }
  }, [refreshLocalVersions]);

  return (
    <AppContext.Provider value={{
      page, setPage,
      settings, updateSettings, loadSettings,
      theme, toggleTheme,
      localVersions, refreshLocalVersions, deleteVersion,
      downloadState, isDownloading, startDownload,
      loaderLog, isInstallingLoader, installLoader,
      launchLog, isLaunching, launch,
      javaList, detectJava,
      loginMicrosoft, logout,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
