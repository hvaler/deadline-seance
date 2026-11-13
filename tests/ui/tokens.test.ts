import { describe, expect, test } from 'vitest';

// What the stylesheets promise, checked as text: the palette is exactly the one in the brief, no other colour sneaks in, no text uses a
// colour that fails contrast, nothing animates except transform and opacity, and everything that moves stops under reduced motion.
// (A real browser is still needed to see them; the manual checklist covers that.)

const files = import.meta.glob('../../src/ui/styles/*.css', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const css = Object.fromEntries(Object.entries(files).map(([path, text]) => [path.replace(/^.*\//, ''), text]));

const without = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '');

const PALETTE: Record<string, string> = {
  '--night': '#110e16',
  '--ply-1': '#3a2c22',
  '--ply-2': '#4a3829',
  '--bone': '#ebe4d3',
  '--stone': '#a49cad',
  '--dim': '#6f6779',
  '--red': '#ff3d3d',
  '--green': '#8fd47e',
  '--violet': '#7d5cff',
  '--tape': '#d9cfa6',
  '--rust': '#b8592f',
  '--amber': '#f1b24a',
};

/** Every `selector { declarations }` block, including those nested in `@media`, with the text of its declarations. */
function rules(text: string): { selector: string; body: string }[] {
  const found: { selector: string; body: string }[] = [];
  for (const m of without(text).matchAll(/([^{}]+)\{([^{}]*)\}/g)) found.push({ selector: (m[1] as string).trim(), body: (m[2] as string).trim() });
  return found;
}

function declarations(body: string): [string, string][] {
  return body
    .split(';')
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => {
      const i = d.indexOf(':');
      return [d.slice(0, i).trim(), d.slice(i + 1).trim()] as [string, string];
    });
}

describe('the stylesheets are all there', () => {
  test('the seven files exist and are not empty', () => {
    for (const name of ['fonts.css', 'tokens.css', 'base.css', 'layout.css', 'components.css', 'atmosphere.css', 'motion.css']) {
      expect(css[name]?.length ?? 0, name).toBeGreaterThan(100);
    }
  });
});

describe('the palette', () => {
  test('tokens.css defines exactly the twelve colours of the brief', () => {
    const tokens = Object.fromEntries(
      [...without(css['tokens.css'] ?? '').matchAll(/(--[a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)].map((m) => [m[1], (m[2] as string).toLowerCase()]),
    );
    expect(tokens).toEqual(PALETTE);
  });

  test('no other hex colour appears in any stylesheet', () => {
    const allowed = new Set(Object.values(PALETTE));
    for (const [name, text] of Object.entries(css)) {
      for (const m of without(text).matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
        expect(allowed.has(m[0].toLowerCase()), `${name} uses ${m[0]}`).toBe(true);
      }
    }
  });

  test('colour names and rgb() are only for shadows and light (black or the palette bone/amber/red as translucent light)', () => {
    for (const [name, text] of Object.entries(css)) {
      expect(without(text), name).not.toMatch(/:\s*(white|black|red|blue|green|yellow|gray|grey|orange|purple|pink|cyan|magenta)\b/i);
    }
  });

  test('every colour is used through a token: components.css never writes a literal colour for text, borders or fills', () => {
    for (const rule of rules(css['components.css'] ?? '')) {
      for (const [property, value] of declarations(rule.body)) {
        if (/^(color|background-color|border(-[a-z]+)*-color|outline-color)$/.test(property)) {
          expect(value, `${rule.selector} { ${property} }`).toMatch(/^var\(--[a-z0-9-]+\)( !important)?$/);
        }
      }
    }
  });
});

describe('type', () => {
  const tokens = without(css['tokens.css'] ?? '');

  test('the four faces of the brief, each with fallbacks', () => {
    expect(tokens).toMatch(/--font-title:\s*'Rubik Wet Paint',\s*Impact/);
    expect(tokens).toMatch(/--font-sign:\s*'Permanent Marker',/);
    expect(tokens).toMatch(/--font-body:\s*'IBM Plex Sans',\s*system-ui/);
    expect(tokens).toMatch(/--font-mono:\s*'IBM Plex Mono',\s*ui-monospace/);
  });

  test('every number is in the mono face with figures of equal width', () => {
    const rule = rules(css['base.css'] ?? '').find((r) => r.selector.includes('.num'));
    expect(rule).toBeDefined();
    expect(rule?.body).toContain('font-family: var(--font-mono)');
    expect(rule?.body).toContain('font-variant-numeric: tabular-nums');
  });

  test('the title uses the title face, painted signs use the sign face, body text is at least 16 px', () => {
    const components = rules(css['components.css'] ?? '');
    expect(components.find((r) => r.selector === '.title-card h1')?.body).toContain('font-family: var(--font-title)');
    expect(components.find((r) => r.selector === '.region-title')?.body).toContain('font-family: var(--font-sign)');
    expect(rules(css['base.css'] ?? '').find((r) => r.selector === 'html')?.body).toMatch(/font-size:\s*100%/);
  });
});

describe('text colours', () => {
  const ALLOWED = new Set(['--bone', '--stone', '--tape', '--amber', '--green', '--red', '--night']);
  const RED_ONLY_HERE = /(\.title-card h1|is-impossible|data-alert|data-kind='sinks'|data-kind='loss'|\.rec-dot)/;

  const textRules = Object.entries(css).flatMap(([file, text]) =>
    rules(text).flatMap((rule) =>
      declarations(rule.body)
        .filter(([property]) => property === 'color')
        .map(([, value]) => ({ file, selector: rule.selector, value, body: rule.body })),
    ),
  );

  test('there are text colour rules to check', () => {
    expect(textRules.length).toBeGreaterThan(30);
  });

  test('none uses dim, violet or rust, which fail contrast for text', () => {
    for (const r of textRules) expect(r.value, `${r.selector}`).not.toMatch(/--(dim|violet|rust)\b/);
  });

  test('every one is a palette token that passes contrast on the backgrounds the styles put it on', () => {
    for (const r of textRules) {
      const token = /var\((--[a-z0-9-]+)\)/.exec(r.value)?.[1];
      if (token === undefined) {
        expect(r.value, `${r.selector}`).toMatch(/^inherit$/);
        continue;
      }
      expect(ALLOWED.has(token), `${r.selector} uses ${token}`).toBe(true);
    }
  });

  test('red text appears only on the night: the title, the impossible-freeze panel, alerts, losses and the REC dot', () => {
    for (const r of textRules.filter((x) => x.value.includes('--red'))) expect(r.selector, r.selector).toMatch(RED_ONLY_HERE);
  });

  test('night text appears only on a coloured fill (amber, green, red or tape)', () => {
    for (const r of textRules.filter((x) => x.value.includes('--night'))) {
      expect(r.body, r.selector).toMatch(/background:\s*var\(--(amber|green|red|tape)\)/);
    }
  });

  test('stone text is never put on plywood 2: the tombstones use tape for secondary text', () => {
    const stoneInGraves = textRules.filter((r) => r.value.includes('--stone') && r.selector.includes('.grave'));
    expect(stoneInGraves).toEqual([]);
  });
});

describe('focus and size', () => {
  test('every focusable element gets a 3 px amber ring with an offset; the ring is never removed for keyboard users', () => {
    const base = rules(css['base.css'] ?? '');
    const ring = base.find((r) => r.selector === ':focus-visible');
    expect(ring?.body).toContain('outline: 3px solid var(--amber)');
    expect(ring?.body).toContain('outline-offset: 2px');
    for (const [name, text] of Object.entries(css)) {
      for (const r of rules(text)) {
        if (/outline:\s*none/.test(r.body)) expect(r.selector, `${name}: ${r.selector}`).toMatch(/:not\(:focus-visible\)/);
      }
    }
  });

  test('buttons, switches and the range thumbs are at least 44 px', () => {
    expect(css['tokens.css']).toMatch(/--target:\s*44px/);
    expect(css['tokens.css']).toMatch(/--thumb:\s*44px/);
    const components = rules(css['components.css'] ?? '');
    for (const selector of ['.button', '.chip']) {
      expect(components.find((r) => r.selector === selector)?.body, selector).toContain('min-height: var(--target)');
    }
    expect(components.find((r) => r.selector === '.range')?.body).toContain('height: var(--thumb)');
  });

  test('the body is a readable size and nothing forces a width wider than a phone', () => {
    const all = Object.values(css).map(without).join('\n');
    expect(all).not.toMatch(/font-size:\s*(?:[0-9]|1[0-5])px/); // nothing under 16 px as a pixel value
    expect(all).not.toMatch(/(^|[^-])width:\s*\d{4,}px/);
    // A media query is allowed to say (min-width: 820px); a rule is not allowed to force one.
    expect(all).not.toMatch(/(?<!\()min-width:\s*(?:[4-9]\d\d|\d{4,})px/);
  });
});

describe('layout', () => {
  const layout = without(css['layout.css'] ?? '');

  test('the two grounds sit side by side and stack in one column under 820 px', () => {
    const grounds = rules(layout).filter((r) => r.selector === '.grounds');
    expect(grounds).toHaveLength(2);
    expect(grounds[0]?.body).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))');
    expect(grounds[1]?.body).toContain('grid-template-columns: minmax(0, 1fr)');
    expect(layout).toContain('@media (max-width: 819.98px)');
  });

  test('tombstones and slots wrap to the screen: the minimum column width is capped by 100 %', () => {
    expect(layout).toContain('minmax(min(100%, 220px), 1fr)');
    expect(layout).toContain('minmax(min(100%, 240px), 1fr)');
  });

  test('the content is one centred column with a maximum width', () => {
    expect(rules(layout).find((r) => r.selector === 'main')?.body).toMatch(/max-width: var\(--max-width\)/);
    expect(css['tokens.css']).toMatch(/--max-width:\s*1120px/);
  });

  test('the order of the page is the order of the brief', () => {
    // The structure itself is checked in app-shell.test.ts; here the sign, candle and team are plain blocks that follow each other.
    expect(rules(layout).find((r) => r.selector === 'main')?.body).toContain('display: grid');
  });
});

describe('decoration', () => {
  const atmosphere = rules(css['atmosphere.css'] ?? '');

  test('both layers are fixed, cover the screen and take no pointer events; the back one sits behind the content, the front one above', () => {
    const layer = atmosphere.find((r) => r.selector === '.atmosphere');
    expect(layer?.body).toContain('position: fixed');
    expect(layer?.body).toContain('inset: 0');
    expect(layer?.body).toContain('pointer-events: none');
    expect(atmosphere.find((r) => r.selector === '.atmosphere-back')?.body).toContain('z-index: -1');
    expect(atmosphere.find((r) => r.selector === '.atmosphere-front')?.body).toMatch(/z-index:\s*\d+/);
  });

  test('the chains drawing takes no pointer events either', () => {
    expect(rules(css['layout.css'] ?? '').find((r) => r.selector === '.chains')?.body).toContain('pointer-events: none');
  });

  test('the moon, the vignette and the scanlines exist', () => {
    for (const selector of ['.moon', '.vignette', '.scanlines', '.rec']) expect(atmosphere.some((r) => r.selector === selector), selector).toBe(true);
    expect(atmosphere.find((r) => r.selector === '.scanlines')?.body).toContain('repeating-linear-gradient');
    expect(atmosphere.find((r) => r.selector === '.vignette')?.body).toContain('radial-gradient');
  });
});

describe('motion', () => {
  const motion = without(css['motion.css'] ?? '');

  /** The body of a block that starts at `open` (the index of its `{`), with nested braces. */
  function block(text: string, open: number): string {
    let depth = 0;
    for (let i = open; i < text.length; i++) {
      if (text[i] === '{') depth++;
      if (text[i] === '}' && --depth === 0) return text.slice(open + 1, i);
    }
    return '';
  }

  const keyframes = [...motion.matchAll(/@keyframes\s+([a-z-]+)\s*\{/g)].map((m) => ({ name: m[1] as string, body: block(motion, (m.index ?? 0) + m[0].length - 1) }));

  test('there are keyframes, and they animate only transform and opacity', () => {
    expect(keyframes.length).toBeGreaterThanOrEqual(6);
    for (const k of keyframes) {
      const properties = new Set([...k.body.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]));
      for (const p of properties) expect(['transform', 'opacity'], `${k.name} animates ${p}`).toContain(p);
    }
  });

  test('every animation in use has keyframes', () => {
    const names = new Set(keyframes.map((k) => k.name));
    for (const m of motion.matchAll(/animation:\s*([a-z-]+)\s/g)) {
      if (m[1] === 'none') continue;
      expect(names.has(m[1] as string), `animation ${m[1]}`).toBe(true);
    }
  });

  test('under prefers-reduced-motion: reduce every animation and transition is switched off', () => {
    const at = motion.indexOf('@media (prefers-reduced-motion: reduce)');
    expect(at).toBeGreaterThan(-1);
    const reduced = block(motion, motion.indexOf('{', at));
    expect(reduced).toContain('animation: none !important');
    expect(reduced).toContain('transition: none !important');
    expect(reduced).toMatch(/\*,\s*\*::before,\s*\*::after/);
  });

  test('static styling carries what an animation showed: a fallen tombstone stays tilted, a refused action keeps its outline', () => {
    const components = rules(css['components.css'] ?? '');
    expect(components.find((r) => r.selector === '.grave.is-fallen .card')?.body).toContain('rotate(-2.5deg)');
    expect(components.find((r) => r.selector === ".change-note[data-alert='true']")?.body).toContain('outline: 2px solid var(--red)');
  });

  test('nothing in the styles animates layout properties through transitions', () => {
    const all = Object.values(css).map(without).join('\n');
    expect(all).not.toMatch(/transition:[^;]*\b(width|height|top|left|margin|padding)\b/);
  });
});
