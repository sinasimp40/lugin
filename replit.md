# Denfi Auto Shutdown (Pisonet App)

A lightweight Electron desktop app for pisonet member login. Connects to a MikroTik RB4011 hotspot portal at `pisonet.app` which returns JSON responses, and provides a custom login UI with session countdown timer and JuanFi-compatible Insert Coin functionality. Includes an admin panel for kiosk configuration. Branded as "Denfi Auto Shutdown" with custom logo icon.

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
- **main.js** — Electron main process; single instance lock (app.exit on duplicate), manages login window (fullscreen kiosk, frameless, skipTaskbar, dark bg #0a0a0a) and session window (260x80, bottom-right, always-on-top with screen-saver priority, focusable:false, 2s re-assert interval); blocks Alt+Tab/Alt+F4/Win keys in login view only; auto-logout on quit; IPC for instant shutdown (/t 0); focus guard starts after page loads (2s interval) to prevent renderer freeze; `showLoginWindow(afterLogout)` appends `?afterLogout=1` URL param to suppress stale MikroTik session detection on fresh window after logout; `handleStateChange('logged-in')` immediately hides loginToDestroy (opacity 0, kiosk off) and unconditionally destroys it in callback to prevent orphaned windows
- **build/icon.ico, build/icon.png** — App icon (Denfi logo) used for .exe, installer, and window icon
- **server.js** — Express server + WebSocket server; proxies requests to `pisonet.app` hotspot (avoids CORS), handles CHAP hashing, JuanFi pisonet API proxy (register/avail/done), broadcasts session status via WebSocket; admin API endpoints; ad management CRUD + image upload endpoints; no-cache headers on HTML
- **src/settings-store.js** — JSON file settings storage in `./data/`; scrypt password hashing; manages computer name, auto-shutdown timer, background image metadata, login panel image metadata, theme colors (loginColor/registerColor with hex validation), curfew hours (curfewEnabled/curfewStart/curfewEnd with HH:mm validation, overnight window support via `isWithinCurfew()`), advertisements (slides with images + rich HTML content); HTML sanitizer allows formatting, links, images, lists, blockquotes, headings
- **public/index.html** — Login UI (two-column split layout: form left, admin-uploadable image right) + session view + insert coin modal + admin panel (centered modal 860px max-width, 85vh scrollable, 2-col grid; auth popup 380px); dust particle background animation; scramble text computer name, auto-shutdown countdown with horizontal progress bar, secret "zxc1" admin trigger; black & orange theme; login auto-prepends `mem-` prefix; registration validates no special chars/spaces; ad carousel below login panel with configurable interval (1-60s), dot navigation; full MyBB-style rich text editor (bold/italic/underline/strikethrough/font size/font family/colors/alignment/lists/links/images/subscript/superscript/undo/redo/clear formatting)
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

## Coin Logs & Points System
- Triggered by typing "zxc2" on the login screen (separate from admin panel)
- Requires admin password authentication (same credentials as admin panel)
- Tracks all member coin insertions (only `mem-` prefixed users, NOT voucher/walk-up)
- Logs: username, amount (pesos), time added, date/timestamp, points earned
- **Coin Rates**: list of {pesos, minutes} entries — admin adds as many as needed, no defaults
- **Point Rates**: list of {pesos, points} entries — admin adds as many as needed, no defaults; points = 0 until rates are configured
- Point calculation: **decimal** — per-transaction with exact division (no rounding down). E.g. ₱5 at ₱10=1pt rate → 0.5 pts. All point values stored/displayed to 2 decimal places. Best-match algorithm picks the rate yielding highest points per log.
- Adding/removing point rates recalculates ALL historical log points
- Delete individual logs with automatic member point recalculation
- **Delete All Logs** button (double confirmation) to clear all logs and free storage
- **Data integrity protection**: HMAC-SHA256 signatures on both `settings.json` and `coin-logs.json` — if anyone manually edits the files, the app detects tampering and resets the data
- Filtering: by username search, date range (from/to)
- Summary cards: total earnings, total points, transaction count
- Member points leaderboard showing accumulated points per member
- **Session points display**: member points shown in both session views (session.html compact strip 300x50 + index.html session panel 300x80) via WebSocket and `/api/hotspot/status` enrichment; points on right side with bold 13px Orbitron font + "POINTS" sub-label; auto-clears on logout or non-member sessions
- **Delete member**: each member in the Points Summary leaderboard has an ✕ button; double-confirmation prompt; deletes ALL logs for that member and recalculates points
- **Data flow**: Server tracks active coin sessions via `activeCoinSessions` map; `/api/pisonet/avail` starts tracking, `/api/vendo/check-coin` updates coin amounts, `/api/pisonet/done` finalizes and persists the log
- **Auto-detection**: `pollHotspotForWs` detects time increases for `mem-` users and automatically creates coin log entries by reverse-calculating pesos from coin rates; per-user 15s cooldown prevents duplicates; skips if an active coin session exists (user is using Insert Coin button); uses `reverseCalcPesos()` with tolerance-based best-match algorithm (15% tolerance per rate); polling has in-flight guard to prevent race conditions; log entries include `source: 'vendo'` vs `source: 'app'` to distinguish origin
- **Storage**: `data/coin-logs.json` (atomic writes with PID+timestamp unique tmp files for multi-unit safety)
- **Module**: `src/coin-log-store.js` — appendLog, getLogs (with filters + optional pointRates for auto-sync), getMemberPoints (with optional pointRates), deleteLog, recalcAllPoints, ensurePointsSync
- **Points sync**: `ensurePointsSync(pointRates)` uses a `_ratesHash` (MD5 of canonical {pesos,points} sorted array) stored in coin-logs.json to detect when rates changed; auto-recalculates only when hash differs; `getLogs` and `getMemberPoints` accept optional `pointRates` param to self-sync before returning data
- Stale session cleanup: 10-minute TTL on in-memory coin sessions

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
- `GET /api/admin/coin-logs` — Get coin insertion logs with optional filters: username, from, to; returns coinRates[], pointRates[], memberPoints (requires token)
- `DELETE /api/admin/coin-logs/:id` — Delete a specific coin log and recalculate member points (requires token)
- `DELETE /api/admin/coin-logs` — Clear all coin logs and member points (requires token)
- `POST /api/admin/coin-rates` — Add a coin rate entry {pesos, minutes} (requires token)
- `DELETE /api/admin/coin-rates/:id` — Remove a coin rate entry (requires token)
- `POST /api/admin/point-rates` — Add a point rate entry {pesos, points}; recalculates all log points (requires token)
- `DELETE /api/admin/point-rates/:id` — Remove a point rate entry; recalculates all log points (requires token)
- Token: in-memory, 1hr expiry, sent via `x-admin-token` header

## Pisonet Proxy API (our server → vendo)
- `POST /api/pisonet/register` — Proxy to `/pisonet/register`
- `POST /api/pisonet/avail` — Proxy to `/pisonet/avail`
- `POST /api/pisonet/done` — Proxy to `/pisonet/done`
- `GET /api/vendo/check-coin` — Proxy to `/checkCoin`
- `GET /api/vendo/rates` — Proxy to `/getRates`

## Electron Hardening
- Single instance lock — `requestSingleInstanceLock()` + `app.exit(0)` prevents duplicate app instances immediately
- `skipTaskbar: true` — hidden from taskbar
- `kiosk: true` — Electron's built-in kiosk mode for login window
- `globalShortcut` blocks Alt+Tab, Alt+F4, Win/Super keys, Ctrl+Shift+Esc, F11 in login view
- Focus guard: 2s interval (starts after page loads) + blur handler reclaim focus when in login state; kiosk mode set ONCE at show to prevent renderer freeze
- Keys unblocked and kiosk disabled when user is logged in (session view)
- Auto-shutdown: timer counts down in login view, triggers instant OS shutdown via IPC (`shutdown /s /t 0 /f`, no Windows popup)
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

## Diskless / Deep Freeze Setup
For diskless (CCBoot, iCafe) or Deep Freeze environments where local changes are wiped on reboot:
- Create a file `denfi-data-path.txt` next to the Denfi .exe (bake it into the game disk image)
- Inside the file, put the path to a persistent shared folder, e.g.: `\\SERVER\DenfiData` or `D:\DenfiData`
- All units will read/write settings and coin logs to that shared location instead of the local `data/` folder
- Priority: `DENFI_DATA_DIR` env var > `denfi-data-path.txt` > default portable `data/` folder
- Atomic writes use PID+timestamp temp files to prevent corruption from concurrent multi-unit access
- Each unit's auto-detection still works independently (polls its own MikroTik session), but logs go to the shared file

## Requirements
- Device must be connected to the MikroTik hotspot WiFi network
- Hotspot DNS name must be `pisonet.app`
- JuanFi vendo NodeMCU must be reachable at `10.0.0.5:8989`
- Vendo IP (`10.0.0.5`) must be in MikroTik Walled Garden (accessible before login)
