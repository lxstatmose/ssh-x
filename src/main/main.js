const { app, BrowserWindow, ipcMain, dialog, Menu, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const sshManager = require('./sshManager');
const ptyManager = require('./ptyManager');
const ftpManager = require('./ftpManager');
const telnetManager = require('./telnetManager');

// Password encryption/decryption config.
// Key is derived from a per-machine random secret persisted in userData,
// so decrypting a stolen sessions.json requires access to the machine.
// Using AES-256-GCM for authenticated encryption (confidentiality + integrity).
const IV_LENGTH = 12; // GCM recommended IV length
const KEY_SECRET_PATH = path.join(app.getPath('userData'), '.encryption-secret');
const SESSION_SALT = 'ssh-x-salt-v1';

// Cache the encryption key after first derivation to avoid blocking the main thread
let cachedEncryptionKey = null;

function getEncryptionKey() {
  if (cachedEncryptionKey) return cachedEncryptionKey;

  let secret;
  try {
    if (fs.existsSync(KEY_SECRET_PATH)) {
      secret = fs.readFileSync(KEY_SECRET_PATH, 'utf8').trim();
    }
  } catch (e) {
    console.error('Failed to read encryption secret:', e);
  }

  // Only generate new secret if file doesn't exist (not if it's empty/corrupted)
  if (!secret && !fs.existsSync(KEY_SECRET_PATH)) {
    secret = crypto.randomBytes(32).toString('hex');
    try {
      fs.writeFileSync(KEY_SECRET_PATH, secret, { mode: 0o600 });
    } catch (e) {
      console.error('Failed to persist encryption secret:', e);
    }
  } else if (!secret) {
    // File exists but is empty/corrupted - log warning but don't destroy data
    console.error('Encryption secret file exists but is empty or corrupted. Saved sessions may be unrecoverable.');
    return null;
  }

  cachedEncryptionKey = crypto.scryptSync(secret, SESSION_SALT, 32);
  return cachedEncryptionKey;
}

function encrypt(text) {
  if (!text) return '';
  const key = getEncryptionKey();
  if (!key) return ''; // Cannot encrypt without valid key
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  // Format: iv:authTag:encrypted
  return iv.toString('hex') + ':' + authTag + ':' + encrypted;
}

function decrypt(text) {
  if (!text) return '';
  try {
    const key = getEncryptionKey();
    if (!key) return ''; // Cannot decrypt without valid key
    const parts = text.split(':');
    if (parts.length < 3) {
      // Legacy CBC format (iv:encrypted) - return empty to force re-entry
      console.warn('Legacy encryption format detected, ignoring');
      return '';
    }
    const iv = Buffer.from(parts.shift(), 'hex');
    const authTag = Buffer.from(parts.shift(), 'hex');
    const encryptedText = Buffer.from(parts.join(':'), 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (e) {
    console.error('Failed to decrypt:', e);
    return '';
  }
}

// Session store setup
const sessionsPath = path.join(app.getPath('userData'), 'sessions.json');

/**
 * Read sessions for renderer (metadata only, NO secrets)
 * Secrets are only decrypted in main process at connection time.
 */
function readSessions() {
  if (!fs.existsSync(sessionsPath)) {
    return [];
  }
  try {
    const data = fs.readFileSync(sessionsPath, 'utf8');
    const list = JSON.parse(data);
    // Return sessions WITHOUT decrypting secrets - renderer only gets metadata
    return list.map(sess => ({
      ...sess,
      password: undefined,
      passphrase: undefined,
    }));
  } catch (e) {
    console.error(e);
    return [];
  }
}

/**
 * Read full sessions with decrypted secrets (main process only)
 */
function readSessionsWithSecrets() {
  if (!fs.existsSync(sessionsPath)) {
    return [];
  }
  try {
    const data = fs.readFileSync(sessionsPath, 'utf8');
    const list = JSON.parse(data);
    return list.map(sess => {
      if (sess.password) sess.password = decrypt(sess.password);
      if (sess.passphrase) sess.passphrase = decrypt(sess.passphrase);
      return sess;
    });
  } catch (e) {
    console.error(e);
    return [];
  }
}

/**
 * Get decrypted session by ID (main process only)
 */
function getSessionWithSecrets(id) {
  const sessions = readSessionsWithSecrets();
  return sessions.find(s => s.id === id);
}

/**
 * Resolve the config to connect with, restoring secrets from the encrypted
 * store when the renderer sent only session metadata.
 *
 * readSessions() strips password/passphrase before sending sessions to the
 * renderer, so a saved session opened from the sidebar arrives here as an
 * object with `password: undefined`. Only secrets are re-attached — never sent
 * back to the renderer.
 *
 * - string id           -> full stored session (with decrypted secrets)
 * - object with id and no password/passphrase -> stored secrets merged in,
 *   so an edited session (e.g. renamed) keeps using its saved credentials
 * - object otherwise    -> unchanged (quick-connect with a typed password)
 */
function resolveConnectConfig(config) {
  if (typeof config === 'string') {
    return getSessionWithSecrets(config);
  }
  if (
    config &&
    typeof config === 'object' &&
    config.id &&
    config.password === undefined &&
    config.passphrase === undefined
  ) {
    const stored = getSessionWithSecrets(config.id);
    if (stored) {
      return { ...config, password: stored.password, passphrase: stored.passphrase };
    }
  }
  return config;
}

function writeSessions(sessions) {
  try {
    const encryptedSessions = sessions.map(sess => {
      // Create a copy to encrypt without modifying active memory objects
      const copy = { ...sess };
      if (copy.password) copy.password = encrypt(copy.password);
      if (copy.passphrase) copy.passphrase = encrypt(copy.passphrase);
      return copy;
    });
    // Atomic write: write to temp file then rename (prevents corruption on crash)
    // Use 0o600 permissions so only the owner can read/write the sessions file
    const tempPath = sessionsPath + '.tmp';
    fs.writeFileSync(tempPath, JSON.stringify(encryptedSessions, null, 2), { mode: 0o600, encoding: 'utf8' });
    fs.renameSync(tempPath, sessionsPath);
  } catch (e) {
    console.error('Failed to write sessions:', e);
  }
}

let mainWindow = null;

// Helper to validate IPC sender is our own window
function validateSender(event) {
  return mainWindow && event.sender === mainWindow.webContents;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 750,
    minWidth: 800,
    minHeight: 500,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,                    // Enable sandbox (isolates renderer)
      allowRunningInsecureContent: false,
      webSecurity: true,
    },
    title: 'ssh-x',
    backgroundColor: '#000000',
    icon: path.join(__dirname, '../../assets/icon.icns'),
  });

  // The renderer must never open new windows or navigate away from the app:
  // every link is either handled in-app or intentionally ignored.
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const devUrl = `http://localhost:${process.env.VITE_PORT || '5173'}`;
    const isDevHmrReload = process.env.ELECTRON_DEV === 'true' && url.startsWith(devUrl);
    if (!isDevHmrReload) event.preventDefault();
  });

  // Content Security Policy - restrict external resources.
  // Production only: vite's dev server needs an inline react-refresh preamble
  // script and ws:// HMR connections, both of which this CSP forbids
  // (script-src 'self' blocks inline scripts; connect-src 'self' doesn't
  // cover ws://). Applying it in dev leaves the renderer a blank page.
  if (process.env.ELECTRON_DEV !== 'true') {
    mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; " +
          "script-src 'self'; " +
          "style-src 'self' 'unsafe-inline'; " +
          "font-src 'self'; " +
          "img-src 'self' data:; " +
          "connect-src 'self'; " +
          "frame-ancestors 'none'; " +
          "base-uri 'none'; " +
          "form-action 'none';"
        ],
        'X-Content-Type-Options': ['nosniff'],
        'X-Frame-Options': ['DENY'],
        'Referrer-Policy': ['strict-origin-when-cross-origin'],
      }
    });
    });
  }

  // Load URL
  if (process.env.ELECTRON_DEV === 'true') {
    const port = process.env.VITE_PORT || '5173';
    mainWindow.loadURL(`http://localhost:${port}`);
    mainWindow.webContents.openDevTools();
  } else {
    // In packaged app, renderer is in dist/renderer relative to app root
    const rendererPath = path.join(app.getAppPath(), 'dist', 'renderer', 'index.html');
    mainWindow.loadFile(rendererPath);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Lifecycle Events
app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  ptyManager.killAllLocalPty();
  telnetManager.disconnectAllTelnet();
  // SSH and FTP connections are cleaned up per-tab on disconnect,
  // but also ensure all are closed on quit
  sshManager.disconnectAllSSH && sshManager.disconnectAllSSH();
  ftpManager.disconnectAllFTP && ftpManager.disconnectAllFTP();
});

// Context menu for terminal - copy/paste
ipcMain.on('show-term-context-menu', (event, { type }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  const template = type === 'file'
    ? [
        { label: 'Copy Path', click: () => { win.webContents.send('term-context-action', 'copy'); } },
        { type: 'separator' },
        { label: 'Paste', click: () => { win.webContents.send('term-context-action', 'paste'); } }
      ]
    : [
        { label: 'Copy', click: () => { win.webContents.send('term-context-action', 'copy'); } },
        { label: 'Paste', click: () => { win.webContents.send('term-context-action', 'paste'); } },
        { type: 'separator' },
        { label: 'Select All', click: () => { win.webContents.send('term-context-action', 'selectAll'); } }
      ];
  const menu = Menu.buildFromTemplate(template);
  menu.popup({ window: win });
});

// Context menu for SFTP file items
ipcMain.on('show-sftp-context-menu', (event, { isDir, filePath, fileName }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  const webContents = win.webContents;
  const template = [];
  if (isDir) {
    template.push({ label: 'Open Directory', click: () => { webContents.send('sftp-context-action', { action: 'open', filePath }); } });
    template.push({ type: 'separator' });
    template.push({ label: 'Delete Directory', click: () => { webContents.send('sftp-context-action', { action: 'delete', filePath }); } });
  } else {
    template.push({ label: 'Download File', click: () => { webContents.send('sftp-context-action', { action: 'download', filePath }); } });
    template.push({ type: 'separator' });
    template.push({ label: 'Copy File Name', click: () => { clipboard.writeText(fileName); } });
    template.push({ label: 'Copy File Path', click: () => { clipboard.writeText(filePath); } });
    template.push({ type: 'separator' });
    template.push({ label: 'Delete File', click: () => { webContents.send('sftp-context-action', { action: 'delete', filePath }); } });
  }
  const menu = Menu.buildFromTemplate(template);
  menu.popup({ window: win });
});

// IPC Terminal Session Management
ipcMain.on('ssh-connect', (event, tabId, config) => {
  if (!validateSender(event)) return;
  // Restore secrets from the encrypted store when the renderer sent only
  // session metadata (saved session) - see resolveConnectConfig
  const connectConfig = resolveConnectConfig(config);
  if (!connectConfig) {
    if (mainWindow) mainWindow.webContents.send('ssh-error', tabId, 'Session not found');
    return;
  }

  sshManager.connectSSH(
    tabId,
    connectConfig,
    // onData callback
    (id, data) => {
      if (mainWindow) mainWindow.webContents.send('ssh-output', id, data);
    },
    // onClose callback
    (id, reason) => {
      if (mainWindow) mainWindow.webContents.send('ssh-close', id, reason);
    },
    // onError callback
    (id, message) => {
      if (mainWindow) mainWindow.webContents.send('ssh-error', id, message);
    },
    // onShellUnavailable callback: the host refused the interactive shell but
    // the connection (and therefore SFTP) stays usable - files-only mode
    (id, message) => {
      if (mainWindow) mainWindow.webContents.send('ssh-shell-unavailable', id, message);
    }
  );
});

ipcMain.on('ssh-data', (event, tabId, data) => {
  if (!validateSender(event)) return;
  sshManager.writeData(tabId, data);
});

ipcMain.on('ssh-resize', (event, tabId, cols, rows) => {
  if (!validateSender(event)) return;
  sshManager.resizeTerminal(tabId, cols, rows);
});

ipcMain.on('ssh-disconnect', (event, tabId) => {
  if (!validateSender(event)) return;
  sshManager.disconnectSSH(tabId);
});

// Local PTY IPC handlers
ipcMain.on('local-pty-create', (event, tabId) => {
  if (!validateSender(event)) return;
  ptyManager.createLocalPty(
    tabId,
    // onData
    (id, data) => {
      if (mainWindow) mainWindow.webContents.send('local-pty-output', id, data);
    },
    // onClose
    (id, reason) => {
      if (mainWindow) mainWindow.webContents.send('local-pty-close', id, reason);
    }
  );
});

ipcMain.on('local-pty-data', (event, tabId, data) => {
  if (!validateSender(event)) return;
  ptyManager.writeLocalPty(tabId, data);
});

ipcMain.on('local-pty-resize', (event, tabId, cols, rows) => {
  if (!validateSender(event)) return;
  ptyManager.resizeLocalPty(tabId, cols, rows);
});

ipcMain.on('local-pty-close', (event, tabId) => {
  if (!validateSender(event)) return;
  ptyManager.killLocalPty(tabId);
});

// IPC Sessions Store
ipcMain.handle('sessions-get', (event) => {
  if (!validateSender(event)) return [];
  return readSessions();
});

ipcMain.handle('sessions-save', (event, newSession) => {
  if (!validateSender(event)) return [];
  // IMPORTANT: read WITH decrypted secrets, otherwise writeSessions would
  // persist the (stripped) metadata-only entries returned by readSessions(),
  // wiping the encrypted passwords/passphrases of every other saved session.
  const sessions = readSessionsWithSecrets();
  const index = sessions.findIndex(s => s.id === newSession.id);
  if (index >= 0) {
    // Preserve existing secrets when the edited form omitted them
    const prev = sessions[index];
    if (prev) {
      if (newSession.password === undefined && prev.password) newSession.password = prev.password;
      if (newSession.passphrase === undefined && prev.passphrase) newSession.passphrase = prev.passphrase;
    }
    sessions[index] = newSession;
  } else {
    sessions.push(newSession);
  }
  writeSessions(sessions);
  // Re-read to return metadata-only list consistent with what renderer expects
  return readSessions();
});

ipcMain.handle('sessions-delete', (event, id) => {
  if (!validateSender(event)) return [];
  // Read WITH secrets so writeSessions re-encrypts & preserves the other sessions
  let sessions = readSessionsWithSecrets();
  sessions = sessions.filter(s => s.id !== id);
  writeSessions(sessions);
  return readSessions();
});

// IPC SFTP operations
ipcMain.handle('sftp-list', async (event, tabId, remotePath) => {
  if (!validateSender(event)) return { success: false, error: 'Invalid sender' };
  try {
    const list = await sshManager.sftpList(tabId, remotePath);
    return { success: true, list };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('sftp-download', async (event, tabId, remotePath, defaultFileName) => {
  if (!validateSender(event)) return { success: false, error: 'Invalid sender' };
  if (!mainWindow) return { success: false, error: 'No window available' };
  const { filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Download File',
    defaultPath: path.basename(defaultFileName || 'download'), // Sanitize to prevent path traversal
  });
  if (!filePath) return { success: false, aborted: true };

  try {
    await sshManager.sftpDownload(tabId, remotePath, filePath, (progress) => {
      if (mainWindow) mainWindow.webContents.send('transfer-progress', progress);
    });
    return { success: true, localPath: filePath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('sftp-upload', async (event, tabId, remotePath) => {
  if (!validateSender(event)) return { success: false, error: 'Invalid sender' };
  if (!mainWindow) return { success: false, error: 'No window available' };
  const { filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Select File to Upload',
    properties: ['openFile', 'multiSelections']
  });
  if (!filePaths || filePaths.length === 0) return { success: false, aborted: true };

  try {
    for (const localPath of filePaths) {
      const targetRemotePath = path.posix.join(remotePath, path.basename(localPath));
      await sshManager.sftpUpload(tabId, localPath, targetRemotePath, (progress) => {
        if (mainWindow) mainWindow.webContents.send('transfer-progress', progress);
      });
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// SFTP upload a specific local file (used by drag-and-drop)
ipcMain.handle('sftp-upload-file', async (event, tabId, localPath, remotePath) => {
  if (!validateSender(event)) return { success: false, error: 'Invalid sender' };
  // Validate localPath: must be a regular file, not a directory/symlink/special file
  // This prevents arbitrary file read (e.g., ~/.ssh/id_rsa, /etc/passwd)
  try {
    const stats = fs.statSync(localPath);
    if (!stats.isFile()) {
      return { success: false, error: 'Local path must be a regular file' };
    }
  } catch (e) {
    return { success: false, error: 'Local file not accessible' };
  }

  try {
    await sshManager.sftpUpload(tabId, localPath, remotePath, (progress) => {
      if (mainWindow) mainWindow.webContents.send('transfer-progress', progress);
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('sftp-delete', async (event, tabId, remotePath, isDir) => {
  if (!validateSender(event)) return { success: false, error: 'Invalid sender' };
  try {
    await sshManager.sftpDelete(tabId, remotePath, isDir);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('sftp-create-dir', async (event, tabId, remotePath) => {
  if (!validateSender(event)) return { success: false, error: 'Invalid sender' };
  try {
    await sshManager.sftpCreateDir(tabId, remotePath);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('sftp-rename', async (event, tabId, oldPath, newPath) => {
  if (!validateSender(event)) return { success: false, error: 'Invalid sender' };
  try {
    await sshManager.sftpRename(tabId, oldPath, newPath);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ─── FTP IPC handlers ────────────────────────────────────────────────────────

// FTP current directory tracking per tab
const ftpCurrentDirs = new Map(); // tabId -> currentPath

ipcMain.on('ftp-connect', (event, tabId, config) => {
  if (!validateSender(event)) return;
  // Restore secrets from the encrypted store when the renderer sent only
  // session metadata (saved session) - see resolveConnectConfig
  const connectConfig = resolveConnectConfig(config);
  if (!connectConfig) {
    if (mainWindow) mainWindow.webContents.send('ftp-error', tabId, 'Session not found');
    return;
  }

  ftpManager.connectFTP(
    tabId,
    connectConfig,
    (id, data) => {
      if (mainWindow) mainWindow.webContents.send('ftp-output', id, data);
    },
    (id, msg) => {
      if (mainWindow) mainWindow.webContents.send('ftp-error', id, msg);
    }
  );
  ftpCurrentDirs.set(tabId, '/');
});

ipcMain.on('ftp-data', (event, tabId, data) => {
  if (!validateSender(event)) return;
  const client = ftpManager.getClient(tabId);
  if (!client) {
    if (mainWindow) mainWindow.webContents.send('ftp-output', tabId, '\r\nNot connected\r\n');
    return;
  }

  const rawCmd = data.trim();
  const cmd = rawCmd.toUpperCase();

  // Echo the command
  if (mainWindow) mainWindow.webContents.send('ftp-output', tabId, '\r\n');

  if (cmd === 'LIST' || cmd === 'LS' || cmd === 'DIR') {
    const currentDir = ftpCurrentDirs.get(tabId) || '/';
    ftpManager.ftpList(tabId, currentDir)
      .then(list => {
        const output = list.map(f => `${f.isDir ? 'd' : '-'}  ${f.name}`).join('\r\n') + '\r\n';
        if (mainWindow) mainWindow.webContents.send('ftp-output', tabId, output);
      })
      .catch(err => {
        if (mainWindow) mainWindow.webContents.send('ftp-output', tabId, `Error: ${err.message}\r\n`);
      });
  } else if (cmd.startsWith('CD ')) {
    const dirPath = rawCmd.substring(3).trim();
    // Handle relative paths
    let newPath = dirPath;
    const currentDir = ftpCurrentDirs.get(tabId) || '/';
    if (!dirPath.startsWith('/')) {
      newPath = currentDir === '/' ? `/${dirPath}` : `${currentDir}/${dirPath}`;
    }
    // Normalize path to resolve .. and .
    newPath = path.posix.normalize(newPath);
    ftpManager.ftpList(tabId, newPath)
      .then(list => {
        // Only update current directory after successful LIST
        ftpCurrentDirs.set(tabId, newPath);
        const output = list.map(f => `${f.isDir ? 'd' : '-'}  ${f.name}`).join('\r\n') + '\r\n';
        if (mainWindow) mainWindow.webContents.send('ftp-output', tabId, output);
      })
      .catch(err => {
        if (mainWindow) mainWindow.webContents.send('ftp-output', tabId, `Cannot change to ${dirPath}: ${err.message}\r\n`);
      });
  } else if (cmd === 'PWD') {
    const currentDir = ftpCurrentDirs.get(tabId) || '/';
    if (mainWindow) mainWindow.webContents.send('ftp-output', tabId, `${currentDir}\r\n`);
  } else if (cmd === 'HELP' || cmd === '?') {
    if (mainWindow) mainWindow.webContents.send('ftp-output', tabId,
      'FTP commands:\r\n' +
      '  LIST / LS / DIR  — list files\r\n' +
      '  CD <path>        — change directory\r\n' +
      '  PWD              — show current directory\r\n' +
      '  HELP             — show this help\r\n'
    );
  } else if (cmd === '') {
    // Empty command — just do nothing
  } else {
    if (mainWindow) mainWindow.webContents.send('ftp-output', tabId, `Unknown command: ${rawCmd}. Type HELP for available commands.\r\n`);
  }
});

ipcMain.on('ftp-disconnect', (event, tabId) => {
  if (!validateSender(event)) return;
  ftpManager.disconnectFTP(tabId);
  ftpCurrentDirs.delete(tabId);
});

ipcMain.handle('ftp-list', async (event, tabId, remotePath) => {
  if (!validateSender(event)) return { success: false, error: 'Invalid sender' };
  try {
    const list = await ftpManager.ftpList(tabId, remotePath);
    return { success: true, list };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('ftp-download', async (event, tabId, remotePath, defaultFileName) => {
  if (!validateSender(event)) return { success: false, error: 'Invalid sender' };
  if (!mainWindow) return { success: false, error: 'No window available' };
  const { filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Download File',
    defaultPath: path.basename(defaultFileName || 'download'), // Sanitize to prevent path traversal
  });
  if (!filePath) return { success: false, aborted: true };
  try {
    await ftpManager.ftpDownload(tabId, remotePath, filePath, (progress) => {
      if (mainWindow) mainWindow.webContents.send('transfer-progress', progress);
    });
    return { success: true, localPath: filePath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('ftp-upload', async (event, tabId, remotePath) => {
  if (!validateSender(event)) return { success: false, error: 'Invalid sender' };
  if (!mainWindow) return { success: false, error: 'No window available' };
  const { filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Select File to Upload',
    properties: ['openFile']
  });
  if (!filePaths || filePaths.length === 0) return { success: false, aborted: true };
  const localPath = filePaths[0];
  const targetRemotePath = path.posix.join(remotePath, path.basename(localPath));
  try {
    await ftpManager.ftpUpload(tabId, localPath, targetRemotePath, (progress) => {
      if (mainWindow) mainWindow.webContents.send('transfer-progress', progress);
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// FTP upload a specific local file (used by drag-and-drop)
ipcMain.handle('ftp-upload-file', async (event, tabId, localPath, remotePath) => {
  if (!validateSender(event)) return { success: false, error: 'Invalid sender' };
  // Validate localPath: must be a regular file, not a directory/symlink/special file
  try {
    const stats = fs.statSync(localPath);
    if (!stats.isFile()) {
      return { success: false, error: 'Local path must be a regular file' };
    }
  } catch (e) {
    return { success: false, error: 'Local file not accessible' };
  }

  try {
    await ftpManager.ftpUpload(tabId, localPath, remotePath, (progress) => {
      if (mainWindow) mainWindow.webContents.send('transfer-progress', progress);
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('ftp-delete', async (event, tabId, remotePath, isDir) => {
  if (!validateSender(event)) return { success: false, error: 'Invalid sender' };
  try {
    if (isDir) await ftpManager.ftpDeleteDir(tabId, remotePath);
    else await ftpManager.ftpDeleteFile(tabId, remotePath);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('ftp-create-dir', async (event, tabId, remotePath) => {
  if (!validateSender(event)) return { success: false, error: 'Invalid sender' };
  try {
    await ftpManager.ftpCreateDir(tabId, remotePath);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ─── Telnet IPC handlers ─────────────────────────────────────────────────────

ipcMain.on('telnet-connect', (event, tabId, config) => {
  if (!validateSender(event)) return;
  // Restore connection params from the encrypted store when the renderer sent
  // only session metadata (saved session) - see resolveConnectConfig
  const connectConfig = resolveConnectConfig(config);
  if (!connectConfig) {
    if (mainWindow) mainWindow.webContents.send('telnet-error', tabId, 'Session not found');
    return;
  }

  telnetManager.connectTelnet(
    tabId,
    connectConfig.host,
    connectConfig.port,
    (id, data) => {
      if (mainWindow) mainWindow.webContents.send('telnet-output', id, data);
    },
    (id, reason) => {
      if (mainWindow) mainWindow.webContents.send('telnet-close', id, reason);
    },
    (id, msg) => {
      if (mainWindow) mainWindow.webContents.send('telnet-error', id, msg);
    }
  );
});

ipcMain.on('telnet-data', (event, tabId, data) => {
  if (!validateSender(event)) return;
  telnetManager.writeTelnetData(tabId, data);
});

ipcMain.on('telnet-resize', (event, tabId, cols, rows) => {
  if (!validateSender(event)) return;
  telnetManager.resizeTelnet(tabId, cols, rows);
});

ipcMain.on('telnet-disconnect', (event, tabId) => {
  if (!validateSender(event)) return;
  telnetManager.disconnectTelnet(tabId);
});
