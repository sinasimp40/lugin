'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const root = path.resolve(__dirname, '..');
const packageName = '@img/sharp-win32-x64';
const packageVersion = '0.34.5';
const packagePath = path.join(root, 'node_modules', packageName);
const packageUrl = `https://registry.npmjs.org/@img/sharp-win32-x64/-/sharp-win32-x64-${packageVersion}.tgz`;
const requiredFiles = {
  'LICENSE': 'dc1f5d2d43c5531dfe0acaf4e950ea5dbe3e61e1850cf0e983bda7efc10d6693',
  'README.md': 'c416cd0af88256407c36a0613f189ac4257221c7206d0324f7ef5563c66f1125',
  'package.json': '3421485756b0a25573ee62e147a62908608e3014a2bfed64381473a22e9351d2',
  'versions.json': 'e823074bfa33ed7b1861b797dd3c60d7ef8c34cd2faa9a7d22ec32dd6d6ad8ad',
  'lib/libvips-42.dll': 'f8d356def73941668252347b825055310e99023ff77c7d3036e592d0771e1529',
  'lib/libvips-cpp-8.17.3.dll': 'f1b3c3eeea1b6a8292a69d78dd2cd1debacb9951cabdd9217a57e34137570cd1',
  'lib/sharp-win32-x64.node': 'afc813593f255968ddae8f1d66557e0f96484bb374606e4eb2267a7dbc7cb25a'
};

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function verifyPackage(directory) {
  const metadataPath = path.join(directory, 'package.json');
  if (!fs.existsSync(metadataPath)) return false;
  const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  if (metadata.name !== packageName || metadata.version !== packageVersion ||
      metadata.os?.includes('win32') !== true || metadata.cpu?.includes('x64') !== true) return false;
  for (const [relativePath, expectedHash] of Object.entries(requiredFiles)) {
    const filePath = path.join(directory, relativePath);
    if (!fs.existsSync(filePath) || sha256(fs.readFileSync(filePath)) !== expectedHash) return false;
  }
  return true;
}

function extractPackage(tarball, destination) {
  const archive = zlib.gunzipSync(tarball);
  let offset = 0;
  let extractedFiles = 0;
  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    const readString = (start, length) => header.subarray(start, start + length).toString('utf8').replace(/\0.*$/, '');
    const name = readString(0, 100);
    const prefix = readString(345, 155);
    const archivePath = prefix ? `${prefix}/${name}` : name;
    const size = Number.parseInt(readString(124, 12).trim() || '0', 8);
    const type = header[156];
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;
    if (!Number.isSafeInteger(size) || size < 0 || dataEnd > archive.length) {
      throw new Error(`Invalid tar entry size for ${archivePath}`);
    }
    if (!archivePath.startsWith('package/') || archivePath.includes('\\') ||
        archivePath.split('/').some(part => part === '..')) {
      throw new Error(`Unexpected path in sharp tarball: ${archivePath}`);
    }
    if (type === 0 || type === 48) {
      const relativePath = archivePath.slice('package/'.length);
      if (!relativePath) throw new Error('Sharp tarball contains an empty file path');
      const outputPath = path.resolve(destination, relativePath);
      if (!outputPath.startsWith(`${destination}${path.sep}`)) {
        throw new Error(`Unsafe path in sharp tarball: ${archivePath}`);
      }
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, archive.subarray(dataStart, dataEnd));
      extractedFiles += 1;
    } else if (type !== 53) {
      throw new Error(`Unsupported tar entry type ${type} for ${archivePath}`);
    }
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  if (!extractedFiles) throw new Error('The sharp tarball contained no regular package files');
}

async function main() {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (packageJson.optionalDependencies?.[packageName] !== packageVersion) {
    throw new Error(`${packageName}@${packageVersion} must remain a pinned root optional dependency`);
  }
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  const lockEntry = lock.packages?.[`node_modules/${packageName}`];
  const integrity = lockEntry?.integrity;
  if (lockEntry?.version !== packageVersion || !integrity?.startsWith('sha512-')) {
    throw new Error(`package-lock.json does not contain the expected pinned integrity for ${packageName}`);
  }
  if (verifyPackage(packagePath)) {
    console.log(`Verified ${packageName}@${packageVersion} and its Windows native dependencies`);
    return;
  }

  const response = await fetch(packageUrl, { redirect: 'follow' });
  if (!response.ok) throw new Error(`Could not download ${packageName}@${packageVersion} (${response.status})`);
  const tarball = Buffer.from(await response.arrayBuffer());
  const actualIntegrity = `sha512-${crypto.createHash('sha512').update(tarball).digest('base64')}`;
  if (actualIntegrity !== integrity) {
    throw new Error(`npm integrity mismatch for ${packageName}@${packageVersion}: expected ${integrity}, got ${actualIntegrity}`);
  }

  const parent = path.dirname(packagePath);
  const staging = path.join(parent, `.sharp-win32-x64-${process.pid}`);
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });
  try {
    extractPackage(tarball, staging);
    if (!verifyPackage(staging)) {
      throw new Error(`The downloaded ${packageName}@${packageVersion} is missing expected native files or licensing`);
    }
    fs.rmSync(packagePath, { recursive: true, force: true });
    fs.renameSync(staging, packagePath);
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }

  console.log(`Prepared ${packageName}@${packageVersion}; included files:`);
  for (const relativePath of Object.keys(requiredFiles)) {
    console.log(`  node_modules/${packageName}/${relativePath}`);
  }
}

main().catch(error => {
  console.error(`Windows sharp preparation failed: ${error.message}`);
  process.exitCode = 1;
});