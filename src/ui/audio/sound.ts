import type { SoundPlayer } from '../services';
import type { SoundEvent } from '../sound-events';
import { RECIPES } from './recipes';
import type { Bus } from './recipes';
import { makeImpulse, makeNoise } from './reverb';
import type { AudioLike } from './types';

/**
 * The sound player. Sound is off by default, and nothing audio is created until it is turned on: the context is made inside the click that
 * turns it on (a user gesture, which browsers require), once, and reused. One short convolution reverb with a generated impulse is built
 * once and shared by every sound. If there is no audio context, or anything throws, playing does nothing and the app works the same.
 *
 * No audio file, no third-party music and no network request.
 */

export const MASTER_GAIN = 0.25;
const START_DELAY = 0.02;

export type AudioFactory = () => AudioLike | null;

export function createSound(factory: AudioFactory): SoundPlayer {
  let enabled = false;
  let ctx: AudioLike | null = null;
  let bus: Bus | null = null;
  let tried = false;

  function build(): void {
    tried = true;
    try {
      const made = factory();
      if (made === null) return;
      const master = made.createGain();
      master.gain.value = MASTER_GAIN;
      master.connect(made.destination);

      const dry = made.createGain();
      dry.connect(master);

      const wet = made.createGain();
      const room = made.createConvolver();
      room.buffer = makeImpulse(made);
      const roomOut = made.createGain();
      roomOut.gain.value = 0.8;
      wet.connect(room);
      room.connect(roomOut);
      roomOut.connect(master);

      ctx = made;
      bus = { ctx: made, dry, wet, noise: makeNoise(made) };
    } catch {
      ctx = null;
      bus = null;
    }
  }

  return {
    get enabled() {
      return enabled;
    },
    setEnabled(on) {
      enabled = on;
      if (on && !tried) build();
      if (ctx === null) return;
      try {
        void (on ? ctx.resume() : ctx.suspend());
      } catch {
        // A context that cannot be resumed or suspended is not worth failing over.
      }
    },
    play(event: SoundEvent) {
      if (!enabled || ctx === null || bus === null) return;
      try {
        RECIPES[event](bus, ctx.currentTime + START_DELAY);
      } catch {
        // A sound that cannot be built is skipped.
      }
    },
  };
}
