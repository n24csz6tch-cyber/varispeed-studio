/**
 * Rubber Band Library R3 option flags (mirrors RubberBandStretcher::Option).
 *
 * Licensing note: rubberband-wasm bundles Rubber Band Library (GPLv2). This app loads it
 * locally in the browser; distributing a proprietary build would require a commercial
 * Rubber Band licence from Breakfast Quay.
 */
export const RB = {
  ProcessOffline: 0x00000000,
  ProcessRealTime: 0x00000001,
  EngineFaster: 0x00000000,
  EngineFiner: 0x20000000,
  ChannelsTogether: 0x10000000,
  ChannelsApart: 0x00000000,
  PitchHighSpeed: 0x00000000,
  PitchHighQuality: 0x02000000,
  PitchHighConsistency: 0x04000000,
  FormantShifted: 0x00000000,
  FormantPreserved: 0x01000000,
  WindowStandard: 0x00000000,
  WindowShort: 0x00100000,
  WindowLong: 0x00200000,
} as const;

/**
 * Final export: documented "maximum quality" offline configuration.
 * Preview: shorter analysis window + high-consistency pitch, which is measurably
 * faster while keeping formant preservation and stereo phase coherence.
 */
export function stretchFlags(quality: 'preview' | 'final', formant: boolean): number {
  if (quality === 'final') {
    return RB.EngineFiner | RB.ChannelsTogether | RB.PitchHighQuality | (formant ? RB.FormantPreserved : 0);
  }
  return RB.EngineFiner | RB.WindowShort | RB.ChannelsTogether | RB.PitchHighConsistency | (formant ? RB.FormantPreserved : 0);
}
