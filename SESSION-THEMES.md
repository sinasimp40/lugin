# Shared session themes

Auto Shutdown admin → **Theme Settings** → **Default** or **Halloween** → **Save shared theme**.

## Diskless rollout

1. Build/update **Denfi Points** on the server using this source (`npm run build:points`).
2. Build/update **Denfi Auto Shutdown** in the diskless boot image using this source (`npm run build`), then save the boot image and restart PCs to load the updated app.
3. Keep each kiosk connected to the correct Denfi Points server in **Runtime**.
4. Save a theme from an authenticated Auto Shutdown admin panel. The selection is stored on Denfi Points, not as a kiosk-only draft. Updated connected kiosks normally pick it up within 5 seconds; sessions do not need restarting for subsequent theme changes.

Older Points builds do not support this protocol. The panel reports this explicitly and does not claim the theme was published. Older kiosk builds must be updated once before they can apply shared themes.

The last confirmed theme stays available during an outage. On reconnect or startup, kiosks refresh from Denfi Points. A kiosk that has never received a selection starts with Default.

Concurrent admin changes are checked by revision. Reload if another operator saved first. After a network error during saving, reload to check what the server actually stored before retrying.

## What changes

Halloween uses the approved transparent ghost artwork, slow 18-second back-and-forth patrol, gentle bob, teal glass styling, and existing logo effects. The same shared selection also themes the lock screen, login form, registration form, and curfew-hours screen. Reduced-motion preferences disable ghost motion. Default disables the Halloween stylesheets, restoring the original appearance and configured colors. Theme changes do not replace forms, clear typed input, alter curfew schedules, change uploaded images, or reset session time, shutdown deadlines, member points, bets, attendance, withdrawal state, or open drawers.

Artwork is bundled under `public/themes` for offline operation; source credits are included there. Check artwork licensing before redistributing commercial builds. Mockup generators and standalone previews are not part of the application.
