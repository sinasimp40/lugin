const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const { createForegroundProbe } = require('../src/foreground-probe');

function fixture() {
  const children = [], timers = new Set(), results = [];
  let clock = 0;
  const probe = createForegroundProbe({
    now: () => clock,
    setTimer(fn) { timers.add(fn); return fn; },
    clearTimer(fn) { timers.delete(fn); },
    spawnImpl(command, args, options) {
      const child = new EventEmitter();
      Object.assign(child, { stdout: new EventEmitter(), stdin: new EventEmitter(),
        command, args, options, writes: [], killed: false, ended: false });
      child.stdin.write = value => child.writes.push(value);
      child.stdin.end = () => { child.ended = true; };
      child.kill = () => { child.killed = true; };
      children.push(child);
      return child;
    },
  });
  return { probe, children, timers, results,
    query() { probe.query((error, name) => results.push({ error, name })); },
    advance() { clock += 10000; },
    answer(name, child = children.at(-1)) {
      child.stdout.emit('data', child.writes.at(-1).trim() + '\t' + name + '\r\n');
    },
  };
}

test('repeated foreground checks reuse one hidden helper and compile interop once', () => {
  const f = fixture();
  for (let i = 0; i < 50; i++) { f.query(); f.answer('game'); }
  assert.equal(f.children.length, 1);
  assert.equal(f.children[0].writes.length, 50);
  assert.equal(f.results.length, 50);
  assert.ok(f.results.every(result => !result.error && result.name === 'game'));
  const child = f.children[0];
  assert.equal(child.command, 'powershell.exe');
  assert.equal(child.options.windowsHide, true);
  const script = Buffer.from(child.args.at(-1), 'base64').toString('utf16le');
  assert.ok(script.indexOf('Add-Type') < script.indexOf('while ('));
  assert.equal((script.match(/Add-Type/g) || []).length, 1);
  assert.equal(f.timers.size, 0);
  f.probe.close();
  assert.equal(child.killed, true);
  assert.equal(child.ended, true);
});

test('overlapping callers share a request; partial and stale replies cannot misidentify an app', () => {
  const f = fixture();
  f.query(); f.query();
  const child = f.children[0];
  assert.equal(child.writes.length, 1);
  child.stdout.emit('data', '999\tstale.exe\n1\tgame');
  assert.equal(f.results.length, 0);
  child.stdout.emit('data', '\r\n');
  assert.equal(f.results.length, 2);
  assert.ok(f.results.every(result => result.name === 'game'));
  f.probe.close();
});

test('helper failure backs off before restarting instead of spawning every tick', () => {
  const f = fixture();
  f.query();
  const old = f.children[0];
  old.emit('error', new Error('PowerShell unavailable'));
  assert.ok(f.results[0].error);
  assert.equal(f.timers.size, 0);
  f.query();
  assert.equal(f.children.length, 1, 'cooldown blocks repeated process creation');
  f.advance();
  f.query();
  assert.equal(f.children.length, 2);
  old.emit('exit', 1);
  old.stdout.emit('data', '3\tstale\n');
  f.answer('explorer');
  assert.equal(f.results.at(-1).name, 'explorer');
  f.probe.close();
});

test('timeout and session close release pending requests and helper resources', () => {
  const f = fixture();
  f.query();
  [...f.timers][0]();
  assert.match(f.results.at(-1).error.message, /timed out/);
  assert.equal(f.children[0].killed, true);
  assert.equal(f.timers.size, 0);
  f.advance(); f.query();
  f.probe.close();
  assert.match(f.results.at(-1).error.message, /stopped/);
  assert.equal(f.children[1].killed, true);
  f.query();
  assert.equal(f.children.length, 2, 'closed sessions cannot restart the helper');
});

test('unavailable foreground processes fail safely without destroying the reusable helper', () => {
  const f = fixture();
  f.query(); f.answer('!');
  assert.ok(f.results.at(-1).error);
  assert.equal(f.children[0].killed, false);
  f.query(); f.answer('explorer');
  assert.equal(f.results.at(-1).name, 'explorer');
  assert.equal(f.children.length, 1);
  f.probe.close();
});

test('session integration keeps focus protection, game bypass, and lifecycle cleanup', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const start = main.indexOf('function checkForegroundAndManage()');
  const end = main.indexOf('foregroundCheckInterval = setInterval', start);
  const section = main.slice(start, end);
  assert.doesNotMatch(section, /exec\(|powershell|Add-Type/);
  assert.match(section, /if \(foregroundProbePending\) return/);
  assert.match(section, /checkSequence !== foregroundCheckSequence/);
  assert.match(section, /managedSessionWindow\.isFocused\(\)/);
  assert.match(section, /fullscreenBypassList\.some/);
  assert.match(section, /if \(err\)[\s\S]*?sessionHiddenForGame = false/);
  assert.match(main, /sessionWindow\.on\('closed', \(\) => \{\s*foregroundProbe\.close\(\)/);
});
