'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const repository = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const revision = '1939ad2a8e416c0acfeecc08a694d14ef25f2231';
const root = path.resolve(__dirname, '../assets/kokoro');
const files = [
  ['config.json', 'config.json', 'df34b4f930b23447cd4dc410fabfb42eb3f24e803e6c3f97d618fb359380a36f'],
  ['tokenizer.json', 'tokenizer.json', '77a02c8e164413299b4b4c403b14f8e0e1c1b727db4d46a09d6327b861060a34'],
  ['tokenizer_config.json', 'tokenizer_config.json', 'be1cb066d6ef6b074b3f15e6a6dd21ac88ff3cdaedf325f0aaed686c70f75d20'],
  ['onnx/model_quantized.onnx', 'onnx/model_quantized.onnx', 'fbae9257e1e05ffc727e951ef9b9c98418e6d79f1c9b6b13bd59f5c9028a1478'],
  ['voices/af_heart.bin', 'voices/af_heart.bin', 'd583ccff3cdca2f7fae535cb998ac07e9fcb90f09737b9a41fa2734ec44a8f0b']
];
const licenseSha256 = 'c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4';
const espeakLicenseUrl = 'https://raw.githubusercontent.com/espeak-ng/espeak-ng/master/COPYING';
const espeakLicenseSha256 = '8ceb4b9ee5adedde47b31e975c1d90c73ad27b6b165a1dcd80c7c545eb65b903';
const phonemizerCommit = '6835144b7ee9043129222549c1ed2f6a27216278';

function sha256(filename) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filename);
    stream.on('error', reject);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function download(remotePath, localPath, expectedHash) {
  const url = `https://huggingface.co/${repository}/resolve/${revision}/${remotePath}`;
  fs.mkdirSync(path.dirname(localPath), { recursive: true });
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || !response.body) throw new Error(`Download failed (${response.status}) for ${url}`);
  const temporary = `${localPath}.download`;
  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(temporary));
  const actualHash = await sha256(temporary);
  if (expectedHash && actualHash !== expectedHash) {
    fs.rmSync(temporary, { force: true });
    throw new Error(`SHA-256 mismatch for ${remotePath}: expected ${expectedHash}, got ${actualHash}`);
  }
  fs.renameSync(temporary, localPath);
  console.log(`${remotePath}: sha256 ${actualHash}`);
  return actualHash;
}

async function ensureAsset(remotePath, localRelativePath, expectedHash) {
  const localPath = path.join(root, localRelativePath);
  if (fs.existsSync(localPath)) {
    const actualHash = await sha256(localPath);
    if (actualHash === expectedHash) {
      console.log(`${localRelativePath}: already verified sha256 ${actualHash}`);
      return actualHash;
    }
    console.log(`${localRelativePath}: checksum mismatch; downloading the pinned asset again`);
  }
  return download(remotePath, localPath, expectedHash);
}

async function main() {
  fs.mkdirSync(root, { recursive: true });
  const checksums = {};
  for (const [remotePath, localPath, expectedHash] of files) {
    checksums[localPath] = await ensureAsset(remotePath, localPath, expectedHash);
  }

  const licenseUrl = 'https://raw.githubusercontent.com/hexgrad/kokoro/main/LICENSE';
  const licensePath = path.join(root, 'LICENSE-KOKORO.txt');
  let license = fs.existsSync(licensePath) ? fs.readFileSync(licensePath) : null;
  let actualLicenseHash = license && crypto.createHash('sha256').update(license).digest('hex');
  if (actualLicenseHash !== licenseSha256) {
    const licenseResponse = await fetch(licenseUrl, { redirect: 'follow' });
    if (!licenseResponse.ok) throw new Error(`Could not download Kokoro Apache-2.0 license (${licenseResponse.status})`);
    license = Buffer.from(await licenseResponse.arrayBuffer());
    actualLicenseHash = crypto.createHash('sha256').update(license).digest('hex');
    if (actualLicenseHash !== licenseSha256) throw new Error(`SHA-256 mismatch for Kokoro license: expected ${licenseSha256}, got ${actualLicenseHash}`);
    fs.writeFileSync(licensePath, license);
  } else {
    console.log(`LICENSE-KOKORO.txt: already verified sha256 ${actualLicenseHash}`);
  }
  checksums['LICENSE-KOKORO.txt'] = actualLicenseHash;

  const espeakLicensePath = path.join(root, 'LICENSE-ESPEAK-NG.txt');
  let espeakLicense = fs.existsSync(espeakLicensePath) ? fs.readFileSync(espeakLicensePath) : null;
  let actualEspeakLicenseHash = espeakLicense && crypto.createHash('sha256').update(espeakLicense).digest('hex');
  if (actualEspeakLicenseHash !== espeakLicenseSha256) {
    const espeakResponse = await fetch(espeakLicenseUrl, { redirect: 'follow' });
    if (!espeakResponse.ok) throw new Error(`Could not download the eSpeak NG GPL-3.0 license (${espeakResponse.status})`);
    espeakLicense = Buffer.from(await espeakResponse.arrayBuffer());
    actualEspeakLicenseHash = crypto.createHash('sha256').update(espeakLicense).digest('hex');
    if (actualEspeakLicenseHash !== espeakLicenseSha256) {
      throw new Error(`SHA-256 mismatch for eSpeak NG license: expected ${espeakLicenseSha256}, got ${actualEspeakLicenseHash}`);
    }
    fs.writeFileSync(espeakLicensePath, espeakLicense);
  } else {
    console.log(`LICENSE-ESPEAK-NG.txt: already verified sha256 ${actualEspeakLicenseHash}`);
  }
  checksums['LICENSE-ESPEAK-NG.txt'] = actualEspeakLicenseHash;

  fs.writeFileSync(path.join(root, 'SHA256SUMS'), Object.entries(checksums)
    .map(([filename, hash]) => `${hash}  ${filename}`)
    .join('\n') + '\n');
  fs.writeFileSync(path.join(root, 'NOTICE.txt'), [
    'Kokoro-82M ONNX assets are from onnx-community/Kokoro-82M-v1.0-ONNX',
    `Hugging Face revision: ${revision}`,
    'The model and voice weights are Apache-2.0 licensed.',
    'Kokoro JavaScript implementation: kokoro-js 1.2.1, Apache-2.0.',
    'ONNX Runtime Node.js dependency: onnxruntime-node 1.21.0, MIT.',
    'The matching upstream license is provided in LICENSE-KOKORO.txt.',
    `Kokoro license source: ${licenseUrl}; SHA-256: ${licenseSha256}.`,
    `Phonemizer wrapper: phonemizer 1.2.1, Apache-2.0; npm source commit ${phonemizerCommit} (https://github.com/xenova/phonemizer.js/tree/${phonemizerCommit}).`,
    'The phonemizer 1.2.1 package embeds eSpeak NG as compiled WebAssembly; eSpeak NG is GPL-3.0.',
    `eSpeak NG source: https://github.com/espeak-ng/espeak-ng; its COPYING license is provided in LICENSE-ESPEAK-NG.txt (SHA-256 ${espeakLicenseSha256}).`,
    'The published phonemizer artifact does not identify the exact eSpeak NG source revision used to build its embedded WebAssembly; no specific eSpeak NG version is asserted.',
    'Assets were downloaded and SHA-256 verified by this script.'
  ].join('\n') + '\n');
  console.log(`Prepared pinned, offline Kokoro resources in ${root}`);
}

main().catch(error => {
  console.error(`Kokoro asset preparation failed: ${error.message}`);
  process.exitCode = 1;
});