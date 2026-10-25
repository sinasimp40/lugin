'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { CUES, BINGO_CUES } = require('../src/instant-voice');
const { createKokoroEngine } = require('../src/kokoro-engine.cjs');

async function main() {
  const root = path.resolve(__dirname, '..');
  const output = path.join(root, 'assets/voice-cues');
  await fs.mkdir(output, { recursive: true });
  let manifest;
  try { manifest = JSON.parse(await fs.readFile(path.join(output, 'manifest.json'), 'utf8')); } catch {}
  let engine;
  const entries = {};
  try {
    for (const [type, text] of Object.entries({...CUES,...BINGO_CUES})) {
      let wav;
      try { wav = await fs.readFile(path.join(output, `${type}.wav`)); } catch {}
      const sha = wav && crypto.createHash('sha256').update(wav).digest('hex');
      if (manifest?.voice !== 'af_heart' || manifest?.speed !== 1 ||
          manifest?.entries?.[type]?.text !== text || manifest?.entries?.[type]?.sha256 !== sha ||
          !wav || wav.length < 44 || wav.toString('ascii', 0, 4) !== 'RIFF') {
        engine ||= createKokoroEngine({
          modelDir: path.join(root, 'assets/kokoro'),
          cacheDir: path.join(output, '.generation-cache')
        });
        wav = await engine.generate(text);
        await fs.writeFile(path.join(output, `${type}.wav`), wav);
      }
      entries[type] = { text, sha256: crypto.createHash('sha256').update(wav).digest('hex') };
    }
    await fs.writeFile(path.join(output, 'manifest.json'), JSON.stringify({ voice: 'af_heart', speed: 1, entries }, null, 2) + '\n');
    console.log(`Verified ${Object.keys(CUES).length} offline Heart 1x instant voice cues.`);
  } finally {
    await engine?.close();
    await fs.rm(path.join(output, '.generation-cache'), { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });