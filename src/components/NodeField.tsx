import { useEffect, useRef } from 'react';

interface Node {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  phase: number;
  bright: boolean;
}

const NODE_RGB = '215, 255, 79';
const LINE_RGB = '228, 228, 214';
const LINK = 172;

/**
 * A live signal graph: slow drifting nodes, hairline links and pulses that travel
 * outward. It is drawn on a canvas instead of with hundreds of DOM nodes, so it can
 * sit behind the hero without costing a frame, and it stops itself when the tab is
 * hidden or when the visitor asks for reduced motion.
 */
export function NodeField({ className }: { className?: string }) {
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
    let nodes: Node[] = [];
    let raf = 0;
    let last = 0;
    let visible = !document.hidden;

    const seed = () => {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);

      const count = Math.min(96, Math.max(24, Math.round((width * height) / 14000)));
      nodes = Array.from({ length: count }, (_, i) => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.18,
        vy: (Math.random() - 0.5) * 0.18,
        r: 1.1 + Math.random() * 1.6,
        phase: Math.random(),
        bright: i % 6 === 0,
      }));
    };

    const step = () => {
      for (const node of nodes) {
        node.x += node.vx;
        node.y += node.vy;

        if (pointer.active) {
          const dx = node.x - pointer.x;
          const dy = node.y - pointer.y;
          const dist = Math.hypot(dx, dy);
          if (dist > 0.01 && dist < 170) {
            const force = (1 - dist / 170) * 0.055;
            node.vx += (dx / dist) * force;
            node.vy += (dy / dist) * force;
          }
        }

        node.vx *= 0.994;
        node.vy *= 0.994;
        const speed = Math.hypot(node.vx, node.vy);
        if (speed < 0.035) {
          node.vx += (Math.random() - 0.5) * 0.045;
          node.vy += (Math.random() - 0.5) * 0.045;
        } else if (speed > 0.55) {
          node.vx = (node.vx / speed) * 0.55;
          node.vy = (node.vy / speed) * 0.55;
        }

        if (node.x < -24) node.x = width + 24;
        if (node.x > width + 24) node.x = -24;
        if (node.y < -24) node.y = height + 24;
        if (node.y > height + 24) node.y = -24;
      }
    };

    const draw = (time: number, animate: boolean) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      if (animate) step();

      // A hint of parallax so the field sits behind the copy instead of on top of it.
      const shiftX = pointer.active ? ((pointer.x / Math.max(width, 1)) - 0.5) * 12 : 0;
      const shiftY = pointer.active ? ((pointer.y / Math.max(height, 1)) - 0.5) * 8 : 0;
      ctx.translate(shiftX, shiftY);

      for (let band = 0; band < 3; band++) {
        ctx.beginPath();
        for (let i = 0; i < nodes.length; i++) {
          const a = nodes[i];
          for (let j = i + 1; j < nodes.length; j++) {
            const b = nodes[j];
            const dx = a.x - b.x;
            const dy = a.y - b.y;
            const dist = Math.hypot(dx, dy);
            if (dist > LINK) continue;
            const strength = 1 - dist / LINK;
            if (Math.min(2, Math.floor(strength * 3)) !== band) continue;
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
          }
        }
        ctx.strokeStyle = `rgba(${LINE_RGB}, ${(0.075 + band * 0.065).toFixed(3)})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      for (const node of nodes) {
        if (!node.bright) continue;
        const t = (time * 0.00016 + node.phase) % 1;
        const radius = 4 + t * 52;
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${NODE_RGB}, ${((1 - t) * 0.22).toFixed(3)})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      for (const node of nodes) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.r * 4.2, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${NODE_RGB}, ${node.bright ? 0.11 : 0.055})`;
        ctx.fill();

        ctx.beginPath();
        ctx.arc(node.x, node.y, node.r, 0, Math.PI * 2);
        ctx.fillStyle = node.bright
          ? `rgba(${NODE_RGB}, 0.95)`
          : `rgba(${LINE_RGB}, 0.5)`;
        ctx.fill();
      }

      ctx.setTransform(1, 0, 0, 1, 0, 0);
    };

    const loop = (time: number) => {
      if (!visible) return;
      if (time - last > 30) {
        last = time;
        draw(time, true);
      }
      raf = requestAnimationFrame(loop);
    };

    const restart = () => {
      cancelAnimationFrame(raf);
      if (reduced.matches) {
        draw(performance.now(), false);
        return;
      }
      if (visible) raf = requestAnimationFrame(loop);
    };

    const onResize = () => {
      seed();
      if (reduced.matches) draw(performance.now(), false);
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
    draw(performance.now(), false);
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

  return <canvas ref={canvasRef} className={className ? `nodefield ${className}` : 'nodefield'} aria-hidden="true" />;
}
