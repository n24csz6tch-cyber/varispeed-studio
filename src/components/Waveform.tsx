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

/** Colours come from the active theme, so the waveform follows a palette change. */
function readPalette() {
  const styles = getComputedStyle(document.documentElement);
  const ink = styles.getPropertyValue('--ink-rgb').trim().replace(/\s+/g, ',') || '26,22,18';
  const accent = styles.getPropertyValue('--accent').trim() || '#d94e2a';
  const accent2 = styles.getPropertyValue('--accent-2').trim() || '#1e3a5f';
  const accentRgb = styles.getPropertyValue('--accent-rgb').trim().replace(/\s+/g, ',') || '217,78,42';
  return {
    ink,
    centre: `rgba(${ink}, 0.1)`,
    ghost: `rgba(${ink}, 0.16)`,
    accent,
    accent2,
    accentRgb,
  };
}

/** Canvas waveform: active buffer in the theme accent, the other version ghosted behind it. */
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
    let raf = 0;
    let lastPosition = Number.NaN;
    let palette = readPalette();

    const overlay = (force = false) => {
      const { width, height, dpr } = sizeRef.current;
      if (!width) return;
      const position = player.bufferPosition();
      if (!force && !player.isPlaying() && Math.abs(position - lastPosition) < 1e-4) return;
      lastPosition = position;

      ctx.clearRect(0, 0, width, height);
      if (layerRef.current) ctx.drawImage(layerRef.current, 0, 0);

      const duration = player.bufferDuration();
      if (duration <= 0) return;
      const x = Math.max(0, Math.min(width, (position / duration) * width));
      ctx.fillStyle = `rgba(${palette.accentRgb}, 0.1)`;
      ctx.fillRect(0, 0, x, height);
      ctx.fillStyle = palette.accent;
      ctx.fillRect(x - 1 * dpr, 0, 2 * dpr, height);
      ctx.beginPath();
      ctx.arc(x, 10 * dpr, 3.6 * dpr, 0, Math.PI * 2);
      ctx.fill();
    };

    const tick = () => {
      raf = 0;
      overlay();
      if (player.isPlaying()) raf = requestAnimationFrame(tick);
    };

    const wake = () => {
      if (!raf) raf = requestAnimationFrame(tick);
    };

    const sync = () => {
      if (player.isPlaying()) {
        wake();
        return;
      }
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
      overlay(true);
    };

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
      if (layer.width !== width) layer.width = width;
      if (layer.height !== height) layer.height = height;
      const lctx = layer.getContext('2d');
      if (!lctx) return;

      palette = readPalette();
      lctx.clearRect(0, 0, width, height);
      const mid = height / 2;

      // centre line
      lctx.fillStyle = palette.centre;
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

      if (ghost) drawPeaks(ghost, palette.ghost, 1, 1);
      if (active) {
        if (view === 'processed') {
          const gradient = lctx.createLinearGradient(0, 0, 0, height);
          gradient.addColorStop(0, palette.accent);
          gradient.addColorStop(1, palette.accent2);
          drawPeaks(active, gradient, 0.92, 1);
        } else {
          drawPeaks(active, `rgba(${palette.ink}, 0.82)`, 0.92, 1);
        }
      }

      lastPosition = Number.NaN;
      overlay(true);
      if (player.isPlaying()) wake();
    };

    paint();
    const observer = new ResizeObserver(() => paint());
    observer.observe(canvas);
    const themeWatcher = new MutationObserver(() => paint());
    themeWatcher.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const unsubscribe = player.subscribe(sync);
    sync();

    return () => {
      unsubscribe();
      observer.disconnect();
      themeWatcher.disconnect();
      if (raf) cancelAnimationFrame(raf);
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
