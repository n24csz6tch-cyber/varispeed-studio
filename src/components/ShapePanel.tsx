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
}: {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
}) {
  const isTape = settings.mode === 'tape';
  const pitchLocked = settings.mode !== 'hybrid';
  const pitchValue = isTape ? tapeSemitones(settings.tempo) : settings.mode === 'natural' ? 0 : settings.pitch;

  return (
    <Panel
      title="Velocidad y tono"
      meta={
        <>
          RUBBER BAND R3 <span className="meta-sep">·</span> WASM
        </>
      }
    >
      <div className="modes" role="radiogroup" aria-label="Modo de procesado">
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
        hint={settings.tempo > 1.001 ? 'SPED UP' : settings.tempo < 0.999 ? 'SLOWED' : 'ORIGINAL'}
        min={TEMPO_MIN}
        max={TEMPO_MAX}
        step={0.005}
        value={settings.tempo}
        format={(v) => `${v.toFixed(2)}×`}
        onChange={(tempo) => onChange({ tempo })}
        marks={TEMPO_MARKS}
      />

      <Slider
        label="TONO"
        hint={isTape ? 'SIGUE AL TEMPO' : settings.mode === 'natural' ? 'FIJADO AL ORIGINAL' : 'INDEPENDIENTE'}
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
        label="FORMANTES"
        hint={
          settings.mode === 'hybrid'
            ? 'Mantiene el timbre de la voz al cambiar el tono'
            : settings.mode === 'tape'
              ? 'Desactivado a propósito: la cinta mueve los formantes con el tono'
              : 'Sin cambio de tono, los formantes no se mueven'
        }
        checked={usesFormant(settings)}
        disabled={settings.mode !== 'hybrid'}
        onChange={(formant) => onChange({ formant })}
      />

    </Panel>
  );
}
