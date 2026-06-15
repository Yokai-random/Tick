import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';

export default function SettingsPage() {
  const { settings, updateSettings, javaList, detectJava, loginMicrosoft, logout } = useApp();
  const [form, setForm] = useState(null);
  const [saved, setSaved] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [logging, setLogging] = useState(false);
  const [authError, setAuthError] = useState('');
  const [downloading, setDownloading] = useState(null);     // major number or null
  const [downloadProgress, setDownloadProgress] = useState(null);
  const [deleting, setDeleting] = useState(null);           // major number or null

  useEffect(() => { if (settings && !form) setForm({ ...settings }); }, [settings]);

  useEffect(() => {
    if (!window.cmcl?.onJavaDownloadProgress) return;
    const off = window.cmcl.onJavaDownloadProgress((data) => setDownloadProgress(data));
    return off;
  }, []);

  if (!form) return <div className="page-content"><div style={{ color: 'var(--text-muted)' }}>加载中...</div></div>;

  const set = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  const handleSave = async () => {
    await updateSettings(form);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleDetectJava = async () => {
    setDetecting(true);
    await detectJava();
    setDetecting(false);
    if (javaList?.length > 0) set('javaPath', javaList[0].path);
  };

  const handleLogin = async () => {
    setLogging(true); setAuthError('');
    try {
      const result = await loginMicrosoft();
      if (!result.success) setAuthError(result.error);
    } catch (err) { setAuthError(err.message); }
    finally { setLogging(false); }
  };

  const handleSelectDir = async () => {
    const dir = await window.cmcl.selectDir();
    if (dir) set('minecraftDir', dir);
  };

  const handleDownloadJava = async (major) => {
    setDownloading(major);
    setDownloadProgress({ major, phase: 'start', message: '准备中...', downloaded: 0, total: 0 });
    const result = await window.cmcl.javaDownload(major);
    setDownloading(null);
    if (result.success) {
      await detectJava();
      setTimeout(() => setDownloadProgress(null), 3000);
    } else {
      setDownloadProgress({ major, phase: 'error', message: result.error || '下载失败', downloaded: 0, total: 0 });
    }
  };

  const handleDeleteJava = async (major) => {
    setDeleting(major);
    const result = await window.cmcl.javaDelete(major);
    setDeleting(null);
    if (result.success) {
      await detectJava();
    } else {
      alert(`删除失败: ${result.error}`);
    }
  };

  const account = form.account;
  const isMS = account?.type === 'microsoft';

  return (
    <div className="page-content">
      <h1 className="page-title">设置</h1>

      {/* Account */}
      <div className="card">
        <div className="card-title">账号</div>
        {isMS ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div style={{ width: '42px', height: '42px', borderRadius: '10px', background: 'linear-gradient(135deg, #0078D4, #004e8c)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px' }}>🔷</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '15px', fontWeight: '600' }}>{account.username}</div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
                微软正版账号 · UUID: {account.uuid?.slice(0, 8)}...
              </div>
              {account.expiresAt && (
                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  Token 有效期至: {new Date(account.expiresAt).toLocaleString('zh-CN')}
                </div>
              )}
            </div>
            <button className="btn btn-danger" style={{ fontSize: '12px' }} onClick={logout}>退出登录</button>
          </div>
        ) : (
          <div>
            <div className="form-group">
              <label className="form-label">离线用户名</label>
              <input className="form-input" style={{ maxWidth: '280px' }} value={form.username || ''} onChange={(e) => set('username', e.target.value)} placeholder="输入用户名" maxLength={16} />
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>离线模式 · UUID 根据用户名自动生成</span>
            </div>
            <button className="btn btn-primary" style={{ fontSize: '13px', padding: '8px 20px' }} onClick={handleLogin} disabled={logging}>
              {logging ? <><span className="spinner" /> 登录中...</> : '🔷 登录微软正版账号'}
            </button>
            {authError && <div style={{ marginTop: '10px', fontSize: '12px', color: 'var(--red)' }}>{authError}</div>}
          </div>
        )}
      </div>

      {/* Java */}
      <div className="card">
        <div className="card-title">Java 配置</div>
        <div className="form-group">
          <label className="form-label">Java 路径</label>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input className="form-input" value={form.javaPath || ''} onChange={(e) => set('javaPath', e.target.value)} placeholder="例：C:\Program Files\Java\jdk-17\bin\java.exe" />
            <button className="btn btn-ghost" style={{ whiteSpace: 'nowrap', fontSize: '12px' }} onClick={handleDetectJava} disabled={detecting}>
              {detecting ? <span className="spinner" /> : '自动检测'}
            </button>
          </div>
        </div>
        {javaList?.length > 0 && (
          <div>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '8px' }}>检测到的 Java：</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {javaList.map((j) => (
                <div key={j.path}
                  style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 10px', background: form.javaPath === j.path ? 'var(--bg-active)' : 'var(--bg-primary)', border: `1px solid ${form.javaPath === j.path ? 'var(--border-accent)' : 'var(--border)'}`, borderRadius: 'var(--radius-sm)', cursor: 'pointer', transition: 'all 0.15s' }}
                  onClick={() => set('javaPath', j.path)}>
                  <span style={{ fontSize: '11px', fontWeight: '700', background: 'var(--accent)', color: '#fff', padding: '1px 6px', borderRadius: '3px', flexShrink: 0 }}>Java {j.major}</span>
                  {j.source === 'cmcl'
                    ? <span style={{ fontSize: '10px', background: 'rgba(22,163,74,0.15)', color: '#16a34a', padding: '1px 5px', borderRadius: '3px', flexShrink: 0 }}>Tick</span>
                    : <span style={{ fontSize: '10px', background: 'rgba(0,0,0,0.06)', color: 'var(--text-muted)', padding: '1px 5px', borderRadius: '3px', flexShrink: 0 }}>系统</span>
                  }
                  <div style={{ flex: 1, overflow: 'hidden' }}>
                    <div style={{ fontSize: '12px' }}>{j.version}</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{j.path}</div>
                  </div>
                  {form.javaPath === j.path && <span style={{ color: 'var(--accent)', flexShrink: 0 }}>✓</span>}
                  {j.source === 'cmcl' && (
                    <button
                      className="btn btn-ghost"
                      style={{ fontSize: '11px', padding: '2px 8px', color: 'var(--red)', flexShrink: 0 }}
                      disabled={deleting === j.major}
                      title="删除 Tick 管理的此 Java"
                      onClick={e => { e.stopPropagation(); handleDeleteJava(j.major); }}>
                      {deleting === j.major
                        ? <span className="spinner" style={{ width: 10, height: 10, borderWidth: '1.5px' }} />
                        : '删除'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
        {javaList?.length === 0 && (
          <div style={{ padding: '10px', background: 'rgba(245,101,101,0.08)', border: '1px solid rgba(245,101,101,0.2)', borderRadius: 'var(--radius-sm)', fontSize: '12px', color: 'var(--red)' }}>
            未检测到 Java。请安装 Java 17+ 后重试（推荐 Eclipse Temurin）
          </div>
        )}
      </div>

      {/* Java download management */}
      <div className="card">
        <div className="card-title">Java 自动下载</div>
        <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '14px', lineHeight: 1.6 }}>
          Tick 可从 Eclipse Adoptium 自动下载 JRE，无需手动安装，下载后自动纳入上方 Java 列表。
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '14px' }}>
          {[
            { major: 8,  desc: '运行 Minecraft 1.16 及更早版本、旧版 Forge/Fabric 服务端' },
            { major: 17, desc: '运行 Minecraft 1.17 – 1.20.4' },
            { major: 21, desc: '运行 Minecraft 1.20.5 及更高版本（最新推荐）' },
          ].map(({ major, desc }) => {
            const isInstalled = javaList?.some(j => j.source === 'cmcl' && j.major === major);
            const isDownloading = downloading === major;
            return (
              <div key={major} style={{
                display: 'flex', alignItems: 'center', gap: '12px',
                padding: '10px 14px',
                background: 'var(--bg-primary)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
              }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '3px' }}>
                    <span style={{ fontSize: '13px', fontWeight: '700', background: 'var(--accent)', color: '#fff', padding: '1px 7px', borderRadius: '3px' }}>Java {major}</span>
                    {isInstalled && <span style={{ fontSize: '10px', color: '#16a34a', fontWeight: 600 }}>✓ 已安装</span>}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{desc}</div>
                </div>
                <button
                  className={isInstalled ? 'btn btn-ghost' : 'btn btn-primary'}
                  style={{ fontSize: '12px', padding: '5px 14px', flexShrink: 0 }}
                  disabled={downloading !== null}
                  onClick={() => handleDownloadJava(major)}>
                  {isDownloading
                    ? <><span className="spinner" style={{ width: 10, height: 10, borderWidth: '1.5px', marginRight: 5 }} />下载中</>
                    : isInstalled ? '重新下载' : '下载'}
                </button>
              </div>
            );
          })}
        </div>

        {downloadProgress && (
          <div style={{
            padding: '10px 14px',
            background: downloadProgress.phase === 'error' ? 'rgba(245,101,101,0.08)' : 'rgba(0,0,0,0.04)',
            border: `1px solid ${downloadProgress.phase === 'error' ? 'rgba(245,101,101,0.20)' : 'rgba(0,0,0,0.08)'}`,
            borderRadius: 'var(--radius-sm)',
          }}>
            <div style={{
              fontSize: '12px', marginBottom: downloadProgress.total > 0 ? '6px' : 0,
              color: downloadProgress.phase === 'error' ? 'var(--red)'
                   : downloadProgress.phase === 'done'  ? '#16a34a'
                   : 'var(--text-secondary)',
            }}>
              {downloadProgress.message}
            </div>
            {downloadProgress.phase === 'download' && downloadProgress.total > 0 && (
              <div style={{ background: 'rgba(0,0,0,0.08)', borderRadius: 4, height: 4, overflow: 'hidden' }}>
                <div style={{
                  height: '100%', background: 'var(--accent)', borderRadius: 4,
                  width: `${Math.min(100, downloadProgress.downloaded / downloadProgress.total * 100).toFixed(1)}%`,
                  transition: 'width 0.3s ease',
                }} />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Game */}
      <div className="card">
        <div className="card-title">游戏配置</div>
        <div className="form-group">
          <label className="form-label">最大内存 (MB)</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <input type="range" min="512" max="16384" step="256" value={form.maxMemory || 2048} onChange={(e) => set('maxMemory', parseInt(e.target.value))} style={{ flex: 1, accentColor: 'var(--accent)' }} />
            <span style={{ minWidth: '70px', textAlign: 'right', fontSize: '14px', fontWeight: '600', color: 'var(--accent)' }}>{form.maxMemory || 2048} MB</span>
          </div>
        </div>

        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label">游戏目录</label>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
            {[
              { value: true,  label: '便携模式', desc: '与启动器同级的 .minecraft 目录（推荐）' },
              { value: false, label: '自定义目录', desc: '手动指定任意路径' },
            ].map((opt) => (
              <div key={String(opt.value)}
                style={{ flex: 1, padding: '10px 14px', background: form.portableMode === opt.value ? 'var(--bg-active)' : 'var(--bg-primary)', border: `1px solid ${form.portableMode === opt.value ? 'var(--border-accent)' : 'var(--border)'}`, borderRadius: 'var(--radius-sm)', cursor: 'pointer', transition: 'all 0.15s' }}
                onClick={() => set('portableMode', opt.value)}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}>
                  {form.portableMode === opt.value && <span style={{ color: 'var(--accent)' }}>✓</span>}
                  <span style={{ fontSize: '13px', fontWeight: '600' }}>{opt.label}</span>
                  {opt.value && <span style={{ fontSize: '10px', background: 'rgba(74,144,226,0.2)', color: 'var(--accent)', padding: '1px 5px', borderRadius: '3px' }}>推荐</span>}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{opt.desc}</div>
              </div>
            ))}
          </div>

          {form.portableMode ? (
            <div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input className="form-input" value={settings?.defaultMinecraftDir || ''} readOnly
                  style={{ color: 'var(--text-muted)', cursor: 'default' }} />
                <button className="btn btn-ghost" style={{ whiteSpace: 'nowrap', fontSize: '12px' }}
                  onClick={() => window.cmcl.openFolder(settings?.defaultMinecraftDir || '')}>
                  打开
                </button>
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '6px' }}>
                目录随启动器位置自动确定，整体搬迁时无需重新配置
              </div>
            </div>
          ) : (
            <div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input className="form-input" value={form.minecraftDir || ''} onChange={(e) => set('minecraftDir', e.target.value)} placeholder="例：D:\Minecraft\.minecraft" />
                <button className="btn btn-ghost" style={{ whiteSpace: 'nowrap', fontSize: '12px' }} onClick={handleSelectDir}>浏览...</button>
                <button className="btn btn-ghost" style={{ whiteSpace: 'nowrap', fontSize: '12px' }}
                  onClick={() => window.cmcl.openFolder(form.minecraftDir || '')}>
                  打开
                </button>
              </div>
              <div style={{ fontSize: '11px', color: 'var(--yellow)', marginTop: '6px' }}>
                注意：切换目录后，已有版本和存档不会自动迁移
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Download */}
      <div className="card">
        <div className="card-title">下载设置</div>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label">下载源</label>
          <div style={{ display: 'flex', gap: '8px' }}>
            {[
              { value: 'bmclapi', label: 'BMCLAPI 镜像', desc: '推荐 · 亚洲速度快' },
              { value: 'mojang', label: 'Mojang 官方', desc: '欧美速度快' },
            ].map((opt) => (
              <div key={opt.value}
                style={{ flex: 1, padding: '12px', background: form.downloadSource === opt.value ? 'var(--bg-active)' : 'var(--bg-primary)', border: `1px solid ${form.downloadSource === opt.value ? 'var(--border-accent)' : 'var(--border)'}`, borderRadius: 'var(--radius-sm)', cursor: 'pointer', transition: 'all 0.15s' }}
                onClick={() => set('downloadSource', opt.value)}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                  {form.downloadSource === opt.value && <span style={{ color: 'var(--accent)' }}>✓</span>}
                  <span style={{ fontSize: '13px', fontWeight: '600' }}>{opt.label}</span>
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{opt.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '4px' }}>
        <button className="btn btn-primary" style={{ padding: '9px 24px' }} onClick={handleSave}>保存设置</button>
        {saved && <span style={{ fontSize: '13px', color: 'var(--accent-green)' }}>✓ 已保存</span>}
      </div>
    </div>
  );
}
