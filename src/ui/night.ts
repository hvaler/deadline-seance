import type { NightInput } from '../engine/index';
import { freezeFor } from './model';
import type { AppState } from './model';

/**
 * What the engine needs to write the facts of the night the user is looking at: the board as loaded, the board with its exhumes and put-downs, the
 * freeze (whose `now` is the sample's constant, never the clock), who is away, and what the release is called.
 */
export function nightInputOf(state: AppState): NightInput {
  return { home: state.home, board: state.board, freeze: freezeFor(state), away: state.away, release: state.release };
}
