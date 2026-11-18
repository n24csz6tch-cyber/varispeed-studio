import type { Peaks, ProcessingMode, Settings } from './types';

export const TEMPO_MIN = 0.5;
export const TEMPO_MAX = 2;
export const PITCH_MIN = -12;
export const PITCH_MAX = 12;
/** Gain in dB, applied before the limiter. Pushed hard it saturates. */
export const GAIN_MIN = -12;
export const GAIN_MAX = 24;
/** Low-shelf bass control. Negative values scoop the low end, positive adds weight. */
export const BASS_MIN = -12;
export const BASS_MAX = 12;
export const BASS_FREQ = 110;
export const CLARITY_MIN = 0;
export const CLARITY_MAX = 8;
export const AIR_MAX = 8;
export const REVERB_MAX = 60;
export const REVERB_DECAY_MIN = 1;
export const REVERB_DECAY_MAX = 4.5;
/** Conservative true-peak ceiling, in dBTP. */
export const CEILING_DB = -1;

/** Bend (tempo map) limits. */
export const BEND_MIN_TEMPO = 0.5;
export const BEND_MAX_TEMPO = 2;
export const BEND_MAX_SEGMENTS = 6;
export const BEND_MIN_SEGMENT_SECONDS = 1.5;
export const BEND_CROSSFADE = 0.03;
export const BEND_MIN_TRACK_SECONDS = 4;
/** Ceiling for the processed audio, in seconds: the buffers all live in memory. */
export const MAX_OUTPUT_SECONDS = 12 * 60;

export const DEFAULT_SETTINGS: Settings = {
  mode: 'hybrid',
  tempo: 1,
  pitch: 0,
  formant: true,
  gain: 0,
  bass: 0,
  clarity: 0,
  air: 0,
  reverb: 0,
  reverbDecay: 2.5,
};

/** Rubber Band time ratio: output length / input length. Slower music needs a longer output. */
export function timeRatio(s: Settings): number {
  return 1 / s.tempo;
}

/** Pitch ratio handed to the stretcher. Tape mode links pitch to speed, natural mode never shifts pitch. */
export function pitchScale(s: Settings): number {
  if (s.mode === 'tape') return s.tempo;
  if (s.mode === 'natural') return 1;
  return Math.pow(2, s.pitch / 12);
}

/** Formant preservation only makes sense for an independent pitch shift. */
export function usesFormant(s: Settings): boolean {
  return s.mode === 'hybrid' && s.formant;
}

/** The pitch a tempo change implies in tape mode, in semitones. */
export function tapeSemitones(tempo: number): number {
  return 12 * Math.log2(tempo);
}

export function semitoneLabel(v: number): string {
  const rounded = Math.round(v * 100) / 100;
  if (Math.abs(rounded) < 0.001) return '0 st';
  return `${rounded > 0 ? '+' : '−'}${Math.abs(rounded).toFixed(Math.abs(rounded) % 1 === 0 ? 0 : 2)} st`;
}

export function tempoLabel(v: number): string {
  return `${v.toFixed(2)}×`;
}

export function processedDuration(originalDuration: number, s: Settings): number {
  return originalDuration / s.tempo;
}

/** Key that identifies the expensive stretch stage. Gain changes reuse the cached stretch. */
export function stretchKey(s: Settings, quality: string): string {
  return [s.mode, s.tempo.toFixed(4), s.mode === 'hybrid' ? s.pitch.toFixed(3) : '-', usesFormant(s) ? 'f1' : 'f0', quality].join(
    '|',
  );
}

export interface Preset {
  id: string;
  name: string;
  detail: string;
  settings: Settings;
}

export const PRESETS: Preset[] = [
  {
    id: 'sped-up',
    name: 'SPED UP',
    detail: '1.20× · bright and fast',
    settings: {
      mode: 'tape',
      tempo: 1.2,
      pitch: 0,
      formant: false,
      gain: 6,
      bass: 0,
      clarity: 0,
      air: 0,
      reverb: 0,
      reverbDecay: 2.5,
    },
  },
  {
    id: 'slowed',
    name: 'SLOWED',
    detail: '0.85× · long reverb',
    settings: {
      mode: 'tape',
      tempo: 0.85,
      pitch: 0,
      formant: false,
      gain: 6,
      bass: 0,
      clarity: 0,
      air: 0,
      reverb: 22,
      reverbDecay: 2.8,
    },
  },
  {
    id: 'nightcore',
    name: 'NIGHTCORE',
    detail: '1.40× · high vocal',
    settings: {
      mode: 'tape',
      tempo: 1.4,
      pitch: 0,
      formant: false,
      gain: 4,
      bass: 0,
      clarity: 0,
      air: 0,
      reverb: 0,
      reverbDecay: 2.5,
    },
  },
  {
    id: 'deep-slowed',
    name: 'DEEP SLOWED',
    detail: '0.78× · deep and wide',
    settings: {
      mode: 'tape',
      tempo: 0.78,
      pitch: 0,
      formant: false,
      gain: 9,
      bass: 0,
      clarity: 0,
      air: 0,
      reverb: 28,
      reverbDecay: 3.3,
    },
  },
  {
    id: 'squirrel',
    name: 'SQUIRREL',
    detail: '1.00× · +10 st chipmunk voice',
    settings: {
      mode: 'hybrid',
      tempo: 1,
      pitch: 10,
      formant: false,
      gain: 2,
      bass: 2,
      clarity: 2,
      air: 0,
      reverb: 0,
      reverbDecay: 2.5,
    },
  },
  {
    id: 'original',
    name: 'ORIGINAL',
    detail: '1.00× · untouched',
    settings: { ...DEFAULT_SETTINGS },
  },
];

export function sameSettings(a: Settings, b: Settings): boolean {
  return (
    a.mode === b.mode &&
    Math.abs(a.tempo - b.tempo) < 1e-6 &&
    (a.mode !== 'hybrid' || Math.abs(a.pitch - b.pitch) < 1e-6) &&
    a.formant === b.formant &&
    Math.abs(a.gain - b.gain) < 1e-6 &&
    Math.abs(a.bass - b.bass) < 1e-6 &&
    a.clarity === b.clarity &&
    a.air === b.air &&
    a.reverb === b.reverb &&
    a.reverbDecay === b.reverbDecay
  );
}

export function ActivePresetId(s: Settings): string | null {
  const found = PRESETS.find(
    (p) =>
      p.settings.mode === s.mode &&
      Math.abs(p.settings.tempo - s.tempo) < 1e-6 &&
      Math.abs((p.settings.mode === 'hybrid' ? p.settings.pitch : 0) - (s.mode === 'hybrid' ? s.pitch : 0)) < 1e-6 &&
      Math.abs(p.settings.gain - s.gain) < 1e-6 &&
      Math.abs(p.settings.bass - s.bass) < 1e-6 &&
      p.settings.clarity === s.clarity &&
      p.settings.reverb === s.reverb,
  );
  return found ? found.id : null;
}

export const MODE_INFO: Record<ProcessingMode, { name: string; blurb: string }> = {
  hybrid: {
    name: 'HYBRID',
    blurb: 'Tempo and pitch, apart',
  },
  natural: {
    name: 'NATURAL',
    blurb: 'Speed without the pitch',
  },
  tape: {
    name: 'TAPE',
    blurb: 'Speed and pitch together',
  },
};

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function computePeaks(channels: Float32Array[], buckets = 1600): Peaks {
  const out = { min: new Float32Array(buckets), max: new Float32Array(buckets) };
  const length = channels[0]?.length ?? 0;
  if (!length) return out;
  const per = length / buckets;
  for (let b = 0; b < buckets; b++) {
    const start = Math.floor(b * per);
    const end = Math.min(length, Math.max(start + 1, Math.floor((b + 1) * per)));
    let lo = 0;
    let hi = 0;
    for (let c = 0; c < channels.length; c++) {
      const data = channels[c];
      for (let i = start; i < end; i++) {
        const v = data[i];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    out.min[b] = lo;
    out.max[b] = hi;
  }
  return out;
}

export function createPeaks(buckets = 1800): Peaks {
  return { min: new Float32Array(buckets), max: new Float32Array(buckets) };
}

/**
 * Add one rendered chunk to a fixed-resolution peak map, so the waveform can grow
 * while the track is still rendering instead of appearing all at once.
 */
export function accumulatePeaks(
  peaks: Peaks,
  channels: Float32Array[],
  startFrame: number,
  totalFrames: number,
): void {
  const buckets = peaks.max.length;
  const length = channels[0]?.length ?? 0;
  if (!buckets || !length || totalFrames <= 0) return;
  const per = totalFrames / buckets;

  for (let i = 0; i < length; i++) {
    const bucket = Math.min(buckets - 1, Math.floor((startFrame + i) / per));
    let lo = peaks.min[bucket];
    let hi = peaks.max[bucket];
    for (let c = 0; c < channels.length; c++) {
      const v = channels[c][i];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    peaks.min[bucket] = lo;
    peaks.max[bucket] = hi;
  }
}

export function sanitizeFilename(name: string): string {
  return name
    .replace(/\.[^.]+$/, '')
    .replace(/[\\/:*?"<>|]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

export function exportFilename(title: string, s: Settings, ext: string, bendSegments = 0): string {
  const parts: string[] = [];
  if (bendSegments > 0) {
    // The map owns the speed: printing the unused global tempo would be a lie.
    parts.push(`Bend ${bendSegments}seg`);
  } else if (s.mode === 'tape') {
    parts.push(`Tape ${s.tempo.toFixed(2)}x`);
  } else if (s.tempo > 1.001) {
    parts.push(`Sped Up ${s.tempo.toFixed(2)}x`);
  } else if (s.tempo < 0.999) {
    parts.push(`Slowed ${s.tempo.toFixed(2)}x`);
  } else {
    parts.push('Full Tempo');
  }
  if (s.mode === 'hybrid' && Math.abs(s.pitch) > 0.001) {
    parts.push(`${s.pitch > 0 ? '+' : ''}${Number(s.pitch.toFixed(2))}st`);
  }
  if (s.gain > 0) parts.push(`Gain+${Number(s.gain.toFixed(1))}dB`);
  const base = sanitizeFilename(title) || 'track';
  return `${base} — ${parts.join(' ')}.${ext}`;
}
