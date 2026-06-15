import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useApp } from '../context/AppContext';

const TYPE_LABELS = { release: '正式版', snapshot: '快照', old_beta: '旧测试版', old_alpha: '旧内测版' };
const INVALID_NAME_RE = /[\\/:*?"<>|]/;

// ─── Instance Naming Modal ────────────────────────────────────────────────────

function InstanceNameModal({ config, onConfirm, onSkip }) {
  const [name, setName]       = useState('');
  const [error, setError]     = useState('');
  const [creating, setCreating] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (config) {
      setName(config.defaultName);
      setError('');
      setCreating(false);
      // Select-all so user can type immediately without clearing
      setTimeout(() => { inputRef.current?.select(); }, 60);
    }
  }, [config]);

  if (!config) return null;

  const validate = (val) => {
    const t = val.trim();
    if (!t) return '';   // blank = will fall back to default, no inline error
    if (INVALID_NAME_RE.test(t)) return '名称含非法字符（\\ / : * ? " < > |）';
    if (t.length > 80)  return '名称不能超过 80 个字符';
    return '';
  };

  const onChange = (e) => { setName(e.target.value); setError(validate(e.target.value)); };

  const handleCreate = async () => {
    const finalName = name.trim() || config.defaultName;
    const err = validate(finalName);
    if (err) { setError(err); return; }
    setCreating(true);
    const result = await onConfirm(finalName);
    // onConfirm returns null on success (modal closes), or result on failure
    if (result && !result.success) { setError(result.error); setCreating(false); }
  };

  const LOADER_LABELS = { fabric: 'Fabric', forge: 'Forge', neoforge: 'NeoForge' };
  const loaderLabel = config.meta?.modLoader ? LOADER_LABELS[config.meta.modLoader] : '原版';

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 10000,
      background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        padding: '28px 32px', width: '420px',
        boxShadow: '0 8px 36px rgba(0,0,0,0.6)',
      }}>
        <div style={{ fontSize: '15px', fontWeight: '600', marginBottom: '6px' }}>创建实例</div>
        <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '20px', lineHeight: '1.7' }}>
          {loaderLabel} · MC {config.meta?.mcVersion || config.defaultName}
          {config.meta?.loaderVersion ? ` · ${config.meta.modLoader} ${config.meta.loaderVersion}` : ''}<br />
          为此版本命名一个独立实例（留空则使用默认名称）
        </div>

        <label style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '6px' }}>
          实例名称
        </label>
        <input
          ref={inputRef}
          className="form-input"
          style={{
            width: '100%', boxSizing: 'border-box',
            marginBottom: error ? '6px' : '20px',
            borderColor: error ? 'var(--red)' : undefined,
          }}
          placeholder={config.defaultName}
          value={name}
          onChange={onChange}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !creating) handleCreate();
            if (e.key === 'Escape') onSkip();
          }}
        />

        {error && (
          <div style={{ fontSize: '12px', color: 'var(--red)', marginBottom: '16px' }}>{error}</div>
        )}

        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" style={{ fontSize: '13px' }} onClick={onSkip} disabled={creating}>
            跳过
          </button>
          <button
            className="btn btn-primary"
            style={{ fontSize: '13px' }}
            onClick={handleCreate}
            disabled={creating || !!error}
          >
            {creating ? <span className="spinner" /> : '创建实例'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Version Tab ──────────────────────────────────────────────────────────────

function VersionTab({ localIds, settings, startDownload, isDownloading, showInstanceModal }) {
  const [versionList, setVersionList] = useState([]);
  const [loading, setLoading]         = useState(false);
  const [filter, setFilter]           = useState('release');
  const [search, setSearch]           = useState('');
  const [error, setError]             = useState('');
  const [downloadingId, setDownloadingId] = useState('');

  const fetch = async () => {
    setLoading(true); setError('');
    try { setVersionList(await window.cmcl.getVersionList(settings?.downloadSource)); }
    catch (err) { setError(`获取失败: ${err.message}`); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetch(); }, []);

  const filtered = useMemo(() => {
    let list = filter === 'all' ? versionList : versionList.filter((v) => v.type === filter);
    if (search) list = list.filter((v) => v.id.toLowerCase().includes(search.toLowerCase()));
    return list;
  }, [versionList, filter, search]);

  const handleDownload = async (v) => {
    if (isDownloading) return;
    setDownloadingId(v.id); setError('');
    try {
      await startDownload(v);
      // 下载成功 → 弹实例命名对话框
      showInstanceModal({
        defaultName: v.id,
        inheritsFrom: v.id,
        meta: { mcVersion: v.id, modLoader: null, loaderVersion: null },
      });
    } catch (err) {
      setError(`下载失败: ${err.message}`);
    } finally {
      setDownloadingId('');
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', alignItems: 'center' }}>
        <input className="form-input" style={{ flex: 1, maxWidth: '200px' }} placeholder="搜索版本..."
          value={search} onChange={(e) => setSearch(e.target.value)} />
        {['release', 'snapshot', 'all'].map((f) => (
          <button key={f} className={`btn ${filter === f ? 'btn-primary' : 'btn-ghost'}`}
            style={{ fontSize: '12px', padding: '6px 12px' }} onClick={() => setFilter(f)}>
            {f === 'release' ? '正式版' : f === 'snapshot' ? '快照' : '全部'}
          </button>
        ))}
        <button className="btn btn-ghost" style={{ fontSize: '12px', padding: '6px 12px' }}
          onClick={fetch} disabled={loading}>
          {loading ? <span className="spinner" /> : '刷新'}
        </button>
      </div>

      {error && (
        <div style={{ padding: '10px', background: 'rgba(245,101,101,0.1)', border: '1px solid rgba(245,101,101,0.3)', borderRadius: 'var(--radius-sm)', color: 'var(--red)', fontSize: '13px', marginBottom: '12px' }}>
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
          <span className="spinner" style={{ width: '24px', height: '24px' }} />
          <div style={{ marginTop: '12px' }}>加载中...</div>
        </div>
      ) : (
        <div style={{ background: 'var(--bg-secondary)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px 110px 130px', padding: '8px 16px', borderBottom: '1px solid var(--border)', fontSize: '11px', color: 'var(--text-muted)', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.5px', borderLeft: '3px solid transparent' }}>
            <span>版本</span><span>类型</span><span>发布日期</span><span style={{ textAlign: 'right' }}>操作</span>
          </div>
          <div style={{ maxHeight: 'calc(100vh - 360px)', overflowY: 'auto' }}>
            {filtered.map((v, i) => {
              const downloaded = localIds.has(v.id);
              const dl = downloadingId === v.id;
              return (
                <div key={v.id} style={{
                  display: 'grid', gridTemplateColumns: '1fr 90px 110px 130px',
                  padding: '9px 16px',
                  borderBottom: i < filtered.length - 1 ? '1px solid var(--border)' : 'none',
                  alignItems: 'center', transition: 'background 0.1s',
                  background: downloaded ? 'rgba(74,222,128,0.04)' : 'transparent',
                  borderLeft: downloaded ? '3px solid rgba(74,222,128,0.4)' : '3px solid transparent',
                }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = downloaded ? 'rgba(74,222,128,0.08)' : 'var(--bg-hover)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = downloaded ? 'rgba(74,222,128,0.04)' : 'transparent'; }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '13px', fontWeight: '500', color: downloaded ? 'var(--accent-green)' : 'inherit' }}>{v.id}</span>
                    {downloaded && (
                      <span style={{ background: 'rgba(74,222,128,0.15)', color: 'var(--accent-green)', fontSize: '10px', padding: '1px 6px', borderRadius: '4px', fontWeight: '600' }}>
                        ✓ 已下载
                      </span>
                    )}
                  </div>
                  <span className={`tag tag-${v.type}`}>{TYPE_LABELS[v.type] || v.type}</span>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    {v.releaseTime ? new Date(v.releaseTime).toLocaleDateString('zh-CN') : ''}
                  </span>
                  <div style={{ textAlign: 'right' }}>
                    {downloaded ? (
                      // 已下载：直接弹命名框（无需重下）
                      <button className="btn btn-ghost"
                        style={{ fontSize: '12px', padding: '5px 12px', color: 'var(--accent)' }}
                        onClick={() => showInstanceModal({
                          defaultName: v.id, inheritsFrom: v.id,
                          meta: { mcVersion: v.id, modLoader: null, loaderVersion: null },
                        })}>
                        创建实例
                      </button>
                    ) : (
                      <button className="btn btn-primary" style={{ fontSize: '12px', padding: '5px 12px' }}
                        onClick={() => handleDownload(v)} disabled={isDownloading || dl}>
                        {dl ? <span className="spinner" /> : '下载'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Loader Tab ───────────────────────────────────────────────────────────────

function LoaderTab({ localVersions, settings, installLoader, isInstallingLoader, loaderLog, showInstanceModal }) {
  const [loaderType, setLoaderType]               = useState('fabric');
  const [selectedMcVersion, setSelectedMcVersion] = useState('');
  const [loaderVersions, setLoaderVersions]       = useState([]);
  const [selectedLoaderVersion, setSelectedLoaderVersion] = useState('');
  const [loadingVersions, setLoadingVersions]     = useState(false);
  const [error, setError]                         = useState('');

  // 只显示真正的原版底层（无 inheritsFrom），排除加载器目录和实例目录
  const releaseVersions = useMemo(
    () => localVersions.filter((v) => v.type === 'release' && !v.inheritsFrom),
    [localVersions],
  );

  useEffect(() => {
    if (releaseVersions.length > 0 && !selectedMcVersion) {
      setSelectedMcVersion(releaseVersions[0].id);
    }
  }, [releaseVersions]);

  const fetchLoaderVersions = async () => {
    if (!selectedMcVersion) return;
    setLoadingVersions(true); setError(''); setLoaderVersions([]);
    try {
      let result;
      if (loaderType === 'fabric')    result = await window.cmcl.getFabricVersions(selectedMcVersion);
      else if (loaderType === 'forge') result = await window.cmcl.getForgeVersions(selectedMcVersion);
      else                            result = await window.cmcl.getNeoForgeVersions(selectedMcVersion);

      if (result.success === false) throw new Error(result.error);
      const list = result.data || result;
      setLoaderVersions(Array.isArray(list) ? list : []);
      if (list.length > 0) {
        const first = loaderType === 'fabric' ? list[0].version : (list[0].version || list[0]);
        setSelectedLoaderVersion(first);
      }
    } catch (err) { setError(err.message); }
    finally { setLoadingVersions(false); }
  };

  useEffect(() => { if (selectedMcVersion) fetchLoaderVersions(); }, [loaderType, selectedMcVersion]);

  const handleInstall = async () => {
    if (!selectedMcVersion || !selectedLoaderVersion) return;
    setError('');
    const result = await installLoader(async () => {
      if (loaderType === 'fabric') return await window.cmcl.installFabric(selectedMcVersion, selectedLoaderVersion);
      if (loaderType === 'forge')  return await window.cmcl.installForge(selectedMcVersion, selectedLoaderVersion);
      return await window.cmcl.installNeoForge(selectedMcVersion, selectedLoaderVersion);
    });
    if (!result.success) { setError(result.error); return; }
    // 加载器安装完成 → 弹实例命名对话框
    showInstanceModal({
      defaultName: `${selectedMcVersion}-${loaderType}`,
      inheritsFrom: result.versionId,   // e.g. "neoforge-21.1.233"
      meta: { mcVersion: selectedMcVersion, modLoader: loaderType, loaderVersion: selectedLoaderVersion },
    });
  };

  const LOADERS = [
    { id: 'fabric',   label: 'Fabric',    color: '#ddc864' },
    { id: 'forge',    label: 'Forge',     color: '#c86432' },
    { id: 'neoforge', label: 'NeoForge',  color: '#dc8232' },
  ];

  return (
    <div>
      <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
        {LOADERS.map((l) => (
          <button key={l.id} onClick={() => setLoaderType(l.id)}
            style={{
              flex: 1, padding: '12px', borderRadius: 'var(--radius-sm)',
              border: `1px solid ${loaderType === l.id ? l.color : 'var(--border)'}`,
              background: loaderType === l.id
                ? `rgba(${l.color === '#ddc864' ? '221,200,100' : l.color === '#c86432' ? '200,100,50' : '220,130,50'},0.12)`
                : 'var(--bg-primary)',
              cursor: 'pointer',
              color: loaderType === l.id ? l.color : 'var(--text-secondary)',
              fontWeight: loaderType === l.id ? '700' : '400',
              fontSize: '14px', transition: 'all 0.15s',
            }}>
            {l.label}
          </button>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label">Minecraft 版本</label>
          <select className="form-select" value={selectedMcVersion}
            onChange={(e) => setSelectedMcVersion(e.target.value)}>
            {releaseVersions.map((v) => <option key={v.id} value={v.id}>{v.id}</option>)}
          </select>
        </div>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label">{LOADERS.find((l) => l.id === loaderType)?.label} 版本</label>
          <select className="form-select" value={selectedLoaderVersion}
            onChange={(e) => setSelectedLoaderVersion(e.target.value)}
            disabled={loadingVersions || loaderVersions.length === 0}>
            {loadingVersions ? <option>加载中...</option> : loaderVersions.map((v) => {
              const ver = loaderType === 'fabric' ? v.version : (v.version || v);
              return <option key={ver} value={ver}>{ver}{v.stable === false ? ' (测试版)' : ''}</option>;
            })}
          </select>
        </div>
      </div>

      {releaseVersions.length === 0 && (
        <div style={{ padding: '12px', background: 'rgba(246,201,14,0.08)', border: '1px solid rgba(246,201,14,0.2)', borderRadius: 'var(--radius-sm)', fontSize: '12px', color: 'var(--yellow)', marginBottom: '12px' }}>
          请先在「下载」标签页下载一个原版 Minecraft
        </div>
      )}

      {error && (
        <div style={{ padding: '10px', background: 'rgba(245,101,101,0.1)', border: '1px solid rgba(245,101,101,0.3)', borderRadius: 'var(--radius-sm)', color: 'var(--red)', fontSize: '13px', marginBottom: '12px' }}>
          {error}
        </div>
      )}

      <button className="btn btn-primary"
        onClick={handleInstall}
        disabled={isInstallingLoader || !selectedMcVersion || !selectedLoaderVersion || releaseVersions.length === 0}
        style={{ padding: '9px 24px' }}>
        {isInstallingLoader
          ? <><span className="spinner" /> 安装中...</>
          : `安装 ${LOADERS.find((l) => l.id === loaderType)?.label}`}
      </button>

      {(isInstallingLoader || loaderLog.length > 0) && (
        <div style={{ marginTop: '16px' }}>
          <div className="card-title" style={{ marginBottom: '8px' }}>安装日志</div>
          <div style={{ background: 'var(--bg-primary)', borderRadius: 'var(--radius-sm)', padding: '12px', height: '160px', overflowY: 'auto', fontFamily: 'Consolas, monospace', fontSize: '11px', lineHeight: '1.7', color: 'var(--text-secondary)' }}>
            {loaderLog.map((msg, i) => (
              <div key={i} style={{ color: msg.includes('完成') ? 'var(--accent-green)' : msg.includes('警告') ? 'var(--yellow)' : 'inherit' }}>
                {msg}
              </div>
            ))}
            {isInstallingLoader && <div style={{ color: 'var(--accent)' }}>▌</div>}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function DownloadPage() {
  const {
    settings, localVersions, isDownloading, startDownload,
    isInstallingLoader, installLoader, loaderLog, refreshLocalVersions,
  } = useApp();

  const [tab, setTab]                 = useState('version');
  const [instanceModal, setInstanceModal] = useState(null);  // null | { defaultName, inheritsFrom, meta }

  const localIds = useMemo(() => new Set(localVersions.map((v) => v.id)), [localVersions]);

  const showInstanceModal = useCallback((config) => { setInstanceModal(config); }, []);

  const handleCreateInstance = useCallback(async (instanceName) => {
    const { inheritsFrom, meta } = instanceModal;
    const result = await window.cmcl.createInstance({ instanceName, inheritsFrom, meta });
    if (result.success) {
      await refreshLocalVersions();
      setInstanceModal(null);
      return null;   // signal success to modal
    }
    return result;   // { success: false, error } — modal shows the error
  }, [instanceModal, refreshLocalVersions]);

  return (
    <div className="page-content">
      <h1 className="page-title">下载</h1>

      <InstanceNameModal
        config={instanceModal}
        onConfirm={handleCreateInstance}
        onSkip={() => setInstanceModal(null)}
      />

      <div style={{ display: 'flex', gap: '4px', marginBottom: '20px', background: 'var(--bg-secondary)', padding: '4px', borderRadius: 'var(--radius-sm)', width: 'fit-content' }}>
        {[{ id: 'version', label: '游戏版本' }, { id: 'loader', label: 'Mod 加载器' }].map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ padding: '6px 16px', borderRadius: '4px', border: 'none', background: tab === t.id ? 'var(--accent)' : 'transparent', color: tab === t.id ? '#fff' : 'var(--text-secondary)', fontSize: '13px', fontWeight: tab === t.id ? '600' : '400', cursor: 'pointer', transition: 'all 0.15s' }}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'version' && (
        <VersionTab
          localIds={localIds} settings={settings}
          startDownload={startDownload} isDownloading={isDownloading}
          showInstanceModal={showInstanceModal}
        />
      )}
      {tab === 'loader' && (
        <LoaderTab
          localVersions={localVersions} settings={settings}
          installLoader={installLoader} isInstallingLoader={isInstallingLoader}
          loaderLog={loaderLog} showInstanceModal={showInstanceModal}
        />
      )}
    </div>
  );
}
