import React, { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';

// ── Utilities ─────────────────────────────────────────────────────────────────

function lineColor(type) {
  switch (type) {
    case 'stderr':  return '#f6c90e';
    case 'error':   return '#f56565';
    case 'exit':    return '#4ade80';
    case 'info':    return '#5ba3f5';
    default:        return '#c8d0e0';
  }
}

// ── Crash log: client-mod dependency error detection ─────────────────────────
// Parses server output lines for NeoForge/Forge mod dependency errors where
// the missing mod is a known client-only mod (sodium, iris, embeddium, etc.).
// Returns [{ mod: 'flerovium', missingDep: 'sodium' }, ...]
const CRASH_CLIENT_CORE = new Set(['sodium','iris','embeddium','rubidium','oculus','optifine','optifabric','distanthorizons']);

function parseCrashClientModErrors(logLines) {
  if (!logLines || logLines.length === 0) return [];
  // Only scan the last 400 lines — crash info always appears at the end
  const lines = logLines.slice(-400).map(l => l.message || '');
  const found = new Map(); // modId → missingDep

  for (const line of lines) {
    // Pattern A: "Mod 'X' requires Y ..."  (various NeoForge/Forge formats)
    // Covers: "Mod 'flerovium' requires sodium 0.6.9+"
    //         "Mod 'colorwheel' requires mod 'iris' to be installed"
    const mA = line.match(/[Mm]od\s+'([^']+)'\s+requires\s+(?:mod\s+'([^']+)'|(?:mod\s+)?'?([a-z][a-z0-9_\-]*)'?)\s*/);
    if (mA) {
      const requiring = mA[1];
      const dep = (mA[2] || mA[3] || '').toLowerCase();
      if (CRASH_CLIENT_CORE.has(dep) && !CRASH_CLIENT_CORE.has(requiring.toLowerCase())) {
        found.set(requiring, dep);
      }
    }

    // Pattern B: "- sodium, required by: flerovium (version ...)"
    // NeoForge ModResolutionException summary list
    const mB = line.match(/[-•*]\s+([a-z][a-z0-9_\-]*),?\s+required by:\s+([a-z][a-z0-9_\-,\s]+)/i);
    if (mB) {
      const missing = mB[1].toLowerCase();
      if (CRASH_CLIENT_CORE.has(missing)) {
        const requirers = mB[2].split(/[\s,]+/).filter(s => /^[a-z]/i.test(s));
        for (const r of requirers) {
          if (r && !CRASH_CLIENT_CORE.has(r.toLowerCase())) found.set(r, missing);
        }
      }
    }

    // Pattern C removed: matching any word before "requires" in a log line was
    // too greedy and caused false positives (e.g. "[create/]: ..." triggered
    // "create" as the requiring mod).  Patterns A and B cover real NeoForge cases.
  }

  return [...found.entries()].map(([mod, missingDep]) => ({ mod, missingDep }));
}

// Detect "old Forge (ModLauncher 8.0.x) + Java 8u321+" incompatibility crash.
// Triggered by: NoSuchMethodError on ManifestEntryVerifier.<init> when Java 8
// removed that internal constructor starting from 8u321.
function detectJavaForgeIncompatCrash(logLines) {
  if (!logLines || logLines.length === 0) return false;
  const lines = logLines.slice(-400).map(l => l.message || '');
  let hasNoSuchMethod = false;
  let hasManifestEntry = false;
  for (const line of lines) {
    if (line.includes('NoSuchMethodError'))    hasNoSuchMethod  = true;
    if (line.includes('ManifestEntryVerifier')) hasManifestEntry = true;
    if (hasNoSuchMethod && hasManifestEntry) return true;
  }
  return false;
}

// Parse vanilla/modded `list` command response robustly.
// Returns string[] of player names, or null if line is not a list response.
function parseListResponse(raw) {
  // Strip ANSI escape codes that some servers/mods inject
  const text = raw.replace(/\x1b\[[0-9;]*[mGKHFJA-Za-z]/g, '').trim();
  // Match "players online:" (lenient — works across versions, prefixes, languages)
  const m = text.match(/players\s+online[^:]*:\s*(.*)/i);
  if (!m) return null;
  const part = m[1].trim();
  if (!part) return [];
  return part.split(',').map(n => n.trim()).filter(n => n.length > 0 && n.length < 50);
}

// ── Shared styles ────────────────────────────────────────────────────────────

const overlayStyle = {
  position: 'fixed', inset: 0, zIndex: 100,
  background: 'rgba(0,0,0,0.32)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)',
};
const modalStyle = {
  background: 'rgba(255,255,255,0.93)',
  border: '1px solid rgba(255,255,255,0.90)',
  borderRadius: 'var(--radius)',
  padding: '24px 28px',
  boxShadow: '0 8px 40px rgba(0,0,0,0.18)',
  width: '90%',
};

// ── Modal components ─────────────────────────────────────────────────────────

function EulaDialog({ serverId, onConfirm, onCancel }) {
  const [busy, setBusy] = useState(false);
  const handleConfirm = async () => {
    setBusy(true);
    await window.cmcl.serverAcceptEula(serverId);
    setBusy(false);
    onConfirm();
  };
  return (
    <div style={overlayStyle}>
      <div style={{ ...modalStyle, maxWidth: 500 }}>
        <h2 style={{ fontSize: 17, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 14 }}>
          Mojang 最终用户许可协议
        </h2>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7, marginBottom: 12 }}>
          启动 Minecraft 服务端前，需要您同意{' '}
          <a href="https://aka.ms/MinecraftEULA" target="_blank" rel="noreferrer"
            style={{ color: 'var(--accent)' }}>Mojang EULA</a>。
        </p>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7, marginBottom: 20 }}>
          点击「我已阅读并同意」后，Tick 将写入 <code style={{ fontSize: 12 }}>eula=true</code>，
          代表您接受上述协议。
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" onClick={onCancel} disabled={busy}>取消</button>
          <button className="btn btn-primary" onClick={handleConfirm} disabled={busy}>
            {busy ? '写入中...' : '我已阅读并同意'}
          </button>
        </div>
      </div>
    </div>
  );
}

function DeleteConfirmModal({ serverName, onConfirm, onCancel }) {
  return (
    <div style={overlayStyle}>
      <div style={{ ...modalStyle, maxWidth: 440 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 12 }}>
          确认删除服务器？
        </h2>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7, marginBottom: 20 }}>
          将永久删除服务器「<strong>{serverName}</strong>」及其所有数据（世界存档、Mod、配置等）。
          <br />此操作不可撤销。
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" onClick={onCancel}>取消</button>
          <button className="btn btn-danger" onClick={onConfirm}>确认删除</button>
        </div>
      </div>
    </div>
  );
}

function CreateServerModal({ onClose, onCreated, settings }) {
  const [name, setName]           = useState('');
  const [mcVersion, setMcVersion] = useState('');
  const [loader, setLoader]           = useState('vanilla');
  const [nfVersion, setNfVersion]     = useState('');
  const [nfVersions, setNfVersions]   = useState([]);
  const [loadingNf, setLoadingNf]     = useState(false);
  const [fabricVersion, setFabricVersion]   = useState('');
  const [fabricVersions, setFabricVersions] = useState([]);
  const [loadingFabric, setLoadingFabric]   = useState(false);
  const [forgeVersion, setForgeVersion]   = useState('');
  const [forgeVersions, setForgeVersions] = useState([]);
  const [loadingForge, setLoadingForge]   = useState(false);
  const [port, setPort]           = useState('25565');
  const [maxMemory, setMaxMemory] = useState('4096');
  const [versions, setVersions]   = useState([]);
  const [loadingVers, setLoadingVers] = useState(false);
  const [creating, setCreating]   = useState(false);
  const [progressLog, setProgressLog] = useState([]);
  const [error, setError]         = useState('');
  const [levelSeed, setLevelSeed]                   = useState('');
  const [levelType, setLevelType]                   = useState('minecraft:normal');
  const [generateStructures, setGenerateStructures] = useState(true);
  const logRef  = useRef(null);
  const nameRef = useRef(null);

  useEffect(() => { nameRef.current?.focus(); }, []);

  useEffect(() => {
    setLoadingVers(true);
    window.cmcl.getVersionList('bmclapi')
      .then(list => {
        const releases = (list || []).filter(v => v.type === 'release');
        setVersions(releases);
        if (releases.length > 0) setMcVersion(releases[0].id);
      })
      .catch(() => setError('获取版本列表失败，请检查网络'))
      .finally(() => setLoadingVers(false));
  }, []);

  // Load NeoForge versions when loader=neoforge or mcVersion changes
  useEffect(() => {
    if (loader !== 'neoforge' || !mcVersion) return;
    setError(''); setLoadingNf(true); setNfVersion(''); setNfVersions([]);
    window.cmcl.getNeoForgeVersions(mcVersion)
      .then(res => {
        // IPC returns { success, data } — extract the array
        const raw = res?.data ?? res;
        const list = Array.isArray(raw) ? raw : [];
        setNfVersions(list);
        if (list.length > 0) setNfVersion(list[0]);
        else setError(`MC ${mcVersion} 暂无可用的 NeoForge 版本`);
      })
      .catch(() => setError('获取 NeoForge 版本列表失败，请检查网络'))
      .finally(() => setLoadingNf(false));
  }, [loader, mcVersion]);

  // Fabric versions
  useEffect(() => {
    if (loader !== 'fabric' || !mcVersion) return;
    setError(''); setLoadingFabric(true); setFabricVersion(''); setFabricVersions([]);
    window.cmcl.getFabricVersions(mcVersion)
      .then(res => {
        const raw = res?.data ?? res;
        const list = Array.isArray(raw) ? raw : [];
        setFabricVersions(list);
        if (list.length > 0) setFabricVersion(list[0]?.version ?? list[0]);
        else setError(`MC ${mcVersion} 暂无可用的 Fabric 版本`);
      })
      .catch(() => setError('获取 Fabric 版本列表失败，请检查网络'))
      .finally(() => setLoadingFabric(false));
  }, [loader, mcVersion]);

  // Forge versions
  useEffect(() => {
    if (loader !== 'forge' || !mcVersion) return;
    setError(''); setLoadingForge(true); setForgeVersion(''); setForgeVersions([]);
    window.cmcl.getForgeVersions(mcVersion)
      .then(res => {
        const raw = res?.data ?? res;
        const list = Array.isArray(raw) ? raw : [];
        setForgeVersions(list);
        if (list.length > 0) setForgeVersion(list[0]?.version ?? list[0]);
        else setError(`MC ${mcVersion} 暂无可用的 Forge 版本`);
      })
      .catch(() => setError('获取 Forge 版本列表失败，请检查网络'))
      .finally(() => setLoadingForge(false));
  }, [loader, mcVersion]);

  useEffect(() => {
    const off = window.cmcl.onServerProgress(({ message }) =>
      setProgressLog(prev => [...prev.slice(-300), message]));
    return off;
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [progressLog]);

  const handleCreate = async () => {
    if (!name.trim()) { setError('请输入服务器名称'); return; }
    if (!mcVersion)   { setError('请选择 MC 版本'); return; }
    if (loader === 'neoforge' && !nfVersion)     { setError('请选择 NeoForge 版本'); return; }
    if (loader === 'fabric'   && !fabricVersion) { setError('请选择 Fabric 版本'); return; }
    if (loader === 'forge'    && !forgeVersion)  { setError('请选择 Forge 版本'); return; }
    const portNum = parseInt(port, 10);
    if (!port || isNaN(portNum) || portNum < 1 || portNum > 65535) {
      setError('端口需为 1–65535 之间的整数'); return;
    }
    const loaderVersion = loader === 'neoforge' ? nfVersion
                        : loader === 'fabric'   ? fabricVersion
                        : loader === 'forge'    ? forgeVersion
                        : null;
    setError(''); setCreating(true); setProgressLog([]);
    const result = await window.cmcl.serverCreate({
      name: name.trim(), mcVersion,
      loader, loaderVersion,
      port: portNum, maxMemory: parseInt(maxMemory, 10) || 4096,
      javaPath: settings?.javaPath || '',
      levelSeed: levelSeed.trim(),
      levelType,
      generateStructures,
    });
    setCreating(false);
    if (result.success) onCreated(result.id);
    else setError(result.error || '创建失败');
  };

  const loaderBtnStyle = (id) => ({
    flex: 1, padding: '6px 0', fontSize: 12, cursor: creating ? 'default' : 'pointer',
    borderRadius: 'var(--radius-sm)', border: '1px solid',
    borderColor: loader === id ? 'rgba(45,127,244,0.5)' : 'rgba(0,0,0,0.12)',
    background: loader === id ? 'rgba(45,127,244,0.10)' : 'transparent',
    color: loader === id ? 'var(--accent)' : 'var(--text-secondary)',
    fontWeight: loader === id ? 600 : 400, transition: 'all 0.12s',
  });

  return (
    <div style={overlayStyle}>
      <div style={{ ...modalStyle, maxWidth: 520 }}>
        <h2 style={{ fontSize: 17, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 20 }}>
          新建服务器实例
        </h2>
        <div className="form-group">
          <label className="form-label">服务器名称</label>
          <input ref={nameRef} className="form-input" value={name}
            onChange={e => setName(e.target.value)} placeholder="my-server" disabled={creating}
            onKeyDown={e => { if (e.key === 'Enter' && !creating) handleCreate(); }} />
        </div>

        <div style={{ display: 'flex', gap: 12 }}>
          <div className="form-group" style={{ flex: 1 }}>
            <label className="form-label">Minecraft 版本</label>
            {loadingVers
              ? <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '8px 0' }}>获取版本列表...</div>
              : <select className="form-select" value={mcVersion}
                  onChange={e => setMcVersion(e.target.value)} disabled={creating}>
                  {versions.map(v => <option key={v.id} value={v.id}>{v.id}</option>)}
                </select>}
          </div>
          <div className="form-group" style={{ width: 110 }}>
            <label className="form-label">端口</label>
            <input className="form-input" type="number" min="1" max="65535"
              value={port} onChange={e => setPort(e.target.value)} disabled={creating} />
          </div>
        </div>

        {/* Loader selection */}
        <div className="form-group">
          <label className="form-label">加载器</label>
          <div style={{ display: 'flex', gap: 6 }}>
            {['vanilla', 'fabric', 'forge', 'neoforge'].map(id => (
              <button key={id} style={loaderBtnStyle(id)} disabled={creating}
                onClick={() => { setLoader(id); setError(''); }}>
                {id.charAt(0).toUpperCase() + id.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* NeoForge version */}
        {loader === 'neoforge' && (
          <div className="form-group">
            <label className="form-label">NeoForge 版本</label>
            {loadingNf
              ? <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '8px 0' }}>获取 NeoForge 版本...</div>
              : Array.isArray(nfVersions) && nfVersions.length > 0
                ? <select className="form-select" value={nfVersion}
                    onChange={e => setNfVersion(e.target.value)} disabled={creating}>
                    {nfVersions.map(v => <option key={v} value={v}>{v}</option>)}
                  </select>
                : <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '8px 0' }}>
                    当前 MC 版本无可用的 NeoForge
                  </div>
            }
          </div>
        )}

        {/* Fabric version */}
        {loader === 'fabric' && (
          <div className="form-group">
            <label className="form-label">Fabric Loader 版本</label>
            {loadingFabric
              ? <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '8px 0' }}>获取 Fabric 版本...</div>
              : Array.isArray(fabricVersions) && fabricVersions.length > 0
                ? <select className="form-select" value={fabricVersion}
                    onChange={e => setFabricVersion(e.target.value)} disabled={creating}>
                    {fabricVersions.map(v => {
                      const ver = v?.version ?? v;
                      return (
                        <option key={ver} value={ver}>
                          {ver}{v?.stable ? ' ★' : ''}
                        </option>
                      );
                    })}
                  </select>
                : <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '8px 0' }}>
                    当前 MC 版本无可用的 Fabric
                  </div>
            }
          </div>
        )}

        {/* Forge version */}
        {loader === 'forge' && (
          <div className="form-group">
            <label className="form-label">Forge 版本</label>
            {loadingForge
              ? <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '8px 0' }}>获取 Forge 版本...</div>
              : Array.isArray(forgeVersions) && forgeVersions.length > 0
                ? <select className="form-select" value={forgeVersion}
                    onChange={e => setForgeVersion(e.target.value)} disabled={creating}>
                    {forgeVersions.map(v => {
                      const ver = v?.version ?? v;
                      return <option key={ver} value={ver}>{ver}</option>;
                    })}
                  </select>
                : <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '8px 0' }}>
                    当前 MC 版本无可用的 Forge
                  </div>
            }
          </div>
        )}

        <div className="form-group">
          <label className="form-label">最大内存 (MB)</label>
          <input className="form-input" type="number" min="512" max="32768"
            value={maxMemory} onChange={e => setMaxMemory(e.target.value)} disabled={creating} />
        </div>

        {/* World generation – collapsed by default */}
        <details style={{ marginBottom: 14 }} disabled={creating}>
          <summary style={{
            fontSize: 12, color: 'var(--text-muted)', cursor: creating ? 'default' : 'pointer',
            userSelect: 'none', padding: '4px 0',
          }}>
            世界生成（高级）
          </summary>
          <div style={{ marginTop: 10, paddingLeft: 2 }}>
            <div className="form-group">
              <label className="form-label">世界种子（留空随机）</label>
              <input className="form-input" value={levelSeed}
                onChange={e => setLevelSeed(e.target.value)}
                placeholder="（随机）" disabled={creating} />
            </div>
            <div className="form-group">
              <label className="form-label">世界类型</label>
              <select className="form-select" value={levelType}
                onChange={e => setLevelType(e.target.value)} disabled={creating}>
                <option value="minecraft:normal">普通 (normal)</option>
                <option value="minecraft:flat">超平坦 (flat)</option>
                <option value="minecraft:large_biomes">巨型生物群系 (large_biomes)</option>
                <option value="minecraft:amplified">极大化 (amplified)</option>
              </select>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8,
              cursor: creating ? 'default' : 'pointer', marginBottom: 4 }}>
              <input type="checkbox" checked={generateStructures}
                onChange={e => setGenerateStructures(e.target.checked)} disabled={creating} />
              <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                生成地物（村庄、神殿等）
              </span>
            </label>
          </div>
        </details>

        {progressLog.length > 0 && (
          <div ref={logRef} style={{
            background: 'rgba(5,8,20,0.72)', borderRadius: 'var(--radius-sm)',
            padding: '10px 12px', height: 130, overflowY: 'auto',
            fontFamily: 'Consolas, monospace', fontSize: 12, lineHeight: 1.6,
            color: '#c8d0e0', marginBottom: 14,
          }}>
            {progressLog.map((m, i) => (
              <div key={i} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{m}</div>
            ))}
          </div>
        )}
        {error && (
          <div style={{ padding: '8px 12px', background: 'rgba(245,101,101,0.12)',
            border: '1px solid rgba(245,101,101,0.30)', borderRadius: 'var(--radius-sm)',
            color: 'var(--red)', fontSize: 12, marginBottom: 14 }}>{error}</div>
        )}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" onClick={onClose} disabled={creating}>取消</button>
          <button className="btn btn-primary" onClick={handleCreate}
            disabled={creating || loadingVers
              || (loader === 'neoforge' && (loadingNf     || !nfVersion))
              || (loader === 'fabric'   && (loadingFabric || !fabricVersion))
              || (loader === 'forge'    && (loadingForge  || !forgeVersion))}>
            {creating
              ? <><span className="spinner" /> {
                  loader === 'neoforge' || loader === 'forge' ? '安装中...' : '下载中...'
                }</>
              : '创建'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── MrpackServerImportModal ───────────────────────────────────────────────────

const INVALID_SERVER_NAME_RE = /[\\/:*?"<>|]/;

function sanitizeServerName(raw) {
  return (raw || '').replace(INVALID_SERVER_NAME_RE, '').trim().slice(0, 60);
}

function serverLoaderBadge(loader, loaderVersion) {
  if (!loader) return '原版';
  const label = { fabric: 'Fabric', neoforge: 'NeoForge', forge: 'Forge' }[loader] || loader;
  return loaderVersion ? `${label} ${loaderVersion}` : label;
}

function serverPackFormatLabel(fmt) {
  if (fmt === 'mrpack')     return 'Modrinth .mrpack';
  if (fmt === 'curseforge') return 'CurseForge / HMCL 本地打包';
  return fmt || '未知格式';
}

function logLineColor(type) {
  if (type === 'error')   return '#f56565';
  if (type === 'success') return '#4ade80';
  if (type === 'detail')  return 'rgba(200,208,224,0.55)';
  return '#c8d0e0';
}

function MrpackServerImportModal({ onClose, onImported, settings }) {
  const [step, setStep]           = useState('preview');
  const [filePath, setFilePath]   = useState('');
  const [packInfo, setPackInfo]   = useState(null);
  const [parseError, setParseError] = useState('');
  const [parsing, setParsing]     = useState(false);

  const [serverName, setServerName] = useState('');
  const [nameError, setNameError]   = useState('');
  const [maxMemory, setMaxMemory]   = useState('4096');
  const [port, setPort]             = useState('25565');

  const [log, setLog]       = useState([]);
  const [result, setResult] = useState(null);

  const logEndRef        = useRef(null);
  const currentServerRef = useRef(''); // avoids stale closure in event handler

  // Auto-scroll log
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'auto' });
  }, [log.length]);

  // Subscribe to progress events while importing
  useEffect(() => {
    if (step !== 'importing') return;
    const append = (type, text) => setLog(prev => [...prev, { type, text }]);

    const u1 = window.cmcl.onMrpackProgress(({ phase, message, completed, total }) => {
      const badge = (completed != null && total != null && total > 0) ? `[${completed}/${total}] ` : '';
      append(phase === 'error' ? 'error' : phase === 'done' ? 'success' : 'info', badge + message);
    });

    const u2 = window.cmcl.onServerProgress(({ serverId, message }) => {
      // Show all server messages if we don't know the id yet, else filter to ours
      if (!currentServerRef.current || serverId === currentServerRef.current) {
        append('detail', message);
      }
    });

    return () => { u1(); u2(); };
  }, [step]);

  const handleSelectFile = async () => {
    setParsing(true);
    setParseError('');
    setPackInfo(null);
    setFilePath('');

    const fp = await window.cmcl.selectMrpackFile();
    if (!fp) { setParsing(false); return; }

    const res = await window.cmcl.parseMrpack(fp);
    setParsing(false);

    if (!res.success) { setParseError(res.error); return; }

    setFilePath(fp);
    setPackInfo(res);
    setServerName(
      sanitizeServerName(res.name) ||
      sanitizeServerName(fp.split(/[\\/]/).pop().replace(/\.(mrpack|zip)$/i, '')),
    );
  };

  const handleImport = async () => {
    const trimmed = serverName.trim();
    if (!trimmed)                             { setNameError('服务器名不能为空'); return; }
    if (INVALID_SERVER_NAME_RE.test(trimmed)) { setNameError('名称含非法字符（\\ / : * ? " < > |）'); return; }
    if (trimmed.length > 60)                  { setNameError('名称不能超过 60 个字符'); return; }
    const mem     = parseInt(maxMemory, 10);
    const portNum = parseInt(port, 10);
    if (isNaN(mem) || mem < 512)                          { setNameError('内存至少 512 MB'); return; }
    if (isNaN(portNum) || portNum < 1 || portNum > 65535) { setNameError('端口需为 1–65535 的整数'); return; }
    setNameError('');
    currentServerRef.current = trimmed;
    setStep('importing');
    setLog([]);

    const res = await window.cmcl.importMrpackAsServer(filePath, trimmed, mem, portNum);
    setResult(res);
    setStep('done');
    if (res.success) onImported?.();
  };

  // (No auto-delete on import — see renderDone for informational-only display)

  // ── Render: preview ──────────────────────────────────────────────────────────
  const renderPreview = () => (
    <div>
      <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 18 }}>
        导入整合包（服务端）
      </h2>

      {/* File picker */}
      <div style={{ marginBottom: 16 }}>
        <button
          className="btn btn-ghost"
          style={{ width: '100%', justifyContent: 'center', padding: '10px', fontSize: 13 }}
          onClick={handleSelectFile}
          disabled={parsing}
        >
          {parsing
            ? <><span className="spinner" style={{ marginRight: 8 }} />解析中（大文件可能需要数秒）...</>
            : filePath ? `✓ ${filePath.split(/[\\/]/).pop()}` : '选择整合包文件（.mrpack 或 .zip）'}
        </button>
        {parseError && (
          <div style={{ marginTop: 8, fontSize: 12, color: 'var(--red)', lineHeight: 1.5 }}>
            ✗ {parseError}
          </div>
        )}
      </div>

      {/* Pack info */}
      {packInfo && (
        <div style={{
          background: 'rgba(45,127,244,0.06)', border: '1px solid rgba(45,127,244,0.18)',
          borderRadius: 'var(--radius-sm)', padding: '10px 14px', marginBottom: 16,
          fontSize: 12, lineHeight: 1.8, color: 'var(--text-secondary)',
        }}>
          <div>
            <span style={{ color: 'var(--text-muted)', marginRight: 6 }}>整合包</span>
            <strong style={{ color: 'var(--text-primary)' }}>{packInfo.name || '(未命名)'}</strong>
          </div>
          <div>
            <span style={{ color: 'var(--text-muted)', marginRight: 6 }}>格式</span>
            {serverPackFormatLabel(packInfo.packFormat)}
          </div>
          <div>
            <span style={{ color: 'var(--text-muted)', marginRight: 6 }}>游戏版本</span>
            MC {packInfo.mcVersion}
          </div>
          <div>
            <span style={{ color: 'var(--text-muted)', marginRight: 6 }}>加载器</span>
            {serverLoaderBadge(packInfo.loader, packInfo.loaderVersion)}
          </div>
          <div>
            <span style={{ color: 'var(--text-muted)', marginRight: 6 }}>Mod</span>
            <strong style={{ color: '#5ba3f5' }}>{packInfo.modCount}</strong>
            <span style={{ color: 'var(--text-muted)', marginLeft: 4 }}>
              {packInfo.packFormat === 'curseforge' ? '个（已内嵌，无需下载）' : '个'}
            </span>
          </div>
          {packInfo.packFormat === 'curseforge' && (
            <div style={{ marginTop: 4, color: 'rgba(200,208,224,0.6)', fontSize: 11, lineHeight: 1.5 }}>
              ℹ 该格式无客户端/服务端标记，所有 Mod 将完整导入（Tick 不自动删除任何 Mod）。
            </div>
          )}
          {packInfo.warnCfNetworkFiles && (
            <div style={{ marginTop: 4, color: '#f6c90e', fontSize: 11 }}>
              ⚠ 另有 {packInfo.networkModCount} 个 CurseForge 引用文件无法自动下载。
            </div>
          )}
        </div>
      )}

      {/* Server config */}
      {packInfo && (
        <>
          <div className="form-group">
            <label className="form-label">服务器名称</label>
            <input
              className="form-input"
              value={serverName}
              onChange={e => { setServerName(e.target.value); setNameError(''); }}
              onKeyDown={e => e.key === 'Enter' && handleImport()}
              placeholder="my-server"
              autoFocus
              style={{ borderColor: nameError ? 'var(--red)' : undefined }}
            />
            {nameError && <div style={{ marginTop: 4, fontSize: 12, color: 'var(--red)' }}>{nameError}</div>}
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label">最大内存 (MB)</label>
              <input className="form-input" type="number" min="512" max="32768"
                value={maxMemory} onChange={e => setMaxMemory(e.target.value)} />
            </div>
            <div className="form-group" style={{ width: 110 }}>
              <label className="form-label">端口</label>
              <input className="form-input" type="number" min="1" max="65535"
                value={port} onChange={e => setPort(e.target.value)} />
            </div>
          </div>
        </>
      )}

      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button className="btn btn-ghost" onClick={onClose}>取消</button>
        {packInfo && (
          <button className="btn btn-primary" onClick={handleImport}>开始导入</button>
        )}
      </div>
    </div>
  );

  // ── Render: importing ────────────────────────────────────────────────────────
  const renderImporting = () => (
    <div>
      <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 14, color: 'var(--text-primary)',
        display: 'flex', alignItems: 'center', gap: 10 }}>
        <span className="spinner" />正在导入服务端整合包...
      </h2>
      <div style={{
        background: 'rgba(5,8,20,0.72)', borderRadius: 'var(--radius-sm)',
        padding: '10px 12px', height: 280, overflowY: 'auto',
        fontFamily: 'Consolas, monospace', fontSize: 11.5, lineHeight: 1.6,
      }}>
        {log.map((line, i) => (
          <div key={i} style={{ color: logLineColor(line.type), wordBreak: 'break-all' }}>
            {line.text}
          </div>
        ))}
        <div ref={logEndRef} />
      </div>
      <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-secondary)' }}>
        导入过程中请勿关闭窗口。NeoForge/Forge 安装器需要联网下载依赖，可能需要数分钟。
      </div>
    </div>
  );

  // ── Render: done ─────────────────────────────────────────────────────────────
  const renderDone = () => {
    const suspected = result?.suspectedClientMods || [];
    const cfMissing = result?.warnCfNetworkFiles || 0;

    return (
      <div>
        <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 14,
          color: result?.success ? '#4ade80' : 'var(--red)',
          display: 'flex', alignItems: 'center', gap: 8 }}>
          {result?.success ? '✓ 服务端导入完成' : '✗ 导入失败'}
        </h2>

        {result?.success ? (
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 14, lineHeight: 1.7 }}>
            服务端「<strong style={{ color: 'var(--text-primary)' }}>{result.serverId}</strong>」已创建，
            请在服务器列表中找到它，接受 EULA 后即可启动。
          </div>
        ) : (
          <div style={{
            background: 'rgba(245,101,101,0.08)', border: '1px solid rgba(245,101,101,0.25)',
            borderRadius: 'var(--radius-sm)', padding: '10px 12px', marginBottom: 14,
            fontSize: 12, color: 'var(--red)', lineHeight: 1.6,
          }}>
            {result?.error}
          </div>
        )}

        {/* CurseForge network files warning */}
        {cfMissing > 0 && (
          <div style={{
            background: 'rgba(246,201,14,0.07)', border: '1px solid rgba(246,201,14,0.22)',
            borderRadius: 'var(--radius-sm)', padding: '10px 12px', marginBottom: 14,
            fontSize: 12, color: '#f6c90e', lineHeight: 1.6,
          }}>
            ⚠ 该整合包含 {cfMissing} 个 CurseForge 引用文件无法自动下载，如缺少 Mod 请手动补全。
          </div>
        )}

        {/* Suspected client-only mods — informational only, NO delete buttons.
            Many packs run these mods via Sinytra Connector / compatibility layers.
            CMCL never auto-deletes. If the server actually crashes due to a specific
            mod, the crash-log banner in the console tab will guide the user. */}
        {suspected.length > 0 && (
          <details style={{ marginBottom: 14 }}>
            <summary style={{
              fontSize: 12, color: 'var(--text-muted)',
              cursor: 'pointer', userSelect: 'none',
            }}>
              ℹ 检测到 {suspected.length} 个疑似纯客户端 Mod（仅供参考，已全部保留）
            </summary>
            <div style={{
              background: 'rgba(5,8,20,0.55)', borderRadius: 'var(--radius-sm)',
              padding: '8px 10px', maxHeight: 160, overflowY: 'auto',
              fontFamily: 'Consolas, monospace', fontSize: 11, lineHeight: 1.7,
              marginTop: 6,
            }}>
              {suspected.map((m, i) => (
                <div key={i} style={{ color: 'rgba(200,208,224,0.7)', wordBreak: 'break-all' }}>
                  {m.name}
                  <span style={{ color: 'rgba(200,208,224,0.4)', marginLeft: 6 }}>— {m.reason}</span>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>
              很多整合包通过兼容层让这些 Mod 在服务端正常运行，无需删除。
              若启动后崩溃，控制台 Banner 会指出具体问题 Mod，届时再决定是否手动移除。
            </div>
          </details>
        )}

        {/* Log (collapsed) */}
        <details style={{ marginBottom: 14 }}>
          <summary style={{ fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer', userSelect: 'none' }}>
            查看安装日志
          </summary>
          <div style={{
            background: 'rgba(5,8,20,0.72)', borderRadius: 'var(--radius-sm)',
            padding: '8px 10px', maxHeight: 200, overflowY: 'auto',
            fontFamily: 'Consolas, monospace', fontSize: 11, lineHeight: 1.6, marginTop: 6,
          }}>
            {log.map((line, i) => (
              <div key={i} style={{ color: logLineColor(line.type), wordBreak: 'break-all' }}>{line.text}</div>
            ))}
          </div>
        </details>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          {result?.success && result.serverId && (
            <button className="btn btn-ghost" style={{ fontSize: 12 }}
              onClick={() => window.cmcl.serverOpenDir(result.serverId)}>
              打开目录
            </button>
          )}
          <button className="btn btn-primary" onClick={onClose}>关闭</button>
        </div>
      </div>
    );
  };

  return (
    <div style={overlayStyle}>
      <div style={{ ...modalStyle, maxWidth: 520, maxHeight: '90vh', overflowY: 'auto' }}>
        {step === 'preview'   && renderPreview()}
        {step === 'importing' && renderImporting()}
        {step === 'done'      && renderDone()}
      </div>
    </div>
  );
}

// Shared kick/ban modal (mode = 'kick' | 'ban')
function KickBanModal({ mode, playerName, onConfirm, onCancel }) {
  const [reason, setReason] = useState('');
  const inputRef = useRef(null);
  const isBan = mode === 'ban';
  useEffect(() => { inputRef.current?.focus(); }, []);
  return (
    <div style={overlayStyle}>
      <div style={{ ...modalStyle, maxWidth: 420 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 12 }}>
          {isBan ? '封禁玩家' : '踢出玩家'}
        </h2>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 14 }}>
          玩家：<strong>{playerName}</strong>
          {isBan && <><br /><span style={{ fontSize: 12, color: 'var(--red)' }}>
            封禁后玩家将无法再次进入服务器。
          </span></>}
        </p>
        <div className="form-group">
          <label className="form-label">理由（可选）</label>
          <input ref={inputRef} className="form-input"
            value={reason} onChange={e => setReason(e.target.value)}
            placeholder={isBan ? '封禁原因...' : '踢出原因...'}
            onKeyDown={e => { if (e.key === 'Enter') onConfirm(reason); }} />
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" onClick={onCancel}>取消</button>
          <button className={`btn ${isBan ? 'btn-danger' : 'btn-primary'}`}
            onClick={() => onConfirm(reason)}>
            {isBan ? '确认封禁' : '确认踢出'}
          </button>
        </div>
      </div>
    </div>
  );
}

function WhitelistAddModal({ onConfirm, onCancel }) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const inputRef = useRef(null);
  useEffect(() => { inputRef.current?.focus(); }, []);
  const handleConfirm = () => {
    const t = name.trim();
    if (!/^[A-Za-z0-9_]{1,40}$/.test(t)) {
      setError('玩家名只能包含字母、数字和下划线，长度 1–40'); return;
    }
    onConfirm(t);
  };
  return (
    <div style={overlayStyle}>
      <div style={{ ...modalStyle, maxWidth: 380 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 14 }}>
          添加到白名单
        </h2>
        <div className="form-group">
          <label className="form-label">玩家名称</label>
          <input ref={inputRef} className="form-input" value={name}
            onChange={e => { setName(e.target.value); setError(''); }}
            placeholder="Steve"
            onKeyDown={e => { if (e.key === 'Enter') handleConfirm(); }} />
        </div>
        {error && <div style={{ color: 'var(--red)', fontSize: 12, marginBottom: 10 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" onClick={onCancel}>取消</button>
          <button className="btn btn-primary" onClick={handleConfirm}>添加</button>
        </div>
      </div>
    </div>
  );
}

// ── RebuildWorldModal ─────────────────────────────────────────────────────────

function RebuildWorldModal({ serverId, onClose, onConfirm }) {
  const [step, setStep]                             = useState(1);
  const [deleteInput, setDeleteInput]               = useState('');
  const [seed, setSeed]                             = useState('');
  const [levelType, setLevelType]                   = useState('minecraft:normal');
  const [generateStructures, setGenerateStructures] = useState(true);
  const [rebuilding, setRebuilding]                 = useState(false);
  const [error, setError]                           = useState('');
  const inputRef = useRef(null);

  useEffect(() => { if (step === 2) inputRef.current?.focus(); }, [step]);

  const handleRebuild = async () => {
    if (deleteInput !== 'DELETE') return;
    setRebuilding(true); setError('');
    const result = await window.cmcl.serverRebuildWorld(serverId, { seed, levelType, generateStructures });
    setRebuilding(false);
    if (result.success) onConfirm();
    else setError(result.error || '重建失败');
  };

  return (
    <div style={overlayStyle}>
      <div style={{ ...modalStyle, maxWidth: 460 }}>
        {step === 1 ? (
          <>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--red)', marginBottom: 14 }}>
              重建世界
            </h2>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7, marginBottom: 20 }}>
              将永久删除当前世界全部内容，无法恢复。玩家数据、Mod、配置文件不受影响。
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" onClick={onClose}>取消</button>
              <button className="btn btn-danger" onClick={() => setStep(2)}>我了解，继续</button>
            </div>
          </>
        ) : (
          <>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--red)', marginBottom: 14 }}>
              确认重建世界
            </h2>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 10 }}>
              请输入 <code style={{ fontWeight: 700, color: 'var(--red)' }}>DELETE</code> 确认操作：
            </p>
            <div className="form-group">
              <input ref={inputRef} className="form-input" value={deleteInput}
                onChange={e => setDeleteInput(e.target.value)} placeholder="DELETE"
                style={{ borderColor: deleteInput && deleteInput !== 'DELETE' ? 'var(--red)' : undefined }} />
            </div>

            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)',
              textTransform: 'uppercase', letterSpacing: 1, margin: '14px 0 10px' }}>
              新世界设置（可选）
            </div>
            <div className="form-group">
              <label className="form-label">种子（留空随机）</label>
              <input className="form-input" value={seed}
                onChange={e => setSeed(e.target.value)} placeholder="（随机）" />
            </div>
            <div className="form-group">
              <label className="form-label">世界类型</label>
              <select className="form-select" value={levelType} onChange={e => setLevelType(e.target.value)}>
                <option value="minecraft:normal">普通 (normal)</option>
                <option value="minecraft:flat">超平坦 (flat)</option>
                <option value="minecraft:large_biomes">巨型生物群系 (large_biomes)</option>
                <option value="minecraft:amplified">极大化 (amplified)</option>
              </select>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8,
              cursor: 'pointer', marginBottom: 16 }}>
              <input type="checkbox" checked={generateStructures}
                onChange={e => setGenerateStructures(e.target.checked)} />
              <span className="form-label" style={{ marginBottom: 0 }}>生成地物（村庄、神殿等）</span>
            </label>

            {error && (
              <div style={{ padding: '8px 12px', background: 'rgba(245,101,101,0.12)',
                border: '1px solid rgba(245,101,101,0.30)', borderRadius: 'var(--radius-sm)',
                color: 'var(--red)', fontSize: 12, marginBottom: 14 }}>{error}</div>
            )}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" onClick={onClose} disabled={rebuilding}>取消</button>
              <button className="btn btn-danger"
                disabled={deleteInput !== 'DELETE' || rebuilding}
                onClick={handleRebuild}>
                {rebuilding ? <><span className="spinner" /> 重建中...</> : '确认重建'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── ServerSettingsTab ─────────────────────────────────────────────────────────

function ServerSettingsTab({ serverId, isRunning }) {
  const [props, setProps]                   = useState(null);
  const [worldExistsVal, setWorldExistsVal] = useState(null);
  const [loading, setLoading]               = useState(true);
  const [saving, setSaving]                 = useState(false);
  const [saveMsg, setSaveMsg]               = useState('');
  const [showRebuild, setShowRebuild]       = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    const [propsResult, weResult] = await Promise.all([
      window.cmcl.serverGetProps(serverId),
      window.cmcl.serverWorldExists(serverId),
    ]);
    setProps(propsResult.parsed || {});
    setWorldExistsVal(weResult.exists);
    setLoading(false);
  }, [serverId]);

  // Silent full reload: re-reads props AND worldExists from disk without the
  // loading spinner. Used after rebuild — server.properties has new world settings
  // and the form should reflect them immediately without a "加载中" flash.
  const reloadSilent = useCallback(async () => {
    const [propsResult, weResult] = await Promise.all([
      window.cmcl.serverGetProps(serverId),
      window.cmcl.serverWorldExists(serverId),
    ]);
    setProps(propsResult.parsed || {});
    setWorldExistsVal(weResult.exists);
  }, [serverId]);

  // Lightweight refresh: only re-reads worldExists, leaves props untouched.
  // Avoids overwriting unsaved form edits while keeping world-presence in sync.
  const refreshWorldExists = useCallback(async () => {
    const weResult = await window.cmcl.serverWorldExists(serverId);
    setWorldExistsVal(weResult.exists);
  }, [serverId]);

  // Trigger 3 (tab visibility): handled implicitly — the {activeTab === 'settings' && ...}
  // conditional unmounts this component when leaving the tab and remounts on return,
  // so the effect below fires loadAll() fresh each time the tab is opened.
  useEffect(() => { loadAll(); }, [loadAll]);

  // Trigger 2: re-check world existence each time the server starts or stops.
  // Starting the server generates the world directory, which must flip the
  // editable/readonly state of the world fields and the rebuild button without
  // requiring the user to switch tabs. The mount-time call here is harmless —
  // loadAll() runs concurrently and will set the same value.
  useEffect(() => {
    refreshWorldExists();
  }, [isRunning, refreshWorldExists]);

  const set = (key, val) => setProps(p => ({ ...p, [key]: val }));

  const handleSave = async () => {
    setSaving(true); setSaveMsg('');
    const result = await window.cmcl.serverSaveProps(serverId, props);
    setSaving(false);
    if (result.success) {
      setSaveMsg('已保存，部分设置需重启生效');
      setTimeout(() => setSaveMsg(''), 3000);
    } else {
      setSaveMsg(result.error || '保存失败');
    }
  };

  // Trigger 1: after rebuild the world is gone and props changed on disk.
  // reloadSilent refreshes both without the loading flash that loadAll shows.
  const handleRebuildDone = async () => {
    setShowRebuild(false);
    await reloadSilent();
  };

  if (loading) return (
    <div style={{ color: 'var(--text-muted)', fontSize: 12, padding: '20px 0' }}>加载中...</div>
  );
  if (!props) return null;

  const wExists = worldExistsVal === true;

  const sectionLabel = (text) => (
    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)',
      textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>{text}</div>
  );

  const chk = (key, label, isTrue = v => v !== 'false', hint = null) => (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
      <input type="checkbox" checked={isTrue(props[key] ?? 'true')}
        onChange={e => set(key, e.target.checked ? 'true' : 'false')} />
      <span className="form-label" style={{ marginBottom: 0 }}>
        {label}
        {hint && <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 4 }}>{hint}</span>}
      </span>
    </label>
  );

  return (
    <div>
      {/* ── World section ── */}
      {sectionLabel('世界')}
      {wExists && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10,
          background: 'rgba(0,0,0,0.04)', padding: '7px 10px', borderRadius: 'var(--radius-sm)' }}>
          世界已生成，种子/类型不可更改
        </div>
      )}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div className="form-group" style={{ flex: 2, minWidth: 160 }}>
          <label className="form-label">世界种子</label>
          <input className="form-input" value={props['level-seed'] || ''}
            onChange={e => set('level-seed', e.target.value)}
            disabled={wExists} placeholder="（随机）" />
        </div>
        <div className="form-group" style={{ flex: 1, minWidth: 140 }}>
          <label className="form-label">世界类型</label>
          <select className="form-select"
            value={props['level-type'] || 'minecraft:normal'}
            onChange={e => set('level-type', e.target.value)}
            disabled={wExists}>
            <option value="minecraft:normal">普通 (normal)</option>
            <option value="minecraft:flat">超平坦 (flat)</option>
            <option value="minecraft:large_biomes">巨型生物群系 (large_biomes)</option>
            <option value="minecraft:amplified">极大化 (amplified)</option>
          </select>
        </div>
      </div>
      <div style={{ marginBottom: 10 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8,
          cursor: wExists ? 'default' : 'pointer' }}>
          <input type="checkbox"
            checked={props['generate-structures'] !== 'false'}
            onChange={e => set('generate-structures', e.target.checked ? 'true' : 'false')}
            disabled={wExists} />
          <span className="form-label" style={{ marginBottom: 0 }}>生成地物（村庄、神殿等）</span>
        </label>
      </div>
      {wExists && (
        <button className="btn btn-danger" style={{ fontSize: 12, marginBottom: 4 }}
          disabled={isRunning}
          title={isRunning ? '请先停止服务器' : '删除当前世界并重新生成'}
          onClick={() => setShowRebuild(true)}>
          重建世界…
        </button>
      )}

      <div className="divider" style={{ margin: '16px 0' }} />

      {/* ── Common settings ── */}
      {sectionLabel('常用')}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div className="form-group" style={{ flex: 1, minWidth: 140 }}>
          <label className="form-label">游戏模式</label>
          <select className="form-select" value={props['gamemode'] || 'survival'}
            onChange={e => set('gamemode', e.target.value)}>
            <option value="survival">生存</option>
            <option value="creative">创造</option>
            <option value="adventure">冒险</option>
            <option value="spectator">旁观</option>
          </select>
        </div>
        <div className="form-group" style={{ flex: 1, minWidth: 140 }}>
          <label className="form-label">难度</label>
          <select className="form-select" value={props['difficulty'] || 'easy'}
            onChange={e => set('difficulty', e.target.value)}>
            <option value="peaceful">和平</option>
            <option value="easy">简单</option>
            <option value="normal">普通</option>
            <option value="hard">困难</option>
          </select>
        </div>
        <div className="form-group" style={{ width: 90 }}>
          <label className="form-label">最大玩家数</label>
          <input className="form-input" type="number" min="1" max="1000"
            value={props['max-players'] || '20'}
            onChange={e => set('max-players', e.target.value)} />
        </div>
      </div>
      <div className="form-group">
        <label className="form-label">MOTD（服务器描述）</label>
        <input className="form-input" value={props['motd'] || ''}
          onChange={e => set('motd', e.target.value)} />
      </div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', rowGap: 10 }}>
        {chk('online-mode', '正版验证 (online-mode)')}
        {chk('pvp', 'PvP')}
        {chk('white-list', '白名单', v => v === 'true')}
        {chk('allow-flight', '允许飞行', v => v === 'true', '（mod服建议开启）')}
      </div>

      <div className="divider" style={{ margin: '16px 0' }} />

      {/* ── Advanced settings (collapsible) ── */}
      <details>
        <summary style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)',
          textTransform: 'uppercase', letterSpacing: 1, cursor: 'pointer',
          userSelect: 'none', padding: '2px 0' }}>
          高级设置
        </summary>
        <div style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div className="form-group" style={{ width: 100 }}>
              <label className="form-label">服务器端口</label>
              <input className="form-input" type="number" min="1" max="65535"
                value={props['server-port'] || '25565'}
                onChange={e => set('server-port', e.target.value)} />
            </div>
            <div className="form-group" style={{ width: 80 }}>
              <label className="form-label">视距</label>
              <input className="form-input" type="number" min="2" max="32"
                value={props['view-distance'] || '10'}
                onChange={e => set('view-distance', e.target.value)} />
            </div>
            <div className="form-group" style={{ width: 90 }}>
              <label className="form-label">模拟距离</label>
              <input className="form-input" type="number" min="2" max="32"
                value={props['simulation-distance'] || '10'}
                onChange={e => set('simulation-distance', e.target.value)} />
            </div>
            <div className="form-group" style={{ width: 130 }}>
              <label className="form-label">最大Tick时间(ms)</label>
              <input className="form-input" type="number" min="-1"
                value={props['max-tick-time'] || '60000'}
                onChange={e => set('max-tick-time', e.target.value)} />
            </div>
            <div className="form-group" style={{ width: 110 }}>
              <label className="form-label">出生点保护</label>
              <input className="form-input" type="number" min="0"
                value={props['spawn-protection'] || '16'}
                onChange={e => set('spawn-protection', e.target.value)} />
            </div>
            <div className="form-group" style={{ width: 120 }}>
              <label className="form-label">挂机超时(分钟)</label>
              <input className="form-input" type="number" min="0"
                value={props['player-idle-timeout'] || '0'}
                onChange={e => set('player-idle-timeout', e.target.value)} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', rowGap: 10, marginTop: 4 }}>
            {chk('spawn-npcs', '生成村民')}
            {chk('spawn-animals', '生成动物')}
            {chk('spawn-monsters', '生成怪物')}
            {chk('enforce-secure-profile', '强制安全配置文件')}
            {chk('enable-command-block', '启用命令方块', v => v === 'true')}
          </div>
        </div>
      </details>

      <div style={{ marginTop: 20, display: 'flex', alignItems: 'center', gap: 12 }}>
        <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? <><span className="spinner" /> 保存中...</> : '保存'}
        </button>
        {saveMsg && (
          <span style={{ fontSize: 12, color: saveMsg.includes('失败') ? 'var(--red)' : '#16a34a' }}>
            {saveMsg}
          </span>
        )}
      </div>

      {showRebuild && (
        <RebuildWorldModal serverId={serverId}
          onClose={() => setShowRebuild(false)}
          onConfirm={handleRebuildDone} />
      )}
    </div>
  );
}

// ── ··· overflow menu for each online player row ──────────────────────────────

function OverflowMenu({ anchorRect, isOp, isRunning, onBan, onDeop, onClose }) {
  const menuRef = useRef(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [measured, setMeasured] = useState(false);

  useLayoutEffect(() => {
    if (!menuRef.current || !anchorRect) return;
    const menu = menuRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Right-align with button; flip left if off-screen
    let left = anchorRect.right - menu.width;
    if (left < 4) left = anchorRect.left;
    if (left + menu.width > vw - 4) left = vw - menu.width - 4;

    // Open below button; flip upward if near bottom
    let top = anchorRect.bottom + 4;
    if (top + menu.height > vh - 4) top = anchorRect.top - menu.height - 4;

    setPos({ top, left });
    setMeasured(true);
  }, [anchorRect]);

  const itemStyle = (danger) => ({
    display: 'block', width: '100%', textAlign: 'left',
    padding: '7px 14px', fontSize: 13,
    background: 'transparent', border: 'none',
    cursor: isRunning ? 'pointer' : 'not-allowed',
    color: !isRunning ? 'var(--text-muted)' : danger ? 'var(--red)' : 'var(--text-primary)',
    opacity: isRunning ? 1 : 0.5,
  });

  return createPortal(
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 9998 }} onClick={onClose} />
      <div ref={menuRef} style={{
        position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999,
        visibility: measured ? 'visible' : 'hidden',
        background: 'rgba(255,255,255,0.96)',
        backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
        border: '1px solid rgba(0,0,0,0.10)',
        borderRadius: 'var(--radius-sm)',
        boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
        minWidth: 100, padding: '4px 0',
      }}>
        <button disabled={!isRunning} onClick={onBan} style={itemStyle(true)}>封禁</button>
        {isOp && <button disabled={!isRunning} onClick={onDeop} style={itemStyle(false)}>撤销OP</button>}
      </div>
    </>,
    document.body
  );
}

// ── Online player row ─────────────────────────────────────────────────────────

function PlayerRow({ name, isOp, isRunning, openMenu, setOpenMenu, onOp, onDeop, onKick, onBan }) {
  const menuOpen = openMenu === name;
  const [anchorRect, setAnchorRect] = useState(null);
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '6px 0', borderBottom: '1px solid rgba(0,0,0,0.05)',
    }}>
      {/* Online indicator */}
      <span style={{
        width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
        background: '#22c55e', boxShadow: '0 0 5px rgba(34,197,94,0.55)',
      }} />

      {/* Name + OP badge */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {name}
        </span>
        {isOp && (
          <span style={{ fontSize: 10, padding: '1px 5px', flexShrink: 0,
            background: 'rgba(202,138,4,0.14)', color: '#92400e',
            borderRadius: 4, fontWeight: 600 }}>OP</span>
        )}
      </div>

      {/* OP toggle */}
      <button className="btn btn-ghost"
        style={{ fontSize: 11, padding: '3px 8px', flexShrink: 0 }}
        disabled={!isRunning}
        title={isRunning ? (isOp ? '撤销管理员权限' : '授予管理员权限') : '服务器未运行'}
        onClick={isOp ? onDeop : onOp}>
        {isOp ? '撤OP' : '设OP'}
      </button>

      {/* Kick */}
      <button className="btn btn-ghost"
        style={{ fontSize: 11, padding: '3px 8px', flexShrink: 0 }}
        disabled={!isRunning}
        title={isRunning ? '踢出玩家' : '服务器未运行'}
        onClick={onKick}>
        踢出
      </button>

      {/* ··· overflow */}
      <div style={{ flexShrink: 0 }}>
        <button className="btn btn-ghost"
          style={{ fontSize: 14, padding: '2px 8px', letterSpacing: 2, lineHeight: 1 }}
          onClick={e => {
            e.stopPropagation();
            if (menuOpen) {
              setOpenMenu(null);
            } else {
              setAnchorRect(e.currentTarget.getBoundingClientRect());
              setOpenMenu(name);
            }
          }}>
          ···
        </button>
        {menuOpen && anchorRect && (
          <OverflowMenu anchorRect={anchorRect} isOp={isOp} isRunning={isRunning}
            onBan={() => { setOpenMenu(null); onBan(); }}
            onDeop={() => { setOpenMenu(null); onDeop(); }}
            onClose={() => setOpenMenu(null)} />
        )}
      </div>
    </div>
  );
}

// ── Status bar (above console) ────────────────────────────────────────────────

function StatusBar({ isRunning, consoleLogs, serverMods, onRefreshMods }) {
  const [modsOpen, setModsOpen] = useState(false);

  // Find last player list response in console logs
  const lastPlayers = useMemo(() => {
    for (let i = consoleLogs.length - 1; i >= 0; i--) {
      const r = parseListResponse(consoleLogs[i].message);
      if (r !== null) return r;
    }
    return null;
  }, [consoleLogs]);

  const pill = { display: 'flex', alignItems: 'center', gap: 4 };
  const label = { fontSize: 11, color: 'var(--text-muted)' };
  const value = { fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' };
  const sep   = { color: 'rgba(0,0,0,0.12)', fontSize: 13, userSelect: 'none' };

  const handleModsToggle = () => {
    if (!modsOpen) onRefreshMods();
    setModsOpen(v => !v);
  };

  return (
    <div style={{ flexShrink: 0, marginBottom: 8 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        padding: '5px 10px',
        background: 'rgba(0,0,0,0.04)',
        borderRadius: modsOpen && serverMods.length > 0
          ? 'var(--radius-sm) var(--radius-sm) 0 0' : 'var(--radius-sm)',
        fontSize: 12,
      }}>
        {/* Status */}
        <div style={pill}>
          <span style={{
            width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
            background: isRunning ? '#22c55e' : 'rgba(0,0,0,0.22)',
            boxShadow: isRunning ? '0 0 4px rgba(34,197,94,0.55)' : 'none',
          }} />
          <span style={{ ...value, color: isRunning ? '#15803d' : 'var(--text-muted)' }}>
            {isRunning ? '运行中' : '已停止'}
          </span>
        </div>

        <span style={sep}>|</span>

        {/* Players */}
        <div style={pill}>
          <span style={label}>在线</span>
          <span style={value}>
            {isRunning && lastPlayers !== null ? lastPlayers.length : '—'}
          </span>
        </div>

        <span style={sep}>|</span>

        {/* Mods toggle */}
        <button
          onClick={handleModsToggle}
          style={{
            ...pill, background: 'none', border: 'none', cursor: 'pointer',
            padding: 0, fontFamily: 'inherit',
          }}>
          <span style={label}>Mod</span>
          <span style={value}>{serverMods.length}</span>
          <span style={{ fontSize: 8, color: 'var(--text-muted)', marginLeft: 1 }}>
            {modsOpen ? '▲' : '▼'}
          </span>
        </button>
      </div>

      {/* Expanded mod list */}
      {modsOpen && (
        <div style={{
          padding: '6px 10px', maxHeight: 110, overflowY: 'auto',
          background: 'rgba(0,0,0,0.04)',
          borderTop: '1px solid rgba(0,0,0,0.06)',
          borderRadius: '0 0 var(--radius-sm) var(--radius-sm)',
        }}>
          {serverMods.length === 0
            ? <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>mods/ 目录为空</span>
            : serverMods.map(m => (
              <div key={m} style={{
                fontSize: 11, color: 'var(--text-secondary)', padding: '1px 0',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>{m}</div>
            ))
          }
        </div>
      )}
    </div>
  );
}

// ── Players Tab ───────────────────────────────────────────────────────────────

function PlayersTab({ serverId, isRunning, consoleLogs, sendCmd }) {
  const [onlinePlayers, setOnlinePlayers] = useState(null); // null=loading, []=ready
  const [parseError, setParseError]       = useState(false);
  const [playerData, setPlayerData] = useState({ ops: [], bannedPlayers: [], bannedIPs: [], whitelist: [] });
  const [subTab, setSubTab]   = useState('banned');
  const [openMenu, setOpenMenu] = useState(null); // name with open ··· menu
  const [kickModal, setKickModal] = useState(null);
  const [banModal, setBanModal]   = useState(null);
  const [wlAddModal, setWlAddModal] = useState(false);

  const listSentAtIdx = useRef(-1);
  const timeoutRef    = useRef(null);
  const isMountedRef  = useRef(true);
  const consoleLogsRef = useRef(consoleLogs);

  useEffect(() => { consoleLogsRef.current = consoleLogs; }, [consoleLogs]);
  useEffect(() => { return () => { isMountedRef.current = false; clearTimeout(timeoutRef.current); }; }, []);

  // ── Data loading ──────────────────────────────────────────────────────────
  const refreshPlayerData = useCallback(async () => {
    const data = await window.cmcl.serverReadPlayerData(serverId);
    if (!isMountedRef.current) return;
    setPlayerData(data || { ops: [], bannedPlayers: [], bannedIPs: [], whitelist: [] });
  }, [serverId]);

  const refreshOnline = useCallback(async () => {
    if (!isRunning) { setOnlinePlayers([]); setParseError(false); return; }
    setOnlinePlayers(null); setParseError(false);
    listSentAtIdx.current = consoleLogsRef.current.length;
    await sendCmd('list');
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      if (!isMountedRef.current || listSentAtIdx.current < 0) return;
      listSentAtIdx.current = -1;
      setOnlinePlayers([]); setParseError(true);
    }, 4000);
  }, [isRunning, sendCmd]);

  // Watch for list response in incoming console lines
  useEffect(() => {
    if (listSentAtIdx.current < 0) return;
    const newLines = consoleLogs.slice(listSentAtIdx.current);
    for (const line of newLines) {
      const result = parseListResponse(line.message);
      if (result !== null) {
        clearTimeout(timeoutRef.current);
        listSentAtIdx.current = -1;
        setOnlinePlayers(result); setParseError(false);
        return;
      }
    }
  }, [consoleLogs]);

  // On mount or server switch: load data
  useEffect(() => {
    isMountedRef.current = true;
    refreshPlayerData();
    if (isRunning) refreshOnline(); else setOnlinePlayers([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId]);

  // React to server start/stop
  useEffect(() => {
    if (!isRunning) {
      setOnlinePlayers([]); setParseError(false);
      clearTimeout(timeoutRef.current); listSentAtIdx.current = -1;
    }
  }, [isRunning]);

  // ── After-command refresh ─────────────────────────────────────────────────
  const afterCommand = useCallback(async () => {
    await new Promise(r => setTimeout(r, 800));
    if (!isMountedRef.current) return;
    await refreshPlayerData();
    await refreshOnline();
  }, [refreshPlayerData, refreshOnline]);

  // ── Actions ───────────────────────────────────────────────────────────────
  const isOp = name => playerData.ops.some(op => op.name?.toLowerCase() === name.toLowerCase());

  const safe = reason => (reason || '').replace(/[\n\r]/g, ' ').trim();

  const doOp    = name => { sendCmd(`op ${name}`);    afterCommand(); };
  const doDeop  = name => { sendCmd(`deop ${name}`);  afterCommand(); };
  const doPardon = name => { sendCmd(`pardon ${name}`); afterCommand(); };
  const doWlRemove = name => { sendCmd(`whitelist remove ${name}`); afterCommand(); };
  const doWlAdd = name => { sendCmd(`whitelist add ${name}`); sendCmd('whitelist reload'); afterCommand(); };
  const doKick  = (name, reason) => { sendCmd(safe(reason) ? `kick ${name} ${safe(reason)}` : `kick ${name}`); afterCommand(); };
  const doBan   = (name, reason) => { sendCmd(safe(reason) ? `ban ${name} ${safe(reason)}` : `ban ${name}`);  afterCommand(); };

  // ── Render helpers ────────────────────────────────────────────────────────
  const rowStyle = {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '7px 0', borderBottom: '1px solid rgba(0,0,0,0.05)',
  };

  const notRunningTitle = '服务器未运行时命令不生效，查看数据不受影响';

  const subTabBtn = (id, label) => (
    <button key={id} onClick={() => setSubTab(id)} style={{
      padding: '4px 12px', fontSize: 12, borderRadius: 'var(--radius-sm)',
      border: '1px solid', cursor: 'pointer', transition: 'all 0.12s',
      borderColor: subTab === id ? 'rgba(45,127,244,0.40)' : 'rgba(0,0,0,0.10)',
      background: subTab === id ? 'rgba(45,127,244,0.10)' : 'transparent',
      color: subTab === id ? 'var(--accent)' : 'var(--text-secondary)',
      fontWeight: subTab === id ? 600 : 400,
    }}>{label}</button>
  );

  const emptyRow = text => (
    <div style={{ color: 'var(--text-muted)', fontSize: 12, padding: '8px 0' }}>{text}</div>
  );

  // ── JSX ───────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>

      {/* ── Online players (primary zone) ── */}
      <div style={{ flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)',
            textTransform: 'uppercase', letterSpacing: 1 }}>
            在线玩家{onlinePlayers != null && !parseError ? ` (${onlinePlayers.length})` : ''}
          </span>
          <button className="btn btn-ghost" style={{ fontSize: 11, padding: '2px 8px' }}
            onClick={refreshOnline} disabled={!isRunning}
            title={!isRunning ? '服务器未运行' : '发送 list 命令刷新'}>
            刷新
          </button>
        </div>

        <div style={{ maxHeight: 200, overflowY: 'auto' }}>
          {onlinePlayers === null && isRunning && (
            <div style={{ padding: '8px 0', color: 'var(--text-muted)', fontSize: 12,
              display: 'flex', alignItems: 'center', gap: 7 }}>
              <span className="spinner" style={{ width: 12, height: 12, borderWidth: '1.5px' }} />
              获取中...
            </div>
          )}
          {parseError && (
            <div style={{ padding: '8px 0', color: 'var(--text-muted)', fontSize: 12 }}>
              无法获取在线列表，请点刷新重试
            </div>
          )}
          {onlinePlayers !== null && !parseError && onlinePlayers.length === 0
            && emptyRow(isRunning ? '暂无玩家在线' : '服务器未运行')}
          {(onlinePlayers || []).map(name => (
            <PlayerRow key={name} name={name} isOp={isOp(name)} isRunning={isRunning}
              openMenu={openMenu} setOpenMenu={setOpenMenu}
              onOp={() => doOp(name)} onDeop={() => doDeop(name)}
              onKick={() => setKickModal(name)} onBan={() => setBanModal(name)} />
          ))}
        </div>
      </div>

      <div className="divider" style={{ margin: '12px 0 10px' }} />

      {/* ── Secondary zone: sub-tabs ── */}
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', gap: 4, marginBottom: 10, flexShrink: 0 }}>
          {subTabBtn('banned', '封禁列表')}
          {subTabBtn('ops', '管理员')}
          {subTabBtn('whitelist', '白名单')}
        </div>

        <div style={{ maxHeight: 200, overflowY: 'auto' }}>

          {/* Banned players — read from JSON, visible even when server is offline */}
          {subTab === 'banned' && (
            <div>
              {playerData.bannedPlayers.length === 0
                ? emptyRow('暂无封禁记录')
                : playerData.bannedPlayers.map(bp => (
                  <div key={bp.uuid || bp.name} style={rowStyle}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                        {bp.name}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>
                        {bp.reason || '无理由'} · {bp.source || '未知'} · {bp.created ? new Date(bp.created).toLocaleDateString('zh-CN') : '—'}
                      </div>
                    </div>
                    <button className="btn btn-ghost"
                      style={{ fontSize: 11, padding: '3px 8px', flexShrink: 0 }}
                      disabled={!isRunning}
                      title={!isRunning ? notRunningTitle : '解除封禁（pardon）'}
                      onClick={() => doPardon(bp.name)}>
                      解封
                    </button>
                  </div>
                ))}
            </div>
          )}

          {/* OPs — read from JSON, visible even when server is offline */}
          {subTab === 'ops' && (
            <div>
              {playerData.ops.length === 0
                ? emptyRow('暂无管理员')
                : playerData.ops.map(op => (
                  <div key={op.uuid || op.name} style={rowStyle}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                        {op.name}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>
                        权限等级 {op.level}
                      </div>
                    </div>
                    <button className="btn btn-ghost"
                      style={{ fontSize: 11, padding: '3px 8px', flexShrink: 0 }}
                      disabled={!isRunning}
                      title={!isRunning ? notRunningTitle : 'deop'}
                      onClick={() => doDeop(op.name)}>
                      撤销OP
                    </button>
                  </div>
                ))}
            </div>
          )}

          {/* Whitelist — read from JSON, visible even when server is offline; add requires running */}
          {subTab === 'whitelist' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
                <button className="btn btn-primary"
                  style={{ fontSize: 11, padding: '3px 10px' }}
                  disabled={!isRunning}
                  title={!isRunning ? notRunningTitle : 'whitelist add'}
                  onClick={() => setWlAddModal(true)}>
                  + 添加
                </button>
              </div>
              {playerData.whitelist.length === 0
                ? emptyRow('白名单为空')
                : playerData.whitelist.map(w => (
                  <div key={w.uuid || w.name} style={rowStyle}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', flex: 1 }}>
                      {w.name}
                    </div>
                    <button className="btn btn-ghost"
                      style={{ fontSize: 11, padding: '3px 8px', flexShrink: 0 }}
                      disabled={!isRunning}
                      title={!isRunning ? notRunningTitle : 'whitelist remove'}
                      onClick={() => doWlRemove(w.name)}>
                      移除
                    </button>
                  </div>
                ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Action modals (in-app, no system dialogs) ── */}
      {kickModal && (
        <KickBanModal mode="kick" playerName={kickModal}
          onConfirm={reason => { doKick(kickModal, reason); setKickModal(null); }}
          onCancel={() => setKickModal(null)} />
      )}
      {banModal && (
        <KickBanModal mode="ban" playerName={banModal}
          onConfirm={reason => { doBan(banModal, reason); setBanModal(null); }}
          onCancel={() => setBanModal(null)} />
      )}
      {wlAddModal && (
        <WhitelistAddModal
          onConfirm={name => { doWlAdd(name); setWlAddModal(false); }}
          onCancel={() => setWlAddModal(false)} />
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ServerPage() {
  const [servers, setServers]         = useState([]);
  const [selectedId, setSelectedId]   = useState(null);
  const [running, setRunning]         = useState({});
  const [logs, setLogs]               = useState({});
  const [activeTab, setActiveTab]     = useState('console'); // 'console' | 'players'
  const [showCreate, setShowCreate]       = useState(false);
  const [showImportPack, setShowImportPack] = useState(false);
  const [showEula, setShowEula]       = useState(false);
  const [pendingStartId, setPendingStartId] = useState(null);
  const [deleteTarget, setDeleteTarget]     = useState(null);
  const [cmdInput, setCmdInput]       = useState('');
  const [settings, setSettings]       = useState(null);
  const [serverMods, setServerMods]   = useState([]);
  const consoleRef = useRef(null);

  // Reset tab and reload mods when switching servers
  useEffect(() => {
    setActiveTab('console');
    setServerMods([]);
    setJavaForgeBannerDismissed(false);
    if (selectedId) {
      window.cmcl.serverListMods(selectedId).then(list => setServerMods(list || []));
    }
  }, [selectedId]);

  const refreshServers = useCallback(async () => {
    const list = await window.cmcl.serverList();
    setServers(list || []);
    const statusMap = {};
    await Promise.all((list || []).map(async s => {
      const st = await window.cmcl.serverStatus(s.id);
      statusMap[s.id] = st.running;
    }));
    setRunning(prev => ({ ...prev, ...statusMap }));
  }, []);

  useEffect(() => {
    refreshServers();
    window.cmcl.getSettings().then(s => setSettings(s));
  }, [refreshServers]);

  useEffect(() => {
    const offOut = window.cmcl.onServerOutput(({ serverId, type, message }) => {
      setLogs(prev => ({
        ...prev,
        [serverId]: [...(prev[serverId] || []).slice(-800), { type, message }],
      }));
    });
    const offSt = window.cmcl.onServerStatus(({ serverId, running: r }) => {
      setRunning(prev => ({ ...prev, [serverId]: r }));
    });
    return () => { offOut(); offSt(); };
  }, []);

  useEffect(() => {
    if (consoleRef.current) {
      consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
    }
  }, [logs, selectedId]);

  function appendLog(serverId, type, message) {
    setLogs(prev => ({
      ...prev,
      [serverId]: [...(prev[serverId] || []).slice(-800), { type, message }],
    }));
  }

  // Send command from console input (affects cmdInput UI)
  const handleSendCmd = async () => {
    const cmd = cmdInput.trim();
    if (!cmd || !selectedId) return;
    appendLog(selectedId, 'info', `> ${cmd}`);
    await window.cmcl.serverSendCmd(selectedId, cmd);
    setCmdInput('');
  };

  // Send command silently from Players tab (still logs to console)
  const sendServerCmd = useCallback(async (cmd) => {
    if (!selectedId) return;
    appendLog(selectedId, 'info', `> ${cmd}`);
    await window.cmcl.serverSendCmd(selectedId, cmd);
  }, [selectedId]);

  const handleStart = async (serverId) => {
    const result = await window.cmcl.serverStart(serverId);
    if (result.requiresEula) { setPendingStartId(serverId); setShowEula(true); }
    else if (!result.success) appendLog(serverId, 'error', result.error || '启动失败');
  };

  const handleEulaConfirmed = async () => {
    setShowEula(false);
    if (pendingStartId) { await handleStart(pendingStartId); setPendingStartId(null); }
  };

  const handleStop = id => window.cmcl.serverStop(id);
  const handleKill = id => window.cmcl.serverKill(id);

  const handleDeleteConfirmed = async () => {
    const id = deleteTarget; setDeleteTarget(null);
    const result = await window.cmcl.serverDelete(id);
    if (result.success) { setSelectedId(prev => prev === id ? null : prev); refreshServers(); }
    else appendLog(id, 'error', result.error);
  };

  const selectedServer = servers.find(s => s.id === selectedId);
  const isRunning      = selectedId ? (running[selectedId] ?? false) : false;
  const consoleLogs    = selectedId ? (logs[selectedId] || []) : [];

  // Derive crash client-mod errors from console output (memoised, only last 400 lines scanned)
  const crashModErrors = React.useMemo(
    () => parseCrashClientModErrors(consoleLogs),
    [consoleLogs],
  );

  // Detect Java 8u321+ / old Forge incompatibility crash
  const javaForgeCrash = React.useMemo(
    () => detectJavaForgeIncompatCrash(consoleLogs),
    [consoleLogs],
  );
  const [javaForgeBannerDismissed, setJavaForgeBannerDismissed] = useState(false);

  // Crash-mod removal: two-step confirm to prevent accidental deletes.
  // Step 1: user clicks "移除" → confirmingCrashMod shows the confirm row.
  // Step 2: user clicks "确认" → IPC scans JAR metadata for exact modId match, deletes.
  const [removedCrashMods,  setRemovedCrashMods]  = useState({}); // { 'servId:modId': removed_filename }
  const [confirmingCrashMod, setConfirmingCrashMod] = useState(null); // modId string
  const [removingCrashMod,   setRemovingCrashMod]   = useState(null); // modId string (spinner)

  const handleRemoveCrashMod = async (modId) => {
    setConfirmingCrashMod(null);
    setRemovingCrashMod(modId);
    const res = await window.cmcl.serverRemoveModById(selectedId, modId);
    setRemovingCrashMod(null);
    if (res.success) {
      setRemovedCrashMods(prev => ({ ...prev, [`${selectedId}:${modId}`]: res.removed || true }));
      if (selectedId) window.cmcl.serverListMods(selectedId).then(list => setServerMods(list || []));
    } else if (res.notFound) {
      // File not found by metadata scan — mark as "removed" so banner clears,
      // and inform user they may need to delete manually
      setRemovedCrashMods(prev => ({ ...prev, [`${selectedId}:${modId}`]: '(手动删除)' }));
    }
    // If a different error, the button returns to normal state so user can retry
  };

  // Tab button style helper
  const tabBtn = (id, label) => (
    <button key={id} onClick={() => setActiveTab(id)} style={{
      padding: '8px 16px', fontSize: 13, background: 'transparent', border: 'none',
      borderBottom: `2px solid ${activeTab === id ? 'var(--accent)' : 'transparent'}`,
      color: activeTab === id ? 'var(--accent)' : 'var(--text-secondary)',
      fontWeight: activeTab === id ? 600 : 400,
      cursor: 'pointer', transition: 'color 0.12s', marginBottom: -1,
    }}>{label}</button>
  );

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden', background: 'transparent' }}>

      {/* ── Instance list (left) ───────────────────────────────────────────── */}
      <div style={{
        width: 220, flexShrink: 0, display: 'flex', flexDirection: 'column',
        borderRight: '1px solid rgba(0,0,0,0.08)',
        background: 'rgba(255,255,255,0.32)',
        backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
      }}>
        <div style={{ padding: '16px 14px 10px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>服务器</span>
          <div style={{ display: 'flex', gap: 5 }}>
            <button className="btn btn-ghost" style={{ fontSize: 11, padding: '3px 8px' }}
              onClick={() => setShowImportPack(true)}>导入</button>
            <button className="btn btn-primary" style={{ fontSize: 11, padding: '3px 10px' }}
              onClick={() => setShowCreate(true)}>+ 新建</button>
          </div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 8px 8px' }}>
          {servers.length === 0 && (
            <div style={{ padding: '24px 8px', textAlign: 'center',
              color: 'var(--text-muted)', fontSize: 12 }}>
              暂无服务器<br />点击「+ 新建」创建
            </div>
          )}
          {servers.map(s => (
            <button key={s.id} onClick={() => setSelectedId(s.id)} style={{
              width: '100%', textAlign: 'left', padding: '9px 10px',
              borderRadius: 'var(--radius-sm)', border: 'none', cursor: 'pointer',
              background: selectedId === s.id ? 'var(--bg-active)' : 'transparent',
              marginBottom: 2, transition: 'background 0.12s',
            }}
              onMouseEnter={e => { if (selectedId !== s.id) e.currentTarget.style.background = 'var(--bg-hover)'; }}
              onMouseLeave={e => { if (selectedId !== s.id) e.currentTarget.style.background = 'transparent'; }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <span style={{
                  width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                  background: running[s.id] ? '#22c55e' : 'rgba(0,0,0,0.20)',
                  boxShadow: running[s.id] ? '0 0 6px #22c55e' : 'none',
                }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.name}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>
                    {s.mcVersion} · :{s.port || 25565}
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* ── Detail panel (right) ───────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: 20 }}>
        {!selectedServer ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>⬡</div>
            <div style={{ fontSize: 14, marginBottom: 6 }}>选择一个服务器实例</div>
            <div style={{ fontSize: 12 }}>或点击左侧「+ 新建」创建</div>
          </div>
        ) : (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12, overflow: 'hidden' }}>

            {/* Header card */}
            <div className="card" style={{ flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>
                    {selectedServer.name}
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                    <span className="tag tag-release" style={{ fontSize: 12 }}>
                      {selectedServer.mcVersion}
                    </span>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {selectedServer.loader && selectedServer.loader !== 'vanilla'
                        ? `${selectedServer.loader.charAt(0).toUpperCase() + selectedServer.loader.slice(1)} ${selectedServer.loaderVersion || ''}`
                        : 'Vanilla'}
                    </span>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      端口 {selectedServer.port || 25565}
                    </span>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {selectedServer.maxMemory} MB
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 600,
                      color: isRunning ? '#16a34a' : 'var(--text-muted)' }}>
                      {isRunning ? '● 运行中' : '○ 已停止'}
                    </span>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexShrink: 0, flexWrap: 'wrap' }}>
                  {!isRunning
                    ? <button className="btn btn-success" style={{ fontSize: 13 }}
                        onClick={() => handleStart(selectedId)}>▶ 启动</button>
                    : <>
                        <button className="btn btn-ghost" style={{ fontSize: 13 }}
                          onClick={() => handleStop(selectedId)}>■ 停止</button>
                        <button className="btn btn-danger" style={{ fontSize: 12, padding: '6px 10px' }}
                          onClick={() => handleKill(selectedId)}>强制终止</button>
                      </>
                  }
                  <button className="btn btn-ghost" style={{ fontSize: 12, padding: '6px 10px' }}
                    onClick={() => window.cmcl.serverOpenDir(selectedId)}>打开目录</button>
                  <button className="btn btn-danger" style={{ fontSize: 12, padding: '6px 10px' }}
                    disabled={isRunning}
                    title={isRunning ? '请先停止服务器' : '删除此实例'}
                    onClick={() => !isRunning && setDeleteTarget(selectedId)}>删除</button>
                </div>
              </div>
            </div>

            {/* Tab bar + content */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              {/* Tab bar */}
              <div style={{ display: 'flex', borderBottom: '1px solid rgba(0,0,0,0.08)',
                flexShrink: 0 }}>
                {tabBtn('console', '控制台')}
                {tabBtn('players', '玩家管理')}
                {tabBtn('settings', '设置')}
              </div>

              {/* Console tab */}
              {activeTab === 'console' && (
                <div className="card" style={{ flex: 1, display: 'flex', flexDirection: 'column',
                  overflow: 'hidden', padding: '12px 14px', marginTop: 12 }}>
                  <StatusBar
                    isRunning={isRunning}
                    consoleLogs={consoleLogs}
                    serverMods={serverMods}
                    onRefreshMods={() => {
                      if (selectedId)
                        window.cmcl.serverListMods(selectedId).then(list => setServerMods(list || []));
                    }}
                  />
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)',
                    textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
                    控制台
                  </div>

                  {/* ── Crash client-mod banner ── */}
                  {(() => {
                    const visible = crashModErrors.filter(
                      e => !removedCrashMods[`${selectedId}:${e.mod}`]
                    );
                    if (visible.length === 0) return null;
                    return (
                      <div style={{
                        background: 'rgba(245,101,101,0.09)',
                        border: '1px solid rgba(245,101,101,0.28)',
                        borderRadius: 'var(--radius-sm)',
                        padding: '10px 14px', marginBottom: 10,
                        fontSize: 12, color: 'var(--text-primary)', lineHeight: 1.7,
                      }}>
                        <div style={{ fontWeight: 600, color: 'var(--red)', marginBottom: 4 }}>
                          ⚠ 检测到客户端 Mod 导致服务端启动失败
                        </div>
                        <div style={{ color: 'var(--text-secondary)', marginBottom: 8, fontSize: 11 }}>
                          以下 Mod 依赖了纯客户端 Mod（sodium/iris 等），服务端无法加载它们。建议移除后重启。
                          移除时 Tick 将读取 JAR 元数据精确匹配 modId，不会误删同名前缀的其他 Mod。
                        </div>
                        {visible.map((e) => {
                          const key = `${selectedId}:${e.mod}`;
                          const isConfirming = confirmingCrashMod === e.mod;
                          const isRemoving   = removingCrashMod === e.mod;
                          return (
                            <div key={e.mod} style={{
                              display: 'flex', alignItems: 'center', gap: 8,
                              marginBottom: 6, flexWrap: 'wrap',
                            }}>
                              <code style={{
                                background: 'rgba(245,101,101,0.12)',
                                padding: '1px 6px', borderRadius: 3,
                                color: '#f8a0a0', fontSize: 11, flexShrink: 0,
                              }}>
                                {e.mod}
                              </code>
                              <span style={{ fontSize: 11, color: 'var(--text-muted)', flex: 1 }}>
                                依赖 {e.missingDep}（服务端不可用）
                              </span>

                              {isRemoving ? (
                                <span style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
                                  <span className="spinner" style={{ width: 10, height: 10 }} />读取元数据中...
                                </span>
                              ) : isConfirming ? (
                                <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                                  <span style={{ fontSize: 11, color: '#f8a0a0' }}>确认移除 {e.mod}？</span>
                                  <button className="btn btn-ghost"
                                    style={{ fontSize: 10, padding: '2px 8px', color: 'var(--red)', borderColor: 'rgba(245,101,101,0.35)' }}
                                    onClick={() => handleRemoveCrashMod(e.mod)}>
                                    确认
                                  </button>
                                  <button className="btn btn-ghost"
                                    style={{ fontSize: 10, padding: '2px 8px' }}
                                    onClick={() => setConfirmingCrashMod(null)}>
                                    取消
                                  </button>
                                </span>
                              ) : (
                                <button className="btn btn-ghost"
                                  style={{ fontSize: 10, padding: '2px 8px', color: 'var(--red)', borderColor: 'rgba(245,101,101,0.25)', flexShrink: 0 }}
                                  onClick={() => setConfirmingCrashMod(e.mod)}>
                                  移除
                                </button>
                              )}
                            </div>
                          );
                        })}
                        <div style={{ marginTop: 4, fontSize: 10, color: 'var(--text-muted)' }}>
                          移除后点「启动」重新尝试。若元数据扫描找不到文件，请手动打开目录删除。
                        </div>
                      </div>
                    );
                  })()}

                  {/* ── Java 8u321+ / old Forge incompatibility banner ── */}
                  {javaForgeCrash && !javaForgeBannerDismissed && (
                    <div style={{
                      background: 'rgba(246,201,14,0.08)',
                      border: '1px solid rgba(246,201,14,0.35)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '10px 14px', marginBottom: 10,
                      fontSize: 12, color: 'var(--text-primary)', lineHeight: 1.7,
                    }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                        <div style={{ fontWeight: 600, color: '#d97706', marginBottom: 4 }}>
                          ⚠ 启动失败：Java 版本过旧的 Forge 不兼容当前 Java 8
                        </div>
                        <button
                          onClick={() => setJavaForgeBannerDismissed(true)}
                          style={{
                            background: 'none', border: 'none', cursor: 'pointer',
                            color: 'var(--text-muted)', fontSize: 14, lineHeight: 1,
                            flexShrink: 0, padding: '0 2px',
                          }}
                          title="关闭提示">×</button>
                      </div>
                      <div style={{ color: 'var(--text-secondary)', marginBottom: 8, fontSize: 11.5 }}>
                        这个服务端使用较老的 Forge（ModLauncher 8.0.x），它与 Java 8u321 及更新的 Java 8
                        版本不兼容（Java 在 8u321 改动了 ManifestEntryVerifier 内部接口）。你当前用的 Java 8
                        补丁号太新了。
                      </div>
                      <div style={{ color: 'var(--text-secondary)', fontSize: 11.5, marginBottom: 6 }}>
                        <strong style={{ color: 'var(--text-primary)' }}>解决办法（二选一）：</strong>
                      </div>
                      <div style={{ color: 'var(--text-secondary)', fontSize: 11.5, marginBottom: 4, paddingLeft: 4 }}>
                        ① 安装一个 8u321 之前的老版本 Java 8（推荐 8u202），然后在「设置 → Java 路径」里手动指定它来运行此服务端。
                      </div>
                      <div style={{ paddingLeft: 16, marginBottom: 8, display: 'flex', flexDirection: 'column', gap: 3 }}>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>下载地址：</span>
                        {[
                          { label: 'Azul Zulu 8u202', url: 'https://www.azul.com/downloads/?version=java-8-lts&package=jre' },
                          { label: 'Adoptium 历史版本', url: 'https://adoptium.net/temurin/archive/?version=8' },
                        ].map(({ label, url }) => (
                          <button key={url}
                            onClick={() => window.cmcl.openExternal(url)}
                            style={{
                              background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                              color: 'var(--accent)', fontSize: 11, textAlign: 'left',
                              textDecoration: 'underline',
                            }}>
                            {label} — {url}
                          </button>
                        ))}
                      </div>
                      <div style={{ color: 'var(--text-secondary)', fontSize: 11.5, paddingLeft: 4 }}>
                        ② 把服务端升级到 Forge 36.2.26 或更高版本（modlauncher 8.1.3+ 已修复此问题）。
                      </div>
                    </div>
                  )}

                  <div ref={consoleRef} style={{
                    flex: 1, overflowY: 'auto',
                    background: 'rgba(5,8,20,0.75)', borderRadius: 'var(--radius-sm)',
                    padding: '10px 12px',
                    fontFamily: 'Consolas, "Courier New", monospace', fontSize: 12, lineHeight: 1.65,
                    userSelect: 'text', cursor: 'text',
                  }} onContextMenu={e => { e.preventDefault(); const sel = window.getSelection()?.toString(); if (sel) navigator.clipboard.writeText(sel); }}>
                    {consoleLogs.length === 0 && (
                      <span style={{ color: 'rgba(200,208,224,0.30)', userSelect: 'none' }}>
                        等待服务器输出...
                      </span>
                    )}
                    {consoleLogs.map((line, i) => (
                      <div key={i} style={{ color: lineColor(line.type),
                        whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                        {line.message}
                      </div>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                    <input className="form-input"
                      style={{ flex: 1, fontFamily: 'Consolas, monospace', fontSize: 13 }}
                      placeholder={isRunning ? '输入命令，回车发送...' : '服务器未运行'}
                      value={cmdInput} disabled={!isRunning}
                      onChange={e => setCmdInput(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handleSendCmd(); }} />
                    <button className="btn btn-primary"
                      disabled={!isRunning || !cmdInput.trim()}
                      onClick={handleSendCmd} style={{ flexShrink: 0 }}>
                      发送
                    </button>
                  </div>
                </div>
              )}

              {/* Players tab */}
              {activeTab === 'players' && (
                <div className="card" style={{ flexShrink: 0, display: 'flex', flexDirection: 'column',
                  padding: '14px 18px', marginTop: 12 }}>
                  <PlayersTab
                    serverId={selectedId}
                    isRunning={isRunning}
                    consoleLogs={consoleLogs}
                    sendCmd={sendServerCmd}
                  />
                </div>
              )}

              {/* Settings tab */}
              {activeTab === 'settings' && (
                <div className="card" style={{ flex: 1, overflowY: 'auto',
                  padding: '14px 18px', marginTop: 12 }}>
                  <ServerSettingsTab serverId={selectedId} isRunning={isRunning} />
                </div>
              )}
            </div>

          </div>
        )}
      </div>

      {/* ── Top-level modals ───────────────────────────────────────────────── */}
      {showCreate && (
        <CreateServerModal settings={settings}
          onClose={() => setShowCreate(false)}
          onCreated={id => { setShowCreate(false); refreshServers().then(() => setSelectedId(id)); }} />
      )}
      {showImportPack && (
        <MrpackServerImportModal settings={settings}
          onClose={() => setShowImportPack(false)}
          onImported={() => refreshServers()} />
      )}
      {showEula && (
        <EulaDialog serverId={pendingStartId}
          onConfirm={handleEulaConfirmed}
          onCancel={() => { setShowEula(false); setPendingStartId(null); }} />
      )}
      {deleteTarget && (
        <DeleteConfirmModal serverName={deleteTarget}
          onConfirm={handleDeleteConfirmed}
          onCancel={() => setDeleteTarget(null)} />
      )}
    </div>
  );
}
