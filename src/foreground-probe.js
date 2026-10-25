const { spawn } = require('node:child_process');

// Compile Win32 interop once, then answer requests over stdin/stdout. Starting
// PowerShell and compiling Add-Type every second is expensive on shop PCs.
const SCRIPT = `
$ErrorActionPreference = "Stop"
Add-Type -MemberDefinition @"
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
"@ -Name Foreground -Namespace Denfi
while ($null -ne ($request = [Console]::ReadLine())) {
  if ($request -notmatch '^[0-9]+$') { continue }
  try {
    $foregroundId = [uint32]0
    $handle = [Denfi.Foreground]::GetForegroundWindow()
    [Denfi.Foreground]::GetWindowThreadProcessId($handle, [ref]$foregroundId) | Out-Null
    $name = [System.Diagnostics.Process]::GetProcessById($foregroundId).ProcessName
    [Console]::Out.WriteLine($request + [char]9 + $name)
  } catch {
    [Console]::Out.WriteLine($request + [char]9 + "!")
  }
  [Console]::Out.Flush()
}
`;

function createForegroundProbe({
  spawnImpl = spawn, timeoutMs = 6000, retryMs = 10000, now = Date.now,
  setTimer = setTimeout, clearTimer = clearTimeout,
} = {}) {
  let child = null, pending = null, buffer = '', sequence = 0;
  let stopped = false, retryAfter = 0;

  function finish(error, name) {
    const request = pending;
    pending = null;
    if (!request) return;
    clearTimer(request.timer);
    for (const callback of request.callbacks) callback(error, name);
  }
  function discard(error) {
    const old = child;
    child = null;
    buffer = '';
    retryAfter = now() + retryMs;
    if (old) {
      try { old.stdin.end(); } catch (_) {}
      try { old.kill(); } catch (_) {}
    }
    finish(error);
  }
  function start() {
    const process = spawnImpl('powershell.exe', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-EncodedCommand', Buffer.from(SCRIPT, 'utf16le').toString('base64'),
    ], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    child = process;
    process.on('error', error => { if (child === process) discard(error); });
    process.on('exit', () => {
      if (child === process) discard(new Error('Foreground helper exited.'));
    });
    process.stdin.on('error', error => { if (child === process) discard(error); });
    process.stdout.on('data', chunk => {
      if (child !== process) return;
      buffer += chunk.toString();
      if (buffer.length > 8192) return discard(new Error('Invalid foreground helper response.'));
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/, '');
        buffer = buffer.slice(newline + 1);
        const tab = line.indexOf('\t');
        if (tab < 0 || !pending || line.slice(0, tab) !== String(pending.id)) continue;
        const name = line.slice(tab + 1).trim();
        finish(!name || name === '!' ? new Error('Foreground process unavailable.') : null, name);
      }
    });
  }
  function query(callback) {
    if (stopped) return callback(new Error('Foreground helper stopped.'));
    if (pending) {
      pending.callbacks.push(callback);
      return;
    }
    if (now() < retryAfter) return callback(new Error('Foreground helper is recovering.'));
    const id = ++sequence;
    pending = { id, callbacks: [callback],
      timer: setTimer(() => discard(new Error('Foreground helper timed out.')), timeoutMs) };
    try {
      if (!child) start();
      child.stdin.write(id + '\n');
    } catch (error) { discard(error); }
  }
  function close() {
    stopped = true;
    discard(new Error('Foreground helper stopped.'));
  }
  return { query, close };
}

module.exports = { createForegroundProbe };
