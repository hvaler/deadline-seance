/**
 * The user's motion preference. When `prefers-reduced-motion: reduce` is set, the fog, the blink, the timecode, the flicker and every
 * other animation stop, and state is carried by text and static styling instead. The CSS handles its own animations with the same media
 * query; this is for the parts that run from script, and it follows a change of the setting while the page is open.
 */

export interface MediaQueryListLike {
  readonly matches: boolean;
  addEventListener?(type: 'change', listener: () => void): void;
  removeEventListener?(type: 'change', listener: () => void): void;
  /** Older browsers. */
  addListener?(listener: () => void): void;
  removeListener?(listener: () => void): void;
}

export type MatchMedia = (query: string) => MediaQueryListLike;

export interface MotionPreference {
  readonly reduced: boolean;
  /** Calls `listener` whenever the setting changes. Returns the function that stops listening. */
  subscribe(listener: (reduced: boolean) => void): () => void;
}

export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

export function motionPreference(matchMedia: MatchMedia | undefined): MotionPreference {
  const query = matchMedia?.(REDUCED_MOTION_QUERY);
  return {
    get reduced() {
      return query?.matches ?? false;
    },
    subscribe(listener) {
      if (query === undefined) return () => {};
      const onChange = (): void => listener(query.matches);
      if (query.addEventListener) query.addEventListener('change', onChange);
      else query.addListener?.(onChange);
      return () => {
        if (query.removeEventListener) query.removeEventListener('change', onChange);
        else query.removeListener?.(onChange);
      };
    },
  };
}
