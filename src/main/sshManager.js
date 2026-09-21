const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

// Maps to store active sessions
const clients = new Map(); // tabId -> ssh2.Client
const shellStreams = new Map(); // tabId -> shell stream
const sftpClients = new Map(); // tabId -> SFTP client

// Known hosts file path
const KNOWN_HOSTS_PATH = path.join(app.getPath('userData'), 'known_hosts');

/**
 * Load known hosts from file
 * Format: hostname,key_type,base64_public_key
 */
function loadKnownHosts() {
  const knownHosts = new Map();
  if (!fs.existsSync(KNOWN_HOSTS_PATH)) return knownHosts;

  try {
    const content = fs.readFileSync(KNOWN_HOSTS_PATH, 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const [hostPattern, keyType, publicKey] = trimmed.split(',');
      if (hostPattern && keyType && publicKey) {
        if (!knownHosts.has(hostPattern)) knownHosts.set(hostPattern, []);
        knownHosts.get(hostPattern).push({ keyType, publicKey });
      }
    }
  } catch (e) {
    console.error('Failed to load known_hosts:', e);
  }
  return knownHosts;
}

/**
 * Save known hosts to file
 */
function saveKnownHosts(knownHosts) {
  try {
    const lines = ['# SSH known hosts file for ssh-x'];
    for (const [hostPattern, keys] of knownHosts.entries()) {
      for (const { keyType, publicKey } of keys) {
        lines.push(`${hostPattern},${keyType},${publicKey}`);
      }
    }
    fs.writeFileSync(KNOWN_HOSTS_PATH, lines.join('\n') + '\n', { mode: 0o600 });
  } catch (e) {
    console.error('Failed to save known_hosts:', e);
  }
}

/**
 * Verify host key against known hosts
 * Returns: 'ok' | 'changed' | 'unknown'
 */
function verifyHostKey(hostname, port, serverKey) {
  const knownHosts = loadKnownHosts();
  const keyType = serverKey.type; // e.g., 'ssh-rsa', 'ssh-ed25519', 'ecdsa-sha2-nistp256'
  const publicKey = serverKey.getPublicSSH().toString('base64');

  // Match hostname with optional port
  const hostWithPort = `[${hostname}]:${port}`;
  const entries = knownHosts.get(hostname) || knownHosts.get(hostWithPort) || [];

  if (entries.length === 0) {
    return 'unknown';
  }

  for (const entry of entries) {
    if (entry.keyType === keyType && entry.publicKey === publicKey) {
      return 'ok';
    }
  }

  // Host known but key doesn't match
  return 'changed';
}

/**
 * Add or update host key in known hosts (TOFU - Trust On First Use)
 */
function trustHostKey(hostname, port, serverKey) {
  const knownHosts = loadKnownHosts();
  const keyType = serverKey.type;
  const publicKey = serverKey.getPublicSSH().toString('base64');
  const hostWithPort = `[${hostname}]:${port}`;

  // Remove any existing entries for this host (all key types)
  knownHosts.delete(hostname);
  knownHosts.delete(hostWithPort);

  // Add new entry
  knownHosts.set(hostWithPort, [{ keyType, publicKey }]);
  saveKnownHosts(knownHosts);
}

// Helper to get or create SFTP client
// Track pending SFTP creation requests to prevent race conditions
const pendingSftpRequests = new Map(); // tabId -> Promise

function getSFTP(tabId) {
  // Return existing SFTP client if available
  const sftp = sftpClients.get(tabId);
  if (sftp) {
    return Promise.resolve(sftp);
  }

  // Return pending request if one is already in progress
  if (pendingSftpRequests.has(tabId)) {
    return pendingSftpRequests.get(tabId);
  }

  // Create new SFTP session
  // Note: conn.sftp(cb) returns the Client instance (not a Promise), so the
  // pending-request cleanup must hang off THIS wrapper promise, not off
  // conn.sftp()'s return value - calling .finally() on it throws TypeError
  // and rejects every SFTP request.
  const promise = new Promise((resolve, reject) => {
    const conn = clients.get(tabId);
    if (!conn) {
      return reject(new Error('No active SSH connection for this tab'));
    }
    conn.sftp((err, sftpInst) => {
      if (err) return reject(err);
      sftpClients.set(tabId, sftpInst);
      resolve(sftpInst);
    });
  }).finally(() => {
    pendingSftpRequests.delete(tabId);
  });

  pendingSftpRequests.set(tabId, promise);
  return promise;
}

function connectSSH(tabId, config, onData, onClose, onError, onShellUnavailable) {
  // Clean up existing if any
  disconnectSSH(tabId);

  // Optional notification used when the server refuses the interactive shell
  // but the connection itself stays usable (see the shell error handler below)
  const notifyShellUnavailable = typeof onShellUnavailable === 'function'
    ? onShellUnavailable
    : () => {};

  const conn = new Client();
  clients.set(tabId, conn);

  // Guard to prevent onClose being called twice (stream close + conn close)
  let closeFired = false;
  const fireClose = (reason) => {
    if (closeFired) return;
    closeFired = true;
    onClose(tabId, reason);
    disconnectSSH(tabId);
  };

  // Prepare connection config
  const connConfig = {
    host: config.host,
    port: parseInt(config.port) || 22,
    username: config.username,
  };

  if (config.authMethod === 'key') {
    try {
      connConfig.privateKey = fs.readFileSync(config.keyPath);
      if (config.passphrase) {
        connConfig.passphrase = config.passphrase;
      }
    } catch (err) {
      onError(tabId, `Failed to read key file: ${err.message}`);
      return;
    }
  } else {
    connConfig.password = config.password;

    // Some hosts (embedded NAS boxes, SFTP-only platforms, PAM setups with
    // PasswordAuthentication disabled) advertise only the
    // `keyboard-interactive` method. FileZilla and other clients answer those
    // prompts transparently, but ssh2 ignores the method unless `tryKeyboard`
    // is enabled - which looked like "All configured authentication methods
    // failed" against servers every other tool could reach. Answer every
    // prompt with the configured password (the only secret we have).
    connConfig.tryKeyboard = true;
    conn.on('keyboard-interactive', (name, instructions, lang, prompts, finish) => {
      finish(prompts.map(() => config.password || ''));
    });
  }

  // Host key verification (Trust On First Use)
  const hostPort = parseInt(config.port) || 22;
  conn.on('hostkey', (key, verify) => {
    const result = verifyHostKey(config.host, hostPort, key);

    if (result === 'ok') {
      verify(true);
    } else if (result === 'unknown') {
      // First time connecting to this host - trust it (TOFU)
      trustHostKey(config.host, hostPort, key);
      verify(true);
    } else {
      // Key changed - this is a potential MITM attack.
      // Must call verify(false) so ssh2 stops awaiting the callback and
      // tears down the connection instead of hanging until timeout.
      verify(false);
      onError(tabId, `WARNING: Host key for ${config.host} has changed! This could indicate a man-in-the-middle attack. Connection refused. Remove the old key from ${KNOWN_HOSTS_PATH} to reconnect.`);
      fireClose('Host key verification failed');
      disconnectSSH(tabId);
    }
  });

  conn.on('ready', () => {
    // Start terminal shell
    conn.shell({ term: 'xterm-color', cols: 80, rows: 24 }, (err, stream) => {
      if (err) {
        // A host may refuse the interactive shell while still serving the SFTP
        // subsystem (NAS with SSH access disabled, SFTP-only/chrooted accounts,
        // SFTPGo users without a shell, AWS Transfer Family, ...). FileZilla and
        // other SFTP clients never request a shell, so they keep working.
        // Tearing the connection down here made the file manager unusable
        // against every such server ("No active SSH connection for this tab"),
        // so keep the SSH connection alive and let the renderer switch this
        // panel into files-only mode.
        notifyShellUnavailable(tabId, err.message || 'Shell request refused by server');
        return;
      }

      shellStreams.set(tabId, stream);

      stream.on('data', (data) => {
        onData(tabId, data);
      });

      stream.on('close', () => {
        fireClose('Shell closed');
      });
    });
  });

  conn.on('error', (err) => {
    onError(tabId, err.message);
    disconnectSSH(tabId);
  });

  conn.on('close', () => {
    fireClose('Connection closed');
  });

  // Connect
  try {
    conn.connect(connConfig);
  } catch (err) {
    onError(tabId, `Connection error: ${err.message}`);
  }
}

function writeData(tabId, data) {
  const stream = shellStreams.get(tabId);
  if (stream) {
    stream.write(data);
  }
}

function resizeTerminal(tabId, cols, rows) {
  const stream = shellStreams.get(tabId);
  if (stream) {
    stream.setWindow(rows, cols, 0, 0);
  }
}

function disconnectSSH(tabId) {
  // Close SFTP Client if any
  const sftp = sftpClients.get(tabId);
  if (sftp) {
    sftpClients.delete(tabId);
  }

  // Clear pending SFTP request
  pendingSftpRequests.delete(tabId);

  // Close Shell Stream if any
  const stream = shellStreams.get(tabId);
  if (stream) {
    stream.end();
    shellStreams.delete(tabId);
  }

  // Close main client connection
  const conn = clients.get(tabId);
  if (conn) {
    conn.end();
    clients.delete(tabId);
  }
}

// Disconnect all SSH connections (used on app quit)
function disconnectAllSSH() {
  for (const [tabId] of sftpClients.entries()) {
    sftpClients.delete(tabId);
  }
  for (const [tabId, stream] of shellStreams.entries()) {
    try { stream.end(); } catch (e) {}
    shellStreams.delete(tabId);
  }
  for (const [tabId, conn] of clients.entries()) {
    try { conn.end(); } catch (e) {}
    clients.delete(tabId);
  }
}

// SFTP functions
async function sftpList(tabId, remotePath) {
  const sftp = await getSFTP(tabId);
  return new Promise((resolve, reject) => {
    sftp.readdir(remotePath, (err, list) => {
      if (err) return reject(err);
      
      // Map attributes to a cleaner format
      const files = list.map(item => {
        // Check if directory using multiple methods for reliability
        let isDir;
        if (item.attrs.isDirectory) {
          // ssh2 provides this if available
          isDir = item.attrs.isDirectory();
        } else if (typeof item.attrs.mode === 'number') {
          // Check mode bits: S_IFDIR = 0o040000
          isDir = (item.attrs.mode & 0o170000) === 0o040000;
        } else {
          // Fallback to longname parsing
          isDir = item.longname.charAt(0) === 'd';
        }

        return {
          name: item.filename,
          isDir: isDir,
          size: item.attrs.size,
          mtime: item.attrs.mtime * 1000, // convert s to ms
          permissions: item.attrs.permissions
        };
      });

      // Sort: directories first, then alphabetically
      files.sort((a, b) => {
        if (a.isDir !== b.isDir) {
          return a.isDir ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });

      resolve(files);
    });
  });
}

async function sftpDownload(tabId, remotePath, localPath, onProgress) {
  const sftp = await getSFTP(tabId);
  return new Promise((resolve, reject) => {
    sftp.fastGet(remotePath, localPath, {
      // ssh2 step callback: step(transferred, chunk, total)
      step: (transferred, chunk, total) => {
        if (onProgress) {
          const percent = Math.round((transferred / total) * 100);
          onProgress({ tabId, type: 'download', file: remotePath, percent, transferred, total });
        }
      }
    }, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

async function sftpUpload(tabId, localPath, remotePath, onProgress) {
  const sftp = await getSFTP(tabId);
  return new Promise((resolve, reject) => {
    sftp.fastPut(localPath, remotePath, {
      // ssh2 step callback: step(transferred, chunk, total)
      step: (transferred, chunk, total) => {
        if (onProgress) {
          const percent = Math.round((transferred / total) * 100);
          onProgress({ tabId, type: 'upload', file: path.basename(localPath), percent, transferred, total });
        }
      }
    }, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

async function sftpDelete(tabId, remotePath, isDir = false) {
  const sftp = await getSFTP(tabId);
  return new Promise((resolve, reject) => {
    if (isDir) {
      sftp.rmdir(remotePath, (err) => {
        if (err) reject(err);
        else resolve();
      });
    } else {
      sftp.unlink(remotePath, (err) => {
        if (err) reject(err);
        else resolve();
      });
    }
  });
}

async function sftpCreateDir(tabId, remotePath) {
  const sftp = await getSFTP(tabId);
  return new Promise((resolve, reject) => {
    sftp.mkdir(remotePath, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

// Escape shell argument to prevent command injection
function shellEscape(arg) {
  // Use single quotes and escape any existing single quotes
  return "'" + arg.replace(/'/g, "'\\''") + "'";
}

async function sftpRename(tabId, oldPath, newPath) {
  const sftp = await getSFTP(tabId);
  return new Promise((resolve, reject) => {
    sftp.rename(oldPath, newPath, (err) => {
      if (err) {
        // Fallback: try SSH exec mv command with proper escaping
        const conn = clients.get(tabId);
        if (conn) {
          const cmd = `mv ${shellEscape(oldPath)} ${shellEscape(newPath)}`;
          conn.exec(cmd, (execErr, stream) => {
            if (execErr) return reject(execErr);
            stream.on('close', (code) => {
              if (code === 0) resolve();
              else reject(new Error(`mv exited with code ${code}`));
            });
            stream.on('error', reject);
          });
        } else {
          reject(err);
        }
      } else {
        resolve();
      }
    });
  });
}

module.exports = {
  connectSSH,
  writeData,
  resizeTerminal,
  disconnectSSH,
  disconnectAllSSH,
  sftpList,
  sftpDownload,
  sftpUpload,
  sftpDelete,
  sftpCreateDir,
  sftpRename
};
