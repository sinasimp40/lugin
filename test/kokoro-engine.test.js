const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createKokoroEngine } = require('../src/kokoro-engine.cjs');

test('engine rejects empty/non-string text and closes idempotently', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'kokoro-engine-'));
  const engine = await createKokoroEngine({
    modelDir: path.join(temp, 'no-model'),
    cacheDir: path.join(temp, 'cache'),
    log: () => {}
  });
  try {
    await assert.rejects(engine.generate('  '), /non-empty plain text/);
    await assert.rejects(engine.generate(null), /non-empty plain text/);
    await assert.rejects(engine.ready, /Kokoro asset is missing/);
  } finally {
    await engine.close();
    await engine.close();
    await fs.rm(temp, { recursive: true, force: true });
  }
  await assert.rejects(engine.generate('Closed engine'), /engine is closed/);
});

test('engine exposes a readiness promise before accepting generated jobs', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'kokoro-engine-'));
  const engine = await createKokoroEngine({
    modelDir: path.join(temp, 'missing'),
    cacheDir: path.join(temp, 'cache'),
    log: () => {}
  });
  assert.equal(typeof engine.ready.then, 'function');
  await engine.close();
  await fs.rm(temp, { recursive: true, force: true });
});

test('closing during warmup cancels readiness and queued synthesis', { timeout: 10000 }, async () => {
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kokoro-closing-'));
  const engine = createKokoroEngine({
    modelDir: path.resolve(__dirname, '../assets/kokoro'), cacheDir, log: () => {}
  });
  const cancelled = Promise.all([
    assert.rejects(engine.ready, /Kokoro engine (?:is )?closed/),
    assert.rejects(engine.generate('Do not play after closing.'), /Kokoro engine (?:is )?closed/)
  ]);
  cancelled.catch(() => {});
  try {
    await new Promise(resolve => setImmediate(resolve));
    await engine.close();
    await cancelled;
  } finally {
    await engine.close();
    await fs.rm(cacheDir, { recursive: true, force: true });
  }
});

test('generates and caches Heart WAV audio from the offline model bundle', async () => {
  const modelDir = path.resolve(__dirname, '../assets/kokoro');
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kokoro-audio-cache-'));
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    throw new Error(`Network access is disabled in this test: ${String(url)}`);
  };
  const engine = createKokoroEngine({ modelDir, cacheDir, log: () => {} });
  try {
    await engine.ready;
    const wav = await engine.generate('Den Pie service is ready.');
    assert.ok(Buffer.isBuffer(wav));
    assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
    assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
    assert.ok(wav.length > 44);

    const cached = await engine.generate('Den Pie service is ready.');
    assert.deepEqual(cached, wav);
    assert.equal((await fs.readdir(cacheDir)).filter(name => name.endsWith('.wav')).length, 1);
    let finishedNewSpeech = false;
    const newSpeech = engine.generate('A different offline announcement is still generating.').then(result => {
      finishedNewSpeech = true;
      return result;
    });
    const immediateCached = await engine.generate('Den Pie service is ready.');
    assert.deepEqual(immediateCached, wav);
    assert.equal(finishedNewSpeech, false, 'cache hits bypass unrelated CPU synthesis');
    await newSpeech;
  } finally {
    await engine.close();
    if (previousFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = previousFetch;
    await fs.rm(cacheDir, { recursive: true, force: true });
  }
});