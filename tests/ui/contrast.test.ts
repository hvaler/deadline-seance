import { describe, expect, test } from 'vitest';

// WCAG 2.x contrast of the palette pairs the styles use. The ratios in the design document come from this same formula.

const PALETTE = {
  night: '#110e16',
  ply1: '#3a2c22',
  ply2: '#4a3829',
  bone: '#ebe4d3',
  stone: '#a49cad',
  dim: '#6f6779',
  red: '#ff3d3d',
  green: '#8fd47e',
  violet: '#7d5cff',
  tape: '#d9cfa6',
  rust: '#b8592f',
  amber: '#f1b24a',
} as const;

type Name = keyof typeof PALETTE;

function channel(hex: string, at: number): number {
  const c = parseInt(hex.slice(at, at + 2), 16) / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Relative luminance of a `#rrggbb` colour. */
export function luminance(hex: string): number {
  return 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
}

/** Contrast ratio between two colours, from 1 to 21. */
export function contrast(a: Name, b: Name): number {
  const x = luminance(PALETTE[a]);
  const y = luminance(PALETTE[b]);
  const [hi, lo] = x > y ? [x, y] : [y, x];
  return (hi + 0.05) / (lo + 0.05);
}

describe('the formula', () => {
  test('black on white is 21 and a colour on itself is 1', () => {
    expect(luminance('#ffffff')).toBeCloseTo(1, 10);
    expect(luminance('#000000')).toBe(0);
    expect((1 + 0.05) / (0 + 0.05)).toBe(21);
    expect(contrast('bone', 'bone')).toBe(1);
  });

  test('is symmetric', () => {
    expect(contrast('bone', 'night')).toBe(contrast('night', 'bone'));
  });

  test('matches the ratios written in the design document (to two decimals)', () => {
    const expected: [Name, Name, number][] = [
      ['bone', 'night', 15.09],
      ['bone', 'ply1', 10.6],
      ['bone', 'ply2', 8.77],
      ['stone', 'night', 7.23],
      ['stone', 'ply1', 5.08],
      ['stone', 'ply2', 4.2],
      ['dim', 'night', 3.54],
      ['red', 'night', 5.45],
      ['red', 'ply1', 3.83],
      ['green', 'night', 10.82],
      ['violet', 'night', 4.41],
      ['amber', 'night', 10.2],
      ['rust', 'night', 4.1],
      ['night', 'tape', 12.23],
    ];
    for (const [a, b, ratio] of expected) expect(contrast(a, b), `${a} on ${b}`).toBeCloseTo(ratio, 1);
  });
});

describe('text pairs: at least 4.5 to 1', () => {
  // Every text colour on every background it is drawn on. `[text, background]`.
  const TEXT: [Name, Name][] = [
    ['bone', 'night'],
    ['bone', 'ply1'],
    ['bone', 'ply2'],
    ['stone', 'night'],
    ['stone', 'ply1'],
    ['tape', 'night'],
    ['tape', 'ply1'],
    ['tape', 'ply2'],
    ['amber', 'night'],
    ['amber', 'ply1'],
    ['amber', 'ply2'],
    ['green', 'night'],
    ['green', 'ply1'],
    ['green', 'ply2'],
    ['red', 'night'],
    ['night', 'tape'],
    ['night', 'bone'], // the engraved text of a tombstone, at the top of the slab
    ['night', 'stone'], // and at the foot of it
    ['night', 'green'],
    ['night', 'amber'],
    ['night', 'red'],
  ];
  for (const [text, background] of TEXT) {
    test(`${text} on ${background}`, () => {
      expect(contrast(text, background)).toBeGreaterThanOrEqual(4.5);
    });
  }
});

describe('pairs that must not carry small text', () => {
  const NOT_FOR_TEXT: [Name, Name][] = [
    ['stone', 'ply2'], // 4.20
    ['red', 'ply1'], // 3.83
    ['red', 'ply2'],
    ['violet', 'night'], // 4.41
    ['violet', 'ply1'],
    ['rust', 'night'], // 4.10
    ['rust', 'ply1'],
    ['dim', 'night'], // 3.54
    ['dim', 'ply1'],
    ['bone', 'violet'],
    ['bone', 'rust'],
    ['bone', 'red'],
  ];
  for (const [text, background] of NOT_FOR_TEXT) {
    test(`${text} on ${background} is below 4.5, so the styles keep text off it`, () => {
      expect(contrast(text, background)).toBeLessThan(4.5);
    });
  }
});

describe('non-text parts: at least 3 to 1', () => {
  const PARTS: [string, Name, Name][] = [
    ['the focus ring on the night', 'amber', 'night'],
    ['the focus ring on plywood 1', 'amber', 'ply1'],
    ['the focus ring on plywood 2', 'amber', 'ply2'],
    ['the focus ring on tape', 'night', 'tape'],
    ['a button border on plywood 1', 'tape', 'ply1'],
    ['a button border on plywood 2', 'tape', 'ply2'],
    ['a kept card edge', 'green', 'ply1'],
    ['a survivor switch that is here', 'green', 'ply1'],
    ['a survivor switch that is away', 'stone', 'ply1'],
    ['a tombstone border', 'stone', 'ply2'],
    ['a resurrect or exhume button border', 'green', 'ply2'],
    ['a put-down button border', 'red', 'ply2'],
    ['the zombie badge rim against its fill', 'violet', 'night'],
    ['the impossible-freeze edge', 'red', 'night'],
    ['the change note edge', 'amber', 'night'],
    ['an empty-slot border', 'stone', 'night'],
    ['the range thumb on the track end', 'amber', 'night'],
  ];
  for (const [what, a, b] of PARTS) {
    test(`${what} (${a} against ${b})`, () => {
      expect(contrast(a, b)).toBeGreaterThanOrEqual(3);
    });
  }
});

describe('large text: at least 3 to 1', () => {
  test('the title is neon red on the night, large, and well above the minimum', () => {
    expect(contrast('red', 'night')).toBeGreaterThanOrEqual(4.5);
  });

  test('the impossible-freeze headline is red on the night too (it sits on a night panel, not on plywood)', () => {
    expect(contrast('red', 'night')).toBeGreaterThanOrEqual(4.5);
  });
});

describe('the tombstone slab: night text on every colour the slab takes', () => {
  const tokens = import.meta.glob('../../src/ui/styles/tokens.css', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
  const text = Object.values(tokens)[0] ?? '';
  const hexOf = (name: string): string => PALETTE[name.replace(/^--/, '').replace('-', '') as Name];
  const toRgb = (hex: string): [number, number, number] => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16)) as [number, number, number];
  const toHex = (rgb: number[]): string => `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;
  /** `color-mix(in srgb, A p%, B)`: the channels of A and B in the proportion p to 100 - p. */
  function mix(a: string, p: number, b: string): string {
    const [x, y] = [toRgb(a), toRgb(b)];
    return toHex(x.map((c, i) => (c * p) / 100 + ((y[i] as number) * (100 - p)) / 100));
  }
  function slab(token: string): string {
    const value = new RegExp(`${token}:\\s*([^;]+);`).exec(text)?.[1] ?? '';
    const plain = /^var\((--[a-z0-9-]+)\)$/.exec(value);
    if (plain) return hexOf(plain[1] as string);
    const m = /^color-mix\(in srgb,\s*var\((--[a-z0-9-]+)\)\s*(\d+)%,\s*var\((--[a-z0-9-]+)\)\)$/.exec(value);
    if (!m) throw new Error(`cannot read ${token}: ${value}`);
    return mix(hexOf(m[1] as string), Number(m[2]), hexOf(m[3] as string));
  }
  for (const token of ['--slab-top', '--slab-bottom', '--slab-zombie-top', '--slab-zombie-bottom']) {
    test(`night on ${token} is at least 4.5`, () => {
      const colour = slab(token);
      const [hi, lo] = [luminance(colour), luminance(PALETTE.night)];
      expect((hi + 0.05) / (lo + 0.05)).toBeGreaterThanOrEqual(4.5);
    });
  }
  test('the focus ring needs a dark halo on the slab: amber alone is below 3 against the pale top', () => {
    expect(contrast('amber', 'bone')).toBeLessThan(3);
    expect(contrast('night', 'bone')).toBeGreaterThanOrEqual(3);
  });
});