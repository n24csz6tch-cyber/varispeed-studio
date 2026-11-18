import { bufferToSource, sourceToBuffer } from './bend';
import { encodeWav16, encodeWav16Async } from './compat';
import type { BendMap } from './types';

export type PlayerView = 'original' | 'processed';

export interface PlayerSnapshot {
  playing: boolean;
  view: PlayerView;
  volume: number;
  hasOriginal: boolean;
  hasProcessed: boolean;
  /** False when the browser has not let the audio context start (autoplay policy). */
  audioRunning: boolean;
}

/**
 * Web Audio playback transport.
 *
 * Both the original and the processed audio stay in memory as AudioBuffers.
 * Positions are tracked in *source time*, so switching A/B or swapping in a
 * freshly rendered buffer keeps you exactly where you were in the song.
 */
export class Player {
  private ctx: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private analyserNode: AnalyserNode | null = null;
  private node: AudioBufferSourceNode | null = null;
  /**
   * While a preview is still rendering, the transport plays the buffer in slices:
   * one scheduled source per already-written region. Reading a growing buffer from a
   * source that is already playing is not guaranteed to be heard (WebKit stays
   * silent), so each slice is started only after its audio exists.
   */
  private stream: {
    buffer: AudioBuffer;
    /** Context time at which `fromFrame` is audible. */
    at: number;
    fromFrame: number;
    scheduledFrame: number;
    nodes: AudioBufferSourceNode[];
  } | null = null;
  private original: AudioBuffer | null = null;
  private processed: AudioBuffer | null = null;
  /** Processed audio is playable up to here; Infinity once the render finished. */
  private bufferedUntil = Infinity;
  private view: PlayerView = 'original';
  private volume = 0.85;
  private playing = false;
  private startCtxTime = 0;
  private startPos = 0;
  private attachedRate = 1;
  /** Tempo map of the attached render, when the processed view has one. */
  private bendMap: BendMap | null = null;
  private bendSourceDuration = 0;
  /** Buffer-time position at which the current source node starts. */
  private startBuffer = 0;
  private audioRunning = false;
  /** Silent looping media element used to put iOS Safari into playback audio session. */
  private sessionPrimer: HTMLAudioElement | null = null;
  /**
   * Media element playback. Web Audio is suspended by iOS as soon as the page is
   * backgrounded, so the finished render is mirrored into a native <audio> element:
   * that keeps playing with the screen locked and shows up in the lock screen.
   */
  private media: HTMLAudioElement | null = null;
  private mediaUrl: string | null = null;
  private mediaRate = 1;
  private mediaToken = 0;
  private mediaOf: AudioBuffer | null = null;
  private mediaStale = true;
  private usingMedia = false;
  private title = '';
  private listeners = new Set<() => void>();
  private snapshot: PlayerSnapshot = {
    playing: false,
    view: 'original',
    volume: 0.85,
    hasOriginal: false,
    hasProcessed: false,
    audioRunning: false,
  };

  ensure(): AudioContext {
    if (this.ctx) return this.ctx;
    const Ctor: typeof AudioContext =
      window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctor({ latencyHint: 'interactive' });
    const gain = ctx.createGain();
    gain.gain.value = this.volume;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 4096;
    analyser.smoothingTimeConstant = 0.72;
    analyser.minDecibels = -96;
    analyser.maxDecibels = -12;
    gain.connect(analyser);
    analyser.connect(ctx.destination);
    this.ctx = ctx;
    this.gainNode = gain;
    this.analyserNode = analyser;
    this.audioRunning = ctx.state === 'running';
    ctx.onstatechange = () => {
      this.audioRunning = ctx.state === 'running';
      this.notify();
    };
    return ctx;
  }

  /**
   * Ask the browser to start the audio context. Only works while a real user tap is
   * being handled; until then the UI shows an explicit "activate sound" button
   * instead of pretending to play.
   */
  /**
   * iOS Safari only starts a Web Audio graph from a real touch, and it mutes plain
   * Web Audio while the ring/silent switch is on. Starting a silent media element
   * once, from that touch, puts the page in the playback audio session so the graph
   * becomes audible like any other audio.
   */
  private primeAudioSession(): void {
    if (this.sessionPrimer) return;
    try {
      const blob = encodeWav16([new Float32Array(22050)], 44100);
      const audio = document.createElement('audio');
      audio.src = URL.createObjectURL(blob);
      audio.loop = true;
      audio.preload = 'auto'; // still silent: the buffer is all zeros
      audio.setAttribute('playsinline', '');
      audio.setAttribute('aria-hidden', 'true');
      audio.style.display = 'none';
      document.body.appendChild(audio);
      void audio.play().catch(() => undefined);
      this.sessionPrimer = audio;
    } catch {
      /* not fatal: Web Audio may still work */
    }
  }

  setTitle(title: string): void {
    this.title = title;
    this.updateMediaMetadata();
  }

  /**
   * Attach the map the processed buffer was rendered with. Positions stay in source
   * time, so A/B and seek keep pointing at the same musical moment.
   */
  setBendMap(map: BendMap | null, sourceDuration: number): void {
    this.bendMap = map && map.length ? map : null;
    this.bendSourceDuration = sourceDuration;
    this.startBuffer = this.bufferTimeForSource(this.startPos);
    this.notify();
  }

  /** The map only describes the processed buffer; the original plays at 1:1. */
  private activeBend(): BendMap | null {
    return this.view === 'processed' && this.processed ? this.bendMap : null;
  }

  private bufferTimeForSource(seconds: number): number {
    const map = this.activeBend();
    if (!map || !this.bendSourceDuration) return seconds / (this.activeRate() || 1);
    return sourceToBuffer(map, this.bendSourceDuration, seconds);
  }

  private sourceTimeForBuffer(seconds: number): number {
    const map = this.activeBend();
    if (!map || !this.bendSourceDuration) return seconds * (this.activeRate() || 1);
    return bufferToSource(map, this.bendSourceDuration, seconds);
  }

  private updateMediaMetadata(): void {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    const session = navigator.mediaSession;
    try {
      session.metadata = new MediaMetadata({
        title: this.title || 'VARISPEED Studio',
        artist: 'VARISPEED Studio',
        album: this.view === 'processed' ? 'Processed' : 'Original',
      });
    } catch {
      /* older browsers */
    }
    const set = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
      try {
        session.setActionHandler(action, handler);
      } catch {
        /* action not supported */
      }
    };
    set('play', () => void this.play());
    set('pause', () => this.pause());
    set('stop', () => {
      this.pause();
      this.seekSourceTime(0);
    });
    set('seekbackward', (details) => this.seekSourceTime(this.sourcePosition() - (details.seekOffset ?? 10)));
    set('seekforward', (details) => this.seekSourceTime(this.sourcePosition() + (details.seekOffset ?? 10)));
    set('seekto', (details) => {
      if (typeof details.seekTime !== 'number') return;
      this.seekSourceTime(
        this.activeBend() ? this.sourceTimeForBuffer(details.seekTime) : details.seekTime * (this.mediaRate || 1),
      );
    });
  }

  /** Stop routing through the media element and go back to Web Audio. */
  private stopMedia(): void {
    if (!this.media) return;
    this.media.onloadedmetadata = null;
    try {
      this.media.pause();
    } catch {
      /* already stopped */
    }
    this.usingMedia = false;
  }

  /**
   * Mirror the finished render into a native media element and, if the transport is
   * running, hand playback over at the same point in the song.
   */
  private attachMedia(buffer: AudioBuffer): void {
    if (buffer.duration > 480) return; // keep memory sane on very long tracks
    if (this.mediaOf === buffer && !this.mediaStale) return;
    this.mediaOf = buffer;
    const token = ++this.mediaToken;
    window.setTimeout(() => {
      if (token !== this.mediaToken) return;
      const channels: Float32Array[] = [];
      for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c));
      void encodeWav16Async(channels, buffer.sampleRate)
        .then((blob) => {
          if (token !== this.mediaToken) return;
          try {
            const url = URL.createObjectURL(blob);
            const el = this.media ?? document.createElement('audio');
            const wasPlaying = this.playing;
            const pos = wasPlaying ? this.sourcePosition() : this.startPos;
            el.preload = 'auto';
            el.setAttribute('playsinline', '');
            el.volume = this.volume;
            el.src = url;
            if (!el.isConnected) {
              // `display: none` makes iOS drop background playback for a media element;
              // keep it in the layout, off-screen and invisible.
              el.style.position = 'fixed';
              el.style.left = '-9999px';
              el.style.top = '0';
              el.style.width = '1px';
              el.style.height = '1px';
              el.style.opacity = '0';
              el.style.pointerEvents = 'none';
              document.body.appendChild(el);
            }
            const previous = this.mediaUrl;
            this.mediaUrl = url;
            this.media = el;
            this.mediaRate = this.original ? this.original.duration / buffer.duration : 1;
            this.mediaStale = false;
            this.updateMediaMetadata();
            el.onplay = () => {
              // The silent unlock loop must not hold the audio session any more.
              this.sessionPrimer?.pause();
              if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
            };
            el.onpause = () => {
              if ('mediaSession' in navigator && !this.usingMedia) navigator.mediaSession.playbackState = 'paused';
            };
            el.onended = () => {
              this.usingMedia = false;
              this.playing = false;
              this.startPos = this.sourceDuration();
              this.notify();
            };
            if (previous) URL.revokeObjectURL(previous);
            if (!wasPlaying) return;
            el.onloadedmetadata = () => {
              el.onloadedmetadata = null;
              try {
                el.currentTime = Math.min(this.bufferTimeForSource(pos), Math.max(0, (el.duration || 0) - 0.05));
              } catch {
                /* ignore */
              }
              void el
                .play()
                .then(() => {
                  this.stopNode();
                  this.usingMedia = true;
                  this.playing = true;
                  this.notify();
                })
                .catch(() => undefined);
            };
          } catch {
            /* no media path available: Web Audio keeps working */
          }
        })
        .catch(() => undefined);
    }, 120);
  }

  /**
   * Hand active playback to the media element. iOS only grants background audio to a
   * media play() that happens inside a real gesture, so this is called from every tap.
   */
  private adoptMediaIfPlaying(): void {
    if (!this.playing || this.usingMedia || !this.media || this.mediaStale || !this.media.src) return;
    const pos = this.sourcePosition();
    try {
      this.media.currentTime = Math.min(this.bufferTimeForSource(pos), Math.max(0, (this.media.duration || 0) - 0.05));
    } catch {
      /* metadata not ready yet */
    }
    void this.media
      .play()
      .then(() => {
        this.stopNode();
        this.sessionPrimer?.pause();
        this.usingMedia = true;
        this.playing = true;
        this.notify();
      })
      .catch(() => undefined);
  }

  async unlock(): Promise<boolean> {
    const ctx = this.ensure();
    this.primeAudioSession();
    // Must run synchronously inside the gesture, before any await.
    this.adoptMediaIfPlaying();
    if (ctx.state !== 'running') {
      try {
        await ctx.resume();
      } catch {
        /* still blocked */
      }
    }
    const running = ctx.state === 'running';
    if (running !== this.audioRunning) {
      this.audioRunning = running;
      this.notify();
    }
    return running;
  }

  audioIsRunning(): boolean {
    return this.audioRunning;
  }

  getAnalyser(): AnalyserNode | null {
    return this.analyserNode;
  }

  private activeBuffer(): AudioBuffer | null {
    return this.view === 'processed' ? (this.processed ?? this.original) : this.original;
  }

  private activeRate(): number {
    if (this.view === 'processed' && this.processed && this.original) {
      return this.original.duration / this.processed.duration;
    }
    return 1;
  }

  /** Duration of the original song, in seconds. */
  sourceDuration(): number {
    return this.original?.duration ?? 0;
  }

  /** Length of the buffer currently attached to the transport. */
  bufferDuration(): number {
    return this.activeBuffer()?.duration ?? 0;
  }

  /** The processed AudioBuffer currently attached, if any. */
  processedBuffer(): AudioBuffer | null {
    return this.processed;
  }

  /** Playhead expressed in original-song time. */
  sourcePosition(): number {
    const map = this.activeBend();
    if (this.usingMedia && this.media) {
      if (map) return Math.min(this.sourceTimeForBuffer(this.media.currentTime), this.sourceDuration());
      return Math.min(this.media.currentTime * (this.mediaRate || 1), this.sourceDuration());
    }
    if (!this.playing || !this.ctx) return this.startPos;
    if (map) {
      const bufferPos = this.startBuffer + (this.ctx.currentTime - this.startCtxTime);
      return Math.min(this.sourceTimeForBuffer(bufferPos), this.sourceDuration());
    }
    const elapsed = (this.ctx.currentTime - this.startCtxTime) * this.attachedRate;
    const pos = this.startPos + elapsed;
    return Math.min(pos, this.sourceDuration());
  }

  /** Playhead expressed in the attached buffer's own timebase (what the waveform draws). */
  bufferPosition(): number {
    if (this.activeBend()) {
      if (this.usingMedia && this.media) return this.media.currentTime;
      if (!this.playing || !this.ctx) return this.bufferTimeForSource(this.startPos);
      return this.startBuffer + (this.ctx.currentTime - this.startCtxTime);
    }
    const rate = this.playing ? this.attachedRate : this.activeRate();
    return this.sourcePosition() / (rate || 1);
  }

  isPlaying(): boolean {
    return this.playing;
  }

  async play(): Promise<void> {
    const running = await this.unlock();
    // Do not claim to be playing while the browser is keeping the context suspended.
    if (!running) return;
    if (this.playing || !this.activeBuffer()) return;
    const duration = this.sourceDuration();
    if (this.startPos >= duration - 0.03) this.startPos = 0;

    // Prefer the media element: it is the only path that survives backgrounding.
    if (this.view === 'processed' && this.media && !this.mediaStale && this.media.src) {
      try {
        this.media.currentTime = Math.min(
          this.bufferTimeForSource(this.startPos),
          Math.max(0, (this.media.duration || 0) - 0.05),
        );
        await this.media.play();
        this.stopNode();
        this.sessionPrimer?.pause();
        this.usingMedia = true;
        this.playing = true;
        this.notify();
        return;
      } catch {
        /* fall through to Web Audio */
      }
    }

    this.usingMedia = false;
    this.startNode(this.startPos);
    this.playing = true;
    this.notify();
  }

  pause(): void {
    if (!this.playing) return;
    this.startPos = this.sourcePosition();
    this.playing = false;
    if (this.usingMedia) this.stopMedia();
    this.stopNode();
    this.notify();
  }

  async toggle(): Promise<void> {
    if (this.playing) this.pause();
    else await this.play();
  }

  /** Longest position the transport may move to right now. */
  private maxSourcePosition(): number {
    const duration = this.sourceDuration();
    if (!duration) return 0;
    if (this.view === 'processed' && this.processed && Number.isFinite(this.bufferedUntil)) {
      if (this.activeBend()) return Math.min(duration, this.sourceTimeForBuffer(this.bufferedUntil));
      return Math.min(duration, this.bufferedUntil * (this.activeRate() || 1));
    }
    return duration;
  }

  seekSourceTime(seconds: number): void {
    const duration = this.sourceDuration();
    if (!duration) return;
    const pos = Math.max(0, Math.min(this.maxSourcePosition(), seconds));
    if (this.usingMedia && this.media) {
      try {
        this.media.currentTime = this.bufferTimeForSource(pos);
      } catch {
        /* metadata not ready */
      }
      this.startPos = pos;
      this.notify();
      return;
    }
    if (this.playing) {
      this.startNode(pos);
    } else {
      this.startPos = pos;
    }
    this.notify();
  }

  seekBufferTime(seconds: number): void {
    if (this.activeBend()) {
      this.seekSourceTime(this.sourceTimeForBuffer(seconds));
      return;
    }
    const rate = this.playing ? this.attachedRate : this.activeRate();
    this.seekSourceTime(seconds * (rate || 1));
  }

  setView(view: PlayerView): void {
    if (view === this.view) return;
    if (view === 'processed' && !this.processed) return;
    const pos = this.sourcePosition();
    this.view = view;
    this.updateMediaMetadata();
    // The media element only carries the processed render.
    if (view === 'original' && this.usingMedia) this.stopMedia();
    if (this.playing) this.startNode(pos);
    else this.startPos = pos;
    this.notify();
  }

  setOriginal(buffer: AudioBuffer | null): void {
    this.stopNode();
    this.stopMedia();
    this.mediaToken += 1;
    this.mediaOf = null;
    this.mediaStale = true;
    if (this.mediaUrl) {
      URL.revokeObjectURL(this.mediaUrl);
      this.mediaUrl = null;
    }
    if (this.media) this.media.removeAttribute('src');
    this.playing = false;
    this.original = buffer;
    this.processed = null;
    this.bufferedUntil = Infinity;
    this.view = 'original';
    this.bendMap = null;
    this.bendSourceDuration = 0;
    this.startBuffer = 0;
    this.startPos = 0;
    this.notify();
  }

  /**
   * Attach the rendered track. Passing the same buffer again only updates how much
   * of it is playable, which is how a streamed render keeps playing without a gap.
   */
  setProcessed(buffer: AudioBuffer | null, opts?: { bufferedUntil?: number; restart?: boolean }): void {
    if (buffer && buffer === this.processed) {
      // Same buffer: the frontier only ever grows, so a re-render never makes
      // audio that was already playable unreachable. Any newly written audio is
      // appended to the playing schedule instead of restarting it.
      const frontier = Math.max(this.bufferedUntil, opts?.bufferedUntil ?? Infinity);
      this.bufferedUntil = frontier;
      if (this.bufferedUntil === Infinity) this.attachMedia(buffer);
      if (this.playing && opts?.restart) {
        // Bass and voice changes rewrite the buffer in place. A source that is
        // already playing keeps the samples it started with (WebKit especially),
        // so the new mastering has to be re-seated to become audible, and the
        // stale media file has to be replaced by a fresh one.
        this.mediaStale = true;
        this.stopMedia();
        this.startNode(this.sourcePosition());
      } else if (this.playing && !this.usingMedia) {
        this.extendStream();
      }
      this.notify();
      return;
    }
    const wasPlaying = this.playing;
    const pos = this.sourcePosition();
    this.processed = buffer;
    this.bufferedUntil = opts?.bufferedUntil ?? Infinity;
    if (!buffer && this.view === 'processed') this.view = 'original';
    if (buffer) {
      this.mediaStale = true;
      this.stopMedia();
    }
    // A freshly rendered buffer swaps in at the same point in the song.
    if (wasPlaying && buffer && this.view === 'processed') this.startNode(pos);
    if (buffer && this.bufferedUntil === Infinity) this.attachMedia(buffer);
    this.notify();
  }

  setVolume(value: number): void {
    this.volume = Math.max(0, Math.min(1, value));
    if (this.media) this.media.volume = this.volume;
    if (this.gainNode && this.ctx) {
      const g = this.gainNode.gain;
      g.cancelScheduledValues(this.ctx.currentTime);
      g.setValueAtTime(g.value, this.ctx.currentTime);
      g.linearRampToValueAtTime(this.volume, this.ctx.currentTime + 0.04);
    }
    this.notify();
  }

  private playableFrames(buffer: AudioBuffer): number {
    const limit = Number.isFinite(this.bufferedUntil) ? this.bufferedUntil : buffer.duration;
    return Math.min(buffer.length, Math.max(0, Math.floor(limit * buffer.sampleRate)));
  }

  private startNode(sourcePosition: number): void {
    const buffer = this.activeBuffer();
    if (!buffer || !this.ctx || !this.gainNode) return;
    this.stopNode();

    const rate = this.activeRate();
    // Never start past the rendered frontier: beyond it the buffer is still empty.
    const playable = this.playableFrames(buffer);
    const target = this.bufferTimeForSource(sourcePosition);
    const startFrame = Math.max(
      0,
      Math.min(Math.floor(target * buffer.sampleRate), Math.max(0, playable - 1)),
    );

    const gain = this.gainNode.gain;
    gain.cancelScheduledValues(this.ctx.currentTime);
    gain.setValueAtTime(0.0001, this.ctx.currentTime);
    gain.linearRampToValueAtTime(this.volume, this.ctx.currentTime + 0.015);

    const when = this.ctx.currentTime + 0.01;
    this.attachedRate = rate;
    this.startCtxTime = when;
    this.startBuffer = startFrame / buffer.sampleRate;
    this.startPos = this.activeBend()
      ? this.sourceTimeForBuffer(this.startBuffer)
      : (startFrame / buffer.sampleRate) * (rate || 1);

    const streaming = this.view === 'processed' && playable < buffer.length;
    if (streaming) {
      this.stream = { buffer, at: when, fromFrame: startFrame, scheduledFrame: startFrame, nodes: [] };
      this.extendStream();
      return;
    }

    this.stream = null;
    const node = this.ctx.createBufferSource();
    node.buffer = buffer;
    // Browsers resample an AudioBuffer to the context rate, so playbackRate stays 1.
    node.connect(this.gainNode);
    node.onended = () => {
      if (this.node !== node) return;
      this.playing = false;
      this.node = null;
      this.startPos = this.sourceDuration();
      this.notify();
    };
    this.node = node;
    node.start(when, startFrame / buffer.sampleRate);
  }

  /** Schedule every frame that has been written since the last call. */
  private extendStream(): void {
    const stream = this.stream;
    if (!stream || !this.ctx || !this.gainNode) return;

    const playable = this.playableFrames(stream.buffer);
    if (stream.scheduledFrame >= playable) return;

    const frameToTime = (frame: number) => stream.at + (frame - stream.fromFrame) / stream.buffer.sampleRate;
    let when = frameToTime(stream.scheduledFrame);
    const now = this.ctx.currentTime;
    if (when < now) {
      // The render fell behind playback: re-anchor so the schedule stays contiguous.
      const late = now - when;
      stream.at += late;
      this.startCtxTime += late;
      when = now;
    }

    const frames = playable - stream.scheduledFrame;
    const node = this.ctx.createBufferSource();
    node.buffer = stream.buffer;
    node.connect(this.gainNode);
    node.start(when, stream.scheduledFrame / stream.buffer.sampleRate, frames / stream.buffer.sampleRate);
    node.onended = () => {
      if (this.stream !== stream) return;
      stream.nodes = stream.nodes.filter((item) => item !== node);
      if (stream.scheduledFrame >= stream.buffer.length && stream.nodes.length === 0) {
        this.stream = null;
        this.playing = false;
        this.startPos = this.sourceDuration();
        this.notify();
      }
    };
    stream.nodes.push(node);
    stream.scheduledFrame = playable;
  }

  private stopNode(): void {
    if (this.stream) {
      for (const node of this.stream.nodes) {
        node.onended = null;
        try {
          node.stop();
        } catch {
          /* already stopped */
        }
        node.disconnect();
      }
      this.stream = null;
    }
    if (!this.node) return;
    this.node.onended = null;
    try {
      this.node.stop();
    } catch {
      /* already stopped */
    }
    this.node.disconnect();
    this.node = null;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): PlayerSnapshot => this.snapshot;

  private notify(): void {
    this.snapshot = {
      playing: this.playing,
      view: this.view,
      volume: this.volume,
      hasOriginal: !!this.original,
      hasProcessed: !!this.processed,
      audioRunning: this.audioRunning,
    };
    for (const listener of this.listeners) listener();
  }
}

export const player = new Player();
