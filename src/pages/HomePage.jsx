import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import bgImage from '../assets/bg.jpg';

export default function HomePage() {
  const { settings, localVersions, isLaunching, launch, launchLog, setPage, loginMicrosoft, logout } = useApp();
  const [selectedVersion, setSelectedVersion] = useState('');
  const [showLog, setShowLog] = useState(false);
  const [error, setError] = useState('');
  const [logging, setLogging] = useState(false);
  const [avatarFallback, setAvatarFallback] = useState(0);

  // Reset avatar fallback counter when account changes (logout / re-login)
  useEffect(() => {
    setAvatarFallback(0);
  }, [settings?.account?.uuid]);

  // Prefer last launched version; fall back to list[0] if it no longer exists
  useEffect(() => {
    if (localVersions.length === 0 || !settings || selectedVersion) return;
    const last = settings.lastLaunchedVersion;
    const exists = last && localVersions.some(v => v.id === last);
    setSelectedVersion(exists ? last : localVersions[0].id);
  }, [localVersions, settings]);

  const account = settings?.account;
  const isMS = account?.type === 'microsoft';
  const displayName = isMS ? account.username : (settings?.username || 'Steve');

  const handleLaunch = async () => {
    if (!selectedVersion) { setError('请先选择一个版本'); return; }
    if (!settings?.javaPath) { setError('未检测到 Java，请在设置中配置 Java 路径'); return; }
    setError('');
    setShowLog(true);
    try { await launch(selectedVersion); }
    catch (err) { setError(`启动失败: ${err.message}`); }
  };

  const handleLogin = async () => {
    setLogging(true);
    setError('');
    try {
      const result = await loginMicrosoft();
      if (!result.success) setError(result.error);
    } catch (err) {
      setError(err.message);
    } finally {
      setLogging(false);
    }
  };

  const modLoaderBadge = (id) => {
    if (!id) return null;
    if (id.includes('fabric-loader')) return <span className="tag" style={{ background: 'rgba(220,200,100,0.15)', color: '#ddc864' }}>Fabric</span>;
    if (id.includes('neoforge'))     return <span className="tag" style={{ background: 'rgba(220,130,50,0.15)',  color: '#dc8232' }}>NeoForge</span>;
    if (id.toLowerCase().includes('forge')) return <span className="tag" style={{ background: 'rgba(200,100,50,0.15)', color: '#c86432' }}>Forge</span>;
    return null;
  };

  return (
    <>
      {/* ── 固定背景层：清晰 MC 背景图 ─────────────────────────────────────── */}
      <div
        aria-hidden="true"
        style={{
          position: 'fixed', inset: 0, zIndex: 0,
          backgroundImage: `url(${bgImage})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          filter: `blur(var(--home-blur))`,
          transform: `scale(var(--home-scale))`,
          pointerEvents: 'none',
        }}
      />
      {/* ── 淡色遮罩 ──────────────────────────────────────────────────────── */}
      <div
        aria-hidden="true"
        style={{
          position: 'fixed', inset: 0, zIndex: 1,
          background: 'var(--home-overlay)',
          pointerEvents: 'none',
        }}
      />

      {/* ── 前景：右侧紧凑控件面板，左侧留给背景图 ────────────────────────── */}
      <div
        className="page-content"
        style={{
          position: 'relative', zIndex: 2, background: 'transparent',
          display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end',
          padding: '20px',
        }}
      >
        {/* 右侧 400px 面板 */}
        <div style={{ width: '400px', flexShrink: 0, display: 'flex', flexDirection: 'column' }}>

          {/* 运行状态指示器 */}
          {isLaunching && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              fontSize: '13px', color: 'var(--accent-green)',
              justifyContent: 'flex-end', marginBottom: '8px',
            }}>
              <span className="spinner" /> 游戏运行中
            </div>
          )}

          {/* ── 账号卡片（单行紧凑）──────────────────────────────────────── */}
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              {isMS && account?.uuid && avatarFallback < 2 ? (
                <img
                  key={account.uuid}
                  src={avatarFallback === 0
                    ? `https://crafatar.com/avatars/${account.uuid}?size=34&overlay`
                    : `https://mc-heads.net/avatar/${account.uuid}/34`}
                  alt={displayName}
                  onError={() => setAvatarFallback(f => f + 1)}
                  className="pixel-img"
                  style={{
                    width: '34px', height: '34px', borderRadius: '8px', flexShrink: 0,
                    objectFit: 'cover', display: 'block',
                  }}
                />
              ) : (
                <div style={{
                  width: '34px', height: '34px', borderRadius: '8px', flexShrink: 0,
                  background: isMS ? 'linear-gradient(135deg, #0078D4, #004e8c)' : 'rgba(255,255,255,0.06)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '17px',
                }}>
                  {isMS ? '🔷' : '👤'}
                </div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '14px', fontWeight: '600', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {displayName}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '1px' }}>
                  {isMS ? '✓ 微软正版账号' : '离线模式 · 无需购买'}
                </div>
              </div>
              {isMS ? (
                <button className="btn btn-ghost" style={{ fontSize: '11px', padding: '4px 10px', flexShrink: 0 }} onClick={logout}>
                  退出登录
                </button>
              ) : (
                <button className="btn btn-primary" style={{ fontSize: '11px', padding: '4px 10px', flexShrink: 0 }} onClick={handleLogin} disabled={logging}>
                  {logging ? <><span className="spinner" /> 登录中</> : '登录微软账号'}
                </button>
              )}
            </div>
          </div>

          {/* ── 快速启动卡片 ─────────────────────────────────────────────── */}
          <div className="card">
            <div className="card-title">快速启动</div>
            {localVersions.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '12px 0' }}>
                <div style={{ fontSize: '28px', marginBottom: '8px' }}>⬇</div>
                <div style={{ color: 'var(--text-secondary)', marginBottom: '12px', fontSize: '13px' }}>还没有安装任何版本</div>
                <button className="btn btn-primary" onClick={() => setPage('download')}>前往下载</button>
              </div>
            ) : (
              <>
                <select
                  className="form-select"
                  style={{ marginBottom: '10px' }}
                  value={selectedVersion}
                  onChange={(e) => setSelectedVersion(e.target.value)}
                >
                  {localVersions.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.displayName || v.id}{v.modLoader ? ` [${v.modLoader}]` : ''}
                    </option>
                  ))}
                </select>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                  <button
                    className="btn btn-success"
                    style={{ fontSize: '14px', padding: '7px 20px', fontWeight: '700' }}
                    onClick={handleLaunch}
                    disabled={isLaunching}
                  >
                    {isLaunching ? <><span className="spinner" /> 启动中...</> : '▶  启动游戏'}
                  </button>
                  {selectedVersion && modLoaderBadge(selectedVersion)}
                  <span style={{ marginLeft: 'auto', fontSize: '11px', color: 'var(--text-muted)' }}>
                    {settings?.maxMemory || 2048} MB
                  </span>
                </div>
              </>
            )}
            {error && (
              <div style={{
                marginTop: '10px', padding: '8px 12px',
                background: 'rgba(245,101,101,0.1)', border: '1px solid rgba(245,101,101,0.3)',
                borderRadius: 'var(--radius-sm)', color: 'var(--red)', fontSize: '12px',
              }}>
                {error}
              </div>
            )}
          </div>

          {/* ── Java 状态卡片（单行紧凑）─────────────────────────────────── */}
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.8px', flexShrink: 0 }}>
                Java
              </span>
              {settings?.javaPath ? (
                <>
                  <span className="status-ok" style={{ fontSize: '12px', flexShrink: 0 }}>✓</span>
                  <span style={{ fontSize: '12px', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {settings.javaPath}
                  </span>
                </>
              ) : (
                <>
                  <span className="status-err" style={{ fontSize: '12px', flexShrink: 0 }}>✗</span>
                  <span style={{ fontSize: '12px', color: 'var(--red)' }}>未检测到 Java</span>
                  <button
                    className="btn btn-ghost"
                    style={{ fontSize: '11px', padding: '3px 8px', marginLeft: 'auto', flexShrink: 0 }}
                    onClick={() => setPage('settings')}
                  >
                    前往设置
                  </button>
                </>
              )}
            </div>
          </div>

          {/* ── 启动日志 ─────────────────────────────────────────────────── */}
          {showLog && launchLog.length > 0 && (
            <div className="card">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                <div className="card-title" style={{ margin: 0 }}>启动日志</div>
                <button className="btn btn-ghost" style={{ fontSize: '11px', padding: '3px 8px' }} onClick={() => setShowLog(false)}>关闭</button>
              </div>
              <div style={{
                background: 'rgba(5, 8, 20, 0.70)', borderRadius: 'var(--radius-sm)', padding: '10px',
                height: '160px', overflowY: 'auto', fontFamily: 'Consolas, monospace', fontSize: '11px', lineHeight: '1.6',
                userSelect: 'text', cursor: 'text',
              }}>
                {launchLog.map((log, i) => (
                  <div key={i} style={{
                    color: log.type === 'stderr' ? 'var(--yellow)' : log.type === 'error' ? 'var(--red)'
                      : log.type === 'exit' ? 'var(--accent-green)' : log.type === 'info' ? 'var(--accent)' : 'var(--text-secondary)',
                    whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                  }}>
                    {log.message.trimEnd()}
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      </div>
    </>
  );
}
