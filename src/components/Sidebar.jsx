import React from 'react';
import { useApp } from '../context/AppContext';

const NAV_ITEMS = [
  { id: 'home',     label: '主页',   icon: '⌂' },
  { id: 'versions', label: '版本管理', icon: '◫' },
  { id: 'download', label: '下载',   icon: '↓' },
  { id: 'mods',     label: '模组',   icon: '⊞' },
  { id: 'server',   label: '服务器', icon: '⬡' },
  { id: 'settings', label: '设置',   icon: '⚙' },
];

const styles = {
  sidebar: {
    width: 'var(--sidebar-width)',
    background: 'var(--glass-sidebar)',
    backdropFilter: 'blur(16px)',
    WebkitBackdropFilter: 'blur(16px)',
    borderRight: '1px solid var(--glass-border)',
    display: 'flex',
    flexDirection: 'column',
    padding: '12px 8px',
    flexShrink: 0,
  },
  navItem: (active) => ({
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '10px 12px',
    borderRadius: 'var(--radius-sm)',
    cursor: 'pointer',
    transition: 'all 0.15s',
    color: active ? 'var(--accent)' : 'var(--text-secondary)',
    background: active ? 'var(--bg-active)' : 'transparent',
    fontSize: '13px',
    fontWeight: active ? '600' : '400',
    border: active ? '1px solid rgba(74,144,226,0.18)' : '1px solid transparent',
    width: '100%',
    textAlign: 'left',
    marginBottom: '2px',
  }),
  icon: { width: '20px', textAlign: 'center', fontSize: '16px' },
  versionLabel: {
    fontFamily: 'var(--font-pixel)',
    fontSize: '13px',
    color: 'var(--text-muted)',
    textAlign: 'center',
    padding: '8px',
    letterSpacing: '1px',
  },
};

export default function Sidebar() {
  const { page, setPage } = useApp();
  return (
    <aside style={styles.sidebar}>
      {NAV_ITEMS.map((item) => (
        <button
          key={item.id}
          style={styles.navItem(page === item.id)}
          onClick={() => setPage(item.id)}
          onMouseEnter={(e) => {
            if (page !== item.id) {
              e.currentTarget.style.background = 'var(--bg-hover)';
              e.currentTarget.style.borderColor = 'var(--glass-border)';
            }
          }}
          onMouseLeave={(e) => {
            if (page !== item.id) {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.borderColor = 'transparent';
            }
          }}
        >
          <span style={styles.icon}>{item.icon}</span>
          {item.label}
        </button>
      ))}
      <div style={{ flex: 1 }} />
      {/* v1.0.0 用像素字体，纯 ASCII 字符，VT323 生效 */}
      <div style={styles.versionLabel}>v1.0.0</div>
    </aside>
  );
}
