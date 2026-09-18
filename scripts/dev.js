const { spawn } = require('child_process');

// Determine executable names based on platform
const isWin = process.platform === 'win32';
const npxCmd = isWin ? 'npx.cmd' : 'npx';

console.log('Starting Vite dev server...');
const viteProcess = spawn(npxCmd, ['vite'], {
  stdio: ['inherit', 'pipe', 'inherit'],
  shell: true
});

let electronProcess = null;

viteProcess.stdout.on('data', (data) => {
  const output = data.toString();
  process.stdout.write(data);

  // When Vite server is ready, launch Electron
  if ((output.includes('Local:') || output.includes('Ready in')) && !electronProcess) {
    let port = '5173';
    const match = output.match(/localhost:(\d+)/);
    if (match && match[1]) {
      port = match[1];
    }
    console.log(`Vite server is ready on port ${port}! Launching Electron...`);
    
    // Run electron pointing to the main project directory
    electronProcess = spawn(npxCmd, ['electron', '.'], {
      stdio: 'inherit',
      shell: true,
      env: {
        ...process.env,
        ELECTRON_DEV: 'true',
        VITE_PORT: port
      }
    });

    electronProcess.on('close', (code) => {
      console.log(`Electron process exited with code ${code}`);
      viteProcess.kill();
      process.exit(code);
    });
  }
});

viteProcess.on('close', (code) => {
  console.log(`Vite process exited with code ${code}`);
  if (electronProcess) {
    electronProcess.kill();
  }
  process.exit(code);
});
