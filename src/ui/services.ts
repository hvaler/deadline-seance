import { createSound } from './audio/sound';
import type { AudioLike } from './audio/types';
import type { SoundEvent } from './sound-events';

/**
 * The impure things the UI uses, behind small interfaces so tests can replace them: animation frames, timers and the sound player.
 * Nothing here reads the clock for the rule; frames and timers only schedule work.
 */

export interface Frame {
  /** Calls `callback` once, before the next paint, with a timestamp in milliseconds. */
  request(callback: (time: number) => void): number;
  cancel(id: number): void;
}

export interface Timers {
  set(callback: () => void, ms: number): number;
  clear(id: number): void;
}

export interface SoundPlayer {
  readonly enabled: boolean;
  /** Turning sound on must happen inside a user gesture (a click): that is when the audio context is created. */
  setEnabled(on: boolean): void;
  play(event: SoundEvent): void;
}

export interface Services {
  readonly frame: Frame;
  readonly timers: Timers;
  readonly sound: SoundPlayer;
}

export function browserFrame(): Frame {
  if (typeof window.requestAnimationFrame === 'function') {
    return {
      request: (callback) => window.requestAnimationFrame(callback),
      cancel: (id) => window.cancelAnimationFrame(id),
    };
  }
  // No animation frames (a bare test DOM): fall back to a short timer.
  return {
    request: (callback) => window.setTimeout(() => callback(0), 16),
    cancel: (id) => window.clearTimeout(id),
  };
}

export function browserTimers(): Timers {
  return {
    set: (callback, ms) => window.setTimeout(callback, ms),
    clear: (id) => window.clearTimeout(id),
  };
}

/** The real audio context, or null where there is none. It is created only when sound is first turned on. */
export function browserAudioFactory(): AudioLike | null {
  const Ctor = (window as unknown as { AudioContext?: new () => unknown }).AudioContext;
  return Ctor === undefined ? null : (new Ctor() as unknown as AudioLike);
}

export function browserServices(): Services {
  return { frame: browserFrame(), timers: browserTimers(), sound: createSound(browserAudioFactory) };
}