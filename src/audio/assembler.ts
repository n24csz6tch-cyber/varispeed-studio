import { accumulatePeaks, createPeaks } from './params';
import type { Peaks } from './types';

/**
 * Accumulates streamed preview chunks into one AudioBuffer so the transport can
 * play the head of the track while the rest is still rendering.
 */
export class PreviewAssembler {
  buffer: AudioBuffer | null = null;
  readonly peaks: Peaks = createPeaks(1800);
  duration = 0;
  /** Frames received so far. */
  frames = 0;

  constructor(
    private readonly ctx: BaseAudioContext,
    /** Buffer already attached to the transport; reused when it fits, so a re-render does not restart playback. */
    private readonly existing: AudioBuffer | null = null,
  ) {}

  /** Seconds of audio that are safe to play. */
  get frontier(): number {
    return this.buffer ? this.frames / this.buffer.sampleRate : 0;
  }

  get complete(): boolean {
    return !!this.buffer && this.frames >= this.buffer.length;
  }

  push(channels: Float32Array[], startFrame: number, totalFrames: number, sampleRate: number): AudioBuffer {
    if (!this.buffer || this.buffer.length !== totalFrames || this.buffer.sampleRate !== sampleRate) {
      const reuse =
        this.existing &&
        this.existing.length === totalFrames &&
        this.existing.sampleRate === sampleRate &&
        this.existing.numberOfChannels === Math.max(1, channels.length);
      this.buffer = reuse
        ? this.existing
        : this.ctx.createBuffer(Math.max(1, channels.length), Math.max(1, totalFrames), sampleRate);
      this.frames = 0;
      this.peaks.min.fill(0);
      this.peaks.max.fill(0);
    }
    const buffer = this.buffer;
    channels.forEach((channel, index) => {
      if (index < buffer.numberOfChannels) {
        buffer.copyToChannel(channel as Float32Array<ArrayBuffer>, index, startFrame);
      }
    });
    accumulatePeaks(this.peaks, channels, startFrame, totalFrames);
    this.frames = Math.max(this.frames, startFrame + (channels[0]?.length ?? 0));
    this.duration = totalFrames / sampleRate;
    return buffer;
  }

  peaksSnapshot(): Peaks {
    return { min: this.peaks.min.slice(), max: this.peaks.max.slice() };
  }
}
