# Pisonet App

A lightweight Electron desktop app for pisonet member login. Connects to a MikroTik RB4011 hotspot portal at `pisonet.app` which returns JSON responses, and provides a custom login UI with session countdown timer and JuanFi-compatible Insert Coin functionality. Includes an admin panel for kiosk configuration.

## How It Works
- On load, fetches `http://pisonet.app/login` to get CHAP challenge data
- Shows login form with member login (username + password)
- Login tries both CHAP (`MD5(chapId + password + chapChallenge)`) and PAP (plaintext) automatically
- After login, shows session panel with countdown timer (days-hours-minutes-seconds), uptime, and IP
- Uses WebSocket (`/ws/session`) for real-time session updates — server polls MikroTik every 5s and pushes changes to all connected clients instantly
- Insert Coin talks to JuanFi NodeMCU vendo at `10.0.0.5:8989` for coin-slot time purchases
- Logout calls the hotspot's logout link
- Auto-logout on app close/kill/uninstall

## Architecture
- **main.js** — Electron main process; single instance lock, manages login window (fullscreen, frameless, skipTaskbar) and session window (260x80, bottom-right, always-on-top with screen-saver priority, focusable:false, 2s re-assert interval); blocks Alt+Tab/Alt+F4/Win keys in login view only; auto-logout on quit; IPC for shutdown
- **server.js** — Express server + WebSocket server; proxies requests to `pisonet.app` hotspot (avoids CORS), handles CHAP hashing, JuanFi pisonet API proxy (register/avail/done), broadcasts session status via WebSocket; admin API endpoints; ad management CRUD + image upload endpoints; no-cache headers on HTML
- **src/settings-store.js** — JSON file settings storage in `./data/`; scrypt password hashing; manages computer name, auto-shutdown timer, background image metadata, advertisements (slides with images + rich HTML content); HTML sanitizer allows formatting, links, images, lists, blockquotes, headings
- **public/index.html** — Login UI + session view + insert coin modal + admin panel (fullscreen responsive with 2-3 column grid); scramble text computer name, auto-shutdown countdown with horizontal progress bar, secret "zxc1" admin trigger; black & orange theme; login auto-prepends `mem-` prefix; registration validates no special chars/spaces; ad carousel slider between login form and shutdown timer with configurable interval (1-60s), dot navigation; full MyBB-style rich text editor (bold/italic/underline/strikethrough/font size/font family/colors/alignment/lists/links/images/subscript/superscript/undo/redo/clear formatting)
- **public/session.html** — Compact session view (used by Electron's 260x80 session window)
- **public/css/style.css** — Shared styles
- **preload.js** — Electron preload script; exposes `electronAPI.setSessionState()` and `electronAPI.triggerShutdown()` for IPC

## JuanFi Pisonet API (at 10.0.0.5:8989)
These are the actual pisonet endpoints provided by the JuanFi developer (NOT the voucher-based flow):

- **`POST /pisonet/register`** — Register a new pisonet member
  - Body: `{ macAddress, ip, username, password }`
  - Creates hotspot user on correct pisonet server (bridge-pisonet-app)
  - Username convention: `mem-{username}` (e.g. `mem-raprap`)

- **`POST /pisonet/avail`** — Start coin insertion for a pisonet unit
  - Body: `{ macAddress, ip }`
  - Opens the coin slot for the client identified by IP/MAC

- **`POST /pisonet/done`** — Done inserting coins (finalize payment)
  - Body: `{ macAddress, ip }`
  - Tells vendo that coin insertion is complete

- **`GET /checkCoin?voucher=X`** — Poll coin status during insertion (1s interval)
  - Returns: `{ status, totalCoinReceived, totalTime, remainingTime, errorCode }`

## Registration Flow
1. User enters username + password on Register tab
2. Username gets `mem-` prefix automatically (e.g. `raprap` → `mem-raprap`)
3. `POST /pisonet/register` sends `{ macAddress, ip, username, password }` to vendo
4. Vendo creates the hotspot user on MikroTik (correct pisonet server)
5. Insert Coin modal opens → `POST /pisonet/avail` starts coin slot
6. `/checkCoin` polls for coin status every 1s
7. User clicks Done → `POST /pisonet/done` finalizes payment
8. Username/password pre-filled in login form for immediate login

## Insert Coin Flow (Two Modes)

### Pisonet Mode (Logged-In Members + New Registrations)
Uses pisonet API for coin slot control + `/checkCoin` for real-time updates:
1. `POST /pisonet/avail` with `{ macAddress, ip }` → opens coin slot
2. `GET /checkCoin?voucher={username}` polls every 1s
3. Done/Cancel → `POST /pisonet/done` to finalize

### Walk-Up Mode (Not Logged In)
User physically inserts coins at the kiosk. The kiosk generates & activates a voucher.
The app background-polls `/api/hotspot/login-data` every 3s on the login screen.
When `isLogin: true` is detected → auto-shows the session (auto-connect).

### Logout Flow
1. Calls `POST /pisonet/logout` with `{ macAddress, ip, username }` on vendo
2. Calls MikroTik `logoutLink + ?erase-cookie=on` via POST to fully terminate hotspot session (not just pause)
3. Waits 5 seconds before re-polling (prevents re-detecting stale session)
- CRITICAL: MikroTik logout MUST use `?erase-cookie=on` parameter and POST method. Without it, the session is only "paused" (can be resumed), not terminated.

### Member Registration
1. Pre-check: `POST /api/pisonet/check-member` queries vendo `/pisonet/member?username=X`
2. If exists → show error, switch to Login tab, pre-fill username
3. If not → `POST /api/pisonet/register` with username, password, ip, mac
4. Duplicate detection also checks register response for "exist"/"already"/"duplicate"/"registered" keywords

### Common Polling (Both Modes)
- `status == "true"` → coin received → update UI
- `errorCode == "coin.is.reading"` → show "Reading..."
- `errorCode == "coins.wait.expired"` + `remainingTime == 0` → auto-close modal, finalize
- `errorCode == "coinslot.cancelled"` → auto-close modal, finalize

## Admin Panel
- Triggered by typing "zxc1" on the login screen (no visible button)
- First-time: register admin password; subsequently: login with password
- Settings: computer name, auto-shutdown timer (minutes), background image upload/remove, pisonet unit name, change password, stop app
- Background images: PNG/JPEG/GIF, max 10MB, saved to `data/uploads/background.*`
- GIF warning shown for memory concerns on low-end devices
- Settings broadcast to all WebSocket clients in real-time

## Admin API
- `GET /api/admin/status` — Check if registered + current settings
- `POST /api/admin/register` — First-time admin setup (returns token)
- `POST /api/admin/login` — Admin login (returns token)
- `POST /api/admin/change-password` — Change admin password (requires token)
- `GET /api/admin/settings` — Get settings (requires token)
- `POST /api/admin/settings` — Update settings (requires token)
- `POST /api/admin/background` — Upload background image via raw body (requires token)
- `DELETE /api/admin/background` — Remove background image (requires token)
- `POST /api/admin/stop-app` — Stop the application (requires token)
- Token: in-memory, 1hr expiry, sent via `x-admin-token` header

## Pisonet Proxy API (our server → vendo)
- `POST /api/pisonet/register` — Proxy to `/pisonet/register`
- `POST /api/pisonet/avail` — Proxy to `/pisonet/avail`
- `POST /api/pisonet/done` — Proxy to `/pisonet/done`
- `GET /api/vendo/check-coin` — Proxy to `/checkCoin`
- `GET /api/vendo/rates` — Proxy to `/getRates`

## Electron Hardening
- Single instance lock — prevents duplicate app instances
- `skipTaskbar: true` — hidden from taskbar
- `kiosk: true` — Electron's built-in kiosk mode for login window
- `globalShortcut` blocks Alt+Tab, Alt+F4, Win/Super keys, Ctrl+Shift+Esc, F11 in login view
- Focus guard: 500ms interval + blur handler aggressively reclaim focus when in login state
- Keys unblocked and kiosk disabled when user is logged in (session view)
- Auto-shutdown: timer counts down in login view, triggers OS shutdown via IPC
- **Keyboard Hook** (PowerShell, embedded in main.js): WH_KEYBOARD_LL hook blocks Win, Ctrl, Alt, Delete keys in login view
- **Registry keys set at runtime** (HKCU, no admin needed): DisableTaskMgr, NoWinKeys, DisableLockWorkstation, DisableChangePassword, NoLogoff
- **Note on Ctrl+Alt+Del**: This is a Windows Secure Attention Sequence handled by the kernel. It CANNOT be blocked by any application-level hook or code without admin rights. Run `kiosk-setup.bat` as Administrator to set HKLM keys (DisableCAD) that suppress the security screen entirely.
- **Windows Kiosk Scripts** (in app resources folder after install):
  - `kiosk-setup.bat` — Apply registry tweaks (run as Administrator for full effect including DisableCAD)
  - `kiosk-disable.bat` — Reverse all kiosk registry tweaks.

## Fonts
- Orbitron + Share Tech Mono bundled locally in `public/fonts/` (offline-ready, no Google Fonts dependency)

## WebSocket
- Path: `/ws/session`
- Server polls MikroTik `/status` every 5 seconds when clients are connected
- Broadcasts `{ type: 'status', data: {...} }` with session info
- Broadcasts `{ type: 'logged-out' }` when session ends
- Broadcasts `{ type: 'settings', data: {...} }` when admin changes settings
- Clients auto-reconnect on disconnect

## MikroTik Hotspot JSON Pages (on router at `/flash/pisonetapp/`)
- `login.html` → `{ loginLink, chapId, chapChallenge, isLogin, mac, ip, error, units }`
- `alogin.html` → `{ isLogin, logoutLink, sessionTimeLeft, uptime, username, mac, ip }`
- `status.html` → `{ isLogin, logoutLink, sessionTimeLeft, uptime, username, mac, ip, units }`

## JuanFi checkCoin Error Codes
- `coins.wait.expired` — Coin wait timeout
- `coin.not.inserted` — Waiting for coins (not an error)
- `coinslot.cancelled` — Coin slot cancelled
- `coinslot.busy` — Coin slot busy
- `coin.slot.banned` — Device banned
- `coin.slot.notavailable` — Coin slot not available
- `no.internet.detected` — No internet on vendo
- `coin.is.reading` — Reading coin

## Legacy Code (unused)
- `renderer/` — Old Electron renderer files, replaced by `public/` + `preload.js`
- `src/db.js` — Old database module with router_config schema, unused

## Dependencies
- `express` + `ws` (production)
- `electron` + `electron-builder` (dev, for .exe build)

## Running
```
node server.js       # Web mode (port 5000)
npm run electron     # Electron mode
```

## Building .exe
```
npm run build        # Produces installer in dist/
```

## Requirements
- Device must be connected to the MikroTik hotspot WiFi network
- Hotspot DNS name must be `pisonet.app`
- JuanFi vendo NodeMCU must be reachable at `10.0.0.5:8989`
- Vendo IP (`10.0.0.5`) must be in MikroTik Walled Garden (accessible before login)
