import { encodeWav16Async } from './compat';

/**
 * A short loop synthesized in the browser, so a first visit can be heard without
 * hunting for a file. Four bars of dusty hip-hop at 84 BPM: kick, snare, hats,
 * bass, warm pad and a small bell motif, plus a convolution room.
 *
 * Everything is rendered offline at 44.1 kHz and handed back as a WAV, which then
 * travels the exact same decode path as an uploaded file.
 */

const SAMPLE_RATE = 44100;
const BPM = 84;
const BEAT = 60 / BPM;
const BARS = 4;
const TAIL = 2.6;
const LENGTH = BARS * 4 * BEAT + TAIL;

function midiToHz(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12);
}

function makeNoise(ctx: OfflineAudioContext, seconds: number): AudioBuffer {
  const buffer = ctx.createBuffer(1, Math.ceil(seconds * SAMPLE_RATE), SAMPLE_RATE);
  const data = buffer.getChannelData(0);
  let state = 7;
  for (let i = 0; i < data.length; i++) {
    state = (state * 16807) % 2147483647;
    data[i] = (state / 2147483647) * 2 - 1;
  }
  return buffer;
}

function makeImpulse(ctx: OfflineAudioContext, seconds: number): AudioBuffer {
  const length = Math.ceil(seconds * SAMPLE_RATE);
  const buffer = ctx.createBuffer(2, length, SAMPLE_RATE);
  for (let c = 0; c < 2; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2.8);
    }
  }
  return buffer;
}

export async function renderDemoTrack(): Promise<File> {
  if (typeof OfflineAudioContext === 'undefined') {
    throw new Error('This browser cannot build the demo. Load a track instead.');
  }

  const ctx = new OfflineAudioContext(2, Math.ceil(LENGTH * SAMPLE_RATE), SAMPLE_RATE);

  const master = ctx.createGain();
  master.gain.value = 0.72;
  const bus = ctx.createDynamicsCompressor();
  bus.threshold.value = -18;
  bus.knee.value = 14;
  bus.ratio.value = 3.5;
  bus.attack.value = 0.006;
  bus.release.value = 0.2;
  master.connect(bus);
  bus.connect(ctx.destination);

  const reverb = ctx.createConvolver();
  reverb.buffer = makeImpulse(ctx, 2.8);
  const wet = ctx.createGain();
  wet.gain.value = 0.24;
  reverb.connect(wet);
  wet.connect(master);

  const noise = makeNoise(ctx, 1.4);

  const env = (when: number, peak: number, attack: number, decay: number) => {
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), when + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + attack + decay);
    return gain;
  };

  const sendToRoom = (node: AudioNode, amount: number) => {
    const send = ctx.createGain();
    send.gain.value = amount;
    node.connect(send);
    send.connect(reverb);
  };

  const kick = (when: number, level = 0.82) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(132, when);
    osc.frequency.exponentialRampToValueAtTime(46, when + 0.11);
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(level, when + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.36);
    osc.connect(gain);
    gain.connect(master);
    osc.start(when);
    osc.stop(when + 0.4);
  };

  const snare = (when: number, level = 0.42) => {
    const source = ctx.createBufferSource();
    source.buffer = noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1900;
    filter.Q.value = 0.7;
    const gain = env(when, level, 0.002, 0.16);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    sendToRoom(gain, 0.22);
    source.start(when);
    source.stop(when + 0.22);

    const body = ctx.createOscillator();
    const bodyGain = env(when, level * 0.32, 0.002, 0.09);
    body.type = 'triangle';
    body.frequency.setValueAtTime(185, when);
    body.frequency.exponentialRampToValueAtTime(140, when + 0.08);
    body.connect(bodyGain);
    bodyGain.connect(master);
    body.start(when);
    body.stop(when + 0.15);
  };

  const hat = (when: number, level = 0.08) => {
    const source = ctx.createBufferSource();
    source.buffer = noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 7800;
    const gain = env(when, level, 0.001, 0.035);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    source.start(when);
    source.stop(when + 0.08);
  };

  const bass = (when: number, note: number, length: number) => {
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = midiToHz(note);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    filter.Q.value = 0.6;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(0.34, when + 0.012);
    gain.gain.setValueAtTime(0.3, when + Math.max(0.02, length - 0.05));
    gain.gain.exponentialRampToValueAtTime(0.0001, when + length);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    osc.start(when);
    osc.stop(when + length + 0.02);

    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = midiToHz(note - 12);
    const subGain = env(when, 0.11, 0.012, length);
    sub.connect(subGain);
    subGain.connect(master);
    sub.start(when);
    sub.stop(when + length + 0.04);
  };

  const pad = (when: number, notes: number[], length: number, level = 0.052) => {
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1500;
    filter.Q.value = 0.4;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(level, when + 0.25);
    gain.gain.setValueAtTime(level, when + length - 0.2);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + length + 0.35);
    filter.connect(gain);
    gain.connect(master);
    sendToRoom(gain, 0.5);

    for (const note of notes) {
      for (const detune of [-6, 6]) {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = midiToHz(note);
        osc.detune.value = detune;
        osc.connect(filter);
        osc.start(when);
        osc.stop(when + length + 0.4);
      }
    }
  };

  const bell = (when: number, note: number) => {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = midiToHz(note);
    const gain = env(when, 0.13, 0.008, 0.92);
    osc.connect(gain);
    gain.connect(master);
    sendToRoom(gain, 0.6);
    osc.start(when);
    osc.stop(when + 1.05);
  };

  const crackle = (when: number, level: number) => {
    const source = ctx.createBufferSource();
    source.buffer = noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 3200;
    const gain = env(when, level, 0.001, 0.018);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    source.start(when);
    source.stop(when + 0.03);
  };

  const chords = [
    { root: 45, pad: [57, 60, 64, 67] },
    { root: 41, pad: [53, 57, 60, 64] },
    { root: 36, pad: [52, 55, 59, 62] },
    { root: 43, pad: [55, 59, 62, 64] },
  ];
  const motifs: [number, number][][] = [
    [
      [0.5, 76],
      [1.5, 72],
      [2.5, 74],
      [3.5, 71],
    ],
    [
      [0.5, 74],
      [1.5, 71],
      [2.5, 69],
      [3.5, 67],
    ],
  ];

  for (let bar = 0; bar < BARS; bar++) {
    const t0 = bar * 4 * BEAT;
    const chord = chords[bar];
    pad(t0, chord.pad, 4 * BEAT - 0.02);

    bass(t0, chord.root, BEAT * 0.85);
    bass(t0 + BEAT * 1.5, chord.root, BEAT * 0.55);
    bass(t0 + BEAT * 2.5, chord.root + 7, BEAT * 0.45);
    bass(t0 + BEAT * 3.5, chord.root, BEAT * 0.4);

    kick(t0);
    kick(t0 + BEAT * 2.5);
    snare(t0 + BEAT, 0.4);
    snare(t0 + BEAT * 3, 0.44);
    for (let step = 0; step < 8; step++) {
      hat(t0 + step * BEAT * 0.5, step % 2 === 0 ? 0.075 : 0.045);
    }

    if (bar >= 2) {
      for (const [beat, note] of motifs[bar - 2]) bell(t0 + beat * BEAT, note);
    }

    for (let i = 0; i < 6; i++) {
      crackle(t0 + Math.random() * 4 * BEAT, 0.012 + Math.random() * 0.018);
    }
  }

  // A last snare answers the bell line before the room decays.
  snare((BARS * 4 - 0.5) * BEAT, 0.3);

  const rendered = await ctx.startRendering();
  const channels = [rendered.getChannelData(0), rendered.getChannelData(1)];
  const wav = await encodeWav16Async(channels, SAMPLE_RATE);
  return new File([wav], 'VARISPEED demo — Night Drive.wav', { type: 'audio/wav' });
}
