import { useEffect, useState } from 'react';
import type { Player } from '../audio/player';

/**
 * Polls the transport ~11x/second so the time readout stays smooth without
 * re-rendering the studio. The loop only runs while audio is playing; a paused
 * transport repaints once on the next state change instead of burning frames.
 */
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

    const sync = () => {
      setPosition(player.bufferPosition());
      if (player.isPlaying()) {
        if (!raf) raf = requestAnimationFrame(loop);
      } else if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    };

    sync();
    const unsubscribe = player.subscribe(sync);
    return () => {
      unsubscribe();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [player]);

  return position;
}
