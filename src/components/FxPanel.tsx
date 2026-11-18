import { REVERB_DECAY_MAX, REVERB_DECAY_MIN, REVERB_MAX } from '../audio/params';
import type { Settings } from '../audio/types';
import { Panel, Slider } from './ui';

export function FxPanel({
  settings,
  onChange,
}: {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
}) {
  return (
    <Panel
      title="Space"
      meta={
        <>
          REVERB <span className="meta-sep">·</span> STEREO
        </>
      }
    >
      <Slider
        label="ECHO / REVERB"
        hint="The classic slowed + reverb tail"
        min={0}
        max={REVERB_MAX}
        step={1}
        value={settings.reverb}
        format={(v) => (v > 0.5 ? `${Math.round(v)}%` : 'OFF')}
        onChange={(reverb) => onChange({ reverb })}
        tone="mint"
        marks={[
          { value: 0, label: '0' },
          { value: 20, label: '20' },
          { value: 40, label: '40' },
          { value: 60, label: '60' },
        ]}
      />

      <Slider
        label="REVERB TAIL"
        hint="How long the room keeps ringing"
        min={REVERB_DECAY_MIN}
        max={REVERB_DECAY_MAX}
        step={0.1}
        value={settings.reverbDecay}
        format={(v) => `${v.toFixed(1)} s`}
        onChange={(reverbDecay) => onChange({ reverbDecay })}
        tone="mint"
        disabled={settings.reverb <= 0.5}
        marks={[
          { value: 1.5, label: '1.5' },
          { value: 2.5, label: '2.5' },
          { value: 3.5, label: '3.5' },
        ]}
      />
    </Panel>
  );
}
