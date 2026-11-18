import type { Player, PlayerSnapshot } from '../audio/player';
import { formatTime } from '../audio/params';
import { usePlayhead } from '../hooks/usePlayhead';
import { PauseIcon, PlayIcon, cx } from './ui';

export function MiniBar({ player, snapshot }: { player: Player; snapshot: PlayerSnapshot }) {
  const position = usePlayhead(player);
  return (
    <div className="mini">
      <button
        type="button"
        className={cx('playbtn', 'playbtn--sm', snapshot.playing && 'is-playing')}
        onClick={() => void player.toggle()}
        aria-label={snapshot.playing ? 'Pausar' : 'Reproducir'}
      >
        {snapshot.playing ? <PauseIcon /> : <PlayIcon />}
      </button>
      <div className="mini__time">
        <b>{formatTime(position)}</b>
        <span>{formatTime(player.bufferDuration())}</span>
      </div>
      <div className="mini__ab">
        <button
          type="button"
          className={cx('mini__opt', snapshot.view === 'original' && 'is-active')}
          onClick={() => player.setView('original')}
        >
          ORIG
        </button>
        <button
          type="button"
          className={cx('mini__opt', snapshot.view === 'processed' && 'is-active')}
          onClick={() => player.setView('processed')}
          disabled={!snapshot.hasProcessed}
        >
          PROC
        </button>
      </div>
    </div>
  );
}
