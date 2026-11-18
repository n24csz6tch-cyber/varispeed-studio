/** 24-bit PCM WAV encoder (stereo/mono preserved, source sample rate preserved). */
export function encodeWav(channels: Float32Array[], sampleRate: number, bitDepth: 24 | 16 = 24): Blob {
  const numChannels = channels.length;
  const length = channels[0]?.length ?? 0;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = length * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  if (bitDepth === 24) {
    for (let i = 0; i < length; i++) {
      for (let c = 0; c < numChannels; c++) {
        let s = channels[c][i];
        if (s > 1) s = 1;
        else if (s < -1) s = -1;
        const v = Math.round(s * 8388607) & 0xffffff;
        view.setUint8(offset, v & 0xff);
        view.setUint8(offset + 1, (v >> 8) & 0xff);
        view.setUint8(offset + 2, (v >> 16) & 0xff);
        offset += 3;
      }
    }
  } else {
    for (let i = 0; i < length; i++) {
      for (let c = 0; c < numChannels; c++) {
        let s = channels[c][i];
        if (s > 1) s = 1;
        else if (s < -1) s = -1;
        view.setInt16(offset, Math.round(s * 32767), true);
        offset += 2;
      }
    }
  }

  return new Blob([buffer], { type: 'audio/wav' });
}
