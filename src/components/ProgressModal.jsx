import React from 'react';
import { useApp } from '../context/AppContext';

export default function ProgressModal() {
  const { isDownloading, downloadState } = useApp();

  if (!isDownloading || !downloadState) return null;

  const { stage, completed, total, detail } = downloadState;
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
  const isDone = stage === '下载完成';

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0,0,0,0.7)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
      backdropFilter: 'blur(4px)',
    }}>
      <div style={{
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        padding: '32px',
        width: '420px',
        boxShadow: '0 20px 60px var(--shadow)',
      }}>
        <div style={{ fontSize: '16px', fontWeight: '600', marginBottom: '8px', color: 'var(--text-primary)' }}>
          {isDone ? '✓ 下载完成' : '正在下载...'}
        </div>
        <div style={{ fontSize: '13px', color: 'var(--accent)', marginBottom: '20px', fontWeight: '500' }}>
          {stage}
        </div>

        {/* Progress bar */}
        <div style={{
          background: 'var(--bg-primary)',
          borderRadius: '4px',
          height: '6px',
          overflow: 'hidden',
          marginBottom: '10px',
        }}>
          <div style={{
            width: total > 0 ? `${percent}%` : '0%',
            height: '100%',
            background: isDone ? 'var(--accent-green)' : 'var(--accent)',
            borderRadius: '4px',
            transition: 'width 0.2s ease',
          }} />
        </div>

        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: '12px',
          color: 'var(--text-secondary)',
          marginBottom: '12px',
        }}>
          <span>{total > 0 ? `${completed} / ${total}` : '准备中...'}</span>
          <span>{total > 0 ? `${percent}%` : ''}</span>
        </div>

        {detail && (
          <div style={{
            fontSize: '11px',
            color: 'var(--text-muted)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {detail}
          </div>
        )}
      </div>
    </div>
  );
}
