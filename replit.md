# Denfi Auto Shutdown (Pisonet App)

## Overview
The Denfi Auto Shutdown is an Electron desktop application designed for pisonet (coin-operated PC rental) businesses. It provides a custom login interface for members, integrates with a MikroTik hotspot portal for session management, and supports coin-insertion functionality via a JuanFi NodeMCU vendo. The application aims to provide a robust, secure, and user-friendly experience for pisonet users while offering an admin panel for kiosk configuration and detailed coin log management. It is designed to be deployed in environments ranging from standard desktop PCs to diskless/deep-freeze setups, with features like auto-shutdown, system hardening, and remote coin log synchronization. The project seeks to streamline pisonet operations, enhance user experience, and provide valuable business insights through its comprehensive logging and analytics.

## User Preferences
No explicit user preferences were provided in the original `replit.md` file.

## System Architecture
The application is built using Electron for the desktop client, with a Node.js (Express + WebSocket) server backend.

**UI/UX Decisions:**
- **Login UI:** Fullscreen kiosk mode, frameless, dark background, two-column split layout (form on left, admin-uploadable image on right). Features include a dust particle background animation, scramble text for computer name, auto-shutdown countdown, and an ad carousel.
- **Session UI:** Compact (260x80px), always-on-top, positioned at the bottom-right of the screen. Displays session countdown, uptime, and IP.
- **Admin Panel:** Centered modal (860px max-width, 85vh scrollable), 2-column grid layout with a black & orange theme.
- **Fonts:** Orbitron and Share Tech Mono are bundled locally for offline availability.
- **Ad Management:** Slides with images and rich HTML content, configurable interval, dot navigation.
- **Rich Text Editor:** Full MyBB-style editor for advertisement content.

**Technical Implementations:**
- **Electron Main Process (`main.js`):** Manages window creation (login, session), single instance lock, IPC communication, system hardening (blocking keys, focus guard), and auto-logout on app close.
- **Express Server (`server.js`):** Proxies requests to `pisonet.app` (MikroTik hotspot), handles CHAP hashing, JuanFi Pisonet API proxy, and broadcasts session status via WebSocket. It also exposes admin API endpoints and ad management CRUD.
- **Settings Store (`src/settings-store.js`):** Uses JSON files in `./data/` for storing settings like computer name, auto-shutdown timer, background/login panel images, theme colors, curfew hours, and advertisements. Employs scrypt for password hashing.
- **Coin Log Store (`src/coin-log-store.js`):** Manages coin insertion logs, including `appendLog` (with dedup), `getLogs` (with filters), `getMemberPoints`, `deleteLog`, `recalcAllPoints`, and `ensurePointsSync`. Logs are stored in `data/coin-logs.json` with atomic writes.
- **WebSocket Server:** Provides real-time session updates, broadcasting status and settings changes to connected clients.
- **Pisonet Mode:** Uses JuanFi API for coin slot control (`/pisonet/avail`, `/pisonet/done`) and `/checkCoin` for real-time updates.
- **Walk-Up Mode:** Detects session login via background polling of `/api/hotspot/login-data` and auto-shows session.
- **Member Registration:** Involves `mem-` prefixing usernames, `POST /pisonet/register` to the vendo, and a subsequent coin insertion flow.
- **Logout Flow:** Calls `POST /pisonet/logout` on vendo and MikroTik's `logoutLink + ?erase-cookie=on` for full session termination.
- **Admin Panel Features:** Configuration of computer name, auto-shutdown timer, background image upload, pisonet unit name, password changes, and app shutdown. It also provides comprehensive coin logging features including coin/point rate management, log filtering, summary cards, and a member points leaderboard.
- **Security:** HMAC-SHA256 signatures for `settings.json` and `coin-logs.json` to detect tampering.
- **Electron Hardening:** Includes single instance lock, `kiosk: true`, `globalShortcut` blocking of critical keys, focus guard, auto-shutdown, PowerShell keyboard hook, and runtime registry tweaks to disable Windows features like Task Manager and Win keys.
- **Point System:** Supports configurable coin and point rates. Point calculation is decimal, per-transaction, using a best-match algorithm. Historical log points are recalculated on rate changes.
- **Data Sync for Diskless/Deep Freeze:** Supports HTTP Sync to a central server or shared folder for `coin-logs.json` and `settings-server.json`.
- **App Role System:** Distinguishes between `auto-shutdown` (client) and `points` (server-only) roles using `DENFI_APP_ROLE` environment variable, leading to separate settings files (`settings-client.json`, `settings-server.json`) and different default ports.
- **Rates Synchronization:** Auto-shutdown clients fetch and periodically sync coin/point rates from the Denfi Points server when configured.
- **Security Fixes:** Implementation of custom confirm modals, XSS sanitization, proper form-wrapped password fields, token clearing race fix, and stop-app race condition fix.
- **Self-Arming Watchdog (`main.js` + embedded PowerShell):** When the packaged auto-shutdown app starts on Windows, it spawns a detached PowerShell watchdog (`denfi-watchdog-*.ps1` in `%TEMP%`) and silently registers a user-scope `ONLOGON` scheduled task (`DenfiAutoShutdownLaunch`). The watchdog polls every 5 seconds; if `Denfi Auto Shutdown.exe` is not running, it relaunches it. The logon task re-arms everything at every Windows logon. A `data/admin-stopped.flag` sentinel file is written when the admin clicks "Stop App" — the watchdog consumes the sentinel and exits cleanly so admin-initiated shutdowns are respected (until the next logon). A `data/watchdog.lock` PID file prevents multiple concurrent watchdogs. All watchdog activity is logged to `data/watchdog.log` (rotated at 512 KB). No external scripts or installers required — protection is fully baked into the build.
- **Cross-App Mutual Exclusion (`src/app-lock.js`):** Both Electron entry points (`main.js` for auto-shutdown, `main-server.js` for Denfi Points) acquire a shared loopback TCP lock on `127.0.0.1:47318` at startup. Whichever app starts first wins; the second app queries the holder's role via `GET /denfi-role` and shows a friendly error dialog ("Cannot start: Denfi Points is already running on this PC…") then exits. This prevents the two apps from running on the same PC regardless of which port their HTTP servers use. The lock port is configurable via `DENFI_LOCK_PORT`.

**Feature Specifications:**
- **Session Countdown Timer:** Displays remaining session time in days-hours-minutes-seconds.
- **JuanFi Integration:** Handles registration, coin insertion start/done, and coin status polling.
- **Auto-Shutdown:** Configurable timer to trigger OS shutdown.
- **Advertisement Carousel:** Display images and rich HTML content.
- **Coin Logs & Points:** Tracks member coin insertions, calculates points based on defined rates, and provides a leaderboard.
- **Read-Only Coin Logs:** Client apps can view coin logs and points but cannot modify them; modifications are restricted to the server-only `Denfi Points` application.
- **Denfi Points (Server-Only):** A lightweight Electron app running as a system tray icon, providing a central point for managing coin logs and rates for multiple clients.

## External Dependencies
- **MikroTik Hotspot Portal:** `pisonet.app` (for login, session status, and logout).
- **JuanFi NodeMCU Vendo:** Accessible at `10.0.0.5:8989` (for `register`, `avail`, `done`, `checkCoin`, `getRates` APIs).
- **Electron:** Desktop application framework.
- **Express:** Node.js web application framework.
- **ws:** WebSocket library for Node.js.
- **electron-builder:** For creating executable installers.

## Running on Replit
- Run the browser version with the **Start application** workflow (`node server.js`).
- The server listens on `0.0.0.0` and uses Replit's assigned `PORT` (default `5000`).
- Electron kiosk features and Windows system controls only work in the packaged Windows desktop app.
- MikroTik and JuanFi features require network access to the pisonet hardware and will not work from Replit unless those services are made securely reachable.