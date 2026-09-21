# SSH-X

**English** | [Русский](README.ru.md)

**A retro monochrome SSH / SFTP / FTP / Telnet / local terminal client for macOS.**

<p>
  <img alt="License" src="https://img.shields.io/badge/license-ISC-blue.svg">
  <img alt="Platform" src="https://img.shields.io/badge/platform-macOS%20(universal)-black.svg">
  <img alt="Electron" src="https://img.shields.io/badge/electron-42-47848f.svg">
  <img alt="React" src="https://img.shields.io/badge/react-19-61dafb.svg">
</p>

![SSH-X icon](assets/icon.png)

```
┌─ SSH-X ────────────────────────────────────────  SPLIT →  SPLIT ↓  12:04:31 ─┐
│ SAVED SESSIONS      │ [prod-db] │ [home] │ +                                │
│                     ├───────────────────────────┬──────────────────────────┤
│ ▸ prod-db      EDIT │ [SSH: root@10.0.0.4:22]   │ SFTP EXPLORER            │
│ ▸ staged       EDIT │ $ git status              │  ↑ UP  /srv/www          │
│ ▸ router       EDIT │ On branch main            │  DIR  .git               │
│ ▸ [LOCAL SHELL] EDIT│ nothing to commit         │  FILE index.html   12 KB │
│                     │ $ █                       │  FILE app.js       88 KB │
│ + ADD SESSION       │                           │  3 dirs, 12 files        │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Features

| Area | What you get |
|---|---|
| **SSH** | Password and private-key auth, trust-on-first-use host key verification against a private `known_hosts`, clear refusal on key change (MITM protection) |
| **SFTP** | Integrated file manager per session: browse, upload (dialog + drag & drop), download, rename, mkdir, delete, copy path/name, live transfer progress. Works against hosts that refuse an interactive shell (NAS with SSH disabled, chrooted/SFTP-only accounts) — such sessions open in files-only mode instead of failing. SFTP is also a protocol of its own in the connect dialog: the session opens straight into the file manager (files-first, full panel) with `SHOW TERMINAL` one click away |
| **FTP / FTPS** | Explicit-TLS FTP support with the same file manager and progress reporting, plus a small built-in command console |
| **Telnet** | Raw telnet client with a real IAC parser (partial sequences across packets) and NAWS window-size negotiation |
| **Local terminal** | Login shell (`zsh -l`) inside the app, so your `~/.zprofile` PATH additions work; forces a UTF-8 locale for correct Cyrillic input under a GUI launch |
| **Tabs & splits** | Multiple tabs, each splittable horizontally/vertically into independent panes with resizable side panels |
| **Session manager** | Saved sessions with AES-256-GCM encrypted passwords, atomic writes, `0600` permissions; secrets never leave the main process |
| **Terminal UX** | xterm.js with JetBrains Mono (bundled locally — no network dependency), 10k scrollback, auto-focus after tab switch/click/resize, context menu with copy/paste/select-all/clear |

### Security posture

- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`
- Strict CSP + `nosniff` / `X-Frame-Options: DENY` in production
- Every IPC channel validates the sender window; local file paths for uploads are checked to be regular files
- Passwords are encrypted with a key derived from a per-machine secret stored in `userData`
- Renderer never receives stored secrets — they are injected only inside the main process at connect time
- `window.open` and navigation away from the app are denied

## Requirements

- macOS 11+ (Apple Silicon or Intel — the packaged build is universal)
- Node.js 20+ and npm

## Development

```bash
git clone https://github.com/lxstatmose/ssh-x.git
cd ssh-x
npm install          # also fixes node-pty spawn-helper permissions (postinstall)

npm run dev          # Vite dev server + Electron with HMR
```

No native rebuild step is needed: `node-pty` ships N-API prebuilds for both
architectures and `ssh2` ships its own prebuilt crypto binding, so
`electron-builder.yml` sets `npmRebuild: false` (see the comment there).

Useful scripts:

| Script | Purpose |
|---|---|
| `npm run dev` | Dev mode (Vite + Electron, devtools open) |
| `npm run typecheck` | TypeScript check of the renderer |
| `npm run lint` | ESLint |
| `npm run build` | Build the renderer into `dist/renderer` |
| `npm run verify` | typecheck + lint + build (what CI runs) |
| `npm run package` | Universal DMG into `release/` |

## Packaging

```bash
npm run package      # dist + electron-builder -> release/ssh-x-<version>-universal.dmg
```

`electron-builder.yml` builds a single **universal** DMG. `node-pty` ships
prebuilt binaries for both architectures, so the build intentionally excludes
`build/Release` and `bin/` and lets `node-pty` fall back to
`prebuilds/<platform>-<arch>`; the ASAR merge settings keep the foreign-arch
slices intact. Native modules are not rebuilt for Electron (`npmRebuild: false`)
because `cpu-features` — an optional `ssh2` dependency — is Nan-based and cannot
compile against Electron 42's V8; `ssh2` falls back to its JS implementation.

```bash
open release/mac-universal/ssh-x.app      # run the unpacked universal app
```

## Releases (CI/CD)

`ci.yml` runs `npm run verify` (typecheck + lint + build) on every push to `main`
and every pull request. Releases are tag-driven and fully manual:

```bash
npm version patch        # or minor / major; bumps package.json, commits, tags
git push --follow-tags   # pushing the vX.Y.Z tag triggers release.yml
```

`release.yml` then verifies that the tag matches the `package.json` version,
runs the same `verify` gate, builds the universal DMG with `electron-builder`
and publishes a GitHub release containing just that DMG (plus the source code
zip/tar.gz GitHub attaches automatically). The build runs before publishing,
so a failed build can never leave a release without artifacts behind.

Things worth knowing:

- the tag **must** equal the version in `package.json` (the workflow fails
  otherwise) — `npm version` keeps them in sync;
- releases can also be dispatched manually (*Actions → Release → Run workflow*)
  by passing an existing tag name;
- without the optional signing secrets (`CSC_LINK`, `CSC_KEY_PASSWORD`,
  `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`) the artifacts are
  unsigned, so users need the Gatekeeper step from *Troubleshooting*;
- release notes are generated by GitHub from the commits between tags — keep
  commit subjects meaningful (`fix(sftp): ...`, `feat(terminal): ...`).

## Project structure

```
ssh-x/
├── src/
│   ├── main/                  # Electron main process
│   │   ├── main.js            # window, CSP, session store, IPC handlers
│   │   ├── preload.js         # contextBridge API exposed as window.api
│   │   ├── sshManager.js      # ssh2 client, known_hosts, SFTP operations
│   │   ├── ptyManager.js      # local shell (node-pty)
│   │   ├── ftpManager.js      # basic-ftp client + transfer progress
│   │   └── telnetManager.js   # telnet protocol parser (IAC/NAWS)
│   └── renderer/              # React + TypeScript UI
│       ├── App.tsx            # tabs, sidebar, quick connect, session modal
│       ├── components/        # SessionTab, SftpExplorer, FtpExplorer, ...
│       ├── style.css          # retro monochrome stylesheet
│       └── global.d.ts        # shared types + window.api contract
├── scripts/                   # dev runner, node-pty permission fixer
├── electron-builder.yml
└── package.json
```

## Troubleshooting

**The app is unsigned (Gatekeeper warning on first launch).**
Open it with right-click → *Open*, or run:

```bash
xattr -dr com.apple.quarantine /Applications/ssh-x.app
```

**"Spawn failed: posix_spawnp failed."** — `npm` strips the executable bit from
`node-pty`'s bundled `spawn-helper` binaries. `npm install` fixes this
automatically via `postinstall`; run `node scripts/fix-pty-perms.js` manually if
you copied `node_modules` from somewhere else.

**Garbled Cyrillic input in the local terminal** — the shell was started without
a UTF-8 locale. SSH-X sets `en_US.UTF-8` when no locale is configured, and
respects your own `LANG`/`LC_ALL` if present.

**Torn ASCII art / misaligned glyphs** — xterm.js measures its cell metrics from
the font at `open()` time. The bundled font uses `font-display: block` and the
terminal waits for the font before opening; if you replace the font files, keep
that contract.

## Roadmap

- [ ] Keyboard shortcuts + application menu (⌘T, ⌘W, ⌘1–9, ⌘D splitting, ⌘F search)
- [ ] Search in scrollback, broadcast input to all panes in a tab
- [ ] SSH port forwarding (local/remote/dynamic SOCKS) and jump-host chains
- [ ] Agent auth (`ssh-agent`), keyboard-interactive (MFA), key generation
- [ ] Import hosts from `~/.ssh/config`
- [ ] Dual-pane local ↔ remote file browser, recursive upload/download
- [ ] Terminal themes/profiles, session restore, session logging
- [ ] Shell integration (OSC 7/133): current directory in the tab title, "follow terminal folder"

## Contributing

Bug reports and pull requests are welcome. Use Conventional Commit subjects
(`fix(sftp): ...`, `feat(terminal): ...`) — they end up in the release notes.
Report security issues privately via [GitHub security advisories](../../security/advisories/new).

## License

[ISC](LICENSE)
