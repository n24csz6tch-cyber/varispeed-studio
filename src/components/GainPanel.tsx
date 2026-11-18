import { AIR_MAX, BASS_MAX, BASS_MIN, CLARITY_MAX, GAIN_MAX, GAIN_MIN } from '../audio/params';
import type { Settings } from '../audio/types';
import { Panel, Slider } from './ui';

function signed(value: number, unit: string, digits = 1): string {
  if (Math.abs(value) < 0.05) return `0 ${unit}`;
  return `${value > 0 ? '+' : '−'}${Math.abs(value).toFixed(digits)} ${unit}`;
}

export function GainPanel({
  settings,
  onChange,
}: {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
}) {
  const gainLabel = signed(settings.gain, 'dB');
  const bassLabel = signed(settings.bass, 'dB');

  return (
    <Panel
      title="Gain & tone"
      meta={
        <>
          GAIN <span className="meta-sep">·</span> {gainLabel}
          <span className="meta-sep">·</span> BASS {bassLabel}
        </>
      }
    >
      <Slider
        label="GAIN"
        hint="Level into the limiter — push it and it saturates"
        min={GAIN_MIN}
        max={GAIN_MAX}
        step={0.5}
        value={settings.gain}
        format={() => gainLabel}
        onChange={(gain) => onChange({ gain })}
        marks={[
          { value: GAIN_MIN, label: '−12' },
          { value: 0, label: '0' },
          { value: 12, label: '+12' },
          { value: 24, label: '+24' },
        ]}
      />

      <Slider
        label="BASS"
        hint="Low shelf at 110 Hz — weight, not mud"
        min={BASS_MIN}
        max={BASS_MAX}
        step={0.5}
        value={settings.bass}
        format={() => bassLabel}
        onChange={(bass) => onChange({ bass })}
        marks={[
          { value: BASS_MIN, label: '−12' },
          { value: 0, label: '0' },
          { value: 6, label: '+6' },
          { value: BASS_MAX, label: '+12' },
        ]}
      />

      <Slider
        label="VOICE CLARITY"
        hint="Presence at 3.2 kHz"
        min={0}
        max={CLARITY_MAX}
        step={0.5}
        value={settings.clarity}
        format={(v) => (v > 0 ? `+${v.toFixed(1)} dB` : 'OFF')}
        onChange={(clarity) => onChange({ clarity })}
        tone="mint"
        marks={[
          { value: 0, label: '0' },
          { value: 4, label: '+4' },
          { value: 8, label: '+8' },
        ]}
      />

      <Slider
        label="AIR"
        hint="Shine at 10 kHz"
        min={0}
        max={AIR_MAX}
        step={0.5}
        value={settings.air}
        format={(v) => (v > 0 ? `+${v.toFixed(1)} dB` : 'OFF')}
        onChange={(air) => onChange({ air })}
        tone="mint"
        marks={[
          { value: 0, label: '0' },
          { value: 4, label: '+4' },
          { value: 8, label: '+8' },
        ]}
      />
    </Panel>
  );
}
