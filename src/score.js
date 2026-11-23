import { clamp, randomFrom } from './flight.js';

export const BEAT = 60 / 65;
export const BAR = 4 * BEAT;

// Bass, piano voicing, cello answer, and the flute's part of the original theme.
export const score = [
  [40, [55, 59, 64, 66, 71], [52, 59], [76, 78, 79]],
  [48, [55, 59, 64, 67, 72], [52, 55], [79, 76]],
  [47, [55, 62, 67, 69, 74], [50, 55], [74, 71, 69]],
  [45, [57, 62, 64, 69, 74], [54, 52], []],
  [45, [57, 60, 64, 71, 76], [57, 55], [72, 76, 83]],
  [43, [55, 59, 64, 66, 71], [52, 59], [81, 79]],
  [48, [55, 59, 62, 64, 67], [55, 52], [76, 74, 71]],
  [50, [57, 59, 64, 66, 69], [54, 57], []],
  [43, [55, 59, 62, 66, 69], [55, 62], [74, 78, 81]],
  [40, [55, 59, 60, 64, 67], [52, 55], [79, 76]],
  [45, [52, 57, 60, 64, 71], [57, 60], [76, 72, 71]],
  [47, [54, 57, 59, 64, 66], [59, 54], [78, 76]],
];

const instruments = {
  piano: [['piano45', 45], ['piano53', 53], ['piano61', 61], ['piano69', 69], ['piano77', 77]],
  cello: [['cello35', 47], ['cello45', 57], ['cello52', 64], ['cello59', 71], ['cello65', 77]],
  flute: [['flute60', 72], ['flute69', 81], ['flute76', 88]],
  harp: [['harp59', 59], ['harp69', 69], ['harp79', 79]],
};

export function bloomPitch(barIndex, tone, previous) {
  const notes = score[barIndex % score.length][1].map(note => note < 65 ? note + 12 : note).sort((a, b) => a - b);
  const start = tone % notes.length;
  for (let step = 0; step < notes.length; step++) {
    const note = notes[(start + step) % notes.length];
    if (note !== previous && (previous === null || Math.abs(note - previous) <= 9)) return note;
  }
  return notes[start];
}

export class MeadowScore {
  constructor(buffers) {
    this.buffers = buffers;
    this.samples = {};
    this.context = null;
    this.loading = null;
    this.muted = false;
    this.stage = 0;
    this.barNumber = 0;
    this.nextBar = 0;
    this.startedAt = 0;
    this.lastNote = null;
    this.lastOnset = 0;
    this.lastGust = -1;
    this.voices = new Set();
  }

  async start() {
    if (!this.context) {
      const Audio = window.AudioContext ?? window.webkitAudioContext;
      if (!Audio) throw new Error('Web Audio is unavailable');
      this.context = new Audio();
      this.createMix();
      this.loading = this.loadSamples();
    }
    const resumed = this.context.resume();
    await Promise.all([resumed, this.loading]);
    if (!this.nextBar) {
      this.startedAt = this.context.currentTime + 0.08;
      this.nextBar = this.startedAt;
      this.update(0);
    }
  }

  createMix() {
    const ctx = this.context;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.76;
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -16;
    compressor.knee.value = 13;
    compressor.ratio.value = 3;
    this.master.connect(compressor).connect(ctx.destination);

    this.room = ctx.createConvolver();
    const seconds = 3.0;
    const impulse = ctx.createBuffer(2, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const rng = randomFrom(831);
    for (let channel = 0; channel < 2; channel++) {
      const data = impulse.getChannelData(channel);
      let low = 0;
      for (let i = 0; i < data.length; i++) {
        low = low * 0.68 + (rng() * 2 - 1) * 0.32;
        data[i] = low * (1 - i / data.length) ** 3.75 * Math.min(1, i / 480);
      }
    }
    this.room.buffer = impulse;
    const wet = ctx.createGain();
    wet.gain.value = 0.26;
    this.room.connect(wet).connect(this.master);

    const air = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate);
    const airData = air.getChannelData(0);
    let brown = 0;
    for (let i = 0; i < airData.length; i++) {
      brown = 0.973 * brown + (rng() - 0.5) * 0.064;
      airData[i] = brown * Math.min(1, i / 2400, (airData.length - i) / 2400);
    }
    const wind = ctx.createBufferSource();
    wind.buffer = air;
    wind.loop = true;
    const airFilter = ctx.createBiquadFilter();
    airFilter.type = 'lowpass';
    airFilter.frequency.value = 490;
    this.airGain = ctx.createGain();
    this.airGain.gain.value = 0.19;
    wind.connect(airFilter).connect(this.airGain).connect(this.master);
    wind.start();
  }

  async loadSamples() {
    for (const instrument of Object.keys(instruments)) this.samples[instrument] = [];
    await Promise.all(Object.entries(instruments).flatMap(([instrument, entries]) => entries.map(async ([key, root]) => {
      const bytes = this.buffers[key];
      const buffer = await this.context.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
      const wave = buffer.getChannelData(0);
      let peak = 0;
      for (const sample of wave) peak = Math.max(peak, Math.abs(sample));
      const start = wave.findIndex(value => Math.abs(value) > peak * 0.06) / buffer.sampleRate;
      this.samples[instrument].push({
        root, buffer, gain: clamp(0.67 / peak, 1, 80), offset: Math.max(0, start - 0.009),
      });
    })));
    for (const entries of Object.values(this.samples)) entries.sort((a, b) => a.root - b.root);
  }

  note(instrument, pitch, at, duration, volume, pan = 0) {
    const ctx = this.context;
    const choices = this.samples[instrument];
    if (!choices?.length || this.voices.size >= 64) return;
    const sample = choices.reduce((best, entry) => (
      Math.abs(entry.root - pitch) < Math.abs(best.root - pitch) ? entry : best
    ));
    const source = ctx.createBufferSource();
    const rate = 2 ** ((pitch - sample.root) / 12);
    source.buffer = sample.buffer;
    source.playbackRate.value = rate;
    const env = ctx.createGain();
    const loudness = volume * sample.gain;
    const attack = instrument === 'cello' || instrument === 'flute' ? 0.21 : 0.008;
    const release = instrument === 'piano' || instrument === 'harp' ? 0.65 : 0.52;
    const end = at + Math.min(duration, Math.max(0.3, (source.buffer.duration - sample.offset) / rate - release));
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(loudness, at + attack);
    env.gain.setValueAtTime(loudness, end);
    env.gain.linearRampToValueAtTime(0, end + release);
    source.connect(env);
    const panner = ctx.createStereoPanner?.();
    let output = env;
    if (panner) {
      panner.pan.value = clamp(pan, -0.55, 0.55);
      output = env.connect(panner);
    }
    output.connect(this.master);
    output.connect(this.room);
    this.voices.add(source);
    source.onended = () => {
      this.voices.delete(source);
      source.disconnect();
      env.disconnect();
      panner?.disconnect();
    };
    source.start(at, sample.offset);
    source.stop(end + release + 0.025);
  }

  playBar(index, time) {
    const [bass, voicing, cello, flute] = score[index];
    this.note('piano', bass, time, 3.0, 0.112, -0.19);
    this.note('piano', voicing[1], time + BEAT * 0.58, 2.2, 0.108, -0.1);
    this.note('piano', voicing[2], time + BEAT * 1.36, 2.0, 0.096, -0.06);
    this.note('piano', voicing[index % 2 ? 3 : 4], time + BEAT * 2.24, 1.62, 0.104, 0.09);
    if (index % 4 < 2) this.note('piano', voicing[3], time + BEAT * 3.35, 1.4, 0.069, 0.16);
    if (this.stage > 0) {
      this.note('cello', cello[0], time + 0.11, 1.86, 0.138, -0.27);
      this.note('cello', cello[1], time + BEAT * 2.13, 1.38, 0.118, -0.22);
    }
    if (this.stage > 1) {
      flute.forEach((pitch, i) => {
        this.note('flute', pitch, time + BEAT * ([0.27, 1.69, 2.93][i]), i === 0 ? 1.12 : 0.86, 0.106 - i * 0.013, 0.24);
      });
    }
    if (this.stage > 2) {
      this.note('cello', voicing[0] + 12, time + 0.27, 2.9, 0.086, 0.15);
      this.note('harp', voicing[4] + (index % 2 ? 0 : 12), time + BEAT * 3.01, 1.8, 0.115, -0.05);
    }
  }

  update(gust) {
    const ctx = this.context;
    if (!ctx || ctx.state !== 'running' || !this.nextBar) return;
    const now = ctx.currentTime;
    if (Math.abs(gust - this.lastGust) > 0.045) {
      this.airGain.gain.setTargetAtTime(0.16 + gust * 0.21, now, 0.43);
      this.lastGust = gust;
    }
    if (this.nextBar < now - BAR) {
      const missed = Math.ceil((now - this.nextBar) / BAR);
      this.barNumber += missed;
      this.nextBar += missed * BAR;
    }
    if (this.nextBar < now + 0.23) {
      this.playBar(this.barNumber % score.length, Math.max(now + 0.019, this.nextBar));
      this.barNumber++;
      this.nextBar += BAR;
    }
  }

  bloom(flower, pan, completed) {
    const ctx = this.context;
    if (!ctx || !this.nextBar || ctx.state !== 'running') return;
    const at = Math.min(ctx.currentTime + 0.13, Math.max(ctx.currentTime + 0.008, this.lastOnset + 0.054));
    const bar = Math.max(0, Math.floor((at - this.startedAt) / BAR));
    const pitch = bloomPitch(bar, flower.tone + flower.glade, this.lastNote);
    this.lastNote = pitch;
    this.lastOnset = at;
    const instrument = flower.voice === 'flute' ? 'harp' : flower.voice;
    this.note(instrument, pitch, at, 1.47, instrument === 'piano' ? 0.141 : 0.20, pan);
    if (flower.voice === 'flute') this.note('flute', pitch + 12, at + 0.08, 0.64, 0.055, pan);
    if (completed) {
      const tones = score[bar % score.length][1];
      this.note('harp', tones[0], at + 0.16, 2.1, 0.15, -0.12);
      this.note('harp', tones[2] + 12, at + 0.47, 2.1, 0.13, 0.12);
    }
  }

  setMute(muted) {
    this.muted = muted;
    if (this.master) this.master.gain.setTargetAtTime(muted ? 0 : 0.76, this.context.currentTime, 0.13);
  }

  pause() {
    if (this.context?.state === 'running') this.context.suspend().catch(() => {});
  }
}
