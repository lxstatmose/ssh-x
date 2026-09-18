const { Client: FtpClient } = require('basic-ftp');
const fs = require('fs');
const path = require('path');

const connections = new Map(); // tabId -> ftp.Client

// Shape the renderer's transfer-progress event (same payload as the SFTP path).
function reportProgress(onProgress, tabId, type, file, transferred, total) {
  onProgress({
    tabId,
    type,
    file,
    percent: total > 0 ? Math.min(100, Math.round((transferred / total) * 100)) : 0,
    transferred,
    total,
  });
}

function connectFTP(tabId, config, onData, onError) {
  disconnectFTP(tabId);

  // Strip protocol prefix if user accidentally pasted URL (handles ftp:// and ftps://)
  let host = config.host || '';
  host = host.replace(/^ftps?:\/\//i, '').replace(/\/+$/, '');

  if (!host) {
    onError(tabId, 'FTP connection failed: host is empty');
    return;
  }

  const client = new FtpClient();
  client.ftp.verbose = false;

  const connectConfig = {
    host: host,
    port: parseInt(config.port) || 21,
    user: config.username || 'anonymous',
    password: config.password || 'anonymous@',
    secure: config.secure || false,
  };

  client.access(connectConfig)
    .then(() => {
      connections.set(tabId, client);
      onData(tabId, `Connected to ${host}:${connectConfig.port}\r\n`);
    })
    .catch(err => {
      onError(tabId, `FTP connection failed: ${err.message}`);
    });
}

function disconnectFTP(tabId) {
  const client = connections.get(tabId);
  if (client) {
    try { client.close(); } catch (e) {}
    connections.delete(tabId);
  }
}

// Disconnect all FTP connections (used on app quit)
function disconnectAllFTP() {
  for (const client of connections.values()) {
    try { client.close(); } catch (e) {}
  }
  connections.clear();
}

async function ftpList(tabId, remotePath) {
  const client = connections.get(tabId);
  if (!client) throw new Error('Not connected');
  const list = await client.list(remotePath || '/');
  return list.map(item => ({
    name: item.name,
    isDir: item.isDirectory,
    size: item.size || 0,
    mtime: item.modifiedAt ? item.modifiedAt.getTime() : 0,
  })).sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

async function ftpDownload(tabId, remotePath, localPath, onProgress) {
  const client = connections.get(tabId);
  if (!client) throw new Error('Not connected');
  // SIZE is optional in RFC 959 and plenty of servers refuse it; when it fails
  // the renderer simply falls back to a byte counter instead of a percentage.
  let total = 0;
  try { total = await client.size(remotePath); } catch (e) { total = 0; }
  const name = path.posix.basename(remotePath);
  if (onProgress) {
    // basic-ftp's ProgressTracker throttles callbacks to ~2/s per transfer,
    // so no extra debouncing is needed before forwarding to the renderer.
    client.trackProgress((info) => {
      if (info.type === 'download') reportProgress(onProgress, tabId, 'download', name, info.bytes, total);
    });
  }
  try {
    await client.downloadTo(localPath, remotePath);
  } finally {
    if (onProgress) {
      client.trackProgress(); // stop tracking
      if (total > 0) reportProgress(onProgress, tabId, 'download', name, total, total);
    }
  }
}

async function ftpUpload(tabId, localPath, remotePath, onProgress) {
  const client = connections.get(tabId);
  if (!client) throw new Error('Not connected');
  let total = 0;
  try { total = fs.statSync(localPath).size; } catch (e) { total = 0; }
  const name = path.basename(localPath);
  if (onProgress) {
    client.trackProgress((info) => {
      if (info.type === 'upload') reportProgress(onProgress, tabId, 'upload', name, info.bytes, total);
    });
  }
  try {
    await client.uploadFrom(localPath, remotePath);
  } finally {
    if (onProgress) {
      client.trackProgress(); // stop tracking
      if (total > 0) reportProgress(onProgress, tabId, 'upload', name, total, total);
    }
  }
}

async function ftpDeleteFile(tabId, remotePath) {
  const client = connections.get(tabId);
  if (!client) throw new Error('Not connected');
  await client.remove(remotePath);
}

async function ftpDeleteDir(tabId, remotePath) {
  const client = connections.get(tabId);
  if (!client) throw new Error('Not connected');
  await client.removeDir(remotePath);
}

async function ftpCreateDir(tabId, remotePath) {
  const client = connections.get(tabId);
  if (!client) throw new Error('Not connected');
  // basic-ftp's ensureDir changes the working directory, so save/restore it
  const currentDir = await client.pwd();
  await client.ensureDir(remotePath);
  await client.cd(currentDir);
}

module.exports = {
  connectFTP,
  disconnectFTP,
  disconnectAllFTP,
  ftpList,
  ftpDownload,
  ftpUpload,
  ftpDeleteFile,
  ftpDeleteDir,
  ftpCreateDir,
  getClient: (tabId) => connections.get(tabId),
};
