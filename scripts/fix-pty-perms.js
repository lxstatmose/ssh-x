#!/usr/bin/env node
/**
 * Ensures node-pty's spawn-helper binaries are executable.
 *
 * npm strips the exec bit from files inside prebuilds/ when installing the
 * package, so in a packaged app (where electron-builder excludes build/Release
 * and node-pty falls back to prebuilds/) posix_spawnp fails with:
 *   "Spawn failed: posix_spawnp failed."
 *
 * Runs on every `npm install` (postinstall hook) so freshly cloned checkouts
 * and CI builds get correct permissions automatically.
 */
const fs = require('fs');
const path = require('path');

const ptyRoot = path.join(__dirname, '..', 'node_modules', 'node-pty');

// build/Release is produced by @electron/rebuild and already has +x; the
// prebuilds shipped in the npm tarball are the ones missing it.
const helperDirs = [
  path.join(ptyRoot, 'prebuilds'),
  path.join(ptyRoot, 'build', 'Release'),
];

let fixed = 0;

// Recurses into subdirectories so both prebuilds/<platform>-<arch>/ and
// build/Release/ layouts are covered.
function fixDir(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    let stat;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      fixDir(full);
      continue;
    }
    if (entry === 'spawn-helper' && stat.isFile() && !(stat.mode & 0o111)) {
      fs.chmodSync(full, 0o755);
      fixed++;
      console.log(`[fix-pty-perms] chmod +x ${path.relative(process.cwd(), full)}`);
    }
  }
}

for (const dir of helperDirs) fixDir(dir);

if (fixed > 0) {
  console.log(`[fix-pty-perms] fixed ${fixed} spawn-helper file(s)`);
} else {
  console.log('[fix-pty-perms] all spawn-helper binaries already executable');
}
