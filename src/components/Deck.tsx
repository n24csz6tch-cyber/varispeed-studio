import type { CSSProperties } from 'react';
import type { Player, PlayerSnapshot } from '../audio/player';
import type { RenderProgress } from '../audio/protocol';
import type { Peaks } from '../audio/types';
import { formatTime } from '../audio/params';
import { usePlayhead } from '../hooks/usePlayhead';
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
  peaks: Peaks;
  processedPeaks: Peaks | null;
  processedDuration: number;
  snapshot: PlayerSnapshot;
  renderProgress: RenderProgress | null;
  player: Player;
  onReplace: () => void;
}

const PHASE_LABEL: Record<RenderProgress['phase'], string> = {
  stretch: 'Estirando',
  master: 'Masterizando',
  encode: 'Codificando',
};

export function Deck({
  name,
  sampleRate,
  channels,
  duration,
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
          <span className="micro">AHORA EDITANDO</span>
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
              Listo
            </span>
          ) : (
            <span className="status">
              <span className="pulse" />
              Preparando
            </span>
          )}
          <button type="button" className="btn btn--ghost btn--sm" onClick={onReplace}>
            Cambiar
          </button>
        </div>
      </div>

      {renderProgress ? <ProgressBar value={renderProgress.value} /> : null}

      <Waveform originalPeaks={peaks} processedPeaks={processedPeaks} player={player} view={snapshot.view} />

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
          El navegador bloqueó el sonido — <b>toca aquí para activarlo</b>
        </button>
      ) : null}

      <div className="transport">
        <button
          type="button"
          className={cx('playbtn', snapshot.playing && 'is-playing')}
          onClick={() => void player.toggle()}
          aria-label={snapshot.playing ? 'Pausar' : 'Reproducir'}
        >
          {snapshot.playing ? <PauseIcon /> : <PlayIcon />}
        </button>

        <TimeReadout player={player} />

        <div className="ab" role="group" aria-label="Comparar original y procesado">
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
            <span>PROCESADO</span>
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
            aria-label="Volumen"
            style={{ '--p': `${snapshot.volume * 100}%` } as CSSProperties}
            onChange={(event) => player.setVolume(Number(event.target.value))}
          />
        </div>
      </div>

      <Spectrum player={player} />
    </section>
  );
}
