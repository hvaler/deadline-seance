import { describe, expect, test } from 'vitest';
import { compareKeyLists, compareKeys, sortedKeys } from '../../src/engine/keys';

describe('keys', () => {
  test('code-unit order: CRYPT-12 sorts before CRYPT-2', () => {
    expect(compareKeys('CRYPT-12', 'CRYPT-2')).toBeLessThan(0);
    expect(sortedKeys(['CRYPT-2', 'CRYPT-12', 'CRYPT-1'])).toEqual(['CRYPT-1', 'CRYPT-12', 'CRYPT-2']);
  });

  test('upper case sorts before lower case (no locale)', () => {
    expect(compareKeys('B-1', 'a-1')).toBeLessThan(0);
  });

  test('equal keys compare as 0', () => {
    expect(compareKeys('X-1', 'X-1')).toBe(0);
  });

  test('sortedKeys does not mutate its input', () => {
    const input = ['b', 'a'];
    sortedKeys(input);
    expect(input).toEqual(['b', 'a']);
  });

  test('compareKeyLists compares element by element', () => {
    expect(compareKeyLists(['A', 'C'], ['A', 'D'])).toBeLessThan(0);
    expect(compareKeyLists(['B'], ['A', 'Z'])).toBeGreaterThan(0);
    expect(compareKeyLists(['A'], ['A'])).toBe(0);
  });
});
