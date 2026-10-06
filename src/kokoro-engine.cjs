'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const { Worker } = require('node:worker_threads');

const WORKER_PATH = path.join(__dirname, 'kokoro-worker.mjs');
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_CACHE_BYTES = 64 * 1024 * 1024;

function defaultModelDir() {
  if (process.resourcesPath) {
    const packaged = path.join(process.resourcesPath, 'kokoro');
    if (fsSync.existsSync(path.join(packaged, 'config.json'))) return packaged;
  }
  return path.resolve(__dirname, '../assets/kokoro');
}

function defaultCacheDir() {
  const base = process.env.LOCALAPPDATA || process.env.XDG_CACHE_HOME || process.env.HOME || process.cwd();
  return path.join(base, 'denfi-auto-shutdown', 'kokoro-audio');
}

function createLogger(log) {
  return (level, message, details) => {
    const line = `[kokoro] ${message}`;
    if (typeof log === 'function') return log(line, details);
    if (log && typeof log[level] === 'function') return log[level](line, details);
    if (log && typeof log.log === 'function') return log.log(line, details);
    if (level === 'error') console.error(line, details || '');
    else console.info(line, details || '');
  };
}

function isWav(buffer) {
  return buffer.length >= 44 && buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WAVE';
}

function createKokoroEngine({ modelDir = defaultModelDir(), cacheDir = defaultCacheDir(), log } = {}) {
  const modelPath = path.resolve(modelDir);
  const audioCachePath = path.resolve(cacheDir);
  const writeLog = createLogger(log);
  let currentRecord = null;
  let closed = false;
  let sequence = 0;
  let serial = Promise.resolve();
  const activeWorkers = new Set();

  function discard(record, reason) {
    if (!record) return Promise.resolve();
    if (record.discarded) return record.termination || Promise.resolve();
    record.discarded = true;
    clearTimeout(record.startupTimer);
    // Close/crash can happen before the worker ever reports ready. Settle that
    // promise too or a queued generation (and close()) can wait indefinitely.
    record.rejectReady(reason || new Error('Kokoro worker stopped'));
    for (const pending of record.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(reason || new Error('Kokoro worker stopped'));
    }
    record.pending.clear();
    if (currentRecord === record) currentRecord = null;
    record.termination = record.worker.terminate().catch(() => {}).finally(() => activeWorkers.delete(record));
    return record.termination;
  }

  function launchWorker() {
    if (closed) throw new Error('Kokoro engine is closed');
    if (currentRecord && !currentRecord.discarded) return currentRecord;

    const worker = new Worker(WORKER_PATH, {
      workerData: { modelDir: modelPath },
      resourceLimits: { maxOldGenerationSizeMb: 2048, stackSizeMb: 8 }
    });
    const record = {
      worker,
      pending: new Map(),
      discarded: false,
      ready: null,
      resolveReady: null,
      rejectReady: null,
      startupTimer: null
    };
    record.ready = new Promise((resolve, reject) => {
      record.resolveReady = resolve;
      record.rejectReady = reject;
    });
    currentRecord = record;
    activeWorkers.add(record);

    record.startupTimer = setTimeout(() => {
      const error = new Error(`Kokoro worker initialization timed out after ${DEFAULT_TIMEOUT_MS} ms`);
      writeLog('error', error.message);
      record.rejectReady(error);
      discard(record, error);
    }, DEFAULT_TIMEOUT_MS);

    worker.on('message', message => {
      if (message?.type === 'ready') {
        clearTimeout(record.startupTimer);
        writeLog('info', 'offline worker initialized');
        record.resolveReady();
        return;
      }
      if (message?.type === 'init-error') {
        const error = new Error(message.error || 'Kokoro worker initialization failed');
        writeLog('error', 'offline worker initialization failed', { error: error.message });
        record.rejectReady(error);
        discard(record, error);
        return;
      }
      if (message?.type !== 'result') return;
      const pending = record.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      record.pending.delete(message.id);
      if (message.ok) pending.resolve(Buffer.from(message.wav));
      else pending.reject(new Error(message.error || 'Kokoro inference failed'));
    });

    worker.on('error', error => {
      writeLog('error', 'worker thread error', { error: error.message });
      record.rejectReady(error);
      discard(record, error);
    });
    worker.on('exit', code => {
      if (!record.discarded && code !== 0) {
        const error = new Error(`Kokoro worker exited unexpectedly with code ${code}`);
        writeLog('error', error.message);
        record.rejectReady(error);
        discard(record, error);
      } else if (!record.discarded) {
        discard(record, new Error('Kokoro worker exited'));
      }
    });
    return record;
  }

  function request(record, text) {
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => {
        const error = new Error(`Kokoro inference timed out after ${DEFAULT_TIMEOUT_MS} ms`);
        writeLog('error', error.message);
        reject(error);
        discard(record, error);
      }, DEFAULT_TIMEOUT_MS);
      record.pending.set(id, { resolve, reject, timer });
      record.worker.postMessage({ type: 'generate', id, text });
    });
  }

  async function runInference(text) {
    let lastError;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (closed) throw new Error('Kokoro engine is closed');
      let record;
      try {
        record = launchWorker();
        await record.ready;
        const wav = await request(record, text);
        if (!isWav(wav)) throw new Error('Kokoro worker returned invalid WAV audio');
        return wav;
      } catch (error) {
        lastError = error;
        if (record) discard(record, error);
        if (attempt === 0 && !closed) {
          writeLog('error', 'inference failed; restarting offline worker once', { error: error.message });
          continue;
        }
        writeLog('error', 'inference failed after the single recovery attempt', { error: error.message });
      }
    }
    throw new Error(`Kokoro inference failed after one recovery attempt: ${lastError?.message || 'unknown error'}`);
  }

  async function getCachedAudio(text) {
    const key = crypto.createHash('sha256').update(text, 'utf8').digest('hex');
    const filename = path.join(audioCachePath, `${key}.wav`);
    try {
      const wav = await fs.readFile(filename);
      if (!isWav(wav)) throw new Error('cached data is not a WAV file');
      await fs.utimes(filename, new Date(), new Date()).catch(() => {});
      return { key, filename, wav };
    } catch (error) {
      if (error.code !== 'ENOENT') {
        writeLog('error', 'discarding invalid or unreadable audio cache entry', { error: error.message });
        await fs.unlink(filename).catch(() => {});
      }
      return { key, filename, wav: null };
    }
  }

  async function pruneCache() {
    let entries;
    try {
      entries = await fs.readdir(audioCachePath, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    const files = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.wav')) continue;
      const filename = path.join(audioCachePath, entry.name);
      const stat = await fs.stat(filename).catch(() => null);
      if (stat) files.push({ filename, size: stat.size, atimeMs: stat.atimeMs });
    }
    let total = files.reduce((sum, item) => sum + item.size, 0);
    if (total <= MAX_CACHE_BYTES) return;
    files.sort((a, b) => a.atimeMs - b.atimeMs);
    for (const file of files) {
      if (total <= MAX_CACHE_BYTES) break;
      await fs.unlink(file.filename).catch(() => {});
      total -= file.size;
    }
    writeLog('info', 'audio cache pruned to its 64 MiB limit');
  }

  async function generateSerialized(text) {
    if (closed) throw new Error('Kokoro engine is closed');
    if (typeof text !== 'string' || text.trim().length === 0) {
      throw new TypeError('Kokoro generate(text) requires non-empty plain text');
    }
    const cached = await getCachedAudio(text);
    if (cached.wav) return cached.wav;

    const wav = await runInference(text);
    try {
      await fs.mkdir(audioCachePath, { recursive: true });
      if (wav.length <= MAX_CACHE_BYTES) {
        const temporary = `${cached.filename}.${process.pid}.${sequence}.tmp`;
        await fs.writeFile(temporary, wav);
        await fs.rename(temporary, cached.filename);
        await pruneCache();
      }
    } catch (error) {
      writeLog('error', 'could not persist generated audio cache entry', { error: error.message });
    }
    return wav;
  }

  const ready = launchWorker().ready;
  // The promise remains available to callers, but its early rejection is also
  // internally observed for users who choose not to await warmup.
  ready.catch(() => {});
  const engine = {
    ready,
    async generate(text) {
      if (closed) return Promise.reject(new Error('Kokoro engine is closed'));
      if (typeof text !== 'string' || !text.trim()) throw new TypeError('Kokoro generate(text) requires non-empty plain text');
      const cached = await getCachedAudio(text);
      if (closed) throw new Error('Kokoro engine is closed');
      // Cached audio must not wait behind another member's CPU inference.
      if (cached.wav) return cached.wav;
      const task = serial.then(() => generateSerialized(text));
      serial = task.catch(() => {});
      return task;
    },
    async close() {
      if (closed) return;
      closed = true;
      const error = new Error('Kokoro engine closed');
      for (const record of activeWorkers) discard(record, error);
      await Promise.all([...activeWorkers].map(record => record.termination || Promise.resolve()));
      await serial.catch(() => {});
    }
  };
  return engine;
}

module.exports = { createKokoroEngine };