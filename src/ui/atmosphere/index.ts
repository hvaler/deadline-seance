import { createFog } from './fog';
import type { CanvasLike, FogDeps } from './fog';
import { asCanvas } from './decor';
import type { Decor } from './decor';
import { motionPreference } from './motion';
import type { MatchMedia } from './motion';
import { createTimecode } from './timecode';
import type { TimecodeDeps } from './timecode';

/**
 * Starts the moving parts of the decoration: the fog and the timecode. They follow the motion preference, including a change of it while the
 * page is open. Everything impure comes in through `AtmosphereDeps`, so tests can drive it with fakes.
 */

export interface AtmosphereDeps {
  readonly fog: FogDeps;
  readonly timecode: TimecodeDeps;
  readonly matchMedia: MatchMedia | undefined;
  /** Calls the listener when the window is resized. Returns the function that stops listening. */
  readonly onResize: (listener: () => void) => () => void;
  /** The canvas to use for the fog, when it should not be the one in the decoration (tests). */
  readonly canvasOf?: (decor: Decor) => CanvasLike;
}

export interface Atmosphere {
  destroy(): void;
}

export function startAtmosphere(decor: Decor, deps: AtmosphereDeps): Atmosphere {
  const motion = motionPreference(deps.matchMedia);
  const fog = createFog(deps.canvasOf ? deps.canvasOf(decor) : asCanvas(decor.canvas), deps.fog);
  const timecode = createTimecode(decor.timecode, deps.timecode);

  const apply = (reduced: boolean): void => {
    fog.setReduced(reduced);
    timecode.setReduced(reduced);
  };
  apply(motion.reduced);
  fog.start();
  timecode.start();

  const stopMotion = motion.subscribe(apply);
  const stopResize = deps.onResize(() => fog.resize());

  return {
    destroy() {
      stopMotion();
      stopResize();
      fog.destroy();
      timecode.stop();
    },
  };
}

/** The real browser: animation frames, the viewport, the page visibility, the monotonic timer. */
export function browserAtmosphere(frame: FogDeps['frame'], timers: TimecodeDeps['timers']): AtmosphereDeps {
  return {
    fog: {
      frame,
      viewport: () => ({ width: window.innerWidth, height: window.innerHeight }),
      createCanvas: () => document.createElement('canvas') as unknown as CanvasLike,
      isVisible: () => document.visibilityState !== 'hidden',
      onVisibility: (listener) => {
        document.addEventListener('visibilitychange', listener);
        return () => document.removeEventListener('visibilitychange', listener);
      },
    },
    timecode: { now: () => performance.now(), timers },
    matchMedia: typeof window.matchMedia === 'function' ? (query) => window.matchMedia(query) : undefined,
    onResize: (listener) => {
      window.addEventListener('resize', listener);
      return () => window.removeEventListener('resize', listener);
    },
  };
}
