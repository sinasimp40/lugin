"""Split the verified Windows folder into ordinary ZIPs below the attachment limit."""
from pathlib import Path
import hashlib
import json
import zipfile
import zlib

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "dist/offline-voice/win-unpacked"
OUTPUT = ROOT / "releases/denfi-offline-voice"
LIMIT = 99_000_000
LEVEL = 9

README = """DENFI AUTO SHUTDOWN - OFFLINE HEART VOICE

This is the complete Windows x64 APP FOLDER, not a Setup installer.
Download ALL matching ZIP parts. Extract ALL parts into the SAME empty folder.
Do not run the exe alone: resources, DLLs, locales, and other files are required.
Then run denfi-auto-shutdown.exe from that folder.

VOICE RULES
Kokoro Heart, normal 1x speed. Speech is generated locally, without an online
speech service. Written branding remains Denfi; the spoken brand is DEN PIE.
Welcome, logout, and time extensions are local announcements.
Winning multipliers are announced on all connected PCs, including lock screens,
without balances, stakes, payouts, or net points. Losses are spoken only on the
player's PC after a confirmed reel result. Reconnect history is not spoken again.
The shared Denfi Points/LAN connection is still necessary for cross-PC events.

WINDOWS PREREQUISITE
Microsoft Visual C++ 2015-2022 x64 runtime must be installed on the PC.
Many gaming PCs already have it. If missing, obtain it directly from Microsoft:
https://aka.ms/vs/17/release/vc_redist.x64.exe
This is a one-time runtime prerequisite, NOT an online speech dependency.
Microsoft runtime files are not included because redistribution rights have
not been established. No Node.js, Python, paid voice API, or model download is
required on the PC.

SAFE UPGRADE
Back up your existing data folder and denfi-data-path.txt before any upgrade.
Fully close the existing app/watchdog before replacing its files.
Do NOT delete member data, settings, registration, or the current data-path file.
The download includes only a comments-only data-path template, not your settings.
If upgrading an existing folder, retain the current data folder/data-path file.
The app retains its existing registration, configuration, and watchdog rules.

CHECK
voice-check.bat safely generates six test WAV files in TEMP/denfi-voice-check.
It does not contact the hotspot, change Points, or mutate kiosk settings.
It checks the actual packaged speech runtime, and prints a failure if it cannot
load. Listen to the WAVs to check the PC's speakers and DEN PIE pronunciation.
Keep the speakers enabled; Windows mute/device/driver problems cannot be
detected simply by generating a valid WAV.

VERIFICATION AND LIMITATIONS
192 automated tests passed, including event privacy, duplicate/replay handling,
serial playback, reel-reveal ordering, same-request reload recovery, and audio
crash isolation. Real browser recovery/reveal/preview checks passed with isolated
fixtures. Real local speech generation passed with network access blocked.
Small prerecorded Heart 1x opening clips allow prompt speech while personalized
details are prepared. Bet audio is prepared silently during the reel animation;
the player's result is not spoken until the reveal. Simultaneous announcements
remain serialized, and LAN/status detection and device startup still take time.
Packaged sources, model checksums, Windows ONNX/Sharp native files, and absence
of operational data were checked.
This Linux workspace has NOT verified native Windows startup, speaker playback,
or performance on your PCs. The NSIS Setup installer remains unverified and is
not being supplied. This is not a zero-bug or exactly-once audio guarantee.

Licenses/notices are retained in resources/kokoro and the dependency directories.
"""


def estimate(path):
    compressor = zlib.compressobj(LEVEL, zlib.DEFLATED, -15)
    size = 0
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            size += len(compressor.compress(chunk))
    return size + len(compressor.flush()) + 300 + 2 * len(path.relative_to(SOURCE).as_posix())


def digest(path):
    result = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            result.update(chunk)
    return result.hexdigest()


def main():
    if not (SOURCE / "denfi-auto-shutdown.exe").is_file():
        raise RuntimeError("Build the Windows app folder first.")
    OUTPUT.mkdir(parents=True, exist_ok=True)
    source_files = sorted(path for path in SOURCE.rglob("*") if path.is_file())
    measured = [(estimate(path), path) for path in source_files]
    groups = []
    for size, path in sorted(measured, key=lambda item: item[0], reverse=True):
        if size + len(README) + 4096 >= LIMIT:
            raise RuntimeError(f"One file cannot fit an ordinary ZIP part: {path.name}, {size} bytes")
        for group in groups:
            if group["size"] + size < LIMIT - 20000:
                group["files"].append(path)
                group["size"] += size
                break
        else:
            groups.append({"size": size, "files": [path]})
    # The executable-containing ZIP is always Part 1.
    groups.sort(key=lambda group: not any(path.name == "denfi-auto-shutdown.exe" for path in group["files"]))
    archived = set()
    manifest = []
    for index, group in enumerate(groups, 1):
        filename = f"Denfi-Offline-Voice-Part-{index}-of-{len(groups)}.zip"
        destination = OUTPUT / filename
        with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED,
                             compresslevel=LEVEL, allowZip64=True) as archive:
            archive.writestr("READ-ME-FIRST.txt", README)
            for path in sorted(group["files"]):
                relative = path.relative_to(SOURCE).as_posix()
                if relative in archived:
                    raise RuntimeError(f"Duplicate packaged file: {relative}")
                archive.write(path, relative)
                archived.add(relative)
        if destination.stat().st_size >= LIMIT:
            raise RuntimeError(f"Part exceeds attachment budget: {filename}")
        with zipfile.ZipFile(destination) as archive:
            bad = archive.testzip()
            if bad:
                raise RuntimeError(f"ZIP integrity failure: {bad}")
        item = {"file": filename, "bytes": destination.stat().st_size,
                "sha256": digest(destination), "appFileCount": len(group["files"])}
        manifest.append(item)
        print(json.dumps(item), flush=True)
    expected = {path.relative_to(SOURCE).as_posix() for path in source_files}
    if archived != expected:
        raise RuntimeError("ZIP parts do not collectively contain the complete app.")
    (OUTPUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    (OUTPUT / "SHA256SUMS.txt").write_text(
        "".join(f'{item["sha256"]}  {item["file"]}\n' for item in manifest))
    print(f"PASS: {len(groups)} ordinary ZIPs, every one of {len(expected)} app files covered exactly once.")


if __name__ == "__main__":
    main()