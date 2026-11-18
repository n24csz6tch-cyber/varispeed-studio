import type { RenderStats, Settings } from './types';

export type ExportFormat = 'wav' | 'mp3';

export interface RenderProgress {
  phase: 'stretch' | 'master' | 'encode';
  value: number;
}

export interface ExportResult {
  blob: Blob;
  sampleRate: number;
  duration: number;
  stats: RenderStats;
  bytes: number;
}

export type WorkerRequest =
  | { type: 'load'; requestId: number; channels: Float32Array[]; sampleRate: number }
  | { type: 'render'; requestId: number; settings: Settings; quality: 'preview' | 'final' }
  | { type: 'export'; requestId: number; settings: Settings; format: ExportFormat }
  | { type: 'cancel'; requestId: number };

export interface RenderChunk {
  channels: Float32Array[];
  startFrame: number;
  totalFrames: number;
  sampleRate: number;
}

export type WorkerResponse =
  | { type: 'loaded'; requestId: number; duration: number }
  | { type: 'progress'; requestId: number; phase: RenderProgress['phase']; value: number }
  | ({ type: 'chunk'; requestId: number } & RenderChunk)
  | {
      type: 'render';
      requestId: number;
      sampleRate: number;
      totalFrames: number;
      duration: number;
      stats: RenderStats;
    }
  | { type: 'export'; requestId: number; result: ExportResult }
  | { type: 'cancelled'; requestId: number }
  | { type: 'error'; requestId: number; message: string };
