const pty = require('node-pty');
const os = require('os');

const ptyProcesses = new Map(); // tabId -> pty.IPty

function createLocalPty(tabId, onData, onClose) {
  // Clean up if already exists
  killLocalPty(tabId);

  const isWin = process.platform === 'win32';

  // Choose default shell depending on OS
  let shell;
  const shellArgs = [];
  if (isWin) {
    shell = process.env.COMSPEC || 'powershell.exe';
  } else {
    // Detect preferred shell or fall back to standard zsh/bash
    shell = process.env.SHELL || '/bin/zsh';
    // Spawn as a LOGIN shell so the user's profile is loaded.
    // On macOS ~/.zprofile sets up PATH additions (e.g. ~/.local/bin,
    // where tools like `claude` are installed). Without -l those PATH
    // entries are missing and the terminal can't run them.
    shellArgs.push('-l');
  }

  console.log(`Spawning local PTY shell: ${shell} for tab ${tabId}`);

  try {
    const ptyProcess = pty.spawn(shell, shellArgs, {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: process.env.HOME || os.homedir() || process.cwd(),
      env: {
        ...process.env,
        // Make sure we inform utilities we support 256 colors
        TERM: 'xterm-256color',
        // A GUI-launched app (e.g. from Finder) gets no LANG/LC_ALL from
        // launchd, so the shell starts in the "C" locale. zsh's line editor
        // then counts multi-byte UTF-8 characters as single bytes, which
        // garbles Cyrillic input and lets backspace eat the prompt. Force a
        // UTF-8 locale when none is set; respect the user's choice otherwise.
        ...ensureUtf8Locale(process.env)
      }
    });

    ptyProcesses.set(tabId, ptyProcess);

    // Stream output to renderer
    ptyProcess.onData((data) => {
      onData(tabId, data);
    });

    // Handle process exit
    ptyProcess.onExit(({ exitCode }) => {
      console.log(`PTY shell exited for tab ${tabId} with code ${exitCode}`);
      onClose(tabId, `Exit code ${exitCode}`);
      ptyProcesses.delete(tabId);
    });

  } catch (err) {
    console.error(`Failed to spawn PTY:`, err);
    onClose(tabId, `Spawn failed: ${err.message}`);
  }
}

// Choose a UTF-8 locale for the shell if the ambient environment didn't.
// GUI apps (e.g. launched from Finder) inherit a stripped-down environment
// from launchd — usually no LANG/LC_ALL. zsh then falls back to the "C"
// locale, where the line editor counts multi-byte UTF-8 bytes as individual
// characters: Cyrillic input gets garbled and backspace can chew over the
// prompt. If the user already selected a locale (any locale), respect it.
function ensureUtf8Locale(env) {
  const locale = env.LC_ALL || env.LC_CTYPE || env.LANG;
  if (locale) return {}; // explicit user choice — leave it alone
  // No macOS locale configured at all: default to the universal UTF-8
  // locale shipped by macOS (en_US.UTF-8). LC_ALL makes it authoritative.
  return { LC_ALL: 'en_US.UTF-8', LANG: 'en_US.UTF-8' };
}

function writeLocalPty(tabId, data) {
  const ptyProcess = ptyProcesses.get(tabId);
  if (ptyProcess) {
    ptyProcess.write(data);
  }
}

function resizeLocalPty(tabId, cols, rows) {
  const ptyProcess = ptyProcesses.get(tabId);
  if (ptyProcess) {
    try {
      ptyProcess.resize(cols, rows);
    } catch (err) {
      console.error(`Failed to resize PTY:`, err);
    }
  }
}

function killLocalPty(tabId) {
  const ptyProcess = ptyProcesses.get(tabId);
  if (ptyProcess) {
    try {
      ptyProcess.kill();
    } catch (err) {
      console.error(`Failed to kill PTY:`, err);
    }
    ptyProcesses.delete(tabId);
  }
}

// Kill all processes on exit
function killAllLocalPty() {
  for (const ptyProcess of ptyProcesses.values()) {
    try {
      ptyProcess.kill();
    } catch (e) {}
  }
  ptyProcesses.clear();
}

module.exports = {
  createLocalPty,
  writeLocalPty,
  resizeLocalPty,
  killLocalPty,
  killAllLocalPty
};
