# Pisonet App

A lightweight Electron desktop app for pisonet member login. Connects to a MikroTik RB4011 hotspot portal at `pisonet.app` which returns JSON responses, and provides a custom login UI with session countdown timer and JuanFi-compatible Insert Coin functionality.

## How It Works
- On load, fetches `http://pisonet.app/login` to get CHAP challenge data
- Shows login form with member login (username + password)
- Login tries both CHAP (`MD5(chapId + password + chapChallenge)`) and PAP (plaintext) automatically
- After login, shows session panel with countdown timer (days-hours-minutes-seconds), uptime, and IP
- Polls `http://pisonet.app/status` every 10 seconds for live session updates
- Insert Coin talks to JuanFi NodeMCU vendo at `10.0.0.5:8989` for coin-slot time purchases
- Logout calls the hotspot's logout link

## Architecture
- **main.js** — Electron main process; loads the app at `http://localhost:5000`
- **server.js** — Express server; proxies requests to `pisonet.app` hotspot (avoids CORS), handles CHAP hashing, proxies vendo API calls
- **public/index.html** — Login UI + session view + insert coin modal (single page)
- **public/css/style.css** — Styles

## MikroTik Hotspot JSON Pages (on router at `/flash/pisonetapp/`)
- `login.html` → `{ loginLink, chapId, chapChallenge, isLogin, mac, ip, error, units }`
- `alogin.html` → `{ isLogin, logoutLink, sessionTimeLeft, uptime, username, mac, ip }`
- `status.html` → `{ isLogin, logoutLink, sessionTimeLeft, uptime, username, mac, ip, units }`

## JuanFi Vendo API (NodeMCU at 10.0.0.5:8989)
- `GET /topUp?voucher=X&ip=Y&mac=Z&type=E|N` — Start coin insertion (E=extend, N=new)
- `GET /checkCoin?voucher=X` — Poll coin status (every 1s)
- `GET /useVoucher?voucher=X` — Activate voucher after payment
- `GET /cancelTopUp?voucher=X` — Cancel coin insertion
- `GET /getRates` — Get rate table

## Dependencies
- `express` only (production)
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
