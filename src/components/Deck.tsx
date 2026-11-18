import type { CSSProperties } from 'react';
import type { Player, PlayerSnapshot } from '../audio/player';
import type { RenderProgress } from '../audio/protocol';
import type { BendMap, Peaks } from '../audio/types';
import { formatTime } from '../audio/params';
import { usePlayhead } from '../hooks/usePlayhead';
import { BendLane } from './BendLane';
import { Spectrum } from './Spectrum';
import { Waveform } from './Waveform';
import { PauseIcon, PlayIcon, ProgressBar, VolumeIcon, cx } from './ui';

function TimeReadout({ player }: { player: Player }) {
  const position = usePlayhead(player);
  return (
    <div className="time">
      <span className="time__now">{formatTime(position)}</span>
      <span className="time__sep">/</span>
      <span className="time__total">{formatTime(player.bufferDuration())}</span>
    </div>
  );
}

interface DeckProps {
  name: string;
  sampleRate: number;
  channels: number;
  duration: number;
  tempo: number;
  bend: BendMap | null;
  onBendChange: (bend: BendMap | null) => void;
  peaks: Peaks;
  processedPeaks: Peaks | null;
  processedDuration: number;
  snapshot: PlayerSnapshot;
  renderProgress: RenderProgress | null;
  player: Player;
  onReplace: () => void;
}

const PHASE_LABEL: Record<RenderProgress['phase'], string> = {
  stretch: 'Stretching',
  master: 'Mastering',
  encode: 'Encoding',
};

export function Deck({
  name,
  sampleRate,
  channels,
  duration,
  tempo,
  bend,
  onBendChange,
  peaks,
  processedPeaks,
  processedDuration,
  snapshot,
  renderProgress,
  player,
  onReplace,
}: DeckProps) {
  const rate = `${(sampleRate / 1000).toFixed(sampleRate % 1000 === 0 ? 0 : 1)} kHz`;
  return (
    <section className="deck">
      <div className="deck__top">
        <div className="deck__info">
          <span className="micro">NOW EDITING</span>
          <h2 title={name}>{name}</h2>
          <div className="deck__sub">
            <span>{rate}</span>
            <i />
            <span>{channels > 1 ? 'STEREO' : 'MONO'}</span>
            <i />
            <span className="deck__dur">
              <b>{formatTime(duration)}</b>
              <span className="arrow">→</span>
              <b>{formatTime(processedDuration)}</b>
            </span>
          </div>
        </div>
        <div className="deck__actions">
          {renderProgress ? (
            <span className="status">
              <span className="pulse" />
              {PHASE_LABEL[renderProgress.phase]} {Math.round(renderProgress.value * 100)}%
            </span>
          ) : snapshot.hasProcessed ? (
            <span className="status status--ok">
              <span className="dot" />
              Ready
            </span>
          ) : (
            <span className="status">
              <span className="pulse" />
              Preparing
            </span>
          )}
          <button type="button" className="btn btn--ghost btn--sm" onClick={onReplace}>
            Replace
          </button>
        </div>
      </div>

      {renderProgress ? <ProgressBar value={renderProgress.value} /> : null}

      <Waveform originalPeaks={peaks} processedPeaks={processedPeaks} player={player} view={snapshot.view} />

      <BendLane bend={bend} duration={duration} tempo={tempo} onChange={onBendChange} />

      {!snapshot.audioRunning ? (
        <button
          type="button"
          className="unlock"
          onClick={() => {
            void player.unlock().then((ok) => {
              if (ok) void player.play();
            });
          }}
        >
          <span className="pulse" />
          The browser muted playback — <b>tap to enable sound</b>
        </button>
      ) : null}

      <div className="transport">
        <button
          type="button"
          className={cx('playbtn', snapshot.playing && 'is-playing')}
          onClick={() => void player.toggle()}
          aria-label={snapshot.playing ? 'Pause' : 'Play'}
        >
          {snapshot.playing ? <PauseIcon /> : <PlayIcon />}
        </button>

        <TimeReadout player={player} />

        <div className="ab" role="group" aria-label="Compare original and processed">
          <button
            type="button"
            className={cx('ab__opt', snapshot.view === 'original' && 'is-active')}
            onClick={() => player.setView('original')}
          >
            <span>ORIGINAL</span>
            <b>{formatTime(duration)}</b>
          </button>
          <button
            type="button"
            className={cx('ab__opt', snapshot.view === 'processed' && 'is-active')}
            onClick={() => player.setView('processed')}
            disabled={!snapshot.hasProcessed}
          >
            <span>PROCESSED</span>
            <b>{snapshot.hasProcessed ? formatTime(processedDuration) : '—'}</b>
          </button>
        </div>

        <div className="volume">
          <VolumeIcon />
          <input
            className="range range--vol"
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={snapshot.volume}
            aria-label="Volume"
            style={{ '--p': `${snapshot.volume * 100}%` } as CSSProperties}
            onChange={(event) => player.setVolume(Number(event.target.value))}
          />
        </div>
      </div>

      <Spectrum player={player} />
    </section>
  );
}
