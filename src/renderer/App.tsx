import React, { useState, useEffect, useRef } from 'react';
import { SshConfig } from './global';
import { SessionTab } from './components/SessionTab';
import { CustomSelect } from './components/CustomSelect';

interface PanelState {
  id: string;
  type: 'ssh' | 'ftp' | 'telnet' | 'local' | 'new';
  config?: SshConfig;
}

interface TabState {
  id: string;
  title: string;
  panels: PanelState[];
}

const emptySession: SshConfig = {
  host: '',
  port: '22',
  username: '',
  authMethod: 'password',
  password: '',
  keyPath: '',
  passphrase: '',
  name: '',
  protocol: 'ssh',
  secure: false,
};

// ─── Reusable prompt dialog ──────────────────────────────────────────────────
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
      <div className="modal-box" style={{ maxWidth: '420px' }}>
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

// ─── About dialog ────────────────────────────────────────────────────────────
const AboutDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  return (
    <div className="modal-overlay" style={{ zIndex: 2000 }}>
      <div className="modal-box" style={{ maxWidth: '380px', textAlign: 'center' }}>
        <div className="modal-header">
          <span>ABOUT</span>
          <button className="modal-close-btn" onClick={onClose}>×</button>
        </div>
        <div style={{ padding: '20px 0' }}>
          <div style={{ fontSize: '24px', fontWeight: 'bold', letterSpacing: '3px', marginBottom: '8px' }}>SSH-X</div>
          <div style={{ color: 'var(--gray-700)', fontSize: '13px', marginBottom: '20px' }}>SSH & SFTP Client</div>
          <div style={{ borderTop: '1px solid var(--gray-300)', paddingTop: '16px', color: 'var(--gray-600)', fontSize: '12px' }}>
            Version 1.0.0
          </div>
          <div style={{ color: 'var(--gray-600)', fontSize: '12px', marginTop: '8px' }}>
            © 2026 SSH-X
          </div>
        </div>
        <div className="modal-footer" style={{ justifyContent: 'center' }}>
          <button className="btn btn-primary" onClick={onClose} style={{ minWidth: '120px' }}>OK</button>
        </div>
      </div>
    </div>
  );
};

// ─── Main App ────────────────────────────────────────────────────────────────
export default function App() {
  const [sessions, setSessions] = useState<SshConfig[]>([]);
  const [tabs, setTabs] = useState<TabState[]>([
    { id: 'initial-tab', title: '[NEW SESSION]', panels: [] }
  ]);
  const [activeTabId, setActiveTabId] = useState<string>('initial-tab');
  
  const [showModal, setShowModal] = useState(false);
  const [modalConfig, setModalConfig] = useState<SshConfig>({ ...emptySession });
  const [isEditing, setIsEditing] = useState(false);
  const [quickConfig, setQuickConfig] = useState<SshConfig>({ ...emptySession });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Save prompt state — only used for quick connect and modal save
  const [savePrompt, setSavePrompt] = useState<{
    config: SshConfig;
    defaultName: string;
    mode: 'quick' | 'modal';
  } | null>(null);

  const [showAbout, setShowAbout] = useState(false);

  useEffect(() => {
    const loadSessions = async () => {
      try {
        const list = await window.api.getSavedSessions();
        setSessions(list);
      } catch (err) {
        console.error('Failed to load saved sessions:', err);
      }
    };
    loadSessions();
  }, []);

  const [timeStr, setTimeStr] = useState(new Date().toLocaleTimeString());
  useEffect(() => {
    const interval = setInterval(() => {
      setTimeStr(new Date().toLocaleTimeString());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Save session — opens custom prompt dialog
  const handleSaveSession = (configToSave: SshConfig, defaultName?: string, mode: 'quick' | 'modal' = 'modal') => {
    const proto = configToSave.protocol || 'ssh';
    if (proto !== 'local' && !configToSave.host) {
      alert('Host is required!');
      return;
    }
    if (proto !== 'telnet' && proto !== 'local' && !configToSave.username) {
      alert('Username is required!');
      return;
    }
    const suggested = defaultName || configToSave.name || (proto === 'local' ? 'Local Terminal' : proto === 'telnet' ? `${configToSave.host}` : `${configToSave.username}@${configToSave.host}`);
    setSavePrompt({ config: configToSave, defaultName: suggested, mode });
  };

  // Direct save — no second prompt (used by SessionTab panel save)
  const handleDirectSave = async (configToSave: SshConfig) => {
    const proto = configToSave.protocol || 'ssh';
    if (proto !== 'local' && !configToSave.host) {
      alert('Host is required!');
      return;
    }
    if (proto !== 'telnet' && proto !== 'local' && !configToSave.username) {
      alert('Username is required!');
      return;
    }
    try {
      const updated = await window.api.saveSession(configToSave);
      setSessions(updated);
    } catch (err: any) {
      alert(`Failed to save: ${err.message}`);
    }
  };

  const handleSavePromptConfirm = async (name: string) => {
    if (!savePrompt) return;
    const { config, mode } = savePrompt;
    const finalName = name.trim() || savePrompt.defaultName;
    const sessionObj: SshConfig = {
      ...config,
      id: config.id || Math.random().toString(36).substring(2, 9),
      name: finalName
    };
    try {
      const updated = await window.api.saveSession(sessionObj);
      setSessions(updated);
      if (mode === 'modal' || mode === 'quick') {
        setShowModal(false);
        setModalConfig({ ...emptySession });
      }
    } catch (err: any) {
      alert(`Failed to save: ${err.message}`);
    }
    setSavePrompt(null);
  };

  const handleSavePromptCancel = () => {
    setSavePrompt(null);
  };

  const handleDeleteSession = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Are you sure you want to delete this session?')) return;
    try {
      const updated = await window.api.deleteSession(id);
      setSessions(updated);
    } catch (err: any) {
      alert(`Failed to delete: ${err.message}`);
    }
  };

  const handleEditSessionClick = (session: SshConfig, e: React.MouseEvent) => {
    e.stopPropagation();
    setModalConfig({ ...session });
    setIsEditing(true);
    setShowModal(true);
  };

  // Split directions per tab: array of 'horizontal' | 'vertical' for each split
  const [splitDirections, setSplitDirections] = useState<Record<string, ('horizontal' | 'vertical')[]>>({});

  const launchSession = (config: SshConfig, targetTabId?: string) => {
    const protocol = config.protocol || 'ssh';
    if (protocol === 'local') {
      launchLocalSession(targetTabId, config.name || '[LOCAL SHELL]');
      return;
    }
    const activeTab = tabs.find(t => t.id === (targetTabId || activeTabId));
    const configWithId = {
      ...config,
      id: config.id || Math.random().toString(36).substring(2, 9)
    };
    const newPanel: PanelState = {
      id: `conn-${Math.random().toString(36).substring(2, 9)}`,
      type: protocol,
      config: { ...configWithId }
    };
    const title = config.name || `${config.username}@${config.host}`;
    if (activeTab && activeTab.panels.length === 0) {
      setTabs(prev => prev.map(t => {
        if (t.id === activeTab.id) {
          return { ...t, title, panels: [newPanel] };
        }
        return t;
      }));
    } else {
      const newTabId = `tab-${Math.random().toString(36).substring(2, 9)}`;
      const newTab: TabState = { id: newTabId, title, panels: [newPanel] };
      setTabs(prev => [...prev, newTab]);
      setActiveTabId(newTabId);
    }
  };

  const launchLocalSession = (targetTabId?: string, customTitle?: string) => {
    const activeTab = tabs.find(t => t.id === (targetTabId || activeTabId));
    const title = customTitle || '[LOCAL SHELL]';
    const newPanel: PanelState = {
      id: `conn-${Math.random().toString(36).substring(2, 9)}`,
      type: 'local'
    };
    if (activeTab && activeTab.panels.length === 0) {
      setTabs(prev => prev.map(t => {
        if (t.id === activeTab.id) {
          return { ...t, title, panels: [newPanel] };
        }
        return t;
      }));
    } else {
      const newTabId = `tab-${Math.random().toString(36).substring(2, 9)}`;
      setTabs(prev => [...prev, { id: newTabId, title, panels: [newPanel] }]);
      setActiveTabId(newTabId);
    }
  };

  const handleCreateNewTab = () => {
    const newTabId = `tab-${Math.random().toString(36).substring(2, 9)}`;
    setTabs(prev => [...prev, { id: newTabId, title: '[NEW SESSION]', panels: [] }]);
    setActiveTabId(newTabId);
  };

  const handleCloseTab = (tabId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (tabs.length === 1) {
      const newTabId = `tab-${Math.random().toString(36).substring(2, 9)}`;
      setTabs([{ id: newTabId, title: '[NEW SESSION]', panels: [] }]);
      setActiveTabId(newTabId);
      setSplitDirections(prev => { const n = { ...prev }; delete n[tabId]; return n; });
      return;
    }
    const idx = tabs.findIndex(t => t.id === tabId);
    const newTabs = tabs.filter(t => t.id !== tabId);
    setTabs(newTabs);
    // Clean up positional split-directions for the closed tab
    setSplitDirections(prev => { const n = { ...prev }; delete n[tabId]; return n; });
    if (activeTabId === tabId) {
      setActiveTabId(newTabs[Math.max(0, idx - 1)].id);
    }
  };

  const handleClosePanel = (tabId: string, panelId: string) => {
    // Find the panel index from the current tabs state (read before mutating).
    const currentTab = tabs.find(t => t.id === tabId);
    const removeIdx = currentTab ? currentTab.panels.findIndex(p => p.id === panelId) : -1;

    setTabs(prev => prev.map(t => {
      if (t.id === tabId) {
        const updatedPanels = t.panels.filter(p => p.id !== panelId);
        return { ...t, title: updatedPanels.length === 0 ? '[NEW SESSION]' : t.title, panels: updatedPanels };
      }
      return t;
    }));

    // splitDirections is positional: entry i describes the direction used to
    // add panel (i+1). Removing a panel shifts later panels left by one, so
    // drop the matching entry to keep directions aligned with panels.
    if (removeIdx > 0) {
      setSplitDirections(prev => {
        const dirs = prev[tabId];
        if (!dirs || dirs.length === 0) return prev;
        const newDirs = [...dirs];
        newDirs.splice(removeIdx - 1, 1);
        return { ...prev, [tabId]: newDirs };
      });
    }
  };

  // Split: add a new panel to the tab with the chosen direction
  // direction = 'horizontal' means new panel goes to the right (same row)
  // direction = 'vertical' means new panel goes below (new row under all existing)
  const handleSplitTab = (tabId: string, direction: 'horizontal' | 'vertical') => {
    setSplitDirections(prev => ({
      ...prev,
      [tabId]: [...(prev[tabId] || []), direction]
    }));
    setTabs(prev => prev.map(t => {
      if (t.id === tabId && t.panels.length > 0) {
        return { ...t, panels: [...t.panels, { id: `split-${Math.random().toString(36).substring(2, 9)}`, type: 'new' as const }] };
      }
      return t;
    }));
  };

  const launchSshInPanel = (tabId: string, panelId: string, config: SshConfig) => {
    const configWithId = { ...config, id: config.id || Math.random().toString(36).substring(2, 9) };
    setTabs(prev => prev.map(t => {
      if (t.id !== tabId) return t;
      return {
        ...t,
        panels: t.panels.map(p =>
          p.id === panelId
            ? { id: `conn-${Math.random().toString(36).substring(2, 9)}`, type: 'ssh' as const, config: { ...configWithId } }
            : p
        )
      };
    }));
  };

  const launchLocalInPanel = (tabId: string, panelId: string) => {
    setTabs(prev => prev.map(t => {
      if (t.id !== tabId) return t;
      return {
        ...t,
        panels: t.panels.map(p =>
          p.id === panelId
            ? { id: `conn-${Math.random().toString(36).substring(2, 9)}`, type: 'local' as const }
            : p
        )
      };
    }));
  };

  const currentActiveTab = tabs.find(t => t.id === activeTabId);

  return (
    <div className="app-container">
      {/* Custom save prompt dialog */}
      {savePrompt && (
        <PromptDialog
          title="SAVE SESSION"
          placeholder="Enter session name..."
          defaultValue={savePrompt.defaultName}
          onConfirm={handleSavePromptConfirm}
          onCancel={handleSavePromptCancel}
        />
      )}

      {/* About dialog */}
      {showAbout && (
        <AboutDialog onClose={() => setShowAbout(false)} />
      )}

      <header className="app-header">
        <div className="header-left">
          <button
            className="sidebar-toggle-btn"
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            title={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
          >
            {sidebarCollapsed ? '+' : '−'}
          </button>
          <span className="app-title" style={{ cursor: 'pointer' }} onClick={() => setShowAbout(true)} title="About SSH-X">SSH-X</span>
        </div>
        <div className="header-actions">
          {currentActiveTab && currentActiveTab.panels.length > 0 && (
            <span className="split-buttons-group">
              <button className="action-btn-small" onClick={() => handleSplitTab(activeTabId, 'horizontal')}>
                SPLIT →
              </button>
              <button className="action-btn-small" onClick={() => handleSplitTab(activeTabId, 'vertical')}>
                SPLIT ↓
              </button>
            </span>
          )}
          <span className="system-status">{timeStr}</span>
        </div>
      </header>

      <div className="workspace">
        <aside className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}>
          <div className="sidebar-header">
            <div className="sidebar-title">
              SAVED SESSIONS
            </div>
          </div>
          <div className="sessions-list">
            {sessions.length === 0 ? (
              <div className="empty-hint">
                [NO SAVED SESSIONS]
              </div>
            ) : (
              sessions.map(sess => (
                <div 
                  key={sess.id} 
                  className="session-item"
                  onClick={() => launchSession(sess)}
                >
                  <span className="session-name">{sess.name || (sess.protocol === 'local' ? 'Local Terminal' : `${sess.username}@${sess.host}`)}</span>
                  <span className="session-item-actions">
                    <button className="action-btn-small" onClick={(e) => handleEditSessionClick(sess, e)}>EDIT</button>
                    <button className="action-btn-small btn-danger" onClick={(e) => handleDeleteSession(sess.id!, e)}>DEL</button>
                  </span>
                </div>
              ))
            )}
          </div>
          <div className="sidebar-footer">
            <button className="btn btn-add" onClick={() => { setModalConfig({ ...emptySession }); setIsEditing(false); setShowModal(true); }}>
              + ADD SESSION
            </button>
          </div>
        </aside>

        <main className="main-area">
          <div className="tabs-bar">
            {tabs.map(tab => (
              <div key={tab.id} className={`tab ${tab.id === activeTabId ? 'active' : ''}`} onClick={() => setActiveTabId(tab.id)}>
                <span className="tab-title">{tab.title}</span>
                <span className="tab-close" onClick={(e) => handleCloseTab(tab.id, e)}>×</span>
              </div>
            ))}
            <div className="tab-add" onClick={handleCreateNewTab}>+</div>
          </div>

          <div className="tab-content" style={{ flex: 1, display: 'flex' }}>
            {tabs.map(tab => {
              const isTabActive = tab.id === activeTabId;
              if (tab.panels.length === 0) {
                return (
                  <div key={tab.id} className="welcome-screen" style={{ display: isTabActive ? 'flex' : 'none' }}>
                    <div className="welcome-box">
                      <div className="welcome-title">[QUICK CONNECT]</div>
                      
                      <div className="form-group">
                        <label>PROTOCOL</label>
                        <CustomSelect
                          value={quickConfig.protocol || 'ssh'}
                          options={[
                            { value: 'ssh', label: 'SSH' },
                            { value: 'ftp', label: 'FTP / FTPS' },
                            { value: 'telnet', label: 'TELNET' },
                            { value: 'local', label: 'LOCAL TERMINAL' },
                          ]}
                          onChange={(proto) => {
                            const defaultPort = proto === 'ssh' ? '22' : proto === 'ftp' ? '21' : '23';
                            setQuickConfig(p => ({ ...p, protocol: proto as any, port: defaultPort }));
                          }}
                        />
                      </div>

                      {quickConfig.protocol === 'local' ? (
                        <div style={{ padding: '16px', color: 'var(--gray-700)', fontSize: '12px', textAlign: 'center', border: '1px dashed var(--gray-300)', margin: '16px 0' }}>
                          LOCAL TERMINAL ON THIS MAC
                        </div>
                      ) : (
                        <>
                          <div className="form-group">
                            <label>HOST / IP ADDRESS</label>
                            <input type="text" placeholder="e.g. 192.168.1.50" value={quickConfig.host}
                              onChange={(e) => setQuickConfig(p => ({ ...p, host: e.target.value }))} />
                          </div>

                          <div className="form-row">
                            <div className="form-group">
                              <label>PORT</label>
                              <input type="number" placeholder={quickConfig.protocol === 'ftp' ? '21' : quickConfig.protocol === 'telnet' ? '23' : '22'} value={quickConfig.port}
                                onChange={(e) => setQuickConfig(p => ({ ...p, port: e.target.value }))} />
                            </div>
                            {(quickConfig.protocol === 'ssh' || quickConfig.protocol === 'ftp' || !quickConfig.protocol) && (
                              <div className="form-group">
                                <label>USERNAME</label>
                                <input type="text" placeholder="root" value={quickConfig.username}
                                  onChange={(e) => setQuickConfig(p => ({ ...p, username: e.target.value }))} />
                              </div>
                            )}
                          </div>

                          {(quickConfig.protocol === 'ssh' || !quickConfig.protocol) && (
                            <div className="form-group">
                              <label>AUTHENTICATION METHOD</label>
                              <CustomSelect
                                value={quickConfig.authMethod}
                                options={[
                                  { value: 'password', label: 'PASSWORD' },
                                  { value: 'key', label: 'PRIVATE SSH KEY' },
                                ]}
                                onChange={(v) => setQuickConfig(p => ({ ...p, authMethod: v as 'password' | 'key' }))}
                              />
                            </div>
                          )}

                          {(quickConfig.protocol === 'ssh' || !quickConfig.protocol) && quickConfig.authMethod === 'password' && (
                            <div className="form-group">
                              <label>PASSWORD</label>
                              <input type="password" placeholder="••••••••" value={quickConfig.password || ''}
                                onChange={(e) => setQuickConfig(p => ({ ...p, password: e.target.value }))} />
                            </div>
                          )}

                          {(quickConfig.protocol === 'ssh' || !quickConfig.protocol) && quickConfig.authMethod === 'key' && (
                            <div className="form-row">
                              <div className="form-group">
                                <label>KEY FILE PATH</label>
                                <input type="text" placeholder="/Users/name/.ssh/id_rsa" value={quickConfig.keyPath || ''}
                                  onChange={(e) => setQuickConfig(p => ({ ...p, keyPath: e.target.value }))} />
                              </div>
                              <div className="form-group">
                                <label>KEY PASSPHRASE (OPTIONAL)</label>
                                <input type="password" placeholder="Key passphrase" value={quickConfig.passphrase || ''}
                                  onChange={(e) => setQuickConfig(p => ({ ...p, passphrase: e.target.value }))} />
                              </div>
                            </div>
                          )}

                          {quickConfig.protocol === 'ftp' && (
                            <>
                              <div className="form-group">
                                <label>PASSWORD</label>
                                <input type="password" placeholder="••••••••" value={quickConfig.password || ''}
                                  onChange={(e) => setQuickConfig(p => ({ ...p, password: e.target.value }))} />
                              </div>
                              <div className="form-group">
                                <label>SECURE CONNECTION (FTPS)</label>
                                <CustomSelect
                                  value={quickConfig.secure ? 'true' : 'false'}
                                  options={[
                                    { value: 'false', label: 'NO (plain FTP)' },
                                    { value: 'true', label: 'YES (FTPS — explicit TLS)' },
                                  ]}
                                  onChange={(v) => setQuickConfig(p => ({ ...p, secure: v === 'true' }))}
                                />
                              </div>
                            </>
                          )}
                        </>
                      )}

                      <div className="welcome-actions">
                        <div className="btn-group-row">
                          <button className="btn btn-primary" onClick={() => launchSession(quickConfig)}>
                            CONNECT {(quickConfig.protocol || 'ssh').toUpperCase()}
                          </button>
                          <button className="btn btn-secondary"
                            onClick={() => handleSaveSession({ ...quickConfig }, quickConfig.host, 'quick')}>
                            SAVE SESSION
                          </button>
                        </div>
                        <div className="welcome-local-separator">
                          <button className="btn btn-ghost" onClick={() => launchLocalSession()}>
                            OPEN LOCAL TERMINAL ON THIS MAC
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              }
              return (
                <SessionTab 
                  key={tab.id}
                  tabId={tab.id}
                  panels={tab.panels}
                  isActive={isTabActive}
                  savedSessions={sessions}
                  splitDirections={splitDirections[tab.id] || []}
                  onClosePanel={(panelId) => handleClosePanel(tab.id, panelId)}
                  onLaunchSsh={(panelId, config) => launchSshInPanel(tab.id, panelId, config)}
                  onLaunchLocal={(panelId) => launchLocalInPanel(tab.id, panelId)}
                  onSaveSession={handleDirectSave}
                />
              );
            })}
          </div>
        </main>
      </div>

      {showModal && (
        <div className="modal-overlay">
          <div className="modal-box">
            <div className="modal-header">
              <span>{isEditing ? '[EDIT SESSION]' : '[ADD NEW SESSION]'}</span>
              <button className="modal-close-btn" onClick={() => setShowModal(false)}>×</button>
            </div>
            <div className="form-group">
              <label>CUSTOM NAME</label>
              <input type="text" placeholder="e.g. Production Database Server" value={modalConfig.name || ''}
                onChange={(e) => setModalConfig(p => ({ ...p, name: e.target.value }))} />
            </div>
            <div className="form-group">
              <label>PROTOCOL</label>
              <CustomSelect
                value={modalConfig.protocol || 'ssh'}
                options={[
                  { value: 'ssh', label: 'SSH' },
                  { value: 'ftp', label: 'FTP / FTPS' },
                  { value: 'telnet', label: 'TELNET' },
                  { value: 'local', label: 'LOCAL TERMINAL' },
                ]}
                onChange={(proto) => {
                  const defaultPort = proto === 'ssh' ? '22' : proto === 'ftp' ? '21' : '23';
                  setModalConfig(p => ({ ...p, protocol: proto as any, port: defaultPort }));
                }}
              />
            </div>

            {modalConfig.protocol === 'local' ? (
              <div style={{ padding: '16px', color: 'var(--gray-700)', fontSize: '12px', textAlign: 'center', border: '1px dashed var(--gray-300)', margin: '16px 0' }}>
                LOCAL TERMINAL ON THIS MAC
              </div>
            ) : (
              <>
                <div className="form-group">
                  <label>HOST / IP ADDRESS</label>
                  <input type="text" placeholder="e.g. 192.168.1.50" value={modalConfig.host}
                    onChange={(e) => setModalConfig(p => ({ ...p, host: e.target.value }))} />
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label>PORT</label>
                    <input type="number" placeholder={modalConfig.protocol === 'ftp' ? '21' : modalConfig.protocol === 'telnet' ? '23' : '22'} value={modalConfig.port}
                      onChange={(e) => setModalConfig(p => ({ ...p, port: e.target.value }))} />
                  </div>
                  {(modalConfig.protocol === 'ssh' || modalConfig.protocol === 'ftp' || !modalConfig.protocol) && (
                    <div className="form-group">
                      <label>USERNAME</label>
                      <input type="text" placeholder="root" value={modalConfig.username}
                        onChange={(e) => setModalConfig(p => ({ ...p, username: e.target.value }))} />
                    </div>
                  )}
                </div>

                {(modalConfig.protocol === 'ssh' || !modalConfig.protocol) && (
                  <div className="form-group">
                    <label>AUTHENTICATION METHOD</label>
                    <CustomSelect
                      value={modalConfig.authMethod}
                      options={[
                        { value: 'password', label: 'PASSWORD' },
                        { value: 'key', label: 'PRIVATE SSH KEY' },
                      ]}
                      onChange={(v) => setModalConfig(p => ({ ...p, authMethod: v as 'password' | 'key' }))}
                    />
                  </div>
                )}

                {(modalConfig.protocol === 'ssh' || !modalConfig.protocol) && modalConfig.authMethod === 'password' && (
                  <div className="form-group">
                    <label>PASSWORD</label>
                    <input type="password" placeholder="••••••••" value={modalConfig.password || ''}
                      onChange={(e) => setModalConfig(p => ({ ...p, password: e.target.value }))} />
                  </div>
                )}

                {(modalConfig.protocol === 'ssh' || !modalConfig.protocol) && modalConfig.authMethod === 'key' && (
                  <div className="form-row">
                    <div className="form-group">
                      <label>KEY FILE PATH</label>
                      <input type="text" placeholder="/Users/name/.ssh/id_rsa" value={modalConfig.keyPath || ''}
                        onChange={(e) => setModalConfig(p => ({ ...p, keyPath: e.target.value }))} />
                    </div>
                    <div className="form-group">
                      <label>KEY PASSPHRASE (OPTIONAL)</label>
                      <input type="password" placeholder="Key passphrase" value={modalConfig.passphrase || ''}
                        onChange={(e) => setModalConfig(p => ({ ...p, passphrase: e.target.value }))} />
                    </div>
                  </div>
                )}

                {modalConfig.protocol === 'ftp' && (
                  <>
                    <div className="form-group">
                      <label>PASSWORD</label>
                      <input type="password" placeholder="••••••••" value={modalConfig.password || ''}
                        onChange={(e) => setModalConfig(p => ({ ...p, password: e.target.value }))} />
                    </div>
                    <div className="form-group">
                      <label>SECURE CONNECTION (FTPS)</label>
                      <CustomSelect
                        value={modalConfig.secure ? 'true' : 'false'}
                        options={[
                          { value: 'false', label: 'NO (plain FTP)' },
                          { value: 'true', label: 'YES (FTPS — explicit TLS)' },
                        ]}
                        onChange={(v) => setModalConfig(p => ({ ...p, secure: v === 'true' }))}
                      />
                    </div>
                  </>
                )}
              </>
            )}
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowModal(false)}>CANCEL</button>
              <button className="btn btn-primary" onClick={() => handleSaveSession(modalConfig, undefined, 'modal')}>SAVE</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
