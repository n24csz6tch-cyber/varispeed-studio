import {
  MODE_INFO,
  PITCH_MAX,
  PITCH_MIN,
  TEMPO_MAX,
  TEMPO_MIN,
  semitoneLabel,
  tapeSemitones,
  usesFormant,
} from '../audio/params';
import type { ProcessingMode, Settings } from '../audio/types';
import { Panel, Slider, Toggle, cx } from './ui';

const MODES: ProcessingMode[] = ['hybrid', 'natural', 'tape'];

const TEMPO_MARKS = [
  { value: 0.78, label: '0.78' },
  { value: 1, label: '1.00' },
  { value: 1.2, label: '1.20' },
  { value: 1.4, label: '1.40' },
];

export function ShapePanel({
  settings,
  onChange,
  bendActive = false,
}: {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  /** When BEND is on, each segment owns its speed and this control would lie. */
  bendActive?: boolean;
}) {
  const isTape = settings.mode === 'tape';
  const pitchLocked = settings.mode !== 'hybrid';
  const pitchValue = isTape ? tapeSemitones(settings.tempo) : settings.mode === 'natural' ? 0 : settings.pitch;

  return (
    <Panel
      title="Tempo & pitch"
      meta={
        <>
          RUBBER BAND R3 <span className="meta-sep">·</span> WASM
        </>
      }
    >
      <div className="modes" role="radiogroup" aria-label="Processing mode">
        {MODES.map((mode) => (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={settings.mode === mode}
            className={cx('mode', settings.mode === mode && 'is-active')}
            onClick={() => onChange({ mode })}
          >
            <span className="mode__name">{MODE_INFO[mode].name}</span>
            <span className="mode__blurb">{MODE_INFO[mode].blurb}</span>
          </button>
        ))}
      </div>

      <Slider
        label="TEMPO"
        hint={
          bendActive
            ? 'BEND CONTROLS SPEED'
            : settings.tempo > 1.001
              ? 'SPED UP'
              : settings.tempo < 0.999
                ? 'SLOWED'
                : 'ORIGINAL'
        }
        min={TEMPO_MIN}
        max={TEMPO_MAX}
        step={0.005}
        value={settings.tempo}
        format={(v) => `${v.toFixed(2)}×`}
        disabled={bendActive}
        onChange={(tempo) => onChange({ tempo })}
        marks={bendActive ? undefined : TEMPO_MARKS}
      />

      <Slider
        label="PITCH"
        hint={isTape ? 'FOLLOWS TEMPO' : settings.mode === 'natural' ? 'LOCKED TO ORIGINAL' : 'INDEPENDENT'}
        min={PITCH_MIN}
        max={PITCH_MAX}
        step={0.05}
        value={Math.round(pitchValue * 100) / 100}
        format={semitoneLabel}
        disabled={pitchLocked}
        onChange={(pitch) => onChange({ pitch })}
        marks={[
          { value: PITCH_MIN, label: '−5' },
          { value: 0, label: '0' },
          { value: PITCH_MAX, label: '+5' },
        ]}
      />

      <Toggle
        label="FORMANT"
        hint={
          settings.mode === 'hybrid'
            ? 'Keeps the vocal timbre intact while the pitch moves'
            : settings.mode === 'tape'
              ? 'Off on purpose: tape drags the formants along with the pitch'
              : 'No pitch shift, so there are no formants to keep'
        }
        checked={usesFormant(settings)}
        disabled={settings.mode !== 'hybrid'}
        onChange={(formant) => onChange({ formant })}
      />

    </Panel>
  );
}
