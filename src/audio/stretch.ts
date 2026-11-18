/** Minimal structural surface of rubberband-wasm that this app uses. */
export interface RubberBandApi {
  rubberband_new(sampleRate: number, channels: number, options: number, timeRatio: number, pitchScale: number): number;
  rubberband_delete(state: number): void;
  rubberband_set_expected_input_duration(state: number, samples: number): void;
  rubberband_set_max_process_size(state: number, samples: number): void;
  rubberband_set_formant_scale(state: number, scale: number): void;
  rubberband_study(state: number, input: number, samples: number, final: number): void;
  rubberband_process(state: number, input: number, samples: number, final: number): void;
  rubberband_available(state: number): number;
  rubberband_retrieve(state: number, output: number, samples: number): number;
  malloc(size: number): number;
  free(ptr: number): void;
  memWrite(destPtr: number, data: Uint8Array | Float32Array): void;
  memWritePtr(destPtr: number, srcPtr: number): void;
  memReadF32(srcPtr: number, length: number): Float32Array;
}

export class StretchCancelled extends Error {
  constructor() {
    super('cancelled');
    this.name = 'StretchCancelled';
  }
}

export interface StretchOptions {
  timeRatio: number;
  pitchScale: number;
  flags: number;
  /** Preserve the original formant envelope while pitch shifting. */
  preserveFormants?: boolean;
  /** Two-pass study (offline maximum quality). */
  study?: boolean;
  onProgress?: (value: number) => void;
  shouldCancel?: () => boolean;
  /** Called with freshly produced frames so they can be played while the rest renders. */
  onFrames?: (out: Float32Array[], start: number, count: number) => void;
}

const BLOCK = 16384;

/**
 * Offline Rubber Band processing of a whole track.
 *
 * The engine is fed fixed blocks and drained through available()/retrieve();
 * the output length is trimmed to ceil(input * timeRatio), which is the exact
 * expected duration. The loop yields to the worker event loop periodically so
 * progress messages can be posted and cancellation can be observed.
 */
export async function stretchAudio(
  api: RubberBandApi,
  channels: Float32Array[],
  sampleRate: number,
  options: StretchOptions,
): Promise<Float32Array[]> {
  const nCh = channels.length;
  const inputLen = channels[0]?.length ?? 0;
  if (!inputLen || !nCh) throw new Error('No audio to process');

  const expected = Math.max(1, Math.ceil(inputLen * options.timeRatio));
  const output = channels.map(() => new Float32Array(expected));

  let state = 0;
  let channelArrayPtr = 0;
  const channelDataPtr: number[] = [];
  let lastYield = Date.now();
  let lastProgress = -1;

  const tick = async (progress: number) => {
    if (progress !== lastProgress && Date.now() - lastYield > 80) {
      options.onProgress?.(progress);
      lastProgress = progress;
      lastYield = Date.now();
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (options.shouldCancel?.()) throw new StretchCancelled();
    }
  };

  try {
    state = api.rubberband_new(sampleRate, nCh, options.flags, options.timeRatio, options.pitchScale);
    api.rubberband_set_expected_input_duration(state, inputLen);
    api.rubberband_set_max_process_size(state, BLOCK);
    // Rubber Band R3 expresses formant preservation as a scale relative to the
    // pitch-shifted result: 1/pitch puts every formant back where it started.
    // Without this the envelope tracks the pitch shift (the "chipmunk" effect).
    api.rubberband_set_formant_scale(state, options.preserveFormants ? 1 / options.pitchScale : 1);

    channelArrayPtr = api.malloc(nCh * 4);
    for (let c = 0; c < nCh; c++) {
      const ptr = api.malloc(BLOCK * 4);
      channelDataPtr.push(ptr);
      api.memWritePtr(channelArrayPtr + c * 4, ptr);
    }

    if (options.study) {
      let read = 0;
      while (read < inputLen) {
        const remaining = Math.min(BLOCK, inputLen - read);
        for (let c = 0; c < nCh; c++) api.memWrite(channelDataPtr[c], channels[c].subarray(read, read + remaining));
        read += remaining;
        api.rubberband_study(state, channelArrayPtr, remaining, read >= inputLen ? 1 : 0);
        await tick((read / inputLen) * 0.25);
      }
    }

    const base = options.study ? 0.25 : 0;
    const span = 1 - base;
    let write = 0;
    let read = 0;

    while (read < inputLen) {
      const remaining = Math.min(BLOCK, inputLen - read);
      for (let c = 0; c < nCh; c++) api.memWrite(channelDataPtr[c], channels[c].subarray(read, read + remaining));
      read += remaining;
      api.rubberband_process(state, channelArrayPtr, remaining, read >= inputLen ? 1 : 0);

      for (;;) {
        const available = api.rubberband_available(state);
        if (available < 1) break;
        const got = api.rubberband_retrieve(state, channelArrayPtr, Math.min(BLOCK, available));
        if (got <= 0) break;
        const take = Math.min(got, expected - write);
        if (take > 0) {
          for (let c = 0; c < nCh; c++) {
            output[c].set(api.memReadF32(channelDataPtr[c], got).subarray(0, take), write);
          }
          options.onFrames?.(output, write, take);
          write += take;
        }
      }
      await tick(base + (read / inputLen) * span);
    }

    if (write < expected) {
      // Rubber Band rounds its output to internal block boundaries and can come up a
      // sample or two short. Hold the final sample so the duration is exact and the
      // track never ends on a click.
      for (let c = 0; c < nCh; c++) {
        const hold = write > 0 ? output[c][write - 1] : 0;
        output[c].fill(hold, write);
      }
      options.onFrames?.(output, write, expected - write);
    }
    return output;
  } finally {
    for (const ptr of channelDataPtr) api.free(ptr);
    if (channelArrayPtr) api.free(channelArrayPtr);
    if (state) api.rubberband_delete(state);
  }
}
