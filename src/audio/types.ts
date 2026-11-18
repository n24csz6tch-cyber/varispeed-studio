export type ProcessingMode = 'hybrid' | 'natural' | 'tape';

/** Everything the user can change. Never stored destructively: audio is always re-rendered from the decoded original. */
export interface Settings {
  mode: ProcessingMode;
  /** Playback speed multiplier. 1.07 = faster, 0.92 = slower. */
  tempo: number;
  /** Pitch offset in semitones (hybrid mode only). */
  pitch: number;
  /** Preserve vocal formants while pitch shifting (hybrid mode only). */
  formant: boolean;
  /** Output gain in dB (-12 to +24), applied before the limiter. Pushed hard it saturates. */
  gain: number;
  /** Low-shelf weight in dB around 110 Hz (-12 to +12). */
  bass: number;
  /** High-shelf presence lift in dB around 3.2 kHz, to keep the vocal above the bass. */
  clarity: number;
  /** High-shelf air lift in dB around 10 kHz. */
  air: number;
  /** Reverb wet mix, in percent (0 disables it). */
  reverb: number;
  /** Reverb decay in seconds. */
  reverbDecay: number;
}

export interface RenderStats {
  /** Static gain applied after EQ to keep loudness consistent, in dB. */
  gainCompDb: number;
  /** Peak of the input to the limiter, in dBFS. */
  peakInDb: number;
  /** Peak of the mastered output, in dBFS. */
  peakDb: number;
  /** Estimated true peak of the mastered output, in dBTP (4x oversampled). */
  truePeakDb: number;
  /** Maximum limiter gain reduction, in dB. */
  gainReductionDb: number;
  /** Time spent inside the audio engine, in ms. */
  renderMs: number;
}

/** A finished preview render. The audio itself arrives as chunks while it renders. */
export interface RenderResult {
  sampleRate: number;
  totalFrames: number;
  duration: number;
  stats: RenderStats;
}

export interface Peaks {
  min: Float32Array;
  max: Float32Array;
}

/** One constant-speed stretch of the song, in source time. */
export interface BendSegment {
  /** Start of the segment in source time, in seconds. The first segment always starts at 0. */
  start: number;
  /** Speed multiplier for this segment (see BEND_MIN_TEMPO / BEND_MAX_TEMPO). */
  tempo: number;
}

/** 1..6 segments, sorted by start, covering the whole song. */
export type BendMap = BendSegment[];
