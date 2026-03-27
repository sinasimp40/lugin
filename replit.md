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
- **server.js** — Express server + WebSocket server; proxies requests to `pisonet.app` hotspot (avoids CORS), handles CHAP hashing, JuanFi pisonet API proxy (register/avail/done), broadcasts session status via WebSocket; admin API endpoints
- **src/settings-store.js** — JSON file settings storage in `./data/`; scrypt password hashing; manages computer name, auto-shutdown timer, background image metadata, pisonet unit name
- **public/index.html** — Login UI + session view + insert coin modal + admin modal (single page); scramble text computer name, auto-shutdown countdown, secret "zxc1" admin trigger
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

## Insert Coin Flow (Logged-In Members / Extend Time)
1. User clicks Insert Coin on session panel (has active session/username)
2. `GET /topUp?voucher={username}&ipAddress={ip}&mac={mac}&extendTime=1` opens coin slot
3. Vendo returns `{ status: "true", voucher: "..." }` on success
4. `GET /checkCoin?voucher={code}` polls every 1s — exact JuanFi API
5. Response fields: `status`, `totalCoinReceived`, `totalCoin`, `remainingTime`, `timeAdded`, `errorCode`, `newCoin`
6. `status == "true"` → coin received, update UI with totalCoinReceived + timeAdded
7. `errorCode == "coin.is.reading"` → show "Reading..." in timer
8. `errorCode == "coins.wait.expired"` + `remainingTime == 0` → coin slot closed:
   - If coins > 0 → payment complete, time added to session
   - If coins == 0 → `GET /cancelTopUp?voucher={code}&mac={mac}` cancels
9. `errorCode == "coinslot.cancelled"` → slot cancelled
10. User can also click Done/Cancel on modal manually

## Insert Coin Flow (Walk-Up / No Login)
1. User clicks Insert Coin on login screen WITHOUT being logged in
2. `GET /topUp?voucher=&ipAddress={ip}&mac={mac}&extendTime=0` generates a voucher
3. Vendo returns `{ status: "true", voucher: "XXXXX" }`
4. Voucher code displayed in modal, same `/checkCoin` polling as above
5. When done (vendo closes coin slot OR user clicks Done):
   - If coins > 0 → `GET /useVoucher?voucher={code}` activates on MikroTik → auto-login
   - If coins == 0 → `GET /cancelTopUp?voucher={code}&mac={mac}` cancels

## Insert Coin Flow (New Registration)
1. After `/pisonet/register` succeeds, opens Insert Coin modal
2. `GET /topUp?voucher={mem-username}&ipAddress={ip}&mac={mac}&extendTime=0` opens coin slot
3. Same `/checkCoin` polling and handling as logged-in flow

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
- **Windows Kiosk Scripts** (in app resources folder after install):
  - `kiosk-setup.bat` — Apply registry tweaks to disable Task Manager, Windows key, Lock Workstation, etc.
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
