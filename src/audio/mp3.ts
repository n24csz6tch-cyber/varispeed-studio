import { Mp3Encoder } from '@breezystack/lamejs';

/** Sample rates the bundled LAME encoder accepts. */
export const MP3_RATES = new Set([8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000]);

/** MP3 export with the LAME encoder at 320 kbps (192 kbps for low-rate sources). */
export function encodeMp3(
  channels: Float32Array[],
  sampleRate: number,
  onProgress?: (value: number) => void,
): Blob {
  const numChannels = Math.min(2, channels.length);
  const length = channels[0]?.length ?? 0;
  const bitrate = sampleRate >= 32000 ? 320 : 192;
  const encoder = new Mp3Encoder(numChannels, Math.round(sampleRate), bitrate);

  const blockSize = 1152;
  const left = new Int16Array(blockSize);
  const right = numChannels > 1 ? new Int16Array(blockSize) : null;
  const parts: Uint8Array[] = [];
  let total = 0;

  const toInt16 = (src: Float32Array, start: number, count: number, dst: Int16Array) => {
    for (let i = 0; i < count; i++) {
      let s = src[start + i];
      if (s > 1) s = 1;
      else if (s < -1) s = -1;
      dst[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
  };

  for (let offset = 0; offset < length; offset += blockSize) {
    const count = Math.min(blockSize, length - offset);
    toInt16(channels[0], offset, count, left);
    if (right && channels[1]) toInt16(channels[1], offset, count, right);
    const chunk = right ? encoder.encodeBuffer(left, right) : encoder.encodeBuffer(left);
    if (chunk.length > 0) {
      parts.push(new Uint8Array(chunk));
      total += chunk.length;
    }
    if (onProgress && offset % (blockSize * 200) === 0) onProgress(offset / length);
  }

  const tail = encoder.flush();
  if (tail.length > 0) {
    parts.push(new Uint8Array(tail));
    total += tail.length;
  }

  const merged = new Uint8Array(total);
  let pos = 0;
  for (const part of parts) {
    merged.set(part, pos);
    pos += part.length;
  }
  return new Blob([merged], { type: 'audio/mpeg' });
}
