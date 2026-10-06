'use strict';
// Safe, optional packaged-runtime check: no hotspot, Points, settings, or logout requests.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createKokoroEngine } = require('./kokoro-engine.cjs');
const { formatAnnouncement } = require('./voice-announcements');

async function main() {
  const packagedModel = path.resolve(__dirname, '../../kokoro');
  const developmentModel = path.resolve(__dirname, '../assets/kokoro');
  const modelDir = require('node:fs').existsSync(path.join(packagedModel, 'config.json'))
    ? packagedModel : developmentModel;
  const outputDir = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'denfi-voice-check'));
  await fs.mkdir(outputDir, { recursive: true });
  const engine = createKokoroEngine({ modelDir, cacheDir: path.join(outputDir, 'cache') });
  const cases = [
    { type: 'welcome', username: 'mem-test' },
    { type: 'logout', username: 'mem-test' },
    { type: 'extended', username: 'mem-test', station: 'PC 1', secondsAdded: 60 },
    { type: 'win', username: 'mem-test', multiplier: 2, balance: 987654.32 },
    { type: 'loss', username: 'mem-test', multiplier: 0, balance: 90 },
    { type: 'even', username: 'mem-test', multiplier: 1 }
  ];
  try {
    await engine.ready;
    for (const item of cases) {
      const text = formatAnnouncement(item);
      const started = Date.now();
      const wav = await engine.generate(text);
      if (wav.length < 44 || wav.toString('ascii', 0, 4) !== 'RIFF' ||
          wav.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Invalid ' + item.type + ' WAV');
      await fs.writeFile(path.join(outputDir, item.type + '.wav'), wav);
      console.log(`PASS ${item.type}: ${Date.now() - started}ms, ${wav.length} bytes. ${text}`);
    }
    console.log('PASS: offline Heart at 1x. Files: ' + outputDir);
    console.log('Play these WAV files on this PC to verify its actual speakers and the DEN PIE pronunciation.');
  } finally {
    await engine.close();
  }
}
main().catch(error => {
  console.error('FAIL: ' + error.message);
  console.error('Windows: check the full app folder and Microsoft Visual C++ x64 runtime.');
  console.error('Official runtime: https://aka.ms/vs/17/release/vc_redist.x64.exe');
  process.exitCode = 1;
});