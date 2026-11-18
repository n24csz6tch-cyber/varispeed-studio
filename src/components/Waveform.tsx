import { memo, useEffect, useRef } from 'react';
import type { Peaks } from '../audio/types';
import type { Player } from '../audio/player';

interface WaveformProps {
  originalPeaks: Peaks | null;
  processedPeaks: Peaks | null;
  player: Player;
  view: 'original' | 'processed';
}

const HEIGHT = 96;

/** Canvas waveform: active buffer in the accent colour, the other version ghosted behind it. */
export const Waveform = memo(function Waveform({ originalPeaks, processedPeaks, player, view }: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layerRef = useRef<HTMLCanvasElement | null>(null);
  const sizeRef = useRef({ width: 0, height: 0, dpr: 1 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const active = view === 'processed' && processedPeaks ? processedPeaks : originalPeaks;
    const ghost = view === 'processed' ? originalPeaks : processedPeaks;

    const paint = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      const width = Math.max(1, Math.round(rect.width * dpr));
      const height = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      sizeRef.current = { width, height, dpr };

      const layer = layerRef.current ?? document.createElement('canvas');
      layerRef.current = layer;
      layer.width = width;
      layer.height = height;
      const lctx = layer.getContext('2d');
      if (!lctx) return;

      lctx.clearRect(0, 0, width, height);
      const mid = height / 2;

      // centre line
                lctx.fillStyle = 'rgba(240,238,229,0.07)';
      lctx.fillRect(0, mid - 0.5 * dpr, width, dpr);

      const drawPeaks = (peaks: Peaks, color: string | CanvasGradient, scale: number, alpha: number) => {
        const buckets = peaks.max.length;
        if (!buckets) return;
        lctx.globalAlpha = alpha;
        lctx.fillStyle = color;
        const column = Math.max(1, Math.round(dpr));
        const step = width / buckets;
        for (let i = 0; i < buckets; i++) {
          const x = i * step;
          const top = peaks.max[i];
          const bottom = peaks.min[i];
          const y1 = mid - top * mid * scale;
          const y2 = mid - bottom * mid * scale;
          const h = Math.max(column, Math.abs(y2 - y1));
          lctx.fillRect(x, Math.min(y1, y2), Math.max(step * 0.72, column), h);
        }
        lctx.globalAlpha = 1;
      };

      if (ghost) drawPeaks(ghost, 'rgba(190,200,220,0.22)', 1, 1);
      if (active) {
        const gradient = lctx.createLinearGradient(0, 0, 0, height);
        if (view === 'processed') {
          gradient.addColorStop(0, '#f0ffb0');
          gradient.addColorStop(0.45, '#d7ff4f');
          gradient.addColorStop(1, '#8fb91f');
        } else {
          gradient.addColorStop(0, '#eef0e6');
          gradient.addColorStop(0.5, '#b9c0b4');
          gradient.addColorStop(1, '#6f7a72');
        }
        drawPeaks(active, gradient, 0.92, 1);
      }

      lastPosition = Number.NaN;
      frame();
    };

    let raf = 0;
    let lastPosition = -1;
    const frame = () => {
      const layer = layerRef.current;
      if (!canvas || !ctx || !layer) return;
      const { width, height } = sizeRef.current;
      const position = player.bufferPosition();
      const active = player.isPlaying();
      // Idle when paused: don't repaint the same frame 60 times a second.
      if (!active && Math.abs(position - lastPosition) < 1e-4) {
        raf = requestAnimationFrame(frame);
        return;
      }
      lastPosition = position;
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(layer, 0, 0);

      const duration = player.bufferDuration();
      if (duration > 0) {
        const x = Math.max(0, Math.min(width, (position / duration) * width));
        const gradient = ctx.createLinearGradient(0, 0, width, 0);
        gradient.addColorStop(0, 'rgba(215,255,79,0.12)');
        gradient.addColorStop(1, 'rgba(215,255,79,0.02)');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, x, height);
        ctx.fillStyle = '#f4ffe2';
        ctx.fillRect(x - 1 * sizeRef.current.dpr, 0, 2 * sizeRef.current.dpr, height);
        ctx.beginPath();
        ctx.arc(x, 10 * sizeRef.current.dpr, 3.6 * sizeRef.current.dpr, 0, Math.PI * 2);
        ctx.fillStyle = '#d7ff4f';
        ctx.fill();
      }
      raf = requestAnimationFrame(frame);
    };

    paint();
    const observer = new ResizeObserver(() => paint());
    observer.observe(canvas);

    return () => {
      observer.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [originalPeaks, processedPeaks, player, view]);

  const seekTo = (clientX: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const duration = player.bufferDuration();
    if (duration > 0) player.seekBufferTime(fraction * duration);
  };

  return (
    <div className="wave">
      <canvas
        ref={canvasRef}
        className="wave__canvas"
        style={{ height: HEIGHT }}
        role="slider"
        tabIndex={0}
        aria-label="Seek in the track"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round((player.bufferPosition() / Math.max(player.bufferDuration(), 0.001)) * 100)}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          seekTo(event.clientX);
        }}
        onPointerMove={(event) => {
          if (event.buttons === 1) seekTo(event.clientX);
        }}
      />
      <div className="wave__scale">
        <span>0:00</span>
        <span>{view === 'processed' ? 'PROCESSED LENGTH' : 'ORIGINAL LENGTH'}</span>
      </div>
    </div>
  );
});
