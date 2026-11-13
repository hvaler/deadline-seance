import type { SoundEvent } from '../sound-events';
import type { AudioLike, BufferLike, GainLike, NodeLike } from './types';

/**
 * The four sounds of the night, each built from a few oscillators and filters at the moment it is played. Every sound has its own
 * character, so they can be told apart with the eyes closed:
 *
 * - resurrect: rising and shimmering: two detuned saw waves glide up an octave through an opening filter, with a slow tremolo and a
 *   high breath at the end;
 * - put down: dry and final: a short crack, a low hollow note, and a small metallic ring;
 * - bury: a soft low thud that falls in pitch, with a puff of soil;
 * - cascade: a quick roll of five falling thuds, each lower and quieter, like a row of stones going down.
 *
 * Each recipe schedules everything from `start`, stops every source, and returns when it will be silent.
 */

export interface Bus {
  readonly ctx: AudioLike;
  /** Goes straight to the master gain. */
  readonly dry: GainLike;
  /** Goes through the one shared reverb. */
  readonly wet: GainLike;
  /** The one shared burst of noise. */
  readonly noise: BufferLike;
}

export interface Played {
  /** Seconds after `start` when the last source stops. */
  readonly duration: number;
}

export type Recipe = (bus: Bus, start: number) => Played;

const FLOOR = 0.0001;

/** A gain that rises to `peak` and dies away exponentially by `end`. */
function envelope(bus: Bus, peak: number, start: number, attack: number, end: number): GainLike {
  const gain = bus.ctx.createGain();
  gain.gain.setValueAtTime(FLOOR, start);
  gain.gain.linearRampToValueAtTime(peak, start + attack);
  gain.gain.exponentialRampToValueAtTime(FLOOR, end);
  return gain;
}

/** Sends a node to the dry bus, and to the reverb through the recipe's own send level. */
function route(bus: Bus, node: NodeLike, send: GainLike): void {
  node.connect(bus.dry);
  node.connect(send);
}

function makeSend(bus: Bus, level: number): GainLike {
  const send = bus.ctx.createGain();
  send.gain.value = level;
  send.connect(bus.wet);
  return send;
}

/** One low thud: a sine that falls in pitch, and a puff of low-passed noise. `pitch` scales the frequencies, `level` the loudness. */
function thud(bus: Bus, send: GainLike, start: number, pitch: number, level: number): number {
  const { ctx } = bus;
  const body = ctx.createOscillator();
  body.type = 'sine';
  body.frequency.setValueAtTime(110 * pitch, start);
  body.frequency.exponentialRampToValueAtTime(48 * pitch, start + 0.45);
  const bodyGain = envelope(bus, 0.6 * level, start, 0.01, start + 0.5);
  body.connect(bodyGain);
  route(bus, bodyGain, send);
  body.start(start);
  body.stop(start + 0.5);

  const soil = ctx.createBufferSource();
  soil.buffer = bus.noise;
  const soilFilter = ctx.createBiquadFilter();
  soilFilter.type = 'lowpass';
  soilFilter.frequency.setValueAtTime(600 * pitch, start);
  soilFilter.Q.value = 0.7;
  const soilGain = envelope(bus, 0.25 * level, start, 0.005, start + 0.12);
  soil.connect(soilFilter);
  soilFilter.connect(soilGain);
  route(bus, soilGain, send);
  soil.start(start);
  soil.stop(start + 0.12);
  return start + 0.5;
}

const resurrect: Recipe = (bus, start) => {
  const { ctx } = bus;
  const end = start + 0.9;

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.Q.value = 4;
  filter.frequency.setValueAtTime(400, start);
  filter.frequency.exponentialRampToValueAtTime(2400, start + 0.7);

  const body = envelope(bus, 0.35, start, 0.08, start + 0.85);
  const tremolo = ctx.createGain();
  tremolo.gain.value = 0.75;
  const send = makeSend(bus, 0.5);

  for (const [from, to] of [
    [220, 440],
    [223, 446],
  ] as const) {
    const saw = ctx.createOscillator();
    saw.type = 'sawtooth';
    saw.frequency.setValueAtTime(from, start);
    saw.frequency.exponentialRampToValueAtTime(to, start + 0.7);
    saw.connect(filter);
    saw.start(start);
    saw.stop(end);
  }
  filter.connect(body);
  body.connect(tremolo);
  route(bus, tremolo, send);

  // A slow wobble on the loudness.
  const lfo = ctx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.setValueAtTime(6, start);
  const lfoDepth = ctx.createGain();
  lfoDepth.gain.value = 0.25;
  lfo.connect(lfoDepth);
  lfoDepth.connect(tremolo.gain);
  lfo.start(start);
  lfo.stop(end);

  // The breath at the end.
  const breath = ctx.createOscillator();
  breath.type = 'sine';
  breath.frequency.setValueAtTime(1320, start + 0.65);
  const breathGain = envelope(bus, 0.06, start + 0.65, 0.05, end);
  breath.connect(breathGain);
  route(bus, breathGain, send);
  breath.start(start + 0.65);
  breath.stop(end);

  return { duration: end - start };
};

const putDown: Recipe = (bus, start) => {
  const { ctx } = bus;
  const end = start + 1;
  const send = makeSend(bus, 0.25);

  // The crack.
  const crack = ctx.createBufferSource();
  crack.buffer = bus.noise;
  const crackFilter = ctx.createBiquadFilter();
  crackFilter.type = 'highpass';
  crackFilter.frequency.setValueAtTime(2000, start);
  crackFilter.Q.value = 0.7;
  const crackGain = envelope(bus, 0.5, start, 0.002, start + 0.04);
  crack.connect(crackFilter);
  crackFilter.connect(crackGain);
  route(bus, crackGain, send);
  crack.start(start);
  crack.stop(start + 0.05);

  // The hollow note.
  const hollow = ctx.createOscillator();
  hollow.type = 'sine';
  hollow.frequency.setValueAtTime(65, start);
  const hollowGain = envelope(bus, 0.6, start, 0.005, start + 0.5);
  hollow.connect(hollowGain);
  route(bus, hollowGain, send);
  hollow.start(start);
  hollow.stop(start + 0.5);

  // The ring: two partials that are not harmonics of each other, like a small piece of metal.
  for (const frequency of [523, 811]) {
    const partial = ctx.createOscillator();
    partial.type = 'sine';
    partial.frequency.setValueAtTime(frequency, start);
    const partialGain = envelope(bus, 0.14, start, 0.003, start + 0.95);
    partial.connect(partialGain);
    route(bus, partialGain, send);
    partial.start(start);
    partial.stop(end);
  }
  return { duration: end - start };
};

const bury: Recipe = (bus, start) => {
  const send = makeSend(bus, 0.2);
  const end = thud(bus, send, start, 1, 1);
  return { duration: end - start };
};

const cascade: Recipe = (bus, start) => {
  const send = makeSend(bus, 0.25);
  let end = start;
  for (let i = 0; i < 5; i++) {
    const pitch = 2 ** (-i / 12); // a semitone lower each time
    const level = 0.85 ** i; // and 15 % quieter
    end = Math.max(end, thud(bus, send, start + 0.07 * i, pitch, level));
  }
  return { duration: end - start };
};

export const RECIPES: Readonly<Record<SoundEvent, Recipe>> = {
  resurrect,
  'put-down': putDown,
  bury,
  cascade,
};
