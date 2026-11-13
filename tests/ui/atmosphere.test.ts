// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest';
import { mountApp } from '../../src/ui/app';
import { createDecor } from '../../src/ui/atmosphere/decor';
import { FOG_BLOBS, FOG_FRAME_MS, FOG_SCALE, createFog, fraction } from '../../src/ui/atmosphere/fog';
import type { CanvasLike, Context2dLike, FogDeps } from '../../src/ui/atmosphere/fog';
import { startAtmosphere } from '../../src/ui/atmosphere/index';
import type { AtmosphereDeps } from '../../src/ui/atmosphere/index';
import { REDUCED_MOTION_QUERY, motionPreference } from '../../src/ui/atmosphere/motion';
import type { MediaQueryListLike } from '../../src/ui/atmosphere/motion';
import { TIMECODE_INTERVAL_MS, TIMECODE_ZERO, createTimecode, formatTimecode } from '../../src/ui/atmosphere/timecode';
import { sampleBoard } from '../../src/ui/sample-board';
import { FakeFrame, FakeTimers } from './harness';

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

// ---- fakes ------------------------------------------------------------------------------------------------------------

interface Draw {
  image: unknown;
  x: number;
  y: number;
  width: number;
  height: number;
  alpha: number;
}

class FakeContext implements Context2dLike {
  fillStyle: unknown = null;
  globalAlpha = 1;
  readonly draws: Draw[] = [];
  readonly clears: number[] = [];
  readonly stops: [number, string][] = [];
  clearRect(): void {
    this.clears.push(this.draws.length);
  }
  fillRect(): void {}
  drawImage(image: unknown, x: number, y: number, width: number, height: number): void {
    this.draws.push({ image, x, y, width, height, alpha: this.globalAlpha });
  }
  createRadialGradient() {
    return { addColorStop: (offset: number, color: string) => void this.stops.push([offset, color]) };
  }
}

class FakeCanvas implements CanvasLike {
  width = 300;
  height = 150;
  readonly context = new FakeContext();
  getContext(): FakeContext {
    return this.context;
  }
}

function fogSetup(options: { visible?: boolean; viewport?: { width: number; height: number } } = {}) {
  const frame = new FakeFrame();
  const canvas = new FakeCanvas();
  const sprites: FakeCanvas[] = [];
  let visible = options.visible ?? true;
  let notify: () => void = () => {};
  let unsubscribed = 0;
  const deps: FogDeps = {
    frame,
    viewport: () => options.viewport ?? { width: 1280, height: 720 },
    createCanvas: () => {
      const sprite = new FakeCanvas();
      sprites.push(sprite);
      return sprite;
    },
    isVisible: () => visible,
    onVisibility: (listener) => {
      notify = listener;
      return () => {
        unsubscribed++;
      };
    },
  };
  const fog = createFog(canvas, deps);
  return {
    fog,
    frame,
    canvas,
    sprites,
    setVisible: (v: boolean) => {
      visible = v;
      notify();
    },
    unsubscribed: () => unsubscribed,
  };
}

// ---- the timecode -----------------------------------------------------------------------------------------------------

describe('timecode', () => {
  test('formats hours, minutes, seconds and frames at 25 a second', () => {
    expect(formatTimecode(0)).toBe('00:00:00:00');
    expect(formatTimecode(39)).toBe('00:00:00:00');
    expect(formatTimecode(40)).toBe('00:00:00:01');
    expect(formatTimecode(999)).toBe('00:00:00:24');
    expect(formatTimecode(1000)).toBe('00:00:01:00');
    expect(formatTimecode(61_000)).toBe('00:01:01:00');
    expect(formatTimecode(3_661_040)).toBe('01:01:01:01');
    expect(formatTimecode(100 * 3_600_000)).toBe('100:00:00:00');
  });

  test('negative and fractional values are tidied up', () => {
    expect(formatTimecode(-5)).toBe('00:00:00:00');
    expect(formatTimecode(1000.9)).toBe('00:00:01:00');
  });

  function timecodeSetup() {
    const node = document.createElement('span');
    const timers = new FakeTimers();
    let clock = 5_000;
    const timecode = createTimecode(node, { now: () => clock, timers });
    return { node, timers, timecode, advance: (ms: number) => ((clock += ms), timers.advance(ms)) };
  }

  test('starts at zero and counts from the moment it starts, four times a second', () => {
    const { node, timecode, advance, timers } = timecodeSetup();
    timecode.start();
    expect(node.textContent).toBe('00:00:00:00');
    expect(TIMECODE_INTERVAL_MS).toBe(250);
    advance(250);
    expect(node.textContent).toBe('00:00:00:06');
    advance(750);
    expect(node.textContent).toBe('00:00:01:00');
    expect(timers.pending).toBe(1);
  });

  test('under reduced motion it shows zeros and runs nothing', () => {
    const { node, timecode, advance, timers } = timecodeSetup();
    timecode.setReduced(true);
    timecode.start();
    advance(5000);
    expect(node.textContent).toBe(TIMECODE_ZERO);
    expect(timers.pending).toBe(0);
  });

  test('switching to reduced motion stops it, and switching back starts it again', () => {
    const { node, timecode, advance, timers } = timecodeSetup();
    timecode.start();
    advance(1000);
    timecode.setReduced(true);
    expect(node.textContent).toBe(TIMECODE_ZERO);
    expect(timers.pending).toBe(0);
    timecode.setReduced(false);
    expect(timers.pending).toBe(1);
    advance(250);
    expect(node.textContent).not.toBe(TIMECODE_ZERO);
  });

  test('stop clears the timer', () => {
    const { timecode, timers } = timecodeSetup();
    timecode.start();
    timecode.stop();
    expect(timers.pending).toBe(0);
  });
});

// ---- motion preference ------------------------------------------------------------------------------------------------

describe('motion preference', () => {
  function media(initial: boolean, legacy = false) {
    const listeners = new Set<() => void>();
    const list = { matches: initial } as MediaQueryListLike & { matches: boolean };
    if (legacy) {
      (list as { addListener?: (l: () => void) => void }).addListener = (l) => void listeners.add(l);
      (list as { removeListener?: (l: () => void) => void }).removeListener = (l) => void listeners.delete(l);
    } else {
      (list as { addEventListener?: (t: string, l: () => void) => void }).addEventListener = (_t, l) => void listeners.add(l);
      (list as { removeEventListener?: (t: string, l: () => void) => void }).removeEventListener = (_t, l) => void listeners.delete(l);
    }
    const queries: string[] = [];
    const matchMedia = (query: string) => (queries.push(query), list);
    return { matchMedia, list, listeners, queries, change: (value: boolean) => ((list.matches = value), [...listeners].forEach((l) => l())) };
  }

  test('asks the right question and reports the answer', () => {
    const m = media(true);
    const pref = motionPreference(m.matchMedia);
    expect(m.queries).toEqual([REDUCED_MOTION_QUERY]);
    expect(REDUCED_MOTION_QUERY).toBe('(prefers-reduced-motion: reduce)');
    expect(pref.reduced).toBe(true);
    expect(motionPreference(media(false).matchMedia).reduced).toBe(false);
  });

  test('without matchMedia nothing is reduced and subscribing is harmless', () => {
    const pref = motionPreference(undefined);
    expect(pref.reduced).toBe(false);
    expect(() => pref.subscribe(() => {})()).not.toThrow();
  });

  test('follows a change of the setting, and stops following when unsubscribed', () => {
    const m = media(false);
    const pref = motionPreference(m.matchMedia);
    const seen: boolean[] = [];
    const stop = pref.subscribe((r) => seen.push(r));
    m.change(true);
    m.change(false);
    stop();
    m.change(true);
    expect(seen).toEqual([true, false]);
    expect(m.listeners.size).toBe(0);
  });

  test('works with the older listener API too', () => {
    const m = media(false, true);
    const pref = motionPreference(m.matchMedia);
    const seen: boolean[] = [];
    const stop = pref.subscribe((r) => seen.push(r));
    m.change(true);
    stop();
    m.change(false);
    expect(seen).toEqual([true]);
  });
});

// ---- the fog ----------------------------------------------------------------------------------------------------------

describe('fog', () => {
  test('hash fractions are in 0..1, deterministic, and different for different blobs and purposes', () => {
    const values = Array.from({ length: FOG_BLOBS }, (_, i) => fraction(i, 1));
    for (const v of values) expect(v).toBeGreaterThanOrEqual(0);
    for (const v of values) expect(v).toBeLessThan(1);
    expect(new Set(values).size).toBe(FOG_BLOBS);
    expect(fraction(3, 2)).toBe(fraction(3, 2));
    expect(fraction(3, 2)).not.toBe(fraction(3, 3));
  });

  test('never asks for a random number', () => {
    const random = vi.spyOn(Math, 'random');
    const { fog, frame } = fogSetup();
    fog.start();
    for (let t = 0; t <= 500; t += 50) frame.flush(t);
    fog.destroy();
    expect(random).not.toHaveBeenCalled();
  });

  test('the canvas is a quarter of the screen in each direction', () => {
    const { fog, canvas } = fogSetup({ viewport: { width: 1280, height: 720 } });
    fog.start();
    expect(FOG_SCALE).toBe(4);
    expect([canvas.width, canvas.height]).toEqual([320, 180]);
  });

  test('the soft sprite is drawn once and reused: one extra canvas however long it runs', () => {
    const { fog, frame, sprites, canvas } = fogSetup();
    fog.start();
    for (let t = 0; t <= 1000; t += 50) frame.flush(t);
    expect(sprites).toHaveLength(1);
    expect(sprites[0]?.context.stops.length).toBeGreaterThanOrEqual(3);
    for (const draw of canvas.context.draws) expect(draw.image).toBe(sprites[0]);
  });

  test('draws one frame at once, with every blob, and then asks for the next frame', () => {
    const { fog, frame, canvas } = fogSetup();
    fog.start();
    expect(fog.draws).toBe(1);
    expect(canvas.context.draws).toHaveLength(FOG_BLOBS);
    expect(frame.pending).toBe(1);
  });

  test('runs 20 frames a second at most, and does not draw again before a frame is due', () => {
    const { fog, frame } = fogSetup();
    fog.start();
    expect(FOG_FRAME_MS).toBe(50);
    const before = fog.draws;
    frame.flush(1000); // the first frame only sets the clock: the still picture was drawn at start
    for (const t of [1010, 1020, 1030, 1048]) frame.flush(t);
    expect(fog.draws).toBe(before); // too soon: nothing drawn, but the loop keeps going
    expect(frame.pending).toBe(1);
    frame.flush(1050);
    expect(fog.draws).toBe(before + 1);
    frame.flush(1060);
    frame.flush(1098);
    expect(fog.draws).toBe(before + 1);
    frame.flush(1100);
    expect(fog.draws).toBe(before + 2);
  });

  test('over a second of 60 hertz frames it draws every third frame: 20 times, not 60', () => {
    const { fog, frame } = fogSetup();
    fog.start();
    frame.flush(0);
    const start = fog.draws;
    for (let n = 1; n <= 60; n++) frame.flush((n * 1000) / 60);
    expect(fog.draws - start).toBeGreaterThanOrEqual(19);
    expect(fog.draws - start).toBeLessThanOrEqual(21);
  });

  test('on a 144 hertz screen it still draws about 20 times a second', () => {
    const { fog, frame } = fogSetup();
    fog.start();
    frame.flush(0);
    const start = fog.draws;
    for (let n = 1; n <= 144; n++) frame.flush((n * 1000) / 144);
    expect(fog.draws - start).toBeLessThanOrEqual(21);
    expect(fog.draws - start).toBeGreaterThanOrEqual(17);
  });

  test('the drift starts from the still picture: the first drawn frame is where the one drawn at start was', () => {
    const { fog, frame, canvas } = fogSetup();
    fog.start();
    const still = canvas.context.draws.slice(0, FOG_BLOBS).map((d) => d.x);
    frame.flush(123_456); // the frame clock is page time, far from zero
    frame.flush(123_456 + 50);
    const next = canvas.context.draws.slice(-FOG_BLOBS).map((d) => d.x);
    next.forEach((x, i) => expect(Math.abs(x - (still[i] as number))).toBeLessThan(1));
  });
  test('the blobs drift, and stay inside the span they wrap around', () => {
    const { fog, frame, canvas } = fogSetup();
    fog.start();
    const first = canvas.context.draws.slice(0, FOG_BLOBS).map((d) => d.x);
    for (let t = 50; t <= 20_000; t += 50) frame.flush(t);
    const last = canvas.context.draws.slice(-FOG_BLOBS);
    expect(last.map((d) => d.x)).not.toEqual(first);
    for (const d of last) {
      expect(d.x).toBeGreaterThanOrEqual(-d.width);
      expect(d.x).toBeLessThan(canvas.width + 1);
      expect(d.alpha).toBeGreaterThan(0);
      expect(d.alpha).toBeLessThan(1);
    }
  });

  test('two fogs with the same screen draw exactly the same picture', () => {
    const a = fogSetup();
    const b = fogSetup();
    a.fog.start();
    b.fog.start();
    for (const t of [50, 100, 150]) {
      a.frame.flush(t);
      b.frame.flush(t);
    }
    const strip = (c: FakeCanvas) => c.context.draws.map(({ x, y, width, height, alpha }) => [x, y, width, height, alpha]);
    expect(strip(a.canvas)).toEqual(strip(b.canvas));
  });

  test('under reduced motion it draws one still frame and asks for no more', () => {
    const { fog, frame } = fogSetup();
    fog.setReduced(true);
    fog.start();
    expect(fog.draws).toBe(1);
    expect(frame.pending).toBe(0);
    expect(frame.requested).toBe(0);
  });

  test('switching to reduced motion stops the loop; switching back resumes it', () => {
    const { fog, frame } = fogSetup();
    fog.start();
    expect(frame.pending).toBe(1);
    fog.setReduced(true);
    expect(frame.pending).toBe(0);
    fog.setReduced(false);
    expect(frame.pending).toBe(1);
  });

  test('stops while the tab is hidden and starts again when it is shown', () => {
    const { fog, frame, setVisible } = fogSetup();
    fog.start();
    setVisible(false);
    expect(frame.pending).toBe(0);
    setVisible(true);
    expect(frame.pending).toBe(1);
  });

  test('a tab that starts hidden asks for no frames', () => {
    const { fog, frame } = fogSetup({ visible: false });
    fog.start();
    expect(frame.pending).toBe(0);
  });

  test('stop cancels the frame and stops listening for visibility; start is idempotent', () => {
    const { fog, frame, unsubscribed } = fogSetup();
    fog.start();
    fog.start();
    expect(frame.pending).toBe(1);
    fog.stop();
    expect(frame.pending).toBe(0);
    expect(unsubscribed()).toBe(1);
    const drawn = fog.draws;
    frame.flush(100);
    expect(fog.draws).toBe(drawn);
  });

  test('resizing redraws at the new size', () => {
    const view = { width: 1280, height: 720 };
    const frame = new FakeFrame();
    const canvas = new FakeCanvas();
    const fog = createFog(canvas, {
      frame,
      viewport: () => view,
      createCanvas: () => new FakeCanvas(),
      isVisible: () => true,
      onVisibility: () => () => {},
    });
    fog.start();
    view.width = 400;
    view.height = 800;
    fog.resize();
    expect([canvas.width, canvas.height]).toEqual([100, 200]);
    expect(fog.draws).toBe(2);
  });

  test('a canvas without a 2d context is survived', () => {
    const frame = new FakeFrame();
    const canvas: CanvasLike = { width: 0, height: 0, getContext: () => null };
    const fog = createFog(canvas, {
      frame,
      viewport: () => ({ width: 100, height: 100 }),
      createCanvas: () => canvas,
      isVisible: () => true,
      onVisibility: () => () => {},
    });
    expect(() => fog.start()).not.toThrow();
    frame.flush(100);
    expect(fog.draws).toBe(0);
  });
});

// ---- everything together ----------------------------------------------------------------------------------------------

describe('startAtmosphere', () => {
  function atmosphereSetup(reduced: boolean) {
    const back = document.createElement('div');
    const front = document.createElement('div');
    const decor = createDecor(back, front);
    const frame = new FakeFrame();
    const timers = new FakeTimers();
    const canvas = new FakeCanvas();
    let clock = 0;
    let motionChange: () => void = () => {};
    const query = { matches: reduced, addEventListener: (_t: string, l: () => void) => void (motionChange = l), removeEventListener: () => {} };
    let resize: () => void = () => {};
    let resizeStopped = false;
    const deps: AtmosphereDeps = {
      fog: {
        frame,
        viewport: () => ({ width: 800, height: 600 }),
        createCanvas: () => new FakeCanvas(),
        isVisible: () => true,
        onVisibility: () => () => {},
      },
      timecode: { now: () => clock, timers },
      matchMedia: () => query as unknown as MediaQueryListLike,
      onResize: (l) => {
        resize = l;
        return () => {
          resizeStopped = true;
        };
      },
      canvasOf: () => canvas,
    };
    const atmosphere = startAtmosphere(decor, deps);
    return {
      decor,
      frame,
      timers,
      canvas,
      atmosphere,
      setReduced: (v: boolean) => ((query.matches = v), motionChange()),
      tick: (ms: number) => ((clock += ms), timers.advance(ms)),
      resize: () => resize(),
      resizeStopped: () => resizeStopped,
    };
  }

  test('with motion allowed, the fog asks for frames and the timecode runs', () => {
    const s = atmosphereSetup(false);
    expect(s.frame.pending).toBe(1);
    expect(s.timers.pending).toBe(1);
    s.tick(1000);
    expect(s.decor.timecode.textContent).toBe('00:00:01:00');
  });

  test('with reduced motion, there is one still fog frame, no frames asked for, no timers, and a zero timecode', () => {
    const s = atmosphereSetup(true);
    expect(s.canvas.context.draws).toHaveLength(FOG_BLOBS);
    expect(s.frame.pending).toBe(0);
    expect(s.frame.requested).toBe(0);
    expect(s.timers.pending).toBe(0);
    s.tick(5000);
    expect(s.decor.timecode.textContent).toBe(TIMECODE_ZERO);
  });

  test('a change of the setting while the page is open stops and restarts the motion', () => {
    const s = atmosphereSetup(false);
    s.setReduced(true);
    expect(s.frame.pending).toBe(0);
    expect(s.timers.pending).toBe(0);
    expect(s.decor.timecode.textContent).toBe(TIMECODE_ZERO);
    s.setReduced(false);
    expect(s.frame.pending).toBe(1);
    expect(s.timers.pending).toBe(1);
  });

  test('a resize redraws the fog', () => {
    const s = atmosphereSetup(false);
    const before = s.canvas.context.draws.length;
    s.resize();
    expect(s.canvas.context.draws.length).toBe(before + FOG_BLOBS);
  });

  test('destroy stops everything', () => {
    const s = atmosphereSetup(false);
    s.atmosphere.destroy();
    expect(s.frame.pending).toBe(0);
    expect(s.timers.pending).toBe(0);
    expect(s.resizeStopped()).toBe(true);
  });
});

// ---- the decoration in the page ---------------------------------------------------------------------------------------

describe('decoration', () => {
  test('moon, fog, vignette, scanlines and REC are all inside the two aria-hidden layers, and none of them can be reached', () => {
    const root = document.createElement('div');
    document.body.append(root);
    mountApp(root, sampleBoard());
    const decor = [...root.querySelectorAll<HTMLElement>('[data-decor]')];
    expect(decor.map((d) => d.dataset.decor)).toEqual(['moon', 'fog', 'vignette', 'scanlines', 'rec']);
    for (const d of decor) {
      expect(d.closest('[aria-hidden="true"]')).not.toBeNull();
      expect(d.closest('.atmosphere')).not.toBeNull();
      expect(d.matches('button, a, input, [tabindex]')).toBe(false);
      expect(d.querySelector('button, a, input, [tabindex]')).toBeNull();
    }
    expect(root.querySelector('[data-layer="back"] [data-decor="fog"]')?.tagName).toBe('CANVAS');
  });

  test('the "REC" corner shows a dot, the word REC and a timecode', () => {
    const root = document.createElement('div');
    document.body.append(root);
    mountApp(root, sampleBoard());
    const rec = root.querySelector('[data-decor="rec"]');
    expect(rec?.textContent).toBe('●REC00:00:00:00');
    expect(rec?.querySelector('.rec-time')?.textContent).toBe(TIMECODE_ZERO);
  });

  test('the app starts and stops the moving parts when given them', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const frame = new FakeFrame();
    const timers = new FakeTimers();
    const canvas = new FakeCanvas();
    const app = mountApp(root, sampleBoard(), {
      services: { frame, timers },
      atmosphere: {
        fog: { frame, viewport: () => ({ width: 800, height: 600 }), createCanvas: () => new FakeCanvas(), isVisible: () => true, onVisibility: () => () => {} },
        timecode: { now: () => 0, timers },
        matchMedia: undefined,
        onResize: () => () => {},
        canvasOf: () => canvas,
      },
    });
    expect(timers.pending).toBe(1);
    expect(canvas.context.draws.length).toBeGreaterThan(0);
    app.destroy();
    expect(timers.pending).toBe(0);
    expect(frame.pending).toBe(0);
  });

  test('a plain mount starts nothing: no fog frames and no timecode timer', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const frame = new FakeFrame();
    const timers = new FakeTimers();
    mountApp(root, sampleBoard(), { services: { frame, timers } });
    frame.flush();
    expect(timers.pending).toBe(0);
  });
});
