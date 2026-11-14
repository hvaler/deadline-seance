import { createSound } from './audio/sound';
import type { AudioLike } from './audio/types';
import type { SoundEvent } from './sound-events';

/**
 * The impure things the UI uses, behind small interfaces so tests can replace them: animation frames, timers and the sound player.
 * Nothing here reads the clock for the rule; frames and timers only schedule work.
 */

export interface Frame {
  /** Calls `callback` once, before the next paint, with a timestamp in milliseconds. */
  request(callback: (time: number) => void): number;
  cancel(id: number): void;
}

export interface Timers {
  set(callback: () => void, ms: number): number;
  clear(id: number): void;
}

export interface SoundPlayer {
  readonly enabled: boolean;
  /** Turning sound on must happen inside a user gesture (a click): that is when the audio context is created. */
  setEnabled(on: boolean): void;
  play(event: SoundEvent): void;
}

/** The browser page the tour reads and moves: the address hash and the scroll position. Behind an interface so tests record what it is asked. */
export interface Page {
  /** `location.hash`, for example `#play`, or `''`. */
  hash(): string;
  /** Calls `callback` when the hash changes. Returns the function that stops listening. */
  onHashChange(callback: () => void): () => void;
  /** Scrolls so that the top of `element` is near the top of the screen. `instant` jumps instead of gliding. */
  reveal(element: Element, options: { readonly instant: boolean }): void;
  scrollY(): number;
  /** Jumps (never glides) to a scroll position. */
  scrollTo(y: number): void;
}

/** Writes text to the clipboard. Rejects when the browser has no clipboard API or refuses (an insecure page, a denied permission). */
export interface ClipboardWriter {
  writeText(text: string): Promise<void>;
}

/** Saves a text as a file the user downloads. */
export interface FileSaver {
  save(name: string, text: string, type: string): void;
}

export interface Services {
  readonly frame: Frame;
  readonly timers: Timers;
  readonly sound: SoundPlayer;
  readonly page: Page;
  readonly clipboard: ClipboardWriter;
  readonly files: FileSaver;
}

export function browserFrame(): Frame {
  if (typeof window.requestAnimationFrame === 'function') {
    return {
      request: (callback) => window.requestAnimationFrame(callback),
      cancel: (id) => window.cancelAnimationFrame(id),
    };
  }
  // No animation frames (a bare test DOM): fall back to a short timer.
  return {
    request: (callback) => window.setTimeout(() => callback(0), 16),
    cancel: (id) => window.clearTimeout(id),
  };
}

export function browserTimers(): Timers {
  return {
    set: (callback, ms) => window.setTimeout(callback, ms),
    clear: (id) => window.clearTimeout(id),
  };
}

/** The real audio context, or null where there is none. It is created only when sound is first turned on. */
export function browserAudioFactory(): AudioLike | null {
  const Ctor = (window as unknown as { AudioContext?: new () => unknown }).AudioContext;
  return Ctor === undefined ? null : (new Ctor() as unknown as AudioLike);
}

/** Room kept above an element that is scrolled into view, in pixels. */
const REVEAL_MARGIN = 16;

export function browserPage(): Page {
  return {
    hash: () => window.location.hash,
    onHashChange(callback) {
      window.addEventListener('hashchange', callback);
      return () => window.removeEventListener('hashchange', callback);
    },
    reveal(element, { instant }) {
      const top = Math.max(0, element.getBoundingClientRect().top + window.scrollY - REVEAL_MARGIN);
      window.scrollTo({ top, behavior: instant ? 'auto' : 'smooth' });
    },
    scrollY: () => window.scrollY,
    scrollTo: (y) => window.scrollTo({ top: y, behavior: 'auto' }),
  };
}

export function browserClipboard(): ClipboardWriter {
  return {
    writeText: (text) => {
      const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
      return clipboard === undefined ? Promise.reject(new Error('no clipboard')) : clipboard.writeText(text);
    },
  };
}

/** How long an object URL stays valid after the click that starts the download: long enough for the browser to take it, then it is revoked. */
export const REVOKE_AFTER_MS = 1000;

/**
 * A download with no network: a Blob, an object URL and a temporary link with download. The URL is revoked afterwards (through the injected
 * timers) and the link is removed at once.
 */
export function browserFiles(timers: Timers): FileSaver {
  return {
    save(name, text, type) {
      const url = URL.createObjectURL(new Blob([text], { type }));
      const link = document.createElement('a');
      link.href = url;
      link.download = name;
      link.hidden = true;
      document.body.append(link);
      link.click();
      link.remove();
      timers.set(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
    },
  };
}

export function browserServices(): Services {
  const timers = browserTimers();
  return {
    frame: browserFrame(),
    timers,
    sound: createSound(browserAudioFactory),
    page: browserPage(),
    clipboard: browserClipboard(),
    files: browserFiles(timers),
  };
}