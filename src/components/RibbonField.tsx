import { useEffect, useRef } from 'react';

interface Ribbon {
  // Base vertical position as fraction of height.
  base: number;
  // Amplitude fraction of height.
  amp: number;
  freq: number;
  phase: number;
  speed: number;
  thickness: number;
  hue: number; // 0 = coral, 1 = amber
}

/**
 * A field of slow, flowing silk ribbons. Unlike a node graph, this is one continuous
 * motion: layered translucent waves that drift and breathe like sound made visible.
 * Pauses when the tab is hidden and respects prefers-reduced-motion.
 */
export function RibbonField({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const finePointer = window.matchMedia('(pointer: fine)');
    const pointer = { x: -9999, y: -9999, active: false };

    let width = 0;
    let height = 0;
    let dpr = 1;
    let ribbons: Ribbon[] = [];
    let raf = 0;
    let last = 0;
    let visible = !document.hidden;
    let time = 0;

    const seed = () => {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);

      const count = Math.max(5, Math.min(9, Math.round(width / 220)));
      ribbons = Array.from({ length: count }, (_, i) => ({
        base: 0.18 + (i / (count - 1)) * 0.64,
        amp: 0.04 + Math.random() * 0.09,
        freq: 0.9 + Math.random() * 1.6,
        phase: Math.random() * Math.PI * 2,
        speed: 0.18 + Math.random() * 0.22,
        thickness: 1.6 + Math.random() * 2.6,
        hue: i / (count - 1),
      }));
    };

    const yAt = (ribbon: Ribbon, x: number, t: number) => {
      const k = (x / width) * Math.PI * 2 * ribbon.freq;
      return (
        ribbon.base * height +
        Math.sin(k + t * ribbon.speed + ribbon.phase) * ribbon.amp * height +
        Math.sin(k * 0.47 + t * ribbon.speed * 0.6 + ribbon.phase * 1.3) * ribbon.amp * 0.35 * height
      );
    };

    const draw = (dt: number, animate: boolean) => {
      if (animate) time += dt;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      // Soft vertical parallax from the pointer.
      const shiftY = pointer.active ? ((pointer.y / Math.max(height, 1)) - 0.5) * 18 : 0;
      ctx.translate(0, shiftY);

      // Draw each ribbon as a filled band with a vertical gradient.
      for (const ribbon of ribbons) {
        const steps = Math.max(40, Math.round(width / 6));
        const top: { x: number; y: number }[] = [];
        const bot: { x: number; y: number }[] = [];
        for (let i = 0; i <= steps; i++) {
          const x = (i / steps) * width;
          const y = yAt(ribbon, x, time);
          top.push({ x, y });
          bot.push({ x, y: y + ribbon.thickness * 6 });
        }

        // Build path: top left-to-right, then bottom right-to-left.
        ctx.beginPath();
        ctx.moveTo(top[0].x, top[0].y);
        for (let i = 1; i < top.length; i++) ctx.lineTo(top[i].x, top[i].y);
        for (let i = bot.length - 1; i >= 0; i--) ctx.lineTo(bot[i].x, bot[i].y);
        ctx.closePath();

        // Color: interpolate coral -> amber by hue.
        const r = Math.round(217 - ribbon.hue * 40);
        const g = Math.round(78 + ribbon.hue * 90);
        const b = Math.round(42 + ribbon.hue * 30);
        const grad = ctx.createLinearGradient(0, 0, width, 0);
        grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0)`);
        grad.addColorStop(0.2, `rgba(${r}, ${g}, ${b}, 0.32)`);
        grad.addColorStop(0.5, `rgba(${r}, ${g}, ${b}, 0.46)`);
        grad.addColorStop(0.8, `rgba(${r}, ${g}, ${b}, 0.32)`);
        grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
        ctx.fillStyle = grad;
        ctx.fill();

        // Hairline core.
        ctx.beginPath();
        ctx.moveTo(top[0].x, top[0].y);
        for (let i = 1; i < top.length; i++) ctx.lineTo(top[i].x, top[i].y);
        ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, 0.75)`;
        ctx.lineWidth = 1.1;
        ctx.stroke();
      }

      // Floating dust particles.
      const particleCount = Math.min(60, Math.round((width * height) / 26000));
      for (let i = 0; i < particleCount; i++) {
        const seed = i * 9301 + 49297;
        const px = ((seed * 233) % 1000) / 1000 * width;
        const py = ((seed * 7919) % 1000) / 1000 * height;
        const drift = Math.sin(time * 0.4 + i) * 6;
        const size = 0.6 + (i % 4) * 0.4;
        const alpha = 0.18 + ((i * 37) % 100) / 100 * 0.22;
        ctx.beginPath();
        ctx.arc(px + drift, py + Math.cos(time * 0.3 + i) * 4, size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(217, 78, 42, ${alpha})`;
        ctx.fill();
      }

      ctx.setTransform(1, 0, 0, 1, 0, 0);
    };

    const loop = (now: number) => {
      if (!visible) return;
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016;
      last = now;
      draw(dt, true);
      raf = requestAnimationFrame(loop);
    };

    const restart = () => {
      cancelAnimationFrame(raf);
      if (reduced.matches) {
        draw(0, false);
        return;
      }
      if (visible) raf = requestAnimationFrame(loop);
    };

    const onResize = () => {
      seed();
      if (reduced.matches) draw(0, false);
    };

    const onPointer = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointer.x = event.clientX - rect.left;
      pointer.y = event.clientY - rect.top;
      pointer.active =
        pointer.x > -40 && pointer.x < rect.width + 40 && pointer.y > -40 && pointer.y < rect.height + 40;
    };

    const onLeave = () => {
      pointer.active = false;
    };

    const onVisibility = () => {
      visible = !document.hidden;
      restart();
    };

    const onPreference = () => restart();

    seed();
    draw(0, false);
    restart();

    const observer = new ResizeObserver(onResize);
    observer.observe(canvas);
    if (finePointer.matches) window.addEventListener('pointermove', onPointer, { passive: true });
    window.addEventListener('pointerleave', onLeave);
    document.addEventListener('visibilitychange', onVisibility);
    reduced.addEventListener('change', onPreference);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener('pointermove', onPointer);
      window.removeEventListener('pointerleave', onLeave);
      document.removeEventListener('visibilitychange', onVisibility);
      reduced.removeEventListener('change', onPreference);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={className ? `ribbonfield ${className}` : 'ribbonfield'}
      aria-hidden="true"
    />
  );
}
