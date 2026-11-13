// @vitest-environment jsdom
import * as fc from 'fast-check';
import { afterEach, describe, expect, test } from 'vitest';
import { compareKeys, solveFreeze } from '../../src/engine/index';
import { boardFor, freezeFor } from '../../src/ui/model';
import type { AppState } from '../../src/ui/state';
import { arbAction, arbMeaningfulAction } from './arbitraries';
import { drag, mountWith, region, release, shownKeys } from './harness';

// The screen must say exactly what the engine says. After every action the keys shown in the safehouse and in the yard are the engine's
// kept and buried keys for the board and freeze of the current state (asked here, straight from `solveFreeze`), they partition the tickets,
// and both lists are empty exactly when the freeze is impossible.

afterEach(() => {
  document.body.replaceChildren();
});

function expectScreenMatchesEngine(root: HTMLElement, state: AppState): void {
  const answer = solveFreeze(boardFor(state), freezeFor(state));
  if (!answer.ok) throw new Error(`the engine refused: ${answer.error.code}`);
  const solution = answer.value;
  const kept = shownKeys(root, 'safehouse');
  const buried = shownKeys(root, 'yard');
  if (solution.status === 'impossible') {
    expect(kept, 'safehouse while impossible').toEqual([]);
    expect(buried, 'yard while impossible').toEqual([]);
    return;
  }
  expect(kept).toEqual([...solution.kept].sort(compareKeys));
  expect(buried).toEqual(solution.buried.map((b) => b.key).sort(compareKeys));
  // They partition the tickets of the board: nothing twice, nothing missing.
  const all = state.board.tickets.map((t) => t.key).sort(compareKeys);
  expect([...kept, ...buried].sort(compareKeys)).toEqual(all);
  expect(new Set([...kept, ...buried]).size).toBe(all.length);
  // Empty exactly when impossible: a solved board with tickets shows tickets.
  expect(kept.length + buried.length > 0 || all.length === 0).toBe(true);
}

describe('the shown lists equal the engine (random actions through the real store)', () => {
  test('after any sequence of actions, including ones the reducer ignores, the lists equal solveFreeze', () => {
    fc.assert(
      fc.property(fc.array(fc.oneof(arbMeaningfulAction, arbAction), { maxLength: 14 }), (actions) => {
        document.body.replaceChildren();
        const { app, root } = mountWith();
        expectScreenMatchesEngine(root, app.store.getState());
        for (const action of actions) {
          app.store.dispatch(action);
          expectScreenMatchesEngine(root, app.store.getState());
        }
        app.destroy();
      }),
      { numRuns: 60 },
    );
  });

  test('the lists are empty exactly when the freeze is impossible (the first three candle positions of the sample)', () => {
    const { app, root } = mountWith();
    for (const step of [0, 1, 2, 3, 10]) {
      app.store.dispatch({ type: 'candle/set', step });
      const state = app.store.getState();
      const answer = solveFreeze(boardFor(state), freezeFor(state));
      const impossible = answer.ok && answer.value.status === 'impossible';
      expect(shownKeys(root, 'safehouse').length === 0 && shownKeys(root, 'yard').length === 0, `step ${step}`).toBe(impossible);
    }
  });
});

describe('the same equality when the DOM is driven: clicks on buttons and input events on the ranges', () => {
  type Move = { readonly kind: 'candle' | 'reserve' | 'switch' | 'tombstone-button'; readonly pick: number };
  const arbMove: fc.Arbitrary<Move> = fc.record({
    kind: fc.constantFrom('candle', 'reserve', 'switch', 'tombstone-button', 'tombstone-button'),
    pick: fc.nat({ max: 1000 }),
  });

  test('every move leaves the screen equal to the engine', () => {
    fc.assert(
      fc.property(fc.array(arbMove, { maxLength: 10 }), (moves) => {
        document.body.replaceChildren();
        const { app, root } = mountWith();
        for (const move of moves) {
          if (move.kind === 'candle') {
            const input = root.querySelector<HTMLInputElement>('input[data-focus="candle"]')!;
            drag(input, move.pick % 11);
            release(input);
          } else if (move.kind === 'reserve') {
            const input = root.querySelector<HTMLInputElement>('input[data-focus="reserve"]')!;
            drag(input, [0, 5, 10, 15, 20, 25, 30][move.pick % 7] as number);
            release(input);
          } else if (move.kind === 'switch') {
            const switches = [...root.querySelectorAll<HTMLButtonElement>('button[role="switch"]')];
            switches[move.pick % switches.length]?.click();
          } else {
            const buttons = [...region(root, 'yard').querySelectorAll<HTMLButtonElement>('.card-actions button:not([hidden])')];
            buttons[move.pick % Math.max(buttons.length, 1)]?.click();
          }
          expectScreenMatchesEngine(root, app.store.getState());
        }
        app.destroy();
      }),
      { numRuns: 30 },
    );
  });
});
