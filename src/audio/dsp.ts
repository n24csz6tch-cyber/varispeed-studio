import type { RenderStats } from './types';
import { BASS_FREQ, CEILING_DB } from './params';

export interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/**
 * RBJ audio-EQ-cookbook low shelf. This is a real filter, not a volume change:
 * it only lifts the band below the shelf frequency.
 */
export function lowShelf(fs: number, f0: number, gainDb: number, slope = 1): Biquad {
  const A = Math.pow(10, gainDb / 40);
  const w0 = (2 * Math.PI * f0) / fs;
  const cosw = Math.cos(w0);
  const sinw = Math.sin(w0);
  const alpha = (sinw / 2) * Math.sqrt((A + 1 / A) * (1 / slope - 1) + 2);
  const twoSqrtAalpha = 2 * Math.sqrt(A) * alpha;

  const a0 = A + 1 + (A - 1) * cosw + twoSqrtAalpha;
  const b0 = A * (A + 1 - (A - 1) * cosw + twoSqrtAalpha);
  const b1 = 2 * A * (A - 1 - (A + 1) * cosw);
  const b2 = A * (A + 1 - (A - 1) * cosw - twoSqrtAalpha);
  const a1 = -2 * (A - 1 + (A + 1) * cosw);
  const a2 = A + 1 + (A - 1) * cosw - twoSqrtAalpha;

  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

/** RBJ audio-EQ-cookbook high shelf, used for the vocal presence lift. */
export function highShelf(fs: number, f0: number, gainDb: number, slope = 1): Biquad {
  const A = Math.pow(10, gainDb / 40);
  const w0 = (2 * Math.PI * f0) / fs;
  const cosw = Math.cos(w0);
  const sinw = Math.sin(w0);
  const alpha = (sinw / 2) * Math.sqrt((A + 1 / A) * (1 / slope - 1) + 2);
  const twoSqrtAalpha = 2 * Math.sqrt(A) * alpha;

  const a0 = A + 1 - (A - 1) * cosw + twoSqrtAalpha;
  const b0 = A * (A + 1 + (A - 1) * cosw + twoSqrtAalpha);
  const b1 = -2 * A * (A - 1 + (A + 1) * cosw);
  const b2 = A * (A + 1 + (A - 1) * cosw - twoSqrtAalpha);
  const a1 = 2 * (A - 1 - (A + 1) * cosw);
  const a2 = A + 1 - (A - 1) * cosw - twoSqrtAalpha;

  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

/** Presence shelf centre used for vocal clarity. */
export const CLARITY_FREQ = 3200;

/** Second order (12 dB/oct) high-pass, used for the 25 Hz subsonic filter. */
export function highPass(fs: number, f0: number, q = Math.SQRT1_2): Biquad {
  const w0 = (2 * Math.PI * f0) / fs;
  const cosw = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);
  const a0 = 1 + alpha;
  return {
    b0: (1 + cosw) / 2 / a0,
    b1: -(1 + cosw) / a0,
    b2: (1 + cosw) / 2 / a0,
    a1: (-2 * cosw) / a0,
    a2: (1 - alpha) / a0,
  };
}

/** Second order (12 dB/oct) low-pass, used to isolate the band the bass enhancer shapes. */
export function lowPass(fs: number, f0: number, q = Math.SQRT1_2): Biquad {
  const w0 = (2 * Math.PI * f0) / fs;
  const cosw = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);
  const a0 = 1 + alpha;
  return {
    b0: (1 - cosw) / 2 / a0,
    b1: (1 - cosw) / a0,
    b2: (1 - cosw) / 2 / a0,
    a1: (-2 * cosw) / a0,
    a2: (1 - alpha) / a0,
  };
}

/**
 * Transposed direct form II biquad that keeps its two state variables between
 * calls, so a stream can be filtered as it arrives and still produce exactly the
 * same samples as filtering the finished buffer in one go.
 */
export class BiquadState {
  private z1 = 0;
  private z2 = 0;
  private readonly c: Biquad;

  constructor(c: Biquad) {
    this.c = c;
  }

  process(data: Float32Array, offset = 0, count = data.length - offset): void {
    const { b0, b1, b2, a1, a2 } = this.c;
    let { z1, z2 } = this;
    const end = offset + count;
    for (let i = offset; i < end; i++) {
      const x = data[i];
      const y = b0 * x + z1;
      z1 = b1 * x - a1 * y + z2;
      z2 = b2 * x - a2 * y;
      data[i] = y;
    }
    this.z1 = z1;
    this.z2 = z2;
  }
}

/** In-place transposed direct form II biquad over a whole array. */
export function applyBiquad(data: Float32Array, c: Biquad): void {
  new BiquadState(c).process(data, 0, data.length);
}

export function rms(channels: Float32Array[]): number {
  let sum = 0;
  let count = 0;
  for (const ch of channels) {
    for (let i = 0; i < ch.length; i++) {
      const v = ch[i];
      sum += v * v;
    }
    count += ch.length;
  }
  return count > 0 ? Math.sqrt(sum / count) : 0;
}

export function peak(channels: Float32Array[]): number {
  let p = 0;
  for (const ch of channels) {
    for (let i = 0; i < ch.length; i++) {
      const v = ch[i] < 0 ? -ch[i] : ch[i];
      if (v > p) p = v;
    }
  }
  return p;
}

function catmullRom(x0: number, x1: number, x2: number, x3: number, t: number): number {
  const c0 = x1;
  const c1 = 0.5 * (x2 - x0);
  const c2 = x0 - 2.5 * x1 + 2 * x2 - 0.5 * x3;
  const c3 = 0.5 * (x3 - x0) + 1.5 * (x1 - x2);
  return ((c3 * t + c2) * t + c1) * t + c0;
}

const TP_STEPS = 4;

/** Inter-sample peak estimate at sample i, maximised across channels (4x oversampled). */
function truePeakAt(channels: Float32Array[], i: number, n: number): number {
  let max = 0;
  const i0 = i > 0 ? i - 1 : 0;
  const i2 = i + 1 < n ? i + 1 : n - 1;
  const i3 = i + 2 < n ? i + 2 : n - 1;
  for (let c = 0; c < channels.length; c++) {
    const d = channels[c];
    const x1 = d[i];
    const a1 = x1 < 0 ? -x1 : x1;
    if (a1 > max) max = a1;
    const x0 = d[i0];
    const x2 = d[i2];
    if (i + 1 >= n) continue;
    const x3 = d[i3];
    for (let k = 1; k < TP_STEPS; k++) {
      const y = catmullRom(x0, x1, x2, x3, k / TP_STEPS);
      const ay = y < 0 ? -y : y;
      if (ay > max) max = ay;
    }
  }
  return max;
}

/** Sliding maximum of `values` using a monotonic deque; window is [i, i+window] clipped to the array. */
function slidingMax(values: Float32Array, out: Float32Array, window: number): void {
  const dq = new Int32Array(values.length);
  let head = 0;
  let tail = 0;
  let added = 0;
  for (let i = 0; i < out.length; i++) {
    const last = Math.min(i + window, values.length - 1);
    while (added <= last) {
      while (tail > head && values[dq[tail - 1]] <= values[added]) tail--;
      dq[tail++] = added;
      added++;
    }
    while (dq[head] < i) head++;
    out[i] = values[dq[head]];
  }
}

/**
 * Inter-sample overshoot left by a lookahead limiter, in dB. The gain envelope
 * is computed from the *input* peaks, so re-interpolating the scaled output can
 * land marginally above the ceiling. Aiming this far below it keeps the measured
 * true peak at or under −1 dBTP without a global trim (which a stream cannot
 * apply retroactively).
 */
const TP_HEADROOM_DB = 0.08;

/**
 * Linked-stereo true-peak limiter with lookahead, fed one region at a time.
 *
 * - 4x oversampled (Catmull-Rom) inter-sample peak detection
 * - 5 ms lookahead, ~3 ms gain descent, 120 ms release, identical gain on every channel
 * - gain state carries across calls, so the output is identical however the
 *   input is split into chunks
 *
 * The caller must leave `lookahead + 3` uncommitted frames at the end of the
 * buffer for the forward-looking window, unless this is the final region.
 */
export class StreamingLimiter {
  readonly tailFrames: number;
  private readonly ceiling: number;
  private readonly look: number;
  private readonly releaseCoef: number;
  private readonly descentStep: number;
  private gain = 1;
  private initialized = false;
  private maxReduction = 0;
  private inputTruePeak = 0;
  private outputTruePeak = 0;
  private outputPeak = 0;
  /** Unscaled sample just before the current region, kept so chunked peak detection matches a whole-buffer pass. */
  private rawPrev: Float32Array | null = null;
  /** Set once any applied gain drops below unity. */
  private touched = false;

  constructor(sampleRate: number, ceilingDb = CEILING_DB, lookahead = 0.005, release = 0.12) {
    this.ceiling = Math.pow(10, (ceilingDb - TP_HEADROOM_DB) / 20);
    this.look = Math.max(2, Math.round(sampleRate * lookahead));
    // +5: the four-point interpolation of the last measured sample reaches two
    // frames past the lookahead window, so those must stay uncommitted too.
    this.tailFrames = this.look + 5;
    this.releaseCoef = 1 - Math.exp(-1 / (sampleRate * release));
    this.descentStep = 1 / (this.look * 0.6);
  }

  get gainReductionDb(): number {
    return 20 * Math.log10(1 / Math.max(1 - this.maxReduction, 1e-6));
  }

  get truePeakDb(): number {
    return 20 * Math.log10(Math.max(this.outputTruePeak, 1e-9));
  }

  get peakDb(): number {
    return 20 * Math.log10(Math.max(this.outputPeak, 1e-9));
  }

  /** True peak of the signal entering the limiter. */
  get inputPeakDb(): number {
    return 20 * Math.log10(Math.max(this.inputTruePeak, 1e-9));
  }

  /**
   * True-peak estimate of the *unprocessed* signal. The first window of a chunk
   * reaches one frame back into the previous chunk, which has already been scaled,
   * so the remembered raw sample is substituted there. Without this the limiter's
   * gain curve would depend on where the track was split.
   */
  private fillInputPeaks(
    channels: Float32Array[],
    start: number,
    count: number,
    span: number,
    written: number,
    out: Float32Array,
  ): number {
    let region = 0;
    const hist = this.rawPrev;
    for (let j = 0; j < span; j++) {
      const i = start + j;
      if (i >= written) break;
      let max = 0;
      const i2 = i + 1 < written ? i + 1 : written - 1;
      const i3 = i + 2 < written ? i + 2 : written - 1;
      for (let c = 0; c < channels.length; c++) {
        const d = channels[c];
        const x1 = d[i];
        const a1 = x1 < 0 ? -x1 : x1;
        if (a1 > max) max = a1;
        if (i + 1 >= written) continue;
        const x0 = i === 0 ? x1 : i - 1 < start && hist ? hist[c] : d[i - 1 < 0 ? 0 : i - 1];
        const x2 = d[i2];
        const x3 = d[i3];
        for (let k = 1; k < TP_STEPS; k++) {
          const y = catmullRom(x0, x1, x2, x3, k / TP_STEPS);
          const ay = y < 0 ? -y : y;
          if (ay > max) max = ay;
        }
      }
      out[j] = max;
      if (max > this.inputTruePeak) this.inputTruePeak = max;
      if (j < count && max > region) region = max;
    }
    return region;
  }

  /**
   * Scale `channels[start..end)` in place. `written` is the number of frames that
   * currently hold real audio; samples beyond it are treated as silence.
   */
  process(channels: Float32Array[], start: number, end: number, written: number, final: boolean): void {
    const count = end - start;
    if (count <= 0) return;

    const span = count + this.look + 2;
    const tp = new Float32Array(span);
    const regionTruePeak = this.fillInputPeaks(channels, start, count, span, written, tp);

    const windowMax = new Float32Array(count);
    slidingMax(tp, windowMax, this.look);

    if (!this.initialized) {
      this.gain = Math.min(1, this.ceiling / Math.max(windowMax[0], 1e-9));
      this.initialized = true;
    }

    const wasReduced = this.touched;
    // Remember the raw sample at the end of this region before scaling it. The next
    // region's first true-peak window looks one frame back at exactly this value.
    if (!this.rawPrev || this.rawPrev.length !== channels.length) this.rawPrev = new Float32Array(channels.length);
    for (let c = 0; c < channels.length; c++) this.rawPrev[c] = channels[c][end - 1] ?? 0;

    for (let j = 0; j < count; j++) {
      const target = windowMax[j] > this.ceiling ? this.ceiling / windowMax[j] : 1;
      if (target < this.gain) {
        this.gain = Math.max(target, this.gain - this.descentStep);
        if (1 - this.gain > this.maxReduction) this.maxReduction = 1 - this.gain;
      } else {
        this.gain += (target - this.gain) * this.releaseCoef;
      }
      const g = this.gain;
      const i = start + j;
      if (g < 0.999999) this.touched = true;
      for (let c = 0; c < channels.length; c++) {
        const y = channels[c][i] * g;
        channels[c][i] = y;
        const ay = y < 0 ? -y : y;
        if (ay > this.outputPeak) this.outputPeak = ay;
      }
    }

    // Measuring the output true peak costs as much as limiting, so only bother when
    // gain was actually reduced somewhere — otherwise the output equals the input.
    if (this.touched || wasReduced) {
      // The last two frames need samples that are still unprocessed; the next
      // region measures them (the final region measures everything).
      const measureEnd = final ? end : Math.max(start, end - 2);
      for (let i = start; i < measureEnd; i++) {
        const v = truePeakAt(channels, i, written);
        if (v > this.outputTruePeak) this.outputTruePeak = v;
      }
    } else if (regionTruePeak > this.outputTruePeak) {
      // Untouched region: the output is the input, so its peak is already known.
      this.outputTruePeak = regionTruePeak;
    }
  }
}

export interface MasterSettings {
  /** Output gain in dB before the limiter. */
  gain: number;
  /** Low-shelf weight in dB around BASS_FREQ. */
  bass: number;
  clarity: number;
  air: number;
  reverb: number;
  reverbDecay: number;
}

/**
 * Small stereo reverb (six damped comb filters plus three allpasses per channel,
 * after the Freeverb topology) fed sample by sample, so a streamed render gets the
 * same tail as a whole-buffer one.
 */
export class Reverb {
  private readonly combs: Float32Array[][];
  private readonly combPos: Int32Array;
  private readonly combStore: Float32Array;
  private readonly aps: Float32Array[][];
  private readonly apPos: Int32Array;
  private readonly feedback: number;
  private readonly wet: number;
  private readonly dry: number;
  private readonly damp = 0.12;
  private readonly combCount: number;

  constructor(channelCount: number, sampleRate: number, mix: number, decay: number) {
    const scale = sampleRate / 44100;
    // Longer combs than a small room: this reverb has to reach multi-second tails,
    // which a 25 ms loop cannot do without an unstable feedback coefficient.
    const combTuning = [3348, 3564, 3831, 4068, 4266, 4473];
    const apTuning = [1112, 882, 682];
    this.combCount = combTuning.length;
    const ch = Math.max(1, Math.min(2, channelCount));
    this.wet = Math.max(0, Math.min(0.7, mix));
    this.dry = 1 - 0.4 * this.wet;

    // Feedback derived from the requested RT60: gain per loop pass so the tail falls
    // 60 dB in `decay` seconds, divided by the damping loss in the same pass.
    const averagePeriod = (combTuning.reduce((sum, n) => sum + n, 0) / combTuning.length / sampleRate) * scale;
    const loopGain = Math.pow(10, (-3 * averagePeriod) / Math.max(0.4, decay));
    this.feedback = Math.min(0.995, loopGain / (1 - this.damp));

    this.combs = [];
    this.aps = [];
    for (let c = 0; c < ch; c++) {
      const spread = c * Math.round(23 * scale);
      this.combs.push(combTuning.map((n) => new Float32Array(Math.max(8, Math.round(n * scale) + spread))));
      this.aps.push(apTuning.map((n) => new Float32Array(Math.max(8, Math.round(n * scale) + spread))));
    }
    this.combPos = new Int32Array(ch * this.combCount);
    this.combStore = new Float32Array(ch * this.combCount);
    this.apPos = new Int32Array(ch * apTuning.length);
  }

  process(channels: Float32Array[], start: number, count: number): void {
    const chCount = Math.min(channels.length, this.combs.length);
    for (let c = 0; c < chCount; c++) {
      const data = channels[c];
      const combs = this.combs[c];
      const aps = this.aps[c];
      for (let i = start; i < start + count; i++) {
        const x = data[i];
        let wetSum = 0;
        for (let k = 0; k < combs.length; k++) {
          const buf = combs[k];
          const p = this.combPos[c * this.combCount + k] % buf.length;
          const out = buf[p];
          const store = out * (1 - this.damp) + this.combStore[c * this.combCount + k] * this.damp;
          this.combStore[c * this.combCount + k] = store;
          buf[p] = x + store * this.feedback;
          this.combPos[c * this.combCount + k] = (p + 1) % buf.length;
          wetSum += out;
        }
        let y = wetSum / combs.length;
        for (let k = 0; k < aps.length; k++) {
          const buf = aps[k];
          const p = this.apPos[c * aps.length + k] % buf.length;
          const bufout = buf[p];
          buf[p] = y + bufout * 0.5;
          this.apPos[c * aps.length + k] = (p + 1) % buf.length;
          y = bufout - y;
        }
        data[i] = x * this.dry + y * this.wet * 1.6;
      }
    }
  }
}

/** Soft knee: nothing changes below 0.9, and above it the signal saturates instead of clipping. */
const CLIP_KNEE = 0.9;

export function softClip(x: number): number {
  const a = x < 0 ? -x : x;
  if (a <= CLIP_KNEE) return x;
  const sign = x < 0 ? -1 : 1;
  return sign * (CLIP_KNEE + (1 - CLIP_KNEE) * Math.tanh((a - CLIP_KNEE) / (1 - CLIP_KNEE)));
}

/**
 * Small make-up trim: bass, clarity and air lift the peaks, so a fixed trim keeps the
 * limiter from working on every hit. Derived from the source, so a streamed render
 * knows it before the first sample.
 */
export function computeGainComp(input: Float32Array[], sampleRate: number, settings: MasterSettings): number {
  const bass = Math.abs(settings.bass) > 0.01 ? lowShelf(sampleRate, BASS_FREQ, settings.bass, 0.9) : null;
  const presence = settings.clarity > 0.01 ? highShelf(sampleRate, CLARITY_FREQ, settings.clarity) : null;
  const air = settings.air > 0.01 ? highShelf(sampleRate, 10000, settings.air, 0.7) : null;
  if (!bass && !presence && !air) return 0;

  let p = 0;
  for (const ch of input) {
    const tmp = new Float32Array(ch);
    if (bass) applyBiquad(tmp, bass);
    if (presence) applyBiquad(tmp, presence);
    if (air) applyBiquad(tmp, air);
    for (let i = 0; i < tmp.length; i++) {
      const v = tmp[i] < 0 ? -tmp[i] : tmp[i];
      if (v > p) p = v;
    }
  }

  const peakDb = 20 * Math.log10(Math.max(p, 1e-9));
  const headroomDb = CEILING_DB - peakDb;
  // A tone control should stay a tone control: cap the automatic trim so a big bass
  // lift is not silently turned back down by the whole track's worth of level.
  return headroomDb < 0 ? Math.max(-9, headroomDb) : 0;
}

/**
 * Full mastering chain: subsonic filter -> presence shelves -> gain (with a soft
 * knee when it is pushed) -> true-peak limiter, applied to an output buffer that can
 * be filled progressively (streamed preview) or in one shot (export).
 *
 * Because every stage keeps its state, the samples committed here are identical
 * whether the caller pushes the track in one go or a hundred times.
 */
export class MasterChain {
  readonly channels: Float32Array[];
  /** Frames mastered so far (safe to play). */
  committed = 0;
  private readonly preGain: number;
  private readonly filters: BiquadState[][];
  private readonly clipping: boolean;
  private readonly reverb: Reverb | null;
  private readonly limiter: StreamingLimiter;
  private written = 0;
  private eqPeak = 0;
  private readonly compDb: number;
  private readonly started = performance.now();

  constructor(
    frames: number,
    channelCount: number,
    sampleRate: number,
    settings: MasterSettings,
    gainCompDb: number,
  ) {
    this.channels = Array.from({ length: channelCount }, () => new Float32Array(frames));
    this.compDb = gainCompDb;
    // GAIN is a plain level control, like the one in BandLab: the limiter holds the
    // ceiling and, once the mix passes the soft knee, it saturates instead of clipping.
    this.preGain = Math.pow(10, (gainCompDb + settings.gain) / 20);
    this.clipping = settings.gain > 0.01;
    this.limiter = new StreamingLimiter(sampleRate);

    const hpf = highPass(sampleRate, 25);
    const bass = Math.abs(settings.bass) > 0.01 ? lowShelf(sampleRate, BASS_FREQ, settings.bass, 0.9) : null;
    const presence = settings.clarity > 0.01 ? highShelf(sampleRate, CLARITY_FREQ, settings.clarity) : null;
    const air = settings.air > 0.01 ? highShelf(sampleRate, 10000, settings.air, 0.7) : null;
    this.filters = this.channels.map(() => {
      // Two cascaded 12 dB/oct sections: 24 dB/oct below 25 Hz, so rumble really goes.
      const chain: BiquadState[] = [new BiquadState(hpf), new BiquadState(hpf)];
      if (bass) chain.push(new BiquadState(bass));
      if (presence) chain.push(new BiquadState(presence));
      if (air) chain.push(new BiquadState(air));
      return chain;
    });
    this.reverb =
      settings.reverb > 0.01
        ? new Reverb(channelCount, sampleRate, settings.reverb / 100, settings.reverbDecay)
        : null;
  }

  /** Copy `count` stretched frames starting at `start` into the master buffer and filter them. */
  append(stretched: Float32Array[], start: number, count: number): void {
    const room = this.channels[0].length - this.written;
    const n = Math.min(count, room);
    if (n <= 0) return;

    for (let c = 0; c < this.channels.length; c++) {
      const dst = this.channels[c];
      const src = stretched[c] ?? stretched[0];
      dst.set(src.subarray(start, start + n), this.written);
      for (const filter of this.filters[c]) filter.process(dst, this.written, n);
    }

    for (let c = 0; c < this.channels.length; c++) {
      const dst = this.channels[c];
      for (let i = this.written; i < this.written + n; i++) {
        const v = dst[i];
        const av = v < 0 ? -v : v;
        if (av > this.eqPeak) this.eqPeak = av;
        const out = v * this.preGain;
        dst[i] = this.clipping ? softClip(out) : out;
      }
    }

    if (this.reverb) this.reverb.process(this.channels, this.written, n);

    this.written += n;
  }

  /** Master everything that is no longer needed as limiter lookahead. */
  flush(final = false): number {
    const end = final ? this.written : this.written - this.limiter.tailFrames;
    if (end <= this.committed) return this.committed;
    this.limiter.process(this.channels, this.committed, end, this.written, final);
    this.committed = end;
    return this.committed;
  }

  stats(): RenderStats {
    return {
      gainCompDb: this.compDb,
      peakInDb: 20 * Math.log10(Math.max(this.eqPeak, 1e-9)) + 20 * Math.log10(this.preGain),
      peakDb: this.limiter.peakDb,
      truePeakDb: this.limiter.truePeakDb,
      gainReductionDb: this.limiter.gainReductionDb,
      renderMs: performance.now() - this.started,
    };
  }
}

/** One-shot mastering of a finished buffer (used by the exporter and cached renders). */
export function masterChannels(
  input: Float32Array[],
  sampleRate: number,
  settings: MasterSettings,
  gainCompDb = computeGainComp(input, sampleRate, settings),
): { channels: Float32Array[]; stats: RenderStats } {
  const chain = new MasterChain(input[0]?.length ?? 0, input.length || 1, sampleRate, settings, gainCompDb);
  chain.append(input, 0, input[0]?.length ?? 0);
  chain.flush(true);
  return { channels: chain.channels, stats: chain.stats() };
}

/** High quality-enough rate conversion for MP3 export (browser rates are already standard in practice). */
export function resample(channels: Float32Array[], fsIn: number, fsOut: number): Float32Array[] {
  if (fsIn === fsOut) return channels;
  const ratio = fsOut / fsIn;
  const inLen = channels[0].length;
  const outLen = Math.max(1, Math.round(inLen * ratio));
  const filtered = inLen > 0 ? channels.map((ch) => {
    const copy = new Float32Array(ch);
    if (fsOut < fsIn) {
      const lp = highPass(fsIn, fsOut * 0.45, Math.SQRT1_2);
      applyBiquad(copy, lp);
      applyBiquad(copy, lp);
    }
    return copy;
  }) : channels;

  return filtered.map((src) => {
    const out = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const pos = i / ratio;
      const i1 = Math.floor(pos);
      const t = pos - i1;
      const i0 = i1 > 0 ? i1 - 1 : 0;
      const i2 = i1 + 1 < inLen ? i1 + 1 : inLen - 1;
      const i3 = i1 + 2 < inLen ? i1 + 2 : inLen - 1;
      out[i] = catmullRom(src[i0], src[i1], src[i2], src[i3], t);
    }
    return out;
  });
}
