/**
 * Container sniffing so decoding can happen at the file's own sample rate.
 *
 * `decodeAudioData` on a live AudioContext resamples to the device rate (often
 * 48 kHz), which would silently change a 44.1 kHz master. These parsers read the
 * declared rate for the common upload formats; when the format is not recognised
 * we fall back to the context's own decoder.
 */
export function detectSampleRate(bytes: ArrayBuffer): number | null {
  const len = bytes.byteLength;
  if (len < 12) return null;
  const view = new DataView(bytes);
  const tag = (offset: number) =>
    String.fromCharCode(
      view.getUint8(offset),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2),
      view.getUint8(offset + 3),
    );

  try {
    if (tag(0) === 'RIFF' && tag(8) === 'WAVE') return readWav(view, len);
    if (tag(0) === 'fLaC') return readFlac(view, len);
    if (tag(4) === 'ftyp') return readMp4(view, len);
    if (tag(0) === 'OggS') return readOgg(view, len);
    const mp3 = readMp3(view, len);
    if (mp3) return mp3;
  } catch {
    return null;
  }
  return null;
}

function readWav(view: DataView, len: number): number | null {
  let p = 12;
  while (p + 8 <= len) {
    const id = String.fromCharCode(view.getUint8(p), view.getUint8(p + 1), view.getUint8(p + 2), view.getUint8(p + 3));
    const size = view.getUint32(p + 4, true);
    if (id === 'fmt ' && p + 16 <= len) {
      const rate = view.getUint32(p + 12, true);
      return rate > 0 ? rate : null;
    }
    p += 8 + size + (size % 2);
  }
  return null;
}

function readFlac(view: DataView, len: number): number | null {
  if (len < 22) return null;
  // "fLaC" + STREAMINFO block header (4 bytes), then 10 bytes of block sizes,
  // then 20 bits of sample rate.
  const rate = (view.getUint8(18) << 12) | (view.getUint8(19) << 4) | (view.getUint8(20) >> 4);
  return rate > 0 ? rate : null;
}

function readMp3(view: DataView, len: number): number | null {
  let start = 0;
  if (len > 10 && String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2)) === 'ID3') {
    const size =
      ((view.getUint8(6) & 0x7f) << 21) |
      ((view.getUint8(7) & 0x7f) << 14) |
      ((view.getUint8(8) & 0x7f) << 7) |
      (view.getUint8(9) & 0x7f);
    start = 10 + size;
  }
  const limit = Math.min(len - 4, start + 250000);
  for (let i = start; i < limit; i++) {
    if (view.getUint8(i) !== 0xff) continue;
    const b1 = view.getUint8(i + 1);
    if ((b1 & 0xe0) !== 0xe0) continue;
    const version = (b1 >> 3) & 3;
    const layer = (b1 >> 1) & 3;
    if (layer !== 1 || version === 1) continue;
    const b2 = view.getUint8(i + 2);
    const rateIndex = (b2 >> 2) & 3;
    const bitrateIndex = b2 >> 4;
    if (rateIndex === 3 || bitrateIndex === 0 || bitrateIndex === 15) continue;
    const table =
      version === 3 ? [44100, 48000, 32000] : version === 2 ? [22050, 24000, 16000] : [11025, 12000, 8000];
    return table[rateIndex] ?? null;
  }
  return null;
}

function readMp4(view: DataView, len: number): number | null {
  const tag = (offset: number) =>
    String.fromCharCode(
      view.getUint8(offset),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2),
      view.getUint8(offset + 3),
    );

  const walk = (start: number, end: number, depth: number): number | null => {
    if (depth > 6) return null;
    let p = start;
    while (p + 8 <= end) {
      let size = view.getUint32(p);
      const type = tag(p + 4);
      let header = 8;
      if (size === 1) {
        if (p + 16 > end) return null;
        size = Number(view.getBigUint64(p + 8));
        header = 16;
      } else if (size === 0) {
        size = end - p;
      }
      if (size < header || p + size > end) return null;
      if (type === 'moov' || type === 'trak' || type === 'mdia') {
        const found = walk(p + header, p + size, depth + 1);
        if (found) return found;
      } else if (type === 'mdhd' && p + header + 24 <= end) {
        const version = view.getUint8(p + header);
        const offset = version === 1 ? p + header + 4 + 16 : p + header + 4 + 8;
        const rate = view.getUint32(offset);
        if (rate > 0) return rate;
      }
      p += size;
    }
    return null;
  };

  return walk(0, len, 0);
}

function readOgg(view: DataView, len: number): number | null {
  const limit = Math.min(len - 16, 65536);
  for (let i = 0; i < limit; i++) {
    if (
      view.getUint8(i) === 0x76 && // v
      view.getUint8(i + 1) === 0x6f && // o
      view.getUint8(i + 2) === 0x72 &&
      view.getUint8(i + 3) === 0x62 &&
      view.getUint8(i + 4) === 0x69 &&
      view.getUint8(i + 5) === 0x73
    ) {
      // "vorbis" — version(4), channels(1), rate(4 LE)
      if (i + 13 > len) return null;
      const rate = view.getUint32(i + 11, true);
      return rate > 0 ? rate : null;
    }
    if (
      view.getUint8(i) === 0x4f && // O
      view.getUint8(i + 1) === 0x70 &&
      view.getUint8(i + 2) === 0x75 &&
      view.getUint8(i + 3) === 0x73
    ) {
      return 48000; // Opus always decodes at 48 kHz
    }
  }
  return null;
}

/**
 * Decode at the file's own sample rate where the container declares it, so
 * exports keep the original rate instead of the device's output rate.
 */
export async function decodeAudioFile(bytes: ArrayBuffer, fallback: BaseAudioContext): Promise<AudioBuffer> {
  const native = detectSampleRate(bytes);
  if (
    native &&
    native !== fallback.sampleRate &&
    native >= 8000 &&
    native <= 96000 &&
    typeof OfflineAudioContext !== 'undefined'
  ) {
    try {
      const offline = new OfflineAudioContext(1, 1, native);
      return await offline.decodeAudioData(bytes.slice(0));
    } catch {
      // fall through to the device-rate decoder
    }
  }
  return fallback.decodeAudioData(bytes.slice(0));
}
