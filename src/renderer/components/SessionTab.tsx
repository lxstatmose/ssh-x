import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SftpExplorer } from './SftpExplorer';
import { FtpExplorer } from './FtpExplorer';
import { CustomSelect } from './CustomSelect';
import { SshConfig } from '../global';

interface PanelState {
  id: string;
  type: 'ssh' | 'ftp' | 'telnet' | 'local' | 'new';
  config?: SshConfig;
}

interface SessionTabProps {
  tabId: string;
  panels: PanelState[];
  isActive: boolean;
  savedSessions?: SshConfig[];
  splitDirections?: ('horizontal' | 'vertical')[];
  onClosePanel: (panelId: string) => void;
  onLaunchSsh?: (panelId: string, config: SshConfig) => void;
  onLaunchLocal?: (panelId: string) => void;
  onSaveSession?: (config: SshConfig) => void;
}

// ─── Build rows of panels based on split directions ──────────────────────────
// panels: [p0, p1, p2, p3, ...]
// splitDirs: [dir0, dir1, dir2, ...] — direction used to add panel N (for N >= 1)
//   'horizontal' → add to same row
//   'vertical' → start new row
function buildRows(
  panels: PanelState[],
  splitDirs: ('horizontal' | 'vertical')[]
): PanelState[][] {
  if (panels.length === 0) return [];
  if (panels.length === 1) return [[panels[0]]];

  const rows: PanelState[][] = [[panels[0]]];

  for (let i = 1; i < panels.length; i++) {
    const dir = splitDirs[i - 1] || 'horizontal';
    if (dir === 'vertical') {
      // Start a new row
      rows.push([panels[i]]);
    } else {
      // Add to the last row
      rows[rows.length - 1].push(panels[i]);
    }
  }

  return rows;
}

// ─── Render a single panel (either new picker or terminal) ───────────────────
const PanelContent: React.FC<{
  panel: PanelState;
  showCloseBtn: boolean;
  onClose: () => void;
  savedSessions: SshConfig[];
  onLaunchSsh: (config: SshConfig) => void;
  onLaunchLocal: () => void;
  onSaveSession?: (config: SshConfig) => void;
  isActiveTab: boolean;
}> = ({ panel, showCloseBtn, onClose, savedSessions, onLaunchSsh, onLaunchLocal, onSaveSession, isActiveTab }) => {
  if (panel.type === 'new') {
    return (
      <NewPanelPicker
        savedSessions={savedSessions}
        showCloseBtn={showCloseBtn}
        onClose={onClose}
        onLaunchSsh={onLaunchSsh}
        onLaunchLocal={onLaunchLocal}
      />
    );
  }
  return (
    <SinglePanel
      panelId={panel.id}
      type={panel.type}
      config={panel.config}
      isActiveTab={isActiveTab}
      onClose={onClose}
      showCloseBtn={showCloseBtn}
      onSaveSession={onSaveSession}
    />
  );
};

// ─── SessionTab main component ───────────────────────────────────────────────
export const SessionTab: React.FC<SessionTabProps> = ({
  panels, isActive, savedSessions = [],
  splitDirections = [],
  onClosePanel, onLaunchSsh, onLaunchLocal, onSaveSession
}) => {
  const rows = buildRows(panels, splitDirections);

  return (
    <div
      className="session-panel-container"
      style={{ display: isActive ? 'flex' : 'none' }}
    >
      <div className="split-layout" style={{ flexDirection: 'column' }}>
        {rows.map((row, rowIdx) => (
          <React.Fragment key={`row-${rowIdx}`}>
            {rowIdx > 0 && (
              <div
                className="split-divider"
                style={{ width: '100%', height: '3px', cursor: 'row-resize', flexShrink: 0 }}
              />
            )}
            <div
              className="split-pane"
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'row',
                overflow: 'hidden',
                minHeight: '80px',
              }}
            >
              {row.map((panel, panelIdx) => (
                <React.Fragment key={panel.id}>
                  {panelIdx > 0 && (
                    <div
                      className="split-divider"
                      style={{ height: '100%', width: '3px', cursor: 'col-resize', flexShrink: 0 }}
                    />
                  )}
                  <div
                    className="split-pane"
                    style={{ flex: 1, overflow: 'hidden', minWidth: '100px' }}
                  >
                    <PanelContent
                      panel={panel}
                      showCloseBtn={panels.length > 1}
                      onClose={() => onClosePanel(panel.id)}
                      savedSessions={savedSessions}
                      onLaunchSsh={(config) => onLaunchSsh?.(panel.id, config)}
                      onLaunchLocal={() => onLaunchLocal?.(panel.id)}
                      onSaveSession={onSaveSession}
                      isActiveTab={isActive}
                    />
                  </div>
                </React.Fragment>
              ))}
            </div>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
};

// ─── Inline picker rendered inside a new split pane ─────────────────────────
const emptyConn: SshConfig = {
  host: '', port: '22', username: '',
  authMethod: 'password', password: '', keyPath: '', passphrase: '', name: ''
};

interface NewPanelPickerProps {
  savedSessions: SshConfig[];
  showCloseBtn: boolean;
  onClose: () => void;
  onLaunchSsh: (config: SshConfig) => void;
  onLaunchLocal: () => void;
}

const NewPanelPicker: React.FC<NewPanelPickerProps> = ({
  savedSessions, showCloseBtn, onClose, onLaunchSsh, onLaunchLocal
}) => {
  const [form, setForm] = useState<SshConfig>({ ...emptyConn });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#000000', overflow: 'hidden' }}>
      <div className="panel-header">
        <span className="panel-title">[NEW PANEL]</span>
        {showCloseBtn && (
          <button className="action-btn-small btn-danger" onClick={onClose}>CLOSE</button>
        )}
      </div>

      <div className="split-picker-scroll" style={{ flex: 1, overflowY: 'auto', padding: '12px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {savedSessions.length > 0 && (
          <div>
            <div style={{ fontWeight: 'bold', marginBottom: '8px', borderBottom: '1px solid var(--gray-300)', paddingBottom: '4px', fontSize: '12px', color: 'var(--gray-700)' }}>
              SAVED SESSIONS
            </div>
            {savedSessions.map(sess => (
              <div
                key={sess.id}
                className="sftp-item"
                style={{ cursor: 'pointer' }}
                onClick={() => onLaunchSsh(sess)}
              >
                <span style={{ minWidth: '55px', fontSize: '11px', color: 'var(--gray-600)', flexShrink: 0 }}>
                  {(sess.protocol || 'ssh').toUpperCase()}
                </span>
                <span className="sftp-item-name">
                  {sess.name || `${sess.username}@${sess.host}:${sess.port}`}
                </span>
                <button
                  className="action-btn-small"
                  onClick={(e) => { e.stopPropagation(); onLaunchSsh(sess); }}
                  style={{ marginLeft: '8px', flexShrink: 0 }}
                >
                  OPEN
                </button>
              </div>
            ))}
          </div>
        )}

        <div>
          <div style={{ fontWeight: 'bold', marginBottom: '8px', borderBottom: '1px solid var(--gray-300)', paddingBottom: '4px', fontSize: '12px', color: 'var(--gray-700)' }}>
            LOCAL MACHINE
          </div>
          <button className="btn btn-ghost" onClick={onLaunchLocal}>
            OPEN LOCAL TERMINAL
          </button>
        </div>

        <div>
          <div style={{ fontWeight: 'bold', marginBottom: '8px', borderBottom: '1px solid var(--gray-300)', paddingBottom: '4px', fontSize: '12px', color: 'var(--gray-700)' }}>
            QUICK CONNECT SSH
          </div>

          <div className="form-group">
            <label>HOST</label>
            <input
              type="text" placeholder="192.168.1.50"
              value={form.host}
              onChange={e => setForm(p => ({ ...p, host: e.target.value }))}
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>PORT</label>
              <input
                type="number" placeholder="22"
                value={form.port}
                onChange={e => setForm(p => ({ ...p, port: e.target.value }))}
              />
            </div>
            <div className="form-group">
              <label>USER</label>
              <input
                type="text" placeholder="root"
                value={form.username}
                onChange={e => setForm(p => ({ ...p, username: e.target.value }))}
              />
            </div>
          </div>

          <div className="form-group">
            <label>AUTH</label>
            <CustomSelect
              value={form.authMethod}
              options={[
                { value: 'password', label: 'PASSWORD' },
                { value: 'key', label: 'SSH KEY' },
              ]}
              onChange={(v) => setForm(p => ({ ...p, authMethod: v as 'password' | 'key' }))}
            />
          </div>

          {form.authMethod === 'password' ? (
            <div className="form-group">
              <label>PASSWORD</label>
              <input
                type="password" placeholder="••••••••"
                value={form.password || ''}
                onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
              />
            </div>
          ) : (
            <div className="form-group">
              <label>KEY PATH</label>
              <input
                type="text" placeholder="/Users/name/.ssh/id_rsa"
                value={form.keyPath || ''}
                onChange={e => setForm(p => ({ ...p, keyPath: e.target.value }))}
              />
            </div>
          )}

          <button
            className="btn btn-primary"
            style={{ marginTop: '8px' }}
            onClick={() => {
              if (!form.host || !form.username) { alert('Host and Username are required'); return; }
              onLaunchSsh(form);
            }}
          >
            CONNECT
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Prompt dialog component ─────────────────────────────────────────────────
interface PromptDialogProps {
  title: string;
  placeholder?: string;
  defaultValue?: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

const PromptDialog: React.FC<PromptDialogProps> = ({ title, placeholder, defaultValue, onConfirm, onCancel }) => {
  const [value, setValue] = useState(defaultValue || '');
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
      <div className="modal-box" style={{ maxWidth: '400px' }}>
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
          <button className="btn btn-primary" onClick={() => onConfirm(value)}>OK</button>
        </div>
      </div>
    </div>
  );
};

// ─── Real terminal panel ─────────────────────────────────────────────────────
interface SinglePanelProps {
  panelId: string;
  type: 'ssh' | 'ftp' | 'telnet' | 'local';
  config?: SshConfig;
  isActiveTab: boolean;
  onClose: () => void;
  showCloseBtn: boolean;
  onSaveSession?: (config: SshConfig) => void;
}

const SinglePanel: React.FC<SinglePanelProps> = ({ panelId, type, config, isActiveTab, onClose, showCloseBtn, onSaveSession }) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const termInstanceRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  const [connectionId, setConnectionId] = useState<string>('');
  const [isConnected, setIsConnected] = useState(false);
  // Start as "connecting": the connection effect (which sets this) runs after
  // first paint, and the disconnected overlay below must not flash for a frame
  const [isConnecting, setIsConnecting] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Bumping this re-runs the connection effect (fresh connId + terminal)
  // without remounting the panel - the RECONNECT button increments it.
  const [reconnectKey, setReconnectKey] = useState(0);
  const [showSftp, setShowSftp] = useState(type === 'ssh' || type === 'ftp');
  const [sftpWidth, setSftpWidth] = useState(250);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [showSavePrompt, setShowSavePrompt] = useState(false);
  const [termContextMenu, setTermContextMenu] = useState<{ x: number; y: number } | null>(null);

  // Close context menu on click
  useEffect(() => {
    const handler = () => setTermContextMenu(null);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, []);

  const isResizingRef = useRef(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(250);

  // Use refs for resize handlers to avoid stale closures in document event listeners
  const handleMouseMoveRef = useRef<(e: MouseEvent) => void>(() => {});
  const stopResizingRef = useRef<() => void>(() => {});

  const startResizing = (e: React.MouseEvent) => {
    e.preventDefault();
    isResizingRef.current = true;
    startXRef.current = e.clientX;
    startWidthRef.current = sftpWidth;
    document.addEventListener('mousemove', handleMouseMoveRef.current);
    document.addEventListener('mouseup', stopResizingRef.current);
  };

  // Update handler refs on every render so they always see current state/closures
  handleMouseMoveRef.current = (e: MouseEvent) => {
    if (!isResizingRef.current) return;
    const delta = e.clientX - startXRef.current;
    let newWidth = startWidthRef.current + delta;
    if (newWidth < 120) newWidth = 120;
    if (newWidth > 600) newWidth = 600;
    setSftpWidth(newWidth);
  };

  stopResizingRef.current = () => {
    isResizingRef.current = false;
    document.removeEventListener('mousemove', handleMouseMoveRef.current);
    document.removeEventListener('mouseup', stopResizingRef.current);
    if (connectionId) {
      setTimeout(() => fitAndResize(connectionId), 50);
    }
  };

  // Helper: send terminal size to the correct backend based on connection type
  const sendResize = (connId: string, cols: number, rows: number) => {
    if (type === 'ssh') window.api.resizeSsh(connId, cols, rows);
    else if (type === 'telnet') window.api.resizeTelnet(connId, cols, rows);
    else if (type === 'local') window.api.resizeLocalPty(connId, cols, rows);
    // FTP has no terminal resize
  };

  // Helper: fit terminal and send new size to backend
  const fitAndResize = (connId: string) => {
    if (!fitAddonRef.current || !termInstanceRef.current) return;
    fitAddonRef.current.fit();
    sendResize(connId, termInstanceRef.current.cols, termInstanceRef.current.rows);
  };

  useEffect(() => {
    const handleResize = () => {
      if (isActiveTab && connectionId) {
        fitAndResize(connectionId);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [isActiveTab, connectionId, type]);

  useEffect(() => {
    if (isActiveTab && connectionId) {
      fitAndResize(connectionId);
      // Focus terminal after SFTP panel resize
      termInstanceRef.current?.focus();
    }
  }, [sftpWidth]);

  // Refit terminal when this tab becomes active
  useEffect(() => {
    if (isActiveTab && connectionId) {
      const timer = setTimeout(() => {
        fitAndResize(connectionId);
        // Focus terminal when tab becomes active
        termInstanceRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isActiveTab, connectionId, type]);

  // ResizeObserver: refit terminal when container size changes
  useEffect(() => {
    if (!isActiveTab || !terminalRef.current || !connectionId) return;

    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const observer = new ResizeObserver(() => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => fitAndResize(connectionId), 100);
    });

    observer.observe(terminalRef.current);
    return () => {
      observer.disconnect();
      if (resizeTimer) clearTimeout(resizeTimer);
    };
  }, [isActiveTab, connectionId, type]);

  const handleTermContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setTermContextMenu({ x: e.clientX, y: e.clientY });
  };

  // Focus terminal when clicking on terminal container
  const handleTerminalClick = () => {
    termInstanceRef.current?.focus();
  };

  const handleTermMenuCopy = () => {
    setTermContextMenu(null);
    const selection = termInstanceRef.current?.getSelection();
    if (selection) {
      navigator.clipboard.writeText(selection);
    }
  };

  const handleTermMenuPaste = async () => {
    setTermContextMenu(null);
    try {
      const text = await navigator.clipboard.readText();
      if (text && termInstanceRef.current) {
        // Send pasted text based on connection type
        if (type === 'ssh') {
          window.api.writeSshData(connectionId, text);
        } else if (type === 'ftp') {
          window.api.sendFtpCommand(connectionId, text);
        } else if (type === 'telnet') {
          window.api.sendTelnetData(connectionId, text);
        } else {
          window.api.writeLocalPtyData(connectionId, text);
        }
      }
    } catch {
      // Clipboard access denied
    }
  };

  const handleTermMenuSelectAll = () => {
    setTermContextMenu(null);
    termInstanceRef.current?.selectAll();
  };

  const handleTermMenuClear = () => {
    setTermContextMenu(null);
    termInstanceRef.current?.clear();
  };

  useEffect(() => {
    setIsConnecting(true);
    setError(null);

    const connId = `${panelId}-${Math.random().toString(36).substring(2, 9)}`;
    setConnectionId(connId);

    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'block',
      fontFamily: "'JetBrains Mono', 'SF Mono', 'Fira Code', 'Courier New', Courier, Monaco, Consolas, monospace",
      fontSize: 13,
      lineHeight: 1,
      letterSpacing: 0,
      scrollback: 10000,
      theme: {
        background: '#000000',
        foreground: '#ffffff',
        cursor: '#ffffff',
        selectionBackground: '#ffffff',
        selectionForeground: '#000000',
      }
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    if (terminalRef.current) {
      // xterm computes its cell metrics (glyph width/height) from the font at
      // open() time. With font-display:swap the real JetBrains Mono may still be
      // loading on a cold start, so xterm would measure a fallback font and then
      // every glyph would render misaligned (the "криво косо" / torn ASCII art
      // symptom) once the real font swaps in. Block on the font being ready first.
      const openTerminal = () => {
        if (!terminalRef.current) return;
        term.open(terminalRef.current);
        // Focus terminal immediately after opening
        term.focus();
        // Delay fit to ensure container is properly laid out
        requestAnimationFrame(() => {
          if (terminalRef.current && terminalRef.current.clientWidth > 0 && terminalRef.current.clientHeight > 0) {
            fitAddon.fit();
            // Send initial terminal size to backend
            sendResize(connId, term.cols, term.rows);
            // Focus again after fit
            term.focus();
          }
        });
      };

      if (document.fonts && document.fonts.load) {
        // '13px "JetBrains Mono"' must match the Terminal fontSize/fontFamily below
        Promise.race([
          document.fonts.load('13px "JetBrains Mono"', '│─┌┐└┘'),
          new Promise((_, reject) => setTimeout(() => reject(new Error('font load timeout')), 3000)),
        ]).then(openTerminal).catch(() => openTerminal());
      } else {
        openTerminal();
      }
    }

    termInstanceRef.current = term;
    fitAddonRef.current = fitAddon;

    let cleanupData = () => {};
    let cleanupOutput = () => {};
    let cleanupClose = () => {};
    let cleanupError = () => {};

    if (type === 'ssh' && config) {
      cleanupData = term.onData((data) => { window.api.writeSshData(connId, data); }).dispose;
      window.api.connectSSH(connId, config);

      cleanupOutput = window.api.onSshOutput((id, data) => {
        if (id === connId) { term.write(data); setIsConnected(true); setIsConnecting(false); }
      });
      cleanupClose = window.api.onSshClose((id) => {
        if (id === connId) { term.write('\r\n*** SSH CONNECTION CLOSED ***\r\n'); setIsConnected(false); setIsConnecting(false); }
      });
      cleanupError = window.api.onSshError((id, msg) => {
        if (id === connId) { term.write(`\r\n*** SSH ERROR: ${msg} ***\r\n`); setError(msg); setIsConnected(false); setIsConnecting(false); }
      });
    } else if (type === 'ftp' && config) {
      // FTP: buffer input until Enter, then send command
      let inputBuffer = '';
      cleanupData = term.onData((data) => {
        if (data === '\r' || data === '\n') {
          // Enter pressed — send buffered command
          const cmd = inputBuffer.trim();
          inputBuffer = '';
          if (cmd) {
            window.api.sendFtpCommand(connId, cmd);
          }
        } else if (data === '\x7f' || data === '\b') {
          // Backspace
          if (inputBuffer.length > 0) {
            inputBuffer = inputBuffer.slice(0, -1);
            term.write('\b \b');
          }
        } else {
          inputBuffer += data;
          term.write(data);
        }
      }).dispose;
      window.api.connectFtp(connId, config);

      cleanupOutput = window.api.onFtpOutput((id, data) => {
        if (id === connId) { term.write(data); setIsConnected(true); setIsConnecting(false); }
      });
      // FTP (basic-ftp) is request/response based — no close event is emitted.
      // cleanupClose remains the default no-op () => {} declared above.
      cleanupError = window.api.onFtpError((id, msg) => {
        if (id === connId) { term.write(`\r\n*** FTP ERROR: ${msg} ***\r\n`); setError(msg); setIsConnected(false); setIsConnecting(false); }
      });
    } else if (type === 'telnet' && config) {
      // Telnet: buffer input until Enter, then send line
      let inputBuffer = '';
      cleanupData = term.onData((data) => {
        if (data === '\r' || data === '\n') {
          const cmd = inputBuffer.trim();
          inputBuffer = '';
          if (cmd) {
            window.api.sendTelnetData(connId, cmd + '\r\n');
          }
        } else if (data === '\x7f' || data === '\b') {
          if (inputBuffer.length > 0) {
            inputBuffer = inputBuffer.slice(0, -1);
            term.write('\b \b');
          }
        } else {
          inputBuffer += data;
          term.write(data);
        }
      }).dispose;
      window.api.connectTelnet(connId, config);

      cleanupOutput = window.api.onTelnetOutput((id, data) => {
        if (id === connId) { term.write(data); setIsConnected(true); setIsConnecting(false); }
      });
      cleanupClose = window.api.onTelnetClose((id, reason) => {
        if (id === connId) { term.write(`\r\n*** TELNET CONNECTION CLOSED (${reason}) ***\r\n`); setIsConnected(false); setIsConnecting(false); }
      });
      cleanupError = window.api.onTelnetError((id, msg) => {
        if (id === connId) { term.write(`\r\n*** TELNET ERROR: ${msg} ***\r\n`); setError(msg); setIsConnected(false); setIsConnecting(false); }
      });
    } else {
      // Local PTY
      cleanupData = term.onData((data) => { window.api.writeLocalPtyData(connId, data); }).dispose;
      window.api.connectLocalPty(connId);
      setIsConnected(true);
      setIsConnecting(false);

      cleanupOutput = window.api.onLocalPtyOutput((id, data) => {
        if (id === connId) term.write(data);
      });
      cleanupClose = window.api.onLocalPtyClose((id, reason) => {
        if (id === connId) { term.write(`\r\n*** LOCAL TERMINAL CLOSED (${reason}) ***\r\n`); setIsConnected(false); setIsConnecting(false); }
      });
    }

    return () => {
      cleanupData(); cleanupOutput(); cleanupClose(); cleanupError();
      if (type === 'ssh') window.api.disconnectSSH(connId);
      else if (type === 'ftp') window.api.disconnectFtp(connId);
      else if (type === 'telnet') window.api.disconnectTelnet(connId);
      else window.api.disconnectLocalPty(connId);
      term.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelId, type, reconnectKey]); // config intentionally excluded - connection should not restart on config change; reconnectKey re-runs it on RECONNECT

  const panelTitle = type === 'ssh' && config
    ? `[SSH: ${config.username}@${config.host}:${config.port}]`
    : type === 'ftp' && config
    ? `[FTP: ${config.username}@${config.host}:${config.port}]`
    : type === 'telnet' && config
    ? `[TELNET: ${config.host}:${config.port}]`
    : `[LOCAL SHELL]`;

  const handleSaveClick = () => {
    if (!config) return;
    setShowSavePrompt(true);
  };

  const handleSaveConfirm = (name: string) => {
    setShowSavePrompt(false);
    if (!config || !onSaveSession) return;
    const finalName = name.trim() || config.name || `${config.username}@${config.host}`;
    onSaveSession({ ...config, name: finalName });
  };

  const handleSaveCancel = () => {
    setShowSavePrompt(false);
  };

  return (
    <div style={{ display: 'flex', flex: 1, width: '100%', height: '100%', overflow: 'hidden' }}>
      {showSavePrompt && (
        <PromptDialog
          title="SAVE SESSION"
          placeholder="Enter session name..."
          defaultValue={config?.name || `${config?.username}@${config?.host}`}
          onConfirm={handleSaveConfirm}
          onCancel={handleSaveCancel}
        />
      )}
      {(type === 'ssh' || type === 'ftp') && showSftp && isConnected && connectionId && (
        <div style={{ width: `${sftpWidth}px`, display: 'flex', height: '100%' }}>
          {type === 'ssh' ? (
            <SftpExplorer tabId={connectionId} isConnected={isConnected} onRefreshTrigger={refreshTrigger} />
          ) : (
            <FtpExplorer tabId={connectionId} isConnected={isConnected} onRefreshTrigger={refreshTrigger} />
          )}
        </div>
      )}
      {(type === 'ssh' || type === 'ftp') && showSftp && isConnected && (
        <div className="split-divider" onMouseDown={startResizing} />
      )}
      <div className="split-pane" style={{ flex: 1, position: 'relative', minWidth: 0 }}>
        <div className="panel-header">
          <span className="panel-title">
            {panelTitle}
            {isConnecting && ' (CONNECTING...)'}
            {error && ' (ERROR)'}
            {!isConnected && !isConnecting && !error && ' (DISCONNECTED)'}
          </span>
          <span className="panel-actions">
            {!isConnected && !isConnecting && (
              <button className="action-btn-small" onClick={() => setReconnectKey(k => k + 1)}>
                RECONNECT
              </button>
            )}
            {(type === 'ssh' || type === 'ftp') && isConnected && (
              <button className="action-btn-small" onClick={() => setShowSftp(!showSftp)}>
                {showSftp ? 'HIDE FILES' : 'SHOW FILES'}
              </button>
            )}
            {(type === 'ssh' || type === 'ftp') && isConnected && (
              <button className="action-btn-small" onClick={() => setRefreshTrigger(p => p + 1)}>
                SYNC
              </button>
            )}
            {(type === 'ssh' || type === 'ftp' || type === 'telnet') && config && (
              <button className="action-btn-small" onClick={handleSaveClick}>
                SAVE
              </button>
            )}
            {showCloseBtn && (
              <button className="action-btn-small btn-danger" onClick={onClose}>CLOSE</button>
            )}
          </span>
        </div>
        {error && (
          <div className="terminal-overlay-message alert-error">
            <p>CONNECTION FAILED</p>
            <p style={{ marginTop: '5px', fontSize: '12px' }}>{error}</p>
            <button
              className="btn"
              style={{ marginTop: '12px', whiteSpace: 'nowrap' }}
              onClick={() => { setError(null); setReconnectKey(k => k + 1); }}
            >
              RECONNECT
            </button>
          </div>
        )}
        {!error && !isConnected && !isConnecting && (
          <div className="terminal-overlay-message">
            <p>CONNECTION CLOSED</p>
            <button
              className="btn"
              style={{ marginTop: '12px', whiteSpace: 'nowrap' }}
              onClick={() => setReconnectKey(k => k + 1)}
            >
              RECONNECT
            </button>
          </div>
        )}
        <div className="terminal-container" ref={terminalRef} onContextMenu={handleTermContextMenu} onClick={handleTerminalClick} />

        {/* Terminal context menu */}
        {termContextMenu && (() => {
          const menuWidth = 150;
          const menuHeight = 130;
          let x = termContextMenu.x;
          let y = termContextMenu.y;
          if (x + menuWidth > window.innerWidth) x = window.innerWidth - menuWidth - 10;
          if (y + menuHeight > window.innerHeight) y = window.innerHeight - menuHeight - 10;
          return (
            <div className="context-menu" style={{ left: x, top: y }}>
              <button className="context-menu-item" onClick={handleTermMenuCopy}>COPY</button>
              <button className="context-menu-item" onClick={handleTermMenuPaste}>PASTE</button>
              <div className="context-menu-divider" />
              <button className="context-menu-item" onClick={handleTermMenuSelectAll}>SELECT ALL</button>
              <button className="context-menu-item" onClick={handleTermMenuClear}>CLEAR</button>
            </div>
          );
        })()}
      </div>
    </div>
  );
};
