import React from 'react';
import { useApp } from '../context/AppContext';

const styles = {
  bar: {
    height: 'var(--titlebar-height)',
    background: 'var(--glass-titlebar)',
    backdropFilter: 'blur(16px)',
    WebkitBackdropFilter: 'blur(16px)',
    borderBottom: '1px solid var(--glass-border)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    WebkitAppRegion: 'drag',
    flexShrink: 0,
    padding: '0 12px',
  },
  logo: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontFamily: 'var(--font-pixel)',
    fontSize: '17px',       /* VT323 17px ≈ 普通字体 13px 视觉大小 */
    fontWeight: '400',
    color: 'var(--accent)',
    letterSpacing: '2px',
  },
  logoIcon: {
    width: '18px',
    height: '18px',
    background: 'var(--accent)',
    borderRadius: '4px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '10px',
    color: '#fff',
    fontFamily: 'var(--font-pixel)',
    fontWeight: '400',
    letterSpacing: '0',
  },
  controls: {
    display: 'flex',
    gap: '4px',
    WebkitAppRegion: 'no-drag',
  },
  btn: {
    width: '28px',
    height: '22px',
    border: 'none',
    borderRadius: '4px',
    background: 'transparent',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '12px',
    color: 'var(--text-secondary)',
    transition: 'all 0.15s',
  },
};

export default function TitleBar() {
  const { theme, toggleTheme } = useApp();
  return (
    <div style={styles.bar}>
      <div style={styles.logo}>
        <div style={styles.logoIcon}>C</div>
        Tick
        <span style={{
          marginLeft: '8px', fontSize: '11px',
          color: 'var(--text-muted)', fontFamily: 'inherit',
          letterSpacing: '0', fontWeight: '400',
          WebkitAppRegion: 'no-drag',
        }}>
          built {new Date(__BUILD_TIME__).toLocaleString('zh-CN', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit' })}
        </span>
        <button
          style={{
            ...styles.btn,
            marginLeft: '10px',
            fontSize: '14px',
            WebkitAppRegion: 'no-drag',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
          onClick={toggleTheme}
          title={theme === 'light' ? '切换到暗色主题' : '切换到亮色主题'}
        >
          {theme === 'light' ? '☀️' : '🌙'}
        </button>
      </div>
      <div style={styles.controls}>
        <button
          style={styles.btn}
          onMouseEnter={(e) => { e.target.style.background = 'var(--bg-hover)'; e.target.style.color = 'var(--text-primary)'; }}
          onMouseLeave={(e) => { e.target.style.background = 'transparent'; e.target.style.color = 'var(--text-secondary)'; }}
          onClick={() => window.cmcl?.minimize()}
          title="最小化"
        >─</button>
        <button
          style={styles.btn}
          onMouseEnter={(e) => { e.target.style.background = 'var(--bg-hover)'; e.target.style.color = 'var(--text-primary)'; }}
          onMouseLeave={(e) => { e.target.style.background = 'transparent'; e.target.style.color = 'var(--text-secondary)'; }}
          onClick={() => window.cmcl?.maximize()}
          title="最大化"
        >□</button>
        <button
          style={styles.btn}
          onMouseEnter={(e) => { e.target.style.background = '#c0392b'; e.target.style.color = '#fff'; }}
          onMouseLeave={(e) => { e.target.style.background = 'transparent'; e.target.style.color = 'var(--text-secondary)'; }}
          onClick={() => window.cmcl?.close()}
          title="关闭"
        >✕</button>
      </div>
    </div>
  );
}
