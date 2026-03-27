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
- **main.js** — Electron main process; single instance lock, manages login window (fullscreen, frameless, skipTaskbar) and session window (260x80, bottom-right); blocks Alt+Tab/Alt+F4/Win keys in login view only; auto-logout on quit; IPC for shutdown
- **server.js** — Express server + WebSocket server; proxies requests to `pisonet.app` hotspot (avoids CORS), handles CHAP hashing, proxies vendo API calls, JuanFi pisonet admin API integration, broadcasts session status via WebSocket; admin API endpoints
- **src/settings-store.js** — JSON file settings storage in `./data/`; scrypt password hashing; manages computer name, auto-shutdown timer, background image metadata, JuanFi pisonet config
- **public/index.html** — Login UI + session view + insert coin modal + admin modal (single page); scramble text computer name, auto-shutdown countdown, secret "zxc1" admin trigger
- **public/session.html** — Compact session view (used by Electron's 260x80 session window)
- **public/css/style.css** — Shared styles
- **preload.js** — Electron preload script; exposes `electronAPI.setSessionState()` and `electronAPI.triggerShutdown()` for IPC

## Member Registration & Time Addition (JuanFi Pisonet Admin API)
- Login card has Login/Register tabs
- Register tab: username + password fields
- Registration flow:
  1. `POST /api/hotspot/check-user` — Pre-check if username exists (login probe); blocks if hotspot unreachable
  2. User inserts coins via JuanFi vendo (`/topUp` with `interfaceName=bridge-pisonet-app` → `/checkCoin` polling)
  3. When Done clicked: `POST /api/pisonet/confirm-payment` verifies coins via vendo checkCoin, issues signed payment proof token
  4. `POST /api/pisonet/add-time` sends to JuanFi admin API at `http://10.0.0.5:8989/admin/api/pisonet/unit/addTime` with Bearer auth
  5. JuanFi creates the hotspot user on the correct pisonet server (bridge-pisonet-app)
  6. `/cancelTopUp` stops the vendo coin slot
- Payment proof tokens: short-lived (2min), tied to username, prevents unauthorized add-time calls
- JuanFi admin auth: server logs into `http://10.0.0.5:8989/admin/api/login` to get Bearer token, caches for ~1hr

## Admin Panel
- Triggered by typing "zxc1" on the login screen (no visible button)
- First-time: register admin password; subsequently: login with password
- Settings: computer name, auto-shutdown timer (minutes), background image upload/remove, change password, stop app
- JuanFi Pisonet settings: hotspot interface name, JuanFi admin username/password, pisonet unit name
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

## Pisonet API
- `POST /api/pisonet/confirm-payment` — Verify coins via vendo, issue payment proof token
- `POST /api/pisonet/add-time` — Call JuanFi admin API to add time (requires payment proof)

## Electron Hardening
- Single instance lock — prevents duplicate app instances
- `skipTaskbar: true` — hidden from taskbar
- `kiosk: true` — Electron's built-in kiosk mode for login window
- `globalShortcut` blocks Alt+Tab, Alt+F4, Win/Super keys, Ctrl+Shift+Esc, F11 in login view
- Focus guard: 500ms interval + blur handler aggressively reclaim focus when in login state
- Keys unblocked and kiosk disabled when user is logged in (session view)
- Auto-shutdown: timer counts down in login view, triggers OS shutdown via IPC
- **Windows Kiosk Scripts** (in app resources folder after install):
  - `kiosk-setup.bat` — Apply registry tweaks to disable Task Manager, Windows key, Lock Workstation, etc. for current user. Run once, then log out/in.
  - `kiosk-disable.bat` — Reverse all kiosk registry tweaks. Run to restore normal Windows behavior.
  - Note: Ctrl+Alt+Del cannot be blocked by any app — only Windows Group Policy or registry can limit what appears on that screen

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

## JuanFi Vendo API (NodeMCU at 10.0.0.5:8989)
- `GET /topUp?voucher=X&ipAddress=Y&mac=Z&extendTime=0|1&interfaceName=bridge-pisonet-app` — Start coin insertion
- `GET /checkCoin?voucher=X` — Poll coin status (every 1s); returns `status:"true"` with coin data or errorCode
- `GET /cancelTopUp?voucher=X` — Cancel/stop coin insertion
- `GET /getRates` — Get rate table
- Response format: `{ status: "true"|"false", voucher, errorCode, totalCoinReceived, totalTime, remainingTime }`
- Error codes: `coins.wait.expired`, `coin.not.inserted`, `coinslot.cancelled`, `coinslot.busy`, `coin.slot.banned`, `coin.slot.notavailable`, `no.internet.detected`, `coin.is.reading`

## JuanFi Admin API (at 10.0.0.5:8989)
- `POST /admin/api/login` — Login with username/password, returns Bearer token
- `POST /admin/api/pisonet/unit/addTime` — Add time to pisonet unit (requires Bearer token)

## Admin Panel Settings
- Hotspot Interface — default `bridge-pisonet-app` (passed to vendo topUp)
- JuanFi Admin Username/Password — for pisonet admin API auth
- Pisonet Unit Name — e.g. `PC 1`
- Computer Name, Auto Shutdown Timer, Background Image

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
- JuanFi vendo NodeMCU must be reachable at `10.0.0.5:8989` for Insert Coin
- Vendo IP (`10.0.0.5`) must be in MikroTik Walled Garden (accessible before login)
