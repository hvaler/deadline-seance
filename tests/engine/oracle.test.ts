import { describe, expect, test } from 'vitest';
import { ORACLE_MAX_TICKETS, oracleSolve } from '../../src/engine/oracle';
import { ticket, validOf } from './fixtures';

describe('oracle (hand-made boards)', () => {
  test('empty board: nothing kept, nothing saved', () => {
    expect(oracleSolve(validOf([]), 5)).toEqual({ status: 'ok', kept: [], savedCod: 0, keptEffort: 0 });
  });

  test('keeps everything when it all fits', () => {
    const r = oracleSolve(validOf([ticket('A-1', 2, 3), ticket('B-1', 3, 4)]), 5);
    expect(r).toEqual({ status: 'ok', kept: ['A-1', 'B-1'], savedCod: 7, keptEffort: 5 });
  });

  test('"C beats A + B": with capacity 10 the pair wins, with 11 the single ticket wins', () => {
    const board = validOf([ticket('A', 6, 12), ticket('B', 4, 10), ticket('C', 11, 30)]);
    expect(oracleSolve(board, 10)).toEqual({ status: 'ok', kept: ['A', 'B'], savedCod: 22, keptEffort: 10 });
    expect(oracleSolve(board, 11)).toEqual({ status: 'ok', kept: ['C'], savedCod: 30, keptEffort: 11 });
  });

  test('must-haves are kept even when they are worth little', () => {
    const board = validOf([ticket('A', 5, 1, { mustHave: true }), ticket('B', 5, 50)]);
    expect(oracleSolve(board, 5)).toEqual({ status: 'ok', kept: ['A'], savedCod: 1, keptEffort: 5 });
  });

  test('a kept ticket needs its whole dependency chain', () => {
    const board = validOf([
      ticket('A', 4, 1),
      ticket('B', 1, 10, { dependsOn: ['A'] }),
      ticket('C', 1, 10, { dependsOn: ['B'] }),
    ]);
    expect(oracleSolve(board, 5)).toEqual({ status: 'ok', kept: ['A', 'B'], savedCod: 11, keptEffort: 5 });
    expect(oracleSolve(board, 3)).toEqual({ status: 'ok', kept: [], savedCod: 0, keptEffort: 0 });
    expect(oracleSolve(board, 6)).toEqual({ status: 'ok', kept: ['A', 'B', 'C'], savedCod: 21, keptEffort: 6 });
  });

  test('impossible when the must-haves do not fit', () => {
    const board = validOf([ticket('A', 6, 1, { mustHave: true })]);
    expect(oracleSolve(board, 5)).toEqual({ status: 'impossible' });
  });

  test('impossible when a must-have depends on a put-down key', () => {
    const board = validOf([ticket('A', 1, 1, { mustHave: true, dependsOn: ['W-1'] })], { wontDo: ['W-1'] });
    expect(oracleSolve(board, 100)).toEqual({ status: 'impossible' });
  });

  test('a ticket that depends on a put-down key is never kept, nor are its dependents', () => {
    const board = validOf(
      [ticket('A', 1, 9, { dependsOn: ['W-1'] }), ticket('B', 1, 9, { dependsOn: ['A'] }), ticket('C', 1, 2)],
      { wontDo: ['W-1'] },
    );
    expect(oracleSolve(board, 100)).toEqual({ status: 'ok', kept: ['C'], savedCod: 2, keptEffort: 1 });
  });
});

describe('oracle (tie-breaks, one level at a time)', () => {
  test('equal cod, equal count, equal effort: the alphabetical rule buries the smaller key', () => {
    const board = validOf([ticket('A-1', 5, 7), ticket('B-1', 5, 7)]);
    expect(oracleSolve(board, 5)).toEqual({ status: 'ok', kept: ['B-1'], savedCod: 7, keptEffort: 5 });
  });

  test('keys compare by code unit: CRYPT-12 is buried before CRYPT-2', () => {
    const board = validOf([ticket('CRYPT-12', 5, 7), ticket('CRYPT-2', 5, 7)]);
    expect(oracleSolve(board, 5)).toEqual({ status: 'ok', kept: ['CRYPT-2'], savedCod: 7, keptEffort: 5 });
  });

  test('equal cod: bury fewer tickets (keep two small ones over one big one)', () => {
    const board = validOf([ticket('A', 3, 4), ticket('B', 2, 2), ticket('C', 1, 2)]);
    expect(oracleSolve(board, 3)).toEqual({ status: 'ok', kept: ['B', 'C'], savedCod: 4, keptEffort: 3 });
  });

  test('equal cod, equal count: bury less effort (keep the bigger one)', () => {
    const board = validOf([ticket('X', 4, 5), ticket('Y', 3, 5)]);
    expect(oracleSolve(board, 4)).toEqual({ status: 'ok', kept: ['X'], savedCod: 5, keptEffort: 4 });
  });

  test('a zero-cod ticket that fits is kept (fewer buried), one that does not is buried', () => {
    const board = validOf([ticket('A', 2, 5), ticket('Z', 1, 0), ticket('Y', 9, 0)]);
    expect(oracleSolve(board, 3)).toEqual({ status: 'ok', kept: ['A', 'Z'], savedCod: 5, keptEffort: 3 });
  });
});

describe('oracle (limits)', () => {
  test('refuses more than 16 tickets', () => {
    const tickets = Array.from({ length: ORACLE_MAX_TICKETS + 1 }, (_, i) => ticket(`T-${String(i).padStart(2, '0')}`, 1, 1));
    expect(() => oracleSolve(validOf(tickets), 10)).toThrow(/more than 16/);
  });

  test('accepts exactly 16 tickets', () => {
    const tickets = Array.from({ length: ORACLE_MAX_TICKETS }, (_, i) => ticket(`T-${String(i).padStart(2, '0')}`, 1, 1));
    expect(oracleSolve(validOf(tickets), 4)).toMatchObject({ status: 'ok', savedCod: 4 });
  });

  test('does not mutate the board', () => {
    const board = validOf([ticket('B', 1, 1), ticket('A', 1, 1)]);
    const before = JSON.stringify(board);
    oracleSolve(board, 1);
    expect(JSON.stringify(board)).toBe(before);
  });
});
