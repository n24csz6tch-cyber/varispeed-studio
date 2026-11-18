import { memo, useEffect, useRef } from 'react';
import type { Player } from '../audio/player';

const BARS = 58;
const F_MIN = 20;
const F_MAX = 16000;

function readPalette() {
  const styles = getComputedStyle(document.documentElement);
  const ink = styles.getPropertyValue('--ink-rgb').trim().replace(/\s+/g, ',') || '26,22,18';
  const accent = styles.getPropertyValue('--accent').trim() || '#d94e2a';
  const accent2 = styles.getPropertyValue('--accent-2').trim() || '#1e3a5f';
  const accentRgb = styles.getPropertyValue('--accent-rgb').trim().replace(/\s+/g, ',') || '217,78,42';
  return {
    grid: `rgba(${ink}, 0.07)`,
    accent,
    accent2,
    /** Bass bars need a real alpha, so the accent is kept as channels too. */
    bass: `rgba(${accentRgb}, 0.9)`,
    bassSoft: `rgba(${accentRgb}, 0.55)`,
  };
}

/** Real-time spectrum analyser with a highlighted bass region and a low-band energy meter. */
export const Spectrum = memo(function Spectrum({ player }: { player: Player }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const meterRef = useRef<HTMLDivElement>(null);
  const valueRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    let data: Uint8Array<ArrayBuffer> | null = null;
    const smoothed = new Float32Array(BARS);
    let bassPeak = 0;
    let last = 0;
    let palette = readPalette();
    let width = 1;
    let height = 1;
    let dpr = 1;

    const label = (text: string) => {
      if (valueRef.current) valueRef.current.textContent = text;
    };

    const setMeter = (fraction: number) => {
      if (meterRef.current) meterRef.current.style.width = `${Math.min(100, fraction * 130)}%`;
    };

    const drawGrid = () => {
      ctx.clearRect(0, 0, width, height);
      ctx.strokeStyle = palette.grid;
      ctx.lineWidth = dpr;
      for (let i = 1; i < 4; i++) {
        const y = (height / 4) * i;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }
    };

    const idlePaint = () => {
      palette = readPalette();
      drawGrid();
      setMeter(0);
      bassPeak = 0;
      const marker = meterRef.current?.parentElement?.querySelector<HTMLElement>('.meter__peak');
      if (marker) marker.style.left = '0%';
      label(player.analyserLive() ? '−60 dB' : 'NATIVE');
      if (valueRef.current) {
        valueRef.current.title = player.analyserLive()
          ? 'Energy below 150 Hz'
          : 'Playback is on the native media element, which bypasses the analyser.';
      }
    };

    const paintBars = (live: boolean) => {
      const analyser = player.getAnalyser();
      if (!analyser) return;
      const bins = analyser.frequencyBinCount;
      if (!data || data.length !== bins) data = new Uint8Array(bins);

      const nyquist = (analyser.context.sampleRate || 48000) / 2;
      if (live) analyser.getByteFrequencyData(data);
      else data.fill(0);

      drawGrid();
      const gap = 2 * dpr;
      const barWidth = Math.max(1, width / BARS - gap);
      let bassSum = 0;
      let bassCount = 0;

      for (let i = 0; i < BARS; i++) {
        const f0 = F_MIN * Math.pow(F_MAX / F_MIN, i / BARS);
        const f1 = F_MIN * Math.pow(F_MAX / F_MIN, (i + 1) / BARS);
        const bin0 = Math.max(0, Math.floor((f0 / nyquist) * bins));
        const bin1 = Math.max(bin0 + 1, Math.ceil((f1 / nyquist) * bins));
        let max = 0;
        for (let b = bin0; b < bin1 && b < bins; b++) if (data[b] > max) max = data[b];

        if (f0 < 150) {
          bassSum += max;
          bassCount++;
        }

        const target = Math.pow(max / 255, 1.25);
        smoothed[i] = Math.max(target, smoothed[i] * 0.82);
        const h = Math.max(dpr, smoothed[i] * (height - 6 * dpr));
        const x = i * (barWidth + gap);
        const isBass = f0 < 150;

        if (isBass) {
          ctx.fillStyle = palette.bass;
        } else {
          ctx.fillStyle = palette.accent2;
          ctx.globalAlpha = 0.62;
        }
        ctx.fillRect(x, height - h, barWidth, h);
        ctx.globalAlpha = 1;
      }

      const bassLevel = bassCount > 0 ? bassSum / bassCount / 255 : 0;
      bassPeak = Math.max(bassLevel, bassPeak - 0.012);
      setMeter(bassLevel);
      const db = bassLevel > 0.001 ? 20 * Math.log10(bassLevel) : -60;
      label(`${db > -0.5 ? '0' : db.toFixed(0)} dB`);
      if (bassPeak > 0) {
        const marker = meterRef.current?.parentElement?.querySelector<HTMLElement>('.meter__peak');
        if (marker) marker.style.left = `${Math.min(100, bassPeak * 130)}%`;
      }
    };

    const tick = (time: number) => {
      raf = 0;
      if (player.isPlaying() && player.analyserLive()) {
        if (time - last < 1000 / 34) {
          raf = requestAnimationFrame(tick);
          return;
        }
        last = time;
        paintBars(true);
        raf = requestAnimationFrame(tick);
        return;
      }

      // Not playing: let the bars fall, then stop painting entirely.
      let any = false;
      for (let i = 0; i < BARS; i++) {
        smoothed[i] *= 0.82;
        if (smoothed[i] < 0.004) smoothed[i] = 0;
        else any = true;
      }
      if (!any) {
        idlePaint();
        return;
      }
      paintBars(false);
      raf = requestAnimationFrame(tick);
    };

    const wake = () => {
      if (!raf) raf = requestAnimationFrame(tick);
    };

    const sync = () => {
      palette = readPalette();
      if (!player.analyserLive()) {
        if (raf) {
          cancelAnimationFrame(raf);
          raf = 0;
        }
        idlePaint();
        return;
      }
      wake();
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(1, Math.round(rect.width * dpr));
      height = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      palette = readPalette();
      if (player.isPlaying() && player.analyserLive()) wake();
      else idlePaint();
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    const themeWatcher = new MutationObserver(() => {
      palette = readPalette();
      if (!player.isPlaying() || !player.analyserLive()) idlePaint();
    });
    themeWatcher.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const unsubscribe = player.subscribe(sync);
    sync();

    return () => {
      unsubscribe();
      observer.disconnect();
      themeWatcher.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [player]);

  return (
    <div className="spectrum">
      <div className="spectrum__head">
        <span className="micro">SPECTRUM</span>
        <div className="spectrum__bass">
          <span className="micro">LOW END</span>
          <div className="meter">
            <div className="meter__fill" ref={meterRef} />
            <div className="meter__peak" />
          </div>
          <span className="spectrum__db" ref={valueRef}>
            −60 dB
          </span>
        </div>
      </div>
      <canvas ref={canvasRef} className="spectrum__canvas" />
      <div className="spectrum__axis">
        <span>20 Hz</span>
        <span>150</span>
        <span>1 kHz</span>
        <span>10 kHz</span>
      </div>
    </div>
  );
});
