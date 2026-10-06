import { parentPort, workerData } from 'node:worker_threads';
import fs from 'node:fs/promises';
import path from 'node:path';

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const MODEL_REVISION = '1939ad2a8e416c0acfeecc08a694d14ef25f2231';
const VOICE_FILENAME = 'af_heart.bin';
let tts;
let voiceStyles;

async function initialize() {
  // Block requests during dependency initialization too, not just model loading.
  globalThis.fetch = async url => {
    throw new Error(`Network access is disabled in the Kokoro worker (blocked fetch: ${String(url)})`);
  };
  const modelDir = path.resolve(workerData.modelDir);
  const requiredFiles = [
    'config.json',
    'tokenizer.json',
    'tokenizer_config.json',
    'onnx/model_quantized.onnx',
    `voices/${VOICE_FILENAME}`
  ];
  for (const relative of requiredFiles) {
    try {
      await fs.access(path.join(modelDir, relative));
    } catch {
      throw new Error(`Kokoro asset is missing: ${path.join(modelDir, relative)}. Run scripts/prepare-kokoro-assets.cjs before using offline inference.`);
    }
  }

  const transformers = await import('@huggingface/transformers');
  const { KokoroTTS } = await import('kokoro-js');
  const { env, AutoTokenizer, StyleTextToSpeech2Model, Tensor, RawAudio } = transformers;

  // Set policy before loading models: no hub calls, even if a bundle is incomplete.
  env.allowLocalModels = true;
  env.allowRemoteModels = false;
  env.localModelPath = path.dirname(modelDir);
  env.useFS = true;

  const loadOptions = { local_files_only: true };
  const [model, tokenizer] = await Promise.all([
    StyleTextToSpeech2Model.from_pretrained(modelDir, {
      ...loadOptions,
      dtype: 'q8',
      device: 'cpu',
      session_options: { intraOpNumThreads: 2, interOpNumThreads: 1 }
    }),
    AutoTokenizer.from_pretrained(modelDir, loadOptions)
  ]);
  tts = new KokoroTTS(model, tokenizer);
  const voiceBytes = await fs.readFile(path.join(modelDir, 'voices', VOICE_FILENAME));
  if (voiceBytes.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0) {
    throw new Error('Kokoro af_heart voice asset has invalid float32 alignment');
  }
  voiceStyles = new Float32Array(
    voiceBytes.buffer,
    voiceBytes.byteOffset,
    voiceBytes.byteLength / Float32Array.BYTES_PER_ELEMENT
  );

  // kokoro-js 1.2.1's Node voice resolver reads its own bundled file and its
  // browser resolver fetches Hugging Face. Override only this method so the
  // official generation path uses the explicitly supplied local Heart asset.
  tts.generate_from_ids = async (inputIds, { speed = 1 } = {}) => {
    const styleOffset = 256 * Math.min(Math.max(inputIds.dims.at(-1) - 2, 0), 509);
    const style = voiceStyles.slice(styleOffset, styleOffset + 256);
    const inputs = {
      input_ids: inputIds,
      style: new Tensor('float32', style, [1, 256]),
      speed: new Tensor('float32', [speed], [1])
    };
    const { waveform } = await tts.model(inputs);
    return new RawAudio(waveform.data, 24_000);
  };

  return { modelDir, modelId: MODEL_ID, revision: MODEL_REVISION };
}

async function generate(text) {
  const audio = await tts.generate(text, { voice: 'af_heart', speed: 1.0 });
  return Buffer.from(audio.toWav());
}

try {
  const details = await initialize();
  parentPort.postMessage({ type: 'ready', details });
} catch (error) {
  parentPort.postMessage({ type: 'init-error', error: error.stack || error.message });
}

parentPort.on('message', async message => {
  if (message?.type !== 'generate') return;
  try {
    const wav = await generate(message.text);
    parentPort.postMessage({ type: 'result', id: message.id, ok: true, wav });
  } catch (error) {
    parentPort.postMessage({ type: 'result', id: message.id, ok: false, error: error.stack || error.message });
  }
});