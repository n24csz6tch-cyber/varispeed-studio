import { RubberBandInterface } from 'rubberband-wasm';
import wasmUrl from 'rubberband-wasm/dist/rubberband.wasm?url';
import { MasterChain, computeGainComp, masterChannels, resample } from './dsp';
import { MP3_RATES, encodeMp3 } from './mp3';
import { pitchScale, stretchKey, timeRatio, usesFormant } from './params';
import { stretchFlags } from './rubberband';
import { StretchCancelled, stretchAudio, type RubberBandApi } from './stretch';
import type { RenderProgress, WorkerRequest, WorkerResponse } from './protocol';
import type { Settings } from './types';
import { encodeWav } from './wav';

const post = (message: WorkerResponse, transfer: Transferable[] = []) => {
  (self as unknown as Worker).postMessage(message, transfer);
};

/** Largest slice sent to the main thread in one message (~0.74 s at 44.1 kHz). */
const CHUNK_FRAMES = 32768;

let api: RubberBandApi | null = null;
let source: { channels: Float32Array[]; sampleRate: number } | null = null;
let stretchCache: { key: string; channels: Float32Array[] } | null = null;
let compCache: { key: string; value: number } | null = null;
const cancelled = new Set<number>();
let jobQueue: Promise<void> = Promise.resolve();

async function ensureApi(): Promise<RubberBandApi> {
  if (api) return api;
  const response = await fetch(wasmUrl);
  if (!response.ok) throw new Error(`Audio engine could not be loaded (HTTP ${response.status}).`);
  const module = await WebAssembly.compile(await response.arrayBuffer());
  const instance = await RubberBandInterface.initialize(module);
  api = instance as unknown as RubberBandApi;
  return api;
}

function resetCache() {
  stretchCache = null;
  compCache = null;
}

/** Static EQ make-up, derived from the source once per bass setting. */
function gainCompFor(settings: Settings): number {
  const src = source;
  if (!src) throw new Error('No audio loaded.');
  const key = [settings.clarity.toFixed(2), settings.air.toFixed(2)].join('|');
  if (compCache && compCache.key === key) return compCache.value;
  const value = computeGainComp(src.channels, src.sampleRate, settings);
  compCache = { key, value };
  return value;
}

async function getStretched(
  settings: Settings,
  quality: 'preview' | 'final',
  requestId: number,
  report: (progress: RenderProgress) => void,
  onFrames?: (out: Float32Array[], start: number, count: number) => void,
): Promise<Float32Array[]> {
  const src = source;
  if (!src) throw new Error('No audio loaded.');

  const key = stretchKey(settings, quality);
  if (stretchCache && stretchCache.key === key) {
    const cached = stretchCache.channels;
    onFrames?.(cached, 0, cached[0].length);
    return cached;
  }

  const ratio = timeRatio(settings);
  const scale = pitchScale(settings);

  // Neutral settings: keep the decoded original untouched instead of running it through a stretcher.
  if (Math.abs(ratio - 1) < 1e-9 && Math.abs(scale - 1) < 1e-9) {
    stretchCache = { key, channels: src.channels };
    onFrames?.(src.channels, 0, src.channels[0].length);
    return src.channels;
  }

  const rb = await ensureApi();
  report({ phase: 'stretch', value: 0.02 });
  try {
    const out = await stretchAudio(rb, src.channels, src.sampleRate, {
      timeRatio: ratio,
      pitchScale: scale,
      flags: stretchFlags(quality, usesFormant(settings)),
      preserveFormants: usesFormant(settings),
      study: quality === 'final',
      onProgress: (v) => report({ phase: 'stretch', value: 0.02 + v * 0.9 }),
      shouldCancel: () => cancelled.has(requestId),
      onFrames,
    });
    resetCache();
    stretchCache = { key, channels: out };
    return out;
  } catch (err) {
    resetCache();
    throw err;
  }
}

async function handleRender(requestId: number, settings: Settings, quality: 'preview' | 'final') {
  const src = source;
  if (!src) throw new Error('No audio loaded.');

  const report = (progress: RenderProgress) => post({ type: 'progress', requestId, ...progress });
  const totalFrames = Math.max(1, Math.ceil(src.channels[0].length * timeRatio(settings)));
  const chain = new MasterChain(totalFrames, src.channels.length, src.sampleRate, settings, gainCompFor(settings));

  let emitted = 0;
  let streamed = false;

  // Hand finished audio to the main thread as it is mastered, so playback can start
  // long before the whole track is done. Chunks are exact: the chain carries every
  // stage's state, so the concatenation equals a whole-buffer render.
  const drain = () => {
    while (chain.committed > emitted) {
      if (cancelled.has(requestId)) throw new StretchCancelled();
      const count = Math.min(CHUNK_FRAMES, chain.committed - emitted);
      const slices = chain.channels.map((ch) => ch.slice(emitted, emitted + count));
      post(
        {
          type: 'chunk',
          requestId,
          channels: slices,
          startFrame: emitted,
          totalFrames,
          sampleRate: src.sampleRate,
        },
        slices.map((slice) => slice.buffer),
      );
      emitted += count;
    }
  };

  const stretched = await getStretched(settings, quality, requestId, report, (out, start, count) => {
    streamed = true;
    chain.append(out, start, count);
    chain.flush(false);
    drain();
  });

  if (!streamed) chain.append(stretched, 0, stretched[0].length);
  chain.flush(true);
  drain();

  report({ phase: 'master', value: 1 });

  post({
    type: 'render',
    requestId,
    stats: chain.stats(),
    sampleRate: src.sampleRate,
    totalFrames: chain.channels[0].length,
    duration: chain.channels[0].length / src.sampleRate,
  });
}

async function handleExport(requestId: number, settings: Settings, format: 'wav' | 'mp3') {
  const src = source;
  if (!src) throw new Error('No audio loaded.');

  const report = (progress: RenderProgress) => post({ type: 'progress', requestId, ...progress });
  const stretched = await getStretched(settings, 'final', requestId, (p) => report({ ...p, value: p.value * 0.9 }));

  let channelsIn = stretched;
  let sampleRate = src.sampleRate;
  if (format === 'mp3' && !MP3_RATES.has(sampleRate)) {
    report({ phase: 'master', value: 0.9 });
    channelsIn = resample(stretched, sampleRate, 48000);
    sampleRate = 48000;
  }

  report({ phase: 'master', value: 0.92 });
  await new Promise((r) => setTimeout(r, 0));
  if (cancelled.has(requestId)) throw new StretchCancelled();

  const { channels, stats } = masterChannels(channelsIn, sampleRate, settings, gainCompFor(settings));

  report({ phase: 'encode', value: 0.96 });
  await new Promise((r) => setTimeout(r, 0));

  const blob =
    format === 'wav'
      ? encodeWav(channels, sampleRate, 24)
      : encodeMp3(channels, sampleRate, (v) => report({ phase: 'encode', value: 0.96 + v * 0.04 }));

  post({
    type: 'export',
    requestId,
    result: {
      blob,
      sampleRate,
      duration: channels[0].length / sampleRate,
      stats,
      bytes: blob.size,
    },
  });
}

async function handleMessage(message: WorkerRequest) {
  try {
    switch (message.type) {
      case 'load': {
        resetCache();
        cancelled.clear();
        source = { channels: message.channels, sampleRate: message.sampleRate };
        post({
          type: 'loaded',
          requestId: message.requestId,
          duration: (message.channels[0]?.length ?? 0) / message.sampleRate,
        });
        break;
      }
      case 'render':
        await handleRender(message.requestId, message.settings, message.quality);
        break;
      case 'export':
        await handleExport(message.requestId, message.settings, message.format);
        break;
      case 'cancel':
        cancelled.add(message.requestId);
        break;
      default:
        break;
    }
  } catch (err) {
    if (err instanceof StretchCancelled) {
      post({ type: 'cancelled', requestId: message.requestId });
    } else {
      const text = err instanceof Error ? err.message : String(err);
      post({ type: 'error', requestId: message.requestId, message: text });
    }
  }
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;
  // Cancellation must never wait for the running job: it is queued behind a full
  // render otherwise, so a new setting change would sit behind a whole track. The
  // running job polls `cancelled` as it yields, so flagging it here is enough.
  if (message.type === 'cancel') {
    cancelled.add(message.requestId);
    return;
  }
  // Serialise the rest: the worker owns a single stretcher instance and cached source.
  jobQueue = jobQueue.then(() => handleMessage(message)).catch(() => undefined);
};

// Warm the WASM module so the first render does not pay compilation cost.
void ensureApi().catch(() => undefined);
