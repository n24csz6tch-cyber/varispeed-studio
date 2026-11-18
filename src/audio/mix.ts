/**
 * Two-track blend: the end of A fades out while the start of B fades in, with an
 * equal-power curve so the join does not dip in loudness. Everything stays in the
 * decoded audio domain, so the result can go straight into the editor.
 */
export function crossfadeBuffers(
  ctx: BaseAudioContext,
  a: AudioBuffer,
  b: AudioBuffer,
  fadeSeconds: number,
): AudioBuffer {
  const sampleRate = a.sampleRate;
  const fade = Math.max(0, Math.min(Math.round(fadeSeconds * sampleRate), a.length, b.length));
  const length = Math.max(1, a.length + b.length - fade);
  const channelCount = Math.max(1, a.numberOfChannels, b.numberOfChannels);
  const out = ctx.createBuffer(channelCount, length, sampleRate);
  const bStart = a.length - fade;

  for (let c = 0; c < channelCount; c++) {
    const dest = out.getChannelData(c);
    // Mono sources feed both channels instead of leaving one silent.
    const ac = a.getChannelData(Math.min(c, a.numberOfChannels - 1));
    const bc = b.getChannelData(Math.min(c, b.numberOfChannels - 1));

    dest.set(ac.subarray(0, a.length), 0);

    for (let i = 0; i < fade; i++) {
      const t = (i + 1) / fade;
      const gA = Math.cos((t * Math.PI) / 2);
      const gB = Math.sin((t * Math.PI) / 2);
      dest[bStart + i] = ac[bStart + i] * gA + bc[i] * gB;
    }

    dest.set(bc.subarray(fade), bStart + fade);
  }

  return out;
}
