import React, { useState, useEffect, useRef } from 'react';
import { SftpFile } from '../global';
import { showToast, showConfirm } from './Dialogs';

interface SftpExplorerProps {
  tabId: string;
  isConnected: boolean;
  onRefreshTrigger?: number;
}

// ─── Inline prompt dialog ────────────────────────────────────────────────────
interface InlinePromptProps {
  title: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

const InlinePrompt: React.FC<InlinePromptProps> = ({
  title, placeholder, defaultValue = '', confirmLabel = 'CREATE', onConfirm, onCancel
}) => {
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') onConfirm(value);
    else if (e.key === 'Escape') onCancel();
  };

  return (
    <div className="modal-overlay" style={{ zIndex: 2000 }}>
      <div className="modal-box" style={{ maxWidth: '380px' }}>
        <div className="modal-header">
          <span>{title}</span>
          <button className="modal-close-btn" onClick={onCancel}>×</button>
        </div>
        <div className="form-group" style={{ marginBottom: '0' }}>
          <input
            ref={inputRef}
            type="text"
            placeholder={placeholder}
            value={value}
            onChange={e => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
          />
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onCancel}>CANCEL</button>
          <button className="btn btn-primary" onClick={() => onConfirm(value)}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
};

// ─── SFTP Explorer ───────────────────────────────────────────────────────────
export const SftpExplorer: React.FC<SftpExplorerProps> = ({ tabId, isConnected, onRefreshTrigger }) => {
  const [currentPath, setCurrentPath] = useState('/');
  const [files, setFiles] = useState<SftpFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showMkdirPrompt, setShowMkdirPrompt] = useState(false);
  const [renameTarget, setRenameTarget] = useState<SftpFile | null>(null);
  const [progress, setProgress] = useState<{ percent: number; file: string; type: string } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; file: SftpFile } | null>(null);

  // Listen for transfer progress
  useEffect(() => {
    const cleanup = window.api.onTransferProgress((data) => {
      if (data.tabId === tabId) {
        setProgress({ percent: data.percent, file: data.file, type: data.type });
        if (data.percent >= 100) setTimeout(() => setProgress(null), 1000);
      }
    });
    return cleanup;
  }, [tabId]);

  // Close context menu on click
  useEffect(() => {
    const handler = () => setContextMenu(null);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, []);

  const loadDirectory = async (pathStr: string) => {
    if (!isConnected) return;
    setLoading(true);
    setError(null);
    try {
      const response = await window.api.sftpList(tabId, pathStr);
      if (response.success && response.list) {
        setFiles(response.list);
        setCurrentPath(pathStr);
      } else {
        setError(response.error || 'Failed to list directory');
      }
    } catch (err: any) {
      setError(err.message || 'Error occurred');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isConnected) {
      loadDirectory('/');
    } else {
      setFiles([]);
    }
  }, [isConnected, tabId]);

  useEffect(() => {
    if (isConnected && onRefreshTrigger) {
      loadDirectory(currentPath);
    }
  }, [onRefreshTrigger]);

  const handleNavigate = (file: SftpFile) => {
    if (!file.isDir) return;
    const newPath = currentPath === '/' 
      ? `/${file.name}` 
      : `${currentPath.endsWith('/') ? currentPath : currentPath + '/'}${file.name}`;
    loadDirectory(newPath);
  };

  const handleGoUp = () => {
    if (currentPath === '/') return;
    const parts = currentPath.split('/').filter(Boolean);
    parts.pop();
    const newPath = '/' + parts.join('/');
    loadDirectory(newPath);
  };

  const handleDownload = async (file: SftpFile, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setContextMenu(null);
    const remoteFilePath = currentPath === '/'
      ? `/${file.name}`
      : `${currentPath.endsWith('/') ? currentPath : currentPath + '/'}${file.name}`;
    setLoading(true);
    try {
      const res = await window.api.sftpDownload(tabId, remoteFilePath, file.name);
      if (res.success) showToast(`Downloaded to ${res.localPath}`, 'success');
      else if (!res.aborted) showToast(`Error: ${res.error}`, 'error');
    } catch (err: any) { showToast(`Error: ${err.message}`, 'error'); }
    finally { setLoading(false); }
  };

  const handleCopyPath = (file: SftpFile) => {
    setContextMenu(null);
    const remoteFilePath = currentPath === '/'
      ? `/${file.name}`
      : `${currentPath.endsWith('/') ? currentPath : currentPath + '/'}${file.name}`;
    navigator.clipboard.writeText(remoteFilePath);
  };

  const handleCopyName = (file: SftpFile) => {
    setContextMenu(null);
    navigator.clipboard.writeText(file.name);
  };

  const handleUpload = async () => {
    setLoading(true);
    try {
      const res = await window.api.sftpUpload(tabId, currentPath);
      if (res.success) {
        loadDirectory(currentPath);
      } else if (!res.aborted) {
        showToast(`ERROR: ${res.error}`, 'error');
      }
    } catch (err: any) {
      showToast(`ERROR: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (file: SftpFile, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setContextMenu(null);
    const ok = await showConfirm({
      title: 'DELETE',
      message: `Delete "${file.name}"? This cannot be undone.`,
      confirmLabel: 'DELETE'
    });
    if (!ok) return;
    const remoteFilePath = currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`;
    setLoading(true);
    try {
      const res = await window.api.sftpDelete(tabId, remoteFilePath, file.isDir);
      if (res.success) loadDirectory(currentPath);
      else showToast(`Error: ${res.error}`, 'error');
    } catch (err: any) { showToast(`Error: ${err.message}`, 'error'); }
    finally { setLoading(false); }
  };

  const handleCreateDir = () => {
    setShowMkdirPrompt(true);
  };

  const handleMkdirConfirm = async (dirName: string) => {
    setShowMkdirPrompt(false);
    if (!dirName.trim()) return;
    const remoteDirPath = currentPath === '/' 
      ? `/${dirName.trim()}` 
      : `${currentPath.endsWith('/') ? currentPath : currentPath + '/'}${dirName.trim()}`;

    setLoading(true);
    try {
      const res = await window.api.sftpCreateDir(tabId, remoteDirPath);
      if (res.success) {
        loadDirectory(currentPath);
      } else {
        showToast(`ERROR: ${res.error}`, 'error');
      }
    } catch (err: any) {
      showToast(`ERROR: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleMkdirCancel = () => {
    setShowMkdirPrompt(false);
  };

  // Rename is a same-directory operation: only a bare name is accepted, so a
  // typed "/" cannot silently move the entry somewhere else on the server.
  const handleRenameConfirm = async (newName: string) => {
    const target = renameTarget;
    setRenameTarget(null);
    const trimmed = newName.trim();
    if (!target || !trimmed || trimmed === target.name) return;
    if (trimmed.includes('/')) {
      showToast('ERROR: name must not contain "/"', 'error');
      return;
    }

    const base = currentPath.endsWith('/') ? currentPath : currentPath + '/';
    const oldPath = currentPath === '/' ? `/${target.name}` : `${base}${target.name}`;
    const newPath = currentPath === '/' ? `/${trimmed}` : `${base}${trimmed}`;

    setLoading(true);
    try {
      const res = await window.api.sftpRename(tabId, oldPath, newPath);
      if (res.success) loadDirectory(currentPath);
      else showToast(`ERROR: ${res.error}`, 'error');
    } catch (err: any) {
      showToast(`ERROR: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  // Helper to format file size
  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  };

  return (
    <div className="sftp-explorer" style={{ width: '100%' }}>
      {showMkdirPrompt && (
        <InlinePrompt
          title="CREATE FOLDER"
          placeholder="Enter folder name..."
          onConfirm={handleMkdirConfirm}
          onCancel={handleMkdirCancel}
        />
      )}

      {renameTarget && (
        <InlinePrompt
          title="RENAME"
          placeholder="Enter new name..."
          defaultValue={renameTarget.name}
          confirmLabel="RENAME"
          onConfirm={handleRenameConfirm}
          onCancel={() => setRenameTarget(null)}
        />
      )}

      <div className="panel-header">
        <span className="panel-title">SFTP EXPLORER</span>
        <span className="panel-actions">
          <button className="action-btn-small" onClick={handleUpload} disabled={loading || !isConnected}>UPLOAD</button>
          <button className="action-btn-small" onClick={handleCreateDir} disabled={loading || !isConnected}>MKDIR</button>
          <button className="action-btn-small" onClick={() => loadDirectory(currentPath)} disabled={loading || !isConnected}>REFRESH</button>
        </span>
      </div>

      <div className="sftp-path-bar">
        <button className="action-btn-small" onClick={handleGoUp} disabled={currentPath === '/' || loading || !isConnected}>
          ↑ UP
        </button>
        <input
          type="text"
          className="sftp-path-input"
          value={currentPath}
          onChange={(e) => setCurrentPath(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              loadDirectory(currentPath);
            }
          }}
          disabled={!isConnected}
        />
      </div>

      {/* Progress bar */}
      {progress && (
        <div style={{ padding: '4px 8px', borderBottom: '1px solid var(--gray-300)' }}>
          <div style={{ fontSize: '11px', color: 'var(--gray-700)', marginBottom: '2px' }}>
            {progress.type === 'upload' ? '↑' : '↓'} {progress.file} — {progress.percent}%
          </div>
          <div style={{ width: '100%', height: '3px', background: 'var(--gray-200)' }}>
            <div style={{
              width: `${progress.percent}%`,
              height: '100%',
              background: 'var(--fg)',
              transition: 'width 0.2s'
            }} />
          </div>
        </div>
      )}

      <div
        className="sftp-list-container"
        onDragOver={(e) => { e.preventDefault(); e.currentTarget.style.background = 'var(--gray-100)'; }}
        onDragLeave={(e) => { e.currentTarget.style.background = ''; }}
        onDrop={async (e) => {
          e.preventDefault();
          e.currentTarget.style.background = '';
          if (!isConnected) return;
          const files = Array.from(e.dataTransfer.files);
          for (const file of files) {
            // Electron 32 removed File.path; the absolute path is resolved in
            // the preload through webUtils.getPathForFile (see preload.js).
            const localPath = window.api.getPathForFile(file);
            if (!localPath) {
              showToast(`ERROR: cannot resolve local path for ${file.name}`, 'error');
              continue;
            }
            const targetRemotePath = currentPath === '/'
              ? `/${file.name}`
              : `${currentPath.endsWith('/') ? currentPath : currentPath + '/'}${file.name}`;
            setLoading(true);
            try {
              const res = await window.api.sftpUploadFile(tabId, localPath, targetRemotePath);
              if (res.success) {
                loadDirectory(currentPath);
              } else {
                showToast(`ERROR: ${res.error}`, 'error');
              }
            } catch (err: any) {
              showToast(`ERROR: ${err.message}`, 'error');
            } finally {
              setLoading(false);
            }
          }
        }}
      >
        {loading && <div style={{ padding: '10px', color: 'var(--gray-600)' }}>LOADING REMOTE FILES...</div>}
        {error && <div className="alert alert-error">{error}</div>}

        {!loading && !error && files.length === 0 && (
          <div style={{ padding: '10px', color: 'var(--gray-400)', fontSize: '12px' }}>EMPTY DIRECTORY</div>
        )}

        {!loading && !error && files.map((file) => {
          const handleContextMenu = (e: React.MouseEvent) => {
            e.preventDefault();
            setContextMenu({ x: e.clientX, y: e.clientY, file });
          };
          return (
          <div 
            key={file.name} 
            className="sftp-item"
            onDoubleClick={() => handleNavigate(file)}
            onContextMenu={handleContextMenu}
          >
            <span className="icon" style={{ minWidth: '40px', fontSize: '11px', color: 'var(--gray-600)' }}>
              {file.isDir ? 'DIR' : 'FILE'}
            </span>
            <span className="sftp-item-name" title={file.name}>
              {file.name}
            </span>
            {!file.isDir && (
              <span className="sftp-item-size">
                {formatSize(file.size)}
              </span>
            )}
            <span className="sftp-item-actions">
              {file.isDir ? (
                <>
                  <button className="action-btn-small" onClick={() => handleNavigate(file)}>OPEN</button>
                  <button className="action-btn-small btn-danger" onClick={(e) => handleDelete(file, e)}>DEL</button>
                </>
              ) : (
                <>
                  <button className="action-btn-small" onClick={(e) => handleDownload(file, e)}>GET</button>
                  <button className="action-btn-small btn-danger" onClick={(e) => handleDelete(file, e)}>DEL</button>
                </>
              )}
            </span>
          </div>
          );
        })}
      </div>

      {/* Status bar */}
      <div style={{ padding: '4px 8px', borderTop: '1px solid var(--gray-300)', fontSize: '11px', color: 'var(--gray-600)' }}>
        {files.filter(f => f.isDir).length} dirs, {files.filter(f => !f.isDir).length} files
        {files.reduce((acc, f) => acc + (f.size || 0), 0) > 0
          && ` — ${formatSize(files.reduce((acc, f) => acc + (f.size || 0), 0))}`}
      </div>

      {/* Context menu */}
      {contextMenu && (() => {
        const menuWidth = 160;
        const menuHeight = 200;
        let x = contextMenu.x;
        let y = contextMenu.y;
        if (x + menuWidth > window.innerWidth) x = window.innerWidth - menuWidth - 10;
        if (y + menuHeight > window.innerHeight) y = window.innerHeight - menuHeight - 10;
        return (
          <div className="context-menu" style={{ left: x, top: y }}>
            {!contextMenu.file.isDir && (
              <button className="context-menu-item"
                onClick={() => { setContextMenu(null); handleDownload(contextMenu.file); }}>DOWNLOAD</button>
            )}
            <button className="context-menu-item"
              onClick={() => { setContextMenu(null); handleCopyPath(contextMenu.file); }}>COPY PATH</button>
            <button className="context-menu-item"
              onClick={() => { const file = contextMenu.file; setContextMenu(null); setRenameTarget(file); }}>RENAME</button>
            <button className="context-menu-item"
              onClick={() => { setContextMenu(null); handleCopyName(contextMenu.file); }}>COPY NAME</button>
            <div className="context-menu-divider" />
            <button className="context-menu-item context-menu-item-danger"
              onClick={() => { setContextMenu(null); handleDelete(contextMenu.file); }}>DELETE</button>
          </div>
        );
      })()}
    </div>
  );
};