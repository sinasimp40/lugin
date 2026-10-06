# Denfi Windows apps

Source for Denfi Auto Shutdown and Denfi Points.

## Build on Windows x64

Use Node.js 22 or later. Keep the required offline voice model.
From this source folder:

```powershell
npm ci
npm run build:all
```

Both installers are generated in `dist/`. Dependency installation restores
the platform-specific tools needed on the build computer.

When cloning from GitHub, use Git LFS (`git lfs install` and `git lfs pull`)
to obtain the real voice model before building. The model in this source
folder is already present.

## What belongs on GitHub

Keep the application source, `package.json`, `package-lock.json`, both Electron
build configurations, Windows helper scripts, `public/`, `src/`, `scripts/`,
`renderer/`, required icons, and required `assets/`.

Do not upload `.git/`, `node_modules/`, local tool caches, generated installers,
reference uploads, screenshots, or private runtime `data/`. The ignore rules
exclude these working files. Automated source tests may be kept.

For a clean first publication, import the current source files into a fresh
Git repository. Ignoring or untracking a file does **not** remove copies from
existing commit history; pushing the old repository can still publish old files.

Keep existing app data and backups separately. Do not commit credentials,
member data, or local settings to a public repository.
