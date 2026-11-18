import { memo, useEffect, useRef } from 'react';
import type { Player } from '../audio/player';

const BARS = 58;
const F_MIN = 20;
const F_MAX = 16000;

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
    let idleDrawn = false;

    const draw = (time: number) => {
      raf = requestAnimationFrame(draw);
      if (time - last < 1000 / 34) return;
      last = time;

      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.round(rect.width * dpr));
      const height = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }

      ctx.clearRect(0, 0, width, height);

      // grid
      ctx.strokeStyle = 'rgba(255,255,255,0.05)';
      ctx.lineWidth = dpr;
      for (let i = 1; i < 4; i++) {
        const y = (height / 4) * i;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      const analyser = player.getAnalyser();
      const playingNow = player.isPlaying();
      if (!analyser) return;

      if (!playingNow) {
        // Let the bars fall, then stop painting entirely while idle (battery).
        let any = false;
        for (let i = 0; i < BARS; i++) {
          smoothed[i] *= 0.86;
          if (smoothed[i] < 0.003) smoothed[i] = 0;
          else any = true;
        }
        if (!any) {
          if (!idleDrawn) {
            ctx.clearRect(0, 0, width, height);
            idleDrawn = true;
            if (meterRef.current) meterRef.current.style.width = '0%';
            if (valueRef.current) valueRef.current.textContent = '−60 dB';
          }
          return;
        }
      } else {
        idleDrawn = false;
      }
      const bins = analyser.frequencyBinCount;
      if (!data || data.length !== bins) data = new Uint8Array(bins);

      if (playingNow) analyser.getByteFrequencyData(data);
      else data.fill(0);

      const nyquist = (analyser.context.sampleRate || 48000) / 2;
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

        const normalized = max / 255;
        const target = Math.pow(normalized, 1.25);
        smoothed[i] = Math.max(target, smoothed[i] * 0.82);
        const h = Math.max(dpr, smoothed[i] * (height - 6 * dpr));
        const x = i * (barWidth + gap);
        const isBass = f0 < 150;

        const gradient = ctx.createLinearGradient(0, height, 0, height - h);
        if (isBass) {
          gradient.addColorStop(0, 'rgba(255,138,76,0.95)');
          gradient.addColorStop(1, 'rgba(255,196,120,0.75)');
        } else {
          gradient.addColorStop(0, 'rgba(126,164,214,0.75)');
          gradient.addColorStop(1, 'rgba(150,205,230,0.35)');
        }
        ctx.fillStyle = gradient;
        ctx.fillRect(x, height - h, barWidth, h);
      }

      const bassLevel = bassCount > 0 ? bassSum / bassCount / 255 : 0;
      bassPeak = Math.max(bassLevel, bassPeak - 0.012);
      if (meterRef.current) meterRef.current.style.width = `${Math.min(100, bassLevel * 130)}%`;
      if (valueRef.current) {
        const db = bassLevel > 0.001 ? 20 * Math.log10(bassLevel) : -60;
        valueRef.current.textContent = `${db > -0.5 ? '0' : db.toFixed(0)} dB`;
      }
      if (bassPeak > 0) {
        // peak marker inside the meter is drawn via the CSS width of the marker
        const marker = meterRef.current?.parentElement?.querySelector<HTMLElement>('.meter__peak');
        if (marker) marker.style.left = `${Math.min(100, bassPeak * 130)}%`;
      }
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [player]);

  return (
    <div className="spectrum">
      <div className="spectrum__head">
        <span className="micro">ESPECTRO</span>
        <div className="spectrum__bass">
          <span className="micro">GRAVES</span>
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
