import { AIR_MAX, CLARITY_MAX, GAIN_MAX } from '../audio/params';
import type { Settings } from '../audio/types';
import { Panel, Slider } from './ui';

export function GainPanel({
  settings,
  onChange,
}: {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
}) {
  const gainLabel = settings.gain > 0.05 ? `+${settings.gain.toFixed(1)} dB` : '0 dB';

  return (
    <Panel
      title="Ganancia y voz"
      meta={
        <>
          GANANCIA <span className="meta-sep">·</span> {gainLabel}
        </>
      }
    >
      <Slider
        label="GAIN"
        hint="Como el gain de BandLab: empuja y el bajo satura"
        min={0}
        max={GAIN_MAX}
        step={0.5}
        value={settings.gain}
        format={() => gainLabel}
        onChange={(gain) => onChange({ gain })}
        marks={[
          { value: 0, label: '0' },
          { value: 6, label: '+6' },
          { value: 12, label: '+12' },
          { value: 18, label: '+18' },
          { value: 24, label: '+24' },
        ]}
      />

      <Slider
        label="CLARIDAD DE VOZ"
        hint="Presencia a 3.2 kHz"
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
        label="AIRE"
        hint="Brillo a 10 kHz"
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
