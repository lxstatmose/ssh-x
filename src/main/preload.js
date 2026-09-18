const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // ─── SSH Terminal ──────────────────────────────────────────────────────────
  connectSSH: (tabId, config) => ipcRenderer.send('ssh-connect', tabId, config),
  writeSshData: (tabId, data) => ipcRenderer.send('ssh-data', tabId, data),
  resizeSsh: (tabId, cols, rows) => ipcRenderer.send('ssh-resize', tabId, cols, rows),
  disconnectSSH: (tabId) => ipcRenderer.send('ssh-disconnect', tabId),

  onSshOutput: (callback) => {
    const subscription = (event, tabId, data) => callback(tabId, data);
    ipcRenderer.on('ssh-output', subscription);
    return () => ipcRenderer.removeListener('ssh-output', subscription);
  },
  onSshClose: (callback) => {
    const subscription = (event, tabId, reason) => callback(tabId, reason);
    ipcRenderer.on('ssh-close', subscription);
    return () => ipcRenderer.removeListener('ssh-close', subscription);
  },
  onSshError: (callback) => {
    const subscription = (event, tabId, message) => callback(tabId, message);
    ipcRenderer.on('ssh-error', subscription);
    return () => ipcRenderer.removeListener('ssh-error', subscription);
  },

  // ─── Sessions Store ────────────────────────────────────────────────────────
  getSavedSessions: () => ipcRenderer.invoke('sessions-get'),
  saveSession: (session) => ipcRenderer.invoke('sessions-save', session),
  deleteSession: (id) => ipcRenderer.invoke('sessions-delete', id),

  // ─── SFTP Operations ───────────────────────────────────────────────────────
  sftpList: (tabId, remotePath) => ipcRenderer.invoke('sftp-list', tabId, remotePath),
  sftpDownload: (tabId, remotePath, defaultFileName) => ipcRenderer.invoke('sftp-download', tabId, remotePath, defaultFileName),
  sftpUpload: (tabId, remotePath) => ipcRenderer.invoke('sftp-upload', tabId, remotePath),
  sftpUploadFile: (tabId, localPath, remotePath) => ipcRenderer.invoke('sftp-upload-file', tabId, localPath, remotePath),
  sftpDelete: (tabId, remotePath, isDir) => ipcRenderer.invoke('sftp-delete', tabId, remotePath, isDir),
  sftpCreateDir: (tabId, remotePath) => ipcRenderer.invoke('sftp-create-dir', tabId, remotePath),
  sftpRename: (tabId, oldPath, newPath) => ipcRenderer.invoke('sftp-rename', tabId, oldPath, newPath),

  // ─── FTP Operations ────────────────────────────────────────────────────────
  connectFtp: (tabId, config) => ipcRenderer.send('ftp-connect', tabId, config),
  sendFtpCommand: (tabId, data) => ipcRenderer.send('ftp-data', tabId, data),
  disconnectFtp: (tabId) => ipcRenderer.send('ftp-disconnect', tabId),

  onFtpOutput: (callback) => {
    const subscription = (event, tabId, data) => callback(tabId, data);
    ipcRenderer.on('ftp-output', subscription);
    return () => ipcRenderer.removeListener('ftp-output', subscription);
  },
  onFtpError: (callback) => {
    const subscription = (event, tabId, message) => callback(tabId, message);
    ipcRenderer.on('ftp-error', subscription);
    return () => ipcRenderer.removeListener('ftp-error', subscription);
  },

  ftpList: (tabId, remotePath) => ipcRenderer.invoke('ftp-list', tabId, remotePath),
  ftpDownload: (tabId, remotePath, defaultFileName) => ipcRenderer.invoke('ftp-download', tabId, remotePath, defaultFileName),
  ftpUpload: (tabId, remotePath) => ipcRenderer.invoke('ftp-upload', tabId, remotePath),
  ftpUploadFile: (tabId, localPath, remotePath) => ipcRenderer.invoke('ftp-upload-file', tabId, localPath, remotePath),
  ftpDelete: (tabId, remotePath, isDir) => ipcRenderer.invoke('ftp-delete', tabId, remotePath, isDir),
  ftpCreateDir: (tabId, remotePath) => ipcRenderer.invoke('ftp-create-dir', tabId, remotePath),

  // ─── Telnet Operations ─────────────────────────────────────────────────────
  connectTelnet: (tabId, config) => ipcRenderer.send('telnet-connect', tabId, config),
  sendTelnetData: (tabId, data) => ipcRenderer.send('telnet-data', tabId, data),
  resizeTelnet: (tabId, cols, rows) => ipcRenderer.send('telnet-resize', tabId, cols, rows),
  disconnectTelnet: (tabId) => ipcRenderer.send('telnet-disconnect', tabId),

  onTelnetOutput: (callback) => {
    const subscription = (event, tabId, data) => callback(tabId, data);
    ipcRenderer.on('telnet-output', subscription);
    return () => ipcRenderer.removeListener('telnet-output', subscription);
  },
  onTelnetClose: (callback) => {
    const subscription = (event, tabId, reason) => callback(tabId, reason);
    ipcRenderer.on('telnet-close', subscription);
    return () => ipcRenderer.removeListener('telnet-close', subscription);
  },
  onTelnetError: (callback) => {
    const subscription = (event, tabId, message) => callback(tabId, message);
    ipcRenderer.on('telnet-error', subscription);
    return () => ipcRenderer.removeListener('telnet-error', subscription);
  },

  // ─── Progress Events ────────────────────────────────────────────────────────
  onTransferProgress: (callback) => {
    const subscription = (event, data) => callback(data);
    ipcRenderer.on('transfer-progress', subscription);
    return () => ipcRenderer.removeListener('transfer-progress', subscription);
  },

  // ─── Context Menus ─────────────────────────────────────────────────────────
  showTermContextMenu: (type) => ipcRenderer.send('show-term-context-menu', { type }),
  onTermContextAction: (callback) => {
    const subscription = (event, action) => callback(action);
    ipcRenderer.on('term-context-action', subscription);
    return () => ipcRenderer.removeListener('term-context-action', subscription);
  },
  showSftpContextMenu: (options) => ipcRenderer.send('show-sftp-context-menu', options),
  onSftpContextAction: (callback) => {
    const subscription = (event, data) => callback(data);
    ipcRenderer.on('sftp-context-action', subscription);
    return () => ipcRenderer.removeListener('sftp-context-action', subscription);
  },

  // ─── Local Files ───────────────────────────────────────────────────────────
  // Electron 32 removed the non-standard `File.path` property. Dropped files
  // (drag-and-drop upload in the SFTP/FTP explorer) must have their absolute
  // path resolved here through webUtils instead.
  getPathForFile: (file) => webUtils.getPathForFile(file),

  // ─── Local PTY ─────────────────────────────────────────────────────────────
  connectLocalPty: (tabId) => ipcRenderer.send('local-pty-create', tabId),
  writeLocalPtyData: (tabId, data) => ipcRenderer.send('local-pty-data', tabId, data),
  resizeLocalPty: (tabId, cols, rows) => ipcRenderer.send('local-pty-resize', tabId, cols, rows),
  disconnectLocalPty: (tabId) => ipcRenderer.send('local-pty-close', tabId),
  onLocalPtyOutput: (callback) => {
    const subscription = (event, tabId, data) => callback(tabId, data);
    ipcRenderer.on('local-pty-output', subscription);
    return () => ipcRenderer.removeListener('local-pty-output', subscription);
  },
  onLocalPtyClose: (callback) => {
    const subscription = (event, tabId, reason) => callback(tabId, reason);
    ipcRenderer.on('local-pty-close', subscription);
    return () => ipcRenderer.removeListener('local-pty-close', subscription);
  }
});
