import { useEffect, useState } from 'react';
import type { Player } from '../audio/player';

/** Polls the transport ~11x/second so the time readout stays smooth without re-rendering the studio. */
export function usePlayhead(player: Player): number {
  const [position, setPosition] = useState(0);

  useEffect(() => {
    let raf = 0;
    let last = 0;
    const loop = (time: number) => {
      if (time - last > 90) {
        last = time;
        setPosition(player.bufferPosition());
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [player]);

  return position;
}
