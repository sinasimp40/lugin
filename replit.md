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
- **Standalone Watchdog (`denfi-watchdog.ps1`):** The Windows build places this script next to the installed executable. Run it once with PowerShell (Administrator recommended) to install and immediately start the independent `DenfiAutoShutdownWatchdog` Scheduled Task. It checks every 5 seconds, relaunches a closed app, and restarts an app whose local health endpoint fails repeatedly for about 30 seconds. Task Scheduler restarts the watchdog itself if it is terminated. A `data/admin-stopped.flag` sentinel allows the admin's intentional “Stop App” action, while a PID lock prevents duplicate watchdogs. Activity is recorded in `data/watchdog.log`.
- **Kiosk Executable Location:** The watchdog exclusively monitors and relaunches `G:\auto\denfi-auto-shutdown\denfi-auto-shutdown.exe`. That exact full path is stored in the Scheduled Task action.
- **Desktop startup locks (`src/app-lock.js`):** Denfi Points and Auto Shutdown use separate loopback locks so one of each can run on the same PC, while duplicate instances of the same app are rejected. Points serves port 5000 and desktop Auto Shutdown serves port 5001. Install each app in a separate folder so their data files do not overlap. A co-located Auto Shutdown connects to Points through the host's private LAN address, not localhost, for password-free mission saves.

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
- The project requires Node.js 22.12 or newer; the Replit workspace uses Node.js 22.
- Install the existing dependencies with `npm install` after a fresh import.
- Run the browser version with the **Start application** workflow (`node server.js`).
- The server listens on `0.0.0.0` and uses Replit's assigned `PORT` (default `5000`).
- Electron kiosk features and Windows system controls only work in the packaged Windows desktop app.
- MikroTik and JuanFi features require network access to the pisonet hardware and will not work from Replit unless those services are made securely reachable.

## Daily attendance
- The Admin → Attendance page configures a member-only login reward or daily play-time target and fixed point reward. It is off by default.
- Attendance counts confirmed logged-in time across sessions on the same local calendar day; the session bar displays progress. The member's Attendance button opens on the current month, with previous/next month navigation across the saved history. Dates show completed, attended but unfinished, attended without a mission, absent, no-mission, and future states. One award per member per day is recorded in coin logs and remains fixed when coin-to-point rates change.
- When a kiosk is connected to Denfi Points, change the shared mission in the Auto Shutdown admin panel; Denfi Points displays it read-only. No additional attendance pairing key is required: kiosks use the existing Denfi Points connection. Attendance sync is not authenticated; keep Denfi Points on a trusted private network, never publicly expose its sync endpoints, and understand that any device able to reach them could submit false attendance reports.
- The kiosk syncs measured progress to Denfi Points, which awards the points. Both machines should use the same local timezone. If the points server is unreachable, the kiosk saves progress and displays "SYNC PENDING"; unsynced prior days are retried for up to 30 days when the kiosk next connects. Historical awards use the server's mission rules for their original day.

## Betting Games win alerts
- A positive spin result (multiplier greater than 1×) on Denfi Points opens a closable popup above each connected Auto Shutdown session bar, using the same drawer and X button as Order and Ranking. It shows the member and multiplier; losing or break-even spins do not generate alerts. The winning kiosk waits for its reel to reveal the result before showing its own alert, and an already-open session tool is not interrupted.
- Update both Denfi Points and all Auto Shutdown PCs to enable this feature. Kiosks read recent wins from Denfi Points over the existing trusted LAN connection; offline PCs cannot display live alerts, and results older than two minutes are not replayed after a long disconnection.

## Building the Windows App
- Install Node.js 22.12 or newer.
- Run `npm install`.
- Run `npm run build`.
- The installer is written to `dist/Denfi Auto Shutdown Setup.exe`.
- Do not delete `package-lock.json` or change the npm registry manually. The committed npm configuration and lockfile are portable outside Replit.