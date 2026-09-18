# Pull Request

## What changed

<!-- One or two sentences. Link the issue if there is one: "Closes #123". -->

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Refactor / internal cleanup
- [ ] Documentation
- [ ] Build / CI

## How it was tested

<!-- e.g. "npm run verify" + manual check of SFTP drag & drop against a local sshd -->

## Checklist

- [ ] `npm run verify` passes (typecheck + lint + build)
- [ ] New IPC channels are guarded with `validateSender(event)` and typed in `global.d.ts`
- [ ] No stored credentials are sent to the renderer
- [ ] Any local path or remote command argument is validated/escaped
- [ ] `README.md` / `README.ru.md` updated when behaviour or scripts changed
- [ ] UI changes keep the retro monochrome style (no rounded corners, colors only from the CSS variables)