import { describe, expect, test, vi } from 'vitest';
import { RECIPES } from '../../src/ui/audio/recipes';
import { IMPULSE_SECONDS, makeImpulse, makeNoise } from '../../src/ui/audio/reverb';
import { MASTER_GAIN, createSound } from '../../src/ui/audio/sound';
import type { SoundEvent } from '../../src/ui/sound-events';
import { FakeAudio } from './fake-audio';
import type { FakeGain, FakeOscillator } from './fake-audio';

const EVENTS: SoundEvent[] = ['resurrect', 'put-down', 'bury', 'cascade'];

/** A sound player on a fake context, turned on, with the graph it built at that moment counted apart from what a sound adds. */
function ready() {
  const audio = new FakeAudio();
  const factory = vi.fn(() => audio);
  const sound = createSound(factory);
  sound.setEnabled(true);
  const baseline = audio.nodes.length;
  return { audio, factory, sound, baseline };
}

/** What one sound built: the nodes created while it played. */
function built(event: SoundEvent) {
  const { audio, sound, baseline } = ready();
  sound.play(event);
  const nodes = audio.nodes.slice(baseline);
  return {
    audio,
    nodes,
    oscillators: nodes.filter((n): n is FakeOscillator => n.kind === 'oscillator'),
    sources: nodes.filter((n) => n.kind === 'source'),
    filters: nodes.filter((n) => n.kind === 'filter'),
    gains: nodes.filter((n): n is FakeGain => n.kind === 'gain'),
  };
}

describe('sound is off by default and nothing is created until it is turned on', () => {
  test('creating the player builds nothing', () => {
    const factory = vi.fn(() => new FakeAudio());
    const sound = createSound(factory);
    expect(sound.enabled).toBe(false);
    expect(factory).not.toHaveBeenCalled();
  });

  test('playing while off does nothing and still builds nothing', () => {
    const factory = vi.fn(() => new FakeAudio());
    const sound = createSound(factory);
    for (const event of EVENTS) sound.play(event);
    expect(factory).not.toHaveBeenCalled();
  });

  test('turning it on creates the context, once, and resumes it', () => {
    const { audio, factory } = ready();
    expect(factory).toHaveBeenCalledTimes(1);
    expect(audio.resumed).toBe(1);
  });

  test('turning it off suspends the context; turning it on again reuses it', () => {
    const { audio, factory, sound } = ready();
    sound.setEnabled(false);
    expect(sound.enabled).toBe(false);
    expect(audio.suspended).toBe(1);
    sound.setEnabled(true);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(audio.resumed).toBe(2);
  });

  test('after being turned off, playing does nothing', () => {
    const { audio, sound } = ready();
    sound.setEnabled(false);
    const before = audio.nodes.length;
    for (const event of EVENTS) sound.play(event);
    expect(audio.nodes.length).toBe(before);
  });
});

describe('the master chain', () => {
  test('has a quiet master gain that goes to the destination, at most 0.3', () => {
    const { audio } = ready();
    const master = audio.of('gain').find((g) => g.connections.includes(audio.destination));
    expect(master).toBeDefined();
    expect(master?.gain.value).toBe(MASTER_GAIN);
    expect(MASTER_GAIN).toBeLessThanOrEqual(0.3);
  });

  test('has exactly one convolver, with a stereo impulse of 1.2 seconds made in code', () => {
    const { audio } = ready();
    const convolvers = audio.of('convolver');
    expect(convolvers).toHaveLength(1);
    const impulse = convolvers[0]?.buffer;
    expect(impulse?.numberOfChannels).toBe(2);
    expect(impulse?.length).toBe(Math.floor(audio.sampleRate * IMPULSE_SECONDS));
  });

  test('the convolver is wired dry-free: only the reverb bus goes into it, and it comes out into the master', () => {
    const { audio } = ready();
    const convolver = audio.of('convolver')[0]!;
    const feeders = audio.of('gain').filter((g) => g.connections.includes(convolver));
    expect(feeders).toHaveLength(1);
    expect(convolver.connections).toHaveLength(1);
  });

  test('many sounds still leave one convolver and two buffers (the impulse and the noise), both created once', () => {
    const { audio, sound } = ready();
    for (let i = 0; i < 6; i++) for (const event of EVENTS) sound.play(event);
    expect(audio.of('convolver')).toHaveLength(1);
    expect(audio.buffers).toHaveLength(2);
  });
});

describe('each sound', () => {
  for (const event of EVENTS) {
    test(`${event}: lasts under 1.6 seconds, uses fewer than 40 nodes, stops every source, and reaches the reverb`, () => {
      const { audio, nodes, oscillators, sources, gains } = built(event);
      expect(nodes.length).toBeGreaterThan(3);
      expect(nodes.length).toBeLessThan(40);

      const start = audio.currentTime;
      const stops = [...oscillators, ...sources.map((s) => s as unknown as FakeOscillator)].map((n) => n.stoppedAt);
      for (const stop of stops) expect(stop).not.toBeNull();
      const last = Math.max(...(stops as number[]));
      expect(last - start).toBeLessThan(1.6);
      expect(last).toBeGreaterThan(start);

      for (const n of [...oscillators, ...sources.map((s) => s as unknown as FakeOscillator)]) {
        expect(n.startedAt).not.toBeNull();
        expect(n.startedAt as number).toBeGreaterThanOrEqual(start);
        expect(n.stoppedAt as number).toBeGreaterThan(n.startedAt as number);
      }

      const wet = audio.of('gain').find((g) => g.connections.includes(audio.of('convolver')[0]));
      const reachesReverb = gains.some((g) => g.connections.includes(wet));
      expect(reachesReverb).toBe(true);
    });

    test(`${event}: no gain is louder than 0.6 and every envelope fades to near silence`, () => {
      const { gains } = built(event);
      for (const g of gains) {
        for (const call of g.gain.calls) expect(call.value).toBeLessThanOrEqual(0.6);
        if (g.gain.calls.length > 0) expect(g.gain.last).toBeLessThan(0.001);
      }
    });
  }

  test('the recipes are exactly the four events', () => {
    expect(Object.keys(RECIPES).sort()).toEqual([...EVENTS].sort());
  });
});

describe('the four sounds are different from each other', () => {
  /** What a sound is made of: each source with its waveform and starting pitch, and each filter with its type. */
  function signature(event: SoundEvent): string {
    const { oscillators, sources, filters } = built(event);
    const parts = [
      ...oscillators.map((o) => `osc:${o.type}:${Math.round(o.frequency.first)}`),
      ...sources.map(() => 'noise'),
      ...filters.map((f) => `filter:${f.type}`),
    ];
    return parts.sort().join(' ');
  }

  test('no two have the same signature', () => {
    const signatures = EVENTS.map(signature);
    expect(new Set(signatures).size).toBe(4);
  });

  test('resurrect rises: two detuned saws gliding up an octave through a low-pass that opens, with a breath at the end', () => {
    const { oscillators, filters } = built('resurrect');
    const saws = oscillators.filter((o) => o.type === 'sawtooth');
    expect(saws).toHaveLength(2);
    expect(saws.map((s) => [s.frequency.first, s.frequency.last])).toEqual([
      [220, 440],
      [223, 446],
    ]);
    expect(filters).toHaveLength(1);
    expect(filters[0]?.type).toBe('lowpass');
    expect(filters[0]?.frequency.first).toBe(400);
    expect(filters[0]?.frequency.last).toBe(2400);
    expect(oscillators.some((o) => o.type === 'sine' && o.frequency.first === 6)).toBe(true); // the tremolo
    expect(oscillators.some((o) => o.type === 'sine' && o.frequency.first === 1320)).toBe(true); // the breath
  });

  test('put down is dry and final: a crack of noise, a low note, and a ring of two partials that are not harmonics', () => {
    const { oscillators, sources, filters } = built('put-down');
    expect(sources).toHaveLength(1);
    expect(filters.map((f) => f.type)).toEqual(['highpass']);
    expect(oscillators.map((o) => Math.round(o.frequency.first)).sort((a, b) => a - b)).toEqual([65, 523, 811]);
    expect(811 % 523).not.toBe(0);
    expect(oscillators.every((o) => o.type === 'sine')).toBe(true);
  });

  test('bury is one soft thud that falls in pitch, with a puff of soil', () => {
    const { oscillators, sources, filters } = built('bury');
    expect(oscillators).toHaveLength(1);
    expect(oscillators[0]?.type).toBe('sine');
    expect(oscillators[0]?.frequency.first).toBe(110);
    expect(oscillators[0]?.frequency.last).toBe(48);
    expect(sources).toHaveLength(1);
    expect(filters.map((f) => f.type)).toEqual(['lowpass']);
  });

  test('cascade is five thuds in quick succession, each a semitone lower and quieter than the one before', () => {
    const { oscillators, sources } = built('cascade');
    expect(oscillators).toHaveLength(5);
    expect(sources).toHaveLength(5);
    const starts = oscillators.map((o) => o.startedAt as number);
    for (let i = 1; i < starts.length; i++) expect(starts[i]! - starts[i - 1]!).toBeCloseTo(0.07, 10);
    const pitches = oscillators.map((o) => o.frequency.first);
    pitches.forEach((p, i) => expect(p).toBeCloseTo(110 * 2 ** (-i / 12), 10));
    for (let i = 1; i < pitches.length; i++) expect(pitches[i]!).toBeLessThan(pitches[i - 1]!);
  });

  test('cascade is not just bury five times: it is longer and has the roll', () => {
    const bury = built('bury');
    const cascade = built('cascade');
    expect(cascade.oscillators.length).toBeGreaterThan(bury.oscillators.length);
    const end = (b: ReturnType<typeof built>) => Math.max(...b.oscillators.map((o) => o.stoppedAt as number)) - b.audio.currentTime;
    expect(end(cascade)).toBeGreaterThan(end(bury));
  });
});

describe('failure is quiet', () => {
  test('no audio context at all: nothing throws, nothing plays, and the factory is not asked again', () => {
    const factory = vi.fn(() => null);
    const sound = createSound(factory);
    sound.setEnabled(true);
    expect(sound.enabled).toBe(true);
    for (const event of EVENTS) expect(() => sound.play(event)).not.toThrow();
    sound.setEnabled(false);
    sound.setEnabled(true);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  test('a factory that throws is survived', () => {
    const sound = createSound(() => {
      throw new Error('no audio here');
    });
    expect(() => sound.setEnabled(true)).not.toThrow();
    expect(() => sound.play('bury')).not.toThrow();
  });

  test('a context that fails while a sound is built does not break the player, and later sounds still work', () => {
    const audio = new FakeAudio();
    const sound = createSound(() => audio);
    sound.setEnabled(true);
    const original = audio.createOscillator.bind(audio);
    let fail = true;
    audio.createOscillator = () => {
      if (fail) throw new Error('out of oscillators');
      return original();
    };
    expect(() => sound.play('resurrect')).not.toThrow();
    fail = false;
    const before = audio.nodes.length;
    sound.play('bury');
    expect(audio.nodes.length).toBeGreaterThan(before);
  });

  test('resume and suspend that reject or throw are survived', () => {
    const audio = new FakeAudio();
    audio.resume = () => {
      throw new Error('blocked');
    };
    const sound = createSound(() => audio);
    expect(() => sound.setEnabled(true)).not.toThrow();
    expect(() => sound.setEnabled(false)).not.toThrow();
  });
});

describe('what is generated is deterministic and made in code', () => {
  test('the impulse is the same every time, decays towards silence, and differs between the two ears', () => {
    const a = makeImpulse(new FakeAudio());
    const b = makeImpulse(new FakeAudio());
    expect([...a.getChannelData(0)]).toEqual([...b.getChannelData(0)]);
    expect([...a.getChannelData(1)]).toEqual([...b.getChannelData(1)]);
    expect([...a.getChannelData(0)]).not.toEqual([...a.getChannelData(1)]);

    const left = a.getChannelData(0);
    const peak = (from: number, to: number) => Math.max(...[...left.slice(from, to)].map(Math.abs));
    const quarter = Math.floor(left.length / 4);
    expect(peak(0, quarter)).toBeGreaterThan(peak(quarter * 3, left.length));
    expect(Math.abs(left[left.length - 1] ?? 1)).toBeLessThan(0.01);
    for (const sample of left) expect(Math.abs(sample)).toBeLessThanOrEqual(1);
  });

  test('the noise is the same every time and stays within -1 and 1', () => {
    const a = makeNoise(new FakeAudio());
    const b = makeNoise(new FakeAudio());
    expect([...a.getChannelData(0)]).toEqual([...b.getChannelData(0)]);
    expect(a.numberOfChannels).toBe(1);
    for (const sample of a.getChannelData(0)) expect(Math.abs(sample)).toBeLessThanOrEqual(1);
  });

  test('two players make the same graph for the same sound', () => {
    const shape = (event: SoundEvent) => {
      const { audio, baseline, sound } = ready();
      sound.play(event);
      return audio.nodes.slice(baseline).map((n) => `${n.kind}:${'type' in n ? n.type : ''}`);
    };
    for (const event of EVENTS) expect(shape(event)).toEqual(shape(event));
  });

  test('playing later schedules later: the sound starts after the current time of the context', () => {
    const { audio, sound, baseline } = ready();
    audio.currentTime = 42;
    sound.play('bury');
    const osc = audio.nodes.slice(baseline).find((n) => n.kind === 'oscillator') as FakeOscillator;
    expect(osc.startedAt).toBeGreaterThan(42);
    expect(osc.startedAt).toBeLessThan(42.1);
  });
});
