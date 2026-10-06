# Upgrading Denfi Points data storage

The **Denfi Points desktop server** now uses `denfi-points.db` (SQLite) beside its
existing JSON files in the `data` folder. Auto Shutdown clients still use their
own JSON data and communicate with Denfi Points through the same HTTP endpoints.
`settings-server.json` remains JSON.

## Before installing the updated Denfi Points build

1. Quit Denfi Points from the tray. Keep the kiosks from submitting new coin and
   attendance events while the server is stopped.
2. Copy the **entire** old `data` folder to a separate safe location **outside**
   the installation directory. Do this before uninstalling the old build.
3. Install the updated Denfi Points on the same computer. Before its **first**
   launch, put a copy of the old `data` folder beside the new `denfi-points.exe`.
   It should be `path-to-exe/data/coin-logs.json`, not `data/data/coin-logs.json`.
   Keep the original backup elsewhere. Do not run both versions at once.
4. Start the new Denfi Points. On its first run, it verifies and backs up the
   JSON files under `data/legacy-json-backups/`, then imports coin logs and
   attendance into `data/denfi-points.db`. It checks record counts, original
   record contents, monthly member sums, and database integrity before using it.
   **It does not delete the old JSON files.**
5. Check the coin-log panel, current member points, attendance, and a connected
   kiosk. If import fails, Denfi Points stops with an error instead of starting
   with an empty database. Keep both the backup and failed data folder.

On later starts, the database is reused; JSON is not imported again. If either
old JSON file is changed after import (for example, by starting the older server
on the same folder), the updated server **refuses to start** rather than silently
losing the new data. Do not run the old server against the upgraded data folder.
Preserve both versions and reconcile them before restarting.

The database is a `.db` file, **not** a `.sql` text file. Do not rename JSON files
to `.sql`, edit the backup as a way of changing live records, or delete the JSON
files until you have an independently verified backup.