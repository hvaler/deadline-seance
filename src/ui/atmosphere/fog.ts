import type { Frame } from '../services';

/**
 * Slow fog drifting across the night. It is a canvas at a quarter of the screen size (so the browser stretches it and it is cheap to
 * draw), filled by copying one soft sprite, which is drawn once, a few times at different sizes and speeds. It runs at most 20 frames a
 * second, stops while the tab is hidden, and under reduced motion draws one still frame and nothing more. Positions come from an integer
 * hash of the blob number, never from a random number. It is decoration: the canvas is `aria-hidden`.
 */

export const FOG_BLOBS = 6;
export const FOG_FRAME_MS = 50; // 20 frames a second
export const FOG_SCALE = 4; // the canvas has a quarter of the screen's width and height
const SPRITE_SIZE = 128;

export interface GradientLike {
  addColorStop(offset: number, color: string): void;
}

export interface Context2dLike {
  fillStyle: unknown;
  globalAlpha: number;
  clearRect(x: number, y: number, width: number, height: number): void;
  fillRect(x: number, y: number, width: number, height: number): void;
  drawImage(image: unknown, x: number, y: number, width: number, height: number): void;
  createRadialGradient(x0: number, y0: number, r0: number, x1: number, y1: number, r1: number): GradientLike;
}

export interface CanvasLike {
  width: number;
  height: number;
  getContext(type: '2d'): Context2dLike | null;
}

export interface FogDeps {
  readonly frame: Frame;
  readonly viewport: () => { readonly width: number; readonly height: number };
  readonly createCanvas: () => CanvasLike;
  readonly isVisible: () => boolean;
  /** Calls the listener when the tab is shown or hidden. Returns the function that stops listening. */
  readonly onVisibility: (listener: () => void) => () => void;
}

export interface Fog {
  start(): void;
  stop(): void;
  setReduced(reduced: boolean): void;
  resize(): void;
  destroy(): void;
  /** For tests: how many times the canvas was drawn. */
  readonly draws: number;
}

/** A fraction in 0..1 for a blob number and a purpose, from an integer hash. */
export function fraction(index: number, salt: number): number {
  let h = Math.imul(index + 1, 2654435761) ^ Math.imul(salt + 1, 40503);
  h = Math.imul(h ^ (h >>> 15), 2246822519);
  h = Math.imul(h ^ (h >>> 13), 3266489917);
  h ^= h >>> 16;
  return (h >>> 0) / 0x100000000;
}

interface Blob {
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly speed: number;
  readonly alpha: number;
}

export function createFog(canvas: CanvasLike, deps: FogDeps): Fog {
  const ctx = canvas.getContext('2d');
  let sprite: CanvasLike | null = null;
  let running = false;
  let reduced = false;
  let frameId: number | null = null;
  let last: number | null = null; // when the fog was last drawn, on the frame clock
  let origin = 0; // the frame clock at the first frame, so the drift starts from the still picture
  let draws = 0;
  let width = 1;
  let height = 1;
  let blobs: Blob[] = [];
  let stopWatching: (() => void) | null = null;

  function makeSprite(): CanvasLike | null {
    const made = deps.createCanvas();
    made.width = SPRITE_SIZE;
    made.height = SPRITE_SIZE;
    const sctx = made.getContext('2d');
    if (sctx === null) return null;
    const half = SPRITE_SIZE / 2;
    const gradient = sctx.createRadialGradient(half, half, 0, half, half, half);
    gradient.addColorStop(0, 'rgba(235, 228, 211, 0.55)');
    gradient.addColorStop(0.5, 'rgba(235, 228, 211, 0.18)');
    gradient.addColorStop(1, 'rgba(235, 228, 211, 0)');
    sctx.fillStyle = gradient;
    sctx.fillRect(0, 0, SPRITE_SIZE, SPRITE_SIZE);
    return made;
  }

  function layout(): void {
    const view = deps.viewport();
    width = Math.max(1, Math.floor(view.width / FOG_SCALE));
    height = Math.max(1, Math.floor(view.height / FOG_SCALE));
    canvas.width = width;
    canvas.height = height;
    const reference = Math.max(width, height);
    blobs = Array.from({ length: FOG_BLOBS }, (_, i) => ({
      x: fraction(i, 1) * width,
      y: (0.25 + 0.7 * fraction(i, 2)) * height,
      size: (0.45 + 0.6 * fraction(i, 3)) * reference,
      speed: (i % 2 === 0 ? 1 : -1) * (2 + 5 * fraction(i, 4)), // canvas pixels a second
      alpha: 0.35 + 0.4 * fraction(i, 5),
    }));
  }

  function draw(timeMs: number): void {
    if (ctx === null || sprite === null) return;
    ctx.clearRect(0, 0, width, height);
    for (const blob of blobs) {
      const span = width + blob.size;
      const travelled = blob.x + (blob.speed * timeMs) / 1000;
      const x = ((travelled % span) + span) % span - blob.size;
      ctx.globalAlpha = blob.alpha;
      ctx.drawImage(sprite, x, blob.y - blob.size / 2, blob.size, blob.size);
    }
    ctx.globalAlpha = 1;
    draws++;
  }

  function wanted(): boolean {
    return running && !reduced && deps.isVisible();
  }

  function schedule(): void {
    if (frameId !== null || !wanted()) return;
    frameId = deps.frame.request(tick);
  }

  function cancel(): void {
    if (frameId !== null) deps.frame.cancel(frameId);
    frameId = null;
  }

  function tick(time: number): void {
    frameId = null;
    if (!wanted()) return;
    if (last === null) {
      last = time;
      origin = time;
    } else if (time - last >= FOG_FRAME_MS - 1) {
      // A millisecond of slack, so a 60 Hz screen gets every third frame (20 a second) and not every fourth.
      last = time;
      draw(time - origin);
    }
    schedule();
  }

  return {
    start() {
      if (running) return;
      running = true;
      last = null;
      sprite = makeSprite();
      layout();
      draw(0); // one frame at once: the still picture reduced motion keeps
      stopWatching = deps.onVisibility(() => (wanted() ? schedule() : cancel()));
      schedule();
    },
    stop() {
      running = false;
      cancel();
      stopWatching?.();
      stopWatching = null;
    },
    setReduced(on) {
      reduced = on;
      if (on) {
        cancel();
        if (running) draw(0);
      } else schedule();
    },
    resize() {
      if (!running) return;
      layout();
      draw(0);
    },
    destroy() {
      this.stop();
    },
    get draws() {
      return draws;
    },
  };
}
