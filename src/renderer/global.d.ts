export interface SshConfig {
  id?: string;
  name?: string;
  host: string;
  port: string | number;
  username: string;
  authMethod: 'password' | 'key';
  password?: string;
  keyPath?: string;
  passphrase?: string;
  protocol?: 'ssh' | 'ftp' | 'telnet' | 'local';
  secure?: boolean; // FTPS
}

export interface FtpConfig {
  id?: string;
  name?: string;
  host: string;
  port: string | number;
  username: string;
  password?: string;
  secure?: boolean; // FTPS
}

export interface TelnetConfig {
  id?: string;
  name?: string;
  host: string;
  port: string | number;
}

export interface SftpFile {
  name: string;
  isDir: boolean;
  size: number;
  mtime: number;
  permissions?: number;
}

export interface ElectronApi {
  // SSH
  connectSSH: (tabId: string, config: SshConfig) => void;
  writeSshData: (tabId: string, data: string) => void;
  resizeSsh: (tabId: string, cols: number, rows: number) => void;
  disconnectSSH: (tabId: string) => void;
  onSshOutput: (callback: (tabId: string, data: Uint8Array | string) => void) => () => void;
  onSshClose: (callback: (tabId: string, reason: string) => void) => () => void;
  onSshError: (callback: (tabId: string, message: string) => void) => () => void;

  // Sessions
  getSavedSessions: () => Promise<SshConfig[]>;
  saveSession: (session: SshConfig) => Promise<SshConfig[]>;
  deleteSession: (id: string) => Promise<SshConfig[]>;

  // SFTP
  sftpList: (tabId: string, remotePath: string) => Promise<{ success: boolean; list?: SftpFile[]; error?: string }>;
  sftpDownload: (tabId: string, remotePath: string, defaultFileName: string) => Promise<{ success: boolean; localPath?: string; aborted?: boolean; error?: string }>;
  sftpUpload: (tabId: string, remotePath: string) => Promise<{ success: boolean; aborted?: boolean; error?: string }>;
  sftpUploadFile: (tabId: string, localPath: string, remotePath: string) => Promise<{ success: boolean; error?: string }>;
  sftpDelete: (tabId: string, remotePath: string, isDir: boolean) => Promise<{ success: boolean; error?: string }>;
  sftpCreateDir: (tabId: string, remotePath: string) => Promise<{ success: boolean; error?: string }>;
  sftpRename: (tabId: string, oldPath: string, newPath: string) => Promise<{ success: boolean; error?: string }>;

  // FTP
  connectFtp: (tabId: string, config: FtpConfig) => void;
  sendFtpCommand: (tabId: string, data: string) => void;
  disconnectFtp: (tabId: string) => void;
  onFtpOutput: (callback: (tabId: string, data: string) => void) => () => void;
  onFtpError: (callback: (tabId: string, message: string) => void) => () => void;
  ftpList: (tabId: string, remotePath: string) => Promise<{ success: boolean; list?: SftpFile[]; error?: string }>;
  ftpDownload: (tabId: string, remotePath: string, defaultFileName: string) => Promise<{ success: boolean; localPath?: string; aborted?: boolean; error?: string }>;
  ftpUpload: (tabId: string, remotePath: string) => Promise<{ success: boolean; aborted?: boolean; error?: string }>;
  ftpUploadFile: (tabId: string, localPath: string, remotePath: string) => Promise<{ success: boolean; error?: string }>;
  ftpDelete: (tabId: string, remotePath: string, isDir: boolean) => Promise<{ success: boolean; error?: string }>;
  ftpCreateDir: (tabId: string, remotePath: string) => Promise<{ success: boolean; error?: string }>;

  // Telnet
  connectTelnet: (tabId: string, config: TelnetConfig) => void;
  sendTelnetData: (tabId: string, data: string) => void;
  resizeTelnet: (tabId: string, cols: number, rows: number) => void;
  disconnectTelnet: (tabId: string) => void;
  onTelnetOutput: (callback: (tabId: string, data: Uint8Array | string) => void) => () => void;
  onTelnetClose: (callback: (tabId: string, reason: string) => void) => () => void;
  onTelnetError: (callback: (tabId: string, message: string) => void) => () => void;

  // Context Menu
  showTermContextMenu: (type: string) => void;
  onTermContextAction: (callback: (action: string) => void) => () => void;
  showSftpContextMenu: (options: { isDir: boolean; filePath: string; fileName: string }) => void;
  onSftpContextAction: (callback: (data: { action: string; filePath: string }) => void) => () => void;

  // Transfer Progress
  onTransferProgress: (callback: (data: { tabId: string; type: string; file: string; percent: number; transferred: number; total: number }) => void) => () => void;

  // Local files — dropped file path resolution (Electron 32+ webUtils)
  getPathForFile: (file: File) => string;

  // Local PTY
  connectLocalPty: (tabId: string) => void;
  writeLocalPtyData: (tabId: string, data: string) => void;
  resizeLocalPty: (tabId: string, cols: number, rows: number) => void;
  disconnectLocalPty: (tabId: string) => void;
  onLocalPtyOutput: (callback: (tabId: string, data: string) => void) => () => void;
  onLocalPtyClose: (callback: (tabId: string, reason: string) => void) => () => void;
}

declare global {
  interface Window {
    api: ElectronApi;
  }
}

declare module '*.css' {
  const content: string;
  export default content;
}

// For side-effect imports like import '@xterm/xterm/css/xterm.css'
declare module '@xterm/xterm/css/xterm.css' {
  // Side-effect import - no exports needed
  const _: void;
  export = _;
}
