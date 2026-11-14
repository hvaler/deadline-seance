import type { View } from '../derive';
import type { Action, AppState } from '../state';

/**
 * The guided tour as data. A script is a list of scenes; the player (`player.ts`) knows nothing about any of them, so a later spec adds
 * scenes (the certificate, the chronicle, CSV) by adding data.
 */

/** The part of the page a scene brings into view. */
export type Show = 'top' | 'sign' | 'fog' | 'candle' | 'survivors' | 'safehouse' | 'yard' | 'certificate';

/** A state and the view the screen derives from it. */
export interface Snapshot {
  readonly state: AppState;
  readonly view: View;
}

/** What a subtitle may be built from: three moments of the tour, each with the engine's answers. */
export interface SceneFacts {
  /** The state after the first scene: the plain night every later number is compared with. It is not the user's own state. */
  readonly first: Snapshot;
  /** Just before this scene's actions. */
  readonly before: Snapshot;
  /** After them. */
  readonly after: Snapshot;
}

export interface Scene {
  readonly id: string;
  /** Dispatched in order at the start of the scene, as if the user had pressed the controls. May be empty. */
  readonly actions: readonly Action[];
  /** One sentence, from the facts only: no arithmetic on engine numbers, no clock, no DOM. */
  readonly caption: (facts: SceneFacts) => string;
  /** Integer milliseconds. */
  readonly durationMs: number;
  readonly show: Show;
  /** Focus ids the page already has (`card:HB-108`, `tomb:HB-112`), ringed for the length of the scene. */
  readonly spot?: readonly string[];
}

export type Script = readonly Scene[];

export type Phase = 'idle' | 'playing' | 'paused' | 'ended';

/** One tick of the player's own time, in milliseconds. Time is a count of ticks of the injected timers; nothing reads a clock. */
export const TICK_MS = 100;
