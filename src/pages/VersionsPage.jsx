import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '../context/AppContext';

const TYPE_LABELS = { release: '正式版', snapshot: '快照', old_beta: '旧测试版', old_alpha: '旧内测版' };
const INVALID_NAME_RE = /[\\/:*?"<>|]/;

const LOADER_META = {
  fabric:   { bg: 'rgba(221,200,100,0.15)', color: '#ddc864', label: 'Fabric' },
  forge:    { bg: 'rgba(200,100,50,0.15)',  color: '#c86432', label: 'Forge' },
  neoforge: { bg: 'rgba(220,130,50,0.15)',  color: '#dc8232', label: 'NeoForge' },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function sanitizeInstanceName(raw) {
  return (raw || '').replace(INVALID_NAME_RE, '').trim().slice(0, 80);
}

// Unified: takes the loader string returned by detectAndParse
function loaderBadge(loader, loaderVersion) {
  if (!loader) return '原版';
  const label = { fabric: 'Fabric', neoforge: 'NeoForge', forge: 'Forge' }[loader] || loader;
  return loaderVersion ? `${label} ${loaderVersion}` : label;
}

function packFormatLabel(fmt) {
  if (fmt === 'mrpack')     return 'Modrinth .mrpack';
  if (fmt === 'curseforge') return 'CurseForge / HMCL 本地打包';
  return fmt || '未知';
}

// ── Log line colors ───────────────────────────────────────────────────────────

function logLineColor(type) {
  if (type === 'error')   return '#f56565';
  if (type === 'success') return '#4ade80';
  if (type === 'detail')  return 'rgba(200,208,224,0.6)';
  return '#c8d0e0';
}

// ── MrpackClientImportModal ───────────────────────────────────────────────────

function MrpackClientImportModal({ onClose, onImported }) {
  // 'preview': file parsed, show info + name input
  // 'importing': running import, show live log
  // 'done': import finished (success or partial)
  const [step, setStep] = useState('preview');

  // File selection
  const [filePath, setFilePath] = useState('');
  const [manifest, setManifest] = useState(null);   // lightweight preview data
  const [parseError, setParseError] = useState('');
  const [parsing, setParsing] = useState(false);

  // Instance naming
  const [instanceName, setInstanceName] = useState('');
  const [nameError, setNameError] = useState('');

  // Progress log
  const [log, setLog] = useState([]);
  const logEndRef = useRef(null);
  // Throttle download:progress — only log on stage change
  const lastDlStage = useRef('');

  // Import result
  const [result, setResult] = useState(null);

  // Auto-scroll log to bottom
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'auto' });
  }, [log.length]);

  // Subscribe to all progress channels while importing
  useEffect(() => {
    if (step !== 'importing') return;

    lastDlStage.current = '';

    const append = (type, text) =>
      setLog(prev => [...prev, { type, text }]);

    const u1 = window.cmcl.onMrpackProgress(({ phase, message, completed, total }) => {
      const badge = (completed != null && total != null && total > 0)
        ? `[${completed}/${total}] ` : '';
      const type = phase === 'error' ? 'error' : phase === 'done' ? 'success' : 'info';
      append(type, badge + message);
    });

    const u2 = window.cmcl.onLoaderProgress(({ message }) => {
      append('detail', message);
    });

    const u3 = window.cmcl.onDownloadProgress(({ stage, detail }) => {
      if (stage !== lastDlStage.current) {
        lastDlStage.current = stage;
        append('detail', `[MC] ${stage}${detail ? ': ' + detail : ''}...`);
      }
    });

    return () => { u1(); u2(); u3(); };
  }, [step]);

  // ── Actions ─────────────────────────────────────────────────────────────────

  const handleSelectFile = async () => {
    setParsing(true);
    setParseError('');
    setManifest(null);
    setFilePath('');

    const fp = await window.cmcl.selectMrpackFile();
    if (!fp) { setParsing(false); return; }

    const res = await window.cmcl.parseMrpack(fp);
    setParsing(false);

    if (!res.success) {
      setParseError(res.error);
      return;
    }

    setFilePath(fp);
    setManifest(res); // res IS the flat data object (detectAndParse spreads directly, no .manifest wrapper)
    setInstanceName(sanitizeInstanceName(res.name) || sanitizeInstanceName(
      fp.split(/[\\/]/).pop().replace(/\.(mrpack|zip)$/i, ''),
    ));
  };

  const handleImport = async () => {
    const trimmed = instanceName.trim();
    if (!trimmed) { setNameError('实例名不能为空'); return; }
    if (INVALID_NAME_RE.test(trimmed)) { setNameError('名称含非法字符（\\ / : * ? " < > |）'); return; }
    if (trimmed.length > 80) { setNameError('名称不能超过 80 个字符'); return; }
    setNameError('');

    setStep('importing');
    setLog([]);

    const res = await window.cmcl.importMrpackAsClient(filePath, trimmed);
    setResult(res);
    setStep('done');
    if (res.success) onImported?.();
  };

  // ── Preview step ─────────────────────────────────────────────────────────────

  const renderPreview = () => (
    <div>
      <div style={{ fontSize: '15px', fontWeight: '600', marginBottom: '18px', color: 'var(--text-primary)' }}>
        导入整合包（客户端）
      </div>

      {/* File selector */}
      <div style={{ marginBottom: '16px' }}>
        <button
          className="btn btn-ghost"
          style={{ width: '100%', justifyContent: 'center', padding: '10px', fontSize: '13px' }}
          onClick={handleSelectFile}
          disabled={parsing}
        >
          {parsing ? <><span className="spinner" style={{ marginRight: 8 }} />解析中...</>
            : filePath ? `✓ ${filePath.split(/[\\/]/).pop()}` : '选择整合包文件（.mrpack 或 .zip）'}
        </button>
        {parseError && (
          <div style={{ marginTop: '8px', fontSize: '12px', color: 'var(--red)', lineHeight: 1.5 }}>
            ✗ {parseError}
          </div>
        )}
      </div>

      {/* Pack info — uses unified fields from detectAndParse */}
      {manifest && (
        <div style={{
          background: 'rgba(99,102,241,0.07)',
          border: '1px solid rgba(99,102,241,0.2)',
          borderRadius: 'var(--radius-sm)',
          padding: '12px 14px',
          marginBottom: '16px',
          fontSize: '12px',
          lineHeight: 1.8,
          color: 'var(--text-secondary)',
        }}>
          <div>
            <span style={{ color: 'var(--text-muted)', marginRight: 6 }}>整合包</span>
            <strong style={{ color: 'var(--text-primary)' }}>{manifest.name || '(未命名)'}</strong>
          </div>
          <div>
            <span style={{ color: 'var(--text-muted)', marginRight: 6 }}>格式</span>
            {packFormatLabel(manifest.packFormat)}
          </div>
          <div>
            <span style={{ color: 'var(--text-muted)', marginRight: 6 }}>游戏版本</span>
            MC {manifest.mcVersion}
          </div>
          <div>
            <span style={{ color: 'var(--text-muted)', marginRight: 6 }}>加载器</span>
            {loaderBadge(manifest.loader, manifest.loaderVersion)}
          </div>
          <div>
            <span style={{ color: 'var(--text-muted)', marginRight: 6 }}>Mod</span>
            <strong style={{ color: 'var(--accent)' }}>{manifest.modCount}</strong>
            {manifest.packFormat === 'curseforge'
              ? <span style={{ color: 'var(--text-muted)', marginLeft: 4 }}>个（已内嵌，无需联网下载）</span>
              : <span style={{ color: 'var(--text-muted)', marginLeft: 4 }}>个（联网下载）</span>}
          </div>
          {/* Warn when CF manifest.files[] has CurseForge project refs we can't resolve */}
          {manifest.warnCfNetworkFiles && (
            <div style={{ marginTop: '4px', color: '#f6c90e', lineHeight: 1.5 }}>
              ⚠ 该整合包含 {manifest.networkModCount} 个 CurseForge 引用文件，<br />
              Tick 暂不支持自动下载，需导入后手动补全。
            </div>
          )}
        </div>
      )}

      {/* Instance name */}
      {manifest && (
        <div style={{ marginBottom: '20px' }}>
          <label style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '6px' }}>
            实例名称
          </label>
          <input
            className="form-input"
            style={{ width: '100%', boxSizing: 'border-box', borderColor: nameError ? 'var(--red)' : undefined }}
            value={instanceName}
            onChange={e => { setInstanceName(e.target.value); setNameError(''); }}
            onKeyDown={e => e.key === 'Enter' && handleImport()}
            placeholder="输入实例名称"
            autoFocus
          />
          {nameError && (
            <div style={{ marginTop: '5px', fontSize: '12px', color: 'var(--red)' }}>{nameError}</div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
        <button className="btn btn-ghost" onClick={onClose}>取消</button>
        {manifest && (
          <button className="btn btn-primary" onClick={handleImport}>
            开始导入
          </button>
        )}
      </div>
    </div>
  );

  // ── Importing step ────────────────────────────────────────────────────────────

  const renderImporting = () => (
    <div>
      <div style={{ fontSize: '15px', fontWeight: '600', marginBottom: '14px', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '10px' }}>
        <span className="spinner" />
        正在导入整合包...
      </div>
      <div style={{
        background: '#0d0e1a',
        borderRadius: 'var(--radius-sm)',
        padding: '10px 12px',
        height: '280px',
        overflowY: 'auto',
        fontFamily: 'monospace',
        fontSize: '11.5px',
        lineHeight: 1.6,
      }}>
        {log.map((line, i) => (
          <div key={i} style={{ color: logLineColor(line.type), wordBreak: 'break-all' }}>
            {line.text}
          </div>
        ))}
        <div ref={logEndRef} />
      </div>
      <div style={{ marginTop: '10px', fontSize: '11px', color: 'var(--text-muted)' }}>
        导入过程中请勿关闭窗口
      </div>
    </div>
  );

  // ── Done step ─────────────────────────────────────────────────────────────────

  const renderDone = () => {
    const failed = result?.failedMods || [];
    const cfMissing = result?.warnCfNetworkFiles || 0;
    return (
      <div>
        <div style={{ fontSize: '15px', fontWeight: '600', marginBottom: '14px', color: result?.success ? 'var(--green, #4ade80)' : 'var(--red)', display: 'flex', alignItems: 'center', gap: '8px' }}>
          {result?.success ? '✓ 导入完成' : '✗ 导入失败'}
        </div>

        {result?.success ? (
          <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '14px', lineHeight: 1.7 }}>
            实例「<strong style={{ color: 'var(--text-primary)' }}>{result.instanceId}</strong>」已创建并可以启动。
            {failed.length === 0 && cfMissing === 0 && ' 所有文件已就绪。'}
          </div>
        ) : (
          <div style={{
            background: 'rgba(245,101,101,0.08)', border: '1px solid rgba(245,101,101,0.2)',
            borderRadius: 'var(--radius-sm)', padding: '10px 12px', marginBottom: '14px',
            fontSize: '12px', color: 'var(--red)', lineHeight: 1.6,
          }}>
            {result?.error}
          </div>
        )}

        {/* CurseForge network file warning */}
        {cfMissing > 0 && (
          <div style={{
            background: 'rgba(246,201,14,0.07)', border: '1px solid rgba(246,201,14,0.25)',
            borderRadius: 'var(--radius-sm)', padding: '10px 12px', marginBottom: '14px',
            fontSize: '12px', color: '#f6c90e', lineHeight: 1.6,
          }}>
            ⚠ 该整合包包含 {cfMissing} 个 CurseForge 引用文件（需 CurseForge API），Tick 暂不支持自动下载。
            如启动后提示缺少 Mod，请手动从 CurseForge 下载后放入 mods/ 目录。
          </div>
        )}

        {failed.length > 0 && (
          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-secondary)', marginBottom: '8px' }}>
              以下 {failed.length} 个 Mod 未能安装（可手动补全）：
            </div>
            <div style={{
              background: '#0d0e1a', borderRadius: 'var(--radius-sm)',
              padding: '8px 10px', maxHeight: '140px', overflowY: 'auto',
              fontFamily: 'monospace', fontSize: '11px', lineHeight: 1.7,
              userSelect: 'text',
            }}>
              {failed.map((f, i) => (
                <div key={i} style={{ color: '#f6c90e' }}>
                  {f.name} — {f.reason}
                </div>
              ))}
            </div>
            <div style={{ marginTop: '6px', fontSize: '11px', color: 'var(--text-muted)' }}>
              可在整合包官方页面单独下载后放入实例的 mods/ 目录
            </div>
          </div>
        )}

        {/* Log toggle (collapsed by default on done) */}
        <details style={{ marginBottom: '16px' }}>
          <summary style={{ fontSize: '12px', color: 'var(--text-muted)', cursor: 'pointer', userSelect: 'none' }}>
            查看安装日志
          </summary>
          <div style={{
            background: '#0d0e1a', borderRadius: 'var(--radius-sm)',
            padding: '8px 10px', maxHeight: '200px', overflowY: 'auto',
            fontFamily: 'monospace', fontSize: '11px', lineHeight: 1.6, marginTop: '6px',
          }}>
            {log.map((line, i) => (
              <div key={i} style={{ color: logLineColor(line.type), wordBreak: 'break-all' }}>{line.text}</div>
            ))}
          </div>
        </details>

        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          {result?.success && result.instanceId && (
            <button className="btn btn-ghost" style={{ fontSize: '12px' }}
              onClick={() => window.cmcl.openVersionDir(result.instanceId)}>
              打开目录
            </button>
          )}
          <button className="btn btn-primary" onClick={onClose}>关闭</button>
        </div>
      </div>
    );
  };

  // ── Modal shell ───────────────────────────────────────────────────────────────

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
        padding: '24px 28px',
        width: '480px',
        maxWidth: '96vw',
        boxShadow: '0 8px 40px rgba(0,0,0,0.6)',
      }}>
        {step === 'preview'   && renderPreview()}
        {step === 'importing' && renderImporting()}
        {step === 'done'      && renderDone()}
      </div>
    </div>
  );
}

// ── ExportModal ───────────────────────────────────────────────────────────────

function ExportModal({ version, onClose }) {
  const [step, setStep] = useState('options'); // 'options' | 'exporting' | 'done' | 'error'
  const [includeSaves,         setIncludeSaves]         = useState(false);
  const [includeResourcePacks, setIncludeResourcePacks] = useState(false);
  const [includeGameSettings,  setIncludeGameSettings]  = useState(false);
  const [includeServerList,    setIncludeServerList]    = useState(false);
  const [logLines, setLogLines] = useState([]);
  const [exportBytes, setExportBytes] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const logRef = useRef(null);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logLines.length]);

  // Subscribe to progress events while exporting
  useEffect(() => {
    if (step !== 'exporting') return;
    const unsub = window.cmcl.onExportProgress((data) => {
      if (data.message) setLogLines(prev => [...prev, data.message]);
      if (data.phase === 'done') {
        setExportBytes(data.bytes || null);
        setStep('done');
      } else if (data.phase === 'error') {
        setErrorMsg(data.message || '未知错误');
        setStep('error');
      }
    });
    return () => { if (typeof unsub === 'function') unsub(); };
  }, [step]);

  const handleStart = async () => {
    setStep('exporting');
    setLogLines(['正在打开保存对话框...']);
    const res = await window.cmcl.instanceExport(version.id, {
      includeSaves, includeResourcePacks, includeGameSettings, includeServerList,
    });
    // Only the canceled case needs to be handled here;
    // success/error come through onExportProgress before this resolves.
    if (res?.canceled) {
      setStep('options');
      setLogLines([]);
    }
  };

  const overlayStyle = {
    position: 'fixed', inset: 0, zIndex: 100,
    background: 'rgba(0,0,0,0.32)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)',
  };
  const panelStyle = {
    background: 'var(--glass-bg)',
    border: '1px solid var(--glass-border)',
    borderRadius: 'var(--radius)',
    padding: '24px 28px',
    width: '420px',
    maxWidth: '95vw',
    boxShadow: 'var(--glass-shadow)',
    backdropFilter: 'blur(var(--glass-blur))',
    WebkitBackdropFilter: 'blur(var(--glass-blur))',
  };
  const chk = (label, hint, value, setter) => (
    <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10,
      cursor: step === 'options' ? 'pointer' : 'default', marginBottom: 10 }}>
      <input type="checkbox" checked={value}
        disabled={step !== 'options'}
        onChange={e => setter(e.target.checked)}
        style={{ marginTop: 2, flexShrink: 0 }} />
      <div>
        <span style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500 }}>{label}</span>
        {hint && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{hint}</div>}
      </div>
    </label>
  );

  return (
    <div style={overlayStyle}>
      <div style={panelStyle}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
          导出整合包
        </h2>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 18 }}>
          {version.name}
        </p>

        {/* ── options ── */}
        {step === 'options' && (
          <>
            <div style={{ marginBottom: 6, fontSize: 11, fontWeight: 600,
              color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>
              默认打包实例内全部内容（mods、config、kubejs 等脚本/配置目录），自动排除日志与运行时缓存
            </div>
            <div style={{ marginBottom: 14 }}>
              {chk('包含存档 (saves/)',
                '⚠ 会显著增大文件体积并变慢',
                includeSaves, setIncludeSaves)}
              {chk('包含资源包 / 光影包',
                'resourcepacks/ 和 shaderpacks/ 目录',
                includeResourcePacks, setIncludeResourcePacks)}
              {chk('包含游戏设置',
                'options.txt、optionsof.txt、optionsshaders.txt',
                includeGameSettings, setIncludeGameSettings)}
              {chk('包含服务器列表 (servers.dat)',
                '⚠ 可能含私人服务器地址，分享前请确认',
                includeServerList, setIncludeServerList)}
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" onClick={onClose}>取消</button>
              <button className="btn btn-primary" onClick={handleStart}>导出</button>
            </div>
          </>
        )}

        {/* ── exporting ── */}
        {step === 'exporting' && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10,
              fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
              <span className="spinner" />
              正在导出...
            </div>
            <div ref={logRef} style={{
              background: 'rgba(5,8,20,0.72)', borderRadius: 'var(--radius-sm)',
              padding: '8px 12px', height: 130, overflowY: 'auto',
              fontFamily: 'Consolas, monospace', fontSize: 11.5, lineHeight: 1.65,
              color: '#c8d0e0',
            }}>
              {logLines.map((line, i) => (
                <div key={i} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{line}</div>
              ))}
            </div>
            <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)' }}>
              导出过程中请勿关闭窗口。大整合包（含存档）可能需要数分钟。
            </div>
          </>
        )}

        {/* ── done ── */}
        {step === 'done' && (
          <>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#16a34a', marginBottom: 10 }}>
              ✓ 导出完成
            </div>
            {exportBytes != null && (
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
                文件大小：{(exportBytes / 1048576).toFixed(1)} MB
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn btn-primary" onClick={onClose}>关闭</button>
            </div>
          </>
        )}

        {/* ── error ── */}
        {step === 'error' && (
          <>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--red)', marginBottom: 10 }}>
              ✗ 导出失败
            </div>
            <div style={{
              padding: '8px 12px', background: 'rgba(245,101,101,0.10)',
              border: '1px solid rgba(245,101,101,0.28)', borderRadius: 'var(--radius-sm)',
              fontSize: 12, color: 'var(--red)', marginBottom: 16, lineHeight: 1.6,
            }}>
              {errorMsg}
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" onClick={onClose}>关闭</button>
              <button className="btn btn-ghost" onClick={() => {
                setStep('options'); setLogLines([]); setErrorMsg('');
              }}>重试</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── VersionsPage ──────────────────────────────────────────────────────────────

export default function VersionsPage() {
  const { localVersions, deleteVersion, refreshLocalVersions } = useApp();
  const [confirmId, setConfirmId] = useState('');
  const [deletingId, setDeletingId] = useState('');
  const [error, setError] = useState('');
  const [showMrpackModal, setShowMrpackModal] = useState(false);
  const [exportTarget, setExportTarget] = useState(null); // { id, name } | null

  const handleDelete = async (id) => {
    setDeletingId(id);
    setError('');
    const result = await deleteVersion(id);
    setDeletingId('');
    setConfirmId('');
    if (!result.success) setError(`删除失败: ${result.error}`);
  };

  const openDir = (id) => window.cmcl.openVersionDir(id);

  return (
    <div className="page-content">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
        <h1 className="page-title" style={{ margin: 0 }}>版本管理</h1>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            className="btn btn-ghost"
            style={{ fontSize: '12px' }}
            onClick={() => setShowMrpackModal(true)}
          >
            导入整合包
          </button>
          <button className="btn btn-ghost" style={{ fontSize: '12px' }} onClick={refreshLocalVersions}>
            刷新
          </button>
        </div>
      </div>

      {error && (
        <div style={{ marginBottom: '12px', padding: '10px 14px', background: 'rgba(245,101,101,0.1)', border: '1px solid rgba(245,101,101,0.3)', borderRadius: 'var(--radius-sm)', color: 'var(--red)', fontSize: '13px' }}>
          {error}
        </div>
      )}

      {localVersions.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '48px 0' }}>
          <div style={{ fontSize: '40px', marginBottom: '12px' }}>📦</div>
          <div style={{ color: 'var(--text-secondary)', marginBottom: '4px' }}>还没有安装任何版本</div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>前往「下载」页面获取 Minecraft</div>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 80px 110px 1fr',
            padding: '8px 20px', borderBottom: '1px solid var(--border)',
            fontSize: '11px', color: 'var(--text-muted)', fontWeight: '600',
            textTransform: 'uppercase', letterSpacing: '0.5px',
          }}>
            <span>版本</span>
            <span>类型</span>
            <span>Mod 加载器</span>
            <span style={{ textAlign: 'right' }}>操作</span>
          </div>

          {localVersions.map((v, i) => {
            const loaderMeta = v.modLoader ? LOADER_META[v.modLoader] : null;
            const isConfirming = confirmId === v.id;
            const isDeleting = deletingId === v.id;
            const isLast = i === localVersions.length - 1;

            return (
              <div
                key={v.id}
                style={{
                  display: 'grid', gridTemplateColumns: '1fr 80px 110px 1fr',
                  padding: '12px 20px',
                  borderBottom: isLast ? 'none' : '1px solid var(--border)',
                  alignItems: 'center',
                  background: isConfirming ? 'rgba(245,101,101,0.05)' : 'transparent',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={(e) => { if (!isConfirming) e.currentTarget.style.background = 'var(--bg-hover)'; }}
                onMouseLeave={(e) => { if (!isConfirming) e.currentTarget.style.background = 'transparent'; }}
              >
                {/* Version name */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '14px', fontWeight: '500' }}>
                      {v.displayName || v.id}
                    </span>
                    {v.isInstance && (
                      <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '3px', background: 'rgba(99,102,241,0.15)', color: 'var(--accent)', fontWeight: '600', whiteSpace: 'nowrap' }}>
                        实例
                      </span>
                    )}
                  </div>
                  {v.isInstance && (
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                      MC {v.mcVersion || v.inheritsFrom}
                      {v.loaderVersion ? ` · ${v.modLoader} ${v.loaderVersion}` : ''}
                    </div>
                  )}
                  {!v.isInstance && v.inheritsFrom && (
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                      继承自 {v.inheritsFrom}
                    </div>
                  )}
                  {!v.isInstance && v.releaseTime && (
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                      {new Date(v.releaseTime).toLocaleDateString('zh-CN')}
                    </div>
                  )}
                </div>

                {/* Type */}
                <span
                  className={v.isInstance ? 'tag' : `tag tag-${v.type}`}
                  style={{ alignSelf: 'center', ...(v.isInstance ? { background: 'rgba(99,102,241,0.1)', color: 'var(--accent)' } : {}) }}
                >
                  {v.isInstance ? '实例' : (TYPE_LABELS[v.type] || v.type)}
                </span>

                {/* Mod loader */}
                <span style={{ alignSelf: 'center' }}>
                  {loaderMeta ? (
                    <span className="tag" style={{ background: loaderMeta.bg, color: loaderMeta.color }}>
                      {loaderMeta.label}
                    </span>
                  ) : (
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>原版</span>
                  )}
                </span>

                {/* Actions */}
                <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end', alignItems: 'center' }}>
                  {isConfirming ? (
                    <>
                      <span style={{ fontSize: '12px', color: 'var(--red)', marginRight: '2px' }}>确定删除？</span>
                      <button
                        className="btn btn-ghost"
                        style={{ fontSize: '12px', padding: '4px 10px' }}
                        onClick={() => setConfirmId('')}
                        disabled={isDeleting}
                      >
                        取消
                      </button>
                      <button
                        className="btn"
                        style={{ fontSize: '12px', padding: '4px 10px', background: 'rgba(245,101,101,0.15)', color: 'var(--red)', border: '1px solid rgba(245,101,101,0.3)' }}
                        onClick={() => handleDelete(v.id)}
                        disabled={isDeleting}
                      >
                        {isDeleting ? <span className="spinner" style={{ borderTopColor: 'var(--red)' }} /> : '确认删除'}
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        className="btn btn-ghost"
                        style={{ fontSize: '12px', padding: '4px 10px' }}
                        onClick={() => openDir(v.id)}
                      >
                        打开目录
                      </button>
                      {v.isInstance && (
                        <button
                          className="btn btn-ghost"
                          style={{ fontSize: '12px', padding: '4px 10px' }}
                          onClick={() => setExportTarget({ id: v.id, name: v.displayName || v.id })}
                        >
                          导出
                        </button>
                      )}
                      <button
                        className="btn btn-ghost"
                        style={{ fontSize: '12px', padding: '4px 10px', color: 'var(--red)', borderColor: 'rgba(245,101,101,0.2)' }}
                        onClick={() => setConfirmId(v.id)}
                      >
                        删除
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ marginTop: '12px', fontSize: '12px', color: 'var(--text-muted)' }}>
        共 {localVersions.length} 个版本
      </div>

      {showMrpackModal && (
        <MrpackClientImportModal
          onClose={() => setShowMrpackModal(false)}
          onImported={refreshLocalVersions}
        />
      )}
      {exportTarget && (
        <ExportModal
          version={exportTarget}
          onClose={() => setExportTarget(null)}
        />
      )}
    </div>
  );
}
