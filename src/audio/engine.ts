import type { ExportFormat, ExportResult, RenderChunk, RenderProgress, WorkerRequest, WorkerResponse } from './protocol';
import type { BendMap, RenderResult, Settings } from './types';

export class JobCancelled extends Error {
  constructor() {
    super('cancelled');
    this.name = 'JobCancelled';
  }
}

interface Job {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  onProgress?: (progress: RenderProgress) => void;
  onChunk?: (chunk: RenderChunk) => void;
}

/**
 * Owns the processing worker. Rendering, exporting and loading always happen off
 * the main thread, so the interface never blocks while a song is being rendered.
 */
export class StudioEngine {
  private worker: Worker | null = null;
  private jobs = new Map<number, Job>();
  private sequence = 1;
  private sourceId: number | null = null;
  private activeRender: number | null = null;
  private activeExport: number | null = null;

  /** Create the worker and let it compile the WASM engine before the first track is loaded. */
  warm(): void {
    this.ensureWorker();
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => this.handleResponse(event.data);
    worker.onerror = (event) => {
      const message = event.message || 'The audio engine crashed.';
      for (const [, job] of this.jobs) job.reject(new Error(message));
      this.jobs.clear();
    };
    this.worker = worker;
    return worker;
  }

  private handleResponse(message: WorkerResponse) {
    const job = this.jobs.get(message.requestId);
    if (!job) return;
    switch (message.type) {
      case 'progress':
        job.onProgress?.({ phase: message.phase, value: message.value });
        break;
      case 'loaded':
        this.jobs.delete(message.requestId);
        job.resolve(message.duration);
        break;
      case 'chunk':
        job.onChunk?.({
          channels: message.channels,
          startFrame: message.startFrame,
          totalFrames: message.totalFrames,
          sampleRate: message.sampleRate,
        });
        break;
      case 'render':
        this.jobs.delete(message.requestId);
        job.resolve({
          sampleRate: message.sampleRate,
          totalFrames: message.totalFrames,
          duration: message.duration,
          stats: message.stats,
        } satisfies RenderResult);
        break;
      case 'export':
        this.jobs.delete(message.requestId);
        job.resolve(message.result satisfies ExportResult);
        break;
      case 'cancelled':
        this.jobs.delete(message.requestId);
        job.reject(new JobCancelled());
        break;
      case 'error':
        this.jobs.delete(message.requestId);
        job.reject(new Error(message.message));
        break;
      default:
        break;
    }
  }

  private send<T>(
    message: WorkerRequest,
    transfer: Transferable[] = [],
    onProgress?: (p: RenderProgress) => void,
    onChunk?: (chunk: RenderChunk) => void,
  ): Promise<T> {
    const worker = this.ensureWorker();
    return new Promise<T>((resolve, reject) => {
      this.jobs.set(message.requestId, { resolve: resolve as (v: unknown) => void, reject, onProgress, onChunk });
      worker.postMessage(message, transfer);
    });
  }

  /**
   * Transfers the decoded PCM into the worker. The caller must not use the arrays
   * afterwards — their buffers now live in the worker, which avoids a second copy.
   */
  async loadSource(trackId: number, channels: Float32Array[], sampleRate: number): Promise<void> {
    if (this.sourceId === trackId) return;
    if (!channels.length || !channels[0].length) throw new Error('No audio data to load.');
    const requestId = this.sequence++;
    await this.send({ type: 'load', requestId, channels, sampleRate }, channels.map((c) => c.buffer));
    this.sourceId = trackId;
  }

  async render(
    settings: Settings,
    quality: 'preview' | 'final',
    bend: BendMap | null,
    onProgress?: (progress: RenderProgress) => void,
    onChunk?: (chunk: RenderChunk) => void,
  ): Promise<RenderResult> {
    if (this.activeRender !== null) this.cancel(this.activeRender);
    const requestId = this.sequence++;
    this.activeRender = requestId;
    try {
      return await this.send<RenderResult>(
        { type: 'render', requestId, settings, quality, bend: bend ?? undefined },
        [],
        onProgress,
        onChunk,
      );
    } finally {
      if (this.activeRender === requestId) this.activeRender = null;
    }
  }

  async exportTrack(
    settings: Settings,
    format: ExportFormat,
    bend: BendMap | null,
    onProgress?: (progress: RenderProgress) => void,
  ): Promise<ExportResult> {
    const requestId = this.sequence++;
    this.activeExport = requestId;
    try {
      return await this.send<ExportResult>(
        { type: 'export', requestId, settings, format, bend: bend ?? undefined },
        [],
        onProgress,
      );
    } finally {
      if (this.activeExport === requestId) this.activeExport = null;
    }
  }

  cancel(requestId?: number) {
    const id = requestId ?? this.activeRender;
    if (id === null || id === undefined) return;
    this.worker?.postMessage({ type: 'cancel', requestId: id } satisfies WorkerRequest);
  }

  cancelExport() {
    this.cancel(this.activeExport ?? undefined);
  }

  dispose() {
    this.worker?.terminate();
    this.worker = null;
    this.jobs.clear();
  }
}

export const engine = new StudioEngine();
