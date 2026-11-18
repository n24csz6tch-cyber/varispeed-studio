/**
 * Same encoding, filled in slices with a yield between them. A three-minute track is
 * tens of millions of samples; doing it in one loop freezes the interface for a second
 * right after every render, which is felt as lag when changing a setting.
 */
export async function encodeWav16Async(channels: Float32Array[], sampleRate: number): Promise<Blob> {
  const frameCount = channels[0]?.length ?? 0;
  const channelCount = Math.max(1, channels.length);
  const dataBytes = frameCount * channelCount * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);

  const writeText = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  writeText(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeText(8, 'WAVE');
  writeText(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channelCount * 2, true);
  view.setUint16(32, channelCount * 2, true);
  view.setUint16(34, 16, true);
  writeText(36, 'data');
  view.setUint32(40, dataBytes, true);

  const BLOCK = 32768;
  let offset = 44;
  for (let start = 0; start < frameCount; start += BLOCK) {
    const end = Math.min(frameCount, start + BLOCK);
    for (let i = start; i < end; i++) {
      for (let c = 0; c < channelCount; c++) {
        const sample = Math.max(-1, Math.min(1, channels[c][i]));
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
        offset += 2;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

/** Minimal 16-bit PCM WAV encoder for the fallback (native player) output path. */
export function encodeWav16(channels: Float32Array[], sampleRate: number): Blob {
  const frameCount = channels[0]?.length ?? 0;
  const channelCount = Math.max(1, channels.length);
  const bytesPerSample = 2;
  const dataBytes = frameCount * channelCount * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);

  const writeText = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  writeText(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeText(8, 'WAVE');
  writeText(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channelCount * bytesPerSample, true);
  view.setUint16(32, channelCount * bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeText(36, 'data');
  view.setUint32(40, dataBytes, true);

  let offset = 44;
  for (let i = 0; i < frameCount; i++) {
    for (let c = 0; c < channelCount; c++) {
      const sample = Math.max(-1, Math.min(1, channels[c][i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([buffer], { type: 'audio/wav' });
}
